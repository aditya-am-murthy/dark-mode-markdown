import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { PdfExporter } from './pdfExporter';

export class PreviewPanel {
  private static panels: Map<string, PreviewPanel> = new Map();
  private readonly panel: vscode.WebviewPanel;
  private document: vscode.TextDocument;
  private readonly context: vscode.ExtensionContext;
  private disposables: vscode.Disposable[] = [];
  private debounceTimer: NodeJS.Timeout | undefined;
  private sideBySide: boolean;

  private constructor(
    context: vscode.ExtensionContext,
    document: vscode.TextDocument,
    sideBySide: boolean
  ) {
    this.context = context;
    this.document = document;
    this.sideBySide = sideBySide;

    const column = sideBySide ? vscode.ViewColumn.Two : vscode.ViewColumn.Active;

    this.panel = vscode.window.createWebviewPanel(
      'darkMarkdownPreview',
      `Preview: ${path.basename(document.fileName)}`,
      column,
      {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, 'media')
        ],
        retainContextWhenHidden: true
      }
    );

    this.panel.webview.html = this.getHtml();

    // Send initial content
    this.sendUpdate();

    // Handle messages from webview
    this.panel.webview.onDidReceiveMessage(
      (msg) => this.handleMessage(msg),
      null,
      this.disposables
    );

    // Auto-refresh on text change (debounced)
    const config = vscode.workspace.getConfiguration('darkMarkdown');
    if (config.get<boolean>('autoRefresh', true)) {
      this.disposables.push(
        vscode.workspace.onDidChangeTextDocument((e) => {
          if (e.document.uri.toString() === this.document.uri.toString()) {
            if (this.debounceTimer) {
              clearTimeout(this.debounceTimer);
            }
            this.debounceTimer = setTimeout(() => this.sendUpdate(), 300);
          }
        })
      );

      this.disposables.push(
        vscode.workspace.onDidSaveTextDocument((doc) => {
          if (doc.uri.toString() === this.document.uri.toString()) {
            this.sendUpdate();
          }
        })
      );
    }

    // Active editor change — update document reference
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor && editor.document.languageId === 'markdown') {
          this.document = editor.document;
          this.panel.title = `Preview: ${path.basename(editor.document.fileName)}`;
          this.sendUpdate();
        }
      })
    );

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  static createOrShow(
    context: vscode.ExtensionContext,
    document: vscode.TextDocument,
    sideBySide: boolean
  ): PreviewPanel {
    const key = document.uri.toString();
    const existing = PreviewPanel.panels.get(key);
    if (existing) {
      existing.panel.reveal();
      existing.sendUpdate();
      return existing;
    }

    if (sideBySide) {
      // Ensure the markdown file is visible in column one
      vscode.window.showTextDocument(document, vscode.ViewColumn.One, false);
    }

    const panel = new PreviewPanel(context, document, sideBySide);
    PreviewPanel.panels.set(key, panel);
    return panel;
  }

  static async exportPdf(
    context: vscode.ExtensionContext,
    document: vscode.TextDocument
  ): Promise<void> {
    const key = document.uri.toString();
    let panel = PreviewPanel.panels.get(key);
    if (!panel) {
      panel = PreviewPanel.createOrShow(context, document, false);
    }
    await PdfExporter.export(panel.panel.webview, document, context);
  }

  static disposeAll(): void {
    for (const panel of PreviewPanel.panels.values()) {
      panel.dispose();
    }
  }

  private sendUpdate(): void {
    const markdown = this.document.getText();
    const config = vscode.workspace.getConfiguration('darkMarkdown');
    const theme = {
      background: config.get<string>('theme.background', '#0d1117'),
      foreground: config.get<string>('theme.foreground', '#c9d1d9'),
      accent: config.get<string>('theme.accent', '#58a6ff'),
      fontFamily: config.get<string>('theme.fontFamily', "'Segoe UI', system-ui, sans-serif"),
      fontSize: config.get<number>('theme.fontSize', 16)
    };
    const fileType = this.document.languageId === 'csv' ? 'csv' : 'markdown';
    this.panel.webview.postMessage({ type: 'update', markdown, theme, sideBySide: this.sideBySide, fileType });
  }

  private handleMessage(msg: { type: string; html?: string }): void {
    switch (msg.type) {
      case 'toggleSideBySide':
        this.sideBySide = !this.sideBySide;
        if (this.sideBySide) {
          vscode.window.showTextDocument(this.document, vscode.ViewColumn.One, false);
        }
        break;
      case 'exportPdf':
        PdfExporter.export(this.panel.webview, this.document, this.context);
        break;
      case 'copyHtml':
        if (msg.html) {
          vscode.env.clipboard.writeText(msg.html);
          vscode.window.showInformationMessage('HTML copied to clipboard.');
        }
        break;
      case 'ready':
        this.sendUpdate();
        break;
    }
  }

  private getHtml(): string {
    const webview = this.panel.webview;

    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'preview.css')
    );
    const jsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'preview.js')
    );

    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'none';
    style-src ${webview.cspSource} 'unsafe-inline';
    script-src 'nonce-${nonce}' https://cdn.jsdelivr.net https://unpkg.com;
    img-src ${webview.cspSource} https: data:;
    font-src ${webview.cspSource} https:;
    connect-src https:;
  ">
  <link rel="stylesheet" href="${cssUri}">
  <title>Dark Markdown Preview</title>
</head>
<body>
  <div id="toolbar">
    <button id="btn-sidebyside" title="Toggle side by side">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <rect x="1" y="1" width="6" height="14" rx="1" opacity="0.6"/>
        <rect x="9" y="1" width="6" height="14" rx="1"/>
      </svg>
      Side by Side
    </button>
    <button id="btn-export" title="Export to PDF">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M4 1h5l4 4v10H4V1zm5 0v4h4M7 9l-2 2 2 2M9 9l2 2-2 2M8 7v8"/>
      </svg>
      Export PDF
    </button>
    <button id="btn-copy" title="Copy HTML">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <rect x="4" y="4" width="9" height="11" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/>
        <rect x="2" y="1" width="9" height="11" rx="1"/>
      </svg>
      Copy HTML
    </button>
  </div>
  <div id="preview-content"></div>

  <script nonce="${nonce}" src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <script nonce="${nonce}" src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"></script>
  <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
  }

  private dispose(): void {
    PreviewPanel.panels.delete(this.document.uri.toString());
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.panel.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

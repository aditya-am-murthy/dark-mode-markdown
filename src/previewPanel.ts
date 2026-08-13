import * as vscode from 'vscode';
import * as path from 'path';
import { ExportMode, PdfExporter } from './pdfExporter';

type HostMessage =
  | { type: 'ready' }
  | { type: 'toggleSideBySide' }
  | { type: 'closePreview' }
  | { type: 'exportPdf' }
  | { type: 'copyHtml'; html?: string }
  | { type: 'pdfChunk'; id: string; index: number; total: number; chunk: string }
  | { type: 'pdfDone'; id: string }
  | { type: 'pdfError'; message?: string };

export class PreviewPanel {
  private static panels: Map<string, PreviewPanel> = new Map();
  private static readonly previewOpenKey = 'darkMarkdown.previewOpen';

  private readonly panel: vscode.WebviewPanel;
  private document: vscode.TextDocument;
  private readonly context: vscode.ExtensionContext;
  private disposables: vscode.Disposable[] = [];
  private debounceTimer: NodeJS.Timeout | undefined;
  private sideBySide: boolean;
  private readonly panelKey: string;
  private readonly pdfChunks = new Map<string, string[]>();
  private disposed = false;

  private constructor(
    context: vscode.ExtensionContext,
    document: vscode.TextDocument,
    sideBySide: boolean
  ) {
    this.context = context;
    this.document = document;
    this.sideBySide = sideBySide;
    this.panelKey = document.uri.toString();

    const column = sideBySide ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active;

    this.panel = vscode.window.createWebviewPanel(
      'darkMarkdownPreview',
      `Preview: ${path.basename(document.fileName)}`,
      column,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
        retainContextWhenHidden: true
      }
    );

    this.panel.webview.html = this.getHtml();
    this.sendUpdate();

    this.panel.webview.onDidReceiveMessage(
      (msg) => this.handleMessage(msg as HostMessage),
      null,
      this.disposables
    );

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

    // Only follow editor switches when the same panel is still the preview for that tab set.
    // Do not hijack preview to every markdown file (was fighting close/toggle).

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    PreviewPanel.setPreviewOpen(true);
  }

  static toggle(
    context: vscode.ExtensionContext,
    document: vscode.TextDocument,
    sideBySide: boolean
  ): void {
    const existing = PreviewPanel.panels.get(document.uri.toString());
    if (existing) {
      existing.dispose();
      return;
    }
    PreviewPanel.createOrShow(context, document, sideBySide);
  }

  static createOrShow(
    context: vscode.ExtensionContext,
    document: vscode.TextDocument,
    sideBySide: boolean
  ): PreviewPanel {
    const key = document.uri.toString();
    const existing = PreviewPanel.panels.get(key);
    if (existing) {
      void existing.applyLayout(sideBySide);
      existing.sendUpdate();
      return existing;
    }

    const panel = new PreviewPanel(context, document, sideBySide);
    PreviewPanel.panels.set(key, panel);
    if (sideBySide) {
      void panel.applyLayout(true);
    }
    return panel;
  }

  static closeFor(document: vscode.TextDocument): void {
    const existing = PreviewPanel.panels.get(document.uri.toString());
    existing?.dispose();
  }

  static closeActive(): void {
    const values = [...PreviewPanel.panels.values()];
    const last = values[values.length - 1];
    last?.dispose();
  }

  static async exportPdf(
    context: vscode.ExtensionContext,
    document: vscode.TextDocument
  ): Promise<void> {
    const mode = await PdfExporter.pickMode();
    if (!mode) {
      return;
    }

    // Preferred: Chrome/Chromium print of rendered HTML (avoids blank html2canvas PDFs)
    try {
      const viaChrome = await PdfExporter.exportWithChrome(document, mode);
      if (viaChrome) {
        vscode.window.showInformationMessage(`Saved rendered PDF: ${viaChrome}`);
        return;
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      vscode.window.showWarningMessage(
        `Chrome PDF export failed (${detail}). Falling back to preview capture…`
      );
    }

    const panel = PreviewPanel.createOrShow(context, document, true);
    await panel.startRenderedPdfExport(mode);
  }

  static disposeAll(): void {
    for (const panel of [...PreviewPanel.panels.values()]) {
      panel.dispose();
    }
  }

  private static setPreviewOpen(open: boolean): void {
    void vscode.commands.executeCommand('setContext', PreviewPanel.previewOpenKey, open);
  }

  private async applyLayout(sideBySide: boolean): Promise<void> {
    this.sideBySide = sideBySide;
    if (sideBySide) {
      await vscode.window.showTextDocument(this.document, {
        viewColumn: vscode.ViewColumn.One,
        preserveFocus: true,
        preview: false
      });
      this.panel.reveal(vscode.ViewColumn.Two, true);
    } else {
      this.panel.reveal(vscode.ViewColumn.Active, false);
    }
    this.panel.webview.postMessage({
      type: 'layout',
      sideBySide: this.sideBySide
    });
  }

  private async startRenderedPdfExport(mode: ExportMode): Promise<void> {
    const theme = PdfExporter.resolveThemePublic(mode);
    vscode.window.setStatusBarMessage(`Exporting ${mode} PDF…`, 10000);
    this.panel.webview.postMessage({
      type: 'exportRenderedPdf',
      theme,
      mode
    });
  }

  private sendUpdate(): void {
    const markdown = this.document.getText();
    const config = vscode.workspace.getConfiguration('darkMarkdown');
    const theme = {
      background: config.get<string>('theme.background', '#0a0a0a'),
      foreground: config.get<string>('theme.foreground', '#f0f0f0'),
      accent: config.get<string>('theme.accent', '#88c0d0'),
      fontFamily: config.get<string>('theme.fontFamily', "'Segoe UI', system-ui, sans-serif"),
      fontSize: config.get<number>('theme.fontSize', 16)
    };
    const fileType =
      this.document.languageId === 'csv' || this.document.fileName.endsWith('.csv')
        ? 'csv'
        : 'markdown';
    this.panel.webview.postMessage({
      type: 'update',
      markdown,
      theme,
      sideBySide: this.sideBySide,
      fileType
    });
  }

  private async handleMessage(msg: HostMessage): Promise<void> {
    switch (msg.type) {
      case 'ready':
        this.sendUpdate();
        break;
      case 'toggleSideBySide':
        await this.applyLayout(!this.sideBySide);
        break;
      case 'closePreview':
        this.dispose();
        break;
      case 'exportPdf': {
        const mode = await PdfExporter.pickMode();
        if (!mode) {
          break;
        }
        try {
          const viaChrome = await PdfExporter.exportWithChrome(this.document, mode);
          if (viaChrome) {
            vscode.window.showInformationMessage(`Saved rendered PDF: ${viaChrome}`);
            break;
          }
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          vscode.window.showWarningMessage(
            `Chrome PDF export failed (${detail}). Falling back to preview capture…`
          );
        }
        await this.startRenderedPdfExport(mode);
        break;
      }
      case 'copyHtml':
        if (msg.html) {
          await vscode.env.clipboard.writeText(msg.html);
          vscode.window.showInformationMessage('HTML copied to clipboard.');
        }
        break;
      case 'pdfChunk': {
        const parts = this.pdfChunks.get(msg.id) ?? [];
        parts[msg.index] = msg.chunk;
        this.pdfChunks.set(msg.id, parts);
        break;
      }
      case 'pdfDone': {
        const parts = this.pdfChunks.get(msg.id) ?? [];
        this.pdfChunks.delete(msg.id);
        if (parts.length === 0 || parts.some((p) => typeof p !== 'string')) {
          vscode.window.showErrorMessage('PDF export failed: incomplete data from preview.');
          break;
        }
        const base64 = parts.join('');
        try {
          const baseName =
            path.basename(this.document.fileName).replace(/\.[^.]+$/, '') || 'export';
          const saved = await PdfExporter.writePdfBytes(this.document, baseName, base64);
          vscode.window.showInformationMessage(`Saved rendered PDF: ${saved}`);
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`Could not write PDF: ${detail}`);
        }
        // Restore live theme after export capture
        this.sendUpdate();
        break;
      }
      case 'pdfError':
        vscode.window.showErrorMessage(`PDF export failed: ${msg.message ?? 'unknown error'}`);
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
    script-src 'nonce-${nonce}' https://cdn.jsdelivr.net;
    img-src ${webview.cspSource} https: http: data: blob:;
    font-src ${webview.cspSource} https: data:;
    connect-src https: data: blob:;
  ">
  <link rel="stylesheet" href="${cssUri}">
  <title>Dark Markdown Preview</title>
</head>
<body>
  <div id="toolbar">
    <button id="btn-sidebyside" title="Editor left, preview right">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <rect x="1" y="1" width="6" height="14" rx="1" opacity="0.6"/>
        <rect x="9" y="1" width="6" height="14" rx="1"/>
      </svg>
      Side by Side
    </button>
    <button id="btn-export" title="Save rendered HTML as PDF beside this file">
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
    <button id="btn-close" title="Close preview">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M3.5 3.5l9 9m0-9l-9 9" stroke="currentColor" stroke-width="1.5"/>
      </svg>
      Close
    </button>
  </div>
  <div id="preview-content"></div>

  <script nonce="${nonce}" src="https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js"></script>
  <script nonce="${nonce}" src="https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js"></script>
  <script nonce="${nonce}" src="https://cdn.jsdelivr.net/npm/html2pdf.js@0.10.2/dist/html2pdf.bundle.min.js"></script>
  <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
  }

  private dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    PreviewPanel.panels.delete(this.panelKey);
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
    try {
      this.panel.dispose();
    } catch {
      // already disposed
    }
    PreviewPanel.setPreviewOpen(PreviewPanel.panels.size > 0);
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

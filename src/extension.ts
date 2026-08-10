import * as vscode from 'vscode';
import { PreviewPanel } from './previewPanel';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('darkMarkdown.togglePreview', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isSupportedDoc(editor.document)) {
        vscode.window.showWarningMessage('Open a Markdown or CSV file first.');
        return;
      }
      const sideBySide =
        vscode.workspace.getConfiguration('darkMarkdown').get<boolean>('sideBySideByDefault') ??
        true;
      PreviewPanel.toggle(context, editor.document, sideBySide);
    }),

    vscode.commands.registerCommand('darkMarkdown.openPreview', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isSupportedDoc(editor.document)) {
        vscode.window.showWarningMessage('Open a Markdown or CSV file first.');
        return;
      }
      const sideBySide =
        vscode.workspace.getConfiguration('darkMarkdown').get<boolean>('sideBySideByDefault') ??
        true;
      PreviewPanel.createOrShow(context, editor.document, sideBySide);
    }),

    vscode.commands.registerCommand('darkMarkdown.openSideBySide', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isSupportedDoc(editor.document)) {
        vscode.window.showWarningMessage('Open a Markdown or CSV file first.');
        return;
      }
      PreviewPanel.createOrShow(context, editor.document, true);
    }),

    vscode.commands.registerCommand('darkMarkdown.closePreview', () => {
      const editor = vscode.window.activeTextEditor;
      if (editor && isSupportedDoc(editor.document)) {
        PreviewPanel.closeFor(editor.document);
        return;
      }
      PreviewPanel.closeActive();
    }),

    vscode.commands.registerCommand('darkMarkdown.exportPdf', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isSupportedDoc(editor.document)) {
        vscode.window.showWarningMessage('Open a Markdown or CSV file first.');
        return;
      }
      void PreviewPanel.exportPdf(context, editor.document);
    })
  );

  // Optional auto-open (off by default so preview is toggleable)
  const maybeAutoOpen = (editor: vscode.TextEditor | undefined) => {
    if (!editor || !isSupportedDoc(editor.document)) {
      return;
    }
    const config = vscode.workspace.getConfiguration('darkMarkdown');
    if (!config.get<boolean>('autoOpenPreview', false)) {
      return;
    }
    const sideBySide = config.get<boolean>('sideBySideByDefault') ?? true;
    PreviewPanel.createOrShow(context, editor.document, sideBySide);
  };

  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(maybeAutoOpen));
  maybeAutoOpen(vscode.window.activeTextEditor);
}

function isSupportedLang(langId: string): boolean {
  return langId === 'markdown' || langId === 'csv';
}

function isSupportedDoc(doc: vscode.TextDocument): boolean {
  return isSupportedLang(doc.languageId) || doc.fileName.endsWith('.csv');
}

export function deactivate(): void {
  PreviewPanel.disposeAll();
}

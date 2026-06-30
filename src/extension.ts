import * as vscode from 'vscode';
import { PreviewPanel } from './previewPanel';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('darkMarkdown.openPreview', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isSupportedLang(editor.document.languageId)) {
        vscode.window.showWarningMessage('Open a Markdown or CSV file first.');
        return;
      }
      PreviewPanel.createOrShow(context, editor.document, false);
    }),

    vscode.commands.registerCommand('darkMarkdown.openSideBySide', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isSupportedLang(editor.document.languageId)) {
        vscode.window.showWarningMessage('Open a Markdown or CSV file first.');
        return;
      }
      PreviewPanel.createOrShow(context, editor.document, true);
    }),

    vscode.commands.registerCommand('darkMarkdown.exportPdf', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isSupportedLang(editor.document.languageId)) {
        vscode.window.showWarningMessage('Open a Markdown or CSV file first.');
        return;
      }
      PreviewPanel.exportPdf(context, editor.document);
    })
  );

  // Auto-open preview whenever a markdown or CSV file becomes active
  const autoOpen = (editor: vscode.TextEditor | undefined) => {
    if (editor && isSupportedLang(editor.document.languageId)) {
      const config = vscode.workspace.getConfiguration('darkMarkdown');
      const sideBySide = config.get<boolean>('sideBySideByDefault') ?? false;
      PreviewPanel.createOrShow(context, editor.document, sideBySide);
    }
  };

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(autoOpen)
  );

  // Trigger for any markdown file already open on activation
  autoOpen(vscode.window.activeTextEditor);
}

function isSupportedLang(langId: string): boolean {
  return langId === 'markdown' || langId === 'csv';
}

export function deactivate(): void {
  PreviewPanel.disposeAll();
}

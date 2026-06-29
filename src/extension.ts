import * as vscode from 'vscode';
import { PreviewPanel } from './previewPanel';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('darkMarkdown.openPreview', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== 'markdown') {
        vscode.window.showWarningMessage('Open a Markdown file first.');
        return;
      }
      PreviewPanel.createOrShow(context, editor.document, false);
    }),

    vscode.commands.registerCommand('darkMarkdown.openSideBySide', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== 'markdown') {
        vscode.window.showWarningMessage('Open a Markdown file first.');
        return;
      }
      PreviewPanel.createOrShow(context, editor.document, true);
    }),

    vscode.commands.registerCommand('darkMarkdown.exportPdf', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== 'markdown') {
        vscode.window.showWarningMessage('Open a Markdown file first.');
        return;
      }
      PreviewPanel.exportPdf(context, editor.document);
    })
  );

  // Auto-open preview if sideBySideByDefault is set and a markdown file is already open
  const config = vscode.workspace.getConfiguration('darkMarkdown');
  if (config.get<boolean>('sideBySideByDefault')) {
    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document.languageId === 'markdown') {
      PreviewPanel.createOrShow(context, editor.document, true);
    }
  }
}

export function deactivate(): void {
  PreviewPanel.disposeAll();
}

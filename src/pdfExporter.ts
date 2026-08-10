import * as vscode from 'vscode';

export type ExportMode = 'dark' | 'light';

export interface ExportTheme {
  mode: ExportMode;
  background: string;
  foreground: string;
  accent: string;
  fontFamily: string;
  fontSize: number;
  codeBg: string;
  codeFg: string;
  border: string;
  heading: string;
  muted: string;
  quoteBorder: string;
  thBg: string;
  rowAlt: string;
  blockquoteBg: string;
  mermaidTheme: 'dark' | 'default';
  mermaidPrimary: string;
  mermaidSecondary: string;
  mermaidBorder: string;
  errorColor: string;
}

const DARK_THEME: Omit<ExportTheme, 'fontFamily' | 'fontSize'> = {
  mode: 'dark',
  background: '#0a0a0a',
  foreground: '#f0f0f0',
  accent: '#88c0d0',
  codeBg: '#1a1a1a',
  codeFg: '#f0f0f0',
  border: '#2a2a2a',
  heading: '#f0f0f0',
  muted: '#989898',
  quoteBorder: '#88c0d0',
  thBg: '#1a1a1a',
  rowAlt: 'rgba(42, 42, 42, 0.45)',
  blockquoteBg: 'rgba(26, 26, 26, 0.8)',
  mermaidTheme: 'dark',
  mermaidPrimary: '#1a1a1a',
  mermaidSecondary: '#1a1a1a',
  mermaidBorder: '#2a2a2a',
  errorColor: '#bf616a'
};

const LIGHT_THEME: Omit<ExportTheme, 'fontFamily' | 'fontSize'> = {
  mode: 'light',
  background: '#ffffff',
  foreground: '#24292f',
  accent: '#0969da',
  codeBg: '#f6f8fa',
  codeFg: '#24292f',
  border: '#d0d7de',
  heading: '#1f2328',
  muted: '#656d76',
  quoteBorder: '#0969da',
  thBg: '#f6f8fa',
  rowAlt: 'rgba(246, 248, 250, 0.85)',
  blockquoteBg: 'rgba(246, 248, 250, 0.8)',
  mermaidTheme: 'default',
  mermaidPrimary: '#ddf4ff',
  mermaidSecondary: '#f6f8fa',
  mermaidBorder: '#d0d7de',
  errorColor: '#cf222e'
};

export class PdfExporter {
  static async pickMode(): Promise<ExportMode | undefined> {
    const config = vscode.workspace.getConfiguration('darkMarkdown');
    const pref = config.get<string>('exportMode', 'ask');
    if (pref === 'dark' || pref === 'light') {
      return pref;
    }

    const pick = await vscode.window.showQuickPick(
      [
        {
          label: 'Dark',
          description: 'Near-black preview theme',
          mode: 'dark' as ExportMode
        },
        {
          label: 'Light',
          description: 'White print-friendly theme',
          mode: 'light' as ExportMode
        }
      ],
      {
        placeHolder: 'Export rendered PDF in which mode?',
        title: 'Export Mode'
      }
    );

    return pick?.mode;
  }

  static resolveThemePublic(mode: ExportMode): ExportTheme {
    const config = vscode.workspace.getConfiguration('darkMarkdown');
    const base = mode === 'light' ? LIGHT_THEME : DARK_THEME;
    const fontFamily = config.get<string>(
      'theme.fontFamily',
      "'Segoe UI', system-ui, sans-serif"
    );
    const fontSize = config.get<number>('theme.fontSize', 16);

    if (mode === 'dark') {
      return {
        ...base,
        background: config.get<string>('theme.background', base.background),
        foreground: config.get<string>('theme.foreground', base.foreground),
        accent: config.get<string>('theme.accent', base.accent),
        fontFamily,
        fontSize
      };
    }

    return { ...base, fontFamily, fontSize };
  }

  static async writePdfBytes(
    document: vscode.TextDocument,
    baseName: string,
    base64: string
  ): Promise<string> {
    let pdfUri: vscode.Uri;
    if (document.uri.scheme === 'untitled') {
      const picked = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(`${baseName}.pdf`),
        filters: { PDF: ['pdf'] },
        saveLabel: 'Save PDF'
      });
      if (!picked) {
        throw new Error('Save cancelled');
      }
      pdfUri = picked;
    } else {
      pdfUri = vscode.Uri.joinPath(dirnameUri(document.uri), `${baseName}.pdf`);
    }

    const bytes = Buffer.from(base64, 'base64');
    await vscode.workspace.fs.writeFile(pdfUri, bytes);
    return pdfUri.scheme === 'file' ? pdfUri.fsPath : pdfUri.toString(true);
  }
}

function dirnameUri(uri: vscode.Uri): vscode.Uri {
  const normalized = uri.path.replace(/\\/g, '/');
  const idx = normalized.lastIndexOf('/');
  const dirPath = idx <= 0 ? '/' : normalized.slice(0, idx);
  return uri.with({ path: dirPath });
}

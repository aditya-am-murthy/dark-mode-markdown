import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

export class PdfExporter {
  /**
   * Export the given markdown document to PDF.
   *
   * Strategy:
   * 1. Build a self-contained HTML file with all styles inlined.
   * 2. Write it to a temp file.
   * 3. Open that file in the default browser and let the user trigger
   *    File > Print > Save as PDF (most reliable cross-platform approach
   *    that doesn't require a Chromium binary bundled with the extension).
   *
   * A note on puppeteer: requiring puppeteer-core would add ~100 MB to the
   * extension and needs a Chromium path.  The print-to-browser approach is
   * simpler, reliable, and keeps the extension small.
   */
  static async export(
    _webview: vscode.Webview,
    document: vscode.TextDocument,
    _context: vscode.ExtensionContext
  ): Promise<void> {
    const config = vscode.workspace.getConfiguration('darkMarkdown');
    const theme = {
      background: config.get<string>('theme.background', '#0d1117'),
      foreground: config.get<string>('theme.foreground', '#c9d1d9'),
      accent: config.get<string>('theme.accent', '#58a6ff'),
      fontFamily: config.get<string>('theme.fontFamily', "'Segoe UI', system-ui, sans-serif"),
      fontSize: config.get<number>('theme.fontSize', 16)
    };

    const markdown = document.getText();
    const baseName = path.basename(document.fileName, '.md');
    const html = PdfExporter.buildHtml(markdown, theme, baseName);

    const tmpDir = os.tmpdir();
    const tmpFile = path.join(tmpDir, `dark-md-export-${Date.now()}.html`);
    fs.writeFileSync(tmpFile, html, 'utf8');

    const uri = vscode.Uri.file(tmpFile);
    await vscode.env.openExternal(uri);

    vscode.window.showInformationMessage(
      'Preview opened in browser. Use File > Print (Ctrl+P / Cmd+P) → Save as PDF to export.',
      'OK'
    );
  }

  private static buildHtml(
    markdown: string,
    theme: {
      background: string;
      foreground: string;
      accent: string;
      fontFamily: string;
      fontSize: number;
    },
    title: string
  ): string {
    // Escape markdown for embedding in JS string
    const escapedMarkdown = markdown
      .replace(/\\/g, '\\\\')
      .replace(/`/g, '\\`')
      .replace(/\$/g, '\\$');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: ${theme.background};
      color: ${theme.foreground};
      font-family: ${theme.fontFamily};
      font-size: ${theme.fontSize}px;
      line-height: 1.7;
      padding: 48px;
      max-width: 860px;
      margin: 0 auto;
    }
    @media print {
      body { background: ${theme.background} !important; color: ${theme.foreground} !important; }
      @page { margin: 20mm; }
    }
    h1, h2, h3, h4, h5, h6 {
      color: #e6edf3;
      margin: 1.5em 0 0.5em;
      line-height: 1.3;
      font-weight: 600;
    }
    h1 { font-size: 2em; border-bottom: 1px solid #30363d; padding-bottom: 0.3em; }
    h2 { font-size: 1.5em; border-bottom: 1px solid #30363d; padding-bottom: 0.3em; }
    h3 { font-size: 1.25em; }
    h4 { font-size: 1em; }
    p { margin: 0.75em 0; }
    a { color: ${theme.accent}; text-decoration: none; }
    a:hover { text-decoration: underline; }
    code {
      font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
      font-size: 0.875em;
      background: #161b22;
      color: #e6edf3;
      padding: 0.2em 0.4em;
      border-radius: 4px;
      border: 1px solid #30363d;
    }
    pre {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 1.2em;
      overflow-x: auto;
      margin: 1em 0;
    }
    pre code {
      background: none;
      border: none;
      padding: 0;
      font-size: 0.9em;
      color: #e6edf3;
    }
    blockquote {
      border-left: 4px solid #3d444d;
      margin: 1em 0;
      padding: 0.5em 1em;
      color: #8b949e;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      margin: 1em 0;
      font-size: 0.95em;
    }
    th, td {
      border: 1px solid #30363d;
      padding: 0.6em 1em;
      text-align: left;
    }
    th { background: #161b22; color: #e6edf3; font-weight: 600; }
    tr:nth-child(even) { background: #161b22; }
    img { max-width: 100%; border-radius: 4px; }
    hr { border: none; border-top: 1px solid #30363d; margin: 2em 0; }
    ul, ol { margin: 0.75em 0 0.75em 1.5em; }
    li { margin: 0.25em 0; }
    .mermaid { text-align: center; margin: 1em 0; }
    #toolbar { display: none; }
  </style>
</head>
<body>
  <div id="preview-content"></div>
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"></script>
  <script>
    (function() {
      const markdown = \`${escapedMarkdown}\`;

      mermaid.initialize({
        startOnLoad: false,
        theme: 'dark',
        themeVariables: {
          background: '${theme.background}',
          primaryColor: '#1f2937',
          primaryTextColor: '${theme.foreground}',
          lineColor: '#58a6ff',
          secondaryColor: '#161b22',
          tertiaryColor: '#0d1117'
        }
      });

      marked.setOptions({ breaks: true, gfm: true });

      // Extract mermaid blocks before parsing
      const mermaidBlocks = [];
      let mermaidIndex = 0;
      const processedMd = markdown.replace(/\`\`\`mermaid\\n([\\s\\S]*?)\`\`\`/g, (_, diagram) => {
        const id = '__mermaid_' + mermaidIndex++;
        mermaidBlocks.push({ id, diagram: diagram.trim() });
        return '<div class="mermaid" id="' + id + '"></div>';
      });

      const html = marked.parse(processedMd);
      document.getElementById('preview-content').innerHTML = html;

      // Render mermaid diagrams
      mermaidBlocks.forEach(({ id, diagram }) => {
        const el = document.getElementById(id);
        if (el) {
          mermaid.render('mermaid-svg-' + id, diagram).then(({ svg }) => {
            el.innerHTML = svg;
          }).catch(err => {
            el.innerHTML = '<pre style="color:#ff7b72">Mermaid error: ' + err.message + '</pre>';
          });
        }
      });
    })();
  </script>
</body>
</html>`;
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

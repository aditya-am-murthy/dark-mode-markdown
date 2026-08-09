import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

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

/** Fully dark black preview look (GitHub dark + blue accents). */
const DARK_THEME: Omit<ExportTheme, 'fontFamily' | 'fontSize'> = {
  mode: 'dark',
  background: '#0d1117',
  foreground: '#c9d1d9',
  accent: '#58a6ff',
  codeBg: '#161b22',
  codeFg: '#e6edf3',
  border: '#1a3a6b',
  heading: '#e6edf3',
  muted: '#8b949e',
  quoteBorder: '#1e4db7',
  thBg: '#0e2a5c',
  rowAlt: 'rgba(22, 27, 34, 0.6)',
  blockquoteBg: 'rgba(22, 27, 34, 0.4)',
  mermaidTheme: 'dark',
  mermaidPrimary: '#1f2937',
  mermaidSecondary: '#161b22',
  mermaidBorder: '#3d444d',
  errorColor: '#ff7b72'
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
  /**
   * Export the given markdown/CSV document for Print → Save as PDF.
   * Builds a self-contained HTML file, opens it in the browser, and
   * auto-triggers the print dialog once rendering finishes.
   */
  static async export(
    _webview: vscode.Webview,
    document: vscode.TextDocument,
    _context: vscode.ExtensionContext,
    mode?: ExportMode
  ): Promise<void> {
    const selectedMode = mode ?? (await PdfExporter.pickMode());
    if (!selectedMode) {
      return;
    }

    const config = vscode.workspace.getConfiguration('darkMarkdown');
    const theme = PdfExporter.resolveTheme(selectedMode, config);

    const content = document.getText();
    const isCsv =
      document.languageId === 'csv' || document.fileName.toLowerCase().endsWith('.csv');
    const baseName = path.basename(document.fileName).replace(/\.[^.]+$/, '');
    const html = PdfExporter.buildHtml(content, theme, baseName, isCsv);

    const tmpDir = os.tmpdir();
    const tmpFile = path.join(tmpDir, `dark-md-export-${Date.now()}.html`);
    fs.writeFileSync(tmpFile, html, 'utf8');

    const uri = vscode.Uri.file(tmpFile);
    await vscode.env.openExternal(uri);

    vscode.window.showInformationMessage(
      `Opened ${selectedMode} export in browser. The print dialog should appear — choose Save as PDF.`,
      'OK'
    );
  }

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
          description: 'Fully dark black (#0d1117) with blue accents',
          mode: 'dark' as ExportMode
        },
        {
          label: 'Light',
          description: 'White background for printing / sharing',
          mode: 'light' as ExportMode
        }
      ],
      {
        placeHolder: 'Export PDF in which mode?',
        title: 'Export Mode'
      }
    );

    return pick?.mode;
  }

  private static resolveTheme(
    mode: ExportMode,
    config: vscode.WorkspaceConfiguration
  ): ExportTheme {
    const base = mode === 'light' ? LIGHT_THEME : DARK_THEME;
    const fontFamily = config.get<string>(
      'theme.fontFamily',
      "'Segoe UI', system-ui, sans-serif"
    );
    const fontSize = config.get<number>('theme.fontSize', 16);

    // For dark mode, honor custom colors when they look like overrides of the dark defaults.
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

  private static buildHtml(
    content: string,
    theme: ExportTheme,
    title: string,
    isCsv: boolean
  ): string {
    const escapedContent = content
      .replace(/\\/g, '\\\\')
      .replace(/`/g, '\\`')
      .replace(/\$/g, '\\$');

    const t = theme;

    return `<!DOCTYPE html>
<html lang="en" data-export-mode="${t.mode}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      background: ${t.background};
      color: ${t.foreground};
      font-family: ${t.fontFamily};
      font-size: ${t.fontSize}px;
      line-height: 1.7;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
      color-adjust: exact;
    }
    body {
      padding: 48px;
      max-width: 860px;
      margin: 0 auto;
    }
    @media print {
      html, body {
        background: ${t.background} !important;
        color: ${t.foreground} !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
        color-adjust: exact !important;
      }
      body { padding: 0; max-width: 100%; }
      @page { margin: 16mm; }
    }
    h1, h2, h3, h4, h5, h6 {
      color: ${t.heading};
      margin: 1.5em 0 0.5em;
      line-height: 1.3;
      font-weight: 600;
      letter-spacing: -0.01em;
    }
    h1 { font-size: 2em; border-bottom: 1px solid ${t.border}; padding-bottom: 0.3em; }
    h2 { font-size: 1.5em; border-bottom: 1px solid ${t.border}; padding-bottom: 0.3em; }
    h3 { font-size: 1.25em; }
    h4 { font-size: 1.05em; }
    h5 { font-size: 0.95em; color: ${t.muted}; }
    h6 { font-size: 0.875em; color: ${t.muted}; }
    p { margin: 0.75em 0; }
    strong { color: ${t.heading}; font-weight: 600; }
    a { color: ${t.accent}; text-decoration: none; }
    a:hover { text-decoration: underline; }
    code {
      font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
      font-size: 0.875em;
      background: ${t.codeBg};
      color: ${t.codeFg};
      padding: 0.2em 0.4em;
      border-radius: 4px;
      border: 1px solid ${t.border};
    }
    pre {
      background: ${t.codeBg};
      border: 1px solid ${t.border};
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
      color: ${t.codeFg};
    }
    blockquote {
      border-left: 4px solid ${t.quoteBorder};
      margin: 1em 0;
      padding: 0.5em 1.2em;
      color: ${t.muted};
      background: ${t.blockquoteBg};
      border-radius: 0 6px 6px 0;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      margin: 1em 0;
      font-size: 0.95em;
      border: 1px solid ${t.border};
      border-radius: 6px;
      overflow: hidden;
    }
    th, td {
      border: 1px solid ${t.border};
      padding: 0.6em 1em;
      text-align: left;
    }
    th {
      background: ${t.thBg};
      color: ${t.heading};
      font-weight: 600;
      font-size: 0.9em;
      letter-spacing: 0.02em;
      text-transform: uppercase;
    }
    tr:nth-child(even) td { background: ${t.rowAlt}; }
    img { max-width: 100%; border-radius: 6px; border: 1px solid ${t.border}; }
    hr { border: none; border-top: 1px solid ${t.border}; margin: 2em 0; }
    ul, ol { margin: 0.75em 0 0.75em 1.5em; }
    li { margin: 0.3em 0; }
    .mermaid {
      text-align: center;
      margin: 1.5em 0;
      background: ${t.codeBg};
      border: 1px solid ${t.border};
      border-radius: 8px;
      padding: 1em;
      overflow-x: auto;
    }
    .mermaid svg { max-width: 100%; }
    .csv-meta { color: ${t.muted}; font-size: 0.85em; margin-top: 1em; }
    #status {
      position: fixed;
      top: 12px;
      right: 12px;
      background: ${t.codeBg};
      color: ${t.muted};
      border: 1px solid ${t.border};
      border-radius: 6px;
      padding: 6px 12px;
      font-size: 13px;
      z-index: 10;
    }
    @media print { #status { display: none !important; } }
  </style>
</head>
<body>
  <div id="status">Preparing export…</div>
  <div id="preview-content"></div>
  <script src="https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js"></script>
  <script>
    (function() {
      const content = \`${escapedContent}\`;
      const isCsv = ${isCsv ? 'true' : 'false'};
      const statusEl = document.getElementById('status');
      const previewEl = document.getElementById('preview-content');

      function escapeHtml(str) {
        return String(str)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');
      }

      function parseCsv(text) {
        const rows = [];
        const lines = text.split(/\\r?\\n/);
        for (const line of lines) {
          if (line.trim() === '') continue;
          const cells = [];
          let cur = '', inQuote = false;
          for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') {
              if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
              else { inQuote = !inQuote; }
            } else if (ch === ',' && !inQuote) {
              cells.push(cur); cur = '';
            } else {
              cur += ch;
            }
          }
          cells.push(cur);
          rows.push(cells);
        }
        return rows;
      }

      function renderCsv(text) {
        const rows = parseCsv(text);
        if (rows.length === 0) {
          previewEl.innerHTML = '<p style="color:${t.muted}">Empty CSV</p>';
          return;
        }
        const headers = rows[0];
        const body = rows.slice(1);
        let html = '<div style="overflow-x:auto"><table><thead><tr>';
        headers.forEach(h => { html += '<th>' + escapeHtml(h.trim()) + '</th>'; });
        html += '</tr></thead><tbody>';
        body.forEach(row => {
          html += '<tr>';
          headers.forEach((_, i) => {
            html += '<td>' + escapeHtml((row[i] || '').trim()) + '</td>';
          });
          html += '</tr>';
        });
        html += '</tbody></table></div>';
        html += '<p class="csv-meta">' + body.length + ' row' + (body.length !== 1 ? 's' : '') +
          ' × ' + headers.length + ' column' + (headers.length !== 1 ? 's' : '') + '</p>';
        previewEl.innerHTML = html;
      }

      async function renderMarkdown(markdown) {
        if (typeof mermaid !== 'undefined') {
          mermaid.initialize({
            startOnLoad: false,
            theme: '${t.mermaidTheme}',
            securityLevel: 'loose',
            themeVariables: {
              background: '${t.background}',
              mainBkg: '${t.mermaidPrimary}',
              primaryColor: '${t.mermaidPrimary}',
              primaryTextColor: '${t.foreground}',
              primaryBorderColor: '${t.mermaidBorder}',
              lineColor: '${t.accent}',
              secondaryColor: '${t.mermaidSecondary}',
              tertiaryColor: '${t.background}',
              edgeLabelBackground: '${t.mermaidSecondary}',
              clusterBkg: '${t.mermaidSecondary}',
              titleColor: '${t.heading}',
              nodeBorder: '${t.mermaidBorder}',
              nodeTextColor: '${t.foreground}',
              fontFamily: ${JSON.stringify(t.fontFamily)}
            }
          });
        }

        marked.setOptions({ breaks: true, gfm: true });

        const mermaidBlocks = [];
        let idx = 0;
        const processed = markdown.replace(/\`\`\`mermaid\\n([\\s\\S]*?)\`\`\`/g, function(_, diagram) {
          const placeholder = 'MERMAID_PLACEHOLDER_' + (idx++);
          mermaidBlocks.push({ placeholder: placeholder, diagram: diagram.trim() });
          return '\`\`\`\\n' + placeholder + '\\n\`\`\`';
        });

        let html = marked.parse(processed);

        mermaidBlocks.forEach(function(block, i) {
          const encoded = btoa(unescape(encodeURIComponent(block.diagram)));
          const div = '<div class="mermaid" id="mermaid-' + i + '" data-diagram="' + encoded + '"></div>';
          html = html.replace(
            new RegExp('<pre><code[^>]*>' + block.placeholder + '[\\\\s\\\\S]*?</code></pre>', 'g'),
            div
          );
          html = html.replace(
            new RegExp('<code[^>]*>' + block.placeholder + '[\\\\s\\\\S]*?</code>', 'g'),
            div
          );
        });

        previewEl.innerHTML = html;

        if (mermaidBlocks.length > 0 && typeof mermaid !== 'undefined') {
          const diagrams = previewEl.querySelectorAll('.mermaid[data-diagram]');
          let counter = 0;
          for (const el of diagrams) {
            try {
              const encoded = el.getAttribute('data-diagram');
              const diagram = decodeURIComponent(escape(atob(encoded)));
              const id = 'mmd-svg-' + Date.now() + '-' + (counter++);
              const result = await mermaid.render(id, diagram);
              el.innerHTML = result.svg;
              el.removeAttribute('data-diagram');
            } catch (err) {
              el.innerHTML = '<pre style="color:${t.errorColor};padding:1em">Mermaid error: ' +
                escapeHtml(err.message || String(err)) + '</pre>';
            }
          }
        }
      }

      function triggerPrint() {
        statusEl.textContent = 'Opening print dialog…';
        setTimeout(function() {
          statusEl.style.display = 'none';
          window.print();
        }, 250);
      }

      async function run() {
        try {
          if (isCsv) {
            renderCsv(content);
          } else if (typeof marked === 'undefined') {
            previewEl.innerHTML = '<p style="color:${t.errorColor}">Failed to load markdown renderer (CDN blocked?). Check your network and try again.</p>';
            statusEl.textContent = 'Export failed';
            return;
          } else {
            await renderMarkdown(content);
          }
          statusEl.textContent = 'Ready — use Save as PDF in the print dialog';
          triggerPrint();
        } catch (err) {
          statusEl.textContent = 'Export failed';
          previewEl.innerHTML = '<p style="color:${t.errorColor}">Export error: ' +
            escapeHtml(err.message || String(err)) + '</p>';
        }
      }

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', run);
      } else {
        run();
      }
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

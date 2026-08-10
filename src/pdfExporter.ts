import * as vscode from 'vscode';
import * as path from 'path';

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

/** Near-black look matching Cursor Dark High Contrast. */
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
  /**
   * Export via an in-editor webview print dialog.
   * On any failure, writes a .pdf next to the source file.
   */
  static async export(
    _webview: vscode.Webview,
    document: vscode.TextDocument,
    context: vscode.ExtensionContext,
    mode?: ExportMode
  ): Promise<void> {
    const selectedMode = mode ?? (await PdfExporter.pickMode());
    if (!selectedMode) {
      return;
    }

    const content = document.getText();
    const isCsv =
      document.languageId === 'csv' || document.fileName.toLowerCase().endsWith('.csv');
    const baseName = path.basename(document.fileName).replace(/\.[^.]+$/, '');

    try {
      const config = vscode.workspace.getConfiguration('darkMarkdown');
      const theme = PdfExporter.resolveTheme(selectedMode, config);

      const panel = vscode.window.createWebviewPanel(
        'darkMarkdownExport',
        `Export PDF (${selectedMode}): ${baseName}`,
        vscode.ViewColumn.Beside,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')]
        }
      );

      const nonce = getNonce();
      panel.webview.html = PdfExporter.buildHtml(
        content,
        theme,
        baseName,
        isCsv,
        panel.webview,
        nonce
      );

      panel.webview.onDidReceiveMessage(async (msg: { type?: string; message?: string }) => {
        if (msg?.type === 'exportError') {
          try {
            await PdfExporter.saveFallbackPdf(document, content);
          } catch (saveErr) {
            const detail = saveErr instanceof Error ? saveErr.message : String(saveErr);
            vscode.window.showErrorMessage(`Export failed and could not save PDF: ${detail}`);
          }
        }
      });

      vscode.window.showInformationMessage(
        `Export ready (${selectedMode}). Use Print → Save as PDF (or the Print button). If that fails, a PDF is saved beside the file.`
      );
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      try {
        const saved = await PdfExporter.saveFallbackPdf(document, content);
        vscode.window.showWarningMessage(
          `Export UI failed (${detail}). Saved PDF instead: ${saved}`
        );
      } catch (saveErr) {
        const saveDetail = saveErr instanceof Error ? saveErr.message : String(saveErr);
        vscode.window.showErrorMessage(
          `Export failed (${detail}) and PDF save failed (${saveDetail}).`
        );
      }
    }
  }

  /** Write a simple text PDF next to the source document (same basename, .pdf). */
  static async saveFallbackPdf(
    document: vscode.TextDocument,
    content: string
  ): Promise<string> {
    const baseName = path.basename(document.fileName).replace(/\.[^.]+$/, '');
    const pdfUri = vscode.Uri.joinPath(document.uri, '..', `${baseName}.pdf`);
    const bytes = buildSimplePdf(content);
    await vscode.workspace.fs.writeFile(pdfUri, bytes);
    vscode.window.showInformationMessage(`Saved PDF: ${pdfUri.fsPath}`);
    return pdfUri.fsPath;
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
          description: 'Near-black (#0a0a0a) matching Cursor Dark High Contrast',
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
    isCsv: boolean,
    webview: vscode.Webview,
    nonce: string
  ): string {
    const escapedContent = content
      .replace(/\\/g, '\\\\')
      .replace(/`/g, '\\`')
      .replace(/\$/g, '\\$');

    const t = theme;
    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}' https://cdn.jsdelivr.net`,
      `img-src ${webview.cspSource} https: data:`,
      `font-src ${webview.cspSource} https: data:`,
      `connect-src https://cdn.jsdelivr.net`
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en" data-export-mode="${t.mode}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
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
    #export-bar {
      position: sticky;
      top: 0;
      z-index: 20;
      display: flex;
      gap: 8px;
      align-items: center;
      margin: -48px -48px 24px;
      padding: 10px 16px;
      background: ${t.codeBg};
      border-bottom: 1px solid ${t.border};
    }
    #export-bar button {
      padding: 6px 12px;
      border: 1px solid ${t.border};
      border-radius: 6px;
      background: transparent;
      color: ${t.foreground};
      font: inherit;
      font-size: 13px;
      cursor: pointer;
    }
    #export-bar button.primary {
      background: ${t.accent};
      border-color: ${t.accent};
      color: ${t.mode === 'light' ? '#ffffff' : '#0a0a0a'};
      font-weight: 600;
    }
    #export-bar .hint {
      color: ${t.muted};
      font-size: 12px;
    }
    @media print {
      #export-bar, #status { display: none !important; }
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
      bottom: 12px;
      right: 12px;
      background: ${t.codeBg};
      color: ${t.muted};
      border: 1px solid ${t.border};
      border-radius: 6px;
      padding: 6px 12px;
      font-size: 13px;
      z-index: 10;
    }
  </style>
</head>
<body>
  <div id="export-bar">
    <button class="primary" id="btn-print" type="button">Print / Save as PDF</button>
    <span class="hint">Choose “Save as PDF” as the destination in the print dialog.</span>
  </div>
  <div id="status">Preparing export…</div>
  <div id="preview-content"></div>
  <script nonce="${nonce}" src="https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js"></script>
  <script nonce="${nonce}" src="https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js"></script>
  <script nonce="${nonce}">
    (function() {
      const vscodeApi = acquireVsCodeApi();
      const content = \`${escapedContent}\`;
      const isCsv = ${isCsv ? 'true' : 'false'};
      const statusEl = document.getElementById('status');
      const previewEl = document.getElementById('preview-content');
      const btnPrint = document.getElementById('btn-print');

      btnPrint.addEventListener('click', function() { window.print(); });

      function reportError(err) {
        const message = (err && err.message) ? err.message : String(err || 'Unknown export error');
        statusEl.style.display = '';
        statusEl.textContent = 'Export error — saving PDF beside source file…';
        vscodeApi.postMessage({ type: 'exportError', message: message });
      }

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
        }, 400);
      }

      async function run() {
        try {
          if (isCsv) {
            renderCsv(content);
          } else if (typeof marked === 'undefined') {
            previewEl.innerHTML = '<p style="color:${t.errorColor}">Failed to load markdown renderer (CDN blocked?). Saving PDF beside the source file…</p>';
            statusEl.textContent = 'Export failed — saving PDF…';
            reportError(new Error('Failed to load markdown renderer (CDN blocked?)'));
            return;
          } else {
            await renderMarkdown(content);
          }
          statusEl.textContent = 'Ready — Print → Save as PDF';
          triggerPrint();
        } catch (err) {
          statusEl.textContent = 'Export failed — saving PDF…';
          previewEl.innerHTML = '<p style="color:${t.errorColor}">Export error: ' +
            escapeHtml(err.message || String(err)) + '</p>';
          reportError(err);
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

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

/** Minimal multi-page text PDF (Helvetica / WinAnsi). */
function buildSimplePdf(text: string): Uint8Array {
  const escaped = pdfEscape(toWinAnsi(text));
  const rawLines = escaped.split(/\r?\n/);
  const lines: string[] = [];
  const maxChars = 95;
  for (const line of rawLines) {
    if (line.length <= maxChars) {
      lines.push(line);
      continue;
    }
    for (let i = 0; i < line.length; i += maxChars) {
      lines.push(line.slice(i, i + maxChars));
    }
  }
  if (lines.length === 0) {
    lines.push('');
  }

  const linesPerPage = 60;
  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += linesPerPage) {
    pages.push(lines.slice(i, i + linesPerPage));
  }

  const objs: Array<string | null> = [];
  const push = (body: string): number => {
    objs.push(body);
    return objs.length; // 1-based id
  };

  const font = push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const contentObjIds: number[] = [];
  for (const pageLines of pages) {
    let stream = 'BT /F1 10 Tf 14 TL 50 782 Td\n';
    pageLines.forEach((line, idx) => {
      if (idx === 0) {
        stream += `(${line}) Tj\n`;
      } else {
        stream += `T* (${line}) Tj\n`;
      }
    });
    stream += 'ET';
    contentObjIds.push(
      push(`<< /Length ${Buffer.byteLength(stream, 'binary')} >>\nstream\n${stream}\nendstream`)
    );
  }

  const pagesId = push(''); // placeholder
  const pageObjIds: number[] = [];
  for (const contentId of contentObjIds) {
    pageObjIds.push(
      push(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`
      )
    );
  }
  objs[pagesId - 1] =
    `<< /Type /Pages /Kids [${pageObjIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageObjIds.length} >>`;

  const catalog = push(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (let i = 0; i < objs.length; i++) {
    offsets.push(Buffer.byteLength(pdf, 'binary'));
    pdf += `${i + 1} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xrefStart = Buffer.byteLength(pdf, 'binary');
  pdf += `xref\n0 ${objs.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i <= objs.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return new Uint8Array(Buffer.from(pdf, 'binary'));
}

function toWinAnsi(text: string): string {
  return Array.from(text)
    .map((ch) => {
      const code = ch.charCodeAt(0);
      if (ch === '\n' || ch === '\r' || ch === '\t') {
        return ch;
      }
      if (code >= 32 && code <= 126) {
        return ch;
      }
      if (ch === '•') return '*';
      if (ch === '–' || ch === '—') return '-';
      if (ch === '“' || ch === '”' || ch === '„') return '"';
      if (ch === '‘' || ch === '’') return "'";
      if (ch === '…') return '...';
      if (code > 255) {
        return '?';
      }
      return ch;
    })
    .join('');
}

function pdfEscape(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

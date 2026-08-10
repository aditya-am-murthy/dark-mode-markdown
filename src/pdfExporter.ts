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

type WebviewMsg =
  | { type: 'pdfReady'; base64: string }
  | { type: 'pdfError'; message: string }
  | { type: 'status'; message: string };

export class PdfExporter {
  /**
   * Render markdown/CSV to styled HTML (images + Mermaid), rasterize to PDF
   * in the webview, then write <basename>.pdf beside the source document.
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
    const baseName =
      path.basename(document.fileName).replace(/\.[^.]+$/, '') || 'export';

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

    let settled = false;
    const finish = async (msg: WebviewMsg): Promise<void> => {
      if (msg.type === 'status') {
        return;
      }
      if (settled) {
        return;
      }
      settled = true;

      if (msg.type === 'pdfError') {
        vscode.window.showErrorMessage(`PDF export failed: ${msg.message}`);
        return;
      }

      try {
        const saved = await PdfExporter.writePdfBytes(document, baseName, msg.base64);
        vscode.window.showInformationMessage(`Saved rendered PDF: ${saved}`);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Could not write PDF: ${detail}`);
      }
    };

    panel.webview.onDidReceiveMessage((msg: WebviewMsg) => {
      void finish(msg);
    });

    const nonce = getNonce();
    panel.webview.html = PdfExporter.buildHtml(
      content,
      theme,
      baseName,
      isCsv,
      panel.webview,
      nonce
    );
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
      `img-src ${webview.cspSource} https: http: data: blob:`,
      `font-src ${webview.cspSource} https: data:`,
      `connect-src https://cdn.jsdelivr.net https: data: blob:`
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
    }
    #export-bar {
      position: sticky;
      top: 0;
      z-index: 20;
      display: flex;
      gap: 8px;
      align-items: center;
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
    #export-bar .hint { color: ${t.muted}; font-size: 12px; }
    #capture {
      width: 800px;
      max-width: 100%;
      margin: 0 auto;
      padding: 32px 24px 48px;
      background: ${t.background};
      color: ${t.foreground};
    }
    #capture img,
    #capture video,
    #capture canvas,
    #capture .mermaid,
    #capture .mermaid svg,
    #capture table {
      max-width: 100% !important;
      height: auto !important;
    }
    #capture .mermaid {
      text-align: center;
      margin: 1.5em 0;
      background: ${t.codeBg};
      border: 1px solid ${t.border};
      border-radius: 8px;
      padding: 1em;
      overflow: visible;
    }
    #capture .mermaid svg {
      width: 100% !important;
      max-width: 100% !important;
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
    h5, h6 { font-size: 0.95em; color: ${t.muted}; }
    p { margin: 0.75em 0; }
    strong { color: ${t.heading}; font-weight: 600; }
    a { color: ${t.accent}; text-decoration: none; }
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
    pre code { background: none; border: none; padding: 0; font-size: 0.9em; color: ${t.codeFg}; }
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
    }
    th, td { border: 1px solid ${t.border}; padding: 0.6em 1em; text-align: left; }
    th {
      background: ${t.thBg};
      color: ${t.heading};
      font-weight: 600;
      font-size: 0.9em;
      letter-spacing: 0.02em;
      text-transform: uppercase;
    }
    tr:nth-child(even) td { background: ${t.rowAlt}; }
    hr { border: none; border-top: 1px solid ${t.border}; margin: 2em 0; }
    ul, ol { margin: 0.75em 0 0.75em 1.5em; }
    li { margin: 0.3em 0; }
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
    <button class="primary" id="btn-save" type="button">Generate PDF</button>
    <span class="hint">Captures the rendered HTML (images + diagrams) and saves beside the document.</span>
  </div>
  <div id="status">Rendering…</div>
  <div id="capture"></div>
  <script nonce="${nonce}" src="https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js"></script>
  <script nonce="${nonce}" src="https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js"></script>
  <script nonce="${nonce}" src="https://cdn.jsdelivr.net/npm/html2pdf.js@0.10.2/dist/html2pdf.bundle.min.js"></script>
  <script nonce="${nonce}">
    (function() {
      const vscodeApi = acquireVsCodeApi();
      const content = \`${escapedContent}\`;
      const isCsv = ${isCsv ? 'true' : 'false'};
      const statusEl = document.getElementById('status');
      const captureEl = document.getElementById('capture');
      const btnSave = document.getElementById('btn-save');
      let busy = false;

      function setStatus(message) {
        statusEl.textContent = message;
        vscodeApi.postMessage({ type: 'status', message: message });
      }

      function escapeHtml(str) {
        return String(str)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');
      }

      function fitMedia() {
        captureEl.querySelectorAll('img, svg, canvas, video, table, .mermaid').forEach(function(el) {
          el.style.maxWidth = '100%';
          el.style.height = 'auto';
          el.style.boxSizing = 'border-box';
        });
        captureEl.querySelectorAll('.mermaid svg').forEach(function(svg) {
          svg.setAttribute('width', '100%');
          svg.removeAttribute('height');
          svg.style.width = '100%';
          svg.style.maxWidth = '100%';
          svg.style.height = 'auto';
        });
      }

      function waitForImages() {
        const images = Array.prototype.slice.call(captureEl.querySelectorAll('img'));
        if (images.length === 0) {
          return Promise.resolve();
        }
        return Promise.all(images.map(function(img) {
          if (img.complete) {
            return Promise.resolve();
          }
          return new Promise(function(resolve) {
            img.onload = img.onerror = function() { resolve(); };
          });
        }));
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
          captureEl.innerHTML = '<p style="color:${t.muted}">Empty CSV</p>';
          return;
        }
        const headers = rows[0];
        const body = rows.slice(1);
        let html = '<div style="overflow-x:auto"><table><thead><tr>';
        headers.forEach(function(h) { html += '<th>' + escapeHtml(h.trim()) + '</th>'; });
        html += '</tr></thead><tbody>';
        body.forEach(function(row) {
          html += '<tr>';
          headers.forEach(function(_, i) {
            html += '<td>' + escapeHtml((row[i] || '').trim()) + '</td>';
          });
          html += '</tr>';
        });
        html += '</tbody></table></div>';
        html += '<p class="csv-meta">' + body.length + ' row' + (body.length !== 1 ? 's' : '') +
          ' × ' + headers.length + ' column' + (headers.length !== 1 ? 's' : '') + '</p>';
        captureEl.innerHTML = html;
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

        captureEl.innerHTML = html;

        if (mermaidBlocks.length > 0 && typeof mermaid !== 'undefined') {
          const diagrams = captureEl.querySelectorAll('.mermaid[data-diagram]');
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

      async function generatePdf() {
        if (busy) return;
        busy = true;
        btnSave.disabled = true;
        try {
          if (typeof html2pdf === 'undefined') {
            throw new Error('html2pdf failed to load (CDN blocked?)');
          }
          setStatus('Waiting for images…');
          await waitForImages();
          fitMedia();
          // Let layout settle after SVG sizing
          await new Promise(function(r) { setTimeout(r, 200); });

          setStatus('Generating PDF from rendered HTML…');
          const opt = {
            margin: [10, 10, 10, 10],
            filename: ${JSON.stringify(title + '.pdf')},
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: {
              scale: 2,
              useCORS: true,
              allowTaint: true,
              backgroundColor: '${t.background}',
              windowWidth: 800
            },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
            pagebreak: { mode: ['css', 'legacy'] }
          };

          const worker = html2pdf().set(opt).from(captureEl);
          const pdf = await worker.toPdf().get('pdf');
          const dataUri = pdf.output('datauristring');
          const base64 = dataUri.split(',')[1];
          if (!base64) {
            throw new Error('PDF generation returned empty data');
          }
          setStatus('Saving PDF beside document…');
          vscodeApi.postMessage({ type: 'pdfReady', base64: base64 });
          setStatus('PDF sent for save');
        } catch (err) {
          const message = (err && err.message) ? err.message : String(err);
          setStatus('PDF failed');
          vscodeApi.postMessage({ type: 'pdfError', message: message });
        } finally {
          busy = false;
          btnSave.disabled = false;
        }
      }

      btnSave.addEventListener('click', function() { generatePdf(); });

      async function run() {
        try {
          setStatus('Rendering preview…');
          if (isCsv) {
            renderCsv(content);
          } else if (typeof marked === 'undefined') {
            throw new Error('marked failed to load (CDN blocked?)');
          } else {
            await renderMarkdown(content);
          }
          fitMedia();
          setStatus('Creating PDF…');
          await generatePdf();
        } catch (err) {
          const message = (err && err.message) ? err.message : String(err);
          captureEl.innerHTML = '<p style="color:${t.errorColor}">' + escapeHtml(message) + '</p>';
          setStatus('Render failed');
          vscodeApi.postMessage({ type: 'pdfError', message: message });
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

function dirnameUri(uri: vscode.Uri): vscode.Uri {
  const normalized = uri.path.replace(/\\/g, '/');
  const idx = normalized.lastIndexOf('/');
  const dirPath = idx <= 0 ? '/' : normalized.slice(0, idx);
  return uri.with({ path: dirPath });
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

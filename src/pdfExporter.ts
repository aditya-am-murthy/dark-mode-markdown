import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

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
    const pdfUri = await PdfExporter.pdfUriFor(document, baseName);
    const bytes = Buffer.from(base64, 'base64');
    if (bytes.length < 2000 || bytes.subarray(0, 4).toString('utf8') !== '%PDF') {
      throw new Error('Generated PDF was empty or invalid');
    }
    await vscode.workspace.fs.writeFile(pdfUri, bytes);
    return labelFor(pdfUri);
  }

  static async pdfUriFor(
    document: vscode.TextDocument,
    baseName: string
  ): Promise<vscode.Uri> {
    if (document.uri.scheme === 'untitled') {
      const picked = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(`${baseName}.pdf`),
        filters: { PDF: ['pdf'] },
        saveLabel: 'Save PDF'
      });
      if (!picked) {
        throw new Error('Save cancelled');
      }
      return picked;
    }
    return vscode.Uri.joinPath(dirnameUri(document.uri), `${baseName}.pdf`);
  }

  /**
   * Preferred path: render HTML then print with Chrome/Chromium.
   * Uses puppeteer-core when present (dev/local), otherwise Chrome CLI.
   * Returns saved path, or null if no browser binary is available.
   */
  static async exportWithChrome(
    document: vscode.TextDocument,
    mode: ExportMode
  ): Promise<string | null> {
    const chrome = await findChrome();
    if (!chrome) {
      return null;
    }

    const theme = PdfExporter.resolveThemePublic(mode);
    const content = document.getText();
    const isCsv =
      document.languageId === 'csv' || document.fileName.toLowerCase().endsWith('.csv');
    const baseName =
      path.basename(document.fileName).replace(/\.[^.]+$/, '') || 'export';
    const pdfUri = await PdfExporter.pdfUriFor(document, baseName);

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dark-md-pdf-'));
    const htmlPath = path.join(tmpDir, `${baseName}.html`);
    const tmpPdfPath = path.join(tmpDir, `${baseName}.pdf`);
    const html = buildPrintHtml(content, theme, isCsv);
    fs.writeFileSync(htmlPath, html, 'utf8');

    try {
      const printed = await printHtmlToPdf(chrome, htmlPath, tmpPdfPath);
      if (!printed) {
        throw new Error('Browser PDF print failed');
      }

      const bytes = fs.readFileSync(tmpPdfPath);
      if (bytes.length < 2000 || bytes.subarray(0, 4).toString('utf8') !== '%PDF') {
        throw new Error('Chrome produced an empty PDF');
      }
      await vscode.workspace.fs.writeFile(pdfUri, bytes);
      return labelFor(pdfUri);
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    }
  }
}

async function printHtmlToPdf(
  chrome: string,
  htmlPath: string,
  pdfPath: string
): Promise<boolean> {
  // 1) puppeteer-core if installed (waits for mermaid)
  try {
    const puppeteerPath = require.resolve('puppeteer-core');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const puppeteer = require(puppeteerPath) as typeof import('puppeteer-core');
    const browser = await puppeteer.launch({
      executablePath: chrome,
      headless: true,
      args: ['--no-sandbox', '--disable-gpu']
    });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 820, height: 1200, deviceScaleFactor: 1 });
      await page.goto(`file://${htmlPath}`, {
        waitUntil: 'networkidle0',
        timeout: 120000
      });
      await page.waitForFunction('window.__READY__ === true || window.__ERROR__', {
        timeout: 120000
      });
      const renderError = (await page.evaluate(
        'window.__ERROR__ || null'
      )) as string | null;
      if (renderError) {
        throw new Error(String(renderError));
      }
      const textLen = (await page.evaluate(
        'document.getElementById("capture") ? document.getElementById("capture").innerText.length : 0'
      )) as number;
      if (textLen < 20) {
        throw new Error('Rendered HTML was empty');
      }
      await page.pdf({
        path: pdfPath,
        format: 'A4',
        printBackground: true,
        margin: { top: '14mm', right: '14mm', bottom: '14mm', left: '14mm' }
      });
      return true;
    } finally {
      await browser.close();
    }
  } catch {
    // 2) Chrome CLI fallback
    await execFileAsync(
      chrome,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-pdf-header-footer',
        '--virtual-time-budget=30000',
        `--print-to-pdf=${pdfPath}`,
        `file://${htmlPath}`
      ],
      { timeout: 120000 }
    );
    return fs.existsSync(pdfPath);
  }
}

function buildPrintHtml(
  content: string,
  theme: ExportTheme,
  isCsv: boolean
): string {
  const escaped = JSON.stringify(content);
  const t = theme;
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <style>
    :root {
      --md-bg: ${t.background};
      --md-fg: ${t.foreground};
      --md-accent: ${t.accent};
      --md-code-bg: ${t.codeBg};
      --md-code-fg: ${t.codeFg};
      --md-border: ${t.border};
      --md-heading: ${t.heading};
      --md-muted: ${t.muted};
      --md-quote-border: ${t.quoteBorder};
      --md-th-bg: ${t.thBg};
      --md-blockquote-bg: ${t.blockquoteBg};
      --md-font: ${t.fontFamily};
    }
    html, body {
      margin: 0;
      padding: 0;
      background: ${t.background};
      color: ${t.foreground};
      font-family: ${t.fontFamily};
      font-size: ${Math.max(12, t.fontSize - 2)}px;
      line-height: 1.75;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .pdf-capture {
      box-sizing: border-box;
      max-width: 680px;
      margin: 0 auto;
      padding: 8px 4px 24px;
      background: ${t.background};
      color: ${t.foreground};
    }
    .pdf-capture * { box-sizing: border-box; max-width: 100%; }
    .pdf-capture h1, .pdf-capture h2, .pdf-capture h3, .pdf-capture h4, .pdf-capture h5, .pdf-capture h6 {
      color: ${t.heading}; line-height: 1.25; font-weight: 700; letter-spacing: -0.02em;
    }
    .pdf-capture h1 { font-size: 1.85em; margin: 0 0 0.9em; padding-bottom: 0.4em; border-bottom: 2px solid ${t.border}; }
    .pdf-capture h2 { font-size: 1.4em; margin: 2.1em 0 0.8em; padding-bottom: 0.35em; border-bottom: 1px solid ${t.border}; }
    .pdf-capture h3 { font-size: 1.18em; margin: 1.85em 0 0.7em; }
    .pdf-capture h4 { font-size: 1.05em; margin: 1.6em 0 0.6em; }
    .pdf-capture h5, .pdf-capture h6 { font-size: 0.92em; margin: 1.4em 0 0.5em; color: ${t.muted}; text-transform: uppercase; letter-spacing: 0.04em; }
    .pdf-capture p { margin: 0 0 1em; line-height: 1.75; overflow-wrap: anywhere; }
    .pdf-capture ul, .pdf-capture ol { margin: 0 0 1.15em 1.35em; padding: 0; }
    .pdf-capture li { margin: 0.45em 0; line-height: 1.65; }
    .pdf-capture table { width: 100%; border-collapse: collapse; margin: 1.15em 0 1.4em; font-size: 0.92em; }
    .pdf-capture th, .pdf-capture td { border: 1px solid ${t.border}; padding: 0.55em 0.75em; text-align: left; vertical-align: top; }
    .pdf-capture th { background: ${t.thBg}; color: ${t.heading}; font-weight: 700; }
    .pdf-capture pre { margin: 1.15em 0 1.35em; padding: 1em; background: ${t.codeBg}; border: 1px solid ${t.border}; border-radius: 8px; overflow-x: auto; font-size: 0.86em; }
    .pdf-capture code { font-family: ui-monospace, monospace; font-size: 0.9em; background: ${t.codeBg}; color: ${t.codeFg}; padding: 0.15em 0.35em; border-radius: 4px; border: 1px solid ${t.border}; }
    .pdf-capture pre code { border: none; padding: 0; background: none; }
    .pdf-capture blockquote { margin: 1.25em 0; padding: 0.65em 1em; border-left: 4px solid ${t.quoteBorder}; color: ${t.muted}; background: ${t.blockquoteBg}; }
    .pdf-capture hr { border: none; border-top: 1px solid ${t.border}; margin: 2em 0; }
    .pdf-capture img { display: block; max-width: 100%; height: auto; margin: 1.25em auto; }
    .pdf-capture .mermaid { margin: 1.5em 0; padding: 0.75em; background: ${t.codeBg}; border: 1px solid ${t.border}; border-radius: 8px; text-align: center; }
    .pdf-capture .mermaid svg { max-width: 100%; height: auto; }
    .pdf-capture strong { color: ${t.heading}; font-weight: 700; }
    .pdf-capture a { color: ${t.accent}; text-decoration: none; }
    @page { margin: 14mm; }
  </style>
</head>
<body>
  <div id="capture" class="pdf-capture"></div>
  <script src="https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js"></script>
  <script>
    window.__READY__ = false;
    window.__ERROR__ = null;
    (async function () {
      try {
        const content = ${escaped};
        const isCsv = ${isCsv ? 'true' : 'false'};
        const capture = document.getElementById('capture');
        function escapeHtml(str) {
          return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        }
        if (isCsv) {
          const rows = [];
          content.split(/\\r?\\n/).forEach(function(line) {
            if (!line.trim()) return;
            const cells = []; let cur = ''; let q = false;
            for (let i = 0; i < line.length; i++) {
              const ch = line[i];
              if (ch === '"') { if (q && line[i+1] === '"') { cur += '"'; i++; } else { q = !q; } }
              else if (ch === ',' && !q) { cells.push(cur); cur = ''; }
              else cur += ch;
            }
            cells.push(cur); rows.push(cells);
          });
          if (!rows.length) { capture.innerHTML = '<p>Empty CSV</p>'; }
          else {
            let html = '<table><thead><tr>';
            rows[0].forEach(function(h){ html += '<th>' + escapeHtml(h.trim()) + '</th>'; });
            html += '</tr></thead><tbody>';
            rows.slice(1).forEach(function(row){
              html += '<tr>';
              rows[0].forEach(function(_, i){ html += '<td>' + escapeHtml((row[i]||'').trim()) + '</td>'; });
              html += '</tr>';
            });
            html += '</tbody></table>';
            capture.innerHTML = html;
          }
        } else {
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
              nodeTextColor: '${t.foreground}'
            }
          });
          marked.setOptions({ breaks: true, gfm: true });
          const mermaidBlocks = [];
          let idx = 0;
          const processed = content.replace(/\`\`\`mermaid\\n([\\s\\S]*?)\`\`\`/g, function(_, diagram) {
            const placeholder = 'MERMAID_PLACEHOLDER_' + (idx++);
            mermaidBlocks.push({ placeholder: placeholder, diagram: diagram.trim() });
            return '\`\`\`\\n' + placeholder + '\\n\`\`\`';
          });
          let html = marked.parse(processed);
          mermaidBlocks.forEach(function(block, i) {
            const encoded = btoa(unescape(encodeURIComponent(block.diagram)));
            const div = '<div class="mermaid" id="mermaid-' + i + '" data-diagram="' + encoded + '"></div>';
            html = html.replace(new RegExp('<pre><code[^>]*>' + block.placeholder + '[\\\\s\\\\S]*?</code></pre>', 'g'), div);
            html = html.replace(new RegExp('<code[^>]*>' + block.placeholder + '[\\\\s\\\\S]*?</code>', 'g'), div);
          });
          capture.innerHTML = html;
          const diagrams = capture.querySelectorAll('.mermaid[data-diagram]');
          let counter = 0;
          for (const el of diagrams) {
            const encoded = el.getAttribute('data-diagram');
            const diagram = decodeURIComponent(escape(atob(encoded)));
            const id = 'mmd-' + Date.now() + '-' + (counter++);
            const result = await mermaid.render(id, diagram);
            el.innerHTML = result.svg;
            el.removeAttribute('data-diagram');
          }
        }
        // Wait for layout/fonts
        await new Promise(function(r){ setTimeout(r, 400); });
        window.__READY__ = true;
      } catch (err) {
        window.__ERROR__ = (err && err.message) ? err.message : String(err);
      }
    })();
  </script>
</body>
</html>`;
}

async function findChrome(): Promise<string | null> {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium'
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {
      // continue
    }
  }

  // PATH lookup
  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    try {
      const { stdout } = await execFileAsync('which', [name]);
      const found = stdout.trim();
      if (found) return found;
    } catch {
      // continue
    }
  }
  return null;
}

function dirnameUri(uri: vscode.Uri): vscode.Uri {
  const normalized = uri.path.replace(/\\/g, '/');
  const idx = normalized.lastIndexOf('/');
  const dirPath = idx <= 0 ? '/' : normalized.slice(0, idx);
  return uri.with({ path: dirPath });
}

function labelFor(uri: vscode.Uri): string {
  return uri.scheme === 'file' ? uri.fsPath : uri.toString(true);
}

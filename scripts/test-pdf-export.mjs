/**
 * Headless PDF smoke test for the sprint markdown testcase.
 * Uses system Chrome via puppeteer-core (print-to-PDF of rendered HTML).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const mdPath = path.join(root, 'testcases', 'ai-ml-ai-team-sprint-next-steps.md');
const outPdf = path.join(root, 'testcases', 'ai-ml-ai-team-sprint-next-steps.pdf');
const outHtml = path.join(root, 'testcases', '_pdf-test-render.html');
const chrome =
  process.env.CHROME_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const LIGHT = {
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
  mermaidTheme: 'default'
};

const md = fs.readFileSync(mdPath, 'utf8');
const escaped = JSON.stringify(md);

const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <style>
    :root {
      --md-bg: ${LIGHT.background};
      --md-fg: ${LIGHT.foreground};
      --md-accent: ${LIGHT.accent};
      --md-code-bg: ${LIGHT.codeBg};
      --md-code-fg: ${LIGHT.codeFg};
      --md-border: ${LIGHT.border};
      --md-heading: ${LIGHT.heading};
      --md-muted: ${LIGHT.muted};
      --md-quote-border: ${LIGHT.quoteBorder};
      --md-th-bg: ${LIGHT.thBg};
      --md-blockquote-bg: rgba(246, 248, 250, 0.8);
      --md-font: 'Segoe UI', system-ui, sans-serif;
    }
    html, body {
      margin: 0;
      padding: 0;
      background: var(--md-bg);
      color: var(--md-fg);
      font-family: var(--md-font);
      font-size: 14px;
      line-height: 1.75;
    }
    .pdf-capture {
      box-sizing: border-box;
      width: 680px;
      max-width: 680px;
      padding: 28px 32px 36px;
      margin: 0 auto;
      background: var(--md-bg);
      color: var(--md-fg);
    }
    .pdf-capture * { box-sizing: border-box; max-width: 100%; }
    .pdf-capture h1, .pdf-capture h2, .pdf-capture h3, .pdf-capture h4 {
      color: var(--md-heading);
      line-height: 1.25;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .pdf-capture h1 {
      font-size: 1.85em;
      margin: 0 0 0.9em;
      padding-bottom: 0.4em;
      border-bottom: 2px solid var(--md-border);
    }
    .pdf-capture h2 {
      font-size: 1.4em;
      margin: 2.1em 0 0.8em;
      padding-bottom: 0.35em;
      border-bottom: 1px solid var(--md-border);
    }
    .pdf-capture h3 { font-size: 1.18em; margin: 1.85em 0 0.7em; }
    .pdf-capture p { margin: 0 0 1em; line-height: 1.75; overflow-wrap: anywhere; }
    .pdf-capture ul, .pdf-capture ol { margin: 0 0 1.15em 1.35em; padding: 0; }
    .pdf-capture li { margin: 0.45em 0; line-height: 1.65; }
    .pdf-capture table { width: 100%; border-collapse: collapse; margin: 1.15em 0 1.4em; font-size: 0.92em; }
    .pdf-capture th, .pdf-capture td { border: 1px solid var(--md-border); padding: 0.55em 0.75em; text-align: left; }
    .pdf-capture th { background: var(--md-th-bg); font-weight: 700; }
    .pdf-capture pre {
      margin: 1.15em 0 1.35em; padding: 1em; background: var(--md-code-bg);
      border: 1px solid var(--md-border); border-radius: 8px; overflow-x: auto; font-size: 0.86em;
    }
    .pdf-capture code {
      font-family: ui-monospace, monospace; font-size: 0.9em; background: var(--md-code-bg);
      padding: 0.15em 0.35em; border-radius: 4px; border: 1px solid var(--md-border);
    }
    .pdf-capture pre code { border: none; padding: 0; background: none; }
    .pdf-capture blockquote {
      margin: 1.25em 0; padding: 0.65em 1em; border-left: 4px solid var(--md-quote-border);
      color: var(--md-muted); background: var(--md-blockquote-bg);
    }
    .pdf-capture hr { border: none; border-top: 1px solid var(--md-border); margin: 2em 0; }
    .pdf-capture img { display: block; max-width: 100%; height: auto; margin: 1.25em auto; }
    .pdf-capture .mermaid {
      margin: 1.5em 0; padding: 0.75em; background: var(--md-code-bg);
      border: 1px solid var(--md-border); border-radius: 8px; text-align: center;
    }
    .pdf-capture .mermaid svg { max-width: 100%; height: auto; }
    .pdf-capture strong { color: var(--md-heading); font-weight: 700; }
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
        const markdown = ${escaped};
        const capture = document.getElementById('capture');
        mermaid.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'loose' });
        marked.setOptions({ breaks: true, gfm: true });

        const mermaidBlocks = [];
        let idx = 0;
        const processed = markdown.replace(/\`\`\`mermaid\\n([\\s\\S]*?)\`\`\`/g, (_, diagram) => {
          const placeholder = 'MERMAID_PLACEHOLDER_' + (idx++);
          mermaidBlocks.push({ placeholder, diagram: diagram.trim() });
          return '\`\`\`\\n' + placeholder + '\\n\`\`\`';
        });

        let html = marked.parse(processed);
        mermaidBlocks.forEach((block, i) => {
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

        // Rasterize SVGs to PNG for stable print
        for (const svg of [...capture.querySelectorAll('svg')]) {
          const rect = svg.getBoundingClientRect();
          const width = Math.max(1, Math.ceil(rect.width || 640));
          const height = Math.max(1, Math.ceil(rect.height || 320));
          const clone = svg.cloneNode(true);
          if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
          clone.setAttribute('width', String(width));
          clone.setAttribute('height', String(height));
          const xml = new XMLSerializer().serializeToString(clone);
          const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
          const img = new Image();
          await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = url; });
          const canvas = document.createElement('canvas');
          canvas.width = width * 2;
          canvas.height = height * 2;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const out = document.createElement('img');
          out.src = canvas.toDataURL('image/png');
          out.style.maxWidth = '100%';
          out.style.width = '100%';
          out.style.height = 'auto';
          out.style.display = 'block';
          svg.replaceWith(out);
        }

        window.__READY__ = true;
      } catch (err) {
        window.__ERROR__ = err && err.message ? err.message : String(err);
      }
    })();
  </script>
</body>
</html>`;

fs.writeFileSync(outHtml, html, 'utf8');
console.log('Wrote', outHtml);

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu']
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 820, height: 1200, deviceScaleFactor: 1 });
  await page.goto('file://' + outHtml, { waitUntil: 'networkidle0', timeout: 120000 });
  await page.waitForFunction('window.__READY__ === true || window.__ERROR__', { timeout: 120000 });
  const err = await page.evaluate(() => window.__ERROR__);
  if (err) {
    throw new Error('Render failed: ' + err);
  }

  const textLen = await page.evaluate(() => document.getElementById('capture').innerText.length);
  const imgCount = await page.evaluate(() => document.querySelectorAll('#capture img').length);
  console.log('Rendered text chars:', textLen, 'images:', imgCount);
  if (textLen < 200) {
    throw new Error('Rendered content too short — likely blank');
  }

  const pdf = await page.pdf({
    path: outPdf,
    format: 'A4',
    printBackground: true,
    margin: { top: '14mm', right: '14mm', bottom: '14mm', left: '14mm' }
  });

  const stat = fs.statSync(outPdf);
  console.log('Wrote PDF', outPdf, 'bytes', stat.size, 'buffer', pdf.length);
  if (stat.size < 5000) {
    throw new Error('PDF suspiciously small');
  }
  // PDF header check
  const head = fs.readFileSync(outPdf).subarray(0, 8).toString('utf8');
  if (!head.startsWith('%PDF')) {
    throw new Error('Not a PDF: ' + head);
  }
  console.log('OK');
} finally {
  await browser.close();
}

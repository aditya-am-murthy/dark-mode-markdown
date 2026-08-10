/* Dark Mode Markdown Preview — preview.js
   Webview: live preview + rendered-HTML PDF export.
*/

(function () {
  'use strict';

  const vscode = acquireVsCodeApi();

  let currentTheme = null;
  let lastMarkdown = '';
  let lastFileType = 'markdown';
  let sideBySideActive = false;
  let exportBusy = false;

  const previewEl = document.getElementById('preview-content');
  const btnSideBySide = document.getElementById('btn-sidebyside');
  const btnExport = document.getElementById('btn-export');
  const btnCopy = document.getElementById('btn-copy');
  const btnClose = document.getElementById('btn-close');

  btnSideBySide.addEventListener('click', () => {
    vscode.postMessage({ type: 'toggleSideBySide' });
  });

  btnExport.addEventListener('click', () => {
    vscode.postMessage({ type: 'exportPdf' });
  });

  btnCopy.addEventListener('click', () => {
    vscode.postMessage({ type: 'copyHtml', html: previewEl.innerHTML });
  });

  btnClose.addEventListener('click', () => {
    vscode.postMessage({ type: 'closePreview' });
  });

  function applyTheme(theme) {
    if (!theme) return;
    const root = document.documentElement;
    const isLight = isLightTheme(theme);
    root.style.setProperty('--md-bg', theme.background);
    root.style.setProperty('--md-fg', theme.foreground);
    root.style.setProperty('--md-accent', theme.accent);
    root.style.setProperty('--md-font', theme.fontFamily);
    root.style.setProperty('--md-font-size', theme.fontSize + 'px');
    root.style.setProperty('--md-heading', theme.heading || theme.foreground);
    root.style.setProperty('--md-code-fg', theme.codeFg || theme.foreground);
    root.style.setProperty('--md-code-bg', theme.codeBg || (isLight ? '#f6f8fa' : '#1a1a1a'));
    root.style.setProperty('--md-border', theme.border || (isLight ? '#d0d7de' : '#2a2a2a'));
    root.style.setProperty('--md-quote-border', theme.quoteBorder || theme.accent);
    root.style.setProperty('--md-toolbar-bg', theme.codeBg || (isLight ? '#f6f8fa' : '#0a0a0a'));
    root.style.setProperty('--md-toolbar-border', theme.border || (isLight ? '#d0d7de' : '#2a2a2a'));
    root.style.setProperty('--md-th-bg', theme.thBg || (isLight ? '#f6f8fa' : '#1a1a1a'));
    root.style.setProperty('--md-btn-hover', isLight ? '#eaeef2' : '#2a2a2a');
    root.style.setProperty('--md-muted', theme.muted || (isLight ? '#656d76' : '#989898'));
    root.style.setProperty(
      '--md-row-alt',
      theme.rowAlt || (isLight ? 'rgba(246, 248, 250, 0.85)' : 'rgba(42, 42, 42, 0.45)')
    );
    root.style.setProperty(
      '--md-blockquote-bg',
      theme.blockquoteBg || (isLight ? 'rgba(246, 248, 250, 0.8)' : 'rgba(26, 26, 26, 0.8)')
    );
    document.body.style.background = theme.background;
    currentTheme = theme;
  }

  function isLightTheme(theme) {
    if (theme.mode === 'light') return true;
    if (theme.mode === 'dark') return false;
    const bg = (theme.background || '').toLowerCase();
    return bg === '#ffffff' || bg === '#fff' || bg === 'white';
  }

  function initMermaid(theme) {
    const bg = (theme && theme.background) || '#0a0a0a';
    const fg = (theme && theme.foreground) || '#f0f0f0';
    const accent = (theme && theme.accent) || '#88c0d0';
    const light = isLightTheme(theme || {});
    mermaid.initialize({
      startOnLoad: false,
      theme: theme && theme.mermaidTheme ? theme.mermaidTheme : light ? 'default' : 'dark',
      securityLevel: 'loose',
      themeVariables: {
        background: bg,
        mainBkg: theme.mermaidPrimary || (light ? '#ddf4ff' : '#1a1a1a'),
        primaryColor: theme.mermaidPrimary || (light ? '#ddf4ff' : '#1a1a1a'),
        primaryTextColor: fg,
        primaryBorderColor: theme.mermaidBorder || (light ? '#d0d7de' : '#2a2a2a'),
        lineColor: accent,
        secondaryColor: theme.mermaidSecondary || (light ? '#f6f8fa' : '#1a1a1a'),
        tertiaryColor: bg,
        edgeLabelBackground: theme.mermaidSecondary || (light ? '#f6f8fa' : '#1a1a1a'),
        clusterBkg: theme.mermaidSecondary || (light ? '#f6f8fa' : '#1a1a1a'),
        titleColor: fg,
        nodeBorder: theme.mermaidBorder || (light ? '#d0d7de' : '#2a2a2a'),
        nodeTextColor: fg,
        fontFamily: (theme && theme.fontFamily) || "'Segoe UI', system-ui, sans-serif"
      }
    });
  }

  function renderMarkdown(markdown, theme) {
    if (!window.marked) {
      previewEl.innerHTML = '<p style="color:#989898">Loading renderer…</p>';
      return Promise.resolve();
    }

    marked.setOptions({ breaks: true, gfm: true });

    const mermaidBlocks = [];
    let idx = 0;
    const processed = markdown.replace(/```mermaid\n([\s\S]*?)```/g, (_, diagram) => {
      const placeholder = `MERMAID_PLACEHOLDER_${idx++}`;
      mermaidBlocks.push({ placeholder, diagram: diagram.trim() });
      return '```\n' + placeholder + '\n```';
    });

    let html = marked.parse(processed);

    mermaidBlocks.forEach(({ placeholder, diagram }, i) => {
      const encoded = btoa(unescape(encodeURIComponent(diagram)));
      html = html.replace(
        new RegExp(`<pre><code[^>]*>${placeholder}[\\s\\S]*?</code></pre>`, 'g'),
        `<div class="mermaid" id="mermaid-${i}" data-diagram="${encoded}"></div>`
      );
      html = html.replace(
        new RegExp(`<code[^>]*>${placeholder}[\\s\\S]*?</code>`, 'g'),
        `<div class="mermaid" id="mermaid-${i}" data-diagram="${encoded}"></div>`
      );
    });

    previewEl.innerHTML = html;
    applyChromeAccents();
    highlightCodeBlocks();

    if (mermaidBlocks.length > 0) {
      initMermaid(theme);
      return renderMermaidDiagrams();
    }
    return Promise.resolve();
  }

  async function renderMermaidDiagrams() {
    const diagrams = previewEl.querySelectorAll('.mermaid[data-diagram]');
    let counter = 0;
    for (const el of diagrams) {
      try {
        const encoded = el.getAttribute('data-diagram');
        const diagram = decodeURIComponent(escape(atob(encoded)));
        const id = 'mmd-svg-' + Date.now() + '-' + counter++;
        const { svg } = await mermaid.render(id, diagram);
        el.innerHTML = svg;
        el.removeAttribute('data-diagram');
      } catch (err) {
        el.innerHTML = `<pre style="color:#bf616a;padding:1em">Mermaid error: ${escapeHtml(err.message)}</pre>`;
      }
    }
    fitMedia(previewEl);
  }

  function applyChromeAccents() {
    const borderColor = getComputedStyle(document.documentElement).getPropertyValue('--md-border').trim() || '#2a2a2a';
    const thBg = getComputedStyle(document.documentElement).getPropertyValue('--md-th-bg').trim() || '#1a1a1a';
    const accent = (currentTheme && currentTheme.accent) || '#88c0d0';
    const BORDER = '1px solid ' + borderColor;

    previewEl.querySelectorAll('table').forEach((el) => {
      el.style.border = BORDER;
      el.style.borderCollapse = 'collapse';
    });
    previewEl.querySelectorAll('th, td').forEach((el) => {
      el.style.border = BORDER;
    });
    previewEl.querySelectorAll('th').forEach((el) => {
      el.style.background = thBg;
    });
    previewEl.querySelectorAll('hr').forEach((el) => {
      el.style.border = 'none';
      el.style.borderTop = '1px solid ' + borderColor;
    });
    previewEl.querySelectorAll('h1, h2').forEach((el) => {
      el.style.borderBottom = '1px solid ' + borderColor;
    });
    previewEl.querySelectorAll('blockquote').forEach((el) => {
      el.style.borderLeft = '4px solid ' + accent;
    });
  }

  function fitMedia(root) {
    root.querySelectorAll('img, svg, canvas, video, table, .mermaid').forEach((el) => {
      el.style.maxWidth = '100%';
      el.style.height = 'auto';
      el.style.boxSizing = 'border-box';
    });
    root.querySelectorAll('.mermaid svg, svg').forEach((svg) => {
      svg.style.maxWidth = '100%';
      svg.style.width = '100%';
      svg.style.height = 'auto';
      svg.setAttribute('width', '100%');
      svg.removeAttribute('height');
    });
  }

  function highlightCodeBlocks() {
    const blocks = previewEl.querySelectorAll('pre code');
    blocks.forEach((block) => {
      if (block.classList.contains('hljs')) return;
      const text = block.textContent || '';
      block.innerHTML = basicHighlight(text, block.className);
    });
  }

  function basicHighlight(code, className) {
    const lang = (className.match(/language-(\w+)/) || [])[1] || '';
    const escaped = escapeHtml(code);
    if (!lang || lang === 'text' || lang === 'plaintext') return escaped;
    return escaped
      .replace(/(&#39;.*?&#39;|&quot;.*?&quot;|`[^`]*`)/g, '<span class="hljs-string">$1</span>')
      .replace(/(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/)/g, '<span class="hljs-comment">$1</span>')
      .replace(/\b(const|let|var|function|return|if|else|for|while|class|import|export|from|async|await|try|catch|throw|new|this|typeof|instanceof|in|of|def|fn|pub|use|struct|impl|trait|enum|mod|type|interface|extends|implements|super|static|final|abstract|void|null|undefined|true|false|nil|None|Some|Ok|Err)\b/g, '<span class="hljs-keyword">$1</span>')
      .replace(/\b(\d+\.?\d*)\b/g, '<span class="hljs-number">$1</span>')
      .replace(/([a-zA-Z_]\w*)\s*(?=\()/g, '<span class="hljs-function">$1</span>');
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function parseCsv(text) {
    const rows = [];
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      if (line.trim() === '') continue;
      const cells = [];
      let cur = '';
      let inQuote = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQuote && line[i + 1] === '"') {
            cur += '"';
            i++;
          } else {
            inQuote = !inQuote;
          }
        } else if (ch === ',' && !inQuote) {
          cells.push(cur);
          cur = '';
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
      previewEl.innerHTML = '<p style="color:#989898">Empty CSV</p>';
      return;
    }
    const headers = rows[0];
    const body = rows.slice(1);
    let html = '<div style="overflow-x:auto"><table><thead><tr>';
    headers.forEach((h) => {
      html += `<th>${escapeHtml(h.trim())}</th>`;
    });
    html += '</tr></thead><tbody>';
    body.forEach((row) => {
      html += '<tr>';
      headers.forEach((_, i) => {
        html += `<td>${escapeHtml((row[i] || '').trim())}</td>`;
      });
      html += '</tr>';
    });
    html += '</tbody></table></div>';
    html += `<p style="color:#989898;font-size:0.85em;margin-top:1em">${body.length} row${body.length !== 1 ? 's' : ''} × ${headers.length} column${headers.length !== 1 ? 's' : ''}</p>`;
    previewEl.innerHTML = html;
    applyChromeAccents();
  }

  function waitForImages(root) {
    const images = Array.prototype.slice.call(root.querySelectorAll('img'));
    if (images.length === 0) return Promise.resolve();
    return Promise.all(
      images.map((img) => {
        if (img.complete) return Promise.resolve();
        return new Promise((resolve) => {
          img.onload = img.onerror = () => resolve();
        });
      })
    );
  }

  /** Convert SVG nodes to PNG <img> so html2canvas can capture Mermaid. */
  async function rasterizeSvgs(root) {
    const svgs = Array.prototype.slice.call(root.querySelectorAll('svg'));
    for (const svg of svgs) {
      try {
        const rect = svg.getBoundingClientRect();
        const width = Math.max(1, Math.ceil(rect.width || svg.viewBox?.baseVal?.width || 800));
        const height = Math.max(1, Math.ceil(rect.height || svg.viewBox?.baseVal?.height || 400));
        const clone = svg.cloneNode(true);
        if (!clone.getAttribute('xmlns')) {
          clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        }
        clone.setAttribute('width', String(width));
        clone.setAttribute('height', String(height));
        const xml = new XMLSerializer().serializeToString(clone);
        const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
        const img = await loadImage(url);
        const canvas = document.createElement('canvas');
        canvas.width = width * 2;
        canvas.height = height * 2;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = getComputedStyle(document.body).backgroundColor || '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const out = document.createElement('img');
        out.src = canvas.toDataURL('image/png');
        out.alt = 'diagram';
        out.style.maxWidth = '100%';
        out.style.width = '100%';
        out.style.height = 'auto';
        out.style.display = 'block';
        svg.replaceWith(out);
      } catch (_) {
        // leave SVG in place if rasterization fails
      }
    }
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  function postPdfBase64(base64) {
    const id = 'pdf-' + Date.now();
    const chunkSize = 200000;
    const total = Math.ceil(base64.length / chunkSize) || 1;
    for (let i = 0; i < total; i++) {
      vscode.postMessage({
        type: 'pdfChunk',
        id,
        index: i,
        total,
        chunk: base64.slice(i * chunkSize, (i + 1) * chunkSize)
      });
    }
    vscode.postMessage({ type: 'pdfDone', id });
  }

  async function exportRenderedPdf(theme) {
    if (exportBusy) return;
    exportBusy = true;
    try {
      if (typeof html2pdf === 'undefined') {
        throw new Error('html2pdf failed to load (CDN / network)');
      }

      applyTheme(theme);
      if (lastFileType === 'csv') {
        renderCsv(lastMarkdown);
      } else {
        await renderMarkdown(lastMarkdown, theme);
      }
      await waitForImages(previewEl);
      fitMedia(previewEl);
      await rasterizeSvgs(previewEl);
      await new Promise((r) => setTimeout(r, 250));

      // Clone into a fixed-width capture root so page width is consistent
      const capture = document.createElement('div');
      capture.style.width = '800px';
      capture.style.maxWidth = '800px';
      capture.style.padding = '24px';
      capture.style.background = theme.background;
      capture.style.color = theme.foreground;
      capture.style.boxSizing = 'border-box';
      capture.innerHTML = previewEl.innerHTML;
      capture.querySelectorAll('img, table, .mermaid').forEach((el) => {
        el.style.maxWidth = '100%';
        el.style.height = 'auto';
      });
      document.body.appendChild(capture);

      const opt = {
        margin: [10, 10, 10, 10],
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          allowTaint: true,
          backgroundColor: theme.background,
          windowWidth: 800
        },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['css', 'legacy'] }
      };

      const pdf = await html2pdf().set(opt).from(capture).toPdf().get('pdf');
      const dataUri = pdf.output('datauristring');
      capture.remove();
      const base64 = dataUri.split(',')[1];
      if (!base64) throw new Error('PDF generation returned empty data');
      postPdfBase64(base64);
    } catch (err) {
      vscode.postMessage({
        type: 'pdfError',
        message: err && err.message ? err.message : String(err)
      });
    } finally {
      exportBusy = false;
    }
  }

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg) return;

    switch (msg.type) {
      case 'update': {
        const { markdown, theme, sideBySide, fileType } = msg;
        applyTheme(theme);
        lastMarkdown = markdown || '';
        lastFileType = fileType || 'markdown';
        sideBySideActive = !!sideBySide;
        btnSideBySide.classList.toggle('active', sideBySideActive);
        if (lastFileType === 'csv') {
          renderCsv(lastMarkdown);
        } else {
          renderMarkdown(lastMarkdown, theme);
        }
        break;
      }
      case 'layout':
        sideBySideActive = !!msg.sideBySide;
        btnSideBySide.classList.toggle('active', sideBySideActive);
        break;
      case 'exportRenderedPdf':
        exportRenderedPdf(msg.theme || currentTheme);
        break;
    }
  });

  vscode.postMessage({ type: 'ready' });
})();

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
      if (typeof html2pdf === 'undefined' && typeof html2canvas === 'undefined') {
        throw new Error('PDF libraries failed to load (CDN / network)');
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
      await waitForImages(previewEl);
      await new Promise((r) => setTimeout(r, 300));

      // Offscreen but layout-participating capture host (fixed+x/y often yields blank pages)
      const host = document.createElement('div');
      host.style.cssText =
        'position:absolute;left:0;top:0;width:680px;opacity:1;pointer-events:none;z-index:2147483646;';
      const capture = document.createElement('div');
      capture.className = 'pdf-capture';
      capture.style.width = '680px';
      capture.style.maxWidth = '680px';
      capture.style.background = theme.background;
      capture.style.color = theme.foreground;
      capture.innerHTML = previewEl.innerHTML;
      capture.querySelectorAll('img, table, .mermaid').forEach((el) => {
        el.style.maxWidth = '100%';
        el.style.height = 'auto';
      });
      // Force computed colors inline so html2canvas does not miss CSS variables
      paintCaptureInline(capture, theme);
      host.appendChild(capture);
      document.body.appendChild(host);

      const textLen = (capture.innerText || '').trim().length;
      if (textLen < 20) {
        throw new Error('Rendered capture is empty (nothing to export)');
      }

      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

      const canvasFn = window.html2canvas || (html2pdf && html2pdf().set && null);
      let canvas;
      if (typeof html2canvas === 'function') {
        canvas = await html2canvas(capture, {
          scale: 2,
          useCORS: true,
          allowTaint: false,
          backgroundColor: theme.background,
          logging: false,
          windowWidth: 680,
          scrollX: -window.scrollX,
          scrollY: -window.scrollY
        });
      } else {
        // Fallback through html2pdf worker API
        const worker = html2pdf()
          .set({
            margin: [14, 14, 14, 14],
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: {
              scale: 2,
              useCORS: true,
              allowTaint: false,
              backgroundColor: theme.background,
              logging: false,
              windowWidth: 680
            },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
            pagebreak: { mode: ['css', 'legacy'] }
          })
          .from(capture);
        const pdfObj = await worker.toPdf().get('pdf');
        const dataUri = pdfObj.output('datauristring');
        host.remove();
        const base64 = dataUri.split(',')[1];
        if (!base64) throw new Error('PDF generation returned empty data');
        assertPdfNotTiny(base64);
        postPdfBase64(base64);
        return;
      }

      if (!canvas || canvas.width < 10 || canvas.height < 10) {
        throw new Error('html2canvas produced an empty canvas');
      }
      if (isMostlyBlankCanvas(canvas)) {
        throw new Error('html2canvas produced a blank white page');
      }

      const imgData = canvas.toDataURL('image/jpeg', 0.98);
      const jsPDF = window.jspdf && window.jspdf.jsPDF
        ? window.jspdf.jsPDF
        : (window.jsPDF || null);
      if (!jsPDF) {
        // html2pdf bundle exposes jsPDF via worker; build via html2pdf image path
        const pdfObj = await html2pdf()
          .set({
            margin: [14, 14, 14, 14],
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
          })
          .from(capture)
          .toPdf()
          .get('pdf');
        // Manually replace with our known-good canvas pages instead
        host.remove();
        const dataUri = await canvasToPdfDataUri(canvas, theme.background);
        const base64 = dataUri.split(',')[1];
        assertPdfNotTiny(base64);
        postPdfBase64(base64);
        return;
      }

      const dataUri = await canvasToPdfDataUri(canvas, theme.background);
      host.remove();
      const base64 = dataUri.split(',')[1];
      if (!base64) throw new Error('PDF generation returned empty data');
      assertPdfNotTiny(base64);
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

  function paintCaptureInline(root, theme) {
    root.style.background = theme.background;
    root.style.color = theme.foreground;
    root.querySelectorAll('h1,h2,h3,h4,h5,h6,strong').forEach((el) => {
      el.style.color = theme.heading || theme.foreground;
    });
    root.querySelectorAll('p,li,td').forEach((el) => {
      el.style.color = theme.foreground;
    });
    root.querySelectorAll('a').forEach((el) => {
      el.style.color = theme.accent;
    });
  }

  function isMostlyBlankCanvas(canvas) {
    const ctx = canvas.getContext('2d');
    const w = Math.min(canvas.width, 200);
    const h = Math.min(canvas.height, 200);
    const data = ctx.getImageData(0, 0, w, h).data;
    let nonWhite = 0;
    for (let i = 0; i < data.length; i += 16) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      if (a > 10 && (r < 250 || g < 250 || b < 250)) nonWhite++;
    }
    return nonWhite < 30;
  }

  function assertPdfNotTiny(base64) {
    // ~ empty single-page PDFs are often < 2KB of base64 content beyond header
    if (!base64 || base64.length < 4000) {
      throw new Error('Generated PDF is empty/too small');
    }
  }

  async function canvasToPdfDataUri(canvas, background) {
    // Prefer jsPDF from html2pdf bundle
    let JsPDFCtor = null;
    if (window.jspdf && window.jspdf.jsPDF) JsPDFCtor = window.jspdf.jsPDF;
    else if (typeof window.jsPDF === 'function') JsPDFCtor = window.jsPDF;

    if (!JsPDFCtor) {
      // Last resort: html2pdf from an <img> of the canvas
      const img = document.createElement('img');
      img.src = canvas.toDataURL('image/jpeg', 0.98);
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });
      const holder = document.createElement('div');
      holder.style.width = '680px';
      holder.appendChild(img);
      document.body.appendChild(holder);
      const pdfObj = await html2pdf()
        .set({
          margin: [14, 14, 14, 14],
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: { scale: 1, backgroundColor: background },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
        })
        .from(holder)
        .toPdf()
        .get('pdf');
      holder.remove();
      return pdfObj.output('datauristring');
    }

    const pdf = new JsPDFCtor({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 14;
    const usableWidth = pageWidth - margin * 2;
    const usableHeight = pageHeight - margin * 2;

    const imgWidthPx = canvas.width;
    const imgHeightPx = canvas.height;
    const pxPerMm = imgWidthPx / usableWidth;
    const pageHeightPx = usableHeight * pxPerMm;

    let y = 0;
    let first = true;
    while (y < imgHeightPx) {
      const sliceHeight = Math.min(pageHeightPx, imgHeightPx - y);
      const pageCanvas = document.createElement('canvas');
      pageCanvas.width = imgWidthPx;
      pageCanvas.height = Math.max(1, Math.floor(sliceHeight));
      const ctx = pageCanvas.getContext('2d');
      ctx.fillStyle = background || '#ffffff';
      ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
      ctx.drawImage(
        canvas,
        0,
        y,
        imgWidthPx,
        sliceHeight,
        0,
        0,
        imgWidthPx,
        sliceHeight
      );
      const pageData = pageCanvas.toDataURL('image/jpeg', 0.98);
      if (!first) pdf.addPage();
      first = false;
      const drawHeight = sliceHeight / pxPerMm;
      pdf.addImage(pageData, 'JPEG', margin, margin, usableWidth, drawHeight);
      y += sliceHeight;
    }
    return pdf.output('datauristring');
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

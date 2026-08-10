/* Dark Mode Markdown Preview — preview.js
   Runs inside the VS Code Webview (browser context).
   Receives messages from the extension host and re-renders markdown.
*/

(function () {
  'use strict';

  // VS Code webview API
  const vscode = acquireVsCodeApi();

  let currentTheme = null;
  let renderTimeout = null;
  let lastMarkdown = '';
  let sideBySideActive = false;

  // ── DOM refs ──────────────────────────────────────────────────
  const previewEl = document.getElementById('preview-content');
  const btnSideBySide = document.getElementById('btn-sidebyside');
  const btnExport = document.getElementById('btn-export');
  const btnCopy = document.getElementById('btn-copy');

  // ── Toolbar handlers ──────────────────────────────────────────
  btnSideBySide.addEventListener('click', () => {
    vscode.postMessage({ type: 'toggleSideBySide' });
    sideBySideActive = !sideBySideActive;
    btnSideBySide.classList.toggle('active', sideBySideActive);
  });

  btnExport.addEventListener('click', () => {
    vscode.postMessage({ type: 'exportPdf' });
  });

  btnCopy.addEventListener('click', () => {
    vscode.postMessage({ type: 'copyHtml', html: previewEl.innerHTML });
  });

  // ── Apply theme variables (Cursor Dark High Contrast defaults) ─
  function applyTheme(theme) {
    if (!theme) return;
    const root = document.documentElement;
    root.style.setProperty('--md-bg', theme.background);
    root.style.setProperty('--md-fg', theme.foreground);
    root.style.setProperty('--md-accent', theme.accent);
    root.style.setProperty('--md-font', theme.fontFamily);
    root.style.setProperty('--md-font-size', theme.fontSize + 'px');
    root.style.setProperty('--md-heading', theme.foreground);
    root.style.setProperty('--md-code-fg', theme.foreground);
    root.style.setProperty('--md-border', '#2a2a2a');
    root.style.setProperty('--md-quote-border', theme.accent || '#88c0d0');
    root.style.setProperty('--md-toolbar-bg', theme.background);
    root.style.setProperty('--md-toolbar-border', '#2a2a2a');
    root.style.setProperty('--md-code-bg', '#1a1a1a');
    root.style.setProperty('--md-th-bg', '#1a1a1a');
    root.style.setProperty('--md-btn-hover', '#2a2a2a');
    root.style.setProperty('--md-muted', '#989898');
    root.style.setProperty('--md-row-alt', 'rgba(42, 42, 42, 0.45)');
    root.style.setProperty('--md-blockquote-bg', 'rgba(26, 26, 26, 0.8)');
    document.body.style.background = theme.background;
    currentTheme = theme;
  }

  // ── Mermaid initialisation ────────────────────────────────────
  function initMermaid(theme) {
    const bg = (theme && theme.background) || '#0a0a0a';
    const fg = (theme && theme.foreground) || '#f0f0f0';
    const accent = (theme && theme.accent) || '#88c0d0';

    mermaid.initialize({
      startOnLoad: false,
      theme: 'dark',
      securityLevel: 'loose',
      themeVariables: {
        background: bg,
        mainBkg: '#1a1a1a',
        primaryColor: '#1a1a1a',
        primaryTextColor: fg,
        primaryBorderColor: '#2a2a2a',
        lineColor: accent,
        secondaryColor: '#1a1a1a',
        tertiaryColor: bg,
        edgeLabelBackground: '#1a1a1a',
        clusterBkg: '#1a1a1a',
        titleColor: fg,
        nodeBorder: '#2a2a2a',
        nodeTextColor: fg,
        fontFamily: (theme && theme.fontFamily) || "'Segoe UI', system-ui, sans-serif"
      }
    });
  }

  // ── Markdown rendering ────────────────────────────────────────
  function renderMarkdown(markdown, theme) {
    if (!window.marked) {
      previewEl.innerHTML = '<p style="color:#8b949e">Loading renderer…</p>';
      return;
    }

    // Configure marked
    marked.setOptions({
      breaks: true,
      gfm: true
    });

    // Extract mermaid blocks first so marked doesn't mangle them
    const mermaidBlocks = [];
    let idx = 0;
    const processed = markdown.replace(/```mermaid\n([\s\S]*?)```/g, (_, diagram) => {
      const placeholder = `MERMAID_PLACEHOLDER_${idx++}`;
      mermaidBlocks.push({ placeholder, diagram: diagram.trim() });
      return '```\n' + placeholder + '\n```';
    });

    // Parse markdown to HTML
    let html = marked.parse(processed);

    // Replace placeholders with mermaid divs
    mermaidBlocks.forEach(({ placeholder, diagram }, i) => {
      const escaped = diagram
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      // Store original diagram in data attribute
      const encoded = btoa(unescape(encodeURIComponent(diagram)));
      html = html.replace(
        new RegExp(`<code[^>]*>${placeholder}[\\s\\S]*?</code>`, 'g'),
        `<div class="mermaid" id="mermaid-${i}" data-diagram="${encoded}"></div>`
      );
    });

    previewEl.innerHTML = html;

    applyChromeAccents();

    // Render mermaid diagrams
    if (mermaidBlocks.length > 0) {
      initMermaid(theme);
      renderMermaidDiagrams();
    }

    // Highlight code blocks (basic token-based approach without external lib)
    highlightCodeBlocks();
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
  }

  // ── Force chrome accents onto rendered elements (HC borders) ──
  function applyChromeAccents() {
    const BORDER = '1px solid #2a2a2a';
    const TH_BG = '#1a1a1a';
    const accent = (currentTheme && currentTheme.accent) || '#88c0d0';

    previewEl.querySelectorAll('table').forEach(el => {
      el.style.border = BORDER;
      el.style.borderCollapse = 'collapse';
    });
    previewEl.querySelectorAll('th, td').forEach(el => {
      el.style.border = BORDER;
    });
    previewEl.querySelectorAll('th').forEach(el => {
      el.style.background = TH_BG;
    });
    previewEl.querySelectorAll('hr').forEach(el => {
      el.style.border = 'none';
      el.style.borderTop = '1px solid #2a2a2a';
    });
    previewEl.querySelectorAll('h1, h2').forEach(el => {
      el.style.borderBottom = '1px solid #2a2a2a';
    });
    previewEl.querySelectorAll('blockquote').forEach(el => {
      el.style.borderLeft = '4px solid ' + accent;
    });
  }

  // ── Basic syntax highlighting for code blocks ─────────────────
  function highlightCodeBlocks() {
    const blocks = previewEl.querySelectorAll('pre code');
    blocks.forEach(block => {
      // Skip already highlighted or mermaid blocks
      if (block.classList.contains('hljs')) return;
      const text = block.textContent || '';
      block.innerHTML = basicHighlight(text, block.className);
    });
  }

  function basicHighlight(code, className) {
    const lang = (className.match(/language-(\w+)/) || [])[1] || '';
    const escaped = escapeHtml(code);

    if (!lang || lang === 'text' || lang === 'plaintext') return escaped;

    // Very lightweight token-based colorization for common languages
    return escaped
      // Strings
      .replace(/(&#39;.*?&#39;|&quot;.*?&quot;|`[^`]*`)/g, '<span class="hljs-string">$1</span>')
      // Comments
      .replace(/(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/)/g, '<span class="hljs-comment">$1</span>')
      // Keywords
      .replace(/\b(const|let|var|function|return|if|else|for|while|class|import|export|from|async|await|try|catch|throw|new|this|typeof|instanceof|in|of|def|fn|pub|use|struct|impl|trait|enum|mod|type|interface|extends|implements|super|static|final|abstract|void|null|undefined|true|false|nil|None|Some|Ok|Err)\b/g, '<span class="hljs-keyword">$1</span>')
      // Numbers
      .replace(/\b(\d+\.?\d*)\b/g, '<span class="hljs-number">$1</span>')
      // Function calls
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

  // ── CSV rendering ─────────────────────────────────────────────
  function parsecsv(text) {
    const rows = [];
    const lines = text.split(/\r?\n/);
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
    const rows = parsecsv(text);
    if (rows.length === 0) { previewEl.innerHTML = '<p style="color:#8b949e">Empty CSV</p>'; return; }

    const headers = rows[0];
    const body = rows.slice(1);

    let html = '<div style="overflow-x:auto"><table><thead><tr>';
    headers.forEach(h => { html += `<th>${escapeHtml(h.trim())}</th>`; });
    html += '</tr></thead><tbody>';
    body.forEach(row => {
      html += '<tr>';
      headers.forEach((_, i) => { html += `<td>${escapeHtml((row[i] || '').trim())}</td>`; });
      html += '</tr>';
    });
    html += '</tbody></table></div>';
    html += `<p style="color:#8b949e;font-size:0.85em;margin-top:1em">${body.length} row${body.length !== 1 ? 's' : ''} × ${headers.length} column${headers.length !== 1 ? 's' : ''}</p>`;

    previewEl.innerHTML = html;
    applyChromeAccents();
  }

  // ── Message handler from extension host ──────────────────────
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg) return;

    switch (msg.type) {
      case 'update': {
        const { markdown, theme, sideBySide, fileType } = msg;
        applyTheme(theme);
        lastMarkdown = markdown;
        sideBySideActive = sideBySide || false;
        btnSideBySide.classList.toggle('active', sideBySideActive);
        if (fileType === 'csv') {
          renderCsv(markdown);
        } else {
          renderMarkdown(markdown, theme);
        }
        break;
      }
    }
  });

  // ── Signal ready ──────────────────────────────────────────────
  // Tell the extension host we are ready to receive content
  vscode.postMessage({ type: 'ready' });

})();

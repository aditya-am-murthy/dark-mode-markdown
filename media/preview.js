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

  // ── Apply theme variables ─────────────────────────────────────
  function applyTheme(theme) {
    if (!theme) return;
    const root = document.documentElement;
    root.style.setProperty('--md-bg', theme.background);
    root.style.setProperty('--md-fg', theme.foreground);
    root.style.setProperty('--md-accent', theme.accent);
    root.style.setProperty('--md-font', theme.fontFamily);
    root.style.setProperty('--md-font-size', theme.fontSize + 'px');
    // Blue accent elements — set explicitly so webview base styles can't override
    root.style.setProperty('--md-border', '#1a3a6b');
    root.style.setProperty('--md-quote-border', '#1e4db7');
    root.style.setProperty('--md-toolbar-border', '#1a3a6b');
    root.style.setProperty('--md-code-bg', '#161b22');
    document.body.style.background = theme.background;
    currentTheme = theme;
  }

  // ── Mermaid initialisation ────────────────────────────────────
  function initMermaid(theme) {
    const bg = (theme && theme.background) || '#0d1117';
    const fg = (theme && theme.foreground) || '#c9d1d9';
    const accent = (theme && theme.accent) || '#58a6ff';

    mermaid.initialize({
      startOnLoad: false,
      theme: 'dark',
      securityLevel: 'loose',
      themeVariables: {
        background: bg,
        mainBkg: '#1f2937',
        primaryColor: '#1f2937',
        primaryTextColor: fg,
        primaryBorderColor: '#3d444d',
        lineColor: accent,
        secondaryColor: '#161b22',
        tertiaryColor: bg,
        edgeLabelBackground: '#161b22',
        clusterBkg: '#161b22',
        titleColor: fg,
        nodeBorder: '#3d444d',
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

    // Force blue styling directly on elements — bypasses any webview base style overrides
    applyBlueAccents();

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
        el.innerHTML = `<pre style="color:#ff7b72;padding:1em">Mermaid error: ${escapeHtml(err.message)}</pre>`;
      }
    }
  }

  // ── Force blue accents directly onto rendered elements ────────
  function applyBlueAccents() {
    const BORDER = '1px solid #1a3a6b';
    const TH_BG  = '#0e2a5c';

    // Table: outer border + all cell borders
    previewEl.querySelectorAll('table').forEach(el => {
      el.style.border = BORDER;
      el.style.borderCollapse = 'collapse';
    });
    previewEl.querySelectorAll('th, td').forEach(el => {
      el.style.border = BORDER;
    });
    // Table headers: blue background
    previewEl.querySelectorAll('th').forEach(el => {
      el.style.background = TH_BG;
    });
    // HR dividers
    previewEl.querySelectorAll('hr').forEach(el => {
      el.style.border = 'none';
      el.style.borderTop = '1px solid #1a3a6b';
    });
    // H1/H2 underline
    previewEl.querySelectorAll('h1, h2').forEach(el => {
      el.style.borderBottom = '1px solid #1a3a6b';
    });
    // Blockquote left bar
    previewEl.querySelectorAll('blockquote').forEach(el => {
      el.style.borderLeft = '4px solid #1e4db7';
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

  // ── Message handler from extension host ──────────────────────
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg) return;

    switch (msg.type) {
      case 'update': {
        const { markdown, theme, sideBySide } = msg;
        applyTheme(theme);
        lastMarkdown = markdown;
        sideBySideActive = sideBySide || false;
        btnSideBySide.classList.toggle('active', sideBySideActive);
        renderMarkdown(markdown, theme);
        break;
      }
    }
  });

  // ── Signal ready ──────────────────────────────────────────────
  // Tell the extension host we are ready to receive content
  vscode.postMessage({ type: 'ready' });

})();

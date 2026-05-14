(() => {
  'use strict';

  const STORAGE_KEY = 'portable-markdown-editer:draft:v1';
  const SETTINGS_KEY = 'portable-markdown-editer:settings:v1';
  const MAX_EMBEDDED_IMAGE_BYTES = 2 * 1024 * 1024;
  const MAX_HIGHLIGHT_CHARS = 120000;
  const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
  const IMAGE_EXTENSION_PATTERN = /\.(?:png|jpe?g|gif|webp)(?:[?#].*)?$/i;
  let mermaidRenderSerial = 0;

  const DEFAULT_MARKDOWN = `# Portable Markdown Editer

インストール不要で使える、完全ローカル実行のMarkdownエディタです。

[toc]

## できること

- **ライブプレビュー**
- Typora風のリッチ編集モード
- Mermaid図
- 主要言語のコードハイライト
- Markdown / HTML の保存
- PDF化・印刷
- 自動復元
- 外部ライブラリなし
- Markdown内HTMLの無効化

## セキュリティ方針

> このエディタは外部CDN、外部JavaScript、外部CSS、ネットワーク通信を使いません。

危険なURL例は表示時にブロックされます。

[安全な相対リンク](./README.md)

[ブロックされるリンク](javascript:alert(1))

## 表

| 項目 | 内容 |
| --- | --- |
| 動作 | ブラウザでHTMLを開くだけ |
| 保存 | ユーザー操作によるダウンロード |
| 通信 | なし |

## チェックリスト

- [x] ローカル動作
- [x] HTMLエスケープ
- [ ] 好きな文章を書く

## コード

\`\`\`js
const message = 'Hello local Markdown';
console.log(message);
\`\`\`

\`\`\`python
def hello(name: str) -> str:
    return f"Hello, {name}"
\`\`\`

## Mermaid

\`\`\`mermaid
flowchart TD
  A[Markdownを書く] --> B{安全にプレビュー}
  B -->|OK| C[保存]
  B -->|確認| D[修正]
\`\`\`
`;

  const state = {
    markdown: DEFAULT_MARKDOWN,
    fileName: 'untitled.md',
    mode: 'rich',
    dirty: false,
    theme: 'light',
    outlineCollapsed: false,
    lastAutoSaved: null,
    saveTimer: 0,
    renderTimer: 0,
    currentBlockEditor: null,
  };

  const els = {};

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    cacheElements();
    restoreSettings();
    restoreDraft();
    bindEvents();
    applyTheme();
    applyMode(state.mode);
    els.source.value = state.markdown;
    renderAll('init');
    setStatus('準備完了');
  }

  function cacheElements() {
    els.body = document.body;
    els.source = document.getElementById('sourceEditor');
    els.preview = document.getElementById('preview');
    els.rich = document.getElementById('richEditor');
    els.outline = document.getElementById('outline');
    els.fileInput = document.getElementById('fileInput');
    els.imageInput = document.getElementById('imageInput');
    els.status = document.getElementById('statusMessage');
    els.stats = document.getElementById('documentStats');
    els.saveState = document.getElementById('saveState');
    els.fileNameLabel = document.getElementById('fileNameLabel');
    els.securityDialog = document.getElementById('securityDialog');
  }

  function restoreSettings() {
    const settings = readJson(SETTINGS_KEY);
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    state.theme = settings?.theme || (prefersDark ? 'dark' : 'light');
    state.mode = settings?.mode || 'rich';
    state.outlineCollapsed = Boolean(settings?.outlineCollapsed);
  }

  function restoreDraft() {
    const draft = readJson(STORAGE_KEY);
    if (!draft || typeof draft.markdown !== 'string') return;
    state.markdown = draft.markdown;
    state.fileName = safeFileName(draft.fileName || 'untitled.md');
    state.lastAutoSaved = draft.savedAt || null;
  }

  function readJson(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (_) {
      return false;
    }
  }

  function bindEvents() {
    document.addEventListener('click', onDocumentClick);
    document.addEventListener('keydown', onKeyDown);

    els.source.addEventListener('input', () => {
      state.markdown = normalizeNewlines(els.source.value);
      markDirty();
      scheduleRender();
      scheduleAutosave();
    });

    els.source.addEventListener('scroll', syncPreviewScroll);
    els.fileInput.addEventListener('change', onFileChosen);
    els.imageInput.addEventListener('change', onImageChosen);

    els.rich.addEventListener('click', (event) => {
      if (event.target.closest('button')) return;
      const block = event.target.closest('.rich-block');
      if (state.currentBlockEditor && block !== state.currentBlockEditor) {
        cancelCurrentBlockEditor(block);
        return;
      }
      if (!block) {
        if (state.currentBlockEditor) cancelCurrentBlockEditor(null);
        return;
      }
      editRichBlock(block);
    });

    els.rich.addEventListener('keydown', (event) => {
      if ((event.key === 'Enter' || event.key === ' ') && event.target.classList.contains('rich-block')) {
        event.preventDefault();
        editRichBlock(event.target);
      }
    });

    window.addEventListener('beforeunload', (event) => {
      if (!state.dirty) return;
      event.preventDefault();
      event.returnValue = '';
    });
  }

  function onDocumentClick(event) {
    const actionButton = event.target.closest('[data-action]');
    if (!actionButton) return;

    const action = actionButton.dataset.action;
    switch (action) {
      case 'new':
        newDocument();
        break;
      case 'open':
        els.fileInput.click();
        break;
      case 'save-md':
        downloadMarkdown();
        break;
      case 'export-html':
        exportHtml();
        break;
      case 'print':
        printPreview();
        break;
      case 'copy-html':
        copyHtml();
        break;
      case 'format':
        applyFormat(actionButton.dataset.format);
        break;
      case 'insert-link':
        insertLink();
        break;
      case 'insert-image':
        els.imageInput.click();
        break;
      case 'insert-image-ref':
        insertImageReference();
        break;
      case 'insert-code-block':
        insertCodeBlock();
        break;
      case 'insert-mermaid':
        insertMermaid();
        break;
      case 'mode':
        applyMode(actionButton.dataset.mode || 'split');
        break;
      case 'toggle-theme':
        toggleTheme();
        break;
      case 'security':
        showSecurityDialog();
        break;
      case 'collapse-outline':
        toggleOutline();
        break;
      case 'edit-block':
        editRichBlock(actionButton.closest('.rich-block'));
        break;
      case 'add-block-before':
        insertBlockNear(actionButton.closest('.rich-block'), 'before');
        break;
      case 'add-block-after':
        insertBlockNear(actionButton.closest('.rich-block'), 'after');
        break;
      case 'commit-block':
        commitBlockEditor(actionButton.closest('.rich-block'));
        break;
      case 'cancel-block':
        state.currentBlockEditor = null;
        renderRich();
        break;
      default:
        break;
    }
  }

  function onKeyDown(event) {
    if (!event.ctrlKey && !event.metaKey) return;
    const key = event.key.toLowerCase();
    if (key === 's') {
      event.preventDefault();
      downloadMarkdown();
    } else if (key === 'o') {
      event.preventDefault();
      els.fileInput.click();
    } else if (key === 'p') {
      event.preventDefault();
      printPreview();
    } else if (key === 'b') {
      event.preventDefault();
      applyFormat('bold');
    } else if (key === 'i') {
      event.preventDefault();
      applyFormat('italic');
    } else if (key === 'k') {
      event.preventDefault();
      insertLink();
    } else if (key === 'm' && event.shiftKey) {
      event.preventDefault();
      insertMermaid();
    }
  }

  function newDocument() {
    if (state.dirty && !confirm('未保存の変更があります。新規作成しますか？')) return;
    state.markdown = '# 無題\n\nここにMarkdownを書いてください。\n';
    state.fileName = 'untitled.md';
    state.dirty = false;
    els.source.value = state.markdown;
    renderAll('new');
    persistDraft();
    setStatus('新規文書を作成しました');
  }

  function onFileChosen(event) {
    const [file] = event.target.files || [];
    event.target.value = '';
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setStatus('10MBを超えるファイルは読み込みません');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      state.markdown = normalizeNewlines(String(reader.result || ''));
      state.fileName = safeFileName(file.name || 'untitled.md');
      state.dirty = false;
      els.source.value = state.markdown;
      renderAll('open');
      persistDraft();
      setStatus(`${state.fileName} を開きました`);
    };
    reader.onerror = () => setStatus('ファイルの読み込みに失敗しました');
    reader.readAsText(file, 'utf-8');
  }

  function onImageChosen(event) {
    const [file] = event.target.files || [];
    event.target.value = '';
    if (!file) return;
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      setStatus('PNG/JPEG/GIF/WebPのみ埋め込めます');
      return;
    }
    if (file.size > MAX_EMBEDDED_IMAGE_BYTES) {
      setStatus('画像は2MB以下にしてください');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const alt = stripExtension(file.name).replace(/[\]\n\r]/g, ' ');
      insertAtSelection(`![${alt}](${String(reader.result)})`);
      setStatus('画像をData URLとして埋め込みました');
    };
    reader.onerror = () => setStatus('画像の読み込みに失敗しました');
    reader.readAsDataURL(file);
  }

  function downloadMarkdown() {
    const name = ensureExtension(state.fileName || 'untitled.md', '.md');
    downloadBlob(name, state.markdown, 'text/markdown;charset=utf-8');
    state.dirty = false;
    updateStatusBar();
    setStatus(`${name} を保存しました`);
  }

  function exportHtml() {
    const html = buildExportHtml(state.markdown, state.fileName);
    const base = stripExtension(state.fileName || 'document');
    downloadBlob(`${base}.html`, html, 'text/html;charset=utf-8');
    setStatus('安全化済みHTMLを書き出しました');
  }

  function printPreview() {
    renderPreview();
    window.print();
  }

  async function copyHtml() {
    const html = renderMarkdownHtml(state.markdown);
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        const item = new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([stripMarkdown(state.markdown)], { type: 'text/plain' }),
        });
        await navigator.clipboard.write([item]);
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(html);
      } else {
        fallbackCopy(html);
      }
      setStatus('HTMLをコピーしました');
    } catch (_) {
      fallbackCopy(html);
      setStatus('HTMLをコピーしました');
    }
  }

  function fallbackCopy(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.className = 'clipboard-proxy';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
  }

  function downloadBlob(name, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = safeFileName(name);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function applyFormat(format) {
    const textarea = focusMarkdownInput();
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = textarea.value.slice(start, end);
    let replacement = selected;
    let selectionStart = start;
    let selectionEnd = end;

    switch (format) {
      case 'h1':
        replacement = prefixLines(selected || '見出し', '# ');
        break;
      case 'h2':
        replacement = prefixLines(selected || '見出し', '## ');
        break;
      case 'bold':
        replacement = `**${selected || '太字'}**`;
        selectionStart = start + 2;
        selectionEnd = selectionStart + (selected || '太字').length;
        break;
      case 'italic':
        replacement = `*${selected || '斜体'}*`;
        selectionStart = start + 1;
        selectionEnd = selectionStart + (selected || '斜体').length;
        break;
      case 'code':
        replacement = selected.includes('\n')
          ? `\`\`\`\n${selected || 'code'}\n\`\`\``
          : `\`${selected || 'code'}\``;
        break;
      case 'quote':
        replacement = prefixLines(selected || '引用文', '> ');
        break;
      case 'list':
        replacement = prefixLines(selected || '項目', '- ');
        break;
      case 'table':
        replacement = selected || '| 項目 | 内容 |\n| --- | --- |\n| 例 | テキスト |';
        break;
      case 'toc':
        replacement = selected || '[toc]';
        break;
      default:
        return;
    }

    replaceSelection(replacement, selectionStart, selectionEnd);
  }

  function insertLink() {
    focusMarkdownInput();
    const label = getSelectedText() || 'リンク';
    const rawUrl = prompt('URLを入力してください。危険なURLはプレビュー時にブロックされます。', './README.md');
    if (!rawUrl) return;
    replaceSelection(`[${label}](${rawUrl.trim()})`);
  }

  function insertImageReference() {
    focusMarkdownInput();
    const label = sanitizeMarkdownLabel(getSelectedText() || '画像');
    const rawPath = prompt('画像パスを入力してください。例: ./images/pic.png, Z:\\share\\pic.png, \\\\server\\share\\pic.png', './images/example.png');
    if (!rawPath) return;
    const path = rawPath.trim();
    if (!sanitizeImageUrl(path)) {
      setStatus('PNG/JPEG/GIF/WebPのローカル画像パスのみ参照できます');
      return;
    }
    replaceSelection(`![${label}](${formatMarkdownTarget(path)})`);
    setStatus('ローカル画像参照を挿入しました');
  }

  function insertCodeBlock() {
    focusMarkdownInput();
    const selected = getSelectedText();
    const lang = safeCodeLanguage(prompt('言語名を入力してください。例: js, ts, python, html, css, json, bash, powershell, sql', 'js') || '');
    const fence = lang ? `\`\`\`${lang}` : '```';
    replaceSelection(`${fence}\n${selected || 'code'}\n\`\`\``);
  }

  function insertMermaid() {
    focusMarkdownInput();
    const selected = getSelectedText().trim();
    const body = selected || 'flowchart TD\n  A[開始] --> B{確認}\n  B -->|OK| C[完了]\n  B -->|修正| A';
    replaceSelection(`\`\`\`mermaid\n${body}\n\`\`\``);
  }

  function prefixLines(text, prefix) {
    return text.split('\n').map((line) => line ? `${prefix}${line}` : prefix.trim()).join('\n');
  }

  function sanitizeMarkdownLabel(value) {
    return String(value || '画像').replace(/[\]\r\n]/g, ' ').trim() || '画像';
  }

  function formatMarkdownTarget(value) {
    const target = String(value || '').trim().replace(/[<>]/g, '');
    return /[\s()\\]/.test(target) ? `<${target}>` : target;
  }

  function safeCodeLanguage(value) {
    const match = String(value || '').trim().match(/^[A-Za-z0-9_+.-]{1,32}/);
    return match ? match[0] : '';
  }

  function focusMarkdownInput() {
    const blockEditor = state.currentBlockEditor && state.currentBlockEditor.querySelector('.block-editor');
    if (blockEditor) {
      blockEditor.focus();
      return blockEditor;
    }
    if (state.mode === 'rich' || state.mode === 'preview') applyMode('split');
    els.source.focus();
    return els.source;
  }

  function getSelectedText() {
    const textarea = getActiveMarkdownInput();
    return textarea.value.slice(textarea.selectionStart, textarea.selectionEnd);
  }

  function insertAtSelection(text) {
    focusMarkdownInput();
    replaceSelection(text);
  }

  function replaceSelection(replacement, selectionStart, selectionEnd) {
    const textarea = getActiveMarkdownInput();
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const before = textarea.value.slice(0, start);
    const after = textarea.value.slice(end);
    textarea.value = before + replacement + after;
    const nextStart = Number.isInteger(selectionStart) ? selectionStart : start + replacement.length;
    const nextEnd = Number.isInteger(selectionEnd) ? selectionEnd : nextStart;
    textarea.setSelectionRange(nextStart, nextEnd);
    textarea.focus();
    if (textarea !== els.source) {
      setStatus('ブロック編集欄に挿入しました');
      return;
    }
    state.markdown = normalizeNewlines(textarea.value);
    markDirty();
    renderAll('edit');
    scheduleAutosave();
  }

  function getActiveMarkdownInput() {
    const blockEditor = state.currentBlockEditor && state.currentBlockEditor.querySelector('.block-editor');
    return blockEditor || els.source;
  }

  function applyMode(mode) {
    if (!['rich', 'split', 'source', 'preview', 'focus'].includes(mode)) mode = 'split';
    state.mode = mode;
    document.body.dataset.mode = mode;
    document.querySelectorAll('[data-action="mode"]').forEach((button) => {
      const active = button.dataset.mode === mode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    persistSettings();
    if (mode === 'preview') renderPreview();
    if (mode === 'rich') renderRich();
    setStatus(`表示モード: ${mode}`);
  }

  function toggleTheme() {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    applyTheme();
    persistSettings();
  }

  function applyTheme() {
    document.documentElement.dataset.theme = state.theme;
  }

  function toggleOutline() {
    state.outlineCollapsed = !state.outlineCollapsed;
    document.body.classList.toggle('outline-collapsed', state.outlineCollapsed);
    persistSettings();
  }

  function showSecurityDialog() {
    if (els.securityDialog && typeof els.securityDialog.showModal === 'function') {
      els.securityDialog.showModal();
    } else {
      alert('完全ローカル実行、CSP有効、外部ライブラリなし、Markdown内HTMLは無効です。');
    }
  }

  function markDirty() {
    state.dirty = true;
    updateStatusBar();
  }

  function scheduleRender() {
    window.clearTimeout(state.renderTimer);
    state.renderTimer = window.setTimeout(() => renderAll('edit'), 120);
  }

  function scheduleAutosave() {
    window.clearTimeout(state.saveTimer);
    state.saveTimer = window.setTimeout(persistDraft, 450);
  }

  function persistDraft() {
    const ok = writeJson(STORAGE_KEY, {
      markdown: state.markdown,
      fileName: state.fileName,
      savedAt: new Date().toISOString(),
    });
    if (ok) {
      state.lastAutoSaved = new Date().toISOString();
      updateStatusBar();
    } else {
      setStatus('自動保存に失敗しました。画像が大きすぎる可能性があります');
    }
  }

  function persistSettings() {
    writeJson(SETTINGS_KEY, {
      theme: state.theme,
      mode: state.mode,
      outlineCollapsed: state.outlineCollapsed,
    });
  }

  function renderAll(reason) {
    if (reason !== 'init') state.markdown = normalizeNewlines(els.source.value);
    renderPreview();
    renderRich();
    renderOutline();
    updateStatusBar();
    document.body.classList.toggle('outline-collapsed', state.outlineCollapsed);
  }

  function renderPreview() {
    const html = renderMarkdownHtml(state.markdown);
    safeSetHtml(els.preview, html);
  }

  function renderRich() {
    if (state.currentBlockEditor) return;
    const blocks = splitMarkdownBlocks(state.markdown);
    const headings = buildHeadingIndex(blocks);
    els.rich.replaceChildren();

    if (blocks.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'Markdownを書き始めてください';
      els.rich.appendChild(empty);
      return;
    }

    for (const block of blocks) {
      const wrapper = document.createElement('section');
      wrapper.className = `rich-block block-${block.type}`;
      wrapper.tabIndex = 0;
      wrapper.dataset.start = String(block.start);
      wrapper.dataset.end = String(block.end);
      wrapper.dataset.type = block.type;
      safeSetHtml(wrapper, renderBlockHtml(block, headings));

      const tools = document.createElement('div');
      tools.className = 'block-tools';
      tools.innerHTML = [
        '<button type="button" data-action="add-block-before" title="上に追加">＋上</button>',
        '<button type="button" data-action="edit-block" title="編集">編集</button>',
        '<button type="button" data-action="add-block-after" title="下に追加">＋下</button>',
      ].join('');
      wrapper.appendChild(tools);
      els.rich.appendChild(wrapper);
    }
  }

  function editRichBlock(block) {
    if (!block || state.currentBlockEditor) return;
    const start = Number(block.dataset.start);
    const end = Number(block.dataset.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return;

    const raw = state.markdown.slice(start, end);
    state.currentBlockEditor = block;
    block.replaceChildren();

    const textarea = document.createElement('textarea');
    textarea.className = 'block-editor';
    textarea.value = raw;
    textarea.setAttribute('aria-label', 'Markdownブロック編集');

    const actions = document.createElement('div');
    actions.className = 'block-editor-actions';
    actions.innerHTML = [
      '<button type="button" data-action="cancel-block">キャンセル</button>',
      '<button type="button" data-action="commit-block">反映</button>',
    ].join('');

    block.appendChild(textarea);
    block.appendChild(actions);
    textarea.focus();
    textarea.setSelectionRange(0, textarea.value.length);

    textarea.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        commitBlockEditor(block);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        state.currentBlockEditor = null;
        renderRich();
      }
    });
  }

  function cancelCurrentBlockEditor(nextBlock) {
    const start = nextBlock?.dataset.start || '';
    const end = nextBlock?.dataset.end || '';
    state.currentBlockEditor = null;
    renderRich();
    if (start && end) {
      const selector = `.rich-block[data-start="${cssEscape(start)}"][data-end="${cssEscape(end)}"]`;
      const rerendered = els.rich.querySelector(selector);
      if (rerendered) {
        editRichBlock(rerendered);
        setStatus('ブロック編集を切り替えました');
        return;
      }
    }
    setStatus('ブロック編集をキャンセルしました');
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(String(value));
    return String(value).replace(/["\\]/g, '\\$&');
  }

  function commitBlockEditor(block) {
    const textarea = block && block.querySelector('.block-editor');
    if (!block || !textarea) return;
    const start = Number(block.dataset.start);
    const end = Number(block.dataset.end);
    const replacement = normalizeNewlines(textarea.value);
    state.markdown = state.markdown.slice(0, start) + replacement + state.markdown.slice(end);
    els.source.value = state.markdown;
    state.currentBlockEditor = null;
    markDirty();
    renderAll('rich-edit');
    persistDraft();
    setStatus('ブロックを反映しました');
  }

  function insertBlockNear(block, direction) {
    if (!block) return;
    const start = Number(block.dataset.start);
    const end = Number(block.dataset.end);
    const addition = '新しい段落';
    if (!Number.isFinite(start) || !Number.isFinite(end)) return;
    if (direction === 'before') {
      state.markdown = state.markdown.slice(0, start) + `${addition}\n\n` + state.markdown.slice(start);
    } else {
      state.markdown = state.markdown.slice(0, end) + `\n\n${addition}` + state.markdown.slice(end);
    }
    els.source.value = state.markdown;
    markDirty();
    renderAll('insert-block');
    persistDraft();
  }

  function renderOutline() {
    const blocks = splitMarkdownBlocks(state.markdown);
    const headings = buildHeadingIndex(blocks).items;
    els.outline.replaceChildren();
    if (headings.length === 0) {
      const empty = document.createElement('span');
      empty.className = 'outline-empty';
      empty.textContent = '見出しはありません';
      els.outline.appendChild(empty);
      return;
    }
    for (const heading of headings) {
      const link = document.createElement('a');
      link.href = `#${heading.id}`;
      link.className = `level-${heading.level}`;
      link.textContent = heading.text;
      link.addEventListener('click', (event) => {
        event.preventDefault();
        const target = document.getElementById(heading.id);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      els.outline.appendChild(link);
    }
  }

  function updateStatusBar() {
    const chars = state.markdown.length;
    const words = countWords(state.markdown);
    els.stats.textContent = `${chars.toLocaleString()}文字 / ${words.toLocaleString()}語`;
    els.fileNameLabel.textContent = state.fileName;
    const dirtyText = state.dirty ? '未保存' : '保存済み';
    const autoText = state.lastAutoSaved ? formatTime(state.lastAutoSaved) : '未保存';
    els.saveState.textContent = `${dirtyText} / 自動保存: ${autoText}`;
  }

  function setStatus(message) {
    els.status.textContent = message;
  }

  function syncPreviewScroll() {
    if (state.mode !== 'split') return;
    const sourceMax = els.source.scrollHeight - els.source.clientHeight;
    const previewMax = els.preview.scrollHeight - els.preview.clientHeight;
    if (sourceMax <= 0 || previewMax <= 0) return;
    els.preview.scrollTop = (els.source.scrollTop / sourceMax) * previewMax;
  }

  function renderMarkdownHtml(markdown) {
    const blocks = splitMarkdownBlocks(markdown);
    const headings = buildHeadingIndex(blocks);
    return blocks.map((block) => renderBlockHtml(block, headings)).join('\n');
  }

  function splitMarkdownBlocks(markdown) {
    const text = normalizeNewlines(markdown);
    const lines = getLines(text);
    const blocks = [];
    let index = 0;

    while (index < lines.length) {
      while (index < lines.length && lines[index].text.trim() === '') index += 1;
      if (index >= lines.length) break;

      const startLine = lines[index];
      let endIndex = index;
      const first = startLine.text;

      if (/^\s*```/.test(first)) {
        endIndex = index + 1;
        while (endIndex < lines.length && !/^\s*```\s*$/.test(lines[endIndex].text)) endIndex += 1;
        if (endIndex < lines.length) endIndex += 1;
      } else if (isHeadingLine(first) || isHorizontalRule(first) || isTocLine(first)) {
        endIndex = index + 1;
      } else if (isTableStart(lines, index)) {
        endIndex = index + 2;
        while (endIndex < lines.length && hasPipe(lines[endIndex].text) && lines[endIndex].text.trim() !== '') endIndex += 1;
      } else if (isListLine(first)) {
        endIndex = index + 1;
        while (endIndex < lines.length) {
          const line = lines[endIndex].text;
          if (line.trim() === '') break;
          if (isListLine(line) || /^\s{2,}\S/.test(line)) {
            endIndex += 1;
            continue;
          }
          break;
        }
      } else if (isQuoteLine(first)) {
        endIndex = index + 1;
        while (endIndex < lines.length && (isQuoteLine(lines[endIndex].text) || lines[endIndex].text.trim() === '')) {
          if (lines[endIndex].text.trim() === '') break;
          endIndex += 1;
        }
      } else {
        endIndex = index + 1;
        while (endIndex < lines.length && lines[endIndex].text.trim() !== '') {
          if (/^\s*```/.test(lines[endIndex].text) || isHeadingLine(lines[endIndex].text) || isHorizontalRule(lines[endIndex].text) || isTocLine(lines[endIndex].text)) break;
          endIndex += 1;
        }
      }

      const end = endIndex > index ? lines[endIndex - 1].end : startLine.end;
      const raw = text.slice(startLine.start, end).replace(/\n$/, '');
      blocks.push({ raw, start: startLine.start, end: startLine.start + raw.length, type: classifyBlock(raw) });
      index = Math.max(endIndex, index + 1);
    }
    return blocks;
  }

  function getLines(text) {
    const lines = [];
    let start = 0;
    while (start < text.length) {
      const newline = text.indexOf('\n', start);
      if (newline === -1) {
        lines.push({ text: text.slice(start), start, end: text.length });
        break;
      }
      lines.push({ text: text.slice(start, newline), start, end: newline + 1 });
      start = newline + 1;
    }
    return lines;
  }

  function classifyBlock(raw) {
    const first = raw.split('\n', 1)[0] || '';
    if (/^\s*```/.test(first)) return 'code';
    if (isHeadingLine(first)) return 'heading';
    if (isHorizontalRule(first)) return 'rule';
    if (isTocLine(first)) return 'toc';
    if (isTableStart(getLines(raw), 0)) return 'table';
    if (isListLine(first)) return 'list';
    if (isQuoteLine(first)) return 'quote';
    return 'paragraph';
  }

  function renderBlockHtml(block, headingIndex) {
    switch (block.type) {
      case 'code':
        return renderCodeBlock(block.raw);
      case 'heading':
        return renderHeading(block, headingIndex);
      case 'rule':
        return '<hr>';
      case 'toc':
        return renderToc(headingIndex.items);
      case 'table':
        return renderTable(block.raw);
      case 'list':
        return renderList(block.raw);
      case 'quote':
        return renderQuote(block.raw);
      default:
        return renderParagraph(block.raw);
    }
  }

  function renderHeading(block, headingIndex) {
    const raw = block.raw;
    const match = raw.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!match) return renderParagraph(raw);
    const level = match[1].length;
    const text = stripInlineMarkdown(match[2]);
    const id = headingIndex.byOffset.get(block.start) || slugify(text);
    return `<h${level} id="${escapeAttribute(id)}">${renderInline(match[2])}</h${level}>`;
  }

  function renderCodeBlock(raw) {
    const lines = raw.split('\n');
    const first = lines.shift() || '';
    if (lines.length && /^\s*```\s*$/.test(lines[lines.length - 1])) lines.pop();
    const lang = safeCodeLanguage(first.replace(/^\s*```/, ''));
    const codeText = lines.join('\n');
    const normalizedLang = normalizeCodeLanguage(lang);
    if (normalizedLang === 'mermaid') return renderMermaidBlock(codeText);
    const code = highlightCode(codeText, normalizedLang);
    const langAttr = lang ? ` data-lang="${escapeAttribute(lang)}"` : '';
    const langClass = normalizedLang ? ` language-${escapeAttribute(normalizedLang)}` : '';
    const label = normalizedLang ? `<span class="code-lang">${escapeHtml(normalizedLang)}</span>` : '';
    return `<pre class="code-block${langClass}">${label}<code${langAttr}>${code}</code></pre>`;
  }

  function renderParagraph(raw) {
    const lines = raw.split('\n');
    return `<p>${lines.map((line) => renderInline(line)).join('<br>')}</p>`;
  }

  function renderQuote(raw) {
    const body = raw.split('\n')
      .map((line) => line.replace(/^\s*>\s?/, ''))
      .map((line) => renderInline(line))
      .join('<br>');
    return `<blockquote>${body}</blockquote>`;
  }

  function renderList(raw) {
    const lines = raw.split('\n').filter((line) => line.trim() !== '');
    const ordered = /^\s*\d+\.\s+/.test(lines[0] || '');
    const tag = ordered ? 'ol' : 'ul';
    const items = lines.map((line) => {
      let text = line.replace(/^\s*(?:[-+*]|\d+\.)\s+/, '');
      const task = text.match(/^\[( |x|X)\]\s+(.*)$/);
      let checkbox = '';
      if (task) {
        const checked = task[1].toLowerCase() === 'x' ? ' checked' : '';
        checkbox = `<input class="task-checkbox" type="checkbox" disabled${checked}>`;
        text = task[2];
      }
      return `<li>${checkbox}${renderInline(text)}</li>`;
    }).join('');
    return `<${tag}>${items}</${tag}>`;
  }

  function renderTable(raw) {
    const lines = raw.split('\n').filter((line) => line.trim() !== '');
    if (lines.length < 2) return renderParagraph(raw);
    const headers = splitTableRow(lines[0]);
    const aligns = splitTableRow(lines[1]).map(parseAlign);
    const rows = lines.slice(2).map(splitTableRow);
    const head = headers.map((cell, i) => `<th${alignAttr(aligns[i])}>${renderInline(cell)}</th>`).join('');
    const body = rows.map((row) => `<tr>${headers.map((_, i) => `<td${alignAttr(aligns[i])}>${renderInline(row[i] || '')}</td>`).join('')}</tr>`).join('');
    return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
  }

  function renderToc(headings) {
    if (!headings.length) return '<div class="toc"><strong>目次</strong><p>見出しはありません。</p></div>';
    const links = headings.map((heading) => (
      `<a class="level-${heading.level}" href="#${escapeAttribute(heading.id)}">${escapeHtml(heading.text)}</a>`
    )).join('');
    return `<nav class="toc" aria-label="目次"><strong>目次</strong>${links}</nav>`;
  }

  function renderInline(raw) {
    const placeholders = [];
    const hold = (html) => {
      const token = `§§PME${placeholders.length}§§`;
      placeholders.push({ token, html });
      return token;
    };

    let text = raw.replace(/`([^`]+)`/g, (_match, code) => hold(`<code>${escapeHtml(code)}</code>`));

    text = text.replace(/!\[([^\]]*)\]\((<[^>]+>|[^)]+)\)/g, (_match, alt, target) => {
      const url = parseMarkdownTarget(target);
      const safe = sanitizeImageUrl(url);
      if (!safe) return hold(`<span class="blocked-image">画像ブロック: ${escapeHtml(alt || 'no alt')}</span>`);
      return hold(`<img alt="${escapeAttribute(alt)}" src="${escapeAttribute(safe)}">`);
    });

    text = text.replace(/\[([^\]]+)\]\((<[^>]+>|[^)]+)\)/g, (_match, label, target) => {
      const url = parseMarkdownTarget(target);
      const safe = sanitizeLinkUrl(url);
      if (!safe) return hold(`<span class="blocked-link">リンクブロック: ${escapeHtml(label)}</span>`);
      return hold(`<a href="${escapeAttribute(safe)}" rel="noopener noreferrer" target="_blank">${escapeHtml(label)}</a>`);
    });

    text = escapeHtml(text);
    text = text.replace(/~~(.+?)~~/g, '<del>$1</del>');
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/__(.+?)__/g, '<strong>$1</strong>');
    text = text.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    text = text.replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>');

    for (const { token, html } of placeholders) {
      text = text.replaceAll(escapeHtml(token), html).replaceAll(token, html);
    }
    return text;
  }

  function buildHeadingIndex(blocks) {
    const seen = new Map();
    const items = [];
    const byOffset = new Map();
    for (const block of blocks) {
      if (block.type !== 'heading') continue;
      const match = block.raw.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/);
      if (!match) continue;
      const level = match[1].length;
      const text = stripInlineMarkdown(match[2]);
      const base = slugify(text) || 'heading';
      const count = seen.get(base) || 0;
      seen.set(base, count + 1);
      const id = count ? `${base}-${count + 1}` : base;
      items.push({ id, text, level, start: block.start });
      byOffset.set(block.start, id);
    }
    return { items, byOffset };
  }

  function normalizeCodeLanguage(lang) {
    const value = String(lang || '').trim().toLowerCase().replace(/^language-/, '');
    const aliases = {
      cjs: 'js',
      javascript: 'js',
      jsx: 'js',
      mjs: 'js',
      node: 'js',
      py: 'python',
      python3: 'python',
      ts: 'ts',
      tsx: 'ts',
      typescript: 'ts',
      htm: 'html',
      xhtml: 'html',
      xml: 'html',
      yml: 'yaml',
      'c++': 'cpp',
      cs: 'csharp',
      golang: 'go',
      rs: 'rust',
      kt: 'kotlin',
      sh: 'bash',
      shell: 'bash',
      zsh: 'bash',
      ps: 'powershell',
      ps1: 'powershell',
      pwsh: 'powershell',
      mermaidjs: 'mermaid',
      mmd: 'mermaid',
    };
    return aliases[value] || value;
  }

  function highlightCode(code, lang) {
    const text = String(code || '');
    if (!lang || text.length > MAX_HIGHLIGHT_CHARS) return escapeHtml(text);
    if (lang === 'html') return highlightWithRules(text, htmlHighlightRules());
    if (lang === 'css') return highlightWithRules(text, cssHighlightRules());
    if (lang === 'json') return highlightWithRules(text, jsonHighlightRules());
    if (lang === 'python') return highlightWithRules(text, pythonHighlightRules());
    if (lang === 'bash') return highlightWithRules(text, bashHighlightRules());
    if (lang === 'powershell') return highlightWithRules(text, powershellHighlightRules());
    if (lang === 'sql') return highlightWithRules(text, sqlHighlightRules());
    if (lang === 'yaml') return highlightWithRules(text, yamlHighlightRules());
    if (['js', 'ts', 'java', 'c', 'cpp', 'csharp', 'go', 'rust', 'php', 'swift', 'kotlin'].includes(lang)) {
      return highlightWithRules(text, cLikeHighlightRules(lang));
    }
    return escapeHtml(text);
  }

  function highlightWithRules(code, rules) {
    let html = '';
    let offset = 0;
    while (offset < code.length) {
      let matched = false;
      for (const rule of rules) {
        rule.pattern.lastIndex = offset;
        const match = rule.pattern.exec(code);
        if (!match || match.index !== offset || !match[0]) continue;
        html += `<span class="tok-${rule.token}">${escapeHtml(match[0])}</span>`;
        offset += match[0].length;
        matched = true;
        break;
      }
      if (!matched) {
        html += escapeHtml(code[offset]);
        offset += 1;
      }
    }
    return html;
  }

  function cLikeHighlightRules(lang) {
    const keywordSets = {
      js: 'as async await break case catch class const continue debugger default delete do else export extends finally for from function get if import in instanceof let new of return set static super switch this throw try typeof var void while with yield',
      ts: 'abstract any as async await boolean break case catch class const constructor continue debugger declare default delete do else enum export extends false finally for from function get if implements import in infer instanceof interface keyof let module namespace never new null number object of private protected public readonly return set static string super switch symbol this throw true try type typeof undefined unknown var void while with yield',
      java: 'abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while',
      c: 'auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while',
      cpp: 'alignas alignof auto bool break case catch char class const constexpr continue default delete do double else enum explicit export extern false final float for friend goto if inline int long namespace new noexcept nullptr operator override private protected public register reinterpret_cast return short signed sizeof static struct switch template this throw true try typedef typename union unsigned using virtual void volatile while',
      csharp: 'abstract as base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new null object operator out override params private protected public readonly ref return sbyte sealed short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using virtual void volatile while',
      go: 'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var',
      rust: 'as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while',
      php: 'abstract and array as break callable case catch class clone const continue declare default die do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile eval exit extends final finally fn for foreach function global goto if implements include include_once instanceof insteadof interface isset list namespace new or print private protected public require require_once return static switch throw trait try unset use var while xor yield',
      swift: 'as associatedtype break case catch class continue default defer deinit do else enum extension fallthrough false fileprivate for func guard if import in init inout internal is let nil open operator private protocol public repeat rethrows return self static struct subscript super switch throw throws true try typealias var where while',
      kotlin: 'as break class continue do else false for fun if in interface is null object package return super this throw true try typealias val var when while',
    };
    return [
      { token: 'comment', pattern: /\/\*[\s\S]*?\*\/|\/\/[^\n]*/y },
      { token: 'string', pattern: /`(?:\\[\s\S]|[^`\\])*`|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'/y },
      { token: 'number', pattern: /\b(?:0x[\da-fA-F]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)\b/y },
      { token: 'keyword', pattern: keywordRegex(keywordSets[lang] || keywordSets.js) },
      { token: 'function', pattern: /\b[A-Za-z_$][\w$]*(?=\s*\()/y },
      { token: 'operator', pattern: /[{}\[\]().,;:+\-*/%=&|!<>?~^]+/y },
    ];
  }

  function pythonHighlightRules() {
    return [
      { token: 'comment', pattern: /#[^\n]*/y },
      { token: 'string', pattern: /(?:[rRubBfF]{0,2})("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*')/y },
      { token: 'number', pattern: /\b(?:0x[\da-fA-F]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)\b/y },
      { token: 'keyword', pattern: keywordRegex('and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield') },
      { token: 'function', pattern: /\b[A-Za-z_]\w*(?=\s*\()/y },
      { token: 'operator', pattern: /[{}\[\]().,;:+\-*/%=&|!<>?~^]+/y },
    ];
  }

  function htmlHighlightRules() {
    return [
      { token: 'comment', pattern: /<!--[\s\S]*?-->/y },
      { token: 'keyword', pattern: /<!doctype[^>]*>/iy },
      { token: 'tag', pattern: /<\/?[A-Za-z][^<>\n]*\/?>/y },
      { token: 'string', pattern: /"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'/y },
    ];
  }

  function cssHighlightRules() {
    return [
      { token: 'comment', pattern: /\/\*[\s\S]*?\*\//y },
      { token: 'string', pattern: /"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'/y },
      { token: 'number', pattern: /#[\da-fA-F]{3,8}\b|\b\d+(?:\.\d+)?(?:px|rem|em|vh|vw|%|s|ms|deg)?\b/y },
      { token: 'keyword', pattern: /@[A-Za-z-]+|--?[A-Za-z][\w-]*(?=\s*:)/y },
      { token: 'operator', pattern: /[{}\[\]().,;:+\-*/%=&|!<>?~^#]+/y },
    ];
  }

  function jsonHighlightRules() {
    return [
      { token: 'property', pattern: /"(?:\\[\s\S]|[^"\\])*"(?=\s*:)/y },
      { token: 'string', pattern: /"(?:\\[\s\S]|[^"\\])*"/y },
      { token: 'number', pattern: /-?\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b/iy },
      { token: 'keyword', pattern: /\b(?:true|false|null)\b/y },
      { token: 'operator', pattern: /[{}\[\]:,]/y },
    ];
  }

  function bashHighlightRules() {
    return [
      { token: 'comment', pattern: /#[^\n]*/y },
      { token: 'string', pattern: /"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'/y },
      { token: 'property', pattern: /\$[{(]?[A-Za-z_][\w]*[})]?|\$\d+/y },
      { token: 'keyword', pattern: keywordRegex('case do done elif else esac fi for function if in select then until while') },
      { token: 'function', pattern: /\b[A-Za-z_][\w.-]*(?=\s)/y },
      { token: 'operator', pattern: /[|&;(){}\[\]<>!=]+/y },
    ];
  }

  function powershellHighlightRules() {
    return [
      { token: 'comment', pattern: /<#[\s\S]*?#>|#[^\n]*/y },
      { token: 'string', pattern: /@"[\s\S]*?"@|@'[\s\S]*?'@|"(?:`[\s\S]|[^"`])*"|'(?:''|[^'])*'/y },
      { token: 'property', pattern: /\$[A-Za-z_][\w:]*|\$\{[^}]+\}/y },
      { token: 'keyword', pattern: keywordRegex('begin break catch class continue data define do dynamicparam else elseif end exit filter finally for foreach from function if in param process return switch throw trap try until using var while') },
      { token: 'function', pattern: /\b[A-Za-z]+-[A-Za-z]+\b/y },
      { token: 'operator', pattern: /-[A-Za-z]+|[|&;(){}\[\]<>!=]+/y },
    ];
  }

  function sqlHighlightRules() {
    return [
      { token: 'comment', pattern: /\/\*[\s\S]*?\*\/|--[^\n]*/y },
      { token: 'string', pattern: /'(?:''|[^'])*'|"(?:\\[\s\S]|[^"\\])*"/y },
      { token: 'number', pattern: /\b\d+(?:\.\d+)?\b/y },
      { token: 'keyword', pattern: keywordRegex('add all alter and as asc between by case create delete desc distinct drop else exists from group having in inner insert into is join left like limit not null on or order outer primary references right select set table then union update values when where') },
      { token: 'function', pattern: /\b[A-Za-z_]\w*(?=\s*\()/y },
      { token: 'operator', pattern: /[(),.;*+=<>!-]+/y },
    ];
  }

  function yamlHighlightRules() {
    return [
      { token: 'comment', pattern: /#[^\n]*/y },
      { token: 'property', pattern: /[A-Za-z0-9_.-]+(?=\s*:)/y },
      { token: 'string', pattern: /"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'/y },
      { token: 'number', pattern: /\b\d+(?:\.\d+)?\b/y },
      { token: 'keyword', pattern: /\b(?:true|false|null|yes|no|on|off)\b/y },
      { token: 'operator', pattern: /[:\[\]{},&*|>!\-]+/y },
    ];
  }

  function keywordRegex(words) {
    return new RegExp(`\\b(?:${words.trim().split(/\s+/).join('|')})\\b`, 'y');
  }

  function renderMermaidBlock(code) {
    const text = normalizeNewlines(code).trim();
    const first = text.split('\n').find((line) => {
      const trimmed = line.trim();
      return trimmed && !trimmed.startsWith('%%');
    }) || '';
    try {
      if (/^(?:graph|flowchart)\b/i.test(first)) return renderMermaidFlowchart(text);
      if (/^sequenceDiagram\b/i.test(first)) return renderMermaidSequence(text);
      return renderMermaidFallback(text, '未対応のMermaid構文');
    } catch (_) {
      return renderMermaidFallback(text, '描画できない構文をコードとして表示');
    }
  }

  function renderMermaidFallback(code, message) {
    return [
      '<figure class="mermaid-diagram mermaid-fallback">',
      `<figcaption>Mermaid <span>${escapeHtml(message)}</span></figcaption>`,
      `<pre class="code-block language-mermaid"><code data-lang="mermaid">${escapeHtml(code)}</code></pre>`,
      '</figure>',
    ].join('');
  }

  function renderMermaidFlowchart(code) {
    const parsed = parseMermaidFlowchart(code);
    if (!parsed.nodes.size) return renderMermaidFallback(code, '表示できるノードがありません');

    const layout = layoutFlowchart(parsed);
    const markerId = nextMermaidId('arrow', code);
    const nodes = Array.from(parsed.nodes.values()).map((node) => renderFlowNode(node, layout.positions.get(node.id))).join('');
    const edges = parsed.edges.map((edge) => renderFlowEdge(edge, layout.positions, parsed.direction, markerId)).join('');

    return [
      '<figure class="mermaid-diagram mermaid-flowchart">',
      '<figcaption>Mermaid flowchart</figcaption>',
      `<svg class="mermaid-svg" role="img" aria-label="Mermaid flowchart" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}" preserveAspectRatio="xMidYMid meet">`,
      `<defs><marker id="${markerId}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"></path></marker></defs>`,
      edges,
      nodes,
      '</svg>',
      '</figure>',
    ].join('');
  }

  function parseMermaidFlowchart(code) {
    const lines = normalizeNewlines(code).split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('%%'));
    const header = lines.shift() || '';
    const direction = (header.match(/\b(TD|TB|BT|LR|RL)\b/i) || ['TD', 'TD'])[1].toUpperCase();
    const nodes = new Map();
    const edges = [];

    for (const rawLine of lines) {
      const line = rawLine.replace(/;$/, '').trim();
      if (!line || /^(?:subgraph|end|classDef|class|style|linkStyle)\b/i.test(line)) continue;
      const edge = parseMermaidEdgeLine(line);
      if (edge && edge.from && edge.to) {
        addFlowNode(nodes, edge.from);
        addFlowNode(nodes, edge.to);
        edges.push({ from: edge.from.id, to: edge.to.id, label: edge.label });
        continue;
      }
      const node = parseMermaidNodeToken(line);
      if (node) addFlowNode(nodes, node);
    }

    return { direction, nodes, edges };
  }

  function parseMermaidEdgeLine(line) {
    let match = line.match(/^(.+?)\s*--\s*([^->]+?)\s*-->\s*(.+)$/);
    if (match) {
      const from = parseMermaidNodeToken(match[1]);
      const to = parseMermaidNodeToken(match[3]);
      if (!from || !to) return null;
      return { from, to, label: match[2].trim() };
    }
    match = line.match(/^(.+?)\s*(-->|---|==>|-.->)(?:\|([^|]+)\|)?\s*(.+)$/);
    if (!match) return null;
    const from = parseMermaidNodeToken(match[1]);
    const to = parseMermaidNodeToken(match[4]);
    if (!from || !to) return null;
    return { from, to, label: (match[3] || '').trim() };
  }

  function parseMermaidNodeToken(value) {
    const token = String(value || '').trim().replace(/:::[A-Za-z][\w-]*$/, '').trim();
    const match = token.match(/^([A-Za-z][\w-]*)(?:(\[\[([^\]]+)\]\])|(\[([^\]]+)\])|(\(\(([^\)]+)\)\))|(\(([^\)]+)\))|(\{([^}]+)\})|(>([^\]]+)\]))?$/);
    if (!match) return null;
    const label = cleanMermaidLabel(match[3] || match[5] || match[7] || match[9] || match[11] || match[13] || match[1]);
    let shape = 'rect';
    if (match[6]) shape = 'circle';
    if (match[8]) shape = 'stadium';
    if (match[10]) shape = 'diamond';
    if (match[12]) shape = 'asymmetric';
    return { id: match[1], label, shape };
  }

  function addFlowNode(nodes, node) {
    if (!node || !node.id) return;
    const existing = nodes.get(node.id);
    if (existing && existing.label !== existing.id) return;
    nodes.set(node.id, node);
  }

  function layoutFlowchart(parsed) {
    const ids = Array.from(parsed.nodes.keys());
    const levels = new Map(ids.map((id) => [id, 0]));
    for (let pass = 0; pass < ids.length; pass += 1) {
      let changed = false;
      for (const edge of parsed.edges) {
        const next = Math.min((levels.get(edge.from) || 0) + 1, ids.length);
        if (next > (levels.get(edge.to) || 0)) {
          levels.set(edge.to, next);
          changed = true;
        }
      }
      if (!changed) break;
    }

    const groups = [];
    for (const id of ids) {
      const level = levels.get(id) || 0;
      groups[level] ||= [];
      groups[level].push(id);
    }

    const horizontal = ['LR', 'RL'].includes(parsed.direction);
    const nodeWidth = 180;
    const nodeHeight = 58;
    const levelGap = 72;
    const itemGap = 40;
    const pad = 34;
    const maxItems = Math.max(1, ...groups.map((group) => group.length));
    const levelCount = Math.max(1, groups.length);
    const width = horizontal ? pad * 2 + levelCount * nodeWidth + (levelCount - 1) * levelGap : pad * 2 + maxItems * nodeWidth + (maxItems - 1) * itemGap;
    const height = horizontal ? pad * 2 + maxItems * nodeHeight + (maxItems - 1) * itemGap : pad * 2 + levelCount * nodeHeight + (levelCount - 1) * levelGap;
    const positions = new Map();

    groups.forEach((group, level) => {
      const groupSpan = group.length * (horizontal ? nodeHeight : nodeWidth) + (group.length - 1) * itemGap;
      const crossStart = ((horizontal ? height : width) - groupSpan) / 2;
      group.forEach((id, index) => {
        const main = pad + level * ((horizontal ? nodeWidth : nodeHeight) + levelGap);
        const cross = crossStart + index * ((horizontal ? nodeHeight : nodeWidth) + itemGap);
        positions.set(id, horizontal
          ? { x: main, y: cross, width: nodeWidth, height: nodeHeight }
          : { x: cross, y: main, width: nodeWidth, height: nodeHeight });
      });
    });

    return { width, height, positions };
  }

  function renderFlowNode(node, box) {
    if (!box) return '';
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const text = renderSvgText(node.label, cx, cy, 18, 'mermaid-node-label');
    if (node.shape === 'diamond') {
      const points = `${cx},${box.y} ${box.x + box.width},${cy} ${cx},${box.y + box.height} ${box.x},${cy}`;
      return `<g class="mermaid-node mermaid-node-diamond"><polygon points="${points}"></polygon>${text}</g>`;
    }
    if (node.shape === 'circle') {
      return `<g class="mermaid-node mermaid-node-circle"><ellipse cx="${cx}" cy="${cy}" rx="${box.width / 2}" ry="${box.height / 2}"></ellipse>${text}</g>`;
    }
    const rx = node.shape === 'stadium' ? box.height / 2 : 10;
    return `<g class="mermaid-node mermaid-node-${escapeAttribute(node.shape)}"><rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="${rx}"></rect>${text}</g>`;
  }

  function renderFlowEdge(edge, positions, direction, markerId) {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) return '';
    const horizontal = ['LR', 'RL'].includes(direction);
    const x1 = horizontal ? from.x + from.width : from.x + from.width / 2;
    const y1 = horizontal ? from.y + from.height / 2 : from.y + from.height;
    const x2 = horizontal ? to.x : to.x + to.width / 2;
    const y2 = horizontal ? to.y + to.height / 2 : to.y;
    const label = edge.label
      ? `<text class="mermaid-edge-label" x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 8}">${escapeHtml(edge.label)}</text>`
      : '';
    return `<g class="mermaid-edge"><path d="M ${x1} ${y1} L ${x2} ${y2}" marker-end="url(#${markerId})"></path>${label}</g>`;
  }

  function renderMermaidSequence(code) {
    const parsed = parseMermaidSequence(code);
    if (!parsed.participants.length || !parsed.events.length) return renderMermaidFallback(code, '表示できるシーケンスがありません');
    const pad = 38;
    const participantGap = 190;
    const headerHeight = 52;
    const rowGap = 58;
    const width = Math.max(360, pad * 2 + (parsed.participants.length - 1) * participantGap + 150);
    const height = pad * 2 + headerHeight + parsed.events.length * rowGap + 20;
    const xFor = new Map(parsed.participants.map((participant, index) => [participant.id, pad + 75 + index * participantGap]));
    const markerId = nextMermaidId('seq-arrow', code);

    const lifelines = parsed.participants.map((participant) => {
      const x = xFor.get(participant.id);
      return [
        `<g class="mermaid-seq-participant"><rect x="${x - 68}" y="${pad}" width="136" height="36" rx="8"></rect>`,
        renderSvgText(participant.label, x, pad + 18, 16, 'mermaid-node-label'),
        `<path class="mermaid-lifeline" d="M ${x} ${pad + 36} L ${x} ${height - pad}"></path></g>`,
      ].join('');
    }).join('');

    const events = parsed.events.map((event, index) => {
      const y = pad + headerHeight + index * rowGap;
      if (event.type === 'note') {
        const ids = event.ids.filter((id) => xFor.has(id));
        const left = Math.min(...ids.map((id) => xFor.get(id))) - 68;
        const right = Math.max(...ids.map((id) => xFor.get(id))) + 68;
        return `<g class="mermaid-note"><rect x="${left}" y="${y - 18}" width="${right - left}" height="38" rx="8"></rect>${renderSvgText(event.text, (left + right) / 2, y + 1, 28, 'mermaid-node-label')}</g>`;
      }
      const x1 = xFor.get(event.from);
      const x2 = xFor.get(event.to);
      const textX = (x1 + x2) / 2;
      const textY = y - 8;
      return `<g class="mermaid-message"><path d="M ${x1} ${y} L ${x2} ${y}" marker-end="url(#${markerId})"></path><text x="${textX}" y="${textY}">${escapeHtml(event.text)}</text></g>`;
    }).join('');

    return [
      '<figure class="mermaid-diagram mermaid-sequence">',
      '<figcaption>Mermaid sequenceDiagram</figcaption>',
      `<svg class="mermaid-svg" role="img" aria-label="Mermaid sequence diagram" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">`,
      `<defs><marker id="${markerId}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"></path></marker></defs>`,
      lifelines,
      events,
      '</svg>',
      '</figure>',
    ].join('');
  }

  function parseMermaidSequence(code) {
    const lines = normalizeNewlines(code).split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('%%') && !/^sequenceDiagram\b/i.test(line));
    const participants = new Map();
    const events = [];
    const ensureParticipant = (id, label = id) => {
      if (/^[A-Za-z][\w-]*$/.test(id) && !participants.has(id)) participants.set(id, { id, label });
    };

    for (const line of lines) {
      let match = line.match(/^(?:participant|actor)\s+([A-Za-z][\w-]*)(?:\s+as\s+(.+))?$/i);
      if (match) {
        ensureParticipant(match[1], (match[2] || match[1]).trim());
        continue;
      }
      match = line.match(/^Note\s+(?:over|right of|left of)\s+([^:]+):\s*(.+)$/i);
      if (match) {
        const ids = match[1].split(',').map((item) => item.trim()).filter(Boolean);
        ids.forEach((id) => ensureParticipant(id));
        events.push({ type: 'note', ids, text: match[2].trim() });
        continue;
      }
      match = line.match(/^([A-Za-z][\w-]*)\s*(?:-+|=+)[>x.)-]*\s*([A-Za-z][\w-]*)\s*:\s*(.+)$/);
      if (match) {
        ensureParticipant(match[1]);
        ensureParticipant(match[2]);
        events.push({ type: 'message', from: match[1], to: match[2], text: match[3].trim() });
      }
    }
    return { participants: Array.from(participants.values()), events };
  }

  function renderSvgText(label, x, y, maxChars, className) {
    const lines = splitSvgLabel(label, maxChars);
    const lineHeight = 15;
    const firstOffset = lines.length > 1 ? -((lines.length - 1) * lineHeight) / 2 : 5;
    const tspans = lines.map((line, index) => {
      const dy = index === 0 ? firstOffset : lineHeight;
      return `<tspan x="${x}" dy="${dy}">${escapeHtml(line)}</tspan>`;
    }).join('');
    return `<text class="${escapeAttribute(className || '')}" x="${x}" y="${y}" text-anchor="middle">${tspans}</text>`;
  }

  function splitSvgLabel(label, maxChars) {
    const value = String(label || '').trim() || ' ';
    const words = value.includes(' ') ? value.split(/\s+/) : value.match(new RegExp(`.{1,${maxChars}}`, 'g')) || [value];
    const lines = [];
    let current = '';
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (next.length > maxChars && current) {
        lines.push(current);
        current = word;
      } else {
        current = next;
      }
    }
    if (current) lines.push(current);
    if (lines.length <= 3) return lines;
    return [...lines.slice(0, 2), `${lines[2].slice(0, Math.max(1, maxChars - 1))}…`];
  }

  function cleanMermaidLabel(value) {
    return String(value || '')
      .trim()
      .replace(/^["']|["']$/g, '')
      .replace(/\\n/g, '\n')
      .trim();
  }

  function nextMermaidId(prefix, code) {
    mermaidRenderSerial = (mermaidRenderSerial + 1) % Number.MAX_SAFE_INTEGER;
    return `pme-${prefix}-${hashString(code)}-${mermaidRenderSerial}`;
  }

  function hashString(value) {
    let hash = 2166136261;
    const text = String(value || '');
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function buildExportHtml(markdown, fileName) {
    const title = escapeHtml(stripExtension(fileName || 'Markdown Document'));
    const body = renderMarkdownHtml(markdown);
    const exportedAt = escapeHtml(new Date().toLocaleString('ja-JP'));
    return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'; img-src 'self' data: blob: file:; style-src 'unsafe-inline'; script-src 'none'; connect-src 'none';">
<title>${title}</title>
<style>
body{margin:0;padding:clamp(1rem,4vw,4rem);font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.75;color:#111827;background:#fff}main{max-width:920px;margin:auto}h1,h2{border-bottom:1px solid #e5e7eb;padding-bottom:.25rem}pre{overflow:auto;background:#0f172a;color:#e5e7eb;border-radius:.75rem;padding:1rem}code{font-family:Consolas,monospace;background:#f3f4f6;border-radius:.25rem;padding:.1rem .25rem}pre code{background:transparent;padding:0}.code-lang{float:right;color:#94a3b8;font:700 .72rem system-ui}.tok-comment{color:#94a3b8}.tok-string{color:#a7f3d0}.tok-number{color:#fde68a}.tok-keyword{color:#93c5fd}.tok-function{color:#f9a8d4}.tok-property{color:#c4b5fd}.tok-tag{color:#fca5a5}.tok-operator{color:#cbd5e1}blockquote{border-left:.25rem solid #2563eb;margin:1rem 0;padding:.25rem 1rem;background:#eff6ff}table{border-collapse:collapse;width:100%}th,td{border:1px solid #d1d5db;padding:.5rem}.align-left{text-align:left}.align-center{text-align:center}.align-right{text-align:right}img{max-width:100%}.meta{color:#6b7280;font-size:.9rem}.blocked-image,.blocked-link{color:#b42318;border:1px solid #f3b8b1;border-radius:.3rem;padding:.1rem .3rem}.toc{border:1px solid #e5e7eb;border-radius:.75rem;padding:1rem}.toc a{display:block;color:#2563eb;text-decoration:none}.mermaid-diagram{margin:1.25rem 0}.mermaid-diagram figcaption{font-weight:700;color:#475569;margin-bottom:.4rem}.mermaid-svg{width:100%;height:auto;min-height:10rem;max-height:70vh;border:1px solid #d1d5db;border-radius:.75rem;background:#f8fafc}.mermaid-fallback pre{margin:0}.mermaid-node rect,.mermaid-node ellipse,.mermaid-node polygon,.mermaid-seq-participant rect{fill:#fff;stroke:#2563eb;stroke-width:1.5}.mermaid-edge path,.mermaid-message path{stroke:#334155;stroke-width:1.6;fill:none}.mermaid-edge-label,.mermaid-message text{font:12px system-ui;fill:#475569;text-anchor:middle}.mermaid-node-label{font:12px system-ui;fill:#0f172a}.mermaid-lifeline{stroke:#94a3b8;stroke-dasharray:5 5}.mermaid-note rect{fill:#fef3c7;stroke:#f59e0b}
</style>
</head>
<body>
<main>
<p class="meta">Exported locally: ${exportedAt}</p>
${body}
</main>
</body>
</html>`;
  }

  function safeSetHtml(element, html) {
    element.innerHTML = html;
  }

  function sanitizeLinkUrl(raw) {
    const value = cleanupUrl(raw);
    if (!value) return '';
    if (value.startsWith('#')) return value;
    if (value.startsWith('//')) return '';
    // 完全ローカル性を優先し、http/https/mailto/tel/file などのスキーム付きURLはリンク化しない。
    // 相対パスとページ内アンカーのみ許可する。
    if (/^[./A-Za-z0-9_-]/.test(value) && !value.includes(':')) return value;
    return '';
  }

  function sanitizeImageUrl(raw) {
    const value = cleanupUrl(raw, { keepSpaces: true });
    const compact = cleanupUrl(raw);
    if (!value) return '';
    if (compact.startsWith('blob:')) return compact;
    if (/^data:image\/(png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/=\s]+$/i.test(compact)) return compact.replace(/\s/g, '');
    const local = normalizeLocalImageUrl(value);
    if (local) return local;
    return '';
  }

  function normalizeLocalImageUrl(raw) {
    const value = String(raw || '').trim().replace(/[\u0000-\u001F\u007F]/g, '');
    if (!value || value.startsWith('//')) return '';
    if (/^file:/i.test(value)) return normalizeFileImageUrl(value);
    if (/^[A-Za-z]:[\\/]/.test(value)) return windowsPathToFileUrl(value);
    if (/^\\\\[^\\]+\\[^\\]+/.test(value)) return uncPathToFileUrl(value);
    if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) return '';
    return relativeImageUrl(value);
  }

  function normalizeFileImageUrl(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== 'file:') return '';
      const path = decodeURIComponent(url.pathname || '');
      if (!hasRasterImageExtension(path)) return '';
      return url.href;
    } catch (_) {
      return '';
    }
  }

  function windowsPathToFileUrl(value) {
    const normalized = value.replace(/\\/g, '/');
    if (!hasRasterImageExtension(normalized)) return '';
    const drive = normalized.slice(0, 2);
    const rest = normalized.slice(2).replace(/^\/+/, '');
    return `file:///${drive}/${encodePathSegments(rest)}`;
  }

  function uncPathToFileUrl(value) {
    const normalized = value.replace(/^\\\\/, '').replace(/\\/g, '/');
    if (!hasRasterImageExtension(normalized)) return '';
    const parts = normalized.split('/').filter(Boolean);
    if (parts.length < 3) return '';
    const [host, ...pathParts] = parts;
    return `file://${encodeURIComponent(host)}/${pathParts.map((part) => encodeURIComponent(part)).join('/')}`;
  }

  function relativeImageUrl(value) {
    if (value.includes(':') || value.startsWith('//')) return '';
    const normalized = value.replace(/\\/g, '/');
    if (!hasRasterImageExtension(normalized)) return '';
    return encodePathSegments(normalized);
  }

  function hasRasterImageExtension(value) {
    return IMAGE_EXTENSION_PATTERN.test(String(value || '').split(/[?#]/, 1)[0]);
  }

  function encodePathSegments(value) {
    return String(value || '').split('/').map((segment) => encodeURIComponent(segment)).join('/');
  }

  function cleanupUrl(raw, options = {}) {
    const value = String(raw || '').trim().replace(/[\u0000-\u001F\u007F]+/g, '').slice(0, 200000);
    return options.keepSpaces ? value : value.replace(/\s+/g, '');
  }

  function parseMarkdownTarget(target) {
    const trimmed = String(target || '').trim();
    if (!trimmed) return '';
    const quoted = trimmed.match(/^<([^>]+)>/);
    if (quoted) return quoted[1];
    const first = trimmed.match(/^[^\s]+/);
    return first ? first[0] : '';
  }

  function isHeadingLine(line) { return /^\s*#{1,6}\s+\S/.test(line); }
  function isHorizontalRule(line) { return /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line); }
  function isTocLine(line) { return /^\s*\[toc\]\s*$/i.test(line); }
  function isListLine(line) { return /^\s*(?:[-+*]|\d+\.)\s+/.test(line); }
  function isQuoteLine(line) { return /^\s*>/.test(line); }
  function hasPipe(line) { return line.includes('|'); }

  function isTableStart(lines, index) {
    if (!lines[index] || !lines[index + 1]) return false;
    return hasPipe(lines[index].text) && /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1].text);
  }

  function splitTableRow(line) {
    let value = String(line || '').trim();
    if (value.startsWith('|')) value = value.slice(1);
    if (value.endsWith('|')) value = value.slice(0, -1);
    return value.split('|').map((cell) => cell.trim());
  }

  function parseAlign(cell) {
    const value = cell.trim();
    const left = value.startsWith(':');
    const right = value.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    if (left) return 'left';
    return '';
  }

  function alignAttr(align) {
    return align ? ` class="align-${align}"` : '';
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
  }

  function normalizeNewlines(value) {
    return String(value || '').replace(/\r\n?/g, '\n');
  }

  function stripInlineMarkdown(value) {
    return String(value || '')
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/[`*_~#>]/g, '')
      .trim();
  }

  function stripMarkdown(value) {
    return normalizeNewlines(value)
      .replace(/^\s*```[\s\S]*?```/gm, '')
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/^\s*#{1,6}\s+/gm, '')
      .replace(/^\s*(?:[-+*]|\d+\.)\s+/gm, '')
      .replace(/[`*_~>|]/g, '')
      .trim();
  }

  function slugify(value) {
    const base = stripInlineMarkdown(value)
      .toLowerCase()
      .normalize('NFKC')
      .replace(/[\s/\\?#&=+.%]+/g, '-')
      .replace(/[^\p{Letter}\p{Number}\-_]+/gu, '')
      .replace(/^-+|-+$/g, '');
    return base || 'heading';
  }

  function countWords(value) {
    const text = stripMarkdown(value);
    const latin = text.match(/[A-Za-z0-9_]+/g) || [];
    const cjk = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) || [];
    return latin.length + cjk.length;
  }

  function safeFileName(value) {
    const fallback = 'untitled.md';
    const cleaned = String(value || fallback)
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
      .replace(/^\.+$/, fallback)
      .trim();
    return cleaned || fallback;
  }

  function ensureExtension(name, extension) {
    const clean = safeFileName(name);
    return clean.toLowerCase().endsWith(extension) ? clean : `${stripExtension(clean)}${extension}`;
  }

  function stripExtension(name) {
    return String(name || 'document').replace(/\.[^.]+$/, '') || 'document';
  }

  function formatTime(iso) {
    try {
      return new Date(iso).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch (_) {
      return '保存済み';
    }
  }
})();

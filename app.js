(() => {
  'use strict';

  const STORAGE_KEY = 'portable-markdown-editer:draft:v1';
  const SETTINGS_KEY = 'portable-markdown-editer:settings:v1';
  const MAX_EMBEDDED_IMAGE_BYTES = 2 * 1024 * 1024;
  const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

  const DEFAULT_MARKDOWN = `# Portable Markdown Editer

インストール不要で使える、完全ローカル実行のMarkdownエディタです。

[toc]

## できること

- **ライブプレビュー**
- Typora風のリッチ編集モード
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
`;

  const state = {
    markdown: DEFAULT_MARKDOWN,
    fileName: 'untitled.md',
    mode: 'split',
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
    state.mode = settings?.mode || 'split';
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
      const block = event.target.closest('.rich-block');
      if (!block || event.target.closest('button')) return;
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
    focusSourceIfNeeded();
    const textarea = els.source;
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
    focusSourceIfNeeded();
    const label = getSelectedText() || 'リンク';
    const rawUrl = prompt('URLを入力してください。危険なURLはプレビュー時にブロックされます。', './README.md');
    if (!rawUrl) return;
    replaceSelection(`[${label}](${rawUrl.trim()})`);
  }

  function prefixLines(text, prefix) {
    return text.split('\n').map((line) => line ? `${prefix}${line}` : prefix.trim()).join('\n');
  }

  function focusSourceIfNeeded() {
    if (state.mode === 'rich' || state.mode === 'preview') applyMode('split');
    els.source.focus();
  }

  function getSelectedText() {
    return els.source.value.slice(els.source.selectionStart, els.source.selectionEnd);
  }

  function insertAtSelection(text) {
    focusSourceIfNeeded();
    replaceSelection(text);
  }

  function replaceSelection(replacement, selectionStart, selectionEnd) {
    const textarea = els.source;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const before = textarea.value.slice(0, start);
    const after = textarea.value.slice(end);
    textarea.value = before + replacement + after;
    state.markdown = normalizeNewlines(textarea.value);
    const nextStart = Number.isInteger(selectionStart) ? selectionStart : start + replacement.length;
    const nextEnd = Number.isInteger(selectionEnd) ? selectionEnd : nextStart;
    textarea.setSelectionRange(nextStart, nextEnd);
    textarea.focus();
    markDirty();
    renderAll('edit');
    scheduleAutosave();
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
    const lang = (first.replace(/^\s*```/, '').trim().match(/^[A-Za-z0-9_+.-]{1,32}/) || [''])[0];
    const code = escapeHtml(lines.join('\n'));
    const langAttr = lang ? ` data-lang="${escapeAttribute(lang)}"` : '';
    return `<pre><code${langAttr}>${code}</code></pre>`;
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

    text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt, target) => {
      const url = parseMarkdownTarget(target);
      const safe = sanitizeImageUrl(url);
      if (!safe) return hold(`<span class="blocked-image">画像ブロック: ${escapeHtml(alt || 'no alt')}</span>`);
      return hold(`<img alt="${escapeAttribute(alt)}" src="${escapeAttribute(safe)}">`);
    });

    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, target) => {
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
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'none'; connect-src 'none';">
<title>${title}</title>
<style>
body{margin:0;padding:clamp(1rem,4vw,4rem);font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.75;color:#111827;background:#fff}main{max-width:920px;margin:auto}h1,h2{border-bottom:1px solid #e5e7eb;padding-bottom:.25rem}pre{overflow:auto;background:#0f172a;color:#e5e7eb;border-radius:.75rem;padding:1rem}code{font-family:Consolas,monospace;background:#f3f4f6;border-radius:.25rem;padding:.1rem .25rem}pre code{background:transparent;padding:0}blockquote{border-left:.25rem solid #2563eb;margin:1rem 0;padding:.25rem 1rem;background:#eff6ff}table{border-collapse:collapse;width:100%}th,td{border:1px solid #d1d5db;padding:.5rem}.align-left{text-align:left}.align-center{text-align:center}.align-right{text-align:right}img{max-width:100%}.meta{color:#6b7280;font-size:.9rem}.blocked-image,.blocked-link{color:#b42318;border:1px solid #f3b8b1;border-radius:.3rem;padding:.1rem .3rem}.toc{border:1px solid #e5e7eb;border-radius:.75rem;padding:1rem}.toc a{display:block;color:#2563eb;text-decoration:none}
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
    const value = cleanupUrl(raw);
    if (!value) return '';
    if (value.startsWith('blob:')) return value;
    if (/^data:image\/(png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/=\s]+$/i.test(value)) return value.replace(/\s/g, '');
    return '';
  }

  function cleanupUrl(raw) {
    return String(raw || '').trim().replace(/[\u0000-\u001F\u007F\s]+/g, '').slice(0, 200000);
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

(() => {
  'use strict';

  const STORAGE_KEY = 'portable-markdown-editer:draft:v1';
  const SETTINGS_KEY = 'portable-markdown-editer:settings:v1';
  const FSA_DB_NAME = 'portable-markdown-editor:fsa:v1';
  const FSA_STORE_NAME = 'handles';
  const FSA_DIRECTORY_HANDLE_KEY = 'last-directory';
  const FSA_PICKER_START_HANDLE_KEY = 'picker-start-directory';
  const FSA_SETTINGS_DIRECTORY_HANDLE_KEY = 'settings-directory';
  const CONFIG_SETTINGS_FILE_NAME = 'portable-markdown-editor-settings.json';
  const MAX_ASSET_IMAGE_BYTES = 25 * 1024 * 1024;
  const MAX_HIGHLIGHT_CHARS = 120000;
  const MAX_FOLDER_SCAN_FILES = 5000;
  const MAX_FOLDER_SCAN_DEPTH = 8;
  const DESKTOP_APP_HOST = 'portable-markdown-editor.local';
  const DESKTOP_DOCUMENT_HOST = 'document.portable-markdown-editor.local';
  const DESKTOP_ASSET_REQUEST_TIMEOUT_MS = 45000;
  const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
  const IMAGE_EXTENSION_PATTERN = /\.(?:png|jpe?g|gif|webp)(?:[?#].*)?$/i;
  const VENDOR_TOC_MARKER = 'PME_TOC_MARKER_7B4E2D8C';
  const RICH_INLINE_SOURCE_SELECTOR = '.rich-inline-atom, strong, b, em, i, del, s, code, a, img, .math-inline, .blocked-image';
  const RICH_INLINE_EDIT_BLOCK_SELECTOR = 'p, h1, h2, h3, h4, h5, h6, li, td, th, blockquote';
  const RICH_TRAILING_BLOCK_SELECTOR = '.toc, .mermaid-diagram, pre.code-block, .math-display, table, hr, ul, ol, blockquote';
  const RICH_SOURCE_BLOCK_SELECTOR = '[data-block-id][data-source-start][data-source-end]';
  const RICH_ATOMIC_SOURCE_BLOCK_SELECTOR = '.mermaid-diagram, pre.code-block, .math-display, hr';
  const RICH_CARET_TOKEN_PATTERN = /@PME_CARET_[A-Za-z0-9]+_\d+@/g;
  const MAX_RICH_UNDO_STEPS = 50;
  const DEFAULT_MERMAID_ZOOM = 0.7;
  const MERMAID_ZOOM_FACTOR = 1.1;
  const MERMAID_WHEEL_ZOOM_SENSITIVITY = 0.0012;

  const DEFAULT_MARKDOWN = `# Portable Markdown Editor

インストール不要で使える、完全ローカル実行のMarkdownエディタです。

[toc]

## できること

- **ライブプレビュー**
- シームレスなリッチ編集モード
- Mermaid図
- 主要言語のコードハイライト
- Markdown / HTML の保存
- PDF化・印刷
- 自動復元
- ローカル同梱ライブラリ
- Markdown内HTMLの無効化

## セキュリティ方針

> このエディタはCDN、外部配信JavaScript、外部配信CSS、ネットワーク通信を使いません。

危険なURL例は表示時にブロックされます。

[安全な相対リンク](./README.md)

[ブロックされるリンク](javascript:alert(1))

## 表

| 項目 | 内容 |
| --- | --- |
| Windowsアプリ | ネイティブ画面からファイルを直接操作 |
| ブラウザ版 | HTMLを開くだけで動作 |
| 保存 | Windowsダイアログ、またはブラウザの明示操作 |
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
    richReparseTimer: 0,
    richSelectionTimer: 0,
    richComposing: false,
    richInlineSource: null,
    richInlineActivationSuppressed: false,
    richInlineParseBlock: null,
    richUndoStack: [],
    richUndoRestoring: false,
    richUndoPreserveNextInput: false,
    richSelectionLock: false,
    richInputUsedSourceTransaction: false,
    richTransactionBlank: null,
    richLineBreakInputOffset: null,
    desktopHost: detectDesktopHost(),
    desktopDocumentReady: false,
    desktopAssetRequests: new Map(),
    desktopImageAliases: new Map(),
    desktopImageReferencesKey: '',
    desktopImageReferenceRequestId: '',
    desktopLastReportedDirty: null,
    desktopLastReportedFileName: '',
    scrollSyncLock: false,
    mermaidPan: null,
    allowedLinkDomains: [],
    assetUrls: new Map(),
    directoryHandle: null,
    pickerStartDirectoryHandle: null,
    settingsDirectoryHandle: null,
    settingsDirectoryName: '',
    directoryName: '',
    markdownRelativePath: '',
    fileHandle: null,
    folderInputMode: 'open',
    folderScanLimitMessage: '',
    pendingImageInsertionContext: null,
    pendingInlineInsertContext: null,
    codeMirrorSource: null,
    codeMirrorSourceLoading: false,
    codeMirrorSourceReady: false,
    proseMirrorRich: null,
    proseMirrorRichActive: false,
    proseMirrorRichFallbackReason: '',
    proseMirrorFocusTimer: 0,
  };

  const els = {};
  const markdownRendererFactory = window.PMEMarkdownRenderer?.createMarkdownRenderer;
  if (typeof markdownRendererFactory !== 'function') {
    throw new Error('Markdown renderer module is not available');
  }
  const {
    annotateRenderedBlockHtml,
    applyMermaidZoom,
    buildBlockModel,
    buildExportHtml,
    buildHeadingIndex,
    buildHeadingTree,
    buildOutlineTreeElement,
    cleanupUrl,
    decodeLocalImagePath,
    enhanceRenderedHtml,
    getLines,
    hasAmbiguousStrongDelimiterNeighborhood,
    hasRasterImageExtension,
    hashString,
    imageBlockReason,
    isLocalAbsoluteImageReference,
    isRelativeImageReference,
    onPreviewImageError,
    parseMarkdownTarget,
    renderBlockHtml,
    renderInlineMarkdown,
    renderMarkdownHtml,
    safeSetHtml,
    sanitizeImageUrl,
    sanitizeLinkUrl,
    splitMarkdownBlocks,
  } = markdownRendererFactory({
    state,
    els,
    constants: {
      MAX_HIGHLIGHT_CHARS,
      DESKTOP_DOCUMENT_HOST,
      IMAGE_EXTENSION_PATTERN,
      VENDOR_TOC_MARKER,
      DEFAULT_MERMAID_ZOOM,
    },
    dependencies: {
      alignAttr,
      annotateRenderedInlineAtomRanges,
      desktopImageAliasKey,
      displayMathBlockEndIndex,
      displayMathDelimiter,
      displayMathSource,
      escapeAttribute,
      escapeHtml,
      formatMermaidZoomPercent,
      hasPipe,
      isDisplayMathBlock,
      isHeadingLine,
      isHorizontalRule,
      isListLine,
      isProseMirrorRichActive,
      isQuoteLine,
      isTableStart,
      isTocLine,
      isUnsafeRelativePath,
      mermaidZoomValue,
      normalizeAssetPath,
      normalizeNewlines,
      parseAlign,
      safeCodeLanguage,
      setStatus,
      slugify,
      splitTableRow,
      stripExtension,
      stripInlineMarkdown,
      stripRichCaretTokens,
      wrapRenderedInlineAtoms,
    },
  });

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    cacheElements();
    restoreSettings();
    restoreDraft();
    if (state.desktopHost) state.markdownRelativePath = '';
    bindEvents();
    applyTheme();
    initializeVendorLibraries();
    els.source.value = state.markdown;
    initializeCodeMirrorSourceEditor();
    applyMode(state.mode, { preserveScroll: false });
    renderAll('init');
    if (state.desktopHost) {
      initializeDesktopBridge();
      setStatus('Windowsアプリに接続しました');
    } else {
      setStatus('準備完了');
      restorePersistedSettingsDirectoryHandle();
      restorePersistedDirectoryHandle();
      restorePickerStartDirectoryHandle();
    }
  }

  function detectDesktopHost() {
    const currentLocation = window.location;
    return Boolean(
      window.chrome?.webview?.postMessage
      && currentLocation?.protocol === 'https:'
      && currentLocation?.hostname === DESKTOP_APP_HOST
      && /(?:^|[?&])desktop=1(?:&|$)/.test(currentLocation.search || '')
    );
  }

  function initializeDesktopBridge() {
    document.body.dataset.desktopHost = 'true';
    window.chrome.webview.addEventListener('message', onDesktopHostMessage);
    postDesktopMessage({
      type: 'desktop.ready',
      dirty: state.dirty,
      fileName: state.fileName,
    });
    notifyDesktopDocumentState(true);
  }

  function postDesktopMessage(message) {
    if (!state.desktopHost) return false;
    try {
      window.chrome.webview.postMessage(message);
      return true;
    } catch (_) {
      setStatus('Windowsアプリとの通信に失敗しました');
      return false;
    }
  }

  function requestDesktopCommand(command) {
    if (!state.desktopHost) return false;
    postDesktopMessage({ type: 'desktop.command', command });
    return true;
  }

  function notifyDesktopDocumentState(force = false) {
    if (!state.desktopHost) return;
    if (
      !force
      && state.desktopLastReportedDirty === state.dirty
      && state.desktopLastReportedFileName === state.fileName
    ) return;
    state.desktopLastReportedDirty = state.dirty;
    state.desktopLastReportedFileName = state.fileName;
    postDesktopMessage({
      type: 'desktop.documentState',
      dirty: state.dirty,
      fileName: state.fileName,
    });
  }

  function onDesktopHostMessage(event) {
    const message = parseDesktopHostMessage(event?.data);
    if (!message) return;
    switch (message.type) {
      case 'host.loadDocument':
        applyDesktopDocument(message, 'ファイルを開きました');
        break;
      case 'host.newDocument':
        applyDesktopDocument(message, '新規文書を作成しました');
        break;
      case 'host.requestSnapshot':
        sendDesktopDocumentSnapshot(message.requestId);
        break;
      case 'host.documentSaved':
        applyDesktopSavedState(message);
        break;
      case 'host.assetSaved':
        resolveDesktopAssetRequest(message);
        break;
      case 'host.imageReferencesResolved':
        applyDesktopImageReferenceAliases(message);
        break;
      case 'host.error':
        rejectDesktopAssetRequest(message);
        setStatus(String(message.message || 'Windows側の処理に失敗しました'));
        break;
      case 'host.status':
        setStatus(String(message.message || ''));
        break;
      default:
        break;
    }
  }

  function parseDesktopHostMessage(value) {
    if (value && typeof value === 'object') return value;
    if (typeof value !== 'string' || value.length > 12 * 1024 * 1024) return null;
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  function applyDesktopDocument(message, statusMessage) {
    clearAssetUrls();
    resetDesktopImageReferenceAliases();
    state.directoryHandle = null;
    state.directoryName = '';
    state.fileHandle = null;
    state.desktopDocumentReady = message.hasDocumentFolder === true;
    state.markdown = stripRichCaretTokens(normalizeNewlines(String(message.markdown || '')));
    state.fileName = safeFileName(message.fileName || 'untitled.md');
    state.markdownRelativePath = state.desktopDocumentReady ? state.fileName : '';
    state.dirty = message.dirty === true;
    els.source.value = state.markdown;
    syncCodeMirrorSourceFromTextarea('desktop-document');
    renderAll('desktop-document');
    persistDraft();
    notifyDesktopDocumentState(true);
    setStatus(statusMessage);
  }

  function sendDesktopDocumentSnapshot(requestId) {
    if (typeof requestId !== 'string' || requestId.length > 100) return;
    captureCurrentMarkdownFromEditor();
    postDesktopMessage({
      type: 'desktop.documentSnapshot',
      requestId,
      markdown: state.markdown,
      fileName: state.fileName,
    });
  }

  function applyDesktopSavedState(message) {
    state.fileName = safeFileName(message.fileName || state.fileName || 'untitled.md');
    state.desktopDocumentReady = message.hasDocumentFolder === true;
    state.markdownRelativePath = state.desktopDocumentReady ? state.fileName : '';
    state.dirty = false;
    resetDesktopImageReferenceAliases();
    renderPreview();
    state.proseMirrorRich?.refreshImages?.();
    persistDraft();
    updateStatusBar();
    notifyDesktopDocumentState(true);
    setStatus(`${state.fileName} を保存しました`);
  }

  function resolveDesktopAssetRequest(message) {
    const request = state.desktopAssetRequests.get(message.requestId);
    if (!request) return;
    const markdownPath = normalizeAssetPath(message.markdownPath || '');
    if (!markdownPath || isUnsafeRelativePath(markdownPath) || !hasRasterImageExtension(markdownPath)) {
      rejectDesktopAssetRequest({
        requestId: message.requestId,
        message: 'Windows側から安全な画像パスを受け取れませんでした',
      });
      return;
    }
    window.clearTimeout(request.timer);
    state.desktopAssetRequests.delete(message.requestId);
    request.resolve({
      fileName: safeFileName(message.fileName || 'image.png'),
      markdownPath,
    });
  }

  function rejectDesktopAssetRequest(message) {
    const request = state.desktopAssetRequests.get(message.requestId);
    if (!request) return;
    window.clearTimeout(request.timer);
    state.desktopAssetRequests.delete(message.requestId);
    request.reject(new Error(String(message.message || '画像の保存に失敗しました')));
  }

  function resetDesktopImageReferenceAliases() {
    state.desktopImageAliases.clear();
    state.desktopImageReferencesKey = '';
    state.desktopImageReferenceRequestId = '';
  }

  function requestDesktopImageReferenceAliases() {
    if (!state.desktopHost || !state.desktopDocumentReady) return;
    const references = absoluteImageReferencesFromMarkdown(state.markdown);
    const key = references.map(desktopImageAliasKey).sort().join('\n');
    if (key === state.desktopImageReferencesKey) return;
    state.desktopImageReferencesKey = key;
    state.desktopImageAliases.clear();
    if (!references.length) {
      state.desktopImageReferenceRequestId = '';
      return;
    }
    const requestId = `image-refs-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    state.desktopImageReferenceRequestId = requestId;
    postDesktopMessage({
      type: 'desktop.resolveImageReferences',
      requestId,
      references,
    });
  }

  function applyDesktopImageReferenceAliases(message) {
    if (!message || message.requestId !== state.desktopImageReferenceRequestId) return;
    state.desktopImageReferenceRequestId = '';
    state.desktopImageAliases.clear();
    const aliases = message.aliases && typeof message.aliases === 'object' ? message.aliases : {};
    for (const [reference, relativePath] of Object.entries(aliases)) {
      const normalized = normalizeAssetPath(relativePath);
      if (!normalized || isUnsafeRelativePath(normalized) || !hasRasterImageExtension(normalized)) continue;
      state.desktopImageAliases.set(desktopImageAliasKey(reference), normalized);
    }
    renderPreview();
    state.proseMirrorRich?.refreshImages?.();
  }

  function absoluteImageReferencesFromMarkdown(markdown) {
    const references = [];
    const seen = new Set();
    const pattern = /!\[[^\]\n]*\]\((<[^>\n]+>|[^)\n]+)\)/g;
    for (const match of String(markdown || '').matchAll(pattern)) {
      const target = decodeLocalImagePath(parseMarkdownTarget(match[1] || ''));
      if (!isLocalAbsoluteImageReference(target) || !hasRasterImageExtension(target)) continue;
      const key = desktopImageAliasKey(target);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      references.push(target);
      if (references.length >= 64) break;
    }
    return references;
  }

  function desktopImageAliasKey(value) {
    return decodeLocalImagePath(String(value || '').trim()).replace(/\//g, '\\').toLowerCase();
  }

  function cacheElements() {
    els.body = document.body;
    els.source = document.getElementById('sourceEditor');
    els.preview = document.getElementById('preview');
    els.rich = document.getElementById('richEditor');
    els.outline = document.getElementById('outline');
    els.fileInput = document.getElementById('fileInput');
    els.folderInput = document.getElementById('folderInput');
    els.imageInput = document.getElementById('imageInput');
    els.settingsInput = document.getElementById('settingsInput');
    els.status = document.getElementById('statusMessage');
    els.stats = document.getElementById('documentStats');
    els.saveState = document.getElementById('saveState');
    els.fileNameLabel = document.getElementById('fileNameLabel');
    els.securityDialog = document.getElementById('securityDialog');
    els.linkDomainDialog = document.getElementById('linkDomainDialog');
    els.allowedDomainsInput = document.getElementById('allowedDomainsInput');
    els.markdownEntryDialog = document.getElementById('markdownEntryDialog');
    els.markdownEntryList = document.getElementById('markdownEntryList');
    els.markdownEntryCancel = document.getElementById('markdownEntryCancel');
    els.folderScanWarningDialog = document.getElementById('folderScanWarningDialog');
    els.folderScanWarningMessage = document.getElementById('folderScanWarningMessage');
    els.inlineInsertDialog = document.getElementById('inlineInsertDialog');
    els.inlineInsertTitle = document.getElementById('inlineInsertTitle');
    els.inlineInsertDescription = document.getElementById('inlineInsertDescription');
    els.inlineInsertLabel = document.getElementById('inlineInsertLabel');
    els.inlineInsertTarget = document.getElementById('inlineInsertTarget');
    els.inlineInsertTargetLabel = document.getElementById('inlineInsertTargetLabel');
  }

  function restoreSettings() {
    const settings = readJson(SETTINGS_KEY);
    state.theme = settings?.theme || defaultTheme();
    state.mode = settings?.mode || 'rich';
    state.outlineCollapsed = Boolean(settings?.outlineCollapsed);
    state.allowedLinkDomains = normalizeDomainList(settings?.allowedLinkDomains || []);
  }

  function defaultTheme() {
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    return prefersDark ? 'dark' : 'light';
  }

  function restoreDraft() {
    const draft = readJson(STORAGE_KEY);
    if (!draft || typeof draft.markdown !== 'string') return;
    state.markdown = stripRichCaretTokens(draft.markdown);
    state.fileName = safeFileName(draft.fileName || 'untitled.md');
    state.markdownRelativePath = normalizeAssetPath(draft.markdownRelativePath || '');
    state.lastAutoSaved = draft.savedAt || null;
    state.dirty = draft.dirty !== false;
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

  async function restorePersistedDirectoryHandle() {
    if (!state.markdownRelativePath || state.directoryHandle) return false;
    if (!canPersistDirectoryHandle()) return false;
    try {
      const directoryHandle = await readPersistedDirectoryHandle();
      if (!directoryHandle) return false;
      const permission = await queryDirectoryPermission(directoryHandle, 'read');
      if (permission !== 'granted') {
        setStatus('前回のフォルダ権限が必要です。「フォルダ許可」または「フォルダから開く」を使ってください');
        return false;
      }
      const entries = await collectLimitedDirectoryEntries(directoryHandle);
      state.directoryHandle = directoryHandle;
      state.pickerStartDirectoryHandle = directoryHandle;
      state.directoryName = directoryHandle.name || '';
      clearAssetUrls();
      buildFolderAssetUrls(entries, dirnamePath(state.markdownRelativePath));
      renderAll('restore-folder');
      setStatus(`${state.fileName} のフォルダ参照をFile System Access APIから復元しました。画像候補: ${state.assetUrls.size}${folderScanStatusSuffix()}`);
      return true;
    } catch (_) {
      setStatus('前回のフォルダ参照を復元できませんでした。「フォルダ許可」または「フォルダから開く」を使ってください');
      return false;
    }
  }

  function canPersistDirectoryHandle() {
    return Boolean(window.isSecureContext && window.indexedDB);
  }

  async function restorePersistedSettingsDirectoryHandle() {
    if (!canPersistDirectoryHandle()) return false;
    try {
      const directoryHandle = await readPersistedSettingsDirectoryHandle();
      if (!directoryHandle) return false;
      const permission = await queryDirectoryPermission(directoryHandle, 'readwrite');
      if (permission !== 'granted') {
        setStatus('設定フォルダ権限が必要です。「リンク許可」から設定フォルダを再許可してください');
        return false;
      }
      state.settingsDirectoryHandle = directoryHandle;
      state.settingsDirectoryName = directoryHandle.name || '';
      const loaded = await loadSettingsFromConfigDirectory(directoryHandle, { missingOk: true });
      if (loaded) {
        setStatus(`${CONFIG_SETTINGS_FILE_NAME} から外部リンク許可ドメインを自動読み込みしました: ${state.allowedLinkDomains.length}件`);
      }
      return loaded;
    } catch (_) {
      setStatus('前回の設定フォルダを復元できませんでした。「リンク許可」から設定フォルダを再許可してください');
      return false;
    }
  }

  async function persistDirectoryHandle(directoryHandle) {
    if (!directoryHandle || !canPersistDirectoryHandle()) return false;
    try {
      const db = await openFsaDatabase();
      await idbRequest(db.transaction(FSA_STORE_NAME, 'readwrite').objectStore(FSA_STORE_NAME).put(directoryHandle, FSA_DIRECTORY_HANDLE_KEY));
      db.close();
      return true;
    } catch (_) {
      return false;
    }
  }

  async function rememberPickerStartDirectory(directoryHandle) {
    if (!directoryHandle) return false;
    state.pickerStartDirectoryHandle = directoryHandle;
    if (!canPersistDirectoryHandle()) return false;
    try {
      const db = await openFsaDatabase();
      await idbRequest(db.transaction(FSA_STORE_NAME, 'readwrite').objectStore(FSA_STORE_NAME).put(directoryHandle, FSA_PICKER_START_HANDLE_KEY));
      db.close();
      return true;
    } catch (_) {
      return false;
    }
  }

  async function persistSettingsDirectoryHandle(directoryHandle) {
    if (!directoryHandle || !canPersistDirectoryHandle()) return false;
    try {
      const db = await openFsaDatabase();
      await idbRequest(db.transaction(FSA_STORE_NAME, 'readwrite').objectStore(FSA_STORE_NAME).put(directoryHandle, FSA_SETTINGS_DIRECTORY_HANDLE_KEY));
      db.close();
      return true;
    } catch (_) {
      return false;
    }
  }

  async function readPersistedDirectoryHandle() {
    const db = await openFsaDatabase();
    try {
      return await idbRequest(db.transaction(FSA_STORE_NAME, 'readonly').objectStore(FSA_STORE_NAME).get(FSA_DIRECTORY_HANDLE_KEY));
    } finally {
      db.close();
    }
  }

  async function readPersistedSettingsDirectoryHandle() {
    const db = await openFsaDatabase();
    try {
      return await idbRequest(db.transaction(FSA_STORE_NAME, 'readonly').objectStore(FSA_STORE_NAME).get(FSA_SETTINGS_DIRECTORY_HANDLE_KEY));
    } finally {
      db.close();
    }
  }

  async function readPickerStartDirectoryHandle() {
    if (state.pickerStartDirectoryHandle) return state.pickerStartDirectoryHandle;
    if (!canPersistDirectoryHandle()) return null;
    const db = await openFsaDatabase();
    try {
      const handle = await idbRequest(db.transaction(FSA_STORE_NAME, 'readonly').objectStore(FSA_STORE_NAME).get(FSA_PICKER_START_HANDLE_KEY));
      if (!state.pickerStartDirectoryHandle) state.pickerStartDirectoryHandle = handle || null;
      return state.pickerStartDirectoryHandle;
    } catch (_) {
      return null;
    } finally {
      db.close();
    }
  }

  async function restorePickerStartDirectoryHandle() {
    try {
      await readPickerStartDirectoryHandle();
      return Boolean(state.pickerStartDirectoryHandle);
    } catch (_) {
      return false;
    }
  }

  async function clearPersistedDirectoryHandle() {
    if (!canPersistDirectoryHandle()) return false;
    try {
      const db = await openFsaDatabase();
      await idbRequest(db.transaction(FSA_STORE_NAME, 'readwrite').objectStore(FSA_STORE_NAME).delete(FSA_DIRECTORY_HANDLE_KEY));
      db.close();
      return true;
    } catch (_) {
      return false;
    }
  }

  function deleteFsaDatabase() {
    return new Promise((resolve) => {
      if (!window.indexedDB) {
        resolve(false);
        return;
      }
      const request = window.indexedDB.deleteDatabase(FSA_DB_NAME);
      request.onsuccess = () => resolve(true);
      request.onerror = () => resolve(false);
      request.onblocked = () => resolve(false);
    });
  }

  function openFsaDatabase() {
    return new Promise((resolve, reject) => {
      const request = window.indexedDB.open(FSA_DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(FSA_STORE_NAME)) db.createObjectStore(FSA_STORE_NAME);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDBを開けませんでした'));
    });
  }

  function idbRequest(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB操作に失敗しました'));
    });
  }

  function bindEvents() {
    document.addEventListener('click', onDocumentClick);
    document.addEventListener('change', onDocumentChange);
    document.addEventListener('keydown', onKeyboardShortcutKeyDown, true);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onDocumentKeyUp);
    document.addEventListener('beforeinput', onDocumentBeforeInput, true);
    document.addEventListener('selectionchange', onSelectionChange);
    document.addEventListener('focusin', onDocumentFocusIn);
    document.addEventListener('wheel', onDocumentWheel, { passive: false });
    document.addEventListener('pointerdown', onDocumentPointerDown);
    document.addEventListener('pointermove', onDocumentPointerMove);
    document.addEventListener('pointerup', onDocumentPointerEnd);
    document.addEventListener('pointercancel', onDocumentPointerEnd);

    els.source.addEventListener('input', handleSourceTextareaInput);

    els.source.addEventListener('scroll', syncPreviewScroll);
    els.source.addEventListener('keyup', syncPreviewScroll);
    els.source.addEventListener('mouseup', syncPreviewScroll);
    els.preview.addEventListener('scroll', syncSourceScroll);
    els.preview.addEventListener('keyup', syncSourceScroll);
    els.preview.addEventListener('mouseup', syncSourceScroll);
    els.preview.addEventListener('error', onPreviewImageError, true);
    els.source.addEventListener('paste', onMarkdownPaste);
    els.source.addEventListener('dragover', onEditorDragOver);
    els.source.addEventListener('dragleave', onEditorDragLeave);
    els.source.addEventListener('drop', onEditorDrop);
    els.fileInput.addEventListener('change', onFileChosen);
    els.folderInput.addEventListener('change', onFolderChosen);
    els.imageInput.addEventListener('change', onImageChosen);
    els.settingsInput.addEventListener('change', onSettingsFileChosen);
    els.inlineInsertDialog.addEventListener('close', () => {
      if (els.inlineInsertDialog.returnValue !== 'inserted') state.pendingInlineInsertContext = null;
    });
    els.rich.removeAttribute('contenteditable');
    els.rich.setAttribute('role', 'textbox');
    els.rich.setAttribute('aria-multiline', 'true');
    els.rich.setAttribute('aria-label', 'リッチMarkdown編集');
    els.rich.addEventListener('input', onRichInput);
    els.rich.addEventListener('paste', onRichPaste);
    els.rich.addEventListener('cut', onRichCut);
    els.rich.addEventListener('dragover', onEditorDragOver);
    els.rich.addEventListener('dragleave', onEditorDragLeave);
    els.rich.addEventListener('drop', onEditorDrop);
    els.rich.addEventListener('compositionstart', () => { state.richComposing = true; });
    els.rich.addEventListener('compositionend', onRichCompositionEnd);
    els.rich.addEventListener('pointerdown', onRichPointerDownCapture, true);
    els.rich.addEventListener('click', onRichClick);

    window.addEventListener('beforeunload', (event) => {
      if (state.desktopHost || !state.dirty) return;
      event.preventDefault();
      event.returnValue = '';
    });
  }

  function initializeCodeMirrorSourceEditor() {
    if (!els.source || state.codeMirrorSource || state.codeMirrorSourceLoading) return;
    state.codeMirrorSourceLoading = true;
    const createEditor = window.PMECodeMirrorSourceEditor?.createPortableMarkdownSourceEditor;
    if (typeof createEditor !== 'function') {
      state.codeMirrorSource = null;
      state.codeMirrorSourceReady = false;
      state.codeMirrorSourceLoading = false;
      els.source.closest?.('.source-pane')?.classList.remove('is-codemirror-ready');
      setStatus('CodeMirrorソースエディタを読み込めませんでした。textareaで続行します');
      return;
    }

    try {
      state.codeMirrorSource = createEditor({
        textarea: els.source,
        onChange: handleCodeMirrorSourceChange,
        onScroll: syncPreviewScroll,
        onSelectionChange: syncPreviewScroll,
        onPaste: onMarkdownPaste,
        onDragOver: onEditorDragOver,
        onDragLeave: onEditorDragLeave,
        onDrop: onEditorDrop,
      });
      state.codeMirrorSourceReady = true;
      els.source.closest?.('.source-pane')?.classList.add('is-codemirror-ready');
      syncCodeMirrorSourceFromTextarea('codemirror-init');
      refreshCodeMirrorSourceEditorSoon();
    } catch (_error) {
      state.codeMirrorSource = null;
      state.codeMirrorSourceReady = false;
      els.source.closest?.('.source-pane')?.classList.remove('is-codemirror-ready');
      setStatus('CodeMirrorソースエディタを読み込めませんでした。textareaで続行します');
    } finally {
      state.codeMirrorSourceLoading = false;
    }
  }

  function isCodeMirrorSourceReady() {
    return Boolean(state.codeMirrorSourceReady && state.codeMirrorSource);
  }

  function handleSourceTextareaInput() {
    handleSourceValueChange(els.source.value, { source: 'textarea' });
  }

  function handleCodeMirrorSourceChange(value) {
    handleSourceValueChange(value, { source: 'codemirror' });
  }

  function handleSourceValueChange(value, options = {}) {
    const markdown = stripRichCaretTokens(normalizeNewlines(value));
    state.markdown = markdown;
    if (els.source.value !== markdown) els.source.value = markdown;
    if (options.source !== 'codemirror') syncCodeMirrorSourceFromTextarea('source-input');
    markDirty();
    if (options.renderNow) {
      window.clearTimeout(state.renderTimer);
      renderAll(options.reason || 'edit');
    } else {
      scheduleRender(options.reason || 'edit');
    }
    scheduleAutosave();
  }

  function sourceMarkdownValue() {
    const value = isCodeMirrorSourceReady()
      ? state.codeMirrorSource.value()
      : (els.source?.value ?? state.markdown ?? '');
    return stripRichCaretTokens(normalizeNewlines(value));
  }

  function syncCodeMirrorSourceFromTextarea(_reason = 'sync') {
    if (!isCodeMirrorSourceReady()) return;
    state.codeMirrorSource.setValue(els.source.value || state.markdown || '', { silent: true });
  }

  function refreshCodeMirrorSourceEditorSoon() {
    if (!isCodeMirrorSourceReady()) return;
    const refresh = () => state.codeMirrorSource?.refresh?.();
    window.requestAnimationFrame(() => {
      refresh();
      window.setTimeout(refresh, 80);
    });
  }

  function focusSourceEditor() {
    if (isCodeMirrorSourceReady()) {
      state.codeMirrorSource.focus();
      return els.source;
    }
    els.source.focus();
    return els.source;
  }

  function sourceSelectionRange() {
    if (isCodeMirrorSourceReady()) return state.codeMirrorSource.selection();
    return {
      start: els.source.selectionStart,
      end: els.source.selectionEnd,
      anchor: els.source.selectionStart,
      head: els.source.selectionEnd,
    };
  }

  function setSourceSelectionRange(start, end = start, options = {}) {
    if (isCodeMirrorSourceReady()) {
      state.codeMirrorSource.setSelection(start, end, options);
      return;
    }
    els.source.focus();
    els.source.setSelectionRange(start, end);
  }

  function replaceSourceRange(from, to, replacement, options = {}) {
    const current = sourceMarkdownValue();
    const start = Math.max(0, Math.min(current.length, Number(from)));
    const end = Math.max(start, Math.min(current.length, Number(to)));
    const insert = normalizeNewlines(replacement);
    const nextStart = Number.isInteger(options.selectionStart) ? options.selectionStart : start + insert.length;
    const nextEnd = Number.isInteger(options.selectionEnd) ? options.selectionEnd : nextStart;
    if (isCodeMirrorSourceReady()) {
      state.codeMirrorSource.replaceRange(start, end, insert, {
        selectionStart: nextStart,
        selectionEnd: nextEnd,
        focus: options.focus !== false,
      });
      if (options.renderNow) {
        window.clearTimeout(state.renderTimer);
        renderAll(options.reason || 'edit');
      }
      return;
    }

    els.source.value = current.slice(0, start) + insert + current.slice(end);
    els.source.focus();
    els.source.setSelectionRange(nextStart, nextEnd);
    handleSourceValueChange(els.source.value, {
      source: 'textarea',
      renderNow: Boolean(options.renderNow),
      reason: options.reason || 'edit',
    });
  }

  function sourceScrollElement() {
    return isCodeMirrorSourceReady() ? state.codeMirrorSource.scrollElement() : els.source;
  }

  function isProseMirrorRichActive() {
    return Boolean(state.proseMirrorRichActive && state.proseMirrorRich);
  }

  function isProseMirrorRichTarget(target) {
    return Boolean(target && els.rich?.contains(target) && nodeElement(target)?.closest?.('.ProseMirror'));
  }

  function prosemirrorAtomSourceElement(target) {
    return nodeElement(target)?.closest?.('.pme-image-node, .pme-math-node, .pme-mermaid-node, .pme-toc-node') || null;
  }

  function isProseMirrorAtomSourceTarget(target) {
    const element = nodeElement(target);
    return Boolean(element?.closest?.('.pme-node-source-editor, .pme-link-href-editor') || prosemirrorAtomSourceElement(element));
  }

  function isProseMirrorRichEventContext(event) {
    const target = eventTargetElement(event);
    if (isProseMirrorRichTarget(target)) return true;
    if (!isProseMirrorRichActive() || !target || !els.rich?.contains(target)) return false;
    const active = nodeElement(document.activeElement);
    if (active && els.rich.contains(active) && active.closest?.('.ProseMirror')) return true;
    const selection = window.getSelection?.();
    const anchor = nodeElement(selection?.anchorNode);
    return Boolean(anchor && els.rich.contains(anchor) && anchor.closest?.('.ProseMirror'));
  }

  function isSelectionInsideProseMirror(proseMirror) {
    const selection = window.getSelection?.();
    const anchor = nodeElement(selection?.anchorNode);
    return Boolean(anchor && proseMirror?.contains(anchor));
  }

  function focusProseMirrorElement(proseMirror) {
    if (!proseMirror || document.activeElement === proseMirror) return;
    proseMirror.focus({ preventScroll: true });
  }

  function scheduleProseMirrorFocus(proseMirror) {
    window.clearTimeout(state.proseMirrorFocusTimer);
    state.proseMirrorFocusTimer = window.setTimeout(() => {
      if (!isProseMirrorRichActive() || !isSelectionInsideProseMirror(proseMirror)) return;
      focusProseMirrorElement(proseMirror);
    }, 0);
  }

  function focusProseMirrorTarget(target) {
    const proseMirror = nodeElement(target)?.closest?.('.ProseMirror');
    if (!proseMirror) return;
    scheduleProseMirrorFocus(proseMirror);
  }

  function focusProseMirrorSelection() {
    if (!isProseMirrorRichActive()) return false;
    const selection = window.getSelection?.();
    const proseMirror = nodeElement(selection?.anchorNode)?.closest?.('.ProseMirror');
    if (!proseMirror || !els.rich?.contains(proseMirror)) return false;
    scheduleProseMirrorFocus(proseMirror);
    return true;
  }

  function isReadOnlyRichFallbackActive() {
    return state.mode === 'rich' && !isProseMirrorRichActive();
  }

  function guardReadOnlyRichFallbackAction(actionLabel = 'この操作') {
    if (!isReadOnlyRichFallbackActive()) return false;
    setStatus(`${actionLabel}: ProseMirrorを初期化できないため、リッチ表示は読み取り専用です。ソース編集を使用してください`);
    return true;
  }

  function proseMirrorUnsupportedReason(markdown = state.markdown) {
    const detector = window.PMEProseMirror?.unsupportedMarkdownReason;
    return typeof detector === 'function' ? detector(markdown || '') : '';
  }

  function ensureProseMirrorRichEditor() {
    if (state.proseMirrorRich) return true;
    const factory = window.PMEProseMirror?.createRichMarkdownEditor;
    if (typeof factory !== 'function') return false;
    state.proseMirrorRich = factory({
      mount: els.rich,
      markdown: state.markdown,
      onChange: handleProseMirrorRichChange,
      resolveImageSrc: sanitizeImageUrl,
      imageBlockReason,
    });
    return true;
  }

  function renderProseMirrorRich() {
    if (!window.PMEProseMirror) {
      state.proseMirrorRichFallbackReason = 'prosemirror-unavailable';
      return false;
    }
    const reason = proseMirrorUnsupportedReason(state.markdown);
    if (reason) {
      teardownProseMirrorRichEditor();
      state.proseMirrorRichFallbackReason = reason;
      return false;
    }
    state.proseMirrorRichFallbackReason = '';
    try {
      if (!ensureProseMirrorRichEditor()) {
        state.proseMirrorRichFallbackReason = 'prosemirror-init-failed';
        return false;
      }
      if (!state.proseMirrorRich.setMarkdown(state.markdown)) {
        teardownProseMirrorRichEditor();
        state.proseMirrorRichFallbackReason = 'prosemirror-set-markdown-failed';
        return false;
      }
      if (typeof state.proseMirrorRich.refreshImages === 'function') {
        state.proseMirrorRich.refreshImages();
      }
    } catch (error) {
      teardownProseMirrorRichEditor();
      state.proseMirrorRichFallbackReason = String(error?.message || 'prosemirror-error').slice(0, 120);
      return false;
    }
    state.proseMirrorRichActive = true;
    els.rich.classList.add('is-prosemirror-rich');
    els.rich.classList.remove('is-prosemirror-fallback');
    delete els.rich.dataset.richFallback;
    els.rich.removeAttribute('contenteditable');
    els.rich.removeAttribute('aria-readonly');
    els.rich.setAttribute('role', 'textbox');
    els.rich.setAttribute('aria-multiline', 'true');
    els.rich.setAttribute('aria-label', 'リッチMarkdown編集');
    return true;
  }

  function teardownProseMirrorRichEditor() {
    if (state.proseMirrorRich) {
      state.proseMirrorRich.destroy();
      state.proseMirrorRich = null;
    }
    state.proseMirrorRichActive = false;
    els.rich?.classList?.remove('is-prosemirror-rich');
  }

  function renderReadOnlyRichFallback() {
    const reason = state.proseMirrorRichFallbackReason || 'prosemirror-unavailable';
    const html = renderMarkdownHtml(state.markdown);
    safeSetHtml(els.rich, html || '<p><br></p>');
    configureReadOnlyRichFallbackSurface(reason);
    setStatus(`ProseMirrorを初期化できないため、リッチ表示は読み取り専用です: ${reason}`);
  }

  function configureReadOnlyRichFallbackSurface(reason) {
    els.rich.classList.add('is-prosemirror-fallback');
    els.rich.classList.remove('is-prosemirror-rich');
    els.rich.dataset.richFallback = reason;
    els.rich.removeAttribute('contenteditable');
    els.rich.setAttribute('role', 'document');
    els.rich.setAttribute('aria-readonly', 'true');
    els.rich.querySelectorAll('[contenteditable]').forEach((node) => node.removeAttribute('contenteditable'));
    els.rich.querySelectorAll('input, textarea, button, select').forEach((node) => {
      node.disabled = true;
      node.setAttribute('aria-disabled', 'true');
    });
  }

  function handleProseMirrorRichChange(markdown) {
    state.markdown = stripRichCaretTokens(normalizeNewlines(markdown));
    els.source.value = state.markdown;
    syncCodeMirrorSourceFromTextarea('prosemirror-rich-input');
    markDirty();
    renderPreview();
    renderOutline();
    updateStatusBar();
    scheduleAutosave();
  }

  function applyProseMirrorFormat(format) {
    if (!isProseMirrorRichActive()) return false;
    if (state.proseMirrorRich.applyFormat(format)) {
      renderPreview();
      renderOutline();
      updateStatusBar();
      scheduleAutosave();
      setStatus(`ProseMirror: ${format} を適用しました`);
      return true;
    }
    if (format === 'table') {
      insertProseMirrorMarkdown('| 項目 | 内容 |\n| --- | --- |\n| 例 | テキスト |', { status: '表を挿入しました' });
      return true;
    }
    if (format === 'toc') {
      insertProseMirrorMarkdown('[toc]', { status: '目次を挿入しました' });
      return true;
    }
    if (format === 'math') {
      const selected = state.proseMirrorRich.selectedText().trim();
      insertProseMirrorMarkdown(`$${selected || 'x'}$`, { inline: true, status: 'インライン数式を挿入しました' });
      return true;
    }
    setStatus('この操作はProseMirrorリッチ編集では未対応です');
    return true;
  }

  function insertProseMirrorMarkdown(markdown, options = {}) {
    if (!isProseMirrorRichActive()) return false;
    if (!state.proseMirrorRich.insertMarkdown(markdown, options)) return false;
    setStatus(options.status || 'ProseMirrorリッチ編集へ挿入しました');
    return true;
  }

  function onDocumentClick(event) {
    const target = eventTargetElement(event);
    if (!isProseMirrorRichActive()) {
      commitActiveRichInlineSourceForTarget(target);
      cancelActiveRichSourceEditorForTarget(target);
      if (state.mode === 'rich') parsePendingRichMathShortcutAwayFromTarget(target);
    }

    const actionButton = event.target.closest('[data-action]');
    if (!actionButton) return;

    const action = actionButton.dataset.action;
    switch (action) {
      case 'new':
        newDocument();
        break;
      case 'open':
        openMarkdownFile();
        break;
      case 'open-folder':
        openFolder();
        break;
      case 'grant-folder':
        grantFolderForCurrentDocument();
        break;
      case 'save-md':
        saveMarkdown();
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
      case 'link-settings':
        showLinkDomainDialog();
        break;
      case 'save-link-domains':
        saveLinkDomains();
        break;
      case 'import-settings':
        openSettingsFile();
        break;
      case 'export-settings':
        exportSettingsFile();
        break;
      case 'grant-settings-folder':
        grantSettingsDirectory();
        break;
      case 'save-settings-file':
        saveSettingsToConfigDirectory();
        break;
      case 'clear-draft':
        clearDraftData();
        break;
      case 'reset-settings':
        resetSettingsData();
        break;
      case 'clear-allowed-domains':
        clearAllowedDomainsData();
        break;
      case 'clear-folder-permissions':
        clearFolderPermissionRecords();
        break;
      case 'clear-all-local-data':
        clearAllLocalData();
        break;
      case 'format':
        applyFormat(actionButton.dataset.format);
        break;
      case 'insert-link':
        insertLink();
        break;
      case 'insert-image':
        beginImageInsertion(event);
        break;
      case 'insert-image-ref':
        insertImageReference();
        break;
      case 'confirm-inline-insert':
        confirmInlineInsertDialog();
        break;
      case 'cancel-inline-insert':
        cancelInlineInsertDialog();
        break;
      case 'insert-code-block':
        insertCodeBlock();
        break;
      case 'insert-math-block':
        insertMathBlock();
        break;
      case 'insert-mermaid':
        insertMermaid();
        break;
      case 'mermaid-zoom':
        handleMermaidZoom(actionButton);
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
      default:
        break;
    }
  }

  function commitActiveRichInlineSourceForTarget(target) {
    const active = state.richInlineSource?.element;
    if (!active || !target || active.contains(target)) return false;
    if (!els.rich?.contains(active)) {
      state.richInlineSource = null;
      return false;
    }
    const committed = commitRichInlineSource(active);
    if (committed) suppressRichInlineActivation();
    return committed;
  }

  function onDocumentWheel(event) {
    const target = eventTargetElement(event)?.closest?.('.mermaid-render-target.is-zoomable');
    if (!target) return;
    const figure = target.closest('.mermaid-diagram');
    if (!figure) return;
    event.preventDefault();
    const current = mermaidZoomValue(figure);
    const factor = Math.exp(-event.deltaY * MERMAID_WHEEL_ZOOM_SENSITIVITY);
    setMermaidZoom(figure, current * factor, {
      clientX: event.clientX,
      clientY: event.clientY,
    });
  }

  function onDocumentPointerDown(event) {
    if (event.button !== 0) return;
    const target = eventTargetElement(event);
    state.richLineBreakInputOffset = null;
    clearRichTransactionBlankForPointer(target);
    parsePendingRichInlineMarkdownBeforePointer(target);
    const renderTarget = target?.closest?.('.mermaid-render-target.is-zoomable');
    if (!renderTarget || !els.preview.contains(renderTarget)) return;
    if (target.closest('button, input, textarea, select, a, .rich-source-editor, .rich-source-actions')) return;
    state.mermaidPan = {
      target: renderTarget,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: renderTarget.scrollLeft,
      scrollTop: renderTarget.scrollTop,
      moved: false,
    };
    renderTarget.classList.add('is-panning');
    renderTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function onDocumentPointerMove(event) {
    const pan = state.mermaidPan;
    if (!pan || pan.pointerId !== event.pointerId || !pan.target.isConnected) return;
    const dx = event.clientX - pan.startX;
    const dy = event.clientY - pan.startY;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) pan.moved = true;
    pan.target.scrollLeft = pan.scrollLeft - dx;
    pan.target.scrollTop = pan.scrollTop - dy;
    event.preventDefault();
  }

  function onDocumentPointerEnd(event) {
    const pan = state.mermaidPan;
    if (!pan || pan.pointerId !== event.pointerId) return;
    pan.target.classList.remove('is-panning');
    pan.target.releasePointerCapture?.(event.pointerId);
    state.mermaidPan = null;
    if (pan.moved) event.preventDefault();
  }

  function onDocumentChange(event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (isProseMirrorRichTarget(target)) return;
    if (target.classList.contains('task-checkbox')) {
      updateTaskCheckbox(target);
    } else if (target.classList.contains('code-language-input')) {
      updateCodeBlockLanguage(target);
    }
  }

  function onDocumentFocusIn(event) {
    const active = state.richInlineSource?.element;
    const target = eventTargetElement(event);
    if (active && target && !active.contains(target)) {
      commitRichInlineSource(active);
    }
  }

  function onRichPointerDownCapture(event) {
    const target = eventTargetElement(event);
    const atomSource = prosemirrorAtomSourceElement(target);
    if (atomSource) {
      if (nodeElement(target)?.closest?.('button, a, input, textarea, select, option')) return;
      if (typeof atomSource.__pmeOpenSourceEditor === 'function') {
        event.preventDefault();
        event.stopPropagation();
        atomSource.__pmeOpenSourceEditor();
      }
      return;
    }
    if (isProseMirrorAtomSourceTarget(target)) return;
    const proseMirror = nodeElement(target)?.closest?.('.ProseMirror');
    if (!proseMirror || !els.rich?.contains(proseMirror)) return;
    focusProseMirrorElement(proseMirror);
  }

  function onRichClick(event) {
    const target = eventTargetElement(event);
    if (!target || !els.rich.contains(target)) return;
    if (isProseMirrorAtomSourceTarget(target)) {
      event.stopPropagation();
      return;
    }
    if (isProseMirrorRichTarget(target)) {
      focusProseMirrorTarget(target);
      return;
    }

    const activeInline = state.richInlineSource?.element;
    if (activeInline && !activeInline.contains(target)) {
      commitRichInlineSource(activeInline);
      suppressRichInlineActivation();
    }

    if (cancelActiveRichSourceEditorForTarget(target)) {
      event.stopPropagation();
      return;
    }

    if (target.closest('.rich-source-editor, .rich-source-actions')) {
      event.stopPropagation();
      return;
    }

    const mermaidZoomButton = target.closest('[data-action="mermaid-zoom"]');
    if (mermaidZoomButton && els.rich.contains(mermaidZoomButton)) {
      event.preventDefault();
      handleMermaidZoom(mermaidZoomButton);
      event.stopPropagation();
      return;
    }

    if (target.closest('.task-checkbox, .code-language-input, .rich-inline-source')) return;

    if (hasNonCollapsedRichSelection()) return;

    if (parsePendingRichMathShortcutAwayFromTarget(target)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (activatePendingMathShortcutFromSelection()) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const link = target.closest('a');
    if (link && els.rich.contains(link)) {
      handleRichLinkClick(event, link);
      return;
    }

    const inlineRendered = validRichInlineSourceElement(target.closest(RICH_INLINE_SOURCE_SELECTOR));
    if (inlineRendered) {
      const selection = window.getSelection?.();
      if (!selection || selection.isCollapsed) {
        event.preventDefault();
        activateRichInlineSource(inlineRendered, 'end');
        event.stopPropagation();
      }
      return;
    }

    const sourceBacked = findRichSourceBackedElement(target);
    if (!sourceBacked) {
      placeCaretAtPointer(event);
      return;
    }

    event.preventDefault();
    showRichSourceEditor(sourceBacked.kind, sourceBacked.element);
    event.stopPropagation();
  }

  function eventTargetElement(event) {
    const target = event.target;
    if (!target) return null;
    if (target.nodeType === 1) return target;
    return target.parentElement || null;
  }

  function richInlineSourceFromEventContext(event) {
    const targetSource = eventTargetElement(event)?.closest?.('.rich-inline-source');
    if (targetSource && els.rich.contains(targetSource)) return targetSource;
    const selection = window.getSelection?.();
    const selectionSource = nodeClosest(selection?.anchorNode, '.rich-inline-source');
    return selectionSource && els.rich.contains(selectionSource) ? selectionSource : null;
  }

  function hasNonCollapsedRichSelection() {
    const selection = window.getSelection?.();
    return Boolean(
      selection
      && selection.rangeCount
      && !selection.isCollapsed
      && els.rich.contains(selection.anchorNode)
      && els.rich.contains(selection.focusNode)
    );
  }

  function findRichSourceBackedElement(target) {
    const mermaid = target.closest('.mermaid-diagram');
    if (mermaid && els.rich.contains(mermaid)) {
      return { kind: 'mermaid', element: mermaid };
    }

    const code = target.closest('pre.code-block');
    if (code && els.rich.contains(code) && !code.closest('.mermaid-diagram')) {
      return { kind: 'code', element: code };
    }

    const math = target.closest('.math-display');
    if (math && els.rich.contains(math)) {
      return { kind: 'math', element: math };
    }

    return null;
  }

  function activeRichSourceElement() {
    return els.rich.querySelector('.is-editing-source .rich-source-editor')?.closest('.is-editing-source') || null;
  }

  function cancelActiveRichSourceEditorForTarget(target) {
    const active = activeRichSourceElement();
    if (!active) return false;
    if (target && active.contains(target)) return false;
    renderRich();
    setStatus(`${richSourceTitle(active.dataset.richSourceKind)}ソース編集をキャンセルしました`);
    return true;
  }

  function handleMermaidZoom(button) {
    const figure = button?.closest?.('.mermaid-diagram');
    if (!figure) return;
    const current = mermaidZoomValue(figure);
    const mode = button.dataset.zoom || 'reset';
    const next = mode === 'in'
      ? current * MERMAID_ZOOM_FACTOR
      : mode === 'out'
        ? current / MERMAID_ZOOM_FACTOR
        : 1;
    setMermaidZoom(figure, next);
  }

  function mermaidZoomValue(figure) {
    const value = Number.parseFloat(figure?.dataset?.mermaidZoom || '');
    return Number.isFinite(value) ? value : DEFAULT_MERMAID_ZOOM;
  }

  function setMermaidZoom(figure, zoom, options = null) {
    const next = Number(zoom);
    if (!Number.isFinite(next) || next <= 0) return;
    const target = figure.querySelector('.mermaid-render-target');
    const anchor = mermaidZoomAnchor(target, options);
    figure.dataset.mermaidZoom = String(next);
    const label = figure.querySelector('.mermaid-zoom-label');
    if (label) label.textContent = formatMermaidZoomPercent(next);
    applyMermaidZoom(target);
    restoreMermaidZoomAnchor(target, anchor);
    setStatus(`Mermaid図: ${formatMermaidZoomPercent(next)}`);
  }

  function mermaidZoomAnchor(target, options) {
    if (!target || !options || !Number.isFinite(options.clientX) || !Number.isFinite(options.clientY)) return null;
    const rect = target.getBoundingClientRect();
    const viewX = options.clientX - rect.left;
    const viewY = options.clientY - rect.top;
    if (viewX < 0 || viewY < 0 || viewX > rect.width || viewY > rect.height) return null;
    return {
      viewX,
      viewY,
      ratioX: (target.scrollLeft + viewX) / Math.max(1, target.scrollWidth),
      ratioY: (target.scrollTop + viewY) / Math.max(1, target.scrollHeight),
    };
  }

  function restoreMermaidZoomAnchor(target, anchor) {
    if (!target || !anchor) return;
    target.scrollLeft = (anchor.ratioX * target.scrollWidth) - anchor.viewX;
    target.scrollTop = (anchor.ratioY * target.scrollHeight) - anchor.viewY;
  }

  function formatMermaidZoomPercent(zoom) {
    const percent = Number(zoom) * 100;
    if (!Number.isFinite(percent) || percent <= 0) return '100%';
    if (percent >= 10) return `${Math.round(percent)}%`;
    if (percent >= 1) return `${Math.round(percent * 10) / 10}%`;
    return `${Number(percent.toPrecision(2))}%`;
  }

  function handleRichLinkClick(event, link) {
    event.preventDefault();
    if (!event.ctrlKey && !event.metaKey) {
      placeCaretAtPointer(event);
      return;
    }

    const href = link.getAttribute('data-markdown-href') || link.getAttribute('href') || '';
    const safe = sanitizeLinkUrl(href);
    if (!safe) {
      setStatus('許可されていないリンクです');
      return;
    }

    window.open(safe, '_blank', 'noopener,noreferrer');
  }

  function placeCaretAtPointer(event) {
    const trailing = richTrailingEditableParagraph();
    const target = eventTargetElement(event);
    if (trailing && (target === els.rich || target === trailing || trailing.contains(target))) {
      const rect = trailing.getBoundingClientRect();
      if (event.clientY >= rect.top - 12) {
        placeCaretAtStart(trailing);
        return;
      }
    }

    const range = caretRangeFromPoint(event.clientX, event.clientY);
    if (!range || !els.rich.contains(range.startContainer)) return;
    const atom = nodeClosest(range.startContainer, '.rich-inline-atom');
    if (atom && els.rich.contains(atom)) {
      placeCaretAtInlineBoundary(atom, inlineAtomPointerBoundary(atom, event.clientX));
      return;
    }
    const selection = window.getSelection?.();
    if (!selection) return;
    selection.removeAllRanges();
    selection.addRange(range);
    els.rich.focus();
  }

  function inlineAtomPointerBoundary(atom, clientX) {
    const rect = atom.getBoundingClientRect();
    return clientX <= rect.left + (rect.width / 2) ? 'before' : 'after';
  }

  function caretRangeFromPoint(clientX, clientY) {
    if (document.caretPositionFromPoint) {
      const position = document.caretPositionFromPoint(clientX, clientY);
      if (!position) return null;
      const range = document.createRange();
      range.setStart(position.offsetNode, position.offset);
      range.collapse(true);
      return range;
    }

    if (document.caretRangeFromPoint) {
      return document.caretRangeFromPoint(clientX, clientY);
    }

    return null;
  }

  function onSelectionChange() {
    if (focusProseMirrorSelection()) return;
    if (state.richSelectionLock) return;
    window.clearTimeout(state.richSelectionTimer);
    state.richSelectionTimer = window.setTimeout(updateRichInlineSourceFromSelection, 0);
  }

  function updateRichInlineSourceFromSelection() {
    if (state.mode !== 'rich' || state.richComposing) return;
    if (isProseMirrorRichActive()) return;
    cleanupRichCaretBoundaryMarkers({ preserveSelection: true });
    const selection = window.getSelection?.();
    const active = state.richInlineSource?.element;

    if (active && (!active.isConnected || !selection || !selection.rangeCount || !active.contains(selection.anchorNode))) {
      commitRichInlineSource(active);
      return;
    }

    parsePendingRichInlineMarkdownAfterSelectionMove(selection);
    if (state.richInlineActivationSuppressed) return;

    if (!selection || !selection.rangeCount || !selection.isCollapsed || !els.rich.contains(selection.anchorNode)) return;
    if (nodeClosest(selection.anchorNode, '.rich-source-editor, .code-language-input, .rich-inline-source')) return;
    if (nodeClosest(selection.anchorNode, '.mermaid-diagram, pre.code-block, .math-display')) return;

    const candidate = findRichInlineSourceCandidate(selection);
    if (!candidate) return;
    activateRichInlineSource(candidate.element, candidate.position);
  }

  function parsePendingRichInlineMarkdownAfterSelectionMove(selection) {
    const current = richInlineEditBlockFromSelection(selection);
    const previous = state.richInlineParseBlock;
    state.richInlineParseBlock = current;
    if (!previous || previous === current || !previous.isConnected || !els.rich.contains(previous)) return false;
    if (previous.closest('.rich-source-editor, .mermaid-diagram, pre.code-block, .math-display')) return false;
    if (parsePendingRichMathShortcutInBlock(previous)) {
      suppressRichInlineActivation();
      return true;
    }
    if (!parsePendingRichInlineMarkdownInBlock(previous)) return false;
    configureRichEditableSurface();
    suppressRichInlineActivation();
    finalizeRichProjectionChange('rich-input');
    return true;
  }

  function parsePendingRichMathShortcutInBlock(block) {
    if (!block || block.tagName?.toLowerCase() !== 'p' || block.closest('li')) return false;
    const text = normalizeRichText(block.textContent || '');
    if (text !== '$$' && text !== '$$$$') return false;
    if (block.matches?.(RICH_SOURCE_BLOCK_SELECTOR) && applyRichBlockMarkdownTriggerTransaction(block, text, { allowBareMath: true })) {
      return true;
    }
    if (guardUnsupportedRichBlockMarkdownTriggerFallback(block)) return true;
    if (text === '$$$$') {
      replaceParagraphWithMathDisplayEditor(block);
    } else {
      replaceParagraphWithMathInlineSource(block);
    }
    syncRichMarkdownFromDom('rich-input');
    return true;
  }

  function parsePendingRichMathShortcutAwayFromTarget(target) {
    const targetBlock = nodeClosest(target, 'p');
    const pending = Array.from(els.rich.querySelectorAll('p')).find((block) => {
      if (block === targetBlock || block.closest('li')) return false;
      const text = normalizeRichText(block.textContent || '');
      return text === '$$' || text === '$$$$';
    });
    if (!pending) return false;
    return parsePendingRichMathShortcutInBlock(pending);
  }

  function richPendingMathShortcutBlockFromRange(range) {
    const direct = nodeClosest(range?.startContainer, 'p');
    if (direct && els.rich.contains(direct)) return direct;
    return Array.from(els.rich.querySelectorAll('p')).find((block) => {
      const text = normalizeRichText(block.textContent || '');
      return text === '$$' || text === '$$$$';
    }) || null;
  }

  function richInlineEditBlockFromSelection(selection) {
    const range = richSelectionRange(selection);
    if (!range?.collapsed) return null;
    if (nodeClosest(range.startContainer, '.rich-source-editor, .code-language-input, .rich-inline-source')) return null;
    if (nodeClosest(range.startContainer, '.mermaid-diagram, pre.code-block, .math-display')) return null;
    return richInlineEditBlockForRange(range);
  }

  function nodeElement(node) {
    if (!node) return null;
    return node.nodeType === 1 ? node : node.parentElement;
  }

  function nodeClosest(node, selector) {
    return nodeElement(node)?.closest?.(selector) || null;
  }

  function findRichInlineSourceCandidate(selection) {
    const range = richSelectionRange(selection);
    if (!range?.collapsed) return null;
    if (isRichCaretBoundaryMarker(range.startContainer)) return null;
    const editBlock = richInlineEditBlockForRange(range);
    if (!editBlock) return null;

    const direct = validRichInlineSourceElement(nodeElement(range.startContainer)?.closest?.(RICH_INLINE_SOURCE_SELECTOR));
    if (direct && isSameRichInlineEditBlock(direct, editBlock)) return { element: direct, position: 'end' };
    return null;
  }

  function isRichCaretBoundaryMarker(node) {
    return node?.nodeType === Node.TEXT_NODE && (node.nodeValue || '') === '\u200b';
  }

  function cleanupRichCaretBoundaryMarkers(options = {}) {
    if (!els.rich) return;
    const preserveSelection = options.preserveSelection !== false;
    const selection = window.getSelection?.();
    const activeNode = preserveSelection && selection?.rangeCount ? selection.anchorNode : null;
    const activeOffset = preserveSelection && selection?.rangeCount ? selection.anchorOffset : 0;
    let nextSelection = null;

    const walker = document.createTreeWalker(els.rich, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!String(node.nodeValue || '').includes('\u200b')) return NodeFilter.FILTER_REJECT;
        if (nodeClosest(node, '.rich-list-caret-anchor, .rich-line-break-caret-anchor') && (node.nodeValue || '') === '\u200b') return NodeFilter.FILTER_REJECT;
        if (nodeClosest(node, 'td, th')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    for (const node of nodes) {
      if (!node.isConnected) continue;
      const value = node.nodeValue || '';
      if (!value.includes('\u200b')) continue;

      const isActive = node === activeNode;
      if (isActive && value === '\u200b') continue;

      const cleaned = value.replace(/\u200b/g, '');
      if (isActive) {
        const before = value.slice(0, activeOffset);
        nextSelection = {
          node,
          offset: Math.max(0, Math.min(cleaned.length, before.replace(/\u200b/g, '').length)),
        };
      }

      if (cleaned) {
        node.nodeValue = cleaned;
      } else {
        node.remove();
      }
    }

    if (nextSelection?.node?.isConnected) {
      placeCaretInTextNode(nextSelection.node, nextSelection.offset);
    }
  }

  function richInlineEditBlockForRange(range) {
    if (!range) return null;
    return nodeClosest(range.startContainer, RICH_INLINE_EDIT_BLOCK_SELECTOR);
  }

  function isSameRichInlineEditBlock(node, editBlock) {
    if (!node || !editBlock) return false;
    return nodeClosest(node, RICH_INLINE_EDIT_BLOCK_SELECTOR) === editBlock;
  }

  function validRichInlineSourceElement(element) {
    if (!element || !els.rich.contains(element)) return null;
    const atom = element.closest?.('.rich-inline-atom');
    if (atom && els.rich.contains(atom)) element = atom;
    if (element.classList.contains('rich-inline-source')) return null;
    if (element.closest('.rich-source-editor, .mermaid-diagram, pre.code-block, .math-display')) return null;
    if (element.tagName?.toLowerCase() === 'code' && element.closest('pre')) return null;
    if (!element.matches(RICH_INLINE_SOURCE_SELECTOR)) return null;
    return element;
  }

  function adjacentCaretNode(container, offset, direction) {
    if (!container) return null;
    if (container.nodeType === 1) {
      const child = direction === 'before' ? container.childNodes[offset - 1] : container.childNodes[offset];
      return child ? edgeDescendant(child, direction) : adjacentDomNode(container, direction);
    }

    if (container.nodeType !== 3) return null;
    const text = container.nodeValue || '';
    if (direction === 'before' && offset === 0) return adjacentDomNode(container, direction);
    if (direction === 'after' && offset === text.length) return adjacentDomNode(container, direction);
    return null;
  }

  function edgeDescendant(node, direction) {
    let current = node;
    while (current?.nodeType === 1 && current.childNodes.length) {
      current = direction === 'before'
        ? current.childNodes[current.childNodes.length - 1]
        : current.childNodes[0];
    }
    return current;
  }

  function adjacentDomNode(node, direction) {
    let current = node;
    while (current && current !== els.rich) {
      const sibling = direction === 'before' ? current.previousSibling : current.nextSibling;
      if (sibling) return edgeDescendant(sibling, direction);
      current = current.parentNode;
    }
    return null;
  }

  function onRichInput(event) {
    if (isProseMirrorRichTarget(eventTargetElement(event))) return;
    sanitizeRichCaretTokensInDomPreservingSelection(els.rich);
    if (event.target?.closest?.('.task-checkbox, .code-language-input, .rich-source-editor')) return;
    const inlineSource = richInlineSourceFromEventContext(event);
    if (inlineSource) {
      syncActiveRichInlineSourceMarkdown(inlineSource, 'rich-inline-source-input');
      cleanupRichCaretBoundaryMarkers({ preserveSelection: true });
      return;
    }
    if (repairRichLineBreakCaretInput(event)) {
      cleanupRichCaretBoundaryMarkers({ preserveSelection: true });
      return;
    }
    if (!state.richUndoRestoring && event?.isTrusted) {
      if (state.richUndoPreserveNextInput) {
        state.richUndoPreserveNextInput = false;
      } else {
        clearRichUndoStack();
      }
    }
    let handledBySourceTransaction = false;
    state.richInputUsedSourceTransaction = false;
    maybeApplyRichMarkdownTrigger(event);
    handledBySourceTransaction = state.richInputUsedSourceTransaction;
    state.richInputUsedSourceTransaction = false;
    if (!handledBySourceTransaction) {
      if (!applyRichSourceBackedDomTransaction(event, 'rich-input-source-fallback')) {
        if (!guardUnsupportedRichSourceBackedDomSync(event, 'rich-input-source-fallback')) {
          syncRichMarkdownFromDom('rich-input');
          if (!applySyncedRichBlockMarkdownShortcutAfterInput()) {
            applySyncedMarkdownShortcutFromSource();
          }
        }
      } else if (!applySyncedRichBlockMarkdownShortcutAfterInput()) {
        applySyncedMarkdownShortcutFromSource();
      }
      scheduleSyncedMarkdownShortcutFromSource();
    }
    cleanupRichCaretBoundaryMarkers({ preserveSelection: true });
  }

  function onRichCompositionEnd(event) {
    state.richComposing = false;
    if (isProseMirrorRichTarget(eventTargetElement(event))) return;
    if (event.target?.closest?.('.rich-source-editor, .code-language-input')) return;
    const inlineSource = richInlineSourceFromEventContext(event);
    if (inlineSource) {
      syncActiveRichInlineSourceMarkdown(inlineSource, 'rich-inline-source-composition');
      cleanupRichCaretBoundaryMarkers({ preserveSelection: true });
      return;
    }
    if (repairRichLineBreakCaretDomSync('rich-composition')) {
      cleanupRichCaretBoundaryMarkers({ preserveSelection: true });
      return;
    }
    if (applyRichSourceBackedDomTransaction(event, 'rich-composition')) {
      cleanupRichCaretBoundaryMarkers({ preserveSelection: true });
      return;
    }
    if (guardUnsupportedRichSourceBackedDomSync(event, 'rich-composition')) {
      cleanupRichCaretBoundaryMarkers({ preserveSelection: true });
      return;
    }
    syncRichMarkdownFromDom('rich-input');
    cleanupRichCaretBoundaryMarkers({ preserveSelection: true });
  }

  function applyRichSourceBackedDomTransaction(event, reason = 'rich-input-source-fallback') {
    const sourceBlock = richSourceBackedDomBlock(event);
    if (!sourceBlock) return false;
    const start = numericData(sourceBlock, 'sourceStart');
    const end = numericData(sourceBlock, 'sourceEnd');
    const markdown = stripRichCaretTokens(state.markdown || els.source.value || '');
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || end > markdown.length) {
      renderAll(`${reason}-revert`);
      setStatus('この入力をMarkdownソースへ反映できませんでした');
      return true;
    }

    const insert = stripRichCaretTokens(serializeSourceBackedDomBlockNode(sourceBlock));
    if (!insert && sourceBlock.textContent?.trim()) {
      renderAll(`${reason}-revert`);
      setStatus('この入力をMarkdownソースへ反映できませんでした');
      return true;
    }
    const shortcut = richSourceBackedDomShortcutReplacement(sourceBlock, start, end, insert, reason);
    if (shortcut) {
      applySourceTransaction({
        from: start,
        to: end,
        insert: shortcut.insert,
        selectionAfter: shortcut.selectionAfter,
        blankParagraphAt: shortcut.blankParagraphAt,
      }, `rich-markdown-trigger-${shortcut.kind}`);
      finishRichBlockMarkdownTriggerReplacement(shortcut, start, shortcut.insert.length);
      suppressRichInlineActivation();
      return true;
    }
    if (markdown.slice(start, end) === insert) {
      refreshRichSourceRangesFromMarkdown();
      scheduleRender(reason);
      return true;
    }
    const quoteHardBreakRepair = richQuoteHardBreakDomRepair(sourceBlock, markdown.slice(start, end), insert);
    if (quoteHardBreakRepair) {
      applySourceTransaction({
        from: start,
        to: end,
        insert: quoteHardBreakRepair.insert,
        selectionAfter: {
          anchor: start + quoteHardBreakRepair.selectionOffset,
          focus: start + quoteHardBreakRepair.selectionOffset,
          affinity: 'after',
        },
      }, `${reason}-quote-hard-break`);
      suppressRichInlineActivation();
      return true;
    }

    const previousSource = markdown.slice(start, end);
    const selectionAfter = richSourceBackedDomSelectionAfter(sourceBlock, start, previousSource, insert);
    applySourceTransaction({
      from: start,
      to: end,
      insert,
      selectionAfter,
    }, reason);
    suppressRichInlineActivation();
    return true;
  }

  function richQuoteHardBreakDomRepair(sourceBlock, previousSource, domSource) {
    if (!sourceBlock?.matches?.('blockquote')) return null;
    const before = String(previousSource || '');
    const after = String(domSource || '');
    const beforeLines = before.split('\n');
    const afterLines = after.split('\n');
    if (beforeLines.length < 2 || afterLines.length < 2) return null;
    const beforeLast = beforeLines[beforeLines.length - 1] || '';
    const afterLast = afterLines[afterLines.length - 1] || '';
    if (!/^\s*>\s?$/.test(beforeLast) || !/^\s*>\s?$/.test(afterLast)) return null;
    const beforePrevious = String(beforeLines[beforeLines.length - 2] || '').replace(/^\s*>\s?/, '');
    const afterPrevious = String(afterLines[afterLines.length - 2] || '').replace(/^\s*>\s?/, '');
    if (!/[ \t]{2}$/.test(beforePrevious)) return null;
    const visibleBeforeBreak = beforePrevious.replace(/[ \t]{2}$/, '');
    if (!afterPrevious.startsWith(visibleBeforeBreak)) return null;
    const inserted = afterPrevious.slice(visibleBeforeBreak.length).replace(/[ \t]+$/, '').trimStart();
    if (!inserted || inserted.includes('\n')) return null;
    const repairedInsert = `${before}${markdownQuoteTextFromPlainText(inserted)}`;
    return {
      insert: repairedInsert,
      selectionOffset: repairedInsert.length,
    };
  }

  function richSourceBackedDomShortcutReplacement(sourceBlock, start, end, insert, reason) {
    if (!['rich-input-source-fallback', 'rich-composition'].includes(reason)) return null;
    if (sourceBlock?.tagName?.toLowerCase() !== 'p' || sourceBlock.closest('li')) return null;
    const sourceText = normalizeRichText(sourceBlock.textContent || insert);
    const replacement = richBlockMarkdownTriggerReplacement(sourceText, { allowBareMath: false });
    if (!replacement) return null;
    const selectionOffset = start + (Number.isFinite(replacement.selectionOffset)
      ? replacement.selectionOffset
      : replacement.insert.length);
    return {
      ...replacement,
      from: start,
      to: end,
      selectionAfter: {
        anchor: selectionOffset,
        focus: selectionOffset,
        affinity: 'after',
      },
      blankParagraphAt: replacement.blankParagraphAt ? start + replacement.insert.length : undefined,
    };
  }

  function serializeSourceBackedDomBlockNode(sourceBlock) {
    if (sourceBlock?.tagName?.toLowerCase() === 'p') {
      return serializeInlineChildren(sourceBlock);
    }
    return serializeBlockNode(sourceBlock);
  }

  function richSourceBackedDomBlock(event) {
    const selection = window.getSelection?.();
    const nodes = [
      eventTargetElement(event),
      selection?.anchorNode,
      selection?.focusNode,
    ].filter(Boolean);
    for (const node of nodes) {
      if (nodeClosest(node, '.rich-inline-source, .rich-source-editor, .code-language-input')) return null;
      const sourceBlock = nodeClosest(node, RICH_SOURCE_BLOCK_SELECTOR);
      if (sourceBlock && els.rich.contains(sourceBlock)) return richTopLevelBlock(sourceBlock) || sourceBlock;
    }
    return null;
  }

  function guardUnsupportedRichSourceBackedDomSync(event, reason = 'rich-input-source-fallback') {
    const selection = window.getSelection?.();
    const target = eventTargetElement(event);
    const nodes = [target, selection?.anchorNode, selection?.focusNode].filter(Boolean);
    if (nodes.some((node) => nodeClosest(node, '.rich-inline-source, .rich-source-editor, .code-language-input'))) return false;
    const touchesSource = nodes.some((node) => {
      const sourceBlock = nodeClosest(node, RICH_SOURCE_BLOCK_SELECTOR);
      return Boolean(sourceBlock && els.rich.contains(sourceBlock));
    }) || richSelectionTouchesSourceBlock(selection);
    if (!touchesSource) return false;
    renderAll(`${reason}-revert`);
    setStatus('この入力をMarkdownソースへ反映できませんでした');
    suppressRichInlineActivation();
    return true;
  }

  function richSourceBackedDomSelectionAfter(sourceBlock, start, previousSource, nextSource) {
    const diffOffset = sourceOffsetAfterTextChange(previousSource, nextSource);
    if (Number.isFinite(diffOffset)) {
      return {
        anchor: start + diffOffset,
        focus: start + diffOffset,
        affinity: 'after',
      };
    }

    const selection = window.getSelection?.();
    const point = selection?.rangeCount && els.rich.contains(selection.anchorNode)
      ? domPointToSourceOffset(selection.anchorNode, selection.anchorOffset)
      : null;
    const insertLength = String(nextSource || '').length;
    const localOffset = Number.isFinite(point?.offset)
      ? Math.max(0, Math.min(insertLength, point.offset - start))
      : insertLength;
    return {
      anchor: start + localOffset,
      focus: start + localOffset,
      affinity: point?.affinity || 'after',
    };
  }

  function sourceOffsetAfterTextChange(previousSource, nextSource) {
    const before = String(previousSource || '');
    const after = String(nextSource || '');
    if (before === after) return NaN;
    let prefix = 0;
    const maxPrefix = Math.min(before.length, after.length);
    while (prefix < maxPrefix && before[prefix] === after[prefix]) prefix += 1;

    let suffix = 0;
    const maxSuffix = Math.min(before.length - prefix, after.length - prefix);
    while (
      suffix < maxSuffix
      && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
    ) {
      suffix += 1;
    }
    return after.length - suffix;
  }

  function repairRichLineBreakCaretInput(event) {
    const selection = window.getSelection?.();
    const activeAnchor = nodeClosest(selection?.anchorNode, '.rich-line-break-caret-anchor')
      || eventTargetElement(event)?.closest?.('.rich-line-break-caret-anchor')
      || els.rich.querySelector('.rich-line-break-caret-anchor[data-source-offset]');
    const offset = state.richLineBreakInputOffset !== null && Number.isFinite(Number(state.richLineBreakInputOffset))
      ? Number(state.richLineBreakInputOffset)
      : Number(activeAnchor?.dataset?.sourceOffset);
    if (!Number.isFinite(offset)) return false;
    if (event?.inputType && !String(event.inputType).startsWith('insert')) return false;
    const markdown = stripRichCaretTokens(state.markdown || els.source.value || '');
    const quoteAnchor = nodeClosest(activeAnchor, 'blockquote');
    if (offset <= 0 || offset > markdown.length) return false;
    if (quoteAnchor) {
      if (!markdown.slice(0, offset).endsWith('\n> ')) return false;
    } else if (markdown[offset - 1] !== '\n') {
      return false;
    }
    const block = renderedBlockForSourceOffset(els.rich, offset);
    if (!block?.matches?.('p, h1, h2, h3, h4, h5, h6, blockquote')) return false;
    const insert = block.matches('blockquote')
      ? richQuoteLineBreakCaretInputText(event, block, markdown, offset, activeAnchor)
      : richLineBreakCaretInputText(event, block, markdown);
    if (!insert || insert.includes('\n')) return false;
    state.richLineBreakInputOffset = null;
    applySourceTransaction({
      from: offset,
      to: offset,
      insert,
      selectionAfter: {
        anchor: offset + insert.length,
        focus: offset + insert.length,
        affinity: 'after',
      },
    }, 'rich-line-break-caret-input');
    suppressRichInlineActivation();
    return true;
  }

  function richQuoteLineBreakCaretInputText(event, blockquote, markdown, offset, anchor) {
    if (typeof event?.data === 'string' && event.data) {
      return markdownQuoteTextFromPlainText(event.data);
    }
    if (!anchor || !blockquote?.contains?.(anchor)) return '';
    const blockStart = numericData(blockquote, 'sourceStart');
    if (!Number.isFinite(blockStart) || offset < blockStart) return '';
    const sourceBeforeCaret = markdown.slice(blockStart, offset);
    const sourceLines = sourceBeforeCaret.split('\n');
    if (sourceLines.length < 2 || !/^\s*>\s?$/.test(sourceLines[sourceLines.length - 1] || '')) return '';
    const previousSource = String(sourceLines[sourceLines.length - 2] || '').replace(/^\s*>\s?/, '');
    if (!/[ \t]{2}$/.test(previousSource)) return '';
    const previousVisible = previousSource.replace(/[ \t]{2}$/, '');
    const before = document.createRange();
    before.selectNodeContents(blockquote);
    try {
      before.setEndBefore(anchor);
    } catch (_) {
      return '';
    }
    const current = stripRichCaretTokens(serializeInlineNodes(Array.from(before.cloneContents().childNodes))).replace(/\n$/, '');
    if (!current.startsWith(previousVisible)) return '';
    const inserted = current.slice(previousVisible.length).replace(/[ \t]+$/, '').trimStart();
    return inserted ? markdownQuoteTextFromPlainText(inserted) : '';
  }

  function richLineBreakCaretInputText(event, block, markdown) {
    if (typeof event?.data === 'string' && event.data) {
      return stripRichCaretTokens(normalizeNewlines(event.data));
    }
    const start = numericData(block, 'sourceStart');
    const end = numericData(block, 'sourceEnd');
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '';
    const previousLine = markdown.slice(start, end);
    if (!/[ \t]{2}$/.test(previousLine)) return '';
    const previousVisible = previousLine.replace(/[ \t]{2}$/, '');
    const current = stripRichCaretTokens(serializeInlineChildren(block));
    if (!current.endsWith('\n')) return '';
    const beforeBreak = current.slice(0, -1);
    if (!beforeBreak.startsWith(previousVisible)) return '';
    return beforeBreak.slice(previousVisible.length).replace(/[ \t]+$/, '').trimStart();
  }

  function onRichBeforeInput(event) {
    if (handleRichInlineSourceBeforeInput(event)) return;
    if (event.defaultPrevented || !isRichBeforeInputContext(event)) return;
    if (shouldSnapshotRichBeforeInput(event)) {
      pushRichUndoSnapshot('delete');
      state.richUndoPreserveNextInput = true;
    }
    if (isRichPlainTextInsertInput(event) && handleRichInlineBoundaryTextInput(event)) {
      return;
    }
    if (isRichPlainTextInsertInput(event) && handleRichPlainTextInput(event)) {
      return;
    }
    if ((event.inputType === 'deleteContentBackward' || event.inputType === 'deleteContentForward') && handleRichInlineBoundaryDelete(event)) {
      return;
    }
    if ((event.inputType === 'deleteContentBackward' || event.inputType === 'deleteContentForward') && handleRichTableBlockBoundaryDelete(event)) {
      return;
    }
    if ((event.inputType === 'deleteContentBackward' || event.inputType === 'deleteContentForward') && handleRichTextBlockBoundaryDelete(event)) {
      return;
    }
    if ((event.inputType === 'deleteContentBackward' || event.inputType === 'deleteContentForward') && handleRichListItemBoundaryDelete(event)) {
      return;
    }
    if ((event.inputType === 'deleteContentBackward' || event.inputType === 'deleteContentForward') && handleRichListBlockBoundaryDelete(event)) {
      return;
    }
    if ((event.inputType === 'deleteContentBackward' || event.inputType === 'deleteContentForward') && handleRichPlainTextDelete(event)) {
      return;
    }
    if (event.inputType === 'deleteByCut' || event.inputType === 'deleteContent') {
      if (handleRichPlainTextSelectionReplacement(event, '', 'rich-selection-cut')) return;
      if (guardUnsupportedRichSelectionMutationFallback(event)) return;
    }
    if (event.inputType === 'insertParagraph') {
      handleRichEnter(event);
      return;
    }
    if (event.inputType === 'insertLineBreak') {
      event.preventDefault();
      if (handleRichLineBreakTransaction({ pushUndo: true })) return;
      if (insertRichLineBreak()) syncRichMarkdownFromDom('rich-input');
    }
  }

  function handleRichInlineSourceBeforeInput(event) {
    if (event.defaultPrevented || state.mode !== 'rich' || state.richComposing) return false;
    const inlineSource = richInlineSourceFromEventContext(event);
    if (!inlineSource) return false;
    const inputType = String(event.inputType || '');
    if (!inputType.startsWith('insert') && !inputType.startsWith('delete')) return false;
    if (applyRichInlineSourceInputTransaction(event, inlineSource, inputType)) return true;
    captureRichInlineSourceUndoSnapshot(inlineSource, 'inline-source');
    return false;
  }

  function applyRichInlineSourceInputTransaction(event, inlineSource, inputType) {
    const sourceRange = richInlineSourceRange(inlineSource);
    const selectionRange = richInlineSourceSelectionRange(inlineSource);
    if (!sourceRange || !selectionRange) return false;
    const source = stripRichCaretTokens(normalizeNewlines(inlineSource.textContent || ''));
    let from = selectionRange.from;
    let to = selectionRange.to;
    let insert = '';

    if (inputType === 'insertText' || inputType === 'insertReplacementText') {
      if (typeof event.data !== 'string') return false;
      insert = stripRichCaretTokens(normalizeNewlines(event.data));
    } else if (inputType === 'deleteContentBackward') {
      if (from === to) {
        if (from <= 0) return false;
        from = previousStringOffset(source, from);
      }
    } else if (inputType === 'deleteContentForward') {
      if (from === to) {
        if (to >= source.length) return false;
        to = nextStringOffset(source, to);
      }
    } else {
      return false;
    }

    event.preventDefault();
    captureRichInlineSourceUndoSnapshot(inlineSource, 'inline-source');
    applyActiveRichInlineSourceTransaction(inlineSource, {
      from,
      to,
      insert,
      sourceRange,
      reason: `rich-inline-source-${inputType}`,
    });
    return true;
  }

  function captureRichInlineSourceUndoSnapshot(inlineSource, label) {
    const active = state.richInlineSource;
    if (!active || active.element !== inlineSource || active.undoCaptured) return false;
    pushRichUndoSnapshot(label || 'inline-source');
    active.undoCaptured = true;
    return true;
  }

  function shouldSnapshotRichBeforeInput(event) {
    if (!String(event.inputType || '').startsWith('delete')) return false;
    if (nodeClosest(window.getSelection?.()?.anchorNode, '.rich-inline-source, .rich-source-editor, .code-language-input')) return false;
    return true;
  }

  function isRichPlainTextInsertInput(event) {
    return event.inputType === 'insertText' || event.inputType === 'insertReplacementText';
  }

  function handleRichInlineBoundaryTextInput(event) {
    if (state.richComposing || typeof event.data !== 'string' || event.data === '') return false;
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    const selection = window.getSelection?.();
    const range = richSelectionRange(selection);
    if (!range?.collapsed) return false;
    if (nodeClosest(range.startContainer, '.rich-inline-source, .rich-source-editor, .code-language-input')) return false;
    const inlineElement = validRichInlineSourceElement(nodeElement(range.startContainer)?.closest?.(RICH_INLINE_SOURCE_SELECTOR));
    if (!inlineElement) return false;
    const block = richInlineEditBlockForRange(range);
    if (!block || !isSameRichInlineEditBlock(inlineElement, block)) return false;

    const offset = richInlineElementTextOffsetForRange(inlineElement, range);
    const length = normalizeRichText(inlineElement.textContent || '').length;
    const atStart = offset <= 0;
    const atEnd = offset >= length;
    if (!atStart && !atEnd) return false;

    const sourceTransaction = richInlineBoundaryInsertTransaction(inlineElement, event.data, atStart ? 'before' : 'after');
    if (sourceTransaction) {
      event.preventDefault();
      applySourceTransaction(sourceTransaction, 'rich-inline-boundary-insert');
      suppressRichInlineActivation();
      return true;
    }

    if (guardUnsupportedRichInlineBoundaryFallback(inlineElement, block)) {
      event.preventDefault();
      return true;
    }

    event.preventDefault();
    const caretToken = richCaretToken();
    const textNode = document.createTextNode(atStart ? `${event.data}${caretToken}` : `${event.data}${caretToken}`);
    state.richSelectionLock = true;
    if (atStart) inlineElement.before(textNode);
    else inlineElement.after(textNode);
    reparseRichInlineEditBlockContent(block, { caretToken });
    configureRichEditableSurface();
    syncRichMarkdownFromDom('rich-input');
    state.richSelectionLock = false;
    suppressRichInlineActivation();
    return true;
  }

  function guardUnsupportedRichInlineBoundaryFallback(inlineElement, block) {
    if (!inlineElement || !block || !els.rich.contains(block)) return false;
    if (richTopLevelBlock(block)?.matches?.(RICH_SOURCE_BLOCK_SELECTOR)) {
      setStatus('この位置ではMarkdownソースへ変換できません');
      suppressRichInlineActivation();
      return true;
    }
    return false;
  }

  function handleRichInlineBoundaryDelete(event) {
    const selection = window.getSelection?.();
    const range = richSelectionRange(selection);
    if (!range?.collapsed) return false;
    if (nodeClosest(range.startContainer, '.rich-inline-source, .rich-source-editor, .code-language-input')) return false;
    const direction = event.inputType === 'deleteContentBackward' ? 'before' : 'after';
    const atom = richInlineBoundaryDeleteCandidate(range, direction);
    if (!atom) return false;
    const start = Number(atom.dataset.srcStart);
    const end = Number(atom.dataset.srcEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return false;
    event.preventDefault();
    applySourceTransaction({
      from: start,
      to: end,
      insert: '',
      selectionAfter: {
        anchor: start,
        focus: start,
        affinity: 'before',
      },
    }, 'rich-inline-boundary-delete');
    suppressRichInlineActivation();
    return true;
  }

  function richInlineBoundaryDeleteCandidate(range, direction) {
    const direct = validRichInlineSourceElement(nodeElement(range.startContainer)?.closest?.('.rich-inline-atom'));
    if (direct?.classList?.contains('rich-inline-atom')) return direct;
    const adjacent = adjacentCaretNode(range.startContainer, range.startOffset, direction);
    const atom = nodeElement(adjacent)?.closest?.('.rich-inline-atom');
    return atom && els.rich.contains(atom) ? atom : null;
  }

  function handleRichHomeEndNavigation(event) {
    if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false;
    const selection = window.getSelection?.();
    const range = richSelectionRange(selection);
    if (!range?.collapsed) return false;
    if (nodeClosest(range.startContainer, '.rich-inline-source, .rich-source-editor, .code-language-input')) return false;
    const editBlock = richInlineEditBlockForRange(range);
    if (!editBlock || !els.rich.contains(editBlock)) return false;
    const boundary = event.key === 'Home' ? 'start' : 'end';
    const offset = richEditBlockBoundarySourceOffset(editBlock, boundary);
    if (!Number.isFinite(offset)) return false;
    event.preventDefault();
    restoreRichCaretFromSourceSelection({
      anchor: offset,
      focus: offset,
      affinity: boundary === 'start' ? 'before' : 'after',
    });
    suppressRichInlineActivation();
    return true;
  }

  function richEditBlockBoundarySourceOffset(editBlock, boundary) {
    if (editBlock.tagName?.toLowerCase() === 'li') {
      return richListItemBoundarySourceOffset(editBlock, boundary);
    }
    if (!editBlock.matches?.(RICH_SOURCE_BLOCK_SELECTOR)) return NaN;
    const start = numericData(editBlock, 'sourceStart');
    const end = numericData(editBlock, 'sourceEnd');
    if (!Number.isFinite(start) || !Number.isFinite(end)) return NaN;
    if (editBlock.tagName?.toLowerCase() === 'blockquote') {
      return richQuoteBoundarySourceOffset(editBlock, boundary);
    }
    return boundary === 'start' ? start + sourceContentBaseOffset(editBlock) : end;
  }

  function richQuoteBoundarySourceOffset(blockquote, boundary) {
    const start = numericData(blockquote, 'sourceStart');
    const end = numericData(blockquote, 'sourceEnd');
    if (!Number.isFinite(start) || !Number.isFinite(end)) return NaN;
    const raw = stripRichCaretTokens(state.markdown || '').slice(start, end);
    const model = parseMarkdownQuoteSource(raw);
    const first = model?.lines?.[0];
    const last = model?.lines?.[model.lines.length - 1];
    if (!first || !last) return NaN;
    return boundary === 'start'
      ? start + first.line.start + first.contentStart
      : start + last.line.start + last.contentEnd;
  }

  function richListItemBoundarySourceOffset(item, boundary) {
    const list = item.closest('ul, ol');
    if (!list?.matches?.(RICH_SOURCE_BLOCK_SELECTOR) || item.parentElement !== list) return NaN;
    const blockStart = numericData(list, 'sourceStart');
    const blockEnd = numericData(list, 'sourceEnd');
    if (!Number.isFinite(blockStart) || !Number.isFinite(blockEnd)) return NaN;
    const raw = stripRichCaretTokens(state.markdown || '').slice(blockStart, blockEnd);
    const sourceItems = flatListSourceItems(raw);
    const items = Array.from(list.children).filter((child) => child.tagName?.toLowerCase() === 'li');
    const itemIndex = items.indexOf(item);
    if (itemIndex < 0 || sourceItems.length !== items.length) return NaN;
    const sourceItem = sourceItems[itemIndex];
    const contentLength = visibleTextFromListSourceItem(sourceItem).length;
    const textOffset = boundary === 'start' ? 0 : contentLength;
    return blockStart + sourceOffsetFromListItemTextOffset(sourceItem, textOffset);
  }

  function handleRichPlainTextInput(event) {
    if (state.richComposing || typeof event.data !== 'string' || event.data === '') return false;
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    if (handleRichPlainTextSelectionReplacement(event, event.data, 'rich-selection-insert')) return true;
    if (guardUnsupportedRichSelectionMutationFallback(event)) return true;
    const range = currentCollapsedRichRange();
    if (!range || !isSourceTransactionTextRange(range)) return false;
    if (handleRichBlockMarkdownShortcutInput(event, range)) return true;
    const point = activeRichTransactionBlankPoint(range) || richPlainTextSourcePointFromRange(range);
    if (!point) return false;
    if (handleRichBlockMarkdownShortcutSourceInput(event, point)) return true;
    if (shouldLetDomHandleMarkdownShortcutInput(range, event.data)) return false;
    event.preventDefault();
    const input = point.tableCell
      ? markdownTableCellTextFromPlainText(event.data)
      : point.quoteBlock
        ? markdownQuoteTextFromPlainText(event.data)
        : stripRichCaretTokens(event.data);
    const trailingPrefix = point.trailingParagraph && (state.markdown || '').length ? '\n\n' : '';
    const blankInsert = point.blankParagraph ? blankParagraphSourceInsertion(point.offset, input) : null;
    const insert = blankInsert ? blankInsert.insert : `${trailingPrefix}${input}`;
    const nextOffset = blankInsert ? blankInsert.selectionOffset : point.offset + trailingPrefix.length + input.length;
    applySourceTransaction({
      from: point.offset,
      to: point.offset,
      insert,
      selectionAfter: {
        anchor: nextOffset,
        focus: nextOffset,
        affinity: 'after',
      },
    }, 'rich-text-insert');
    if (point.blankParagraph) state.richTransactionBlank = null;
    suppressRichInlineActivation();
    return true;
  }

  function blankParagraphSourceInsertion(offset, text) {
    const source = stripRichCaretTokens(state.markdown || els.source?.value || '');
    const gap = Math.max(0, Math.min(source.length, Number(offset) || 0));
    const input = stripRichCaretTokens(String(text || ''));
    const beforeHasBreak = gap === 0 || source.slice(0, gap).endsWith('\n\n');
    const afterHasBreak = gap === source.length || source.slice(gap).startsWith('\n\n');
    const prefix = beforeHasBreak ? '' : '\n\n';
    const suffix = afterHasBreak ? '' : '\n\n';
    return {
      insert: `${prefix}${input}${suffix}`,
      selectionOffset: gap + prefix.length + input.length,
    };
  }

  function handleRichBlockMarkdownShortcutSourceInput(event, point) {
    const block = renderedBlockForSourceOffset(els.rich, point.offset);
    if (!block || block.tagName?.toLowerCase() !== 'p' || !block.matches?.(RICH_SOURCE_BLOCK_SELECTOR)) return false;
    const start = numericData(block, 'sourceStart');
    const end = numericData(block, 'sourceEnd');
    const base = sourceContentBaseOffset(block);
    if (!Number.isFinite(start) || !Number.isFinite(end) || point.offset < start || point.offset > end) return false;
    const source = stripRichCaretTokens(state.markdown || els.source.value || '');
    const raw = source.slice(start, end);
    const local = Math.max(0, Math.min(raw.length, point.offset - start - base));
    const next = `${raw.slice(0, local)}${event.data || ''}${raw.slice(local)}`;
    const replacement = richBlockMarkdownTriggerReplacement(next, { allowBareMath: false });
    if (!replacement) return false;
    event.preventDefault();
    return applyRichBlockMarkdownTriggerTransaction(block, next, { allowBareMath: false });
  }

  function handleRichBlockMarkdownShortcutInput(event, range) {
    const block = richParagraphBlockForShortcutRange(range);
    if (!block || block.closest('li') || !block.matches?.(RICH_SOURCE_BLOCK_SELECTOR)) return false;
    const current = normalizeRichText(block.textContent || '');
    const caretOffset = getCaretCharacterOffsetWithin(block, window.getSelection?.());
    const next = `${current.slice(0, caretOffset)}${event.data || ''}${current.slice(caretOffset)}`;
    if (caretOffset !== current.length) return false;
    const replacement = richBlockMarkdownTriggerReplacement(next, { allowBareMath: false });
    if (!replacement) return false;
    event.preventDefault();
    return applyRichBlockMarkdownTriggerTransaction(block, next, { allowBareMath: false });
  }

  function richParagraphBlockForShortcutRange(range) {
    const direct = nodeClosest(range?.startContainer, 'p');
    if (direct && els.rich.contains(direct)) return direct;
    const point = richPlainTextSourcePointFromRange(range);
    if (!point) return null;
    const block = renderedBlockForSourceOffset(els.rich, point.offset);
    return block?.tagName?.toLowerCase() === 'p' ? block : null;
  }

  function applySyncedRichBlockMarkdownShortcutAfterInput() {
    const selection = window.getSelection?.();
    const selectedBlock = selection?.rangeCount && els.rich.contains(selection.anchorNode)
      ? nodeClosest(selection.anchorNode, 'p')
      : null;
    const candidates = selectedBlock ? [selectedBlock] : Array.from(els.rich.querySelectorAll(`p${RICH_SOURCE_BLOCK_SELECTOR}`));
    for (const block of candidates) {
      if (!block || block.closest('li') || !block.matches?.(RICH_SOURCE_BLOCK_SELECTOR)) continue;
      const text = normalizeRichText(block.textContent || '');
      const replacement = richBlockMarkdownTriggerReplacement(text, { allowBareMath: false });
      if (!replacement) continue;
      return applyRichBlockMarkdownTriggerTransaction(block, text, { allowBareMath: false });
    }
    return false;
  }

  function applySyncedMarkdownShortcutFromSource() {
    const markdown = stripRichCaretTokens(els.source?.value || state.markdown || '');
    if (markdown !== stripRichCaretTokens(state.markdown || '')) {
      state.markdown = markdown;
      if (els.source) els.source.value = markdown;
    }
    const selection = window.getSelection?.();
    const sourcePoint = selection?.rangeCount && els.rich.contains(selection.anchorNode)
      ? domPointToSourceOffset(selection.anchorNode, selection.anchorOffset)
      : null;
    const blocks = buildBlockModel(markdown).filter((block) => block.type === 'paragraph');
    const selected = Number.isFinite(sourcePoint?.offset)
      ? blocks.find((block) => block.start <= sourcePoint.offset && sourcePoint.offset <= block.end)
      : null;
    const candidates = selected ? [selected, ...blocks.filter((block) => block !== selected)] : blocks;

    for (const block of candidates) {
      const replacement = richBlockMarkdownTriggerReplacement(block.raw, { allowBareMath: false });
      if (!replacement) continue;
      const selectionOffset = block.start + (Number.isFinite(replacement.selectionOffset)
        ? replacement.selectionOffset
        : replacement.insert.length);
      state.richInputUsedSourceTransaction = true;
      return applySourceTransaction({
        from: block.start,
        to: block.end,
        insert: replacement.insert,
        selectionAfter: {
          anchor: selectionOffset,
          focus: selectionOffset,
          affinity: 'after',
        },
        blankParagraphAt: replacement.blankParagraphAt ? block.start + replacement.insert.length : undefined,
      }, `rich-markdown-trigger-${replacement.kind}-synced`);
    }
    return false;
  }

  function scheduleSyncedMarkdownShortcutFromSource() {
    window.setTimeout(() => {
      if (state.mode !== 'rich' || state.richComposing || state.richInlineSource?.element) return;
      applySyncedMarkdownShortcutFromSource();
    }, 0);
  }

  function handleRichPlainTextDelete(event) {
    if (handleRichPlainTextSelectionReplacement(event, '', 'rich-selection-delete')) return true;
    if (guardUnsupportedRichSelectionMutationFallback(event)) return true;
    const range = currentCollapsedRichRange();
    if (!range || !isSourceTransactionTextRange(range)) return false;
    const backward = event.inputType === 'deleteContentBackward' || event.key === 'Backspace';
    if (!backward && event.inputType !== 'deleteContentForward' && event.key !== 'Delete') return false;
    const lineBreakDeletion = richLineBreakCaretDeleteTransaction(window.getSelection?.(), backward);
    if (lineBreakDeletion) {
      event.preventDefault();
      state.richLineBreakInputOffset = null;
      applySourceTransaction(lineBreakDeletion, 'rich-line-break-caret-delete');
      suppressRichInlineActivation();
      return true;
    }
    const point = richPlainTextSourcePointFromRange(range);
    if (!point) return false;
    const quoteDeletion = richQuoteBoundaryDeleteTransaction(point, backward);
    if (quoteDeletion) {
      event.preventDefault();
      applySourceTransaction(quoteDeletion, backward ? 'rich-quote-line-merge-backward' : 'rich-quote-line-merge-forward');
      suppressRichInlineActivation();
      return true;
    }
    const deletionRange = richPlainTextDeletionRange(point, backward);
    if (!deletionRange) return false;
    const { from, to } = deletionRange;
    if (from < point.contentStart || to > point.contentEnd || from < 0 || to <= from) return false;
    event.preventDefault();
    applySourceTransaction({
      from,
      to,
      insert: '',
      selectionAfter: {
        anchor: from,
        focus: from,
        affinity: backward ? 'before' : 'after',
      },
    }, backward ? 'rich-text-delete-backward' : 'rich-text-delete-forward');
    suppressRichInlineActivation();
    return true;
  }

  function richPlainTextDeletionRange(point, backward) {
    const markdown = stripRichCaretTokens(state.markdown || els.source.value || '');
    if (point.tableCell) {
      if (backward && markdown.slice(point.offset - 2, point.offset) === '\\|') {
        return { from: point.offset - 2, to: point.offset };
      }
      if (!backward && markdown.slice(point.offset, point.offset + 2) === '\\|') {
        return { from: point.offset, to: point.offset + 2 };
      }
    }
    if (backward && /[ \t]{2}\n$/.test(markdown.slice(point.offset - 3, point.offset))) {
      return { from: point.offset - 3, to: point.offset };
    }
    if (backward && /[ \t]{2}\n/.test(markdown.slice(point.offset - 1, point.offset + 2))) {
      return { from: point.offset - 1, to: point.offset + 2 };
    }
    if (backward && /[ \t]{2}\n/.test(markdown.slice(point.offset - 2, point.offset + 1))) {
      return { from: point.offset - 2, to: point.offset + 1 };
    }
    if (!backward && /[ \t]{2}\n/.test(markdown.slice(point.offset, point.offset + 3))) {
      return { from: point.offset, to: point.offset + 3 };
    }
    return backward
      ? { from: point.offset - 1, to: point.offset }
      : { from: point.offset, to: point.offset + 1 };
  }

  function handleRichTextBlockBoundaryDelete(event) {
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
    const selection = window.getSelection?.();
    const range = richSelectionRange(selection);
    if (!range?.collapsed) return false;
    if (nodeClosest(range.startContainer, '.rich-inline-source, .rich-source-editor, .code-language-input')) return false;
    const backward = event.inputType === 'deleteContentBackward' || event.key === 'Backspace';
    if (!backward && event.inputType !== 'deleteContentForward' && event.key !== 'Delete') return false;
    const transaction = richTextBlockBoundaryDeleteTransaction(range, backward);
    if (!transaction) return false;
    event.preventDefault();
    applySourceTransaction(transaction, backward ? 'rich-block-boundary-delete-backward' : 'rich-block-boundary-delete-forward');
    suppressRichInlineActivation();
    return true;
  }

  function richTextBlockBoundaryDeleteTransaction(range, backward) {
    if (!range?.collapsed || !isSourceTransactionTextRange(range)) return null;
    const block = nodeClosest(range.startContainer, 'p, h1, h2, h3, h4, h5, h6, blockquote');
    if (!block?.matches?.(RICH_SOURCE_BLOCK_SELECTOR) || !els.rich.contains(block) || block.closest('li')) return null;
    const point = richPlainTextSourcePointFromRange(range);
    if (!point || !Number.isFinite(point.offset)) return null;
    const blockStart = numericData(block, 'sourceStart');
    const blockEnd = numericData(block, 'sourceEnd');
    if (!Number.isFinite(blockStart) || !Number.isFinite(blockEnd)) return null;
    const isQuoteBlock = block.tagName?.toLowerCase() === 'blockquote';
    if (isQuoteBlock) {
      if (backward || point.offset !== blockEnd) return null;
    } else {
      if (backward && point.offset !== point.contentStart) return null;
      if (!backward && point.offset !== point.contentEnd) return null;
    }

    const markdown = stripRichCaretTokens(state.markdown || els.source.value || '');
    const adjacent = backward ? adjacentSourceBackedBlock(block, 'previous') : adjacentSourceBackedBlock(block, 'next');
    if (!adjacent) return null;
    const adjacentStart = numericData(adjacent, 'sourceStart');
    const adjacentEnd = numericData(adjacent, 'sourceEnd');
    if (!Number.isFinite(adjacentStart) || !Number.isFinite(adjacentEnd)) return null;
    const from = backward ? adjacentEnd : blockEnd;
    const to = backward ? blockStart : adjacentStart;
    if (from < 0 || to <= from || to > markdown.length || !/^\n{1,2}$/.test(markdown.slice(from, to))) return null;
    return {
      from,
      to,
      insert: '',
      selectionAfter: {
        anchor: from,
        focus: from,
        affinity: backward ? 'before' : 'after',
      },
    };
  }

  function handleRichTableBlockBoundaryDelete(event) {
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
    const selection = window.getSelection?.();
    const range = richSelectionRange(selection);
    if (!range?.collapsed) return false;
    if (nodeClosest(range.startContainer, '.rich-inline-source, .rich-source-editor, .code-language-input')) return false;
    const backward = event.inputType === 'deleteContentBackward' || event.key === 'Backspace';
    if (!backward && event.inputType !== 'deleteContentForward' && event.key !== 'Delete') return false;
    const transaction = richTableBlockBoundaryDeleteTransaction(range, backward);
    if (!transaction) return false;
    event.preventDefault();
    applySourceTransaction(transaction, backward ? 'rich-table-boundary-delete-backward' : 'rich-table-boundary-delete-forward');
    suppressRichInlineActivation();
    return true;
  }

  function richTableBlockBoundaryDeleteTransaction(range, backward) {
    if (!range?.collapsed) return null;
    const cell = nodeClosest(range.startContainer, 'td, th');
    if (cell && els.rich.contains(cell)) {
      return richTableCellParagraphBoundaryDeleteTransaction(cell, range, backward);
    }
    const paragraph = nodeClosest(range.startContainer, 'p');
    if (paragraph && els.rich.contains(paragraph)) {
      return richParagraphTableBoundaryDeleteTransaction(paragraph, range, backward);
    }
    return null;
  }

  function richParagraphTableBoundaryDeleteTransaction(paragraph, range, backward) {
    if (!isRichSourceParagraphBlock(paragraph) || !isSourceTransactionTextRange(range)) return null;
    const point = richPlainTextSourcePointFromRange(range);
    if (!point || !Number.isFinite(point.offset)) return null;
    if (backward) {
      if (point.offset !== point.contentStart) return null;
      const table = adjacentSourceBackedBlock(paragraph, 'previous');
      return isRichSourceTableBlock(table) ? richTableBeforeParagraphMergeTransaction(table, paragraph) : null;
    }
    if (point.offset !== point.contentEnd) return null;
    const table = adjacentSourceBackedBlock(paragraph, 'next');
    return isRichSourceTableBlock(table) ? richParagraphBeforeTableMergeTransaction(paragraph, table) : null;
  }

  function richTableCellParagraphBoundaryDeleteTransaction(cell, range, backward) {
    const table = cell?.closest?.('table');
    if (!isRichSourceTableBlock(table)) return null;
    const point = richTableSourcePointFromRange(cell, range);
    if (!point || !Number.isFinite(point.offset)) return null;
    if (backward) {
      if (cell !== richFirstTableCell(table) || point.offset !== point.contentStart) return null;
      const paragraph = adjacentSourceBackedBlock(table, 'previous');
      return isRichSourceParagraphBlock(paragraph) ? richParagraphBeforeTableMergeTransaction(paragraph, table) : null;
    }
    if (cell !== richLastTableCell(table) || point.offset !== point.contentEnd) return null;
    const paragraph = adjacentSourceBackedBlock(table, 'next');
    return isRichSourceParagraphBlock(paragraph) ? richTableBeforeParagraphMergeTransaction(table, paragraph) : null;
  }

  function richParagraphBeforeTableMergeTransaction(paragraph, table) {
    const markdown = stripRichCaretTokens(state.markdown || els.source.value || '');
    const paragraphSource = richSourceParagraphForTableMerge(paragraph, markdown);
    const firstCell = richFirstTableCell(table);
    const cellRange = firstCell ? richTableCellSourceRange(firstCell) : null;
    if (!paragraphSource || !cellRange || cellRange.table !== table) return null;
    if (!/^\n{1,2}$/.test(markdown.slice(paragraphSource.end, cellRange.blockStart))) return null;
    const tablePrefix = markdown.slice(cellRange.blockStart, cellRange.contentStart);
    const insert = `${tablePrefix}${paragraphSource.cellText}`;
    const selectionOffset = paragraphSource.start + insert.length;
    return {
      from: paragraphSource.start,
      to: cellRange.contentStart,
      insert,
      selectionAfter: {
        anchor: selectionOffset,
        focus: selectionOffset,
        affinity: 'after',
      },
    };
  }

  function richTableBeforeParagraphMergeTransaction(table, paragraph) {
    const markdown = stripRichCaretTokens(state.markdown || els.source.value || '');
    const paragraphSource = richSourceParagraphForTableMerge(paragraph, markdown);
    const lastCell = richLastTableCell(table);
    const cellRange = lastCell ? richTableCellSourceRange(lastCell) : null;
    if (!paragraphSource || !cellRange || cellRange.table !== table) return null;
    if (!/^\n{1,2}$/.test(markdown.slice(cellRange.blockEnd, paragraphSource.start))) return null;
    const tableTail = markdown.slice(cellRange.contentEnd, cellRange.blockEnd);
    const insert = `${paragraphSource.cellText}${tableTail}`;
    const selectionOffset = cellRange.contentEnd + paragraphSource.cellText.length;
    return {
      from: cellRange.contentEnd,
      to: paragraphSource.end,
      insert,
      selectionAfter: {
        anchor: selectionOffset,
        focus: selectionOffset,
        affinity: 'after',
      },
    };
  }

  function richSourceParagraphForTableMerge(paragraph, markdown) {
    if (!isRichSourceParagraphBlock(paragraph)) return null;
    const start = numericData(paragraph, 'sourceStart');
    const end = numericData(paragraph, 'sourceEnd');
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || end > markdown.length) return null;
    const raw = markdown.slice(start, end);
    return {
      start,
      end,
      cellText: markdownTableCellTextFromPlainText(raw),
    };
  }

  function richFirstTableCell(table) {
    return table?.querySelector?.('th, td') || null;
  }

  function richLastTableCell(table) {
    const cells = Array.from(table?.querySelectorAll?.('th, td') || []);
    return cells.length ? cells[cells.length - 1] : null;
  }

  function isRichSourceParagraphBlock(block) {
    return block?.tagName?.toLowerCase() === 'p'
      && block.matches?.(RICH_SOURCE_BLOCK_SELECTOR)
      && els.rich.contains(block)
      && !block.closest('li');
  }

  function isRichSourceTableBlock(block) {
    return block?.tagName?.toLowerCase() === 'table'
      && block.matches?.(RICH_SOURCE_BLOCK_SELECTOR)
      && els.rich.contains(block);
  }

  function adjacentSourceBackedBlock(block, direction) {
    const siblingProperty = direction === 'previous' ? 'previousElementSibling' : 'nextElementSibling';
    let sibling = block?.[siblingProperty] || null;
    while (sibling) {
      if (sibling.matches?.(RICH_SOURCE_BLOCK_SELECTOR)) return sibling;
      if (!isIgnorableRichBoundaryElement(sibling)) return null;
      sibling = sibling[siblingProperty];
    }
    return null;
  }

  function handleRichListItemBoundaryDelete(event) {
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
    const selection = window.getSelection?.();
    const range = richSelectionRange(selection);
    if (!range?.collapsed) return false;
    if (nodeClosest(range.startContainer, '.rich-inline-source, .rich-source-editor, .code-language-input')) return false;
    const backward = event.inputType === 'deleteContentBackward' || event.key === 'Backspace';
    if (!backward && event.inputType !== 'deleteContentForward' && event.key !== 'Delete') return false;
    const transaction = richListItemBoundaryDeleteTransaction(range, backward);
    if (!transaction) return false;
    event.preventDefault();
    applySourceTransaction(transaction, backward ? 'rich-list-item-boundary-delete-backward' : 'rich-list-item-boundary-delete-forward');
    suppressRichInlineActivation();
    return true;
  }

  function richListItemBoundaryDeleteTransaction(range, backward) {
    if (!range?.collapsed) return null;
    const item = richListItemFromRange(range);
    const list = item?.closest?.('ul, ol');
    if (!item || !list?.matches?.(RICH_SOURCE_BLOCK_SELECTOR) || item.parentElement !== list) return null;
    if (item.querySelector('.rich-inline-source')) return null;
    const point = richListSourcePointFromRange(item, range);
    if (!point || !Number.isFinite(point.offset)) return null;
    const blockStart = numericData(list, 'sourceStart');
    const blockEnd = numericData(list, 'sourceEnd');
    if (!Number.isFinite(blockStart) || !Number.isFinite(blockEnd)) return null;
    const markdown = stripRichCaretTokens(state.markdown || els.source.value || '');
    const raw = markdown.slice(blockStart, blockEnd);
    const sourceItems = flatListSourceItems(raw);
    const items = Array.from(list.children).filter((child) => child.tagName?.toLowerCase() === 'li');
    const itemIndex = items.indexOf(item);
    if (itemIndex < 0 || sourceItems.length !== items.length) return null;
    const sourceItem = sourceItems[itemIndex];
    const neighbor = sourceItems[itemIndex + (backward ? -1 : 1)];
    if (!sourceItem || !neighbor) return null;
    const itemContentStart = blockStart + sourceItem.lines[0].start + sourceItem.parsed.prefix.length;
    const itemContentEnd = blockStart + listSourceItemTextEnd(sourceItem);
    if (backward && point.offset !== itemContentStart) return null;
    if (!backward && point.offset !== itemContentEnd) return null;
    const from = backward
      ? blockStart + listSourceItemTextEnd(neighbor)
      : itemContentEnd;
    const to = backward
      ? itemContentStart
      : blockStart + neighbor.lines[0].start + neighbor.parsed.prefix.length;
    const removed = markdown.slice(from, to);
    if (from < blockStart || to > blockEnd || to <= from || !removed.startsWith('\n') || removed.slice(1).includes('\n')) return null;
    return {
      from,
      to,
      insert: '',
      selectionAfter: {
        anchor: from,
        focus: from,
        affinity: backward ? 'before' : 'after',
      },
    };
  }

  function handleRichListBlockBoundaryDelete(event) {
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
    const selection = window.getSelection?.();
    const range = richSelectionRange(selection);
    if (!range?.collapsed) return false;
    if (nodeClosest(range.startContainer, '.rich-inline-source, .rich-source-editor, .code-language-input')) return false;
    const backward = event.inputType === 'deleteContentBackward' || event.key === 'Backspace';
    if (!backward && event.inputType !== 'deleteContentForward' && event.key !== 'Delete') return false;
    const transaction = richListBlockBoundaryDeleteTransaction(range, backward);
    if (!transaction) return false;
    event.preventDefault();
    applySourceTransaction(transaction, backward ? 'rich-list-boundary-delete-backward' : 'rich-list-boundary-delete-forward');
    suppressRichInlineActivation();
    return true;
  }

  function richListBlockBoundaryDeleteTransaction(range, backward) {
    if (!range?.collapsed) return null;
    const item = richListItemFromRange(range);
    const list = item?.closest?.('ul, ol');
    if (!item || !list?.matches?.(RICH_SOURCE_BLOCK_SELECTOR) || item.parentElement !== list) return null;
    if (item.querySelector('.rich-inline-source')) return null;
    const point = richListSourcePointFromRange(item, range);
    if (!point || !Number.isFinite(point.offset)) return null;
    const blockStart = numericData(list, 'sourceStart');
    const blockEnd = numericData(list, 'sourceEnd');
    if (!Number.isFinite(blockStart) || !Number.isFinite(blockEnd)) return null;
    const raw = stripRichCaretTokens(state.markdown || '').slice(blockStart, blockEnd);
    const sourceItems = flatListSourceItems(raw);
    const items = Array.from(list.children).filter((child) => child.tagName?.toLowerCase() === 'li');
    const itemIndex = items.indexOf(item);
    if (itemIndex < 0 || sourceItems.length !== items.length) return null;
    if (backward) {
      if (itemIndex !== 0 || point.offset !== point.contentStart) return null;
    } else if (itemIndex !== sourceItems.length - 1 || point.offset !== point.contentEnd) {
      return null;
    }

    const markdown = stripRichCaretTokens(state.markdown || els.source.value || '');
    const adjacent = backward ? adjacentSourceBackedBlock(list, 'previous') : adjacentSourceBackedBlock(list, 'next');
    if (!adjacent) return null;
    const adjacentStart = numericData(adjacent, 'sourceStart');
    const adjacentEnd = numericData(adjacent, 'sourceEnd');
    if (!Number.isFinite(adjacentStart) || !Number.isFinite(adjacentEnd)) return null;
    const from = backward ? adjacentEnd : blockEnd;
    const to = backward ? blockStart : adjacentStart;
    if (from < 0 || to <= from || to > markdown.length || !/^\n{1,2}$/.test(markdown.slice(from, to))) return null;
    return {
      from,
      to,
      insert: '',
      selectionAfter: {
        anchor: from,
        focus: from,
        affinity: backward ? 'before' : 'after',
      },
    };
  }

  function handleRichPlainTextSelectionReplacement(event, insert, reason) {
    const selection = window.getSelection?.();
    const tableRange = richTableTextReplacementRangeFromSelection(selection);
    const quoteRange = tableRange ? null : richQuoteTextReplacementRangeFromSelection(selection);
    const rawRange = tableRange || quoteRange || richPlainTextTransactionRangeFromSelection(selection);
    const replacementRange = rawRange?.from !== rawRange?.to
      ? expandSourceRangeToIntersectingInlineAtoms(rawRange)
      : rawRange;
    if (!replacementRange || replacementRange.from === replacementRange.to) return false;

    event.preventDefault();
    pushRichUndoSnapshot(reason || 'selection');
    const replacement = tableRange
      ? markdownTableCellTextFromPlainText(insert || '')
      : quoteRange
        ? markdownQuoteTextFromPlainText(insert || '')
        : stripRichCaretTokens(insert || '');
    const nextOffset = replacementRange.from + replacement.length;
    applySourceTransaction({
      from: replacementRange.from,
      to: replacementRange.to,
      insert: replacement,
      selectionAfter: {
        anchor: nextOffset,
        focus: nextOffset,
        affinity: 'after',
      },
    }, reason || 'rich-selection-replace');
    suppressRichInlineActivation();
    return true;
  }

  function richPlainTextTransactionRangeFromSelection(selection) {
    const range = richSelectionRange(selection);
    if (!range) return null;
    if (isRichSourceTransactionSelectionEndpointBlocked(range.startContainer)) return null;
    if (isRichSourceTransactionSelectionEndpointBlocked(range.endContainer)) return null;

    if (range.collapsed) {
      const lineBreakRange = activeRichLineBreakCaretRange(selection);
      if (lineBreakRange) return lineBreakRange;
      if (!isSourceTransactionTextRange(range)) return null;
      const point = richPlainTextSourcePointFromRange(range);
      if (!point || !Number.isFinite(point.offset)) return null;
      return {
        from: point.offset,
        to: point.offset,
        blankParagraph: Boolean(point.blankParagraph),
        trailingParagraph: Boolean(point.trailingParagraph),
      };
    }

    const sourceSelection = domSelectionToSourceSelection(selection);
    if (!sourceSelection || !Number.isFinite(sourceSelection.anchor) || !Number.isFinite(sourceSelection.focus)) return null;
    const expanded = expandSourceRangeToIntersectingInlineAtoms({
      from: Math.min(sourceSelection.anchor, sourceSelection.focus),
      to: Math.max(sourceSelection.anchor, sourceSelection.focus),
    });
    const { from, to } = expanded;
    if (to < from) return null;
    return { from, to };
  }

  function richLineBreakCaretDeleteTransaction(selection, backward) {
    if (!backward) return null;
    const range = activeRichLineBreakCaretRange(selection);
    if (!range) return null;
    const markdown = stripRichCaretTokens(state.markdown || els.source.value || '');
    const to = range.from;
    const from = to - 3;
    if (from < 0 || markdown[to - 1] !== '\n' || !/[ \t]{2}$/.test(markdown.slice(from, to - 1))) return null;
    return {
      from,
      to,
      insert: '',
      selectionAfter: {
        anchor: from,
        focus: from,
        affinity: 'before',
      },
    };
  }

  function expandSourceRangeToIntersectingInlineAtoms(range) {
    if (!range || !Number.isFinite(range.from) || !Number.isFinite(range.to) || range.to <= range.from) return range;
    let from = range.from;
    let to = range.to;
    for (const atom of Array.from(els.rich.querySelectorAll('.rich-inline-atom[data-src-start][data-src-end]'))) {
      const start = Number(atom.dataset.srcStart);
      const end = Number(atom.dataset.srcEnd);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
      if (from < end && to > start) {
        from = Math.min(from, start);
        to = Math.max(to, end);
      }
    }
    return { ...range, from, to };
  }

  function activeRichLineBreakCaretRange(selection) {
    const range = richSelectionRange(selection);
    if (!range?.collapsed) return null;
    const storedOffset = state.richLineBreakInputOffset !== null && Number.isFinite(Number(state.richLineBreakInputOffset))
      ? Number(state.richLineBreakInputOffset)
      : NaN;
    const activeAnchor = nodeClosest(range.startContainer, '.rich-line-break-caret-anchor')
      || (Number.isFinite(storedOffset) ? richLineBreakCaretAnchorForOffset(storedOffset) : null);
    const offset = Number.isFinite(storedOffset)
      ? storedOffset
      : Number(activeAnchor?.dataset?.sourceOffset);
    if (!activeAnchor || !els.rich.contains(activeAnchor) || !Number.isFinite(offset)) return null;
    const markdown = stripRichCaretTokens(state.markdown || els.source.value || '');
    if (offset <= 0 || offset > markdown.length || markdown[offset - 1] !== '\n') return null;
    return { from: offset, to: offset, lineBreakCaret: true };
  }

  function richLineBreakCaretAnchorForOffset(offset) {
    return Array.from(els.rich?.querySelectorAll?.('.rich-line-break-caret-anchor[data-source-offset]') || [])
      .find((anchor) => Number(anchor.dataset.sourceOffset) === offset) || null;
  }

  function isRichSourceTransactionSelectionEndpointBlocked(node) {
    return Boolean(nodeClosest(node, '.rich-inline-source, .rich-source-editor, .code-language-input, td, th'));
  }

  function currentCollapsedRichRange() {
    const selection = window.getSelection?.();
    const range = richSelectionRange(selection);
    if (!range?.collapsed) return null;
    if (nodeClosest(range.startContainer, '.rich-inline-source, .rich-source-editor, .code-language-input')) return null;
    return range;
  }

  function isSourceTransactionTextRange(range) {
    if (!range?.collapsed) return false;
    if (nodeClosest(range.startContainer, '.rich-inline-atom, .rich-source-editor, .mermaid-diagram, pre.code-block, .math-display, .toc')) return false;
    const editBlock = richInlineEditBlockForRange(range);
    if (!editBlock || !els.rich.contains(editBlock)) return false;
    if (nodeClosest(range.startContainer, '.rich-line-break-caret-anchor')) return true;
    if (editBlock.matches('p[data-rich-trailing="true"]')) return true;
    if (editBlock.matches('p[data-rich-transaction-blank][data-source-gap]')) return true;
    if (editBlock.matches('td, th')) return Boolean(richTableSourcePointFromRange(editBlock, range));
    if (editBlock.matches('blockquote')) return Boolean(richQuoteSourcePointFromRange(editBlock, range));
    if (editBlock.matches('li')) {
      const list = editBlock.parentElement;
      if (!list?.matches?.(RICH_SOURCE_BLOCK_SELECTOR)) return false;
      if (editBlock.querySelector('.rich-inline-source, ul, ol')) return false;
      return true;
    }
    return Boolean(editBlock.matches?.('p, h1, h2, h3, h4, h5, h6') && editBlock.matches(RICH_SOURCE_BLOCK_SELECTOR));
  }

  function richPlainTextSourcePointFromRange(range) {
    const lineBreakAnchor = nodeClosest(range.startContainer, '.rich-line-break-caret-anchor');
    if (lineBreakAnchor && els.rich.contains(lineBreakAnchor)) {
      const editBlock = richInlineEditBlockForRange(range);
      const sourceBlock = nodeClosest(lineBreakAnchor, RICH_SOURCE_BLOCK_SELECTOR);
      if (!editBlock || !sourceBlock) return null;
      const blockStart = numericData(sourceBlock, 'sourceStart');
      const blockEnd = numericData(sourceBlock, 'sourceEnd');
      const baseOffset = sourceContentBaseOffset(sourceBlock);
      const storedOffset = Number(lineBreakAnchor.dataset.sourceOffset);
      if (Number.isFinite(storedOffset)) {
        return {
          offset: storedOffset,
          contentStart: blockStart + baseOffset,
          contentEnd: blockEnd,
          quoteBlock: editBlock.matches?.('blockquote') || undefined,
        };
      }
      const before = document.createRange();
      before.selectNodeContents(editBlock);
      try {
        before.setEndBefore(lineBreakAnchor);
      } catch (_) {
        return null;
      }
      const anchorBefore = document.createRange();
      anchorBefore.selectNodeContents(lineBreakAnchor);
      try {
        anchorBefore.setEnd(range.startContainer, range.startOffset);
      } catch (_) {
        return null;
      }
      const localSource = stripRichCaretTokens(serializeInlineNodes(Array.from(before.cloneContents().childNodes)));
      const anchorSource = normalizeRichText(anchorBefore.toString()).replace(/\u200b/g, '');
      return {
        offset: blockStart + baseOffset + localSource.length + anchorSource.length,
        contentStart: blockStart + baseOffset,
        contentEnd: numericData(sourceBlock, 'sourceEnd'),
      };
    }

    const trailingParagraph = nodeClosest(range.startContainer, 'p[data-rich-trailing="true"]');
    if (trailingParagraph && els.rich.contains(trailingParagraph)) {
      const markdown = stripRichCaretTokens(state.markdown || els.source.value || '');
      const before = range.cloneRange();
      before.selectNodeContents(trailingParagraph);
      try {
        before.setEnd(range.startContainer, range.startOffset);
      } catch (_) {
        return null;
      }
      const localSource = stripRichCaretTokens(serializeInlineNodes(Array.from(before.cloneContents().childNodes)));
      const gap = markdown.length;
      return {
        offset: gap + localSource.length,
        contentStart: gap,
        contentEnd: gap,
        trailingParagraph: true,
      };
    }

    const blankParagraph = nodeClosest(range.startContainer, 'p[data-rich-transaction-blank][data-source-gap]');
    if (blankParagraph && els.rich.contains(blankParagraph)) {
      const gap = Number(blankParagraph.dataset.sourceGap);
      if (!Number.isFinite(gap)) return null;
      const before = range.cloneRange();
      before.selectNodeContents(blankParagraph);
      try {
        before.setEnd(range.startContainer, range.startOffset);
      } catch (_) {
        return null;
      }
      const localSource = stripRichCaretTokens(serializeInlineNodes(Array.from(before.cloneContents().childNodes)));
      return {
        offset: gap + localSource.length,
        contentStart: gap,
        contentEnd: gap,
        blankParagraph: true,
      };
    }

    const item = nodeClosest(range.startContainer, 'li');
    if (item && els.rich.contains(item)) {
      return richListSourcePointFromRange(item, range);
    }

    const cell = nodeClosest(range.startContainer, 'td, th');
    if (cell && els.rich.contains(cell)) {
      const point = richTableSourcePointFromRange(cell, range);
      return point ? { ...point, tableCell: true } : null;
    }

    const quote = nodeClosest(range.startContainer, 'blockquote');
    if (quote && els.rich.contains(quote)) {
      const point = richQuoteSourcePointFromRange(quote, range);
      return point ? { ...point, quoteBlock: true } : null;
    }

    const sourceBlock = nodeClosest(range.startContainer, RICH_SOURCE_BLOCK_SELECTOR);
    if (!sourceBlock) return null;
    const point = domPointToSourceOffset(range.startContainer, range.startOffset);
    if (!point) return null;
    const start = numericData(sourceBlock, 'sourceStart');
    const end = numericData(sourceBlock, 'sourceEnd');
    const contentStart = start + sourceContentBaseOffset(sourceBlock);
    if (!Number.isFinite(start) || !Number.isFinite(end) || point.offset < contentStart || point.offset > end) return null;
    return {
      offset: point.offset,
      contentStart,
      contentEnd: end,
    };
  }

  function richListSourcePointFromRange(item, range) {
    const list = item.closest('ul, ol');
    if (!list?.matches?.(RICH_SOURCE_BLOCK_SELECTOR) || item.parentElement !== list) return null;
    const blockStart = numericData(list, 'sourceStart');
    const blockEnd = numericData(list, 'sourceEnd');
    if (!Number.isFinite(blockStart) || !Number.isFinite(blockEnd)) return null;
    const raw = stripRichCaretTokens(state.markdown || '').slice(blockStart, blockEnd);
    const sourceItems = flatListSourceItems(raw);
    const items = Array.from(list.children).filter((child) => child.tagName?.toLowerCase() === 'li');
    const itemIndex = items.indexOf(item);
    if (itemIndex < 0 || sourceItems.length !== items.length) return null;
    const sourceItem = sourceItems[itemIndex];
    const content = visibleTextFromListSourceItem(sourceItem);
    if (isRichListItemEmpty(item)) {
      if (content.trim() !== '') return null;
      const sourceOffset = sourceOffsetFromListItemTextOffset(sourceItem, 0);
      return {
        offset: blockStart + sourceOffset,
        contentStart: blockStart + sourceItem.lines[0].start + sourceItem.parsed.prefix.length,
        contentEnd: blockStart + listSourceItemTextEnd(sourceItem),
      };
    }
    if (content !== visibleListItemText(item)) return null;
    const caretOffset = Math.max(0, Math.min(content.length, richListCaretSourceContentOffset(item, range)));
    const sourceOffset = sourceOffsetFromListItemTextOffset(sourceItem, caretOffset);
    return {
      offset: blockStart + sourceOffset,
      contentStart: blockStart + sourceItem.lines[0].start + sourceItem.parsed.prefix.length,
      contentEnd: blockStart + sourceItem.end,
    };
  }

  function richTableSourcePointFromRange(cell, range) {
    if (!cell?.matches?.('td, th') || !range?.collapsed) return null;
    const cellRange = richTableCellSourceRange(cell);
    if (!cellRange) return null;
    const before = range.cloneRange();
    before.selectNodeContents(cell);
    try {
      before.setEnd(range.startContainer, range.startOffset);
    } catch (_) {
      return null;
    }
    const localSource = serializeTableCellInlineNodes(Array.from(before.cloneContents().childNodes));
    const offset = Math.max(
      cellRange.contentStart,
      Math.min(cellRange.contentEnd, cellRange.contentStart + localSource.length),
    );
    return {
      offset,
      contentStart: cellRange.contentStart,
      contentEnd: cellRange.contentEnd,
    };
  }

  function richQuoteSourcePointFromRange(blockquote, range) {
    if (!blockquote?.matches?.('blockquote') || !range?.collapsed) return null;
    const blockStart = numericData(blockquote, 'sourceStart');
    const blockEnd = numericData(blockquote, 'sourceEnd');
    if (!Number.isFinite(blockStart) || !Number.isFinite(blockEnd)) return null;
    const raw = stripRichCaretTokens(state.markdown || '').slice(blockStart, blockEnd);
    const model = parseMarkdownQuoteSource(raw);
    if (!model?.lines?.length) return null;

    const before = range.cloneRange();
    before.selectNodeContents(blockquote);
    try {
      before.setEnd(range.startContainer, range.startOffset);
    } catch (_) {
      return null;
    }
    const renderedOffset = stripRichCaretTokens(serializeInlineNodes(Array.from(before.cloneContents().childNodes))).length;
    const mapped = quoteSourcePositionFromRenderedOffset(model, renderedOffset);
    if (!mapped) return null;
    return {
      offset: blockStart + mapped.sourceOffset,
      contentStart: blockStart + mapped.line.line.start + mapped.line.contentStart,
      contentEnd: blockStart + mapped.line.line.start + mapped.line.contentEnd,
      quote: {
        blockStart,
        blockEnd,
        model,
        lineIndex: mapped.lineIndex,
      },
    };
  }

  function parseMarkdownQuoteSource(raw) {
    const lines = getLines(raw).filter((line) => line.text.trim() !== '');
    const quoteLines = [];
    let renderedStart = 0;
    for (const line of lines) {
      const match = line.text.match(/^(\s*>\s?)(.*)$/);
      if (!match) return null;
      const prefix = match[1] || '';
      const content = match[2] || '';
      const contentStart = prefix.length;
      const contentEnd = line.text.length;
      quoteLines.push({
        line,
        prefix,
        content,
        contentStart,
        contentEnd,
        renderedStart,
        renderedEnd: renderedStart + content.length,
      });
      renderedStart += content.length + 1;
    }
    return { lines: quoteLines };
  }

  function quoteSourcePositionFromRenderedOffset(model, offset) {
    const lines = model?.lines || [];
    if (!lines.length) return null;
    const target = Math.max(0, Number(offset) || 0);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (target <= line.renderedEnd) {
        const inLine = Math.max(0, Math.min(line.content.length, target - line.renderedStart));
        return {
          line,
          lineIndex: index,
          sourceOffset: line.line.start + line.contentStart + inLine,
        };
      }
      if (index < lines.length - 1 && target <= line.renderedEnd + 1) {
        const next = lines[index + 1];
        return {
          line: next,
          lineIndex: index + 1,
          sourceOffset: next.line.start + next.contentStart,
        };
      }
    }
    const lastIndex = lines.length - 1;
    const last = lines[lastIndex];
    return {
      line: last,
      lineIndex: lastIndex,
      sourceOffset: last.line.start + last.contentEnd,
    };
  }

  function richQuoteBoundaryDeleteTransaction(point, backward) {
    const quote = point?.quote;
    if (!quote?.model?.lines?.length) return null;
    const lines = quote.model.lines;
    const index = quote.lineIndex;
    const line = lines[index];
    if (!line) return null;
    const localOffset = point.offset - quote.blockStart;
    if (backward && index === 0 && localOffset === line.line.start + line.contentStart) {
      const from = quote.blockStart + line.line.start;
      const to = quote.blockStart + line.line.start + line.contentStart;
      return {
        from,
        to,
        insert: '',
        selectionAfter: {
          anchor: from,
          focus: from,
          affinity: 'before',
        },
      };
    }
    if (backward && index > 0 && localOffset === line.line.start + line.contentStart) {
      const previous = lines[index - 1];
      const from = quote.blockStart + previous.line.start + previous.contentEnd;
      const to = quote.blockStart + line.line.start + line.contentStart;
      return {
        from,
        to,
        insert: '',
        selectionAfter: {
          anchor: from,
          focus: from,
          affinity: 'before',
        },
      };
    }
    if (!backward && index < lines.length - 1 && localOffset === line.line.start + line.contentEnd) {
      const next = lines[index + 1];
      const from = quote.blockStart + line.line.start + line.contentEnd;
      const to = quote.blockStart + next.line.start + next.contentStart;
      return {
        from,
        to,
        insert: '',
        selectionAfter: {
          anchor: from,
          focus: from,
          affinity: 'after',
        },
      };
    }
    if (!backward && index === lines.length - 1 && localOffset === line.line.start + line.contentEnd) {
      const nextContentStart = nextMarkdownContentStartAfterOffset(quote.blockEnd);
      const from = quote.blockStart + line.line.start + line.contentEnd;
      if (Number.isFinite(nextContentStart) && nextContentStart > from) {
        return {
          from,
          to: nextContentStart,
          insert: '',
          selectionAfter: {
            anchor: from,
            focus: from,
            affinity: 'after',
          },
        };
      }
    }
    return null;
  }

  function nextMarkdownContentStartAfterOffset(offset) {
    const markdown = stripRichCaretTokens(state.markdown || els.source.value || '');
    const start = Math.max(0, Math.min(markdown.length, Number(offset)));
    for (let index = start; index < markdown.length; index += 1) {
      if (markdown[index] !== '\n' && markdown[index] !== '\r') return index;
    }
    return null;
  }

  function richTableCellSourceRange(cell) {
    const location = richTableCellLocation(cell);
    if (!location) return null;
    const table = location.table;
    if (!table.matches?.(RICH_SOURCE_BLOCK_SELECTOR)) return null;
    const blockStart = numericData(table, 'sourceStart');
    const blockEnd = numericData(table, 'sourceEnd');
    if (!Number.isFinite(blockStart) || !Number.isFinite(blockEnd)) return null;
    const raw = stripRichCaretTokens(state.markdown || '').slice(blockStart, blockEnd);
    const model = parseMarkdownTableSource(raw);
    const sourceRow = model?.rows?.[location.lineIndex];
    const sourceCell = sourceRow?.cells?.[location.cellIndex];
    if (!sourceRow || !sourceCell) return null;
    return {
      table,
      blockStart,
      blockEnd,
      line: sourceRow.line,
      cell: sourceCell,
      contentStart: blockStart + sourceRow.line.start + sourceCell.contentStart,
      contentEnd: blockStart + sourceRow.line.start + sourceCell.contentEnd,
    };
  }

  function richTableCellLocation(cell) {
    if (!cell?.matches?.('td, th')) return null;
    const table = cell.closest('table');
    const row = cell.parentElement;
    if (!table || !row || !els.rich.contains(table)) return null;
    const cellIndex = Array.from(row.children).indexOf(cell);
    if (cellIndex < 0) return null;
    if (cell.tagName?.toLowerCase() === 'th') {
      return { table, lineIndex: 0, cellIndex };
    }
    const bodyRows = Array.from(table.querySelectorAll('tbody > tr'));
    const bodyIndex = bodyRows.indexOf(row);
    return bodyIndex >= 0 ? { table, lineIndex: bodyIndex + 2, cellIndex } : null;
  }

  function parseMarkdownTableSource(raw) {
    const lines = getLines(raw).filter((line) => line.text.trim() !== '');
    if (lines.length < 2) return null;
    return {
      lines,
      rows: lines.map((line) => ({
        line,
        cells: splitTableRowWithSourceRanges(line.text),
      })),
    };
  }

  function splitTableRowWithSourceRanges(line) {
    const value = String(line || '');
    let start = 0;
    let end = value.length;
    if (value[start] === '|') start += 1;
    if (end > start && value[end - 1] === '|') end -= 1;

    const cells = [];
    let cellStart = start;
    for (let index = start; index <= end; index += 1) {
      const atEnd = index === end;
      const isPipe = !atEnd && value[index] === '|' && !isEscapedMarkdownPipe(value, index);
      if (!atEnd && !isPipe) continue;
      cells.push(tableCellSourceRangeFromSegment(value, cellStart, index));
      cellStart = index + 1;
    }
    return cells;
  }

  function isEscapedMarkdownPipe(value, index) {
    if (String(value || '')[index] !== '|') return false;
    let slashCount = 0;
    for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) {
      slashCount += 1;
    }
    return slashCount % 2 === 1;
  }

  function unescapeMarkdownTableCell(value) {
    return String(value || '').replace(/\\\|/g, '|');
  }

  function tableCellSourceRangeFromSegment(row, start, end) {
    const segment = row.slice(start, end);
    const leading = segment.match(/^\s*/)?.[0].length || 0;
    const trailing = segment.match(/\s*$/)?.[0].length || 0;
    const contentStart = start + leading;
    const contentEnd = Math.max(contentStart, end - trailing);
    return {
      start,
      end,
      contentStart,
      contentEnd,
      raw: row.slice(contentStart, contentEnd),
    };
  }

  function shouldLetDomHandleMarkdownShortcutInput(range, text) {
    const block = nodeClosest(range.startContainer, 'p');
    if (!block || block.closest('li') || !block.matches?.(RICH_SOURCE_BLOCK_SELECTOR)) return false;
    const current = normalizeRichText(block.textContent || '');
    const caretOffset = getCaretCharacterOffsetWithin(block, window.getSelection?.());
    const next = `${current.slice(0, caretOffset)}${text}${current.slice(caretOffset)}`;
    return isPendingMarkdownShortcutText(next);
  }

  function isPendingMarkdownShortcutText(text) {
    return /^[-+*] $/.test(text)
      || /^1\. $/.test(text)
      || /^- \[(?: |x|X)?\]? ?$/.test(text)
      || text === '| '
      || text === '---'
      || text === '$$'
      || text === '$$$$'
      || text === '$$ '
      || text === '$$$$ ';
  }

  function richInlineBoundaryInsertTransaction(inlineElement, text, boundary) {
    if (!inlineElement?.classList?.contains('rich-inline-atom')) return null;
    const start = Number(inlineElement.dataset.srcStart);
    const end = Number(inlineElement.dataset.srcEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    const from = boundary === 'before' ? start : end;
    const nextOffset = from + String(text || '').length;
    return {
      from,
      to: from,
      insert: String(text || ''),
      selectionAfter: {
        anchor: nextOffset,
        focus: nextOffset,
        affinity: 'after',
      },
    };
  }

  function applySourceTransaction(transaction, reason = 'source-transaction') {
    if (!transaction) return false;
    const markdown = stripRichCaretTokens(state.markdown || els.source.value || '');
    let from = Math.max(0, Math.min(markdown.length, Number(transaction.from)));
    let to = Math.max(from, Math.min(markdown.length, Number(transaction.to)));
    let insert = stripRichCaretTokens(transaction.insert || '');
    const oldRichBlock = state.mode === 'rich' ? richSourceTransactionBlockForRange(from, to, transaction.selectionAfter) : null;
    const shortcut = richMarkdownShortcutTransactionRewrite(oldRichBlock, markdown, from, to, insert, reason);
    if (shortcut) {
      from = shortcut.from;
      to = shortcut.to;
      insert = shortcut.insert;
      transaction = {
        ...transaction,
        selectionAfter: shortcut.selectionAfter,
        blankParagraphAt: shortcut.blankParagraphAt,
      };
      setStatus(shortcut.status);
    }
    const canPatchRich = canPatchRichBlockTransaction(oldRichBlock, from, to, insert);
    state.markdown = markdown.slice(0, from) + insert + markdown.slice(to);
    els.source.value = state.markdown;
    syncCodeMirrorSourceFromTextarea(reason);
    markDirty();
    if (canPatchRich && patchRichBlockAfterTransaction(oldRichBlock, transaction.selectionAfter?.focus ?? from + insert.length)) {
      if (refreshRichSourceRangesFromMarkdown()) {
        renderPreview();
        renderOutline();
        updateStatusBar();
      } else {
        renderAll(reason);
      }
    } else {
      renderAll(reason);
    }
    const shouldRestoreAfterBlankParagraph = transaction.placeCaretInBlankParagraph === false;
    if (shouldRestoreAfterBlankParagraph && Number.isFinite(transaction.blankParagraphAt)) {
      ensureRichBlankParagraphAtSourceGap(transaction.blankParagraphAt, { placeCaret: false });
    }
    restoreRichCaretFromSourceSelection(transaction.selectionAfter);
    if (!shouldRestoreAfterBlankParagraph && Number.isFinite(transaction.blankParagraphAt)) {
      ensureRichBlankParagraphAtSourceGap(transaction.blankParagraphAt);
    }
    scheduleAutosave();
    return true;
  }

  function richSourceTransactionBlockForRange(from, to, selectionAfter) {
    return renderedBlockForSourceOffset(els.rich, from)
      || renderedBlockForSourceOffset(els.rich, to)
      || renderedBlockForSourceOffset(els.rich, selectionAfter?.focus)
      || renderedBlockForSourceOffset(els.rich, selectionAfter?.anchor);
  }

  function richMarkdownShortcutTransactionRewrite(oldRichBlock, markdown, from, to, insert, reason) {
    if (!isRichMarkdownShortcutTransactionReason(reason) || !oldRichBlock?.matches?.(`p${RICH_SOURCE_BLOCK_SELECTOR}`)) return null;
    if (oldRichBlock.closest('li') || String(insert || '').includes('\n')) return null;
    const start = numericData(oldRichBlock, 'sourceStart');
    const end = numericData(oldRichBlock, 'sourceEnd');
    if (!Number.isFinite(start) || !Number.isFinite(end) || from < start || to > end) return null;
    const nextBlockSource = markdown.slice(start, from) + insert + markdown.slice(to, end);
    const replacement = richBlockMarkdownTriggerReplacement(nextBlockSource, { allowBareMath: false });
    if (!replacement) return null;
    const selectionOffset = start + (Number.isFinite(replacement.selectionOffset)
      ? replacement.selectionOffset
      : replacement.insert.length);
    return {
      from: start,
      to: end,
      insert: replacement.insert,
      selectionAfter: {
        anchor: selectionOffset,
        focus: selectionOffset,
        affinity: 'after',
      },
      blankParagraphAt: replacement.blankParagraphAt ? start + replacement.insert.length : undefined,
      status: replacement.status,
    };
  }

  function isRichMarkdownShortcutTransactionReason(reason) {
    return [
      'rich-text-insert',
      'rich-selection-insert',
      'rich-selection-replace',
      'rich-input-source-fallback',
      'rich-composition',
      'rich-inline-boundary-insert',
      'rich-paste',
    ].includes(reason);
  }

  function canPatchRichBlockTransaction(oldRichBlock, from, to, insert) {
    if (!oldRichBlock || String(insert).includes('\n')) return false;
    const start = numericData(oldRichBlock, 'sourceStart');
    const end = numericData(oldRichBlock, 'sourceEnd');
    return Number.isFinite(start) && Number.isFinite(end) && start <= from && to <= end;
  }

  function patchRichBlockAfterTransaction(oldRichBlock, focusOffset) {
    if (!oldRichBlock?.isConnected) return false;
    const blocks = buildBlockModel(state.markdown);
    const block = blocks.find((item) => item.start <= focusOffset && focusOffset <= item.end)
      || blocks.find((item) => item.start <= numericData(oldRichBlock, 'sourceStart') && numericData(oldRichBlock, 'sourceStart') <= item.end);
    if (!block) return false;
    const headings = buildHeadingIndex(blocks);
    const template = document.createElement('template');
    template.innerHTML = annotateRenderedBlockHtml(renderBlockHtml(block, headings), block);
    enhanceRenderedHtml(template.content);
    preserveRichInlineTrailingWhitespace(template.content, block.raw);
    const nextNodes = Array.from(template.content.childNodes);
    if (!nextNodes.length) return false;
    try {
      oldRichBlock.replaceWith(...nextNodes);
    } catch (_) {
      return false;
    }
    stabilizePatchedRichInlineBlocks(nextNodes);
    ensureRichTrailingEditableParagraph();
    configureRichEditableSurface();
    return true;
  }

  function preserveRichInlineTrailingWhitespace(root, source) {
    const trailing = String(source || '').match(/[ \t]+$/)?.[0] || '';
    if (!trailing || !root?.querySelector) return false;
    const block = root.querySelector(RICH_SOURCE_BLOCK_SELECTOR);
    if (!block?.matches?.(RICH_INLINE_EDIT_BLOCK_SELECTOR)) return false;
    if (/[ \t\u00a0]$/.test(block.textContent || '')) return false;
    block.appendChild(document.createTextNode(trailing.replace(/ /g, '\u00a0')));
    return true;
  }

  function stabilizePatchedRichInlineBlocks(nodes) {
    let changed = false;
    for (const node of nodes) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      if (!node.matches?.(RICH_INLINE_EDIT_BLOCK_SELECTOR)) continue;
      if (parsePendingRichInlineMarkdownInBlock(node)) changed = true;
      wrapRenderedInlineAtoms(node);
    }
    if (changed) annotateRenderedInlineAtomRanges(els.rich);
    return changed;
  }

  function ensureRichBlankParagraphAtSourceGap(offset, options = {}) {
    if (state.mode !== 'rich' || !els.rich) return false;
    const target = Number(offset);
    if (!Number.isFinite(target)) return false;
    const placeCaret = options.placeCaret !== false;
    const existing = richEmptySourceParagraphAtGap(target);
    if (existing) {
      state.richTransactionBlank = null;
      configureRichEditableSurface();
      if (placeCaret) placeCaretAtStart(existing);
      return true;
    }
    const paragraph = document.createElement('p');
    paragraph.dataset.richTransactionBlank = placeCaret ? 'true' : 'visual';
    paragraph.dataset.sourceGap = String(target);
    if (!placeCaret) {
      paragraph.setAttribute('contenteditable', 'false');
      paragraph.setAttribute('aria-hidden', 'true');
    }
    const anchor = document.createElement('span');
    anchor.className = 'rich-list-caret-anchor';
    const textNode = document.createTextNode('\u200b');
    anchor.appendChild(textNode);
    paragraph.appendChild(anchor);
    paragraph.appendChild(document.createElement('br'));

    const blocks = Array.from(els.rich.querySelectorAll(RICH_SOURCE_BLOCK_SELECTOR));
    const nextBlock = blocks.find((block) => numericData(block, 'sourceStart') >= target);
    const previousBlock = blocks.slice().reverse().find((block) => numericData(block, 'sourceEnd') <= target);
    if (nextBlock?.parentNode === els.rich) {
      nextBlock.before(paragraph);
    } else if (previousBlock?.parentNode === els.rich) {
      previousBlock.after(paragraph);
    } else {
      els.rich.appendChild(paragraph);
    }
    state.richTransactionBlank = placeCaret ? { element: paragraph, sourceGap: target } : null;
    configureRichEditableSurface();
    if (placeCaret) placeCaretInTextNode(textNode, textNode.nodeValue.length);
    return true;
  }

  function richEmptySourceParagraphAtGap(offset) {
    return Array.from(els.rich?.querySelectorAll?.(`p${RICH_SOURCE_BLOCK_SELECTOR}`) || [])
      .find((paragraph) => (
        numericData(paragraph, 'sourceStart') === offset
        && numericData(paragraph, 'sourceEnd') === offset
        && isEmptyRichParagraph(paragraph)
      )) || null;
  }

  function onDocumentBeforeInput(event) {
    if (isProseMirrorRichTarget(eventTargetElement(event))) return;
    onRichBeforeInput(event);
  }

  function onDocumentKeyUp(event) {
    if (event.defaultPrevented || state.mode !== 'rich' || event.key !== ' ') return;
    if (isProseMirrorRichActive()) return;
    applyRichQuoteShortcutAfterSpaceKey();
  }

  function applyRichQuoteShortcutAfterSpaceKey() {
    const selection = window.getSelection?.();
    const selectedBlock = selection?.rangeCount && els.rich.contains(selection.anchorNode)
      ? nodeClosest(selection.anchorNode, 'p')
      : null;
    const candidates = selectedBlock ? [selectedBlock] : Array.from(els.rich.querySelectorAll('p'));
    for (const block of candidates) {
      if (!block || block.closest('li') || normalizeRichText(block.textContent || '') !== '| ') continue;
      if (block.matches?.(RICH_SOURCE_BLOCK_SELECTOR) && applyRichBlockMarkdownTriggerTransaction(block, '| ', { allowBareMath: false })) {
        return true;
      }
      replaceParagraphWithTriggeredQuote(block);
      return true;
    }
    return false;
  }

  function isRichBeforeInputContext(event) {
    if (state.mode !== 'rich' || state.richComposing) return false;
    const target = eventTargetElement(event);
    if (isProseMirrorRichTarget(target)) return false;
    const selection = window.getSelection?.();
    if (selection?.anchorNode && nodeClosest(selection.anchorNode, '.rich-inline-source')) return false;
    if (target?.closest?.('.task-checkbox, .code-language-input, .rich-source-editor, .rich-inline-source')) return false;
    if (target && els.rich.contains(target)) return true;
    return Boolean(
      selection
      && selection.rangeCount
      && selection.isCollapsed
      && els.rich.contains(selection.anchorNode)
    );
  }

  function maybeApplyRichMarkdownTrigger(_event) {
    if (state.richComposing || state.richInlineSource?.element) return false;
    const selection = window.getSelection?.();
    if (!selection || !selection.rangeCount || !selection.isCollapsed || !els.rich.contains(selection.anchorNode)) return false;
    if (nodeClosest(selection.anchorNode, '.rich-source-editor, .code-language-input, .rich-inline-source')) return false;
    if (nodeClosest(selection.anchorNode, '.mermaid-diagram, pre.code-block, .math-display')) return false;

    return applyRichBlockMarkdownTrigger(selection)
      || applyRichInlineMarkdownTrigger(selection)
      || applyRichInlineMarkdownRunTrigger();
  }

  function applyRichBlockMarkdownTrigger(selection) {
    const block = nodeClosest(selection.anchorNode, 'p');
    if (!block || block.closest('li')) return false;
    const caretOffset = getCaretCharacterOffsetWithin(block, selection);
    const text = normalizeRichText(block.textContent || '');
    const blockReplacement = richBlockMarkdownTriggerReplacement(text, { allowBareMath: false });
    if (caretOffset !== text.length && !blockReplacement) return false;

    if (applyRichBlockMarkdownTriggerTransaction(block, text, { allowBareMath: false })) return true;

    if (text === '$$$$ ') {
      replaceParagraphWithMathDisplayEditor(block);
      return true;
    }

    if (text === '$$ ') {
      replaceParagraphWithMathInlineSource(block);
      return true;
    }

    if (text === '| ') {
      replaceParagraphWithTriggeredQuote(block);
      return true;
    }

    if (text === '---') {
      replaceParagraphWithHorizontalRule(block);
      return true;
    }

    const task = text.match(/^- \[( |x|X)\] $/);
    if (task) {
      replaceParagraphWithTriggeredList(block, { ordered: false, task: true, checked: task[1].toLowerCase() === 'x' });
      return true;
    }

    const dashList = text.match(/^- (.+)$/);
    if (dashList && !isPendingTaskListPrefix(text)) {
      replaceParagraphWithTriggeredList(block, { ordered: false, task: false, checked: false, content: dashList[1] });
      return true;
    }

    if (/^[*+] $/.test(text) || text === '-  ') {
      replaceParagraphWithTriggeredList(block, { ordered: false, task: false, checked: false });
      return true;
    }

    if (/^1\. $/.test(text)) {
      replaceParagraphWithTriggeredList(block, { ordered: true, task: false, checked: false });
      return true;
    }

    return false;
  }

  function isPendingTaskListPrefix(text) {
    return /^- \[(?: |x|X)?\]? ?$/.test(text);
  }

  function applyRichBlockMarkdownTriggerTransaction(block, text, options = {}) {
    const replacement = richBlockMarkdownTriggerReplacement(text, options);
    if (!replacement || !block?.matches?.(RICH_SOURCE_BLOCK_SELECTOR)) return false;
    const start = numericData(block, 'sourceStart');
    const end = numericData(block, 'sourceEnd');
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return false;
    const insert = replacement.insert;
    const selectionOffset = start + (Number.isFinite(replacement.selectionOffset) ? replacement.selectionOffset : insert.length);
    state.richInputUsedSourceTransaction = true;
    applySourceTransaction({
      from: start,
      to: end,
      insert,
      selectionAfter: {
        anchor: selectionOffset,
        focus: selectionOffset,
        affinity: 'after',
      },
      blankParagraphAt: replacement.blankParagraphAt ? start + insert.length : undefined,
    }, `rich-markdown-trigger-${replacement.kind}`);
    finishRichBlockMarkdownTriggerReplacement(replacement, start, insert.length);
    return true;
  }

  function finishRichBlockMarkdownTriggerReplacement(replacement, start, insertLength) {
    if (replacement.kind === 'math-inline') {
      if (!activateInsertedInlineSource(start, start + insertLength, 1, 1)) {
        const block = renderedBlockForSourceOffset(els.rich, start);
        if (block?.tagName?.toLowerCase() === 'p') replaceParagraphWithMathInlineSource(block);
      }
    } else if (replacement.kind === 'math-display') {
      openInsertedDisplayMathSourceEditor(start, insertLength);
    }
    setStatus(replacement.status);
  }

  function guardUnsupportedRichBlockMarkdownTriggerFallback(block) {
    if (!block?.matches?.(RICH_SOURCE_BLOCK_SELECTOR)) return false;
    setStatus('このMarkdownショートカットを反映できませんでした');
    suppressRichInlineActivation();
    return true;
  }

  function richBlockMarkdownTriggerReplacement(text, options = {}) {
    const value = String(text || '');
    const allowBareMath = options.allowBareMath !== false;
    if (!allowBareMath && (value === '$$' || value === '$$$$')) return null;
    if (value === '$$' || value === '$$ ') {
      return {
        kind: 'math-inline',
        insert: '$$',
        selectionOffset: 1,
        status: 'インライン数式を挿入しました',
      };
    }
    if (value === '$$$$' || value === '$$$$ ') {
      return {
        kind: 'math-display',
        insert: '$$$$',
        selectionOffset: 2,
        status: '数式ブロックを挿入しました',
      };
    }
    if (value === '| ') {
      return {
        kind: 'quote',
        insert: '> ',
        status: '引用を開始しました',
      };
    }
    if (value === '---') {
      return {
        kind: 'rule',
        insert: '---',
        blankParagraphAt: true,
        status: '横線を挿入しました',
      };
    }
    const task = value.match(/^- \[( |x|X)\] $/);
    if (task) {
      return {
        kind: 'task-list',
        insert: `- [${task[1].toLowerCase() === 'x' ? 'x' : ' '}] `,
        status: 'チェックリストを開始しました',
      };
    }
    const dashList = value.match(/^- (.+)$/);
    if (dashList && !isPendingTaskListPrefix(value)) {
      return {
        kind: 'list',
        insert: `- ${dashList[1]}`,
        status: '箇条書きを開始しました',
      };
    }
    if (/^[*+] $/.test(value) || value === '-  ') {
      return {
        kind: 'list',
        insert: `${value[0]} `,
        status: '箇条書きを開始しました',
      };
    }
    if (/^1\. $/.test(value)) {
      return {
        kind: 'ordered-list',
        insert: '1. ',
        status: '番号付きリストを開始しました',
      };
    }
    return null;
  }

  function openInsertedDisplayMathSourceEditor(start, length) {
    const end = start + length;
    const display = Array.from(els.rich.querySelectorAll('.math-display'))
      .find((element) => Number(element.dataset.sourceStart) === start && Number(element.dataset.sourceEnd) === end);
    if (!display) return false;
    showRichSourceEditor('math', display, { editorValue: '$$$$', caretOffset: 2 });
    return true;
  }

  function activatePendingMathShortcutFromSelection() {
    if (state.mode !== 'rich' || state.richComposing) return false;
    const selection = window.getSelection?.();
    if (!selection || !selection.rangeCount || !selection.isCollapsed || !els.rich.contains(selection.anchorNode)) return false;
    const block = nodeClosest(selection.anchorNode, 'p');
    if (!block || block.closest('li')) return false;
    const text = normalizeRichText(block.textContent || '');
    if (text === '$$$$') {
      if (applyRichBlockMarkdownTriggerTransaction(block, text, { allowBareMath: true })) return true;
      if (guardUnsupportedRichBlockMarkdownTriggerFallback(block)) return true;
      replaceParagraphWithMathDisplayEditor(block);
      syncRichMarkdownFromDom('rich-input');
      return true;
    }
    if (text === '$$') {
      if (applyRichBlockMarkdownTriggerTransaction(block, text, { allowBareMath: true })) return true;
      if (guardUnsupportedRichBlockMarkdownTriggerFallback(block)) return true;
      replaceParagraphWithMathInlineSource(block);
      syncRichMarkdownFromDom('rich-input');
      return true;
    }
    return false;
  }

  function replaceParagraphWithTriggeredList(block, config) {
    const list = document.createElement(config.ordered ? 'ol' : 'ul');
    if (config.task) list.className = 'task-list';
    const item = document.createElement('li');
    if (config.task) {
      item.className = 'task-list-item';
      const checkbox = createTaskCheckbox();
      checkbox.checked = Boolean(config.checked);
      item.appendChild(checkbox);
    }
    const content = String(config.content || '');
    if (content) {
      item.appendChild(document.createTextNode(content));
    } else {
      item.appendChild(document.createTextNode(''));
      item.appendChild(document.createElement('br'));
    }
    list.appendChild(item);

    state.richSelectionLock = true;
    block.replaceWith(list);
    if (content) {
      placeCaretAtListItemEnd(item);
    } else {
      placeCaretAtListItemStart(item);
    }
    state.richSelectionLock = false;
  }

  function replaceParagraphWithTriggeredQuote(block) {
    const quote = document.createElement('blockquote');
    const paragraph = document.createElement('p');
    paragraph.appendChild(document.createTextNode(''));
    paragraph.appendChild(document.createElement('br'));
    quote.appendChild(paragraph);

    state.richSelectionLock = true;
    block.replaceWith(quote);
    placeCaretAtStart(paragraph);
    state.richSelectionLock = false;
  }

  function replaceParagraphWithHorizontalRule(block) {
    const rule = document.createElement('hr');
    rule.setAttribute('contenteditable', 'false');
    const paragraph = document.createElement('p');
    paragraph.appendChild(document.createTextNode(''));
    paragraph.appendChild(document.createElement('br'));

    state.richSelectionLock = true;
    block.replaceWith(rule, paragraph);
    placeCaretAtStart(paragraph);
    state.richSelectionLock = false;
  }

  function replaceParagraphWithMathInlineSource(block) {
    const sourceElement = createRichInlineSourceElement('$$');
    state.richSelectionLock = true;
    block.replaceChildren(sourceElement);
    state.richInlineSource = { element: sourceElement };
    placeCaretInInlineSource(sourceElement, 1);
    state.richSelectionLock = false;
  }

  function replaceParagraphWithMathDisplayEditor(block) {
    const display = document.createElement('div');
    display.className = 'math-display';
    display.setAttribute('data-math-source', '');
    display.setAttribute('data-math-display', 'true');
    display.setAttribute('contenteditable', 'false');

    state.richSelectionLock = true;
    block.replaceWith(display);
    showRichSourceEditor('math', display, { editorValue: '$$$$', caretOffset: 2 });
    state.richSelectionLock = false;
  }

  function applyRichInlineMarkdownTrigger(selection) {
    const range = richSelectionRange(selection);
    if (!range?.collapsed) return false;
    const caret = textCaretForMarkdownTrigger(range);
    if (!caret) return false;
    const { textNode, caretOffset } = mergeAdjacentTextNodesForMarkdownTrigger(caret.textNode, caret.caretOffset);
    const before = textNode.nodeValue.slice(0, caretOffset);

    if (before.endsWith('$$ ') && !before.endsWith('$$$$ ')) {
      replaceTextRangeWithRichInlineSource(textNode, caretOffset - 3, caretOffset, '$$', 1);
      return true;
    }

    if (before.endsWith('****')) {
      replaceTextRangeWithRichInlineSource(textNode, caretOffset - 4, caretOffset, '****', 2);
      return true;
    }

    const trigger = findCompletedInlineMarkdownTrigger(before);
    if (!trigger) return false;
    replaceTextRangeWithRichInlineHtml(textNode, caretOffset - trigger.source.length, caretOffset, trigger.source);
    return true;
  }

  function applyRichInlineMarkdownRunTrigger() {
    const selection = window.getSelection?.();
    const range = richSelectionRange(selection);
    if (!range?.collapsed) return false;
    const caret = textCaretForMarkdownTrigger(range);
    if (!caret) return false;
    const before = (caret.textNode.nodeValue || '').slice(0, caret.caretOffset).replace(/\u200b/g, '');
    if (!/[`*_~$]$/.test(before)) return false;
    if (!richInlineMarkdownBeforeCaretEndsWithCompletedToken(before)) return false;

    const block = richInlineEditBlockForRange(range);
    if (!block || block.closest('.mermaid-diagram, pre.code-block, .math-display, .toc')) return false;

    const markdown = serializeRichInlineEditBlockContent(block);
    if (!richInlineMarkdownSourceHasCompletedToken(markdown)) return false;
    return reparseRichInlineEditBlockContent(block, {
      range,
      sourceSelection: domSelectionToSourceSelection(selection),
    });
  }

  function richInlineMarkdownBeforeCaretEndsWithCompletedToken(before) {
    const parts = splitPendingRichInlineMarkdown(String(before || ''));
    const last = parts[parts.length - 1];
    return Boolean(
      last
      && (last.type === 'markdown' || last.type === 'source')
      && String(before || '').endsWith(last.value)
    );
  }

  function textCaretForMarkdownTrigger(range) {
    if (range.startContainer.nodeType === Node.TEXT_NODE) {
      return { textNode: range.startContainer, caretOffset: range.startOffset };
    }

    if (range.startContainer.nodeType !== Node.ELEMENT_NODE) return null;
    const editBlock = richInlineEditBlockForRange(range);
    if (!editBlock) return null;
    const before = adjacentCaretNode(range.startContainer, range.startOffset, 'before');
    if (before?.nodeType === Node.TEXT_NODE && editBlock.contains(before)) {
      return { textNode: before, caretOffset: before.nodeValue.length };
    }
    return null;
  }

  function mergeAdjacentTextNodesForMarkdownTrigger(textNode, caretOffset) {
    const parent = textNode?.parentNode;
    if (!parent) return { textNode, caretOffset };
    const editBlock = nodeClosest(textNode, RICH_INLINE_EDIT_BLOCK_SELECTOR);
    const nodes = [textNode];

    let previous = textNode.previousSibling;
    while (previous?.nodeType === Node.TEXT_NODE && nodeClosest(previous, RICH_INLINE_EDIT_BLOCK_SELECTOR) === editBlock) {
      nodes.unshift(previous);
      previous = previous.previousSibling;
    }

    let next = textNode.nextSibling;
    while (next?.nodeType === Node.TEXT_NODE && nodeClosest(next, RICH_INLINE_EDIT_BLOCK_SELECTOR) === editBlock) {
      nodes.push(next);
      next = next.nextSibling;
    }

    if (nodes.length === 1) return { textNode, caretOffset };

    let rawOffset = caretOffset;
    for (const node of nodes) {
      if (node === textNode) break;
      rawOffset += (node.nodeValue || '').length;
    }

    const rawValue = nodes.map((node) => node.nodeValue || '').join('');
    const beforeCaret = rawValue.slice(0, rawOffset).replace(/\u200b/g, '');
    const afterCaret = rawValue.slice(rawOffset).replace(/\u200b/g, '');
    const mergedOffset = beforeCaret.length;
    const merged = document.createTextNode(beforeCaret + afterCaret);
    parent.insertBefore(merged, nodes[0]);
    for (const node of nodes) node.remove();
    placeCaretInTextNode(merged, mergedOffset);
    return { textNode: merged, caretOffset: mergedOffset };
  }

  function findCompletedInlineMarkdownTrigger(textBeforeCaret) {
    const patterns = [
      /(`[^`\n]+`)$/,
      /(~~[^~\n]+~~)$/,
      /(\*\*[^*\n]+?\*\*)$/,
    ];

    for (const pattern of patterns) {
      const match = textBeforeCaret.match(pattern);
      if (match) return { source: match[1] };
    }

    const italic = textBeforeCaret.match(/(^|[^*])(\*[^*\n]+\*)$/);
    return italic ? { source: italic[2] } : null;
  }

  function richInlineMarkdownSourceHasCompletedToken(source) {
    return splitPendingRichInlineMarkdown(String(source || ''))
      .some((part) => part.type === 'markdown' || part.type === 'source');
  }

  function parsePendingRichInlineMarkdownBeforePointer(target) {
    if (state.mode !== 'rich' || state.richComposing || state.richInlineSource?.element) return false;
    if (target?.closest?.('.rich-inline-source, .rich-source-editor, .code-language-input')) return false;
    const selection = window.getSelection?.();
    const range = richSelectionRange(selection);
    if (!range?.collapsed) return false;
    if (nodeClosest(range.startContainer, '.rich-inline-source, .rich-source-editor, .code-language-input')) return false;
    const block = richInlineEditBlockForRange(range);
    if (!block || block.closest('.mermaid-diagram, pre.code-block, .math-display')) return false;
    const targetBlock = target && els.rich.contains(target) ? nodeClosest(target, RICH_INLINE_EDIT_BLOCK_SELECTOR) : null;
    if (targetBlock === block) return false;

    if (!parsePendingRichInlineMarkdownInBlock(block)) return false;
    configureRichEditableSurface();
    suppressRichInlineActivation();
    finalizeRichProjectionChange('rich-input');
    return true;
  }

  function parsePendingRichInlineMarkdownInBlock(block) {
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (nodeClosest(node, '.rich-inline-source, .rich-source-editor, pre.code-block, .math-display, .mermaid-diagram')) {
          return NodeFilter.FILTER_REJECT;
        }
        if (nodeClosest(node, RICH_INLINE_SOURCE_SELECTOR)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    let changed = false;
    for (const node of nodes) {
      if (replacePendingRichInlineMarkdownTextNode(node)) changed = true;
    }
    return changed;
  }

  function replacePendingRichInlineMarkdownTextNode(textNode) {
    if (!textNode.isConnected) return false;
    const parts = splitPendingRichInlineMarkdown(textNode.nodeValue || '');
    if (!parts.some((part) => part.type === 'markdown' || part.type === 'source')) return false;

    const fragment = document.createDocumentFragment();
    for (const part of parts) {
      if (part.type === 'text') {
        if (part.value) fragment.appendChild(document.createTextNode(part.value));
        continue;
      }
      if (part.type === 'source') {
        fragment.appendChild(createRichInlineSourceElement(part.value));
        continue;
      }
      fragment.appendChild(renderRichInlineSourceFragment(part.value));
    }
    textNode.replaceWith(fragment);
    return true;
  }

  function splitPendingRichInlineMarkdown(text) {
    const parts = [];
    let index = 0;
    let textStart = 0;
    while (index < text.length) {
      const token = pendingRichInlineMarkdownTokenAt(text, index);
      if (!token) {
        index += 1;
        continue;
      }
      if (index > textStart) parts.push({ type: 'text', value: text.slice(textStart, index) });
      parts.push(token);
      index += token.value.length;
      textStart = index;
    }
    if (textStart < text.length) parts.push({ type: 'text', value: text.slice(textStart) });
    return parts.length ? parts : [{ type: 'text', value: text }];
  }

  function pendingRichInlineMarkdownTokenAt(text, index) {
    const rest = text.slice(index);
    if (rest.startsWith('****')) return { type: 'source', value: '****' };

    const anchoredPatterns = [
      /^!\[[^\]\n]*\]\((?:<[^>\n]+>|[^)\n]+)\)/,
      /^\[[^\]\n]+\]\((?:<[^>\n]+>|[^)\n]+)\)/,
      /^`[^`\n]+`/,
      /^~~[^~\n]+~~/,
      /^\*\*[^*\n]+?\*\*/,
      /^__[^_\n]+?__/,
      /^\$\$[^\n$]+?\$\$/,
      /^\$[^\s$][^\n$]*?\$/,
      /^\\\([^)]+\\\)/,
    ];
    for (const pattern of anchoredPatterns) {
      const match = rest.match(pattern);
      if (match) return { type: 'markdown', value: match[0] };
    }

    if (rest[0] === '*' && rest[1] !== '*' && canOpenSingleDelimiterAt(text, index, '*')) {
      const close = rest.indexOf('*', 1);
      if (close > 1 && !rest.slice(1, close).includes('\n')) {
        return { type: 'markdown', value: rest.slice(0, close + 1) };
      }
    }

    if (rest[0] === '_' && rest[1] !== '_' && canOpenSingleDelimiterAt(text, index, '_')) {
      const close = rest.indexOf('_', 1);
      if (close > 1 && !rest.slice(1, close).includes('\n')) {
        return { type: 'markdown', value: rest.slice(0, close + 1) };
      }
    }

    return null;
  }

  function canOpenSingleDelimiterAt(text, index, delimiter) {
    if (text[index - 1] !== delimiter) return true;
    return text[index - 2] === delimiter;
  }

  function replaceTextRangeWithRichInlineSource(textNode, start, end, source, caretOffset) {
    const sourceElement = createRichInlineSourceElement(source);
    replaceTextNodeRange(textNode, start, end, [sourceElement]);
    state.richInlineSource = { element: sourceElement };
    placeCaretInInlineSource(sourceElement, caretOffset);
  }

  function createRichInlineSourceElement(source) {
    const sourceElement = document.createElement('span');
    sourceElement.className = 'rich-inline-source';
    sourceElement.contentEditable = 'true';
    sourceElement.spellcheck = false;
    const safeSource = stripRichCaretTokens(source);
    sourceElement.dataset.inlineSource = safeSource;
    sourceElement.setAttribute('role', 'textbox');
    sourceElement.setAttribute('aria-label', 'インラインMarkdownソース');
    sourceElement.textContent = safeSource;
    return sourceElement;
  }

  function replaceTextRangeWithRichInlineHtml(textNode, start, end, source) {
    const fragment = renderRichInlineSourceFragment(source);
    const insertedNodes = Array.from(fragment.childNodes);
    if (!insertedNodes.length) return;
    replaceTextNodeRange(textNode, start, end, insertedNodes);
    configureRichEditableSurface();
    placeCaretAtInlineBoundary(insertedNodes[insertedNodes.length - 1], 'after');
    suppressRichInlineActivation();
  }

  function placeCaretAtInlineBoundary(node, boundary) {
    const marker = document.createTextNode('\u200b');
    if (boundary === 'before') {
      node.before(marker);
      placeCaretInTextNode(marker, 0);
    } else {
      node.after(marker);
      placeCaretInTextNode(marker, marker.nodeValue.length);
    }
  }

  function replaceTextNodeRange(textNode, start, end, replacementNodes) {
    const parent = textNode.parentNode;
    if (!parent) return;
    const value = textNode.nodeValue || '';
    const before = value.slice(0, start);
    const after = value.slice(end);
    const reference = textNode;
    if (before) parent.insertBefore(document.createTextNode(before), reference);
    replacementNodes.forEach((node) => parent.insertBefore(node, reference));
    if (after) parent.insertBefore(document.createTextNode(after), reference);
    textNode.remove();
  }

  function placeCaretAfterNode(node) {
    const range = document.createRange();
    range.setStartAfter(node);
    range.collapse(true);
    const selection = window.getSelection?.();
    if (!selection) return;
    selection.removeAllRanges();
    selection.addRange(range);
    els.rich.focus();
  }

  function getCaretCharacterOffsetWithin(element, selection) {
    if (!selection || !selection.rangeCount) return 0;
    const range = selection.getRangeAt(0);
    const before = range.cloneRange();
    before.selectNodeContents(element);
    before.setEnd(range.startContainer, range.startOffset);
    return normalizeRichText(before.toString()).length;
  }

  function suppressRichInlineActivation() {
    state.richInlineActivationSuppressed = true;
    window.setTimeout(() => {
      state.richInlineActivationSuppressed = false;
    }, 120);
  }

  async function onRichPaste(event) {
    const imageFiles = imageFilesFromClipboard(event.clipboardData);
    if (isProseMirrorRichEventContext(event)) {
      if (imageFiles.length) {
        event.preventDefault();
        await insertImageFilesAsAssets(imageFiles, createImageInsertionContext(event), '貼り付け');
      }
      return;
    }
    const control = eventTargetElement(event)?.closest?.('.rich-source-editor, .code-language-input');
    if (control) return;

    const inlineSource = richInlineSourceFromEventContext(event);
    if (inlineSource) {
      if (handleRichInlineSourcePaste(event, inlineSource)) return;
      captureRichInlineSourceUndoSnapshot(inlineSource, 'inline-source');
      return;
    }

    if (imageFiles.length) {
      event.preventDefault();
      await insertImageFilesAsAssets(imageFiles, createImageInsertionContext(event), '貼り付け');
      return;
    }

    event.preventDefault();
    const text = normalizeNewlines(event.clipboardData?.getData('text/plain') || '');
    if (handleRichPlainTextPaste(event, text)) return;
    if (guardUnsupportedRichPlainTextPasteFallback(event)) return;
    insertPlainTextAtSelection(text);
    syncRichMarkdownFromDom('rich-paste');
  }

  function handleRichInlineSourcePaste(event, inlineSource) {
    const text = stripRichCaretTokens(normalizeNewlines(event.clipboardData?.getData('text/plain') || ''));
    if (!text) return false;
    const sourceRange = richInlineSourceRange(inlineSource);
    const selectionRange = richInlineSourceSelectionRange(inlineSource);
    if (!sourceRange || !selectionRange) return false;
    event.preventDefault();
    captureRichInlineSourceUndoSnapshot(inlineSource, 'inline-source-paste');
    applyActiveRichInlineSourceTransaction(inlineSource, {
      from: selectionRange.from,
      to: selectionRange.to,
      insert: text,
      sourceRange,
      reason: 'rich-inline-source-paste',
    });
    return true;
  }

  function handleRichPlainTextPaste(event, text) {
    if (!text) return false;
    const target = eventTargetElement(event);
    if (target?.closest?.('.rich-inline-source, .rich-source-editor, .code-language-input')) return false;
    const selection = window.getSelection?.();
    const tableRange = richTableTextReplacementRangeFromSelection(selection);
    const quoteRange = tableRange ? null : richQuoteTextReplacementRangeFromSelection(selection);
    const blankRange = tableRange || quoteRange ? null : activeRichTransactionBlankRange();
    const rawRange = tableRange || quoteRange || blankRange || richPlainTextTransactionRangeFromSelection(selection);
    const replacementRange = rawRange?.from !== rawRange?.to
      ? expandSourceRangeToIntersectingInlineAtoms(rawRange)
      : rawRange;
    if (!replacementRange) return false;

    pushRichUndoSnapshot('paste');
    let insert = tableRange
      ? markdownTableCellTextFromPlainText(text)
      : quoteRange
        ? markdownQuoteTextFromPlainText(text)
        : stripRichCaretTokens(normalizeNewlines(text));
    const selectionLength = insert.length;
    const trailingPrefix = replacementRange.trailingParagraph && (state.markdown || '').length ? '\n\n' : '';
    const blankInsert = replacementRange.blankParagraph ? blankParagraphSourceInsertion(replacementRange.from, insert) : null;
    if (blankInsert) insert = blankInsert.insert;
    else insert = `${trailingPrefix}${insert}`;
    const nextOffset = replacementRange.from + insert.length;
    applySourceTransaction({
      from: replacementRange.from,
      to: replacementRange.to,
      insert,
      selectionAfter: {
        anchor: blankInsert ? blankInsert.selectionOffset : nextOffset,
        focus: blankInsert ? blankInsert.selectionOffset : nextOffset,
        affinity: 'after',
      },
    }, 'rich-paste');
    if (replacementRange.blankParagraph) state.richTransactionBlank = null;
    suppressRichInlineActivation();
    return true;
  }

  function guardUnsupportedRichPlainTextPasteFallback(event) {
    const selection = window.getSelection?.();
    const target = eventTargetElement(event);
    if (richSelectionTouchesSourceBlock(selection)) {
      setStatus('この位置では貼り付けできません');
      suppressRichInlineActivation();
      return true;
    }
    let commonAncestor = null;
    try {
      commonAncestor = selection?.rangeCount ? selection.getRangeAt(0).commonAncestorContainer : null;
    } catch (_) {
      commonAncestor = null;
    }
    const nodes = [
      target,
      selection?.anchorNode,
      selection?.focusNode,
      commonAncestor,
    ].filter(Boolean);
    const blockedSelector = [
      RICH_SOURCE_BLOCK_SELECTOR,
      '.rich-inline-source',
      '.rich-source-editor',
      '.code-language-input',
      '.rich-inline-atom',
      'table',
      'pre.code-block',
      '.mermaid-diagram',
      '.math-display',
      '.toc',
    ].join(', ');
    if (!nodes.some((node) => nodeClosest(node, blockedSelector))) return false;
    setStatus('この位置では貼り付けできません');
    suppressRichInlineActivation();
    return true;
  }

  function richSourceBlocksIntersectingRange(range) {
    if (!range || !els.rich.contains(range.startContainer) || !els.rich.contains(range.endContainer)) return [];
    const blocks = new Set();
    const rangeNodes = [
      range.startContainer,
      range.endContainer,
      range.commonAncestorContainer,
    ].filter(Boolean);
    rangeNodes.forEach((node) => {
      const block = nodeClosest(node, RICH_SOURCE_BLOCK_SELECTOR);
      if (block && els.rich.contains(block)) blocks.add(block);
    });
    Array.from(els.rich.querySelectorAll(RICH_SOURCE_BLOCK_SELECTOR)).forEach((block) => {
      try {
        if (typeof range.intersectsNode === 'function' && range.intersectsNode(block)) blocks.add(block);
      } catch (_) {
        // Some browser engines throw for detached/intermediate nodes; ignore them.
      }
    });
    return Array.from(blocks);
  }

  function richRangeTouchesSourceBlock(range) {
    return richSourceBlocksIntersectingRange(range).length > 0;
  }

  function richSelectionTouchesSourceBlock(selection) {
    const range = richSelectionRange(selection);
    if (!range || range.collapsed) return false;
    return richRangeTouchesSourceBlock(range);
  }

  function guardUnsupportedRichSelectionMutationFallback(event, status = 'この選択はMarkdownソースへ変換できません') {
    const selection = window.getSelection?.();
    const range = richSelectionRange(selection);
    if (!range || range.collapsed) return false;
    const blockedSelector = '.rich-inline-source, .rich-source-editor, .code-language-input';
    const target = eventTargetElement(event);
    const activeNodes = [target, range.startContainer, range.endContainer].filter(Boolean);
    if (activeNodes.some((node) => nodeClosest(node, blockedSelector))) return false;
    if (!richSelectionTouchesSourceBlock(selection)) return false;
    event?.preventDefault?.();
    setStatus(status);
    suppressRichInlineActivation();
    return true;
  }

  function onRichCut(event) {
    if (state.mode !== 'rich' || state.richComposing) return;
    const target = eventTargetElement(event);
    if (isProseMirrorRichTarget(target)) return;
    if (target?.closest?.('.rich-inline-source, .rich-source-editor, .code-language-input')) return;
    const selection = window.getSelection?.();
    const range = richSelectionRange(selection);
    if (!range || range.collapsed) return;
    try {
      event.clipboardData?.setData?.('text/plain', selection.toString());
    } catch (_) {
      // Clipboard writes can be blocked by browser policy; keep source deletion deterministic.
    }
    if (handleRichPlainTextSelectionReplacement(event, '', 'rich-selection-cut')) return;
    guardUnsupportedRichSelectionMutationFallback(event);
  }

  function richTableTextReplacementRangeFromSelection(selection) {
    const range = richSelectionRange(selection);
    if (!range) return null;
    const anchorCell = nodeClosest(range.startContainer, 'td, th');
    const focusCell = nodeClosest(range.endContainer, 'td, th');
    if (!anchorCell || anchorCell !== focusCell || !els.rich.contains(anchorCell)) return null;
    if (range.collapsed) {
      const point = richTableSourcePointFromRange(anchorCell, range);
      return point ? { from: point.offset, to: point.offset } : null;
    }
    const sourceSelection = domSelectionToSourceSelection(selection);
    if (!sourceSelection || !Number.isFinite(sourceSelection.anchor) || !Number.isFinite(sourceSelection.focus)) return null;
    return {
      from: Math.min(sourceSelection.anchor, sourceSelection.focus),
      to: Math.max(sourceSelection.anchor, sourceSelection.focus),
    };
  }

  function richQuoteTextReplacementRangeFromSelection(selection) {
    const range = richSelectionRange(selection);
    if (!range) return null;
    const anchorQuote = nodeClosest(range.startContainer, 'blockquote');
    const focusQuote = nodeClosest(range.endContainer, 'blockquote');
    if (!anchorQuote || anchorQuote !== focusQuote || !els.rich.contains(anchorQuote)) return null;
    if (range.collapsed) {
      const point = richQuoteSourcePointFromRange(anchorQuote, range);
      return point ? { from: point.offset, to: point.offset } : null;
    }
    const sourceSelection = domSelectionToSourceSelection(selection);
    if (!sourceSelection || !Number.isFinite(sourceSelection.anchor) || !Number.isFinite(sourceSelection.focus)) return null;
    return {
      from: Math.min(sourceSelection.anchor, sourceSelection.focus),
      to: Math.max(sourceSelection.anchor, sourceSelection.focus),
    };
  }

  function markdownQuoteTextFromPlainText(text) {
    return stripRichCaretTokens(normalizeNewlines(text)).split('\n').join('\n> ');
  }

  function markdownTableCellTextFromPlainText(text) {
    return escapeMarkdownTableCell(stripRichCaretTokens(normalizeNewlines(text))).replace(/\n+/g, '<br>');
  }

  function activeRichTransactionBlankPoint(range = null) {
    const blank = state.richTransactionBlank;
    const element = blank?.element;
    const sourceGap = Number(blank?.sourceGap);
    if (!element?.isConnected || !els.rich.contains(element) || !Number.isFinite(sourceGap)) {
      state.richTransactionBlank = null;
      return null;
    }
    let selectedRange = range;
    if (!selectedRange) {
      const selection = window.getSelection?.();
      if (!selection?.rangeCount) return null;
      try {
        selectedRange = selection.getRangeAt(0);
      } catch (_) {
        return null;
      }
    }
    if (!element.contains(selectedRange.startContainer) || !element.contains(selectedRange.endContainer)) return null;
    return {
      offset: sourceGap,
      contentStart: sourceGap,
      contentEnd: sourceGap,
      blankParagraph: true,
    };
  }

  function activeRichTransactionBlankRange() {
    const point = activeRichTransactionBlankPoint();
    return point ? { from: point.offset, to: point.offset, blankParagraph: true } : null;
  }

  function clearRichTransactionBlankForPointer(target) {
    const element = state.richTransactionBlank?.element;
    if (!element) return;
    if (!element.isConnected || !target || !element.contains(target)) state.richTransactionBlank = null;
  }

  async function onMarkdownPaste(event) {
    const imageFiles = imageFilesFromClipboard(event.clipboardData);
    if (!imageFiles.length) return;
    event.preventDefault();
    await insertImageFilesAsAssets(imageFiles, createImageInsertionContext(event), '貼り付け');
  }

  function onEditorDragOver(event) {
    if (!hasImageFiles(event.dataTransfer)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    event.currentTarget?.classList?.add('is-drag-over');
  }

  function onEditorDragLeave(event) {
    if (event.currentTarget?.contains(event.relatedTarget)) return;
    event.currentTarget?.classList?.remove('is-drag-over');
  }

  async function onEditorDrop(event) {
    const imageFiles = imageFilesFromDataTransfer(event.dataTransfer);
    if (!imageFiles.length) return;
    event.preventDefault();
    event.currentTarget?.classList?.remove('is-drag-over');
    await insertImageFilesAsAssets(imageFiles, createImageInsertionContext(event), 'ドロップ');
  }

  function insertPlainTextAtSelection(text) {
    if (document.queryCommandSupported?.('insertText')) {
      document.execCommand('insertText', false, text);
      return;
    }
    const selection = window.getSelection?.();
    if (!selection || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function imageFilesFromClipboard(clipboardData) {
    if (!clipboardData) return [];
    const files = [];
    for (const item of Array.from(clipboardData.items || [])) {
      if (item.kind !== 'file' || !String(item.type || '').startsWith('image/')) continue;
      const file = item.getAsFile?.();
      if (file) files.push(file);
    }
    if (!files.length) files.push(...Array.from(clipboardData.files || []).filter(isAllowedImageFile));
    return files.filter(isAllowedImageFile);
  }

  function imageFilesFromDataTransfer(dataTransfer) {
    if (!dataTransfer) return [];
    return Array.from(dataTransfer.files || []).filter(isAllowedImageFile);
  }

  function hasImageFiles(dataTransfer) {
    if (!dataTransfer) return false;
    if (Array.from(dataTransfer.files || []).some(isAllowedImageFile)) return true;
    return Array.from(dataTransfer.items || []).some((item) => {
      if (item.kind !== 'file') return false;
      const type = String(item.type || '');
      return !type || type.startsWith('image/');
    });
  }

  function createImageInsertionContext(event) {
    const target = eventTargetElement(event);
    if (target === els.source || target?.closest?.('.source-codemirror')) {
      const selection = sourceSelectionRange();
      return {
        mode: 'source',
        start: selection.start,
        end: selection.end,
      };
    }

    if (state.mode === 'rich' && isProseMirrorRichActive()) {
      return { mode: 'prosemirror' };
    }

    if (isProseMirrorRichTarget(target)) {
      return { mode: 'prosemirror' };
    }

    if (state.mode === 'rich') {
      if (guardReadOnlyRichFallbackAction('画像挿入')) return null;
      if (target && els.rich.contains(target) && Number.isFinite(event?.clientX) && Number.isFinite(event?.clientY)) {
        placeCaretAtPointer(event);
      }
      const selection = window.getSelection?.();
      if (selection?.rangeCount && els.rich.contains(selection.anchorNode) && els.rich.contains(selection.focusNode)) {
        return {
          mode: 'rich',
          range: selection.getRangeAt(0).cloneRange(),
          sourceRange: richInlineInsertRangeFromSelection(selection),
        };
      }
    }

    const selection = sourceSelectionRange();
    return {
      mode: 'source',
      start: selection.start,
      end: selection.end,
    };
  }

  async function insertImageFilesAsAssets(files, insertionContext, actionLabel) {
    const imageFiles = Array.from(files || []).filter(isAllowedImageFile);
    if (!imageFiles.length) {
      setStatus('PNG/JPEG/GIF/WebPのみ挿入できます');
      return false;
    }
    if (guardUnsupportedImageInsertionContext(insertionContext, actionLabel)) return false;

    const ready = await ensureImageAssetWriteAccess(actionLabel || '画像挿入');
    if (!ready) return false;

    let inserted = 0;
    for (const file of imageFiles) {
      if (file.size > MAX_ASSET_IMAGE_BYTES) {
        setStatus(`画像は${Math.round(MAX_ASSET_IMAGE_BYTES / 1024 / 1024)}MB以下にしてください`);
        continue;
      }
      try {
        const saved = await saveImageFileToAssets(file);
        const alt = sanitizeMarkdownLabel(stripExtension(saved.fileName));
        insertMarkdownAtImageContext(`![${alt}](${formatMarkdownTarget(saved.markdownPath)})`, insertionContext);
        inserted += 1;
      } catch (error) {
        setStatus(error?.message || '画像の保存に失敗しました');
      }
    }

    if (inserted > 0) {
      setStatus(`${actionLabel || '画像挿入'}: ${inserted}件を assets フォルダに保存しました`);
      return true;
    }
    return false;
  }

  function guardUnsupportedImageInsertionContext(context, actionLabel = '画像挿入') {
    if (context?.mode !== 'rich' || !context.range) return false;
    const range = context.range;
    if (range.collapsed || !els.rich.contains(range.startContainer) || !els.rich.contains(range.endContainer)) return false;
    const sourceBlocks = richSourceBlocksIntersectingRange(range);
    if (!sourceBlocks.length) return false;
    const sourceBlock = nodeClosest(range.startContainer, RICH_SOURCE_BLOCK_SELECTOR);
    if (
      sourceBlock
      && sourceBlocks.length === 1
      && sourceBlocks[0] === sourceBlock
      && !richRangeExtendsOutsideSourceBlock(range, sourceBlock)
    ) {
      return false;
    }
    setStatus(`${actionLabel || '画像挿入'}: この選択では画像を挿入できません`);
    suppressRichInlineActivation();
    return true;
  }

  async function ensureImageAssetWriteAccess(actionLabel = '画像挿入') {
    if (state.desktopHost) {
      if (state.desktopDocumentReady) return true;
      setStatus(`${actionLabel}: 先にMarkdownファイルを保存してください`);
      return false;
    }
    if (!hasImageAssetFolderContext(actionLabel)) return false;
    if (!await ensureDirectoryPermission(state.directoryHandle, 'readwrite')) {
      setStatus(`${actionLabel}: 画像保存に必要なフォルダ書き込み権限がありません`);
      return false;
    }
    return true;
  }

  async function ensureDirectoryPermission(directoryHandle, mode) {
    const options = { mode };
    try {
      const current = await queryDirectoryPermission(directoryHandle, mode);
      if (current === 'granted') return true;
      if (typeof directoryHandle.requestPermission === 'function') {
        return await directoryHandle.requestPermission(options) === 'granted';
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  async function queryDirectoryPermission(directoryHandle, mode) {
    if (typeof directoryHandle?.queryPermission !== 'function') return 'granted';
    return directoryHandle.queryPermission({ mode });
  }

  async function saveImageFileToAssets(file) {
    if (state.desktopHost) return saveImageFileToDesktopAssets(file);
    const markdownDirHandle = await markdownDirectoryHandle();
    const assetsDirName = markdownAssetsDirName();
    const assetsDirHandle = await markdownDirHandle.getDirectoryHandle(assetsDirName, { create: true });
    const allocated = await allocateAssetFileHandle(assetsDirHandle, assetFileName(file));
    const writable = await allocated.handle.createWritable();
    try {
      await writable.write(file);
    } finally {
      await writable.close();
    }

    const markdownPath = normalizeAssetPath(`${assetsDirName}/${allocated.fileName}`);
    setAssetUrl(markdownPath, file);
    return { fileName: allocated.fileName, markdownPath };
  }

  async function saveImageFileToDesktopAssets(file) {
    if (!state.desktopDocumentReady) throw new Error('先にMarkdownファイルを保存してください');
    const requestId = `asset-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const buffer = await file.arrayBuffer();
    const dataBase64 = arrayBufferToBase64(buffer);
    const result = new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        state.desktopAssetRequests.delete(requestId);
        reject(new Error('画像保存がタイムアウトしました'));
      }, DESKTOP_ASSET_REQUEST_TIMEOUT_MS);
      state.desktopAssetRequests.set(requestId, { resolve, reject, timer });
    });
    if (!postDesktopMessage({
      type: 'desktop.saveAsset',
      requestId,
      fileName: safeFileName(file.name || 'image.png'),
      mimeType: String(file.type || ''),
      dataBase64,
    })) {
      rejectDesktopAssetRequest({ requestId, message: 'Windowsアプリへ画像を渡せませんでした' });
    }
    return result;
  }

  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
  }

  async function markdownDirectoryHandle() {
    if (!state.directoryHandle) throw new Error('フォルダが開かれていません');
    let handle = state.directoryHandle;
    const parts = dirnamePath(state.markdownRelativePath).split('/').filter(Boolean);
    for (const part of parts) {
      handle = await handle.getDirectoryHandle(part, { create: false });
    }
    return handle;
  }

  async function markdownFileHandle() {
    const directoryHandle = await markdownDirectoryHandle();
    const fileName = basenamePath(state.markdownRelativePath) || ensureExtension(state.fileName || 'untitled.md', '.md');
    return directoryHandle.getFileHandle(fileName, { create: true });
  }

  function markdownAssetsDirName() {
    return `${stripExtension(safeFileName(state.fileName || 'untitled.md'))}.assets`;
  }

  function assetFileName(file) {
    const extension = imageExtensionForFile(file);
    const raw = stripExtension(file?.name || '').trim() || `image-${compactTimestamp()}`;
    const base = safeAssetName(raw);
    return `${base}${extension}`;
  }

  function imageExtensionForFile(file) {
    const name = String(file?.name || '');
    const match = name.match(/\.(png|jpe?g|gif|webp)$/i);
    if (match) return `.${match[1].toLowerCase().replace('jpeg', 'jpg')}`;
    switch (file?.type) {
      case 'image/png': return '.png';
      case 'image/jpeg': return '.jpg';
      case 'image/gif': return '.gif';
      case 'image/webp': return '.webp';
      default: return '.png';
    }
  }

  function safeAssetName(value) {
    const cleaned = String(value || 'image')
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
      .replace(/\s+/g, ' ')
      .replace(/^\.+$/, 'image')
      .trim();
    return cleaned || 'image';
  }

  function compactTimestamp() {
    const date = new Date();
    const pad = (value, size = 2) => String(value).padStart(size, '0');
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}${pad(date.getMilliseconds(), 3)}`;
  }

  async function allocateAssetFileHandle(directoryHandle, requestedName) {
    const clean = safeFileName(requestedName);
    const extension = imageExtensionForFile({ name: clean });
    const base = stripExtension(clean);
    for (let index = 0; index < 100; index += 1) {
      const fileName = index === 0 ? clean : `${base}-${index + 1}${extension}`;
      try {
        await directoryHandle.getFileHandle(fileName, { create: false });
      } catch (error) {
        if (error?.name !== 'NotFoundError') throw error;
        return {
          fileName,
          handle: await directoryHandle.getFileHandle(fileName, { create: true }),
        };
      }
    }
    const fileName = `${base}-${compactTimestamp()}${extension}`;
    return {
      fileName,
      handle: await directoryHandle.getFileHandle(fileName, { create: true }),
    };
  }

  function setAssetUrl(relativePath, file) {
    const relative = normalizeAssetPath(relativePath);
    const previous = state.assetUrls.get(relative);
    if (previous?.startsWith?.('blob:')) URL.revokeObjectURL(previous);
    const url = URL.createObjectURL(file);
    state.assetUrls.set(relative, url);
    state.assetUrls.set(`./${relative}`, url);
  }

  function insertMarkdownAtImageContext(markdown, context) {
    if (context?.mode === 'prosemirror') {
      insertProseMirrorMarkdown(markdown, { inline: true, status: '画像参照を挿入しました' });
      return;
    }
    if (context?.mode === 'rich') {
      if (insertRichImageMarkdownAtSourceContext(markdown, context)) return;
      restoreImageInsertionRange(context);
      insertRichMarkdownAtSelection(markdown);
      const selection = window.getSelection?.();
      if (selection?.rangeCount && els.rich.contains(selection.anchorNode) && els.rich.contains(selection.focusNode)) {
        context.range = selection.getRangeAt(0).cloneRange();
        context.sourceRange = richInlineInsertRangeFromSelection(selection);
      }
      return;
    }

    const selection = sourceSelectionRange();
    const start = Number.isInteger(context?.start) ? context.start : selection.start;
    const end = Number.isInteger(context?.end) ? context.end : selection.end;
    const next = start + markdown.length;
    replaceSourceRange(start, end, markdown, {
      selectionStart: next,
      selectionEnd: next,
      renderNow: true,
      reason: 'edit',
    });
    context.mode = 'source';
    context.start = next;
    context.end = next;
  }

  function insertRichImageMarkdownAtSourceContext(markdown, context) {
    const sourceRange = context?.sourceRange;
    if (!sourceRange || !Number.isFinite(sourceRange.from) || !Number.isFinite(sourceRange.to)) return false;
    const source = stripRichCaretTokens(normalizeNewlines(markdown || ''));
    if (!source || source.includes('\n')) return false;
    const from = sourceRange.from;
    const to = Math.max(from, sourceRange.to);
    if (!insertInlineMarkdownAtCapturedContext({ mode: 'rich', range: { from, to } }, source, '画像参照を挿入しました')) {
      return false;
    }
    const next = from + source.length;
    context.sourceRange = { from: next, to: next };
    return true;
  }

  function restoreImageInsertionRange(context) {
    if (
      !context?.range
      || !els.rich.contains(context.range.startContainer)
      || !els.rich.contains(context.range.endContainer)
    ) {
      getRichSelectionRange();
      return;
    }
    const selection = window.getSelection?.();
    if (!selection) return;
    selection.removeAllRanges();
    selection.addRange(context.range);
    els.rich.focus();
  }

  function onKeyDown(event) {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown', 'Escape'].includes(event.key)) {
      state.richLineBreakInputOffset = null;
    }
    if (event.defaultPrevented && isProseMirrorRichTarget(eventTargetElement(event))) return;
    const inlineSource = richInlineSourceFromEventContext(event);
    if (inlineSource) {
      if (isRichUndoShortcut(event) && restoreRichUndoSnapshot()) {
        event.preventDefault();
        return;
      }
      if (isEnterKey(event)) {
        event.preventDefault();
        pushRichUndoSnapshot('line-break');
        if (!event.shiftKey && handleRichInlineSourceEnter(inlineSource)) {
          return;
        }
        if (event.shiftKey && handleRichInlineSourceLineBreak(inlineSource)) {
          return;
        }
        return;
      }
      if ((event.key === 'ArrowRight' || event.key === 'ArrowLeft') && handleRichInlineSourceArrow(event, inlineSource)) {
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        commitRichInlineSource(inlineSource);
        return;
      }
    }

    if (isRichKeyEventContext(event)) {
      if (isRichUndoShortcut(event) && restoreRichUndoSnapshot()) {
        event.preventDefault();
        return;
      }
      if (handleRichQuoteTextKeydown(event)) {
        return;
      }
      if ((event.key === 'ArrowRight' || event.key === 'ArrowLeft') && handleRichInlineBoundaryArrow(event)) {
        return;
      }
      if ((event.key === 'ArrowRight' || event.key === 'ArrowLeft') && handleRichLineBoundaryArrow(event)) {
        return;
      }
      if ((event.key === 'Home' || event.key === 'End') && handleRichHomeEndNavigation(event)) {
        return;
      }
      if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && handleRichListArrowNavigation(event)) {
        return;
      }
      if (event.key === 'Backspace' || event.key === 'Delete') {
        snapshotRichDeleteFromKeydown();
      }
      if ((event.key === 'Backspace' || event.key === 'Delete') && handleRichAtomicBlockBoundaryDelete(event)) {
        return;
      }
      if ((event.key === 'Backspace' || event.key === 'Delete') && handleRichTableBlockBoundaryDelete(event)) {
        return;
      }
      if ((event.key === 'Backspace' || event.key === 'Delete') && handleRichTextBlockBoundaryDelete(event)) {
        return;
      }
      if ((event.key === 'Backspace' || event.key === 'Delete') && handleRichListItemBoundaryDelete(event)) {
        return;
      }
      if ((event.key === 'Backspace' || event.key === 'Delete') && handleRichListBlockBoundaryDelete(event)) {
        return;
      }
      if ((event.key === 'Backspace' || event.key === 'Delete') && handleRichTableLineBreakDelete(event)) {
        return;
      }
      if (event.key === 'Backspace' && handleRichEmptyListBackspace(event)) {
        return;
      }
      if ((event.key === 'Backspace' || event.key === 'Delete') && handleRichTaskCheckboxDelete(event)) {
        return;
      }
      if ((event.key === 'Backspace' || event.key === 'Delete') && handleRichDeleteToEmptyBlock(event)) {
        return;
      }
      if (isEnterKey(event)) {
        handleRichEnter(event);
        return;
      }
    }

    if (event.target instanceof HTMLInputElement && event.target.classList.contains('code-language-input')) {
      if (isEnterKey(event)) {
        event.preventDefault();
        updateCodeBlockLanguage(event.target);
        event.target.blur();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.target.blur();
      }
      return;
    }

  }

  function onKeyboardShortcutKeyDown(event) {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
    if (!event.ctrlKey && !event.metaKey) return;
    const formatShortcut = keyboardFormatShortcut(event);
    if (formatShortcut) {
      event.preventDefault();
      event.stopPropagation();
      applyFormat(formatShortcut);
      return;
    }

    const actionShortcut = keyboardActionShortcut(event);
    if (!actionShortcut) return;
    event.preventDefault();
    event.stopPropagation();
    runKeyboardActionShortcut(actionShortcut);
  }

  function keyboardFormatShortcut(event) {
    if (event.altKey) return '';
    const digit = /^Digit([0-9])$/.exec(event.code || '')?.[1] || (/^[0-9]$/.test(event.key) ? event.key : '');
    if (!event.shiftKey && digit === '0') return 'paragraph';
    if (!event.shiftKey && /^[1-6]$/.test(digit)) return `h${digit}`;
    if (event.shiftKey && digit === '7') return 'ordered-list';
    if (event.shiftKey && digit === '8') return 'list';
    if (event.shiftKey && digit === '9') return 'quote';
    return '';
  }

  function keyboardActionShortcut(event) {
    const codeLetter = /^Key([A-Z])$/.exec(event.code || '')?.[1];
    const keyLetter = /^[A-Z]$/i.test(event.key || '') ? event.key : '';
    const key = (codeLetter || keyLetter).toLowerCase();
    if (!key) return '';

    if (!event.shiftKey && !event.altKey) {
      return {
        s: 'save',
        o: 'open',
        p: 'print',
        b: 'bold',
        i: 'italic',
        k: 'inline-code',
        m: 'inline-math',
      }[key] || '';
    }
    if (event.shiftKey && !event.altKey) {
      return {
        k: 'code-block',
        m: 'math-block',
        l: 'link',
      }[key] || '';
    }
    if (!event.shiftKey && event.altKey) {
      return {
        t: 'table',
        i: 'toc',
        m: 'mermaid',
        o: 'toggle-outline',
      }[key] || '';
    }
    return '';
  }

  function runKeyboardActionShortcut(action) {
    switch (action) {
      case 'save':
        saveMarkdown();
        break;
      case 'open':
        openMarkdownFile();
        break;
      case 'print':
        printPreview();
        break;
      case 'bold':
        applyFormat('bold');
        break;
      case 'italic':
        applyFormat('italic');
        break;
      case 'inline-code':
        applyFormat('code');
        break;
      case 'inline-math':
        applyFormat('math');
        break;
      case 'code-block':
        insertCodeBlock();
        break;
      case 'math-block':
        insertMathBlock();
        break;
      case 'link':
        insertLink();
        break;
      case 'table':
        applyFormat('table');
        break;
      case 'toc':
        applyFormat('toc');
        break;
      case 'mermaid':
        insertMermaid();
        break;
      case 'toggle-outline':
        toggleOutline();
        break;
      default:
        break;
    }
  }

  function snapshotRichDeleteFromKeydown() {
    if (nodeClosest(window.getSelection?.()?.anchorNode, '.rich-inline-source, .rich-source-editor, .code-language-input')) return;
    pushRichUndoSnapshot('delete');
    state.richUndoPreserveNextInput = true;
  }

  function isEnterKey(event) {
    if (event?.isComposing || event?.keyCode === 229) return false;
    return event.key === 'Enter' || event.key === 'NumpadEnter' || event.key === 'ENTER';
  }

  function handleRichQuoteTextKeydown(event) {
    if (state.richComposing || event?.isComposing || event?.keyCode === 229) return false;
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    if (typeof event.key !== 'string' || event.key.length !== 1) return false;
    const selection = window.getSelection?.();
    const range = richSelectionRange(selection);
    if (!range?.collapsed) return false;
    const quote = nodeClosest(range.startContainer, 'blockquote');
    if (!quote || !els.rich.contains(quote)) return false;
    const point = richQuoteSourcePointFromRange(quote, range);
    if (!point || !Number.isFinite(point.offset)) return false;
    const insert = markdownQuoteTextFromPlainText(event.key);
    event.preventDefault();
    pushRichUndoSnapshot('insert');
    applySourceTransaction({
      from: point.offset,
      to: point.offset,
      insert,
      selectionAfter: {
        anchor: point.offset + insert.length,
        focus: point.offset + insert.length,
        affinity: 'after',
      },
    }, 'rich-quote-key-insert');
    suppressRichInlineActivation();
    return true;
  }

  function isRichUndoShortcut(event) {
    return (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'z';
  }

  function pushRichUndoSnapshot(label) {
    if (state.mode !== 'rich' || !els.rich) return;
    const markdown = stripRichCaretTokens(normalizeNewlines(state.markdown || els.source.value || serializeRichMarkdown(els.rich)));
    const bookmark = getRichCaretBookmark();
    const last = state.richUndoStack[state.richUndoStack.length - 1];
    if (last?.markdown === markdown && last?.bookmark?.start === bookmark?.start && last?.bookmark?.length === bookmark?.length) return;
    state.richUndoStack.push({ label, markdown, bookmark });
    if (state.richUndoStack.length > MAX_RICH_UNDO_STEPS) {
      state.richUndoStack.splice(0, state.richUndoStack.length - MAX_RICH_UNDO_STEPS);
    }
  }

  function clearRichUndoStack() {
    state.richUndoStack = [];
  }

  function restoreRichUndoSnapshot() {
    const snapshot = state.richUndoStack.pop();
    if (!snapshot) return false;
    state.richUndoRestoring = true;
    state.richSelectionLock = true;
    state.markdown = normalizeNewlines(snapshot.markdown || '');
    els.source.value = state.markdown;
    syncCodeMirrorSourceFromTextarea('rich-undo');
    state.richInlineSource = null;
    renderAll('rich-undo');
    restoreRichCaret(snapshot.bookmark);
    state.richSelectionLock = false;
    state.richUndoRestoring = false;
    suppressRichInlineActivation();
    markDirty();
    scheduleAutosave();
    setStatus(snapshot.label === 'line-break' ? '改行を元に戻しました' : '編集を元に戻しました');
    return true;
  }

  function isRichKeyEventContext(event) {
    const target = eventTargetElement(event);
    if (isProseMirrorRichTarget(target)) return false;
    if (target?.closest?.('.rich-source-editor, .code-language-input')) return false;
    if (target && els.rich.contains(target)) return true;
    const active = document.activeElement;
    if (active && active !== document.body && active !== els.rich && !els.rich.contains(active)) return false;
    const selection = window.getSelection?.();
    return Boolean(
      state.mode === 'rich'
      && selection
      && selection.rangeCount
      && selection.isCollapsed
      && els.rich.contains(selection.anchorNode)
      && !isProseMirrorRichTarget(selection.anchorNode)
    );
  }

  function handleRichInlineSourceEnter(inlineSource) {
    const item = inlineSource.closest?.('li');
    const list = item?.closest?.('ul, ol');
    if (item && list && els.rich.contains(item)) {
      return handleRichInlineSourceListEnter(inlineSource, item, list);
    }

    const cell = inlineSource.closest?.('td, th');
    if (cell && els.rich.contains(cell)) {
      return handleRichInlineSourceLineBreak(inlineSource);
    }

    return handleRichInlineSourceBlockEnter(inlineSource);
  }

  function handleRichInlineSourceListEnter(inlineSource, item, list) {
    if (applyRichInlineSourceSplitTransaction(inlineSource, 'list-enter')) return true;
    if (guardUnsupportedRichInlineSourceSplitFallback(inlineSource)) return true;

    const split = splitRichInlineSourceAtSelection(inlineSource);
    if (!split) return false;
    const marker = document.createTextNode('');
    inlineSource.after(marker);

    state.richSelectionLock = true;
    replaceInlineSourceWithFragment(inlineSource, split.before);
    const nextItem = createEmptyListItemLike(item, list);
    const tail = extractListItemTailAfterMarker(item, marker);
    marker.remove();
    appendRichInlineSourceAndTail(nextItem, split.after, tail, 'list-item');
    ensureListItemEditablePlaceholder(item);
    item.after(nextItem);
    placeCaretAtListItemStart(nextItem);
    state.richSelectionLock = false;
    suppressRichInlineActivation();
    syncRichMarkdownFromDom('rich-input');
    return true;
  }

  function handleRichInlineSourceBlockEnter(inlineSource) {
    const quote = inlineSource.closest?.('blockquote');
    if (quote && els.rich.contains(quote) && applyRichInlineSourceSplitTransaction(inlineSource, 'quote-line-break')) {
      return true;
    }

    const block = nodeClosest(inlineSource, 'p, h1, h2, h3, h4, h5, h6, div');
    if (!block || !els.rich.contains(block) || block.closest('li, .rich-source-editor, .mermaid-diagram, pre.code-block, .math-display, .toc')) {
      return false;
    }

    if (applyRichInlineSourceSplitTransaction(inlineSource, 'block-enter')) return true;
    if (guardUnsupportedRichInlineSourceSplitFallback(inlineSource)) return true;

    const split = splitRichInlineSourceAtSelection(inlineSource);
    if (!split) return false;
    const marker = document.createTextNode('');
    inlineSource.after(marker);

    state.richSelectionLock = true;
    replaceInlineSourceWithFragment(inlineSource, split.before);
    const next = document.createElement('p');
    const tail = extractRichBlockTailAfterMarker(block, marker);
    marker.remove();
    appendRichInlineSourceAndTail(next, split.after, tail, 'block');
    ensureRichTextBlockPlaceholder(block);
    block.after(next);
    placeCaretAtStart(next);
    state.richSelectionLock = false;
    suppressRichInlineActivation();
    syncRichMarkdownFromDom('rich-input');
    return true;
  }

  function handleRichInlineSourceLineBreak(inlineSource) {
    if (applyRichInlineSourceSplitTransaction(inlineSource, 'line-break')) return true;
    if (guardUnsupportedRichInlineSourceSplitFallback(inlineSource)) return true;

    const split = splitRichInlineSourceAtSelection(inlineSource);
    if (!split) return false;
    const marker = document.createTextNode('');
    inlineSource.after(marker);

    state.richSelectionLock = true;
    replaceInlineSourceWithFragment(inlineSource, split.before);
    const br = document.createElement('br');
    const caret = document.createTextNode('\u200b');
    const afterFragment = renderRichInlineSourceFragment(split.after);
    marker.replaceWith(br, caret, afterFragment);
    placeCaretInTextNode(caret, 1);
    state.richSelectionLock = false;
    suppressRichInlineActivation();
    syncRichMarkdownFromDom('rich-input');
    return true;
  }

  function guardUnsupportedRichInlineSourceSplitFallback(inlineSource) {
    const sourceBlock = nodeClosest(inlineSource, RICH_SOURCE_BLOCK_SELECTOR);
    if (!sourceBlock || !els.rich.contains(sourceBlock)) return false;
    setStatus('この位置ではインラインソースを分割できません');
    suppressRichInlineActivation();
    return true;
  }

  function applyRichInlineSourceSplitTransaction(inlineSource, kind) {
    const sourceRange = richInlineSourceRange(inlineSource);
    const split = splitRichInlineSourceAtSelection(inlineSource);
    if (!sourceRange || !split) return false;
    const separator = richInlineSourceSplitSeparator(inlineSource, kind);
    if (!separator) return false;
    const insert = `${split.before}${separator.text}${split.after}`;
    const nextOffset = sourceRange.start + split.before.length + separator.text.length;
    state.richInlineSource = null;
    applySourceTransaction({
      from: sourceRange.start,
      to: sourceRange.end,
      insert,
      selectionAfter: {
        anchor: nextOffset,
        focus: nextOffset,
        affinity: 'after',
      },
    }, `rich-inline-source-${kind}`);
    suppressRichInlineActivation();
    return true;
  }

  function richInlineSourceRange(inlineSource) {
    const start = Number(inlineSource?.dataset?.srcStart);
    const end = Number(inlineSource?.dataset?.srcEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
    return { start, end };
  }

  function richInlineSourceSplitSeparator(inlineSource, kind) {
    if (kind === 'block-enter') return { text: '\n\n' };
    if (kind === 'quote-line-break') return { text: '\n> ' };
    if (kind === 'list-enter') {
      const item = inlineSource.closest?.('li');
      const list = item?.closest?.('ul, ol');
      const prefix = item && list ? richInlineSourceNextListPrefix(inlineSource, item, list) : '';
      return prefix ? { text: `\n${prefix}` } : null;
    }
    if (kind === 'line-break') {
      const cell = inlineSource.closest?.('td, th');
      if (cell && els.rich.contains(cell)) return { text: '<br>' };
      const quote = inlineSource.closest?.('blockquote');
      if (quote && els.rich.contains(quote)) return { text: '\n> ' };
      const item = inlineSource.closest?.('li');
      const list = item?.closest?.('ul, ol');
      if (item && list && els.rich.contains(item)) {
        const continuation = richInlineSourceListContinuationPrefix(inlineSource, item, list);
        return { text: `  \n${continuation}` };
      }
      return { text: '  \n' };
    }
    return null;
  }

  function richInlineSourceNextListPrefix(inlineSource, item, list) {
    const sourceItem = richInlineSourceListSourceItem(inlineSource, item, list);
    return sourceItem?.parsed ? nextListSourcePrefix(sourceItem.parsed) : '';
  }

  function richInlineSourceListContinuationPrefix(inlineSource, item, list) {
    const sourceItem = richInlineSourceListSourceItem(inlineSource, item, list);
    return sourceItem?.parsed ? `${sourceItem.parsed.indent}  ` : '  ';
  }

  function richInlineSourceListSourceItem(inlineSource, item, list) {
    if (!item || !list?.matches?.(RICH_SOURCE_BLOCK_SELECTOR) || item.parentElement !== list) return null;
    const sourceRange = richInlineSourceRange(inlineSource);
    if (!sourceRange) return null;
    const blockStart = numericData(list, 'sourceStart');
    const blockEnd = numericData(list, 'sourceEnd');
    if (!Number.isFinite(blockStart) || !Number.isFinite(blockEnd)) return null;
    const raw = stripRichCaretTokens(state.markdown || '').slice(blockStart, blockEnd);
    const sourceItems = flatListSourceItems(raw);
    const items = Array.from(list.children).filter((child) => child.tagName?.toLowerCase() === 'li');
    const itemIndex = items.indexOf(item);
    const sourceItem = sourceItems[itemIndex];
    if (itemIndex < 0 || !sourceItem || sourceItems.length !== items.length) return null;
    const localStart = sourceRange.start - blockStart;
    return sourceItem.start <= localStart && localStart <= sourceItem.end ? sourceItem : null;
  }

  function splitRichInlineSourceAtSelection(inlineSource) {
    const offset = richInlineSourceCaretOffset(inlineSource);
    if (!Number.isInteger(offset)) return null;
    return splitRichInlineSourceAtOffset(stripRichCaretTokens(normalizeNewlines(inlineSource.textContent || '')), offset);
  }

  function richInlineSourceSelectionRange(inlineSource) {
    const selection = window.getSelection?.();
    if (
      !selection
      || !selection.rangeCount
      || !inlineSource.contains(selection.anchorNode)
      || !inlineSource.contains(selection.focusNode)
    ) {
      return null;
    }
    const anchor = richInlineSourcePointOffset(inlineSource, selection.anchorNode, selection.anchorOffset);
    const focus = richInlineSourcePointOffset(inlineSource, selection.focusNode, selection.focusOffset);
    if (!Number.isInteger(anchor) || !Number.isInteger(focus)) return null;
    return {
      anchor,
      focus,
      from: Math.min(anchor, focus),
      to: Math.max(anchor, focus),
    };
  }

  function richInlineSourceCaretOffset(inlineSource) {
    const selection = window.getSelection?.();
    if (!selection || !selection.rangeCount || !selection.isCollapsed || !inlineSource.contains(selection.anchorNode)) return null;
    return richInlineSourcePointOffset(inlineSource, selection.anchorNode, selection.anchorOffset);
  }

  function richInlineSourcePointOffset(inlineSource, container, offset) {
    const before = document.createRange();
    before.selectNodeContents(inlineSource);
    try {
      before.setEnd(container, offset);
    } catch (_) {
      return null;
    }
    return stripRichCaretTokens(normalizeNewlines(before.toString())).length;
  }

  function previousStringOffset(source, offset) {
    const bounded = Math.max(0, Math.min(String(source || '').length, offset));
    if (bounded <= 0) return 0;
    const char = source.charCodeAt(bounded - 1);
    if (char >= 0xdc00 && char <= 0xdfff && bounded > 1) {
      const previous = source.charCodeAt(bounded - 2);
      if (previous >= 0xd800 && previous <= 0xdbff) return bounded - 2;
    }
    return bounded - 1;
  }

  function nextStringOffset(source, offset) {
    const text = String(source || '');
    const bounded = Math.max(0, Math.min(text.length, offset));
    if (bounded >= text.length) return text.length;
    const char = text.charCodeAt(bounded);
    if (char >= 0xd800 && char <= 0xdbff && bounded + 1 < text.length) {
      const next = text.charCodeAt(bounded + 1);
      if (next >= 0xdc00 && next <= 0xdfff) return bounded + 2;
    }
    return bounded + 1;
  }

  function splitRichInlineSourceAtOffset(source, offset) {
    const index = Math.max(0, Math.min(source.length, offset));
    return { before: source.slice(0, index), after: source.slice(index) };
  }

  function applyActiveRichInlineSourceTransaction(inlineSource, transaction) {
    const source = stripRichCaretTokens(normalizeNewlines(inlineSource.textContent || ''));
    const from = Math.max(0, Math.min(source.length, Number(transaction.from)));
    const to = Math.max(from, Math.min(source.length, Number(transaction.to)));
    const insert = stripRichCaretTokens(normalizeNewlines(transaction.insert || ''));
    const sourceRange = transaction.sourceRange || richInlineSourceRange(inlineSource);
    if (!sourceRange) return false;
    const markdown = stripRichCaretTokens(state.markdown || els.source.value || '');
    if (sourceRange.start < 0 || sourceRange.end > markdown.length || sourceRange.end < sourceRange.start) return false;
    const nextSource = `${source.slice(0, from)}${insert}${source.slice(to)}`;
    const nextEnd = sourceRange.start + nextSource.length;
    const nextOffset = sourceRange.start + from + insert.length;

    state.markdown = markdown.slice(0, sourceRange.start) + nextSource + markdown.slice(sourceRange.end);
    els.source.value = state.markdown;
    syncCodeMirrorSourceFromTextarea('rich-inline-source-transaction');
    inlineSource.textContent = nextSource;
    inlineSource.dataset.inlineSource = nextSource;
    inlineSource.dataset.srcStart = String(sourceRange.start);
    inlineSource.dataset.srcEnd = String(nextEnd);
    state.richInlineSource = {
      ...(state.richInlineSource || {}),
      element: inlineSource,
      undoCaptured: true,
    };
    placeCaretInInlineSource(inlineSource, nextOffset - sourceRange.start);
    markDirty();
    refreshRichSourceRangesFromMarkdown();
    renderPreview();
    renderOutline();
    updateStatusBar();
    scheduleAutosave();
    suppressRichInlineActivation();
    return true;
  }

  function syncActiveRichInlineSourceMarkdown(inlineSource, reason = 'rich-inline-source-input') {
    const sourceRange = richInlineSourceRange(inlineSource);
    if (!sourceRange) return false;
    const selectionRange = richInlineSourceSelectionRange(inlineSource);
    const selectionOffset = Number.isInteger(selectionRange?.focus) ? selectionRange.focus : null;
    const rawSource = normalizeNewlines(inlineSource.textContent || '');
    const source = stripRichCaretTokens(normalizeNewlines(inlineSource.textContent || ''));
    const markdown = stripRichCaretTokens(state.markdown || els.source.value || '');
    if (sourceRange.start < 0 || sourceRange.end > markdown.length || sourceRange.end < sourceRange.start) return false;
    const nextEnd = sourceRange.start + source.length;
    const current = markdown.slice(sourceRange.start, sourceRange.end);
    if (current !== source) {
      state.markdown = markdown.slice(0, sourceRange.start) + source + markdown.slice(sourceRange.end);
      els.source.value = state.markdown;
      syncCodeMirrorSourceFromTextarea(reason);
      markDirty();
      renderPreview();
      renderOutline();
      updateStatusBar();
      scheduleAutosave();
    }
    if (rawSource !== source) {
      inlineSource.textContent = source;
      if (Number.isInteger(selectionOffset)) {
        placeCaretInInlineSource(inlineSource, Math.max(0, Math.min(selectionOffset, source.length)));
      }
    }
    inlineSource.dataset.inlineSource = source;
    inlineSource.dataset.srcStart = String(sourceRange.start);
    inlineSource.dataset.srcEnd = String(nextEnd);
    state.richInlineSource = {
      ...(state.richInlineSource || {}),
      element: inlineSource,
    };
    refreshRichSourceRangesFromMarkdown();
    if (reason) suppressRichInlineActivation();
    return true;
  }

  function replaceInlineSourceWithFragment(inlineSource, source) {
    const fragment = source ? renderRichInlineSourceFragment(source) : document.createDocumentFragment();
    if (state.richInlineSource?.element === inlineSource) state.richInlineSource = null;
    inlineSource.replaceWith(fragment);
    configureRichEditableSurface();
  }

  function extractListItemTailAfterMarker(item, marker) {
    const tailRange = document.createRange();
    tailRange.setStartAfter(marker);
    tailRange.setEnd(item, listItemContentEndOffset(item));
    const fragment = tailRange.extractContents();
    fragment.querySelectorAll?.('.task-checkbox').forEach((checkbox) => checkbox.remove());
    return fragment;
  }

  function extractRichBlockTailAfterMarker(block, marker) {
    const tailRange = document.createRange();
    tailRange.setStartAfter(marker);
    tailRange.setEnd(block, block.childNodes.length);
    return tailRange.extractContents();
  }

  function appendRichInlineSourceAndTail(target, source, tail, kind) {
    if (source) {
      const sourceFragment = renderRichInlineSourceFragment(source);
      if (!isFragmentVisiblyEmpty(sourceFragment)) target.appendChild(sourceFragment);
    }
    if (tail && !isFragmentVisiblyEmpty(tail)) target.appendChild(tail);
    if (kind === 'list-item') {
      ensureListItemEditablePlaceholder(target);
    } else {
      ensureRichTextBlockPlaceholder(target);
    }
  }

  function handleRichInlineSourceArrow(event, inlineSource) {
    if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return false;
    const offset = richInlineSourceCaretOffset(inlineSource);
    if (!Number.isInteger(offset)) return false;
    const length = normalizeNewlines(inlineSource.textContent || '').length;

    if (event.key === 'ArrowRight' && offset >= length) {
      event.preventDefault();
      commitRichInlineSourceAtBoundary(inlineSource, 'after');
      return true;
    }
    if (event.key === 'ArrowLeft' && offset <= 0) {
      event.preventDefault();
      commitRichInlineSourceAtBoundary(inlineSource, 'before');
      return true;
    }
    return false;
  }

  function commitRichInlineSourceAtBoundary(inlineSource, boundary) {
    const start = Number(inlineSource?.dataset?.srcStart);
    const source = stripRichCaretTokens(normalizeNewlines(inlineSource?.textContent || ''));
    const offsetAfterCommit = Number.isFinite(start)
      ? (boundary === 'before' ? start : start + source.length)
      : null;
    const caretToken = richCaretToken();
    const marker = document.createTextNode(caretToken);
    if (boundary === 'before') {
      inlineSource.before(marker);
    } else {
      inlineSource.after(marker);
    }
    const committed = commitRichInlineSource(inlineSource, { caretToken });
    if (committed) {
      if (Number.isFinite(offsetAfterCommit)) {
        restoreRichCaretFromSourceSelection({
          anchor: offsetAfterCommit,
          focus: offsetAfterCommit,
          affinity: boundary,
        });
      }
      suppressRichInlineActivation();
    }
    return committed;
  }

  function handleRichInlineBoundaryArrow(event) {
    if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return false;
    if (event.target.closest?.('.rich-source-editor, .code-language-input')) return false;
    const selection = window.getSelection?.();
    if (!selection || !selection.rangeCount || !selection.isCollapsed || !els.rich.contains(selection.anchorNode)) return false;
    if (nodeClosest(selection.anchorNode, '.rich-inline-source')) return false;

    const range = selection.getRangeAt(0);
    const candidate = richInlineBoundaryCandidate(range, event.key);
    if (!candidate) return false;

    event.preventDefault();
    cleanupRichCaretBoundaryMarkers({ preserveSelection: false });
    activateRichInlineSource(candidate.element, candidate.position);
    return true;
  }

  function richInlineBoundaryCandidate(range, key) {
    const editBlock = richInlineEditBlockForRange(range);
    if (!editBlock) return null;
    const direction = key === 'ArrowLeft' ? 'before' : key === 'ArrowRight' ? 'after' : '';
    if (!direction) return null;

    const direct = validRichInlineSourceElement(nodeElement(range.startContainer)?.closest?.(RICH_INLINE_SOURCE_SELECTOR));
    if (direct && isSameRichInlineEditBlock(direct, editBlock)) {
      const offset = richInlineElementTextOffsetForRange(direct, range);
      const length = normalizeRichText(direct.textContent || '').length;
      if (direction === 'before' && offset >= length) return { element: direct, position: 'end' };
      if (direction === 'after' && offset <= 0) return { element: direct, position: 'start' };
    }

    const adjacent = adjacentNodeForInlineBoundary(range.startContainer, range.startOffset, direction);
    const element = validRichInlineSourceElement(nodeElement(adjacent)?.closest?.(RICH_INLINE_SOURCE_SELECTOR));
    if (!element || !isSameRichInlineEditBlock(element, editBlock)) return null;
    return { element, position: direction === 'before' ? 'end' : 'start' };
  }

  function richInlineElementTextOffsetForRange(element, range) {
    const before = range.cloneRange();
    before.selectNodeContents(element);
    try {
      before.setEnd(range.startContainer, range.startOffset);
    } catch (_) {
      return 0;
    }
    return normalizeRichText(before.toString()).length;
  }

  function adjacentNodeForInlineBoundary(container, offset, direction) {
    if (isRichCaretBoundaryMarker(container)) {
      if (direction === 'before' && offset > 0) return adjacentDomNode(container, 'before');
      if (direction === 'after' && offset <= 0) return adjacentDomNode(container, 'after');
      return null;
    }
    return adjacentCaretNode(container, offset, direction);
  }

  function handleRichTableLineBreakDelete(event) {
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
    const selection = window.getSelection?.();
    const range = richSelectionRange(selection);
    if (!range?.collapsed) return false;
    if (nodeClosest(range.startContainer, '.rich-inline-source, .rich-source-editor, .code-language-input')) return false;
    const cell = nodeClosest(range.startContainer, 'td, th');
    if (!cell || !els.rich.contains(cell)) return false;

    const target = event.key === 'Backspace'
      ? tableBackspaceBreakTarget(range)
      : tableDeleteBreakTarget(range);
    if (!target) return false;

    const deletion = richTableLineBreakDeletionTransaction(cell, target.br, event.key === 'Backspace' ? 'before' : 'after');
    if (deletion) {
      event.preventDefault();
      applySourceTransaction(deletion, 'rich-table-line-break-delete');
      suppressRichInlineActivation();
      return true;
    }

    if (guardFailedRichSourceControlTransaction(cell, 'rich-table-line-break-delete', 'テーブルセル改行を削除できませんでした')) {
      event.preventDefault();
      return true;
    }

    event.preventDefault();
    target.br.remove();
    if (target.textNode?.isConnected && target.textNode.nodeValue?.startsWith('\u200b')) {
      target.textNode.nodeValue = target.textNode.nodeValue.slice(1);
      placeCaretInTextNode(target.textNode, 0);
    } else if (target.textNode?.isConnected) {
      placeCaretInTextNode(target.textNode, target.offset || 0);
    } else if (target.caretNode?.isConnected) {
      placeCaretAfterNode(target.caretNode);
    } else {
      placeCaretAtStart(cell);
    }
    syncRichMarkdownFromDom('rich-input');
    return true;
  }

  function richTableLineBreakDeletionTransaction(cell, br, direction) {
    if (!br?.isConnected) return null;
    const cellRange = richTableCellSourceRange(cell);
    if (!cellRange) return null;
    const local = tableCellLocalSourceOffsetBeforeNode(cell, br);
    if (!Number.isFinite(local)) return null;
    const from = cellRange.contentStart + local;
    const to = from + 4;
    if (from < cellRange.contentStart || to > cellRange.contentEnd) return null;
    const markdown = stripRichCaretTokens(state.markdown || els.source.value || '');
    if (markdown.slice(from, to).toLowerCase() !== '<br>') return null;
    return {
      from,
      to,
      insert: '',
      selectionAfter: {
        anchor: from,
        focus: from,
        affinity: direction === 'before' ? 'before' : 'after',
      },
    };
  }

  function tableCellLocalSourceOffsetBeforeNode(cell, targetNode) {
    let cursor = 0;
    for (const node of Array.from(cell.childNodes)) {
      if (node === targetNode) return cursor;
      cursor += serializeTableCellInlineNode(node).length;
    }
    return NaN;
  }

  function tableBackspaceBreakTarget(range) {
    const container = range.startContainer;
    const offset = range.startOffset;
    if (container.nodeType === Node.TEXT_NODE) {
      const text = container.nodeValue || '';
      const atMarkerBoundary = text.startsWith('\u200b') && offset <= 1;
      if (offset === 0 || atMarkerBoundary) {
        const br = previousSiblingElement(container, 'br');
        if (br) return { br, textNode: container, offset: 0 };
      }
      return null;
    }
    if (container.nodeType === Node.ELEMENT_NODE) {
      const br = elementChildAt(container, offset - 1, 'br');
      if (br) return { br, caretNode: br.previousSibling };
    }
    return null;
  }

  function tableDeleteBreakTarget(range) {
    const container = range.startContainer;
    const offset = range.startOffset;
    if (container.nodeType === Node.TEXT_NODE) {
      const text = container.nodeValue || '';
      if (offset !== text.length) return null;
      const br = nextSiblingElement(container, 'br');
      const after = br?.nextSibling;
      return br ? { br, textNode: after?.nodeType === Node.TEXT_NODE ? after : container, offset } : null;
    }
    if (container.nodeType === Node.ELEMENT_NODE) {
      const br = elementChildAt(container, offset, 'br');
      if (br) return { br, caretNode: br.previousSibling };
    }
    return null;
  }

  function previousSiblingElement(node, tagName) {
    let sibling = node.previousSibling;
    while (sibling && sibling.nodeType === Node.TEXT_NODE && sibling.nodeValue === '') sibling = sibling.previousSibling;
    return sibling?.nodeType === Node.ELEMENT_NODE && sibling.tagName.toLowerCase() === tagName ? sibling : null;
  }

  function nextSiblingElement(node, tagName) {
    let sibling = node.nextSibling;
    while (sibling && sibling.nodeType === Node.TEXT_NODE && sibling.nodeValue === '') sibling = sibling.nextSibling;
    return sibling?.nodeType === Node.ELEMENT_NODE && sibling.tagName.toLowerCase() === tagName ? sibling : null;
  }

  function elementChildAt(element, index, tagName) {
    const child = element.childNodes[index];
    return child?.nodeType === Node.ELEMENT_NODE && child.tagName.toLowerCase() === tagName ? child : null;
  }

  function placeCaretInTextNode(textNode, offset) {
    const range = document.createRange();
    range.setStart(textNode, Math.max(0, Math.min(offset, textNode.nodeValue.length)));
    range.collapse(true);
    const selection = window.getSelection?.();
    if (!selection) return;
    selection.removeAllRanges();
    selection.addRange(range);
    els.rich.focus();
  }

  function handleRichEmptyListBackspace(event) {
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
    const selection = window.getSelection?.();
    const range = richSelectionRange(selection);
    if (!range?.collapsed) return false;
    if (nodeClosest(range.startContainer, '.rich-inline-source, .rich-source-editor, .code-language-input')) return false;
    const item = richListItemFromRange(range);
    if (!item || !isRichListItemEmpty(item)) return false;
    if (richListCaretTextOffset(item, range) !== 0) return false;
    const list = item.closest('ul, ol');
    if (!list) return false;

    const sourceTransaction = richEmptyListItemBackspaceTransaction(item, list);
    if (sourceTransaction) {
      event.preventDefault();
      applySourceTransaction(sourceTransaction, 'rich-empty-list-backspace');
      suppressRichInlineActivation();
      return true;
    }

    if (list.matches?.(RICH_SOURCE_BLOCK_SELECTOR)) {
      event.preventDefault();
      setStatus('リスト項目を削除できませんでした');
      suppressRichInlineActivation();
      return true;
    }

    event.preventDefault();
    const previousTarget = previousCaretTargetForListItem(item, list);
    item.remove();
    cleanupListAfterItemRemoval(list);
    restoreCaretAfterEmptyListRemoval(previousTarget, list);
    syncRichMarkdownFromDom('rich-input');
    return true;
  }

  function richEmptyListItemBackspaceTransaction(item, list) {
    if (!item || !list?.matches?.(RICH_SOURCE_BLOCK_SELECTOR) || item.parentElement !== list) return null;
    if (!isRichListItemEmpty(item)) return null;
    const blockStart = numericData(list, 'sourceStart');
    const blockEnd = numericData(list, 'sourceEnd');
    if (!Number.isFinite(blockStart) || !Number.isFinite(blockEnd)) return null;
    const markdown = stripRichCaretTokens(state.markdown || els.source.value || '');
    const raw = markdown.slice(blockStart, blockEnd);
    const sourceItems = flatListSourceItems(raw);
    const items = Array.from(list.children).filter((child) => child.tagName?.toLowerCase() === 'li');
    const itemIndex = items.indexOf(item);
    if (itemIndex < 0 || sourceItems.length !== items.length) return null;
    const sourceItem = sourceItems[itemIndex];
    if (!sourceItem || sourceItem.lines.length !== 1) return null;
    if (visibleTextFromListSourceItem(sourceItem).trim() !== '') return null;

    if (sourceItems.length === 1) {
      const afterSeparator = markdown.slice(blockEnd).match(/^\n{1,2}/)?.[0] || '';
      return {
        from: blockStart,
        to: blockEnd + afterSeparator.length,
        insert: '',
        blankParagraphAt: blockStart,
        selectionAfter: {
          anchor: blockStart,
          focus: blockStart,
          affinity: 'after',
        },
      };
    }

    const line = sourceItem.lines[0];
    const isLast = itemIndex === sourceItems.length - 1;
    const fromLocal = isLast && line.start > 0 ? line.start - 1 : line.start;
    const toLocal = line.end;
    const previousItem = sourceItems[itemIndex - 1] || null;
    const nextItem = sourceItems[itemIndex + 1] || null;
    let selectionAfter = blockStart + fromLocal;
    if (previousItem) {
      selectionAfter = blockStart + sourceOffsetFromListItemTextOffset(previousItem, visibleTextFromListSourceItem(previousItem).length);
    } else if (nextItem?.parsed) {
      selectionAfter = blockStart + fromLocal + nextItem.parsed.prefix.length;
    }

    return {
      from: blockStart + fromLocal,
      to: blockStart + toLocal,
      insert: '',
      selectionAfter: {
        anchor: selectionAfter,
        focus: selectionAfter,
        affinity: previousItem ? 'before' : 'after',
      },
    };
  }

  function previousCaretTargetForListItem(item, list) {
    let sibling = item.previousElementSibling;
    while (sibling) {
      if (sibling.tagName?.toLowerCase() === 'li') return { type: 'li', node: sibling };
      sibling = sibling.previousElementSibling;
    }

    let previous = list.previousElementSibling;
    while (previous) {
      if (['ul', 'ol'].includes(previous.tagName?.toLowerCase())) {
        const lastItem = lastDirectListItem(previous);
        if (lastItem) return { type: 'li', node: lastItem };
      }
      if (els.rich.contains(previous)) return { type: 'block', node: previous };
      previous = previous.previousElementSibling;
    }
    return null;
  }

  function lastDirectListItem(list) {
    const items = Array.from(list.children).filter((child) => child.tagName?.toLowerCase() === 'li');
    return items[items.length - 1] || null;
  }

  function cleanupListAfterItemRemoval(list) {
    if (!Array.from(list.children).some((child) => child.tagName?.toLowerCase() === 'li')) {
      list.remove();
      return;
    }
    if (!list.querySelector(':scope > li > .task-checkbox')) list.classList.remove('task-list');
  }

  function restoreCaretAfterEmptyListRemoval(target, list) {
    if (target?.node?.isConnected && target.type === 'li') {
      placeCaretAtListItemEnd(target.node);
      return;
    }
    if (target?.node?.isConnected) {
      placeCaretAtEnd(target.node);
      return;
    }
    if (list.isConnected) {
      placeCaretAtStart(list);
    } else {
      const paragraph = document.createElement('p');
      paragraph.appendChild(document.createElement('br'));
      els.rich.appendChild(paragraph);
      placeCaretAtStart(paragraph);
    }
  }

  function handleRichTaskCheckboxDelete(event) {
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
    const selection = window.getSelection?.();
    const range = richSelectionRange(selection);
    if (!range?.collapsed) return false;
    if (nodeClosest(range.startContainer, '.rich-inline-source, .rich-source-editor, .code-language-input')) return false;
    const item = richListItemFromRange(range);
    if (!item) return false;
    const checkbox = directTaskCheckboxForItem(item);
    if (!checkbox) return false;
    if (richListCaretTextOffset(item, range) !== 0) return false;

    const sourceTransaction = removeRichTaskCheckboxTransaction(checkbox, item);
    if (sourceTransaction) {
      event.preventDefault();
      applySourceTransaction(sourceTransaction, 'rich-task-checkbox-delete');
      setStatus('チェックリストを通常リストに戻しました');
      suppressRichInlineActivation();
      return true;
    }

    const list = item.closest('ul, ol');
    if (list?.matches?.(RICH_SOURCE_BLOCK_SELECTOR)) {
      event.preventDefault();
      setStatus('チェックリストを通常リストに戻せませんでした');
      suppressRichInlineActivation();
      return true;
    }

    event.preventDefault();
    checkbox.remove();
    item.classList.remove('task-list-item');
    if (list && !list.querySelector(':scope > li > .task-checkbox')) list.classList.remove('task-list');
    placeCaretAtListItemStart(item);
    syncRichMarkdownFromDom('rich-input');
    return true;
  }

  function handleRichAtomicBlockBoundaryDelete(event) {
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
    if (event.target?.closest?.('.rich-source-editor, .code-language-input')) return false;
    const selection = window.getSelection?.();
    const range = richSelectionRange(selection);
    if (!range?.collapsed) return false;
    if (nodeClosest(range.startContainer, '.rich-inline-source, .rich-source-editor, .code-language-input')) return false;
    const direction = event.key === 'Backspace' ? 'before' : event.key === 'Delete' ? 'after' : '';
    if (!direction) return false;

    const atomicBlock = richAtomicBlockDeleteCandidate(range, direction);
    if (!atomicBlock) return false;
    const deletion = richAtomicBlockDeleteTransaction(atomicBlock, direction);
    if (!deletion) return false;

    event.preventDefault();
    applySourceTransaction(deletion, 'rich-atomic-block-delete');
    suppressRichInlineActivation();
    setStatus('ブロックを削除しました');
    return true;
  }

  function richAtomicBlockDeleteCandidate(range, direction) {
    const direct = nodeClosest(range.startContainer, RICH_ATOMIC_SOURCE_BLOCK_SELECTOR);
    if (direct && els.rich.contains(direct) && !direct.closest('.is-editing-source')) return direct;

    if (range.startContainer.nodeType === Node.ELEMENT_NODE) {
      const sibling = direction === 'before'
        ? range.startContainer.childNodes?.[range.startOffset - 1]
        : range.startContainer.childNodes?.[range.startOffset];
      const atomic = nodeElement(sibling)?.closest?.(RICH_ATOMIC_SOURCE_BLOCK_SELECTOR);
      if (atomic && els.rich.contains(atomic) && !atomic.closest('.is-editing-source')) return atomic;
    }

    const block = richCaretBlockFromRange(range);
    if (!block) return null;
    const offset = richCaretBlockTextOffset(block, range);
    const length = richCaretBlockTextLength(block);
    if (direction === 'before' && offset <= 0) return adjacentRichAtomicBlock(block, 'previous');
    if (direction === 'after' && offset >= length) return adjacentRichAtomicBlock(block, 'next');
    return null;
  }

  function adjacentRichAtomicBlock(block, direction) {
    const siblingProperty = direction === 'previous' ? 'previousElementSibling' : 'nextElementSibling';
    let sibling = block?.[siblingProperty] || null;
    while (sibling) {
      if (sibling.matches?.(RICH_ATOMIC_SOURCE_BLOCK_SELECTOR) && !sibling.closest('.is-editing-source')) return sibling;
      if (!isIgnorableRichBoundaryElement(sibling)) return null;
      sibling = sibling[siblingProperty];
    }
    return null;
  }

  function isIgnorableRichBoundaryElement(element) {
    return Boolean(element?.matches?.('p[data-rich-trailing="true"]') && isEmptyRichParagraph(element));
  }

  function richAtomicBlockDeleteTransaction(block, direction) {
    const markdown = stripRichCaretTokens(state.markdown || els.source.value || '');
    const start = numericData(block, 'sourceStart');
    const end = numericData(block, 'sourceEnd');
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || end > markdown.length) return null;
    const deletion = sourceBlockDeletionRange(markdown, start, end, direction);
    return {
      from: deletion.from,
      to: deletion.to,
      insert: '',
      selectionAfter: {
        anchor: deletion.from,
        focus: deletion.from,
        affinity: direction === 'before' ? 'before' : 'after',
      },
    };
  }

  function sourceBlockDeletionRange(markdown, start, end, direction) {
    let from = start;
    let to = end;
    const after = markdown.slice(to);
    const afterSeparator = after.match(/^\n{1,2}/)?.[0] || '';
    if (direction === 'after' && afterSeparator) {
      to += afterSeparator.length;
      return { from, to };
    }
    const before = markdown.slice(0, from);
    const beforeSeparator = before.match(/\n{1,2}$/)?.[0] || '';
    if (beforeSeparator) {
      from -= beforeSeparator.length;
      return { from, to };
    }
    if (afterSeparator) to += afterSeparator.length;
    return { from, to };
  }

  function directTaskCheckboxForItem(item) {
    return Array.from(item.children).find((child) => child.classList?.contains('task-checkbox')) || null;
  }

  function handleRichDeleteToEmptyBlock(event) {
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    const selection = window.getSelection?.();
    const range = richSelectionRange(selection);
    if (!range?.collapsed) return false;
    if (nodeClosest(range.startContainer, '.rich-inline-source, .rich-source-editor, .code-language-input')) return false;
    const block = nodeClosest(range.startContainer, RICH_INLINE_EDIT_BLOCK_SELECTOR);
    if (!block || block.closest('li')) return false;
    const text = normalizeRichText(block.textContent || '');
    if (text.length !== 1) return false;
    const caretOffset = getCaretCharacterOffsetWithin(block, selection);
    if (event.key === 'Backspace' && caretOffset !== text.length) return false;
    if (event.key === 'Delete' && caretOffset !== 0) return false;

    const sourceTransaction = richDeleteToEmptyBlockTransaction(block, range, event.key);
    if (sourceTransaction) {
      event.preventDefault();
      state.richSelectionLock = true;
      applySourceTransaction(sourceTransaction, 'rich-delete-to-empty-block');
      state.richSelectionLock = false;
      suppressRichInlineActivation();
      return true;
    }

    if (guardFailedRichSourceControlTransaction(block, 'rich-delete-to-empty-block', 'ブロックを空にできませんでした')) {
      event.preventDefault();
      return true;
    }

    event.preventDefault();
    state.richSelectionLock = true;
    block.replaceChildren(document.createTextNode(''), document.createElement('br'));
    placeCaretAtStart(block);
    state.richSelectionLock = false;
    suppressRichInlineActivation();
    syncRichMarkdownFromDom('rich-input');
    return true;
  }

  function richDeleteToEmptyBlockTransaction(block, range, key) {
    if (!block || !range?.collapsed || !isSourceTransactionTextRange(range)) return null;
    const point = richPlainTextSourcePointFromRange(range);
    if (!point || !Number.isFinite(point.offset)) return null;
    const backward = key === 'Backspace';
    const deletionRange = richPlainTextDeletionRange(point, backward);
    if (!deletionRange) return null;
    const { from, to } = deletionRange;
    if (from < point.contentStart || to > point.contentEnd || from < 0 || to <= from) return null;

    const sourceBlock = nodeClosest(block, RICH_SOURCE_BLOCK_SELECTOR);
    const isParagraph = sourceBlock?.dataset?.blockType === 'paragraph';
    const blockStart = numericData(sourceBlock, 'sourceStart');
    const blockEnd = numericData(sourceBlock, 'sourceEnd');
    const markdown = stripRichCaretTokens(state.markdown || els.source.value || '');
    const raw = Number.isFinite(blockStart) && Number.isFinite(blockEnd)
      ? markdown.slice(blockStart, blockEnd)
      : '';
    const becomesEmptyParagraph = isParagraph && raw.length === to - from;

    return {
      from,
      to,
      insert: '',
      selectionAfter: {
        anchor: from,
        focus: from,
        affinity: backward ? 'before' : 'after',
      },
      blankParagraphAt: becomesEmptyParagraph ? from : undefined,
    };
  }

  function handleRichEnter(event) {
    event.preventDefault();
    window.clearTimeout(state.richReparseTimer);

    const selection = window.getSelection?.();
    const range = richInputRangeFromEvent(event) || richSelectionRange(selection);
    if (!range || !els.rich.contains(range.startContainer)) return;
    pushRichUndoSnapshot('line-break');

    if (!event.shiftKey && handleRichSelectionEnterTransaction(selection)) {
      return;
    }

    if (!event.shiftKey && (
      parsePendingRichMathShortcutInBlock(richPendingMathShortcutBlockFromRange(range))
      || activatePendingMathShortcutFromSelection()
    )) {
      return;
    }

    if (event.shiftKey) {
      const tableCell = nodeClosest(range.startContainer, 'td, th');
      if (tableCell && els.rich.contains(tableCell) && handleRichTableCellLineBreakTransaction(tableCell, range)) return;
      const quote = nodeClosest(range.startContainer, 'blockquote');
      if (quote && els.rich.contains(quote) && handleRichQuoteLineBreakTransaction(quote, range)) return;
      if (handleRichLineBreakTransaction({ pushUndo: false })) return;
      if (insertRichLineBreakAtRange(range)) syncRichMarkdownFromDom('rich-input');
      return;
    }

    if (!range.collapsed && guardUnsupportedRichSelectionEnterFallback(range)) return;
    if (!range.collapsed) range.deleteContents();

    const tableCell = nodeClosest(range.startContainer, 'td, th');
    if (tableCell && els.rich.contains(tableCell)) {
      if (handleRichTableCellLineBreakTransaction(tableCell, range)) return;
      if (insertRichLineBreakAtRange(range)) syncRichMarkdownFromDom('rich-input');
      return;
    }

    const quote = nodeClosest(range.startContainer, 'blockquote');
    if (quote && els.rich.contains(quote) && handleRichQuoteEnterTransaction(quote, range)) {
      return;
    }

    const listItem = richListItemFromRange(range);
    if (listItem && els.rich.contains(listItem)) {
      handleRichListEnter(listItem, range);
      return;
    }

    const textBlock = richTextBlockFromRange(range);
    if (textBlock) {
      if (handleRichTextBlockEnterTransaction(textBlock, range)) return;
      if (guardUnsupportedRichTextBlockEnterFallback(textBlock, range)) return;
      splitRichTextBlockAtRange(textBlock, range);
      return;
    }

    const anchor = range.startContainer.nodeType === Node.ELEMENT_NODE
      ? range.startContainer
      : range.startContainer.parentElement;
    const current = anchor?.closest?.('p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, table, figure, nav, div');
    const insertionBase = richParagraphInsertionBase(current);
    const paragraph = document.createElement('p');
    paragraph.appendChild(document.createElement('br'));

    if (insertionBase && insertionBase !== els.rich) {
      insertionBase.after(paragraph);
    } else {
      els.rich.appendChild(paragraph);
    }
    placeCaretAtStart(paragraph);
    syncRichMarkdownFromDom('rich-input');
  }

  function handleRichSelectionEnterTransaction(selection) {
    if (!selection || selection.isCollapsed) return false;
    const tableRange = richTableTextReplacementRangeFromSelection(selection);
    const quoteRange = tableRange ? null : richQuoteTextReplacementRangeFromSelection(selection);
    const rawRange = tableRange || quoteRange || richPlainTextTransactionRangeFromSelection(selection);
    const replacementRange = rawRange?.from !== rawRange?.to
      ? expandSourceRangeToIntersectingInlineAtoms(rawRange)
      : rawRange;
    if (!replacementRange || replacementRange.from === replacementRange.to) return false;
    const markdown = stripRichCaretTokens(state.markdown || els.source.value || '');
    const replacement = tableRange || quoteRange
      ? {
        from: replacementRange.from,
        to: replacementRange.to,
        insert: tableRange ? '<br>' : '\n> ',
      }
      : sourceParagraphBreakReplacement(markdown, replacementRange.from, replacementRange.to);
    applySourceTransaction({
      from: replacement.from,
      to: replacement.to,
      insert: replacement.insert,
      selectionAfter: {
        anchor: replacement.from + replacement.insert.length,
        focus: replacement.from + replacement.insert.length,
        affinity: 'after',
      },
    }, 'rich-selection-enter');
    suppressRichInlineActivation();
    return true;
  }

  function guardUnsupportedRichSelectionEnterFallback(range) {
    if (!range || range.collapsed || !els.rich.contains(range.startContainer) || !els.rich.contains(range.endContainer)) return false;
    if (!richRangeTouchesSourceBlock(range)) return false;
    setStatus('この選択では段落を分割できません');
    suppressRichInlineActivation();
    return true;
  }

  function sourceParagraphBreakReplacement(markdown, from, to) {
    const source = String(markdown || '');
    let start = Math.max(0, Math.min(source.length, Number(from)));
    let end = Math.max(start, Math.min(source.length, Number(to)));
    const beforeHasBlockBreak = source.slice(0, start).endsWith('\n\n');
    const afterBreak = source.slice(end).match(/^\n{1,2}/)?.[0] || '';
    if (afterBreak) end += afterBreak.length;
    return {
      from: start,
      to: end,
      insert: beforeHasBlockBreak ? '' : '\n\n',
    };
  }

  function handleRichTextBlockEnterTransaction(textBlock, range) {
    if (!textBlock || textBlock === els.rich || !range?.collapsed) return false;
    if (!textBlock.matches?.('p, h1, h2, h3, h4, h5, h6')) return false;
    if (!textBlock.matches?.(RICH_SOURCE_BLOCK_SELECTOR)) return false;
    const sourcePoint = domPointToSourceOffset(range.startContainer, range.startOffset);
    if (!sourcePoint || !Number.isFinite(sourcePoint.offset)) return false;
    const blockStart = numericData(textBlock, 'sourceStart');
    const blockEnd = numericData(textBlock, 'sourceEnd');
    if (sourcePoint.offset < blockStart || sourcePoint.offset > blockEnd) return false;
    const blankParagraphAt = sourcePoint.offset === blockStart
      ? blockStart
      : sourcePoint.offset === blockEnd
        ? sourcePoint.offset + 2
        : undefined;
    const placeCaretInBlankParagraph = sourcePoint.offset === blockEnd ? undefined : false;
    return applySourceTransaction({
      from: sourcePoint.offset,
      to: sourcePoint.offset,
      insert: '\n\n',
      selectionAfter: {
        anchor: sourcePoint.offset + 2,
        focus: sourcePoint.offset + 2,
        affinity: 'after',
      },
      blankParagraphAt,
      placeCaretInBlankParagraph,
    }, 'rich-enter-text-block');
  }

  function guardUnsupportedRichTextBlockEnterFallback(block, range) {
    if (!block || !range || !els.rich.contains(block)) return false;
    const sourceBlock = nodeClosest(block, RICH_SOURCE_BLOCK_SELECTOR) || nodeClosest(range.startContainer, RICH_SOURCE_BLOCK_SELECTOR);
    if (!sourceBlock) return false;
    setStatus('この位置では段落を分割できません');
    suppressRichInlineActivation();
    return true;
  }

  function richInputRangeFromEvent(event) {
    const ranges = event.getTargetRanges?.();
    const inputRange = ranges && ranges[0];
    if (!inputRange || !els.rich.contains(inputRange.startContainer) || !els.rich.contains(inputRange.endContainer)) return null;
    const range = document.createRange();
    try {
      range.setStart(inputRange.startContainer, inputRange.startOffset);
      range.setEnd(inputRange.endContainer, inputRange.endOffset);
    } catch (_) {
      return null;
    }
    return range;
  }

  function richSelectionRange(selection) {
    if (!selection || !selection.rangeCount || !els.rich.contains(selection.anchorNode) || !els.rich.contains(selection.focusNode)) return null;
    let range = null;
    try {
      range = selection.getRangeAt(0);
    } catch (_) {
      return null;
    }
    if (!els.rich.contains(range.startContainer) || !els.rich.contains(range.endContainer)) return null;
    return range;
  }

  function richTextBlockFromRange(range) {
    const block = nodeClosest(range.startContainer, 'p, h1, h2, h3, h4, h5, h6, div') || (
      range.startContainer.nodeType === Node.TEXT_NODE && range.startContainer.parentNode === els.rich ? els.rich : null
    );
    if (!block || !els.rich.contains(block)) return null;
    if (block !== els.rich && block.closest('li, .rich-source-editor, .mermaid-diagram, pre.code-block, .math-display, .toc')) return null;
    return block;
  }

  function splitRichTextBlockAtRange(block, range) {
    if (block === els.rich) {
      splitRootTextAtRange(range);
      return;
    }

    const next = document.createElement('p');
    const tail = extractRichBlockTail(block, range);
    appendRichBlockTail(next, tail);
    ensureRichTextBlockPlaceholder(block);
    block.after(next);
    placeCaretAtStart(next);
    syncRichMarkdownFromDom('rich-input');
  }

  function splitRootTextAtRange(range) {
    if (range.startContainer.nodeType !== Node.TEXT_NODE || range.startContainer.parentNode !== els.rich) return;
    const textNode = range.startContainer;
    const value = textNode.nodeValue || '';
    const previous = document.createElement('p');
    previous.textContent = value.slice(0, range.startOffset);
    const next = document.createElement('p');
    next.textContent = value.slice(range.startOffset);
    ensureRichTextBlockPlaceholder(previous);
    ensureRichTextBlockPlaceholder(next);
    textNode.replaceWith(previous, next);
    placeCaretAtStart(next);
    syncRichMarkdownFromDom('rich-input');
  }

  function extractRichBlockTail(block, range) {
    const tailRange = document.createRange();
    tailRange.setStart(range.startContainer, range.startOffset);
    tailRange.setEnd(block, block.childNodes.length);
    return tailRange.extractContents();
  }

  function appendRichBlockTail(block, fragment) {
    if (isFragmentVisiblyEmpty(fragment)) {
      block.appendChild(document.createTextNode(''));
      block.appendChild(document.createElement('br'));
      return;
    }
    block.appendChild(fragment);
  }

  function ensureRichTextBlockPlaceholder(block) {
    if (!areInlineNodesVisiblyEmpty(Array.from(block.childNodes))) return;
    block.replaceChildren(document.createTextNode(''), document.createElement('br'));
  }

  function richParagraphInsertionBase(element) {
    if (!element || !els.rich.contains(element)) return els.rich.lastElementChild || els.rich;
    if (element.tagName?.toLowerCase() === 'li') return element.closest('ul, ol') || element;
    return element;
  }

  function richListItemFromRange(range) {
    const startItem = nodeClosest(range.startContainer, 'li');
    if (startItem && els.rich.contains(startItem)) return startItem;
    const selection = window.getSelection?.();
    const focusItem = nodeClosest(selection?.focusNode, 'li');
    return focusItem && els.rich.contains(focusItem) ? focusItem : null;
  }

  function handleRichListArrowNavigation(event) {
    if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return false;
    if (event.target.closest?.('.rich-source-editor, .code-language-input')) return false;
    const selection = window.getSelection?.();
    if (!selection || !selection.rangeCount || !selection.isCollapsed || !els.rich.contains(selection.anchorNode)) return false;
    const range = selection.getRangeAt(0);
    const item = richListItemFromRange(range);
    if (!item) return false;
    const lineInfo = richListSoftLineInfo(item, range);
    if (shouldUseNativeListSoftLineArrow(item, range, event.key)) return false;
    const direction = event.key === 'ArrowDown' ? 'next' : 'previous';
    const nextItem = adjacentRichListItem(item, direction);
    if (!nextItem) return false;
    event.preventDefault();
    const caretColumn = lineInfo?.column ?? richListCaretTextOffset(item, range);
    if (!placeCaretInListItemSoftLine(nextItem, direction === 'previous' ? 'last' : 'first', caretColumn)) {
      placeCaretInListItemAtTextOffset(nextItem, richListCaretTextOffset(item, range));
    }
    return true;
  }

  function shouldUseNativeListSoftLineArrow(item, range, key) {
    const lineInfo = richListSoftLineInfo(item, range);
    if (!lineInfo || lineInfo.lineCount <= 1) return false;
    if (key === 'ArrowUp') return lineInfo.lineIndex > 0;
    if (key === 'ArrowDown') return lineInfo.lineIndex < lineInfo.lineCount - 1;
    return false;
  }

  function richListSoftLineInfo(item, range) {
    const lineCount = listItemSoftLineBreakCount(item) + 1;
    if (lineCount <= 1) return null;
    const before = document.createRange();
    before.selectNodeContents(item);
    try {
      before.setEnd(range.startContainer, range.startOffset);
    } catch (_) {
      return null;
    }
    const caretLine = softLinePositionFromFragment(before.cloneContents());
    return {
      lineCount,
      lineIndex: Math.max(0, Math.min(lineCount - 1, caretLine.lineIndex)),
      column: caretLine.column,
    };
  }

  function listItemSoftLineBreakCount(item) {
    const range = document.createRange();
    range.selectNodeContents(item);
    range.setEnd(item, listItemContentEndOffset(item));
    return range.cloneContents().querySelectorAll('br').length;
  }

  function softLinePositionFromFragment(fragment) {
    let lineIndex = 0;
    let column = 0;
    const visit = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        column += normalizeRichText(node.nodeValue || '').length;
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      if (node.tagName?.toLowerCase() === 'br') {
        lineIndex += 1;
        column = 0;
        return;
      }
      Array.from(node.childNodes).forEach(visit);
    };
    Array.from(fragment.childNodes).forEach(visit);
    return { lineIndex, column };
  }

  function placeCaretInListItemSoftLine(item, targetLine, column = 0) {
    const lineCount = listItemSoftLineBreakCount(item) + 1;
    const lineIndex = targetLine === 'last' ? lineCount - 1 : 0;
    const position = findListItemSoftLinePosition(item, lineIndex, Math.max(0, column || 0));
    if (!position) return false;
    const range = document.createRange();
    if (position.beforeNode) {
      range.setStartBefore(position.beforeNode);
    } else if (position.afterNode) {
      range.setStartAfter(position.afterNode);
    } else {
      range.setStart(position.node, position.offset);
    }
    range.collapse(true);
    const selection = window.getSelection?.();
    if (!selection) return false;
    selection.removeAllRanges();
    selection.addRange(range);
    els.rich.focus();
    return true;
  }

  function findListItemSoftLinePosition(item, targetLine, targetColumn) {
    const childNodes = Array.from(item.childNodes).slice(0, listItemContentEndOffset(item)).filter((child) => !(
      child.nodeType === Node.ELEMENT_NODE && child.classList.contains('task-checkbox')
    ));
    let lineIndex = 0;
    let column = 0;
    let lastPosition = null;
    let found = null;

    const visit = (node) => {
      if (found) return;
      if (node.nodeType === Node.TEXT_NODE) {
        if (lineIndex === targetLine) {
          const text = node.nodeValue || '';
          const length = normalizeRichText(text).length;
          if (column + length >= targetColumn) {
            found = { node, offset: Math.max(0, Math.min(text.length, targetColumn - column)) };
            return;
          }
          lastPosition = { node, offset: text.length };
        }
        column += normalizeRichText(node.nodeValue || '').length;
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      if (node.tagName?.toLowerCase() === 'br') {
        if (lineIndex === targetLine && !found) {
          found = lastPosition || { beforeNode: node };
          return;
        }
        lineIndex += 1;
        column = 0;
        lastPosition = null;
        return;
      }
      Array.from(node.childNodes).forEach(visit);
    };

    childNodes.forEach(visit);
    if (found) return found;
    return lineIndex === targetLine ? lastPosition || { node: item, offset: item.childNodes.length } : null;
  }

  function handleRichLineBoundaryArrow(event) {
    if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return false;
    if (event.target.closest?.('.rich-source-editor, .code-language-input')) return false;
    const selection = window.getSelection?.();
    if (!selection || !selection.rangeCount || !selection.isCollapsed || !els.rich.contains(selection.anchorNode)) return false;
    if (nodeClosest(selection.anchorNode, '.rich-inline-source')) return false;

    const range = selection.getRangeAt(0);
    const block = richCaretBlockFromRange(range);
    if (!block) return false;

    const offset = richCaretBlockTextOffset(block, range);
    const length = richCaretBlockTextLength(block);
    const target = event.key === 'ArrowRight' && offset >= length
      ? adjacentRichCaretBlock(block, 'next')
      : event.key === 'ArrowLeft' && offset <= 0
        ? adjacentRichCaretBlock(block, 'previous')
        : null;
    if (!target) return false;

    event.preventDefault();
    cleanupRichCaretBoundaryMarkers({ preserveSelection: false });
    if (target.tagName?.toLowerCase() === 'li') {
      if (event.key === 'ArrowRight') {
        placeCaretAtListItemStart(target);
      } else {
        placeCaretAtListItemEnd(target);
      }
    } else if (event.key === 'ArrowRight') {
      placeCaretAtStart(target);
    } else {
      placeCaretAtEnd(target);
    }
    suppressRichInlineActivation();
    return true;
  }

  function richCaretBlockFromRange(range) {
    const block = nodeClosest(range.startContainer, RICH_INLINE_EDIT_BLOCK_SELECTOR);
    if (!block || !els.rich.contains(block)) return null;
    if (block.closest('.rich-source-editor, .mermaid-diagram, pre.code-block, .math-display, .toc')) return null;
    return block;
  }

  function richCaretBlockTextOffset(block, range) {
    const before = document.createRange();
    before.selectNodeContents(block);
    try {
      before.setEnd(range.startContainer, range.startOffset);
      if (block.tagName?.toLowerCase() === 'li') {
        const end = listItemContentEndOffset(block);
        const full = document.createRange();
        full.selectNodeContents(block);
        full.setEnd(block, end);
        if (before.compareBoundaryPoints(Range.END_TO_END, full) > 0) {
          return richCaretBlockTextLength(block);
        }
      }
    } catch (_) {
      return 0;
    }
    return normalizeRichText(before.toString()).length;
  }

  function richCaretBlockTextLength(block) {
    const range = document.createRange();
    range.selectNodeContents(block);
    if (block.tagName?.toLowerCase() === 'li') {
      range.setEnd(block, listItemContentEndOffset(block));
    }
    return normalizeRichText(range.toString()).length;
  }

  function adjacentRichCaretBlock(block, direction) {
    const blocks = richCaretBlocksInDocumentOrder();
    const index = blocks.indexOf(block);
    if (index === -1) return null;
    return direction === 'next' ? blocks[index + 1] || null : blocks[index - 1] || null;
  }

  function richCaretBlocksInDocumentOrder() {
    const blocks = [];
    const walker = document.createTreeWalker(els.rich, NodeFilter.SHOW_ELEMENT, {
      acceptNode(node) {
        if (!node.matches?.(RICH_INLINE_EDIT_BLOCK_SELECTOR)) return NodeFilter.FILTER_SKIP;
        if (node.closest('.rich-source-editor, .mermaid-diagram, pre.code-block, .math-display, .toc')) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    while (walker.nextNode()) blocks.push(walker.currentNode);
    return blocks;
  }

  function adjacentRichListItem(item, direction) {
    const siblingProperty = direction === 'next' ? 'nextElementSibling' : 'previousElementSibling';
    let sibling = item[siblingProperty];
    while (sibling) {
      if (sibling.tagName?.toLowerCase() === 'li') return sibling;
      sibling = sibling[siblingProperty];
    }
    return null;
  }

  function richListCaretTextOffset(item, range) {
    const before = range.cloneRange();
    before.selectNodeContents(item);
    try {
      before.setEnd(range.startContainer, range.startOffset);
    } catch (_) {
      return 0;
    }
    return listFragmentVisibleText(before.cloneContents()).length;
  }

  function richListCaretSourceContentOffset(item, range) {
    const before = range.cloneRange();
    before.selectNodeContents(item);
    try {
      before.setEnd(range.startContainer, range.startOffset);
    } catch (_) {
      return 0;
    }
    return stripRichCaretTokens(serializeInlineNodes(Array.from(before.cloneContents().childNodes))).length;
  }

  function listFragmentVisibleText(fragment) {
    let text = '';
    const visit = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const raw = normalizeRichText(node.nodeValue || '');
        const beforeHardBreak = node.nextSibling?.nodeType === Node.ELEMENT_NODE
          && node.nextSibling.tagName?.toLowerCase() === 'br';
        text += beforeHardBreak ? raw.replace(/[ \t]{2}$/, '') : raw;
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      if (node.tagName?.toLowerCase() === 'br') {
        text += '\n';
        return;
      }
      Array.from(node.childNodes).forEach(visit);
    };
    Array.from(fragment.childNodes || []).forEach(visit);
    return text;
  }

  function placeCaretInListItemAtTextOffset(item, targetOffset) {
    const position = findListItemTextPosition(item, targetOffset);
    if (!position) {
      placeCaretAtListItemStart(item);
      return;
    }
    const range = document.createRange();
    range.setStart(position.node, position.offset);
    range.collapse(true);
    const selection = window.getSelection?.();
    if (!selection) return;
    selection.removeAllRanges();
    selection.addRange(range);
    els.rich.focus();
  }

  function findListItemTextPosition(item, targetOffset) {
    const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (nodeClosest(node, 'li') !== item) return NodeFilter.FILTER_REJECT;
        if (node.parentElement?.closest('.rich-source-editor, .code-language-input')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let consumed = 0;
    let last = null;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      last = node;
      const length = normalizeRichText(node.nodeValue || '').length;
      if (consumed + length >= targetOffset) {
        return { node, offset: Math.max(0, Math.min(node.nodeValue.length, targetOffset - consumed)) };
      }
      consumed += length;
    }
    return last ? { node: last, offset: last.nodeValue.length } : null;
  }

  function handleRichListEnter(item, range) {
    const list = item.closest('ul, ol');
    if (!list) return;

    if (handleRichListEnterTransaction(item, range, list)) return;
    if (guardFailedRichSourceControlTransaction(list, 'rich-list-enter', 'リスト項目を分割できませんでした')) return;

    if (isRichListItemEmpty(item)) {
      exitRichListItem(item, list);
      syncRichMarkdownFromDom('rich-input');
      return;
    }

    const nextItem = createEmptyListItemLike(item, list);
    const tail = extractListItemTail(item, range);
    appendListItemTail(nextItem, tail);
    ensureListItemEditablePlaceholder(item);
    item.after(nextItem);
    placeCaretAtListItemStart(nextItem);
    syncRichMarkdownFromDom('rich-input');
  }

  function handleRichListEnterTransaction(item, range, list) {
    if (!range?.collapsed || !list?.matches?.(RICH_SOURCE_BLOCK_SELECTOR)) return false;
    if (item.parentElement !== list) return false;
    if (item.querySelector('.rich-inline-source')) return false;
    const blockStart = numericData(list, 'sourceStart');
    const blockEnd = numericData(list, 'sourceEnd');
    const raw = stripRichCaretTokens(state.markdown || '').slice(blockStart, blockEnd);
    const sourceItems = flatListSourceItems(raw);
    const items = Array.from(list.children).filter((child) => child.tagName?.toLowerCase() === 'li');
    const itemIndex = items.indexOf(item);
    if (itemIndex < 0 || sourceItems.length !== items.length) return false;
    const sourceItem = sourceItems[itemIndex];
    const parsed = sourceItem?.parsed;
    if (!sourceItem || !parsed) return false;
    const content = visibleTextFromListSourceItem(sourceItem);

    if (isRichListItemEmpty(item)) {
      if (content.trim() !== '') return false;
      const from = blockStart + sourceItem.start;
      const to = blockStart + sourceItem.end;
      return applySourceTransaction({
        from,
        to,
        insert: '\n',
        blankParagraphAt: from + 1,
        selectionAfter: {
          anchor: from + 1,
          focus: from + 1,
          affinity: 'after',
        },
      }, 'rich-list-exit');
    }

    const serialized = visibleListItemText(item);
    if (content !== serialized) return false;

    const caretOffset = Math.max(0, Math.min(content.length, richListCaretSourceContentOffset(item, range)));
    const currentSource = listItemSourceFromText(parsed.prefix, parsed, content.slice(0, caretOffset));
    const nextPrefix = nextListSourcePrefix(parsed);
    const nextSource = listItemSourceFromText(nextPrefix, parsed, content.slice(caretOffset));
    const from = blockStart + sourceItem.start;
    const to = blockStart + listSourceItemTextEnd(sourceItem);
    const insert = `${currentSource}\n${nextSource}`;
    const nextCaret = caretOffset === 0
      ? from + parsed.prefix.length
      : from + currentSource.length + 1 + nextPrefix.length;
    return applySourceTransaction({
      from,
      to,
      insert,
      selectionAfter: {
        anchor: nextCaret,
        focus: nextCaret,
        affinity: 'after',
      },
    }, 'rich-list-enter');
  }

  function listItemSourceFromText(firstPrefix, parsed, text) {
    const lines = String(text || '').split('\n');
    const continuationPrefix = `${parsed?.indent || ''}  `;
    return lines.map((line, index) => `${index === 0 ? firstPrefix : continuationPrefix}${line}`).join('\n');
  }

  function listSourceItemTextEnd(sourceItem) {
    const lastLine = sourceItem?.lines?.[sourceItem.lines.length - 1];
    if (!lastLine) return sourceItem?.end || 0;
    return lastLine.start + String(lastLine.text || '').length;
  }

  function parseFlatListSourceLine(line) {
    const match = String(line || '').match(/^(\s*)([-+*]|\d+\.)(\s+)(?:\[([ xX])\](\s+))?/);
    if (!match) return null;
    const marker = match[2];
    const ordered = /^\d+\.$/.test(marker);
    const number = ordered ? Number.parseInt(marker, 10) : null;
    return {
      indent: match[1] || '',
      marker,
      ordered,
      number,
      task: match[4] !== undefined,
      prefix: match[0],
    };
  }

  function flatListSourceItems(raw) {
    const sourceItems = [];
    let current = null;
    for (const line of getLines(raw).filter((item) => item.text.trim() !== '')) {
      const parsed = parseFlatListSourceLine(line.text);
      if (parsed) {
        current = {
          start: line.start,
          end: line.end,
          parsed,
          lines: [line],
        };
        sourceItems.push(current);
        continue;
      }
      if (!current) continue;
      current.lines.push(line);
      current.end = line.end;
    }
    return sourceItems;
  }

  function visibleTextFromListSourceItem(sourceItem) {
    if (!sourceItem?.lines?.length) return '';
    return sourceItem.lines.map((line, index) => {
      const prefixLength = index === 0
        ? sourceItem.parsed.prefix.length
        : listContinuationPrefixLength(line.text, sourceItem.parsed);
      return line.text.slice(prefixLength).replace(/[ \t]{2}$/, '');
    }).join('\n');
  }

  function listContinuationPrefixLength(line, parsed) {
    const expected = `${parsed?.indent || ''}  `;
    if (String(line || '').startsWith(expected)) return expected.length;
    const match = String(line || '').match(/^\s*/);
    return match ? match[0].length : 0;
  }

  function sourceOffsetFromListItemTextOffset(sourceItem, textOffset) {
    const target = Math.max(0, Number(textOffset) || 0);
    let consumed = 0;
    for (let index = 0; index < sourceItem.lines.length; index += 1) {
      const line = sourceItem.lines[index];
      const prefixLength = index === 0
        ? sourceItem.parsed.prefix.length
        : listContinuationPrefixLength(line.text, sourceItem.parsed);
      const visible = line.text.slice(prefixLength).replace(/[ \t]{2}$/, '');
      if (target <= consumed + visible.length) {
        return line.start + prefixLength + (target - consumed);
      }
      consumed += visible.length;
      if (index < sourceItem.lines.length - 1) {
        if (target <= consumed + 1) {
          const nextLine = sourceItem.lines[index + 1];
          return nextLine.start + listContinuationPrefixLength(nextLine.text, sourceItem.parsed);
        }
        consumed += 1;
      }
    }
    const lastLine = sourceItem.lines[sourceItem.lines.length - 1];
    const lastPrefix = sourceItem.lines.length === 1
      ? sourceItem.parsed.prefix.length
      : listContinuationPrefixLength(lastLine.text, sourceItem.parsed);
    return lastLine.start + lastPrefix + lastLine.text.slice(lastPrefix).length;
  }

  function textOffsetFromListItemSourceOffset(sourceItem, localOffset) {
    const target = Math.max(sourceItem.start, Math.min(sourceItem.end, Number(localOffset) || 0));
    let consumed = 0;
    for (let index = 0; index < sourceItem.lines.length; index += 1) {
      const line = sourceItem.lines[index];
      const prefixLength = index === 0
        ? sourceItem.parsed.prefix.length
        : listContinuationPrefixLength(line.text, sourceItem.parsed);
      const visible = line.text.slice(prefixLength).replace(/[ \t]{2}$/, '');
      const contentStart = line.start + prefixLength;
      const contentEnd = contentStart + visible.length;
      if (target <= contentStart) return consumed;
      if (target <= contentEnd) return consumed + (target - contentStart);
      consumed += visible.length;
      if (index < sourceItem.lines.length - 1) consumed += 1;
    }
    return consumed;
  }

  function nextListSourcePrefix(parsed) {
    const marker = parsed.ordered ? `${(parsed.number || 1) + 1}.` : parsed.marker;
    const base = `${parsed.indent}${marker} `;
    return parsed.task ? `${base}[ ] ` : base;
  }

  function visibleListItemText(item) {
    return stripRichCaretTokens(normalizeRichText(serializeInlineNodes(listItemEditableContentNodes(item)))).replace(/[ \t]{2}\n/g, '\n');
  }

  function createEmptyListItemLike(item, list) {
    const nextItem = document.createElement('li');
    if (item.classList.contains('task-list-item') || list.classList.contains('task-list')) {
      nextItem.className = 'task-list-item';
      nextItem.appendChild(createTaskCheckbox());
    }
    return nextItem;
  }

  function extractListItemTail(item, range) {
    const tailRange = document.createRange();
    tailRange.setStart(range.startContainer, range.startOffset);
    tailRange.setEnd(item, listItemContentEndOffset(item));
    const fragment = tailRange.extractContents();
    fragment.querySelectorAll?.('.task-checkbox').forEach((checkbox) => checkbox.remove());
    return fragment;
  }

  function listItemContentEndOffset(item) {
    const nestedListIndex = Array.from(item.childNodes).findIndex((child) => (
      child.nodeType === Node.ELEMENT_NODE && ['ul', 'ol'].includes(child.tagName.toLowerCase())
    ));
    return nestedListIndex === -1 ? item.childNodes.length : nestedListIndex;
  }

  function appendListItemTail(item, fragment) {
    if (isFragmentVisiblyEmpty(fragment)) {
      item.appendChild(document.createTextNode(''));
      item.appendChild(document.createElement('br'));
      return;
    }
    item.appendChild(fragment);
    ensureListItemEditablePlaceholder(item);
  }

  function ensureListItemEditablePlaceholder(item) {
    const contentNodes = listItemEditableContentNodes(item);
    if (contentNodes.length === 0 || areInlineNodesVisiblyEmpty(contentNodes)) {
      contentNodes.forEach((node) => node.remove());
      item.appendChild(document.createTextNode(''));
      item.appendChild(document.createElement('br'));
    }
  }

  function listItemEditableContentNodes(item) {
    return Array.from(item.childNodes).filter((child) => {
      if (child.nodeType !== Node.ELEMENT_NODE) return true;
      if (['ul', 'ol'].includes(child.tagName.toLowerCase())) return false;
      return !child.classList.contains('task-checkbox');
    });
  }

  function isFragmentVisiblyEmpty(fragment) {
    return areInlineNodesVisiblyEmpty(Array.from(fragment.childNodes));
  }

  function exitRichListItem(item, list) {
    const paragraph = document.createElement('p');
    paragraph.appendChild(document.createTextNode(''));
    paragraph.appendChild(document.createElement('br'));

    const afterList = document.createElement(list.tagName.toLowerCase());
    afterList.className = list.className;
    while (item.nextSibling) afterList.appendChild(item.nextSibling);

    list.after(paragraph);
    if (Array.from(afterList.children).some((child) => child.tagName?.toLowerCase() === 'li')) {
      paragraph.after(afterList);
    }

    item.remove();
    if (!Array.from(list.children).some((child) => child.tagName?.toLowerCase() === 'li')) {
      list.remove();
    }
    placeCaretAtStart(paragraph);
  }

  function isRichListItemEmpty(item) {
    const contentNodes = listItemEditableContentNodes(item);
    return areInlineNodesVisiblyEmpty(contentNodes);
  }

  function areInlineNodesVisiblyEmpty(nodes) {
    return !Array.from(nodes || []).some((node) => inlineNodeHasVisibleContent(node));
  }

  function inlineNodeHasVisibleContent(node) {
    if (!node) return false;
    if (node.nodeType === Node.TEXT_NODE) return normalizeRichText(node.nodeValue || '').replace(/\s+/g, '') !== '';
    if (node.nodeType !== Node.ELEMENT_NODE) return false;
    const element = node;
    if (element.classList.contains('rich-list-caret-anchor')) {
      return normalizeRichText(element.textContent || '').replace(/\u200b/g, '').replace(/\s+/g, '') !== '';
    }
    if (element.classList.contains('rich-line-break-caret-anchor')) {
      return normalizeRichText(element.textContent || '').replace(/\u200b/g, '').replace(/\s+/g, '') !== '';
    }
    if (element.classList.contains('task-checkbox') || element.classList.contains('code-language-input')) return false;
    const tag = element.tagName.toLowerCase();
    if (tag === 'br') return false;
    if (tag === 'img') return true;
    if (element.classList.contains('math-inline') || element.classList.contains('math-display')) {
      return Boolean(richSourceFromElement('math', element).trim());
    }
    return Array.from(element.childNodes).some((child) => inlineNodeHasVisibleContent(child));
  }

  function createTaskCheckbox() {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'task-checkbox';
    checkbox.setAttribute('contenteditable', 'false');
    return checkbox;
  }

  function placeCaretAtListItemStart(item) {
    const children = Array.from(item.childNodes);
    const offset = children.findIndex((child) => !(child.nodeType === 1 && child.classList.contains('task-checkbox')));
    const range = document.createRange();
    const child = offset === -1 ? null : children[offset];
    if (child?.nodeType === Node.TEXT_NODE) {
      range.setStart(child, 0);
    } else if (child) {
      range.setStartBefore(child);
    } else {
      range.setStart(item, item.childNodes.length);
    }
    range.collapse(true);
    const selection = window.getSelection?.();
    if (!selection) return;
    selection.removeAllRanges();
    selection.addRange(range);
    els.rich.focus();
  }

  function placeCaretAtListItemEnd(item) {
    const position = findListItemTextPosition(item, Number.MAX_SAFE_INTEGER);
    const range = document.createRange();
    if (position) {
      range.setStart(position.node, position.offset);
    } else {
      range.selectNodeContents(item);
      range.collapse(false);
    }
    range.collapse(true);
    const selection = window.getSelection?.();
    if (!selection) return;
    selection.removeAllRanges();
    selection.addRange(range);
    els.rich.focus();
  }

  function insertRichLineBreak() {
    const selection = window.getSelection?.();
    const range = richSelectionRange(selection);
    if (!range) return false;
    return insertRichLineBreakAtRange(range);
  }

  function handleRichLineBreakTransaction(options = {}) {
    const selection = window.getSelection?.();
    const replacementRange = richLineBreakTransactionRangeFromSelection(selection);
    if (!replacementRange) return false;
    if (options.pushUndo) pushRichUndoSnapshot('line-break');
    const insert = richLineBreakInsertForSelection(selection);
    const nextOffset = replacementRange.from + insert.length;
    applySourceTransaction({
      from: replacementRange.from,
      to: replacementRange.to,
      insert,
      selectionAfter: {
        anchor: nextOffset,
        focus: nextOffset,
        affinity: 'after',
      },
    }, 'rich-line-break');
    suppressRichInlineActivation();
    return true;
  }

  function richLineBreakTransactionRangeFromSelection(selection) {
    const tableRange = richTableTextReplacementRangeFromSelection(selection);
    const quoteRange = tableRange ? null : richQuoteTextReplacementRangeFromSelection(selection);
    const rawRange = tableRange || quoteRange || richPlainTextTransactionRangeFromSelection(selection);
    if (!rawRange) return null;
    const range = rawRange.from !== rawRange.to
      ? expandSourceRangeToIntersectingInlineAtoms(rawRange)
      : rawRange;
    if (!Number.isFinite(range.from) || !Number.isFinite(range.to) || range.to < range.from) return null;
    return range;
  }

  function richLineBreakInsertForSelection(selection) {
    const cell = nodeClosest(selection?.anchorNode, 'td, th');
    const focusCell = nodeClosest(selection?.focusNode, 'td, th');
    if (cell && cell === focusCell && els.rich.contains(cell)) return '<br>';

    const quote = nodeClosest(selection?.anchorNode, 'blockquote');
    const focusQuote = nodeClosest(selection?.focusNode, 'blockquote');
    if (quote && quote === focusQuote && els.rich.contains(quote)) return '  \n> ';

    const item = nodeClosest(selection?.anchorNode, 'li');
    const focusItem = nodeClosest(selection?.focusNode, 'li');
    if (!item || item !== focusItem || !els.rich.contains(item)) return '  \n';
    const list = item.closest('ul, ol');
    if (!list?.matches?.(RICH_SOURCE_BLOCK_SELECTOR) || item.parentElement !== list) return '  \n';
    const blockStart = numericData(list, 'sourceStart');
    const blockEnd = numericData(list, 'sourceEnd');
    if (!Number.isFinite(blockStart) || !Number.isFinite(blockEnd)) return '  \n';
    const raw = stripRichCaretTokens(state.markdown || '').slice(blockStart, blockEnd);
    const sourceItems = flatListSourceItems(raw);
    const items = Array.from(list.children).filter((child) => child.tagName?.toLowerCase() === 'li');
    const sourceItem = sourceItems[items.indexOf(item)];
    return sourceItem?.parsed ? `  \n${sourceItem.parsed.indent}  ` : '  \n';
  }

  function handleRichTableCellLineBreakTransaction(cell, range) {
    if (!range?.collapsed || !cell?.matches?.('td, th')) return false;
    const point = richTableSourcePointFromRange(cell, range);
    if (!point) return false;
    const insert = '<br>';
    return applySourceTransaction({
      from: point.offset,
      to: point.offset,
      insert,
      selectionAfter: {
        anchor: point.offset + insert.length,
        focus: point.offset + insert.length,
        affinity: 'after',
      },
    }, 'rich-table-cell-line-break');
  }

  function handleRichQuoteEnterTransaction(blockquote, range) {
    if (!range?.collapsed || !blockquote?.matches?.('blockquote')) return false;
    const point = richQuoteSourcePointFromRange(blockquote, range);
    if (!point) return false;
    const insert = '\n> ';
    return applySourceTransaction({
      from: point.offset,
      to: point.offset,
      insert,
      selectionAfter: {
        anchor: point.offset + insert.length,
        focus: point.offset + insert.length,
        affinity: 'after',
      },
    }, 'rich-quote-enter');
  }

  function handleRichQuoteLineBreakTransaction(blockquote, range) {
    if (!range?.collapsed || !blockquote?.matches?.('blockquote')) return false;
    const point = richQuoteSourcePointFromRange(blockquote, range);
    if (!point) return false;
    const insert = '  \n> ';
    return applySourceTransaction({
      from: point.offset,
      to: point.offset,
      insert,
      selectionAfter: {
        anchor: point.offset + insert.length,
        focus: point.offset + insert.length,
        affinity: 'after',
      },
    }, 'rich-quote-line-break');
  }

  function insertRichLineBreakAtRange(range) {
    const selection = window.getSelection?.();
    if (!selection || !range || !els.rich.contains(range.startContainer) || !els.rich.contains(range.endContainer)) return false;
    if (guardUnsupportedRichLineBreakFallback(range)) return false;
    range.deleteContents();
    const br = document.createElement('br');
    range.insertNode(br);
    const marker = document.createTextNode('\u200b');
    br.after(marker);
    range.setStart(marker, marker.nodeValue.length);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  }

  function guardUnsupportedRichLineBreakFallback(range) {
    if (!range || !els.rich.contains(range.startContainer)) return false;
    if (!richRangeTouchesSourceBlock(range)) return false;
    setStatus('この位置では改行できません');
    suppressRichInlineActivation();
    return true;
  }

  function placeCaretAtStart(element) {
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(true);
    const selection = window.getSelection?.();
    if (!selection) return;
    selection.removeAllRanges();
    selection.addRange(range);
    els.rich.focus();
  }

  function placeCaretAtEnd(element) {
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    const selection = window.getSelection?.();
    if (!selection) return;
    selection.removeAllRanges();
    selection.addRange(range);
    els.rich.focus();
  }

  function newDocument() {
    if (requestDesktopCommand('new')) return;
    if (!confirmDocumentReplacement('新規文書')) return;
    clearAssetUrls();
    state.markdown = '# 無題\n\nここにMarkdownを書いてください。\n';
    state.fileName = 'untitled.md';
    state.directoryHandle = null;
    state.directoryName = '';
    state.markdownRelativePath = '';
    state.fileHandle = null;
    clearPersistedDirectoryHandle();
    state.dirty = false;
    els.source.value = state.markdown;
    syncCodeMirrorSourceFromTextarea('new-document');
    renderAll('new');
    persistDraft();
    setStatus('新規文書を作成しました');
  }

  function confirmDocumentReplacement(nextDocumentLabel) {
    if (!state.dirty) return true;
    return confirm(`未保存の変更があります。${nextDocumentLabel}に切り替えますか？`);
  }

  async function openMarkdownFile() {
    if (requestDesktopCommand('open')) return;
    if (window.showOpenFilePicker) {
      let fileHandle = null;
      try {
        [fileHandle] = await showOpenFilePickerFromRecentDirectory({
          id: 'pme-open-md',
          multiple: false,
          types: [{
            description: 'Markdown',
            accept: {
              'text/markdown': ['.md', '.markdown'],
              'text/plain': ['.txt'],
            },
          }],
        });
      } catch (error) {
        handlePickerError(error, 'ファイル選択を開始できませんでした');
        return;
      }

      if (!fileHandle) return;
      try {
        const file = await fileHandle.getFile();
        await openSingleMarkdownFile(file, { fileHandle });
      } catch (error) {
        warnSafeError('open markdown file read failed', error);
        setStatus('ファイルの読み込みに失敗しました');
        return;
      }
      return;
    }

    els.fileInput.click();
  }

  async function showOpenFilePickerFromRecentDirectory(options = {}) {
    const pickerOptions = pickerOptionsWithCurrentStartDirectory(options, { preferMarkdownDirectory: true });
    try {
      return await window.showOpenFilePicker(pickerOptions);
    } catch (error) {
      if (pickerOptions.startIn && isPickerStartInError(error)) {
        warnSafeError('open picker startIn failed', error);
        const { startIn, ...fallbackOptions } = pickerOptions;
        return window.showOpenFilePicker(fallbackOptions);
      }
      throw error;
    }
  }

  async function showDirectoryPickerFromRecentDirectory(options = {}, picker = {}) {
    const pickerOptions = pickerOptionsWithCurrentStartDirectory(options, { preferMarkdownDirectory: true, ...picker });
    try {
      return await window.showDirectoryPicker(pickerOptions);
    } catch (error) {
      if (pickerOptions.startIn && isPickerStartInError(error)) {
        warnSafeError('directory picker startIn failed', error);
        if (picker.startInHandle) {
          const recentOptions = pickerOptionsWithCurrentStartDirectory(options, { preferMarkdownDirectory: true });
          if (recentOptions.startIn && recentOptions.startIn !== pickerOptions.startIn) {
            try {
              return await window.showDirectoryPicker(recentOptions);
            } catch (recentError) {
              if (!isPickerStartInError(recentError)) throw recentError;
              warnSafeError('directory picker recent startIn failed', recentError);
            }
          }
        }
        const { startIn, ...fallbackOptions } = pickerOptions;
        return window.showDirectoryPicker(fallbackOptions);
      }
      throw error;
    }
  }

  function pickerOptionsWithCurrentStartDirectory(options = {}, picker = {}) {
    const pickerOptions = { ...options };
    const startIn = picker.startInHandle || currentPickerStartDirectory(Boolean(picker.preferMarkdownDirectory));
    if (startIn) pickerOptions.startIn = startIn;
    return pickerOptions;
  }

  function currentPickerStartDirectory(preferMarkdownDirectory) {
    if (preferMarkdownDirectory && state.directoryHandle) return state.directoryHandle;
    if (state.directoryHandle) return state.directoryHandle;
    return state.pickerStartDirectoryHandle || null;
  }

  function isPickerStartInError(error) {
    return error instanceof TypeError || error?.name === 'TypeError' || /startIn/i.test(String(error?.message || ''));
  }

  function isPickerAbortError(error) {
    return error?.name === 'AbortError';
  }

  function handlePickerError(error, message) {
    if (isPickerAbortError(error)) return false;
    warnSafeError(message, error);
    setStatus(message);
    return true;
  }

  function warnSafeError(context, error) {
    if (!window.console?.warn) return;
    const name = String(error?.name || 'Error').slice(0, 80);
    const message = String(error?.message || '').replace(/[A-Za-z]:\\[^\s"'<>]+/g, '[path]').slice(0, 240);
    const detail = message ? `${name}: ${message}` : name;
    window.console.warn(`[PME] ${context}: ${detail}`);
  }

  async function onFileChosen(event) {
    const [file] = event.target.files || [];
    event.target.value = '';
    if (!file) return;
    await openSingleMarkdownFile(file);
  }

  async function openSingleMarkdownFile(file, options = {}) {
    if (file.size > 10 * 1024 * 1024) {
      setStatus('10MBを超えるファイルは読み込みません');
      return;
    }
    if (!confirmDocumentReplacement('選択したファイル')) return;

    try {
      const text = await readTextFile(file);
      const previousDirectoryHandle = state.directoryHandle;
      state.markdown = normalizeNewlines(text);
      state.fileName = safeFileName(file.name || 'untitled.md');
      state.fileHandle = options.fileHandle || null;
      state.dirty = false;
      clearAssetUrls();
      state.directoryHandle = null;
      state.directoryName = '';
      state.markdownRelativePath = '';
      els.source.value = state.markdown;
      syncCodeMirrorSourceFromTextarea('open-file');
      renderAll('open');
      persistDraft();
      setStatus(`${state.fileName} を開きました`);

      if (await attachPreviouslyGrantedDirectoryToOpenedMarkdown(file, options.fileHandle || null, previousDirectoryHandle)) {
        return;
      }

      await clearPersistedDirectoryHandle();
      await requestDirectoryForOpenedMarkdown(file, options.fileHandle || null);
    } catch (error) {
      warnSafeError('open single markdown failed', error);
      setStatus('ファイルの読み込みに失敗しました');
    }
  }

  async function attachPreviouslyGrantedDirectoryToOpenedMarkdown(file, fileHandle, directoryHandleOverride = null) {
    if (!fileHandle?.isSameEntry) return false;
    const directoryHandle = directoryHandleOverride || state.directoryHandle || await readPersistedDirectoryHandle();
    if (!directoryHandle) return false;
    try {
      const permission = await queryDirectoryPermission(directoryHandle, 'readwrite');
      if (permission !== 'granted') return false;
      const entries = await collectLimitedDirectoryEntries(directoryHandle);
      const chosen = await findOpenedMarkdownEntry(entries, file, fileHandle);
      if (!chosen) return false;

      state.markdownRelativePath = normalizeAssetPath(chosen.relativePath || chosen.file.name || state.fileName);
      state.directoryHandle = directoryHandle;
      state.pickerStartDirectoryHandle = directoryHandle;
      state.directoryName = directoryHandle.name || '';
      state.fileHandle = chosen.handle || fileHandle || null;
      clearAssetUrls();
      buildFolderAssetUrls(entries, dirnamePath(state.markdownRelativePath));
      await persistDirectoryHandle(directoryHandle);
      await rememberPickerStartDirectory(directoryHandle);
      renderAll('open-file-existing-folder');
      persistDraft();
      setStatus(`${state.fileName} を開きました。既存のフォルダ許可を使用しています (${state.directoryName || 'selected folder'})。画像候補: ${state.assetUrls.size}${folderScanStatusSuffix()}`);
      warnFolderScanLimitIfNeeded();
      return true;
    } catch (_) {
      return false;
    }
  }

  function readTextFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('ファイルの読み込みに失敗しました'));
      reader.readAsText(file, 'utf-8');
    });
  }

  async function requestDirectoryForOpenedMarkdown(file, fileHandle) {
    if (!window.showDirectoryPicker) return false;
    if (!confirm('相対画像の表示と画像挿入のため、開いたMarkdownファイルがあるフォルダの使用を許可しますか？')) {
      setStatus(`${state.fileName} を開きました。相対画像やassets保存には「フォルダ許可」または「フォルダから開く」を使ってください`);
      return false;
    }

    let directoryHandle = null;
    try {
      directoryHandle = await showDirectoryPickerFromRecentDirectory(
        { id: 'pme-md-folder', mode: 'readwrite' },
        { startInHandle: fileHandle || null }
      );
    } catch (error) {
      handlePickerError(error, 'フォルダ選択を開始できませんでした');
      return false;
    }

    try {
      return await attachDirectoryToOpenedMarkdown(file, fileHandle, directoryHandle);
    } catch (error) {
      warnSafeError('opened markdown folder read failed', error);
      setStatus('フォルダの読み込みに失敗しました');
      return false;
    }
  }

  async function attachDirectoryToOpenedMarkdown(file, fileHandle, directoryHandle) {
    const entries = await collectLimitedDirectoryEntries(directoryHandle);
    const chosen = await findOpenedMarkdownEntry(entries, file, fileHandle);
    if (!chosen) {
      setStatus(`${state.fileName} を開きました。選択フォルダ内に同じMarkdownファイルが見つかりませんでした${folderScanStatusSuffix()}`);
      warnFolderScanLimitIfNeeded();
      return false;
    }

    state.markdownRelativePath = normalizeAssetPath(chosen.relativePath || chosen.file.name || state.fileName);
    state.directoryHandle = directoryHandle;
    state.pickerStartDirectoryHandle = directoryHandle;
    state.directoryName = directoryHandle.name || '';
    state.fileHandle = chosen.handle || state.fileHandle || null;
    clearAssetUrls();
    buildFolderAssetUrls(entries, dirnamePath(state.markdownRelativePath));
    await persistDirectoryHandle(directoryHandle);
    await rememberPickerStartDirectory(directoryHandle);
    renderAll('open-file-folder');
    persistDraft();
    setStatus(`${state.fileName} を開きました。フォルダ参照を許可済み (${state.directoryName || 'selected folder'})。画像候補: ${state.assetUrls.size}${folderScanStatusSuffix()}`);
    warnFolderScanLimitIfNeeded();
    return true;
  }

  async function findOpenedMarkdownEntry(entries, file, fileHandle) {
    if (fileHandle?.isSameEntry) {
      for (const entry of entries) {
        if (!entry.handle?.isSameEntry) continue;
        try {
          if (await entry.handle.isSameEntry(fileHandle)) return entry;
        } catch (_) {}
      }
    }

    const candidates = entries.filter((entry) => (
      isMarkdownFile(entry.file)
      && entry.file.name === file.name
      && (!Number.isFinite(file.size) || entry.file.size === file.size)
    ));
    if (candidates.length === 1) return candidates[0];
    if (candidates.length > 1) return chooseMarkdownEntry(candidates);
    return null;
  }

  async function openFolder() {
    if (window.showDirectoryPicker) {
      let directoryHandle = null;
      try {
        directoryHandle = await showDirectoryPickerFromRecentDirectory({ id: 'pme-open-folder', mode: 'readwrite' });
      } catch (error) {
        handlePickerError(error, 'フォルダ選択を開始できませんでした');
        return;
      }

      try {
        const entries = await collectLimitedDirectoryEntries(directoryHandle);
        await openFolderEntries(entries, directoryHandle.name || 'selected folder', directoryHandle);
        return;
      } catch (error) {
        warnSafeError('open folder read failed', error);
        setStatus('フォルダの読み込みに失敗しました');
        return;
      }
    }
    state.folderInputMode = 'open';
    els.folderInput.click();
  }

  async function grantFolderForCurrentDocument() {
    captureCurrentMarkdownFromEditor();
    if (!state.fileName || state.fileName === 'untitled.md') {
      setStatus('先にMarkdownファイルを開くか、保存してファイル名を確定してください');
      return;
    }

    if (window.showDirectoryPicker) {
      let directoryHandle = null;
      try {
        directoryHandle = await showDirectoryPickerFromRecentDirectory({ id: 'pme-grant-folder', mode: 'readwrite' });
      } catch (error) {
        handlePickerError(error, 'フォルダ選択を開始できませんでした');
        return;
      }

      try {
        const entries = await collectLimitedDirectoryEntries(directoryHandle);
        await grantFolderEntriesForCurrentDocument(entries, directoryHandle.name || 'selected folder', directoryHandle);
        return;
      } catch (error) {
        warnSafeError('grant folder read failed', error);
        setStatus('フォルダ許可に失敗しました');
        return;
      }
    }

    state.folderInputMode = 'grant-current';
    els.folderInput.click();
  }

  async function grantFolderEntriesForCurrentDocument(entries, folderName, directoryHandle = null) {
    if (!entries.length) return;
    const chosen = await findCurrentMarkdownEntry(entries);
    if (!chosen) {
      setStatus(`${state.fileName} が選択フォルダ内に見つかりませんでした。編集中内容は変更していません${folderScanStatusSuffix()}`);
      warnFolderScanLimitIfNeeded();
      return;
    }

    const previousDirty = state.dirty;
    const previousMode = state.mode;
    const sourceSelection = sourceSelectionBookmark();
    const richBookmark = previousMode === 'rich' ? getRichCaretBookmark() : null;

    state.markdownRelativePath = normalizeAssetPath(chosen.relativePath || chosen.file.name || state.fileName);
    state.directoryHandle = directoryHandle;
    state.pickerStartDirectoryHandle = directoryHandle || state.pickerStartDirectoryHandle;
    state.directoryName = directoryHandle?.name || folderName || '';
    state.fileHandle = chosen.handle || state.fileHandle || null;
    clearAssetUrls();
    buildFolderAssetUrls(entries, dirnamePath(state.markdownRelativePath));
    if (directoryHandle) {
      await persistDirectoryHandle(directoryHandle);
      await rememberPickerStartDirectory(directoryHandle);
    } else {
      await clearPersistedDirectoryHandle();
    }
    els.source.value = state.markdown;
    syncCodeMirrorSourceFromTextarea('grant-folder');
    refreshAfterFolderGrant(previousMode, richBookmark, sourceSelection);
    state.dirty = previousDirty;
    persistDraft();
    state.dirty = previousDirty;
    updateStatusBar();
    const access = directoryHandle ? 'File System Access API' : 'フォルダ入力';
    setStatus(`${state.fileName} の編集中内容を維持したままフォルダを許可しました (${access})。画像候補: ${state.assetUrls.size}${folderScanStatusSuffix()}`);
    warnFolderScanLimitIfNeeded();
  }

  async function findCurrentMarkdownEntry(entries) {
    if (state.fileHandle?.isSameEntry) {
      for (const entry of entries) {
        if (!entry.handle?.isSameEntry) continue;
        try {
          if (await entry.handle.isSameEntry(state.fileHandle)) return entry;
        } catch (_) {}
      }
    }

    const currentRelative = normalizeAssetPath(state.markdownRelativePath || '');
    if (currentRelative) {
      const exact = entries.find((entry) => normalizeAssetPath(entry.relativePath || '') === currentRelative);
      if (exact) return exact;
    }

    const currentName = safeFileName(state.fileName || '');
    const candidates = entries.filter((entry) => isMarkdownFile(entry.file) && entry.file.name === currentName);
    if (candidates.length === 1) return candidates[0];
    if (candidates.length > 1) return chooseMarkdownEntry(candidates);
    return null;
  }

  function captureCurrentMarkdownFromEditor() {
    if (state.mode === 'rich' && isProseMirrorRichActive()) {
      state.markdown = normalizeNewlines(state.proseMirrorRich.markdown());
    } else {
      state.markdown = sourceMarkdownValue() || normalizeNewlines(state.markdown);
    }
    els.source.value = state.markdown;
    syncCodeMirrorSourceFromTextarea('capture-current');
  }

  function sourceSelectionBookmark() {
    if (isCodeMirrorSourceReady() && !state.codeMirrorSource.hasFocus()) return null;
    if (!isCodeMirrorSourceReady() && document.activeElement !== els.source) return null;
    const selection = sourceSelectionRange();
    const scroller = sourceScrollElement();
    return {
      start: selection.start,
      end: selection.end,
      scrollTop: scroller?.scrollTop || 0,
    };
  }

  function restoreSourceSelection(bookmark) {
    if (!bookmark) return;
    setSourceSelectionRange(bookmark.start, bookmark.end);
    const scroller = sourceScrollElement();
    if (scroller) scroller.scrollTop = bookmark.scrollTop || 0;
  }

  function refreshAfterFolderGrant(previousMode, richBookmark, sourceBookmark) {
    renderPreview();
    if (previousMode === 'rich') {
      renderRich();
      restoreRichCaret(richBookmark);
    } else if (previousMode === 'split' || previousMode === 'source') {
      renderRich();
      restoreSourceSelection(sourceBookmark);
    } else {
      renderRich();
    }
    renderOutline();
    updateStatusBar();
    applyOutlineVisibility();
  }

  function onFolderChosen(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;

    const context = createFolderScanContext();
    const entries = folderInputEntriesWithinLimits(files, context);
    state.folderScanLimitMessage = folderScanLimitMessage(context);
    const mode = state.folderInputMode;
    state.folderInputMode = 'open';
    if (mode === 'grant-current') {
      grantFolderEntriesForCurrentDocument(entries, '', null);
      return;
    }
    openFolderEntries(entries, '', null);
  }

  async function collectLimitedDirectoryEntries(directoryHandle) {
    const context = createFolderScanContext();
    const entries = await collectDirectoryEntries(directoryHandle, '', context, 0);
    state.folderScanLimitMessage = folderScanLimitMessage(context);
    return entries;
  }

  async function collectDirectoryEntries(directoryHandle, prefix = '', context = createFolderScanContext(), depth = 0) {
    const entries = [];
    const iterator = directoryHandle.entries ? directoryHandle.entries() : directoryHandle.values();
    for await (const item of iterator) {
      if (context.files >= MAX_FOLDER_SCAN_FILES) {
        context.fileLimitHit = true;
        break;
      }
      const handle = Array.isArray(item) ? item[1] : item;
      const name = Array.isArray(item) ? item[0] : handle.name;
      const relativePath = normalizeAssetPath(`${prefix}${name || handle.name || ''}`);
      if (handle.kind === 'file') {
        const file = await handle.getFile();
        entries.push(fileEntry(file, relativePath, handle));
        context.files += 1;
      } else if (handle.kind === 'directory') {
        if (depth >= MAX_FOLDER_SCAN_DEPTH) {
          context.depthLimitHit = true;
          continue;
        }
        entries.push(...await collectDirectoryEntries(handle, `${relativePath}/`, context, depth + 1));
      }
    }
    return entries;
  }

  function folderInputEntriesWithinLimits(files, context = createFolderScanContext()) {
    const entries = [];
    for (const file of files) {
      if (context.files >= MAX_FOLDER_SCAN_FILES) {
        context.fileLimitHit = true;
        break;
      }
      const relativePath = normalizeAssetPath(file.webkitRelativePath || file.name || '');
      const depth = Math.max(0, relativePath.split('/').filter(Boolean).length - 1);
      if (depth > MAX_FOLDER_SCAN_DEPTH) {
        context.depthLimitHit = true;
        continue;
      }
      entries.push(fileEntry(file));
      context.files += 1;
    }
    return entries;
  }

  function createFolderScanContext() {
    return { files: 0, fileLimitHit: false, depthLimitHit: false };
  }

  function folderScanLimitMessage(context) {
    if (!context?.fileLimitHit && !context?.depthLimitHit) return '';
    const limits = [];
    if (context.fileLimitHit) limits.push(`最大${MAX_FOLDER_SCAN_FILES.toLocaleString()}ファイル`);
    if (context.depthLimitHit) limits.push(`最大${MAX_FOLDER_SCAN_DEPTH}階層`);
    return `フォルダ走査上限（${limits.join('、')}）に達したため一部を読み飛ばしました`;
  }

  function folderScanStatusSuffix() {
    return state.folderScanLimitMessage ? `。${state.folderScanLimitMessage}` : '';
  }

  function warnFolderScanLimitIfNeeded() {
    if (!state.folderScanLimitMessage) return;
    const message = `${state.folderScanLimitMessage}。読み飛ばした範囲内のMarkdownファイルや画像は候補・表示対象になりません。必要なファイルに近いフォルダを選び直すと改善します。`;
    if (els.folderScanWarningDialog && els.folderScanWarningMessage && typeof els.folderScanWarningDialog.showModal === 'function') {
      els.folderScanWarningMessage.textContent = message;
      if (!els.folderScanWarningDialog.open) els.folderScanWarningDialog.showModal();
      return;
    }
    alert(`警告: ${message}`);
  }

  async function openFolderEntries(entries, folderName, directoryHandle = null) {
    if (!entries.length) return;

    const markdownEntries = entries.filter((entry) => isMarkdownFile(entry.file));
    if (!markdownEntries.length) {
      setStatus(`フォルダ内にMarkdownファイルがありません${folderScanStatusSuffix()}`);
      warnFolderScanLimitIfNeeded();
      return;
    }

    const chosen = await chooseMarkdownEntry(markdownEntries);
    if (!chosen) return;
    if (chosen.file.size > 10 * 1024 * 1024) {
      setStatus('10MBを超えるファイルは読み込みません');
      return;
    }
    if (!confirmDocumentReplacement('選択したファイル')) return;

    const reader = new FileReader();
    reader.onload = async () => {
      clearAssetUrls();
      state.markdown = normalizeNewlines(String(reader.result || ''));
      state.fileName = safeFileName(chosen.file.name || 'untitled.md');
      state.markdownRelativePath = normalizeAssetPath(chosen.relativePath || chosen.file.name || '');
      state.directoryHandle = directoryHandle;
      state.pickerStartDirectoryHandle = directoryHandle || state.pickerStartDirectoryHandle;
      state.directoryName = directoryHandle?.name || folderName || '';
      state.fileHandle = chosen.handle || null;
      buildFolderAssetUrls(entries, dirnamePath(state.markdownRelativePath));
      if (directoryHandle) {
        await persistDirectoryHandle(directoryHandle);
        await rememberPickerStartDirectory(directoryHandle);
      } else {
        await clearPersistedDirectoryHandle();
      }
      state.dirty = false;
      els.source.value = state.markdown;
      syncCodeMirrorSourceFromTextarea('open-folder');
      renderAll('open-folder');
      persistDraft();
      const count = state.assetUrls.size;
      const suffix = folderName ? ` (${folderName})` : '';
      const access = directoryHandle ? 'File System Access API' : 'フォルダ入力';
      const assetsHint = directoryHandle ? '。貼り付け/ドロップ画像はassetsフォルダに保存できます' : '';
      setStatus(`${state.fileName} をフォルダ基準で開きました${suffix} (${access})。画像候補: ${count}${assetsHint}${folderScanStatusSuffix()}`);
      warnFolderScanLimitIfNeeded();
    };
    reader.onerror = () => setStatus('ファイルの読み込みに失敗しました');
    reader.readAsText(chosen.file, 'utf-8');
  }

  async function onImageChosen(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;

    const insertionContext = state.pendingImageInsertionContext || createImageInsertionContext(event);
    state.pendingImageInsertionContext = null;
    await insertImageFilesAsAssets(files, insertionContext, '画像挿入');
  }

  function beginImageInsertion(event) {
    state.pendingImageInsertionContext = createImageInsertionContext(event);
    if (!state.pendingImageInsertionContext) return;
    if (guardUnsupportedImageInsertionContext(state.pendingImageInsertionContext, '画像挿入')) {
      state.pendingImageInsertionContext = null;
      return;
    }
    if (!hasImageAssetFolderContext('画像挿入')) {
      state.pendingImageInsertionContext = null;
      return;
    }
    els.imageInput.click();
  }

  function hasImageAssetFolderContext(actionLabel = '画像挿入') {
    if (state.desktopHost) {
      if (state.desktopDocumentReady) return true;
      setStatus(`${actionLabel}: 先にMarkdownファイルを保存してください`);
      return false;
    }
    if (!window.isSecureContext) {
      setStatus(`${actionLabel}: 画像をassetsフォルダに保存するには、localhostなどの安全なHTTP環境で開いてください`);
      return false;
    }
    if (!state.directoryHandle || !state.markdownRelativePath) {
      setStatus(`${actionLabel}: フォルダが許可されていないため画像を保存できません。「フォルダ許可」で現在のMarkdownがあるフォルダを許可してください`);
      return false;
    }
    return true;
  }

  async function saveMarkdown() {
    if (requestDesktopCommand('save')) return;
    if (await saveMarkdownToOpenedFile()) return;
    downloadMarkdown();
  }

  async function saveMarkdownToOpenedFile() {
    if (!state.directoryHandle || !state.markdownRelativePath) return false;
    if (!window.isSecureContext) {
      setStatus('上書き保存にはlocalhostなどの安全なHTTP環境が必要です。ダウンロード保存に切り替えます');
      return false;
    }
    if (!await ensureDirectoryPermission(state.directoryHandle, 'readwrite')) {
      setStatus('Markdownファイルの上書き保存に必要なフォルダ書き込み権限がありません。ダウンロード保存に切り替えます');
      return false;
    }

    try {
      const fileHandle = await markdownFileHandle();
      const writable = await fileHandle.createWritable();
      try {
        await writable.write(new Blob([state.markdown], { type: 'text/markdown;charset=utf-8' }));
      } finally {
        await writable.close();
      }
      state.dirty = false;
      persistDraft();
      updateStatusBar();
      setStatus(`${state.markdownRelativePath} に上書き保存しました`);
      return true;
    } catch (_) {
      setStatus('Markdownファイルの上書き保存に失敗しました。ダウンロード保存に切り替えます');
      return false;
    }
  }

  function downloadMarkdown() {
    const name = ensureExtension(state.fileName || 'untitled.md', '.md');
    downloadBlob(name, state.markdown, 'text/markdown;charset=utf-8');
    state.dirty = false;
    updateStatusBar();
    setStatus(`${name} をダウンロード保存しました`);
  }

  function exportHtml() {
    captureCurrentMarkdownFromEditor();
    const base = stripExtension(state.fileName || 'document');
    if (state.desktopHost) {
      postDesktopMessage({
        type: 'desktop.exportHtml',
        fileName: `${base}.html`,
        html: buildExportHtml(state.markdown, state.fileName),
      });
      return;
    }
    const html = buildExportHtml(state.markdown, state.fileName);
    downloadBlob(`${base}.html`, html, 'text/html;charset=utf-8');
    setStatus('安全化済みHTMLを書き出しました');
  }

  function printPreview() {
    renderPreview();
    if (requestDesktopCommand('print')) return;
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
    if (state.mode === 'rich' && applyProseMirrorFormat(format)) return;
    if (state.mode === 'rich') {
      guardReadOnlyRichFallbackAction('書式設定');
      return;
    }

    focusMarkdownInput();
    const selection = sourceSelectionRange();
    let start = selection.start;
    let end = selection.end;
    const sourceValue = sourceMarkdownValue();
    if (start === end && /^(?:paragraph|quote|list|ordered-list|h[1-6])$/.test(format)) {
      start = sourceValue.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
      const nextNewline = sourceValue.indexOf('\n', end);
      end = nextNewline < 0 ? sourceValue.length : nextNewline;
    }
    const selected = sourceValue.slice(start, end);
    let replacement = selected;
    let selectionStart = start;
    let selectionEnd = end;

    switch (format) {
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6': {
        const level = Number(format.slice(1));
        replacement = prefixLines((selected || '見出し').replace(/^\s{0,3}#{1,6}\s+/gm, ''), `${'#'.repeat(level)} `);
        break;
      }
      case 'paragraph':
        replacement = (selected || '段落').replace(/^\s{0,3}#{1,6}\s+/gm, '');
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
      case 'ordered-list':
        replacement = (selected || '項目').split('\n').map((line, index) => `${index + 1}. ${line}`).join('\n');
        break;
      case 'table':
        replacement = selected || '| 項目 | 内容 |\n| --- | --- |\n| 例 | テキスト |';
        break;
      case 'toc':
        replacement = selected || '[toc]';
        break;
      case 'math':
        replacement = `$${selected || 'x'}$`;
        selectionStart = start + 1;
        selectionEnd = selectionStart + (selected || 'x').length;
        break;
      default:
        return;
    }

    replaceSelection(replacement, selectionStart, selectionEnd);
  }

  function applyRichFormat(format) {
    switch (format) {
      case 'h1':
        if (applyRichBlockFormatTransaction('h1')) return true;
        replaceRichCurrentBlockWithHeading(1);
        return true;
      case 'h2':
        if (applyRichBlockFormatTransaction('h2')) return true;
        replaceRichCurrentBlockWithHeading(2);
        return true;
      case 'bold':
        if (applyRichInlineFormatTransaction('bold')) return true;
        insertRichInlineElement('strong', '太字');
        return true;
      case 'italic':
        if (applyRichInlineFormatTransaction('italic')) return true;
        insertRichInlineElement('em', '斜体');
        return true;
      case 'code': {
        const selected = richSelectedText();
        if (selected.includes('\n')) {
          insertRichMarkdownBlock(`\`\`\`\n${selected || 'code'}\n\`\`\``, 'コードブロックを挿入しました');
        } else {
          if (applyRichInlineFormatTransaction('code')) return true;
          insertRichInlineElement('code', 'code');
        }
        return true;
      }
      case 'quote':
        if (applyRichBlockFormatTransaction('quote')) return true;
        replaceRichCurrentBlockWithQuote();
        return true;
      case 'list':
        if (applyRichBlockFormatTransaction('list')) return true;
        replaceRichCurrentBlockWithList();
        return true;
      case 'table':
        insertRichMarkdownBlock('| 項目 | 内容 |\n| --- | --- |\n| 例 | テキスト |', '表を挿入しました');
        return true;
      case 'toc':
        insertRichMarkdownBlock('[toc]', '目次を挿入しました');
        return true;
      case 'math':
        if (insertRichInlineMarkdownSource(`$${richSelectedText() || 'x'}$`, 'インライン数式を挿入しました', {
          activateWhenCollapsed: true,
          selectionStart: 1,
          selectionEnd: 2,
        })) return true;
        insertRichInlineElement('span', 'x', { class: 'math-inline', 'data-math-source': 'x', 'data-math-display': 'false' });
        return true;
      default:
        return false;
    }
  }

  function applyRichBlockFormatTransaction(format) {
    const selection = window.getSelection?.();
    const range = richSelectionRange(selection);
    if (!range) return false;
    if (nodeClosest(selection.anchorNode, '.rich-inline-source, .rich-source-editor, .code-language-input')) {
      return guardUnsupportedRichBlockFormatContext(range);
    }
    const sourceBlock = richTextSourceBlockForFormat(range);
    if (!sourceBlock && applyRichListItemBlockFormatTransaction(format, range, selection)) return true;
    if (!sourceBlock && applyRichTrailingBlockFormatTransaction(format, range, selection)) return true;
    if (!sourceBlock && guardUnsupportedRichBlockFormatContext(range)) return true;
    if (!sourceBlock) return false;
    if (!selection.isCollapsed && richRangeExtendsOutsideSourceBlock(range, sourceBlock)) {
      setStatus('この選択はMarkdownソースへ変換できません');
      suppressRichInlineActivation();
      return true;
    }
    const start = numericData(sourceBlock, 'sourceStart');
    const end = numericData(sourceBlock, 'sourceEnd');
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return false;
    const raw = stripRichCaretTokens(state.markdown || '').slice(start, end);
    const selected = selection.isCollapsed ? '' : normalizeNewlines(selection.toString()).trim();
    const content = selected || richBlockSourceContentForFormat(raw, sourceBlock.dataset.blockType);
    const replacement = richBlockFormatReplacement(format, content);
    if (!replacement) return false;
    applySourceTransaction({
      from: start,
      to: end,
      insert: replacement,
      selectionAfter: {
        anchor: start + replacement.length,
        focus: start + replacement.length,
        affinity: 'after',
      },
    }, `rich-block-format-${format}`);
    setStatus(`${richBlockFormatLabel(format)}に変換しました`);
    return true;
  }

  function guardUnsupportedRichBlockFormatContext(range) {
    if (!range || !els.rich.contains(range.startContainer) || !els.rich.contains(range.endContainer)) return false;
    const blockedSelector = [
      'td',
      'th',
      'table',
      'pre.code-block',
      '.mermaid-diagram',
      '.math-display',
      '.toc',
      '.rich-inline-source',
      '.rich-source-editor',
      '.code-language-input',
    ].join(', ');
    const rangeNodes = [range.startContainer, range.endContainer, range.commonAncestorContainer].filter(Boolean);
    if (rangeNodes.some((node) => nodeClosest(node, blockedSelector)) || richRangeTouchesSourceBlock(range)) {
      setStatus('この位置ではブロック変換できません');
      suppressRichInlineActivation();
      return true;
    }
    return false;
  }

  function applyRichListItemBlockFormatTransaction(format, range, selection) {
    if (!['h1', 'h2', 'quote', 'list'].includes(format)) return false;
    const item = richListItemFromRange(range);
    if (!item || !els.rich.contains(item)) return false;
    if (!selection?.isCollapsed && nodeClosest(selection.focusNode, 'li') !== item) return false;
    const list = item.closest('ul, ol');
    if (!list?.matches?.(RICH_SOURCE_BLOCK_SELECTOR) || item.parentElement !== list) return false;
    const blockStart = numericData(list, 'sourceStart');
    const blockEnd = numericData(list, 'sourceEnd');
    if (!Number.isFinite(blockStart) || !Number.isFinite(blockEnd)) return false;
    const raw = stripRichCaretTokens(state.markdown || '').slice(blockStart, blockEnd);
    const sourceItems = flatListSourceItems(raw);
    const items = Array.from(list.children).filter((child) => child.tagName?.toLowerCase() === 'li');
    const itemIndex = items.indexOf(item);
    if (itemIndex < 0 || sourceItems.length !== items.length) return false;
    const sourceItem = sourceItems[itemIndex];
    if (!sourceItem?.parsed) return false;
    const sourceContent = visibleTextFromListSourceItem(sourceItem);
    if (sourceContent !== visibleListItemText(item)) return false;
    if (format === 'list') {
      setStatus('リスト項目です');
      suppressRichInlineActivation();
      return true;
    }

    const selected = selection?.isCollapsed ? '' : normalizeNewlines(selection.toString()).trim();
    const content = selected || sourceContent.trim() || '本文';
    const replacement = richBlockFormatReplacement(format, content);
    if (!replacement) return false;

    const hasPrevious = itemIndex > 0;
    const hasNext = itemIndex < sourceItems.length - 1;
    const insert = `${hasPrevious ? '\n' : ''}${replacement}${hasNext ? '\n\n' : ''}`;
    const from = blockStart + sourceItem.start;
    const to = blockStart + sourceItem.end;
    const selectionOffset = from + (hasPrevious ? 1 : 0) + replacement.length;
    applySourceTransaction({
      from,
      to,
      insert,
      selectionAfter: {
        anchor: selectionOffset,
        focus: selectionOffset,
        affinity: 'after',
      },
    }, `rich-list-item-block-format-${format}`);
    setStatus(`${richBlockFormatLabel(format)}に変換しました`);
    return true;
  }

  function applyRichTrailingBlockFormatTransaction(format, range, selection) {
    const trailing = nodeClosest(range?.startContainer, 'p[data-rich-trailing="true"]');
    if (!trailing || !els.rich.contains(trailing)) return false;
    const selected = selection?.isCollapsed ? '' : normalizeNewlines(selection.toString()).trim();
    const content = selected || normalizeRichText(trailing.textContent || '').trim();
    const replacement = richBlockFormatReplacement(format, content);
    if (!replacement) return false;
    const markdown = stripRichCaretTokens(state.markdown || els.source.value || '');
    const prefix = markdown.length ? '\n\n' : '';
    const insert = `${prefix}${replacement}`;
    const nextOffset = markdown.length + insert.length;
    applySourceTransaction({
      from: markdown.length,
      to: markdown.length,
      insert,
      selectionAfter: {
        anchor: nextOffset,
        focus: nextOffset,
        affinity: 'after',
      },
    }, `rich-trailing-block-format-${format}`);
    setStatus(`${richBlockFormatLabel(format)}に変換しました`);
    return true;
  }

  function richTextSourceBlockForFormat(range) {
    const block = nodeClosest(range.startContainer, RICH_SOURCE_BLOCK_SELECTOR);
    if (!block || !els.rich.contains(block)) return null;
    if (!['paragraph', 'heading', 'quote'].includes(block.dataset.blockType || '')) return null;
    if (!block.matches?.('p, h1, h2, h3, h4, h5, h6, blockquote')) return null;
    return block;
  }

  function richBlockSourceContentForFormat(raw, type) {
    const value = normalizeNewlines(raw || '').trim();
    if (type === 'heading') {
      return value.replace(/^\s*#{1,6}\s+/, '').replace(/\s+#*\s*$/, '').trim() || '見出し';
    }
    if (type === 'quote') {
      return value.split('\n')
        .map((line) => line.replace(/^\s*>\s?/, ''))
        .join('\n')
        .trim() || '引用文';
    }
    return value || '本文';
  }

  function richBlockFormatReplacement(format, content) {
    const lines = normalizeNewlines(content || '').split('\n');
    if (format === 'h1') return `# ${stripBlockMarkerMarkdown(lines.join(' ')) || '見出し'}`;
    if (format === 'h2') return `## ${stripBlockMarkerMarkdown(lines.join(' ')) || '見出し'}`;
    if (format === 'quote') {
      const body = lines.length ? lines : ['引用文'];
      return body.map((line) => `> ${line.trimEnd() || '引用文'}`).join('\n');
    }
    if (format === 'list') {
      const body = lines.length ? lines : ['項目'];
      return body.map((line) => `- ${line.trim() || '項目'}`).join('\n');
    }
    return '';
  }

  function stripBlockMarkerMarkdown(value) {
    return String(value || '')
      .replace(/^\s*>\s?/, '')
      .replace(/^\s*(?:[-+*]|\d+\.)\s+/, '')
      .trim();
  }

  function richBlockFormatLabel(format) {
    if (format === 'h1') return '見出し1';
    if (format === 'h2') return '見出し2';
    if (format === 'quote') return '引用';
    if (format === 'list') return '箇条書き';
    return 'ブロック';
  }

  function applyRichInlineFormatTransaction(format) {
    const selection = window.getSelection?.();
    const replacementRange = richInlineTransactionRangeFromSelection(selection);
    if (!replacementRange) return false;
    const spec = richInlineFormatSpec(format, state.markdown.slice(replacementRange.from, replacementRange.to));
    if (!spec) return false;
    const selected = state.markdown.slice(replacementRange.from, replacementRange.to);
    if (selected.includes('\n')) return false;
    const content = selected || spec.placeholder;
    const trailingPrefix = replacementRange.trailingParagraph && (state.markdown || '').length ? '\n\n' : '';
    const insert = `${trailingPrefix}${spec.open}${content}${spec.close}`;
    const sourceStart = replacementRange.from + trailingPrefix.length;
    const contentStart = sourceStart + spec.open.length;
    const contentEnd = contentStart + content.length;
    const activateInlineSource = replacementRange.from === replacementRange.to;
    applySourceTransaction({
      from: replacementRange.from,
      to: replacementRange.to,
      insert,
      selectionAfter: {
        anchor: activateInlineSource ? replacementRange.from + insert.length : contentEnd,
        focus: activateInlineSource ? replacementRange.from + insert.length : contentEnd,
        affinity: 'after',
      },
    }, `rich-format-${format}`);
    if (activateInlineSource) {
      activateInsertedInlineSource(sourceStart, replacementRange.from + insert.length, contentStart - sourceStart, contentEnd - sourceStart);
    }
    setStatus(`${spec.label}を挿入しました`);
    return true;
  }

  function richInlineFormatSpec(format, selected = '') {
    if (format === 'bold') {
      return { open: '**', close: '**', placeholder: '太字', label: '太字' };
    }
    if (format === 'italic') {
      return { open: '*', close: '*', placeholder: '斜体', label: '斜体' };
    }
    if (format === 'code') {
      if (String(selected || '').includes('`')) return null;
      return { open: '`', close: '`', placeholder: 'code', label: 'インラインコード' };
    }
    return null;
  }

  function richRangeExtendsOutsideSourceBlock(range, sourceBlock) {
    if (!range || !sourceBlock || !els.rich.contains(sourceBlock)) return false;
    if (!sourceBlock.contains(range.startContainer) || !sourceBlock.contains(range.endContainer)) return true;
    return richSourceBlocksIntersectingRange(range).some((block) => block !== sourceBlock);
  }

  function activateInsertedInlineSource(sourceStart, sourceEnd, selectionStart, selectionEnd) {
    const atom = Array.from(els.rich.querySelectorAll('.rich-inline-atom[data-src-start][data-src-end]'))
      .find((element) => Number(element.dataset.srcStart) === sourceStart && Number(element.dataset.srcEnd) === sourceEnd);
    if (!atom) return false;
    activateRichInlineSource(atom, selectionStart);
    const sourceElement = state.richInlineSource?.element;
    if (!sourceElement?.classList?.contains('rich-inline-source')) return false;
    selectInlineSourceRange(sourceElement, selectionStart, selectionEnd);
    return true;
  }

  function selectInlineSourceRange(element, start, end) {
    const text = element.firstChild || element.appendChild(document.createTextNode(''));
    const max = text.nodeValue.length;
    const rangeStart = Math.max(0, Math.min(max, Number(start) || 0));
    const rangeEnd = Math.max(rangeStart, Math.min(max, Number(end) || rangeStart));
    const range = document.createRange();
    range.setStart(text, rangeStart);
    range.setEnd(text, rangeEnd);
    const selection = window.getSelection?.();
    if (!selection) return false;
    selection.removeAllRanges();
    selection.addRange(range);
    element.focus();
    return true;
  }

  function getRichSelectionRange() {
    const selection = window.getSelection?.();
    const range = richSelectionRange(selection);
    if (range) return range;
    els.rich.focus();
    const fallbackRange = document.createRange();
    fallbackRange.selectNodeContents(els.rich);
    fallbackRange.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(fallbackRange);
    return fallbackRange;
  }

  function richSelectedText() {
    const range = getRichSelectionRange();
    return range ? range.toString() : '';
  }

  function insertRichInlineElement(tagName, placeholder, attrs = {}) {
    const range = getRichSelectionRange();
    if (!range) return;
    if (guardUnsupportedRichInlineInsertContext(range)) return;
    const selected = range.toString();
    const element = document.createElement(tagName);
    Object.entries(attrs).forEach(([name, value]) => element.setAttribute(name, value));
    element.textContent = selected || placeholder;
    range.deleteContents();
    range.insertNode(element);
    configureRichEditableSurface();
    if (selected) {
      placeCaretAfterNode(element);
    } else {
      selectElementContents(element);
    }
    syncRichMarkdownFromDom('rich-input');
  }

  function guardUnsupportedRichInlineInsertContext(range) {
    if (!range || !els.rich.contains(range.startContainer)) return false;
    const blockedSelector = [
      'td',
      'th',
      'table',
      'pre.code-block',
      '.mermaid-diagram',
      '.math-display',
      '.toc',
      '.rich-inline-source',
      '.rich-source-editor',
      '.code-language-input',
    ].join(', ');
    const rangeNodes = [range.startContainer, range.endContainer, range.commonAncestorContainer].filter(Boolean);
    if (rangeNodes.some((node) => nodeClosest(node, blockedSelector))) {
      setStatus('この位置ではインライン挿入できません');
      suppressRichInlineActivation();
      return true;
    }
    const selected = normalizeNewlines(range.toString() || '');
    const startBlock = richInlineEditBlockForRange(range);
    const endBlock = nodeClosest(range.endContainer, RICH_INLINE_EDIT_BLOCK_SELECTOR);
    if (selected.includes('\n') || (startBlock && endBlock && startBlock !== endBlock)) {
      setStatus('複数行にはインライン挿入できません');
      suppressRichInlineActivation();
      return true;
    }
    if (richRangeTouchesSourceBlock(range)) {
      setStatus('この選択はMarkdownソースへ変換できません');
      suppressRichInlineActivation();
      return true;
    }
    return false;
  }

  function replaceRichCurrentBlockWithHeading(level) {
    const range = getRichSelectionRange();
    if (!range) return;
    if (guardUnsupportedRichBlockReplacementContext(range)) return;
    const block = richCurrentEditableBlock(range);
    const sourceText = range.toString() || block?.textContent?.trim() || '見出し';
    const heading = document.createElement(`h${level}`);
    heading.textContent = sourceText;
    replaceOrInsertRichBlock(block, heading);
    selectElementContents(heading);
    syncRichMarkdownFromDom('rich-input');
  }

  function replaceRichCurrentBlockWithQuote() {
    const range = getRichSelectionRange();
    if (!range) return;
    if (guardUnsupportedRichBlockReplacementContext(range)) return;
    const block = richCurrentEditableBlock(range);
    const text = range.toString() || block?.textContent?.trim() || '引用文';
    const quote = document.createElement('blockquote');
    const paragraph = document.createElement('p');
    paragraph.textContent = text;
    quote.appendChild(paragraph);
    replaceOrInsertRichBlock(block, quote);
    selectElementContents(paragraph);
    syncRichMarkdownFromDom('rich-input');
  }

  function replaceRichCurrentBlockWithList() {
    const range = getRichSelectionRange();
    if (!range) return;
    if (guardUnsupportedRichBlockReplacementContext(range)) return;
    const block = richCurrentEditableBlock(range);
    const text = range.toString() || block?.textContent?.trim() || '項目';
    const list = document.createElement('ul');
    const item = document.createElement('li');
    item.textContent = text;
    list.appendChild(item);
    replaceOrInsertRichBlock(block, list);
    selectElementContents(item);
    syncRichMarkdownFromDom('rich-input');
  }

  function guardUnsupportedRichBlockReplacementContext(range) {
    if (guardUnsupportedRichBlockFormatContext(range)) return true;
    const block = richCurrentEditableBlock(range);
    if (block && richTopLevelBlock(block)?.matches?.(RICH_SOURCE_BLOCK_SELECTOR)) {
      setStatus('この選択はMarkdownソースへ変換できません');
      suppressRichInlineActivation();
      return true;
    }
    return false;
  }

  function richCurrentEditableBlock(range) {
    const element = nodeElement(range.startContainer);
    const block = element?.closest?.('p, h1, h2, h3, h4, h5, h6, li, blockquote');
    return block && els.rich.contains(block) ? block : null;
  }

  function replaceOrInsertRichBlock(block, nextBlock) {
    const topLevel = block ? richTopLevelBlock(block) : null;
    configureRichEditableSurface();
    if (topLevel && isReplaceableRichTextBlock(topLevel)) {
      topLevel.replaceWith(nextBlock);
    } else if (topLevel && topLevel !== els.rich) {
      topLevel.after(nextBlock);
    } else {
      els.rich.appendChild(nextBlock);
    }
  }

  function richTopLevelBlock(element) {
    let current = element;
    while (current?.parentElement && current.parentElement !== els.rich) current = current.parentElement;
    return current;
  }

  function isReplaceableRichTextBlock(element) {
    const tag = element.tagName?.toLowerCase();
    return ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'ul', 'ol'].includes(tag);
  }

  function insertRichMarkdownBlock(markdown, status = '挿入しました') {
    if (guardUnsupportedRichBlockInsertionSelection()) return;
    const sourceTransaction = richMarkdownBlockInsertionTransaction(markdown);
    if (sourceTransaction) {
      applySourceTransaction(sourceTransaction, 'rich-block-insert');
      setStatus(status);
      return;
    }

    const fragment = richFragmentFromMarkdown(markdown);
    if (!fragment.childNodes.length) return;
    const range = getRichSelectionRange();
    const topLevel = range ? richTopLevelBlock(nodeElement(range.startContainer)) : null;
    const inserted = Array.from(fragment.childNodes);
    if (topLevel && topLevel !== els.rich) {
      topLevel.after(fragment);
    } else {
      els.rich.appendChild(fragment);
    }
    configureRichEditableSurface();
    placeCaretInInsertedRichBlock(inserted[0]);
    syncRichMarkdownFromDom('rich-input');
    setStatus(status);
  }

  function guardUnsupportedRichBlockInsertionSelection() {
    const selection = window.getSelection?.();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return false;
    const range = richSelectionRange(selection);
    if (!range) return false;
    const sourceBlocks = richSourceBlocksIntersectingRange(range);
    if (!sourceBlocks.length) return false;
    const sourceBlock = nodeClosest(range.startContainer, RICH_SOURCE_BLOCK_SELECTOR);
    if (
      sourceBlock
      && sourceBlocks.length === 1
      && sourceBlocks[0] === sourceBlock
      && !richRangeExtendsOutsideSourceBlock(range, sourceBlock)
    ) {
      return false;
    }
    setStatus('この選択ではブロックを挿入できません');
    suppressRichInlineActivation();
    return true;
  }

  function richMarkdownBlockInsertionTransaction(markdown) {
    const blockSource = normalizeNewlines(markdown || '').trim();
    if (!blockSource) return null;
    const current = stripRichCaretTokens(state.markdown || els.source.value || '');
    const insertAt = richMarkdownBlockInsertionOffset();
    if (!Number.isFinite(insertAt) || insertAt < 0 || insertAt > current.length) return null;
    const prefix = current.length && insertAt > 0 ? '\n\n' : '';
    const suffix = current.slice(insertAt).length && !current.slice(insertAt).startsWith('\n\n') ? '\n\n' : '';
    const insert = `${prefix}${blockSource}${suffix}`;
    const blockEnd = insertAt + prefix.length + blockSource.length;
    return {
      from: insertAt,
      to: insertAt,
      insert,
      selectionAfter: {
        anchor: blockEnd,
        focus: blockEnd,
        affinity: 'after',
      },
    };
  }

  function richMarkdownBlockInsertionOffset() {
    const selection = window.getSelection?.();
    const range = richSelectionRange(selection);
    if (!range) {
      return stripRichCaretTokens(state.markdown || els.source.value || '').length;
    }
    const topLevel = richTopLevelBlock(nodeElement(range.startContainer));
    if (topLevel?.matches?.(RICH_SOURCE_BLOCK_SELECTOR)) {
      const end = numericData(topLevel, 'sourceEnd');
      if (Number.isFinite(end)) return end;
    }
    const sourceBlock = nodeClosest(range.startContainer, RICH_SOURCE_BLOCK_SELECTOR);
    if (sourceBlock) {
      const end = numericData(sourceBlock, 'sourceEnd');
      if (Number.isFinite(end)) return end;
    }
    return stripRichCaretTokens(state.markdown || els.source.value || '').length;
  }

  function richFragmentFromMarkdown(markdown) {
    const template = document.createElement('template');
    template.innerHTML = renderMarkdownHtml(markdown);
    enhanceRenderedHtml(template.content);
    return template.content;
  }

  function placeCaretInInsertedRichBlock(block) {
    const target = block.querySelector?.('td, th, li, p, h1, h2, h3, h4, h5, h6') || block;
    if (target.matches?.('pre, .mermaid-diagram, .math-display, .toc, table')) {
      placeCaretAfterNode(block);
      return;
    }
    selectElementContents(target);
  }

  function selectElementContents(element) {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection?.();
    if (!selection) return;
    selection.removeAllRanges();
    selection.addRange(range);
    els.rich.focus();
  }

  function insertLink() {
    openInlineInsertDialog('link');
  }

  function insertRichLink() {
    openInlineInsertDialog('link');
  }

  function insertLinkFromParts(label, href, context = null) {
    const safe = sanitizeLinkUrl(href);
    if (!safe) {
      setStatus('許可されていないリンクです');
      return false;
    }
    const escapedLabel = escapeMarkdownLabel(label || 'リンク');
    const markdown = `[${escapedLabel}](${formatMarkdownTarget(href)})`;
    if (insertInlineMarkdownAtCapturedContext(context, markdown, 'リンクを挿入しました', {
      activateWhenCollapsed: true,
      selectionStart: 1,
      selectionEnd: 1 + escapedLabel.length,
    })) {
      return true;
    }
    insertRichInlineElement('a', label, {
      href: safe,
      'data-markdown-href': href,
      rel: 'noopener noreferrer',
      target: '_blank',
    });
    return true;
  }

  function insertImageReference() {
    openInlineInsertDialog('image');
  }

  function insertRichImageReference() {
    openInlineInsertDialog('image');
  }

  function openInlineInsertDialog(kind) {
    const context = createInlineInsertContext(kind);
    if (!context) return;
    state.pendingInlineInsertContext = context;
    const isImage = kind === 'image';
    els.inlineInsertTitle.textContent = isImage ? '画像参照を挿入' : 'リンクを挿入';
    els.inlineInsertDescription.textContent = isImage
      ? 'Markdownファイル基準の相対画像パスを指定します。フォルダ未許可の相対画像はプレースホルダー表示になります。'
      : '許可ドメイン制は維持されます。許可されていない外部リンクや危険なURLは挿入しません。';
    els.inlineInsertLabel.value = context.label;
    els.inlineInsertTargetLabel.textContent = isImage ? '画像パス' : 'URL';
    els.inlineInsertTarget.placeholder = isImage ? './images/example.png' : './README.md';
    els.inlineInsertTarget.value = context.target;
    els.inlineInsertDialog.returnValue = '';
    if (typeof els.inlineInsertDialog.showModal === 'function') {
      els.inlineInsertDialog.showModal();
      window.setTimeout(() => {
        els.inlineInsertTarget.focus();
        els.inlineInsertTarget.select();
      }, 0);
    } else {
      setStatus('このブラウザでは入力ダイアログを開けません');
    }
  }

  function createInlineInsertContext(kind) {
    const isImage = kind === 'image';
    if (state.mode === 'rich' && isProseMirrorRichActive()) {
      const selected = state.proseMirrorRich.selectedText();
      return {
        kind,
        mode: 'prosemirror',
        label: isImage ? sanitizeMarkdownLabel(selected || '画像') : (selected || 'リンク'),
        target: isImage ? './images/example.png' : './README.md',
      };
    }
    if (state.mode === 'rich') {
      guardReadOnlyRichFallbackAction(isImage ? '画像参照' : 'リンク挿入');
      return null;
    }

    focusMarkdownInput();
    const selected = getSelectedText();
    const selection = sourceSelectionRange();
    return {
      kind,
      mode: state.mode,
      range: {
        from: selection.start,
        to: selection.end,
      },
      label: isImage ? sanitizeMarkdownLabel(selected || '画像') : (selected || 'リンク'),
      target: isImage ? './images/example.png' : './README.md',
    };
  }

  function richInlineInsertRangeFromSelection(selection) {
    const range = richPlainTextTransactionRangeFromSelection(selection);
    if (range) return range;
    const sourceSelection = domSelectionToSourceSelection(selection);
    if (!sourceSelection || sourceSelection.anchor !== sourceSelection.focus || !Number.isFinite(sourceSelection.focus)) return null;
    return { from: sourceSelection.focus, to: sourceSelection.focus };
  }

  function confirmInlineInsertDialog() {
    const context = state.pendingInlineInsertContext;
    if (!context) return;
    const label = els.inlineInsertLabel.value.trim() || (context.kind === 'image' ? '画像' : 'リンク');
    const target = els.inlineInsertTarget.value.trim();
    if (!target) {
      setStatus(context.kind === 'image' ? '画像パスを入力してください' : 'URLを入力してください');
      els.inlineInsertTarget.focus();
      return;
    }
    const inserted = context.kind === 'image'
      ? insertImageReferenceFromParts(label, target, context)
      : insertLinkFromParts(label, target, context);
    if (!inserted) return;
    state.pendingInlineInsertContext = null;
    els.inlineInsertDialog.returnValue = 'inserted';
    els.inlineInsertDialog.close('inserted');
  }

  function cancelInlineInsertDialog() {
    state.pendingInlineInsertContext = null;
    els.inlineInsertDialog.close('cancel');
  }

  function insertImageReferenceFromParts(label, target, context = null) {
    if (!isAllowedMarkdownImageReference(target)) {
      setStatus('画像参照はMarkdown基準の安全なPNG/JPEG/GIF/WebP相対パスのみ挿入できます');
      return false;
    }
    const escapedLabel = escapeMarkdownLabel(sanitizeMarkdownLabel(label));
    const markdown = `![${escapedLabel}](${formatMarkdownTarget(target)})`;
    if (insertInlineMarkdownAtCapturedContext(context, markdown, '画像参照を挿入しました', {
      activateWhenCollapsed: true,
      selectionStart: 2,
      selectionEnd: 2 + escapedLabel.length,
    })) {
      return true;
    }
    insertRichImageElement(label, target);
    return true;
  }

  function isAllowedMarkdownImageReference(target) {
    const decoded = decodeLocalImagePath(cleanupUrl(target, { keepSpaces: true }));
    if (!isRelativeImageReference(decoded)) return false;
    const normalized = normalizeAssetPath(decoded);
    if (isUnsafeRelativePath(normalized)) return false;
    return hasRasterImageExtension(normalized);
  }

  function insertCodeBlock() {
    if (state.mode === 'rich') {
      if (isProseMirrorRichActive()) {
        const selected = state.proseMirrorRich.selectedText().replace(/\n+$/, '');
        insertProseMirrorMarkdown(`\`\`\`\n${selected || 'code'}\n\`\`\``, { status: 'コードブロックを挿入しました' });
        return;
      }
      guardReadOnlyRichFallbackAction('コードブロック挿入');
      return;
    }

    focusMarkdownInput();
    const selected = getSelectedText();
    replaceSelection(`\`\`\`\n${selected || 'code'}\n\`\`\``);
  }

  function insertMathBlock() {
    if (state.mode === 'rich') {
      if (isProseMirrorRichActive()) {
        const selected = state.proseMirrorRich.selectedText().trim();
        insertProseMirrorMarkdown(`$$\n${selected || 'x = y'}\n$$`, { status: '数式ブロックを挿入しました' });
        return;
      }
      guardReadOnlyRichFallbackAction('数式ブロック挿入');
      return;
    }

    focusMarkdownInput();
    const selected = getSelectedText().trim();
    replaceSelection(`$$\n${selected || 'x = y'}\n$$`);
  }

  function insertMermaid() {
    if (state.mode === 'rich') {
      if (isProseMirrorRichActive()) {
        const selected = state.proseMirrorRich.selectedText().trim();
        const body = selected || 'flowchart TD\n  A[開始] --> B{確認}\n  B -->|OK| C[完了]\n  B -->|修正| A';
        insertProseMirrorMarkdown(`\`\`\`mermaid\n${body}\n\`\`\``, { status: 'Mermaidを挿入しました' });
        return;
      }
      guardReadOnlyRichFallbackAction('Mermaid挿入');
      return;
    }

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
    if (state.mode === 'rich') {
      if (isProseMirrorRichActive()) {
        state.proseMirrorRich.focus();
        return els.source;
      }
      els.rich.focus();
      return els.source;
    }
    if (state.mode === 'preview') applyMode('split');
    return focusSourceEditor();
  }

  function getSelectedText() {
    const selection = sourceSelectionRange();
    return sourceMarkdownValue().slice(selection.start, selection.end);
  }

  function insertAtSelection(text) {
    if (state.mode === 'rich') {
      insertRichMarkdownAtSelection(text);
      return;
    }
    focusMarkdownInput();
    replaceSelection(text);
  }

  function insertRichMarkdownAtSelection(markdown) {
    if (isProseMirrorRichActive()) {
      insertProseMirrorMarkdown(markdown, { inline: !String(markdown || '').includes('\n'), status: 'ProseMirrorリッチ編集へ挿入しました' });
      return;
    }
    guardReadOnlyRichFallbackAction('Markdown挿入');
  }

  function insertRichImageElement(label, target) {
    const safe = sanitizeImageUrl(target);
    if (!safe) {
      setStatus('PNG/JPEG/GIF/WebPのローカル画像パスのみ参照できます');
      return;
    }
    const escapedLabel = escapeMarkdownLabel(sanitizeMarkdownLabel(label));
    const markdown = `![${escapedLabel}](${formatMarkdownTarget(target)})`;
    if (insertRichInlineMarkdownSource(markdown, '画像参照を挿入しました', {
      activateWhenCollapsed: true,
      selectionStart: 2,
      selectionEnd: 2 + escapedLabel.length,
    })) {
      return;
    }
    const range = getRichSelectionRange();
    if (!range) return;
    if (guardUnsupportedRichInlineInsertContext(range)) return;
    const image = document.createElement('img');
    image.alt = sanitizeMarkdownLabel(label);
    image.src = safe;
    image.setAttribute('data-markdown-src', target);
    range.deleteContents();
    range.insertNode(image);
    placeCaretAfterNode(image);
    syncRichMarkdownFromDom('rich-input');
    setStatus('画像参照を挿入しました');
  }

  function insertRichInlineMarkdownSource(markdown, status, options = {}) {
    const replacementRange = richInlineTransactionRangeFromSelection(window.getSelection?.());
    if (!replacementRange) return false;
    const source = stripRichCaretTokens(normalizeNewlines(markdown || ''));
    if (!source || source.includes('\n')) return false;
    const trailingPrefix = replacementRange.trailingParagraph && (state.markdown || '').length ? '\n\n' : '';
    const insert = `${trailingPrefix}${source}`;
    const collapsed = replacementRange.from === replacementRange.to;
    const nextOffset = replacementRange.from + insert.length;
    const sourceStart = replacementRange.from + trailingPrefix.length;
    applySourceTransaction({
      from: replacementRange.from,
      to: replacementRange.to,
      insert,
      selectionAfter: {
        anchor: nextOffset,
        focus: nextOffset,
        affinity: 'after',
      },
    }, 'rich-inline-insert');
    if (collapsed && options.activateWhenCollapsed) {
      activateInsertedInlineSource(
        sourceStart,
        replacementRange.from + insert.length,
        Number(options.selectionStart) || 0,
        Number(options.selectionEnd) || 0
      );
    }
    suppressRichInlineActivation();
    setStatus(status);
    return true;
  }

  function richInlineTransactionRangeFromSelection(selection) {
    const tableRange = richTableTextReplacementRangeFromSelection(selection);
    const quoteRange = tableRange ? null : richQuoteTextReplacementRangeFromSelection(selection);
    const rawRange = tableRange || quoteRange || richPlainTextTransactionRangeFromSelection(selection);
    if (!rawRange) return null;
    const range = rawRange.from !== rawRange.to
      ? expandSourceRangeToIntersectingInlineAtoms(rawRange)
      : rawRange;
    if (!Number.isFinite(range.from) || !Number.isFinite(range.to) || range.to < range.from) return null;
    return {
      ...range,
      tableCell: Boolean(tableRange),
      quoteBlock: Boolean(quoteRange),
    };
  }

  function insertInlineMarkdownAtCapturedContext(context, markdown, status, options = {}) {
    if (!context) {
      if (state.mode === 'rich') return insertRichInlineMarkdownSource(markdown, status, options);
      return false;
    }
    const range = context.range;
    const insert = stripRichCaretTokens(normalizeNewlines(markdown || ''));
    if (context.mode === 'prosemirror') {
      if (!insert || insert.includes('\n')) return false;
      if (!insertProseMirrorMarkdown(insert, { inline: true, status })) return false;
      if (options.activateWhenCollapsed) state.proseMirrorRich?.focus?.();
      return true;
    }
    if (!range || !insert || insert.includes('\n')) return false;
    const current = stripRichCaretTokens(sourceMarkdownValue() || state.markdown || '');
    const from = Math.max(0, Math.min(current.length, Number(range.from)));
    const to = Math.max(from, Math.min(current.length, Number(range.to)));
    const collapsed = from === to;
    const nextOffset = from + insert.length;

    if (context.mode === 'rich') {
      applySourceTransaction({
        from,
        to,
        insert,
        selectionAfter: {
          anchor: nextOffset,
          focus: nextOffset,
          affinity: 'after',
        },
      }, 'rich-inline-insert');
      if (collapsed && options.activateWhenCollapsed) {
        activateInsertedInlineSource(
          from,
          from + insert.length,
          Number(options.selectionStart) || 0,
          Number(options.selectionEnd) || 0
        );
      }
      suppressRichInlineActivation();
      setStatus(status);
      return true;
    }

    const selectionStart = from + (Number.isFinite(Number(options.selectionStart)) ? Number(options.selectionStart) : insert.length);
    const selectionEnd = from + (Number.isFinite(Number(options.selectionEnd)) ? Number(options.selectionEnd) : selectionStart);
    replaceSourceRange(from, to, insert, {
      selectionStart,
      selectionEnd,
      renderNow: true,
      reason: 'inline-insert',
    });
    if (state.mode === 'source' || state.mode === 'split') {
      window.setTimeout(() => {
        setSourceSelectionRange(selectionStart, selectionEnd);
      }, 0);
    }
    setStatus(status);
    return true;
  }

  function replaceSelection(replacement, selectionStart, selectionEnd) {
    const textarea = getActiveMarkdownInput();
    const selection = sourceSelectionRange();
    const start = selection.start;
    const end = selection.end;
    const nextStart = Number.isInteger(selectionStart) ? selectionStart : start + replacement.length;
    const nextEnd = Number.isInteger(selectionEnd) ? selectionEnd : nextStart;
    if (textarea !== els.source) {
      setStatus('ブロック編集欄に挿入しました');
      return;
    }
    replaceSourceRange(start, end, replacement, {
      selectionStart: nextStart,
      selectionEnd: nextEnd,
      renderNow: true,
      reason: 'edit',
    });
  }

  function getActiveMarkdownInput() {
    return els.source;
  }

  function applyMode(mode, options = {}) {
    if (!['rich', 'split', 'source', 'preview', 'focus'].includes(mode)) mode = 'split';
    const preserveScroll = options.preserveScroll !== false;
    const shouldPersist = options.persist !== false;
    const scrollAnchor = preserveScroll ? captureCurrentScrollAnchor() : null;
    if (preserveScroll && state.mode !== mode) captureCurrentMarkdownFromEditor();
    state.mode = mode;
    document.body.dataset.mode = mode;
    document.querySelectorAll('[data-action="mode"]').forEach((button) => {
      const active = button.dataset.mode === mode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    if (shouldPersist) persistSettings();
    if (mode === 'split' || mode === 'preview') renderPreview();
    if (mode === 'rich') renderRich();
    if (mode === 'split' || mode === 'source' || mode === 'focus') refreshCodeMirrorSourceEditorSoon();
    if (scrollAnchor) restoreCurrentModeScrollSoon(scrollAnchor);
    setStatus(`表示モード: ${mode}`);
  }

  function toggleTheme() {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    applyTheme();
    initializeVendorLibraries();
    persistSettings();
    renderAll('theme');
  }

  function applyTheme() {
    document.documentElement.dataset.theme = state.theme;
    const themeButton = document.querySelector('[data-action="toggle-theme"]');
    if (!themeButton) return;
    const label = state.theme === 'dark' ? 'ライトテーマに切り替え' : 'ダークテーマに切り替え';
    themeButton.setAttribute('aria-label', label);
    themeButton.title = label;
  }

  function initializeVendorLibraries() {
    if (window.mermaid?.initialize) {
      window.mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'base',
        htmlLabels: false,
        flowchart: {
          htmlLabels: false,
          useMaxWidth: true,
        },
        sequence: { useMaxWidth: true },
        themeVariables: mermaidThemeVariables(),
      });
    }
  }

  function mermaidThemeVariables() {
    if (state.theme === 'dark') {
      return {
        background: 'transparent',
        primaryColor: '#1f2937',
        primaryTextColor: '#f8fafc',
        primaryBorderColor: '#7aa2f7',
        lineColor: '#9ca3af',
        defaultLinkColor: '#7aa2f7',
        secondaryColor: '#0f172a',
        secondaryTextColor: '#f8fafc',
        tertiaryColor: '#111827',
        tertiaryTextColor: '#f8fafc',
        mainBkg: '#1f2937',
        secondBkg: '#0f172a',
        nodeTextColor: '#f8fafc',
        textColor: '#f8fafc',
        labelTextColor: '#f8fafc',
        labelBackground: '#111827',
        edgeLabelBackground: '#111827',
        clusterBkg: '#111827',
        clusterBorder: '#475569',
        noteBkgColor: '#3b2f0b',
        noteTextColor: '#fef3c7',
        sectionBkgColor: '#172554',
        altSectionBkgColor: '#064e3b',
        gridColor: '#64748b',
        taskBkgColor: '#60a5fa',
        taskBorderColor: '#93c5fd',
        taskTextColor: '#0f172a',
        taskTextLightColor: '#0f172a',
        taskTextOutsideColor: '#f8fafc',
        activeTaskBkgColor: '#fbbf24',
        activeTaskBorderColor: '#fde68a',
        doneTaskBkgColor: '#64748b',
        doneTaskBorderColor: '#94a3b8',
        todayLineColor: '#fb7185',
        pie1: '#60a5fa',
        pie2: '#34d399',
        pie3: '#fbbf24',
        pie4: '#fb7185',
        pie5: '#a78bfa',
        pie6: '#2dd4bf',
        pie7: '#f472b6',
        pie8: '#c084fc',
        pieStrokeColor: '#111827',
        pieOuterStrokeColor: '#94a3b8',
        pieTitleTextSize: '18px',
        pieSectionTextSize: '15px',
        pieLegendTextSize: '14px',
        git0: '#60a5fa',
        git1: '#34d399',
        git2: '#fbbf24',
        git3: '#fb7185',
        git4: '#a78bfa',
        git5: '#2dd4bf',
        git6: '#f472b6',
        git7: '#c084fc',
        gitBranchLabel0: '#f8fafc',
        gitBranchLabel1: '#0f172a',
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      };
    }
    return {
      background: 'transparent',
      primaryColor: '#ffffff',
      primaryTextColor: '#111827',
      primaryBorderColor: '#2563eb',
      lineColor: '#334155',
      defaultLinkColor: '#2563eb',
      secondaryColor: '#eff6ff',
      secondaryTextColor: '#111827',
      tertiaryColor: '#f8fafc',
      tertiaryTextColor: '#111827',
      mainBkg: '#ffffff',
      secondBkg: '#eff6ff',
      nodeTextColor: '#111827',
      textColor: '#111827',
      labelTextColor: '#111827',
      labelBackground: '#ffffff',
      edgeLabelBackground: '#ffffff',
      clusterBkg: '#f8fafc',
      clusterBorder: '#cbd5e1',
      noteBkgColor: '#fef3c7',
      noteTextColor: '#713f12',
      sectionBkgColor: '#eef4ff',
      altSectionBkgColor: '#f0fdf4',
      gridColor: '#9ca3af',
      taskBkgColor: '#bfdbfe',
      taskBorderColor: '#2563eb',
      taskTextColor: '#111827',
      taskTextLightColor: '#111827',
      taskTextOutsideColor: '#111827',
      activeTaskBkgColor: '#fde68a',
      activeTaskBorderColor: '#d97706',
      doneTaskBkgColor: '#d1d5db',
      doneTaskBorderColor: '#6b7280',
      todayLineColor: '#dc2626',
      pie1: '#2563eb',
      pie2: '#16a34a',
      pie3: '#f59e0b',
      pie4: '#dc2626',
      pie5: '#7c3aed',
      pie6: '#0d9488',
      pie7: '#db2777',
      pie8: '#9333ea',
      pieStrokeColor: '#ffffff',
      pieOuterStrokeColor: '#334155',
      pieTitleTextSize: '18px',
      pieSectionTextSize: '15px',
      pieLegendTextSize: '14px',
      git0: '#2563eb',
      git1: '#16a34a',
      git2: '#f59e0b',
      git3: '#dc2626',
      git4: '#7c3aed',
      git5: '#0d9488',
      git6: '#db2777',
      git7: '#9333ea',
      gitBranchLabel0: '#ffffff',
      gitBranchLabel1: '#ffffff',
      fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    };
  }

  function toggleOutline() {
    state.outlineCollapsed = !state.outlineCollapsed;
    applyOutlineVisibility();
    persistSettings();
  }

  function applyOutlineVisibility() {
    document.body.classList.toggle('outline-collapsed', state.outlineCollapsed);
    const toggle = document.querySelector('.top-actions [data-action="collapse-outline"]');
    if (!toggle) return;
    const visible = !state.outlineCollapsed;
    toggle.setAttribute('aria-pressed', String(visible));
    toggle.title = `${visible ? 'アウトラインを隠す' : 'アウトラインを表示'} (Ctrl+Alt+O)`;
  }

  function showSecurityDialog() {
    if (els.securityDialog && typeof els.securityDialog.showModal === 'function') {
      els.securityDialog.showModal();
    } else {
      alert('完全ローカル実行、CSP有効、CDN不使用、Markdown内HTMLは無効です。');
    }
  }

  function clearDraftData(options = {}) {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (_) {}
    resetDocumentState();
    if (options.status !== false) setStatus('下書きを削除し、文書を初期状態に戻しました');
  }

  function resetDocumentState() {
    window.clearTimeout(state.saveTimer);
    window.clearTimeout(state.renderTimer);
    window.clearTimeout(state.richReparseTimer);
    clearAssetUrls();
    state.markdown = DEFAULT_MARKDOWN;
    state.fileName = 'untitled.md';
    state.markdownRelativePath = '';
    state.directoryHandle = null;
    state.directoryName = '';
    state.fileHandle = null;
    state.folderScanLimitMessage = '';
    state.dirty = false;
    state.lastAutoSaved = null;
    state.richUndoStack = [];
    els.source.value = state.markdown;
    syncCodeMirrorSourceFromTextarea('local-data-reset');
    renderAll('local-data-reset');
  }

  function resetSettingsData(options = {}) {
    try {
      localStorage.removeItem(SETTINGS_KEY);
    } catch (_) {}
    state.theme = defaultTheme();
    state.mode = 'rich';
    state.outlineCollapsed = false;
    state.allowedLinkDomains = [];
    if (els.allowedDomainsInput) els.allowedDomainsInput.value = '';
    applyTheme();
    initializeVendorLibraries();
    applyOutlineVisibility();
    applyMode(state.mode, { preserveScroll: false, persist: false });
    renderAll('settings-reset');
    if (options.status !== false) setStatus('設定をリセットしました');
  }

  function clearAllowedDomainsData(options = {}) {
    state.allowedLinkDomains = [];
    if (els.allowedDomainsInput) els.allowedDomainsInput.value = '';
    persistSettings();
    renderAll('link-settings');
    if (options.status !== false) setStatus('外部リンク許可ドメインを削除しました');
  }

  async function clearFolderPermissionRecords(options = {}) {
    await deleteFsaDatabase();
    clearFolderPermissionState();
    renderAll('folder-permission-clear');
    if (options.status !== false) setStatus('フォルダ権限の記録を削除しました。保存済みファイルやassets画像は削除していません');
  }

  function clearFolderPermissionState() {
    clearAssetUrls();
    state.directoryHandle = null;
    state.pickerStartDirectoryHandle = null;
    state.settingsDirectoryHandle = null;
    state.settingsDirectoryName = '';
    state.directoryName = '';
    state.markdownRelativePath = '';
    state.fileHandle = null;
    state.folderScanLimitMessage = '';
  }

  async function clearAllLocalData() {
    if (!confirm('この操作はブラウザ内の下書き・設定・許可ドメイン・フォルダ権限の記録を削除します。保存済みMarkdownファイルや assets フォルダ内の画像は削除しません。続行しますか？')) return;
    clearDraftData({ status: false });
    resetSettingsData({ status: false });
    await clearFolderPermissionRecords({ status: false });
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(SETTINGS_KEY);
    } catch (_) {}
    state.allowedLinkDomains = [];
    if (els.allowedDomainsInput) els.allowedDomainsInput.value = '';
    renderAll('local-data-clear');
    setStatus('すべてのローカルデータを削除しました。保存済みMarkdownファイルやassets画像は削除していません');
  }

  function showLinkDomainDialog() {
    if (!els.linkDomainDialog || !els.allowedDomainsInput) return;
    els.allowedDomainsInput.value = state.allowedLinkDomains.join('\n');
    if (typeof els.linkDomainDialog.showModal === 'function') {
      els.linkDomainDialog.showModal();
    }
  }

  function saveLinkDomains() {
    state.allowedLinkDomains = normalizeDomainList(splitDomainInput(els.allowedDomainsInput?.value || ''));
    persistSettings();
    renderAll('link-settings');
    if (els.linkDomainDialog?.open) els.linkDomainDialog.close();
    setStatus(`外部リンク許可ドメイン: ${state.allowedLinkDomains.length}件`);
  }

  function openSettingsFile() {
    if (!els.settingsInput) {
      setStatus('設定ファイルの読み込みに対応していない環境です');
      return;
    }
    els.settingsInput.click();
  }

  async function onSettingsFileChosen(event) {
    const [file] = event.target.files || [];
    event.target.value = '';
    if (!file) return;
    if (file.size > 256 * 1024) {
      setStatus('設定ファイルは256KB以下にしてください');
      return;
    }

    try {
      const domains = parseAllowedDomainsSettings(await readTextFile(file));
      state.allowedLinkDomains = domains;
      persistSettings();
      if (els.allowedDomainsInput) els.allowedDomainsInput.value = state.allowedLinkDomains.join('\n');
      renderAll('link-settings');
      setStatus(`設定ファイルから外部リンク許可ドメインを読み込みました: ${state.allowedLinkDomains.length}件`);
    } catch (_) {
      setStatus('設定ファイルを読み込めませんでした。JSON形式とallowedLinkDomainsを確認してください');
    }
  }

  function exportSettingsFile() {
    if (state.desktopHost) {
      postDesktopMessage({
        type: 'desktop.exportSettings',
        fileName: CONFIG_SETTINGS_FILE_NAME,
        content: settingsFileText(),
      });
      return;
    }
    downloadBlob(CONFIG_SETTINGS_FILE_NAME, settingsFileText(), 'application/json;charset=utf-8');
    setStatus(`外部リンク許可ドメイン設定を書き出しました: ${state.allowedLinkDomains.length}件`);
  }

  async function grantSettingsDirectory() {
    const directoryHandle = await chooseSettingsDirectory();
    if (!directoryHandle) return false;
    const loaded = await loadSettingsFromConfigDirectory(directoryHandle, { missingOk: true });
    if (loaded) {
      setStatus(`設定フォルダを許可し、${CONFIG_SETTINGS_FILE_NAME} から読み込みました: ${state.allowedLinkDomains.length}件`);
    } else {
      await writeSettingsFileToConfigDirectory(directoryHandle);
      setStatus(`設定フォルダを許可し、現在の許可ドメイン設定を ${CONFIG_SETTINGS_FILE_NAME} に保存しました`);
    }
    return true;
  }

  async function saveSettingsToConfigDirectory() {
    let directoryHandle = state.settingsDirectoryHandle;
    if (!directoryHandle) {
      directoryHandle = await chooseSettingsDirectory();
      if (!directoryHandle) return false;
    }
    if (!await ensureDirectoryPermission(directoryHandle, 'readwrite')) {
      setStatus('設定ファイルの上書きには設定フォルダの書き込み権限が必要です');
      return false;
    }
    try {
      await writeSettingsFileToConfigDirectory(directoryHandle);
      setStatus(`${CONFIG_SETTINGS_FILE_NAME} に外部リンク許可ドメイン設定を保存しました: ${state.allowedLinkDomains.length}件`);
      return true;
    } catch (_) {
      setStatus('設定ファイルの保存に失敗しました');
      return false;
    }
  }

  async function chooseSettingsDirectory() {
    if (!window.showDirectoryPicker) {
      setStatus('設定フォルダの許可には File System Access API 対応ブラウザが必要です');
      return null;
    }
    let directoryHandle = null;
    try {
      directoryHandle = await showDirectoryPickerFromRecentDirectory(
        { id: 'pme-settings-folder', mode: 'readwrite' },
        { startInHandle: state.settingsDirectoryHandle || null },
      );
    } catch (error) {
      handlePickerError(error, '設定フォルダ選択を開始できませんでした');
      return null;
    }

    try {
      if (!await ensureDirectoryPermission(directoryHandle, 'readwrite')) {
        setStatus('設定フォルダの書き込み権限が許可されませんでした');
        return null;
      }
      state.settingsDirectoryHandle = directoryHandle;
      state.settingsDirectoryName = directoryHandle.name || '';
      await persistSettingsDirectoryHandle(directoryHandle);
      return directoryHandle;
    } catch (error) {
      warnSafeError('settings folder grant failed', error);
      setStatus('設定フォルダを許可できませんでした');
      return null;
    }
  }

  async function loadSettingsFromConfigDirectory(directoryHandle, options = {}) {
    try {
      const fileHandle = await directoryHandle.getFileHandle(CONFIG_SETTINGS_FILE_NAME);
      const file = await fileHandle.getFile();
      if (file.size > 256 * 1024) throw new Error('settings file too large');
      const domains = parseAllowedDomainsSettings(await readTextFile(file));
      state.allowedLinkDomains = domains;
      persistSettings();
      if (els.allowedDomainsInput) els.allowedDomainsInput.value = state.allowedLinkDomains.join('\n');
      renderAll('link-settings');
      return true;
    } catch (error) {
      if (options.missingOk && error?.name === 'NotFoundError') return false;
      throw error;
    }
  }

  async function writeSettingsFileToConfigDirectory(directoryHandle) {
    const fileHandle = await directoryHandle.getFileHandle(CONFIG_SETTINGS_FILE_NAME, { create: true });
    const writable = await fileHandle.createWritable();
    try {
      await writable.write(settingsFileText());
    } finally {
      await writable.close();
    }
  }

  function settingsFileText() {
    return `${JSON.stringify({
      app: 'Portable Markdown Editor',
      version: 1,
      allowedLinkDomains: normalizeDomainList(state.allowedLinkDomains),
    }, null, 2)}\n`;
  }

  function parseAllowedDomainsSettings(text) {
    const parsed = JSON.parse(String(text || ''));
    const values = Array.isArray(parsed)
      ? parsed
      : parsed?.allowedLinkDomains;
    if (!Array.isArray(values)) throw new Error('allowedLinkDomains must be an array');
    return normalizeDomainList(values);
  }

  function markDirty() {
    state.dirty = true;
    updateStatusBar();
    notifyDesktopDocumentState();
  }

  function scheduleRender(reason = 'edit') {
    window.clearTimeout(state.renderTimer);
    state.renderTimer = window.setTimeout(() => renderAll(reason), 120);
  }

  function scheduleRichReparse() {
    window.clearTimeout(state.richReparseTimer);
    state.richReparseTimer = window.setTimeout(() => {
      if (state.mode !== 'rich' || state.richComposing) return;
      if (document.activeElement?.closest?.('.rich-source-editor, .code-language-input')) return;
      const bookmark = getRichCaretBookmark();
      renderRich();
      restoreRichCaret(bookmark);
    }, 320);
  }

  function scheduleAutosave() {
    window.clearTimeout(state.saveTimer);
    state.saveTimer = window.setTimeout(persistDraft, 450);
  }

  function persistDraft() {
    state.markdown = stripRichCaretTokens(state.markdown);
    const ok = writeJson(STORAGE_KEY, {
      markdown: state.markdown,
      fileName: state.fileName,
      markdownRelativePath: state.markdownRelativePath,
      dirty: state.dirty,
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
      allowedLinkDomains: state.allowedLinkDomains,
    });
  }

  function renderAll(reason) {
    if (reason !== 'init' && reason !== 'rich-input') state.markdown = sourceMarkdownValue();
    else state.markdown = stripRichCaretTokens(state.markdown);
    if (els.source.value !== state.markdown) els.source.value = state.markdown;
    syncCodeMirrorSourceFromTextarea(`render-${reason || 'all'}`);
    renderPreview();
    if (reason !== 'rich-input') renderRich();
    renderOutline();
    updateStatusBar();
    applyOutlineVisibility();
  }

  function renderPreview() {
    const html = renderMarkdownHtml(state.markdown);
    safeSetHtml(els.preview, html);
    requestDesktopImageReferenceAliases();
  }

  function renderRich() {
    state.richInlineSource = null;
    if (renderProseMirrorRich()) return;
    teardownProseMirrorRichEditor();
    renderReadOnlyRichFallback();
  }

  function renderEmptyRichSourceParagraph() {
    return annotateRenderedBlockHtml('<p><br></p>', {
      id: `b0-${hashString('0:0:paragraph:')}`,
      type: 'paragraph',
      start: 0,
      end: 0,
    });
  }

  function ensureRichTrailingEditableParagraph() {
    removeRichTrailingEditableParagraphs();
    const last = lastRichEditorElement();
    if (!last || isEmptyRichParagraph(last)) return;
    if (!last.matches?.(RICH_TRAILING_BLOCK_SELECTOR)) return;

    const paragraph = document.createElement('p');
    paragraph.dataset.richTrailing = 'true';
    paragraph.appendChild(document.createElement('br'));
    els.rich.appendChild(paragraph);
  }

  function removeRichTrailingEditableParagraphs() {
    Array.from(els.rich?.children || []).forEach((child) => {
      if (child.matches?.('p[data-rich-trailing="true"]') && isEmptyRichParagraph(child)) child.remove();
    });
  }

  function richTrailingEditableParagraph() {
    const last = els.rich?.lastElementChild;
    if (last?.matches?.('p[data-rich-trailing="true"]') && isEmptyRichParagraph(last)) return last;
    return null;
  }

  function lastRichEditorElement() {
    const children = Array.from(els.rich?.children || []);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (child.matches?.('p[data-rich-trailing="true"]') && isEmptyRichParagraph(child)) continue;
      return child;
    }
    return null;
  }

  function isEmptyRichParagraph(element) {
    return element?.tagName?.toLowerCase() === 'p' && areInlineNodesVisiblyEmpty(Array.from(element.childNodes));
  }

  function configureRichEditableSurface() {
    els.rich.setAttribute('contenteditable', 'true');
    els.rich.querySelectorAll('.toc, .mermaid-diagram, pre.code-block, .rich-inline-atom, .math-inline, .math-display, hr').forEach((node) => {
      node.setAttribute('contenteditable', 'false');
    });
    els.rich.querySelectorAll('.task-checkbox, .code-language-input').forEach((node) => {
      node.setAttribute('contenteditable', 'false');
    });
  }

  function getRichCaretBookmark() {
    const selection = window.getSelection?.();
    if (!selection || !selection.rangeCount || !els.rich.contains(selection.anchorNode)) return null;
    const range = selection.getRangeAt(0);
    const sourceSelection = domSelectionToSourceSelection(selection);
    const inlineSource = nodeClosest(range.startContainer, '.rich-inline-source');
    if (inlineSource && els.rich.contains(inlineSource)) {
      return {
        kind: 'inline-source',
        sourceSelection,
        inlineIndex: richInlineSourceElementIndex(inlineSource),
        source: normalizeNewlines(inlineSource.textContent || ''),
        sourceOffset: richInlineSourceCaretOffset(inlineSource) || 0,
      };
    }

    const before = range.cloneRange();
    before.selectNodeContents(els.rich);
    before.setEnd(range.startContainer, range.startOffset);
    const selected = range.cloneRange();
    return {
      sourceSelection,
      start: before.toString().length,
      length: selected.toString().length,
    };
  }

  function richInlineSourceElementIndex(target) {
    return richInlineSourceLikeElementsInOrder().findIndex((element) => element === target);
  }

  function richInlineSourceLikeElementsInOrder() {
    return Array.from(els.rich.querySelectorAll(RICH_INLINE_SOURCE_SELECTOR)).filter((element) => {
      if (element.classList.contains('rich-inline-source')) return els.rich.contains(element);
      return Boolean(validRichInlineSourceElement(element));
    });
  }

  function restoreRichCaret(bookmark) {
    if (!bookmark) return;
    if (bookmark.kind === 'inline-source' && restoreRichInlineSourceCaret(bookmark)) return;
    if (restoreRichCaretFromSourceSelection(bookmark.sourceSelection)) return;
    const start = findTextPosition(els.rich, bookmark.start);
    const end = findTextPosition(els.rich, bookmark.start + bookmark.length);
    if (!start) {
      els.rich.focus();
      return;
    }
    const startAtom = nodeClosest(start.node, '.rich-inline-atom');
    if (startAtom && els.rich.contains(startAtom)) {
      const offsetRange = document.createRange();
      offsetRange.selectNodeContents(startAtom);
      offsetRange.setEnd(start.node, start.offset);
      const boundary = offsetRange.toString().length <= (startAtom.textContent || '').length / 2 ? 'before' : 'after';
      placeCaretAtInlineBoundary(startAtom, boundary);
      return;
    }
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    if (end) {
      range.setEnd(end.node, end.offset);
    } else {
      range.collapse(true);
    }
    const selection = window.getSelection?.();
    if (!selection) return;
    selection.removeAllRanges();
    selection.addRange(range);
    els.rich.focus();
  }

  function restoreRichCaretFromSourceSelection(sourceSelection) {
    const range = sourceSelectionToDomRange(sourceSelection);
    if (!range) return false;
    const selection = window.getSelection?.();
    if (!selection) return false;
    try {
      els.rich.focus({ preventScroll: true });
    } catch (_) {
      els.rich.focus();
    }
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  }

  function domSelectionToSourceSelection(selection) {
    if (!selection || !selection.rangeCount || !els.rich.contains(selection.anchorNode) || !els.rich.contains(selection.focusNode)) return null;
    let anchor = domPointToSourceOffset(selection.anchorNode, selection.anchorOffset);
    let focus = domPointToSourceOffset(selection.focusNode, selection.focusOffset);
    if (!anchor || !focus) return null;
    if (!selection.isCollapsed) {
      const anchorAtomic = atomicSourceRangeForDomPoint(selection.anchorNode);
      const focusAtomic = atomicSourceRangeForDomPoint(selection.focusNode);
      if (anchorAtomic && focusAtomic && anchorAtomic.block === focusAtomic.block) {
        anchor = { offset: anchorAtomic.start, affinity: 'before' };
        focus = { offset: focusAtomic.end, affinity: 'after' };
      } else {
        if (anchorAtomic) anchor = sourceBoundaryForAtomicSelectionEndpoint(anchorAtomic, focus.offset);
        if (focusAtomic) focus = sourceBoundaryForAtomicSelectionEndpoint(focusAtomic, anchor.offset);
      }
    }
    return {
      anchor: anchor.offset,
      focus: focus.offset,
      affinity: selection.isCollapsed ? anchor.affinity : undefined,
    };
  }

  function domPointToSourceOffset(container, offset) {
    const atomicBlock = nodeClosest(container, RICH_ATOMIC_SOURCE_BLOCK_SELECTOR);
    if (atomicBlock && els.rich.contains(atomicBlock)) {
      const sourceBoundary = sourceBoundaryForAtomicBlockDomPoint(atomicBlock, container, offset);
      if (sourceBoundary) return sourceBoundary;
    }

    const atom = nodeClosest(container, '.rich-inline-atom');
    if (atom && els.rich.contains(atom)) {
      const start = Number(atom.dataset.srcStart);
      const end = Number(atom.dataset.srcEnd);
      if (Number.isFinite(start) && Number.isFinite(end)) {
        const textOffset = textOffsetWithinElement(atom, container, offset);
        const midpoint = (atom.textContent || '').length / 2;
        return textOffset <= midpoint
          ? { offset: start, affinity: 'before' }
          : { offset: end, affinity: 'after' };
      }
    }

    if (container?.nodeType === Node.ELEMENT_NODE) {
      const beforeNode = container.childNodes?.[offset - 1];
      const afterNode = container.childNodes?.[offset];
      const beforeAtomic = nodeElement(beforeNode)?.closest?.(RICH_ATOMIC_SOURCE_BLOCK_SELECTOR);
      if (beforeAtomic && els.rich.contains(beforeAtomic) && Number.isFinite(Number(beforeAtomic.dataset.sourceEnd))) {
        return { offset: Number(beforeAtomic.dataset.sourceEnd), affinity: 'after' };
      }
      const afterAtomic = nodeElement(afterNode)?.closest?.(RICH_ATOMIC_SOURCE_BLOCK_SELECTOR);
      if (afterAtomic && els.rich.contains(afterAtomic) && Number.isFinite(Number(afterAtomic.dataset.sourceStart))) {
        return { offset: Number(afterAtomic.dataset.sourceStart), affinity: 'before' };
      }
      const beforeAtom = beforeNode?.nodeType === Node.ELEMENT_NODE ? beforeNode.closest?.('.rich-inline-atom') : null;
      if (beforeAtom && els.rich.contains(beforeAtom) && Number.isFinite(Number(beforeAtom.dataset.srcEnd))) {
        return { offset: Number(beforeAtom.dataset.srcEnd), affinity: 'after' };
      }
      const afterAtom = afterNode?.nodeType === Node.ELEMENT_NODE ? afterNode.closest?.('.rich-inline-atom') : null;
      if (afterAtom && els.rich.contains(afterAtom) && Number.isFinite(Number(afterAtom.dataset.srcStart))) {
        return { offset: Number(afterAtom.dataset.srcStart), affinity: 'before' };
      }
    }

    const tableCell = nodeClosest(container, 'td, th');
    if (tableCell && els.rich.contains(tableCell)) {
      const tableRange = document.createRange();
      try {
        tableRange.setStart(container, offset);
        tableRange.collapse(true);
      } catch (_) {
        return null;
      }
      const tablePoint = richTableSourcePointFromRange(tableCell, tableRange);
      if (tablePoint) return { offset: tablePoint.offset, affinity: 'after' };
    }

    const quote = nodeClosest(container, 'blockquote');
    if (quote && els.rich.contains(quote)) {
      const quoteRange = document.createRange();
      try {
        quoteRange.setStart(container, offset);
        quoteRange.collapse(true);
      } catch (_) {
        return null;
      }
      const quotePoint = richQuoteSourcePointFromRange(quote, quoteRange);
      if (quotePoint) return { offset: quotePoint.offset, affinity: 'after' };
    }

    const editBlock = richInlineEditBlockForRange({ startContainer: container });
    if (editBlock?.tagName?.toLowerCase() === 'li') {
      const listRange = document.createRange();
      try {
        listRange.setStart(container, offset);
        listRange.collapse(true);
      } catch (_) {
        return null;
      }
      const listPoint = richListSourcePointFromRange(editBlock, listRange);
      if (listPoint) return { offset: listPoint.offset, affinity: 'after' };
    }
    const sourceBlock = nodeClosest(container, RICH_SOURCE_BLOCK_SELECTOR);
    if (!editBlock || !sourceBlock) return null;
    const blockStart = numericData(sourceBlock, 'sourceStart');
    const baseOffset = sourceContentBaseOffset(sourceBlock);
    const before = document.createRange();
    before.selectNodeContents(editBlock);
    try {
      before.setEnd(container, offset);
    } catch (_) {
      return null;
    }
    const fragment = before.cloneContents();
    const localSource = stripRichCaretTokens(serializeInlineNodes(Array.from(fragment.childNodes)));
    return { offset: blockStart + baseOffset + localSource.length, affinity: 'after' };
  }

  function sourceBoundaryForAtomicBlockDomPoint(block, container, offset) {
    const start = numericData(block, 'sourceStart');
    const end = numericData(block, 'sourceEnd');
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    if (container === block && container.nodeType === Node.ELEMENT_NODE) {
      if (offset <= 0) return { offset: start, affinity: 'before' };
      if (offset >= block.childNodes.length) return { offset: end, affinity: 'after' };
    }
    const textOffset = textOffsetWithinElement(block, container, offset);
    const midpoint = Math.max(1, (block.textContent || '').length) / 2;
    return textOffset <= midpoint
      ? { offset: start, affinity: 'before' }
      : { offset: end, affinity: 'after' };
  }

  function atomicSourceRangeForDomPoint(container) {
    const block = nodeClosest(container, RICH_ATOMIC_SOURCE_BLOCK_SELECTOR);
    if (!block || !els.rich.contains(block)) return null;
    const start = numericData(block, 'sourceStart');
    const end = numericData(block, 'sourceEnd');
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    return { block, start, end };
  }

  function sourceBoundaryForAtomicSelectionEndpoint(range, otherOffset) {
    if (!range) return null;
    if (Number.isFinite(otherOffset) && otherOffset <= range.start) {
      return { offset: range.end, affinity: 'after' };
    }
    return { offset: range.start, affinity: 'before' };
  }

  function sourceSelectionToDomRange(sourceSelection) {
    if (!sourceSelection || !Number.isFinite(sourceSelection.focus)) return null;
    const focus = Number(sourceSelection.focus);
    const anchor = Number.isFinite(sourceSelection.anchor) ? Number(sourceSelection.anchor) : focus;
    if (anchor === focus) {
      return sourceOffsetToCollapsedDomRange(focus, sourceSelection.affinity);
    }

    const start = Math.min(anchor, focus);
    const end = Math.max(anchor, focus);
    const startRange = sourceOffsetToCollapsedDomRange(start, 'before');
    const endRange = sourceOffsetToCollapsedDomRange(end, 'after');
    if (!startRange || !endRange) return null;

    const range = document.createRange();
    try {
      range.setStart(startRange.startContainer, startRange.startOffset);
      range.setEnd(endRange.startContainer, endRange.startOffset);
    } catch (_) {
      return null;
    }
    return range;
  }

  function sourceOffsetToCollapsedDomRange(offset, affinity = 'after') {
    if (!Number.isFinite(offset)) return null;
    const atom = inlineAtomForSourceOffset(offset, affinity);
    if (atom) {
      const range = document.createRange();
      if (affinity === 'before' || offset <= Number(atom.dataset.srcStart)) {
        range.setStartBefore(atom);
      } else {
        range.setStartAfter(atom);
      }
      range.collapse(true);
      return range;
    }

    const block = renderedBlockForSourceOffset(els.rich, offset);
    if (!block) return null;
    if (block.matches?.('table')) {
      const tableRange = sourceOffsetToTableDomRange(block, offset);
      if (tableRange) return tableRange;
    }
    if (block.matches?.('blockquote')) {
      const quoteRange = sourceOffsetToQuoteDomRange(block, offset);
      if (quoteRange) return quoteRange;
    }
    if (block.matches?.('ul, ol')) {
      const listRange = sourceOffsetToListDomRange(block, offset);
      if (listRange) return listRange;
    }
    const inlineRange = sourceOffsetToInlineDomRange(block, offset);
    if (inlineRange) return inlineRange;
    const localOffset = Math.max(0, offset - numericData(block, 'sourceStart') - sourceContentBaseOffset(block));
    const position = findTextPosition(block, localOffset);
    if (!position) return null;
    const range = document.createRange();
    range.setStart(position.node, Math.max(0, Math.min(position.offset, position.node.nodeValue?.length || 0)));
    range.collapse(true);
    return range;
  }

  function sourceOffsetToInlineDomRange(block, offset) {
    if (!block || block.matches?.('ul, ol')) return null;
    const blockStart = numericData(block, 'sourceStart');
    if (!Number.isFinite(blockStart)) return null;
    const range = document.createRange();
    const nodes = block.tagName?.toLowerCase() === 'li'
      ? richInlineEditBlockContentNodes(block)
      : Array.from(block.childNodes);
    let cursor = blockStart + sourceContentBaseOffset(block);
    let lastNode = null;
    let lastText = null;

    for (const node of nodes) {
      if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains('task-checkbox')) continue;
      if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains('rich-inline-atom')) {
        const start = Number(node.dataset.srcStart);
        const end = Number(node.dataset.srcEnd);
        if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
          if (offset <= start) {
            range.setStartBefore(node);
            range.collapse(true);
            return range;
          }
          if (offset < end) {
            if (offset - start <= (end - start) / 2) range.setStartBefore(node);
            else range.setStartAfter(node);
            range.collapse(true);
            return range;
          }
          cursor = Math.max(cursor, end);
          lastNode = node;
          continue;
        }
      }

      if (node.nodeType === Node.ELEMENT_NODE && node.tagName?.toLowerCase() === 'br') {
        if (offset <= cursor) {
          range.setStartBefore(node);
          range.collapse(true);
          return range;
        }
        if (offset <= cursor + 1) {
          const anchor = node.nextSibling?.nodeType === Node.ELEMENT_NODE && node.nextSibling.classList?.contains('rich-line-break-caret-anchor')
            ? node.nextSibling
            : null;
          if (anchor?.firstChild?.nodeType === Node.TEXT_NODE) {
            range.setStart(anchor.firstChild, Math.min(1, anchor.firstChild.nodeValue.length));
            state.richLineBreakInputOffset = offset;
          } else {
            range.setStartAfter(node);
          }
          range.collapse(true);
          return range;
        }
        cursor += 1;
        lastNode = node;
        continue;
      }

      if (node.nodeType === Node.TEXT_NODE) {
        const length = normalizeRichText(node.nodeValue || '').length;
        if (offset <= cursor + length) {
          range.setStart(node, Math.max(0, Math.min(node.nodeValue?.length || 0, offset - cursor)));
          range.collapse(true);
          return range;
        }
        cursor += length;
        lastText = node;
        lastNode = node;
        continue;
      }

      const length = stripRichCaretTokens(serializeInlineNode(node)).length;
      if (offset <= cursor + length) {
        const position = findTextPosition(node, offset - cursor);
        if (position) {
          range.setStart(position.node, Math.max(0, Math.min(position.offset, position.node.nodeValue?.length || 0)));
        } else {
          range.setStartBefore(node);
        }
        range.collapse(true);
        return range;
      }
      cursor += length;
      lastNode = node;
    }

    if (lastText?.isConnected) range.setStart(lastText, lastText.nodeValue?.length || 0);
    else if (lastNode?.isConnected) range.setStartAfter(lastNode);
    else range.setStart(block, 0);
    range.collapse(true);
    return range;
  }

  function sourceOffsetToTableDomRange(table, offset) {
    const blockStart = numericData(table, 'sourceStart');
    const blockEnd = numericData(table, 'sourceEnd');
    if (!Number.isFinite(blockStart) || !Number.isFinite(blockEnd)) return null;
    const raw = stripRichCaretTokens(state.markdown || '').slice(blockStart, blockEnd);
    const model = parseMarkdownTableSource(raw);
    if (!model) return null;
    const local = Math.max(0, Math.min(raw.length, offset - blockStart));
    let target = null;
    for (let lineIndex = 0; lineIndex < model.rows.length; lineIndex += 1) {
      if (lineIndex === 1) continue;
      const row = model.rows[lineIndex];
      for (let cellIndex = 0; cellIndex < row.cells.length; cellIndex += 1) {
        const cell = row.cells[cellIndex];
        const start = row.line.start + cell.contentStart;
        const end = row.line.start + cell.contentEnd;
        if (start <= local && local <= end) {
          target = { lineIndex, cellIndex, cell, localOffset: local - start };
          break;
        }
      }
      if (target) break;
    }
    if (!target) return null;
    const domCell = tableDomCellAtSourceLocation(table, target.lineIndex, target.cellIndex);
    return domCell ? tableCellSourceOffsetRange(domCell, target.localOffset) : null;
  }

  function tableDomCellAtSourceLocation(table, lineIndex, cellIndex) {
    if (lineIndex === 0) {
      return table.querySelectorAll('thead > tr > th')[cellIndex] || null;
    }
    if (lineIndex < 2) return null;
    const row = table.querySelectorAll('tbody > tr')[lineIndex - 2] || null;
    return row?.children?.[cellIndex] || null;
  }

  function tableCellSourceOffsetRange(cell, targetOffset) {
    const range = document.createRange();
    const target = Math.max(0, Number(targetOffset) || 0);
    let cursor = 0;
    let lastNode = null;
    let lastText = null;

    for (const node of Array.from(cell.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        const source = serializeTableCellInlineNode(node);
        const length = source.length;
        if (target <= cursor + length) {
          range.setStart(node, Math.max(0, Math.min(node.nodeValue?.length || 0, target - cursor)));
          range.collapse(true);
          return range;
        }
        cursor += length;
        lastText = node;
        lastNode = node;
        continue;
      }

      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      if (node.classList.contains('rich-inline-atom')) {
        const source = stripRichCaretTokens(node.dataset.inlineSource || serializeInlineChildren(node));
        const end = cursor + source.length;
        if (target <= cursor) {
          range.setStartBefore(node);
          range.collapse(true);
          return range;
        }
        if (target < end) {
          if (target - cursor <= source.length / 2) range.setStartBefore(node);
          else range.setStartAfter(node);
          range.collapse(true);
          return range;
        }
        if (target === end) {
          range.setStartAfter(node);
          range.collapse(true);
          return range;
        }
        cursor = end;
        lastNode = node;
        continue;
      }

      if (node.tagName?.toLowerCase() === 'br') {
        const length = 4;
        if (target <= cursor) {
          range.setStartBefore(node);
          range.collapse(true);
          return range;
        }
        if (target <= cursor + length) {
          range.setStartAfter(node);
          range.collapse(true);
          return range;
        }
        cursor += length;
        lastNode = node;
        continue;
      }

      const source = stripRichCaretTokens(serializeTableCellInlineNode(node));
      const length = source.length;
      if (target <= cursor + length) {
        const position = findTextPosition(node, target - cursor);
        if (position) range.setStart(position.node, Math.max(0, Math.min(position.offset, position.node.nodeValue?.length || 0)));
        else range.setStartBefore(node);
        range.collapse(true);
        return range;
      }
      cursor += length;
      lastNode = node;
    }

    if (lastText?.isConnected) range.setStart(lastText, lastText.nodeValue?.length || 0);
    else if (lastNode?.isConnected) range.setStartAfter(lastNode);
    else range.setStart(cell, 0);
    range.collapse(true);
    return range;
  }

  function sourceOffsetToQuoteDomRange(blockquote, offset) {
    const blockStart = numericData(blockquote, 'sourceStart');
    const blockEnd = numericData(blockquote, 'sourceEnd');
    if (!Number.isFinite(blockStart) || !Number.isFinite(blockEnd)) return null;
    const anchor = Array.from(blockquote.querySelectorAll('.rich-line-break-caret-anchor[data-source-offset]'))
      .find((element) => Number(element.dataset.sourceOffset) === offset);
    if (anchor?.firstChild?.nodeType === Node.TEXT_NODE) {
      const range = document.createRange();
      range.setStart(anchor.firstChild, anchor.firstChild.nodeValue.length);
      range.collapse(true);
      state.richLineBreakInputOffset = offset;
      return range;
    }
    const raw = stripRichCaretTokens(state.markdown || '').slice(blockStart, blockEnd);
    const model = parseMarkdownQuoteSource(raw);
    if (!model?.lines?.length) return null;
    const local = Math.max(0, Math.min(raw.length, offset - blockStart));
    let renderedOffset = 0;
    const lines = model.lines;
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (local <= line.line.start + line.contentStart) {
        renderedOffset = line.renderedStart;
        break;
      }
      if (local <= line.line.start + line.contentEnd) {
        renderedOffset = line.renderedStart + (local - line.line.start - line.contentStart);
        break;
      }
      renderedOffset = line.renderedEnd + (index < lines.length - 1 ? 1 : 0);
    }
    return quoteRenderedOffsetRange(blockquote, renderedOffset);
  }

  function quoteRenderedOffsetRange(blockquote, targetOffset) {
    const range = document.createRange();
    const target = Math.max(0, Number(targetOffset) || 0);
    let cursor = 0;
    let lastNode = null;
    let lastText = null;

    for (const node of Array.from(blockquote.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        const source = normalizeRichText(node.nodeValue || '');
        const length = source.length;
        if (target <= cursor + length) {
          range.setStart(node, Math.max(0, Math.min(node.nodeValue?.length || 0, target - cursor)));
          range.collapse(true);
          return range;
        }
        cursor += length;
        lastText = node;
        lastNode = node;
        continue;
      }

      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      if (node.classList.contains('rich-inline-atom')) {
        const source = stripRichCaretTokens(node.dataset.inlineSource || serializeInlineChildren(node));
        const end = cursor + source.length;
        if (target <= cursor) {
          range.setStartBefore(node);
          range.collapse(true);
          return range;
        }
        if (target < end) {
          if (target - cursor <= source.length / 2) range.setStartBefore(node);
          else range.setStartAfter(node);
          range.collapse(true);
          return range;
        }
        if (target === end) {
          range.setStartAfter(node);
          range.collapse(true);
          return range;
        }
        cursor = end;
        lastNode = node;
        continue;
      }

      if (node.tagName?.toLowerCase() === 'br') {
        if (target <= cursor) {
          range.setStartBefore(node);
          range.collapse(true);
          return range;
        }
        if (target <= cursor + 1) {
          range.setStartAfter(node);
          range.collapse(true);
          return range;
        }
        cursor += 1;
        lastNode = node;
        continue;
      }

      const source = stripRichCaretTokens(serializeInlineNode(node));
      const length = source.length;
      if (target <= cursor + length) {
        const position = findTextPosition(node, target - cursor);
        if (position) range.setStart(position.node, Math.max(0, Math.min(position.offset, position.node.nodeValue?.length || 0)));
        else range.setStartBefore(node);
        range.collapse(true);
        return range;
      }
      cursor += length;
      lastNode = node;
    }

    if (lastText?.isConnected) range.setStart(lastText, lastText.nodeValue?.length || 0);
    else if (lastNode?.isConnected) range.setStartAfter(lastNode);
    else range.setStart(blockquote, 0);
    range.collapse(true);
    return range;
  }

  function sourceOffsetToListDomRange(list, offset) {
    const blockStart = numericData(list, 'sourceStart');
    const blockEnd = numericData(list, 'sourceEnd');
    const raw = stripRichCaretTokens(state.markdown || '').slice(blockStart, blockEnd);
    const sourceItems = flatListSourceItems(raw);
    const items = Array.from(list.children).filter((child) => child.tagName?.toLowerCase() === 'li');
    if (!sourceItems.length || sourceItems.length !== items.length) return null;
    const local = Math.max(0, Math.min(raw.length, offset - blockStart));
    let itemIndex = sourceItems.findIndex((sourceItem) => sourceItem.start <= local && local <= sourceItem.end);
    if (itemIndex === -1) {
      itemIndex = sourceItems.findIndex((sourceItem) => local < sourceItem.start);
      if (itemIndex === -1) itemIndex = sourceItems.length - 1;
    }
    const sourceItem = sourceItems[itemIndex];
    const item = items[itemIndex];
    if (!item || !sourceItem?.parsed) return null;
    const contentOffset = Math.max(0, Math.min(visibleTextFromListSourceItem(sourceItem).length, textOffsetFromListItemSourceOffset(sourceItem, local)));
    if (visibleTextFromListSourceItem(sourceItem) === visibleListItemText(item)) {
      const sourceRange = listItemSourceContentOffsetRange(item, contentOffset);
      if (sourceRange) return sourceRange;
    }
    return listItemTextOffsetRange(item, contentOffset);
  }

  function listItemSourceContentOffsetRange(item, targetOffset) {
    if (!item) return null;
    const range = document.createRange();
    const target = Math.max(0, Number(targetOffset) || 0);
    let cursor = 0;
    let lastNode = null;
    let lastText = null;

    for (const node of listItemEditableContentNodes(item)) {
      if (node.nodeType === Node.TEXT_NODE) {
        const source = serializeInlineNode(node);
        const length = source.length;
        if (target <= cursor + length) {
          range.setStart(node, Math.max(0, Math.min(node.nodeValue?.length || 0, target - cursor)));
          range.collapse(true);
          return range;
        }
        cursor += length;
        lastText = node;
        lastNode = node;
        continue;
      }

      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      if (node.classList.contains('task-checkbox')) continue;
      if (node.classList.contains('rich-inline-atom')) {
        const source = stripRichCaretTokens(node.dataset.inlineSource || serializeInlineChildren(node));
        const end = cursor + source.length;
        if (target <= cursor) {
          range.setStartBefore(node);
          range.collapse(true);
          return range;
        }
        if (target < end) {
          if (target - cursor <= source.length / 2) range.setStartBefore(node);
          else range.setStartAfter(node);
          range.collapse(true);
          return range;
        }
        if (target === end) {
          range.setStartAfter(node);
          range.collapse(true);
          return range;
        }
        cursor = end;
        lastNode = node;
        continue;
      }

      const tag = node.tagName?.toLowerCase();
      if (tag === 'br') {
        if (target <= cursor + 1) {
          range.setStartAfter(node);
          range.collapse(true);
          return range;
        }
        cursor += 1;
        lastNode = node;
        continue;
      }

      const source = stripRichCaretTokens(serializeInlineNode(node));
      const length = source.length;
      if (target <= cursor + length) {
        const position = findTextPosition(node, target - cursor);
        if (position) range.setStart(position.node, Math.max(0, Math.min(position.offset, position.node.nodeValue?.length || 0)));
        else range.setStartBefore(node);
        range.collapse(true);
        return range;
      }
      cursor += length;
      lastNode = node;
    }

    if (lastText?.isConnected) range.setStart(lastText, lastText.nodeValue?.length || 0);
    else if (lastNode?.isConnected) range.setStartAfter(lastNode);
    else range.setStart(item, item.childNodes.length);
    range.collapse(true);
    return range;
  }

  function listItemTextOffsetRange(item, targetOffset) {
    const range = document.createRange();
    const anchor = item.querySelector(':scope > .rich-list-caret-anchor');
    if (anchor?.firstChild?.nodeType === Node.TEXT_NODE) {
      range.setStart(anchor.firstChild, anchor.firstChild.nodeValue.length);
      range.collapse(true);
      return range;
    }
    const position = findListItemVisibleTextPosition(item, targetOffset) || findListItemTextPosition(item, targetOffset);
    if (position) {
      if (position.beforeNode) range.setStartBefore(position.beforeNode);
      else if (position.afterNode) range.setStartAfter(position.afterNode);
      else range.setStart(position.node, position.offset);
      range.collapse(true);
      return range;
    }
    const textNode = document.createTextNode('\u200b');
    const children = Array.from(item.childNodes);
    const firstEditableIndex = children.findIndex((child) => !(child.nodeType === 1 && child.classList.contains('task-checkbox')));
    if (firstEditableIndex >= 0) {
      item.insertBefore(textNode, children[firstEditableIndex]);
    } else {
      item.appendChild(textNode);
    }
    range.setStart(textNode, 1);
    range.collapse(true);
    return range;
  }

  function findListItemVisibleTextPosition(item, targetOffset) {
    const segments = [];
    const visit = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const raw = normalizeRichText(node.nodeValue || '');
        const beforeHardBreak = node.nextSibling?.nodeType === Node.ELEMENT_NODE
          && node.nextSibling.tagName?.toLowerCase() === 'br';
        const visibleLength = beforeHardBreak ? raw.replace(/[ \t]{2}$/, '').length : raw.length;
        segments.push({ type: 'text', node, length: visibleLength });
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      if (nodeClosest(node, 'li') !== item) return;
      if (node.classList.contains('task-checkbox')) return;
      if (node.parentElement?.closest('.rich-source-editor, .code-language-input')) return;
      const tag = node.tagName?.toLowerCase();
      if (tag === 'ul' || tag === 'ol') return;
      if (tag === 'br') {
        segments.push({ type: 'break', node, length: 1 });
        return;
      }
      Array.from(node.childNodes).forEach(visit);
    };
    listItemEditableContentNodes(item).forEach(visit);

    let consumed = 0;
    let lastText = null;
    const target = Math.max(0, Number(targetOffset) || 0);
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      if (segment.type === 'text') {
        lastText = segment;
        if (target <= consumed + segment.length) {
          return { node: segment.node, offset: Math.max(0, Math.min(segment.node.nodeValue.length, target - consumed)) };
        }
        consumed += segment.length;
        continue;
      }
      if (target <= consumed + 1) {
        const nextText = segments.slice(index + 1).find((itemSegment) => itemSegment.type === 'text');
        if (nextText) return { node: nextText.node, offset: 0 };
        return { afterNode: segment.node };
      }
      consumed += 1;
    }
    return lastText ? { node: lastText.node, offset: Math.min(lastText.node.nodeValue.length, lastText.length) } : null;
  }

  function inlineAtomForSourceOffset(offset, affinity) {
    const atoms = Array.from(els.rich.querySelectorAll('.rich-inline-atom[data-src-start][data-src-end]'));
    return atoms.find((atom) => {
      const start = Number(atom.dataset.srcStart);
      const end = Number(atom.dataset.srcEnd);
      if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
      if (affinity === 'before') return offset === start;
      if (affinity === 'after') return offset === end;
      return start <= offset && offset <= end;
    }) || null;
  }

  function renderedBlockForSourceOffset(container, offset) {
    const blocks = Array.from(container.querySelectorAll(RICH_SOURCE_BLOCK_SELECTOR));
    const direct = blocks.find((block) => {
      const start = numericData(block, 'sourceStart');
      const end = numericData(block, 'sourceEnd');
      return start <= offset && offset <= end;
    });
    if (direct) return direct;
    const markdown = stripRichCaretTokens(state.markdown || els.source?.value || '');
    return blocks.find((block) => {
      const start = numericData(block, 'sourceStart');
      const end = numericData(block, 'sourceEnd');
      if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
      if (offset !== end + 1 || markdown[end] !== '\n') return false;
      return /[ \t]{2}$/.test(markdown.slice(start, end));
    }) || null;
  }

  function textOffsetWithinElement(element, container, offset) {
    const range = document.createRange();
    range.selectNodeContents(element);
    try {
      range.setEnd(container, offset);
      return range.toString().length;
    } catch (_) {
      return 0;
    }
  }

  function sourceContentBaseOffset(sourceBlock) {
    const blockStart = numericData(sourceBlock, 'sourceStart');
    const blockEnd = numericData(sourceBlock, 'sourceEnd');
    const raw = stripRichCaretTokens(state.markdown || '').slice(blockStart, blockEnd);
    if (sourceBlock.tagName?.toLowerCase()?.match(/^h[1-6]$/)) {
      const match = raw.match(/^(\s*#{1,6}\s+)/);
      return match ? match[1].length : 0;
    }
    return 0;
  }

  function restoreRichInlineSourceCaret(bookmark) {
    const candidates = richInlineSourceLikeElementsInOrder();
    const exactIndexCandidate = candidates[bookmark.inlineIndex];
    const source = normalizeNewlines(bookmark.source || '');
    const candidate = exactIndexCandidate && richInlineSourceFromElement(exactIndexCandidate) === source
      ? exactIndexCandidate
      : candidates.find((element) => richInlineSourceFromElement(element) === source);
    if (!candidate) return false;
    activateRichInlineSource(candidate, Math.max(0, bookmark.sourceOffset || 0));
    return true;
  }

  function findTextPosition(root, targetOffset) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (node.parentElement?.closest('.rich-source-editor, .code-language-input')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let consumed = 0;
    let last = null;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      last = node;
      const length = node.nodeValue.length;
      if (consumed + length >= targetOffset) {
        return { node, offset: Math.max(0, targetOffset - consumed) };
      }
      consumed += length;
    }
    return last ? { node: last, offset: last.nodeValue.length } : null;
  }

  function updateTaskCheckbox(input) {
    if (els.rich.contains(input)) {
      const sourceTransaction = taskCheckboxToggleTransaction(input, input.closest?.('li'));
      if (sourceTransaction) {
        applySourceTransaction(sourceTransaction, 'task-toggle');
      } else if (guardFailedRichSourceControlTransaction(input, 'task-toggle', 'チェックリストの位置を特定できませんでした')) {
        return;
      } else {
        syncRichMarkdownFromDom('task-toggle');
      }
      setStatus(input.checked ? 'チェックを付けました' : 'チェックを外しました');
      return;
    }
    const position = Number(input.dataset.taskPos);
    if (!Number.isInteger(position) || !/^[ xX]$/.test(state.markdown[position] || '')) {
      renderAll('task-toggle-invalid');
      setStatus('チェックリストの位置を特定できませんでした');
      return;
    }
    const mark = input.checked ? 'x' : ' ';
    state.markdown = state.markdown.slice(0, position) + mark + state.markdown.slice(position + 1);
    els.source.value = state.markdown;
    syncCodeMirrorSourceFromTextarea('task-toggle');
    markDirty();
    renderAll('task-toggle');
    persistDraft();
    setStatus(input.checked ? 'チェックを付けました' : 'チェックを外しました');
  }

  function updateCodeBlockLanguage(input) {
    if (els.rich.contains(input)) {
      const language = safeCodeLanguage(input.value || '');
      const editingPre = input.closest('pre.code-block.is-editing-source');
      if (editingPre) {
        editingPre.dataset.codeLanguage = language;
        setStatus(language ? `コード言語: ${language}` : 'コード言語を未指定にしました');
        return;
      }
      const sourceTransaction = codeBlockLanguageTransaction(input);
      if (sourceTransaction) {
        applySourceTransaction(sourceTransaction, 'code-language');
        refocusCodeLanguageInput(sourceTransaction.codeStart, language);
      } else if (guardFailedRichSourceControlTransaction(input, 'code-language', 'コードブロックの言語行を更新できませんでした')) {
        return;
      } else {
        syncRichMarkdownFromDom('code-language', { refreshRich: true });
      }
      setStatus(language ? `コード言語: ${language}` : 'コード言語を未指定にしました');
      return;
    }
    const start = Number(input.dataset.codeStart);
    const end = Number(input.dataset.codeEnd);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start) {
      setStatus('コードブロックの位置を特定できませんでした');
      return;
    }
    const lineEnd = state.markdown.indexOf('\n', start);
    const fenceEnd = lineEnd === -1 || lineEnd > end ? end : lineEnd;
    const fenceLine = state.markdown.slice(start, fenceEnd);
    const match = fenceLine.match(/^(\s*```)\s*([A-Za-z0-9_+.-]*)\s*$/);
    if (!match) {
      setStatus('コードブロックの言語行を更新できませんでした');
      return;
    }
    const language = safeCodeLanguage(input.value || '');
    const replacement = `${match[1]}${language}`;
    state.markdown = state.markdown.slice(0, start) + replacement + state.markdown.slice(fenceEnd);
    els.source.value = state.markdown;
    syncCodeMirrorSourceFromTextarea('code-language');
    markDirty();
    renderAll('code-language');
    persistDraft();
    setStatus(language ? `コード言語: ${language}` : 'コード言語を未指定にしました');
  }

  function guardFailedRichSourceControlTransaction(control, reason, status) {
    const sourceBlock = nodeClosest(control, RICH_SOURCE_BLOCK_SELECTOR);
    if (!sourceBlock || !els.rich.contains(sourceBlock)) return false;
    renderAll(`${reason}-revert`);
    setStatus(status);
    suppressRichInlineActivation();
    return true;
  }

  function codeBlockLanguageTransaction(input) {
    const sourceRange = codeBlockLanguageSourceRange(input);
    const start = sourceRange?.start;
    const end = sourceRange?.end;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start) return null;
    const markdown = stripRichCaretTokens(state.markdown || els.source.value || '');
    if (start >= markdown.length || end > markdown.length) return null;
    const lineEnd = markdown.indexOf('\n', start);
    const fenceEnd = lineEnd === -1 || lineEnd > end ? end : lineEnd;
    const fenceLine = markdown.slice(start, fenceEnd);
    const match = fenceLine.match(/^(\s*```)\s*([A-Za-z0-9_+.-]*)\s*$/);
    if (!match) return null;
    const language = safeCodeLanguage(input.value || '');
    const replacement = `${match[1]}${language}`;
    return {
      from: start,
      to: fenceEnd,
      insert: replacement,
      codeStart: start,
      selectionAfter: {
        anchor: start + replacement.length,
        focus: start + replacement.length,
        affinity: 'after',
      },
    };
  }

  function codeBlockLanguageSourceRange(input) {
    const dataStart = Number(input?.dataset?.codeStart);
    const dataEnd = Number(input?.dataset?.codeEnd);
    if (Number.isInteger(dataStart) && Number.isInteger(dataEnd) && dataStart >= 0 && dataEnd > dataStart) {
      return { start: dataStart, end: dataEnd };
    }
    const pre = input?.closest?.('pre.code-block');
    if (!pre?.matches?.(RICH_SOURCE_BLOCK_SELECTOR) || !els.rich.contains(pre)) return null;
    const start = numericData(pre, 'sourceStart');
    const end = numericData(pre, 'sourceEnd');
    return Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end > start
      ? { start, end }
      : null;
  }

  function refocusCodeLanguageInput(codeStart, language) {
    if (state.mode !== 'rich' || !els.rich) return;
    const nextInput = Array.from(els.rich.querySelectorAll('.code-language-input'))
      .find((element) => Number(element.dataset.codeStart) === codeStart);
    if (!nextInput) return;
    nextInput.focus({ preventScroll: true });
    const offset = String(language || '').length;
    try {
      nextInput.setSelectionRange(offset, offset);
    } catch (_) {}
  }

  function taskCheckboxToggleTransaction(input, item = null) {
    const datasetPosition = Number(input?.dataset?.taskPos);
    const markerRange = Number.isInteger(datasetPosition)
      ? null
      : richTaskCheckboxMarkerRangeFromItem(item || input?.closest?.('li'));
    const position = Number.isInteger(datasetPosition) ? datasetPosition : (markerRange?.from ?? NaN) + 1;
    if (!Number.isInteger(position) || !/^[ xX]$/.test(state.markdown[position] || '')) return null;
    return {
      from: position,
      to: position + 1,
      insert: input.checked ? 'x' : ' ',
      selectionAfter: {
        anchor: position + 1,
        focus: position + 1,
        affinity: 'after',
      },
    };
  }

  function removeRichTaskCheckboxTransaction(input, item = null) {
    const position = Number(input?.dataset?.taskPos);
    let markerStart = NaN;
    let markerEnd = NaN;
    if (Number.isInteger(position)) {
      markerStart = position - 1;
      markerEnd = position + 3;
    } else {
      const markerRange = richTaskCheckboxMarkerRangeFromItem(item || input?.closest?.('li'));
      markerStart = markerRange?.from ?? NaN;
      markerEnd = markerRange?.to ?? NaN;
    }
    if (markerStart < 0 || markerEnd > state.markdown.length || markerEnd <= markerStart) return null;
    if (!/^\[[ xX]\]\s/.test(state.markdown.slice(markerStart, markerEnd))) return null;
    return {
      from: markerStart,
      to: markerEnd,
      insert: '',
      selectionAfter: {
        anchor: markerStart,
        focus: markerStart,
        affinity: 'after',
      },
    };
  }

  function richTaskCheckboxMarkerRangeFromItem(item) {
    if (!item || !els.rich.contains(item)) return null;
    const list = item.closest('ul, ol');
    if (!list?.matches?.(RICH_SOURCE_BLOCK_SELECTOR) || item.parentElement !== list) return null;
    const blockStart = numericData(list, 'sourceStart');
    const blockEnd = numericData(list, 'sourceEnd');
    if (!Number.isFinite(blockStart) || !Number.isFinite(blockEnd)) return null;
    const raw = stripRichCaretTokens(state.markdown || '').slice(blockStart, blockEnd);
    const sourceItems = flatListSourceItems(raw);
    const items = Array.from(list.children).filter((child) => child.tagName?.toLowerCase() === 'li');
    const itemIndex = items.indexOf(item);
    if (itemIndex < 0 || sourceItems.length !== items.length) return null;
    const sourceItem = sourceItems[itemIndex];
    const firstLine = sourceItem?.lines?.[0];
    if (!sourceItem?.parsed?.task || !firstLine) return null;
    const marker = String(firstLine.text || '').match(/^(\s*(?:[-+*]|\d+\.)\s+)(\[[ xX]\]\s+)/);
    if (!marker) return null;
    return {
      from: blockStart + firstLine.start + marker[1].length,
      to: blockStart + firstLine.start + marker[1].length + marker[2].length,
    };
  }

  function activateRichInlineSource(element, position = 'end') {
    if (!element || element.classList.contains('rich-inline-source')) return;
    const active = state.richInlineSource?.element;
    if (active && active !== element) {
      commitRichInlineSource(active);
      return;
    }

    const source = stripRichCaretTokens(richInlineSourceFromElement(element));
    if (!source) return;
    const span = document.createElement('span');
    span.className = 'rich-inline-source';
    span.contentEditable = 'true';
    span.spellcheck = false;
    span.dataset.inlineSource = source;
    if (element.classList?.contains('rich-inline-atom')) {
      if (element.dataset.srcStart) span.dataset.srcStart = element.dataset.srcStart;
      if (element.dataset.srcEnd) span.dataset.srcEnd = element.dataset.srcEnd;
    }
    span.setAttribute('role', 'textbox');
    span.setAttribute('aria-label', 'インラインMarkdownソース');
    span.textContent = source;

    state.richSelectionLock = true;
    element.replaceWith(span);
    state.richInlineSource = { element: span, undoCaptured: false };
    placeCaretInInlineSource(span, position);
    state.richSelectionLock = false;
  }

  function commitRichInlineSource(sourceElement = state.richInlineSource?.element, options = {}) {
    if (!sourceElement) return false;
    if (!sourceElement.isConnected) {
      if (state.richInlineSource?.element === sourceElement) state.richInlineSource = null;
      return false;
    }

    const block = nodeClosest(sourceElement, RICH_INLINE_EDIT_BLOCK_SELECTOR);
    const source = stripRichCaretTokens(normalizeNewlines(sourceElement.textContent || ''));
    const alreadySynced = isRichInlineSourceAlreadySynced();
    const sourceTransaction = !options.caretToken && !alreadySynced
      ? richInlineSourceCommitTransaction(sourceElement, source)
      : null;
    if (sourceTransaction) {
      if (state.richInlineSource?.element === sourceElement) state.richInlineSource = null;
      applySourceTransaction(sourceTransaction, 'rich-inline-source-commit');
      return true;
    }
    const fragment = renderRichInlineSourceFragment(source);
    state.richSelectionLock = true;
    if (state.richInlineSource?.element === sourceElement) state.richInlineSource = null;
    sourceElement.replaceWith(fragment);
    if (block && els.rich.contains(block)) {
      reparseRichInlineEditBlockContent(block, { caretToken: options.caretToken || '' });
    }
    configureRichEditableSurface();
    finalizeRichProjectionChange('rich-input');
    state.richSelectionLock = false;
    return true;
  }

  function isRichInlineSourceAlreadySynced() {
    return stripRichCaretTokens(serializeRichMarkdown(els.rich)) === stripRichCaretTokens(state.markdown || '');
  }

  function finalizeRichProjectionChange(reason = 'rich-input') {
    sanitizeRichCaretTokensInDom(els.rich);
    if (stripRichCaretTokens(serializeRichMarkdown(els.rich)) === stripRichCaretTokens(state.markdown || '')) {
      refreshRichSourceRangesFromMarkdown();
      scheduleRender(reason);
      return true;
    }
    syncRichMarkdownFromDom(reason);
    return false;
  }

  function richInlineSourceCommitTransaction(sourceElement, source) {
    const start = Number(sourceElement?.dataset?.srcStart);
    const end = Number(sourceElement?.dataset?.srcEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
    const insert = stripRichCaretTokens(source || '');
    const nextOffset = start + insert.length;
    return {
      from: start,
      to: end,
      insert,
      selectionAfter: {
        anchor: nextOffset,
        focus: nextOffset,
        affinity: 'after',
      },
    };
  }

  function placeCaretInInlineSource(element, position) {
    const text = element.firstChild || element.appendChild(document.createTextNode(''));
    const offset = Number.isInteger(position)
      ? Math.max(0, Math.min(position, text.nodeValue.length))
      : position === 'start' ? 0 : text.nodeValue.length;
    const range = document.createRange();
    range.setStart(text, offset);
    range.collapse(true);
    const selection = window.getSelection?.();
    if (!selection) return;
    selection.removeAllRanges();
    selection.addRange(range);
    element.focus();
  }

  function renderRichInlineSourceFragment(source) {
    const normalized = stripRichCaretTokens(normalizeNewlines(source || ''));
    if (richInlineSourceShouldStayLiteral(normalized)) {
      const fragment = document.createDocumentFragment();
      if (normalized) fragment.appendChild(document.createTextNode(normalized));
      return fragment;
    }

    const template = document.createElement('template');
    template.innerHTML = renderInlineMarkdown(normalized);
    enhanceRenderedHtml(template.content);
    return template.content;
  }

  function reparseRichInlineEditBlockContent(block, options = {}) {
    if (!block || !els.rich.contains(block)) return false;
    let marker = null;
    const caretToken = options.caretToken || (options.range ? richCaretToken() : '');
    if (options.range) {
      marker = document.createTextNode(caretToken);
      insertRichInlineReparseMarker(block, options.range, marker);
    }

    const markdownWithCaret = caretToken
      ? serializeRichInlineEditBlockContentPreservingCaret(block)
      : serializeRichInlineEditBlockContent(block);
    const tokenSelection = caretToken
      ? sourceSelectionFromRichInlineContentIndex(block, markdownWithCaret.indexOf(caretToken))
      : null;
    const markdown = stripRichCaretTokens(markdownWithCaret);
    const fragment = renderRichInlineSourceFragment(markdown);
    replaceRichInlineEditBlockContent(block, fragment);
    wrapRenderedInlineAtoms(block);
    stabilizeReparsedRichInlineBlock(block);
    configureRichEditableSurface();

    if (caretToken) {
      if (
        !(tokenSelection && restoreRichCaretFromSourceSelection(tokenSelection))
        && !(options.sourceSelection && restoreRichCaretFromSourceSelection(options.sourceSelection))
      ) {
        restoreCaretFromTextToken(block, caretToken);
      }
    } else if (marker?.isConnected) {
      marker.remove();
    }
    sanitizeRichCaretTokensInDom(block);
    suppressRichInlineActivation();
    return true;
  }

  function sourceSelectionFromRichInlineContentIndex(block, index) {
    if (!Number.isFinite(index) || index < 0) return null;
    let offset = null;
    if (block?.tagName?.toLowerCase() === 'li') {
      const listPoint = richListSourcePointFromContentIndex(block, index);
      offset = listPoint?.offset ?? null;
    } else {
      const sourceBlock = nodeClosest(block, RICH_SOURCE_BLOCK_SELECTOR);
      if (!sourceBlock) return null;
      const start = numericData(sourceBlock, 'sourceStart');
      if (!Number.isFinite(start)) return null;
      offset = start + sourceContentBaseOffset(sourceBlock) + index;
    }
    if (!Number.isFinite(offset)) return null;
    return {
      anchor: offset,
      focus: offset,
      affinity: 'after',
    };
  }

  function richListSourcePointFromContentIndex(item, index) {
    const list = item.closest('ul, ol');
    if (!list?.matches?.(RICH_SOURCE_BLOCK_SELECTOR) || item.parentElement !== list) return null;
    const blockStart = numericData(list, 'sourceStart');
    const blockEnd = numericData(list, 'sourceEnd');
    if (!Number.isFinite(blockStart) || !Number.isFinite(blockEnd)) return null;
    const raw = stripRichCaretTokens(state.markdown || '').slice(blockStart, blockEnd);
    const sourceItems = flatListSourceItems(raw);
    const items = Array.from(list.children).filter((child) => child.tagName?.toLowerCase() === 'li');
    const itemIndex = items.indexOf(item);
    if (itemIndex < 0 || sourceItems.length !== items.length) return null;
    const sourceItem = sourceItems[itemIndex];
    if (!sourceItem?.parsed) return null;
    const content = visibleTextFromListSourceItem(sourceItem);
    if (content !== visibleListItemText(item)) return null;
    const bounded = Math.max(0, Math.min(index, content.length));
    return {
      offset: blockStart + sourceOffsetFromListItemTextOffset(sourceItem, bounded),
    };
  }

  function stabilizeReparsedRichInlineBlock(block) {
    if (!block || !els.rich.contains(block)) return false;
    const changed = parsePendingRichInlineMarkdownInBlock(block);
    wrapRenderedInlineAtoms(block);
    return changed;
  }

  function insertRichInlineReparseMarker(block, range, marker) {
    const inlineElement = validRichInlineSourceElement(nodeElement(range.startContainer)?.closest?.(RICH_INLINE_SOURCE_SELECTOR));
    if (inlineElement && isSameRichInlineEditBlock(inlineElement, block)) {
      const offset = richInlineElementTextOffsetForRange(inlineElement, range);
      const length = normalizeRichText(inlineElement.textContent || '').length;
      if (offset <= 0) {
        inlineElement.before(marker);
        return;
      }
      if (offset >= length) {
        inlineElement.after(marker);
        return;
      }
    }
    range.insertNode(marker);
  }

  function richCaretToken() {
    return `@PME_CARET_${Math.random().toString(36).slice(2)}_${Date.now()}@`;
  }

  function serializeRichInlineEditBlockContent(block) {
    return serializeInlineNodes(richInlineEditBlockContentNodes(block));
  }

  function serializeRichInlineEditBlockContentPreservingCaret(block) {
    return serializeInlineNodesPreservingCaret(richInlineEditBlockContentNodes(block));
  }

  function serializeInlineNodesPreservingCaret(nodes) {
    return nodes.map((node) => serializeInlineNodePreservingCaret(node)).join('').replace(/[ \t]+\n/g, '\n');
  }

  function serializeInlineNodePreservingCaret(node) {
    if (node.nodeType === Node.TEXT_NODE) return String(node.nodeValue || '').replace(/\u00a0/g, ' ').replace(/\u200b/g, '');
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const element = node;
    if (element.classList.contains('rich-inline-source')) return normalizeNewlines(element.textContent || '');
    if (element.classList.contains('rich-inline-atom')) return stripRichCaretTokens(element.dataset.inlineSource || serializeInlineChildren(element));
    if (element.classList.contains('rich-list-caret-anchor')) return String(element.textContent || '').replace(/\u200b/g, '');
    if (element.classList.contains('rich-line-break-caret-anchor')) return String(element.textContent || '').replace(/\u200b/g, '');
    if (element.classList.contains('code-language-input') || element.classList.contains('task-checkbox')) return '';
    const tag = element.tagName.toLowerCase();
    if (tag === 'br') return '\n';
    if (tag === 'strong' || tag === 'b') return `**${serializeInlineNodesPreservingCaret(Array.from(element.childNodes)).trim()}**`;
    if (tag === 'em' || tag === 'i') return `*${serializeInlineNodesPreservingCaret(Array.from(element.childNodes)).trim()}*`;
    if (tag === 'del' || tag === 's') return `~~${serializeInlineNodesPreservingCaret(Array.from(element.childNodes)).trim()}~~`;
    if (tag === 'code' && !element.closest('pre')) return markdownCodeSpan(element.textContent || '');
    return serializeInlineNodesPreservingCaret(Array.from(element.childNodes));
  }

  function richInlineEditBlockContentNodes(block) {
    if (!block) return [];
    if (block.tagName?.toLowerCase() !== 'li') return Array.from(block.childNodes);
    return Array.from(block.childNodes).filter((child) => {
      if (child.nodeType !== Node.ELEMENT_NODE) return true;
      const tag = child.tagName?.toLowerCase();
      if (tag === 'ul' || tag === 'ol') return false;
      return !child.classList.contains('task-checkbox');
    });
  }

  function replaceRichInlineEditBlockContent(block, fragment) {
    if (block.tagName?.toLowerCase() !== 'li') {
      block.replaceChildren(fragment);
      ensureRichTextBlockPlaceholder(block);
      return;
    }

    for (const node of richInlineEditBlockContentNodes(block)) node.remove();
    const nestedList = Array.from(block.children).find((child) => ['ul', 'ol'].includes(child.tagName?.toLowerCase()));
    if (nestedList) {
      block.insertBefore(fragment, nestedList);
    } else {
      block.appendChild(fragment);
    }
    ensureListItemEditablePlaceholder(block);
  }

  function restoreCaretFromTextToken(root, token) {
    if (!token) return false;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const index = (node.nodeValue || '').indexOf(token);
      if (index === -1) continue;
      node.nodeValue = (node.nodeValue || '').slice(0, index) + (node.nodeValue || '').slice(index + token.length);
      sanitizeRichCaretTokensInDom(root);
      placeCaretInTextNode(node, index);
      return true;
    }
    const sourceElement = Array.from(root.querySelectorAll('.rich-inline-source, .rich-inline-atom'))
      .find((element) => String(element.dataset.inlineSource || '').includes(token));
    if (sourceElement) {
      const rawSource = String(sourceElement.dataset.inlineSource || '');
      const index = rawSource.indexOf(token);
      const cleaned = stripRichCaretTokens(rawSource);
      sourceElement.dataset.inlineSource = cleaned;
      sanitizeRichCaretTokensInDom(root);
      if (sourceElement.classList.contains('rich-inline-source')) {
        sourceElement.textContent = stripRichCaretTokens(sourceElement.textContent || cleaned);
        placeCaretInInlineSource(sourceElement, Math.max(0, Math.min(index, sourceElement.textContent.length)));
      } else if (index <= 0) {
        placeCaretAtInlineBoundary(sourceElement, 'before');
      } else if (index >= cleaned.length) {
        placeCaretAtInlineBoundary(sourceElement, 'after');
      } else {
        activateRichInlineSource(sourceElement, Math.max(0, Math.min(index, cleaned.length)));
      }
      return true;
    }
    sanitizeRichCaretTokensInDom(root);
    return false;
  }

  function sanitizeRichCaretTokensInDom(root) {
    if (!root) return;
    const textWalker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (textWalker.nextNode()) {
      const node = textWalker.currentNode;
      const cleaned = stripRichCaretTokens(node.nodeValue || '');
      if (cleaned !== node.nodeValue) node.nodeValue = cleaned;
    }

    if (!root.querySelectorAll) return;
    root.querySelectorAll('[data-inline-source], [data-rich-source], [data-mermaid-source], [data-math-source]').forEach((element) => {
      ['inlineSource', 'richSource', 'mermaidSource', 'mathSource'].forEach((key) => {
        if (!Object.prototype.hasOwnProperty.call(element.dataset, key)) return;
        element.dataset[key] = stripRichCaretTokens(element.dataset[key] || '');
      });
    });
  }

  function sanitizeRichCaretTokensInDomPreservingSelection(root) {
    if (!root) return;
    const selection = window.getSelection?.();
    const activeNode = selection?.rangeCount && root.contains(selection.anchorNode)
      ? selection.anchorNode
      : null;
    const activeOffset = selection?.rangeCount ? selection.anchorOffset : 0;
    let nextSelection = null;

    const textWalker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (textWalker.nextNode()) nodes.push(textWalker.currentNode);

    for (const node of nodes) {
      const value = node.nodeValue || '';
      if (!RICH_CARET_TOKEN_PATTERN.test(value)) {
        RICH_CARET_TOKEN_PATTERN.lastIndex = 0;
        continue;
      }
      RICH_CARET_TOKEN_PATTERN.lastIndex = 0;
      const cleaned = stripRichCaretTokens(value);
      if (node === activeNode) {
        nextSelection = {
          node,
          offset: stripRichCaretTokens(value.slice(0, activeOffset)).length,
        };
      }
      node.nodeValue = cleaned;
    }

    sanitizeRichCaretTokensInDom(root);
    if (nextSelection?.node?.isConnected) {
      placeCaretInTextNode(
        nextSelection.node,
        Math.max(0, Math.min(nextSelection.offset, nextSelection.node.nodeValue?.length || 0)),
      );
    }
  }

  function stripRichCaretTokens(value) {
    return String(value || '').replace(RICH_CARET_TOKEN_PATTERN, '');
  }

  function richInlineSourceShouldStayLiteral(source) {
    const text = String(source || '');
    if (!text) return false;
    if (hasAmbiguousStrongDelimiterNeighborhood(text)) return true;
    if (isCompleteSingleRichInlineMarkdownSource(text)) return false;
    return (
      text.startsWith('~~') || text.endsWith('~~')
      || text.startsWith('`') || text.endsWith('`')
      || text.startsWith('$') || text.endsWith('$')
    );
  }

  function isCompleteSingleRichInlineMarkdownSource(source) {
    return Boolean(String(source || '').match(/^(?:!\[[^\]\n]*\]\((?:<[^>\n]+>|[^)\n]+)\)|\[[^\]\n]+\]\((?:<[^>\n]+>|[^)\n]+)\)|`[^`\n]+`|~~[^~\n]+~~|\*\*[^*\n]+?\*\*|__[^_\n]+?__|\*[^*\n]+\*|_[^_\n]+_|\$\$[^\n$]+?\$\$|\$[^\s$][^\n$]*?\$|\\\([^)]+\\\))$/));
  }

  function richInlineSourceFromElement(element) {
    if (!element) return '';
    const atom = element.classList?.contains('rich-inline-atom')
      ? element
      : element.closest?.('.rich-inline-atom');
    if (atom && els.rich.contains(atom)) {
      return stripRichCaretTokens(atom.dataset.inlineSource || serializeInlineChildren(atom));
    }
    const tag = element.tagName?.toLowerCase();
    if (tag === 'strong' || tag === 'b') return `**${serializeInlineChildren(element).trim()}**`;
    if (tag === 'em' || tag === 'i') return `*${serializeInlineChildren(element).trim()}*`;
    if (tag === 'del' || tag === 's') return `~~${serializeInlineChildren(element).trim()}~~`;
    if (tag === 'code' && !element.closest('pre')) return markdownCodeSpan(element.textContent || '');
    if (tag === 'a') return serializeLinkElement(element);
    if (tag === 'img') return serializeImageElement(element);
    if (element.classList?.contains('math-inline')) return serializeMathElement(element);
    if (element.classList?.contains('blocked-image')) return serializeBlockedImageElement(element);
    return '';
  }

  function wrapRenderedInlineAtoms(root) {
    if (!root?.querySelectorAll) return;
    const candidates = Array.from(root.querySelectorAll('strong, b, em, i, del, s, code, a, img, .math-inline, .blocked-image'));
    for (const element of candidates) {
      if (!shouldWrapRichInlineAtom(element)) continue;
      const source = richInlineSourceFromElement(element);
      if (!source) continue;
      const wrapper = document.createElement('span');
      wrapper.className = 'rich-inline-atom';
      wrapper.contentEditable = 'false';
      wrapper.dataset.inlineRun = inlineAtomKind(element);
      wrapper.dataset.kind = wrapper.dataset.inlineRun;
      wrapper.dataset.inlineSource = stripRichCaretTokens(source);
      element.replaceWith(wrapper);
      wrapper.appendChild(element);
    }
  }

  function annotateRenderedInlineAtomRanges(root) {
    if (!root?.querySelectorAll) return;
    const markdown = stripRichCaretTokens(state.markdown || els.source?.value || '');
    const blocks = Array.from(root.querySelectorAll('[data-source-start][data-source-end]'));
    for (const block of blocks) {
      const start = numericData(block, 'sourceStart');
      const end = numericData(block, 'sourceEnd');
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) continue;
      const source = markdown.slice(start, end);
      const runs = inlineRunsForBlockSource(source, start);
      if (!runs.length) continue;
      const used = new Set();
      for (const atom of Array.from(block.querySelectorAll('.rich-inline-atom'))) {
        const run = matchingInlineRunForAtom(atom, runs, used);
        if (!run) continue;
        used.add(run);
        atom.dataset.srcStart = String(run.sourceStart);
        atom.dataset.srcEnd = String(run.sourceEnd);
        atom.dataset.contentStart = String(run.contentStart ?? run.sourceStart);
        atom.dataset.contentEnd = String(run.contentEnd ?? run.sourceEnd);
      }
    }
  }

  function matchingInlineRunForAtom(atom, runs, used) {
    const kind = atom.dataset.kind || atom.dataset.inlineRun || '';
    const source = stripRichCaretTokens(atom.dataset.inlineSource || '');
    const text = normalizeRichText(atom.textContent || '');
    const exact = runs.find((run) => !used.has(run) && run.kind === kind && run.source === source);
    if (exact) return exact;
    return runs.find((run) => !used.has(run) && run.kind === kind && normalizeRichText(run.text) === text) || null;
  }

  function inlineRunsForBlockSource(source, baseOffset = 0) {
    const runs = [];
    const text = String(source || '');
    let index = 0;
    while (index < text.length) {
      const run = inlineRunAt(text, index, baseOffset);
      if (!run) {
        index += 1;
        continue;
      }
      runs.push(run);
      index += Math.max(1, run.source.length);
    }
    return runs;
  }

  function inlineRunAt(text, index, baseOffset) {
    const rest = text.slice(index);
    const patterns = [
      { kind: 'image', pattern: /^!\[([^\]\n]*)\]\((<[^>\n]+>|[^)\n]+)\)/, contentGroup: 1 },
      { kind: 'link', pattern: /^\[([^\]\n]+)\]\((<[^>\n]+>|[^)\n]+)\)/, contentGroup: 1 },
      { kind: 'code', pattern: /^`([^`\n]+)`/, contentGroup: 1 },
      { kind: 'del', pattern: /^~~([^~\n]+)~~/, contentGroup: 1 },
      { kind: 'strong', pattern: /^\*\*([^*\n]+?)\*\*/, contentGroup: 1 },
      { kind: 'strong', pattern: /^__([^_\n]+?)__/, contentGroup: 1 },
      { kind: 'math', pattern: /^\$\$([^\n$]+?)\$\$/, contentGroup: 1 },
      { kind: 'math', pattern: /^\$([^\s$][^\n$]*?)\$/, contentGroup: 1 },
      { kind: 'math', pattern: /^\\\(([^)]+)\\\)/, contentGroup: 1 },
    ];
    for (const item of patterns) {
      const match = rest.match(item.pattern);
      if (!match) continue;
      return inlineRunFromMatch(item.kind, match, index, baseOffset, item.contentGroup);
    }

    if (rest[0] === '*' && rest[1] !== '*' && canOpenSingleDelimiterAt(text, index, '*')) {
      const close = rest.indexOf('*', 1);
      if (close > 1 && !rest.slice(1, close).includes('\n')) {
        return inlineRunFromSource('em', rest.slice(0, close + 1), rest.slice(1, close), index, baseOffset, 1);
      }
    }

    if (rest[0] === '_' && rest[1] !== '_' && canOpenSingleDelimiterAt(text, index, '_')) {
      const close = rest.indexOf('_', 1);
      if (close > 1 && !rest.slice(1, close).includes('\n')) {
        return inlineRunFromSource('em', rest.slice(0, close + 1), rest.slice(1, close), index, baseOffset, 1);
      }
    }

    return null;
  }

  function inlineRunFromMatch(kind, match, index, baseOffset, contentGroup) {
    const source = match[0];
    const text = match[contentGroup] || '';
    const contentOffset = source.indexOf(text);
    return inlineRunFromSource(kind, source, text, index, baseOffset, contentOffset);
  }

  function inlineRunFromSource(kind, source, text, index, baseOffset, contentOffset) {
    const sourceStart = baseOffset + index;
    const contentStart = sourceStart + Math.max(0, contentOffset || 0);
    return {
      kind,
      sourceStart,
      sourceEnd: sourceStart + source.length,
      contentStart,
      contentEnd: contentStart + String(text || '').length,
      source,
      text: String(text || ''),
    };
  }

  function shouldWrapRichInlineAtom(element) {
    if (!element) return false;
    if (element.closest('.rich-inline-atom, .rich-inline-source')) return false;
    if (element.closest('.rich-source-editor, .mermaid-diagram, pre, .math-display')) return false;
    if (element.classList?.contains('code-language-input') || element.classList?.contains('task-checkbox')) return false;
    if (element.tagName?.toLowerCase() === 'code' && element.closest('pre')) return false;
    return Boolean(richInlineSourceFromElement(element));
  }

  function inlineAtomKind(element) {
    if (element.classList?.contains('math-inline')) return 'math';
    if (element.classList?.contains('blocked-image')) return 'image';
    const tag = element.tagName?.toLowerCase();
    if (tag === 'strong' || tag === 'b') return 'strong';
    if (tag === 'em' || tag === 'i') return 'em';
    if (tag === 'del' || tag === 's') return 'del';
    if (tag === 'code') return 'code';
    if (tag === 'a') return 'link';
    if (tag === 'img') return 'image';
    return 'text';
  }

  function showRichSourceEditor(kind, element, options = {}) {
    if (!element || element.classList.contains('is-editing-source')) return;
    const source = richSourceFromElement(kind, element);
    const editorValue = options.editorValue ?? richSourceEditorValue(kind, element, source);
    const language = kind === 'code' ? codeLanguageFromPre(element) : '';
    element.classList.add('is-editing-source');
    element.dataset.richSourceKind = kind;
    setRichSourceOnElement(kind, element, source);
    if (kind === 'code') {
      element.dataset.codeLanguage = language;
    }
    element.setAttribute('contenteditable', 'false');
    element.replaceChildren();

    const caption = document.createElement(kind === 'mermaid' ? 'figcaption' : 'div');
    caption.className = 'rich-source-caption';
    caption.textContent = richSourceTitle(kind);
    const hint = document.createElement('span');
    hint.textContent = 'Ctrl+Enterで反映';
    caption.appendChild(hint);

    const textarea = document.createElement('textarea');
    textarea.className = 'rich-source-editor';
    textarea.value = editorValue;
    textarea.spellcheck = false;
    textarea.autocomplete = 'off';
    textarea.autocapitalize = 'off';
    textarea.setAttribute('aria-label', `${richSourceTitle(kind)}ソース編集`);

    const actions = document.createElement('div');
    actions.className = 'rich-source-actions';
    actions.innerHTML = [
      '<button type="button" data-source-action="cancel">キャンセル</button>',
      '<button type="button" data-source-action="apply">反映</button>',
    ].join('');

    if (kind === 'code') {
      element.appendChild(createCodeLanguageInput(language));
    }
    element.appendChild(caption);
    element.appendChild(textarea);
    element.appendChild(actions);

    textarea.addEventListener('click', (event) => event.stopPropagation());
    textarea.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if ((event.ctrlKey || event.metaKey) && isEnterKey(event)) {
        event.preventDefault();
        applyRichSourceEditor(kind, element, textarea.value);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        renderRich();
      }
    });
    actions.addEventListener('click', (event) => {
      event.stopPropagation();
      const action = event.target.closest('[data-source-action]')?.dataset.sourceAction;
      if (action === 'apply') applyRichSourceEditor(kind, element, textarea.value);
      if (action === 'cancel') renderRich();
    });

    textarea.focus();
    if (Number.isInteger(options.caretOffset)) {
      textarea.setSelectionRange(options.caretOffset, options.caretOffset);
    } else {
      textarea.setSelectionRange(0, textarea.value.length);
    }
  }

  function richSourceEditorValue(kind, element, source) {
    if (kind === 'math' && element.getAttribute('data-math-display') === 'true') {
      return `$$${source}$$`;
    }
    return source;
  }

  function createCodeLanguageInput(language) {
    const input = document.createElement('input');
    input.className = 'code-language-input';
    input.type = 'text';
    input.setAttribute('list', 'codeLanguageOptions');
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.setAttribute('autocapitalize', 'off');
    input.setAttribute('contenteditable', 'false');
    input.setAttribute('aria-label', 'コードブロックの言語');
    input.placeholder = 'text';
    input.value = safeCodeLanguage(language);
    return input;
  }

  function applyRichSourceEditor(kind, element, source) {
    if (kind === 'code') {
      element.dataset.codeLanguage = codeLanguageFromPre(element);
    }
    if (kind === 'math') {
      source = normalizeMathEditorSource(source);
      element.setAttribute('data-math-display', 'true');
    }
    setRichSourceOnElement(kind, element, source);
    const sourceTransaction = richSourceBlockTransaction(kind, element, source);
    if (sourceTransaction) {
      applySourceTransaction(sourceTransaction, `${kind}-source`);
    } else {
      if (element.matches?.(RICH_SOURCE_BLOCK_SELECTOR)) {
        renderAll(`${kind}-source-revert`);
        setStatus(`${richSourceTitle(kind)}ソースを反映できませんでした`);
        return;
      }
      syncRichMarkdownFromDom(`${kind}-source`, { refreshRich: true });
    }
    setStatus(`${richSourceTitle(kind)}ソースを反映しました`);
  }

  function richSourceBlockTransaction(kind, element, source) {
    const start = numericData(element, 'sourceStart');
    const end = numericData(element, 'sourceEnd');
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) return null;
    const markdown = stripRichCaretTokens(state.markdown || els.source.value || '');
    if (end > markdown.length) return null;
    let replacement = '';
    if (kind === 'mermaid') {
      replacement = serializeMermaidDiagram(element);
    } else if (kind === 'code') {
      replacement = serializePreElement(element);
    } else if (kind === 'math') {
      replacement = serializeMathElement(element);
    } else {
      replacement = normalizeNewlines(source);
    }
    if (!replacement) return null;
    return {
      from: start,
      to: end,
      insert: replacement,
      selectionAfter: {
        anchor: start + replacement.length,
        focus: start + replacement.length,
        affinity: 'after',
      },
    };
  }

  function normalizeMathEditorSource(source) {
    const value = normalizeNewlines(source).trim();
    if (value.startsWith('$$') && value.endsWith('$$') && value.length >= 4) return value.slice(2, -2);
    if (value.startsWith('\\[') && value.endsWith('\\]') && value.length >= 4) return value.slice(2, -2);
    if (value.startsWith('$') && value.endsWith('$') && value.length >= 2) return value.slice(1, -1);
    if (value.startsWith('\\(') && value.endsWith('\\)') && value.length >= 4) return value.slice(2, -2);
    return value;
  }

  function richSourceFromElement(kind, element) {
    if (kind === 'mermaid') return mermaidSourceFromFigure(element);
    if (kind === 'code') return codeSourceFromPre(element);
    if (kind === 'math') {
      const editor = element.querySelector('.rich-source-editor');
      if (editor) return normalizeMathEditorSource(editor.value);
      if (Object.prototype.hasOwnProperty.call(element.dataset, 'richSource')) return element.dataset.richSource;
      const attrSource = element.getAttribute('data-math-source');
      if (attrSource !== null) return attrSource;
      return element.querySelector('.rich-source-editor')?.value || '';
    }
    return element.dataset.richSource || '';
  }

  function setRichSourceOnElement(kind, element, source) {
    const value = normalizeNewlines(source);
    element.dataset.richSource = value;
    if (kind === 'mermaid') element.dataset.mermaidSource = value;
    if (kind === 'math') element.setAttribute('data-math-source', value);
  }

  function richSourceTitle(kind) {
    if (kind === 'mermaid') return 'Mermaid';
    if (kind === 'code') return 'コード';
    if (kind === 'math') return '数式';
    return 'ソース';
  }

  function mermaidSourceFromFigure(figure) {
    return figure.dataset.richSource
      || figure.dataset.mermaidSource
      || figure.querySelector('.mermaid-render-target')?.getAttribute('data-mermaid-source')
      || figure.querySelector('code')?.textContent
      || '';
  }

  function codeSourceFromPre(pre) {
    return pre.querySelector('.rich-source-editor')?.value
      || pre.dataset.richSource
      || pre.querySelector('code')?.textContent
      || '';
  }

  function codeLanguageFromPre(pre) {
    const input = Array.from(pre.children).find((child) => child.classList?.contains('code-language-input'));
    const code = pre.querySelector('code');
    return safeCodeLanguage(input?.value || pre.dataset.codeLanguage || code?.dataset.lang || '');
  }

  function syncRichMarkdownFromDom(reason, options = {}) {
    if (repairRichLineBreakCaretDomSync(reason)) return;
    sanitizeRichCaretTokensInDom(els.rich);
    const serialized = stripRichCaretTokens(serializeRichMarkdown(els.rich));
    const shortcutNormalized = normalizeSyncedMarkdownShortcuts(serialized);
    state.markdown = shortcutNormalized.markdown;
    els.source.value = state.markdown;
    syncCodeMirrorSourceFromTextarea(reason);
    markDirty();
    if (shortcutNormalized.changed) setStatus(shortcutNormalized.status || 'Markdown入力を変換しました');
    if (options.refreshRich || shortcutNormalized.changed) {
      renderAll(reason || 'rich-edit');
    } else {
      refreshRichSourceRangesFromMarkdown();
      scheduleRender('rich-input');
      if (options.reparseRich) scheduleRichReparse();
    }
    scheduleAutosave();
  }

  function repairRichLineBreakCaretDomSync(reason) {
    const anchor = els.rich?.querySelector?.('.rich-line-break-caret-anchor[data-source-offset]');
    const offset = state.richLineBreakInputOffset !== null && Number.isFinite(Number(state.richLineBreakInputOffset))
      ? Number(state.richLineBreakInputOffset)
      : Number(anchor?.dataset?.sourceOffset);
    if (!Number.isFinite(offset)) return false;
    const markdown = stripRichCaretTokens(state.markdown || els.source.value || '');
    if (offset <= 0 || offset > markdown.length || markdown[offset - 1] !== '\n') return false;
    const block = renderedBlockForSourceOffset(els.rich, offset);
    if (!block) return false;
    const insert = richLineBreakCaretInputText(null, block, markdown);
    if (!insert || insert.includes('\n')) return false;
    state.richLineBreakInputOffset = null;
    applySourceTransaction({
      from: offset,
      to: offset,
      insert,
      selectionAfter: {
        anchor: offset + insert.length,
        focus: offset + insert.length,
        affinity: 'after',
      },
    }, reason || 'rich-line-break-caret-sync');
    return true;
  }

  function normalizeSyncedMarkdownShortcuts(markdown) {
    const source = stripRichCaretTokens(markdown || '');
    const blocks = buildBlockModel(source);
    for (let index = blocks.length - 1; index >= 0; index -= 1) {
      const block = blocks[index];
      if (block.type !== 'paragraph') continue;
      const replacement = richBlockMarkdownTriggerReplacement(block.raw, { allowBareMath: false });
      if (!replacement) continue;
      return {
        markdown: source.slice(0, block.start) + replacement.insert + source.slice(block.end),
        changed: true,
        status: replacement.status,
      };
    }
    return { markdown: source, changed: false, status: '' };
  }

  function refreshRichSourceRangesFromMarkdown() {
    if (state.mode !== 'rich' || !els.rich) return false;
    const blocks = buildBlockModel(state.markdown);
    const rendered = Array.from(els.rich.children).filter((child) => child.matches?.(RICH_SOURCE_BLOCK_SELECTOR));
    if (blocks.length !== rendered.length) return false;
    rendered.forEach((element, index) => {
      const block = blocks[index];
      element.dataset.blockId = block.id;
      element.dataset.blockType = block.type;
      element.dataset.sourceStart = String(block.start);
      element.dataset.sourceEnd = String(block.end);
    });
    annotateRenderedInlineAtomRanges(els.rich);
    return true;
  }

  function serializeRichMarkdown(root) {
    const blocks = Array.from(root.childNodes)
      .map((node) => serializeBlockNode(node))
      .map((block) => block.trimEnd())
      .filter((block) => block.trim() !== '');
    return normalizeNewlines(blocks.join('\n\n')).replace(/\n{3,}/g, '\n\n').trimEnd();
  }

  function serializeBlockNode(node) {
    if (node.nodeType === 3) return normalizeRichText(node.nodeValue || '').trim();
    if (node.nodeType !== 1) return '';

    const element = node;
    if (element.classList.contains('toc')) return '[toc]';
    if (element.classList.contains('mermaid-diagram')) return serializeMermaidDiagram(element);
    if (element.classList.contains('math-display')) return serializeMathElement(element);
    if (element.classList.contains('math-inline')) return serializeMathElement(element);
    if (element.classList.contains('blocked-image') && element.getAttribute('data-markdown-src')) return serializeBlockedImageElement(element);

    const tag = element.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) return `${'#'.repeat(Number(tag[1]))} ${serializeInlineChildren(element).trim()}`;
    if (tag === 'p') return serializeInlineChildren(element).trim();
    if (tag === 'pre') return serializePreElement(element);
    if (tag === 'blockquote') return serializeQuoteElement(element);
    if (tag === 'ul' || tag === 'ol') return serializeListElement(element);
    if (tag === 'table') return serializeTableElement(element);
    if (tag === 'hr') return '---';
    if (tag === 'img') return serializeImageElement(element);
    if (tag === 'br') return '';

    const blockText = serializeBlockChildren(element);
    if (blockText) return blockText;
    return serializeInlineChildren(element).trim();
  }

  function serializeBlockChildren(element) {
    return Array.from(element.childNodes)
      .map((child) => serializeBlockNode(child))
      .map((block) => block.trimEnd())
      .filter((block) => block.trim() !== '')
      .join('\n\n');
  }

  function serializeInlineChildren(element) {
    return serializeInlineNodes(Array.from(element.childNodes));
  }

  function serializeQuoteElement(blockquote) {
    const source = serializeInlineNodes(Array.from(blockquote.childNodes)).replace(/^[ \t]+|[ \t]+$/g, '');
    const serialized = source ? prefixLines(source, '> ') : '>';
    const start = numericData(blockquote, 'sourceStart');
    const end = numericData(blockquote, 'sourceEnd');
    if (Number.isFinite(start) && Number.isFinite(end)) {
      const previousSource = blockquote.dataset.richQuoteHardBreakSource
        || stripRichCaretTokens(state.markdown || '').slice(start, end);
      const repair = richQuoteHardBreakDomRepair(blockquote, previousSource, serialized);
      if (repair) return repair.insert;
    }
    return serialized;
  }

  function serializeInlineNodes(nodes) {
    return nodes.map((node) => serializeInlineNode(node)).join('').replace(/[ \t]+\n/g, '\n');
  }

  function serializeTableCellInlineNodes(nodes) {
    return nodes.map((node) => serializeTableCellInlineNode(node)).join('');
  }

  function serializeTableCellElement(cell) {
    const nodes = Array.from(cell?.childNodes || []);
    if (nodes.every((node) => node.nodeType === 1 && node.tagName?.toLowerCase() === 'br')) return '';
    return serializeTableCellInlineNodes(nodes).replace(/^[ \t]+|[ \t]+$/g, '');
  }

  function serializeTableCellInlineNode(node) {
    if (node.nodeType === 3) return escapeMarkdownTableCell(normalizeRichText(node.nodeValue || ''));
    if (node.nodeType !== 1) return '';

    const element = node;
    if (element.tagName?.toLowerCase() === 'br') return '<br>';
    return escapeMarkdownTableCell(serializeInlineNode(element));
  }

  function serializeInlineNode(node) {
    if (node.nodeType === 3) return normalizeRichText(node.nodeValue || '');
    if (node.nodeType !== 1) return '';

    const element = node;
    if (element.classList.contains('rich-inline-source')) return stripRichCaretTokens(normalizeNewlines(element.textContent || ''));
    if (element.classList.contains('rich-inline-atom')) return stripRichCaretTokens(element.dataset.inlineSource || serializeInlineChildren(element));
    if (element.classList.contains('rich-list-caret-anchor')) return normalizeRichText(element.textContent || '').replace(/\u200b/g, '');
    if (element.classList.contains('rich-line-break-caret-anchor')) return normalizeRichText(element.textContent || '').replace(/\u200b/g, '');
    if (element.classList.contains('math-inline') || element.classList.contains('math-display')) return serializeMathElement(element);
    if (element.classList.contains('blocked-image') && element.getAttribute('data-markdown-src')) {
      return serializeBlockedImageElement(element);
    }
    if (element.classList.contains('code-language-input') || element.classList.contains('task-checkbox')) return '';

    const tag = element.tagName.toLowerCase();
    if (tag === 'br') return '\n';
    if (tag === 'strong' || tag === 'b') return `**${serializeInlineChildren(element).trim()}**`;
    if (tag === 'em' || tag === 'i') return `*${serializeInlineChildren(element).trim()}*`;
    if (tag === 'del' || tag === 's') return `~~${serializeInlineChildren(element).trim()}~~`;
    if (tag === 'code' && !element.closest('pre')) return markdownCodeSpan(element.textContent || '');
    if (tag === 'a') return serializeLinkElement(element);
    if (tag === 'img') return serializeImageElement(element);
    if (tag === 'div' || tag === 'p') return serializeInlineChildren(element).trim();
    return serializeInlineChildren(element);
  }

  function serializeListElement(list, depth = 0) {
    const ordered = list.tagName.toLowerCase() === 'ol';
    const indent = '  '.repeat(depth);
    const items = Array.from(list.children).filter((child) => child.tagName?.toLowerCase() === 'li');
    return items.map((item, itemIndex) => {
      const nestedLists = Array.from(item.children).filter((child) => ['ul', 'ol'].includes(child.tagName?.toLowerCase()));
      const contentNodes = Array.from(item.childNodes).filter((child) => {
        if (child.nodeType !== 1) return true;
        const childElement = child;
        if (['ul', 'ol'].includes(childElement.tagName.toLowerCase())) return false;
        return !childElement.classList.contains('task-checkbox');
      });
      const checkbox = Array.from(item.children).find((child) => child.classList?.contains('task-checkbox'));
      const taskPrefix = checkbox ? `[${checkbox.checked ? 'x' : ' '}] ` : '';
      const marker = ordered ? `${itemIndex + 1}.` : '-';
      const lines = serializeInlineNodes(contentNodes)
        .split('\n')
        .map((line) => normalizeListItemSourceLine(line))
        .filter((line) => line !== '');
      const text = lines.shift() || ' ';
      const continuation = lines.map((line) => `${indent}  ${line}`).join('\n');
      const nested = nestedLists.map((child) => serializeListElement(child, depth + 1)).filter(Boolean).join('\n');
      return `${indent}${marker} ${taskPrefix}${text}${continuation ? `\n${continuation}` : ''}${nested ? `\n${nested}` : ''}`;
    }).join('\n');
  }

  function normalizeListItemSourceLine(line) {
    const value = String(line || '').trimStart();
    if (/[ \t]{2}$/.test(value)) return value.replace(/[ \t]+$/, '  ');
    return value.trimEnd();
  }

  function serializePreElement(pre) {
    const language = codeLanguageFromPre(pre);
    const text = normalizeNewlines(codeSourceFromPre(pre)).replace(/\n$/, '');
    return `\`\`\`${language}\n${text}\n\`\`\``;
  }

  function serializeTableElement(table) {
    const rows = Array.from(table.querySelectorAll('tr'));
    if (!rows.length) return '';
    const firstRowCells = Array.from(rows[0].children);
    const headers = firstRowCells.map((cell) => serializeTableCellElement(cell));
    const separator = headers.map(() => '---');
    const bodyRows = rows.slice(1).map((row) => {
      const cells = Array.from(row.children).map((cell) => serializeTableCellElement(cell));
      return `| ${cells.join(' | ')} |`;
    });
    return [`| ${headers.join(' | ')} |`, `| ${separator.join(' | ')} |`, ...bodyRows].join('\n');
  }

  function serializeLinkElement(link) {
    const label = serializeInlineChildren(link).trim();
    const href = link.getAttribute('data-markdown-href') || link.getAttribute('href') || '';
    const safe = sanitizeLinkUrl(href);
    return safe ? `[${escapeMarkdownLabel(label)}](${formatMarkdownTarget(href)})` : label;
  }

  function serializeImageElement(image) {
    const src = image.getAttribute('data-markdown-src') || image.getAttribute('src') || '';
    const alt = image.getAttribute('alt') || '画像';
    return sanitizeImageUrl(src) ? `![${escapeMarkdownLabel(alt)}](${formatMarkdownTarget(src)})` : escapeMarkdownLabel(alt);
  }

  function serializeBlockedImageElement(element) {
    const src = element.getAttribute('data-markdown-src') || '';
    const alt = element.getAttribute('data-markdown-alt') || '画像';
    return `![${escapeMarkdownLabel(alt)}](${formatMarkdownTarget(src)})`;
  }

  function serializeMermaidDiagram(figure) {
    const source = mermaidSourceFromFigure(figure);
    return source ? `\`\`\`mermaid\n${normalizeNewlines(source).trim()}\n\`\`\`` : '';
  }

  function serializeMathElement(element) {
    const source = richSourceFromElement('math', element);
    if (!source) return element.getAttribute('data-math-display') === 'true' ? '$$$$' : '$$';
    return element.getAttribute('data-math-display') === 'true' ? `$$${source}$$` : `$${source}$`;
  }

  function normalizeRichText(value) {
    return stripRichCaretTokens(String(value || '')).replace(/\u00a0/g, ' ').replace(/\u200b/g, '');
  }

  function markdownCodeSpan(value) {
    const text = String(value || '');
    const fence = text.includes('`') ? '``' : '`';
    return `${fence}${text}${fence}`;
  }

  function escapeMarkdownLabel(value) {
    return String(value || '').replace(/[\[\]\r\n]/g, ' ').trim();
  }

  function escapeMarkdownTableCell(value) {
    return String(value || '').replace(/\|/g, '\\|').replace(/\n+/g, '<br>');
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
    els.outline.appendChild(buildOutlineTreeElement(buildHeadingTree(headings), true));
  }

  function updateStatusBar() {
    const chars = state.markdown.length;
    const words = countWords(state.markdown);
    els.stats.textContent = `${chars.toLocaleString()}文字 / ${words.toLocaleString()}語`;
    els.fileNameLabel.textContent = state.fileName;
    const dirtyText = state.dirty
      ? '未保存'
      : state.desktopHost && !state.desktopDocumentReady
        ? '未保存文書'
        : '保存済み';
    const autoText = state.lastAutoSaved ? formatTime(state.lastAutoSaved) : '未保存';
    const folderAccess = state.desktopDocumentReady
      ? ' / Windowsファイル'
      : state.directoryHandle
        ? ' / FSAフォルダ'
        : state.markdownRelativePath
          ? ' / フォルダ入力'
          : '';
    els.saveState.textContent = `${dirtyText} / 自動保存: ${autoText}${folderAccess}`;
    document.body.dataset.folderAccess = state.desktopDocumentReady
      ? 'desktop'
      : state.directoryHandle
        ? 'fsa'
        : state.markdownRelativePath
          ? 'input'
          : 'none';
  }

  function setStatus(message) {
    els.status.textContent = message;
  }

  function syncPreviewScroll() {
    if (state.mode !== 'split' || state.scrollSyncLock) return;
    const anchor = captureSourceScrollAnchor();
    if (!anchor) return;
    withScrollSyncLock(() => {
      if (!restoreRenderedScrollAnchor(els.preview, anchor)) restoreRenderedScrollByRatio(els.preview, sourceScrollElement());
    });
  }

  function syncSourceScroll() {
    if (state.mode !== 'split' || state.scrollSyncLock) return;
    const anchor = captureRenderedScrollAnchor(els.preview);
    if (!anchor) return;
    withScrollSyncLock(() => {
      if (!restoreSourceScrollAnchor(anchor)) restoreSourceScrollByRatio(els.preview);
    });
  }

  function withScrollSyncLock(callback) {
    state.scrollSyncLock = true;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      state.scrollSyncLock = false;
    };
    try {
      callback();
    } finally {
      window.requestAnimationFrame(release);
      window.setTimeout(release, 80);
    }
  }

  function captureCurrentScrollAnchor() {
    if (!els.source || !els.preview || !els.rich) return null;
    if (state.mode === 'rich') return captureRenderedScrollAnchor(els.rich) || captureSourceScrollAnchor();
    if (state.mode === 'preview') return captureRenderedScrollAnchor(els.preview) || captureSourceScrollAnchor();
    return captureSourceScrollAnchor() || captureRenderedScrollAnchor(els.preview) || captureRenderedScrollAnchor(els.rich);
  }

  function restoreCurrentModeScrollSoon(anchor) {
    const restore = () => restoreCurrentModeScroll(anchor);
    window.requestAnimationFrame(() => {
      restore();
      window.setTimeout(restore, 180);
    });
  }

  function restoreCurrentModeScroll(anchor) {
    if (!anchor) return;
    withScrollSyncLock(() => {
      if (state.mode === 'rich') {
        restoreRenderedScrollAnchor(els.rich, anchor);
        return;
      }
      if (state.mode === 'preview') {
        restoreRenderedScrollAnchor(els.preview, anchor);
        return;
      }
      if (state.mode === 'source' || state.mode === 'focus') {
        restoreSourceScrollAnchor(anchor);
        return;
      }
      if (state.mode === 'split') {
        restoreSourceScrollAnchor(anchor);
        restoreRenderedScrollAnchor(els.preview, anchor);
      }
    });
  }

  function captureSourceScrollAnchor() {
    const scroller = sourceScrollElement();
    const value = sourceMarkdownValue() || normalizeNewlines(state.markdown || '');
    const lineHeight = textareaLineHeight(scroller);
    const lineIndex = Math.max(0, Math.floor((scroller?.scrollTop || 0) / lineHeight));
    const lineStarts = markdownLineStarts(value);
    const boundedLine = Math.min(lineIndex, Math.max(0, lineStarts.length - 1));
    const offset = lineStarts[boundedLine] || 0;
    return {
      type: 'source',
      offset,
      lineIndex: boundedLine,
      lineTop: (scroller?.scrollTop || 0) - boundedLine * lineHeight,
      ratio: scrollRatio(scroller),
    };
  }

  function restoreSourceScrollAnchor(anchor) {
    const scroller = sourceScrollElement();
    if (!anchor || !scroller) return false;
    const value = sourceMarkdownValue() || normalizeNewlines(state.markdown || '');
    const lineIndex = markdownLineIndexAtOffset(value, anchor.offset || 0);
    const lineHeight = textareaLineHeight(scroller);
    scroller.scrollTop = Math.max(0, lineIndex * lineHeight + (anchor.lineTop || 0));
    return true;
  }

  function captureRenderedScrollAnchor(container) {
    if (!container) return null;
    const elements = renderedSourceElements(container);
    if (!elements.length) return {
      type: 'rendered',
      offset: 0,
      y: 0,
      ratio: scrollRatio(container),
    };
    const containerRect = container.getBoundingClientRect();
    const targetY = containerRect.top + Math.min(72, Math.max(16, container.clientHeight * 0.12));
    let candidate = null;
    for (const element of elements) {
      const rect = element.getBoundingClientRect();
      if (rect.bottom >= targetY) {
        candidate = element;
        break;
      }
      candidate = element;
    }
    if (!candidate) candidate = elements[0];
    const rect = candidate.getBoundingClientRect();
    return {
      type: 'rendered',
      offset: numericData(candidate, 'sourceStart'),
      end: numericData(candidate, 'sourceEnd'),
      y: Math.max(0, targetY - rect.top),
      ratio: scrollRatio(container),
    };
  }

  function restoreRenderedScrollAnchor(container, anchor) {
    if (!container || !anchor) return false;
    const target = renderedElementForOffset(container, anchor.offset || 0);
    if (!target) return false;
    const containerRect = container.getBoundingClientRect();
    const targetY = containerRect.top + Math.min(72, Math.max(16, container.clientHeight * 0.12));
    const rect = target.getBoundingClientRect();
    container.scrollTop += rect.top - (targetY - (anchor.y || 0));
    return true;
  }

  function renderedElementForOffset(container, offset) {
    const elements = renderedSourceElements(container);
    if (!elements.length) return null;
    let previous = elements[0];
    for (const element of elements) {
      const start = numericData(element, 'sourceStart');
      const end = numericData(element, 'sourceEnd');
      if (start <= offset && offset <= end) return element;
      if (start > offset) return previous || element;
      previous = element;
    }
    return previous;
  }

  function renderedSourceElements(container) {
    return Array.from(container.querySelectorAll('[data-source-start][data-source-end]'))
      .filter((element) => Number.isFinite(numericData(element, 'sourceStart')));
  }

  function numericData(element, key) {
    const value = Number(element?.dataset?.[key]);
    return Number.isFinite(value) ? value : 0;
  }

  function markdownLineStarts(markdown) {
    const starts = [0];
    const text = String(markdown || '');
    for (let index = 0; index < text.length; index += 1) {
      if (text[index] === '\n') starts.push(index + 1);
    }
    return starts;
  }

  function markdownLineIndexAtOffset(markdown, offset) {
    const starts = markdownLineStarts(markdown);
    const target = Math.max(0, Math.min(String(markdown || '').length, offset || 0));
    let low = 0;
    let high = starts.length - 1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (starts[mid] <= target && (mid === starts.length - 1 || starts[mid + 1] > target)) return mid;
      if (starts[mid] > target) high = mid - 1;
      else low = mid + 1;
    }
    return 0;
  }

  function textareaLineHeight(textarea) {
    if (!textarea) return 24;
    const lineHeight = Number.parseFloat(window.getComputedStyle(textarea).lineHeight);
    if (Number.isFinite(lineHeight) && lineHeight > 0) return lineHeight;
    const fontSize = Number.parseFloat(window.getComputedStyle(textarea).fontSize);
    return Number.isFinite(fontSize) && fontSize > 0 ? fontSize * 1.72 : 24;
  }

  function scrollRatio(element) {
    const max = Math.max(1, (element?.scrollHeight || 0) - (element?.clientHeight || 0));
    return Math.max(0, Math.min(1, (element?.scrollTop || 0) / max));
  }

  function restoreRenderedScrollByRatio(target, source) {
    if (!target || !source) return;
    const max = Math.max(0, target.scrollHeight - target.clientHeight);
    target.scrollTop = scrollRatio(source) * max;
  }

  function restoreSourceScrollByRatio(source) {
    const scroller = sourceScrollElement();
    if (!scroller || !source) return;
    const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    scroller.scrollTop = scrollRatio(source) * max;
  }


  function isMarkdownFile(file) {
    const name = String(file?.name || '').toLowerCase();
    return /\.(?:md|markdown|txt)$/.test(name) || ['text/markdown', 'text/plain'].includes(file?.type || '');
  }

  function fileEntry(file, relativePath = '', handle = null) {
    return {
      file,
      handle,
      relativePath: normalizeAssetPath(relativePath || file.webkitRelativePath || file.name || ''),
    };
  }

  async function chooseMarkdownEntry(entries) {
    if (entries.length === 1) return entries[0];
    if (els.markdownEntryDialog && els.markdownEntryList) {
      return showMarkdownEntryDialog(entries);
    }
    return chooseMarkdownEntryWithPrompt(entries);
  }

  function showMarkdownEntryDialog(entries) {
    return new Promise((resolve) => {
      const dialog = els.markdownEntryDialog;
      const list = els.markdownEntryList;
      let settled = false;

      const cleanup = () => {
        dialog.removeEventListener('close', onClose);
        els.markdownEntryCancel?.removeEventListener('click', onCancel);
        list.replaceChildren();
      };

      const onClose = () => finish(null);
      const onCancel = () => finish(null);
      const closeDialog = (returnValue) => {
        if (typeof dialog.close === 'function' && dialog.open) {
          dialog.close(returnValue);
        } else {
          dialog.removeAttribute('open');
        }
      };
      const fragment = document.createDocumentFragment();
      entries.forEach((entry, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'markdown-entry-option';
        button.setAttribute('role', 'option');
        button.dataset.entryIndex = String(index);

        const name = document.createElement('strong');
        name.textContent = entry.file.name || 'untitled.md';
        button.appendChild(name);
        const pathText = markdownEntryPathLabel(entry);
        if (pathText) {
          const path = document.createElement('span');
          path.textContent = pathText;
          button.appendChild(path);
        }
        button.addEventListener('click', () => finish(entry));
        fragment.appendChild(button);
      });

      list.replaceChildren(fragment);
      dialog.addEventListener('close', onClose);
      els.markdownEntryCancel?.addEventListener('click', onCancel);
      if (typeof dialog.showModal === 'function') {
        dialog.showModal();
      } else {
        dialog.setAttribute('open', '');
      }
      list.querySelector('button')?.focus();

      function finish(entry) {
        if (settled) return;
        settled = true;
        cleanup();
        closeDialog(entry ? 'selected' : 'cancel');
        resolve(entry || null);
      }
    });
  }

  function markdownEntryPathLabel(entry) {
    const relative = normalizeAssetPath(entry.relativePath || '');
    const fileName = entry.file.name || '';
    if (!relative || relative === fileName) return '';
    const dir = dirnamePath(relative);
    return dir ? dir : relative;
  }

  function chooseMarkdownEntryWithPrompt(entries) {
    const names = entries.map((entry) => entry.relativePath || entry.file.name || '');
    const answer = prompt(`開くMarkdownファイル名を入力してください。\n\n${names.join('\n')}`, names[0] || '');
    if (!answer) return null;
    const normalized = normalizeAssetPath(answer);
    return entries.find((entry) => entry.relativePath === normalized)
      || entries.find((entry) => entry.file.name === answer)
      || null;
  }

  function buildFolderAssetUrls(entries, baseDir) {
    const base = normalizeAssetPath(baseDir);
    for (const entry of entries) {
      const file = entry.file || entry;
      if (!isAllowedImageFile(file)) continue;
      const fullPath = normalizeAssetPath(entry.relativePath || file.webkitRelativePath || file.name || '');
      const relative = makeRelativePath(base, fullPath);
      if (!relative || isUnsafeRelativePath(relative)) continue;
      const url = URL.createObjectURL(file);
      state.assetUrls.set(relative, url);
      state.assetUrls.set(`./${relative}`, url);
    }
  }

  function clearAssetUrls() {
    for (const url of new Set(state.assetUrls.values())) URL.revokeObjectURL(url);
    state.assetUrls.clear();
  }

  function isAllowedImageFile(file) {
    return ALLOWED_IMAGE_TYPES.has(file.type) || hasRasterImageExtension(file.name || '');
  }

  function normalizeAssetPath(value) {
    return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/');
  }

  function dirnamePath(value) {
    const normalized = normalizeAssetPath(value);
    const index = normalized.lastIndexOf('/');
    return index >= 0 ? normalized.slice(0, index) : '';
  }

  function basenamePath(value) {
    const normalized = normalizeAssetPath(value);
    const index = normalized.lastIndexOf('/');
    return index >= 0 ? normalized.slice(index + 1) : normalized;
  }

  function makeRelativePath(baseDir, targetPath) {
    const base = normalizeAssetPath(baseDir).split('/').filter(Boolean);
    const target = normalizeAssetPath(targetPath).split('/').filter(Boolean);
    while (base.length && target.length && base[0] === target[0]) {
      base.shift();
      target.shift();
    }
    return [...base.map(() => '..'), ...target].join('/');
  }

  function isUnsafeRelativePath(value) {
    return normalizeAssetPath(value).split('/').includes('..');
  }

  function splitDomainInput(value) {
    return String(value || '').split(/[\s,]+/).map((item) => item.trim()).filter(Boolean);
  }

  function normalizeDomainList(values) {
    const domains = [];
    for (const raw of values) {
      const domain = normalizeDomain(raw);
      if (domain && !domains.includes(domain)) domains.push(domain);
    }
    return domains;
  }

  function normalizeDomain(value) {
    let raw = String(value || '').trim().toLowerCase();
    if (!raw) return '';
    raw = raw.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '').replace(/^\.+|\.+$/g, '');
    if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])$/.test(raw)) return '';
    return raw;
  }

  function isHeadingLine(line) { return /^\s*#{1,6}\s+\S/.test(line); }
  function isHorizontalRule(line) { return /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line); }
  function isTocLine(line) { return /^\s*\[toc\]\s*$/i.test(line); }
  function isListLine(line) { return /^\s*(?:[-+*]|\d+\.)(?:\s+|$)/.test(line); }
  function isQuoteLine(line) { return /^\s*>/.test(line); }
  function hasPipe(line) { return line.includes('|'); }

  function displayMathDelimiter(line) {
    const trimmed = String(line || '').trim();
    if (trimmed.startsWith('$$')) return '$$';
    if (trimmed.startsWith('\\[')) return '\\[';
    return '';
  }

  function displayMathBlockEndIndex(lines, startIndex) {
    const delimiter = displayMathDelimiter(lines[startIndex]?.text);
    if (!delimiter) return -1;
    if (isDisplayMathSelfContainedLine(lines[startIndex].text, delimiter)) return startIndex + 1;
    for (let index = startIndex + 1; index < lines.length; index += 1) {
      if (isDisplayMathClosedLine(lines[index].text, delimiter)) return index + 1;
    }
    return -1;
  }

  function isDisplayMathClosedLine(line, delimiter) {
    const trimmed = String(line || '').trim();
    if (delimiter === '$$') return trimmed === '$$' || (trimmed.length > 4 && trimmed.endsWith('$$'));
    if (delimiter === '\\[') return trimmed.endsWith('\\]');
    return false;
  }

  function isDisplayMathSelfContainedLine(line, delimiter) {
    const trimmed = String(line || '').trim();
    if (delimiter === '$$') return trimmed.length > 4 && trimmed.endsWith('$$');
    if (delimiter === '\\[') return trimmed !== '\\[' && trimmed.endsWith('\\]');
    return false;
  }

  function isDisplayMathBlock(raw) {
    const delimiter = displayMathDelimiter(raw);
    if (!delimiter) return false;
    const trimmed = String(raw || '').trim();
    return delimiter === '$$'
      ? trimmed.length >= 4 && trimmed.endsWith('$$')
      : trimmed.endsWith('\\]');
  }

  function displayMathSource(raw) {
    const text = normalizeNewlines(String(raw || '').trim());
    if (text.startsWith('$$') && text.endsWith('$$')) return text.slice(2, -2).replace(/^\n|\n$/g, '');
    if (text.startsWith('\\[') && text.endsWith('\\]')) return text.slice(2, -2).replace(/^\n|\n$/g, '');
    return text;
  }

  function isTableStart(lines, index) {
    if (!lines[index] || !lines[index + 1]) return false;
    return hasPipe(lines[index].text) && /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1].text);
  }

  function splitTableRow(line) {
    return splitTableRowWithSourceRanges(String(line || '').trim())
      .map((cell) => unescapeMarkdownTableCell(cell.raw.trim()));
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

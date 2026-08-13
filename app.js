(() => {
  'use strict';

  const DRAFT_STORAGE_PREFIX = 'portable-markdown-editor:draft:v2';
  const LEGACY_STORAGE_KEY = 'portable-markdown-editer:draft:v1';
  const SETTINGS_KEY = 'portable-markdown-editor:settings:v2';
  const LEGACY_SETTINGS_KEY = 'portable-markdown-editer:settings:v1';
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
  const DESKTOP_DRAFT_SCOPE = desktopDraftScope(window.location);
  const STORAGE_KEY = DESKTOP_DRAFT_SCOPE
    ? `${DRAFT_STORAGE_PREFIX}:${DESKTOP_DRAFT_SCOPE}`
    : DRAFT_STORAGE_PREFIX;
  const SHOULD_MIGRATE_LEGACY_DRAFT = !DESKTOP_DRAFT_SCOPE || DESKTOP_DRAFT_SCOPE === 'main';

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
    documentRevision: 0,
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
    desktopLastReportedRevision: -1,
    scrollSyncLock: false,
    mermaidPan: null,
    allowedLinkDomains: [],
    documentFont: 'sans',
    shortcuts: {},
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
  let richEditorApi = null;
  let richInputControllerApi = null;
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
      annotateRenderedInlineAtomRanges: (...args) => richEditorApi.annotateRenderedInlineAtomRanges(...args),
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
      stripRichCaretTokens: (...args) => richEditorApi.stripRichCaretTokens(...args),
      wrapRenderedInlineAtoms: (...args) => richEditorApi.wrapRenderedInlineAtoms(...args),
    },
  });
  const richEditorFactory = window.PMERichEditor?.createRichEditor;
  if (typeof richEditorFactory !== 'function') {
    throw new Error('Rich editor module is not available');
  }
  richEditorApi = richEditorFactory({
    state,
    els,
    constants: {
      RICH_ATOMIC_SOURCE_BLOCK_SELECTOR,
      RICH_CARET_TOKEN_PATTERN,
      RICH_INLINE_EDIT_BLOCK_SELECTOR,
      RICH_INLINE_SOURCE_SELECTOR,
      RICH_SOURCE_BLOCK_SELECTOR,
    },
    dependencies: {
      applySourceTransaction: (...args) => richInputControllerApi.applySourceTransaction(...args),
      buildBlockModel,
      canOpenSingleDelimiterAt: (...args) => richInputControllerApi.canOpenSingleDelimiterAt(...args),
      configureRichEditableSurface,
      enhanceRenderedHtml,
      ensureListItemEditablePlaceholder: (...args) => richInputControllerApi.ensureListItemEditablePlaceholder(...args),
      ensureRichTextBlockPlaceholder: (...args) => richInputControllerApi.ensureRichTextBlockPlaceholder(...args),
      findListItemTextPosition: (...args) => richInputControllerApi.findListItemTextPosition(...args),
      flatListSourceItems: (...args) => richInputControllerApi.flatListSourceItems(...args),
      formatMarkdownTarget,
      hasAmbiguousStrongDelimiterNeighborhood,
      isEnterKey: (...args) => richInputControllerApi.isEnterKey(...args),
      isSameRichInlineEditBlock,
      listItemEditableContentNodes: (...args) => richInputControllerApi.listItemEditableContentNodes(...args),
      markDirty,
      nodeClosest,
      nodeElement,
      normalizeNewlines,
      numericData,
      parseMarkdownQuoteSource: (...args) => richInputControllerApi.parseMarkdownQuoteSource(...args),
      parseMarkdownTableSource: (...args) => richInputControllerApi.parseMarkdownTableSource(...args),
      parsePendingRichInlineMarkdownInBlock: (...args) => richInputControllerApi.parsePendingRichInlineMarkdownInBlock(...args),
      persistDraft,
      placeCaretAtInlineBoundary: (...args) => richInputControllerApi.placeCaretAtInlineBoundary(...args),
      placeCaretInTextNode: (...args) => richInputControllerApi.placeCaretInTextNode(...args),
      prefixLines,
      renderAll,
      renderInlineMarkdown,
      renderRich,
      richBlockMarkdownTriggerReplacement: (...args) => richInputControllerApi.richBlockMarkdownTriggerReplacement(...args),
      richInlineEditBlockForRange,
      richInlineElementTextOffsetForRange: (...args) => richInputControllerApi.richInlineElementTextOffsetForRange(...args),
      richInlineSourceCaretOffset: (...args) => richInputControllerApi.richInlineSourceCaretOffset(...args),
      richLineBreakCaretInputText: (...args) => richInputControllerApi.richLineBreakCaretInputText(...args),
      richListSourcePointFromRange: (...args) => richInputControllerApi.richListSourcePointFromRange(...args),
      richQuoteHardBreakDomRepair: (...args) => richInputControllerApi.richQuoteHardBreakDomRepair(...args),
      richQuoteSourcePointFromRange: (...args) => richInputControllerApi.richQuoteSourcePointFromRange(...args),
      richTableSourcePointFromRange: (...args) => richInputControllerApi.richTableSourcePointFromRange(...args),
      safeCodeLanguage,
      sanitizeImageUrl,
      sanitizeLinkUrl,
      scheduleAutosave,
      scheduleRender,
      scheduleRichReparse,
      setStatus,
      sourceOffsetFromListItemTextOffset: (...args) => richInputControllerApi.sourceOffsetFromListItemTextOffset(...args),
      suppressRichInlineActivation: (...args) => richInputControllerApi.suppressRichInlineActivation(...args),
      syncCodeMirrorSourceFromTextarea,
      textOffsetFromListItemSourceOffset: (...args) => richInputControllerApi.textOffsetFromListItemSourceOffset(...args),
      validRichInlineSourceElement,
      visibleListItemText: (...args) => richInputControllerApi.visibleListItemText(...args),
      visibleTextFromListSourceItem: (...args) => richInputControllerApi.visibleTextFromListSourceItem(...args),
    },
  });
  const {
    activateRichInlineSource,
    annotateRenderedInlineAtomRanges,
    commitRichInlineSource,
    domPointToSourceOffset,
    domSelectionToSourceSelection,
    escapeMarkdownLabel,
    escapeMarkdownTableCell,
    finalizeRichProjectionChange,
    getRichCaretBookmark,
    guardFailedRichSourceControlTransaction,
    normalizeRichText,
    placeCaretInInlineSource,
    refreshRichSourceRangesFromMarkdown,
    removeRichTaskCheckboxTransaction,
    renderedBlockForSourceOffset,
    renderRichInlineSourceFragment,
    repairRichLineBreakCaretDomSync,
    reparseRichInlineEditBlockContent,
    restoreRichCaret,
    restoreRichCaretFromSourceSelection,
    richCaretToken,
    richSourceFromElement,
    richSourceTitle,
    sanitizeRichCaretTokensInDomPreservingSelection,
    serializeBlockNode,
    serializeInlineChildren,
    serializeInlineNodes,
    serializeRichInlineEditBlockContent,
    serializeRichMarkdown,
    serializeTableCellInlineNode,
    serializeTableCellInlineNodes,
    showRichSourceEditor,
    sourceContentBaseOffset,
    stripRichCaretTokens,
    syncRichMarkdownFromDom,
    updateCodeBlockLanguage,
    updateTaskCheckbox,
    wrapRenderedInlineAtoms,
  } = richEditorApi;
  const shortcutManagerFactory = window.PMEShortcutManager?.createShortcutManager;
  if (typeof shortcutManagerFactory !== 'function') {
    throw new Error('Shortcut manager module is not available');
  }
  const shortcutManagerApi = shortcutManagerFactory({
    state,
    els,
    dependencies: {
      notifyDesktopShortcutCaptureState,
      notifyDesktopShortcuts,
      persistSettings,
      setStatus,
    },
  });
  const {
    applyShortcutAssignments,
    captureShortcutAssignment,
    clearShortcutAssignment,
    initializeShortcutUi,
    resetShortcutAssignments,
    restoreDefaultShortcutAssignments,
    saveShortcutAssignments,
    shortcutActionForEvent,
    shortcutAssignmentsForExport,
    showShortcutDialog,
    updateElementShortcutHint,
  } = shortcutManagerApi;

  const fileManagerFactory = window.PMEFileManager?.createFileManager;
  if (typeof fileManagerFactory !== 'function') {
    throw new Error('File manager module is not available');
  }
  const {
    beginImageInsertion,
    buildFolderAssetUrls,
    captureCurrentMarkdownFromEditor,
    clearAllLocalData,
    clearAllowedDomainsData,
    clearAssetUrls,
    clearDraftData,
    clearFolderPermissionRecords,
    clearPersistedDirectoryHandle,
    copyHtml,
    createImageInsertionContext,
    ensureImageAssetWriteAccess,
    exportHtml,
    exportSettingsFile,
    folderScanLimitMessage,
    grantFolderForCurrentDocument,
    grantSettingsDirectory,
    hasImageFiles,
    imageFilesFromClipboard,
    imageFilesFromDataTransfer,
    initializeDesktopBridge,
    insertImageFilesAsAssets,
    notifyDesktopDocumentState,
    notifyDesktopTheme,
    onFileChosen,
    onFolderChosen,
    onImageChosen,
    onSettingsFileChosen,
    openFolder,
    openMarkdownFile,
    openSettingsFile,
    printPreview,
    requestDesktopCommand,
    requestDesktopImageReferenceAliases,
    resetSettingsData,
    restorePersistedDirectoryHandle,
    restorePersistedSettingsDirectoryHandle,
    restorePickerStartDirectoryHandle,
    saveLinkDomains,
    saveImageFileToAssets,
    saveMarkdown,
    saveSettingsToConfigDirectory,
    showLinkDomainDialog,
  } = fileManagerFactory({
    state,
    els,
    constants: {
      ALLOWED_IMAGE_TYPES,
      CONFIG_SETTINGS_FILE_NAME,
      DRAFT_STORAGE_PREFIX,
      DEFAULT_MARKDOWN,
      DESKTOP_ASSET_REQUEST_TIMEOUT_MS,
      FSA_DB_NAME,
      FSA_DIRECTORY_HANDLE_KEY,
      FSA_PICKER_START_HANDLE_KEY,
      FSA_SETTINGS_DIRECTORY_HANDLE_KEY,
      FSA_STORE_NAME,
      LEGACY_SETTINGS_KEY,
      LEGACY_STORAGE_KEY,
      MAX_ASSET_IMAGE_BYTES,
      MAX_FOLDER_SCAN_DEPTH,
      MAX_FOLDER_SCAN_FILES,
      RICH_SOURCE_BLOCK_SELECTOR,
      SETTINGS_KEY,
      STORAGE_KEY,
    },
    dependencies: {
      applyMode,
      advanceDocumentRevision,
      applyDocumentFont,
      applyOutlineVisibility,
      applyTheme,
      applyShortcutAssignments,
      basenamePath,
      buildExportHtml,
      confirmDocumentReplacement,
      decodeLocalImagePath,
      defaultTheme,
      desktopImageAliasKey,
      dirnamePath,
      ensureExtension,
      eventTargetElement,
      formatMarkdownTarget,
      getRichCaretBookmark,
      getRichSelectionRange,
      guardReadOnlyRichFallbackAction,
      hasRasterImageExtension,
      initializeVendorLibraries,
      insertInlineMarkdownAtCapturedContext,
      insertProseMirrorMarkdown,
      insertRichMarkdownAtSelection,
      isCodeMirrorSourceReady,
      isLocalAbsoluteImageReference,
      isProseMirrorRichActive,
      isProseMirrorRichTarget,
      isUnsafeRelativePath,
      makeRelativePath,
      newDocument,
      nodeClosest,
      normalizeAssetPath,
      normalizeDocumentFont,
      normalizeDomainList,
      normalizeNewlines,
      parseMarkdownTarget,
      persistDraft,
      persistSettings,
      placeCaretAtPointer,
      renderAll,
      renderMarkdownHtml,
      renderOutline,
      renderPreview,
      renderRich,
      resetShortcutAssignments,
      replaceSourceRange,
      restoreRichCaret,
      richInlineInsertRangeFromSelection,
      richRangeExtendsOutsideSourceBlock,
      richSourceBlocksIntersectingRange: (...args) => richInputControllerApi.richSourceBlocksIntersectingRange(...args),
      safeFileName,
      sanitizeMarkdownLabel,
      setSourceSelectionRange,
      setStatus,
      showAppearanceDialog,
      sourceMarkdownValue,
      sourceScrollElement,
      sourceSelectionRange,
      splitDomainInput,
      shortcutAssignmentsForExport,
      stripExtension,
      stripMarkdown,
      stripRichCaretTokens,
      suppressRichInlineActivation: (...args) => richInputControllerApi.suppressRichInlineActivation(...args),
      syncCodeMirrorSourceFromTextarea,
      showShortcutDialog,
      updateStatusBar,
    },
  });

  const richInputControllerFactory = window.PMERichInputController?.createRichInputController;
  if (typeof richInputControllerFactory !== 'function') {
    throw new Error('Rich input controller module is not available');
  }
  richInputControllerApi = richInputControllerFactory({
    state,
    els,
    constants: {
      MAX_RICH_UNDO_STEPS,
      RICH_ATOMIC_SOURCE_BLOCK_SELECTOR,
      RICH_INLINE_EDIT_BLOCK_SELECTOR,
      RICH_INLINE_SOURCE_SELECTOR,
      RICH_SOURCE_BLOCK_SELECTOR,
    },
    dependencies: {
      activateInsertedInlineSource,
      activateRichInlineSource,
      adjacentCaretNode,
      adjacentDomNode,
      annotateRenderedBlockHtml,
      annotateRenderedInlineAtomRanges,
      applyFormat,
      captureShortcutAssignment,
      buildBlockModel,
      buildHeadingIndex,
      cleanupRichCaretBoundaryMarkers,
      commitRichInlineSource,
      configureRichEditableSurface,
      createImageInsertionContext,
      domPointToSourceOffset,
      domSelectionToSourceSelection,
      ensureRichTrailingEditableParagraph,
      enhanceRenderedHtml,
      escapeMarkdownTableCell,
      eventTargetElement,
      finalizeRichProjectionChange,
      getLines,
      getRichCaretBookmark,
      guardFailedRichSourceControlTransaction,
      hasImageFiles,
      imageFilesFromClipboard,
      imageFilesFromDataTransfer,
      insertCodeBlock,
      insertImageFilesAsAssets,
      insertLink,
      insertMathBlock,
      insertMermaid,
      isEmptyRichParagraph,
      isProseMirrorRichActive,
      isProseMirrorRichEventContext,
      isProseMirrorRichTarget,
      isRichCaretBoundaryMarker,
      isSameRichInlineEditBlock,
      markDirty,
      nodeClosest,
      nodeElement,
      normalizeNewlines,
      normalizeRichText,
      numericData,
      newDocument,
      openMarkdownFile,
      parsePendingRichMathShortcutInBlock,
      placeCaretInInlineSource,
      printPreview,
      requestDesktopCommand,
      refreshRichSourceRangesFromMarkdown,
      removeRichTaskCheckboxTransaction,
      renderAll,
      renderBlockHtml,
      renderOutline,
      renderPreview,
      renderedBlockForSourceOffset,
      renderRichInlineSourceFragment,
      repairRichLineBreakCaretDomSync,
      reparseRichInlineEditBlockContent,
      restoreRichCaret,
      restoreRichCaretFromSourceSelection,
      richCaretToken,
      richInlineEditBlockForRange,
      richInlineSourceFromEventContext,
      richPendingMathShortcutBlockFromRange,
      richSourceFromElement,
      richTopLevelBlock,
      sanitizeRichCaretTokensInDomPreservingSelection,
      saveMarkdown,
      scheduleAutosave,
      scheduleRender,
      serializeBlockNode,
      serializeInlineChildren,
      serializeInlineNodes,
      serializeRichInlineEditBlockContent,
      serializeRichMarkdown,
      serializeTableCellInlineNode,
      serializeTableCellInlineNodes,
      setStatus,
      shortcutActionForEvent,
      showRichSourceEditor,
      sourceContentBaseOffset,
      stripRichCaretTokens,
      syncCodeMirrorSourceFromTextarea,
      syncRichMarkdownFromDom,
      toggleOutline,
      updateCodeBlockLanguage,
      updateStatusBar,
      validRichInlineSourceElement,
      wrapRenderedInlineAtoms,
    },
  });
  const {
    activatePendingMathShortcutFromSelection,
    applyRichBlockMarkdownTriggerTransaction,
    applySourceTransaction,
    areInlineNodesVisiblyEmpty,
    canOpenSingleDelimiterAt,
    clearRichTransactionBlankForPointer,
    ensureListItemEditablePlaceholder,
    ensureRichTextBlockPlaceholder,
    expandSourceRangeToIntersectingInlineAtoms,
    findListItemTextPosition,
    flatListSourceItems,
    guardUnsupportedRichBlockMarkdownTriggerFallback,
    isEnterKey,
    listItemEditableContentNodes,
    onDocumentBeforeInput,
    onDocumentKeyUp,
    onEditorDragLeave,
    onEditorDragOver,
    onEditorDrop,
    onKeyboardShortcutKeyDown,
    onKeyDown,
    onMarkdownPaste,
    onRichCompositionEnd,
    onRichCut,
    onRichInput,
    onRichPaste,
    parseMarkdownQuoteSource,
    parseMarkdownTableSource,
    parsePendingRichInlineMarkdownBeforePointer,
    parsePendingRichInlineMarkdownInBlock,
    placeCaretAfterNode,
    placeCaretAtInlineBoundary,
    placeCaretAtStart,
    placeCaretInTextNode,
    replaceParagraphWithMathDisplayEditor,
    replaceParagraphWithMathInlineSource,
    richBlockMarkdownTriggerReplacement,
    richInlineElementTextOffsetForRange,
    richInlineSourceCaretOffset,
    richLineBreakCaretInputText,
    richListItemFromRange,
    richListSourcePointFromRange,
    richPlainTextTransactionRangeFromSelection,
    richQuoteHardBreakDomRepair,
    richQuoteSourcePointFromRange,
    richQuoteTextReplacementRangeFromSelection,
    richRangeTouchesSourceBlock,
    richSelectionRange,
    richSourceBlocksIntersectingRange,
    richTableSourcePointFromRange,
    richTableTextReplacementRangeFromSelection,
    sourceOffsetFromListItemTextOffset,
    splitTableRowWithSourceRanges,
    suppressRichInlineActivation,
    textOffsetFromListItemSourceOffset,
    unescapeMarkdownTableCell,
    visibleListItemText,
    visibleTextFromListSourceItem,
  } = richInputControllerApi;

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    cacheElements();
    restoreSettings();
    initializeShortcutUi();
    restoreDraft();
    if (state.desktopHost) state.markdownRelativePath = '';
    bindEvents();
    applyTheme();
    applyDocumentFont();
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

  function desktopDraftScope(currentLocation) {
    if (
      currentLocation?.protocol !== 'https:'
      || currentLocation?.hostname !== DESKTOP_APP_HOST
      || !/(?:^|[?&])desktop=1(?:&|$)/.test(currentLocation.search || '')
    ) return '';
    const match = String(currentLocation.search || '').match(/(?:^|[?&])draft=([^&]+)/);
    if (!match) return 'main';
    try {
      const scope = decodeURIComponent(match[1]);
      return /^[A-Za-z0-9_-]{1,100}$/.test(scope) ? scope : 'main';
    } catch (_) {
      return 'main';
    }
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
    els.appearanceDialog = document.getElementById('appearanceDialog');
    els.documentFontSelect = document.getElementById('documentFontSelect');
    els.linkDomainDialog = document.getElementById('linkDomainDialog');
    els.allowedDomainsInput = document.getElementById('allowedDomainsInput');
    els.shortcutDialog = document.getElementById('shortcutDialog');
    els.shortcutList = document.getElementById('shortcutList');
    els.shortcutMessage = document.getElementById('shortcutMessage');
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
    const settings = readJsonWithMigration(SETTINGS_KEY, LEGACY_SETTINGS_KEY);
    state.theme = settings?.theme || defaultTheme();
    state.mode = settings?.mode || 'rich';
    state.outlineCollapsed = Boolean(settings?.outlineCollapsed);
    state.allowedLinkDomains = normalizeDomainList(settings?.allowedLinkDomains || []);
    state.documentFont = normalizeDocumentFont(settings?.documentFont);
    state.shortcuts = window.PMEShortcutManager.normalizeShortcutAssignments(settings?.shortcuts);
  }

  function defaultTheme() {
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    return prefersDark ? 'dark' : 'light';
  }

  function restoreDraft() {
    const draft = SHOULD_MIGRATE_LEGACY_DRAFT
      ? readJsonWithMigration(STORAGE_KEY, LEGACY_STORAGE_KEY)
      : readJson(STORAGE_KEY);
    if (!draft || typeof draft.markdown !== 'string') return;
    state.markdown = stripRichCaretTokens(draft.markdown);
    state.fileName = safeFileName(draft.fileName || 'untitled.md');
    state.markdownRelativePath = normalizeAssetPath(draft.markdownRelativePath || '');
    state.lastAutoSaved = draft.savedAt || null;
    state.dirty = draft.dirty !== false;
    advanceDocumentRevision();
  }

  function readJson(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function readJsonWithMigration(key, legacyKey) {
    const current = readJson(key);
    if (current !== null) return current;
    const legacy = readJson(legacyKey);
    if (legacy === null) return null;
    if (writeJson(key, legacy)) {
      try {
        localStorage.removeItem(legacyKey);
      } catch (_) {}
    }
    return legacy;
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
      case 'appearance-settings':
        showAppearanceDialog();
        break;
      case 'save-appearance':
        saveAppearanceSettings();
        break;
      case 'shortcut-settings':
        showShortcutDialog();
        break;
      case 'save-shortcuts':
        saveShortcutAssignments();
        break;
      case 'reset-shortcuts':
        restoreDefaultShortcutAssignments();
        break;
      case 'clear-shortcut':
        clearShortcutAssignment(actionButton.dataset.shortcutCommand || '');
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


  function newDocument() {
    if (requestDesktopCommand('new')) return;
    if (!confirmDocumentReplacement('新規文書')) return;
    clearAssetUrls();
    state.markdown = '# 無題\n\nここにMarkdownを書いてください。\n';
    advanceDocumentRevision();
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
    notifyDesktopTheme();
    const themeButton = document.querySelector('[data-action="toggle-theme"]');
    if (!themeButton) return;
    const label = state.theme === 'dark' ? 'ライトテーマに切り替え' : 'ダークテーマに切り替え';
    themeButton.setAttribute('aria-label', label);
    themeButton.title = label;
  }

  function normalizeDocumentFont(value) {
    return value === 'serif' ? 'serif' : 'sans';
  }

  function applyDocumentFont() {
    state.documentFont = normalizeDocumentFont(state.documentFont);
    document.documentElement.dataset.documentFont = state.documentFont;
    const button = document.querySelector('[data-action="appearance-settings"]');
    if (!button) return;
    const label = state.documentFont === 'serif' ? '本文フォント: 明朝' : '本文フォント: ゴシック';
    button.setAttribute('aria-label', label);
    button.title = label;
  }

  function showAppearanceDialog() {
    if (!els.appearanceDialog || !els.documentFontSelect) return;
    if (els.appearanceDialog.open) return;
    els.documentFontSelect.value = normalizeDocumentFont(state.documentFont);
    if (typeof els.appearanceDialog.showModal === 'function') els.appearanceDialog.showModal();
    else els.appearanceDialog.setAttribute('open', '');
    els.documentFontSelect.focus();
  }

  function saveAppearanceSettings() {
    if (!els.documentFontSelect) return;
    state.documentFont = normalizeDocumentFont(els.documentFontSelect.value);
    applyDocumentFont();
    persistSettings();
    if (els.appearanceDialog?.open && typeof els.appearanceDialog.close === 'function') {
      els.appearanceDialog.close('saved');
    } else {
      els.appearanceDialog?.removeAttribute('open');
    }
    setStatus(`本文フォント: ${state.documentFont === 'serif' ? '明朝' : 'ゴシック'}`);
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
    updateElementShortcutHint(toggle, 'toggle-outline', visible ? 'アウトラインを隠す' : 'アウトラインを表示');
  }

  function showSecurityDialog() {
    if (els.securityDialog && typeof els.securityDialog.showModal === 'function') {
      els.securityDialog.showModal();
    } else {
      alert('完全ローカル実行、CSP有効、CDN不使用、Markdown内HTMLは無効です。');
    }
  }

  function markDirty() {
    advanceDocumentRevision();
    state.dirty = true;
    updateStatusBar();
    notifyDesktopDocumentState();
  }

  function advanceDocumentRevision() {
    state.documentRevision = Number.isSafeInteger(state.documentRevision)
      && state.documentRevision < Number.MAX_SAFE_INTEGER
      ? state.documentRevision + 1
      : 1;
    return state.documentRevision;
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
      documentFont: normalizeDocumentFont(state.documentFont),
      shortcuts: shortcutAssignmentsForExport(),
    });
  }

  function notifyDesktopShortcuts(shortcuts = state.shortcuts) {
    if (!state.desktopHost || !window.chrome?.webview?.postMessage) return false;
    try {
      window.chrome.webview.postMessage({
        type: 'desktop.shortcutsChanged',
        shortcuts,
      });
      return true;
    } catch (_) {
      setStatus('Windowsアプリへショートカット設定を送信できませんでした');
      return false;
    }
  }

  function notifyDesktopShortcutCaptureState(active) {
    if (!state.desktopHost || !window.chrome?.webview?.postMessage) return false;
    try {
      window.chrome.webview.postMessage({
        type: 'desktop.shortcutCaptureState',
        active: Boolean(active),
      });
      return true;
    } catch (_) {
      setStatus('Windowsアプリへショートカット設定状態を送信できませんでした');
      return false;
    }
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

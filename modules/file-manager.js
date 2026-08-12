(() => {
  'use strict';

  function createFileManager(options = {}) {
    const state = options.state;
    const els = options.els;
    const constants = options.constants || {};
    const dependencies = options.dependencies || {};
    if (!state || !els) throw new Error('File manager requires state and element references');

    const {
      ALLOWED_IMAGE_TYPES,
      CONFIG_SETTINGS_FILE_NAME,
      DEFAULT_MARKDOWN,
      DESKTOP_ASSET_REQUEST_TIMEOUT_MS,
      FSA_DB_NAME,
      FSA_DIRECTORY_HANDLE_KEY,
      FSA_PICKER_START_HANDLE_KEY,
      FSA_SETTINGS_DIRECTORY_HANDLE_KEY,
      FSA_STORE_NAME,
      MAX_ASSET_IMAGE_BYTES,
      MAX_FOLDER_SCAN_DEPTH,
      MAX_FOLDER_SCAN_FILES,
      RICH_SOURCE_BLOCK_SELECTOR,
      SETTINGS_KEY,
      STORAGE_KEY,
    } = constants;
    const {
      applyMode,
      applyOutlineVisibility,
      applyShortcutAssignments,
      applyTheme,
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
      richSourceBlocksIntersectingRange,
      safeFileName,
      sanitizeMarkdownLabel,
      setSourceSelectionRange,
      setStatus,
      sourceMarkdownValue,
      sourceScrollElement,
      sourceSelectionRange,
      splitDomainInput,
      shortcutAssignmentsForExport,
      stripExtension,
      stripMarkdown,
      stripRichCaretTokens,
      suppressRichInlineActivation,
      syncCodeMirrorSourceFromTextarea,
      showShortcutDialog,
      updateStatusBar,
    } = dependencies;

    function initializeDesktopBridge() {
      document.body.dataset.desktopHost = 'true';
      window.chrome.webview.addEventListener('message', onDesktopHostMessage);
      postDesktopMessage({
        type: 'desktop.ready',
        dirty: state.dirty,
        fileName: state.fileName,
        shortcuts: shortcutAssignmentsForExport(),
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
        case 'host.showShortcutSettings':
          showShortcutDialog();
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
      resetShortcutAssignments({ persist: false, notify: true });
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
        const settings = parseSettingsFile(await readTextFile(file));
        applyImportedSettings(settings);
        persistSettings();
        if (els.allowedDomainsInput) els.allowedDomainsInput.value = state.allowedLinkDomains.join('\n');
        renderAll('link-settings');
        setStatus(`設定ファイルを読み込みました: 許可ドメイン${state.allowedLinkDomains.length}件${settings.shortcuts ? '、ショートカット反映済み' : ''}`);
      } catch (_) {
        setStatus('設定ファイルを読み込めませんでした。JSON形式、allowedLinkDomains、shortcutsを確認してください');
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
      setStatus(`設定を書き出しました: 許可ドメイン${state.allowedLinkDomains.length}件、ショートカット含む`);
    }

    async function grantSettingsDirectory() {
      const directoryHandle = await chooseSettingsDirectory();
      if (!directoryHandle) return false;
      const loaded = await loadSettingsFromConfigDirectory(directoryHandle, { missingOk: true });
      if (loaded) {
        setStatus(`設定フォルダを許可し、${CONFIG_SETTINGS_FILE_NAME} から読み込みました: ${state.allowedLinkDomains.length}件`);
      } else {
        await writeSettingsFileToConfigDirectory(directoryHandle);
        setStatus(`設定フォルダを許可し、現在の設定を ${CONFIG_SETTINGS_FILE_NAME} に保存しました`);
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
        setStatus(`${CONFIG_SETTINGS_FILE_NAME} に設定を保存しました: 許可ドメイン${state.allowedLinkDomains.length}件、ショートカット含む`);
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
        const settings = parseSettingsFile(await readTextFile(file));
        applyImportedSettings(settings);
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
        version: 2,
        allowedLinkDomains: normalizeDomainList(state.allowedLinkDomains),
        shortcuts: shortcutAssignmentsForExport(),
      }, null, 2)}\n`;
    }

    function parseSettingsFile(text) {
      const parsed = JSON.parse(String(text || ''));
      const values = Array.isArray(parsed)
        ? parsed
        : parsed?.allowedLinkDomains;
      if (!Array.isArray(values)) throw new Error('allowedLinkDomains must be an array');
      if (!Array.isArray(parsed) && parsed?.shortcuts !== undefined
          && (!parsed.shortcuts || typeof parsed.shortcuts !== 'object' || Array.isArray(parsed.shortcuts))) {
        throw new Error('shortcuts must be an object');
      }
      return {
        allowedLinkDomains: normalizeDomainList(values),
        shortcuts: Array.isArray(parsed) || parsed.shortcuts === undefined ? null : parsed.shortcuts,
      };
    }

    function applyImportedSettings(settings) {
      state.allowedLinkDomains = settings.allowedLinkDomains;
      if (settings.shortcuts) {
        applyShortcutAssignments(settings.shortcuts, { persist: false, notify: true });
      }
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


    return Object.freeze({
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
    });
  }

  window.PMEFileManager = Object.freeze({ createFileManager });
})();

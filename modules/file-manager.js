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
      DRAFT_STORAGE_PREFIX,
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
      MAX_FOLDER_SCAN_ENTRIES = 10000,
      MAX_FOLDER_SCAN_BYTES = 128 * 1024 * 1024,
      MAX_FOLDER_SCAN_PATH_BYTES = 1024 * 1024,
      MAX_FOLDER_SCAN_MS = 5000,
      RICH_SOURCE_BLOCK_SELECTOR,
      SETTINGS_KEY,
      STORAGE_KEY,
    } = constants;
    const {
      applyMode,
      advanceDocumentRevision,
      applyDocumentFont,
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
      richSourceBlocksIntersectingRange,
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
      suppressRichInlineActivation,
      syncCodeMirrorSourceFromTextarea,
      showShortcutDialog,
      updateStatusBar,
    } = dependencies;

    state.documentGeneration = 0;
    setDocumentBinding(state);
    let pendingFileInputGeneration = null;
    let pendingFolderInput = null;
    let activeFolderScan = null;

    function isDocumentAccessCurrent(generation) {
      return generation === state.documentGeneration;
    }

    function beginDocumentAccess() {
      activeFolderScan?.stop('cancelled');
      state.documentGeneration += 1;
      // A cancelled picker keeps the current target but invalidates older work.
      setDocumentBinding(state.documentBinding);
      return state.documentGeneration;
    }

    function setDocumentBinding(fields = {}, generation = state.documentGeneration) {
      if (!isDocumentAccessCurrent(generation)) return false;
      const binding = Object.freeze({
        generation,
        // The draft and IndexedDB are separate stores; only matching records may restore a target.
        bindingId: typeof fields.bindingId === 'string' && fields.bindingId
          ? fields.bindingId
          : window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`,
        directoryHandle: fields.directoryHandle || null,
        markdownRelativePath: normalizeAssetPath(fields.markdownRelativePath || ''),
        fileHandle: fields.fileHandle || null,
        fileName: fields.fileName || state.fileName || 'untitled.md',
        directoryName: fields.directoryName || fields.directoryHandle?.name || '',
      });
      state.documentBinding = binding;
      // These mirrors are for rendering and picker hints; saves use the record.
      state.directoryHandle = binding.directoryHandle;
      state.markdownRelativePath = binding.markdownRelativePath;
      state.fileHandle = binding.fileHandle;
      state.directoryName = binding.directoryName;
      return true;
    }

    function initializeDesktopBridge() {
      document.body.dataset.desktopHost = 'true';
      window.chrome.webview.addEventListener('message', onDesktopHostMessage);
      postDesktopMessage({
        type: 'desktop.ready',
        dirty: state.dirty,
        fileName: state.fileName,
        revision: state.documentRevision,
        shortcuts: shortcutAssignmentsForExport(),
        theme: state.theme,
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

    function notifyDesktopTheme() {
      if (!state.desktopHost) return false;
      return postDesktopMessage({
        type: 'desktop.themeChanged',
        theme: state.theme,
      });
    }

    function notifyDesktopDocumentState(force = false) {
      if (!state.desktopHost) return;
      if (
        !force
        && state.desktopLastReportedDirty === state.dirty
        && state.desktopLastReportedFileName === state.fileName
        && state.desktopLastReportedRevision === state.documentRevision
      ) return;
      state.desktopLastReportedDirty = state.dirty;
      state.desktopLastReportedFileName = state.fileName;
      state.desktopLastReportedRevision = state.documentRevision;
      postDesktopMessage({
        type: 'desktop.documentState',
        dirty: state.dirty,
        fileName: state.fileName,
        revision: state.documentRevision,
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
        case 'host.showAppearanceSettings':
          showAppearanceDialog();
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
      const generation = beginDocumentAccess();
      clearAssetUrls();
      resetDesktopImageReferenceAliases();
      state.desktopDocumentReady = message.hasDocumentFolder === true;
      state.markdown = stripRichCaretTokens(normalizeNewlines(String(message.markdown || '')));
      advanceDocumentRevision();
      state.fileName = safeFileName(message.fileName || 'untitled.md');
      setDocumentBinding({ fileName: state.fileName, markdownRelativePath: state.desktopDocumentReady ? state.fileName : '' }, generation);
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
        revision: state.documentRevision,
      });
    }

    function applyDesktopSavedState(message) {
      state.fileName = safeFileName(message.fileName || state.fileName || 'untitled.md');
      state.desktopDocumentReady = message.hasDocumentFolder === true;
      setDocumentBinding({ fileName: state.fileName, markdownRelativePath: state.desktopDocumentReady ? state.fileName : '' });
      const savedRevision = Number.isSafeInteger(message.savedRevision) ? message.savedRevision : -1;
      state.dirty = savedRevision !== state.documentRevision;
      resetDesktopImageReferenceAliases();
      renderPreview();
      state.proseMirrorRich?.refreshImages?.();
      persistDraft();
      updateStatusBar();
      notifyDesktopDocumentState(true);
      setStatus(state.dirty
        ? `${state.fileName} を保存しました。保存中の変更は未保存です`
        : `${state.fileName} を保存しました`);
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
      const binding = state.documentBinding;
      const current = () => state.documentBinding === binding && isDocumentAccessCurrent(binding.generation);
      if (!binding.markdownRelativePath || binding.directoryHandle) return false;
      if (!canPersistDirectoryHandle()) return false;
      try {
        const persisted = await readPersistedDirectoryBinding();
        if (!current() || !persisted) return false;
        if (persisted.version !== 1 || persisted.bindingId !== binding.bindingId
          || persisted.markdownRelativePath !== binding.markdownRelativePath
          || persisted.fileName !== binding.fileName || !persisted.fileHandle || !persisted.directoryHandle) {
          setStatus('下書きの保存先を確認できません。「フォルダ許可」または「フォルダから開く」を使ってください');
          return false;
        }
        const directoryHandle = persisted.directoryHandle;
        const permission = await queryDirectoryPermission(directoryHandle, 'read');
        if (!current()) return false;
        if (permission !== 'granted') {
          setStatus('前回のフォルダ権限が必要です。「フォルダ許可」または「フォルダから開く」を使ってください');
          return false;
        }
        const entries = await collectLimitedDirectoryEntries(directoryHandle, binding.generation);
        if (!current()) return false;
        const chosen = entries.find((entry) => normalizeAssetPath(entry.relativePath) === binding.markdownRelativePath);
        if (!chosen?.handle || !isMarkdownFile(chosen.file)) return false;
        const sameFile = await chosen.handle.isSameEntry(persisted.fileHandle);
        if (!current() || !sameFile) return false;
        setDocumentBinding({ ...binding, directoryHandle, fileHandle: chosen.handle, directoryName: directoryHandle.name }, binding.generation);
        state.pickerStartDirectoryHandle = directoryHandle;
        clearAssetUrls();
        buildFolderAssetUrls(entries, dirnamePath(binding.markdownRelativePath));
        renderAll('restore-folder');
        setStatus(`${state.fileName} のフォルダ参照をFile System Access APIから復元しました。画像候補: ${state.assetUrls.size}${folderScanStatusSuffix()}`);
        return true;
      } catch (_) {
        if (!current()) return false;
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

    async function persistDirectoryHandle(directoryHandle, generation = state.documentGeneration) {
      const binding = state.documentBinding;
      const current = () => state.documentBinding === binding && isDocumentAccessCurrent(generation);
      if (!current() || !directoryHandle || binding.directoryHandle !== directoryHandle
        || !binding.markdownRelativePath || !binding.fileHandle || !canPersistDirectoryHandle()) return false;
      const persisted = {
        version: 1,
        bindingId: binding.bindingId,
        directoryHandle: binding.directoryHandle,
        markdownRelativePath: binding.markdownRelativePath,
        fileHandle: binding.fileHandle,
        fileName: binding.fileName,
      };
      try {
        const db = await openFsaDatabase();
        try {
          if (!current()) return false;
          await idbRequest(db.transaction(FSA_STORE_NAME, 'readwrite').objectStore(FSA_STORE_NAME).put(persisted, FSA_DIRECTORY_HANDLE_KEY));
          return current();
        } finally { db.close(); }
      } catch (_) {
        return false;
      }
    }

    async function rememberPickerStartDirectory(directoryHandle, generation = state.documentGeneration) {
      if (!isDocumentAccessCurrent(generation) || !directoryHandle) return false;
      state.pickerStartDirectoryHandle = directoryHandle;
      if (!canPersistDirectoryHandle()) return false;
      try {
        const db = await openFsaDatabase();
        try {
          if (!isDocumentAccessCurrent(generation)) return false;
          await idbRequest(db.transaction(FSA_STORE_NAME, 'readwrite').objectStore(FSA_STORE_NAME).put(directoryHandle, FSA_PICKER_START_HANDLE_KEY));
          return isDocumentAccessCurrent(generation);
        } finally { db.close(); }
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
      const persisted = await readPersistedDirectoryBinding();
      // Legacy roots remain picker candidates for an explicitly opened file, never an automatic save target.
      return persisted?.version === 1 ? persisted.directoryHandle : persisted;
    }

    async function readPersistedDirectoryBinding() {
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
      const generation = state.documentGeneration;
      if (state.pickerStartDirectoryHandle) return state.pickerStartDirectoryHandle;
      if (!canPersistDirectoryHandle()) return null;
      const db = await openFsaDatabase();
      try {
        const handle = await idbRequest(db.transaction(FSA_STORE_NAME, 'readonly').objectStore(FSA_STORE_NAME).get(FSA_PICKER_START_HANDLE_KEY));
        if (isDocumentAccessCurrent(generation) && !state.pickerStartDirectoryHandle) state.pickerStartDirectoryHandle = handle || null;
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

    async function clearPersistedDirectoryHandle(generation = state.documentGeneration) {
      if (!canPersistDirectoryHandle()) return false;
      try {
        const db = await openFsaDatabase();
        try {
          if (!isDocumentAccessCurrent(generation)) return false;
          await idbRequest(db.transaction(FSA_STORE_NAME, 'readwrite').objectStore(FSA_STORE_NAME).delete(FSA_DIRECTORY_HANDLE_KEY));
          return isDocumentAccessCurrent(generation);
        } finally { db.close(); }
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
      const binding = state.documentBinding;
      if (!binding.directoryHandle) throw new Error('フォルダが開かれていません');
      let handle = binding.directoryHandle;
      const parts = dirnamePath(binding.markdownRelativePath).split('/').filter(Boolean);
      for (const part of parts) {
        handle = await handle.getDirectoryHandle(part, { create: false });
      }
      return handle;
    }

    async function markdownFileHandleForSnapshot(snapshot) {
      // The handle was obtained together with the root and relative path.
      // Never reconstruct a writable capability from independently mutable fields.
      if (!snapshot.binding.fileHandle) throw new Error('保存先のファイルを確認できません');
      return snapshot.binding.fileHandle;
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
      const generation = beginDocumentAccess();
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
          if (!isDocumentAccessCurrent(generation)) return;
          handlePickerError(error, 'ファイル選択を開始できませんでした');
          return;
        }

        if (!isDocumentAccessCurrent(generation) || !fileHandle) return;
        try {
          const file = await fileHandle.getFile();
          if (!isDocumentAccessCurrent(generation)) return;
          await openSingleMarkdownFile(file, { fileHandle, generation });
        } catch (error) {
          if (!isDocumentAccessCurrent(generation)) return;
          warnSafeError('open markdown file read failed', error);
          setStatus('ファイルの読み込みに失敗しました');
          return;
        }
        return;
      }

      pendingFileInputGeneration = generation;
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
      const generation = pendingFileInputGeneration ?? beginDocumentAccess();
      pendingFileInputGeneration = null;
      if (!file || !isDocumentAccessCurrent(generation)) return;
      await openSingleMarkdownFile(file, { generation });
    }

    async function openSingleMarkdownFile(file, options = {}) {
      const generation = options.generation ?? beginDocumentAccess();
      if (!isDocumentAccessCurrent(generation)) return;
      if (file.size > 10 * 1024 * 1024) {
        setStatus('10MBを超えるファイルは読み込みません');
        return;
      }
      if (!confirmDocumentReplacement('選択したファイル')) return;
      const previousDirectoryHandle = state.documentBinding.directoryHandle;

      try {
        const text = await readTextFile(file);
        if (!isDocumentAccessCurrent(generation)) return;
        state.markdown = normalizeNewlines(text);
        advanceDocumentRevision();
        state.fileName = safeFileName(file.name || 'untitled.md');
        state.dirty = false;
        clearAssetUrls();
        setDocumentBinding({ fileName: state.fileName, fileHandle: options.fileHandle }, generation);
        els.source.value = state.markdown;
        syncCodeMirrorSourceFromTextarea('open-file');
        renderAll('open');
        persistDraft();
        setStatus(`${state.fileName} を開きました`);

        if (await attachPreviouslyGrantedDirectoryToOpenedMarkdown(file, options.fileHandle || null, previousDirectoryHandle, generation)) {
          return;
        }
        if (!isDocumentAccessCurrent(generation)) return;
        await clearPersistedDirectoryHandle(generation);
        if (!isDocumentAccessCurrent(generation)) return;
        await requestDirectoryForOpenedMarkdown(file, options.fileHandle || null, generation);
      } catch (error) {
        if (!isDocumentAccessCurrent(generation)) return;
        warnSafeError('open single markdown failed', error);
        setStatus(fileReadFailureMessage(error));
      }
    }

    async function attachPreviouslyGrantedDirectoryToOpenedMarkdown(file, fileHandle, directoryHandleOverride = null, generation = state.documentGeneration) {
      if (!fileHandle?.isSameEntry) return false;
      const directoryHandle = directoryHandleOverride || state.directoryHandle || await readPersistedDirectoryHandle();
      if (!isDocumentAccessCurrent(generation) || !directoryHandle) return false;
      try {
        const permission = await queryDirectoryPermission(directoryHandle, 'readwrite');
        if (!isDocumentAccessCurrent(generation) || permission !== 'granted') return false;
        const entries = await collectLimitedDirectoryEntries(directoryHandle, generation);
        if (!isDocumentAccessCurrent(generation)) return false;
        const chosen = await findOpenedMarkdownEntry(entries, file, fileHandle);
        if (!isDocumentAccessCurrent(generation) || !chosen) return false;

        setDocumentBinding({ directoryHandle, markdownRelativePath: chosen.relativePath || chosen.file.name, fileHandle: chosen.handle || fileHandle }, generation);
        state.pickerStartDirectoryHandle = directoryHandle;
        clearAssetUrls();
        buildFolderAssetUrls(entries, dirnamePath(state.markdownRelativePath));
        await persistDirectoryHandle(directoryHandle, generation);
        if (!isDocumentAccessCurrent(generation)) return false;
        await rememberPickerStartDirectory(directoryHandle, generation);
        if (!isDocumentAccessCurrent(generation)) return false;
        renderAll('open-file-existing-folder');
        persistDraft();
        setStatus(`${state.fileName} を開きました。既存のフォルダ許可を使用しています (${state.directoryName || 'selected folder'})。画像候補: ${state.assetUrls.size}${folderScanStatusSuffix()}`);
        return true;
      } catch (_) {
        return false;
      }
    }

    async function readTextFile(file) {
      const buffer = await file.arrayBuffer();
      try {
        return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
      } catch (_) {
        const error = new Error('UTF-8として読み込めませんでした');
        error.name = 'InvalidUtf8Error';
        throw error;
      }
    }

    function fileReadFailureMessage(error) {
      return error?.name === 'InvalidUtf8Error'
        ? 'UTF-8として読み込めませんでした。ファイルの文字コードをUTF-8へ変換してください'
        : 'ファイルの読み込みに失敗しました';
    }

    async function requestDirectoryForOpenedMarkdown(file, fileHandle, generation) {
      if (!isDocumentAccessCurrent(generation)) return false;
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
        if (!isDocumentAccessCurrent(generation)) return false;
        handlePickerError(error, 'フォルダ選択を開始できませんでした');
        return false;
      }

      try {
        if (!isDocumentAccessCurrent(generation)) return false;
        return await attachDirectoryToOpenedMarkdown(file, fileHandle, directoryHandle, generation);
      } catch (error) {
        if (!isDocumentAccessCurrent(generation)) return false;
        warnSafeError('opened markdown folder read failed', error);
        setStatus('フォルダの読み込みに失敗しました');
        return false;
      }
    }

    async function attachDirectoryToOpenedMarkdown(file, fileHandle, directoryHandle, generation) {
      const entries = await collectLimitedDirectoryEntries(directoryHandle, generation);
      if (!isDocumentAccessCurrent(generation)) return false;
      const chosen = await findOpenedMarkdownEntry(entries, file, fileHandle);
      if (!isDocumentAccessCurrent(generation)) return false;
      if (!chosen) {
        setStatus(`${state.fileName} を開きました。選択フォルダ内に同じMarkdownファイルが見つかりませんでした${folderScanStatusSuffix()}`);
        return false;
      }

      setDocumentBinding({ directoryHandle, markdownRelativePath: chosen.relativePath || chosen.file.name, fileHandle: chosen.handle || fileHandle }, generation);
      state.pickerStartDirectoryHandle = directoryHandle;
      clearAssetUrls();
      buildFolderAssetUrls(entries, dirnamePath(state.markdownRelativePath));
      await persistDirectoryHandle(directoryHandle, generation);
      if (!isDocumentAccessCurrent(generation)) return false;
      await rememberPickerStartDirectory(directoryHandle, generation);
      if (!isDocumentAccessCurrent(generation)) return false;
      renderAll('open-file-folder');
      persistDraft();
      setStatus(`${state.fileName} を開きました。フォルダ参照を許可済み (${state.directoryName || 'selected folder'})。画像候補: ${state.assetUrls.size}${folderScanStatusSuffix()}`);
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
        return null;
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
      const generation = beginDocumentAccess();
      if (window.showDirectoryPicker) {
        let directoryHandle = null;
        try {
          directoryHandle = await showDirectoryPickerFromRecentDirectory({ id: 'pme-open-folder', mode: 'readwrite' });
          if (!isDocumentAccessCurrent(generation)) return;
        } catch (error) {
          if (!isDocumentAccessCurrent(generation)) return;
          handlePickerError(error, 'フォルダ選択を開始できませんでした');
          return;
        }

        try {
          const entries = await collectLimitedDirectoryEntries(directoryHandle, generation);
          if (!isDocumentAccessCurrent(generation)) return;
          await openFolderEntries(entries, directoryHandle.name || 'selected folder', directoryHandle, generation);
          return;
        } catch (error) {
          if (!isDocumentAccessCurrent(generation)) return;
          warnSafeError('open folder read failed', error);
          setStatus('フォルダの読み込みに失敗しました');
          return;
        }
      }
      state.folderInputMode = 'open';
      pendingFolderInput = { mode: 'open', generation };
      els.folderInput.click();
    }

    async function grantFolderForCurrentDocument() {
      const generation = beginDocumentAccess();
      captureCurrentMarkdownFromEditor();
      if (!state.fileName || state.fileName === 'untitled.md') {
        setStatus('先にMarkdownファイルを開くか、保存してファイル名を確定してください');
        return;
      }

      if (window.showDirectoryPicker) {
        let directoryHandle = null;
        try {
          directoryHandle = await showDirectoryPickerFromRecentDirectory({ id: 'pme-grant-folder', mode: 'readwrite' });
          if (!isDocumentAccessCurrent(generation)) return;
        } catch (error) {
          if (!isDocumentAccessCurrent(generation)) return;
          handlePickerError(error, 'フォルダ選択を開始できませんでした');
          return;
        }

        try {
          const entries = await collectLimitedDirectoryEntries(directoryHandle, generation);
          if (!isDocumentAccessCurrent(generation)) return;
          await grantFolderEntriesForCurrentDocument(entries, directoryHandle.name || 'selected folder', directoryHandle, generation);
          return;
        } catch (error) {
          if (!isDocumentAccessCurrent(generation)) return;
          warnSafeError('grant folder read failed', error);
          setStatus('フォルダ許可に失敗しました');
          return;
        }
      }

      state.folderInputMode = 'grant-current';
      pendingFolderInput = { mode: 'grant-current', generation };
      els.folderInput.click();
    }

    async function grantFolderEntriesForCurrentDocument(entries, folderName, directoryHandle = null, generation = beginDocumentAccess()) {
      if (!isDocumentAccessCurrent(generation)) return;
      const chosen = await findCurrentMarkdownEntry(entries);
      if (!isDocumentAccessCurrent(generation)) return;
      if (!chosen) {
        setStatus(`${state.fileName} が選択フォルダ内に見つかりませんでした。編集中内容は変更していません${folderScanStatusSuffix()}`);
        return;
      }

      const previousDirty = state.dirty;
      const previousMode = state.mode;
      const sourceSelection = sourceSelectionBookmark();
      const richBookmark = previousMode === 'rich' ? getRichCaretBookmark() : null;

      setDocumentBinding({ directoryHandle, markdownRelativePath: chosen.relativePath || chosen.file.name, fileHandle: chosen.handle || state.fileHandle, directoryName: directoryHandle?.name || folderName }, generation);
      state.pickerStartDirectoryHandle = directoryHandle || state.pickerStartDirectoryHandle;
      clearAssetUrls();
      buildFolderAssetUrls(entries, dirnamePath(state.markdownRelativePath));
      els.source.value = state.markdown;
      syncCodeMirrorSourceFromTextarea('grant-folder');
      refreshAfterFolderGrant(previousMode, richBookmark, sourceSelection);
      state.dirty = previousDirty;
      persistDraft();
      state.dirty = previousDirty;
      updateStatusBar();
      if (directoryHandle) {
        await persistDirectoryHandle(directoryHandle, generation);
        if (!isDocumentAccessCurrent(generation)) return;
        await rememberPickerStartDirectory(directoryHandle, generation);
      } else {
        await clearPersistedDirectoryHandle(generation);
      }
      if (!isDocumentAccessCurrent(generation)) return;
      const access = directoryHandle ? 'File System Access API' : 'フォルダ入力';
      setStatus(`${state.fileName} の編集中内容を維持したままフォルダを許可しました (${access})。画像候補: ${state.assetUrls.size}${folderScanStatusSuffix()}`);
    }

    async function findCurrentMarkdownEntry(entries) {
      const binding = state.documentBinding;
      if (binding.fileHandle?.isSameEntry) {
        for (const entry of entries) {
          if (!entry.handle?.isSameEntry) continue;
          try {
            if (await entry.handle.isSameEntry(binding.fileHandle)) return entry;
          } catch (_) {}
        }
        return null;
      }

      const currentRelative = binding.markdownRelativePath;
      if (currentRelative) {
        const exact = entries.find((entry) => normalizeAssetPath(entry.relativePath || '') === currentRelative);
        if (exact) return exact;
      }

      const currentName = safeFileName(binding.fileName || '');
      const candidates = entries.filter((entry) => isMarkdownFile(entry.file) && entry.file.name === currentName);
      if (candidates.length === 1) return candidates[0];
      if (candidates.length > 1) return chooseMarkdownEntry(candidates);
      return null;
    }

    function captureCurrentMarkdownFromEditor() {
      if (state.mode === 'rich' && isProseMirrorRichActive()) {
        state.markdown = captureProseMirrorMarkdownWithoutUnneededNormalization();
      } else {
        state.markdown = sourceMarkdownValue() || normalizeNewlines(state.markdown);
      }
      els.source.value = state.markdown;
      syncCodeMirrorSourceFromTextarea('capture-current');
    }

    function captureProseMirrorMarkdownWithoutUnneededNormalization() {
      const current = normalizeNewlines(state.markdown);
      if (!state.proseMirrorRichSourceChanged) return current;
      return normalizeNewlines(state.proseMirrorRich.markdown());
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

    async function onFolderChosen(event) {
      const files = event.target.files || [];
      if (!files.length) return;
      const pending = pendingFolderInput || { mode: state.folderInputMode, generation: beginDocumentAccess() };
      pendingFolderInput = null;
      if (!isDocumentAccessCurrent(pending.generation)) return;
      const mode = pending.mode;
      state.folderInputMode = 'open';
      let entries;
      try {
        entries = await runFolderScan(pending.generation, (context) => folderInputEntriesWithinLimits(files, context));
      } catch (error) {
        if (!isDocumentAccessCurrent(pending.generation)) return;
        warnSafeError('folder input read failed', error);
        setStatus('フォルダの読み込みに失敗しました');
        return;
      } finally {
        // Keep the FileList alive while consuming only the bounded prefix.
        if (event.target.files === files) event.target.value = '';
      }
      if (!isDocumentAccessCurrent(pending.generation)) return;
      if (mode === 'grant-current') {
        return grantFolderEntriesForCurrentDocument(entries, '', null, pending.generation);
      }
      return openFolderEntries(entries, '', null, pending.generation);
    }

    async function collectLimitedDirectoryEntries(directoryHandle, generation = state.documentGeneration) {
      return runFolderScan(generation, (context) => collectDirectoryEntries(directoryHandle, '', context, 0));
    }

    async function collectDirectoryEntries(directoryHandle, prefix, context, depth) {
      checkFolderScan(context);
      const iterator = directoryHandle.entries ? directoryHandle.entries() : directoryHandle.values();
      let complete = false;
      try {
        while (true) {
          await folderScanCheckpoint(context);
          const step = await awaitFolderScan(context, () => iterator.next());
          if (step.done) { complete = true; break; }
          const item = step.value;
          const handle = Array.isArray(item) ? item[1] : item;
          const name = String((Array.isArray(item) ? item[0] : handle.name) || handle.name || '');
          const rawPath = `${prefix}${name}`;
          visitFolderScanEntry(context, rawPath, handle.kind === 'file');
          const relativePath = normalizeAssetPath(rawPath);
          if (handle.kind === 'file') {
            if (!isFolderCandidateName(name)) continue;
            const file = await awaitFolderScan(context, () => handle.getFile());
            retainFolderScanFile(context, file, relativePath, handle);
          } else if (handle.kind === 'directory') {
            if (depth >= MAX_FOLDER_SCAN_DEPTH) { context.depthLimitHit = true; continue; }
            await collectDirectoryEntries(handle, `${relativePath}/`, context, depth + 1);
          }
        }
      } finally {
        if (!complete && iterator.return) {
          // FSA cannot abort an in-flight next(); do not wait for it during cleanup.
          try {
            Promise.resolve(iterator.return()).catch(() => {});
          } catch (_) {}
        }
      }
    }

    async function folderInputEntriesWithinLimits(files, context) {
      for (let index = 0; index < files.length; index += 1) {
        await folderScanCheckpoint(context);
        const file = files[index];
        const rawPath = String(file.webkitRelativePath || file.name || '');
        visitFolderScanEntry(context, rawPath, true);
        const relativePath = normalizeAssetPath(rawPath);
        // webkitRelativePath includes the selected root; FSA paths do not.
        const depth = Math.max(0, relativePath.split('/').filter(Boolean).length - (file.webkitRelativePath ? 2 : 1));
        if (depth > MAX_FOLDER_SCAN_DEPTH) { context.depthLimitHit = true; continue; }
        if (isFolderCandidateName(file.name || '')) retainFolderScanFile(context, file, relativePath);
      }
    }

    function isFolderCandidateName(name) {
      return /\.(?:md|markdown|txt)$/i.test(name) || hasRasterImageExtension(name) || !name.includes('.');
    }

    function visitFolderScanEntry(context, rawPath, isFile) {
      context.visited += 1;
      if (isFile) context.files += 1;
      context.pathBytes += rawPath.length * 2;
      if (context.pathBytes > MAX_FOLDER_SCAN_PATH_BYTES) {
        context.stop('pathLimitHit');
        checkFolderScan(context);
      }
    }

    function retainFolderScanFile(context, file, relativePath, handle = null) {
      const markdown = isMarkdownFile(file);
      if (!markdown && !isAllowedImageFile(file)) return;
      const perFileLimit = markdown ? 10 * 1024 * 1024 : MAX_ASSET_IMAGE_BYTES;
      if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > perFileLimit) {
        context.sizeLimitHit = true;
        return;
      }
      if (file.size > MAX_FOLDER_SCAN_BYTES - context.bytes) {
        context.stop('byteLimitHit');
        checkFolderScan(context);
      }
      context.bytes += file.size;
      context.entries.push(fileEntry(file, relativePath, handle));
    }

    function folderScanNow() {
      return window.performance?.now() ?? Date.now();
    }

    function createFolderScanContext(generation) {
      let release;
      const context = {
        generation, entries: [], files: 0, visited: 0, bytes: 0, pathBytes: 0, nextYieldAt: 0,
        deadline: folderScanNow() + MAX_FOLDER_SCAN_MS,
        stopped: new Promise((resolve) => { release = resolve; }),
        error: Object.assign(new Error('Folder scan stopped'), { name: 'AbortError' }),
        stop(reason) {
          if (context.reason) return;
          context.reason = reason;
          context[reason] = true;
          release(context.error);
        },
      };
      return context;
    }

    function checkFolderScan(context) {
      if (!isDocumentAccessCurrent(context.generation)) context.stop('cancelled');
      if (folderScanNow() >= context.deadline) context.stop('timeLimitHit');
      if (context.reason) throw context.error;
    }

    async function awaitFolderScan(context, operation) {
      checkFolderScan(context);
      const result = await Promise.race([operation(), context.stopped]);
      checkFolderScan(context);
      return result;
    }

    async function folderScanCheckpoint(context) {
      checkFolderScan(context);
      if (context.visited >= MAX_FOLDER_SCAN_ENTRIES) context.stop('entryLimitHit');
      if (context.files >= MAX_FOLDER_SCAN_FILES) context.stop('fileLimitHit');
      checkFolderScan(context);
      if (context.visited >= context.nextYieldAt) {
        context.nextYieldAt = context.visited + 64;
        let timer;
        try {
          // Yield to input/paint even if every filesystem promise resolves immediately.
          await awaitFolderScan(context, () => new Promise((resolve) => { timer = window.setTimeout(resolve, 0); }));
        } finally {
          window.clearTimeout(timer);
        }
      }
    }

    async function runFolderScan(generation, scan) {
      if (!isDocumentAccessCurrent(generation)) return [];
      activeFolderScan?.stop('cancelled');
      const context = createFolderScanContext(generation);
      activeFolderScan = context;
      if (els.folderScanCancel) els.folderScanCancel.hidden = false;
      const timer = window.setTimeout(() => context.stop('timeLimitHit'), MAX_FOLDER_SCAN_MS);
      try {
        try {
          await scan(context);
        } catch (error) {
          if (error !== context.error || context.cancelled) throw error;
        }
        if (context.cancelled || !isDocumentAccessCurrent(generation)) throw context.error;
        state.folderScanLimitMessage = folderScanLimitMessage(context);
        if (state.folderScanLimitMessage) {
          setStatus(state.folderScanLimitMessage);
          warnFolderScanLimitIfNeeded();
        }
        return context.entries;
      } finally {
        window.clearTimeout(timer);
        if (context.cancelled) context.entries.length = 0;
        if (activeFolderScan === context) {
          activeFolderScan = null;
          if (els.folderScanCancel) els.folderScanCancel.hidden = true;
        }
      }
    }

    function cancelFolderScan() {
      if (!activeFolderScan) return;
      beginDocumentAccess();
      setStatus('フォルダ走査を中止しました。編集中の文書は変更していません');
    }

    function folderScanLimitMessage(context) {
      if (!context) return '';
      const limits = [];
      if (context.fileLimitHit) limits.push(`最大${MAX_FOLDER_SCAN_FILES.toLocaleString()}ファイル`);
      if (context.depthLimitHit) limits.push(`最大${MAX_FOLDER_SCAN_DEPTH}階層`);
      if (context.entryLimitHit) limits.push(`最大${MAX_FOLDER_SCAN_ENTRIES.toLocaleString()}項目（フォルダを含む）`);
      if (context.byteLimitHit) limits.push(`合計${MAX_FOLDER_SCAN_BYTES / 1024 / 1024}MiB`);
      if (context.pathLimitHit) limits.push(`パス文字列合計${MAX_FOLDER_SCAN_PATH_BYTES / 1024 / 1024}MiB`);
      if (context.timeLimitHit) limits.push(`${MAX_FOLDER_SCAN_MS / 1000}秒`);
      if (context.sizeLimitHit) limits.push('Markdownは10MiB、画像は25MiB以下');
      return limits.length ? `フォルダ走査上限（${limits.join('、')}）に達したため一部を読み飛ばしました` : '';
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

    async function openFolderEntries(entries, folderName, directoryHandle = null, generation = beginDocumentAccess()) {
      if (!isDocumentAccessCurrent(generation)) return;

      const markdownEntries = entries.filter((entry) => isMarkdownFile(entry.file));
      if (!markdownEntries.length) {
        setStatus(`フォルダ内にMarkdownファイルがありません${folderScanStatusSuffix()}`);
        return;
      }

      const chosen = await chooseMarkdownEntry(markdownEntries);
      if (!isDocumentAccessCurrent(generation) || !chosen) return;
      if (chosen.file.size > 10 * 1024 * 1024) {
        setStatus('10MBを超えるファイルは読み込みません');
        return;
      }
      if (!confirmDocumentReplacement('選択したファイル')) return;

      try {
        const markdown = await readTextFile(chosen.file);
        if (!isDocumentAccessCurrent(generation)) return;
        clearAssetUrls();
        state.markdown = normalizeNewlines(markdown);
        advanceDocumentRevision();
        state.fileName = safeFileName(chosen.file.name || 'untitled.md');
        setDocumentBinding({ directoryHandle, markdownRelativePath: chosen.relativePath || chosen.file.name, fileHandle: chosen.handle, fileName: state.fileName, directoryName: directoryHandle?.name || folderName }, generation);
        state.pickerStartDirectoryHandle = directoryHandle || state.pickerStartDirectoryHandle;
        buildFolderAssetUrls(entries, dirnamePath(state.markdownRelativePath));
        // Publish the new document before persistence can yield to another edit.
        state.dirty = false;
        els.source.value = state.markdown;
        syncCodeMirrorSourceFromTextarea('open-folder');
        renderAll('open-folder');
        persistDraft();
        if (directoryHandle) {
          await persistDirectoryHandle(directoryHandle, generation);
          if (!isDocumentAccessCurrent(generation)) return;
          await rememberPickerStartDirectory(directoryHandle, generation);
        } else {
          await clearPersistedDirectoryHandle(generation);
        }
        if (!isDocumentAccessCurrent(generation)) return;
        const count = state.assetUrls.size;
        const suffix = folderName ? ` (${folderName})` : '';
        const access = directoryHandle ? 'File System Access API' : 'フォルダ入力';
        const assetsHint = directoryHandle ? '。貼り付け/ドロップ画像はassetsフォルダに保存できます' : '';
        setStatus(`${state.fileName} をフォルダ基準で開きました${suffix} (${access})。画像候補: ${count}${assetsHint}${folderScanStatusSuffix()}`);
      } catch (error) {
        if (!isDocumentAccessCurrent(generation)) return;
        warnSafeError('open folder markdown failed', error);
        setStatus(fileReadFailureMessage(error));
      }
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
      captureCurrentMarkdownFromEditor();
      if (requestDesktopCommand('save')) return;
      const snapshot = currentDocumentSaveSnapshot();
      if (await saveMarkdownToOpenedFile(snapshot)) return;
      if (snapshot.binding !== state.documentBinding) return;
      downloadMarkdown();
    }

    function currentDocumentSaveSnapshot() {
      const binding = state.documentBinding;
      return Object.freeze({
        markdown: state.markdown,
        revision: state.documentRevision,
        binding,
        directoryHandle: binding.directoryHandle,
        markdownRelativePath: binding.markdownRelativePath,
        fileName: binding.fileName,
      });
    }

    async function saveMarkdownToOpenedFile(snapshot) {
      if (!snapshot.directoryHandle || !snapshot.markdownRelativePath) return false;
      if (!window.isSecureContext) {
        setStatus('上書き保存にはlocalhostなどの安全なHTTP環境が必要です。ダウンロード保存に切り替えます');
        return false;
      }
      if (!await ensureDirectoryPermission(snapshot.directoryHandle, 'readwrite')) {
        if (snapshot.binding !== state.documentBinding) return true;
        setStatus('Markdownファイルの上書き保存に必要なフォルダ書き込み権限がありません。ダウンロード保存に切り替えます');
        return false;
      }

      try {
        if (snapshot.binding !== state.documentBinding) return true;
        const fileHandle = await markdownFileHandleForSnapshot(snapshot);
        if (snapshot.binding !== state.documentBinding) return true;
        const writable = await fileHandle.createWritable();
        try {
          await writable.write(new Blob([snapshot.markdown], { type: 'text/markdown;charset=utf-8' }));
        } finally {
          await writable.close();
        }
        if (snapshot.binding !== state.documentBinding) return true;
        const savedCurrentRevision = snapshot.revision === state.documentRevision;
        if (savedCurrentRevision) state.dirty = false;
        persistDraft();
        updateStatusBar();
        setStatus(savedCurrentRevision
          ? `${snapshot.markdownRelativePath} に上書き保存しました`
          : `${snapshot.markdownRelativePath} に保存しました。保存中の変更は未保存です`);
        return true;
      } catch (_) {
        if (snapshot.binding !== state.documentBinding) return true;
        setStatus('Markdownファイルの上書き保存に失敗しました。ダウンロード保存に切り替えます');
        return false;
      }
    }

    function downloadMarkdown() {
      captureCurrentMarkdownFromEditor();
      const name = ensureExtension(state.fileName || 'untitled.md', '.md');
      downloadBlob(name, state.markdown, 'text/markdown;charset=utf-8');
      state.dirty = false;
      persistDraft();
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
        localStorage.removeItem(LEGACY_STORAGE_KEY);
      } catch (_) {}
      resetDocumentState();
      if (options.status !== false) setStatus('下書きを削除し、文書を初期状態に戻しました');
    }

    function resetDocumentState() {
      const generation = beginDocumentAccess();
      window.clearTimeout(state.saveTimer);
      window.clearTimeout(state.renderTimer);
      window.clearTimeout(state.richReparseTimer);
      clearAssetUrls();
      state.markdown = DEFAULT_MARKDOWN;
      advanceDocumentRevision();
      state.fileName = 'untitled.md';
      setDocumentBinding({ fileName: state.fileName }, generation);
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
        localStorage.removeItem(LEGACY_SETTINGS_KEY);
      } catch (_) {}
      state.theme = defaultTheme();
      state.mode = 'rich';
      state.outlineCollapsed = false;
      state.allowedLinkDomains = [];
      state.documentFont = 'sans';
      resetShortcutAssignments({ persist: false, notify: true });
      if (els.allowedDomainsInput) els.allowedDomainsInput.value = '';
      applyTheme();
      applyDocumentFont();
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
      const generation = beginDocumentAccess();
      clearFolderPermissionState();
      await deleteFsaDatabase();
      if (!isDocumentAccessCurrent(generation)) return;
      renderAll('folder-permission-clear');
      if (options.status !== false) setStatus('フォルダ権限の記録を削除しました。保存済みファイルやassets画像は削除していません');
    }

    function clearFolderPermissionState() {
      clearAssetUrls();
      setDocumentBinding({});
      state.pickerStartDirectoryHandle = null;
      state.settingsDirectoryHandle = null;
      state.settingsDirectoryName = '';
      state.folderScanLimitMessage = '';
    }

    async function clearAllLocalData() {
      if (!confirm('この操作はブラウザ内の下書き・設定・許可ドメイン・フォルダ権限の記録を削除します。保存済みMarkdownファイルや assets フォルダ内の画像は削除しません。続行しますか？')) return;
      clearDraftData({ status: false });
      resetSettingsData({ status: false });
      await clearFolderPermissionRecords({ status: false });
      try {
        removeAllDraftStorageKeys();
        localStorage.removeItem(SETTINGS_KEY);
        localStorage.removeItem(LEGACY_SETTINGS_KEY);
      } catch (_) {}
      state.allowedLinkDomains = [];
      if (els.allowedDomainsInput) els.allowedDomainsInput.value = '';
      renderAll('local-data-clear');
      setStatus('すべてのローカルデータを削除しました。保存済みMarkdownファイルやassets画像は削除していません');
    }

    function removeAllDraftStorageKeys() {
      const keys = [];
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (key === LEGACY_STORAGE_KEY || key === DRAFT_STORAGE_PREFIX || key?.startsWith(`${DRAFT_STORAGE_PREFIX}:`)) {
          keys.push(key);
        }
      }
      keys.forEach((key) => localStorage.removeItem(key));
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
        setStatus(`設定ファイルを読み込みました: 許可ドメイン${state.allowedLinkDomains.length}件${settings.shortcuts ? '、ショートカット反映済み' : ''}${settings.documentFont ? '、本文フォント反映済み' : ''}`);
      } catch (_) {
        setStatus('設定ファイルを読み込めませんでした。JSON形式、allowedLinkDomains、documentFont、shortcutsを確認してください');
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
        version: 3,
        allowedLinkDomains: normalizeDomainList(state.allowedLinkDomains),
        documentFont: normalizeDocumentFont(state.documentFont),
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
      if (!Array.isArray(parsed) && parsed?.documentFont !== undefined
          && !['sans', 'serif'].includes(parsed.documentFont)) {
        throw new Error('documentFont must be sans or serif');
      }
      return {
        allowedLinkDomains: normalizeDomainList(values),
        documentFont: Array.isArray(parsed) || parsed.documentFont === undefined ? null : parsed.documentFont,
        shortcuts: Array.isArray(parsed) || parsed.shortcuts === undefined ? null : parsed.shortcuts,
      };
    }

    function applyImportedSettings(settings) {
      state.allowedLinkDomains = settings.allowedLinkDomains;
      if (settings.documentFont) {
        state.documentFont = normalizeDocumentFont(settings.documentFont);
        applyDocumentFont();
      }
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
      beginDocumentAccess,
      beginImageInsertion,
      cancelFolderScan,
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
      setDocumentBinding,
      showLinkDomainDialog,
    });
  }

  window.PMEFileManager = Object.freeze({ createFileManager });
})();

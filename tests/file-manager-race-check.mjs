import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

// All file handles, IndexedDB requests, writes, and object URLs are in memory.
// Only the production JavaScript source is read from the real filesystem.
const source = readFileSync(new URL('../modules/file-manager.js', import.meta.url), 'utf8');
const imagePolicySource = readFileSync(new URL('../modules/image-policy.js', import.meta.url), 'utf8');
const PNG_BYTES = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5xkAAAAASUVORK5CYII=', 'base64'));
const NATIVE_DOCUMENT_HOST = 'pme-document.local';
const DIRECTORY_KEY = 'document-directory';
const PICKER_KEY = 'picker-directory';
const INITIAL_BINDING_ID = 'draft-binding-old';
const tests = [];
let bindingIdCounter = 0;

function test(name, run) {
  tests.push({ name, run });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function pause() {
  const entered = deferred();
  const released = deferred();
  return {
    entered: entered.promise,
    release: released.resolve,
    reject: released.reject,
    async wait() {
      entered.resolve();
      return released.promise;
    },
  };
}

async function bounded(promise, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), 3000); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function namedError(name) {
  return Object.assign(new Error(name), { name });
}

function memoryFile(name, text, type = 'text/markdown') {
  return {
    name,
    size: new TextEncoder().encode(text).byteLength,
    type,
    text,
    readPause: null, readCalls: 0,
    async arrayBuffer() {
      this.readCalls += 1;
      if (this.readPause) await this.readPause.wait();
      return new TextEncoder().encode(this.text).buffer;
    },
  };
}

function memoryImage(name = 'picture.png', bytes = PNG_BYTES, type = 'image/png') {
  return {
    name, size: bytes.byteLength, type, readPause: null, readCalls: 0,
    async arrayBuffer() {
      this.readCalls += 1;
      if (this.readPause) await this.readPause.wait();
      return Uint8Array.from(bytes).buffer;
    },
  };
}

function pngWithDimensions(width, height) {
  const bytes = Uint8Array.from(PNG_BYTES);
  const header = new DataView(bytes.buffer);
  header.setUint32(16, width);
  header.setUint32(20, height);
  return bytes;
}

function memoryRoot(name, markdown = '# File content', fileName = 'draft.md') {
  const writes = [];
  const directories = new Map();
  const files = new Map();
  const root = {
    kind: 'directory', name, files, directories, writes,
    permission: 'granted', permissionPause: null, writePermissionPause: null, scanPause: null,
    async queryPermission({ mode }) {
      if (mode === 'read' && this.permissionPause) await this.permissionPause.wait();
      if (mode === 'readwrite' && this.writePermissionPause) await this.writePermissionPause.wait();
      return this.permission;
    },
    async requestPermission() { return this.permission; },
    async *entries() {
      if (this.scanPause) await this.scanPause.wait();
      yield* directories.entries();
      yield* files.entries();
    },
    async getDirectoryHandle(childName, options = {}) {
      if (!directories.has(childName)) {
        if (!options.create) throw namedError('NotFoundError');
        directories.set(childName, memoryRoot(`${name}/${childName}`, null));
      }
      return directories.get(childName);
    },
    async getFileHandle(childName, options = {}) {
      if (!files.has(childName)) {
        if (!options.create) throw namedError('NotFoundError');
        this.addFile(memoryFile(childName, ''));
      }
      return files.get(childName);
    },
    addFile(file) {
      const handle = {
        kind: 'file', name: file.name, file, writePause: null, getFilePause: null, identityPause: null, getFileCalls: 0,
        async getFile() {
          this.getFileCalls += 1;
          if (this.getFilePause) await this.getFilePause.wait();
          return this.file;
        },
        async isSameEntry(other) { if (this.identityPause) await this.identityPause.wait(); return this === other; },
        async createWritable() {
          return {
            async write(blob) {
              if (handle.writePause) await handle.writePause.wait();
              const text = await blob.text();
              writes.push({ root: name, path: file.name, text });
              handle.file = memoryFile(file.name, text, file.type);
            },
            async close() {},
          };
        },
      };
      files.set(file.name, handle);
      return handle;
    },
  };
  if (markdown !== null) root.addFile(memoryFile(fileName, markdown));
  root.addFile(memoryImage(`${name}.png`));
  return root;
}

function requestFrom(operation) {
  const request = {};
  Promise.resolve().then(operation).then((result) => {
    request.result = result;
    request.onsuccess?.();
  }, (error) => {
    request.error = error;
    request.onerror?.();
  });
  return request;
}

function bindingRecord(root, bindingId = INITIAL_BINDING_ID, relativePath = 'draft.md') {
  return {
    version: 1, bindingId, directoryHandle: root, markdownRelativePath: relativePath,
    fileHandle: root.files.get(path.posix.basename(relativePath)), fileName: path.posix.basename(relativePath),
  };
}

function createHarness(options = {}) {
  const oldRoot = options.oldRoot || memoryRoot('old-root', '# Previous file');
  const persistedRecord = Object.hasOwn(options, 'persistedRecord')
    ? options.persistedRecord : bindingRecord(oldRoot);
  const persisted = new Map([[DIRECTORY_KEY, persistedRecord]]);
  const draft = {
    markdown: '# Restored draft', fileName: 'draft.md', markdownRelativePath: 'draft.md',
    bindingId: INITIAL_BINDING_ID, dirty: true,
    ...options.draft,
  };
  if (Object.hasOwn(options, 'draftBindingId')) draft.bindingId = options.draftBindingId;
  const directoryPickers = [];
  const filePickers = [];
  const effects = {
    statuses: [], renders: [], revokedUrls: [], downloads: [], warnings: [], persistedDrafts: 0, draftSnapshots: [],
    createdUrls: [], imageRenders: 0, fetches: [], desktopMessages: [], canonicalBlobReads: 0,
  };
  const controls = {
    openPause: null, openFailure: null, readPause: null, deletePause: null, putPause: null, putFailure: null,
    confirmDirectory: true, allowReplacement: true,
    imageTimeouts: new Map(), fetch: null, canonicalBlobPause: null, desktopMessage: null,
  };
  const state = {
    ...draft,
    directoryHandle: null, fileHandle: null, directoryName: '', pickerStartDirectoryHandle: null,
    documentGeneration: 0, documentRevision: 1, dirty: draft.dirty !== false, mode: 'source', assetUrls: new Map(),
    folderScanLimitMessage: '', folderInputMode: 'open', richUndoStack: [], desktopHost: false,
    desktopAssetRequests: new Map(), desktopImageAliases: new Map(),
  };
  const els = {
    source: { value: state.markdown, scrollTop: 0 },
    fileInput: { click() {} }, folderInput: { click() {} }, folderScanCancel: { hidden: true },
  };
  const store = {
    get(key) {
      const value = persisted.get(key);
      const pending = key === DIRECTORY_KEY ? controls.readPause : null;
      if (pending) controls.readPause = null;
      return requestFrom(async () => { if (pending) await pending.wait(); return value; });
    },
    put(value, key) {
      const pending = controls.putPause;
      controls.putPause = null;
      const failure = controls.putFailure;
      controls.putFailure = null;
      return requestFrom(async () => {
        if (failure) throw failure;
        persisted.set(key, value);
        if (pending) await pending.wait();
        return key;
      });
    },
    delete(key) { return requestFrom(() => persisted.delete(key)); },
  };
  const db = { close() {}, transaction: () => ({ objectStore: () => store }) };
  const window = {
    isSecureContext: true,
    AbortController,
    chrome: { webview: {
      addEventListener(type, listener) {
        assert.equal(type, 'message');
        controls.desktopMessage = listener;
      },
      postMessage(message) { effects.desktopMessages.push(message); },
    } },
    crypto: { randomUUID: () => `generated-binding-${++bindingIdCounter}` },
    indexedDB: {
      open() {
        const pending = controls.openPause;
        const failure = controls.openFailure;
        controls.openPause = null;
        controls.openFailure = null;
        return requestFrom(async () => {
          if (pending) await pending.wait();
          if (failure) throw failure;
          return db;
        });
      },
      deleteDatabase: () => requestFrom(async () => {
        if (controls.deletePause) await controls.deletePause.wait();
        persisted.clear();
      }),
    },
    async showDirectoryPicker() {
      assert.ok(directoryPickers.length, 'unexpected directory picker');
      const chosen = directoryPickers.shift();
      if (chosen instanceof Error) throw chosen;
      return typeof chosen === 'function' ? chosen() : chosen;
    },
    async showOpenFilePicker() {
      assert.ok(filePickers.length, 'unexpected file picker');
      const chosen = filePickers.shift();
      if (chosen instanceof Error) throw chosen;
      return typeof chosen === 'function' ? chosen() : [chosen];
    },
    console: { warn: (...args) => effects.warnings.push(args) },
    fetch(url, init) {
      effects.fetches.push({ url, init });
      assert.equal(typeof controls.fetch, 'function', 'unexpected native image fetch');
      return controls.fetch(url, init);
    },
    clearTimeout(timer) {
      if (!controls.imageTimeouts.delete(timer)) clearTimeout(timer);
    },
    setTimeout(callback, delay = 0) {
      if (options.manualImageTimeout && delay === 5000) {
        const timer = {};
        controls.imageTimeouts.set(timer, callback);
        return timer;
      }
      const timer = setTimeout(callback, delay);
      timer.unref();
      return timer;
    },
  };
  let objectUrlId = 0;
  const document = {
    activeElement: els.source,
    body: { dataset: {}, appendChild() {} },
    createElement(tag) {
      assert.equal(tag, 'a', 'unexpected DOM operation in file manager test');
      return { click() { effects.downloads.push(this.download); }, remove() {} };
    },
  };
  const dependencies = {
    normalizeAssetPath: (value) => String(value || '').replace(/\\/g, '/'),
    normalizeNewlines: (value) => String(value || '').replace(/\r\n?/g, '\n'),
    safeFileName: (value) => String(value || ''),
    stripExtension: (value) => String(value || '').replace(/\.[^.\\/]+$/, ''),
    decodeLocalImagePath: (value) => decodeURIComponent(value),
    basenamePath: (value) => path.posix.basename(value),
    dirnamePath: (value) => { const dir = path.posix.dirname(value); return dir === '.' ? '' : dir; },
    ensureExtension: (value, extension) => value.endsWith(extension) ? value : `${value}${extension}`,
    makeRelativePath: (base, target) => path.posix.relative(base || '.', target),
    isUnsafeRelativePath: (value) => value.startsWith('../') || value.startsWith('/'),
    hasRasterImageExtension: (value) => /\.(png|jpg|jpeg|gif|webp)$/i.test(value),
    stripRichCaretTokens: (value) => value,
    confirmDocumentReplacement: () => controls.allowReplacement,
    advanceDocumentRevision: () => { state.documentRevision += 1; },
    sourceMarkdownValue: () => els.source.value,
    sourceSelectionRange: () => ({ start: 2, end: 4 }),
    sourceScrollElement: () => els.source,
    isCodeMirrorSourceReady: () => false,
    isProseMirrorRichActive: () => false,
    getRichCaretBookmark: () => null,
    shortcutAssignmentsForExport: () => [],
    setStatus: (message) => effects.statuses.push(message),
    renderAll: (reason) => effects.renders.push(reason),
    persistDraft: () => {
      effects.persistedDrafts += 1;
      effects.draftSnapshots.push({
        markdown: state.markdown, dirty: state.dirty, fileName: state.fileName,
        markdownRelativePath: state.documentBinding.markdownRelativePath,
        bindingId: state.documentBinding.bindingId,
      });
    },
    syncCodeMirrorSourceFromTextarea() {}, updateStatusBar() {},
    renderPreview() { effects.imageRenders += 1; }, renderRich() {}, renderOutline() {}, applyOutlineVisibility() {},
    setSourceSelectionRange() {}, restoreRichCaret() {},
  };
  const sandbox = {
    window, document, TextDecoder, Uint8Array, atob, btoa, performance, crypto: window.crypto,
    Blob: class extends Blob {
      async arrayBuffer() {
        effects.canonicalBlobReads += 1;
        if (controls.canonicalBlobPause) await controls.canonicalBlobPause.wait();
        return super.arrayBuffer();
      }
    },
    URL: class extends URL {
      static createObjectURL(blob) {
        const url = `blob:memory-${++objectUrlId}`;
        effects.createdUrls.push({ url, blob });
        return url;
      }
      static revokeObjectURL(value) { effects.revokedUrls.push(value); }
    },
    localStorage: { removeItem() {}, getItem: () => null, setItem() {} },
    confirm: () => controls.confirmDirectory,
    alert: (message) => effects.warnings.push(message),
    prompt: (_message, defaultValue) => defaultValue,
  };
  vm.runInNewContext(imagePolicySource, sandbox, { filename: 'image-policy.js' });
  vm.runInNewContext(source, sandbox, { filename: 'file-manager.js' });
  const api = window.PMEFileManager.createFileManager({
    state, els, dependencies,
    constants: {
      FSA_DB_NAME: 'memory-only', FSA_STORE_NAME: 'handles',
      FSA_DIRECTORY_HANDLE_KEY: DIRECTORY_KEY, FSA_PICKER_START_HANDLE_KEY: PICKER_KEY,
      FSA_SETTINGS_DIRECTORY_HANDLE_KEY: 'settings-directory',
      ALLOWED_IMAGE_TYPES: new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']),
      DESKTOP_DOCUMENT_HOST: NATIVE_DOCUMENT_HOST, MAX_FOLDER_SCAN_FILES: 100, MAX_FOLDER_SCAN_DEPTH: 4,
      DESKTOP_ASSET_REQUEST_TIMEOUT_MS: 1000,
      MAX_ASSET_IMAGE_BYTES: 25 * 1024 * 1024,
      MAX_FOLDER_SCAN_ENTRIES: 10000, MAX_FOLDER_SCAN_BYTES: 128 * 1024 * 1024,
      MAX_FOLDER_SCAN_PATH_BYTES: 1024 * 1024, MAX_FOLDER_SCAN_MS: 5000,
      DEFAULT_MARKDOWN: '# Default document',
      ...options.scanLimits,
    },
  });
  assert.equal(typeof api.beginDocumentAccess, 'function', 'document access invalidation must be public for app document resets');
  assert.equal(typeof api.setDocumentBinding, 'function', 'the shared document binding setter must be available to the app');
  api.setDocumentBinding({
    directoryHandle: null, markdownRelativePath: state.markdownRelativePath, fileHandle: null,
    fileName: state.fileName, directoryName: '', bindingId: draft.bindingId,
  });
  return { api, state, els, controls, effects, oldRoot, persisted, directoryPickers, filePickers };
}

function visibleState(harness) {
  const { state, els, effects } = harness;
  return {
    binding: state.documentBinding,
    root: state.directoryHandle, relativePath: state.markdownRelativePath,
    file: state.fileHandle, fileName: state.fileName, directoryName: state.directoryName,
    pickerStart: state.pickerStartDirectoryHandle, markdown: state.markdown, source: els.source.value,
    revision: state.documentRevision, dirty: state.dirty, assets: [...state.assetUrls],
    imageCandidates: [...state.imageAssetFiles.keys()],
    scanLimitMessage: state.folderScanLimitMessage,
    statuses: [...effects.statuses], renders: [...effects.renders], revokedUrls: [...effects.revokedUrls],
    persistedDrafts: effects.persistedDrafts,
  };
}

function assertUnchanged(harness, expected, label) {
  const actual = visibleState(harness);
  assert.equal(actual.binding, expected.binding, `${label}: binding identity changed`);
  assert.equal(actual.root, expected.root, `${label}: directory handle changed`);
  assert.equal(actual.file, expected.file, `${label}: file handle changed`);
  assert.deepEqual(actual, expected, `${label}: stale completion changed document or UI state`);
}

function assertTargetPreserved(harness, expected, label) {
  const actual = visibleState(harness);
  // Starting a newer operation may renew the generation of the same binding.
  actual.binding = expected.binding;
  assert.deepEqual(actual, expected, `${label}: current document target or content changed`);
}

function edit(harness, markdown) {
  harness.state.markdown = markdown;
  harness.els.source.value = markdown;
  harness.state.documentRevision += 1;
  harness.state.dirty = true;
}

function bindNewDocument(harness) {
  const generation = harness.api.beginDocumentAccess();
  harness.state.fileName = 'untitled.md';
  harness.api.setDocumentBinding({
    directoryHandle: null, markdownRelativePath: '', fileHandle: null,
    fileName: 'untitled.md', directoryName: '',
  }, generation);
  edit(harness, '# New unsaved document');
  harness.state.dirty = false;
  harness.api.clearAssetUrls();
}

async function suspendedRestore(harness, stage) {
  const pending = pause();
  if (stage === 'indexeddb') harness.controls.readPause = pending;
  if (stage === 'permission') harness.oldRoot.permissionPause = pending;
  if (stage === 'scan') harness.oldRoot.scanPause = pending;
  const completion = harness.api.restorePersistedDirectoryHandle();
  await bounded(pending.entered, `restore reached ${stage}`);
  return { pending, completion };
}

const replacements = {
  async folder(harness, newRoot) {
    harness.directoryPickers.push(newRoot);
    await harness.api.openFolder();
    assert.equal(harness.state.directoryHandle, newRoot);
  },
  async fileInput(harness, newRoot) {
    harness.directoryPickers.push(newRoot);
    await harness.api.onFileChosen({ target: { files: [newRoot.files.get('draft.md').file], value: 'chosen' } });
    assert.equal(harness.state.directoryHandle, newRoot);
  },
  async grant(harness, newRoot) {
    harness.directoryPickers.push(newRoot);
    await harness.api.grantFolderForCurrentDocument();
    assert.equal(harness.state.directoryHandle, newRoot);
    assert.equal(harness.state.markdown, '# Restored draft', 'grant must retain the editor content');
    assert.equal(harness.state.dirty, true, 'grant must retain unsaved changes');
  },
  async newDocument(harness) { bindNewDocument(harness); },
  async clearDraft(harness) { harness.api.clearDraftData(); },
  async clearPermission(harness) { await harness.api.clearFolderPermissionRecords(); },
};

for (const stage of ['indexeddb', 'permission', 'scan']) {
  for (const [replacement, replace] of Object.entries(replacements)) {
    test(`restore at ${stage} cannot overwrite ${replacement}`, async () => {
      const harness = createHarness();
      const newRoot = memoryRoot('new-root', '# New document');
      const { pending, completion } = await suspendedRestore(harness, stage);
      await replace(harness, newRoot);
      const expected = visibleState(harness);
      pending.release();
      assert.equal(await completion, false, 'a superseded restore must be discarded');
      assertUnchanged(harness, expected, `${stage}/${replacement}`);
      assert.ok(Object.isFrozen(harness.state.documentBinding), 'active binding must be immutable');
      if (harness.state.directoryHandle === newRoot) {
        await harness.api.saveMarkdown();
        assert.deepEqual(newRoot.writes, [{ root: 'new-root', path: 'draft.md', text: expected.markdown }]);
      }
      assert.deepEqual(harness.oldRoot.writes, [], 'stale restore must never redirect writes into the old directory');
    });
  }
}

test('normal restore binds the exact file and preserves the draft', async () => {
  const harness = createHarness();
  assert.equal(await harness.api.restorePersistedDirectoryHandle(), true);
  assert.equal(harness.state.directoryHandle, harness.oldRoot);
  assert.equal(harness.state.fileHandle, harness.oldRoot.files.get('draft.md'));
  assert.equal(harness.state.markdown, '# Restored draft');
  assert.equal(harness.state.dirty, true);
  assert.ok(harness.state.imageAssetFiles.has('old-root.png'));
  assert.ok(Object.isFrozen(harness.state.documentBinding));
  await harness.api.saveMarkdown();
  assert.deepEqual(harness.oldRoot.writes, [{ root: 'old-root', path: 'draft.md', text: '# Restored draft' }]);
});

test('editing the same document does not cancel a valid restoration', async () => {
  const harness = createHarness();
  const { pending, completion } = await suspendedRestore(harness, 'scan');
  edit(harness, '# Edited during restore');
  pending.release();
  assert.equal(await completion, true);
  assert.equal(harness.state.markdown, '# Edited during restore');
  assert.equal(harness.els.source.value, '# Edited during restore');
  assert.equal(harness.state.dirty, true);
  assert.equal(harness.state.directoryHandle, harness.oldRoot);
});

test('denied restore permission leaves the current document unattached', async () => {
  const harness = createHarness();
  harness.oldRoot.permission = 'denied';
  assert.equal(await harness.api.restorePersistedDirectoryHandle(), false);
  assert.equal(harness.state.directoryHandle, null);
  assert.equal(harness.state.fileHandle, null);
  assert.equal(harness.state.markdown, '# Restored draft');
  assert.equal(harness.state.dirty, true);
  assert.ok(harness.effects.statuses.length > 0, 'a current permission denial should be reported');
});

test('a stale permission denial cannot replace the new document status', async () => {
  const harness = createHarness();
  harness.oldRoot.permission = 'denied';
  const { pending, completion } = await suspendedRestore(harness, 'permission');
  const newRoot = memoryRoot('new-root');
  await replacements.folder(harness, newRoot);
  const expected = visibleState(harness);
  pending.release();
  assert.equal(await completion, false);
  assertUnchanged(harness, expected, 'stale permission denial');
});

test('a stale scan failure cannot replace the new document status', async () => {
  const harness = createHarness();
  const { pending, completion } = await suspendedRestore(harness, 'scan');
  await replacements.folder(harness, memoryRoot('new-root'));
  const expected = visibleState(harness);
  pending.reject(namedError('NotReadableError'));
  assert.equal(await completion, false);
  assertUnchanged(harness, expected, 'stale scan failure');
});

test('restore requires the captured Markdown path to exist in the scanned root', async () => {
  const harness = createHarness();
  harness.oldRoot.files.delete('draft.md');
  harness.oldRoot.addFile(memoryFile('different.md', '# Different file'));
  assert.equal(await harness.api.restorePersistedDirectoryHandle(), false);
  assert.equal(harness.state.directoryHandle, null);
  assert.equal(harness.state.fileHandle, null);
  assert.deepEqual(harness.oldRoot.writes, []);
});

test('cancelling a picker preserves an established document binding', async () => {
  const harness = createHarness();
  await harness.api.restorePersistedDirectoryHandle();
  await loadedImage(harness, 'old-root.png');
  const expected = visibleState(harness);
  harness.directoryPickers.push(namedError('AbortError'));
  await harness.api.openFolder();
  assertTargetPreserved(harness, expected, 'cancelled picker');
});

test('a known file handle mismatch cannot attach a same-name, same-size file', async () => {
  const harness = createHarness();
  const selectedRoot = memoryRoot('selected-root', '# Same size');
  const unrelatedRoot = memoryRoot('unrelated-root', '# Same size');
  harness.filePickers.push(selectedRoot.files.get('draft.md'));
  harness.directoryPickers.push(unrelatedRoot);
  await harness.api.openMarkdownFile();
  assert.equal(harness.state.markdown, '# Same size');
  assert.equal(harness.state.directoryHandle, null);
  assert.equal(harness.state.fileHandle, selectedRoot.files.get('draft.md'));
  assert.deepEqual(unrelatedRoot.writes, []);
});

test('file input without a handle can still attach by its name and size', async () => {
  const harness = createHarness();
  const folder = memoryRoot('input-root', '# Input file');
  const selectedFile = memoryFile('draft.md', '# Input file');
  harness.directoryPickers.push(folder);
  await harness.api.onFileChosen({ target: { files: [selectedFile], value: 'chosen' } });
  assert.equal(harness.state.directoryHandle, folder);
  assert.equal(harness.state.fileHandle, folder.files.get('draft.md'));
  assert.equal(harness.state.markdown, '# Input file');
});

test('grant with a known file handle cannot fall back to a same-name file', async () => {
  const harness = createHarness();
  await harness.api.restorePersistedDirectoryHandle();
  const originalPath = harness.state.markdownRelativePath;
  harness.directoryPickers.push(memoryRoot('unrelated-root', '# Previous file'));
  await harness.api.grantFolderForCurrentDocument();
  assert.equal(harness.state.markdownRelativePath, originalPath);
  assert.equal(harness.state.directoryHandle, harness.oldRoot);
  assert.equal(harness.state.fileHandle, harness.oldRoot.files.get('draft.md'));
});

test('save writes its captured text and leaves later edits dirty', async () => {
  const harness = createHarness();
  await harness.api.restorePersistedDirectoryHandle();
  const pending = pause();
  harness.oldRoot.files.get('draft.md').writePause = pending;
  edit(harness, '# Before save');
  const completion = harness.api.saveMarkdown();
  await bounded(pending.entered, 'save reached write');
  edit(harness, '# During save');
  pending.release();
  await completion;
  assert.deepEqual(harness.oldRoot.writes, [{ root: 'old-root', path: 'draft.md', text: '# Before save' }]);
  assert.equal(harness.state.markdown, '# During save');
  assert.equal(harness.state.dirty, true);
});

const pendingOperations = {
  async folderScan(harness, pending) {
    const slowRoot = memoryRoot('slow-root', '# Slow folder');
    slowRoot.scanPause = pending;
    harness.directoryPickers.push(slowRoot);
    return { completion: harness.api.openFolder(), slowRoot };
  },
  async fileRead(harness, pending) {
    const slowFile = memoryFile('slow.md', '# Slow file');
    slowFile.readPause = pending;
    return { completion: harness.api.onFileChosen({ target: { files: [slowFile], value: 'chosen' } }) };
  },
  async filePickerRead(harness, pending) {
    const slowRoot = memoryRoot('slow-root', '# Slow picker');
    slowRoot.files.get('draft.md').getFilePause = pending;
    harness.filePickers.push(slowRoot.files.get('draft.md'));
    return { completion: harness.api.openMarkdownFile(), slowRoot };
  },
  async existingFolderAttach(harness, pending) {
    await harness.api.restorePersistedDirectoryHandle();
    harness.oldRoot.scanPause = pending;
    harness.filePickers.push(harness.oldRoot.files.get('draft.md'));
    return { completion: harness.api.openMarkdownFile() };
  },
  async requestedFolderAttach(harness, pending) {
    const slowRoot = memoryRoot('slow-root', '# Selected file');
    slowRoot.scanPause = pending;
    harness.filePickers.push(slowRoot.files.get('draft.md'));
    harness.directoryPickers.push(slowRoot);
    return { completion: harness.api.openMarkdownFile(), slowRoot };
  },
  async grantScan(harness, pending) {
    const slowRoot = memoryRoot('slow-root', '# Grant file');
    slowRoot.scanPause = pending;
    harness.directoryPickers.push(slowRoot);
    return { completion: harness.api.grantFolderForCurrentDocument(), slowRoot };
  },
};

for (const [name, start] of Object.entries(pendingOperations)) {
  test(`a stale ${name} completion cannot replace a newer folder document`, async () => {
    const harness = createHarness();
    const pending = pause();
    const { completion, slowRoot } = await start(harness, pending);
    await bounded(pending.entered, `${name} reached deferred operation`);
    const newRoot = memoryRoot('new-root', '# Latest document');
    await replacements.folder(harness, newRoot);
    const expected = visibleState(harness);
    pending.release();
    await completion;
    assertUnchanged(harness, expected, name);
    await harness.api.saveMarkdown();
    assert.deepEqual(newRoot.writes, [{ root: 'new-root', path: 'draft.md', text: '# Latest document' }]);
    assert.deepEqual(harness.oldRoot.writes, []);
    if (slowRoot) assert.deepEqual(slowRoot.writes, []);
  });
}

test('clearing permissions cannot erase a document opened while deletion was pending', async () => {
  const harness = createHarness();
  await harness.api.restorePersistedDirectoryHandle();
  const pending = pause();
  harness.controls.deletePause = pending;
  const completion = harness.api.clearFolderPermissionRecords();
  await bounded(pending.entered, 'permission deletion');
  await replacements.folder(harness, memoryRoot('new-root', '# Latest document'));
  const expected = visibleState(harness);
  pending.release();
  await completion;
  assertUnchanged(harness, expected, 'permission clear');
});

test('folder persistence completion preserves edits made after the file opened', async () => {
  const harness = createHarness();
  const pending = pause();
  harness.controls.putPause = pending;
  const newRoot = memoryRoot('new-root', '# Opened document');
  harness.directoryPickers.push(newRoot);
  const completion = harness.api.openFolder();
  await bounded(pending.entered, 'folder handle persistence');
  assert.equal(harness.state.directoryHandle, newRoot);
  edit(harness, '# Edited while persisting');
  pending.release();
  await completion;
  assert.equal(harness.state.markdown, '# Edited while persisting');
  assert.equal(harness.els.source.value, '# Edited while persisting');
  assert.equal(harness.state.dirty, true);
});

test('save retains its validated target even when legacy mirror fields change', async () => {
  const harness = createHarness();
  await harness.api.restorePersistedDirectoryHandle();
  const wrongRoot = memoryRoot('wrong-root', '# Wrong file');
  harness.state.directoryHandle = wrongRoot;
  harness.state.markdownRelativePath = 'wrong.md';
  harness.state.fileHandle = wrongRoot.files.get('draft.md');
  edit(harness, '# Intended save');
  await harness.api.saveMarkdown();
  assert.deepEqual(harness.oldRoot.writes, [{ root: 'old-root', path: 'draft.md', text: '# Intended save' }]);
  assert.deepEqual(wrongRoot.writes, []);
});

for (const operation of ['folder', 'grant']) {
  test(`a stale ${operation} persistence callback cannot alter a newer document`, async () => {
    const harness = createHarness();
    const pending = pause();
    harness.controls.putPause = pending;
    harness.directoryPickers.push(memoryRoot('slow-root', '# Earlier document'));
    const completion = operation === 'folder'
      ? harness.api.openFolder()
      : harness.api.grantFolderForCurrentDocument();
    await bounded(pending.entered, `${operation} reached persistence`);
    await replacements.folder(harness, memoryRoot('new-root', '# Newer document'));
    edit(harness, '# Newer unsaved edit');
    const expected = visibleState(harness);
    pending.release();
    await completion;
    assertUnchanged(harness, expected, `${operation} persistence`);
  });
}

test('stale restoration cannot clear a newer scan limit warning', async () => {
  const harness = createHarness();
  const { pending, completion } = await suspendedRestore(harness, 'scan');
  const newRoot = memoryRoot('new-root', '# Latest document');
  for (let index = 0; index < 101; index += 1) {
    newRoot.addFile(memoryFile(`image-${index}.png`, 'image', 'image/png'));
  }
  await replacements.folder(harness, newRoot);
  assert.ok(harness.state.folderScanLimitMessage, 'the newer directory must reach the scan budget');
  const expected = visibleState(harness);
  pending.release();
  assert.equal(await completion, false);
  assertUnchanged(harness, expected, 'scan limit warning');
});

test('an in-progress save cannot clear dirty state or status of a newer document', async () => {
  const harness = createHarness();
  await harness.api.restorePersistedDirectoryHandle();
  const pending = pause();
  harness.oldRoot.files.get('draft.md').writePause = pending;
  edit(harness, '# Earlier save');
  const completion = harness.api.saveMarkdown();
  await bounded(pending.entered, 'save started writing');
  const newRoot = memoryRoot('new-root', '# Latest file');
  await replacements.folder(harness, newRoot);
  edit(harness, '# Latest unsaved edit');
  const expected = visibleState(harness);
  pending.release();
  await completion;
  assertUnchanged(harness, expected, 'old save completion');
  assert.deepEqual(harness.oldRoot.writes, [{ root: 'old-root', path: 'draft.md', text: '# Earlier save' }]);
  assert.deepEqual(newRoot.writes, []);
});

test('a superseded save permission denial cannot download the newer document', async () => {
  const harness = createHarness();
  await harness.api.restorePersistedDirectoryHandle();
  const pending = pause();
  harness.oldRoot.permission = 'denied';
  harness.oldRoot.writePermissionPause = pending;
  const completion = harness.api.saveMarkdown();
  await bounded(pending.entered, 'save permission check');
  const newRoot = memoryRoot('new-root', '# Latest file');
  await replacements.folder(harness, newRoot);
  edit(harness, '# Latest unsaved edit');
  const expected = visibleState(harness);
  pending.release();
  await completion;
  assertUnchanged(harness, expected, 'save permission denial');
  assert.deepEqual(harness.effects.downloads, []);
  assert.deepEqual(harness.oldRoot.writes, []);
  assert.deepEqual(newRoot.writes, []);
});

function lastPersistedDraft(harness) {
  const draft = harness.effects.draftSnapshots.at(-1);
  assert.ok(draft, 'the operation must persist a draft snapshot');
  return draft;
}

async function assertReloadRefuses(harness, label) {
  const markdown = harness.state.markdown;
  assert.equal(await harness.api.restorePersistedDirectoryHandle(), false, label);
  assert.equal(harness.state.directoryHandle, null, `${label}: directory must remain unattached`);
  assert.equal(harness.state.fileHandle, null, `${label}: file must remain unattached`);
  assert.equal(harness.state.markdown, markdown, `${label}: draft text must be retained`);
  await harness.api.saveMarkdown();
  assert.deepEqual(harness.oldRoot.writes, [], `${label}: rejected binding must not write to the old directory`);
}

test('a completed folder open persists the same binding identity in the record and draft', async () => {
  const harness = createHarness();
  const newRoot = memoryRoot('new-root', '# New persisted file');
  await replacements.folder(harness, newRoot);
  const savedRecord = harness.persisted.get(DIRECTORY_KEY);
  const savedDraft = lastPersistedDraft(harness);
  assert.equal(savedRecord.version, 1);
  assert.equal(typeof savedRecord.bindingId, 'string');
  assert.ok(savedRecord.bindingId);
  assert.notEqual(savedRecord.bindingId, INITIAL_BINDING_ID, 'opening another document needs a new durable identity');
  assert.equal(savedRecord.bindingId, harness.state.documentBinding.bindingId);
  assert.equal(savedDraft.bindingId, savedRecord.bindingId);
  assert.equal(savedDraft.markdownRelativePath, savedRecord.markdownRelativePath);
  assert.equal(savedRecord.directoryHandle, newRoot);
  assert.equal(savedRecord.fileHandle, newRoot.files.get('draft.md'));
  assert.equal(savedRecord.fileName, 'draft.md');
  const reloaded = createHarness({ oldRoot: newRoot, persistedRecord: savedRecord, draft: savedDraft });
  assert.equal(await reloaded.api.restorePersistedDirectoryHandle(), true);
  assert.equal(reloaded.state.directoryHandle, newRoot);
  assert.equal(reloaded.state.fileHandle, newRoot.files.get('draft.md'));
  assert.equal(reloaded.state.documentBinding.bindingId, savedDraft.bindingId);
  assert.equal(reloaded.state.markdown, '# New persisted file');
});

test('restart during an IndexedDB open pause rejects the old root with the new draft', async () => {
  const harness = createHarness();
  const oldRecord = harness.persisted.get(DIRECTORY_KEY);
  const newRoot = memoryRoot('new-root', '# New draft before IDB commit');
  const pending = pause();
  harness.controls.openPause = pending;
  harness.directoryPickers.push(newRoot);
  const completion = harness.api.openFolder();
  await bounded(pending.entered, 'opening IndexedDB for the new binding');
  const savedDraft = lastPersistedDraft(harness);
  assert.equal(savedDraft.markdown, '# New draft before IDB commit');
  assert.notEqual(savedDraft.bindingId, oldRecord.bindingId);
  assert.equal(harness.persisted.get(DIRECTORY_KEY), oldRecord, 'the old record remains until the new transaction starts');
  const reloaded = createHarness({ oldRoot: harness.oldRoot, persistedRecord: oldRecord, draft: savedDraft });
  await assertReloadRefuses(reloaded, 'old root plus newer draft');
  assert.deepEqual(newRoot.writes, []);
  pending.release();
  await completion;
});

for (const failure of ['openFailure', 'putFailure']) {
  test(`restart after ${failure} cannot pair the new draft with the old persisted root`, async () => {
    const harness = createHarness();
    const oldRecord = harness.persisted.get(DIRECTORY_KEY);
    const newRoot = memoryRoot('new-root', '# New draft after storage failure');
    harness.controls[failure] = namedError('UnknownError');
    await replacements.folder(harness, newRoot);
    const savedDraft = lastPersistedDraft(harness);
    assert.notEqual(savedDraft.bindingId, oldRecord.bindingId);
    assert.equal(harness.persisted.get(DIRECTORY_KEY), oldRecord);
    const reloaded = createHarness({ oldRoot: harness.oldRoot, persistedRecord: oldRecord, draft: savedDraft });
    await assertReloadRefuses(reloaded, failure);
    assert.deepEqual(newRoot.writes, []);
  });
}

test('restart with an older draft and a newer record cannot attach the newer file', async () => {
  const harness = createHarness();
  const oldDraft = {
    markdown: '# Older unsaved draft', fileName: 'draft.md', markdownRelativePath: 'draft.md',
    bindingId: INITIAL_BINDING_ID, dirty: true,
  };
  const newRoot = memoryRoot('new-root', '# New persisted file');
  await replacements.folder(harness, newRoot);
  const newRecord = harness.persisted.get(DIRECTORY_KEY);
  assert.notEqual(newRecord.bindingId, oldDraft.bindingId);
  const reloaded = createHarness({ oldRoot: harness.oldRoot, persistedRecord: newRecord, draft: oldDraft });
  await assertReloadRefuses(reloaded, 'new record plus older draft');
  assert.deepEqual(newRoot.writes, []);
});

test('matching binding IDs cannot restore different recorded and draft paths', async () => {
  const oldRoot = memoryRoot('old-root');
  oldRoot.addFile(memoryFile('other.md', '# Other existing file'));
  const harness = createHarness({ oldRoot, draft: { markdownRelativePath: 'other.md', fileName: 'other.md' } });
  await assertReloadRefuses(harness, 'path mismatch despite matching binding ID');
});

test('a legacy raw directory record cannot automatically attach a draft', async () => {
  const oldRoot = memoryRoot('legacy-root');
  const harness = createHarness({ oldRoot, persistedRecord: oldRoot });
  await assertReloadRefuses(harness, 'legacy raw directory record');
});

test('a draft without a binding ID cannot automatically attach a saved record', async () => {
  const harness = createHarness({ draftBindingId: '' });
  await assertReloadRefuses(harness, 'draft without binding ID');
});

test('an explicit file open can reuse a legacy directory after validating the selected file', async () => {
  const oldRoot = memoryRoot('legacy-root', '# Explicitly selected file');
  const harness = createHarness({ oldRoot, persistedRecord: oldRoot, draftBindingId: '' });
  assert.equal(await harness.api.restorePersistedDirectoryHandle(), false);
  harness.filePickers.push(oldRoot.files.get('draft.md'));
  await harness.api.openMarkdownFile();
  assert.equal(harness.state.directoryHandle, oldRoot);
  assert.equal(harness.state.fileHandle, oldRoot.files.get('draft.md'));
  assert.equal(harness.state.markdown, '# Explicitly selected file');
  const record = harness.persisted.get(DIRECTORY_KEY);
  assert.equal(record.version, 1);
  assert.ok(record.bindingId);
  assert.equal(lastPersistedDraft(harness).bindingId, record.bindingId);
});

test('a same-path replacement cannot impersonate the file from the persisted binding', async () => {
  const oldRoot = memoryRoot('old-root', '# Originally bound file');
  const persistedRecord = bindingRecord(oldRoot);
  const originalHandle = persistedRecord.fileHandle;
  const replacement = oldRoot.addFile(memoryFile('draft.md', '# Replaced file'));
  assert.notEqual(replacement, originalHandle);
  const harness = createHarness({ oldRoot, persistedRecord });
  await assertReloadRefuses(harness, 'same path with a different file identity');
});

test('restoration cannot attach if the saved file identity is unavailable', async () => {
  const oldRoot = memoryRoot('old-root');
  const record = bindingRecord(oldRoot);
  delete record.fileHandle;
  const harness = createHarness({ oldRoot, persistedRecord: record });
  await assertReloadRefuses(harness, 'missing persisted file identity');
});

test('a document switch during restore identity verification invalidates the old binding', async () => {
  const harness = createHarness();
  const pending = pause();
  harness.oldRoot.files.get('draft.md').identityPause = pending;
  const completion = harness.api.restorePersistedDirectoryHandle();
  await bounded(pending.entered, 'restoration file identity verification');
  const newRoot = memoryRoot('new-root', '# Newer selected document');
  await replacements.folder(harness, newRoot);
  const expected = visibleState(harness);
  pending.release();
  assert.equal(await completion, false);
  assertUnchanged(harness, expected, 'restore file identity verification');
  await harness.api.saveMarkdown();
  assert.deepEqual(newRoot.writes, [{ root: 'new-root', path: 'draft.md', text: '# Newer selected document' }]);
  assert.deepEqual(harness.oldRoot.writes, []);
});

function emptyRoot(name) {
  const root = memoryRoot(name, null);
  root.files.clear();
  return root;
}

function streamRoot(name, entryAt) {
  const root = emptyRoot(name);
  const calls = { next: 0, returned: 0 };
  root.entries = () => {
    let index = 0;
    return {
      async next() {
        calls.next += 1;
        const value = await entryAt(index++);
        if (value === null) return { done: true };
        calls.returned += 1;
        return { value, done: false };
      },
      [Symbol.asyncIterator]() { return this; },
    };
  };
  return { root, calls };
}

async function openRoot(harness, root) {
  harness.directoryPickers.push(root);
  await harness.api.openFolder();
}

function assertScanWarning(harness) {
  assert.ok(harness.state.folderScanLimitMessage, 'the scan limit must remain visible in state');
  assert.ok(harness.effects.warnings.some((message) => typeof message === 'string'
    && message.includes(harness.state.folderScanLimitMessage)), 'a limited scan must show its warning');
  assert.equal(harness.els.folderScanCancel.hidden, true, 'the cancel control must be hidden after completion');
}

function folderInputFile(name, text, relativePath, type = 'text/markdown') {
  return Object.assign(memoryFile(name, text, type), { webkitRelativePath: relativePath });
}

function indexedFiles(length, fileAt) {
  const reads = [];
  const files = new Proxy({ length }, {
    get(target, key) {
      if (key === Symbol.iterator) throw new Error('folder input must not materialize or iterate the whole FileList');
      if (typeof key === 'string' && /^\d+$/.test(key)) {
        const index = Number(key);
        reads.push(index);
        return fileAt(index);
      }
      return Reflect.get(target, key);
    },
  });
  return { files, reads };
}

test('empty directory entries consume the traversal budget even without candidate files', async () => {
  const harness = createHarness({ scanLimits: { MAX_FOLDER_SCAN_ENTRIES: 3 } });
  const empty = emptyRoot('empty');
  const { root, calls } = streamRoot('directory-storm', (index) => index < 20 ? [`empty-${index}`, empty] : null);
  await openRoot(harness, root);
  assert.equal(calls.returned, 3);
  assert.equal(calls.next, 3, 'the iterator must not be advanced beyond the entry budget');
  assert.equal(harness.state.markdown, '# Restored draft');
  assert.equal(harness.state.directoryHandle, null);
  assertScanWarning(harness);
});

test('unrelated file entries are counted without obtaining their File objects', async () => {
  const harness = createHarness({ scanLimits: { MAX_FOLDER_SCAN_ENTRIES: 4, MAX_FOLDER_SCAN_FILES: 100 } });
  let fileReads = 0;
  const { root, calls } = streamRoot('unrelated-storm', (index) => index < 20 ? [`archive-${index}.zip`, {
    kind: 'file', name: `archive-${index}.zip`,
    async getFile() { fileReads += 1; throw new Error('unrelated file metadata must not be read'); },
  }] : null);
  await openRoot(harness, root);
  assert.equal(calls.returned, 4);
  assert.equal(calls.next, 4);
  assert.equal(fileReads, 0);
  assert.equal(harness.state.markdown, '# Restored draft');
  assertScanWarning(harness);
});

test('the file count budget includes ignored file handles before getFile', async () => {
  const harness = createHarness({ scanLimits: { MAX_FOLDER_SCAN_FILES: 2 } });
  const root = emptyRoot('file-budget');
  const ignored = root.addFile(memoryFile('archive.zip', 'ignored', 'application/zip'));
  const included = root.addFile(memoryFile('draft.md', '# Within count'));
  const excluded = root.addFile(memoryFile('later.png', 'later', 'image/png'));
  await openRoot(harness, root);
  assert.equal(ignored.getFileCalls, 0);
  assert.equal(included.getFileCalls, 1);
  assert.equal(excluded.getFileCalls, 0);
  assert.equal(harness.state.markdown, '# Within count');
  assert.equal(harness.state.assetUrls.size, 0);
  assertScanWarning(harness);
});

test('normal Markdown and image candidates retain extension and extensionless MIME compatibility', async () => {
  const harness = createHarness();
  const root = emptyRoot('candidate-types');
  const markdown = root.addFile(memoryFile('README', '# Extensionless document', 'text/plain'));
  const raster = root.addFile(memoryFile('photo.PNG', 'image', 'application/octet-stream'));
  const mimeImage = root.addFile(memoryFile('picture', 'image', 'image/png'));
  const unrelated = root.addFile(memoryFile('database.sqlite', 'ignored', 'text/plain'));
  await openRoot(harness, root);
  assert.equal(markdown.getFileCalls, 1);
  assert.equal(raster.getFileCalls, 1);
  assert.equal(mimeImage.getFileCalls, 1);
  assert.equal(unrelated.getFileCalls, 0);
  assert.equal(harness.state.markdown, '# Extensionless document');
  assert.ok(harness.state.imageAssetFiles.has('photo.PNG'));
  assert.ok(harness.state.imageAssetFiles.has('picture'));
  assert.equal(harness.state.folderScanLimitMessage, '');
  assert.equal(harness.els.folderScanCancel.hidden, true);
});

test('per-file size limits exclude large Markdown and images before content or object URL use', async () => {
  const harness = createHarness({ scanLimits: { MAX_ASSET_IMAGE_BYTES: 16 } });
  const root = emptyRoot('oversized-files');
  const largeDocument = Object.assign(memoryFile('large.md', '# Must not open'), { size: 10 * 1024 * 1024 + 1 });
  const largeImage = Object.assign(memoryFile('large.png', 'not loaded', 'image/png'), { size: 17 });
  root.addFile(largeDocument);
  root.addFile(largeImage);
  root.addFile(memoryFile('draft.md', '# Small document'));
  root.addFile(memoryFile('small.png', 'small', 'image/png'));
  await openRoot(harness, root);
  assert.equal(largeDocument.readCalls, 0);
  assert.equal(largeImage.readCalls, 0);
  assert.equal(harness.state.markdown, '# Small document');
  assert.ok(harness.state.imageAssetFiles.has('small.png'));
  assert.equal(harness.state.imageAssetFiles.has('large.png'), false);
  assertScanWarning(harness);
});

test('the cumulative candidate byte budget retains only the prefix that fits', async () => {
  const harness = createHarness({ scanLimits: { MAX_FOLDER_SCAN_BYTES: 8 } });
  const root = emptyRoot('aggregate-bytes');
  root.addFile(memoryFile('draft.md', 'x'));
  const accepted = root.addFile(memoryFile('first.png', '1234', 'image/png'));
  const overflow = root.addFile(memoryFile('second.png', '5678', 'image/png'));
  const untouched = root.addFile(memoryFile('third.png', '9', 'image/png'));
  await openRoot(harness, root);
  assert.equal(harness.state.markdown, 'x');
  assert.equal(accepted.getFileCalls, 1);
  assert.equal(overflow.getFileCalls, 1);
  assert.equal(untouched.getFileCalls, 0);
  assert.ok(harness.state.imageAssetFiles.has('first.png'));
  assert.equal(harness.state.imageAssetFiles.has('second.png'), false);
  assertScanWarning(harness);
});

test('visited raw paths consume a UTF-16 byte budget before file metadata is read', async () => {
  const harness = createHarness({ scanLimits: { MAX_FOLDER_SCAN_PATH_BYTES: 19 } });
  const root = emptyRoot('path-budget');
  root.addFile(memoryFile('a.md', '# Path budget'));
  const overflow = root.addFile(memoryFile('🙂.png', 'image', 'image/png'));
  const untouched = root.addFile(memoryFile('b.png', 'image', 'image/png'));
  await openRoot(harness, root);
  assert.equal(harness.state.markdown, '# Path budget');
  assert.equal(overflow.getFileCalls, 0, '8 + 12 UTF-16 path bytes exceed the 19-byte budget');
  assert.equal(untouched.getFileCalls, 0);
  assert.equal(harness.state.assetUrls.size, 0);
  assertScanWarning(harness);
});

test('paths of ignored entries still consume the shared path budget', async () => {
  const harness = createHarness({ scanLimits: { MAX_FOLDER_SCAN_PATH_BYTES: 20 } });
  const root = emptyRoot('ignored-path-budget');
  root.addFile(memoryFile('a.md', '# First file'));
  const ignored = root.addFile(memoryFile('very-long-archive.zip', 'ignored', 'application/zip'));
  const untouched = root.addFile(memoryFile('b.png', 'image', 'image/png'));
  await openRoot(harness, root);
  assert.equal(harness.state.markdown, '# First file');
  assert.equal(ignored.getFileCalls, 0);
  assert.equal(untouched.getFileCalls, 0);
  assertScanWarning(harness);
});

function pendingScanRoot(stage, pending) {
  const root = emptyRoot(`pending-${stage}`);
  const documentHandle = root.addFile(memoryFile('draft.md', '# Partial scan document'));
  const imageHandle = root.addFile(memoryFile('pending.png', 'image', 'image/png'));
  const untouched = root.addFile(memoryFile('later.png', 'image', 'image/png'));
  if (stage === 'next') {
    root.entries = async function* entries() {
      yield ['draft.md', documentHandle];
      await pending.wait();
      yield ['pending.png', imageHandle];
      yield ['later.png', untouched];
    };
  } else {
    imageHandle.getFilePause = pending;
  }
  return { root, documentHandle, imageHandle, untouched };
}

for (const stage of ['next', 'getFile']) {
  test(`the time limit releases a stalled ${stage} and preserves already collected candidates`, async () => {
    const harness = createHarness({ scanLimits: { MAX_FOLDER_SCAN_MS: 30 } });
    const pending = pause();
    const { root, imageHandle, untouched } = pendingScanRoot(stage, pending);
    const completion = openRoot(harness, root);
    await bounded(pending.entered, `time-limited ${stage} entered`);
    assert.equal(harness.els.folderScanCancel.hidden, false);
    await bounded(completion, `time-limited ${stage} returns without releasing I/O`);
    assert.equal(harness.state.markdown, '# Partial scan document');
    assert.equal(harness.state.assetUrls.size, 0);
    assertScanWarning(harness);
    assert.equal(imageHandle.getFileCalls, stage === 'getFile' ? 1 : 0);
    assert.equal(untouched.getFileCalls, 0);
    const expected = visibleState(harness);
    pending.release();
    await new Promise((resolve) => setImmediate(resolve));
    assertUnchanged(harness, expected, `late ${stage} after timeout`);
    assert.equal(untouched.getFileCalls, 0);
  });

  for (const cancellation of ['user', 'generation']) {
    test(`${cancellation} cancellation releases a stalled ${stage} and stops subsequent I/O`, async () => {
      const harness = createHarness();
      const pending = pause();
      const { root, documentHandle, imageHandle, untouched } = pendingScanRoot(stage, pending);
      const completion = openRoot(harness, root);
      await bounded(pending.entered, `cancelled ${stage} entered`);
      assert.equal(harness.els.folderScanCancel.hidden, false);
      if (cancellation === 'user') harness.api.cancelFolderScan();
      else bindNewDocument(harness);
      await bounded(completion, `${cancellation} cancellation must not await stalled ${stage}`);
      assert.equal(harness.state.markdown, cancellation === 'user' ? '# Restored draft' : '# New unsaved document');
      assert.equal(harness.state.directoryHandle, null);
      assert.equal(documentHandle.file.readCalls, 0, 'partial candidates must not replace the document after cancellation');
      assert.equal(harness.els.folderScanCancel.hidden, true);
      assert.equal(imageHandle.getFileCalls, stage === 'getFile' ? 1 : 0);
      assert.equal(untouched.getFileCalls, 0);
      const expected = visibleState(harness);
      if (cancellation === 'generation') pending.reject(namedError('NotReadableError'));
      else pending.release();
      await new Promise((resolve) => setImmediate(resolve));
      assertUnchanged(harness, expected, `${cancellation} late ${stage}`);
      assert.equal(untouched.getFileCalls, 0);
    });
  }
}

test('a scan deadline also warns when no candidates have been collected', async () => {
  const harness = createHarness({ scanLimits: { MAX_FOLDER_SCAN_MS: 30 } });
  const root = emptyRoot('empty-timeout');
  const pending = pause();
  root.scanPause = pending;
  const completion = openRoot(harness, root);
  await bounded(pending.entered, 'empty scan started');
  await bounded(completion, 'empty stalled scan returns at deadline');
  assert.equal(harness.state.markdown, '# Restored draft');
  assertScanWarning(harness);
  pending.release();
});

test('folder input reads only a bounded FileList prefix without copying or iteration', async () => {
  const harness = createHarness({ scanLimits: { MAX_FOLDER_SCAN_ENTRIES: 4 } });
  const { files, reads } = indexedFiles(1000000000, (index) => {
    assert.ok(index < 8, 'the mock stops runaway reads if the scan budget regresses');
    return index === 0
      ? folderInputFile('draft.md', '# Bounded input', 'selected/draft.md')
      : folderInputFile(`${index}.zip`, 'ignored', `selected/${index}.zip`, 'application/zip');
  });
  const target = { files, value: 'selected' };
  await harness.api.onFolderChosen({ target });
  assert.deepEqual(reads, [0, 1, 2, 3]);
  assert.equal(harness.state.markdown, '# Bounded input');
  assert.equal(target.value, '');
  assertScanWarning(harness);
});

for (const cancellation of ['user', 'generation']) {
  test(`folder input yields between batches so ${cancellation} cancellation stops index reads`, async () => {
    const harness = createHarness({ scanLimits: { MAX_FOLDER_SCAN_FILES: 5000 } });
    const length = 2000;
    let readsAtCancellation = null;
    const cancellationRan = deferred();
    const { files, reads } = indexedFiles(length, (index) => {
      if (index === 0) {
        setTimeout(() => {
          readsAtCancellation = reads.length;
          assert.equal(harness.els.folderScanCancel.hidden, false);
          if (cancellation === 'user') harness.api.cancelFolderScan();
          else bindNewDocument(harness);
          cancellationRan.resolve();
        }, 0);
      }
      return folderInputFile(`${index}.png`, 'image', `selected/${index}.png`, 'image/png');
    });
    const target = { files, value: 'selected' };
    const completion = harness.api.onFolderChosen({ target });
    await cancellationRan.promise;
    await completion;
    assert.ok(readsAtCancellation > 0 && readsAtCancellation < length, 'the main event loop must run before the whole input is consumed');
    assert.equal(reads.length, readsAtCancellation, 'no FileList access may follow cancellation');
    assert.equal(harness.state.markdown, cancellation === 'user' ? '# Restored draft' : '# New unsaved document');
    assert.equal(harness.state.assetUrls.size, 0);
    assert.equal(target.value, '');
    assert.equal(harness.els.folderScanCancel.hidden, true);
  });
}

test('folder input is reset even when reading a FileList entry fails', async () => {
  const harness = createHarness();
  const { files } = indexedFiles(1, () => { throw namedError('NotReadableError'); });
  const target = { files, value: 'selected' };
  await Promise.resolve(harness.api.onFolderChosen({ target })).catch(() => {});
  assert.equal(target.value, '');
  assert.equal(harness.els.folderScanCancel.hidden, true);
  assert.equal(harness.state.markdown, '# Restored draft');
});

for (const route of ['directory', 'input']) {
  test(`${route} scan treats files immediately below the selected root as depth zero`, async () => {
    const harness = createHarness({ scanLimits: { MAX_FOLDER_SCAN_DEPTH: 0 } });
    if (route === 'directory') {
      const root = emptyRoot('selected');
      const child = emptyRoot('child');
      child.addFile(memoryFile('deep.md', '# Too deep'));
      root.directories.set('child', child);
      root.addFile(memoryFile('draft.md', '# Root document'));
      root.addFile(memoryFile('root.png', 'image', 'image/png'));
      await openRoot(harness, root);
      assert.equal(child.files.get('deep.md').getFileCalls, 0);
    } else {
      const target = { value: 'selected', files: [
        folderInputFile('deep.md', '# Too deep', 'selected/child/deep.md'),
        folderInputFile('draft.md', '# Root document', 'selected/draft.md'),
        folderInputFile('root.png', 'image', 'selected/root.png', 'image/png'),
      ] };
      await harness.api.onFolderChosen({ target });
      assert.equal(target.value, '');
    }
    assert.equal(harness.state.markdown, '# Root document');
    assert.ok(harness.state.imageAssetFiles.has('root.png'));
    assertScanWarning(harness);
  });
}

test('folder input applies cumulative size limits before building image URLs', async () => {
  const harness = createHarness({ scanLimits: { MAX_FOLDER_SCAN_BYTES: 8 } });
  const { files, reads } = indexedFiles(4, (index) => [
    folderInputFile('draft.md', 'x', 'selected/draft.md'),
    folderInputFile('first.png', '1234', 'selected/first.png', 'image/png'),
    folderInputFile('second.png', '5678', 'selected/second.png', 'image/png'),
    folderInputFile('later.png', 'x', 'selected/later.png', 'image/png'),
  ][index]);
  const target = { files, value: 'selected' };
  await harness.api.onFolderChosen({ target });
  assert.deepEqual(reads, [0, 1, 2]);
  assert.equal(harness.state.markdown, 'x');
  assert.ok(harness.state.imageAssetFiles.has('first.png'));
  assert.equal(harness.state.imageAssetFiles.has('second.png'), false);
  assert.equal(target.value, '');
  assertScanWarning(harness);
});

test('folder input includes raw root paths in its cumulative path budget', async () => {
  const firstPath = 'selected/a.md';
  const secondPath = 'selected/🙂.png';
  const harness = createHarness({ scanLimits: {
    MAX_FOLDER_SCAN_PATH_BYTES: (firstPath.length + secondPath.length) * 2 - 1,
  } });
  const { files, reads } = indexedFiles(3, (index) => [
    folderInputFile('a.md', '# Raw paths', firstPath),
    folderInputFile('🙂.png', 'image', secondPath, 'image/png'),
    folderInputFile('later.png', 'image', 'selected/later.png', 'image/png'),
  ][index]);
  const target = { files, value: 'selected' };
  await harness.api.onFolderChosen({ target });
  assert.deepEqual(reads, [0, 1]);
  assert.equal(harness.state.markdown, '# Raw paths');
  assert.equal(harness.state.assetUrls.size, 0);
  assert.equal(target.value, '');
  assertScanWarning(harness);
});

test('directory paths and their descendants share one cumulative path budget', async () => {
  const harness = createHarness({ scanLimits: { MAX_FOLDER_SCAN_PATH_BYTES: 23 } });
  const root = emptyRoot('nested-paths');
  const child = emptyRoot('sub');
  const childFile = child.addFile(memoryFile('a.md', '# Exceeds shared path budget'));
  root.directories.set('sub', child);
  const rootFile = root.addFile(memoryFile('later.md', '# Must not read'));
  // "sub" consumes 6 bytes; "sub/a.md" consumes another 16 bytes.
  const otherChildFile = child.addFile(memoryFile('b.png', 'image', 'image/png'));
  await openRoot(harness, root);
  assert.equal(harness.state.markdown, '# Exceeds shared path budget');
  assert.equal(childFile.getFileCalls, 1);
  assert.equal(otherChildFile.getFileCalls, 0);
  assert.equal(rootFile.getFileCalls, 0);
  assertScanWarning(harness);
});

test('cancelling a scan retains an established binding and its image URLs', async () => {
  const harness = createHarness();
  await harness.api.restorePersistedDirectoryHandle();
  await loadedImage(harness, 'old-root.png');
  const before = visibleState(harness);
  const pending = pause();
  const { root, documentHandle } = pendingScanRoot('getFile', pending);
  const completion = openRoot(harness, root);
  await bounded(pending.entered, 'replacement scan pending');
  harness.api.cancelFolderScan();
  await bounded(completion, 'cancel preserves established document');
  assert.equal(harness.state.directoryHandle, before.root);
  assert.equal(harness.state.fileHandle, before.file);
  assert.equal(harness.state.markdown, before.markdown);
  assert.equal(harness.els.source.value, before.source);
  assert.equal(harness.state.markdownRelativePath, before.relativePath);
  assert.equal(harness.state.documentBinding.bindingId, before.binding.bindingId);
  assert.equal(harness.state.dirty, before.dirty);
  assert.deepEqual([...harness.state.assetUrls], before.assets);
  assert.deepEqual(harness.effects.revokedUrls, before.revokedUrls);
  assert.equal(documentHandle.file.readCalls, 0);
  assert.equal(harness.els.folderScanCancel.hidden, true);
  pending.release();
});

test('completion of a superseded scan cannot hide the cancel control for a newer scan', async () => {
  const harness = createHarness();
  const firstPending = pause();
  const first = pendingScanRoot('next', firstPending);
  const firstCompletion = openRoot(harness, first.root);
  await bounded(firstPending.entered, 'first scan pending');
  const secondPending = pause();
  const second = pendingScanRoot('getFile', secondPending);
  const secondCompletion = openRoot(harness, second.root);
  await bounded(secondPending.entered, 'second scan pending');
  await bounded(firstCompletion, 'superseded scan returns without its pending I/O');
  assert.equal(harness.els.folderScanCancel.hidden, false);
  harness.api.cancelFolderScan();
  await bounded(secondCompletion, 'newer scan cancellation');
  assert.equal(harness.els.folderScanCancel.hidden, true);
  assert.equal(harness.state.markdown, '# Restored draft');
  firstPending.release();
  secondPending.release();
});

test('directory values iterators preserve normal Markdown and image loading', async () => {
  const harness = createHarness();
  const root = memoryRoot('values-root', '# Values iterator');
  delete root.entries;
  root.values = async function* values() { yield* root.files.values(); };
  await openRoot(harness, root);
  assert.equal(harness.state.markdown, '# Values iterator');
  assert.equal(harness.state.directoryHandle, root);
  assert.ok(harness.state.imageAssetFiles.has('values-root.png'));
  assert.equal(harness.state.folderScanLimitMessage, '');
  assert.equal(harness.els.folderScanCancel.hidden, true);
});

test('a folder containing only unsupported files explains the missing Markdown for open and grant', async () => {
  for (const action of ['openFolder', 'grantFolderForCurrentDocument']) {
    const harness = createHarness();
    const root = emptyRoot('unsupported');
    const ignored = root.addFile(memoryFile('archive.zip', 'zip', 'application/zip'));
    harness.directoryPickers.push(root);
    await harness.api[action]();
    assert.equal(ignored.getFileCalls, 0);
    assert.ok(harness.effects.statuses.some((message) => action === 'openFolder'
      ? message.includes('フォルダ内にMarkdownファイルがありません')
      : message.includes('が選択フォルダ内に見つかりませんでした')));
    assert.equal(harness.state.markdown, '# Restored draft');
    assert.equal(harness.state.directoryHandle, null);
  }
});

async function until(predicate, label) {
  await bounded((async () => {
    while (!predicate()) await new Promise((resolve) => setTimeout(resolve, 1));
  })(), label);
}

async function loadedImage(harness, key, nativeUrl = '') {
  let url = '';
  await until(() => (url = harness.api.resolveImageAssetUrl(key, nativeUrl)), `validated image ${key}`);
  // Settle the scheduled refresh before callers snapshot the current UI state.
  await new Promise((resolve) => setTimeout(resolve, 2));
  return url;
}

async function rejectedImage(harness, key, reason, nativeUrl = '') {
  assert.equal(harness.api.resolveImageAssetUrl(key, nativeUrl), '');
  const recordKey = nativeUrl ? `native:${nativeUrl}` : key;
  await until(() => reason.test(harness.api.imageAssetReason(recordKey)), `rejected image ${key}`);
  assert.equal(harness.api.resolveImageAssetUrl(key, nativeUrl), '');
}

function imageEntries(harness, files) {
  harness.api.buildFolderAssetUrls(files.map((file) => ({ file, relativePath: file.name })), '');
}

function nativeImageResponse(chunks, mimeType = 'image/png') {
  const calls = { reads: 0, cancels: 0 };
  let offset = 0;
  return {
    calls,
    response: {
      ok: true,
      headers: { get: (key) => key.toLowerCase() === 'content-type' ? mimeType : null },
      body: { getReader: () => ({
        async read() {
          calls.reads += 1;
          return offset < chunks.length ? { value: chunks[offset++], done: false } : { done: true };
        },
        async cancel() { calls.cancels += 1; },
      }) },
    },
  };
}

test('folder discovery never reads image bytes or creates URLs until an image is referenced', async () => {
  const harness = createHarness();
  const root = memoryRoot('lazy-folder', '# No image reference');
  const image = root.files.get('lazy-folder.png').file;
  await openRoot(harness, root);
  assert.equal(harness.state.imageAssetFiles.get(image.name), image);
  assert.equal(image.readCalls, 0);
  assert.equal(harness.effects.createdUrls.length, 0);
  assert.equal(harness.state.assetUrls.size, 0);
  assert.equal(harness.api.resolveImageAssetUrl(image.name), '');
  await until(() => harness.effects.imageRenders > 0, 'image validation refresh');
  assert.equal(image.readCalls, 1);
  assert.equal(harness.effects.createdUrls.length, 0, 'validation alone must not create an object URL');
  const url = harness.api.resolveImageAssetUrl(image.name);
  assert.ok(url.startsWith('blob:memory-'));
  assert.equal(harness.effects.createdUrls.length, 1);
  const info = harness.api.getImageInfo(url);
  assert.equal(info.mimeType, 'image/png');
  assert.equal(info.width, 1);
  assert.equal(info.height, 1);
  assert.equal(info.frames, 1);
  assert.equal(info.pixels, 1);
  assert.equal(info.size, PNG_BYTES.length);
  const blob = harness.effects.createdUrls[0].blob;
  assert.equal(blob.type, 'image/png');
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), PNG_BYTES);
});

test('relative aliases and repeated references share one validation and one owned URL', async () => {
  const harness = createHarness();
  const file = memoryImage();
  imageEntries(harness, [file]);
  harness.state.imageAssetFiles.set('alias.png', file);
  for (let index = 0; index < 100; index += 1) {
    assert.equal(harness.api.resolveImageAssetUrl(index % 2 ? './picture.png' : 'alias.png'), '');
  }
  const url = await loadedImage(harness, 'picture.png');
  assert.equal(harness.api.resolveImageAssetUrl('./picture.png'), url);
  assert.equal(harness.api.resolveImageAssetUrl('alias.png'), url);
  assert.equal(harness.api.resolveImageAssetUrl(url), url);
  assert.equal(file.readCalls, 1);
  assert.equal(harness.effects.createdUrls.length, 1);
  assert.equal(harness.state.assetUrls.get('./picture.png'), url);
  assert.equal(harness.api.resolveImageAssetUrl('blob:unowned'), '');
  assert.equal(harness.api.getImageInfo('blob:unowned'), null);
});

for (const [name, file, reason] of [
  ['SVG bytes named PNG', memoryFile('fake.png', '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>', 'image/png'), /PNG、JPEG/],
  ['truncated PNG', memoryImage('short.png', PNG_BYTES.slice(0, 30)), /途中で切れ/],
  ['MIME mismatch', memoryImage('wrong.png', PNG_BYTES, 'image/jpeg'), /MIME 型/],
  ['extension mismatch', memoryImage('wrong.jpg'), /拡張子/],
  ['huge dimension in a small payload', memoryImage('huge.png', pngWithDimensions(8193, 1)), /幅または高さ/],
  ['per-image decoded pixel overflow', memoryImage('pixels.png', pngWithDimensions(4097, 4096)), /展開後の画素数/],
]) {
  test(`${name} is rejected before URL creation and is not retried`, async () => {
    const harness = createHarness();
    imageEntries(harness, [file]);
    await rejectedImage(harness, file.name, reason);
    for (let index = 0; index < 5; index += 1) assert.equal(harness.api.resolveImageAssetUrl(file.name), '');
    assert.equal(file.readCalls, 1);
    assert.equal(harness.effects.createdUrls.length, 0);
    assert.equal(harness.state.assetUrls.size, 0);
  });
}

test('an animated GIF over the frame limit is rejected before URL creation', async () => {
  const header = Uint8Array.from(Buffer.from('GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff', 'binary'));
  const frame = Uint8Array.from([0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 1, 0x4c, 0]);
  const bytes = Uint8Array.from([...header, ...Array.from({ length: 61 }, () => [...frame]).flat(), 0x3b]);
  const harness = createHarness();
  const file = memoryImage('animation.gif', bytes, 'image/gif');
  imageEntries(harness, [file]);
  await rejectedImage(harness, file.name, /フレーム数/);
  assert.equal(harness.effects.createdUrls.length, 0);
});

for (const [name, type] of [['photo.PNG', 'application/octet-stream'], ['picture', 'image/png'], ['empty-mime.png', '']]) {
  test(`valid PNG bytes with ${name} and ${type || 'empty MIME'} are accepted canonically`, async () => {
    const harness = createHarness();
    const file = memoryImage(name, PNG_BYTES, type);
    imageEntries(harness, [file]);
    const url = await loadedImage(harness, name);
    assert.equal(harness.api.getImageInfo(url).mimeType, 'image/png');
    assert.equal(harness.effects.createdUrls[0].blob.type, 'image/png');
  });
}

test('queued validations read one image at a time', async () => {
  const harness = createHarness();
  const first = memoryImage('first.png');
  const second = memoryImage('second.png');
  const pending = pause();
  first.readPause = pending;
  imageEntries(harness, [first, second]);
  harness.api.resolveImageAssetUrl(first.name);
  harness.api.resolveImageAssetUrl(second.name);
  await pending.entered;
  assert.equal(first.readCalls, 1);
  assert.equal(second.readCalls, 0);
  assert.equal(harness.effects.createdUrls.length, 0);
  pending.release();
  await loadedImage(harness, second.name);
  assert.equal(second.readCalls, 1);
  assert.equal(harness.effects.createdUrls.length, 1, 'only the image requested after validation should get a URL');
});

test('failed admission attempts consume the 64-image budget before a 65th read', async () => {
  const harness = createHarness();
  const files = Array.from({ length: 65 }, (_, index) => memoryFile(`${index}.png`, '<svg/>', 'image/png'));
  imageEntries(harness, files);
  for (const file of files) harness.api.resolveImageAssetUrl(file.name);
  await until(() => /PNG、JPEG/.test(harness.api.imageAssetReason('63.png')), '64 failed admissions');
  assert.equal(files.slice(0, 64).reduce((count, file) => count + file.readCalls, 0), 64);
  assert.equal(files[64].readCalls, 0);
  assert.equal(harness.api.resolveImageAssetUrl('64.png'), '');
  assert.equal(harness.effects.createdUrls.length, 0);
});

test('declared file sizes reserve the 64 MiB aggregate budget even when reads are invalid', async () => {
  const harness = createHarness();
  const sizes = [25, 25, 14].map((mib) => mib * 1024 * 1024);
  const files = sizes.map((size, index) => Object.assign(memoryImage(`${index}.png`), { size }));
  const blocked = memoryImage('blocked.png');
  imageEntries(harness, [...files, blocked]);
  for (const file of files) await rejectedImage(harness, file.name, /画像サイズを確認/);
  await rejectedImage(harness, blocked.name, /合計サイズ/);
  assert.deepEqual(files.map((file) => file.readCalls), [1, 1, 1]);
  assert.equal(blocked.readCalls, 0, 'no further arrayBuffer call is allowed after the aggregate byte budget');
  assert.equal(harness.effects.createdUrls.length, 0);
});

test('oversized or invalid file sizes cannot reach arrayBuffer through insertion', async () => {
  const harness = createHarness();
  for (const size of [0, -1, NaN, Infinity, 1.5, 25 * 1024 * 1024 + 1]) {
    const file = Object.assign(memoryImage('oversized.png'), { size });
    await assert.rejects(harness.api.saveImageFileToAssets(file), /サイズ/);
    assert.equal(file.readCalls, 0);
  }
  assert.equal(harness.effects.createdUrls.length, 0);
});

test('accepted images share the 32-million-pixel aggregate limit', async () => {
  const harness = createHarness();
  const first = memoryImage('first.png', pngWithDimensions(4096, 4096));
  const second = memoryImage('second.png', pngWithDimensions(4096, 4096));
  const overflow = memoryImage('overflow.png');
  imageEntries(harness, [first, second, overflow]);
  const firstUrl = await loadedImage(harness, first.name);
  const secondUrl = await loadedImage(harness, second.name);
  assert.equal(harness.api.getImageInfo(firstUrl).pixels + harness.api.getImageInfo(secondUrl).pixels, 32 * 1024 * 1024);
  await rejectedImage(harness, overflow.name, /合計画素数/);
  assert.equal(harness.effects.createdUrls.length, 2);
});

test('embedded raster data is validated once and receives an owned canonical URL', async () => {
  const harness = createHarness();
  const key = `data:image/PNG;base64,${Buffer.from(PNG_BYTES).toString('base64')}`;
  assert.equal(harness.api.getImageExportSrc(key), '', 'raw data is never accepted by the export URL getter');
  const url = await loadedImage(harness, key);
  assert.equal(harness.api.resolveImageAssetUrl(key), url);
  assert.equal(harness.effects.createdUrls.length, 1);
  assert.equal(harness.api.getImageInfo(url).width, 1);
  assert.equal(harness.state.assetUrls.size, 0);
  assert.equal(harness.effects.fetches.length, 0);
  assert.equal(harness.api.getImageExportSrc(url), key.replace('image/PNG', 'image/png'),
    'export preserves approved embedded bytes with the validated MIME type');
  assert.equal(harness.api.getImageExportSrc('blob:unowned'), '');
  harness.api.clearAssetUrls();
  assert.equal(harness.api.getImageExportSrc(url), '', 'an old document cannot supply export image data');
});

test('embedded data URLs above the existing source URL limit cannot become export payloads', async () => {
  const harness = createHarness();
  const key = 'data:image/png;base64,' + 'AAAA'.repeat(50000);
  await rejectedImage(harness, key, /URLが表示上限/);
  const normalizedOversize = 'data:image/jpg;base64,' + 'A'.repeat(200000 - 'data:image/jpg;base64,'.length);
  assert.equal(normalizedOversize.length, 200000);
  await rejectedImage(harness, normalizedOversize, /URLが表示上限/);
  assert.equal(harness.effects.createdUrls.length, 0);
  assert.equal(harness.api.getImageExportSrc(key), '');
});

for (const key of [
  'data:image/svg+xml;base64,PHN2Zy8+', 'data:image/png;base64,PHN2Zy8+',
  'data:image/png,percent-encoded', 'data:image/png;base64,%%%bad',
]) {
  test(`invalid embedded image ${key} is never displayed or fetched`, async () => {
    const harness = createHarness();
    await rejectedImage(harness, key, /不正|PNG、JPEG/);
    assert.equal(harness.effects.createdUrls.length, 0);
    assert.equal(harness.effects.fetches.length, 0);
  });
}

test('the five-second read deadline releases the next queued image and rejects late bytes', async () => {
  const harness = createHarness({ manualImageTimeout: true });
  const pending = pause();
  const stalled = memoryImage('stalled.png');
  stalled.readPause = pending;
  const next = memoryImage('next.png');
  imageEntries(harness, [stalled, next]);
  harness.api.resolveImageAssetUrl(stalled.name);
  harness.api.resolveImageAssetUrl(next.name);
  await pending.entered;
  assert.equal(next.readCalls, 0);
  assert.equal(harness.controls.imageTimeouts.size, 1, 'the production read deadline must be armed for 5000 ms');
  for (const callback of harness.controls.imageTimeouts.values()) callback();
  await rejectedImage(harness, stalled.name, /タイムアウト/);
  const nextUrl = await loadedImage(harness, next.name);
  pending.release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.api.resolveImageAssetUrl(stalled.name), '');
  assert.equal(harness.api.resolveImageAssetUrl(next.name), nextUrl);
  assert.equal(harness.effects.createdUrls.length, 1);
  assert.equal(harness.controls.imageTimeouts.size, 0);
});

test('replacement cancels stalled image insertion without waiting for the old file read', async () => {
  const harness = createHarness();
  await harness.api.restorePersistedDirectoryHandle();
  const pending = pause();
  const file = memoryImage('stale.png');
  file.readPause = pending;
  const completion = harness.api.saveImageFileToAssets(file);
  const rejected = assert.rejects(completion, /文書が切り替わった/);
  await pending.entered;
  bindNewDocument(harness);
  await bounded(rejected, 'cancelled image insertion');
  const expected = visibleState(harness);
  pending.release();
  await new Promise((resolve) => setImmediate(resolve));
  assertUnchanged(harness, expected, 'late cancelled insertion read');
  assert.equal(harness.oldRoot.directories.size, 0);
  assert.equal(harness.effects.createdUrls.length, 0);
});

test('replacement drops queued old reads and gives the new document an independent validation queue', async () => {
  const harness = createHarness();
  const pending = pause();
  const first = memoryImage('first.png');
  first.readPause = pending;
  const queued = memoryImage('queued.png');
  imageEntries(harness, [first, queued]);
  harness.api.resolveImageAssetUrl(first.name);
  harness.api.resolveImageAssetUrl(queued.name);
  await pending.entered;
  bindNewDocument(harness);
  const fresh = memoryImage('fresh.png');
  imageEntries(harness, [fresh]);
  const url = await loadedImage(harness, fresh.name);
  assert.equal(queued.readCalls, 0);
  assert.equal(fresh.readCalls, 1);
  const expected = visibleState(harness);
  const imageRenders = harness.effects.imageRenders;
  pending.reject(namedError('NotReadableError'));
  await new Promise((resolve) => setImmediate(resolve));
  assertUnchanged(harness, expected, 'rejected late read from cancelled queue');
  assert.equal(harness.effects.imageRenders, imageRenders);
  assert.equal(harness.api.resolveImageAssetUrl(fresh.name), url);
  assert.equal(harness.api.resolveImageAssetUrl(first.name), '');
  assert.equal(queued.readCalls, 0);
});

test('replacing a document revokes each owned URL exactly once and invalidates metadata', async () => {
  const harness = createHarness();
  await harness.api.restorePersistedDirectoryHandle();
  const url = await loadedImage(harness, 'old-root.png');
  assert.equal(harness.api.resolveImageAssetUrl('./old-root.png'), url);
  bindNewDocument(harness);
  assert.deepEqual(harness.effects.revokedUrls, [url]);
  assert.equal(harness.api.resolveImageAssetUrl(url), '');
  assert.equal(harness.api.getImageInfo(url), null);
  assert.equal(harness.state.imageAssetFiles.size, 0);
  assert.equal(harness.state.assetUrls.size, 0);
  harness.api.clearAssetUrls();
  assert.deepEqual(harness.effects.revokedUrls, [url]);
});

test('a slow old-root image cannot publish into a newer folder with the same image path', async () => {
  const harness = createHarness();
  const first = memoryRoot('first', '# First');
  const second = memoryRoot('second', '# Second');
  const oldImage = memoryImage('shared.png');
  const newImage = memoryImage('shared.png', pngWithDimensions(2, 1));
  const pending = pause();
  oldImage.readPause = pending;
  first.addFile(oldImage);
  second.addFile(newImage);
  await openRoot(harness, first);
  harness.api.resolveImageAssetUrl('shared.png');
  await pending.entered;
  await openRoot(harness, second);
  const url = await loadedImage(harness, 'shared.png');
  const expected = visibleState(harness);
  pending.release();
  await new Promise((resolve) => setImmediate(resolve));
  assertUnchanged(harness, expected, 'old image validation');
  assert.equal(harness.api.getImageInfo(url).width, 2);
  assert.equal(newImage.readCalls, 1);
  assert.equal(harness.effects.createdUrls.length, 1);
});

test('image insertion writes validated canonical bytes and leaves the URL lazy', async () => {
  const harness = createHarness();
  await harness.api.restorePersistedDirectoryHandle();
  const file = memoryImage('photo.PNG', PNG_BYTES, 'application/octet-stream');
  const saved = await harness.api.saveImageFileToAssets(file);
  assert.equal(saved.markdownPath, 'draft.assets/photo.png');
  assert.equal(saved.fileName, 'photo.png');
  assert.equal(file.readCalls, 1);
  assert.equal(harness.effects.createdUrls.length, 0);
  const canonical = harness.state.imageAssetFiles.get(saved.markdownPath);
  assert.equal(canonical.type, 'image/png');
  assert.deepEqual(new Uint8Array(await canonical.arrayBuffer()), PNG_BYTES);
  const assets = harness.oldRoot.directories.get('draft.assets');
  assert.equal(assets.writes.length, 1);
  assert.equal(assets.writes[0].path, 'photo.png');
  const url = harness.api.resolveImageAssetUrl(saved.markdownPath);
  assert.ok(url.startsWith('blob:'));
  assert.equal(harness.api.getImageInfo(url).width, 1);
  assert.equal(file.readCalls, 1, 'saved images must reuse their completed validation');
});

test('desktop insertion sends validated canonical bytes and publishes only after native save succeeds', async () => {
  const harness = createHarness();
  Object.assign(harness.state, { desktopHost: true, desktopDocumentReady: true });
  harness.api.initializeDesktopBridge();
  const file = memoryImage('photo.PNG', PNG_BYTES, 'application/octet-stream');
  const completion = harness.api.saveImageFileToAssets(file);
  await until(() => harness.effects.desktopMessages.some((message) => message.type === 'desktop.saveAsset'), 'desktop asset request');
  const message = harness.effects.desktopMessages.find((entry) => entry.type === 'desktop.saveAsset');
  assert.equal(message.fileName, 'photo.PNG');
  assert.equal(message.mimeType, 'image/png');
  assert.deepEqual(Uint8Array.from(Buffer.from(message.dataBase64, 'base64')), PNG_BYTES);
  assert.equal(file.readCalls, 1);
  assert.equal(harness.effects.canonicalBlobReads, 1);
  assert.equal(harness.state.desktopAssetRequests.size, 1);
  assert.equal(harness.state.imageAssetFiles.size, 0, 'a pending native write cannot publish a saved asset');
  assert.equal(harness.effects.createdUrls.length, 0);
  harness.controls.desktopMessage({ data: {
    type: 'host.assetSaved', requestId: message.requestId,
    fileName: 'photo.png', markdownPath: 'draft.assets/photo.png',
  } });
  const saved = await completion;
  assert.equal(saved.markdownPath, 'draft.assets/photo.png');
  assert.equal(harness.state.desktopAssetRequests.size, 0);
  assert.equal(harness.state.imageAssetFiles.get(saved.markdownPath).type, 'image/png');
  assert.equal(harness.effects.createdUrls.length, 0, 'successful native saves retain lazy URLs');
  const nativeUrl = `https://${NATIVE_DOCUMENT_HOST}/${saved.markdownPath}`;
  const url = harness.api.resolveImageAssetUrl(saved.markdownPath, nativeUrl);
  const info = harness.api.getImageInfo(url);
  assert.equal(info.width, 1);
  assert.equal(harness.api.resolveImageAssetUrl(saved.markdownPath), url, 'native rendering reuses the saved canonical URL');
  assert.equal(harness.api.getImageInfo(harness.api.resolveImageAssetUrl(saved.markdownPath, nativeUrl)), info);
  assert.equal(harness.api.getImageExportSrc(url), url, 'folder and native images keep their existing output behavior');
  assert.equal(harness.effects.fetches.length, 0, 'a newly saved native image must not be fetched and counted a second time');
  assert.equal(harness.effects.canonicalBlobReads, 1, 'rendering must reuse the successful validation');
  assert.equal(harness.effects.desktopMessages.filter((entry) => entry.type === 'desktop.saveAsset').length, 1);
});

test('desktop insertion cannot send an old asset after canonical Blob reading spans a document switch', async () => {
  const harness = createHarness();
  Object.assign(harness.state, { desktopHost: true, desktopDocumentReady: true });
  harness.api.initializeDesktopBridge();
  const pending = pause();
  harness.controls.canonicalBlobPause = pending;
  const file = memoryImage('stale.png');
  const completion = harness.api.saveImageFileToAssets(file);
  const rejected = assert.rejects(completion, /文書が切り替わった/);
  await pending.entered;
  assert.equal(file.readCalls, 1, 'the original image must already have passed validation');
  assert.equal(harness.effects.canonicalBlobReads, 1, 'pause the post-validation Blob conversion');
  harness.controls.desktopMessage({ data: {
    type: 'host.loadDocument', fileName: 'newer.md', markdown: '# Newer desktop document',
    hasDocumentFolder: true, dirty: false,
  } });
  const expected = visibleState(harness);
  pending.release();
  await rejected;
  assert.equal(harness.effects.desktopMessages.filter((entry) => entry.type === 'desktop.saveAsset').length, 0);
  assert.equal(harness.state.desktopAssetRequests.size, 0, 'stale conversion cannot leave an outstanding native request');
  assert.equal(harness.state.imageAssetFiles.size, 0);
  assert.equal(harness.effects.createdUrls.length, 0);
  assertUnchanged(harness, expected, 'late desktop Blob conversion');
});

test('invalid inserted bytes cannot create an asset directory or file', async () => {
  const harness = createHarness();
  await harness.api.restorePersistedDirectoryHandle();
  await assert.rejects(harness.api.saveImageFileToAssets(memoryFile('fake.png', '<svg/>', 'image/png')), /PNG、JPEG/);
  assert.equal(harness.oldRoot.directories.size, 0);
  assert.equal(harness.effects.createdUrls.length, 0);
});

test('switching documents while the assets directory is pending prevents file writes and publication', async () => {
  const harness = createHarness();
  await harness.api.restorePersistedDirectoryHandle();
  const pending = pause();
  const assets = emptyRoot('old-assets');
  harness.oldRoot.getDirectoryHandle = async (name) => {
    assert.equal(name, 'draft.assets');
    await pending.wait();
    return assets;
  };
  const completion = harness.api.saveImageFileToAssets(memoryImage('pending.png'));
  const rejected = assert.rejects(completion, /文書が切り替わった/);
  await pending.entered;
  const newer = memoryRoot('newer');
  await openRoot(harness, newer);
  const expected = visibleState(harness);
  pending.release();
  await rejected;
  assertUnchanged(harness, expected, 'pending old assets directory');
  assert.equal(assets.files.size, 0);
  assert.equal(assets.writes.length, 0);
  assert.equal(newer.directories.size, 0);
  assert.equal(harness.effects.createdUrls.length, 0);
});

test('native image responses are streamed, validated and retained as owned canonical blobs', async () => {
  const harness = createHarness();
  harness.state.desktopHost = true;
  harness.state.desktopDocumentReady = true;
  const nativeUrl = `https://${NATIVE_DOCUMENT_HOST}/folder/photo%20one.PNG`;
  const stream = nativeImageResponse([PNG_BYTES.slice(0, 15), PNG_BYTES.slice(15)], 'application/octet-stream');
  harness.controls.fetch = async () => stream.response;
  const url = await loadedImage(harness, 'photo one.PNG', nativeUrl);
  assert.equal(harness.effects.fetches.length, 1);
  assert.equal(harness.effects.fetches[0].url, nativeUrl);
  assert.equal(harness.effects.fetches[0].init.credentials, 'omit');
  assert.equal(harness.effects.fetches[0].init.redirect, 'error');
  assert.equal(harness.effects.fetches[0].init.cache, 'no-store');
  assert.ok(harness.effects.fetches[0].init.signal instanceof AbortSignal);
  assert.equal(stream.calls.reads, 3);
  assert.equal(stream.calls.cancels, 1);
  assert.equal(harness.api.getImageInfo(url).mimeType, 'image/png');
  assert.equal(harness.effects.createdUrls[0].blob.type, 'image/png');
  assert.deepEqual(new Uint8Array(await harness.effects.createdUrls[0].blob.arrayBuffer()), PNG_BYTES);
  assert.equal(harness.api.resolveImageAssetUrl('second alias', nativeUrl), url);
  assert.equal(harness.effects.fetches.length, 1);
});

for (const [name, nativeUrl, desktopHost, desktopDocumentReady] of [
  ['HTTP', `http://${NATIVE_DOCUMENT_HOST}/photo.png`, true, true],
  ['foreign host', 'https://external.example/photo.png', true, true],
  ['credentials', `https://user:password@${NATIVE_DOCUMENT_HOST}/photo.png`, true, true],
  ['file scheme', 'file:///C:/photo.png', true, true],
  ['invalid URL', 'not a URL', true, true],
  ['missing desktop host', `https://${NATIVE_DOCUMENT_HOST}/photo.png`, false, true],
  ['document not ready', `https://${NATIVE_DOCUMENT_HOST}/photo.png`, true, false],
]) {
  test(`native image ${name} is refused before fetch`, async () => {
    const harness = createHarness();
    Object.assign(harness.state, { desktopHost, desktopDocumentReady });
    assert.equal(harness.api.resolveImageAssetUrl('photo.png', nativeUrl), '');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(harness.effects.fetches.length, 0);
    assert.equal(harness.effects.createdUrls.length, 0);
  });
}

test('a native stream exceeding 25 MiB is cancelled before subsequent chunks are read', async () => {
  const harness = createHarness();
  Object.assign(harness.state, { desktopHost: true, desktopDocumentReady: true });
  const nativeUrl = `https://${NATIVE_DOCUMENT_HOST}/large.png`;
  const stream = nativeImageResponse([new Uint8Array(25 * 1024 * 1024 + 1), PNG_BYTES]);
  harness.controls.fetch = async () => stream.response;
  await rejectedImage(harness, 'large.png', /サイズ上限/, nativeUrl);
  assert.equal(stream.calls.reads, 1);
  assert.equal(stream.calls.cancels, 1);
  assert.equal(harness.effects.fetches[0].init.signal.aborted, true);
  assert.equal(harness.effects.createdUrls.length, 0);
});

test('replacement aborts a pending native read and cannot publish its late completion', async () => {
  const harness = createHarness();
  Object.assign(harness.state, { desktopHost: true, desktopDocumentReady: true });
  const pending = pause();
  let cancelled = 0;
  const oldUrl = `https://${NATIVE_DOCUMENT_HOST}/old.png`;
  const newUrl = `https://${NATIVE_DOCUMENT_HOST}/new.png`;
  harness.controls.fetch = async (url) => url === oldUrl ? {
    ok: true,
    headers: { get: () => 'image/png' },
    body: { getReader: () => ({
      async read() { await pending.wait(); return { value: PNG_BYTES, done: false }; },
      async cancel() { cancelled += 1; },
    }) },
  } : nativeImageResponse([PNG_BYTES]).response;
  harness.api.resolveImageAssetUrl('old.png', oldUrl);
  await pending.entered;
  bindNewDocument(harness);
  const url = await loadedImage(harness, 'new.png', newUrl);
  assert.equal(harness.effects.fetches[0].init.signal.aborted, true);
  const expected = visibleState(harness);
  const imageRenders = harness.effects.imageRenders;
  pending.release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cancelled, 1);
  assertUnchanged(harness, expected, 'late native stream completion');
  assert.equal(harness.effects.imageRenders, imageRenders);
  assert.equal(harness.effects.createdUrls.length, 1);
  assert.equal(harness.api.resolveImageAssetUrl('new.png', newUrl), url);
});

for (const [name, mimeType, suffix, reason] of [
  ['MIME mismatch', 'image/jpeg', 'png', /MIME 型/],
  ['extension mismatch', 'image/png', 'jpg', /拡張子/],
]) {
  test(`native image ${name} is rejected using response metadata and the decoded path`, async () => {
    const harness = createHarness();
    Object.assign(harness.state, { desktopHost: true, desktopDocumentReady: true });
    const nativeUrl = `https://${NATIVE_DOCUMENT_HOST}/photo.${suffix}`;
    const stream = nativeImageResponse([PNG_BYTES], mimeType);
    harness.controls.fetch = async () => stream.response;
    await rejectedImage(harness, `photo.${suffix}`, reason, nativeUrl);
    assert.equal(stream.calls.cancels, 1);
    assert.equal(harness.effects.createdUrls.length, 0);
  });
}

let passed = 0;
for (const { name, run } of tests) {
  try {
    await bounded(run(), name);
    passed += 1;
  } catch (error) {
    console.error(`FAIL: ${name}`);
    throw error;
  }
}
console.log(`file manager race checks passed (${passed} cases; mocked filesystem and IndexedDB only)`);

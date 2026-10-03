import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

// All file handles, IndexedDB requests, writes, and object URLs are in memory.
// Only the production JavaScript source is read from the real filesystem.
const source = readFileSync(new URL('../modules/file-manager.js', import.meta.url), 'utf8');
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
  root.addFile(memoryFile(`${name}.png`, 'image bytes', 'image/png'));
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
  };
  const controls = {
    openPause: null, openFailure: null, readPause: null, deletePause: null, putPause: null, putFailure: null,
    confirmDirectory: true, allowReplacement: true,
  };
  const state = {
    ...draft,
    directoryHandle: null, fileHandle: null, directoryName: '', pickerStartDirectoryHandle: null,
    documentGeneration: 0, documentRevision: 1, dirty: draft.dirty !== false, mode: 'source', assetUrls: new Map(),
    folderScanLimitMessage: '', folderInputMode: 'open', richUndoStack: [], desktopHost: false,
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
    clearTimeout,
    setTimeout(callback, delay = 0) {
      const timer = setTimeout(callback, delay);
      timer.unref();
      return timer;
    },
  };
  let objectUrlId = 0;
  const document = {
    activeElement: els.source,
    body: { appendChild() {} },
    createElement(tag) {
      assert.equal(tag, 'a', 'unexpected DOM operation in file manager test');
      return { click() { effects.downloads.push(this.download); }, remove() {} };
    },
  };
  const dependencies = {
    normalizeAssetPath: (value) => String(value || '').replace(/\\/g, '/'),
    normalizeNewlines: (value) => String(value || '').replace(/\r\n?/g, '\n'),
    safeFileName: (value) => String(value || ''),
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
    renderPreview() {}, renderRich() {}, renderOutline() {}, applyOutlineVisibility() {},
    setSourceSelectionRange() {}, restoreRichCaret() {},
  };
  const sandbox = {
    window, document, TextDecoder, Blob, performance, crypto: window.crypto,
    URL: {
      createObjectURL: () => `blob:memory-${++objectUrlId}`,
      revokeObjectURL: (value) => effects.revokedUrls.push(value),
    },
    localStorage: { removeItem() {}, getItem: () => null, setItem() {} },
    confirm: () => controls.confirmDirectory,
    alert: (message) => effects.warnings.push(message),
    prompt: (_message, defaultValue) => defaultValue,
  };
  vm.runInNewContext(source, sandbox, { filename: 'file-manager.js' });
  const api = window.PMEFileManager.createFileManager({
    state, els, dependencies,
    constants: {
      FSA_DB_NAME: 'memory-only', FSA_STORE_NAME: 'handles',
      FSA_DIRECTORY_HANDLE_KEY: DIRECTORY_KEY, FSA_PICKER_START_HANDLE_KEY: PICKER_KEY,
      FSA_SETTINGS_DIRECTORY_HANDLE_KEY: 'settings-directory',
      ALLOWED_IMAGE_TYPES: new Set(['image/png']), MAX_FOLDER_SCAN_FILES: 100, MAX_FOLDER_SCAN_DEPTH: 4,
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
  assert.ok(harness.state.assetUrls.has('old-root.png'));
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
  assert.ok(harness.state.assetUrls.has('photo.PNG'));
  assert.ok(harness.state.assetUrls.has('picture'));
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
  assert.ok(harness.state.assetUrls.has('small.png'));
  assert.equal(harness.state.assetUrls.has('large.png'), false);
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
  assert.ok(harness.state.assetUrls.has('first.png'));
  assert.equal(harness.state.assetUrls.has('second.png'), false);
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
    assert.ok(harness.state.assetUrls.has('root.png'));
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
  assert.ok(harness.state.assetUrls.has('first.png'));
  assert.equal(harness.state.assetUrls.has('second.png'), false);
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
  assert.ok(harness.state.assetUrls.has('values-root.png'));
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

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const securitySample = readFileSync(new URL('../samples/security-check.md', import.meta.url), 'utf8');

assert.match(index, /Content-Security-Policy/);
assert.match(index, /default-src 'none'/);
assert.match(index, /connect-src 'none'/);
assert.match(index, /script-src 'self'/);
assert.match(index, /style-src 'self' 'unsafe-inline'/);
assert.doesNotMatch(index, /frame-ancestors/, 'frame-ancestors is ignored in meta CSP and should not be present');
assert.match(index, /img-src 'self' data: blob:/);
assert.doesNotMatch(index, /img-src[^"]*file:/, 'file: images should not be allowed by CSP');
assert.doesNotMatch(index, /https?:\/\/.*\.(js|css)/i, 'no external JS/CSS');

assert.doesNotMatch(app, /\beval\s*\(/, 'eval must not be used');
assert.doesNotMatch(app, /new\s+Function\b/, 'new Function must not be used');
assert.doesNotMatch(app, /\bfetch\s*\(/, 'fetch must not be used');
assert.doesNotMatch(app, /XMLHttpRequest/, 'XHR must not be used');
assert.doesNotMatch(app, /WebSocket/, 'WebSocket must not be used');
assert.doesNotMatch(app, /\bWorker\b/, 'Worker must not be used');

assert.match(app, /function\s+sanitizeLinkUrl/);
assert.match(app, /function\s+sanitizeImageUrl/);
assert.match(app, /function\s+normalizeLocalImageUrl/);
assert.match(app, /function\s+renderMermaidBlock/);
assert.match(app, /function\s+highlightCode/);
assert.match(app, /javascript:alert\(1\)/, 'sample malicious link should exist in default markdown');
assert.match(app, /data:image\\\/\(png\|jpeg\|jpg\|gif\|webp\)/, 'only raster data images should be allowed');
assert.match(securitySample, /https:\/\/example\.com\/tracker\.png/, 'sample remote image should be tested');
assert.match(securitySample, /\\\\server\\share\\local sample\.webp/, 'UNC image sample should exist');
assert.match(app, /pme_task_lists/, 'markdown-it task list extension should be enabled');
assert.match(app, /html:\s*false/, 'markdown-it raw HTML must remain disabled');
assert.match(app, /securityLevel:\s*'strict'/, 'Mermaid strict mode should remain enabled');
assert.match(app, /htmlLabels:\s*false/, 'Mermaid HTML labels should remain disabled');
assert.match(app, /mermaidRenderQueue/, 'Mermaid renders should be serialized to avoid shared scratch DOM races');
assert.match(app, /async function\s+renderMermaidTargets/, 'Mermaid render queue should process targets sequentially');
assert.doesNotMatch(app, /isSimpleLocalFlowchart\(source\)\)\s*return/, 'runtime flowcharts should not skip Mermaid.js rendering');
assert.match(index, /id="codeLanguageOptions"/, 'code language suggestion list should exist');
assert.match(index, /id="markdownEntryDialog"/, 'folder Markdown selection should use an app dialog');
assert.match(index, /data-action="grant-folder"/, 'current document should support granting folder access without reopening Markdown');
assert.match(app, /code-language-input/, 'rendered code blocks should expose a language input');
assert.match(app, /showOpenFilePicker/, 'Open should use File System Access API when available');
assert.match(app, /function\s+requestDirectoryForOpenedMarkdown/, 'opened Markdown files should be able to request containing folder access');
assert.match(app, /async function\s+grantFolderForCurrentDocument/, 'folder permission should be attachable to the current document without reloading contents');
assert.match(app, /async function\s+grantFolderEntriesForCurrentDocument/, 'folder permission attachment should reuse current Markdown state');
assert.match(app, /captureCurrentMarkdownFromEditor\(\)/, 'granting folder access should capture current edits before attaching folder access');
assert.match(app, /isSameEntry\(fileHandle\)/, 'selected directory should be matched to the opened file handle when possible');
assert.match(app, /showDirectoryPicker\(\{\s*mode:\s*'readwrite'\s*\}\)/, 'folder picker should request write access for assets image insertion');
assert.match(app, /async function\s+insertImageFilesAsAssets/, 'pasted and dropped images should be routed through assets insertion');
assert.match(app, /async function\s+onImageChosen[\s\S]+insertImageFilesAsAssets/, 'image picker should also use assets insertion instead of Data URLs');
assert.doesNotMatch(app, /readAsDataURL/, 'image picker must not embed selected images as large Data URLs');
assert.match(app, /createWritable\(\)/, 'assets image insertion should write through File System Access API');
assert.match(app, /async function\s+saveMarkdownToOpenedFile/, 'save should overwrite the opened Markdown file when File System Access folder permission exists');
assert.match(app, /function\s+renderBlockedImage/, 'blocked or unresolved images should show an explanatory placeholder');
assert.match(app, /RICH_INLINE_SOURCE_SELECTOR[\s\S]+\.blocked-image/, 'unresolved image placeholders should participate in inline source editing');
assert.match(app, /classList\?\.contains\('blocked-image'\)[\s\S]+serializeBlockedImageElement/, 'unresolved image placeholders should restore Markdown image source while editing');
assert.match(app, /function\s+hasNonCollapsedRichSelection/, 'rich editor should preserve normal text range selection');
assert.match(app, /function\s+decodeLocalImagePath/, 'percent-encoded local image paths should be normalized before validation');
assert.match(app, /function\s+snapshotRichDeleteFromKeydown/, 'rich delete operations should be undoable even when beforeinput is skipped');
assert.match(app, /フォルダが許可されていない/, 'missing folder permission should be explained to the user');
assert.match(app, /addEventListener\('drop', onEditorDrop\)/, 'editors should accept dropped image files');
assert.match(app, /addEventListener\('paste', onMarkdownPaste\)/, 'source editor should handle pasted image files');
assert.match(app, /dataset\.folderAccess = state\.directoryHandle \? 'fsa'/, 'UI should expose when the current folder came from File System Access API');
assert.match(app, /function\s+restorePersistedDirectoryHandle/, 'File System Access directory handles should be restorable after reopening');
assert.match(app, /window\.indexedDB\.open\(FSA_DB_NAME,\s*1\)/, 'persisted File System Access handles should use local IndexedDB only');
assert.match(app, /persistDirectoryHandle\(directoryHandle\)/, 'opened File System Access directory handle should be persisted for reopen');

class TestURL extends URL {}
let objectUrlIndex = 0;
TestURL.createObjectURL = () => `blob:test-${objectUrlIndex += 1}`;
TestURL.revokeObjectURL = () => {};

const instrumented = app.replace(/\}\)\(\);\s*$/, 'return { renderMarkdownHtml, sanitizeImageUrl, sanitizeLinkUrl, saveImageFileToAssets, ensureImageAssetWriteAccess, buildFolderAssetUrls, state };\n})();');
const renderer = vm.runInNewContext(instrumented, {
  document: { addEventListener() {} },
  window: { isSecureContext: true },
  localStorage: {},
  URL: TestURL,
  Blob,
  navigator: {},
  confirm() { return true; },
  prompt() { return ''; },
  alert() {},
  console,
});

const slash = String.fromCharCode(92);
const drivePath = `Z:${slash}share${slash}local sample.webp`;
const uncPath = `${slash}${slash}server${slash}share${slash}local sample.webp`;
const rendered = renderer.renderMarkdownHtml([
  '```js',
  'const message = "ok";',
  '```',
  '',
  '```mermaid',
  'flowchart TD',
  '  A[Start] -->|go| B[End]',
  '```',
  '',
  `![local](<${drivePath}>)`,
  '![remote](https://example.com/tracker.png)',
].join('\n'));

assert.match(rendered, /tok-keyword/, 'code blocks should be highlighted');
assert.match(rendered, /mermaid-diagram/, 'mermaid blocks should render locally');
assert.match(rendered, /<svg class="mermaid-svg"[^>]+width="\d+"[^>]+height="\d+"/, 'mermaid SVG should have explicit dimensions');
assert.match(rendered, /mermaid-flow-node-label/, 'local flowchart labels should use readable flowchart text styling');
assert.doesNotMatch(rendered, /file:\/\/\/Z:\/share\/local%20sample\.webp/, 'Windows drive images should not render as file URLs');
assert.match(rendered, /ローカル絶対パスは直接読み込みません/, 'Windows drive images should explain that absolute paths are not loaded directly');
assert.match(rendered, /blocked-image/, 'remote images should remain blocked');
assert.equal(renderer.sanitizeLinkUrl('javascript:alert(1)'), '');
assert.equal(renderer.sanitizeImageUrl('https://example.com/a.png'), '');
assert.equal(renderer.sanitizeImageUrl(uncPath), '');
assert.equal(renderer.sanitizeImageUrl('C:%5CUsers%5Crokuh%5CDocuments%5Cimage-3.png'), '');

const branchRendered = renderer.renderMarkdownHtml([
  '```mermaid',
  'flowchart TD',
  '  A[Markdownを書く] --> B{安全にプレビュー}',
  '  B -->|OK| C[保存]',
  '  B -->|確認| D[修正]',
  '```',
].join('\n'));
const okLabel = branchRendered.match(/<text class="mermaid-edge-label" x="([^"]+)"[^>]*>OK<\/text>/);
const reviewLabel = branchRendered.match(/<text class="mermaid-edge-label" x="([^"]+)"[^>]*>確認<\/text>/);
assert.ok(okLabel, 'branch flowchart should render the OK edge label');
assert.ok(reviewLabel, 'branch flowchart should render the review edge label');
assert.notEqual(okLabel[1], reviewLabel[1], 'branch edge labels should not overlap at the same x position');

const loopRendered = renderer.renderMarkdownHtml([
  '```mermaid',
  'flowchart TD',
  '  A[Markdownを書く] --> B{プレビュー}',
  '  B -->|OK| C[保存]',
  '  B -->|修正| A',
  '```',
].join('\n'));
assert.match(loopRendered, /viewBox="0 0 760 /, 'single-column flowcharts should keep a wide enough viewBox');
const loopLabel = loopRendered.match(/<text class="mermaid-edge-label" x="([^"]+)"[^>]*text-anchor="([^"]+)"[^>]*>修正<\/text>/);
assert.ok(loopLabel, 'backward edge label should be rendered');
assert.ok(Number(loopLabel[1]) > 80, 'backward edge label should stay inside the SVG viewBox');

const sequenceRendered = renderer.renderMarkdownHtml([
  '```mermaid',
  'sequenceDiagram',
  '  participant U as User',
  '  participant E as Editor',
  '  U->>E: Markdownを書く',
  '  E-->>U: Preview',
  '```',
].join('\n'));
assert.match(sequenceRendered, /mermaid-sequence/, 'sequence diagrams should render locally');
assert.match(sequenceRendered, />User</, 'declared sequence participant labels should render');
assert.match(sequenceRendered, />Editor</, 'declared sequence participant aliases should render');
assert.doesNotMatch(sequenceRendered, />E-</, 'return arrows must not be parsed as a bogus E- participant');

const fallback = renderer.renderMarkdownHtml([
  '```mermaid',
  'mindmap',
  '  root((Markdown))',
  '```',
].join('\n'));
assert.match(fallback, /mermaid-fallback/, 'unsupported mermaid should fall back visibly');
assert.match(fallback, /mindmap/, 'unsupported mermaid source should remain visible');

renderer.state.allowedLinkDomains = ['example.com'];
assert.equal(renderer.sanitizeLinkUrl('https://example.com/docs'), 'https://example.com/docs');
assert.equal(renderer.sanitizeLinkUrl('https://docs.example.com/a'), 'https://docs.example.com/a');
assert.equal(renderer.sanitizeLinkUrl('https://evil.example.net/a'), '');

renderer.state.assetUrls.set('images/a.png', 'blob:local-image');
assert.match(renderer.renderMarkdownHtml('![a](images/a.png)'), /src="blob:local-image"/);
renderer.state.assetUrls.clear();
const missingRelativeImage = renderer.renderMarkdownHtml('![image-3](sample.assets/image-3.png)');
assert.match(missingRelativeImage, /画像未表示/, 'relative image without folder access should render an explanation');
assert.match(missingRelativeImage, /フォルダが許可されていない/, 'relative image explanation should mention missing folder permission');
assert.doesNotMatch(missingRelativeImage, /<img\b/, 'relative image without folder access should not load as an app-relative URL');

function memoryDirectoryHandle(name = 'root') {
  const directories = new Map();
  const files = new Map();
  return {
    kind: 'directory',
    name,
    directories,
    files,
    async queryPermission({ mode }) {
      return mode === 'readwrite' ? 'granted' : 'prompt';
    },
    async requestPermission() {
      return 'granted';
    },
    async getDirectoryHandle(childName, options = {}) {
      if (!directories.has(childName)) {
        if (!options.create) throw Object.assign(new Error('not found'), { name: 'NotFoundError' });
        directories.set(childName, memoryDirectoryHandle(childName));
      }
      return directories.get(childName);
    },
    async getFileHandle(childName, options = {}) {
      if (!files.has(childName)) {
        if (!options.create) throw Object.assign(new Error('not found'), { name: 'NotFoundError' });
        files.set(childName, memoryFileHandle(childName));
      }
      return files.get(childName);
    },
  };
}

function memoryFileHandle(name) {
  return {
    kind: 'file',
    name,
    written: null,
    async createWritable() {
      const handle = this;
      return {
        async write(file) {
          handle.written = file;
        },
        async close() {},
      };
    },
  };
}

const rootHandle = memoryDirectoryHandle();
const docsHandle = await rootHandle.getDirectoryHandle('docs', { create: true });
renderer.state.directoryHandle = rootHandle;
renderer.state.markdownRelativePath = 'docs/sample.md';
renderer.state.fileName = 'sample.md';
assert.equal(await renderer.ensureImageAssetWriteAccess(), true, 'opened folder handle should grant read/write image insertion');
const pastedImage = new Blob(['image-bytes'], { type: 'image/png' });
Object.defineProperty(pastedImage, 'name', { value: 'clipboard image.png' });
const savedImage = await renderer.saveImageFileToAssets(pastedImage);
assert.equal(savedImage.markdownPath, 'sample.assets/clipboard image.png', 'images should be saved beside the Markdown file in a file-name assets directory');
assert.ok(docsHandle.directories.get('sample.assets').files.has('clipboard image.png'), 'asset image should be written through the selected directory handle');
assert.equal(docsHandle.directories.get('sample.assets').files.get('clipboard image.png').written, pastedImage, 'image bytes should be written to the allocated asset file');
assert.match(renderer.renderMarkdownHtml(`![clipboard](<${savedImage.markdownPath}>)`), /src="blob:test-/, 'saved asset should render through the refreshed folder asset map');
renderer.state.assetUrls.clear();
renderer.buildFolderAssetUrls([
  { file: pastedImage, relativePath: 'docs/sample.assets/clipboard image.png' },
], 'docs');
assert.match(renderer.renderMarkdownHtml(`![clipboard](<${savedImage.markdownPath}>)`), /src="blob:test-/, 'reopened folder entries should map assets relative to the Markdown file');

const toc = renderer.renderMarkdownHtml([
  '[toc]',
  '',
  '# A',
  '## B',
  '### C',
].join('\n'));
assert.match(toc, /<details open>/, 'top-level TOC entries should be expanded');
assert.match(toc, /<details>/, 'nested TOC entries should be collapsible');

console.log('security smoke checks passed');

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
globalThis.window = globalThis;
globalThis.markdownit = require('../vendor/markdown-it/markdown-it.min.js');
require('../modules/table-policy.js');
require('../modules/image-policy.js');
require('../vendor/prosemirror/prosemirror-editor.js');

const proseMirror = globalThis.PMEProseMirror;
assert.ok(proseMirror, 'ProseMirror bundle should expose its public API');

for (const [columns, rows] of [[65, 2], [2, 257], [64, 65]]) {
  // The raw pipe in the math header must use the same preprocessing for both
  // editability detection and the actual ProseMirror document parser.
  const source = ['|' + Array(columns).fill('$P(A|B)$').join('|') + '|',
    '|' + Array(columns).fill('---').join('|') + '|', ...Array(rows - 1).fill('|')].join('\n');
  assert.equal(proseMirror.unsupportedMarkdownReason(source), 'table-render-limit');
  assert.ok(proseMirror.normalizeMarkdown(source).length < source.length * 2, 'direct parsing/clipboard normalization does not expand cells');
}

const unusedDefinition = '[unused]: https://example.com/path "title"\n';
assert.equal(
  proseMirror.unsupportedMarkdownReason(unusedDefinition),
  'link-reference-definitions',
  'an unused reference definition must not enter a lossy rich-edit round trip',
);

const usedDefinition = 'See [the guide][guide].\n\n[guide]: https://example.com/guide\n';
assert.equal(
  proseMirror.unsupportedMarkdownReason(usedDefinition),
  'link-reference-definitions',
  'a used reference definition must retain its source form outside editable rich mode',
);

assert.equal(
  proseMirror.unsupportedMarkdownReason('Before [](page.md) after'),
  'empty-links',
  'an empty link must not enter a rich-edit model that would discard it',
);
assert.equal(
  proseMirror.unsupportedMarkdownReason('Before [ ](page.md) after'),
  '',
  'a link containing visible whitespace remains representable as a link mark',
);

for (const supportedSource of [
  'Keep ~~removed text~~ editable.\n',
  '```text\n[inside]: https://example.com/code\n```\n',
  '    [inside]: https://example.com/indented-code\n',
  'A normal paragraph containing [label]: text.\n',
]) {
  assert.equal(
    proseMirror.unsupportedMarkdownReason(supportedSource),
    '',
    'reference-like text inside ordinary/code content should remain rich-editable',
  );
}

assert.equal(
  proseMirror.normalizeMarkdown('Keep ~~removed text~~ editable.'),
  'Keep ~~removed text~~ editable.',
  'strikethrough must keep its Markdown meaning through rich editing',
);
assert.equal(
  proseMirror.requiresCanonicalMarkdownNormalization('~~~js\nconst value = 1;\n~~~'),
  false,
  'cosmetic fence spelling should not force source normalization when rich mode was not edited',
);
assert.equal(
  proseMirror.requiresCanonicalMarkdownNormalization('$x$$y$'),
  true,
  'adjacent dollar-delimited formulas should still receive unambiguous canonical delimiters',
);
assert.equal(
  proseMirror.requiresCanonicalMarkdownNormalization('| value | formula |\n| --- | --- |\n| x | $P(A|B)$ |'),
  true,
  'unescaped formula pipes inside Markdown tables should still receive safe canonical escaping',
);
assert.equal(
  proseMirror.normalizeMarkdown('-\n- two'),
  '- \n- two',
  'an empty first list item must not turn a tight list into a loose list',
);
assert.equal(
  proseMirror.normalizeMarkdown('keep&nbsp;'),
  'keep&nbsp;',
  'a trailing non-breaking space entity must not disappear after rich editing',
);
assert.equal(
  proseMirror.normalizeMarkdown('```js\n```'),
  '```js\n```',
  'an empty fenced code block must remain empty after rich editing',
);
assert.equal(
  proseMirror.normalizeMarkdown('```\na\n\n```'),
  '```\na\n\n```',
  'a meaningful blank line at the end of a code block must remain intact',
);

// Exercise the maintained integration source against the vendored model. The
// test hook is injected here only and is never included in the shipped bundle.
const integrationSource = readFileSync(new URL('../vendor/prosemirror/editor-integration.js', import.meta.url), 'utf8');
const moduleNames = {
  'prosemirror-model': 'model', 'prosemirror-state': 'state', 'prosemirror-view': 'view',
  'prosemirror-commands': 'commands', 'prosemirror-history': 'history',
  'prosemirror-keymap': 'keymap', 'prosemirror-schema-list': 'schemaList',
  'prosemirror-markdown': 'markdown', 'prosemirror-tables': 'tables',
};
const imageContext = vm.createContext({
  global: { PMETablePolicy: globalThis.PMETablePolicy, PMEImagePolicy: globalThis.PMEImagePolicy },
  requireModule(name) {
    return name === 'markdown-it' ? globalThis.markdownit : proseMirror.modules[moduleNames[name]] || {};
  },
});
vm.runInContext(`${integrationSource}\nglobal.imageChecks = {
  parseMarkdown, createImageRenderPlan, createImageClipboardSerializer
};`, imageContext);
const imageChecks = imageContext.global.imageChecks;
const approvedInfo = { width: 10, height: 10, pixels: 100, frames: 1, size: 100, mimeType: 'image/png' };
const imageOptions = {
  resolveImageSrc(src) { return src === 'approved.png' ? 'blob:approved-image' : src; },
  getImageInfo(url) { return url === 'blob:approved-image' ? approvedInfo : null; },
};
const imageDocument = (count) => imageChecks.parseMarkdown(Array(count).fill('![kept](approved.png)').join('\n\n'));
const crowdedImages = imageDocument(65);
const imagePlan = imageChecks.createImageRenderPlan(crowdedImages, imageOptions);
assert.equal(imagePlan.size, 64, 'each image occurrence consumes a render slot, including repeated URLs');
assert.ok([...imagePlan.values()].every(({ url }) => url === 'blob:approved-image'));
assert.equal(imageChecks.createImageRenderPlan(imageDocument(1), {}).size, 0, 'missing resolvers must fail closed');
assert.equal(imageChecks.createImageRenderPlan(imageDocument(1), { ...imageOptions, getImageInfo: () => null }).size, 0,
  'a URL without validated metadata must not be rendered');
const unsafeImages = imageChecks.parseMarkdown('![remote](https://example.com/a.png)\n\n![data](data:image/png;base64,AAAA)\n\n![unknown](blob:unowned)');
assert.equal(imageChecks.createImageRenderPlan(unsafeImages, imageOptions).size, 0,
  'raw remote, data and unowned blob URLs must not reach image rendering');
const largeImageOptions = { ...imageOptions, getImageInfo: () => ({ ...approvedInfo, width: 4000, height: 2000, pixels: 8000000 }) };
assert.equal(imageChecks.createImageRenderPlan(imageDocument(5), largeImageOptions).size, 4,
  'the aggregate pixel limit applies independently of the image count limit');
const savedImagePolicy = imageContext.global.PMEImagePolicy;
imageContext.global.PMEImagePolicy = null;
assert.equal(imageChecks.createImageRenderPlan(imageDocument(1), imageOptions).size, 0,
  'a missing shared image policy must fail closed');
imageContext.global.PMEImagePolicy = savedImagePolicy;

// DOMSerializer needs only these DOM primitives. No browser image decoder is
// invoked, so the assertions inspect exactly which src attributes it emits.
const clipboardDocument = {
  createElement(name) {
    return { nodeType: 1, nodeName: name.toUpperCase(), attrs: {}, children: [],
      setAttribute(key, value) { this.attrs[key] = value; },
      appendChild(child) { this.children.push(child); return child; } };
  },
  createDocumentFragment() { return { nodeType: 11, children: [], appendChild(child) { this.children.push(child); return child; } }; },
  createTextNode(text) { return { nodeType: 3, text }; },
};
function clipboardElements(root, name) {
  return [root, ...(root.children || []).flatMap((child) => clipboardElements(child, name))]
    .filter((node) => node.nodeName === name);
}
const imageClipboard = imageChecks.createImageClipboardSerializer(imageOptions, () => ({}));
for (let copy = 0; copy < 2; copy += 1) {
  const copied = imageClipboard.serializeFragment(crowdedImages.content, { document: clipboardDocument });
  const images = clipboardElements(copied, 'IMG');
  assert.equal(images.length, 64, 'nested paragraphs share one clipboard budget, reset for every copy');
  assert.ok(images.every(({ attrs }) => attrs.src === 'blob:approved-image' && attrs['data-markdown-src'] === 'approved.png'));
  const placeholders = clipboardElements(copied, 'SPAN');
  assert.equal(placeholders.length, 1);
  assert.equal(placeholders[0].attrs['data-markdown-src'], 'approved.png', 'blocked clipboard images retain Markdown source');
}
const copiedUnsafe = imageClipboard.serializeFragment(unsafeImages.content, { document: clipboardDocument });
assert.equal(clipboardElements(copiedUnsafe, 'IMG').length, 0, 'copy and drag must not reintroduce raw schema image URLs');
const largeClipboard = imageChecks.createImageClipboardSerializer(largeImageOptions, () => ({}));
assert.equal(clipboardElements(largeClipboard.serializeFragment(imageDocument(5).content, { document: clipboardDocument }), 'IMG').length, 4,
  'clipboard rendering also enforces the aggregate pixel limit');
const imageNode = imageDocument(1).firstChild.firstChild;
assert.equal(imageClipboard.serializeNode(imageNode, { document: clipboardDocument }).attrs.src, 'blob:approved-image',
  'direct single-node serialization starts its own image admission budget');

const embeddedImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';
const exportImageOptions = { ...imageOptions, getImageExportSrc: url => url === 'blob:approved-image' ? embeddedImage : '' };
const embeddedClipboard = imageChecks.createImageClipboardSerializer(exportImageOptions, () => ({}));
const copiedEmbedded = embeddedClipboard.serializeFragment(crowdedImages.content, { document: clipboardDocument });
const embeddedImages = clipboardElements(copiedEmbedded, 'IMG');
assert.equal(embeddedImages.length, 64, 'portable data image output preserves the clipboard image budget');
assert.ok(embeddedImages.every(({ attrs }) => attrs.src === embeddedImage), 'approved data images remain portable outside the app');
assert.ok([...imageChecks.createImageRenderPlan(crowdedImages, exportImageOptions).values()].every(({ url }) => url === 'blob:approved-image'),
  'portable clipboard output must not change live image rendering URLs');
assert.equal(clipboardElements(embeddedClipboard.serializeFragment(unsafeImages.content, { document: clipboardDocument }), 'IMG').length, 0,
  'an export URL callback cannot bypass admission of the original image');

console.log('ProseMirror round-trip checks passed');

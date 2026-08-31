import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.window = globalThis;
globalThis.markdownit = require('../vendor/markdown-it/markdown-it.min.js');
require('../vendor/prosemirror/prosemirror-editor.js');

const proseMirror = globalThis.PMEProseMirror;
assert.ok(proseMirror, 'ProseMirror bundle should expose its public API');

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

console.log('ProseMirror round-trip checks passed');

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const requiredFiles = [
  'vendor/markdown-it/markdown-it.min.js',
  'vendor/markdown-it/LICENSE',
  'vendor/highlight/highlight.min.js',
  'vendor/highlight/styles/github-dark.min.css',
  'vendor/highlight/LICENSE',
  'vendor/mermaid/mermaid.min.js',
  'vendor/mermaid/LICENSE',
  'vendor/katex/katex.min.js',
  'vendor/katex/katex.min.css',
  'vendor/katex/fonts',
  'vendor/katex/LICENSE',
  'vendor/codemirror6/node_modules',
  'vendor/codemirror6/import-map.json',
  'vendor/codemirror6/package-lock.json',
  'vendor/codemirror6/source-editor.js',
  'vendor/codemirror6/source-editor.bundle.js',
  'vendor/prosemirror/prosemirror-editor.js',
  'vendor/prosemirror/editor-integration.js',
  'vendor/prosemirror/package-lock.json',
  'vendor/prosemirror/licenses',
  'tools/bundle-prosemirror-cjs.mjs',
  'docs/third-party-licenses.md',
];

for (const file of requiredFiles) {
  assert.ok(existsSync(new URL(`../${file}`, import.meta.url)), `${file} must exist`);
}

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const app = [
  readFileSync(new URL('../app.js', import.meta.url), 'utf8'),
  readFileSync(new URL('../modules/markdown-renderer.js', import.meta.url), 'utf8'),
  readFileSync(new URL('../modules/rich-editor.js', import.meta.url), 'utf8'),
  readFileSync(new URL('../modules/rich-input-controller.js', import.meta.url), 'utf8'),
  readFileSync(new URL('../modules/file-manager.js', import.meta.url), 'utf8'),
  readFileSync(new URL('../modules/shortcut-manager.js', import.meta.url), 'utf8'),
].join('\n');
const licenses = readFileSync(new URL('../docs/third-party-licenses.md', import.meta.url), 'utf8');

assert.match(index, /vendor\/markdown-it\/markdown-it\.min\.js/);
assert.match(index, /vendor\/highlight\/highlight\.min\.js/);
assert.match(index, /vendor\/highlight\/styles\/github-dark\.min\.css/);
assert.match(index, /vendor\/mermaid\/mermaid\.min\.js/);
assert.match(index, /vendor\/katex\/katex\.min\.js/);
assert.match(index, /vendor\/katex\/katex\.min\.css/);
assert.match(index, /vendor\/codemirror6\/source-editor\.bundle\.js/);
assert.doesNotMatch(index, /type="importmap"/);
assert.match(index, /vendor\/prosemirror\/prosemirror-editor\.js/);
assert.doesNotMatch(index, /https?:\/\/.*(?:markdown-it|highlight|mermaid|katex|jsdelivr|unpkg|cdnjs)/i);

assert.match(app, /window\.markdownit|window\.markdownIt/);
assert.match(app, /window\.hljs/);
assert.match(app, /window\.mermaid/);
assert.match(app, /window\.katex/);
assert.match(app, /securityLevel:\s*'strict'/);

assert.doesNotMatch(licenses, /pending/i, 'third-party license table must be finalized');
assert.match(licenses, /markdown-it/i);
assert.match(licenses, /highlight/i);
assert.match(licenses, /mermaid/i);
assert.match(licenses, /KaTeX/i);
assert.match(licenses, /CodeMirror 6/i);
assert.match(licenses, /@codemirror\/lang-markdown/i);
assert.match(licenses, /ProseMirror local bundle/i);
assert.match(licenses, /prosemirror-view/i);
assert.match(licenses, /prosemirror-markdown/i);
assert.match(licenses, /bundle-prosemirror-cjs\.mjs/);

console.log('vendor audit checks passed');

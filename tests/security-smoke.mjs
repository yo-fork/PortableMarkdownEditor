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
assert.match(index, /img-src 'self' data: blob: file:/);
assert.doesNotMatch(index, /https?:\/\/.*\.(js|css)/i, 'no external JS/CSS');

assert.doesNotMatch(app, /\beval\s*\(/, 'eval must not be used');
assert.doesNotMatch(app, /new\s+Function\b/, 'new Function must not be used');
assert.doesNotMatch(app, /\bfetch\s*\(/, 'fetch must not be used');
assert.doesNotMatch(app, /XMLHttpRequest/, 'XHR must not be used');

assert.match(app, /function\s+sanitizeLinkUrl/);
assert.match(app, /function\s+sanitizeImageUrl/);
assert.match(app, /function\s+normalizeLocalImageUrl/);
assert.match(app, /function\s+renderMermaidBlock/);
assert.match(app, /function\s+highlightCode/);
assert.match(app, /javascript:alert\(1\)/, 'sample malicious link should exist in default markdown');
assert.match(app, /data:image\\\/\(png\|jpeg\|jpg\|gif\|webp\)/, 'only raster data images should be allowed');
assert.match(securitySample, /https:\/\/example\.com\/tracker\.png/, 'sample remote image should be tested');
assert.match(securitySample, /\\\\server\\share\\local sample\.webp/, 'UNC image sample should exist');

const instrumented = app.replace(/\}\)\(\);\s*$/, 'return { renderMarkdownHtml, sanitizeImageUrl, sanitizeLinkUrl };\n})();');
const renderer = vm.runInNewContext(instrumented, {
  document: { addEventListener() {} },
  window: {},
  localStorage: {},
  URL,
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
assert.match(rendered, /file:\/\/\/Z:\/share\/local%20sample\.webp/, 'Windows drive images should render as file URLs');
assert.match(rendered, /blocked-image/, 'remote images should remain blocked');
assert.equal(renderer.sanitizeLinkUrl('javascript:alert(1)'), '');
assert.equal(renderer.sanitizeImageUrl('https://example.com/a.png'), '');
assert.equal(renderer.sanitizeImageUrl(uncPath), 'file://server/share/local%20sample.webp');

console.log('security smoke checks passed');

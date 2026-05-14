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
assert.match(app, /pme_task_lists/, 'markdown-it task list extension should be enabled');
assert.match(index, /id="codeLanguageOptions"/, 'code language suggestion list should exist');
assert.match(app, /code-language-input/, 'rendered code blocks should expose a language input');

const instrumented = app.replace(/\}\)\(\);\s*$/, 'return { renderMarkdownHtml, sanitizeImageUrl, sanitizeLinkUrl, state };\n})();');
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
assert.match(rendered, /<svg class="mermaid-svg"[^>]+width="\d+"[^>]+height="\d+"/, 'mermaid SVG should have explicit dimensions');
assert.match(rendered, /file:\/\/\/Z:\/share\/local%20sample\.webp/, 'Windows drive images should render as file URLs');
assert.match(rendered, /blocked-image/, 'remote images should remain blocked');
assert.equal(renderer.sanitizeLinkUrl('javascript:alert(1)'), '');
assert.equal(renderer.sanitizeImageUrl('https://example.com/a.png'), '');
assert.equal(renderer.sanitizeImageUrl(uncPath), 'file://server/share/local%20sample.webp');

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

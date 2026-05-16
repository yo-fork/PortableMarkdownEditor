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
assert.match(index, /img-src 'self' data: blob: file:/);
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
assert.match(rendered, /mermaid-flow-node-label/, 'local flowchart labels should use readable flowchart text styling');
assert.match(rendered, /file:\/\/\/Z:\/share\/local%20sample\.webp/, 'Windows drive images should render as file URLs');
assert.match(rendered, /blocked-image/, 'remote images should remain blocked');
assert.equal(renderer.sanitizeLinkUrl('javascript:alert(1)'), '');
assert.equal(renderer.sanitizeImageUrl('https://example.com/a.png'), '');
assert.equal(renderer.sanitizeImageUrl(uncPath), 'file://server/share/local%20sample.webp');

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

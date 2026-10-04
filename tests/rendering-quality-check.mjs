import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const MarkdownIt = require('../vendor/markdown-it/markdown-it.min.js');
const katex = require('../vendor/katex/katex.min.js');

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const tablePolicyModule = readFileSync(new URL('../modules/table-policy.js', import.meta.url), 'utf8');
const markdownRendererModule = readFileSync(new URL('../modules/markdown-renderer.js', import.meta.url), 'utf8');
const richEditorModule = readFileSync(new URL('../modules/rich-editor.js', import.meta.url), 'utf8');
const richInputControllerModule = readFileSync(new URL('../modules/rich-input-controller.js', import.meta.url), 'utf8');
const fileManagerModule = readFileSync(new URL('../modules/file-manager.js', import.meta.url), 'utf8');
const shortcutManagerModule = readFileSync(new URL('../modules/shortcut-manager.js', import.meta.url), 'utf8');
const appRuntime = `${app}\n${markdownRendererModule}\n${richEditorModule}\n${richInputControllerModule}\n${fileManagerModule}\n${shortcutManagerModule}`;
const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const extraGallery = readFileSync(new URL('../samples/mermaid-extra-gallery.md', import.meta.url), 'utf8');
const advancedGallery = readFileSync(new URL('../samples/mermaid-advanced-gallery.md', import.meta.url), 'utf8');
const mathGallery = readFileSync(new URL('../samples/math-syntax-gallery.md', import.meta.url), 'utf8');
const instrumented = app.replace(/\}\)\(\);\s*$/, 'return { renderMarkdownHtml, renderBlockHtml, renderInlineMarkdown, buildExportHtml, createMathRenderSession, getRichCodeHighlight };\n})();');
function createRenderer(useVendor = true, mathEngine = katex) {
  const context = vm.createContext({
    document: { baseURI: 'file:///C:/PortableMarkdownEditor/index.html', addEventListener() {} },
    window: useVendor ? { markdownit: MarkdownIt, katex: mathEngine } : {},
    localStorage: {},
    URL,
    Blob,
    navigator: {},
    confirm() { return true; },
    prompt() { return ''; },
    alert() {},
    console,
  });
  vm.runInContext(readFileSync(new URL('../modules/document-policy.js', import.meta.url), 'utf8'), context);
  vm.runInContext(tablePolicyModule, context);
  vm.runInContext(readFileSync(new URL('../modules/image-policy.js', import.meta.url), 'utf8'), context);
  vm.runInContext(markdownRendererModule, context);
  vm.runInContext(richEditorModule, context);
  vm.runInContext(richInputControllerModule, context);
  vm.runInContext(fileManagerModule, context);
  vm.runInContext(shortcutManagerModule, context);
  const renderer = vm.runInContext(instrumented, context);
  return { renderer, context };
}
const { renderer } = createRenderer();

for (const useVendor of [false, true]) {
  const { renderer: tableRenderer } = createRenderer(useVendor);
  for (const [columns, rows, allowed] of [[64, 64, true], [16, 256, true], [65, 2, false], [2, 257, false], [64, 65, false], [128, 129, false]]) {
    const source = ['|' + Array(columns).fill('h').join('|') + '|',
      '|' + Array(columns).fill('---').join('|') + '|', ...Array(rows - 1).fill('|')].join('\n');
    for (const references of ['', '\n\n[guide]: #guide']) {
      const html = tableRenderer.renderMarkdownHtml(source + references);
      assert.equal((html.match(/<t[dh][ >]/g) || []).length, allowed ? columns * rows : 0, 'custom table cell product is bounded before rendering');
      assert.equal(html.includes('table-render-limit'), !allowed);
      if (!allowed) {
        assert.ok(html.includes(source), 'the entire over-budget source remains visible as text');
        assert.ok(html.length < source.length * 2 + 1000, 'fallback output scales with source, not the cell product');
        assert.doesNotMatch(tableRenderer.buildExportHtml(source), /<table/);
      }
    }
  }
  const mismatch = '|' + 'h|'.repeat(65) + '\n|---|---|\n|';
  assert.doesNotMatch(tableRenderer.renderMarkdownHtml(mismatch), /<table/, 'custom tables use actual header width even if delimiter width differs');
  const hostile = '|' + '<script>|'.repeat(65) + '\n|' + '---|'.repeat(65) + '\n|';
  assert.doesNotMatch(tableRenderer.renderMarkdownHtml(hostile), /<script>|<table/);
  assert.match(tableRenderer.renderMarkdownHtml(hostile), /&lt;script&gt;/);
}

function inlineTable(cell, references = false) {
  return `| content | control |\n| --- | --- |\n| ${cell} | still visible |${references ? '\n\n[guide]: #guide' : ''}`;
}

for (const useVendor of [false, true]) {
  const { renderer: inlineRenderer, context } = createRenderer(useVendor);
  const renderCell = (source, references = false) => inlineRenderer.renderMarkdownHtml(inlineTable(source, references));
  // Count scanned characters, not elapsed time, so quadratic restoration fails deterministically.
  vm.runInContext(`
    globalThis.scanWork = 0;
    for (const method of ['replace', 'replaceAll']) {
      const original = String.prototype[method];
      String.prototype[method] = function (...args) {
        globalThis.scanWork += this.length;
        return original.apply(this, args);
      };
    }
  `, context);
  const scanSamples = [];
  for (const count of [1000, 2000, 4000]) {
    context.scanWork = 0;
    const html = renderCell('`a` '.repeat(count));
    assert.equal((html.match(/<code>a<\/code>/g) || []).length, count, 'dense table code spans render completely');
    scanSamples.push(context.scanWork);
  }
  assert.ok(scanSamples[1] < scanSamples[0] * 2.5 && scanSamples[2] < scanSamples[1] * 2.5,
    `table string scans must scale linearly (vendor=${useVendor}): ${scanSamples}`);
  console.log(`inline scan work (vendor=${useVendor}, 1000/2000/4000 spans): ${scanSamples.join('/')}`);

  for (const references of [false, true]) {
    for (const construct of ['`a` ', '[a](#a) ', '![a](missing.png) ']) {
      assert.doesNotMatch(renderCell(construct.repeat(4096), references), /inline-render-limit/, 'the token limit remains inclusive');
      const limited = renderCell(construct.repeat(4097), references);
      assert.match(limited, /inline-render-limit/, 'too many inline constructs produce a visible notice');
      assert.match(limited, /still visible/, 'other table cells remain visible');
      assert.doesNotMatch(limited, /<code>|<img |<a /, 'over-budget inline content is omitted as a whole');
    }
    assert.doesNotMatch(renderCell('a'.repeat(200000), references), /inline-render-limit/, 'the source limit remains inclusive');
    assert.match(renderCell('a'.repeat(200001), references), /inline-render-limit/, 'oversized plain source is bounded');
    assert.match(renderCell(('`' + '"'.repeat(42) + '` ').repeat(4000), references), /inline-render-limit/,
      'escaping amplification cannot exceed the generated HTML budget');
    assert.match(renderCell('`' + '"'.repeat(180000) + '`', references), /inline-render-limit/,
      'a single oversized generated fragment is bounded');
  }
  const literals = renderCell('§§PME0§§ §§PME00§§ `§§PME1§§` `b` `$&` `$1` `$\'`');
  assert.match(literals, /§§PME0§§ §§PME00§§ <code>§§PME1§§<\/code> <code>b<\/code>/,
    'literal marker syntax never impersonates tokens or recursively expands generated fragments');
  assert.match(literals, /<code>\$&amp;<\/code> <code>\$1<\/code> <code>\$&#39;<\/code>/,
    'replacement-string dollar patterns remain literal code');
  for (const prefix of ['§§PME1', '§§PME999', '§§PME0:', '§§PME0:0§§ §§PME1:', '§§PME00:']) {
    assert.ok(renderCell(prefix + '`a` `b`').includes(prefix + '<code>a</code> <code>b</code>'),
      'partial or complete source markers must not consume adjacent generated tokens');
  }
  const mixed = renderCell('**bold** `code` [ok](#here) [blocked](javascript:alert) ![image](missing.png) $x$<br>next');
  assert.match(mixed, /<strong>bold<\/strong> <code>code<\/code>/);
  assert.match(mixed, /<a href="#here"/);
  assert.match(mixed, /class="blocked-link"/);
  assert.match(mixed, /class="blocked-image"/);
  assert.match(mixed, /class="math-inline"/);
  assert.match(mixed, /<br>next/);
  if (useVendor) assert.match(renderCell('[guide][guide]', true), /<a href="#guide"[^>]*>guide<\/a>/,
    'reference links retain vendor resolution in custom table cells');
}

// Exercise every math budget independently, without spending time on expensive output.
function mathBudgetHarness(html = '<span>x</span>') {
  let calls = 0;
  const { renderer } = createRenderer(true, { renderToString(_source, options) {
    calls += 1;
    assert.equal(options.trust, false);
    assert.equal(options.maxExpand, 1000);
    return html;
  } });
  return { renderer, get calls() { return calls; } };
}

{
  const harness = mathBudgetHarness();
  const tooLong = harness.renderer.createMathRenderSession();
  assert.equal(tooLong.render('x'.repeat(4097), false), null);
  assert.equal(harness.calls, 0, 'oversized expressions are rejected before KaTeX');
  assert.equal(tooLong.render('x', false), null, 'exhaustion remains sticky');
  const aggregate = harness.renderer.createMathRenderSession();
  for (let i = 0; i < 8; i += 1) assert.equal(typeof aggregate.render('x'.repeat(4096), false), 'string');
  assert.equal(aggregate.render('x', false), null, 'aggregate source exceeds 32768 characters');
  const count = harness.renderer.createMathRenderSession();
  for (let i = 0; i < 256; i += 1) assert.equal(typeof count.render('x', false), 'string');
  assert.equal(count.render('x', false), null, 'cached expressions still consume the expression budget');
  assert.equal(harness.calls, 2, 'bounded cache reuses the two expression sources across sessions');
}

for (const [name, html, expected] of [
  ['output', '<span>' + 'x'.repeat(49000) + '</span>', 20],
  ['nodes', '<i></i>'.repeat(200), 24],
]) {
  const harness = mathBudgetHarness(html);
  for (const copies of [1, 2]) {
    const session = harness.renderer.createMathRenderSession();
    let accepted = 0;
    while (session.render('x', false, copies) !== null) accepted += 1;
    assert.equal(accepted, Math.floor(expected / copies), `${name} budget includes hidden copies`);
    assert.equal(session.exhausted, true);
  }
  assert.equal(harness.calls, 1, 'cached output does not bypass per-session DOM/output accounting');
}

for (const html of ['x'.repeat(100001), '<i></i>'.repeat(1000)]) {
  const harness = mathBudgetHarness(html);
  const session = harness.renderer.createMathRenderSession();
  assert.equal(session.render('x', false), null, 'oversized single output is rejected before HTML parsing');
  assert.equal(session.render('y', false), null);
  assert.equal(harness.calls, 1);
}

{
  let calls = 0;
  const { renderer: bounded } = createRenderer(true, { renderToString(...args) { calls += 1; return katex.renderToString(...args); } });
  const dense = '$x$'.repeat(1000);
  const html = bounded.renderMarkdownHtml(dense);
  assert.equal((html.match(/class="katex"/g) || []).length, 256);
  assert.equal((html.match(/class="math-source"/g) || []).length, 744);
  assert.equal(calls, 1, 'adjacent identical formulas use one KaTeX computation');
  const exported = bounded.buildExportHtml(dense);
  assert.equal((exported.match(/class="katex"/g) || []).length, 256, 'HTML export obeys the same budget');
  const blocks = bounded.renderMarkdownHtml(Array.from({ length: 300 }, () => '# $x$\n\n| a | b |\n| --- | --- |\n| $x$ | ok |\n\n$$x$$').join('\n\n'));
  assert.ok((blocks.match(/class="katex"/g) || []).length <= 256, 'headings, tables and display blocks share a document budget');
  assert.match(bounded.renderMarkdownHtml('$y$'), /class="katex"/, 'a new document receives a fresh budget');
  assert.match(bounded.renderInlineMarkdown('$z$'), /class="katex"/, 'standalone fragment entry receives a fresh budget');
  const escaped = bounded.renderMarkdownHtml('$' + '<img src=x onerror=alert(1)>'.repeat(200) + '$');
  assert.match(escaped, /class="math-source"/);
  assert.doesNotMatch(escaped, /<img\b/);
  console.log(`math budget checks passed (1000 adjacent expressions: 256 rendered, ${calls} total cached computations across document/fragment checks)`);
}

const escapeCode = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const fence = (code, language = '') => '```' + language + '\n' + code + '\n```';
function highlightHarness(useVendor = true) {
  const { renderer, context } = createRenderer(useVendor);
  const calls = [];
  context.window.hljs = {
    getLanguage: language => ['js', 'python'].includes(language),
    highlight(code, options) {
      calls.push({ mode: options.language, chars: code.length });
      return { value: `<span class="hljs-keyword">${escapeCode(code)}</span>`, _emitter: { rootNode: { children: [{ scope: 'keyword', children: [code] }] } } };
    },
    highlightAuto(code) {
      calls.push({ mode: 'auto', chars: code.length });
      return { value: `<span class="hljs-auto">${escapeCode(code)}</span>` };
    },
  };
  return { renderer, context, calls };
}

for (const useVendor of [false, true]) {
  for (const [language, limit, mode] of [['js', 120000, 'js'], ['', 16000, 'auto'], ['unknown', 16000, 'auto']]) {
    const { renderer: codeRenderer, calls } = highlightHarness(useVendor);
    const code = '<img src=x onerror=alert(1)>'.padEnd(limit + 1, 'x');
    for (const render of [
      source => codeRenderer.renderMarkdownHtml(source),
      source => codeRenderer.buildExportHtml(source),
      source => codeRenderer.renderBlockHtml({ type: 'code', raw: source }, { items: [], byOffset: new Map() }),
    ]) {
      const html = render(fence(code, language));
      assert.ok(html.includes(escapeCode(code)), 'over-budget code is kept completely as escaped plaintext');
      assert.doesNotMatch(html, /<img\b|<span class="hljs-/);
    }
    assert.equal(calls.length, 0, 'every public code boundary rejects over-budget input before vendor work');
    codeRenderer.renderMarkdownHtml(fence('x'.repeat(limit), language));
    assert.deepEqual(calls, [{ mode, chars: limit }], 'the selected highlighting limit is inclusive');
  }
}

{
  const { renderer: codeRenderer, calls } = highlightHarness();
  const code = 'const reused = 42;';
  const html = codeRenderer.renderMarkdownHtml(fence(code, 'javascript'));
  assert.match(html, /hljs-keyword/);
  assert.ok(codeRenderer.getRichCodeHighlight(code, 'language-JavaScript')?.rootNode, 'rich decorations share the normalized token tree');
  codeRenderer.renderMarkdownHtml(fence(code, 'js'));
  codeRenderer.buildExportHtml(fence(code, 'js'));
  assert.deepEqual(calls, [{ mode: 'js', chars: code.length }], 'preview, repeated roots, rich and export reuse one expensive result');
  assert.equal(codeRenderer.getRichCodeHighlight(code, ''), null);
  assert.equal(codeRenderer.getRichCodeHighlight(code, 'unknown'), null);
  codeRenderer.renderMarkdownHtml(fence(code));
  assert.equal(calls.at(-1).mode, 'auto', 'rich plaintext policy must not suppress preview auto-detection');
  assert.equal(codeRenderer.getRichCodeHighlight(code, 'unknown'), null, 'cached auto output must not enable rich auto-detection');
  assert.equal(codeRenderer.getRichCodeHighlight('x'.repeat(120001), 'js'), null, 'rich uses the shared size guard');
  const before = calls.length;
  codeRenderer.renderMarkdownHtml('[r]: #r\n~~~js\n' + 'x'.repeat(120001) + '\n~~~');
  assert.equal(calls.length, before, 'markdown-it fence rendering also obeys the shared guard');
  codeRenderer.renderMarkdownHtml('[r]: #r\n~~~js\nconst nested = 2;\n~~~');
  assert.equal(calls.length, before + 1, 'the alternate vendor fence path still highlights ordinary code');
}

for (const useVendor of [false, true]) {
  const { renderer: fallback, context } = createRenderer(useVendor);
  const allowed = '//' + 'x'.repeat(119998);
  assert.match(fallback.renderMarkdownHtml(fence(allowed, 'js')), /tok-comment/, 'fallback highlighting works at its limit');
  assert.doesNotMatch(fallback.renderMarkdownHtml(fence(allowed + 'x', 'js')), /tok-comment/, 'fallback uses the same size guard');
  context.window.hljs = { getLanguage() { throw new Error('test lookup error'); } };
  assert.ok(fallback.renderMarkdownHtml(fence('<tag>', 'js')).includes('&lt;tag&gt;'), 'vendor lookup errors fail to escaped plaintext');
  context.window.hljs = { getLanguage: () => true, highlight() { throw new Error('test render error'); } };
  assert.ok(fallback.renderMarkdownHtml(fence('<tag>', 'js')).includes('&lt;tag&gt;'), 'vendor render errors preserve code safely');
}

{
  const { renderer: codeRenderer, context, calls } = highlightHarness();
  for (let index = 0; index < 17; index += 1) codeRenderer.renderMarkdownHtml(fence(`const n = ${index};`, 'js'));
  codeRenderer.renderMarkdownHtml(fence('const n = 0;', 'js'));
  assert.equal(calls.length, 18, 'old entries are evicted from the bounded result cache');
  context.window.hljs = { ...context.window.hljs };
  codeRenderer.renderMarkdownHtml(fence('const n = 0;', 'js'));
  assert.equal(calls.length, 19, 'a replaced vendor runtime cannot reuse stale token results');
}
console.log('highlight budget checks passed (vendor/fallback, exact boundaries, alternate fences, shared rich cache)');

function renderMermaid(source) {
  return renderer.renderMarkdownHtml([
    '```mermaid',
    source.trim(),
    '```',
  ].join('\n'));
}

function attr(markup, selectorClass, attrName, text) {
  const escapedClass = selectorClass.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedText = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = markup.match(new RegExp(`<text class="${escapedClass}"([^>]*)>${escapedText}<\\/text>`));
  if (!match) return null;
  const attrMatch = match[1].match(new RegExp(`${attrName}="([^"]+)"`));
  return attrMatch?.[1] ?? null;
}

function numericAttr(markup, selectorClass, attrName, text) {
  const value = attr(markup, selectorClass, attrName, text);
  assert.ok(value, `${text} should have ${attrName}`);
  return Number(value);
}

const referenceLink = renderer.renderMarkdownHtml([
  'See [the guide][guide].',
  '',
  '[guide]: #guide "Guide"',
  '[unused]: #unused',
].join('\n'));
assert.match(referenceLink, /<a href="#guide"[^>]*>the guide<\/a>/, 'reference links should resolve across separately rendered source blocks');
assert.doesNotMatch(referenceLink, /\[guide\]:|\[unused\]:/, 'reference definition lines should not render as paragraph text');

const loop = renderMermaid(`
flowchart TD
  A[Markdownを書く] --> B{プレビュー}
  B -->|OK| C[保存]
  B -->|修正| A
`);
assert.match(loop, /viewBox="0 0 760 /, 'loop flowchart keeps a wide enough viewBox');
assert.ok(numericAttr(loop, 'mermaid-edge-label', 'x', '修正') > 80, 'backward edge label stays inside the SVG');
assert.ok(numericAttr(loop, 'mermaid-edge-label', 'x', 'OK') > 0, 'forward edge label is positioned');

const branch = renderMermaid(`
flowchart TD
  A[Markdownを書く] --> B{安全にプレビュー}
  B -->|OK| C[保存]
  B -->|確認| D[修正]
`);
const okX = numericAttr(branch, 'mermaid-edge-label', 'x', 'OK');
const confirmX = numericAttr(branch, 'mermaid-edge-label', 'x', '確認');
assert.notEqual(okX, confirmX, 'branch labels use separate x positions');
assert.match(branch, /mermaid-flow-node-label/, 'flowchart node labels use readable styling');

const lr = renderMermaid(`
flowchart LR
  A[入力] --> B{検証}
  B -->|OK| C[保存]
  B -->|NG| D[修正]
`);
assert.match(lr, /aria-label="Mermaid flowchart"/, 'LR flowchart renders as SVG');
const lrOkY = numericAttr(lr, 'mermaid-edge-label', 'y', 'OK');
const lrNgY = numericAttr(lr, 'mermaid-edge-label', 'y', 'NG');
assert.ok(lrOkY > 0, 'LR OK label is positioned');
assert.ok(lrNgY > 0, 'LR NG label is positioned');
assert.notEqual(lrOkY, lrNgY, 'LR branch labels should not overlap at the same y position');

const sequence = renderMermaid(`
sequenceDiagram
  participant U as User
  participant E as Editor
  U->>E: Markdownを書く
  E-->>U: Preview
  Note over U,E: local only
`);
assert.match(sequence, /mermaid-sequence/, 'sequence diagram renders locally');
assert.match(sequence, /viewBox="0 0 760 /, 'sequence diagram keeps a readable minimum width');
assert.match(sequence, />User</, 'sequence participant label User renders');
assert.match(sequence, />Editor</, 'sequence participant label Editor renders');
assert.doesNotMatch(sequence, />E-</, 'return arrows do not create a bogus E- participant');
assert.match(sequence, />Markdownを書く</, 'sequence forward message renders');
assert.match(sequence, />Preview</, 'sequence return message renders');
assert.match(sequence, />local only</, 'sequence note renders');

const unsupported = renderMermaid(`
mindmap
  root((Markdown))
    Mermaid
    KaTeX
`);
assert.match(unsupported, /mermaid-fallback/, 'unsupported local Mermaid syntax falls back when the bundle is unavailable');
assert.match(unsupported, /mindmap/, 'fallback keeps escaped Mermaid source visible');

const mathBlocks = renderer.renderMarkdownHtml([
  '$$x+1$$',
  '',
  '$$',
  '\\int_0^1 x^2 dx = \\frac{1}{3}',
  '$$',
].join('\n'));
assert.match(mathBlocks, /class="math-display"/, 'display math blocks render as dedicated math containers');
assert.match(mathBlocks, /data-math-source="x\+1"/, 'single-line display math preserves its source');
assert.match(mathBlocks, /data-math-source="\\int_0\^1 x\^2 dx = \\frac\{1\}\{3\}"/, 'multi-line display math preserves its source');
assert.doesNotMatch(mathBlocks, /<p><div class="math-display"/, 'display math should not be nested inside a paragraph');

const inlineMath = renderer.renderMarkdownHtml(String.raw`Dollar $E=mc^2$ and paren \(a^2+b^2=c^2\).`);
assert.equal((inlineMath.match(/class="math-inline"/g) || []).length, 2, 'both inline math delimiter styles render');
assert.equal((inlineMath.match(/class="katex"/g) || []).length, 2, 'inline math is rendered by KaTeX before DOM post-processing');
assert.match(inlineMath, /data-math-source="E=mc\^2"/, 'dollar inline math preserves its source');
assert.match(inlineMath, /data-math-source="a\^2\+b\^2=c\^2"/, 'paren inline math preserves its source');

const escapedDollarInlineMath = renderer.renderMarkdownHtml(String.raw`価格は $\$$。`);
assert.equal((escapedDollarInlineMath.match(/class="math-inline"/g) || []).length, 1, 'an escaped literal dollar should remain inside one inline formula');
assert.ok(escapedDollarInlineMath.includes(String.raw`data-math-source="\$"`), 'an escaped literal dollar should keep exactly one backslash in rendered source metadata');

const emptyInlineMath = renderer.renderMarkdownHtml(String.raw`空の式 \(\)`);
assert.equal((emptyInlineMath.match(/class="math-inline"/g) || []).length, 1, 'empty parenthesis delimiters should remain an inline formula instead of becoming display math');
assert.match(emptyInlineMath, /data-math-source=""/, 'empty inline math should preserve an empty source value');

const adjacentInlineMath = renderer.renderMarkdownHtml('$x$$y$');
assert.equal((adjacentInlineMath.match(/class="math-inline"/g) || []).length, 2, 'adjacent dollar-delimited formulas should render as two formulas');
assert.match(adjacentInlineMath, /data-math-source="x"/, 'the first adjacent formula should retain its own source');
assert.match(adjacentInlineMath, /data-math-source="y"/, 'the second adjacent formula should retain its own source');

const headingMath = renderer.renderMarkdownHtml('# 物理の見出し $E=mc^2$');
assert.match(headingMath, /<h1[^>]*>物理の見出し <span class="math-inline"[^>]*><span class="katex"/, 'inline math should render through KaTeX inside headings');

const tableMath = renderer.renderMarkdownHtml([
  '| 種別 | 数式 |',
  '| --- | --- |',
  '| エネルギー | $E=mc^2$ |',
  '| 絶対値 | $|x|$ |',
].join('\n'));
assert.equal((tableMath.match(/class="math-inline"/g) || []).length, 2, 'inline math should render in table cells even when the LaTeX contains pipe characters');
assert.equal((tableMath.match(/class="katex"/g) || []).length, 2, 'table-cell math should be rendered by KaTeX');
assert.match(tableMath, /<td[^>]*><span class="math-inline"[^>]*data-math-source="\|x\|"/, 'table-cell math should preserve formula pipes as LaTeX instead of treating them as column separators');

const nonMath = renderer.renderMarkdownHtml('Price \\$100 and code `$raw$`.');
assert.equal((nonMath.match(/class="math-inline"/g) || []).length, 0, 'escaped dollars and code spans do not become math');
assert.match(nonMath, /<code>\$raw\$<\/code>/, 'code spans preserve math-looking text');

const mathGalleryRendered = renderer.renderMarkdownHtml(mathGallery);
assert.equal((mathGalleryRendered.match(/class="math-inline"/g) || []).length, 6, 'math gallery covers inline delimiters, heading math, and table-cell math');
assert.equal((mathGalleryRendered.match(/class="math-display"/g) || []).length, 4, 'math gallery covers one-line and multiline display delimiter styles');
assert.ok((mathGalleryRendered.match(/class="katex"/g) || []).length >= 10, 'all gallery formulas render through KaTeX');

const consecutiveMathBlocks = renderer.renderMarkdownHtml([
  '## KaTeX display',
  '',
  '$$',
  '\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}',
  '$$',
  '',
  '$$',
  '\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}',
  '$$',
  '',
  '## Mermaid flowchart TD',
  '',
  '```mermaid',
  'flowchart TD',
  '  A[Markdownを書く] --> B{安全にプレビュー}',
  '  B -->|OK| C[保存]',
  '```',
].join('\n'));
assert.equal((consecutiveMathBlocks.match(/class="math-display"/g) || []).length, 2, 'standalone $$ close lines split consecutive display math blocks');
assert.match(consecutiveMathBlocks, /<h2[^>]*>Mermaid flowchart TD<\/h2>/, 'heading after display math remains a heading');
assert.match(consecutiveMathBlocks, /class="[^"]*mermaid-diagram/, 'Mermaid fence after display math remains a Mermaid block');
assert.doesNotMatch(consecutiveMathBlocks, /data-math-source="[^"]*Mermaid flowchart TD/, 'display math must not consume following Markdown blocks');

assert.match(appRuntime, /function\s+normalizeSvgMarkupForParsing/, 'Mermaid SVG normalization should protect xlink parsing');
assert.match(appRuntime, /function\s+polishMermaidTimeline/, 'timeline diagrams should receive readable color polish');
assert.match(appRuntime, /function\s+polishMermaidSankey/, 'sankey diagrams should receive readable color polish');
assert.match(appRuntime, /function\s+polishMermaidPacket/, 'packet diagrams should receive readable color polish');
assert.match(appRuntime, /function\s+polishMermaidC4/, 'C4 diagrams should receive SVG safety/readability polish');
assert.match(appRuntime, /function\s+replaceUnsafeC4Images/, 'C4 diagrams should replace sanitized image icons with safe local SVG shapes');
assert.match(appRuntime, /function\s+repositionMermaidC4RelationshipLabels/, 'C4 relationship labels should be moved into readable gaps');
assert.match(appRuntime, /function\s+mermaidViewBoxWidth/, 'Mermaid zoom sizing should use the rendered SVG viewBox when available');
assert.match(styles, /--mermaid-sequence-number-bg:/, 'sequence autonumber badges should define a theme-aware background');
assert.match(styles, /--mermaid-sequence-number-text:/, 'sequence autonumber badges should define a theme-aware text color');
assert.match(styles, /\.mermaid-svg\s+\[id\$="-sequencenumber"\][\s\S]*fill:\s*var\(--mermaid-sequence-number-bg\)\s*!important/, 'sequence autonumber marker should use the readable theme background');
assert.match(styles, /\.mermaid-svg\s+\.sequenceNumber[\s\S]*fill:\s*var\(--mermaid-sequence-number-text\)\s*!important/, 'sequence autonumber text should use the readable theme text color');
assert.match(extraGallery, /timeline/, 'extra Mermaid gallery should include timeline');
assert.match(extraGallery, /sankey-beta/, 'extra Mermaid gallery should include sankey');
assert.match(extraGallery, /packet-beta/, 'extra Mermaid gallery should include packet');
assert.match(extraGallery, /C4Context/, 'extra Mermaid gallery should include C4');
assert.match(advancedGallery, /sequenceDiagram/, 'advanced Mermaid gallery should include sequence diagrams');
assert.match(advancedGallery, /stateDiagram-v2/, 'advanced Mermaid gallery should include state diagrams');
assert.match(advancedGallery, /classDiagram/, 'advanced Mermaid gallery should include class diagrams');
assert.match(advancedGallery, /erDiagram/, 'advanced Mermaid gallery should include ER diagrams');
assert.match(advancedGallery, /journey/, 'advanced Mermaid gallery should include journey diagrams');
assert.match(advancedGallery, /gantt/, 'advanced Mermaid gallery should include gantt diagrams');
assert.match(advancedGallery, /pie showData/, 'advanced Mermaid gallery should include pie diagrams');
assert.match(advancedGallery, /mindmap/, 'advanced Mermaid gallery should include mindmap diagrams');
assert.match(advancedGallery, /gitGraph/, 'advanced Mermaid gallery should include git graph diagrams');

console.log('rendering quality checks passed');

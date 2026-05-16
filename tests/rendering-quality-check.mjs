import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const extraGallery = readFileSync(new URL('../samples/mermaid-extra-gallery.md', import.meta.url), 'utf8');
const advancedGallery = readFileSync(new URL('../samples/mermaid-advanced-gallery.md', import.meta.url), 'utf8');
const instrumented = app.replace(/\}\)\(\);\s*$/, 'return { renderMarkdownHtml };\n})();');
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

assert.match(app, /function\s+normalizeSvgMarkupForParsing/, 'Mermaid SVG normalization should protect xlink parsing');
assert.match(app, /function\s+polishMermaidTimeline/, 'timeline diagrams should receive readable color polish');
assert.match(app, /function\s+polishMermaidSankey/, 'sankey diagrams should receive readable color polish');
assert.match(app, /function\s+polishMermaidPacket/, 'packet diagrams should receive readable color polish');
assert.match(app, /function\s+polishMermaidC4/, 'C4 diagrams should receive SVG safety/readability polish');
assert.match(app, /function\s+replaceUnsafeC4Images/, 'C4 diagrams should replace sanitized image icons with safe local SVG shapes');
assert.match(app, /function\s+repositionMermaidC4RelationshipLabels/, 'C4 relationship labels should be moved into readable gaps');
assert.match(app, /function\s+mermaidViewBoxWidth/, 'Mermaid zoom sizing should use the rendered SVG viewBox when available');
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

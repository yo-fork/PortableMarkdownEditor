import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { patchVendor } from '../tools/vendor-security-patches.mjs';

// A regression must fail within a bounded worker even if a synchronous vendor
// loop stops terminating. No external packages, browser profile, or network.
if (!process.argv.includes('--worker')) {
  const result = spawnSync(process.execPath, ['--max-old-space-size=256', fileURLToPath(import.meta.url), '--worker'],
    { encoding: 'utf8', timeout: 45000, maxBuffer: 100000 });
  process.stdout.write(result.stdout || '');
  assert.equal(result.error, undefined, `resource regression worker: ${result.error}`);
  assert.equal(result.status, 0, (result.stderr || '').slice(-5000));
  console.log('security resource checks passed (bounded worker)');
} else {
  try { await checks(); }
  catch (error) { console.error(error.message, '\n', error.stack?.split('\n').slice(-5).join('\n')); process.exitCode = 1; }
}

async function checks() {
  const require = createRequire(import.meta.url);
  const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
  const MarkdownIt = require('../vendor/markdown-it/markdown-it.min.js');
  const katex = require('../vendor/katex/katex.min.js');
  const sandbox = { console, URL, Blob, navigator: {}, localStorage: {},
    document: { baseURI: 'file:///C:/PortableMarkdownEditor/index.html', addEventListener() {} },
    confirm() { return true; }, prompt() { return ''; }, alert() {} };
  sandbox.window = { markdownit: MarkdownIt, katex };
  const context = vm.createContext(sandbox);
  for (const file of ['document-policy', 'table-policy', 'image-policy', 'markdown-renderer', 'rich-editor', 'rich-input-controller', 'file-manager', 'shortcut-manager']) {
    vm.runInContext(read('modules/' + file + '.js'), context);
  }
  const renderer = vm.runInContext(read('app.js').replace(/\}\)\(\);\s*$/,
    'return {renderMarkdownHtml, renderInlineMarkdown, buildExportHtml};})();'), context);
  const cell = text => `| h |\n| --- |\n| ${text} |`;
  for (const text of ['[a](' + '('.repeat(40000), '[a](' + 'a('.repeat(20000), '[a](' + 'a'.repeat(80000), '\\('.repeat(20000), '$x '.repeat(20000)]) {
    const html = renderer.renderMarkdownHtml(cell(text));
    assert.ok(html.length < text.length * 8 + 2000, 'unclosed inline input stays bounded');
  }
  const normal = renderer.renderMarkdownHtml(cell('[page](guide.md) ![alt](missing.png) $x$ \\(y\\) [p](a(b)c)'));
  assert.match(normal, /href="guide.md"/);
  assert.match(normal, /href="a\(b\)c"/);
  assert.match(normal, /math-inline/);
  for (const references of ['', '\n\n[ref]: #ok']) {
    const toc = '[toc]\n\n'.repeat(65) + Array.from({ length: 65 }, (_, i) => '# H' + i).join('\n\n') + references;
    const html = renderer.renderMarkdownHtml(toc);
    assert.match(html, /toc-render-limit/);
    assert.equal((html.match(/class="toc"/g) || []).length, 0);
    assert.ok(html.length < 50000);
    const longHeading = '[toc]\n\n'.repeat(4) + '# ' + 'H'.repeat(30000) + references;
    assert.match(renderer.renderMarkdownHtml(longHeading), /toc-render-limit/);
    assert.match(renderer.buildExportHtml(toc), /toc-render-limit/);
  }
  assert.match(renderer.renderMarkdownHtml('[toc]\n\n# One\n\n## Two'), /href="#one"/);
  console.log('inline targets, unmatched math, TOC budgets and normal links/math/TOC passed');

  globalThis.window = globalThis;
  globalThis.markdownit = MarkdownIt;
  require('../modules/document-policy.js');
require('../modules/table-policy.js');
  require('../modules/image-policy.js');
  require('../vendor/prosemirror/prosemirror-editor.js');
  const pm = globalThis.PMEProseMirror;
  for (const source of ['**a' + ' '.repeat(80000) + '**', '**a' + '\u00a0'.repeat(20000) + '**', 'x' + '  \n'.repeat(12000), '\\('.repeat(20000), '$x '.repeat(20000)]) {
    assert.ok(pm.normalizeMarkdown(source).length < source.length * 8 + 100);
  }
  assert.equal(pm.normalizeMarkdown('**a b** and *c*'), '**a b** and *c*');
  assert.match(pm.normalizeMarkdown('a  \nb'), /a\\\nb/);
  for (const newline of ['\u2028', '\u2029']) {
    assert.equal(pm.normalizeMarkdown('**a ' + newline + '**'), '**a** ' + newline, 'marked Unicode line endings are retained');
  }
  const md = pm.modules.markdown;
  const schema = md.defaultMarkdownParser.schema;
  const marked = schema.nodes.doc.create(null, schema.nodes.paragraph.create(null,
    schema.text('a' + ' '.repeat(80000) + 'z', [schema.marks.strong.create()])));
  assert.equal(md.defaultMarkdownSerializer.serialize(marked), '**a' + ' '.repeat(80000) + 'z**');
  const breaks = schema.nodes.paragraph.create(null, [schema.text('x'),
    ...Array.from({ length: 12000 }, () => schema.nodes.hard_break.create())]);
  let childReads = 0;
  const originalChild = breaks.child;
  breaks.child = function(index) { childReads++; return originalChild.call(this, index); };
  assert.equal(md.defaultMarkdownSerializer.serialize(schema.nodes.doc.create(null, breaks)), 'x');
  assert.ok(childReads < 48000, 'trailing hard_break serialization reads children only linearly: ' + childReads);
  const middleBreaks = schema.nodes.paragraph.create(null, [schema.text('x'), schema.nodes.hard_break.create(),
    schema.nodes.hard_break.create(), schema.text('y')]);
  assert.equal(md.defaultMarkdownSerializer.serialize(schema.nodes.doc.create(null, middleBreaks)), 'x\\\n\\\ny');
  // Compare the linear whitespace split to the old regex on short controls,
  // including newlines inside whitespace runs. Long runs use the worker limit.
  const bundle = read('vendor/prosemirror/prosemirror-editor.js');
  const split = vm.runInNewContext(bundle.match(/var _exec3 = (\(function\(text\).*?\}\))\(node\.text\),/)[1]);
  for (const head of ['', 'a', 'a b', 'a\tb']) for (const tail of ['', ' ', '\n', ' \n ', '\r\n\n', '\u2028 ', '\u2029\tb', ' \n \n b']) {
    const value = head + tail;
    assert.deepEqual(Array.from(split(value)), Array.from(/^(.*?)(\s*)$/m.exec(value)), JSON.stringify(value));
  }
  const tableSchema = new pm.modules.model.Schema({ nodes: {
    doc: { content: 'block+' }, paragraph: { content: 'text*', group: 'block' }, text: { group: 'inline' },
    ...pm.modules.tables.tableNodes({ tableGroup: 'block', cellContent: 'paragraph+' }),
  } });
  const makeCell = colspan => tableSchema.nodes.table_cell.create({ colspan }, tableSchema.nodes.paragraph.create());
  const makeSlice = (width, height) => new pm.modules.model.Slice(pm.modules.model.Fragment.fromArray([
    tableSchema.nodes.table_row.create(null, [makeCell(width), makeCell(width)]),
    ...Array.from({ length: height - 1 }, () => tableSchema.nodes.table_row.create(null, makeCell(1))),
  ]), 0, 0);
  assert.throws(() => pm.modules.tables.__pastedCells(makeSlice(64, 128)), /Table resource limit/);
  assert.throws(() => pm.modules.tables.__pastedCells(makeSlice(32, 65)), /Table resource limit/);
  const rectangular = pm.modules.tables.__pastedCells(makeSlice(1, 3));
  assert.equal(rectangular.width, 2);
  assert.equal(rectangular.height, 3);
  const lezerCjs = require('../vendor/codemirror6/node_modules/@lezer/markdown/dist/index.cjs');
  const lezerEsm = await import('../vendor/codemirror6/node_modules/@lezer/markdown/dist/index.js');
  for (const lezer of [lezerCjs, lezerEsm]) {
    assert.equal(lezer.parser.parse('a' + ' '.repeat(150000) + 'b').length, 150002);
    assert.match(lezer.parser.parse('a  \nb').toString(), /HardBreak/);
    assert.doesNotMatch(lezer.parser.parse('a b').toString(), /HardBreak/);
  }
  console.log('ProseMirror serialization/math and both Lezer runtimes passed');

  function checkAlignedat(engine) {
    for (const env of ['alignedat', 'alignedat*', 'alignat', 'alignat*']) {
      // Some aliases are unsupported by the vendor; either parser rejection or
      // the column guard is safe. The ordinary alignedat control must render.
      for (const count of ['1000000000', '1e300', '-1', '65']) {
        assert.throws(() => engine.renderToString(`\\begin{${env}}{${count}}a&=b\\end{${env}}`));
      }
    }
    assert.throws(() => engine.renderToString('\\def\\n{1000000000}\\begin{alignedat}{\\n}a&=b\\end{alignedat}'));
    assert.match(engine.renderToString('\\begin{alignedat}{2}a&=b&c&=d\\end{alignedat}'), /katex/);
  }
  checkAlignedat(katex);

  const named = new Map();
  const mermaidSandbox = { console, setTimeout, clearTimeout, TextEncoder, TextDecoder, URL, structuredClone, __named: named };
  mermaidSandbox.window = mermaidSandbox;
  const mermaidContext = vm.createContext(mermaidSandbox);
  const mermaidSource = read('vendor/mermaid/mermaid.min.js');
  // Capture the real bundled functions through the existing esbuild naming
  // helper. The test does not replace their algorithms or guards.
  const marker = 'var o=(e,t)=>Ky(e,"name",{value:t,configurable:!0});';
  assert.ok(mermaidSource.includes(marker));
  vm.runInContext(mermaidSource.replace(marker, 'var o=(e,t)=>(__named.set(t,e),Ky(e,"name",{value:t,configurable:!0}));'), mermaidContext);
  vm.runInContext(read('modules/mermaid-policy.js'), mermaidContext);
  const mermaid = mermaidSandbox.mermaid;
  const policy = mermaidSandbox.PMEMermaidPolicy;
  mermaid.initialize({ ...policy.securityConfig(), startOnLoad: false, securityLevel: 'strict', htmlLabels: false });
  const getDiagram = source => mermaid.mermaidAPI.getDiagramFromText(source);
  const fn = name => { assert.ok(named.has(name), `bundled function ${name} was initialized`); return named.get(name); };
  for (const key of ['THEME_COLOR_LIMIT', '"THEME_COLOR_LIMIT"']) {
    await assert.rejects(mermaid.parse(`---\nconfig:\n  theme: base\n  themeVariables:\n    ${key}: 1000000000\n---\nflowchart TD\nA-->B`), /resource limit/);
  }
  await assert.rejects(mermaid.parse('%%{init: {"theme":"base","themeVariables":{"THEME_COLOR_LIMIT":1e300}}}%%\nflowchart TD\nA-->B'), /resource limit/);
  await mermaid.parse('---\nconfig:\n  themeVariables:\n    THEME_COLOR_LIMIT: 12\n---\nflowchart TD\nA-->B');
  const aliases = ['a: &a [1, 1]'];
  for (let i = 0; i < 16; i++) aliases.push(`${String.fromCharCode(98 + i)}: &${String.fromCharCode(98 + i)} [*${String.fromCharCode(97 + i)}, *${String.fromCharCode(97 + i)}]`);
  await assert.rejects(mermaid.parse(`---\nconfig:\n${aliases.map(line => '  ' + line).join('\n')}\n---\nflowchart TD\nA-->B`), /resource limit/);
  await assert.rejects(mermaid.parse('---\nconfig: &loop\n  a: *loop\n---\nflowchart TD\nA-->B'), /cyclic config/);
  await mermaid.parse('---\nconfig:\n  a: &a [1, 2]\n  b: *a\n---\nflowchart TD\nA-->B');
  await assert.rejects(getDiagram('block-beta\nspace:1000000000'), /resource limit/);
  await assert.rejects(getDiagram('block-beta\n' + 'block\n'.repeat(34) + 'A\n' + 'end\n'.repeat(34)), /resource limit/);
  await getDiagram('block-beta\ncolumns 2\nA space:1\nB C');
  let nested = { id: 'leaf', size: { width: 20, height: 20 } };
  for (let i = 0; i < 16; i++) nested = { id: 'n' + i, children: [nested] };
  assert.throws(() => fn('setBlockSizes')(nested, {}), /block layout work/);
  const leaf = { id: 'leaf', size: { width: 20, height: 30 } };
  fn('setBlockSizes')(leaf, {});
  assert.equal(leaf.size.width, 20);

  await getDiagram('eventmodeling\n');
  await assert.rejects(getDiagram('eventmodeling\n@' + '{'.repeat(40000)), /error/i);
  await assert.rejects(getDiagram('eventmodeling\n@' + '"'.repeat(40000)), /error/i);
  const gantt = await getDiagram('gantt\ndateFormat YYYY-MM-DD\nexcludes weekends\ntask :2026-01-01, 2d');
  assert.equal(gantt.db.getTasks().length, 1);
  const longGantt = await getDiagram('gantt\ndateFormat YYYY-MM-DD\nexcludes weekends\ntask :1900-01-01, 3000000d');
  assert.throws(() => longGantt.db.getTasks(), /gantt days/);
  const xy = await getDiagram('xychart-beta\nx-axis 1 --> 1\nline [1,2,3]');
  assert.equal(xy.db.getXYChartData().plots[0].data.length, 3);
  const xy2 = await getDiagram('xychart-beta\nx-axis 1 --> 2\nline [1,2,3]');
  assert.equal(xy2.db.getXYChartData().plots[0].data.length, 3);
  await getDiagram('radar-beta\naxis A,B,C\ncurve c{1,2,3}');
  let shapes = 0;
  const selection = { append() { shapes++; return this; }, attr() { return this; } };
  for (const shape of ['circle', 'polygon']) {
    assert.throws(() => fn('drawGraticule')(selection, ['A', 'B', 'C'], 100, 1000000000, shape), /resource limit/);
    fn('drawGraticule')(selection, ['A', 'B', 'C'], 100, 5, shape);
  }
  assert.equal(shapes, 10);
  await getDiagram('venn-beta\nset A: 1');
  assert.throws(() => fn('addMissingAreas')(Array.from({ length: 17 }, (_, i) => ({ sets: [String(i)], size: 1 }))), /resource limit/);
  assert.throws(() => fn('addMissingAreas')([{ sets: Array.from({ length: 17 }, (_, i) => String(i)), size: 1 }], { distinct: true }), /resource limit/);
  assert.equal(fn('addMissingAreas')(['A', 'B', 'C'].map(id => ({ sets: [id], size: 1 }))).length, 6);
  assert.throws(() => fn('generateDashArray')(1e9, 8, 12), /resource limit/);
  assert.equal(fn('generateDashArray')(28, 8, 12), '0 8 2 2 2 2 12');
  const graph = await getDiagram('architecture-beta\nservice a(server)\nservice b(server)\nservice c(server)\nservice d(server)\na:R -- L:b\na:T -- B:c\nb:T -- B:d\nc:R -- L:d');
  const maps = graph.db.getDataStructures().spatialMaps;
  assert.equal(Object.keys(maps[0]).length, 4);
  assert.equal(fn('getRelativeConstraints')(maps, graph.db).length, 4, 'non-tree constraints must remain');
  const grid = Object.fromEntries(Array.from({ length: 256 }, (_, i) => ['n' + i, [i % 16, Math.floor(i / 16)]]));
  assert.equal(fn('getRelativeConstraints')([grid], graph.db).length, 480);
  const gridSource = ['architecture-beta'];
  for (let y = 0; y < 15; y++) for (let x = 0; x < 15; x++) gridSource.push(`service n${x}_${y}(server)`);
  for (let y = 0; y < 15; y++) for (let x = 0; x < 15; x++) {
    if (x < 14) gridSource.push(`n${x}_${y}:R -- L:n${x + 1}_${y}`);
    if (y < 14) gridSource.push(`n${x}_${y}:T -- B:n${x}_${y + 1}`);
  }
  const denseGraph = await getDiagram(gridSource.join('\n'));
  const denseMaps = denseGraph.db.getDataStructures().spatialMaps;
  assert.equal(denseMaps.length, 1);
  assert.equal(Object.keys(denseMaps[0]).length, 225, 'the first BFS also bounds duplicate queues');
  assert.equal(fn('getRelativeConstraints')(denseMaps, denseGraph.db).length, 420);
  await fn('renderKatexUnsanitized')('$$x$$', { forceLegacyMathML: true });
  checkAlignedat({ renderToString: fn('renderToString') });
  const labelTable = columns => '|' + 'h|'.repeat(columns) + '\n|' + '---|'.repeat(columns) + '\n|';
  assert.throws(() => fn('markdownToLines')(labelTable(65)), /label table/);
  assert.throws(() => fn('markdownToLines')(labelTable(2) + '\n|'.repeat(256)), /label table/);
  assert.throws(() => fn('markdownToLines')(labelTable(64) + '\n|'.repeat(64)), /label table/);
  assert.ok(fn('markdownToLines')(labelTable(2)).length > 0);
  console.log('Mermaid configuration, block, lexer, Gantt, XY, radar, Venn, dash and BFS passed');

  for (const [name, file] of [['mermaid', 'vendor/mermaid/mermaid.min.js'], ['katex', 'vendor/katex/katex.min.js'],
    ['@lezer/markdown', 'vendor/codemirror6/node_modules/@lezer/markdown/dist/index.js']]) {
    const source = read(file);
    assert.equal(patchVendor(name, source), source, name + ' patch is idempotent');
  }
}

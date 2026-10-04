import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const read = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const MarkdownIt = require('../vendor/markdown-it/markdown-it.min.js');
let highlightCalls = 0;
const sandbox = { console, URL, Blob, navigator: {}, localStorage: {},
  document: { baseURI: 'file:///C:/PortableMarkdownEditor/index.html', addEventListener() {} },
  confirm() { return true; }, prompt() { return ''; }, alert() {},
  window: { markdownit: MarkdownIt, hljs: {
    getLanguage() { return true; },
    highlight(text) { highlightCalls++; return { value: '<span>' + text + '</span>' }; },
  } },
};
const context = vm.createContext(sandbox);
for (const name of ['document-policy', 'table-policy', 'image-policy', 'markdown-renderer', 'rich-editor', 'rich-input-controller', 'file-manager', 'shortcut-manager']) {
  vm.runInContext(read('modules/' + name + '.js'), context);
}
const api = vm.runInContext(read('app.js').replace(/\}\)\(\);\s*$/,
  'return {state, renderMarkdownHtml, renderInlineMarkdown, buildExportHtml, getRichCodeHighlight, beginDocumentRender};})();'), context);
const policy = sandbox.window.PMEDocumentPolicy;
const denseSources = ['# h\n'.repeat(100000), 'p\n\n'.repeat(100000),
  'x'.repeat(policy.LIMITS.sourceChars + 1), '*a* '.repeat(40000)];
for (const source of denseSources) {
  highlightCalls = 0;
  assert.match(api.renderMarkdownHtml(source), /document-render-limit/);
  assert.match(api.buildExportHtml(source), /document-render-limit/);
  assert.equal(highlightCalls, 0, 'oversized input is rejected before vendor highlighting');
}
assert.match(api.renderMarkdownHtml('# Normal\n\n**bold** and [link](#normal)'), /<strong>bold<\/strong>/);
const fences = Array.from({ length: 40 }, (_, i) => '```js\nconst n = ' + i + ';\n```').join('\n\n');
api.state.markdown = fences;
api.beginDocumentRender(fences);
highlightCalls = 0;
assert.ok(api.renderMarkdownHtml(fences).length < 20000);
for (let i = 0; i < 40; i++) api.getRichCodeHighlight('const n = ' + i + ';\n', 'js');
assert.ok(highlightCalls <= policy.LIMITS.highlightCalls, 'preview and rich share the vendor work cap');
const hugeOutput = '<span>x</span>'.repeat(policy.LIMITS.outputNodes);
assert.equal(policy.outputCost(hugeOutput), null, 'DOM cost is checked before innerHTML');
let output = policy.createOutputBudget();
assert.equal(output.reserve('x'.repeat(1100000)), true);
assert.equal(output.reserve('x'.repeat(1100000)), false, 'output budget sums all blocks');
const work = policy.createWorkBudget();
for (let i = 0; i < policy.LIMITS.mermaidCalls; i++) assert.equal(work.reserve('mermaid', 100), true);
assert.equal(work.reserve('mermaid', 100), false);
const chars = policy.createWorkBudget();
assert.equal(chars.reserve('mermaid', policy.LIMITS.mermaidChars), true);
assert.equal(chars.reserve('mermaid', 1), false);
let clock = 0;
sandbox.performance = { now: () => clock };
highlightCalls = 0;
sandbox.window.hljs = { getLanguage: () => true, highlight() {
  highlightCalls++; clock += policy.LIMITS.renderMs; throw new Error('bounded failing vendor');
} };
api.beginDocumentRender(fences);
api.renderMarkdownHtml(fences);
assert.equal(highlightCalls, 1, 'failed vendor calls also consume the elapsed work budget');
delete sandbox.performance;

globalThis.window = globalThis;
globalThis.markdownit = MarkdownIt;
require('../modules/document-policy.js');
require('../modules/table-policy.js');
require('../modules/image-policy.js');
require('../vendor/prosemirror/prosemirror-editor.js');
for (const source of denseSources) {
  assert.equal(PMEProseMirror.unsupportedMarkdownReason(source), 'document-render-limit');
  assert.throws(() => PMEProseMirror.normalizeMarkdown(source), /Document resource limit/);
}
assert.equal(PMEProseMirror.normalizeMarkdown('**normal**'), '**normal**');
const schema = PMEProseMirror.modules.markdown.defaultMarkdownParser.schema;
const manyHeadings = schema.nodes.doc.create(null, Array.from({ length: 600 }, () =>
  schema.nodes.heading.create({ level: 1 }, schema.text('heading'))));
assert.equal(PMEDocumentPolicy.allowsNode(manyHeadings), false, 'direct node insertion is also bounded');
assert.equal(PMEDocumentPolicy.allowsNode(schema.nodes.doc.create(null, schema.nodes.paragraph.create(null, schema.text('ok')))), true);
console.log('document input, output, vendor work, export and ProseMirror budgets passed');

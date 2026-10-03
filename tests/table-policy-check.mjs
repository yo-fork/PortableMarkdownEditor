import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.window = globalThis;
const MarkdownIt = require('../vendor/markdown-it/markdown-it.min.js');
require('../modules/table-policy.js');

function tableSource(columns, rows, body = '|') {
  return ['|' + Array(columns).fill('h').join('|') + '|',
    '|' + Array(columns).fill('---').join('|') + '|', ...Array(rows - 1).fill(body)].join('\n');
}

const md = new MarkdownIt({ html: false });
PMETablePolicy.installMarkdownIt(md);
const originalPush = md.block.State.prototype.push;
let cellAllocations = 0;
md.block.State.prototype.push = function (type, ...args) {
  if (type === 'th_open' || type === 'td_open') cellAllocations += 1;
  return originalPush.call(this, type, ...args);
};
try {
  for (const [columns, rows] of [[65, 2], [2, 257], [64, 65], [128, 129]]) {
    for (const body of ['|', '|x|', '|' + 'x|'.repeat(columns + 1)]) {
      const source = tableSource(columns, rows, body);
      for (const wrapped of [source, source.split('\n').map(line => '> ' + line).join('\n'), '- item\n\n' + source.split('\n').map(line => '  ' + line).join('\n')]) {
        const env = {};
        cellAllocations = 0;
        const tokens = md.parse(wrapped, env);
        assert.equal(env.pmeTableLimit, true, 'all parser contexts enforce the table budget');
        assert.equal(cellAllocations, 0, 'over-budget tables must be rejected before allocating even header cells');
        assert.ok(tokens.some(token => token.type === 'code_block' && token.content.includes(body)), 'fallback retains literal source');
      }
    }
  }
  for (const [columns, rows] of [[64, 64], [16, 256], [2, 2]]) {
    cellAllocations = 0;
    const env = {};
    md.parse(tableSource(columns, rows), env);
    assert.equal(cellAllocations, columns * rows, 'inclusive boundaries still pad short rows');
    assert.equal(env.pmeTableLimit, undefined);
  }
  const ordinary = '| a | b |\n| :--- | ---: |\n| x |';
  for (const ending of ['\n\nparagraph', '\n# Heading', '\n- item', '\n```\ncode\n```', '\n    code']) {
    assert.equal(md.render(ordinary + ending), new MarkdownIt().render(ordinary + ending), 'vendor block termination and alignment are unchanged');
  }
  assert.equal(md.render('paragraph\n' + ordinary), new MarkdownIt().render('paragraph\n' + ordinary), 'table paragraph-terminator registration survives wrapping');
  const hostile = tableSource(65, 2, '|<img src=x onerror=alert(1)>|');
  assert.doesNotMatch(md.render(hostile), /<img|<table/);
  assert.match(md.render(hostile), /&lt;img/);
} finally {
  md.block.State.prototype.push = originalPush;
}
console.log('table policy checks passed');

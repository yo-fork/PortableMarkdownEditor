// Local fixes for the pinned vendor versions. No downloads or dependency changes.
// Apply at generation time as well as to the checked-in runtime copies.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

function replaceOnce(source, before, after) {
  if (source.includes(after)) return source;
  const at = source.indexOf(before);
  if (at < 0 || source.indexOf(before, at + before.length) >= 0) {
    throw new Error(`Pinned vendor patch no longer matches: ${before.slice(0, 90)}`);
  }
  return source.slice(0, at) + after + source.slice(at + before.length);
}

const mermaidGuards = `
function pmeCount(value, max, label, min = 0) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error('Mermaid resource limit: ' + label);
  return value;
}
function pmeFinite(value, min, max, label) {
  if (!Number.isFinite(value) || value < min || value > max) throw new Error('Mermaid resource limit: ' + label);
  return value;
}
function pmeConfig(value) {
  let remaining = 20000;
  const ancestors = new Set();
  function copy(item, depth) {
    if (--remaining < 0 || depth > 32) throw new Error('Mermaid resource limit: config');
    if (!item || typeof item !== 'object') return item;
    if (ancestors.has(item)) throw new Error('Mermaid resource limit: cyclic config');
    ancestors.add(item);
    const result = Array.isArray(item) ? [] : Object.create(null);
    for (const key of Object.keys(item)) {
      if (key === 'THEME_COLOR_LIMIT') pmeCount(item[key], 64, 'theme colors', 1);
      result[key] = copy(item[key], depth + 1);
    }
    ancestors.delete(item);
    return result;
  }
  return copy(value, 0);
}
`;

export function patchVendor(name, source) {
  const patch = (before, after) => { source = replaceOnce(source, before, after); };
  if (name === 'mermaid') {
    patch('.mermaid=(()=>{var sNe=', `.mermaid=(()=>{${mermaidGuards}var sNe=`);
    // Expand small aliases once under a budget, before any merge/sanitizer or toString.
    patch('let r=ld(t[1],{schema:od})??{};', 'let r=pmeConfig(ld(t[1],{schema:od})??{});');
    patch('n=Gr(r.config,i.directive);', 'n=Gr(pmeConfig(r.config),pmeConfig(i.directive));');
    const calculate = 'calculate(t){if(typeof t!="object")';
    const boundedCalculate = 'calculate(t){if(t&&t.THEME_COLOR_LIMIT!==void 0)pmeCount(t.THEME_COLOR_LIMIT,64,"theme colors",1);if(typeof t!="object")';
    if (source.includes(calculate)) source = source.replaceAll(calculate, boundedCalculate);
    else if (!source.includes(boundedCalculate)) throw new Error('Theme calculate patch no longer matches');
    patch('O4t=o((e,t,r,i,n)=>{if(n===', 'O4t=o((e,t,r,i,n)=>{pmeCount(i,64,"radar ticks");pmeCount(i*Math.max(1,t.length),4096,"radar vertices");if(n===');
    patch('new ls(r,{positionTracking:"full",skipValidations:i,', 'new ls(r,{positionTracking:"full",recoveryEnabled:false,skipValidations:i,');
    patch('if(r.length===i.length){for(let s of i)', 'if(r.length===i.length){if(r.length>64||n.length+1>256||r.length*(n.length+1)>4096)throw new Error("Mermaid resource limit: label table");for(let s of i)');
    patch('let a=!1,s=null,l=t.add(1e4,"d");for(;e<=t;){', 'let a=!1,s=null,l=t.add(1e4,"d"),pmeDays=0;for(;e<=t;){pmeCount(++pmeDays,10000,"gantt days");');
    patch('s8e=o((e,t)=>{let r=e.flat()', 's8e=o((e,t,pmeBudget={nodes:0},pmeDepth=0)=>{pmeCount(pmeDepth,32,"block depth");let r=e.flat()');
    patch('.columns??-1;for(let s of r){', '.columns??-1;for(let s of r){pmeCount(++pmeBudget.nodes,4096,"block nodes");');
    patch('s.children&&s8e(s.children,s),s.type==="space"){let u=s.width??1;', 's.children&&s8e(s.children,s,pmeBudget,pmeDepth+1),s.type==="space"){let u=pmeCount(s.width??1,4096,"block space");pmeBudget.nodes+=u;pmeCount(pmeBudget.nodes,4096,"block nodes");');
    patch('function Aq(e,t,r=0,i=0){', 'function Aq(e,t,r=0,i=0,pmeWork={calls:0},pmeDepth=0){pmeCount(++pmeWork.calls,10000,"block layout work");pmeCount(pmeDepth,32,"block layout depth");');
    patch('for(let m of e.children)Aq(m,t);', 'for(let m of e.children)Aq(m,t,0,0,pmeWork,pmeDepth+1);');
    patch('for(let m of e.children)Aq(m,t,n,a);', 'for(let m of e.children)Aq(m,t,n,a,pmeWork,pmeDepth+1);');
    patch('nodeSeparation:n.getConfigField("nodeSeparation"),', 'nodeSeparation:pmeFinite(n.getConfigField("nodeSeparation"),1,10000,"node separation"),');
    patch('for(var be=0,Be=L,Ae=L,Ve=void 0;;){be++;', 'for(var be=0,Be=L,Ae=L,Ve=void 0;;){pmeCount(++be,1024,"spectral iterations");');
    patch('for(be=0,Ae=L;;){be++;', 'for(be=0,Ae=L;;){pmeCount(++be,1024,"spectral iterations");');
    const ratio = 'Ve=Math.abs(Be/Ae),Ve<=1+B&&Ve>=1)break;';
    const boundedRatio = 'Ve=Math.abs(Be/Ae),!Number.isFinite(Ve))throw new Error("Mermaid resource limit: nonfinite layout");if(Ve<=1+B&&Ve>=1)break;';
    if (source.includes(ratio)) source = source.replaceAll(ratio, boundedRatio);
    else if (!source.includes(boundedRatio)) throw new Error('Spectral finite patch no longer matches');
    patch('let r=fi.xAxis.min,i=fi.xAxis.max,n=(i-r)/(e.length-1),a=[];for(let s=r;s<=i;s+=n)a.push(`${s}`);',
      'let r=fi.xAxis.min,i=fi.xAxis.max,a=[];pmeFinite(r,-1e100,1e100,"x axis");pmeFinite(i,-1e100,1e100,"x axis");for(let s=0;s<e.length;s++)a.push(`${e.length===1?r:r*(1-s/(e.length-1))+i*(s/(e.length-1))}`);');
    // Enqueue each node once. Retain non-tree constraints until both ends are processed.
    patch('let h={[u]:[0,0]},d=[u];for(;d.length>0;){let f=d.shift();', 'let h={[u]:[0,0]},d=[u],pmeQueued=new Set(d),pmeHead=0;for(;pmeHead<d.length;){let f=d[pmeHead++];');
    patch('n[v]||(h[v]=yRe([m,g],y),d.push(v))', 'n[v]||pmeQueued.has(v)||(h[v]=yRe([m,g],y),pmeQueued.add(v),d.push(v))');
    patch('for(;l.length>0;){let d=l.shift();if(d){u[d]=1;', 'for(let pmeHead=0,pmeQueued=new Set(l);pmeHead<l.length;){let d=l[pmeHead++];if(d){u[d]=1;');
    patch('v&&!u[y]&&(l.push(y),r.push({', 'v&&!u[y]&&(!pmeQueued.has(y)&&(pmeQueued.add(y),l.push(y)),r.push({');
    patch('function x5t(e,t={}){let r=t.distinct,', 'function x5t(e,t={}){pmeCount(e.length,256,"venn areas");pmeCount(e.filter(x=>x.sets.length===1).length,16,"venn sets");for(const x of e)pmeCount(x.sets.length,16,"venn intersection");let r=t.distinct,');
    patch('eUe=o((e,t,r)=>{let i=e-t-r,n=2,a=2,s=n+a,l=Math.floor(i/s),u=Array(l)', 'eUe=o((e,t,r)=>{let i=e-t-r,n=2,a=2,s=n+a,l=Math.floor(i/s);pmeCount(l,4096,"dash segments");let u=Array(l)');
    patch('l=Number(d),u=l*2}var m=!u;', 'l=Number(d);if(!Number.isSafeInteger(l)||l<1||l>64)throw new Lt("Alignedat column limit exceeded");u=l*2}var m=!u;');
  } else if (name === 'katex') {
    patch('l=Number(e),a=2*l}const h=!a;', 'l=Number(e);if(!Number.isSafeInteger(l)||l<1||l>64)throw new n("Alignedat column limit exceeded");a=2*l}const h=!a;');
  } else if (name === '@lezer/markdown') {
    // An unmarked run remains ordinary text in InlineContext.resolveMarkers.
    patch('return cx.append(elt(Type.HardBreak, start, pos + 1));\n        }\n        return -1;', 'return cx.append(elt(Type.HardBreak, start, pos + 1));\n            return pos; // PME: consume an ordinary space run once.\n        }\n        return -1;');
  } else if (name === 'prosemirror-markdown') {
    patch('var _exec3 = /^(.*?)(\\s*)$/m.exec(node.text),', 'var _exec3 = (function(text) { var lineEnd = text.search(/[\\r\\n\\u2028\\u2029]/); if (lineEnd < 0) lineEnd = text.length; var at = lineEnd; while (at > 0 && /\\s/.test(text.charAt(at - 1))) at--; var end = at, lastBreak = -1; while (end < text.length && /\\s/.test(text.charAt(end))) { if (/[\\r\\n\\u2028\\u2029]/.test(text.charAt(end))) lastBreak = end; end++; } if (end < text.length) end = lastBreak < 0 ? lineEnd : lastBreak; return [text.slice(0, end), text.slice(0, at), text.slice(at, end)]; })(node.text),');
    patch('    for (var i = index + 1; i < parent.childCount; i++) if (parent.child(i).type != node.type) {\n      state.write("\\\\\\n");\n      return;\n    }',
      '    var tails = state.pmeBreakTails || (state.pmeBreakTails = new WeakMap());\n    var last = tails.get(parent);\n    if (last === undefined) {\n      last = parent.childCount - 1;\n      while (last >= 0 && parent.child(last).type === node.type) last--;\n      tails.set(parent, last);\n    }\n    if (index < last) state.write("\\\\\\n");');
  } else if (name === 'prosemirror-tables') {
    patch('const colspan = Number(dom.getAttribute("colspan") || 1);', 'const colspan = Number(dom.getAttribute("colspan") || 1);\n\tconst pmeRowspan = Number(dom.getAttribute("rowspan") || 1);\n\tif (!Number.isSafeInteger(colspan) || colspan < 1 || colspan > 64 || !Number.isSafeInteger(pmeRowspan) || pmeRowspan < 1 || pmeRowspan > 256) return false;');
    patch('const width = findWidth(table), height = table.childCount;\n\tconst map = [];', 'const width = findWidth(table), height = table.childCount;\n\tif (!Number.isSafeInteger(width) || width < 1 || width > 64 || height > 256 || width * height > 4096) throw new RangeError("Table resource limit exceeded");\n\tconst map = [];');
    patch('function ensureRectangular(schema, rows) {\n\tconst widths = [];', 'function ensureRectangular(schema, rows) {\n\tif (rows.length > 256) throw new RangeError("Table resource limit exceeded");\n\tconst widths = [];');
    patch('const { rowspan, colspan } = row.child(j).attrs;\n\t\t\tfor (let r = i; r < i + rowspan; r++) widths[r] = (widths[r] || 0) + colspan;', 'const { rowspan, colspan } = row.child(j).attrs;\n\t\t\tif (!Number.isSafeInteger(rowspan) || rowspan < 1 || i + rowspan > 256 || !Number.isSafeInteger(colspan) || colspan < 1 || colspan > 64) throw new RangeError("Table resource limit exceeded");\n\t\t\tfor (let r = i; r < i + rowspan; r++) {\n\t\t\t\twidths[r] = (widths[r] || 0) + colspan;\n\t\t\t\tif (widths[r] > 64) throw new RangeError("Table resource limit exceeded");\n\t\t\t}');
    patch('for (let r = 0; r < widths.length; r++) width = Math.max(width, widths[r]);\n\tfor (let r = 0; r < widths.length; r++) {', 'for (let r = 0; r < widths.length; r++) width = Math.max(width, widths[r]);\n\tif (width * widths.length > 4096) throw new RangeError("Table resource limit exceeded");\n\tfor (let r = 0; r < widths.length; r++) {');
    patch('const right = left + cells.width, bottom = top + cells.height;\n\tconst tr = state.tr;', 'const right = left + cells.width, bottom = top + cells.height;\n\tif (!Number.isSafeInteger(right) || !Number.isSafeInteger(bottom) || right > 64 || bottom > 256 || Math.max(map.width, right) * Math.max(map.height, bottom) > 4096) throw new RangeError("Table resource limit exceeded");\n\tconst tr = state.tr;');
  }
  return source;
}

async function applyCheckedIn() {
  const files = [
    ['mermaid', 'vendor/mermaid/mermaid.min.js'],
    ['katex', 'vendor/katex/katex.min.js'],
    ['@lezer/markdown', 'vendor/codemirror6/node_modules/@lezer/markdown/dist/index.js'],
    ['@lezer/markdown', 'vendor/codemirror6/node_modules/@lezer/markdown/dist/index.cjs'],
  ];
  for (const [name, file] of files) {
    const url = new URL('../' + file, import.meta.url);
    const before = await readFile(url, 'utf8');
    const after = patchVendor(name, before);
    if (after !== before) await writeFile(url, after);
  }
  const url = new URL('../vendor/codemirror6/node_modules/@lezer/markdown/src/markdown.ts', import.meta.url);
  const before = await readFile(url, 'utf8');
  const after = replaceOnce(before, 'return cx.append(elt(Type.HardBreak, start, pos + 1))\n    }\n    return -1', 'return cx.append(elt(Type.HardBreak, start, pos + 1))\n      return pos // PME: consume an ordinary space run once.\n    }\n    return -1');
  if (after !== before) await writeFile(url, after);
  console.log('Pinned vendor security patches applied');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await applyCheckedIn();

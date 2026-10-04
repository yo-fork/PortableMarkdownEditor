import assert from 'node:assert/strict';

// Called inside the browser harness's disposable profile for both HTTP and file.
export async function checkSecurityResources({ evaluate, poll, setAppMarkdown, switchMode }, sessionId) {
  await switchMode('source', sessionId);
  await setAppMarkdown('Resource boundary controls.', sessionId);
  const editorResults = await evaluate(`(() => {
    const results = [];
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    let notices = 0;
    const editor = window.PMEProseMirror.createRichMarkdownEditor({ mount, markdown: 'Keep text', onUnsupportedMarkdown() { notices++; } });
    try {
      const table = (attrs) => '<table><tr><td ' + attrs + '>payload</td></tr></table>';
      for (const attrs of ['colspan="1000000000"', 'rowspan="1000000000"', 'colspan="1e9"', 'colspan="65"', 'rowspan="0"']) {
        editor.setMarkdown('Keep text');
        editor.view.pasteHTML(table(attrs));
        results.push({ name: attrs, cells: mount.querySelectorAll('td,th').length, retained: editor.view.state.doc.textContent.includes('payload') });
      }
      const product = '<table>' + '<tr><td colspan="64">payload</td></tr>'.repeat(65) + '</table>';
      editor.setMarkdown('Keep text');
      editor.view.pasteHTML(product);
      results.push({ name: 'cell product', cells: mount.querySelectorAll('td,th').length, retained: editor.view.state.doc.textContent.includes('payload') });
      // Real HTML clipboard fragments enter ProseMirror's wrapMap and table
      // paste plugin; they do not necessarily contain a <table> element.
      const fragments = [
        '<tr><td colspan="64">payload</td><td colspan="64">x</td></tr>' + '<tr><td>x</td></tr>'.repeat(127),
        '<tbody><tr><td colspan="64">payload</td></tr>' + '<tr><td>x</td></tr>'.repeat(64) + '</tbody>',
        '<td colspan="64">payload</td><td colspan="64">x</td>',
      ];
      for (const [index, html] of fragments.entries()) {
        editor.setMarkdown('| A | B |\\n| --- | --- |\\n| C | D |');
        const TextSelection = window.PMEProseMirror.modules.state.TextSelection;
        editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, 4)));
        editor.view.pasteHTML(html);
        results.push({ name: 'fragment ' + index, cells: mount.querySelectorAll('td,th').length, max: 8, retained: editor.view.state.doc.textContent.includes('payload') });
      }
      const growth = [];
      const sourceTable = (columns, rows) => '|' + 'h|'.repeat(columns) + '\\n|' + '---|'.repeat(columns) + ('\\n|' + 'c|'.repeat(columns)).repeat(rows - 1);
      for (const [columns, rows, html] of [[64, 2, '<table><tr><td>x</td><td>y</td></tr></table>'],
        [2, 256, '<table><tr><td>x</td></tr><tr><td>y</td></tr></table>'],
        [32, 128, '<table><tr><td>x</td><td>y</td></tr></table>']]) {
        editor.setMarkdown(sourceTable(columns, rows));
        let lastCell = 0;
        editor.view.state.doc.descendants((node, pos) => { if (node.type.spec.tableRole === 'cell') lastCell = pos; });
        const TextSelection = window.PMEProseMirror.modules.state.TextSelection;
        editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, lastCell + 1)));
        const before = editor.view.state.doc;
        const beforeNotices = notices;
        editor.view.pasteHTML(html);
        growth.push({ unchanged: editor.view.state.doc === before, notices: notices - beforeNotices,
          position: lastCell, before: before.textContent.length, after: editor.view.state.doc.textContent.length });
      }
      editor.setMarkdown('');
      editor.view.pasteHTML('<table><tr><th colspan="2">head</th></tr><tr><td rowspan="2">a</td><td>b</td></tr><tr><td>c</td></tr></table>');
      const normal = { cells: mount.querySelectorAll('td,th').length, span: mount.querySelector('th')?.colSpan, rowSpan: mount.querySelector('td')?.rowSpan };
      const { schema } = editor.view.state;
      const before = editor.view.state.doc;
      const invalid = schema.nodes.table.create(null, schema.nodes.table_row.create(null,
        schema.nodes.table_cell.create({ colspan: 1e9 }, schema.nodes.paragraph.create())));
      editor.view.dispatch(editor.view.state.tr.replaceWith(0, before.content.size, invalid));
      const transactionRejected = editor.view.state.doc === before;
      const { TableMap } = window.PMEProseMirror.modules.tables;
      let mapRejected = false;
      try { TableMap.get(invalid); } catch (error) { mapRejected = /Table resource limit/.test(error.message); }
      return { results, normal, transactionRejected, mapRejected, growth };
    } finally { editor.destroy(); mount.remove(); }
  })()`, sessionId);
  for (const result of editorResults.results) {
    assert.ok(result.cells <= (result.max || 0), result.name + ': no expanded HTML cells (' + result.cells + ')');
    assert.equal(result.retained, true, result.name + ': source remains readable');
  }
  assert.deepEqual(editorResults.normal, { cells: 4, span: 2, rowSpan: 2 });
  assert.equal(editorResults.transactionRejected, true);
  assert.equal(editorResults.mapRejected, true);
  for (const result of editorResults.growth) assert.ok(result.unchanged && result.notices === 1,
    'paste growth must reject cleanly before expanding an existing table: ' + JSON.stringify(result));

  const drops = await evaluate(`(() => {
    const textarea = document.createElement('textarea'); textarea.value = 'Keep source'; document.body.appendChild(textarea);
    let calls = 0; let readers = 0;
    const Original = window.FileReader;
    window.FileReader = class extends Original { constructor() { super(); readers++; } };
    const editor = window.PMECodeMirrorSourceEditor.createPortableMarkdownSourceEditor({ textarea, onDrop() { calls++; } });
    try {
      const prevented = [];
      for (const [name, type] of [['large.txt', 'text/plain'], ['image.png', 'image/png'], ['unknown.bin', 'application/octet-stream']]) {
        const transfer = new DataTransfer(); transfer.items.add(new File(['payload'], name, { type }));
        const event = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer });
        editor.view.contentDOM.dispatchEvent(event); prevented.push(event.defaultPrevented);
      }
      return { calls, readers, prevented, source: editor.value() };
    } finally { editor.destroy(); textarea.remove(); window.FileReader = Original; }
  })()`, sessionId);
  assert.deepEqual(drops, { calls: 3, readers: 0, prevented: [true, true, true], source: 'Keep source' });

  for (const markdown of [
    '[toc]\n\n'.repeat(65) + Array.from({ length: 65 }, (_, i) => '# H' + i).join('\n\n'),
    '[toc]\n\n'.repeat(4) + '# ' + 'H'.repeat(60000),
  ]) {
    await setAppMarkdown(markdown, sessionId);
    await switchMode('rich', sessionId);
    const result = await poll(`(() => ({
      preview: document.querySelectorAll('#preview .toc-render-limit').length,
      rich: document.querySelectorAll('#richEditor .toc-render-limit').length,
      links: document.querySelectorAll('#richEditor .toc li, #preview .toc li').length,
      source: document.getElementById('sourceEditor').value
    }))()`, value => value?.preview > 0 && value?.rich > 0, sessionId, 'bounded TOC');
    assert.equal(result.links, 0);
    assert.equal(result.source, markdown);
    await switchMode('source', sessionId);
  }
  await setAppMarkdown('[toc]\n\n# One\n\n## Two', sessionId);
  await switchMode('rich', sessionId);
  await poll(`(() => ({ count: document.querySelectorAll('#richEditor .toc li').length,
    source: document.getElementById('sourceEditor').value.slice(0, 80),
    rich: document.getElementById('richEditor').innerHTML.slice(0, 1200) }))()`,
    value => value?.count === 2, sessionId, 'normal TOC recovery');
  await switchMode('source', sessionId);
  await setAppMarkdown('Mermaid resource controls.', sessionId);

  const architecture = 'architecture-beta\nservice a(server)\nservice b(server)\nservice c(server)\nservice d(server)\na:R -- L:b\na:T -- B:c\nb:T -- B:d\nc:R -- L:d';
  const bad = [
    ['theme', '---\nconfig:\n  theme: base\n  themeVariables:\n    THEME_COLOR_LIMIT: 1000000000\n---\nflowchart TD\nA-->B'],
    ['radar', 'radar-beta\naxis A,B,C\ncurve c{1,2,3}\nticks 1000000000'],
    ['block space', 'block-beta\nspace:1000000000'],
    ['block recursion', 'block-beta\n' + 'block\n'.repeat(16) + 'A\n' + 'end\n'.repeat(16)],
    ['spectral zero', '---\nconfig:\n  architecture:\n    randomize: true\n    nodeSeparation: 0\n---\n' + architecture],
    ['spectral negative', '%%{init: {"architecture":{"randomize":true,"nodeSeparation":-1}}}%%\n' + architecture],
    ['Gantt', 'gantt\ndateFormat YYYY-MM-DD\nexcludes weekends\ntask :1900-01-01, 3000000d'],
    ['Venn', 'venn-beta\n' + Array.from({ length: 17 }, (_, i) => 'set S' + i + ': 1').join('\n')],
    ['label table', 'flowchart TD\nA["`|' + 'h|'.repeat(65) + '\n|' + '---|'.repeat(65) + '\n|`"]'],
  ];
  const normal = [
    '---\nconfig:\n  architecture:\n    randomize: true\n---\n' + architecture,
    'radar-beta\naxis A,B,C\ncurve c{1,2,3}\nticks 5',
    'xychart-beta\nx-axis 1 --> 1\nline [1,2,3]',
    'block-beta\ncolumns 2\nblock:g\nA B\nend\nC',
    'venn-beta\nset A: 10\nset B: 10\nunion A,B: 2',
    '---\nconfig:\n  look: neo\n---\nflowchart TD\nA-.->B',
  ];
  const diagrams = await evaluate(`(async () => {
    const output = [];
    const cases = ${JSON.stringify([...bad.map(([name, source]) => ({ name, source, limited: true })), ...normal.map((source, i) => ({ name: 'normal ' + i, source, limited: false }))])};
    for (const [index, test] of cases.entries()) {
      const container = document.createElement('div'); document.body.appendChild(container);
      let error = ''; let svg = '';
      try {
        mermaid.initialize({ ...PMEMermaidPolicy.securityConfig(), startOnLoad: false, securityLevel: 'strict', htmlLabels: false, suppressErrorRendering: true });
        await PMEMermaidPolicy.assertSafeSource(test.source, mermaid);
        svg = (await mermaid.render('security_resource_' + index, test.source, container)).svg;
      } catch (reason) { error = reason.message; }
      finally { container.remove(); }
      output.push({ name: test.name, limited: test.limited, error, rendered: svg.includes('<svg') });
    }
    return output;
  })()`, sessionId);
  for (const test of diagrams) {
    if (test.limited) assert.match(test.error, /resource limit/, test.name + ': rejected at the resource boundary');
    else assert.equal(test.rendered, true, test.name + ': ' + test.error);
  }
  await checkDocumentBudgets({ evaluate, poll, setAppMarkdown }, sessionId);
  console.log(`security resource browser checks passed (${await evaluate('location.protocol', sessionId)})`);
}

async function checkDocumentBudgets({ evaluate, poll, setAppMarkdown }, sessionId) {
  await evaluate(`(() => {
    const source = document.getElementById('sourceEditor');
    source.value = 'x'.repeat(PMEDocumentPolicy.LIMITS.sourceChars + 1);
    source.dispatchEvent(new Event('input', { bubbles: true }));
  })()`, sessionId);
  await poll(`Boolean(document.querySelector('#preview .document-render-limit'))`, Boolean, sessionId, 'oversized preview fallback');
  const limited = await evaluate(`({
    length: document.getElementById('sourceEditor').value.length,
    expected: PMEDocumentPolicy.LIMITS.sourceChars + 1,
    cm: Boolean(document.querySelector('.source-pane .cm-editor')),
    rich: Boolean(document.querySelector('#richEditor .document-render-limit')),
    nodes: document.querySelector('#preview').querySelectorAll('*').length
  })`, sessionId);
  assert.equal(limited.length, limited.expected, 'source is preserved in full');
  assert.equal(limited.cm, false, 'oversized source uses the plain editor');
  assert.equal(limited.rich, true, 'rich fallback does not repeat full parsing');
  assert.ok(limited.nodes < 10);
  await setAppMarkdown('# Normal after limit\n\n**editable**', sessionId);
  await poll(`Boolean(document.querySelector('.source-pane .cm-editor')) &&
    document.querySelector('#preview').textContent.includes('Normal after limit')`, Boolean, sessionId, 'normal editing recovery');

  const transactions = await evaluate(`(() => {
    const mount = document.createElement('div'); document.body.appendChild(mount);
    let notices = 0;
    const editor = PMEProseMirror.createRichMarkdownEditor({ mount,
      markdown: '# heading\\n'.repeat(PMEDocumentPolicy.LIMITS.headings), onUnsupportedMarkdown() { notices++; } });
    try {
      const before = editor.view.state.doc;
      editor.view.dispatch(editor.view.state.tr.insert(before.content.size, before.child(0)));
      const blocked = editor.view.state.doc === before;
      const inserted = editor.insertMarkdown('x'.repeat(PMEDocumentPolicy.LIMITS.sourceChars + 1));
      editor.view.pasteText('*a* '.repeat(40000));
      editor.view.pasteHTML('<i>x</i>'.repeat(40000));
      return { blocked, inserted, unchanged: editor.view.state.doc === before, notices };
    } finally { editor.destroy(); mount.remove(); }
  })()`, sessionId);
  assert.equal(transactions.blocked, true, 'cumulative rich transactions enforce the heading cap');
  assert.equal(transactions.inserted, false);
  assert.equal(transactions.unchanged, true, 'oversized text and HTML paste are rejected before insertion');
  assert.ok(transactions.notices >= 3);

  await setAppMarkdown('```mermaid\nflowchart TD\nA-->B\n```', sessionId);
  await poll(`Boolean(document.querySelector('#richEditor svg.mermaid-svg'))`, Boolean, sessionId, 'initial rich Mermaid');
  await evaluate(`(() => {
    const target = document.querySelector('#richEditor .pme-mermaid-node');
    target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const input = document.querySelector('.pme-node-source-editor--mermaid');
    input.value = 'flowchart TD\\nA-->C';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`, sessionId);
  await poll(`['preview', 'richEditor'].every(id => {
    const target = document.querySelector('#' + id + ' .mermaid-render-target');
    return target?.getAttribute('data-mermaid-source').includes('A-->C') && Boolean(target.querySelector('svg.mermaid-svg'));
  })`, Boolean, sessionId, 'Mermaid edit refreshes both roots after the budget changes');
  await setAppMarkdown('Normal after diagram edit', sessionId);

  await evaluate(`(() => {
    window.__documentBudgetMermaid = { original: window.mermaid, calls: 0, roots: [] };
    const test = window.__documentBudgetMermaid;
    window.mermaid = { ...test.original, async render() {
      test.calls++;
      return { svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><text x="1" y="20">ok</text></svg>' };
    } };
    for (let rootIndex = 0; rootIndex < 2; rootIndex++) {
      const root = document.createElement('div'); document.body.appendChild(root); test.roots.push(root);
      for (let index = 0; index < 10; index++) {
        const target = document.createElement('div'); target.className = 'mermaid-render-target';
        target.setAttribute('data-mermaid-source', 'flowchart TD\\nA-->B'); root.appendChild(target);
      }
      PMERenderMermaidIn(root);
    }
  })()`, sessionId);
  try {
    await poll(`__documentBudgetMermaid.roots.every(root => Array.from(root.children).every(target =>
      target.querySelector('svg') || target.hasAttribute('data-mermaid-error')))`, Boolean, sessionId, 'aggregate Mermaid budget');
    const calls = await evaluate('__documentBudgetMermaid.calls', sessionId);
    assert.ok(calls > 0 && calls <= 8, 'two roots share the Mermaid call cap: ' + calls);
  } finally {
    await evaluate(`(() => { const test = __documentBudgetMermaid; window.mermaid = test.original;
      test.roots.forEach(root => root.remove()); delete window.__documentBudgetMermaid; })()`, sessionId);
  }
}

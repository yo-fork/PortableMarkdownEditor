(() => {
  'use strict';

  // Counts include the header row and the cells added to pad short rows.
  const limits = Object.freeze({ columns: 64, rows: 256, cells: 4096 });

  function allowsDimensions(columns, rows) {
    return Number.isSafeInteger(columns) && Number.isSafeInteger(rows)
      && columns > 0 && columns <= limits.columns
      && rows > 0 && rows <= limits.rows && columns * rows <= limits.cells;
  }

  function allowsCells(rows) {
    if (!rows.length || rows.length > limits.rows) return false;
    const occupied = rows.map(() => []);
    let width = 0;
    let cells = 0;
    for (let y = 0; y < rows.length; y += 1) {
      if (rows[y].length > limits.columns) return false;
      let x = 0;
      for (const cell of rows[y]) {
        const columns = Number(cell.colspan ?? 1);
        const height = Number(cell.rowspan ?? 1);
        if (!allowsDimensions(columns, height) || y + height > rows.length) return false;
        while (occupied[y][x]) x += 1;
        if (x + columns > limits.columns || (cells += columns * height) > limits.cells) return false;
        for (let dy = y; dy < y + height; dy += 1) {
          for (let dx = x; dx < x + columns; dx += 1) {
            if (occupied[dy][dx]) return false;
            occupied[dy][dx] = true;
          }
        }
        x += columns;
        width = Math.max(width, x);
      }
    }
    return allowsDimensions(width, rows.length);
  }

  function allowsTableNode(table) {
    if (!table.childCount || table.childCount > limits.rows) return false;
    const rows = [];
    for (let y = 0; y < table.childCount; y += 1) {
      const row = table.child(y);
      if (row.childCount > limits.columns) return false;
      const cells = [];
      for (let x = 0; x < row.childCount; x += 1) cells.push(row.child(x).attrs);
      rows.push(cells);
    }
    return allowsCells(rows);
  }

  function sanitizePastedHTML(html) {
    // Template contents are inert: inspecting pasted resources must not load them.
    const template = document.createElement('template');
    // ProseMirror's readHTML restores these clipboard fragments with wrappers.
    // Inspect that same table shape before ensureRectangular can pad its rows.
    const source = html.replace(/^(\s*<meta [^>]*>)*/, '');
    const firstTag = /<([a-z][^>\s]+)/i.exec(source)?.[1].toLowerCase();
    const wrappers = { thead: ['table'], tbody: ['table'], tfoot: ['table'], caption: ['table'],
      colgroup: ['table'], col: ['table', 'colgroup'], tr: ['table', 'tbody'],
      td: ['table', 'tbody', 'tr'], th: ['table', 'tbody', 'tr'] }[firstTag] || [];
    template.innerHTML = wrappers.map(tag => `<${tag}>`).join('') + source
      + wrappers.slice().reverse().map(tag => `</${tag}>`).join('');
    for (const table of template.content.querySelectorAll('table')) {
      const rows = [];
      if (table.rows.length <= limits.rows) {
        for (const row of table.rows) {
          if (row.cells.length > limits.columns) { rows.length = 0; break; }
          rows.push(Array.from(row.cells, (cell) => ({
            colspan: cell.getAttribute('colspan') || 1,
            rowspan: cell.getAttribute('rowspan') || 1,
          })));
        }
      }
      if (!allowsCells(rows)) {
        const escaped = html.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
        return `<p>表の表示上限を超えたためHTML原文を貼り付けました。</p><pre>${escaped}</pre>`;
      }
    }
    return html;
  }

  function tableEndLine(state, startLine, endLine) {
    const terminators = state.md.block.ruler.getRules('blockquote');
    const previousParent = state.parentType;
    state.parentType = 'table';
    try {
      let line = startLine + 2;
      for (; line < endLine; line += 1) {
        if (state.sCount[line] < state.blkIndent) break;
        if (terminators.some((rule) => rule(state, line, endLine, true))) break;
        const text = state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]).trim();
        if (!text || state.sCount[line] - state.blkIndent >= 4) break;
      }
      return line;
    } finally {
      state.parentType = previousParent;
    }
  }

  function installMarkdownIt(md) {
    // Capture the pinned vendor rule so its grammar and silent lookahead stay intact.
    const entry = md.block.ruler.__rules__.find((rule) => rule.name === 'table');
    const tableRule = entry.fn;
    md.block.ruler.at('table', (state, startLine, endLine, silent) => {
      if (!tableRule(state, startLine, endLine, true)) return false;
      if (silent) return true;
      const delimiterLine = startLine + 1;
      const delimiter = state.src.slice(state.bMarks[delimiterLine] + state.tShift[delimiterLine], state.eMarks[delimiterLine]);
      const columns = delimiter.split('|').filter((cell) => cell.trim()).length;
      const end = tableEndLine(state, startLine, endLine);
      if (allowsDimensions(columns, end - startLine - 1)) {
        return tableRule(state, startLine, endLine, false);
      }
      // Reject before the vendor allocates any row/cell tokens. A code token
      // preserves source literally, without inline rendering or highlighting.
      state.env.pmeTableLimit = true;
      const token = state.push('code_block', 'code', 0);
      token.content = state.getLines(startLine, end, state.blkIndent, false);
      token.map = [startLine, end];
      token.attrSet('class', 'table-render-limit');
      state.line = end;
      return true;
    }, { alt: entry.alt });
  }

  window.PMETablePolicy = Object.freeze({ limits, allowsDimensions, allowsCells, allowsTableNode, sanitizePastedHTML, installMarkdownIt });
})();

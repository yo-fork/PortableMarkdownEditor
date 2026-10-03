(() => {
  'use strict';

  // Counts include the header row and the cells added to pad short rows.
  const limits = Object.freeze({ columns: 64, rows: 256, cells: 4096 });

  function allowsDimensions(columns, rows) {
    return columns > 0 && columns <= limits.columns
      && rows > 0 && rows <= limits.rows && columns * rows <= limits.cells;
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

  window.PMETablePolicy = Object.freeze({ limits, allowsDimensions, installMarkdownIt });
})();

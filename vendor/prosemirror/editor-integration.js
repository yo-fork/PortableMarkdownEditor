  var model = requireModule('prosemirror-model');
  var state = requireModule('prosemirror-state');
  var view = requireModule('prosemirror-view');
  var commands = requireModule('prosemirror-commands');
  var historyModule = requireModule('prosemirror-history');
  var keymapModule = requireModule('prosemirror-keymap');
  var dropcursor = requireModule('prosemirror-dropcursor');
  var gapcursor = requireModule('prosemirror-gapcursor');
  var schemaList = requireModule('prosemirror-schema-list');
  var inputRulesModule = requireModule('prosemirror-inputrules');
  var markdown = requireModule('prosemirror-markdown');
  var tableModule = requireModule('prosemirror-tables');
  var MarkdownIt = requireModule('markdown-it');

  var schema = createExtendedSchema();
  var parser = createMarkdownParser(schema);
  var serializer = createMarkdownSerializer(schema);

  function normalizeNewlines(value) {
    return String(value || '').replace(/\r\n?/g, '\n');
  }

  function unsupportedMarkdownReason(markdownText) {
    var markdownEnv = {};
    var tokens;
    try {
      tokens = parser.tokenizer.parse(normalizeNewlines(markdownText || ''), markdownEnv);
    } catch (_) {
      return 'markdown-parse-failed';
    }
    if (markdownEnv.references && Object.keys(markdownEnv.references).length) {
      return 'link-reference-definitions';
    }
    if (markdownTokensContainEmptyLink(tokens)) return 'empty-links';
    return '';
  }

  function markdownTokensContainEmptyLink(tokens) {
    for (var tokenIndex = 0; tokenIndex < (tokens || []).length; tokenIndex += 1) {
      var children = tokens[tokenIndex].children || [];
      for (var childIndex = 0; childIndex + 1 < children.length; childIndex += 1) {
        if (children[childIndex].type === 'link_open' && children[childIndex + 1].type === 'link_close') return true;
      }
    }
    return false;
  }

  function markdownHasAmbiguousInlineMathBoundary(markdownText) {
    var tokens;
    try {
      tokens = parser.tokenizer.parse(normalizeNewlines(markdownText || ''), {});
    } catch (_) {
      return false;
    }
    for (var tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
      var children = tokens[tokenIndex].children || [];
      for (var childIndex = 0; childIndex < children.length; childIndex += 1) {
        var child = children[childIndex];
        if (child.type !== 'math_inline') continue;
        var previous = childIndex > 0 ? children[childIndex - 1] : null;
        var next = childIndex + 1 < children.length ? children[childIndex + 1] : null;
        if (previous && (previous.type === 'math_inline' || previous.type === 'text' && /\$$/.test(previous.content || ''))) return true;
        if (next && (next.type === 'math_inline' || next.type === 'text' && /^\$/.test(next.content || ''))) return true;
      }
    }
    return false;
  }

  function requiresCanonicalMarkdownNormalization(markdownText) {
    var source = normalizeNewlines(markdownText || '');
    return markdownHasAmbiguousInlineMathBoundary(source)
      || escapeInlineMathPipesInMarkdownTables(source) !== source;
  }

  function fenceForContent(content) {
    var length = 3;
    String(content || '').replace(/`+/g, function(match) {
      length = Math.max(length, match.length + 1);
      return match;
    });
    return Array(length + 1).join('`');
  }

  function copyObject(object) {
    var result = {};
    for (var key in object) result[key] = object[key];
    return result;
  }

  function extendObject(base, extension) {
    var result = copyObject(base);
    for (var key in extension) result[key] = extension[key];
    return result;
  }

  function tableCellDomAttrs(node) {
    var attrs = {};
    var align = node.attrs && node.attrs.align;
    if (align) attrs.style = 'text-align: ' + align;
    return attrs;
  }

  function setTableCellDomAttr(value, attrs) {
    if (!value) return;
    attrs.style = (attrs.style ? attrs.style + '; ' : '') + 'text-align: ' + value;
  }

  function alignFromStyle(style) {
    var match = String(style || '').match(/text-align\s*:\s*(left|center|right)/i);
    return match ? match[1].toLowerCase() : null;
  }

  function tableCellAttrsFromToken(token) {
    return { align: alignFromStyle(token && token.attrGet && token.attrGet('style')) };
  }

  function createExtendedSchema() {
    var tableNodes = tableModule.tableNodes({
      tableGroup: 'block',
      cellContent: 'inline*',
      cellAttributes: {
        align: {
          default: null,
          getFromDOM: function(dom) {
            return alignFromStyle((dom.style && dom.style.textAlign) || dom.getAttribute('style') || dom.getAttribute('align'));
          },
          setDOMAttr: setTableCellDomAttr
        }
      }
    });
    var extendedNodes = extendObject(tableNodes, {
      math_inline: {
        inline: true,
        group: 'inline',
        atom: true,
        selectable: true,
        attrs: { latex: { default: '' } },
        parseDOM: [{ tag: 'span[data-math-inline]', getAttrs: function(dom) { return { latex: dom.getAttribute('data-latex') || '' }; } }],
        toDOM: function(node) { return ['span', { class: 'math-inline pme-math-node', 'data-math-inline': 'true', 'data-latex': node.attrs.latex }]; }
      },
      math_display: {
        group: 'block',
        atom: true,
        selectable: true,
        attrs: { latex: { default: '' } },
        parseDOM: [{ tag: 'div[data-math-display]', getAttrs: function(dom) { return { latex: dom.getAttribute('data-latex') || '' }; } }],
        toDOM: function(node) { return ['div', { class: 'math-display pme-math-node', 'data-math-display': 'true', 'data-latex': node.attrs.latex }]; }
      },
      mermaid_block: {
        group: 'block',
        atom: true,
        selectable: true,
        attrs: { source: { default: '' } },
        parseDOM: [{ tag: 'figure[data-mermaid-block]', getAttrs: function(dom) { return { source: dom.getAttribute('data-source') || '' }; } }],
        toDOM: function(node) { return ['figure', { class: 'mermaid-diagram pme-mermaid-node', 'data-mermaid-block': 'true', 'data-source': node.attrs.source }]; }
      },
      toc_block: {
        group: 'block',
        atom: true,
        selectable: true,
        parseDOM: [{ tag: 'nav[data-toc-block]' }],
        toDOM: function() { return ['nav', { class: 'toc pme-toc-node', 'data-toc-block': 'true' }]; }
      }
    });
    var listItemSpec = markdown.schema.spec.nodes.get('list_item');
    var taskListItemSpec = extendObject(listItemSpec, {
      attrs: extendObject(listItemSpec.attrs || {}, { task: { default: null } }),
      parseDOM: [{
        tag: 'li[data-task-checked]',
        getAttrs: function(dom) { return { task: dom.getAttribute('data-task-checked') === 'true' }; }
      }].concat(listItemSpec.parseDOM || []),
      toDOM: function(node) {
        var attrs = node.attrs.task == null
          ? {}
          : { class: 'task-list-item', 'data-task-checked': String(Boolean(node.attrs.task)) };
        return ['li', attrs, 0];
      }
    });
    var headingSpec = markdown.schema.spec.nodes.get('heading');
    var mathHeadingSpec = extendObject(headingSpec, {
      content: '(text | image | math_inline)*'
    });
    var strikeMarkSpec = {
      parseDOM: [{ tag: 'del' }, { tag: 's' }, { tag: 'strike' }],
      toDOM: function() { return ['del', 0]; }
    };
    return new model.Schema({
      nodes: markdown.schema.spec.nodes
        .update('list_item', taskListItemSpec)
        .update('heading', mathHeadingSpec)
        .append(extendedNodes),
      marks: markdown.schema.spec.marks.append({ strike: strikeMarkSpec })
    });
  }

  function addTocBlockRule(tokenizer) {
    tokenizer.block.ruler.before('paragraph', 'pme_toc_block', function(state, startLine, endLine, silent) {
      var start = state.bMarks[startLine] + state.tShift[startLine];
      var max = state.eMarks[startLine];
      var line = state.src.slice(start, max);
      if (!/^\s*\[toc\]\s*$/i.test(line)) return false;
      if (silent) return true;
      var token = state.push('toc_block', '', 0);
      token.map = [startLine, startLine + 1];
      state.line = startLine + 1;
      return true;
    });
  }

  function decodeMarkdownLocalPath(value) {
    var source = String(value || '');
    if (!/%[0-9A-Fa-f]{2}/.test(source)) return source;
    try { return decodeURIComponent(source); }
    catch (_) {
      return source.replace(/%5c/gi, '\\').replace(/%2f/gi, '/').replace(/%20/gi, ' ');
    }
  }

  function shouldPreserveMarkdownLocalPath(value) {
    var decoded = decodeMarkdownLocalPath(value);
    return decoded.indexOf('\\') >= 0
      || /^[A-Za-z]:[\\/]/.test(decoded)
      || /^file:/i.test(decoded);
  }

  function preserveMarkdownLocalPaths(tokenizer) {
    var normalizeLink = tokenizer.normalizeLink.bind(tokenizer);
    tokenizer.normalizeLink = function(value) {
      return shouldPreserveMarkdownLocalPath(value) ? decodeMarkdownLocalPath(value) : normalizeLink(value);
    };
  }

  function addMathBlockRule(tokenizer) {
    tokenizer.block.ruler.before('fence', 'pme_math_display', function(state, startLine, endLine, silent) {
      var start = state.bMarks[startLine] + state.tShift[startLine];
      var max = state.eMarks[startLine];
      var line = state.src.slice(start, max);
      var delimiter = /^\s*\$\$/.test(line) ? '$$' : /^\s*\\\[/.test(line) ? '\\[' : '';
      if (!delimiter) return false;
      var inlineMatch = delimiter === '$$'
        ? line.match(/^\s*\$\$\s*([\s\S]*?)\s*\$\$\s*$/)
        : line.match(/^\s*\\\[\s*([\s\S]*?)\s*\\\]\s*$/);
      if (inlineMatch && inlineMatch[1]) {
        if (silent) return true;
        var inlineToken = state.push('math_display', '', 0);
        inlineToken.content = inlineMatch[1];
        inlineToken.map = [startLine, startLine + 1];
        state.line = startLine + 1;
        return true;
      }
      var openingMatch = delimiter === '$$'
        ? line.match(/^\s*\$\$(?!\$)([\s\S]*)$/)
        : line.match(/^\s*\\\[([\s\S]*)$/);
      if (!openingMatch) return false;
      var nextLine = startLine + 1;
      var closingMatch = null;
      while (nextLine < endLine) {
        var nextStart = state.bMarks[nextLine] + state.tShift[nextLine];
        var nextMax = state.eMarks[nextLine];
        var nextText = state.src.slice(nextStart, nextMax);
        closingMatch = delimiter === '$$'
          ? nextText.match(/^([\s\S]*?)\$\$\s*$/)
          : nextText.match(/^([\s\S]*?)\\\]\s*$/);
        if (closingMatch) break;
        nextLine += 1;
      }
      if (nextLine >= endLine) return false;
      if (silent) return true;
      var token = state.push('math_display', '', 0);
      var contentParts = [];
      var openingContent = openingMatch[1].replace(/^[ \t]+/, '');
      if (openingContent) contentParts.push(openingContent);
      var middleContent = normalizeNewlines(state.getLines(startLine + 1, nextLine, 0, false)).replace(/\n+$/g, '');
      if (middleContent) contentParts.push(middleContent);
      var closingContent = closingMatch[1].replace(/[ \t]+$/, '');
      if (closingContent) contentParts.push(closingContent);
      token.content = contentParts.join('\n');
      token.map = [startLine, nextLine + 1];
      state.line = nextLine + 1;
      return true;
    }, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
  }

  function isEscapedMarkdownCharacter(text, index) {
    var slashes = 0;
    for (var cursor = index - 1; cursor >= 0 && text.charAt(cursor) === '\\'; cursor -= 1) slashes += 1;
    return slashes % 2 === 1;
  }

  function inlineMathMatchAt(source, start) {
    if (source.slice(start, start + 2) === '\\(' && !isEscapedMarkdownCharacter(source, start)) {
      var parenClose = source.indexOf('\\)', start + 2);
      while (parenClose >= 0 && isEscapedMarkdownCharacter(source, parenClose)) {
        parenClose = source.indexOf('\\)', parenClose + 2);
      }
      if (parenClose < 0) return null;
      var parenValue = source.slice(start + 2, parenClose);
      if (parenValue.indexOf('\n') >= 0 || /^\s|\s$/.test(parenValue)) return null;
      return { value: parenValue, end: parenClose + 2 };
    }

    if (source.charAt(start) !== '$'
      || source.charAt(start + 1) === '$'
      || /\s/.test(source.charAt(start + 1))
      || isEscapedMarkdownCharacter(source, start)) return null;
    var close = start + 1;
    while (close < source.length) {
      close = source.indexOf('$', close);
      if (close < 0) return null;
      if (!isEscapedMarkdownCharacter(source, close)
        && !/\s/.test(source.charAt(close - 1))) {
        var value = source.slice(start + 1, close);
        if (value && value.indexOf('\n') < 0) return { value: value, end: close + 1 };
      }
      close += 1;
    }
    return null;
  }

  function escapeTablePipesInInlineMathSource(source) {
    var value = String(source || '');
    var escaped = '';
    for (var index = 0; index < value.length; index += 1) {
      if (value.charAt(index) === '|' && value.charAt(index - 1) !== '\\') escaped += '\\';
      escaped += value.charAt(index);
    }
    return escaped;
  }

  function escapeInlineMathPipesInTableLine(line) {
    var source = String(line || '');
    var output = '';
    var last = 0;
    var cursor = 0;
    while (cursor < source.length) {
      var match = inlineMathMatchAt(source, cursor);
      if (!match) {
        cursor += 1;
        continue;
      }
      output += source.slice(last, cursor);
      output += escapeTablePipesInInlineMathSource(source.slice(cursor, match.end));
      cursor = match.end;
      last = cursor;
    }
    return last ? output + source.slice(last) : source;
  }

  function isMarkdownTableDelimiterLine(line) {
    return /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(String(line || ''));
  }

  function escapeInlineMathPipesInMarkdownTables(markdownText) {
    var lines = normalizeNewlines(markdownText || '').split('\n');
    for (var index = 1; index < lines.length; index += 1) {
      if (!isMarkdownTableDelimiterLine(lines[index]) || lines[index - 1].indexOf('|') < 0) continue;
      lines[index - 1] = escapeInlineMathPipesInTableLine(lines[index - 1]);
      for (var rowIndex = index + 1; rowIndex < lines.length; rowIndex += 1) {
        if (!lines[rowIndex].trim() || lines[rowIndex].indexOf('|') < 0) break;
        lines[rowIndex] = escapeInlineMathPipesInTableLine(lines[rowIndex]);
      }
    }
    return lines.join('\n');
  }

  function addMathInlineRule(tokenizer) {
    tokenizer.inline.ruler.before('escape', 'pme_math_inline', function(state, silent) {
      var start = state.pos;
      var source = state.src;
      var match = inlineMathMatchAt(source, start);
      if (!match) return false;
      if (!silent) {
        var token = state.push('math_inline', '', 0);
        token.content = match.value;
      }
      state.pos = match.end;
      return true;
    });
  }

  function addHardBreakHtmlRule(tokenizer) {
    tokenizer.inline.ruler.before('text', 'pme_html_br', function(state, silent) {
      var match = state.src.slice(state.pos).match(/^<br\s*\/?>/i);
      if (!match) return false;
      if (!silent) state.push('hardbreak', 'br', 0);
      state.pos += match[0].length;
      return true;
    });
  }

  function addMermaidFenceRule(tokenizer) {
    tokenizer.core.ruler.after('block', 'pme_mermaid_fence', function(state) {
      for (var index = 0; index < state.tokens.length; index += 1) {
        var token = state.tokens[index];
        if (token.type !== 'fence' || !/^mermaid(?:\s|$)/i.test(String(token.info || '').trim())) continue;
        token.type = 'mermaid_block';
        token.tag = '';
        token.nesting = 0;
      }
    });
  }

  function stripTaskMarkerFromInlineToken(token, markerLength) {
    token.content = String(token.content || '').slice(markerLength);
    var remaining = markerLength;
    var children = [];
    for (var index = 0; index < (token.children || []).length; index += 1) {
      var child = token.children[index];
      if (remaining > 0 && child.type === 'text') {
        if (child.content.length <= remaining) {
          remaining -= child.content.length;
          continue;
        }
        child.content = child.content.slice(remaining);
        remaining = 0;
      }
      children.push(child);
    }
    token.children = children;
  }

  function addTaskListRule(tokenizer) {
    tokenizer.core.ruler.after('inline', 'pme_task_lists', function(state) {
      for (var index = 2; index < state.tokens.length; index += 1) {
        var inlineToken = state.tokens[index];
        var paragraphOpen = state.tokens[index - 1];
        var listItemOpen = state.tokens[index - 2];
        if (inlineToken.type !== 'inline' || paragraphOpen.type !== 'paragraph_open' || listItemOpen.type !== 'list_item_open') continue;
        var match = String(inlineToken.content || '').match(/^\[([ xX])\]\s+/);
        if (!match) continue;
        listItemOpen.attrSet('data-pme-task', match[1].toLowerCase() === 'x' ? 'true' : 'false');
        stripTaskMarkerFromInlineToken(inlineToken, match[0].length);
      }
    });
  }

  function createMarkdownItTokenizer() {
    var tokenizer = MarkdownIt('commonmark', { html: false });
    preserveMarkdownLocalPaths(tokenizer);
    tokenizer.enable(['table', 'strikethrough']);
    addTocBlockRule(tokenizer);
    addMathBlockRule(tokenizer);
    addMathInlineRule(tokenizer);
    addHardBreakHtmlRule(tokenizer);
    addMermaidFenceRule(tokenizer);
    addTaskListRule(tokenizer);
    return tokenizer;
  }

  function listIsTightIncludingEmptyItems(tokens, openIndex) {
    var open = tokens[openIndex];
    if (!open) return false;
    var closeType = open.type.replace(/_open$/, '_close');
    var paragraphLevel = open.level + 2;
    for (var index = openIndex + 1; index < tokens.length; index += 1) {
      var token = tokens[index];
      if (token.type === closeType && token.level === open.level) break;
      if (token.type === 'paragraph_open' && token.level === paragraphLevel && !token.hidden) return false;
    }
    return true;
  }

  function createMarkdownParser(pmSchema) {
    return new markdown.MarkdownParser(pmSchema, createMarkdownItTokenizer(), extendObject(markdown.defaultMarkdownParser.tokens, {
      list_item: {
        block: 'list_item',
        getAttrs: function(token) {
          var task = token.attrGet('data-pme-task');
          return { task: task == null ? null : task === 'true' };
        }
      },
      bullet_list: {
        block: 'bullet_list',
        getAttrs: function(_token, tokens, index) {
          return { tight: listIsTightIncludingEmptyItems(tokens, index) };
        }
      },
      ordered_list: {
        block: 'ordered_list',
        getAttrs: function(token, tokens, index) {
          return {
            order: Number(token.attrGet('start')) || 1,
            tight: listIsTightIncludingEmptyItems(tokens, index)
          };
        }
      },
      table: { block: 'table' },
      thead: { ignore: true },
      tbody: { ignore: true },
      tr: { block: 'table_row' },
      th: { block: 'table_header', getAttrs: tableCellAttrsFromToken },
      td: { block: 'table_cell', getAttrs: tableCellAttrsFromToken },
      s: { mark: 'strike' },
      image: {
        node: 'image',
        getAttrs: function(token) {
          return {
            src: decodeMarkdownLocalPath(token.attrGet('src') || ''),
            title: token.attrGet('title') || null,
            alt: token.children[0] && token.children[0].content || null
          };
        }
      },
      math_inline: {
        node: 'math_inline',
        getAttrs: function(token) { return { latex: token.content || '' }; }
      },
      math_display: {
        node: 'math_display',
        getAttrs: function(token) { return { latex: token.content || '' }; }
      },
      mermaid_block: {
        node: 'mermaid_block',
        getAttrs: function(token) { return { source: normalizeNewlines(token.content || '').replace(/\n+$/g, '') }; }
      },
      toc_block: { node: 'toc_block' }
    }));
  }

  function escapeInlineMath(latex) {
    var value = String(latex || '');
    var escaped = '';
    for (var index = 0; index < value.length; index += 1) {
      if (value.charAt(index) === '$' && !isEscapedMarkdownCharacter(value, index)) escaped += '\\';
      escaped += value.charAt(index);
    }
    return escaped;
  }

  function inlineMathHasAmbiguousDollarNeighbor(parent, index) {
    if (!parent || typeof index !== 'number') return false;
    var previous = index > 0 ? parent.child(index - 1) : null;
    var next = index + 1 < parent.childCount ? parent.child(index + 1) : null;
    return Boolean(
      previous && (previous.type === schema.nodes.math_inline || previous.isText && /\$$/.test(previous.text || ''))
      || next && (next.type === schema.nodes.math_inline || next.isText && /^\$/.test(next.text || ''))
    );
  }

  function inlineMathMarkdownSource(node, parent, index) {
    var latex = escapeInlineMath(node && node.attrs && node.attrs.latex);
    if (!latex) return '\\(\\)';
    if (inlineMathHasAmbiguousDollarNeighbor(parent, index)) return '\\(' + latex + '\\)';
    return '$' + latex + '$';
  }

  function tableDelimiterForCell(cell) {
    var align = cell && cell.attrs && cell.attrs.align;
    if (align === 'left') return ':---';
    if (align === 'right') return '---:';
    if (align === 'center') return ':---:';
    return '---';
  }

  function serializeInlineNodeContent(node) {
    if (!node || !node.content || !node.content.size) return '';
    var paragraph = schema.nodes.paragraph.create(null, node.content);
    var doc = schema.nodes.doc.create(null, [paragraph]);
    return serializer.serialize(doc).trim();
  }

  function serializeTableCell(cell) {
    return serializeInlineNodeContent(cell)
      .replace(/\r\n?/g, '\n')
      .replace(/\\\n/g, '<br>')
      .replace(/\n+/g, '<br>')
      .replace(/\|/g, '\\|');
  }

  function tableRows(node) {
    var rows = [];
    node.forEach(function(row) {
      var cells = [];
      row.forEach(function(cell) { cells.push(cell); });
      rows.push(cells);
    });
    return rows;
  }

  function renderTableRow(state, cells, columnCount) {
    var values = [];
    for (var index = 0; index < columnCount; index += 1) values.push(serializeTableCell(cells[index]));
    state.write('| ' + values.join(' | ') + ' |');
  }

  function createMarkdownSerializer() {
    var extendedMarks = extendObject(markdown.defaultMarkdownSerializer.marks, {
      strike: {
        open: '~~',
        close: '~~',
        mixable: true,
        expelEnclosingWhitespace: true
      }
    });
    return new markdown.MarkdownSerializer(extendObject(markdown.defaultMarkdownSerializer.nodes, {
      code_block: function(state, node) {
        var source = normalizeNewlines(node.textContent || '');
        var fence = fenceForContent(source);
        state.write(fence + (node.attrs.params || '') + '\n');
        if (source) {
          state.text(source, false);
          state.write('\n');
        }
        state.write(fence);
        state.closeBlock(node);
      },
      list_item: function(state, node) {
        if (node.attrs.task != null) state.write(node.attrs.task ? '[x] ' : '[ ] ');
        state.renderContent(node);
      },
      text: function(state, node) {
        state.text(String(node.text || '').replace(/\u00a0/g, '&nbsp;'), !state.inAutolink);
      },
      table: function(state, node) {
        var rows = tableRows(node);
        if (!rows.length) {
          state.closeBlock(node);
          return;
        }
        var columnCount = 1;
        for (var rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
          columnCount = Math.max(columnCount, rows[rowIndex].length);
        }
        renderTableRow(state, rows[0], columnCount);
        var delimiters = [];
        for (var columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
          delimiters.push(tableDelimiterForCell(rows[0][columnIndex]));
        }
        state.write('\n| ' + delimiters.join(' | ') + ' |');
        for (var bodyIndex = 1; bodyIndex < rows.length; bodyIndex += 1) {
          state.write('\n');
          renderTableRow(state, rows[bodyIndex], columnCount);
        }
        state.closeBlock(node);
      },
      table_row: function(state, node) { state.renderContent(node); },
      table_cell: function(state, node) { state.renderInline(node); },
      table_header: function(state, node) { state.renderInline(node); },
      image: function(state, node) {
        var target = markdownImageTarget(node.attrs.src || '');
        var title = node.attrs.title
          ? ' "' + String(node.attrs.title).replace(/"/g, '\\"').replace(/[\r\n]/g, ' ') + '"'
          : '';
        state.write('![' + state.esc(node.attrs.alt || '') + '](' + target + title + ')');
      },
      math_inline: function(state, node, parent, index) {
        state.write(inlineMathMarkdownSource(node, parent, index));
      },
      math_display: function(state, node) {
        state.write('$$\n');
        state.text(normalizeNewlines(node.attrs.latex), false);
        state.write('\n$$');
        state.closeBlock(node);
      },
      mermaid_block: function(state, node) {
        var source = normalizeNewlines(node.attrs.source).replace(/\n+$/g, '');
        var fence = fenceForContent(source);
        state.write(fence + 'mermaid\n');
        state.text(source, false);
        state.write('\n' + fence);
        state.closeBlock(node);
      },
      toc_block: function(state, node) {
        state.write('[toc]');
        state.closeBlock(node);
      }
    }), extendedMarks);
  }

  function restoreMarkdownSyntaxEscapes(markdownText) {
    return normalizeNewlines(markdownText)
      .replace(/^(\s*)\* /gm, '$1- ')
      .replace(/^(\s*(?:[-+*]|\d+[.)])\s+)\\\[([ xX])\\\](?=\s|$)/gm, '$1[$2]');
  }

  function parseMarkdown(markdownText) {
    return parser.parse(escapeInlineMathPipesInMarkdownTables(markdownText));
  }

  function isEmptyParagraphNode(node) {
    return Boolean(node && node.type === schema.nodes.paragraph && node.content.size === 0);
  }

  function ensureEditableTrailingParagraph(doc) {
    if (!schema.nodes.paragraph || isEmptyParagraphNode(doc.lastChild)) return doc;
    return doc.copy(doc.content.append(model.Fragment.from(schema.nodes.paragraph.create())));
  }

  function documentWithoutEditableTrailingParagraphs(doc) {
    if (!schema.nodes.paragraph || !doc.childCount) return doc;
    var nodes = [];
    doc.forEach(function(node) { nodes.push(node); });
    while (nodes.length > 1 && isEmptyParagraphNode(nodes[nodes.length - 1])) nodes.pop();
    return nodes.length === doc.childCount ? doc : doc.copy(model.Fragment.fromArray(nodes));
  }

  function serializeMarkdown(doc) {
    return restoreMarkdownSyntaxEscapes(serializer.serialize(documentWithoutEditableTrailingParagraphs(doc)));
  }

  function isTableCellNode(node) {
    var role = node && node.type && node.type.spec && node.type.spec.tableRole;
    return role === 'cell' || role === 'header_cell';
  }

  function tableCellContext(editorState) {
    var selection = editorState.selection;
    if (!selection || !selection.empty) return null;
    var $from = selection.$from;
    var cellDepth = -1;
    var tableDepth = -1;
    for (var depth = $from.depth; depth > 0; depth -= 1) {
      if (cellDepth < 0 && isTableCellNode($from.node(depth))) cellDepth = depth;
      if (tableDepth < 0 && $from.node(depth).type.name === 'table') tableDepth = depth;
    }
    if (cellDepth < 0 || tableDepth < 0) return null;
    var tableNode = $from.node(tableDepth);
    var tableStart = $from.before(tableDepth);
    var currentCellStart = $from.before(cellDepth);
    var cells = [];
    tableNode.descendants(function(node, pos) {
      if (isTableCellNode(node)) cells.push({ node: node, pos: tableStart + 1 + pos });
    });
    var index = -1;
    for (var cellIndex = 0; cellIndex < cells.length; cellIndex += 1) {
      if (cells[cellIndex].pos === currentCellStart) index = cellIndex;
    }
    if (index < 0) return null;
    return {
      cells: cells,
      index: index,
      tableNode: tableNode,
      tableStart: tableStart
    };
  }

  function selectTableCell(transaction, cellStart) {
    return transaction.setSelection(state.TextSelection.create(transaction.doc, cellStart + 1));
  }

  function createEmptyTableRow(tableNode) {
    var tableCell = schema.nodes.table_cell;
    var tableRow = schema.nodes.table_row;
    if (!tableCell || !tableRow) return null;
    var columnCount = Math.max(1, tableNode && tableNode.firstChild ? tableNode.firstChild.childCount : 1);
    var cells = [];
    for (var index = 0; index < columnCount; index += 1) cells.push(tableCell.create());
    return tableRow.create(null, cells);
  }

  function tableCellEnterCommand(editorState, dispatch) {
    if (!tableCellContext(editorState)) return false;
    return insertHardBreakCommand(editorState, dispatch);
  }

  function moveTableCellCommand(direction) {
    return function(editorState, dispatch) {
      var context = tableCellContext(editorState);
      if (!context) return false;
      var targetIndex = context.index + direction;
      if (targetIndex >= 0 && targetIndex < context.cells.length) {
        if (dispatch) dispatch(selectTableCell(editorState.tr, context.cells[targetIndex].pos).scrollIntoView());
        return true;
      }
      if (direction <= 0 || context.index !== context.cells.length - 1) return false;
      var newRow = createEmptyTableRow(context.tableNode);
      if (!newRow) return false;
      if (dispatch) {
        var insertPos = context.tableStart + context.tableNode.nodeSize - 1;
        var tr = editorState.tr.insert(insertPos, newRow);
        selectTableCell(tr, insertPos + 1);
        dispatch(tr.scrollIntoView());
      }
      return true;
    };
  }

  function activeTableRect(editorState) {
    if (!editorState || !tableModule.isInTable(editorState)) return null;
    try { return tableModule.selectedRect(editorState); }
    catch (_error) { return null; }
  }

  function normalizeMarkdownTableTransaction(transaction) {
    var table = schema.nodes.table;
    var tableHeader = schema.nodes.table_header;
    var tableCell = schema.nodes.table_cell;
    if (!transaction || !transaction.doc || !table || !tableHeader || !tableCell) return transaction;
    var changes = [];
    transaction.doc.descendants(function(node, pos) {
      if (node.type !== table) return true;
      node.forEach(function(row, rowOffset, rowIndex) {
        row.forEach(function(cell, cellOffset) {
          var targetType = rowIndex === 0 ? tableHeader : tableCell;
          if (cell.type !== targetType) {
            changes.push({
              pos: pos + 1 + rowOffset + 1 + cellOffset,
              type: targetType,
              attrs: cell.attrs
            });
          }
        });
      });
      return false;
    });
    changes.forEach(function(change) {
      var node = transaction.doc.nodeAt(change.pos);
      if (node && node.type !== change.type) transaction.setNodeMarkup(change.pos, change.type, change.attrs);
    });
    return transaction;
  }

  function tableCommandWithMarkdownNormalization(command) {
    return function(editorState, dispatch, editorView) {
      if (!activeTableRect(editorState)) return false;
      if (!dispatch) return command(editorState, null, editorView);
      return command(editorState, function(transaction) {
        normalizeMarkdownTableTransaction(transaction);
        dispatch(transaction.scrollIntoView());
      }, editorView);
    };
  }

  function deleteSelectedTableRowsCommand(editorState, dispatch, editorView) {
    var rect = activeTableRect(editorState);
    if (!rect) return false;
    if (rect.bottom - rect.top >= rect.map.height) {
      return tableModule.deleteTable(editorState, dispatch, editorView);
    }
    return tableCommandWithMarkdownNormalization(tableModule.deleteRow)(editorState, dispatch, editorView);
  }

  function deleteSelectedTableColumnsCommand(editorState, dispatch, editorView) {
    var rect = activeTableRect(editorState);
    if (!rect) return false;
    if (rect.right - rect.left >= rect.map.width) {
      return tableModule.deleteTable(editorState, dispatch, editorView);
    }
    return tableCommandWithMarkdownNormalization(tableModule.deleteColumn)(editorState, dispatch, editorView);
  }

  function setSelectedTableColumnsAlignCommand(align) {
    return function(editorState, dispatch) {
      var rect = activeTableRect(editorState);
      if (!rect) return false;
      if (dispatch) {
        var transaction = editorState.tr;
        var seen = {};
        for (var column = rect.left; column < rect.right; column += 1) {
          for (var row = 0; row < rect.map.height; row += 1) {
            var cellOffset = rect.map.map[row * rect.map.width + column];
            if (seen[cellOffset]) continue;
            seen[cellOffset] = true;
            var cell = rect.table.nodeAt(cellOffset);
            if (!cell) continue;
            transaction.setNodeMarkup(
              rect.tableStart + cellOffset,
              null,
              extendObject(cell.attrs, { align: align || null })
            );
          }
        }
        normalizeMarkdownTableTransaction(transaction);
        dispatch(transaction.scrollIntoView());
      }
      return true;
    };
  }

  function tableToolbarCommand(action) {
    switch (action) {
      case 'add-row-before': return tableCommandWithMarkdownNormalization(tableModule.addRowBefore);
      case 'add-row-after': return tableCommandWithMarkdownNormalization(tableModule.addRowAfter);
      case 'add-column-before': return tableCommandWithMarkdownNormalization(tableModule.addColumnBefore);
      case 'add-column-after': return tableCommandWithMarkdownNormalization(tableModule.addColumnAfter);
      case 'delete-row': return deleteSelectedTableRowsCommand;
      case 'delete-column': return deleteSelectedTableColumnsCommand;
      case 'delete-table': return tableModule.deleteTable;
      case 'align-left': return setSelectedTableColumnsAlignCommand('left');
      case 'align-center': return setSelectedTableColumnsAlignCommand('center');
      case 'align-right': return setSelectedTableColumnsAlignCommand('right');
      default: return null;
    }
  }

  function tableToolbarTableElement(editorView) {
    var rect = activeTableRect(editorView.state);
    if (!rect) return null;
    var tableDom = editorView.nodeDOM(rect.tableStart - 1);
    if (tableDom && tableDom.nodeType === 1) {
      if (tableDom.matches && tableDom.matches('table')) return tableDom;
      var nestedTable = tableDom.querySelector && tableDom.querySelector('table');
      if (nestedTable) return nestedTable;
    }
    var domPoint = editorView.domAtPos(editorView.state.selection.from);
    var element = domPoint && (domPoint.node.nodeType === 1 ? domPoint.node : domPoint.node.parentElement);
    return element && element.closest ? element.closest('table') : null;
  }

  function createTableToolbarButton(label, action, title) {
    var button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.dataset.tableAction = action;
    button.title = title || label;
    return button;
  }

  function createTableToolbarDom() {
    var toolbar = document.createElement('div');
    toolbar.className = 'pme-table-toolbar';
    toolbar.hidden = true;
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', '表操作');
    [
      ['+行上', 'add-row-before', '上に行を追加'],
      ['+行下', 'add-row-after', '下に行を追加'],
      ['+列左', 'add-column-before', '左に列を追加'],
      ['+列右', 'add-column-after', '右に列を追加'],
      ['行削除', 'delete-row', '行を削除'],
      ['列削除', 'delete-column', '列を削除'],
      ['表削除', 'delete-table', '表を削除'],
      ['左揃え', 'align-left', '選択列を左揃え'],
      ['中央揃え', 'align-center', '選択列を中央揃え'],
      ['右揃え', 'align-right', '選択列を右揃え']
    ].forEach(function(item) {
      toolbar.appendChild(createTableToolbarButton(item[0], item[1], item[2]));
    });
    return toolbar;
  }

  function positionTableToolbar(toolbar, tableElement) {
    if (!toolbar || !tableElement || !tableElement.isConnected) return false;
    toolbar.hidden = false;
    toolbar.classList.add('is-open');
    toolbar.style.visibility = 'hidden';
    toolbar.style.maxWidth = Math.max(240, window.innerWidth - 16) + 'px';
    var tableRect = tableElement.getBoundingClientRect();
    var toolbarRect = toolbar.getBoundingClientRect();
    var maxLeft = Math.max(8, window.innerWidth - toolbarRect.width - 8);
    var left = Math.min(Math.max(8, tableRect.left), maxLeft);
    var top = tableRect.top - toolbarRect.height - 8;
    if (top < 8) {
      var maxTop = Math.max(8, window.innerHeight - toolbarRect.height - 8);
      top = Math.min(Math.max(8, tableRect.bottom + 8), maxTop);
    }
    toolbar.style.left = left + 'px';
    toolbar.style.top = top + 'px';
    toolbar.style.visibility = '';
    return true;
  }

  function TableToolbarView(editorView) {
    var self = this;
    this.editorView = editorView;
    this.dom = createTableToolbarDom();
    this.frame = 0;
    this.onPointerDown = function(event) {
      event.preventDefault();
      event.stopPropagation();
    };
    this.onClick = function(event) {
      var target = event.target && event.target.closest ? event.target.closest('button[data-table-action]') : null;
      if (!target || !self.dom.contains(target)) return;
      event.preventDefault();
      event.stopPropagation();
      var command = tableToolbarCommand(target.dataset.tableAction);
      if (!command) return;
      command(self.editorView.state, self.editorView.dispatch, self.editorView);
      self.editorView.focus();
      self.schedulePosition();
    };
    this.onViewportChange = function() { self.schedulePosition(); };
    this.dom.addEventListener('pointerdown', this.onPointerDown);
    this.dom.addEventListener('click', this.onClick);
    document.body.appendChild(this.dom);
    window.addEventListener('resize', this.onViewportChange);
    document.addEventListener('scroll', this.onViewportChange, true);
    this.schedulePosition();
  }

  TableToolbarView.prototype.update = function(editorView) {
    this.editorView = editorView;
    this.schedulePosition();
  };

  TableToolbarView.prototype.schedulePosition = function() {
    var self = this;
    if (this.frame) return;
    this.frame = window.requestAnimationFrame(function() {
      self.frame = 0;
      self.position();
    });
  };

  TableToolbarView.prototype.position = function() {
    var tableElement = tableToolbarTableElement(this.editorView);
    if (!tableElement || !positionTableToolbar(this.dom, tableElement)) {
      this.dom.hidden = true;
      this.dom.classList.remove('is-open');
    }
  };

  TableToolbarView.prototype.destroy = function() {
    if (this.frame) window.cancelAnimationFrame(this.frame);
    this.dom.removeEventListener('pointerdown', this.onPointerDown);
    this.dom.removeEventListener('click', this.onClick);
    window.removeEventListener('resize', this.onViewportChange);
    document.removeEventListener('scroll', this.onViewportChange, true);
    this.dom.remove();
  };

  var tableToolbarPluginKey = new state.PluginKey('pmeTableToolbar');

  function tableToolbarPlugin() {
    return new state.Plugin({
      key: tableToolbarPluginKey,
      view: function(editorView) { return new TableToolbarView(editorView); }
    });
  }

  function insertHardBreakCommand(editorState, dispatch) {
    var hardBreak = schema.nodes.hard_break;
    if (!hardBreak || !editorState.selection.$from.parent.inlineContent) return false;
    if (dispatch) {
      dispatch(editorState.tr.replaceSelectionWith(hardBreak.create()).scrollIntoView());
    }
    return true;
  }

  function isListNode(node) {
    return Boolean(node && (node.type.name === 'bullet_list' || node.type.name === 'ordered_list'));
  }

  function lastTextblockInList(listNode, listStart) {
    var found = null;
    listNode.descendants(function(node, pos) {
      if (node.isTextblock) found = { node: node, pos: listStart + 1 + pos };
    });
    return found;
  }

  function joinParagraphAfterListIntoPreviousItem(editorState, dispatch) {
    var selection = editorState.selection;
    if (!selection.empty || selection.$from.parentOffset !== 0) return false;
    var paragraph = selection.$from.parent;
    if (paragraph.type.name !== 'paragraph' || paragraph.content.size === 0) return false;

    var paragraphDepth = selection.$from.depth;
    var parentDepth = paragraphDepth - 1;
    if (parentDepth < 0) return false;
    var index = selection.$from.index(parentDepth);
    if (index <= 0) return false;

    var parent = selection.$from.node(parentDepth);
    var previous = parent.child(index - 1);
    if (!isListNode(previous)) return false;

    var previousStart = selection.$from.posAtIndex(index - 1, parentDepth);
    var target = lastTextblockInList(previous, previousStart);
    if (!target) return false;
    var insertPos = target.pos + 1 + target.node.content.size;

    if (dispatch) {
      var tr = editorState.tr
        .delete(selection.$from.before(paragraphDepth), selection.$from.after(paragraphDepth))
        .insert(insertPos, paragraph.content);
      tr.setSelection(state.TextSelection.create(tr.doc, insertPos));
      dispatch(tr.scrollIntoView());
    }
    return true;
  }

  function listItemTextblockInfo(editorState, itemType) {
    var selection = editorState.selection;
    if (!selection || !selection.empty) return null;
    var $from = selection.$from;
    if (!$from.parent.isTextblock || $from.depth < 2) return null;
    var itemDepth = $from.depth - 1;
    var item = $from.node(itemDepth);
    if (!item || item.type !== itemType) return null;
    var blockIndex = $from.index(itemDepth);
    return {
      $from: $from,
      item: item,
      itemDepth: itemDepth,
      itemIndex: $from.index(itemDepth - 1),
      block: $from.parent,
      blockIndex: blockIndex,
      nextBlock: blockIndex + 1 < item.childCount ? item.child(blockIndex + 1) : null
    };
  }

  function outerListDepthForListItem($from, itemDepth, itemType) {
    var listDepth = itemDepth - 1;
    while (listDepth > 1 && $from.node(listDepth - 1).type === itemType) {
      listDepth -= 2;
    }
    return listDepth;
  }

  function repairEmptyListItemWithChildList(itemType) {
    return function(editorState, dispatch) {
      var info = listItemTextblockInfo(editorState, itemType);
      if (!info || info.block.content.size !== 0) return false;
      if (!isListNode(info.nextBlock) || info.itemIndex <= 0) return false;

      var parentDepth = info.itemDepth - 1;
      var parentList = info.$from.node(parentDepth);
      var previousItem = parentList.child(info.itemIndex - 1);
      if (!previousItem || previousItem.type !== itemType) return false;

      var movedChildren = [];
      for (var index = info.blockIndex + 1; index < info.item.childCount; index += 1) {
        movedChildren.push(info.item.child(index));
      }
      if (!movedChildren.length) return false;

      var paragraph = schema.nodes.paragraph;
      var previousStart = info.$from.posAtIndex(info.itemIndex - 1, parentDepth);
      var currentEnd = info.$from.after(info.itemDepth);
      var nextPreviousItem = previousItem.copy(previousItem.content.append(model.Fragment.fromArray(movedChildren)));
      var previousTextblock = nextPreviousItem.childCount ? nextPreviousItem.child(0) : null;
      if (!paragraph || !previousTextblock || !previousTextblock.isTextblock) return false;

      if (dispatch) {
        var tr = editorState.tr.replaceWith(previousStart, currentEnd, nextPreviousItem);
        var selectionPos = previousStart + 2 + previousTextblock.content.size;
        tr.setSelection(state.TextSelection.create(tr.doc, selectionPos));
        dispatch(tr.scrollIntoView());
      }
      return true;
    };
  }

  function exitEmptyListItemToParagraph(itemType) {
    return function(editorState, dispatch) {
      var info = listItemTextblockInfo(editorState, itemType);
      if (!info || info.block.content.size !== 0 || info.item.childCount !== 1) return false;
      var paragraph = schema.nodes.paragraph;
      if (!paragraph) return false;
      var parentListDepth = info.itemDepth - 1;
      var parentList = info.$from.node(parentListDepth);
      if (!isListNode(parentList) || info.itemIndex !== parentList.childCount - 1) return false;
      var exitListDepth = outerListDepthForListItem(info.$from, info.itemDepth, itemType);

      if (dispatch) {
        var paragraphNode = paragraph.create();
        var tr = editorState.tr;
        if (parentList.childCount === 1) {
          var listStart = info.$from.before(exitListDepth);
          var listEnd = info.$from.after(exitListDepth);
          tr.replaceWith(listStart, listEnd, paragraphNode);
          tr.setSelection(state.TextSelection.create(tr.doc, listStart + 1));
        } else {
          var itemStart = info.$from.before(info.itemDepth);
          var itemEnd = info.$from.after(info.itemDepth);
          var insertPos = info.$from.after(exitListDepth);
          tr.delete(itemStart, itemEnd);
          insertPos = tr.mapping.map(insertPos, -1);
          tr.insert(insertPos, paragraphNode);
          tr.setSelection(state.TextSelection.create(tr.doc, insertPos + 1));
        }
        dispatch(tr.scrollIntoView());
      }
      return true;
    };
  }

  function isWholeParagraphInputRange(editorState, start, end) {
    var $start = editorState.doc.resolve(start);
    var $end = editorState.doc.resolve(end);
    return $start.sameParent($end) &&
      $start.parent.type === schema.nodes.paragraph &&
      $start.parentOffset === 0 &&
      $end.parentOffset === $end.parent.content.size;
  }

  function paragraphText(node) {
    return node ? node.textBetween(0, node.content.size, '\n', '\uFFFC') : '';
  }

  function nodeArrayFromFragment(fragment) {
    var nodes = [];
    fragment.forEach(function(node) { nodes.push(node); });
    return nodes;
  }

  function nodeHasOnlyPlainText(node) {
    var plain = true;
    node.forEach(function(child) {
      if (!child.isText || child.marks.length) plain = false;
    });
    return plain;
  }

  function isPlainTopLevelParagraph(block) {
    return block && block.node.type === schema.nodes.paragraph && nodeHasOnlyPlainText(block.node);
  }

  function replacementNodesFromMarkdown(markdownText, predicate) {
    var parsed = parseMarkdown(markdownText);
    if (!parsed || !parsed.childCount || predicate && !predicate(parsed)) return null;
    return nodeArrayFromFragment(parsed.content);
  }

  function parsedSingleBlockNode(markdownText, nodeNames) {
    var parsed = parseMarkdown(markdownText);
    if (!parsed || parsed.childCount !== 1) return null;
    var node = parsed.firstChild;
    return nodeNames.indexOf(node.type.name) >= 0 ? node : null;
  }

  function inlineContainerSupportsMarkdownShape(node) {
    if (!node || node.type.spec.code || !node.inlineContent || !nodeHasOnlyPlainText(node)) return false;
    return node.type === schema.nodes.paragraph ||
      node.type === schema.nodes.table_cell ||
      node.type === schema.nodes.table_header;
  }

  function inlineMarkdownSourceLooksInteresting(text) {
    return /[`*_!\[\]$\\]/.test(String(text || ''));
  }

  function paragraphHasParsedInlineMarkdown(paragraph) {
    var found = false;
    paragraph.forEach(function(child) {
      if (!child.isText || child.marks.length) found = true;
    });
    return found;
  }

  function canonicalInlineMathSource(text) {
    return normalizeNewlines(text || '').trim().replace(/\\\(([^()\n]+)\\\)/g, function(match, latex) {
      return '$' + latex + '$';
    });
  }

  function parsedInlineMarkdownMatchesSource(text, parsed) {
    var source = normalizeNewlines(text || '').trim();
    if (!source || source.indexOf('$$') >= 0) return false;
    var serialized = serializeMarkdown(parsed).trim();
    return serialized === source || serialized === canonicalInlineMathSource(source);
  }

  function inlineMarkdownReplacementContent(text) {
    if (!inlineMarkdownSourceLooksInteresting(text)) return null;
    var parsed = parseMarkdown(text);
    if (!parsed || parsed.childCount !== 1 || parsed.firstChild.type !== schema.nodes.paragraph) return null;
    if (!parsedInlineMarkdownMatchesSource(text, parsed)) return null;
    if (!paragraphHasParsedInlineMarkdown(parsed.firstChild)) return null;
    return parsed.firstChild.content;
  }

  function looksLikeMarkdownBlock(text) {
    var source = normalizeNewlines(text || '');
    if (/\n/.test(source)) return true;
    return /^\s*(?:#{1,6}\s+\S|>\s+|\[toc\]\s*$|\$\$|```|~~~|\|.*\||(?:[-+*]|\d+[.)])\s+\S|(?:---|\*\*\*|___)\s*$)/.test(source);
  }

  function selectionInsideRange(selection, from, to) {
    if (!selection) return false;
    if (selection.empty) return selection.from >= from && selection.from <= to;
    return selection.from < to && selection.to > from;
  }

  function replaceParagraphWithBlockAndTrailingParagraph(editorState, start, end, blockNode) {
    if (!schema.nodes.paragraph || !isWholeParagraphInputRange(editorState, start, end)) return null;
    var $start = editorState.doc.resolve(start);
    var from = $start.before();
    var to = $start.after();
    var paragraph = schema.nodes.paragraph.create();
    var tr = editorState.tr.replaceWith(from, to, [blockNode, paragraph]);
    return tr.setSelection(state.TextSelection.create(tr.doc, from + blockNode.nodeSize + 1)).scrollIntoView();
  }

  function inlineMathInputRule() {
    if (!schema.nodes.math_inline) return null;
    return new inputRulesModule.InputRule(/(^|[^\\$])\$([^$\n]+)\$$/, function(editorState, match, start, end) {
      var prefix = match[1] || '';
      var latex = match[2] || '';
      if (!latex.trim()) return null;
      var replaceStart = start + prefix.length;
      var tr = editorState.tr.delete(replaceStart, end);
      tr.insert(replaceStart, schema.nodes.math_inline.create({ latex: latex }));
      tr.setSelection(state.TextSelection.create(tr.doc, replaceStart + 1));
      return clearStoredMarks(tr.scrollIntoView());
    });
  }

  function parenMathInputRule() {
    if (!schema.nodes.math_inline) return null;
    return new inputRulesModule.InputRule(/\\\(([^()\n]+)\\\)$/, function(editorState, match, start, end) {
      var latex = match[1] || '';
      if (!latex.trim()) return null;
      var tr = editorState.tr.delete(start, end);
      tr.insert(start, schema.nodes.math_inline.create({ latex: latex }));
      tr.setSelection(state.TextSelection.create(tr.doc, start + 1));
      return clearStoredMarks(tr.scrollIntoView());
    });
  }

  function mathDisplayInputRule() {
    if (!schema.nodes.math_display) return null;
    return new inputRulesModule.InputRule(/^\$\$\s*([^\n]*?\S[^\n]*?)\s*\$\$$/, function(editorState, match, start, end) {
      var latex = match[1] || '';
      return replaceParagraphWithBlockAndTrailingParagraph(editorState, start, end, schema.nodes.math_display.create({ latex: latex }));
    });
  }

  function tocInputRule() {
    if (!schema.nodes.toc_block) return null;
    return new inputRulesModule.InputRule(/^\[toc\]$/i, function(editorState, match, start, end) {
      return replaceParagraphWithBlockAndTrailingParagraph(editorState, start, end, schema.nodes.toc_block.create());
    });
  }

  function topLevelBlockInfos(doc) {
    var blocks = [];
    doc.forEach(function(node, offset) {
      blocks.push({ node: node, pos: offset });
    });
    return blocks;
  }

  function topLevelParagraphSelectionInfo(editorState) {
    var selection = editorState.selection;
    if (!selection || !selection.empty || selection.$from.depth !== 1) return null;
    if (selection.$from.parent.type !== schema.nodes.paragraph) return null;
    var pos = selection.$from.before(1);
    var blocks = topLevelBlockInfos(editorState.doc);
    for (var index = 0; index < blocks.length; index += 1) {
      if (blocks[index].pos === pos) return { blocks: blocks, index: index };
    }
    return null;
  }

  function replaceTopLevelBlocksWithBlockAndTrailingParagraph(editorState, dispatch, blocks, startIndex, endIndex, blockNode) {
    if (!dispatch || !schema.nodes.paragraph) return true;
    var from = blocks[startIndex].pos;
    var to = blocks[endIndex].pos + blocks[endIndex].node.nodeSize;
    var paragraph = schema.nodes.paragraph.create();
    var tr = editorState.tr.replaceWith(from, to, [blockNode, paragraph]);
    tr.setSelection(state.TextSelection.create(tr.doc, from + blockNode.nodeSize + 1));
    dispatch(tr.scrollIntoView());
    return true;
  }

  function mathDisplayBlockCandidate(blocks, endIndex) {
    if (!schema.nodes.math_display || !/^\s*\$\$\s*$/.test(paragraphText(blocks[endIndex].node))) return null;
    for (var index = endIndex - 1; index >= 0; index -= 1) {
      if (blocks[index].node.type !== schema.nodes.paragraph) break;
      if (!/^\s*\$\$\s*$/.test(paragraphText(blocks[index].node))) continue;
      var lines = [];
      for (var lineIndex = index + 1; lineIndex < endIndex; lineIndex += 1) {
        if (blocks[lineIndex].node.type !== schema.nodes.paragraph) return null;
        lines.push(paragraphText(blocks[lineIndex].node));
      }
      var latex = lines.join('\n').replace(/\n+$/g, '');
      if (!latex.trim()) return null;
      return { startIndex: index, endIndex: endIndex, node: schema.nodes.math_display.create({ latex: latex }) };
    }
    return null;
  }

  function mermaidBlockCandidate(blocks, endIndex) {
    if (!schema.nodes.mermaid_block || !/^\s*```\s*$/.test(paragraphText(blocks[endIndex].node))) return null;
    for (var index = endIndex - 1; index >= 0; index -= 1) {
      if (blocks[index].node.type !== schema.nodes.paragraph) break;
      if (!/^\s*```mermaid(?:\s.*)?$/i.test(paragraphText(blocks[index].node))) continue;
      var lines = [];
      for (var lineIndex = index + 1; lineIndex < endIndex; lineIndex += 1) {
        if (blocks[lineIndex].node.type !== schema.nodes.paragraph) return null;
        lines.push(paragraphText(blocks[lineIndex].node));
      }
      return { startIndex: index, endIndex: endIndex, node: schema.nodes.mermaid_block.create({ source: lines.join('\n').replace(/\n+$/g, '') }) };
    }
    return null;
  }

  function splitPipeTableLine(line) {
    var text = escapeInlineMathPipesInTableLine(line).trim();
    if (text.charAt(0) === '|') text = text.slice(1);
    if (text.charAt(text.length - 1) === '|') text = text.slice(0, -1);
    var cells = [];
    var current = '';
    for (var index = 0; index < text.length; index += 1) {
      var character = text.charAt(index);
      if (character === '|' && text.charAt(index - 1) !== '\\') {
        cells.push(current.trim());
        current = '';
      } else {
        current += character;
      }
    }
    cells.push(current.trim());
    return cells;
  }

  function isPipeTableLine(line) {
    return /^\s*\|.*\|\s*$/.test(String(line || ''));
  }

  function isPipeTableDelimiterCell(cell) {
    return /^:?-{3,}:?$/.test(String(cell || '').trim());
  }

  function pipeTableNodeFromLines(lines) {
    if (!schema.nodes.table || lines.length < 2) return null;
    for (var index = 0; index < lines.length; index += 1) {
      if (!isPipeTableLine(lines[index])) return null;
    }
    var headerCells = splitPipeTableLine(lines[0]);
    var delimiterCells = splitPipeTableLine(lines[1]);
    if (!headerCells.length || headerCells.length !== delimiterCells.length) return null;
    for (var delimiterIndex = 0; delimiterIndex < delimiterCells.length; delimiterIndex += 1) {
      if (!isPipeTableDelimiterCell(delimiterCells[delimiterIndex])) return null;
    }
    for (var rowIndex = 2; rowIndex < lines.length; rowIndex += 1) {
      if (splitPipeTableLine(lines[rowIndex]).length !== delimiterCells.length) return null;
    }
    var parsed = parseMarkdown(lines.join('\n'));
    if (parsed.childCount !== 1 || parsed.firstChild.type !== schema.nodes.table) return null;
    return parsed.firstChild;
  }

  function tableInputRuleOrCommandCandidate(blocks, endIndex) {
    if (!schema.nodes.table || blocks[endIndex].node.type !== schema.nodes.paragraph) return null;
    var lines = [];
    for (var index = endIndex; index >= 0; index -= 1) {
      if (blocks[index].node.type !== schema.nodes.paragraph) break;
      lines.unshift(paragraphText(blocks[index].node));
      var tableNode = pipeTableNodeFromLines(lines);
      if (tableNode) return { startIndex: index, endIndex: endIndex, node: tableNode };
    }
    return null;
  }

  function closedFenceCandidate(blocks, startIndex) {
    if (!isPlainTopLevelParagraph(blocks[startIndex])) return null;
    var opening = paragraphText(blocks[startIndex].node);
    var match = opening.match(/^\s*(```+|~~~+)([^\n]*)$/);
    if (!match) return null;
    var fence = match[1];
    var marker = fence.charAt(0);
    var minLength = fence.length;
    var closingPattern = new RegExp('^\\s*' + marker + '{' + minLength + ',}\\s*$');
    for (var index = startIndex + 1; index < blocks.length; index += 1) {
      if (!isPlainTopLevelParagraph(blocks[index])) break;
      if (!closingPattern.test(paragraphText(blocks[index].node))) continue;
      var lines = [];
      for (var lineIndex = startIndex; lineIndex <= index; lineIndex += 1) {
        lines.push(paragraphText(blocks[lineIndex].node));
      }
      var nodes = replacementNodesFromMarkdown(lines.join('\n'), function(parsed) {
        return parsed.childCount === 1 &&
          ['code_block', 'mermaid_block'].indexOf(parsed.firstChild.type.name) >= 0;
      });
      if (!nodes) return null;
      return { from: blocks[startIndex].pos, to: blocks[index].pos + blocks[index].node.nodeSize, nodes: nodes };
    }
    return null;
  }

  function closedMathDisplayCandidate(blocks, startIndex) {
    if (!isPlainTopLevelParagraph(blocks[startIndex])) return null;
    var firstLine = paragraphText(blocks[startIndex].node);
    var oneLine = parsedSingleBlockNode(firstLine, ['math_display']);
    if (oneLine) return { from: blocks[startIndex].pos, to: blocks[startIndex].pos + blocks[startIndex].node.nodeSize, nodes: [oneLine] };
    if (!/^\s*\$\$\s*$/.test(firstLine)) return null;
    for (var index = startIndex + 1; index < blocks.length; index += 1) {
      if (!isPlainTopLevelParagraph(blocks[index])) break;
      if (!/^\s*\$\$\s*$/.test(paragraphText(blocks[index].node))) continue;
      var lines = [];
      for (var lineIndex = startIndex; lineIndex <= index; lineIndex += 1) {
        lines.push(paragraphText(blocks[lineIndex].node));
      }
      var node = parsedSingleBlockNode(lines.join('\n'), ['math_display']);
      if (!node) return null;
      return { from: blocks[startIndex].pos, to: blocks[index].pos + blocks[index].node.nodeSize, nodes: [node] };
    }
    return null;
  }

  function pipeTableShapeCandidate(blocks, startIndex) {
    if (!schema.nodes.table || !isPlainTopLevelParagraph(blocks[startIndex])) return null;
    var lines = [];
    var endIndex = startIndex;
    for (; endIndex < blocks.length; endIndex += 1) {
      if (!isPlainTopLevelParagraph(blocks[endIndex])) break;
      var line = paragraphText(blocks[endIndex].node);
      if (!isPipeTableLine(line)) break;
      lines.push(line);
    }
    if (lines.length < 2) return null;
    var tableNode = pipeTableNodeFromLines(lines);
    if (!tableNode) return null;
    return { from: blocks[startIndex].pos, to: blocks[startIndex + lines.length - 1].pos + blocks[startIndex + lines.length - 1].node.nodeSize, nodes: [tableNode] };
  }

  function listShapeCandidate(blocks, startIndex) {
    if (!isPlainTopLevelParagraph(blocks[startIndex])) return null;
    if (!/^\s*(?:[-+*]|\d+[.)])\s+\S/.test(paragraphText(blocks[startIndex].node))) return null;
    var lines = [];
    var endIndex = startIndex;
    for (; endIndex < blocks.length; endIndex += 1) {
      if (!isPlainTopLevelParagraph(blocks[endIndex])) break;
      var line = paragraphText(blocks[endIndex].node);
      if (!/^\s*(?:[-+*]|\d+[.)])\s+\S/.test(line)) break;
      lines.push(line);
    }
    var nodes = replacementNodesFromMarkdown(lines.join('\n'), function(parsed) {
      return parsed.childCount >= 1 && ['bullet_list', 'ordered_list'].indexOf(parsed.firstChild.type.name) >= 0;
    });
    if (!nodes) return null;
    return { from: blocks[startIndex].pos, to: blocks[startIndex + lines.length - 1].pos + blocks[startIndex + lines.length - 1].node.nodeSize, nodes: nodes };
  }

  function blockquoteShapeCandidate(blocks, startIndex) {
    if (!isPlainTopLevelParagraph(blocks[startIndex])) return null;
    if (!/^\s*>\s+\S/.test(paragraphText(blocks[startIndex].node))) return null;
    var lines = [];
    var endIndex = startIndex;
    for (; endIndex < blocks.length; endIndex += 1) {
      if (!isPlainTopLevelParagraph(blocks[endIndex])) break;
      var line = paragraphText(blocks[endIndex].node);
      if (!/^\s*>\s*(?:\S.*)?$/.test(line)) break;
      lines.push(line);
    }
    var node = parsedSingleBlockNode(lines.join('\n'), ['blockquote']);
    if (!node) return null;
    return { from: blocks[startIndex].pos, to: blocks[startIndex + lines.length - 1].pos + blocks[startIndex + lines.length - 1].node.nodeSize, nodes: [node] };
  }

  function singleLineBlockShapeCandidate(blocks, startIndex, selection) {
    if (!isPlainTopLevelParagraph(blocks[startIndex])) return null;
    var line = paragraphText(blocks[startIndex].node);
    var node = null;
    if (/^\s*#{1,6}\s+\S/.test(line)) node = parsedSingleBlockNode(line, ['heading']);
    else if (/^\s*\[toc\]\s*$/i.test(line)) node = parsedSingleBlockNode(line, ['toc_block']);
    else if (/^\s*(?:---|\*\*\*|___)\s*$/.test(line)) {
      var from = blocks[startIndex].pos;
      var to = from + blocks[startIndex].node.nodeSize;
      if (selectionInsideRange(selection, from, to)) return null;
      node = parsedSingleBlockNode(line, ['horizontal_rule']);
    }
    if (!node) return null;
    return { from: blocks[startIndex].pos, to: blocks[startIndex].pos + blocks[startIndex].node.nodeSize, nodes: [node] };
  }

  function markdownBlockShapeCandidate(blocks, startIndex, selection) {
    return closedFenceCandidate(blocks, startIndex) ||
      closedMathDisplayCandidate(blocks, startIndex) ||
      pipeTableShapeCandidate(blocks, startIndex) ||
      listShapeCandidate(blocks, startIndex) ||
      blockquoteShapeCandidate(blocks, startIndex) ||
      singleLineBlockShapeCandidate(blocks, startIndex, selection);
  }

  function collectMarkdownBlockShapeCandidates(doc, selection) {
    var blocks = topLevelBlockInfos(doc);
    var candidates = [];
    for (var index = 0; index < blocks.length; index += 1) {
      var candidate = markdownBlockShapeCandidate(blocks, index, selection);
      if (!candidate) continue;
      candidates.push(candidate);
      while (index + 1 < blocks.length && blocks[index + 1].pos < candidate.to) index += 1;
    }
    return candidates;
  }

  function collectInlineMarkdownShapeCandidates(doc) {
    var candidates = [];
    doc.descendants(function(node, pos) {
      if (!inlineContainerSupportsMarkdownShape(node)) return true;
      var text = paragraphText(node);
      var content = inlineMarkdownReplacementContent(text);
      if (!content) return true;
      candidates.push({ from: pos + 1, to: pos + 1 + node.content.size, nodes: content });
      return true;
    });
    return candidates;
  }

  var markdownShapeNormalizationKey = new state.PluginKey('pmeMarkdownShapeNormalization');

  function markdownShapeNormalizationPlugin() {
    return new state.Plugin({
      key: markdownShapeNormalizationKey,
      appendTransaction: function(transactions, oldState, newState) {
        if (!transactions.some(function(transaction) { return transaction.docChanged || transaction.selectionSet; })) return null;
        if (transactions.some(function(transaction) { return transaction.getMeta(markdownShapeNormalizationKey); })) return null;
        var blockCandidates = collectMarkdownBlockShapeCandidates(newState.doc, newState.selection);
        var inlineCandidates = collectInlineMarkdownShapeCandidates(newState.doc).filter(function(candidate) {
          return !blockCandidates.some(function(blockCandidate) {
            return blockCandidate.from <= candidate.from && candidate.to <= blockCandidate.to;
          });
        });
        var candidates = blockCandidates.concat(inlineCandidates);
        if (!candidates.length) return null;
        candidates.sort(function(left, right) { return right.from - left.from; });
        var tr = newState.tr;
        for (var index = 0; index < candidates.length; index += 1) {
          var candidate = candidates[index];
          tr.replaceWith(candidate.from, candidate.to, candidate.nodes);
        }
        tr.setMeta(markdownShapeNormalizationKey, true);
        return tr.docChanged ? tr.scrollIntoView() : null;
      }
    });
  }

  var emptyTextblockStoredMarksCleanupKey = new state.PluginKey('pmeEmptyTextblockStoredMarksCleanup');

  function selectionIsEmptyInlineTextblock(selection) {
    return Boolean(selection && selection.empty && selection.$from.parent.inlineContent && selection.$from.parent.content.size === 0);
  }

  function emptyTextblockStoredMarksCleanupPlugin() {
    return new state.Plugin({
      key: emptyTextblockStoredMarksCleanupKey,
      appendTransaction: function(transactions, oldState, newState) {
        if (!transactions.some(function(transaction) { return transaction.docChanged; })) return null;
        if (transactions.some(function(transaction) { return transaction.getMeta(emptyTextblockStoredMarksCleanupKey); })) return null;
        if (!newState.storedMarks || !newState.storedMarks.length) return null;
        if (!selectionIsEmptyInlineTextblock(newState.selection)) return null;
        var tr = clearStoredMarks(newState.tr);
        tr.setMeta(emptyTextblockStoredMarksCleanupKey, true);
        return tr;
      }
    });
  }

  var editableTrailingParagraphKey = new state.PluginKey('pmeEditableTrailingParagraph');

  function editableTrailingParagraphPlugin() {
    return new state.Plugin({
      key: editableTrailingParagraphKey,
      appendTransaction: function(transactions, oldState, newState) {
        if (!transactions.some(function(transaction) { return transaction.docChanged; })) return null;
        if (transactions.some(function(transaction) { return transaction.getMeta(editableTrailingParagraphKey); })) return null;
        if (isEmptyParagraphNode(newState.doc.lastChild)) return null;
        var tr = newState.tr.insert(newState.doc.content.size, schema.nodes.paragraph.create());
        tr.setMeta(editableTrailingParagraphKey, true);
        return tr;
      }
    });
  }

  function extendedBlockInputCommand(editorState, dispatch) {
    var info = topLevelParagraphSelectionInfo(editorState);
    if (!info) return false;
    var candidates = [
      mermaidBlockCandidate(info.blocks, info.index),
      mathDisplayBlockCandidate(info.blocks, info.index),
      tableInputRuleOrCommandCandidate(info.blocks, info.index)
    ];
    for (var index = 0; index < candidates.length; index += 1) {
      var candidate = candidates[index];
      if (candidate) {
        return replaceTopLevelBlocksWithBlockAndTrailingParagraph(
          editorState,
          dispatch,
          info.blocks,
          candidate.startIndex,
          candidate.endIndex,
          candidate.node
        );
      }
    }
    return false;
  }

  function fencedCodeBlockInputCommand(editorState, dispatch) {
    if (!schema.nodes.code_block) return false;
    var info = topLevelParagraphSelectionInfo(editorState);
    if (!info) return false;
    var text = paragraphText(info.blocks[info.index].node);
    if (!/^\s*(?:```|~~~)\s*$/.test(text)) return false;
    if (dispatch) {
      var from = info.blocks[info.index].pos;
      var to = from + info.blocks[info.index].node.nodeSize;
      var codeBlock = schema.nodes.code_block.create();
      var tr = editorState.tr.replaceWith(from, to, codeBlock);
      tr.setSelection(state.TextSelection.create(tr.doc, from + 1));
      dispatch(tr.scrollIntoView());
    }
    return true;
  }

  function clearStoredMarks(transaction) {
    return transaction.setStoredMarks ? transaction.setStoredMarks([]) : transaction;
  }

  function markFromSet(marks, markType) {
    if (!marks || !markType) return null;
    return markType.isInSet(marks);
  }

  function activeMarksForVisualAffordance(editorState) {
    return editorState.storedMarks == null ? editorState.selection.$from.marks() : editorState.storedMarks;
  }

  function sourceMarkerText(mark, side) {
    if (!mark) return null;
    if (mark.type === schema.marks.strong) return '**';
    if (mark.type === schema.marks.em) return '*';
    if (mark.type === schema.marks.strike) return '~~';
    if (mark.type === schema.marks.link) {
      if (side === 'before') return '[';
      var href = String(mark.attrs && mark.attrs.href || '');
      var compactHref = href.length > 28 ? href.slice(0, 25) + '...' : href;
      return '](' + compactHref + ')';
    }
    return null;
  }

  function simpleSourceMarkerWidget(mark, side) {
    return function() {
      var marker = document.createElement('span');
      marker.className = 'pme-inline-source-token pme-inline-source-token--' + side;
      marker.setAttribute('aria-hidden', 'true');
      marker.setAttribute('contenteditable', 'false');
      marker.textContent = sourceMarkerText(mark, side) || '';
      return marker;
    };
  }

  function linkMarkRangeAtPosition(doc, pos) {
    if (!schema.marks.link) return null;
    var bounded = Math.max(0, Math.min(pos, doc.content.size));
    var $pos = doc.resolve(bounded);
    if (!$pos.parent.inlineContent) return null;
    var parentOffset = $pos.parentOffset;
    var children = [];
    $pos.parent.forEach(function(node, offset) {
      children.push({ node: node, offset: offset, mark: schema.marks.link.isInSet(node.marks || []) });
    });
    var index = -1;
    for (var childIndex = 0; childIndex < children.length; childIndex += 1) {
      var child = children[childIndex];
      var childEnd = child.offset + child.node.nodeSize;
      if (child.mark && child.offset <= parentOffset && parentOffset <= childEnd) {
        index = childIndex;
        break;
      }
    }
    if (index < 0) return null;
    var mark = children[index].mark;
    var startIndex = index;
    while (startIndex > 0 && children[startIndex - 1].mark && children[startIndex - 1].mark.eq(mark)) startIndex -= 1;
    var endIndex = index;
    while (endIndex + 1 < children.length && children[endIndex + 1].mark && children[endIndex + 1].mark.eq(mark)) endIndex += 1;
    var from = $pos.start() + children[startIndex].offset;
    var to = $pos.start() + children[endIndex].offset + children[endIndex].node.nodeSize;
    return from < to ? { from: from, to: to, mark: mark } : null;
  }

  function updateLinkHref(editorView, getPos, fallbackRange, nextHref) {
    if (!editorView || !schema.marks.link) return false;
    var pos = typeof getPos === 'function' ? getPos() : fallbackRange && fallbackRange.to;
    var range = Number.isInteger(pos) ? linkMarkRangeAtPosition(editorView.state.doc, pos) : null;
    if (!range && fallbackRange) {
      range = {
        from: fallbackRange.from,
        to: fallbackRange.to,
        mark: fallbackRange.mark
      };
    }
    if (!range || !range.mark || range.mark.type !== schema.marks.link) return false;
    var href = String(nextHref || '').trim();
    if (String(range.mark.attrs && range.mark.attrs.href || '') === href) return false;
    var attrs = extendObject(range.mark.attrs || {}, { href: href });
    var tr = editorView.state.tr
      .removeMark(range.from, range.to, schema.marks.link)
      .addMark(range.from, range.to, schema.marks.link.create(attrs));
    editorView.dispatch(tr);
    return true;
  }

  var activeLinkHrefPopover = null;
  var linkHrefArrowExit = null;

  function linkHrefPopoverInput(popover) {
    return popover && popover.querySelector ? popover.querySelector('.pme-link-href-input') : null;
  }

  function autoSizeLinkHrefInput(input) {
    if (!input || input.nodeName !== 'TEXTAREA') return;
    var viewportHeight = global.innerHeight || document.documentElement.clientHeight || 768;
    input.style.height = 'auto';
    input.style.height = Math.min(Math.max(72, input.scrollHeight), Math.max(120, Math.floor(viewportHeight * 0.4))) + 'px';
  }

  function ensureLinkHrefPopover() {
    var popover = document.querySelector('body > .pme-link-href-popover');
    if (popover) return popover;
    popover = document.createElement('span');
    var before = document.createElement('span');
    var after = document.createElement('span');
    var input = document.createElement('textarea');
    popover.className = 'pme-link-href-popover';
    before.className = 'pme-inline-source-token pme-inline-source-token--link-url-before';
    before.textContent = '](';
    after.className = 'pme-inline-source-token pme-inline-source-token--link-url-after';
    after.textContent = ')';
    input.className = 'pme-link-href-input';
    input.rows = 3;
    input.wrap = 'soft';
    input.setAttribute('aria-label', 'link URL');
    input.setAttribute('spellcheck', 'false');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('autocapitalize', 'off');
    popover.appendChild(before);
    popover.appendChild(input);
    popover.appendChild(after);
    document.body.appendChild(popover);
    input.addEventListener('input', function() {
      autoSizeLinkHrefInput(input);
      if (!activeLinkHrefPopover) return;
      updateLinkHref(activeLinkHrefPopover.editorView, activeLinkHrefPopover.getPos, activeLinkHrefPopover.range, input.value);
      positionLinkHrefPopover();
    });
    input.addEventListener('keydown', function(event) {
      if (event.key === 'Enter' || event.key === 'Escape') {
        event.preventDefault();
        hideLinkHrefPopover(true);
      }
    });
    input.addEventListener('blur', function() {
      setTimeout(function() {
        if (document.activeElement !== input) hideLinkHrefPopover(false);
      }, 0);
    });
    ['pointerdown', 'mousedown', 'mouseup', 'click', 'dblclick', 'touchstart'].forEach(function(type) {
      popover.addEventListener(type, function(event) {
        event.stopPropagation();
      }, true);
    });
    return popover;
  }

  function linkHrefAnchorForRange(editorView, range) {
    if (!editorView || !range) return null;
    var selector = '.pme-link-href-editor[data-link-from="' + range.from + '"][data-link-to="' + range.to + '"]';
    var widget = editorView.dom.querySelector(selector);
    if (widget) return widget;
    try {
      var domAt = editorView.domAtPos(Math.max(range.from, range.to - 1));
      var node = domAt && domAt.node;
      var element = node && node.nodeType === 1 ? node : node && node.parentElement;
      return element && element.closest ? element.closest('a') : null;
    } catch (error) {
      return null;
    }
  }

  function positionLinkHrefPopover() {
    if (!activeLinkHrefPopover || !activeLinkHrefPopover.anchor || !activeLinkHrefPopover.popover) return;
    var anchor = activeLinkHrefPopover.anchor;
    var popover = activeLinkHrefPopover.popover;
    if (!anchor || !anchor.isConnected) {
      anchor = linkHrefAnchorForRange(activeLinkHrefPopover.editorView, activeLinkHrefPopover.range) || anchor;
      activeLinkHrefPopover.anchor = anchor;
    }
    if (!anchor || typeof anchor.getBoundingClientRect !== 'function') return;
    var rect = anchor.getBoundingClientRect();
    var viewportWidth = global.innerWidth || document.documentElement.clientWidth || 1024;
    var viewportHeight = global.innerHeight || document.documentElement.clientHeight || 768;
    var margin = 12;
    var width = Math.min(Math.max(popover.offsetWidth || 180, 120), viewportWidth - margin * 2);
    var left = clampNumber(rect.left, margin, viewportWidth - width - margin);
    var top = rect.top + (rect.height - (popover.offsetHeight || rect.height)) / 2;
    popover.style.position = 'fixed';
    popover.style.left = left + 'px';
    popover.style.top = clampNumber(top, margin, viewportHeight - (popover.offsetHeight || rect.height) - margin) + 'px';
    popover.style.zIndex = '1000';
  }

  function hideLinkHrefPopover(refocusEditor) {
    if (!activeLinkHrefPopover) return;
    var active = activeLinkHrefPopover;
    activeLinkHrefPopover = null;
    if (active.popover) active.popover.classList.remove('is-open');
    if (refocusEditor && active.editorView) {
      var exitPos = Math.max(0, Math.min(active.range.to, active.editorView.state.doc.content.size));
      var exitSelection = state.TextSelection.create(active.editorView.state.doc, exitPos);
      active.editorView.dispatch(clearStoredMarks(active.editorView.state.tr.setSelection(exitSelection)).scrollIntoView());
      linkHrefArrowExit = { editorView: active.editorView, pos: active.range.to };
      active.editorView.focus();
    }
  }

  function showLinkHrefPopover(editorView, getPos, range, mark, anchor) {
    var popover = ensureLinkHrefPopover();
    var input = linkHrefPopoverInput(popover);
    if (!input) return false;
    linkHrefArrowExit = null;
    input.value = String(mark.attrs && mark.attrs.href || '');
    autoSizeLinkHrefInput(input);
    activeLinkHrefPopover = {
      editorView: editorView,
      getPos: getPos,
      range: { from: range.from, to: range.to, mark: mark },
      anchor: anchor,
      popover: popover
    };
    popover.classList.add('is-open');
    positionLinkHrefPopover();
    setTimeout(function() {
      try {
        input.focus({ preventScroll: true });
      } catch (error) {
        input.focus();
      }
      if (document.activeElement === input && typeof input.setSelectionRange === 'function') {
        input.setSelectionRange(0, input.value.length);
      }
    }, 0);
    return true;
  }

  function linkHrefEditorWidget(mark, range) {
    return function(editorView, getPos) {
      var wrapper = document.createElement('span');
      var before = document.createElement('span');
      var after = document.createElement('span');
      var value = document.createElement('span');
      wrapper.className = 'pme-link-href-editor ProseMirror-widget';
      wrapper.setAttribute('contenteditable', 'false');
      wrapper.setAttribute('data-link-from', String(range.from));
      wrapper.setAttribute('data-link-to', String(range.to));
      before.className = 'pme-inline-source-token pme-inline-source-token--link-url-before';
      before.textContent = '](';
      after.className = 'pme-inline-source-token pme-inline-source-token--link-url-after';
      after.textContent = ')';
      value.className = 'pme-link-href-value';
      value.textContent = String(mark.attrs && mark.attrs.href || '');
      ['pointerdown', 'mousedown', 'touchstart'].forEach(function(type) {
        wrapper.addEventListener(type, function(event) {
          event.preventDefault();
          event.stopPropagation();
          showLinkHrefPopover(editorView, getPos, range, mark, wrapper);
        }, true);
      });
      ['mouseup', 'click', 'dblclick'].forEach(function(type) {
        wrapper.addEventListener(type, function(event) {
          event.stopPropagation();
        }, true);
      });
      wrapper.appendChild(before);
      wrapper.appendChild(value);
      wrapper.appendChild(after);
      return wrapper;
    };
  }

  function sourceMarkerWidget(mark, side, range) {
    if (mark && mark.type === schema.marks.link && side === 'after' && range) {
      return linkHrefEditorWidget(mark, { from: range.from, to: range.to, mark: mark });
    }
    return simpleSourceMarkerWidget(mark, side);
  }

  function stopLinkHrefEditorEvent(event) {
    var target = event && event.target;
    return Boolean(target && target.closest && target.closest('.pme-link-href-editor'));
  }

  function codeBoundarySpacerWidget() {
    var spacer = document.createElement('span');
    spacer.className = 'pme-inline-code-boundary-spacer';
    spacer.setAttribute('aria-hidden', 'true');
    spacer.setAttribute('contenteditable', 'false');
    return spacer;
  }

  function isCodeOutsideInlineBoundary(editorState) {
    var selection = editorState.selection;
    if (!shouldClearStoredMarksAtInlineBoundary(selection)) return false;
    var activeMarks = activeMarksForVisualAffordance(editorState);
    var before = selection.$from.nodeBefore;
    return Boolean(markFromSet(before && before.marks, schema.marks.code) &&
      !markFromSet(activeMarks, schema.marks.code));
  }

  function markRangeAroundSelection(selection, mark) {
    if (!selection || !selection.empty || !mark) return null;
    var $from = selection.$from;
    if (!$from.parent.inlineContent) return null;
    var parentOffset = $from.parentOffset;
    var children = [];
    $from.parent.forEach(function(node, offset) {
      children.push({ node: node, offset: offset, mark: mark.type.isInSet(node.marks || []) });
    });
    var index = -1;
    for (var childIndex = 0; childIndex < children.length; childIndex += 1) {
      var child = children[childIndex];
      var childEnd = child.offset + child.node.nodeSize;
      if (child.mark && child.mark.eq(mark) && child.offset <= parentOffset && parentOffset <= childEnd) {
        index = childIndex;
        break;
      }
    }
    if (index < 0) return null;
    var startIndex = index;
    while (startIndex > 0 && children[startIndex - 1].mark && children[startIndex - 1].mark.eq(mark)) startIndex -= 1;
    var endIndex = index;
    while (endIndex + 1 < children.length && children[endIndex + 1].mark && children[endIndex + 1].mark.eq(mark)) endIndex += 1;
    var from = $from.start() + children[startIndex].offset;
    var to = $from.start() + children[endIndex].offset + children[endIndex].node.nodeSize;
    return from < to ? { from: from, to: to } : null;
  }

  function enterLinkHrefEditorAtBoundaryCommand(editorState, dispatch, editorView) {
    var selection = editorState.selection;
    if (!editorView || !selection || !selection.empty || !selection.$from.parent.inlineContent) return false;
    if (linkHrefArrowExit) {
      var shouldExit = linkHrefArrowExit.editorView === editorView && linkHrefArrowExit.pos === selection.from;
      linkHrefArrowExit = null;
      if (shouldExit) return false;
    }
    var range = linkMarkRangeAtPosition(editorState.doc, selection.from);
    if (!range) return false;
    if (selection.from < range.to) {
      if (dispatch) dispatch(editorState.tr.setSelection(state.TextSelection.create(editorState.doc, selection.from + 1)).scrollIntoView());
      return true;
    }
    var anchor = linkHrefAnchorForRange(editorView, range);
    if (!anchor) return false;
    if (dispatch) showLinkHrefPopover(editorView, function() { return range.to; }, range, range.mark, anchor);
    return true;
  }

  function inlineAffordanceMark(editorState) {
    var selection = editorState.selection;
    if (!selection || !selection.empty || !selection.$from.parent.inlineContent) return null;
    var marks = activeMarksForVisualAffordance(editorState);
    return markFromSet(marks, schema.marks.link) ||
      markFromSet(marks, schema.marks.strong) ||
      markFromSet(marks, schema.marks.em) ||
      markFromSet(marks, schema.marks.strike);
  }

  function inlineVisualAffordanceDecorations(editorState) {
    var decorations = [];
    var selection = editorState.selection;
    if (isCodeOutsideInlineBoundary(editorState)) {
      decorations.push(view.Decoration.widget(selection.from, codeBoundarySpacerWidget, {
        key: 'pme-inline-code-boundary-spacer',
        side: 1
      }));
    }

    var mark = inlineAffordanceMark(editorState);
    var range = markRangeAroundSelection(selection, mark);
    if (mark && range) {
      decorations.push(view.Decoration.widget(range.from, sourceMarkerWidget(mark, 'before', range), {
        key: 'pme-inline-source-before-' + mark.type.name + '-' + range.from,
        side: -1
      }));
      decorations.push(view.Decoration.widget(range.to, sourceMarkerWidget(mark, 'after', range), {
        key: 'pme-inline-source-after-' + mark.type.name + '-' + range.to,
        side: 1,
        stopEvent: stopLinkHrefEditorEvent
      }));
    }

    return decorations.length ? view.DecorationSet.create(editorState.doc, decorations) : null;
  }

  function inlineVisualAffordancePlugin() {
    return new state.Plugin({
      props: {
        decorations: inlineVisualAffordanceDecorations,
        attributes: function(editorState) {
          return isCodeOutsideInlineBoundary(editorState) ? { class: 'pme-inline-code-outside-boundary' } : null;
        }
      }
    });
  }

  function clearDom(dom) {
    while (dom.firstChild) dom.removeChild(dom.firstChild);
  }

  function atomDomAttrs(dom, nodeName) {
    dom.setAttribute('data-pme-atom-node', nodeName);
  }

  function nodeViewPosition(getPos) {
    if (typeof getPos !== 'function') return null;
    try {
      var pos = getPos();
      return typeof pos === 'number' ? pos : null;
    } catch (error) {
      return null;
    }
  }

  function attrsMatch(currentAttrs, nextAttrs) {
    currentAttrs = currentAttrs || {};
    nextAttrs = nextAttrs || {};
    for (var key in nextAttrs) {
      if (currentAttrs[key] !== nextAttrs[key]) return false;
    }
    return true;
  }

  function updateNodeViewAttrs(editorView, getPos, node, nextAttrs, options) {
    if (!editorView || !node || !nextAttrs) return false;
    if (attrsMatch(node.attrs, nextAttrs)) return false;
    var pos = nodeViewPosition(getPos);
    if (pos == null) return false;
    var tr = editorView.state.tr.setNodeMarkup(pos, null, extendObject(node.attrs || {}, nextAttrs));
    if (options && options.selectAfterNode) {
      var after = Math.max(0, Math.min(pos + node.nodeSize, tr.doc.content.size));
      try {
        tr = tr.setSelection(state.TextSelection.create(tr.doc, after));
      } catch (error) {
        tr = tr.setSelection(state.Selection.near(tr.doc.resolve(after), 1));
      }
    }
    editorView.dispatch(tr);
    return true;
  }

  function isEditableAtomNode(node) {
    if (!node || !node.type) return false;
    return node.type === schema.nodes.image
      || node.type === schema.nodes.math_inline
      || node.type === schema.nodes.math_display
      || node.type === schema.nodes.mermaid_block
      || node.type === schema.nodes.toc_block;
  }

  function setSelectionNearDeletedRange(tr, pos, dir) {
    if (!tr.doc.childCount) tr.insert(0, schema.nodes.paragraph.create());
    var bounded = Math.max(0, Math.min(pos, tr.doc.content.size));
    var selection = null;
    try {
      selection = state.Selection.near(tr.doc.resolve(bounded), dir < 0 ? -1 : 1);
    } catch (error) {
      selection = state.Selection.atEnd(tr.doc);
    }
    return tr.setSelection(selection);
  }

  function deleteAtomRange(editorState, dispatch, from, to, dir) {
    if (!dispatch) return true;
    var tr = editorState.tr.delete(from, to);
    dispatch(setSelectionNearDeletedRange(tr, from, dir).scrollIntoView());
    return true;
  }

  function adjacentBlockAtomRange($pos, dir) {
    if (!$pos || !$pos.depth) return null;
    var blockDepth = $pos.depth;
    while (blockDepth > 0 && !$pos.node(blockDepth).isTextblock) blockDepth -= 1;
    if (!blockDepth) return null;
    var parentDepth = blockDepth - 1;
    var parent = $pos.node(parentDepth);
    var blockIndex = $pos.index(parentDepth);
    if (dir < 0) {
      if ($pos.parentOffset !== 0 || blockIndex <= 0) return null;
      var previous = parent.child(blockIndex - 1);
      if (!isEditableAtomNode(previous)) return null;
      var blockStart = $pos.before(blockDepth);
      return { from: blockStart - previous.nodeSize, to: blockStart };
    }
    if ($pos.parentOffset !== $pos.parent.content.size || blockIndex + 1 >= parent.childCount) return null;
    var next = parent.child(blockIndex + 1);
    if (!isEditableAtomNode(next)) return null;
    var blockEnd = $pos.after(blockDepth);
    return { from: blockEnd, to: blockEnd + next.nodeSize };
  }

  function atomDeletionRangeNearSelection(editorState, dir) {
    var selection = editorState.selection;
    if (selection instanceof state.NodeSelection && isEditableAtomNode(selection.node)) {
      return { from: selection.from, to: selection.to };
    }
    if (!selection.empty) return null;
    var $pos = selection.$from;
    var adjacent = dir < 0 ? $pos.nodeBefore : $pos.nodeAfter;
    if (isEditableAtomNode(adjacent)) {
      return dir < 0
        ? { from: $pos.pos - adjacent.nodeSize, to: $pos.pos }
        : { from: $pos.pos, to: $pos.pos + adjacent.nodeSize };
    }
    return adjacentBlockAtomRange($pos, dir);
  }

  function deleteSelectedOrAdjacentAtomCommand(dir) {
    return function(editorState, dispatch) {
      var range = atomDeletionRangeNearSelection(editorState, dir);
      if (!range) return false;
      return deleteAtomRange(editorState, dispatch, range.from, range.to, dir);
    };
  }

  function deleteNodeView(editorView, getPos, node, dir) {
    if (!editorView || !node) return false;
    var pos = nodeViewPosition(getPos);
    if (pos == null) return false;
    var tr = editorView.state.tr.delete(pos, pos + node.nodeSize);
    editorView.dispatch(setSelectionNearDeletedRange(tr, pos, dir || 1).scrollIntoView());
    editorView.focus();
    return true;
  }

  function replaceNodeViewWithMarkdown(editorView, getPos, node, markdownText) {
    if (!editorView || !node) return false;
    var pos = nodeViewPosition(getPos);
    if (pos == null) return false;
    var parsed = parseMarkdown(markdownText || '');
    var content = parsed && parsed.content && parsed.content.size
      ? parsed.content
      : model.Fragment.from(schema.nodes.paragraph.create());
    editorView.dispatch(editorView.state.tr.replaceWith(pos, pos + node.nodeSize, content).scrollIntoView());
    return true;
  }

  function setSelectionAfterNodeView(editorView, getPos, node) {
    if (!editorView || !node) return false;
    var pos = nodeViewPosition(getPos);
    if (pos == null) return false;
    var tr = editorView.state.tr;
    var after = Math.max(0, Math.min(pos + node.nodeSize, tr.doc.content.size));
    var selection = null;
    if (node.isInline) {
      try {
        selection = state.TextSelection.create(tr.doc, after);
      } catch (error) {
        selection = state.Selection.near(tr.doc.resolve(after), 1);
      }
    } else {
      var $after = tr.doc.resolve(after);
      var nextNode = $after.nodeAfter;
      if (!nextNode || !nextNode.isTextblock) {
        tr.insert(after, schema.nodes.paragraph.create());
      }
      try {
        selection = state.TextSelection.create(tr.doc, Math.min(after + 1, tr.doc.content.size));
      } catch (error) {
        selection = state.Selection.near(tr.doc.resolve(Math.min(after, tr.doc.content.size)), 1);
      }
    }
    editorView.dispatch(tr.setSelection(selection).scrollIntoView());
    editorView.focus();
    return true;
  }

  function setSelectionBeforeNodeView(editorView, getPos, node) {
    if (!editorView || !node) return false;
    var pos = nodeViewPosition(getPos);
    if (pos == null) return false;
    var tr = editorView.state.tr;
    var before = Math.max(0, Math.min(pos, tr.doc.content.size));
    var selection = null;
    if (!node.isInline) {
      var $before = tr.doc.resolve(before);
      var previousNode = $before.nodeBefore;
      if (!previousNode || !previousNode.isTextblock) {
        tr.insert(before, schema.nodes.paragraph.create());
        try {
          selection = state.TextSelection.create(tr.doc, before + 1);
        } catch (error) {
          selection = state.Selection.near(tr.doc.resolve(before), 1);
        }
      }
    }
    if (!selection) {
      try {
        selection = state.TextSelection.create(tr.doc, before);
      } catch (error) {
        selection = state.Selection.near(tr.doc.resolve(before), -1);
      }
    }
    editorView.dispatch(tr.setSelection(selection).scrollIntoView());
    editorView.focus();
    return true;
  }

  function sourceEditorInput(control) {
    return control && control.__pmeValueInput || control;
  }

  function sourceEditorHasFocus(control) {
    var active = document.activeElement;
    return Boolean(control && active && (active === control || active === control.__pmeValueInput || control.contains && control.contains(active)));
  }

  function setSourceEditorValue(control, value) {
    if (!control) return;
    value = String(value || '');
    if (sourceEditorHasFocus(control) && control.value === value) return;
    if (sourceEditorHasFocus(control)) return;
    if (control.value !== value) control.value = value;
  }

  function autoSizeNodeSourceEditor(control) {
    if (!control) return;
    var input = sourceEditorInput(control);
    if (input && input.nodeName === 'INPUT') {
      input.size = Math.max(1, Math.min(64, String(input.value || '').length + 1));
      return;
    }
    if (!input || input.nodeName !== 'TEXTAREA') return;
    input.style.height = 'auto';
    input.style.height = Math.max(48, input.scrollHeight) + 'px';
  }

  function cursorIsOnFirstSourceLine(input) {
    return Boolean(input && typeof input.selectionStart === 'number' && String(input.value || '').lastIndexOf('\n', input.selectionStart - 1) === -1);
  }

  function cursorIsOnLastSourceLine(input) {
    return Boolean(input && typeof input.selectionEnd === 'number' && String(input.value || '').indexOf('\n', input.selectionEnd) === -1);
  }

  function createNodeSourceEditor(options) {
    var control = options.inlineTokens ? document.createElement('span') : document.createElement(options.multiline || options.wrapLongValue ? 'textarea' : 'input');
    control.className = 'pme-node-source-editor ' + (options.className || '');
    var valueInput = control;
    if (options.inlineTokens) {
      var inlineSourceRow = document.createElement('span');
      var beforeToken = document.createElement('span');
      var afterToken = document.createElement('span');
      valueInput = document.createElement('input');
      inlineSourceRow.className = 'pme-inline-math-source-row';
      beforeToken.className = 'pme-node-source-delimiter pme-inline-source-token pme-inline-source-token--before';
      afterToken.className = 'pme-node-source-delimiter pme-inline-source-token pme-inline-source-token--after';
      valueInput.className = 'pme-node-source-editor-input';
      beforeToken.textContent = options.inlineTokens[0] || '';
      afterToken.textContent = options.inlineTokens[1] || '';
      valueInput.type = 'text';
      inlineSourceRow.appendChild(beforeToken);
      inlineSourceRow.appendChild(valueInput);
      inlineSourceRow.appendChild(afterToken);
      control.appendChild(inlineSourceRow);
      control.__pmeValueInput = valueInput;
      control.__pmeInlineTokens = options.inlineTokens;
      control.__pmeBeforeToken = beforeToken;
      control.__pmeAfterToken = afterToken;
      Object.defineProperty(control, 'value', {
        configurable: true,
        get: function() {
          return (control.__pmeInlineTokens[0] || '') + valueInput.value + (control.__pmeInlineTokens[1] || '');
        },
        set: function(nextValue) {
          valueInput.value = latexFromMathSourceEditorValue(nextValue, false);
        }
      });
    } else if (!options.multiline && !options.wrapLongValue) {
      control.type = 'text';
    }
    if (options.wrapLongValue && control.nodeName === 'TEXTAREA') {
      control.rows = 3;
      control.wrap = 'soft';
    }
    control.setAttribute('aria-label', options.label || 'source');
    control.setAttribute('spellcheck', 'false');
    control.setAttribute('autocomplete', 'off');
    control.setAttribute('autocapitalize', 'off');
    control.setAttribute('contenteditable', options.inlineTokens ? 'false' : 'true');
    if (valueInput !== control) {
      valueInput.setAttribute('aria-label', options.label || 'source');
      valueInput.setAttribute('spellcheck', 'false');
      valueInput.setAttribute('autocomplete', 'off');
      valueInput.setAttribute('autocapitalize', 'off');
    }
    control.value = options.value || '';
    autoSizeNodeSourceEditor(control);
    function keepControlEvent(event) {
      event.stopPropagation();
      setTimeout(function() {
        if (control.isConnected && !sourceEditorHasFocus(control)) {
          focusNodeSourceEditor(control, { moveToEnd: false });
        }
      }, 0);
    }
    ['pointerdown', 'mousedown', 'mouseup', 'click', 'dblclick', 'touchstart'].forEach(function(type) {
      control.addEventListener(type, keepControlEvent, true);
      control.addEventListener(type, keepControlEvent);
    });
    control.addEventListener('input', function(event) {
      if (options.multiline || options.wrapLongValue || control.__pmeValueInput) autoSizeNodeSourceEditor(control);
      if (typeof options.onInput === 'function') options.onInput(control.value, event);
      if (control.classList.contains('is-source-popover-open')) scheduleNodeSourceEditorPopoverPosition();
    });
    control.addEventListener('keydown', function(event) {
      var shouldConfirm = ((event.ctrlKey || event.metaKey) && event.key === 'Enter')
        || (!options.multiline && event.key === 'Enter');
      var input = sourceEditorInput(control);
      var plainCollapsedKey = input && typeof input.selectionStart === 'number' && input.selectionStart === input.selectionEnd && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey;
      if (plainCollapsedKey && typeof options.onDeleteBoundary === 'function') {
        if (event.key === 'Backspace' && input.selectionStart === 0) {
          event.preventDefault();
          hideSourceEditor(control, control.__pmeOwnerDom || null);
          input.blur();
          options.onDeleteBoundary('before', control.value, event);
          return;
        }
        if (event.key === 'Delete' && input.selectionStart === String(input.value || '').length) {
          event.preventDefault();
          hideSourceEditor(control, control.__pmeOwnerDom || null);
          input.blur();
          options.onDeleteBoundary('after', control.value, event);
          return;
        }
      }
      if (typeof options.onExitBoundary === 'function' && plainCollapsedKey) {
        var cursorPos = input.selectionStart;
        var inputLength = String(input.value || '').length;
        if (event.key === 'ArrowLeft' && cursorPos === 0) {
          event.preventDefault();
          options.onExitBoundary('before', control.value, event);
          hideSourceEditor(control, control.__pmeOwnerDom || null);
          return;
        }
        if (event.key === 'ArrowRight' && cursorPos === inputLength) {
          event.preventDefault();
          options.onExitBoundary('after', control.value, event);
          hideSourceEditor(control, control.__pmeOwnerDom || null);
          return;
        }
        if (options.multiline && event.key === 'ArrowUp' && cursorIsOnFirstSourceLine(input)) {
          event.preventDefault();
          options.onExitBoundary('before', control.value, event);
          hideSourceEditor(control, control.__pmeOwnerDom || null);
          return;
        }
        if (options.multiline && event.key === 'ArrowDown' && cursorIsOnLastSourceLine(input)) {
          event.preventDefault();
          options.onExitBoundary('after', control.value, event);
          hideSourceEditor(control, control.__pmeOwnerDom || null);
          return;
        }
        if (!options.multiline && options.verticalBoundaryExit && event.key === 'ArrowUp') {
          event.preventDefault();
          options.onExitBoundary('before', control.value, event);
          hideSourceEditor(control, control.__pmeOwnerDom || null);
          return;
        }
        if (!options.multiline && options.verticalBoundaryExit && event.key === 'ArrowDown') {
          event.preventDefault();
          options.onExitBoundary('after', control.value, event);
          hideSourceEditor(control, control.__pmeOwnerDom || null);
          return;
        }
        if (options.multiline && /^Arrow/.test(event.key)) return;
        if (event.key === 'ArrowLeft' && typeof input.setSelectionRange === 'function') {
          event.preventDefault();
          input.setSelectionRange(cursorPos - 1, cursorPos - 1);
          return;
        }
        if (event.key === 'ArrowRight' && typeof input.setSelectionRange === 'function') {
          event.preventDefault();
          input.setSelectionRange(cursorPos + 1, cursorPos + 1);
          return;
        }
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        hideSourceEditor(control, control.__pmeOwnerDom || null);
        sourceEditorInput(control).blur();
      } else if (shouldConfirm) {
        event.preventDefault();
        if (typeof options.onConfirm === 'function') options.onConfirm(control.value, event);
        hideSourceEditor(control, control.__pmeOwnerDom || null);
        sourceEditorInput(control).blur();
      }
    });
    if (typeof options.onCommit === 'function') {
      control.addEventListener('blur', function(event) {
        options.onCommit(control.value, event);
      });
    }
    return control;
  }

  function nodeSourceEditorFromEvent(event) {
    var target = event && event.target;
    return target && target.closest ? target.closest('.pme-node-source-editor') : null;
  }

  function isNodeSourceActivationTarget(event) {
    var target = event && event.target;
    if (!target || !target.closest) return true;
    if (target.closest('.pme-node-source-editor')) return false;
    if (target.closest('button, a, input, textarea, select, option')) return false;
    return true;
  }

  function focusNodeSourceEditor(control, options) {
    if (!control) return false;
    var input = sourceEditorInput(control);
    try {
      input.focus({ preventScroll: true });
    } catch (error) {
      input.focus();
    }
    var valueLength = String(input.value || '').length;
    var moveToEnd = !options || options.moveToEnd !== false;
    if (moveToEnd && document.activeElement === input && typeof input.setSelectionRange === 'function') {
      try {
        input.setSelectionRange(valueLength, valueLength);
      } catch (error) {}
    }
    autoSizeNodeSourceEditor(control);
    return sourceEditorHasFocus(control);
  }

  var activeNodeSourceEditorPopover = null;
  var nodeSourceEditorPopoverFrame = 0;
  var nodeSourceEditorPopoverEventsBound = false;

  function clampNumber(value, min, max) {
    if (max < min) return min;
    return Math.max(min, Math.min(value, max));
  }

  function isInlineMathSourceEditor(control) {
    return Boolean(control && control.classList && control.classList.contains('pme-node-source-editor--math-inline'));
  }

  function positionNodeSourceEditorPopover(dom, control) {
    if (!dom || !control) return;
    if (!dom.isConnected) {
      hideNodeSourceEditorPopover(control, dom);
      return;
    }
    var rect = dom.getBoundingClientRect();
    var viewportWidth = global.innerWidth || document.documentElement.clientWidth || 1024;
    var viewportHeight = global.innerHeight || document.documentElement.clientHeight || 768;
    var margin = 12;
    var availableWidth = Math.max(180, viewportWidth - margin * 2);
    if (isInlineMathSourceEditor(control)) {
      var inlineGap = 10;
      var inlineWidth = clampNumber(Math.max(240, rect.width || 0, String(control.value || '').length * 8.5 + 64), 180, Math.min(460, availableWidth));
      control.style.position = 'fixed';
      control.style.left = clampNumber(rect.left, margin, viewportWidth - inlineWidth - margin) + 'px';
      control.style.top = margin + 'px';
      control.style.width = inlineWidth + 'px';
      control.style.maxWidth = availableWidth + 'px';
      control.style.maxHeight = Math.max(120, Math.min(240, viewportHeight - margin * 2)) + 'px';
      control.style.zIndex = '1000';
      autoSizeNodeSourceEditor(control);
      var inlineRect = control.getBoundingClientRect();
      var belowTop = rect.bottom + inlineGap;
      var aboveTop = rect.top - inlineRect.height - inlineGap;
      var inlineTop = belowTop + inlineRect.height <= viewportHeight - margin
        ? belowTop
        : aboveTop >= margin
          ? aboveTop
          : clampNumber(belowTop, margin, viewportHeight - inlineRect.height - margin);
      control.style.top = clampNumber(inlineTop, margin, viewportHeight - inlineRect.height - margin) + 'px';
      return;
    }
    var isImageEditor = control.classList && control.classList.contains('pme-node-source-editor--image');
    var maxEditorWidth = isImageEditor ? 800 : (control.nodeName === 'INPUT' ? 320 : 520);
    var contentWidth = isImageEditor ? String(control.value || '').length * 8.5 + 48 : 0;
    var preferredWidth = Math.max(240, Math.min(Math.max(rect.width || 360, contentWidth), maxEditorWidth, availableWidth));
    var anchorRight = clampNumber(rect.right - margin, margin + preferredWidth, viewportWidth - margin);
    var left = clampNumber(anchorRight - preferredWidth, margin, viewportWidth - preferredWidth - margin);
    control.style.position = 'fixed';
    control.style.left = left + 'px';
    control.style.top = margin + 'px';
    control.style.width = preferredWidth + 'px';
    control.style.maxWidth = availableWidth + 'px';
    control.style.maxHeight = Math.max(80, Math.min(360, viewportHeight - margin * 2)) + 'px';
    control.style.zIndex = '1000';
    autoSizeNodeSourceEditor(control);
    var popoverRect = control.getBoundingClientRect();
    var preferredTop = rect.top + 8;
    var top = clampNumber(preferredTop, margin, viewportHeight - popoverRect.height - margin);
    control.style.top = top + 'px';
  }

  function scheduleNodeSourceEditorPopoverPosition() {
    if (!activeNodeSourceEditorPopover) return;
    if (nodeSourceEditorPopoverFrame) return;
    var raf = global.requestAnimationFrame || function(callback) { return global.setTimeout(callback, 16); };
    nodeSourceEditorPopoverFrame = raf(function() {
      nodeSourceEditorPopoverFrame = 0;
      var control = activeNodeSourceEditorPopover;
      if (!control) return;
      positionNodeSourceEditorPopover(control.__pmeOwnerDom || null, control);
    });
  }

  function ensureNodeSourceEditorPopoverEvents() {
    if (nodeSourceEditorPopoverEventsBound) return;
    nodeSourceEditorPopoverEventsBound = true;
    global.addEventListener('resize', scheduleNodeSourceEditorPopoverPosition, { passive: true });
    global.addEventListener('scroll', scheduleNodeSourceEditorPopoverPosition, true);
  }

  function hideNodeSourceEditorPopover(control, dom) {
    if (!control) return;
    if (activeNodeSourceEditorPopover === control) activeNodeSourceEditorPopover = null;
    control.classList.remove('is-source-popover-open');
    control.style.left = '';
    control.style.top = '';
    control.style.width = '';
    control.style.maxWidth = '';
    control.style.maxHeight = '';
    control.style.position = '';
    control.style.zIndex = '';
    var input = sourceEditorInput(control);
    if (input && input !== control) input.blur();
    if (dom) dom.classList.remove('is-editing-source');
  }

  function hideSourceEditor(control, dom) {
    hideNodeSourceEditorPopover(control, dom);
  }

  function showNodeSourceEditorPopover(dom, control) {
    if (!dom || !control) return false;
    if (activeNodeSourceEditorPopover && activeNodeSourceEditorPopover !== control) {
      hideNodeSourceEditorPopover(activeNodeSourceEditorPopover, activeNodeSourceEditorPopover.__pmeOwnerDom || null);
    }
    if (!control.parentNode) document.body.appendChild(control);
    control.__pmeOwnerDom = dom;
    control.classList.add('is-source-popover-open');
    dom.classList.add('is-editing-source');
    activeNodeSourceEditorPopover = control;
    ensureNodeSourceEditorPopoverEvents();
    positionNodeSourceEditorPopover(dom, control);
    focusNodeSourceEditor(control, { moveToEnd: true });
    setTimeout(function() {
      if (control.isConnected && !sourceEditorHasFocus(control)) {
        focusNodeSourceEditor(control, { moveToEnd: true });
      }
    }, 0);
    return true;
  }

  function activateNodeSourceEditorFromEvent(event, control) {
    if (!control || !isNodeSourceActivationTarget(event)) return false;
    event.preventDefault();
    event.stopPropagation();
    showNodeSourceEditorPopover(event.currentTarget, control);
    return true;
  }

  function bindNodeSourceEditorActivation(dom, control) {
    if (!dom || !control) return;
    control.classList.add('pme-node-source-popover');
    dom.__pmeOpenSourceEditor = function() {
      return showNodeSourceEditorPopover(dom, control);
    };
    control.addEventListener('focusin', function() {
      dom.classList.add('is-editing-source');
      if (control.classList.contains('is-source-popover-open')) positionNodeSourceEditorPopover(dom, control);
    });
    control.addEventListener('focusout', function() {
      setTimeout(function() {
        if (!sourceEditorHasFocus(control)) hideNodeSourceEditorPopover(control, dom);
      }, 0);
    });
    dom.addEventListener('pointerdown', function(event) {
      activateNodeSourceEditorFromEvent(event, control);
    }, true);
  }

  function destroyNodeSourceEditor(control) {
    hideSourceEditor(control, control && control.__pmeOwnerDom || null);
    if (control && control.parentNode) control.parentNode.removeChild(control);
  }

  function stopNodeSourceEditorEvent(event) {
    return Boolean(nodeSourceEditorFromEvent(event));
  }

  function selectAtomSourceNode() {
    var dom = this.dom;
    var control = this.sourceEditor;
    if (dom) {
      dom.classList.add('ProseMirror-selectednode');
      dom.classList.add('is-editing-source');
    }
    setTimeout(function() {
      if (control) showNodeSourceEditorPopover(dom, control);
    }, 0);
  }

  function deselectAtomSourceNode() {
    if (this.dom) {
      this.dom.classList.remove('ProseMirror-selectednode');
      if (!sourceEditorHasFocus(this.sourceEditor)) this.dom.classList.remove('is-editing-source');
    }
  }

  function ignoreNodeSourceEditorMutation(mutation) {
    var target = mutation && mutation.target;
    return Boolean(target && target.closest && target.closest('.pme-node-source-editor'));
  }

  function renderMathInto(dom, latex, displayMode) {
    clearDom(dom);
    dom.classList.remove('is-error');
    if (global.katex && typeof global.katex.render === 'function') {
      try {
        global.katex.render(latex || '', dom, {
          displayMode: Boolean(displayMode),
          throwOnError: false
        });
        return;
      } catch (error) {
        dom.classList.add('is-error');
      }
    }
    dom.textContent = displayMode ? '$$ ' + (latex || '') + ' $$' : '$' + (latex || '') + '$';
  }

  function mathSourceEditorValue(latex, displayMode) {
    latex = normalizeNewlines(latex || '');
    return displayMode ? latex : latex ? '$' + latex + '$' : '\\(\\)';
  }

  function latexFromMathSourceEditorValue(value, displayMode) {
    value = normalizeNewlines(value || '');
    if (displayMode) return value;
    var dollarMatch = value.match(/^\$([\s\S]*)\$$/);
    if (dollarMatch) return dollarMatch[1];
    var parenMatch = value.match(/^\\\(([\s\S]*)\\\)$/);
    if (parenMatch) return parenMatch[1];
    return value.replace(/^\$/, '').replace(/\$$/, '');
  }

  function setInlineMathSourceEditorTokens(control, latex) {
    if (!control || !control.__pmeInlineTokens) return;
    var tokens = latex ? ['$', '$'] : ['\\(', '\\)'];
    control.__pmeInlineTokens = tokens;
    if (control.__pmeBeforeToken) control.__pmeBeforeToken.textContent = tokens[0];
    if (control.__pmeAfterToken) control.__pmeAfterToken.textContent = tokens[1];
  }

  function normalizeInlineMathEditorInput(input, fallbackValue) {
    var latex = input && typeof input.value === 'string'
      ? input.value
      : latexFromMathSourceEditorValue(fallbackValue, false);
    var normalized = escapeInlineMath(latex);
    if (!input || normalized === latex) return normalized;
    var selectionStart = typeof input.selectionStart === 'number' ? input.selectionStart : null;
    var selectionEnd = typeof input.selectionEnd === 'number' ? input.selectionEnd : null;
    var nextStart = selectionStart == null ? null : escapeInlineMath(latex.slice(0, selectionStart)).length;
    var nextEnd = selectionEnd == null ? null : escapeInlineMath(latex.slice(0, selectionEnd)).length;
    input.value = normalized;
    if (nextStart != null && nextEnd != null && typeof input.setSelectionRange === 'function') {
      input.setSelectionRange(nextStart, nextEnd);
    }
    return normalized;
  }

  function MathNodeView(node, editorView, getPos) {
    this.node = node;
    this.editorView = editorView;
    this.getPos = getPos;
    this.displayMode = node.type.name === 'math_display';
    this.dom = document.createElement(this.displayMode ? 'div' : 'span');
    this.dom.className = (this.displayMode ? 'math-display' : 'math-inline') + ' pme-math-node';
    atomDomAttrs(this.dom, node.type.name);
    this.preview = document.createElement(this.displayMode ? 'div' : 'span');
    this.preview.className = 'pme-node-rendered-preview';
    this.preview.setAttribute('contenteditable', 'false');
    this.editPreview = null;
    this.editPreviewValue = null;
    if (!this.displayMode) {
      this.editPreview = document.createElement('span');
      this.editPreview.className = 'pme-inline-math-edit-preview';
      this.editPreview.setAttribute('contenteditable', 'false');
      this.editPreview.setAttribute('aria-label', '数式の表示プレビュー');
      var editPreviewLabel = document.createElement('span');
      editPreviewLabel.className = 'pme-inline-math-edit-preview-label';
      editPreviewLabel.textContent = '表示';
      this.editPreviewValue = document.createElement('span');
      this.editPreviewValue.className = 'pme-inline-math-edit-preview-value';
      this.editPreview.appendChild(editPreviewLabel);
      this.editPreview.appendChild(this.editPreviewValue);
    }
    var self = this;
    this.sourceEditor = createNodeSourceEditor({
      multiline: this.displayMode,
      className: this.displayMode ? 'pme-node-source-editor--math-display' : 'pme-node-source-editor--math-inline',
      label: this.displayMode ? '表示数式のソース' : 'インライン数式のソース',
      inlineTokens: this.displayMode ? null : ['$', '$'],
      value: mathSourceEditorValue(node.attrs.latex || '', this.displayMode),
      onInput: function(value, event) {
        var latex = self.displayMode
          ? latexFromMathSourceEditorValue(value, true)
          : normalizeInlineMathEditorInput(event && event.target, value);
        updateNodeViewAttrs(self.editorView, self.getPos, self.node, { latex: latex }, { selectAfterNode: !self.displayMode });
      },
      onConfirm: function() {
        setSelectionAfterNodeView(self.editorView, self.getPos, self.node);
      },
      onDeleteBoundary: function(side) {
        if (!self.displayMode) {
          if (side === 'before') setSelectionBeforeNodeView(self.editorView, self.getPos, self.node);
          else setSelectionAfterNodeView(self.editorView, self.getPos, self.node);
          return;
        }
        deleteNodeView(self.editorView, self.getPos, self.node, side === 'before' ? -1 : 1);
      },
      onExitBoundary: function(side) {
        if (side === 'before') setSelectionBeforeNodeView(self.editorView, self.getPos, self.node);
        else setSelectionAfterNodeView(self.editorView, self.getPos, self.node);
      }
    });
    if (!this.displayMode) {
      var editorLabel = document.createElement('span');
      editorLabel.className = 'pme-inline-math-editor-label';
      editorLabel.textContent = 'インライン数式を編集';
      this.sourceEditor.insertBefore(editorLabel, this.sourceEditor.firstChild);
      this.sourceEditor.appendChild(this.editPreview);
      this.sourceEditor.setAttribute('role', 'group');
    }
    this.dom.appendChild(this.preview);
    bindNodeSourceEditorActivation(this.dom, this.sourceEditor);
    this.render();
  }

  MathNodeView.prototype.render = function() {
    var latex = this.node.attrs.latex || '';
    this.dom.setAttribute('data-latex', latex);
    this.dom.setAttribute('aria-label', latex ? (this.displayMode ? '表示数式: ' : 'インライン数式: ') + latex : (this.displayMode ? '空の表示数式' : '空のインライン数式'));
    setInlineMathSourceEditorTokens(this.sourceEditor, latex);
    renderMathInto(this.preview, latex, this.displayMode);
    if (this.editPreviewValue) renderMathInto(this.editPreviewValue, latex, false);
    this.dom.classList.toggle('is-error', this.preview.classList.contains('is-error'));
    setSourceEditorValue(this.sourceEditor, mathSourceEditorValue(latex, this.displayMode));
    autoSizeNodeSourceEditor(this.sourceEditor);
  };

  MathNodeView.prototype.update = function(node) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.displayMode = node.type.name === 'math_display';
    this.render();
    return true;
  };

  MathNodeView.prototype.stopEvent = stopNodeSourceEditorEvent;
  MathNodeView.prototype.selectNode = selectAtomSourceNode;
  MathNodeView.prototype.deselectNode = deselectAtomSourceNode;
  MathNodeView.prototype.ignoreMutation = function(mutation) { return ignoreNodeSourceEditorMutation(mutation) || true; };
  MathNodeView.prototype.destroy = function() { destroyNodeSourceEditor(this.sourceEditor); };

  function renderMermaidFallback(target, source, message) {
    clearDom(target);
    target.classList.add('mermaid-fallback');
    var pre = document.createElement('pre');
    pre.textContent = message ? message + '\n\n' + source : source;
    target.appendChild(pre);
  }

  var mermaidRenderCounter = 0;
  var prosemirrorMermaidRenderQueue = Promise.resolve();

  function cleanupProseMirrorMermaidScratch(id) {
    if (!id || !document.getElementById) return;
    var scratch = document.getElementById('d' + id);
    if (scratch && scratch.parentNode) scratch.parentNode.removeChild(scratch);
  }

  function MermaidNodeView(node, editorView, getPos) {
    this.node = node;
    this.editorView = editorView;
    this.getPos = getPos;
    this.renderToken = 0;
    this.dom = document.createElement('figure');
    this.dom.className = 'mermaid-diagram pme-mermaid-node';
    atomDomAttrs(this.dom, node.type.name);
    this.caption = document.createElement('figcaption');
    this.caption.textContent = 'Mermaid';
    this.caption.setAttribute('contenteditable', 'false');
    var self = this;
    this.sourceEditor = createNodeSourceEditor({
      multiline: true,
      className: 'pme-node-source-editor--mermaid',
      label: 'Mermaid source',
      value: node.attrs.source || '',
      onInput: function(value) {
        updateNodeViewAttrs(self.editorView, self.getPos, self.node, { source: normalizeNewlines(value) });
      },
      onConfirm: function() {
        setSelectionAfterNodeView(self.editorView, self.getPos, self.node);
      },
      onDeleteBoundary: function(side) {
        deleteNodeView(self.editorView, self.getPos, self.node, side === 'before' ? -1 : 1);
      },
      onExitBoundary: function(side) {
        if (side === 'before') setSelectionBeforeNodeView(self.editorView, self.getPos, self.node);
        else setSelectionAfterNodeView(self.editorView, self.getPos, self.node);
      }
    });
    this.target = document.createElement('div');
    this.target.className = 'mermaid-render-target';
    this.target.setAttribute('contenteditable', 'false');
    this.dom.appendChild(this.caption);
    this.dom.appendChild(this.target);
    bindNodeSourceEditorActivation(this.dom, this.sourceEditor);
    this.render();
  }

  MermaidNodeView.prototype.render = function() {
    var sourceText = normalizeNewlines(this.node.attrs.source || '');
    var source = sourceText.replace(/\n+$/g, '');
    var renderToken = this.renderToken += 1;
    this.dom.setAttribute('data-source', source);
    setSourceEditorValue(this.sourceEditor, sourceText);
    autoSizeNodeSourceEditor(this.sourceEditor);
    this.target.className = 'mermaid-render-target';
    this.target.setAttribute('data-mermaid-source', source);
    this.target.textContent = 'Rendering...';
    if (!source) {
      renderMermaidFallback(this.target, source, 'Mermaid source is empty.');
      return;
    }
    var id = 'pme-pm-mermaid-' + (++mermaidRenderCounter);
    this.target.setAttribute('data-mermaid-render-id', id);
    if (typeof global.PMERenderMermaidIn === 'function') {
      global.PMERenderMermaidIn(this.dom);
      return;
    }
    if (!global.mermaid || typeof global.mermaid.render !== 'function') {
      renderMermaidFallback(this.target, source, 'Mermaid renderer is not available.');
      return;
    }
    var self = this;
    cleanupProseMirrorMermaidScratch(id);
    var renderRun = prosemirrorMermaidRenderQueue.catch(function() {}).then(function() {
      if (renderToken !== self.renderToken || !self.dom.isConnected) return null;
      cleanupProseMirrorMermaidScratch(id);
      return global.mermaid.render(id, source);
    });
    prosemirrorMermaidRenderQueue = renderRun.catch(function() {});
    renderRun.then(function(result) {
      cleanupProseMirrorMermaidScratch(id);
      if (renderToken !== self.renderToken) return;
      if (!result) return;
      clearDom(self.target);
      self.target.classList.remove('mermaid-fallback');
      self.target.innerHTML = result && result.svg || '';
      var svg = self.target.querySelector('svg');
      if (svg) svg.classList.add('mermaid-svg');
      if (!svg) renderMermaidFallback(self.target, source, 'Mermaid did not return SVG.');
    }).catch(function(error) {
      cleanupProseMirrorMermaidScratch(id);
      if (renderToken !== self.renderToken) return;
      renderMermaidFallback(self.target, source, error && error.message || 'Mermaid render failed.');
    });
  };

  MermaidNodeView.prototype.update = function(node) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  };

  MermaidNodeView.prototype.stopEvent = stopNodeSourceEditorEvent;
  MermaidNodeView.prototype.selectNode = selectAtomSourceNode;
  MermaidNodeView.prototype.deselectNode = deselectAtomSourceNode;
  MermaidNodeView.prototype.ignoreMutation = function(mutation) { return ignoreNodeSourceEditorMutation(mutation) || true; };
  MermaidNodeView.prototype.destroy = function() { destroyNodeSourceEditor(this.sourceEditor); };

  function headingEntries(doc) {
    var entries = [];
    doc.descendants(function(node, pos) {
      if (node.type.name !== 'heading') return;
      entries.push({
        level: node.attrs.level || 1,
        title: node.textContent || '見出し',
        pos: pos
      });
    });
    return entries;
  }

  function renderTocInto(dom, doc, editorView) {
    clearDom(dom);
    var title = document.createElement('strong');
    title.textContent = '目次';
    title.setAttribute('contenteditable', 'false');
    dom.appendChild(title);
    var entries = headingEntries(doc);
    if (!entries.length) {
      var empty = document.createElement('p');
      empty.textContent = '見出しがありません';
      empty.setAttribute('contenteditable', 'false');
      dom.appendChild(empty);
      return;
    }
    var list = document.createElement('ol');
    list.setAttribute('contenteditable', 'false');
    entries.forEach(function(entry) {
      var item = document.createElement('li');
      item.className = 'level-' + Math.max(1, Math.min(6, entry.level));
      var button = document.createElement('button');
      button.type = 'button';
      button.textContent = entry.title;
      button.addEventListener('click', function(event) {
        event.preventDefault();
        event.stopPropagation();
        var bounded = Math.max(0, Math.min(entry.pos + 1, editorView.state.doc.content.size));
        var selection = state.Selection.near(editorView.state.doc.resolve(bounded), 1);
        editorView.dispatch(editorView.state.tr.setSelection(selection).scrollIntoView());
        editorView.focus();
      });
      item.appendChild(button);
      list.appendChild(item);
    });
    dom.appendChild(list);
  }

  function TocNodeView(node, editorView, getPos) {
    this.node = node;
    this.editorView = editorView;
    this.getPos = getPos;
    this.dom = document.createElement('nav');
    this.dom.className = 'toc pme-toc-node';
    this.dom.setAttribute('data-toc-block', 'true');
    atomDomAttrs(this.dom, node.type.name);
    var self = this;
    this.sourceEditor = createNodeSourceEditor({
      multiline: false,
      className: 'pme-node-source-editor--toc',
      label: 'TOC marker source',
      value: '[toc]',
      onConfirm: function(value) {
        if (/^\s*\[toc\]\s*$/i.test(value)) {
          setSelectionAfterNodeView(self.editorView, self.getPos, self.node);
        }
      },
      onDeleteBoundary: function(side) {
        deleteNodeView(self.editorView, self.getPos, self.node, side === 'before' ? -1 : 1);
      },
      onExitBoundary: function(side) {
        if (side === 'before') setSelectionBeforeNodeView(self.editorView, self.getPos, self.node);
        else setSelectionAfterNodeView(self.editorView, self.getPos, self.node);
      },
      onCommit: function(value) {
        if (/^\s*\[toc\]\s*$/i.test(value)) {
          setSourceEditorValue(self.sourceEditor, '[toc]');
          return;
        }
        replaceNodeViewWithMarkdown(self.editorView, self.getPos, self.node, value);
      }
    });
    renderTocInto(this.dom, editorView.state.doc, editorView);
    bindNodeSourceEditorActivation(this.dom, this.sourceEditor);
  }

  TocNodeView.prototype.update = function(node) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    setSourceEditorValue(this.sourceEditor, '[toc]');
    renderTocInto(this.dom, this.editorView.state.doc, this.editorView);
    return true;
  };

  TocNodeView.prototype.stopEvent = stopNodeSourceEditorEvent;
  TocNodeView.prototype.selectNode = selectAtomSourceNode;
  TocNodeView.prototype.deselectNode = deselectAtomSourceNode;
  TocNodeView.prototype.ignoreMutation = function(mutation) { return ignoreNodeSourceEditorMutation(mutation) || true; };
  TocNodeView.prototype.destroy = function() { destroyNodeSourceEditor(this.sourceEditor); };

  function imageFallbackText(src, alt, options) {
    var label = alt || '画像';
    var reason = '';
    if (options && typeof options.imageBlockReason === 'function') {
      try { reason = options.imageBlockReason(src) || ''; }
      catch (_) { reason = ''; }
    }
    return '画像未表示: ' + label + (reason ? ' (' + reason + ')' : '');
  }

  function resolveImageNodeSrc(src, options) {
    if (options && typeof options.resolveImageSrc === 'function') {
      try { return options.resolveImageSrc(src) || ''; }
      catch (_) { return ''; }
    }
    return src || '';
  }

  function markdownImageLabel(value) {
    return String(value || '').replace(/[\]\r\n]/g, ' ').trim();
  }

  function markdownImageTarget(value) {
    var target = String(value || '').trim();
    if (!target) return '';
    if (/[\s()<>]/.test(target)) return '<' + target.replace(/[<>]/g, '') + '>';
    return target;
  }

  function imageSourceEditorValue(node) {
    var attrs = node && node.attrs || {};
    var source = '![' + markdownImageLabel(attrs.alt || '') + '](' + markdownImageTarget(attrs.src || '');
    if (attrs.title) source += ' "' + String(attrs.title).replace(/"/g, '\\"').replace(/[\r\n]/g, ' ') + '"';
    return source + ')';
  }

  function parseImageSourceEditorValue(value) {
    var source = String(value || '').trim();
    var match = source.match(/^!\[([^\]\n]*)\]\((?:<([^>\n]+)>|([^\s)\n]+))(?:\s+"((?:\\"|[^"\n])*)")?\)$/);
    if (!match) return null;
    var src = match[2] || match[3] || '';
    if (!src) return null;
    return {
      src: src,
      alt: match[1] || null,
      title: match[4] ? match[4].replace(/\\"/g, '"') : null
    };
  }

  function updateImageNodeViewSource(nodeView, value) {
    var attrs = parseImageSourceEditorValue(value);
    if (!attrs) {
      setSourceEditorValue(nodeView.sourceEditor, imageSourceEditorValue(nodeView.node));
      return false;
    }
    var changed = updateNodeViewAttrs(nodeView.editorView, nodeView.getPos, nodeView.node, attrs);
    if (!changed) {
      setSourceEditorValue(nodeView.sourceEditor, imageSourceEditorValue(nodeView.node));
    }
    return true;
  }

  function ImageNodeView(node, editorView, getPos, options) {
    this.node = node;
    this.editorView = editorView;
    this.getPos = getPos;
    this.options = options || {};
    this.dom = document.createElement('span');
    this.dom.className = 'pme-image-node';
    this.dom.setAttribute('data-pme-atom-node', 'image');
    this.dom.setAttribute('contenteditable', 'false');
    this.dom.draggable = true;
    this.dom.__pmeImageNodeView = this;
    var self = this;
    this.sourceEditor = createNodeSourceEditor({
      multiline: false,
      wrapLongValue: true,
      verticalBoundaryExit: true,
      className: 'pme-node-source-editor--image',
      label: 'image Markdown source',
      value: imageSourceEditorValue(node),
      onConfirm: function(value) {
        updateImageNodeViewSource(self, value);
        setSelectionAfterNodeView(self.editorView, self.getPos, self.node);
      },
      onDeleteBoundary: function(side) {
        deleteNodeView(self.editorView, self.getPos, self.node, side === 'before' ? -1 : 1);
      },
      onExitBoundary: function(side) {
        if (side === 'before') setSelectionBeforeNodeView(self.editorView, self.getPos, self.node);
        else setSelectionAfterNodeView(self.editorView, self.getPos, self.node);
      },
      onCommit: function(value) {
        updateImageNodeViewSource(self, value);
      }
    });
    this.render();
    bindNodeSourceEditorActivation(this.dom, this.sourceEditor);
  }

  ImageNodeView.prototype.render = function() {
    var src = this.node.attrs.src || '';
    var alt = this.node.attrs.alt || '';
    var title = this.node.attrs.title || '';
    var resolved = resolveImageNodeSrc(src, this.options);
    this.dom.textContent = '';
    this.dom.setAttribute('data-markdown-src', src);
    if (resolved) {
      var self = this;
      var image = document.createElement('img');
      image.src = resolved;
      image.alt = alt;
      if (title) image.title = title;
      image.setAttribute('data-markdown-src', src);
      image.addEventListener('error', function() {
        if (image.parentNode === self.dom) self.renderBlocked(src, alt);
      });
      this.dom.classList.remove('is-blocked-image');
      this.dom.appendChild(image);
      return;
    }
    this.renderBlocked(src, alt);
  };

  ImageNodeView.prototype.renderBlocked = function(src, alt) {
    this.dom.textContent = '';
    this.dom.setAttribute('data-markdown-src', src);
    var fallback = document.createElement('span');
    fallback.className = 'blocked-image';
    fallback.setAttribute('data-markdown-src', src);
    fallback.setAttribute('data-markdown-alt', alt || '画像');
    fallback.textContent = imageFallbackText(src, alt, this.options);
    this.dom.classList.add('is-blocked-image');
    this.dom.appendChild(fallback);
  };

  ImageNodeView.prototype.update = function(node) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    setSourceEditorValue(this.sourceEditor, imageSourceEditorValue(node));
    this.render();
    return true;
  };

  ImageNodeView.prototype.stopEvent = stopNodeSourceEditorEvent;
  ImageNodeView.prototype.selectNode = selectAtomSourceNode;
  ImageNodeView.prototype.deselectNode = deselectAtomSourceNode;
  ImageNodeView.prototype.ignoreMutation = function(mutation) { return ignoreNodeSourceEditorMutation(mutation) || true; };
  ImageNodeView.prototype.destroy = function() { destroyNodeSourceEditor(this.sourceEditor); };

  function refreshImageNodeViews(editorView) {
    var imageNodes = editorView.dom.querySelectorAll('.pme-image-node');
    for (var index = 0; index < imageNodes.length; index += 1) {
      if (imageNodes[index].__pmeImageNodeView) imageNodes[index].__pmeImageNodeView.render();
    }
  }

  function refreshTocNodeViews(editorView) {
    var tocNodes = editorView.dom.querySelectorAll('.pme-toc-node');
    for (var index = 0; index < tocNodes.length; index += 1) {
      renderTocInto(tocNodes[index], editorView.state.doc, editorView, tocNodes[index].querySelector('.pme-node-source-editor--toc'));
    }
  }

  function tocRefreshPlugin() {
    return new state.Plugin({
      view: function(editorView) {
        return {
          update: function(updatedView, previousState) {
            if (previousState.doc !== updatedView.state.doc) refreshTocNodeViews(updatedView);
          }
        };
      }
    });
  }

  function TaskListItemNodeView(node, editorView, getPos) {
    this.node = node;
    this.editorView = editorView;
    this.getPos = getPos;
    this.dom = document.createElement('li');
    this.contentDOM = document.createElement('div');
    this.contentDOM.className = 'pme-task-list-item-content';
    this.checkbox = null;
    this.onCheckboxChange = this.onCheckboxChange.bind(this);
    this.dom.appendChild(this.contentDOM);
    this.syncCheckbox();
  }

  TaskListItemNodeView.prototype.syncCheckbox = function() {
    var isTask = this.node.attrs.task != null;
    this.dom.classList.toggle('task-list-item', isTask);
    this.dom.classList.toggle('pme-task-list-item', isTask);
    this.dom.removeAttribute('data-task-checked');
    if (!isTask) {
      if (this.checkbox) {
        this.checkbox.removeEventListener('change', this.onCheckboxChange);
        this.checkbox.remove();
        this.checkbox = null;
      }
      return;
    }
    if (!this.checkbox) {
      this.checkbox = document.createElement('input');
      this.checkbox.type = 'checkbox';
      this.checkbox.className = 'task-checkbox pme-task-checkbox';
      this.checkbox.setAttribute('contenteditable', 'false');
      this.checkbox.addEventListener('change', this.onCheckboxChange);
      this.dom.insertBefore(this.checkbox, this.contentDOM);
    }
    this.checkbox.checked = Boolean(this.node.attrs.task);
    this.checkbox.setAttribute('aria-label', this.checkbox.checked ? 'チェックを外す' : 'チェックを付ける');
    this.dom.setAttribute('data-task-checked', String(this.checkbox.checked));
  };

  TaskListItemNodeView.prototype.onCheckboxChange = function() {
    var pos;
    try { pos = this.getPos(); }
    catch (_) { return; }
    var current = this.editorView.state.doc.nodeAt(pos);
    if (!current || current.type !== this.node.type || current.attrs.task == null) return;
    var attrs = extendObject(current.attrs || {}, { task: Boolean(this.checkbox.checked) });
    this.editorView.dispatch(this.editorView.state.tr.setNodeMarkup(pos, null, attrs));
    this.editorView.focus();
  };

  TaskListItemNodeView.prototype.update = function(node) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.syncCheckbox();
    return true;
  };

  TaskListItemNodeView.prototype.stopEvent = function(event) {
    return Boolean(this.checkbox && (event.target === this.checkbox || this.checkbox.contains(event.target)));
  };

  TaskListItemNodeView.prototype.ignoreMutation = function(mutation) {
    return Boolean(
      (this.checkbox && (mutation.target === this.checkbox || this.checkbox.contains(mutation.target)))
      || (mutation.type === 'childList' && mutation.target === this.dom)
    );
  };

  TaskListItemNodeView.prototype.destroy = function() {
    if (this.checkbox) this.checkbox.removeEventListener('change', this.onCheckboxChange);
  };

  function safeCodeBlockLanguage(value) {
    var match = String(value || '').trim().match(/^[A-Za-z0-9_+.-]{1,32}/);
    return match ? match[0] : '';
  }

  var richCodeHighlightPluginKey = new state.PluginKey('pmeRichCodeHighlight');
  var MAX_RICH_CODE_HIGHLIGHT_CHARS = 120000;

  function highlightScopeClassName(scope) {
    var value = String(scope || '');
    if (!value) return '';
    if (value.indexOf('language:') === 0) return 'language-' + value.slice('language:'.length);
    var parts = value.split('.');
    var classNames = ['hljs-' + parts.shift()];
    for (var index = 0; index < parts.length; index += 1) {
      classNames.push(parts[index] + '_'.repeat(index + 1));
    }
    return classNames.join(' ');
  }

  function collectHighlightRanges(node, offset, ranges) {
    if (typeof node === 'string') return offset + node.length;
    if (!node || !Array.isArray(node.children)) return offset;
    var start = offset;
    for (var index = 0; index < node.children.length; index += 1) {
      offset = collectHighlightRanges(node.children[index], offset, ranges);
    }
    var className = highlightScopeClassName(node.scope);
    if (className && offset > start) ranges.push({ from: start, to: offset, className: className });
    return offset;
  }

  function highlightedCodeRanges(code, language) {
    var highlighter = global.hljs;
    if (!language || code.length > MAX_RICH_CODE_HIGHLIGHT_CHARS || !highlighter
      || typeof highlighter.highlight !== 'function' || typeof highlighter.getLanguage !== 'function'
      || !highlighter.getLanguage(language)) return [];
    try {
      var result = highlighter.highlight(code, { language: language, ignoreIllegals: true });
      var rootNode = result && result._emitter && result._emitter.rootNode;
      if (!rootNode) return [];
      var ranges = [];
      return collectHighlightRanges(rootNode, 0, ranges) === code.length ? ranges : [];
    } catch (_) {
      return [];
    }
  }

  function richCodeHighlightDecorations(doc) {
    var decorations = [];
    doc.descendants(function(node, pos) {
      if (node.type !== schema.nodes.code_block) return true;
      var ranges = highlightedCodeRanges(node.textContent, safeCodeBlockLanguage(node.attrs && node.attrs.params));
      for (var index = 0; index < ranges.length; index += 1) {
        var range = ranges[index];
        decorations.push(view.Decoration.inline(pos + 1 + range.from, pos + 1 + range.to, { class: range.className }));
      }
      return false;
    });
    return view.DecorationSet.create(doc, decorations);
  }

  function richCodeHighlightPlugin() {
    return new state.Plugin({
      key: richCodeHighlightPluginKey,
      state: {
        init: function(_, editorState) { return richCodeHighlightDecorations(editorState.doc); },
        apply: function(transaction, decorations) {
          return transaction.docChanged ? richCodeHighlightDecorations(transaction.doc) : decorations;
        }
      },
      props: {
        decorations: function(editorState) { return richCodeHighlightPluginKey.getState(editorState); }
      }
    });
  }

  function CodeBlockNodeView(node, editorView, getPos) {
    this.node = node;
    this.editorView = editorView;
    this.getPos = getPos;
    this.dom = document.createElement('pre');
    this.dom.className = 'code-block pme-code-block';
    this.languageInput = document.createElement('input');
    this.languageInput.className = 'code-language-input pme-code-language-input';
    this.languageInput.type = 'text';
    this.languageInput.setAttribute('list', 'codeLanguageOptions');
    this.languageInput.setAttribute('aria-label', 'コードブロックの言語');
    this.languageInput.setAttribute('placeholder', 'text');
    this.languageInput.setAttribute('spellcheck', 'false');
    this.languageInput.setAttribute('autocomplete', 'off');
    this.languageInput.setAttribute('autocapitalize', 'off');
    this.languageInput.setAttribute('contenteditable', 'false');
    this.contentDOM = document.createElement('code');
    this.dom.appendChild(this.languageInput);
    this.dom.appendChild(this.contentDOM);
    var self = this;
    this.onLanguageInput = function() {
      var raw = String(self.languageInput.value || '');
      var normalized = raw.replace(/[^A-Za-z0-9_+.-]/g, '').slice(0, 32);
      if (raw !== normalized) {
        var cursor = Math.min(normalized.length, self.languageInput.selectionStart || normalized.length);
        self.languageInput.value = normalized;
        if (typeof self.languageInput.setSelectionRange === 'function') self.languageInput.setSelectionRange(cursor, cursor);
      }
      updateNodeViewAttrs(self.editorView, self.getPos, self.node, { params: normalized });
    };
    this.onLanguageKeyDown = function(event) {
      if (event.key !== 'Enter' && event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      self.languageInput.blur();
      self.editorView.focus();
    };
    this.languageInput.addEventListener('input', this.onLanguageInput);
    this.languageInput.addEventListener('keydown', this.onLanguageKeyDown);
    this.update(node);
  }

  CodeBlockNodeView.prototype.update = function(node) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    var params = String(node.attrs && node.attrs.params || '');
    if (params) this.dom.setAttribute('data-params', params);
    else this.dom.removeAttribute('data-params');
    var language = safeCodeBlockLanguage(params);
    if (this.languageInput.value !== language) this.languageInput.value = language;
    this.contentDOM.className = 'hljs' + (language ? ' language-' + language : '');
    return true;
  };

  CodeBlockNodeView.prototype.stopEvent = function(event) {
    return Boolean(event && (event.target === this.languageInput || this.languageInput.contains(event.target)));
  };

  CodeBlockNodeView.prototype.ignoreMutation = function(mutation) {
    return Boolean(mutation && (mutation.target === this.languageInput || this.languageInput.contains(mutation.target)
      || (mutation.type === 'attributes' && mutation.target === this.dom)));
  };

  CodeBlockNodeView.prototype.destroy = function() {
    this.languageInput.removeEventListener('input', this.onLanguageInput);
    this.languageInput.removeEventListener('keydown', this.onLanguageKeyDown);
  };

  function extendedNodeViews(options) {
    return {
      code_block: function(node, editorView, getPos) { return new CodeBlockNodeView(node, editorView, getPos); },
      list_item: function(node, editorView, getPos) { return new TaskListItemNodeView(node, editorView, getPos); },
      image: function(node, editorView, getPos) { return new ImageNodeView(node, editorView, getPos, options); },
      math_inline: function(node, editorView, getPos) { return new MathNodeView(node, editorView, getPos); },
      math_display: function(node, editorView, getPos) { return new MathNodeView(node, editorView, getPos); },
      mermaid_block: function(node, editorView, getPos) { return new MermaidNodeView(node, editorView, getPos); },
      toc_block: function(node, editorView, getPos) { return new TocNodeView(node, editorView, getPos); }
    };
  }

  function inlineMarkInputRule(regexp, markType, getAttrs, options) {
    if (!markType) return null;
    return new inputRulesModule.InputRule(regexp, function(editorState, match, start, end) {
      var contentIndex = options && options.contentIndex || 1;
      var prefixIndex = options && options.preservePrefixIndex || 0;
      var text = match[contentIndex];
      if (!text) return null;
      var replaceStart = start + (prefixIndex && match[prefixIndex] ? match[prefixIndex].length : 0);
      var tr = editorState.tr.delete(replaceStart, end);
      tr.insert(replaceStart, schema.text(text, [markType.create(getAttrs ? getAttrs(match) : null)]));
      tr.setSelection(state.TextSelection.create(tr.doc, replaceStart + text.length));
      return clearStoredMarks(tr);
    });
  }

  function inlineCodeInputRule() {
    return inlineMarkInputRule(/`([^`\n]+)`$/, schema.marks.code);
  }

  function linkInputRule() {
    return inlineMarkInputRule(/\[([^\]\n]+)\]\(([^()\s]+)\)$/, schema.marks.link, function(match) {
      return { href: match[2], title: null };
    });
  }

  function imageInputRule() {
    if (!schema.nodes.image) return null;
    return new inputRulesModule.InputRule(/!\[([^\]\n]*)\]\(([^()\s]+)\)$/, function(editorState, match, start, end) {
      var tr = editorState.tr.delete(start, end);
      tr.insert(start, schema.nodes.image.create({ src: match[2], alt: match[1] || null, title: null }));
      tr.setSelection(state.TextSelection.create(tr.doc, start + 1));
      return clearStoredMarks(tr);
    });
  }

  function taskListItemDepth($pos) {
    for (var depth = $pos.depth; depth > 0; depth -= 1) {
      if ($pos.node(depth).type === schema.nodes.list_item) return depth;
    }
    return -1;
  }

  function taskListItemInputRule() {
    if (!schema.nodes.list_item) return null;
    return new inputRulesModule.InputRule(/^\[([ xX])\]\s$/, function(editorState, match, start, end) {
      var $start = editorState.doc.resolve(start);
      var itemDepth = taskListItemDepth($start);
      if (itemDepth < 0) return null;
      var itemPos = $start.before(itemDepth);
      var item = editorState.doc.nodeAt(itemPos);
      if (!item || item.type !== schema.nodes.list_item || item.attrs.task != null) return null;
      var attrs = extendObject(item.attrs || {}, { task: match[1].toLowerCase() === 'x' });
      return clearStoredMarks(editorState.tr.delete(start, end).setNodeMarkup(itemPos, null, attrs));
    });
  }

  function selectedListItemPositions(doc, selection) {
    var positions = [];
    doc.descendants(function(node, pos) {
      if (node.type !== schema.nodes.list_item) return true;
      var from = pos + 1;
      var to = pos + node.nodeSize - 1;
      var selected = selection.empty
        ? from <= selection.from && selection.from <= to
        : selection.from < to && selection.to > from;
      if (selected) positions.push(pos);
      return true;
    });
    return positions;
  }

  function setChecklistAttrs(transaction) {
    var positions = selectedListItemPositions(transaction.doc, transaction.selection);
    for (var index = 0; index < positions.length; index += 1) {
      var item = transaction.doc.nodeAt(positions[index]);
      if (!item || item.type !== schema.nodes.list_item || item.attrs.task != null) continue;
      transaction.setNodeMarkup(positions[index], null, extendObject(item.attrs || {}, { task: false }));
    }
    return positions.length > 0;
  }

  function applyChecklistFormatCommand(editorState, dispatch) {
    if (!schema.nodes.list_item || !schema.nodes.bullet_list) return false;
    var positions = selectedListItemPositions(editorState.doc, editorState.selection);
    if (positions.length) {
      if (dispatch) {
        var tr = editorState.tr;
        setChecklistAttrs(tr);
        dispatch(tr.scrollIntoView());
      }
      return true;
    }
    var wrap = schemaList.wrapInList(schema.nodes.bullet_list);
    if (!dispatch) return wrap(editorState);
    return wrap(editorState, function(transaction) {
      setChecklistAttrs(transaction);
      dispatch(transaction.scrollIntoView());
    });
  }

  function markdownInputRules() {
    var rules = [];
    var mathDisplay = mathDisplayInputRule();
    if (mathDisplay) rules.push(mathDisplay);
    var inlineMath = inlineMathInputRule();
    if (inlineMath) rules.push(inlineMath);
    var parenMath = parenMathInputRule();
    if (parenMath) rules.push(parenMath);
    var toc = tocInputRule();
    if (toc) rules.push(toc);
    var inlineCode = inlineCodeInputRule();
    if (inlineCode) rules.push(inlineCode);
    var image = imageInputRule();
    if (image) rules.push(image);
    var link = linkInputRule();
    if (link) rules.push(link);
    rules.push(inlineMarkInputRule(/\*\*([^*\n]+)\*\*$/, schema.marks.strong));
    rules.push(inlineMarkInputRule(/__([^_\n]+)__$/, schema.marks.strong));
    rules.push(inlineMarkInputRule(/(^|[^*])\*([^*\n]+)\*$/, schema.marks.em, null, { contentIndex: 2, preservePrefixIndex: 1 }));
    rules.push(inlineMarkInputRule(/(^|[^_])_([^_\n]+)_$/, schema.marks.em, null, { contentIndex: 2, preservePrefixIndex: 1 }));
    rules.push(inlineMarkInputRule(/~~([^~\n]+)~~$/, schema.marks.strike));
    if (schema.nodes.blockquote) {
      rules.push(inputRulesModule.wrappingInputRule(/^\s*>\s$/, schema.nodes.blockquote));
    }
    if (schema.nodes.heading) {
      rules.push(inputRulesModule.textblockTypeInputRule(
        /^(#{1,6})\s$/,
        schema.nodes.heading,
        function(match) { return { level: match[1].length }; }
      ));
    }
    var taskListItem = taskListItemInputRule();
    if (taskListItem) rules.push(taskListItem);
    if (schema.nodes.bullet_list) {
      rules.push(inputRulesModule.wrappingInputRule(/^\s*([-+*])\s$/, schema.nodes.bullet_list));
    }
    if (schema.nodes.ordered_list) {
      rules.push(inputRulesModule.wrappingInputRule(
        /^(\d+)\.\s$/,
        schema.nodes.ordered_list,
        function(match) { return { order: Number(match[1]) }; },
        function(match, node) { return node.childCount + node.attrs.order === Number(match[1]); }
      ));
    }
    return inputRulesModule.inputRules({ rules: rules });
  }

  function createState(markdownText) {
    var doc = ensureEditableTrailingParagraph(parseMarkdown(markdownText || ''));
    var listItem = schema.nodes.list_item;
    var keys = {
      'Mod-z': historyModule.undo,
      'Mod-y': historyModule.redo,
      'Shift-Mod-z': historyModule.redo,
      'Backspace': commands.chainCommands(deleteSelectedOrAdjacentAtomCommand(-1), joinParagraphAfterListIntoPreviousItem, inputRulesModule.undoInputRule, commands.baseKeymap.Backspace),
      'Delete': commands.chainCommands(deleteSelectedOrAdjacentAtomCommand(1), commands.baseKeymap.Delete),
      'Shift-Enter': commands.chainCommands(commands.newlineInCode, insertHardBreakCommand),
      'ArrowLeft': enterStoredMarksAtInlineBoundaryCommand,
      'ArrowRight': commands.chainCommands(enterLinkHrefEditorAtBoundaryCommand, clearStoredMarksAtInlineBoundaryCommand)
    };
    if (listItem) {
      keys.Enter = commands.chainCommands(
        tableCellEnterCommand,
        extendedBlockInputCommand,
        fencedCodeBlockInputCommand,
        repairEmptyListItemWithChildList(listItem),
        exitEmptyListItemToParagraph(listItem),
        schemaList.splitListItem(listItem),
        commands.baseKeymap.Enter
      );
      keys.Tab = commands.chainCommands(moveTableCellCommand(1), schemaList.sinkListItem(listItem));
      keys['Shift-Tab'] = commands.chainCommands(moveTableCellCommand(-1), schemaList.liftListItem(listItem));
    }
    return state.EditorState.create({
      schema: schema,
      doc: doc,
      plugins: [
        historyModule.history(),
        markdownInputRules(),
        markdownShapeNormalizationPlugin(),
        emptyTextblockStoredMarksCleanupPlugin(),
        editableTrailingParagraphPlugin(),
        richCodeHighlightPlugin(),
        inlineVisualAffordancePlugin(),
        tocRefreshPlugin(),
        tableToolbarPlugin(),
        keymapModule.keymap(keys),
        keymapModule.keymap(commands.baseKeymap),
        dropcursor.dropCursor(),
        gapcursor.gapCursor(),
        tableModule.tableEditing()
      ]
    });
  }

  function textSelectionMarkdown(viewInstance) {
    var selection = viewInstance.state.selection;
    return viewInstance.state.doc.textBetween(selection.from, selection.to, '\n');
  }

  function headingPositionByIndex(doc, index) {
    if (!Number.isInteger(index) || index < 0) return null;
    var current = 0;
    var found = null;
    doc.descendants(function(node, pos) {
      if (found != null) return false;
      if (node.type !== schema.nodes.heading) return true;
      if (current === index) {
        found = pos;
        return false;
      }
      current += 1;
      return true;
    });
    return found;
  }

  function revealHeadingByIndex(editorView, index) {
    var pos = headingPositionByIndex(editorView.state.doc, index);
    if (pos == null) return false;
    var node = editorView.state.doc.nodeAt(pos);
    if (!node || node.type !== schema.nodes.heading) return false;
    var selectionPos = Math.min(pos + 1, pos + node.nodeSize - 1);
    var tr = editorView.state.tr.setSelection(state.TextSelection.create(editorView.state.doc, selectionPos)).scrollIntoView();
    editorView.dispatch(tr);
    var headingDom = editorView.nodeDOM(pos);
    if (headingDom && typeof headingDom.scrollIntoView === 'function') {
      window.requestAnimationFrame(function() {
        headingDom.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
    editorView.focus();
    return true;
  }

  function sliceFromMarkdown(markdownText, inline) {
    var parsed = parseMarkdown(markdownText || '');
    if (inline && parsed.childCount === 1 && parsed.firstChild && parsed.firstChild.type.name === 'paragraph') {
      return new model.Slice(parsed.firstChild.content, 0, 0);
    }
    return new model.Slice(parsed.content, 0, 0);
  }

  function selectionFromClickPosition(editorView, pos) {
    if (!Number.isInteger(pos)) return null;
    var doc = editorView.state.doc;
    var bounded = Math.max(0, Math.min(pos, doc.content.size));
    try {
      var $pos = doc.resolve(bounded);
      if ($pos.parent.inlineContent) return state.TextSelection.create(doc, bounded);
      return state.Selection.near($pos);
    } catch (_) {
      return null;
    }
  }

  function atomSelectionFromEvent(editorView, event) {
    var target = event && event.target;
    while (target && target !== editorView.dom) {
      if (target.getAttribute && target.getAttribute('data-pme-atom-node')) {
        try {
          var pos = editorView.posAtDOM(target, 0);
          var node = editorView.state.doc.nodeAt(pos);
          if (node && node.isAtom && node.type.spec.selectable !== false) {
            return state.NodeSelection.create(editorView.state.doc, pos);
          }
        } catch (_) {
          return null;
        }
      }
      target = target.parentNode;
    }
    return null;
  }

  function shouldClearStoredMarksAtInlineBoundary(selection) {
    if (!selection || !selection.empty) return false;
    var $from = selection.$from;
    if (!$from.parent.inlineContent || $from.parentOffset === 0) return false;
    var before = $from.nodeBefore;
    if (!before || !before.isText || !before.marks || before.marks.length === 0) return false;
    var after = $from.nodeAfter;
    if (after && after.isText && model.Mark.sameSet(before.marks, after.marks)) return false;
    return true;
  }

  function clearStoredMarksAtInlineBoundaryCommand(editorState, dispatch) {
    if (Array.isArray(editorState.storedMarks) && editorState.storedMarks.length === 0) return false;
    if (!shouldClearStoredMarksAtInlineBoundary(editorState.selection)) return false;
    if (dispatch) dispatch(clearStoredMarks(editorState.tr));
    return true;
  }

  function marksBeforeInlineBoundary(editorState) {
    var selection = editorState.selection;
    if (!shouldClearStoredMarksAtInlineBoundary(selection)) return null;
    var beforeMarks = selection.$from.nodeBefore.marks;
    var activeMarks = activeMarksForVisualAffordance(editorState);
    return model.Mark.sameSet(beforeMarks, activeMarks) ? null : beforeMarks;
  }

  function enterStoredMarksAtInlineBoundaryCommand(editorState, dispatch) {
    var marks = marksBeforeInlineBoundary(editorState);
    if (!marks) return false;
    if (dispatch) {
      var previousPos = Math.max(0, editorState.selection.from - 1);
      var tr = editorState.tr
        .setSelection(state.TextSelection.create(editorState.doc, previousPos))
        .setStoredMarks(marks);
      dispatch(tr.scrollIntoView());
    }
    return true;
  }

  function applyInlineCodeFormatCommand(editorState, dispatch) {
    var markType = schema.marks.code;
    var selection = editorState.selection;
    if (!markType || !selection) return false;
    var activeCode = markFromSet(activeMarksForVisualAffordance(editorState), markType);
    if (!selection.empty || activeCode) {
      return commands.toggleMark(markType)(editorState, dispatch);
    }
    if (!selection.$from.parent.inlineContent) return false;
    if (dispatch) {
      var codeMark = markType.create();
      var placeholder = schema.text('code', [codeMark]);
      var from = selection.from;
      var tr = editorState.tr.replaceSelectionWith(placeholder, false);
      tr = tr.setSelection(state.TextSelection.create(tr.doc, from, from + placeholder.nodeSize));
      tr = tr.setStoredMarks([codeMark]);
      dispatch(tr.scrollIntoView());
    }
    return true;
  }

  function codeMarkAcrossSelection(doc, from, to) {
    if (!schema.marks.code || from >= to) return null;
    var $from = doc.resolve(from);
    var $to = doc.resolve(to);
    if (!$from.sameParent($to) || !$from.parent.inlineContent) return null;
    var codeMark = null;
    var hasText = false;
    var valid = true;
    doc.nodesBetween(from, to, function(node, pos) {
      if (!node.isText || pos >= to || pos + node.nodeSize <= from) return;
      hasText = true;
      var current = schema.marks.code.isInSet(node.marks || []);
      if (!current || (codeMark && !codeMark.eq(current))) valid = false;
      else if (!codeMark) codeMark = current;
    });
    return hasText && valid ? codeMark : null;
  }

  function preserveInlineCodeSelectionTextInput(editorView, from, to, text) {
    var codeMark = codeMarkAcrossSelection(editorView.state.doc, from, to);
    if (!codeMark) return false;
    var tr = editorView.state.tr.delete(from, to);
    if (text) tr = tr.insert(from, schema.text(text, [codeMark]));
    tr = tr.setSelection(state.TextSelection.create(tr.doc, from + String(text || '').length));
    tr = tr.setStoredMarks([codeMark]);
    editorView.dispatch(tr.scrollIntoView());
    return true;
  }

  function preserveInlineCodeSelectionBeforeInput(editorView, event) {
    if (!event || event.inputType !== 'insertText' || typeof event.data !== 'string' || !event.data) return false;
    var selection = editorView.state.selection;
    if (!selection || selection.empty || !codeMarkAcrossSelection(editorView.state.doc, selection.from, selection.to)) return false;
    event.preventDefault();
    return preserveInlineCodeSelectionTextInput(editorView, selection.from, selection.to, event.data);
  }

  function preserveInlineCodeSelectionKeyDown(editorView, event) {
    if (!event || event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || String(event.key || '').length !== 1) return false;
    var selection = editorView.state.selection;
    if (!selection || selection.empty || !codeMarkAcrossSelection(editorView.state.doc, selection.from, selection.to)) return false;
    event.preventDefault();
    return preserveInlineCodeSelectionTextInput(editorView, selection.from, selection.to, event.key);
  }

  function clearStoredMarksForInlineBoundaryClick(transaction, selection) {
    if (shouldClearStoredMarksAtInlineBoundary(selection)) clearStoredMarks(transaction);
    return transaction;
  }

  function setSelectionFromSingleClick(editorView, pos, event) {
    if (event.button !== 0 || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return false;
    var selection = atomSelectionFromEvent(editorView, event) || selectionFromClickPosition(editorView, pos);
    if (!selection) return false;
    var transaction = editorView.state.tr.setSelection(selection);
    clearStoredMarksForInlineBoundaryClick(transaction, selection);
    editorView.dispatch(transaction);
    editorView.focus();
    return true;
  }

  function markdownClipboardTextParser(text, $context) {
    if (!text) return null;
    var normalized = normalizeNewlines(text);
    var parent = $context && $context.parent;
    if (parent && parent.type && parent.type.spec.code) return null;
    var inline = Boolean(parent && parent.inlineContent && !looksLikeMarkdownBlock(normalized));
    return sliceFromMarkdown(normalized, inline);
  }

  function shouldHandleMarkdownPlainTextPaste(text, editorState) {
    var normalized = normalizeNewlines(text || '');
    if (!normalized.trim()) return false;
    var selection = editorState.selection;
    var parent = selection && selection.$from && selection.$from.parent;
    if (!parent || parent.type.spec.code) return false;
    if (parent.type === schema.nodes.table_cell || parent.type === schema.nodes.table_header) return false;
    return looksLikeMarkdownBlock(normalized) || inlineMarkdownSourceLooksInteresting(normalized);
  }

  function handleMarkdownPlainTextPaste(editorView, event) {
    var text = normalizeNewlines(event && event.clipboardData && event.clipboardData.getData('text/plain') || '');
    if (!shouldHandleMarkdownPlainTextPaste(text, editorView.state)) return false;
    var parent = editorView.state.selection.$from.parent;
    var inline = Boolean(parent && parent.inlineContent && !looksLikeMarkdownBlock(text));
    var slice = sliceFromMarkdown(text, inline);
    if (!slice) return false;
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
    editorView.dispatch(editorView.state.tr.replaceSelection(slice).scrollIntoView().setMeta('paste', true).setMeta('uiEvent', 'paste'));
    return true;
  }

  function createRichMarkdownEditor(options) {
    if (!options || !options.mount) throw new Error('mount is required');
    var mount = options.mount;
    var applyingExternal = false;
    var destroyed = false;
    mount.textContent = '';
    var editorView = new view.EditorView(mount, {
      state: createState(options.markdown || ''),
      dispatchTransaction: function(transaction) {
        if (destroyed) return;
        var next = editorView.state.apply(transaction);
        editorView.updateState(next);
        if (transaction.docChanged && !applyingExternal && typeof options.onChange === 'function') {
          options.onChange(serializeMarkdown(next.doc));
        }
      },
      handleClick: setSelectionFromSingleClick,
      handleDOMEvents: { beforeinput: preserveInlineCodeSelectionBeforeInput },
      handleKeyDown: preserveInlineCodeSelectionKeyDown,
      handleTextInput: preserveInlineCodeSelectionTextInput,
      handlePaste: handleMarkdownPlainTextPaste,
      clipboardTextParser: markdownClipboardTextParser,
      nodeViews: extendedNodeViews(options || {}),
      attributes: {
        'aria-label': 'リッチMarkdown編集',
        class: 'pme-prosemirror-editor'
      }
    });

    function run(command) {
      if (destroyed || typeof command !== 'function') return false;
      return command(editorView.state, editorView.dispatch, editorView);
    }

    return {
      view: editorView,
      canEdit: function(markdownText) { return !unsupportedMarkdownReason(markdownText); },
      unsupportedReason: unsupportedMarkdownReason,
      markdown: function() { return serializeMarkdown(editorView.state.doc); },
      selectedText: function() { return textSelectionMarkdown(editorView); },
      refreshImages: function() {
        if (destroyed) return false;
        refreshImageNodeViews(editorView);
        return true;
      },
      setMarkdown: function(markdownText) {
        if (destroyed) return false;
        if (unsupportedMarkdownReason(markdownText)) return false;
        var nextSource = normalizeNewlines(markdownText || '');
        var nextState = createState(nextSource);
        if (editorView.state.doc.eq(nextState.doc)) return true;
        applyingExternal = true;
        try { editorView.updateState(nextState); }
        finally { applyingExternal = false; }
        return true;
      },
      focus: function() { if (!destroyed) editorView.focus(); },
      hasFocus: function() { return !destroyed && editorView.hasFocus(); },
      revealHeadingByIndex: function(index) {
        if (destroyed) return false;
        return revealHeadingByIndex(editorView, index);
      },
      applyFormat: function(format) {
        switch (format) {
          case 'bold': return run(commands.toggleMark(schema.marks.strong));
          case 'italic': return run(commands.toggleMark(schema.marks.em));
          case 'strikethrough': return run(commands.toggleMark(schema.marks.strike));
          case 'code': return run(applyInlineCodeFormatCommand);
          case 'paragraph': return run(commands.setBlockType(schema.nodes.paragraph));
          case 'h1': return run(commands.setBlockType(schema.nodes.heading, { level: 1 }));
          case 'h2': return run(commands.setBlockType(schema.nodes.heading, { level: 2 }));
          case 'h3': return run(commands.setBlockType(schema.nodes.heading, { level: 3 }));
          case 'h4': return run(commands.setBlockType(schema.nodes.heading, { level: 4 }));
          case 'h5': return run(commands.setBlockType(schema.nodes.heading, { level: 5 }));
          case 'h6': return run(commands.setBlockType(schema.nodes.heading, { level: 6 }));
          case 'quote': return run(commands.wrapIn(schema.nodes.blockquote));
          case 'list': return schema.nodes.bullet_list ? run(schemaList.wrapInList(schema.nodes.bullet_list)) : false;
          case 'ordered-list': return schema.nodes.ordered_list ? run(schemaList.wrapInList(schema.nodes.ordered_list)) : false;
          case 'checklist': return run(applyChecklistFormatCommand);
          default: return false;
        }
      },
      insertMarkdown: function(markdownText, insertOptions) {
        if (destroyed) return false;
        var slice = sliceFromMarkdown(markdownText, Boolean(insertOptions && insertOptions.inline));
        var transaction = editorView.state.tr.replaceSelection(slice).scrollIntoView();
        editorView.dispatch(transaction);
        editorView.focus();
        return true;
      },
      destroy: function() {
        destroyed = true;
        editorView.destroy();
        mount.textContent = '';
      }
    };
  }

  global.PMEProseMirror = {
    createRichMarkdownEditor: createRichMarkdownEditor,
    unsupportedMarkdownReason: unsupportedMarkdownReason,
    requiresCanonicalMarkdownNormalization: requiresCanonicalMarkdownNormalization,
    normalizeMarkdown: function(markdownText) { return serializeMarkdown(parseMarkdown(markdownText)); },
    modules: {
      model: model, state: state, view: view, commands: commands, history: historyModule,
      keymap: keymapModule, schemaList: schemaList, markdown: markdown, tables: tableModule
    }
  };

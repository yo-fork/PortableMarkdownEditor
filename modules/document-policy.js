(() => {
  'use strict';

  const LIMITS = Object.freeze({
    sourceChars: 1024 * 1024, lines: 16384, markers: 65536,
    blocks: 4096, headings: 512, nodes: 30000,
    outputChars: 2 * 1024 * 1024, outputNodes: 60000, renderMs: 1000,
    highlightCalls: 16, highlightChars: 240000,
    mermaidCalls: 8, mermaidChars: 100000,
  });
  const message = '表示上限を超えたため、プレビューを省略しました。原文はソース編集で確認・保存できます。';
  const notice = `<p class="document-render-limit" role="note">${message}</p>`;
  const now = () => typeof performance !== 'undefined' ? performance.now() : Date.now();
  function fail() { throw new RangeError('Document resource limit exceeded'); }
  function isLimit(error) { return error?.message === 'Document resource limit exceeded'; }

  // Reject before splitting lines, building tokens, or allocating editor nodes.
  function allowsSource(source) {
    if (typeof source !== 'string' || source.length > LIMITS.sourceChars) return false;
    let lines = 1;
    let markers = 0;
    for (let i = 0; i < source.length; i += 1) {
      if (source[i] === '\n' || (source[i] === '\r' && source[i + 1] !== '\n')) {
        if (++lines > LIMITS.lines) return false;
      }
      if ('*_[!|`#>$'.includes(source[i]) && ++markers > LIMITS.markers) return false;
    }
    return true;
  }
  function assertSource(source) { if (!allowsSource(source)) fail(); }

  function assertTokens(tokens) {
    const stack = [{ items: tokens, index: 0 }];
    let nodes = 0;
    let headings = 0;
    let blocks = 0;
    while (stack.length) {
      const frame = stack[stack.length - 1];
      if (frame.index === frame.items.length) { stack.pop(); continue; }
      const token = frame.items[frame.index++];
      if (token.block && token.level === 0 && token.nesting !== -1 && ++blocks > LIMITS.blocks) fail();
      if (++nodes > LIMITS.nodes || (token.type === 'heading_open' && ++headings > LIMITS.headings)) fail();
      if (token.children?.length) stack.push({ items: token.children, index: 0 });
    }
  }

  function installMarkdownIt(md) {
    for (const method of ['parse', 'parseInline']) {
      const original = md[method];
      md[method] = function(source, ...args) {
        assertSource(source);
        const started = now();
        const tokens = original.call(this, source, ...args);
        assertTokens(tokens);
        if (now() - started > LIMITS.renderMs) fail();
        return tokens;
      };
    }
  }

  // Bounded traversal also covers schema nodes inserted without Markdown parsing.
  function allowsNode(doc) {
    if (doc.childCount > LIMITS.blocks || doc.content.size > LIMITS.sourceChars * 2) return false;
    const stack = [{ node: doc, index: 0 }];
    let nodes = 0;
    let chars = 0;
    let headings = 0;
    let attributes = 0;
    function countAttributes(value, depth = 0) {
      if (++attributes > LIMITS.nodes * 8 || depth > 16) return false;
      if (typeof value === 'string') chars += value.length;
      else if (value && typeof value === 'object') {
        for (const key in value) {
          if (Object.prototype.hasOwnProperty.call(value, key) && !countAttributes(value[key], depth + 1)) return false;
        }
      } else if (value != null && !['number', 'boolean'].includes(typeof value)) return false;
      return chars <= LIMITS.sourceChars;
    }
    while (stack.length) {
      const frame = stack[stack.length - 1];
      if (frame.index === frame.node.childCount) { stack.pop(); continue; }
      const node = frame.node.child(frame.index++);
      if (++nodes > LIMITS.nodes || (node.type.name === 'heading' && ++headings > LIMITS.headings)) return false;
      chars += (node.text || '').length;
      if (!countAttributes(node.attrs) || (node.marks || []).length > 32) return false;
      for (const mark of node.marks || []) if (!countAttributes(mark.attrs)) return false;
      if (node.childCount) stack.push({ node, index: 0 });
    }
    return true;
  }

  function outputCost(html) {
    if (typeof html !== 'string' || html.length > LIMITS.outputChars) return null;
    let nodes = 1;
    for (let at = html.indexOf('<'); at !== -1; at = html.indexOf('<', at + 1)) {
      nodes += 2; // Includes intervening text, closing tags, and wrapper overhead.
      if (nodes > LIMITS.outputNodes) return null;
    }
    return { chars: html.length, nodes };
  }

  function createOutputBudget() {
    let chars = 0;
    let nodes = 0;
    function reserveCost(cost) {
      if (!cost || chars + cost.chars > LIMITS.outputChars || nodes + cost.nodes > LIMITS.outputNodes) return false;
      chars += cost.chars;
      nodes += cost.nodes;
      return true;
    }
    return {
      reserve(html) { return reserveCost(outputCost(html)); },
      reserveCost,
    };
  }

  // Account for DOMSerializer specs before creating nodes or copying data URLs.
  // Holes are charged separately when their child specs are serialized.
  function createDomOutputBudget() {
    const output = createOutputBudget();
    function escapedCost(text) {
      if (typeof text !== 'string' || text.length > LIMITS.outputChars) fail();
      let chars = text.length;
      for (let i = 0; i < text.length; i += 1) {
        if ('&<>"\u00a0'.includes(text[i])) chars += 5;
        if (chars > LIMITS.outputChars) fail();
      }
      return chars;
    }
    function reserve(spec, depth = 0) {
      if (depth > 32) fail();
      if (spec === 0) return;
      if (typeof spec === 'string') {
        if (!output.reserveCost({ chars: escapedCost(spec), nodes: 1 })) fail();
        return;
      }
      if (!Array.isArray(spec) || typeof spec[0] !== 'string') fail();
      if (!output.reserveCost({ chars: spec[0].length * 2 + 24, nodes: 1 })) fail();
      let from = 1;
      const attrs = spec[1];
      if (attrs && typeof attrs === 'object' && !Array.isArray(attrs)) {
        for (const name in attrs) {
          if (!Object.prototype.hasOwnProperty.call(attrs, name) || attrs[name] == null) continue;
          const value = attrs[name];
          if (!['string', 'number', 'boolean'].includes(typeof value)) fail();
          if (!output.reserveCost({ chars: name.length + escapedCost(String(value)) + 4, nodes: 0 })) fail();
        }
        from = 2;
      }
      for (let i = from; i < spec.length; i += 1) reserve(spec[i], depth + 1);
    }
    return { reserve };
  }

  function createWorkBudget() {
    const used = { highlightCalls: 0, highlightChars: 0, mermaidCalls: 0, mermaidChars: 0 };
    let elapsed = 0;
    const output = createOutputBudget();
    return {
      output,
      reserve(kind, chars) {
        if (elapsed >= LIMITS.renderMs || used[kind + 'Calls'] >= LIMITS[kind + 'Calls']
          || used[kind + 'Chars'] + chars > LIMITS[kind + 'Chars']) return false;
        used[kind + 'Calls'] += 1;
        used[kind + 'Chars'] += chars;
        return true;
      },
      charge(started) { elapsed += Math.max(0, now() - started); return elapsed < LIMITS.renderMs; },
    };
  }

  window.PMEDocumentPolicy = Object.freeze({ LIMITS, notice, message, now, fail, isLimit, allowsSource,
    assertSource, installMarkdownIt, allowsNode, outputCost, createOutputBudget, createDomOutputBudget, createWorkBudget });
})();

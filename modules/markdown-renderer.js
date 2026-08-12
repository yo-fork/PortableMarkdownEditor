(() => {
  'use strict';

  function createMarkdownRenderer(options = {}) {
    const state = options.state;
    const els = options.els;
    const constants = options.constants || {};
    const dependencies = options.dependencies || {};
    if (!state || !els) throw new Error('Markdown renderer requires state and element references');

    const {
      MAX_HIGHLIGHT_CHARS,
      DESKTOP_DOCUMENT_HOST,
      IMAGE_EXTENSION_PATTERN,
      VENDOR_TOC_MARKER,
      DEFAULT_MERMAID_ZOOM,
    } = constants;
    const {
      alignAttr,
      annotateRenderedInlineAtomRanges,
      desktopImageAliasKey,
      displayMathBlockEndIndex,
      displayMathDelimiter,
      displayMathSource,
      escapeAttribute,
      escapeHtml,
      formatMermaidZoomPercent,
      hasPipe,
      isDisplayMathBlock,
      isHeadingLine,
      isHorizontalRule,
      isListLine,
      isProseMirrorRichActive,
      isQuoteLine,
      isTableStart,
      isTocLine,
      isUnsafeRelativePath,
      mermaidZoomValue,
      normalizeAssetPath,
      normalizeNewlines,
      parseAlign,
      safeCodeLanguage,
      setStatus,
      slugify,
      splitTableRow,
      stripExtension,
      stripInlineMarkdown,
      stripRichCaretTokens,
      wrapRenderedInlineAtoms,
    } = dependencies;

    let mermaidRenderSerial = 0;
    let mermaidRenderQueue = Promise.resolve();
    let vendorMarkdownRenderer = null;

    function renderMarkdownHtml(markdown) {
      const blocks = buildBlockModel(stripRichCaretTokens(markdown));
      const headings = buildHeadingIndex(blocks);
      return blocks.map((block) => annotateRenderedBlockHtml(renderBlockHtml(block, headings), block)).join('\n');
    }

    function buildBlockModel(markdown) {
      return splitMarkdownBlocks(markdown).map((block, index) => ({
        ...block,
        id: block.id || `b${index}-${hashString(`${block.start}:${block.end}:${block.type}:${block.raw}`)}`,
      }));
    }

    function annotateRenderedBlockHtml(html, block) {
      if (!html || !Number.isFinite(block?.start) || !Number.isFinite(block?.end)) return html;
      const attrs = [
        ` data-block-id="${escapeAttribute(block.id || '')}"`,
        ` data-block-type="${escapeAttribute(block.type || 'paragraph')}"`,
        ` data-source-start="${escapeAttribute(block.start)}"`,
        ` data-source-end="${escapeAttribute(block.end)}"`,
      ].join('');
      return String(html).replace(/^(\s*<[a-z][\w:-]*)(?=[\s>/])/i, `$1${attrs}`);
    }

    function renderMarkdownWithVendor(markdown) {
      const md = getVendorMarkdownRenderer();
      if (!md) return '';
      const headings = buildHeadingIndex(splitMarkdownBlocks(markdown)).items;
      return md.render(preprocessVendorMarkdown(markdown))
        .replaceAll(`<p>${VENDOR_TOC_MARKER}</p>\n`, renderToc(headings))
        .replaceAll(VENDOR_TOC_MARKER, renderToc(headings));
    }

    function getVendorMarkdownRenderer() {
      if (vendorMarkdownRenderer) return vendorMarkdownRenderer;
      const markdownit = window.markdownit || window.markdownIt;
      if (typeof markdownit !== 'function') return null;

      const md = markdownit({
        html: false,
        linkify: false,
        typographer: true,
        breaks: false,
        highlight(code, lang) {
          return highlightCodeWithVendor(code, normalizeCodeLanguage(lang));
        },
      });
      preserveMarkdownLocalPaths(md);
      installMarkdownItMath(md);
      try {
        md.enable(['strikethrough']);
      } catch (_) {}

      md.renderer.rules.fence = (tokens, index) => {
        const token = tokens[index];
        const lang = safeCodeLanguage((token.info || '').trim());
        const normalized = normalizeCodeLanguage(lang);
        const codeText = token.content || '';
        if (normalized === 'mermaid') return `${renderMermaidPlaceholder(codeText)}\n`;
        const langAttr = lang ? ` data-lang="${escapeAttribute(lang)}"` : '';
        const langClass = normalized ? ` language-${escapeAttribute(normalized)}` : '';
        const label = normalized ? `<span class="code-lang">${escapeHtml(normalized)}</span>` : '';
        return `<pre class="code-block${langClass}">${label}<code class="hljs"${langAttr}>${highlightCodeWithVendor(codeText, normalized)}</code></pre>\n`;
      };

      const defaultLinkOpen = md.renderer.rules.link_open || defaultMarkdownItRule;
      md.renderer.rules.link_open = (tokens, index, options, env, self) => {
        const hrefIndex = tokens[index].attrIndex('href');
        const href = hrefIndex >= 0 ? tokens[index].attrs[hrefIndex][1] : '';
        const safe = sanitizeLinkUrl(href);
        if (!safe) {
          tokens[index].tag = 'span';
          tokens[index].attrs = [['class', 'blocked-link']];
          return self.renderToken(tokens, index, options);
        }
        tokens[index].attrs[hrefIndex][1] = safe;
        tokens[index].attrSet('data-markdown-href', href);
        tokens[index].attrSet('rel', 'noopener noreferrer');
        tokens[index].attrSet('target', '_blank');
        return defaultLinkOpen(tokens, index, options, env, self);
      };

      const defaultLinkClose = md.renderer.rules.link_close || defaultMarkdownItRule;
      md.renderer.rules.link_close = (tokens, index, options, env, self) => {
        const previous = findPreviousOpenToken(tokens, index);
        if (previous?.tag === 'span' && previous.attrGet('class') === 'blocked-link') {
          tokens[index].tag = 'span';
        }
        return defaultLinkClose(tokens, index, options, env, self);
      };

      md.renderer.rules.image = (tokens, index) => {
        const token = tokens[index];
        const src = restoreMarkdownLocalPath(token.attrGet('src') || '');
        const safe = sanitizeImageUrl(src);
        const alt = token.content || token.attrGet('alt') || 'no alt';
        if (!safe) return renderBlockedImage(src, alt);
        return `<img alt="${escapeAttribute(alt)}" src="${escapeAttribute(safe)}" data-markdown-src="${escapeAttribute(src)}">`;
      };

      enableTaskListRendering(md);
      vendorMarkdownRenderer = md;
      return vendorMarkdownRenderer;
    }

    function enableTaskListRendering(md) {
      md.core.ruler.after('inline', 'pme_task_lists', (state) => {
        for (let index = 2; index < state.tokens.length; index += 1) {
          const inlineToken = state.tokens[index];
          const paragraphOpen = state.tokens[index - 1];
          const listItemOpen = state.tokens[index - 2];
          if (inlineToken.type !== 'inline' || paragraphOpen.type !== 'paragraph_open' || listItemOpen.type !== 'list_item_open') continue;

          const match = inlineToken.content.match(/^\[([ xX])\]\s+/);
          if (!match) continue;

          const checked = match[1].toLowerCase() === 'x';
          const sourceOffset = sourceOffsetForMarkdownItLine(state.env, listItemOpen.map?.[0], inlineToken.content, match.index);
          inlineToken.content = inlineToken.content.slice(match[0].length);
          inlineToken.children = stripTaskMarkerFromInlineChildren(
            inlineToken.children || [],
            match[0].length,
            state.Token,
            checked,
            sourceOffset,
          );
          listItemOpen.attrJoin('class', 'task-list-item');
          const listOpen = findParentListOpenToken(state.tokens, index - 2);
          if (listOpen) listOpen.attrJoin('class', 'task-list');
        }
      });
    }

    function sourceOffsetForMarkdownItLine(env, lineNumber, inlineContent, markerIndex) {
      const base = Number.isFinite(env?.baseOffset) ? env.baseOffset : 0;
      const lineOffset = Number.isInteger(lineNumber) ? env?.lineOffsets?.[lineNumber] : 0;
      if (!Number.isFinite(lineOffset)) return '';
      const markerStart = String(inlineContent || '').indexOf('[');
      return base + lineOffset + Math.max(0, markerStart) + markerIndex + 1;
    }

    function stripTaskMarkerFromInlineChildren(children, markerLength, Token, checked, sourceOffset = '') {
      let remaining = markerLength;
      const nextChildren = [];
      for (const child of children) {
        if (remaining > 0 && child.type === 'text') {
          if (child.content.length <= remaining) {
            remaining -= child.content.length;
            continue;
          }
          child.content = child.content.slice(remaining);
          remaining = 0;
        }
        nextChildren.push(child);
      }
      const checkbox = new Token('html_inline', '', 0);
      const offsetAttr = sourceOffset === '' ? '' : ` data-task-pos="${escapeAttribute(sourceOffset)}"`;
      checkbox.content = `<input class="task-checkbox" type="checkbox"${offsetAttr}${checked ? ' checked' : ''}>`;
      return [checkbox, ...nextChildren];
    }

    function findParentListOpenToken(tokens, listItemIndex) {
      for (let index = listItemIndex - 1; index >= 0; index -= 1) {
        if (tokens[index].type === 'bullet_list_open' || tokens[index].type === 'ordered_list_open') return tokens[index];
      }
      return null;
    }

    function defaultMarkdownItRule(tokens, index, options, _env, self) {
      return self.renderToken(tokens, index, options);
    }

    function preserveMarkdownLocalPaths(md) {
      if (!md || typeof md.normalizeLink !== 'function') return;
      const normalizeLink = md.normalizeLink.bind(md);
      md.normalizeLink = (value) => shouldPreserveMarkdownLocalPath(value)
        ? restoreMarkdownLocalPath(value)
        : normalizeLink(value);
    }

    function shouldPreserveMarkdownLocalPath(value) {
      const decoded = decodeLocalImagePath(String(value || ''));
      return decoded.includes('\\')
        || /^[A-Za-z]:[\\/]/.test(decoded)
        || /^file:/i.test(decoded);
    }

    function restoreMarkdownLocalPath(value) {
      return shouldPreserveMarkdownLocalPath(value) ? decodeLocalImagePath(value) : String(value || '');
    }

    function installMarkdownItMath(md) {
      if (!md?.inline?.ruler || !md?.renderer?.rules) return;
      md.inline.ruler.before('escape', 'pme_math_inline', (inlineState, silent) => {
        const match = inlineMathTokenAt(inlineState.src, inlineState.pos);
        if (!match) return false;
        if (!silent) {
          const token = inlineState.push('pme_math_inline', '', 0);
          token.content = match.value;
        }
        inlineState.pos = match.end;
        return true;
      });
      md.renderer.rules.pme_math_inline = (tokens, index) => renderInlineMathHtml(tokens[index].content || '');
    }

    function renderInlineMathHtml(source) {
      const value = String(source || '');
      return `<span class="math-inline" data-math-source="${escapeAttribute(value)}" data-math-display="false">${renderKaTeX(value, false)}</span>`;
    }

    function inlineMathTokenAt(text, start) {
      const source = String(text || '');
      if (source.slice(start, start + 2) === '\\(' && !isEscapedCharacter(source, start)) {
        let close = source.indexOf('\\)', start + 2);
        while (close >= 0 && isEscapedCharacter(source, close)) close = source.indexOf('\\)', close + 2);
        if (close < 0) return null;
        const value = source.slice(start + 2, close);
        if (!value || value.includes('\n') || /^\s|\s$/.test(value)) return null;
        return { value, end: close + 2 };
      }

      if (source[start] !== '$'
        || source[start + 1] === '$'
        || /\s/.test(source[start + 1] || '')
        || isEscapedCharacter(source, start)) return null;
      let close = start + 1;
      while (close < source.length) {
        close = source.indexOf('$', close);
        if (close < 0) return null;
        if (!isEscapedCharacter(source, close)
          && source[close - 1] !== '$'
          && source[close + 1] !== '$'
          && !/\s/.test(source[close - 1] || '')) {
          const value = source.slice(start + 1, close);
          if (value && !value.includes('\n')) return { value, end: close + 1 };
        }
        close += 1;
      }
      return null;
    }

    function isEscapedCharacter(text, index) {
      let slashes = 0;
      for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) slashes += 1;
      return slashes % 2 === 1;
    }

    function findPreviousOpenToken(tokens, closeIndex) {
      let depth = 0;
      for (let index = closeIndex - 1; index >= 0; index -= 1) {
        if (tokens[index].type.endsWith('_close')) depth += 1;
        if (tokens[index].type.endsWith('_open')) {
          if (depth === 0) return tokens[index];
          depth -= 1;
        }
      }
      return null;
    }

    function preprocessVendorMarkdown(markdown) {
      return normalizeNewlines(markdown).replace(/^\s*\[toc\]\s*$/gim, VENDOR_TOC_MARKER);
    }

    function highlightCodeWithVendor(code, lang) {
      if (!window.hljs) return escapeHtml(code);
      try {
        if (lang && window.hljs.getLanguage?.(lang)) {
          return window.hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
        }
        return window.hljs.highlightAuto(code).value;
      } catch (_) {
        return escapeHtml(code);
      }
    }

    function renderMermaidPlaceholder(code) {
      const id = nextMermaidId('diagram', code);
      return [
        `<figure class="mermaid-diagram" data-mermaid-zoom="${DEFAULT_MERMAID_ZOOM}">`,
        renderMermaidCaption('クリックでコード編集'),
        `<div class="mermaid-render-target" data-mermaid-render-id="${escapeAttribute(id)}" data-mermaid-source="${escapeAttribute(code)}">`,
        renderMermaidFallbackPre(code),
        '</div>',
        '</figure>',
      ].join('');
    }

    function renderMermaidCaption(hint) {
      const percent = formatMermaidZoomPercent(DEFAULT_MERMAID_ZOOM);
      return [
        '<figcaption>',
        '<span class="mermaid-caption-title">Mermaid</span>',
        '<span class="mermaid-caption-tools">',
        '<span class="mermaid-zoom-controls" aria-label="Mermaid図の拡大縮小">',
        '<button type="button" class="mermaid-zoom-button" data-action="mermaid-zoom" data-zoom="out" title="縮小" aria-label="Mermaid図を縮小">−</button>',
        `<span class="mermaid-zoom-label">${percent}</span>`,
        '<button type="button" class="mermaid-zoom-button" data-action="mermaid-zoom" data-zoom="in" title="拡大" aria-label="Mermaid図を拡大">＋</button>',
        '<button type="button" class="mermaid-zoom-reset" data-action="mermaid-zoom" data-zoom="reset" title="100%に戻す">100%</button>',
        '</span>',
        `<span class="mermaid-edit-hint">${escapeHtml(hint)}</span>`,
        '</span>',
        '</figcaption>',
      ].join('');
    }

    function renderMermaidFallbackPre(code) {
      return `<pre class="code-block language-mermaid"><code data-lang="mermaid">${escapeHtml(code)}</code></pre>`;
    }

    function splitMarkdownBlocks(markdown) {
      const text = normalizeNewlines(markdown);
      const lines = getLines(text);
      const blocks = [];
      let index = 0;

      while (index < lines.length) {
        while (index < lines.length && lines[index].text.trim() === '') index += 1;
        if (index >= lines.length) break;

        const startLine = lines[index];
        let endIndex = index;
        const first = startLine.text;
        const mathEndIndex = displayMathBlockEndIndex(lines, index);

        if (/^\s*```/.test(first)) {
          endIndex = index + 1;
          while (endIndex < lines.length && !/^\s*```\s*$/.test(lines[endIndex].text)) endIndex += 1;
          if (endIndex < lines.length) endIndex += 1;
        } else if (mathEndIndex > index) {
          endIndex = mathEndIndex;
        } else if (isHeadingLine(first) || isHorizontalRule(first) || isTocLine(first)) {
          endIndex = index + 1;
        } else if (isTableStart(lines, index)) {
          endIndex = index + 2;
          while (endIndex < lines.length && hasPipe(lines[endIndex].text) && lines[endIndex].text.trim() !== '') endIndex += 1;
        } else if (isListLine(first)) {
          endIndex = index + 1;
          while (endIndex < lines.length) {
            const line = lines[endIndex].text;
            if (line.trim() === '') break;
            if (isListLine(line) || /^\s{2,}\S/.test(line)) {
              endIndex += 1;
              continue;
            }
            break;
          }
        } else if (isQuoteLine(first)) {
          endIndex = index + 1;
          while (endIndex < lines.length && (isQuoteLine(lines[endIndex].text) || lines[endIndex].text.trim() === '')) {
            if (lines[endIndex].text.trim() === '') break;
            endIndex += 1;
          }
        } else {
          endIndex = index + 1;
          while (endIndex < lines.length && lines[endIndex].text.trim() !== '') {
            if (/^\s*```/.test(lines[endIndex].text) || displayMathDelimiter(lines[endIndex].text) || isHeadingLine(lines[endIndex].text) || isHorizontalRule(lines[endIndex].text) || isTocLine(lines[endIndex].text)) break;
            endIndex += 1;
          }
        }

        const end = endIndex > index ? lines[endIndex - 1].end : startLine.end;
        const raw = text.slice(startLine.start, end).replace(/\n$/, '');
        const sourceEnd = startLine.start + raw.length;
        blocks.push({
          raw,
          start: startLine.start,
          end: sourceEnd,
          type: classifyBlock(raw),
          trailingNewline: text[sourceEnd] === '\n',
        });
        index = Math.max(endIndex, index + 1);
      }
      return blocks;
    }

    function getLines(text) {
      const lines = [];
      let start = 0;
      while (start < text.length) {
        const newline = text.indexOf('\n', start);
        if (newline === -1) {
          lines.push({ text: text.slice(start), start, end: text.length });
          break;
        }
        lines.push({ text: text.slice(start, newline), start, end: newline + 1 });
        start = newline + 1;
      }
      return lines;
    }

    function classifyBlock(raw) {
      const first = raw.split('\n', 1)[0] || '';
      if (/^\s*```/.test(first)) return 'code';
      if (isDisplayMathBlock(raw)) return 'math';
      if (isHeadingLine(first)) return 'heading';
      if (isHorizontalRule(first)) return 'rule';
      if (isTocLine(first)) return 'toc';
      if (isTableStart(getLines(raw), 0)) return 'table';
      if (isListLine(first)) return 'list';
      if (isQuoteLine(first)) return 'quote';
      return 'paragraph';
    }

    function renderBlockHtml(block, headingIndex) {
      switch (block.type) {
        case 'heading':
          return renderHeading(block, headingIndex);
        case 'paragraph':
          if (block.trailingNewline && /[ \t]{2}$/.test(block.raw || '')) return renderParagraph(block.raw, block);
          break;
        case 'toc':
          return renderToc(headingIndex.items);
        case 'code':
          return renderCodeBlock(block.raw, block);
        case 'math':
          return renderMathBlock(block.raw);
        case 'list':
          return renderList(block.raw, block);
        case 'table':
          return renderTable(block.raw);
        case 'quote':
          return renderQuote(block.raw, block);
        default: {
          const vendorHtml = renderBlockWithVendor(block.raw, block);
          if (vendorHtml) return vendorHtml;
        }
      }

      switch (block.type) {
        case 'rule':
          return '<hr>';
        case 'quote':
          return renderQuote(block.raw, block);
        default:
          return renderParagraph(block.raw, block);
      }
    }

    function renderHeading(block, headingIndex) {
      const raw = block.raw;
      const match = raw.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/);
      if (!match) return renderParagraph(raw, block);
      const level = match[1].length;
      const text = stripInlineMarkdown(match[2]);
      const id = headingIndex.byOffset.get(block.start) || slugify(text);
      return `<h${level} id="${escapeAttribute(id)}">${renderInlineMarkdown(match[2])}</h${level}>`;
    }

    function renderBlockWithVendor(raw, block = null) {
      if (hasAmbiguousStrongDelimiterNeighborhood(raw) || hasBlockedMarkdownLink(raw)) return '';
      const md = getVendorMarkdownRenderer();
      if (!md) return '';
      return md.render(preprocessVendorMarkdown(raw), buildMarkdownItEnv(raw, block)).trimEnd();
    }

    function buildMarkdownItEnv(raw, block) {
      return {
        baseOffset: Number.isFinite(block?.start) ? block.start : 0,
        lineOffsets: getLineStartOffsets(raw),
      };
    }

    function getLineStartOffsets(raw) {
      const offsets = [0];
      const text = String(raw || '');
      for (let index = 0; index < text.length; index += 1) {
        if (text[index] === '\n' && index + 1 < text.length) offsets.push(index + 1);
      }
      return offsets;
    }

    function renderInlineMarkdown(raw) {
      const safeRaw = stripRichCaretTokens(raw);
      if (hasAmbiguousStrongDelimiterNeighborhood(safeRaw) || hasBlockedMarkdownLink(safeRaw)) return renderInline(safeRaw);
      const md = getVendorMarkdownRenderer();
      if (!md) return renderInline(safeRaw);
      return md.renderInline(String(safeRaw || ''));
    }

    function hasAmbiguousStrongDelimiterNeighborhood(raw) {
      const text = String(raw || '');
      return hasAmbiguousStrongDelimiter(text, '*') || hasAmbiguousStrongDelimiter(text, '_');
    }

    function hasAmbiguousStrongDelimiter(text, delimiter) {
      const pair = delimiter + delimiter;
      let index = 0;
      while (index < text.length - 1) {
        const open = text.indexOf(pair, index);
        if (open === -1) return false;
        const closePair = text.indexOf(pair, open + 2);
        if (closePair !== -1 && !text.slice(open + 2, closePair).includes('\n')) {
          index = closePair + 2;
          continue;
        }
        const singleClose = text.indexOf(delimiter, open + 2);
        if (singleClose !== -1 && !text.slice(open + 2, singleClose).includes('\n')) return true;
        index = open + 2;
      }
      return false;
    }

    function renderCodeBlock(raw, block = null) {
      const lines = raw.split('\n');
      const first = lines.shift() || '';
      if (lines.length && /^\s*```\s*$/.test(lines[lines.length - 1])) lines.pop();
      const lang = safeCodeLanguage(first.replace(/^\s*```/, ''));
      const codeText = lines.join('\n');
      const normalizedLang = normalizeCodeLanguage(lang);
      if (normalizedLang === 'mermaid') {
        return window.mermaid?.render ? renderMermaidPlaceholder(codeText) : renderMermaidBlock(codeText);
      }
      const code = window.hljs ? highlightCodeWithVendor(codeText, normalizedLang) : highlightCode(codeText, normalizedLang);
      const langAttr = lang ? ` data-lang="${escapeAttribute(lang)}"` : '';
      const langClass = normalizedLang ? ` language-${escapeAttribute(normalizedLang)}` : '';
      const offsetAttrs = Number.isFinite(block?.start)
        ? ` data-code-start="${escapeAttribute(block.start)}" data-code-end="${escapeAttribute(block.end)}"`
        : '';
      const languageControl = [
        '<input class="code-language-input"',
        ' type="text"',
        ' list="codeLanguageOptions"',
        ' spellcheck="false"',
        ' autocomplete="off"',
        ' autocapitalize="off"',
        ' aria-label="コードブロックの言語"',
        ' placeholder="text"',
        ` value="${escapeAttribute(lang)}"`,
        offsetAttrs,
        '>',
      ].join('');
      const codeClass = window.hljs ? ' class="hljs"' : '';
      return `<pre class="code-block${langClass}">${languageControl}<code${codeClass}${langAttr}>${code}</code></pre>`;
    }

    function renderMathBlock(raw) {
      const source = displayMathSource(raw);
      const body = source
        ? renderKaTeX(source, true)
        : '<span class="math-placeholder">$$$$</span>';
      return [
        '<div class="math-display"',
        ` data-math-source="${escapeAttribute(source)}"`,
        ' data-math-display="true"',
        '>',
        body,
        '</div>',
      ].join('');
    }

    function renderParagraph(raw, block = null) {
      const lines = raw.split('\n');
      const rendered = lines.map((line, index) => {
        const trailingHardBreak = index === lines.length - 1
          && block?.trailingNewline
          && /[ \t]{2}$/.test(line);
        const anchorOffset = Number.isFinite(block?.end) ? block.end + 1 : '';
        const anchor = `<br><span class="rich-line-break-caret-anchor" data-source-offset="${escapeAttribute(anchorOffset)}">\u200b</span>`;
        return `${renderInline(line)}${trailingHardBreak ? anchor : ''}`;
      });
      return `<p>${rendered.join('<br>')}</p>`;
    }

    function renderQuote(raw, block = null) {
      const lines = raw.split('\n');
      const trailingEmptyQuoteLine = lines.length > 1 && /^\s*>\s?$/.test(lines[lines.length - 1] || '');
      const previousQuoteContent = trailingEmptyQuoteLine
        ? String(lines[lines.length - 2] || '').replace(/^\s*>\s?/, '')
        : '';
      const trailingHardBreak = trailingEmptyQuoteLine && /[ \t]{2}$/.test(previousQuoteContent);
      const anchorOffset = Number.isFinite(block?.end) ? block.end : '';
      const anchor = `<span class="rich-line-break-caret-anchor" data-source-offset="${escapeAttribute(anchorOffset)}">\u200b</span>`;
      const body = lines
        .map((line) => line.replace(/^\s*>\s?/, ''))
        .map((line) => renderInline(line))
        .join('<br>');
      if (trailingHardBreak) {
        return `<blockquote data-rich-quote-hard-break-source="${escapeAttribute(raw)}">${body}${anchor}</blockquote>`;
      }
      return `<blockquote>${body}</blockquote>`;
    }

    function renderList(raw, block = null) {
      const lines = getLines(raw).filter((line) => line.text.trim() !== '');
      const ordered = /^\s*\d+\.(?:\s+|$)/.test(lines[0]?.text || '');
      const tag = ordered ? 'ol' : 'ul';
      let hasTasks = false;
      const itemsData = [];

      for (const line of lines) {
        const textLine = line.text.replace(/\n$/, '');
        const markerLine = textLine.match(/^\s*(?:[-+*]|\d+\.)(?:\s+(.*)|$)$/);
        if (!markerLine && itemsData.length) {
          itemsData[itemsData.length - 1].lines.push(textLine.replace(/^\s{2,}/, ''));
          continue;
        }

        const taskLine = textLine.match(/^(\s*(?:[-+*]|\d+\.)\s+)\[( |x|X)\](?:\s+(.*)|\s*)$/);
        const item = {
          lines: [markerLine ? (markerLine[1] || '') : textLine],
          checkbox: '',
          className: '',
        };
        if (taskLine) {
          hasTasks = true;
          item.className = ' class="task-list-item"';
          const checked = taskLine[2].toLowerCase() === 'x' ? ' checked' : '';
          const taskOffset = Number.isFinite(block?.start) ? block.start + line.start + taskLine[1].length + 1 : '';
          const offsetAttr = taskOffset === '' ? '' : ` data-task-pos="${escapeAttribute(taskOffset)}"`;
          item.checkbox = `<input class="task-checkbox" type="checkbox"${offsetAttr}${checked}>`;
          item.lines[0] = taskLine[3] || '';
        }
        itemsData.push(item);
      }

      const items = itemsData.map((item) => {
        const body = renderListItemBody(item.lines);
        return `<li${item.className}>${item.checkbox}${body}</li>`;
      }).join('');
      const classAttr = hasTasks ? ' class="task-list"' : '';
      return `<${tag}${classAttr}>${items}</${tag}>`;
    }

    function renderListItemBody(lines) {
      const body = lines.map((line) => renderInlineMarkdown(line)).join('<br>');
      return body || '<span class="rich-list-caret-anchor">\u200b</span><br>';
    }

    function renderTable(raw) {
      const lines = raw.split('\n').filter((line) => line.trim() !== '');
      if (lines.length < 2) return renderParagraph(raw);
      const headers = splitTableRow(lines[0]);
      const aligns = splitTableRow(lines[1]).map(parseAlign);
      const rows = lines.slice(2).map(splitTableRow);
      const head = headers.map((cell, i) => `<th${alignAttr(aligns[i])}>${renderTableCell(cell)}</th>`).join('');
      const body = rows.map((row) => `<tr>${headers.map((_, i) => `<td${alignAttr(aligns[i])}>${renderTableCell(row[i] || '')}</td>`).join('')}</tr>`).join('');
      return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
    }

    function renderTableCell(raw) {
      return String(raw || '')
        .split(/<br\s*\/?>/i)
        .map((part) => renderInline(part))
        .join('<br>');
    }

    function renderToc(headings) {
      if (!headings.length) return '<div class="toc"><strong>目次</strong><p>見出しはありません。</p></div>';
      return `<nav class="toc" aria-label="目次"><strong>目次</strong>${renderTocTree(buildHeadingTree(headings), true)}</nav>`;
    }

    function renderInline(raw) {
      const placeholders = [];
      const hold = (html) => {
        const token = `§§PME${placeholders.length}§§`;
        placeholders.push({ token, html });
        return token;
      };

      let text = raw.replace(/`([^`]+)`/g, (_match, code) => hold(`<code>${escapeHtml(code)}</code>`));

      text = text.replace(/!\[([^\]\n]*)\]\((<[^>\n]+>|(?:[^()\s\n]+|\([^()\n]*\))+)\)/g, (_match, alt, target) => {
        const url = parseMarkdownTarget(target);
        const safe = sanitizeImageUrl(url);
        if (!safe) return hold(renderBlockedImage(url, alt || 'no alt'));
        return hold(`<img alt="${escapeAttribute(alt)}" src="${escapeAttribute(safe)}" data-markdown-src="${escapeAttribute(url)}">`);
      });

      text = text.replace(/\\\[([^\]\n]+)\\\]\((<[^>\n]+>|(?:[^()\s\n]+|\([^()\n]*\))+)\)/g, (match, label, target) => {
        const url = parseMarkdownTarget(target);
        if (sanitizeLinkUrl(url)) return match;
        return hold(`<span class="blocked-link">リンクブロック: ${escapeHtml(label)}</span>`);
      });

      text = text.replace(/\[([^\]\n]+)\]\((<[^>\n]+>|(?:[^()\s\n]+|\([^()\n]*\))+)\)/g, (match, label, target, offset, source) => {
        if (source[offset - 1] === '\\') return match;
        const url = parseMarkdownTarget(target);
        const safe = sanitizeLinkUrl(url);
        if (!safe) return hold(`<span class="blocked-link">リンクブロック: ${escapeHtml(label)}</span>`);
        return hold(`<a href="${escapeAttribute(safe)}" data-markdown-href="${escapeAttribute(url)}" rel="noopener noreferrer" target="_blank">${escapeHtml(label)}</a>`);
      });

      text = splitMathSegments(text)
        .map((part) => part.type === 'math' ? hold(renderInlineMathHtml(part.value)) : part.value)
        .join('');

      text = escapeHtml(text);
      text = text.replace(/~~(.+?)~~/g, '<del>$1</del>');
      text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      text = text.replace(/__(.+?)__/g, '<strong>$1</strong>');
      text = text.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
      text = text.replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>');

      for (const { token, html } of placeholders) {
        text = text.replaceAll(escapeHtml(token), html).replaceAll(token, html);
      }
      return text;
    }

    function hasBlockedMarkdownLink(raw) {
      const text = String(raw || '');
      const patterns = [
        /\\\[([^\]\n]+)\\\]\((<[^>\n]+>|(?:[^()\s\n]+|\([^()\n]*\))+)\)/g,
        /\[([^\]\n]+)\]\((<[^>\n]+>|(?:[^()\s\n]+|\([^()\n]*\))+)\)/g,
      ];
      for (let patternIndex = 0; patternIndex < patterns.length; patternIndex += 1) {
        const pattern = patterns[patternIndex];
        let match = pattern.exec(text);
        while (match) {
          const escaped = patternIndex === 0;
          const previous = text[match.index - 1] || '';
          if (previous !== '!' && (escaped || previous !== '\\') && !sanitizeLinkUrl(parseMarkdownTarget(match[2]))) return true;
          match = pattern.exec(text);
        }
      }
      return false;
    }

    function buildHeadingIndex(blocks) {
      const seen = new Map();
      const items = [];
      const byOffset = new Map();
      for (const block of blocks) {
        if (block.type !== 'heading') continue;
        const match = block.raw.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/);
        if (!match) continue;
        const level = match[1].length;
        const text = stripInlineMarkdown(match[2]);
        const base = slugify(text) || 'heading';
        const count = seen.get(base) || 0;
        seen.set(base, count + 1);
        const id = count ? `${base}-${count + 1}` : base;
        items.push({ id, text, level, start: block.start, index: items.length });
        byOffset.set(block.start, id);
      }
      return { items, byOffset };
    }

    function buildHeadingTree(headings) {
      const root = [];
      const stack = [{ level: 0, children: root }];
      for (const heading of headings) {
        const node = { ...heading, children: [] };
        while (stack.length > 1 && stack[stack.length - 1].level >= heading.level) stack.pop();
        stack[stack.length - 1].children.push(node);
        stack.push(node);
      }
      return root;
    }

    function renderTocTree(nodes, expanded) {
      if (!nodes.length) return '';
      const items = nodes.map((node) => {
        const link = `<a class="level-${node.level}" href="#${escapeAttribute(node.id)}">${escapeHtml(node.text)}</a>`;
        if (!node.children.length) return `<li>${link}</li>`;
        return `<li><details${expanded ? ' open' : ''}><summary>${link}</summary>${renderTocTree(node.children, false)}</details></li>`;
      }).join('');
      return `<ol class="toc-tree">${items}</ol>`;
    }

    function buildOutlineTreeElement(nodes, expanded) {
      const list = document.createElement('ol');
      list.className = 'outline-tree';
      for (const node of nodes) {
        const item = document.createElement('li');
        const link = document.createElement('a');
        link.href = `#${node.id}`;
        link.className = `level-${node.level}`;
        link.textContent = node.text;
        link.addEventListener('click', (event) => {
          event.preventDefault();
          navigateToOutlineHeading(node);
        });
        if (node.children.length) {
          const details = document.createElement('details');
          if (expanded) details.open = true;
          const summary = document.createElement('summary');
          summary.appendChild(link);
          details.appendChild(summary);
          details.appendChild(buildOutlineTreeElement(node.children, false));
          item.appendChild(details);
        } else {
          item.appendChild(link);
        }
        list.appendChild(item);
      }
      return list;
    }

    function navigateToOutlineHeading(node) {
      if (
        state.mode === 'rich'
        && isProseMirrorRichActive()
        && typeof state.proseMirrorRich?.revealHeadingByIndex === 'function'
        && state.proseMirrorRich.revealHeadingByIndex(node.index)
      ) {
        setStatus('アウトラインの見出しへ移動しました');
        return;
      }
      const target = document.getElementById(node.id);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setStatus('アウトラインの見出しへ移動しました');
      }
    }

    function normalizeCodeLanguage(lang) {
      const value = String(lang || '').trim().toLowerCase().replace(/^language-/, '');
      const aliases = {
        cjs: 'js',
        javascript: 'js',
        jsx: 'js',
        mjs: 'js',
        node: 'js',
        py: 'python',
        python3: 'python',
        ts: 'ts',
        tsx: 'ts',
        typescript: 'ts',
        htm: 'html',
        xhtml: 'html',
        xml: 'html',
        yml: 'yaml',
        'c++': 'cpp',
        cs: 'csharp',
        golang: 'go',
        rs: 'rust',
        kt: 'kotlin',
        sh: 'bash',
        shell: 'bash',
        zsh: 'bash',
        ps: 'powershell',
        ps1: 'powershell',
        pwsh: 'powershell',
        mermaidjs: 'mermaid',
        mmd: 'mermaid',
      };
      return aliases[value] || value;
    }

    function highlightCode(code, lang) {
      const text = String(code || '');
      if (!lang || text.length > MAX_HIGHLIGHT_CHARS) return escapeHtml(text);
      if (lang === 'html') return highlightWithRules(text, htmlHighlightRules());
      if (lang === 'css') return highlightWithRules(text, cssHighlightRules());
      if (lang === 'json') return highlightWithRules(text, jsonHighlightRules());
      if (lang === 'python') return highlightWithRules(text, pythonHighlightRules());
      if (lang === 'bash') return highlightWithRules(text, bashHighlightRules());
      if (lang === 'powershell') return highlightWithRules(text, powershellHighlightRules());
      if (lang === 'sql') return highlightWithRules(text, sqlHighlightRules());
      if (lang === 'yaml') return highlightWithRules(text, yamlHighlightRules());
      if (['js', 'ts', 'java', 'c', 'cpp', 'csharp', 'go', 'rust', 'php', 'swift', 'kotlin'].includes(lang)) {
        return highlightWithRules(text, cLikeHighlightRules(lang));
      }
      return escapeHtml(text);
    }

    function highlightWithRules(code, rules) {
      let html = '';
      let offset = 0;
      while (offset < code.length) {
        let matched = false;
        for (const rule of rules) {
          rule.pattern.lastIndex = offset;
          const match = rule.pattern.exec(code);
          if (!match || match.index !== offset || !match[0]) continue;
          html += `<span class="tok-${rule.token}">${escapeHtml(match[0])}</span>`;
          offset += match[0].length;
          matched = true;
          break;
        }
        if (!matched) {
          html += escapeHtml(code[offset]);
          offset += 1;
        }
      }
      return html;
    }

    function cLikeHighlightRules(lang) {
      const keywordSets = {
        js: 'as async await break case catch class const continue debugger default delete do else export extends finally for from function get if import in instanceof let new of return set static super switch this throw try typeof var void while with yield',
        ts: 'abstract any as async await boolean break case catch class const constructor continue debugger declare default delete do else enum export extends false finally for from function get if implements import in infer instanceof interface keyof let module namespace never new null number object of private protected public readonly return set static string super switch symbol this throw true try type typeof undefined unknown var void while with yield',
        java: 'abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while',
        c: 'auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while',
        cpp: 'alignas alignof auto bool break case catch char class const constexpr continue default delete do double else enum explicit export extern false final float for friend goto if inline int long namespace new noexcept nullptr operator override private protected public register reinterpret_cast return short signed sizeof static struct switch template this throw true try typedef typename union unsigned using virtual void volatile while',
        csharp: 'abstract as base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new null object operator out override params private protected public readonly ref return sbyte sealed short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using virtual void volatile while',
        go: 'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var',
        rust: 'as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while',
        php: 'abstract and array as break callable case catch class clone const continue declare default die do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile exit extends final finally fn for foreach function global goto if implements include include_once instanceof insteadof interface isset list namespace new or print private protected public require require_once return static switch throw trait try unset use var while xor yield',
        swift: 'as associatedtype break case catch class continue default defer deinit do else enum extension fallthrough false fileprivate for func guard if import in init inout internal is let nil open operator private protocol public repeat rethrows return self static struct subscript super switch throw throws true try typealias var where while',
        kotlin: 'as break class continue do else false for fun if in interface is null object package return super this throw true try typealias val var when while',
      };
      return [
        { token: 'comment', pattern: /\/\*[\s\S]*?\*\/|\/\/[^\n]*/y },
        { token: 'string', pattern: /`(?:\\[\s\S]|[^`\\])*`|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'/y },
        { token: 'number', pattern: /\b(?:0x[\da-fA-F]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)\b/y },
        { token: 'keyword', pattern: keywordRegex(keywordSets[lang] || keywordSets.js) },
        { token: 'function', pattern: /\b[A-Za-z_$][\w$]*(?=\s*\()/y },
        { token: 'operator', pattern: /[{}\[\]().,;:+\-*/%=&|!<>?~^]+/y },
      ];
    }

    function pythonHighlightRules() {
      return [
        { token: 'comment', pattern: /#[^\n]*/y },
        { token: 'string', pattern: /(?:[rRubBfF]{0,2})("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*')/y },
        { token: 'number', pattern: /\b(?:0x[\da-fA-F]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)\b/y },
        { token: 'keyword', pattern: keywordRegex('and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield') },
        { token: 'function', pattern: /\b[A-Za-z_]\w*(?=\s*\()/y },
        { token: 'operator', pattern: /[{}\[\]().,;:+\-*/%=&|!<>?~^]+/y },
      ];
    }

    function htmlHighlightRules() {
      return [
        { token: 'comment', pattern: /<!--[\s\S]*?-->/y },
        { token: 'keyword', pattern: /<!doctype[^>]*>/iy },
        { token: 'tag', pattern: /<\/?[A-Za-z][^<>\n]*\/?>/y },
        { token: 'string', pattern: /"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'/y },
      ];
    }

    function cssHighlightRules() {
      return [
        { token: 'comment', pattern: /\/\*[\s\S]*?\*\//y },
        { token: 'string', pattern: /"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'/y },
        { token: 'number', pattern: /#[\da-fA-F]{3,8}\b|\b\d+(?:\.\d+)?(?:px|rem|em|vh|vw|%|s|ms|deg)?\b/y },
        { token: 'keyword', pattern: /@[A-Za-z-]+|--?[A-Za-z][\w-]*(?=\s*:)/y },
        { token: 'operator', pattern: /[{}\[\]().,;:+\-*/%=&|!<>?~^#]+/y },
      ];
    }

    function jsonHighlightRules() {
      return [
        { token: 'property', pattern: /"(?:\\[\s\S]|[^"\\])*"(?=\s*:)/y },
        { token: 'string', pattern: /"(?:\\[\s\S]|[^"\\])*"/y },
        { token: 'number', pattern: /-?\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b/iy },
        { token: 'keyword', pattern: /\b(?:true|false|null)\b/y },
        { token: 'operator', pattern: /[{}\[\]:,]/y },
      ];
    }

    function bashHighlightRules() {
      return [
        { token: 'comment', pattern: /#[^\n]*/y },
        { token: 'string', pattern: /"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'/y },
        { token: 'property', pattern: /\$[{(]?[A-Za-z_][\w]*[})]?|\$\d+/y },
        { token: 'keyword', pattern: keywordRegex('case do done elif else esac fi for function if in select then until while') },
        { token: 'function', pattern: /\b[A-Za-z_][\w.-]*(?=\s)/y },
        { token: 'operator', pattern: /[|&;(){}\[\]<>!=]+/y },
      ];
    }

    function powershellHighlightRules() {
      return [
        { token: 'comment', pattern: /<#[\s\S]*?#>|#[^\n]*/y },
        { token: 'string', pattern: /@"[\s\S]*?"@|@'[\s\S]*?'@|"(?:`[\s\S]|[^"`])*"|'(?:''|[^'])*'/y },
        { token: 'property', pattern: /\$[A-Za-z_][\w:]*|\$\{[^}]+\}/y },
        { token: 'keyword', pattern: keywordRegex('begin break catch class continue data define do dynamicparam else elseif end exit filter finally for foreach from function if in param process return switch throw trap try until using var while') },
        { token: 'function', pattern: /\b[A-Za-z]+-[A-Za-z]+\b/y },
        { token: 'operator', pattern: /-[A-Za-z]+|[|&;(){}\[\]<>!=]+/y },
      ];
    }

    function sqlHighlightRules() {
      return [
        { token: 'comment', pattern: /\/\*[\s\S]*?\*\/|--[^\n]*/y },
        { token: 'string', pattern: /'(?:''|[^'])*'|"(?:\\[\s\S]|[^"\\])*"/y },
        { token: 'number', pattern: /\b\d+(?:\.\d+)?\b/y },
        { token: 'keyword', pattern: keywordRegex('add all alter and as asc between by case create delete desc distinct drop else exists from group having in inner insert into is join left like limit not null on or order outer primary references right select set table then union update values when where') },
        { token: 'function', pattern: /\b[A-Za-z_]\w*(?=\s*\()/y },
        { token: 'operator', pattern: /[(),.;*+=<>!-]+/y },
      ];
    }

    function yamlHighlightRules() {
      return [
        { token: 'comment', pattern: /#[^\n]*/y },
        { token: 'property', pattern: /[A-Za-z0-9_.-]+(?=\s*:)/y },
        { token: 'string', pattern: /"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'/y },
        { token: 'number', pattern: /\b\d+(?:\.\d+)?\b/y },
        { token: 'keyword', pattern: /\b(?:true|false|null|yes|no|on|off)\b/y },
        { token: 'operator', pattern: /[:\[\]{},&*|>!\-]+/y },
      ];
    }

    function keywordRegex(words) {
      return new RegExp(`\\b(?:${words.trim().split(/\s+/).join('|')})\\b`, 'y');
    }

    function renderMermaidBlock(code) {
      const text = normalizeNewlines(code).trim();
      const first = text.split('\n').find((line) => {
        const trimmed = line.trim();
        return trimmed && !trimmed.startsWith('%%');
      }) || '';
      try {
        if (/^(?:graph|flowchart)\b/i.test(first)) return renderMermaidFlowchart(text);
        if (/^sequenceDiagram\b/i.test(first)) return renderMermaidSequence(text);
        return renderMermaidFallback(text, '未対応のMermaid構文');
      } catch (_) {
        return renderMermaidFallback(text, '描画できない構文をコードとして表示');
      }
    }

    function renderMermaidFallback(code, message) {
      return [
        `<figure class="mermaid-diagram mermaid-fallback" data-mermaid-source="${escapeAttribute(code)}">`,
        `<figcaption>Mermaid <span>${escapeHtml(message)}</span></figcaption>`,
        `<pre class="code-block language-mermaid"><code data-lang="mermaid">${escapeHtml(code)}</code></pre>`,
        '</figure>',
      ].join('');
    }

    function renderMermaidFlowchart(code) {
      const parsed = parseMermaidFlowchart(code);
      if (!parsed.nodes.size) return renderMermaidFallback(code, '表示できるノードがありません');

      const layout = layoutFlowchart(parsed);
      if (!Number.isFinite(layout.width) || !Number.isFinite(layout.height)) {
        return renderMermaidFallback(code, '描画できない構文をコードとして表示');
      }
      const markerId = nextMermaidId('arrow', code);
      const nodes = Array.from(parsed.nodes.values()).map((node) => renderFlowNode(node, layout.positions.get(node.id))).join('');
      const edges = parsed.edges.map((edge) => renderFlowEdge(edge, layout.positions, parsed.direction, markerId)).join('');

      return [
        `<figure class="mermaid-diagram mermaid-flowchart" data-mermaid-source="${escapeAttribute(code)}">`,
        '<figcaption>Mermaid flowchart</figcaption>',
        `<svg class="mermaid-svg" role="img" aria-label="Mermaid flowchart" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}" preserveAspectRatio="xMidYMid meet">`,
        `<defs><marker id="${markerId}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"></path></marker></defs>`,
        edges,
        nodes,
        '</svg>',
        '</figure>',
      ].join('');
    }

    function parseMermaidFlowchart(code) {
      const lines = normalizeNewlines(code).split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('%%'));
      const header = lines.shift() || '';
      const direction = (header.match(/\b(TD|TB|BT|LR|RL)\b/i) || ['TD', 'TD'])[1].toUpperCase();
      const nodes = new Map();
      const edges = [];

      for (const rawLine of lines) {
        const line = rawLine.replace(/;$/, '').trim();
        if (!line || /^(?:subgraph|end|classDef|class|style|linkStyle)\b/i.test(line)) continue;
        const edge = parseMermaidEdgeLine(line);
        if (edge && edge.from && edge.to) {
          addFlowNode(nodes, edge.from);
          addFlowNode(nodes, edge.to);
          edges.push({ from: edge.from.id, to: edge.to.id, label: edge.label });
          continue;
        }
        const node = parseMermaidNodeToken(line);
        if (node) addFlowNode(nodes, node);
      }

      return { direction, nodes, edges };
    }

    function parseMermaidEdgeLine(line) {
      let match = line.match(/^(.+?)\s*--\s*([^->]+?)\s*-->\s*(.+)$/);
      if (match) {
        const from = parseMermaidNodeToken(match[1]);
        const to = parseMermaidNodeToken(match[3]);
        if (!from || !to) return null;
        return { from, to, label: match[2].trim() };
      }
      match = line.match(/^(.+?)\s*(-->|---|==>|-.->)(?:\|([^|]+)\|)?\s*(.+)$/);
      if (!match) return null;
      const from = parseMermaidNodeToken(match[1]);
      const to = parseMermaidNodeToken(match[4]);
      if (!from || !to) return null;
      return { from, to, label: (match[3] || '').trim() };
    }

    function parseMermaidNodeToken(value) {
      const token = String(value || '').trim().replace(/:::[A-Za-z][\w-]*$/, '').trim();
      const match = token.match(/^([A-Za-z][\w-]*)(?:(\[\[([^\]]+)\]\])|(\[([^\]]+)\])|(\(\(([^\)]+)\)\))|(\(([^\)]+)\))|(\{([^}]+)\})|(>([^\]]+)\]))?$/);
      if (!match) return null;
      const label = cleanMermaidLabel(match[3] || match[5] || match[7] || match[9] || match[11] || match[13] || match[1]);
      let shape = 'rect';
      if (match[6]) shape = 'circle';
      if (match[8]) shape = 'stadium';
      if (match[10]) shape = 'diamond';
      if (match[12]) shape = 'asymmetric';
      return { id: match[1], label, shape };
    }

    function addFlowNode(nodes, node) {
      if (!node || !node.id) return;
      const existing = nodes.get(node.id);
      if (existing && existing.label !== existing.id) return;
      nodes.set(node.id, node);
    }

    function layoutFlowchart(parsed) {
      const ids = Array.from(parsed.nodes.keys());
      const levels = flowchartLevels(parsed, ids);

      const grouped = new Map();
      for (const id of ids) {
        const rawLevel = levels.get(id);
        const level = Number.isFinite(rawLevel) && rawLevel >= 0 ? Math.floor(rawLevel) : 0;
        if (!grouped.has(level)) grouped.set(level, []);
        grouped.get(level).push(id);
      }
      const groups = Array.from(grouped.keys())
        .sort((a, b) => a - b)
        .map((level) => grouped.get(level).filter((id) => parsed.nodes.has(id)))
        .filter((group) => group.length);

      const horizontal = ['LR', 'RL'].includes(parsed.direction);
      const nodeWidth = 300;
      const nodeHeight = 96;
      const levelGap = 126;
      const itemGap = 86;
      const pad = 42;
      const maxItems = groups.reduce((max, group) => Math.max(max, group.length), 1);
      const levelCount = Math.max(1, groups.length);
      const minWidth = horizontal ? 0 : 760;
      const minHeight = horizontal ? 420 : 0;
      const width = Math.max(
        minWidth,
        horizontal ? pad * 2 + levelCount * nodeWidth + (levelCount - 1) * levelGap : pad * 2 + maxItems * nodeWidth + (maxItems - 1) * itemGap,
      );
      const height = Math.max(
        minHeight,
        horizontal ? pad * 2 + maxItems * nodeHeight + (maxItems - 1) * itemGap : pad * 2 + levelCount * nodeHeight + (levelCount - 1) * levelGap,
      );
      const positions = new Map();

      groups.forEach((group, level) => {
        const groupSpan = group.length * (horizontal ? nodeHeight : nodeWidth) + (group.length - 1) * itemGap;
        const crossStart = ((horizontal ? height : width) - groupSpan) / 2;
        group.forEach((id, index) => {
          const main = pad + level * ((horizontal ? nodeWidth : nodeHeight) + levelGap);
          const cross = crossStart + index * ((horizontal ? nodeHeight : nodeWidth) + itemGap);
          positions.set(id, horizontal
            ? { x: main, y: cross, width: nodeWidth, height: nodeHeight }
            : { x: cross, y: main, width: nodeWidth, height: nodeHeight });
        });
      });

      return { width, height, positions };
    }

    function flowchartLevels(parsed, ids) {
      const idSet = new Set(ids);
      const incoming = new Map(ids.map((id) => [id, 0]));
      const outgoing = new Map(ids.map((id) => [id, []]));
      for (const edge of parsed.edges) {
        if (!idSet.has(edge.from) || !idSet.has(edge.to)) continue;
        incoming.set(edge.to, (incoming.get(edge.to) || 0) + 1);
        outgoing.get(edge.from)?.push(edge.to);
      }

      const roots = ids.filter((id) => (incoming.get(id) || 0) === 0);
      const queue = roots.length ? roots.slice() : ids.slice(0, 1);
      const levels = new Map(queue.map((id) => [id, 0]));

      for (let index = 0; index < queue.length; index += 1) {
        const current = queue[index];
        const nextLevel = (levels.get(current) || 0) + 1;
        for (const target of outgoing.get(current) || []) {
          if (levels.has(target)) continue;
          levels.set(target, nextLevel);
          queue.push(target);
        }
      }

      let lastLevel = Math.max(0, ...Array.from(levels.values()));
      for (const id of ids) {
        if (!levels.has(id)) levels.set(id, ++lastLevel);
      }
      return levels;
    }

    function renderFlowNode(node, box) {
      if (!box) return '';
      if (![box.x, box.y, box.width, box.height].every(Number.isFinite)) return '';
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      const text = renderSvgText(node.label, cx, cy, 18, 'mermaid-flow-node-label', 24);
      if (node.shape === 'diamond') {
        const points = `${cx},${box.y} ${box.x + box.width},${cy} ${cx},${box.y + box.height} ${box.x},${cy}`;
        return `<g class="mermaid-node mermaid-node-diamond"><polygon points="${points}"></polygon>${text}</g>`;
      }
      if (node.shape === 'circle') {
        return `<g class="mermaid-node mermaid-node-circle"><ellipse cx="${cx}" cy="${cy}" rx="${box.width / 2}" ry="${box.height / 2}"></ellipse>${text}</g>`;
      }
      const rx = node.shape === 'stadium' ? box.height / 2 : 10;
      return `<g class="mermaid-node mermaid-node-${escapeAttribute(node.shape)}"><rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="${rx}"></rect>${text}</g>`;
    }

    function renderFlowEdge(edge, positions, direction, markerId) {
      const from = positions.get(edge.from);
      const to = positions.get(edge.to);
      if (!from || !to) return '';
      if (![from.x, from.y, from.width, from.height, to.x, to.y, to.width, to.height].every(Number.isFinite)) return '';
      const horizontal = ['LR', 'RL'].includes(direction);
      const fromCx = from.x + from.width / 2;
      const fromCy = from.y + from.height / 2;
      const toCx = to.x + to.width / 2;
      const toCy = to.y + to.height / 2;
      let x1 = horizontal ? from.x + from.width : fromCx;
      let y1 = horizontal ? fromCy : from.y + from.height;
      let x2 = horizontal ? to.x : toCx;
      let y2 = horizontal ? toCy : to.y;
      let path;
      if (horizontal && toCx < fromCx) {
        x1 = from.x;
        x2 = to.x + to.width;
        const offset = Math.max(54, Math.abs(fromCy - toCy) / 2 + 34);
        path = `M ${x1} ${y1} C ${x1 - offset} ${y1}, ${x2 - offset} ${y2}, ${x2} ${y2}`;
      } else if (!horizontal && toCy < fromCy) {
        x1 = from.x;
        y1 = fromCy;
        x2 = to.x;
        y2 = toCy;
        const gutter = Math.max(18, Math.min(from.x, to.x) - 54);
        path = `M ${x1} ${y1} C ${gutter} ${y1}, ${gutter} ${y2}, ${x2} ${y2}`;
      } else {
        path = `M ${x1} ${y1} L ${x2} ${y2}`;
      }
      let labelX = (x1 + x2) / 2;
      let labelY = (y1 + y2) / 2 - 8;
      let labelAnchor = 'middle';
      if (horizontal && toCx < fromCx) {
        labelX = Math.min(x1, x2) - 38;
        labelY = (y1 + y2) / 2;
      } else if (!horizontal && toCy < fromCy) {
        const preferredX = Math.min(x1, x2) - 26;
        labelX = preferredX < 80 ? Math.min(x1, x2) + 18 : preferredX;
        labelY = (y1 + y2) / 2;
        labelAnchor = preferredX < 80 ? 'start' : 'end';
      } else if (horizontal) {
        labelY = Math.abs(y2 - y1) > 8 ? (y1 + y2) / 2 - 8 : y1 - 18;
      } else if (Math.abs(x2 - x1) > 8) {
        labelX = (x1 + x2) / 2 + (x2 > x1 ? 22 : -22);
        labelY = (y1 + y2) / 2 - 6;
      } else {
        labelX = x1 + 18;
        labelY = (y1 + y2) / 2;
        labelAnchor = 'start';
      }
      const label = edge.label ? renderEdgeLabel(edge.label, labelX, labelY, labelAnchor) : '';
      return `<g class="mermaid-edge"><path d="${path}" marker-end="url(#${markerId})"></path>${label}</g>`;
    }

    function renderEdgeLabel(label, x, y, anchor = 'middle') {
      if (![x, y].every(Number.isFinite)) return '';
      const text = String(label || '').trim();
      if (!text) return '';
      return `<text class="mermaid-edge-label" x="${x}" y="${y + 8}" text-anchor="${escapeAttribute(anchor)}" font-size="18" font-weight="650">${escapeHtml(text)}</text>`;
    }

    function renderMermaidSequence(code) {
      const parsed = parseMermaidSequence(code);
      if (!parsed.participants.length || !parsed.events.length) return renderMermaidFallback(code, '表示できるシーケンスがありません');
      const pad = 38;
      const participantGap = 260;
      const headerHeight = 86;
      const rowGap = 70;
      const width = Math.max(760, pad * 2 + (parsed.participants.length - 1) * participantGap + 180);
      const height = pad * 2 + headerHeight + parsed.events.length * rowGap + 20;
      const participantSpan = (parsed.participants.length - 1) * participantGap;
      const firstParticipantX = width / 2 - participantSpan / 2;
      const xFor = new Map(parsed.participants.map((participant, index) => [participant.id, firstParticipantX + index * participantGap]));
      const markerId = nextMermaidId('seq-arrow', code);

      const lifelines = parsed.participants.map((participant) => {
        const x = xFor.get(participant.id);
        return [
          `<g class="mermaid-seq-participant"><rect x="${x - 68}" y="${pad}" width="136" height="36" rx="8"></rect>`,
          renderSvgText(participant.label, x, pad + 18, 16, 'mermaid-node-label', 16),
          `<path class="mermaid-lifeline" d="M ${x} ${pad + 36} L ${x} ${height - pad}"></path></g>`,
        ].join('');
      }).join('');

      const events = parsed.events.map((event, index) => {
        const y = pad + headerHeight + index * rowGap;
        if (event.type === 'note') {
          const ids = event.ids.filter((id) => xFor.has(id));
          const left = Math.min(...ids.map((id) => xFor.get(id))) - 68;
          const right = Math.max(...ids.map((id) => xFor.get(id))) + 68;
          return `<g class="mermaid-note"><rect x="${left}" y="${y - 18}" width="${right - left}" height="38" rx="8"></rect>${renderSvgText(event.text, (left + right) / 2, y + 1, 28, 'mermaid-node-label', 16)}</g>`;
        }
        const x1 = xFor.get(event.from);
        const x2 = xFor.get(event.to);
        const textX = (x1 + x2) / 2;
        const textY = y - 8;
        return `<g class="mermaid-message"><path d="M ${x1} ${y} L ${x2} ${y}" marker-end="url(#${markerId})"></path><text x="${textX}" y="${textY}">${escapeHtml(event.text)}</text></g>`;
      }).join('');

      return [
        `<figure class="mermaid-diagram mermaid-sequence" data-mermaid-source="${escapeAttribute(code)}">`,
        '<figcaption>Mermaid sequenceDiagram</figcaption>',
        `<svg class="mermaid-svg" role="img" aria-label="Mermaid sequence diagram" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">`,
        `<defs><marker id="${markerId}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"></path></marker></defs>`,
        lifelines,
        events,
        '</svg>',
        '</figure>',
      ].join('');
    }

    function parseMermaidSequence(code) {
      const lines = normalizeNewlines(code).split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('%%') && !/^sequenceDiagram\b/i.test(line));
      const participants = new Map();
      const events = [];
      const ensureParticipant = (id, label = id) => {
        if (/^[A-Za-z][\w-]*$/.test(id) && !participants.has(id)) participants.set(id, { id, label });
      };

      for (const line of lines) {
        let match = line.match(/^(?:participant|actor)\s+([A-Za-z][\w-]*)(?:\s+as\s+(.+))?$/i);
        if (match) {
          ensureParticipant(match[1], (match[2] || match[1]).trim());
          continue;
        }
        match = line.match(/^Note\s+(?:over|right of|left of)\s+([^:]+):\s*(.+)$/i);
        if (match) {
          const ids = match[1].split(',').map((item) => item.trim()).filter(Boolean);
          ids.forEach((id) => ensureParticipant(id));
          events.push({ type: 'note', ids, text: match[2].trim() });
          continue;
        }
        match = line.match(/^([A-Za-z]\w*)\s*(?:-+|=+)[>x.)-]*\s*([A-Za-z]\w*)\s*:\s*(.+)$/);
        if (match) {
          ensureParticipant(match[1]);
          ensureParticipant(match[2]);
          events.push({ type: 'message', from: match[1], to: match[2], text: match[3].trim() });
        }
      }
      return { participants: Array.from(participants.values()), events };
    }

    function renderSvgText(label, x, y, maxChars, className, fontSize = 18) {
      const lines = splitSvgLabel(label, maxChars);
      const lineHeight = Math.round(fontSize * 1.2);
      const firstOffset = lines.length > 1 ? -((lines.length - 1) * lineHeight) / 2 : Math.round(fontSize * 0.35);
      const tspans = lines.map((line, index) => {
        const dy = index === 0 ? firstOffset : lineHeight;
        return `<tspan x="${x}" dy="${dy}">${escapeHtml(line)}</tspan>`;
      }).join('');
      return `<text class="${escapeAttribute(className || '')}" x="${x}" y="${y}" text-anchor="middle" font-size="${fontSize}" font-weight="650">${tspans}</text>`;
    }

    function splitSvgLabel(label, maxChars) {
      const value = String(label || '').trim() || ' ';
      const words = value.includes(' ') ? value.split(/\s+/) : value.match(new RegExp(`.{1,${maxChars}}`, 'g')) || [value];
      const lines = [];
      let current = '';
      for (const word of words) {
        const next = current ? `${current} ${word}` : word;
        if (next.length > maxChars && current) {
          lines.push(current);
          current = word;
        } else {
          current = next;
        }
      }
      if (current) lines.push(current);
      if (lines.length <= 3) return lines;
      return [...lines.slice(0, 2), `${lines[2].slice(0, Math.max(1, maxChars - 1))}…`];
    }

    function cleanMermaidLabel(value) {
      return String(value || '')
        .trim()
        .replace(/^["']|["']$/g, '')
        .replace(/\\n/g, '\n')
        .trim();
    }

    function nextMermaidId(prefix, code) {
      mermaidRenderSerial = (mermaidRenderSerial + 1) % Number.MAX_SAFE_INTEGER;
      return `pme-${prefix}-${hashString(code)}-${mermaidRenderSerial}`;
    }

    function hashString(value) {
      let hash = 2166136261;
      const text = String(value || '');
      for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }
      return (hash >>> 0).toString(36);
    }

    function buildExportHtml(markdown, fileName) {
      const title = escapeHtml(stripExtension(fileName || 'Markdown Document'));
      const body = renderMarkdownHtml(markdown);
      const exportedAt = escapeHtml(new Date().toLocaleString('ja-JP'));
      const documentFont = state.documentFont === 'serif'
        ? "'Yu Mincho','Hiragino Mincho ProN',Georgia,serif"
        : "'Yu Gothic UI','Yu Gothic',Meiryo,system-ui,sans-serif";
      return `<!doctype html>
  <html lang="ja">
  <head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'; img-src 'self' data: blob:; style-src 'unsafe-inline'; script-src 'none'; connect-src 'none';">
  <title>${title}</title>
  <style>
  body{margin:0;padding:clamp(1rem,4vw,4rem);font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.75;color:#111827;background:#fff}main{max-width:920px;margin:auto}h1,h2{border-bottom:1px solid #e5e7eb;padding-bottom:.25rem}pre{overflow:auto;background:#0f172a;color:#e5e7eb;border-radius:.75rem;padding:1rem}code{font-family:Consolas,monospace;background:#f3f4f6;border-radius:.25rem;padding:.1rem .25rem}pre code{background:transparent;padding:0}.code-lang{float:right;color:#94a3b8;font:700 .72rem system-ui}.tok-comment{color:#94a3b8}.tok-string{color:#a7f3d0}.tok-number{color:#fde68a}.tok-keyword{color:#93c5fd}.tok-function{color:#f9a8d4}.tok-property{color:#c4b5fd}.tok-tag{color:#fca5a5}.tok-operator{color:#cbd5e1}blockquote{border-left:.25rem solid #2563eb;margin:1rem 0;padding:.25rem 1rem;background:#eff6ff}table{border-collapse:collapse;width:100%}th,td{border:1px solid #d1d5db;padding:.5rem}.align-left{text-align:left}.align-center{text-align:center}.align-right{text-align:right}img{max-width:100%}.math-inline{display:inline-block}.math-display{display:block;margin:1rem 0;text-align:center}.katex>.katex-mathml{display:inline}.katex>.katex-html{display:none}.meta{color:#6b7280;font-size:.9rem}.blocked-image,.blocked-link{color:#b42318;border:1px solid #f3b8b1;border-radius:.3rem;padding:.1rem .3rem}.toc{border:1px solid #e5e7eb;border-radius:.75rem;padding:1rem}.toc a{display:block;color:#2563eb;text-decoration:none}.mermaid-diagram{margin:1.25rem 0}.mermaid-diagram figcaption{font-weight:700;color:#475569;margin-bottom:.4rem}.mermaid-svg{width:100%;height:auto;min-height:10rem;max-height:none;border:1px solid #d1d5db;border-radius:.75rem;background:#f8fafc}.mermaid-sequence .mermaid-svg,.mermaid-svg.mindmapDiagram{max-width:min(100%,820px);margin-inline:auto}.mermaid-svg.flowchart{display:block;width:min(100%,560px);margin-inline:auto}.mermaid-svg.flowchart text{font-size:12px!important}.mermaid-fallback pre{margin:0}.mermaid-svg .edgeLabel text,.mermaid-svg .edgeLabel tspan{paint-order:stroke;stroke:#f8fafc;stroke-width:7px;stroke-linejoin:round}.mermaid-node rect,.mermaid-node ellipse,.mermaid-node polygon,.mermaid-seq-participant rect{fill:#fff;stroke:#2563eb;stroke-width:1.5}.mermaid-svg.mindmapDiagram .section-root circle,.mermaid-svg.mindmapDiagram .node-bkg{fill:#fff!important;stroke:#2563eb!important}.mermaid-svg.mindmapDiagram .label .background{fill:#fff!important;opacity:.92!important}.mermaid-svg.mindmapDiagram .edge{stroke:#2563eb!important;stroke-width:2px!important;stroke-opacity:.22}.mermaid-edge path,.mermaid-message path{stroke:#334155;stroke-width:1.6;fill:none}.mermaid-edge-label,.mermaid-message text{font:650 18px system-ui;fill:#475569;text-anchor:middle;paint-order:stroke;stroke:#f8fafc;stroke-width:7px;stroke-linejoin:round}.mermaid-node-label{font:650 16px system-ui;fill:#0f172a}.mermaid-flow-node-label{font:650 24px system-ui;fill:#0f172a}.mermaid-lifeline{stroke:#94a3b8;stroke-dasharray:5 5}.mermaid-note rect{fill:#fef3c7;stroke:#f59e0b}
  </style>
  </head>
  <body style="font-family:${documentFont}">
  <main>
  <p class="meta">Exported locally: ${exportedAt}</p>
  ${body}
  </main>
  </body>
  </html>`;
    }

    function safeSetHtml(element, html) {
      element.innerHTML = html;
      enhanceRenderedHtml(element);
    }

    function enhanceRenderedHtml(root) {
      renderKaTeXIn(root);
      wrapRenderedInlineAtoms(root);
      annotateRenderedInlineAtomRanges(root);
      renderMermaidIn(root);
    }

    function renderMermaidIn(root) {
      if (!window.mermaid?.render) return;
      cleanupMermaidRenderScratchNodes();
      const targets = Array.from(root.querySelectorAll('.mermaid-render-target[data-mermaid-source]'));
      mermaidRenderQueue = mermaidRenderQueue
        .then(() => renderMermaidTargets(targets))
        .catch(() => {});
    }

    window.PMERenderMermaidIn = renderMermaidIn;

    async function renderMermaidTargets(targets) {
      for (const target of targets) {
        if (!target.isConnected) continue;
        const source = target.getAttribute('data-mermaid-source') || '';
        if (target.querySelector('svg.mermaid-svg')) continue;
        const id = target.getAttribute('data-mermaid-render-id') || nextMermaidId('diagram', source);
        cleanupMermaidRenderScratch(id);
        try {
          const result = await window.mermaid.render(id, source);
          if (!target.isConnected) continue;
          const svg = typeof result === 'string' ? result : result?.svg;
          const safeSvg = sanitizeSvgMarkup(svg);
          if (safeSvg) {
            target.classList.remove('mermaid-fallback');
            target.removeAttribute('data-mermaid-error');
            target.innerHTML = safeSvg;
            applyMermaidZoom(target);
          } else {
            target.classList.add('mermaid-fallback');
            target.setAttribute('data-mermaid-error', 'SVG安全化に失敗しました');
            target.innerHTML = renderMermaidFallbackPre(source);
          }
        } catch (error) {
          if (!target.isConnected) continue;
          target.classList.add('mermaid-fallback');
          target.setAttribute('data-mermaid-error', String(error?.message || 'Mermaid描画に失敗しました').slice(0, 300));
          target.innerHTML = renderMermaidFallbackPre(source);
        } finally {
          cleanupMermaidRenderScratch(id);
        }
      }
      cleanupMermaidRenderScratchNodes();
    }

    function applyMermaidZoom(target) {
      if (!target) return;
      const figure = target.closest('.mermaid-diagram');
      const svg = target.querySelector('svg.mermaid-svg');
      if (!figure || !svg) return;
      const zoom = mermaidZoomValue(figure);
      const baseWidth = mermaidBaseWidth(svg);
      const width = baseWidth * zoom;
      if (!Number.isFinite(width) || width <= 0) return;
      svg.style.width = `${width}px`;
      svg.style.maxWidth = 'none';
      svg.style.marginInline = 'auto';
      target.classList.add('is-zoomable');
    }

    function mermaidBaseWidth(svg) {
      const viewBoxWidth = mermaidViewBoxWidth(svg);
      if (viewBoxWidth) return Math.max(360, viewBoxWidth);
      if (svg.classList.contains('flowchart')) return 560;
      if (svg.classList.contains('mindmapDiagram')) return 820;
      if (svg.closest('.mermaid-sequence')) return 820;
      return 720;
    }

    function mermaidViewBoxWidth(svg) {
      const baseVal = svg?.viewBox?.baseVal;
      if (baseVal && Number.isFinite(baseVal.width) && baseVal.width > 0) return baseVal.width;
      const viewBox = svg?.getAttribute?.('viewBox') || '';
      const parts = viewBox.trim().split(/[\s,]+/).map(Number);
      return Number.isFinite(parts[2]) && parts[2] > 0 ? parts[2] : 0;
    }

    function cleanupMermaidRenderScratch(id) {
      if (!id || !document?.getElementById) return;
      document.getElementById(`d${id}`)?.remove();
    }

    function cleanupMermaidRenderScratchNodes() {
      if (!document?.querySelectorAll) return;
      document.querySelectorAll('body > div[id^="dpme-"]').forEach((node) => node.remove());
    }

    function sanitizeSvgMarkup(svg) {
      if (!window.DOMParser) return '';
      const doc = new DOMParser().parseFromString(normalizeSvgMarkupForParsing(svg), 'image/svg+xml');
      if (doc.querySelector('parsererror')) return '';
      doc.querySelectorAll('script, iframe, object, embed, foreignObject, form, input, button, select, textarea, link, meta').forEach((node) => node.remove());
      doc.querySelectorAll('style').forEach((node) => {
        if (!isSafeSvgStyle(node.textContent || '')) node.remove();
      });
      doc.querySelectorAll('*').forEach((node) => {
        for (const attr of Array.from(node.attributes)) {
          const name = attr.name.toLowerCase();
          const value = attr.value.trim().toLowerCase();
          if (name.startsWith('on') || value.startsWith('javascript:') || name === 'srcdoc') {
            node.removeAttribute(attr.name);
            continue;
          }
          if (name === 'style' && !isSafeSvgStyle(attr.value)) {
            node.removeAttribute(attr.name);
            continue;
          }
          if (['href', 'xlink:href', 'src'].includes(name) && !isSafeSvgLink(attr.value)) {
            node.removeAttribute(attr.name);
          }
        }
      });
      const svgElement = doc.documentElement;
      if (svgElement?.tagName?.toLowerCase() === 'svg') {
        svgElement.classList.add('mermaid-svg');
        svgElement.removeAttribute('style');
        polishMermaidSvg(svgElement);
      }
      return svgElement?.outerHTML || '';
    }

    function normalizeSvgMarkupForParsing(svg) {
      const markup = String(svg || '');
      const withNamespace = /<svg\b[^>]*\sxmlns:xlink=/i.test(markup)
        ? markup
        : markup.replace(/<svg\b/i, '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
      return withNamespace.replace(/\s+xlink:href=/gi, ' href=');
    }

    function polishMermaidSvg(svgElement) {
      const role = (svgElement.getAttribute('aria-roledescription') || '').toLowerCase();
      if (role === 'timeline') polishMermaidTimeline(svgElement);
      if (role === 'sankey') polishMermaidSankey(svgElement);
      if (role === 'packet') polishMermaidPacket(svgElement);
      if (role === 'c4') polishMermaidC4(svgElement);
    }

    function setSafeSvgStyle(node, styles) {
      if (!node?.style) return;
      Object.entries(styles).forEach(([name, value]) => {
        node.style.setProperty(name, value, 'important');
      });
    }

    function polishMermaidTimeline(svgElement) {
      svgElement.querySelectorAll('.timeline-node').forEach((node) => {
        const card = node.classList.contains('section-0') || node.classList.contains('section-2')
          ? 'var(--mermaid-timeline-card-alt)'
          : 'var(--mermaid-timeline-card)';
        node.querySelectorAll('.node-bkg').forEach((shape) => setSafeSvgStyle(shape, {
          fill: card,
          stroke: 'var(--mermaid-timeline-line)',
          'stroke-width': '1.25px',
        }));
      });
      svgElement.querySelectorAll('text, tspan').forEach((text) => setSafeSvgStyle(text, {
        fill: 'var(--mermaid-timeline-text)',
        color: 'var(--mermaid-timeline-text)',
        'font-weight': '700',
      }));
      svgElement.querySelectorAll('line, path').forEach((line) => {
        if (line.classList.contains('node-bkg')) return;
        setSafeSvgStyle(line, { stroke: 'var(--mermaid-timeline-line)' });
      });
    }

    function polishMermaidSankey(svgElement) {
      const colors = [
        'var(--mermaid-sankey-1)',
        'var(--mermaid-sankey-2)',
        'var(--mermaid-sankey-3)',
        'var(--mermaid-sankey-4)',
        'var(--mermaid-sankey-5)',
        'var(--mermaid-sankey-6)',
        'var(--mermaid-sankey-7)',
      ];
      svgElement.querySelectorAll('.nodes .node rect').forEach((rect, index) => setSafeSvgStyle(rect, {
        fill: colors[index % colors.length],
        stroke: 'color-mix(in srgb, var(--panel) 72%, var(--text))',
        'stroke-width': '1px',
      }));
      svgElement.querySelectorAll('.links .link').forEach((link) => setSafeSvgStyle(link, {
        'mix-blend-mode': 'normal',
        opacity: '1',
      }));
      svgElement.querySelectorAll('.links path').forEach((path) => setSafeSvgStyle(path, {
        opacity: '0.9',
        'stroke-opacity': '0.9',
        'mix-blend-mode': 'normal',
      }));
      svgElement.querySelectorAll('text').forEach((text) => setSafeSvgStyle(text, {
        fill: 'var(--text)',
        color: 'var(--text)',
        'font-weight': '650',
        'paint-order': 'stroke',
        stroke: 'var(--panel)',
        'stroke-width': '4px',
        'stroke-linejoin': 'round',
      }));
    }

    function polishMermaidPacket(svgElement) {
      svgElement.querySelectorAll('.packetBlock').forEach((block, index) => setSafeSvgStyle(block, {
        fill: index % 2 ? 'var(--mermaid-packet-block-alt)' : 'var(--mermaid-packet-block)',
        stroke: 'var(--accent)',
        'stroke-width': '1.2px',
      }));
      svgElement.querySelectorAll('.packetLabel, .packetByte, .packetTitle').forEach((text) => setSafeSvgStyle(text, {
        fill: 'var(--mermaid-packet-text)',
        color: 'var(--mermaid-packet-text)',
        'font-weight': '700',
      }));
    }

    function polishMermaidC4(svgElement) {
      svgElement.querySelectorAll('path[fill="none"], line').forEach((line) => setSafeSvgStyle(line, {
        stroke: 'var(--accent)',
      }));
      svgElement.querySelectorAll('.person-man path').forEach((shape) => setSafeSvgStyle(shape, {
        fill: 'var(--text)',
        stroke: 'none',
      }));
      replaceUnsafeC4Images(svgElement);
      polishMermaidC4Text(svgElement);
      repositionMermaidC4RelationshipLabels(svgElement);
    }

    function replaceUnsafeC4Images(svgElement) {
      svgElement.querySelectorAll('image').forEach((image) => {
        if (image.getAttribute('href') || image.getAttribute('xlink:href')) return;
        const x = Number(image.getAttribute('x'));
        const y = Number(image.getAttribute('y'));
        const width = Number(image.getAttribute('width'));
        const height = Number(image.getAttribute('height'));
        if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
          image.remove();
          return;
        }
        image.replaceWith(createSafeC4PersonIcon(svgElement.ownerDocument, x, y, width, height));
      });
    }

    function createSafeC4PersonIcon(documentRef, x, y, width, height) {
      const namespace = 'http://www.w3.org/2000/svg';
      const group = documentRef.createElementNS(namespace, 'g');
      group.setAttribute('class', 'c4-safe-person-icon');
      const cx = x + width / 2;
      const head = documentRef.createElementNS(namespace, 'circle');
      head.setAttribute('cx', String(cx));
      head.setAttribute('cy', String(y + height * 0.28));
      head.setAttribute('r', String(Math.max(5, Math.min(width, height) * 0.16)));
      const body = documentRef.createElementNS(namespace, 'rect');
      const bodyWidth = width * 0.54;
      const bodyHeight = height * 0.32;
      body.setAttribute('x', String(cx - bodyWidth / 2));
      body.setAttribute('y', String(y + height * 0.52));
      body.setAttribute('width', String(bodyWidth));
      body.setAttribute('height', String(bodyHeight));
      body.setAttribute('rx', String(Math.max(4, bodyHeight * 0.32)));
      [head, body].forEach((shape) => {
        setSafeSvgStyle(shape, {
          fill: '#ffffff',
          stroke: 'none',
        });
        group.appendChild(shape);
      });
      return group;
    }

    function polishMermaidC4Text(svgElement) {
      svgElement.querySelectorAll('text').forEach((text) => {
        const fill = (text.getAttribute('fill') || '').trim().toLowerCase();
        if (fill === '#ffffff' || fill === 'white') {
          setSafeSvgStyle(text, {
            fill: '#ffffff',
            color: '#ffffff',
            stroke: 'none',
          });
          return;
        }
        setSafeSvgStyle(text, {
          fill: 'var(--text)',
          color: 'var(--text)',
          'paint-order': 'stroke',
          stroke: 'var(--panel)',
          'stroke-width': '4px',
          'stroke-linejoin': 'round',
        });
      });
    }

    function repositionMermaidC4RelationshipLabels(svgElement) {
      const rects = Array.from(svgElement.querySelectorAll('rect'))
        .map((rect) => ({
          x: Number(rect.getAttribute('x')),
          y: Number(rect.getAttribute('y')),
          width: Number(rect.getAttribute('width')),
          height: Number(rect.getAttribute('height')),
        }))
        .filter((rect) => [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) && rect.width > 40 && rect.height > 40)
        .sort((a, b) => a.x - b.x);
      const relationshipLabels = Array.from(svgElement.querySelectorAll('text')).filter((text) => {
        const fill = (text.getAttribute('fill') || '').trim().toLowerCase();
        return fill === '#444444' || fill === '#333333';
      });
      relationshipLabels.forEach((text) => {
        const x = Number(text.getAttribute('x'));
        const y = Number(text.getAttribute('y'));
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        const candidate = bestC4LabelGap(rects, x, y);
        if (!candidate) return;
        text.setAttribute('x', String(candidate.x));
        text.setAttribute('y', String(y - 6));
      });
    }

    function bestC4LabelGap(rects, labelX, labelY) {
      let best = null;
      for (let index = 0; index < rects.length - 1; index += 1) {
        const left = rects[index];
        const right = rects[index + 1];
        const leftRight = left.x + left.width;
        const rightLeft = right.x;
        const gap = rightLeft - leftRight;
        if (gap < 24) continue;
        const top = Math.min(left.y, right.y) - 64;
        const bottom = Math.max(left.y + left.height, right.y + right.height) + 64;
        if (labelY < top || labelY > bottom) continue;
        const midpoint = leftRight + gap / 2;
        const distance = Math.min(Math.abs(labelX - leftRight), Math.abs(labelX - rightLeft), Math.abs(labelX - midpoint));
        if (!best || distance < best.distance) best = { x: midpoint, distance };
      }
      return best;
    }

    function isSafeSvgStyle(value) {
      const style = String(value || '').toLowerCase();
      if (!style) return true;
      if (style.includes('@import') || style.includes('expression(') || style.includes('javascript:') || style.includes('data:')) return false;
      const urls = style.match(/url\(([^)]+)\)/g) || [];
      return urls.every((token) => {
        const inner = token.slice(4, -1).trim().replace(/^['"]|['"]$/g, '');
        return inner.startsWith('#');
      });
    }

    function isSafeSvgLink(value) {
      if (!value || String(value).startsWith('#')) return true;
      return Boolean(sanitizeLinkUrl(value));
    }

    function renderKaTeXIn(root) {
      if (!window.katex?.renderToString || !document.createTreeWalker) return;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          if (!node.nodeValue || !/[\\$]/.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
          if (node.parentElement?.closest('pre, code, textarea, .katex')) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      });
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      nodes.forEach(replaceMathTextNode);
    }

    function replaceMathTextNode(node) {
      const parts = splitMathSegments(node.nodeValue || '');
      if (parts.length === 1 && parts[0].type === 'text') return;
      const fragment = document.createDocumentFragment();
      for (const part of parts) {
        if (part.type === 'text') {
          fragment.appendChild(document.createTextNode(part.value));
          continue;
        }
        const span = document.createElement(part.display ? 'div' : 'span');
        span.className = part.display ? 'math-display' : 'math-inline';
        span.setAttribute('data-math-source', part.value);
        span.setAttribute('data-math-display', String(part.display));
        span.innerHTML = renderKaTeX(part.value, part.display);
        fragment.appendChild(span);
      }
      node.replaceWith(fragment);
    }

    function splitMathSegments(text) {
      const source = String(text || '');
      const parts = [];
      let last = 0;
      let cursor = 0;
      while (cursor < source.length) {
        const match = inlineMathTokenAt(source, cursor);
        if (!match) {
          cursor += 1;
          continue;
        }
        if (cursor > last) parts.push({ type: 'text', value: source.slice(last, cursor) });
        parts.push({ type: 'math', value: match.value, display: false });
        cursor = match.end;
        last = cursor;
      }
      if (last < source.length) parts.push({ type: 'text', value: source.slice(last) });
      if (!parts.length) parts.push({ type: 'text', value: source });
      return parts;
    }

    function renderKaTeX(source, displayMode) {
      try {
        return window.katex.renderToString(source, {
          displayMode,
          throwOnError: false,
          strict: 'ignore',
          trust: false,
        });
      } catch (_) {
        return escapeHtml(source);
      }
    }

    function sanitizeLinkUrl(raw) {
      const value = cleanupUrl(raw);
      if (!value) return '';
      if (value.startsWith('#')) return value;
      if (value.startsWith('//')) return '';
      const external = sanitizeAllowedExternalLink(value);
      if (external) return external;
      if (/^[./A-Za-z0-9_-]/.test(value) && !value.includes(':')) return value;
      return '';
    }

    function sanitizeAllowedExternalLink(value) {
      if (!/^https?:\/\//i.test(value) || !state.allowedLinkDomains.length) return '';
      try {
        const url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol)) return '';
        if (url.username || url.password) return '';
        const host = url.hostname.toLowerCase();
        if (!state.allowedLinkDomains.some((domain) => host === domain || host.endsWith(`.${domain}`))) return '';
        return url.href;
      } catch (_) {
        return '';
      }
    }

    function sanitizeImageUrl(raw) {
      const value = cleanupUrl(raw, { keepSpaces: true });
      const compact = cleanupUrl(raw);
      if (!value) return '';
      if (compact.startsWith('blob:')) return compact;
      if (/^data:image\/(png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/=\s]+$/i.test(compact)) return compact.replace(/\s/g, '');
      const local = normalizeLocalImageUrl(value);
      if (local) return local;
      return '';
    }

    function normalizeLocalImageUrl(raw) {
      const value = decodeLocalImagePath(String(raw || '').trim().replace(/[\u0000-\u001F\u007F]/g, ''));
      if (!value || value.startsWith('//')) return '';
      if (isLocalAbsoluteImageReference(value)) {
        const alias = state.desktopHost && state.desktopDocumentReady
          ? state.desktopImageAliases.get(desktopImageAliasKey(value))
          : '';
        return alias ? desktopDocumentAssetUrl(alias) : '';
      }
      if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) return '';
      return relativeImageUrl(value);
    }

    function decodeLocalImagePath(value) {
      const raw = String(value || '');
      if (!/%[0-9A-Fa-f]{2}/.test(raw)) return raw;
      try {
        return decodeURIComponent(raw);
      } catch (_) {
        return raw
          .replace(/%5c/gi, '\\')
          .replace(/%2f/gi, '/')
          .replace(/%20/gi, ' ');
      }
    }

    function relativeImageUrl(value) {
      if (value.includes(':') || value.startsWith('//')) return '';
      const normalized = value.replace(/\\/g, '/');
      if (!hasRasterImageExtension(normalized)) return '';
      const asset = resolveFolderAssetUrl(normalized);
      if (asset) return asset;
      return '';
    }

    function renderBlockedImage(src, alt) {
      const label = escapeHtml(alt || '画像');
      const reason = imageBlockReason(src);
      return `<span class="blocked-image" data-markdown-src="${escapeAttribute(src)}" data-markdown-alt="${escapeAttribute(alt || '画像')}">画像未表示: ${label} (${escapeHtml(reason)})</span>`;
    }

    function onPreviewImageError(event) {
      const image = event.target;
      if (!(image instanceof HTMLImageElement) || !els.preview.contains(image)) return;
      const source = image.getAttribute('data-markdown-src') || '';
      const alt = image.getAttribute('alt') || '画像';
      const fallback = document.createElement('span');
      fallback.className = 'blocked-image';
      fallback.setAttribute('data-markdown-src', source);
      fallback.setAttribute('data-markdown-alt', alt);
      fallback.textContent = `画像未表示: ${alt} (${imageBlockReason(source)})`;
      image.replaceWith(fallback);
      setStatus('画像ファイルを読み込めませんでした。パス、形式、25MB上限を確認してください');
    }

    function imageBlockReason(raw) {
      const value = cleanupUrl(raw, { keepSpaces: true });
      const decoded = decodeLocalImagePath(value);
      const compact = cleanupUrl(decoded);
      if (!value) return '画像パスが空です';
      if (/^https?:\/\//i.test(compact)) return 'http/https画像はローカル実行と追跡防止のためブロックしています';
      if (isLocalAbsoluteImageReference(decoded)) {
        if (state.desktopHost && state.desktopDocumentReady) {
          return '開いているMarkdownと同じフォルダ内の画像として解決できません。画像挿入でassetsへコピーするか、相対パスへ変更してください';
        }
        return 'ローカル絶対パスは直接読み込みません。フォルダを許可してMarkdown基準の相対パスで参照してください';
      }
      if (isRelativeImageReference(decoded)) {
        const normalized = normalizeAssetPath(decoded);
        if (isUnsafeRelativePath(normalized)) return '安全でない相対パスです';
        if (state.desktopHost && !state.desktopDocumentReady) return '先にMarkdownファイルを保存すると相対画像を表示できます';
        if (!state.markdownRelativePath) return 'フォルダが許可されていないため、Markdownファイル基準の相対画像を読めません';
        return '画像ファイルが見つからないか、PNG/JPEG/GIF/WebPとして検証できません';
      }
      return '許可されていない画像パスです';
    }

    function isRelativeImageReference(value) {
      const normalized = decodeLocalImagePath(String(value || '').trim()).replace(/\\/g, '/');
      if (!normalized || normalized.startsWith('//')) return false;
      if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(normalized)) return false;
      return hasRasterImageExtension(normalized);
    }

    function isLocalAbsoluteImageReference(value) {
      const decoded = decodeLocalImagePath(value).trim();
      return /^file:/i.test(decoded)
        || /^[A-Za-z]:[\\/]/.test(decoded)
        || /^\\\\[^\\]+\\[^\\]+/.test(decoded);
    }

    function resolveFolderAssetUrl(value) {
      const key = normalizeAssetPath(value);
      if (!key || isUnsafeRelativePath(key)) return '';
      if (state.desktopHost && state.desktopDocumentReady) return desktopDocumentAssetUrl(key);
      return state.assetUrls.get(key)
        || state.assetUrls.get(key.replace(/^\.\//, ''))
        || state.assetUrls.get(`./${key}`)
        || '';
    }

    function desktopDocumentAssetUrl(value) {
      const decoded = decodeLocalImagePath(value).replace(/\\/g, '/');
      const parts = decoded.split('/').filter((part) => part && part !== '.');
      if (!parts.length || parts.includes('..')) return '';
      if (parts.some((part) => /[\u0000-\u001F\u007F]/.test(part))) return '';
      const encoded = parts.map((part) => encodeURIComponent(part)).join('/');
      return `https://${DESKTOP_DOCUMENT_HOST}/${encoded}`;
    }

    function hasRasterImageExtension(value) {
      return IMAGE_EXTENSION_PATTERN.test(String(value || '').split(/[?#]/, 1)[0]);
    }

    function cleanupUrl(raw, options = {}) {
      const value = String(raw || '').trim().replace(/[\u0000-\u001F\u007F]+/g, '').slice(0, 200000);
      return options.keepSpaces ? value : value.replace(/\s+/g, '');
    }

    function parseMarkdownTarget(target) {
      const trimmed = String(target || '').trim();
      if (!trimmed) return '';
      const quoted = trimmed.match(/^<([^>]+)>/);
      if (quoted) return quoted[1];
      const first = trimmed.match(/^[^\s]+/);
      return first ? first[0] : '';
    }

    return Object.freeze({
      annotateRenderedBlockHtml,
      applyMermaidZoom,
      buildBlockModel,
      buildExportHtml,
      buildHeadingIndex,
      buildHeadingTree,
      buildOutlineTreeElement,
      cleanupUrl,
      decodeLocalImagePath,
      enhanceRenderedHtml,
      getLines,
      hasAmbiguousStrongDelimiterNeighborhood,
      hasRasterImageExtension,
      hashString,
      imageBlockReason,
      isLocalAbsoluteImageReference,
      isRelativeImageReference,
      onPreviewImageError,
      parseMarkdownTarget,
      renderBlockHtml,
      renderInlineMarkdown,
      renderMarkdownHtml,
      renderMermaidIn,
      safeSetHtml,
      sanitizeImageUrl,
      sanitizeLinkUrl,
      splitMarkdownBlocks,
    });
  }

  window.PMEMarkdownRenderer = Object.freeze({ createMarkdownRenderer });
})();

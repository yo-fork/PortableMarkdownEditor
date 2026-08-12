(() => {
  'use strict';

  function createRichEditor(options = {}) {
    const state = options.state;
    const els = options.els;
    const constants = options.constants || {};
    const dependencies = options.dependencies || {};
    if (!state || !els) throw new Error('Rich editor requires state and element references');

    const {
      RICH_ATOMIC_SOURCE_BLOCK_SELECTOR,
      RICH_CARET_TOKEN_PATTERN,
      RICH_INLINE_EDIT_BLOCK_SELECTOR,
      RICH_INLINE_SOURCE_SELECTOR,
      RICH_SOURCE_BLOCK_SELECTOR,
    } = constants;
    const {
      applySourceTransaction,
      buildBlockModel,
      canOpenSingleDelimiterAt,
      configureRichEditableSurface,
      enhanceRenderedHtml,
      ensureListItemEditablePlaceholder,
      ensureRichTextBlockPlaceholder,
      findListItemTextPosition,
      flatListSourceItems,
      formatMarkdownTarget,
      hasAmbiguousStrongDelimiterNeighborhood,
      isEnterKey,
      isSameRichInlineEditBlock,
      listItemEditableContentNodes,
      markDirty,
      nodeClosest,
      nodeElement,
      normalizeNewlines,
      numericData,
      parseMarkdownQuoteSource,
      parseMarkdownTableSource,
      parsePendingRichInlineMarkdownInBlock,
      persistDraft,
      placeCaretAtInlineBoundary,
      placeCaretInTextNode,
      prefixLines,
      renderAll,
      renderInlineMarkdown,
      renderRich,
      richBlockMarkdownTriggerReplacement,
      richInlineEditBlockForRange,
      richInlineElementTextOffsetForRange,
      richInlineSourceCaretOffset,
      richLineBreakCaretInputText,
      richListSourcePointFromRange,
      richQuoteHardBreakDomRepair,
      richQuoteSourcePointFromRange,
      richTableSourcePointFromRange,
      safeCodeLanguage,
      sanitizeImageUrl,
      sanitizeLinkUrl,
      scheduleAutosave,
      scheduleRender,
      scheduleRichReparse,
      setStatus,
      sourceOffsetFromListItemTextOffset,
      suppressRichInlineActivation,
      syncCodeMirrorSourceFromTextarea,
      textOffsetFromListItemSourceOffset,
      validRichInlineSourceElement,
      visibleListItemText,
      visibleTextFromListSourceItem,
    } = dependencies;

    function getRichCaretBookmark() {
      const selection = window.getSelection?.();
      if (!selection || !selection.rangeCount || !els.rich.contains(selection.anchorNode)) return null;
      const range = selection.getRangeAt(0);
      const sourceSelection = domSelectionToSourceSelection(selection);
      const inlineSource = nodeClosest(range.startContainer, '.rich-inline-source');
      if (inlineSource && els.rich.contains(inlineSource)) {
        return {
          kind: 'inline-source',
          sourceSelection,
          inlineIndex: richInlineSourceElementIndex(inlineSource),
          source: normalizeNewlines(inlineSource.textContent || ''),
          sourceOffset: richInlineSourceCaretOffset(inlineSource) || 0,
        };
      }

      const before = range.cloneRange();
      before.selectNodeContents(els.rich);
      before.setEnd(range.startContainer, range.startOffset);
      const selected = range.cloneRange();
      return {
        sourceSelection,
        start: before.toString().length,
        length: selected.toString().length,
      };
    }

    function richInlineSourceElementIndex(target) {
      return richInlineSourceLikeElementsInOrder().findIndex((element) => element === target);
    }

    function richInlineSourceLikeElementsInOrder() {
      return Array.from(els.rich.querySelectorAll(RICH_INLINE_SOURCE_SELECTOR)).filter((element) => {
        if (element.classList.contains('rich-inline-source')) return els.rich.contains(element);
        return Boolean(validRichInlineSourceElement(element));
      });
    }

    function restoreRichCaret(bookmark) {
      if (!bookmark) return;
      if (bookmark.kind === 'inline-source' && restoreRichInlineSourceCaret(bookmark)) return;
      if (restoreRichCaretFromSourceSelection(bookmark.sourceSelection)) return;
      const start = findTextPosition(els.rich, bookmark.start);
      const end = findTextPosition(els.rich, bookmark.start + bookmark.length);
      if (!start) {
        els.rich.focus();
        return;
      }
      const startAtom = nodeClosest(start.node, '.rich-inline-atom');
      if (startAtom && els.rich.contains(startAtom)) {
        const offsetRange = document.createRange();
        offsetRange.selectNodeContents(startAtom);
        offsetRange.setEnd(start.node, start.offset);
        const boundary = offsetRange.toString().length <= (startAtom.textContent || '').length / 2 ? 'before' : 'after';
        placeCaretAtInlineBoundary(startAtom, boundary);
        return;
      }
      const range = document.createRange();
      range.setStart(start.node, start.offset);
      if (end) {
        range.setEnd(end.node, end.offset);
      } else {
        range.collapse(true);
      }
      const selection = window.getSelection?.();
      if (!selection) return;
      selection.removeAllRanges();
      selection.addRange(range);
      els.rich.focus();
    }

    function restoreRichCaretFromSourceSelection(sourceSelection) {
      const range = sourceSelectionToDomRange(sourceSelection);
      if (!range) return false;
      const selection = window.getSelection?.();
      if (!selection) return false;
      try {
        els.rich.focus({ preventScroll: true });
      } catch (_) {
        els.rich.focus();
      }
      selection.removeAllRanges();
      selection.addRange(range);
      return true;
    }

    function domSelectionToSourceSelection(selection) {
      if (!selection || !selection.rangeCount || !els.rich.contains(selection.anchorNode) || !els.rich.contains(selection.focusNode)) return null;
      let anchor = domPointToSourceOffset(selection.anchorNode, selection.anchorOffset);
      let focus = domPointToSourceOffset(selection.focusNode, selection.focusOffset);
      if (!anchor || !focus) return null;
      if (!selection.isCollapsed) {
        const anchorAtomic = atomicSourceRangeForDomPoint(selection.anchorNode);
        const focusAtomic = atomicSourceRangeForDomPoint(selection.focusNode);
        if (anchorAtomic && focusAtomic && anchorAtomic.block === focusAtomic.block) {
          anchor = { offset: anchorAtomic.start, affinity: 'before' };
          focus = { offset: focusAtomic.end, affinity: 'after' };
        } else {
          if (anchorAtomic) anchor = sourceBoundaryForAtomicSelectionEndpoint(anchorAtomic, focus.offset);
          if (focusAtomic) focus = sourceBoundaryForAtomicSelectionEndpoint(focusAtomic, anchor.offset);
        }
      }
      return {
        anchor: anchor.offset,
        focus: focus.offset,
        affinity: selection.isCollapsed ? anchor.affinity : undefined,
      };
    }

    function domPointToSourceOffset(container, offset) {
      const atomicBlock = nodeClosest(container, RICH_ATOMIC_SOURCE_BLOCK_SELECTOR);
      if (atomicBlock && els.rich.contains(atomicBlock)) {
        const sourceBoundary = sourceBoundaryForAtomicBlockDomPoint(atomicBlock, container, offset);
        if (sourceBoundary) return sourceBoundary;
      }

      const atom = nodeClosest(container, '.rich-inline-atom');
      if (atom && els.rich.contains(atom)) {
        const start = Number(atom.dataset.srcStart);
        const end = Number(atom.dataset.srcEnd);
        if (Number.isFinite(start) && Number.isFinite(end)) {
          const textOffset = textOffsetWithinElement(atom, container, offset);
          const midpoint = (atom.textContent || '').length / 2;
          return textOffset <= midpoint
            ? { offset: start, affinity: 'before' }
            : { offset: end, affinity: 'after' };
        }
      }

      if (container?.nodeType === Node.ELEMENT_NODE) {
        const beforeNode = container.childNodes?.[offset - 1];
        const afterNode = container.childNodes?.[offset];
        const beforeAtomic = nodeElement(beforeNode)?.closest?.(RICH_ATOMIC_SOURCE_BLOCK_SELECTOR);
        if (beforeAtomic && els.rich.contains(beforeAtomic) && Number.isFinite(Number(beforeAtomic.dataset.sourceEnd))) {
          return { offset: Number(beforeAtomic.dataset.sourceEnd), affinity: 'after' };
        }
        const afterAtomic = nodeElement(afterNode)?.closest?.(RICH_ATOMIC_SOURCE_BLOCK_SELECTOR);
        if (afterAtomic && els.rich.contains(afterAtomic) && Number.isFinite(Number(afterAtomic.dataset.sourceStart))) {
          return { offset: Number(afterAtomic.dataset.sourceStart), affinity: 'before' };
        }
        const beforeAtom = beforeNode?.nodeType === Node.ELEMENT_NODE ? beforeNode.closest?.('.rich-inline-atom') : null;
        if (beforeAtom && els.rich.contains(beforeAtom) && Number.isFinite(Number(beforeAtom.dataset.srcEnd))) {
          return { offset: Number(beforeAtom.dataset.srcEnd), affinity: 'after' };
        }
        const afterAtom = afterNode?.nodeType === Node.ELEMENT_NODE ? afterNode.closest?.('.rich-inline-atom') : null;
        if (afterAtom && els.rich.contains(afterAtom) && Number.isFinite(Number(afterAtom.dataset.srcStart))) {
          return { offset: Number(afterAtom.dataset.srcStart), affinity: 'before' };
        }
      }

      const tableCell = nodeClosest(container, 'td, th');
      if (tableCell && els.rich.contains(tableCell)) {
        const tableRange = document.createRange();
        try {
          tableRange.setStart(container, offset);
          tableRange.collapse(true);
        } catch (_) {
          return null;
        }
        const tablePoint = richTableSourcePointFromRange(tableCell, tableRange);
        if (tablePoint) return { offset: tablePoint.offset, affinity: 'after' };
      }

      const quote = nodeClosest(container, 'blockquote');
      if (quote && els.rich.contains(quote)) {
        const quoteRange = document.createRange();
        try {
          quoteRange.setStart(container, offset);
          quoteRange.collapse(true);
        } catch (_) {
          return null;
        }
        const quotePoint = richQuoteSourcePointFromRange(quote, quoteRange);
        if (quotePoint) return { offset: quotePoint.offset, affinity: 'after' };
      }

      const editBlock = richInlineEditBlockForRange({ startContainer: container });
      if (editBlock?.tagName?.toLowerCase() === 'li') {
        const listRange = document.createRange();
        try {
          listRange.setStart(container, offset);
          listRange.collapse(true);
        } catch (_) {
          return null;
        }
        const listPoint = richListSourcePointFromRange(editBlock, listRange);
        if (listPoint) return { offset: listPoint.offset, affinity: 'after' };
      }
      const sourceBlock = nodeClosest(container, RICH_SOURCE_BLOCK_SELECTOR);
      if (!editBlock || !sourceBlock) return null;
      const blockStart = numericData(sourceBlock, 'sourceStart');
      const baseOffset = sourceContentBaseOffset(sourceBlock);
      const before = document.createRange();
      before.selectNodeContents(editBlock);
      try {
        before.setEnd(container, offset);
      } catch (_) {
        return null;
      }
      const fragment = before.cloneContents();
      const localSource = stripRichCaretTokens(serializeInlineNodes(Array.from(fragment.childNodes)));
      return { offset: blockStart + baseOffset + localSource.length, affinity: 'after' };
    }

    function sourceBoundaryForAtomicBlockDomPoint(block, container, offset) {
      const start = numericData(block, 'sourceStart');
      const end = numericData(block, 'sourceEnd');
      if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
      if (container === block && container.nodeType === Node.ELEMENT_NODE) {
        if (offset <= 0) return { offset: start, affinity: 'before' };
        if (offset >= block.childNodes.length) return { offset: end, affinity: 'after' };
      }
      const textOffset = textOffsetWithinElement(block, container, offset);
      const midpoint = Math.max(1, (block.textContent || '').length) / 2;
      return textOffset <= midpoint
        ? { offset: start, affinity: 'before' }
        : { offset: end, affinity: 'after' };
    }

    function atomicSourceRangeForDomPoint(container) {
      const block = nodeClosest(container, RICH_ATOMIC_SOURCE_BLOCK_SELECTOR);
      if (!block || !els.rich.contains(block)) return null;
      const start = numericData(block, 'sourceStart');
      const end = numericData(block, 'sourceEnd');
      if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
      return { block, start, end };
    }

    function sourceBoundaryForAtomicSelectionEndpoint(range, otherOffset) {
      if (!range) return null;
      if (Number.isFinite(otherOffset) && otherOffset <= range.start) {
        return { offset: range.end, affinity: 'after' };
      }
      return { offset: range.start, affinity: 'before' };
    }

    function sourceSelectionToDomRange(sourceSelection) {
      if (!sourceSelection || !Number.isFinite(sourceSelection.focus)) return null;
      const focus = Number(sourceSelection.focus);
      const anchor = Number.isFinite(sourceSelection.anchor) ? Number(sourceSelection.anchor) : focus;
      if (anchor === focus) {
        return sourceOffsetToCollapsedDomRange(focus, sourceSelection.affinity);
      }

      const start = Math.min(anchor, focus);
      const end = Math.max(anchor, focus);
      const startRange = sourceOffsetToCollapsedDomRange(start, 'before');
      const endRange = sourceOffsetToCollapsedDomRange(end, 'after');
      if (!startRange || !endRange) return null;

      const range = document.createRange();
      try {
        range.setStart(startRange.startContainer, startRange.startOffset);
        range.setEnd(endRange.startContainer, endRange.startOffset);
      } catch (_) {
        return null;
      }
      return range;
    }

    function sourceOffsetToCollapsedDomRange(offset, affinity = 'after') {
      if (!Number.isFinite(offset)) return null;
      const atom = inlineAtomForSourceOffset(offset, affinity);
      if (atom) {
        const range = document.createRange();
        if (affinity === 'before' || offset <= Number(atom.dataset.srcStart)) {
          range.setStartBefore(atom);
        } else {
          range.setStartAfter(atom);
        }
        range.collapse(true);
        return range;
      }

      const block = renderedBlockForSourceOffset(els.rich, offset);
      if (!block) return null;
      if (block.matches?.('table')) {
        const tableRange = sourceOffsetToTableDomRange(block, offset);
        if (tableRange) return tableRange;
      }
      if (block.matches?.('blockquote')) {
        const quoteRange = sourceOffsetToQuoteDomRange(block, offset);
        if (quoteRange) return quoteRange;
      }
      if (block.matches?.('ul, ol')) {
        const listRange = sourceOffsetToListDomRange(block, offset);
        if (listRange) return listRange;
      }
      const inlineRange = sourceOffsetToInlineDomRange(block, offset);
      if (inlineRange) return inlineRange;
      const localOffset = Math.max(0, offset - numericData(block, 'sourceStart') - sourceContentBaseOffset(block));
      const position = findTextPosition(block, localOffset);
      if (!position) return null;
      const range = document.createRange();
      range.setStart(position.node, Math.max(0, Math.min(position.offset, position.node.nodeValue?.length || 0)));
      range.collapse(true);
      return range;
    }

    function sourceOffsetToInlineDomRange(block, offset) {
      if (!block || block.matches?.('ul, ol')) return null;
      const blockStart = numericData(block, 'sourceStart');
      if (!Number.isFinite(blockStart)) return null;
      const range = document.createRange();
      const nodes = block.tagName?.toLowerCase() === 'li'
        ? richInlineEditBlockContentNodes(block)
        : Array.from(block.childNodes);
      let cursor = blockStart + sourceContentBaseOffset(block);
      let lastNode = null;
      let lastText = null;

      for (const node of nodes) {
        if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains('task-checkbox')) continue;
        if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains('rich-inline-atom')) {
          const start = Number(node.dataset.srcStart);
          const end = Number(node.dataset.srcEnd);
          if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
            if (offset <= start) {
              range.setStartBefore(node);
              range.collapse(true);
              return range;
            }
            if (offset < end) {
              if (offset - start <= (end - start) / 2) range.setStartBefore(node);
              else range.setStartAfter(node);
              range.collapse(true);
              return range;
            }
            cursor = Math.max(cursor, end);
            lastNode = node;
            continue;
          }
        }

        if (node.nodeType === Node.ELEMENT_NODE && node.tagName?.toLowerCase() === 'br') {
          if (offset <= cursor) {
            range.setStartBefore(node);
            range.collapse(true);
            return range;
          }
          if (offset <= cursor + 1) {
            const anchor = node.nextSibling?.nodeType === Node.ELEMENT_NODE && node.nextSibling.classList?.contains('rich-line-break-caret-anchor')
              ? node.nextSibling
              : null;
            if (anchor?.firstChild?.nodeType === Node.TEXT_NODE) {
              range.setStart(anchor.firstChild, Math.min(1, anchor.firstChild.nodeValue.length));
              state.richLineBreakInputOffset = offset;
            } else {
              range.setStartAfter(node);
            }
            range.collapse(true);
            return range;
          }
          cursor += 1;
          lastNode = node;
          continue;
        }

        if (node.nodeType === Node.TEXT_NODE) {
          const length = normalizeRichText(node.nodeValue || '').length;
          if (offset <= cursor + length) {
            range.setStart(node, Math.max(0, Math.min(node.nodeValue?.length || 0, offset - cursor)));
            range.collapse(true);
            return range;
          }
          cursor += length;
          lastText = node;
          lastNode = node;
          continue;
        }

        const length = stripRichCaretTokens(serializeInlineNode(node)).length;
        if (offset <= cursor + length) {
          const position = findTextPosition(node, offset - cursor);
          if (position) {
            range.setStart(position.node, Math.max(0, Math.min(position.offset, position.node.nodeValue?.length || 0)));
          } else {
            range.setStartBefore(node);
          }
          range.collapse(true);
          return range;
        }
        cursor += length;
        lastNode = node;
      }

      if (lastText?.isConnected) range.setStart(lastText, lastText.nodeValue?.length || 0);
      else if (lastNode?.isConnected) range.setStartAfter(lastNode);
      else range.setStart(block, 0);
      range.collapse(true);
      return range;
    }

    function sourceOffsetToTableDomRange(table, offset) {
      const blockStart = numericData(table, 'sourceStart');
      const blockEnd = numericData(table, 'sourceEnd');
      if (!Number.isFinite(blockStart) || !Number.isFinite(blockEnd)) return null;
      const raw = stripRichCaretTokens(state.markdown || '').slice(blockStart, blockEnd);
      const model = parseMarkdownTableSource(raw);
      if (!model) return null;
      const local = Math.max(0, Math.min(raw.length, offset - blockStart));
      let target = null;
      for (let lineIndex = 0; lineIndex < model.rows.length; lineIndex += 1) {
        if (lineIndex === 1) continue;
        const row = model.rows[lineIndex];
        for (let cellIndex = 0; cellIndex < row.cells.length; cellIndex += 1) {
          const cell = row.cells[cellIndex];
          const start = row.line.start + cell.contentStart;
          const end = row.line.start + cell.contentEnd;
          if (start <= local && local <= end) {
            target = { lineIndex, cellIndex, cell, localOffset: local - start };
            break;
          }
        }
        if (target) break;
      }
      if (!target) return null;
      const domCell = tableDomCellAtSourceLocation(table, target.lineIndex, target.cellIndex);
      return domCell ? tableCellSourceOffsetRange(domCell, target.localOffset) : null;
    }

    function tableDomCellAtSourceLocation(table, lineIndex, cellIndex) {
      if (lineIndex === 0) {
        return table.querySelectorAll('thead > tr > th')[cellIndex] || null;
      }
      if (lineIndex < 2) return null;
      const row = table.querySelectorAll('tbody > tr')[lineIndex - 2] || null;
      return row?.children?.[cellIndex] || null;
    }

    function tableCellSourceOffsetRange(cell, targetOffset) {
      const range = document.createRange();
      const target = Math.max(0, Number(targetOffset) || 0);
      let cursor = 0;
      let lastNode = null;
      let lastText = null;

      for (const node of Array.from(cell.childNodes)) {
        if (node.nodeType === Node.TEXT_NODE) {
          const source = serializeTableCellInlineNode(node);
          const length = source.length;
          if (target <= cursor + length) {
            range.setStart(node, Math.max(0, Math.min(node.nodeValue?.length || 0, target - cursor)));
            range.collapse(true);
            return range;
          }
          cursor += length;
          lastText = node;
          lastNode = node;
          continue;
        }

        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (node.classList.contains('rich-inline-atom')) {
          const source = stripRichCaretTokens(node.dataset.inlineSource || serializeInlineChildren(node));
          const end = cursor + source.length;
          if (target <= cursor) {
            range.setStartBefore(node);
            range.collapse(true);
            return range;
          }
          if (target < end) {
            if (target - cursor <= source.length / 2) range.setStartBefore(node);
            else range.setStartAfter(node);
            range.collapse(true);
            return range;
          }
          if (target === end) {
            range.setStartAfter(node);
            range.collapse(true);
            return range;
          }
          cursor = end;
          lastNode = node;
          continue;
        }

        if (node.tagName?.toLowerCase() === 'br') {
          const length = 4;
          if (target <= cursor) {
            range.setStartBefore(node);
            range.collapse(true);
            return range;
          }
          if (target <= cursor + length) {
            range.setStartAfter(node);
            range.collapse(true);
            return range;
          }
          cursor += length;
          lastNode = node;
          continue;
        }

        const source = stripRichCaretTokens(serializeTableCellInlineNode(node));
        const length = source.length;
        if (target <= cursor + length) {
          const position = findTextPosition(node, target - cursor);
          if (position) range.setStart(position.node, Math.max(0, Math.min(position.offset, position.node.nodeValue?.length || 0)));
          else range.setStartBefore(node);
          range.collapse(true);
          return range;
        }
        cursor += length;
        lastNode = node;
      }

      if (lastText?.isConnected) range.setStart(lastText, lastText.nodeValue?.length || 0);
      else if (lastNode?.isConnected) range.setStartAfter(lastNode);
      else range.setStart(cell, 0);
      range.collapse(true);
      return range;
    }

    function sourceOffsetToQuoteDomRange(blockquote, offset) {
      const blockStart = numericData(blockquote, 'sourceStart');
      const blockEnd = numericData(blockquote, 'sourceEnd');
      if (!Number.isFinite(blockStart) || !Number.isFinite(blockEnd)) return null;
      const anchor = Array.from(blockquote.querySelectorAll('.rich-line-break-caret-anchor[data-source-offset]'))
        .find((element) => Number(element.dataset.sourceOffset) === offset);
      if (anchor?.firstChild?.nodeType === Node.TEXT_NODE) {
        const range = document.createRange();
        range.setStart(anchor.firstChild, anchor.firstChild.nodeValue.length);
        range.collapse(true);
        state.richLineBreakInputOffset = offset;
        return range;
      }
      const raw = stripRichCaretTokens(state.markdown || '').slice(blockStart, blockEnd);
      const model = parseMarkdownQuoteSource(raw);
      if (!model?.lines?.length) return null;
      const local = Math.max(0, Math.min(raw.length, offset - blockStart));
      let renderedOffset = 0;
      const lines = model.lines;
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (local <= line.line.start + line.contentStart) {
          renderedOffset = line.renderedStart;
          break;
        }
        if (local <= line.line.start + line.contentEnd) {
          renderedOffset = line.renderedStart + (local - line.line.start - line.contentStart);
          break;
        }
        renderedOffset = line.renderedEnd + (index < lines.length - 1 ? 1 : 0);
      }
      return quoteRenderedOffsetRange(blockquote, renderedOffset);
    }

    function quoteRenderedOffsetRange(blockquote, targetOffset) {
      const range = document.createRange();
      const target = Math.max(0, Number(targetOffset) || 0);
      let cursor = 0;
      let lastNode = null;
      let lastText = null;

      for (const node of Array.from(blockquote.childNodes)) {
        if (node.nodeType === Node.TEXT_NODE) {
          const source = normalizeRichText(node.nodeValue || '');
          const length = source.length;
          if (target <= cursor + length) {
            range.setStart(node, Math.max(0, Math.min(node.nodeValue?.length || 0, target - cursor)));
            range.collapse(true);
            return range;
          }
          cursor += length;
          lastText = node;
          lastNode = node;
          continue;
        }

        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (node.classList.contains('rich-inline-atom')) {
          const source = stripRichCaretTokens(node.dataset.inlineSource || serializeInlineChildren(node));
          const end = cursor + source.length;
          if (target <= cursor) {
            range.setStartBefore(node);
            range.collapse(true);
            return range;
          }
          if (target < end) {
            if (target - cursor <= source.length / 2) range.setStartBefore(node);
            else range.setStartAfter(node);
            range.collapse(true);
            return range;
          }
          if (target === end) {
            range.setStartAfter(node);
            range.collapse(true);
            return range;
          }
          cursor = end;
          lastNode = node;
          continue;
        }

        if (node.tagName?.toLowerCase() === 'br') {
          if (target <= cursor) {
            range.setStartBefore(node);
            range.collapse(true);
            return range;
          }
          if (target <= cursor + 1) {
            range.setStartAfter(node);
            range.collapse(true);
            return range;
          }
          cursor += 1;
          lastNode = node;
          continue;
        }

        const source = stripRichCaretTokens(serializeInlineNode(node));
        const length = source.length;
        if (target <= cursor + length) {
          const position = findTextPosition(node, target - cursor);
          if (position) range.setStart(position.node, Math.max(0, Math.min(position.offset, position.node.nodeValue?.length || 0)));
          else range.setStartBefore(node);
          range.collapse(true);
          return range;
        }
        cursor += length;
        lastNode = node;
      }

      if (lastText?.isConnected) range.setStart(lastText, lastText.nodeValue?.length || 0);
      else if (lastNode?.isConnected) range.setStartAfter(lastNode);
      else range.setStart(blockquote, 0);
      range.collapse(true);
      return range;
    }

    function sourceOffsetToListDomRange(list, offset) {
      const blockStart = numericData(list, 'sourceStart');
      const blockEnd = numericData(list, 'sourceEnd');
      const raw = stripRichCaretTokens(state.markdown || '').slice(blockStart, blockEnd);
      const sourceItems = flatListSourceItems(raw);
      const items = Array.from(list.children).filter((child) => child.tagName?.toLowerCase() === 'li');
      if (!sourceItems.length || sourceItems.length !== items.length) return null;
      const local = Math.max(0, Math.min(raw.length, offset - blockStart));
      let itemIndex = sourceItems.findIndex((sourceItem) => sourceItem.start <= local && local <= sourceItem.end);
      if (itemIndex === -1) {
        itemIndex = sourceItems.findIndex((sourceItem) => local < sourceItem.start);
        if (itemIndex === -1) itemIndex = sourceItems.length - 1;
      }
      const sourceItem = sourceItems[itemIndex];
      const item = items[itemIndex];
      if (!item || !sourceItem?.parsed) return null;
      const contentOffset = Math.max(0, Math.min(visibleTextFromListSourceItem(sourceItem).length, textOffsetFromListItemSourceOffset(sourceItem, local)));
      if (visibleTextFromListSourceItem(sourceItem) === visibleListItemText(item)) {
        const sourceRange = listItemSourceContentOffsetRange(item, contentOffset);
        if (sourceRange) return sourceRange;
      }
      return listItemTextOffsetRange(item, contentOffset);
    }

    function listItemSourceContentOffsetRange(item, targetOffset) {
      if (!item) return null;
      const range = document.createRange();
      const target = Math.max(0, Number(targetOffset) || 0);
      let cursor = 0;
      let lastNode = null;
      let lastText = null;

      for (const node of listItemEditableContentNodes(item)) {
        if (node.nodeType === Node.TEXT_NODE) {
          const source = serializeInlineNode(node);
          const length = source.length;
          if (target <= cursor + length) {
            range.setStart(node, Math.max(0, Math.min(node.nodeValue?.length || 0, target - cursor)));
            range.collapse(true);
            return range;
          }
          cursor += length;
          lastText = node;
          lastNode = node;
          continue;
        }

        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (node.classList.contains('task-checkbox')) continue;
        if (node.classList.contains('rich-inline-atom')) {
          const source = stripRichCaretTokens(node.dataset.inlineSource || serializeInlineChildren(node));
          const end = cursor + source.length;
          if (target <= cursor) {
            range.setStartBefore(node);
            range.collapse(true);
            return range;
          }
          if (target < end) {
            if (target - cursor <= source.length / 2) range.setStartBefore(node);
            else range.setStartAfter(node);
            range.collapse(true);
            return range;
          }
          if (target === end) {
            range.setStartAfter(node);
            range.collapse(true);
            return range;
          }
          cursor = end;
          lastNode = node;
          continue;
        }

        const tag = node.tagName?.toLowerCase();
        if (tag === 'br') {
          if (target <= cursor + 1) {
            range.setStartAfter(node);
            range.collapse(true);
            return range;
          }
          cursor += 1;
          lastNode = node;
          continue;
        }

        const source = stripRichCaretTokens(serializeInlineNode(node));
        const length = source.length;
        if (target <= cursor + length) {
          const position = findTextPosition(node, target - cursor);
          if (position) range.setStart(position.node, Math.max(0, Math.min(position.offset, position.node.nodeValue?.length || 0)));
          else range.setStartBefore(node);
          range.collapse(true);
          return range;
        }
        cursor += length;
        lastNode = node;
      }

      if (lastText?.isConnected) range.setStart(lastText, lastText.nodeValue?.length || 0);
      else if (lastNode?.isConnected) range.setStartAfter(lastNode);
      else range.setStart(item, item.childNodes.length);
      range.collapse(true);
      return range;
    }

    function listItemTextOffsetRange(item, targetOffset) {
      const range = document.createRange();
      const anchor = item.querySelector(':scope > .rich-list-caret-anchor');
      if (anchor?.firstChild?.nodeType === Node.TEXT_NODE) {
        range.setStart(anchor.firstChild, anchor.firstChild.nodeValue.length);
        range.collapse(true);
        return range;
      }
      const position = findListItemVisibleTextPosition(item, targetOffset) || findListItemTextPosition(item, targetOffset);
      if (position) {
        if (position.beforeNode) range.setStartBefore(position.beforeNode);
        else if (position.afterNode) range.setStartAfter(position.afterNode);
        else range.setStart(position.node, position.offset);
        range.collapse(true);
        return range;
      }
      const textNode = document.createTextNode('\u200b');
      const children = Array.from(item.childNodes);
      const firstEditableIndex = children.findIndex((child) => !(child.nodeType === 1 && child.classList.contains('task-checkbox')));
      if (firstEditableIndex >= 0) {
        item.insertBefore(textNode, children[firstEditableIndex]);
      } else {
        item.appendChild(textNode);
      }
      range.setStart(textNode, 1);
      range.collapse(true);
      return range;
    }

    function findListItemVisibleTextPosition(item, targetOffset) {
      const segments = [];
      const visit = (node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          const raw = normalizeRichText(node.nodeValue || '');
          const beforeHardBreak = node.nextSibling?.nodeType === Node.ELEMENT_NODE
            && node.nextSibling.tagName?.toLowerCase() === 'br';
          const visibleLength = beforeHardBreak ? raw.replace(/[ \t]{2}$/, '').length : raw.length;
          segments.push({ type: 'text', node, length: visibleLength });
          return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        if (nodeClosest(node, 'li') !== item) return;
        if (node.classList.contains('task-checkbox')) return;
        if (node.parentElement?.closest('.rich-source-editor, .code-language-input')) return;
        const tag = node.tagName?.toLowerCase();
        if (tag === 'ul' || tag === 'ol') return;
        if (tag === 'br') {
          segments.push({ type: 'break', node, length: 1 });
          return;
        }
        Array.from(node.childNodes).forEach(visit);
      };
      listItemEditableContentNodes(item).forEach(visit);

      let consumed = 0;
      let lastText = null;
      const target = Math.max(0, Number(targetOffset) || 0);
      for (let index = 0; index < segments.length; index += 1) {
        const segment = segments[index];
        if (segment.type === 'text') {
          lastText = segment;
          if (target <= consumed + segment.length) {
            return { node: segment.node, offset: Math.max(0, Math.min(segment.node.nodeValue.length, target - consumed)) };
          }
          consumed += segment.length;
          continue;
        }
        if (target <= consumed + 1) {
          const nextText = segments.slice(index + 1).find((itemSegment) => itemSegment.type === 'text');
          if (nextText) return { node: nextText.node, offset: 0 };
          return { afterNode: segment.node };
        }
        consumed += 1;
      }
      return lastText ? { node: lastText.node, offset: Math.min(lastText.node.nodeValue.length, lastText.length) } : null;
    }

    function inlineAtomForSourceOffset(offset, affinity) {
      const atoms = Array.from(els.rich.querySelectorAll('.rich-inline-atom[data-src-start][data-src-end]'));
      return atoms.find((atom) => {
        const start = Number(atom.dataset.srcStart);
        const end = Number(atom.dataset.srcEnd);
        if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
        if (affinity === 'before') return offset === start;
        if (affinity === 'after') return offset === end;
        return start <= offset && offset <= end;
      }) || null;
    }

    function renderedBlockForSourceOffset(container, offset) {
      const blocks = Array.from(container.querySelectorAll(RICH_SOURCE_BLOCK_SELECTOR));
      const direct = blocks.find((block) => {
        const start = numericData(block, 'sourceStart');
        const end = numericData(block, 'sourceEnd');
        return start <= offset && offset <= end;
      });
      if (direct) return direct;
      const markdown = stripRichCaretTokens(state.markdown || els.source?.value || '');
      return blocks.find((block) => {
        const start = numericData(block, 'sourceStart');
        const end = numericData(block, 'sourceEnd');
        if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
        if (offset !== end + 1 || markdown[end] !== '\n') return false;
        return /[ \t]{2}$/.test(markdown.slice(start, end));
      }) || null;
    }

    function textOffsetWithinElement(element, container, offset) {
      const range = document.createRange();
      range.selectNodeContents(element);
      try {
        range.setEnd(container, offset);
        return range.toString().length;
      } catch (_) {
        return 0;
      }
    }

    function sourceContentBaseOffset(sourceBlock) {
      const blockStart = numericData(sourceBlock, 'sourceStart');
      const blockEnd = numericData(sourceBlock, 'sourceEnd');
      const raw = stripRichCaretTokens(state.markdown || '').slice(blockStart, blockEnd);
      if (sourceBlock.tagName?.toLowerCase()?.match(/^h[1-6]$/)) {
        const match = raw.match(/^(\s*#{1,6}\s+)/);
        return match ? match[1].length : 0;
      }
      return 0;
    }

    function restoreRichInlineSourceCaret(bookmark) {
      const candidates = richInlineSourceLikeElementsInOrder();
      const exactIndexCandidate = candidates[bookmark.inlineIndex];
      const source = normalizeNewlines(bookmark.source || '');
      const candidate = exactIndexCandidate && richInlineSourceFromElement(exactIndexCandidate) === source
        ? exactIndexCandidate
        : candidates.find((element) => richInlineSourceFromElement(element) === source);
      if (!candidate) return false;
      activateRichInlineSource(candidate, Math.max(0, bookmark.sourceOffset || 0));
      return true;
    }

    function findTextPosition(root, targetOffset) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          if (node.parentElement?.closest('.rich-source-editor, .code-language-input')) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      });
      let consumed = 0;
      let last = null;
      while (walker.nextNode()) {
        const node = walker.currentNode;
        last = node;
        const length = node.nodeValue.length;
        if (consumed + length >= targetOffset) {
          return { node, offset: Math.max(0, targetOffset - consumed) };
        }
        consumed += length;
      }
      return last ? { node: last, offset: last.nodeValue.length } : null;
    }

    function updateTaskCheckbox(input) {
      if (els.rich.contains(input)) {
        const sourceTransaction = taskCheckboxToggleTransaction(input, input.closest?.('li'));
        if (sourceTransaction) {
          applySourceTransaction(sourceTransaction, 'task-toggle');
        } else if (guardFailedRichSourceControlTransaction(input, 'task-toggle', 'チェックリストの位置を特定できませんでした')) {
          return;
        } else {
          syncRichMarkdownFromDom('task-toggle');
        }
        setStatus(input.checked ? 'チェックを付けました' : 'チェックを外しました');
        return;
      }
      const position = Number(input.dataset.taskPos);
      if (!Number.isInteger(position) || !/^[ xX]$/.test(state.markdown[position] || '')) {
        renderAll('task-toggle-invalid');
        setStatus('チェックリストの位置を特定できませんでした');
        return;
      }
      const mark = input.checked ? 'x' : ' ';
      state.markdown = state.markdown.slice(0, position) + mark + state.markdown.slice(position + 1);
      els.source.value = state.markdown;
      syncCodeMirrorSourceFromTextarea('task-toggle');
      markDirty();
      renderAll('task-toggle');
      persistDraft();
      setStatus(input.checked ? 'チェックを付けました' : 'チェックを外しました');
    }

    function updateCodeBlockLanguage(input) {
      if (els.rich.contains(input)) {
        const language = safeCodeLanguage(input.value || '');
        const editingPre = input.closest('pre.code-block.is-editing-source');
        if (editingPre) {
          editingPre.dataset.codeLanguage = language;
          setStatus(language ? `コード言語: ${language}` : 'コード言語を未指定にしました');
          return;
        }
        const sourceTransaction = codeBlockLanguageTransaction(input);
        if (sourceTransaction) {
          applySourceTransaction(sourceTransaction, 'code-language');
          refocusCodeLanguageInput(sourceTransaction.codeStart, language);
        } else if (guardFailedRichSourceControlTransaction(input, 'code-language', 'コードブロックの言語行を更新できませんでした')) {
          return;
        } else {
          syncRichMarkdownFromDom('code-language', { refreshRich: true });
        }
        setStatus(language ? `コード言語: ${language}` : 'コード言語を未指定にしました');
        return;
      }
      const start = Number(input.dataset.codeStart);
      const end = Number(input.dataset.codeEnd);
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start) {
        setStatus('コードブロックの位置を特定できませんでした');
        return;
      }
      const lineEnd = state.markdown.indexOf('\n', start);
      const fenceEnd = lineEnd === -1 || lineEnd > end ? end : lineEnd;
      const fenceLine = state.markdown.slice(start, fenceEnd);
      const match = fenceLine.match(/^(\s*```)\s*([A-Za-z0-9_+.-]*)\s*$/);
      if (!match) {
        setStatus('コードブロックの言語行を更新できませんでした');
        return;
      }
      const language = safeCodeLanguage(input.value || '');
      const replacement = `${match[1]}${language}`;
      state.markdown = state.markdown.slice(0, start) + replacement + state.markdown.slice(fenceEnd);
      els.source.value = state.markdown;
      syncCodeMirrorSourceFromTextarea('code-language');
      markDirty();
      renderAll('code-language');
      persistDraft();
      setStatus(language ? `コード言語: ${language}` : 'コード言語を未指定にしました');
    }

    function guardFailedRichSourceControlTransaction(control, reason, status) {
      const sourceBlock = nodeClosest(control, RICH_SOURCE_BLOCK_SELECTOR);
      if (!sourceBlock || !els.rich.contains(sourceBlock)) return false;
      renderAll(`${reason}-revert`);
      setStatus(status);
      suppressRichInlineActivation();
      return true;
    }

    function codeBlockLanguageTransaction(input) {
      const sourceRange = codeBlockLanguageSourceRange(input);
      const start = sourceRange?.start;
      const end = sourceRange?.end;
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start) return null;
      const markdown = stripRichCaretTokens(state.markdown || els.source.value || '');
      if (start >= markdown.length || end > markdown.length) return null;
      const lineEnd = markdown.indexOf('\n', start);
      const fenceEnd = lineEnd === -1 || lineEnd > end ? end : lineEnd;
      const fenceLine = markdown.slice(start, fenceEnd);
      const match = fenceLine.match(/^(\s*```)\s*([A-Za-z0-9_+.-]*)\s*$/);
      if (!match) return null;
      const language = safeCodeLanguage(input.value || '');
      const replacement = `${match[1]}${language}`;
      return {
        from: start,
        to: fenceEnd,
        insert: replacement,
        codeStart: start,
        selectionAfter: {
          anchor: start + replacement.length,
          focus: start + replacement.length,
          affinity: 'after',
        },
      };
    }

    function codeBlockLanguageSourceRange(input) {
      const dataStart = Number(input?.dataset?.codeStart);
      const dataEnd = Number(input?.dataset?.codeEnd);
      if (Number.isInteger(dataStart) && Number.isInteger(dataEnd) && dataStart >= 0 && dataEnd > dataStart) {
        return { start: dataStart, end: dataEnd };
      }
      const pre = input?.closest?.('pre.code-block');
      if (!pre?.matches?.(RICH_SOURCE_BLOCK_SELECTOR) || !els.rich.contains(pre)) return null;
      const start = numericData(pre, 'sourceStart');
      const end = numericData(pre, 'sourceEnd');
      return Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end > start
        ? { start, end }
        : null;
    }

    function refocusCodeLanguageInput(codeStart, language) {
      if (state.mode !== 'rich' || !els.rich) return;
      const nextInput = Array.from(els.rich.querySelectorAll('.code-language-input'))
        .find((element) => Number(element.dataset.codeStart) === codeStart);
      if (!nextInput) return;
      nextInput.focus({ preventScroll: true });
      const offset = String(language || '').length;
      try {
        nextInput.setSelectionRange(offset, offset);
      } catch (_) {}
    }

    function taskCheckboxToggleTransaction(input, item = null) {
      const datasetPosition = Number(input?.dataset?.taskPos);
      const markerRange = Number.isInteger(datasetPosition)
        ? null
        : richTaskCheckboxMarkerRangeFromItem(item || input?.closest?.('li'));
      const position = Number.isInteger(datasetPosition) ? datasetPosition : (markerRange?.from ?? NaN) + 1;
      if (!Number.isInteger(position) || !/^[ xX]$/.test(state.markdown[position] || '')) return null;
      return {
        from: position,
        to: position + 1,
        insert: input.checked ? 'x' : ' ',
        selectionAfter: {
          anchor: position + 1,
          focus: position + 1,
          affinity: 'after',
        },
      };
    }

    function removeRichTaskCheckboxTransaction(input, item = null) {
      const position = Number(input?.dataset?.taskPos);
      let markerStart = NaN;
      let markerEnd = NaN;
      if (Number.isInteger(position)) {
        markerStart = position - 1;
        markerEnd = position + 3;
      } else {
        const markerRange = richTaskCheckboxMarkerRangeFromItem(item || input?.closest?.('li'));
        markerStart = markerRange?.from ?? NaN;
        markerEnd = markerRange?.to ?? NaN;
      }
      if (markerStart < 0 || markerEnd > state.markdown.length || markerEnd <= markerStart) return null;
      if (!/^\[[ xX]\]\s/.test(state.markdown.slice(markerStart, markerEnd))) return null;
      return {
        from: markerStart,
        to: markerEnd,
        insert: '',
        selectionAfter: {
          anchor: markerStart,
          focus: markerStart,
          affinity: 'after',
        },
      };
    }

    function richTaskCheckboxMarkerRangeFromItem(item) {
      if (!item || !els.rich.contains(item)) return null;
      const list = item.closest('ul, ol');
      if (!list?.matches?.(RICH_SOURCE_BLOCK_SELECTOR) || item.parentElement !== list) return null;
      const blockStart = numericData(list, 'sourceStart');
      const blockEnd = numericData(list, 'sourceEnd');
      if (!Number.isFinite(blockStart) || !Number.isFinite(blockEnd)) return null;
      const raw = stripRichCaretTokens(state.markdown || '').slice(blockStart, blockEnd);
      const sourceItems = flatListSourceItems(raw);
      const items = Array.from(list.children).filter((child) => child.tagName?.toLowerCase() === 'li');
      const itemIndex = items.indexOf(item);
      if (itemIndex < 0 || sourceItems.length !== items.length) return null;
      const sourceItem = sourceItems[itemIndex];
      const firstLine = sourceItem?.lines?.[0];
      if (!sourceItem?.parsed?.task || !firstLine) return null;
      const marker = String(firstLine.text || '').match(/^(\s*(?:[-+*]|\d+\.)\s+)(\[[ xX]\]\s+)/);
      if (!marker) return null;
      return {
        from: blockStart + firstLine.start + marker[1].length,
        to: blockStart + firstLine.start + marker[1].length + marker[2].length,
      };
    }

    function activateRichInlineSource(element, position = 'end') {
      if (!element || element.classList.contains('rich-inline-source')) return;
      const active = state.richInlineSource?.element;
      if (active && active !== element) {
        commitRichInlineSource(active);
        return;
      }

      const source = stripRichCaretTokens(richInlineSourceFromElement(element));
      if (!source) return;
      const span = document.createElement('span');
      span.className = 'rich-inline-source';
      span.contentEditable = 'true';
      span.spellcheck = false;
      span.dataset.inlineSource = source;
      if (element.classList?.contains('rich-inline-atom')) {
        if (element.dataset.srcStart) span.dataset.srcStart = element.dataset.srcStart;
        if (element.dataset.srcEnd) span.dataset.srcEnd = element.dataset.srcEnd;
      }
      span.setAttribute('role', 'textbox');
      span.setAttribute('aria-label', 'インラインMarkdownソース');
      span.textContent = source;

      state.richSelectionLock = true;
      element.replaceWith(span);
      state.richInlineSource = { element: span, undoCaptured: false };
      placeCaretInInlineSource(span, position);
      state.richSelectionLock = false;
    }

    function commitRichInlineSource(sourceElement = state.richInlineSource?.element, options = {}) {
      if (!sourceElement) return false;
      if (!sourceElement.isConnected) {
        if (state.richInlineSource?.element === sourceElement) state.richInlineSource = null;
        return false;
      }

      const block = nodeClosest(sourceElement, RICH_INLINE_EDIT_BLOCK_SELECTOR);
      const source = stripRichCaretTokens(normalizeNewlines(sourceElement.textContent || ''));
      const alreadySynced = isRichInlineSourceAlreadySynced();
      const sourceTransaction = !options.caretToken && !alreadySynced
        ? richInlineSourceCommitTransaction(sourceElement, source)
        : null;
      if (sourceTransaction) {
        if (state.richInlineSource?.element === sourceElement) state.richInlineSource = null;
        applySourceTransaction(sourceTransaction, 'rich-inline-source-commit');
        return true;
      }
      const fragment = renderRichInlineSourceFragment(source);
      state.richSelectionLock = true;
      if (state.richInlineSource?.element === sourceElement) state.richInlineSource = null;
      sourceElement.replaceWith(fragment);
      if (block && els.rich.contains(block)) {
        reparseRichInlineEditBlockContent(block, { caretToken: options.caretToken || '' });
      }
      configureRichEditableSurface();
      finalizeRichProjectionChange('rich-input');
      state.richSelectionLock = false;
      return true;
    }

    function isRichInlineSourceAlreadySynced() {
      return stripRichCaretTokens(serializeRichMarkdown(els.rich)) === stripRichCaretTokens(state.markdown || '');
    }

    function finalizeRichProjectionChange(reason = 'rich-input') {
      sanitizeRichCaretTokensInDom(els.rich);
      if (stripRichCaretTokens(serializeRichMarkdown(els.rich)) === stripRichCaretTokens(state.markdown || '')) {
        refreshRichSourceRangesFromMarkdown();
        scheduleRender(reason);
        return true;
      }
      syncRichMarkdownFromDom(reason);
      return false;
    }

    function richInlineSourceCommitTransaction(sourceElement, source) {
      const start = Number(sourceElement?.dataset?.srcStart);
      const end = Number(sourceElement?.dataset?.srcEnd);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
      const insert = stripRichCaretTokens(source || '');
      const nextOffset = start + insert.length;
      return {
        from: start,
        to: end,
        insert,
        selectionAfter: {
          anchor: nextOffset,
          focus: nextOffset,
          affinity: 'after',
        },
      };
    }

    function placeCaretInInlineSource(element, position) {
      const text = element.firstChild || element.appendChild(document.createTextNode(''));
      const offset = Number.isInteger(position)
        ? Math.max(0, Math.min(position, text.nodeValue.length))
        : position === 'start' ? 0 : text.nodeValue.length;
      const range = document.createRange();
      range.setStart(text, offset);
      range.collapse(true);
      const selection = window.getSelection?.();
      if (!selection) return;
      selection.removeAllRanges();
      selection.addRange(range);
      element.focus();
    }

    function renderRichInlineSourceFragment(source) {
      const normalized = stripRichCaretTokens(normalizeNewlines(source || ''));
      if (richInlineSourceShouldStayLiteral(normalized)) {
        const fragment = document.createDocumentFragment();
        if (normalized) fragment.appendChild(document.createTextNode(normalized));
        return fragment;
      }

      const template = document.createElement('template');
      template.innerHTML = renderInlineMarkdown(normalized);
      enhanceRenderedHtml(template.content);
      return template.content;
    }

    function reparseRichInlineEditBlockContent(block, options = {}) {
      if (!block || !els.rich.contains(block)) return false;
      let marker = null;
      const caretToken = options.caretToken || (options.range ? richCaretToken() : '');
      if (options.range) {
        marker = document.createTextNode(caretToken);
        insertRichInlineReparseMarker(block, options.range, marker);
      }

      const markdownWithCaret = caretToken
        ? serializeRichInlineEditBlockContentPreservingCaret(block)
        : serializeRichInlineEditBlockContent(block);
      const tokenSelection = caretToken
        ? sourceSelectionFromRichInlineContentIndex(block, markdownWithCaret.indexOf(caretToken))
        : null;
      const markdown = stripRichCaretTokens(markdownWithCaret);
      const fragment = renderRichInlineSourceFragment(markdown);
      replaceRichInlineEditBlockContent(block, fragment);
      wrapRenderedInlineAtoms(block);
      stabilizeReparsedRichInlineBlock(block);
      configureRichEditableSurface();

      if (caretToken) {
        if (
          !(tokenSelection && restoreRichCaretFromSourceSelection(tokenSelection))
          && !(options.sourceSelection && restoreRichCaretFromSourceSelection(options.sourceSelection))
        ) {
          restoreCaretFromTextToken(block, caretToken);
        }
      } else if (marker?.isConnected) {
        marker.remove();
      }
      sanitizeRichCaretTokensInDom(block);
      suppressRichInlineActivation();
      return true;
    }

    function sourceSelectionFromRichInlineContentIndex(block, index) {
      if (!Number.isFinite(index) || index < 0) return null;
      let offset = null;
      if (block?.tagName?.toLowerCase() === 'li') {
        const listPoint = richListSourcePointFromContentIndex(block, index);
        offset = listPoint?.offset ?? null;
      } else {
        const sourceBlock = nodeClosest(block, RICH_SOURCE_BLOCK_SELECTOR);
        if (!sourceBlock) return null;
        const start = numericData(sourceBlock, 'sourceStart');
        if (!Number.isFinite(start)) return null;
        offset = start + sourceContentBaseOffset(sourceBlock) + index;
      }
      if (!Number.isFinite(offset)) return null;
      return {
        anchor: offset,
        focus: offset,
        affinity: 'after',
      };
    }

    function richListSourcePointFromContentIndex(item, index) {
      const list = item.closest('ul, ol');
      if (!list?.matches?.(RICH_SOURCE_BLOCK_SELECTOR) || item.parentElement !== list) return null;
      const blockStart = numericData(list, 'sourceStart');
      const blockEnd = numericData(list, 'sourceEnd');
      if (!Number.isFinite(blockStart) || !Number.isFinite(blockEnd)) return null;
      const raw = stripRichCaretTokens(state.markdown || '').slice(blockStart, blockEnd);
      const sourceItems = flatListSourceItems(raw);
      const items = Array.from(list.children).filter((child) => child.tagName?.toLowerCase() === 'li');
      const itemIndex = items.indexOf(item);
      if (itemIndex < 0 || sourceItems.length !== items.length) return null;
      const sourceItem = sourceItems[itemIndex];
      if (!sourceItem?.parsed) return null;
      const content = visibleTextFromListSourceItem(sourceItem);
      if (content !== visibleListItemText(item)) return null;
      const bounded = Math.max(0, Math.min(index, content.length));
      return {
        offset: blockStart + sourceOffsetFromListItemTextOffset(sourceItem, bounded),
      };
    }

    function stabilizeReparsedRichInlineBlock(block) {
      if (!block || !els.rich.contains(block)) return false;
      const changed = parsePendingRichInlineMarkdownInBlock(block);
      wrapRenderedInlineAtoms(block);
      return changed;
    }

    function insertRichInlineReparseMarker(block, range, marker) {
      const inlineElement = validRichInlineSourceElement(nodeElement(range.startContainer)?.closest?.(RICH_INLINE_SOURCE_SELECTOR));
      if (inlineElement && isSameRichInlineEditBlock(inlineElement, block)) {
        const offset = richInlineElementTextOffsetForRange(inlineElement, range);
        const length = normalizeRichText(inlineElement.textContent || '').length;
        if (offset <= 0) {
          inlineElement.before(marker);
          return;
        }
        if (offset >= length) {
          inlineElement.after(marker);
          return;
        }
      }
      range.insertNode(marker);
    }

    function richCaretToken() {
      return `@PME_CARET_${Math.random().toString(36).slice(2)}_${Date.now()}@`;
    }

    function serializeRichInlineEditBlockContent(block) {
      return serializeInlineNodes(richInlineEditBlockContentNodes(block));
    }

    function serializeRichInlineEditBlockContentPreservingCaret(block) {
      return serializeInlineNodesPreservingCaret(richInlineEditBlockContentNodes(block));
    }

    function serializeInlineNodesPreservingCaret(nodes) {
      return nodes.map((node) => serializeInlineNodePreservingCaret(node)).join('').replace(/[ \t]+\n/g, '\n');
    }

    function serializeInlineNodePreservingCaret(node) {
      if (node.nodeType === Node.TEXT_NODE) return String(node.nodeValue || '').replace(/\u00a0/g, ' ').replace(/\u200b/g, '');
      if (node.nodeType !== Node.ELEMENT_NODE) return '';
      const element = node;
      if (element.classList.contains('rich-inline-source')) return normalizeNewlines(element.textContent || '');
      if (element.classList.contains('rich-inline-atom')) return stripRichCaretTokens(element.dataset.inlineSource || serializeInlineChildren(element));
      if (element.classList.contains('rich-list-caret-anchor')) return String(element.textContent || '').replace(/\u200b/g, '');
      if (element.classList.contains('rich-line-break-caret-anchor')) return String(element.textContent || '').replace(/\u200b/g, '');
      if (element.classList.contains('code-language-input') || element.classList.contains('task-checkbox')) return '';
      const tag = element.tagName.toLowerCase();
      if (tag === 'br') return '\n';
      if (tag === 'strong' || tag === 'b') return `**${serializeInlineNodesPreservingCaret(Array.from(element.childNodes)).trim()}**`;
      if (tag === 'em' || tag === 'i') return `*${serializeInlineNodesPreservingCaret(Array.from(element.childNodes)).trim()}*`;
      if (tag === 'del' || tag === 's') return `~~${serializeInlineNodesPreservingCaret(Array.from(element.childNodes)).trim()}~~`;
      if (tag === 'code' && !element.closest('pre')) return markdownCodeSpan(element.textContent || '');
      return serializeInlineNodesPreservingCaret(Array.from(element.childNodes));
    }

    function richInlineEditBlockContentNodes(block) {
      if (!block) return [];
      if (block.tagName?.toLowerCase() !== 'li') return Array.from(block.childNodes);
      return Array.from(block.childNodes).filter((child) => {
        if (child.nodeType !== Node.ELEMENT_NODE) return true;
        const tag = child.tagName?.toLowerCase();
        if (tag === 'ul' || tag === 'ol') return false;
        return !child.classList.contains('task-checkbox');
      });
    }

    function replaceRichInlineEditBlockContent(block, fragment) {
      if (block.tagName?.toLowerCase() !== 'li') {
        block.replaceChildren(fragment);
        ensureRichTextBlockPlaceholder(block);
        return;
      }

      for (const node of richInlineEditBlockContentNodes(block)) node.remove();
      const nestedList = Array.from(block.children).find((child) => ['ul', 'ol'].includes(child.tagName?.toLowerCase()));
      if (nestedList) {
        block.insertBefore(fragment, nestedList);
      } else {
        block.appendChild(fragment);
      }
      ensureListItemEditablePlaceholder(block);
    }

    function restoreCaretFromTextToken(root, token) {
      if (!token) return false;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const index = (node.nodeValue || '').indexOf(token);
        if (index === -1) continue;
        node.nodeValue = (node.nodeValue || '').slice(0, index) + (node.nodeValue || '').slice(index + token.length);
        sanitizeRichCaretTokensInDom(root);
        placeCaretInTextNode(node, index);
        return true;
      }
      const sourceElement = Array.from(root.querySelectorAll('.rich-inline-source, .rich-inline-atom'))
        .find((element) => String(element.dataset.inlineSource || '').includes(token));
      if (sourceElement) {
        const rawSource = String(sourceElement.dataset.inlineSource || '');
        const index = rawSource.indexOf(token);
        const cleaned = stripRichCaretTokens(rawSource);
        sourceElement.dataset.inlineSource = cleaned;
        sanitizeRichCaretTokensInDom(root);
        if (sourceElement.classList.contains('rich-inline-source')) {
          sourceElement.textContent = stripRichCaretTokens(sourceElement.textContent || cleaned);
          placeCaretInInlineSource(sourceElement, Math.max(0, Math.min(index, sourceElement.textContent.length)));
        } else if (index <= 0) {
          placeCaretAtInlineBoundary(sourceElement, 'before');
        } else if (index >= cleaned.length) {
          placeCaretAtInlineBoundary(sourceElement, 'after');
        } else {
          activateRichInlineSource(sourceElement, Math.max(0, Math.min(index, cleaned.length)));
        }
        return true;
      }
      sanitizeRichCaretTokensInDom(root);
      return false;
    }

    function sanitizeRichCaretTokensInDom(root) {
      if (!root) return;
      const textWalker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (textWalker.nextNode()) {
        const node = textWalker.currentNode;
        const cleaned = stripRichCaretTokens(node.nodeValue || '');
        if (cleaned !== node.nodeValue) node.nodeValue = cleaned;
      }

      if (!root.querySelectorAll) return;
      root.querySelectorAll('[data-inline-source], [data-rich-source], [data-mermaid-source], [data-math-source]').forEach((element) => {
        ['inlineSource', 'richSource', 'mermaidSource', 'mathSource'].forEach((key) => {
          if (!Object.prototype.hasOwnProperty.call(element.dataset, key)) return;
          element.dataset[key] = stripRichCaretTokens(element.dataset[key] || '');
        });
      });
    }

    function sanitizeRichCaretTokensInDomPreservingSelection(root) {
      if (!root) return;
      const selection = window.getSelection?.();
      const activeNode = selection?.rangeCount && root.contains(selection.anchorNode)
        ? selection.anchorNode
        : null;
      const activeOffset = selection?.rangeCount ? selection.anchorOffset : 0;
      let nextSelection = null;

      const textWalker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (textWalker.nextNode()) nodes.push(textWalker.currentNode);

      for (const node of nodes) {
        const value = node.nodeValue || '';
        if (!RICH_CARET_TOKEN_PATTERN.test(value)) {
          RICH_CARET_TOKEN_PATTERN.lastIndex = 0;
          continue;
        }
        RICH_CARET_TOKEN_PATTERN.lastIndex = 0;
        const cleaned = stripRichCaretTokens(value);
        if (node === activeNode) {
          nextSelection = {
            node,
            offset: stripRichCaretTokens(value.slice(0, activeOffset)).length,
          };
        }
        node.nodeValue = cleaned;
      }

      sanitizeRichCaretTokensInDom(root);
      if (nextSelection?.node?.isConnected) {
        placeCaretInTextNode(
          nextSelection.node,
          Math.max(0, Math.min(nextSelection.offset, nextSelection.node.nodeValue?.length || 0)),
        );
      }
    }

    function stripRichCaretTokens(value) {
      return String(value || '').replace(RICH_CARET_TOKEN_PATTERN, '');
    }

    function richInlineSourceShouldStayLiteral(source) {
      const text = String(source || '');
      if (!text) return false;
      if (hasAmbiguousStrongDelimiterNeighborhood(text)) return true;
      if (isCompleteSingleRichInlineMarkdownSource(text)) return false;
      return (
        text.startsWith('~~') || text.endsWith('~~')
        || text.startsWith('`') || text.endsWith('`')
        || text.startsWith('$') || text.endsWith('$')
      );
    }

    function isCompleteSingleRichInlineMarkdownSource(source) {
      return Boolean(String(source || '').match(/^(?:!\[[^\]\n]*\]\((?:<[^>\n]+>|[^)\n]+)\)|\[[^\]\n]+\]\((?:<[^>\n]+>|[^)\n]+)\)|`[^`\n]+`|~~[^~\n]+~~|\*\*[^*\n]+?\*\*|__[^_\n]+?__|\*[^*\n]+\*|_[^_\n]+_|\$\$[^\n$]+?\$\$|\$[^\s$][^\n$]*?\$|\\\([^)]+\\\))$/));
    }

    function richInlineSourceFromElement(element) {
      if (!element) return '';
      const atom = element.classList?.contains('rich-inline-atom')
        ? element
        : element.closest?.('.rich-inline-atom');
      if (atom && els.rich.contains(atom)) {
        return stripRichCaretTokens(atom.dataset.inlineSource || serializeInlineChildren(atom));
      }
      const tag = element.tagName?.toLowerCase();
      if (tag === 'strong' || tag === 'b') return `**${serializeInlineChildren(element).trim()}**`;
      if (tag === 'em' || tag === 'i') return `*${serializeInlineChildren(element).trim()}*`;
      if (tag === 'del' || tag === 's') return `~~${serializeInlineChildren(element).trim()}~~`;
      if (tag === 'code' && !element.closest('pre')) return markdownCodeSpan(element.textContent || '');
      if (tag === 'a') return serializeLinkElement(element);
      if (tag === 'img') return serializeImageElement(element);
      if (element.classList?.contains('math-inline')) return serializeMathElement(element);
      if (element.classList?.contains('blocked-image')) return serializeBlockedImageElement(element);
      return '';
    }

    function wrapRenderedInlineAtoms(root) {
      if (!root?.querySelectorAll) return;
      const candidates = Array.from(root.querySelectorAll('strong, b, em, i, del, s, code, a, img, .math-inline, .blocked-image'));
      for (const element of candidates) {
        if (!shouldWrapRichInlineAtom(element)) continue;
        const source = richInlineSourceFromElement(element);
        if (!source) continue;
        const wrapper = document.createElement('span');
        wrapper.className = 'rich-inline-atom';
        wrapper.contentEditable = 'false';
        wrapper.dataset.inlineRun = inlineAtomKind(element);
        wrapper.dataset.kind = wrapper.dataset.inlineRun;
        wrapper.dataset.inlineSource = stripRichCaretTokens(source);
        element.replaceWith(wrapper);
        wrapper.appendChild(element);
      }
    }

    function annotateRenderedInlineAtomRanges(root) {
      if (!root?.querySelectorAll) return;
      const markdown = stripRichCaretTokens(state.markdown || els.source?.value || '');
      const blocks = Array.from(root.querySelectorAll('[data-source-start][data-source-end]'));
      for (const block of blocks) {
        const start = numericData(block, 'sourceStart');
        const end = numericData(block, 'sourceEnd');
        if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) continue;
        const source = markdown.slice(start, end);
        const runs = inlineRunsForBlockSource(source, start);
        if (!runs.length) continue;
        const used = new Set();
        for (const atom of Array.from(block.querySelectorAll('.rich-inline-atom'))) {
          const run = matchingInlineRunForAtom(atom, runs, used);
          if (!run) continue;
          used.add(run);
          atom.dataset.srcStart = String(run.sourceStart);
          atom.dataset.srcEnd = String(run.sourceEnd);
          atom.dataset.contentStart = String(run.contentStart ?? run.sourceStart);
          atom.dataset.contentEnd = String(run.contentEnd ?? run.sourceEnd);
        }
      }
    }

    function matchingInlineRunForAtom(atom, runs, used) {
      const kind = atom.dataset.kind || atom.dataset.inlineRun || '';
      const source = stripRichCaretTokens(atom.dataset.inlineSource || '');
      const text = normalizeRichText(atom.textContent || '');
      const exact = runs.find((run) => !used.has(run) && run.kind === kind && run.source === source);
      if (exact) return exact;
      return runs.find((run) => !used.has(run) && run.kind === kind && normalizeRichText(run.text) === text) || null;
    }

    function inlineRunsForBlockSource(source, baseOffset = 0) {
      const runs = [];
      const text = String(source || '');
      let index = 0;
      while (index < text.length) {
        const run = inlineRunAt(text, index, baseOffset);
        if (!run) {
          index += 1;
          continue;
        }
        runs.push(run);
        index += Math.max(1, run.source.length);
      }
      return runs;
    }

    function inlineRunAt(text, index, baseOffset) {
      const rest = text.slice(index);
      const patterns = [
        { kind: 'image', pattern: /^!\[([^\]\n]*)\]\((<[^>\n]+>|[^)\n]+)\)/, contentGroup: 1 },
        { kind: 'link', pattern: /^\[([^\]\n]+)\]\((<[^>\n]+>|[^)\n]+)\)/, contentGroup: 1 },
        { kind: 'code', pattern: /^`([^`\n]+)`/, contentGroup: 1 },
        { kind: 'del', pattern: /^~~([^~\n]+)~~/, contentGroup: 1 },
        { kind: 'strong', pattern: /^\*\*([^*\n]+?)\*\*/, contentGroup: 1 },
        { kind: 'strong', pattern: /^__([^_\n]+?)__/, contentGroup: 1 },
        { kind: 'math', pattern: /^\$\$([^\n$]+?)\$\$/, contentGroup: 1 },
        { kind: 'math', pattern: /^\$([^\s$][^\n$]*?)\$/, contentGroup: 1 },
        { kind: 'math', pattern: /^\\\(([^)]+)\\\)/, contentGroup: 1 },
      ];
      for (const item of patterns) {
        const match = rest.match(item.pattern);
        if (!match) continue;
        return inlineRunFromMatch(item.kind, match, index, baseOffset, item.contentGroup);
      }

      if (rest[0] === '*' && rest[1] !== '*' && canOpenSingleDelimiterAt(text, index, '*')) {
        const close = rest.indexOf('*', 1);
        if (close > 1 && !rest.slice(1, close).includes('\n')) {
          return inlineRunFromSource('em', rest.slice(0, close + 1), rest.slice(1, close), index, baseOffset, 1);
        }
      }

      if (rest[0] === '_' && rest[1] !== '_' && canOpenSingleDelimiterAt(text, index, '_')) {
        const close = rest.indexOf('_', 1);
        if (close > 1 && !rest.slice(1, close).includes('\n')) {
          return inlineRunFromSource('em', rest.slice(0, close + 1), rest.slice(1, close), index, baseOffset, 1);
        }
      }

      return null;
    }

    function inlineRunFromMatch(kind, match, index, baseOffset, contentGroup) {
      const source = match[0];
      const text = match[contentGroup] || '';
      const contentOffset = source.indexOf(text);
      return inlineRunFromSource(kind, source, text, index, baseOffset, contentOffset);
    }

    function inlineRunFromSource(kind, source, text, index, baseOffset, contentOffset) {
      const sourceStart = baseOffset + index;
      const contentStart = sourceStart + Math.max(0, contentOffset || 0);
      return {
        kind,
        sourceStart,
        sourceEnd: sourceStart + source.length,
        contentStart,
        contentEnd: contentStart + String(text || '').length,
        source,
        text: String(text || ''),
      };
    }

    function shouldWrapRichInlineAtom(element) {
      if (!element) return false;
      if (element.closest('.rich-inline-atom, .rich-inline-source')) return false;
      if (element.closest('.rich-source-editor, .mermaid-diagram, pre, .math-display')) return false;
      if (element.classList?.contains('code-language-input') || element.classList?.contains('task-checkbox')) return false;
      if (element.tagName?.toLowerCase() === 'code' && element.closest('pre')) return false;
      return Boolean(richInlineSourceFromElement(element));
    }

    function inlineAtomKind(element) {
      if (element.classList?.contains('math-inline')) return 'math';
      if (element.classList?.contains('blocked-image')) return 'image';
      const tag = element.tagName?.toLowerCase();
      if (tag === 'strong' || tag === 'b') return 'strong';
      if (tag === 'em' || tag === 'i') return 'em';
      if (tag === 'del' || tag === 's') return 'del';
      if (tag === 'code') return 'code';
      if (tag === 'a') return 'link';
      if (tag === 'img') return 'image';
      return 'text';
    }

    function showRichSourceEditor(kind, element, options = {}) {
      if (!element || element.classList.contains('is-editing-source')) return;
      const source = richSourceFromElement(kind, element);
      const editorValue = options.editorValue ?? richSourceEditorValue(kind, element, source);
      const language = kind === 'code' ? codeLanguageFromPre(element) : '';
      element.classList.add('is-editing-source');
      element.dataset.richSourceKind = kind;
      setRichSourceOnElement(kind, element, source);
      if (kind === 'code') {
        element.dataset.codeLanguage = language;
      }
      element.setAttribute('contenteditable', 'false');
      element.replaceChildren();

      const caption = document.createElement(kind === 'mermaid' ? 'figcaption' : 'div');
      caption.className = 'rich-source-caption';
      caption.textContent = richSourceTitle(kind);
      const hint = document.createElement('span');
      hint.textContent = 'Ctrl+Enterで反映';
      caption.appendChild(hint);

      const textarea = document.createElement('textarea');
      textarea.className = 'rich-source-editor';
      textarea.value = editorValue;
      textarea.spellcheck = false;
      textarea.autocomplete = 'off';
      textarea.autocapitalize = 'off';
      textarea.setAttribute('aria-label', `${richSourceTitle(kind)}ソース編集`);

      const actions = document.createElement('div');
      actions.className = 'rich-source-actions';
      actions.innerHTML = [
        '<button type="button" data-source-action="cancel">キャンセル</button>',
        '<button type="button" data-source-action="apply">反映</button>',
      ].join('');

      if (kind === 'code') {
        element.appendChild(createCodeLanguageInput(language));
      }
      element.appendChild(caption);
      element.appendChild(textarea);
      element.appendChild(actions);

      textarea.addEventListener('click', (event) => event.stopPropagation());
      textarea.addEventListener('keydown', (event) => {
        event.stopPropagation();
        if ((event.ctrlKey || event.metaKey) && isEnterKey(event)) {
          event.preventDefault();
          applyRichSourceEditor(kind, element, textarea.value);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          renderRich();
        }
      });
      actions.addEventListener('click', (event) => {
        event.stopPropagation();
        const action = event.target.closest('[data-source-action]')?.dataset.sourceAction;
        if (action === 'apply') applyRichSourceEditor(kind, element, textarea.value);
        if (action === 'cancel') renderRich();
      });

      textarea.focus();
      if (Number.isInteger(options.caretOffset)) {
        textarea.setSelectionRange(options.caretOffset, options.caretOffset);
      } else {
        textarea.setSelectionRange(0, textarea.value.length);
      }
    }

    function richSourceEditorValue(kind, element, source) {
      if (kind === 'math' && element.getAttribute('data-math-display') === 'true') {
        return `$$${source}$$`;
      }
      return source;
    }

    function createCodeLanguageInput(language) {
      const input = document.createElement('input');
      input.className = 'code-language-input';
      input.type = 'text';
      input.setAttribute('list', 'codeLanguageOptions');
      input.spellcheck = false;
      input.autocomplete = 'off';
      input.setAttribute('autocapitalize', 'off');
      input.setAttribute('contenteditable', 'false');
      input.setAttribute('aria-label', 'コードブロックの言語');
      input.placeholder = 'text';
      input.value = safeCodeLanguage(language);
      return input;
    }

    function applyRichSourceEditor(kind, element, source) {
      if (kind === 'code') {
        element.dataset.codeLanguage = codeLanguageFromPre(element);
      }
      if (kind === 'math') {
        source = normalizeMathEditorSource(source);
        element.setAttribute('data-math-display', 'true');
      }
      setRichSourceOnElement(kind, element, source);
      const sourceTransaction = richSourceBlockTransaction(kind, element, source);
      if (sourceTransaction) {
        applySourceTransaction(sourceTransaction, `${kind}-source`);
      } else {
        if (element.matches?.(RICH_SOURCE_BLOCK_SELECTOR)) {
          renderAll(`${kind}-source-revert`);
          setStatus(`${richSourceTitle(kind)}ソースを反映できませんでした`);
          return;
        }
        syncRichMarkdownFromDom(`${kind}-source`, { refreshRich: true });
      }
      setStatus(`${richSourceTitle(kind)}ソースを反映しました`);
    }

    function richSourceBlockTransaction(kind, element, source) {
      const start = numericData(element, 'sourceStart');
      const end = numericData(element, 'sourceEnd');
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) return null;
      const markdown = stripRichCaretTokens(state.markdown || els.source.value || '');
      if (end > markdown.length) return null;
      let replacement = '';
      if (kind === 'mermaid') {
        replacement = serializeMermaidDiagram(element);
      } else if (kind === 'code') {
        replacement = serializePreElement(element);
      } else if (kind === 'math') {
        replacement = serializeMathElement(element);
      } else {
        replacement = normalizeNewlines(source);
      }
      if (!replacement) return null;
      return {
        from: start,
        to: end,
        insert: replacement,
        selectionAfter: {
          anchor: start + replacement.length,
          focus: start + replacement.length,
          affinity: 'after',
        },
      };
    }

    function normalizeMathEditorSource(source) {
      const value = normalizeNewlines(source).trim();
      if (value.startsWith('$$') && value.endsWith('$$') && value.length >= 4) return value.slice(2, -2);
      if (value.startsWith('\\[') && value.endsWith('\\]') && value.length >= 4) return value.slice(2, -2);
      if (value.startsWith('$') && value.endsWith('$') && value.length >= 2) return value.slice(1, -1);
      if (value.startsWith('\\(') && value.endsWith('\\)') && value.length >= 4) return value.slice(2, -2);
      return value;
    }

    function richSourceFromElement(kind, element) {
      if (kind === 'mermaid') return mermaidSourceFromFigure(element);
      if (kind === 'code') return codeSourceFromPre(element);
      if (kind === 'math') {
        const editor = element.querySelector('.rich-source-editor');
        if (editor) return normalizeMathEditorSource(editor.value);
        if (Object.prototype.hasOwnProperty.call(element.dataset, 'richSource')) return element.dataset.richSource;
        const attrSource = element.getAttribute('data-math-source');
        if (attrSource !== null) return attrSource;
        return element.querySelector('.rich-source-editor')?.value || '';
      }
      return element.dataset.richSource || '';
    }

    function setRichSourceOnElement(kind, element, source) {
      const value = normalizeNewlines(source);
      element.dataset.richSource = value;
      if (kind === 'mermaid') element.dataset.mermaidSource = value;
      if (kind === 'math') element.setAttribute('data-math-source', value);
    }

    function richSourceTitle(kind) {
      if (kind === 'mermaid') return 'Mermaid';
      if (kind === 'code') return 'コード';
      if (kind === 'math') return '数式';
      return 'ソース';
    }

    function mermaidSourceFromFigure(figure) {
      return figure.dataset.richSource
        || figure.dataset.mermaidSource
        || figure.querySelector('.mermaid-render-target')?.getAttribute('data-mermaid-source')
        || figure.querySelector('code')?.textContent
        || '';
    }

    function codeSourceFromPre(pre) {
      return pre.querySelector('.rich-source-editor')?.value
        || pre.dataset.richSource
        || pre.querySelector('code')?.textContent
        || '';
    }

    function codeLanguageFromPre(pre) {
      const input = Array.from(pre.children).find((child) => child.classList?.contains('code-language-input'));
      const code = pre.querySelector('code');
      return safeCodeLanguage(input?.value || pre.dataset.codeLanguage || code?.dataset.lang || '');
    }

    function syncRichMarkdownFromDom(reason, options = {}) {
      if (repairRichLineBreakCaretDomSync(reason)) return;
      sanitizeRichCaretTokensInDom(els.rich);
      const serialized = stripRichCaretTokens(serializeRichMarkdown(els.rich));
      const shortcutNormalized = normalizeSyncedMarkdownShortcuts(serialized);
      state.markdown = shortcutNormalized.markdown;
      els.source.value = state.markdown;
      syncCodeMirrorSourceFromTextarea(reason);
      markDirty();
      if (shortcutNormalized.changed) setStatus(shortcutNormalized.status || 'Markdown入力を変換しました');
      if (options.refreshRich || shortcutNormalized.changed) {
        renderAll(reason || 'rich-edit');
      } else {
        refreshRichSourceRangesFromMarkdown();
        scheduleRender('rich-input');
        if (options.reparseRich) scheduleRichReparse();
      }
      scheduleAutosave();
    }

    function repairRichLineBreakCaretDomSync(reason) {
      const anchor = els.rich?.querySelector?.('.rich-line-break-caret-anchor[data-source-offset]');
      const offset = state.richLineBreakInputOffset !== null && Number.isFinite(Number(state.richLineBreakInputOffset))
        ? Number(state.richLineBreakInputOffset)
        : Number(anchor?.dataset?.sourceOffset);
      if (!Number.isFinite(offset)) return false;
      const markdown = stripRichCaretTokens(state.markdown || els.source.value || '');
      if (offset <= 0 || offset > markdown.length || markdown[offset - 1] !== '\n') return false;
      const block = renderedBlockForSourceOffset(els.rich, offset);
      if (!block) return false;
      const insert = richLineBreakCaretInputText(null, block, markdown);
      if (!insert || insert.includes('\n')) return false;
      state.richLineBreakInputOffset = null;
      applySourceTransaction({
        from: offset,
        to: offset,
        insert,
        selectionAfter: {
          anchor: offset + insert.length,
          focus: offset + insert.length,
          affinity: 'after',
        },
      }, reason || 'rich-line-break-caret-sync');
      return true;
    }

    function normalizeSyncedMarkdownShortcuts(markdown) {
      const source = stripRichCaretTokens(markdown || '');
      const blocks = buildBlockModel(source);
      for (let index = blocks.length - 1; index >= 0; index -= 1) {
        const block = blocks[index];
        if (block.type !== 'paragraph') continue;
        const replacement = richBlockMarkdownTriggerReplacement(block.raw, { allowBareMath: false });
        if (!replacement) continue;
        return {
          markdown: source.slice(0, block.start) + replacement.insert + source.slice(block.end),
          changed: true,
          status: replacement.status,
        };
      }
      return { markdown: source, changed: false, status: '' };
    }

    function refreshRichSourceRangesFromMarkdown() {
      if (state.mode !== 'rich' || !els.rich) return false;
      const blocks = buildBlockModel(state.markdown);
      const rendered = Array.from(els.rich.children).filter((child) => child.matches?.(RICH_SOURCE_BLOCK_SELECTOR));
      if (blocks.length !== rendered.length) return false;
      rendered.forEach((element, index) => {
        const block = blocks[index];
        element.dataset.blockId = block.id;
        element.dataset.blockType = block.type;
        element.dataset.sourceStart = String(block.start);
        element.dataset.sourceEnd = String(block.end);
      });
      annotateRenderedInlineAtomRanges(els.rich);
      return true;
    }

    function serializeRichMarkdown(root) {
      const blocks = Array.from(root.childNodes)
        .map((node) => serializeBlockNode(node))
        .map((block) => block.trimEnd())
        .filter((block) => block.trim() !== '');
      return normalizeNewlines(blocks.join('\n\n')).replace(/\n{3,}/g, '\n\n').trimEnd();
    }

    function serializeBlockNode(node) {
      if (node.nodeType === 3) return normalizeRichText(node.nodeValue || '').trim();
      if (node.nodeType !== 1) return '';

      const element = node;
      if (element.classList.contains('toc')) return '[toc]';
      if (element.classList.contains('mermaid-diagram')) return serializeMermaidDiagram(element);
      if (element.classList.contains('math-display')) return serializeMathElement(element);
      if (element.classList.contains('math-inline')) return serializeMathElement(element);
      if (element.classList.contains('blocked-image') && element.getAttribute('data-markdown-src')) return serializeBlockedImageElement(element);

      const tag = element.tagName.toLowerCase();
      if (/^h[1-6]$/.test(tag)) return `${'#'.repeat(Number(tag[1]))} ${serializeInlineChildren(element).trim()}`;
      if (tag === 'p') return serializeInlineChildren(element).trim();
      if (tag === 'pre') return serializePreElement(element);
      if (tag === 'blockquote') return serializeQuoteElement(element);
      if (tag === 'ul' || tag === 'ol') return serializeListElement(element);
      if (tag === 'table') return serializeTableElement(element);
      if (tag === 'hr') return '---';
      if (tag === 'img') return serializeImageElement(element);
      if (tag === 'br') return '';

      const blockText = serializeBlockChildren(element);
      if (blockText) return blockText;
      return serializeInlineChildren(element).trim();
    }

    function serializeBlockChildren(element) {
      return Array.from(element.childNodes)
        .map((child) => serializeBlockNode(child))
        .map((block) => block.trimEnd())
        .filter((block) => block.trim() !== '')
        .join('\n\n');
    }

    function serializeInlineChildren(element) {
      return serializeInlineNodes(Array.from(element.childNodes));
    }

    function serializeQuoteElement(blockquote) {
      const source = serializeInlineNodes(Array.from(blockquote.childNodes)).replace(/^[ \t]+|[ \t]+$/g, '');
      const serialized = source ? prefixLines(source, '> ') : '>';
      const start = numericData(blockquote, 'sourceStart');
      const end = numericData(blockquote, 'sourceEnd');
      if (Number.isFinite(start) && Number.isFinite(end)) {
        const previousSource = blockquote.dataset.richQuoteHardBreakSource
          || stripRichCaretTokens(state.markdown || '').slice(start, end);
        const repair = richQuoteHardBreakDomRepair(blockquote, previousSource, serialized);
        if (repair) return repair.insert;
      }
      return serialized;
    }

    function serializeInlineNodes(nodes) {
      return nodes.map((node) => serializeInlineNode(node)).join('').replace(/[ \t]+\n/g, '\n');
    }

    function serializeTableCellInlineNodes(nodes) {
      return nodes.map((node) => serializeTableCellInlineNode(node)).join('');
    }

    function serializeTableCellElement(cell) {
      const nodes = Array.from(cell?.childNodes || []);
      if (nodes.every((node) => node.nodeType === 1 && node.tagName?.toLowerCase() === 'br')) return '';
      return serializeTableCellInlineNodes(nodes).replace(/^[ \t]+|[ \t]+$/g, '');
    }

    function serializeTableCellInlineNode(node) {
      if (node.nodeType === 3) return escapeMarkdownTableCell(normalizeRichText(node.nodeValue || ''));
      if (node.nodeType !== 1) return '';

      const element = node;
      if (element.tagName?.toLowerCase() === 'br') return '<br>';
      return escapeMarkdownTableCell(serializeInlineNode(element));
    }

    function serializeInlineNode(node) {
      if (node.nodeType === 3) return normalizeRichText(node.nodeValue || '');
      if (node.nodeType !== 1) return '';

      const element = node;
      if (element.classList.contains('rich-inline-source')) return stripRichCaretTokens(normalizeNewlines(element.textContent || ''));
      if (element.classList.contains('rich-inline-atom')) return stripRichCaretTokens(element.dataset.inlineSource || serializeInlineChildren(element));
      if (element.classList.contains('rich-list-caret-anchor')) return normalizeRichText(element.textContent || '').replace(/\u200b/g, '');
      if (element.classList.contains('rich-line-break-caret-anchor')) return normalizeRichText(element.textContent || '').replace(/\u200b/g, '');
      if (element.classList.contains('math-inline') || element.classList.contains('math-display')) return serializeMathElement(element);
      if (element.classList.contains('blocked-image') && element.getAttribute('data-markdown-src')) {
        return serializeBlockedImageElement(element);
      }
      if (element.classList.contains('code-language-input') || element.classList.contains('task-checkbox')) return '';

      const tag = element.tagName.toLowerCase();
      if (tag === 'br') return '\n';
      if (tag === 'strong' || tag === 'b') return `**${serializeInlineChildren(element).trim()}**`;
      if (tag === 'em' || tag === 'i') return `*${serializeInlineChildren(element).trim()}*`;
      if (tag === 'del' || tag === 's') return `~~${serializeInlineChildren(element).trim()}~~`;
      if (tag === 'code' && !element.closest('pre')) return markdownCodeSpan(element.textContent || '');
      if (tag === 'a') return serializeLinkElement(element);
      if (tag === 'img') return serializeImageElement(element);
      if (tag === 'div' || tag === 'p') return serializeInlineChildren(element).trim();
      return serializeInlineChildren(element);
    }

    function serializeListElement(list, depth = 0) {
      const ordered = list.tagName.toLowerCase() === 'ol';
      const indent = '  '.repeat(depth);
      const items = Array.from(list.children).filter((child) => child.tagName?.toLowerCase() === 'li');
      return items.map((item, itemIndex) => {
        const nestedLists = Array.from(item.children).filter((child) => ['ul', 'ol'].includes(child.tagName?.toLowerCase()));
        const contentNodes = Array.from(item.childNodes).filter((child) => {
          if (child.nodeType !== 1) return true;
          const childElement = child;
          if (['ul', 'ol'].includes(childElement.tagName.toLowerCase())) return false;
          return !childElement.classList.contains('task-checkbox');
        });
        const checkbox = Array.from(item.children).find((child) => child.classList?.contains('task-checkbox'));
        const taskPrefix = checkbox ? `[${checkbox.checked ? 'x' : ' '}] ` : '';
        const marker = ordered ? `${itemIndex + 1}.` : '-';
        const lines = serializeInlineNodes(contentNodes)
          .split('\n')
          .map((line) => normalizeListItemSourceLine(line))
          .filter((line) => line !== '');
        const text = lines.shift() || ' ';
        const continuation = lines.map((line) => `${indent}  ${line}`).join('\n');
        const nested = nestedLists.map((child) => serializeListElement(child, depth + 1)).filter(Boolean).join('\n');
        return `${indent}${marker} ${taskPrefix}${text}${continuation ? `\n${continuation}` : ''}${nested ? `\n${nested}` : ''}`;
      }).join('\n');
    }

    function normalizeListItemSourceLine(line) {
      const value = String(line || '').trimStart();
      if (/[ \t]{2}$/.test(value)) return value.replace(/[ \t]+$/, '  ');
      return value.trimEnd();
    }

    function serializePreElement(pre) {
      const language = codeLanguageFromPre(pre);
      const text = normalizeNewlines(codeSourceFromPre(pre)).replace(/\n$/, '');
      return `\`\`\`${language}\n${text}\n\`\`\``;
    }

    function serializeTableElement(table) {
      const rows = Array.from(table.querySelectorAll('tr'));
      if (!rows.length) return '';
      const firstRowCells = Array.from(rows[0].children);
      const headers = firstRowCells.map((cell) => serializeTableCellElement(cell));
      const separator = headers.map(() => '---');
      const bodyRows = rows.slice(1).map((row) => {
        const cells = Array.from(row.children).map((cell) => serializeTableCellElement(cell));
        return `| ${cells.join(' | ')} |`;
      });
      return [`| ${headers.join(' | ')} |`, `| ${separator.join(' | ')} |`, ...bodyRows].join('\n');
    }

    function serializeLinkElement(link) {
      const label = serializeInlineChildren(link).trim();
      const href = link.getAttribute('data-markdown-href') || link.getAttribute('href') || '';
      const safe = sanitizeLinkUrl(href);
      return safe ? `[${escapeMarkdownLabel(label)}](${formatMarkdownTarget(href)})` : label;
    }

    function serializeImageElement(image) {
      const src = image.getAttribute('data-markdown-src') || image.getAttribute('src') || '';
      const alt = image.getAttribute('alt') || '画像';
      return sanitizeImageUrl(src) ? `![${escapeMarkdownLabel(alt)}](${formatMarkdownTarget(src)})` : escapeMarkdownLabel(alt);
    }

    function serializeBlockedImageElement(element) {
      const src = element.getAttribute('data-markdown-src') || '';
      const alt = element.getAttribute('data-markdown-alt') || '画像';
      return `![${escapeMarkdownLabel(alt)}](${formatMarkdownTarget(src)})`;
    }

    function serializeMermaidDiagram(figure) {
      const source = mermaidSourceFromFigure(figure);
      return source ? `\`\`\`mermaid\n${normalizeNewlines(source).trim()}\n\`\`\`` : '';
    }

    function serializeMathElement(element) {
      const source = richSourceFromElement('math', element);
      if (!source) return element.getAttribute('data-math-display') === 'true' ? '$$$$' : '$$';
      return element.getAttribute('data-math-display') === 'true' ? `$$${source}$$` : `$${source}$`;
    }

    function normalizeRichText(value) {
      return stripRichCaretTokens(String(value || '')).replace(/\u00a0/g, ' ').replace(/\u200b/g, '');
    }

    function markdownCodeSpan(value) {
      const text = String(value || '');
      const fence = text.includes('`') ? '``' : '`';
      return `${fence}${text}${fence}`;
    }

    function escapeMarkdownLabel(value) {
      return String(value || '').replace(/[\[\]\r\n]/g, ' ').trim();
    }

    function escapeMarkdownTableCell(value) {
      return String(value || '').replace(/\|/g, '\\|').replace(/\n+/g, '<br>');
    }

    return {
      activateRichInlineSource,
      annotateRenderedInlineAtomRanges,
      commitRichInlineSource,
      domPointToSourceOffset,
      domSelectionToSourceSelection,
      escapeMarkdownLabel,
      escapeMarkdownTableCell,
      finalizeRichProjectionChange,
      getRichCaretBookmark,
      guardFailedRichSourceControlTransaction,
      normalizeRichText,
      placeCaretInInlineSource,
      refreshRichSourceRangesFromMarkdown,
      removeRichTaskCheckboxTransaction,
      renderedBlockForSourceOffset,
      renderRichInlineSourceFragment,
      repairRichLineBreakCaretDomSync,
      reparseRichInlineEditBlockContent,
      restoreRichCaret,
      restoreRichCaretFromSourceSelection,
      richCaretToken,
      richSourceFromElement,
      richSourceTitle,
      sanitizeRichCaretTokensInDomPreservingSelection,
      serializeBlockNode,
      serializeInlineChildren,
      serializeInlineNodes,
      serializeRichInlineEditBlockContent,
      serializeRichMarkdown,
      serializeTableCellInlineNode,
      serializeTableCellInlineNodes,
      showRichSourceEditor,
      sourceContentBaseOffset,
      stripRichCaretTokens,
      syncRichMarkdownFromDom,
      updateCodeBlockLanguage,
      updateTaskCheckbox,
      wrapRenderedInlineAtoms,
    };
  }

  window.PMERichEditor = Object.freeze({ createRichEditor });
})();

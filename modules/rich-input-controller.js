(() => {
  'use strict';

  function createRichInputController(options = {}) {
    const state = options.state;
    const els = options.els;
    const constants = options.constants || {};
    const dependencies = options.dependencies || {};
    if (!state || !els) throw new Error('Rich input controller requires state and element references');

    const {
      MAX_RICH_UNDO_STEPS,
      RICH_ATOMIC_SOURCE_BLOCK_SELECTOR,
      RICH_INLINE_EDIT_BLOCK_SELECTOR,
      RICH_INLINE_SOURCE_SELECTOR,
      RICH_SOURCE_BLOCK_SELECTOR,
    } = constants;
    const {
      activateInsertedInlineSource,
      activateRichInlineSource,
      adjacentCaretNode,
      adjacentDomNode,
      annotateRenderedBlockHtml,
      annotateRenderedInlineAtomRanges,
      applyFormat,
      buildBlockModel,
      buildHeadingIndex,
      captureShortcutAssignment,
      cleanupRichCaretBoundaryMarkers,
      commitRichInlineSource,
      configureRichEditableSurface,
      createImageInsertionContext,
      domPointToSourceOffset,
      domSelectionToSourceSelection,
      ensureRichTrailingEditableParagraph,
      enhanceRenderedHtml,
      escapeMarkdownTableCell,
      eventTargetElement,
      finalizeRichProjectionChange,
      getLines,
      getRichCaretBookmark,
      guardFailedRichSourceControlTransaction,
      hasImageFiles,
      imageFilesFromClipboard,
      imageFilesFromDataTransfer,
      insertCodeBlock,
      insertImageFilesAsAssets,
      insertLink,
      insertMathBlock,
      insertMermaid,
      isEmptyRichParagraph,
      isProseMirrorRichActive,
      isProseMirrorRichEventContext,
      isProseMirrorRichTarget,
      isRichCaretBoundaryMarker,
      isSameRichInlineEditBlock,
      markDirty,
      nodeClosest,
      nodeElement,
      normalizeNewlines,
      normalizeRichText,
      numericData,
      newDocument,
      openMarkdownFile,
      parsePendingRichMathShortcutInBlock,
      placeCaretInInlineSource,
      printPreview,
      requestDesktopCommand,
      refreshRichSourceRangesFromMarkdown,
      removeRichTaskCheckboxTransaction,
      renderAll,
      renderBlockHtml,
      renderOutline,
      renderPreview,
      renderedBlockForSourceOffset,
      renderRichInlineSourceFragment,
      repairRichLineBreakCaretDomSync,
      reparseRichInlineEditBlockContent,
      restoreRichCaret,
      restoreRichCaretFromSourceSelection,
      richCaretToken,
      richInlineEditBlockForRange,
      richInlineSourceFromEventContext,
      richPendingMathShortcutBlockFromRange,
      richSourceFromElement,
      richTopLevelBlock,
      sanitizeRichCaretTokensInDomPreservingSelection,
      saveMarkdown,
      scheduleAutosave,
      scheduleRender,
      serializeBlockNode,
      serializeInlineChildren,
      serializeInlineNodes,
      serializeRichInlineEditBlockContent,
      serializeRichMarkdown,
      serializeTableCellInlineNode,
      serializeTableCellInlineNodes,
      setStatus,
      shortcutActionForEvent,
      showRichSourceEditor,
      sourceContentBaseOffset,
      stripRichCaretTokens,
      syncCodeMirrorSourceFromTextarea,
      syncRichMarkdownFromDom,
      toggleOutline,
      updateCodeBlockLanguage,
      updateStatusBar,
      validRichInlineSourceElement,
      wrapRenderedInlineAtoms,
    } = dependencies;

    function onRichInput(event) {
      if (isProseMirrorRichTarget(eventTargetElement(event))) return;
      sanitizeRichCaretTokensInDomPreservingSelection(els.rich);
      if (event.target?.closest?.('.task-checkbox, .code-language-input, .rich-source-editor')) return;
      const inlineSource = richInlineSourceFromEventContext(event);
      if (inlineSource) {
        syncActiveRichInlineSourceMarkdown(inlineSource, 'rich-inline-source-input');
        cleanupRichCaretBoundaryMarkers({ preserveSelection: true });
        return;
      }
      if (repairRichLineBreakCaretInput(event)) {
        cleanupRichCaretBoundaryMarkers({ preserveSelection: true });
        return;
      }
      if (!state.richUndoRestoring && event?.isTrusted) {
        if (state.richUndoPreserveNextInput) {
          state.richUndoPreserveNextInput = false;
        } else {
          clearRichUndoStack();
        }
      }
      let handledBySourceTransaction = false;
      state.richInputUsedSourceTransaction = false;
      maybeApplyRichMarkdownTrigger(event);
      handledBySourceTransaction = state.richInputUsedSourceTransaction;
      state.richInputUsedSourceTransaction = false;
      if (!handledBySourceTransaction) {
        if (!applyRichSourceBackedDomTransaction(event, 'rich-input-source-fallback')) {
          if (!guardUnsupportedRichSourceBackedDomSync(event, 'rich-input-source-fallback')) {
            syncRichMarkdownFromDom('rich-input');
            if (!applySyncedRichBlockMarkdownShortcutAfterInput()) {
              applySyncedMarkdownShortcutFromSource();
            }
          }
        } else if (!applySyncedRichBlockMarkdownShortcutAfterInput()) {
          applySyncedMarkdownShortcutFromSource();
        }
        scheduleSyncedMarkdownShortcutFromSource();
      }
      cleanupRichCaretBoundaryMarkers({ preserveSelection: true });
    }

    function onRichCompositionEnd(event) {
      state.richComposing = false;
      if (isProseMirrorRichTarget(eventTargetElement(event))) return;
      if (event.target?.closest?.('.rich-source-editor, .code-language-input')) return;
      const inlineSource = richInlineSourceFromEventContext(event);
      if (inlineSource) {
        syncActiveRichInlineSourceMarkdown(inlineSource, 'rich-inline-source-composition');
        cleanupRichCaretBoundaryMarkers({ preserveSelection: true });
        return;
      }
      if (repairRichLineBreakCaretDomSync('rich-composition')) {
        cleanupRichCaretBoundaryMarkers({ preserveSelection: true });
        return;
      }
      if (applyRichSourceBackedDomTransaction(event, 'rich-composition')) {
        cleanupRichCaretBoundaryMarkers({ preserveSelection: true });
        return;
      }
      if (guardUnsupportedRichSourceBackedDomSync(event, 'rich-composition')) {
        cleanupRichCaretBoundaryMarkers({ preserveSelection: true });
        return;
      }
      syncRichMarkdownFromDom('rich-input');
      cleanupRichCaretBoundaryMarkers({ preserveSelection: true });
    }

    function applyRichSourceBackedDomTransaction(event, reason = 'rich-input-source-fallback') {
      const sourceBlock = richSourceBackedDomBlock(event);
      if (!sourceBlock) return false;
      const start = numericData(sourceBlock, 'sourceStart');
      const end = numericData(sourceBlock, 'sourceEnd');
      const markdown = stripRichCaretTokens(state.markdown || els.source.value || '');
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || end > markdown.length) {
        renderAll(`${reason}-revert`);
        setStatus('この入力をMarkdownソースへ反映できませんでした');
        return true;
      }

      const insert = stripRichCaretTokens(serializeSourceBackedDomBlockNode(sourceBlock));
      if (!insert && sourceBlock.textContent?.trim()) {
        renderAll(`${reason}-revert`);
        setStatus('この入力をMarkdownソースへ反映できませんでした');
        return true;
      }
      const shortcut = richSourceBackedDomShortcutReplacement(sourceBlock, start, end, insert, reason);
      if (shortcut) {
        applySourceTransaction({
          from: start,
          to: end,
          insert: shortcut.insert,
          selectionAfter: shortcut.selectionAfter,
          blankParagraphAt: shortcut.blankParagraphAt,
        }, `rich-markdown-trigger-${shortcut.kind}`);
        finishRichBlockMarkdownTriggerReplacement(shortcut, start, shortcut.insert.length);
        suppressRichInlineActivation();
        return true;
      }
      if (markdown.slice(start, end) === insert) {
        refreshRichSourceRangesFromMarkdown();
        scheduleRender(reason);
        return true;
      }
      const quoteHardBreakRepair = richQuoteHardBreakDomRepair(sourceBlock, markdown.slice(start, end), insert);
      if (quoteHardBreakRepair) {
        applySourceTransaction({
          from: start,
          to: end,
          insert: quoteHardBreakRepair.insert,
          selectionAfter: {
            anchor: start + quoteHardBreakRepair.selectionOffset,
            focus: start + quoteHardBreakRepair.selectionOffset,
            affinity: 'after',
          },
        }, `${reason}-quote-hard-break`);
        suppressRichInlineActivation();
        return true;
      }

      const previousSource = markdown.slice(start, end);
      const selectionAfter = richSourceBackedDomSelectionAfter(sourceBlock, start, previousSource, insert);
      applySourceTransaction({
        from: start,
        to: end,
        insert,
        selectionAfter,
      }, reason);
      suppressRichInlineActivation();
      return true;
    }

    function richQuoteHardBreakDomRepair(sourceBlock, previousSource, domSource) {
      if (!sourceBlock?.matches?.('blockquote')) return null;
      const before = String(previousSource || '');
      const after = String(domSource || '');
      const beforeLines = before.split('\n');
      const afterLines = after.split('\n');
      if (beforeLines.length < 2 || afterLines.length < 2) return null;
      const beforeLast = beforeLines[beforeLines.length - 1] || '';
      const afterLast = afterLines[afterLines.length - 1] || '';
      if (!/^\s*>\s?$/.test(beforeLast) || !/^\s*>\s?$/.test(afterLast)) return null;
      const beforePrevious = String(beforeLines[beforeLines.length - 2] || '').replace(/^\s*>\s?/, '');
      const afterPrevious = String(afterLines[afterLines.length - 2] || '').replace(/^\s*>\s?/, '');
      if (!/[ \t]{2}$/.test(beforePrevious)) return null;
      const visibleBeforeBreak = beforePrevious.replace(/[ \t]{2}$/, '');
      if (!afterPrevious.startsWith(visibleBeforeBreak)) return null;
      const inserted = afterPrevious.slice(visibleBeforeBreak.length).replace(/[ \t]+$/, '').trimStart();
      if (!inserted || inserted.includes('\n')) return null;
      const repairedInsert = `${before}${markdownQuoteTextFromPlainText(inserted)}`;
      return {
        insert: repairedInsert,
        selectionOffset: repairedInsert.length,
      };
    }

    function richSourceBackedDomShortcutReplacement(sourceBlock, start, end, insert, reason) {
      if (!['rich-input-source-fallback', 'rich-composition'].includes(reason)) return null;
      if (sourceBlock?.tagName?.toLowerCase() !== 'p' || sourceBlock.closest('li')) return null;
      const sourceText = normalizeRichText(sourceBlock.textContent || insert);
      const replacement = richBlockMarkdownTriggerReplacement(sourceText, { allowBareMath: false });
      if (!replacement) return null;
      const selectionOffset = start + (Number.isFinite(replacement.selectionOffset)
        ? replacement.selectionOffset
        : replacement.insert.length);
      return {
        ...replacement,
        from: start,
        to: end,
        selectionAfter: {
          anchor: selectionOffset,
          focus: selectionOffset,
          affinity: 'after',
        },
        blankParagraphAt: replacement.blankParagraphAt ? start + replacement.insert.length : undefined,
      };
    }

    function serializeSourceBackedDomBlockNode(sourceBlock) {
      if (sourceBlock?.tagName?.toLowerCase() === 'p') {
        return serializeInlineChildren(sourceBlock);
      }
      return serializeBlockNode(sourceBlock);
    }

    function richSourceBackedDomBlock(event) {
      const selection = window.getSelection?.();
      const nodes = [
        eventTargetElement(event),
        selection?.anchorNode,
        selection?.focusNode,
      ].filter(Boolean);
      for (const node of nodes) {
        if (nodeClosest(node, '.rich-inline-source, .rich-source-editor, .code-language-input')) return null;
        const sourceBlock = nodeClosest(node, RICH_SOURCE_BLOCK_SELECTOR);
        if (sourceBlock && els.rich.contains(sourceBlock)) return richTopLevelBlock(sourceBlock) || sourceBlock;
      }
      return null;
    }

    function guardUnsupportedRichSourceBackedDomSync(event, reason = 'rich-input-source-fallback') {
      const selection = window.getSelection?.();
      const target = eventTargetElement(event);
      const nodes = [target, selection?.anchorNode, selection?.focusNode].filter(Boolean);
      if (nodes.some((node) => nodeClosest(node, '.rich-inline-source, .rich-source-editor, .code-language-input'))) return false;
      const touchesSource = nodes.some((node) => {
        const sourceBlock = nodeClosest(node, RICH_SOURCE_BLOCK_SELECTOR);
        return Boolean(sourceBlock && els.rich.contains(sourceBlock));
      }) || richSelectionTouchesSourceBlock(selection);
      if (!touchesSource) return false;
      renderAll(`${reason}-revert`);
      setStatus('この入力をMarkdownソースへ反映できませんでした');
      suppressRichInlineActivation();
      return true;
    }

    function richSourceBackedDomSelectionAfter(sourceBlock, start, previousSource, nextSource) {
      const diffOffset = sourceOffsetAfterTextChange(previousSource, nextSource);
      if (Number.isFinite(diffOffset)) {
        return {
          anchor: start + diffOffset,
          focus: start + diffOffset,
          affinity: 'after',
        };
      }

      const selection = window.getSelection?.();
      const point = selection?.rangeCount && els.rich.contains(selection.anchorNode)
        ? domPointToSourceOffset(selection.anchorNode, selection.anchorOffset)
        : null;
      const insertLength = String(nextSource || '').length;
      const localOffset = Number.isFinite(point?.offset)
        ? Math.max(0, Math.min(insertLength, point.offset - start))
        : insertLength;
      return {
        anchor: start + localOffset,
        focus: start + localOffset,
        affinity: point?.affinity || 'after',
      };
    }

    function sourceOffsetAfterTextChange(previousSource, nextSource) {
      const before = String(previousSource || '');
      const after = String(nextSource || '');
      if (before === after) return NaN;
      let prefix = 0;
      const maxPrefix = Math.min(before.length, after.length);
      while (prefix < maxPrefix && before[prefix] === after[prefix]) prefix += 1;

      let suffix = 0;
      const maxSuffix = Math.min(before.length - prefix, after.length - prefix);
      while (
        suffix < maxSuffix
        && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
      ) {
        suffix += 1;
      }
      return after.length - suffix;
    }

    function repairRichLineBreakCaretInput(event) {
      const selection = window.getSelection?.();
      const activeAnchor = nodeClosest(selection?.anchorNode, '.rich-line-break-caret-anchor')
        || eventTargetElement(event)?.closest?.('.rich-line-break-caret-anchor')
        || els.rich.querySelector('.rich-line-break-caret-anchor[data-source-offset]');
      const offset = state.richLineBreakInputOffset !== null && Number.isFinite(Number(state.richLineBreakInputOffset))
        ? Number(state.richLineBreakInputOffset)
        : Number(activeAnchor?.dataset?.sourceOffset);
      if (!Number.isFinite(offset)) return false;
      if (event?.inputType && !String(event.inputType).startsWith('insert')) return false;
      const markdown = stripRichCaretTokens(state.markdown || els.source.value || '');
      const quoteAnchor = nodeClosest(activeAnchor, 'blockquote');
      if (offset <= 0 || offset > markdown.length) return false;
      if (quoteAnchor) {
        if (!markdown.slice(0, offset).endsWith('\n> ')) return false;
      } else if (markdown[offset - 1] !== '\n') {
        return false;
      }
      const block = renderedBlockForSourceOffset(els.rich, offset);
      if (!block?.matches?.('p, h1, h2, h3, h4, h5, h6, blockquote')) return false;
      const insert = block.matches('blockquote')
        ? richQuoteLineBreakCaretInputText(event, block, markdown, offset, activeAnchor)
        : richLineBreakCaretInputText(event, block, markdown);
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
      }, 'rich-line-break-caret-input');
      suppressRichInlineActivation();
      return true;
    }

    function richQuoteLineBreakCaretInputText(event, blockquote, markdown, offset, anchor) {
      if (typeof event?.data === 'string' && event.data) {
        return markdownQuoteTextFromPlainText(event.data);
      }
      if (!anchor || !blockquote?.contains?.(anchor)) return '';
      const blockStart = numericData(blockquote, 'sourceStart');
      if (!Number.isFinite(blockStart) || offset < blockStart) return '';
      const sourceBeforeCaret = markdown.slice(blockStart, offset);
      const sourceLines = sourceBeforeCaret.split('\n');
      if (sourceLines.length < 2 || !/^\s*>\s?$/.test(sourceLines[sourceLines.length - 1] || '')) return '';
      const previousSource = String(sourceLines[sourceLines.length - 2] || '').replace(/^\s*>\s?/, '');
      if (!/[ \t]{2}$/.test(previousSource)) return '';
      const previousVisible = previousSource.replace(/[ \t]{2}$/, '');
      const before = document.createRange();
      before.selectNodeContents(blockquote);
      try {
        before.setEndBefore(anchor);
      } catch (_) {
        return '';
      }
      const current = stripRichCaretTokens(serializeInlineNodes(Array.from(before.cloneContents().childNodes))).replace(/\n$/, '');
      if (!current.startsWith(previousVisible)) return '';
      const inserted = current.slice(previousVisible.length).replace(/[ \t]+$/, '').trimStart();
      return inserted ? markdownQuoteTextFromPlainText(inserted) : '';
    }

    function richLineBreakCaretInputText(event, block, markdown) {
      if (typeof event?.data === 'string' && event.data) {
        return stripRichCaretTokens(normalizeNewlines(event.data));
      }
      const start = numericData(block, 'sourceStart');
      const end = numericData(block, 'sourceEnd');
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '';
      const previousLine = markdown.slice(start, end);
      if (!/[ \t]{2}$/.test(previousLine)) return '';
      const previousVisible = previousLine.replace(/[ \t]{2}$/, '');
      const current = stripRichCaretTokens(serializeInlineChildren(block));
      if (!current.endsWith('\n')) return '';
      const beforeBreak = current.slice(0, -1);
      if (!beforeBreak.startsWith(previousVisible)) return '';
      return beforeBreak.slice(previousVisible.length).replace(/[ \t]+$/, '').trimStart();
    }

    function onRichBeforeInput(event) {
      if (handleRichInlineSourceBeforeInput(event)) return;
      if (event.defaultPrevented || !isRichBeforeInputContext(event)) return;
      if (shouldSnapshotRichBeforeInput(event)) {
        pushRichUndoSnapshot('delete');
        state.richUndoPreserveNextInput = true;
      }
      if (isRichPlainTextInsertInput(event) && handleRichInlineBoundaryTextInput(event)) {
        return;
      }
      if (isRichPlainTextInsertInput(event) && handleRichPlainTextInput(event)) {
        return;
      }
      if ((event.inputType === 'deleteContentBackward' || event.inputType === 'deleteContentForward') && handleRichInlineBoundaryDelete(event)) {
        return;
      }
      if ((event.inputType === 'deleteContentBackward' || event.inputType === 'deleteContentForward') && handleRichTableBlockBoundaryDelete(event)) {
        return;
      }
      if ((event.inputType === 'deleteContentBackward' || event.inputType === 'deleteContentForward') && handleRichTextBlockBoundaryDelete(event)) {
        return;
      }
      if ((event.inputType === 'deleteContentBackward' || event.inputType === 'deleteContentForward') && handleRichListItemBoundaryDelete(event)) {
        return;
      }
      if ((event.inputType === 'deleteContentBackward' || event.inputType === 'deleteContentForward') && handleRichListBlockBoundaryDelete(event)) {
        return;
      }
      if ((event.inputType === 'deleteContentBackward' || event.inputType === 'deleteContentForward') && handleRichPlainTextDelete(event)) {
        return;
      }
      if (event.inputType === 'deleteByCut' || event.inputType === 'deleteContent') {
        if (handleRichPlainTextSelectionReplacement(event, '', 'rich-selection-cut')) return;
        if (guardUnsupportedRichSelectionMutationFallback(event)) return;
      }
      if (event.inputType === 'insertParagraph') {
        handleRichEnter(event);
        return;
      }
      if (event.inputType === 'insertLineBreak') {
        event.preventDefault();
        if (handleRichLineBreakTransaction({ pushUndo: true })) return;
        if (insertRichLineBreak()) syncRichMarkdownFromDom('rich-input');
      }
    }

    function handleRichInlineSourceBeforeInput(event) {
      if (event.defaultPrevented || state.mode !== 'rich' || state.richComposing) return false;
      const inlineSource = richInlineSourceFromEventContext(event);
      if (!inlineSource) return false;
      const inputType = String(event.inputType || '');
      if (!inputType.startsWith('insert') && !inputType.startsWith('delete')) return false;
      if (applyRichInlineSourceInputTransaction(event, inlineSource, inputType)) return true;
      captureRichInlineSourceUndoSnapshot(inlineSource, 'inline-source');
      return false;
    }

    function applyRichInlineSourceInputTransaction(event, inlineSource, inputType) {
      const sourceRange = richInlineSourceRange(inlineSource);
      const selectionRange = richInlineSourceSelectionRange(inlineSource);
      if (!sourceRange || !selectionRange) return false;
      const source = stripRichCaretTokens(normalizeNewlines(inlineSource.textContent || ''));
      let from = selectionRange.from;
      let to = selectionRange.to;
      let insert = '';

      if (inputType === 'insertText' || inputType === 'insertReplacementText') {
        if (typeof event.data !== 'string') return false;
        insert = stripRichCaretTokens(normalizeNewlines(event.data));
      } else if (inputType === 'deleteContentBackward') {
        if (from === to) {
          if (from <= 0) return false;
          from = previousStringOffset(source, from);
        }
      } else if (inputType === 'deleteContentForward') {
        if (from === to) {
          if (to >= source.length) return false;
          to = nextStringOffset(source, to);
        }
      } else {
        return false;
      }

      event.preventDefault();
      captureRichInlineSourceUndoSnapshot(inlineSource, 'inline-source');
      applyActiveRichInlineSourceTransaction(inlineSource, {
        from,
        to,
        insert,
        sourceRange,
        reason: `rich-inline-source-${inputType}`,
      });
      return true;
    }

    function captureRichInlineSourceUndoSnapshot(inlineSource, label) {
      const active = state.richInlineSource;
      if (!active || active.element !== inlineSource || active.undoCaptured) return false;
      pushRichUndoSnapshot(label || 'inline-source');
      active.undoCaptured = true;
      return true;
    }

    function shouldSnapshotRichBeforeInput(event) {
      if (!String(event.inputType || '').startsWith('delete')) return false;
      if (nodeClosest(window.getSelection?.()?.anchorNode, '.rich-inline-source, .rich-source-editor, .code-language-input')) return false;
      return true;
    }

    function isRichPlainTextInsertInput(event) {
      return event.inputType === 'insertText' || event.inputType === 'insertReplacementText';
    }

    function handleRichInlineBoundaryTextInput(event) {
      if (state.richComposing || typeof event.data !== 'string' || event.data === '') return false;
      if (event.ctrlKey || event.metaKey || event.altKey) return false;
      const selection = window.getSelection?.();
      const range = richSelectionRange(selection);
      if (!range?.collapsed) return false;
      if (nodeClosest(range.startContainer, '.rich-inline-source, .rich-source-editor, .code-language-input')) return false;
      const inlineElement = validRichInlineSourceElement(nodeElement(range.startContainer)?.closest?.(RICH_INLINE_SOURCE_SELECTOR));
      if (!inlineElement) return false;
      const block = richInlineEditBlockForRange(range);
      if (!block || !isSameRichInlineEditBlock(inlineElement, block)) return false;

      const offset = richInlineElementTextOffsetForRange(inlineElement, range);
      const length = normalizeRichText(inlineElement.textContent || '').length;
      const atStart = offset <= 0;
      const atEnd = offset >= length;
      if (!atStart && !atEnd) return false;

      const sourceTransaction = richInlineBoundaryInsertTransaction(inlineElement, event.data, atStart ? 'before' : 'after');
      if (sourceTransaction) {
        event.preventDefault();
        applySourceTransaction(sourceTransaction, 'rich-inline-boundary-insert');
        suppressRichInlineActivation();
        return true;
      }

      if (guardUnsupportedRichInlineBoundaryFallback(inlineElement, block)) {
        event.preventDefault();
        return true;
      }

      event.preventDefault();
      const caretToken = richCaretToken();
      const textNode = document.createTextNode(atStart ? `${event.data}${caretToken}` : `${event.data}${caretToken}`);
      state.richSelectionLock = true;
      if (atStart) inlineElement.before(textNode);
      else inlineElement.after(textNode);
      reparseRichInlineEditBlockContent(block, { caretToken });
      configureRichEditableSurface();
      syncRichMarkdownFromDom('rich-input');
      state.richSelectionLock = false;
      suppressRichInlineActivation();
      return true;
    }

    function guardUnsupportedRichInlineBoundaryFallback(inlineElement, block) {
      if (!inlineElement || !block || !els.rich.contains(block)) return false;
      if (richTopLevelBlock(block)?.matches?.(RICH_SOURCE_BLOCK_SELECTOR)) {
        setStatus('この位置ではMarkdownソースへ変換できません');
        suppressRichInlineActivation();
        return true;
      }
      return false;
    }

    function handleRichInlineBoundaryDelete(event) {
      const selection = window.getSelection?.();
      const range = richSelectionRange(selection);
      if (!range?.collapsed) return false;
      if (nodeClosest(range.startContainer, '.rich-inline-source, .rich-source-editor, .code-language-input')) return false;
      const direction = event.inputType === 'deleteContentBackward' ? 'before' : 'after';
      const atom = richInlineBoundaryDeleteCandidate(range, direction);
      if (!atom) return false;
      const start = Number(atom.dataset.srcStart);
      const end = Number(atom.dataset.srcEnd);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return false;
      event.preventDefault();
      applySourceTransaction({
        from: start,
        to: end,
        insert: '',
        selectionAfter: {
          anchor: start,
          focus: start,
          affinity: 'before',
        },
      }, 'rich-inline-boundary-delete');
      suppressRichInlineActivation();
      return true;
    }

    function richInlineBoundaryDeleteCandidate(range, direction) {
      const direct = validRichInlineSourceElement(nodeElement(range.startContainer)?.closest?.('.rich-inline-atom'));
      if (direct?.classList?.contains('rich-inline-atom')) return direct;
      const adjacent = adjacentCaretNode(range.startContainer, range.startOffset, direction);
      const atom = nodeElement(adjacent)?.closest?.('.rich-inline-atom');
      return atom && els.rich.contains(atom) ? atom : null;
    }

    function handleRichHomeEndNavigation(event) {
      if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false;
      const selection = window.getSelection?.();
      const range = richSelectionRange(selection);
      if (!range?.collapsed) return false;
      if (nodeClosest(range.startContainer, '.rich-inline-source, .rich-source-editor, .code-language-input')) return false;
      const editBlock = richInlineEditBlockForRange(range);
      if (!editBlock || !els.rich.contains(editBlock)) return false;
      const boundary = event.key === 'Home' ? 'start' : 'end';
      const offset = richEditBlockBoundarySourceOffset(editBlock, boundary);
      if (!Number.isFinite(offset)) return false;
      event.preventDefault();
      restoreRichCaretFromSourceSelection({
        anchor: offset,
        focus: offset,
        affinity: boundary === 'start' ? 'before' : 'after',
      });
      suppressRichInlineActivation();
      return true;
    }

    function richEditBlockBoundarySourceOffset(editBlock, boundary) {
      if (editBlock.tagName?.toLowerCase() === 'li') {
        return richListItemBoundarySourceOffset(editBlock, boundary);
      }
      if (!editBlock.matches?.(RICH_SOURCE_BLOCK_SELECTOR)) return NaN;
      const start = numericData(editBlock, 'sourceStart');
      const end = numericData(editBlock, 'sourceEnd');
      if (!Number.isFinite(start) || !Number.isFinite(end)) return NaN;
      if (editBlock.tagName?.toLowerCase() === 'blockquote') {
        return richQuoteBoundarySourceOffset(editBlock, boundary);
      }
      return boundary === 'start' ? start + sourceContentBaseOffset(editBlock) : end;
    }

    function richQuoteBoundarySourceOffset(blockquote, boundary) {
      const start = numericData(blockquote, 'sourceStart');
      const end = numericData(blockquote, 'sourceEnd');
      if (!Number.isFinite(start) || !Number.isFinite(end)) return NaN;
      const raw = stripRichCaretTokens(state.markdown || '').slice(start, end);
      const model = parseMarkdownQuoteSource(raw);
      const first = model?.lines?.[0];
      const last = model?.lines?.[model.lines.length - 1];
      if (!first || !last) return NaN;
      return boundary === 'start'
        ? start + first.line.start + first.contentStart
        : start + last.line.start + last.contentEnd;
    }

    function richListItemBoundarySourceOffset(item, boundary) {
      const list = item.closest('ul, ol');
      if (!list?.matches?.(RICH_SOURCE_BLOCK_SELECTOR) || item.parentElement !== list) return NaN;
      const blockStart = numericData(list, 'sourceStart');
      const blockEnd = numericData(list, 'sourceEnd');
      if (!Number.isFinite(blockStart) || !Number.isFinite(blockEnd)) return NaN;
      const raw = stripRichCaretTokens(state.markdown || '').slice(blockStart, blockEnd);
      const sourceItems = flatListSourceItems(raw);
      const items = Array.from(list.children).filter((child) => child.tagName?.toLowerCase() === 'li');
      const itemIndex = items.indexOf(item);
      if (itemIndex < 0 || sourceItems.length !== items.length) return NaN;
      const sourceItem = sourceItems[itemIndex];
      const contentLength = visibleTextFromListSourceItem(sourceItem).length;
      const textOffset = boundary === 'start' ? 0 : contentLength;
      return blockStart + sourceOffsetFromListItemTextOffset(sourceItem, textOffset);
    }

    function handleRichPlainTextInput(event) {
      if (state.richComposing || typeof event.data !== 'string' || event.data === '') return false;
      if (event.ctrlKey || event.metaKey || event.altKey) return false;
      if (handleRichPlainTextSelectionReplacement(event, event.data, 'rich-selection-insert')) return true;
      if (guardUnsupportedRichSelectionMutationFallback(event)) return true;
      const range = currentCollapsedRichRange();
      if (!range || !isSourceTransactionTextRange(range)) return false;
      if (handleRichBlockMarkdownShortcutInput(event, range)) return true;
      const point = activeRichTransactionBlankPoint(range) || richPlainTextSourcePointFromRange(range);
      if (!point) return false;
      if (handleRichBlockMarkdownShortcutSourceInput(event, point)) return true;
      if (shouldLetDomHandleMarkdownShortcutInput(range, event.data)) return false;
      event.preventDefault();
      const input = point.tableCell
        ? markdownTableCellTextFromPlainText(event.data)
        : point.quoteBlock
          ? markdownQuoteTextFromPlainText(event.data)
          : stripRichCaretTokens(event.data);
      const trailingPrefix = point.trailingParagraph && (state.markdown || '').length ? '\n\n' : '';
      const blankInsert = point.blankParagraph ? blankParagraphSourceInsertion(point.offset, input) : null;
      const insert = blankInsert ? blankInsert.insert : `${trailingPrefix}${input}`;
      const nextOffset = blankInsert ? blankInsert.selectionOffset : point.offset + trailingPrefix.length + input.length;
      applySourceTransaction({
        from: point.offset,
        to: point.offset,
        insert,
        selectionAfter: {
          anchor: nextOffset,
          focus: nextOffset,
          affinity: 'after',
        },
      }, 'rich-text-insert');
      if (point.blankParagraph) state.richTransactionBlank = null;
      suppressRichInlineActivation();
      return true;
    }

    function blankParagraphSourceInsertion(offset, text) {
      const source = stripRichCaretTokens(state.markdown || els.source?.value || '');
      const gap = Math.max(0, Math.min(source.length, Number(offset) || 0));
      const input = stripRichCaretTokens(String(text || ''));
      const beforeHasBreak = gap === 0 || source.slice(0, gap).endsWith('\n\n');
      const afterHasBreak = gap === source.length || source.slice(gap).startsWith('\n\n');
      const prefix = beforeHasBreak ? '' : '\n\n';
      const suffix = afterHasBreak ? '' : '\n\n';
      return {
        insert: `${prefix}${input}${suffix}`,
        selectionOffset: gap + prefix.length + input.length,
      };
    }

    function handleRichBlockMarkdownShortcutSourceInput(event, point) {
      const block = renderedBlockForSourceOffset(els.rich, point.offset);
      if (!block || block.tagName?.toLowerCase() !== 'p' || !block.matches?.(RICH_SOURCE_BLOCK_SELECTOR)) return false;
      const start = numericData(block, 'sourceStart');
      const end = numericData(block, 'sourceEnd');
      const base = sourceContentBaseOffset(block);
      if (!Number.isFinite(start) || !Number.isFinite(end) || point.offset < start || point.offset > end) return false;
      const source = stripRichCaretTokens(state.markdown || els.source.value || '');
      const raw = source.slice(start, end);
      const local = Math.max(0, Math.min(raw.length, point.offset - start - base));
      const next = `${raw.slice(0, local)}${event.data || ''}${raw.slice(local)}`;
      const replacement = richBlockMarkdownTriggerReplacement(next, { allowBareMath: false });
      if (!replacement) return false;
      event.preventDefault();
      return applyRichBlockMarkdownTriggerTransaction(block, next, { allowBareMath: false });
    }

    function handleRichBlockMarkdownShortcutInput(event, range) {
      const block = richParagraphBlockForShortcutRange(range);
      if (!block || block.closest('li') || !block.matches?.(RICH_SOURCE_BLOCK_SELECTOR)) return false;
      const current = normalizeRichText(block.textContent || '');
      const caretOffset = getCaretCharacterOffsetWithin(block, window.getSelection?.());
      const next = `${current.slice(0, caretOffset)}${event.data || ''}${current.slice(caretOffset)}`;
      if (caretOffset !== current.length) return false;
      const replacement = richBlockMarkdownTriggerReplacement(next, { allowBareMath: false });
      if (!replacement) return false;
      event.preventDefault();
      return applyRichBlockMarkdownTriggerTransaction(block, next, { allowBareMath: false });
    }

    function richParagraphBlockForShortcutRange(range) {
      const direct = nodeClosest(range?.startContainer, 'p');
      if (direct && els.rich.contains(direct)) return direct;
      const point = richPlainTextSourcePointFromRange(range);
      if (!point) return null;
      const block = renderedBlockForSourceOffset(els.rich, point.offset);
      return block?.tagName?.toLowerCase() === 'p' ? block : null;
    }

    function applySyncedRichBlockMarkdownShortcutAfterInput() {
      const selection = window.getSelection?.();
      const selectedBlock = selection?.rangeCount && els.rich.contains(selection.anchorNode)
        ? nodeClosest(selection.anchorNode, 'p')
        : null;
      const candidates = selectedBlock ? [selectedBlock] : Array.from(els.rich.querySelectorAll(`p${RICH_SOURCE_BLOCK_SELECTOR}`));
      for (const block of candidates) {
        if (!block || block.closest('li') || !block.matches?.(RICH_SOURCE_BLOCK_SELECTOR)) continue;
        const text = normalizeRichText(block.textContent || '');
        const replacement = richBlockMarkdownTriggerReplacement(text, { allowBareMath: false });
        if (!replacement) continue;
        return applyRichBlockMarkdownTriggerTransaction(block, text, { allowBareMath: false });
      }
      return false;
    }

    function applySyncedMarkdownShortcutFromSource() {
      const markdown = stripRichCaretTokens(els.source?.value || state.markdown || '');
      if (markdown !== stripRichCaretTokens(state.markdown || '')) {
        state.markdown = markdown;
        if (els.source) els.source.value = markdown;
      }
      const selection = window.getSelection?.();
      const sourcePoint = selection?.rangeCount && els.rich.contains(selection.anchorNode)
        ? domPointToSourceOffset(selection.anchorNode, selection.anchorOffset)
        : null;
      const blocks = buildBlockModel(markdown).filter((block) => block.type === 'paragraph');
      const selected = Number.isFinite(sourcePoint?.offset)
        ? blocks.find((block) => block.start <= sourcePoint.offset && sourcePoint.offset <= block.end)
        : null;
      const candidates = selected ? [selected, ...blocks.filter((block) => block !== selected)] : blocks;

      for (const block of candidates) {
        const replacement = richBlockMarkdownTriggerReplacement(block.raw, { allowBareMath: false });
        if (!replacement) continue;
        const selectionOffset = block.start + (Number.isFinite(replacement.selectionOffset)
          ? replacement.selectionOffset
          : replacement.insert.length);
        state.richInputUsedSourceTransaction = true;
        return applySourceTransaction({
          from: block.start,
          to: block.end,
          insert: replacement.insert,
          selectionAfter: {
            anchor: selectionOffset,
            focus: selectionOffset,
            affinity: 'after',
          },
          blankParagraphAt: replacement.blankParagraphAt ? block.start + replacement.insert.length : undefined,
        }, `rich-markdown-trigger-${replacement.kind}-synced`);
      }
      return false;
    }

    function scheduleSyncedMarkdownShortcutFromSource() {
      window.setTimeout(() => {
        if (state.mode !== 'rich' || state.richComposing || state.richInlineSource?.element) return;
        applySyncedMarkdownShortcutFromSource();
      }, 0);
    }

    function handleRichPlainTextDelete(event) {
      if (handleRichPlainTextSelectionReplacement(event, '', 'rich-selection-delete')) return true;
      if (guardUnsupportedRichSelectionMutationFallback(event)) return true;
      const range = currentCollapsedRichRange();
      if (!range || !isSourceTransactionTextRange(range)) return false;
      const backward = event.inputType === 'deleteContentBackward' || event.key === 'Backspace';
      if (!backward && event.inputType !== 'deleteContentForward' && event.key !== 'Delete') return false;
      const lineBreakDeletion = richLineBreakCaretDeleteTransaction(window.getSelection?.(), backward);
      if (lineBreakDeletion) {
        event.preventDefault();
        state.richLineBreakInputOffset = null;
        applySourceTransaction(lineBreakDeletion, 'rich-line-break-caret-delete');
        suppressRichInlineActivation();
        return true;
      }
      const point = richPlainTextSourcePointFromRange(range);
      if (!point) return false;
      const quoteDeletion = richQuoteBoundaryDeleteTransaction(point, backward);
      if (quoteDeletion) {
        event.preventDefault();
        applySourceTransaction(quoteDeletion, backward ? 'rich-quote-line-merge-backward' : 'rich-quote-line-merge-forward');
        suppressRichInlineActivation();
        return true;
      }
      const deletionRange = richPlainTextDeletionRange(point, backward);
      if (!deletionRange) return false;
      const { from, to } = deletionRange;
      if (from < point.contentStart || to > point.contentEnd || from < 0 || to <= from) return false;
      event.preventDefault();
      applySourceTransaction({
        from,
        to,
        insert: '',
        selectionAfter: {
          anchor: from,
          focus: from,
          affinity: backward ? 'before' : 'after',
        },
      }, backward ? 'rich-text-delete-backward' : 'rich-text-delete-forward');
      suppressRichInlineActivation();
      return true;
    }

    function richPlainTextDeletionRange(point, backward) {
      const markdown = stripRichCaretTokens(state.markdown || els.source.value || '');
      if (point.tableCell) {
        if (backward && markdown.slice(point.offset - 2, point.offset) === '\\|') {
          return { from: point.offset - 2, to: point.offset };
        }
        if (!backward && markdown.slice(point.offset, point.offset + 2) === '\\|') {
          return { from: point.offset, to: point.offset + 2 };
        }
      }
      if (backward && /[ \t]{2}\n$/.test(markdown.slice(point.offset - 3, point.offset))) {
        return { from: point.offset - 3, to: point.offset };
      }
      if (backward && /[ \t]{2}\n/.test(markdown.slice(point.offset - 1, point.offset + 2))) {
        return { from: point.offset - 1, to: point.offset + 2 };
      }
      if (backward && /[ \t]{2}\n/.test(markdown.slice(point.offset - 2, point.offset + 1))) {
        return { from: point.offset - 2, to: point.offset + 1 };
      }
      if (!backward && /[ \t]{2}\n/.test(markdown.slice(point.offset, point.offset + 3))) {
        return { from: point.offset, to: point.offset + 3 };
      }
      return backward
        ? { from: point.offset - 1, to: point.offset }
        : { from: point.offset, to: point.offset + 1 };
    }

    function handleRichTextBlockBoundaryDelete(event) {
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
      const selection = window.getSelection?.();
      const range = richSelectionRange(selection);
      if (!range?.collapsed) return false;
      if (nodeClosest(range.startContainer, '.rich-inline-source, .rich-source-editor, .code-language-input')) return false;
      const backward = event.inputType === 'deleteContentBackward' || event.key === 'Backspace';
      if (!backward && event.inputType !== 'deleteContentForward' && event.key !== 'Delete') return false;
      const transaction = richTextBlockBoundaryDeleteTransaction(range, backward);
      if (!transaction) return false;
      event.preventDefault();
      applySourceTransaction(transaction, backward ? 'rich-block-boundary-delete-backward' : 'rich-block-boundary-delete-forward');
      suppressRichInlineActivation();
      return true;
    }

    function richTextBlockBoundaryDeleteTransaction(range, backward) {
      if (!range?.collapsed || !isSourceTransactionTextRange(range)) return null;
      const block = nodeClosest(range.startContainer, 'p, h1, h2, h3, h4, h5, h6, blockquote');
      if (!block?.matches?.(RICH_SOURCE_BLOCK_SELECTOR) || !els.rich.contains(block) || block.closest('li')) return null;
      const point = richPlainTextSourcePointFromRange(range);
      if (!point || !Number.isFinite(point.offset)) return null;
      const blockStart = numericData(block, 'sourceStart');
      const blockEnd = numericData(block, 'sourceEnd');
      if (!Number.isFinite(blockStart) || !Number.isFinite(blockEnd)) return null;
      const isQuoteBlock = block.tagName?.toLowerCase() === 'blockquote';
      if (isQuoteBlock) {
        if (backward || point.offset !== blockEnd) return null;
      } else {
        if (backward && point.offset !== point.contentStart) return null;
        if (!backward && point.offset !== point.contentEnd) return null;
      }

      const markdown = stripRichCaretTokens(state.markdown || els.source.value || '');
      const adjacent = backward ? adjacentSourceBackedBlock(block, 'previous') : adjacentSourceBackedBlock(block, 'next');
      if (!adjacent) return null;
      const adjacentStart = numericData(adjacent, 'sourceStart');
      const adjacentEnd = numericData(adjacent, 'sourceEnd');
      if (!Number.isFinite(adjacentStart) || !Number.isFinite(adjacentEnd)) return null;
      const from = backward ? adjacentEnd : blockEnd;
      const to = backward ? blockStart : adjacentStart;
      if (from < 0 || to <= from || to > markdown.length || !/^\n{1,2}$/.test(markdown.slice(from, to))) return null;
      return {
        from,
        to,
        insert: '',
        selectionAfter: {
          anchor: from,
          focus: from,
          affinity: backward ? 'before' : 'after',
        },
      };
    }

    function handleRichTableBlockBoundaryDelete(event) {
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
      const selection = window.getSelection?.();
      const range = richSelectionRange(selection);
      if (!range?.collapsed) return false;
      if (nodeClosest(range.startContainer, '.rich-inline-source, .rich-source-editor, .code-language-input')) return false;
      const backward = event.inputType === 'deleteContentBackward' || event.key === 'Backspace';
      if (!backward && event.inputType !== 'deleteContentForward' && event.key !== 'Delete') return false;
      const transaction = richTableBlockBoundaryDeleteTransaction(range, backward);
      if (!transaction) return false;
      event.preventDefault();
      applySourceTransaction(transaction, backward ? 'rich-table-boundary-delete-backward' : 'rich-table-boundary-delete-forward');
      suppressRichInlineActivation();
      return true;
    }

    function richTableBlockBoundaryDeleteTransaction(range, backward) {
      if (!range?.collapsed) return null;
      const cell = nodeClosest(range.startContainer, 'td, th');
      if (cell && els.rich.contains(cell)) {
        return richTableCellParagraphBoundaryDeleteTransaction(cell, range, backward);
      }
      const paragraph = nodeClosest(range.startContainer, 'p');
      if (paragraph && els.rich.contains(paragraph)) {
        return richParagraphTableBoundaryDeleteTransaction(paragraph, range, backward);
      }
      return null;
    }

    function richParagraphTableBoundaryDeleteTransaction(paragraph, range, backward) {
      if (!isRichSourceParagraphBlock(paragraph) || !isSourceTransactionTextRange(range)) return null;
      const point = richPlainTextSourcePointFromRange(range);
      if (!point || !Number.isFinite(point.offset)) return null;
      if (backward) {
        if (point.offset !== point.contentStart) return null;
        const table = adjacentSourceBackedBlock(paragraph, 'previous');
        return isRichSourceTableBlock(table) ? richTableBeforeParagraphMergeTransaction(table, paragraph) : null;
      }
      if (point.offset !== point.contentEnd) return null;
      const table = adjacentSourceBackedBlock(paragraph, 'next');
      return isRichSourceTableBlock(table) ? richParagraphBeforeTableMergeTransaction(paragraph, table) : null;
    }

    function richTableCellParagraphBoundaryDeleteTransaction(cell, range, backward) {
      const table = cell?.closest?.('table');
      if (!isRichSourceTableBlock(table)) return null;
      const point = richTableSourcePointFromRange(cell, range);
      if (!point || !Number.isFinite(point.offset)) return null;
      if (backward) {
        if (cell !== richFirstTableCell(table) || point.offset !== point.contentStart) return null;
        const paragraph = adjacentSourceBackedBlock(table, 'previous');
        return isRichSourceParagraphBlock(paragraph) ? richParagraphBeforeTableMergeTransaction(paragraph, table) : null;
      }
      if (cell !== richLastTableCell(table) || point.offset !== point.contentEnd) return null;
      const paragraph = adjacentSourceBackedBlock(table, 'next');
      return isRichSourceParagraphBlock(paragraph) ? richTableBeforeParagraphMergeTransaction(table, paragraph) : null;
    }

    function richParagraphBeforeTableMergeTransaction(paragraph, table) {
      const markdown = stripRichCaretTokens(state.markdown || els.source.value || '');
      const paragraphSource = richSourceParagraphForTableMerge(paragraph, markdown);
      const firstCell = richFirstTableCell(table);
      const cellRange = firstCell ? richTableCellSourceRange(firstCell) : null;
      if (!paragraphSource || !cellRange || cellRange.table !== table) return null;
      if (!/^\n{1,2}$/.test(markdown.slice(paragraphSource.end, cellRange.blockStart))) return null;
      const tablePrefix = markdown.slice(cellRange.blockStart, cellRange.contentStart);
      const insert = `${tablePrefix}${paragraphSource.cellText}`;
      const selectionOffset = paragraphSource.start + insert.length;
      return {
        from: paragraphSource.start,
        to: cellRange.contentStart,
        insert,
        selectionAfter: {
          anchor: selectionOffset,
          focus: selectionOffset,
          affinity: 'after',
        },
      };
    }

    function richTableBeforeParagraphMergeTransaction(table, paragraph) {
      const markdown = stripRichCaretTokens(state.markdown || els.source.value || '');
      const paragraphSource = richSourceParagraphForTableMerge(paragraph, markdown);
      const lastCell = richLastTableCell(table);
      const cellRange = lastCell ? richTableCellSourceRange(lastCell) : null;
      if (!paragraphSource || !cellRange || cellRange.table !== table) return null;
      if (!/^\n{1,2}$/.test(markdown.slice(cellRange.blockEnd, paragraphSource.start))) return null;
      const tableTail = markdown.slice(cellRange.contentEnd, cellRange.blockEnd);
      const insert = `${paragraphSource.cellText}${tableTail}`;
      const selectionOffset = cellRange.contentEnd + paragraphSource.cellText.length;
      return {
        from: cellRange.contentEnd,
        to: paragraphSource.end,
        insert,
        selectionAfter: {
          anchor: selectionOffset,
          focus: selectionOffset,
          affinity: 'after',
        },
      };
    }

    function richSourceParagraphForTableMerge(paragraph, markdown) {
      if (!isRichSourceParagraphBlock(paragraph)) return null;
      const start = numericData(paragraph, 'sourceStart');
      const end = numericData(paragraph, 'sourceEnd');
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || end > markdown.length) return null;
      const raw = markdown.slice(start, end);
      return {
        start,
        end,
        cellText: markdownTableCellTextFromPlainText(raw),
      };
    }

    function richFirstTableCell(table) {
      return table?.querySelector?.('th, td') || null;
    }

    function richLastTableCell(table) {
      const cells = Array.from(table?.querySelectorAll?.('th, td') || []);
      return cells.length ? cells[cells.length - 1] : null;
    }

    function isRichSourceParagraphBlock(block) {
      return block?.tagName?.toLowerCase() === 'p'
        && block.matches?.(RICH_SOURCE_BLOCK_SELECTOR)
        && els.rich.contains(block)
        && !block.closest('li');
    }

    function isRichSourceTableBlock(block) {
      return block?.tagName?.toLowerCase() === 'table'
        && block.matches?.(RICH_SOURCE_BLOCK_SELECTOR)
        && els.rich.contains(block);
    }

    function adjacentSourceBackedBlock(block, direction) {
      const siblingProperty = direction === 'previous' ? 'previousElementSibling' : 'nextElementSibling';
      let sibling = block?.[siblingProperty] || null;
      while (sibling) {
        if (sibling.matches?.(RICH_SOURCE_BLOCK_SELECTOR)) return sibling;
        if (!isIgnorableRichBoundaryElement(sibling)) return null;
        sibling = sibling[siblingProperty];
      }
      return null;
    }

    function handleRichListItemBoundaryDelete(event) {
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
      const selection = window.getSelection?.();
      const range = richSelectionRange(selection);
      if (!range?.collapsed) return false;
      if (nodeClosest(range.startContainer, '.rich-inline-source, .rich-source-editor, .code-language-input')) return false;
      const backward = event.inputType === 'deleteContentBackward' || event.key === 'Backspace';
      if (!backward && event.inputType !== 'deleteContentForward' && event.key !== 'Delete') return false;
      const transaction = richListItemBoundaryDeleteTransaction(range, backward);
      if (!transaction) return false;
      event.preventDefault();
      applySourceTransaction(transaction, backward ? 'rich-list-item-boundary-delete-backward' : 'rich-list-item-boundary-delete-forward');
      suppressRichInlineActivation();
      return true;
    }

    function richListItemBoundaryDeleteTransaction(range, backward) {
      if (!range?.collapsed) return null;
      const item = richListItemFromRange(range);
      const list = item?.closest?.('ul, ol');
      if (!item || !list?.matches?.(RICH_SOURCE_BLOCK_SELECTOR) || item.parentElement !== list) return null;
      if (item.querySelector('.rich-inline-source')) return null;
      const point = richListSourcePointFromRange(item, range);
      if (!point || !Number.isFinite(point.offset)) return null;
      const blockStart = numericData(list, 'sourceStart');
      const blockEnd = numericData(list, 'sourceEnd');
      if (!Number.isFinite(blockStart) || !Number.isFinite(blockEnd)) return null;
      const markdown = stripRichCaretTokens(state.markdown || els.source.value || '');
      const raw = markdown.slice(blockStart, blockEnd);
      const sourceItems = flatListSourceItems(raw);
      const items = Array.from(list.children).filter((child) => child.tagName?.toLowerCase() === 'li');
      const itemIndex = items.indexOf(item);
      if (itemIndex < 0 || sourceItems.length !== items.length) return null;
      const sourceItem = sourceItems[itemIndex];
      const neighbor = sourceItems[itemIndex + (backward ? -1 : 1)];
      if (!sourceItem || !neighbor) return null;
      const itemContentStart = blockStart + sourceItem.lines[0].start + sourceItem.parsed.prefix.length;
      const itemContentEnd = blockStart + listSourceItemTextEnd(sourceItem);
      if (backward && point.offset !== itemContentStart) return null;
      if (!backward && point.offset !== itemContentEnd) return null;
      const from = backward
        ? blockStart + listSourceItemTextEnd(neighbor)
        : itemContentEnd;
      const to = backward
        ? itemContentStart
        : blockStart + neighbor.lines[0].start + neighbor.parsed.prefix.length;
      const removed = markdown.slice(from, to);
      if (from < blockStart || to > blockEnd || to <= from || !removed.startsWith('\n') || removed.slice(1).includes('\n')) return null;
      return {
        from,
        to,
        insert: '',
        selectionAfter: {
          anchor: from,
          focus: from,
          affinity: backward ? 'before' : 'after',
        },
      };
    }

    function handleRichListBlockBoundaryDelete(event) {
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
      const selection = window.getSelection?.();
      const range = richSelectionRange(selection);
      if (!range?.collapsed) return false;
      if (nodeClosest(range.startContainer, '.rich-inline-source, .rich-source-editor, .code-language-input')) return false;
      const backward = event.inputType === 'deleteContentBackward' || event.key === 'Backspace';
      if (!backward && event.inputType !== 'deleteContentForward' && event.key !== 'Delete') return false;
      const transaction = richListBlockBoundaryDeleteTransaction(range, backward);
      if (!transaction) return false;
      event.preventDefault();
      applySourceTransaction(transaction, backward ? 'rich-list-boundary-delete-backward' : 'rich-list-boundary-delete-forward');
      suppressRichInlineActivation();
      return true;
    }

    function richListBlockBoundaryDeleteTransaction(range, backward) {
      if (!range?.collapsed) return null;
      const item = richListItemFromRange(range);
      const list = item?.closest?.('ul, ol');
      if (!item || !list?.matches?.(RICH_SOURCE_BLOCK_SELECTOR) || item.parentElement !== list) return null;
      if (item.querySelector('.rich-inline-source')) return null;
      const point = richListSourcePointFromRange(item, range);
      if (!point || !Number.isFinite(point.offset)) return null;
      const blockStart = numericData(list, 'sourceStart');
      const blockEnd = numericData(list, 'sourceEnd');
      if (!Number.isFinite(blockStart) || !Number.isFinite(blockEnd)) return null;
      const raw = stripRichCaretTokens(state.markdown || '').slice(blockStart, blockEnd);
      const sourceItems = flatListSourceItems(raw);
      const items = Array.from(list.children).filter((child) => child.tagName?.toLowerCase() === 'li');
      const itemIndex = items.indexOf(item);
      if (itemIndex < 0 || sourceItems.length !== items.length) return null;
      if (backward) {
        if (itemIndex !== 0 || point.offset !== point.contentStart) return null;
      } else if (itemIndex !== sourceItems.length - 1 || point.offset !== point.contentEnd) {
        return null;
      }

      const markdown = stripRichCaretTokens(state.markdown || els.source.value || '');
      const adjacent = backward ? adjacentSourceBackedBlock(list, 'previous') : adjacentSourceBackedBlock(list, 'next');
      if (!adjacent) return null;
      const adjacentStart = numericData(adjacent, 'sourceStart');
      const adjacentEnd = numericData(adjacent, 'sourceEnd');
      if (!Number.isFinite(adjacentStart) || !Number.isFinite(adjacentEnd)) return null;
      const from = backward ? adjacentEnd : blockEnd;
      const to = backward ? blockStart : adjacentStart;
      if (from < 0 || to <= from || to > markdown.length || !/^\n{1,2}$/.test(markdown.slice(from, to))) return null;
      return {
        from,
        to,
        insert: '',
        selectionAfter: {
          anchor: from,
          focus: from,
          affinity: backward ? 'before' : 'after',
        },
      };
    }

    function handleRichPlainTextSelectionReplacement(event, insert, reason) {
      const selection = window.getSelection?.();
      const tableRange = richTableTextReplacementRangeFromSelection(selection);
      const quoteRange = tableRange ? null : richQuoteTextReplacementRangeFromSelection(selection);
      const rawRange = tableRange || quoteRange || richPlainTextTransactionRangeFromSelection(selection);
      const replacementRange = rawRange?.from !== rawRange?.to
        ? expandSourceRangeToIntersectingInlineAtoms(rawRange)
        : rawRange;
      if (!replacementRange || replacementRange.from === replacementRange.to) return false;

      event.preventDefault();
      pushRichUndoSnapshot(reason || 'selection');
      const replacement = tableRange
        ? markdownTableCellTextFromPlainText(insert || '')
        : quoteRange
          ? markdownQuoteTextFromPlainText(insert || '')
          : stripRichCaretTokens(insert || '');
      const nextOffset = replacementRange.from + replacement.length;
      applySourceTransaction({
        from: replacementRange.from,
        to: replacementRange.to,
        insert: replacement,
        selectionAfter: {
          anchor: nextOffset,
          focus: nextOffset,
          affinity: 'after',
        },
      }, reason || 'rich-selection-replace');
      suppressRichInlineActivation();
      return true;
    }

    function richPlainTextTransactionRangeFromSelection(selection) {
      const range = richSelectionRange(selection);
      if (!range) return null;
      if (isRichSourceTransactionSelectionEndpointBlocked(range.startContainer)) return null;
      if (isRichSourceTransactionSelectionEndpointBlocked(range.endContainer)) return null;

      if (range.collapsed) {
        const lineBreakRange = activeRichLineBreakCaretRange(selection);
        if (lineBreakRange) return lineBreakRange;
        if (!isSourceTransactionTextRange(range)) return null;
        const point = richPlainTextSourcePointFromRange(range);
        if (!point || !Number.isFinite(point.offset)) return null;
        return {
          from: point.offset,
          to: point.offset,
          blankParagraph: Boolean(point.blankParagraph),
          trailingParagraph: Boolean(point.trailingParagraph),
        };
      }

      const sourceSelection = domSelectionToSourceSelection(selection);
      if (!sourceSelection || !Number.isFinite(sourceSelection.anchor) || !Number.isFinite(sourceSelection.focus)) return null;
      const expanded = expandSourceRangeToIntersectingInlineAtoms({
        from: Math.min(sourceSelection.anchor, sourceSelection.focus),
        to: Math.max(sourceSelection.anchor, sourceSelection.focus),
      });
      const { from, to } = expanded;
      if (to < from) return null;
      return { from, to };
    }

    function richLineBreakCaretDeleteTransaction(selection, backward) {
      if (!backward) return null;
      const range = activeRichLineBreakCaretRange(selection);
      if (!range) return null;
      const markdown = stripRichCaretTokens(state.markdown || els.source.value || '');
      const to = range.from;
      const from = to - 3;
      if (from < 0 || markdown[to - 1] !== '\n' || !/[ \t]{2}$/.test(markdown.slice(from, to - 1))) return null;
      return {
        from,
        to,
        insert: '',
        selectionAfter: {
          anchor: from,
          focus: from,
          affinity: 'before',
        },
      };
    }

    function expandSourceRangeToIntersectingInlineAtoms(range) {
      if (!range || !Number.isFinite(range.from) || !Number.isFinite(range.to) || range.to <= range.from) return range;
      let from = range.from;
      let to = range.to;
      for (const atom of Array.from(els.rich.querySelectorAll('.rich-inline-atom[data-src-start][data-src-end]'))) {
        const start = Number(atom.dataset.srcStart);
        const end = Number(atom.dataset.srcEnd);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
        if (from < end && to > start) {
          from = Math.min(from, start);
          to = Math.max(to, end);
        }
      }
      return { ...range, from, to };
    }

    function activeRichLineBreakCaretRange(selection) {
      const range = richSelectionRange(selection);
      if (!range?.collapsed) return null;
      const storedOffset = state.richLineBreakInputOffset !== null && Number.isFinite(Number(state.richLineBreakInputOffset))
        ? Number(state.richLineBreakInputOffset)
        : NaN;
      const activeAnchor = nodeClosest(range.startContainer, '.rich-line-break-caret-anchor')
        || (Number.isFinite(storedOffset) ? richLineBreakCaretAnchorForOffset(storedOffset) : null);
      const offset = Number.isFinite(storedOffset)
        ? storedOffset
        : Number(activeAnchor?.dataset?.sourceOffset);
      if (!activeAnchor || !els.rich.contains(activeAnchor) || !Number.isFinite(offset)) return null;
      const markdown = stripRichCaretTokens(state.markdown || els.source.value || '');
      if (offset <= 0 || offset > markdown.length || markdown[offset - 1] !== '\n') return null;
      return { from: offset, to: offset, lineBreakCaret: true };
    }

    function richLineBreakCaretAnchorForOffset(offset) {
      return Array.from(els.rich?.querySelectorAll?.('.rich-line-break-caret-anchor[data-source-offset]') || [])
        .find((anchor) => Number(anchor.dataset.sourceOffset) === offset) || null;
    }

    function isRichSourceTransactionSelectionEndpointBlocked(node) {
      return Boolean(nodeClosest(node, '.rich-inline-source, .rich-source-editor, .code-language-input, td, th'));
    }

    function currentCollapsedRichRange() {
      const selection = window.getSelection?.();
      const range = richSelectionRange(selection);
      if (!range?.collapsed) return null;
      if (nodeClosest(range.startContainer, '.rich-inline-source, .rich-source-editor, .code-language-input')) return null;
      return range;
    }

    function isSourceTransactionTextRange(range) {
      if (!range?.collapsed) return false;
      if (nodeClosest(range.startContainer, '.rich-inline-atom, .rich-source-editor, .mermaid-diagram, pre.code-block, .math-display, .toc')) return false;
      const editBlock = richInlineEditBlockForRange(range);
      if (!editBlock || !els.rich.contains(editBlock)) return false;
      if (nodeClosest(range.startContainer, '.rich-line-break-caret-anchor')) return true;
      if (editBlock.matches('p[data-rich-trailing="true"]')) return true;
      if (editBlock.matches('p[data-rich-transaction-blank][data-source-gap]')) return true;
      if (editBlock.matches('td, th')) return Boolean(richTableSourcePointFromRange(editBlock, range));
      if (editBlock.matches('blockquote')) return Boolean(richQuoteSourcePointFromRange(editBlock, range));
      if (editBlock.matches('li')) {
        const list = editBlock.parentElement;
        if (!list?.matches?.(RICH_SOURCE_BLOCK_SELECTOR)) return false;
        if (editBlock.querySelector('.rich-inline-source, ul, ol')) return false;
        return true;
      }
      return Boolean(editBlock.matches?.('p, h1, h2, h3, h4, h5, h6') && editBlock.matches(RICH_SOURCE_BLOCK_SELECTOR));
    }

    function richPlainTextSourcePointFromRange(range) {
      const lineBreakAnchor = nodeClosest(range.startContainer, '.rich-line-break-caret-anchor');
      if (lineBreakAnchor && els.rich.contains(lineBreakAnchor)) {
        const editBlock = richInlineEditBlockForRange(range);
        const sourceBlock = nodeClosest(lineBreakAnchor, RICH_SOURCE_BLOCK_SELECTOR);
        if (!editBlock || !sourceBlock) return null;
        const blockStart = numericData(sourceBlock, 'sourceStart');
        const blockEnd = numericData(sourceBlock, 'sourceEnd');
        const baseOffset = sourceContentBaseOffset(sourceBlock);
        const storedOffset = Number(lineBreakAnchor.dataset.sourceOffset);
        if (Number.isFinite(storedOffset)) {
          return {
            offset: storedOffset,
            contentStart: blockStart + baseOffset,
            contentEnd: blockEnd,
            quoteBlock: editBlock.matches?.('blockquote') || undefined,
          };
        }
        const before = document.createRange();
        before.selectNodeContents(editBlock);
        try {
          before.setEndBefore(lineBreakAnchor);
        } catch (_) {
          return null;
        }
        const anchorBefore = document.createRange();
        anchorBefore.selectNodeContents(lineBreakAnchor);
        try {
          anchorBefore.setEnd(range.startContainer, range.startOffset);
        } catch (_) {
          return null;
        }
        const localSource = stripRichCaretTokens(serializeInlineNodes(Array.from(before.cloneContents().childNodes)));
        const anchorSource = normalizeRichText(anchorBefore.toString()).replace(/\u200b/g, '');
        return {
          offset: blockStart + baseOffset + localSource.length + anchorSource.length,
          contentStart: blockStart + baseOffset,
          contentEnd: numericData(sourceBlock, 'sourceEnd'),
        };
      }

      const trailingParagraph = nodeClosest(range.startContainer, 'p[data-rich-trailing="true"]');
      if (trailingParagraph && els.rich.contains(trailingParagraph)) {
        const markdown = stripRichCaretTokens(state.markdown || els.source.value || '');
        const before = range.cloneRange();
        before.selectNodeContents(trailingParagraph);
        try {
          before.setEnd(range.startContainer, range.startOffset);
        } catch (_) {
          return null;
        }
        const localSource = stripRichCaretTokens(serializeInlineNodes(Array.from(before.cloneContents().childNodes)));
        const gap = markdown.length;
        return {
          offset: gap + localSource.length,
          contentStart: gap,
          contentEnd: gap,
          trailingParagraph: true,
        };
      }

      const blankParagraph = nodeClosest(range.startContainer, 'p[data-rich-transaction-blank][data-source-gap]');
      if (blankParagraph && els.rich.contains(blankParagraph)) {
        const gap = Number(blankParagraph.dataset.sourceGap);
        if (!Number.isFinite(gap)) return null;
        const before = range.cloneRange();
        before.selectNodeContents(blankParagraph);
        try {
          before.setEnd(range.startContainer, range.startOffset);
        } catch (_) {
          return null;
        }
        const localSource = stripRichCaretTokens(serializeInlineNodes(Array.from(before.cloneContents().childNodes)));
        return {
          offset: gap + localSource.length,
          contentStart: gap,
          contentEnd: gap,
          blankParagraph: true,
        };
      }

      const item = nodeClosest(range.startContainer, 'li');
      if (item && els.rich.contains(item)) {
        return richListSourcePointFromRange(item, range);
      }

      const cell = nodeClosest(range.startContainer, 'td, th');
      if (cell && els.rich.contains(cell)) {
        const point = richTableSourcePointFromRange(cell, range);
        return point ? { ...point, tableCell: true } : null;
      }

      const quote = nodeClosest(range.startContainer, 'blockquote');
      if (quote && els.rich.contains(quote)) {
        const point = richQuoteSourcePointFromRange(quote, range);
        return point ? { ...point, quoteBlock: true } : null;
      }

      const sourceBlock = nodeClosest(range.startContainer, RICH_SOURCE_BLOCK_SELECTOR);
      if (!sourceBlock) return null;
      const point = domPointToSourceOffset(range.startContainer, range.startOffset);
      if (!point) return null;
      const start = numericData(sourceBlock, 'sourceStart');
      const end = numericData(sourceBlock, 'sourceEnd');
      const contentStart = start + sourceContentBaseOffset(sourceBlock);
      if (!Number.isFinite(start) || !Number.isFinite(end) || point.offset < contentStart || point.offset > end) return null;
      return {
        offset: point.offset,
        contentStart,
        contentEnd: end,
      };
    }

    function richListSourcePointFromRange(item, range) {
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
      const content = visibleTextFromListSourceItem(sourceItem);
      if (isRichListItemEmpty(item)) {
        if (content.trim() !== '') return null;
        const sourceOffset = sourceOffsetFromListItemTextOffset(sourceItem, 0);
        return {
          offset: blockStart + sourceOffset,
          contentStart: blockStart + sourceItem.lines[0].start + sourceItem.parsed.prefix.length,
          contentEnd: blockStart + listSourceItemTextEnd(sourceItem),
        };
      }
      if (content !== visibleListItemText(item)) return null;
      const caretOffset = Math.max(0, Math.min(content.length, richListCaretSourceContentOffset(item, range)));
      const sourceOffset = sourceOffsetFromListItemTextOffset(sourceItem, caretOffset);
      return {
        offset: blockStart + sourceOffset,
        contentStart: blockStart + sourceItem.lines[0].start + sourceItem.parsed.prefix.length,
        contentEnd: blockStart + sourceItem.end,
      };
    }

    function richTableSourcePointFromRange(cell, range) {
      if (!cell?.matches?.('td, th') || !range?.collapsed) return null;
      const cellRange = richTableCellSourceRange(cell);
      if (!cellRange) return null;
      const before = range.cloneRange();
      before.selectNodeContents(cell);
      try {
        before.setEnd(range.startContainer, range.startOffset);
      } catch (_) {
        return null;
      }
      const localSource = serializeTableCellInlineNodes(Array.from(before.cloneContents().childNodes));
      const offset = Math.max(
        cellRange.contentStart,
        Math.min(cellRange.contentEnd, cellRange.contentStart + localSource.length),
      );
      return {
        offset,
        contentStart: cellRange.contentStart,
        contentEnd: cellRange.contentEnd,
      };
    }

    function richQuoteSourcePointFromRange(blockquote, range) {
      if (!blockquote?.matches?.('blockquote') || !range?.collapsed) return null;
      const blockStart = numericData(blockquote, 'sourceStart');
      const blockEnd = numericData(blockquote, 'sourceEnd');
      if (!Number.isFinite(blockStart) || !Number.isFinite(blockEnd)) return null;
      const raw = stripRichCaretTokens(state.markdown || '').slice(blockStart, blockEnd);
      const model = parseMarkdownQuoteSource(raw);
      if (!model?.lines?.length) return null;

      const before = range.cloneRange();
      before.selectNodeContents(blockquote);
      try {
        before.setEnd(range.startContainer, range.startOffset);
      } catch (_) {
        return null;
      }
      const renderedOffset = stripRichCaretTokens(serializeInlineNodes(Array.from(before.cloneContents().childNodes))).length;
      const mapped = quoteSourcePositionFromRenderedOffset(model, renderedOffset);
      if (!mapped) return null;
      return {
        offset: blockStart + mapped.sourceOffset,
        contentStart: blockStart + mapped.line.line.start + mapped.line.contentStart,
        contentEnd: blockStart + mapped.line.line.start + mapped.line.contentEnd,
        quote: {
          blockStart,
          blockEnd,
          model,
          lineIndex: mapped.lineIndex,
        },
      };
    }

    function parseMarkdownQuoteSource(raw) {
      const lines = getLines(raw).filter((line) => line.text.trim() !== '');
      const quoteLines = [];
      let renderedStart = 0;
      for (const line of lines) {
        const match = line.text.match(/^(\s*>\s?)(.*)$/);
        if (!match) return null;
        const prefix = match[1] || '';
        const content = match[2] || '';
        const contentStart = prefix.length;
        const contentEnd = line.text.length;
        quoteLines.push({
          line,
          prefix,
          content,
          contentStart,
          contentEnd,
          renderedStart,
          renderedEnd: renderedStart + content.length,
        });
        renderedStart += content.length + 1;
      }
      return { lines: quoteLines };
    }

    function quoteSourcePositionFromRenderedOffset(model, offset) {
      const lines = model?.lines || [];
      if (!lines.length) return null;
      const target = Math.max(0, Number(offset) || 0);
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (target <= line.renderedEnd) {
          const inLine = Math.max(0, Math.min(line.content.length, target - line.renderedStart));
          return {
            line,
            lineIndex: index,
            sourceOffset: line.line.start + line.contentStart + inLine,
          };
        }
        if (index < lines.length - 1 && target <= line.renderedEnd + 1) {
          const next = lines[index + 1];
          return {
            line: next,
            lineIndex: index + 1,
            sourceOffset: next.line.start + next.contentStart,
          };
        }
      }
      const lastIndex = lines.length - 1;
      const last = lines[lastIndex];
      return {
        line: last,
        lineIndex: lastIndex,
        sourceOffset: last.line.start + last.contentEnd,
      };
    }

    function richQuoteBoundaryDeleteTransaction(point, backward) {
      const quote = point?.quote;
      if (!quote?.model?.lines?.length) return null;
      const lines = quote.model.lines;
      const index = quote.lineIndex;
      const line = lines[index];
      if (!line) return null;
      const localOffset = point.offset - quote.blockStart;
      if (backward && index === 0 && localOffset === line.line.start + line.contentStart) {
        const from = quote.blockStart + line.line.start;
        const to = quote.blockStart + line.line.start + line.contentStart;
        return {
          from,
          to,
          insert: '',
          selectionAfter: {
            anchor: from,
            focus: from,
            affinity: 'before',
          },
        };
      }
      if (backward && index > 0 && localOffset === line.line.start + line.contentStart) {
        const previous = lines[index - 1];
        const from = quote.blockStart + previous.line.start + previous.contentEnd;
        const to = quote.blockStart + line.line.start + line.contentStart;
        return {
          from,
          to,
          insert: '',
          selectionAfter: {
            anchor: from,
            focus: from,
            affinity: 'before',
          },
        };
      }
      if (!backward && index < lines.length - 1 && localOffset === line.line.start + line.contentEnd) {
        const next = lines[index + 1];
        const from = quote.blockStart + line.line.start + line.contentEnd;
        const to = quote.blockStart + next.line.start + next.contentStart;
        return {
          from,
          to,
          insert: '',
          selectionAfter: {
            anchor: from,
            focus: from,
            affinity: 'after',
          },
        };
      }
      if (!backward && index === lines.length - 1 && localOffset === line.line.start + line.contentEnd) {
        const nextContentStart = nextMarkdownContentStartAfterOffset(quote.blockEnd);
        const from = quote.blockStart + line.line.start + line.contentEnd;
        if (Number.isFinite(nextContentStart) && nextContentStart > from) {
          return {
            from,
            to: nextContentStart,
            insert: '',
            selectionAfter: {
              anchor: from,
              focus: from,
              affinity: 'after',
            },
          };
        }
      }
      return null;
    }

    function nextMarkdownContentStartAfterOffset(offset) {
      const markdown = stripRichCaretTokens(state.markdown || els.source.value || '');
      const start = Math.max(0, Math.min(markdown.length, Number(offset)));
      for (let index = start; index < markdown.length; index += 1) {
        if (markdown[index] !== '\n' && markdown[index] !== '\r') return index;
      }
      return null;
    }

    function richTableCellSourceRange(cell) {
      const location = richTableCellLocation(cell);
      if (!location) return null;
      const table = location.table;
      if (!table.matches?.(RICH_SOURCE_BLOCK_SELECTOR)) return null;
      const blockStart = numericData(table, 'sourceStart');
      const blockEnd = numericData(table, 'sourceEnd');
      if (!Number.isFinite(blockStart) || !Number.isFinite(blockEnd)) return null;
      const raw = stripRichCaretTokens(state.markdown || '').slice(blockStart, blockEnd);
      const model = parseMarkdownTableSource(raw);
      const sourceRow = model?.rows?.[location.lineIndex];
      const sourceCell = sourceRow?.cells?.[location.cellIndex];
      if (!sourceRow || !sourceCell) return null;
      return {
        table,
        blockStart,
        blockEnd,
        line: sourceRow.line,
        cell: sourceCell,
        contentStart: blockStart + sourceRow.line.start + sourceCell.contentStart,
        contentEnd: blockStart + sourceRow.line.start + sourceCell.contentEnd,
      };
    }

    function richTableCellLocation(cell) {
      if (!cell?.matches?.('td, th')) return null;
      const table = cell.closest('table');
      const row = cell.parentElement;
      if (!table || !row || !els.rich.contains(table)) return null;
      const cellIndex = Array.from(row.children).indexOf(cell);
      if (cellIndex < 0) return null;
      if (cell.tagName?.toLowerCase() === 'th') {
        return { table, lineIndex: 0, cellIndex };
      }
      const bodyRows = Array.from(table.querySelectorAll('tbody > tr'));
      const bodyIndex = bodyRows.indexOf(row);
      return bodyIndex >= 0 ? { table, lineIndex: bodyIndex + 2, cellIndex } : null;
    }

    function parseMarkdownTableSource(raw) {
      const lines = getLines(raw).filter((line) => line.text.trim() !== '');
      if (lines.length < 2) return null;
      return {
        lines,
        rows: lines.map((line) => ({
          line,
          cells: splitTableRowWithSourceRanges(line.text),
        })),
      };
    }

    function splitTableRowWithSourceRanges(line) {
      const value = String(line || '');
      let start = 0;
      let end = value.length;
      if (value[start] === '|') start += 1;
      if (end > start && value[end - 1] === '|') end -= 1;

      const cells = [];
      let cellStart = start;
      for (let index = start; index <= end; index += 1) {
        const atEnd = index === end;
        const isPipe = !atEnd && value[index] === '|' && !isEscapedMarkdownPipe(value, index);
        if (!atEnd && !isPipe) continue;
        cells.push(tableCellSourceRangeFromSegment(value, cellStart, index));
        cellStart = index + 1;
      }
      return cells;
    }

    function isEscapedMarkdownPipe(value, index) {
      if (String(value || '')[index] !== '|') return false;
      let slashCount = 0;
      for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) {
        slashCount += 1;
      }
      return slashCount % 2 === 1;
    }

    function unescapeMarkdownTableCell(value) {
      return String(value || '').replace(/\\\|/g, '|');
    }

    function tableCellSourceRangeFromSegment(row, start, end) {
      const segment = row.slice(start, end);
      const leading = segment.match(/^\s*/)?.[0].length || 0;
      const trailing = segment.match(/\s*$/)?.[0].length || 0;
      const contentStart = start + leading;
      const contentEnd = Math.max(contentStart, end - trailing);
      return {
        start,
        end,
        contentStart,
        contentEnd,
        raw: row.slice(contentStart, contentEnd),
      };
    }

    function shouldLetDomHandleMarkdownShortcutInput(range, text) {
      const block = nodeClosest(range.startContainer, 'p');
      if (!block || block.closest('li') || !block.matches?.(RICH_SOURCE_BLOCK_SELECTOR)) return false;
      const current = normalizeRichText(block.textContent || '');
      const caretOffset = getCaretCharacterOffsetWithin(block, window.getSelection?.());
      const next = `${current.slice(0, caretOffset)}${text}${current.slice(caretOffset)}`;
      return isPendingMarkdownShortcutText(next);
    }

    function isPendingMarkdownShortcutText(text) {
      return /^[-+*] $/.test(text)
        || /^1\. $/.test(text)
        || /^- \[(?: |x|X)?\]? ?$/.test(text)
        || text === '| '
        || text === '---'
        || text === '$$'
        || text === '$$$$'
        || text === '$$ '
        || text === '$$$$ ';
    }

    function richInlineBoundaryInsertTransaction(inlineElement, text, boundary) {
      if (!inlineElement?.classList?.contains('rich-inline-atom')) return null;
      const start = Number(inlineElement.dataset.srcStart);
      const end = Number(inlineElement.dataset.srcEnd);
      if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
      const from = boundary === 'before' ? start : end;
      const nextOffset = from + String(text || '').length;
      return {
        from,
        to: from,
        insert: String(text || ''),
        selectionAfter: {
          anchor: nextOffset,
          focus: nextOffset,
          affinity: 'after',
        },
      };
    }

    function applySourceTransaction(transaction, reason = 'source-transaction') {
      if (!transaction) return false;
      const markdown = stripRichCaretTokens(state.markdown || els.source.value || '');
      let from = Math.max(0, Math.min(markdown.length, Number(transaction.from)));
      let to = Math.max(from, Math.min(markdown.length, Number(transaction.to)));
      let insert = stripRichCaretTokens(transaction.insert || '');
      const oldRichBlock = state.mode === 'rich' ? richSourceTransactionBlockForRange(from, to, transaction.selectionAfter) : null;
      const shortcut = richMarkdownShortcutTransactionRewrite(oldRichBlock, markdown, from, to, insert, reason);
      if (shortcut) {
        from = shortcut.from;
        to = shortcut.to;
        insert = shortcut.insert;
        transaction = {
          ...transaction,
          selectionAfter: shortcut.selectionAfter,
          blankParagraphAt: shortcut.blankParagraphAt,
        };
        setStatus(shortcut.status);
      }
      const canPatchRich = canPatchRichBlockTransaction(oldRichBlock, from, to, insert);
      state.markdown = markdown.slice(0, from) + insert + markdown.slice(to);
      els.source.value = state.markdown;
      syncCodeMirrorSourceFromTextarea(reason);
      markDirty();
      if (canPatchRich && patchRichBlockAfterTransaction(oldRichBlock, transaction.selectionAfter?.focus ?? from + insert.length)) {
        if (refreshRichSourceRangesFromMarkdown()) {
          renderPreview();
          renderOutline();
          updateStatusBar();
        } else {
          renderAll(reason);
        }
      } else {
        renderAll(reason);
      }
      const shouldRestoreAfterBlankParagraph = transaction.placeCaretInBlankParagraph === false;
      if (shouldRestoreAfterBlankParagraph && Number.isFinite(transaction.blankParagraphAt)) {
        ensureRichBlankParagraphAtSourceGap(transaction.blankParagraphAt, { placeCaret: false });
      }
      restoreRichCaretFromSourceSelection(transaction.selectionAfter);
      if (!shouldRestoreAfterBlankParagraph && Number.isFinite(transaction.blankParagraphAt)) {
        ensureRichBlankParagraphAtSourceGap(transaction.blankParagraphAt);
      }
      scheduleAutosave();
      return true;
    }

    function richSourceTransactionBlockForRange(from, to, selectionAfter) {
      return renderedBlockForSourceOffset(els.rich, from)
        || renderedBlockForSourceOffset(els.rich, to)
        || renderedBlockForSourceOffset(els.rich, selectionAfter?.focus)
        || renderedBlockForSourceOffset(els.rich, selectionAfter?.anchor);
    }

    function richMarkdownShortcutTransactionRewrite(oldRichBlock, markdown, from, to, insert, reason) {
      if (!isRichMarkdownShortcutTransactionReason(reason) || !oldRichBlock?.matches?.(`p${RICH_SOURCE_BLOCK_SELECTOR}`)) return null;
      if (oldRichBlock.closest('li') || String(insert || '').includes('\n')) return null;
      const start = numericData(oldRichBlock, 'sourceStart');
      const end = numericData(oldRichBlock, 'sourceEnd');
      if (!Number.isFinite(start) || !Number.isFinite(end) || from < start || to > end) return null;
      const nextBlockSource = markdown.slice(start, from) + insert + markdown.slice(to, end);
      const replacement = richBlockMarkdownTriggerReplacement(nextBlockSource, { allowBareMath: false });
      if (!replacement) return null;
      const selectionOffset = start + (Number.isFinite(replacement.selectionOffset)
        ? replacement.selectionOffset
        : replacement.insert.length);
      return {
        from: start,
        to: end,
        insert: replacement.insert,
        selectionAfter: {
          anchor: selectionOffset,
          focus: selectionOffset,
          affinity: 'after',
        },
        blankParagraphAt: replacement.blankParagraphAt ? start + replacement.insert.length : undefined,
        status: replacement.status,
      };
    }

    function isRichMarkdownShortcutTransactionReason(reason) {
      return [
        'rich-text-insert',
        'rich-selection-insert',
        'rich-selection-replace',
        'rich-input-source-fallback',
        'rich-composition',
        'rich-inline-boundary-insert',
        'rich-paste',
      ].includes(reason);
    }

    function canPatchRichBlockTransaction(oldRichBlock, from, to, insert) {
      if (!oldRichBlock || String(insert).includes('\n')) return false;
      const start = numericData(oldRichBlock, 'sourceStart');
      const end = numericData(oldRichBlock, 'sourceEnd');
      return Number.isFinite(start) && Number.isFinite(end) && start <= from && to <= end;
    }

    function patchRichBlockAfterTransaction(oldRichBlock, focusOffset) {
      if (!oldRichBlock?.isConnected) return false;
      const blocks = buildBlockModel(state.markdown);
      const block = blocks.find((item) => item.start <= focusOffset && focusOffset <= item.end)
        || blocks.find((item) => item.start <= numericData(oldRichBlock, 'sourceStart') && numericData(oldRichBlock, 'sourceStart') <= item.end);
      if (!block) return false;
      const headings = buildHeadingIndex(blocks);
      const template = document.createElement('template');
      template.innerHTML = annotateRenderedBlockHtml(renderBlockHtml(block, headings), block);
      enhanceRenderedHtml(template.content);
      preserveRichInlineTrailingWhitespace(template.content, block.raw);
      const nextNodes = Array.from(template.content.childNodes);
      if (!nextNodes.length) return false;
      try {
        oldRichBlock.replaceWith(...nextNodes);
      } catch (_) {
        return false;
      }
      stabilizePatchedRichInlineBlocks(nextNodes);
      ensureRichTrailingEditableParagraph();
      configureRichEditableSurface();
      return true;
    }

    function preserveRichInlineTrailingWhitespace(root, source) {
      const trailing = String(source || '').match(/[ \t]+$/)?.[0] || '';
      if (!trailing || !root?.querySelector) return false;
      const block = root.querySelector(RICH_SOURCE_BLOCK_SELECTOR);
      if (!block?.matches?.(RICH_INLINE_EDIT_BLOCK_SELECTOR)) return false;
      if (/[ \t\u00a0]$/.test(block.textContent || '')) return false;
      block.appendChild(document.createTextNode(trailing.replace(/ /g, '\u00a0')));
      return true;
    }

    function stabilizePatchedRichInlineBlocks(nodes) {
      let changed = false;
      for (const node of nodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (!node.matches?.(RICH_INLINE_EDIT_BLOCK_SELECTOR)) continue;
        if (parsePendingRichInlineMarkdownInBlock(node)) changed = true;
        wrapRenderedInlineAtoms(node);
      }
      if (changed) annotateRenderedInlineAtomRanges(els.rich);
      return changed;
    }

    function ensureRichBlankParagraphAtSourceGap(offset, options = {}) {
      if (state.mode !== 'rich' || !els.rich) return false;
      const target = Number(offset);
      if (!Number.isFinite(target)) return false;
      const placeCaret = options.placeCaret !== false;
      const existing = richEmptySourceParagraphAtGap(target);
      if (existing) {
        state.richTransactionBlank = null;
        configureRichEditableSurface();
        if (placeCaret) placeCaretAtStart(existing);
        return true;
      }
      const paragraph = document.createElement('p');
      paragraph.dataset.richTransactionBlank = placeCaret ? 'true' : 'visual';
      paragraph.dataset.sourceGap = String(target);
      if (!placeCaret) {
        paragraph.setAttribute('contenteditable', 'false');
        paragraph.setAttribute('aria-hidden', 'true');
      }
      const anchor = document.createElement('span');
      anchor.className = 'rich-list-caret-anchor';
      const textNode = document.createTextNode('\u200b');
      anchor.appendChild(textNode);
      paragraph.appendChild(anchor);
      paragraph.appendChild(document.createElement('br'));

      const blocks = Array.from(els.rich.querySelectorAll(RICH_SOURCE_BLOCK_SELECTOR));
      const nextBlock = blocks.find((block) => numericData(block, 'sourceStart') >= target);
      const previousBlock = blocks.slice().reverse().find((block) => numericData(block, 'sourceEnd') <= target);
      if (nextBlock?.parentNode === els.rich) {
        nextBlock.before(paragraph);
      } else if (previousBlock?.parentNode === els.rich) {
        previousBlock.after(paragraph);
      } else {
        els.rich.appendChild(paragraph);
      }
      state.richTransactionBlank = placeCaret ? { element: paragraph, sourceGap: target } : null;
      configureRichEditableSurface();
      if (placeCaret) placeCaretInTextNode(textNode, textNode.nodeValue.length);
      return true;
    }

    function richEmptySourceParagraphAtGap(offset) {
      return Array.from(els.rich?.querySelectorAll?.(`p${RICH_SOURCE_BLOCK_SELECTOR}`) || [])
        .find((paragraph) => (
          numericData(paragraph, 'sourceStart') === offset
          && numericData(paragraph, 'sourceEnd') === offset
          && isEmptyRichParagraph(paragraph)
        )) || null;
    }

    function onDocumentBeforeInput(event) {
      if (isProseMirrorRichTarget(eventTargetElement(event))) return;
      onRichBeforeInput(event);
    }

    function onDocumentKeyUp(event) {
      if (event.defaultPrevented || state.mode !== 'rich' || event.key !== ' ') return;
      if (isProseMirrorRichActive()) return;
      applyRichQuoteShortcutAfterSpaceKey();
    }

    function applyRichQuoteShortcutAfterSpaceKey() {
      const selection = window.getSelection?.();
      const selectedBlock = selection?.rangeCount && els.rich.contains(selection.anchorNode)
        ? nodeClosest(selection.anchorNode, 'p')
        : null;
      const candidates = selectedBlock ? [selectedBlock] : Array.from(els.rich.querySelectorAll('p'));
      for (const block of candidates) {
        if (!block || block.closest('li') || normalizeRichText(block.textContent || '') !== '| ') continue;
        if (block.matches?.(RICH_SOURCE_BLOCK_SELECTOR) && applyRichBlockMarkdownTriggerTransaction(block, '| ', { allowBareMath: false })) {
          return true;
        }
        replaceParagraphWithTriggeredQuote(block);
        return true;
      }
      return false;
    }

    function isRichBeforeInputContext(event) {
      if (state.mode !== 'rich' || state.richComposing) return false;
      const target = eventTargetElement(event);
      if (isProseMirrorRichTarget(target)) return false;
      const selection = window.getSelection?.();
      if (selection?.anchorNode && nodeClosest(selection.anchorNode, '.rich-inline-source')) return false;
      if (target?.closest?.('.task-checkbox, .code-language-input, .rich-source-editor, .rich-inline-source')) return false;
      if (target && els.rich.contains(target)) return true;
      return Boolean(
        selection
        && selection.rangeCount
        && selection.isCollapsed
        && els.rich.contains(selection.anchorNode)
      );
    }

    function maybeApplyRichMarkdownTrigger(_event) {
      if (state.richComposing || state.richInlineSource?.element) return false;
      const selection = window.getSelection?.();
      if (!selection || !selection.rangeCount || !selection.isCollapsed || !els.rich.contains(selection.anchorNode)) return false;
      if (nodeClosest(selection.anchorNode, '.rich-source-editor, .code-language-input, .rich-inline-source')) return false;
      if (nodeClosest(selection.anchorNode, '.mermaid-diagram, pre.code-block, .math-display')) return false;

      return applyRichBlockMarkdownTrigger(selection)
        || applyRichInlineMarkdownTrigger(selection)
        || applyRichInlineMarkdownRunTrigger();
    }

    function applyRichBlockMarkdownTrigger(selection) {
      const block = nodeClosest(selection.anchorNode, 'p');
      if (!block || block.closest('li')) return false;
      const caretOffset = getCaretCharacterOffsetWithin(block, selection);
      const text = normalizeRichText(block.textContent || '');
      const blockReplacement = richBlockMarkdownTriggerReplacement(text, { allowBareMath: false });
      if (caretOffset !== text.length && !blockReplacement) return false;

      if (applyRichBlockMarkdownTriggerTransaction(block, text, { allowBareMath: false })) return true;

      if (text === '$$$$ ') {
        replaceParagraphWithMathDisplayEditor(block);
        return true;
      }

      if (text === '$$ ') {
        replaceParagraphWithMathInlineSource(block);
        return true;
      }

      if (text === '| ') {
        replaceParagraphWithTriggeredQuote(block);
        return true;
      }

      if (text === '---') {
        replaceParagraphWithHorizontalRule(block);
        return true;
      }

      const task = text.match(/^- \[( |x|X)\] $/);
      if (task) {
        replaceParagraphWithTriggeredList(block, { ordered: false, task: true, checked: task[1].toLowerCase() === 'x' });
        return true;
      }

      const dashList = text.match(/^- (.+)$/);
      if (dashList && !isPendingTaskListPrefix(text)) {
        replaceParagraphWithTriggeredList(block, { ordered: false, task: false, checked: false, content: dashList[1] });
        return true;
      }

      if (/^[*+] $/.test(text) || text === '-  ') {
        replaceParagraphWithTriggeredList(block, { ordered: false, task: false, checked: false });
        return true;
      }

      if (/^1\. $/.test(text)) {
        replaceParagraphWithTriggeredList(block, { ordered: true, task: false, checked: false });
        return true;
      }

      return false;
    }

    function isPendingTaskListPrefix(text) {
      return /^- \[(?: |x|X)?\]? ?$/.test(text);
    }

    function applyRichBlockMarkdownTriggerTransaction(block, text, options = {}) {
      const replacement = richBlockMarkdownTriggerReplacement(text, options);
      if (!replacement || !block?.matches?.(RICH_SOURCE_BLOCK_SELECTOR)) return false;
      const start = numericData(block, 'sourceStart');
      const end = numericData(block, 'sourceEnd');
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return false;
      const insert = replacement.insert;
      const selectionOffset = start + (Number.isFinite(replacement.selectionOffset) ? replacement.selectionOffset : insert.length);
      state.richInputUsedSourceTransaction = true;
      applySourceTransaction({
        from: start,
        to: end,
        insert,
        selectionAfter: {
          anchor: selectionOffset,
          focus: selectionOffset,
          affinity: 'after',
        },
        blankParagraphAt: replacement.blankParagraphAt ? start + insert.length : undefined,
      }, `rich-markdown-trigger-${replacement.kind}`);
      finishRichBlockMarkdownTriggerReplacement(replacement, start, insert.length);
      return true;
    }

    function finishRichBlockMarkdownTriggerReplacement(replacement, start, insertLength) {
      if (replacement.kind === 'math-inline') {
        if (!activateInsertedInlineSource(start, start + insertLength, 1, 1)) {
          const block = renderedBlockForSourceOffset(els.rich, start);
          if (block?.tagName?.toLowerCase() === 'p') replaceParagraphWithMathInlineSource(block);
        }
      } else if (replacement.kind === 'math-display') {
        openInsertedDisplayMathSourceEditor(start, insertLength);
      }
      setStatus(replacement.status);
    }

    function guardUnsupportedRichBlockMarkdownTriggerFallback(block) {
      if (!block?.matches?.(RICH_SOURCE_BLOCK_SELECTOR)) return false;
      setStatus('このMarkdownショートカットを反映できませんでした');
      suppressRichInlineActivation();
      return true;
    }

    function richBlockMarkdownTriggerReplacement(text, options = {}) {
      const value = String(text || '');
      const allowBareMath = options.allowBareMath !== false;
      if (!allowBareMath && (value === '$$' || value === '$$$$')) return null;
      if (value === '$$' || value === '$$ ') {
        return {
          kind: 'math-inline',
          insert: '$$',
          selectionOffset: 1,
          status: 'インライン数式を挿入しました',
        };
      }
      if (value === '$$$$' || value === '$$$$ ') {
        return {
          kind: 'math-display',
          insert: '$$$$',
          selectionOffset: 2,
          status: '数式ブロックを挿入しました',
        };
      }
      if (value === '| ') {
        return {
          kind: 'quote',
          insert: '> ',
          status: '引用を開始しました',
        };
      }
      if (value === '---') {
        return {
          kind: 'rule',
          insert: '---',
          blankParagraphAt: true,
          status: '横線を挿入しました',
        };
      }
      const task = value.match(/^- \[( |x|X)\] $/);
      if (task) {
        return {
          kind: 'task-list',
          insert: `- [${task[1].toLowerCase() === 'x' ? 'x' : ' '}] `,
          status: 'チェックリストを開始しました',
        };
      }
      const dashList = value.match(/^- (.+)$/);
      if (dashList && !isPendingTaskListPrefix(value)) {
        return {
          kind: 'list',
          insert: `- ${dashList[1]}`,
          status: '箇条書きを開始しました',
        };
      }
      if (/^[*+] $/.test(value) || value === '-  ') {
        return {
          kind: 'list',
          insert: `${value[0]} `,
          status: '箇条書きを開始しました',
        };
      }
      if (/^1\. $/.test(value)) {
        return {
          kind: 'ordered-list',
          insert: '1. ',
          status: '番号付きリストを開始しました',
        };
      }
      return null;
    }

    function openInsertedDisplayMathSourceEditor(start, length) {
      const end = start + length;
      const display = Array.from(els.rich.querySelectorAll('.math-display'))
        .find((element) => Number(element.dataset.sourceStart) === start && Number(element.dataset.sourceEnd) === end);
      if (!display) return false;
      showRichSourceEditor('math', display, { editorValue: '$$$$', caretOffset: 2 });
      return true;
    }

    function activatePendingMathShortcutFromSelection() {
      if (state.mode !== 'rich' || state.richComposing) return false;
      const selection = window.getSelection?.();
      if (!selection || !selection.rangeCount || !selection.isCollapsed || !els.rich.contains(selection.anchorNode)) return false;
      const block = nodeClosest(selection.anchorNode, 'p');
      if (!block || block.closest('li')) return false;
      const text = normalizeRichText(block.textContent || '');
      if (text === '$$$$') {
        if (applyRichBlockMarkdownTriggerTransaction(block, text, { allowBareMath: true })) return true;
        if (guardUnsupportedRichBlockMarkdownTriggerFallback(block)) return true;
        replaceParagraphWithMathDisplayEditor(block);
        syncRichMarkdownFromDom('rich-input');
        return true;
      }
      if (text === '$$') {
        if (applyRichBlockMarkdownTriggerTransaction(block, text, { allowBareMath: true })) return true;
        if (guardUnsupportedRichBlockMarkdownTriggerFallback(block)) return true;
        replaceParagraphWithMathInlineSource(block);
        syncRichMarkdownFromDom('rich-input');
        return true;
      }
      return false;
    }

    function replaceParagraphWithTriggeredList(block, config) {
      const list = document.createElement(config.ordered ? 'ol' : 'ul');
      if (config.task) list.className = 'task-list';
      const item = document.createElement('li');
      if (config.task) {
        item.className = 'task-list-item';
        const checkbox = createTaskCheckbox();
        checkbox.checked = Boolean(config.checked);
        item.appendChild(checkbox);
      }
      const content = String(config.content || '');
      if (content) {
        item.appendChild(document.createTextNode(content));
      } else {
        item.appendChild(document.createTextNode(''));
        item.appendChild(document.createElement('br'));
      }
      list.appendChild(item);

      state.richSelectionLock = true;
      block.replaceWith(list);
      if (content) {
        placeCaretAtListItemEnd(item);
      } else {
        placeCaretAtListItemStart(item);
      }
      state.richSelectionLock = false;
    }

    function replaceParagraphWithTriggeredQuote(block) {
      const quote = document.createElement('blockquote');
      const paragraph = document.createElement('p');
      paragraph.appendChild(document.createTextNode(''));
      paragraph.appendChild(document.createElement('br'));
      quote.appendChild(paragraph);

      state.richSelectionLock = true;
      block.replaceWith(quote);
      placeCaretAtStart(paragraph);
      state.richSelectionLock = false;
    }

    function replaceParagraphWithHorizontalRule(block) {
      const rule = document.createElement('hr');
      rule.setAttribute('contenteditable', 'false');
      const paragraph = document.createElement('p');
      paragraph.appendChild(document.createTextNode(''));
      paragraph.appendChild(document.createElement('br'));

      state.richSelectionLock = true;
      block.replaceWith(rule, paragraph);
      placeCaretAtStart(paragraph);
      state.richSelectionLock = false;
    }

    function replaceParagraphWithMathInlineSource(block) {
      const sourceElement = createRichInlineSourceElement('$$');
      state.richSelectionLock = true;
      block.replaceChildren(sourceElement);
      state.richInlineSource = { element: sourceElement };
      placeCaretInInlineSource(sourceElement, 1);
      state.richSelectionLock = false;
    }

    function replaceParagraphWithMathDisplayEditor(block) {
      const display = document.createElement('div');
      display.className = 'math-display';
      display.setAttribute('data-math-source', '');
      display.setAttribute('data-math-display', 'true');
      display.setAttribute('contenteditable', 'false');

      state.richSelectionLock = true;
      block.replaceWith(display);
      showRichSourceEditor('math', display, { editorValue: '$$$$', caretOffset: 2 });
      state.richSelectionLock = false;
    }

    function applyRichInlineMarkdownTrigger(selection) {
      const range = richSelectionRange(selection);
      if (!range?.collapsed) return false;
      const caret = textCaretForMarkdownTrigger(range);
      if (!caret) return false;
      const { textNode, caretOffset } = mergeAdjacentTextNodesForMarkdownTrigger(caret.textNode, caret.caretOffset);
      const before = textNode.nodeValue.slice(0, caretOffset);

      if (before.endsWith('$$ ') && !before.endsWith('$$$$ ')) {
        replaceTextRangeWithRichInlineSource(textNode, caretOffset - 3, caretOffset, '$$', 1);
        return true;
      }

      if (before.endsWith('****')) {
        replaceTextRangeWithRichInlineSource(textNode, caretOffset - 4, caretOffset, '****', 2);
        return true;
      }

      const trigger = findCompletedInlineMarkdownTrigger(before);
      if (!trigger) return false;
      replaceTextRangeWithRichInlineHtml(textNode, caretOffset - trigger.source.length, caretOffset, trigger.source);
      return true;
    }

    function applyRichInlineMarkdownRunTrigger() {
      const selection = window.getSelection?.();
      const range = richSelectionRange(selection);
      if (!range?.collapsed) return false;
      const caret = textCaretForMarkdownTrigger(range);
      if (!caret) return false;
      const before = (caret.textNode.nodeValue || '').slice(0, caret.caretOffset).replace(/\u200b/g, '');
      if (!/[`*_~$]$/.test(before)) return false;
      if (!richInlineMarkdownBeforeCaretEndsWithCompletedToken(before)) return false;

      const block = richInlineEditBlockForRange(range);
      if (!block || block.closest('.mermaid-diagram, pre.code-block, .math-display, .toc')) return false;

      const markdown = serializeRichInlineEditBlockContent(block);
      if (!richInlineMarkdownSourceHasCompletedToken(markdown)) return false;
      return reparseRichInlineEditBlockContent(block, {
        range,
        sourceSelection: domSelectionToSourceSelection(selection),
      });
    }

    function richInlineMarkdownBeforeCaretEndsWithCompletedToken(before) {
      const parts = splitPendingRichInlineMarkdown(String(before || ''));
      const last = parts[parts.length - 1];
      return Boolean(
        last
        && (last.type === 'markdown' || last.type === 'source')
        && String(before || '').endsWith(last.value)
      );
    }

    function textCaretForMarkdownTrigger(range) {
      if (range.startContainer.nodeType === Node.TEXT_NODE) {
        return { textNode: range.startContainer, caretOffset: range.startOffset };
      }

      if (range.startContainer.nodeType !== Node.ELEMENT_NODE) return null;
      const editBlock = richInlineEditBlockForRange(range);
      if (!editBlock) return null;
      const before = adjacentCaretNode(range.startContainer, range.startOffset, 'before');
      if (before?.nodeType === Node.TEXT_NODE && editBlock.contains(before)) {
        return { textNode: before, caretOffset: before.nodeValue.length };
      }
      return null;
    }

    function mergeAdjacentTextNodesForMarkdownTrigger(textNode, caretOffset) {
      const parent = textNode?.parentNode;
      if (!parent) return { textNode, caretOffset };
      const editBlock = nodeClosest(textNode, RICH_INLINE_EDIT_BLOCK_SELECTOR);
      const nodes = [textNode];

      let previous = textNode.previousSibling;
      while (previous?.nodeType === Node.TEXT_NODE && nodeClosest(previous, RICH_INLINE_EDIT_BLOCK_SELECTOR) === editBlock) {
        nodes.unshift(previous);
        previous = previous.previousSibling;
      }

      let next = textNode.nextSibling;
      while (next?.nodeType === Node.TEXT_NODE && nodeClosest(next, RICH_INLINE_EDIT_BLOCK_SELECTOR) === editBlock) {
        nodes.push(next);
        next = next.nextSibling;
      }

      if (nodes.length === 1) return { textNode, caretOffset };

      let rawOffset = caretOffset;
      for (const node of nodes) {
        if (node === textNode) break;
        rawOffset += (node.nodeValue || '').length;
      }

      const rawValue = nodes.map((node) => node.nodeValue || '').join('');
      const beforeCaret = rawValue.slice(0, rawOffset).replace(/\u200b/g, '');
      const afterCaret = rawValue.slice(rawOffset).replace(/\u200b/g, '');
      const mergedOffset = beforeCaret.length;
      const merged = document.createTextNode(beforeCaret + afterCaret);
      parent.insertBefore(merged, nodes[0]);
      for (const node of nodes) node.remove();
      placeCaretInTextNode(merged, mergedOffset);
      return { textNode: merged, caretOffset: mergedOffset };
    }

    function findCompletedInlineMarkdownTrigger(textBeforeCaret) {
      const patterns = [
        /(`[^`\n]+`)$/,
        /(~~[^~\n]+~~)$/,
        /(\*\*[^*\n]+?\*\*)$/,
      ];

      for (const pattern of patterns) {
        const match = textBeforeCaret.match(pattern);
        if (match) return { source: match[1] };
      }

      const italic = textBeforeCaret.match(/(^|[^*])(\*[^*\n]+\*)$/);
      return italic ? { source: italic[2] } : null;
    }

    function richInlineMarkdownSourceHasCompletedToken(source) {
      return splitPendingRichInlineMarkdown(String(source || ''))
        .some((part) => part.type === 'markdown' || part.type === 'source');
    }

    function parsePendingRichInlineMarkdownBeforePointer(target) {
      if (state.mode !== 'rich' || state.richComposing || state.richInlineSource?.element) return false;
      if (target?.closest?.('.rich-inline-source, .rich-source-editor, .code-language-input')) return false;
      const selection = window.getSelection?.();
      const range = richSelectionRange(selection);
      if (!range?.collapsed) return false;
      if (nodeClosest(range.startContainer, '.rich-inline-source, .rich-source-editor, .code-language-input')) return false;
      const block = richInlineEditBlockForRange(range);
      if (!block || block.closest('.mermaid-diagram, pre.code-block, .math-display')) return false;
      const targetBlock = target && els.rich.contains(target) ? nodeClosest(target, RICH_INLINE_EDIT_BLOCK_SELECTOR) : null;
      if (targetBlock === block) return false;

      if (!parsePendingRichInlineMarkdownInBlock(block)) return false;
      configureRichEditableSurface();
      suppressRichInlineActivation();
      finalizeRichProjectionChange('rich-input');
      return true;
    }

    function parsePendingRichInlineMarkdownInBlock(block) {
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          if (nodeClosest(node, '.rich-inline-source, .rich-source-editor, pre.code-block, .math-display, .mermaid-diagram')) {
            return NodeFilter.FILTER_REJECT;
          }
          if (nodeClosest(node, RICH_INLINE_SOURCE_SELECTOR)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      });
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      let changed = false;
      for (const node of nodes) {
        if (replacePendingRichInlineMarkdownTextNode(node)) changed = true;
      }
      return changed;
    }

    function replacePendingRichInlineMarkdownTextNode(textNode) {
      if (!textNode.isConnected) return false;
      const parts = splitPendingRichInlineMarkdown(textNode.nodeValue || '');
      if (!parts.some((part) => part.type === 'markdown' || part.type === 'source')) return false;

      const fragment = document.createDocumentFragment();
      for (const part of parts) {
        if (part.type === 'text') {
          if (part.value) fragment.appendChild(document.createTextNode(part.value));
          continue;
        }
        if (part.type === 'source') {
          fragment.appendChild(createRichInlineSourceElement(part.value));
          continue;
        }
        fragment.appendChild(renderRichInlineSourceFragment(part.value));
      }
      textNode.replaceWith(fragment);
      return true;
    }

    function splitPendingRichInlineMarkdown(text) {
      const parts = [];
      let index = 0;
      let textStart = 0;
      while (index < text.length) {
        const token = pendingRichInlineMarkdownTokenAt(text, index);
        if (!token) {
          index += 1;
          continue;
        }
        if (index > textStart) parts.push({ type: 'text', value: text.slice(textStart, index) });
        parts.push(token);
        index += token.value.length;
        textStart = index;
      }
      if (textStart < text.length) parts.push({ type: 'text', value: text.slice(textStart) });
      return parts.length ? parts : [{ type: 'text', value: text }];
    }

    function pendingRichInlineMarkdownTokenAt(text, index) {
      const rest = text.slice(index);
      if (rest.startsWith('****')) return { type: 'source', value: '****' };

      const anchoredPatterns = [
        /^!\[[^\]\n]*\]\((?:<[^>\n]+>|[^)\n]+)\)/,
        /^\[[^\]\n]+\]\((?:<[^>\n]+>|[^)\n]+)\)/,
        /^`[^`\n]+`/,
        /^~~[^~\n]+~~/,
        /^\*\*[^*\n]+?\*\*/,
        /^__[^_\n]+?__/,
        /^\$\$[^\n$]+?\$\$/,
        /^\$[^\s$][^\n$]*?\$/,
        /^\\\([^)]+\\\)/,
      ];
      for (const pattern of anchoredPatterns) {
        const match = rest.match(pattern);
        if (match) return { type: 'markdown', value: match[0] };
      }

      if (rest[0] === '*' && rest[1] !== '*' && canOpenSingleDelimiterAt(text, index, '*')) {
        const close = rest.indexOf('*', 1);
        if (close > 1 && !rest.slice(1, close).includes('\n')) {
          return { type: 'markdown', value: rest.slice(0, close + 1) };
        }
      }

      if (rest[0] === '_' && rest[1] !== '_' && canOpenSingleDelimiterAt(text, index, '_')) {
        const close = rest.indexOf('_', 1);
        if (close > 1 && !rest.slice(1, close).includes('\n')) {
          return { type: 'markdown', value: rest.slice(0, close + 1) };
        }
      }

      return null;
    }

    function canOpenSingleDelimiterAt(text, index, delimiter) {
      if (text[index - 1] !== delimiter) return true;
      return text[index - 2] === delimiter;
    }

    function replaceTextRangeWithRichInlineSource(textNode, start, end, source, caretOffset) {
      const sourceElement = createRichInlineSourceElement(source);
      replaceTextNodeRange(textNode, start, end, [sourceElement]);
      state.richInlineSource = { element: sourceElement };
      placeCaretInInlineSource(sourceElement, caretOffset);
    }

    function createRichInlineSourceElement(source) {
      const sourceElement = document.createElement('span');
      sourceElement.className = 'rich-inline-source';
      sourceElement.contentEditable = 'true';
      sourceElement.spellcheck = false;
      const safeSource = stripRichCaretTokens(source);
      sourceElement.dataset.inlineSource = safeSource;
      sourceElement.setAttribute('role', 'textbox');
      sourceElement.setAttribute('aria-label', 'インラインMarkdownソース');
      sourceElement.textContent = safeSource;
      return sourceElement;
    }

    function replaceTextRangeWithRichInlineHtml(textNode, start, end, source) {
      const fragment = renderRichInlineSourceFragment(source);
      const insertedNodes = Array.from(fragment.childNodes);
      if (!insertedNodes.length) return;
      replaceTextNodeRange(textNode, start, end, insertedNodes);
      configureRichEditableSurface();
      placeCaretAtInlineBoundary(insertedNodes[insertedNodes.length - 1], 'after');
      suppressRichInlineActivation();
    }

    function placeCaretAtInlineBoundary(node, boundary) {
      const marker = document.createTextNode('\u200b');
      if (boundary === 'before') {
        node.before(marker);
        placeCaretInTextNode(marker, 0);
      } else {
        node.after(marker);
        placeCaretInTextNode(marker, marker.nodeValue.length);
      }
    }

    function replaceTextNodeRange(textNode, start, end, replacementNodes) {
      const parent = textNode.parentNode;
      if (!parent) return;
      const value = textNode.nodeValue || '';
      const before = value.slice(0, start);
      const after = value.slice(end);
      const reference = textNode;
      if (before) parent.insertBefore(document.createTextNode(before), reference);
      replacementNodes.forEach((node) => parent.insertBefore(node, reference));
      if (after) parent.insertBefore(document.createTextNode(after), reference);
      textNode.remove();
    }

    function placeCaretAfterNode(node) {
      const range = document.createRange();
      range.setStartAfter(node);
      range.collapse(true);
      const selection = window.getSelection?.();
      if (!selection) return;
      selection.removeAllRanges();
      selection.addRange(range);
      els.rich.focus();
    }

    function getCaretCharacterOffsetWithin(element, selection) {
      if (!selection || !selection.rangeCount) return 0;
      const range = selection.getRangeAt(0);
      const before = range.cloneRange();
      before.selectNodeContents(element);
      before.setEnd(range.startContainer, range.startOffset);
      return normalizeRichText(before.toString()).length;
    }

    function suppressRichInlineActivation() {
      state.richInlineActivationSuppressed = true;
      window.setTimeout(() => {
        state.richInlineActivationSuppressed = false;
      }, 120);
    }

    async function onRichPaste(event) {
      const imageFiles = imageFilesFromClipboard(event.clipboardData);
      if (isProseMirrorRichEventContext(event)) {
        if (imageFiles.length) {
          event.preventDefault();
          await insertImageFilesAsAssets(imageFiles, createImageInsertionContext(event), '貼り付け');
        }
        return;
      }
      const control = eventTargetElement(event)?.closest?.('.rich-source-editor, .code-language-input');
      if (control) return;

      const inlineSource = richInlineSourceFromEventContext(event);
      if (inlineSource) {
        if (handleRichInlineSourcePaste(event, inlineSource)) return;
        captureRichInlineSourceUndoSnapshot(inlineSource, 'inline-source');
        return;
      }

      if (imageFiles.length) {
        event.preventDefault();
        await insertImageFilesAsAssets(imageFiles, createImageInsertionContext(event), '貼り付け');
        return;
      }

      event.preventDefault();
      const text = normalizeNewlines(event.clipboardData?.getData('text/plain') || '');
      if (handleRichPlainTextPaste(event, text)) return;
      if (guardUnsupportedRichPlainTextPasteFallback(event)) return;
      insertPlainTextAtSelection(text);
      syncRichMarkdownFromDom('rich-paste');
    }

    function handleRichInlineSourcePaste(event, inlineSource) {
      const text = stripRichCaretTokens(normalizeNewlines(event.clipboardData?.getData('text/plain') || ''));
      if (!text) return false;
      const sourceRange = richInlineSourceRange(inlineSource);
      const selectionRange = richInlineSourceSelectionRange(inlineSource);
      if (!sourceRange || !selectionRange) return false;
      event.preventDefault();
      captureRichInlineSourceUndoSnapshot(inlineSource, 'inline-source-paste');
      applyActiveRichInlineSourceTransaction(inlineSource, {
        from: selectionRange.from,
        to: selectionRange.to,
        insert: text,
        sourceRange,
        reason: 'rich-inline-source-paste',
      });
      return true;
    }

    function handleRichPlainTextPaste(event, text) {
      if (!text) return false;
      const target = eventTargetElement(event);
      if (target?.closest?.('.rich-inline-source, .rich-source-editor, .code-language-input')) return false;
      const selection = window.getSelection?.();
      const tableRange = richTableTextReplacementRangeFromSelection(selection);
      const quoteRange = tableRange ? null : richQuoteTextReplacementRangeFromSelection(selection);
      const blankRange = tableRange || quoteRange ? null : activeRichTransactionBlankRange();
      const rawRange = tableRange || quoteRange || blankRange || richPlainTextTransactionRangeFromSelection(selection);
      const replacementRange = rawRange?.from !== rawRange?.to
        ? expandSourceRangeToIntersectingInlineAtoms(rawRange)
        : rawRange;
      if (!replacementRange) return false;

      pushRichUndoSnapshot('paste');
      let insert = tableRange
        ? markdownTableCellTextFromPlainText(text)
        : quoteRange
          ? markdownQuoteTextFromPlainText(text)
          : stripRichCaretTokens(normalizeNewlines(text));
      const selectionLength = insert.length;
      const trailingPrefix = replacementRange.trailingParagraph && (state.markdown || '').length ? '\n\n' : '';
      const blankInsert = replacementRange.blankParagraph ? blankParagraphSourceInsertion(replacementRange.from, insert) : null;
      if (blankInsert) insert = blankInsert.insert;
      else insert = `${trailingPrefix}${insert}`;
      const nextOffset = replacementRange.from + insert.length;
      applySourceTransaction({
        from: replacementRange.from,
        to: replacementRange.to,
        insert,
        selectionAfter: {
          anchor: blankInsert ? blankInsert.selectionOffset : nextOffset,
          focus: blankInsert ? blankInsert.selectionOffset : nextOffset,
          affinity: 'after',
        },
      }, 'rich-paste');
      if (replacementRange.blankParagraph) state.richTransactionBlank = null;
      suppressRichInlineActivation();
      return true;
    }

    function guardUnsupportedRichPlainTextPasteFallback(event) {
      const selection = window.getSelection?.();
      const target = eventTargetElement(event);
      if (richSelectionTouchesSourceBlock(selection)) {
        setStatus('この位置では貼り付けできません');
        suppressRichInlineActivation();
        return true;
      }
      let commonAncestor = null;
      try {
        commonAncestor = selection?.rangeCount ? selection.getRangeAt(0).commonAncestorContainer : null;
      } catch (_) {
        commonAncestor = null;
      }
      const nodes = [
        target,
        selection?.anchorNode,
        selection?.focusNode,
        commonAncestor,
      ].filter(Boolean);
      const blockedSelector = [
        RICH_SOURCE_BLOCK_SELECTOR,
        '.rich-inline-source',
        '.rich-source-editor',
        '.code-language-input',
        '.rich-inline-atom',
        'table',
        'pre.code-block',
        '.mermaid-diagram',
        '.math-display',
        '.toc',
      ].join(', ');
      if (!nodes.some((node) => nodeClosest(node, blockedSelector))) return false;
      setStatus('この位置では貼り付けできません');
      suppressRichInlineActivation();
      return true;
    }

    function richSourceBlocksIntersectingRange(range) {
      if (!range || !els.rich.contains(range.startContainer) || !els.rich.contains(range.endContainer)) return [];
      const blocks = new Set();
      const rangeNodes = [
        range.startContainer,
        range.endContainer,
        range.commonAncestorContainer,
      ].filter(Boolean);
      rangeNodes.forEach((node) => {
        const block = nodeClosest(node, RICH_SOURCE_BLOCK_SELECTOR);
        if (block && els.rich.contains(block)) blocks.add(block);
      });
      Array.from(els.rich.querySelectorAll(RICH_SOURCE_BLOCK_SELECTOR)).forEach((block) => {
        try {
          if (typeof range.intersectsNode === 'function' && range.intersectsNode(block)) blocks.add(block);
        } catch (_) {
          // Some browser engines throw for detached/intermediate nodes; ignore them.
        }
      });
      return Array.from(blocks);
    }

    function richRangeTouchesSourceBlock(range) {
      return richSourceBlocksIntersectingRange(range).length > 0;
    }

    function richSelectionTouchesSourceBlock(selection) {
      const range = richSelectionRange(selection);
      if (!range || range.collapsed) return false;
      return richRangeTouchesSourceBlock(range);
    }

    function guardUnsupportedRichSelectionMutationFallback(event, status = 'この選択はMarkdownソースへ変換できません') {
      const selection = window.getSelection?.();
      const range = richSelectionRange(selection);
      if (!range || range.collapsed) return false;
      const blockedSelector = '.rich-inline-source, .rich-source-editor, .code-language-input';
      const target = eventTargetElement(event);
      const activeNodes = [target, range.startContainer, range.endContainer].filter(Boolean);
      if (activeNodes.some((node) => nodeClosest(node, blockedSelector))) return false;
      if (!richSelectionTouchesSourceBlock(selection)) return false;
      event?.preventDefault?.();
      setStatus(status);
      suppressRichInlineActivation();
      return true;
    }

    function onRichCut(event) {
      if (state.mode !== 'rich' || state.richComposing) return;
      const target = eventTargetElement(event);
      if (isProseMirrorRichTarget(target)) return;
      if (target?.closest?.('.rich-inline-source, .rich-source-editor, .code-language-input')) return;
      const selection = window.getSelection?.();
      const range = richSelectionRange(selection);
      if (!range || range.collapsed) return;
      try {
        event.clipboardData?.setData?.('text/plain', selection.toString());
      } catch (_) {
        // Clipboard writes can be blocked by browser policy; keep source deletion deterministic.
      }
      if (handleRichPlainTextSelectionReplacement(event, '', 'rich-selection-cut')) return;
      guardUnsupportedRichSelectionMutationFallback(event);
    }

    function richTableTextReplacementRangeFromSelection(selection) {
      const range = richSelectionRange(selection);
      if (!range) return null;
      const anchorCell = nodeClosest(range.startContainer, 'td, th');
      const focusCell = nodeClosest(range.endContainer, 'td, th');
      if (!anchorCell || anchorCell !== focusCell || !els.rich.contains(anchorCell)) return null;
      if (range.collapsed) {
        const point = richTableSourcePointFromRange(anchorCell, range);
        return point ? { from: point.offset, to: point.offset } : null;
      }
      const sourceSelection = domSelectionToSourceSelection(selection);
      if (!sourceSelection || !Number.isFinite(sourceSelection.anchor) || !Number.isFinite(sourceSelection.focus)) return null;
      return {
        from: Math.min(sourceSelection.anchor, sourceSelection.focus),
        to: Math.max(sourceSelection.anchor, sourceSelection.focus),
      };
    }

    function richQuoteTextReplacementRangeFromSelection(selection) {
      const range = richSelectionRange(selection);
      if (!range) return null;
      const anchorQuote = nodeClosest(range.startContainer, 'blockquote');
      const focusQuote = nodeClosest(range.endContainer, 'blockquote');
      if (!anchorQuote || anchorQuote !== focusQuote || !els.rich.contains(anchorQuote)) return null;
      if (range.collapsed) {
        const point = richQuoteSourcePointFromRange(anchorQuote, range);
        return point ? { from: point.offset, to: point.offset } : null;
      }
      const sourceSelection = domSelectionToSourceSelection(selection);
      if (!sourceSelection || !Number.isFinite(sourceSelection.anchor) || !Number.isFinite(sourceSelection.focus)) return null;
      return {
        from: Math.min(sourceSelection.anchor, sourceSelection.focus),
        to: Math.max(sourceSelection.anchor, sourceSelection.focus),
      };
    }

    function markdownQuoteTextFromPlainText(text) {
      return stripRichCaretTokens(normalizeNewlines(text)).split('\n').join('\n> ');
    }

    function markdownTableCellTextFromPlainText(text) {
      return escapeMarkdownTableCell(stripRichCaretTokens(normalizeNewlines(text))).replace(/\n+/g, '<br>');
    }

    function activeRichTransactionBlankPoint(range = null) {
      const blank = state.richTransactionBlank;
      const element = blank?.element;
      const sourceGap = Number(blank?.sourceGap);
      if (!element?.isConnected || !els.rich.contains(element) || !Number.isFinite(sourceGap)) {
        state.richTransactionBlank = null;
        return null;
      }
      let selectedRange = range;
      if (!selectedRange) {
        const selection = window.getSelection?.();
        if (!selection?.rangeCount) return null;
        try {
          selectedRange = selection.getRangeAt(0);
        } catch (_) {
          return null;
        }
      }
      if (!element.contains(selectedRange.startContainer) || !element.contains(selectedRange.endContainer)) return null;
      return {
        offset: sourceGap,
        contentStart: sourceGap,
        contentEnd: sourceGap,
        blankParagraph: true,
      };
    }

    function activeRichTransactionBlankRange() {
      const point = activeRichTransactionBlankPoint();
      return point ? { from: point.offset, to: point.offset, blankParagraph: true } : null;
    }

    function clearRichTransactionBlankForPointer(target) {
      const element = state.richTransactionBlank?.element;
      if (!element) return;
      if (!element.isConnected || !target || !element.contains(target)) state.richTransactionBlank = null;
    }

    async function onMarkdownPaste(event) {
      const imageFiles = imageFilesFromClipboard(event.clipboardData);
      if (!imageFiles.length) return;
      event.preventDefault();
      await insertImageFilesAsAssets(imageFiles, createImageInsertionContext(event), '貼り付け');
    }

    function onEditorDragOver(event) {
      if (!hasImageFiles(event.dataTransfer)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      event.currentTarget?.classList?.add('is-drag-over');
    }

    function onEditorDragLeave(event) {
      if (event.currentTarget?.contains(event.relatedTarget)) return;
      event.currentTarget?.classList?.remove('is-drag-over');
    }

    async function onEditorDrop(event) {
      const imageFiles = imageFilesFromDataTransfer(event.dataTransfer);
      if (!imageFiles.length) return;
      event.preventDefault();
      event.currentTarget?.classList?.remove('is-drag-over');
      await insertImageFilesAsAssets(imageFiles, createImageInsertionContext(event), 'ドロップ');
    }

    function insertPlainTextAtSelection(text) {
      if (document.queryCommandSupported?.('insertText')) {
        document.execCommand('insertText', false, text);
        return;
      }
      const selection = window.getSelection?.();
      if (!selection || !selection.rangeCount) return;
      const range = selection.getRangeAt(0);
      range.deleteContents();
      const node = document.createTextNode(text);
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    }

    function onKeyDown(event) {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown', 'Escape'].includes(event.key)) {
        state.richLineBreakInputOffset = null;
      }
      if (event.defaultPrevented && isProseMirrorRichTarget(eventTargetElement(event))) return;
      const inlineSource = richInlineSourceFromEventContext(event);
      if (inlineSource) {
        if (isRichUndoShortcut(event) && restoreRichUndoSnapshot()) {
          event.preventDefault();
          return;
        }
        if (isEnterKey(event)) {
          event.preventDefault();
          pushRichUndoSnapshot('line-break');
          if (!event.shiftKey && handleRichInlineSourceEnter(inlineSource)) {
            return;
          }
          if (event.shiftKey && handleRichInlineSourceLineBreak(inlineSource)) {
            return;
          }
          return;
        }
        if ((event.key === 'ArrowRight' || event.key === 'ArrowLeft') && handleRichInlineSourceArrow(event, inlineSource)) {
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          commitRichInlineSource(inlineSource);
          return;
        }
      }

      if (isRichKeyEventContext(event)) {
        if (isRichUndoShortcut(event) && restoreRichUndoSnapshot()) {
          event.preventDefault();
          return;
        }
        if (handleRichQuoteTextKeydown(event)) {
          return;
        }
        if ((event.key === 'ArrowRight' || event.key === 'ArrowLeft') && handleRichInlineBoundaryArrow(event)) {
          return;
        }
        if ((event.key === 'ArrowRight' || event.key === 'ArrowLeft') && handleRichLineBoundaryArrow(event)) {
          return;
        }
        if ((event.key === 'Home' || event.key === 'End') && handleRichHomeEndNavigation(event)) {
          return;
        }
        if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && handleRichListArrowNavigation(event)) {
          return;
        }
        if (event.key === 'Backspace' || event.key === 'Delete') {
          snapshotRichDeleteFromKeydown();
        }
        if ((event.key === 'Backspace' || event.key === 'Delete') && handleRichAtomicBlockBoundaryDelete(event)) {
          return;
        }
        if ((event.key === 'Backspace' || event.key === 'Delete') && handleRichTableBlockBoundaryDelete(event)) {
          return;
        }
        if ((event.key === 'Backspace' || event.key === 'Delete') && handleRichTextBlockBoundaryDelete(event)) {
          return;
        }
        if ((event.key === 'Backspace' || event.key === 'Delete') && handleRichListItemBoundaryDelete(event)) {
          return;
        }
        if ((event.key === 'Backspace' || event.key === 'Delete') && handleRichListBlockBoundaryDelete(event)) {
          return;
        }
        if ((event.key === 'Backspace' || event.key === 'Delete') && handleRichTableLineBreakDelete(event)) {
          return;
        }
        if (event.key === 'Backspace' && handleRichEmptyListBackspace(event)) {
          return;
        }
        if ((event.key === 'Backspace' || event.key === 'Delete') && handleRichTaskCheckboxDelete(event)) {
          return;
        }
        if ((event.key === 'Backspace' || event.key === 'Delete') && handleRichDeleteToEmptyBlock(event)) {
          return;
        }
        if (isEnterKey(event)) {
          handleRichEnter(event);
          return;
        }
      }

      if (event.target instanceof HTMLInputElement && event.target.classList.contains('code-language-input')) {
        if (isEnterKey(event)) {
          event.preventDefault();
          updateCodeBlockLanguage(event.target);
          event.target.blur();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.target.blur();
        }
        return;
      }

    }

    function onKeyboardShortcutKeyDown(event) {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
      if (captureShortcutAssignment?.(event)) return;
      const actionShortcut = shortcutActionForEvent?.(event) || '';
      if (!actionShortcut) return;
      event.preventDefault();
      event.stopPropagation();
      runKeyboardActionShortcut(actionShortcut);
    }

    function runKeyboardActionShortcut(action) {
      switch (action) {
        case 'new-window':
          newDocument();
          break;
        case 'save':
          saveMarkdown();
          break;
        case 'save-as':
          if (!requestDesktopCommand('saveAs')) saveMarkdown();
          break;
        case 'open':
          openMarkdownFile();
          break;
        case 'open-new-window':
          if (!requestDesktopCommand('openNewWindow')) setStatus('新しいウィンドウで開く操作はWindowsアプリ版で利用できます');
          break;
        case 'print':
          printPreview();
          break;
        case 'bold':
          applyFormat('bold');
          break;
        case 'italic':
          applyFormat('italic');
          break;
        case 'paragraph':
        case 'h1':
        case 'h2':
        case 'h3':
        case 'h4':
        case 'h5':
        case 'h6':
        case 'ordered-list':
        case 'list':
        case 'quote':
          applyFormat(action);
          break;
        case 'inline-code':
          applyFormat('code');
          break;
        case 'inline-math':
          applyFormat('math');
          break;
        case 'code-block':
          insertCodeBlock();
          break;
        case 'math-block':
          insertMathBlock();
          break;
        case 'link':
          insertLink();
          break;
        case 'table':
          applyFormat('table');
          break;
        case 'toc':
          applyFormat('toc');
          break;
        case 'mermaid':
          insertMermaid();
          break;
        case 'toggle-outline':
          toggleOutline();
          break;
        default:
          break;
      }
    }

    function snapshotRichDeleteFromKeydown() {
      if (nodeClosest(window.getSelection?.()?.anchorNode, '.rich-inline-source, .rich-source-editor, .code-language-input')) return;
      pushRichUndoSnapshot('delete');
      state.richUndoPreserveNextInput = true;
    }

    function isEnterKey(event) {
      if (event?.isComposing || event?.keyCode === 229) return false;
      return event.key === 'Enter' || event.key === 'NumpadEnter' || event.key === 'ENTER';
    }

    function handleRichQuoteTextKeydown(event) {
      if (state.richComposing || event?.isComposing || event?.keyCode === 229) return false;
      if (event.ctrlKey || event.metaKey || event.altKey) return false;
      if (typeof event.key !== 'string' || event.key.length !== 1) return false;
      const selection = window.getSelection?.();
      const range = richSelectionRange(selection);
      if (!range?.collapsed) return false;
      const quote = nodeClosest(range.startContainer, 'blockquote');
      if (!quote || !els.rich.contains(quote)) return false;
      const point = richQuoteSourcePointFromRange(quote, range);
      if (!point || !Number.isFinite(point.offset)) return false;
      const insert = markdownQuoteTextFromPlainText(event.key);
      event.preventDefault();
      pushRichUndoSnapshot('insert');
      applySourceTransaction({
        from: point.offset,
        to: point.offset,
        insert,
        selectionAfter: {
          anchor: point.offset + insert.length,
          focus: point.offset + insert.length,
          affinity: 'after',
        },
      }, 'rich-quote-key-insert');
      suppressRichInlineActivation();
      return true;
    }

    function isRichUndoShortcut(event) {
      return (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'z';
    }

    function pushRichUndoSnapshot(label) {
      if (state.mode !== 'rich' || !els.rich) return;
      const markdown = stripRichCaretTokens(normalizeNewlines(state.markdown || els.source.value || serializeRichMarkdown(els.rich)));
      const bookmark = getRichCaretBookmark();
      const last = state.richUndoStack[state.richUndoStack.length - 1];
      if (last?.markdown === markdown && last?.bookmark?.start === bookmark?.start && last?.bookmark?.length === bookmark?.length) return;
      state.richUndoStack.push({ label, markdown, bookmark });
      if (state.richUndoStack.length > MAX_RICH_UNDO_STEPS) {
        state.richUndoStack.splice(0, state.richUndoStack.length - MAX_RICH_UNDO_STEPS);
      }
    }

    function clearRichUndoStack() {
      state.richUndoStack = [];
    }

    function restoreRichUndoSnapshot() {
      const snapshot = state.richUndoStack.pop();
      if (!snapshot) return false;
      state.richUndoRestoring = true;
      state.richSelectionLock = true;
      state.markdown = normalizeNewlines(snapshot.markdown || '');
      els.source.value = state.markdown;
      syncCodeMirrorSourceFromTextarea('rich-undo');
      state.richInlineSource = null;
      renderAll('rich-undo');
      restoreRichCaret(snapshot.bookmark);
      state.richSelectionLock = false;
      state.richUndoRestoring = false;
      suppressRichInlineActivation();
      markDirty();
      scheduleAutosave();
      setStatus(snapshot.label === 'line-break' ? '改行を元に戻しました' : '編集を元に戻しました');
      return true;
    }

    function isRichKeyEventContext(event) {
      const target = eventTargetElement(event);
      if (isProseMirrorRichTarget(target)) return false;
      if (target?.closest?.('.rich-source-editor, .code-language-input')) return false;
      if (target && els.rich.contains(target)) return true;
      const active = document.activeElement;
      if (active && active !== document.body && active !== els.rich && !els.rich.contains(active)) return false;
      const selection = window.getSelection?.();
      return Boolean(
        state.mode === 'rich'
        && selection
        && selection.rangeCount
        && selection.isCollapsed
        && els.rich.contains(selection.anchorNode)
        && !isProseMirrorRichTarget(selection.anchorNode)
      );
    }

    function handleRichInlineSourceEnter(inlineSource) {
      const item = inlineSource.closest?.('li');
      const list = item?.closest?.('ul, ol');
      if (item && list && els.rich.contains(item)) {
        return handleRichInlineSourceListEnter(inlineSource, item, list);
      }

      const cell = inlineSource.closest?.('td, th');
      if (cell && els.rich.contains(cell)) {
        return handleRichInlineSourceLineBreak(inlineSource);
      }

      return handleRichInlineSourceBlockEnter(inlineSource);
    }

    function handleRichInlineSourceListEnter(inlineSource, item, list) {
      if (applyRichInlineSourceSplitTransaction(inlineSource, 'list-enter')) return true;
      if (guardUnsupportedRichInlineSourceSplitFallback(inlineSource)) return true;

      const split = splitRichInlineSourceAtSelection(inlineSource);
      if (!split) return false;
      const marker = document.createTextNode('');
      inlineSource.after(marker);

      state.richSelectionLock = true;
      replaceInlineSourceWithFragment(inlineSource, split.before);
      const nextItem = createEmptyListItemLike(item, list);
      const tail = extractListItemTailAfterMarker(item, marker);
      marker.remove();
      appendRichInlineSourceAndTail(nextItem, split.after, tail, 'list-item');
      ensureListItemEditablePlaceholder(item);
      item.after(nextItem);
      placeCaretAtListItemStart(nextItem);
      state.richSelectionLock = false;
      suppressRichInlineActivation();
      syncRichMarkdownFromDom('rich-input');
      return true;
    }

    function handleRichInlineSourceBlockEnter(inlineSource) {
      const quote = inlineSource.closest?.('blockquote');
      if (quote && els.rich.contains(quote) && applyRichInlineSourceSplitTransaction(inlineSource, 'quote-line-break')) {
        return true;
      }

      const block = nodeClosest(inlineSource, 'p, h1, h2, h3, h4, h5, h6, div');
      if (!block || !els.rich.contains(block) || block.closest('li, .rich-source-editor, .mermaid-diagram, pre.code-block, .math-display, .toc')) {
        return false;
      }

      if (applyRichInlineSourceSplitTransaction(inlineSource, 'block-enter')) return true;
      if (guardUnsupportedRichInlineSourceSplitFallback(inlineSource)) return true;

      const split = splitRichInlineSourceAtSelection(inlineSource);
      if (!split) return false;
      const marker = document.createTextNode('');
      inlineSource.after(marker);

      state.richSelectionLock = true;
      replaceInlineSourceWithFragment(inlineSource, split.before);
      const next = document.createElement('p');
      const tail = extractRichBlockTailAfterMarker(block, marker);
      marker.remove();
      appendRichInlineSourceAndTail(next, split.after, tail, 'block');
      ensureRichTextBlockPlaceholder(block);
      block.after(next);
      placeCaretAtStart(next);
      state.richSelectionLock = false;
      suppressRichInlineActivation();
      syncRichMarkdownFromDom('rich-input');
      return true;
    }

    function handleRichInlineSourceLineBreak(inlineSource) {
      if (applyRichInlineSourceSplitTransaction(inlineSource, 'line-break')) return true;
      if (guardUnsupportedRichInlineSourceSplitFallback(inlineSource)) return true;

      const split = splitRichInlineSourceAtSelection(inlineSource);
      if (!split) return false;
      const marker = document.createTextNode('');
      inlineSource.after(marker);

      state.richSelectionLock = true;
      replaceInlineSourceWithFragment(inlineSource, split.before);
      const br = document.createElement('br');
      const caret = document.createTextNode('\u200b');
      const afterFragment = renderRichInlineSourceFragment(split.after);
      marker.replaceWith(br, caret, afterFragment);
      placeCaretInTextNode(caret, 1);
      state.richSelectionLock = false;
      suppressRichInlineActivation();
      syncRichMarkdownFromDom('rich-input');
      return true;
    }

    function guardUnsupportedRichInlineSourceSplitFallback(inlineSource) {
      const sourceBlock = nodeClosest(inlineSource, RICH_SOURCE_BLOCK_SELECTOR);
      if (!sourceBlock || !els.rich.contains(sourceBlock)) return false;
      setStatus('この位置ではインラインソースを分割できません');
      suppressRichInlineActivation();
      return true;
    }

    function applyRichInlineSourceSplitTransaction(inlineSource, kind) {
      const sourceRange = richInlineSourceRange(inlineSource);
      const split = splitRichInlineSourceAtSelection(inlineSource);
      if (!sourceRange || !split) return false;
      const separator = richInlineSourceSplitSeparator(inlineSource, kind);
      if (!separator) return false;
      const insert = `${split.before}${separator.text}${split.after}`;
      const nextOffset = sourceRange.start + split.before.length + separator.text.length;
      state.richInlineSource = null;
      applySourceTransaction({
        from: sourceRange.start,
        to: sourceRange.end,
        insert,
        selectionAfter: {
          anchor: nextOffset,
          focus: nextOffset,
          affinity: 'after',
        },
      }, `rich-inline-source-${kind}`);
      suppressRichInlineActivation();
      return true;
    }

    function richInlineSourceRange(inlineSource) {
      const start = Number(inlineSource?.dataset?.srcStart);
      const end = Number(inlineSource?.dataset?.srcEnd);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
      return { start, end };
    }

    function richInlineSourceSplitSeparator(inlineSource, kind) {
      if (kind === 'block-enter') return { text: '\n\n' };
      if (kind === 'quote-line-break') return { text: '\n> ' };
      if (kind === 'list-enter') {
        const item = inlineSource.closest?.('li');
        const list = item?.closest?.('ul, ol');
        const prefix = item && list ? richInlineSourceNextListPrefix(inlineSource, item, list) : '';
        return prefix ? { text: `\n${prefix}` } : null;
      }
      if (kind === 'line-break') {
        const cell = inlineSource.closest?.('td, th');
        if (cell && els.rich.contains(cell)) return { text: '<br>' };
        const quote = inlineSource.closest?.('blockquote');
        if (quote && els.rich.contains(quote)) return { text: '\n> ' };
        const item = inlineSource.closest?.('li');
        const list = item?.closest?.('ul, ol');
        if (item && list && els.rich.contains(item)) {
          const continuation = richInlineSourceListContinuationPrefix(inlineSource, item, list);
          return { text: `  \n${continuation}` };
        }
        return { text: '  \n' };
      }
      return null;
    }

    function richInlineSourceNextListPrefix(inlineSource, item, list) {
      const sourceItem = richInlineSourceListSourceItem(inlineSource, item, list);
      return sourceItem?.parsed ? nextListSourcePrefix(sourceItem.parsed) : '';
    }

    function richInlineSourceListContinuationPrefix(inlineSource, item, list) {
      const sourceItem = richInlineSourceListSourceItem(inlineSource, item, list);
      return sourceItem?.parsed ? `${sourceItem.parsed.indent}  ` : '  ';
    }

    function richInlineSourceListSourceItem(inlineSource, item, list) {
      if (!item || !list?.matches?.(RICH_SOURCE_BLOCK_SELECTOR) || item.parentElement !== list) return null;
      const sourceRange = richInlineSourceRange(inlineSource);
      if (!sourceRange) return null;
      const blockStart = numericData(list, 'sourceStart');
      const blockEnd = numericData(list, 'sourceEnd');
      if (!Number.isFinite(blockStart) || !Number.isFinite(blockEnd)) return null;
      const raw = stripRichCaretTokens(state.markdown || '').slice(blockStart, blockEnd);
      const sourceItems = flatListSourceItems(raw);
      const items = Array.from(list.children).filter((child) => child.tagName?.toLowerCase() === 'li');
      const itemIndex = items.indexOf(item);
      const sourceItem = sourceItems[itemIndex];
      if (itemIndex < 0 || !sourceItem || sourceItems.length !== items.length) return null;
      const localStart = sourceRange.start - blockStart;
      return sourceItem.start <= localStart && localStart <= sourceItem.end ? sourceItem : null;
    }

    function splitRichInlineSourceAtSelection(inlineSource) {
      const offset = richInlineSourceCaretOffset(inlineSource);
      if (!Number.isInteger(offset)) return null;
      return splitRichInlineSourceAtOffset(stripRichCaretTokens(normalizeNewlines(inlineSource.textContent || '')), offset);
    }

    function richInlineSourceSelectionRange(inlineSource) {
      const selection = window.getSelection?.();
      if (
        !selection
        || !selection.rangeCount
        || !inlineSource.contains(selection.anchorNode)
        || !inlineSource.contains(selection.focusNode)
      ) {
        return null;
      }
      const anchor = richInlineSourcePointOffset(inlineSource, selection.anchorNode, selection.anchorOffset);
      const focus = richInlineSourcePointOffset(inlineSource, selection.focusNode, selection.focusOffset);
      if (!Number.isInteger(anchor) || !Number.isInteger(focus)) return null;
      return {
        anchor,
        focus,
        from: Math.min(anchor, focus),
        to: Math.max(anchor, focus),
      };
    }

    function richInlineSourceCaretOffset(inlineSource) {
      const selection = window.getSelection?.();
      if (!selection || !selection.rangeCount || !selection.isCollapsed || !inlineSource.contains(selection.anchorNode)) return null;
      return richInlineSourcePointOffset(inlineSource, selection.anchorNode, selection.anchorOffset);
    }

    function richInlineSourcePointOffset(inlineSource, container, offset) {
      const before = document.createRange();
      before.selectNodeContents(inlineSource);
      try {
        before.setEnd(container, offset);
      } catch (_) {
        return null;
      }
      return stripRichCaretTokens(normalizeNewlines(before.toString())).length;
    }

    function previousStringOffset(source, offset) {
      const bounded = Math.max(0, Math.min(String(source || '').length, offset));
      if (bounded <= 0) return 0;
      const char = source.charCodeAt(bounded - 1);
      if (char >= 0xdc00 && char <= 0xdfff && bounded > 1) {
        const previous = source.charCodeAt(bounded - 2);
        if (previous >= 0xd800 && previous <= 0xdbff) return bounded - 2;
      }
      return bounded - 1;
    }

    function nextStringOffset(source, offset) {
      const text = String(source || '');
      const bounded = Math.max(0, Math.min(text.length, offset));
      if (bounded >= text.length) return text.length;
      const char = text.charCodeAt(bounded);
      if (char >= 0xd800 && char <= 0xdbff && bounded + 1 < text.length) {
        const next = text.charCodeAt(bounded + 1);
        if (next >= 0xdc00 && next <= 0xdfff) return bounded + 2;
      }
      return bounded + 1;
    }

    function splitRichInlineSourceAtOffset(source, offset) {
      const index = Math.max(0, Math.min(source.length, offset));
      return { before: source.slice(0, index), after: source.slice(index) };
    }

    function applyActiveRichInlineSourceTransaction(inlineSource, transaction) {
      const source = stripRichCaretTokens(normalizeNewlines(inlineSource.textContent || ''));
      const from = Math.max(0, Math.min(source.length, Number(transaction.from)));
      const to = Math.max(from, Math.min(source.length, Number(transaction.to)));
      const insert = stripRichCaretTokens(normalizeNewlines(transaction.insert || ''));
      const sourceRange = transaction.sourceRange || richInlineSourceRange(inlineSource);
      if (!sourceRange) return false;
      const markdown = stripRichCaretTokens(state.markdown || els.source.value || '');
      if (sourceRange.start < 0 || sourceRange.end > markdown.length || sourceRange.end < sourceRange.start) return false;
      const nextSource = `${source.slice(0, from)}${insert}${source.slice(to)}`;
      const nextEnd = sourceRange.start + nextSource.length;
      const nextOffset = sourceRange.start + from + insert.length;

      state.markdown = markdown.slice(0, sourceRange.start) + nextSource + markdown.slice(sourceRange.end);
      els.source.value = state.markdown;
      syncCodeMirrorSourceFromTextarea('rich-inline-source-transaction');
      inlineSource.textContent = nextSource;
      inlineSource.dataset.inlineSource = nextSource;
      inlineSource.dataset.srcStart = String(sourceRange.start);
      inlineSource.dataset.srcEnd = String(nextEnd);
      state.richInlineSource = {
        ...(state.richInlineSource || {}),
        element: inlineSource,
        undoCaptured: true,
      };
      placeCaretInInlineSource(inlineSource, nextOffset - sourceRange.start);
      markDirty();
      refreshRichSourceRangesFromMarkdown();
      renderPreview();
      renderOutline();
      updateStatusBar();
      scheduleAutosave();
      suppressRichInlineActivation();
      return true;
    }

    function syncActiveRichInlineSourceMarkdown(inlineSource, reason = 'rich-inline-source-input') {
      const sourceRange = richInlineSourceRange(inlineSource);
      if (!sourceRange) return false;
      const selectionRange = richInlineSourceSelectionRange(inlineSource);
      const selectionOffset = Number.isInteger(selectionRange?.focus) ? selectionRange.focus : null;
      const rawSource = normalizeNewlines(inlineSource.textContent || '');
      const source = stripRichCaretTokens(normalizeNewlines(inlineSource.textContent || ''));
      const markdown = stripRichCaretTokens(state.markdown || els.source.value || '');
      if (sourceRange.start < 0 || sourceRange.end > markdown.length || sourceRange.end < sourceRange.start) return false;
      const nextEnd = sourceRange.start + source.length;
      const current = markdown.slice(sourceRange.start, sourceRange.end);
      if (current !== source) {
        state.markdown = markdown.slice(0, sourceRange.start) + source + markdown.slice(sourceRange.end);
        els.source.value = state.markdown;
        syncCodeMirrorSourceFromTextarea(reason);
        markDirty();
        renderPreview();
        renderOutline();
        updateStatusBar();
        scheduleAutosave();
      }
      if (rawSource !== source) {
        inlineSource.textContent = source;
        if (Number.isInteger(selectionOffset)) {
          placeCaretInInlineSource(inlineSource, Math.max(0, Math.min(selectionOffset, source.length)));
        }
      }
      inlineSource.dataset.inlineSource = source;
      inlineSource.dataset.srcStart = String(sourceRange.start);
      inlineSource.dataset.srcEnd = String(nextEnd);
      state.richInlineSource = {
        ...(state.richInlineSource || {}),
        element: inlineSource,
      };
      refreshRichSourceRangesFromMarkdown();
      if (reason) suppressRichInlineActivation();
      return true;
    }

    function replaceInlineSourceWithFragment(inlineSource, source) {
      const fragment = source ? renderRichInlineSourceFragment(source) : document.createDocumentFragment();
      if (state.richInlineSource?.element === inlineSource) state.richInlineSource = null;
      inlineSource.replaceWith(fragment);
      configureRichEditableSurface();
    }

    function extractListItemTailAfterMarker(item, marker) {
      const tailRange = document.createRange();
      tailRange.setStartAfter(marker);
      tailRange.setEnd(item, listItemContentEndOffset(item));
      const fragment = tailRange.extractContents();
      fragment.querySelectorAll?.('.task-checkbox').forEach((checkbox) => checkbox.remove());
      return fragment;
    }

    function extractRichBlockTailAfterMarker(block, marker) {
      const tailRange = document.createRange();
      tailRange.setStartAfter(marker);
      tailRange.setEnd(block, block.childNodes.length);
      return tailRange.extractContents();
    }

    function appendRichInlineSourceAndTail(target, source, tail, kind) {
      if (source) {
        const sourceFragment = renderRichInlineSourceFragment(source);
        if (!isFragmentVisiblyEmpty(sourceFragment)) target.appendChild(sourceFragment);
      }
      if (tail && !isFragmentVisiblyEmpty(tail)) target.appendChild(tail);
      if (kind === 'list-item') {
        ensureListItemEditablePlaceholder(target);
      } else {
        ensureRichTextBlockPlaceholder(target);
      }
    }

    function handleRichInlineSourceArrow(event, inlineSource) {
      if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return false;
      const offset = richInlineSourceCaretOffset(inlineSource);
      if (!Number.isInteger(offset)) return false;
      const length = normalizeNewlines(inlineSource.textContent || '').length;

      if (event.key === 'ArrowRight' && offset >= length) {
        event.preventDefault();
        commitRichInlineSourceAtBoundary(inlineSource, 'after');
        return true;
      }
      if (event.key === 'ArrowLeft' && offset <= 0) {
        event.preventDefault();
        commitRichInlineSourceAtBoundary(inlineSource, 'before');
        return true;
      }
      return false;
    }

    function commitRichInlineSourceAtBoundary(inlineSource, boundary) {
      const start = Number(inlineSource?.dataset?.srcStart);
      const source = stripRichCaretTokens(normalizeNewlines(inlineSource?.textContent || ''));
      const offsetAfterCommit = Number.isFinite(start)
        ? (boundary === 'before' ? start : start + source.length)
        : null;
      const caretToken = richCaretToken();
      const marker = document.createTextNode(caretToken);
      if (boundary === 'before') {
        inlineSource.before(marker);
      } else {
        inlineSource.after(marker);
      }
      const committed = commitRichInlineSource(inlineSource, { caretToken });
      if (committed) {
        if (Number.isFinite(offsetAfterCommit)) {
          restoreRichCaretFromSourceSelection({
            anchor: offsetAfterCommit,
            focus: offsetAfterCommit,
            affinity: boundary,
          });
        }
        suppressRichInlineActivation();
      }
      return committed;
    }

    function handleRichInlineBoundaryArrow(event) {
      if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return false;
      if (event.target.closest?.('.rich-source-editor, .code-language-input')) return false;
      const selection = window.getSelection?.();
      if (!selection || !selection.rangeCount || !selection.isCollapsed || !els.rich.contains(selection.anchorNode)) return false;
      if (nodeClosest(selection.anchorNode, '.rich-inline-source')) return false;

      const range = selection.getRangeAt(0);
      const candidate = richInlineBoundaryCandidate(range, event.key);
      if (!candidate) return false;

      event.preventDefault();
      cleanupRichCaretBoundaryMarkers({ preserveSelection: false });
      activateRichInlineSource(candidate.element, candidate.position);
      return true;
    }

    function richInlineBoundaryCandidate(range, key) {
      const editBlock = richInlineEditBlockForRange(range);
      if (!editBlock) return null;
      const direction = key === 'ArrowLeft' ? 'before' : key === 'ArrowRight' ? 'after' : '';
      if (!direction) return null;

      const direct = validRichInlineSourceElement(nodeElement(range.startContainer)?.closest?.(RICH_INLINE_SOURCE_SELECTOR));
      if (direct && isSameRichInlineEditBlock(direct, editBlock)) {
        const offset = richInlineElementTextOffsetForRange(direct, range);
        const length = normalizeRichText(direct.textContent || '').length;
        if (direction === 'before' && offset >= length) return { element: direct, position: 'end' };
        if (direction === 'after' && offset <= 0) return { element: direct, position: 'start' };
      }

      const adjacent = adjacentNodeForInlineBoundary(range.startContainer, range.startOffset, direction);
      const element = validRichInlineSourceElement(nodeElement(adjacent)?.closest?.(RICH_INLINE_SOURCE_SELECTOR));
      if (!element || !isSameRichInlineEditBlock(element, editBlock)) return null;
      return { element, position: direction === 'before' ? 'end' : 'start' };
    }

    function richInlineElementTextOffsetForRange(element, range) {
      const before = range.cloneRange();
      before.selectNodeContents(element);
      try {
        before.setEnd(range.startContainer, range.startOffset);
      } catch (_) {
        return 0;
      }
      return normalizeRichText(before.toString()).length;
    }

    function adjacentNodeForInlineBoundary(container, offset, direction) {
      if (isRichCaretBoundaryMarker(container)) {
        if (direction === 'before' && offset > 0) return adjacentDomNode(container, 'before');
        if (direction === 'after' && offset <= 0) return adjacentDomNode(container, 'after');
        return null;
      }
      return adjacentCaretNode(container, offset, direction);
    }

    function handleRichTableLineBreakDelete(event) {
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
      const selection = window.getSelection?.();
      const range = richSelectionRange(selection);
      if (!range?.collapsed) return false;
      if (nodeClosest(range.startContainer, '.rich-inline-source, .rich-source-editor, .code-language-input')) return false;
      const cell = nodeClosest(range.startContainer, 'td, th');
      if (!cell || !els.rich.contains(cell)) return false;

      const target = event.key === 'Backspace'
        ? tableBackspaceBreakTarget(range)
        : tableDeleteBreakTarget(range);
      if (!target) return false;

      const deletion = richTableLineBreakDeletionTransaction(cell, target.br, event.key === 'Backspace' ? 'before' : 'after');
      if (deletion) {
        event.preventDefault();
        applySourceTransaction(deletion, 'rich-table-line-break-delete');
        suppressRichInlineActivation();
        return true;
      }

      if (guardFailedRichSourceControlTransaction(cell, 'rich-table-line-break-delete', 'テーブルセル改行を削除できませんでした')) {
        event.preventDefault();
        return true;
      }

      event.preventDefault();
      target.br.remove();
      if (target.textNode?.isConnected && target.textNode.nodeValue?.startsWith('\u200b')) {
        target.textNode.nodeValue = target.textNode.nodeValue.slice(1);
        placeCaretInTextNode(target.textNode, 0);
      } else if (target.textNode?.isConnected) {
        placeCaretInTextNode(target.textNode, target.offset || 0);
      } else if (target.caretNode?.isConnected) {
        placeCaretAfterNode(target.caretNode);
      } else {
        placeCaretAtStart(cell);
      }
      syncRichMarkdownFromDom('rich-input');
      return true;
    }

    function richTableLineBreakDeletionTransaction(cell, br, direction) {
      if (!br?.isConnected) return null;
      const cellRange = richTableCellSourceRange(cell);
      if (!cellRange) return null;
      const local = tableCellLocalSourceOffsetBeforeNode(cell, br);
      if (!Number.isFinite(local)) return null;
      const from = cellRange.contentStart + local;
      const to = from + 4;
      if (from < cellRange.contentStart || to > cellRange.contentEnd) return null;
      const markdown = stripRichCaretTokens(state.markdown || els.source.value || '');
      if (markdown.slice(from, to).toLowerCase() !== '<br>') return null;
      return {
        from,
        to,
        insert: '',
        selectionAfter: {
          anchor: from,
          focus: from,
          affinity: direction === 'before' ? 'before' : 'after',
        },
      };
    }

    function tableCellLocalSourceOffsetBeforeNode(cell, targetNode) {
      let cursor = 0;
      for (const node of Array.from(cell.childNodes)) {
        if (node === targetNode) return cursor;
        cursor += serializeTableCellInlineNode(node).length;
      }
      return NaN;
    }

    function tableBackspaceBreakTarget(range) {
      const container = range.startContainer;
      const offset = range.startOffset;
      if (container.nodeType === Node.TEXT_NODE) {
        const text = container.nodeValue || '';
        const atMarkerBoundary = text.startsWith('\u200b') && offset <= 1;
        if (offset === 0 || atMarkerBoundary) {
          const br = previousSiblingElement(container, 'br');
          if (br) return { br, textNode: container, offset: 0 };
        }
        return null;
      }
      if (container.nodeType === Node.ELEMENT_NODE) {
        const br = elementChildAt(container, offset - 1, 'br');
        if (br) return { br, caretNode: br.previousSibling };
      }
      return null;
    }

    function tableDeleteBreakTarget(range) {
      const container = range.startContainer;
      const offset = range.startOffset;
      if (container.nodeType === Node.TEXT_NODE) {
        const text = container.nodeValue || '';
        if (offset !== text.length) return null;
        const br = nextSiblingElement(container, 'br');
        const after = br?.nextSibling;
        return br ? { br, textNode: after?.nodeType === Node.TEXT_NODE ? after : container, offset } : null;
      }
      if (container.nodeType === Node.ELEMENT_NODE) {
        const br = elementChildAt(container, offset, 'br');
        if (br) return { br, caretNode: br.previousSibling };
      }
      return null;
    }

    function previousSiblingElement(node, tagName) {
      let sibling = node.previousSibling;
      while (sibling && sibling.nodeType === Node.TEXT_NODE && sibling.nodeValue === '') sibling = sibling.previousSibling;
      return sibling?.nodeType === Node.ELEMENT_NODE && sibling.tagName.toLowerCase() === tagName ? sibling : null;
    }

    function nextSiblingElement(node, tagName) {
      let sibling = node.nextSibling;
      while (sibling && sibling.nodeType === Node.TEXT_NODE && sibling.nodeValue === '') sibling = sibling.nextSibling;
      return sibling?.nodeType === Node.ELEMENT_NODE && sibling.tagName.toLowerCase() === tagName ? sibling : null;
    }

    function elementChildAt(element, index, tagName) {
      const child = element.childNodes[index];
      return child?.nodeType === Node.ELEMENT_NODE && child.tagName.toLowerCase() === tagName ? child : null;
    }

    function placeCaretInTextNode(textNode, offset) {
      const range = document.createRange();
      range.setStart(textNode, Math.max(0, Math.min(offset, textNode.nodeValue.length)));
      range.collapse(true);
      const selection = window.getSelection?.();
      if (!selection) return;
      selection.removeAllRanges();
      selection.addRange(range);
      els.rich.focus();
    }

    function handleRichEmptyListBackspace(event) {
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
      const selection = window.getSelection?.();
      const range = richSelectionRange(selection);
      if (!range?.collapsed) return false;
      if (nodeClosest(range.startContainer, '.rich-inline-source, .rich-source-editor, .code-language-input')) return false;
      const item = richListItemFromRange(range);
      if (!item || !isRichListItemEmpty(item)) return false;
      if (richListCaretTextOffset(item, range) !== 0) return false;
      const list = item.closest('ul, ol');
      if (!list) return false;

      const sourceTransaction = richEmptyListItemBackspaceTransaction(item, list);
      if (sourceTransaction) {
        event.preventDefault();
        applySourceTransaction(sourceTransaction, 'rich-empty-list-backspace');
        suppressRichInlineActivation();
        return true;
      }

      if (list.matches?.(RICH_SOURCE_BLOCK_SELECTOR)) {
        event.preventDefault();
        setStatus('リスト項目を削除できませんでした');
        suppressRichInlineActivation();
        return true;
      }

      event.preventDefault();
      const previousTarget = previousCaretTargetForListItem(item, list);
      item.remove();
      cleanupListAfterItemRemoval(list);
      restoreCaretAfterEmptyListRemoval(previousTarget, list);
      syncRichMarkdownFromDom('rich-input');
      return true;
    }

    function richEmptyListItemBackspaceTransaction(item, list) {
      if (!item || !list?.matches?.(RICH_SOURCE_BLOCK_SELECTOR) || item.parentElement !== list) return null;
      if (!isRichListItemEmpty(item)) return null;
      const blockStart = numericData(list, 'sourceStart');
      const blockEnd = numericData(list, 'sourceEnd');
      if (!Number.isFinite(blockStart) || !Number.isFinite(blockEnd)) return null;
      const markdown = stripRichCaretTokens(state.markdown || els.source.value || '');
      const raw = markdown.slice(blockStart, blockEnd);
      const sourceItems = flatListSourceItems(raw);
      const items = Array.from(list.children).filter((child) => child.tagName?.toLowerCase() === 'li');
      const itemIndex = items.indexOf(item);
      if (itemIndex < 0 || sourceItems.length !== items.length) return null;
      const sourceItem = sourceItems[itemIndex];
      if (!sourceItem || sourceItem.lines.length !== 1) return null;
      if (visibleTextFromListSourceItem(sourceItem).trim() !== '') return null;

      if (sourceItems.length === 1) {
        const afterSeparator = markdown.slice(blockEnd).match(/^\n{1,2}/)?.[0] || '';
        return {
          from: blockStart,
          to: blockEnd + afterSeparator.length,
          insert: '',
          blankParagraphAt: blockStart,
          selectionAfter: {
            anchor: blockStart,
            focus: blockStart,
            affinity: 'after',
          },
        };
      }

      const line = sourceItem.lines[0];
      const isLast = itemIndex === sourceItems.length - 1;
      const fromLocal = isLast && line.start > 0 ? line.start - 1 : line.start;
      const toLocal = line.end;
      const previousItem = sourceItems[itemIndex - 1] || null;
      const nextItem = sourceItems[itemIndex + 1] || null;
      let selectionAfter = blockStart + fromLocal;
      if (previousItem) {
        selectionAfter = blockStart + sourceOffsetFromListItemTextOffset(previousItem, visibleTextFromListSourceItem(previousItem).length);
      } else if (nextItem?.parsed) {
        selectionAfter = blockStart + fromLocal + nextItem.parsed.prefix.length;
      }

      return {
        from: blockStart + fromLocal,
        to: blockStart + toLocal,
        insert: '',
        selectionAfter: {
          anchor: selectionAfter,
          focus: selectionAfter,
          affinity: previousItem ? 'before' : 'after',
        },
      };
    }

    function previousCaretTargetForListItem(item, list) {
      let sibling = item.previousElementSibling;
      while (sibling) {
        if (sibling.tagName?.toLowerCase() === 'li') return { type: 'li', node: sibling };
        sibling = sibling.previousElementSibling;
      }

      let previous = list.previousElementSibling;
      while (previous) {
        if (['ul', 'ol'].includes(previous.tagName?.toLowerCase())) {
          const lastItem = lastDirectListItem(previous);
          if (lastItem) return { type: 'li', node: lastItem };
        }
        if (els.rich.contains(previous)) return { type: 'block', node: previous };
        previous = previous.previousElementSibling;
      }
      return null;
    }

    function lastDirectListItem(list) {
      const items = Array.from(list.children).filter((child) => child.tagName?.toLowerCase() === 'li');
      return items[items.length - 1] || null;
    }

    function cleanupListAfterItemRemoval(list) {
      if (!Array.from(list.children).some((child) => child.tagName?.toLowerCase() === 'li')) {
        list.remove();
        return;
      }
      if (!list.querySelector(':scope > li > .task-checkbox')) list.classList.remove('task-list');
    }

    function restoreCaretAfterEmptyListRemoval(target, list) {
      if (target?.node?.isConnected && target.type === 'li') {
        placeCaretAtListItemEnd(target.node);
        return;
      }
      if (target?.node?.isConnected) {
        placeCaretAtEnd(target.node);
        return;
      }
      if (list.isConnected) {
        placeCaretAtStart(list);
      } else {
        const paragraph = document.createElement('p');
        paragraph.appendChild(document.createElement('br'));
        els.rich.appendChild(paragraph);
        placeCaretAtStart(paragraph);
      }
    }

    function handleRichTaskCheckboxDelete(event) {
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
      const selection = window.getSelection?.();
      const range = richSelectionRange(selection);
      if (!range?.collapsed) return false;
      if (nodeClosest(range.startContainer, '.rich-inline-source, .rich-source-editor, .code-language-input')) return false;
      const item = richListItemFromRange(range);
      if (!item) return false;
      const checkbox = directTaskCheckboxForItem(item);
      if (!checkbox) return false;
      if (richListCaretTextOffset(item, range) !== 0) return false;

      const sourceTransaction = removeRichTaskCheckboxTransaction(checkbox, item);
      if (sourceTransaction) {
        event.preventDefault();
        applySourceTransaction(sourceTransaction, 'rich-task-checkbox-delete');
        setStatus('チェックリストを通常リストに戻しました');
        suppressRichInlineActivation();
        return true;
      }

      const list = item.closest('ul, ol');
      if (list?.matches?.(RICH_SOURCE_BLOCK_SELECTOR)) {
        event.preventDefault();
        setStatus('チェックリストを通常リストに戻せませんでした');
        suppressRichInlineActivation();
        return true;
      }

      event.preventDefault();
      checkbox.remove();
      item.classList.remove('task-list-item');
      if (list && !list.querySelector(':scope > li > .task-checkbox')) list.classList.remove('task-list');
      placeCaretAtListItemStart(item);
      syncRichMarkdownFromDom('rich-input');
      return true;
    }

    function handleRichAtomicBlockBoundaryDelete(event) {
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
      if (event.target?.closest?.('.rich-source-editor, .code-language-input')) return false;
      const selection = window.getSelection?.();
      const range = richSelectionRange(selection);
      if (!range?.collapsed) return false;
      if (nodeClosest(range.startContainer, '.rich-inline-source, .rich-source-editor, .code-language-input')) return false;
      const direction = event.key === 'Backspace' ? 'before' : event.key === 'Delete' ? 'after' : '';
      if (!direction) return false;

      const atomicBlock = richAtomicBlockDeleteCandidate(range, direction);
      if (!atomicBlock) return false;
      const deletion = richAtomicBlockDeleteTransaction(atomicBlock, direction);
      if (!deletion) return false;

      event.preventDefault();
      applySourceTransaction(deletion, 'rich-atomic-block-delete');
      suppressRichInlineActivation();
      setStatus('ブロックを削除しました');
      return true;
    }

    function richAtomicBlockDeleteCandidate(range, direction) {
      const direct = nodeClosest(range.startContainer, RICH_ATOMIC_SOURCE_BLOCK_SELECTOR);
      if (direct && els.rich.contains(direct) && !direct.closest('.is-editing-source')) return direct;

      if (range.startContainer.nodeType === Node.ELEMENT_NODE) {
        const sibling = direction === 'before'
          ? range.startContainer.childNodes?.[range.startOffset - 1]
          : range.startContainer.childNodes?.[range.startOffset];
        const atomic = nodeElement(sibling)?.closest?.(RICH_ATOMIC_SOURCE_BLOCK_SELECTOR);
        if (atomic && els.rich.contains(atomic) && !atomic.closest('.is-editing-source')) return atomic;
      }

      const block = richCaretBlockFromRange(range);
      if (!block) return null;
      const offset = richCaretBlockTextOffset(block, range);
      const length = richCaretBlockTextLength(block);
      if (direction === 'before' && offset <= 0) return adjacentRichAtomicBlock(block, 'previous');
      if (direction === 'after' && offset >= length) return adjacentRichAtomicBlock(block, 'next');
      return null;
    }

    function adjacentRichAtomicBlock(block, direction) {
      const siblingProperty = direction === 'previous' ? 'previousElementSibling' : 'nextElementSibling';
      let sibling = block?.[siblingProperty] || null;
      while (sibling) {
        if (sibling.matches?.(RICH_ATOMIC_SOURCE_BLOCK_SELECTOR) && !sibling.closest('.is-editing-source')) return sibling;
        if (!isIgnorableRichBoundaryElement(sibling)) return null;
        sibling = sibling[siblingProperty];
      }
      return null;
    }

    function isIgnorableRichBoundaryElement(element) {
      return Boolean(element?.matches?.('p[data-rich-trailing="true"]') && isEmptyRichParagraph(element));
    }

    function richAtomicBlockDeleteTransaction(block, direction) {
      const markdown = stripRichCaretTokens(state.markdown || els.source.value || '');
      const start = numericData(block, 'sourceStart');
      const end = numericData(block, 'sourceEnd');
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || end > markdown.length) return null;
      const deletion = sourceBlockDeletionRange(markdown, start, end, direction);
      return {
        from: deletion.from,
        to: deletion.to,
        insert: '',
        selectionAfter: {
          anchor: deletion.from,
          focus: deletion.from,
          affinity: direction === 'before' ? 'before' : 'after',
        },
      };
    }

    function sourceBlockDeletionRange(markdown, start, end, direction) {
      let from = start;
      let to = end;
      const after = markdown.slice(to);
      const afterSeparator = after.match(/^\n{1,2}/)?.[0] || '';
      if (direction === 'after' && afterSeparator) {
        to += afterSeparator.length;
        return { from, to };
      }
      const before = markdown.slice(0, from);
      const beforeSeparator = before.match(/\n{1,2}$/)?.[0] || '';
      if (beforeSeparator) {
        from -= beforeSeparator.length;
        return { from, to };
      }
      if (afterSeparator) to += afterSeparator.length;
      return { from, to };
    }

    function directTaskCheckboxForItem(item) {
      return Array.from(item.children).find((child) => child.classList?.contains('task-checkbox')) || null;
    }

    function handleRichDeleteToEmptyBlock(event) {
      if (event.ctrlKey || event.metaKey || event.altKey) return false;
      const selection = window.getSelection?.();
      const range = richSelectionRange(selection);
      if (!range?.collapsed) return false;
      if (nodeClosest(range.startContainer, '.rich-inline-source, .rich-source-editor, .code-language-input')) return false;
      const block = nodeClosest(range.startContainer, RICH_INLINE_EDIT_BLOCK_SELECTOR);
      if (!block || block.closest('li')) return false;
      const text = normalizeRichText(block.textContent || '');
      if (text.length !== 1) return false;
      const caretOffset = getCaretCharacterOffsetWithin(block, selection);
      if (event.key === 'Backspace' && caretOffset !== text.length) return false;
      if (event.key === 'Delete' && caretOffset !== 0) return false;

      const sourceTransaction = richDeleteToEmptyBlockTransaction(block, range, event.key);
      if (sourceTransaction) {
        event.preventDefault();
        state.richSelectionLock = true;
        applySourceTransaction(sourceTransaction, 'rich-delete-to-empty-block');
        state.richSelectionLock = false;
        suppressRichInlineActivation();
        return true;
      }

      if (guardFailedRichSourceControlTransaction(block, 'rich-delete-to-empty-block', 'ブロックを空にできませんでした')) {
        event.preventDefault();
        return true;
      }

      event.preventDefault();
      state.richSelectionLock = true;
      block.replaceChildren(document.createTextNode(''), document.createElement('br'));
      placeCaretAtStart(block);
      state.richSelectionLock = false;
      suppressRichInlineActivation();
      syncRichMarkdownFromDom('rich-input');
      return true;
    }

    function richDeleteToEmptyBlockTransaction(block, range, key) {
      if (!block || !range?.collapsed || !isSourceTransactionTextRange(range)) return null;
      const point = richPlainTextSourcePointFromRange(range);
      if (!point || !Number.isFinite(point.offset)) return null;
      const backward = key === 'Backspace';
      const deletionRange = richPlainTextDeletionRange(point, backward);
      if (!deletionRange) return null;
      const { from, to } = deletionRange;
      if (from < point.contentStart || to > point.contentEnd || from < 0 || to <= from) return null;

      const sourceBlock = nodeClosest(block, RICH_SOURCE_BLOCK_SELECTOR);
      const isParagraph = sourceBlock?.dataset?.blockType === 'paragraph';
      const blockStart = numericData(sourceBlock, 'sourceStart');
      const blockEnd = numericData(sourceBlock, 'sourceEnd');
      const markdown = stripRichCaretTokens(state.markdown || els.source.value || '');
      const raw = Number.isFinite(blockStart) && Number.isFinite(blockEnd)
        ? markdown.slice(blockStart, blockEnd)
        : '';
      const becomesEmptyParagraph = isParagraph && raw.length === to - from;

      return {
        from,
        to,
        insert: '',
        selectionAfter: {
          anchor: from,
          focus: from,
          affinity: backward ? 'before' : 'after',
        },
        blankParagraphAt: becomesEmptyParagraph ? from : undefined,
      };
    }

    function handleRichEnter(event) {
      event.preventDefault();
      window.clearTimeout(state.richReparseTimer);

      const selection = window.getSelection?.();
      const range = richInputRangeFromEvent(event) || richSelectionRange(selection);
      if (!range || !els.rich.contains(range.startContainer)) return;
      pushRichUndoSnapshot('line-break');

      if (!event.shiftKey && handleRichSelectionEnterTransaction(selection)) {
        return;
      }

      if (!event.shiftKey && (
        parsePendingRichMathShortcutInBlock(richPendingMathShortcutBlockFromRange(range))
        || activatePendingMathShortcutFromSelection()
      )) {
        return;
      }

      if (event.shiftKey) {
        const tableCell = nodeClosest(range.startContainer, 'td, th');
        if (tableCell && els.rich.contains(tableCell) && handleRichTableCellLineBreakTransaction(tableCell, range)) return;
        const quote = nodeClosest(range.startContainer, 'blockquote');
        if (quote && els.rich.contains(quote) && handleRichQuoteLineBreakTransaction(quote, range)) return;
        if (handleRichLineBreakTransaction({ pushUndo: false })) return;
        if (insertRichLineBreakAtRange(range)) syncRichMarkdownFromDom('rich-input');
        return;
      }

      if (!range.collapsed && guardUnsupportedRichSelectionEnterFallback(range)) return;
      if (!range.collapsed) range.deleteContents();

      const tableCell = nodeClosest(range.startContainer, 'td, th');
      if (tableCell && els.rich.contains(tableCell)) {
        if (handleRichTableCellLineBreakTransaction(tableCell, range)) return;
        if (insertRichLineBreakAtRange(range)) syncRichMarkdownFromDom('rich-input');
        return;
      }

      const quote = nodeClosest(range.startContainer, 'blockquote');
      if (quote && els.rich.contains(quote) && handleRichQuoteEnterTransaction(quote, range)) {
        return;
      }

      const listItem = richListItemFromRange(range);
      if (listItem && els.rich.contains(listItem)) {
        handleRichListEnter(listItem, range);
        return;
      }

      const textBlock = richTextBlockFromRange(range);
      if (textBlock) {
        if (handleRichTextBlockEnterTransaction(textBlock, range)) return;
        if (guardUnsupportedRichTextBlockEnterFallback(textBlock, range)) return;
        splitRichTextBlockAtRange(textBlock, range);
        return;
      }

      const anchor = range.startContainer.nodeType === Node.ELEMENT_NODE
        ? range.startContainer
        : range.startContainer.parentElement;
      const current = anchor?.closest?.('p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, table, figure, nav, div');
      const insertionBase = richParagraphInsertionBase(current);
      const paragraph = document.createElement('p');
      paragraph.appendChild(document.createElement('br'));

      if (insertionBase && insertionBase !== els.rich) {
        insertionBase.after(paragraph);
      } else {
        els.rich.appendChild(paragraph);
      }
      placeCaretAtStart(paragraph);
      syncRichMarkdownFromDom('rich-input');
    }

    function handleRichSelectionEnterTransaction(selection) {
      if (!selection || selection.isCollapsed) return false;
      const tableRange = richTableTextReplacementRangeFromSelection(selection);
      const quoteRange = tableRange ? null : richQuoteTextReplacementRangeFromSelection(selection);
      const rawRange = tableRange || quoteRange || richPlainTextTransactionRangeFromSelection(selection);
      const replacementRange = rawRange?.from !== rawRange?.to
        ? expandSourceRangeToIntersectingInlineAtoms(rawRange)
        : rawRange;
      if (!replacementRange || replacementRange.from === replacementRange.to) return false;
      const markdown = stripRichCaretTokens(state.markdown || els.source.value || '');
      const replacement = tableRange || quoteRange
        ? {
          from: replacementRange.from,
          to: replacementRange.to,
          insert: tableRange ? '<br>' : '\n> ',
        }
        : sourceParagraphBreakReplacement(markdown, replacementRange.from, replacementRange.to);
      applySourceTransaction({
        from: replacement.from,
        to: replacement.to,
        insert: replacement.insert,
        selectionAfter: {
          anchor: replacement.from + replacement.insert.length,
          focus: replacement.from + replacement.insert.length,
          affinity: 'after',
        },
      }, 'rich-selection-enter');
      suppressRichInlineActivation();
      return true;
    }

    function guardUnsupportedRichSelectionEnterFallback(range) {
      if (!range || range.collapsed || !els.rich.contains(range.startContainer) || !els.rich.contains(range.endContainer)) return false;
      if (!richRangeTouchesSourceBlock(range)) return false;
      setStatus('この選択では段落を分割できません');
      suppressRichInlineActivation();
      return true;
    }

    function sourceParagraphBreakReplacement(markdown, from, to) {
      const source = String(markdown || '');
      let start = Math.max(0, Math.min(source.length, Number(from)));
      let end = Math.max(start, Math.min(source.length, Number(to)));
      const beforeHasBlockBreak = source.slice(0, start).endsWith('\n\n');
      const afterBreak = source.slice(end).match(/^\n{1,2}/)?.[0] || '';
      if (afterBreak) end += afterBreak.length;
      return {
        from: start,
        to: end,
        insert: beforeHasBlockBreak ? '' : '\n\n',
      };
    }

    function handleRichTextBlockEnterTransaction(textBlock, range) {
      if (!textBlock || textBlock === els.rich || !range?.collapsed) return false;
      if (!textBlock.matches?.('p, h1, h2, h3, h4, h5, h6')) return false;
      if (!textBlock.matches?.(RICH_SOURCE_BLOCK_SELECTOR)) return false;
      const sourcePoint = domPointToSourceOffset(range.startContainer, range.startOffset);
      if (!sourcePoint || !Number.isFinite(sourcePoint.offset)) return false;
      const blockStart = numericData(textBlock, 'sourceStart');
      const blockEnd = numericData(textBlock, 'sourceEnd');
      if (sourcePoint.offset < blockStart || sourcePoint.offset > blockEnd) return false;
      const blankParagraphAt = sourcePoint.offset === blockStart
        ? blockStart
        : sourcePoint.offset === blockEnd
          ? sourcePoint.offset + 2
          : undefined;
      const placeCaretInBlankParagraph = sourcePoint.offset === blockEnd ? undefined : false;
      return applySourceTransaction({
        from: sourcePoint.offset,
        to: sourcePoint.offset,
        insert: '\n\n',
        selectionAfter: {
          anchor: sourcePoint.offset + 2,
          focus: sourcePoint.offset + 2,
          affinity: 'after',
        },
        blankParagraphAt,
        placeCaretInBlankParagraph,
      }, 'rich-enter-text-block');
    }

    function guardUnsupportedRichTextBlockEnterFallback(block, range) {
      if (!block || !range || !els.rich.contains(block)) return false;
      const sourceBlock = nodeClosest(block, RICH_SOURCE_BLOCK_SELECTOR) || nodeClosest(range.startContainer, RICH_SOURCE_BLOCK_SELECTOR);
      if (!sourceBlock) return false;
      setStatus('この位置では段落を分割できません');
      suppressRichInlineActivation();
      return true;
    }

    function richInputRangeFromEvent(event) {
      const ranges = event.getTargetRanges?.();
      const inputRange = ranges && ranges[0];
      if (!inputRange || !els.rich.contains(inputRange.startContainer) || !els.rich.contains(inputRange.endContainer)) return null;
      const range = document.createRange();
      try {
        range.setStart(inputRange.startContainer, inputRange.startOffset);
        range.setEnd(inputRange.endContainer, inputRange.endOffset);
      } catch (_) {
        return null;
      }
      return range;
    }

    function richSelectionRange(selection) {
      if (!selection || !selection.rangeCount || !els.rich.contains(selection.anchorNode) || !els.rich.contains(selection.focusNode)) return null;
      let range = null;
      try {
        range = selection.getRangeAt(0);
      } catch (_) {
        return null;
      }
      if (!els.rich.contains(range.startContainer) || !els.rich.contains(range.endContainer)) return null;
      return range;
    }

    function richTextBlockFromRange(range) {
      const block = nodeClosest(range.startContainer, 'p, h1, h2, h3, h4, h5, h6, div') || (
        range.startContainer.nodeType === Node.TEXT_NODE && range.startContainer.parentNode === els.rich ? els.rich : null
      );
      if (!block || !els.rich.contains(block)) return null;
      if (block !== els.rich && block.closest('li, .rich-source-editor, .mermaid-diagram, pre.code-block, .math-display, .toc')) return null;
      return block;
    }

    function splitRichTextBlockAtRange(block, range) {
      if (block === els.rich) {
        splitRootTextAtRange(range);
        return;
      }

      const next = document.createElement('p');
      const tail = extractRichBlockTail(block, range);
      appendRichBlockTail(next, tail);
      ensureRichTextBlockPlaceholder(block);
      block.after(next);
      placeCaretAtStart(next);
      syncRichMarkdownFromDom('rich-input');
    }

    function splitRootTextAtRange(range) {
      if (range.startContainer.nodeType !== Node.TEXT_NODE || range.startContainer.parentNode !== els.rich) return;
      const textNode = range.startContainer;
      const value = textNode.nodeValue || '';
      const previous = document.createElement('p');
      previous.textContent = value.slice(0, range.startOffset);
      const next = document.createElement('p');
      next.textContent = value.slice(range.startOffset);
      ensureRichTextBlockPlaceholder(previous);
      ensureRichTextBlockPlaceholder(next);
      textNode.replaceWith(previous, next);
      placeCaretAtStart(next);
      syncRichMarkdownFromDom('rich-input');
    }

    function extractRichBlockTail(block, range) {
      const tailRange = document.createRange();
      tailRange.setStart(range.startContainer, range.startOffset);
      tailRange.setEnd(block, block.childNodes.length);
      return tailRange.extractContents();
    }

    function appendRichBlockTail(block, fragment) {
      if (isFragmentVisiblyEmpty(fragment)) {
        block.appendChild(document.createTextNode(''));
        block.appendChild(document.createElement('br'));
        return;
      }
      block.appendChild(fragment);
    }

    function ensureRichTextBlockPlaceholder(block) {
      if (!areInlineNodesVisiblyEmpty(Array.from(block.childNodes))) return;
      block.replaceChildren(document.createTextNode(''), document.createElement('br'));
    }

    function richParagraphInsertionBase(element) {
      if (!element || !els.rich.contains(element)) return els.rich.lastElementChild || els.rich;
      if (element.tagName?.toLowerCase() === 'li') return element.closest('ul, ol') || element;
      return element;
    }

    function richListItemFromRange(range) {
      const startItem = nodeClosest(range.startContainer, 'li');
      if (startItem && els.rich.contains(startItem)) return startItem;
      const selection = window.getSelection?.();
      const focusItem = nodeClosest(selection?.focusNode, 'li');
      return focusItem && els.rich.contains(focusItem) ? focusItem : null;
    }

    function handleRichListArrowNavigation(event) {
      if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return false;
      if (event.target.closest?.('.rich-source-editor, .code-language-input')) return false;
      const selection = window.getSelection?.();
      if (!selection || !selection.rangeCount || !selection.isCollapsed || !els.rich.contains(selection.anchorNode)) return false;
      const range = selection.getRangeAt(0);
      const item = richListItemFromRange(range);
      if (!item) return false;
      const lineInfo = richListSoftLineInfo(item, range);
      if (shouldUseNativeListSoftLineArrow(item, range, event.key)) return false;
      const direction = event.key === 'ArrowDown' ? 'next' : 'previous';
      const nextItem = adjacentRichListItem(item, direction);
      if (!nextItem) return false;
      event.preventDefault();
      const caretColumn = lineInfo?.column ?? richListCaretTextOffset(item, range);
      if (!placeCaretInListItemSoftLine(nextItem, direction === 'previous' ? 'last' : 'first', caretColumn)) {
        placeCaretInListItemAtTextOffset(nextItem, richListCaretTextOffset(item, range));
      }
      return true;
    }

    function shouldUseNativeListSoftLineArrow(item, range, key) {
      const lineInfo = richListSoftLineInfo(item, range);
      if (!lineInfo || lineInfo.lineCount <= 1) return false;
      if (key === 'ArrowUp') return lineInfo.lineIndex > 0;
      if (key === 'ArrowDown') return lineInfo.lineIndex < lineInfo.lineCount - 1;
      return false;
    }

    function richListSoftLineInfo(item, range) {
      const lineCount = listItemSoftLineBreakCount(item) + 1;
      if (lineCount <= 1) return null;
      const before = document.createRange();
      before.selectNodeContents(item);
      try {
        before.setEnd(range.startContainer, range.startOffset);
      } catch (_) {
        return null;
      }
      const caretLine = softLinePositionFromFragment(before.cloneContents());
      return {
        lineCount,
        lineIndex: Math.max(0, Math.min(lineCount - 1, caretLine.lineIndex)),
        column: caretLine.column,
      };
    }

    function listItemSoftLineBreakCount(item) {
      const range = document.createRange();
      range.selectNodeContents(item);
      range.setEnd(item, listItemContentEndOffset(item));
      return range.cloneContents().querySelectorAll('br').length;
    }

    function softLinePositionFromFragment(fragment) {
      let lineIndex = 0;
      let column = 0;
      const visit = (node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          column += normalizeRichText(node.nodeValue || '').length;
          return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        if (node.tagName?.toLowerCase() === 'br') {
          lineIndex += 1;
          column = 0;
          return;
        }
        Array.from(node.childNodes).forEach(visit);
      };
      Array.from(fragment.childNodes).forEach(visit);
      return { lineIndex, column };
    }

    function placeCaretInListItemSoftLine(item, targetLine, column = 0) {
      const lineCount = listItemSoftLineBreakCount(item) + 1;
      const lineIndex = targetLine === 'last' ? lineCount - 1 : 0;
      const position = findListItemSoftLinePosition(item, lineIndex, Math.max(0, column || 0));
      if (!position) return false;
      const range = document.createRange();
      if (position.beforeNode) {
        range.setStartBefore(position.beforeNode);
      } else if (position.afterNode) {
        range.setStartAfter(position.afterNode);
      } else {
        range.setStart(position.node, position.offset);
      }
      range.collapse(true);
      const selection = window.getSelection?.();
      if (!selection) return false;
      selection.removeAllRanges();
      selection.addRange(range);
      els.rich.focus();
      return true;
    }

    function findListItemSoftLinePosition(item, targetLine, targetColumn) {
      const childNodes = Array.from(item.childNodes).slice(0, listItemContentEndOffset(item)).filter((child) => !(
        child.nodeType === Node.ELEMENT_NODE && child.classList.contains('task-checkbox')
      ));
      let lineIndex = 0;
      let column = 0;
      let lastPosition = null;
      let found = null;

      const visit = (node) => {
        if (found) return;
        if (node.nodeType === Node.TEXT_NODE) {
          if (lineIndex === targetLine) {
            const text = node.nodeValue || '';
            const length = normalizeRichText(text).length;
            if (column + length >= targetColumn) {
              found = { node, offset: Math.max(0, Math.min(text.length, targetColumn - column)) };
              return;
            }
            lastPosition = { node, offset: text.length };
          }
          column += normalizeRichText(node.nodeValue || '').length;
          return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        if (node.tagName?.toLowerCase() === 'br') {
          if (lineIndex === targetLine && !found) {
            found = lastPosition || { beforeNode: node };
            return;
          }
          lineIndex += 1;
          column = 0;
          lastPosition = null;
          return;
        }
        Array.from(node.childNodes).forEach(visit);
      };

      childNodes.forEach(visit);
      if (found) return found;
      return lineIndex === targetLine ? lastPosition || { node: item, offset: item.childNodes.length } : null;
    }

    function handleRichLineBoundaryArrow(event) {
      if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return false;
      if (event.target.closest?.('.rich-source-editor, .code-language-input')) return false;
      const selection = window.getSelection?.();
      if (!selection || !selection.rangeCount || !selection.isCollapsed || !els.rich.contains(selection.anchorNode)) return false;
      if (nodeClosest(selection.anchorNode, '.rich-inline-source')) return false;

      const range = selection.getRangeAt(0);
      const block = richCaretBlockFromRange(range);
      if (!block) return false;

      const offset = richCaretBlockTextOffset(block, range);
      const length = richCaretBlockTextLength(block);
      const target = event.key === 'ArrowRight' && offset >= length
        ? adjacentRichCaretBlock(block, 'next')
        : event.key === 'ArrowLeft' && offset <= 0
          ? adjacentRichCaretBlock(block, 'previous')
          : null;
      if (!target) return false;

      event.preventDefault();
      cleanupRichCaretBoundaryMarkers({ preserveSelection: false });
      if (target.tagName?.toLowerCase() === 'li') {
        if (event.key === 'ArrowRight') {
          placeCaretAtListItemStart(target);
        } else {
          placeCaretAtListItemEnd(target);
        }
      } else if (event.key === 'ArrowRight') {
        placeCaretAtStart(target);
      } else {
        placeCaretAtEnd(target);
      }
      suppressRichInlineActivation();
      return true;
    }

    function richCaretBlockFromRange(range) {
      const block = nodeClosest(range.startContainer, RICH_INLINE_EDIT_BLOCK_SELECTOR);
      if (!block || !els.rich.contains(block)) return null;
      if (block.closest('.rich-source-editor, .mermaid-diagram, pre.code-block, .math-display, .toc')) return null;
      return block;
    }

    function richCaretBlockTextOffset(block, range) {
      const before = document.createRange();
      before.selectNodeContents(block);
      try {
        before.setEnd(range.startContainer, range.startOffset);
        if (block.tagName?.toLowerCase() === 'li') {
          const end = listItemContentEndOffset(block);
          const full = document.createRange();
          full.selectNodeContents(block);
          full.setEnd(block, end);
          if (before.compareBoundaryPoints(Range.END_TO_END, full) > 0) {
            return richCaretBlockTextLength(block);
          }
        }
      } catch (_) {
        return 0;
      }
      return normalizeRichText(before.toString()).length;
    }

    function richCaretBlockTextLength(block) {
      const range = document.createRange();
      range.selectNodeContents(block);
      if (block.tagName?.toLowerCase() === 'li') {
        range.setEnd(block, listItemContentEndOffset(block));
      }
      return normalizeRichText(range.toString()).length;
    }

    function adjacentRichCaretBlock(block, direction) {
      const blocks = richCaretBlocksInDocumentOrder();
      const index = blocks.indexOf(block);
      if (index === -1) return null;
      return direction === 'next' ? blocks[index + 1] || null : blocks[index - 1] || null;
    }

    function richCaretBlocksInDocumentOrder() {
      const blocks = [];
      const walker = document.createTreeWalker(els.rich, NodeFilter.SHOW_ELEMENT, {
        acceptNode(node) {
          if (!node.matches?.(RICH_INLINE_EDIT_BLOCK_SELECTOR)) return NodeFilter.FILTER_SKIP;
          if (node.closest('.rich-source-editor, .mermaid-diagram, pre.code-block, .math-display, .toc')) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      });
      while (walker.nextNode()) blocks.push(walker.currentNode);
      return blocks;
    }

    function adjacentRichListItem(item, direction) {
      const siblingProperty = direction === 'next' ? 'nextElementSibling' : 'previousElementSibling';
      let sibling = item[siblingProperty];
      while (sibling) {
        if (sibling.tagName?.toLowerCase() === 'li') return sibling;
        sibling = sibling[siblingProperty];
      }
      return null;
    }

    function richListCaretTextOffset(item, range) {
      const before = range.cloneRange();
      before.selectNodeContents(item);
      try {
        before.setEnd(range.startContainer, range.startOffset);
      } catch (_) {
        return 0;
      }
      return listFragmentVisibleText(before.cloneContents()).length;
    }

    function richListCaretSourceContentOffset(item, range) {
      const before = range.cloneRange();
      before.selectNodeContents(item);
      try {
        before.setEnd(range.startContainer, range.startOffset);
      } catch (_) {
        return 0;
      }
      return stripRichCaretTokens(serializeInlineNodes(Array.from(before.cloneContents().childNodes))).length;
    }

    function listFragmentVisibleText(fragment) {
      let text = '';
      const visit = (node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          const raw = normalizeRichText(node.nodeValue || '');
          const beforeHardBreak = node.nextSibling?.nodeType === Node.ELEMENT_NODE
            && node.nextSibling.tagName?.toLowerCase() === 'br';
          text += beforeHardBreak ? raw.replace(/[ \t]{2}$/, '') : raw;
          return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        if (node.tagName?.toLowerCase() === 'br') {
          text += '\n';
          return;
        }
        Array.from(node.childNodes).forEach(visit);
      };
      Array.from(fragment.childNodes || []).forEach(visit);
      return text;
    }

    function placeCaretInListItemAtTextOffset(item, targetOffset) {
      const position = findListItemTextPosition(item, targetOffset);
      if (!position) {
        placeCaretAtListItemStart(item);
        return;
      }
      const range = document.createRange();
      range.setStart(position.node, position.offset);
      range.collapse(true);
      const selection = window.getSelection?.();
      if (!selection) return;
      selection.removeAllRanges();
      selection.addRange(range);
      els.rich.focus();
    }

    function findListItemTextPosition(item, targetOffset) {
      const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          if (nodeClosest(node, 'li') !== item) return NodeFilter.FILTER_REJECT;
          if (node.parentElement?.closest('.rich-source-editor, .code-language-input')) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      });
      let consumed = 0;
      let last = null;
      while (walker.nextNode()) {
        const node = walker.currentNode;
        last = node;
        const length = normalizeRichText(node.nodeValue || '').length;
        if (consumed + length >= targetOffset) {
          return { node, offset: Math.max(0, Math.min(node.nodeValue.length, targetOffset - consumed)) };
        }
        consumed += length;
      }
      return last ? { node: last, offset: last.nodeValue.length } : null;
    }

    function handleRichListEnter(item, range) {
      const list = item.closest('ul, ol');
      if (!list) return;

      if (handleRichListEnterTransaction(item, range, list)) return;
      if (guardFailedRichSourceControlTransaction(list, 'rich-list-enter', 'リスト項目を分割できませんでした')) return;

      if (isRichListItemEmpty(item)) {
        exitRichListItem(item, list);
        syncRichMarkdownFromDom('rich-input');
        return;
      }

      const nextItem = createEmptyListItemLike(item, list);
      const tail = extractListItemTail(item, range);
      appendListItemTail(nextItem, tail);
      ensureListItemEditablePlaceholder(item);
      item.after(nextItem);
      placeCaretAtListItemStart(nextItem);
      syncRichMarkdownFromDom('rich-input');
    }

    function handleRichListEnterTransaction(item, range, list) {
      if (!range?.collapsed || !list?.matches?.(RICH_SOURCE_BLOCK_SELECTOR)) return false;
      if (item.parentElement !== list) return false;
      if (item.querySelector('.rich-inline-source')) return false;
      const blockStart = numericData(list, 'sourceStart');
      const blockEnd = numericData(list, 'sourceEnd');
      const raw = stripRichCaretTokens(state.markdown || '').slice(blockStart, blockEnd);
      const sourceItems = flatListSourceItems(raw);
      const items = Array.from(list.children).filter((child) => child.tagName?.toLowerCase() === 'li');
      const itemIndex = items.indexOf(item);
      if (itemIndex < 0 || sourceItems.length !== items.length) return false;
      const sourceItem = sourceItems[itemIndex];
      const parsed = sourceItem?.parsed;
      if (!sourceItem || !parsed) return false;
      const content = visibleTextFromListSourceItem(sourceItem);

      if (isRichListItemEmpty(item)) {
        if (content.trim() !== '') return false;
        const from = blockStart + sourceItem.start;
        const to = blockStart + sourceItem.end;
        return applySourceTransaction({
          from,
          to,
          insert: '\n',
          blankParagraphAt: from + 1,
          selectionAfter: {
            anchor: from + 1,
            focus: from + 1,
            affinity: 'after',
          },
        }, 'rich-list-exit');
      }

      const serialized = visibleListItemText(item);
      if (content !== serialized) return false;

      const caretOffset = Math.max(0, Math.min(content.length, richListCaretSourceContentOffset(item, range)));
      const currentSource = listItemSourceFromText(parsed.prefix, parsed, content.slice(0, caretOffset));
      const nextPrefix = nextListSourcePrefix(parsed);
      const nextSource = listItemSourceFromText(nextPrefix, parsed, content.slice(caretOffset));
      const from = blockStart + sourceItem.start;
      const to = blockStart + listSourceItemTextEnd(sourceItem);
      const insert = `${currentSource}\n${nextSource}`;
      const nextCaret = caretOffset === 0
        ? from + parsed.prefix.length
        : from + currentSource.length + 1 + nextPrefix.length;
      return applySourceTransaction({
        from,
        to,
        insert,
        selectionAfter: {
          anchor: nextCaret,
          focus: nextCaret,
          affinity: 'after',
        },
      }, 'rich-list-enter');
    }

    function listItemSourceFromText(firstPrefix, parsed, text) {
      const lines = String(text || '').split('\n');
      const continuationPrefix = `${parsed?.indent || ''}  `;
      return lines.map((line, index) => `${index === 0 ? firstPrefix : continuationPrefix}${line}`).join('\n');
    }

    function listSourceItemTextEnd(sourceItem) {
      const lastLine = sourceItem?.lines?.[sourceItem.lines.length - 1];
      if (!lastLine) return sourceItem?.end || 0;
      return lastLine.start + String(lastLine.text || '').length;
    }

    function parseFlatListSourceLine(line) {
      const match = String(line || '').match(/^(\s*)([-+*]|\d+\.)(\s+)(?:\[([ xX])\](\s+))?/);
      if (!match) return null;
      const marker = match[2];
      const ordered = /^\d+\.$/.test(marker);
      const number = ordered ? Number.parseInt(marker, 10) : null;
      return {
        indent: match[1] || '',
        marker,
        ordered,
        number,
        task: match[4] !== undefined,
        prefix: match[0],
      };
    }

    function flatListSourceItems(raw) {
      const sourceItems = [];
      let current = null;
      for (const line of getLines(raw).filter((item) => item.text.trim() !== '')) {
        const parsed = parseFlatListSourceLine(line.text);
        if (parsed) {
          current = {
            start: line.start,
            end: line.end,
            parsed,
            lines: [line],
          };
          sourceItems.push(current);
          continue;
        }
        if (!current) continue;
        current.lines.push(line);
        current.end = line.end;
      }
      return sourceItems;
    }

    function visibleTextFromListSourceItem(sourceItem) {
      if (!sourceItem?.lines?.length) return '';
      return sourceItem.lines.map((line, index) => {
        const prefixLength = index === 0
          ? sourceItem.parsed.prefix.length
          : listContinuationPrefixLength(line.text, sourceItem.parsed);
        return line.text.slice(prefixLength).replace(/[ \t]{2}$/, '');
      }).join('\n');
    }

    function listContinuationPrefixLength(line, parsed) {
      const expected = `${parsed?.indent || ''}  `;
      if (String(line || '').startsWith(expected)) return expected.length;
      const match = String(line || '').match(/^\s*/);
      return match ? match[0].length : 0;
    }

    function sourceOffsetFromListItemTextOffset(sourceItem, textOffset) {
      const target = Math.max(0, Number(textOffset) || 0);
      let consumed = 0;
      for (let index = 0; index < sourceItem.lines.length; index += 1) {
        const line = sourceItem.lines[index];
        const prefixLength = index === 0
          ? sourceItem.parsed.prefix.length
          : listContinuationPrefixLength(line.text, sourceItem.parsed);
        const visible = line.text.slice(prefixLength).replace(/[ \t]{2}$/, '');
        if (target <= consumed + visible.length) {
          return line.start + prefixLength + (target - consumed);
        }
        consumed += visible.length;
        if (index < sourceItem.lines.length - 1) {
          if (target <= consumed + 1) {
            const nextLine = sourceItem.lines[index + 1];
            return nextLine.start + listContinuationPrefixLength(nextLine.text, sourceItem.parsed);
          }
          consumed += 1;
        }
      }
      const lastLine = sourceItem.lines[sourceItem.lines.length - 1];
      const lastPrefix = sourceItem.lines.length === 1
        ? sourceItem.parsed.prefix.length
        : listContinuationPrefixLength(lastLine.text, sourceItem.parsed);
      return lastLine.start + lastPrefix + lastLine.text.slice(lastPrefix).length;
    }

    function textOffsetFromListItemSourceOffset(sourceItem, localOffset) {
      const target = Math.max(sourceItem.start, Math.min(sourceItem.end, Number(localOffset) || 0));
      let consumed = 0;
      for (let index = 0; index < sourceItem.lines.length; index += 1) {
        const line = sourceItem.lines[index];
        const prefixLength = index === 0
          ? sourceItem.parsed.prefix.length
          : listContinuationPrefixLength(line.text, sourceItem.parsed);
        const visible = line.text.slice(prefixLength).replace(/[ \t]{2}$/, '');
        const contentStart = line.start + prefixLength;
        const contentEnd = contentStart + visible.length;
        if (target <= contentStart) return consumed;
        if (target <= contentEnd) return consumed + (target - contentStart);
        consumed += visible.length;
        if (index < sourceItem.lines.length - 1) consumed += 1;
      }
      return consumed;
    }

    function nextListSourcePrefix(parsed) {
      const marker = parsed.ordered ? `${(parsed.number || 1) + 1}.` : parsed.marker;
      const base = `${parsed.indent}${marker} `;
      return parsed.task ? `${base}[ ] ` : base;
    }

    function visibleListItemText(item) {
      return stripRichCaretTokens(normalizeRichText(serializeInlineNodes(listItemEditableContentNodes(item)))).replace(/[ \t]{2}\n/g, '\n');
    }

    function createEmptyListItemLike(item, list) {
      const nextItem = document.createElement('li');
      if (item.classList.contains('task-list-item') || list.classList.contains('task-list')) {
        nextItem.className = 'task-list-item';
        nextItem.appendChild(createTaskCheckbox());
      }
      return nextItem;
    }

    function extractListItemTail(item, range) {
      const tailRange = document.createRange();
      tailRange.setStart(range.startContainer, range.startOffset);
      tailRange.setEnd(item, listItemContentEndOffset(item));
      const fragment = tailRange.extractContents();
      fragment.querySelectorAll?.('.task-checkbox').forEach((checkbox) => checkbox.remove());
      return fragment;
    }

    function listItemContentEndOffset(item) {
      const nestedListIndex = Array.from(item.childNodes).findIndex((child) => (
        child.nodeType === Node.ELEMENT_NODE && ['ul', 'ol'].includes(child.tagName.toLowerCase())
      ));
      return nestedListIndex === -1 ? item.childNodes.length : nestedListIndex;
    }

    function appendListItemTail(item, fragment) {
      if (isFragmentVisiblyEmpty(fragment)) {
        item.appendChild(document.createTextNode(''));
        item.appendChild(document.createElement('br'));
        return;
      }
      item.appendChild(fragment);
      ensureListItemEditablePlaceholder(item);
    }

    function ensureListItemEditablePlaceholder(item) {
      const contentNodes = listItemEditableContentNodes(item);
      if (contentNodes.length === 0 || areInlineNodesVisiblyEmpty(contentNodes)) {
        contentNodes.forEach((node) => node.remove());
        item.appendChild(document.createTextNode(''));
        item.appendChild(document.createElement('br'));
      }
    }

    function listItemEditableContentNodes(item) {
      return Array.from(item.childNodes).filter((child) => {
        if (child.nodeType !== Node.ELEMENT_NODE) return true;
        if (['ul', 'ol'].includes(child.tagName.toLowerCase())) return false;
        return !child.classList.contains('task-checkbox');
      });
    }

    function isFragmentVisiblyEmpty(fragment) {
      return areInlineNodesVisiblyEmpty(Array.from(fragment.childNodes));
    }

    function exitRichListItem(item, list) {
      const paragraph = document.createElement('p');
      paragraph.appendChild(document.createTextNode(''));
      paragraph.appendChild(document.createElement('br'));

      const afterList = document.createElement(list.tagName.toLowerCase());
      afterList.className = list.className;
      while (item.nextSibling) afterList.appendChild(item.nextSibling);

      list.after(paragraph);
      if (Array.from(afterList.children).some((child) => child.tagName?.toLowerCase() === 'li')) {
        paragraph.after(afterList);
      }

      item.remove();
      if (!Array.from(list.children).some((child) => child.tagName?.toLowerCase() === 'li')) {
        list.remove();
      }
      placeCaretAtStart(paragraph);
    }

    function isRichListItemEmpty(item) {
      const contentNodes = listItemEditableContentNodes(item);
      return areInlineNodesVisiblyEmpty(contentNodes);
    }

    function areInlineNodesVisiblyEmpty(nodes) {
      return !Array.from(nodes || []).some((node) => inlineNodeHasVisibleContent(node));
    }

    function inlineNodeHasVisibleContent(node) {
      if (!node) return false;
      if (node.nodeType === Node.TEXT_NODE) return normalizeRichText(node.nodeValue || '').replace(/\s+/g, '') !== '';
      if (node.nodeType !== Node.ELEMENT_NODE) return false;
      const element = node;
      if (element.classList.contains('rich-list-caret-anchor')) {
        return normalizeRichText(element.textContent || '').replace(/\u200b/g, '').replace(/\s+/g, '') !== '';
      }
      if (element.classList.contains('rich-line-break-caret-anchor')) {
        return normalizeRichText(element.textContent || '').replace(/\u200b/g, '').replace(/\s+/g, '') !== '';
      }
      if (element.classList.contains('task-checkbox') || element.classList.contains('code-language-input')) return false;
      const tag = element.tagName.toLowerCase();
      if (tag === 'br') return false;
      if (tag === 'img') return true;
      if (element.classList.contains('math-inline') || element.classList.contains('math-display')) {
        return Boolean(richSourceFromElement('math', element).trim());
      }
      return Array.from(element.childNodes).some((child) => inlineNodeHasVisibleContent(child));
    }

    function createTaskCheckbox() {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'task-checkbox';
      checkbox.setAttribute('contenteditable', 'false');
      return checkbox;
    }

    function placeCaretAtListItemStart(item) {
      const children = Array.from(item.childNodes);
      const offset = children.findIndex((child) => !(child.nodeType === 1 && child.classList.contains('task-checkbox')));
      const range = document.createRange();
      const child = offset === -1 ? null : children[offset];
      if (child?.nodeType === Node.TEXT_NODE) {
        range.setStart(child, 0);
      } else if (child) {
        range.setStartBefore(child);
      } else {
        range.setStart(item, item.childNodes.length);
      }
      range.collapse(true);
      const selection = window.getSelection?.();
      if (!selection) return;
      selection.removeAllRanges();
      selection.addRange(range);
      els.rich.focus();
    }

    function placeCaretAtListItemEnd(item) {
      const position = findListItemTextPosition(item, Number.MAX_SAFE_INTEGER);
      const range = document.createRange();
      if (position) {
        range.setStart(position.node, position.offset);
      } else {
        range.selectNodeContents(item);
        range.collapse(false);
      }
      range.collapse(true);
      const selection = window.getSelection?.();
      if (!selection) return;
      selection.removeAllRanges();
      selection.addRange(range);
      els.rich.focus();
    }

    function insertRichLineBreak() {
      const selection = window.getSelection?.();
      const range = richSelectionRange(selection);
      if (!range) return false;
      return insertRichLineBreakAtRange(range);
    }

    function handleRichLineBreakTransaction(options = {}) {
      const selection = window.getSelection?.();
      const replacementRange = richLineBreakTransactionRangeFromSelection(selection);
      if (!replacementRange) return false;
      if (options.pushUndo) pushRichUndoSnapshot('line-break');
      const insert = richLineBreakInsertForSelection(selection);
      const nextOffset = replacementRange.from + insert.length;
      applySourceTransaction({
        from: replacementRange.from,
        to: replacementRange.to,
        insert,
        selectionAfter: {
          anchor: nextOffset,
          focus: nextOffset,
          affinity: 'after',
        },
      }, 'rich-line-break');
      suppressRichInlineActivation();
      return true;
    }

    function richLineBreakTransactionRangeFromSelection(selection) {
      const tableRange = richTableTextReplacementRangeFromSelection(selection);
      const quoteRange = tableRange ? null : richQuoteTextReplacementRangeFromSelection(selection);
      const rawRange = tableRange || quoteRange || richPlainTextTransactionRangeFromSelection(selection);
      if (!rawRange) return null;
      const range = rawRange.from !== rawRange.to
        ? expandSourceRangeToIntersectingInlineAtoms(rawRange)
        : rawRange;
      if (!Number.isFinite(range.from) || !Number.isFinite(range.to) || range.to < range.from) return null;
      return range;
    }

    function richLineBreakInsertForSelection(selection) {
      const cell = nodeClosest(selection?.anchorNode, 'td, th');
      const focusCell = nodeClosest(selection?.focusNode, 'td, th');
      if (cell && cell === focusCell && els.rich.contains(cell)) return '<br>';

      const quote = nodeClosest(selection?.anchorNode, 'blockquote');
      const focusQuote = nodeClosest(selection?.focusNode, 'blockquote');
      if (quote && quote === focusQuote && els.rich.contains(quote)) return '  \n> ';

      const item = nodeClosest(selection?.anchorNode, 'li');
      const focusItem = nodeClosest(selection?.focusNode, 'li');
      if (!item || item !== focusItem || !els.rich.contains(item)) return '  \n';
      const list = item.closest('ul, ol');
      if (!list?.matches?.(RICH_SOURCE_BLOCK_SELECTOR) || item.parentElement !== list) return '  \n';
      const blockStart = numericData(list, 'sourceStart');
      const blockEnd = numericData(list, 'sourceEnd');
      if (!Number.isFinite(blockStart) || !Number.isFinite(blockEnd)) return '  \n';
      const raw = stripRichCaretTokens(state.markdown || '').slice(blockStart, blockEnd);
      const sourceItems = flatListSourceItems(raw);
      const items = Array.from(list.children).filter((child) => child.tagName?.toLowerCase() === 'li');
      const sourceItem = sourceItems[items.indexOf(item)];
      return sourceItem?.parsed ? `  \n${sourceItem.parsed.indent}  ` : '  \n';
    }

    function handleRichTableCellLineBreakTransaction(cell, range) {
      if (!range?.collapsed || !cell?.matches?.('td, th')) return false;
      const point = richTableSourcePointFromRange(cell, range);
      if (!point) return false;
      const insert = '<br>';
      return applySourceTransaction({
        from: point.offset,
        to: point.offset,
        insert,
        selectionAfter: {
          anchor: point.offset + insert.length,
          focus: point.offset + insert.length,
          affinity: 'after',
        },
      }, 'rich-table-cell-line-break');
    }

    function handleRichQuoteEnterTransaction(blockquote, range) {
      if (!range?.collapsed || !blockquote?.matches?.('blockquote')) return false;
      const point = richQuoteSourcePointFromRange(blockquote, range);
      if (!point) return false;
      const insert = '\n> ';
      return applySourceTransaction({
        from: point.offset,
        to: point.offset,
        insert,
        selectionAfter: {
          anchor: point.offset + insert.length,
          focus: point.offset + insert.length,
          affinity: 'after',
        },
      }, 'rich-quote-enter');
    }

    function handleRichQuoteLineBreakTransaction(blockquote, range) {
      if (!range?.collapsed || !blockquote?.matches?.('blockquote')) return false;
      const point = richQuoteSourcePointFromRange(blockquote, range);
      if (!point) return false;
      const insert = '  \n> ';
      return applySourceTransaction({
        from: point.offset,
        to: point.offset,
        insert,
        selectionAfter: {
          anchor: point.offset + insert.length,
          focus: point.offset + insert.length,
          affinity: 'after',
        },
      }, 'rich-quote-line-break');
    }

    function insertRichLineBreakAtRange(range) {
      const selection = window.getSelection?.();
      if (!selection || !range || !els.rich.contains(range.startContainer) || !els.rich.contains(range.endContainer)) return false;
      if (guardUnsupportedRichLineBreakFallback(range)) return false;
      range.deleteContents();
      const br = document.createElement('br');
      range.insertNode(br);
      const marker = document.createTextNode('\u200b');
      br.after(marker);
      range.setStart(marker, marker.nodeValue.length);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      return true;
    }

    function guardUnsupportedRichLineBreakFallback(range) {
      if (!range || !els.rich.contains(range.startContainer)) return false;
      if (!richRangeTouchesSourceBlock(range)) return false;
      setStatus('この位置では改行できません');
      suppressRichInlineActivation();
      return true;
    }

    function placeCaretAtStart(element) {
      const range = document.createRange();
      range.selectNodeContents(element);
      range.collapse(true);
      const selection = window.getSelection?.();
      if (!selection) return;
      selection.removeAllRanges();
      selection.addRange(range);
      els.rich.focus();
    }

    function placeCaretAtEnd(element) {
      const range = document.createRange();
      range.selectNodeContents(element);
      range.collapse(false);
      const selection = window.getSelection?.();
      if (!selection) return;
      selection.removeAllRanges();
      selection.addRange(range);
      els.rich.focus();
    }

    return {
      activatePendingMathShortcutFromSelection,
      applyRichBlockMarkdownTriggerTransaction,
      applySourceTransaction,
      areInlineNodesVisiblyEmpty,
      canOpenSingleDelimiterAt,
      clearRichTransactionBlankForPointer,
      ensureListItemEditablePlaceholder,
      ensureRichTextBlockPlaceholder,
      expandSourceRangeToIntersectingInlineAtoms,
      findListItemTextPosition,
      flatListSourceItems,
      guardUnsupportedRichBlockMarkdownTriggerFallback,
      isEnterKey,
      listItemEditableContentNodes,
      onDocumentBeforeInput,
      onDocumentKeyUp,
      onEditorDragLeave,
      onEditorDragOver,
      onEditorDrop,
      onKeyboardShortcutKeyDown,
      onKeyDown,
      onMarkdownPaste,
      onRichCompositionEnd,
      onRichCut,
      onRichInput,
      onRichPaste,
      parseMarkdownQuoteSource,
      parseMarkdownTableSource,
      parsePendingRichInlineMarkdownBeforePointer,
      parsePendingRichInlineMarkdownInBlock,
      placeCaretAfterNode,
      placeCaretAtInlineBoundary,
      placeCaretAtStart,
      placeCaretInTextNode,
      replaceParagraphWithMathDisplayEditor,
      replaceParagraphWithMathInlineSource,
      richBlockMarkdownTriggerReplacement,
      richInlineElementTextOffsetForRange,
      richInlineSourceCaretOffset,
      richLineBreakCaretInputText,
      richListItemFromRange,
      richListSourcePointFromRange,
      richPlainTextTransactionRangeFromSelection,
      richQuoteHardBreakDomRepair,
      richQuoteSourcePointFromRange,
      richQuoteTextReplacementRangeFromSelection,
      richRangeTouchesSourceBlock,
      richSelectionRange,
      richSourceBlocksIntersectingRange,
      richTableSourcePointFromRange,
      richTableTextReplacementRangeFromSelection,
      sourceOffsetFromListItemTextOffset,
      splitTableRowWithSourceRanges,
      suppressRichInlineActivation,
      textOffsetFromListItemSourceOffset,
      unescapeMarkdownTableCell,
      visibleListItemText,
      visibleTextFromListSourceItem,
    };
  }

  window.PMERichInputController = Object.freeze({ createRichInputController });
})();

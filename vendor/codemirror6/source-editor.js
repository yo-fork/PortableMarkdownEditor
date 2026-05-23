import { EditorSelection, EditorState } from '@codemirror/state';
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands';
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language';
import { markdown, markdownKeymap } from '@codemirror/lang-markdown';

function normalizeNewlines(value) {
  return String(value || '').replace(/\r\n?/g, '\n');
}

function clampOffset(value, length) {
  const offset = Number(value);
  if (!Number.isFinite(offset)) return 0;
  return Math.max(0, Math.min(length, Math.trunc(offset)));
}

export function createPortableMarkdownSourceEditor(options) {
  const textarea = options?.textarea;
  if (!textarea) throw new Error('textarea is required');

  const host = document.createElement('div');
  host.className = 'source-codemirror';
  host.setAttribute('aria-label', textarea.getAttribute('aria-label') || 'Markdownソース');
  textarea.after(host);

  const dispatchPaste = (event) => options?.onPaste?.(event);
  const dispatchDragOver = (event) => options?.onDragOver?.(event);
  const dispatchDragLeave = (event) => options?.onDragLeave?.(event);
  const dispatchDrop = (event) => options?.onDrop?.(event);
  host.addEventListener('paste', dispatchPaste);
  host.addEventListener('dragover', dispatchDragOver);
  host.addEventListener('dragleave', dispatchDragLeave);
  host.addEventListener('drop', dispatchDrop);

  let suppressChange = false;
  const state = EditorState.create({
    doc: normalizeNewlines(textarea.value),
    extensions: [
      lineNumbers(),
      foldGutter(),
      history(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      bracketMatching(),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      markdown(),
      keymap.of([
        indentWithTab,
        ...markdownKeymap,
        ...foldKeymap,
        ...historyKeymap,
        ...defaultKeymap,
      ]),
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (update.selectionSet) options?.onSelectionChange?.();
        if (!update.docChanged) return;
        const value = update.state.doc.toString();
        if (textarea.value !== value) textarea.value = value;
        if (suppressChange) return;
        options?.onChange?.(value);
      }),
      EditorView.theme({
        '&': {
          height: '100%',
        },
        '.cm-scroller': {
          overflow: 'auto',
        },
      }),
    ],
  });

  const view = new EditorView({
    state,
    parent: host,
  });

  const dispatchScroll = () => options?.onScroll?.();
  view.scrollDOM.addEventListener('scroll', dispatchScroll);

  const api = {
    element: host,
    view,
    value() {
      return view.state.doc.toString();
    },
    setValue(nextValue, options = {}) {
      const value = normalizeNewlines(nextValue);
      const current = view.state.doc.toString();
      if (current === value) {
        if (textarea.value !== value) textarea.value = value;
        return;
      }
      suppressChange = Boolean(options.silent);
      try {
        view.dispatch({
          changes: { from: 0, to: current.length, insert: value },
          selection: EditorSelection.cursor(Math.min(value.length, view.state.selection.main.head)),
        });
      } finally {
        suppressChange = false;
      }
      if (textarea.value !== value) textarea.value = value;
    },
    selection() {
      const range = view.state.selection.main;
      return {
        start: Math.min(range.from, range.to),
        end: Math.max(range.from, range.to),
        anchor: range.anchor,
        head: range.head,
      };
    },
    setSelection(start, end = start, options = {}) {
      const length = view.state.doc.length;
      const from = clampOffset(start, length);
      const to = clampOffset(end, length);
      view.dispatch({
        selection: EditorSelection.range(from, to),
        scrollIntoView: options.scrollIntoView !== false,
      });
      if (options.focus !== false) view.focus();
    },
    replaceRange(from, to, replacement, options = {}) {
      const length = view.state.doc.length;
      const start = clampOffset(from, length);
      const end = Math.max(start, clampOffset(to, length));
      const insert = normalizeNewlines(replacement);
      const selectionStart = Number.isInteger(options.selectionStart) ? options.selectionStart : start + insert.length;
      const selectionEnd = Number.isInteger(options.selectionEnd) ? options.selectionEnd : selectionStart;
      view.dispatch({
        changes: { from: start, to: end, insert },
        selection: EditorSelection.range(
          clampOffset(selectionStart, length - (end - start) + insert.length),
          clampOffset(selectionEnd, length - (end - start) + insert.length)
        ),
        scrollIntoView: options.scrollIntoView !== false,
      });
      if (options.focus !== false) view.focus();
    },
    focus() {
      view.focus();
    },
    hasFocus() {
      return view.hasFocus;
    },
    scrollElement() {
      return view.scrollDOM;
    },
    refresh() {
      view.requestMeasure();
    },
    destroy() {
      view.scrollDOM.removeEventListener('scroll', dispatchScroll);
      host.removeEventListener('paste', dispatchPaste);
      host.removeEventListener('dragover', dispatchDragOver);
      host.removeEventListener('dragleave', dispatchDragLeave);
      host.removeEventListener('drop', dispatchDrop);
      view.destroy();
      host.remove();
    },
  };

  return api;
}

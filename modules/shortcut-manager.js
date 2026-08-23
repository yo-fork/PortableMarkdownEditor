(() => {
  'use strict';

  const SHORTCUT_DEFINITIONS = Object.freeze([
    definition('new-window', '新規ウィンドウ', 'ファイル', 'Ctrl+N', '[data-action="new"]', true),
    definition('open', '開く', 'ファイル', 'Ctrl+O', '[data-action="open"]'),
    definition('open-new-window', '新しいウィンドウで開く', 'ファイル', 'Ctrl+Shift+O', '', true),
    definition('save', '保存', 'ファイル', 'Ctrl+S', '[data-action="save-md"]'),
    definition('save-as', '名前を付けて保存', 'ファイル', 'Ctrl+Shift+S', '', true),
    definition('print', '印刷', 'ファイル', 'Ctrl+P', '[data-action="print"]'),
    definition('paragraph', '段落', '書式', 'Ctrl+0'),
    definition('h1', '見出し1', '書式', 'Ctrl+1', '[data-action="format"][data-format="h1"]'),
    definition('h2', '見出し2', '書式', 'Ctrl+2', '[data-action="format"][data-format="h2"]'),
    definition('h3', '見出し3', '書式', 'Ctrl+3'),
    definition('h4', '見出し4', '書式', 'Ctrl+4'),
    definition('h5', '見出し5', '書式', 'Ctrl+5'),
    definition('h6', '見出し6', '書式', 'Ctrl+6'),
    definition('bold', '太字', '書式', 'Ctrl+B', '[data-action="format"][data-format="bold"]'),
    definition('italic', '斜体', '書式', 'Ctrl+I', '[data-action="format"][data-format="italic"]'),
    definition('inline-code', 'インラインコード', '書式', 'Ctrl+K', '[data-action="format"][data-format="code"]'),
    definition('inline-math', 'インライン数式', '書式', 'Ctrl+M', '[data-action="format"][data-format="math"]'),
    definition('ordered-list', '番号リスト', '書式', 'Ctrl+Shift+7', '[data-action="format"][data-format="ordered-list"]'),
    definition('list', '箇条書き', '書式', 'Ctrl+Shift+8', '[data-action="format"][data-format="list"]'),
    definition('checklist', 'チェックリスト', '書式', 'Ctrl+Alt+C', '[data-action="format"][data-format="checklist"]'),
    definition('quote', '引用', '書式', 'Ctrl+Shift+9', '[data-action="format"][data-format="quote"]'),
    definition('code-block', 'コードブロック', '挿入', 'Ctrl+Shift+K', '[data-action="insert-code-block"]'),
    definition('math-block', '数式ブロック', '挿入', 'Ctrl+Shift+M', '[data-action="insert-math-block"]'),
    definition('link', 'リンク', '挿入', 'Ctrl+Shift+L', '[data-action="insert-link"]'),
    definition('table', '表', '挿入', 'Ctrl+Alt+T', '[data-action="format"][data-format="table"]'),
    definition('toc', '目次', '挿入', 'Ctrl+Alt+I', '[data-action="format"][data-format="toc"]'),
    definition('mermaid', 'Mermaid図', '挿入', 'Ctrl+Alt+M', '[data-action="insert-mermaid"]'),
    definition('toggle-outline', 'アウトライン表示切り替え', '表示', 'Ctrl+Alt+O', '.top-actions [data-action="collapse-outline"]'),
  ]);

  const DEFINITION_BY_ID = new Map(SHORTCUT_DEFINITIONS.map((item) => [item.id, item]));

  function definition(id, label, group, defaultShortcut, selector = '', windowsOnly = false) {
    return Object.freeze({ id, label, group, defaultShortcut, selector, windowsOnly });
  }

  function defaultShortcutAssignments() {
    return Object.fromEntries(SHORTCUT_DEFINITIONS.map((item) => [item.id, item.defaultShortcut]));
  }

  function canonicalShortcut(value) {
    const tokens = String(value || '').split('+').map((token) => token.trim()).filter(Boolean);
    if (tokens.length < 2 || tokens.length > 4) return '';
    let control = false;
    let shift = false;
    let alt = false;
    let key = '';
    for (const token of tokens) {
      const lower = token.toLowerCase();
      if (['ctrl', 'control', 'cmd', 'command', 'meta'].includes(lower)) {
        if (control) return '';
        control = true;
      } else if (lower === 'shift') {
        if (shift) return '';
        shift = true;
      } else if (lower === 'alt') {
        if (alt) return '';
        alt = true;
      } else {
        if (key) return '';
        key = canonicalShortcutKey(token);
        if (!key) return '';
      }
    }
    if (!control || !key) return '';
    return ['Ctrl', shift ? 'Shift' : '', alt ? 'Alt' : '', key].filter(Boolean).join('+');
  }

  function canonicalShortcutKey(value) {
    const key = String(value || '').trim().toUpperCase();
    if (/^[A-Z0-9]$/.test(key)) return key;
    const functionKey = /^F(\d{1,2})$/.exec(key);
    if (!functionKey) return '';
    const number = Number(functionKey[1]);
    return number >= 1 && number <= 12 ? `F${number}` : '';
  }

  function normalizeShortcutAssignments(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const normalized = {};
    const used = new Set();
    for (const item of SHORTCUT_DEFINITIONS) {
      const hasValue = Object.prototype.hasOwnProperty.call(source, item.id);
      const raw = hasValue ? source[item.id] : item.defaultShortcut;
      let shortcut = raw === '' ? '' : canonicalShortcut(raw);
      if (!shortcut) shortcut = raw === '' ? '' : item.defaultShortcut;
      if (shortcut && used.has(shortcut.toLowerCase())) shortcut = '';
      normalized[item.id] = shortcut;
      if (shortcut) used.add(shortcut.toLowerCase());
    }
    return normalized;
  }

  function shortcutFromKeyboardEvent(event) {
    if (!event || (!event.ctrlKey && !event.metaKey)) return '';
    const key = shortcutKeyFromKeyboardEvent(event);
    if (!key) return '';
    return ['Ctrl', event.shiftKey ? 'Shift' : '', event.altKey ? 'Alt' : '', key]
      .filter(Boolean)
      .join('+');
  }

  function shortcutActionForAssignments(event, assignments) {
    const shortcut = shortcutFromKeyboardEvent(event);
    if (!shortcut) return '';
    const lower = shortcut.toLowerCase();
    return SHORTCUT_DEFINITIONS.find((item) => String(assignments?.[item.id] || '').toLowerCase() === lower)?.id || '';
  }

  function shortcutKeyFromKeyboardEvent(event) {
    const code = String(event.code || '');
    const letter = /^Key([A-Z])$/.exec(code);
    if (letter) return letter[1];
    const digit = /^Digit([0-9])$/.exec(code);
    if (digit) return digit[1];
    const functionKey = /^F(\d{1,2})$/.exec(code);
    if (functionKey) return canonicalShortcutKey(functionKey[0]);
    return canonicalShortcutKey(event.key);
  }

  function ariaShortcut(value) {
    return String(value || '').replace(/^Ctrl(?=\+|$)/, 'Control');
  }

  function createShortcutManager(options = {}) {
    const state = options.state;
    const els = options.els;
    const dependencies = options.dependencies || {};
    if (!state || !els) throw new Error('Shortcut manager requires state and element references');
    const {
      notifyDesktopShortcutCaptureState,
      notifyDesktopShortcuts,
      persistSettings,
      setStatus,
    } = dependencies;
    let pendingAssignments = null;

    function initializeShortcutUi() {
      state.shortcuts = normalizeShortcutAssignments(state.shortcuts);
      renderShortcutRows(state.shortcuts);
      updateShortcutHints();
      els.shortcutDialog?.addEventListener('close', () => {
        pendingAssignments = null;
        notifyDesktopShortcutCaptureState?.(false);
      });
    }

    function shortcutActionForEvent(event) {
      return shortcutActionForAssignments(event, state.shortcuts);
    }

    function showShortcutDialog() {
      if (!els.shortcutDialog || !els.shortcutList) return;
      if (els.shortcutDialog.open) return;
      pendingAssignments = { ...normalizeShortcutAssignments(state.shortcuts) };
      renderShortcutRows(pendingAssignments);
      setShortcutDialogMessage('', false);
      notifyDesktopShortcutCaptureState?.(true);
      if (typeof els.shortcutDialog.showModal === 'function') els.shortcutDialog.showModal();
      else els.shortcutDialog.setAttribute('open', '');
      els.shortcutList.querySelector('.shortcut-capture')?.focus();
    }

    function captureShortcutAssignment(event) {
      const target = event?.target?.closest?.('[data-shortcut-command]');
      if (!els.shortcutDialog?.open || !pendingAssignments) return false;
      if (!target) {
        if (!shortcutFromKeyboardEvent(event)) return false;
        event.preventDefault();
        event.stopPropagation();
        return true;
      }
      if (event.key === 'Tab') return false;
      if (event.key === 'Escape') return false;
      if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey
          && (event.key === 'Backspace' || event.key === 'Delete')) {
        event.preventDefault();
        pendingAssignments[target.dataset.shortcutCommand] = '';
        target.textContent = '未割り当て';
        target.classList.add('is-unassigned');
        setShortcutDialogMessage(`${DEFINITION_BY_ID.get(target.dataset.shortcutCommand)?.label || '操作'}の割り当てを解除しました。`, false);
        return true;
      }
      const shortcut = shortcutFromKeyboardEvent(event);
      if (!shortcut) {
        if (/^(?:Control|Shift|Alt|Meta)/.test(String(event.key || ''))) return false;
        event.preventDefault();
        setShortcutDialogMessage('Ctrlと、英字、数字、F1からF12までのいずれかを組み合わせてください。', true);
        return true;
      }
      event.preventDefault();
      event.stopPropagation();
      const command = target.dataset.shortcutCommand;
      const conflict = SHORTCUT_DEFINITIONS.find((item) => item.id !== command
        && String(pendingAssignments[item.id] || '').toLowerCase() === shortcut.toLowerCase());
      if (conflict) {
        setShortcutDialogMessage(`${shortcut} は「${conflict.label}」に割り当てられています。`, true);
        return true;
      }
      pendingAssignments[command] = shortcut;
      target.textContent = shortcut;
      target.classList.remove('is-unassigned');
      setShortcutDialogMessage(`${DEFINITION_BY_ID.get(command)?.label || '操作'}を ${shortcut} に変更しました。`, false);
      return true;
    }

    function clearShortcutAssignment(command) {
      if (!pendingAssignments || !DEFINITION_BY_ID.has(command)) return;
      pendingAssignments[command] = '';
      renderShortcutRows(pendingAssignments);
      setShortcutDialogMessage(`${DEFINITION_BY_ID.get(command).label}の割り当てを解除しました。`, false);
    }

    function restoreDefaultShortcutAssignments() {
      if (!pendingAssignments) return;
      pendingAssignments = defaultShortcutAssignments();
      renderShortcutRows(pendingAssignments);
      setShortcutDialogMessage('既定の割り当てへ戻しました。「適用」を押すまで保存されません。', false);
    }

    function saveShortcutAssignments() {
      if (!pendingAssignments) return;
      applyShortcutAssignments(pendingAssignments, { persist: true, notify: true });
      if (els.shortcutDialog?.open && typeof els.shortcutDialog.close === 'function') els.shortcutDialog.close('saved');
      pendingAssignments = null;
      setStatus?.('キーボードショートカットを保存しました');
    }

    function resetShortcutAssignments(options = {}) {
      applyShortcutAssignments(defaultShortcutAssignments(), {
        persist: options.persist === true,
        notify: options.notify !== false,
      });
    }

    function applyShortcutAssignments(value, options = {}) {
      state.shortcuts = normalizeShortcutAssignments(value);
      updateShortcutHints();
      if (options.persist !== false) persistSettings?.();
      if (options.notify !== false) notifyDesktopShortcuts?.(state.shortcuts);
      return { ...state.shortcuts };
    }

    function shortcutAssignmentsForExport() {
      return { ...normalizeShortcutAssignments(state.shortcuts) };
    }

    function updateShortcutHints() {
      for (const item of SHORTCUT_DEFINITIONS) {
        if (!item.selector) continue;
        document.querySelectorAll(item.selector).forEach((element) => {
          let label = item.label;
          if (item.id === 'new-window' && !state.desktopHost) label = '新規作成';
          updateElementShortcutHint(element, item.id, label);
        });
      }
    }

    function updateElementShortcutHint(element, command, label) {
      if (!element) return;
      const shortcut = state.shortcuts?.[command] || '';
      element.title = shortcut ? `${label} (${shortcut})` : label;
      if (shortcut) element.setAttribute('aria-keyshortcuts', ariaShortcut(shortcut));
      else element.removeAttribute('aria-keyshortcuts');
    }

    function renderShortcutRows(assignments) {
      if (!els.shortcutList) return;
      const fragment = document.createDocumentFragment();
      let currentGroup = '';
      for (const item of SHORTCUT_DEFINITIONS) {
        if (item.group !== currentGroup) {
          currentGroup = item.group;
          const heading = document.createElement('h3');
          heading.textContent = currentGroup;
          fragment.appendChild(heading);
        }
        const row = document.createElement('div');
        row.className = 'shortcut-row';
        const label = document.createElement('span');
        label.className = 'shortcut-label';
        label.textContent = item.label;
        if (item.windowsOnly) {
          const platform = document.createElement('small');
          platform.textContent = 'Windows';
          label.appendChild(platform);
        }
        const capture = document.createElement('button');
        capture.type = 'button';
        capture.className = 'shortcut-capture';
        capture.dataset.shortcutCommand = item.id;
        capture.setAttribute('aria-label', `${item.label}のショートカット`);
        const value = assignments?.[item.id] || '';
        capture.textContent = value || '未割り当て';
        capture.classList.toggle('is-unassigned', !value);
        const clear = document.createElement('button');
        clear.type = 'button';
        clear.className = 'shortcut-clear';
        clear.dataset.action = 'clear-shortcut';
        clear.dataset.shortcutCommand = item.id;
        clear.textContent = '解除';
        clear.setAttribute('aria-label', `${item.label}の割り当てを解除`);
        row.append(label, capture, clear);
        fragment.appendChild(row);
      }
      els.shortcutList.replaceChildren(fragment);
    }

    function setShortcutDialogMessage(message, error) {
      if (!els.shortcutMessage) return;
      els.shortcutMessage.textContent = message;
      els.shortcutMessage.classList.toggle('is-error', Boolean(error));
    }

    return Object.freeze({
      applyShortcutAssignments,
      captureShortcutAssignment,
      clearShortcutAssignment,
      initializeShortcutUi,
      resetShortcutAssignments,
      restoreDefaultShortcutAssignments,
      saveShortcutAssignments,
      shortcutActionForEvent,
      shortcutAssignmentsForExport,
      showShortcutDialog,
      updateElementShortcutHint,
      updateShortcutHints,
    });
  }

  window.PMEShortcutManager = Object.freeze({
    SHORTCUT_DEFINITIONS,
    ariaShortcut,
    canonicalShortcut,
    createShortcutManager,
    defaultShortcutAssignments,
    normalizeShortcutAssignments,
    shortcutActionForAssignments,
    shortcutFromKeyboardEvent,
  });
})();

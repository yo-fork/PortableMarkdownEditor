import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../modules/shortcut-manager.js', import.meta.url), 'utf8');
const sandbox = { window: {} };
vm.runInNewContext(source, sandbox, { filename: 'shortcut-manager.js' });
const api = sandbox.window.PMEShortcutManager;

assert.ok(api, 'shortcut manager API must be exposed');
const defaults = api.defaultShortcutAssignments();
assert.equal(defaults['new-window'], 'Ctrl+N');
assert.equal(defaults['inline-code'], 'Ctrl+K');
assert.equal(defaults['inline-math'], 'Ctrl+M');
assert.equal(defaults['code-block'], 'Ctrl+Shift+K');
assert.equal(defaults['math-block'], 'Ctrl+Shift+M');
assert.equal(defaults.link, 'Ctrl+Shift+L');
assert.equal(defaults['toggle-outline'], 'Ctrl+Alt+O');

const settingsSample = JSON.parse(readFileSync(new URL('../portable-markdown-editor-settings.json', import.meta.url), 'utf8'));
assert.equal(settingsSample.version, 3, 'the settings sample must use the current format version');
assert.equal(settingsSample.documentFont, 'sans', 'the settings sample must include the document font');
assert.deepEqual(Object.keys(settingsSample.shortcuts).sort(), Object.keys(defaults).sort(), 'the settings sample must list every configurable shortcut');
for (const [command, shortcut] of Object.entries(defaults)) {
  assert.equal(settingsSample.shortcuts[command], shortcut, `the settings sample shortcut must match the default: ${command}`);
}

assert.equal(api.canonicalShortcut('control+shift+k'), 'Ctrl+Shift+K');
assert.equal(api.canonicalShortcut('Ctrl+Alt+F12'), 'Ctrl+Alt+F12');
assert.equal(api.canonicalShortcut('Shift+K'), '', 'shortcuts without Ctrl must be rejected');
assert.equal(api.canonicalShortcut('Ctrl+Escape'), '', 'unsupported base keys must be rejected');

assert.equal(api.shortcutFromKeyboardEvent({ ctrlKey: true, shiftKey: true, altKey: false, code: 'KeyQ', key: 'q' }), 'Ctrl+Shift+Q');
assert.equal(api.shortcutFromKeyboardEvent({ metaKey: true, shiftKey: false, altKey: true, code: 'Digit8', key: '8' }), 'Ctrl+Alt+8');
assert.equal(api.shortcutFromKeyboardEvent({ ctrlKey: false, shiftKey: false, altKey: false, code: 'KeyQ', key: 'q' }), '');

const customized = api.normalizeShortcutAssignments({
  'inline-code': 'Ctrl+Alt+C',
  'inline-math': '',
});
assert.equal(customized['inline-code'], 'Ctrl+Alt+C');
assert.equal(customized['inline-math'], '');
assert.equal(customized.bold, 'Ctrl+B', 'unspecified commands must keep defaults');
assert.equal(api.shortcutActionForAssignments(
  { ctrlKey: true, shiftKey: false, altKey: true, code: 'KeyC', key: 'c' },
  customized,
), 'inline-code');
assert.equal(api.shortcutActionForAssignments(
  { ctrlKey: true, shiftKey: false, altKey: false, code: 'KeyK', key: 'k' },
  customized,
), '', 'previous assignment must stop dispatching after customization');

const duplicated = api.normalizeShortcutAssignments({
  'new-window': 'Ctrl+Q',
  open: 'Ctrl+Q',
});
assert.equal(duplicated['new-window'], 'Ctrl+Q');
assert.equal(duplicated.open, '', 'duplicate imported assignments must fail closed');

assert.equal(api.ariaShortcut('Ctrl+Shift+K'), 'Control+Shift+K');
console.log('shortcut manager checks passed');

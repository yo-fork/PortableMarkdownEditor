import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const controllerSource = readFileSync(new URL('../modules/rich-input-controller.js', import.meta.url), 'utf8');
const fileManagerSource = readFileSync(new URL('../modules/file-manager.js', import.meta.url), 'utf8');
const effects = { images: [], text: [], reads: [], inputs: [], removed: [] };
const members = new Set();
const rich = {
  contains: (target) => members.has(target),
  classList: { remove: (name) => effects.removed.push(name) },
};
const body = { closest: () => null };
members.add(body);
const state = {
  mode: 'rich', richComposing: false, active: true,
  proseMirrorRich: { insertDroppedText: (text, point) => effects.text.push({ text, point: { ...point } }) },
};
const window = {};
const sandbox = { window, Event };
vm.runInNewContext(readFileSync(new URL('../modules/image-policy.js', import.meta.url), 'utf8'), sandbox);
vm.runInNewContext(fileManagerSource, sandbox, { filename: 'file-manager.js' });
vm.runInNewContext(controllerSource, sandbox, { filename: 'rich-input-controller.js' });
const fileManager = window.PMEFileManager.createFileManager({
  state: {}, els: {},
  constants: { ALLOWED_IMAGE_TYPES: new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']) },
  dependencies: {
    normalizeAssetPath: (value) => String(value || ''),
    hasRasterImageExtension: (value) => /\.(?:png|jpe?g|gif|webp)$/i.test(value),
  },
});
let imageCompletion = null;
const controller = window.PMERichInputController.createRichInputController({
  state, els: { rich },
  dependencies: {
    eventTargetElement: (event) => event.target,
    isProseMirrorRichTarget: () => state.active,
    isProseMirrorRichActive: () => state.active,
    guardReadOnlyRichFallbackAction: () => !state.active,
    imageFilesFromDataTransfer: fileManager.imageFilesFromDataTransfer,
    createImageInsertionContext: () => ({ mode: 'prosemirror' }),
    insertImageFilesAsAssets: async (files, context, label) => {
      effects.images.push({ files: [...files], context: { ...context }, label });
      if (imageCompletion) await imageCompletion;
    },
    normalizeNewlines: (value) => value.replace(/\r\n?/g, '\n'),
    stripRichCaretTokens: (value) => value.replace(/@PME_CARET_[^@]*@/g, ''),
    richInlineSourceFromEventContext: () => null,
  },
});

function eventFor({ plain = '', html = '', files = [], target = body, inputType } = {}) {
  return {
    target, currentTarget: rich, clientX: 10, clientY: 20, inputType,
    defaultPrevented: false, stopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.stopped = true; },
    dataTransfer: {
      files,
      getData(type) {
        effects.reads.push(type);
        return type === 'text/plain' ? plain : html;
      },
    },
  };
}

for (const payload of [
  { html: '<strong>HTML only</strong>' },
  { html: '<iframe srcdoc="untrusted"></iframe>' },
  { files: [{ name: 'vector.svg', type: 'image/svg+xml' }], html: '<svg></svg>' },
  { files: [{ name: 'page.html', type: 'text/html' }] },
  {},
]) {
  const event = eventFor(payload);
  await controller.onRichDrop(event);
  assert.equal(event.defaultPrevented, true, 'every rich drop must cancel native insertion');
  assert.equal(event.stopped, true, 'the capture handler must stop downstream HTML parsers');
}
assert.deepEqual(effects.images, []);
assert.deepEqual(effects.text, []);
assert.ok(effects.reads.every((type) => type === 'text/plain'), 'rich drops must not read HTML or URI-list payloads');

const textDrop = eventFor({ plain: '<b>literal</b>\r\n**literal**', html: '<img src="unapproved">' });
await controller.onRichDrop(textDrop);
assert.deepEqual(effects.text, [{ text: '<b>literal</b>\n**literal**', point: { left: 10, top: 20 } }]);

for (const type of ['image/png', 'image/jpeg', 'image/gif', 'image/webp']) {
  const file = { name: 'safe-image', type };
  const event = eventFor({ files: [file, { name: 'bad.svg', type: 'image/svg+xml' }], plain: 'not inserted' });
  let finish;
  imageCompletion = new Promise((resolve) => { finish = resolve; });
  const operation = controller.onRichDrop(event);
  assert.equal(event.defaultPrevented, true, 'cancel before awaiting image storage');
  assert.equal(event.stopped, true);
  assert.deepEqual(effects.images.at(-1), { files: [file], context: { mode: 'prosemirror' }, label: 'ドロップ' });
  finish();
  await operation;
}
imageCompletion = null;
assert.equal(effects.text.length, 1, 'image drops must not also insert the text flavor');

const control = {
  value: 'abc', selectionStart: 1, selectionEnd: 2, disabled: false, readOnly: false,
  closest() { return this; }, focus() {},
  setRangeText(text, from, to) { this.value = this.value.slice(0, from) + text + this.value.slice(to); },
  dispatchEvent(event) { effects.inputs.push({ type: event.type, bubbles: event.bubbles }); },
};
members.add(control);
await controller.onRichDrop(eventFor({ plain: '<i>x</i>', html: '<i>formatted</i>', target: control }));
assert.equal(control.value, 'a<i>x</i>c', 'source controls must receive literal text in their value');
assert.deepEqual(effects.inputs, [{ type: 'input', bubbles: true }], 'source controls must use their normal input synchronization');
control.readOnly = true;
await controller.onRichDrop(eventFor({ plain: 'ignored', target: control }));
assert.equal(control.value, 'a<i>x</i>c');

state.active = false;
const imageCount = effects.images.length;
const readOnly = eventFor({ plain: 'ignored', files: [{ name: 'image.png', type: 'image/png' }] });
await controller.onRichDrop(readOnly);
assert.equal(readOnly.defaultPrevented, true);
assert.equal(effects.images.length, imageCount, 'read-only fallback must not write image assets');
assert.equal(effects.text.length, 1, 'read-only fallback must not insert text');

for (const active of [true, false]) {
  for (const composing of [true, false]) {
    state.active = active;
    state.richComposing = composing;
    for (const target of [body, control]) {
      const event = eventFor({ inputType: 'insertFromDrop', target, plain: 'must not insert twice' });
      controller.onDocumentBeforeInput(event);
      assert.equal(event.defaultPrevented, true, 'beforeinput drop guard must precede every editor exemption');
      assert.equal(event.stopped, true);
    }
  }
}
assert.equal(effects.text.length, 1);

state.mode = 'source';
state.richComposing = false;
const outside = eventFor({ target: { closest: () => null }, inputType: 'insertFromDrop', plain: 'source text' });
controller.onDocumentBeforeInput(outside);
assert.equal(outside.defaultPrevented, false, 'plain source editing must retain its own input behavior');
const sourceDrop = eventFor({ plain: 'source text' });
await controller.onEditorDrop(sourceDrop);
assert.equal(sourceDrop.defaultPrevented, false, 'source drop handling must remain independent of the rich capture policy');

console.log('rich drop policy checks passed (plain text, empty/HTML/file payloads, images, controls, beforeinput, read-only/source)');

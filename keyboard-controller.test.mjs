import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkspaceStore } from './public/app/workspace-store.js';
import { createKeyboardController } from './public/app/interactions/keyboard-controller.js';

function fakeNode() {
  return { hidden: true };
}

function createHarness({ binMode = false } = {}) {
  const listeners = [];
  const documentMock = {
    addEventListener(type, handler, options) {
      const entry = { type, handler, options };
      listeners.push(entry);
      if (options?.signal) {
        options.signal.addEventListener('abort', () => {
          const index = listeners.indexOf(entry);
          if (index >= 0) listeners.splice(index, 1);
        });
      }
    },
  };
  const elements = { editorLayer: fakeNode(), confirmLayer: fakeNode(), linkEditLayer: fakeNode() };
  const store = createWorkspaceStore({
    getState: () => ({}),
    setState: () => {},
    persist: async () => {},
    normalizeState: (s) => s,
    setStatus: () => {},
    initialSession: { binMode },
  });
  const called = { close: 0, permanentDelete: 0 };
  const commandSpies = {};
  for (const name of [
    'clearSelection', 'selectAllVisible', 'copySelection', 'cutSelection',
    'pasteInto', 'undo', 'redo', 'moveSelectionToBin', 'revealSelection',
    'activateItem', 'activateSelection', 'selectedPasteDestinations',
  ]) {
    commandSpies[`${name}:calls`] = 0;
    commandSpies[name] = (...args) => { commandSpies[`${name}:calls`] += 1; };
  }
  const controller = createKeyboardController({
    document: documentMock,
    elements,
    store,
    commands: commandSpies,
    closeMenu: () => { called.close += 1; },
    getVisibleItemIds: () => ['a', 'b', 'c'],
    confirmDialog: { askPermanentDelete: () => { called.permanentDelete += 1; } },
  });
  controller.mount();
  return { controller, store, commandSpies, called, listeners };
}

function key(event) {
  return { key: event.key ?? '', ctrlKey: event.ctrlKey ?? false, shiftKey: event.shiftKey ?? false, preventDefault() {} };
}

test('Escape clears the selection and closes the menu', () => {
  const h = createHarness();
  h.store.setSelection(['a']);
  h.listeners[0].handler(key({ key: 'Escape' }));
  assert.equal(h.commandSpies['clearSelection:calls'], 1);
  assert.equal(h.called.close, 1);
});

test('Ctrl+A selects all visible items', () => {
  const h = createHarness();
  h.listeners[0].handler(key({ key: 'a', ctrlKey: true }));
  assert.equal(h.commandSpies['selectAllVisible:calls'], 1);
});

test('Ctrl+C, Ctrl+X, Ctrl+V route to copy/cut/paste commands', () => {
  const h = createHarness();
  h.listeners[0].handler(key({ key: 'c', ctrlKey: true }));
  h.listeners[0].handler(key({ key: 'x', ctrlKey: true }));
  h.listeners[0].handler(key({ key: 'v', ctrlKey: true }));
  assert.equal(h.commandSpies['copySelection:calls'], 1);
  assert.equal(h.commandSpies['cutSelection:calls'], 1);
  assert.equal(h.commandSpies['pasteInto:calls'], 1);
});

test('Ctrl+Z and Ctrl+Y route to undo/redo', () => {
  const h = createHarness();
  h.listeners[0].handler(key({ key: 'z', ctrlKey: true }));
  h.listeners[0].handler(key({ key: 'y', ctrlKey: true }));
  assert.equal(h.commandSpies['undo:calls'], 1);
  assert.equal(h.commandSpies['redo:calls'], 1);
});

test('Delete moves to Bin outside Bin mode and asks permanent delete inside', () => {
  const explorer = createHarness({ binMode: false });
  explorer.store.setSelection(['a']);
  explorer.listeners[0].handler(key({ key: 'Delete' }));
  assert.equal(explorer.commandSpies['moveSelectionToBin:calls'], 1);

  const bin = createHarness({ binMode: true });
  bin.store.setSelection(['a']);
  bin.listeners[0].handler(key({ key: 'Delete' }));
  assert.equal(bin.called.permanentDelete, 1);
});

test('Enter activates a single selection or launches multiple', () => {
  const h = createHarness();
  h.store.setSelection(['a']);
  h.listeners[0].handler(key({ key: 'Enter' }));
  assert.equal(h.commandSpies['activateItem:calls'], 1);
  h.store.setSelection(['a', 'b']);
  h.listeners[0].handler(key({ key: 'Enter' }));
  assert.equal(h.commandSpies['activateSelection:calls'], 1);
});

test('Ctrl+Enter reveals the selection', () => {
  const h = createHarness();
  h.store.setSelection(['a']);
  h.listeners[0].handler(key({ key: 'Enter', ctrlKey: true }));
  assert.equal(h.commandSpies['revealSelection:calls'], 1);
});

test('Bin mode suppresses copy/cut/paste and destroys the listener', () => {
  const h = createHarness({ binMode: true });
  h.listeners[0].handler(key({ key: 'c', ctrlKey: true }));
  assert.equal(h.commandSpies['copySelection:calls'], 0);
  assert.ok(h.listeners.length > 0);
  h.controller.destroy();
  assert.equal(h.listeners.length, 0);
});

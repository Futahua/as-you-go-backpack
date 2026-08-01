import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkspaceStore } from './public/app/workspace-store.js';
import { createKeyboardController } from './public/app/interactions/keyboard-controller.js';

function fakeNode() {
  return { hidden: true };
}

function createHarness({ binMode = false, initialState = null, membershipActive = false } = {}) {
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
  const elements = { editorLayer: fakeNode(), confirmLayer: fakeNode(), linkEditLayer: fakeNode(), promptLayer: fakeNode() };
  const store = createWorkspaceStore({
    getState: () => initialState ?? {},
    setState: () => {},
    persist: async () => {},
    normalizeState: (s) => s,
    setStatus: () => {},
    initialSession: { binMode },
  });
  const called = { close: 0, permanentDelete: 0, membershipEdit: 0, membershipCancel: 0, membershipConfirm: 0 };
  const commandSpies = {};
  for (const name of [
    'clearSelection', 'selectAllVisible', 'copySelection', 'cutSelection',
    'pasteInto', 'undo', 'redo', 'moveSelectionToBin', 'revealSelection',
    'activateItem', 'activateSelection', 'selectedPasteDestinations',
    'groupSelectionIntoSet',
  ]) {
    commandSpies[`${name}:calls`] = 0;
    commandSpies[`${name}:args`] = [];
    commandSpies[name] = (...args) => {
      commandSpies[`${name}:calls`] += 1;
      commandSpies[`${name}:args`].push(args);
    };
  }
  commandSpies.selectedPasteDestinations = () => ['dest'];
  const controller = createKeyboardController({
    document: documentMock,
    elements,
    store,
    commands: commandSpies,
    closeMenu: () => { called.close += 1; },
    getVisibleItemIds: () => ['a', 'b', 'c'],
    confirmDialog: { askPermanentDelete: () => { called.permanentDelete += 1; } },
    beginSetMembershipEdit: () => { called.membershipEdit += 1; },
    setMembershipMode: {
      isActive: () => membershipActive,
      cancel: () => { called.membershipCancel += 1; },
      confirm: async () => { called.membershipConfirm += 1; },
    },
  });
  controller.mount();
  return { controller, store, elements, commandSpies, called, listeners };
}

function key(event) {
  return {
    key: event.key ?? '',
    ctrlKey: event.ctrlKey ?? false,
    shiftKey: event.shiftKey ?? false,
    metaKey: event.metaKey ?? false,
    target: event.target ?? null,
    preventDefault() {},
  };
}

/** A fake text field, for checking that bare-letter shortcuts do not fire
 * while typing. */
const typingTarget = () => ({ closest: (selector) => (selector.includes('input') ? {} : null) });

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

test('a visible dialog layer suppresses all workspace shortcuts', () => {
  const h = createHarness();
  h.elements.editorLayer.hidden = false;
  h.store.setSelection(['a']);
  h.listeners[0].handler(key({ key: 'Delete' }));
  h.listeners[0].handler(key({ key: 'c', ctrlKey: true }));
  h.listeners[0].handler(key({ key: 'Escape' }));
  assert.equal(h.commandSpies['moveSelectionToBin:calls'], 0);
  assert.equal(h.commandSpies['copySelection:calls'], 0);
  assert.equal(h.commandSpies['clearSelection:calls'], 0);
});

test('the visible prompt library suppresses all workspace shortcuts', () => {
  const h = createHarness();
  h.elements.promptLayer.hidden = false;
  h.store.setSelection(['a']);
  h.listeners[0].handler(key({ key: 'a', ctrlKey: true }));
  h.listeners[0].handler(key({ key: 'c', ctrlKey: true }));
  h.listeners[0].handler(key({ key: 'x', ctrlKey: true }));
  h.listeners[0].handler(key({ key: 'v', ctrlKey: true }));
  h.listeners[0].handler(key({ key: 'Delete' }));
  h.listeners[0].handler(key({ key: 'Enter' }));
  assert.equal(h.commandSpies['selectAllVisible:calls'], 0);
  assert.equal(h.commandSpies['copySelection:calls'], 0);
  assert.equal(h.commandSpies['cutSelection:calls'], 0);
  assert.equal(h.commandSpies['pasteInto:calls'], 0);
  assert.equal(h.commandSpies['moveSelectionToBin:calls'], 0);
  assert.equal(h.commandSpies['activateItem:calls'], 0);
  assert.equal(h.commandSpies['clearSelection:calls'], 0, 'workspace Escape is ignored while the library is open');
});

test('prompt modal shortcuts leave the workspace store state completely unchanged', () => {
  const initialState = {
    groups: [
      { id: 'g-letters', name: 'Letters', parentId: 'root', order: 0 },
      { id: 'g-run', name: 'Run', parentId: 'g-letters', order: 0 },
    ],
    shortcuts: [
      { id: 's-slop', name: 'slop', target: 'C:\\slop', placements: [{ id: 'p1', parentId: 'g-run', order: 0 }] },
    ],
    view: { iconSize: 96 },
  };
  const h = createHarness({ initialState });
  h.elements.promptLayer.hidden = false;
  h.store.setSelection(['g-letters']);
  const before = structuredClone(h.store.getSnapshot());
  for (const event of [
    key({ key: 'a', ctrlKey: true }),
    key({ key: 'c', ctrlKey: true }),
    key({ key: 'x', ctrlKey: true }),
    key({ key: 'v', ctrlKey: true }),
    key({ key: 'Delete' }),
    key({ key: 'Enter' }),
    key({ key: 'Escape' }),
  ]) {
    h.listeners[0].handler(event);
  }
  assert.deepEqual(h.store.getSnapshot(), before, 'no workspace record, placement, selection, or view changed');
});

test('Ctrl+Shift+Z routes only to redo', () => {
  const h = createHarness();
  h.listeners[0].handler(key({ key: 'z', ctrlKey: true, shiftKey: true }));
  assert.equal(h.commandSpies['redo:calls'], 1);
  assert.equal(h.commandSpies['undo:calls'], 0);
});

test('Ctrl+V passes the selected paste destinations to pasteInto', () => {
  const h = createHarness();
  h.listeners[0].handler(key({ key: 'v', ctrlKey: true }));
  assert.deepEqual(h.commandSpies['pasteInto:args'][0], [['dest']]);
});

test('G groups the selection into a set', () => {
  const h = createHarness();
  h.listeners[0].handler(key({ key: 'g' }));
  assert.equal(h.commandSpies['groupSelectionIntoSet:calls'], 1);
  assert.equal(h.called.membershipEdit, 0, 'plain G does not open the membership editor');
});

test('Ctrl+G opens the set membership editor instead of grouping', () => {
  const h = createHarness();
  h.listeners[0].handler(key({ key: 'g', ctrlKey: true }));
  assert.equal(h.called.membershipEdit, 1);
  assert.equal(
    h.commandSpies['groupSelectionIntoSet:calls'], 0,
    'the Ctrl form is never mistaken for the plain one',
  );
});

test('Meta+G also opens the membership editor', () => {
  const h = createHarness();
  h.listeners[0].handler(key({ key: 'g', metaKey: true }));
  assert.equal(h.called.membershipEdit, 1);
});

test('G while typing in a field does not group', () => {
  const h = createHarness();
  h.listeners[0].handler(key({ key: 'g', target: typingTarget() }));
  assert.equal(h.commandSpies['groupSelectionIntoSet:calls'], 0, 'the keystroke belongs to the field');
});

test('G does nothing while a modal layer is open', () => {
  const h = createHarness();
  h.elements.promptLayer.hidden = false;
  h.listeners[0].handler(key({ key: 'g' }));
  assert.equal(h.commandSpies['groupSelectionIntoSet:calls'], 0);
});

test('Escape cancels the membership picker instead of clearing the selection', () => {
  const h = createHarness({ membershipActive: true });
  h.store.setSelection(['a']);
  h.listeners[0].handler(key({ key: 'Escape' }));
  assert.equal(h.called.membershipCancel, 1);
  assert.equal(
    h.commandSpies['clearSelection:calls'], 0,
    'cancelling must not also clear the selection it was editing',
  );
});

test('Enter confirms the membership picker instead of activating an item', () => {
  const h = createHarness({ membershipActive: true });
  h.store.setSelection(['a']);
  h.listeners[0].handler(key({ key: 'Enter' }));
  assert.equal(h.called.membershipConfirm, 1);
  assert.equal(h.commandSpies['activateItem:calls'], 0, 'Enter does not open the item');
});

test('with the picker closed Escape and Enter behave normally', () => {
  const h = createHarness();
  h.store.setSelection(['a']);
  h.listeners[0].handler(key({ key: 'Escape' }));
  assert.equal(h.commandSpies['clearSelection:calls'], 1);
  h.listeners[0].handler(key({ key: 'Enter' }));
  assert.equal(h.commandSpies['activateItem:calls'], 1);
  assert.equal(h.called.membershipCancel, 0);
  assert.equal(h.called.membershipConfirm, 0);
});

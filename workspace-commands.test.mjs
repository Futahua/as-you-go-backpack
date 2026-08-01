import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkspaceStore } from './public/app/workspace-store.js';
import { createWorkspaceCommands } from './public/app/workspace-commands.js';

function createHarness() {
  let state = { groups: [], shortcuts: [], view: { currentGroupId: 'root' } };
  const store = createWorkspaceStore({
    getState: () => state,
    setState: (next) => { state = next; },
    persist: async () => {},
    normalizeState: (s) => s,
    setStatus: () => {},
  });
  const effects = { sync: 0, saves: 0 };
  const commands = createWorkspaceCommands({
    store,
    syncSelection: () => { effects.sync += 1; },
    saveWorkspaceView: () => { effects.saves += 1; },
  });
  return { store, commands, effects };
}

test('selectItem without modifiers selects just the item and sets the anchor', () => {
  const h = createHarness();
  h.commands.selectItem('b', { shiftKey: false, ctrlKey: false, visibleItemIds: ['a', 'b', 'c'] });
  assert.deepEqual([...h.store.getSession().selected], ['b']);
  assert.equal(h.store.getSession().selectionAnchor, 'b');
  assert.equal(h.effects.sync, 1);
  assert.equal(h.effects.saves, 1);
});

test('selectItem ctrl-click toggles an item and updates the anchor', () => {
  const h = createHarness();
  h.commands.selectItem('a', { shiftKey: false, ctrlKey: true, visibleItemIds: ['a', 'b', 'c'] });
  h.commands.selectItem('c', { shiftKey: false, ctrlKey: true, visibleItemIds: ['a', 'b', 'c'] });
  assert.deepEqual([...h.store.getSession().selected], ['a', 'c']);
  assert.equal(h.store.getSession().selectionAnchor, 'c');
  // ctrl-clicking a selected item removes it.
  h.commands.selectItem('a', { shiftKey: false, ctrlKey: true, visibleItemIds: ['a', 'b', 'c'] });
  assert.deepEqual([...h.store.getSession().selected], ['c']);
});

test('selectItem shift-click selects the range from the anchor', () => {
  const h = createHarness();
  h.commands.selectItem('a', { shiftKey: false, ctrlKey: false, visibleItemIds: ['a', 'b', 'c', 'd'] });
  h.commands.selectItem('c', { shiftKey: true, ctrlKey: false, visibleItemIds: ['a', 'b', 'c', 'd'] });
  assert.deepEqual([...h.store.getSession().selected], ['a', 'b', 'c']);
});

test('selectItem shift-click extends the range without clearing prior ctrl selection', () => {
  const h = createHarness();
  h.commands.selectItem('b', { shiftKey: false, ctrlKey: true, visibleItemIds: ['a', 'b', 'c', 'd'] });
  h.commands.selectItem('d', { shiftKey: true, ctrlKey: true, visibleItemIds: ['a', 'b', 'c', 'd'] });
  assert.deepEqual([...h.store.getSession().selected], ['b', 'c', 'd']);
});

test('undo and redo run through the store history', async () => {
  const h = createHarness();
  await h.store.commit({ groups: [], shortcuts: [], view: { currentGroupId: 'g1' } });
  await h.store.commit({ groups: [], shortcuts: [], view: { currentGroupId: 'g2' } });
  assert.equal(h.store.getSnapshot().view.currentGroupId, 'g2');

  await h.commands.undo();
  assert.equal(h.store.getSnapshot().view.currentGroupId, 'g1');
  await h.commands.redo();
  assert.equal(h.store.getSnapshot().view.currentGroupId, 'g2');
});

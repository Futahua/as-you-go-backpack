import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkspaceStore } from './public/app/workspace-store.js';
import { createWorkspaceCommands } from './public/app/workspace-commands.js';

function createHarness({ groups = [], shortcuts = [], model = {} } = {}) {
  let state = { groups, shortcuts, view: { currentGroupId: 'root' } };
  const store = createWorkspaceStore({
    getState: () => state,
    setState: (next) => { state = next; },
    persist: async () => {},
    normalizeState: (s) => s,
    setStatus: () => {},
  });
  const effects = {
    sync: 0, saves: 0, close: 0, render: 0, destroyGraph: 0,
    launch: [], openWeb: [], reveal: [], status: [],
  };
  const base = {
    group: (id) => groups.find((candidate) => candidate.id === id) ?? null,
    shortcut: (id) => shortcuts.find((candidate) => candidate.id === id) ?? null,
    item: (id) => (
      groups.find((candidate) => candidate.id === id)
      ?? shortcuts.find((candidate) => candidate.id === id)
      ?? null
    ),
    isWebLink: (candidate) => candidate?.target?.startsWith('https://'),
    visiblePlacementIdFor: (id) => `p-${id}`,
    visibleParentCountFor: () => 1,
    allActivePlacementIds: (id) => [`p-${id}`],
    anyActivePlacementId: (id) => `p-${id}`,
    moveSelection: (s, ids, parentId) => ({ ...s, moved: [...ids, parentId] }),
    copySelection: (s, ids, parentId) => ({
      ...s,
      pastes: [...(s.pastes ?? []), { ids, parentId }],
    }),
    collapsePlacements: (s, id, parentId) => ({ ...s, collapsed: [id, parentId] }),
    binSelection: (s, ids) => ({ ...s, binned: ids }),
    resolveBinTargets: (ids) => ids,
    graphContextId: () => 'ctx',
    removeGraphPositions: (s, ctxId, ids) => ({ ...s, positionsRemoved: ids }),
  };
  Object.assign(base, model);
  const graphNodes = new Map();
  const commands = createWorkspaceCommands({
    store,
    host: {
      launchShortcut: async (id) => { effects.launch.push(id); },
      openWebLink: async (url) => { effects.openWeb.push(url); },
      revealShortcut: async (id) => { effects.reveal.push(id); },
    },
    graph: {
      destroyGraphView: () => { effects.destroyGraph += 1; },
      _getNode: (id) => graphNodes.get(id) ?? null,
      reheat: () => { effects.reheat = (effects.reheat ?? 0) + 1; },
    },
    ...base,
    syncSelection: () => { effects.sync += 1; },
    saveWorkspaceView: () => { effects.saves += 1; },
    closeMenu: () => { effects.close += 1; },
    render: () => { effects.render += 1; },
    setStatus: (text) => { effects.status.push(text); },
  });
  return { store, commands, effects, base, graphNodes };
}

test('selectItem without modifiers selects just the item and sets the anchor', () => {
  const h = createHarness();  h.commands.selectItem('b', { shiftKey: false, ctrlKey: false, visibleItemIds: ['a', 'b', 'c'] });
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

test('activateItem navigates into an explorer folder', () => {
  const h = createHarness({ groups: [{ id: 'g1', parentId: 'root', name: 'Things' }] });
  h.store.setSelection(['g1']);
  h.commands.activateItem('g1');
  assert.equal(h.store.getSession().currentId, 'g1');
  assert.equal(h.store.getSession().selected.size, 0);
  assert.equal(h.effects.destroyGraph, 1);
  assert.equal(h.effects.close, 1);
  assert.equal(h.effects.render, 1);
  assert.equal(h.effects.saves, 1);
});

test('activateItem on a folder in Bin mode drills within the Bin', () => {
  const h = createHarness({ groups: [{ id: 'bin-folder', parentId: 'root', name: 'Nested', bin: true }] });
  h.store.setNavigation({ binMode: true });
  h.commands.activateItem('bin-folder');
  assert.equal(h.store.getSession().binCurrentId, 'bin-folder');
  assert.equal(h.store.getSession().currentId, null);
});

test('activateItem launches a shortcut and opens a web link', async () => {
  const h = createHarness({
    shortcuts: [
      { id: 's1', name: 'App', target: 'C:\\app.exe' },
      { id: 's2', name: 'Site', target: 'https://example.com' },
    ],
  });
  await h.commands.activateItem('s1');
  assert.deepEqual(h.effects.launch, ['s1']);
  await h.commands.activateItem('s2');
  assert.deepEqual(h.effects.openWeb, ['https://example.com']);
});

test('revealSelection reveals each unique directory once', async () => {
  const h = createHarness({
    shortcuts: [
      { id: 'a', name: 'A', target: 'D:\\work\\a.txt' },
      { id: 'b', name: 'B', target: 'D:\\work\\b.txt' },
      { id: 'c', name: 'C', target: 'D:\\other\\c.txt' },
    ],
  });
  h.store.setSelection(['a', 'b', 'c']);
  await h.commands.revealSelection();
  assert.deepEqual(h.effects.reveal, ['a', 'c']);
});

test('activateSelection launches every selected shortcut', async () => {
  const h = createHarness({
    shortcuts: [
      { id: 'a', name: 'A', target: 'C:\\a.exe' },
      { id: 'b', name: 'B', target: 'https://example.com' },
    ],
  });
  h.store.setSelection(['a', 'b']);
  await h.commands.activateSelection();
  assert.deepEqual(h.effects.launch, ['a']);
  assert.deepEqual(h.effects.openWeb, ['https://example.com']);
});

test('copySelection stores a copy clipboard with ids and placement ids', () => {
  const h = createHarness({ shortcuts: [{ id: 's1', name: 'S', target: 'C:\\s.exe' }] });
  h.store.setSelection(['s1']);
  h.commands.copySelection();
  const clipboard = h.store.getSession().clipboard;
  assert.equal(clipboard.mode, 'copy');
  assert.deepEqual(clipboard.ids, ['s1']);
  assert.equal(clipboard.placementIds.get('s1'), 'p-s1');
  assert.equal(h.effects.close, 1);
});

test('cutSelection marks a linked shortcut for whole collapse', () => {
  const h = createHarness({
    shortcuts: [{ id: 's1', name: 'S', target: 'C:\\s.exe' }],
    model: { visibleParentCountFor: () => 2 },
  });
  h.store.setSelection(['s1']);
  h.commands.cutSelection();
  assert.equal(h.store.getSession().clipboard.mode, 'cut');
  assert.ok(h.store.getSession().clipboard.collapseWhole.has('s1'));
});

test('pasteInto copy links into each destination and keeps the clipboard', async () => {
  const h = createHarness();
  h.store.setClipboard({ mode: 'copy', ids: ['s1'], placementIds: new Map([['s1', 'p-s1']]), collapseWhole: new Set() });
  await h.commands.pasteInto(['g1', 'g2']);
  assert.deepEqual(h.store.getSnapshot().pastes, [
    { ids: ['p-s1'], parentId: 'g1' },
    { ids: ['p-s1'], parentId: 'g2' },
  ]);
  assert.ok(h.store.getSession().clipboard);
});

test('pasteInto cut moves to the first destination and clears the clipboard', async () => {
  const h = createHarness();
  h.store.setClipboard({ mode: 'cut', ids: ['s1'], placementIds: new Map([['s1', 'p-s1']]), collapseWhole: new Set() });
  await h.commands.pasteInto(['g1', 'g2']);
  assert.deepEqual(h.store.getSnapshot().moved, ['p-s1', 'g1']);
  assert.equal(h.store.getSession().clipboard, null);
});

test('moveSelectionToBin bins the resolved targets and commits', async () => {
  const h = createHarness({
    model: {
      resolveBinTargets: (ids) => ids.flatMap((id) => (id === 's1' ? ['p-s1', 'p-s1b'] : [id])),
    },
  });
  h.store.setSelection(['g1', 's1']);
  await h.commands.moveSelectionToBin();
  assert.deepEqual(h.store.getSnapshot().binned, ['g1', 'p-s1', 'p-s1b']);
  assert.equal(h.store.getSession().selected.size, 0);
});

test('selectedPasteDestinations uses selected folders or the current folder', () => {
  const h = createHarness({ groups: [{ id: 'g1', parentId: 'root', name: 'G' }] });
  h.store.setSelection(['g1', 's1']);
  assert.deepEqual(h.commands.selectedPasteDestinations(), ['g1']);
  h.store.setSelection(['s1']);
  h.store.setNavigation({ currentId: 'root' });
  assert.deepEqual(h.commands.selectedPasteDestinations(), ['root']);
});

test('resetGraphPositions removes saved positions, resets nodes, reheats, and saves', () => {
  const node = { fx: 10, fy: 10, positioned: true, vx: 1, vy: 1 };
  const h = createHarness({
    model: {
      graphContextId: () => 'ctx-1',
      removeGraphPositions: (s, ctxId, ids) => ({ ...s, positionsRemoved: { ctxId, ids } }),
    },
  });
  h.graphNodes.set('s1', node);
  h.store.setSelection(['s1']);
  h.commands.resetGraphPositions();
  assert.deepEqual(h.store.getSnapshot().positionsRemoved, { ctxId: 'ctx-1', ids: ['s1'] });
  assert.equal(node.fx, null);
  assert.equal(node.fy, null);
  assert.equal(node.positioned, false);
  assert.equal(node.vx, 0);
  assert.equal(node.vy, 0);
  assert.equal(h.effects.reheat, 1);
  assert.equal(h.effects.close, 1);
  assert.equal(h.effects.saves, 1);
});

test('clearSelection clears the selection and saves the view', () => {
  const h = createHarness();
  h.store.setSelection(['a', 'b']);
  h.commands.clearSelection();
  assert.equal(h.store.getSession().selected.size, 0);
  assert.equal(h.effects.sync, 1);
  assert.equal(h.effects.saves, 1);
});

test('selectAllVisible selects every visible item and clears the anchor', () => {
  const h = createHarness();
  h.store.setSelection(['a']);
  h.commands.selectAllVisible(['a', 'b', 'c']);
  assert.deepEqual([...h.store.getSession().selected], ['a', 'b', 'c']);
  assert.equal(h.store.getSession().selectionAnchor, null);
  assert.equal(h.effects.sync, 1);
  assert.equal(h.effects.saves, 1);
});

// What Enter does, end to end through the modules that can be imported here.
//
// The entry file cannot be imported (it boots the workspace from the document), so the chain is split
// where the code is: quick-run-entry.test.mjs asserts the entry wiring names these calls, and this file
// runs the calls themselves against the real workspace command object - the same activateItem workspace
// Enter uses - so "Folder Enter navigates" is a navigated folder rather than a matching string.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceStore } from './public/app/workspace-store.js';
import { createWorkspaceCommands } from './public/app/workspace-commands.js';
import { openQuickRunSession, quickRunSessionWithQuery } from './public/app/quick-run/quick-run-session.js';
import {
  planQuickRunActivation,
  quickRunWorkspaceItemId,
  revalidateQuickRunRow,
} from './public/app/quick-run/quick-run-activation.js';

function createHarness({ groups = [], shortcuts = [] } = {}) {
  let state = { groups, shortcuts, view: { currentGroupId: 'root' } };
  const store = createWorkspaceStore({
    getState: () => state,
    setState: (next) => { state = next; },
    persist: async () => {},
    normalizeState: (s) => s,
    setStatus: () => {},
  });
  const effects = { launch: [], openWeb: [], reveal: [], status: [] };
  const commands = createWorkspaceCommands({
    store,
    host: {
      launchShortcut: async (id) => { effects.launch.push(id); },
      openWebLink: async (url) => { effects.openWeb.push(url); },
      revealShortcut: async (id) => { effects.reveal.push(id); },
    },
    graph: { destroyGraphView: () => {}, _getNode: () => null },
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
    moveSelection: (s) => s,
    copySelection: (s) => s,
    collapsePlacements: (s) => s,
    binSelection: (s) => s,
    resolveBinTargets: (ids) => ids,
    graphContextId: () => 'ctx',
    removeGraphPositions: (s) => s,
    removeGraphRestPositions: (s) => s,
    setGraphPositions: (s) => s,
    createWebLink: (s) => s,
    createDroppedShortcuts: (s) => s,
    syncSelection: () => {},
    saveWorkspaceView: () => {},
    closeMenu: () => {},
    render: () => {},
    setStatus: (text) => { effects.status.push(text); },
  });
  return { store, commands, effects };
}

const state = {
  groups: [
    { id: 'g-root', parentId: 'root', name: 'Workspace' },
    { id: 'g-2', parentId: 'g-root', name: 'Writing' },
  ],
  shortcuts: [
    { id: 's-1', name: 'Docs', target: 'https://example.com/docs', placements: [{ id: 'p-1', parentId: 'g-2', order: 1 }] },
    { id: 's-2', name: 'Editor', target: 'C:/Program Files/Editor/editor.exe', placements: [{ id: 'p-2', parentId: 'g-2', order: 2 }] },
  ],
};

/** Exactly what the entry file's onActivate does, minus the status copy, for a query that highlights a row. */
function pressEnter(harness, query) {
  const session = quickRunSessionWithQuery(openQuickRunSession(state), query);
  const current = revalidateQuickRunRow(state, session.highlightKey);
  assert.equal(current.ok, true, `"${query}" highlights a row that still exists`);
  const plan = planQuickRunActivation(current.row);
  const itemId = quickRunWorkspaceItemId(plan);
  assert.notEqual(itemId, null, `"${query}" plans an action the workspace can take`);
  return { row: current.row, plan, done: harness.commands.activateItem(itemId) };
}

test('Folder Enter navigates (section 1.5)', () => {
  const harness = createHarness(state);
  const { row, plan, done } = pressEnter(harness, 'writing');
  assert.equal(row.type, 'folder');
  assert.equal(plan.command, 'workspace.open-selection');
  void done;
  assert.equal(harness.store.getSession().currentId, 'g-2', 'the folder is the one that was searched for');
});

test('Shortcut Enter launches (section 1.5)', async () => {
  const harness = createHarness(state);
  const { row, plan, done } = pressEnter(harness, 'editor');
  assert.equal(row.type, 'shortcut');
  assert.equal(plan.command, 'workspace.open-selection');
  await done;
  assert.deepEqual(harness.effects.launch, ['s-2']);
  assert.deepEqual(harness.effects.reveal, [], 'launching is not revealing (section 1.6)');
});

test('Link Enter opens its web URL (section 1.5)', async () => {
  const harness = createHarness(state);
  const { row, plan, done } = pressEnter(harness, 'docs');
  assert.equal(row.type, 'link', 'an https target is classified as a Link');
  assert.equal(plan.action, 'open-link');
  await done;
  assert.deepEqual(harness.effects.openWeb, ['https://example.com/docs']);
  assert.deepEqual(harness.effects.launch, [], 'a link is opened, not launched as a program');
});

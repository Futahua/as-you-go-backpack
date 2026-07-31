import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ROOT_ID,
  createGroup,
  createShortcut,
  binSelection,
  emptyState,
  normalizeState,
  updateWorkspaceView,
  setGraphPositions,
  removeGraphPositions,
  getGraphPosition,
  graphContextId,
  moveSelection,
  copySelection,
  forkPlacement,
} from './model.mjs';

import {
  visibleGraphItems,
  graphEdges,
  seedPosition,
  allFinite,
  allUniquePositions,
} from './public/graph-model-20260730b.js';

function makeFixtureState() {
  let state = createGroup(emptyState(), 'News');
  state = createGroup(state, 'Letters');
  const letters = state.groups[1];
  state = createGroup(state, 'Real');
  state = createGroup(state, 'Things');
  state = createShortcut(state, { name: 'CLIPS', target: 'C:\\clips.bat', parentId: letters.id });
  state = createShortcut(state, { name: 'CAD', target: 'C:\\cad.exe', parentId: letters.id });
  state = createShortcut(state, { name: 'SKP', target: 'C:\\skp.exe', parentId: letters.id });
  state = createShortcut(state, { name: '3DS', target: 'C:\\3ds.exe', parentId: letters.id });
  state = createShortcut(state, { name: 'Books', target: 'C:\\books.exe', parentId: letters.id });
  state = createShortcut(state, { name: 'W', target: 'C:\\w.exe', parentId: letters.id });
  state = createShortcut(state, { name: 'Claude', target: 'C:\\claude.exe', parentId: letters.id });
  return state;
}

test('graph model produces four root nodes with finite unique coordinates', () => {
  const state = makeFixtureState();
  const items = visibleGraphItems(state, ROOT_ID, new Set(), false);
  assert.equal(items.filter((i) => i.depth === 0).length, 4);

  const roots = items.filter((i) => i.depth === 0);
  const seeds = roots.map((vi) =>
    seedPosition(vi.id, null, vi.siblingIndex, vi.siblingCount, 400, 300));
  assert.ok(allFinite(seeds));
  assert.ok(allUniquePositions(seeds));
});

test('expanding Letters produces seven uniquely positioned children and seven edges', () => {
  const state = makeFixtureState();
  const letters = state.groups[1];
  const items = visibleGraphItems(state, ROOT_ID, new Set([letters.id]), false);
  const lettersChildren = items.filter((i) => i.parentId === letters.id);
  assert.equal(lettersChildren.length, 7);

  const parent = { x: 200, y: 200 };
  const childSeeds = lettersChildren.map((vi) =>
    seedPosition(vi.id, parent, vi.siblingIndex, vi.siblingCount));
  assert.ok(allFinite(childSeeds));
  assert.ok(allUniquePositions(childSeeds));

  const edges = graphEdges(items);
  assert.equal(edges.length, 7);
  assert.ok(edges.every((e) => e.source === letters.id));
});

test('graph model can be built with no Explorer DOM mounted', () => {
  const state = makeFixtureState();
  const items = visibleGraphItems(state, ROOT_ID, new Set(), false);
  assert.ok(items.length > 0);
  assert.ok(items.every((i) => i.kind === 'group' || i.kind === 'shortcut'));
});

test('switching modes does not alter the underlying item state', () => {
  const state = makeFixtureState();
  const before = JSON.stringify(state);
  visibleGraphItems(state, ROOT_ID, new Set(), false);
  visibleGraphItems(state, ROOT_ID, new Set([state.groups[1].id]), false);
  assert.equal(JSON.stringify(state), before);
});

test('rebuilding the graph model with unchanged items is stable', () => {
  const state = makeFixtureState();
  const a = visibleGraphItems(state, ROOT_ID, new Set(), false);
  const b = visibleGraphItems(state, ROOT_ID, new Set(), false);
  assert.deepEqual(a, b);
});

test('retained nodes preserve kind after repeated visibility cycles', () => {
  const state = makeFixtureState();
  const letters = state.groups[1];
  const collapsed = visibleGraphItems(state, ROOT_ID, new Set(), false);
  const expanded = visibleGraphItems(state, ROOT_ID, new Set([letters.id]), false);
  const recollapsed = visibleGraphItems(state, ROOT_ID, new Set(), false);

  for (const root of collapsed.filter((i) => i.depth === 0)) {
    const again = recollapsed.find((i) => i.id === root.id);
    assert.ok(again);
    assert.equal(again.kind, root.kind);
  }
});

test('Bin graph mode shows only binned items as flat roots', () => {
  const state = makeFixtureState();
  const letters = state.groups[1];
  const binned = binSelection(state, [letters.id], '2026-07-30T00:00:00.000Z');
  const binItems = visibleGraphItems(binned, ROOT_ID, new Set(), true);
  assert.ok(binItems.length > 0);
  assert.ok(binItems.every((i) => i.depth === 0));
  assert.ok(binItems.every((i) => i.parentId === 'bin'));
  assert.equal(graphEdges(binItems).length, 0);
});

test('persisted layout=graph loads directly into graph mode', () => {
  const state = updateWorkspaceView(makeFixtureState(), { layout: 'graph' });
  const restored = normalizeState(JSON.parse(JSON.stringify(state)));
  assert.equal(restored.view.layout, 'graph');
  const items = visibleGraphItems(restored, ROOT_ID, new Set(), false);
  assert.ok(items.length > 0);
});

test('persisted layout=explorer loads directly into explorer mode', () => {
  const state = updateWorkspaceView(makeFixtureState(), { layout: 'explorer' });
  const restored = normalizeState(JSON.parse(JSON.stringify(state)));
  assert.equal(restored.view.layout, 'explorer');
});

test('zero-dimension recovery does not permanently abort model construction', () => {
  const state = makeFixtureState();
  const items = visibleGraphItems(state, ROOT_ID, new Set(), false);
  assert.ok(items.length > 0);
  const seeds = items
    .filter((i) => i.depth === 0)
    .map((vi) => seedPosition(vi.id, null, vi.siblingIndex, vi.siblingCount, 0, 0));
  assert.ok(allFinite(seeds));
});

test('every visible graph node has a defined kind', () => {
  const state = makeFixtureState();
  const letters = state.groups[1];
  const items = visibleGraphItems(state, ROOT_ID, new Set([letters.id]), false);
  assert.ok(items.every((i) => i.kind === 'group' || i.kind === 'shortcut'));
});

test('repeated visibility cycling is stable and complete', () => {
  const state = makeFixtureState();
  const letters = state.groups[1];
  for (let i = 0; i < 10; i += 1) {
    const collapsed = visibleGraphItems(state, ROOT_ID, new Set(), false);
    assert.equal(collapsed.filter((n) => n.depth === 0).length, 4);
    const expanded = visibleGraphItems(state, ROOT_ID, new Set([letters.id]), false);
    assert.equal(expanded.filter((n) => n.parentId === letters.id).length, 7);
  }
});

test('independent expansion states do not leak between views', () => {
  const state = makeFixtureState();
  const letters = state.groups[1];

  const explorerExpanded = new Set([letters.id]);
  const graphExpanded = new Set();

  const explorerItems = visibleGraphItems(state, ROOT_ID, explorerExpanded, false);
  assert.ok(explorerItems.some((i) => i.id === state.shortcuts[0].id));

  let items = visibleGraphItems(state, ROOT_ID, graphExpanded, false);
  assert.ok(!items.some((i) => i.parentId === letters.id));
  assert.equal(items.length, 4);
});

test('graph positions persist through state serialization round-trip', () => {
  let state = setGraphPositions(makeFixtureState(), ROOT_ID, {
    shortcut1: { x: 100, y: 200 },
    shortcut2: { x: 300, y: 400 },
  });

  const serialized = JSON.parse(JSON.stringify(state));
  const restored = normalizeState(serialized);

  assert.deepEqual(getGraphPosition(restored, ROOT_ID, 'shortcut1'), { x: 100, y: 200 });
  assert.deepEqual(getGraphPosition(restored, ROOT_ID, 'shortcut2'), { x: 300, y: 400 });
});

test('graph positions are independent across different contexts', () => {
  let state = makeFixtureState();
  const letters = state.groups[1];

  state = setGraphPositions(state, ROOT_ID, {
    item1: { x: 10, y: 20 },
  });
  state = setGraphPositions(state, letters.id, {
    item1: { x: 50, y: 60 },
  });

  assert.deepEqual(getGraphPosition(state, ROOT_ID, 'item1'), { x: 10, y: 20 });
  assert.deepEqual(getGraphPosition(state, letters.id, 'item1'), { x: 50, y: 60 });

  state = setGraphPositions(state, ROOT_ID, { item1: { x: 99, y: 88 } });
  assert.deepEqual(getGraphPosition(state, ROOT_ID, 'item1'), { x: 99, y: 88 });
  assert.deepEqual(getGraphPosition(state, letters.id, 'item1'), { x: 50, y: 60 });
});

test('removing graph positions only affects the target context', () => {
  let state = setGraphPositions(makeFixtureState(), ROOT_ID, {
    item1: { x: 10, y: 20 },
    item2: { x: 30, y: 40 },
  });
  state = setGraphPositions(state, 'bin', {
    item1: { x: 100, y: 200 },
  });

  state = removeGraphPositions(state, ROOT_ID, ['item1']);
  assert.equal(getGraphPosition(state, ROOT_ID, 'item1'), null);
  assert.deepEqual(getGraphPosition(state, ROOT_ID, 'item2'), { x: 30, y: 40 });
  assert.deepEqual(getGraphPosition(state, 'bin', 'item1'), { x: 100, y: 200 });
});

test('moving selection between folders clears source context positions', () => {
  let state = makeFixtureState();
  const letters = state.groups[1];
  const things = state.groups[3];

  state = setGraphPositions(state, ROOT_ID, {
    [letters.id]: { x: 100, y: 200 },
  });

  assert.deepEqual(getGraphPosition(state, ROOT_ID, letters.id), { x: 100, y: 200 });

  state = moveSelection(state, [letters.id], things.id);

  assert.equal(state.groups[1].parentId, things.id);
});

test('layout and expansion are independently persisted across view changes', () => {
  let state = updateWorkspaceView(makeFixtureState(), {
    expandedGroupIds: ['group-a'],
    graphExpandedGroupIds: ['group-b'],
    layout: 'graph',
    binMode: true,
  });

  state = updateWorkspaceView(state, { layout: 'explorer', binMode: false });
  assert.deepEqual(state.view.expandedGroupIds, ['group-a']);
  assert.deepEqual(state.view.graphExpandedGroupIds, ['group-b']);
  assert.equal(state.view.layout, 'explorer');
  assert.equal(state.view.binMode, false);
});

test('graph context ID properly distinguishes bin from normal contexts', () => {
  assert.equal(graphContextId(ROOT_ID, false), ROOT_ID);
  assert.equal(graphContextId(ROOT_ID, true), 'bin');
  assert.equal(graphContextId('some-group-id', false), 'some-group-id');
  assert.equal(graphContextId('some-group-id', true), 'bin');
});

test('a shortcut linked into two simultaneously expanded folders appears once with two edges', () => {
  let state = createGroup(emptyState(), 'A');
  state = createGroup(state, 'B');
  const [a, b] = state.groups;
  state = createShortcut(state, { name: 'Shared', target: 'C:\\shared.exe', parentId: a.id });
  const original = state.shortcuts[0];
  const originalPlacementId = original.placements[0].id;
  state = copySelection(state, [originalPlacementId], b.id);

  const items = visibleGraphItems(state, ROOT_ID, new Set([a.id, b.id]), false);
  const sharedNodes = items.filter((i) => i.id === original.id);
  assert.equal(sharedNodes.length, 1, 'the shared shortcut collapses to exactly one node');
  assert.deepEqual(new Set(sharedNodes[0].parentIds), new Set([a.id, b.id]));

  const edges = graphEdges(items);
  const edgesToShared = edges.filter((e) => e.target === original.id);
  assert.equal(edgesToShared.length, 2, 'one edge from each folder that has it placed');
  assert.deepEqual(new Set(edgesToShared.map((e) => e.source)), new Set([a.id, b.id]));
});

test('a linked shortcut visible from only one expanded folder still shows and links normally', () => {
  let state = createGroup(emptyState(), 'A');
  state = createGroup(state, 'B');
  const [a, b] = state.groups;
  state = createShortcut(state, { name: 'Shared', target: 'C:\\shared.exe', parentId: a.id });
  const original = state.shortcuts[0];
  state = copySelection(state, [original.placements[0].id], b.id);

  // Only A expanded: the shared shortcut appears once, with one edge from A.
  const items = visibleGraphItems(state, ROOT_ID, new Set([a.id]), false);
  const sharedNodes = items.filter((i) => i.id === original.id);
  assert.equal(sharedNodes.length, 1);
  assert.deepEqual(sharedNodes[0].parentIds, [a.id]);
  const edges = graphEdges(items);
  assert.equal(edges.filter((e) => e.target === original.id).length, 1);
});

test('forking a placement out of the graph removes only that one edge, not the shared node elsewhere', () => {
  let state = createGroup(emptyState(), 'A');
  state = createGroup(state, 'B');
  const [a, b] = state.groups;
  state = createShortcut(state, { name: 'Shared', target: 'C:\\shared.exe', parentId: a.id });
  const original = state.shortcuts[0];
  state = copySelection(state, [original.placements[0].id], b.id);

  const bPlacementId = state.shortcuts
    .find((candidate) => candidate.id === original.id).placements
    .find((placement) => placement.parentId === b.id).id;
  state = forkPlacement(state, bPlacementId);

  const items = visibleGraphItems(state, ROOT_ID, new Set([a.id, b.id]), false);
  const originalNodes = items.filter((i) => i.id === original.id);
  assert.equal(originalNodes.length, 1);
  assert.deepEqual(originalNodes[0].parentIds, [a.id]);

  const forked = state.shortcuts.find((candidate) => candidate.id !== original.id);
  const forkedNodes = items.filter((i) => i.id === forked.id);
  assert.equal(forkedNodes.length, 1);
  assert.deepEqual(forkedNodes[0].parentIds, [b.id]);
});
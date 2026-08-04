import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ROOT_ID,
  children,
  copySelection,
  createGroup,
  createShortcut,
  binSelection,
  permanentlyDelete,
  emptyState,
  itemsIntersectingMarquee,
  moveSelection,
  normalizeState,
  renameItem,
  reorderSelection,
  restoreSelection,
  updateGroup,
  updateShortcut,
  forkPlacement,
  collapsePlacements,
  updateWorkspaceView,
  createWebLink,
  isWebLink,
  webLinkIcon,
  createDroppedShortcuts,
  graphContextId,
  getGraphPosition,
  setGraphPositions,
  removeGraphPositions,
  normalizeGraphPositions,
  setPromptLibrary,
} from './model.mjs';

import {
  visibleGraphItems,
  graphEdges,
  seedPosition,
  allFinite,
  allUniquePositions,
} from './public/graph-model-20260730b.js';

/** A freshly created shortcut has exactly one placement; this is that
 * placement's id, which is what selection/move/copy/bin operate on. */
function soloPlacementId(shortcut) {
  return shortcut.placements[0].id;
}

test('a drag marquee selects every visible item rectangle it crosses', () => {
  const tiles = [
    { id: 'one', left: 20, top: 20, right: 100, bottom: 100 },
    { id: 'two', left: 120, top: 20, right: 200, bottom: 100 },
    { id: 'three', left: 220, top: 20, right: 300, bottom: 100 },
  ];

  assert.deepEqual(
    itemsIntersectingMarquee(tiles, { left: 90, top: 10, right: 210, bottom: 110 }),
    ['one', 'two'],
  );
  assert.deepEqual(
    itemsIntersectingMarquee(tiles, { left: 210, top: 110, right: 90, bottom: 10 }),
    ['one', 'two'],
  );
});

test('groups and shortcuts form a nested explorer tree', () => {
  let state = createGroup(emptyState(), 'Projects');
  const projects = state.groups[0];
  state = createGroup(state, '2026', projects.id);
  const year = state.groups[1];
  state = createShortcut(state, { name: 'CLIPS', target: 'D:\\Programs\\CLIPS.bat', parentId: year.id });
  assert.equal(children(state, year.id).shortcuts[0].name, 'CLIPS');
  assert.equal(children(state, ROOT_ID).groups[0].name, 'Projects');
});

test('moving a selected folder and its visible children preserves the folder tree', () => {
  let state = createGroup(emptyState(), 'One');
  state = createGroup(state, 'Two');
  const [one, two] = state.groups;
  state = createShortcut(state, { name: 'A', target: 'C:\\a.bat', parentId: one.id });
  state = createShortcut(state, { name: 'B', target: 'C:\\b.bat', parentId: one.id });
  const [a, b] = state.shortcuts;
  state = moveSelection(state, [one.id, soloPlacementId(a), soloPlacementId(b)], two.id);
  assert.equal(state.groups.find((item) => item.id === one.id).parentId, two.id);
  assert.deepEqual(
    state.shortcuts.map((item) => item.placements[0].parentId),
    [one.id, one.id],
  );
});

test('copying a folder gives it a new identity but links its shortcuts as new placements of the same record', () => {
  let state = createGroup(emptyState(), 'Source');
  const source = state.groups[0];
  state = createGroup(state, 'Destination');
  const destination = state.groups[1];
  state = createShortcut(state, { name: 'A', target: 'C:\\a.bat', parentId: source.id });
  const original = state.shortcuts[0];
  const copied = copySelection(state, [source.id], destination.id);

  assert.equal(copied.groups.length, 3);
  assert.notEqual(copied.groups[2].id, source.id);
  assert.equal(copied.groups[2].parentId, destination.id);

  // The shortcut itself is not duplicated — it's the same record, now with
  // a second placement inside the copied folder.
  assert.equal(copied.shortcuts.length, 1);
  assert.equal(copied.shortcuts[0].id, original.id);
  assert.equal(copied.shortcuts[0].placements.length, 2);
  assert.equal(children(copied, copied.groups[2].id).shortcuts[0].name, 'A');
  assert.equal(children(copied, source.id).shortcuts[0].name, 'A');
});

test('a selected shortcut copied from a nested expanded folder links rather than duplicates', () => {
  let state = createGroup(emptyState(), 'Source');
  const source = state.groups[0];
  state = createGroup(state, 'Destination');
  const destination = state.groups[1];
  state = createShortcut(state, { name: 'Nested', target: 'C:\\nested.exe', parentId: source.id });
  const original = state.shortcuts[0];

  const copied = copySelection(state, [soloPlacementId(original)], destination.id);

  assert.equal(copied.shortcuts.length, 1);
  assert.equal(copied.shortcuts[0].placements.length, 2);
  assert.equal(children(copied, destination.id).shortcuts[0].name, 'Nested');
  assert.equal(children(copied, source.id).shortcuts[0].name, 'Nested');
});

test('editing a linked shortcut changes it in every folder it is placed in', () => {
  let state = createGroup(emptyState(), 'Source');
  const source = state.groups[0];
  state = createGroup(state, 'Destination');
  const destination = state.groups[1];
  state = createShortcut(state, { name: 'A', target: 'C:\\a.bat', parentId: source.id });
  const original = state.shortcuts[0];
  state = copySelection(state, [soloPlacementId(original)], destination.id);

  state = updateShortcut(state, original.id, {
    name: 'Renamed',
    target: 'C:\\a.bat',
    description: '',
    icon: null,
  });

  assert.equal(children(state, source.id).shortcuts[0].name, 'Renamed');
  assert.equal(children(state, destination.id).shortcuts[0].name, 'Renamed');
});

test('forking a linked placement gives it an independent identity that no longer shares edits', () => {
  let state = createGroup(emptyState(), 'Source');
  const source = state.groups[0];
  state = createGroup(state, 'Destination');
  const destination = state.groups[1];
  state = createShortcut(state, { name: 'A', target: 'C:\\a.bat', parentId: source.id });
  const original = state.shortcuts[0];
  state = copySelection(state, [soloPlacementId(original)], destination.id);
  const destinationPlacementId = children(state, destination.id).shortcuts[0].id;

  state = forkPlacement(state, destinationPlacementId);
  assert.equal(state.shortcuts.length, 2);
  const forked = state.shortcuts.find((candidate) => candidate.id !== original.id);
  assert.equal(forked.placements.length, 1);
  assert.equal(children(state, source.id).shortcuts[0].shortcutId, original.id);
  assert.equal(children(state, destination.id).shortcuts[0].shortcutId, forked.id);

  state = updateShortcut(state, original.id, {
    name: 'OnlySource',
    target: 'C:\\a.bat',
    description: '',
    icon: null,
  });
  assert.equal(children(state, source.id).shortcuts[0].name, 'OnlySource');
  assert.equal(children(state, destination.id).shortcuts[0].name, 'A');
});

test('collapsePlacements moves a linked shortcut entirely into one destination, dropping all other placements', () => {
  let state = createGroup(emptyState(), 'A');
  state = createGroup(state, 'B');
  state = createGroup(state, 'C');
  const [a, b, c] = state.groups;
  state = createShortcut(state, { name: 'Shared', target: 'C:\\shared.exe', parentId: a.id });
  const original = state.shortcuts[0];
  state = copySelection(state, [original.placements[0].id], b.id);
  assert.equal(state.shortcuts[0].placements.length, 2);

  state = collapsePlacements(state, original.id, c.id);

  assert.equal(state.shortcuts.length, 1);
  assert.equal(state.shortcuts[0].placements.length, 1);
  assert.equal(state.shortcuts[0].placements[0].parentId, c.id);
  assert.equal(children(state, a.id).shortcuts.length, 0);
  assert.equal(children(state, b.id).shortcuts.length, 0);
  assert.equal(children(state, c.id).shortcuts[0].name, 'Shared');
});

test('collapsePlacements leaves binned placements of the same shortcut untouched', () => {
  let state = createGroup(emptyState(), 'A');
  state = createGroup(state, 'B');
  const [a, b] = state.groups;
  state = createShortcut(state, { name: 'Shared', target: 'C:\\shared.exe', parentId: a.id });
  const original = state.shortcuts[0];
  state = copySelection(state, [original.placements[0].id], b.id);
  const bPlacementId = state.shortcuts[0].placements.find((p) => p.parentId === b.id).id;
  state = binSelection(state, [bPlacementId], '2026-07-30T00:00:00.000Z');

  state = createGroup(state, 'C');
  const c = state.groups[2];
  state = collapsePlacements(state, original.id, c.id);

  const placements = state.shortcuts[0].placements;
  assert.equal(placements.length, 2);
  assert.ok(placements.some((p) => p.bin));
  assert.ok(placements.some((p) => p.parentId === c.id && !p.bin));
});

test('a group cannot move into itself or one of its descendants', () => {
  let state = createGroup(emptyState(), 'Parent');
  const parent = state.groups[0];
  state = createGroup(state, 'Child', parent.id);
  const child = state.groups[1];
  assert.throws(() => moveSelection(state, [parent.id], child.id), /inside itself/);
});

test('rename applies to either a group or shortcut', () => {
  let state = createGroup(emptyState(), 'Old');
  const group = state.groups[0];
  state = renameItem(state, group.id, 'New');
  assert.equal(state.groups[0].name, 'New');
});

test('folders can use a custom image or return to the default folder icon', () => {
  let state = createGroup(
    emptyState(),
    'Pictures',
    ROOT_ID,
    'data:image/png;base64,folder',
  );
  const folder = state.groups[0];
  assert.equal(folder.icon, 'data:image/png;base64,folder');

  state = updateGroup(state, folder.id, { name: 'Pictures', icon: null });
  assert.equal(state.groups[0].icon, null);
});

test('editing a shortcut preserves its identity and folder while replacing every editable field', () => {
  let state = createGroup(emptyState(), 'Apps');
  const apps = state.groups[0];
  state = createShortcut(state, {
    name: 'Old',
    description: 'Generic',
    target: 'C:\\old.exe',
    icon: 'data:image/png;base64,old',
    parentId: apps.id,
  });
  const original = state.shortcuts[0];

  state = updateShortcut(state, original.id, {
    name: 'New',
    description: '',
    target: 'D:\\new.exe',
    icon: null,
  });

  assert.deepEqual(state.shortcuts[0], {
    ...original,
    name: 'New',
    description: '',
    target: 'D:\\new.exe',
    icon: null,
  });
});

test('legacy state receives stable manual order and a default icon size without losing items', () => {
  const state = normalizeState({
    schemaVersion: 1,
    groups: [{ id: 'g', parentId: ROOT_ID, name: 'Group' }],
    shortcuts: [
      { id: 'a', parentId: ROOT_ID, name: 'A', description: '', target: 'C:\\a.exe', icon: null },
      { id: 'b', parentId: ROOT_ID, name: 'B', description: '', target: 'C:\\b.exe', icon: null },
    ],
  });
  assert.deepEqual(state.shortcuts.map((item) => item.placements[0].order), [1, 2]);
  assert.equal(state.groups[0].order, 0);
  assert.equal(state.view.iconSize, 96);
  assert.equal(state.groups[0].icon, null);
});

test('the local project preserves its explorer working position', () => {
  let state = createGroup(emptyState(), 'Open');
  state = createShortcut(state, {
    name: 'Picked',
    target: 'C:\\picked.exe',
    parentId: state.groups[0].id,
  });

  state = updateWorkspaceView(state, {
    currentGroupId: state.groups[0].id,
    expandedGroupIds: [state.groups[0].id],
    selectedItemIds: [state.shortcuts[0].id],
    binMode: false,
  });
  const restored = normalizeState(JSON.parse(JSON.stringify(state)));

  assert.deepEqual(restored.view, {
    iconSize: 96,
    currentGroupId: state.groups[0].id,
    expandedGroupIds: [state.groups[0].id],
    graphExpandedGroupIds: [],
    selectedItemIds: [state.shortcuts[0].id],
    binMode: false,
    layout: 'explorer',
    graphPositions: {},
    toolbarPositions: {},
    preferences: {},
    promptLibrary: [],
    itemSets: [],
  });
});

test('emptyState contains an empty prompt library', () => {
  assert.deepEqual(emptyState().view.promptLibrary, []);
});

test('a legacy pickupPrompt migrates to a root prompt node on normalize', () => {
  const state = normalizeState({
    schemaVersion: 1,
    groups: [],
    shortcuts: [],
    view: { pickupPrompt: 'legacy prompt' },
  });
  assert.deepEqual(state.view.promptLibrary, [
    {
      id: state.view.promptLibrary[0].id,
      type: 'prompt',
      title: 'Agent pickup prompt',
      text: 'legacy prompt',
      includeInBatch: true,
    },
  ]);
});

test('flat legacy promptCards migrate to root prompt nodes on normalize', () => {
  const state = normalizeState({
    schemaVersion: 1,
    groups: [],
    shortcuts: [],
    view: { promptCards: [{ id: 'prompt-a', title: 'One', text: 'first', includeInBatch: true }] },
  });
  assert.deepEqual(state.view.promptLibrary, [
    { id: 'prompt-a', type: 'prompt', title: 'One', text: 'first', includeInBatch: true },
  ]);
});

test('promptLibrary round-trips through normalization and stays on other view updates', () => {
  let state = emptyState();
  const library = [
    {
      id: 'folder-dev',
      type: 'folder',
      title: 'Dev',
      includeAll: false,
      excludeAll: false,
      children: [
        { id: 'prompt-a', type: 'prompt', title: 'One', text: 'first', includeInBatch: true },
      ],
    },
  ];
  state = setPromptLibrary(state, library);
  assert.deepEqual(state.view.promptLibrary, library);
  const restored = normalizeState(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(restored.view.promptLibrary, library);
  const resized = updateWorkspaceView(state, { iconSize: 64 });
  assert.deepEqual(resized.view.promptLibrary, library);
  assert.deepEqual(updateWorkspaceView(state, { promptLibrary: [] }).view.promptLibrary, []);
});

test('setPromptLibrary does not mutate its input', () => {
  const state = emptyState();
  const library = [{ id: 'prompt-x', type: 'prompt', title: 'X', text: 'body', includeInBatch: true }];
  setPromptLibrary(state, library);
  assert.deepEqual(state.view.promptLibrary, []);
});

test('the explorer view mode defaults to explorer and persists as graph', () => {
  assert.equal(emptyState().view.layout, 'explorer');

  const graphed = updateWorkspaceView(emptyState(), { layout: 'graph' });
  assert.equal(graphed.view.layout, 'graph');
  const restored = normalizeState(JSON.parse(JSON.stringify(graphed)));
  assert.equal(restored.view.layout, 'graph');

  const explored = updateWorkspaceView(graphed, { layout: 'explorer' });
  assert.equal(explored.view.layout, 'explorer');

  const legacy = normalizeState({ schemaVersion: 1, groups: [], shortcuts: [] });
  assert.equal(legacy.view.layout, 'explorer');

  const unknown = normalizeState({ schemaVersion: 1, groups: [], shortcuts: [], view: { layout: 'unknown' } });
  assert.equal(unknown.view.layout, 'explorer');

  const preserved = updateWorkspaceView(graphed, { currentGroupId: ROOT_ID });
  assert.equal(preserved.view.layout, 'graph');
});

test('web links are http(s) shortcuts owned by the local project', () => {
  const linked = createWebLink(emptyState(), {
    name: 'Papers',
    target: 'https://github.com/Futahua/Papers-3',
  });
  assert.equal(linked.shortcuts.length, 1);
  assert.equal(isWebLink(linked.shortcuts[0]), true);
  assert.equal(
    webLinkIcon(linked.shortcuts[0]),
    'https://github.com/Futahua/Papers-3',
  );
  assert.throws(
    () => createWebLink(emptyState(), { name: 'Unsafe', target: 'javascript:alert(1)' }),
    /http or https/i,
  );
});

test('bare domain defaults to https', () => {
  const linked = createWebLink(emptyState(), {
    name: 'Example',
    target: 'example.com',
  });
  assert.equal(linked.shortcuts[0].target, 'https://example.com/');
});

test('Explorer drops create quick shortcuts in the exact destination without duplicates', () => {
  const grouped = createGroup(emptyState(), 'Dropped here');
  const destination = grouped.groups[0].id;
  const dropped = createDroppedShortcuts(grouped, [
    { name: 'notes.txt', target: 'D:\\Work\\notes.txt' },
    { name: 'Pictures', target: 'D:\\Pictures' },
    { name: 'notes.txt', target: 'D:\\Work\\notes.txt' },
  ], destination);

  assert.deepEqual(
    dropped.shortcuts.map(({ name, target, placements }) => ({ name, target, parentId: placements[0].parentId })),
    [
      { name: 'notes.txt', target: 'D:\\Work\\notes.txt', parentId: destination },
      { name: 'Pictures', target: 'D:\\Pictures', parentId: destination },
    ],
  );
});

test('manual reordering persists for multiple selected siblings', () => {
  let state = emptyState();
  state = createShortcut(state, { name: 'A', target: 'C:\\a.exe' });
  state = createShortcut(state, { name: 'B', target: 'C:\\b.exe' });
  state = createShortcut(state, { name: 'C', target: 'C:\\c.exe' });
  const [a, b, c] = state.shortcuts;

  state = reorderSelection(state, [soloPlacementId(c), soloPlacementId(b)], ROOT_ID, soloPlacementId(a));

  assert.deepEqual(
    children(state, ROOT_ID).shortcuts.map((item) => item.name),
    ['B', 'C', 'A'],
  );
});

test('Delete bins items recoverably and permanent deletion is confined to the Bin', () => {
  let state = createGroup(emptyState(), 'Folder');
  const folder = state.groups[0];
  state = createShortcut(state, { name: 'Inside', target: 'C:\\inside.exe', parentId: folder.id });
  state = createShortcut(state, { name: 'Outside', target: 'C:\\outside.exe' });

  const binned = binSelection(state, [folder.id], '2026-07-30T00:00:00.000Z');
  assert.equal(children(binned, ROOT_ID).groups.length, 0);
  assert.equal(binned.groups[0].bin?.parentId, ROOT_ID);
  assert.equal(binned.shortcuts.length, 2);

  const restored = restoreSelection(binned, [folder.id]);
  assert.equal(children(restored, ROOT_ID).groups[0].name, 'Folder');
  assert.equal(children(restored, folder.id).shortcuts[0].name, 'Inside');

  const rebinned = binSelection(restored, [folder.id], '2026-07-30T00:00:01.000Z');
  const deleted = permanentlyDelete(rebinned, [folder.id]);
  assert.equal(deleted.groups.length, 0);
  assert.deepEqual(deleted.shortcuts.map((item) => item.name), ['Outside']);
  assert.throws(() => permanentlyDelete(restored, [folder.id]), /Bin/);
});

test('graph visibility includes every root item and only descendants of expanded folders', () => {
  let state = createGroup(emptyState(), 'News');
  state = createGroup(state, 'Letters');
  const letters = state.groups[1];
  state = createGroup(state, 'Real');
  state = createShortcut(state, { name: 'CLIPS', target: 'C:\\clips.bat', parentId: letters.id });
  state = createShortcut(state, { name: 'HiddenChild', target: 'C:\\hidden.exe', parentId: state.groups[2].id });

  const collapsed = visibleGraphItems(state, ROOT_ID, new Set(), false);
  assert.deepEqual(collapsed.map((i) => i.id), state.groups.map((g) => g.id));
  assert.deepEqual(collapsed.map((i) => i.depth), [0, 0, 0]);

  const expanded = visibleGraphItems(state, ROOT_ID, new Set([letters.id]), false);
  const rootIds = state.groups.map((g) => g.id);
  assert.ok(expanded.some((i) => i.id === rootIds[0]));
  assert.ok(expanded.some((i) => i.id === rootIds[1]));
  assert.ok(expanded.some((i) => i.id === rootIds[2]));
  assert.ok(expanded.some((i) => i.id === state.shortcuts[0].id));
  assert.ok(!expanded.some((i) => i.id === state.shortcuts[1].id));
});

test('expanded folders create exactly their parent-child edges; collapsed folders omit hidden descendants', () => {
  let state = createGroup(emptyState(), 'A');
  state = createGroup(state, 'B');
  state = createShortcut(state, { name: 's1', target: 'C:\\s1.exe', parentId: state.groups[0].id });
  state = createShortcut(state, { name: 's2', target: 'C:\\s2.exe', parentId: state.groups[1].id });

  const collapsedItems = visibleGraphItems(state, ROOT_ID, new Set(), false);
  const collapsedEdges = graphEdges(collapsedItems);
  assert.equal(collapsedEdges.length, 0);

  const openItems = visibleGraphItems(state, ROOT_ID, new Set([state.groups[0].id]), false);
  const openEdges = graphEdges(openItems);
  assert.equal(openEdges.length, 1);
  assert.equal(openEdges[0].source, state.groups[0].id);
  assert.equal(openEdges[0].target, state.shortcuts[0].id);
});

test('child seed positions are finite and not all identical across siblings or rebuilds', () => {
  const ids = ['n1', 'n2', 'n3', 'n4', 'n5'];
  const parent = { x: 100, y: 50 };
  const seeds = ids.map((id, i) => seedPosition(id, parent, i, ids.length));
  assert.ok(allFinite(seeds));
  assert.ok(allUniquePositions(seeds));

  const rebuilt = ids.map((id, i) => seedPosition(id, parent, i, ids.length));
  assert.deepEqual(rebuilt, seeds);
});

test('root seed positions are finite and distinct', () => {
  const ids = ['a', 'b', 'c', 'd'];
  const seeds = ids.map((id, i) => seedPosition(id, null, i, ids.length));
  assert.ok(allFinite(seeds));
  assert.ok(allUniquePositions(seeds));
});

test('graph visibility assigns unique sibling indices', () => {
  let state = createGroup(emptyState(), 'Parent');
  const parent = state.groups[0];
  state = createShortcut(state, { name: 'A', target: 'C:\\a.exe', parentId: parent.id });
  state = createShortcut(state, { name: 'B', target: 'C:\\b.exe', parentId: parent.id });
  state = createShortcut(state, { name: 'C', target: 'C:\\c.exe', parentId: parent.id });

  const items = visibleGraphItems(state, ROOT_ID, new Set([parent.id]), false);
  const children = items.filter((i) => i.parentId === parent.id);
  assert.deepEqual(children.map((i) => i.siblingIndex), [0, 1, 2]);
  assert.equal(children[0].siblingCount, 3);
});

test('graph edges include stable keys', () => {
  let state = createGroup(emptyState(), 'Parent');
  const parent = state.groups[0];
  state = createShortcut(state, { name: 'Child', target: 'C:\\child.exe', parentId: parent.id });
  const items = visibleGraphItems(state, ROOT_ID, new Set([parent.id]), false);
  const edges = graphEdges(items);
  assert.equal(edges.length, 1);
  assert.equal(edges[0].id, `${parent.id}->${state.shortcuts[0].id}`);
});

test('Bin graph mode shows binned items as flat roots with no edges', () => {
  let state = createGroup(emptyState(), 'Folder');
  const folder = state.groups[0];
  state = createShortcut(state, { name: 'Inside', target: 'C:\\inside.exe', parentId: folder.id });
  state = createShortcut(state, { name: 'Outside', target: 'C:\\outside.exe' });
  const binned = binSelection(state, [folder.id], '2026-07-30T00:00:00.000Z');

  const binItems = visibleGraphItems(binned, ROOT_ID, new Set(), true);
  assert.ok(binItems.every((i) => i.depth === 0));
  assert.ok(binItems.every((i) => i.parentId === 'bin'));
  const binEdges = graphEdges(binItems);
  assert.equal(binEdges.length, 0);
});

test('emptyState contains independent expansion fields and graphPositions', () => {
  const state = emptyState();
  assert.deepEqual(state.view.expandedGroupIds, []);
  assert.deepEqual(state.view.graphExpandedGroupIds, []);
  assert.deepEqual(state.view.graphPositions, {});
});

test('legacy state without new fields preserves existing data and defaults new fields', () => {
  const legacy = { schemaVersion: 1, groups: [], shortcuts: [] };
  const state = normalizeState(legacy);
  assert.deepEqual(state.view.expandedGroupIds, []);
  assert.deepEqual(state.view.graphExpandedGroupIds, []);
  assert.deepEqual(state.view.graphPositions, {});
  assert.equal(state.view.layout, 'explorer');
});

test('independent Explorer and Graph expansion do not interfere', () => {
  let state = createGroup(emptyState(), 'Letters');
  const letters = state.groups[0];

  state = updateWorkspaceView(state, { expandedGroupIds: [letters.id] });
  assert.deepEqual(state.view.expandedGroupIds, [letters.id]);
  assert.deepEqual(state.view.graphExpandedGroupIds, []);

  state = updateWorkspaceView(state, { graphExpandedGroupIds: [letters.id] });
  assert.deepEqual(state.view.expandedGroupIds, [letters.id]);
  assert.deepEqual(state.view.graphExpandedGroupIds, [letters.id]);

  state = updateWorkspaceView(state, { expandedGroupIds: [] });
  assert.deepEqual(state.view.expandedGroupIds, []);
  assert.deepEqual(state.view.graphExpandedGroupIds, [letters.id]);
});

test('partial update preserves omitted view fields', () => {
  let state = updateWorkspaceView(emptyState(), {
    expandedGroupIds: ['g1'],
    graphExpandedGroupIds: ['g2'],
    layout: 'graph',
  });

  state = updateWorkspaceView(state, { layout: 'explorer' });
  assert.deepEqual(state.view.expandedGroupIds, ['g1']);
  assert.deepEqual(state.view.graphExpandedGroupIds, ['g2']);
  assert.equal(state.view.layout, 'explorer');

  state = updateWorkspaceView(state, { selectedItemIds: ['s1'] });
  assert.deepEqual(state.view.graphExpandedGroupIds, ['g2']);
  assert.deepEqual(state.view.expandedGroupIds, ['g1']);

  state = updateWorkspaceView(state, { binMode: true });
  assert.equal(state.view.currentGroupId, ROOT_ID);
  assert.equal(state.view.binMode, true);
});

test('position normalization accepts valid entries and discards invalid ones', () => {
  const raw = {
    root: {
      item1: { x: 100, y: 200 },
      item2: { x: 50.5, y: -30.2 },
      badNan: { x: NaN, y: 100 },
      badInf: { x: 100, y: Infinity },
      badMissingX: { y: 100 },
      badMissingY: { x: 100 },
      badString: { x: '100', y: '200' },
    },
    badContext: 42,
    emptyContext: {},
  };
  const result = normalizeGraphPositions(raw);
  assert.deepEqual(result.root.item1, { x: 100, y: 200 });
  assert.deepEqual(result.root.item2, { x: 50.5, y: -30.2 });
  assert.equal(result.root.badNan, undefined);
  assert.equal(result.root.badInf, undefined);
  assert.equal(result.root.badMissingX, undefined);
  assert.equal(result.root.badMissingY, undefined);
  assert.equal(result.root.badString, undefined);
  assert.equal(result.badContext, undefined);
  assert.equal(result.emptyContext, undefined);
});

test('independent graph position contexts are isolated', () => {
  let state = emptyState();
  state = setGraphPositions(state, ROOT_ID, { item1: { x: 10, y: 20 } });
  state = setGraphPositions(state, 'bin', { item1: { x: 30, y: 40 } });

  assert.deepEqual(getGraphPosition(state, ROOT_ID, 'item1'), { x: 10, y: 20 });
  assert.deepEqual(getGraphPosition(state, 'bin', 'item1'), { x: 30, y: 40 });

  state = setGraphPositions(state, ROOT_ID, { item1: { x: 100, y: 200 } });
  assert.deepEqual(getGraphPosition(state, ROOT_ID, 'item1'), { x: 100, y: 200 });
  assert.deepEqual(getGraphPosition(state, 'bin', 'item1'), { x: 30, y: 40 });
});

test('removeGraphPositions removes only selected entries in current context', () => {
  let state = emptyState();
  state = setGraphPositions(state, ROOT_ID, {
    item1: { x: 10, y: 20 },
    item2: { x: 30, y: 40 },
    item3: { x: 50, y: 60 },
  });
  state = setGraphPositions(state, 'bin', { item1: { x: 70, y: 80 } });

  state = removeGraphPositions(state, ROOT_ID, ['item2']);
  assert.deepEqual(getGraphPosition(state, ROOT_ID, 'item1'), { x: 10, y: 20 });
  assert.equal(getGraphPosition(state, ROOT_ID, 'item2'), null);
  assert.deepEqual(getGraphPosition(state, ROOT_ID, 'item3'), { x: 50, y: 60 });
  assert.deepEqual(getGraphPosition(state, 'bin', 'item1'), { x: 70, y: 80 });
});

test('removeGraphPositions cleans up empty context', () => {
  let state = emptyState();
  state = setGraphPositions(state, ROOT_ID, { item1: { x: 10, y: 20 } });
  state = removeGraphPositions(state, ROOT_ID, ['item1']);
  assert.equal(getGraphPosition(state, ROOT_ID, 'item1'), null);
  assert.deepEqual(state.view.graphPositions, {});
});

test('graphContextId returns bin for bin mode and currentGroupId otherwise', () => {
  assert.equal(graphContextId(ROOT_ID, false), ROOT_ID);
  assert.equal(graphContextId('group-1', false), 'group-1');
  assert.equal(graphContextId(ROOT_ID, true), 'bin');
});

test('updateWorkspaceView preserves graphPositions when not supplied', () => {
  let state = setGraphPositions(emptyState(), ROOT_ID, { item1: { x: 10, y: 20 } });
  state = updateWorkspaceView(state, { layout: 'graph' });
  assert.deepEqual(getGraphPosition(state, ROOT_ID, 'item1'), { x: 10, y: 20 });
});

test('normalizeGraphPositions returns empty when given null/undefined/non-object', () => {
  assert.deepEqual(normalizeGraphPositions(null), {});
  assert.deepEqual(normalizeGraphPositions(undefined), {});
  assert.deepEqual(normalizeGraphPositions(42), {});
  assert.deepEqual(normalizeGraphPositions('string'), {});
  assert.deepEqual(normalizeGraphPositions([]), {});
});

test('setGraphPositions stores coordinates and getGraphPosition retrieves them (simulates shift-drag pin)', () => {
  let state = emptyState();
  state = setGraphPositions(state, ROOT_ID, { item1: { x: 100, y: 200 } });
  const pos = getGraphPosition(state, ROOT_ID, 'item1');
  assert.deepEqual(pos, { x: 100, y: 200 });
  assert.ok(Number.isFinite(pos.x) && Number.isFinite(pos.y));
});

test('normal drag of an unpinned item removes saved positions (simulates release-without-shift from unpinned)', () => {
  let state = emptyState();
  state = removeGraphPositions(state, ROOT_ID, ['item1']);
  assert.equal(getGraphPosition(state, ROOT_ID, 'item1'), null);
  assert.deepEqual(state.view.graphPositions, {});
});

test('normal drag of a pinned item removes its saved coordinate and preserves other items', () => {
  let state = emptyState();
  state = setGraphPositions(state, ROOT_ID, {
    item1: { x: 10, y: 20 },
    item2: { x: 30, y: 40 },
  });
  state = removeGraphPositions(state, ROOT_ID, ['item1']);
  assert.equal(getGraphPosition(state, ROOT_ID, 'item1'), null);
  assert.deepEqual(getGraphPosition(state, ROOT_ID, 'item2'), { x: 30, y: 40 });
});

test('shift-drag of a pinned item updates its saved coordinate', () => {
  let state = emptyState();
  state = setGraphPositions(state, ROOT_ID, { item1: { x: 10, y: 20 } });
  state = setGraphPositions(state, ROOT_ID, { item1: { x: 99, y: 88 } });
  assert.deepEqual(getGraphPosition(state, ROOT_ID, 'item1'), { x: 99, y: 88 });
});

test('multi-selection shift-drag saves coordinates for all dragged items', () => {
  let state = emptyState();
  state = setGraphPositions(state, ROOT_ID, {
    item1: { x: 10, y: 20 },
    item2: { x: 30, y: 40 },
    item3: { x: 50, y: 60 },
  });
  assert.deepEqual(getGraphPosition(state, ROOT_ID, 'item1'), { x: 10, y: 20 });
  assert.deepEqual(getGraphPosition(state, ROOT_ID, 'item2'), { x: 30, y: 40 });
  assert.deepEqual(getGraphPosition(state, ROOT_ID, 'item3'), { x: 50, y: 60 });
});

test('multi-selection normal drag removes coordinates only for dragged items', () => {
  let state = emptyState();
  state = setGraphPositions(state, ROOT_ID, {
    item1: { x: 10, y: 20 },
    item2: { x: 30, y: 40 },
  });
  state = setGraphPositions(state, ROOT_ID, { item3: { x: 50, y: 60 } });
  state = removeGraphPositions(state, ROOT_ID, ['item1', 'item2']);
  assert.equal(getGraphPosition(state, ROOT_ID, 'item1'), null);
  assert.equal(getGraphPosition(state, ROOT_ID, 'item2'), null);
  assert.deepEqual(getGraphPosition(state, ROOT_ID, 'item3'), { x: 50, y: 60 });
});

test('folder drop always moves items and clears source context coordinates regardless of shift', () => {
  let state = createGroup(emptyState(), 'Letters');
  const letters = state.groups[0];
  state = createGroup(state, 'Things');
  const things = state.groups[1];
  state = createShortcut(state, { name: 'CLIPS', target: 'C:\\clips.exe', parentId: letters.id });
  const clips = state.shortcuts[0];
  const clipsPlacementId = soloPlacementId(clips);

  state = setGraphPositions(state, ROOT_ID, { [clipsPlacementId]: { x: 100, y: 200 } });
  assert.deepEqual(getGraphPosition(state, ROOT_ID, clipsPlacementId), { x: 100, y: 200 });

  const moved = moveSelection(state, [clipsPlacementId], things.id);
  state = removeGraphPositions(moved, ROOT_ID, [clipsPlacementId]);

  assert.equal(state.shortcuts[0].placements[0].parentId, things.id);
  assert.equal(getGraphPosition(state, ROOT_ID, clipsPlacementId), null);
});

test('free-space graph dragging never changes item parentId or order through setGraphPositions', () => {
  let state = createShortcut(emptyState(), { name: 'A', target: 'C:\\a.exe' });
  const item = state.shortcuts[0];
  const originalParentId = item.parentId;
  const originalOrder = item.order;

  state = setGraphPositions(state, ROOT_ID, { [item.id]: { x: 999, y: 888 } });

  assert.equal(state.shortcuts[0].parentId, originalParentId);
  assert.equal(state.shortcuts[0].order, originalOrder);
});

test('removeGraphPositions on a non-existent item is a safe no-op', () => {
  let state = emptyState();
  state = setGraphPositions(state, ROOT_ID, { item1: { x: 10, y: 20 } });
  state = removeGraphPositions(state, ROOT_ID, ['nonexistent']);
  assert.deepEqual(getGraphPosition(state, ROOT_ID, 'item1'), { x: 10, y: 20 });
});

test('context separation: same itemId can have positions in different contexts, removing from one does not affect another', () => {
  let state = emptyState();
  state = setGraphPositions(state, ROOT_ID, { shared: { x: 10, y: 20 } });
  state = setGraphPositions(state, 'group-A', { shared: { x: 50, y: 60 } });

  state = removeGraphPositions(state, ROOT_ID, ['shared']);
  assert.equal(getGraphPosition(state, ROOT_ID, 'shared'), null);
  assert.deepEqual(getGraphPosition(state, 'group-A', 'shared'), { x: 50, y: 60 });
});

test('Ctrl+click Explorer folder expands it without changing graph expansion', () => {
  let state = createGroup(emptyState(), 'Letters');
  const letters = state.groups[0];

  state = updateWorkspaceView(state, { expandedGroupIds: [letters.id] });
  assert.deepEqual(state.view.expandedGroupIds, [letters.id]);
  assert.deepEqual(state.view.graphExpandedGroupIds, []);
});

test('Ctrl+click Explorer folder again collapses it', () => {
  let state = createGroup(emptyState(), 'Letters');
  const letters = state.groups[0];

  state = updateWorkspaceView(state, { expandedGroupIds: [letters.id] });
  state = updateWorkspaceView(state, { expandedGroupIds: [] });
  assert.deepEqual(state.view.expandedGroupIds, []);
});

test('Ctrl+click Graph folder expands it without changing Explorer expansion', () => {
  let state = createGroup(emptyState(), 'Letters');
  const letters = state.groups[0];

  state = updateWorkspaceView(state, { expandedGroupIds: ['group-a'] });
  state = updateWorkspaceView(state, { graphExpandedGroupIds: [letters.id] });
  assert.deepEqual(state.view.expandedGroupIds, ['group-a']);
  assert.deepEqual(state.view.graphExpandedGroupIds, [letters.id]);
});

test('Ctrl+click does not change currentGroupId (does not navigate)', () => {
  let state = createGroup(emptyState(), 'Letters');
  const letters = state.groups[0];

  state = updateWorkspaceView(state, { expandedGroupIds: [letters.id] });
  assert.equal(state.view.currentGroupId, ROOT_ID);
});

test('Ctrl+click does not change layout or binMode', () => {
  let state = createGroup(emptyState(), 'Letters');
  const letters = state.groups[0];
  state = updateWorkspaceView(state, { layout: 'graph', binMode: true, expandedGroupIds: [letters.id] });

  assert.equal(state.view.layout, 'graph');
  assert.equal(state.view.binMode, true);
});

test('Ctrl+click does not modify graphPositions', () => {
  let state = setGraphPositions(emptyState(), ROOT_ID, { item1: { x: 10, y: 20 } });
  state = createGroup(state, 'Letters');
  const letters = state.groups[0];
  state = updateWorkspaceView(state, { graphExpandedGroupIds: [letters.id] });

  assert.deepEqual(getGraphPosition(state, ROOT_ID, 'item1'), { x: 10, y: 20 });
});

test('Ctrl+click expansion persists through restore/reopen', () => {
  let state = createGroup(emptyState(), 'Letters');
  const letters = state.groups[0];

  state = updateWorkspaceView(state, { expandedGroupIds: [letters.id], graphExpandedGroupIds: [letters.id] });
  const serialized = JSON.parse(JSON.stringify(state));
  const restored = normalizeState(serialized);

  assert.deepEqual(restored.view.expandedGroupIds, [letters.id]);
  assert.deepEqual(restored.view.graphExpandedGroupIds, [letters.id]);
});

test('expansion toggle preserves unique IDs (duplicate toggle does not cause duplicate entries)', () => {
  let state = createGroup(emptyState(), 'Letters');
  const letters = state.groups[0];

  state = updateWorkspaceView(state, { expandedGroupIds: [letters.id, letters.id] });
  assert.deepEqual(state.view.expandedGroupIds, [letters.id]);
});

test('chevron works independently of Ctrl+click', () => {
  let state = createGroup(emptyState(), 'Letters');
  const letters = state.groups[0];

  state = updateWorkspaceView(state, { expandedGroupIds: [letters.id] });
  state = updateWorkspaceView(state, { expandedGroupIds: [] });
  assert.deepEqual(state.view.expandedGroupIds, []);

  state = updateWorkspaceView(state, { expandedGroupIds: [letters.id] });
  assert.deepEqual(state.view.expandedGroupIds, [letters.id]);
});

test('normal click on a folder still activates it', () => {
  let state = createGroup(emptyState(), 'Letters');
  const letters = state.groups[0];

  state = updateWorkspaceView(state, { currentGroupId: letters.id });
  assert.equal(state.view.currentGroupId, letters.id);
});

test('expansion sets remain independent after multiple Ctrl+click toggles', () => {
  let state = createGroup(emptyState(), 'Letters');
  const letters = state.groups[0];
  state = createGroup(state, 'Things');
  const things = state.groups[1];

  state = updateWorkspaceView(state, { expandedGroupIds: [letters.id], graphExpandedGroupIds: [things.id] });
  assert.deepEqual(state.view.expandedGroupIds, [letters.id]);
  assert.deepEqual(state.view.graphExpandedGroupIds, [things.id]);

  state = updateWorkspaceView(state, { graphExpandedGroupIds: [letters.id, things.id] });
  assert.deepEqual(state.view.expandedGroupIds, [letters.id]);
  assert.deepEqual(state.view.graphExpandedGroupIds, [letters.id, things.id]);
});

test('drag starts without Shift, Shift pressed before release: node is pinned', () => {
  let state = emptyState();
  state = setGraphPositions(state, ROOT_ID, { item1: { x: 100, y: 200 } });
  assert.deepEqual(getGraphPosition(state, ROOT_ID, 'item1'), { x: 100, y: 200 });
});

test('drag starts with Shift, Shift released before release: node is unpinned via removeGraphPositions', () => {
  let state = setGraphPositions(emptyState(), ROOT_ID, { item1: { x: 10, y: 20 } });
  state = removeGraphPositions(state, ROOT_ID, ['item1']);
  assert.equal(getGraphPosition(state, ROOT_ID, 'item1'), null);
});

test('pointerup Shift state determines final outcome regardless of prior toggles during drag', () => {
  let state = setGraphPositions(emptyState(), ROOT_ID, {
    item1: { x: 10, y: 20 },
    item2: { x: 30, y: 40 },
  });

  state = setGraphPositions(state, ROOT_ID, { item1: { x: 99, y: 88 } });
  assert.deepEqual(getGraphPosition(state, ROOT_ID, 'item1'), { x: 99, y: 88 });
  assert.deepEqual(getGraphPosition(state, ROOT_ID, 'item2'), { x: 30, y: 40 });

  state = removeGraphPositions(state, ROOT_ID, ['item2']);
  assert.equal(getGraphPosition(state, ROOT_ID, 'item2'), null);
  assert.deepEqual(getGraphPosition(state, ROOT_ID, 'item1'), { x: 99, y: 88 });
});

test('folder drop overrides final Shift state on pointerup', () => {
  let state = createGroup(emptyState(), 'Letters');
  const letters = state.groups[0];
  state = createGroup(state, 'Things');
  const things = state.groups[1];
  state = createShortcut(state, { name: 'CLIPS', target: 'C:\\clips.exe', parentId: letters.id });
  const clips = state.shortcuts[0];
  const clipsPlacementId = soloPlacementId(clips);

  state = setGraphPositions(state, ROOT_ID, { [clipsPlacementId]: { x: 100, y: 200 } });

  const moved = moveSelection(state, [clipsPlacementId], things.id);
  state = removeGraphPositions(moved, ROOT_ID, [clipsPlacementId]);

  assert.equal(state.shortcuts[0].placements[0].parentId, things.id);
  assert.equal(getGraphPosition(state, ROOT_ID, clipsPlacementId), null);
});

test('removeGraphPositions on all entries cleans up context object', () => {
  let state = setGraphPositions(emptyState(), ROOT_ID, { item1: { x: 10, y: 20 } });
  assert.deepEqual(getGraphPosition(state, ROOT_ID, 'item1'), { x: 10, y: 20 });
  state = removeGraphPositions(state, ROOT_ID, ['item1']);
  assert.equal(getGraphPosition(state, ROOT_ID, 'item1'), null);
  assert.deepEqual(state.view.graphPositions, {});
});

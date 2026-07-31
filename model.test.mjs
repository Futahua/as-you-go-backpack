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
  updateWorkspaceView,
  createWebLink,
  isWebLink,
  webLinkIcon,
  createDroppedShortcuts,
} from './model.mjs';

import {
  visibleGraphItems,
  graphEdges,
  seedPosition,
  allFinite,
  allUniquePositions,
} from './public/graph-model-20260730b.js';

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
  state = moveSelection(state, [one.id, state.shortcuts[0].id, state.shortcuts[1].id], two.id);
  assert.equal(state.groups.find((item) => item.id === one.id).parentId, two.id);
  assert.deepEqual(state.shortcuts.map((item) => item.parentId), [one.id, one.id]);
});

test('copy preserves the source tree and creates new identities', () => {
  let state = createGroup(emptyState(), 'Source');
  const source = state.groups[0];
  state = createGroup(state, 'Destination');
  const destination = state.groups[1];
  state = createShortcut(state, { name: 'A', target: 'C:\\a.bat', parentId: source.id });
  const copied = copySelection(state, [source.id], destination.id);
  assert.equal(copied.groups.length, 3);
  assert.equal(copied.shortcuts.length, 2);
  assert.notEqual(copied.groups[2].id, source.id);
  assert.equal(copied.groups[2].parentId, destination.id);
});

test('a selected shortcut can be copied from a nested expanded folder', () => {
  let state = createGroup(emptyState(), 'Source');
  const source = state.groups[0];
  state = createGroup(state, 'Destination');
  const destination = state.groups[1];
  state = createShortcut(state, { name: 'Nested', target: 'C:\\nested.exe', parentId: source.id });

  const copied = copySelection(state, [state.shortcuts[0].id], destination.id);

  assert.equal(children(copied, destination.id).shortcuts[0].name, 'Nested');
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
  assert.deepEqual(state.shortcuts.map((item) => item.order), [1, 2]);
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
    selectedItemIds: [state.shortcuts[0].id],
    binMode: false,
    layout: 'explorer',
  });
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
    'https://github.com/favicon.ico',
  );
  assert.throws(
    () => createWebLink(emptyState(), { name: 'Unsafe', target: 'javascript:alert(1)' }),
    /http or https/i,
  );
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
    dropped.shortcuts.map(({ name, target, parentId }) => ({ name, target, parentId })),
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

  state = reorderSelection(state, [c.id, b.id], ROOT_ID, a.id);

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

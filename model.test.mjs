import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ROOT_ID,
  children,
  copySelection,
  createGroup,
  createShortcut,
  emptyState,
  moveSelection,
  renameItem,
} from './model.mjs';

test('groups and shortcuts form a nested explorer tree', () => {
  let state = createGroup(emptyState(), 'Projects');
  const projects = state.groups[0];
  state = createGroup(state, '2026', projects.id);
  const year = state.groups[1];
  state = createShortcut(state, { name: 'CLIPS', target: 'D:\\Programs\\CLIPS.bat', parentId: year.id });
  assert.equal(children(state, year.id).shortcuts[0].name, 'CLIPS');
  assert.equal(children(state, ROOT_ID).groups[0].name, 'Projects');
});

test('multiple selected items move together between groups', () => {
  let state = createGroup(emptyState(), 'One');
  state = createGroup(state, 'Two');
  const [one, two] = state.groups;
  state = createShortcut(state, { name: 'A', target: 'C:\\a.bat', parentId: one.id });
  state = createShortcut(state, { name: 'B', target: 'C:\\b.bat', parentId: one.id });
  state = moveSelection(state, [one.id, state.shortcuts[0].id, state.shortcuts[1].id], two.id);
  assert.equal(state.groups.find((item) => item.id === one.id).parentId, two.id);
  assert.deepEqual(state.shortcuts.map((item) => item.parentId), [two.id, two.id]);
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

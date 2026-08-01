import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createItemSet,
  normalizeItemSets,
  setsContaining,
  isSetless,
  pickedSetId,
  selectAllScope,
  inverseScope,
  findItemSet,
  addItemSet,
  removeItemSet,
  setMembership,
  forgetItems,
  canDropInsideRegions,
  droppableItems,
} from './public/sets-model.js';

const set = (id, memberIds, title = 'S') => ({ id, type: 'set', title, memberIds });

test('createItemSet keeps first-seen order and drops duplicates', () => {
  const created = createItemSet(['b', 'a', 'b', '', null, 'c']);
  assert.deepEqual(created.memberIds, ['b', 'a', 'c']);
  assert.equal(created.type, 'set');
  assert.ok(created.id, 'gets an id');
});

test('createItemSet ids are unique across rapid creation', () => {
  const ids = new Set(Array.from({ length: 50 }, () => createItemSet(['a']).id));
  assert.equal(ids.size, 50, 'no collisions even when created in the same millisecond');
});

test('normalize drops malformed records and duplicate ids', () => {
  const sets = normalizeItemSets([
    set('a', ['i1']),
    'junk',
    null,
    { id: '', memberIds: ['i2'] },
    set('a', ['i3']),
  ]);
  assert.equal(sets.length, 1);
  assert.deepEqual(sets[0].memberIds, ['i1'], 'first occurrence wins');
});

test('normalize prunes members that no longer exist', () => {
  const sets = normalizeItemSets([set('a', ['i1', 'gone', 'i2'])], ['i1', 'i2']);
  assert.deepEqual(sets[0].memberIds, ['i1', 'i2'], 'deleted items leave no dangling members');
});

test('normalize refuses nested sets: a member naming a set is dropped', () => {
  const sets = normalizeItemSets([
    set('outer', ['i1', 'inner']),
    set('inner', ['i2']),
  ]);
  assert.deepEqual(sets[0].memberIds, ['i1'], 'sets are flat, never nested');
  assert.deepEqual(sets[1].memberIds, ['i2']);
});

test('an item can belong to several overlapping sets', () => {
  const sets = [set('a', ['shared', 'i1']), set('b', ['shared', 'i2'])];
  assert.deepEqual(setsContaining(sets, 'shared').map((s) => s.id), ['a', 'b']);
  assert.equal(isSetless(sets, 'shared'), false);
  assert.equal(isSetless(sets, 'loose'), true);
});

test('the picked set comes from the last clicked item', () => {
  const sets = [set('a', ['i1']), set('b', ['i2'])];
  assert.equal(pickedSetId(sets, 'i2'), 'b');
  assert.equal(pickedSetId(sets, 'i1'), 'a');
  assert.equal(pickedSetId(sets, 'loose'), null, 'a setless item picks no set');
  assert.equal(pickedSetId(sets, null), null, 'nothing clicked picks no set');
});

test('Ctrl+A inside a picked set selects only that set members', () => {
  const sets = [set('a', ['i1', 'i2']), set('b', ['i3'])];
  const visible = ['i1', 'i2', 'i3', 'loose'];
  assert.deepEqual(selectAllScope(sets, visible, 'i1'), ['i1', 'i2']);
  assert.deepEqual(selectAllScope(sets, visible, 'i3'), ['i3']);
});

test('Ctrl+A outside every set selects only setless items', () => {
  const sets = [set('a', ['i1', 'i2'])];
  const visible = ['i1', 'i2', 'loose1', 'loose2'];
  assert.deepEqual(
    selectAllScope(sets, visible, 'loose1'), ['loose1', 'loose2'],
    'select-all outside a set never reaches inside one',
  );
  assert.deepEqual(selectAllScope(sets, visible, null), ['loose1', 'loose2']);
});

test('Ctrl+A never selects something off screen', () => {
  const sets = [set('a', ['i1', 'offscreen'])];
  assert.deepEqual(
    selectAllScope(sets, ['i1'], 'i1'), ['i1'],
    'a member not among the candidates is not selected',
  );
});

test('the inverse scope is the select-all scope minus the selection', () => {
  const sets = [set('a', ['i1', 'i2', 'i3'])];
  const visible = ['i1', 'i2', 'i3', 'loose'];
  // Select all in the set, deselect i2, then act on the rest.
  assert.deepEqual(inverseScope(sets, visible, 'i1', ['i2']), ['i1', 'i3']);
  assert.deepEqual(inverseScope(sets, visible, 'i1', []), ['i1', 'i2', 'i3']);
  assert.deepEqual(inverseScope(sets, visible, 'i1', ['i1', 'i2', 'i3']), []);
});

test('the inverse scope outside a set covers setless items only', () => {
  const sets = [set('a', ['i1'])];
  assert.deepEqual(
    inverseScope(sets, ['i1', 'l1', 'l2'], 'l1', ['l1']), ['l2'],
    'set members stay out of the inverse when no set is picked',
  );
});

test('addItemSet ignores an empty grouping', () => {
  const sets = [set('a', ['i1'])];
  assert.equal(addItemSet(sets, []), sets, 'same array, so no history entry');
  assert.equal(addItemSet(sets, ['i2']).length, 2);
});

test('sets may overlap: grouping shared items does not remove them from others', () => {
  let sets = [set('a', ['i1', 'i2'])];
  sets = addItemSet(sets, ['i2', 'i3'], { title: 'B' });
  assert.deepEqual(findItemSet(sets, 'a').memberIds, ['i1', 'i2'], 'original untouched');
  assert.deepEqual(sets[1].memberIds, ['i2', 'i3'], 'i2 is now in both');
});

test('setMembership shares items between chosen sets', () => {
  const sets = [set('a', ['i1', 'i2']), set('b', ['i3']), set('c', ['i4'])];
  const next = setMembership(sets, ['i1'], ['b', 'c']);
  assert.deepEqual(findItemSet(next, 'a').memberIds, ['i2'], 'left the old set');
  assert.ok(findItemSet(next, 'b').memberIds.includes('i1'));
  assert.ok(findItemSet(next, 'c').memberIds.includes('i1'));
});

test('setMembership with no sets regresses items to setless', () => {
  const sets = [set('a', ['i1', 'i2'])];
  const next = setMembership(sets, ['i1'], []);
  assert.equal(isSetless(next, 'i1'), true);
  assert.ok(findItemSet(next, 'a').memberIds.includes('i2'), 'others stay');
});

test('a set emptied by a membership change is dropped', () => {
  const sets = [set('a', ['i1']), set('b', ['i2'])];
  const next = setMembership(sets, ['i1'], []);
  assert.equal(findItemSet(next, 'a'), null, 'an outline with nothing to enclose is removed');
  assert.equal(next.length, 1);
});

test('setMembership returns the same array when nothing changes', () => {
  const sets = [set('a', ['i1'])];
  assert.equal(setMembership(sets, ['i1'], ['a']), sets, 'no-op is identity');
  assert.equal(setMembership(sets, [], ['a']), sets, 'no items is identity');
});

test('setless items can be grouped with Ctrl+G the same way', () => {
  const sets = [set('a', ['i1'])];
  const next = setMembership(sets, ['loose'], ['a']);
  assert.deepEqual(findItemSet(next, 'a').memberIds, ['i1', 'loose']);
});

test('forgetItems removes a deleted item from every set', () => {
  const sets = [set('a', ['i1', 'shared']), set('b', ['shared'])];
  const next = forgetItems(sets, ['shared']);
  assert.deepEqual(findItemSet(next, 'a').memberIds, ['i1']);
  assert.equal(findItemSet(next, 'b'), null, 'set left empty is dropped');
});

test('removeItemSet drops one set and is identity when absent', () => {
  const sets = [set('a', ['i1'])];
  assert.equal(removeItemSet(sets, 'missing'), sets);
  assert.equal(removeItemSet(sets, 'a').length, 0);
});

test('a member may move freely inside its own set', () => {
  const sets = [set('a', ['i1'])];
  assert.equal(canDropInsideRegions(sets, 'i1', ['a']), true);
});

test('a non-member may not be dropped inside a set', () => {
  const sets = [set('a', ['i1'])];
  assert.equal(canDropInsideRegions(sets, 'outsider', ['a']), false);
});

test('a shared item may move anywhere in the union of its sets', () => {
  const sets = [set('a', ['shared']), set('b', ['shared'])];
  assert.equal(canDropInsideRegions(sets, 'shared', ['a']), true);
  assert.equal(canDropInsideRegions(sets, 'shared', ['b']), true);
  assert.equal(canDropInsideRegions(sets, 'shared', ['a', 'b']), true, 'and the intersection');
});

test('an item in one set may not enter the part of another it does not belong to', () => {
  const sets = [set('a', ['i1']), set('b', ['i2'])];
  assert.equal(canDropInsideRegions(sets, 'i1', ['b']), false);
  assert.equal(canDropInsideRegions(sets, 'i1', ['a', 'b']), false, 'overlap needs both');
});

test('open space outside every set accepts anything', () => {
  const sets = [set('a', ['i1'])];
  assert.equal(canDropInsideRegions(sets, 'outsider', []), true);
  assert.equal(canDropInsideRegions(sets, 'i1', []), true, 'a member may leave its set region');
});

test('droppableItems filters a multi-item drag instead of vetoing it', () => {
  const sets = [set('a', ['i1', 'i2'])];
  assert.deepEqual(
    droppableItems(sets, ['i1', 'i2', 'outsider'], ['a']), ['i1', 'i2'],
    'one blocked item does not block the rest',
  );
});

// ===========================================================================
// Persistence: sets live in view state and survive a normalize round trip.
// ===========================================================================

test('sets round-trip through normalizeState', async () => {
  const { normalizeState, setItemSets, emptyState, createGroup } =
    await import('./public/workspace-model-20260730b.js');
  let state = emptyState();
  state = createGroup(state, { name: 'A' });
  state = createGroup(state, { name: 'B' });
  const [g1, g2] = state.groups.map((group) => group.id);

  state = setItemSets(state, [set('s1', [g1, g2], 'Mine')]);
  assert.deepEqual(state.view.itemSets[0].memberIds, [g1, g2]);

  const restored = normalizeState(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(restored.view.itemSets, state.view.itemSets, 'survives a save/load cycle');
});

test('a set member deleted from the workspace is pruned on normalize', async () => {
  const { normalizeState, setItemSets, emptyState, createGroup } =
    await import('./public/workspace-model-20260730b.js');
  let state = emptyState();
  state = createGroup(state, { name: 'A' });
  const [g1] = state.groups.map((group) => group.id);
  state = setItemSets(state, [set('s1', [g1, 'ghost-item'], 'Mine')]);
  assert.deepEqual(
    state.view.itemSets[0].memberIds, [g1],
    'setItemSets refuses a member that is not a real item',
  );

  const restored = normalizeState(JSON.parse(JSON.stringify({
    ...state,
    view: { ...state.view, itemSets: [set('s1', [g1, 'ghost-item'], 'Mine')] },
  })));
  assert.deepEqual(restored.view.itemSets[0].memberIds, [g1], 'and normalize prunes it on load');
});

test('a state with no itemSets key normalizes to an empty list', async () => {
  const { normalizeState } = await import('./public/workspace-model-20260730b.js');
  const restored = normalizeState({ groups: [], shortcuts: [], view: {} });
  assert.deepEqual(restored.view.itemSets, [], 'older saved states migrate untouched');
});

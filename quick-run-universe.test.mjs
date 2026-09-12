// The searchable universe: what Quick Run may show, and what it may never show.
//
// Section 2.1 fixes the sources - active folders, active shortcut placements, layout members - and
// section 6 lists the things v1 must not search: whole window layouts, prompts, bin contents including
// items under a binned folder and binned layouts with their members, and Sets. Folders and placements
// arrive through the model's itemsIn, which already applies the model's active rule; layout members are
// reached through their layout, so that loop has to ask the same rule explicitly. These tests hold both
// halves: the exclusions, and the fact that the exclusions are not vacuous.
import test from 'node:test';
import assert from 'node:assert/strict';
import { quickRunRows } from './public/app/quick-run/quick-run-search.js';

const state = {
  groups: [
    { id: 'root', parentId: null, name: 'Workspace' },
    { id: 'g-1', parentId: 'root', name: 'Active folder' },
    { id: 'g-bin', parentId: 'root', name: 'Binned folder', bin: { at: '2026-09-01T00:00:00+07:00' } },
    { id: 'g-under-bin', parentId: 'g-bin', name: 'Inside the bin' },
  ],
  shortcuts: [
    {
      id: 's-1',
      name: 'Editor',
      target: 'C:/Program Files/Editor/editor.exe',
      placements: [{ id: 'p-1', parentId: 'g-1', order: 1 }],
    },
    {
      id: 's-2',
      name: 'Docs',
      target: 'https://example.com/docs',
      placements: [{ id: 'p-2', parentId: 'g-1', order: 2 }],
    },
    {
      id: 's-bin',
      name: 'Binned shortcut',
      target: 'C:/binned.exe',
      placements: [
        { id: 'p-bin', parentId: 'g-1', order: 3, bin: { at: '2026-09-01T00:00:00+07:00' } },
        { id: 'p-in-bin', parentId: 'g-bin', order: 4 },
      ],
    },
  ],
  windowLayouts: [
    {
      id: 'l-1',
      parentId: 'g-1',
      name: 'Focus',
      arrangement: { members: [{ id: 'm-1', descriptor: { title: 'Chrome' } }] },
    },
    {
      id: 'l-bin',
      parentId: 'g-1',
      name: 'Binned layout',
      bin: { at: '2026-09-01T00:00:00+07:00' },
      arrangement: { members: [{ id: 'm-2', descriptor: { title: 'Binned window' } }] },
    },
    {
      id: 'l-under-bin',
      parentId: 'g-bin',
      name: 'Layout under the bin',
      arrangement: { members: [{ id: 'm-3', descriptor: { title: 'Hidden window' } }] },
    },
  ],
  // Not sources at all, and present here so their absence is asserted rather than assumed.
  promptLibrary: [{ id: 'pr-1', name: 'Binned prompt' }],
  sets: [{ id: 'set-1', name: 'A set' }],
};

const rows = quickRunRows(state);
const names = rows.map((row) => row.name);
const keys = rows.map((row) => row.resultKey);

test('the active tree is searched: folders, placements and layout members (section 2.1)', () => {
  assert.deepEqual([...names].sort(), ['Active folder', 'Chrome', 'Docs', 'Editor']);
  assert.deepEqual(
    [...new Set(rows.map((row) => row.type))].sort(),
    ['folder', 'layout-item', 'link', 'shortcut'],
  );
  assert.deepEqual(keys.sort(), ['folder:g-1', 'layout-member:l-1:m-1', 'link:p-2', 'shortcut:p-1']);
});

test('the bin is not searched: a binned folder takes its descendants with it (section 6)', () => {
  assert.equal(keys.includes('folder:g-bin'), false);
  assert.equal(keys.includes('folder:g-under-bin'), false);
  assert.equal(names.includes('Inside the bin'), false);
  assert.equal(keys.includes('shortcut:p-in-bin'), false, 'a placement under a binned folder is gone with it');
});

test('a binned placement is not searched, and neither is its shortcut (section 6)', () => {
  assert.equal(keys.includes('shortcut:p-bin'), false);
  assert.equal(names.includes('Binned shortcut'), false);
});

test('a binned layout takes its members with it, however it was binned (section 6)', () => {
  assert.equal(keys.includes('layout-member:l-bin:m-2'), false);
  assert.equal(names.includes('Binned window'), false);
  assert.equal(
    keys.includes('layout-member:l-under-bin:m-3'),
    false,
    'a layout under a binned folder is out of the universe just as a binned one is',
  );
  assert.equal(names.includes('Hidden window'), false);
});

test('a layout is not itself a result, and prompts and Sets are not sources at all (section 6)', () => {
  assert.equal(names.includes('Focus'), false, 'the layout is the breadcrumb, never a row');
  assert.equal(names.includes('Binned prompt'), false);
  assert.equal(names.includes('A set'), false);
  for (const row of rows) {
    assert.equal(row.type === 'layout' || row.type === 'prompt' || row.type === 'set', false);
  }
});

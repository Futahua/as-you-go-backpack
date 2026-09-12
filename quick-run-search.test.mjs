import test from 'node:test';
import assert from 'node:assert/strict';
import { ROOT_ID, itemsIn } from './public/workspace-model-20260730b.js';
import { quickRunRows } from './public/app/quick-run/quick-run-search.js';

const state = {
  groups: [
    { id: 'g-root', parentId: ROOT_ID, name: 'Workspace' },
    { id: 'g-a', parentId: 'g-root', name: 'Alpha' },
  ],
  shortcuts: [
    {
      id: 's-1',
      name: 'Docs',
      target: 'https://example.com/docs',
      placements: [
        { id: 'p-1', parentId: 'g-a', order: 1 },
        { id: 'p-2', parentId: 'g-root', order: 2 },
        { id: 'p-3', parentId: 'g-a', order: 3, bin: true },
      ],
    },
    {
      id: 's-2',
      name: 'Local note',
      target: '/tmp/note.md',
      placements: [{ id: 'p-4', parentId: 'g-root', order: 4 }],
    },
  ],
  windowLayouts: [
    {
      id: 'l-1',
      parentId: 'g-a',
      name: 'Focus',
      arrangement: {
        members: [
          { id: 'm-1', descriptor: { title: 'Chrome' } },
          { id: 'm-2', descriptor: { title: 'Obsidian' } },
        ],
      },
    },
  ],
};

test('the universe is one row per active folder, placement and layout member', () => {
  const rows = quickRunRows(state);
  const keys = rows.map((row) => row.key);
  assert.equal(new Set(keys).size, keys.length, 'every row carries a distinct stable key');
  assert.deepEqual(
    rows.filter((row) => row.kind === 'folder').map((row) => row.name),
    ['Workspace', 'Alpha'],
  );
  // One row per placement, and the binned placement is not in the universe at all.
  const placements = rows.filter((row) => row.placementId).map((row) => row.placementId).sort();
  assert.deepEqual(placements, ['p-1', 'p-2', 'p-4']);
  // One row per member occurrence, named from the persisted descriptor.
  const members = rows.filter((row) => row.kind === 'layout-item');
  assert.deepEqual(members.map((row) => row.name), ['Chrome', 'Obsidian']);
  assert.deepEqual(members.map((row) => row.key), ['layout:l-1:m-1', 'layout:l-1:m-2']);
});

test('a link is a shortcut whose target the model classifies, not a second index', () => {
  const rows = quickRunRows(state);
  const docs = rows.filter((row) => row.shortcutId === 's-1');
  assert.ok(docs.length > 0);
  assert.deepEqual([...new Set(docs.map((row) => row.kind))], ['link']);
  const local = rows.filter((row) => row.shortcutId === 's-2');
  assert.deepEqual([...new Set(local.map((row) => row.kind))], ['shortcut']);
});

test('one shared shortcut in two folders is two rows that differ only by breadcrumb and key', () => {
  const rows = quickRunRows(state);
  const docs = rows.filter((row) => row.shortcutId === 's-1').sort((a, b) => a.key.localeCompare(b.key));
  assert.deepEqual(docs.map((row) => row.name), ['Docs', 'Docs']);
  assert.deepEqual(docs.map((row) => row.breadcrumb), ['Workspace / Alpha', 'Workspace']);
  assert.notEqual(docs[0].key, docs[1].key);
});

test('a layout member carries its containing layout in the breadcrumb', () => {
  const rows = quickRunRows(state);
  const member = rows.find((row) => row.key === 'layout:l-1:m-1');
  assert.equal(member.breadcrumb, 'Workspace / Alpha / Focus');
  assert.equal(member.layoutId, 'l-1');
  assert.equal(member.memberId, 'm-1');
});

test('the walk reads the model seam rather than a private one', () => {
  // The rows come from itemsIn()'s emitted shape: a shortcut entry carries id = placement id.
  const emitted = itemsIn(state, 'g-a').filter((item) => item.kind === 'shortcut');
  assert.deepEqual(emitted.map((item) => item.id), ['p-1']);
  assert.equal(emitted[0].shortcutId, 's-1');
  assert.equal(emitted[0].placements, undefined);
});
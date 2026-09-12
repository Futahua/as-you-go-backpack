import test from 'node:test';
import assert from 'node:assert/strict';
import { openQuickRunSession, quickRunSessionWithQuery } from './public/app/quick-run/quick-run-session.js';
import { quickRunChipViews, quickRunRowViews } from './public/app/quick-run/quick-run-presentation.js';

const state = {
  groups: [{ id: 'g-root', parentId: 'root', name: 'Workspace' }],
  shortcuts: [
    {
      id: 's-1',
      name: 'Docs',
      target: 'https://example.com/docs',
      placements: [
        { id: 'p-1', parentId: 'g-root', order: 1 },
        { id: 'p-2', parentId: 'g-root', order: 2 },
      ],
    },
  ],
  windowLayouts: [],
};

const typed = () => quickRunSessionWithQuery(openQuickRunSession(state), 'docs');

test('every row view carries an icon kind, a primary name and a breadcrumb', () => {
  const views = quickRunRowViews(typed());
  assert.equal(views.length, 2);
  for (const view of views) {
    assert.equal(typeof view.iconKind, 'string');
    assert.ok(view.iconKind.length > 0);
    assert.equal(view.primary, 'Docs');
    assert.equal(typeof view.breadcrumb, 'string');
    assert.ok(view.key.startsWith('link:'));
  }
});

test('the list is flat: one array of rows, with nothing grouped or nested inside it', () => {
  const views = quickRunRowViews(typed());
  assert.ok(Array.isArray(views));
  for (const view of views) {
    assert.equal(typeof view, 'object');
    // A grouped presentation would have to smuggle a group (or a list of rows) in here, and the
    // contract allows neither: "One flat list only. No grouped sections."
    assert.equal(Object.values(view).some((value) => Array.isArray(value) || (typeof value === 'object' && value !== null)), false);
  }
});

test('duplicate names are kept when breadcrumbs differ, and the highlight rides one of them', () => {
  const views = quickRunRowViews(typed());
  assert.deepEqual(views.map((view) => view.primary), ['Docs', 'Docs']);
  assert.notEqual(views[0].key, views[1].key);
  assert.deepEqual(views.map((view) => view.breadcrumb), ['Workspace', 'Workspace']);
  assert.equal(views.filter((view) => view.highlighted).length, 1);
});

test('an empty session draws no rows and no chips', () => {
  const opened = openQuickRunSession(state);
  assert.deepEqual(quickRunRowViews(opened), []);
  assert.deepEqual(quickRunChipViews(opened), []);
});

test('the chips mark exactly one active filter and start with All', () => {
  const session = typed();
  const chips = quickRunChipViews(session);
  assert.equal(chips[0].label, 'All');
  assert.deepEqual(chips.map((chip) => chip.active), [true, false]);
});

test('a layout item starts at availability unknown, and nothing guesses otherwise (section 5)', () => {
  const state = {
    groups: [{ id: 'g-root', parentId: 'root', name: 'Workspace' }],
    shortcuts: [
      { id: 's-1', name: 'Docs', target: 'https://example.com/docs', placements: [{ id: 'p-1', parentId: 'g-root', order: 1 }] },
    ],
    windowLayouts: [
      {
        id: 'l-1',
        parentId: 'g-root',
        name: 'Focus',
        arrangement: {
          members: [
            { id: 'm-1', descriptor: { title: 'Chrome' } },
            { id: 'm-2', descriptor: { title: 'Mystery', executable: 'mystery.exe' } },
            { id: 'm-3', descriptor: { title: 'Minimized', executable: 'chrome.exe' }, state: 'minimized' },
          ],
        },
      },
    ],
  };
  // A query per member, because an empty query shows nothing at all (section 1.1) - the rows being asked
  // about are the ones a query produced.
  const chrome = quickRunRowViews(quickRunSessionWithQuery(openQuickRunSession(state), 'chrome'));
  const mystery = quickRunRowViews(quickRunSessionWithQuery(openQuickRunSession(state), 'mystery'));
  const minimized = quickRunRowViews(quickRunSessionWithQuery(openQuickRunSession(state), 'minimized'));
  const docs = quickRunRowViews(quickRunSessionWithQuery(openQuickRunSession(state), 'docs'));
  assert.deepEqual(chrome.map((view) => view.iconKind), ['layout-item']);
  assert.deepEqual(mystery.map((view) => view.iconKind), ['layout-item'], 'a member whose executable no host reports is still searchable: the persisted member is what is searched');
  assert.deepEqual(minimized.map((view) => view.iconKind), ['layout-item']);
  for (const view of [...chrome, ...mystery, ...minimized]) {
    assert.equal(view.availability, 'unknown');
    assert.notEqual(view.availability, 'not-running');
  }
  assert.equal(minimized[0].availability, 'unknown', 'persisted arrangement state (minimized) is not availability (section 10.1)');
  assert.deepEqual(docs.map((view) => view.availability), [null], 'only a layout item has availability at all');
});
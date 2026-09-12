import test from 'node:test';
import assert from 'node:assert/strict';
import {
  closeQuickRunSession,
  openQuickRunSession,
  quickRunSessionAfterArrow,
  quickRunSessionWithFilter,
  quickRunSessionWithQuery,
} from './public/app/quick-run/quick-run-session.js';

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
    {
      id: 's-2',
      name: 'Downtown office',
      target: '/tmp/office.md',
      placements: [{ id: 'p-3', parentId: 'g-root', order: 3 }],
    },
  ],
  windowLayouts: [],
};

test('opening shows one empty session: no rows, no chips, All, no highlight', () => {
  const session = openQuickRunSession(state);
  assert.equal(session.open, true);
  assert.equal(session.query, '');
  assert.equal(session.filter, 'All');
  assert.deepEqual(session.rows, []);
  assert.deepEqual(session.chips, []);
  assert.equal(session.highlightKey, null);
  // The universe is there to search, it just is not shown: no empty-query home screen.
  assert.ok(session.allRows.length > 0);
});

test('results appear only after the first non-empty query', () => {
  const opened = openQuickRunSession(state);
  assert.deepEqual(quickRunSessionWithQuery(opened, 'do').rows.map((row) => row.resultKey), [
    'link:p-1',
    'link:p-2',
    'shortcut:p-3',
  ]);
  // Whitespace is still empty.
  assert.deepEqual(quickRunSessionWithQuery(opened, '   ').rows, []);
});

test('typing re-ranks and re-highlights, and the highlight follows a surviving row', () => {
  const opened = openQuickRunSession(state);
  const typed = quickRunSessionWithQuery(opened, 'dow');
  assert.deepEqual(typed.rows.map((row) => row.resultKey), ['shortcut:p-3']);
  assert.equal(typed.highlightKey, 'shortcut:p-3');

  const widened = quickRunSessionWithQuery(typed, 'do');
  assert.equal(widened.highlightKey, widened.rows[0].resultKey, 'a new set highlights its first row');

  const narrowed = quickRunSessionWithQuery(widened, 'docs');
  assert.deepEqual(narrowed.rows.map((row) => row.resultKey), ['link:p-1', 'link:p-2']);
});

test('the filter cycles inside the session and falls back to All when it loses its matches', () => {
  const typed = quickRunSessionWithQuery(openQuickRunSession(state), 'docs');
  assert.deepEqual(typed.chips, ['All', 'Links']);
  const folders = quickRunSessionWithFilter(typed, 'Folders');
  assert.equal(folders.fellBack, true);
  assert.equal(folders.filter, 'All');
  assert.equal(folders.highlightKey, folders.rows[0].resultKey);
});

test('arrows move the highlight inside the current set and clamp at both ends', () => {
  const typed = quickRunSessionWithQuery(openQuickRunSession(state), 'do');
  const down = quickRunSessionAfterArrow(typed, 1);
  assert.equal(down.highlightKey, typed.rows[1].resultKey);
  assert.equal(quickRunSessionAfterArrow(down, -1).highlightKey, typed.rows[0].resultKey);
  assert.equal(quickRunSessionAfterArrow(typed, -1).highlightKey, typed.rows[0].resultKey);
  const last = quickRunSessionWithQuery(openQuickRunSession(state), 'do');
  const end = quickRunSessionAfterArrow(quickRunSessionAfterArrow(last, 1), 1);
  assert.equal(quickRunSessionAfterArrow(end, 1).highlightKey, end.highlightKey);
});

test('closing clears the query, the rows, the filter and the highlight, and produces nothing else', () => {
  const typed = quickRunSessionWithFilter(
    quickRunSessionWithQuery(openQuickRunSession(state), 'docs'),
    'Links',
  );
  const closed = closeQuickRunSession(typed);
  assert.deepEqual(closed, {
    open: false, query: '', filter: 'All', rows: [], chips: [], highlightKey: null, fellBack: false,
  });
  // Escape does not create, move, launch, select, navigate or persist anything: the close returns a
  // session and no other value at all.
  assert.equal(Object.keys(closed).includes('action'), false);
  assert.equal(Object.keys(closed).includes('pending'), false);
  // A reopened session starts empty rather than resuming the previous search.
  const reopened = openQuickRunSession(state);
  assert.equal(reopened.query, '');
  assert.deepEqual(reopened.rows, []);
});

test('a keystroke into a closed session changes nothing', () => {
  const closed = closeQuickRunSession(openQuickRunSession(state));
  assert.deepEqual(quickRunSessionWithQuery(closed, 'docs'), closed);
  assert.deepEqual(quickRunSessionWithFilter(closed, 'Links'), closed);
  assert.deepEqual(quickRunSessionAfterArrow(closed, 1), closed);
});
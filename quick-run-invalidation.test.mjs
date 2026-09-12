// Section 3.4: the mutations that MUST NOT rebuild the index.
//
// The section says why the list is explicit - high-frequency false invalidation is a known performance
// risk - and the list is exactly the state that changes constantly while a reader works: graph physics,
// selection, hover, window observation, usage metadata. None of it is searchable semantics, so none of it
// may invalidate a query.
//
// The property is therefore two things, and both are asserted per mutation: the open session is a
// snapshot and cannot change under the reader's hands at all, and a *fresh* open over the mutated state
// finds the same universe, because none of these values is an index input. Rows are compared as a set of
// stable keys: a mutation that legitimately reorders occurrences (member order) may reorder rows on
// reopen, and claiming otherwise would be asserting something the contract does not say.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openQuickRunSession, quickRunSessionWithQuery } from './public/app/quick-run/quick-run-session.js';

const base = {
  groups: [
    { id: 'root', parentId: null, name: 'Workspace' },
    { id: 'g-1', parentId: 'root', name: 'Alpha' },
  ],
  shortcuts: [
    {
      id: 's-1',
      name: 'Editor',
      target: 'C:/editor.exe',
      icon: null,
      placements: [{ id: 'p-1', parentId: 'g-1', order: 1 }],
    },
  ],
  windowLayouts: [
    {
      id: 'l-1',
      parentId: 'g-1',
      name: 'Focus',
      cardSize: 'medium',
      arrangement: {
        members: [
          { id: 'm-1', descriptor: { title: 'Chrome' }, state: 'normal', bounds: { x: 0, y: 0, width: 800, height: 600 } },
          { id: 'm-2', descriptor: { title: 'Notes' }, state: 'normal', bounds: { x: 810, y: 0, width: 400, height: 600 } },
        ],
      },
    },
  ],
  view: { currentGroupId: 'root', theme: 'dark', iconSize: 96 },
  activeWindowLayoutId: 'l-1',
  graphPositions: {},
  hovered: null,
  preview: null,
  usage: {},
};

/** Every entry of section 3.4's list, as the state change it names. */
const mutations = [
  ['graph x/y positions', (s) => ({ ...s, graphPositions: { 'g-1': { x: 120, y: 40 } } })],
  ['graph rest positions', (s) => ({ ...s, graphRestPositions: { 'g-1': { x: 1, y: 2 } } })],
  ['graph physics ticks', (s) => ({ ...s, graphTick: (s.graphTick ?? 0) + 1 })],
  ['graph simulation cooling/heating', (s) => ({ ...s, graphAlpha: 0.3 })],
  ['toolbar position', (s) => ({ ...s, toolbarPosition: { x: 12, y: 12 } })],
  ['workspace selection', (s) => ({ ...s, selection: ['g-1'] })],
  ['selection anchor', (s) => ({ ...s, selectionAnchor: 'g-1' })],
  ['current folder navigation', (s) => ({ ...s, view: { ...s.view, currentGroupId: 'g-1' } })],
  ['breadcrumb navigation', (s) => ({ ...s, breadcrumbPath: ['root', 'g-1'] })],
  ['graph-expanded folder state', (s) => ({ ...s, expandedFolders: ['g-1'] })],
  ['trail-expanded folder state', (s) => ({ ...s, trailExpanded: ['g-1'] })],
  ['Bin mode view toggle by itself', (s) => ({ ...s, binMode: true })],
  ['icon-size preference', (s) => ({ ...s, view: { ...s.view, iconSize: 176 } })],
  ['theme/preferences unrelated to Quick Run hotkey', (s) => ({ ...s, view: { ...s.view, theme: 'light' } })],
  ['prompt-library changes', (s) => ({ ...s, promptLibrary: [{ id: 'pr-1', name: 'A prompt' }] })],
  ['Set membership changes while Sets remain excluded', (s) => ({ ...s, sets: [{ id: 'set-1', name: 'A set' }] })],
  ['Set rename/creation while Sets remain excluded', (s) => ({ ...s, sets: [{ id: 'set-2', name: 'Renamed' }] })],
  ['activeWindowLayoutId', (s) => ({ ...s, activeWindowLayoutId: null })],
  ['window-layout member state normal/minimized', (s) => ({
    ...s,
    windowLayouts: s.windowLayouts.map((layout) => ({
      ...layout,
      arrangement: { members: layout.arrangement.members.map((m) => ({ ...m, state: m.id === 'm-1' ? 'minimized' : m.state })) },
    })),
  })],
  ['window-layout member bounds', (s) => ({
    ...s,
    windowLayouts: s.windowLayouts.map((layout) => ({
      ...layout,
      arrangement: { members: layout.arrangement.members.map((m) => ({ ...m, bounds: { ...m.bounds, x: m.bounds.x + 500 } })) },
    })),
  })],
  ['window-layout card size', (s) => ({
    ...s,
    windowLayouts: s.windowLayouts.map((layout) => ({ ...layout, cardSize: 'large' })),
  })],
  ['window-layout member order', (s) => ({
    ...s,
    windowLayouts: s.windowLayouts.map((layout) => ({
      ...layout,
      arrangement: { members: [...layout.arrangement.members].reverse() },
    })),
  })],
  ['capability cache changes', (s) => ({ ...s, capabilities: new Map([['l-1\u0000m-1', { hwnd: 1 }]]) })],
  ['helper restart by itself', (s) => ({ ...s, helperGeneration: (s.helperGeneration ?? 0) + 1 })],
  ['hover', (s) => ({ ...s, hovered: 'shortcut:p-1' })],
  ['preview state', (s) => ({ ...s, preview: { layoutId: 'l-1' } })],
  ['thumbnail result', (s) => ({ ...s, thumbnails: { 'l-1\u0000m-1': 'data:image/png;base64,AA' } })],
  ['icon hydration alone', (s) => ({
    ...s,
    shortcuts: s.shortcuts.map((shortcut) => ({ ...shortcut, icon: 'data:image/png;base64,AA' })),
  })],
  ['widget open/close', (s) => ({ ...s, widgetOpen: true })],
  ['detached/attached presentation state', (s) => ({ ...s, detached: ['l-1'] })],
  ['recency/frequency usage metadata', (s) => ({ ...s, usage: { 'shortcut:p-1': { uses: 12, lastUsedAt: '2026-09-12T08:00:00+07:00' } } })],
];

// The universe a session captured, and what a query over a state resolves to: the snapshot is `allRows`
// because an open-but-empty line deliberately shows no rows at all (section 1.1).
const keysOf = (session) => session.allRows.map((row) => row.resultKey).sort();
const queried = (state) => quickRunSessionWithQuery(openQuickRunSession(state), 'e')
  .rows.map((row) => row.resultKey).sort();

test('the section 3.4 list is the whole list, and every entry is exercised', () => {
  assert.equal(mutations.length, 31, 'every mutation the section names has a case here');
  assert.deepEqual(
    mutations.map(([label]) => label),
    [...new Set(mutations.map(([label]) => label))],
    'and no case is duplicated',
  );
});

// The control that keeps the thirty-one cases honest: a change that *is* an index input does move the
// universe, so the assertions above are measuring something rather than always being true.
test('a source change is not on this list: renaming a folder does change the universe', () => {
  const renamed = {
    ...base,
    groups: base.groups.map((group) => (group.id === 'g-1' ? { ...group, name: 'Renamed alpha' } : group)),
  };
  assert.deepEqual(keysOf(openQuickRunSession(renamed)), keysOf(openQuickRunSession(base)), 'the row keys are stable');
  assert.deepEqual(
    openQuickRunSession(renamed).allRows.map((row) => row.name).sort(),
    ['Chrome', 'Editor', 'Notes', 'Renamed alpha'],
    'but the row content is rebuilt from the new name, which is what makes it a source',
  );
});

for (const [label, mutate] of mutations) {
  test(`${label} does not rebuild the index (section 3.4)`, () => {
    const session = openQuickRunSession(base);
    const opened = keysOf(session);
    const baseQuery = queried(base);
    assert.equal(opened.length, 4, 'the fixture indexes: one folder, one placement and two layout members');
    assert.equal(baseQuery.length, 3, 'and the query the comparisons use resolves to three of them');

    const mutated = mutate(base);

    assert.deepEqual(keysOf(session), opened, 'the open session cannot change under the reader at all');
    assert.equal(session.open, true);
    assert.equal(session.rows.length, 0, 'an empty query still shows nothing after the mutation');
    assert.deepEqual(
      keysOf(openQuickRunSession(mutated)),
      opened,
      'and a fresh open over the mutated state finds the same universe, because none of this is an index input',
    );
    assert.deepEqual(
      queried(mutated),
      baseQuery,
      'the same query over the mutated state resolves to the same rows, so nothing was rebuilt',
    );
  });
}

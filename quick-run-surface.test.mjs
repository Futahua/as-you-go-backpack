import test from 'node:test';
import assert from 'node:assert/strict';
import { closeQuickRunSession, openQuickRunSession, quickRunSessionWithQuery } from './public/app/quick-run/quick-run-session.js';
import { paintQuickRunSurface } from './public/app/quick-run/quick-run-surface.js';

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

function fakeElement() {
  return {
    hidden: false, value: '', textContent: '', className: '', dataset: {}, children: [],
    append(...nodes) { this.children.push(...nodes); },
    replaceChildren(...nodes) { this.children = nodes; },
  };
}

function harness() {
  const document = { createElement: (tag) => ({ tag, ...fakeElement() }) };
  const elements = { layer: fakeElement(), input: fakeElement(), chips: fakeElement(), results: fakeElement() };
  return { document, elements };
}

test('a closed session draws nothing and hides the layer', () => {
  const h = harness();
  const drawn = paintQuickRunSurface({ ...h, session: closeQuickRunSession(openQuickRunSession(state)) });
  assert.equal(drawn, 0);
  assert.equal(h.elements.layer.hidden, true);
  assert.deepEqual(h.elements.chips.children, []);
  assert.deepEqual(h.elements.results.children, []);
  assert.equal(h.elements.input.value, '');
});

test('an open session shows the line, and an empty query draws no rows and no chips', () => {
  const h = harness();
  paintQuickRunSurface({ ...h, session: openQuickRunSession(state) });
  assert.equal(h.elements.layer.hidden, false);
  assert.equal(h.elements.input.value, '');
  assert.deepEqual(h.elements.results.children, []);
  assert.deepEqual(h.elements.chips.children, []);
});

test('a typed query draws one flat row per occurrence, with stable keys and one highlight', () => {
  const h = harness();
  const session = quickRunSessionWithQuery(openQuickRunSession(state), 'docs');
  const drawn = paintQuickRunSurface({ ...h, session });
  assert.equal(drawn, 2);
  const rows = h.elements.results.children;
  assert.deepEqual(rows.map((row) => row.dataset.quickRunKey), ['link:p-1', 'link:p-2']);
  assert.deepEqual(rows.map((row) => row.dataset.quickRunHighlighted), ['true', 'false']);
  // The row carries section 1.2's three parts, in order.
  assert.deepEqual(rows[0].children.map((child) => child.className), [
    'quick-run-icon quick-run-icon-link',
    'quick-run-name',
    'quick-run-breadcrumb',
  ]);
  assert.equal(rows[0].children[1].textContent, 'Docs');
  assert.equal(rows[0].children[2].textContent, 'Workspace');
});

test('the chips mark All and the active type, and never carry the reader away from the field', () => {
  const h = harness();
  h.elements.input.value = 'half-typed';
  const session = quickRunSessionWithQuery(openQuickRunSession(state), 'docs');
  paintQuickRunSurface({ ...h, session });
  const chips = h.elements.chips.children;
  assert.deepEqual(chips.map((chip) => chip.dataset.quickRunChip), ['All', 'Links']);
  assert.deepEqual(chips.map((chip) => chip.className), ['quick-run-chip active', 'quick-run-chip']);
  // The input is the reader's while a query is live: painting must not overwrite it.
  assert.equal(h.elements.input.value, 'half-typed');
});

test('closing clears the line, the chips and the rows', () => {
  const h = harness();
  const typed = quickRunSessionWithQuery(openQuickRunSession(state), 'docs');
  paintQuickRunSurface({ ...h, session: typed });
  paintQuickRunSurface({ ...h, session: closeQuickRunSession(typed) });
  assert.equal(h.elements.layer.hidden, true);
  assert.equal(h.elements.input.value, '');
  assert.deepEqual(h.elements.chips.children, []);
  assert.deepEqual(h.elements.results.children, []);
});
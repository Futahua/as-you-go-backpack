import test from 'node:test';
import assert from 'node:assert/strict';
import { closeQuickRunSession, openQuickRunSession, quickRunSessionWithQuery } from './public/app/quick-run/quick-run-session.js';
import { mountQuickRun, paintQuickRunSurface } from './public/app/quick-run/quick-run-surface.js';

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

/* The mounting test builds its own elements rather than reusing the painter's helper: the wiring is only
   reachable through listeners, so the mock has to record them and be able to fire them. */
function liveElement() {
  const element = {
    hidden: false, value: '', textContent: '', className: '', dataset: {}, children: [],
    listeners: {},
    append(...nodes) { element.children.push(...nodes); },
    replaceChildren(...nodes) { element.children = nodes; },
    addEventListener(type, handler) { (element.listeners[type] ??= []).push(handler); },
    fire(type, event) { for (const handler of element.listeners[type] ?? []) handler(event); },
  };
  return element;
}

test('mounting wires the keys the contract binds, and opens on the current state', () => {
  const document = { createElement: (tag) => ({ tag, ...liveElement() }) };
  const elements = { layer: liveElement(), input: liveElement(), chips: liveElement(), results: liveElement() };
  const quickRun = mountQuickRun({ document, elements, getState: () => state });

  assert.equal(elements.layer.hidden, true, 'nothing is shown before it opens');
  assert.equal(quickRun.open(), true, 'the controller callback contract: open reports that it handled it');
  assert.equal(elements.layer.hidden, false);

  elements.input.value = 'docs';
  elements.input.fire('input', {});
  assert.equal(elements.results.children.length, 2);

  elements.layer.fire('keydown', { key: 'ArrowDown', shiftKey: false, preventDefault() {} });
  assert.equal(quickRun.session().highlightKey, 'link:p-2');
  elements.layer.fire('keydown', { key: 'ArrowUp', shiftKey: false, preventDefault() {} });
  assert.equal(quickRun.session().highlightKey, 'link:p-1');

  elements.layer.fire('keydown', { key: 'Tab', shiftKey: false, preventDefault() {} });
  assert.equal(quickRun.session().filter, 'All');
  assert.equal(quickRun.session().fellBack, true, 'Folders has no matches, so it falls back');

  elements.layer.fire('keydown', { key: 'Escape', shiftKey: false, preventDefault() {} });
  assert.equal(elements.layer.hidden, true);
  assert.equal(elements.input.value, '');
  assert.deepEqual(elements.results.children, []);
  assert.equal(quickRun.session().open, false);
});
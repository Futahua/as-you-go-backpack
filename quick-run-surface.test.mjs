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
    listeners: {},
    append(...nodes) { this.children.push(...nodes); },
    replaceChildren(...nodes) { this.children = nodes; },
    addEventListener(type, handler) { (this.listeners[type] ??= []).push(handler); },
    fire(type, event) { for (const handler of this.listeners[type] ?? []) handler(event); },
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
    listeners: {},
    append(...nodes) { element.children.push(...nodes); },
    replaceChildren(...nodes) { element.children = nodes; },
    addEventListener(type, handler) { (element.listeners[type] ??= []).push(handler); },
    focus() { element.focused = true; },
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
  assert.equal(elements.input.focused, true, 'the line takes focus, so the reader types immediately');

  elements.input.value = 'docs';
  elements.input.fire('input', {});
  assert.equal(elements.results.children.length, 2);

  elements.layer.fire('keydown', { key: 'ArrowDown', shiftKey: false, preventDefault() {} });
  assert.equal(quickRun.session().highlightKey, 'link:p-2');
  elements.layer.fire('keydown', { key: 'ArrowUp', shiftKey: false, preventDefault() {} });
  assert.equal(quickRun.session().highlightKey, 'link:p-1');

  elements.layer.fire('keydown', { key: 'Tab', shiftKey: false, preventDefault() {} });
  // The AUTHOR ruling of 2026-09-12: the query "docs" offers only All and Links, so one Tab from All
  // lands on Links rather than stepping onto Folders, which the query has emptied.
  assert.equal(quickRun.session().filter, 'Links');
  assert.equal(quickRun.session().fellBack, false, 'nothing fell back, because nothing unavailable was entered');
  elements.layer.fire('keydown', { key: 'Tab', shiftKey: false, preventDefault() {} });
  assert.equal(quickRun.session().filter, 'All', 'and the next step wraps back to All');
  elements.layer.fire('keydown', { key: 'Tab', shiftKey: true, preventDefault() {} });
  assert.equal(quickRun.session().filter, 'Links', 'Shift+Tab steps the same subset backwards');

  elements.layer.fire('keydown', { key: 'Escape', shiftKey: false, preventDefault() {} });
  assert.equal(elements.layer.hidden, true);
  assert.equal(elements.input.value, '');
  assert.deepEqual(elements.results.children, []);
  assert.equal(quickRun.session().open, false);
});

test('the highlight is always a row of the displayed set, whatever was typed before it', () => {
  const document = { createElement: (tag) => ({ tag, ...liveElement() }) };
  const elements = { layer: liveElement(), input: liveElement(), chips: liveElement(), results: liveElement() };
  const quickRun = mountQuickRun({ document, elements, getState: () => state });
  quickRun.open();
  for (const query of ['d', 'do', 'doc', 'docs', 'zzz', 'do']) {
    elements.input.value = query;
    elements.input.fire('input', {});
    const session = quickRun.session();
    const keys = session.rows.map((row) => row.resultKey);
    if (session.rows.length === 0) {
      assert.equal(session.highlightKey, null, 'no rows, no highlight');
    } else {
      assert.ok(keys.includes(session.highlightKey), 'the highlight is a row of the set it was given');
    }
    // And the painted rows agree with the session: what is highlighted is on screen exactly once.
    const painted = elements.results.children.map((row) => row.dataset.quickRunKey);
    assert.deepEqual(painted, keys);
  }
});

test('scrolling is left to the list: no wheel handler moves the highlight (section 6.3)', () => {
  const document = { createElement: (tag) => ({ tag, ...liveElement() }) };
  const elements = { layer: liveElement(), input: liveElement(), chips: liveElement(), results: liveElement() };
  const quickRun = mountQuickRun({ document, elements, getState: () => state });
  quickRun.open();
  elements.input.value = 'docs';
  elements.input.fire('input', {});
  const before = quickRun.session().highlightKey;

  assert.equal((elements.layer.listeners.wheel ?? []).length, 0, 'no wheel handler is registered');
  elements.layer.fire('wheel', { deltaY: 120, preventDefault() {} });
  assert.equal(quickRun.session().highlightKey, before, 'scrolling does not choose a row');
});

test('Enter and a click reach one activation path, and neither invents its own (section 6.4)', () => {
  const document = { createElement: (tag) => ({ tag, ...liveElement() }) };
  const elements = { layer: liveElement(), input: liveElement(), chips: liveElement(), results: liveElement() };
  const activated = [];
  const quickRun = mountQuickRun({
    document,
    elements,
    getState: () => state,
    onActivate: (key) => activated.push(key),
  });
  quickRun.open();
  elements.input.value = 'docs';
  elements.input.fire('input', {});

  // The keyboard: Enter activates whatever is highlighted.
  elements.layer.fire('keydown', { key: 'Enter', preventDefault() {} });
  assert.deepEqual(activated, ['link:p-1']);

  // The pointer: a click on a row reports the same key through the same function.
  elements.results.children[1].fire('click', {});
  assert.deepEqual(activated, ['link:p-1', 'link:p-2']);
});

test('Enter with nothing highlighted activates nothing', () => {
  const document = { createElement: (tag) => ({ tag, ...liveElement() }) };
  const elements = { layer: liveElement(), input: liveElement(), chips: liveElement(), results: liveElement() };
  const activated = [];
  const quickRun = mountQuickRun({ document, elements, getState: () => state, onActivate: (key) => activated.push(key) });
  quickRun.open();
  elements.layer.fire('keydown', { key: 'Enter', preventDefault() {} });
  assert.deepEqual(activated, [], 'an empty query has no row to run');
});

test('hover marks the row under the pointer and never becomes the keyboard selection', () => {
  const document = { createElement: (tag) => ({ tag, ...liveElement() }) };
  const elements = { layer: liveElement(), input: liveElement(), chips: liveElement(), results: liveElement() };
  const activated = [];
  const quickRun = mountQuickRun({ document, elements, getState: () => state, onActivate: (key) => activated.push(key) });
  quickRun.open();
  elements.input.value = 'docs';
  elements.input.fire('input', {});
  const highlighted = quickRun.session().highlightKey;
  assert.equal(highlighted, 'link:p-1');

  // The pointer moves onto the second row.
  elements.results.children[1].fire('mouseover', {});
  assert.equal(elements.results.children[1].dataset.quickRunHovered, 'true');
  assert.equal(elements.results.children[0].dataset.quickRunHovered, 'false');
  // Marked hovered, still not highlighted, and the keyboard still owns the choice.
  assert.equal(elements.results.children[1].dataset.quickRunHighlighted, 'false');
  assert.equal(quickRun.session().highlightKey, highlighted, 'hover does not move the keyboard highlight');
  elements.layer.fire('keydown', { key: 'Enter', preventDefault() {} });
  assert.deepEqual(activated, ['link:p-1'], 'Enter runs the keyboard highlight, not the hovered row');
});

test('a disabled Shift+Enter is visibly disabled, with its reason (section 1.6)', () => {
  const document = { createElement: (tag) => ({ tag, ...liveElement() }) };
  const elements = { layer: liveElement(), input: liveElement(), chips: liveElement(), results: liveElement(), notice: liveElement() };
  const shifted = [];
  const quickRun = mountQuickRun({
    document,
    elements,
    getState: () => state,
    onShiftEnter: (key) => shifted.push(key),
    shiftEnterNotice: (row) => (
      row ? { text: 'Shift+Enter: only Layout Items can join a layout.' } : { text: '' }
    ),
  });

  quickRun.open();
  assert.equal(elements.notice.hidden, true, 'nothing highlighted yet, so there is nothing to say');

  elements.input.value = 'docs';
  elements.input.fire('input', {});
  assert.equal(elements.notice.hidden, false, 'the reason is on screen before the key is pressed');
  assert.equal(elements.notice.textContent, 'Shift+Enter: only Layout Items can join a layout.');

  let prevented = false;
  elements.layer.fire('keydown', { key: 'Enter', shiftKey: true, preventDefault() { prevented = true; } });
  assert.equal(prevented, true, 'the key is handled rather than passed to the workspace');
  assert.deepEqual(shifted, [], 'a disabled key calls nothing');
  assert.equal(
    elements.notice.textContent,
    'Shift+Enter: only Layout Items can join a layout.',
    'and the reason stays on screen, which is what "never silently ignored" means for this key',
  );
});

test('an enabled Shift+Enter reaches the caller with the highlighted row (section 1.6)', () => {
  const withLayout = {
    groups: [{ id: 'g-root', parentId: 'root', name: 'Workspace' }],
    shortcuts: [],
    windowLayouts: [
      {
        id: 'l-1',
        parentId: 'g-root',
        name: 'Focus',
        arrangement: { members: [{ id: 'm-1', descriptor: { title: 'Chrome' } }] },
      },
    ],
  };
  const document = { createElement: (tag) => ({ tag, ...liveElement() }) };
  const elements = { layer: liveElement(), input: liveElement(), chips: liveElement(), results: liveElement(), notice: liveElement() };
  const shifted = [];
  const quickRun = mountQuickRun({
    document,
    elements,
    getState: () => withLayout,
    onShiftEnter: (key) => shifted.push(key),
    shiftEnterNotice: (row) => (
      row?.type === 'layout-item'
        ? { text: 'Shift+Enter adds this window to the active layout.', enabled: true }
        : { text: 'Shift+Enter: only Layout Items can join a layout.' }
    ),
  });

  quickRun.open();
  elements.input.value = 'chrome';
  elements.input.fire('input', {});
  assert.equal(elements.notice.textContent, 'Shift+Enter adds this window to the active layout.');

  elements.layer.fire('keydown', { key: 'Enter', shiftKey: true, preventDefault() {} });
  assert.equal(shifted.length, 1, 'an enabled press reaches the caller');
  assert.equal(shifted[0], elements.results.children[0].dataset.quickRunKey, 'with the highlighted row key');
});

test('typing never re-reads the world: the snapshot is taken at open and ranked in memory (section 5)', () => {
  const document = { createElement: (tag) => ({ tag, ...liveElement() }) };
  const elements = { layer: liveElement(), input: liveElement(), chips: liveElement(), results: liveElement() };
  let reads = 0;
  const quickRun = mountQuickRun({
    document,
    elements,
    getState: () => { reads += 1; return state; },
    onActivate: () => {},
  });
  quickRun.open();
  assert.equal(reads, 1, 'opening reads the workspace once');
  for (const query of ['d', 'do', 'doc', 'docs', 'doc', 'zzz']) {
    elements.input.value = query;
    elements.input.fire('input', {});
    elements.layer.fire('keydown', { key: 'ArrowDown', preventDefault() {} });
    elements.layer.fire('keydown', { key: 'Tab', shiftKey: false, preventDefault() {} });
  }
  assert.equal(reads, 1, 'and nothing a keystroke does reads it again');
});
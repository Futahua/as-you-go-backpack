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
  const elements = {
    layer: fakeElement(), input: fakeElement(), chips: fakeElement(), results: fakeElement(),
    cap: fakeElement(), notice: fakeElement(),
  };
  return { document, elements };
}

/** A workspace whose query matches more rows than one session may paint (the cap is observable there). */
function crowdedState(count) {
  const shortcuts = [];
  for (let index = 0; index < count; index += 1) {
    shortcuts.push({
      id: `s-${index}`,
      name: `Kestrel ${index}`,
      target: `C:/corpus/kestrel-${index}.md`,
      placements: [{ id: `p-${index}`, parentId: 'g-root', order: index }],
    });
  }
  return { groups: [{ id: 'g-root', parentId: 'root', name: 'Workspace' }], shortcuts, windowLayouts: [] };
}

test('a closed session draws nothing and hides the layer', () => {
  const h = harness();
  const drawn = paintQuickRunSurface({ ...h, session: closeQuickRunSession(openQuickRunSession(state)) });
  assert.equal(drawn, 0);
  assert.equal(h.elements.layer.hidden, true);
  assert.deepEqual(h.elements.chips.children, []);
  assert.deepEqual(h.elements.results.children, []);
  assert.equal(h.elements.input.value, '');
  assert.equal(h.elements.cap.hidden, true);
});

test('an open session shows the line, and an empty query draws no rows and no chips', () => {
  const h = harness();
  paintQuickRunSurface({ ...h, session: openQuickRunSession(state) });
  assert.equal(h.elements.layer.hidden, false);
  assert.equal(h.elements.input.value, '');
  assert.deepEqual(h.elements.results.children, []);
  assert.deepEqual(h.elements.chips.children, []);
  assert.equal(h.elements.cap.hidden, true, 'nothing matched, so there is no cap to report');
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
  assert.equal(h.elements.cap.hidden, true);
});

test('a capped session paints the first 200 rows and says what it is not showing', () => {
  const h = harness();
  const session = quickRunSessionWithQuery(openQuickRunSession(crowdedState(500)), 'kestrel');
  const drawn = paintQuickRunSurface({ ...h, session });
  assert.equal(drawn, 200, 'the paint is bounded, which is the whole point of the cap');
  assert.equal(h.elements.results.children.length, 200);
  assert.equal(h.elements.cap.hidden, false);
  assert.equal(h.elements.cap.dataset.quickRunCap, 'true', 'the line is findable, and only while it is true');
  assert.equal(h.elements.cap.textContent, 'Showing the first 200 of 500 matches — keep typing to narrow.');
});

test('an uncapped session paints every match and draws no cap line at all', () => {
  const h = harness();
  paintQuickRunSurface({ ...h, session: quickRunSessionWithQuery(openQuickRunSession(crowdedState(7)), 'kestrel') });
  assert.equal(h.elements.results.children.length, 7);
  assert.equal(h.elements.cap.hidden, true);
  assert.equal(h.elements.cap.dataset.quickRunCap, 'false');
  assert.equal(h.elements.cap.textContent, '');
});

test('a caller that mounts without the cap element still paints a capped session', () => {
  // The line is optional in exactly the way the notice already is: a caller with four elements paints rows.
  const h = harness();
  delete h.elements.cap;
  const drawn = paintQuickRunSurface({
    ...h,
    session: quickRunSessionWithQuery(openQuickRunSession(crowdedState(500)), 'kestrel'),
  });
  assert.equal(drawn, 200);
});

test('the cap line follows the query, appearing only while the match set is larger than the cap', () => {
  const document = { createElement: (tag) => ({ tag, ...liveElement() }) };
  const elements = {
    layer: liveElement(), input: liveElement(), chips: liveElement(), results: liveElement(),
    cap: liveElement(), notice: liveElement(),
  };
  const quickRun = mountQuickRun({ document, elements, getState: () => crowdedState(300) });
  quickRun.open();
  assert.equal(elements.cap.hidden, true, 'an empty query shows nothing, so it cannot be capped');

  elements.input.value = 'kestrel';
  elements.input.fire('input', {});
  assert.equal(quickRun.session().capped, true);
  assert.equal(elements.cap.hidden, false);
  assert.equal(elements.cap.textContent, 'Showing the first 200 of 300 matches — keep typing to narrow.');
  assert.equal(elements.results.children.length, 200, 'the painted list and the sentence agree');

  elements.input.value = 'kestrel 2';
  elements.input.fire('input', {});
  assert.equal(quickRun.session().capped, false, 'this query matches fewer rows than the cap');
  assert.equal(elements.cap.hidden, true, 'so the line goes away rather than reporting an old number');
  assert.equal(elements.cap.textContent, '');
  assert.equal(elements.cap.dataset.quickRunCap, 'false');

  elements.input.value = 'kestrel';
  elements.input.fire('input', {});
  assert.equal(elements.cap.hidden, false, 'and it returns with the wider query');
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
    focus() { element.focused = true; },
    // `this`, not the closed-over object: rows are built by spreading this template, so a row's own
    // scrollIntoView must record on the row rather than on the template it came from.
    scrollIntoView(options) { this.scrolledIntoView = options; },
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

test('the wheel moves the highlight with the list, so Enter cannot run a row that scrolled away (section 6.3)', () => {
  const document = { createElement: (tag) => ({ tag, ...liveElement() }) };
  const elements = { layer: liveElement(), input: liveElement(), chips: liveElement(), results: liveElement() };
  const quickRun = mountQuickRun({ document, elements, getState: () => crowdedState(10) });
  quickRun.open();
  elements.input.value = 'kestrel';
  elements.input.fire('input', {});
  assert.equal(quickRun.session().highlightKey, 'shortcut:p-0');

  assert.equal((elements.layer.listeners.wheel ?? []).length, 1, 'the wheel is handled');

  // The list keeps scrolling normally: the wheel is not taken from the reader, and the highlight travels
  // with the scroll rather than being left behind on a row that is no longer on screen.
  let prevented = false;
  elements.layer.fire('wheel', { deltaY: 48, preventDefault() { prevented = true; } });
  assert.equal(prevented, false, 'scrolling is still the list\'s');
  assert.equal(quickRun.session().highlightKey, 'shortcut:p-2', 'two rows of scroll, two rows of highlight');

  elements.layer.fire('wheel', { deltaY: -24 });
  assert.equal(quickRun.session().highlightKey, 'shortcut:p-1', 'scrolling back moves the highlight back');

  elements.layer.fire('wheel', { deltaY: 100000 });
  assert.equal(quickRun.session().highlightKey, 'shortcut:p-9', 'a single flick cannot run off the painted list');
  assert.equal(elements.results.children.filter((row) => row.dataset.quickRunHighlighted === 'true').length, 1);
});

test('a highlight moved by the keyboard or the wheel is brought into view (section 6.3)', () => {
  const document = { createElement: (tag) => ({ tag, ...liveElement() }) };
  const elements = { layer: liveElement(), input: liveElement(), chips: liveElement(), results: liveElement() };
  const quickRun = mountQuickRun({ document, elements, getState: () => crowdedState(30) });
  const scrolled = () => elements.results.children
    .filter((row) => row.scrolledIntoView)
    .map((row) => row.dataset.quickRunKey);

  quickRun.open();
  elements.input.value = 'kestrel';
  elements.input.fire('input', {});
  // Typing starts a new list at its own top, where its first (highlighted) row already is. It must not
  // touch layout: forcing style-and-layout inside a keystroke is exactly what the paint cap keeps out, and
  // the integrated harness measures it (p95 4.3 ms without this call, 8.1 ms with it on every repaint).
  assert.deepEqual(scrolled(), [], 'typing does not force a scroll on the keystroke path');

  elements.layer.fire('keydown', { key: 'ArrowDown', preventDefault() {} });
  assert.deepEqual(scrolled(), ['shortcut:p-1'], 'an arrow brings the new highlight into view, not merely marks it');

  elements.layer.fire('wheel', { deltaY: 48 });
  assert.deepEqual(scrolled(), ['shortcut:p-3'], 'the wheel brings its row into view too');
});

test('a keystroke touches no scroll box, and the list resets to its top once the reader has scrolled', () => {
  const document = { createElement: (tag) => ({ tag, ...liveElement() }) };
  const elements = { layer: liveElement(), input: liveElement(), chips: liveElement(), results: liveElement() };
  elements.results.scrollTop = 90;
  const quickRun = mountQuickRun({ document, elements, getState: () => crowdedState(30) });
  quickRun.open();
  elements.input.value = 'kestrel';
  elements.input.fire('input', {});
  // The keystroke path is the one the integrated harness measures, so it must not read or write the scroll
  // box: doing so forces style-and-layout for 200 fresh rows inside the measured window.
  assert.equal(elements.results.scrollTop, 90, 'typing leaves the scroll box completely alone');

  // Once a movement has scrolled the list, the next query starts its own list at the top, so the row the
  // highlight moved to is not left above the fold.
  elements.layer.fire('wheel', { deltaY: 48 });
  assert.equal(quickRun.session().highlightKey, 'shortcut:p-2');
  assert.equal(elements.results.scrollTop, 90, 'the movement keeps the reader where they were');
  elements.input.value = 'kestrel 2';
  elements.input.fire('input', {});
  assert.equal(elements.results.scrollTop, 0, 'and the new query starts at its own top');
});

test('a non-empty query with no matches says so instead of drawing a blank layer', () => {
  const document = { createElement: (tag) => ({ tag, ...liveElement() }) };
  const elements = { layer: liveElement(), input: liveElement(), chips: liveElement(), results: liveElement(), notice: liveElement() };
  const quickRun = mountQuickRun({ document, elements, getState: () => crowdedState(3) });
  quickRun.open();
  assert.equal(elements.notice.hidden, true, 'an empty query is not a failed search, so it says nothing');

  elements.input.value = 'zzzz';
  elements.input.fire('input', {});
  assert.equal(elements.results.children.length, 0, 'no matches means no rows');
  assert.equal(elements.chips.children.length, 0, 'and no chips');
  assert.equal(elements.notice.hidden, false, 'but the layer is not left blank: a stall and an answer differ');
  assert.equal(elements.notice.textContent, 'No matches for “zzzz”.');

  elements.input.value = 'kestrel';
  elements.input.fire('input', {});
  assert.equal(elements.notice.hidden, true, 'and the line goes away once there is something to show');
  assert.equal(elements.notice.textContent, '');
});

test('a result that turns out to be gone is replaced by the current matches, not left to be hit again (section 5)', () => {
  let state = crowdedState(6);
  const document = { createElement: (tag) => ({ tag, ...liveElement() }) };
  const elements = { layer: liveElement(), input: liveElement(), chips: liveElement(), results: liveElement() };
  const quickRun = mountQuickRun({ document, elements, getState: () => state });
  quickRun.open();
  elements.input.value = 'kestrel';
  elements.input.fire('input', {});
  elements.layer.fire('keydown', { key: 'ArrowDown', preventDefault() {} });
  elements.layer.fire('keydown', { key: 'ArrowDown', preventDefault() {} });
  assert.equal(quickRun.session().highlightKey, 'shortcut:p-2', 'the reader asked for the third row');

  // The workspace moves under the open surface: the highlighted occurrence, and one before it, are gone.
  state = {
    ...state,
    shortcuts: state.shortcuts.filter((shortcut) => shortcut.id !== 's-0' && shortcut.id !== 's-2'),
  };
  const refreshed = quickRun.refresh();

  assert.equal(quickRun.session().query, 'kestrel', 'the query the reader typed is kept');
  assert.deepEqual(
    refreshed.rows.map((row) => row.resultKey),
    ['shortcut:p-1', 'shortcut:p-3', 'shortcut:p-4', 'shortcut:p-5'],
    'the list is the current state rather than the snapshot the dead row came from',
  );
  assert.equal(refreshed.highlightKey, 'shortcut:p-4', 'and the highlight lands on the survivor nearest the row that vanished');
  assert.equal(elements.results.children.length, 4, 'what is on screen is the refreshed list');
  assert.equal(elements.results.children[2].dataset.quickRunHighlighted, 'true', 'with exactly one highlight on it');
});

test('Shift+Enter is inert: the cut gesture does not become a second Enter (CUT 2026-09-13)', () => {
  const document = { createElement: (tag) => ({ tag, ...liveElement() }) };
  const elements = { layer: liveElement(), input: liveElement(), chips: liveElement(), results: liveElement(), notice: liveElement() };
  const activated = [];
  const quickRun = mountQuickRun({ document, elements, getState: () => state, onActivate: (key) => activated.push(key) });
  quickRun.open();
  elements.input.value = 'docs';
  elements.input.fire('input', {});
  const before = quickRun.session();

  let prevented = false;
  elements.layer.fire('keydown', { key: 'Enter', shiftKey: true, preventDefault() { prevented = true; } });
  assert.equal(prevented, false, 'the mount does not claim a chord it no longer implements');
  assert.deepEqual(activated, [], 'and it runs nothing at all');
  assert.equal(quickRun.session(), before, 'the session is untouched');
  assert.equal(elements.notice.hidden, true, 'and no notice claims the gesture exists');
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
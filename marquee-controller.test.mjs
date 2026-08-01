import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkspaceStore } from './public/app/workspace-store.js';
import { createMarqueeController } from './public/app/interactions/marquee-controller.js';

function createHarness() {
  let state = { groups: [], shortcuts: [], view: {} };
  const store = createWorkspaceStore({
    getState: () => state,
    setState: (next) => { state = next; },
    persist: async () => {},
    normalizeState: (s) => s,
    setStatus: () => {},
  });
  const effects = { sync: 0, saves: 0, captured: 0, released: 0 };
  const tiles = [
    { id: 'a', rect: { left: 10, top: 10, right: 60, bottom: 60 } },
    { id: 'b', rect: { left: 100, top: 10, right: 150, bottom: 60 } },
  ];
  const elements = {
    grid: {
      querySelectorAll: () => tiles.map((t) => ({
        dataset: { id: t.id },
        getBoundingClientRect: () => t.rect,
      })),
      setPointerCapture: () => { effects.captured += 1; },
      hasPointerCapture: () => true,
      releasePointerCapture: () => { effects.released += 1; },
    },
    explorer: { getBoundingClientRect: () => ({ left: 0, top: 0 }) },
    marquee: { hidden: true, style: {} },
  };
  const controller = createMarqueeController({
    elements,
    store,
    itemsIntersectingMarquee: (items, bounds) =>
      items.filter((t) =>
        t.right >= bounds.left && t.left <= bounds.right
        && t.bottom >= bounds.top && t.top <= bounds.bottom
      ).map((t) => t.id),
    syncSelection: () => { effects.sync += 1; },
    saveWorkspaceView: () => { effects.saves += 1; },
  });
  return { controller, store, effects, elements };
}

test('start without Ctrl clears the selection and captures the pointer', () => {
  const h = createHarness();
  h.store.setSelection(['a']);
  h.controller.start({ pointerId: 1, clientX: 50, clientY: 50, ctrlKey: false });
  assert.equal(h.store.getSession().selected.size, 0);
  assert.equal(h.effects.sync, 1);
  assert.equal(h.effects.captured, 1);
});

test('start with Ctrl preserves the selection as the marquee base', () => {
  const h = createHarness();
  h.store.setSelection(['a']);
  h.controller.start({ pointerId: 1, clientX: 50, clientY: 50, ctrlKey: true });
  assert.ok(h.store.getSession().selected.has('a'));
});

test('move below the threshold does not select', () => {
  const h = createHarness();
  h.controller.start({ pointerId: 1, clientX: 50, clientY: 50, ctrlKey: false });
  h.controller.move({ pointerId: 1, clientX: 51, clientY: 51 });
  assert.equal(h.store.getSession().selected.size, 0);
  assert.equal(h.elements.marquee.hidden, true);
});

test('move above the threshold selects intersecting tiles', () => {
  const h = createHarness();
  h.controller.start({ pointerId: 1, clientX: 50, clientY: 50, ctrlKey: false });
  // Bounds (50..55, 50..55) intersect tile a only (b starts at x=100).
  h.controller.move({ pointerId: 1, clientX: 55, clientY: 55 });
  assert.deepEqual([...h.store.getSession().selected], ['a']);
  assert.equal(h.elements.marquee.hidden, false);
  assert.equal(h.effects.sync, 2); // start clears + move selects
});

test('finish releases capture, saves the view, and reports whether it moved', () => {
  const h = createHarness();
  h.controller.start({ pointerId: 1, clientX: 50, clientY: 50, ctrlKey: false });
  h.controller.move({ pointerId: 1, clientX: 55, clientY: 55 });
  const moved = h.controller.finish(1);
  assert.equal(moved, true);
  assert.equal(h.effects.released, 1);
  assert.equal(h.effects.saves, 1);
  assert.equal(h.elements.marquee.hidden, true);
  assert.equal(h.controller.isActive(1), false);
});

test('finish for an unrelated pointer is a no-op', () => {
  const h = createHarness();
  h.controller.start({ pointerId: 1, clientX: 50, clientY: 50, ctrlKey: false });
  const moved = h.controller.finish(2);
  assert.equal(moved, null);
  assert.equal(h.effects.released, 0);
  assert.equal(h.effects.saves, 0);
});

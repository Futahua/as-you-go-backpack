import assert from 'node:assert/strict';
import test from 'node:test';
import { createMarqueeController } from './public/app/interactions/marquee-controller.js';

function createHarness({ sweptSetIds = null } = {}) {
  const effects = { captured: 0, released: 0 };
  const commandCalls = [];
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
  const commands = {
    beginMarqueeSelection: ({ preserveSelection }) => {
      commandCalls.push(['begin', preserveSelection]);
      return preserveSelection ? ['a'] : [];
    },
    updateMarqueeSelection: (ids) => { commandCalls.push(['update', ids]); },
    finishMarqueeSelection: ({ moved }) => { commandCalls.push(['finish', moved]); },
    selectSets: (ids, opts) => { commandCalls.push(['select-sets', ids, opts]); },
  };
  const controller = createMarqueeController({
    elements,
    commands,
    itemsIntersectingMarquee: (items, bounds) =>
      items.filter((t) =>
        t.right >= bounds.left && t.left <= bounds.right
        && t.bottom >= bounds.top && t.top <= bounds.bottom
      ).map((t) => t.id),
    // Only supplied for the graph view; the explorer has no regions to sweep.
    setIdsIntersectingRect: sweptSetIds === null ? null : (rect) => sweptSetIds(rect),
    clientToWorld: sweptSetIds === null ? null : (x, y) => ({ x: x * 2, y: y * 2 }),
  });
  return { controller, effects, commandCalls, elements };
}

test('start without preserve requests a clear via beginMarqueeSelection', () => {
  const h = createHarness();
  h.controller.start({ pointerId: 1, clientX: 50, clientY: 50, preserveSelection: false });
  assert.deepEqual(h.commandCalls, [['begin', false]]);
  assert.equal(h.effects.captured, 1);
});

test('start with preserve keeps the selection and captures the pointer', () => {
  const h = createHarness();
  h.controller.start({ pointerId: 1, clientX: 50, clientY: 50, preserveSelection: true });
  assert.deepEqual(h.commandCalls, [['begin', true]]);
  assert.equal(h.effects.captured, 1);
});

test('move below the threshold does not update selection or show the overlay', () => {
  const h = createHarness();
  h.controller.start({ pointerId: 1, clientX: 50, clientY: 50, preserveSelection: false });
  h.controller.move({ pointerId: 1, clientX: 51, clientY: 51 });
  assert.equal(h.elements.marquee.hidden, true);
  assert.deepEqual(h.commandCalls, [['begin', false]]);
});

test('move above the threshold updates the selection with base plus intersections', () => {
  const h = createHarness();
  h.controller.start({ pointerId: 1, clientX: 50, clientY: 50, preserveSelection: true });
  // Bounds (50..55, 50..55) intersect tile a only (b starts at x=100).
  h.controller.move({ pointerId: 1, clientX: 55, clientY: 55 });
  assert.deepEqual(h.commandCalls, [
    ['begin', true],
    ['update', ['a', 'a']], // preserved base ['a'] plus intersecting tile 'a'
  ]);
  assert.equal(h.elements.marquee.hidden, false);
});

test('finish releases capture, finishes the command, and reports whether it moved', () => {
  const h = createHarness();
  h.controller.start({ pointerId: 1, clientX: 50, clientY: 50, preserveSelection: false });
  h.controller.move({ pointerId: 1, clientX: 55, clientY: 55 });
  const moved = h.controller.finish(1);
  assert.equal(moved, true);
  assert.equal(h.effects.released, 1);
  assert.equal(h.elements.marquee.hidden, true);
  assert.deepEqual(h.commandCalls.at(-1), ['finish', true]);
  assert.equal(h.controller.isActive(1), false);
});

test('finish for an unrelated pointer is a no-op', () => {
  const h = createHarness();
  h.controller.start({ pointerId: 1, clientX: 50, clientY: 50, preserveSelection: false });
  const moved = h.controller.finish(2);
  assert.equal(moved, null);
  assert.equal(h.effects.released, 0);
  assert.deepEqual(h.commandCalls, [['begin', false]]);
});

// ===========================================================================
// Sweeping sets: a marquee catches outlines as well as tiles.
// ===========================================================================

test('a sweep selects the sets its bounds cross', () => {
  const seen = [];
  const h = createHarness({
    sweptSetIds: (rect) => { seen.push(rect); return ['s1']; },
  });
  h.controller.start({ pointerId: 1, clientX: 10, clientY: 20, preserveSelection: false });
  h.controller.move({ pointerId: 1, clientX: 110, clientY: 120 });

  const call = h.commandCalls.find(([name]) => name === 'select-sets');
  assert.ok(call, 'sets were selected');
  assert.deepEqual(call[1], ['s1']);
  assert.equal(call[2].additive, false, 'a sweep replaces the set selection');
});

test('sweep bounds reach the regions in world coordinates', () => {
  const seen = [];
  const h = createHarness({
    sweptSetIds: (rect) => { seen.push(rect); return []; },
  });
  h.controller.start({ pointerId: 1, clientX: 10, clientY: 20, preserveSelection: false });
  h.controller.move({ pointerId: 1, clientX: 110, clientY: 120 });

  // The harness converts client to world by doubling, so raw client bounds
  // would arrive as 10..110 rather than 20..220. Regions live in graph space,
  // and a sweep that skipped the conversion would select the wrong sets at any
  // zoom other than 1.
  assert.deepEqual(seen.at(-1), { left: 20, top: 40, right: 220, bottom: 240 });
});

test('a sweep normalizes bounds dragged up and to the left', () => {
  const seen = [];
  const h = createHarness({
    sweptSetIds: (rect) => { seen.push(rect); return []; },
  });
  h.controller.start({ pointerId: 1, clientX: 110, clientY: 120, preserveSelection: false });
  h.controller.move({ pointerId: 1, clientX: 10, clientY: 20 });

  const rect = seen.at(-1);
  assert.ok(rect.left < rect.right && rect.top < rect.bottom, `inverted rect: ${JSON.stringify(rect)}`);
});

test('without regions to sweep the marquee still selects items', () => {
  // The explorer view has tiles but no set outlines.
  const h = createHarness();
  h.controller.start({ pointerId: 1, clientX: 5, clientY: 5, preserveSelection: false });
  h.controller.move({ pointerId: 1, clientX: 200, clientY: 200 });
  assert.ok(h.commandCalls.some(([name]) => name === 'update'), 'items still selected');
  assert.ok(!h.commandCalls.some(([name]) => name === 'select-sets'), 'no set selection attempted');
});

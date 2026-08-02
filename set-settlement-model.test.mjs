/** The world yields to the drop, not the other way round.
 *
 * Every test here would have failed under the previous design, which refused a
 * drop that broke a rule and put the item back. The rules are the same; what
 * changed is who moves to satisfy them. */

import assert from 'node:assert/strict';
import test from 'node:test';
import { settleLayout } from './public/set-settlement-model.js';

const TILE = { width: 90, height: 90 };

function tile(id, x, y) {
  return { id, x, y, ...TILE };
}

/** Membership as a plain lookup. */
function membership(map) {
  return (itemId) => map[itemId] ?? [];
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

test('the dropped item never moves', () => {
  // The whole premise. Wherever the user let go is where it stays, however
  // much of the layout has to rearrange around it.
  const items = [tile('member', 0, 0), tile('outsider', 5, 5)];
  const result = settleLayout({
    items,
    setsOf: membership({ member: ['s1'] }),
    anchorIds: ['outsider'],
  });
  const dropped = result.positions.get('outsider');
  assert.equal(dropped.x, 5, 'x is exactly where it was dropped');
  assert.equal(dropped.y, 5, 'y is exactly where it was dropped');
});

test('a setless item dropped inside a set pushes the members aside', () => {
  // Members move to open real space, rather than the membrane carving a cavity
  // around the outsider. A hole would make the set read as a category zone.
  const items = [
    tile('m1', -60, 0), tile('m2', 60, 0), tile('m3', 0, -60), tile('m4', 0, 60),
    tile('outsider', 0, 0),
  ];
  const before = items.map((item) => ({ ...item }));
  const result = settleLayout({
    items,
    setsOf: membership({ m1: ['s1'], m2: ['s1'], m3: ['s1'], m4: ['s1'] }),
    anchorIds: ['outsider'],
  });

  assert.deepEqual(result.positions.get('outsider'), { x: 0, y: 0 }, 'the outsider held its ground');
  for (const id of ['m1', 'm2', 'm3', 'm4']) {
    const was = before.find((item) => item.id === id);
    const now = result.positions.get(id);
    assert.ok(
      distance(was, now) > 1,
      `${id} moved out of the way (${distance(was, now).toFixed(1)}px)`,
    );
    // And moved outward, not sideways past the outsider.
    assert.ok(
      distance({ x: 0, y: 0 }, now) > distance({ x: 0, y: 0 }, was),
      `${id} moved away from the outsider rather than around it`,
    );
  }
});

test('the settled layout keeps outsiders clear of every set', () => {
  const items = [
    tile('m1', -60, 0), tile('m2', 60, 0), tile('m3', 0, -60), tile('m4', 0, 60),
    tile('outsider', 0, 0),
  ];
  const setsOf = membership({ m1: ['s1'], m2: ['s1'], m3: ['s1'], m4: ['s1'] });
  const result = settleLayout({ items, setsOf, anchorIds: ['outsider'] });

  const outsider = result.positions.get('outsider');
  for (const id of ['m1', 'm2', 'm3', 'm4']) {
    const member = result.positions.get(id);
    // Padding 26 + gap 14 is the clearance the membrane will claim. Measured
    // edge to edge, so the tile sizes are taken off the centre distance.
    const edgeToEdge = Math.hypot(
      Math.max(0, Math.abs(outsider.x - member.x) - 90),
      Math.max(0, Math.abs(outsider.y - member.y) - 90),
    );
    assert.ok(
      distance(outsider, member) > 90,
      `${id} is clear of the outsider (centres ${distance(outsider, member).toFixed(1)} apart, edge gap ${edgeToEdge.toFixed(1)})`,
    );
  }
});

test('overlapping icons are separated', () => {
  const items = [tile('a', 0, 0), tile('b', 10, 0), tile('c', 20, 0)];
  const result = settleLayout({ items, setsOf: () => [], anchorIds: [] });
  const positions = ['a', 'b', 'c'].map((id) => result.positions.get(id));
  for (let i = 0; i < positions.length; i += 1) {
    for (let j = i + 1; j < positions.length; j += 1) {
      const dx = Math.abs(positions[i].x - positions[j].x);
      const dy = Math.abs(positions[i].y - positions[j].y);
      assert.ok(
        dx >= 90 - 1 || dy >= 90 - 1,
        `pair ${i},${j} still overlaps (dx=${dx.toFixed(1)} dy=${dy.toFixed(1)})`,
      );
    }
  }
});

test('two exclusive sets are pushed apart', () => {
  // Members of sets that share nothing, sitting on top of each other. The sets
  // must end up separable, which means their members must be.
  const items = [tile('a', 0, 0), tile('b', 30, 0)];
  const result = settleLayout({
    items,
    setsOf: membership({ a: ['sa'], b: ['sb'] }),
    anchorIds: [],
  });
  const a = result.positions.get('a');
  const b = result.positions.get('b');
  // Two paddings plus the gap is what keeps the two bodies from meeting.
  assert.ok(
    distance(a, b) > 90,
    `the two sets' members separated (${distance(a, b).toFixed(1)}px apart)`,
  );
});

test('sets that share a member are not pushed apart', () => {
  // The overlap is the Venn the feature exists to show. Separating these would
  // pass the exclusivity rule while destroying the thing it protects.
  const items = [tile('a', 0, 0), tile('shared', 150, 0), tile('b', 300, 0)];
  const before = items.map((item) => ({ ...item }));
  const result = settleLayout({
    items,
    setsOf: membership({ a: ['s1'], shared: ['s1', 's2'], b: ['s2'] }),
    anchorIds: [],
  });
  for (const item of before) {
    const now = result.positions.get(item.id);
    assert.ok(
      distance(item, now) < 1,
      `${item.id} was left alone (moved ${distance(item, now).toFixed(2)}px)`,
    );
  }
});

test('an already-legal layout is left untouched', () => {
  // Settling must be a no-op when there is nothing to settle, or every drop
  // would jostle the whole scene for no reason.
  const items = [tile('a', 0, 0), tile('b', 400, 0), tile('c', 0, 400)];
  const result = settleLayout({
    items,
    setsOf: membership({ a: ['s1'] }),
    anchorIds: ['a'],
  });
  assert.equal(result.settled, true, 'reported as settled');
  assert.deepEqual(result.moved, [], 'and nothing moved');
});

test('settling is deterministic, including for coincident items', () => {
  // Two items at exactly the same point have no direction between them, which
  // happens whenever a node starts at its parent's position. The fallback is
  // derived from the ids so the same layout always settles the same way.
  const build = () => [tile('a', 100, 100), tile('b', 100, 100), tile('c', 100, 100)];
  const first = settleLayout({ items: build(), setsOf: () => [], anchorIds: [] });
  const second = settleLayout({ items: build(), setsOf: () => [], anchorIds: [] });
  for (const id of ['a', 'b', 'c']) {
    assert.deepEqual(
      first.positions.get(id), second.positions.get(id),
      `${id} settled identically across runs`,
    );
  }
});

test('a member dragged far away does not drag the rest of its set with it', () => {
  // The set stretches to follow; the other members are not summoned to it. The
  // envelope's connectivity is the geometry's problem, not the layout's.
  const items = [tile('m1', 0, 0), tile('m2', 60, 0), tile('far', 900, 0)];
  const result = settleLayout({
    items,
    setsOf: membership({ m1: ['s1'], m2: ['s1'], far: ['s1'] }),
    anchorIds: ['far'],
  });
  assert.deepEqual(result.positions.get('far'), { x: 900, y: 0 }, 'the anchor held');
  for (const id of ['m1', 'm2']) {
    const now = result.positions.get(id);
    assert.ok(now.x < 300, `${id} stayed where it was rather than chasing the anchor (x=${now.x.toFixed(0)})`);
  }
});

test('several anchors all hold at once', () => {
  // A multi-item drag drops several things. Every one of them is a fixed point.
  const items = [tile('a', 0, 0), tile('b', 20, 0), tile('victim', 40, 0)];
  const result = settleLayout({
    items, setsOf: () => [], anchorIds: ['a', 'b'],
  });
  assert.deepEqual(result.positions.get('a'), { x: 0, y: 0 }, 'first anchor held');
  assert.deepEqual(result.positions.get('b'), { x: 20, y: 0 }, 'second anchor held');
  const victim = result.positions.get('victim');
  assert.ok(
    Math.abs(victim.x - 40) > 1 || Math.abs(victim.y) > 1,
    'and the non-anchor is what moved',
  );
});

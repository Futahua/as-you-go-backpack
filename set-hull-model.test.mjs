import assert from 'node:assert/strict';
import test from 'node:test';
import {
  convexHull,
  clusterMembers,
  rectGap,
  memberCorners,
  expandFromCentroid,
  centroid,
  seedFor,
  wobble,
  closedCurvePath,
  setOutlinePath,
  safePadding,
  polygonIntersectsRect,
  setsIntersectingRect,
  pointInPolygon,
  regionsAt,
} from './public/set-hull-model.js';

const rect = (x, y, width = 100, height = 60) => ({ x, y, width, height });

test('the hull of a square is its four corners', () => {
  const hull = convexHull([
    { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 },
    { x: 5, y: 5 },
  ]);
  assert.equal(hull.length, 4, 'the interior point is dropped');
});

test('the hull ignores duplicate points', () => {
  const hull = convexHull([
    { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 },
  ]);
  assert.equal(hull.length, 3);
});

test('fewer than three distinct points have no hull', () => {
  assert.equal(convexHull([{ x: 1, y: 1 }]).length, 1);
  assert.equal(convexHull([{ x: 1, y: 1 }, { x: 2, y: 2 }]).length, 2);
  assert.equal(convexHull([]).length, 0);
});

test('member corners enclose whole tiles, not just centres', () => {
  const corners = memberCorners([rect(0, 0, 100, 60)]);
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  assert.equal(Math.min(...xs), -50, 'reaches the tile edge');
  assert.equal(Math.max(...xs), 50);
  assert.equal(Math.min(...ys), -30);
  assert.equal(Math.max(...ys), 30);
});

test('padding pushes the corners outward', () => {
  const corners = memberCorners([rect(0, 0, 100, 60)], 20);
  assert.equal(Math.min(...corners.map((point) => point.x)), -70);
  assert.equal(Math.max(...corners.map((point) => point.y)), 50);
});

test('centroid averages the points', () => {
  assert.deepEqual(centroid([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]), { x: 5, y: 5 });
  assert.deepEqual(centroid([]), { x: 0, y: 0 });
});

test('expanding from the centroid grows the shape', () => {
  const square = [{ x: -10, y: -10 }, { x: 10, y: -10 }, { x: 10, y: 10 }, { x: -10, y: 10 }];
  const grown = expandFromCentroid(square, 5);
  for (const point of grown) {
    assert.ok(Math.hypot(point.x, point.y) > Math.hypot(10, 10), 'every point moved outward');
  }
});

test('a point exactly at the centroid is nudged rather than divided by zero', () => {
  const grown = expandFromCentroid([{ x: 0, y: 0 }], 5);
  assert.ok(Number.isFinite(grown[0].x) && Number.isFinite(grown[0].y));
});

test('the wobble seed is stable per id and differs between ids', () => {
  assert.equal(seedFor('set-a'), seedFor('set-a'), 'same set breathes the same way every time');
  assert.notEqual(seedFor('set-a'), seedFor('set-b'));
  assert.ok(seedFor('set-a') >= 0 && seedFor('set-a') < 1);
});

test('the wobble is deterministic in id and time', () => {
  const square = [{ x: -10, y: -10 }, { x: 10, y: -10 }, { x: 10, y: 10 }, { x: -10, y: 10 }];
  const first = wobble(square, { seed: seedFor('s'), time: 1.5 });
  const again = wobble(square, { seed: seedFor('s'), time: 1.5 });
  assert.deepEqual(first, again, 'no hidden animation state, so a re-render never jumps');
  const later = wobble(square, { seed: seedFor('s'), time: 2.5 });
  assert.notDeepEqual(first, later, 'and it does move over time');
});

test('zero amplitude leaves the shape alone', () => {
  const square = [{ x: -10, y: -10 }, { x: 10, y: -10 }];
  assert.equal(wobble(square, { amplitude: 0 }), square);
});

test('the curve path is closed and starts with a move', () => {
  const path = closedCurvePath([
    { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 },
  ]);
  assert.ok(path.startsWith('M '), 'begins with a move');
  assert.ok(path.includes('C '), 'uses curves, not straight segments');
  assert.ok(path.endsWith('Z'), 'and closes');
});

test('an empty set has no path', () => {
  assert.equal(closedCurvePath([]), '');
  assert.equal(setOutlinePath([]), '');
});

test('a single member still produces an enclosing outline', () => {
  const path = setOutlinePath([rect(0, 0)], { id: 'solo' });
  assert.ok(path.startsWith('M ') && path.endsWith('Z'), 'a lone member is a shape, not a dot');
  assert.ok(path.length > 40, 'and has real geometry');
});

test('two members produce an outline rather than a line', () => {
  const path = setOutlinePath([rect(0, 0), rect(200, 0)], { id: 'pair' });
  assert.ok(path.includes('C '), 'a degenerate hull is expanded into an area');
});

test('the outline follows its members: moving one changes the path', () => {
  const before = setOutlinePath([rect(0, 0), rect(200, 0), rect(100, 150)], { id: 's' });
  const after = setOutlinePath([rect(0, 0), rect(200, 0), rect(100, 400)], { id: 's' });
  assert.notEqual(before, after, 'the boundary is derived, so it cannot desync');
});

test('the same members and time always give the same path', () => {
  const rects = [rect(0, 0), rect(200, 0), rect(100, 150)];
  assert.equal(
    setOutlinePath(rects, { id: 's', time: 3 }),
    setOutlinePath(rects, { id: 's', time: 3 }),
  );
});

test('different sets with identical members still wobble differently', () => {
  const rects = [rect(0, 0), rect(200, 0), rect(100, 150)];
  assert.notEqual(
    setOutlinePath(rects, { id: 'a', time: 1 }),
    setOutlinePath(rects, { id: 'b', time: 1 }),
    'so two overlapping sets do not pulse in lockstep',
  );
});

test('a point inside and outside a polygon is told apart', () => {
  const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  assert.equal(pointInPolygon({ x: 5, y: 5 }, square), true);
  assert.equal(pointInPolygon({ x: 15, y: 5 }, square), false);
  assert.equal(pointInPolygon({ x: 5, y: 15 }, square), false);
});

test('a degenerate polygon contains nothing', () => {
  assert.equal(pointInPolygon({ x: 0, y: 0 }, [{ x: 0, y: 0 }, { x: 1, y: 1 }]), false);
});

test('regionsAt reports every set whose region covers the point', () => {
  const left = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }];
  const right = [{ x: 10, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 20 }, { x: 10, y: 20 }];
  const regions = [{ id: 'a', polygon: left }, { id: 'b', polygon: right }];
  assert.deepEqual(regionsAt({ x: 5, y: 10 }, regions), ['a'], 'left only');
  assert.deepEqual(regionsAt({ x: 25, y: 10 }, regions), ['b'], 'right only');
  assert.deepEqual(regionsAt({ x: 15, y: 10 }, regions), ['a', 'b'], 'the overlap reports both');
  assert.deepEqual(regionsAt({ x: 50, y: 50 }, regions), [], 'open space reports none');
});

// ===========================================================================
// Non-members must stay outside. A convex hull over every member necessarily
// contains everything between them, so members are clustered first and each
// cluster gets its own lobe.
// ===========================================================================

test('rectGap is zero for overlapping rects and grows with distance', () => {
  assert.equal(rectGap(rect(0, 0), rect(0, 0)), 0);
  assert.equal(rectGap(rect(0, 0, 100, 60), rect(150, 0, 100, 60)), 50, 'edge to edge, not centre to centre');
  assert.ok(rectGap(rect(0, 0), rect(1000, 0)) > 500);
});

test('nearby members share one lobe', () => {
  assert.equal(clusterMembers([rect(0, 0), rect(120, 0)], 150).length, 1);
});

test('distant members split into separate lobes', () => {
  assert.equal(
    clusterMembers([rect(0, 0), rect(900, 900)], 150).length, 2,
    'so the space between them is not claimed',
  );
});

test('clustering is transitive: a chain of near members is one lobe', () => {
  const chain = [rect(0, 0), rect(120, 0), rect(240, 0), rect(360, 0)];
  assert.equal(clusterMembers(chain, 150).length, 1);
});

test('a non-member sitting between two distant members is not enclosed', () => {
  const apps = rect(0, 0);
  const letters = rect(600, 600);
  const between = { x: 300, y: 300 };
  const claimed = clusterMembers([apps, letters], 150)
    .some((cluster) => pointInPolygon(between, convexHull(memberCorners(cluster, 26))));
  assert.equal(claimed, false, 'the reported bug: an unpicked item swallowed by the outline');
});

test('the rendered path itself leaves an in-between non-member outside', () => {
  // Goes through setOutlinePath rather than the pieces, so removing the
  // clustering step is caught even if the helpers stay correct.
  const path = setOutlinePath([rect(0, 0), rect(600, 600)], { id: 's', amplitude: 0 });
  const lobes = path.split('M ').filter(Boolean).length;
  assert.equal(lobes, 2, 'two separate shapes, not one hull spanning the gap');
  // A single hull would span roughly x 0..600; two lobes leave the middle open.
  const numbers = path.match(/-?\d+(\.\d+)?/g).map(Number);
  const spansMiddle = numbers.some((value) => value > 250 && value < 350);
  assert.equal(spansMiddle, false, 'no geometry sits in the gap between the members');
});

test('a member is always inside its own lobe', () => {
  const apps = rect(0, 0);
  const letters = rect(600, 600);
  for (const member of [apps, letters]) {
    const inside = clusterMembers([apps, letters], 150)
      .some((cluster) => pointInPolygon({ x: member.x, y: member.y }, convexHull(memberCorners(cluster, 26))));
    assert.equal(inside, true, 'members are never left outside their own set');
  }
});

test('a multi-lobe set is one path with several closed shapes', () => {
  const path = setOutlinePath([rect(0, 0), rect(900, 900)], { id: 's' });
  assert.equal((path.match(/M /g) ?? []).length, 2, 'two lobes');
  assert.equal((path.match(/Z/g) ?? []).length, 2, 'both closed');
});

test('separate lobes of one set do not breathe in lockstep', () => {
  const path = setOutlinePath([rect(0, 0), rect(900, 900)], { id: 's', time: 1 });
  const [first, second] = path.split('M ').filter(Boolean);
  assert.notEqual(first, second, 'each lobe has its own phase');
});

test('a bigger reach merges what a smaller one separates', () => {
  const rects = [rect(0, 0), rect(400, 0)];
  assert.equal(clusterMembers(rects, 150).length, 2);
  assert.equal(clusterMembers(rects, 500).length, 1, 'reach is the tunable knob');
});

// ===========================================================================
// Exclusive sets must never blend. Two sets sharing no members always keep a
// visible gap, so you can see which items belong to which.
// ===========================================================================

/** Do two outlines overlap at all? */
function outlinesOverlap(rectsA, paddingA, rectsB, paddingB) {
  const a = convexHull(memberCorners(rectsA, paddingA));
  const b = convexHull(memberCorners(rectsB, paddingB));
  return a.some((point) => pointInPolygon(point, b))
    || b.some((point) => pointInPolygon(point, a));
}

test('two disjoint sets with adjacent members do not blend', () => {
  const a = [rect(0, 0)];
  const b = [rect(130, 0)];
  // Full padding would overlap: this is the bug the cap exists to prevent.
  assert.equal(outlinesOverlap(a, 26, b, 26), true, 'unrestricted padding merges them');
  const pa = safePadding(a, b);
  const pb = safePadding(b, a);
  assert.equal(outlinesOverlap(a, pa, b, pb), false, 'capped padding keeps them apart');
});

test('the gap between disjoint sets stays visible, not merely non-zero', () => {
  const a = [rect(0, 0)];
  const b = [rect(130, 0)];
  const hullA = convexHull(memberCorners(a, safePadding(a, b)));
  const hullB = convexHull(memberCorners(b, safePadding(b, a)));
  const gap = Math.min(...hullB.map((p) => p.x)) - Math.max(...hullA.map((p) => p.x));
  assert.ok(gap >= 10, `expected a readable gap, got ${gap}`);
});

test('padding yields entirely when there is no room for a halo', () => {
  const touching = safePadding([rect(0, 0)], [rect(101, 0)]);
  assert.equal(
    touching, 0,
    'keeping exclusive sets apart matters more than a minimum halo',
  );
});

test('a far-away foreign item does not constrain padding at all', () => {
  assert.equal(safePadding([rect(0, 0)], [rect(2000, 2000)]), 26, 'full padding when there is room');
});

test('no foreign items means no constraint', () => {
  assert.equal(safePadding([rect(0, 0)], []), 26);
});

test('a constrained outline hugs its hull more tightly than a free one', () => {
  const a = [rect(0, 0)];
  const free = setOutlinePath(a, { id: 's', time: 0 });
  const constrained = setOutlinePath(a, { id: 's', time: 0, foreignRects: [rect(130, 0)] });
  const maxOf = (path) => Math.max(...(path.match(/-?\d+(\.\d+)?/g) ?? []).map(Number));
  assert.ok(
    maxOf(constrained) < maxOf(free),
    'a neighbour pulls the outline in rather than being ignored',
  );
});

test('setOutlinePath without foreign items is unchanged', () => {
  const rects = [rect(0, 0), rect(120, 0)];
  assert.equal(
    setOutlinePath(rects, { id: 's', time: 1 }),
    setOutlinePath(rects, { id: 's', time: 1, foreignRects: [] }),
  );
});

test('a rectangle touching a polygon is detected however it overlaps', () => {
  const square = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }];
  assert.equal(polygonIntersectsRect(square, { left: 10, top: 10, right: 30, bottom: 30 }), true, 'corner overlap');
  assert.equal(polygonIntersectsRect(square, { left: -5, top: -5, right: 25, bottom: 25 }), true, 'polygon inside rect');
  assert.equal(polygonIntersectsRect(square, { left: 5, top: 5, right: 15, bottom: 15 }), true, 'rect inside polygon');
  assert.equal(polygonIntersectsRect(square, { left: -20, top: 5, right: 40, bottom: 8 }), true, 'crossing band');
  assert.equal(polygonIntersectsRect(square, { left: 50, top: 50, right: 60, bottom: 60 }), false, 'well clear');
});

test('a sweep catches every set outline it touches', () => {
  const left = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }];
  const right = [{ x: 100, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 20 }, { x: 100, y: 20 }];
  const regions = [{ id: 'a', polygon: left }, { id: 'b', polygon: right }];
  assert.deepEqual(setsIntersectingRect(regions, { left: 5, top: 5, right: 10, bottom: 10 }), ['a']);
  assert.deepEqual(setsIntersectingRect(regions, { left: -10, top: -10, right: 200, bottom: 50 }), ['a', 'b'], 'a wide sweep takes both');
  assert.deepEqual(setsIntersectingRect(regions, { left: 40, top: 40, right: 60, bottom: 60 }), [], 'empty space catches nothing');
});

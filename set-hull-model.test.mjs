import assert from 'node:assert/strict';
import test from 'node:test';
import {
  convexHull,
  memberCorners,
  expandFromCentroid,
  centroid,
  seedFor,
  wobble,
  closedCurvePath,
  setOutlinePath,
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

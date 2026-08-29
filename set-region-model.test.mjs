import assert from 'node:assert/strict';
import test from 'node:test';
import { decomposeRegions, regionArea, regionCentroid } from './public/set-region-model.js';
import { ringHull, pointInsideRing } from './public/set-ring-model.js';
import { forceSetExclusion, forceSetSeparation } from './public/set-gravity-model.js';
import { assignSpatialFolderHues, MIN_HUE_SEPARATION } from './public/graph-model-20260730b.js';

const square = (x, y, size = 10) => [
  { x, y }, { x: x + size, y }, { x: x + size, y: y + size }, { x, y: y + size },
];

test('two overlapping convex sets produce three mask regions with separate lens', () => {
  const regions = decomposeRegions([
    { id: 'A', outline: square(0, 0) },
    { id: 'B', outline: square(5, 0) },
  ]);
  assert.deepEqual(regions.map(({ id }) => id), ['A', 'A|B', 'B']);
  assert.ok(regions.every((region) => regionArea(region) > 0));
  const lens = regions.find((region) => region.id === 'A|B');
  assert.deepEqual(regionCentroid(lens), { x: 7.5, y: 5 });
});

test('three overlapping convex sets include the centre and every non-empty mask', () => {
  const regions = decomposeRegions([
    { id: 'A', outline: square(0, 0) },
    { id: 'B', outline: square(5, 0) },
    { id: 'C', outline: square(2, 4) },
  ]);
  assert.equal(regions.length, 7);
  assert.ok(regions.some(({ id }) => id === 'A|B|C'));
  assert.ok(regions.every((region) => regionArea(region) > 0));
});

test('disjoint sets have one region each and ids do not depend on input order', () => {
  const first = decomposeRegions([
    { id: 'B', outline: square(30, 0) },
    { id: 'A', outline: square(0, 0) },
  ]);
  const second = decomposeRegions([
    { id: 'A', outline: square(0, 0) },
    { id: 'B', outline: square(30, 0) },
  ]);
  assert.deepEqual(first.map(({ id }) => id), ['A', 'B']);
  assert.deepEqual(first.map(({ id }) => id), second.map(({ id }) => id));
  assert.deepEqual(first.map(regionCentroid), second.map(regionCentroid));
});

test('nearby regions keep distinct stable entity ids for the hue solver', () => {
  const regions = decomposeRegions([
    { id: 'set:one', outline: square(0, 0) },
    { id: 'set:two', outline: square(5, 0) },
  ]);
  assert.equal(new Set(regions.map(({ id }) => `region:${id}`)).size, 3);
  assert.ok(regions.every(({ id }) => !id.includes('set:set')));
});

test('region entities participate in the same minimum hue separation solver', () => {
  const regions = decomposeRegions([
    { id: 'A', outline: square(0, 0) },
    { id: 'B', outline: square(5, 0) },
  ]);
  const colors = new Map();
  const nodes = regions.map((region) => ({ id: `region:${region.id}`, ...regionCentroid(region) }));
  assignSpatialFolderHues(nodes, colors, { cx: 5, cy: 5 });
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const delta = Math.abs(((colors.get(nodes[i].id) - colors.get(nodes[j].id) + 540) % 360) - 180);
      assert.ok(delta >= MIN_HUE_SEPARATION - 1e-6);
    }
  }
});

test('region rendering leaves hull, containment, hit-test, exclusion, and separation byte-identical', () => {
  const sets = [
    { id: 'A', outline: square(0, 0) },
    { id: 'B', outline: square(5, 0) },
  ];
  const physicalSnapshot = () => {
    const hulls = new Map(sets.map((set) => [set.id, ringHull(set.outline)]));
    const hit = ['A', 'B']
      .filter((id) => pointInsideRing({ x: 7, y: 5 }, hulls.get(id)))
      .sort((a, b) => hulls.get(a).length - hulls.get(b).length);
    const excluded = [{ id: 'foreign', x: 7, y: 5, vx: 0, vy: 0 }];
    const exclusion = forceSetExclusion({
      setsOf: () => ['A'],
      membersOf: () => [],
      hullOf: (id) => hulls.get(id),
      clearance: 10,
    });
    exclusion.initialize(excluded);
    exclusion(1);
    const ringNodes = ['A', 'B'].flatMap((id) => hulls.get(id).map((point, index) => ({
      id: `${id}:${index}`, x: point.x, y: point.y, vx: 0, vy: 0, ring: true,
    })));
    const separation = forceSetSeparation({
      setsOf: () => [],
      hullOf: (id) => hulls.get(id),
    });
    separation.initialize(ringNodes);
    separation(1);
    return JSON.stringify({ hulls: [...hulls], hit, exclusion: excluded, separation: ringNodes });
  };
  const before = physicalSnapshot();
  decomposeRegions(sets);
  const after = physicalSnapshot();
  assert.equal(after, before);
  assert.deepEqual(sets.map((set) => set.outline), [square(0, 0), square(5, 0)]);
});

// Regression cover for the fourth-set brick. Production outlines are
// resampleHull'd to 48 vertices, and the old subtraction clipped every edge
// against the *original* piece rather than the remainder: the exterior pieces
// overlapped, so areas double-counted, and each excluded set multiplied the
// piece count by 48. Three sets stayed survivable; the fourth added a third
// excluded set and buried the frame under ~54k fragments.
const circle = (cx, cy, radius, count = 48) => Array.from({ length: count }, (_, index) => {
  const angle = (index / count) * Math.PI * 2;
  return { x: cx + (radius * Math.cos(angle)), y: cy + (radius * Math.sin(angle)) };
});

const piecewiseArea = (region) => region.polygons.reduce((total, polygon) => {
  let doubled = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    doubled += (current.x * next.y) - (next.x * current.y);
  }
  return total + Math.abs(doubled / 2);
}, 0);

test('subtracting a fully contained set leaves the true remaining area, not overlapping strips', () => {
  const regions = decomposeRegions([
    { id: 'A', outline: square(0, 0, 20) },
    { id: 'B', outline: square(5, 5, 10) },
  ]);
  assert.deepEqual(regions.map(({ id }) => id), ['A', 'A|B']);
  // 400 - 100. Four independent exterior half-planes each covered 100 units of
  // A and overlapped at the corners, which reported the whole 400 back.
  assert.equal(regionArea(regions.find(({ id }) => id === 'A')), 300);
  assert.equal(regionArea(regions.find(({ id }) => id === 'A|B')), 100);
});

test('difference pieces partition the region instead of overlapping each other', () => {
  const [aOnly] = decomposeRegions([
    { id: 'A', outline: square(0, 0, 20) },
    { id: 'B', outline: square(5, 5, 10) },
  ]);
  // A partition's piece areas sum to the region area; overlapping strips exceed it.
  assert.equal(piecewiseArea(aOnly), 300);
  assert.equal(piecewiseArea(aOnly), regionArea(aOnly));
});

test('four disjoint production-resolution sets stay one polygon per region', () => {
  const regions = decomposeRegions(['A', 'B', 'C', 'D'].map((id, index) => ({
    id,
    outline: circle(index * 500, 0, 100),
  })));
  assert.deepEqual(regions.map(({ id }) => id), ['A', 'B', 'C', 'D']);
  // Was 54,208 fragments across these four regions.
  assert.deepEqual(regions.map((region) => region.polygons.length), [1, 1, 1, 1]);
});

test('four overlapping production-resolution sets stay within a bounded fragment count', () => {
  const regions = decomposeRegions(['A', 'B', 'C', 'D'].map((id, index) => ({
    id,
    outline: circle(index * 60, (index % 2) * 40, 100),
  })));
  assert.ok(regions.some(({ id }) => id === 'A|B'));
  assert.ok(regions.some(({ id }) => id === 'A|B|C|D'));
  const fragments = regions.reduce((total, region) => total + region.polygons.length, 0);
  // Was 29,947. The bound is what keeps a fourth G group off the frame budget;
  // it is deliberately loose so ordinary geometry churn does not redden it.
  assert.ok(fragments < 2000, 'expected a bounded fragment count, got ' + fragments);
});

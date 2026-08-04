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

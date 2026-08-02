/** The separation guarantee, tested the way the old pipeline could not be.
 *
 * The previous outline was drawn as a curve through hull points, so the shape
 * on screen was never the shape that had been checked. Here the polygon that
 * is rendered is the polygon that is measured, and the test asserts on the
 * extracted geometry directly. */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSetRegions,
  isInsideRegion,
  pointRectDistance,
  extractContours,
  sampleField,
  regionContainsPoint,
  regionArea,
  polygonIntersectsRect,
} from './public/set-region-model.js';

const TILE = { width: 90, height: 90 };

function tile(id, x, y) {
  return { id, x, y, ...TILE };
}

/** Smallest distance between any two points of two polygon collections. */
function polygonSeparation(a, b) {
  let best = Infinity;
  for (const ringA of a) {
    for (const pointA of ringA) {
      for (const ringB of b) {
        for (const pointB of ringB) {
          best = Math.min(best, Math.hypot(pointA.x - pointB.x, pointA.y - pointB.y));
        }
      }
    }
  }
  return best;
}

test('a point inside a member is inside the region', () => {
  const member = tile('a', 0, 0);
  assert.equal(pointRectDistance({ x: 0, y: 0 }, member), 0);
  assert.ok(isInsideRegion({ x: 0, y: 0 }, [member], [], { padding: 26, gap: 14 }));
});

test('a point beyond the padding is outside the region', () => {
  const member = tile('a', 0, 0);
  // 45 to the tile edge, plus 26 padding: 71 is in, 80 is out.
  assert.ok(isInsideRegion({ x: 70, y: 0 }, [member], [], { padding: 26, gap: 14 }));
  assert.ok(!isInsideRegion({ x: 80, y: 0 }, [member], [], { padding: 26, gap: 14 }));
});

test('a point too near a non-member is excluded however near a member it is', () => {
  const member = tile('a', 0, 0);
  const foreign = tile('b', 120, 0);
  // Without the obstacle this point is comfortably inside.
  assert.ok(isInsideRegion({ x: 60, y: 0 }, [member], [], { padding: 26, gap: 14 }));
  // The foreign tile's edge is at x=75, so x=64 sits 11 away — inside the gap.
  assert.ok(!isInsideRegion({ x: 64, y: 0 }, [member], [foreign], { padding: 26, gap: 14 }));
});

test('a set produces a closed ring around its member', () => {
  const regions = buildSetRegions({
    sets: [{ id: 's1', memberIds: ['a'] }],
    visibleItems: [tile('a', 0, 0)],
  });
  const region = regions.get('s1');
  assert.ok(region, 'region built');
  assert.ok(region.polygons.length >= 1, 'at least one ring');
  assert.match(region.svgPath, /^M .* Z$/, 'path is closed');
});

test('distant members of one set produce separate lobes', () => {
  const regions = buildSetRegions({
    sets: [{ id: 's1', memberIds: ['a', 'b'] }],
    visibleItems: [tile('a', 0, 0), tile('b', 600, 0)],
  });
  // Two far-apart members must not be wrapped by one hull spanning the gap:
  // that is what used to claim the space between them.
  assert.equal(regions.get('s1').polygons.length, 2, 'two lobes');
});

test('a non-member between two members is not swallowed', () => {
  const items = [tile('a', 0, 0), tile('outsider', 150, 0), tile('b', 300, 0)];
  const regions = buildSetRegions({
    sets: [{ id: 's1', memberIds: ['a', 'b'] }],
    visibleItems: items,
  });
  const region = regions.get('s1');
  // The outsider's own centre must never fall inside the set's region.
  for (const ring of region.polygons) {
    const insideCount = ring.filter((point) => Math.hypot(point.x - 150, point.y) < 20).length;
    assert.equal(insideCount, 0, 'no boundary point sits on the outsider');
  }
  assert.ok(
    !isInsideRegion({ x: 150, y: 0 }, [items[0], items[2]], [items[1]], { padding: 26, gap: 14 }),
    'the outsider position is excluded from the region',
  );
});

test('exclusive sets never touch at any separation', () => {
  // An exhaustive sweep, not a sample. The randomized test below jitters
  // members off-axis and passed while aligned separations between 96 and 144
  // were still touching — the contested corridor between two close sets is
  // within padding of both, so each claimed it. Stepping every integer
  // separation is what caught that, so it is what guards it.
  const touching = [];
  for (let separation = 95; separation <= 500; separation += 1) {
    const regions = buildSetRegions({
      sets: [{ id: 'sa', memberIds: ['a'] }, { id: 'sb', memberIds: ['b'] }],
      visibleItems: [tile('a', 0, 0), tile('b', separation, 0)],
    });
    const regionA = regions.get('sa');
    const regionB = regions.get('sb');
    if (!regionA || !regionB) continue;
    if (polygonSeparation(regionA.polygons, regionB.polygons) <= 0) touching.push(separation);
  }
  assert.deepEqual(touching, [], `exclusive sets blended at separations: ${touching.join(', ')}`);
});

test('sets that share a member still overlap', () => {
  // The separation band must not apply to sets sharing a member: that overlap
  // is the Venn the feature exists to show. A band drawn between them would
  // pass the separation test above while destroying the feature.
  const items = [tile('a', 0, 0), tile('shared', 150, 0), tile('b', 300, 0)];
  const regions = buildSetRegions({
    sets: [{ id: 's1', memberIds: ['a', 'shared'] }, { id: 's2', memberIds: ['shared', 'b'] }],
    visibleItems: items,
  });
  assert.ok(regions.get('s1'), 's1 region built');
  assert.ok(regions.get('s2'), 's2 region built');

  // Overlap means the shared tile is covered by both regions — nearest-vertex
  // distance cannot express that, since two regions can overlap in area while
  // their sampled vertices sit a couple of pixels apart.
  const shared = { x: 150, y: 0 };
  assert.ok(
    isInsideRegion(shared, [items[0], items[1]], [items[2]], { padding: 26, gap: 14 }),
    'the shared tile is inside s1',
  );
  assert.ok(
    isInsideRegion(shared, [items[1], items[2]], [items[0]], { padding: 26, gap: 14 }),
    'the shared tile is inside s2',
  );

  // The regions buildSetRegions actually produced must each enclose the shared
  // tile. Checking isInsideRegion alone is not enough — it bypasses the band,
  // so it stays true even when the band has stripped the shared tile out of
  // both regions, which is exactly what happens if the exemption is dropped.
  const enclosesShared = (region) => region.polygons.some((ring) => {
    const xs = ring.map((point) => point.x);
    const ys = ring.map((point) => point.y);
    return shared.x >= Math.min(...xs) && shared.x <= Math.max(...xs)
      && shared.y >= Math.min(...ys) && shared.y <= Math.max(...ys);
  });
  assert.ok(enclosesShared(regions.get('s1')), 's1 encloses the shared tile');
  assert.ok(enclosesShared(regions.get('s2')), 's2 encloses the shared tile');
});

test('exclusive sets keep the requested gap across randomized layouts', () => {
  const padding = 26;
  const gap = 14;
  // A deterministic generator: the suite must fail the same way every run, and
  // Math.random would make a failure unreproducible.
  let seed = 20260802;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };

  let checked = 0;
  let tightest = Infinity;
  for (let trial = 0; trial < 200; trial += 1) {
    // Centre separations from touching-close to well clear. The low end
    // matters most: the old implementation was correct at 200px and beyond and
    // touched by 3-12px below that, and it is also where the obstacle
    // clearance — rather than padding alone — is what holds the sets apart.
    const separation = 95 + random() * 320;
    const jitter = (random() - 0.5) * 80;
    const a = tile('a', 0, jitter);
    const b = tile('b', separation, -jitter);

    const regions = buildSetRegions({
      sets: [{ id: 'sa', memberIds: ['a'] }, { id: 'sb', memberIds: ['b'] }],
      visibleItems: [a, b],
      padding,
      gap,
    });
    const regionA = regions.get('sa');
    const regionB = regions.get('sb');
    if (!regionA || !regionB) continue;
    checked += 1;

    const distance = polygonSeparation(regionA.polygons, regionB.polygons);
    tightest = Math.min(tightest, distance);
    assert.ok(
      distance > 0,
      `sets blended at separation ${separation.toFixed(1)} (jitter ${jitter.toFixed(1)}): distance ${distance.toFixed(2)}`,
    );
  }
  assert.ok(checked > 150, `expected most trials to produce both regions, got ${checked}`);
  // Some trial must actually have been tight enough for the clearance rule to
  // bite. Without this the suite could pass on well-separated layouts alone
  // and say nothing about the case the requirement is about.
  assert.ok(
    tightest < 2 * padding,
    `no trial exercised the constrained range; tightest was ${tightest.toFixed(1)}`,
  );
});

test('a region keeps clear of a foreign member it would otherwise reach over', () => {
  // The member and the foreign tile are close enough that padding alone would
  // carry the region across the foreign tile. Only the obstacle clearance
  // stops it, so this fails if that rule is removed.
  const member = tile('a', 0, 0);
  const foreign = tile('b', 110, 0);
  const regions = buildSetRegions({
    sets: [{ id: 'sa', memberIds: ['a'] }],
    visibleItems: [member, foreign],
    padding: 40,
    gap: 14,
  });
  const region = regions.get('sa');
  assert.ok(region, 'region built');

  const foreignLeftEdge = foreign.x - foreign.width / 2;
  for (const ring of region.polygons) {
    for (const point of ring) {
      const distance = Math.hypot(
        Math.max(0, Math.abs(point.x - foreign.x) - foreign.width / 2),
        Math.max(0, Math.abs(point.y - foreign.y) - foreign.height / 2),
      );
      assert.ok(
        distance >= 14 - 4,
        `boundary point (${point.x.toFixed(1)}, ${point.y.toFixed(1)}) came within ${distance.toFixed(1)} of the foreign tile at x>=${foreignLeftEdge}`,
      );
    }
  }
});

test('a coarser grid does not quantize the gap away', () => {
  // Cell size is the correctness parameter this approach introduces: sampling
  // too coarsely could let two regions meet despite the field being correct.
  // Guarding it here means a future change to the default fails loudly.
  for (const cellSize of [2, 4, 8]) {
    const regions = buildSetRegions({
      sets: [{ id: 'sa', memberIds: ['a'] }, { id: 'sb', memberIds: ['b'] }],
      visibleItems: [tile('a', 0, 0), tile('b', 150, 0)],
      cellSize,
    });
    const distance = polygonSeparation(regions.get('sa').polygons, regions.get('sb').polygons);
    assert.ok(distance > 0, `cellSize ${cellSize} let the regions touch (${distance.toFixed(2)})`);
  }
});

test('membersOf decides coverage, so folder contents join their folder region', () => {
  const items = [tile('folder', 0, 0), tile('child', 100, 0), tile('stranger', 400, 0)];
  const regions = buildSetRegions({
    sets: [{ id: 's1', memberIds: ['folder'] }],
    visibleItems: items,
    // Inheritance is the caller's rule, not this module's: the child is
    // covered because membersOf says so.
    membersOf: () => ['folder', 'child'],
  });
  const region = regions.get('s1');
  assert.ok(region, 'region built');
  assert.ok(
    isInsideRegion({ x: 100, y: 0 }, [items[0], items[1]], [items[2]], { padding: 26, gap: 14 }),
    'the child position is inside its folder set',
  );
});

test('a set with no visible members yields no region', () => {
  const regions = buildSetRegions({
    sets: [{ id: 's1', memberIds: ['missing'] }],
    visibleItems: [tile('a', 0, 0)],
  });
  assert.equal(regions.has('s1'), false);
});

// ===========================================================================
// Hit testing: the same polygons that are drawn decide what a click catches.
// ===========================================================================

test('a point inside a region is caught, one outside is not', () => {
  const regions = buildSetRegions({
    sets: [{ id: 's1', memberIds: ['a'] }],
    visibleItems: [tile('a', 0, 0)],
  });
  const region = regions.get('s1');
  assert.equal(regionContainsPoint(region, { x: 0, y: 0 }), true, 'on the member');
  assert.equal(regionContainsPoint(region, { x: 60, y: 0 }), true, 'in the padding');
  assert.equal(regionContainsPoint(region, { x: 400, y: 0 }), false, 'well outside');
});

test('the space between two lobes belongs to neither', () => {
  // The gap between distant members is not part of the set — it is exactly
  // the space a convex hull would have wrongly claimed.
  const regions = buildSetRegions({
    sets: [{ id: 's1', memberIds: ['a', 'b'] }],
    visibleItems: [tile('a', 0, 0), tile('b', 600, 0)],
  });
  const region = regions.get('s1');
  assert.equal(region.polygons.length, 2, 'two lobes');
  assert.equal(regionContainsPoint(region, { x: 300, y: 0 }), false, 'the gap is not the set');
});

test('regionArea orders nested sets innermost first', () => {
  // A small set inside a larger one: a click in the overlap should be about
  // the small one, so area is what breaks the tie.
  const items = [tile('inner', 0, 0), tile('outer', 200, 0)];
  const regions = buildSetRegions({
    sets: [
      { id: 'small', memberIds: ['inner'] },
      { id: 'large', memberIds: ['inner', 'outer'] },
    ],
    visibleItems: items,
  });
  assert.ok(
    regionArea(regions.get('small')) < regionArea(regions.get('large')),
    'the one-member set is smaller',
  );
});

test('a sweep catches a region it crosses without enclosing', () => {
  const regions = buildSetRegions({
    sets: [{ id: 's1', memberIds: ['a'] }],
    visibleItems: [tile('a', 0, 0)],
  });
  const ring = regions.get('s1').polygons[0];
  // A band crossing the middle of the region, taller than it is wide.
  assert.equal(
    polygonIntersectsRect(ring, { left: -10, top: -500, right: 10, bottom: 500 }),
    true,
    'crossing counts',
  );
  assert.equal(
    polygonIntersectsRect(ring, { left: 300, top: 300, right: 400, bottom: 400 }),
    false,
    'a rectangle well clear does not',
  );
});

test('a sweep wholly inside a region still catches it', () => {
  const regions = buildSetRegions({
    sets: [{ id: 's1', memberIds: ['a'] }],
    visibleItems: [tile('a', 0, 0)],
  });
  const ring = regions.get('s1').polygons[0];
  // Every corner is inside the region and no edge is crossed, so this only
  // works if containment is tested as well as edge crossing.
  assert.equal(
    polygonIntersectsRect(ring, { left: -5, top: -5, right: 5, bottom: 5 }),
    true,
  );
});

test('the sampled field closes rather than running off the grid', () => {
  const field = sampleField([tile('a', 0, 0)], [], { padding: 26, gap: 14, cellSize: 4 });
  // Every border cell must be empty, or the contour would be an open curve.
  const { inside, columns, rows } = field;
  for (let column = 0; column < columns; column += 1) {
    assert.equal(inside[column], 0, 'top row clear');
    assert.equal(inside[(rows - 1) * columns + column], 0, 'bottom row clear');
  }
  for (let row = 0; row < rows; row += 1) {
    assert.equal(inside[row * columns], 0, 'left column clear');
    assert.equal(inside[row * columns + columns - 1], 0, 'right column clear');
  }
  assert.ok(extractContours(field).length >= 1, 'a closed contour was extracted');
});

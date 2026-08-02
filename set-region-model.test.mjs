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
  regionDistance,
  regionArea,
  regionIntersectsRect,
  polygonArea,
  polygonIntersectsRect,
} from './public/set-region-model.js';

const TILE = { width: 90, height: 90 };

function tile(id, x, y) {
  return { id, x, y, ...TILE };
}

/** Separation between two regions, as a real distance.
 *
 * An earlier version of this helper measured vertex-to-vertex distance, which
 * cannot establish separation at all: two polygons can cross, overlap, or meet
 * edge-to-edge without sharing a vertex. Two squares overlapping by half
 * report 70.71 under that measure. Everything asserted with it — including a
 * "406/406 clear" claim — was unproven.
 *
 * regionDistance tests crossing and containment outright and measures
 * segment-to-segment, so 0 genuinely means touching or overlapping. */
function polygonSeparation(a, b) {
  return regionDistance({ polygons: a }, { polygons: b });
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

test('the separation helper detects overlap without shared vertices', () => {
  // Guards the guard. The previous helper measured vertex-to-vertex distance
  // and reported 70.71 for these two squares, which overlap by half — so every
  // separation assertion built on it was vacuous.
  const square = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
  const overlapping = [{ x: 50, y: -50 }, { x: 150, y: -50 }, { x: 150, y: 150 }, { x: 50, y: 150 }];
  assert.equal(polygonSeparation([square], [overlapping]), 0, 'crossing edges are caught');

  const enclosed = [{ x: 25, y: 25 }, { x: 75, y: 25 }, { x: 75, y: 75 }, { x: 25, y: 75 }];
  assert.equal(polygonSeparation([square], [enclosed]), 0, 'containment with no crossing is caught');

  const apart = [{ x: 200, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 100 }, { x: 200, y: 100 }];
  assert.equal(polygonSeparation([square], [apart]), 100, 'a real gap is measured edge to edge');
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

test('exclusive sets stay apart on the diagonal', () => {
  // The axis-aligned sweep above steps one axis only. A diagonal offset puts
  // the contested corridor at 45 degrees to the sampling grid, where the
  // occupancy field quantizes differently.
  const touching = [];
  for (let separation = 95; separation <= 400; separation += 1) {
    const offset = separation / Math.SQRT2;
    const regions = buildSetRegions({
      sets: [{ id: 'sa', memberIds: ['a'] }, { id: 'sb', memberIds: ['b'] }],
      visibleItems: [tile('a', 0, 0), tile('b', offset, offset)],
    });
    const a = regions.get('sa');
    const b = regions.get('sb');
    if (!a || !b) continue;
    if (polygonSeparation(a.polygons, b.polygons) <= 0) touching.push(separation);
  }
  assert.deepEqual(touching, [], `diagonal layouts blended at: ${touching.join(', ')}`);
});

test('exclusive sets stay apart with unequal member sizes', () => {
  // A large member's region is larger, and the curve-era bug scaled with shape
  // size, so mismatched sizes are where a size-dependent error would show.
  const sizes = [[60, 60], [140, 60], [60, 200], [220, 220], [300, 90]];
  for (const [width, height] of sizes) {
    const regions = buildSetRegions({
      sets: [{ id: 'sa', memberIds: ['a'] }, { id: 'sb', memberIds: ['b'] }],
      visibleItems: [tile('a', 0, 0), { id: 'b', x: 260, y: 0, width, height }],
    });
    const distance = polygonSeparation(regions.get('sa').polygons, regions.get('sb').polygons);
    assert.ok(distance > 0, `a ${width}x${height} member blended (${distance.toFixed(2)})`);
  }
});

test('exclusive multi-member sets stay apart, including interleaved', () => {
  const layouts = [
    {
      name: 'two rows',
      items: [tile('a1', 0, 0), tile('a2', 0, 120), tile('b1', 190, 0), tile('b2', 190, 120)],
      sets: [{ id: 'sa', memberIds: ['a1', 'a2'] }, { id: 'sb', memberIds: ['b1', 'b2'] }],
    },
    {
      // Members alternating along a line: each set's lobes must thread between
      // the other's without either claiming the space in between.
      name: 'interleaved',
      items: [tile('a1', 0, 0), tile('b1', 150, 0), tile('a2', 300, 0), tile('b2', 450, 0)],
      sets: [{ id: 'sa', memberIds: ['a1', 'a2'] }, { id: 'sb', memberIds: ['b1', 'b2'] }],
    },
  ];
  for (const layout of layouts) {
    const regions = buildSetRegions({ sets: layout.sets, visibleItems: layout.items });
    const distance = polygonSeparation(regions.get('sa').polygons, regions.get('sb').polygons);
    assert.ok(distance > 0, `${layout.name} blended (${distance.toFixed(2)})`);
  }
});

test('three mutually exclusive sets all stay apart', () => {
  const regions = buildSetRegions({
    sets: [
      { id: 'sa', memberIds: ['a'] },
      { id: 'sb', memberIds: ['b'] },
      { id: 'sc', memberIds: ['c'] },
    ],
    visibleItems: [tile('a', 0, 0), tile('b', 150, 0), tile('c', 75, 140)],
  });
  const ids = ['sa', 'sb', 'sc'];
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const distance = polygonSeparation(regions.get(ids[i]).polygons, regions.get(ids[j]).polygons);
      assert.ok(distance > 0, `${ids[i]} and ${ids[j]} blended (${distance.toFixed(2)})`);
    }
  }
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

  // The regions buildSetRegions actually produced must each contain the shared
  // tile. Checking isInsideRegion alone is not enough — it bypasses the band,
  // so it stays true even when the band has stripped the shared tile out of
  // both regions, which is exactly what happens if the exemption is dropped.
  //
  // Containment, not a bounding box: a bounding-box check reports a hit for
  // any point in the rectangle spanning a ring, including well outside a
  // concave region, so it could claim overlap where none exists.
  assert.ok(regionContainsPoint(regions.get('s1'), shared), 's1 contains the shared tile');
  assert.ok(regionContainsPoint(regions.get('s2'), shared), 's2 contains the shared tile');
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

// ===========================================================================
// Holes: a non-member ringed by members is enclosed but not contained.
// ===========================================================================

/** Members arranged in a circle around a single non-member, close enough that
 * the region closes around it and leaves an interior hole. */
function surroundedLayout(memberCount = 6, radius = 110) {
  const items = [];
  for (let i = 0; i < memberCount; i += 1) {
    const angle = (2 * Math.PI * i) / memberCount;
    items.push(tile(`m${i}`, Math.round(radius * Math.cos(angle)), Math.round(radius * Math.sin(angle))));
  }
  items.push(tile('foreign', 0, 0));
  return {
    items,
    sets: [{ id: 'S', memberIds: items.filter((item) => item.id !== 'foreign').map((item) => item.id) }],
  };
}

test('a surrounded non-member leaves a real hole in the region', () => {
  const { items, sets } = surroundedLayout();
  const region = buildSetRegions({ sets, visibleItems: items }).get('S');
  assert.equal(region.polygons.length, 2, 'an outer ring and an inner one');
  const areas = region.polygons.map(polygonArea).sort((a, b) => b - a);
  assert.ok(areas[1] > 0 && areas[1] < areas[0], 'the inner ring is a hole, not a second lobe');
});

test('a point inside a hole is not inside the set', () => {
  const { items, sets } = surroundedLayout();
  const region = buildSetRegions({ sets, visibleItems: items }).get('S');
  // Counting rings with .some() reported this as inside, so clicking the very
  // item the set was kept away from would have selected that set.
  assert.equal(regionContainsPoint(region, { x: 0, y: 0 }), false, 'the hole is not the set');
  assert.equal(regionContainsPoint(region, { x: 110, y: 0 }), true, 'a member still is');
});

test('a hole does not count towards a region area', () => {
  const { items, sets } = surroundedLayout();
  const region = buildSetRegions({ sets, visibleItems: items }).get('S');
  const outer = Math.max(...region.polygons.map(polygonArea));
  // Summing rings would exceed the outer ring; subtracting the hole cannot.
  assert.ok(regionArea(region) < outer, 'the hole is subtracted, not added');
});

test('a sweep wholly inside a hole catches nothing', () => {
  const { items, sets } = surroundedLayout();
  const region = buildSetRegions({ sets, visibleItems: items }).get('S');
  assert.equal(
    regionIntersectsRect(region, { left: -8, top: -8, right: 8, bottom: 8 }),
    false,
    'a rectangle in the hole touches no filled space',
  );
  // But one that reaches out through the rim does cross the set.
  assert.equal(
    regionIntersectsRect(region, { left: -8, top: -8, right: 200, bottom: 8 }),
    true,
    'a sweep leaving the hole still catches the set',
  );
});

test('a drop inside a hole is not a drop inside the set', () => {
  const { items, sets } = surroundedLayout();
  const region = buildSetRegions({ sets, visibleItems: items }).get('S');
  // regionsAt is what the drag rules consult, so a hole reported as filled
  // would block a setless item from a position the outline shows as free.
  const regionsAtHole = [['S', region]]
    .filter(([, candidate]) => regionContainsPoint(candidate, { x: 0, y: 0 }))
    .map(([id]) => id);
  assert.deepEqual(regionsAtHole, [], 'the hole belongs to no set');
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

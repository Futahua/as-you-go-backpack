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
  pointInPolygon,
  labelComponents,
  selectSpanningRoutes,
  foreignSeedDistance,
  fieldHasOccupiedBorder,
  regionFieldValue,
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

/** How many separate filled pieces a region has.
 *
 * Ring count is not the answer: a set with a hole in it has two rings and one
 * filled component. A ring is an outer boundary only when it sits inside an
 * even number of the others, which is the same even-odd rule the region is
 * rendered and hit-tested with. */
function filledComponentCount(region) {
  const rings = region?.polygons ?? [];
  let outer = 0;
  for (const ring of rings) {
    let depth = 0;
    for (const other of rings) {
      if (other === ring) continue;
      if (pointInPolygon(ring[0], other)) depth += 1;
    }
    if (depth % 2 === 0) outer += 1;
  }
  return outer;
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

test('distant members remain connected by a membrane neck', () => {
  // This replaces 'distant members of one set produce separate lobes'. That
  // requirement was wrong: live, two members drifting apart split into blobs
  // that no longer read as one set at all. A set is a closed membrane, so it
  // stretches instead of tearing.
  const regions = buildSetRegions({
    sets: [{ id: 's1', memberIds: ['a', 'b'] }],
    visibleItems: [tile('a', 0, 0), tile('b', 600, 0)],
  });
  const region = regions.get('s1');
  assert.equal(region.connected, true, 'the membrane is connected');
  assert.equal(filledComponentCount(region), 1, 'one filled component');
  // The neck is real membrane, not a drawn line: the midpoint between the two
  // members is inside the region that hit-testing consults.
  assert.equal(regionContainsPoint(region, { x: 300, y: 0 }), true, 'the neck is inside the set');
});

test('a neck is a thin corridor, not a hull claiming the space around it', () => {
  // The failure mode a hull would have: reclaiming everything between the
  // members. The neck must be narrow, so a point well off the axis joining
  // them stays outside.
  const regions = buildSetRegions({
    sets: [{ id: 's1', memberIds: ['a', 'b'] }],
    visibleItems: [tile('a', 0, 0), tile('b', 600, 0)],
  });
  const region = regions.get('s1');
  assert.equal(regionContainsPoint(region, { x: 300, y: 0 }), true, 'on the neck');
  assert.equal(regionContainsPoint(region, { x: 300, y: 120 }), false, 'well off the neck is not the set');
  assert.equal(regionContainsPoint(region, { x: 300, y: -120 }), false, 'nor on the other side');
});

test('three clusters are joined by a spanning tree, not by every pair', () => {
  // Three components need two necks. Connecting all three pairs would draw a
  // triangle of membrane through space no member occupies.
  const regions = buildSetRegions({
    sets: [{ id: 's1', memberIds: ['a', 'b', 'c'] }],
    visibleItems: [tile('a', 0, 0), tile('b', 500, 0), tile('c', 250, 430)],
  });
  const region = regions.get('s1');
  assert.equal(region.componentCount, 3, 'three seed components');
  assert.equal(region.connected, true, 'all joined');
  assert.equal(region.connectorRoutes.length, 2, 'n-1 connectors, not n(n-1)/2');
  assert.equal(filledComponentCount(region), 1, 'one filled component');
});

test('a connector routes around an exclusive set rather than through it', () => {
  // The other set sits squarely on the straight line between the two members,
  // so a neck taking the direct path would cross it.
  const items = [tile('a', 0, 0), tile('b', 620, 0), tile('x', 310, 0)];
  const regions = buildSetRegions({
    sets: [{ id: 's1', memberIds: ['a', 'b'] }, { id: 's2', memberIds: ['x'] }],
    visibleItems: items,
  });
  const region = regions.get('s1');
  const other = regions.get('s2');
  assert.equal(region.connected, true, 'still one membrane');
  assert.equal(filledComponentCount(region), 1, 'one filled component');
  assert.ok(region.connectorRoutes.length >= 1, 'a route was built');
  // Routed around, not through: no route cell may sit near the foreign tile.
  for (const route of region.connectorRoutes) {
    for (const point of route) {
      assert.ok(
        Math.hypot(
          Math.max(0, Math.abs(point.x - 310) - 45),
          Math.max(0, Math.abs(point.y) - 45),
        ) > 0,
        `a route cell at (${point.x}, ${point.y}) crossed the exclusive tile`,
      );
    }
  }
  assert.ok(
    polygonSeparation(region.polygons, other.polygons) > 0,
    'the two sets stayed apart despite the neck',
  );
});

test('exclusive sets stay apart once both grow connector necks', () => {
  // Interleaved members: each set must thread a neck past the other's without
  // the two membranes meeting.
  const items = [
    tile('a1', 0, 0), tile('b1', 210, 0), tile('a2', 420, 0), tile('b2', 630, 0),
  ];
  const regions = buildSetRegions({
    sets: [{ id: 'sa', memberIds: ['a1', 'a2'] }, { id: 'sb', memberIds: ['b1', 'b2'] }],
    visibleItems: items,
  });
  const a = regions.get('sa');
  const b = regions.get('sb');
  assert.ok(a.connectorRoutes.length >= 1, 'sa grew a neck');
  assert.ok(b.connectorRoutes.length >= 1, 'sb grew a neck');
  assert.ok(
    polygonSeparation(a.polygons, b.polygons) > 0,
    'interleaved membranes with necks still never touch',
  );
});

test('interleaved A B A B: one routes above, one below, neither merges', () => {
  // The canonical case, and the one that caught the defect this routing exists
  // to fix. Two sets alternating along a line: each has to reach past the
  // other's member to stay whole, and the only way both can is for one neck to
  // go above the row and the other below.
  //
  // It regressed silently for a while, and not through the routing at all. A
  // neck displaced by the other set's reserved corridor ran off the edge of its
  // own sampling grid; the contour could not close; the open chain came back as
  // two same-wound rings; and even-odd counting cancelled 1662 cells, so the
  // set read as overlapping the very set that had displaced it. Hence the
  // assertions on connectivity and on true separation together — either alone
  // would have passed while the region was inside out.
  const items = [tile('a1', 0, 0), tile('b1', 210, 0), tile('a2', 420, 0), tile('b2', 630, 0)];
  const regions = buildSetRegions({
    sets: [{ id: 'sa', memberIds: ['a1', 'a2'] }, { id: 'sb', memberIds: ['b1', 'b2'] }],
    visibleItems: items,
  });
  const a = regions.get('sa');
  const b = regions.get('sb');

  assert.equal(a.connected, true, 'sa is one membrane');
  assert.equal(b.connected, true, 'sb is one membrane');
  assert.equal(filledComponentCount(a), 1, 'sa has one filled component');
  assert.equal(filledComponentCount(b), 1, 'sb has one filled component');
  assert.ok(
    polygonSeparation(a.polygons, b.polygons) > 0,
    `interleaved membranes touched (${polygonSeparation(a.polygons, b.polygons).toFixed(2)})`,
  );

  // Opposite sides: the necks are what makes both connections possible, so
  // they cannot both take the same corridor.
  const side = (region) => Math.sign(
    region.connectorRoutes.flat().reduce((total, point) => total + point.y, 0),
  );
  assert.ok(a.connectorRoutes.length >= 1 && b.connectorRoutes.length >= 1, 'both grew necks');
  assert.notEqual(side(a), side(b), 'the two necks took opposite sides of the row');

  // Every member is inside its own set and outside the other.
  for (const [id, own, other] of [['a1', a, b], ['a2', a, b], ['b1', b, a], ['b2', b, a]]) {
    const item = items.find((entry) => entry.id === id);
    assert.equal(regionContainsPoint(own, item), true, `${id} is inside its own set`);
    assert.equal(regionContainsPoint(other, item), false, `${id} is outside the other set`);
  }
});

test('a wider connector still keeps its clearance', () => {
  // Thickening is what turns a legal centreline into an illegal membrane, so
  // the route is planned in configuration space: it must clear foreign
  // territory by the connector's own radius plus the gap, not merely the gap.
  // A wider neck therefore routes further out rather than overrunning.
  const items = [tile('a1', 0, 0), tile('b1', 210, 0), tile('a2', 420, 0), tile('b2', 630, 0)];
  const foreign = [items[1], items[3]];
  let widest = 0;
  for (const neckRadius of [6, 10, 14, 18]) {
    const regions = buildSetRegions({
      sets: [{ id: 'sa', memberIds: ['a1', 'a2'] }, { id: 'sb', memberIds: ['b1', 'b2'] }],
      visibleItems: items,
      neckRadius,
    });
    const a = regions.get('sa');
    const distance = polygonSeparation(a.polygons, regions.get('sb').polygons);
    assert.ok(distance > 0, `neckRadius ${neckRadius} let the membranes touch (${distance.toFixed(2)})`);

    // The centreline itself, against the foreign set's padded seed rather than
    // its raw tiles: two adjacent foreign tiles reach further than either does
    // alone, and a rectangle's corner reaches further than its face. Asserting
    // on separation alone would not catch a route planned against the tiles,
    // because the per-cell flesh clamp pinches such a neck instead of letting
    // it overrun — the region stays legal while the plan that produced it was
    // not, and the neck silently thins.
    for (const route of a.connectorRoutes) {
      for (const point of route) {
        const clearance = foreignSeedDistance(point, foreign, 26);
        widest = Math.max(widest, neckRadius);
        assert.ok(
          clearance >= neckRadius + 14 - 1e-6,
          `neckRadius ${neckRadius}: centreline at (${point.x.toFixed(1)}, ${point.y.toFixed(1)}) `
          + `cleared the foreign seed by only ${clearance.toFixed(2)}`,
        );
      }
    }
  }
  assert.equal(widest, 18, 'the widest connector was actually exercised');
});

test('an ordinary non-member does not punch a hole in a set', () => {
  // The old model made every visible non-member an obstacle, so a setless item
  // drifting between two members carved a permanent channel through the
  // outline. The membrane keeps such an item out by constraining its movement,
  // not by deforming around it.
  const items = [tile('a', 0, 0), tile('outsider', 150, 0), tile('b', 300, 0)];
  const regions = buildSetRegions({
    sets: [{ id: 's1', memberIds: ['a', 'b'] }],
    visibleItems: items,
  });
  const region = regions.get('s1');
  assert.equal(region.polygons.length, 1, 'one ring: no hole was carved');
  assert.equal(filledComponentCount(region), 1, 'and one filled component');
});

test('an impossible connection is reported rather than silently split', () => {
  // A wall of an exclusive set's members boxes one member in completely, so no
  // legal route to the other exists. That must surface as connected: false —
  // never as two unrelated blobs presented as one set.
  const wall = [];
  for (let i = -4; i <= 4; i += 1) wall.push(tile(`w${i}`, 240, i * 96));
  const items = [tile('a', 0, 0), tile('b', 520, 0), ...wall];
  const regions = buildSetRegions({
    sets: [
      { id: 's1', memberIds: ['a', 'b'] },
      { id: 'sw', memberIds: wall.map((item) => item.id) },
    ],
    visibleItems: items,
  });
  const region = regions.get('s1');
  assert.equal(region.componentCount, 2, 'the members seeded two components');
  assert.equal(region.connected, false, 'the failure is explicit');
  assert.ok(
    polygonSeparation(region.polygons, regions.get('sw').polygons) > 0,
    'and the wall was still not crossed',
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

test('a region keeps clear of an exclusive set it would otherwise reach over', () => {
  // The two members are close enough that padding alone would carry one
  // region across the other's tile. The separation band is what stops it, so
  // this fails if that rule is removed.
  //
  // The foreign tile belongs to a set here, and that is the change from the
  // version this replaces. That one used a setless tile and passed only
  // because every non-member was an obstacle — the rule that made ordinary
  // outsiders carve permanent holes and channels through a set. Outsiders are
  // constrained by the membrane now rather than shaping it, so the clearance
  // this asserts is the one that still has to hold: between two sets.
  const member = tile('a', 0, 0);
  const foreign = tile('b', 110, 0);
  const regions = buildSetRegions({
    sets: [{ id: 'sa', memberIds: ['a'] }, { id: 'sb', memberIds: ['b'] }],
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

test('a setless item no longer deforms a set it sits beside', () => {
  // The counterpart of the test above, and the behaviour change it records.
  // The same layout with the neighbour in no set at all: its presence must not
  // dent the outline, because a set is a container for its members rather than
  // a shape moulded around whatever happens to be nearby.
  const withNeighbour = buildSetRegions({
    sets: [{ id: 'sa', memberIds: ['a'] }],
    visibleItems: [tile('a', 0, 0), tile('b', 110, 0)],
    padding: 40,
    gap: 14,
  }).get('sa');
  const alone = buildSetRegions({
    sets: [{ id: 'sa', memberIds: ['a'] }],
    visibleItems: [tile('a', 0, 0)],
    padding: 40,
    gap: 14,
  }).get('sa');
  assert.equal(withNeighbour.polygons.length, 1, 'one ring: nothing was carved out');
  assert.equal(
    regionArea(withNeighbour).toFixed(2),
    regionArea(alone).toFixed(2),
    'the neighbour changed the region not at all',
  );
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

test('the space beside a neck belongs to no set', () => {
  // The neck joins the members without the membrane claiming the open space
  // around it — that bulk claim is what a convex hull would have made.
  const regions = buildSetRegions({
    sets: [{ id: 's1', memberIds: ['a', 'b'] }],
    visibleItems: [tile('a', 0, 0), tile('b', 600, 0)],
  });
  const region = regions.get('s1');
  assert.equal(regionContainsPoint(region, { x: 300, y: 200 }), false, 'the open space is not the set');
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
// Holes: an exclusive set's member ringed by members is enclosed, not
// contained. Only a set the membrane may not cross earns a hole — an ordinary
// setless item does not, which is the case immediately below.
// ===========================================================================

/** Members arranged in a circle around a single item of another, exclusive
 * set, close enough that the region closes around it and leaves an interior
 * hole. The middle tile belongs to a set of its own: two exclusive membranes
 * may never blend, so the hole is a real containment boundary rather than a
 * cosmetic notch. */
function surroundedLayout(memberCount = 6, radius = 110) {
  const items = [];
  for (let i = 0; i < memberCount; i += 1) {
    const angle = (2 * Math.PI * i) / memberCount;
    items.push(tile(`m${i}`, Math.round(radius * Math.cos(angle)), Math.round(radius * Math.sin(angle))));
  }
  items.push(tile('foreign', 0, 0));
  return {
    items,
    sets: [
      { id: 'S', memberIds: items.filter((item) => item.id !== 'foreign').map((item) => item.id) },
      { id: 'F', memberIds: ['foreign'] },
    ],
  };
}

test('a ringed setless item gets no hole of its own', () => {
  // The old model made every non-member an obstacle, so this layout carved a
  // cavity in the middle of the set. An ordinary outsider is not geometry any
  // more: the membrane closes over the space and the constraint model is what
  // keeps the item out of it.
  const { items } = surroundedLayout();
  const region = buildSetRegions({
    sets: [{ id: 'S', memberIds: items.filter((item) => item.id !== 'foreign').map((item) => item.id) }],
    visibleItems: items,
  }).get('S');
  assert.equal(region.polygons.length, 1, 'one ring, no cavity');
  assert.equal(regionContainsPoint(region, { x: 0, y: 0 }), true, 'the middle is filled membrane');
});

test('a surrounded exclusive member leaves a real hole in the region', () => {
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

test('every extracted ring is closed, and an open field is rejected', () => {
  // The invariant the interleaved regression violated. A contour that runs off
  // the edge of its grid chains into an open path, and returning that as a
  // polygon inverts the region: two same-wound rings cancel under even-odd, so
  // solid membrane reads as hole. It has to fail loudly instead.
  const items = [tile('a1', 0, 0), tile('b1', 210, 0), tile('a2', 420, 0), tile('b2', 630, 0)];
  const regions = buildSetRegions({
    sets: [{ id: 'sa', memberIds: ['a1', 'a2'] }, { id: 'sb', memberIds: ['b1', 'b2'] }],
    visibleItems: items,
  });
  for (const [setId, region] of regions) {
    for (const ring of region.polygons) {
      const first = ring[0];
      const last = ring[ring.length - 1];
      assert.ok(
        Math.hypot(first.x - last.x, first.y - last.y) < 1e-6,
        `${setId} produced a ring that does not return to its start`,
      );
    }
  }

  // A field whose region runs off its own border cannot close. Extraction must
  // say so rather than hand back an open chain dressed as a polygon.
  //
  // The fixture is a band reaching the left and right edges: filling the grid
  // outright would not do it, because a wholly-inside cell emits no boundary
  // segment at all and the extractor would simply find nothing.
  const open = sampleField([tile('a', 0, 0)], [], { padding: 26, gap: 14, cellSize: 4 });
  const middle = Math.floor(open.rows / 2);
  for (let row = middle - 2; row <= middle + 2; row += 1) {
    for (let column = 0; column < open.columns; column += 1) {
      open.inside[row * open.columns + column] = 1;
    }
  }
  assert.throws(() => extractContours(open), /did not close/);
});

// ===========================================================================
// Shape quality. The outlines were a union of padded rectangles: long
// axis-aligned runs meeting at right angles, which reads as construction
// rather than as one grown body.
// ===========================================================================

/** The sharpest direction change anywhere on a ring, in degrees. */
function sharpestCorner(ring) {
  let worst = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const before = ring[(i - 1 + ring.length) % ring.length];
    const here = ring[i];
    const after = ring[(i + 1) % ring.length];
    const a = Math.atan2(here.y - before.y, here.x - before.x);
    const b = Math.atan2(after.y - here.y, after.x - here.x);
    let turn = Math.abs(b - a);
    if (turn > Math.PI) turn = (2 * Math.PI) - turn;
    worst = Math.max(worst, turn);
  }
  return (worst * 180) / Math.PI;
}

test('contour vertices are interpolated, not snapped to the grid', () => {
  // The staircase came from placing every crossing at the midpoint of a grid
  // edge, which quantizes each vertex to a half-cell. A boundary at a shallow
  // angle to the grid then comes out as a flight of steps however fine the
  // sampling is.
  const region = buildSetRegions({
    sets: [{ id: 's1', memberIds: ['a'] }],
    visibleItems: [tile('a', 0, 0)],
    cellSize: 4,
  }).get('s1');

  const onGrid = region.polygons[0].filter((point) => {
    const halfCell = 2;
    return Math.abs(point.x % halfCell) < 1e-6 && Math.abs(point.y % halfCell) < 1e-6;
  });
  assert.ok(
    onGrid.length < region.polygons[0].length / 4,
    `${onGrid.length} of ${region.polygons[0].length} vertices sit exactly on the sampling grid`,
  );
});

test('a smooth field turns two nearby members into one body, not two boxes', () => {
  // The waist between two members must fill. Unblended, the midpoint between
  // them is well outside the region and the outline dips in to make a notch.
  const members = [tile('a', 0, 0), tile('b', 160, 0)];
  const waist = { x: 80, y: 0 };
  const boxy = regionFieldValue(waist, members, [], { padding: 26, gap: 14 });
  const smooth = regionFieldValue(waist, members, [], {
    padding: 26, gap: 14, blend: 100, cornerRadius: 22,
  });
  assert.ok(boxy < 0, `unblended, the waist is outside the region (${boxy.toFixed(1)})`);
  assert.ok(smooth > boxy, `blending fills the waist (${boxy.toFixed(1)} -> ${smooth.toFixed(1)})`);
});

test('the outline has no sharp corners', () => {
  // The measurable form of "it should look grown rather than constructed".
  // Unblended this layout turns 56 degrees at its sharpest; the defaults bring
  // that under 20.
  const region = buildSetRegions({
    sets: [{ id: 's1', memberIds: ['a', 'b'] }],
    visibleItems: [tile('a', 0, 0), tile('b', 160, 0)],
  }).get('s1');
  const worst = sharpestCorner(region.polygons[0]);
  assert.ok(worst < 20, `sharpest corner is ${worst.toFixed(1)} degrees`);
});

test('a partial blend is worse than none, so the default is past closure', () => {
  // Guards the default against being "tidied" to a smaller number. A blend that
  // half-closes the waist makes the contour pinch through the remaining gap,
  // which is a sharper corner than the notch it replaced — the sweep behind the
  // chosen default runs 56, 59, 74, 24, 15, 15 degrees at blend 0/20/34/50/70/100.
  const members = [tile('a', 0, 0), tile('b', 160, 0)];
  const cornerAt = (blend) => sharpestCorner(buildSetRegions({
    sets: [{ id: 's1', memberIds: ['a', 'b'] }],
    visibleItems: members,
    blend,
    cornerRadius: 22,
  }).get('s1').polygons[0]);

  assert.ok(cornerAt(34) > cornerAt(100), 'a partial blend is sharper than a full one');
  assert.ok(cornerAt(100) < 20, 'and the default is in the flat part of the curve');
});

test('every member is inside its own set, whatever the shape is doing', () => {
  // The invariant the shape exists to serve, and it was missing. Every other
  // measurement here is about how the outline looks — how smooth, how round,
  // how separated — and none of them notice a set that has stopped containing
  // its own members.
  //
  // That gap let a concavity-closing pass ship that pinched a waist shut across
  // the middle of a set and left two members straddling the boundary. It scored
  // well on solidity against the convex hull the whole time, because solidity
  // measures how round a blob is and not whether the blob still holds what it
  // is for.
  const layouts = [
    { name: 'a line', items: [tile('a', 0, 0), tile('b', 200, 0), tile('c', 400, 0)] },
    { name: 'an L', items: [tile('a', 0, 0), tile('b', 200, 0), tile('c', 0, 200)] },
    { name: 'a ring', items: [0, 1, 2, 3, 4, 5].map((i) => tile(
      `m${i}`,
      Math.round(140 * Math.cos((2 * Math.PI * i) / 6)),
      Math.round(140 * Math.sin((2 * Math.PI * i) / 6)),
    )) },
    { name: 'far apart', items: [tile('a', 0, 0), tile('b', 700, 0)] },
    { name: 'a tight cluster', items: [tile('a', 0, 0), tile('b', 110, 0), tile('c', 55, 100)] },
  ];

  for (const layout of layouts) {
    const memberIds = layout.items.map((item) => item.id);
    const region = buildSetRegions({
      sets: [{ id: 's1', memberIds }],
      visibleItems: layout.items,
    }).get('s1');
    assert.ok(region, `${layout.name}: a region was built`);

    for (const member of layout.items) {
      // The centre, and every corner of the tile. A member half in and half out
      // is exactly the failure this is here to catch, so the centre alone would
      // not be enough.
      assert.equal(
        regionContainsPoint(region, { x: member.x, y: member.y }),
        true,
        `${layout.name}: ${member.id}'s centre is inside its own set`,
      );
      for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const corner = {
          x: member.x + (dx * member.width) / 2,
          y: member.y + (dy * member.height) / 2,
        };
        assert.equal(
          regionContainsPoint(region, corner),
          true,
          `${layout.name}: ${member.id} corner (${dx}, ${dy}) is inside its own set`,
        );
      }
    }
  }
});

test('the concavity closing is grid-dependent, which is why it is off', () => {
  // A morphological closing fills the concave bites between members, and on a
  // three-member L it takes solidity against the convex hull from 0.68 to 0.86.
  // It is off anyway, and this records the reason so it is not switched on
  // again by someone who only measures the shape.
  //
  // The chamfer transform underneath it is grid-aligned, so at the radii that
  // actually change the silhouette it bridges lobes differently depending on
  // where the layout falls on the sampling grid. The failure is erratic rather
  // than a threshold — some radii survive a shift and their neighbours do not —
  // so no value is safe on an arbitrary layout.
  const offset = { x: 13.7, y: -29.2 };
  const base = [tile('a1', 0, 0), tile('b1', 210, 0), tile('a2', 420, 0), tile('b2', 630, 0)];
  const shifted = base.map((item) => ({ ...item, x: item.x + offset.x, y: item.y + offset.y }));
  const sets = [{ id: 'sa', memberIds: ['a1', 'a2'] }, { id: 'sb', memberIds: ['b1', 'b2'] }];

  const centroid = (region) => {
    const points = region.polygons.flat();
    return {
      x: points.reduce((total, p) => total + p.x, 0) / points.length,
      y: points.reduce((total, p) => total + p.y, 0) / points.length,
    };
  };
  const driftAt = (surfaceTension) => {
    const before = buildSetRegions({ sets, visibleItems: base, surfaceTension });
    const after = buildSetRegions({ sets, visibleItems: shifted, surfaceTension });
    let worst = 0;
    for (const setId of ['sa', 'sb']) {
      const from = centroid(before.get(setId));
      const to = centroid(after.get(setId));
      worst = Math.max(worst, Math.abs((to.y - from.y) - offset.y));
    }
    return worst;
  };

  // The shipped setting translates cleanly.
  assert.ok(driftAt(0) < 4, `with the closing off the geometry translates (drift ${driftAt(0).toFixed(1)})`);
  // A radius large enough to matter does not.
  assert.ok(
    driftAt(150) > 20,
    `a closing radius that changes the silhouette breaks translation (drift ${driftAt(150).toFixed(1)})`,
  );
});

test('smoothing does not let two exclusive sets meet', () => {
  // A wider blend claims more space, so the guarantee has to be re-checked at
  // the setting actually shipped rather than only at blend zero.
  const touching = [];
  for (let separation = 95; separation <= 400; separation += 1) {
    const regions = buildSetRegions({
      sets: [{ id: 'sa', memberIds: ['a'] }, { id: 'sb', memberIds: ['b'] }],
      visibleItems: [tile('a', 0, 0), tile('b', separation, 0)],
    });
    const a = regions.get('sa');
    const b = regions.get('sb');
    if (!a || !b) continue;
    if (polygonSeparation(a.polygons, b.polygons) <= 0) touching.push(separation);
  }
  assert.deepEqual(touching, [], `smoothed sets blended at: ${touching.join(', ')}`);
});

test('an occupied cell on any border is detected', () => {
  // The precondition for extraction, tested on each edge separately: a
  // one-sided check would pass three of these while the fourth let an open
  // contour through.
  const edges = [
    ['top', (field) => 0],
    ['bottom', (field) => (field.rows - 1) * field.columns],
    ['left', (field) => Math.floor(field.rows / 2) * field.columns],
    ['right', (field) => (Math.floor(field.rows / 2) * field.columns) + field.columns - 1],
  ];
  for (const [name, cellOf] of edges) {
    const field = sampleField([tile('a', 0, 0)], [], { padding: 26, gap: 14, cellSize: 4 });
    assert.equal(fieldHasOccupiedBorder(field), false, `${name}: a clear field reports clear`);
    field.inside[cellOf(field)] = 1;
    assert.equal(fieldHasOccupiedBorder(field), true, `${name}: one occupied border cell is caught`);
  }
});

test('exhausting the margin growth returns a structured failure, not a polygon', () => {
  // The growth loop must be finite. An unbounded retry turns a pathological
  // layout into a hang, and every attempt resamples the whole grid, so cost
  // grows with the square of the margin.
  //
  // Starving the cap is how this is provoked: no attempts, and a margin too
  // small to contain the members' own padding. What must not happen is an open
  // field reaching extraction — that is what inverted a region before.
  const regions = buildSetRegions({
    sets: [{ id: 's1', memberIds: ['a', 'b'] }],
    visibleItems: [tile('a', 0, 0), tile('b', 300, 0)],
    initialExtraMargin: -60,
    maxMarginGrowthAttempts: 0,
  });
  const region = regions.get('s1');
  assert.equal(region.valid, false, 'the build reports itself invalid');
  assert.equal(region.failureReason, 'field-bounds-exhausted', 'and says why');
  assert.deepEqual(region.polygons, [], 'no polygons escape');
  assert.equal(region.svgPath, '', 'and nothing is drawable');
  assert.equal(region.attemptedBounds.attempts, 0, 'the cap was honoured');

  // The same layout with the cap restored succeeds, so the fixture is provoking
  // the limit rather than an impossible scene.
  const ok = buildSetRegions({
    sets: [{ id: 's1', memberIds: ['a', 'b'] }],
    visibleItems: [tile('a', 0, 0), tile('b', 300, 0)],
  }).get('s1');
  assert.equal(ok.valid, true, 'the same scene builds when growth is allowed');
});

test('a valid region is connected, closed and separated', () => {
  // The contract itself. Validity is asserted on the geometry that came out,
  // not on the intent that produced it: the defect that motivated this had a
  // correct field and inverted polygons.
  const items = [tile('a1', 0, 0), tile('b1', 210, 0), tile('a2', 420, 0), tile('b2', 630, 0)];
  const regions = buildSetRegions({
    sets: [{ id: 'sa', memberIds: ['a1', 'a2'] }, { id: 'sb', memberIds: ['b1', 'b2'] }],
    visibleItems: items,
  });
  for (const [setId, region] of regions) {
    assert.equal(region.valid, true, `${setId} is valid`);
    assert.equal(region.failureReason, null, `${setId} has no failure reason`);
    assert.equal(filledComponentCount(region), 1, `${setId} is one filled component`);
    assert.ok(region.svgPath.length > 0, `${setId} is drawable`);
  }
  assert.ok(
    polygonSeparation(regions.get('sa').polygons, regions.get('sb').polygons) > 0,
    'and the two are separated',
  );
});

test('translating the whole scene translates the geometry and nothing else', () => {
  // A metamorphic check, and the one that would have caught the defect at its
  // root. Sets legitimately sample on different grid origins, so any place that
  // reused a row/column index across two fields would drift under a shift that
  // does not land on the grid — hence the deliberately unaligned offset.
  const offset = { x: 13.7, y: -29.2 };
  const base = [tile('a1', 0, 0), tile('b1', 210, 0), tile('a2', 420, 0), tile('b2', 630, 0)];
  const shifted = base.map((item) => ({ ...item, x: item.x + offset.x, y: item.y + offset.y }));
  const sets = [{ id: 'sa', memberIds: ['a1', 'a2'] }, { id: 'sb', memberIds: ['b1', 'b2'] }];

  const before = buildSetRegions({ sets, visibleItems: base });
  const after = buildSetRegions({ sets, visibleItems: shifted });

  for (const setId of ['sa', 'sb']) {
    const a = before.get(setId);
    const b = after.get(setId);
    assert.equal(b.valid, a.valid, `${setId} validity is unchanged`);
    assert.equal(b.connected, a.connected, `${setId} connectivity is unchanged`);
    assert.equal(
      filledComponentCount(b), filledComponentCount(a),
      `${setId} topology is unchanged`,
    );
    // Area is translation-invariant and, unlike vertex-by-vertex comparison,
    // does not demand that an unaligned shift land on the same sample points.
    assert.ok(
      Math.abs(regionArea(b) - regionArea(a)) < regionArea(a) * 0.02,
      `${setId} area moved by more than sampling noise`,
    );
    // The geometry itself moved with the scene.
    const centroid = (region) => {
      const points = region.polygons.flat();
      return {
        x: points.reduce((total, p) => total + p.x, 0) / points.length,
        y: points.reduce((total, p) => total + p.y, 0) / points.length,
      };
    };
    const from = centroid(a);
    const to = centroid(b);
    assert.ok(Math.abs((to.x - from.x) - offset.x) < 4, `${setId} moved by dx=${offset.x}`);
    assert.ok(Math.abs((to.y - from.y) - offset.y) < 4, `${setId} moved by dy=${offset.y}`);
  }
  assert.ok(
    polygonSeparation(after.get('sa').polygons, after.get('sb').polygons) > 0,
    'separation survives the translation',
  );
});

test('the order the sets are passed in does not change the result', () => {
  // Sets are built in a fixed order internally because each one's necks become
  // corridors the later ones avoid. If that ordering ever came from the caller,
  // the same layout would render differently between calls — and the drag rules
  // read this geometry.
  const items = [tile('a1', 0, 0), tile('b1', 210, 0), tile('a2', 420, 0), tile('b2', 630, 0)];
  const sa = { id: 'sa', memberIds: ['a1', 'a2'] };
  const sb = { id: 'sb', memberIds: ['b1', 'b2'] };

  const forward = buildSetRegions({ sets: [sa, sb], visibleItems: items });
  const backward = buildSetRegions({ sets: [sb, sa], visibleItems: items });

  for (const setId of ['sa', 'sb']) {
    assert.equal(backward.get(setId).valid, true, `${setId} is valid either way`);
    assert.equal(
      backward.get(setId).svgPath, forward.get(setId).svgPath,
      `${setId} produced identical geometry regardless of input order`,
    );
  }
  assert.ok(
    polygonSeparation(backward.get('sa').polygons, backward.get('sb').polygons) > 0,
    'and the two stay separated',
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

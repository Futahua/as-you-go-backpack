/** The membrane as a barrier.
 *
 * Every test here fails if the constraint is judged by the item's centre at its
 * destination, which is what the drag rules used to do. Two separate defects
 * hid behind that: an icon could straddle a wall with half its body across it,
 * and a fast pointer movement could jump clean over a thin neck with both ends
 * of the move legal. */

import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSetRegions } from './public/set-region-model.js';
import {
  itemRectAt,
  regionContainsItemRect,
  regionOverlapsItemRect,
  itemPlacementIsValid,
  resolveSweptPlacement,
  findNearestValidPosition,
} from './public/set-constraint-model.js';

const TILE = { width: 90, height: 90 };
const SMALL = { width: 30, height: 30 };

function tile(id, x, y) {
  return { id, x, y, ...TILE };
}

/** One set around a single member, with room to move around it. */
function oneSet() {
  return buildSetRegions({
    sets: [{ id: 's1', memberIds: ['a'] }],
    visibleItems: [tile('a', 0, 0)],
  });
}

test('a rectangle wholly inside a region is contained, one straddling is not', () => {
  const region = oneSet().get('s1');
  assert.equal(
    regionContainsItemRect(region, itemRectAt({ x: 0, y: 0 }, SMALL)),
    true,
    'on the member',
  );
  // The centre is comfortably inside, but the right edge reaches past the
  // padding. Testing the centre alone would call this contained.
  assert.equal(regionContainsPointish(region, { x: 62, y: 0 }), true, 'centre still inside');
  assert.equal(
    regionContainsItemRect(region, itemRectAt({ x: 62, y: 0 }, SMALL)),
    false,
    'but the edge crosses the membrane',
  );
});

function regionContainsPointish(region, point) {
  return regionContainsItemRect(region, itemRectAt(point, { width: 0, height: 0 }));
}

test('a setless item may not enter a set, and a member may not leave it', () => {
  const regions = oneSet();
  const outsiderInside = itemPlacementIsValid({
    itemRect: itemRectAt({ x: 0, y: 0 }, SMALL),
    ownSetIds: [],
    regions,
  });
  assert.equal(outsiderInside, false, 'an outsider inside the set is invalid');

  const outsiderClear = itemPlacementIsValid({
    itemRect: itemRectAt({ x: 400, y: 0 }, SMALL),
    ownSetIds: [],
    regions,
  });
  assert.equal(outsiderClear, true, 'an outsider well clear is fine');

  const memberOut = itemPlacementIsValid({
    itemRect: itemRectAt({ x: 400, y: 0 }, SMALL),
    ownSetIds: ['s1'],
    regions,
  });
  assert.equal(memberOut, false, 'a member outside its own set is invalid');
});

test('an item whose centre is valid but whose edge crosses is blocked', () => {
  // The precise failure the centre-only rule allowed. The centre sits outside
  // the set, so a centre test passes it; the item's body reaches in.
  const regions = oneSet();
  const region = regions.get('s1');
  let straddle = null;
  for (let x = 60; x < 140; x += 1) {
    const centreOutside = !regionContainsPointish(region, { x, y: 0 });
    const bodyTouches = regionOverlapsItemRect(region, itemRectAt({ x, y: 0 }, TILE));
    if (centreOutside && bodyTouches) { straddle = x; break; }
  }
  assert.ok(straddle != null, 'found a position where the centre is out but the body is in');
  assert.equal(
    itemPlacementIsValid({
      itemRect: itemRectAt({ x: straddle, y: 0 }, TILE),
      ownSetIds: [],
      regions,
    }),
    false,
    `an outsider at x=${straddle} overlaps the set and must be blocked`,
  );
});

test('a large pointer jump cannot tunnel through a membrane', () => {
  // Both ends of this move are legal — the item starts well left of the set and
  // ends well right of it — and everything between is not. Testing only the
  // destination lets the icon appear on the far side.
  const regions = oneSet();
  const from = { x: -400, y: 0 };
  const to = { x: 400, y: 0 };
  assert.equal(
    itemPlacementIsValid({ itemRect: itemRectAt(to, SMALL), ownSetIds: [], regions }),
    true,
    'the destination on its own is legal',
  );

  const resolved = resolveSweptPlacement({ from, to, itemSize: SMALL, ownSetIds: [], regions });
  assert.equal(resolved.blocked, true, 'the sweep caught the wall');
  assert.ok(resolved.x < 0, `the item stopped before the set, at x=${resolved.x.toFixed(1)}`);
  assert.equal(
    itemPlacementIsValid({
      itemRect: itemRectAt(resolved, SMALL), ownSetIds: [], regions,
    }),
    true,
    'and where it stopped is itself a legal position',
  );
});

test('a setless item stops at the exterior wall', () => {
  const regions = oneSet();
  const resolved = resolveSweptPlacement({
    from: { x: -300, y: 0 },
    to: { x: 0, y: 0 },
    itemSize: SMALL,
    ownSetIds: [],
    regions,
  });
  assert.equal(resolved.blocked, true, 'blocked');
  assert.ok(resolved.x < -60, `stopped outside the membrane at x=${resolved.x.toFixed(1)}`);
});

test('a member stops at the interior wall', () => {
  const regions = oneSet();
  const resolved = resolveSweptPlacement({
    from: { x: 0, y: 0 },
    to: { x: 400, y: 0 },
    itemSize: SMALL,
    ownSetIds: ['s1'],
    regions,
  });
  assert.equal(resolved.blocked, true, 'blocked');
  assert.ok(resolved.x < 80, `stopped inside the membrane at x=${resolved.x.toFixed(1)}`);
  assert.equal(
    regionContainsItemRect(regions.get('s1'), itemRectAt(resolved, SMALL)),
    true,
    'and is still wholly inside its set',
  );
});

test('a shared member stops at the edge of the overlap', () => {
  // Two sets sharing one member. The shared item lives in the intersection, so
  // it may not move into the part of either set the other does not cover.
  const items = [tile('a', 0, 0), tile('shared', 150, 0), tile('b', 300, 0)];
  const regions = buildSetRegions({
    sets: [{ id: 's1', memberIds: ['a', 'shared'] }, { id: 's2', memberIds: ['shared', 'b'] }],
    visibleItems: items,
  });
  const ownSetIds = ['s1', 's2'];
  const start = { x: 150, y: 0 };
  assert.equal(
    itemPlacementIsValid({ itemRect: itemRectAt(start, SMALL), ownSetIds, regions }),
    true,
    'the shared item starts in the intersection',
  );

  // Driving it towards s1's far member leaves s2 behind.
  const resolved = resolveSweptPlacement({
    from: start,
    to: { x: -60, y: 0 },
    itemSize: SMALL,
    ownSetIds,
    regions,
  });
  assert.equal(resolved.blocked, true, 'leaving the overlap is blocked');
  assert.equal(
    itemPlacementIsValid({ itemRect: itemRectAt(resolved, SMALL), ownSetIds, regions }),
    true,
    'and it stopped somewhere still inside both sets',
  );
});

test('a move that never leaves legal space is not clamped', () => {
  // The rules must not make ordinary movement feel sticky: a drag entirely
  // outside every set is untouched.
  const regions = oneSet();
  const to = { x: 600, y: 300 };
  const resolved = resolveSweptPlacement({
    from: { x: 400, y: 300 },
    to,
    itemSize: SMALL,
    ownSetIds: [],
    regions,
  });
  assert.equal(resolved.blocked, false, 'not blocked');
  assert.deepEqual({ x: resolved.x, y: resolved.y }, to, 'and it arrived exactly');
});

// ===========================================================================
// Escaping an illegal start. A legacy layout can hold an item a set has since
// grown around, so such an item has to be able to leave — but "may move" is
// not "may move anywhere", and every test here fails if it is.
// ===========================================================================

test('an outsider trapped inside a set can leave by the nearest wall', () => {
  const regions = oneSet();
  const from = { x: 0, y: 0 };
  assert.equal(
    itemPlacementIsValid({ itemRect: itemRectAt(from, SMALL), ownSetIds: [], regions }),
    false,
    'it does start invalid',
  );
  const resolved = resolveSweptPlacement({
    from, to: { x: 400, y: 0 }, itemSize: SMALL, ownSetIds: [], regions,
  });
  assert.equal(resolved.startedInvalid, true, 'reported as an invalid start');
  assert.equal(
    itemPlacementIsValid({ itemRect: itemRectAt(resolved, SMALL), ownSetIds: [], regions }),
    true,
    'and it reached legal space',
  );
});

test('a trapped outsider cannot burrow deeper into the set', () => {
  // Starting off-centre and driven towards the middle. Permitting any motion
  // from an invalid start would let it swim further in; the violation score
  // must refuse a move that makes matters worse.
  const regions = oneSet();
  const from = { x: 55, y: 0 };
  const resolved = resolveSweptPlacement({
    from, to: { x: 0, y: 0 }, itemSize: SMALL, ownSetIds: [], regions,
  });
  assert.ok(
    resolved.x >= from.x - 1e-6,
    `it did not move deeper in (from x=${from.x} to x=${resolved.x.toFixed(1)})`,
  );
  assert.equal(resolved.escaped, false, 'and it has not escaped either');
});

test('a trapped outsider cannot cross the set and surface on the far side', () => {
  // The tunnelling case from an illegal start. At x=-20 the nearest way out is
  // leftwards, so a drag aimed at the far right has to travel *deeper* before
  // it could ever reach the opposite wall. The rule refuses at the first uphill
  // step, which is the whole point: an item cannot buy passage through a set by
  // having started inside it.
  const regions = oneSet();
  const from = { x: -20, y: 0 };
  const resolved = resolveSweptPlacement({
    from, to: { x: 400, y: 0 }, itemSize: SMALL, ownSetIds: [], regions,
  });
  assert.ok(resolved.x <= from.x + 1e-6, `it went nowhere rightwards (x=${resolved.x.toFixed(1)})`);
  assert.equal(resolved.escaped, false, 'and it certainly did not surface beyond the set');

  // Aimed the other way — towards the near wall — the same item leaves freely.
  const escaping = resolveSweptPlacement({
    from, to: { x: -400, y: 0 }, itemSize: SMALL, ownSetIds: [], regions,
  });
  assert.equal(escaping.escaped, true, 'the nearest exit is available');
  assert.equal(
    itemPlacementIsValid({ itemRect: itemRectAt(escaping, SMALL), ownSetIds: [], regions }),
    true,
    'and it ends up legal',
  );
});

test('a trapped outsider cannot escape one set by entering another', () => {
  // Two exclusive sets with a legal corridor between them. An item inside the
  // first may leave, but heading straight for the second must stop in the gap
  // rather than trade one violation for another.
  const items = [tile('a', 0, 0), tile('b', 260, 0)];
  const regions = buildSetRegions({
    sets: [{ id: 'sa', memberIds: ['a'] }, { id: 'sb', memberIds: ['b'] }],
    visibleItems: items,
  });
  const resolved = resolveSweptPlacement({
    from: { x: 0, y: 0 },
    to: { x: 260, y: 0 },
    itemSize: SMALL,
    ownSetIds: [],
    regions,
  });
  assert.equal(
    itemPlacementIsValid({ itemRect: itemRectAt(resolved, SMALL), ownSetIds: [], regions }),
    true,
    'it ended up in neither set',
  );
  assert.ok(
    !regionOverlapsItemRect(regions.get('sb'), itemRectAt(resolved, SMALL)),
    'and specifically not inside the second one',
  );
});

test('a member outside its own set may move towards it but not further away', () => {
  const regions = oneSet();
  const from = { x: 200, y: 0 };
  assert.equal(
    itemPlacementIsValid({ itemRect: itemRectAt(from, SMALL), ownSetIds: ['s1'], regions }),
    false,
    'a member out here is invalid',
  );

  const inward = resolveSweptPlacement({
    from, to: { x: 0, y: 0 }, itemSize: SMALL, ownSetIds: ['s1'], regions,
  });
  assert.ok(inward.x < from.x, 'it may head back towards its set');

  const outward = resolveSweptPlacement({
    from, to: { x: 600, y: 0 }, itemSize: SMALL, ownSetIds: ['s1'], regions,
  });
  assert.ok(
    outward.x <= from.x + 1e-6,
    `it may not drift further away (from x=${from.x} to x=${outward.x.toFixed(1)})`,
  );
});

test('an outsider trapped inside a set is ejected to the nearest legal spot', () => {
  const regions = oneSet();
  const repaired = findNearestValidPosition({
    origin: { x: 0, y: 0 },
    itemSize: SMALL,
    ownSetIds: [],
    regions,
  });
  assert.equal(repaired.moved, true, 'it was moved');
  assert.equal(
    itemPlacementIsValid({ itemRect: itemRectAt(repaired, SMALL), ownSetIds: [], regions }),
    true,
    'to a position outside the set',
  );
  // Nearest, not arbitrary: the set is small, so the repair should be local.
  assert.ok(
    Math.hypot(repaired.x, repaired.y) < 200,
    `ejected only as far as needed (${Math.hypot(repaired.x, repaired.y).toFixed(1)})`,
  );
});

test('a valid position is left exactly where it is', () => {
  const regions = oneSet();
  const origin = { x: 400, y: 0 };
  const repaired = findNearestValidPosition({
    origin, itemSize: SMALL, ownSetIds: [], regions,
  });
  assert.equal(repaired.moved, false, 'nothing to repair');
  assert.deepEqual({ x: repaired.x, y: repaired.y }, origin, 'and it did not drift');
});

test('an invalid region constrains nothing', () => {
  // A region that failed to build has no polygons. Treating it as a wall would
  // block movement against geometry that is not on screen.
  const regions = new Map([['broken', {
    polygons: [], svgPath: '', valid: false, connected: false, failureReason: 'disconnected',
  }]]);
  assert.equal(
    itemPlacementIsValid({ itemRect: itemRectAt({ x: 0, y: 0 }, SMALL), ownSetIds: [], regions }),
    true,
    'movement is unconstrained by a region that does not exist',
  );
});

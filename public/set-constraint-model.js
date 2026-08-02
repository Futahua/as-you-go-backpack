/** Set membranes as barriers: what an item may occupy, and where a move stops.
 *
 * The region model decides where each membrane *is*. This module decides what
 * that means for an item trying to move, and it is the difference between an
 * outline that decorates a layout and one that contains it.
 *
 * Two things were wrong before, and both are the same mistake in different
 * places: judging a move by its destination point.
 *
 * - Only the item's centre was tested, so an icon could straddle a membrane
 *   with half its body across the wall and still be judged inside. The whole
 *   rectangle is tested here.
 * - Only the destination was tested, so a fast pointer movement jumped clean
 *   over a thin neck: both ends of the move were legal and everything between
 *   was not. The motion is swept here, and stops at the first crossing.
 *
 * The old behaviour also let the icon follow the pointer through the wall and
 * reverted it on release. That reads as the drag being broken rather than as a
 * boundary being enforced, so movement is now clamped as it happens.
 *
 * No DOM, store, or browser APIs. */

import { regionContainsPoint, regionIntersectsRect } from './set-region-model.js';

/** The rectangle an item occupies, from its centre and size. */
export function itemRectAt(position, itemSize) {
  const halfWidth = (itemSize?.width ?? 0) / 2;
  const halfHeight = (itemSize?.height ?? 0) / 2;
  return {
    left: position.x - halfWidth,
    top: position.y - halfHeight,
    right: position.x + halfWidth,
    bottom: position.y + halfHeight,
  };
}

/** True when the whole rectangle lies inside the region's filled area.
 *
 * Corner containment alone is not enough: a region can be concave, so all four
 * corners can sit inside while an edge bows out across a boundary between them.
 * The edges are therefore sampled too, densely enough that a crossing narrower
 * than the sampling could not also be wide enough to matter — and the rim test
 * catches anything that does cross, since a rectangle whose interior meets a
 * ring's edge cannot be wholly within the filled side of it. */
export function regionContainsItemRect(region, rect) {
  const rings = region?.polygons ?? [];
  if (rings.length === 0) return false;
  for (const point of rectSamplePoints(rect)) {
    if (!regionContainsPoint(region, point)) return false;
  }
  // Every sample inside, but a ring cutting through the rectangle between them
  // would still mean part of the item is outside. Crossing any ring at all
  // disqualifies containment.
  for (const ring of rings) {
    if (ringCrossesRect(ring, rect)) return false;
  }
  return true;
}

/** True when the rectangle touches the region's filled area at all. */
export function regionOverlapsItemRect(region, rect) {
  return regionIntersectsRect(region, rect);
}

/** Points along a rectangle's outline and centre, at roughly cell resolution.
 *
 * The step is capped so a long thin item is sampled as finely as a small one:
 * the number of samples follows the edge length rather than being fixed. */
function rectSamplePoints(rect, step = 8) {
  const points = [
    { x: rect.left, y: rect.top },
    { x: rect.right, y: rect.top },
    { x: rect.right, y: rect.bottom },
    { x: rect.left, y: rect.bottom },
    { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 },
  ];
  const width = rect.right - rect.left;
  const height = rect.bottom - rect.top;
  const columns = Math.max(1, Math.ceil(width / step));
  const rows = Math.max(1, Math.ceil(height / step));
  for (let i = 1; i < columns; i += 1) {
    const x = rect.left + (width * i) / columns;
    points.push({ x, y: rect.top }, { x, y: rect.bottom });
  }
  for (let i = 1; i < rows; i += 1) {
    const y = rect.top + (height * i) / rows;
    points.push({ x: rect.left, y }, { x: rect.right, y });
  }
  return points;
}

/** Whether a rectangle's edges actually cross this ring. */
function ringCrossesRect(polygon, rect) {
  const { left, top, right, bottom } = rect;
  for (const point of polygon) {
    if (point.x >= left && point.x <= right && point.y >= top && point.y <= bottom) return true;
  }
  const corners = [
    { x: left, y: top }, { x: right, y: top },
    { x: right, y: bottom }, { x: left, y: bottom },
  ];
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    for (let k = 0; k < 4; k += 1) {
      if (segmentsIntersect(polygon[j], polygon[i], corners[k], corners[(k + 1) % 4])) return true;
    }
  }
  return false;
}

function segmentsIntersect(p1, p2, p3, p4) {
  const direction = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = direction(p3, p4, p1);
  const d2 = direction(p3, p4, p2);
  const d3 = direction(p1, p2, p3);
  const d4 = direction(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0))
    && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Whether an item's whole shape may sit where it has been put.
 *
 * Three rules, and a shared member has to satisfy all of them:
 *
 * - every set the item belongs to must contain the item entirely, so a member
 *   cannot be halfway out of its own set;
 * - no set the item does not belong to may be touched at all, so an outsider
 *   cannot cross in — and a setless item is therefore outside everything;
 * - a member of several sets is inside all of them at once, which is the
 *   intersection, and falls out of the first two rules rather than needing a
 *   third.
 *
 * A region that failed to build is skipped: it has no polygons, so it can
 * neither contain nor exclude anything, and treating it as a wall would block
 * movement on geometry nobody can see. */
export function itemPlacementIsValid({ itemRect, ownSetIds, regions }) {
  const own = new Set(ownSetIds ?? []);
  for (const [setId, region] of regions ?? []) {
    if (region?.valid === false) continue;
    if (!region?.polygons?.length) continue;
    if (own.has(setId)) {
      if (!regionContainsItemRect(region, itemRect)) return false;
    } else if (regionOverlapsItemRect(region, itemRect)) {
      return false;
    }
  }
  return true;
}

/** How badly a placement breaks the rules, as a number that only reaches zero
 * when the placement is legal.
 *
 * A legacy layout can hold an item a set has since grown around, and such an
 * item has to be able to leave. But "may move" is not the same as "may move
 * anywhere": permitting any motion from an invalid start would let an outsider
 * swim deeper into a set, cross it entirely and surface on the far side, or
 * escape one set by burying itself in another. Scoring the violation turns
 * escape into a rule rather than an exemption — motion is allowed only while
 * the score does not rise.
 *
 * The score counts violated requirements first and penetration second, so
 * leaving a set always beats merely retreating within it, and a move can never
 * trade one whole violation for a shallower position in two.
 *
 * Depth is a distance, not a count of misplaced sample points. Counting was
 * tried and is useless here: every position from the centre of a small set out
 * to its rim puts all the item's samples inside, so the score is flat across
 * the whole interior and "non-increasing" permits swimming anywhere within it,
 * including straight through and out the other side. Distance to the boundary
 * varies everywhere, so it actually points at the exit. */
export function placementViolation({ itemRect, ownSetIds, regions }) {
  const own = new Set(ownSetIds ?? []);
  const centre = {
    x: (itemRect.left + itemRect.right) / 2,
    y: (itemRect.top + itemRect.bottom) / 2,
  };
  let broken = 0;
  let depth = 0;
  for (const [setId, region] of regions ?? []) {
    if (region?.valid === false) continue;
    if (!region?.polygons?.length) continue;
    if (own.has(setId)) {
      if (regionContainsItemRect(region, itemRect)) continue;
      broken += 1;
      // Outside a set it belongs to. Nearer the region is better, so the
      // distance to it is the depth to reduce.
      depth += distanceToRegionBoundary(region, centre);
    } else {
      if (!regionOverlapsItemRect(region, itemRect)) continue;
      broken += 1;
      // Inside a set it does not belong to. What has to shrink is the distance
      // still to travel before the whole item is clear, and that is signed:
      // negative once the centre is out, so the score keeps falling all the way
      // through the crossing instead of ticking up while the item straddles the
      // wall. Measuring the unsigned distance to the boundary was tried and
      // stalls the escape exactly there — the walk stops mid-wall and never
      // reaches legality.
      const inside = regionContainsPoint(region, centre);
      depth += inside
        ? distanceToRegionBoundary(region, centre)
        : -distanceToRegionBoundary(region, centre);
    }
  }
  // Requirements dominate depth: one fewer violated set always outranks any
  // amount of shuffling within the ones already broken. The depth term is
  // clamped well inside that step — and clamped at both ends, since it goes
  // negative while an item is halfway out of a foreign region — so it can only
  // ever break ties between equally-broken placements.
  return (broken * 1e6) + Math.max(-1e5, Math.min(depth, 1e5));
}

/** Distance from a point to the nearest edge of a region, inside or out. */
function distanceToRegionBoundary(region, point) {
  let best = Infinity;
  for (const ring of region?.polygons ?? []) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      best = Math.min(best, pointSegmentDistance(point, ring[j], ring[i]));
    }
  }
  return Number.isFinite(best) ? best : 0;
}

/** Shortest distance from a point to a segment. */
function pointSegmentDistance(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = (dx * dx) + (dy * dy);
  if (lengthSquared === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  let t = (((point.x - a.x) * dx) + ((point.y - a.y) * dy)) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

/** How far along a move an item may actually go.
 *
 * Sampling the destination alone is what let a fast drag tunnel through a thin
 * neck — start legal, end legal, wall in between. The segment is therefore
 * walked in steps small enough that no step can skip over a membrane, and the
 * first illegal step is then bisected to find where the wall is.
 *
 * `maxStep` is a third of the item's smaller dimension by default, capped so a
 * large icon does not get coarse steps. Since the item's own body is at least
 * that wide, no legal-illegal-legal pattern can hide inside one step.
 *
 * An item that starts invalid is governed by `placementViolation` instead: it
 * may travel only while its violation does not increase, so it can leave by the
 * nearest wall but cannot burrow deeper, cross the set and surface beyond it,
 * or escape into another set. Once it reaches a legal position the ordinary
 * rules resume for the rest of the path. */
export function resolveSweptPlacement({
  from,
  to,
  itemSize,
  ownSetIds,
  regions,
  maxStep,
  binaryIterations = 10,
}) {
  const valid = (position) => itemPlacementIsValid({
    itemRect: itemRectAt(position, itemSize),
    ownSetIds,
    regions,
  });
  const violation = (position) => placementViolation({
    itemRect: itemRectAt(position, itemSize),
    ownSetIds,
    regions,
  });

  if (!valid(from)) {
    return resolveEscape({ from, to, violation, valid, itemSize, maxStep, ownSetIds, regions });
  }

  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  if (distance === 0) return { x: from.x, y: from.y, blocked: false, startedInvalid: false };

  const step = maxStep ?? Math.max(2, Math.min(itemSize?.width ?? 24, itemSize?.height ?? 24, 24) / 3);
  const steps = Math.max(1, Math.ceil(distance / step));
  const at = (t) => ({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });

  // Walk forward to the last whole step that is still legal. The destination is
  // deliberately *not* short-circuited first: a move that starts and ends in
  // legal space can still cross a membrane in between, which is exactly the
  // tunnelling this exists to stop. Checking `to` up front would return it
  // unclamped and let the icon appear on the far side of a wall.
  let lastValid = 0;
  let firstInvalid = -1;
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    if (valid(at(t))) {
      lastValid = t;
    } else {
      firstInvalid = t;
      break;
    }
  }
  if (firstInvalid < 0) return { x: to.x, y: to.y, blocked: false, startedInvalid: false };

  // Bisect the interval that contains the wall.
  let low = lastValid;
  let high = firstInvalid;
  for (let i = 0; i < binaryIterations; i += 1) {
    const middle = (low + high) / 2;
    if (valid(at(middle))) low = middle;
    else high = middle;
  }

  const stopped = at(low);
  return { x: stopped.x, y: stopped.y, blocked: true, startedInvalid: false };
}

/** Movement for an item that begins in an illegal position.
 *
 * The path is walked exactly as a legal move is, but the test is monotonicity
 * rather than validity: each step is accepted while it does not make matters
 * worse. That single rule covers every case the escape has to respect —
 * burrowing deeper raises the depth term, crossing the set and surfacing the
 * far side has to raise it on the way, and entering a second set raises the
 * broken-requirement term, so none of them is reachable.
 *
 * As soon as a step is genuinely legal the item has escaped, and the remaining
 * path is handed back to the ordinary rules so it cannot then wander into
 * something else. */
function resolveEscape({ from, to, violation, valid, itemSize, maxStep, ownSetIds, regions }) {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  if (distance === 0) {
    return { x: from.x, y: from.y, blocked: false, startedInvalid: true };
  }
  const step = maxStep ?? Math.max(2, Math.min(itemSize?.width ?? 24, itemSize?.height ?? 24, 24) / 3);
  const steps = Math.max(1, Math.ceil(distance / step));
  const at = (t) => ({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });

  let best = { x: from.x, y: from.y };
  let score = violation(from);
  for (let i = 1; i <= steps; i += 1) {
    const candidate = at(i / steps);
    if (valid(candidate)) {
      // Escaped. Everything after this point is an ordinary move, so it is
      // judged by the ordinary rules — an item must not be able to leave one
      // set and coast into another on the strength of having started invalid.
      const onward = resolveSweptPlacement({
        from: candidate, to, itemSize, ownSetIds, regions, maxStep,
      });
      return { x: onward.x, y: onward.y, blocked: false, startedInvalid: true, escaped: true };
    }
    const candidateScore = violation(candidate);
    if (candidateScore > score) break;
    score = candidateScore;
    best = candidate;
  }
  return {
    x: best.x,
    y: best.y,
    blocked: best.x !== to.x || best.y !== to.y,
    startedInvalid: true,
    escaped: false,
  };
}

/** The nearest position outside every foreign set, for an item that already
 * begins inside one.
 *
 * Legacy layouts can hold an outsider that a set has since grown around, and
 * the old design preserved such an item by carving a permanent hole for it.
 * That is what made outlines read as category zones. The item is moved instead,
 * along the shortest direction that reaches legal space.
 *
 * The search is deterministic — fixed directions, increasing radius, then a
 * bisection to bring the result back against the wall — so the same invalid
 * layout is always repaired the same way. */
export function findNearestValidPosition({
  origin,
  itemSize,
  ownSetIds,
  regions,
  maxRadius = 600,
  directions = 16,
}) {
  const valid = (position) => itemPlacementIsValid({
    itemRect: itemRectAt(position, itemSize),
    ownSetIds,
    regions,
  });
  if (valid(origin)) return { x: origin.x, y: origin.y, moved: false };

  const step = Math.max(4, Math.min(itemSize?.width ?? 24, itemSize?.height ?? 24) / 2);
  for (let radius = step; radius <= maxRadius; radius += step) {
    let best = null;
    let bestDistance = Infinity;
    for (let i = 0; i < directions; i += 1) {
      const angle = (2 * Math.PI * i) / directions;
      const candidate = {
        x: origin.x + Math.cos(angle) * radius,
        y: origin.y + Math.sin(angle) * radius,
      };
      if (!valid(candidate)) continue;
      const distance = Math.hypot(candidate.x - origin.x, candidate.y - origin.y);
      if (distance < bestDistance) { bestDistance = distance; best = candidate; }
    }
    if (!best) continue;
    // Pull the result back towards where it started, so the item is ejected
    // just clear of the membrane rather than a whole search step beyond it.
    let low = 0;
    let high = 1;
    for (let i = 0; i < 8; i += 1) {
      const middle = (low + high) / 2;
      const candidate = {
        x: origin.x + (best.x - origin.x) * middle,
        y: origin.y + (best.y - origin.y) * middle,
      };
      if (valid(candidate)) high = middle;
      else low = middle;
    }
    return {
      x: origin.x + (best.x - origin.x) * high,
      y: origin.y + (best.y - origin.y) * high,
      moved: true,
    };
  }
  return { x: origin.x, y: origin.y, moved: false };
}

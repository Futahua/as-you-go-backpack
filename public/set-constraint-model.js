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
 * Returns the furthest valid position and whether clamping occurred. When the
 * item did not start from a valid position — a legacy layout, or geometry that
 * changed underneath it — the move is allowed rather than frozen: refusing to
 * move an already-invalid item would trap it there permanently. */
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

  if (!valid(from)) return { x: to.x, y: to.y, blocked: false, startedInvalid: true };

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

const EPSILON = 1e-7;

function cross(a, b, point) {
  return ((b.x - a.x) * (point.y - a.y)) - ((b.y - a.y) * (point.x - a.x));
}

function signedArea(polygon) {
  let total = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    total += (current.x * next.y) - (next.x * current.y);
  }
  return total / 2;
}

function normalizePolygon(outline) {
  const polygon = (outline ?? [])
    .filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y))
    .map(({ x, y }) => ({ x, y }));
  if (polygon.length >= 3 && signedArea(polygon) < 0) polygon.reverse();
  return polygon;
}

function intersection(a, b, firstValue, secondValue) {
  const denominator = firstValue - secondValue;
  if (Math.abs(denominator) < EPSILON) return { ...b };
  const ratio = firstValue / denominator;
  return {
    x: a.x + ((b.x - a.x) * ratio),
    y: a.y + ((b.y - a.y) * ratio),
  };
}

/** Clips a polygon to one side of a directed CCW edge. A positive side is
 * inside the convex set; a negative side is outside that set. */
export function clipPolygon(polygon, edgeStart, edgeEnd, keepInside = true) {
  if (polygon.length < 3) return [];
  const clipped = [];
  let previous = polygon[polygon.length - 1];
  let previousValue = cross(edgeStart, edgeEnd, previous);
  let previousInside = keepInside ? previousValue >= -EPSILON : previousValue <= EPSILON;
  for (const current of polygon) {
    const currentValue = cross(edgeStart, edgeEnd, current);
    const currentInside = keepInside ? currentValue >= -EPSILON : currentValue <= EPSILON;
    if (currentInside !== previousInside) {
      clipped.push(intersection(previous, current, previousValue, currentValue));
    }
    if (currentInside) clipped.push({ ...current });
    previous = current;
    previousValue = currentValue;
    previousInside = currentInside;
  }
  const result = clipped.filter((point, index) => {
    const prior = clipped[(index + clipped.length - 1) % clipped.length];
    return Math.hypot(point.x - prior.x, point.y - prior.y) > EPSILON;
  });
  return result.length >= 3 && Math.abs(signedArea(result)) > EPSILON ? result : [];
}

function clipToSet(polygon, outline, keepInside) {
  let result = polygon;
  for (let index = 0; index < outline.length && result.length >= 3; index += 1) {
    result = clipPolygon(
      result,
      outline[index],
      outline[(index + 1) % outline.length],
      keepInside,
    );
  }
  return result;
}

/** Convex-convex intersection, normalized on the way in so callers may pass raw
 * presentation outlines. Returns [] when the two do not overlap with positive
 * area, which is what makes it usable as an exact overlap predicate. */
export function intersectConvex(first, second) {
  const a = normalizePolygon(first);
  const b = normalizePolygon(second);
  if (a.length < 3 || b.length < 3) return [];
  return clipToSet(a, b, true);
}

/** Subtracts a convex outline from a convex polygon, returning a partition of
 * the remainder. Each edge takes its slice out of what is *left*, not out of
 * the original: clipping every edge against the original polygon produces
 * overlapping half-plane strips, which both double-counts area in regionArea
 * and regionCentroid and multiplies the piece count by the outline's vertex
 * count for every excluded set. At the 48-vertex outlines resampleHull
 * produces, that turns a fourth set into ~54k fragments per frame. */
export function subtractConvex(polygon, outline) {
  if (polygon.length < 3) return [];
  if (outline.length < 3) return [polygon];
  // Most sets on a workspace are spatially separate; a disjoint pair needs no
  // cutting at all, and this keeps that case at one piece instead of one per edge.
  if (clipToSet(polygon, outline, true).length < 3) return [polygon];

  let remaining = polygon;
  const outsidePieces = [];
  for (let edge = 0; edge < outline.length && remaining.length >= 3; edge += 1) {
    const start = outline[edge];
    const end = outline[(edge + 1) % outline.length];
    const outside = clipPolygon(remaining, start, end, false);
    if (outside.length >= 3) outsidePieces.push(outside);
    // Only what is still potentially inside the excluded set goes on to the
    // next edge. Whatever survives every edge is the intersection, so it is dropped.
    remaining = clipPolygon(remaining, start, end, true);
  }
  return outsidePieces;
}

function regionId(setIds) {
  return setIds.slice().sort().join('|');
}

/** Decomposes convex presentation outlines into one region per non-empty
 * membership mask. Difference regions can have several convex sub-polygons;
 * they remain one region object and therefore receive one hue and one SVG path. */
export function decomposeRegions(inputSets) {
  const sets = (inputSets ?? [])
    .map((set) => ({ id: String(set.id), outline: normalizePolygon(set.outline) }))
    .filter((set) => set.outline.length >= 3)
    .sort((a, b) => a.id.localeCompare(b.id));
  if (sets.length === 0) return [];
  if (sets.length > 10) return [];

  const regions = [];
  const combinations = 2 ** sets.length;
  for (let mask = 1; mask < combinations; mask += 1) {
    const included = sets.filter((_, index) => (mask & (1 << index)) !== 0);
    const excluded = sets.filter((_, index) => (mask & (1 << index)) === 0);
    let base = included[0].outline.map((point) => ({ ...point }));
    for (const set of included.slice(1)) base = clipToSet(base, set.outline, true);
    if (base.length < 3) continue;

    let pieces = [base];
    for (const set of excluded) {
      const nextPieces = [];
      for (const piece of pieces) nextPieces.push(...subtractConvex(piece, set.outline));
      pieces = nextPieces;
      if (pieces.length === 0) break;
    }
    if (pieces.length === 0) continue;
    const setIds = included.map((set) => set.id).sort();
    regions.push({ id: regionId(setIds), setIds, polygons: pieces });
  }
  return regions.sort((a, b) => a.id.localeCompare(b.id));
}

export function regionArea(region) {
  return (region?.polygons ?? []).reduce((total, polygon) => total + Math.abs(signedArea(polygon)), 0);
}

export function regionCentroid(region) {
  let areaTotal = 0;
  let xTotal = 0;
  let yTotal = 0;
  for (const polygon of region?.polygons ?? []) {
    const area = signedArea(polygon);
    if (Math.abs(area) < EPSILON) continue;
    let x = 0;
    let y = 0;
    for (let index = 0; index < polygon.length; index += 1) {
      const current = polygon[index];
      const next = polygon[(index + 1) % polygon.length];
      const factor = (current.x * next.y) - (next.x * current.y);
      x += (current.x + next.x) * factor;
      y += (current.y + next.y) * factor;
    }
    areaTotal += area;
    xTotal += (x / 6);
    yTotal += (y / 6);
  }
  if (Math.abs(areaTotal) < EPSILON) return null;
  return { x: xTotal / areaTotal, y: yTotal / areaTotal };
}

export function regionPath(region) {
  return (region?.polygons ?? []).map((polygon) => (
    `${polygon.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join('')}Z`
  )).join('');
}

export { normalizePolygon, signedArea };

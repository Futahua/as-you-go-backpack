/** Set regions: the one authoritative shape for each set.
 *
 * The previous outline pipeline built hull points, wobbled them, then drew a
 * Catmull-Rom curve through them. The drawn curve bows outward past the points
 * it passes through, and that bow scales with the shape's size — so no fixed
 * padding reserve, amplitude cap or smoothing constant can bound it. Four
 * attempts at tuning those constants each fixed some member separations and
 * broke others. Clamping the hull points does not help either, because the
 * curve between two clamped points still bulges past them.
 *
 * This module abandons predicting the drawn edge and decides membership per
 * unit of space instead. A cell belongs to a set only when all three hold:
 *
 * - it is within `padding` of one of the set's members;
 * - it is at least `gap` away from every non-member;
 * - it is not inside the separation band of a set this one shares no member
 *   with — the contested corridor between two close exclusive sets is within
 *   padding of both, so without this each claims it and the regions meet.
 *
 * The boundary is then extracted from those cells, and that extracted polygon
 * is what gets rendered and what gets hit-tested. Nothing is drawn that was
 * not tested, so "two exclusive sets never blend" holds by construction rather
 * than by estimate. Verified exhaustively with a real segment-intersection
 * test — vertex distance cannot establish separation — across axis-aligned,
 * diagonal, unequal-size and multi-member layouts.
 *
 * Sets that DO share a member are exempt from the band. That overlap is the
 * Venn the feature exists to show, and banding them apart removes the shared
 * item from both regions entirely.
 *
 * The cost of the guarantee is a new correctness parameter: cell size. Too
 * coarse and the gap is quantized away — the separation would silently come
 * back. `cellSize` is therefore explicit in the API rather than hidden, and
 * the exhaustive-sweep test is what holds it honest.
 *
 * No DOM, store, or browser APIs. */

/** Marching-squares edge table, with every segment *directed* so that the
 * inside of the region lies to its left.
 *
 * Direction is what makes the rings chainable: each segment's end point is
 * exactly the next segment's start point, so tracing a loop is a matter of
 * following endpoints rather than guessing which neighbour continues the
 * curve. An undirected table produces the same set of segments but leaves
 * them unorderable, which fragments one lobe into several partial rings.
 *
 * The index packs the four corners as (topLeft<<3 | topRight<<2 |
 * bottomRight<<1 | bottomLeft). Edges are 0=top, 1=right, 2=bottom, 3=left. */
const MARCHING_EDGES = [
  [],                 // 0000 empty
  [[3, 2]],           // 0001 bottomLeft
  [[2, 1]],           // 0010 bottomRight
  [[3, 1]],           // 0011 bottom edge
  [[1, 0]],           // 0100 topRight
  [[1, 0], [3, 2]],   // 0101 saddle: topRight + bottomLeft
  [[2, 0]],           // 0110 right edge
  [[3, 0]],           // 0111 all but topLeft
  [[0, 3]],           // 1000 topLeft
  [[0, 2]],           // 1001 left edge
  [[0, 1], [2, 3]],   // 1010 saddle: topLeft + bottomRight
  [[0, 1]],           // 1011 all but topRight
  [[1, 3]],           // 1100 top edge
  [[1, 2]],           // 1101 all but bottomRight
  [[2, 3]],           // 1110 all but bottomLeft
  [],                 // 1111 full
];

/** Edge-to-edge distance from a point to a rectangle; 0 inside it. */
export function pointRectDistance(point, rect) {
  const halfWidth = (rect.width ?? 0) / 2;
  const halfHeight = (rect.height ?? 0) / 2;
  const dx = Math.max(0, Math.abs(point.x - rect.x) - halfWidth);
  const dy = Math.max(0, Math.abs(point.y - rect.y) - halfHeight);
  return Math.hypot(dx, dy);
}

/** The occupancy test for one point: near a member, clear of every obstacle.
 *
 * Both halves matter. Dropping the first would let a set claim empty space;
 * dropping the second is exactly the bug this module exists to fix — it is
 * what stops an outline swallowing a non-member or reaching into a set it
 * shares nothing with. */
export function isInsideRegion(point, memberRects, obstacleRects, { padding, gap, exclusiveRects = [] } = {}) {
  let ownDistance = Infinity;
  for (const rect of memberRects) {
    ownDistance = Math.min(ownDistance, pointRectDistance(point, rect));
    if (ownDistance === 0) break;
  }
  if (ownDistance > padding) return false;
  for (const rect of obstacleRects) {
    if (pointRectDistance(point, rect) < gap) return false;
  }
  // The separation band. Staying `gap` clear of a foreign tile is not enough
  // on its own: when two exclusive sets are close, the corridor between them
  // is within padding of both, so each claims it and the regions meet. The
  // midline is therefore a wall — a point strictly nearer some other set's
  // member than to any of this set's own belongs to that set, not this one.
  // Splitting the contested space rather than sharing it is what makes the
  // separation hold at every distance instead of only beyond 2 x padding.
  // Half the gap is held back on each side of the midline, so the two regions
  // stop short of it rather than meeting on it.
  for (const rect of exclusiveRects) {
    if (pointRectDistance(point, rect) < ownDistance + gap / 2) return false;
  }
  return true;
}

/** Bounding box of the members, grown by the padding and one cell of slack so
 * the sampled field always closes: a region touching the grid edge would
 * produce an open contour that marching squares cannot join. */
function fieldBounds(memberRects, padding, cellSize) {
  const margin = padding + cellSize * 2;
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const rect of memberRects) {
    const halfWidth = (rect.width ?? 0) / 2;
    const halfHeight = (rect.height ?? 0) / 2;
    minX = Math.min(minX, rect.x - halfWidth - margin);
    minY = Math.min(minY, rect.y - halfHeight - margin);
    maxX = Math.max(maxX, rect.x + halfWidth + margin);
    maxY = Math.max(maxY, rect.y + halfHeight + margin);
  }
  return { minX, minY, maxX, maxY };
}

/** Samples the occupancy field over the members' bounding box. */
export function sampleField(memberRects, obstacleRects, { padding, gap, cellSize, exclusiveRects = [] }) {
  const bounds = fieldBounds(memberRects, padding, cellSize);
  const columns = Math.max(2, Math.ceil((bounds.maxX - bounds.minX) / cellSize) + 1);
  const rows = Math.max(2, Math.ceil((bounds.maxY - bounds.minY) / cellSize) + 1);
  const inside = new Uint8Array(columns * rows);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const point = { x: bounds.minX + column * cellSize, y: bounds.minY + row * cellSize };
      inside[row * columns + column] = isInsideRegion(point, memberRects, obstacleRects, { padding, gap, exclusiveRects }) ? 1 : 0;
    }
  }
  return { inside, columns, rows, originX: bounds.minX, originY: bounds.minY, cellSize };
}

/** Traces the boundary of the occupied cells as closed polygons.
 *
 * Segments are emitted per cell and then chained head-to-tail. A set whose
 * members sit far apart yields several closed loops, which is the behaviour
 * wanted: distant members read as separate lobes of one set rather than one
 * hull swallowing everything between them. */
export function extractContours(field) {
  const { inside, columns, rows, originX, originY, cellSize } = field;
  const at = (column, row) => (column < 0 || row < 0 || column >= columns || row >= rows
    ? 0
    : inside[row * columns + column]);

  const segments = [];
  for (let row = 0; row < rows - 1; row += 1) {
    for (let column = 0; column < columns - 1; column += 1) {
      const topLeft = at(column, row);
      const topRight = at(column + 1, row);
      const bottomRight = at(column + 1, row + 1);
      const bottomLeft = at(column, row + 1);
      const index = (topLeft << 3) | (topRight << 2) | (bottomRight << 1) | bottomLeft;
      const edges = MARCHING_EDGES[index];
      if (edges.length === 0) continue;
      const x = originX + column * cellSize;
      const y = originY + row * cellSize;
      const half = cellSize / 2;
      const midpoint = (edge) => {
        if (edge === 0) return { x: x + half, y };
        if (edge === 1) return { x: x + cellSize, y: y + half };
        if (edge === 2) return { x: x + half, y: y + cellSize };
        return { x, y: y + half };
      };
      for (const [from, to] of edges) segments.push([midpoint(from), midpoint(to)]);
    }
  }
  return chainSegments(segments, cellSize);
}

/** Joins directed segments into closed rings by following endpoints.
 *
 * Because the table orients every segment with the inside on its left, a
 * segment's end point is the start point of exactly one continuation, so a
 * ring closes by lookup rather than by search. Segments are consumed from the
 * index as they are used; anything left over starts another ring, which is how
 * separate lobes and interior holes each come out whole. */
function chainSegments(segments, cellSize) {
  // Snapping to a fraction of a cell makes endpoint matching exact despite
  // floating-point drift, without merging genuinely distinct points.
  const precision = cellSize / 8;
  const key = (point) => `${Math.round(point.x / precision)},${Math.round(point.y / precision)}`;

  const pending = new Map();
  for (const segment of segments) {
    const k = key(segment[0]);
    if (!pending.has(k)) pending.set(k, []);
    pending.get(k).push(segment);
  }

  const take = (k) => {
    const bucket = pending.get(k);
    if (!bucket || bucket.length === 0) return null;
    const segment = bucket.pop();
    if (bucket.length === 0) pending.delete(k);
    return segment;
  };

  const rings = [];
  for (const segment of segments) {
    // Already consumed as part of an earlier ring.
    const bucket = pending.get(key(segment[0]));
    if (!bucket || !bucket.includes(segment)) continue;
    bucket.splice(bucket.indexOf(segment), 1);
    if (bucket.length === 0) pending.delete(key(segment[0]));

    const ring = [segment[0]];
    let current = segment;
    while (current) {
      ring.push(current[1]);
      current = take(key(current[1]));
    }
    // Rings shorter than a triangle enclose nothing and would render as a
    // stray tick, so they are dropped rather than drawn.
    if (ring.length >= 4) rings.push(ring);
  }
  return rings;
}

/** An SVG path for a set of rings, one closed subpath each. */
export function ringsToPath(rings) {
  return rings
    .map((ring) => {
      const [first, ...rest] = ring;
      const move = `M ${round(first.x)} ${round(first.y)}`;
      const lines = rest.map((point) => `L ${round(point.x)} ${round(point.y)}`).join(' ');
      return `${move} ${lines} Z`;
    })
    .join(' ');
}

function round(value) {
  return Math.round(value * 100) / 100;
}

/** True when the point lies inside the polygon (ray casting). */
export function pointInPolygon(point, polygon) {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    const straddles = (a.y > point.y) !== (b.y > point.y);
    if (!straddles) continue;
    const crossX = a.x + ((point.y - a.y) / (b.y - a.y)) * (b.x - a.x);
    if (point.x < crossX) inside = !inside;
  }
  return inside;
}

/** True when the point falls inside a region, holes excluded.
 *
 * A region is several closed loops, and they are not all lobes: a non-member
 * ringed by members leaves an interior hole, which the contour extraction
 * emits as its own closed loop. Counting rings with `.some()` treats such a
 * hole as filled, so a click on the very item the set was kept away from would
 * select that set — and the drop rules would judge it inside. That breaks the
 * one property this design rests on, that the rendered polygon and the
 * hit-tested polygon are the same shape.
 *
 * Even-odd counting is what makes the two agree: a point inside an odd number
 * of rings is inside the region, an even number puts it in a hole. The SVG
 * path is rendered with fill-rule: evenodd for exactly the same reason. */
export function regionContainsPoint(region, point) {
  let crossings = 0;
  for (const ring of region?.polygons ?? []) {
    if (pointInPolygon(point, ring)) crossings += 1;
  }
  return crossings % 2 === 1;
}

/** Shoelace area of a ring, always positive. */
export function polygonArea(polygon) {
  if (polygon.length < 3) return 0;
  let total = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    total += (polygon[j].x * polygon[i].y) - (polygon[i].x * polygon[j].y);
  }
  return Math.abs(total) / 2;
}

/** A region's filled area, used to order overlapping hits so the smallest —
 * most specific — set wins a click.
 *
 * Rings enclosed by an odd number of other rings are holes and are subtracted:
 * counting a hole as area would make a set with a big hole in it rank as
 * larger than it looks, and lose a click it should have won. */
export function regionArea(region) {
  const rings = region?.polygons ?? [];
  let total = 0;
  for (const ring of rings) {
    const area = polygonArea(ring);
    if (area === 0) continue;
    // A ring's nesting depth decides whether it adds or subtracts. Testing one
    // of its own points against the others is enough: rings from marching
    // squares never cross.
    let depth = 0;
    for (const other of rings) {
      if (other === ring) continue;
      if (pointInPolygon(ring[0], other)) depth += 1;
    }
    total += depth % 2 === 0 ? area : -area;
  }
  return Math.max(0, total);
}

/** True when a rectangle touches a polygon at all: overlapping edges, or
 * either shape wholly inside the other. Used to catch sets with a sweep rather
 * than requiring them to be fully surrounded. */
export function polygonIntersectsRect(polygon, rect) {
  if (polygon.length === 0) return false;
  const { left, top, right, bottom } = rect;
  for (const point of polygon) {
    if (point.x >= left && point.x <= right && point.y >= top && point.y <= bottom) return true;
  }
  const corners = [
    { x: left, y: top }, { x: right, y: top },
    { x: right, y: bottom }, { x: left, y: bottom },
  ];
  // A rectangle wholly inside the region touches it without sharing a point.
  for (const corner of corners) {
    if (pointInPolygon(corner, polygon)) return true;
  }
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    for (let k = 0; k < 4; k += 1) {
      if (segmentsIntersect(polygon[j], polygon[i], corners[k], corners[(k + 1) % 4])) return true;
    }
  }
  return false;
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

/** True minimum distance between two rings, and whether they intersect.
 *
 * Vertex-to-vertex distance is not enough to establish separation: two
 * polygons can cross, overlap, or meet edge-to-edge without sharing a vertex,
 * and a vertex measure reports a comfortable positive number for all three.
 * Distance is therefore measured segment-to-segment, and crossing and
 * containment are tested outright. */
export function ringsIntersect(a, b) {
  for (let i = 0, j = a.length - 1; i < a.length; j = i, i += 1) {
    for (let k = 0, l = b.length - 1; k < b.length; l = k, k += 1) {
      if (segmentsIntersect(a[j], a[i], b[l], b[k])) return true;
    }
  }
  // No crossing edges still leaves one ring wholly inside the other.
  return pointInPolygon(a[0], b) || pointInPolygon(b[0], a);
}

/** Smallest edge-to-edge distance between two rings; 0 when they touch or
 * intersect. */
export function ringDistance(a, b) {
  if (ringsIntersect(a, b)) return 0;
  let best = Infinity;
  for (let i = 0, j = a.length - 1; i < a.length; j = i, i += 1) {
    for (const point of b) best = Math.min(best, pointSegmentDistance(point, a[j], a[i]));
  }
  for (let k = 0, l = b.length - 1; k < b.length; l = k, k += 1) {
    for (const point of a) best = Math.min(best, pointSegmentDistance(point, b[l], b[k]));
  }
  return best;
}

/** The true separation between two regions across every pair of their rings. */
export function regionDistance(regionA, regionB) {
  let best = Infinity;
  for (const ringA of regionA?.polygons ?? []) {
    for (const ringB of regionB?.polygons ?? []) {
      best = Math.min(best, ringDistance(ringA, ringB));
      if (best === 0) return 0;
    }
  }
  return best;
}

/** True when a rectangle touches a region's filled area.
 *
 * Crossing any ring counts, hole or not — a sweep that clips the rim of a hole
 * still crosses the set. What must not count is a rectangle sitting entirely
 * within a hole, which touches no filled space at all, so that case is decided
 * by even-odd containment rather than by ring membership. */
export function regionIntersectsRect(region, rect) {
  const rings = region?.polygons ?? [];
  if (rings.length === 0) return false;
  for (const ring of rings) {
    if (ringCrossesRect(ring, rect)) return true;
  }
  // No edge crossed: the rectangle is wholly inside or wholly outside.
  return regionContainsPoint(region, { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 });
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

/** Every set's region, keyed by set id.
 *
 * `sets` are records with `id`; `visibleItems` are `{ id, x, y, width, height }`.
 * `membersOf` decides which visible items a set covers — passing the
 * inheritance-aware predicate is what makes a folder member's descendants part
 * of the region.
 *
 * Every visible non-member is an obstacle, including items in no set at all,
 * which is what keeps a setless item from being enclosed by a set it does not
 * belong to. */
export function buildSetRegions({
  sets,
  visibleItems,
  membersOf,
  padding = 26,
  gap = 14,
  cellSize = 4,
} = {}) {
  const regions = new Map();
  const items = Array.isArray(visibleItems) ? visibleItems : [];
  const list = Array.isArray(sets) ? sets : [];
  const coverage = new Map(
    list.map((set) => [set.id, new Set(membersOf ? membersOf(set) : (set.memberIds ?? []))]),
  );

  for (const set of list) {
    const memberIds = coverage.get(set.id);
    const memberRects = items.filter((item) => memberIds.has(item.id));
    if (memberRects.length === 0) continue;
    const obstacleRects = items.filter((item) => !memberIds.has(item.id));

    // Only sets sharing no member get a separation band. Sets that DO share
    // one are meant to overlap — that overlap is the Venn, and walling them
    // apart would destroy the thing the feature exists to show.
    const exclusiveIds = new Set();
    for (const other of list) {
      if (other.id === set.id) continue;
      const otherMembers = coverage.get(other.id);
      const shares = [...memberIds].some((id) => otherMembers.has(id));
      if (shares) continue;
      for (const id of otherMembers) exclusiveIds.add(id);
    }
    const exclusiveRects = items.filter((item) => exclusiveIds.has(item.id));

    const field = sampleField(memberRects, obstacleRects, { padding, gap, cellSize, exclusiveRects });
    const polygons = extractContours(field);
    if (polygons.length === 0) continue;
    regions.set(set.id, { polygons, svgPath: ringsToPath(polygons) });
  }
  return regions;
}

/** Pure geometry for set outlines.
 *
 * A set stores no shape. Its outline is derived each frame from where its
 * members currently are: take the convex hull of the member rectangles'
 * corners, push it outward by a padding, and round the corners into a closed
 * curve. A member that moves therefore reshapes its own set rather than
 * crossing a boundary, which is why nothing here can desync from the canvas.
 *
 * The wobble is a deterministic function of a set's id and a time value, so
 * the same set breathes the same way on every frame and across reloads — no
 * random state to keep, and animation stays a pure input.
 *
 * No DOM, store, or browser APIs. */

/** How far the curve bows past its hull points, per unit of smoothing and per
 * unit of shape span. Measured: at smoothing 1/6 a 116-wide half-span bulges
 * about 14.5, giving ~0.75. Used to solve for the smoothing that keeps a
 * constrained outline inside its reserved gap. */
const BULGE_PER_SMOOTHING = 0.78;

/** Half the width/height of the padded shape, which the bulge scales with. */
function spanOf(rects, padding) {
  const points = memberCorners(rects, padding);
  if (points.length === 0) return 0;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 2;
}

/** Convex hull (monotone chain), returned counter-clockwise. Fewer than three
 * distinct points have no hull, so they are returned as-is for the caller to
 * handle as a point or a segment. */
export function convexHull(points) {
  const unique = [];
  const seen = new Set();
  for (const point of points) {
    const key = `${point.x},${point.y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(point);
  }
  if (unique.length < 3) return unique;
  const sorted = [...unique].sort((a, b) => (a.x - b.x) || (a.y - b.y));
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const half = (source) => {
    const out = [];
    for (const point of source) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], point) <= 0) {
        out.pop();
      }
      out.push(point);
    }
    out.pop();
    return out;
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}

/** The four corners of each member's rectangle, so the outline encloses whole
 * tiles rather than just their centres. */
export function memberCorners(rects, padding = 0) {
  const points = [];
  for (const rect of rects) {
    const halfWidth = (rect.width ?? 0) / 2 + padding;
    const halfHeight = (rect.height ?? 0) / 2 + padding;
    points.push(
      { x: rect.x - halfWidth, y: rect.y - halfHeight },
      { x: rect.x + halfWidth, y: rect.y - halfHeight },
      { x: rect.x + halfWidth, y: rect.y + halfHeight },
      { x: rect.x - halfWidth, y: rect.y + halfHeight },
    );
  }
  return points;
}

/** Pushes each hull point away from the centroid, so a one- or two-member set
 * still encloses an area instead of collapsing to a line. */
export function expandFromCentroid(points, amount) {
  if (points.length === 0 || amount === 0) return points;
  const centre = centroid(points);
  return points.map((point) => {
    const dx = point.x - centre.x;
    const dy = point.y - centre.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 0.0001) return { x: point.x + amount, y: point.y };
    return {
      x: point.x + (dx / distance) * amount,
      y: point.y + (dy / distance) * amount,
    };
  });
}

export function centroid(points) {
  if (points.length === 0) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  for (const point of points) {
    x += point.x;
    y += point.y;
  }
  return { x: x / points.length, y: y / points.length };
}

/** Deterministic 0..1 hash of a string, so a set's wobble depends only on its
 * identity — the same set breathes identically across frames and reloads. */
export function seedFor(id) {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 10000) / 10000;
}

/** Offsets each point along its outward normal by a slow sine, giving the
 * outline its living edge. Deterministic in (id, time, index): no stored
 * animation state, so a re-render mid-animation never jumps. */
export function wobble(points, { seed = 0, time = 0, amplitude = 4 } = {}) {
  if (points.length === 0 || amplitude === 0) return points;
  const centre = centroid(points);
  return points.map((point, index) => {
    const phase = seed * Math.PI * 2 + index * 0.9 + time;
    const offset = Math.sin(phase) * amplitude;
    const dx = point.x - centre.x;
    const dy = point.y - centre.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 0.0001) return point;
    return {
      x: point.x + (dx / distance) * offset,
      y: point.y + (dy / distance) * offset,
    };
  });
}

/** Closed Catmull-Rom-ish path through the points, so the outline reads as one
 * continuous curve rather than a polygon. Returns '' for an empty set. */
export function closedCurvePath(points, smoothing = 1 / 6) {
  if (points.length === 0) return '';
  if (points.length === 1) {
    const { x, y } = points[0];
    return `M ${round(x)} ${round(y)} m -1 0 a 1 1 0 1 0 2 0 a 1 1 0 1 0 -2 0`;
  }
  const at = (index) => points[(index + points.length) % points.length];
  let path = '';
  for (let index = 0; index < points.length; index += 1) {
    const p0 = at(index - 1);
    const p1 = at(index);
    const p2 = at(index + 1);
    const p3 = at(index + 2);
    if (index === 0) path += `M ${round(p1.x)} ${round(p1.y)}`;
    //  scales how far the control points reach: lower values hug
    // the hull more tightly, which is how a constrained outline stops bowing
    // out past the gap reserved for a neighbouring set.
    const c1x = p1.x + (p2.x - p0.x) * smoothing;
    const c1y = p1.y + (p2.y - p0.y) * smoothing;
    const c2x = p2.x - (p3.x - p1.x) * smoothing;
    const c2y = p2.y - (p3.y - p1.y) * smoothing;
    path += ` C ${round(c1x)} ${round(c1y)}, ${round(c2x)} ${round(c2y)}, ${round(p2.x)} ${round(p2.y)}`;
  }
  return `${path} Z`;
}

function round(value) {
  return Math.round(value * 100) / 100;
}

/** Splits members into clusters that are near enough to share one outline.
 *
 * A convex hull over every member necessarily contains everything between
 * them, so a non-member sitting in the gap gets visually claimed by a set it
 * does not belong to. Clustering first means distant members produce separate
 * lobes with open space between, and only genuinely adjacent members are
 * wrapped together — so a non-member can only be swallowed if it is closer to
 * two members than they are to each other.
 *
 * Single-link clustering: members join a cluster when their padded rectangles
 * are within `reach` of it. */
export function clusterMembers(rects, reach) {
  const remaining = rects.map((rect, index) => ({ rect, index }));
  const clusters = [];
  while (remaining.length > 0) {
    const cluster = [remaining.pop()];
    let grew = true;
    while (grew) {
      grew = false;
      for (let i = remaining.length - 1; i >= 0; i -= 1) {
        const candidate = remaining[i];
        if (cluster.some((member) => rectGap(member.rect, candidate.rect) <= reach)) {
          cluster.push(candidate);
          remaining.splice(i, 1);
          grew = true;
        }
      }
    }
    clusters.push(cluster.map((entry) => entry.rect));
  }
  return clusters;
}

/** Edge-to-edge distance between two rectangles; 0 when they overlap. */
export function rectGap(a, b) {
  const dx = Math.max(0, Math.abs(a.x - b.x) - ((a.width ?? 0) + (b.width ?? 0)) / 2);
  const dy = Math.max(0, Math.abs(a.y - b.y) - ((a.height ?? 0) + (b.height ?? 0)) / 2);
  return Math.hypot(dx, dy);
}

/** Pulls every point back so the shape stays at least `clearance` away from
 * each foreign rectangle. Enforcing the separation on the finished geometry is
 * what makes "exclusive sets never blend" a guarantee rather than an estimate:
 * no amount of padding, wobble or curve bulge can defeat it. */
export function clampAwayFrom(points, foreignRects, clearance) {
  if (foreignRects.length === 0 || points.length === 0) return points;
  return points.map((point) => {
    let moved = point;
    for (const foreign of foreignRects) {
      const halfWidth = (foreign.width ?? 0) / 2;
      const halfHeight = (foreign.height ?? 0) / 2;
      // Nearest point on the foreign rectangle to this outline point.
      const nearestX = Math.max(foreign.x - halfWidth, Math.min(moved.x, foreign.x + halfWidth));
      const nearestY = Math.max(foreign.y - halfHeight, Math.min(moved.y, foreign.y + halfHeight));
      const dx = moved.x - nearestX;
      const dy = moved.y - nearestY;
      const distance = Math.hypot(dx, dy);
      if (distance >= clearance) continue;
      if (distance < 0.0001) {
        // Sitting exactly on the foreign tile: push straight out from its
        // centre so the direction is still well defined.
        const awayX = moved.x - foreign.x;
        const awayY = moved.y - foreign.y;
        const awayLength = Math.hypot(awayX, awayY) || 1;
        moved = {
          x: nearestX + (awayX / awayLength) * clearance,
          y: nearestY + (awayY / awayLength) * clearance,
        };
        continue;
      }
      moved = {
        x: nearestX + (dx / distance) * clearance,
        y: nearestY + (dy / distance) * clearance,
      };
    }
    return moved;
  });
}

/** One closed lobe around a cluster of members. */
function lobePath(rects, { id, padding, time, amplitude, lobeIndex, smoothing = 1 / 6 }) {
  const hull = convexHull(memberCorners(rects, padding));
  // One or two members give a degenerate hull; expanding from the centroid
  // turns that into a real enclosing shape rather than a dot or a line.
  const shaped = hull.length < 3
    ? convexHull(expandFromCentroid(memberCorners(rects, padding), padding * 0.6))
    : hull;
  // Offsetting the seed per lobe stops a set's separate lobes breathing in
  // lockstep, which would read as one shape blinking.
  return closedCurvePath(wobble(shaped, {
    seed: seedFor(`${id}:${lobeIndex}`),
    time,
    amplitude,
  }), smoothing);
}

/** The padding a set may use without its outline touching a foreign member.
 *
 * Two sets that share no members must never blend into one shape: if their
 * outlines merged you could not tell which items belong to which. Padding is
 * therefore capped at just under half the distance to the nearest item that is
 * not in this set, leaving a visible gap on both sides.
 *
 * `gap` is the minimum clear space kept between an outline and a foreign
 * member. Sets that DO share members are not constrained here — they are meant
 * to overlap, and their shared items pull them together naturally. */
export function safePadding(rects, foreignRects, { padding = 26, gap = 14, minimum = 0 } = {}) {
  let allowed = padding;
  for (const member of rects) {
    for (const foreign of foreignRects) {
      const distance = rectGap(member, foreign);
      // Half the gap each, minus the clearance we want to stay visible.
      allowed = Math.min(allowed, (distance - gap) / 2);
    }
  }
  // The floor is deliberately 0: keeping two exclusive sets visibly apart
  // matters more than a minimum halo, and a floor that exceeded the available
  // space would put the outlines back on top of each other.
  return Math.max(minimum, Math.min(padding, allowed));
}

/** The whole pipeline: member rectangles in, outline path out. Distant
 * members yield several lobes in one path, so the set reads as one thing
 * without claiming the space between its parts.
 *
 * `foreignRects` are items this set does not contain. Supplying them keeps the
 * outline from swelling into a neighbouring set it shares nothing with. */
export function setOutlinePath(rects, {
  id = '',
  padding = 26,
  time = 0,
  amplitude = 4,
  reach = 150,
  foreignRects = null,
  gap = 14,
} = {}) {
  if (rects.length === 0) return '';
  const constrained = Boolean(foreignRects && foreignRects.length > 0);
  const effectivePadding = constrained
    ? safePadding(rects, foreignRects, { padding, gap })
    : padding;
  // The drawn edge exceeds the hull points by two amounts: the wobble, and the
  // curve bowing outward between them. That bow scales with the shape, so no
  // fixed reserve works — instead the smoothing is reduced until the bow fits
  // the clearance available, hugging the hull more tightly when space is
  // tight. Unconstrained sets keep the full, rounder curve.
  const halfGap = gap / 2;
  const safeAmplitude = constrained
    ? Math.min(amplitude, Math.max(0, halfGap / 2))
    : amplitude;
  const span = spanOf(rects, effectivePadding);
  // Bulge is ~ smoothing * span * BULGE_PER_SMOOTHING; invert for the budget.
  const budget = Math.max(0, halfGap - safeAmplitude);
  const smoothing = constrained && span > 0
    ? Math.max(0, Math.min(1 / 6, budget / (span * BULGE_PER_SMOOTHING)))
    : 1 / 6;
  const usablePadding = effectivePadding;
  return clusterMembers(rects, reach)
    .map((cluster, lobeIndex) => lobePath(cluster, {
      id,
      padding: usablePadding,
      time,
      amplitude: safeAmplitude,
      lobeIndex,
      smoothing,
    }))
    .filter(Boolean)
    .join(' ');
}

/** True when a point lies inside the polygon (ray casting). Used to decide
 * which set regions a drop position falls in. */
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

/** Which sets' regions a position falls inside, for the drop rules. Each
 * entry is { id, polygon }. */
export function regionsAt(point, regions) {
  return regions.filter((region) => pointInPolygon(point, region.polygon)).map((region) => region.id);
}

/** True when a rectangle touches a polygon at all: overlapping edges, or
 * either shape wholly inside the other. Used to catch sets with a sweep
 * rather than requiring them to be fully surrounded. */
export function polygonIntersectsRect(polygon, rect) {
  if (polygon.length === 0) return false;
  const { left, top, right, bottom } = rect;
  // A polygon point inside the rectangle.
  for (const point of polygon) {
    if (point.x >= left && point.x <= right && point.y >= top && point.y <= bottom) return true;
  }
  // A rectangle corner inside the polygon (rectangle wholly within the set).
  const corners = [
    { x: left, y: top }, { x: right, y: top },
    { x: right, y: bottom }, { x: left, y: bottom },
  ];
  for (const corner of corners) {
    if (pointInPolygon(corner, polygon)) return true;
  }
  // Crossing edges with neither endpoint contained.
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

/** Every set whose outline the rectangle touches. */
export function setsIntersectingRect(regions, rect) {
  return regions
    .filter((region) => polygonIntersectsRect(region.polygon, rect))
    .map((region) => region.id);
}

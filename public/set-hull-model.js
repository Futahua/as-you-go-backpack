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
export function closedCurvePath(points) {
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
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    path += ` C ${round(c1x)} ${round(c1y)}, ${round(c2x)} ${round(c2y)}, ${round(p2.x)} ${round(p2.y)}`;
  }
  return `${path} Z`;
}

function round(value) {
  return Math.round(value * 100) / 100;
}

/** The whole pipeline: member rectangles in, outline path out. */
export function setOutlinePath(rects, { id = '', padding = 26, time = 0, amplitude = 4 } = {}) {
  if (rects.length === 0) return '';
  const hull = convexHull(memberCorners(rects, padding));
  // One or two members give a degenerate hull; expanding from the centroid
  // turns that into a real enclosing shape rather than a dot or a line.
  const rounded = hull.length < 3
    ? expandFromCentroid(memberCorners(rects, padding), padding * 0.6)
    : hull;
  const shaped = hull.length < 3 ? convexHull(rounded) : rounded;
  return closedCurvePath(wobble(shaped, { seed: seedFor(id), time, amplitude }));
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

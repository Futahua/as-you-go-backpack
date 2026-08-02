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
 * unit of space instead. The boundary is extracted from a sampled field, and
 * that extracted polygon is what gets rendered and what gets hit-tested.
 * Nothing is drawn that was not tested, so "two exclusive sets never blend"
 * holds by construction rather than by estimate. Verified exhaustively with a
 * real segment-intersection test — vertex distance cannot establish
 * separation — across axis-aligned, diagonal, unequal-size and multi-member
 * layouts.
 *
 * ## A membrane, not a halo
 *
 * The first version of that field was a union of padded haloes: a cell joined
 * a set when it was within `padding` of some member and clear of every
 * non-member. That is an occupancy visualization, not a container. Members
 * far enough apart produced unrelated blobs, and every passing setless item
 * carved a permanent hole or channel through the outline. Live, it read as
 * padded category zones around icons rather than as one set.
 *
 * A set is now built as one closed membrane:
 *
 * 1. padded seed areas around the members (`buildSeedMask`);
 * 2. a safe mask that excludes exclusive-set territory (`buildSafeMask`);
 * 3. routes through safe space joining disconnected seed components, chosen as
 *    a minimum spanning tree so a set makes n-1 connections, not n^2
 *    (`routeConnectors`);
 * 4. those routes thickened into necks and unioned with the seeds;
 * 5. the contour extracted from the union.
 *
 * A normal set therefore has exactly one filled component. Where no legal
 * route exists — an exclusive set forming a complete wall — the region says so
 * with `connected: false` rather than silently rendering unrelated islands,
 * and the caller can reject or repair the layout that caused it.
 *
 * Ordinary non-members are deliberately *not* obstacles any more. They do not
 * shape the membrane; the membrane constrains them (see set-constraint-model.js).
 * Causality runs one way: the boundary moves the icons, the icons do not punch
 * holes through the boundary. Only members of exclusive sets still carve, and
 * only through the separation band, because two sets sharing no member must
 * never blend.
 *
 * Sets that DO share a member are exempt from the band. That overlap is the
 * Venn the feature exists to show, and banding them apart removes the shared
 * item from both regions entirely.
 *
 * The cost of the guarantee is a correctness parameter: cell size. Too coarse
 * and the gap is quantized away — the separation would silently come back.
 * `cellSize` is therefore explicit in the API rather than hidden, and the
 * exhaustive-sweep test is what holds it honest.
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

/** Distance to a rectangle with its corners rounded off by `radius`.
 *
 * A plain rectangle distance has flat faces, and an isoline of it is a rounded
 * rectangle — so a set built from that metric is a union of padded boxes, which
 * is exactly the blocky silhouette the outlines had. Shrinking the rectangle by
 * the radius and measuring to that instead rounds the whole shape rather than
 * only its corners, so the isoline is a capsule-ish blob with no flat runs.
 *
 * The radius is clamped to half the smaller side so a small icon degenerates to
 * a circle rather than inverting. */
export function pointRoundedRectDistance(point, rect, radius) {
  const halfWidth = (rect.width ?? 0) / 2;
  const halfHeight = (rect.height ?? 0) / 2;
  const r = Math.max(0, Math.min(radius, halfWidth, halfHeight));
  const dx = Math.max(0, Math.abs(point.x - rect.x) - (halfWidth - r));
  const dy = Math.max(0, Math.abs(point.y - rect.y) - (halfHeight - r));
  return Math.max(0, Math.hypot(dx, dy) - r);
}

/** A smooth minimum: like `Math.min`, but the two arguments blend over a band
 * of width `k` instead of meeting at a crease.
 *
 * This is what turns two adjacent members into one bulge rather than two boxes
 * with a notch between them. A hard `min` over the members makes the field
 * piecewise, and every piece boundary is a crease that the contour traces as a
 * corner — which is the other half of why the outlines looked constructed
 * rather than grown. The polynomial form is used rather than the exponential
 * one because it is exact outside the blend band, so a member far from any
 * other keeps its true distance and the shape does not quietly inflate.
 */
export function smoothMin(a, b, k) {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (b - a)) / k));
  return (b * (1 - h)) + (a * h) - (k * h * (1 - h));
}

/** The signed clearance of one point for one set: positive inside, negative
 * outside, zero exactly on the membrane.
 *
 * This is the seed field — members and their padding only, before any
 * connector neck has been added. Three terms, and the smallest wins, so a
 * point is inside only when every rule agrees:
 *
 * - `padding - ownDistance`: how far the point still is from the padded edge
 *   of the nearest member. Beyond the padding it goes negative.
 * - `obstacleDistance - gap`: clearance from a hard obstacle. Ordinary
 *   non-members are no longer passed here (see the module header); this is now
 *   only used where a caller genuinely needs a rect kept out.
 * - `exclusiveDistance - (ownDistance + gap / 2)`: the separation band.
 *   Staying `gap` clear of a foreign tile is not enough on its own: when two
 *   exclusive sets are close, the corridor between them is within padding of
 *   both, so each claims it and the regions meet. The midline is therefore a
 *   wall — a point strictly nearer some other set's member than to any of this
 *   set's own belongs to that set, not this one. Splitting the contested space
 *   rather than sharing it is what makes the separation hold at every distance
 *   instead of only beyond 2 x padding. Half the gap is held back on each side
 *   of the midline, so the two regions stop short of it rather than meeting.
 *
 * Returning a scalar rather than a boolean is what lets the contour be
 * extracted by interpolation instead of at fixed grid-edge midpoints — the
 * cause of the staircase edges.
 *
 * ## Why the member distance is smooth
 *
 * `ownDistance` is a *smooth* minimum over the members, measured to rounded
 * rectangles rather than sharp ones. Both matter, and neither is cosmetic
 * polish over a correct shape — they are what the shape is.
 *
 * A hard `min` of sharp rectangle distances makes the field piecewise: each
 * member owns a region of space, and every boundary between two of them is a
 * crease that the contour traces as a corner. Unioned padded boxes is exactly
 * what that produces, and it reads as construction rather than growth. The
 * smooth minimum blends adjacent members into one bulge, and the rounded metric
 * removes the flat faces, so what comes out is a single continuous curve that
 * eases between members instead of stepping around them.
 *
 * `blend` sets how wide that easing band is. Zero reproduces the old union of
 * boxes exactly, which is what the geometry tests that predate this pin down. */
export function regionFieldValue(point, memberRects, obstacleRects, {
  padding, gap, exclusiveRects = [], blend = 0, cornerRadius = 0,
} = {}) {
  let ownDistance = Infinity;
  for (const rect of memberRects) {
    const distance = cornerRadius > 0
      ? pointRoundedRectDistance(point, rect, cornerRadius)
      : pointRectDistance(point, rect);
    ownDistance = ownDistance === Infinity
      ? distance
      : smoothMin(ownDistance, distance, blend);
    if (ownDistance === 0 && blend <= 0) break;
  }
  let value = padding - ownDistance;
  for (const rect of obstacleRects) {
    value = Math.min(value, pointRectDistance(point, rect) - gap);
    if (value < 0) return value;
  }
  for (const rect of exclusiveRects) {
    value = Math.min(value, pointRectDistance(point, rect) - (ownDistance + gap / 2));
    if (value < 0) return value;
  }
  return value;
}

/** The occupancy test for one point, as a boolean.
 *
 * Kept as the readable form of the rule and as the predicate the routing and
 * safety masks are built from. The field itself is scalar; this is its sign. */
export function isInsideRegion(point, memberRects, obstacleRects, options = {}) {
  return regionFieldValue(point, memberRects, obstacleRects, options) >= 0;
}

/** Whether any border cell of a sampled field is occupied.
 *
 * A region reaching the edge of its own grid produces an open contour, which
 * marching squares cannot close into a ring — and an open chain returned as a
 * polygon inverts the region under even-odd counting. This is the precondition
 * for extraction, so the bounds are grown until it is false rather than sized
 * from a formula.
 *
 * `chainSegments` rejects open chains as well. Both layers are kept
 * deliberately: this one stops a bad field reaching extraction at all, and
 * that one catches any future path that bypasses this check. */
export function fieldHasOccupiedBorder(field) {
  const { inside, columns, rows } = field;
  for (let column = 0; column < columns; column += 1) {
    if (inside[column] || inside[(rows - 1) * columns + column]) return true;
  }
  for (let row = 0; row < rows; row += 1) {
    if (inside[row * columns] || inside[row * columns + columns - 1]) return true;
  }
  return false;
}

/** Bounding box of the members, grown by the padding and one cell of slack so
 * the sampled field always closes: a region touching the grid edge would
 * produce an open contour that marching squares cannot join.
 *
 * `extraMargin` reserves room for connector necks, which run between members
 * and can bow slightly outside the members' own padded box when routing around
 * an obstacle. Without it a neck could touch the grid edge and open the
 * contour. */
function fieldBounds(memberRects, padding, cellSize, extraMargin = 0) {
  const margin = padding + extraMargin + cellSize * 2;
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

/** Samples the scalar field over the members' bounding box.
 *
 * `values` is the authoritative sample; `inside` is its sign, kept because the
 * masks and the closure tests read occupancy rather than magnitude. */
export function sampleField(memberRects, obstacleRects, {
  padding, gap, cellSize, exclusiveRects = [], extraMargin = 0, blend = 0, cornerRadius = 0,
}) {
  const bounds = fieldBounds(memberRects, padding, cellSize, extraMargin);
  const columns = Math.max(2, Math.ceil((bounds.maxX - bounds.minX) / cellSize) + 1);
  const rows = Math.max(2, Math.ceil((bounds.maxY - bounds.minY) / cellSize) + 1);
  const values = new Float32Array(columns * rows);
  const inside = new Uint8Array(columns * rows);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const point = { x: bounds.minX + column * cellSize, y: bounds.minY + row * cellSize };
      const value = regionFieldValue(point, memberRects, obstacleRects, {
        padding, gap, exclusiveRects, blend, cornerRadius,
      });
      values[row * columns + column] = value;
      inside[row * columns + column] = value >= 0 ? 1 : 0;
    }
  }
  return { values, inside, columns, rows, originX: bounds.minX, originY: bounds.minY, cellSize };
}

// ===========================================================================
// Membrane construction: seeds, safe space, routed connectors, union.
// ===========================================================================

/** Labels the connected components of an occupancy mask, 4-connected.
 *
 * Returns per-cell labels (0 = empty) and one representative cell per label.
 * 4-connectivity rather than 8 is deliberate: two lobes touching only at a
 * corner are not a membrane a finger could trace, so they are treated as
 * separate and given a real neck. */
export function labelComponents(mask, columns, rows) {
  const labels = new Int32Array(columns * rows);
  const representatives = [];
  let next = 0;
  const queue = new Int32Array(columns * rows);
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || labels[start] !== 0) continue;
    next += 1;
    representatives.push(start);
    labels[start] = next;
    let head = 0;
    let tail = 0;
    queue[tail += 1] = start;
    while (head < tail) {
      const index = queue[head += 1];
      const column = index % columns;
      const row = (index - column) / columns;
      const neighbours = [
        column > 0 ? index - 1 : -1,
        column < columns - 1 ? index + 1 : -1,
        row > 0 ? index - columns : -1,
        row < rows - 1 ? index + columns : -1,
      ];
      for (const neighbour of neighbours) {
        if (neighbour < 0 || !mask[neighbour] || labels[neighbour] !== 0) continue;
        labels[neighbour] = next;
        queue[tail += 1] = neighbour;
      }
    }
  }
  return { labels, count: next, representatives };
}

/** Dijkstra from one component to every other over safe cells.
 *
 * The cost of a step is its length, so the cheapest route is the shortest
 * legal one — a neck takes the most direct path the exclusive sets leave open
 * rather than an arbitrary one. Diagonal steps cost sqrt(2) so the route does
 * not prefer staircases to straight lines.
 *
 * Search is seeded from every cell of the source component at cost 0, which
 * makes the result the distance from the component's *boundary* rather than
 * from an arbitrary representative cell. */
function routeFromComponent(sourceLabel, { labels, safe, columns, rows, cellSize, centreBias }) {
  const size = columns * rows;
  const cost = new Float64Array(size).fill(Infinity);
  const cameFrom = new Int32Array(size).fill(-1);
  // A bucketed queue: costs are multiples of 1 and sqrt(2) cells, so a simple
  // binary heap is the honest structure here.
  const heap = [];
  const push = (index, value) => {
    heap.push({ index, value });
    let child = heap.length - 1;
    while (child > 0) {
      const parent = (child - 1) >> 1;
      if (heap[parent].value <= heap[child].value) break;
      [heap[parent], heap[child]] = [heap[child], heap[parent]];
      child = parent;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length > 0) {
      heap[0] = last;
      let parent = 0;
      for (;;) {
        const left = parent * 2 + 1;
        const right = left + 1;
        let smallest = parent;
        if (left < heap.length && heap[left].value < heap[smallest].value) smallest = left;
        if (right < heap.length && heap[right].value < heap[smallest].value) smallest = right;
        if (smallest === parent) break;
        [heap[parent], heap[smallest]] = [heap[smallest], heap[parent]];
        parent = smallest;
      }
    }
    return top;
  };

  for (let index = 0; index < size; index += 1) {
    if (labels[index] === sourceLabel) {
      cost[index] = 0;
      push(index, 0);
    }
  }

  const straight = cellSize;
  const diagonal = cellSize * Math.SQRT2;
  const reached = new Map();
  while (heap.length > 0) {
    const { index, value } = pop();
    if (value > cost[index]) continue;
    const label = labels[index];
    if (label !== 0 && label !== sourceLabel && !reached.has(label)) {
      reached.set(label, index);
    }
    const column = index % columns;
    const row = (index - column) / columns;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        const nextColumn = column + dx;
        const nextRow = row + dy;
        if (nextColumn < 0 || nextRow < 0 || nextColumn >= columns || nextRow >= rows) continue;
        const neighbour = nextRow * columns + nextColumn;
        // Only safe space may be crossed: a route through an exclusive set's
        // band would produce a neck that merges the two sets.
        if (!safe[neighbour]) continue;
        // A diagonal step must not cut a corner between two blocked cells,
        // which would thread a neck through a wall one cell thick.
        if (dx !== 0 && dy !== 0) {
          if (!safe[row * columns + nextColumn] || !safe[nextRow * columns + column]) continue;
        }
        // Length, plus a small preference for open space. Without the bias a
        // straight run between two aligned members is a tie across every row
        // the corridor is wide, and Dijkstra resolves it arbitrarily — the neck
        // came out hugging one rim of the members rather than running between
        // their centres, which does not read as a connection at all. The bias
        // is a fraction of a cell, so it orders ties without ever preferring a
        // longer route to a shorter one.
        const stepped = value
          + (dx !== 0 && dy !== 0 ? diagonal : straight)
          + (centreBias ? centreBias[neighbour] : 0);
        if (stepped >= cost[neighbour]) continue;
        cost[neighbour] = stepped;
        cameFrom[neighbour] = index;
        push(neighbour, stepped);
      }
    }
  }

  const routes = [];
  for (const [label, index] of reached) {
    const path = [];
    let cursor = index;
    while (cursor !== -1 && labels[cursor] !== sourceLabel) {
      path.push(cursor);
      cursor = cameFrom[cursor];
    }
    if (cursor !== -1) path.push(cursor);
    routes.push({ from: sourceLabel, to: label, cost: cost[index], cells: path.reverse() });
  }
  return routes;
}

/** Distance from a point to a foreign set's padded seed region; 0 inside it.
 *
 * The seed region is the union of each member rectangle grown by `padding`, so
 * the distance to it is the distance to the nearest such grown rectangle. That
 * is not the same as the distance to the nearest raw tile minus the padding:
 * where two foreign tiles sit close their padded areas merge and reach further
 * than either alone, and a rectangle's corner reaches further than its face.
 * Routing against the tiles rather than the seed is what let a connector plan a
 * centreline that its own thickening then pushed into the other set.
 *
 * Union distance is exact from outside, which is the only case routing asks
 * about — a centreline inside a foreign seed is rejected by the clearance test
 * long before the approximation would matter. */
export function foreignSeedDistance(point, rects, padding) {
  let best = Infinity;
  for (const rect of rects) {
    best = Math.min(best, Math.max(0, pointRectDistance(point, rect) - padding));
    if (best === 0) return 0;
  }
  return best;
}

/** A small per-cell penalty that grows with distance from the members' centres.
 *
 * Its only job is to break ties. Two aligned members present a flat facing
 * edge, so every row across the corridor between them yields a route of the
 * same length, and Dijkstra resolves that arbitrarily — the neck came out
 * pressed against one rim, reading as a thread stuck to the members' side
 * rather than a connection between them. Ranking ties by nearness to the
 * member centres runs it down the line the eye already draws between them.
 *
 * The penalty is capped well below the cost of one cell of travel, so it can
 * never make a longer route beat a shorter one; it only orders routes that
 * already cost the same. */
function buildCentreBias(memberRects, { columns, rows, originX, originY, cellSize }) {
  const penalty = new Float32Array(columns * rows);
  if (memberRects.length === 0) return penalty;
  // Normalized against the grid's own diagonal so the scale does not depend on
  // how far apart the members happen to be.
  const span = Math.hypot(columns * cellSize, rows * cellSize) || 1;
  const scale = cellSize / 10;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = originX + column * cellSize;
      const y = originY + row * cellSize;
      let nearest = Infinity;
      for (const rect of memberRects) {
        nearest = Math.min(nearest, Math.hypot(x - rect.x, y - rect.y));
      }
      penalty[row * columns + column] = (nearest / span) * scale;
    }
  }
  return penalty;
}

/** Chooses the connectors that join every seed component into one, as a
 * minimum spanning tree over the candidate routes.
 *
 * An MST, not all pairs: three clusters need two necks, and connecting all
 * three pairs would draw a triangle of membrane through space no member
 * occupies. Kruskal over the candidates, cheapest first. */
export function selectSpanningRoutes(candidates, componentCount) {
  const parent = new Int32Array(componentCount + 1);
  for (let i = 0; i <= componentCount; i += 1) parent[i] = i;
  const find = (a) => {
    let root = a;
    while (parent[root] !== root) root = parent[root];
    while (parent[a] !== root) { const next = parent[a]; parent[a] = root; a = next; }
    return root;
  };

  const chosen = [];
  for (const route of [...candidates].sort((a, b) => a.cost - b.cost)) {
    const rootA = find(route.from);
    const rootB = find(route.to);
    if (rootA === rootB) continue;
    parent[rootA] = rootB;
    chosen.push(route);
    if (chosen.length === componentCount - 1) break;
  }

  let roots = 0;
  for (let label = 1; label <= componentCount; label += 1) {
    if (find(label) === label) roots += 1;
  }
  return { routes: chosen, connected: roots <= 1 };
}

/** Builds one set's membrane field: seeds, connectors, union.
 *
 * The returned field is scalar and signed exactly like `sampleField`'s, so the
 * contour extractor cannot tell whether a stretch of boundary came from a
 * member's padding or from a connector neck. That is the point — the neck is
 * membrane, not decoration drawn over one.
 *
 * `connected` is false only when some component could not be reached through
 * safe space at all, which happens when an exclusive set walls the route off
 * completely. It is reported rather than papered over so the move that caused
 * it can be rejected.
 *
 * `reserved` is the corridors exclusive sets built earlier have already taken,
 * as `{ a, b, radius }` segments. Sets are routed in turn rather than
 * independently because a neck is membrane that no tile marks: two sets whose
 * members interleave would otherwise each thread a neck through the same empty
 * space and merge there. */
export function buildMembraneField(options) {
  const {
    padding,
    gap,
    cellSize,
    neckRadius = Math.max(cellSize, Math.min(padding * 0.55, 16)),
    reserved = null,
    marginGrowthStep = padding + neckRadius + gap + cellSize * 4,
    maxMarginGrowthAttempts = 6,
  } = options;

  // Necks bow outside the members' padded box when routing around an exclusive
  // set, and a reservation can push one further still — the corridor another
  // set holds forces this one's spine `radius + neckRadius + gap` clear of it.
  //
  // How far that displacement reaches is not knowable before routing, and the
  // grid must be sized before routing can happen. Predicting the margin was
  // tried twice and was wrong both times, in opposite directions. So it is not
  // predicted: the membrane is built, and if its own contour would run off the
  // edge the whole build is repeated on a larger grid.
  //
  // Getting this wrong is not a cosmetic error. An unclosed contour chains into
  // two open paths that are returned as two rings, both wound the same way, so
  // even-odd counting cancels the area between them: 1662 cells of one set
  // vanished, and it presented as that set overlapping the very set whose
  // reservation had displaced its neck. The field was correct throughout.
  //
  // The growth is capped. An unbounded retry would turn a pathological layout
  // into a hang rather than an error, and every attempt resamples the whole
  // grid — cost grows with the square of the margin. Exhausting the cap is a
  // structured failure, not a silently larger grid.
  const displacement = reserved
    ? Math.max(0, ...reserved.map((segment) => segment.radius)) + neckRadius + gap
    : 0;
  // The closing pass dilates by `surfaceTension` before eroding back, and that
  // dilation needs room on the grid. Without the reserve it runs into the
  // border, which the distance transform reads as outside — so the erode pulls
  // the concavity open again and the closing quietly does nothing at exactly
  // the radii where it matters most.
  const tensionReserve = (options.surfaceTension ?? 0) + cellSize * 2;
  const initialExtraMargin = options.initialExtraMargin
    ?? (neckRadius + displacement + tensionReserve + cellSize * 2);

  let extraMargin = initialExtraMargin;
  let attempts = 0;
  let built = buildMembraneFieldOnGrid(options, neckRadius, extraMargin);
  while (fieldHasOccupiedBorder(built.field) && attempts < maxMarginGrowthAttempts) {
    attempts += 1;
    extraMargin += marginGrowthStep;
    built = buildMembraneFieldOnGrid(options, neckRadius, extraMargin);
  }

  if (fieldHasOccupiedBorder(built.field)) {
    // Never hand an open field to contour extraction. It would chain into open
    // paths and come back as polygons claiming space the field does not have.
    return {
      field: built.field,
      valid: false,
      connected: false,
      componentCount: built.componentCount,
      connectorRoutes: [],
      reservations: [],
      failureReason: 'field-bounds-exhausted',
      attemptedBounds: { extraMargin, attempts, cellCount: built.field.columns * built.field.rows },
    };
  }

  return {
    ...built,
    valid: true,
    failureReason: null,
    attemptedBounds: { extraMargin, attempts, cellCount: built.field.columns * built.field.rows },
  };
}

/** One attempt at a membrane on a grid of the given margin. */
function buildMembraneFieldOnGrid({
  memberRects,
  obstacleRects = [],
  exclusiveRects = [],
  reserved = null,
  padding,
  gap,
  cellSize,
  blend = 0,
  cornerRadius = 0,
  surfaceTension = 0,
}, neckRadius, extraMargin) {
  const field = sampleField(memberRects, obstacleRects, {
    padding, gap, cellSize, exclusiveRects, extraMargin, blend, cornerRadius,
  });
  const { values, columns, rows, originX, originY } = field;
  const size = columns * rows;

  const seed = new Uint8Array(size);
  for (let index = 0; index < size; index += 1) seed[index] = values[index] >= 0 ? 1 : 0;

  // Where a connector's *centreline* may run — a configuration-space problem,
  // not the same question as where membrane may sit.
  //
  // Routing plans a line but builds a body of radius `neckRadius` around it, so
  // a cell is only traversable when everything the thickened neck would touch
  // is still legal. In configuration space that is one test: the centreline
  // must clear every foreign region by `neckRadius + gap`. Getting this wrong
  // by treating the spine as the whole neck is what let a route pass a foreign
  // tile by 41.9 against a 40 requirement and then carry its thickened boundary
  // straight through the other set — the interleaved layout's outlines crossed
  // while every centreline was nominally clear.
  //
  // What it clears from matters as much as by how much. Distance to the foreign
  // *tile* is only an approximation of the foreign membrane: two adjacent
  // foreign tiles have padded areas that merge and reach further than `padding`
  // from either one, and a rectangle's corner reaches further than its face.
  // `foreignSeedDistance` measures the padded seed region itself, so the
  // clearance is from where the other set will actually be.
  //
  // The separation midline is deliberately *not* reused here. It reserves space
  // by proximity, so a single unrelated tile between two members owns an
  // infinite perpendicular strip and no neck can ever cross it — one stray set
  // would permanently tear any set spanning it. The midline still governs the
  // flesh (`neckSpaceAllowed`), where its `ownDistance` term stays bounded.
  //
  // Foreign *necks* are not tiles and this test cannot see them. They come in
  // through `reserved`: buildSetRegions routes the sets in a fixed order and
  // hands each one the corridors already committed, so two exclusive necks
  // cannot claim the same empty space.
  const safe = new Uint8Array(size);
  const centrelineClearance = neckRadius + gap;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const index = row * columns + column;
      const point = { x: originX + column * cellSize, y: originY + row * cellSize };
      if (seed[index]) { safe[index] = 1; continue; }
      let ok = true;
      for (const rect of obstacleRects) {
        if (pointRectDistance(point, rect) < gap + neckRadius) { ok = false; break; }
      }
      if (ok && exclusiveRects.length > 0) {
        ok = foreignSeedDistance(point, exclusiveRects, padding) >= centrelineClearance;
      }
      if (ok && reserved) {
        // A corridor another exclusive set has already taken. Its own half
        // width is baked into the reservation, so clearing this neck's half
        // width and the gap is what keeps the two apart.
        for (const segment of reserved) {
          if (pointSegmentDistance(point, segment.a, segment.b) < segment.radius + centrelineClearance) {
            ok = false;
            break;
          }
        }
      }
      safe[index] = ok ? 1 : 0;
    }
  }

  const radiusCells = Math.max(1, Math.ceil(neckRadius / cellSize));
  const { labels, count } = labelComponents(seed, columns, rows);
  let routes = [];
  let connected = count <= 1;
  if (count > 1) {
    const centreBias = buildCentreBias(memberRects, { columns, rows, originX, originY, cellSize });
    const candidates = [];
    for (let label = 1; label <= count; label += 1) {
      candidates.push(...routeFromComponent(label, { labels, safe, columns, rows, cellSize, centreBias }));
    }
    const selection = selectSpanningRoutes(candidates, count);
    routes = selection.routes;
    connected = selection.connected;
  }

  // Where a neck's flesh may sit, as opposed to where its spine may run.
  //
  // Routing keeps a whole neck-width clear of foreign tiles so a *spine* can be
  // thickened safely in open space. The flesh itself only has to obey what the
  // seed field obeys: the separation band, measured from this point's own
  // nearest member exactly as `regionFieldValue` measures it, plus the hard
  // obstacle clearance and any corridor another set already holds. Using the
  // routing mask for both was the bug that split sets into lobes.
  const neckSpaceAllowed = new Uint8Array(size);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const index = row * columns + column;
      const point = { x: originX + column * cellSize, y: originY + row * cellSize };
      let ownDistance = Infinity;
      for (const rect of memberRects) {
        ownDistance = Math.min(ownDistance, pointRectDistance(point, rect));
        if (ownDistance === 0) break;
      }
      let ok = true;
      for (const rect of obstacleRects) {
        if (pointRectDistance(point, rect) < gap) { ok = false; break; }
      }
      if (ok) {
        for (const rect of exclusiveRects) {
          // The band, capped at the foreign set's actual reach.
          //
          // Uncapped — `ownDistance + gap / 2`, the seed field's own form — the
          // rule is wrong for a neck. `ownDistance` is bounded by `padding` in
          // the seed field because nothing further out is ever inside, so the
          // band only ever reserves a thin corridor there. A neck runs hundreds
          // of pixels from any member, so the same expression hands one distant
          // foreign tile an enormous territory and no neck can ever form. That
          // was measured: with members 620 apart, a foreign tile 200px off the
          // axis still blocked the connection outright.
          //
          // What the band protects is the corridor where the two sets' padded
          // areas would otherwise meet, and that is bounded: a foreign tile's
          // own membrane reaches `padding`, and the sets must stay `gap` apart,
          // so nothing beyond `padding + gap` is contested. Capping there keeps
          // the guarantee where it bites and lets necks through elsewhere.
          //
          // The cap is the foreign membrane's own reach plus the separation
          // gap: beyond `padding + gap` from a foreign tile nothing is
          // contested, because the foreign membrane cannot get there.
          //
          // This is the *flesh* test, run per occupied cell. It is not what
          // keeps a neck clear on its own — that is the centreline clearance in
          // `safe`, which reserves `neckRadius + gap` around the foreign seed
          // field before a route is ever chosen. Both exist because they answer
          // different questions: this one bounds where membrane may sit, the
          // other bounds where a spine may run given what thickening will do to
          // it.
          const bandReach = Math.min(ownDistance + gap / 2, padding + gap);
          if (pointRectDistance(point, rect) < bandReach) { ok = false; break; }
        }
      }
      if (ok && reserved) {
        for (const segment of reserved) {
          if (pointSegmentDistance(point, segment.a, segment.b) < segment.radius + gap) { ok = false; break; }
        }
      }
      neckSpaceAllowed[index] = ok ? 1 : 0;
    }
  }

  // Thicken each chosen route into a neck by writing a positive clearance
  // around its cells. The value falls off with distance from the route's spine
  // so the neck's own edge is an interpolatable zero crossing rather than a
  // hard step — a stepped neck would put staircase corners back on the outline
  // at exactly the places the membrane is thinnest.
  for (const route of routes) {
    for (const cell of route.cells) {
      const column = cell % columns;
      const row = (cell - column) / columns;
      for (let dy = -radiusCells; dy <= radiusCells; dy += 1) {
        for (let dx = -radiusCells; dx <= radiusCells; dx += 1) {
          const nextColumn = column + dx;
          const nextRow = row + dy;
          if (nextColumn < 0 || nextRow < 0 || nextColumn >= columns || nextRow >= rows) continue;
          const index = nextRow * columns + nextColumn;
          // World-space distance decides inclusion. `radiusCells` only bounds
          // the square that is scanned; using it as the radius would write the
          // corners of that square, which lie further out than `neckRadius`.
          const distance = Math.hypot(dx * cellSize, dy * cellSize);
          if (distance > neckRadius) continue;
          // A neck may only occupy space the membrane was allowed to reach.
          // Clamping to `safe` was tried and is wrong: `safe` is the *routing*
          // mask, which keeps a whole neck-width clear of foreign tiles, while
          // the seed field's own band lets a member's padding come closer than
          // that. Where a neck passed a foreign tile the two disagreed, the
          // thickening was eroded to nothing, and the set fell into two lobes
          // that then crossed the other set's outline.
          //
          // The band is therefore re-tested per cell, on exactly the terms the
          // seed field uses, so the neck stops where the padding would have and
          // the separation guarantee still holds along it.
          if (!neckSpaceAllowed[index]) continue;
          const value = neckRadius - distance;
          if (value > values[index]) values[index] = value;
        }
      }
    }
  }

  const connectorRoutes = routes.map((route) => route.cells.map((cell) => {
    const column = cell % columns;
    return { x: originX + column * cellSize, y: originY + ((cell - column) / columns) * cellSize };
  }));

  for (let index = 0; index < size; index += 1) field.inside[index] = values[index] >= 0 ? 1 : 0;
  const forbidden = new Uint8Array(size);
  for (let index = 0; index < size; index += 1) forbidden[index] = neckSpaceAllowed[index] ? 0 : 1;
  // Surface tension, before the void fill. A droplet has no concave bites: the
  // tension pulls its boundary taut across any crook tighter than its own
  // curvature, and that is what makes it read as one body rather than as a
  // cluster of joined lumps. The icons sit on that surface rather than shaping
  // it.
  closeConcavities(field, forbidden, surfaceTension);
  fillCosmeticVoids(field, forbidden);

  // Connectivity is read off the membrane that was actually built, not off
  // whether routes were found. A route can be found and its neck still pinched
  // apart where it passes an exclusive set: the separation band applies to the
  // neck's flesh as much as to a member's padding, so the flesh thins to
  // nothing exactly where the other set is nearer. That is the honest outcome —
  // two exclusive sets whose members interleave cannot both be connected
  // without merging — and it must be reported as `connected: false` rather
  // than assumed away by the routing result.
  const built = labelComponents(field.inside, columns, rows);
  connected = built.count <= 1;
  // What later sets must keep clear of. Consecutive route cells, so a corridor
  // is described by the same spine the thickening used.
  // World coordinates, never grid indexes. Each set samples on its own origin
  // and dimensions — legitimately, since bounds follow that set's own members —
  // so a row/column reused across two fields refers to a different place in
  // each. Storing the spine in world space is what makes a reservation mean the
  // same thing to every set that reads it.
  const reservations = [];
  for (const route of connectorRoutes) {
    for (let i = 1; i < route.length; i += 1) {
      reservations.push({ a: route[i - 1], b: route[i], radius: neckRadius });
    }
  }
  return { field, connected, componentCount: count, connectorRoutes, reservations };
}

/** Closes voids that no rule is holding open.
 *
 * Members arranged in a ring, or two members whose padded areas nearly meet,
 * leave gaps the field never filled — not because anything is being kept out,
 * but because the padding happened not to reach. Live those read as slits and
 * cavities punched through the outline, which is the "padded category zone"
 * appearance rather than a container.
 *
 * A void closes only when every cell of it is space this membrane would have
 * been allowed to occupy anyway. One forbidden cell anywhere in the void keeps
 * the whole void open: something real is being held out there, and closing
 * around it would blend two sets.
 *
 * `forbidden` is the complement of the flesh rule (`neckSpaceAllowed`), not of
 * the routing mask. Using the routing mask was a bug worth naming: it reserves
 * a whole neck-width around foreign territory but says nothing about the space
 * beyond that reserve, so a large pocket containing another set's members read
 * as entirely "safe" and got filled — one set's body then swallowed the
 * corridor the other needed, and their outlines crossed. The flesh rule is the
 * right question because it is exactly "may this membrane be here".
 *
 * Voids touching the border are the outside world and are never filled.
 *
 * Filled cells are given a small positive value rather than a large one, so
 * the closed patch still interpolates smoothly into the membrane around it
 * instead of introducing a step the contour would trace as a notch. */
/** Fills the concave bites out of the silhouette, so a set reads as one body.
 *
 * Blending the members smooths the *boundary* but does not make the shape
 * convex: wherever three members sit in an L, the space in the crook stays
 * outside and the outline tucks into it. Those inward bites are what stop a set
 * reading as one potato — the edge is curved, but the silhouette is still a
 * cluster of connected lumps.
 *
 * A morphological closing removes them. Dilating by `radius` swallows every
 * concavity narrower than that, and eroding by the same amount pulls the outer
 * boundary back to where it started — so the extent is unchanged and only the
 * bites are filled. This is done on the scalar field rather than on the
 * occupancy mask so the result is still a smooth field the contour can be
 * interpolated from; a mask-level closing would put stepped edges back.
 *
 * The trade this makes is deliberate and was asked for: a filled crook may
 * contain a non-member, and the boundary now claims that space rather than
 * tucking around it. The shape wins over the other icons' positions. What the
 * closing must never do is claim space belonging to a set this one shares no
 * member with, so `forbidden` clamps it — the separation guarantee is not
 * negotiable, and it is checked on the result by the exclusive sweeps.
 *
 * Both passes use a chamfer distance transform, which is linear in the grid
 * rather than quadratic in the radius. At the radii this needs, a direct
 * disc-shaped pass would dominate the whole build. */
function closeConcavities(field, forbidden, radius) {
  const { values, inside, columns, rows, cellSize } = field;
  if (radius <= 0) return;
  const size = columns * rows;

  // Distance in cells from the region, and from its complement. Two chamfer
  // sweeps each: forward then backward.
  const transform = (seedInside) => {
    const distance = new Float32Array(size);
    const far = columns + rows;
    for (let index = 0; index < size; index += 1) {
      distance[index] = (inside[index] === 1) === seedInside ? 0 : far;
    }
    const orthogonal = 1;
    const diagonal = Math.SQRT2;
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const index = row * columns + column;
        if (distance[index] === 0) continue;
        let best = distance[index];
        if (row > 0) best = Math.min(best, distance[index - columns] + orthogonal);
        if (column > 0) best = Math.min(best, distance[index - 1] + orthogonal);
        if (row > 0 && column > 0) best = Math.min(best, distance[index - columns - 1] + diagonal);
        if (row > 0 && column < columns - 1) best = Math.min(best, distance[index - columns + 1] + diagonal);
        distance[index] = best;
      }
    }
    for (let row = rows - 1; row >= 0; row -= 1) {
      for (let column = columns - 1; column >= 0; column -= 1) {
        const index = row * columns + column;
        if (distance[index] === 0) continue;
        let best = distance[index];
        if (row < rows - 1) best = Math.min(best, distance[index + columns] + orthogonal);
        if (column < columns - 1) best = Math.min(best, distance[index + 1] + orthogonal);
        if (row < rows - 1 && column < columns - 1) best = Math.min(best, distance[index + columns + 1] + diagonal);
        if (row < rows - 1 && column > 0) best = Math.min(best, distance[index + columns - 1] + diagonal);
        distance[index] = best;
      }
    }
    return distance;
  };

  const radiusCells = radius / cellSize;
  // Dilate: everything within `radius` of the region joins it.
  const toRegion = transform(true);
  const dilated = new Uint8Array(size);
  for (let index = 0; index < size; index += 1) {
    dilated[index] = toRegion[index] <= radiusCells ? 1 : 0;
  }

  // Erode: anything within `radius` of the dilated shape's *outside* leaves it
  // again. A concavity narrower than 2*radius was closed over by the dilation
  // and has no outside left nearby, so it survives — which is the whole point.
  const outsideDistance = new Float32Array(size);
  {
    const far = columns + rows;
    for (let index = 0; index < size; index += 1) outsideDistance[index] = dilated[index] ? far : 0;
    const orthogonal = 1;
    const diagonal = Math.SQRT2;
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const index = row * columns + column;
        if (outsideDistance[index] === 0) continue;
        let best = outsideDistance[index];
        if (row > 0) best = Math.min(best, outsideDistance[index - columns] + orthogonal);
        if (column > 0) best = Math.min(best, outsideDistance[index - 1] + orthogonal);
        if (row > 0 && column > 0) best = Math.min(best, outsideDistance[index - columns - 1] + diagonal);
        if (row > 0 && column < columns - 1) best = Math.min(best, outsideDistance[index - columns + 1] + diagonal);
        outsideDistance[index] = best;
      }
    }
    for (let row = rows - 1; row >= 0; row -= 1) {
      for (let column = columns - 1; column >= 0; column -= 1) {
        const index = row * columns + column;
        if (outsideDistance[index] === 0) continue;
        let best = outsideDistance[index];
        if (row < rows - 1) best = Math.min(best, outsideDistance[index + columns] + orthogonal);
        if (column < columns - 1) best = Math.min(best, outsideDistance[index + 1] + orthogonal);
        if (row < rows - 1 && column < columns - 1) best = Math.min(best, outsideDistance[index + columns + 1] + diagonal);
        if (row < rows - 1 && column > 0) best = Math.min(best, outsideDistance[index + columns - 1] + diagonal);
        outsideDistance[index] = best;
      }
    }
  }

  for (let index = 0; index < size; index += 1) {
    if (inside[index]) continue;
    // Closed by the operation, and allowed to be.
    if (outsideDistance[index] <= radiusCells) continue;
    if (forbidden[index]) continue;
    inside[index] = 1;
    // The field value is the true distance to the closed shape's edge, so the
    // interpolated contour runs through the patch as smoothly as it does
    // anywhere else rather than meeting it at a step.
    const depth = (outsideDistance[index] - radiusCells) * cellSize;
    if (depth > values[index]) values[index] = depth;
  }
}

function fillCosmeticVoids(field, forbidden) {
  const { values, inside, columns, rows, cellSize } = field;
  const size = columns * rows;
  const seen = new Uint8Array(size);
  const queue = new Int32Array(size);

  for (let start = 0; start < size; start += 1) {
    if (inside[start] || seen[start]) continue;
    const startColumn = start % columns;
    const startRow = (start - startColumn) / columns;
    let head = 0;
    let tail = 0;
    const cells = [];
    let touchesBorder = startColumn === 0 || startRow === 0
      || startColumn === columns - 1 || startRow === rows - 1;
    let protectedVoid = forbidden[start] === 1;
    seen[start] = 1;
    queue[tail += 1] = start;
    while (head < tail) {
      const index = queue[head += 1];
      cells.push(index);
      const column = index % columns;
      const row = (index - column) / columns;
      if (column === 0 || row === 0 || column === columns - 1 || row === rows - 1) touchesBorder = true;
      if (forbidden[index]) protectedVoid = true;
      const neighbours = [
        column > 0 ? index - 1 : -1,
        column < columns - 1 ? index + 1 : -1,
        row > 0 ? index - columns : -1,
        row < rows - 1 ? index + columns : -1,
      ];
      for (const neighbour of neighbours) {
        if (neighbour < 0 || inside[neighbour] || seen[neighbour]) continue;
        seen[neighbour] = 1;
        queue[tail += 1] = neighbour;
      }
    }
    if (touchesBorder || protectedVoid) continue;
    for (const index of cells) {
      inside[index] = 1;
      // Just inside the membrane: enough to be filled, small enough that the
      // interpolated contour runs smoothly through the patched area.
      if (values[index] < cellSize / 2) values[index] = cellSize / 2;
    }
  }
}

/** Where along an edge the field crosses zero.
 *
 * The endpoint values say how far each corner is from the boundary, so the
 * crossing is a linear interpolation between them rather than the edge's
 * midpoint. Using the midpoint quantizes every contour vertex to a half-cell,
 * which is the direct cause of staircase outlines — a boundary at a shallow
 * angle to the grid comes out as a flight of steps however fine the sampling. */
export function interpolateIsoPoint(p1, p2, v1, v2, iso = 0) {
  const denominator = v2 - v1;
  const t = Math.abs(denominator) < 1e-9
    ? 0.5
    : Math.max(0, Math.min(1, (iso - v1) / denominator));
  return {
    x: p1.x + (p2.x - p1.x) * t,
    y: p1.y + (p2.y - p1.y) * t,
  };
}

/** Traces the boundary of the occupied cells as closed polygons.
 *
 * Segments are emitted per cell and then chained head-to-tail. A normal set
 * yields one outer ring; further rings are interior holes, which only appear
 * where a hard obstacle or an exclusive set genuinely keeps the membrane out.
 *
 * Each crossing is interpolated from the scalar field rather than placed at the
 * midpoint of the grid edge. That is what makes the outline follow the shape
 * instead of the grid — and it only pays off because the field itself is smooth
 * (see `regionFieldValue`). Interpolating a field built from hard-min'd sharp
 * rectangles would trace a tidy line around a fundamentally boxy shape. */
export function extractContours(field) {
  const { inside, values, columns, rows, originX, originY, cellSize } = field;
  const at = (column, row) => (column < 0 || row < 0 || column >= columns || row >= rows
    ? 0
    : inside[row * columns + column]);
  // Outside the grid the field is unknown; the border is empty by construction,
  // so treating it as one cell's worth of "outside" keeps the interpolation
  // continuous with the occupancy test above.
  const valueAt = (column, row) => (column < 0 || row < 0 || column >= columns || row >= rows
    ? -cellSize
    : (values ? values[row * columns + column] : (inside[row * columns + column] ? 1 : -1)));

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

      const corners = [
        { point: { x, y }, value: valueAt(column, row) },
        { point: { x: x + cellSize, y }, value: valueAt(column + 1, row) },
        { point: { x: x + cellSize, y: y + cellSize }, value: valueAt(column + 1, row + 1) },
        { point: { x, y: y + cellSize }, value: valueAt(column, row + 1) },
      ];
      // Edge n runs between corner n and corner n+1: 0=top, 1=right, 2=bottom,
      // 3=left, which is the ordering the marching table is written against.
      const crossing = (edge) => {
        const a = corners[edge];
        const b = corners[(edge + 1) % 4];
        return interpolateIsoPoint(a.point, b.point, a.value, b.value);
      };
      for (const [from, to] of edges) segments.push([crossing(from), crossing(to)]);
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
    // A chain that does not return to where it started is not a ring. It means
    // the contour ran off the edge of the grid, which happens when the field
    // bounds are too small to contain their own boundary — a neck displaced by
    // another set's reservation was what first caused it here.
    //
    // Such a chain must never be returned as a polygon. Both halves of a split
    // boundary wind the same way, so even-odd counting cancels the area between
    // them and the region reads as a hole where it is solid: 1662 cells of one
    // set vanished that way, and it presented as that set overlapping another.
    // Dropping the chain would hide the same bug more quietly, so this is loud.
    const closed = key(ring[0]) === key(ring[ring.length - 1]);
    if (!closed) {
      throw new Error(
        'set-region-model: contour did not close — the sampled field is not '
        + `bounded by empty space (open chain ended at ${ring[ring.length - 1].x}, `
        + `${ring[ring.length - 1].y})`,
      );
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
 * Ordinary non-members are **not** obstacles. They used to be, and every one
 * that drifted near a set punched a permanent hole or channel through it, so
 * the outline read as padded category zones rather than as a container. The
 * membrane constrains them instead (set-constraint-model.js). Members of sets
 * this one shares nothing with still carve, through the separation band, so
 * two exclusive sets can never blend.
 *
 * Each region carries its topology and a verdict:
 *
 *   { valid, connected, componentCount, polygons, svgPath, connectorRoutes,
 *     failureReason, attemptedBounds }
 *
 * `valid` is true only when the geometry that came out satisfies all three
 * invariants: the field was closed, the contour extracted into one connected
 * filled component, and the region is positively separated from every set it
 * shares no member with. It is checked on the polygons rather than on the
 * intent behind them — the defect that motivated this contract had a correct
 * field and inverted polygons, and only a check on the output could tell.
 *
 * An invalid region carries empty `polygons` and an empty `svgPath`, so a
 * failed build can never be hit-tested, clicked, or dropped into. Callers may
 * read `failureReason` — 'field-bounds-exhausted', 'disconnected' or
 * 'exclusive-overlap' — and repair or reject the layout that caused it. */
export function buildSetRegions({
  sets,
  visibleItems,
  membersOf,
  padding = 26,
  gap = 14,
  cellSize = 4,
  neckRadius,
  // How widely adjacent members blend into one another, and how far each
  // member's own corners are rounded off. Together these decide whether the
  // outline reads as a union of padded boxes or as one grown body; zero for
  // both reproduces the old boxy shape exactly.
  //
  // The defaults are measured, not guessed, because the middle of the range is
  // worse than either end. Sweeping blend against the sharpest corner in the
  // outline for two members 160px apart:
  //
  //     blend    0   20   34   50   70  100
  //     maxTurn 56   59   74   24   15   15  degrees
  //
  // A partial blend half-closes the waist between two members and the contour
  // pinches through the remaining gap, which is a sharper corner than the notch
  // it replaced. Past closure the waist fills and the corner collapses. 100
  // with a 22 corner radius gives 15 degrees worst-case and 5 at the 95th
  // percentile, against 56 and 9 for the unblended shape.
  blend = 100,
  cornerRadius = 22,
  // How taut the surface is: the radius of the crook a droplet's own tension
  // would pull flat. Off by default, and the reason is worth recording.
  //
  // A morphological closing does fill the concave bites — solidity against the
  // convex hull went 0.68 to 0.86 on a three-member L, and the isolated
  // algorithm is correct. But the chamfer transform it runs on is grid-aligned,
  // so at the radii that actually change the silhouette the closing bridges
  // lobes differently depending on where the layout happens to fall on the
  // sampling grid. Translating a scene by (13.7, -29.2) moved one region's
  // centroid by +38 in y where it should have moved -29, with the area
  // unchanged to within 0.4% — the shape was not wobbling, its topology was
  // flipping.
  //
  // And the failure is erratic rather than a threshold: 60 and 120 survive the
  // translation check while 90 and 150 break it, so no value is safe on an
  // arbitrary layout. A set whose outline changes discontinuously when the
  // graph drifts a pixel is worse than one that is merely lumpy, so this stays
  // off until the closing is done in a grid-independent way.
  surfaceTension = 0,
  initialExtraMargin,
  marginGrowthStep,
  maxMarginGrowthAttempts,
} = {}) {
  const regions = new Map();
  const items = Array.isArray(visibleItems) ? visibleItems : [];
  const list = Array.isArray(sets) ? sets : [];
  const coverage = new Map(
    list.map((set) => [set.id, new Set(membersOf ? membersOf(set) : (set.memberIds ?? []))]),
  );

  // Sets are built in a fixed order — by id, not by however the caller happened
  // to list them — because each one's necks become corridors the later ones
  // must avoid. Without a stable order the same layout could produce different
  // geometry between renders, and the drag rules read this geometry.
  const ordered = [...list].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  // Every corridor committed so far, per set, so a set is never made to avoid
  // its own necks or those of a set it overlaps with by sharing a member.
  const committed = new Map();
  // Which sets each one shares no member with, kept so the validity check can
  // measure separation against exactly those and not against a set it is meant
  // to overlap.
  const exclusiveOf = new Map();

  for (const set of ordered) {
    const memberIds = coverage.get(set.id);
    const memberRects = items.filter((item) => memberIds.has(item.id));
    if (memberRects.length === 0) continue;

    // Only sets sharing no member get a separation band. Sets that DO share
    // one are meant to overlap — that overlap is the Venn, and walling them
    // apart would destroy the thing the feature exists to show.
    const exclusiveIds = new Set();
    const exclusiveSetIds = new Set();
    const reserved = [];
    for (const other of list) {
      if (other.id === set.id) continue;
      const otherMembers = coverage.get(other.id);
      const shares = [...memberIds].some((id) => otherMembers.has(id));
      if (shares) continue;
      exclusiveSetIds.add(other.id);
      for (const id of otherMembers) exclusiveIds.add(id);
      reserved.push(...(committed.get(other.id) ?? []));
    }
    exclusiveOf.set(set.id, exclusiveSetIds);
    const exclusiveRects = items.filter((item) => exclusiveIds.has(item.id));

    const membrane = buildMembraneField({
      memberRects,
      obstacleRects: [],
      exclusiveRects,
      reserved: reserved.length > 0 ? reserved : null,
      padding,
      gap,
      cellSize,
      blend,
      cornerRadius,
      surfaceTension,
      ...(neckRadius == null ? {} : { neckRadius }),
      ...(initialExtraMargin == null ? {} : { initialExtraMargin }),
      ...(marginGrowthStep == null ? {} : { marginGrowthStep }),
      ...(maxMarginGrowthAttempts == null ? {} : { maxMarginGrowthAttempts }),
    });
    committed.set(set.id, membrane.reservations);

    // A build that failed its own preconditions never becomes a usable region.
    // Returning empty polygons alongside the reason keeps the failure legible
    // to a caller without letting it be hit-tested, clicked or dropped into.
    if (!membrane.valid) {
      regions.set(set.id, {
        polygons: [],
        svgPath: '',
        valid: false,
        connected: false,
        componentCount: membrane.componentCount,
        connectorRoutes: [],
        failureReason: membrane.failureReason,
        attemptedBounds: membrane.attemptedBounds,
      });
      continue;
    }

    const polygons = extractContours(membrane.field);
    if (polygons.length === 0) continue;
    const region = {
      polygons,
      svgPath: ringsToPath(polygons),
      componentCount: membrane.componentCount,
      connected: membrane.connected,
      connectorRoutes: membrane.connectorRoutes,
      attemptedBounds: membrane.attemptedBounds,
    };

    // Validity is the whole contract, checked on the geometry that was actually
    // produced rather than on the intent that produced it. One connected filled
    // component, and positive separation from every exclusive region built so
    // far — measured segment-to-segment, because two polygons can cross without
    // sharing a vertex and a vertex measure reports a comfortable number for it.
    //
    // The separation half is what would have caught the inverted-region defect
    // at its source: the field was correct, the polygons were not, and only a
    // check on the polygons could tell the difference.
    let separated = true;
    let blockedBy = null;
    for (const [otherId, other] of regions) {
      if (!other.valid || !exclusiveOf.get(set.id)?.has(otherId)) continue;
      if (regionDistance(region, other) > 0) continue;
      separated = false;
      blockedBy = otherId;
      break;
    }
    region.valid = separated && region.connected && filledComponents(polygons) === 1;
    region.failureReason = region.valid
      ? null
      : (!separated ? 'exclusive-overlap' : 'disconnected');
    if (!separated) region.blockedBySetIds = [blockedBy];
    regions.set(set.id, region);
  }
  return regions;
}

/** How many separate filled pieces a set of rings describes.
 *
 * Ring count is not the answer: a set with a hole in it has two rings and one
 * filled piece. A ring bounds filled space only when it lies inside an even
 * number of the others, which is the same even-odd rule the region renders and
 * hit-tests with. */
function filledComponents(rings) {
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

import {
  decomposeRegions,
  intersectConvex,
  normalizePolygon,
  signedArea,
} from './set-region-model.js';

const EPSILON = 1e-7;

/** How many sets may sit in one *overlapping* component before its exact Venn
 * decomposition is abandoned for the layered fallback. This is not a limit on
 * how many sets a workspace may hold — disjoint sets never share a component,
 * so a hundred separated sets are a hundred components of one.
 *
 * Exact decomposition still enumerates 2**n masks inside a component, measured
 * on 48-vertex outlines at 9ms for four, 24ms for six and 68ms for eight. Six
 * is the largest that fits a frame with room to spare. Checkpoint 3 replaces
 * this count with a measured work budget; until then it must stay at or below
 * decomposeRegions' own internal guard of 10. */
export const DEFAULT_MAX_COMPONENT_SETS = 6;

function boundsOf(outline) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { x, y } of outline) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

function boundsOverlap(a, b) {
  return a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
}

/** Bounding boxes are only the broad phase. Two outlines lying diagonally to
 * each other have intersecting boxes and no common area, and must not be joined
 * into one component — so the pair is confirmed with a real convex clip. */
function overlaps(first, second) {
  if (!boundsOverlap(first.bounds, second.bounds)) return false;
  const lens = intersectConvex(first.outline, second.outline);
  return lens.length >= 3 && Math.abs(signedArea(lens)) > EPSILON;
}

/** Sweeps on x so separated sets never pay for each other: once a candidate
 * starts to the right of where the current set ends, neither it nor anything
 * after it can touch. */
export function overlapPairs(sets) {
  const order = sets.map((_, index) => index)
    .sort((a, b) => sets[a].bounds.minX - sets[b].bounds.minX);
  const pairs = [];
  for (let i = 0; i < order.length; i += 1) {
    const current = sets[order[i]];
    for (let j = i + 1; j < order.length; j += 1) {
      const candidate = sets[order[j]];
      if (candidate.bounds.minX > current.bounds.maxX) break;
      if (overlaps(current, candidate)) pairs.push([order[i], order[j]]);
    }
  }
  return pairs;
}

/** Overlap is transitive for grouping: A-B and B-C put A and C in one component
 * even where A and C never touch, because C's boundary still cuts cells that A
 * helped create. */
export function connectedComponents(count, pairs) {
  const parent = Array.from({ length: count }, (_, index) => index);
  const find = (index) => {
    let root = index;
    while (parent[root] !== root) {
      parent[root] = parent[parent[root]];
      root = parent[root];
    }
    return root;
  };
  for (const [a, b] of pairs) {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[rootA] = rootB;
  }
  const grouped = new Map();
  for (let index = 0; index < count; index += 1) {
    const root = find(index);
    if (!grouped.has(root)) grouped.set(root, []);
    grouped.get(root).push(index);
  }
  return [...grouped.values()];
}

const singleSetRegion = (set) => ({
  id: set.id,
  setIds: [set.id],
  polygons: [set.outline],
});

/** Cache keys compare at the precision the renderer actually draws — regionPath
 * emits two decimals — so sub-pixel physics jitter does not rebuild geometry.
 * The polygons handed to decomposition stay full precision. */
const geometryKeyFor = (members) => members
  .map((set) => `${set.id}:${set.outline.map(({ x, y }) => `${x.toFixed(2)},${y.toFixed(2)}`).join('|')}`)
  .join(';');

/** Turns live set outlines into the flat region list the renderer already
 * consumes, computing exact Venn geometry only where sets genuinely overlap and
 * caching each overlap component separately, so a set moving in one cluster
 * leaves every other cluster's region objects untouched. */
export function createRegionLayout({
  maxComponentSets = DEFAULT_MAX_COMPONENT_SETS,
  decompose = decomposeRegions,
} = {}) {
  const cache = new Map();
  const componentLimit = Math.min(maxComponentSets, 10);

  function regionsFor(members) {
    // A lone set is its own region: no masks, no clipping, no decomposition.
    // This is what keeps a workspace of separated sets linear.
    if (members.length === 1) return [singleSetRegion(members[0])];
    // Too dense to decompose affordably. Fall back to one translucent body per
    // set rather than returning nothing — the eleventh set used to make every
    // region vanish. These ids match what the same sets produce when they are
    // apart, so hues and effect ownership survive the transition both ways.
    if (members.length > componentLimit) return members.map(singleSetRegion);
    return decompose(members.map(({ id, outline }) => ({ id, outline })));
  }

  return {
    update(inputSets) {
      const sets = (inputSets ?? [])
        .map((set) => ({ id: String(set.id), outline: normalizePolygon(set.outline) }))
        .filter((set) => set.outline.length >= 3)
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((set) => ({ ...set, bounds: boundsOf(set.outline) }));
      if (sets.length === 0) {
        cache.clear();
        return [];
      }

      const components = connectedComponents(sets.length, overlapPairs(sets));
      const live = new Set();
      const regions = [];
      for (const indices of components) {
        const members = indices
          .map((index) => sets[index])
          .sort((a, b) => a.id.localeCompare(b.id));
        const componentId = members.map((set) => set.id).join('|');
        const geometryKey = geometryKeyFor(members);
        live.add(componentId);
        const cached = cache.get(componentId);
        if (cached && cached.geometryKey === geometryKey) {
          regions.push(...cached.regions);
          continue;
        }
        const produced = regionsFor(members);
        cache.set(componentId, { geometryKey, regions: produced });
        regions.push(...produced);
      }
      for (const componentId of [...cache.keys()]) {
        if (!live.has(componentId)) cache.delete(componentId);
      }
      return regions.sort((a, b) => a.id.localeCompare(b.id));
    },
    /** Test and diagnostic seam: how many components are currently cached. */
    componentCount() {
      return cache.size;
    },
  };
}

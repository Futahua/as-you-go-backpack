import { itemsIn, binnedItems, itemsInBinnedGroup, ROOT_ID } from './workspace-model-20260730b.js';

/** A shortcut's identity for graph purposes is its shared shortcut record
 * (`shortcutId`), not any one placement — a linked shortcut visible from
 * several currently-expanded folders at once must collapse to one node.
 * Groups have no such sharing, so a group's own id is its identity. */
function identityOf(candidate) {
  return candidate.kind === 'shortcut' ? candidate.shortcutId : candidate.id;
}

/** Walks the Bin from binCurrentId ('bin' for the top-level list, or a
 * binned folder's id after drilling into it — see the renderer's
 * dedicated Bin breadcrumb/navigation). Every item at that level is a
 * root (depth 0), and expanding a nested folder reveals its still-intact
 * contents beneath it in place — those were never independently binned,
 * just hidden by their binned ancestor, so they're each their own
 * restorable/deletable tile. Unlike the normal graph there's no
 * shared-identity dedup: two placements of the same linked shortcut
 * binned separately are two independent tiles. */
function collectVisibleBin(state, expanded, binCurrentId = 'bin') {
  const result = [];

  function walkBinnedGroup(groupId, depth) {
    const children = itemsInBinnedGroup(state, groupId);
    children.forEach((child, siblingIndex) => {
      result.push({
        id: child.id,
        parentId: groupId,
        kind: child.kind,
        depth,
        siblingIndex,
        siblingCount: children.length,
      });
      if (child.kind === 'group' && expanded.has(child.id)) {
        walkBinnedGroup(child.id, depth + 1);
      }
    });
  }

  const roots = binCurrentId === 'bin' ? binnedItems(state) : itemsInBinnedGroup(state, binCurrentId);
  roots.forEach((candidate, siblingIndex) => {
    result.push({
      id: candidate.id,
      parentId: 'bin',
      kind: candidate.kind,
      depth: 0,
      siblingIndex,
      siblingCount: roots.length,
      // The folder this item was actually inside when it was sent to the
      // Bin (not its Bin-graph parent, which is always 'bin' at this
      // depth) — lets the renderer draw a "where did this come from" edge.
      // Only set for a linked shortcut (more than one active placement) —
      // that's the only case where binning produces several
      // identical-looking tiles with no way to tell which placement came
      // from where. An ordinary single-placement item's origin is obvious
      // (there's only one), so it doesn't need a ghost/edge cluttering the
      // Bin. Only meaningful at the true top level (drilled-in roots
      // already show their real parent via the breadcrumb, not an edge).
      originParentId: binCurrentId === 'bin' && candidate.kind === 'shortcut' && candidate.wasLinked
        ? (candidate.bin?.parentId ?? null)
        : null,
    });
    if (candidate.kind === 'group' && expanded.has(candidate.id)) {
      walkBinnedGroup(candidate.id, 1);
    }
  });

  return result;
}

export function visibleGraphItems(state, parentId, expandedSet, binMode = false, binCurrentId = 'bin') {
  if (binMode) return collectVisibleBin(state, expandedSet, binCurrentId);
  return collectVisible(state, parentId, expandedSet);
}

/** Walks every currently-visible folder (the current one, plus every
 * expanded folder reachable from it) and emits one entry per distinct
 * identity, recording every parent it was actually found under so
 * graphEdges can draw an edge from each of them. A shortcut linked into two
 * expanded folders therefore appears once, with two parents recorded. */
function collectVisible(state, parentId, expanded) {
  const byIdentity = new Map();
  const visitedFolders = new Set();

  function walk(folderId, depth) {
    if (visitedFolders.has(folderId)) return;
    visitedFolders.add(folderId);
    const children = itemsIn(state, folderId);
    children.forEach((child, siblingIndex) => {
      const identity = identityOf(child);
      let entry = byIdentity.get(identity);
      if (!entry) {
        entry = {
          id: identity,
          kind: child.kind,
          depth,
          siblingIndex,
          siblingCount: children.length,
          parents: [],
        };
        byIdentity.set(identity, entry);
      }
      entry.parents.push(folderId);
      const isOpen = child.kind === 'group' && expanded.has(child.id);
      if (isOpen) walk(child.id, depth + 1);
    });
  }
  walk(parentId, 0);

  return [...byIdentity.values()].map(({ parents, ...entry }) => ({
    ...entry,
    parentId: parents[0],
    parentIds: parents,
  }));
}

export function graphEdges(items) {
  const ids = new Set(items.map((i) => i.id));
  const edges = [];
  const seenKeys = new Set();
  for (const item of items) {
    const parentIds = item.parentIds ?? [item.parentId];
    for (const parentId of parentIds) {
      if (parentId === ROOT_ID || parentId === 'bin' || !ids.has(parentId)) continue;
      const key = `${parentId}->${item.id}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      edges.push({ id: key, source: parentId, target: item.id });
    }
  }
  return edges;
}

/** For each top-level binned item, an edge back to the folder it was
 * actually inside when binned — separate from graphEdges() (which only
 * connects a Bin-graph node to its Bin-graph parent, always 'bin' at the
 * root) because a shortcut linked into several folders and binned all at
 * once otherwise produces several identical-looking tiles with no way to
 * tell which placement came from where. Rendered as a distinct (red)
 * edge kind by the caller. Targets a ghost node id
 * ('bin-origin:<folderId>') when the origin folder itself isn't visible
 * in the current Bin walk (the common case — it's still a normal, active
 * folder outside the Bin). */
export function binOriginEdges(items) {
  const ids = new Set(items.map((i) => i.id));
  const edges = [];
  const seenKeys = new Set();
  for (const item of items) {
    if (item.depth !== 0 || !item.originParentId) continue;
    const realTarget = ids.has(item.originParentId) ? item.originParentId : null;
    const source = realTarget ?? `bin-origin:${item.originParentId}`;
    const key = `${source}->${item.id}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    edges.push({ id: key, source, target: item.id, ghost: !realTarget, ghostGroupId: item.originParentId });
  }
  return edges;
}

const RADIUS = 28;
const SPACING = (2 * Math.PI) / 40;

export function seedPosition(itemId, parent, index, count, originX = 0, originY = 0) {
  if (!parent) {
    const total = Math.max(count, 1);
    const angle = (2 * Math.PI * index) / total;
    const ringRadius = RADIUS * 2.4 * Math.max(1, total / 4);
    return {
      x: Math.cos(angle) * ringRadius + originX,
      y: Math.sin(angle) * ringRadius + originY,
    };
  }
  const golden = 2.39996;
  const a = golden * (index + 1);
  const r = RADIUS * 0.26 * Math.sqrt(index + 1);
  return {
    x: parent.x + Math.cos(a) * r,
    y: parent.y + Math.sin(a) * r,
  };
}

export function hashString(value) {
  let h = 5381;
  for (let i = 0; i < value.length; i += 1) {
    h = ((h << 5) + h) ^ value.charCodeAt(i);
  }
  return h >>> 0;
}

export function allFinite(nodes) {
  return nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y));
}

export function allUniquePositions(nodes) {
  const keys = new Set(nodes.map((n) => `${n.x}|${n.y}`));
  return keys.size === nodes.length;
}

/** A folder is "near" another when they are within this many canvas pixels. */
const FOLDER_DISTANCE = 220;

/** Hard minimum hue separation in degrees for nearby folders (8 slots at 45°).
 * 45° is a perceptual, not just numeric, step apart on the color wheel. */
export const MIN_HUE_SEPARATION = 45;

/** Bounded fraction each hue moves toward its position base per call. */
const BASE_MOVE = 0.15;

/** Projection treats separations within this of MIN_HUE_SEPARATION as done. */
const PROJECTION_EPSILON = 1e-6;

/** Max projection passes over the near-pair list per call. */
const MAX_PROJECTION_PASSES = 20;

/** A folder this far from the canvas center gets the full radius hue shift. */
const RADIUS_SPAN = 500;

/** Degrees of hue added to the base at the radius span. */
const RADIUS_WEIGHT = 120;

/** Angular distance between two hues on the 0..360 circle, in degrees. */
export function hueDistance(a, b) {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}

function wrapDeg(degrees) {
  return ((degrees % 360) + 360) % 360;
}

/** Shortest signed angle from `from` to `to`, in (-180, 180]. */
function signedAngle(from, to) {
  const d = wrapDeg(to - from);
  return d > 180 ? d - 360 : d;
}

/** Position-derived base hue: the angle around `center` plus a radius term, so
 * any drag direction changes the base. */
function positionBase(x, y, center) {
  const angle = wrapDeg((Math.atan2(y - center.cy, x - center.cx) * 180) / Math.PI);
  const radius = Math.hypot(x - center.cx, y - center.cy);
  return wrapDeg(angle + (radius / RADIUS_SPAN) * RADIUS_WEIGHT);
}

/** Deterministic hue-space direction for a pair whose hues are identical:
 * derives from relative canvas position, falling back to ID order. */
function tieBreakDirection(a, b) {
  const dy = b.y - a.y;
  if (Math.abs(dy) > PROJECTION_EPSILON) return Math.sign(dy);
  const dx = b.x - a.x;
  if (Math.abs(dx) > PROJECTION_EPSILON) return Math.sign(dx);
  return a.id < b.id ? 1 : -1;
}

/** Connected components of the near-pair graph that contain a violated pair,
 * as arrays of folder ids. A component is maximal, so recoloring it cannot
 * disturb folders outside it (there are no near pairs across components). */
function componentsNearViolations(nearPairs, violatedIds) {
  const adjacency = new Map();
  for (const [a, b] of nearPairs) {
    if (!adjacency.has(a.id)) adjacency.set(a.id, []);
    if (!adjacency.has(b.id)) adjacency.set(b.id, []);
    adjacency.get(a.id).push(b.id);
    adjacency.get(b.id).push(a.id);
  }
  const seen = new Set();
  const components = [];
  for (const startId of violatedIds) {
    if (seen.has(startId)) continue;
    const stack = [startId];
    const component = [];
    seen.add(startId);
    while (stack.length > 0) {
      const id = stack.pop();
      component.push(id);
      for (const neighbor of adjacency.get(id) ?? []) {
        if (!seen.has(neighbor)) {
          seen.add(neighbor);
          stack.push(neighbor);
        }
      }
    }
    components.push(component);
  }
  return components;
}

/** Greedy slot coloring (largest-degree first, ID tie-break). Returns a
 * Map(id -> slot) or null when k colors are not enough in this order. */
function greedySlotColoring(nodes, adjacency, k) {
  const order = [...nodes].sort((a, b) => {
    const degreeA = adjacency.get(a.id)?.length ?? 0;
    const degreeB = adjacency.get(b.id)?.length ?? 0;
    if (degreeA !== degreeB) return degreeB - degreeA;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const slots = new Map();
  for (const node of order) {
    const used = new Set();
    for (const other of order) {
      if (other === node || !slots.has(other.id)) continue;
      if (adjacency.get(node.id)?.includes(other.id)) used.add(slots.get(other.id));
    }
    let chosen = -1;
    for (let slot = 0; slot < k; slot += 1) {
      if (!used.has(slot)) { chosen = slot; break; }
    }
    if (chosen === -1) return null;
    slots.set(node.id, chosen);
  }
  return slots;
}

/** Deterministic fallback for an infeasible dense neighborhood: color the
 * component with the fewest slots that work (largest-first greedy) and pick
 * the slot rotation that best matches the folders' position bases, so the
 * effective minimum separation is 360 / slotCount rather than oscillating. */
function slotColorComponent(componentIds, folderById, colors, center) {
  const ids = [...componentIds].sort();
  const nodes = ids.map((id) => folderById.get(id));
  const adjacency = new Map(ids.map((id) => [id, []]));
  for (const [a, b] of [...ids.map((id, i) => ids.slice(i + 1).map((other) => [id, other]))].flat()) {
    const fa = folderById.get(a);
    const fb = folderById.get(b);
    if (Math.hypot(fa.x - fb.x, fa.y - fb.y) < FOLDER_DISTANCE) {
      adjacency.get(a).push(b);
      adjacency.get(b).push(a);
    }
  }
  let slotCount = 1;
  let slots = null;
  for (; slotCount <= ids.length; slotCount += 1) {
    slots = greedySlotColoring(nodes, adjacency, slotCount);
    if (slots) break;
  }
  const gap = 360 / slotCount;
  let bestRotation = 0;
  let bestCost = Infinity;
  for (const candidate of ids) {
    const rotation = wrapDeg(
      positionBase(folderById.get(candidate).x, folderById.get(candidate).y, center)
      - slots.get(candidate) * gap,
    );
    let cost = 0;
    for (const id of ids) {
      const hue = wrapDeg(rotation + slots.get(id) * gap);
      const base = positionBase(folderById.get(id).x, folderById.get(id).y, center);
      cost += Math.abs(signedAngle(base, hue));
    }
    if (cost < bestCost) {
      bestCost = cost;
      bestRotation = rotation;
    }
  }
  for (const id of ids) {
    colors.set(id, wrapDeg(bestRotation + slots.get(id) * gap));
  }
}

/**
 * Re-derives every folder's hue from its current absolute position on the
 * canvas as a warm-started constraint solver, so colors are never static:
 * position is an objective, minimum separation is a constraint. Each call
 * moves every hue a bounded amount toward its position base (angle around
 * `center` plus a radius term, so any drag direction re-colors it), then
 * projects every pair within FOLDER_DISTANCE apart until no pair is closer
 * than MIN_HUE_SEPARATION. Pair traversal alternates forward/reverse between
 * passes to reduce solver-order bias; ties use a deterministic direction.
 * Hues stay floating-point (CSS hsl() accepts fractional degrees). When a
 * dense neighborhood cannot keep MIN_HUE_SEPARATION (its proximity graph needs
 * more than eight colors), the affected component is re-colored with the fewest
 * slots that work, for an effective minimum separation of 360 / slotCount.
 *
 * `folders` is an array of { id, x, y }; `colors` is the id -> hue map that is
 * mutated in place (it carries the warm-start state between calls).
 */
export function assignSpatialFolderHues(folders, colors, center) {
  const list = [...folders].sort((a, b) => a.id.localeCompare(b.id));
  const folderById = new Map(list.map((folder) => [folder.id, folder]));
  const nearPairs = [];
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const a = list[i];
      const b = list[j];
      if (Math.hypot(a.x - b.x, a.y - b.y) < FOLDER_DISTANCE) nearPairs.push([a, b]);
    }
  }

  // Warm start missing hues, then move every hue a bounded amount toward its
  // position-derived base so isolated folders track their canvas position.
  for (const folder of list) {
    const base = positionBase(folder.x, folder.y, center);
    const current = colors.get(folder.id);
    if (typeof current !== 'number') {
      colors.set(folder.id, base);
      continue;
    }
    colors.set(folder.id, wrapDeg(current + signedAngle(current, base) * BASE_MOVE));
  }

  // Hard projection: fully resolve every violating pair (never damped).
  for (let pass = 0; pass < MAX_PROJECTION_PASSES; pass += 1) {
    let violated = false;
    const order = pass % 2 === 0 ? nearPairs : [...nearPairs].reverse();
    for (const [a, b] of order) {
      const hueA = colors.get(a.id);
      const hueB = colors.get(b.id);
      if (typeof hueA !== 'number' || typeof hueB !== 'number') continue;
      const delta = signedAngle(hueA, hueB);
      const separation = Math.abs(delta);
      if (separation < MIN_HUE_SEPARATION) {
        const direction = separation > PROJECTION_EPSILON ? Math.sign(delta) : tieBreakDirection(a, b);
        const correction = (MIN_HUE_SEPARATION - separation) / 2;
        colors.set(a.id, wrapDeg(hueA - direction * correction));
        colors.set(b.id, wrapDeg(hueB + direction * correction));
        violated = true;
      }
    }
    if (!violated) break;
  }

  // Infeasible dense neighborhoods: deterministically slot-color the maximal
  // components that still violate the MIN_HUE_SEPARATION invariant.
  const violatedIds = new Set();
  for (const [a, b] of nearPairs) {
    const hueA = colors.get(a.id);
    const hueB = colors.get(b.id);
    if (typeof hueA === 'number' && typeof hueB === 'number'
      && Math.abs(signedAngle(hueA, hueB)) < MIN_HUE_SEPARATION - PROJECTION_EPSILON) {
      violatedIds.add(a.id);
      violatedIds.add(b.id);
    }
  }
  if (violatedIds.size > 0) {
    for (const component of componentsNearViolations(nearPairs, [...violatedIds])) {
      slotColorComponent(component, folderById, colors, center);
    }
  }

  return colors;
}
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

/** Hues closer than this to a near folder keep getting pushed apart. */
const MIN_HUE_SEPARATION = 30;

/** Repulsion step size per pass; < 1 keeps the relaxation stable. */
const REPULSION_STEP = 0.35;

/** How hard a hue is pulled toward its position-derived base each pass. */
const BASE_PULL = 0.06;

/** Relaxation passes per call. Positions only change a little per frame, so a
 * handful of passes per rendered frame keeps colors converged during drags. */
const RELAXATION_PASSES = 8;

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

/**
 * Continuously re-derives every folder's hue from its current absolute
 * position on the canvas, so colors are never static: a folder's hue relaxes
 * toward a position base (the angle of its position around `center` plus a
 * radius term, so any drag direction re-colors it) while any folder within
 * FOLDER_DISTANCE pushes it away, harder the closer they are. Dragging a
 * folder therefore re-colors it and its near neighbors as their relative
 * distances change, and near folders never collapse onto the same hue.
 *
 * `folders` is an array of { id, x, y }; `colors` is the id -> hue map that is
 * mutated in place (it carries the relaxation state between calls).
 */
export function assignSpatialFolderHues(folders, colors, center) {
  const positionBase = (x, y) => {
    const angle = wrapDeg((Math.atan2(y - center.cy, x - center.cx) * 180) / Math.PI);
    const radius = Math.hypot(x - center.cx, y - center.cy);
    return wrapDeg(angle + (radius / RADIUS_SPAN) * RADIUS_WEIGHT);
  };
  const list = [...folders].sort((a, b) => a.id.localeCompare(b.id));

  for (const folder of list) {
    if (typeof colors.get(folder.id) !== 'number') {
      colors.set(folder.id, positionBase(folder.x, folder.y));
    }
  }

  for (let pass = 0; pass < RELAXATION_PASSES; pass += 1) {
    for (const folder of list) {
      const hue = colors.get(folder.id);
      let adjustment = 0;
      for (const other of list) {
        if (other.id === folder.id) continue;
        const dist = Math.hypot(other.x - folder.x, other.y - folder.y);
        if (dist >= FOLDER_DISTANCE) continue;
        const otherHue = colors.get(other.id);
        if (typeof otherHue !== 'number') continue;
        const separation = Math.abs(signedAngle(hue, otherHue));
        const needed = MIN_HUE_SEPARATION - separation;
        if (needed <= 0) continue;
        const closeness = 1 - dist / FOLDER_DISTANCE;
        adjustment += -Math.sign(signedAngle(hue, otherHue) || 1) * needed * closeness * REPULSION_STEP;
      }
      // Pull the hue back toward its position-derived base so a folder whose
      // neighbors move away re-colors to match its new spot on the canvas.
      adjustment += -signedAngle(hue, positionBase(folder.x, folder.y)) * BASE_PULL;
      colors.set(
        folder.id,
        Math.round(wrapDeg(hue + Math.max(-60, Math.min(60, adjustment)))),
      );
    }
  }
  return colors;
}
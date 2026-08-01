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

/**
 * Gives every visible folder a color from `palette` that differs from the
 * folders near it (its parent folder and its sibling folders), so adjacent
 * folders are easy to tell apart. `colors` is the persistent id -> color map
 * (a folder keeps its color across renders). An existing assignment is kept
 * unless it now conflicts with a neighbor's color.
 */
export function assignDistinctFolderColors(visibleItems, colors, palette) {
  const isFolder = (vi) => vi.kind === 'group';
  const byParent = new Map();
  for (const vi of visibleItems) {
    const key = vi.parentId ?? ROOT_ID;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(vi);
  }
  const folderById = new Map(visibleItems.filter(isFolder).map((vi) => [vi.id, vi]));
  const folderIds = [...folderById.keys()].sort();
  for (const id of folderIds) {
    const vi = folderById.get(id);
    const neighbors = new Set();
    const parentId = vi.parentId;
    if (parentId && parentId !== ROOT_ID && parentId !== 'bin' && folderById.has(parentId)) {
      neighbors.add(parentId);
    }
    for (const sibling of byParent.get(parentId ?? ROOT_ID) ?? []) {
      if (sibling.id !== id && isFolder(sibling)) neighbors.add(sibling.id);
    }
    const used = new Set([...neighbors].map((nid) => colors.get(nid)).filter(Boolean));
    const current = colors.get(id);
    if (current && !used.has(current)) continue;
    colors.set(id, palette.find((color) => !used.has(color)) ?? palette[0]);
  }
  return colors;
}
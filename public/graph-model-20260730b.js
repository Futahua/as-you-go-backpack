import { itemsIn, binnedItems, ROOT_ID } from './workspace-model-20260730b.js';

/** A shortcut's identity for graph purposes is its shared shortcut record
 * (`shortcutId`), not any one placement — a linked shortcut visible from
 * several currently-expanded folders at once must collapse to one node.
 * Groups have no such sharing, so a group's own id is its identity. */
function identityOf(candidate) {
  return candidate.kind === 'shortcut' ? candidate.shortcutId : candidate.id;
}

export function visibleGraphItems(state, parentId, expandedSet, binMode = false) {
  if (binMode) {
    const items = binnedItems(state);
    const seenIdentity = new Set();
    const result = [];
    items.forEach((candidate, index) => {
      const identity = identityOf(candidate);
      if (seenIdentity.has(identity)) return;
      seenIdentity.add(identity);
      result.push({
        id: identity,
        parentId: 'bin',
        kind: candidate.kind,
        depth: 0,
        siblingIndex: index,
        siblingCount: items.length,
      });
    });
    return result;
  }
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
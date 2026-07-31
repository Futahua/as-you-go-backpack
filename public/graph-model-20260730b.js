import { itemsIn, binnedItems, ROOT_ID } from './workspace-model-20260730b.js';

export function visibleGraphItems(state, parentId, expandedSet, binMode = false) {
  if (binMode) {
    return binnedItems(state).map((candidate, index) => ({
      id: candidate.id,
      parentId: 'bin',
      kind: candidate.kind,
      depth: 0,
      siblingIndex: index,
      siblingCount: binnedItems(state).length,
    }));
  }
  return collectVisible(state, parentId, expandedSet, 0);
}

function collectVisible(state, parentId, expanded, depth) {
  const seen = new Set();
  const items = [];
  const siblingCounts = new Map();
  function walk(folderId, d) {
    const children = itemsIn(state, folderId);
    for (const child of children) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      items.push({
        id: child.id,
        parentId: child.parentId,
        kind: child.kind,
        depth: d,
        siblingIndex: children.indexOf(child),
        siblingCount: children.length,
      });
      const isOpen = child.kind === 'group' && expanded.has(child.id);
      if (isOpen) walk(child.id, d + 1);
    }
  }
  walk(parentId, 0);
  return items;
}

export function graphEdges(items) {
  const ids = new Set(items.map((i) => i.id));
  return items
    .filter((i) => i.parentId !== ROOT_ID && i.parentId !== 'bin' && ids.has(i.parentId))
    .map((i) => ({ id: `${i.parentId}->${i.id}`, source: i.parentId, target: i.id }));
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
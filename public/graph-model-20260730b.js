import { itemsIn, ROOT_ID } from './workspace-model-20260730b.js';

export function visibleGraphItems(state, parentId, expandedSet, binMode = false) {
  return collectVisible(state, parentId, expandedSet, binMode, 0);
}

function collectVisible(state, parentId, expanded, binMode, depth) {
  const seen = new Set();
  const items = [];
  function walk(folderId, d) {
    for (const child of itemsIn(state, folderId)) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      items.push({ id: child.id, parentId: child.parentId, kind: child.kind, depth: d });
      const isOpen = !binMode && child.kind === 'group' && expanded.has(child.id);
      if (isOpen) walk(child.id, d + 1);
    }
  }
  walk(parentId, 0);
  return items;
}

export function graphEdges(items) {
  const ids = new Set(items.map((i) => i.id));
  return items
    .filter((i) => i.parentId !== ROOT_ID && ids.has(i.parentId))
    .map((i) => ({ source: i.parentId, target: i.id }));
}

const RADIUS = 28;
const SPACING = (2 * Math.PI) / 40;

export function seedPosition(itemId, parent, index, count) {
  const parentX = parent?.x ?? 0;
  const parentY = parent?.y ?? 0;
  if (!parent) {
    const a = (index * SPACING * 1.4) % (2 * Math.PI);
    return {
      x: Math.cos(a) * RADIUS * 2.4 + parentX,
      y: Math.sin(a) * RADIUS * 2.4 + parentY,
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
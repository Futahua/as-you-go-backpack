export const ROOT_ID = 'root';
export const DEFAULT_ICON_SIZE = 96;
export const MIN_ICON_SIZE = 56;
export const MAX_ICON_SIZE = 176;

const id = (kind) => `${kind}-${globalThis.crypto.randomUUID()}`;
const hasNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const stringIds = (value) => Array.isArray(value)
  ? [...new Set(value.filter((candidate) => typeof candidate === 'string'))]
  : [];

export function emptyState() {
  return {
    schemaVersion: 1,
    groups: [],
    shortcuts: [],
    view: {
      iconSize: DEFAULT_ICON_SIZE,
      currentGroupId: ROOT_ID,
      expandedGroupIds: [],
      graphExpandedGroupIds: [],
      selectedItemIds: [],
      binMode: false,
      layout: 'explorer',
      graphPositions: {},
    },
  };
}

function item(state, itemId) {
  return state.groups.find((candidate) => candidate.id === itemId)
    ?? state.shortcuts.find((candidate) => candidate.id === itemId)
    ?? null;
}

function group(state, groupId) {
  return state.groups.find((candidate) => candidate.id === groupId) ?? null;
}

function isUnderBinnedGroup(state, candidate) {
  let cursor = group(state, candidate.parentId);
  while (cursor) {
    if (cursor.bin) return true;
    cursor = group(state, cursor.parentId);
  }
  return false;
}

function activeItem(state, candidate) {
  return !candidate.bin && !isUnderBinnedGroup(state, candidate);
}

function sorted(items) {
  return [...items].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function itemsIn(state, parentId = ROOT_ID) {
  return sorted([
    ...state.groups.filter((candidate) => candidate.parentId === parentId && activeItem(state, candidate))
      .map((candidate) => ({ ...candidate, kind: 'group' })),
    ...state.shortcuts.filter((candidate) => candidate.parentId === parentId && activeItem(state, candidate))
      .map((candidate) => ({ ...candidate, kind: 'shortcut' })),
  ]);
}

export function children(state, parentId = ROOT_ID) {
  const items = itemsIn(state, parentId);
  return {
    groups: items.filter((candidate) => candidate.kind === 'group').map(({ kind: _kind, ...candidate }) => candidate),
    shortcuts: items.filter((candidate) => candidate.kind === 'shortcut').map(({ kind: _kind, ...candidate }) => candidate),
  };
}

export function binnedItems(state) {
  return sorted([
    ...state.groups.filter((candidate) => candidate.bin).map((candidate) => ({ ...candidate, kind: 'group' })),
    ...state.shortcuts.filter((candidate) => candidate.bin).map((candidate) => ({ ...candidate, kind: 'shortcut' })),
  ]);
}

function normalizeGraphPositions(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const cleaned = {};
  const entries = Object.entries(raw);
  for (const [ctxKey, ctxValue] of entries) {
    if (typeof ctxKey !== 'string' || !ctxValue || typeof ctxValue !== 'object' || Array.isArray(ctxValue)) continue;
    const ctx = {};
    let hasValid = false;
    for (const [itemId, pos] of Object.entries(ctxValue)) {
      if (typeof itemId !== 'string' || !pos || typeof pos !== 'object') continue;
      if (!hasNumber(pos.x) || !hasNumber(pos.y)) continue;
      ctx[itemId] = { x: pos.x, y: pos.y };
      hasValid = true;
    }
    if (hasValid) cleaned[ctxKey] = ctx;
  }
  return cleaned;
}

export function normalizeState(raw) {
  const state = {
    schemaVersion: 1,
    groups: Array.isArray(raw?.groups)
      ? raw.groups.map((candidate) => ({ ...candidate, icon: candidate.icon ?? null }))
      : [],
    shortcuts: Array.isArray(raw?.shortcuts) ? raw.shortcuts.map((candidate) => ({ ...candidate })) : [],
    view: {
      iconSize: Math.min(
        MAX_ICON_SIZE,
        Math.max(MIN_ICON_SIZE, hasNumber(raw?.view?.iconSize) ? raw.view.iconSize : DEFAULT_ICON_SIZE),
      ),
      currentGroupId:
        typeof raw?.view?.currentGroupId === 'string'
          ? raw.view.currentGroupId
          : ROOT_ID,
      expandedGroupIds: stringIds(raw?.view?.expandedGroupIds),
      graphExpandedGroupIds: stringIds(raw?.view?.graphExpandedGroupIds),
      selectedItemIds: stringIds(raw?.view?.selectedItemIds),
      binMode: raw?.view?.binMode === true,
      layout: raw?.view?.layout === 'graph' ? 'graph' : 'explorer',
      graphPositions: normalizeGraphPositions(raw?.view?.graphPositions),
    },
  };

  const parents = new Set([
    ROOT_ID,
    ...state.groups.map((candidate) => candidate.parentId),
    ...state.shortcuts.map((candidate) => candidate.parentId),
  ]);
  for (const parentId of parents) {
    const siblings = [
      ...state.groups.filter((candidate) => candidate.parentId === parentId),
      ...state.shortcuts.filter((candidate) => candidate.parentId === parentId),
    ].sort((a, b) => {
      if (hasNumber(a.order) && hasNumber(b.order)) return a.order - b.order;
      if (hasNumber(a.order)) return -1;
      if (hasNumber(b.order)) return 1;
      return 0;
    });
    siblings.forEach((candidate, order) => {
      const stored = item(state, candidate.id);
      if (stored) stored.order = order;
    });
  }
  return state;
}

export function migrateActions(actions) {
  const state = emptyState();
  state.shortcuts = (actions?.actions ?? []).map((action, order) => ({
    id: `shortcut-${action.id}`,
    parentId: ROOT_ID,
    order,
    name: action.id === 'clips' ? 'CLIPS' : action.id === 'sloptop-mode' ? 'SLOPTOP MODE' : action.id === 'slop-engine' ? 'slop_engine' : action.id,
    description: '',
    target: action.target,
    icon: null,
  }));
  return state;
}

function isDescendant(state, candidateId, ancestorId) {
  let current = group(state, candidateId);
  while (current) {
    if (current.parentId === ancestorId) return true;
    current = group(state, current.parentId);
  }
  return false;
}

function assertParent(state, parentId) {
  if (parentId !== ROOT_ID && !group(state, parentId)) {
    throw new Error('Destination group was not found.');
  }
}

function nextOrder(state, parentId) {
  return itemsIn(state, parentId).length;
}

export function createGroup(state, name, parentId = ROOT_ID, icon = null) {
  const trimmed = String(name).trim();
  if (!trimmed) throw new Error('Group name must not be empty.');
  assertParent(state, parentId);
  return {
    ...state,
    groups: [...state.groups, {
      id: id('group'),
      parentId,
      order: nextOrder(state, parentId),
      name: trimmed,
      icon,
    }],
  };
}

export function createShortcut(state, shortcut) {
  const name = String(shortcut.name ?? '').trim();
  const target = String(shortcut.target ?? '').trim();
  if (!name) throw new Error('Shortcut name must not be empty.');
  if (!target) throw new Error('Shortcut target must not be empty.');
  const parentId = shortcut.parentId ?? ROOT_ID;
  assertParent(state, parentId);
  return {
    ...state,
    shortcuts: [...state.shortcuts, {
      id: id('shortcut'),
      parentId,
      order: nextOrder(state, parentId),
      name,
      description: String(shortcut.description ?? '').trim(),
      target,
      icon: shortcut.icon ?? null,
    }],
  };
}

export function createDroppedShortcuts(state, droppedTargets, parentId = ROOT_ID) {
  assertParent(state, parentId);
  const existingTargets = new Set(
    state.shortcuts
      .filter((candidate) => candidate.parentId === parentId && !candidate.bin)
      .map((candidate) => candidate.target.toLocaleLowerCase()),
  );
  let next = state;
  for (const dropped of droppedTargets) {
    const target = String(dropped?.target ?? '').trim();
    const key = target.toLocaleLowerCase();
    if (!target || existingTargets.has(key)) continue;
    next = createShortcut(next, {
      name: String(dropped?.name ?? '').trim() || target,
      target,
      parentId,
      description: '',
      icon: null,
    });
    existingTargets.add(key);
  }
  return next;
}

function normalizeWebTarget(target) {
  let parsed;
  try {
    parsed = new URL(String(target ?? '').trim());
  } catch {
    throw new Error('Web address must be a valid http or https URL.');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Web address must use http or https.');
  }
  return parsed.toString();
}

export function isWebLink(candidate) {
  if (!candidate || typeof candidate.target !== 'string') return false;
  try {
    const parsed = new URL(candidate.target);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export function webLinkIcon(candidate) {
  if (!isWebLink(candidate)) return null;
  return new URL('/favicon.ico', candidate.target).toString();
}

export function createWebLink(state, webLink) {
  return createShortcut(state, {
    ...webLink,
    target: normalizeWebTarget(webLink.target),
  });
}

export function updateWebLink(state, shortcutId, changes) {
  return updateShortcut(state, shortcutId, {
    ...changes,
    target: normalizeWebTarget(changes.target),
  });
}

export function updateShortcut(state, shortcutId, changes) {
  const name = String(changes.name ?? '').trim();
  const target = String(changes.target ?? '').trim();
  if (!name) throw new Error('Shortcut name must not be empty.');
  if (!target) throw new Error('Shortcut target must not be empty.');
  let found = false;
  const shortcuts = state.shortcuts.map((candidate) => {
    if (candidate.id !== shortcutId) return candidate;
    found = true;
    return {
      ...candidate,
      name,
      description: String(changes.description ?? '').trim(),
      target,
      icon: changes.icon ?? null,
    };
  });
  if (!found) throw new Error('Shortcut was not found.');
  return { ...state, shortcuts };
}

export function updateGroup(state, groupId, changes) {
  const name = String(changes.name ?? '').trim();
  if (!name) throw new Error('Group name must not be empty.');
  let found = false;
  const groups = state.groups.map((candidate) => {
    if (candidate.id !== groupId) return candidate;
    found = true;
    return {
      ...candidate,
      name,
      icon: changes.icon ?? null,
    };
  });
  if (!found) throw new Error('Group was not found.');
  return { ...state, groups };
}

export function moveSelection(state, ids, destinationId = ROOT_ID) {
  assertParent(state, destinationId);
  const selected = new Set(selectedRoots(state, ids));
  for (const selectedId of selected) {
    const selectedGroup = group(state, selectedId);
    if (
      selectedGroup
      && (selectedGroup.id === destinationId || isDescendant(state, destinationId, selectedGroup.id))
    ) {
      throw new Error('A group cannot be moved inside itself.');
    }
  }
  let order = nextOrder(state, destinationId);
  return {
    ...state,
    groups: state.groups.map((candidate) => selected.has(candidate.id)
      ? { ...candidate, parentId: destinationId, order: order++, bin: undefined }
      : candidate),
    shortcuts: state.shortcuts.map((candidate) => selected.has(candidate.id)
      ? { ...candidate, parentId: destinationId, order: order++, bin: undefined }
      : candidate),
  };
}

function copyGroup(state, source, parentId, order, copies) {
  const copied = { ...source, id: id('group'), parentId, order, bin: undefined };
  copies.groups.push(copied);
  for (const child of itemsIn(state, source.id)) {
    if (child.kind === 'group') copyGroup(state, child, copied.id, child.order, copies);
    else copies.shortcuts.push({
      ...child,
      id: id('shortcut'),
      parentId: copied.id,
      order: child.order,
      bin: undefined,
      kind: undefined,
    });
  }
}

export function copySelection(state, ids, destinationId = ROOT_ID) {
  assertParent(state, destinationId);
  const selected = new Set(selectedRoots(state, ids));
  const copies = { groups: [], shortcuts: [] };
  let order = nextOrder(state, destinationId);
  const sources = sorted([
    ...state.groups.filter((candidate) => selected.has(candidate.id) && activeItem(state, candidate))
      .map((candidate) => ({ ...candidate, kind: 'group' })),
    ...state.shortcuts.filter((candidate) => selected.has(candidate.id) && activeItem(state, candidate))
      .map((candidate) => ({ ...candidate, kind: 'shortcut' })),
  ]);
  for (const candidate of sources) {
    if (candidate.kind === 'group') {
      copyGroup(state, candidate, destinationId, order++, copies);
    } else {
      copies.shortcuts.push({
      ...candidate,
      id: id('shortcut'),
      parentId: destinationId,
      order: order++,
      bin: undefined,
      kind: undefined,
      });
    }
  }
  return {
    ...state,
    groups: [...state.groups, ...copies.groups],
    shortcuts: [...state.shortcuts, ...copies.shortcuts],
  };
}

export function reorderSelection(state, ids, parentId, beforeId = null) {
  const selected = new Set(ids);
  const siblings = itemsIn(state, parentId);
  if (![...selected].every((selectedId) => siblings.some((candidate) => candidate.id === selectedId))) {
    throw new Error('Only items in this folder can be reordered together.');
  }
  const moving = siblings.filter((candidate) => selected.has(candidate.id));
  const remaining = siblings.filter((candidate) => !selected.has(candidate.id));
  const index = beforeId ? remaining.findIndex((candidate) => candidate.id === beforeId) : remaining.length;
  if (beforeId && index < 0) throw new Error('The reorder destination was not found.');
  const reordered = [
    ...remaining.slice(0, index),
    ...moving,
    ...remaining.slice(index),
  ];
  const orders = new Map(reordered.map((candidate, order) => [candidate.id, order]));
  return {
    ...state,
    groups: state.groups.map((candidate) => orders.has(candidate.id)
      ? { ...candidate, order: orders.get(candidate.id) }
      : candidate),
    shortcuts: state.shortcuts.map((candidate) => orders.has(candidate.id)
      ? { ...candidate, order: orders.get(candidate.id) }
      : candidate),
  };
}

function selectedRoots(state, ids) {
  const selected = new Set(ids);
  return [...selected].filter((selectedId) => {
    let candidate = item(state, selectedId);
    while (candidate && candidate.parentId !== ROOT_ID) {
      if (selected.has(candidate.parentId)) return false;
      candidate = group(state, candidate.parentId);
    }
    return true;
  });
}

export function binSelection(state, ids, binnedAt = new Date().toISOString()) {
  const roots = new Set(selectedRoots(state, ids));
  const mark = (candidate) => roots.has(candidate.id)
    ? {
        ...candidate,
        bin: {
          parentId: candidate.parentId,
          order: candidate.order ?? 0,
          binnedAt,
        },
      }
    : candidate;
  return {
    ...state,
    groups: state.groups.map(mark),
    shortcuts: state.shortcuts.map(mark),
  };
}

export function restoreSelection(state, ids) {
  const selected = new Set(ids);
  const restore = (candidate) => {
    if (!selected.has(candidate.id) || !candidate.bin) return candidate;
    const originalParent = candidate.bin.parentId;
    const canRestoreParent = originalParent === ROOT_ID
      || (group(state, originalParent) && activeItem(state, group(state, originalParent)));
    return {
      ...candidate,
      parentId: canRestoreParent ? originalParent : ROOT_ID,
      order: candidate.bin.order,
      bin: undefined,
    };
  };
  return {
    ...state,
    groups: state.groups.map(restore),
    shortcuts: state.shortcuts.map(restore),
  };
}

function descendantGroupIds(state, roots) {
  const result = new Set(roots);
  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of state.groups) {
      if (!result.has(candidate.id) && result.has(candidate.parentId)) {
        result.add(candidate.id);
        changed = true;
      }
    }
  }
  return result;
}

export function permanentlyDelete(state, ids) {
  const selected = ids.map((itemId) => item(state, itemId));
  if (selected.some((candidate) => !candidate?.bin)) {
    throw new Error('Only items in the Bin can be permanently deleted.');
  }
  const selectedIds = new Set(ids);
  const groupsToDelete = descendantGroupIds(
    state,
    state.groups.filter((candidate) => selectedIds.has(candidate.id)).map((candidate) => candidate.id),
  );
  return {
    ...state,
    groups: state.groups.filter((candidate) => !groupsToDelete.has(candidate.id)),
    shortcuts: state.shortcuts.filter((candidate) =>
      !selectedIds.has(candidate.id) && !groupsToDelete.has(candidate.parentId)),
  };
}

export function renameItem(state, itemId, name) {
  const trimmed = String(name).trim();
  if (!trimmed) throw new Error('Name must not be empty.');
  let found = false;
  const groups = state.groups.map((candidate) => candidate.id === itemId
    ? (found = true, { ...candidate, name: trimmed })
    : candidate);
  const shortcuts = state.shortcuts.map((candidate) => candidate.id === itemId
    ? (found = true, { ...candidate, name: trimmed })
    : candidate);
  if (!found) throw new Error('Item was not found.');
  return { ...state, groups, shortcuts };
}

export function setIconSize(state, size) {
  return {
    ...state,
    view: {
      ...state.view,
      iconSize: Math.min(MAX_ICON_SIZE, Math.max(MIN_ICON_SIZE, Math.round(size))),
    },
  };
}

export function updateWorkspaceView(state, changes) {
  const has = (key) => Object.prototype.hasOwnProperty.call(changes, key);
  const layout =
    has('layout') && (changes.layout === 'graph' || changes.layout === 'explorer')
      ? changes.layout
      : (state.view?.layout === 'graph' ? 'graph' : 'explorer');
  return {
    ...state,
    view: {
      ...state.view,
      layout,
      iconSize: state.view?.iconSize ?? DEFAULT_ICON_SIZE,
      currentGroupId:
        has('currentGroupId') && typeof changes.currentGroupId === 'string'
          ? changes.currentGroupId
          : (state.view?.currentGroupId ?? ROOT_ID),
      expandedGroupIds: has('expandedGroupIds')
        ? stringIds(changes.expandedGroupIds)
        : (state.view?.expandedGroupIds ?? []),
      graphExpandedGroupIds: has('graphExpandedGroupIds')
        ? stringIds(changes.graphExpandedGroupIds)
        : (state.view?.graphExpandedGroupIds ?? []),
      selectedItemIds: has('selectedItemIds')
        ? stringIds(changes.selectedItemIds)
        : (state.view?.selectedItemIds ?? []),
      binMode: has('binMode')
        ? changes.binMode === true
        : (state.view?.binMode === true),
      graphPositions: has('graphPositions')
        ? normalizeGraphPositions(changes.graphPositions)
        : (state.view?.graphPositions ?? {}),
    },
  };
}

export function graphContextId(currentGroupId, binMode) {
  return binMode ? 'bin' : (currentGroupId ?? ROOT_ID);
}

export function getGraphPosition(state, contextId, itemId) {
  const ctx = state.view?.graphPositions?.[contextId];
  if (!ctx || !ctx[itemId]) return null;
  return { x: ctx[itemId].x, y: ctx[itemId].y };
}

export function setGraphPositions(state, contextId, updates) {
  const ctx = { ...(state.view?.graphPositions?.[contextId] ?? {}) };
  for (const [itemId, pos] of Object.entries(updates)) {
    if (!hasNumber(pos?.x) || !hasNumber(pos?.y)) {
      delete ctx[itemId];
    } else {
      ctx[itemId] = { x: pos.x, y: pos.y };
    }
  }
  const graphPositions = { ...(state.view?.graphPositions ?? {}) };
  if (Object.keys(ctx).length > 0) {
    graphPositions[contextId] = ctx;
  } else {
    delete graphPositions[contextId];
  }
  return updateWorkspaceView(state, { graphPositions });
}

export function removeGraphPositions(state, contextId, itemIds) {
  const ctx = { ...(state.view?.graphPositions?.[contextId] ?? {}) };
  for (const itemId of itemIds) {
    delete ctx[itemId];
  }
  const graphPositions = { ...(state.view?.graphPositions ?? {}) };
  if (Object.keys(ctx).length > 0) {
    graphPositions[contextId] = ctx;
  } else {
    delete graphPositions[contextId];
  }
  return updateWorkspaceView(state, { graphPositions });
}

export { normalizeGraphPositions };

export function itemsIntersectingMarquee(items, rectangle) {
  const left = Math.min(rectangle.left, rectangle.right);
  const right = Math.max(rectangle.left, rectangle.right);
  const top = Math.min(rectangle.top, rectangle.bottom);
  const bottom = Math.max(rectangle.top, rectangle.bottom);

  return items
    .filter((candidate) =>
      candidate.right >= left
      && candidate.left <= right
      && candidate.bottom >= top
      && candidate.top <= bottom)
    .map((candidate) => candidate.id);
}

import { normalizePromptCards } from './prompt-library-model.js';

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
      promptCards: [],
      graphPositions: {},
      toolbarPositions: {},
    },
  };
}

function group(state, groupId) {
  return state.groups.find((candidate) => candidate.id === groupId) ?? null;
}

/** Finds the shortcut record and one specific placement by that placement's
 * id, searching both active and binned placements. */
function findPlacement(state, placementId) {
  for (const candidate of state.shortcuts) {
    const placement = (candidate.placements ?? []).find((entry) => entry.id === placementId);
    if (placement) return { shortcut: candidate, placement };
  }
  return null;
}

function shortcutRecord(state, shortcutId) {
  return state.shortcuts.find((candidate) => candidate.id === shortcutId) ?? null;
}

/** Resolves an id the way the renderer sees it: a group by its own id, or a
 * shortcut placement (by placement id) expanded with its shared data and
 * that placement's own parentId/order — mirroring what itemsIn/binnedItems
 * emit, so callers can treat any selected id uniformly. */
function item(state, itemId) {
  const asGroup = group(state, itemId);
  if (asGroup) return { ...asGroup, kind: 'group' };
  const found = findPlacement(state, itemId);
  if (!found) return null;
  const { shortcut, placement } = found;
  return {
    ...shortcut,
    kind: 'shortcut',
    id: placement.id,
    shortcutId: shortcut.id,
    parentId: placement.bin ? 'bin' : placement.parentId,
    order: placement.order,
    ...(placement.bin ? { bin: placement.bin } : {}),
    linked: placementCount(shortcut) > 1,
    placements: undefined,
  };
}

function isUnderBinnedGroupId(state, parentId) {
  let cursor = group(state, parentId);
  while (cursor) {
    if (cursor.bin) return true;
    cursor = group(state, cursor.parentId);
  }
  return false;
}

function isUnderBinnedGroup(state, candidate) {
  return isUnderBinnedGroupId(state, candidate.parentId);
}

function activeItem(state, candidate) {
  return !candidate.bin && !isUnderBinnedGroup(state, candidate);
}

/** Walks up from parentId past any binned ancestors to find the nearest
 * still-active folder (or ROOT_ID). Used to restore an item nested inside
 * a binned folder without un-binning that folder — e.g. binning 3 in the
 * chain 1>2>3>4>5 and then restoring 5 alone should land it directly under
 * 2, the nearest ancestor that's still active. */
function nearestActiveAncestorId(state, parentId) {
  if (parentId === ROOT_ID || parentId === 'bin') return ROOT_ID;
  let cursor = group(state, parentId);
  while (cursor) {
    if (!cursor.bin && !isUnderBinnedGroupId(state, cursor.parentId)) return cursor.id;
    cursor = group(state, cursor.parentId);
  }
  return ROOT_ID;
}

function activePlacements(shortcut) {
  return (shortcut.placements ?? []).filter((placement) => !placement.bin);
}

function binnedPlacements(shortcut) {
  return (shortcut.placements ?? []).filter((placement) => placement.bin);
}

/** Placement count across every non-bin location; used to decide whether an
 * edit needs the apply-everywhere-or-fork prompt. */
export function placementCount(shortcut) {
  return activePlacements(shortcut).length;
}

function sorted(items) {
  return [...items].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/** Expands each shortcut into one entry per active placement in `parentId`.
 * The emitted `id` IS the placement id — that's what gets selected, dragged,
 * moved, and binned. `shortcutId` is the shared record every placement of
 * the same shortcut has in common, used for edits, launching and reveal. */
function shortcutPlacementsIn(state, parentId) {
  const entries = [];
  for (const candidate of state.shortcuts) {
    for (const placement of activePlacements(candidate)) {
      if (placement.parentId !== parentId) continue;
      if (isUnderBinnedGroupId(state, placement.parentId)) continue;
      entries.push({
        ...candidate,
        kind: 'shortcut',
        id: placement.id,
        shortcutId: candidate.id,
        parentId: placement.parentId,
        order: placement.order,
        linked: placementCount(candidate) > 1,
        placements: undefined,
      });
    }
  }
  return entries;
}

export function itemsIn(state, parentId = ROOT_ID) {
  return sorted([
    ...state.groups.filter((candidate) => candidate.parentId === parentId && activeItem(state, candidate))
      .map((candidate) => ({ ...candidate, kind: 'group' })),
    ...shortcutPlacementsIn(state, parentId),
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
  const shortcutPlacements = [];
  for (const candidate of state.shortcuts) {
    for (const placement of binnedPlacements(candidate)) {
      shortcutPlacements.push({
        ...candidate,
        kind: 'shortcut',
        id: placement.id,
        shortcutId: candidate.id,
        parentId: 'bin',
        order: placement.order ?? 0,
        bin: placement.bin,
        linked: placementCount(candidate) > 1,
        // Whether this shortcut had more than one placement in total
        // (active + binned) — unlike `linked` above (which only counts
        // currently-active placements, correct for the link badge/fork
        // prompt elsewhere), this stays true even when every placement
        // was binned at once, since the Bin still needs to distinguish
        // those otherwise-identical tiles from each other.
        wasLinked: (candidate.placements?.length ?? 0) > 1,
        placements: undefined,
      });
    }
  }
  return sorted([
    ...state.groups.filter((candidate) => candidate.bin).map((candidate) => ({ ...candidate, kind: 'group' })),
    ...shortcutPlacements,
  ]);
}

/** Lists the direct children of a binned folder, for expanding it inside
 * the Bin view. Nothing here was independently binned — a folder's
 * children are still fully intact, just hidden from the normal view
 * because their ancestor is binned (see isUnderBinnedGroup) — so this
 * intentionally skips the "hidden by binned ancestor" filter itemsIn()
 * applies, while still excluding anything that has since been
 * independently binned itself (it already has its own top-level Bin
 * tile and shouldn't also appear nested here). */
export function itemsInBinnedGroup(state, groupId) {
  const childGroups = state.groups
    .filter((candidate) => candidate.parentId === groupId && !candidate.bin)
    .map((candidate) => ({ ...candidate, kind: 'group' }));
  const childPlacements = [];
  for (const candidate of state.shortcuts) {
    for (const placement of activePlacements(candidate)) {
      if (placement.parentId !== groupId) continue;
      childPlacements.push({
        ...candidate,
        kind: 'shortcut',
        id: placement.id,
        shortcutId: candidate.id,
        parentId: placement.parentId,
        order: placement.order,
        linked: placementCount(candidate) > 1,
        placements: undefined,
      });
    }
  }
  return sorted([...childGroups, ...childPlacements]);
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

function normalizeFlatPositions(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const cleaned = {};
  for (const [key, pos] of Object.entries(raw)) {
    if (typeof key !== 'string' || !pos || typeof pos !== 'object') continue;
    if (!hasNumber(pos.x) || !hasNumber(pos.y)) continue;
    cleaned[key] = { x: pos.x, y: pos.y };
  }
  return cleaned;
}

function placementId() {
  return `placement-${globalThis.crypto.randomUUID()}`;
}

/** Accepts either the legacy single-location shape (`parentId`/`order`/`bin`
 * directly on the shortcut) or the current `placements` array, and always
 * returns a normalized `placements` array. A shortcut is migrated once, the
 * first time its file is loaded after this feature shipped; from then on it
 * only ever has `placements`. */
function normalizePlacements(raw) {
  if (Array.isArray(raw.placements)) {
    return raw.placements
      .filter((placement) => placement && typeof placement === 'object' && typeof placement.parentId === 'string')
      .map((placement) => ({
        id: typeof placement.id === 'string' ? placement.id : placementId(),
        parentId: placement.parentId,
        // Left as-is (possibly undefined) so the renumbering pass in
        // normalizeState can tell "no order yet" apart from an explicit 0,
        // exactly like it already does for groups.
        order: hasNumber(placement.order) ? placement.order : undefined,
        ...(placement.bin && typeof placement.bin === 'object'
          ? {
              bin: {
                parentId: typeof placement.bin.parentId === 'string' ? placement.bin.parentId : ROOT_ID,
                order: hasNumber(placement.bin.order) ? placement.bin.order : 0,
                binnedAt: typeof placement.bin.binnedAt === 'string' ? placement.bin.binnedAt : new Date(0).toISOString(),
              },
            }
          : {}),
      }));
  }
  if (typeof raw.parentId === 'string') {
    return [{
      id: placementId(),
      parentId: raw.parentId,
      order: hasNumber(raw.order) ? raw.order : undefined,
      ...(raw.bin && typeof raw.bin === 'object'
        ? {
            bin: {
              parentId: typeof raw.bin.parentId === 'string' ? raw.bin.parentId : ROOT_ID,
              order: hasNumber(raw.bin.order) ? raw.bin.order : 0,
              binnedAt: typeof raw.bin.binnedAt === 'string' ? raw.bin.binnedAt : new Date(0).toISOString(),
            },
          }
        : {}),
    }];
  }
  return [];
}

export function normalizeState(raw) {
  const state = {
    schemaVersion: 1,
    groups: Array.isArray(raw?.groups)
      ? raw.groups.map((candidate) => ({ ...candidate, icon: candidate.icon ?? null }))
      : [],
    shortcuts: Array.isArray(raw?.shortcuts)
      ? raw.shortcuts.map((candidate) => {
          const { parentId: _parentId, order: _order, bin: _bin, ...rest } = candidate;
          return { ...rest, placements: normalizePlacements(candidate) };
        })
      : [],
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
      toolbarPositions: normalizeFlatPositions(raw?.view?.toolbarPositions),
      // promptCards replaces pickupPrompt: legacy values are read here purely
      // for migration (normalizePromptCards) and never written again.
      promptCards: normalizePromptCards(raw?.view?.promptCards, raw?.view?.pickupPrompt),
    },
  };

  const groupParents = new Set([ROOT_ID, ...state.groups.map((candidate) => candidate.parentId)]);
  for (const parentId of groupParents) {
    const siblingGroups = state.groups.filter((candidate) => candidate.parentId === parentId);
    const siblingPlacements = state.shortcuts.flatMap((candidate) =>
      candidate.placements.filter((placement) => !placement.bin && placement.parentId === parentId)
        .map((placement) => ({ placement, candidate })));
    const combined = [
      ...siblingGroups.map((candidate) => ({ order: candidate.order, apply: (order) => { candidate.order = order; } })),
      ...siblingPlacements.map(({ placement }) => ({ order: placement.order, apply: (order) => { placement.order = order; } })),
    ].sort((a, b) => {
      if (hasNumber(a.order) && hasNumber(b.order)) return a.order - b.order;
      if (hasNumber(a.order)) return -1;
      if (hasNumber(b.order)) return 1;
      return 0;
    });
    combined.forEach((entry, order) => entry.apply(order));
  }
  return state;
}

export function migrateActions(actions) {
  const state = emptyState();
  state.shortcuts = (actions?.actions ?? []).map((action, order) => ({
    id: `shortcut-${action.id}`,
    placements: [{ id: placementId(), parentId: ROOT_ID, order }],
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
      placements: [{ id: placementId(), parentId, order: nextOrder(state, parentId) }],
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
    itemsIn(state, parentId)
      .filter((candidate) => candidate.kind === 'shortcut')
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
  let raw = String(target ?? '').trim();
  if (!raw) throw new Error('Web address must not be empty.');
  if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw;
  let parsed;
  try {
    parsed = new URL(raw);
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
  return candidate.target;
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

/** Splits one placement of a linked shortcut off into a brand-new,
 * independent shortcut record carrying a copy of the current shared data.
 * The original record keeps its other placements untouched. Use this before
 * applying an edit that should only affect one location, not every place
 * the shortcut is linked into. */
export function forkPlacement(state, placementId_) {
  const found = findPlacement(state, placementId_);
  if (!found) throw new Error('Shortcut was not found.');
  const { shortcut, placement } = found;
  if (placementCount(shortcut) <= 1) return state;
  const newShortcut = {
    ...shortcut,
    id: id('shortcut'),
    placements: [{ id: placementId(), parentId: placement.parentId, order: placement.order }],
  };
  const shortcuts = state.shortcuts
    .map((candidate) => candidate.id === shortcut.id
      ? { ...candidate, placements: candidate.placements.filter((entry) => entry.id !== placementId_) }
      : candidate)
    .concat(newShortcut);
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
  const selectedGroupIds = new Set();
  const selectedPlacementIds = new Set();
  for (const selectedId of selected) {
    const selectedGroup = group(state, selectedId);
    if (selectedGroup) {
      if (selectedGroup.id === destinationId || isDescendant(state, destinationId, selectedGroup.id)) {
        throw new Error('A group cannot be moved inside itself.');
      }
      selectedGroupIds.add(selectedId);
    } else {
      selectedPlacementIds.add(selectedId);
    }
  }
  let order = nextOrder(state, destinationId);
  const groups = state.groups.map((candidate) => selectedGroupIds.has(candidate.id)
    ? { ...candidate, parentId: destinationId, order: order++, bin: undefined }
    : candidate);
  const shortcuts = mapPlacements(state.shortcuts, selectedPlacementIds, (placement) => ({
    ...placement,
    parentId: destinationId,
    order: order++,
    bin: undefined,
  }));
  return { ...state, groups, shortcuts };
}

/** Collapses every one of a shortcut's active placements into a single new
 * placement at `destinationId`. Used when cutting a linked shortcut from a
 * view where all of its placements are currently visible at once (e.g. the
 * top-level graph showing every edge) — the whole shared thing moves,
 * rather than any one specific location. Binned placements are untouched. */
export function collapsePlacements(state, shortcutId, destinationId = ROOT_ID) {
  assertParent(state, destinationId);
  const order = nextOrder(state, destinationId);
  const shortcuts = state.shortcuts.map((candidate) => {
    if (candidate.id !== shortcutId) return candidate;
    const binned = candidate.placements.filter((placement) => placement.bin);
    return {
      ...candidate,
      placements: [...binned, { id: placementId(), parentId: destinationId, order }],
    };
  });
  return { ...state, shortcuts };
}

/** Copying a shortcut always links: it gains a new placement in the
 * destination pointing at the same shared record, rather than becoming an
 * independent duplicate. `newPlacements` collects { shortcutId, parentId,
 * order } entries to fold into the existing records afterward. Groups still
 * fully clone, recursively, including a new placement for any linked
 * shortcut found inside. */
function copyGroup(state, source, parentId, order, copies, newPlacements) {
  const copied = { ...source, id: id('group'), parentId, order, bin: undefined };
  copies.groups.push(copied);
  for (const child of itemsIn(state, source.id)) {
    if (child.kind === 'group') copyGroup(state, child, copied.id, child.order, copies, newPlacements);
    else newPlacements.push({ shortcutId: child.shortcutId, parentId: copied.id, order: child.order });
  }
}

export function copySelection(state, ids, destinationId = ROOT_ID) {
  assertParent(state, destinationId);
  const selected = new Set(selectedRoots(state, ids));
  const copies = { groups: [] };
  const newPlacements = [];
  let order = nextOrder(state, destinationId);

  const selectedGroups = sorted(
    state.groups.filter((candidate) => selected.has(candidate.id) && activeItem(state, candidate)),
  );
  for (const sourceGroup of selectedGroups) {
    copyGroup(state, sourceGroup, destinationId, order++, copies, newPlacements);
  }

  const selectedPlacements = sorted(
    [...selected]
      .filter((selectedId) => !group(state, selectedId))
      .map((selectedId) => findPlacement(state, selectedId))
      .filter((found) => found && !found.placement.bin)
      .map(({ shortcut, placement }) => ({ shortcutId: shortcut.id, order: placement.order })),
  );
  for (const { shortcutId } of selectedPlacements) {
    newPlacements.push({ shortcutId, parentId: destinationId, order: order++ });
  }

  const byShortcutId = new Map();
  for (const entry of newPlacements) {
    if (!byShortcutId.has(entry.shortcutId)) byShortcutId.set(entry.shortcutId, []);
    byShortcutId.get(entry.shortcutId).push(entry);
  }
  const shortcuts = state.shortcuts.map((candidate) => {
    const additions = byShortcutId.get(candidate.id);
    if (!additions) return candidate;
    return {
      ...candidate,
      placements: [
        ...candidate.placements,
        ...additions.map(({ parentId, order: placeOrder }) => ({ id: placementId(), parentId, order: placeOrder })),
      ],
    };
  });
  return {
    ...state,
    groups: [...state.groups, ...copies.groups],
    shortcuts,
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
  const groups = state.groups.map((candidate) => orders.has(candidate.id)
    ? { ...candidate, order: orders.get(candidate.id) }
    : candidate);
  const shortcuts = mapPlacements(state.shortcuts, orders.keys(), (placement) => ({
    ...placement,
    order: orders.get(placement.id),
  }));
  return { ...state, groups, shortcuts };
}

/** Applies `transform(placement)` to each placement whose id is in
 * `placementIds`, returning a new `shortcuts` array. `transform` returning
 * `undefined` removes that placement entirely (used by permanent delete). */
function mapPlacements(shortcuts, placementIds, transform) {
  const ids = new Set(placementIds);
  return shortcuts.map((candidate) => {
    if (!candidate.placements?.some((placement) => ids.has(placement.id))) return candidate;
    const placements = candidate.placements
      .map((placement) => (ids.has(placement.id) ? transform(placement) : placement))
      .filter(Boolean);
    return { ...candidate, placements };
  });
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
  const groupRoots = new Set([...roots].filter((rootId) => group(state, rootId)));
  const placementRoots = [...roots].filter((rootId) => !groupRoots.has(rootId));
  const groups = state.groups.map((candidate) => groupRoots.has(candidate.id)
    ? {
        ...candidate,
        bin: { parentId: candidate.parentId, order: candidate.order ?? 0, binnedAt },
      }
    : candidate);
  const shortcuts = mapPlacements(state.shortcuts, placementRoots, (placement) => ({
    ...placement,
    bin: { parentId: placement.parentId, order: placement.order ?? 0, binnedAt },
  }));
  return { ...state, groups, shortcuts };
}

export function restoreSelection(state, ids) {
  const selected = new Set(ids);
  const restore = (candidate) => {
    if (!selected.has(candidate.id)) return candidate;
    if (candidate.bin) {
      const originalParent = candidate.bin.parentId;
      const canRestoreParent = originalParent === ROOT_ID
        || (group(state, originalParent) && activeItem(state, group(state, originalParent)));
      return {
        ...candidate,
        parentId: canRestoreParent ? originalParent : ROOT_ID,
        order: candidate.bin.order,
        bin: undefined,
      };
    }
    // Never itself binned — just nested inside a binned ancestor. Restoring
    // it alone reparents it to the nearest still-active ancestor, without
    // touching the binned folder it was pulled out of.
    if (!isUnderBinnedGroup(state, candidate)) return candidate;
    return { ...candidate, parentId: nearestActiveAncestorId(state, candidate.parentId) };
  };
  const groups = state.groups.map(restore);
  const shortcuts = mapPlacements(state.shortcuts, ids, (placement) => {
    if (placement.bin) {
      const originalParent = placement.bin.parentId;
      const canRestoreParent = originalParent === ROOT_ID
        || (group(state, originalParent) && activeItem(state, group(state, originalParent)));
      return {
        id: placement.id,
        parentId: canRestoreParent ? originalParent : ROOT_ID,
        order: placement.bin.order,
      };
    }
    if (!isUnderBinnedGroupId(state, placement.parentId)) return placement;
    return { ...placement, parentId: nearestActiveAncestorId(state, placement.parentId) };
  });
  return { ...state, groups, shortcuts };
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
  const isDeletable = (candidate) => Boolean(candidate)
    && (Boolean(candidate.bin) || isUnderBinnedGroupId(state, candidate.parentId));
  if (selected.some((candidate) => !isDeletable(candidate))) {
    throw new Error('Only items in the Bin can be permanently deleted.');
  }
  const selectedIds = new Set(ids);
  const selectedGroupIds = new Set([...selectedIds].filter((selectedId) => group(state, selectedId)));
  const selectedPlacementIds = new Set([...selectedIds].filter((selectedId) => !selectedGroupIds.has(selectedId)));
  const groupsToDelete = descendantGroupIds(
    state,
    state.groups.filter((candidate) => selectedGroupIds.has(candidate.id)).map((candidate) => candidate.id),
  );
  const groups = state.groups.filter((candidate) => !groupsToDelete.has(candidate.id));
  const shortcuts = state.shortcuts
    .map((candidate) => ({
      ...candidate,
      placements: candidate.placements.filter((placement) => {
        if (selectedPlacementIds.has(placement.id)) return false;
        const homeParent = placement.bin ? placement.bin.parentId : placement.parentId;
        return !groupsToDelete.has(homeParent);
      }),
    }))
    .filter((candidate) => candidate.placements.length > 0);
  return { ...state, groups, shortcuts };
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
      toolbarPositions: has('toolbarPositions')
        ? normalizeFlatPositions(changes.toolbarPositions)
        : (state.view?.toolbarPositions ?? {}),
      promptCards: has('promptCards')
        ? normalizePromptCards(changes.promptCards)
        : (state.view?.promptCards ?? []),
    },
  };
}

export function setPromptCards(state, cards) {
  return updateWorkspaceView(state, { promptCards: normalizePromptCards(cards) });
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

export function setToolbarPosition(state, key, pos) {
  const toolbarPositions = { ...(state.view?.toolbarPositions ?? {}) };
  if (!hasNumber(pos?.x) || !hasNumber(pos?.y)) {
    delete toolbarPositions[key];
  } else {
    toolbarPositions[key] = { x: pos.x, y: pos.y };
  }
  return updateWorkspaceView(state, { toolbarPositions });
}

export function getToolbarPosition(state, key) {
  const pos = state.view?.toolbarPositions?.[key];
  return pos ? { x: pos.x, y: pos.y } : null;
}

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

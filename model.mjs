import { randomUUID } from 'node:crypto';

export const ROOT_ID = 'root';

const id = (kind) => `${kind}-${randomUUID()}`;

export function emptyState() {
  return { schemaVersion: 1, groups: [], shortcuts: [] };
}

export function migrateActions(actions) {
  const state = emptyState();
  state.shortcuts = (actions?.actions ?? []).map((action) => ({
    id: `shortcut-${action.id}`,
    parentId: ROOT_ID,
    name: action.id === 'clips' ? 'CLIPS' : action.id === 'sloptop-mode' ? 'SLOPTOP MODE' : action.id === 'slop-engine' ? 'slop_engine' : action.id,
    description: '',
    target: action.target,
    icon: null,
  }));
  return state;
}

export function children(state, parentId = ROOT_ID) {
  return {
    groups: state.groups.filter((group) => group.parentId === parentId),
    shortcuts: state.shortcuts.filter((shortcut) => shortcut.parentId === parentId),
  };
}

function group(state, groupId) {
  return state.groups.find((candidate) => candidate.id === groupId) ?? null;
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
  if (parentId !== ROOT_ID && !group(state, parentId)) throw new Error('Destination group was not found.');
}

export function createGroup(state, name, parentId = ROOT_ID) {
  const trimmed = String(name).trim();
  if (!trimmed) throw new Error('Group name must not be empty.');
  assertParent(state, parentId);
  return {
    ...state,
    groups: [...state.groups, { id: id('group'), parentId, name: trimmed }],
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
      name,
      description: String(shortcut.description ?? '').trim(),
      target,
      icon: shortcut.icon ?? null,
    }],
  };
}

export function moveSelection(state, ids, destinationId = ROOT_ID) {
  assertParent(state, destinationId);
  const selected = new Set(ids);
  for (const selectedId of selected) {
    const selectedGroup = group(state, selectedId);
    if (selectedGroup && (selectedGroup.id === destinationId || isDescendant(state, destinationId, selectedGroup.id))) {
      throw new Error('A group cannot be moved inside itself.');
    }
  }
  return {
    ...state,
    groups: state.groups.map((item) => selected.has(item.id) ? { ...item, parentId: destinationId } : item),
    shortcuts: state.shortcuts.map((item) => selected.has(item.id) ? { ...item, parentId: destinationId } : item),
  };
}

function copyGroup(state, source, parentId, copies) {
  const copied = { ...source, id: id('group'), parentId };
  copies.groups.push(copied);
  for (const child of state.groups.filter((candidate) => candidate.parentId === source.id)) copyGroup(state, child, copied.id, copies);
  for (const child of state.shortcuts.filter((candidate) => candidate.parentId === source.id)) {
    copies.shortcuts.push({ ...child, id: id('shortcut'), parentId: copied.id });
  }
}

export function copySelection(state, ids, destinationId = ROOT_ID) {
  assertParent(state, destinationId);
  const selected = new Set(ids);
  const copies = { groups: [], shortcuts: [] };
  for (const item of state.groups.filter((candidate) => selected.has(candidate.id))) copyGroup(state, item, destinationId, copies);
  for (const item of state.shortcuts.filter((candidate) => selected.has(candidate.id))) copies.shortcuts.push({ ...item, id: id('shortcut'), parentId: destinationId });
  return { ...state, groups: [...state.groups, ...copies.groups], shortcuts: [...state.shortcuts, ...copies.shortcuts] };
}

export function renameItem(state, itemId, name) {
  const trimmed = String(name).trim();
  if (!trimmed) throw new Error('Name must not be empty.');
  let found = false;
  const groups = state.groups.map((item) => item.id === itemId ? (found = true, { ...item, name: trimmed }) : item);
  const shortcuts = state.shortcuts.map((item) => item.id === itemId ? (found = true, { ...item, name: trimmed }) : item);
  if (!found) throw new Error('Item was not found.');
  return { ...state, groups, shortcuts };
}

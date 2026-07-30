import {
  ROOT_ID,
  binSelection,
  binnedItems,
  copySelection,
  createGroup,
  createShortcut,
  itemsIn,
  moveSelection,
  normalizeState,
  permanentlyDelete,
  renameItem,
  reorderSelection,
  restoreSelection,
  setIconSize,
  updateShortcut,
} from './model.js';

const PICKUP_PROMPT = `You are picking up Papers and its Backpack projects.

Canonical Papers repository: https://github.com/Futahua/Papers-3
Primary-machine source checkout: D:\\Letters\\MatTroiSeConMoc\\PAPERS 3\\Papers-3

Before acting, read AGENTS.md and HERMES.md completely from the current repository, then follow the document map in README.md. Treat those current files as authoritative over this copied orientation.

I do not code or design technical architecture. I describe the experience I want; you must construct it, test it, protect my data, and explain the result in plain language. Clicking buttons, entering information, choosing files, opening applications, organizing work, and confirming actions are normal use—not configuration or permission to invent editors, frameworks, or product-wide abstractions.

Treat Backpacks as independently developed projects, closest to plugins in ownership. Backpack interfaces, behavior, and implementation belong outside Papers' main binaries unless a concrete requirement genuinely needs a Papers-host change. A local Backpack is local in experience, implementation, and data; its ordinary development must not create a Papers version or update other machines.

My request:
[Describe what you want to experience.]`;

const elements = {
  status: document.querySelector('#status'),
  grid: document.querySelector('#icon-grid'),
  explorer: document.querySelector('#explorer'),
  empty: document.querySelector('#empty'),
  breadcrumbs: document.querySelector('#breadcrumbs'),
  location: document.querySelector('#location-select'),
  selectionStatus: document.querySelector('#selection-status'),
  menu: document.querySelector('#context-menu'),
  binButton: document.querySelector('#bin-button'),
  binLabel: document.querySelector('#bin-label'),
  binCount: document.querySelector('#bin-count'),
  editorLayer: document.querySelector('#editor-layer'),
  editor: document.querySelector('#editor'),
  editorTitle: document.querySelector('#editor-title'),
  editorError: document.querySelector('#editor-error'),
  name: document.querySelector('#name-input'),
  description: document.querySelector('#description-input'),
  descriptionLabel: document.querySelector('#description-label'),
  target: document.querySelector('#target-input'),
  targetFields: document.querySelector('#target-fields'),
  iconInput: document.querySelector('#icon-input'),
  iconPreview: document.querySelector('#icon-preview'),
  iconFallback: document.querySelector('#icon-fallback'),
  confirmLayer: document.querySelector('#confirm-layer'),
  confirmCopy: document.querySelector('#confirm-copy'),
};

const pending = new Map();
const iconCache = new Map();
let state = normalizeState({ schemaVersion: 1, groups: [], shortcuts: [] });
let currentId = ROOT_ID;
let selected = new Set();
let selectionAnchor = null;
let expanded = new Set();
let clipboard = null;
let editorMode = null;
let editorIcon = null;
let editorTargetIcon = null;
let binMode = false;
let dragIds = [];
let zoomTimer = null;
let saveQueue = Promise.resolve();

function request(type, detail = {}) {
  const requestId = crypto.randomUUID();
  window.parent.postMessage({ type, requestId, ...detail }, '*');
  return new Promise((resolve, reject) => pending.set(requestId, { resolve, reject }));
}

function setStatus(text = '') {
  elements.status.textContent = text;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }[character]));
}

function group(groupId) {
  return state.groups.find((candidate) => candidate.id === groupId) ?? null;
}

function shortcut(shortcutId) {
  return state.shortcuts.find((candidate) => candidate.id === shortcutId) ?? null;
}

function item(itemId) {
  return group(itemId) ?? shortcut(itemId);
}

function allGroups() {
  const result = [{ id: ROOT_ID, name: 'As you Go', depth: 0 }];
  const visit = (parentId, depth) => {
    for (const candidate of itemsIn(state, parentId).filter((entry) => entry.kind === 'group')) {
      result.push({ id: candidate.id, name: candidate.name, depth });
      visit(candidate.id, depth + 1);
    }
  };
  visit(ROOT_ID, 1);
  return result;
}

function pathTo(groupId) {
  const result = [];
  let cursor = group(groupId);
  while (cursor) {
    result.unshift({ id: cursor.id, name: cursor.name });
    cursor = group(cursor.parentId);
  }
  return [{ id: ROOT_ID, name: 'As you Go' }, ...result];
}

function iconMarkup(candidate) {
  if (candidate.kind === 'group') {
    return '<span class="folder-art" aria-hidden="true"><span></span></span>';
  }
  if (candidate.icon) {
    return `<img src="${escapeHtml(candidate.icon)}" alt="" />`;
  }
  return `<img data-default-icon="${candidate.id}" alt="" hidden /><span class="shortcut-fallback" aria-hidden="true">↗</span>`;
}

function descriptionMarkup(candidate) {
  return candidate.kind === 'shortcut' && candidate.description
    ? `<small>${escapeHtml(candidate.description)}</small>`
    : '';
}

function renderItems(parentId, depth = 0) {
  return itemsIn(state, parentId).map((candidate) => {
    const isSelected = selected.has(candidate.id);
    const canExpand = candidate.kind === 'group';
    const isExpanded = canExpand && expanded.has(candidate.id);
    const tile = `
      <div
        class="icon-item ${isSelected ? 'selected' : ''}"
        data-id="${candidate.id}"
        data-kind="${candidate.kind}"
        data-parent="${parentId}"
        draggable="true"
        role="option"
        aria-selected="${isSelected}"
        tabindex="-1"
      >
        ${canExpand ? `<button class="folder-expander ${isExpanded ? 'expanded' : ''}" data-expand="${candidate.id}" type="button" aria-label="${isExpanded ? 'Collapse' : 'Expand'} ${escapeHtml(candidate.name)}">›</button>` : ''}
        <div class="item-icon">${iconMarkup(candidate)}</div>
        <strong>${escapeHtml(candidate.name)}</strong>
        ${descriptionMarkup(candidate)}
      </div>`;
    if (!isExpanded) return tile;
    return `${tile}
      <section class="expanded-branch" data-branch-parent="${candidate.id}" style="--branch-depth:${depth + 1}">
        <div class="branch-heading">${escapeHtml(candidate.name)}</div>
        <div class="nested-icon-grid" data-blank-parent="${candidate.id}">
          ${renderItems(candidate.id, depth + 1)}
        </div>
      </section>`;
  }).join('');
}

function renderBinItems() {
  return binnedItems(state).map((candidate) => `
    <div
      class="icon-item ${selected.has(candidate.id) ? 'selected' : ''}"
      data-id="${candidate.id}"
      data-kind="${candidate.kind}"
      data-parent="bin"
      draggable="false"
      role="option"
      aria-selected="${selected.has(candidate.id)}"
      tabindex="-1"
    >
      <div class="item-icon">${iconMarkup(candidate)}</div>
      <strong>${escapeHtml(candidate.name)}</strong>
      ${descriptionMarkup(candidate)}
    </div>
  `).join('');
}

function optionMarkup() {
  return allGroups().map((candidate) => `
    <option value="${candidate.id}" ${candidate.id === currentId ? 'selected' : ''}>
      ${'— '.repeat(candidate.depth)}${escapeHtml(candidate.name)}
    </option>
  `).join('');
}

function render() {
  const iconSize = state.view.iconSize;
  document.documentElement.style.setProperty('--icon-size', `${iconSize}px`);
  elements.location.innerHTML = optionMarkup();
  elements.location.hidden = binMode;
  elements.breadcrumbs.innerHTML = binMode
    ? '<span class="bin-crumb">Bin</span>'
    : pathTo(currentId).map((candidate, index, path) =>
        `<button type="button" data-breadcrumb="${candidate.id}">${escapeHtml(candidate.name)}</button>${index < path.length - 1 ? '<span aria-hidden="true">›</span>' : ''}`,
      ).join('');

  const visible = binMode ? binnedItems(state) : itemsIn(state, currentId);
  elements.grid.innerHTML = binMode ? renderBinItems() : renderItems(currentId);
  elements.grid.dataset.blankParent = binMode ? 'bin' : currentId;
  elements.empty.hidden = visible.length !== 0;
  elements.empty.textContent = binMode
    ? 'The Bin is empty.'
    : 'This folder is empty. Left-click here to add something.';

  syncSelection();

  const binCount = binnedItems(state).length;
  elements.binCount.hidden = binCount === 0;
  elements.binCount.textContent = String(binCount);
  elements.binButton.setAttribute('aria-pressed', String(binMode));
  elements.binLabel.textContent = binMode ? 'Close Bin' : 'Bin';

  hydrateIcons();
}

function syncSelection() {
  document.querySelectorAll('.icon-item').forEach((tile) => {
    const isSelected = selected.has(tile.dataset.id);
    tile.classList.toggle('selected', isSelected);
    tile.setAttribute('aria-selected', String(isSelected));
  });
  elements.selectionStatus.hidden = selected.size === 0;
  elements.selectionStatus.textContent = selected.size === 1
    ? '1 item selected'
    : `${selected.size} items selected`;
}

async function hydrateIcons() {
  const images = [...document.querySelectorAll('[data-default-icon]')];
  await Promise.all(images.map(async (image) => {
    const shortcutId = image.dataset.defaultIcon;
    if (!iconCache.has(shortcutId)) {
      try {
        iconCache.set(
          shortcutId,
          await request('papers:project:as-you-go-shortcut-icon', { actionId: shortcutId }),
        );
      } catch {
        iconCache.set(shortcutId, null);
      }
    }
    const resolved = iconCache.get(shortcutId);
    if (!resolved || !image.isConnected) return;
    image.src = resolved;
    image.hidden = false;
    image.nextElementSibling?.setAttribute('hidden', '');
  }));
}

async function persist(nextState = state) {
  const snapshot = JSON.stringify(nextState);
  const operation = saveQueue
    .catch(() => undefined)
    .then(() => request('papers:project:as-you-go-save', { state: snapshot }));
  saveQueue = operation;
  await operation;
}

async function commit(nextState, success = '') {
  state = normalizeState(nextState);
  selected.clear();
  closeMenu();
  render();
  try {
    await persist(state);
    setStatus(success);
    return true;
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
    return false;
  }
}

function visibleItemIds() {
  return [...elements.grid.querySelectorAll('.icon-item')].map((node) => node.dataset.id);
}

function selectItem(itemId, event) {
  if (event.shiftKey && selectionAnchor) {
    const ids = visibleItemIds();
    const from = ids.indexOf(selectionAnchor);
    const to = ids.indexOf(itemId);
    if (from >= 0 && to >= 0) {
      if (!event.ctrlKey) selected.clear();
      const [start, end] = from < to ? [from, to] : [to, from];
      ids.slice(start, end + 1).forEach((id) => selected.add(id));
    }
  } else if (event.ctrlKey) {
    if (selected.has(itemId)) selected.delete(itemId);
    else selected.add(itemId);
    selectionAnchor = itemId;
  } else {
    selected = new Set([itemId]);
    selectionAnchor = itemId;
  }
  syncSelection();
}

function closeMenu() {
  elements.menu.hidden = true;
  elements.menu.innerHTML = '';
}

function menuButton(action, label, danger = false, disabled = false) {
  return `<button type="button" role="menuitem" data-action="${action}" class="${danger ? 'danger-text' : ''}" ${disabled ? 'disabled' : ''}>${label}</button>`;
}

function openMenu(x, y, kind = 'selection', parentId = currentId) {
  let content = '';
  if (kind === 'blank') {
    content = [
      menuButton('new-folder', 'New folder'),
      menuButton('new-shortcut', 'Add shortcut'),
      clipboard ? '<hr />' : '',
      clipboard ? menuButton('paste', clipboard.mode === 'cut' ? 'Paste moved items' : 'Paste copied items') : '',
    ].join('');
    elements.menu.dataset.parent = parentId;
  } else if (binMode) {
    content = [
      menuButton('restore', 'Restore'),
      menuButton('delete-forever', 'Delete permanently', true),
    ].join('');
  } else {
    const chosen = [...selected].map(item).filter(Boolean);
    const only = chosen.length === 1 ? chosen[0] : null;
    content = [
      only ? menuButton('open', only.target ? 'Open' : 'Open folder') : '',
      only?.target ? menuButton('edit', 'Edit shortcut') : '',
      only && !only.target ? menuButton('rename', 'Rename folder') : '',
      only ? '<hr />' : '',
      menuButton('copy', chosen.length > 1 ? 'Copy items' : 'Copy'),
      menuButton('cut', chosen.length > 1 ? 'Cut items' : 'Cut'),
      menuButton('bin', chosen.length > 1 ? 'Move items to Bin' : 'Move to Bin', true),
    ].join('');
  }
  elements.menu.innerHTML = content;
  elements.menu.hidden = false;
  const width = 210;
  const height = Math.min(300, elements.menu.scrollHeight);
  elements.menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - width - 8))}px`;
  elements.menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - height - 8))}px`;
  elements.menu.querySelector('button:not([disabled])')?.focus();
}

function currentSelectionParent() {
  const first = item([...selected][0]);
  return first?.parentId ?? currentId;
}

async function activate(itemId) {
  const folder = group(itemId);
  if (folder) {
    currentId = folder.id;
    binMode = false;
    selected.clear();
    expanded.clear();
    closeMenu();
    render();
    return;
  }
  if (shortcut(itemId)) {
    closeMenu();
    try {
      await request('papers:project:as-you-go-launch', { actionId: itemId });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }
}

async function copyOrCut(mode) {
  if (selected.size === 0) return;
  clipboard = { mode, ids: [...selected] };
  setStatus(`${selected.size} item${selected.size === 1 ? '' : 's'} ${mode === 'cut' ? 'cut' : 'copied'}.`);
  closeMenu();
}

async function pasteInto(parentId) {
  if (!clipboard || parentId === 'bin') return;
  try {
    const next = clipboard.mode === 'cut'
      ? moveSelection(state, clipboard.ids, parentId)
      : copySelection(state, clipboard.ids, parentId);
    const wasCut = clipboard.mode === 'cut';
    if (wasCut) clipboard = null;
    await commit(next, wasCut ? 'Moved.' : 'Copied.');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  }
}

function showIconPreview(source) {
  elements.iconPreview.hidden = !source;
  elements.iconFallback.hidden = Boolean(source);
  if (source) elements.iconPreview.src = source;
  else elements.iconPreview.removeAttribute('src');
}

async function resolveEditorTargetIcon() {
  if (editorIcon) return showIconPreview(editorIcon);
  if (editorTargetIcon) return showIconPreview(editorTargetIcon);
  if (editorMode?.item?.id) {
    try {
      editorTargetIcon = await request('papers:project:as-you-go-shortcut-icon', {
        actionId: editorMode.item.id,
      });
    } catch {
      editorTargetIcon = null;
    }
  }
  showIconPreview(editorTargetIcon);
}

function showEditor(kind, existing = null, parentId = currentId) {
  closeMenu();
  editorMode = { kind, item: existing, parentId };
  editorIcon = existing?.icon ?? null;
  editorTargetIcon = existing && !existing.icon ? iconCache.get(existing.id) ?? null : null;
  elements.editorTitle.textContent = kind === 'group'
    ? existing ? 'Rename folder' : 'New folder'
    : existing ? 'Edit shortcut' : 'Add shortcut';
  elements.name.value = existing?.name ?? '';
  elements.description.value = existing?.description ?? '';
  elements.target.value = existing?.target ?? '';
  elements.descriptionLabel.hidden = kind === 'group';
  elements.targetFields.hidden = kind === 'group';
  elements.iconInput.value = '';
  elements.editorError.textContent = '';
  elements.editorLayer.hidden = false;
  resolveEditorTargetIcon();
  elements.name.focus();
}

function hideEditor() {
  editorMode = null;
  editorIcon = null;
  editorTargetIcon = null;
  elements.editorLayer.hidden = true;
}

async function chooseTarget(kind) {
  try {
    const result = await request('papers:project:as-you-go-pick-target', { kind });
    if (!result) return;
    if (typeof result === 'string') {
      elements.target.value = result;
      editorTargetIcon = null;
    } else {
      if (!result.target) return;
      elements.target.value = result.target ?? '';
      editorTargetIcon = result.icon ?? null;
    }
    if (!editorIcon) showIconPreview(editorTargetIcon);
  } catch (error) {
    elements.editorError.textContent = error instanceof Error ? error.message : String(error);
  }
}

async function saveEditor() {
  if (!editorMode) return;
  const name = elements.name.value.trim();
  try {
    let next;
    if (editorMode.kind === 'group') {
      next = editorMode.item
        ? renameItem(state, editorMode.item.id, name)
        : createGroup(state, name, editorMode.parentId);
    } else {
      const changes = {
        name,
        description: elements.description.value.trim(),
        target: elements.target.value.trim(),
        icon: editorIcon,
      };
      next = editorMode.item
        ? updateShortcut(state, editorMode.item.id, changes)
        : createShortcut(state, { ...changes, parentId: editorMode.parentId });
    }
    const editedShortcutId = editorMode.kind === 'shortcut' ? editorMode.item?.id : null;
    const refreshTargetIcon = Boolean(
      editedShortcutId
      && (!editorIcon || editorMode.item?.target !== elements.target.value.trim()),
    );
    if (await commit(next, 'Saved.')) {
      if (refreshTargetIcon) {
        iconCache.delete(editedShortcutId);
        render();
      }
      hideEditor();
    }
  } catch (error) {
    elements.editorError.textContent = error instanceof Error ? error.message : String(error);
  }
}

async function moveToBin() {
  if (selected.size === 0) return;
  await commit(binSelection(state, [...selected]), 'Moved to Bin.');
}

function askPermanentDelete() {
  if (selected.size === 0) return;
  elements.confirmCopy.textContent = selected.size === 1
    ? `Delete “${item([...selected][0])?.name ?? 'this item'}” permanently? This cannot be undone.`
    : `Delete these ${selected.size} items permanently? This cannot be undone.`;
  elements.confirmLayer.hidden = false;
}

async function runMenuAction(action) {
  const onlyId = selected.size === 1 ? [...selected][0] : null;
  if (action === 'new-folder') return showEditor('group', null, elements.menu.dataset.parent);
  if (action === 'new-shortcut') return showEditor('shortcut', null, elements.menu.dataset.parent);
  if (action === 'paste') return pasteInto(elements.menu.dataset.parent);
  if (action === 'open' && onlyId) return activate(onlyId);
  if (action === 'edit' && onlyId) return showEditor('shortcut', shortcut(onlyId));
  if (action === 'rename' && onlyId) return showEditor('group', group(onlyId));
  if (action === 'copy') return copyOrCut('copy');
  if (action === 'cut') return copyOrCut('cut');
  if (action === 'bin') return moveToBin();
  if (action === 'restore') return commit(restoreSelection(state, [...selected]), 'Restored.');
  if (action === 'delete-forever') return askPermanentDelete();
}

elements.grid.addEventListener('click', (event) => {
  event.stopPropagation();
  const expandButton = event.target.closest('[data-expand]');
  if (expandButton) {
    const folderId = expandButton.dataset.expand;
    if (expanded.has(folderId)) expanded.delete(folderId);
    else expanded.add(folderId);
    closeMenu();
    render();
    return;
  }
  const tile = event.target.closest('.icon-item');
  if (tile) {
    selectItem(tile.dataset.id, event);
    openMenu(event.clientX, event.clientY);
    return;
  }
  const blank = event.target.closest('[data-blank-parent], [data-icon-grid]');
  if (blank && !binMode) {
    selected.clear();
    selectionAnchor = null;
    syncSelection();
    openMenu(event.clientX, event.clientY, 'blank', blank.dataset.blankParent ?? currentId);
  }
});

elements.grid.addEventListener('dblclick', (event) => {
  const tile = event.target.closest('.icon-item');
  if (tile) activate(tile.dataset.id);
});

elements.menu.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (button) runMenuAction(button.dataset.action);
});

document.addEventListener('click', (event) => {
  if (!elements.menu.hidden && !event.target.closest('#context-menu') && !event.target.closest('.icon-item')) {
    closeMenu();
  }
});

document.addEventListener('keydown', (event) => {
  if (!elements.editorLayer.hidden || !elements.confirmLayer.hidden) return;
  if (
    binMode
    && event.ctrlKey
    && ['c', 'x', 'v'].includes(event.key.toLowerCase())
  ) {
    event.preventDefault();
    return;
  }
  if (event.key === 'Escape') {
    selected.clear();
    closeMenu();
    syncSelection();
    return;
  }
  if (event.ctrlKey && event.key.toLowerCase() === 'c') {
    event.preventDefault();
    copyOrCut('copy');
  }
  if (event.ctrlKey && event.key.toLowerCase() === 'x') {
    event.preventDefault();
    copyOrCut('cut');
  }
  if (event.ctrlKey && event.key.toLowerCase() === 'v') {
    event.preventDefault();
    pasteInto(currentId);
  }
  if (event.key === 'Delete' && selected.size > 0) {
    event.preventDefault();
    if (binMode) askPermanentDelete();
    else moveToBin();
  }
  if (event.key === 'Enter' && selected.size === 1 && !binMode) {
    event.preventDefault();
    activate([...selected][0]);
  }
});

elements.explorer.addEventListener('wheel', (event) => {
  if (!event.ctrlKey) return;
  event.preventDefault();
  state = setIconSize(state, state.view.iconSize + (event.deltaY < 0 ? 12 : -12));
  render();
  clearTimeout(zoomTimer);
  zoomTimer = setTimeout(() => persist().catch((error) => setStatus(String(error))), 250);
}, { passive: false });

elements.grid.addEventListener('dragstart', (event) => {
  const tile = event.target.closest('.icon-item');
  if (!tile || binMode) return event.preventDefault();
  if (!selected.has(tile.dataset.id)) {
    selected = new Set([tile.dataset.id]);
    selectionAnchor = tile.dataset.id;
    syncSelection();
  }
  dragIds = [...selected];
  event.dataTransfer.effectAllowed = 'copyMove';
  event.dataTransfer.setData('text/plain', dragIds.join(','));
});

elements.grid.addEventListener('dragover', (event) => {
  if (binMode) return;
  event.preventDefault();
  document.querySelectorAll('.drop-inside, .drop-before').forEach((node) =>
    node.classList.remove('drop-inside', 'drop-before'));
  const tile = event.target.closest('.icon-item');
  if (!tile) return elements.grid.classList.add('drop-blank');
  elements.grid.classList.remove('drop-blank');
  const rect = tile.getBoundingClientRect();
  const nearEdge = event.clientX - rect.left < rect.width * 0.22;
  tile.classList.add(tile.dataset.kind === 'group' && !nearEdge ? 'drop-inside' : 'drop-before');
  event.dataTransfer.dropEffect = event.ctrlKey ? 'copy' : 'move';
});

elements.grid.addEventListener('dragleave', (event) => {
  if (!elements.grid.contains(event.relatedTarget)) {
    elements.grid.classList.remove('drop-blank');
    document.querySelectorAll('.drop-inside, .drop-before').forEach((node) =>
      node.classList.remove('drop-inside', 'drop-before'));
  }
});

elements.grid.addEventListener('drop', async (event) => {
  if (binMode || dragIds.length === 0) return;
  event.preventDefault();
  const tile = event.target.closest('.icon-item');
  const copy = event.ctrlKey;
  try {
    let next;
    if (tile?.classList.contains('drop-inside')) {
      next = copy
        ? copySelection(state, dragIds, tile.dataset.id)
        : moveSelection(state, dragIds, tile.dataset.id);
    } else if (tile) {
      if (dragIds.includes(tile.dataset.id)) return;
      if (copy) {
        next = copySelection(state, dragIds, tile.dataset.parent);
      } else {
        const moved = dragIds.every((itemId) => item(itemId)?.parentId === tile.dataset.parent)
          ? state
          : moveSelection(state, dragIds, tile.dataset.parent);
        const reorderIds = dragIds.filter((itemId) => {
          const candidate = moved.groups.find((entry) => entry.id === itemId)
            ?? moved.shortcuts.find((entry) => entry.id === itemId);
          return candidate?.parentId === tile.dataset.parent;
        });
        next = reorderSelection(moved, reorderIds, tile.dataset.parent, tile.dataset.id);
      }
    } else {
      const blank = event.target.closest('[data-blank-parent]');
      const destination = blank?.dataset.blankParent ?? currentId;
      next = copy
        ? copySelection(state, dragIds, destination)
        : moveSelection(state, dragIds, destination);
    }
    await commit(next, copy ? 'Copied.' : 'Moved.');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  } finally {
    dragIds = [];
    elements.grid.classList.remove('drop-blank');
  }
});

elements.location.addEventListener('change', (event) => {
  currentId = event.target.value;
  selected.clear();
  expanded.clear();
  render();
});

elements.breadcrumbs.addEventListener('click', (event) => {
  const crumb = event.target.closest('[data-breadcrumb]');
  if (!crumb) return;
  currentId = crumb.dataset.breadcrumb;
  selected.clear();
  expanded.clear();
  render();
});

elements.binButton.addEventListener('click', () => {
  binMode = !binMode;
  selected.clear();
  closeMenu();
  render();
});

elements.editor.addEventListener('submit', (event) => {
  event.preventDefault();
  saveEditor();
});
document.querySelector('#cancel-editor').addEventListener('click', hideEditor);
document.querySelector('#pick-file').addEventListener('click', () => chooseTarget('file'));
document.querySelector('#pick-folder').addEventListener('click', () => chooseTarget('folder'));
document.querySelector('#use-target-icon').addEventListener('click', () => {
  editorIcon = null;
  resolveEditorTargetIcon();
});
elements.iconInput.addEventListener('change', () => {
  const file = elements.iconInput.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    elements.editorError.textContent = 'Choose an image file.';
    return;
  }
  if (file.size > 750_000) {
    elements.editorError.textContent = 'That icon image is too large. Choose one under 750 KB.';
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    editorIcon = String(reader.result);
    elements.editorError.textContent = '';
    showIconPreview(editorIcon);
  };
  reader.readAsDataURL(file);
});

document.querySelector('#cancel-confirm').addEventListener('click', () => {
  elements.confirmLayer.hidden = true;
});
document.querySelector('#confirm-delete').addEventListener('click', async () => {
  const next = permanentlyDelete(state, [...selected]);
  elements.confirmLayer.hidden = true;
  await commit(next, 'Deleted permanently.');
});

document.querySelector('#copy-prompt').addEventListener('click', async () => {
  try {
    await request('papers:project:copy-text', { text: PICKUP_PROMPT });
    document.querySelector('.copy-label').textContent = 'Copied';
    setTimeout(() => {
      document.querySelector('.copy-label').textContent = 'Copy agent pickup prompt';
    }, 1800);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  }
});

window.addEventListener('message', (event) => {
  if (event.source !== window.parent || event.data?.type !== 'papers:host:result') return;
  const task = pending.get(event.data.requestId);
  if (!task) return;
  pending.delete(event.data.requestId);
  if (!event.data.ok) {
    task.reject(new Error(event.data.error || 'The request could not be completed.'));
    return;
  }
  if ('target' in event.data && 'icon' in event.data) {
    task.resolve({ target: event.data.target, icon: event.data.icon });
    return;
  }
  task.resolve(event.data.state ?? event.data.icon ?? event.data.target ?? undefined);
});

(async () => {
  try {
    const loaded = await request('papers:project:as-you-go-load');
    state = normalizeState(typeof loaded === 'string' ? JSON.parse(loaded) : loaded);
    render();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
    render();
  }
})();

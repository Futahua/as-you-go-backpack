import {
  ROOT_ID,
  binSelection,
  binnedItems,
  copySelection,
  createGroup,
  createDroppedShortcuts,
  createShortcut,
  createWebLink,
  isWebLink,
  itemsIntersectingMarquee,
  itemsIn,
  moveSelection,
  normalizeState,
  permanentlyDelete,
  renameItem,
  reorderSelection,
  restoreSelection,
  setIconSize,
  updateGroup,
  updateShortcut,
  updateWebLink,
  updateWorkspaceView,
  webLinkIcon,
} from './workspace-model-20260730b.js';

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
  marquee: document.querySelector('#selection-marquee'),
  empty: document.querySelector('#empty'),
  breadcrumbs: document.querySelector('#breadcrumbs'),
  deleteAllBin: document.querySelector('#delete-all-bin'),
  selectionStatus: document.querySelector('#selection-status'),
  menu: document.querySelector('#context-menu'),
binButton: document.querySelector('#bin-button'),
  binLabel: document.querySelector('#bin-label'),
  binCount: document.querySelector('#bin-count'),
  graphButton: document.querySelector('#graph-view-button'),
  graphLabel: document.querySelector('#graph-label'),
  editorLayer: document.querySelector('#editor-layer'),
  editor: document.querySelector('#editor'),
  saveButton: document.querySelector('#save-editor'),
  editorTitle: document.querySelector('#editor-title'),
  editorError: document.querySelector('#editor-error'),
  name: document.querySelector('#name-input'),
  description: document.querySelector('#description-input'),
  descriptionLabel: document.querySelector('#description-label'),
  target: document.querySelector('#target-input'),
  targetFields: document.querySelector('#target-fields'),
  targetActions: document.querySelector('#target-actions'),
  iconInput: document.querySelector('#icon-input'),
  iconPreview: document.querySelector('#icon-preview'),
  iconFallback: document.querySelector('#icon-fallback'),
  iconDefaultButton: document.querySelector('#use-target-icon'),
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
let layout = 'explorer';
let dragIds = [];
let marqueeDrag = null;
let suppressBlankClick = false;
let pendingPermanentIds = [];
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

function isAvailableItem(itemId) {
  const candidate = item(itemId);
  if (!candidate || candidate.bin) return false;
  let parent = group(candidate.parentId);
  while (parent) {
    if (parent.bin) return false;
    parent = group(parent.parentId);
  }
  return true;
}

function captureWorkspaceView() {
  state = updateWorkspaceView(state, {
    currentGroupId: currentId,
    expandedGroupIds: [...expanded],
    selectedItemIds: [...selected],
    binMode,
    layout,
  });
}

function restoreWorkspaceView() {
  const requestedCurrent = state.view.currentGroupId;
  currentId =
    requestedCurrent === ROOT_ID || (group(requestedCurrent) && isAvailableItem(requestedCurrent))
      ? requestedCurrent
      : ROOT_ID;
  expanded = new Set(
    state.view.expandedGroupIds.filter((groupId) =>
      Boolean(group(groupId)) && isAvailableItem(groupId)),
  );
  binMode = state.view.binMode;
  layout = state.view.layout === 'graph' ? 'graph' : 'explorer';
  const binnedIds = new Set(binnedItems(state).map((candidate) => candidate.id));
  selected = new Set(
    state.view.selectedItemIds.filter((itemId) =>
      binMode ? binnedIds.has(itemId) : isAvailableItem(itemId)),
  );
  selectionAnchor = [...selected].at(-1) ?? null;
  captureWorkspaceView();
}

function saveWorkspaceView() {
  captureWorkspaceView();
  void persist(state).catch((error) =>
    setStatus(error instanceof Error ? error.message : String(error)));
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
    if (candidate.icon) {
      return `<img src="${escapeHtml(candidate.icon)}" alt="" />`;
    }
    return '<span class="folder-art" aria-hidden="true"><span></span></span>';
  }
  if (candidate.icon) {
    return `<img src="${escapeHtml(candidate.icon)}" alt="" />`;
  }
  if (isWebLink(candidate)) {
    return `<img data-web-icon="${escapeHtml(webLinkIcon(candidate))}" alt="" hidden /><span class="shortcut-fallback" aria-hidden="true">↗</span>`;
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

function renderGraph() {
  const visible = binMode ? binnedItems(state) : itemsIn(state, currentId);
  elements.grid.classList.add('graph-view');
  if (visible.length === 0) {
    elements.grid.innerHTML = '';
    return;
  }

  const iconSize = state.view.iconSize;
  const nodeWidth = iconSize + 42;
  const rowHeight = iconSize + 64;
  const columnWidth = nodeWidth + 110;
  const padding = 28;
  let nextLeaf = 0;
  let maxDepth = 0;
  const placed = new Map();

  function place(itemId, depth) {
    const candidate = item(itemId);
    if (!candidate) return;
    if (depth > maxDepth) maxDepth = depth;
    const isExpanded =
      !binMode
      && candidate.kind === 'group'
      && expanded.has(candidate.id);
    const childItems = isExpanded ? itemsIn(state, candidate.id) : [];
    if (childItems.length === 0) {
      placed.set(candidate.id, {
        candidate, depth, y: nextLeaf, expanded: false, childCount: 0,
      });
      nextLeaf += 1;
      return;
    }
    const firstIndex = nextLeaf;
    for (const child of childItems) place(child.id, depth + 1);
    const lastIndex = nextLeaf - 1;
    placed.set(candidate.id, {
      candidate,
      depth,
      y: (firstIndex + lastIndex) / 2,
      expanded: true,
      childCount: childItems.length,
    });
  }

  for (const top of visible) place(top.id, 0);

  const totalRows = Math.max(1, nextLeaf);
  const contentWidth = padding * 2 + (maxDepth + 1) * columnWidth;
  const contentHeight = padding * 2 + totalRows * rowHeight;

  const xFor = (depth) => padding + depth * columnWidth;
  const yFor = (row) => padding + row * rowHeight + rowHeight / 2;

  let edges = '';
  for (const node of placed.values()) {
    if (!node.expanded) continue;
    const px = xFor(node.depth) + nodeWidth;
    const py = yFor(node.y);
    for (const child of itemsIn(state, node.candidate.id)) {
      const childNode = placed.get(child.id);
      if (!childNode) continue;
      const cx = xFor(childNode.depth);
      const cy = yFor(childNode.y);
      const dx = Math.max(24, (cx - px) / 2);
      edges += `<path class="graph-edge" d="M ${px} ${py} C ${px + dx} ${py}, ${cx - dx} ${cy}, ${cx} ${cy}" />`;
    }
  }

  const nodes = [...placed.values()].map((node) => {
    const candidate = node.candidate;
    const isSelected = selected.has(candidate.id);
    const canExpand = candidate.kind === 'group' && !binMode;
    const isExpanded = canExpand && expanded.has(candidate.id);
    const left = xFor(node.depth);
    const top = yFor(node.y) - rowHeight / 2;
    const draggable = binMode ? 'false' : 'true';
    return `
      <div
        class="icon-item ${isSelected ? 'selected' : ''}"
        data-id="${candidate.id}"
        data-kind="${candidate.kind}"
        data-parent="${binMode ? 'bin' : (candidate.parentId ?? currentId)}"
        draggable="${draggable}"
        role="option"
        aria-selected="${isSelected}"
        tabindex="-1"
        style="left:${left}px;top:${top}px;width:${nodeWidth}px;"
      >
        ${canExpand ? `<button class="folder-expander ${isExpanded ? 'expanded' : ''}" data-expand="${candidate.id}" type="button" aria-label="${isExpanded ? 'Collapse' : 'Expand'} ${escapeHtml(candidate.name)}">›</button>` : ''}
        <div class="item-icon">${iconMarkup(candidate)}</div>
        <strong>${escapeHtml(candidate.name)}</strong>
        ${descriptionMarkup(candidate)}
      </div>`;
  }).join('');

  elements.grid.innerHTML = `<svg class="graph-edges" width="${contentWidth}" height="${contentHeight}" aria-hidden="true">${edges}</svg>${nodes}`;
}

function render() {
  const iconSize = state.view.iconSize;
  document.documentElement.style.setProperty('--icon-size', `${iconSize}px`);
  elements.breadcrumbs.innerHTML = binMode
    ? '<span class="bin-crumb">Bin</span>'
    : pathTo(currentId).map((candidate, index, path) =>
        `<button type="button" data-breadcrumb="${candidate.id}">${escapeHtml(candidate.name)}</button>${index < path.length - 1 ? '<span aria-hidden="true">›</span>' : ''}`,
      ).join('');

  const visible = binMode ? binnedItems(state) : itemsIn(state, currentId);
  elements.grid.dataset.blankParent = binMode ? 'bin' : currentId;
  if (layout === 'graph') {
    renderGraph();
  } else {
    elements.grid.classList.remove('graph-view');
    elements.grid.innerHTML = binMode ? renderBinItems() : renderItems(currentId);
  }
  elements.empty.hidden = visible.length !== 0;
  elements.empty.textContent = binMode
    ? 'The Bin is empty.'
    : 'This folder is empty. Right-click here to add something.';

  syncSelection();

  const binCount = binnedItems(state).length;
  elements.binCount.hidden = binCount === 0;
  elements.binCount.textContent = String(binCount);
  elements.binButton.setAttribute('aria-pressed', String(binMode));
  elements.binLabel.textContent = binMode ? 'Close Bin' : 'Bin';
  elements.graphButton.setAttribute('aria-pressed', String(layout === 'graph'));
  elements.graphLabel.textContent = layout === 'graph' ? 'Explorer' : 'Graph';
  elements.deleteAllBin.hidden = !binMode || binCount === 0;

  hydrateIcons();
  hydrateWebIcons();
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

function hydrateWebIcons() {
  document.querySelectorAll('[data-web-icon]').forEach((image) => {
    image.addEventListener('load', () => {
      image.hidden = false;
      image.nextElementSibling?.setAttribute('hidden', '');
    }, { once: true });
    image.addEventListener('error', () => {
      image.hidden = true;
      image.nextElementSibling?.removeAttribute('hidden');
    }, { once: true });
    image.src = image.dataset.webIcon;
  });
}

async function persist(nextState = state) {
  const snapshot = JSON.stringify(nextState);
  const operation = saveQueue
    .catch(() => undefined)
    .then(() => request('papers:project:as-you-go-save', { state: snapshot }));
  saveQueue = operation;
  await operation;
}

async function commit(nextState) {
  state = normalizeState(nextState);
  selected.clear();
  captureWorkspaceView();
  closeMenu();
  render();
  try {
    await persist(state);
    setStatus('');
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
  saveWorkspaceView();
}

function marqueeBounds(startX, startY, endX, endY) {
  return {
    left: Math.min(startX, endX),
    top: Math.min(startY, endY),
    right: Math.max(startX, endX),
    bottom: Math.max(startY, endY),
  };
}

function showMarquee(bounds) {
  const explorerBounds = elements.explorer.getBoundingClientRect();
  elements.marquee.hidden = false;
  elements.marquee.style.left = `${bounds.left - explorerBounds.left}px`;
  elements.marquee.style.top = `${bounds.top - explorerBounds.top}px`;
  elements.marquee.style.width = `${bounds.right - bounds.left}px`;
  elements.marquee.style.height = `${bounds.bottom - bounds.top}px`;
}

function updateMarqueeSelection(bounds) {
  const tiles = [...elements.grid.querySelectorAll('.icon-item')]
    .map((tile) => {
      const rectangle = tile.getBoundingClientRect();
      return {
        id: tile.dataset.id,
        left: rectangle.left,
        top: rectangle.top,
        right: rectangle.right,
        bottom: rectangle.bottom,
      };
    })
    .filter((tile) => tile.right > tile.left && tile.bottom > tile.top);
  selected = new Set([
    ...marqueeDrag.baseSelection,
    ...itemsIntersectingMarquee(tiles, bounds),
  ]);
  syncSelection();
}

function finishMarquee(event) {
  if (!marqueeDrag || event.pointerId !== marqueeDrag.pointerId) return;
  if (elements.grid.hasPointerCapture(event.pointerId)) {
    elements.grid.releasePointerCapture(event.pointerId);
  }
  suppressBlankClick = marqueeDrag.moved;
  if (marqueeDrag.moved) saveWorkspaceView();
  marqueeDrag = null;
  elements.marquee.hidden = true;
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
      menuButton('new-web-link', 'Add web link'),
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
      only?.target ? menuButton('edit', isWebLink(only) ? 'Edit web link' : 'Edit shortcut') : '',
      only && !only.target ? menuButton('rename', 'Edit folder') : '',
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
    saveWorkspaceView();
    return;
  }
  if (shortcut(itemId)) {
    closeMenu();
    try {
      const chosen = shortcut(itemId);
      if (isWebLink(chosen)) {
        await request('papers:project:open-web-link', { url: chosen.target });
      } else {
        await request('papers:project:as-you-go-launch', { actionId: itemId });
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }
}

async function copyOrCut(mode) {
  if (selected.size === 0) return;
  clipboard = { mode, ids: [...selected] };
  setStatus('');
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

function readAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('That image could not be read.'));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

function canvasBlob(canvas, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
}

async function compressIconFile(file) {
  const maximumDimension = 512;
  const targetBytes = 500_000;
  const bitmap = await createImageBitmap(file);
  try {
    if (
      file.size <= targetBytes
      && bitmap.width <= maximumDimension
      && bitmap.height <= maximumDimension
    ) {
      return readAsDataUrl(file);
    }

    const initialScale = Math.min(
      1,
      maximumDimension / Math.max(bitmap.width, bitmap.height),
    );
    let width = Math.max(1, Math.round(bitmap.width * initialScale));
    let height = Math.max(1, Math.round(bitmap.height * initialScale));
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image compression is unavailable.');

    for (let sizeAttempt = 0; sizeAttempt < 5; sizeAttempt += 1) {
      canvas.width = width;
      canvas.height = height;
      context.clearRect(0, 0, width, height);
      context.drawImage(bitmap, 0, 0, width, height);
      for (const quality of [0.9, 0.78, 0.65, 0.5]) {
        const compressed = await canvasBlob(canvas, quality);
        if (compressed && compressed.size <= targetBytes) {
          return readAsDataUrl(compressed);
        }
      }
      width = Math.max(32, Math.round(width * 0.75));
      height = Math.max(32, Math.round(height * 0.75));
    }
    throw new Error('That image could not be compressed enough for an icon.');
  } finally {
    bitmap.close();
  }
}

async function resolveEditorTargetIcon() {
  if (editorIcon) return showIconPreview(editorIcon);
  if (editorTargetIcon) return showIconPreview(editorTargetIcon);
  if (editorMode?.kind === 'web') {
    return showIconPreview(webLinkIcon({ target: elements.target.value.trim() }));
  }
  if (editorMode?.kind === 'shortcut' && editorMode.item?.id) {
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
  editorTargetIcon =
    kind === 'web' && existing && !existing.icon
      ? webLinkIcon(existing)
      : kind === 'shortcut' && existing && !existing.icon
      ? iconCache.get(existing.id) ?? null
      : null;
  elements.editorTitle.textContent = kind === 'group'
    ? existing ? 'Edit folder' : 'New folder'
    : kind === 'web'
      ? existing ? 'Edit web link' : 'Add web link'
      : existing ? 'Edit shortcut' : 'Add shortcut';
  elements.name.value = existing?.name ?? '';
  elements.description.value = existing?.description ?? '';
  elements.target.value = existing?.target ?? '';
  elements.descriptionLabel.hidden = kind === 'group';
  elements.targetFields.hidden = kind === 'group';
  elements.target.readOnly = kind !== 'web';
  elements.target.placeholder = kind === 'web' ? 'https://example.com' : '';
  elements.targetActions.hidden = kind === 'web';
  elements.iconFallback.textContent = kind === 'group' ? '▰' : '↗';
  elements.iconDefaultButton.textContent =
    kind === 'group' ? 'Use folder icon' : kind === 'web' ? 'Use website icon' : 'Use target icon';
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
  if (!editorMode || elements.saveButton.disabled) return;
  elements.saveButton.disabled = true;
  elements.saveButton.textContent = 'Saving…';
  const name = elements.name.value.trim();
  try {
    let next;
    if (editorMode.kind === 'group') {
      next = editorMode.item
        ? updateGroup(state, editorMode.item.id, { name, icon: editorIcon })
        : createGroup(state, name, editorMode.parentId, editorIcon);
    } else {
      const changes = {
        name,
        description: elements.description.value.trim(),
        target: elements.target.value.trim(),
        icon: editorIcon,
      };
      next = editorMode.kind === 'web'
        ? editorMode.item
          ? updateWebLink(state, editorMode.item.id, changes)
          : createWebLink(state, { ...changes, parentId: editorMode.parentId })
        : editorMode.item
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
  } finally {
    elements.saveButton.disabled = false;
    elements.saveButton.textContent = 'Save';
  }
}

async function moveToBin() {
  if (selected.size === 0) return;
  await commit(binSelection(state, [...selected]), 'Moved to Bin.');
}

function askPermanentDelete(ids = [...selected], deletingAll = false) {
  if (ids.length === 0) return;
  pendingPermanentIds = [...ids];
  elements.confirmCopy.textContent = deletingAll
    ? `Delete all ${ids.length} items permanently? This cannot be undone.`
    : ids.length === 1
      ? `Delete “${item(ids[0])?.name ?? 'this item'}” permanently? This cannot be undone.`
      : `Delete these ${ids.length} items permanently? This cannot be undone.`;
  elements.confirmLayer.hidden = false;
}

async function runMenuAction(action) {
  const onlyId = selected.size === 1 ? [...selected][0] : null;
  if (action === 'new-folder') return showEditor('group', null, elements.menu.dataset.parent);
  if (action === 'new-shortcut') return showEditor('shortcut', null, elements.menu.dataset.parent);
  if (action === 'new-web-link') return showEditor('web', null, elements.menu.dataset.parent);
  if (action === 'paste') return pasteInto(elements.menu.dataset.parent);
  if (action === 'open' && onlyId) return activate(onlyId);
  if (action === 'edit' && onlyId) {
    const chosen = shortcut(onlyId);
    return showEditor(isWebLink(chosen) ? 'web' : 'shortcut', chosen);
  }
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
    saveWorkspaceView();
    return;
  }
  const tile = event.target.closest('.icon-item');
  if (tile) {
    selectItem(tile.dataset.id, event);
    return;
  }
  const blank = event.target.closest('[data-blank-parent], [data-icon-grid]');
  if (blank) {
    if (suppressBlankClick) {
      suppressBlankClick = false;
      return;
    }
    selected.clear();
    selectionAnchor = null;
    syncSelection();
    closeMenu();
    saveWorkspaceView();
  }
});

elements.grid.addEventListener('pointerdown', (event) => {
  if (
    event.button !== 0
    || event.target.closest('.icon-item')
    || !event.target.closest('[data-blank-parent], [data-icon-grid]')
  ) return;

  closeMenu();
  marqueeDrag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    baseSelection: event.ctrlKey ? new Set(selected) : new Set(),
    moved: false,
  };
  if (!event.ctrlKey) {
    selected.clear();
    selectionAnchor = null;
    syncSelection();
  }
  elements.grid.setPointerCapture(event.pointerId);
  event.preventDefault();
});

elements.grid.addEventListener('pointermove', (event) => {
  if (!marqueeDrag || event.pointerId !== marqueeDrag.pointerId) return;
  const bounds = marqueeBounds(
    marqueeDrag.startX,
    marqueeDrag.startY,
    event.clientX,
    event.clientY,
  );
  if (!marqueeDrag.moved && bounds.right - bounds.left < 3 && bounds.bottom - bounds.top < 3) {
    return;
  }
  marqueeDrag.moved = true;
  showMarquee(bounds);
  updateMarqueeSelection(bounds);
});

elements.grid.addEventListener('pointerup', finishMarquee);
elements.grid.addEventListener('pointercancel', finishMarquee);

elements.grid.addEventListener('dblclick', (event) => {
  const tile = event.target.closest('.icon-item');
  if (tile) activate(tile.dataset.id);
});

elements.grid.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  event.stopPropagation();
  const tile = event.target.closest('.icon-item');
  if (tile) {
    if (!selected.has(tile.dataset.id)) {
      selected = new Set([tile.dataset.id]);
      selectionAnchor = tile.dataset.id;
      syncSelection();
      saveWorkspaceView();
    }
    openMenu(event.clientX, event.clientY);
    return;
  }
  if (binMode) return closeMenu();
  const blank = event.target.closest('[data-blank-parent], [data-icon-grid]');
  if (!blank) return;
  selected.clear();
  selectionAnchor = null;
  syncSelection();
  openMenu(
    event.clientX,
    event.clientY,
    'blank',
    blank.dataset.blankParent ?? currentId,
  );
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
    saveWorkspaceView();
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
    saveWorkspaceView();
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
  if (event.dataTransfer.types.includes('Files')) {
    elements.grid.classList.toggle('drop-blank', tile?.dataset.kind !== 'group');
    if (tile?.dataset.kind === 'group') tile.classList.add('drop-inside');
    event.dataTransfer.dropEffect = 'link';
    return;
  }
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
  if (binMode) return;
  const droppedFiles = [...event.dataTransfer.files];
  if (droppedFiles.length > 0) {
    event.preventDefault();
    const tile = event.target.closest('.icon-item');
    const blank = event.target.closest('[data-blank-parent]');
    const destination = tile?.dataset.kind === 'group'
      ? tile.dataset.id
      : blank?.dataset.blankParent ?? tile?.dataset.parent ?? currentId;
    try {
      const targets = await request('papers:project:resolve-dropped-targets', {
        files: droppedFiles,
      });
      const next = createDroppedShortcuts(state, targets, destination);
      if (next.shortcuts.length === state.shortcuts.length) {
        setStatus('Those shortcuts already exist here.');
        return;
      }
      await commit(next);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      elements.grid.classList.remove('drop-blank');
      document.querySelectorAll('.drop-inside, .drop-before').forEach((node) =>
        node.classList.remove('drop-inside', 'drop-before'));
    }
    return;
  }
  if (dragIds.length === 0) return;
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

elements.breadcrumbs.addEventListener('click', (event) => {
  const crumb = event.target.closest('[data-breadcrumb]');
  if (!crumb) return;
  currentId = crumb.dataset.breadcrumb;
  selected.clear();
  expanded.clear();
  render();
  saveWorkspaceView();
});

elements.binButton.addEventListener('click', () => {
  binMode = !binMode;
  selected.clear();
  closeMenu();
  render();
  saveWorkspaceView();
});
elements.graphButton.addEventListener('click', () => {
  layout = layout === 'graph' ? 'explorer' : 'graph';
  selected.clear();
  closeMenu();
  render();
  saveWorkspaceView();
});
elements.deleteAllBin.addEventListener('click', () => {
  askPermanentDelete(binnedItems(state).map((candidate) => candidate.id), true);
});

elements.editor.addEventListener('submit', (event) => {
  event.preventDefault();
  void saveEditor();
});
const saveButton = elements.saveButton;
saveButton.addEventListener('click', () => void saveEditor());
document.querySelector('#cancel-editor').addEventListener('click', hideEditor);
document.querySelector('#pick-file').addEventListener('click', () => chooseTarget('file'));
document.querySelector('#pick-folder').addEventListener('click', () => chooseTarget('folder'));
elements.iconDefaultButton.addEventListener('click', () => {
  editorIcon = null;
  if (editorMode?.kind === 'group') editorTargetIcon = null;
  if (editorMode?.kind === 'web') {
    editorTargetIcon = webLinkIcon({ target: elements.target.value.trim() });
  }
  resolveEditorTargetIcon();
});
elements.target.addEventListener('input', () => {
  if (editorMode?.kind !== 'web' || editorIcon) return;
  editorTargetIcon = webLinkIcon({ target: elements.target.value.trim() });
  showIconPreview(editorTargetIcon);
});
elements.iconInput.addEventListener('change', async () => {
  const file = elements.iconInput.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    elements.editorError.textContent = 'Choose an image file.';
    return;
  }
  elements.saveButton.disabled = true;
  elements.editorError.textContent = 'Preparing icon…';
  try {
    editorIcon = await compressIconFile(file);
    elements.editorError.textContent = '';
    showIconPreview(editorIcon);
  } catch (error) {
    elements.editorError.textContent =
      error instanceof Error ? error.message : String(error);
  } finally {
    elements.saveButton.disabled = false;
  }
});

document.querySelector('#cancel-confirm').addEventListener('click', () => {
  pendingPermanentIds = [];
  elements.confirmLayer.hidden = true;
});
document.querySelector('#confirm-delete').addEventListener('click', async () => {
  const next = permanentlyDelete(state, pendingPermanentIds);
  pendingPermanentIds = [];
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
  task.resolve(
    event.data.state
    ?? event.data.icon
    ?? event.data.target
    ?? event.data.targets
    ?? undefined,
  );
});

(async () => {
  try {
    const loaded = await request('papers:project:as-you-go-load');
    state = normalizeState(typeof loaded === 'string' ? JSON.parse(loaded) : loaded);
    restoreWorkspaceView();
    render();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
    render();
  }
})();

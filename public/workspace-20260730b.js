import {
  ROOT_ID,
  binSelection,
  binnedItems,
  itemsInBinnedGroup,
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
  restoreSelection,
  setIconSize,
  updateGroup,
  updateShortcut,
  updateWebLink,
  updateWorkspaceView,
  graphContextId,
  getGraphPosition,
  setGraphPositions,
  removeGraphPositions,
  setToolbarPosition,
  getToolbarPosition,
  forkPlacement,
  collapsePlacements,
  placementCount,
} from './workspace-model-20260730b.js';

import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCollide,
  forceX,
  forceY,
} from './vendor/d3-force.js';
import { zoom, zoomIdentity, zoomTransform } from './vendor/d3-zoom.js';
import { select } from './vendor/d3-selection.js';
import { visibleGraphItems, graphEdges, binOriginEdges, seedPosition } from './graph-model-20260730b.js';
import { hydrateIcons as hydrateIconsScoped, hydrateWebPreview } from './web-link-icon-20260730b.js';
import { createHostBridge } from './app/host/host-bridge.js';
import { compressIconFile } from './app/utilities/image-compression.js';
import { getWorkspaceElements } from './app/dom.js';
import { createToolbarController } from './app/components/toolbar-controller.js';

const host = createHostBridge(window);

const PICKUP_PROMPT = `You are picking up Papers and its Backpack projects.

Canonical Papers repository: https://github.com/Futahua/Papers-3
Primary-machine source checkout: D:\\Letters\\MatTroiSeConMoc\\PAPERS 3\\Papers-3

Before acting, read AGENTS.md and HERMES.md completely from the current repository, then follow the document map in README.md. Treat those current files as authoritative over this copied orientation.

I do not code or design technical architecture. I describe the experience I want; you must construct it, test it, protect my data, and explain the result in plain language. Clicking buttons, entering information, choosing files, opening applications, organizing work, and confirming actions are normal use—not configuration or permission to invent editors, frameworks, or product-wide abstractions.

Treat Backpacks as independently developed projects, closest to plugins in ownership. Backpack interfaces, behavior, and implementation belong outside Papers' main binaries unless a concrete requirement genuinely needs a Papers-host change. A local Backpack is local in experience, implementation, and data; its ordinary development must not create a Papers version or update other machines.

My request:
[Describe what you want to experience.]`;

const elements = getWorkspaceElements(document);

const iconCache = new Map();
let state = normalizeState({ schemaVersion: 1, groups: [], shortcuts: [] });
let undoStack = [];
let redoStack = [];
let currentId = ROOT_ID;
let selected = new Set();
let selectionAnchor = null;
let graphExpanded = new Set();
let clipboard = null;
let editorMode = null;
let editorIcon = null;
let editorTargetIcon = null;
let binMode = false;
let binCurrentId = 'bin';
let marqueeDrag = null;
let suppressBlankClick = false;
let suppressGraphClick = false;
let pendingPermanentIds = [];
let pendingRestoreIds = [];
let zoomTimer = null;
let saveQueue = Promise.resolve();
let graphDrag = null;
let graphShiftKeydown = null;
let graphShiftKeyup = null;

function installGraphShiftListeners() {
  if (graphShiftKeydown) return;
  graphShiftKeydown = (event) => {
    if (event.key === 'Shift' && graphDrag) {
      graphDrag.pinOnRelease = true;
      for (const id of graphDrag.itemIds) {
        const node = graph._getNode(id);
        if (node?.shell) {
          node.shell.classList.remove('will-release');
          node.shell.classList.add('will-pin');
        }
      }
    }
  };
  graphShiftKeyup = (event) => {
    if (event.key === 'Shift' && graphDrag) {
      graphDrag.pinOnRelease = false;
      for (const id of graphDrag.itemIds) {
        const node = graph._getNode(id);
        if (node?.shell) {
          node.shell.classList.remove('will-pin');
          node.shell.classList.add('will-release');
        }
      }
    }
  };
  window.addEventListener('keydown', graphShiftKeydown, { capture: true });
  window.addEventListener('keyup', graphShiftKeyup, { capture: true });
}

function removeGraphShiftListeners() {
  if (graphShiftKeydown) {
    window.removeEventListener('keydown', graphShiftKeydown, { capture: true });
    graphShiftKeydown = null;
  }
  if (graphShiftKeyup) {
    window.removeEventListener('keyup', graphShiftKeyup, { capture: true });
    graphShiftKeyup = null;
  }
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

/** Resolves a shortcut by either its shared record id or one of its
 * placement ids — bin-mode graph tiles are keyed by placement id (each
 * binned placement is its own independent tile), so looking a bin
 * shortcut tile up by shortcut() alone (which only matches the record id)
 * always misses. */
function shortcutByRecordOrPlacementId(candidateId) {
  return shortcut(candidateId)
    ?? state.shortcuts.find((record) => record.placements.some((placement) => placement.id === candidateId))
    ?? null;
}

/** Any one active (non-bin) placement id belonging to the given shortcut
 * identity — enough for the model layer's placement-scoped functions
 * (copySelection/moveSelection/collapsePlacements) to find the record. */
function anyActivePlacementId(shortcutId) {
  const record = shortcut(shortcutId);
  return record?.placements.find((placement) => !placement.bin)?.id ?? null;
}

function allActivePlacementIds(shortcutId) {
  const record = shortcut(shortcutId);
  return record?.placements.filter((placement) => !placement.bin).map((placement) => placement.id) ?? [];
}

/** The specific placement the user is currently looking at for this
 * shortcut — the one matching its visible parent in the currently
 * rendered graph node, falling back to any active placement if the node
 * isn't on screen. Must be resolved at gesture-start time (copy/cut,
 * drag start, bin move, editor open), not at commit time, since
 * navigation or selection changes between gesture and commit shouldn't
 * change which placement the action targets. */
function visiblePlacementIdFor(shortcutId) {
  const record = shortcut(shortcutId);
  const visibleParentId = graph._getNode(shortcutId)?.parentIds?.[0];

  return record?.placements.find((placement) =>
    !placement.bin
    && (!visibleParentId || placement.parentId === visibleParentId)
  )?.id ?? anyActivePlacementId(shortcutId);
}

/** Resolves a Bin-context id — a group id, or one specific placement id —
 * to its display name. Used for the Bin, where a tile's own id is the
 * placement, not the shared shortcut identity. */
function binItemName(binItemId) {
  const asGroup = group(binItemId);
  if (asGroup) return asGroup.name;
  const owner = state.shortcuts.find((candidate) =>
    candidate.placements.some((placement) => placement.id === binItemId));
  return owner?.name ?? null;
}

/** How many distinct folders the given shortcut is currently shown linked
 * into, in the graph node currently on screen for it — this is what decides
 * whether cutting it collapses every placement into one, or only moves the
 * one this view represents (per the creator's rule: 2+ visible edges means
 * "act on the whole shared thing," exactly 1 means "act on this location"). */
function visibleParentCountFor(shortcutId) {
  const node = graph._getNode(shortcutId);
  return node?.parentIds?.length ?? 1;
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
    graphExpandedGroupIds: [...graphExpanded],
    selectedItemIds: [...selected],
    binMode,
  });
}

function restoreWorkspaceView() {
  const requestedCurrent = state.view.currentGroupId;
  currentId =
    requestedCurrent === ROOT_ID || (group(requestedCurrent) && isAvailableItem(requestedCurrent))
      ? requestedCurrent
      : ROOT_ID;
  graphExpanded = new Set(
    (state.view.graphExpandedGroupIds ?? []).filter((groupId) =>
      Boolean(group(groupId))),
  );
  binMode = state.view.binMode;
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

/** Breadcrumb path while drilled into a folder inside the Bin — walks up
 * from groupId through its real (original) ancestor chain, stopping at
 * the first folder that isn't itself binned (its own placement in the
 * Bin's top-level list), so the trail reads "Bin › outerBinnedFolder ›
 * ... › groupId" without ever crossing into the real explorer tree. */
function pathToBin(groupId) {
  const result = [];
  let cursor = group(groupId);
  while (cursor) {
    result.unshift({ id: cursor.id, name: cursor.name });
    if (cursor.bin) break;
    cursor = group(cursor.parentId);
  }
  return [{ id: 'bin', name: 'Bin' }, ...result];
}

function iconMarkup(candidate) {
  if (candidate.kind === 'bin-origin') {
    return '<span class="folder-art" aria-hidden="true"><span></span></span>';
  }
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
    return `<img data-web-icon="${escapeHtml(candidate.target)}" alt="" hidden /><span class="shortcut-fallback" aria-hidden="true">↗</span>`;
  }
  return `<img data-default-icon="${candidate.id}" alt="" hidden /><span class="shortcut-fallback" aria-hidden="true">↗</span>`;
}

function linkMarkup(candidate) {
  return candidate.linked
    ? '<span class="link-badge" title="Linked into more than one folder" aria-hidden="true">⛓</span>'
    : '';
}

function descriptionMarkup(candidate) {
  return candidate.kind === 'shortcut' && candidate.description
    ? `<small>${escapeHtml(candidate.description)}</small>`
    : '';
}

const graph = createGraphController();

function createGraphController() {
  const nodes = new Map();
  const edges = new Map();
  const originEdges = new Map();
  let simulation = null;
  let zoomBehavior = null;
  let viewportSelection = null;
  let viewport = null;
  let camera = null;
  let edgeLayer = null;
  let nodeLayer = null;
  let svg = null;
  let resizeObserver = null;
  let rafId = 0;
  let pendingFrame = false;
  let initialized = false;
  let fitPending = false;
  let attached = false;
  let updatePending = false;
  let pendingInitialFit = false;
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');

  function createGraphView() {
    if (attached) return;
    viewport = document.createElement('div');
    viewport.className = 'graph-viewport';
    viewport.id = 'graph-viewport';
    viewport.dataset.blankParent = binMode ? 'bin' : currentId;

    camera = document.createElement('div');
    camera.className = 'graph-camera';

    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'graph-edges-svg');
    svg.setAttribute('aria-hidden', 'true');
    edgeLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    svg.append(edgeLayer);

    nodeLayer = document.createElement('div');
    nodeLayer.className = 'graph-node-layer';

    camera.append(svg, nodeLayer);
    viewport.append(camera);
    elements.grid.append(viewport);

    try {
      zoomBehavior = zoom()
        .scaleExtent([0.35, 3])
        .filter((event) => {
          if (event.type === 'mousedown' && event.button === 0) return false;
          if (event.type === 'dblclick') return false;
          if (event.type === 'wheel' && event.ctrlKey) return false;
          return true;
        })
        .on('zoom', ({ transform }) => {
          if (camera) {
            camera.style.transform = `translate(${transform.x}px, ${transform.y}px) scale(${transform.k})`;
          }
        });
      viewportSelection = select(viewport);
      viewportSelection.call(zoomBehavior);
    } catch (error) {
      viewport.remove();
      viewport = null;
      camera = null;
      edgeLayer = null;
      nodeLayer = null;
      svg = null;
      throw error;
    }

    resizeObserver = new ResizeObserver(() => {
      const w = viewport?.clientWidth ?? 0;
      const h = viewport?.clientHeight ?? 0;
      if (w >= 2 && h >= 2) {
        if (simulation) {
          simulation.force('cx').x(w / 2);
          simulation.force('cy').y(h / 2);
        }
        if (updatePending || fitPending) {
          updatePending = false;
          updateGraphView(pendingInitialFit);
        }
      }
    });
    resizeObserver.observe(viewport);
    attached = true;
  }

  function destroyGraphView() {
    if (graphDrag) {
      graphDrag = null;
      removeGraphShiftListeners();
    }
    if (simulation) { simulation.stop(); simulation = null; }
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; pendingFrame = false; }
    nodes.forEach((node) => {
      if (node.exitTimer) { clearTimeout(node.exitTimer); node.exitTimer = null; }
    });
    if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null; }
    nodes.clear();
    edges.clear();
    originEdges.clear();
    if (viewport) { viewport.remove(); viewport = null; }
    camera = null;
    edgeLayer = null;
    nodeLayer = null;
    svg = null;
    viewportSelection = null;
    zoomBehavior = null;
    attached = false;
    initialized = false;
    fitPending = false;
    updatePending = false;
    pendingInitialFit = false;
  }

  function scheduleRender() {
    if (pendingFrame) return;
    pendingFrame = true;
    rafId = requestAnimationFrame(() => {
      pendingFrame = false;
      rafId = 0;
      drawFrame();
    });
  }

  function drawFrame() {
    nodes.forEach((node) => {
      if (node.exiting || !node.shell) return;
      node.shell.style.transform =
        `translate3d(${node.x}px, ${node.y}px, 0) translate(-50%, -50%)`;
    });
    edges.forEach((edge) => {
      const source = nodes.get(edge.sourceId);
      const target = nodes.get(edge.targetId);
      if (!source || !target || !edge.path) return;
      edge.path.setAttribute('d', edgePath(source.x, source.y, target.x, target.y));
    });
    originEdges.forEach((edge) => {
      const source = nodes.get(edge.sourceId);
      const target = nodes.get(edge.targetId);
      if (!source || !target || !edge.path) return;
      edge.path.setAttribute('d', edgePath(source.x, source.y, target.x, target.y));
    });
  }

  function edgePath(x1, y1, x2, y2) {
    const mx = (x1 + x2) / 2;
    return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
  }

  function buildCandidate(vi) {
    if (vi.kind === 'bin-origin') {
      // A ghost node standing in for a folder that isn't itself visible in
      // the current Bin walk — just a "this is where it came from" label,
      // not a real interactive item. The folder may since have been
      // deleted or renamed to nothing findable; fall back to a generic
      // label rather than dropping the edge entirely.
      const origin = group(vi.groupId);
      return {
        id: vi.id,
        kind: 'bin-origin',
        name: origin?.name ?? 'Elsewhere',
        parentId: null,
        parentIds: [],
        linked: false,
      };
    }
    const stored = vi.kind === 'shortcut' ? shortcutByRecordOrPlacementId(vi.id) : group(vi.id);
    if (!stored) return null;
    return {
      ...stored,
      // The graph node's identity is always vi.id (a placement id for a
      // bin-mode shortcut tile, the shared record id everywhere else) —
      // never stored.id, which for a resolved-by-placement bin tile would
      // be the shared shortcut record id and corrupt every DOM/selection
      // lookup keyed off candidate.id (dataset.id, dataset.graphNodeId).
      id: vi.id,
      kind: vi.kind,
      parentId: vi.parentId,
      // Every folder this shortcut is currently placed in, per the visible
      // graph (used to decide whether Ctrl+X collapses everything into one
      // place or moves just the one placement this view represents).
      parentIds: vi.parentIds ?? [vi.parentId],
      // Whether the underlying shortcut has more than one active placement
      // anywhere at all (not just in this view) — drives the link marker
      // and the apply-everywhere-or-fork prompt on edit.
      linked: vi.kind === 'shortcut' ? placementCount(stored) > 1 : false,
    };
  }

  function syncNodes(visibleItems) {
    const incoming = new Set(visibleItems.map((vi) => vi.id));
    for (const id of [...nodes.keys()]) {
      if (!incoming.has(id)) removeNode(id);
    }
    const byParent = new Map();
    for (const vi of visibleItems) {
      const key = vi.parentId ?? ROOT_ID;
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key).push(vi);
    }
    const ctxId = graphContextId(currentId, binMode);
    for (const vi of visibleItems) {
      const parentIds = vi.parentIds ?? [vi.parentId];
      let node = nodes.get(vi.id);
      if (node) {
        if (node.exitTimer) {
          clearTimeout(node.exitTimer);
          node.exitTimer = null;
          node.exiting = false;
          if (node.shell) {
            node.shell.classList.remove('exiting');
            node.shell.style.opacity = '';
            node.shell.style.scale = '';
          }
        }
        node.candidate = buildCandidate(vi);
        node.parentIds = parentIds;
        node.depth = vi.depth;
        refreshNodeContent(node);
        continue;
      }
      const candidate = buildCandidate(vi);
      if (!candidate) continue;
      const firstParentId = parentIds[0];
      const parent = firstParentId && firstParentId !== ROOT_ID && firstParentId !== 'bin'
        ? nodes.get(firstParentId)
        : null;
      const siblings = byParent.get(candidate.parentId ?? ROOT_ID) ?? [];
      const index = Math.max(0, siblings.findIndex((s) => s.id === vi.id));
      const originX = viewport ? viewport.clientWidth / 2 : 400;
      const originY = viewport ? viewport.clientHeight / 2 : 300;
      const saved = getGraphPosition(state, ctxId, vi.id);
      const seed = seedPosition(vi.id, parent, index, siblings.length, originX, originY);
      node = {
        id: vi.id,
        candidate,
        depth: vi.depth,
        x: saved ? saved.x : seed.x,
        y: saved ? saved.y : seed.y,
        fx: saved ? saved.x : null,
        fy: saved ? saved.y : null,
        vx: 0,
        vy: 0,
        width: 0,
        height: 0,
        parentIds,
        parentNode: parent ?? null,
        shell: null,
        exiting: false,
        exitTimer: null,
        positioned: Boolean(saved),
      };
      nodes.set(vi.id, node);
      createNodeShell(node);
    }
  }

  function refreshNodeContent(node) {
    if (!node.shell) return;
    const candidate = node.candidate;
    if (!candidate) return;
    const iconItem = node.shell.querySelector('.icon-item');
    if (!iconItem) return;
    const isGhost = candidate.kind === 'bin-origin';
    const canExpand = candidate.kind === 'group';
    const isExpanded = canExpand && graphExpanded.has(candidate.id);
    const isSelected = !isGhost && selected.has(candidate.id);
    iconItem.dataset.kind = candidate.kind;
    iconItem.dataset.parent = candidate.parentId ?? (binMode ? 'bin' : currentId);
    iconItem.setAttribute('draggable', 'false');
    iconItem.setAttribute('aria-selected', String(isSelected));
    iconItem.classList.toggle('selected', isSelected);
    iconItem.classList.toggle('bin-origin-ghost', isGhost);
    node.shell.classList.toggle('bin-origin-ghost', isGhost);
    const signature = JSON.stringify([
      candidate.kind,
      candidate.name,
      candidate.description ?? '',
      candidate.target ?? '',
      candidate.icon ?? null,
      candidate.linked ?? false,
      isExpanded,
      binMode,
      state.view.iconSize,
    ]);
    if (node.contentSignature !== signature) {
      node.contentSignature = signature;
      iconItem.innerHTML =
        `${canExpand ? `<button class="folder-expander ${isExpanded ? 'expanded' : ''}" data-expand="${candidate.id}" type="button" aria-label="${isExpanded ? 'Collapse' : 'Expand'} ${escapeHtml(candidate.name)}">›</button>` : ''}`
        + `${linkMarkup(candidate)}`
        + `<div class="item-icon">${iconMarkup(candidate)}</div>`
        + `<strong>${escapeHtml(candidate.name)}</strong>`
        + `${descriptionMarkup(candidate)}`;
      hydrateNodeIcons(node.shell);
    }
    node.width = node.shell.offsetWidth || (state.view.iconSize + 42);
    node.height = node.shell.offsetHeight || (state.view.iconSize + 64);
  }

  function createNodeShell(node) {
    const candidate = node.candidate;
    if (!candidate) return;
    const isGhost = candidate.kind === 'bin-origin';
    const isSelected = !isGhost && selected.has(candidate.id);
    const canExpand = candidate.kind === 'group';
    const isExpanded = canExpand && graphExpanded.has(candidate.id);

    const shell = document.createElement('div');
    shell.className = `graph-node-shell${isGhost ? ' bin-origin-ghost' : ''}`;
    shell.dataset.graphNodeId = candidate.id;
    shell.style.transform = `translate3d(${node.x}px, ${node.y}px, 0) translate(-50%, -50%)`;

    const iconItem = document.createElement('div');
    iconItem.className = `icon-item${isSelected ? ' selected' : ''}${isGhost ? ' bin-origin-ghost' : ''}`;
    iconItem.dataset.id = candidate.id;
    iconItem.dataset.kind = candidate.kind;
    iconItem.dataset.parent = candidate.parentId ?? (binMode ? 'bin' : currentId);
    iconItem.setAttribute('draggable', 'false');
    iconItem.setAttribute('role', isGhost ? 'presentation' : 'option');
    iconItem.setAttribute('aria-selected', String(isSelected));
    iconItem.setAttribute('tabindex', '-1');
    iconItem.innerHTML =
      `${canExpand ? `<button class="folder-expander ${isExpanded ? 'expanded' : ''}" data-expand="${candidate.id}" type="button" aria-label="${isExpanded ? 'Collapse' : 'Expand'} ${escapeHtml(candidate.name)}">›</button>` : ''}`
      + `${linkMarkup(candidate)}`
      + `<div class="item-icon">${iconMarkup(candidate)}</div>`
      + `<strong>${escapeHtml(candidate.name)}</strong>`
      + `${descriptionMarkup(candidate)}`;

    shell.append(iconItem);
    nodeLayer.append(shell);
    node.shell = shell;

    node.contentSignature = JSON.stringify([
      candidate.kind,
      candidate.name,
      candidate.description ?? '',
      candidate.target ?? '',
      candidate.icon ?? null,
      candidate.linked ?? false,
      isExpanded,
      binMode,
      state.view.iconSize,
    ]);

    node.width = shell.offsetWidth || (state.view.iconSize + 42);
    node.height = shell.offsetHeight || (state.view.iconSize + 64);

    if (reducedMotion?.matches) {
      shell.style.opacity = '1';
    } else {
      shell.style.opacity = '0';
      shell.style.scale = '0.7';
      requestAnimationFrame(() => {
        if (node.shell) {
          shell.style.opacity = '1';
          shell.style.scale = '1';
        }
      });
    }
  }

  function removeNode(id) {
    const node = nodes.get(id);
    if (!node) return;
    if (reducedMotion?.matches || node.exiting) {
      node.shell?.remove();
      nodes.delete(id);
      return;
    }
    node.exiting = true;
    const parent = node.parentNode;
    const targetX = parent ? parent.x : node.x;
    const targetY = parent ? parent.y : node.y;
    if (node.shell) {
      node.shell.classList.add('exiting');
      node.shell.style.transform = `translate3d(${targetX}px, ${targetY}px, 0) translate(-50%, -50%)`;
      node.shell.style.opacity = '0';
      node.shell.style.scale = '0.5';
    }
    node.exitTimer = setTimeout(() => {
      node.shell?.remove();
      nodes.delete(id);
      node.exitTimer = null;
    }, 200);
  }

  function syncEdges(visibleItems) {
    if (!edgeLayer) return;
    const wanted = new Map();
    for (const edge of graphEdges(visibleItems)) {
      const source = nodes.get(edge.source);
      const target = nodes.get(edge.target);
      if (!source || !target || source.exiting || target.exiting) continue;
      wanted.set(edge.id, { sourceId: edge.source, targetId: edge.target });
    }
    for (const [key, edge] of edges) {
      if (!wanted.has(key)) {
        edge.path?.remove();
        edges.delete(key);
      }
    }
    for (const [key, info] of wanted) {
      let edge = edges.get(key);
      const source = nodes.get(info.sourceId);
      const target = nodes.get(info.targetId);
      if (!source || !target) continue;
      if (!edge) {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('class', 'graph-edge');
        path.setAttribute('d', edgePath(source.x, source.y, target.x, target.y));
        edgeLayer.append(path);
        edge = { key, sourceId: info.sourceId, targetId: info.targetId, path };
        edges.set(key, edge);
      }
    }
  }

  /** Draws the "where did this come from" edges for binned tiles (see
   * binOriginEdges) — kept in a separate map/CSS class from the normal
   * graph-edge set above, since these connect to a possibly-ghost node
   * and are always styled distinctly (red) rather than the default gray. */
  function syncOriginEdges(edgeList) {
    if (!edgeLayer) return;
    const wanted = new Map();
    for (const edge of edgeList) {
      const source = nodes.get(edge.source);
      const target = nodes.get(edge.target);
      if (!source || !target || source.exiting || target.exiting) continue;
      wanted.set(edge.id, { sourceId: edge.source, targetId: edge.target });
    }
    for (const [key, edge] of originEdges) {
      if (!wanted.has(key)) {
        edge.path?.remove();
        originEdges.delete(key);
      }
    }
    for (const [key, info] of wanted) {
      let edge = originEdges.get(key);
      const source = nodes.get(info.sourceId);
      const target = nodes.get(info.targetId);
      if (!source || !target) continue;
      if (!edge) {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('class', 'graph-edge bin-origin-edge');
        path.setAttribute('d', edgePath(source.x, source.y, target.x, target.y));
        edgeLayer.append(path);
        edge = { key, sourceId: info.sourceId, targetId: info.targetId, path };
        originEdges.set(key, edge);
      }
    }
  }

  function ensureSimulation() {
    if (simulation) return;
    const w = viewport?.clientWidth || 800;
    const h = viewport?.clientHeight || 600;
    simulation = forceSimulation()
      .force('cx', forceX(w / 2).strength(0.05))
      .force('cy', forceY(h / 2).strength(0.05))
      .force('charge', forceManyBody().strength(-280))
      .force('collide', forceCollide().radius((n) => Math.max(n.width, n.height) / 2 + 20).strength(0.9))
      .force('link', forceLink().id((n) => n.id).distance(145).strength(0.14))
      .alphaDecay(0.028)
      .velocityDecay(0.32);
    simulation.on('tick', scheduleRender);
  }

  function syncSimulation() {
    ensureSimulation();
    const nodeArray = [...nodes.values()].filter((n) => !n.exiting);
    simulation.nodes(nodeArray);
    const edgeArray = [];
    edges.forEach((edge) => {
      edgeArray.push({ source: edge.sourceId, target: edge.targetId });
    });
    originEdges.forEach((edge) => {
      edgeArray.push({ source: edge.sourceId, target: edge.targetId });
    });
    simulation.force('link').links(edgeArray);
    simulation.force('collide').radius((n) => Math.max(n.width, n.height) / 2 + 20);
    const w = viewport?.clientWidth || 800;
    const h = viewport?.clientHeight || 600;
    simulation.force('cx').x(w / 2);
    simulation.force('cy').y(h / 2);
  }

  function reheat(level = 0.35) {
    if (!simulation) return;
    simulation.alpha(Math.max(simulation.alpha(), level)).restart();
  }

  function fitGraph(padding = 90, animate = true) {
    if (!camera || !viewport || !viewportSelection || nodes.size === 0) return false;
    const w = viewport.clientWidth;
    const h = viewport.clientHeight;
    if (w < 2 || h < 2) return false;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let activeCount = 0;
    nodes.forEach((n) => {
      if (n.exiting) return;
      activeCount += 1;
      const halfW = (n.width || 100) / 2;
      const halfH = (n.height || 120) / 2;
      minX = Math.min(minX, n.x - halfW);
      minY = Math.min(minY, n.y - halfH);
      maxX = Math.max(maxX, n.x + halfW);
      maxY = Math.max(maxY, n.y + halfH);
    });
    if (!Number.isFinite(minX) || activeCount === 0) return false;
    const scale = Math.min(
      (w - padding * 2) / Math.max(1, maxX - minX),
      (h - padding * 2) / Math.max(1, maxY - minY),
      2,
    );
    const k = Math.max(0.35, Math.min(3, scale));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const tx = w / 2 - cx * k;
    const ty = h / 2 - cy * k;
    const transform = zoomIdentity.translate(tx, ty).scale(k);
    if (animate && !reducedMotion?.matches) {
      viewportSelection.transition().duration(550).call(zoomBehavior.transform, transform);
    } else {
      zoomBehavior.transform(viewportSelection, transform);
    }
    return true;
  }

  function updateGraphView(initialFit = false) {
    const w = viewport?.clientWidth ?? 0;
    const h = viewport?.clientHeight ?? 0;
    if (w < 2 || h < 2) {
      updatePending = true;
      pendingInitialFit = initialFit;
      return;
    }
    updatePending = false;
    const visible = visibleGraphItems(state, currentId, graphExpanded, binMode, binCurrentId);
    if (visible.length === 0) {
      nodes.forEach((_, id) => removeNode(id));
      syncEdges([]);
      syncOriginEdges([]);
      return;
    }
    const originEdges = binMode ? binOriginEdges(visible) : [];
    const ghostIds = new Set(originEdges.filter((e) => e.ghost).map((e) => e.ghostGroupId));
    const ghostItems = [...ghostIds].map((groupId, index) => ({
      id: `bin-origin:${groupId}`,
      parentId: null,
      kind: 'bin-origin',
      groupId,
      depth: 0,
      siblingIndex: index,
      siblingCount: ghostIds.size,
    }));
    syncNodes([...visible, ...ghostItems]);
    syncEdges(visible);
    syncOriginEdges(originEdges);
    syncSimulation();
    reheat(initialFit ? 0.7 : 0.35);
    if (initialFit && !initialized) {
      fitPending = true;
      setTimeout(() => {
        if (fitPending && fitGraph()) {
          fitPending = false;
          initialized = true;
        }
      }, 500);
    }
  }

  function refreshSelection() {
    nodes.forEach((node) => {
      if (!node.shell) return;
      const iconItem = node.shell.querySelector('.icon-item');
      if (!iconItem) return;
      const isSelected = selected.has(node.id);
      iconItem.classList.toggle('selected', isSelected);
      iconItem.setAttribute('aria-selected', String(isSelected));
    });
  }

  return {
    createGraphView,
    updateGraphView,
    destroyGraphView,
    refreshSelection,
    reheat,
    fitGraph,
    _getNode: (id) => nodes.get(id) ?? null,
    _setSimulationDecay() {
      if (simulation) {
        simulation.alphaTarget(0);
        if (simulation.alpha() < simulation.alphaMin()) {
          simulation.alpha(0.05).restart();
        }
      }
    },
    get hasNodes() { return nodes.size > 0; },
    get isAttached() { return attached; },
    get nodeCount() { return [...nodes.values()].filter((n) => !n.exiting).length; },
    get edgeCount() { return edges.size; },
    get _needsFullRebuild() { return false; },
  };
}

function renderGraph(initialFit = false) {
  if (!graph.isAttached) {
    graph.createGraphView();
  }
  graph.updateGraphView(initialFit);
}

function render() {
  if (binMode && binCurrentId !== 'bin' && !group(binCurrentId)?.bin) {
    // The folder we'd drilled into was restored or deleted out from under
    // us (e.g. via the top-level Bin list or "Delete all") — fall back to
    // the top of the Bin rather than rendering a dangling, nonexistent
    // breadcrumb segment.
    binCurrentId = 'bin';
  }
  const iconSize = state.view.iconSize;
  document.documentElement.style.setProperty('--icon-size', `${iconSize}px`);
  elements.breadcrumbs.innerHTML = binMode
    ? pathToBin(binCurrentId === 'bin' ? null : binCurrentId).map((candidate, index, path) =>
        `<button type="button" data-bin-breadcrumb="${candidate.id}">${escapeHtml(candidate.name)}</button>${index < path.length - 1 ? '<span aria-hidden="true">›</span>' : ''}`,
      ).join('')
    : pathTo(currentId).map((candidate, index, path) =>
        `<button type="button" data-breadcrumb="${candidate.id}">${escapeHtml(candidate.name)}</button>${index < path.length - 1 ? '<span aria-hidden="true">›</span>' : ''}`,
      ).join('');

  const visible = binMode
    ? (binCurrentId === 'bin' ? binnedItems(state) : itemsInBinnedGroup(state, binCurrentId))
    : itemsIn(state, currentId);
  elements.grid.dataset.blankParent = binMode ? binCurrentId : currentId;
  elements.grid.dataset.view = 'graph';
  elements.grid.classList.toggle('bin-canvas', binMode);

  if (!graph.isAttached) {
    elements.grid.innerHTML = '';
    renderGraph(true);
  } else {
    graph.updateGraphView(false);
  }
  elements.empty.hidden = visible.length !== 0;
  elements.empty.textContent = binMode
    ? (binCurrentId === 'bin' ? 'The Bin is empty.' : 'Nothing left here.')
    : 'This folder is empty. Right-click here to add something.';

  syncSelection();

  const binCount = binnedItems(state).length;
  elements.binCount.hidden = binCount === 0;
  elements.binCount.textContent = String(binCount);
  elements.binButton.setAttribute('aria-pressed', String(binMode));
  elements.binLabel.textContent = binMode ? 'Close Bin' : 'Bin';
  elements.binButton.title = binMode ? 'Close Bin' : 'Bin';
  const hasSelection = binMode && selected.size > 0;
  elements.deleteAllBin.hidden = !binMode || binCount === 0;
  elements.restoreAllBin.hidden = !binMode || binCount === 0;
  elements.deleteAllBin.classList.toggle('selective', hasSelection);
  elements.restoreAllBin.classList.toggle('selective', hasSelection);
  elements.deleteAllBin.title = hasSelection ? 'Delete selection permanently' : 'Delete all';
  elements.restoreAllBin.title = hasSelection ? 'Restore selection' : 'Restore all';

  hydrateIcons();
}

function syncSelection() {
  if (graph.isAttached) {
    graph.refreshSelection();
  } else {
    document.querySelectorAll('.icon-item').forEach((tile) => {
      const isSelected = selected.has(tile.dataset.id);
      tile.classList.toggle('selected', isSelected);
      tile.setAttribute('aria-selected', String(isSelected));
    });
  }
  elements.selectionStatus.hidden = selected.size === 0;
  elements.selectionStatus.textContent = selected.size === 1
    ? '1 item selected'
    : `${selected.size} items selected`;
}

async function hydrateIcons() {
  await hydrateIconsScoped(
    document,
    iconCache,
    (detail) => host.shortcutIcon(detail),
    (url) => host.resolveWebIcon(url),
  );
}

function hydrateNodeIcons(shell) {
  if (!shell) return;
  hydrateIconsScoped(
    shell,
    iconCache,
    (detail) => host.shortcutIcon(detail),
    (url) => host.resolveWebIcon(url),
  );
}

async function persist(nextState = state) {
  const snapshot = JSON.stringify(nextState);
  const operation = saveQueue
    .catch(() => undefined)
    .then(() => host.saveWorkspace(snapshot));
  saveQueue = operation;
  await operation;
}

async function commit(nextState, options = {}) {
  if (options.isUndo) {
    redoStack.push(state);
  } else if (options.isRedo) {
    undoStack.push(state);
  } else {
    undoStack.push(state);
    redoStack.length = 0;
  }
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

async function undo() {
  if (undoStack.length === 0) return;
  const previous = undoStack.pop();
  closeMenu();
  await commit(previous, { isUndo: true });
}

async function redo() {
  if (redoStack.length === 0) return;
  const next = redoStack.pop();
  closeMenu();
  await commit(next, { isRedo: true });
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
      '<hr />',
      menuButton('reset-graph-position', chosen.length > 1 ? 'Follow folders automatically' : 'Follow folder automatically'),
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

function selectedPasteDestinations() {
  const folders = [...selected].map((itemId) => group(itemId)).filter(Boolean);
  return folders.length > 0 ? folders.map((folder) => folder.id) : [currentId];
}

async function activate(itemId) {
  const folder = group(itemId);
  if (folder) {
    if (binMode) {
      // Drilling into a binned folder stays inside the Bin — it must never
      // jump to the real explorer, since the folder (and everything under
      // it) is still hidden there and would just show up empty.
      binCurrentId = folder.id;
      selected.clear();
      graph.destroyGraphView();
      closeMenu();
      render();
      saveWorkspaceView();
      return;
    }
    currentId = folder.id;
    selected.clear();
    graph.destroyGraphView();
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
        await host.openWebLink(chosen.target);
      } else {
        await host.launchShortcut(itemId);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }
}

function directoryOf(target) {
  const normalized = target.replace(/\\/g, '/');
  const lastSlash = normalized.lastIndexOf('/');
  return lastSlash === -1 ? normalized : normalized.slice(0, lastSlash).toLocaleLowerCase();
}

async function revealSelection() {
  const targets = [...selected]
    .map((itemId) => shortcut(itemId))
    .filter((candidate) => candidate && !isWebLink(candidate));
  if (targets.length === 0) return;
  const seenDirectories = new Set();
  for (const target of targets) {
    const directory = directoryOf(target.target);
    if (seenDirectories.has(directory)) continue;
    seenDirectories.add(directory);
    try {
      await host.revealShortcut(target.id);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }
}

async function activateSelection() {
  const shortcuts = [...selected]
    .map((itemId) => shortcut(itemId))
    .filter(Boolean);
  if (shortcuts.length === 0) return;
  closeMenu();
  await Promise.all(shortcuts.map(async (chosen) => {
    try {
      if (isWebLink(chosen)) {
        await host.openWebLink(chosen.target);
      } else {
        await host.launchShortcut(chosen.id);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }));
}

async function copyOrCut(mode) {
  if (selected.size === 0) return;

  // Capture right now, at the moment of Ctrl+C/Ctrl+X, both which specific
  // placement each selected shortcut represents and (for a cut) whether it
  // currently shows more than one edge on screen — both decide behavior at
  // paste time and must not drift if selection or graph visibility changes
  // before the user pastes.
  const collapseWhole = new Set();
  const placementIds = new Map();

  for (const selectedId of selected) {
    if (group(selectedId)) continue;

    const placementId = visiblePlacementIdFor(selectedId);
    if (placementId) placementIds.set(selectedId, placementId);

    if (mode === 'cut' && visibleParentCountFor(selectedId) > 1) {
      collapseWhole.add(selectedId);
    }
  }

  clipboard = {
    mode,
    ids: [...selected],
    collapseWhole,
    placementIds,
  };

  setStatus('');
  closeMenu();
}

async function pasteInto(parentIds) {
  const destinations = Array.isArray(parentIds) ? parentIds : [parentIds];
  if (!clipboard || destinations.length === 0 || destinations.includes('bin')) return;
  try {
    const wasCut = clipboard.mode === 'cut';
    let next = state;
    if (wasCut) {
      // A cut item can only move to one place, so multi-folder selection is
      // ignored here — only the first destination applies.
      const parentId = destinations[0];
      const groupIds = clipboard.ids.filter((selectedId) => group(selectedId));
      const wholeShortcutIds = clipboard.ids.filter((selectedId) => clipboard.collapseWhole.has(selectedId));
      const singlePlacementIds = clipboard.ids
        .filter((selectedId) => !group(selectedId) && !clipboard.collapseWhole.has(selectedId))
        .map((selectedId) => clipboard.placementIds.get(selectedId) ?? anyActivePlacementId(selectedId))
        .filter(Boolean);
      if (groupIds.length > 0 || singlePlacementIds.length > 0) {
        next = moveSelection(next, [...groupIds, ...singlePlacementIds], parentId);
      }
      for (const shortcutId of wholeShortcutIds) {
        next = collapsePlacements(next, shortcutId, parentId);
      }
    } else {
      const ids = clipboard.ids
        .map((selectedId) => group(selectedId)
          ? selectedId
          : clipboard.placementIds.get(selectedId) ?? anyActivePlacementId(selectedId))
        .filter(Boolean);
      // Copying always links; pasting into multiple selected folders at once
      // links a new placement into each one.
      for (const parentId of destinations) {
        next = copySelection(next, ids, parentId);
      }
    }
    if (wasCut) clipboard = null;
    await commit(next, wasCut ? 'Moved.' : 'Copied.');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  }
}

function showIconPreview(source) {
  if (!source) {
    elements.iconPreview.hidden = true;
    elements.iconFallback.removeAttribute('hidden');
    return;
  }
  elements.iconPreview.hidden = false;
  elements.iconPreview.src = source;
  elements.iconFallback.setAttribute('hidden', '');
}

async function resolveEditorTargetIcon() {
  if (editorIcon) return showIconPreview(editorIcon);
  if (editorTargetIcon) return showIconPreview(editorTargetIcon);
  if (editorMode?.kind === 'web') {
    const target = elements.target.value.trim();
    if (target) {
      return hydrateWebPreview(elements.iconPreview, elements.iconFallback, target);
    }
    return showIconPreview(null);
  }
  if (editorMode?.kind === 'shortcut' && editorMode.item?.id) {
    try {
      editorTargetIcon = await host.shortcutIcon({
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
  const representedPlacementId =
    (kind === 'shortcut' || kind === 'web') && existing
      ? visiblePlacementIdFor(existing.id)
      : null;
  editorMode = { kind, item: existing, parentId, representedPlacementId };
  editorIcon = existing?.icon ?? null;
  editorTargetIcon =
    kind === 'shortcut' && existing && !existing.icon
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
  elements.linkEditLayer.hidden = true;
}

async function chooseTarget(kind) {
  try {
    const result = await host.pickTarget(kind);
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

function editedShortcutIsLinked() {
  if (editorMode?.kind !== 'shortcut' && editorMode?.kind !== 'web') return false;
  const existingId = editorMode.item?.id;
  if (!existingId) return false;
  const record = shortcut(existingId);
  return record ? placementCount(record) > 1 : false;
}

async function saveEditor() {
  if (!editorMode || elements.saveButton.disabled) return;
  if (editedShortcutIsLinked()) {
    elements.linkEditLayer.hidden = false;
    return;
  }
  await commitEditorSave(false);
}

async function commitEditorSave(forkFirst) {
  elements.saveButton.disabled = true;
  elements.saveButton.textContent = 'Saving…';
  const name = elements.name.value.trim();
  try {
    let workingState = state;
    let editItemId = editorMode.item?.id;
    if (forkFirst && editItemId) {
      const representedPlacementId =
        editorMode.representedPlacementId ?? anyActivePlacementId(editItemId);
      if (representedPlacementId) {
        const knownIds = new Set(workingState.shortcuts.map((candidate) => candidate.id));
        workingState = forkPlacement(workingState, representedPlacementId);
        const forked = workingState.shortcuts.find((candidate) => !knownIds.has(candidate.id));
        if (forked) editItemId = forked.id;
      }
    }
    let next;
    if (editorMode.kind === 'group') {
      next = editorMode.item
        ? updateGroup(workingState, editorMode.item.id, { name, icon: editorIcon })
        : createGroup(workingState, name, editorMode.parentId, editorIcon);
    } else {
      const changes = {
        name,
        description: elements.description.value.trim(),
        target: elements.target.value.trim(),
        icon: editorIcon,
      };
      next = editorMode.kind === 'web'
        ? editorMode.item
          ? updateWebLink(workingState, editItemId, changes)
          : createWebLink(workingState, { ...changes, parentId: editorMode.parentId })
        : editorMode.item
          ? updateShortcut(workingState, editItemId, changes)
          : createShortcut(workingState, { ...changes, parentId: editorMode.parentId });
    }
    const editedShortcutId = editorMode.kind === 'group' ? null : editItemId;
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

/** Resolves a set of graph item ids (groups or shared shortcut identities)
 * to the exact Bin-context ids binSelection() needs — a linked shortcut
 * with more than one visible edge bins every one of its placements (the
 * whole shared thing), while one with a single visible edge only bins the
 * placement this view represents. Shared by the Bin button/keyboard path
 * and drag-onto-the-bin-pill. */
function resolveBinTargets(itemIds) {
  return itemIds.flatMap((itemId) => {
    if (group(itemId)) return [itemId];
    return visibleParentCountFor(itemId) > 1
      ? allActivePlacementIds(itemId)
      : [visiblePlacementIdFor(itemId)].filter(Boolean);
  });
}

async function moveToBin() {
  if (selected.size === 0) return;
  await commit(binSelection(state, resolveBinTargets([...selected])), 'Moved to Bin.');
}

function askPermanentDelete(ids = [...selected], deletingAll = false) {
  if (ids.length === 0) return;
  pendingPermanentIds = [...ids];
  pendingRestoreIds = [];
  elements.confirmTitle.textContent = 'Delete permanently?';
  elements.confirmCopy.textContent = deletingAll
    ? `Delete all ${ids.length} items permanently? This cannot be undone.`
    : ids.length === 1
      ? `Delete “${binItemName(ids[0]) ?? 'this item'}” permanently? This cannot be undone.`
      : `Delete these ${ids.length} items permanently? This cannot be undone.`;
  elements.confirmDelete.hidden = false;
  elements.confirmRestore.hidden = true;
  elements.confirmLayer.hidden = false;
}

function askRestoreConfirm(ids, restoringAll = false) {
  if (ids.length === 0) return;
  pendingRestoreIds = [...ids];
  pendingPermanentIds = [];
  elements.confirmTitle.textContent = 'Restore?';
  elements.confirmCopy.textContent = restoringAll
    ? `Restore all ${ids.length} items?`
    : ids.length === 1
      ? `Restore “${binItemName(ids[0]) ?? 'this item'}”?`
      : `Restore these ${ids.length} items?`;
  elements.confirmDelete.hidden = true;
  elements.confirmRestore.hidden = false;
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
  if (action === 'restore') return askRestoreConfirm([...selected]);
  if (action === 'delete-forever') return askPermanentDelete();
  if (action === 'reset-graph-position') {
    const ctxId = graphContextId(currentId, binMode);
    state = removeGraphPositions(state, ctxId, [...selected]);
    for (const id of selected) {
      const node = graph._getNode(id);
      if (node) {
        node.fx = null;
        node.fy = null;
        node.positioned = false;
        node.vx = 0;
        node.vy = 0;
      }
    }
    graph.reheat(0.3);
    closeMenu();
    saveWorkspaceView();
    return;
  }
}

elements.grid.addEventListener('click', (event) => {
  event.stopPropagation();
  const expandButton = event.target.closest('[data-expand]');
  if (expandButton) {
    const folderId = expandButton.dataset.expand;
    const targetSet = graphExpanded;
    if (targetSet.has(folderId)) targetSet.delete(folderId);
    else targetSet.add(folderId);
    closeMenu();
    render();
    saveWorkspaceView();
    return;
  }
  const tile = event.target.closest('.icon-item');
  if (tile) {
    if (suppressGraphClick) {
      suppressGraphClick = false;
      return;
    }
    if (tile.classList.contains('bin-origin-ghost')) return;
    selectItem(tile.dataset.id, event);
    return;
  }
  const blank = event.target.closest('[data-blank-parent], [data-icon-grid]');
  if (blank) {
    if (suppressBlankClick) {
      suppressBlankClick = false;
      return;
    }
    if (suppressGraphClick) {
      suppressGraphClick = false;
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
  if (event.button !== 0) return;

  if (!event.target.closest('[data-expand]') && !event.target.closest('button') && !event.ctrlKey) {
    const tile = event.target.closest('.icon-item');
    const shell = tile?.closest('.graph-node-shell');
    if (shell && event.pointerType !== 'touch' && !tile.classList.contains('bin-origin-ghost')) {
      const itemId = tile.dataset.id;
      if (!selected.has(itemId)) {
        selected = new Set([itemId]);
        selectionAnchor = itemId;
        syncSelection();
        saveWorkspaceView();
      }
      const dragPlacementIds = new Map();
      for (const id of selected) {
        if (group(id)) continue;
        const placementId = visiblePlacementIdFor(id);
        if (placementId) dragPlacementIds.set(id, placementId);
      }
      graphDrag = {
        pointerId: event.pointerId,
        itemIds: [...selected],
        placementIds: dragPlacementIds,
        primaryNodeId: itemId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startWorldX: null,
        startWorldY: null,
        initialPositions: new Map(),
        pinOnRelease: event.shiftKey,
        moved: false,
        thresholdPassed: false,
      };
      closeMenu();
      event.preventDefault();
      return;
    }
  }

  if (
    event.target.closest('.icon-item')
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
  if (graphDrag && event.pointerId === graphDrag.pointerId) {
    const shiftHeld = event.shiftKey === true;
    if (shiftHeld !== graphDrag.pinOnRelease) {
      graphDrag.pinOnRelease = shiftHeld;
      for (const id of graphDrag.itemIds) {
        const node = graph._getNode(id);
        if (node?.shell) {
          if (shiftHeld) {
            node.shell.classList.remove('will-release');
            node.shell.classList.add('will-pin');
          } else {
            node.shell.classList.remove('will-pin');
            node.shell.classList.add('will-release');
          }
        }
      }
    }
    if (!graphDrag.thresholdPassed) {
      const dx = event.clientX - graphDrag.startClientX;
      const dy = event.clientY - graphDrag.startClientY;
      if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
      graphDrag.thresholdPassed = true;
      graphDrag.moved = true;
      elements.grid.setPointerCapture(event.pointerId);
      installGraphShiftListeners();
      const viewport = elements.grid.querySelector('.graph-viewport');
      let transform = { x: 0, y: 0, k: 1 };
      if (viewport) {
        try { transform = zoomTransform(viewport); } catch { /* use identity */ }
      }
      const rect = viewport?.getBoundingClientRect();

      const localX = rect ? graphDrag.startClientX - rect.left : graphDrag.startClientX;
      const localY = rect ? graphDrag.startClientY - rect.top : graphDrag.startClientY;
      graphDrag.startWorldX = (localX - transform.x) / transform.k;
      graphDrag.startWorldY = (localY - transform.y) / transform.k;
      const pinClass = graphDrag.pinOnRelease ? 'will-pin' : 'will-release';
      for (const id of graphDrag.itemIds) {
        const node = graph._getNode(id);
        if (node) {
          graphDrag.initialPositions.set(id, {
            x: node.x, y: node.y, fx: node.fx, fy: node.fy,
          });
          if (node.shell) {
            node.shell.classList.add('graph-dragging', pinClass);
          }
        }
      }
    }
    if (!graphDrag.moved) return;
    const viewport = elements.grid.querySelector('.graph-viewport');
    let transform = { x: 0, y: 0, k: 1 };
    if (viewport) {
      try { transform = zoomTransform(viewport); } catch { /* use identity */ }
    }
    const rect = viewport?.getBoundingClientRect();
    const localX = rect ? event.clientX - rect.left : event.clientX;
    const localY = rect ? event.clientY - rect.top : event.clientY;
    const worldX = (localX - transform.x) / transform.k;
    const worldY = (localY - transform.y) / transform.k;
    const deltaX = worldX - graphDrag.startWorldX;
    const deltaY = worldY - graphDrag.startWorldY;
    for (const id of graphDrag.itemIds) {
      const node = graph._getNode(id);
      if (!node) continue;
      const initial = graphDrag.initialPositions.get(id);
      if (!initial) continue;
      node.fx = initial.x + deltaX;
      node.fy = initial.y + deltaY;
      node.x = node.fx;
      node.y = node.fy;
      node.positioned = true;
    }
    graph.reheat(0.12);

    if (!binMode && elements.binButton) {
      const overBin = elements.binButton.contains(document.elementFromPoint(event.clientX, event.clientY));
      elements.binButton.classList.toggle('graph-bin-drop-target', overBin);
    }
    return;
  }

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

elements.grid.addEventListener('pointerup', (event) => {
  if (graphDrag && event.pointerId === graphDrag.pointerId) {
    if (elements.grid.hasPointerCapture(event.pointerId)) {
      elements.grid.releasePointerCapture(event.pointerId);
    }
    if (graphDrag.moved) {
      graphDrag.pinOnRelease = event.shiftKey === true;
      removeGraphShiftListeners();
      suppressGraphClick = true;
      document.querySelectorAll('.graph-dragging').forEach((el) => el.classList.remove('graph-dragging', 'will-pin', 'will-release'));
      document.querySelectorAll('.graph-drop-target').forEach((el) => el.classList.remove('graph-drop-target'));
      elements.binButton?.classList.remove('graph-bin-drop-target');
      const hitBin = !binMode && elements.binButton?.contains(document.elementFromPoint(event.clientX, event.clientY));
      const shells = [...elements.grid.querySelectorAll('.graph-node-shell')];
      shells.forEach((s) => s.style.pointerEvents = '');
      let hitFolderId = null;
      if (!hitBin) {
        shells.forEach((s) => {
          if (!graphDrag.itemIds.includes(s.dataset.graphNodeId)) {
            s.style.pointerEvents = 'none';
          }
        });
        const elAtPoint = document.elementFromPoint(event.clientX, event.clientY);
        const hitShell = elAtPoint?.closest('.graph-node-shell');
        shells.forEach((s) => s.style.pointerEvents = '');
        if (hitShell && !graphDrag.itemIds.includes(hitShell.dataset.graphNodeId)) {
          const hitItem = hitShell.querySelector('.icon-item');
          if (hitItem?.dataset.kind === 'group') {
            hitFolderId = hitItem.dataset.id;
          }
        }
      }

      const graphDragCopy = { ...graphDrag, itemIds: [...graphDrag.itemIds], placementIds: graphDrag.placementIds };
      graphDrag = null;

      if (hitBin) {
        try {
          const ctxId = graphContextId(currentId, binMode);
          const next = removeGraphPositions(
            binSelection(state, resolveBinTargets(graphDragCopy.itemIds)),
            ctxId,
            graphDragCopy.itemIds,
          );
          commit(next, 'Moved to Bin.');
        } catch (error) {
          setStatus(error instanceof Error ? error.message : String(error));
        }
      } else if (hitFolderId) {
        try {
          const groupIds = graphDragCopy.itemIds.filter((draggedId) => group(draggedId));
          const wholeShortcutIds = graphDragCopy.itemIds.filter((draggedId) =>
            !group(draggedId) && visibleParentCountFor(draggedId) > 1);
          const singlePlacementIds = graphDragCopy.itemIds
            .filter((draggedId) => !group(draggedId) && visibleParentCountFor(draggedId) <= 1)
            .map((shortcutId) => graphDragCopy.placementIds.get(shortcutId) ?? anyActivePlacementId(shortcutId))
            .filter(Boolean);
          let next = state;
          if (groupIds.length > 0 || singlePlacementIds.length > 0) {
            next = moveSelection(next, [...groupIds, ...singlePlacementIds], hitFolderId);
          }
          for (const shortcutId of wholeShortcutIds) {
            next = collapsePlacements(next, shortcutId, hitFolderId);
          }
          const ctxId = graphContextId(currentId, binMode);
          state = removeGraphPositions(next, ctxId, graphDragCopy.itemIds);
          commit(state, 'Moved.');
        } catch (error) {
          setStatus(error instanceof Error ? error.message : String(error));
        }
      } else if (graphDragCopy.pinOnRelease) {
        const ctxId = graphContextId(currentId, binMode);
        const updates = {};
        for (const id of graphDragCopy.itemIds) {
          const node = graph._getNode(id);
          if (node) {
            updates[id] = { x: node.x, y: node.y };
          }
        }
        state = setGraphPositions(state, ctxId, updates);
        graph._setSimulationDecay();
        saveWorkspaceView();
      } else {
        const ctxId = graphContextId(currentId, binMode);
        state = removeGraphPositions(state, ctxId, graphDragCopy.itemIds);
        for (const id of graphDragCopy.itemIds) {
          const node = graph._getNode(id);
          if (node) {
            node.fx = null;
            node.fy = null;
            node.positioned = false;
          }
        }
        graph.reheat(0.25);
        saveWorkspaceView();
      }
      return;
    }
    removeGraphShiftListeners();
    graphDrag = null;
    return;
  }

  if (marqueeDrag) {
    finishMarquee(event);
  }
});

function isDirectoryTarget(target) {
  if (!target) return false;
  const normalized = target.replace(/\\/g, '/');
  const lastSlash = normalized.lastIndexOf('/');
  const basename = lastSlash === -1 ? normalized : normalized.slice(lastSlash + 1);
  return !basename.includes('.');
}

elements.grid.addEventListener('dblclick', (event) => {
  if (suppressGraphClick) {
    suppressGraphClick = false;
    return;
  }
  const tile = event.target.closest('.icon-item');
  if (!tile) return;
  const id = tile.dataset.id;
  const chosen = shortcut(id);
  if (chosen && !isWebLink(chosen) && isDirectoryTarget(chosen.target)) {
    closeMenu();
    host.revealShortcut(id).catch((error) =>
      setStatus(error instanceof Error ? error.message : String(error)));
    return;
  }
  activate(id);
});

elements.grid.addEventListener('pointercancel', (event) => {
  if (graphDrag && event.pointerId === graphDrag.pointerId) {
    if (elements.grid.hasPointerCapture(event.pointerId)) {
      elements.grid.releasePointerCapture(event.pointerId);
    }
    removeGraphShiftListeners();
    if (graphDrag.moved) {
      for (const id of graphDrag.itemIds) {
        const node = graph._getNode(id);
        const initial = graphDrag.initialPositions.get(id);
        if (node && initial) {
          node.x = initial.x;
          node.y = initial.y;
          node.fx = initial.fx;
          node.fy = initial.fy;
        }
      }
      graph.reheat(0.2);
    }
    document.querySelectorAll('.graph-dragging').forEach((el) => el.classList.remove('graph-dragging', 'will-pin', 'will-release'));
    document.querySelectorAll('.graph-drop-target').forEach((el) => el.classList.remove('graph-drop-target'));
    elements.binButton?.classList.remove('graph-bin-drop-target');
    removeGraphShiftListeners();
    graphDrag = null;
    return;
  }
  finishMarquee(event);
});

elements.grid.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  event.stopPropagation();
  // Opening the context menu can implicitly cancel an in-progress pointer
  // sequence without ever dispatching pointerup/pointercancel to the grid
  // (observed with Shift+right-click on a folder) — leaving graph-dragging/
  // will-pin/graph-drop-target visuals stuck on whatever tile the pointer
  // last touched. Clear them defensively any time the menu opens.
  document.querySelectorAll('.graph-dragging').forEach((el) => el.classList.remove('graph-dragging', 'will-pin', 'will-release'));
  document.querySelectorAll('.graph-drop-target').forEach((el) => el.classList.remove('graph-drop-target'));
  elements.binButton?.classList.remove('graph-bin-drop-target');
  if (graphDrag) {
    removeGraphShiftListeners();
    graphDrag = null;
  }
  const tile = event.target.closest('.icon-item');
  if (tile && tile.classList.contains('bin-origin-ghost')) return;
  if (tile) {
    if (event.shiftKey && tile.dataset.kind === 'group') {
      const targetSet = graphExpanded;
      const id = tile.dataset.id;
      const folderIds = selected.has(id)
        ? [...selected].filter((selectedId) => group(selectedId))
        : [id];
      const shouldExpand = !targetSet.has(id);
      for (const folderId of folderIds) {
        if (shouldExpand) targetSet.add(folderId);
        else targetSet.delete(folderId);
      }
      closeMenu();
      // Right-clicking a tile moves DOM focus onto it (standard mousedown
      // behavior) even though it's only tabindex="-1" — the plain
      // right-click path clears this because opening the context menu
      // moves focus onto one of its buttons, but this Shift+right-click
      // expand shortcut never opens a menu, so the tile's :focus-visible
      // outline would otherwise stay stuck on screen until something else
      // happens to move focus away.
      tile.blur();
      render();
      saveWorkspaceView();
      return;
    }
    if (!selected.has(tile.dataset.id)) {
      selected = new Set([tile.dataset.id]);
      selectionAnchor = tile.dataset.id;
      syncSelection();
      saveWorkspaceView();
    }
    openMenu(event.clientX, event.clientY);
    return;
  }
  const blank = event.target.closest('[data-blank-parent], [data-icon-grid]');
  if (!blank) return;
  if (binMode) {
    if (selected.size > 0) openMenu(event.clientX, event.clientY);
    return;
  }
  if (selected.size > 0) {
    openMenu(event.clientX, event.clientY);
    return;
  }
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
  if (!elements.editorLayer.hidden || !elements.confirmLayer.hidden || !elements.linkEditLayer.hidden) return;
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
  if (event.ctrlKey && event.key.toLowerCase() === 'a') {
    event.preventDefault();
    selected = new Set(visibleItemIds());
    selectionAnchor = null;
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
    pasteInto(selectedPasteDestinations());
  }
  if (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    undo();
  }
  if (event.ctrlKey && (event.key.toLowerCase() === 'y' || (event.shiftKey && event.key.toLowerCase() === 'z'))) {
    event.preventDefault();
    redo();
  }
  if (event.key === 'Delete' && selected.size > 0) {
    event.preventDefault();
    if (binMode) askPermanentDelete();
    else moveToBin();
  }
  if (event.key === 'Enter' && event.ctrlKey && selected.size > 0 && !binMode) {
    event.preventDefault();
    revealSelection();
    return;
  }
  if (event.key === 'Enter' && selected.size === 1 && !binMode) {
    event.preventDefault();
    activate([...selected][0]);
  }
  if (event.key === 'Enter' && selected.size > 1 && !binMode) {
    event.preventDefault();
    activateSelection();
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

elements.grid.addEventListener('dragover', (event) => {
  if (binMode) return;
  event.preventDefault();
  document.querySelectorAll('.drop-inside, .graph-drop-target').forEach((node) =>
    node.classList.remove('drop-inside', 'graph-drop-target'));
  const types = event.dataTransfer.types;
  if (types.includes('Files') || types.includes('text/plain') || types.includes('text/uri-list')) {
    const tile = event.target.closest('.icon-item');
    const shell = tile?.closest('.graph-node-shell');
    if (tile?.dataset.kind === 'group' && shell) {
      shell.classList.add('graph-drop-target');
      tile.classList.add('drop-inside');
    }
    event.dataTransfer.dropEffect = 'link';
    return;
  }
  event.dataTransfer.dropEffect = 'none';
});

elements.grid.addEventListener('dragleave', (event) => {
  if (!elements.grid.contains(event.relatedTarget)) {
    document.querySelectorAll('.drop-inside, .graph-drop-target').forEach((node) =>
      node.classList.remove('drop-inside', 'graph-drop-target'));
  }
});

/** Pulls the first http(s) URL out of dropped text — dataTransfer's
 * text/uri-list is the canonical source when the browser provides it (a
 * dragged link), but a plain text/plain selection (e.g. a URL the user
 * highlighted and dragged, possibly with surrounding text) needs scanning
 * for the first URL-looking token instead of being used verbatim. */
function extractDroppedUrl(dataTransfer) {
  const uriList = dataTransfer.getData('text/uri-list').trim();
  if (uriList) {
    const firstLine = uriList.split(/\r?\n/).find((line) => line && !line.startsWith('#'));
    if (firstLine) return firstLine.trim();
  }
  const plain = dataTransfer.getData('text/plain').trim();
  const match = plain.match(/https?:\/\/\S+/i);
  return match ? match[0] : plain;
}

function nameForDroppedUrl(url) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./i, '');
    return hostname || url;
  } catch {
    return url;
  }
}

elements.grid.addEventListener('drop', async (event) => {
  if (binMode) return;
  const droppedFiles = [...event.dataTransfer.files];
  const tile = event.target.closest('.icon-item');
  const blank = event.target.closest('[data-blank-parent]');
  const destination = tile?.dataset.kind === 'group'
    ? tile.dataset.id
    : blank?.dataset.blankParent ?? currentId;

  if (droppedFiles.length === 0) {
    const url = extractDroppedUrl(event.dataTransfer);
    if (!url) return;
    event.preventDefault();
    try {
      let name = nameForDroppedUrl(url);
      let icon = null;
      try {
        const resolved = await host.resolveWebIcon(url);
        if (resolved?.title) name = resolved.title;
        if (resolved?.icon) icon = resolved.icon;
      } catch {
        // Fall back to the hostname-derived name/no icon — the link is
        // still worth creating even if the page couldn't be reached.
      }
      const next = createWebLink(state, {
        name,
        target: url,
        icon,
        parentId: destination,
      });
      await commit(next, 'Added.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      document.querySelectorAll('.graph-drop-target').forEach((el) => el.classList.remove('graph-drop-target'));
    }
    return;
  }

  event.preventDefault();
  try {
    const targets = await host.resolveDroppedTargets(droppedFiles);
    const next = createDroppedShortcuts(state, targets, destination);
    if (next.shortcuts.length === state.shortcuts.length) {
      setStatus('Those shortcuts already exist here.');
      return;
    }
    await commit(next);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  } finally {
    document.querySelectorAll('.graph-drop-target').forEach((el) => el.classList.remove('graph-drop-target'));
  }
});

elements.breadcrumbs.addEventListener('click', (event) => {
  const binCrumb = event.target.closest('[data-bin-breadcrumb]');
  if (binCrumb) {
    binCurrentId = binCrumb.dataset.binBreadcrumb;
    selected.clear();
    graph.destroyGraphView();
    render();
    saveWorkspaceView();
    return;
  }
  const crumb = event.target.closest('[data-breadcrumb]');
  if (!crumb) return;
  currentId = crumb.dataset.breadcrumb;
  selected.clear();
  graph.destroyGraphView();
  render();
  saveWorkspaceView();
});

elements.binButton.addEventListener('click', () => {
  if (!binMode && selected.size > 0) {
    moveToBin();
    return;
  }
  binMode = !binMode;
  if (!binMode) binCurrentId = 'bin';
  selected.clear();
  closeMenu();
  render();
  saveWorkspaceView();
});
elements.deleteAllBin.addEventListener('click', () => {
  if (selected.size > 0) {
    askPermanentDelete([...selected], false);
    return;
  }
  askPermanentDelete(binnedItems(state).map((candidate) => candidate.id), true);
});
elements.restoreAllBin.addEventListener('click', () => {
  if (selected.size > 0) {
    askRestoreConfirm([...selected], false);
    return;
  }
  askRestoreConfirm(binnedItems(state).map((candidate) => candidate.id), true);
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
    resolveEditorTargetIcon();
    return;
  }
  resolveEditorTargetIcon();
});
elements.target.addEventListener('input', () => {
  if (editorMode?.kind !== 'web' || editorIcon) return;
  hydrateWebPreview(elements.iconPreview, elements.iconFallback, elements.target.value.trim());
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

const iconDropZone = document.querySelector('.icon-choice');
iconDropZone.addEventListener('dragover', (event) => {
  if (event.dataTransfer.types.includes('Files')) {
    event.preventDefault();
    event.stopPropagation();
    iconDropZone.classList.add('drag-over');
  }
});
iconDropZone.addEventListener('dragleave', () => {
  iconDropZone.classList.remove('drag-over');
});
iconDropZone.addEventListener('drop', async (event) => {
  event.preventDefault();
  event.stopPropagation();
  iconDropZone.classList.remove('drag-over');
  const file = [...event.dataTransfer.files].find((f) => f.type.startsWith('image/'));
  if (!file) {
    elements.editorError.textContent = 'Drop an image file.';
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

document.querySelector('#cancel-link-edit').addEventListener('click', () => {
  elements.linkEditLayer.hidden = true;
});
document.querySelector('#fork-link-edit').addEventListener('click', async () => {
  elements.linkEditLayer.hidden = true;
  await commitEditorSave(true);
});
document.querySelector('#apply-everywhere-link-edit').addEventListener('click', async () => {
  elements.linkEditLayer.hidden = true;
  await commitEditorSave(false);
});

document.querySelector('#cancel-confirm').addEventListener('click', () => {
  pendingPermanentIds = [];
  pendingRestoreIds = [];
  elements.confirmLayer.hidden = true;
});
document.querySelector('#confirm-delete').addEventListener('click', async () => {
  const next = permanentlyDelete(state, pendingPermanentIds);
  pendingPermanentIds = [];
  elements.confirmLayer.hidden = true;
  await commit(next, 'Deleted permanently.');
});
document.querySelector('#confirm-restore').addEventListener('click', async () => {
  const next = restoreSelection(state, pendingRestoreIds);
  pendingRestoreIds = [];
  elements.confirmLayer.hidden = true;
  await commit(next, 'Restored.');
});

document.querySelector('#copy-prompt').addEventListener('click', async () => {
  try {
    const selectedTargets = [...selected]
      .map((selectedId) => shortcutByRecordOrPlacementId(selectedId))
      .filter(Boolean)
      .map((candidate) => candidate.target);
    const text = selectedTargets.length > 0 ? selectedTargets.join('\n') : PICKUP_PROMPT;
    await host.copyText(text);
    document.querySelector('.copy-label').textContent = 'Copied';
    setTimeout(() => {
      document.querySelector('.copy-label').textContent = 'Copy agent pickup prompt';
    }, 1800);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  }
});

const toolbar = createToolbarController({
  window,
  document,
  getState: () => state,
  setState: (next) => { state = next; },
  setToolbarPosition,
  getToolbarPosition,
  persist,
  setStatus,
});

(async () => {
  try {
    const loaded = await host.loadWorkspace();
    state = normalizeState(typeof loaded === 'string' ? JSON.parse(loaded) : loaded);
    restoreWorkspaceView();
    toolbar.mount();
    render();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
    render();
  }
})();

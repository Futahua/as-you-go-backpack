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
import { visibleGraphItems, graphEdges, binOriginEdges, seedPosition, assignSpatialFolderHues } from './graph-model-20260730b.js';
import { hydrateIcons as hydrateIconsScoped, hydrateWebPreview } from './web-link-icon-20260730b.js';
import { createHostBridge } from './app/host/host-bridge.js';
import { compressIconFile } from './app/utilities/image-compression.js';
import { getWorkspaceElements } from './app/dom.js';
import { createToolbarController } from './app/components/toolbar-controller.js';
import { createPickupPromptEditor } from './app/components/pickup-prompt-editor.js';
import { createConfirmationDialog } from './app/components/confirmation-dialog.js';
import { createContextMenu } from './app/components/context-menu.js';
import { createEditorDialog } from './app/components/editor-dialog.js';
import { createBinControls } from './app/components/bin-controls.js';
import { bootstrapWorkspace } from './app/bootstrap.js';
import { createWorkspaceStore } from './app/workspace-store.js';
import { createWorkspaceCommands } from './app/workspace-commands.js';
import { createKeyboardController } from './app/interactions/keyboard-controller.js';
import { createMarqueeController } from './app/interactions/marquee-controller.js';
import { createDropController } from './app/interactions/drop-controller.js';
import { createPointerController } from './app/interactions/pointer-controller.js';

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

const store = createWorkspaceStore({
  getState: () => state,
  setState: (next) => { state = next; },
  normalizeState,
  persist: (snapshot) => host.saveWorkspace(snapshot),
  setStatus,
  initialSession: { currentId: ROOT_ID },
  prepare: (next, session) => captureWorkspaceViewFrom(next, session),
  afterCommit: () => {
    closeMenu();
    render();
  },
});
const session = store.getSession();

let suppressBlankClick = false;
let suppressGraphClick = false;
let zoomTimer = null;

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

function captureWorkspaceViewFrom(currentState, currentSession) {
  return updateWorkspaceView(currentState, {
    currentGroupId: currentSession.currentId,
    graphExpandedGroupIds: [...currentSession.graphExpanded],
    selectedItemIds: [...currentSession.selected],
    binMode: currentSession.binMode,
  });
}

function captureWorkspaceView() {
  return captureWorkspaceViewFrom(state, session);
}

function restoreWorkspaceView() {
  const requestedCurrent = state.view.currentGroupId;
  store.setNavigation({
    currentId:
      requestedCurrent === ROOT_ID || (group(requestedCurrent) && isAvailableItem(requestedCurrent))
        ? requestedCurrent
        : ROOT_ID,
    binMode: state.view.binMode,
  });
  store.setGraphExpanded(
    (state.view.graphExpandedGroupIds ?? []).filter((groupId) =>
      Boolean(group(groupId))),
  );
  const binnedIds = new Set(binnedItems(state).map((candidate) => candidate.id));
  store.setSelection(
    state.view.selectedItemIds.filter((itemId) =>
      store.getSession().binMode ? binnedIds.has(itemId) : isAvailableItem(itemId)),
  );
  store.setSelectionAnchor([...store.getSession().selected].at(-1) ?? null);
  state = store.replace(captureWorkspaceView());
}

function saveWorkspaceView() {
  state = store.replace(captureWorkspaceView());
  void store.save(state).catch((error) =>
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
  let onDragCancel = null;
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

  // Folder hues span the whole color spectrum (see assignSpatialFolderHues),
  // kept per folder id in a session map that carries the relaxation state, so
  // colors follow the folder positions and update as they are dragged.
  const folderColors = new Map();

  function folderColor(id) {
    const hue = folderColors.get(id);
    // OKLCH spacing tracks perceived difference better than HSL; 68% lightness
    // and 0.18 chroma read clearly on the warm paper background.
    return typeof hue === 'number' ? `oklch(68% 0.18 ${hue}deg)` : null;
  }

  function createGraphView() {
    if (attached) return;
    viewport = document.createElement('div');
    viewport.className = 'graph-viewport';
    viewport.id = 'graph-viewport';
    viewport.dataset.blankParent = session.binMode ? 'bin' : session.currentId;

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
    onDragCancel?.();
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
    syncFolderColors();
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
    const ctxId = graphContextId(session.currentId, session.binMode);
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

  /** Frames a folder's icon square with its assigned color; non-folders are
   * left plain. The color is exposed as --folder-color and styled in CSS so
   * it wraps only the icon graphic, not the tile's text. */
  function applyFolderColor(iconItem, candidate) {
    const color = candidate.kind === 'group' ? folderColor(candidate.id) : null;
    iconItem.classList.toggle('folder-colored', Boolean(color));
    if (color) iconItem.style.setProperty('--folder-color', color);
    else iconItem.style.removeProperty('--folder-color');
  }

  /** Recomputes folder hues from their current canvas positions (so colors
   * follow dragging and relative distance), then re-applies only the shells
   * and edges whose color actually changed. */
  function syncFolderColors() {
    const folderNodes = [...nodes.values()].filter(
      (node) => !node.exiting && node.shell && node.candidate?.kind === 'group',
    );
    if (folderNodes.length === 0) return;
    const center = {
      cx: (viewport?.clientWidth ?? 800) / 2,
      cy: (viewport?.clientHeight ?? 600) / 2,
    };
    assignSpatialFolderHues(
      folderNodes.map((node) => ({ id: node.id, x: node.x, y: node.y })),
      folderColors,
      center,
    );
    for (const node of folderNodes) {
      const hue = folderColors.get(node.id);
      if (node.appliedFolderHue === hue) continue;
      node.appliedFolderHue = hue;
      const iconItem = node.shell.querySelector('.icon-item');
      if (iconItem) applyFolderColor(iconItem, node.candidate);
    }
    edges.forEach((edge) => {
      const source = nodes.get(edge.sourceId);
      if (!source || source.candidate?.kind !== 'group' || !edge.path) return;
      const stroke = folderColor(source.candidate.id) ?? '';
      if (edge.appliedStroke === stroke) return;
      edge.appliedStroke = stroke;
      edge.path.style.stroke = stroke;
    });
  }

  function refreshNodeContent(node) {
    if (!node.shell) return;
    const candidate = node.candidate;
    if (!candidate) return;
    const iconItem = node.shell.querySelector('.icon-item');
    if (!iconItem) return;
    applyFolderColor(iconItem, candidate);
    const isGhost = candidate.kind === 'bin-origin';
    const canExpand = candidate.kind === 'group';
    const isExpanded = canExpand && session.graphExpanded.has(candidate.id);
    const isSelected = !isGhost && session.selected.has(candidate.id);
    iconItem.dataset.kind = candidate.kind;
    iconItem.dataset.parent = candidate.parentId ?? (session.binMode ? 'bin' : session.currentId);
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
      session.binMode,
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
    const isSelected = !isGhost && session.selected.has(candidate.id);
    const canExpand = candidate.kind === 'group';
    const isExpanded = canExpand && session.graphExpanded.has(candidate.id);

    const shell = document.createElement('div');
    shell.className = `graph-node-shell${isGhost ? ' bin-origin-ghost' : ''}`;
    shell.dataset.graphNodeId = candidate.id;
    shell.style.transform = `translate3d(${node.x}px, ${node.y}px, 0) translate(-50%, -50%)`;

    const iconItem = document.createElement('div');
    iconItem.className = `icon-item${isSelected ? ' selected' : ''}${isGhost ? ' bin-origin-ghost' : ''}`;
    applyFolderColor(iconItem, candidate);
    iconItem.dataset.id = candidate.id;
    iconItem.dataset.kind = candidate.kind;
    iconItem.dataset.parent = candidate.parentId ?? (session.binMode ? 'bin' : session.currentId);
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
      session.binMode,
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
      // Edge stroke colors are owned by syncFolderColors, which recomputes them
      // from folder positions each frame.
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
    const visible = visibleGraphItems(state, session.currentId, session.graphExpanded, session.binMode, session.binCurrentId);
    if (visible.length === 0) {
      nodes.forEach((_, id) => removeNode(id));
      syncEdges([]);
      syncOriginEdges([]);
      return;
    }
    const originEdges = session.binMode ? binOriginEdges(visible) : [];
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
      const isSelected = session.selected.has(node.id);
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
    _setOnDragCancel(callback) { onDragCancel = callback; },
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
  if (session.binMode && session.binCurrentId !== 'bin' && !group(session.binCurrentId)?.bin) {
    // The folder we'd drilled into was restored or deleted out from under
    // us (e.g. via the top-level Bin list or "Delete all") — fall back to
    // the top of the Bin rather than rendering a dangling, nonexistent
    // breadcrumb segment.
    store.setNavigation({ binCurrentId: 'bin' });
  }
  const iconSize = state.view.iconSize;
  document.documentElement.style.setProperty('--icon-size', `${iconSize}px`);
  elements.breadcrumbs.innerHTML = session.binMode
    ? pathToBin(session.binCurrentId === 'bin' ? null : session.binCurrentId).map((candidate, index, path) =>
        `<button type="button" data-bin-breadcrumb="${candidate.id}">${escapeHtml(candidate.name)}</button>${index < path.length - 1 ? '<span aria-hidden="true">›</span>' : ''}`,
      ).join('')
    : pathTo(session.currentId).map((candidate, index, path) =>
        `<button type="button" data-breadcrumb="${candidate.id}">${escapeHtml(candidate.name)}</button>${index < path.length - 1 ? '<span aria-hidden="true">›</span>' : ''}`,
      ).join('');

  const visible = session.binMode
    ? (session.binCurrentId === 'bin' ? binnedItems(state) : itemsInBinnedGroup(state, session.binCurrentId))
    : itemsIn(state, session.currentId);
  elements.grid.dataset.blankParent = session.binMode ? session.binCurrentId : session.currentId;
  elements.grid.dataset.view = 'graph';
  elements.grid.classList.toggle('bin-canvas', session.binMode);

  if (!graph.isAttached) {
    elements.grid.innerHTML = '';
    renderGraph(true);
  } else {
    graph.updateGraphView(false);
  }
  elements.empty.hidden = visible.length !== 0;
  elements.empty.textContent = session.binMode
    ? (session.binCurrentId === 'bin' ? 'The Bin is empty.' : 'Nothing left here.')
    : 'This folder is empty. Right-click here to add something.';

  syncSelection();

  const binCount = binnedItems(state).length;
  elements.binCount.hidden = binCount === 0;
  elements.binCount.textContent = String(binCount);
  elements.binButton.setAttribute('aria-pressed', String(session.binMode));
  elements.binLabel.textContent = session.binMode ? 'Close Bin' : 'Bin';
  elements.binButton.title = session.binMode ? 'Close Bin' : 'Bin';
  const hasSelection = session.binMode && session.selected.size > 0;
  elements.deleteAllBin.hidden = !session.binMode || binCount === 0;
  elements.restoreAllBin.hidden = !session.binMode || binCount === 0;
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
      const isSelected = session.selected.has(tile.dataset.id);
      tile.classList.toggle('selected', isSelected);
      tile.setAttribute('aria-selected', String(isSelected));
    });
  }
  elements.selectionStatus.hidden = session.selected.size === 0;
  elements.selectionStatus.textContent = session.selected.size === 1
    ? '1 item selected'
    : `${session.selected.size} items selected`;
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
  return store.save(nextState);
}

async function commit(nextState, options = {}) {
  return store.commit(nextState, options);
}

function visibleItemIds() {
  return [...elements.grid.querySelectorAll('.icon-item')].map((node) => node.dataset.id);
}

function currentSelectionParent() {
  const first = item([...session.selected][0]);
  return first?.parentId ?? session.currentId;
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


async function runMenuAction(action) {
  const onlyId = session.selected.size === 1 ? [...session.selected][0] : null;
  if (action === 'new-folder') return editorDialog.showEditor('group', null, elements.menu.dataset.parent);
  if (action === 'new-shortcut') return editorDialog.showEditor('shortcut', null, elements.menu.dataset.parent);
  if (action === 'new-web-link') return editorDialog.showEditor('web', null, elements.menu.dataset.parent);
  if (action === 'paste') return commands.pasteInto(elements.menu.dataset.parent);
  if (action === 'open' && onlyId) return commands.activateItem(onlyId);
  if (action === 'edit' && onlyId) {
    const chosen = shortcut(onlyId);
    return editorDialog.showEditor(isWebLink(chosen) ? 'web' : 'shortcut', chosen);
  }
  if (action === 'rename' && onlyId) return editorDialog.showEditor('group', group(onlyId));
  if (action === 'copy') return commands.copySelection();
  if (action === 'cut') return commands.cutSelection();
  if (action === 'bin') return commands.moveSelectionToBin();
  if (action === 'restore') return confirmDialog.askRestoreConfirm([...session.selected]);
  if (action === 'delete-forever') return confirmDialog.askPermanentDelete();
  if (action === 'reset-graph-position') return commands.resetGraphPositions();
}

elements.grid.addEventListener('click', (event) => {
  event.stopPropagation();
  const expandButton = event.target.closest('[data-expand]');
  if (expandButton) {
    const folderId = expandButton.dataset.expand;
    store.toggleGraphExpanded(folderId);
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
    commands.selectItem(tile.dataset.id, {
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      visibleItemIds: visibleItemIds(),
    });
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
    store.clearSelection();
    store.setSelectionAnchor(null);
    syncSelection();
    closeMenu();
    saveWorkspaceView();
  }
});


elements.grid.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  event.stopPropagation();
  // Opening the context menu can implicitly cancel an in-progress pointer
  // sequence without ever dispatching pointerup/pointercancel to the grid
  // (observed with Shift+right-click on a folder) — leaving graph-dragging/
  // will-pin/graph-drop-target visuals stuck on whatever tile the pointer
  // last touched. Cancel the drag defensively any time the menu opens.
  pointer.cancelDrag();
  const tile = event.target.closest('.icon-item');
  if (tile && tile.classList.contains('bin-origin-ghost')) return;
  if (tile) {
    if (event.shiftKey && tile.dataset.kind === 'group') {
      const id = tile.dataset.id;
      const folderIds = session.selected.has(id)
        ? [...session.selected].filter((selectedId) => group(selectedId))
        : [id];
      const shouldExpand = !session.graphExpanded.has(id);
      for (const folderId of folderIds) {
        if (shouldExpand) store.addToGraphExpanded(folderId);
        else store.removeFromGraphExpanded(folderId);
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
    if (!session.selected.has(tile.dataset.id)) {
      store.setSelection([tile.dataset.id]);
      store.setSelectionAnchor(tile.dataset.id);
      syncSelection();
      saveWorkspaceView();
    }
    openMenu(event.clientX, event.clientY);
    return;
  }
  const blank = event.target.closest('[data-blank-parent], [data-icon-grid]');
  if (!blank) return;
  if (session.binMode) {
    if (session.selected.size > 0) openMenu(event.clientX, event.clientY);
    return;
  }
  if (session.selected.size > 0) {
    openMenu(event.clientX, event.clientY);
    return;
  }
  openMenu(
    event.clientX,
    event.clientY,
    'blank',
    blank.dataset.blankParent ?? session.currentId,
  );
});

document.addEventListener('click', (event) => {
  if (!elements.menu.hidden && !event.target.closest('#context-menu') && !event.target.closest('.icon-item')) {
    closeMenu();
  }
});

elements.explorer.addEventListener('wheel', (event) => {
  if (!event.ctrlKey) return;
  event.preventDefault();
  state = store.replace(setIconSize(state, state.view.iconSize + (event.deltaY < 0 ? 12 : -12)));
  render();
  clearTimeout(zoomTimer);
  zoomTimer = setTimeout(() => persist().catch((error) => setStatus(String(error))), 250);
}, { passive: false });

elements.breadcrumbs.addEventListener('click', (event) => {
  const binCrumb = event.target.closest('[data-bin-breadcrumb]');
  if (binCrumb) {
    store.setNavigation({ binCurrentId: binCrumb.dataset.binBreadcrumb });
    store.clearSelection();
    graph.destroyGraphView();
    render();
    saveWorkspaceView();
    return;
  }
  const crumb = event.target.closest('[data-breadcrumb]');
  if (!crumb) return;
  store.setNavigation({ currentId: crumb.dataset.breadcrumb });
  store.clearSelection();
  graph.destroyGraphView();
  render();
  saveWorkspaceView();
});

document.querySelector('#copy-prompt').addEventListener('click', async () => {
  try {
    const selectedTargets = [...session.selected]
      .map((selectedId) => shortcutByRecordOrPlacementId(selectedId))
      .filter(Boolean)
      .map((candidate) => candidate.target);
    const text = selectedTargets.length > 0
      ? selectedTargets.join('\n')
      : ((typeof state.view?.pickupPrompt === 'string' && state.view.pickupPrompt)
          ? state.view.pickupPrompt
          : PICKUP_PROMPT);
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
  setState: (next) => { state = store.replace(next); },
  setToolbarPosition,
  getToolbarPosition,
  persist,
  setStatus,
});

const confirmDialog = createConfirmationDialog({
  elements,
  getState: () => state,
  getSelectedIds: () => [...session.selected],
  binItemName,
  permanentlyDelete,
  restoreSelection,
  commit,
});

const menu = createContextMenu({
  elements,
  window,
  getCurrentId: () => session.currentId,
  getBinMode: () => session.binMode,
  getClipboard: () => session.clipboard,
  getSelectedItems: () => [...session.selected].map(item).filter(Boolean),
  isWebLink,
  onAction: runMenuAction,
});
// Thin compatibility shims so the entry file's existing call sites stay put
// while the context menu's real implementation lives in the module above.
const closeMenu = () => menu.closeMenu();
const openMenu = (...args) => menu.openMenu(...args);

// Constructed after graph and closeMenu are initialized (both are consts
// declared later in the file); evaluating graph/closeMenu as argument
// values any earlier would hit the temporal dead zone.
const commands = createWorkspaceCommands({
  store,
  group,
  shortcut,
  item,
  isWebLink,
  host,
  graph,
  resolveBinTargets,
  visiblePlacementIdFor,
  visibleParentCountFor,
  allActivePlacementIds,
  anyActivePlacementId,
  moveSelection,
  copySelection,
  collapsePlacements,
  binSelection,
  graphContextId,
  removeGraphPositions,
  setGraphPositions,
  createWebLink,
  createDroppedShortcuts,
  syncSelection,
  saveWorkspaceView,
  closeMenu,
  render,
  setStatus,
});

// Constructed after commands: the controller delegates session mutation and
// persistence to the marquee commands.
const marquee = createMarqueeController({
  elements,
  commands,
  itemsIntersectingMarquee,
});

const drop = createDropController({
  document,
  elements,
  store,
  commands,
});

const pointer = createPointerController({
  window,
  document,
  elements,
  store,
  commands,
  graph,
  marquee,
  zoomTransform,
  group,
  visiblePlacementIdFor,
  closeMenu,
  setSuppressGraphClick: (value) => { suppressGraphClick = value; },
  setSuppressBlankClick: (value) => { suppressBlankClick = value; },
  consumeSuppressGraphClick: () => {
    if (!suppressGraphClick) return false;
    suppressGraphClick = false;
    return true;
  },
});
graph._setOnDragCancel(() => pointer.cancelDrag());

const editorDialog = createEditorDialog({
  elements,
  document,
  getState: () => state,
  getCurrentId: () => session.currentId,
  closeMenu,
  host,
  iconCache,
  compressIconFile,
  hydrateWebPreview,
  commit,
  render,
  shortcut,
  isWebLink,
  placementCount,
  forkPlacement,
  anyActivePlacementId,
  visiblePlacementIdFor,
  updateGroup,
  createGroup,
  updateWebLink,
  createWebLink,
  updateShortcut,
  createShortcut,
});
const showEditor = (...args) => editorDialog.showEditor(...args);

const binControls = createBinControls({
  elements,
  getState: () => state,
  getBinMode: () => session.binMode,
  setBinMode: (next) => store.setNavigation({ binMode: next }),
  getSelectedIds: () => [...session.selected],
  clearSelection: () => { store.clearSelection(); },
  resetDrillDown: () => store.setNavigation({ binCurrentId: 'bin' }),
  binnedItems,
  moveToBin: () => commands.moveSelectionToBin(),
  confirmDialog,
  closeMenu,
  render,
  saveWorkspaceView,
});

const keyboard = createKeyboardController({
  document,
  elements,
  store,
  commands,
  closeMenu,
  getVisibleItemIds: visibleItemIds,
  confirmDialog,
});

const promptEditor = createPickupPromptEditor({
  document,
  store,
  fallbackPrompt: PICKUP_PROMPT,
});

bootstrapWorkspace({
  loadState: () => host.loadWorkspace(),
  setState: (next) => { state = store.install(next); },
  restoreWorkspaceView,
  setStatus,
  render,
  toolbar,
  confirmDialog,
  menu,
  editorDialog,
  binControls,
  keyboard,
  drop,
  pointer,
  promptEditor,
});

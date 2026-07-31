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
  graphContextId,
  getGraphPosition,
  setGraphPositions,
  removeGraphPositions,
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
import { visibleGraphItems, graphEdges, seedPosition } from './graph-model-20260730b.js';

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
let explorerExpanded = new Set();
let graphExpanded = new Set();
let clipboard = null;
let editorMode = null;
let editorIcon = null;
let editorTargetIcon = null;
let binMode = false;
let layout = 'explorer';
let dragIds = [];
let marqueeDrag = null;
let suppressBlankClick = false;
let suppressGraphClick = false;
let pendingPermanentIds = [];
let zoomTimer = null;
let saveQueue = Promise.resolve();
let graphDrag = null;

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
    expandedGroupIds: [...explorerExpanded],
    graphExpandedGroupIds: [...graphExpanded],
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
  explorerExpanded = new Set(
    state.view.expandedGroupIds.filter((groupId) =>
      Boolean(group(groupId)) && isAvailableItem(groupId)),
  );
  graphExpanded = new Set(
    (state.view.graphExpandedGroupIds ?? []).filter((groupId) =>
      Boolean(group(groupId))),
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
    const isExpanded = canExpand && explorerExpanded.has(candidate.id);
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

const graph = createGraphController();

function createGraphController() {
  const nodes = new Map();
  const edges = new Map();
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
    if (simulation) { simulation.stop(); simulation = null; }
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; pendingFrame = false; }
    nodes.forEach((node) => {
      if (node.exitTimer) { clearTimeout(node.exitTimer); node.exitTimer = null; }
    });
    if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null; }
    nodes.clear();
    edges.clear();
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
  }

  function edgePath(x1, y1, x2, y2) {
    const mx = (x1 + x2) / 2;
    return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
  }

  function buildCandidate(vi) {
    const stored = item(vi.id);
    if (!stored) return null;
    return { ...stored, kind: vi.kind };
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
        node.childIds = childIdsFor(vi);
        node.parentNode = parentOfNode(vi);
        node.depth = vi.depth;
        refreshNodeContent(node);
        continue;
      }
      const candidate = buildCandidate(vi);
      if (!candidate) continue;
      const parent = candidate.parentId && candidate.parentId !== ROOT_ID && candidate.parentId !== 'bin'
        ? nodes.get(candidate.parentId)
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
        childIds: childIdsFor(vi),
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

  function parentOfNode(vi) {
    if (!vi.parentId || vi.parentId === ROOT_ID || vi.parentId === 'bin') return null;
    return nodes.get(vi.parentId) ?? null;
  }

  function childIdsFor(vi) {
    if (binMode || vi.kind !== 'group' || !graphExpanded.has(vi.id)) return [];
    return itemsIn(state, vi.id).map((c) => c.id);
  }

  function refreshNodeContent(node) {
    if (!node.shell) return;
    const candidate = node.candidate;
    if (!candidate) return;
    const iconItem = node.shell.querySelector('.icon-item');
    if (!iconItem) return;
    const canExpand = candidate.kind === 'group' && !binMode;
    const isExpanded = canExpand && graphExpanded.has(candidate.id);
    const isSelected = selected.has(candidate.id);
    iconItem.dataset.kind = candidate.kind;
    iconItem.dataset.parent = binMode ? 'bin' : (candidate.parentId ?? currentId);
    iconItem.setAttribute('draggable', 'false');
    iconItem.setAttribute('aria-selected', String(isSelected));
    iconItem.classList.toggle('selected', isSelected);
    const signature = JSON.stringify([
      candidate.kind,
      candidate.name,
      candidate.description ?? '',
      candidate.target ?? '',
      candidate.icon ?? null,
      isExpanded,
      binMode,
      state.view.iconSize,
    ]);
    if (node.contentSignature !== signature) {
      node.contentSignature = signature;
      iconItem.innerHTML =
        `${canExpand ? `<button class="folder-expander ${isExpanded ? 'expanded' : ''}" data-expand="${candidate.id}" type="button" aria-label="${isExpanded ? 'Collapse' : 'Expand'} ${escapeHtml(candidate.name)}">›</button>` : ''}`
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
    const isSelected = selected.has(candidate.id);
    const canExpand = candidate.kind === 'group' && !binMode;
    const isExpanded = canExpand && graphExpanded.has(candidate.id);

    const shell = document.createElement('div');
    shell.className = 'graph-node-shell';
    shell.dataset.graphNodeId = candidate.id;
    shell.style.transform = `translate3d(${node.x}px, ${node.y}px, 0) translate(-50%, -50%)`;

    const iconItem = document.createElement('div');
    iconItem.className = `icon-item${isSelected ? ' selected' : ''}`;
    iconItem.dataset.id = candidate.id;
    iconItem.dataset.kind = candidate.kind;
    iconItem.dataset.parent = binMode ? 'bin' : (candidate.parentId ?? currentId);
    iconItem.setAttribute('draggable', 'false');
    iconItem.setAttribute('role', 'option');
    iconItem.setAttribute('aria-selected', String(isSelected));
    iconItem.setAttribute('tabindex', '-1');
    iconItem.innerHTML =
      `${canExpand ? `<button class="folder-expander ${isExpanded ? 'expanded' : ''}" data-expand="${candidate.id}" type="button" aria-label="${isExpanded ? 'Collapse' : 'Expand'} ${escapeHtml(candidate.name)}">›</button>` : ''}`
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

  function syncEdges() {
    if (!edgeLayer) return;
    const wanted = new Map();
    nodes.forEach((node) => {
      if (node.exiting) return;
      for (const childId of node.childIds) {
        const child = nodes.get(childId);
        if (!child || child.exiting) continue;
        const key = `${node.id}->${childId}`;
        wanted.set(key, { sourceId: node.id, targetId: childId });
      }
    });
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
    const visible = visibleGraphItems(state, currentId, graphExpanded, binMode);
    if (visible.length === 0) {
      nodes.forEach((_, id) => removeNode(id));
      return;
    }
    syncNodes(visible);
    syncEdges();
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
  const iconSize = state.view.iconSize;
  document.documentElement.style.setProperty('--icon-size', `${iconSize}px`);
  elements.breadcrumbs.innerHTML = binMode
    ? '<span class="bin-crumb">Bin</span>'
    : pathTo(currentId).map((candidate, index, path) =>
        `<button type="button" data-breadcrumb="${candidate.id}">${escapeHtml(candidate.name)}</button>${index < path.length - 1 ? '<span aria-hidden="true">›</span>' : ''}`,
      ).join('');

  const visible = binMode ? binnedItems(state) : itemsIn(state, currentId);
  elements.grid.dataset.blankParent = binMode ? 'bin' : currentId;
  elements.grid.dataset.view = layout;

  if (layout === 'graph') {
    if (!graph.isAttached) {
      elements.grid.innerHTML = '';
      console.assert(
        elements.grid.querySelectorAll('.graph-viewport').length === 0
      );
      console.assert(
        elements.grid.querySelectorAll('.expanded-branch').length === 0
      );
      console.assert(
        elements.grid.querySelectorAll('.nested-icon-grid').length === 0
      );
      renderGraph(true);
    } else {
      graph.updateGraphView(false);
    }
    console.assert(
      elements.grid.querySelectorAll('.graph-viewport').length === 1
    );
    console.assert(
      [...elements.grid.querySelectorAll('.icon-item')]
        .every(item => item.closest('.graph-node-shell'))
    );
  } else {
    if (graph.isAttached) graph.destroyGraphView();
    elements.grid.innerHTML = '';
    console.assert(
      elements.grid.querySelectorAll('.graph-viewport').length === 0
    );
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
  if (layout === 'graph' && graph.isAttached) {
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

function hydrateNodeIcons(shell) {
  if (!shell) return;
  const images = [...shell.querySelectorAll('[data-default-icon]')];
  images.forEach(async (image) => {
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
  });
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
      layout === 'graph' ? '<hr />' : '',
      layout === 'graph'
        ? menuButton('reset-graph-position', chosen.length > 1 ? 'Follow folders automatically' : 'Follow folder automatically')
        : '',
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
    if (layout === 'graph') graph.destroyGraphView();
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
    const targetSet = layout === 'graph' ? graphExpanded : explorerExpanded;
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

  if (layout === 'graph' && !event.target.closest('[data-expand]') && !event.target.closest('button')) {
    const tile = event.target.closest('.icon-item');
    const shell = tile?.closest('.graph-node-shell');
    if (shell && event.pointerType !== 'touch') {
      const itemId = tile.dataset.id;
      if (!selected.has(itemId)) {
        selected = new Set([itemId]);
        selectionAnchor = itemId;
        syncSelection();
        saveWorkspaceView();
      }
      graphDrag = {
        pointerId: event.pointerId,
        itemIds: [...selected],
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
    if (!graphDrag.thresholdPassed) {
      const dx = event.clientX - graphDrag.startClientX;
      const dy = event.clientY - graphDrag.startClientY;
      if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
      graphDrag.thresholdPassed = true;
      graphDrag.moved = true;
      elements.grid.setPointerCapture(event.pointerId);
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
      suppressGraphClick = true;
      document.querySelectorAll('.graph-dragging').forEach((el) => el.classList.remove('graph-dragging', 'will-pin', 'will-release'));
      document.querySelectorAll('.graph-drop-target').forEach((el) => el.classList.remove('graph-drop-target'));
      const shells = [...elements.grid.querySelectorAll('.graph-node-shell')];
      shells.forEach((s) => s.style.pointerEvents = '');
      let hitFolderId = null;
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

      const graphDragCopy = { ...graphDrag, itemIds: [...graphDrag.itemIds] };
      graphDrag = null;

      if (hitFolderId) {
        try {
          const next = moveSelection(state, graphDragCopy.itemIds, hitFolderId);
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
    graphDrag = null;
    return;
  }

  if (marqueeDrag) {
    finishMarquee(event);
  }
});

elements.grid.addEventListener('dblclick', (event) => {
  if (suppressGraphClick) {
    suppressGraphClick = false;
    return;
  }
  const tile = event.target.closest('.icon-item');
  if (tile) activate(tile.dataset.id);
});

elements.grid.addEventListener('pointercancel', (event) => {
  if (graphDrag && event.pointerId === graphDrag.pointerId) {
    if (elements.grid.hasPointerCapture(event.pointerId)) {
      elements.grid.releasePointerCapture(event.pointerId);
    }
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
    graphDrag = null;
    return;
  }
  finishMarquee(event);
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
  if (layout === 'graph') return;
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

  if (layout === 'graph') {
    document.querySelectorAll('.drop-inside, .drop-before, .graph-drop-target').forEach((node) =>
      node.classList.remove('drop-inside', 'drop-before', 'graph-drop-target'));
    if (event.dataTransfer.types.includes('Files')) {
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
    return;
  }

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
    document.querySelectorAll('.drop-inside, .drop-before, .graph-drop-target').forEach((node) =>
      node.classList.remove('drop-inside', 'drop-before', 'graph-drop-target'));
  }
});

elements.grid.addEventListener('drop', async (event) => {
  if (binMode) return;
  const droppedFiles = [...event.dataTransfer.files];

  if (layout === 'graph') {
    if (droppedFiles.length > 0) {
      event.preventDefault();
      const tile = event.target.closest('.icon-item');
      const shell = tile?.closest('.graph-node-shell');
      const blank = event.target.closest('[data-blank-parent]');
      const destination = tile?.dataset.kind === 'group'
        ? tile.dataset.id
        : blank?.dataset.blankParent ?? currentId;
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
        document.querySelectorAll('.graph-drop-target').forEach((el) => el.classList.remove('graph-drop-target'));
      }
    }
    return;
  }

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
  if (layout === 'graph') graph.destroyGraphView();
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

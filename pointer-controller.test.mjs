import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkspaceStore } from './public/app/workspace-store.js';
import { createPointerController } from './public/app/interactions/pointer-controller.js';

function fakeNode() {
  return {
    style: {},
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); },
      toggle(c, force) {
        const on = force === undefined ? !this._s.has(c) : force;
        if (on) this._s.add(c); else this._s.delete(c);
        return on;
      },
    },
    _listeners: [],
    addEventListener(type, handler, options) {
      const entry = { type, handler, options };
      this._listeners.push(entry);
      if (options?.signal) {
        options.signal.addEventListener('abort', () => {
          const index = this._listeners.indexOf(entry);
          if (index >= 0) this._listeners.splice(index, 1);
        });
      }
    },
    _dispatch(type, event) {
      for (const entry of [...this._listeners]) {
        if (entry.type === type) entry.handler(event);
      }
    },
  };
}

function createHarness({ binMode = false } = {}) {
  const store = createWorkspaceStore({
    getState: () => ({}),
    setState: () => {},
    persist: async () => {},
    normalizeState: (s) => s,
    setStatus: () => {},
    initialSession: { binMode },
  });
  const grid = fakeNode();
  grid.setPointerCapture = () => {};
  grid.hasPointerCapture = () => true;
  let released = 0;
  grid.releasePointerCapture = () => { released += 1; };
  grid.querySelector = () => null;
  let shells = [];
  grid.querySelectorAll = () => shells;
  const binButton = fakeNode();
  binButton.contains = () => false;
  const elements = { grid, binButton };
  const windowListeners = [];
  const windowMock = {
    addEventListener(type, handler, options) {
      windowListeners.push({ type, handler, options });
    },
    removeEventListener(type, handler) {
      const index = windowListeners.findIndex((e) => e.type === type && e.handler === handler);
      if (index >= 0) windowListeners.splice(index, 1);
    },
  };
  let elementAtPoint = null;
  const documentMock = { querySelectorAll: () => shells, elementFromPoint: () => elementAtPoint };
  const commandCalls = [];
  const commands = {
    selectItem: (id, opts) => { commandCalls.push(['select', id, opts]); },
    activateItem: (id, opts) => { commandCalls.push(['activate', id, opts]); },
    dragDropToBin: (input) => { commandCalls.push(['bin', input]); },
    dragDropToFolder: (input) => { commandCalls.push(['folder', input]); },
    pinDraggedNodes: (input) => { commandCalls.push(['pin', input]); },
    releaseDraggedNodes: (input) => { commandCalls.push(['release', input]); },
  };
  const graphNodes = new Map();
  const effects = { reheat: [], decay: 0, close: 0, suppressGraph: [], suppressBlank: [] };
  // Set regions the drag rules are judged against. Tests supply a predicate
  // over a world position; by default nothing is inside any set.
  // A drag freezes the regions at drag start via getSetRegions, so the mock
  // answers the snapshot query separately from the live one: a test can let a
  // mid-drag redraw change the live geometry while the snapshot — the thing
  // the drag is actually judged against — stays fixed.
  const snapshotToken = {};
  // Which items each drop handed to the settlement pass as anchors.
  const settleCalls = [];
  let snapshotAtPoint = () => [];
  let liveAtPoint = () => [];
  let dropRule = () => true;
  const graph = {
    _getNode: (id) => graphNodes.get(id) ?? null,
    reheat: (a) => { effects.reheat.push(a); },
    _setSimulationDecay: () => { effects.decay += 1; },
    getSetRegions: () => snapshotToken,
    setIdsAtPoint: (point, regions) =>
      regions === snapshotToken ? snapshotAtPoint(point) : liveAtPoint(point),
    // The real one sweeps the item's whole rectangle along the whole path and
    // stops it at the first membrane. The mock keeps that contract — walk the
    // segment, return the last position the drop rule accepts — over the same
    // point predicate the rest of the harness uses, so a test can express a
    // wall as "past x=150 is set A" and still exercise clamping rather than
    // destination testing.
    settleAroundAnchors: (anchorIds) => { settleCalls.push(anchorIds); },
    constrainSetMotion: (itemId, from, to, regions) => {
      const at = (point) => (regions === snapshotToken ? snapshotAtPoint(point) : liveAtPoint(point));
      const allowed = (point) => dropRule(itemId, at(point));
      if (!allowed(from)) return { x: to.x, y: to.y, blocked: false };
      const steps = 64;
      let last = { x: from.x, y: from.y };
      for (let i = 1; i <= steps; i += 1) {
        const t = i / steps;
        const point = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
        if (!allowed(point)) return { ...last, blocked: true };
        last = point;
      }
      return { x: to.x, y: to.y, blocked: false };
    },
  };
  let marqueeActivePointer = null;
  const marquee = {
    isActive: (pointerId) => marqueeActivePointer === pointerId,
    start: (input) => { commandCalls.push(['marquee-start', input]); },
    move: (input) => { commandCalls.push(['marquee-move', input]); },
    finish: (pointerId) => { marqueeActivePointer = null; return true; },
  };
  let suppressGraphClickFlag = false;
  const controller = createPointerController({
    window: windowMock,
    document: documentMock,
    elements,
    store,
    commands,
    graph,
    marquee,
    zoomTransform: () => ({ x: 0, y: 0, k: 1 }),
    canDropInsideRegions: (itemId, regionSetIds) => dropRule(itemId, regionSetIds),
    group: () => null,
    visiblePlacementIdFor: (id) => `p-${id}`,
    closeMenu: () => { effects.close += 1; },
    setSuppressGraphClick: (v) => { effects.suppressGraph.push(v); },
    setSuppressBlankClick: (v) => { effects.suppressBlank.push(v); },
    consumeSuppressGraphClick: () => {
      if (!suppressGraphClickFlag) return false;
      suppressGraphClickFlag = false;
      return true;
    },
  });
  controller.mount();
  return {
    setRegionsAtPoint: (fn) => { snapshotAtPoint = fn; liveAtPoint = fn; },
    setSnapshotRegionsAtPoint: (fn) => { snapshotAtPoint = fn; },
    setLiveRegionsAtPoint: (fn) => { liveAtPoint = fn; },
    setDropRule: (fn) => { dropRule = fn; },
    controller, grid, binButton, store, commands, commandCalls, graphNodes, effects, windowListeners, marquee,
    settleCalls,
    getShells: () => shells,
    setShells: (value) => { shells = value; },
    setElementAtPoint: (value) => { elementAtPoint = value; },
    getReleased: () => released,
    setSuppressGraphClickFlag: (value) => { suppressGraphClickFlag = value; },
    getSuppressGraphClickFlag: () => suppressGraphClickFlag,
  };
}

function node(id, x = 0, y = 0) {
  const shell = fakeNode();
  shell.dataset = { graphNodeId: id };
  return { id, x, y, fx: null, fy: null, positioned: false, shell };
}

function pointerEvent(pointerId, clientX, clientY, overrides = {}) {
  return {
    button: 0,
    pointerId,
    clientX,
    clientY,
    pointerType: 'mouse',
    ctrlKey: false,
    shiftKey: false,
    preventDefault() {},
    target: { closest: () => null },
    dataTransfer: undefined,
    ...overrides,
  };
}

test('pointerdown on a tile routes selection and starts a graph drag', () => {
  const h = createHarness();
  const tile = fakeNode();
  tile.dataset = { id: 's1', kind: 'shortcut' };
  const shell = fakeNode();
  tile.closest = (sel) => (sel === '.icon-item' ? tile : sel === '.graph-node-shell' ? shell : null);
  const event = pointerEvent(1, 10, 10, { target: tile });
  h.graphNodes.set('s1', node('s1'));
  h.grid._dispatch('pointerdown', event);
  assert.deepEqual(h.commandCalls[0], ['select', 's1', { shiftKey: false, ctrlKey: false, visibleItemIds: [] }]);
});

test('pointermove beyond threshold moves the dragged nodes', () => {
  const h = createHarness();
  const n = node('s1', 100, 100);
  h.graphNodes.set('s1', n);
  h.store.setSelection(['s1']);
  const tile = fakeNode();
  tile.dataset = { id: 's1', kind: 'shortcut' };
  tile.closest = (sel) => (sel === '.icon-item' ? tile : sel === '.graph-node-shell' ? tile : null);
  h.grid._dispatch('pointerdown', pointerEvent(1, 10, 10, { target: tile }));
  h.grid._dispatch('pointermove', pointerEvent(1, 20, 15));
  assert.equal(n.moved, undefined);
  assert.equal(n.fx, 110); // startWorld derived from client coords with identity transform
  assert.equal(n.fy, 105);
  assert.ok(h.effects.reheat.length > 0);
});

test('pointerup on the Bin routes dragDropToBin', () => {
  const h = createHarness();
  const n = node('s1', 100, 100);
  h.graphNodes.set('s1', n);
  h.store.setSelection(['s1']);
  const tile = fakeNode();
  tile.dataset = { id: 's1', kind: 'shortcut' };
  tile.closest = (sel) => (sel === '.icon-item' ? tile : sel === '.graph-node-shell' ? tile : null);
  h.grid._dispatch('pointerdown', pointerEvent(1, 10, 10, { target: tile }));
  h.grid._dispatch('pointermove', pointerEvent(1, 20, 15));
  h.binButton.contains = () => true;
  h.grid._dispatch('pointerup', pointerEvent(1, 20, 15));
  const binCall = h.commandCalls.find(([name]) => name === 'bin');
  assert.ok(binCall);
  assert.deepEqual(binCall[1].itemIds, ['s1']);
  assert.equal(h.effects.suppressGraph.at(-1), true);
});

test('pointerup pin routes pinDraggedNodes with positions', () => {
  const h = createHarness();
  const n = node('s1', 100, 100);
  h.graphNodes.set('s1', n);
  h.store.setSelection(['s1']);
  const tile = fakeNode();
  tile.dataset = { id: 's1', kind: 'shortcut' };
  tile.closest = (sel) => (sel === '.icon-item' ? tile : sel === '.graph-node-shell' ? tile : null);
  h.grid._dispatch('pointerdown', pointerEvent(1, 10, 10, { target: tile }));
  h.grid._dispatch('pointermove', pointerEvent(1, 20, 15, { shiftKey: true }));
  h.grid._dispatch('pointerup', pointerEvent(1, 20, 15, { shiftKey: true }));
  const pinCall = h.commandCalls.find(([name]) => name === 'pin');
  assert.ok(pinCall);
  assert.ok(pinCall[1].positions.s1);
  assert.equal(h.effects.decay, 1);
});

test('pointerup without pin routes releaseDraggedNodes', () => {
  const h = createHarness();
  const n = node('s1', 100, 100);
  h.graphNodes.set('s1', n);
  h.store.setSelection(['s1']);
  const tile = fakeNode();
  tile.dataset = { id: 's1', kind: 'shortcut' };
  tile.closest = (sel) => (sel === '.icon-item' ? tile : sel === '.graph-node-shell' ? tile : null);
  h.grid._dispatch('pointerdown', pointerEvent(1, 10, 10, { target: tile }));
  h.grid._dispatch('pointermove', pointerEvent(1, 20, 15));
  h.grid._dispatch('pointerup', pointerEvent(1, 20, 15));
  const releaseCall = h.commandCalls.find(([name]) => name === 'release');
  assert.ok(releaseCall);
  assert.deepEqual(releaseCall[1].itemIds, ['s1']);
});

test('pointerdown on blank starts the marquee', () => {
  const h = createHarness();
  const event = pointerEvent(1, 30, 30);
  event.target.closest = (sel) => (sel.includes('data-icon-grid') ? { dataset: {} } : null);
  h.grid._dispatch('pointerdown', event);
  assert.ok(h.commandCalls.some(([name]) => name === 'marquee-start'));
});

test('cancelDrag removes shift listeners and clears visuals', () => {
  const h = createHarness();
  const n = node('s1', 100, 100);
  h.graphNodes.set('s1', n);
  h.store.setSelection(['s1']);
  const tile = fakeNode();
  tile.dataset = { id: 's1', kind: 'shortcut' };
  tile.closest = (sel) => (sel === '.icon-item' ? tile : sel === '.graph-node-shell' ? tile : null);
  h.grid._dispatch('pointerdown', pointerEvent(1, 10, 10, { target: tile }));
  h.grid._dispatch('pointermove', pointerEvent(1, 20, 15));
  assert.ok(h.windowListeners.length > 0);
  h.controller.cancelDrag();
  assert.equal(h.windowListeners.length, 0);
});

test('destroy removes the pointer listeners', () => {
  const h = createHarness();
  assert.ok(h.grid._listeners.length > 0);
  h.controller.destroy();
  assert.equal(h.grid._listeners.length, 0);
});

test('double-click on a tile routes activateItem with revealDirectoryTarget', () => {
  const h = createHarness();
  const tile = fakeNode();
  tile.dataset = { id: 's1', kind: 'shortcut' };
  tile.closest = (sel) => (sel === '.icon-item' ? tile : null);
  h.grid._dispatch('dblclick', { target: tile });
  assert.deepEqual(h.commandCalls, [['activate', 's1', { revealDirectoryTarget: true }]]);
});

test('double-click after a consumed graph click does not activate', () => {
  const h = createHarness();
  h.setSuppressGraphClickFlag(true);
  const tile = fakeNode();
  tile.dataset = { id: 's1', kind: 'shortcut' };
  tile.closest = (sel) => (sel === '.icon-item' ? tile : null);
  h.grid._dispatch('dblclick', { target: tile });
  assert.equal(h.commandCalls.length, 0);
  assert.equal(h.getSuppressGraphClickFlag(), false);
});

function startDrag(h, overrides = {}) {
  const tile = fakeNode();
  tile.dataset = { id: 's1', kind: 'shortcut' };
  tile.closest = (sel) => (sel === '.icon-item' ? tile : sel === '.graph-node-shell' ? tile : null);
  const n = node('s1', 100, 100);
  h.graphNodes.set('s1', n);
  h.store.setSelection(['s1']);
  h.setShells([n.shell]);
  h.grid._dispatch('pointerdown', pointerEvent(1, 10, 10, { target: tile }));
  h.grid._dispatch('pointermove', pointerEvent(1, 20, 15, overrides));
  return n;
}

test('pointerup over a non-dragged group routes dragDropToFolder', () => {
  const h = createHarness();
  const n = startDrag(h);
  // Destination folder shell is a non-dragged group at the pointer.
  const folderShell = fakeNode();
  folderShell.dataset = { graphNodeId: 'g1' };
  folderShell.querySelector = () => ({ dataset: { kind: 'group', id: 'g1' } });
  folderShell.closest = (sel) => (sel === '.graph-node-shell' ? folderShell : null);
  h.setShells([n.shell, folderShell]);
  h.setElementAtPoint(folderShell);
  h.grid._dispatch('pointerup', pointerEvent(1, 20, 15));
  const folderCall = h.commandCalls.find(([name]) => name === 'folder');
  assert.ok(folderCall, 'dragDropToFolder should be invoked');
  assert.deepEqual(folderCall[1].itemIds, ['s1']);
  assert.equal(folderCall[1].folderId, 'g1');
  assert.ok(folderCall[1].placementIds instanceof Map);
});

test('pointercancel restores node positions and cleans up', () => {
  const h = createHarness();
  const n = startDrag(h);
  const movedX = n.fx;
  const movedY = n.fy;
  assert.notEqual(movedX, 100);
  h.grid._dispatch('pointercancel', pointerEvent(1, 20, 15));
  assert.equal(n.x, 100);
  assert.equal(n.y, 100);
  assert.equal(n.fx, null);
  assert.equal(n.fy, null);
  assert.equal(n.shell.classList.contains('graph-dragging'), false);
  assert.ok(h.effects.reheat.includes(0.2));
  assert.equal(h.getReleased(), 1);
});

test('Alt+pointerdown on a tile neither selects nor starts a drag', () => {
  const h = createHarness();
  const tile = fakeNode();
  tile.dataset = { id: 'g1', kind: 'group' };
  const shell = fakeNode();
  tile.closest = (sel) => (sel === '.icon-item' ? tile : sel === '.graph-node-shell' ? shell : null);
  h.graphNodes.set('g1', node('g1'));
  h.grid._dispatch('pointerdown', pointerEvent(1, 10, 10, { target: tile, altKey: true }));
  assert.equal(
    h.commandCalls.length, 0,
    'Alt+click batch-expands relative to the selection, so the selection must survive pointerdown',
  );
});

test('a plain pointerdown on the same tile still selects, proving Alt is the difference', () => {
  const h = createHarness();
  const tile = fakeNode();
  tile.dataset = { id: 'g1', kind: 'group' };
  const shell = fakeNode();
  tile.closest = (sel) => (sel === '.icon-item' ? tile : sel === '.graph-node-shell' ? shell : null);
  h.graphNodes.set('g1', node('g1'));
  h.grid._dispatch('pointerdown', pointerEvent(1, 10, 10, { target: tile }));
  assert.equal(h.commandCalls[0][0], 'select');
});

// ===========================================================================
// Set movement rules: enforced on release against the rendered regions.
// ===========================================================================

/** Starts a drag on one tile and moves it by the given client delta. */
function dragTile(h, id, from, to) {
  const tile = fakeNode();
  tile.dataset = { id, kind: 'shortcut' };
  tile.closest = (sel) =>
    (sel === '.icon-item' || sel === '.graph-node-shell' ? tile : null);
  h.store.setSelection([id]);
  h.grid._dispatch('pointerdown', pointerEvent(1, from.x, from.y, { target: tile }));
  h.grid._dispatch('pointermove', pointerEvent(1, to.x, to.y));
  return tile;
}

test('the dragged item follows the pointer exactly, through any set', () => {
  const h = createHarness();
  const n = node('loose', 100, 100);
  h.graphNodes.set('loose', n);
  // Anywhere past x=150 is inside set A, which 'loose' does not belong to.
  h.setRegionsAtPoint((point) => (point.x > 150 ? ['A'] : []));
  h.setDropRule((itemId, regionSetIds) => regionSetIds.length === 0);

  dragTile(h, 'loose', { x: 10, y: 10 }, { x: 200, y: 10 });
  // The pointer has absolute authority. This previously clamped at x=150, on
  // the reasoning that a set is a container and a container has walls — but a
  // set has no claim over the thing the user is holding, and clamping turned a
  // direct manipulation into a negotiation.
  assert.equal(n.x, 290, 'it went exactly where the cursor did');

  h.grid._dispatch('pointerup', pointerEvent(1, 200, 10));
  assert.equal(n.x, 290, 'and it stays there — the drop is the instruction, not a proposal');
});

test('an item allowed at its destination keeps its new position', () => {
  const h = createHarness();
  const n = node('loose', 100, 100);
  h.graphNodes.set('loose', n);
  h.setRegionsAtPoint(() => []);
  h.setDropRule(() => true);

  dragTile(h, 'loose', { x: 10, y: 10 }, { x: 200, y: 10 });
  h.grid._dispatch('pointerup', pointerEvent(1, 200, 10));
  assert.equal(n.x, 290, 'the move stands');
});

test('each item in a multi-item drag is judged on its own', () => {
  const h = createHarness();
  const allowed = node('member', 100, 100);
  const blocked = node('loose', 100, 200);
  h.graphNodes.set('member', allowed);
  h.graphNodes.set('loose', blocked);
  h.setRegionsAtPoint((point) => (point.x > 150 ? ['A'] : []));
  // Only 'member' belongs to A, so only it may land inside.
  h.setDropRule((itemId, regionSetIds) =>
    (regionSetIds.length === 0 ? itemId !== 'member' : itemId === 'member'));

  const tile = fakeNode();
  tile.dataset = { id: 'member', kind: 'shortcut' };
  tile.closest = (sel) =>
    (sel === '.icon-item' || sel === '.graph-node-shell' ? tile : null);
  h.store.setSelection(['member', 'loose']);
  h.grid._dispatch('pointerdown', pointerEvent(1, 10, 10, { target: tile }));
  h.grid._dispatch('pointermove', pointerEvent(1, 200, 10));
  h.grid._dispatch('pointerup', pointerEvent(1, 200, 10));

  // Every dragged item follows the pointer. Neither is clamped, because the
  // rules are restored after release by moving the world, not by refusing the
  // movement.
  assert.equal(allowed.x, 290, 'the member kept its move');
  assert.equal(blocked.x, 290, 'and so did the setless item');
});

test('releasing on the canvas settles the scene around where it was dropped', () => {
  const h = createHarness();
  const n = node('loose', 100, 100);
  h.graphNodes.set('loose', n);
  h.setRegionsAtPoint((point) => (point.x > 150 ? ['A'] : []));
  h.setDropRule((itemId, regionSetIds) => regionSetIds.length === 0);

  dragTile(h, 'loose', { x: 10, y: 10 }, { x: 200, y: 10 });
  h.grid._dispatch('pointerup', pointerEvent(1, 200, 10));

  // The drop is the fixed point. What follows is the world rearranging around
  // it, which is the opposite of the revert pass this replaced.
  assert.deepEqual(
    h.settleCalls, [['loose']],
    'the dropped item was handed to the settlement pass as an anchor',
  );
  assert.equal(n.x, 290, 'and it was not moved by it');
});

test('dropping into the Bin or a folder does not settle the canvas', () => {
  // Filing something away is a different gesture: the item is leaving this
  // layout, so there is nothing to rearrange around it.
  const h = createHarness();
  const n = node('loose', 100, 100);
  h.graphNodes.set('loose', n);
  h.setRegionsAtPoint(() => []);
  h.setDropRule(() => true);

  dragTile(h, 'loose', { x: 10, y: 10 }, { x: 200, y: 10 });
  h.binButton.contains = () => true;
  h.grid._dispatch('pointerup', pointerEvent(1, 200, 10));

  assert.deepEqual(h.settleCalls, [], 'no settlement for a Bin drop');
  const binCall = h.commandCalls.find(([name]) => name === 'bin');
  assert.ok(binCall, 'and the Bin drop still happened');
});

test('dropping into a folder is not governed by the set rules', () => {
  const h = createHarness();
  const n = node('loose', 100, 100);
  h.graphNodes.set('loose', n);
  h.setRegionsAtPoint(() => ['A']);
  h.setDropRule(() => false);

  // hitTest walks from the element under the pointer up to a shell, then down
  // to its .icon-item, so the mock has to be that shape.
  const folderItem = fakeNode();
  folderItem.dataset = { id: 'f1', kind: 'group' };
  const folderShell = fakeNode();
  folderShell.dataset = { graphNodeId: 'f1' };
  folderShell.querySelector = (sel) => (sel === '.icon-item' ? folderItem : null);
  folderShell.closest = (sel) => (sel === '.graph-node-shell' ? folderShell : null);

  dragTile(h, 'loose', { x: 10, y: 10 }, { x: 200, y: 10 });
  h.setShells([folderShell]);
  h.setElementAtPoint(folderShell);
  h.grid._dispatch('pointerup', pointerEvent(1, 200, 10));

  // Filing something away is a different gesture; judging it by the drag-start
  // set regions would otherwise make folders unreachable while dragging.
  const folderCall = h.commandCalls.find(([name]) => name === 'folder');
  assert.ok(folderCall, 'the drop still routed to the folder');
});

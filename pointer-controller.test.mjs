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
  grid.releasePointerCapture = () => {};
  grid.querySelector = () => null;
  grid.querySelectorAll = () => [];
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
  const documentMock = { querySelectorAll: () => [], elementFromPoint: () => null };
  const commandCalls = [];
  const commands = {
    selectItem: (id, opts) => { commandCalls.push(['select', id, opts]); },
    dragDropToBin: (input) => { commandCalls.push(['bin', input]); },
    dragDropToFolder: (input) => { commandCalls.push(['folder', input]); },
    pinDraggedNodes: (input) => { commandCalls.push(['pin', input]); },
    releaseDraggedNodes: (input) => { commandCalls.push(['release', input]); },
  };
  const graphNodes = new Map();
  const effects = { reheat: [], decay: 0, close: 0, suppressGraph: [], suppressBlank: [] };
  const graph = {
    _getNode: (id) => graphNodes.get(id) ?? null,
    reheat: (a) => { effects.reheat.push(a); },
    _setSimulationDecay: () => { effects.decay += 1; },
  };
  let marqueeActivePointer = null;
  const marquee = {
    isActive: (pointerId) => marqueeActivePointer === pointerId,
    start: (input) => { commandCalls.push(['marquee-start', input]); },
    move: (input) => { commandCalls.push(['marquee-move', input]); },
    finish: (pointerId) => { marqueeActivePointer = null; return true; },
  };
  const controller = createPointerController({
    window: windowMock,
    document: documentMock,
    elements,
    store,
    commands,
    graph,
    marquee,
    zoomTransform: () => ({ x: 0, y: 0, k: 1 }),
    group: () => null,
    visiblePlacementIdFor: (id) => `p-${id}`,
    closeMenu: () => { effects.close += 1; },
    setSuppressGraphClick: (v) => { effects.suppressGraph.push(v); },
    setSuppressBlankClick: (v) => { effects.suppressBlank.push(v); },
  });
  controller.mount();
  return {
    controller, grid, binButton, store, commands, commandCalls, graphNodes, effects, windowListeners, marquee,
  };
}

function node(id, x = 0, y = 0) {
  const shell = fakeNode();
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

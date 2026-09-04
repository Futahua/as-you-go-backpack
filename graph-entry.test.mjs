import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('./public/workspace-20260730b.js', import.meta.url), 'utf8');
// Run the production functions with isolated DOM/drawing collaborators.
const update = source.slice(source.indexOf('  function updateGraphView('), source.indexOf('  function refreshSelection('));
const reheat = source.slice(source.indexOf('  function reheat('), source.indexOf('  function fitGraph('));

function fixture(remembered = true) {
  let alpha = 0;
  let restarts = 0;
  let stops = 0;
  const noop = () => {};
  const context = vm.createContext({
    viewport: { clientWidth: 1000, clientHeight: 700 },
    initialized: true, updatePending: false, pendingInitialFit: false,
    state: { view: {} }, session: { currentId: 'root', graphExpanded: [], binMode: false },
    ROOT_ID: 'root', store: { setTrailExpanded: noop },
    currentTrailContextKey: () => 'root', graphContextId: (id) => id,
    pathTo: () => [], pathToBin: () => [],
    getBreadcrumbRootScale: () => 1, getBreadcrumbMiddleScale: () => 1,
    visibleGraphItems: () => [{ id: 'a', kind: 'group' }],
    getGraphPosition: () => null,
    getGraphRestPosition: () => remembered ? { x: 30, y: 40 } : null,
    // Permit the regression to execute the pre-revert freeze path as well.
    hasSettledGraphPositions: (items, lookup) => items.every((item) => lookup(item.id)),
    lastGraphContextKey: null, lastGraphStructureKey: null,
    restPositionsStructureKey: null, activeGraphStructureKey: null,
    lastSavedRest: new Map(), nodes: new Map(),
    syncNodes: noop, syncEdges: noop, syncOriginEdges: noop,
    syncSimulation: noop, syncSetRings: noop,
    simulation: {
      alpha(value) { if (value === undefined) return alpha; alpha = value; return this; },
      restart() { restarts++; return this; },
      stop() { stops++; return this; },
    },
  });
  vm.runInContext(`${reheat}\n${update}`, context);
  return {
    enter(initialFit = false) { context.updateGraphView(initialFit); },
    navigate(id) { context.session.currentId = id; },
    cool() { alpha = 0; },
    result: () => ({ alpha, restarts, stops }),
  };
}

test('opening with remembered positions resumes the original physics', () => {
  const graph = fixture();
  graph.enter(true);
  assert.deepEqual(graph.result(), { alpha: 0.7, restarts: 1, stops: 0 });
});

test('reentering a remembered folder and same-folder updates both reheat', () => {
  const graph = fixture();
  graph.enter();
  graph.cool();
  graph.enter();
  graph.navigate('child');
  graph.enter();
  graph.navigate('root');
  graph.enter();
  assert.deepEqual(graph.result(), { alpha: 0.35, restarts: 4, stops: 0 });
});

test('opening without remembered positions still starts physics', () => {
  const graph = fixture(false);
  graph.enter(true);
  assert.deepEqual(graph.result(), { alpha: 0.7, restarts: 1, stops: 0 });
});

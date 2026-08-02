/** Mounts the real composition root.
 *
 * Until this file existed, everything in the composition root was verified by
 * inspection only: it queried the document at module load, so importing it
 * threw and no test could reach it. Visual bugs reached the user through a
 * fully green suite because of that hole. These tests are deliberately about
 * the wiring — that the real construction runs, controllers exist, and
 * listeners are attached — not about geometry, which the pure modules cover. */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mountWorkspace } from './public/workspace-app.js';
import {
  createFakeDocument,
  createFakeWindow,
  idsInShippedMarkup,
  classSelectorsInShippedMarkup,
} from './fake-dom.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const markup = await readFile(path.join(root, 'public/workspace-20260730b.html'), 'utf8');
const selectors = [...idsInShippedMarkup(markup), ...classSelectorsInShippedMarkup(markup)];

function mount({
  loadWorkspace = async () => ({ schemaVersion: 1, groups: [], shortcuts: [] }),
  reducedMotion = false,
} = {}) {
  const document = createFakeDocument({ selectors });
  const window = createFakeWindow(document, { reducedMotion });
  const saved = [];
  const host = {
    loadWorkspace,
    saveWorkspace: async (snapshot) => { saved.push(snapshot); },
    copyText: async () => true,
    launchTarget: async () => {},
    revealTarget: async () => {},
    pickTarget: async () => null,
    resolveShortcutIcon: async () => null,
    resolveWebLinkIcon: async () => null,
    resolveDroppedTargets: async () => [],
    openWebLink: async () => {},
  };
  const app = mountWorkspace({
    document,
    window,
    host,
    requestAnimationFrame: window.requestAnimationFrame,
    cancelAnimationFrame: window.cancelAnimationFrame,
    ResizeObserver: window.ResizeObserver,
  });
  return { app, document, window, saved };
}

test('the real composition mounts without a browser', () => {
  const { app } = mount();
  assert.ok(app, 'mountWorkspace returned an app');
  for (const part of ['store', 'graph', 'commands', 'keyboard', 'pointer', 'drop', 'elements']) {
    assert.ok(app[part], `composition exposes ${part}`);
  }
});

test('a click outside the context menu closes it', () => {
  const { app, document } = mount();
  const menu = app.elements.menu;
  menu.hidden = false;

  // Asserting a click listener merely *exists* proves nothing — other
  // components register their own, so the assertion stays true even with this
  // one removed. The dismissal itself is the behaviour worth pinning.
  document.dispatch('click', { target: { closest: () => null } });
  assert.equal(menu.hidden, true, 'outside click closed the menu');
});

test('a click inside the context menu leaves it open', () => {
  const { app, document } = mount();
  const menu = app.elements.menu;
  menu.hidden = false;

  document.dispatch('click', { target: { closest: (selector) => (selector === '#context-menu' ? menu : null) } });
  assert.equal(menu.hidden, false, 'menu survives a click on itself');
});

test('mounting resolves every element in the registry', () => {
  const { app } = mount();
  for (const [name, element] of Object.entries(app.elements)) {
    assert.ok(element, `element ${name} resolved`);
  }
});

/** Every element the graph draws its set outlines into. */
function outlinePaths(document) {
  const found = [];
  const walk = (node) => {
    if (node?.getAttribute?.('class') === 'graph-set-outline') found.push(node);
    for (const child of node?.childNodes ?? []) walk(child);
  };
  walk(document.querySelector('#icon-grid'));
  return found;
}

function pointsOf(pathData) {
  return [...pathData.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((match) => ({ x: +match[1], y: +match[2] }));
}

function graphState() {
  return {
    schemaVersion: 1,
    groups: [{ id: 'g1', parentId: 'root', name: 'A' }, { id: 'g2', parentId: 'root', name: 'B' }],
    shortcuts: [],
    view: {
      layout: 'graph',
      itemSets: [
        { id: 's1', title: '', memberIds: ['g1'] },
        { id: 's2', title: '', memberIds: ['g2'] },
      ],
      graphPositions: { root: { g1: { x: 0, y: 0 }, g2: { x: 300, y: 0 } } },
    },
  };
}

/** Renders the graph and returns the outline paths.
 *
 * The wait is deliberately shorter than the 500ms zoom-to-fit timer. That fit
 * throws on a pre-existing bundle-split bug in the vendored d3 (d3-zoom
 * carries its own private d3-selection, so the selection the app passes it is
 * missing .transition/.interrupt) — unrelated to sets, reported separately,
 * and not something these tests should either trip over or paper over. */
async function renderGraph(options = {}) {
  const mounted = mount({ loadWorkspace: async () => graphState(), ...options });
  await new Promise((resolve) => setTimeout(resolve, 60));
  mounted.window._runFrame(16);
  const paths = outlinePaths(mounted.document);
  // Tear the view down before the fit timer fires. destroyGraphView clears
  // fitPending, which the timer checks, so the pending fit becomes a no-op
  // rather than an unhandled rejection after the test has finished.
  //
  // Once the vendored-d3 bundle split is fixed and the fit no longer throws,
  // this teardown can go and these tests can await the fit instead.
  mounted.app.graph.destroyGraphView();
  return { ...mounted, paths };
}

test('the graph renders one outline per set with members on screen', async () => {
  const { paths } = await renderGraph();
  assert.equal(paths.length, 2, 'one path per set');
  for (const path of paths) {
    assert.ok((path.getAttribute('d') ?? '').length > 0, `set ${path.dataset.setId} has geometry`);
  }
});

test('rendered outlines are extracted polygons, not curves through hull points', async () => {
  const { paths } = await renderGraph();
  for (const path of paths) {
    const data = path.getAttribute('d') ?? '';
    // A cubic segment would mean the drawn edge is once again an
    // approximation of the tested geometry rather than the geometry itself.
    assert.equal((data.match(/C/g) ?? []).length, 0, 'no cubic segments in the rendered path');
    assert.match(data, /^M /, 'path starts with a move');
  }
});

test('exclusive sets stay apart in what is actually rendered', async () => {
  const { paths } = await renderGraph();
  const [a, b] = paths.map((path) => pointsOf(path.getAttribute('d') ?? ''));
  let closest = Infinity;
  for (const pointA of a) {
    for (const pointB of b) {
      closest = Math.min(closest, Math.hypot(pointA.x - pointB.x, pointA.y - pointB.y));
    }
  }
  // The module-level guarantee is worth nothing if the renderer feeds it the
  // wrong inputs, so the separation is asserted on the drawn paths too.
  assert.ok(closest > 0, `rendered outlines touched (closest ${closest.toFixed(2)})`);
});

test('a failing state load still leaves the interface mounted', async () => {
  const { app } = mount({ loadWorkspace: async () => { throw new Error('host unavailable'); } });
  // bootstrapWorkspace mounts behaviour-only controllers before loading, so a
  // dead host must not leave the workspace inert.
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(app.keyboard, 'keyboard controller still constructed');
  assert.ok(app.elements.status, 'status element still resolved');
});

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
  installBrowserGlobals,
  idsInShippedMarkup,
  classSelectorsInShippedMarkup,
} from './fake-dom.mjs';

// d3-zoom reads SVGElement off the global scope, not off the window we inject.
installBrowserGlobals();

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
 * The wait is deliberately shorter than the 500ms zoom-to-fit timer: these
 * tests are about the drawn set outlines, so they read the paths and tear the
 * view down rather than waiting on the camera. The fit itself is covered by
 * 'the initial graph fit does not throw' below. */
async function renderGraph(options = {}) {
  const mounted = mount({ loadWorkspace: async () => graphState(), ...options });
  await new Promise((resolve) => setTimeout(resolve, 60));
  mounted.window._runFrame(16);
  const paths = outlinePaths(mounted.document);
  // Tear the view down before the fit timer fires; destroyGraphView clears
  // fitPending, which the timer checks, so the pending fit becomes a no-op
  // instead of running after the test has finished.
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

/** Regression: the initial zoom-to-fit used to throw for every user.
 *
 * The vendored d3 was three standalone bundles, and d3-zoom carried its own
 * private copy of d3-selection. It installed .transition()/.interrupt() onto
 * THAT copy's prototype, while the app imported select() from a different
 * file with a different prototype — so both branches of fitGraph() died:
 * the animated one on `viewportSelection.transition is not a function`, the
 * reduced-motion one inside zoomBehavior.transform on `selection2.interrupt
 * is not a function`. Present since the graph view landed, and reduced motion
 * was no escape.
 *
 * Both branches are exercised because they fail for different reasons, and a
 * test of only one would have stayed green through half the bug. */
for (const reducedMotion of [false, true]) {
  const motion = reducedMotion ? 'reduced motion' : 'full motion';

  test(`the initial graph fit does not throw (${motion})`, async () => {
    const mounted = mount({ loadWorkspace: async () => graphState(), reducedMotion });
    await new Promise((resolve) => setTimeout(resolve, 60));
    mounted.window._runFrame(16);

    // Guard the guard: fitGraph returns false and touches no d3 API when there
    // is nothing on screen, so without live nodes this test would pass against
    // the very bundle split it exists to catch.
    assert.equal(mounted.app.graph.nodeCount, 2, 'nodes are on screen to fit');
    assert.equal(mounted.app.graph.fitGraph(), true, 'the fit ran and reported success');

    // Let the real 500ms initial-fit timer and any transition timers drain.
    // The animated path only reaches d3-transition's scheduler on a later
    // tick, which is where a half-shared module graph would surface.
    await new Promise((resolve) => setTimeout(resolve, 700));
    mounted.app.graph.destroyGraphView();
  });
}

test('the app and d3-zoom share one d3-selection instance', async () => {
  const [{ select }, { zoom, zoomIdentity }] = await Promise.all([
    import('./public/vendor/d3-selection.js'),
    import('./public/vendor/d3-zoom.js'),
  ]);
  const element = {
    addEventListener() {}, removeEventListener() {}, style: {},
    ownerDocument: { documentElement: {} },
    clientWidth: 800, clientHeight: 600,
    getBoundingClientRect: () => ({ x: 0, y: 0, top: 0, left: 0, width: 800, height: 600 }),
  };
  const selection = select(element);

  // These are the two methods d3-zoom expects to find on a selection the app
  // hands it. They exist only if d3-transition patched the same prototype
  // object the app's select() produces.
  assert.equal(typeof selection.transition, 'function', 'd3-transition patched the app\'s selection');
  assert.equal(typeof selection.interrupt, 'function', 'interrupt reached the app\'s selection');

  // ...and the sharing has to survive an actual zoom call, not just exist.
  const behaviour = zoom().scaleExtent([0.35, 3]);
  selection.call(behaviour);
  behaviour.transform(selection, zoomIdentity.translate(120, 80).scale(1.4));
  assert.deepEqual(
    { k: element.__zoom.k, x: element.__zoom.x, y: element.__zoom.y },
    { k: 1.4, x: 120, y: 80 },
    'the transform reached the element',
  );
});

/** Clicks the graph background at a point in world coordinates.
 *
 * The identity zoom transform the fake reports means world and client
 * coordinates coincide, so a set's own centre is a usable click target. */
function clickGraphAt(mounted, point, modifiers = {}) {
  const grid = mounted.app.elements.grid;
  // Blank canvas: not an expand button, not a tile, but inside the grid — the
  // same three questions the real handler asks of an event target.
  const blank = {
    dataset: {},
    closest: (selector) => (selector.includes('data-blank-parent') || selector.includes('data-icon-grid')
      ? blank
      : null),
  };
  grid.dispatch('click', {
    target: blank,
    clientX: point.x,
    clientY: point.y,
    ...modifiers,
  });
}

test('clicking inside a set region selects that set', async () => {
  const mounted = mount({ loadWorkspace: async () => graphState() });
  await new Promise((resolve) => setTimeout(resolve, 60));
  mounted.window._runFrame(16);

  // g1 sits at the origin, so its own position is inside its set's region.
  assert.deepEqual(mounted.app.graph.setIdsAtPoint({ x: 0, y: 0 }), ['s1'], 'the region is hit');

  clickGraphAt(mounted, { x: 0, y: 0 });
  assert.deepEqual(
    [...mounted.app.store.getSession().selectedSets], ['s1'],
    'the set is selected, and nothing else is',
  );
  mounted.app.graph.destroyGraphView();
});

test('clicking clear of every set clears the set selection', async () => {
  const mounted = mount({ loadWorkspace: async () => graphState() });
  await new Promise((resolve) => setTimeout(resolve, 60));
  mounted.window._runFrame(16);

  clickGraphAt(mounted, { x: 0, y: 0 });
  assert.equal(mounted.app.store.getSession().selectedSets.size, 1);

  // Between the two sets, inside neither.
  assert.deepEqual(mounted.app.graph.setIdsAtPoint({ x: 150, y: 0 }), []);
  clickGraphAt(mounted, { x: 150, y: 0 });
  assert.equal(mounted.app.store.getSession().selectedSets.size, 0, 'cleared');
  mounted.app.graph.destroyGraphView();
});

test('deleting a selected set removes the grouping and keeps the items', async () => {
  const mounted = mount({ loadWorkspace: async () => graphState() });
  await new Promise((resolve) => setTimeout(resolve, 60));
  mounted.window._runFrame(16);

  clickGraphAt(mounted, { x: 0, y: 0 });
  await mounted.app.commands.deleteSelectedSets();

  const state = mounted.app.getState();
  assert.deepEqual(
    state.view.itemSets.map((entry) => entry.id), ['s2'],
    'only the selected set went',
  );
  assert.deepEqual(
    state.groups.map((entry) => entry.id).sort(), ['g1', 'g2'],
    'both items are untouched',
  );
  mounted.app.graph.destroyGraphView();
});

/** A folder F containing a shortcut S, with F in a set, plus a loose item. */
function inheritanceState({ excludedIds = [] } = {}) {
  return {
    schemaVersion: 1,
    groups: [{ id: 'F', parentId: 'root', name: 'F' }],
    shortcuts: [
      { id: 'S', name: 's', target: 'C:/s', placements: [{ id: 'pS', parentId: 'F', order: 0 }] },
      { id: 'L', name: 'l', target: 'C:/l', placements: [{ id: 'pL', parentId: 'root', order: 1 }] },
    ],
    view: {
      layout: 'graph',
      itemSets: [{ id: 'setF', title: '', memberIds: ['F'], excludedIds }],
      // Expanded, so the folder's contents are on screen as graph nodes —
      // which is the only way inheritance has anything to apply to.
      graphExpandedGroupIds: ['F'],
      graphPositions: { root: { F: { x: 0, y: 0 }, S: { x: 120, y: 0 }, L: { x: 600, y: 0 } } },
    },
  };
}

test('a shortcut inside a member folder inherits its set', async () => {
  const mounted = mount({ loadWorkspace: async () => inheritanceState() });
  await new Promise((resolve) => setTimeout(resolve, 60));
  mounted.window._runFrame(16);

  // Graph nodes are keyed by the shortcut's record id, which ancestorFolderIds
  // cannot resolve — it returns no chain, so S used to inherit nothing.
  assert.deepEqual(
    mounted.app.graph.ancestorsOfNode('S'), ['F'],
    'the graph resolves the shortcut to its folder',
  );

  const region = mounted.app.graph.getSetRegions().get('setF');
  assert.ok(region, 'the folder set has a region');
  assert.ok(
    mounted.app.graph.setIdsAtPoint({ x: 120, y: 0 }).includes('setF'),
    'the shortcut position is inside its folder set',
  );
  mounted.app.graph.destroyGraphView();
});

test('an excluded child is outside its folder set in the rendered region', async () => {
  const mounted = mount({ loadWorkspace: async () => inheritanceState({ excludedIds: ['S'] }) });
  await new Promise((resolve) => setTimeout(resolve, 60));
  mounted.window._runFrame(16);

  // The renderer used to rebuild sets as {id, memberIds}, dropping excludedIds
  // entirely, so an excluded child stayed inside the outline — and selection
  // and the drop rules hit-test that same region.
  assert.ok(
    !mounted.app.graph.setIdsAtPoint({ x: 120, y: 0 }).includes('setF'),
    'the excluded shortcut is not inside the set',
  );
  assert.ok(
    mounted.app.graph.setIdsAtPoint({ x: 0, y: 0 }).includes('setF'),
    'the folder itself still is',
  );
  mounted.app.graph.destroyGraphView();
});

test('a folder set survives navigating inside the member folder', async () => {
  const mounted = mount({ loadWorkspace: async () => inheritanceState() });
  await new Promise((resolve) => setTimeout(resolve, 60));
  mounted.window._runFrame(16);
  assert.ok(mounted.app.graph.getSetRegions().has('setF'), 'drawn at the root');

  // Inside F, the folder tile itself is no longer emitted by
  // visibleGraphItems — only its contents are. Keying the shape on a visible
  // *stored* member therefore made the set vanish exactly when the user was
  // looking at the items it contains.
  mounted.app.store.setNavigation({ currentId: 'F' });
  mounted.app.render();
  // Rendering reheats the simulation on a real timer, so the post-navigation
  // drawSetShapes cannot have run yet — nothing below would observe the new
  // state. Let the simulation tick, then drain the frames it scheduled.
  await new Promise((resolve) => setTimeout(resolve, 60));
  mounted.window._runFrame(32);

  // The folder tile stops being a *member* of the visible graph, though its
  // node lingers briefly while it fades out.
  assert.ok(mounted.app.graph._getNode('S'), 'its contents are on screen');
  assert.ok(
    mounted.app.graph.getSetRegions().has('setF'),
    'the set is still drawn around the contents that inherit it',
  );
  assert.ok(
    mounted.app.graph.setIdsAtPoint({ x: 120, y: 0 }).includes('setF'),
    'and the inherited child is inside it',
  );
  mounted.app.graph.destroyGraphView();
});

test('a loose item outside the folder is not in the set', async () => {
  const mounted = mount({ loadWorkspace: async () => inheritanceState() });
  await new Promise((resolve) => setTimeout(resolve, 60));
  mounted.window._runFrame(16);
  assert.ok(
    !mounted.app.graph.setIdsAtPoint({ x: 600, y: 0 }).includes('setF'),
    'inheritance does not leak to siblings of the folder',
  );
  mounted.app.graph.destroyGraphView();
});

test('a failing state load still leaves the interface mounted', async () => {
  const { app } = mount({ loadWorkspace: async () => { throw new Error('host unavailable'); } });
  // bootstrapWorkspace mounts behaviour-only controllers before loading, so a
  // dead host must not leave the workspace inert.
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(app.keyboard, 'keyboard controller still constructed');
  assert.ok(app.elements.status, 'status element still resolved');
});

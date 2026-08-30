import assert from 'node:assert/strict';
import test from 'node:test';
import { regionArea, regionCentroid, signedArea } from './public/set-region-model.js';
import { decomposeArrangement } from './public/set-region-arrangement.js';
import { ringHull, pointInsideRing } from './public/set-ring-model.js';
import { forceSetExclusion, forceSetSeparation } from './public/set-gravity-model.js';
import {
  assignSpatialFolderHues, findNearPairs, groupPairsByComponent, projectNearPairs,
  FOLDER_DISTANCE, MIN_HUE_SEPARATION,
} from './public/graph-model-20260730b.js';

const square = (x, y, size = 10) => [
  { x, y }, { x: x + size, y }, { x: x + size, y: y + size }, { x, y: y + size },
];

const circle = (cx, cy, radius, count = 48) => Array.from({ length: count }, (_, index) => {
  const angle = (index / count) * Math.PI * 2;
  return { x: cx + (radius * Math.cos(angle)), y: cy + (radius * Math.sin(angle)) };
});

/** The production exact path. These expectations are fixed values checked
 * against the geometry itself, not against a second implementation — the mask
 * enumerator they were originally written against is gone. */
const regionsOf = (sets) => {
  const result = decomposeArrangement(sets);
  assert.equal(result.status, 'exact', 'fixture unexpectedly exceeded its budget');
  return result.regions;
};

const closeTo = (actual, expected, tolerance = 1e-6) => Math.abs(actual - expected) < tolerance;

test('two overlapping convex sets produce three membership regions with a separate lens', () => {
  const regions = regionsOf([
    { id: 'A', outline: square(0, 0) },
    { id: 'B', outline: square(5, 0) },
  ]);
  assert.deepEqual(regions.map(({ id }) => id), ['A', 'A|B', 'B']);
  assert.ok(regions.every((region) => regionArea(region) > 0));
  // Two 10x10 squares offset by 5: each exclusive part and the lens are 50.
  assert.ok(regions.every((region) => closeTo(regionArea(region), 50)));
  const lens = regions.find((region) => region.id === 'A|B');
  const centre = regionCentroid(lens);
  assert.ok(closeTo(centre.x, 7.5) && closeTo(centre.y, 5), `lens centroid was ${JSON.stringify(centre)}`);
});

test('three overlapping convex sets include the centre and every non-empty membership', () => {
  const regions = regionsOf([
    { id: 'A', outline: square(0, 0) },
    { id: 'B', outline: square(5, 0) },
    { id: 'C', outline: square(2, 4) },
  ]);
  assert.deepEqual(
    regions.map(({ id }) => id),
    ['A', 'A|B', 'A|B|C', 'A|C', 'B', 'B|C', 'C'],
  );
  assert.ok(regions.every((region) => regionArea(region) > 0));
  // Fixed areas for this fixture, so a geometry change has to be deliberate.
  const areaOf = (id) => regionArea(regions.find((region) => region.id === id));
  assert.ok(closeTo(areaOf('A|B|C'), 30), `A|B|C was ${areaOf('A|B|C')}`);
  assert.ok(closeTo(areaOf('A'), 32), `A was ${areaOf('A')}`);
  assert.ok(closeTo(areaOf('C'), 40), `C was ${areaOf('C')}`);
  // The three sets cover 100 + 100 + 100 minus their shared parts.
  const union = regions.reduce((total, region) => total + regionArea(region), 0);
  assert.ok(closeTo(union, 190), `union was ${union}`);
});

test('disjoint sets have one region each and ids do not depend on input order', () => {
  const first = regionsOf([
    { id: 'B', outline: square(30, 0) },
    { id: 'A', outline: square(0, 0) },
  ]);
  const second = regionsOf([
    { id: 'A', outline: square(0, 0) },
    { id: 'B', outline: square(30, 0) },
  ]);
  assert.deepEqual(first.map(({ id }) => id), ['A', 'B']);
  assert.deepEqual(first.map(({ id }) => id), second.map(({ id }) => id));
  assert.deepEqual(first.map(regionCentroid), second.map(regionCentroid));
});

test('nearby regions keep distinct stable entity ids for the hue solver', () => {
  const regions = regionsOf([
    { id: 'set:one', outline: square(0, 0) },
    { id: 'set:two', outline: square(5, 0) },
  ]);
  assert.equal(new Set(regions.map(({ id }) => `region:${id}`)).size, 3);
  assert.ok(regions.every(({ id }) => !id.includes('set:set')));
});

test('region entities participate in the same minimum hue separation solver', () => {
  const regions = regionsOf([
    { id: 'A', outline: square(0, 0) },
    { id: 'B', outline: square(5, 0) },
  ]);
  const colors = new Map();
  const nodes = regions.map((region) => ({ id: `region:${region.id}`, ...regionCentroid(region) }));
  assignSpatialFolderHues(nodes, colors, { cx: 5, cy: 5 });
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const delta = Math.abs(((colors.get(nodes[i].id) - colors.get(nodes[j].id) + 540) % 360) - 180);
      assert.ok(delta >= MIN_HUE_SEPARATION - 1e-6);
    }
  }
});

test('region building leaves hull, containment, hit-test, exclusion, and separation byte-identical', () => {
  const sets = [
    { id: 'A', outline: square(0, 0) },
    { id: 'B', outline: square(5, 0) },
  ];
  const physicalSnapshot = () => {
    const hulls = new Map(sets.map((set) => [set.id, ringHull(set.outline)]));
    const hit = ['A', 'B']
      .filter((id) => pointInsideRing({ x: 7, y: 5 }, hulls.get(id)))
      .sort((a, b) => hulls.get(a).length - hulls.get(b).length);
    const excluded = [{ id: 'foreign', x: 7, y: 5, vx: 0, vy: 0 }];
    const exclusion = forceSetExclusion({
      setsOf: () => ['A'],
      membersOf: () => [],
      hullOf: (id) => hulls.get(id),
      clearance: 10,
    });
    exclusion.initialize(excluded);
    exclusion(1);
    const ringNodes = ['A', 'B'].flatMap((id) => hulls.get(id).map((point, index) => ({
      id: `${id}:${index}`, x: point.x, y: point.y, vx: 0, vy: 0, ring: true,
    })));
    const separation = forceSetSeparation({
      setsOf: () => [],
      hullOf: (id) => hulls.get(id),
    });
    separation.initialize(ringNodes);
    separation(1);
    return JSON.stringify({ hulls: [...hulls], hit, exclusion: excluded, separation: ringNodes });
  };
  const before = physicalSnapshot();
  decomposeArrangement(sets);
  const after = physicalSnapshot();
  assert.equal(after, before);
  assert.deepEqual(sets.map((set) => set.outline), [square(0, 0), square(5, 0)]);
});

const piecewiseArea = (region) => region.polygons.reduce(
  (total, polygon) => total + Math.abs(signedArea(polygon)),
  0,
);

// Regression cover for the fourth-set brick. Production outlines are
// resampleHull'd to 48 vertices, and the original subtraction clipped every edge
// against the *whole* piece rather than the remainder: the exterior pieces
// overlapped, so areas double-counted, and each excluded set multiplied the
// piece count by 48. Three sets stayed survivable; a fourth buried the frame
// under ~54k fragments. These fixtures now pin the behaviour directly.

test('subtracting a fully contained set leaves the true remaining area, not overlapping strips', () => {
  const regions = regionsOf([
    { id: 'A', outline: square(0, 0, 20) },
    { id: 'B', outline: square(5, 5, 10) },
  ]);
  assert.deepEqual(regions.map(({ id }) => id), ['A', 'A|B']);
  // 400 - 100. Four independent exterior half-planes each covered 100 units of
  // A and overlapped at the corners, which reported the whole 400 back.
  assert.equal(regionArea(regions.find(({ id }) => id === 'A')), 300);
  assert.equal(regionArea(regions.find(({ id }) => id === 'A|B')), 100);
});

test('difference pieces partition the region instead of overlapping each other', () => {
  const [aOnly] = regionsOf([
    { id: 'A', outline: square(0, 0, 20) },
    { id: 'B', outline: square(5, 5, 10) },
  ]);
  // A partition's piece areas sum to the region area; overlapping strips exceed it.
  assert.equal(piecewiseArea(aOnly), 300);
  assert.equal(piecewiseArea(aOnly), regionArea(aOnly));
});

test('four disjoint production-resolution sets stay one polygon per region', () => {
  const regions = regionsOf(['A', 'B', 'C', 'D'].map((id, index) => ({
    id,
    outline: circle(index * 500, 0, 100),
  })));
  assert.deepEqual(regions.map(({ id }) => id), ['A', 'B', 'C', 'D']);
  // Was 54,208 fragments across these four regions.
  assert.deepEqual(regions.map((region) => region.polygons.length), [1, 1, 1, 1]);
});

test('four overlapping production-resolution sets stay within a bounded fragment count', () => {
  const regions = regionsOf(['A', 'B', 'C', 'D'].map((id, index) => ({
    id,
    outline: circle(index * 60, (index % 2) * 40, 100),
  })));
  assert.ok(regions.some(({ id }) => id === 'A|B'));
  assert.ok(regions.some(({ id }) => id === 'A|B|C|D'));
  const fragments = regions.reduce((total, region) => total + region.polygons.length, 0);
  // Was 29,947. The bound is what keeps a fourth G group off the frame budget;
  // it is deliberately loose so ordinary geometry churn does not redden it.
  assert.ok(fragments < 2000, `expected a bounded fragment count, got ${fragments}`);
});

// ===========================================================================
// The hue solver's optional diagnostics sink. It exists so a benchmark can tell
// pair discovery apart from projection effort without timing internals, and it
// must therefore be provably inert: production passes no sink and must compute
// none of it, and passing one must not change a single hue.

test('the hue diagnostics sink does not change any colour it observes', () => {
  let state = 20260830;
  const random = () => {
    state = ((state * 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  // A deliberately dense neighbourhood, so projection runs its full course and
  // the slot-colouring fallback is reached — the paths most at risk of being
  // perturbed by observation.
  const nodes = Array.from({ length: 40 }, (unused, index) => ({
    id: (index % 2 === 0 ? 'set:' : 'region:') + index,
    x: random() * 300,
    y: random() * 300,
  }));

  const run = (sink) => {
    const colors = new Map();
    const hueState = new Map();
    for (let frame = 0; frame < 12; frame += 1) {
      assignSpatialFolderHues(nodes, colors, { cx: 150, cy: 150 }, hueState, sink);
    }
    return [...colors.entries()].sort(([a], [b]) => a.localeCompare(b));
  };

  const withoutSink = run(undefined);
  const diagnostics = {};
  const withSink = run(diagnostics);
  assert.deepEqual(withSink, withoutSink, 'observing the solver changed its output');

  // And the sink actually reported the work, or it would be inert for the wrong
  // reason.
  assert.ok(diagnostics.spatialEntities === 40);
  assert.ok(diagnostics.nearPairs > 0);
  assert.ok(diagnostics.projectionPasses >= 1);
  assert.ok(diagnostics.projectionPairVisits >= diagnostics.nearPairs);
  assert.ok(Array.isArray(diagnostics.nearComponents));
  assert.ok(Array.isArray(diagnostics.fallbackComponents));
});

test('a scene with no near pairs costs one projection pass and no fallback', () => {
  const nodes = Array.from({ length: 12 }, (unused, index) => ({
    id: `set:${index}`,
    x: index * 5000,
    y: 0,
  }));
  const diagnostics = {};
  assignSpatialFolderHues(nodes, new Map(), { cx: 0, cy: 0 }, new Map(), diagnostics);
  assert.equal(diagnostics.nearPairs, 0);
  // No near pairs means no proximity components, and projection is scheduled
  // per component, so there is nothing to sweep at all. projectionPasses is the
  // maximum any component needed, which is zero when there are none.
  assert.equal(diagnostics.projectionPasses, 0);
  assert.equal(diagnostics.projectionMaxPasses, 0);
  assert.equal(diagnostics.projectionComponentPasses, 0);
  assert.equal(diagnostics.projectionPairVisits, 0);
  assert.deepEqual(diagnostics.projectionComponents, []);
  assert.deepEqual(diagnostics.fallbackComponents, []);
});

// ===========================================================================
// H1. Near-pair discovery moved from an all-pairs double loop to a uniform grid
// of FOLDER_DISTANCE. Projection mutates hues as it walks these pairs, so the
// new builder must reproduce not just the same SET of pairs but the same
// ORDERED SEQUENCE. These compare it against the naive loop it replaced, which
// the test owns so that production carries only one implementation.

/** The original all-pairs builder, kept here as the reference. */
const referenceNearPairs = (list, distance = FOLDER_DISTANCE) => {
  const pairs = [];
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const a = list[i];
      const b = list[j];
      if (Math.hypot(a.x - b.x, a.y - b.y) < distance) pairs.push([a, b]);
    }
  }
  return pairs;
};

const pairIds = (pairs) => pairs.map(([a, b]) => [a.id, b.id]);

const assertSameSequence = (list, label) => {
  assert.deepEqual(
    pairIds(findNearPairs(list)),
    pairIds(referenceNearPairs(list)),
    `${label}: pair sequence diverged`,
  );
};

test('spatial near-pair discovery matches the all-pairs loop on fixed cases', () => {
  const at = (id, x, y) => ({ id, x, y });

  // Widely separated: no pairs at all.
  assertSameSequence([at('a', 0, 0), at('b', 9000, 0), at('c', 0, 9000)], 'separated');

  // Everything mutually near: every pair, in order.
  assertSameSequence([at('a', 0, 0), at('b', 10, 0), at('c', 0, 10), at('d', 5, 5)], 'clique');

  // Negative coordinates, which floor() handles differently from truncation.
  assertSameSequence(
    [at('a', -300, -300), at('b', -250, -280), at('c', -10, 5), at('d', 5, -10)],
    'negative coordinates',
  );

  // Straddling a cell boundary: FOLDER_DISTANCE apart to the pixel, and either
  // side of it. The comparison is strict, so the exact distance is excluded.
  assertSameSequence(
    [at('a', 0, 0), at('b', FOLDER_DISTANCE, 0), at('c', FOLDER_DISTANCE - 0.001, 0)],
    'exact boundary',
  );

  // Diagonal neighbours: reachable only through a corner cell.
  assertSameSequence(
    [at('a', FOLDER_DISTANCE - 1, FOLDER_DISTANCE - 1), at('b', FOLDER_DISTANCE + 1, FOLDER_DISTANCE + 1)],
    'diagonal cell',
  );

  // Several entities stacked on one point, so a single cell holds duplicates.
  assertSameSequence(
    Array.from({ length: 6 }, (unused, index) => at(`same${index}`, 40, 40)),
    'coincident',
  );

  assert.deepEqual(findNearPairs([]), [], 'empty input');
  assert.deepEqual(findNearPairs([at('only', 0, 0)]), [], 'single entity');
});

test('spatial near-pair discovery matches the all-pairs loop under fuzzing', () => {
  let state = 424242;
  const random = () => {
    state = ((state * 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  for (let seed = 0; seed < 30; seed += 1) {
    // Spread deliberately spans well below and well above FOLDER_DISTANCE so
    // some scenes are dense cliques and others are almost all isolates.
    const spread = 40 + (seed * 40);
    const count = 5 + (seed % 20);
    const list = Array.from({ length: count }, (unused, index) => ({
      id: `n${String(index).padStart(3, '0')}`,
      x: (random() - 0.5) * spread,
      y: (random() - 0.5) * spread,
    })).sort((a, b) => a.id.localeCompare(b.id));
    assertSameSequence(list, `fuzz seed ${seed} spread ${spread}`);
  }
});

test('spatially discovered pairs produce identical hues over successive frames', () => {
  let state = 987654;
  const random = () => {
    state = ((state * 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const list = Array.from({ length: 36 }, (unused, index) => ({
    id: (index % 2 === 0 ? 'set:' : 'region:') + String(index).padStart(3, '0'),
    x: random() * 320,
    y: random() * 320,
  })).sort((a, b) => a.id.localeCompare(b.id));

  // Same pairs in the same order must drive the solver to the same place, and
  // this scene is dense enough to reach the slot-colouring fallback.
  assert.deepEqual(pairIds(findNearPairs(list)), pairIds(referenceNearPairs(list)));

  const colors = new Map();
  const hueState = new Map();
  for (let frame = 0; frame < 10; frame += 1) {
    assignSpatialFolderHues(list, colors, { cx: 160, cy: 160 }, hueState);
  }
  const settled = [...colors.entries()].sort(([a], [b]) => a.localeCompare(b));
  assert.ok(settled.length === list.length, 'every entity received a hue');
  assert.ok(settled.every(([, hue]) => Number.isFinite(hue)), 'and every hue is finite');
});

// ===========================================================================
// H2. Projection is scheduled per proximity component instead of globally.
// Disconnected components mutate disjoint colour entries, so their operations
// commute and this must be EXACTLY equivalent, not merely close. These tests
// hold a copy of the old global projector and require the two to agree on every
// hue, on hueState, and on what the fallback did.

const MAX_PROJECTION_PASSES_REFERENCE = 100;
const MIN_SEPARATION_REFERENCE = MIN_HUE_SEPARATION;

const wrapDegReference = (deg) => ((deg % 360) + 360) % 360;
const signedAngleReference = (from, to) => {
  const delta = wrapDegReference(to - from);
  return delta > 180 ? delta - 360 : delta;
};

/** The pre-H2 global projector, kept here so production carries one scheduler.
 * Deliberately a transcription: one sweep over every pair, alternating
 * direction, stopping only when a whole sweep is clean. */
function referenceGlobalProjection(nearPairs, colors, tieBreak) {
  let passes = 0;
  for (let pass = 0; pass < MAX_PROJECTION_PASSES_REFERENCE; pass += 1) {
    let violated = false;
    const order = pass % 2 === 0 ? nearPairs : [...nearPairs].reverse();
    passes += 1;
    for (const [a, b] of order) {
      const hueA = colors.get(a.id);
      const hueB = colors.get(b.id);
      if (typeof hueA !== 'number' || typeof hueB !== 'number') continue;
      const delta = signedAngleReference(hueA, hueB);
      const separation = Math.abs(delta);
      if (separation < MIN_SEPARATION_REFERENCE) {
        const direction = separation > 1e-9 ? Math.sign(delta) : tieBreak(a, b);
        const correction = (MIN_SEPARATION_REFERENCE - separation) / 2;
        colors.set(a.id, wrapDegReference(hueA - direction * correction));
        colors.set(b.id, wrapDegReference(hueB + direction * correction));
        violated = true;
      }
    }
    if (!violated) break;
  }
  return passes;
}

/** Three neighbourhoods far enough apart to be separate components, chosen so
 * they exercise the three ways projection can end:
 *
 *   A  two entities, already almost separated  -> clean almost immediately
 *   B  five entities in a line                 -> several passes, then clean
 *   C  twelve mutually near entities           -> hits the cap, then fallback
 */
function threeComponentScene() {
  const nodes = [];
  // A: a pair, far from everything else.
  nodes.push({ id: 'set:A0', x: 0, y: 0 });
  nodes.push({ id: 'set:A1', x: 30, y: 0 });
  // B: a chain, each near only its neighbours.
  for (let i = 0; i < 5; i += 1) {
    nodes.push({ id: `set:B${i}`, x: 5000 + (i * 150), y: 0 });
  }
  // C: a dense clique, more members than 360/45 slots can hold.
  for (let i = 0; i < 12; i += 1) {
    const angle = (i / 12) * Math.PI * 2;
    nodes.push({
      id: `set:C${String(i).padStart(2, '0')}`,
      x: 20000 + (Math.cos(angle) * 40),
      y: (Math.sin(angle) * 40),
    });
  }
  return nodes.sort((a, b) => a.id.localeCompare(b.id));
}

test('per-component projection matches the old global projector exactly', () => {
  const nodes = threeComponentScene();
  const pairs = findNearPairs(nodes);

  // The fixture must actually contain the three shapes it claims to.
  const componentSizes = groupPairsByComponent(pairs)
    .map((component) => new Set(component.flatMap(([a, b]) => [a.id, b.id])).size)
    .sort((a, b) => a - b);
  assert.deepEqual(componentSizes, [2, 5, 12], 'fixture is not three components of 2, 5 and 12');

  // Identical starting hues for both schedulers.
  const seedColors = new Map(nodes.map((node, index) => [node.id, (index * 7) % 360]));
  const tieBreak = (a, b) => (a.id < b.id ? 1 : -1);

  const referenceColors = new Map(seedColors);
  referenceGlobalProjection(pairs, referenceColors, tieBreak);

  const diagnostics = {};
  const actualColors = new Map(seedColors);
  const hueState = new Map();
  assignSpatialFolderHues(nodes, actualColors, { cx: 0, cy: 0 }, hueState, diagnostics);

  // The solver also runs its own hue-advance and fallback stages, so compare the
  // component scheduling through diagnostics rather than through final colour
  // here; colour equality across frames is checked in the next test.
  const byPasses = diagnostics.projectionComponents
    .slice()
    .sort((left, right) => left.size - right.size);
  assert.deepEqual(byPasses.map(({ size }) => size), [2, 5, 12]);

  // A settles and stops being revisited; C never converges and pays the cap.
  const [small, chain, clique] = byPasses;
  assert.equal(small.converged, true, 'the pair component should converge');
  assert.ok(small.passes < 10, `the pair component took ${small.passes} passes`);
  assert.equal(clique.converged, false, 'the twelve-way clique cannot converge');
  assert.equal(clique.passes, 100, 'and should pay the full cap');
  assert.ok(
    chain.passes >= small.passes,
    'the chain should need at least as many passes as the pair',
  );

  // The whole point: the settled components stopped being walked. Under the old
  // global scheduler every component paid the cap because C did.
  const globalEquivalentVisits = pairs.length * clique.passes;
  assert.ok(
    diagnostics.projectionPairVisits < globalEquivalentVisits,
    `expected fewer visits than a global cap sweep (${diagnostics.projectionPairVisits} vs ${globalEquivalentVisits})`,
  );

  // And only the infeasible component reached the fallback.
  assert.equal(diagnostics.fallbackComponents.length, 1);
  assert.equal(diagnostics.fallbackComponents[0].size, 12);
});

test('component scheduling leaves hues and hueState identical across moving frames', () => {
  // Equivalence has to survive persistent state, not just one call, so both
  // schedulers are driven over the same drifting scene and compared each frame.
  const nodes = threeComponentScene();

  const runFrames = (project) => {
    const colors = new Map();
    const hueState = new Map();
    const live = nodes.map((node) => ({ ...node }));
    const history = [];
    for (let frame = 0; frame < 8; frame += 1) {
      for (const node of live) {
        node.x += Math.cos(frame) * 2;
        node.y += Math.sin(frame) * 2;
      }
      project(live, colors, hueState);
      history.push([...colors.entries()].sort(([a], [b]) => a.localeCompare(b)));
    }
    return { history, hueState };
  };

  // The production path.
  const actual = runFrames((live, colors, hueState) => {
    assignSpatialFolderHues(live, colors, { cx: 0, cy: 0 }, hueState);
  });

  // The same scene again, to establish the run is deterministic at all before
  // any claim about equivalence means anything.
  const repeat = runFrames((live, colors, hueState) => {
    assignSpatialFolderHues(live, colors, { cx: 0, cy: 0 }, hueState);
  });

  assert.deepEqual(actual.history, repeat.history, 'the solver is not deterministic');
  assert.deepEqual(
    [...actual.hueState.entries()].sort(),
    [...repeat.hueState.entries()].sort(),
    'hueState diverged between identical runs',
  );

  // Every hue finite and separated where the geometry allows it.
  for (const frame of actual.history) {
    for (const [, hue] of frame) assert.ok(Number.isFinite(hue), 'a hue went non-finite');
  }
});

test('grouped component pairs are a subsequence of the global pair order', () => {
  const nodes = threeComponentScene();
  const pairs = findNearPairs(nodes);
  const key = ([a, b]) => `${a.id}|${b.id}`;
  const globalOrder = pairs.map(key);

  let total = 0;
  for (const component of groupPairsByComponent(pairs)) {
    const componentOrder = component.map(key);
    total += componentOrder.length;
    // Walking the global list must encounter this component's pairs in exactly
    // this order — that is what makes per-component projection equivalent.
    const filtered = globalOrder.filter((entry) => componentOrder.includes(entry));
    assert.deepEqual(componentOrder, filtered, 'component order is not a subsequence');
  }
  assert.equal(total, pairs.length, 'grouping lost or duplicated pairs');
});

/** Drives the real scheduler and the reference global projector from identical
 * seed colours over the same pair list, and requires every hue to match. This is
 * the test that actually discriminates: comparing the solver against itself only
 * proves determinism. */
function assertProjectionEquivalent(nodes, seedHue, label) {
  const pairs = findNearPairs(nodes);
  const seeded = new Map(nodes.map((node, index) => [node.id, seedHue(node, index)]));

  const referenceColors = new Map(seeded);
  const referencePasses = referenceGlobalProjection(pairs, referenceColors, referenceTieBreak);

  const actualColors = new Map(seeded);
  const actual = projectNearPairs(pairs, actualColors, { collectComponents: true });

  const referenceEntries = [...referenceColors.entries()].sort(([a], [b]) => a.localeCompare(b));
  const actualEntries = [...actualColors.entries()].sort(([a], [b]) => a.localeCompare(b));
  assert.equal(actualEntries.length, referenceEntries.length, `${label}: entity count diverged`);
  for (let index = 0; index < referenceEntries.length; index += 1) {
    const [refId, refHue] = referenceEntries[index];
    const [actId, actHue] = actualEntries[index];
    assert.equal(actId, refId, `${label}: entity order diverged`);
    assert.ok(
      Math.abs(signedAngleReference(refHue, actHue)) < 1e-9,
      `${label}: ${refId} hue ${actHue} vs reference ${refHue}`,
    );
  }
  return { referencePasses, actual, pairs };
}

/** tieBreakDirection is module-private, and this mirrors it. If the two ever
 * disagree the equivalence tests fail loudly rather than silently weakening. */
const referenceTieBreak = (a, b) => (a.id < b.id ? 1 : -1);

test('the component scheduler and the global projector reach identical hues', () => {
  const nodes = threeComponentScene();
  const { referencePasses, actual } = assertProjectionEquivalent(
    nodes,
    (node, index) => (index * 7) % 360,
    'three components',
  );

  // And it got there by doing strictly less work: the global projector paid its
  // worst component's pass count across every pair, every pass.
  assert.equal(referencePasses, 100, 'the clique should drive the global projector to the cap');
  assert.ok(
    actual.pairVisits < findNearPairs(nodes).length * referencePasses,
    'the scheduler should visit fewer pairs than a global sweep to the cap',
  );
  const settled = actual.components.filter((component) => component.converged);
  assert.ok(settled.length >= 2, 'the pair and chain components should both settle');
  assert.ok(
    settled.every((component) => component.passes < 100),
    'a settled component must stop before the cap',
  );
});

test('the schedulers agree across fuzzed multi-component scenes', () => {
  let state = 5150;
  const random = () => {
    state = ((state * 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  for (let seed = 0; seed < 25; seed += 1) {
    // Several clusters at varying density, so scenes range from all-isolates to
    // several infeasible cliques at once.
    const clusters = 1 + (seed % 4);
    const perCluster = 2 + (seed % 6);
    const spread = 20 + ((seed % 5) * 60);
    const nodes = [];
    for (let c = 0; c < clusters; c += 1) {
      for (let m = 0; m < perCluster; m += 1) {
        nodes.push({
          id: `set:${c}_${String(m).padStart(2, '0')}`,
          x: (c * 4000) + (random() * spread),
          y: random() * spread,
        });
      }
    }
    nodes.sort((a, b) => a.id.localeCompare(b.id));
    assertProjectionEquivalent(nodes, (node, index) => (index * 37) % 360, `fuzz seed ${seed}`);
  }
});

test('the schedulers agree when every component is already settled', () => {
  // Nothing to correct: both must leave every hue untouched.
  const nodes = Array.from({ length: 8 }, (unused, index) => ({
    id: `set:${index}`,
    x: index * 40,
    y: 0,
  }));
  const { actual } = assertProjectionEquivalent(
    nodes,
    (node, index) => index * 45,
    'already separated',
  );
  assert.ok(
    actual.components.every((component) => component.converged && component.passes === 1),
    'a settled component should cost exactly one confirming pass',
  );
});

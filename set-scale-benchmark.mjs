/** Scale harness for the two systems that are now the plausible next ceilings
 * once the region renderer stopped scaling with set count.
 *
 * MEASUREMENT ONLY. Nothing here asserts, and it is deliberately not in
 * `npm test`: hardware-sensitive timings do not belong in correctness tests.
 * This is the analogue of set-region-work-calibration.mjs — evidence to decide
 * whether either system needs redesigning, not a decision in itself.
 *
 *   node set-scale-benchmark.mjs
 *
 * What is quadratic, and where:
 *
 *   forceSetSeparation
 *     - ring-node proximity: already grid-bucketed on the clearance
 *     - `related` pair scan:  sets^2, each pair scanning members
 *     - visible-hull SAT:     sets^2, each pair over hull edges
 *
 *   assignSpatialFolderHues
 *     - nearPairs build:      sets^2 outright
 *     - projection:           re-walks nearPairs up to 100 passes
 *
 * The separation figure is reported twice — once whole, and once with hulls
 * withheld — so the sets^2 SAT phase can be read off as the difference without
 * instrumenting production code.
 */
import { forceSetSeparation } from './public/set-gravity-model.js';
import { assignSpatialFolderHues } from './public/graph-model-20260730b.js';
import { ringHull, resampleHull } from './public/set-ring-model.js';

const SEEDS = [1, 2, 3];
const COUNTS = [16, 32, 64, 128];
const MEMBERS_PER_SET = 6;
const RING_NODES_PER_SET = 24;
const HULL_RADIUS = 100;
const HULL_POINTS = 48; // production resolution, as resampleHull produces
const REPETITIONS = 40;
const WARMUP = 8;

function lcg(seed) {
  let state = seed >>> 0;
  return () => {
    state = ((state * 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** Deterministic spatial regimes over the same set centres both systems see. */
const REGIMES = {
  // Far apart: nothing overlaps. Establishes the bookkeeping floor.
  separated(count, random) {
    const perRow = Math.ceil(Math.sqrt(count));
    return Array.from({ length: count }, (unused, index) => ({
      x: (index % perRow) * 620 + (random() * 20),
      y: Math.floor(index / perRow) * 620 + (random() * 20),
    }));
  },
  // Small clusters of overlapping sets, clusters far from each other. The
  // realistic case: bounded neighbours, most pairs irrelevant.
  clustered(count, random) {
    const perCluster = 4;
    const clusters = Math.ceil(count / perCluster);
    const perRow = Math.ceil(Math.sqrt(clusters));
    return Array.from({ length: count }, (unused, index) => {
      const cluster = Math.floor(index / perCluster);
      return {
        x: (cluster % perRow) * 900 + (random() * 150),
        y: Math.floor(cluster / perRow) * 900 + (random() * 150),
      };
    });
  },
  // Everything piled into one box regardless of count: worst case for both the
  // hull SAT pass and hue projection.
  dense(count, random) {
    return Array.from({ length: count }, () => ({
      x: random() * 320,
      y: random() * 320,
    }));
  },
};

const circle = (cx, cy, radius, points) => Array.from({ length: points }, (unused, index) => {
  const angle = (index / points) * Math.PI * 2;
  return { x: cx + (radius * Math.cos(angle)), y: cy + (radius * Math.sin(angle)) };
});

function buildScene(count, regime, seed) {
  const random = lcg(seed);
  const centres = REGIMES[regime](count, random);
  const setIds = centres.map((unused, index) => `set:${String(index).padStart(3, '0')}`);

  const nodes = [];
  const membership = new Map();
  const hulls = new Map();

  centres.forEach((centre, index) => {
    const setId = setIds[index];
    for (let m = 0; m < MEMBERS_PER_SET; m += 1) {
      const angle = (m / MEMBERS_PER_SET) * Math.PI * 2;
      const id = `${setId}:member:${m}`;
      membership.set(id, [setId]);
      nodes.push({
        id,
        x: centre.x + (Math.cos(angle) * HULL_RADIUS * 0.45),
        y: centre.y + (Math.sin(angle) * HULL_RADIUS * 0.45),
        vx: 0,
        vy: 0,
      });
    }
    for (let r = 0; r < RING_NODES_PER_SET; r += 1) {
      const angle = (r / RING_NODES_PER_SET) * Math.PI * 2;
      nodes.push({
        id: `${setId}:ring:${String(r).padStart(3, '0')}`,
        setId,
        ring: true,
        x: centre.x + (Math.cos(angle) * HULL_RADIUS),
        y: centre.y + (Math.sin(angle) * HULL_RADIUS),
        vx: 0,
        vy: 0,
      });
    }
    hulls.set(setId, resampleHull(ringHull(circle(centre.x, centre.y, HULL_RADIUS, 32)), HULL_POINTS));
  });

  const folders = centres.map((centre, index) => ({ id: setIds[index], x: centre.x, y: centre.y }));
  return { nodes, membership, hulls, folders, setIds, centres };
}

const resetVelocities = (nodes) => {
  for (const node of nodes) {
    node.vx = 0;
    node.vy = 0;
  }
};

function timeIt(run) {
  for (let i = 0; i < WARMUP; i += 1) run();
  const samples = [];
  for (let i = 0; i < REPETITIONS; i += 1) {
    const started = process.hrtime.bigint();
    run();
    samples.push(Number(process.hrtime.bigint() - started) / 1e6);
  }
  samples.sort((a, b) => a - b);
  return {
    median: samples[Math.floor(samples.length / 2)],
    p95: samples[Math.floor(samples.length * 0.95)],
    max: samples[samples.length - 1],
  };
}

/** Counts what the sets^2 phases would actually find, so a timing can be read
 * against the work it implies rather than guessed at. */
function sceneStats({ hulls, centres }) {
  const ids = [...hulls.keys()];
  const candidatePairs = (ids.length * (ids.length - 1)) / 2;
  let hullOverlapPairs = 0;
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const a = centres[i];
      const b = centres[j];
      // Two discs of HULL_RADIUS overlap when their centres are closer than 2r.
      if (Math.hypot(a.x - b.x, a.y - b.y) < HULL_RADIUS * 2) hullOverlapPairs += 1;
    }
  }
  let nearHuePairs = 0;
  for (let i = 0; i < centres.length; i += 1) {
    for (let j = i + 1; j < centres.length; j += 1) {
      if (Math.hypot(centres[i].x - centres[j].x, centres[i].y - centres[j].y) < 220) nearHuePairs += 1;
    }
  }
  return { candidatePairs, hullOverlapPairs, nearHuePairs };
}

function measure(count, regime, seed) {
  const scene = buildScene(count, regime, seed);
  const stats = sceneStats(scene);

  const setsOf = (id) => scene.membership.get(id) ?? [];

  const withHulls = forceSetSeparation({ setsOf, hullOf: (setId) => scene.hulls.get(setId) });
  withHulls.initialize(scene.nodes);
  const separation = timeIt(() => {
    resetVelocities(scene.nodes);
    withHulls(1);
  });

  // Same scene, hull pass withheld: the difference is the sets^2 SAT phase.
  const withoutHulls = forceSetSeparation({ setsOf });
  withoutHulls.initialize(scene.nodes);
  const nodePhase = timeIt(() => {
    resetVelocities(scene.nodes);
    withoutHulls(1);
  });

  const hue = timeIt(() => {
    const colors = new Map();
    const hueState = new Map();
    assignSpatialFolderHues(scene.folders, colors, { cx: 0, cy: 0 }, hueState);
  });

  return { count, regime, seed, ...stats, separation, nodePhase, hue };
}

const pad = (value, width) => String(value).padStart(width);
const ms = (value) => value.toFixed(3);

console.log(`seeds ${SEEDS.join(', ')} | ${MEMBERS_PER_SET} members and ${RING_NODES_PER_SET} ring nodes per set`);
console.log(`${HULL_POINTS}-point hulls at radius ${HULL_RADIUS} | ${REPETITIONS} reps after ${WARMUP} warm-up\n`);
console.log('sets regime      pairs  hullOv  huePr | separation med/p95/max | nodePhase med | hullSAT | hue med/p95/max | combined');

const rows = [];
for (const count of COUNTS) {
  for (const regime of ['separated', 'clustered', 'dense']) {
    for (const seed of SEEDS) {
      const row = measure(count, regime, seed);
      rows.push(row);
      const hullSat = row.separation.median - row.nodePhase.median;
      console.log(
        pad(row.count, 4),
        regime.padEnd(10),
        pad(row.candidatePairs, 6),
        pad(row.hullOverlapPairs, 7),
        pad(row.nearHuePairs, 6),
        '|',
        pad(ms(row.separation.median), 7),
        pad(ms(row.separation.p95), 7),
        pad(ms(row.separation.max), 7),
        '|',
        pad(ms(row.nodePhase.median), 8),
        '|',
        pad(ms(hullSat), 7),
        '|',
        pad(ms(row.hue.median), 6),
        pad(ms(row.hue.p95), 6),
        pad(ms(row.hue.max), 6),
        '|',
        pad(ms(row.separation.median + row.hue.median), 8),
      );
    }
  }
}

console.log('\nworst combined median per count and regime:');
for (const count of COUNTS) {
  for (const regime of ['separated', 'clustered', 'dense']) {
    const matching = rows.filter((row) => row.count === count && row.regime === regime);
    const worst = Math.max(...matching.map((row) => row.separation.median + row.hue.median));
    console.log(`  ${pad(count, 4)} ${regime.padEnd(10)} ${ms(worst)}ms`);
  }
}

/** The outline as a ring of nodes rather than as computed geometry.
 *
 * The properties that mattered — closed, smooth, even thickness, containing its
 * members — were four fighting requirements when the shape was solved for. Here
 * they are consequences of the chain, so most of these tests are about the ring
 * being a proper loop and staying attached to its members. */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ringNodeCount,
  enclosingCircle,
  ringPositions,
  reconcileRing,
  ringPath,
  forceRingShape,
} from './public/set-ring-model.js';
// The real forces, so containment is measured against the configuration the
// app actually runs rather than an idealised one.
import { forceSimulation, forceManyBody, forceCollide, forceLink } from './public/vendor/d3-force.js';

function tile(id, x, y) {
  return { id, x, y, width: 72, height: 72 };
}

test('the node count follows the perimeter, so the ring never gaps', () => {
  // Spacing is what keeps the boundary solid. A fixed count would leave a big
  // set with its links stretched into a dotted line.
  const small = ringNodeCount(2 * Math.PI * 120, 60);
  const large = ringNodeCount(2 * Math.PI * 500, 60);
  assert.ok(large > small * 3, `a bigger ring gets more nodes (${small} -> ${large})`);
  assert.ok(ringNodeCount(0, 60) >= 8, 'and a degenerate ring still has a floor');
});

test('the enclosing circle covers every member', () => {
  const members = [tile('a', 0, 0), tile('b', 200, 0), tile('c', 0, 160)];
  const circle = enclosingCircle(members, 40);
  for (const member of members) {
    const reach = Math.hypot(member.x - circle.x, member.y - circle.y)
      + Math.hypot(member.width, member.height) / 2;
    assert.ok(reach <= circle.radius + 1e-6, `${member.id} is inside the circle`);
  }
});

test('the ring is a closed loop, not a chain with loose ends', () => {
  // The wrap-around link is what makes it a boundary. A chain with two ends
  // would open up under load, which is the gap a set must not have.
  const { nodes, links } = reconcileRing({ setId: 's1', members: [tile('a', 0, 0), tile('b', 150, 0)] });
  assert.equal(links.length, nodes.length, 'one link per node closes the loop');

  const outgoing = new Map(links.map((link) => [link.source, link.target]));
  let cursor = nodes[0].id;
  const seen = new Set();
  while (!seen.has(cursor)) {
    seen.add(cursor);
    cursor = outgoing.get(cursor);
  }
  assert.equal(seen.size, nodes.length, 'following the links visits every node');
  assert.equal(cursor, nodes[0].id, 'and returns to the start');
});

test('a growing set gains nodes and keeps the ones it had', () => {
  // "It can get as big as needed" is literally more links. Existing nodes keep
  // their positions so the settled part of the ring does not jump when one is
  // added.
  const near = reconcileRing({ setId: 's1', members: [tile('a', 0, 0), tile('b', 120, 0)] });
  const far = reconcileRing({
    setId: 's1',
    members: [tile('a', 0, 0), tile('b', 900, 0)],
    existing: near.nodes,
  });

  assert.ok(far.nodes.length > near.nodes.length, `the ring grew (${near.nodes.length} -> ${far.nodes.length})`);
  for (let i = 0; i < near.nodes.length; i += 1) {
    assert.equal(far.nodes[i].id, near.nodes[i].id, `node ${i} survived the growth`);
    assert.equal(far.nodes[i].x, near.nodes[i].x, `node ${i} kept its position`);
  }
});

test('a shrinking set drops nodes rather than bunching them up', () => {
  const far = reconcileRing({ setId: 's1', members: [tile('a', 0, 0), tile('b', 900, 0)] });
  const near = reconcileRing({
    setId: 's1',
    members: [tile('a', 0, 0), tile('b', 120, 0)],
    existing: far.nodes,
  });
  assert.ok(near.nodes.length < far.nodes.length, `the ring shrank (${far.nodes.length} -> ${near.nodes.length})`);
  assert.equal(near.links.length, near.nodes.length, 'and is still closed');
});

test('the ring settles around its members, not on top of them', () => {
  // The shape force pulls towards the enclosing circle's rim rather than its
  // centre, so the ring surrounds the members instead of collapsing onto them.
  const members = [tile('a', 0, 0), tile('b', 160, 0)];
  const { nodes } = reconcileRing({ setId: 's1', members });
  // Start them all at the centre, the worst case.
  for (const node of nodes) { node.x = 80; node.y = 0; node.vx = 0; node.vy = 0; }

  const force = forceRingShape({ membersOf: () => members });
  force.initialize(nodes);
  let alpha = 1;
  for (let i = 0; i < 400; i += 1) {
    alpha += (0 - alpha) * 0.028;
    force(alpha);
    for (const node of nodes) {
      node.vx *= 0.68; node.vy *= 0.68;
      node.x += node.vx; node.y += node.vy;
    }
  }

  const circle = enclosingCircle(members, 40);
  for (const node of nodes) {
    const distance = Math.hypot(node.x - circle.x, node.y - circle.y);
    assert.ok(
      Math.abs(distance - circle.radius) < 12,
      `a ring node settled on the rim (${distance.toFixed(0)} vs ${circle.radius.toFixed(0)})`,
    );
  }
});

test('the drawn path passes through every ring node', () => {
  // Catmull-Rom rather than a B-spline: the ring is where the physics put it,
  // so the drawing must not move it. Each node appears as a curve endpoint.
  const { nodes } = reconcileRing({ setId: 's1', members: [tile('a', 0, 0), tile('b', 150, 0)] });
  const path = ringPath(nodes);
  assert.match(path, /^M .* Z$/, 'the path is closed');
  for (const node of nodes) {
    const x = Math.round(node.x * 100) / 100;
    const y = Math.round(node.y * 100) / 100;
    assert.ok(path.includes(`${x} ${y}`), `the path reaches node at ${x} ${y}`);
  }
});

test('too few nodes yields no path rather than a degenerate one', () => {
  assert.equal(ringPath([]), '');
  assert.equal(ringPath([{ x: 0, y: 0 }, { x: 10, y: 0 }]), '');
});

test('ring nodes stay affordable at realistic scale', () => {
  // The previous approach cost 87.8ms to rebuild a two-set scene, which is five
  // frames. This has to stay far under one, because the ring is simulated every
  // tick rather than rebuilt occasionally — so the ceiling is guarded here
  // rather than discovered on a machine with its fans running.
  let total = 0;
  for (let s = 0; s < 8; s += 1) {
    const members = [tile(`a${s}`, s * 200, 0), tile(`b${s}`, s * 200, 180), tile(`c${s}`, s * 200 + 160, 90)];
    total += reconcileRing({ setId: `s${s}`, members }).nodes.length;
  }
  assert.ok(total < 200, `8 sets need ${total} ring nodes, which the simulation can carry`);
});

// ===========================================================================
// Containment. The architecture's headline claim is that a member cannot leave
// and an outsider cannot get in "for the same reason a node cannot walk through
// another node". That is true of nodes the simulation is free to move, and
// measurably NOT true of a node the user is dragging — so it is worth stating
// exactly which of the two the code delivers.
// ===========================================================================

/** Runs the app's own force configuration over members plus a ring. */
function settle(members, extra = [], links = [], ticks = 200) {
  const nodes = [...members, ...extra];
  const simulation = forceSimulation(nodes).alpha(1).stop()
    .force('charge', forceManyBody().strength((n) => (n.ring ? 0 : -280)))
    .force('collide', forceCollide()
      .radius((n) => (n.ring ? 18 : Math.max(n.width, n.height) / 2 + 20))
      .strength(0.9))
    .force('link', forceLink(links).id((d) => d.id)
      .distance((l) => (l.source.ring ? 60 : 145))
      .strength((l) => (l.source.ring ? 0.9 : 0.14)))
    .force('ring', forceRingShape({ membersOf: () => members }));
  for (let i = 0; i < ticks; i += 1) simulation.tick();
  return simulation;
}

/** Ray casting against the ring in loop order. Ordering by ringIndex matters:
 * the node array is not the polygon unless it is walked around the loop. */
function insideRing(ringNodes, point) {
  const loop = [...ringNodes].sort((a, b) => a.ringIndex - b.ringIndex);
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i, i += 1) {
    const a = loop[i];
    const b = loop[j];
    if ((a.y > point.y) !== (b.y > point.y)
      && point.x < a.x + ((point.y - a.y) / (b.y - a.y)) * (b.x - a.x)) inside = !inside;
  }
  return inside;
}

test('the ring encloses its own members once settled', () => {
  const members = [tile('a', 0, 0), tile('b', 140, 0), tile('c', 70, 120)];
  const { nodes: ring, links } = reconcileRing({ setId: 's1', members });
  settle(members, ring, links, 300);
  for (const member of members) {
    assert.ok(insideRing(ring, member), `member ${member.id} ended up outside its own set`);
  }
});

/** Pulls an outsider towards the set centre with the given per-tick strength,
 * and reports whether it ended up inside the ring. */
function pullInside(pull, ticks = 400) {
  const members = [tile('a', 0, 0), tile('b', 140, 0)];
  const outsider = tile('out', 700, 0);
  const { nodes: ring, links } = reconcileRing({ setId: 's1', members });
  const simulation = settle(members, [outsider, ...ring], links, 200);
  for (let i = 0; i < ticks; i += 1) {
    outsider.vx += (70 - outsider.x) * pull;
    outsider.vy += (0 - outsider.y) * pull;
    simulation.tick();
  }
  return insideRing(ring, outsider);
}

test('the ring resists a gentle push but is not impassable', () => {
  // The measured truth, and it is weaker than "an outsider cannot get in".
  // The ring holds against a slow drift and is pushed through by anything
  // firmer: breach begins somewhere between 0.002 and 0.005 per tick.
  //
  // Worth pinning precisely, because the architecture is sold on containment
  // being a free consequence of collision. It is a real effect — the boundary
  // does push back — but it is resistance, not prevention, and a feature that
  // needs a hard rule cannot be built on it.
  assert.equal(pullInside(0.001), false, 'a gentle drift is held out');
  assert.equal(pullInside(0.01), true, 'a firm push gets through');
});

test('a dragged outsider passes straight through the ring', () => {
  // Dragging is the worst case and the one the user will actually do.
  // pointer-controller moves a node by pinning fx/fy, which sets its position
  // outright, so collision can shove the ring aside but has nothing to push
  // back against. Anything that must stop a drag has to be a rule in the drag
  // code; the physics will not do it.
  //
  // Asserted rather than left as a comment so that a change making the ring
  // genuinely drag-proof fails here and forces this note to be rewritten.
  const members = [tile('a', 0, 0), tile('b', 140, 0)];
  const outsider = tile('out', 700, 0);
  const { nodes: ring, links } = reconcileRing({ setId: 's1', members });
  const simulation = settle(members, [outsider, ...ring], links, 200);

  for (let x = 700; x >= 70; x -= 40) {
    outsider.fx = x;
    outsider.fy = 0;
    for (let i = 0; i < 12; i += 1) simulation.tick();
  }
  assert.ok(insideRing(ring, outsider), 'a pinned node is not stopped by collision');
});

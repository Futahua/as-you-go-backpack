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
  enclosingEllipse,
  ringPositions,
  reconcileRing,
  ringPath,
  ringHull,
  forceRingShape,
  ejectionTarget,
  pointInsideRing,
  forceSpeedLimit,
} from './public/set-ring-model.js';
// The real forces, so containment is measured against the configuration the
// app actually runs rather than an idealised one.
import { forceSimulation, forceManyBody, forceCollide, forceLink } from './public/vendor/d3-force.js';
import { forceSetExclusion } from './public/set-gravity-model.js';

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

  // Against the ellipse, not a circle: the boundary is oriented along how the
  // members are spread, so "on the rim" means the ellipse equation is satisfied
  // rather than every node being one radius from the centre.
  const ellipse = enclosingEllipse(members, 40);
  for (const node of nodes) {
    const dx = node.x - ellipse.x;
    const dy = node.y - ellipse.y;
    const cos = Math.cos(-ellipse.angle);
    const sin = Math.sin(-ellipse.angle);
    const local = { x: (dx * cos) - (dy * sin), y: (dx * sin) + (dy * cos) };
    const onRim = Math.hypot(local.x / ellipse.a, local.y / ellipse.b);
    assert.ok(
      Math.abs(onRim - 1) < 0.15,
      `a ring node settled off the rim (${onRim.toFixed(2)}, 1.0 is exactly on it)`,
    );
  }
});

test('the boundary stretches along the drag rather than growing radially', () => {
  // A circle has one radius and so no way to express direction: pulling two
  // members apart along one axis inflated the boundary on both. Measured, two
  // 72px tiles 800px apart gave a ring 982px tall where it should stay ~182.
  const across = [];
  for (const separation of [0, 200, 400, 800]) {
    const members = [tile('a', -separation / 2, 0), tile('b', separation / 2, 0)];
    const ellipse = enclosingEllipse(members, 40);
    across.push(2 * ellipse.b);
    // The long axis follows the spread.
    assert.ok(
      2 * ellipse.a >= separation,
      `at ${separation} apart the boundary was only ${(2 * ellipse.a).toFixed(0)} long`,
    );
  }
  // The short axis does not: it stays put however far apart they are dragged.
  const widest = Math.max(...across);
  const narrowest = Math.min(...across);
  assert.ok(
    widest - narrowest < 5,
    `the boundary ballooned across the drag: heights ${across.map((v) => v.toFixed(0)).join(', ')}`,
  );
});

test('the boundary orients along whichever way the members lie', () => {
  const horizontal = enclosingEllipse([tile('a', -200, 0), tile('b', 200, 0)], 40);
  const vertical = enclosingEllipse([tile('a', 0, -200), tile('b', 0, 200)], 40);
  const diagonal = enclosingEllipse([tile('a', -141, -141), tile('b', 141, 141)], 40);

  const degrees = (radians) => ((radians * 180) / Math.PI + 360) % 180;
  assert.ok(Math.abs(degrees(horizontal.angle) - 0) < 2, 'horizontal spread lies flat');
  assert.ok(Math.abs(degrees(vertical.angle) - 90) < 2, 'vertical spread stands up');
  assert.ok(Math.abs(degrees(diagonal.angle) - 45) < 2, 'diagonal spread leans');

  // A lone member has no spread to point along, so it stays a circle.
  const single = enclosingEllipse([tile('a', 0, 0)], 40);
  assert.ok(Math.abs(single.a - single.b) < 1, 'one member gives a circle');
});

test('the drawn path passes through every ring node of a settled ring', () => {
  // Catmull-Rom rather than a B-spline: the ring is where the physics put it,
  // so the drawing must not move it. Each node appears as a curve endpoint.
  //
  // "Settled" is load-bearing since the path became the hull. A ring that has
  // not been deformed is convex, so every node lies on its own hull and this
  // still holds exactly; a dented one drops the nodes in the bite, which is the
  // documented cost and is asserted separately below.
  const { nodes } = reconcileRing({ setId: 's1', members: [tile('a', 0, 0), tile('b', 150, 0)] });
  const path = ringPath(nodes);
  assert.match(path, /^M .* Z$/, 'the path is closed');
  for (const node of nodes) {
    const x = Math.round(node.x * 100) / 100;
    const y = Math.round(node.y * 100) / 100;
    assert.ok(path.includes(`${x} ${y}`), `the path reaches node at ${x} ${y}`);
  }
});

/** Whether any two non-adjacent edges of a closed polygon cross.
 *
 * The property the outline has to hold is "simple closed curve", and that is
 * only meaningful if it is tested directly rather than through a proxy. Proper
 * crossings only: shared endpoints between neighbouring edges are how a closed
 * loop is built, not a self-intersection. */
function selfIntersects(points) {
  const orient = (p, q, r) => Math.sign(((q.x - p.x) * (r.y - p.y)) - ((q.y - p.y) * (r.x - p.x)));
  const crosses = (a, b, c, d) => {
    const d1 = orient(a, b, c);
    const d2 = orient(a, b, d);
    const d3 = orient(c, d, a);
    const d4 = orient(c, d, b);
    return d1 !== d2 && d3 !== d4 && d1 !== 0 && d2 !== 0 && d3 !== 0 && d4 !== 0;
  };
  const n = points.length;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      // Adjacent edges share an endpoint by construction, and edge 0 wraps to
      // edge n-1, so neither pair can be a genuine crossing.
      if (j === i || j === (i + 1) % n || i === (j + 1) % n) continue;
      if (crosses(points[i], points[(i + 1) % n], points[j], points[(j + 1) % n])) return true;
    }
  }
  return false;
}

test('a tangled ring is still drawn as a simple closed curve', () => {
  // The angles RING-TANGLE.md measured on branch 3 after a single drag: ten
  // nodes whose order around the loop has been destroyed, with five backward
  // jumps and a 317-degree gap between neighbours. Drawn as a chain this is the
  // lens and the angular spikes that were seen on screen.
  //
  // This is the case that can fail. Walking these in ringIndex order self
  // intersects — asserted first, so the test cannot quietly pass against a
  // shape that was never tangled in the first place.
  const measured = [102, 59, 88, 121, 161, 204, 178, 209, 179, 140];
  const nodes = measured.map((degrees, i) => ({
    id: `s1:ring:${i}`,
    ringIndex: i,
    ringCount: measured.length,
    x: Math.cos((degrees * Math.PI) / 180) * 91,
    y: Math.sin((degrees * Math.PI) / 180) * 91,
  }));

  assert.ok(selfIntersects(nodes), 'the reproduced chain really is tangled');
  assert.ok(!selfIntersects(ringHull(nodes)), 'the hull drawn from it is not');

  const path = ringPath(nodes);
  assert.match(path, /^M .* Z$/, 'and it is still a closed path');
});

test('the hull survives a ring flung into spikes', () => {
  // Problem 4: under heavy dragging the outline tears into angular spikes and
  // lobes with a pinched neck. A hull cannot express any of those, by
  // construction rather than by tuning, so radius no longer has to be bounded
  // for the drawing to stay sane.
  const nodes = Array.from({ length: 24 }, (unused, i) => {
    const angle = (2 * Math.PI * i) / 24;
    const radius = i % 2 === 0 ? 60 : 280;
    return { id: `s1:ring:${i}`, ringIndex: i, x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  });

  const hull = ringHull(nodes);
  assert.ok(!selfIntersects(hull), 'no self-intersections');
  assert.ok(hull.length <= 12, `the spikes collapse to a few corners, got ${hull.length}`);
  for (const point of hull) {
    // Every surviving point is one of the long spikes: the short ones are
    // interior and a hull cannot dip back in to reach them.
    assert.ok(Math.hypot(point.x, point.y) > 270, 'the hull rides the outer radius');
  }
});

test('containment and drawing agree about who is inside', () => {
  // The fault that retired the geometry branch was the drawn shape and the
  // hit-tested shape being two different things. Whatever the chain does, a
  // point inside the hull must read as inside — including one in a bay that the
  // tangled chain would have reported as outside.
  const nodes = [102, 59, 88, 121, 161, 204, 178, 209, 179, 140].map((degrees, i) => ({
    id: `s1:ring:${i}`,
    ringIndex: i,
    x: Math.cos((degrees * Math.PI) / 180) * 91,
    y: Math.sin((degrees * Math.PI) / 180) * 91,
  }));

  // Those ten angles span only 150 degrees, so the ring really has collapsed to
  // the crescent RING-TANGLE.md describes as "a flat lens" — it encloses no
  // area around the member, and the origin is legitimately outside it. The hull
  // reports that rather than inventing area the nodes do not enclose, and this
  // is asserted so the geometry is not silently mistaken for a bug later.
  assert.ok(!pointInsideRing({ x: 0, y: 0 }, nodes), 'a collapsed ring encloses nothing');

  // A point genuinely within the crescent must read as inside, though — that is
  // the agreement being tested, and a hull that reported everything as outside
  // would pass the assertion above for the wrong reason.
  const interior = { x: Math.cos((140 * Math.PI) / 180) * 85, y: Math.sin((140 * Math.PI) / 180) * 85 };
  assert.ok(pointInsideRing(interior, nodes), 'a point within the crescent is inside');
  assert.ok(!pointInsideRing({ x: 400, y: 400 }, nodes), 'a distant point is not');

  // An ejected item must land outside the curve that is drawn, not outside some
  // other polygon the user cannot see.
  const target = ejectionTarget(interior, nodes);
  assert.ok(target, 'an enclosed point is given somewhere to go');
  assert.ok(!pointInsideRing(target, nodes), 'and it lands outside the drawn shape');
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
      // 36 matches RING_NODE_RADIUS in the app: half a tile, so a ring node is
      // as substantial as the thing it resists. At 18 a pinned foreign tile
      // pushed through.
      .radius((n) => (n.ring ? 30 : Math.max(n.width, n.height) / 2 + 20))
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

test('the ring holds an outsider out however hard it is pushed', () => {
  // With the earlier radial force this was only resistance: a drift was held
  // out and anything firmer than about 0.005 per tick went through. Pulling
  // each node to its own slot keeps the boundary in shape under load, so it
  // now holds across two orders of magnitude of push.
  assert.equal(pullInside(0.001), false, 'a gentle drift is held out');
  assert.equal(pullInside(0.01), false, 'and so is a firm push');
  assert.equal(pullInside(0.05), false, 'and a very hard one');
});


test('the ring follows a member that is dragged away', () => {
  // The fault that retired the previous branch: the outline stayed behind and
  // collapsed into a flat lens.
  //
  // The drag has to be simulated the way pointer-controller performs one —
  // many small steps, each pinning fx/fy and reheating to 0.12 — because that
  // is what exposes it. A single large jump does NOT reproduce the fault, and
  // an earlier version of this test used one, passed against the broken code,
  // and led to a wrong diagnosis.
  const member = tile('me', 0, 0);
  const members = [member];
  const { nodes: ring, links } = reconcileRing({ setId: 's1', members });
  const simulation = settle(members, ring, links, 400);

  const spread = () => {
    const xs = ring.map((n) => n.x);
    const ys = ring.map((n) => n.y);
    return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  };
  const settledSize = spread();

  for (let x = 0; x <= 400; x += 20) {
    member.fx = x;
    member.fy = -x * 0.75;
    member.x = x;
    member.y = -x * 0.75;
    simulation.alpha(0.12);
    for (let i = 0; i < 3; i += 1) simulation.tick();
  }

  const cx = ring.reduce((total, n) => total + n.x, 0) / ring.length;
  const cy = ring.reduce((total, n) => total + n.y, 0) / ring.length;
  const lag = Math.hypot(member.x - cx, member.y - cy);
  // 205px with the original force, 42 with this one. The threshold is set to
  // catch a regression towards the old behaviour, not to pin the exact figure.
  assert.ok(lag < 90, `the ring trailed ${lag.toFixed(0)}px behind its member`);

  // And it must not shrink on the way. Collapsing is what produced the lens:
  // the original force left it at 120x97 from a settled 183x174.
  const dragged = spread();
  assert.ok(
    dragged.w > settledSize.w * 0.8 && dragged.h > settledSize.h * 0.8,
    `the ring collapsed from ${settledSize.w.toFixed(0)}x${settledSize.h.toFixed(0)} `
    + `to ${dragged.w.toFixed(0)}x${dragged.h.toFixed(0)}`,
  );
});


test('a member is still enclosed while a foreign item presses on the wall', () => {
  // The other half: keeping an outsider out must not cost the set its own
  // members. A boundary that solved exclusion by shrinking away would pass the
  // test above and be useless.
  const members = [tile('a', 0, 0), tile('b', 0, 150)];
  const foreign = tile('f', 120, 75);
  const { nodes: ring, links } = reconcileRing({ setId: 's1', members });
  const simulation = settle(members, [foreign, ...ring], links, 300);

  // Both fx/fy and x/y, which is what pointer-controller sets on a drag. Pinning
  // fx alone leaves the node's current position to be resolved on the next
  // tick, and the ring gets a free tick to react that a real drag never gives
  // it — an earlier version of these tests did that and measured a boundary
  // more permeable than the app's.
  foreign.fx = 120;
  foreign.fy = 75;
  foreign.x = 120;
  foreign.y = 75;
  for (let i = 0; i < 200; i += 1) simulation.tick();

  for (const member of members) {
    assert.ok(insideRing(ring, member), `member ${member.id} was pushed out of its own set`);
  }
  assert.ok(!insideRing(ring, foreign), 'and the foreign item is still outside');
});

// ===========================================================================
// Ejection. The ring cannot win an argument with a drag — a dragged node has
// its position set outright, so collision has nothing to push back against.
// Stiffening the boundary enough to resist one made the whole set convulse and
// foreign items still got in. So the drag is left alone and the trespasser is
// moved out once the gesture is over.
// ===========================================================================

test('a trespasser is put down just outside the boundary', () => {
  const members = [tile('a', 0, 0), tile('b', 0, 200)];
  const { nodes: ring, links } = reconcileRing({ setId: 's1', members });
  settle(members, ring, links, 400);

  // Several places inside, including right on top of a member.
  for (const point of [{ x: 0, y: 100 }, { x: 0, y: 0 }, { x: -60, y: 180 }]) {
    assert.ok(pointInsideRing(point, ring), 'the test point starts inside');
    const target = ejectionTarget(point, ring);
    assert.ok(target, 'an inside point gets somewhere to go');
    assert.ok(!pointInsideRing(target, ring), `ejecting from ${JSON.stringify(point)} left it inside`);
  }
});

test('an item already outside is left exactly where it is', () => {
  // Returning a target for everything would nudge settled layouts on every
  // tick, which is its own kind of convulsing.
  const members = [tile('a', 0, 0), tile('b', 0, 200)];
  const { nodes: ring, links } = reconcileRing({ setId: 's1', members });
  settle(members, ring, links, 400);
  assert.equal(ejectionTarget({ x: 400, y: 100 }, ring), null);
});

test('ejection takes the shortest way out, not the way through the middle', () => {
  // From the waist of a long thin set the near edge is sideways; pushing away
  // from a centre would drag the item the whole length of the boundary.
  //
  // The ring is built by hand rather than settled, because two members left to
  // the simulation do not stay in a line — charge pushes them apart and the
  // boundary comes out nearly round, where "sideways" means nothing. This is
  // about the geometry, so the geometry is what is supplied.
  const ring = [];
  const count = 40;
  for (let i = 0; i < count; i += 1) {
    const t = (2 * Math.PI * i) / count;
    ring.push({ ringIndex: i, ringCount: count, x: Math.cos(t) * 600, y: Math.sin(t) * 80 });
  }

  const target = ejectionTarget({ x: 0, y: 0 }, ring);
  assert.ok(target, 'the waist is inside');
  assert.ok(
    Math.abs(target.y) > Math.abs(target.x),
    `ejected the long way, to (${target.x.toFixed(0)}, ${target.y.toFixed(0)})`,
  );
  assert.ok(!pointInsideRing(target, ring), 'and it landed outside');
});

test('a degenerate ring cannot eject anything', () => {
  assert.equal(ejectionTarget({ x: 0, y: 0 }, []), null);
  assert.equal(ejectionTarget({ x: 0, y: 0 }, [{ x: 0, y: 0, ringIndex: 0 }]), null);
});

// ===========================================================================
// The speed limit. Dragging several foreign items through a set compounds:
// each pushes the members, the members pull the ring, and the sum explodes
// even though no single force is wrong.
// ===========================================================================

test('a node moving faster than the cap is slowed to it', () => {
  const fast = { id: 'a', vx: 100, vy: 0 };
  const force = forceSpeedLimit({ maxPerTick: 8 });
  force.initialize([fast]);
  force(1);
  assert.equal(Math.hypot(fast.vx, fast.vy).toFixed(2), '8.00');
  assert.ok(fast.vx > 0, 'and keeps its direction');
});

test('a node already within the cap is untouched', () => {
  // A governor that rescaled everything would drag the whole layout towards a
  // uniform speed, which is its own kind of wrongness.
  const slow = { id: 'a', vx: 2, vy: 1 };
  const force = forceSpeedLimit({ maxPerTick: 8 });
  force.initialize([slow]);
  force(1);
  assert.equal(slow.vx, 2);
  assert.equal(slow.vy, 1);
});

test('direction survives the cap exactly', () => {
  const node = { id: 'a', vx: 30, vy: 40 };
  const before = Math.atan2(node.vy, node.vx);
  const force = forceSpeedLimit({ maxPerTick: 5 });
  force.initialize([node]);
  force(1);
  assert.ok(
    Math.abs(Math.atan2(node.vy, node.vx) - before) < 1e-9,
    'a cap must slow a node, never steer it',
  );
});

test('the cap tames several items dragged through a set at once', () => {
  // The reproduction: four foreign items swept through a set on pinned
  // positions. Uncapped this reached 164px in a single tick.
  const members = [tile('a', 0, -150), tile('b', 20, 0), tile('c', -10, 150)];
  const foreign = [tile('f1', -200, -60), tile('f2', 180, 40), tile('f3', -160, 180), tile('f4', 150, -180)];
  const { nodes: ring, links } = reconcileRing({ setId: 's1', members });

  const simulation = forceSimulation([...members, ...foreign, ...ring]).alpha(1).stop()
    .force('charge', forceManyBody().strength((n) => (n.ring ? 0 : -280)))
    .force('collide', forceCollide()
      .radius((n) => (n.ring ? 30 : Math.max(n.width, n.height) / 2 + 20)).strength(0.9))
    .force('link', forceLink(links).id((d) => d.id)
      .distance((l) => (l.source.ring ? 60 : 145))
      .strength((l) => (l.source.ring ? 0.9 : 0.14)))
    .force('ring', forceRingShape({ membersOf: () => members }))
    // The exclusion force has to be here: it is what makes the drag compound,
    // because each foreign item shoves the members and the members drag the
    // ring. An earlier version of this test left it out, measured a peak of
    // 7.8px that was already under the cap, and so passed with the cap
    // disabled — proving nothing at all.
    .force('setExclusion', forceSetExclusion({
      setsOf: (id) => (members.some((m) => m.id === id) ? ['s1'] : []),
      membersOf: () => members,
      isHeld: (id) => foreign.some((f) => f.id === id),
    }))
    .force('speedLimit', forceSpeedLimit());
  for (let i = 0; i < 400; i += 1) simulation.tick();

  let peak = 0;
  for (let step = 0; step < 40; step += 1) {
    const before = ring.map((n) => ({ x: n.x, y: n.y }));
    foreign.forEach((item, i) => {
      const angle = (step * 0.3) + (i * 1.6);
      item.fx = Math.cos(angle) * 160;
      item.fy = Math.sin(angle) * 160;
      item.x = item.fx;
      item.y = item.fy;
    });
    simulation.alpha(0.12);
    for (let i = 0; i < 3; i += 1) simulation.tick();
    for (let i = 0; i < ring.length; i += 1) {
      peak = Math.max(peak, Math.hypot(ring[i].x - before[i].x, ring[i].y - before[i].y));
    }
  }
  // Three ticks per step, so the ceiling is three times the per-tick cap.
  assert.ok(peak < 30, `the ring still lurched ${peak.toFixed(0)}px in one step`);
});

test('the ellipse encloses every member, including outliers', () => {
  // Covariance describes the *typical* spread — it is a standard deviation, so
  // a member further out than average falls outside the ellipse it defines.
  // Measured on a seven-member set after a folder was expanded, one member sat
  // at 1.09 in ellipse units and another at 0.99: outside its own set,
  // permanently, which is what was seen on screen.
  const layouts = [
    [tile('a', 0, 0), tile('b', 140, 0)],
    [tile('a', -150, -150), tile('b', 150, 150)],
    [tile('Letters', 0, -60), tile('Real', 150, 120), tile('Me', 30, 40),
      tile('PDF', -90, 80), tile('Apps', -160, -90), tile('SKP', -110, -10), tile('Run', -20, -200)],
  ];

  for (const members of layouts) {
    const ellipse = enclosingEllipse(members, 40);
    const cos = Math.cos(-ellipse.angle);
    const sin = Math.sin(-ellipse.angle);
    for (const member of members) {
      const dx = member.x - ellipse.x;
      const dy = member.y - ellipse.y;
      const units = Math.hypot(
        ((dx * cos) - (dy * sin)) / ellipse.a,
        ((dx * sin) + (dy * cos)) / ellipse.b,
      );
      assert.ok(units <= 1, `${member.id} sits at ${units.toFixed(2)}, outside its own set`);
    }
  }
});

test('growing to fit does not inflate the boundary all round', () => {
  // Scaling both axes by the worst overshoot makes a set that only needed to
  // reach further one way swell in every direction, and a boundary bigger than
  // its contents is what lets bystanders sit inside it. Two members 140px apart
  // came out 455x257 that way.
  const ellipse = enclosingEllipse([tile('a', 0, 0), tile('b', 140, 0)], 40);
  assert.ok(2 * ellipse.b < 200, `the short axis grew to ${(2 * ellipse.b).toFixed(0)}`);
  assert.ok(2 * ellipse.a > 2 * ellipse.b, 'and the long axis is still the long one');
});

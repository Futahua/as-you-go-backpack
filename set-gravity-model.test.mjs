/** Sets as gravity rather than geometry.
 *
 * The layout already works this way: the graph is an equilibrium of a pull
 * towards the viewport centre, mutual repulsion, and link distances. These
 * tests are about adding one more term of that kind and checking it settles,
 * rather than about any shape being drawn afterwards. */

import assert from 'node:assert/strict';
import test from 'node:test';
import { centreOfMass, forceSetGravity, forceSetExclusion } from './public/set-gravity-model.js';

function node(id, x, y) {
  return { id, x, y, vx: 0, vy: 0 };
}

/** Runs the force the way d3 does: adjust velocities, then integrate.
 *
 * velocityDecay 0.32 and the alpha schedule match the real simulation, so a
 * result here means the same thing there. */
function settle(nodes, force, { ticks = 300, velocityDecay = 0.32 } = {}) {
  force.initialize(nodes);
  let alpha = 1;
  for (let i = 0; i < ticks; i += 1) {
    alpha += (0 - alpha) * 0.028;
    force(alpha);
    for (const n of nodes) {
      n.vx *= 1 - velocityDecay;
      n.vy *= 1 - velocityDecay;
      n.x += n.vx;
      n.y += n.vy;
    }
  }
  return nodes;
}

function spread(nodes) {
  const centre = centreOfMass(nodes);
  return Math.max(...nodes.map((n) => Math.hypot(n.x - centre.x, n.y - centre.y)));
}

test('the centre of mass is the members own mean', () => {
  assert.deepEqual(centreOfMass([node('a', 0, 0), node('b', 100, 0)]), { x: 50, y: 0 });
  assert.deepEqual(centreOfMass([node('a', 0, 0), node('b', 60, 0), node('c', 0, 60)]), { x: 20, y: 20 });
  assert.equal(centreOfMass([]), null, 'an empty set has no centre');
});

test('members of a set gather', () => {
  // The whole premise: scattered members of one set draw together on their own,
  // with no shape computed and nothing imposed on them.
  const nodes = [node('a', -400, 0), node('b', 400, 0), node('c', 0, -400), node('d', 0, 400)];
  const before = spread(nodes);
  settle(nodes, forceSetGravity({ setsOf: () => ['s1'] }));
  const after = spread(nodes);
  assert.ok(after < before * 0.7, `they gathered (${before.toFixed(0)} -> ${after.toFixed(0)})`);
});

test('items in no set are left alone', () => {
  const nodes = [node('a', -300, 0), node('b', 300, 0)];
  const before = nodes.map((n) => ({ ...n }));
  settle(nodes, forceSetGravity({ setsOf: () => [] }));
  for (let i = 0; i < nodes.length; i += 1) {
    assert.equal(nodes[i].x, before[i].x, `${nodes[i].id} did not move in x`);
    assert.equal(nodes[i].y, before[i].y, `${nodes[i].id} did not move in y`);
  }
});

test('two sets gather separately rather than into one clump', () => {
  // Each set has its own centre. Without that they would all fall towards a
  // single point and the sets would be indistinguishable.
  const nodes = [
    node('a1', -300, -100), node('a2', -100, -300),
    node('b1', 300, 100), node('b2', 100, 300),
  ];
  const setsOf = (id) => (id.startsWith('a') ? ['sa'] : ['sb']);
  settle(nodes, forceSetGravity({ setsOf }));

  const a = centreOfMass(nodes.filter((n) => n.id.startsWith('a')));
  const b = centreOfMass(nodes.filter((n) => n.id.startsWith('b')));
  const withinA = Math.hypot(nodes[0].x - a.x, nodes[0].y - a.y);
  const between = Math.hypot(a.x - b.x, a.y - b.y);
  assert.ok(between > withinA * 4, `the two sets stayed apart (between ${between.toFixed(0)}, within ${withinA.toFixed(0)})`);
});

test('a shared member settles between the sets it belongs to', () => {
  // Membership of two sets means being pulled towards both centres, so the
  // shared item ends up in the overlap. The Venn falls out of the arithmetic
  // rather than needing a rule of its own.
  const nodes = [
    node('a', -300, 0), node('shared', 0, 0), node('b', 300, 0),
  ];
  const setsOf = (id) => (id === 'shared' ? ['sa', 'sb'] : id === 'a' ? ['sa'] : ['sb']);
  settle(nodes, forceSetGravity({ setsOf }));

  const shared = nodes.find((n) => n.id === 'shared');
  const left = nodes.find((n) => n.id === 'a');
  const right = nodes.find((n) => n.id === 'b');
  assert.ok(shared.x > left.x && shared.x < right.x, 'the shared member is between the two');
  assert.ok(
    Math.abs(Math.abs(shared.x - left.x) - Math.abs(shared.x - right.x)) < 40,
    'and roughly equidistant from each',
  );
});

test('a held member is not pulled, and the set follows it', () => {
  // The yielding. A held item goes exactly where the pointer puts it, but it
  // still counts towards its set's centre, so picking up one member draws the
  // others after it rather than leaving them behind.
  const nodes = [node('held', 600, 0), node('a', 0, 0), node('b', 0, 100)];
  const held = nodes[0];
  const startX = held.x;
  settle(nodes, forceSetGravity({ setsOf: () => ['s1'], isHeld: (id) => id === 'held' }));

  assert.equal(held.x, startX, 'the held member did not move');
  assert.equal(held.y, 0, 'in either axis');
  for (const id of ['a', 'b']) {
    const follower = nodes.find((n) => n.id === id);
    assert.ok(follower.x > 100, `${id} moved towards the held member (x=${follower.x.toFixed(0)})`);
  }
});

test('a set of one is left where it is', () => {
  // Nothing to gather towards. Pulling a lone member to its own position would
  // be a no-op with a rounding error, so it is skipped outright.
  const nodes = [node('only', 250, -80)];
  settle(nodes, forceSetGravity({ setsOf: () => ['s1'] }));
  assert.equal(nodes[0].x, 250);
  assert.equal(nodes[0].y, -80);
});

test('the gathering settles instead of collapsing or oscillating', () => {
  // The centre is the members' own mean, so it moves with them: as they
  // converge the force falls away rather than continuing to squeeze. A fixed
  // centre would pull them all onto one point.
  const nodes = [node('a', -200, 0), node('b', 200, 0), node('c', 0, 200)];
  settle(nodes, forceSetGravity({ setsOf: () => ['s1'] }), { ticks: 2000 });

  const finalSpread = spread(nodes);
  assert.ok(finalSpread > 1, `the set did not collapse to a point (spread ${finalSpread.toFixed(1)})`);
  for (const n of nodes) {
    assert.ok(
      Math.hypot(n.vx, n.vy) < 0.5,
      `${n.id} came to rest rather than oscillating (speed ${Math.hypot(n.vx, n.vy).toFixed(2)})`,
    );
  }
});

// ===========================================================================
// Exclusion. A boundary can only exclude what lies outside the region its
// members occupy: a bystander resting BETWEEN two members is interior however
// the outline is drawn. So the layout has to express membership too, not just
// the drawing.
// ===========================================================================

test('a non-member sitting among the members is pushed out of the cloud', () => {
  const members = [
    { id: 'a', x: 0, y: -150 },
    { id: 'b', x: 0, y: 0 },
    { id: 'c', x: 0, y: 150 },
  ];
  // Right in the middle of them, where no closed curve around the members can
  // leave it out.
  const outsider = { id: 'x', x: 40, y: 0 };
  const nodes = [...members, outsider];

  const force = forceSetExclusion({
    setsOf: (id) => (id === 'x' ? [] : ['s1']),
    membersOf: () => members,
  });
  force.initialize(nodes);
  const nearestBefore = Math.min(...members.map((m) => Math.hypot(outsider.x - m.x, outsider.y - m.y)));

  for (let i = 0; i < 300; i += 1) {
    force(0.3);
    outsider.vx *= 0.6;
    outsider.vy *= 0.6;
    outsider.x += outsider.vx;
    outsider.y += outsider.vy;
  }

  const nearestAfter = Math.min(...members.map((m) => Math.hypot(outsider.x - m.x, outsider.y - m.y)));
  assert.ok(
    nearestAfter > nearestBefore,
    `the outsider did not move away (${nearestBefore.toFixed(0)} -> ${nearestAfter.toFixed(0)})`,
  );
  assert.ok(nearestAfter > 100, `it is still among the members at ${nearestAfter.toFixed(0)}px`);
});

test('members are never pushed by the exclusion force', () => {
  // They are gathered by forceSetGravity; a force shoving them apart would be
  // arguing with it, and the set would never settle.
  const members = [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 60, y: 0 }];
  const force = forceSetExclusion({ setsOf: () => ['s1'], membersOf: () => members });
  force.initialize(members);
  force(1);
  for (const member of members) {
    assert.equal(member.vx ?? 0, 0, `${member.id} was pushed`);
    assert.equal(member.vy ?? 0, 0, `${member.id} was pushed`);
  }
});

test('a held item is left where the user is putting it', () => {
  const members = [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 0, y: 120 }];
  const dragged = { id: 'x', x: 0, y: 60 };
  const force = forceSetExclusion({
    setsOf: (id) => (id === 'x' ? [] : ['s1']),
    membersOf: () => members,
    isHeld: (id) => id === 'x',
  });
  force.initialize([...members, dragged]);
  force(1);
  assert.equal(dragged.vx ?? 0, 0, 'a drag is not fought');
  assert.equal(dragged.vy ?? 0, 0, 'a drag is not fought');
});

test('an item already clear of the set is left alone', () => {
  const members = [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 0, y: 100 }];
  const distant = { id: 'x', x: 600, y: 50 };
  const force = forceSetExclusion({
    setsOf: (id) => (id === 'x' ? [] : ['s1']),
    membersOf: () => members,
  });
  force.initialize([...members, distant]);
  force(1);
  assert.equal(distant.vx ?? 0, 0, 'nothing to correct');
});

test('an item belonging to the set is not treated as a trespasser', () => {
  const members = [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 0, y: 120 }, { id: 'c', x: 20, y: 60 }];
  const force = forceSetExclusion({ setsOf: () => ['s1'], membersOf: () => members });
  force.initialize(members);
  force(1);
  const middle = members.find((m) => m.id === 'c');
  assert.equal(middle.vx ?? 0, 0, 'a member in the middle of its own set stays');
});

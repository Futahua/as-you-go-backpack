/** Sets as centres of gravity.
 *
 * A set is not a shape to be computed and then imposed on the layout. It is an
 * attraction: its members are pulled towards their common centre, so they
 * gather on their own, and whatever outline gets drawn is a consequence of
 * where they ended up rather than a constraint they had to obey.
 *
 * That order matters, and getting it backwards is expensive. Computing an
 * envelope first and then forcing positions to respect it means solving for a
 * shape that spans members wherever they happen to be — which needs connectors
 * between distant ones, and those connectors are thin, and thin connectors
 * pinch around whatever they pass. None of that arises here: members that
 * belong together are already near each other, so there is nothing to bridge.
 *
 * The graph already works this way. Every node is pulled to the viewport centre
 * at a low strength, repelled from every other, and held at a distance by its
 * links; the layout is the equilibrium of those. This adds one more term of the
 * same kind — a pull towards the set's own centre instead of only the global
 * one — rather than a different kind of rule layered on top.
 *
 * The centre is the members' own mean, so it moves as they do — a set drifts
 * with its members rather than being anchored anywhere.
 *
 * That alone does not stop it collapsing, though, and it is tempting to think
 * it does: as the members converge the centre stays among them and the pull
 * continues all the way to a single point. Measured in isolation, a three
 * member set contracts to a spread of zero. In the real graph the charge and
 * collision forces push back long before that, but a force that only behaves
 * because something else is holding it up is not one worth having, so the
 * attraction stops at a rest radius instead.
 *
 * No DOM, store, or browser APIs. */

/** The mean position of a set of nodes.
 *
 * Held nodes are included. A set's centre should follow the member the user is
 * dragging — that is what makes the rest of the set trail after it rather than
 * stay behind and stretch. */
export function centreOfMass(members) {
  if (!members || members.length === 0) return null;
  let x = 0;
  let y = 0;
  for (const member of members) {
    x += member.x;
    y += member.y;
  }
  return { x: x / members.length, y: y / members.length };
}

/** A d3-force that pulls each set's members towards their common centre.
 *
 * `setsOf(nodeId)` returns the set ids a node belongs to; a node in several
 * sets is pulled towards each of their centres, so it settles in between and
 * the sets overlap there. That is the Venn, and it falls out of the arithmetic
 * rather than needing a rule of its own.
 *
 * `isHeld(nodeId)` marks a node the user is dragging. A held node is not pulled
 * — it goes exactly where the pointer puts it — but it still counts towards its
 * set's centre, so picking up one member draws the others after it. That is the
 * yielding: the set follows the member, not the other way round.
 *
 * The force is written in the d3 idiom — a function of alpha that adjusts
 * velocities, with an `initialize` hook — so it composes with charge, collision
 * and links instead of fighting them from a tick handler. */
export function forceSetGravity({
  setsOf,
  isHeld = () => false,
  strength = 0.08,
  // How close is close enough. Inside this the pull stops, which is what makes
  // a set gather to a cluster rather than to a point.
  restRadius = 120,
} = {}) {
  let nodes = [];

  function force(alpha) {
    // Group by set once per tick. The centres have to be recomputed every tick
    // because the members are moving; caching them across ticks is what would
    // make a set lag behind a dragged member.
    const groups = new Map();
    for (const node of nodes) {
      for (const setId of setsOf(node.id) ?? []) {
        if (!groups.has(setId)) groups.set(setId, []);
        groups.get(setId).push(node);
      }
    }

    for (const [, members] of groups) {
      // A set of one has no centre to speak of — its member is already there,
      // and pulling it towards itself would be a no-op with a rounding error.
      if (members.length < 2) continue;
      const centre = centreOfMass(members);
      for (const node of members) {
        if (isHeld(node.id)) continue;
        const dx = centre.x - node.x;
        const dy = centre.y - node.y;
        const distance = Math.hypot(dx, dy);
        // Already close enough. Pulling further would draw the set onto a
        // single point, and the excess is what is pulled on rather than the
        // whole distance, so the force eases off as a member arrives instead of
        // stopping abruptly at the boundary.
        if (distance <= restRadius) continue;
        const excess = (distance - restRadius) / distance;
        node.vx += dx * excess * strength * alpha;
        node.vy += dy * excess * strength * alpha;
      }
    }
  }

  force.initialize = (value) => { nodes = value ?? []; };
  force.strength = (value) => {
    if (value === undefined) return strength;
    strength = value;
    return force;
  };

  return force;
}

/** Pushes non-members out of the sets they have wandered into.
 *
 * The ring cannot do this on its own. A boundary is a closed curve, so it can
 * only exclude what lies outside the region its members occupy — a bystander
 * that comes to rest *between* two members is inside the cloud, and no convex
 * outline can enclose the members while leaving it out. Measured on a
 * six-member set: two foreign items sat 92 and 100px from their nearest
 * member, comfortably interior, and the ring had no choice but to contain
 * them.
 *
 * So the layout is what has to express membership, not just the drawing. A
 * foreign item inside a set is pushed away from that set's centre until it is
 * clear of the members, which is the same instinct as spitting a trespasser
 * out on release, applied continuously so it never settles there at all.
 *
 * Members are never pushed — they are pulled together by forceSetGravity, and
 * a force that shoved them apart would be arguing with it. Held items are
 * exempt too: while the user is dragging something, it goes where they put it.
 */
export function forceSetExclusion({
  setsOf,
  membersOf,
  isHeld = () => false,
  strength = 0.35,
  // How far outside the member cloud a foreign item is pushed. Comfortably
  // more than a tile, so the gap reads as deliberate rather than as a near
  // miss, and enough that the ring's own padding does not swallow it again.
  clearance = 150,
} = {}) {
  let nodes = [];

  function force(alpha) {
    for (const node of nodes) {
      if (node.ring) continue;
      if (isHeld(node.id)) continue;
      const own = new Set(setsOf(node.id) ?? []);

      for (const setId of setIdsInPlay(nodes, setsOf)) {
        if (own.has(setId)) continue;
        const members = (membersOf(setId) ?? []).filter((member) => member.id !== node.id);
        if (members.length === 0) continue;

        // Distance to the nearest member, not to the centre: a set is a cloud
        // rather than a disc, and what makes an item look like it belongs is
        // sitting close to the things in it.
        let nearest = Infinity;
        for (const member of members) {
          nearest = Math.min(nearest, Math.hypot(node.x - member.x, node.y - member.y));
        }
        if (nearest >= clearance) continue;

        // Away from the centre of mass, so the escape route leads out of the
        // cloud rather than deeper between two of its members.
        const centre = centreOfMass(members);
        let dx = node.x - centre.x;
        let dy = node.y - centre.y;
        let distance = Math.hypot(dx, dy);
        if (distance < 1e-6) {
          // Sitting exactly on the centre gives no direction to leave along.
          // Any fixed one will do, and a deterministic choice keeps the layout
          // reproducible rather than depending on floating-point noise.
          dx = 1;
          dy = 0;
          distance = 1;
        }
        const push = ((clearance - nearest) / clearance) * strength * alpha;
        // Defaulted rather than assumed: d3 seeds vx/vy when it owns the nodes,
        // but a caller passing plain objects would otherwise turn the whole
        // layout into NaN on the first tick, silently and unrecoverably.
        node.vx = (node.vx ?? 0) + ((dx / distance) * push * clearance);
        node.vy = (node.vy ?? 0) + ((dy / distance) * push * clearance);
      }
    }
  }

  force.initialize = (value) => { nodes = value ?? []; };
  return force;
}

/** Every set that has at least one node on screen. */
function setIdsInPlay(nodes, setsOf) {
  const ids = new Set();
  for (const node of nodes) {
    for (const setId of setsOf(node.id) ?? []) ids.add(setId);
  }
  return ids;
}

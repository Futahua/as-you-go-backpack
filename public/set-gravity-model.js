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

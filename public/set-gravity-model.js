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

// Exclusion has to ask "is this item inside the outline?" against the same
// shape the user sees, or the force and the drawing disagree about who is in.
import { ringHull } from './set-ring-model.js';

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
  // The ring nodes of a set, so exclusion can ask the question that actually
  // matters — is this item inside the outline? — rather than a proxy for it.
  //
  // Distance to the nearest member was the proxy, and it disagrees with the
  // boundary exactly where leaks were reported: an item can be well clear of
  // every member and still be inside the drawn ring, in the space between them
  // or out towards the padding. Testing containment directly means the force
  // and the outline cannot disagree about who is in.
  ringOf = () => null,
  isHeld = () => false,
  strength = 0.35,
  // How far outside the member cloud a foreign item is pushed once it is out.
  // Comfortably more than a tile, so the gap reads as deliberate rather than
  // as a near miss.
  clearance = 150,
} = {}) {
  let nodes = [];

  function force(alpha) {
    // One hull per set per tick. The ring nodes do not move within a tick, and
    // building it inside the node loop would rebuild the same hull once per
    // item per set — the exclusion test runs against every node on screen.
    const hulls = new Map();
    const hullOf = (setId) => {
      if (!hulls.has(setId)) {
        const ring = ringOf(setId);
        hulls.set(setId, ring ? ringHull(ring) : null);
      }
      return hulls.get(setId);
    };

    for (const node of nodes) {
      if (node.ring) continue;
      if (isHeld(node.id)) continue;
      const own = new Set(setsOf(node.id) ?? []);

      for (const setId of setIdsInPlay(nodes, setsOf)) {
        if (own.has(setId)) continue;
        const members = (membersOf(setId) ?? []).filter((member) => member.id !== node.id);
        if (members.length === 0) continue;

        // Inside the outline, or close enough to the members to be about to be.
        //
        // Containment is the real question and the ring is the real answer, so
        // it is asked first. The proximity test stays as a second condition
        // rather than a replacement: it catches an item pressing on the
        // boundary from outside, which the ring would otherwise have to be
        // deformed by before anything pushed back.
        const hull = hullOf(setId);
        const enclosed = hull ? pointInRing(node, hull) : false;

        let nearest = Infinity;
        for (const member of members) {
          nearest = Math.min(nearest, Math.hypot(node.x - member.x, node.y - member.y));
        }
        if (!enclosed && nearest >= clearance) continue;

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
        // An item that is genuinely inside gets the full push regardless of how
        // far it happens to be from a member — being inside is the whole of the
        // problem, and scaling by proximity would barely move one sitting in
        // open space within the outline, which is where the leaks were.
        const urgency = enclosed ? 1 : (clearance - nearest) / clearance;
        const push = urgency * strength * alpha;
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

/** Keeps the outlines of unrelated sets from crossing each other.
 *
 * Two sets sharing no members settled with their outlines crossing and the lens
 * between them holding no icons at all — a boundary drawn through empty space,
 * saying nothing true about either set.
 *
 * Nothing existed to prevent it. Ring nodes are given zero charge, so they do
 * not repel; collision separates node from node at 60px, which two rings can
 * satisfy while the curves drawn through them still overlap. No force acted
 * between two sets at all.
 *
 * Ring charge was the obvious lever and is the wrong one. It is global: a
 * charged ring node pushes on its own members and its own neighbours as well as
 * on other sets, which is why it was set to zero to begin with. Measured, it
 * also does not behave monotonically — -20 and -120 separate the rings where -60
 * still crosses — so any value that worked would be working by luck.
 *
 * This acts only between ring nodes belonging to different sets, and only
 * within a clearance, so a settled pair of distant sets pays nothing.
 *
 * Sets that share a member are exempt, and that exemption is the point rather
 * than a special case: two sets with an item in common are *supposed* to
 * overlap, because the shared item is pulled towards both centres and has to sit
 * in the region belonging to both. Pushing those apart would break the Venn the
 * gravity force builds. Verified: with the exemption, a shared-member scene
 * still overlaps and its lens contains exactly the shared item. */
export function forceSetSeparation({
  setsOf,
  // How far apart the rings of unrelated sets are held. Wider than the ring
  // link distance of 60, so the gap reads as deliberate rather than as two
  // boundaries resting against each other.
  clearance = 90,
  strength = 0.5,
} = {}) {
  let nodes = [];

  function force(alpha) {
    const ring = nodes.filter((node) => node.ring);
    if (ring.length < 2) return;

    // Which sets share at least one member, resolved once per tick. Membership
    // is read through setsOf rather than stored, so inheritance through folders
    // is respected the same way the other set forces respect it.
    const membersBySet = new Map();
    for (const node of nodes) {
      if (node.ring) continue;
      for (const setId of setsOf(node.id) ?? []) {
        if (!membersBySet.has(setId)) membersBySet.set(setId, new Set());
        membersBySet.get(setId).add(node.id);
      }
    }
    const related = new Set();
    const setIds = [...membersBySet.keys()];
    for (let i = 0; i < setIds.length; i += 1) {
      for (let j = i + 1; j < setIds.length; j += 1) {
        const a = membersBySet.get(setIds[i]);
        const b = membersBySet.get(setIds[j]);
        for (const id of a) {
          if (!b.has(id)) continue;
          related.add(`${setIds[i]} ${setIds[j]}`);
          related.add(`${setIds[j]} ${setIds[i]}`);
          break;
        }
      }
    }

    // Bucketed on a grid of the clearance, so each node only considers the nine
    // cells it could possibly reach into. The pairwise version was correct and
    // unshippable: 688 ring nodes is 236k pairs, measured at 7.3ms per tick --
    // 46% of a frame, against 0.2% for the whole of the set drawing.
    const cells = new Map();
    const key = (cx, cy) => `${cx},${cy}`;
    for (const node of ring) {
      const k = key(Math.floor(node.x / clearance), Math.floor(node.y / clearance));
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k).push(node);
    }

    for (const a of ring) {
      const ax = Math.floor(a.x / clearance);
      const ay = Math.floor(a.y / clearance);
      for (let ox = -1; ox <= 1; ox += 1) {
       for (let oy = -1; oy <= 1; oy += 1) {
        for (const b of cells.get(key(ax + ox, ay + oy)) ?? []) {
        // Each unordered pair once. Both nodes are visited and each finds the
        // other, so without this every pair would be pushed twice.
        if (!(a.id < b.id)) continue;
        if (a.setId === b.setId) continue;
        if (related.has(`${a.setId} ${b.setId}`)) continue;

        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distance = Math.hypot(dx, dy);
        if (distance > clearance || distance < 1e-6) continue;

        // Eases off as the gap closes on the clearance, so rings that are only
        // just near each other are nudged rather than shoved.
        const push = ((clearance - distance) / clearance) * strength * alpha * clearance;
        const ux = dx / distance;
        const uy = dy / distance;
        a.vx = (a.vx ?? 0) - (ux * push);
        a.vy = (a.vy ?? 0) - (uy * push);
        b.vx = (b.vx ?? 0) + (ux * push);
        b.vy = (b.vy ?? 0) + (uy * push);
        }
       }
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

/** Ray casting against a set's hull — the shape that is drawn.
 *
 * This walked the chain in ringIndex order, which is a polygon only while the
 * loop stays ordered, and RING-TANGLE.md measured that it does not. Over a
 * crossed loop a ray cast reports points plainly inside as outside, silently,
 * and here that means exclusion simply fails to fire on an item the user can
 * see sitting inside the outline.
 *
 * Accepts pre-hulled points as well as raw nodes: ringHull is idempotent, but
 * callers in a per-tick loop should hoist it rather than rebuild per item. */
function pointInRing(point, ringNodes) {
  const ring = ringHull(ringNodes);
  if (ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i];
    const b = ring[j];
    if ((a.y > point.y) === (b.y > point.y)) continue;
    const crossX = a.x + ((point.y - a.y) / (b.y - a.y)) * (b.x - a.x);
    if (point.x < crossX) inside = !inside;
  }
  return inside;
}

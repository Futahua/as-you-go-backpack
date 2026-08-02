/** A set's outline as a ring of nodes in the same simulation.
 *
 * The boundary is not computed geometry. It is a closed chain of small
 * invisible nodes, linked to their neighbours and subject to the same charge
 * and collision as every icon, and what the user sees is a curve drawn through
 * where those nodes ended up.
 *
 * That inversion is the whole design, and it makes free what the previous
 * approach could not achieve at all. Computing an envelope means solving for a
 * shape that is smooth, closed, connected and of even thickness — four
 * properties that fight each other, and that a session of grid sampling,
 * contour extraction and morphological closing never got right at once. A
 * chain of linked nodes has all four by construction: it is continuous because
 * the links hold, smooth because the link distance is even, the same thickness
 * everywhere because it is made of identical nodes, and closed because the
 * chain loops.
 *
 * The behaviours asked for follow from ordinary physics rather than rules:
 *
 * - Push a member into the ring and it dents inward, because the ring nodes
 *   are pushed by the same collision that separates icons.
 * - Pull a member outward and the ring stretches to follow, growing new links
 *   as its perimeter grows — "as big as needed" is literally more nodes.
 * - An outsider cannot get in and a member cannot get out, because the ring
 *   nodes collide with icons like anything else. Containment is a consequence,
 *   not something enforced.
 * - Two sets overlap by their rings crossing, which needs no special case.
 *
 * No DOM, store, or browser APIs. */

/** How many nodes a ring of this perimeter needs at the given link distance.
 *
 * Spacing is what keeps the ring gapless: too few nodes and the links stretch
 * until the boundary reads as a dotted line rather than a body. The count is
 * therefore derived from the perimeter rather than fixed per set. */
export function ringNodeCount(perimeter, linkDistance, { minimum = 8 } = {}) {
  if (!Number.isFinite(perimeter) || perimeter <= 0) return minimum;
  return Math.max(minimum, Math.round(perimeter / linkDistance));
}

/** The circle that encloses these members, plus the padding the ring sits at.
 *
 * A circle rather than a tight hull: the ring is going to be pushed into shape
 * by the members and whatever else is nearby, so this only has to be a starting
 * position loose enough that the ring settles inward rather than having to
 * fight its way out from between the members. */
export function enclosingCircle(members, padding) {
  if (!members || members.length === 0) return null;
  let x = 0;
  let y = 0;
  for (const member of members) {
    x += member.x;
    y += member.y;
  }
  const centre = { x: x / members.length, y: y / members.length };

  let radius = 0;
  for (const member of members) {
    const reach = Math.hypot(member.x - centre.x, member.y - centre.y)
      + Math.hypot(member.width ?? 0, member.height ?? 0) / 2;
    radius = Math.max(radius, reach);
  }
  return { ...centre, radius: radius + padding };
}

/** Positions for a ring of `count` nodes around a circle.
 *
 * Evenly spaced and starting at a fixed angle, so a ring that is rebuilt lands
 * in the same place rather than rotating between renders. */
export function ringPositions(circle, count) {
  const positions = [];
  for (let i = 0; i < count; i += 1) {
    const angle = (2 * Math.PI * i) / count;
    positions.push({
      x: circle.x + Math.cos(angle) * circle.radius,
      y: circle.y + Math.sin(angle) * circle.radius,
    });
  }
  return positions;
}

/** Reconciles a set's ring nodes against what its members now need.
 *
 * Existing nodes keep their positions, so a ring that is already settled does
 * not jump when one node is added — the new one is placed on the circle and the
 * neighbours absorb it. Nodes are added at the end and removed from the end for
 * the same reason: reordering the whole ring would make it snap.
 *
 * Returns the node list and the links closing it into a loop. */
export function reconcileRing({
  setId,
  members,
  existing = [],
  padding = 40,
  // Spacing between neighbouring ring nodes, and so the node count for a given
  // perimeter. It is a cost decision as much as a shape one: every ring node
  // joins the simulation, and 34 gives ~72 nodes on a large ring where 60 gives
  // ~34 for the same outline.
  //
  // The count only has to capture the *shape*. Smoothness comes from drawing a
  // spline through the nodes, which is safe here in a way it was not before —
  // containment is ring nodes colliding, not polygon hit-testing, so the curve
  // is a pure rendering of where the nodes are and cannot disagree with
  // anything. A polygon at this spacing turns about 15 degrees per node; the
  // spline hides that entirely.
  linkDistance = 60,
} = {}) {
  const circle = enclosingCircle(members, padding);
  if (!circle) return { nodes: [], links: [], circle: null };

  const perimeter = 2 * Math.PI * circle.radius;
  const wanted = ringNodeCount(perimeter, linkDistance);

  const nodes = existing.slice(0, wanted);
  if (nodes.length < wanted) {
    // Only the positions for the slots being filled, so existing nodes are not
    // dragged onto the ideal circle every time the count changes.
    const positions = ringPositions(circle, wanted);
    for (let i = nodes.length; i < wanted; i += 1) {
      nodes.push({
        id: `${setId}:ring:${i}`,
        setId,
        ring: true,
        // Its place around the loop, so a node sitting exactly on the centre
        // still has a direction to be pushed out along.
        ringIndex: i,
        x: positions[i].x,
        y: positions[i].y,
        vx: 0,
        vy: 0,
      });
    }
  }

  // Refreshed on every node, not just new ones: the count changes as the ring
  // grows, and a stale one would give a collapsed node the wrong direction out.
  for (const node of nodes) node.ringCount = nodes.length;

  // Closed loop: every node linked to the next, and the last back to the first.
  // The wrap-around link is what makes it a ring rather than a chain with two
  // loose ends, and a chain would let the boundary open up under load.
  const links = nodes.map((node, i) => ({
    source: node.id,
    target: nodes[(i + 1) % nodes.length].id,
  }));

  return { nodes, links, circle };
}

/** A closed smooth path through the ring nodes.
 *
 * Catmull-Rom converted to cubic béziers, which passes exactly through every
 * node rather than being pulled off them the way a B-spline is. The ring is
 * where the physics put it, so the drawing should not move it.
 *
 * Smoothing the *rendering* was rejected on the previous approach, and for a
 * good reason there: the drawn curve would have differed from the polygon that
 * decided clicks and containment, so the user would have been interacting with
 * a shape they could not see. Here nothing is hit-tested against this path.
 * Containment is ring nodes colliding with icons, so the curve is a pure
 * rendering of positions and has no second opinion to disagree with. */
export function ringPath(nodes, { tension = 6 } = {}) {
  const points = nodes.filter((node) => Number.isFinite(node.x) && Number.isFinite(node.y));
  if (points.length < 3) return '';

  const at = (i) => points[(i + points.length) % points.length];
  const round = (value) => Math.round(value * 100) / 100;

  let path = `M ${round(points[0].x)} ${round(points[0].y)}`;
  for (let i = 0; i < points.length; i += 1) {
    const previous = at(i - 1);
    const current = at(i);
    const next = at(i + 1);
    const after = at(i + 2);
    // The control points are the neighbours' offsets scaled down: a sixth of
    // the span is the standard Catmull-Rom to bézier conversion, and larger
    // values bow the curve out past the nodes.
    const c1 = {
      x: current.x + (next.x - previous.x) / tension,
      y: current.y + (next.y - previous.y) / tension,
    };
    const c2 = {
      x: next.x - (after.x - current.x) / tension,
      y: next.y - (after.y - current.y) / tension,
    };
    path += ` C ${round(c1.x)} ${round(c1.y)}, ${round(c2.x)} ${round(c2.y)}, ${round(next.x)} ${round(next.y)}`;
  }
  return `${path} Z`;
}

/** A force pulling each ring node towards its own set's members.
 *
 * Without it the ring is only held by its links and would drift off the set it
 * belongs to, or be pushed away entirely by the charge of the members it is
 * supposed to surround. The pull is towards the enclosing circle rather than
 * the centre, so the ring settles *around* the members instead of collapsing
 * onto them.
 *
 * Members are not pulled by this at all. The ring finds the members; the
 * members are never rearranged to suit the ring — that was the mistake the
 * membrane approach made, and it is what made dragging feel like a negotiation.
 */
export function forceRingShape({ membersOf, padding = 40, strength = 0.35 } = {}) {
  let nodes = [];

  function force(alpha) {
    const circles = new Map();
    for (const node of nodes) {
      if (!node.ring) continue;
      if (!circles.has(node.setId)) {
        circles.set(node.setId, enclosingCircle(membersOf(node.setId) ?? [], padding));
      }
      const circle = circles.get(node.setId);
      if (!circle) continue;

      const dx = node.x - circle.x;
      const dy = node.y - circle.y;
      const distance = Math.hypot(dx, dy);
      // A node exactly on the centre has no direction to be pushed along, and
      // scaling a zero vector leaves it stuck there forever. Its index around
      // the ring gives it one — deterministic, so a ring that starts collapsed
      // opens out the same way every time rather than depending on which node
      // drifted first.
      let ux;
      let uy;
      if (distance > 1e-6) {
        ux = dx / distance;
        uy = dy / distance;
      } else {
        const angle = (2 * Math.PI * (node.ringIndex ?? 0)) / Math.max(1, node.ringCount ?? 1);
        ux = Math.cos(angle);
        uy = Math.sin(angle);
      }
      // Towards the circle's rim: outward when the node has fallen inside,
      // inward when it has been pushed too far out.
      const correction = (circle.radius - distance) * strength * alpha;
      node.vx += ux * correction;
      node.vy += uy * correction;
    }
  }

  force.initialize = (value) => { nodes = value ?? []; };
  return force;
}

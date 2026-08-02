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

/** The ellipse that encloses these members, oriented along how they are spread.
 *
 * A circle has one radius and so no way to express direction: dragging two
 * members apart along one axis inflates the boundary on both. Measured, two
 * 72px tiles 800px apart gave a ring 982px tall, when it should have stayed
 * about 112 — the set ballooned across the drag instead of stretching along it.
 *
 * The orientation comes from the members' own covariance, so the long axis is
 * whichever way they actually lie rather than a fixed one. A single member, or
 * several stacked in a perfect line, degenerates to a circle, which is right:
 * there is no spread to point along. */
export function enclosingEllipse(members, padding) {
  if (!members || members.length === 0) return null;
  const count = members.length;
  let cx = 0;
  let cy = 0;
  for (const member of members) { cx += member.x; cy += member.y; }
  cx /= count;
  cy /= count;

  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const member of members) {
    const dx = member.x - cx;
    const dy = member.y - cy;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  sxx /= count;
  syy /= count;
  sxy /= count;

  // Eigenvalues of the 2x2 covariance give the spread along each principal
  // axis; the eigenvector angle gives which way those axes point.
  const mean = (sxx + syy) / 2;
  const delta = Math.sqrt(Math.max(0, ((sxx - syy) / 2) ** 2 + (sxy * sxy)));
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);

  // Every member must fit, so the tile's own half-diagonal is added to each
  // axis rather than assuming the centres are the extent.
  let half = 0;
  for (const member of members) {
    half = Math.max(half, Math.hypot(member.width ?? 0, member.height ?? 0) / 2);
  }
  return {
    x: cx,
    y: cy,
    a: Math.sqrt(mean + delta) + half + padding,
    b: Math.sqrt(Math.max(0, mean - delta)) + half + padding,
    angle,
  };
}

/** Ellipse perimeter, by Ramanujan's approximation.
 *
 * There is no closed form, and the error here is under 1e-5 for any shape a
 * set will take — far below the precision the node count needs. */
export function ellipsePerimeter(ellipse) {
  if (!ellipse) return 0;
  const { a, b } = ellipse;
  const h = ((a - b) ** 2) / ((a + b) ** 2);
  return Math.PI * (a + b) * (1 + ((3 * h) / (10 + Math.sqrt(4 - (3 * h)))));
}

/** A point on the ellipse at the given parameter angle, in world space. */
export function ellipsePoint(ellipse, t) {
  const cos = Math.cos(ellipse.angle);
  const sin = Math.sin(ellipse.angle);
  const ex = Math.cos(t) * ellipse.a;
  const ey = Math.sin(t) * ellipse.b;
  return {
    x: ellipse.x + (ex * cos) - (ey * sin),
    y: ellipse.y + (ex * sin) + (ey * cos),
  };
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

  // Sized from the ellipse the shape force actually pulls onto, not from the
  // circle. Sizing from the circle over-counts badly as a set is stretched —
  // two members 600px apart gave 41 nodes for a boundary needing 28 — and the
  // surplus has nowhere to go but to bunch, which is what made the outline
  // spiky and the set convulse.
  const ellipse = enclosingEllipse(members, padding);
  const wanted = ringNodeCount(ellipsePerimeter(ellipse), linkDistance);

  const nodes = existing.slice(0, wanted);
  if (nodes.length < wanted) {
    // Only the positions for the slots being filled, so existing nodes are not
    // dragged onto the ideal boundary every time the count changes. Seeded on
    // the ellipse, so a new node lands where the shape force is going to hold
    // it rather than being pulled across the set on its first tick.
    const positions = Array.from({ length: wanted }, (unused, i) => (
      ellipsePoint(ellipse, (2 * Math.PI * i) / wanted)));
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
export function forceRingShape({
  membersOf,
  padding = 40,
  strength = 0.35,
  // The pull never drops below this however cool the simulation gets.
  //
  // d3 decays alpha towards zero, so a shape force scaled by alpha alone fades
  // out exactly when the graph settles — and a dragged member then walks away
  // from a ring that has stopped chasing it. Measured on a realistic drag (many
  // small steps at reheat 0.12, which is what pointer-controller does), the
  // ring finished 205px behind its member and shrank from 183 wide to 120.
  minAlpha = 0.25,
} = {}) {
  let nodes = [];

  function force(alpha) {
    const shapes = new Map();
    for (const node of nodes) {
      if (!node.ring) continue;
      if (!shapes.has(node.setId)) {
        shapes.set(node.setId, enclosingEllipse(membersOf(node.setId) ?? [], padding));
      }
      const shape = shapes.get(node.setId);
      if (!shape) continue;

      // Towards this node's own slot on the rim, as a point.
      //
      // The version this replaces applied (radius - distance) along the node's
      // own outward unit vector. That can only move a node in or out along the
      // line it already sits on, never around the circle, so when the members
      // move the ring can only resize in place — it cannot redistribute to
      // follow. Aiming at an absolute point gives the correction a tangential
      // component, which is what lets the ring travel.
      //
      // The slot angle also gives a node sitting exactly on the centre a
      // direction to open out along, which a zero-length radial vector cannot.
      //
      // Measured together with the alpha floor below, on the drag pattern
      // pointer-controller actually performs: 42px behind the member, keeping
      // its size, against 205px and a collapse from 197px wide to 122 for the
      // original. The two changes were not separable in testing — removing the
      // floor alone reddens three tests, and the exact split of credit between
      // them is NOT established.
      const angle = (2 * Math.PI * (node.ringIndex ?? 0)) / Math.max(1, node.ringCount ?? 1);
      const target = ellipsePoint(shape, angle);
      const pull = strength * Math.max(alpha, minAlpha);
      node.vx += (target.x - node.x) * pull;
      node.vy += (target.y - node.y) * pull;
    }
  }

  force.initialize = (value) => { nodes = value ?? []; };
  return force;
}

/** Where a trespassing item should be put down, just outside the boundary.
 *
 * The ring cannot win an argument with a drag. A dragged node has its position
 * set outright rather than nudged, so collision has nothing to push back
 * against — making the boundary stiff enough to resist one only made the whole
 * set convulse, and foreign items still ended up inside.
 *
 * So this does not fight the drag at all. The item goes wherever it is put, and
 * once the gesture is over anything sitting inside a set it does not belong to
 * is moved out along the shortest path. What the user sees while dragging is
 * free; what they see when they let go is correct.
 *
 * Returns null when the item is already outside, so callers can leave settled
 * layouts alone rather than nudging everything every tick.
 */
export function ejectionTarget(point, ringNodes, { clearance = 24 } = {}) {
  const ring = [...ringNodes]
    .filter((node) => Number.isFinite(node.x) && Number.isFinite(node.y))
    .sort((a, b) => a.ringIndex - b.ringIndex);
  if (ring.length < 3) return null;
  if (!pointInsideRing(point, ring)) return null;

  // The nearest point on the boundary itself, not on the line to some centre:
  // a set with an elongated or dented outline has no centre worth pushing away
  // from, and the shortest way out of a long thin shape is sideways.
  let best = null;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const closest = closestPointOnSegment(point, ring[j], ring[i]);
    const distance = Math.hypot(point.x - closest.x, point.y - closest.y);
    if (!best || distance < best.distance) best = { ...closest, distance };
  }
  if (!best) return null;

  // Push past the edge rather than onto it, so the item lands clear of the
  // outline instead of resting on it where the next tick might take it back in.
  const dx = best.x - point.x;
  const dy = best.y - point.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return { x: best.x + clearance, y: best.y };
  return {
    x: best.x + (dx / length) * clearance,
    y: best.y + (dy / length) * clearance,
  };
}

function closestPointOnSegment(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = (dx * dx) + (dy * dy);
  if (lengthSquared === 0) return { x: a.x, y: a.y };
  let t = (((point.x - a.x) * dx) + ((point.y - a.y) * dy)) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + (t * dx), y: a.y + (t * dy) };
}

/** Ray casting in ringIndex order — the node array is only a polygon when it is
 * walked around the loop. */
export function pointInsideRing(point, ringNodes) {
  const ring = [...ringNodes].sort((a, b) => a.ringIndex - b.ringIndex);
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

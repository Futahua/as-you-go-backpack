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

  let half = 0;
  for (const member of members) {
    half = Math.max(half, Math.hypot(member.width ?? 0, member.height ?? 0) / 2);
  }

  // Covariance gives the *typical* spread, not the extent — it is a standard
  // deviation, so members further out than average fall outside the ellipse it
  // describes. Measured on a seven-member set after a folder was expanded, one
  // member sat at 1.09 in ellipse units and another at 0.99: outside its own
  // set's boundary, permanently, which is exactly what was seen on screen.
  //
  // So the axes are grown until every member is genuinely inside. The
  // covariance still decides the orientation and the ratio between the axes —
  // that is what makes the boundary stretch along the members rather than
  // ballooning — and this only fixes the scale.
  let a = Math.sqrt(mean + delta) + half + padding;
  let b = Math.sqrt(Math.max(0, mean - delta)) + half + padding;
  // Grown per axis, not uniformly. Scaling both by the worst overshoot makes a
  // set that only needed to reach further along one axis inflate all round —
  // two members 140px apart came out 455x257 — and a boundary bigger than its
  // contents is what lets bystanders sit inside it.
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  let needA = 0;
  let needB = 0;
  for (const member of members) {
    const dx = member.x - cx;
    const dy = member.y - cy;
    // Into the ellipse's own frame. The tile's half-diagonal is included so the
    // whole icon is enclosed rather than its centre.
    const localX = (dx * cos) - (dy * sin);
    const localY = (dx * sin) + (dy * cos);
    needA = Math.max(needA, Math.abs(localX) + half + padding);
    needB = Math.max(needB, Math.abs(localY) + half + padding);
  }
  a = Math.max(a, needA);
  b = Math.max(b, needB);

  return { x: cx, y: cy, a, b, angle };
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

/** The convex hull of the ring nodes, counter-clockwise, by monotone chain.
 *
 * This exists because angular order around the loop is not preserved by
 * anything. RING-TANGLE.md measured it on branch 3: after a drag, neighbouring
 * ring nodes sat 317 degrees apart, five backward jumps around a ten-node ring.
 * The links hold neighbours ~60px apart and the shape force holds them ~91px
 * from the centre, and a tangled ring satisfies both constraints exactly as
 * well as an untangled one — so nothing in the physics objects, and the fault
 * only appears when the chain is drawn.
 *
 * A hull cannot self-intersect by construction rather than by tuning, so the
 * spline through it is always a simple closed curve however badly the chain
 * beneath it has knotted. That is the invariant, and it is held at the
 * rendering layer without touching a single force.
 *
 * The order it returns is its own, not ringIndex: the hull is a shape derived
 * from where the nodes are, and the chain's idea of its own sequence is exactly
 * the thing that cannot be trusted here.
 *
 * The cost is real and was measured before choosing this: a hull is convex, so
 * a set whose members fall into two distant clusters is drawn as one blob, and
 * a foreign item at the midpoint reads as inside. Two clusters 600px apart do
 * this. That is a known trade of a tear for a bulge, and if it shows on screen
 * the answer is a hull per cluster rather than abandoning the hull. */
export function ringHull(nodes) {
  const points = (nodes ?? [])
    .filter((node) => Number.isFinite(node.x) && Number.isFinite(node.y))
    .map((node) => ({ x: node.x, y: node.y }))
    .sort((a, b) => (a.x - b.x) || (a.y - b.y));
  if (points.length < 3) return points;

  // Duplicate positions would put a zero-length edge on the hull, which makes
  // the cross product below zero and the winding undecidable.
  const unique = points.filter((point, i) => (
    i === 0 || point.x !== points[i - 1].x || point.y !== points[i - 1].y));
  if (unique.length < 3) return unique;

  const cross = (o, a, b) => ((a.x - o.x) * (b.y - o.y)) - ((a.y - o.y) * (b.x - o.x));

  // Monotone chain: sweep left to right for the lower boundary, then right to
  // left for the upper, and the two joined nose to tail close the loop. Each
  // half keeps only left turns, so a point that would make the boundary bend
  // back on itself is popped — that is why the result cannot self-intersect.
  //
  // `>= 0` pops collinear points as well as reflex ones. Keeping them would put
  // redundant nodes along a straight edge, and the spline would bow through
  // them rather than running flat.
  const build = (sequence) => {
    const half = [];
    for (const point of sequence) {
      while (half.length >= 2 && cross(half[half.length - 2], half[half.length - 1], point) >= 0) {
        half.pop();
      }
      half.push(point);
    }
    // The last point of each half is the first of the other, so it is dropped
    // here rather than appearing twice in the closed loop.
    half.pop();
    return half;
  };

  return [...build(unique), ...build([...unique].reverse())];
}

/** A hull resampled to a fixed number of points, evenly along its perimeter.
 *
 * The hull's point count changes as the physics moves — 8 points one frame, 14
 * the next — and two outlines with different counts cannot be interpolated
 * between, because there is no correspondence between their points. Resampling
 * both to the same count gives every drawn outline the same shape of data, so
 * one can be eased towards another.
 *
 * Walking by arc length rather than by vertex keeps the samples spread evenly
 * around the outline instead of bunching wherever the hull happened to have
 * corners, which is what stops the eased shape from swimming as corners appear
 * and disappear. */
export function resampleHull(hull, count = 48) {
  if (!hull || hull.length < 3) return null;

  const spans = [];
  let perimeter = 0;
  for (let i = 0; i < hull.length; i += 1) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    spans.push(length);
    perimeter += length;
  }
  if (perimeter < 1e-6) return null;

  const points = [];
  const step = perimeter / count;
  let edge = 0;
  let walked = 0;
  for (let i = 0; i < count; i += 1) {
    const distance = i * step;
    while (edge < spans.length - 1 && walked + spans[edge] < distance) {
      walked += spans[edge];
      edge += 1;
    }
    const a = hull[edge];
    const b = hull[(edge + 1) % hull.length];
    const t = spans[edge] < 1e-6 ? 0 : (distance - walked) / spans[edge];
    points.push({ x: a.x + ((b.x - a.x) * t), y: a.y + ((b.y - a.y) * t) });
  }
  return points;
}

/** Eases a drawn outline towards the shape the physics currently implies.
 *
 * The hull guarantees the outline is simple; it says nothing about it being
 * steady. Each frame recomputes the hull from scratch, so a ring that collapses
 * inward, loses nodes, or briefly degenerates makes the drawn shape shrink or
 * blink out between one frame and the next — which reads as the set popping
 * even though nothing about the membership changed.
 *
 * So the drawn outline is a state of its own, chased towards the target rather
 * than replaced by it. `previous` is what was drawn last frame; the return
 * value is what to draw now, and to pass back next frame.
 *
 * `rate` is per frame at 60fps. Low enough that a collapse becomes a settle
 * rather than a snap, high enough that the outline still keeps up with a
 * dragged member — the ring already lags by design, and stacking a slow ease on
 * top of that would read as the outline being detached from its set.
 *
 * A null target means the physics has nothing to draw this frame — a
 * degenerate ring, or members gone off screen. The previous shape is returned
 * unchanged rather than blanked, so the outline holds its last good form
 * instead of vanishing; the caller decides when a set is really gone. */
export function easeOutline(previous, target, { rate = 0.25 } = {}) {
  if (!target) return previous ?? null;
  if (!previous || previous.length !== target.length) return target;

  const eased = [];
  for (let i = 0; i < target.length; i += 1) {
    eased.push({
      x: previous[i].x + ((target[i].x - previous[i].x) * rate),
      y: previous[i].y + ((target[i].y - previous[i].y) * rate),
    });
  }
  return eased;
}

/** The area a closed outline encloses, by the shoelace formula. */
export function outlineArea(points) {
  if (!points || points.length < 3) return 0;
  let total = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    total += (points[j].x * points[i].y) - (points[i].x * points[j].y);
  }
  return Math.abs(total) / 2;
}

/** The hull of the members' own tiles — the smallest an outline may ever be.
 *
 * Every corner of every member tile, hulled. A set's outline is a statement
 * about which items are in it, so it can never be smaller than the items
 * themselves: shrinking past them would draw a boundary that visibly excludes
 * its own members, which is a false statement about the set rather than merely
 * an ugly one.
 *
 * Corners rather than centres, because a tile is a rectangle and an outline
 * that passed through the centres would cut every icon in half. */
export function memberFloorHull(members, padding = 0) {
  const corners = [];
  for (const member of members ?? []) {
    if (!Number.isFinite(member.x) || !Number.isFinite(member.y)) continue;
    const halfWidth = ((member.width ?? 0) / 2) + padding;
    const halfHeight = ((member.height ?? 0) / 2) + padding;
    corners.push(
      { x: member.x - halfWidth, y: member.y - halfHeight },
      { x: member.x + halfWidth, y: member.y - halfHeight },
      { x: member.x + halfWidth, y: member.y + halfHeight },
      { x: member.x - halfWidth, y: member.y + halfHeight },
    );
  }
  if (corners.length < 3) return null;
  const hull = ringHull(corners);
  return hull.length >= 3 ? hull : null;
}

/** Holds an outline out to at least the shape its own members occupy.
 *
 * A set whose members pile together has a ring with almost no area, and a hull
 * of near-coincident points draws as a sliver or nothing at all. That is the
 * collapse: the set still exists and still has members, but its outline has no
 * room to be seen.
 *
 * The floor is the members' own hull rather than a fixed area, because what the
 * outline must never do is dip inside the items it is drawn around — an outline
 * smaller than its members states something false about the set, not merely
 * something ugly. A constant cannot express that: too large for one small item,
 * too small for ten big ones.
 *
 * The union of the two point sets, hulled. Radial projection was tried first
 * and is wrong: it can only push a sample that already exists along a given
 * direction, so a collapsed outline whose samples span 124 degrees leaves the
 * rest of the circle with nothing to push, and the result stays thin — measured
 * at 6441 against a floor of 32224. A hull over both sets has no such gap,
 * because the floor's own corners are in the input.
 *
 * Both operands are convex, so their union's hull is exactly the smaller of the
 * two shapes' envelope: an outline already clear of the floor is returned
 * unchanged, and one that has fallen inside is lifted to the floor only where
 * it had. */
export function floorOutline(points, floor) {
  if (!points || points.length < 3) return points;
  if (!floor || floor.length < 3) return points;

  const combined = ringHull([...points, ...floor]);
  if (combined.length < 3) return points;
  // Resampled back to the incoming count so the frame-to-frame easing still has
  // point-for-point correspondence between one outline and the next.
  return resampleHull(combined, points.length) ?? points;
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
export function ringPath(nodes, { tension = 6, hulled = false } = {}) {
  // Through the hull, not the chain. A spline follows whatever order it is
  // given, so drawing the raw chain after it has reordered is what rendered as
  // the lens and the angular spikes; the hull has no order to lose.
  //
  // `hulled` is for callers that have already prepared the outline — resampled
  // and eased across frames — where re-hulling would be wasted work and would
  // also undo the even spacing that the easing depends on.
  const points = hulled ? (nodes ?? []) : ringHull(nodes);
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
  // The hull's edges, so the item is put down outside the curve the user can
  // see. Walking the chain here would measure the shortest way out of a shape
  // that is not being drawn, and on a tangled ring that lands the item visibly
  // inside the outline it was supposed to be ejected from.
  const ring = ringHull(ringNodes);
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

/** Ray casting against the hull — the same shape that is drawn.
 *
 * This used to walk the chain in ringIndex order, which is a polygon only while
 * the loop has not reordered itself. RING-TANGLE.md measured that it does
 * reorder, and a ray cast over a crossed loop reports points plainly inside the
 * outline as outside, silently.
 *
 * Reading the hull instead is not just more robust, it is required for
 * correctness of a different kind: the user clicks and drops against the curve
 * they can see. If containment kept using the chain while the drawing used the
 * hull, the two would disagree — which is precisely the fault that retired the
 * geometry branch, where the drawn shape and the hit-tested shape were not the
 * same thing. One shape, read by everyone. */
export function pointInsideRing(point, ringNodes) {
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

/** Caps how far any node may travel in a single tick.
 *
 * Registered after the other forces so it sees their combined effect: it is a
 * governor on the result, not another opinion about where things should go.
 *
 * Dragging several foreign items through a set at once is what needs it. Each
 * one pushes the members, the members drag the ring after them, and with four
 * in flight the feedback compounds — measured, the ring went from moving 0.3px
 * per tick when settled to 17.5px on average and 164px in a single tick, which
 * is the violent convulsing seen on screen. Nothing there is wrong
 * individually; it is the sum that explodes.
 *
 * A cap is the honest fix rather than weakening any one force, because the
 * problem is the total. 8px per tick is roughly half a tile at 60fps: fast
 * enough that the boundary still keeps up with a dragged member — measured,
 * members are flung 70px from home against 455 uncapped — and slow enough that
 * nothing can cross the screen in a frame.
 */
export function forceSpeedLimit({ maxPerTick = 8 } = {}) {
  let nodes = [];

  function force() {
    for (const node of nodes) {
      const speed = Math.hypot(node.vx ?? 0, node.vy ?? 0);
      if (speed <= maxPerTick) continue;
      const scale = maxPerTick / speed;
      node.vx *= scale;
      node.vy *= scale;
    }
  }

  force.initialize = (value) => { nodes = value ?? []; };
  return force;
}

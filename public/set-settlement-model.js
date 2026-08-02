/** Settling a layout around where the user dropped something.
 *
 * The membrane used to be a wall: a drag was clamped at the boundary and a
 * disallowed drop was put back. That had the authority the wrong way round. A
 * set has no claim over the thing the user is holding — the envelope follows
 * its members, not the reverse — and refusing a drop tells someone their
 * intent was wrong rather than acting on it.
 *
 * So nothing is refused here. The dropped items are anchors, fixed exactly
 * where they were left, and the invariants are restored by moving everything
 * else until they hold:
 *
 * - a member sits inside every set it belongs to;
 * - a setless or foreign item sits outside every set it does not;
 * - two sets sharing no member stay apart.
 *
 * The method is position-based: propose a correction per violated constraint,
 * apply them together, repeat. No forces, no velocity, no integration — a
 * constraint that is satisfied contributes nothing, so the pass converges
 * instead of oscillating, and it stops as soon as the layout is legal. That
 * matters because this runs once per completed interaction rather than per
 * frame, and it must not leave the scene jittering afterwards.
 *
 * Sets are represented here by their members, not by their rendered outline.
 * Settling against the old outline would be settling against geometry that is
 * about to be rebuilt around the very positions being computed.
 *
 * No DOM, store, or browser APIs. */

/** Distance from a point to a rectangle's edge; 0 inside it. */
function pointRectDistance(point, rect) {
  const halfWidth = (rect.width ?? 0) / 2;
  const halfHeight = (rect.height ?? 0) / 2;
  const dx = Math.max(0, Math.abs(point.x - rect.x) - halfWidth);
  const dy = Math.max(0, Math.abs(point.y - rect.y) - halfHeight);
  return Math.hypot(dx, dy);
}

/** The gap between two item rectangles, negative when they overlap. */
function rectGap(a, b) {
  const dx = Math.abs(a.x - b.x) - ((a.width ?? 0) + (b.width ?? 0)) / 2;
  const dy = Math.abs(a.y - b.y) - ((a.height ?? 0) + (b.height ?? 0)) / 2;
  // Both negative means the rectangles overlap on both axes. The larger of the
  // two is the shallower penetration, and therefore the cheaper way out.
  if (dx < 0 && dy < 0) return Math.max(dx, dy);
  return Math.hypot(Math.max(0, dx), Math.max(0, dy));
}

/** A unit vector from `a` towards `b`, with a deterministic fallback.
 *
 * Two items at exactly the same point have no direction between them, which
 * happens more than it sounds — a fresh node starts at its parent's position.
 * Deriving the fallback from the ids keeps the result reproducible instead of
 * depending on iteration order. */
function separationDirection(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length > 1e-6) return { x: dx / length, y: dy / length };
  let hash = 0;
  const key = `${a.id}:${b.id}`;
  for (let i = 0; i < key.length; i += 1) hash = ((hash * 31) + key.charCodeAt(i)) | 0;
  const angle = (Math.abs(hash) % 360) * (Math.PI / 180);
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

/** Settles a layout so every membership rule holds, without moving the anchors.
 *
 * `items` are `{ id, x, y, width, height }`. `setsOf(itemId)` returns the set
 * ids an item belongs to. `anchorIds` are the items the user just placed, which
 * never move.
 *
 * Returns the settled positions and whether every constraint was satisfied
 * within the iteration budget. A caller that sees `settled: false` still gets
 * the best arrangement found — an imperfect layout is better than a refused
 * interaction — but knows the result is worth a further pass.
 */
export function settleLayout({
  items,
  setsOf,
  anchorIds = [],
  padding = 26,
  gap = 14,
  iterations = 60,
  stiffness = 0.5,
} = {}) {
  const anchors = new Set(anchorIds);
  const working = (items ?? []).map((item) => ({ ...item }));
  const byId = new Map(working.map((item) => [item.id, item]));
  const membership = new Map(working.map((item) => [item.id, new Set(setsOf?.(item.id) ?? [])]));

  // Which items each set covers, resolved once.
  const members = new Map();
  for (const item of working) {
    for (const setId of membership.get(item.id)) {
      if (!members.has(setId)) members.set(setId, []);
      members.get(setId).push(item);
    }
  }

  // Two sets are exclusive when they share no member. Only those must be kept
  // apart — sets that share one are meant to overlap, and that overlap is the
  // Venn the feature exists to show.
  const setIds = [...members.keys()];
  const exclusive = new Map(setIds.map((id) => [id, new Set()]));
  for (let i = 0; i < setIds.length; i += 1) {
    for (let j = i + 1; j < setIds.length; j += 1) {
      const a = members.get(setIds[i]);
      const b = members.get(setIds[j]);
      const shares = a.some((item) => membership.get(item.id).has(setIds[j]));
      if (shares) continue;
      exclusive.get(setIds[i]).add(setIds[j]);
      exclusive.get(setIds[j]).add(setIds[i]);
    }
  }

  let settled = false;
  for (let pass = 0; pass < iterations; pass += 1) {
    // Corrections are accumulated and applied together rather than one at a
    // time. Applying them immediately makes the result depend on iteration
    // order, so the same layout could settle differently between runs.
    const corrections = new Map(working.map((item) => [item.id, { x: 0, y: 0, count: 0 }]));
    let violations = 0;

    const push = (item, dx, dy) => {
      if (anchors.has(item.id)) return;
      const correction = corrections.get(item.id);
      correction.x += dx;
      correction.y += dy;
      correction.count += 1;
    };

    // 1. Icons do not overlap each other.
    for (let i = 0; i < working.length; i += 1) {
      for (let j = i + 1; j < working.length; j += 1) {
        const a = working[i];
        const b = working[j];
        const separation = rectGap(a, b);
        if (separation >= 0) continue;
        violations += 1;
        const direction = separationDirection(a, b);
        const move = (-separation) / 2;
        push(a, -direction.x * move, -direction.y * move);
        push(b, direction.x * move, direction.y * move);
      }
    }

    // 2. An item that belongs to no set stays clear of every set's members, so
    //    the body built around them does not close over it. Clearance is the
    //    padding the membrane will claim plus the separation gap.
    const clearance = padding + gap;
    for (const item of working) {
      const own = membership.get(item.id);
      for (const [setId, setMembers] of members) {
        if (own.has(setId)) continue;
        for (const member of setMembers) {
          const distance = pointRectDistance(item, member);
          const needed = clearance + Math.max(item.width ?? 0, item.height ?? 0) / 2;
          if (distance >= needed) continue;
          violations += 1;
          // The outsider yields, and so does the member — which is what makes
          // a drop into the middle of a set open real space rather than carve
          // a cavity. If the outsider is the anchor, only the member moves.
          const direction = separationDirection(member, item);
          const move = (needed - distance) / 2;
          push(item, direction.x * move, direction.y * move);
          push(member, -direction.x * move, -direction.y * move);
        }
      }
    }

    // 3. Two sets that share no member stay apart, measured between their
    //    members since the bodies are built around those.
    for (const [setId, others] of exclusive) {
      for (const otherId of others) {
        if (otherId < setId) continue;
        for (const a of members.get(setId)) {
          for (const b of members.get(otherId)) {
            const distance = pointRectDistance(a, b);
            const needed = (padding * 2) + gap;
            if (distance >= needed) continue;
            violations += 1;
            const direction = separationDirection(a, b);
            const move = (needed - distance) / 2;
            push(a, -direction.x * move, -direction.y * move);
            push(b, direction.x * move, direction.y * move);
          }
        }
      }
    }

    if (violations === 0) { settled = true; break; }

    for (const item of working) {
      const correction = corrections.get(item.id);
      if (correction.count === 0) continue;
      // Averaged, then relaxed. Applying the full sum would overshoot whenever
      // an item is caught between several constraints and set it oscillating
      // between them.
      item.x += (correction.x / correction.count) * stiffness;
      item.y += (correction.y / correction.count) * stiffness;
    }
  }

  return {
    settled,
    positions: new Map(working.map((item) => [item.id, { x: item.x, y: item.y }])),
    anchorIds: [...anchors],
    moved: working
      .filter((item) => {
        const original = (items ?? []).find((entry) => entry.id === item.id);
        return original && (Math.abs(original.x - item.x) > 0.01 || Math.abs(original.y - item.y) > 0.01);
      })
      .map((item) => item.id),
  };
}

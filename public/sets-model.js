/** Pure data for item sets: named groupings over workspace items.
 *
 * A set is a record with an id, a title, and a member id list. An item may
 * belong to several sets (they overlap, forming a Venn) or to none. Sets are
 * independent of folder location — moving an item between folders never
 * changes what it belongs to.
 *
 * Sets have no stored position or size. Their outline is derived from where
 * their members happen to be, so nothing can desync: a member that moves
 * simply reshapes its own set. Spatially, a non-member may not be dropped
 * inside a set's region, and an item belonging to several sets lives in their
 * intersection — it cannot sit in the part of one set the others do not
 * cover, which is what keeps a Venn overlap meaningful.
 *
 * Sets are deliberately flat: a member id always refers to a workspace item,
 * never to another set, so there is no nesting to traverse and no cycle to
 * guard against. Overlap is how sets relate to each other — not containment.
 *
 * No DOM, host, store, or browser events. */

let setSequence = 0;

function createId() {
  setSequence += 1;
  return `set-${Date.now().toString(36)}-${setSequence.toString(36)}`;
}

/** Creates a set over the given member ids, discarding duplicates and
 * preserving first-seen order. */
export function createItemSet(memberIds, overrides = {}) {
  return {
    id: typeof overrides.id === 'string' && overrides.id ? overrides.id : createId(),
    type: 'set',
    title: typeof overrides.title === 'string' ? overrides.title : 'New set',
    memberIds: uniqueIds(memberIds),
  };
}

function uniqueIds(ids) {
  const seen = new Set();
  const out = [];
  for (const id of Array.isArray(ids) ? ids : []) {
    if (typeof id !== 'string' || !id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Normalizes persisted sets, dropping malformed records and duplicate ids.
 * Members that no longer exist are pruned when `knownItemIds` is supplied, so
 * a deleted item never lingers in a set. */
export function normalizeItemSets(raw, knownItemIds = null) {
  const known = knownItemIds ? new Set(knownItemIds) : null;
  const setIds = new Set(
    (Array.isArray(raw) ? raw : [])
      .map((record) => (record && typeof record === 'object' ? record.id : null))
      .filter((id) => typeof id === 'string' && id),
  );
  const seen = new Set();
  const sets = [];
  for (const record of Array.isArray(raw) ? raw : []) {
    if (!record || typeof record !== 'object') continue;
    const id = typeof record.id === 'string' && record.id ? record.id : null;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const memberIds = uniqueIds(record.memberIds)
      // Sets are flat: a member naming another set is malformed data, not a
      // nested set, so it is dropped rather than traversed.
      .filter((memberId) => !setIds.has(memberId))
      .filter((memberId) => (known ? known.has(memberId) : true));
    sets.push({
      id,
      type: 'set',
      title: typeof record.title === 'string' ? record.title : 'New set',
      memberIds,
    });
  }
  return sets;
}

/** Every set the item belongs to, in stored order. */
export function setsContaining(sets, itemId) {
  return (Array.isArray(sets) ? sets : []).filter((set) => set.memberIds.includes(itemId));
}

/** True when the item belongs to no set at all. */
export function isSetless(sets, itemId) {
  return setsContaining(sets, itemId).length === 0;
}

/** The set a gesture currently acts on, derived from the last clicked item
 * rather than stored separately, so it can never disagree with the view. An
 * item in several sets picks the first it belongs to; a setless item (or no
 * item at all) yields null, meaning "no set is picked". */
export function pickedSetId(sets, lastClickedItemId) {
  if (!lastClickedItemId) return null;
  return setsContaining(sets, lastClickedItemId)[0]?.id ?? null;
}

/** The ids Ctrl+A should select: the picked set's members when a set is
 * picked, otherwise every candidate that belongs to no set.
 *
 * Restricting the setless case to setless items is what makes sets feel like
 * containers — Ctrl+A outside a set never reaches inside one. `candidateIds`
 * is the visible universe, so the result never includes something off screen.
 */
export function selectAllScope(sets, candidateIds, lastClickedItemId) {
  const candidates = Array.isArray(candidateIds) ? candidateIds : [];
  const setId = pickedSetId(sets, lastClickedItemId);
  if (setId == null) {
    return candidates.filter((id) => isSetless(sets, id));
  }
  const members = new Set(findItemSet(sets, setId)?.memberIds ?? []);
  return candidates.filter((id) => members.has(id));
}

/** The complement of the current selection within the select-all scope: what
 * Alt+click acts on. Selecting everything, deselecting a few, then acting is
 * the workflow this collapses into one gesture. */
export function inverseScope(sets, candidateIds, lastClickedItemId, selectedIds) {
  const selected = new Set(Array.isArray(selectedIds) ? selectedIds : []);
  return selectAllScope(sets, candidateIds, lastClickedItemId)
    .filter((id) => !selected.has(id));
}

export function findItemSet(sets, setId) {
  return (Array.isArray(sets) ? sets : []).find((set) => set.id === setId) ?? null;
}

/** Adds a set over the given members. Returns the same array when there is
 * nothing to group, so callers can skip recording history. */
export function addItemSet(sets, memberIds, overrides = {}) {
  const members = uniqueIds(memberIds);
  if (members.length === 0) return sets;
  return [...sets, createItemSet(members, overrides)];
}

export function removeItemSet(sets, setId) {
  const next = sets.filter((set) => set.id !== setId);
  return next.length === sets.length ? sets : next;
}

/** Replaces which sets the given items belong to. An empty `setIds` removes
 * them from every set, which is how an item is returned to setless. This is
 * the one membership-editing path (Ctrl+G); dragging never changes it.
 *
 * Sets left with no members are dropped, since an empty outline has nothing
 * to enclose. */
export function setMembership(sets, itemIds, setIds) {
  const items = uniqueIds(itemIds);
  if (items.length === 0) return sets;
  const target = new Set(Array.isArray(setIds) ? setIds : []);
  const itemSet = new Set(items);
  let changed = false;
  const next = [];
  for (const set of sets) {
    const shouldContain = target.has(set.id);
    const without = set.memberIds.filter((id) => !itemSet.has(id));
    const memberIds = shouldContain ? [...without, ...items] : without;
    if (memberIds.length !== set.memberIds.length
      || memberIds.some((id, index) => id !== set.memberIds[index])) {
      changed = true;
    }
    if (memberIds.length === 0) {
      changed = true;
      continue;
    }
    next.push({ ...set, memberIds });
  }
  return changed ? next : sets;
}

/** Drops an item from every set it belongs to — used when the item itself is
 * deleted, so no set keeps a dangling member. */
export function forgetItems(sets, itemIds) {
  return setMembership(sets, itemIds, []);
}

/** Whether `itemId` may be dropped at a position covered by `regionSetIds`.
 *
 * Two rules, and a shared item must satisfy both:
 *
 * - a non-member may not enter a region it does not belong to, so every
 *   region present must be one of the item's own sets;
 * - an item in several sets lives in their intersection, so every set it
 *   belongs to must be present at the destination. A shared item therefore
 *   cannot sit in the part of one set that the other does not cover.
 *
 * Setless items are unconstrained outside sets and blocked inside any. */
export function canDropInsideRegions(sets, itemId, regionSetIds) {
  const regions = new Set(Array.isArray(regionSetIds) ? regionSetIds : []);
  const own = setsContaining(sets, itemId).map((set) => set.id);
  // No region may be foreign to the item.
  for (const setId of regions) {
    if (!own.includes(setId)) return false;
  }
  // No set of the item's may be missing from the region.
  return own.every((setId) => regions.has(setId));
}

/** Filters a dragged selection to the items actually allowed at a
 * destination, so one blocked item cannot veto a whole multi-item drag. */
export function droppableItems(sets, itemIds, regionSetIds) {
  return (Array.isArray(itemIds) ? itemIds : [])
    .filter((id) => canDropInsideRegions(sets, id, regionSetIds));
}

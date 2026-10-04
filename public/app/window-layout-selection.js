/** Ephemeral member selection. Storage adapters preserve each surface's existing
 * set/map lifetime; this owner has no DOM, host, document or persistence access. */
export function createWindowLayoutSelection({
  read, write, erase, anchors, orderedIds, copyOnToggle = true,
}) {
  function toggle(layoutId, memberId) {
    const current = read(layoutId);
    const selected = copyOnToggle ? new Set(current ?? []) : current;
    if (selected.has(memberId)) selected.delete(memberId);
    else selected.add(memberId);
    write(layoutId, selected);
    anchors.set(layoutId, memberId);
  }
  function range(layoutId, memberId) {
    const ordered = orderedIds(layoutId);
    const anchorIndex = ordered.indexOf(anchors.get(layoutId));
    const clickedIndex = ordered.indexOf(memberId);
    const selected = new Set();
    if (anchorIndex === -1 || clickedIndex === -1) selected.add(memberId);
    else {
      const [start, end] = anchorIndex <= clickedIndex
        ? [anchorIndex, clickedIndex] : [clickedIndex, anchorIndex];
      for (let index = start; index <= end; index += 1) selected.add(ordered[index]);
    }
    write(layoutId, selected);
    anchors.set(layoutId, memberId);
  }
  function clear(layoutId, force = false) {
    if (!force && (!layoutId || !(read(layoutId)?.size > 0))) return false;
    erase(layoutId);
    anchors.delete(layoutId);
    return true;
  }
  function remove(layoutId, memberId) {
    return Boolean(read(layoutId)?.delete(memberId));
  }
  function repair(layoutId, removedIds, { eraseEmpty = false, repairAnchor = false } = {}) {
    const selected = read(layoutId);
    if (selected) {
      for (const memberId of removedIds) selected.delete(memberId);
      if (eraseEmpty && selected.size === 0) erase(layoutId);
    }
    if (repairAnchor && removedIds.has(anchors.get(layoutId))) anchors.delete(layoutId);
    return Boolean(selected);
  }
  function retain(layoutId, memberIds) {
    const selected = read(layoutId);
    if (!selected) return;
    for (const memberId of [...selected]) if (!memberIds.has(memberId)) selected.delete(memberId);
  }
  return { toggle, range, clear, remove, repair, retain };
}

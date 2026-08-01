/** Owns the drag-marquee selection gesture. It translates pointer events
 * into store session updates and narrow DOM/persistence effects — the store's
 * explicit session operations are the only mutation it performs. */
export function createMarqueeController({
  elements,
  store,
  itemsIntersectingMarquee,
  syncSelection,
  saveWorkspaceView,
}) {
  let drag = null;

  function marqueeBounds(startX, startY, endX, endY) {
    return {
      left: Math.min(startX, endX),
      top: Math.min(startY, endY),
      right: Math.max(startX, endX),
      bottom: Math.max(startY, endY),
    };
  }

  function showMarquee(bounds) {
    const explorerBounds = elements.explorer.getBoundingClientRect();
    elements.marquee.hidden = false;
    elements.marquee.style.left = `${bounds.left - explorerBounds.left}px`;
    elements.marquee.style.top = `${bounds.top - explorerBounds.top}px`;
    elements.marquee.style.width = `${bounds.right - bounds.left}px`;
    elements.marquee.style.height = `${bounds.bottom - bounds.top}px`;
  }

  function updateMarqueeSelection(bounds) {
    const tiles = [...elements.grid.querySelectorAll('.icon-item')]
      .map((tile) => {
        const rectangle = tile.getBoundingClientRect();
        return {
          id: tile.dataset.id,
          left: rectangle.left,
          top: rectangle.top,
          right: rectangle.right,
          bottom: rectangle.bottom,
        };
      })
      .filter((tile) => tile.right > tile.left && tile.bottom > tile.top);
    store.setSelection([
      ...drag.baseSelection,
      ...itemsIntersectingMarquee(tiles, bounds),
    ]);
    syncSelection();
  }

  function isActive(pointerId) {
    return drag !== null && drag.pointerId === pointerId;
  }

  /** Begins a marquee gesture on blank workspace space. When Ctrl is held the
   * current selection is preserved as the base; otherwise it is cleared. */
  function start({ pointerId, clientX, clientY, ctrlKey }) {
    drag = {
      pointerId,
      startX: clientX,
      startY: clientY,
      baseSelection: ctrlKey ? new Set(store.getSession().selected) : new Set(),
      moved: false,
    };
    if (!ctrlKey) {
      store.clearSelection();
      store.setSelectionAnchor(null);
      syncSelection();
    }
    elements.grid.setPointerCapture(pointerId);
  }

  function move({ pointerId, clientX, clientY }) {
    if (!isActive(pointerId)) return;
    const bounds = marqueeBounds(drag.startX, drag.startY, clientX, clientY);
    if (!drag.moved && bounds.right - bounds.left < 3 && bounds.bottom - bounds.top < 3) return;
    drag.moved = true;
    showMarquee(bounds);
    updateMarqueeSelection(bounds);
  }

  /** Ends the gesture; returns whether it actually moved, or null if the
   * pointer did not belong to an active marquee. */
  function finish(pointerId) {
    if (!isActive(pointerId)) return null;
    if (elements.grid.hasPointerCapture(pointerId)) {
      elements.grid.releasePointerCapture(pointerId);
    }
    const moved = drag.moved;
    drag = null;
    if (moved) saveWorkspaceView();
    elements.marquee.hidden = true;
    return moved;
  }

  return { isActive, start, move, finish };
}

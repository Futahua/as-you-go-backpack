/** Owns the drag-marquee selection gesture. It keeps only pointer/drag state,
 * capture, the movement threshold, rectangle/tile math, the overlay DOM, and
 * the blank-click-suppression result. All session mutation and persistence
 * delegate to the marquee commands. */
export function createMarqueeController({
  elements,
  commands,
  itemsIntersectingMarquee,
  itemSelector = '.icon-item',
}) {
  let drag = null;
  let frame = null;
  const view = elements.grid.ownerDocument?.defaultView;
  function scrollContainer() {
    for (let node=elements.grid; node; node=node.parentElement) {
      if (node.scrollHeight > node.clientHeight && /auto|scroll/.test(view?.getComputedStyle(node).overflowY || '')) return node;
    }
    return null;
  }
  function paint() {
    const bounds=marqueeBounds(drag.startX, drag.startY, drag.clientX, drag.clientY);
    showMarquee(bounds); updateMarqueeSelection(bounds);
  }
  function tick() {
    frame=null;
    if (!drag?.moved || !view) return;
    const node=drag.scroll;
    if (node) {
      const rect=node.getBoundingClientRect(), edge=Math.min(44,rect.height/4);
      const speed=drag.clientY < rect.top+edge ? -Math.min(1,(rect.top+edge-drag.clientY)/edge) : drag.clientY > rect.bottom-edge ? Math.min(1,(drag.clientY-rect.bottom+edge)/edge) : 0;
      const before=node.scrollTop;
      node.scrollTop += speed*16;
      drag.startY -= node.scrollTop-before;
      if (node.scrollTop!==before) paint();
    }
    frame=view.requestAnimationFrame(tick);
  }
  function stopFrame() { if(frame!==null)view?.cancelAnimationFrame(frame); frame=null; }

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
    const tiles = [...elements.grid.querySelectorAll(itemSelector)]
      .map((tile) => {
        const rectangle = tile.getBoundingClientRect();
        return {
          id: tile.dataset.id,
          left: rectangle.left,
          top: rectangle.top,
          right: rectangle.right,
          bottom: rectangle.bottom,
          // Ancestor tiles are breadcrumbs, not selection targets — the
          // same exclusion visibleItemIds applies to select-all and
          // shift-ranges.
          ancestor: tile.classList?.contains('ancestor-item') === true,
        };
      })
      .filter((tile) => tile.right > tile.left && tile.bottom > tile.top && !tile.ancestor);
    commands.updateMarqueeSelection([
      ...drag.baseSelection,
      ...itemsIntersectingMarquee(tiles, bounds),
    ]);
  }

  function isActive(pointerId) {
    return drag !== null && drag.pointerId === pointerId;
  }

  /** Begins a marquee gesture on blank workspace space. preserveSelection
   * comes from Ctrl being held; the command keeps or clears the selection. */
  function start({ pointerId, clientX, clientY, preserveSelection }) {
    stopFrame();
    drag = {
      pointerId,
      startX: clientX,
      startY: clientY,
      clientX, clientY,
      scroll: scrollContainer(),
      baseSelection: commands.beginMarqueeSelection({ preserveSelection }),
      moved: false,
    };
    elements.grid.setPointerCapture(pointerId);
  }

  function move({ pointerId, clientX, clientY }) {
    if (!isActive(pointerId)) return;
    const bounds = marqueeBounds(drag.startX, drag.startY, clientX, clientY);
    if (!drag.moved && bounds.right - bounds.left < 3 && bounds.bottom - bounds.top < 3) return;
    drag.moved = true;
    drag.clientX=clientX; drag.clientY=clientY;
    showMarquee(bounds);
    updateMarqueeSelection(bounds);
    if (frame===null && view) frame=view.requestAnimationFrame(tick);
  }

  /** Ends the gesture; returns whether it actually moved, or null if the
   * pointer did not belong to an active marquee. */
  function finish(pointerId) {
    if (!isActive(pointerId)) return null;
    if (elements.grid.hasPointerCapture(pointerId)) {
      elements.grid.releasePointerCapture(pointerId);
    }
    const moved = drag.moved;
    stopFrame();
    drag = null;
    commands.finishMarqueeSelection({ moved });
    elements.marquee.hidden = true;
    return moved;
  }

  /** 018X2 item 9: cancels an active marquee WITHOUT finalizing selection.
   * Releases pointer capture, hides the overlay and resets the gesture state,
   * so a later captured pointerup cannot call the finish command after a
   * handoff begins. Normal gestures are unaffected (start/move/finish
   * unchanged). */
  function cancel() {
    stopFrame();
    if (!drag) return;
    if (elements.grid.hasPointerCapture(drag.pointerId)) {
      elements.grid.releasePointerCapture(drag.pointerId);
    }
    drag = null;
    elements.marquee.hidden = true;
  }

  return { isActive, start, move, finish, cancel };
}

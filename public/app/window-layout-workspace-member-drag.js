/** Attached window-layout member drag input. Durable reorder/unlink stay injected. */
import { createWindowLayoutMemberDrag, orderWindowLayoutMemberButtons } from './window-layout-detached.js';

export function installWindowLayoutWorkspaceMemberDrag({
  documentRef,
  grid,
  CSS,
  widgetSurface,
  getLayout,
  clearSelection,
  cancelPreview,
  moveMemberButton,
  unlinkMember,
  commitReorder,
  dropOutPx,
}) {
  const memberDrag = createWindowLayoutMemberDrag();
  let dragJustMoved = false;

  function restoreDomOrder(layoutId) {
    const members = documentRef.querySelector(`[data-wl-members="${CSS.escape(layoutId)}"]`);
    const layout = getLayout(layoutId);
    if (!members || !layout) return;
    const memberIds = (layout.arrangement?.members ?? []).map((member) => member.id);
    const ordered = orderWindowLayoutMemberButtons(
      [...members.querySelectorAll('[data-wl-member]')],
      memberIds,
    );
    for (const button of ordered) {
      if (button.parentNode === members) members.appendChild(button);
    }
  }

  function cancel() {
    const layoutId = memberDrag.get()?.layoutId;
    memberDrag.cancel();
    if (layoutId) restoreDomOrder(layoutId);
    const members = documentRef.querySelector('[data-wl-members].wl-drag-out');
    if (members) members.classList.remove('wl-drag-out');
  }

  function outsideRow(row, event) {
    return event.clientY < row.top - dropOutPx
      || event.clientY > row.bottom + dropOutPx
      || event.clientX < row.left - dropOutPx
      || event.clientX > row.right + dropOutPx;
  }

  const onPointerDown = (event) => {
    if (widgetSurface) return;
    const body = event.target.closest('.window-layout-body');
    if (body && event.button === 0 && !event.ctrlKey && !event.shiftKey
      && !event.target.closest('button, input, [data-wl-member]')) {
      clearSelection(body.dataset.wlLayout);
    }
    const member = event.target.closest('[data-wl-member]');
    if (!member || !event.ctrlKey || event.button !== 0) return;
    cancelPreview();
    memberDrag.start({
      layoutId: member.dataset.wlLayout,
      memberId: member.dataset.wlMember,
      clientX: event.clientX,
      clientY: event.clientY,
      pointerId: event.pointerId,
    });
  };

  const onPointerMove = (event) => {
    if (widgetSurface) return;
    const drag = memberDrag.move(event.pointerId, event.clientX, event.clientY);
    if (!drag) return;
    const members = documentRef.querySelector(`[data-wl-members="${CSS.escape(drag.layoutId)}"]`);
    const button = documentRef.querySelector(`[data-wl-layout="${CSS.escape(drag.layoutId)}"] [data-wl-member="${CSS.escape(drag.memberId)}"]`);
    if (!members || !button) return;
    const outside = outsideRow(members.getBoundingClientRect(), event);
    members.classList.toggle('wl-drag-out', outside);
    if (!outside) moveMemberButton(members, button, event.clientX, event.clientY);
  };

  const onPointerUp = (event) => {
    if (widgetSurface) return;
    memberDrag.finalize(event.pointerId, (drag) => {
      const members = documentRef.querySelector(`[data-wl-members="${CSS.escape(drag.layoutId)}"]`);
      if (!members) return;
      const outside = outsideRow(members.getBoundingClientRect(), event);
      members.classList.remove('wl-drag-out');
      if (!getLayout(drag.layoutId) || !drag.moved) return;
      dragJustMoved = true;
      if (outside) {
        unlinkMember(drag.layoutId, drag.memberId);
        return;
      }
      const buttons = [...members.querySelectorAll('[data-wl-member]')];
      const toIndex = buttons.findIndex((button) => button.dataset.wlMember === drag.memberId);
      if (toIndex !== -1) commitReorder(drag.layoutId, drag.memberId, toIndex);
    });
  };

  const onPointerCancel = (event) => {
    if (widgetSurface) return;
    const active = memberDrag.get();
    if (!active || !memberDrag.cancelMatching(event.pointerId)) return;
    restoreDomOrder(active.layoutId);
    const members = documentRef.querySelector('[data-wl-members].wl-drag-out');
    if (members) members.classList.remove('wl-drag-out');
  };

  const onKeyDown = (event) => {
    if (event.key === 'Escape' && memberDrag.isActive()) cancel();
  };

  grid.addEventListener('pointerdown', onPointerDown);
  grid.addEventListener('pointermove', onPointerMove);
  grid.addEventListener('pointerup', onPointerUp);
  grid.addEventListener('pointercancel', onPointerCancel);
  documentRef.addEventListener('keydown', onKeyDown);

  return {
    cancel,
    consumeJustMoved() {
      if (!dragJustMoved) return false;
      dragJustMoved = false;
      return true;
    },
  };
}
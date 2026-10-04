/**
 * Surface-local input routing for window-layout preview and Shift Peek.
 * Owns no durable state, capability authority, or persistence.
 */
import { planWindowLayoutShiftPeekTransition } from './window-layout-shift-peek.js';
import { windowLayoutPreviewHoverState } from './window-layout-preview.js';

export function installWindowLayoutPreviewInput({
  windowRef,
  documentRef,
  grid,
  host,
  widgetSurface,
  shiftPeek,
  memberPreview,
  memberPopover,
  schedulePreviewDwell,
  cancelPreviewDwell,
  scheduleListDwell,
  cancelListDwell,
  openWorkspacePicker,
}) {
  let lastHoveredMember = null;

  const onKeyDown = (event) => shiftPeek.apply(planWindowLayoutShiftPeekTransition('keydown', event, {
    held: shiftPeek.held,
    member: documentRef.querySelector('[data-wl-member]:hover'),
  }));
  const onKeyUp = (event) => shiftPeek.apply(planWindowLayoutShiftPeekTransition('keyup', event, {
    held: shiftPeek.held,
  }));
  const onBlur = () => {
    if (widgetSurface) return;
    shiftPeek.apply(planWindowLayoutShiftPeekTransition('blur', {}, { held: shiftPeek.held }));
  };
  const onNativeShift = (held) => {
    shiftPeek.apply(planWindowLayoutShiftPeekTransition(held ? 'keydown' : 'keyup', { key: 'Shift' }, {
      held: shiftPeek.held,
      member: documentRef.querySelector('[data-wl-member]:hover')
        ?? (grid.matches(':hover') && lastHoveredMember?.isConnected ? lastHoveredMember : null),
    }));
  };
  const onMouseOver = (event) => {
    const listButton = event.target.closest('[data-wl-list]');
    const relatedListButton = event.relatedTarget?.closest?.('[data-wl-list]') ?? null;
    if (!widgetSurface && listButton && listButton !== relatedListButton) {
      scheduleListDwell(listButton, () => openWorkspacePicker(listButton.dataset.wlList));
      return;
    }
    const member = event.target.closest('[data-wl-member]');
    const relatedMember = event.relatedTarget?.closest?.('[data-wl-member]') ?? null;
    if (member) lastHoveredMember = member;
    const peekTransition = planWindowLayoutShiftPeekTransition('hover', event, {
      held: shiftPeek.held,
      member,
      relatedMember,
    });
    if (peekTransition.handled) {
      shiftPeek.keepAlive();
      shiftPeek.apply(peekTransition);
      return;
    }
    const state = windowLayoutPreviewHoverState(member, relatedMember);
    if (state === 'outside') {
      if (!event.target.closest('[data-wl-popover]')) {
        cancelPreviewDwell();
        memberPopover.hide();
        memberPreview.cancel();
      }
      return;
    }
    if (state === 'inside') return;
    schedulePreviewDwell(member);
  };
  const onPointerMove = (event) => {
    if (shiftPeek.held && grid.matches(':hover')) shiftPeek.keepAlive();
    const member = event.target.closest('[data-wl-member]');
    if (member) lastHoveredMember = member;
    const transition = planWindowLayoutShiftPeekTransition('pointermove', event, {
      held: shiftPeek.held,
      member,
    });
    if (transition.handled && transition.begin) {
      shiftPeek.keepAlive();
      shiftPeek.apply(transition);
      return;
    }
    if (transition.handled && transition.end) shiftPeek.apply(transition);
  };
  const onMouseOut = (event) => {
    const listButton = event.target.closest('[data-wl-list]');
    const relatedListButton = event.relatedTarget?.closest?.('[data-wl-list]') ?? null;
    if (listButton && listButton !== relatedListButton) cancelListDwell();
    const member = event.target.closest('[data-wl-member]');
    const relatedMember = event.relatedTarget?.closest?.('[data-wl-member]') ?? null;
    if (relatedMember) lastHoveredMember = relatedMember;
    else if (!event.relatedTarget || !grid.contains(event.relatedTarget)) lastHoveredMember = null;
    if (member && !relatedMember && shiftPeek.key) {
      const leftWidget = !event.relatedTarget || !grid.contains(event.relatedTarget);
      const leave = planWindowLayoutShiftPeekTransition('memberleave', { leftWidget }, { held: shiftPeek.held });
      if (leave.end) shiftPeek.deferEnd();
    }
    const state = windowLayoutPreviewHoverState(member, relatedMember);
    if (state === 'enter') {
      cancelPreviewDwell();
      memberPopover.hide();
      memberPreview.cancel();
    }
  };
  const cancelPreview = () => {
    cancelPreviewDwell();
    memberPopover.hide();
    memberPreview.cancel();
  };
  // Control intent wins over cosmetic capture work. Cancel pending preview work
  // in capture phase before member handlers can queue native window actions.
  const onPointerDown = (event) => {
    if (!event.target?.closest?.('[data-wl-member]')) return;
    cancelPreview();
  };
  const onPageHide = () => {
    shiftPeek.end();
    cancelPreviewDwell();
    memberPreview.cancel();
  };

  windowRef.addEventListener('keydown', onKeyDown);
  windowRef.addEventListener('keyup', onKeyUp);
  windowRef.addEventListener('blur', onBlur);
  if (typeof host.onWindowControlShift === 'function') host.onWindowControlShift(onNativeShift);
  grid.addEventListener('mouseover', onMouseOver);
  grid.addEventListener('pointermove', onPointerMove);
  grid.addEventListener('mouseout', onMouseOut);
  documentRef.addEventListener('pointerdown', onPointerDown, true);
  documentRef.addEventListener('scroll', cancelPreview, true);
  windowRef.addEventListener('resize', cancelPreview);
  windowRef.addEventListener('pagehide', onPageHide);

  return {
    dispose() {
      windowRef.removeEventListener('keydown', onKeyDown);
      windowRef.removeEventListener('keyup', onKeyUp);
      windowRef.removeEventListener('blur', onBlur);
      grid.removeEventListener('mouseover', onMouseOver);
      grid.removeEventListener('pointermove', onPointerMove);
      grid.removeEventListener('mouseout', onMouseOut);
      documentRef.removeEventListener('pointerdown', onPointerDown, true);
      documentRef.removeEventListener('scroll', cancelPreview, true);
      windowRef.removeEventListener('resize', cancelPreview);
      windowRef.removeEventListener('pagehide', onPageHide);
    },
  };
}
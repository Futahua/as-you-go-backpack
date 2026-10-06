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
  let peekDismissed = false;
  const peekDefault=()=>widgetSurface&&documentRef.documentElement?.dataset?.widgetInteraction==='peek';
  const onInteractionMode=(event)=>{
    if(!widgetSurface||event.source!==windowRef||event.data?.type!=='papers:project:widget-interaction-mode')return;
    if(event.data.mode==='dismissed'){
      peekDismissed=true;
      lastHoveredMember=null;
      shiftPeek.apply({handled:true,held:false,end:true,begin:null});
      cancelPreviewDwell();cancelListDwell();memberPopover.hide();memberPreview.cancel();
      return;
    }
    peekDismissed = false;
    documentRef.documentElement.dataset.widgetInteraction=event.data.mode==='peek'?'peek':'legacy';
    shiftPeek.apply({handled:true,held:false,end:true,begin:null});
    cancelPreviewDwell(); memberPreview.cancel();
    if(peekDefault()&&lastHoveredMember?.isConnected)shiftPeek.apply({handled:true,held:true,end:false,begin:lastHoveredMember});
  };
  windowRef.addEventListener('message',onInteractionMode);


  const onKeyDown = (event) => !peekDismissed && shiftPeek.apply(planWindowLayoutShiftPeekTransition('keydown', event, {
    held: shiftPeek.held,
    member: documentRef.querySelector('[data-wl-member]:hover'),
  }));
  const onKeyUp = (event) => !peekDefault() && shiftPeek.apply(planWindowLayoutShiftPeekTransition('keyup', event, {
    held: shiftPeek.held,
  }));
  const onBlur = () => {
    if (widgetSurface) return;
    shiftPeek.apply(planWindowLayoutShiftPeekTransition('blur', {}, { held: shiftPeek.held }));
  };
  const onNativeShift = (held) => {
    if(peekDefault() || peekDismissed)return;
    shiftPeek.apply(planWindowLayoutShiftPeekTransition(held ? 'keydown' : 'keyup', { key: 'Shift' }, {
      held: shiftPeek.held,
      member: documentRef.querySelector('[data-wl-member]:hover')
        ?? (grid.matches(':hover') && lastHoveredMember?.isConnected ? lastHoveredMember : null),
    }));
  };
  const onMouseOver = (event) => {
    if (peekDismissed) return;
    const listButton = event.target.closest('[data-wl-list]');
    const relatedListButton = event.relatedTarget?.closest?.('[data-wl-list]') ?? null;
    if (!widgetSurface && listButton && listButton !== relatedListButton) {
      scheduleListDwell(listButton, () => openWorkspacePicker(listButton.dataset.wlList));
      return;
    }
    const member = event.target.closest('[data-wl-member]');
    const relatedMember = event.relatedTarget?.closest?.('[data-wl-member]') ?? null;
    if (member) lastHoveredMember = member;
    const peekTransition = planWindowLayoutShiftPeekTransition('hover', peekDefault()?{shiftKey:true}:event, {
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
    if (peekDismissed) return;
    if (shiftPeek.held && grid.matches(':hover')) shiftPeek.keepAlive();
    const member = event.target.closest('[data-wl-member]');
    if (member) lastHoveredMember = member;
    const transition = planWindowLayoutShiftPeekTransition('pointermove', peekDefault()?{shiftKey:true}:event, {
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
    if (peekDismissed) return;
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
    if (peekDefault() && (event.button ?? 0) === 0
      && !event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey) {
      // Activation is asynchronous. Late hover events must not re-enable DWM
      // Peek while its caller is being hidden; that leaves a compositor ghost.
      // Only a fresh host summon re-arms this hover session.
      peekDismissed = true;
      lastHoveredMember = null;
      shiftPeek.apply({ handled: true, held: false, end: true, begin: null });
    }
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
      windowRef.removeEventListener('message',onInteractionMode);
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

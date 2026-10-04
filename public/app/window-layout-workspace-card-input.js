/** Attached window-layout card/control routing. Generic graph input remains caller-owned. */
export function createWindowLayoutWorkspaceCardInput({
  detachedWidgets, consumeDragClick, isolateMode, handleMemberClick, handlePickCandidate,
  unlinkMember, closePicker, cancelListDwell, beginDirectPick, toggleTracking, groupAction,
  closeWidget, openWidget, render, cancelPreview, closeMember, toggleIsolateMode, toggleRange,
  isControlReady, controlUnavailable, setStatus,
}) {
  function handleClick(event) {
    const body = event.target.closest('.window-layout-body');
    if (!body) return false;
    const bodyLayoutId = body.dataset?.wlLayout;
    const detached = typeof bodyLayoutId === 'string' && bodyLayoutId && detachedWidgets.has(bodyLayoutId);
    if (detached && !event.target.closest('[data-wl-reattach]')) return true;
    const member = event.target.closest('[data-wl-member]');
    if (member) {
      if (consumeDragClick()) return true;
      const layoutId = member.dataset.wlLayout;
      const memberId = member.dataset.wlMember;
      if (!event.ctrlKey && !event.shiftKey && !isolateMode.isActive(layoutId)) void handleMemberClick(layoutId, memberId);
      else void handleMemberClick(layoutId, memberId, event.ctrlKey, event.shiftKey);
      return true;
    }
    const candidate = event.target.closest('[data-wl-pick-candidate]');
    if (candidate) {
      void handlePickCandidate(candidate.dataset.wlPick, candidate.dataset.wlPickCandidate);
      return true;
    }
    const unlink = event.target.closest('[data-wl-unlink]');
    if (unlink) {
      void unlinkMember(unlink.dataset.wlPick, unlink.dataset.wlUnlink);
      return true;
    }
    if (event.target.closest('[data-wl-picker-close]')) {
      closePicker();
      return true;
    }
    const list = event.target.closest('[data-wl-list]');
    if (list) {
      cancelListDwell();
      void beginDirectPick(list.dataset.wlList);
      return true;
    }
    const tracking = event.target.closest('[data-wl-track]');
    if (tracking) {
      void toggleTracking(tracking.dataset.wlTrack);
      return true;
    }
    const minimize = event.target.closest('[data-wl-min-all]');
    if (minimize) {
      void groupAction(minimize.dataset.wlMinAll, 'minimize');
      return true;
    }
    const restore = event.target.closest('[data-wl-restore-all]');
    if (restore) {
      void groupAction(restore.dataset.wlRestoreAll, 'restore');
      return true;
    }
    const reattach = event.target.closest('[data-wl-reattach]');
    if (reattach) {
      const layoutId = reattach.dataset.wlReattach;
      if (detachedWidgets.delete(layoutId)) render();
      void closeWidget(layoutId).catch(() => undefined);
      return true;
    }
    return true;
  }

  function handleAuxClick(event) {
    if (event.button !== 1) return false;
    const restore = event.target.closest('[data-wl-restore-all]');
    if (restore && !detachedWidgets.has(restore.dataset.wlRestoreAll)) {
      event.preventDefault(); event.stopPropagation();
      void openWidget(restore.dataset.wlRestoreAll);
      return true;
    }
    const minimize = event.target.closest('[data-wl-min-all]');
    if (minimize && detachedWidgets.has(minimize.dataset.wlMinAll)) {
      event.preventDefault(); event.stopPropagation();
      const layoutId = minimize.dataset.wlMinAll;
      if (detachedWidgets.delete(layoutId)) render();
      void closeWidget(layoutId).catch(() => undefined);
      return true;
    }
    const member = event.target.closest('[data-wl-member]');
    if (!member || member.disabled) return false;
    event.preventDefault(); event.stopPropagation();
    cancelPreview();
    if (event.ctrlKey) void closeMember(member.dataset.wlLayout, member.dataset.wlMember);
    else unlinkMember(member.dataset.wlLayout, member.dataset.wlMember);
    return true;
  }

  function handleContextMenu(event) {
    const isolate = event.target.closest('[data-wl-min-all]');
    if (isolate) {
      toggleIsolateMode(isolate.dataset.wlMinAll);
      return true;
    }
    const member = event.target.closest('[data-wl-member]');
    if (!member) return false;
    const layoutId = member.dataset.wlLayout;
    const memberId = member.dataset.wlMember;
    if (event.ctrlKey && !event.shiftKey && isolateMode.isActive(layoutId)) {
      const targets = isolateMode.click(layoutId, memberId, true);
      if (targets !== null) void groupAction(layoutId, 'isolate', targets);
      return true;
    }
    if (event.shiftKey) {
      void toggleRange(layoutId, memberId);
      return true;
    }
    if (!layoutId || !memberId || member.disabled) return true;
    if (!isControlReady(layoutId, memberId)) {
      setStatus(layoutId, controlUnavailable() || 'Native window control is preparing.');
    }
    return true;
  }

  return { handleClick, handleAuxClick, handleContextMenu };
}
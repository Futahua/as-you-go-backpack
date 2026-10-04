/** AYG group/range orchestration. Native broker owns execution; existing store owns saves. */
export function createWindowLayoutGroupActions({ getState, windowLayoutDetachment, windowLayoutFromState, windowLayoutMemberFromState, windowLayoutRuntime, windowLayoutMemberKey, host, updateWindowLayoutMember, store, noteWindowLayoutCommit, queueWindowLayoutSave, setWindowLayoutStatus, windowLayoutRecording, capabilityForMember, windowLayoutRuntimeController, windowLayoutStatusForOutcome }) {
  async function windowLayoutGroupAction(layoutId, action, explicitTargetIds = null) {
    if (windowLayoutDetachment.isReadOnly()) return;
    const layout = windowLayoutFromState(layoutId);
    if (!layout) return;
    const members = layout.arrangement?.members ?? [];
    if (members.length === 0) return;
    const selected = explicitTargetIds
      ? new Set(explicitTargetIds)
      : windowLayoutRuntime.selectedMembers.get(layoutId);
    const targets = selected && selected.size > 0
      ? members.filter((member) => selected.has(member.id)) : members;
    const actions = targets.map((member) => ({
      memberId: member.id,
      operation: action === 'isolate' ? 'restore' : action,
    }));
    if (action === 'isolate') {
      for (const member of members) {
        if (!targets.some((target) => target.id === member.id)) {
          actions.push({ memberId: member.id, operation: 'minimize' });
        }
      }
    }
    if (typeof host.windowControlGroup !== 'function') {
      setWindowLayoutStatus(layoutId, 'Native window control is unavailable.');
      return;
    }
    const result = await host.windowControlGroup(layoutId, actions).catch(() => ({ outcome: 'helper-unavailable' }));
    if (windowLayoutDetachment.isReadOnly()) return;
    if (result?.outcome !== 'success') {
      setWindowLayoutStatus(layoutId, 'Native window control is unavailable.');
      return;
    }
    let nextState = getState();
    for (const entry of actions) {
      nextState = updateWindowLayoutMember(nextState, layoutId, entry.memberId,
        { state: entry.operation === 'minimize' ? 'minimized' : 'normal' });
    }
    store.replace(nextState);
    noteWindowLayoutCommit(layoutId);
    queueWindowLayoutSave();
    setWindowLayoutStatus(layoutId, '');
    await windowLayoutRecording.ensureRecording(layoutId);
  }

  /** Shift+right-click probes the clicked member once, then asks the native broker
   * to minimize/restore the explicit or locally selected range. */
  async function windowLayoutToggleRange(layoutId, clickedMemberId, explicitMemberIds = null) {
    if (windowLayoutDetachment.isReadOnly()) return;
    const member = windowLayoutMemberFromState(layoutId, clickedMemberId);
    if (!member) return;
    const selected = explicitMemberIds !== null
      ? new Set(explicitMemberIds)
      : windowLayoutRuntime.selectedMembers.get(layoutId);
    const hasRange = Boolean(selected && selected.size > 0);
    const capability = await capabilityForMember(layoutId, clickedMemberId);
    // 018X5: abort immediately after the probe resolution await.
    if (windowLayoutDetachment.isReadOnly()) return;
    if (!capability) {
      setWindowLayoutStatus(layoutId, 'Window not visible');
      return;
    }
    const observed = await host.observeWindowCapability(capability);
    // 018X4: abort immediately after the observe await, before success/failure.
    if (windowLayoutDetachment.isReadOnly()) return;
    if (observed.outcome !== 'success' || !observed.observation) {
      if (observed.outcome === 'missing') {
        windowLayoutRuntime.capabilities.delete(windowLayoutMemberKey(layoutId, clickedMemberId));
        windowLayoutRuntimeController.invalidateCapabilities(layoutId);
      }
      setWindowLayoutStatus(layoutId, windowLayoutStatusForOutcome(observed.outcome));
      return;
    }
    const liveState = observed.observation.state === 'minimized' ? 'minimized' : 'normal';
    const action = liveState === 'minimized' ? 'restore' : 'minimize';
    const range = explicitMemberIds !== null
      ? explicitMemberIds
      : (hasRange ? null : [clickedMemberId]);
    await windowLayoutGroupAction(layoutId, action, range);
  }
  return { groupAction: windowLayoutGroupAction, toggleRange: windowLayoutToggleRange };
}

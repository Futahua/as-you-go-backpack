/** Recording resume/stop, save demand and retirement over existing authorities. */
import { removeClosedWindowFromAllLayouts, removeWindowLayoutMember,
  setWindowLayoutInstanceSuppressed } from '../workspace-model-20260730b.js';
import { windowLayoutMemberKey as defaultMemberKey } from './window-layout-runtime.js';
export function createWindowLayoutRecordingLifecycle({
  getState, getController, getRecording, isWidgetSurface, sendWidgetCommand,
  windowLayoutDetachment, windowLayoutRuntime, windowLayoutRetirementWriter,
  windowLayoutWidgetPreviewCapabilities, store, windowLayoutSelection,
  syncWindowLayoutMemberSelection, setWindowLayoutStatus, noteWindowLayoutCommit,
  windowLayoutMemberPreview, windowLayoutFromState, saveWorkspaceView,
  closeWindowLayoutPicker, host, WINDOW_LAYOUT_SAVE_DEBOUNCE_MS,
  windowLayoutMemberKey = defaultMemberKey,
  setTimeout = globalThis.setTimeout, clearTimeout = globalThis.clearTimeout,
}) {
function isActiveRecordingContext(layoutId) {
  return getController().getSnapshot().activeLayoutId === layoutId;
}


async function retireClosedWindowEverywhere(descriptor, diagnostics = {}) {
  if (isWidgetSurface()) {
    return Boolean(sendWidgetCommand({
      kind: 'retire-closed-window',
      descriptor,
      diagnostics,
    }));
  }
  if (windowLayoutDetachment.isReadOnly()) return false;
  const removedByLayout = new Map();
  for (const layout of getState().windowLayouts ?? []) {
    const removed = (layout.arrangement?.members ?? []).filter((member) => {
      if (typeof descriptor?.windowInstanceId === 'string') {
        return member.descriptor?.windowInstanceId === descriptor.windowInstanceId;
      }
      return member.descriptor?.title === descriptor?.title
        && member.descriptor?.executableFingerprint?.toLowerCase()
          === descriptor?.executableFingerprint?.toLowerCase();
    });
    if (removed.length > 0) removedByLayout.set(layout.id, removed);
  }
  if (removedByLayout.size === 0) return false;
  const next = removeClosedWindowFromAllLayouts(getState(), descriptor, diagnostics);
  const persisted = await store.commit(next);
  if (!persisted) return false;
  for (const [changedLayoutId, removed] of removedByLayout) {
    const removedIds = new Set(removed.map((member) => member.id));
    for (const memberId of removedIds) {
      const key = windowLayoutMemberKey(changedLayoutId, memberId);
      windowLayoutRuntime.capabilities.delete(key);
      windowLayoutRuntime.icons.delete(key);
      windowLayoutWidgetPreviewCapabilities.delete(key);
    }
    if (windowLayoutSelection.repair(changedLayoutId, removedIds, { eraseEmpty: true, repairAnchor: true })) {
      syncWindowLayoutMemberSelection(changedLayoutId);
    }
    setWindowLayoutStatus(changedLayoutId, '');
    noteWindowLayoutCommit(changedLayoutId, { reason: 'closed-window-retired' });
  }
  windowLayoutMemberPreview.cancel();
  if ([...removedByLayout.keys()].some((candidate) => isActiveRecordingContext(candidate))) {
    await getController().reconcileActive();
  }
  return persisted;
}


function handleWindowLayoutRetireMember(intent) {
  const { layoutId, memberId } = intent ?? {};
  if (!layoutId || !memberId) return;
  if (windowLayoutDetachment.isReadOnly()) return;
  const result = windowLayoutRetirementWriter.retire(layoutId, memberId);
  if (result.outcome !== 'removed') return;
  if (intent.reason === 'watcher-destroy' && typeof intent.descriptor?.windowInstanceId === 'string') {
    const cleared = setWindowLayoutInstanceSuppressed(getState(), layoutId, intent.descriptor.windowInstanceId, false);
    void store.commit(cleared);
  }
  // 019G: a removed card must clear/discard any pending hover preview.
  windowLayoutMemberPreview.cancel();
  noteWindowLayoutCommit(layoutId);
  setWindowLayoutStatus(layoutId, '');
  if (windowLayoutSelection.remove(layoutId, memberId)) syncWindowLayoutMemberSelection(layoutId);
}


function queueWindowLayoutSave() {
  clearTimeout(windowLayoutRuntime.saveTimer);
  windowLayoutRuntime.saveTimer = setTimeout(() => {
    saveWorkspaceView();
  }, WINDOW_LAYOUT_SAVE_DEBOUNCE_MS);
}

/** Bootstrap: reconcile the persisted active id WITHOUT inventing one. Returns
 * the real controller switch promise so the detached/workspace RESUMED ACK
 * follows actual owner start (018X1). A null id means no recording context
 * until the creator touches a layout. */
function bootstrapWindowLayoutRecording() {
  // Deliberately the DURABLE id, not isActiveRecordingContext(): this is the
  // resume seam, and at boot the runtime has no active layout yet. This is the
  // one question the persisted field is the right answer to.
  if (getState().activeWindowLayoutId) {
    // RESUME, do not activate. Launching Papers attaches observation to the
    // layout that was already active; ensureRecording() here replayed the whole
    // layout - applying every saved rectangle and restoring each window in turn
    // for about eight seconds after launch, raising the creator's windows over
    // whatever they were doing. A deliberate switch still applies the layout.
    return getRecording().resumeRecording(getState().activeWindowLayoutId);
  }
  return Promise.resolve();
}

/** Teardown: stop the recording timer and drop ephemeral capabilities without
 * a late save (the persisted active id stays for the next open to reconcile).
 * A pending debounced save is cancelled so no write races the unload. This is
 * the CONTROLLER stop used by the detach handoff too, so it must NOT stop the
 * detach lifecycle: the workspace still has to receive CLOSED/crash and
 * resume. 018X2 item 8: the runtime stop Promise is RETURNED so the factory's
 * `await stopController()` is a real await. The pagehide handler performs the
 * full lifecycle stop. */
function teardownWindowLayoutRecording() {
  clearTimeout(windowLayoutRuntime.saveTimer);
  windowLayoutRuntime.saveTimer = null;
  const hadActivePick = Boolean(windowLayoutRuntime.pickAttempt || windowLayoutRuntime.pickUnsubscribe);
  windowLayoutRuntime.pickAttempt = null;
  windowLayoutRuntime.pickLayoutId = null;
  windowLayoutRuntime.pickUnsubscribe?.();
  windowLayoutRuntime.pickUnsubscribe = null;
  // pagehide can occur without immediately destroying the sender WebContents.
  // Do not abandon the result listener while leaving that sender owning the
  // native one-shot session; explicitly release it before teardown completes.
  const cancelPick = hadActivePick
    ? host.pickWindowCancel().catch(() => undefined)
    : Promise.resolve();
  return Promise.all([
    cancelPick,
    getController().stop({ clearActive: false }),
  ]).then(() => undefined);
}


function handleWindowLayoutUnlink(layoutId, memberId) {
  if (windowLayoutDetachment.isReadOnly()) return;
  const layout = windowLayoutFromState(layoutId);
  if (!layout || !memberId) return;
  // 019G: a removed card must clear/discard any pending hover preview.
  windowLayoutMemberPreview.cancel();
  let next = removeWindowLayoutMember(getState(), layoutId, memberId, { source: 'user-unlink', reason: 'the creator removed this icon' });
  if (layout.tracking?.enabled === true && typeof layout.arrangement?.members?.find((member) => member.id === memberId)?.descriptor?.windowInstanceId === 'string') {
    const instanceId = layout.arrangement.members.find((member) => member.id === memberId).descriptor.windowInstanceId;
    next = setWindowLayoutInstanceSuppressed(next, layoutId, instanceId, true);
  }
  windowLayoutRuntime.capabilities.delete(windowLayoutMemberKey(layoutId, memberId));
  windowLayoutRuntime.icons.delete(windowLayoutMemberKey(layoutId, memberId));
  store.commit(next);
  closeWindowLayoutPicker();
  saveWorkspaceView();
  noteWindowLayoutCommit(layoutId);
  // Unlinking a member of the active layout re-syncs the observer; unlinking
  // from an inactive layout never starts recording there. Unlinking the last
  // member leaves the id retained with no timer (retry on the next add).
  if (isActiveRecordingContext(layoutId)) {
    void getController().reconcileActive();
  }
}


return { active: isActiveRecordingContext, retireEverywhere: retireClosedWindowEverywhere,
  retireMember: handleWindowLayoutRetireMember, queueSave: queueWindowLayoutSave,
  resume: bootstrapWindowLayoutRecording, stop: teardownWindowLayoutRecording,
  unlink: handleWindowLayoutUnlink };
}

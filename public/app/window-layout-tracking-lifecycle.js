/** Native lifecycle coordination over the existing Auto writer and recording controller. */
import { createWindowLayoutAutoTracking as defaultAutoTracking } from './window-layout-auto-tracking.js';
import { addWindowLayoutMember as defaultAdd, setWindowLayoutTracking as defaultTracking,
  reconcileWindowLayoutsAfterStartup as defaultStartup } from '../workspace-model-20260730b.js';
import { windowLayoutMemberKey as defaultMemberKey } from './window-layout-runtime.js';
export function createWindowLayoutTrackingLifecycle({
  getState, getSurfaceCoordinator, host, windowLayoutDetachment, hasDocumentWriteAuthority,
  SURFACE_ROLE, windowLayoutRuntime, windowLayoutWidgetPreviewCapabilities,
  windowLayoutRuntimeController, windowLayoutRecording, isActiveRecordingContext,
  store, saveWorkspaceView, noteWindowLayoutCommit, retireClosedWindowEverywhere,
  windowLayoutSelection, syncWindowLayoutMemberSelection, setWindowLayoutStatus,
  windowLayoutMemberPreview, windowLayoutFromState, windowLayoutStatusForOutcome,
  createWindowLayoutAutoTracking = defaultAutoTracking,
  addWindowLayoutMember = defaultAdd, setWindowLayoutTracking = defaultTracking,
  reconcileWindowLayoutsAfterStartup = defaultStartup, windowLayoutMemberKey = defaultMemberKey,
  window = globalThis.window, Date = globalThis.Date, crypto = globalThis.crypto,
}) {
const windowLayoutGoneConfirmations = new Map();
let trackingEventInFlight = false;
const trackingEventQueue = [];
let trackingPopulateInFlight = false;
const trackingPendingOpens = new Map();
let trackingSessionId = null;
let trackingLastSequence = 0;
let trackingStartupBaselineReconciled = false;
const CLOSED_WINDOW_RECONCILE_INTERVAL_MS = 2000;
let closedWindowReconcileTimer = null;
let closedWindowReconcileInFlight = false;
const windowLayoutAutoTracking = createWindowLayoutAutoTracking({
  getState: () => getState(),
  resolveWindowInstance: (instanceId) => host.resolveWindowInstance(instanceId),
  resolveWindowDescriptor: (descriptor) => host.resolveWindowDescriptor(descriptor),
  observeWindowCapability: (capability) => host.observeWindowCapability(capability),
  commit: (next) => store.commit(next),
  onCommitted: async ({ layoutId, member, capability }) => {
    windowLayoutRuntime.capabilities.set(windowLayoutMemberKey(layoutId, member.id), capability);
    saveWorkspaceView();
    noteWindowLayoutCommit(layoutId);
    // Auto observes a new member; it must not select/reapply the entire saved
    // arrangement when the recording context is inactive (for example while
    // Quick Run has focus). Only refresh an already active recording session.
    if (isActiveRecordingContext(layoutId)) {
      await windowLayoutRuntimeController.reconcileActive();
    }
  },
  onDiagnostic: ({ stage, outcome }) => host.windowLayoutDiagnostic?.({ stage, outcome }),
});

function isWindowLifecycleDestroyEvent(event) {
  return event?.kind === 'destroy'
    || event?.kind === 'close'
    || event?.kind === 'closed'
    || event?.kind === 'gone';
}

async function processTrackingLifecycleEvent(event) {
  if (windowLayoutDetachment.isReadOnly() || !hasDocumentWriteAuthority()
    || getSurfaceCoordinator()?.role !== SURFACE_ROLE.WRITER) return;
  if (!event || typeof event.windowInstanceId !== 'string') return;
  if (isWindowLifecycleDestroyEvent(event)) {
    trackingPendingOpens.delete(event.windowInstanceId);
    const tracked = (getState().windowLayouts ?? []).some((layout) =>
      (layout.arrangement?.members ?? []).some((member) =>
        member.descriptor?.windowInstanceId === event.windowInstanceId));
    if (!tracked) return;
    // EVIDENCE, NOT PROOF. A lifecycle 'gone' is produced by diffing successive
    // task-worthy enumerations, so one transient disappearance would delete a
    // member outright. Seed one positive, then corroborate it immediately with
    // the exact resolver. That resolver performs a fresh serialized enumeration
    // when the WID is no longer in the lifecycle cache, so this is the second
    // independent observation. Do not make a real close wait for a renderer
    // timer: background/throttled writer surfaces can still receive the host
    // lifecycle push while their 2s safety sweep is delayed indefinitely.
    const existing = windowLayoutGoneConfirmations.get(event.windowInstanceId);
    windowLayoutGoneConfirmations.set(event.windowInstanceId, {
      count: Math.max(1, existing?.count ?? 0),
      at: Date.now(),
    });
    let confirmed = null;
    try {
      confirmed = await host.resolveWindowInstance(event.windowInstanceId);
    } catch {
      confirmed = null;
    }
    if (getSurfaceCoordinator()?.role !== SURFACE_ROLE.WRITER) return;
    if (confirmed?.outcome === 'success') {
      // The lifecycle diff was transient. A fresh exact observation wins.
      windowLayoutGoneConfirmations.delete(event.windowInstanceId);
      return;
    }
    if (confirmed?.outcome === 'missing') {
      const retired = await retireClosedWindowEverywhere(
        { version: 1, windowInstanceId: event.windowInstanceId },
        { source: 'lifecycle-gone-confirmed', reason: 'the lifecycle close was independently confirmed missing' },
      );
      if (retired) windowLayoutGoneConfirmations.delete(event.windowInstanceId);
    }
    // An outage/timeout is not proof. Keep the seeded positive so the periodic
    // reconciliation remains the bounded recovery path.
    return;
  }
  const result = await windowLayoutAutoTracking.addFromEvent(event);
  if (result?.outcome === 'added' || result?.outcome === 'duplicate'
    || result?.outcome === 'disabled' || result?.outcome === 'suppressed') {
    trackingPendingOpens.delete(event.windowInstanceId);
  } else if (trackingPendingOpens.has(event.windowInstanceId) || trackingPendingOpens.size < 64) {
    const pending = trackingPendingOpens.get(event.windowInstanceId);
    trackingPendingOpens.set(event.windowInstanceId, {
      firstSeenAt: pending?.firstSeenAt ?? Date.now(),
      lastAttemptAt: Date.now(),
      descriptor: event.descriptor ?? pending?.descriptor ?? null,
    });
  }
}
async function drainTrackingLifecycleEvents() {
  if (trackingEventInFlight) return;
  trackingEventInFlight = true;
  try {
    while (trackingEventQueue.length > 0) {
      try {
        await processTrackingLifecycleEvent(trackingEventQueue.shift());
      } catch {
        // One transient IPC/store failure must not strand later eligible opens
        // behind an abandoned queue drain.
      }
    }
  } finally {
    trackingEventInFlight = false;
  }
}

/** Lifecycle pushes are the fast path, but a host may miss a close while its
 * watcher is restarting or while automatic tracking is off. Recheck exact
 * persisted identities as a safety net. Only an explicit `missing` result is
 * destructive; helper outages, timeouts, and ambiguity leave the member in
 * place for a later retry. */
async function reconcileClosedWindowMembers() {
  if (closedWindowReconcileInFlight
    || windowLayoutDetachment.isReadOnly()
    || !hasDocumentWriteAuthority()
    || getSurfaceCoordinator()?.role !== SURFACE_ROLE.WRITER
    || typeof host.resolveWindowInstance !== 'function'
    || typeof host.windowLifecycleSnapshot !== 'function') return;
  const candidates = [];
  const seen = new Set();
  for (const layout of getState().windowLayouts ?? []) {
    for (const member of layout.arrangement?.members ?? []) {
      const instanceId = member.descriptor?.windowInstanceId;
      if (typeof instanceId !== 'string' || seen.has(instanceId)) continue;
      seen.add(instanceId);
      candidates.push(instanceId);
    }
  }
  closedWindowReconcileInFlight = true;
  try {
    // One complete native enumeration answers which saved identities still
    // appear live. Probing every member separately kept the serial helper busy
    // nearly continuously and starved Auto's new-window binding requests.
    const response = await host.windowLifecycleSnapshot().catch(() => null);
    const snapshot = response?.snapshot;
    if (!snapshot || snapshot.complete !== true || !Array.isArray(snapshot.windows)
      || getSurfaceCoordinator()?.role !== SURFACE_ROLE.WRITER) return;
    const live = new Set(snapshot.windows.map((entry) => entry?.windowInstanceId)
      .filter((id) => typeof id === 'string'));
    for (const instanceId of candidates) {
      if (getSurfaceCoordinator()?.role !== SURFACE_ROLE.WRITER) return;
      if (live.has(instanceId)) {
        windowLayoutGoneConfirmations.delete(instanceId);
        continue;
      }
      let result = null;
      try {
        result = await host.resolveWindowInstance(instanceId);
      } catch {
        result = null;
      }
      if (result?.outcome !== 'missing') {
        // Any other answer - including "I could not tell" - clears the count.
        windowLayoutGoneConfirmations.delete(instanceId);
        continue;
      }
      // ONE POSITIVE ANSWER IS NOT ENOUGH. A resolve can report 'missing' for a
      // window that is merely not visible, cloaked, or not yet enumerated, and a
      // single such answer once deleted live members one by one until the layout
      // was empty. Two independent positives, separated by at least one sweep,
      // are required before anything is retired.
      const confirmed = (windowLayoutGoneConfirmations.get(instanceId)?.count ?? 0) + 1;
      if (confirmed < 2) {
        windowLayoutGoneConfirmations.set(instanceId, { count: confirmed, at: Date.now() });
        continue;
      }
      if (getSurfaceCoordinator()?.role !== SURFACE_ROLE.WRITER) return;
      windowLayoutGoneConfirmations.delete(instanceId);
      await retireClosedWindowEverywhere({ version: 1, windowInstanceId: instanceId }, { source: 'periodic-resolve-missing', reason: 'two independent resolutions could not find it' });
    }
    // Retry only opens the watcher actually delivered. A failed one-shot bind
    // no longer loses that window, while startup does not bulk-add old windows.
    let retried = 0;
    for (const [instanceId, pending] of trackingPendingOpens) {
      if (Date.now() - pending.firstSeenAt > 60000) {
        trackingPendingOpens.delete(instanceId);
        continue;
      }
      // A single lifecycle snapshot can omit a still-opening window. Keep the
      // bounded retry alive; the exact resolver itself confirms identity.
      if (Date.now() - pending.lastAttemptAt >= 2000) {
        if (getSurfaceCoordinator()?.role !== SURFACE_ROLE.WRITER) return;
        await processTrackingLifecycleEvent({
          kind: 'open',
          windowInstanceId: instanceId,
          ...(pending.descriptor ? { descriptor: pending.descriptor } : {}),
        });
        if (++retried >= 4) break;
      }
    }
  } finally {
    closedWindowReconcileInFlight = false;
  }
}

function scheduleClosedWindowReconcile() {
  if (closedWindowReconcileTimer !== null) return;
  const tick = () => {
    closedWindowReconcileTimer = null;
    void reconcileClosedWindowMembers().catch(() => undefined).finally(() => {
      if (!windowLayoutDetachment.isStopped()) {
        closedWindowReconcileTimer = window.setTimeout(tick, CLOSED_WINDOW_RECONCILE_INTERVAL_MS);
      }
    });
  };
  closedWindowReconcileTimer = window.setTimeout(tick, CLOSED_WINDOW_RECONCILE_INTERVAL_MS);
}

function stopClosedWindowReconcile() {
  if (closedWindowReconcileTimer !== null) {
    window.clearTimeout(closedWindowReconcileTimer);
    closedWindowReconcileTimer = null;
  }
}

host.onWindowLifecycleEvent?.((event) => {
  const sequence = Number(event?.sequence);
  const sessionChanged = trackingSessionId !== event?.trackerSessionId;
  const gap = !Number.isSafeInteger(sequence) || (trackingLastSequence > 0 && sequence > trackingLastSequence + 1);
  trackingSessionId = typeof event?.trackerSessionId === 'string' ? event.trackerSessionId : trackingSessionId;
  if (Number.isSafeInteger(sequence)) trackingLastSequence = Math.max(trackingLastSequence, sequence);
  if (sessionChanged || gap) void reconcileTrackingBaseline();
  if (trackingEventQueue.length < 64) trackingEventQueue.push(event);
  void drainTrackingLifecycleEvents();
});
host.onWindowLifecycleBaseline?.((baseline) => {
  if (!baseline || baseline.complete !== true || typeof baseline.trackerSessionId !== 'string') return;
  trackingSessionId = baseline.trackerSessionId;
  if (Number.isSafeInteger(baseline.sequence)) trackingLastSequence = baseline.sequence;
  void reconcileTrackingBaseline(baseline);
});


async function reconcileTrackingBaseline(providedSnapshot = null) {
  if (windowLayoutDetachment.isReadOnly() || !hasDocumentWriteAuthority()
    || getSurfaceCoordinator()?.role !== SURFACE_ROLE.WRITER) return;
  const response = providedSnapshot ? null : await host.windowLifecycleSnapshot?.().catch(() => null);
  const snapshot = providedSnapshot ?? response?.snapshot;
  if (!snapshot || snapshot.complete !== true || !Array.isArray(snapshot.windows)) return;
  // A delayed snapshot from an old watcher session must not overwrite a newer
  // baseline or reintroduce opens from that retired session.
  if (trackingSessionId && snapshot.trackerSessionId !== trackingSessionId) return;
  const accepted = await windowLayoutAutoTracking.acceptBaseline(snapshot, async () => {
    // Authority can change while a host snapshot is in flight. Do not consume
    // its lifecycle delta unless this surface can reconcile and commit it.
    if (windowLayoutDetachment.isReadOnly() || !hasDocumentWriteAuthority()
      || getSurfaceCoordinator()?.role !== SURFACE_ROLE.WRITER) return false;
    // A later watcher restart or sequence-gap baseline is a recovery sample,
    // not another startup. Runtime removal requires the two confirmed misses
    // in reconcileClosedWindowMembers instead of one task-list omission.
    if (trackingStartupBaselineReconciled) return true;
    const live = new Set(snapshot.windows.map((entry) => entry?.windowInstanceId).filter((id) => typeof id === 'string'));
    const before = getState();
    let next = reconcileWindowLayoutsAfterStartup(getState(), [...live]);
    const trackingLayout = (next.windowLayouts ?? []).find((entry) => entry.tracking?.enabled === true);
    if (trackingLayout) {
      const suppressed = (trackingLayout.tracking?.suppressedInstanceIds ?? []).filter((id) => live.has(id));
      if (suppressed.length !== (trackingLayout.tracking?.suppressedInstanceIds ?? []).length) {
        next = {
          ...next,
          windowLayouts: next.windowLayouts.map((entry) => entry.id === trackingLayout.id
            ? { ...entry, tracking: { ...entry.tracking, suppressedInstanceIds: suppressed } }
            : entry),
        };
      }
    }
    if (next !== before && !(await store.commit(next))) return false;
    if (next !== before) {
      const after = getState();
      for (const layout of before.windowLayouts ?? []) {
        const nextLayout = (after.windowLayouts ?? []).find((entry) => entry.id === layout.id);
        const removedIds = new Set((layout.arrangement?.members ?? [])
          .filter((member) => !nextLayout?.arrangement?.members?.some((candidate) => candidate.id === member.id))
          .map((member) => member.id));
        for (const memberId of removedIds) {
          const key = windowLayoutMemberKey(layout.id, memberId);
          windowLayoutRuntime.capabilities.delete(key);
          windowLayoutRuntime.icons.delete(key);
          windowLayoutWidgetPreviewCapabilities.delete(key);
        }
        if (removedIds.size > 0 || !nextLayout) {
          if (windowLayoutSelection.repair(layout.id, removedIds, { eraseEmpty: true })) {
            syncWindowLayoutMemberSelection(layout.id);
          }
          setWindowLayoutStatus(layout.id, '');
          noteWindowLayoutCommit(layout.id, { reason: 'startup-window-baseline' });
        }
      }
      windowLayoutMemberPreview.cancel();
      saveWorkspaceView();
      if (before.activeWindowLayoutId !== after.activeWindowLayoutId) {
        await windowLayoutRuntimeController.reconcileActive();
      }
    }
    trackingStartupBaselineReconciled = true;
    return true;
  });
  // Baseline deltas are accepted only after the durable startup reconciliation
  // succeeds. Both lifecycle pushes and recovered opens then share one queue.
  for (const event of accepted.events) trackingEventQueue.push(event);
  if (accepted.events.length) void drainTrackingLifecycleEvents();
}


async function populateTrackingLayout(layoutId) {
  if (trackingPopulateInFlight) return;
  trackingPopulateInFlight = true;
  try {
    await populateTrackingLayoutCore(layoutId);
  } catch {
    // The periodic lifecycle sweep will retry live windows. A transient
    // helper or writer failure must not strand the one Auto owner.
    setWindowLayoutStatus(layoutId, 'Auto Add is preparing; it will retry.');
  } finally {
    trackingPopulateInFlight = false;
  }
}

async function populateTrackingLayoutCore(layoutId) {
  const layout = windowLayoutFromState(layoutId);
  if (!layout || layout.tracking?.enabled !== true) return;
  const listed = await host.windowCandidates({ includeNativeIcons: false });
  if (listed.outcome !== 'success') {
    setWindowLayoutStatus(layoutId, windowLayoutStatusForOutcome(listed.outcome));
    return;
  }
  let added = 0;
  for (const candidate of listed.candidates ?? []) {
    if (getSurfaceCoordinator()?.role !== SURFACE_ROLE.WRITER) return;
    const currentLayout = windowLayoutFromState(layoutId);
    if (!currentLayout || currentLayout.tracking?.enabled !== true) return;
    const currentIds = new Set((currentLayout.arrangement?.members ?? [])
      .map((member) => member.descriptor?.windowInstanceId)
      .filter((value) => typeof value === 'string'));
    const currentSuppressed = new Set(currentLayout.tracking?.suppressedInstanceIds ?? []);
    if (typeof candidate.windowInstanceId === 'string'
      && (currentIds.has(candidate.windowInstanceId) || currentSuppressed.has(candidate.windowInstanceId))) continue;
    const bound = await host.bindWindowCandidate(candidate.id);
    if (bound.outcome !== 'success') continue;
    const instanceId = bound.descriptor?.windowInstanceId;
    if (typeof instanceId !== 'string' || currentIds.has(instanceId) || currentSuppressed.has(instanceId)) continue;
    const observed = await host.observeWindowCapability(bound.capability);
    if (observed.outcome !== 'success') continue;
    const latestLayout = windowLayoutFromState(layoutId);
    if (!latestLayout || latestLayout.tracking?.enabled !== true) return;
    const latestIds = new Set((latestLayout.arrangement?.members ?? [])
      .map((member) => member.descriptor?.windowInstanceId)
      .filter((value) => typeof value === 'string'));
    if (latestIds.has(instanceId) || latestLayout.tracking?.suppressedInstanceIds?.includes(instanceId)) continue;
    const member = {
      id: crypto.randomUUID(),
      descriptor: bound.descriptor,
      bounds: observed.observation?.bounds ?? null,
      state: observed.observation?.state === 'minimized' ? 'minimized' : 'normal',
    };
    const next = addWindowLayoutMember(getState(), layoutId, member);
    if (next === getState()) continue;
    if (!(await store.commit(next))) continue;
    windowLayoutRuntime.capabilities.set(windowLayoutMemberKey(layoutId, member.id), bound.capability);
    added += 1;
  }
  if (added === 0) return;
  saveWorkspaceView();
  noteWindowLayoutCommit(layoutId);
  await windowLayoutRecording.ensureRecording(layoutId);
}

async function handleWindowLayoutTrackingToggle(layoutId) {
  if (windowLayoutDetachment.isReadOnly()) return false;
  const layout = windowLayoutFromState(layoutId);
  if (!layout) return false;
  const nextEnabled = layout.tracking?.enabled !== true;
  const next = setWindowLayoutTracking(getState(), layoutId, nextEnabled);
  const persisted = await store.commit(next);
  if (!persisted) return false;
  saveWorkspaceView();
  noteWindowLayoutCommit(layoutId);
  // A newly-enabled owner gets a fresh baseline; disabling only stops future
  // additions and deliberately keeps its current members.
  if (nextEnabled) {
    void windowLayoutRecording.ensureRecording(layoutId);
    void populateTrackingLayout(layoutId);
  }
  return true;
}


return { process: processTrackingLifecycleEvent, reconcile: reconcileClosedWindowMembers,
  schedule: scheduleClosedWindowReconcile, stop: stopClosedWindowReconcile,
  baseline: reconcileTrackingBaseline, populate: populateTrackingLayout,
  toggle: handleWindowLayoutTrackingToggle };
}

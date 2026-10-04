/** Workspace list/direct picker orchestration; existing runtime fields and writer remain authoritative. */
import { openWindowLayoutPickerSession, toWindowLayoutPickerRows } from './window-layout-picker-session.js';
import { windowLayoutCandidateIsMember, windowLayoutPickMemberDescriptors } from './window-layout-membership.js';
export function createWindowLayoutWorkspacePicker({
  host, windowLayoutRuntime, windowLayoutDetachment, windowLayoutMemberPreview,
  windowLayoutFromState, setWindowLayoutStatus, setWindowLayoutTransientStatus,
  windowLayoutStatusForOutcome, closeWindowLayoutCandidate, handleWindowLayoutPickCandidate,
  restoreHoveredWindowLayoutPreview, document, CSS, applyWindowLayoutPickSet,
  crypto = globalThis.crypto, console = globalThis.console,
}) {
async function openWindowLayoutPicker(layoutId) {
  if (windowLayoutRuntime.pickerOpenFor === layoutId) {
    // A native chooser can disappear independently (focus loss, renderer
    // restart, or a failed IPC response). Re-entering the list control is an
    // explicit recovery request; clear the stale session instead of leaving
    // this layout permanently unable to open its picker.
    closeWindowLayoutPicker();
  }
  // 019G: a picker covering the desktop must clear/discard the hover preview.
  windowLayoutMemberPreview.cancel();
  const generation = ++windowLayoutRuntime.pickerGeneration;
  windowLayoutRuntime.pickerOpenFor = layoutId;
  try {
    while (windowLayoutRuntime.pickerOpenFor === layoutId
      && windowLayoutRuntime.pickerGeneration === generation) {
      const pickerId = crypto.randomUUID();
      const isCurrent = () => !windowLayoutDetachment.isReadOnly()
        && windowLayoutRuntime.pickerOpenFor === layoutId
        && windowLayoutRuntime.pickerGeneration === generation;
      let session;
      if (typeof host.windowCandidatePickerUpdate === 'function') {
        session = await openWindowLayoutPickerSession({
          pickerId,
          openPicker: (id) => host.windowCandidatePicker([], id),
          loadCandidates: () => host.windowCandidates({ includeNativeIcons: false }),
          updatePicker: (candidates, id) => {
            const rows = toWindowLayoutPickerRows(
              candidates,
              windowLayoutFromState(layoutId)?.arrangement?.members ?? [],
              windowLayoutCandidateIsMember,
            );
            return host.windowCandidatePickerUpdate(rows, id);
          },
          isCurrent,
        });
      } else {
        const result = await host.windowCandidates({ includeNativeIcons: false });
        if (!isCurrent()) return;
        const members = windowLayoutFromState(layoutId)?.arrangement?.members ?? [];
        session = result.outcome === 'success'
          ? { outcome: 'success', candidates: result.candidates, actionPromise: host.windowCandidatePicker(
            toWindowLayoutPickerRows(result.candidates, members, windowLayoutCandidateIsMember),
          ) }
          : { outcome: 'list-error', error: result.error ?? result.outcome, candidates: [] };
      }
      if (!isCurrent() || session.outcome === 'stale') return;
      if (session.outcome === 'list-error' || session.outcome === 'picker-error' || session.outcome === 'update-error') {
        const error = session.error;
        setWindowLayoutStatus(layoutId, error instanceof Error ? error.message
          : (typeof error === 'string' ? error : windowLayoutStatusForOutcome(error?.outcome ?? 'helper-unavailable')));
        break;
      }
      windowLayoutRuntime.pickerCandidates = session.candidates;
      const picked = session.outcome === 'action' ? session.action : await session.actionPromise;
      if (!isCurrent()) return;
      if (picked?.action === 'close' && picked.candidateId) {
        await closeWindowLayoutCandidate(layoutId, picked.candidateId, session.candidates);
        continue;
      }
      if (picked?.action === 'direct-pick') {
        await beginWindowLayoutDirectPick(layoutId);
        break;
      }
      if (picked?.action !== 'select' || !picked.candidateId) break;
      await handleWindowLayoutPickCandidate(layoutId, picked.candidateId);
    }
  } catch (error) {
    // The list request may still be in flight when the creator clicks the
    // picker control again to enter live-pick mode.  Its eventual timeout is
    // stale at that point; never let it overwrite the live-pick status.
    if (windowLayoutRuntime.pickerOpenFor !== layoutId
      || windowLayoutRuntime.pickerGeneration !== generation) return;
    setWindowLayoutTransientStatus(
      layoutId,
      error instanceof Error ? error.message : 'List unavailable',
    );
  } finally {
    if (windowLayoutRuntime.pickerOpenFor === layoutId
      && windowLayoutRuntime.pickerGeneration === generation) closeWindowLayoutPicker();
  }
}

function closeWindowLayoutPicker({ requireClosed = false } = {}) {
  const layoutId = windowLayoutRuntime.pickerOpenFor;
  windowLayoutRuntime.pickerOpenFor = null;
  windowLayoutRuntime.pickerGeneration += 1;
  const closeRequest = layoutId
    ? (requireClosed
      ? host.windowCandidatePickerClose()
      : host.windowCandidatePickerClose().catch(() => undefined))
    : Promise.resolve();
  windowLayoutRuntime.pickerCandidates = null;
  const pickerHost = layoutId
    ? document.querySelector(`[data-wl-picker="${CSS.escape(layoutId)}"]`)
    : null;
  if (pickerHost) pickerHost.innerHTML = '';
  restoreHoveredWindowLayoutPreview(layoutId);
  return closeRequest;
}

async function beginWindowLayoutDirectPick(layoutId) {
  console.info('[045-direct-pick] begin-enter', layoutId);
  if (windowLayoutDetachment.isReadOnly()) return;
  const layout = windowLayoutFromState(layoutId);
  if (!layout) return;
  // 019G: the pick overlay covers the desktop; clear/discard the hover preview.
  windowLayoutMemberPreview.cancel();
  // The chooser is a native always-on-top window. Do not race its asynchronous
  // destruction against the Papers-owned direct picker: until it is gone it
  // can retain foreground/ownership and make the picker appear to do nothing.
  try {
    await closeWindowLayoutPicker({ requireClosed: true });
  } catch (error) {
    setWindowLayoutStatus(layoutId, error instanceof Error ? error.message : 'Window list could not close');
    return;
  }
  const members = windowLayoutPickMemberDescriptors(
    (layout.arrangement?.members ?? []).map((member) => member.descriptor),
  );
  if (!members) {
    setWindowLayoutStatus(layoutId, 'A saved window identity is invalid; Direct Pick could not start.');
    return;
  }
  windowLayoutRuntime.pickLayoutId = layoutId;
  const pickAttempt = Symbol('window-layout-direct-pick');
  windowLayoutRuntime.pickAttempt = pickAttempt;
  let result = null;
  let pickUnsubscribe = null;
  try {
    // A renderer reload or an abandoned picker can leave the Papers-owned
    // session alive after this page has lost its result listener. Always
    // cancel that one-shot session first so clicking Direct Pick is itself
    // the recovery action. Cancelling an idle session is intentionally a
    // no-op.
    await host.pickWindowCancel();
    // 016R: subscribe to the result push BEFORE awaiting begin, so a pick
    // that completes while begin() is still resolving (immediate click on an
    // eligible window) is never missed. A failed begin removes the listener
    // again; the main-side session clears onResult on failure, so nothing
    // can deliver afterwards.
    console.info('[045-direct-pick] begin-request', layoutId, members.length);
    const beginPromise = host.pickWindowBegin(members);
    const pickPromise = new Promise((resolve) => {
      pickUnsubscribe = host.onPickResult(resolve);
      windowLayoutRuntime.pickUnsubscribe = pickUnsubscribe;
    });
    const begin = await beginPromise;
    console.info('[045-direct-pick] begin-result', layoutId, begin?.outcome, begin?.error ?? '');
    // 018X4: abort immediately after the begin await, before the failure status.
    if (windowLayoutDetachment.isReadOnly()) {
      pickUnsubscribe?.();
      if (windowLayoutRuntime.pickUnsubscribe === pickUnsubscribe) {
        windowLayoutRuntime.pickUnsubscribe = null;
      }
      return;
    }
    if (begin.outcome !== 'started') {
      pickUnsubscribe?.();
      if (windowLayoutRuntime.pickUnsubscribe === pickUnsubscribe) {
        windowLayoutRuntime.pickUnsubscribe = null;
      }
      setWindowLayoutStatus(layoutId, begin.error || 'Direct pick is unavailable');
      return;
    }
    result = await pickPromise;
    // 018X4: abort immediately after the result, before success OR failure
    // handling (the non-picked status must never fire post-handoff).
    if (windowLayoutDetachment.isReadOnly()) return;
  } catch (error) {
    console.error('[045-direct-pick] begin-error', String(error));
    pickUnsubscribe?.();
    if (windowLayoutRuntime.pickUnsubscribe === pickUnsubscribe) {
      windowLayoutRuntime.pickUnsubscribe = null;
    }
    if (windowLayoutDetachment.isReadOnly()) return;
    setWindowLayoutStatus(
      layoutId,
      error instanceof Error ? error.message : String(error || 'Direct pick is unavailable'),
    );
    return;
  } finally {
    pickUnsubscribe?.();
    if (windowLayoutRuntime.pickUnsubscribe === pickUnsubscribe) {
      windowLayoutRuntime.pickUnsubscribe = null;
    }
    if (windowLayoutRuntime.pickAttempt === pickAttempt) {
      windowLayoutRuntime.pickAttempt = null;
      windowLayoutRuntime.pickLayoutId = null;
    }
  }
  // 019C: Winter's pick session returns ONE typed committed set (Enter) or a
  // zero-mutation cancel (Escape). Every remove is applied data-only and every
  // successful add is bound, all persisted ONCE by the pick applier; the active
  // layout identity is preserved and the one recording controller continues.
  if (result.outcome === 'cancelled') {
    setWindowLayoutStatus(layoutId, '');
    return;
  }
  if (result.outcome !== 'committed') {
    setWindowLayoutStatus(layoutId, result.error || 'Pick failed');
    return;
  }
  // 018X1R: after awaited pick/host work, re-check the read-only handoff so an
  // in-flight pick result can never mutate post-handoff state.
  if (windowLayoutDetachment.isReadOnly()) return;
  await applyWindowLayoutPickSet(layoutId, result);
}

function cancelWindowLayoutPick() {
  windowLayoutRuntime.pickUnsubscribe?.();
  windowLayoutRuntime.pickUnsubscribe = null;
  // 018X1R: return the host cancel promise so the handoff AWAITS the pick
  // cancel before controller stop/flush/ACK (a late pick result must not
  // overtake the handoff).
  return host.pickWindowCancel().catch(() => undefined);
}

function handleKeydown(event) {
  if (event.key === 'Escape' && windowLayoutRuntime.pickUnsubscribe) {
    event.preventDefault();
    event.stopPropagation();
    void cancelWindowLayoutPick();
    return true;
  }
  if (windowLayoutRuntime.pickUnsubscribe) {
    event.preventDefault();
    event.stopPropagation();
    const layoutId = windowLayoutRuntime.pickLayoutId;
    const request = host.pickWindowCommit();
    void request.catch((error) => setWindowLayoutStatus(
      layoutId ?? 'active',
      error instanceof Error ? error.message : String(error),
    ));
    return true;
  }
  if (event.key === 'Escape' && windowLayoutRuntime.pickerOpenFor) {
    closeWindowLayoutPicker();
    return true;
  }
  return false;
}

function handleDocumentClick(event) {
  if (!windowLayoutRuntime.pickerOpenFor || event.target.closest('[data-wl-picker]')) return false;
  closeWindowLayoutPicker();
  return true;
}


return {
  open: openWindowLayoutPicker,
  close: closeWindowLayoutPicker,
  direct: beginWindowLayoutDirectPick,
  cancel: cancelWindowLayoutPick,
  keydown: handleKeydown,
  documentClick: handleDocumentClick,
};
}

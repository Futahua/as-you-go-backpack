/** Widget list/direct picker lifecycle. Commands await the existing workspace writer; no local persistence. */
import { openWindowLayoutPickerSession, toWindowLayoutPickerRows } from './window-layout-picker-session.js';
import { windowLayoutCandidateIsMember, windowLayoutPickMemberDescriptors, windowLayoutPickForBoundCandidate, windowLayoutHasValidInstanceId, windowDescriptorIdentityRelation } from './window-layout-membership.js';
export function createWindowLayoutWidgetPicker({
  host, widgetState, windowLayoutRuntime, client, layoutId, windowLayoutMemberPreview,
  setWindowLayoutStatus, closeWindowLayoutCandidate, restoreHoveredWindowLayoutPreview,
  elements, CSS, bindWindowLayoutPickerCandidate, crypto = globalThis.crypto,
  isPeekMode = () => false, endPeek = async () => {}, activateMember,
}) {
  let widgetPickerOpen = false;
  let widgetPickerGeneration = 0;
  async function openWidgetPicker() {
    if (widgetPickerOpen) {
      // A native chooser can disappear independently. Re-entering the list
      // control is an explicit recovery request: invalidate the old attempt
      // before starting a fresh one so its late reply cannot mutate this
      // widget or leave the control permanently inert.
      closeWidgetPicker();
    }
    const generation = ++widgetPickerGeneration;
    widgetPickerOpen = true;
    const ownsPicker = () => widgetPickerOpen && widgetPickerGeneration === generation;
    // 019G: a picker covering the desktop must clear/discard the hover preview.
    windowLayoutMemberPreview.cancel();
    try {
      await endPeek();
      if (!ownsPicker()) return;
      while (true) {
        const pickerId = crypto.randomUUID();
        let session;
        if (typeof host.windowCandidatePickerUpdate === 'function') {
          session = await openWindowLayoutPickerSession({
            pickerId,
            openPicker: (id) => host.windowCandidatePicker([], id),
            loadCandidates: () => host.windowCandidates({ includeNativeIcons: false }),
            updatePicker: (candidates, id) => host.windowCandidatePickerUpdate(toWindowLayoutPickerRows(
              candidates, widgetState.snapshot.members ?? [], windowLayoutCandidateIsMember,
            ), id),
            isCurrent: ownsPicker,
          });
        } else {
          const result = await host.windowCandidates({ includeNativeIcons: false });
          if (!ownsPicker()) return;
          session = result.outcome === 'success'
            ? { outcome: 'success', candidates: result.candidates, actionPromise: host.windowCandidatePicker(
              toWindowLayoutPickerRows(result.candidates, widgetState.snapshot.members ?? [], windowLayoutCandidateIsMember),
            ) }
            : { outcome: 'list-error', error: result.error || 'List unavailable', candidates: [] };
        }
        if (!ownsPicker() || session.outcome === 'stale') return;
        if (session.outcome === 'list-error' || session.outcome === 'picker-error' || session.outcome === 'update-error') {
          const error = session.error;
          setWindowLayoutStatus(layoutId, error instanceof Error ? error.message
            : (typeof error === 'string' ? error : 'List unavailable'));
          break;
        }
        widgetState.candidates = session.candidates;
        // The chooser stays open while searching/selecting. Recompute its
        // presentation state after every authoritative command acknowledgement.
        const picked = session.outcome === 'action' ? session.action : await session.actionPromise;
        if (!ownsPicker()) return;
        if (picked?.action === 'close' && picked.candidateId) {
          await closeWindowLayoutCandidate(layoutId, picked.candidateId, session.candidates);
          if (!ownsPicker()) return;
          continue;
        }
        if (picked?.action === 'direct-pick') {
          await beginWidgetDirectPick();
          break;
        }
        if (picked?.action !== 'select' || !picked.candidateId) break;
        await handleWidgetListCandidate(picked.candidateId);
        if (!ownsPicker()) return;
      }
    } catch (error) {
      if (!ownsPicker()) return;
      setWindowLayoutStatus(layoutId, error instanceof Error ? error.message : String(error));
    } finally {
      if (ownsPicker()) closeWidgetPicker();
    }
  }

  function closeWidgetPicker({ requireClosed = false } = {}) {
    widgetState.candidates = null;
    const pickerHost = elements.grid.querySelector(`[data-wl-picker="${CSS.escape(layoutId)}"]`);
    // A direct-pick click comes from the normal widget card, where the list
    // picker is not open. Do not issue a host dismiss request for a picker
    // that does not exist: an unanswered dismiss used to block live-pick for
    // the full bridge timeout and make every widget button appear inert.
    const wasOpen = widgetPickerOpen || Boolean(pickerHost?.innerHTML);
    // Invalidate synchronously, before awaiting the native dismiss request;
    // a late chooser response or a later finally block must not touch the
    // retired attempt or issue a duplicate close.
    widgetPickerOpen = false;
    widgetPickerGeneration += 1;
    if (pickerHost) pickerHost.innerHTML = '';
    restoreHoveredWindowLayoutPreview(layoutId);
    if (!wasOpen) return Promise.resolve();
    return requireClosed
      ? host.windowCandidatePickerClose()
      : host.windowCandidatePickerClose().catch(() => undefined);
  }

  async function handleWidgetListCandidate(candidateId, intent = 'toggle') {
    // Oct 2 regression guard: the a123d8f merge accidentally resolved this
    // conflict to the old Sep 24 path and discarded the exact row that the
    // working Oct 1 implementation carried across the native chooser await.
    // Candidate ids are deliberately short-lived; retaining the row is what
    // lets bindWindowLayoutPickerCandidate perform its bounded relist/rebind
    // recovery if that id expired while the creator was clicking it.
    const row = (widgetState.candidates ?? []).find((candidate) => candidate.id === candidateId);
    if (!row) return false;
    const picked = await bindWindowLayoutPickerCandidate(candidateId, row);
    const bound = picked.bound;
    if (bound.outcome !== 'success') {
      setWindowLayoutStatus(layoutId, bound.error || 'Pick failed');
      return false;
    }
    // Candidate current-state is presentation-only: it has no persisted
    // executable fingerprint. After bind, exact descriptor identity decides
    // whether this candidate is an add or a removal.
    const pick = windowLayoutPickForBoundCandidate(
      widgetState.snapshot.members ?? [],
      bound,
      picked.row,
  );
  if (!pick) {
    setWindowLayoutStatus(layoutId, windowLayoutHasValidInstanceId(bound.descriptor)
      ? 'Window identity could not be confirmed; no layout change was made.'
      : 'Window identity is unavailable; no layout change was made.');
      return false;
    }
    if (intent === 'remove' && pick.removes.length === 0) return false;
    const command = { kind: 'picker-commit', pick };
    let acknowledgement = await client.sendCommandAndWait(command, { timeoutMs: 30000 });
    if (acknowledgement?.type === 'stale') {
      acknowledgement = await client.sendCommandAndWait(command, { timeoutMs: 30000 });
    }
    if (acknowledgement?.type === 'error') {
      setWindowLayoutStatus(layoutId, acknowledgement.message || acknowledgement.code || 'Pick failed');
      return false;
    }
    if (isPeekMode() && pick.adds.length > 0) {
      if (acknowledgement?.type !== 'committed') {
        setWindowLayoutStatus(layoutId, 'Window addition was not confirmed. Try again.');
        return false;
      }
      // Retire the chooser before activation so its close cannot take focus
      // back from the newly added window. The existing workspace owns the add.
      await closeWidgetPicker({ requireClosed: true });
      const member = acknowledgement.snapshot?.members?.find(candidate =>
        windowDescriptorIdentityRelation(candidate.descriptor, bound.descriptor)==='same');
      if (!member || typeof activateMember !== 'function') {
        setWindowLayoutStatus(layoutId, 'Window added, but its control was not confirmed.');
        return false;
      }
      await activateMember(member.id);
    }
    return true;
  }

  async function beginWidgetDirectPick() {
    // 019G: the pick overlay covers the desktop; clear/discard the hover preview.
    windowLayoutMemberPreview.cancel();
    // Mirror the attached surface's per-attempt token. A second click
    // supersedes the first BEFORE any awaited chooser/cancel/begin work can
    // resume and mutate status or shared picker ownership.
    const pickAttempt = Symbol('window-layout-widget-direct-pick');
    widgetState.pickAttempt = pickAttempt;
    // As on the attached surface, the native chooser must be fully destroyed
    // before starting the direct picker or it can steal picker ownership.
    try {
      await closeWidgetPicker({ requireClosed: true });
    } catch (error) {
      if (widgetState.pickAttempt === pickAttempt) {
        widgetState.pickAttempt = null;
        setWindowLayoutStatus(layoutId, error instanceof Error ? error.message : 'Window list could not close');
      }
      return;
    }
    if (widgetState.pickAttempt !== pickAttempt) return;
    const members = windowLayoutPickMemberDescriptors(
      (widgetState.snapshot.members ?? []).map((member) => member.descriptor),
    );
    if (!members) {
      if (widgetState.pickAttempt === pickAttempt) widgetState.pickAttempt = null;
      setWindowLayoutStatus(layoutId, 'A saved window identity is invalid; Direct Pick could not start.');
      return;
    }
    windowLayoutRuntime.pickLayoutId = layoutId;
    let pickUnsubscribe = null;
    try {
      // Recover an orphaned main-process picker before starting this widget's
      // fresh one-shot session. This also makes a second click a clean restart.
      await host.pickWindowCancel();
      if (widgetState.pickAttempt !== pickAttempt) return;
      // Subscribe to the result push BEFORE awaiting begin, so an immediate
      // pick never misses its result (016R pattern).
      const beginPromise = host.pickWindowBegin(members);
      const pickPromise = new Promise((resolve) => {
        pickUnsubscribe = host.onPickResult(resolve);
        widgetState.pickUnsubscribe = pickUnsubscribe;
      });
      const begin = await beginPromise;
      if (widgetState.pickAttempt !== pickAttempt) return;
      if (begin.outcome !== 'started') {
        pickUnsubscribe?.();
        if (widgetState.pickUnsubscribe === pickUnsubscribe) {
          widgetState.pickUnsubscribe = null;
        }
        setWindowLayoutStatus(layoutId, begin.error || 'Direct pick is unavailable');
        return;
      }
      const result = await pickPromise;
      if (widgetState.pickAttempt !== pickAttempt) return;
      if (result.outcome === 'failed') {
        setWindowLayoutStatus(layoutId, result.error || 'Pick failed');
        return;
      }
      if (result.outcome !== 'committed') return;
      // Winter's one typed committed set goes to the WORKSPACE writer; the
      // widget never applies it locally. Wait for the authoritative result so
      // a missing writer or a revision race cannot silently drop the pick.
      let acknowledgement = await client.sendCommandAndWait(
        { kind: 'picker-commit', pick: result },
        { timeoutMs: 30000 },
      );
      if (widgetState.pickAttempt !== pickAttempt) return;
      if (acknowledgement?.type === 'stale') {
        acknowledgement = await client.sendCommandAndWait(
          { kind: 'picker-commit', pick: result },
          { timeoutMs: 30000 },
        );
        if (widgetState.pickAttempt !== pickAttempt) return;
      }
      if (acknowledgement?.type === 'error') {
        setWindowLayoutStatus(
          layoutId,
          acknowledgement.message || acknowledgement.code || 'Pick failed',
        );
      }
    } catch (error) {
      pickUnsubscribe?.();
      if (widgetState.pickUnsubscribe === pickUnsubscribe) {
        widgetState.pickUnsubscribe = null;
      }
      if (widgetState.pickAttempt !== pickAttempt) return;
      setWindowLayoutStatus(
        layoutId,
        error instanceof Error ? error.message : String(error || 'Direct pick is unavailable'),
      );
    } finally {
      pickUnsubscribe?.();
      if (widgetState.pickUnsubscribe === pickUnsubscribe) {
        widgetState.pickUnsubscribe = null;
      }
      if (widgetState.pickAttempt === pickAttempt) {
        widgetState.pickAttempt = null;
        if (windowLayoutRuntime.pickLayoutId === layoutId) {
          windowLayoutRuntime.pickLayoutId = null;
        }
      }
    }
  }


  return { open: openWidgetPicker, close: closeWidgetPicker,
    candidate: handleWidgetListCandidate, direct: beginWidgetDirectPick };
}

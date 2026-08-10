/**
 * Pure runtime orchestration for window layouts.
 *
 * The controller owns ephemeral capabilities, switching generations,
 * observation and echo suppression. Persistence, host calls and rendering are
 * injected so this module cannot write workspace state or create UI by itself.
 */

export const WINDOW_LAYOUT_RUNTIME_CADENCE_MS = 500;

function memberKey(layoutId, memberId) {
  return `${layoutId}\u0000${memberId}`;
}

function sameBounds(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function sameState(expected, actual) {
  const expectedMinimized = expected === 'minimized';
  const actualMinimized = actual === 'minimized';
  return expectedMinimized === actualMinimized;
}

function outcomeFor(result, fallback = 'failed') {
  return result && typeof result.outcome === 'string' ? result.outcome : fallback;
}

function layoutMembers(layout) {
  return layout?.arrangement?.members ?? [];
}

export function createWindowLayoutRuntime({
  getLayout,
  host,
  persistActiveLayout,
  persistObservation = () => undefined,
  onMemberResult = () => undefined,
  setIntervalFn = globalThis.setInterval,
  clearIntervalFn = globalThis.clearInterval,
  cadenceMs = WINDOW_LAYOUT_RUNTIME_CADENCE_MS,
}) {
  if (typeof getLayout !== 'function') throw new TypeError('getLayout is required');
  if (!host || typeof host.resolveWindowDescriptor !== 'function'
    || typeof host.observeWindowCapability !== 'function'
    || typeof host.applyWindowCapability !== 'function'
    || typeof host.minimizeWindowCapability !== 'function'
    || typeof host.restoreWindowCapability !== 'function') {
    throw new TypeError('complete window capability host is required');
  }
  if (typeof persistActiveLayout !== 'function') throw new TypeError('persistActiveLayout is required');

  let generation = 0;
  let activeLayoutId = null;
  let activeMembers = [];
  let timer = null;
  let observationPending = false;
  let switchTail = Promise.resolve();
  const capabilities = new Map();
  const suppressions = new Map();

  function isCurrent(layoutId, expectedGeneration) {
    return activeLayoutId === layoutId && generation === expectedGeneration;
  }

  function stopTimer() {
    if (timer !== null) {
      clearIntervalFn(timer);
      timer = null;
    }
    activeMembers = [];
    observationPending = false;
  }

  function clearRuntimeState() {
    stopTimer();
    capabilities.clear();
    suppressions.clear();
  }

  function report(layoutId, memberId, result) {
    const typed = {
      layoutId,
      memberId,
      outcome: outcomeFor(result),
      ...(result?.error !== undefined ? { error: result.error } : {}),
    };
    onMemberResult(typed);
    return typed;
  }

  async function applyMember(layoutId, member, expectedGeneration) {
    if (generation !== expectedGeneration) return report(layoutId, member.id, { outcome: 'superseded' });
    const resolved = await host.resolveWindowDescriptor(member.descriptor);
    if (generation !== expectedGeneration) return report(layoutId, member.id, { outcome: 'superseded' });
    if (resolved.outcome !== 'success' || !resolved.capability) {
      return report(layoutId, member.id, resolved);
    }

    const capabilityKey = memberKey(layoutId, member.id);
    capabilities.set(capabilityKey, resolved.capability);
    suppressions.set(capabilityKey, {
      generation: expectedGeneration,
      bounds: member.bounds,
      state: member.state,
    });

    if (member.bounds) {
      const applied = await host.applyWindowCapability(resolved.capability, member.bounds);
      if (generation !== expectedGeneration) return report(layoutId, member.id, { outcome: 'superseded' });
      if (applied.outcome !== 'success') {
        suppressions.delete(capabilityKey);
        return report(layoutId, member.id, applied);
      }
    }

    const changed = member.state === 'minimized'
      ? await host.minimizeWindowCapability(resolved.capability)
      : await host.restoreWindowCapability(resolved.capability);
    if (generation !== expectedGeneration) return report(layoutId, member.id, { outcome: 'superseded' });
    if (changed.outcome !== 'success') {
      suppressions.delete(capabilityKey);
      return report(layoutId, member.id, changed);
    }
    return report(layoutId, member.id, { outcome: 'success' });
  }

  function startTimer(layoutId, expectedGeneration, memberIds) {
    activeMembers = [...memberIds];
    if (activeMembers.length === 0 || !isCurrent(layoutId, expectedGeneration)) return;
    timer = setIntervalFn(() => { void observeActiveMembers(layoutId, expectedGeneration); }, cadenceMs);
  }

  async function runSwitch(layoutId, expectedGeneration) {
    if (generation !== expectedGeneration) return { outcome: 'superseded', layoutId, results: [] };
    const target = layoutId === null ? null : getLayout(layoutId);
    if (layoutId !== null && (!target || target.bin)) {
      // A binned/removed layout is never activated: applying its saved
      // arrangement could move windows that no longer belong to a live layout.
      return { outcome: 'missing-layout', layoutId, results: [] };
    }
    stopTimer();
    suppressions.clear();
    await persistActiveLayout(layoutId);
    if (generation !== expectedGeneration) return { outcome: 'superseded', layoutId, results: [] };
    activeLayoutId = layoutId;
    if (layoutId === null) {
      capabilities.clear();
      return { outcome: 'inactive', layoutId: null, results: [] };
    }

    const results = [];
    const successful = [];
    for (const member of layoutMembers(getLayout(layoutId))) {
      const result = await applyMember(layoutId, member, expectedGeneration);
      results.push(result);
      if (result.outcome === 'success') successful.push(member.id);
      if (generation !== expectedGeneration) {
        return { outcome: 'superseded', layoutId, results };
      }
    }
    // The selected id is retained even when every member is currently missing,
    // allowing a later retry/reconcile to recover without inventing a launch.
    startTimer(layoutId, expectedGeneration, successful);
    return {
      outcome: successful.length === results.length ? 'success' : 'partial',
      layoutId,
      results,
      recordingMemberIds: successful,
    };
  }

  function switchTo(layoutId) {
    const expectedGeneration = ++generation;
    stopTimer();
    const next = switchTail.then(() => runSwitch(layoutId, expectedGeneration));
    switchTail = next.catch(() => undefined);
    return next;
  }

  async function observeMember(layoutId, memberId, expectedGeneration) {
    if (!isCurrent(layoutId, expectedGeneration)) return { outcome: 'superseded' };
    const capability = capabilities.get(memberKey(layoutId, memberId));
    if (!capability) return { outcome: 'missing-capability' };
    const observed = await host.observeWindowCapability(capability);
    if (!isCurrent(layoutId, expectedGeneration)) return { outcome: 'superseded' };
    if (observed.outcome !== 'success' || !observed.observation) {
      return report(layoutId, memberId, observed);
    }
    const observation = observed.observation;
    const key = memberKey(layoutId, memberId);
    const suppression = suppressions.get(key);
    if (suppression && suppression.generation === expectedGeneration) {
      suppressions.delete(key);
      if ((suppression.bounds === null || sameBounds(suppression.bounds, observation.bounds))
        && sameState(suppression.state, observation.state)) {
        return { layoutId, memberId, outcome: 'echo-suppressed' };
      }
    }
    const patch = {
      state: observation.state === 'minimized' ? 'minimized' : 'normal',
      // A minimized rectangle is not a restore rectangle. The injected model
      // callback therefore receives no bounds and must preserve the old one.
      ...(observation.state === 'minimized' ? {} : { bounds: observation.bounds ?? null }),
    };
    persistObservation(layoutId, memberId, patch);
    return { layoutId, memberId, outcome: 'recorded', patch };
  }

  async function observeActiveMembers(layoutId = activeLayoutId, expectedGeneration = generation) {
    if (observationPending || !isCurrent(layoutId, expectedGeneration)) return [];
    const layout = getLayout(layoutId);
    if (!layout || layout.bin) {
      // 017I2: the active layout was binned/deleted through the model (which
      // already cleared the persisted id). Stop the recording timer so no
      // stale observer survives; the persisted clearing is the model's job.
      clearRuntimeState();
      activeLayoutId = null;
      return [];
    }
    observationPending = true;
    try {
      const results = [];
      for (const memberId of [...activeMembers]) {
        results.push(await observeMember(layoutId, memberId, expectedGeneration));
        if (!isCurrent(layoutId, expectedGeneration)) break;
      }
      return results;
    } finally {
      observationPending = false;
    }
  }

  async function retry(layoutId = activeLayoutId) {
    return switchTo(layoutId);
  }

  /** 017I2: re-sync the observed member set from the CURRENT persisted layout
   * WITHOUT re-applying saved geometry (a member was added or removed while the
   * layout stayed active). A binned/removed active layout delegates to
   * switchTo(null); with zero live capabilities the timer is left off but the
   * id is retained for a later retry. Never writes state itself. */
  async function reconcileActive() {
    const expectedGeneration = generation;
    const layoutId = activeLayoutId;
    if (layoutId === null) return { outcome: 'inactive', layoutId: null, results: [] };
    if (generation !== expectedGeneration) return { outcome: 'superseded', layoutId, results: [] };
    const layout = getLayout(layoutId);
    if (!layout || layout.bin) return switchTo(null);
    stopTimer();
    const successful = [];
    for (const member of layoutMembers(layout)) {
      const key = memberKey(layoutId, member.id);
      let capability = capabilities.get(key);
      if (!capability) {
        const resolved = await host.resolveWindowDescriptor(member.descriptor);
        if (generation !== expectedGeneration) return { outcome: 'superseded', layoutId, results: [] };
        if (resolved.outcome === 'success' && resolved.capability) {
          capability = resolved.capability;
          capabilities.set(key, capability);
        }
      }
      if (capability) successful.push(member.id);
    }
    if (!isCurrent(layoutId, expectedGeneration)) return { outcome: 'superseded', layoutId, results: [] };
    startTimer(layoutId, expectedGeneration, successful);
    return {
      outcome: successful.length === 0 ? 'inactive' : 'success',
      layoutId,
      recordingMemberIds: successful,
    };
  }

  function invalidateCapabilities(layoutId = null) {
    for (const key of [...capabilities.keys()]) {
      if (layoutId === null || key.startsWith(`${layoutId}\u0000`)) capabilities.delete(key);
    }
  }

  async function stop({ clearActive = true } = {}) {
    ++generation;
    clearRuntimeState();
    activeLayoutId = null;
    if (clearActive) await persistActiveLayout(null);
  }

  return {
    switchTo,
    retry,
    reconcileActive,
    observeActiveMembers,
    invalidateCapabilities,
    stop,
    getSnapshot: () => ({
      activeLayoutId,
      generation,
      recordingMemberIds: [...activeMembers],
      timerActive: timer !== null,
      capabilityKeys: [...capabilities.keys()],
      suppressionKeys: [...suppressions.keys()],
    }),
  };
}

/**
 * 017I2 wiring (RoketPuncha integration lane): the model/store glue the
 * workspace entry uses to own recording with the pure controller. Kept in this
 * module so the integration test exercises the SAME wiring the entry runs
 * against the real model - byte-stable inactive arrangements, minimized
 * restore bounds preserved, prompt saves and typed status - instead of a
 * re-implementation.
 *
 * `model` must expose `setActiveWindowLayoutId(state, idOrNull)` and
 * `updateWindowLayoutMember(state, layoutId, memberId, patch)`. `replaceState`
 * is called only when the model returned a NEW state reference; `scheduleSave`
 * queues a prompt persistence. `statusText(outcome)` maps typed member
 * outcomes to a status string.
 */
export function createWindowLayoutRecordingWiring({
  getLayout,
  host,
  model,
  getState,
  replaceState,
  scheduleSave,
  setStatus,
  patchMember,
  statusText,
  setIntervalFn,
  clearIntervalFn,
  cadenceMs,
}) {
  const runtime = createWindowLayoutRuntime({
    getLayout,
    host,
    persistActiveLayout: (idOrNull) => {
      const current = getState();
      const next = model.setActiveWindowLayoutId(current, idOrNull);
      if (next !== current) replaceState(next);
      scheduleSave();
    },
    persistObservation: (layoutId, memberId, patch) => {
      const current = getState();
      const next = model.updateWindowLayoutMember(current, layoutId, memberId, patch);
      if (next !== current) {
        replaceState(next);
        const member = layoutMembers(getLayout(layoutId)).find((candidate) => candidate.id === memberId);
        patchMember?.(layoutId, memberId, member?.state ?? 'normal');
      }
      scheduleSave();
    },
    onMemberResult: (result) => {
      if (result.outcome !== 'success' && result.outcome !== 'recorded'
        && result.outcome !== 'echo-suppressed' && result.outcome !== 'superseded') {
        setStatus?.(result.layoutId, statusText?.(result.outcome) ?? 'Failed');
      }
    },
    setIntervalFn,
    clearIntervalFn,
    cadenceMs,
  });

  /** Align the recording context to a desired persisted active id: switch the
   * whole layout when the context changes, otherwise re-sync the observed
   * members without re-applying saved geometry. */
  async function ensureRecording(targetLayoutId) {
    if (targetLayoutId === null) return runtime.switchTo(null);
    if (runtime.getSnapshot().activeLayoutId === targetLayoutId) return runtime.reconcileActive();
    return runtime.switchTo(targetLayoutId);
  }

  return { runtime, ensureRecording };
}

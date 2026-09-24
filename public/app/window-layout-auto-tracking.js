const WINDOW_INSTANCE_ID = /^W[0-9a-f]{16}$/i;

/**
 * Owns automatic layout additions. Every asynchronous boundary rechecks the
 * elected writer and the latest layout so a delayed host response cannot
 * resurrect a disabled, suppressed, or already-added window.
 */
export function createWindowLayoutAutoTracker({
  getState,
  isWriter,
  isReadOnly,
  getOperationToken = () => null,
  readSnapshot,
  resolveWindowInstance,
  observeWindowCapability,
  addMember,
  commitState,
  cacheCapability,
  afterCommit = () => {},
  createMemberId = () => crypto.randomUUID(),
}) {
  const inFlight = new Set();

  function currentTrackingLayout(layoutId, windowInstanceId) {
    if (isReadOnly() || !isWriter()) return null;
    const layout = (getState().windowLayouts ?? []).find((entry) => entry.id === layoutId);
    if (!layout || layout.tracking?.enabled !== true) return null;
    if ((layout.arrangement?.members ?? []).some((member) =>
      member.descriptor?.windowInstanceId === windowInstanceId)) return null;
    if ((layout.tracking?.suppressedInstanceIds ?? []).includes(windowInstanceId)) return null;
    return layout;
  }

  async function addVisibleInstance(layoutId, windowInstanceId) {
    if (typeof windowInstanceId !== 'string' || !WINDOW_INSTANCE_ID.test(windowInstanceId)) return false;
    const key = `${layoutId}\u0000${windowInstanceId}`;
    const operationToken = getOperationToken(layoutId);
    const isCurrent = () => getOperationToken(layoutId) === operationToken
      && currentTrackingLayout(layoutId, windowInstanceId);
    if (inFlight.has(key) || !isCurrent()) return false;
    inFlight.add(key);
    try {
      const resolved = await resolveWindowInstance(windowInstanceId);
      if (!isCurrent()
        || resolved?.outcome !== 'success' || !resolved.capability || !resolved.descriptor
        || resolved.descriptor.windowInstanceId !== windowInstanceId) return false;

      const observed = await observeWindowCapability(resolved.capability);
      if (!isCurrent() || observed?.outcome !== 'success') return false;

      const member = {
        id: createMemberId(),
        descriptor: resolved.descriptor,
        bounds: observed.observation?.bounds ?? null,
        state: observed.observation?.state === 'minimized' ? 'minimized' : 'normal',
      };
      // Rebase on the latest state at commit time; never commit a snapshot
      // captured before the helper awaits above.
      const next = addMember(getState(), layoutId, member);
      if (!next || await commitState(next) !== true) return false;
      cacheCapability(layoutId, member.id, resolved.capability);
      await afterCommit(layoutId);
      return true;
    } catch {
      // A later identity snapshot retries failed resolution/observation.
      return false;
    } finally {
      inFlight.delete(key);
    }
  }

  async function refresh(layoutId = null) {
    if (isReadOnly() || !isWriter()) return { outcome: 'not-writer', added: 0 };
    const authorityToken = getOperationToken(null);
    let response;
    try {
      response = await readSnapshot();
    } catch {
      return { outcome: 'unavailable', added: 0 };
    }
    if (isReadOnly() || !isWriter() || getOperationToken(null) !== authorityToken) {
      return { outcome: 'not-writer', added: 0 };
    }
    const snapshot = response?.snapshot;
    if (response?.outcome !== 'success' || !Array.isArray(snapshot?.windows)) {
      return { outcome: 'unavailable', added: 0 };
    }

    const layouts = (getState().windowLayouts ?? [])
      .filter((entry) => entry.tracking?.enabled === true && (layoutId === null || entry.id === layoutId));
    const identities = [...new Set(snapshot.windows
      .map((entry) => entry?.windowInstanceId)
      .filter((id) => typeof id === 'string' && WINDOW_INSTANCE_ID.test(id)))];
    let added = 0;
    for (const layout of layouts) {
      for (const windowInstanceId of identities) {
        if (await addVisibleInstance(layout.id, windowInstanceId)) added += 1;
      }
    }
    return { outcome: 'success', added };
  }

  return { addVisibleInstance, refresh };
}

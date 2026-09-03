/**
 * 0B: which surface may write the board.
 *
 * Papers can show this project in more than one surface at once. The store is
 * the single owner of history and persistence *within* one surface, and every
 * save carries the WHOLE board — so two surfaces saving independently means the
 * later save silently erases the earlier one. Papers refuses a save built on a
 * stale revision (0A), but a refusal is only a backstop: it says the write was
 * wrong, not who should have written.
 *
 * So exactly one surface writes. The election is a Web Lock, not a scheme of
 * our own: the browser releases it when a surface closes or crashes, which is
 * the case a peer heartbeat cannot decide safely. A "peer looks dead, take the
 * lock" rule would be precisely the split brain the lock exists to prevent.
 *
 * The writer broadcasts each committed snapshot; views install it WITHOUT the
 * writer's navigation session, so two windows genuinely show different places
 * in one board. Views never call save.
 *
 * Nothing here is merged. On a refused save the coordinator freezes durable
 * editing and hands the creator the choice, because only they know whether
 * their version or the other one should survive.
 *
 * Everything external is injected, so the whole protocol is testable without a
 * browser, a lock manager or Papers.
 */

export const SURFACE_DOCUMENT_CHANNEL = 'as-you-go:workspace-document';
export const SURFACE_DOCUMENT_LOCK = 'as-you-go:workspace-document-writer';

/** What this surface may currently do. */
export const SURFACE_ROLE = {
  /** Reading and following the writer. Durable editing is unavailable. */
  VIEW: 'view',
  /** Holds the lock. The only surface permitted to save. */
  WRITER: 'writer',
  /** Held the lock, lost a save to a newer revision. Durable editing frozen
   * until the creator chooses which version survives. */
  CONFLICT: 'conflict',
};

const SNAPSHOT_MESSAGE = 'committed';
const MUTATION_MESSAGE = 'mutation-request';

function sameJson(a, b) {
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
}

function mergeChangedMap(baseValue, localValue, currentValue) {
  const base = isPlainObject(baseValue) ? baseValue : {};
  const local = isPlainObject(localValue) ? localValue : {};
  const result = isPlainObject(currentValue) ? { ...currentValue } : {};
  const keys = new Set([...Object.keys(base), ...Object.keys(local)]);
  for (const key of keys) {
    const baseHas = Object.prototype.hasOwnProperty.call(base, key);
    const localHas = Object.prototype.hasOwnProperty.call(local, key);
    if (!baseHas && localHas) result[key] = local[key];
    else if (baseHas && !localHas) delete result[key];
    else if (localHas && !sameJson(local[key], base[key])) result[key] = local[key];
  }
  return result;
}

function mergePositionMap(baseValue, localValue, currentValue, nested) {
  if (!nested) return mergeChangedMap(baseValue, localValue, currentValue);
  const base = isPlainObject(baseValue) ? baseValue : {};
  const local = isPlainObject(localValue) ? localValue : {};
  const current = isPlainObject(currentValue) ? currentValue : {};
  const result = {};
  const contexts = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(current)]);
  for (const context of contexts) {
    const merged = mergeChangedMap(base[context], local[context], current[context]);
    if (Object.keys(merged).length > 0) result[context] = merged;
  }
  return result;
}

const LOCAL_VIEW_KEYS = Object.freeze([
  'currentGroupId',
  'graphExpandedGroupIds',
  'trailExpandedByContext',
  'selectedItemIds',
  'binMode',
]);

/** Remove this surface's navigation/session fallback from a forwarded board
 * snapshot. Those fields are useful when reopening a single surface, but are
 * not shared document actions and must never make another window jump folders
 * or inherit its selection. */
function stripLocalViewFields(serialized, baseSerialized) {
  if (typeof baseSerialized !== 'string') return serialized;
  try {
    const local = JSON.parse(serialized);
    const base = JSON.parse(baseSerialized);
    if (!isPlainObject(local?.view) || !isPlainObject(base?.view)) return serialized;
    const view = { ...local.view };
    for (const key of LOCAL_VIEW_KEYS) {
      if (Object.prototype.hasOwnProperty.call(base.view, key)) view[key] = base.view[key];
      else delete view[key];
    }
    return JSON.stringify({ ...local, view });
  } catch {
    return serialized;
  }
}

/** Merge a view's action snapshot onto the writer's current snapshot. Entity
 * collections are merged by stable id so two windows cannot erase unrelated
 * edits. View/position maps intentionally use last-writer-wins: a later drag
 * is the authoritative placement. */
export function mergeSurfaceSnapshots(base, local, current) {
  if (!isPlainObject(base) || !isPlainObject(local) || !isPlainObject(current)) return local;
  const merged = { ...current };
  for (const key of ['groups', 'shortcuts', 'windowLayouts']) {
    if (!Array.isArray(local[key]) || !Array.isArray(current[key])) continue;
    const baseItems = new Map((Array.isArray(base[key]) ? base[key] : []).map((item) => [item?.id, item]));
    const localItems = new Map(local[key].map((item) => [item?.id, item]));
    const currentItems = new Map(current[key].map((item) => [item?.id, item]));
    const result = [...current[key]];
    const index = new Map(result.map((item, i) => [item?.id, i]));
    for (const [id, localItem] of localItems) {
      if (id == null) continue;
      const baseItem = baseItems.get(id);
      const currentItem = currentItems.get(id);
      if (!baseItems.has(id) || !sameJson(localItem, baseItem)) {
        if (!currentItems.has(id)) {
          index.set(id, result.length);
          result.push(localItem);
        } else if (!sameJson(currentItem, localItem)) {
          result[index.get(id)] = localItem;
        }
      }
    }
    const deleted = new Set([...baseItems.keys()].filter((id) => !localItems.has(id) && currentItems.has(id)));
    merged[key] = result.filter((item) => !deleted.has(item?.id));
  }
  const baseView = isPlainObject(base.view) ? base.view : {};
  const localView = isPlainObject(local.view) ? local.view : {};
  const currentView = isPlainObject(current.view) ? current.view : {};
  const view = { ...currentView };
  for (const [key, value] of Object.entries(localView)) {
    if (key === 'graphPositions' || key === 'graphRestPositions' || key === 'toolbarPositions') {
      if (!sameJson(value, baseView[key])) {
        view[key] = mergePositionMap(
          baseView[key],
          value,
          currentView[key],
          key !== 'toolbarPositions',
        );
      }
    } else if (key === 'itemSets' && Array.isArray(value) && Array.isArray(currentView[key])) {
      // Sets are document semantics stored under view; merge independent set
      // IDs instead of replacing the whole collection on a stale snapshot.
      const baseSets = Array.isArray(baseView[key]) ? baseView[key] : [];
      const baseById = new Map(baseSets.map((item) => [item?.id, item]));
      const localById = new Map(value.map((item) => [item?.id, item]));
      const currentById = new Map(currentView[key].map((item) => [item?.id, item]));
      const mergedSets = [...currentView[key]];
      const indexes = new Map(mergedSets.map((item, index) => [item?.id, index]));
      for (const [id, item] of localById) {
        if (id == null) continue;
        if (!baseById.has(id)) {
          if (!currentById.has(id)) { indexes.set(id, mergedSets.length); mergedSets.push(item); }
        } else if (!sameJson(item, baseById.get(id))) {
          if (currentById.has(id)) mergedSets[indexes.get(id)] = item;
          else { indexes.set(id, mergedSets.length); mergedSets.push(item); }
        }
      }
      const deletedSetIds = new Set([...baseById.keys()].filter((id) => !localById.has(id)));
      view[key] = mergedSets.filter((item) => !deletedSetIds.has(item?.id));
    } else if (!sameJson(value, baseView[key])) {
      view[key] = value;
    }
  }
  merged.view = view;
  if (!sameJson(local.activeWindowLayoutId, base.activeWindowLayoutId)) {
    merged.activeWindowLayoutId = local.activeWindowLayoutId;
  }
  return merged;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The default lock adapter: a real Web Lock held for as long as this surface
 * is the writer. `navigator.locks.request` keeps the lock until the callback's
 * promise settles, so the callback parks on a promise that is resolved by
 * release(). A surface that dies never resolves it and the browser reclaims
 * the lock — which is the whole reason for using it.
 */
export function webLockAdapter(navigatorRef) {
  return {
    available: Boolean(navigatorRef && navigatorRef.locks),
    request(name) {
      let release = () => {};
      const held = new Promise((resolveHeld) => {
        const parked = new Promise((resolveParked) => { release = resolveParked; });
        navigatorRef.locks.request(name, () => { resolveHeld({ release }); return parked; });
      });
      return held;
    },
  };
}

/**
 * @param {object} options
 * @param {{ request(name: string): Promise<{ release(): void }> }} options.lock
 * @param {{ postMessage(value: unknown): void, addEventListener?: Function }} options.channel
 * @param {{ loadVersioned(): Promise<{ state: object, revision: string }>,
 *           saveChecked(state: object, revision: string): Promise<object> }} options.host
 * @param {(snapshot: object) => void} options.installDocument
 *        Installs a document WITHOUT touching this surface's navigation session.
 * @param {(snapshot: object) => void} [options.installExternalDocument]
 *        Installs a peer/external document and may invalidate local history.
 * @param {(snapshot: object, revision: string) => void} [options.onHydrated]
 * @param {(stage: string, code: string, revision?: string) => void} [options.onHydrationFailed]
 * @param {(role: string, detail: object) => void} [options.onRoleChange]
 * @param {() => string} [options.newClientId]
 */
export function createSurfaceCoordinator({
  lock,
  channel,
  host,
  installDocument,
  installExternalDocument = installDocument,
  onHydrated = () => {},
  onHydrationFailed = () => {},
  /** Abandons the store's queued saves and returns the newest serialized
   * snapshot of that generation. Called the moment a save is refused, so the
   * frozen "my version" is the creator's latest local work rather than
   * whichever snapshot happened to lose the race. */
  invalidatePendingSaves = () => null,
  onRoleChange = () => {},
  newClientId = () => `s-${Math.random().toString(36).slice(2, 10)}`,
}) {
  const clientId = newClientId();
  let role = SURFACE_ROLE.VIEW;
  let revision = null;
  /** The snapshot a refused save was carrying. Kept intact: it is the
   * creator's unsaved work and the only copy of it. */
  let frozenSnapshot = null;
  /** While an ownership handover is in flight elsewhere (the 018 detach
   * STOP -> ACTIVATE gap), an ordinary view must not be queued for the lock —
   * it could win the gap and become writer in the middle of the handshake. */
  let transferSuspended = false;
  let pendingAcquire = null;
  let held = null;
  let lastSerialized = null;
  let baselineReady = false;
  let baselinePromise = null;
  // BroadcastChannel can deliver mutations from several views back-to-back.
  // Serialize them at the elected writer so each request rebases on the
  // revision committed immediately before it instead of racing two CAS calls
  // and silently dropping the loser.
  let mutationQueue = Promise.resolve();

  function setRole(next, detail = {}) {
    if (role === next) return;
    role = next;
    onRoleChange(role, detail);
  }

  /** Every follower needs a versioned base before it can forward a durable
   * action; waiting for the writer lock is not a substitute for hydration. */
  async function ensureBaseline() {
    if (baselineReady) return;
    if (!baselinePromise) {
      baselinePromise = (async () => {
        let loaded;
        try {
          loaded = await host.loadVersioned();
        } catch (error) {
          onHydrationFailed('load', 'versioned-load-failed');
          throw error;
        }
        try {
          installDocument(loaded.state);
        } catch (error) {
          onHydrationFailed('install', 'model-install-failed', loaded.revision);
          throw error;
        }
        revision = loaded.revision;
        lastSerialized = JSON.stringify(loaded.state);
        baselineReady = true;
      })();
    }
    return baselinePromise;
  }

  /** Broadcast the exact bytes that were committed. Views decode these; a
   * second representation built alongside the save could differ from what is
   * actually on disk. */
  function publish(serialized, atRevision) {
    lastSerialized = serialized;
    channel.postMessage({
      type: SNAPSHOT_MESSAGE,
      clientId,
      revision: atRevision,
      serialized,
    });
  }

  async function becomeWriter() {
    let loaded;
    try {
      loaded = await host.loadVersioned();
    } catch (error) {
      onHydrationFailed('load', 'versioned-load-failed');
      throw error;
    }
    // The lock may have been won after another writer committed, so the disk
    // is read BEFORE this surface is allowed to write. Never inherit a
    // revision observed before waiting.
    try {
      installDocument(loaded.state);
    } catch (error) {
      onHydrationFailed('install', 'model-install-failed', loaded.revision);
      throw error;
    }
    revision = loaded.revision;
    lastSerialized = JSON.stringify(loaded.state);
    baselineReady = true;
    onHydrated(loaded.state, revision);
    setRole(SURFACE_ROLE.WRITER, { revision });
    return loaded;
  }

  return {
    get role() { return role; },
    get revision() { return revision; },
    get clientId() { return clientId; },
    get baselineReady() { return baselineReady; },
    get frozen() { return frozenSnapshot; },
    get transferSuspended() { return transferSuspended; },

    /**
     * Queue for write ownership. Resolves when this surface becomes the
     * writer, which may be immediately or when the current writer goes away.
     *
     * `designated` is the surface a detach handoff is transferring ownership
     * TO. It is the one surface allowed through a reservation, because the
     * reservation exists to keep everyone ELSE out of the queue until the
     * handoff completes.
     */
    async start({ designated = false } = {}) {
      if (transferSuspended && !designated) return null;
      if (pendingAcquire) return pendingAcquire;
      pendingAcquire = (async () => {
        await ensureBaseline();
        held = await lock.request(SURFACE_DOCUMENT_LOCK);
        return becomeWriter();
      })();
      try {
        return await pendingAcquire;
      } finally {
        pendingAcquire = null;
      }
    },

    /**
     * Save the board. The store owns serialization and ordering, so the
     * already-serialized snapshot arrives here as-is and is never decoded and
     * re-encoded on the way to disk.
     *
     * Only the writer may save; a view reaching here is a caller bug, not a
     * race to resolve.
     */
    async saveSerialized(serialized) {
      if (role === SURFACE_ROLE.VIEW) {
        // Views may edit optimistically. The elected writer serializes their
        // request and broadcasts the committed result back to every surface.
        // This keeps ordinary document actions usable from every window while
        // retaining one durable writer and CAS protection.
        if (!baselineReady) await ensureBaseline();
        const baseSerialized = lastSerialized;
        serialized = stripLocalViewFields(serialized, baseSerialized);
        channel.postMessage({
          type: MUTATION_MESSAGE,
          clientId,
          revision,
          serialized,
          baseSerialized,
        });
        return { ok: true, forwarded: true, revision };
      }
      if (role !== SURFACE_ROLE.WRITER) throw new Error('This surface is not the writer and may not save the board.');
      mutationQueue = mutationQueue
        .catch(() => undefined)
        .then(async () => {
          const result = await host.saveChecked(serialized, revision);
          if (result && result.ok === true) {
            revision = result.revision;
            lastSerialized = serialized;
            publish(serialized, revision);
            return { ok: true, revision };
          }
          // Fail closed, synchronously enough that no further durable mutation
          // is accepted: the role changes before this returns. Queued saves from
          // the same generation are abandoned without ever reaching persistence,
          // and the newest of them becomes the version the creator is offered.
          const latestLocal = invalidatePendingSaves();
          frozenSnapshot = typeof latestLocal === 'string' ? latestLocal : serialized;
          setRole(SURFACE_ROLE.CONFLICT, { revision: result && result.revision });
          return { ok: false, code: 'STALE_REVISION' };
        });
      return mutationQueue;
    },

    /** Conflict recovery: abandon this surface's unsaved version. */
    async useLatest() {
      if (role !== SURFACE_ROLE.CONFLICT) throw new Error('There is no conflict to resolve.');
      let loaded;
      try {
        loaded = await host.loadVersioned();
      } catch (error) {
        onHydrationFailed('load', 'versioned-load-failed');
        throw error;
      }
      try {
        installDocument(loaded.state);
      } catch (error) {
        onHydrationFailed('install', 'model-install-failed', loaded.revision);
        throw error;
      }
      revision = loaded.revision;
      lastSerialized = JSON.stringify(loaded.state);
      baselineReady = true;
      frozenSnapshot = null;
      onHydrated(loaded.state, revision);
      setRole(SURFACE_ROLE.WRITER, { revision });
      return loaded;
    },

    /**
     * Conflict recovery: keep this surface's version, replacing what was saved
     * elsewhere. Destructive, so the caller must confirm with the creator
     * first. Re-reads only to obtain the current revision — if that save is
     * refused too, the surface stays frozen rather than retrying, because a
     * loop here would be an unbounded fight with another live writer.
     */
    async keepMine() {
      if (role !== SURFACE_ROLE.CONFLICT) throw new Error('There is no conflict to resolve.');
      const serialized = frozenSnapshot;
      const loaded = await host.loadVersioned();
      const result = await host.saveChecked(serialized, loaded.revision);
      if (result && result.ok === true) {
        revision = result.revision;
        lastSerialized = serialized;
        frozenSnapshot = null;
        publish(serialized, revision);
        setRole(SURFACE_ROLE.WRITER, { revision });
        return { ok: true, revision };
      }
      return { ok: false, code: 'STALE_REVISION' };
    },

    /** A committed snapshot from the writer. Views follow it; the writer
     * ignores its own echo, and a frozen surface ignores everything — its
     * unsaved work must not be overwritten behind the creator's back. */
    receive(message) {
      if (!isPlainObject(message) || typeof message.clientId !== 'string' || message.clientId === clientId) return false;
      if (message.type === MUTATION_MESSAGE) {
        if (role !== SURFACE_ROLE.WRITER || typeof message.serialized !== 'string') return false;
        mutationQueue = mutationQueue
          .catch(() => undefined)
          .then(async () => {
            let serialized = message.serialized;
            try {
              const incoming = JSON.parse(message.serialized);
              let decoded = incoming;
              const base = typeof message.baseSerialized === 'string'
                ? JSON.parse(message.baseSerialized)
                : null;
              const current = lastSerialized ? JSON.parse(lastSerialized) : null;
              if (base && current && (message.revision !== revision || !sameJson(base, current))) {
                decoded = mergeSurfaceSnapshots(base, incoming, current);
                serialized = JSON.stringify(decoded);
              }
              let result = await host.saveChecked(serialized, revision);
              if (!result || result.ok !== true) {
                // An external writer may have advanced the opaque host revision
                // despite our Web Lock. Reload, rebase this same request once,
                // and retry; never discard a queued peer action merely because
                // the first CAS observed a stale revision.
                const latest = await host.loadVersioned();
                installExternalDocument(latest.state);
                revision = latest.revision;
                lastSerialized = JSON.stringify(latest.state);
                decoded = base
                  ? mergeSurfaceSnapshots(base, incoming, latest.state)
                  : incoming;
                serialized = JSON.stringify(decoded);
                result = await host.saveChecked(serialized, revision);
              }
              if (!result || result.ok !== true) {
                onHydrationFailed('mutation', 'remote-save-stale', revision ?? undefined);
                return;
              }
              installExternalDocument(decoded);
              revision = result.revision;
              lastSerialized = serialized;
              publish(serialized, revision);
            } catch {
              onHydrationFailed('mutation', 'remote-save-failed', revision ?? undefined);
            }
          });
        return true;
      }
      if (message.type !== SNAPSHOT_MESSAGE) return false;
      if (role !== SURFACE_ROLE.VIEW) return false;
      if (typeof message.revision !== 'string' || typeof message.serialized !== 'string') return false;
      let decoded;
      try {
        decoded = JSON.parse(message.serialized);
      } catch {
        onHydrationFailed('decode', 'broadcast-json-invalid', message.revision);
        // A malformed broadcast is ignored rather than installed: a view must
        // never replace a good document with something it could not read.
        return false;
      }
      if (!isPlainObject(decoded)) {
        onHydrationFailed('decode', 'broadcast-state-invalid', message.revision);
        return false;
      }
      try {
        installExternalDocument(decoded);
      } catch {
        onHydrationFailed('install', 'model-install-failed', message.revision);
        return false;
      }
      revision = message.revision;
      lastSerialized = message.serialized;
      baselineReady = true;
      onHydrated(decoded, revision);
      return true;
    },

    /**
     * 018 seam. DORMANT, deliberately kept.
     *
     * The legacy full-surface detach is retired from reachability -- see the
     * `windowLayoutDetachment` stub in the entry file, where mode is always
     * 'workspace'. Detach now opens the compact widget, which never writes the
     * store, so the ownership race this seam exists for cannot occur on the
     * live path. It is not wired to anything, and its tests stand as the
     * specification rather than as coverage of a running path.
     *
     * INVARIANT: if full-surface ownership transfer is ever made reachable
     * again, it MUST integrate this coordinator before shipping -- reserve
     * before FLUSH, release only after the flush settles, designated
     * acquisition after ACTIVATE, and the mandatory versioned reload. Enabling
     * that path without this is the split brain the Web Lock exists to prevent.
     *
     * The handoff ordering it supports, in full:
     *
     *   reserveTransfer()      ordinary surfaces leave the election
     *   ...FLUSH settles...    the old writer still owns the lock, so its one
     *                          authorized final save is still valid
     *   release()              only now is the lock given up
     *   ...ACTIVATE...         the designated surface starts
     *   start({designated})    it, and only it, may take the lock
     *   (reload from disk)     mandatory, never from cached state
     *   completeTransfer()     ordinary surfaces may queue again
     *
     * The reservation must be taken BEFORE the flush, and must outlive the
     * release: releasing while ordinary surfaces are queued would turn the
     * handoff into a free-for-all that the designated surface could lose.
     */
    reserveTransfer() { transferSuspended = true; },

    /** The handoff finished — ownership reached the designated surface. */
    completeTransfer() { transferSuspended = false; },

    /**
     * The handoff failed. If it failed before release(), this surface still
     * owns the lock and simply keeps writing. If it failed after, nobody owns
     * it and the next surface to elect itself still reloads from disk first —
     * an aborted transfer never leaves anyone writable from cached state.
     */
    abortTransfer() { transferSuspended = false; },

    /** Give up write ownership. The lock is released, so a waiting surface
     * elects itself and reloads from disk before it may write. */
    release() {
      if (held) held.release();
      held = null;
      setRole(SURFACE_ROLE.VIEW, {});
    },
  };
}

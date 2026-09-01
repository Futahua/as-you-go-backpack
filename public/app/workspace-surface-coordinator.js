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
 * @param {(role: string, detail: object) => void} [options.onRoleChange]
 * @param {() => string} [options.newClientId]
 */
export function createSurfaceCoordinator({
  lock,
  channel,
  host,
  installDocument,
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

  function setRole(next, detail = {}) {
    if (role === next) return;
    role = next;
    onRoleChange(role, detail);
  }

  /** Broadcast the exact bytes that were committed. Views decode these; a
   * second representation built alongside the save could differ from what is
   * actually on disk. */
  function publish(serialized, atRevision) {
    channel.postMessage({
      type: SNAPSHOT_MESSAGE,
      clientId,
      revision: atRevision,
      serialized,
    });
  }

  async function becomeWriter() {
    const loaded = await host.loadVersioned();
    revision = loaded.revision;
    // The lock may have been won after another writer committed, so the disk
    // is read BEFORE this surface is allowed to write. Never inherit a
    // revision observed before waiting.
    installDocument(loaded.state);
    setRole(SURFACE_ROLE.WRITER, { revision });
    return loaded;
  }

  return {
    get role() { return role; },
    get revision() { return revision; },
    get clientId() { return clientId; },
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
      if (role !== SURFACE_ROLE.WRITER) {
        throw new Error('This surface is not the writer and may not save the board.');
      }
      const result = await host.saveChecked(serialized, revision);
      if (result && result.ok === true) {
        revision = result.revision;
        publish(serialized, revision);
        return { ok: true, revision };
      }
      // Fail closed, synchronously enough that no further durable mutation is
      // accepted: the role changes before this returns. Queued saves from the
      // same generation are abandoned without ever reaching persistence, and
      // the newest of them becomes the version the creator is offered.
      const latestLocal = invalidatePendingSaves();
      frozenSnapshot = typeof latestLocal === 'string' ? latestLocal : serialized;
      setRole(SURFACE_ROLE.CONFLICT, { revision: result && result.revision });
      return { ok: false, code: 'STALE_REVISION' };
    },

    /** Conflict recovery: abandon this surface's unsaved version. */
    async useLatest() {
      if (role !== SURFACE_ROLE.CONFLICT) throw new Error('There is no conflict to resolve.');
      const loaded = await host.loadVersioned();
      revision = loaded.revision;
      frozenSnapshot = null;
      installDocument(loaded.state);
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
      if (!isPlainObject(message) || message.type !== SNAPSHOT_MESSAGE) return false;
      if (message.clientId === clientId) return false;
      if (role !== SURFACE_ROLE.VIEW) return false;
      if (typeof message.revision !== 'string' || typeof message.serialized !== 'string') return false;
      let decoded;
      try {
        decoded = JSON.parse(message.serialized);
      } catch {
        // A malformed broadcast is ignored rather than installed: a view must
        // never replace a good document with something it could not read.
        return false;
      }
      if (!isPlainObject(decoded)) return false;
      revision = message.revision;
      installDocument(decoded);
      return true;
    },

    /**
     * 018 seam. The handoff ordering this supports, in full:
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

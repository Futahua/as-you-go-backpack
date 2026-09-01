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

  function publish(snapshot, atRevision) {
    channel.postMessage({
      type: SNAPSHOT_MESSAGE,
      clientId,
      revision: atRevision,
      snapshot,
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

    /** Queue for write ownership. Resolves when this surface becomes the
     * writer, which may be immediately or when the current writer goes away. */
    async start() {
      if (transferSuspended) return null;
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
     * Save the board. Only the writer may; a view calling this is a bug in the
     * caller, not a race to resolve, so it throws rather than failing quietly.
     */
    async save(snapshot) {
      if (role !== SURFACE_ROLE.WRITER) {
        throw new Error('This surface is not the writer and may not save the board.');
      }
      const result = await host.saveChecked(snapshot, revision);
      if (result && result.ok === true) {
        revision = result.revision;
        publish(snapshot, revision);
        return { ok: true, revision };
      }
      // Fail closed. The board changed elsewhere; this snapshot is unsaved and
      // is kept exactly as it is until the creator decides.
      frozenSnapshot = snapshot;
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
      const snapshot = frozenSnapshot;
      const loaded = await host.loadVersioned();
      const result = await host.saveChecked(snapshot, loaded.revision);
      if (result && result.ok === true) {
        revision = result.revision;
        frozenSnapshot = null;
        publish(snapshot, revision);
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
      if (typeof message.revision !== 'string' || !isPlainObject(message.snapshot)) return false;
      revision = message.revision;
      installDocument(message.snapshot);
      return true;
    },

    /** 018 seam: hold ordinary surfaces out of the election while a detach
     * handshake transfers ownership deliberately. */
    suspendTransfer() { transferSuspended = true; },
    resumeTransfer() { transferSuspended = false; },

    /** Give up write ownership. The lock is released, so a waiting surface
     * elects itself and reloads from disk before it may write. */
    release() {
      if (held) held.release();
      held = null;
      setRole(SURFACE_ROLE.VIEW, {});
    },
  };
}

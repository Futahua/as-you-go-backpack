import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SURFACE_ROLE,
  createSurfaceCoordinator,
  mergeSurfaceSnapshots,
} from './public/app/workspace-surface-coordinator.js';

/** A lock that hands ownership to one holder at a time, in request order —
 * the property the real Web Lock gives us and the only one under test. */
function fakeLock() {
  let held = false;
  const waiting = [];
  return {
    async request() {
      if (held) {
        await new Promise((resolve) => waiting.push(resolve));
      }
      held = true;
      return {
        release() {
          held = false;
          const next = waiting.shift();
          if (next) next();
        },
      };
    },
    get waitingCount() { return waiting.length; },
  };
}

/** A disk that behaves exactly like Papers after 0A: compare-and-set on an
 * opaque revision, refusing rather than overwriting. */
function fakeDisk(initial = { schemaVersion: 1, groups: [], shortcuts: [] }) {
  let state = initial;
  let revision = 'r0';
  let counter = 0;
  return {
    async loadVersioned() { return { state, revision }; },
    async saveChecked(serialized, expected) {
      if (expected !== revision) return { ok: false, code: 'STALE_REVISION', revision };
      state = JSON.parse(serialized);
      counter += 1;
      revision = `r${counter}`;
      return { ok: true, revision };
    },
    get state() { return state; },
    get revision() { return revision; },
  };
}

function fakeChannel() {
  const sent = [];
  return { postMessage(value) { sent.push(value); }, sent };
}

function surface(lock, disk, name, { latestQueued = null } = {}) {
  const installed = [];
  const channel = fakeChannel();
  const invalidations = [];
  const coordinator = createSurfaceCoordinator({
    lock,
    channel,
    host: disk,
    installDocument: (snapshot) => { installed.push(snapshot); },
    invalidatePendingSaves: () => { invalidations.push(true); return latestQueued; },
    newClientId: () => name,
  });
  return { coordinator, installed, channel, invalidations };
}

const ser = (value) => JSON.stringify(value);

test('the first surface becomes the writer and a second stays a view', async () => {
  const lock = fakeLock();
  const disk = fakeDisk();
  const a = surface(lock, disk, 'A');
  const b = surface(lock, disk, 'B');

  await a.coordinator.start();
  assert.equal(a.coordinator.role, SURFACE_ROLE.WRITER);

  const bWriting = b.coordinator.start();
  await Promise.resolve();
  assert.equal(b.coordinator.role, SURFACE_ROLE.VIEW, 'B must not write while A holds the lock');

  a.coordinator.release();
  await bWriting;
  assert.equal(b.coordinator.role, SURFACE_ROLE.WRITER);
});

test('a view forwards saves instead of silently blocking document actions', async () => {
  const lock = fakeLock();
  const disk = fakeDisk();
  const b = surface(lock, disk, 'B');
  const result = await b.coordinator.saveSerialized(ser({ schemaVersion: 1, groups: [], shortcuts: [] }));
  assert.equal(result.forwarded, true);
});

test('a view forwards an optimistic document action to the writer channel', async () => {
  const lock = fakeLock();
  const disk = fakeDisk();
  const b = surface(lock, disk, 'B');
  const board = { schemaVersion: 1, groups: [{ id: 'g1' }], shortcuts: [] };
  const result = await b.coordinator.saveSerialized(ser(board));
  assert.deepEqual(result, { ok: true, forwarded: true, revision: 'r0' });
  assert.deepEqual(b.channel.sent.at(-1), {
    type: 'mutation-request',
    clientId: 'B',
    revision: 'r0',
    serialized: ser(board),
    baseSerialized: ser({ schemaVersion: 1, groups: [], shortcuts: [] }),
  });
});

test('a forwarded view mutation keeps navigation and selection local', async () => {
  const lock = fakeLock();
  const disk = fakeDisk({
    schemaVersion: 1, groups: [], shortcuts: [],
    view: { currentGroupId: 'writer-folder', selectedItemIds: ['writer-item'], binMode: false },
  });
  const b = surface(lock, disk, 'B');
  const local = {
    schemaVersion: 1,
    groups: [{ id: 'new' }],
    shortcuts: [],
    view: { currentGroupId: 'b-folder', selectedItemIds: ['b-item'], binMode: true },
  };
  await b.coordinator.saveSerialized(ser(local));
  const sent = b.channel.sent.at(-1);
  const forwarded = JSON.parse(sent.serialized);
  assert.equal(forwarded.groups[0].id, 'new');
  assert.equal(forwarded.view.currentGroupId, 'writer-folder');
  assert.deepEqual(forwarded.view.selectedItemIds, ['writer-item']);
  assert.equal(forwarded.view.binMode, false);
});

test('stale action snapshots merge entities while the incoming position wins', () => {
  const base = {
    schemaVersion: 1,
    groups: [{ id: 'g1', title: 'one' }, { id: 'g2', title: 'two' }],
    shortcuts: [],
    view: { graphPositions: { root: { g1: { x: 1, y: 1 } } }, iconSize: 32 },
  };
  const local = {
    ...base,
    groups: [{ id: 'g2', title: 'two' }, { id: 'g1', title: 'renamed' }],
    view: { graphPositions: { root: { g1: { x: 90, y: 90 } } }, iconSize: 40 },
  };
  const current = {
    ...base,
    groups: [{ id: 'g1', title: 'one' }, { id: 'g2', title: 'changed elsewhere' }],
    view: { graphPositions: { root: { g1: { x: 4, y: 4 } } }, iconSize: 32 },
  };
  const merged = mergeSurfaceSnapshots(base, local, current);
  assert.deepEqual(merged.groups, [
    { id: 'g1', title: 'renamed' },
    { id: 'g2', title: 'changed elsewhere' },
  ]);
  assert.deepEqual(merged.view.graphPositions, { root: { g1: { x: 90, y: 90 } } });
  assert.equal(merged.view.iconSize, 40);
});

test('stale position updates merge per item and preserve an unrelated later drag', () => {
  const base = {
    schemaVersion: 1,
    groups: [],
    shortcuts: [],
    view: { graphPositions: { root: { a: { x: 1, y: 1 }, b: { x: 2, y: 2 } } } },
  };
  const local = {
    ...base,
    view: { graphPositions: { root: { a: { x: 90, y: 90 }, b: { x: 2, y: 2 } } } },
  };
  const current = {
    ...base,
    view: { graphPositions: { root: { a: { x: 4, y: 4 }, b: { x: 80, y: 80 } } } },
  };
  assert.deepEqual(
    mergeSurfaceSnapshots(base, local, current).view.graphPositions,
    { root: { a: { x: 90, y: 90 }, b: { x: 80, y: 80 } } },
  );
});

test('stale set updates merge independent item-set IDs', () => {
  const base = {
    schemaVersion: 1, groups: [], shortcuts: [],
    view: { itemSets: [{ id: 's1', title: 'one' }, { id: 's2', title: 'two' }] },
  };
  const local = {
    ...base,
    view: { itemSets: [{ id: 's1', title: 'ONE' }, { id: 's2', title: 'two' }] },
  };
  const current = {
    ...base,
    view: { itemSets: [{ id: 's1', title: 'one' }, { id: 's2', title: 'TWO' }] },
  };
  assert.deepEqual(mergeSurfaceSnapshots(base, local, current).view.itemSets, [
    { id: 's1', title: 'ONE' },
    { id: 's2', title: 'TWO' },
  ]);
});

test('a multi-item delete removes every requested entity without index drift', () => {
  const base = { schemaVersion: 1, groups: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], shortcuts: [] };
  const local = { ...base, groups: [{ id: 'c' }] };
  const merged = mergeSurfaceSnapshots(base, local, base);
  assert.deepEqual(merged.groups, [{ id: 'c' }]);
});

test('queued peer mutations rebase in arrival order instead of dropping the second edit', async () => {
  const lock = fakeLock();
  const disk = fakeDisk({
    schemaVersion: 1,
    groups: [{ id: 'g1', title: 'one' }, { id: 'g2', title: 'two' }],
    shortcuts: [],
  });
  const a = surface(lock, disk, 'A');
  await a.coordinator.start();
  const base = ser(disk.state);
  const first = ser({
    schemaVersion: 1,
    groups: [{ id: 'g1', title: 'ONE' }, { id: 'g2', title: 'two' }],
    shortcuts: [],
  });
  const second = ser({
    schemaVersion: 1,
    groups: [{ id: 'g1', title: 'one' }, { id: 'g2', title: 'TWO' }],
    shortcuts: [],
  });
  assert.equal(a.coordinator.receive({ type: 'mutation-request', clientId: 'B', revision: 'r0', serialized: first, baseSerialized: base }), true);
  assert.equal(a.coordinator.receive({ type: 'mutation-request', clientId: 'C', revision: 'r0', serialized: second, baseSerialized: base }), true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(disk.state.groups, [
    { id: 'g1', title: 'ONE' },
    { id: 'g2', title: 'TWO' },
  ]);
});

test('a successful save advances the revision and broadcasts the committed snapshot', async () => {
  const lock = fakeLock();
  const disk = fakeDisk();
  const a = surface(lock, disk, 'A');
  await a.coordinator.start();

  const board = { schemaVersion: 1, groups: [{ id: 'g' }], shortcuts: [] };
  const result = await a.coordinator.saveSerialized(ser(board));

  assert.equal(result.ok, true);
  assert.equal(a.coordinator.revision, disk.revision);
  assert.deepEqual(a.channel.sent.at(-1), {
    type: 'committed',
    clientId: 'A',
    revision: disk.revision,
    serialized: ser(board),
  }, 'the broadcast carries the exact bytes that were committed');
});

test('a view installs a committed snapshot but never its own echo', async () => {
  const lock = fakeLock();
  const disk = fakeDisk();
  const b = surface(lock, disk, 'B');
  const board = { schemaVersion: 1, groups: [{ id: 'from-a' }], shortcuts: [] };

  assert.equal(b.coordinator.receive({ type: 'committed', clientId: 'A', revision: 'r1', serialized: ser(board) }), true);
  assert.deepEqual(b.installed.at(-1), board);
  assert.equal(b.coordinator.revision, 'r1');

  assert.equal(b.coordinator.receive({ type: 'committed', clientId: 'B', revision: 'r2', serialized: ser(board) }), false);
});

test('a save refused as stale freezes the surface and keeps the unsaved snapshot', async () => {
  const lock = fakeLock();
  const disk = fakeDisk();
  const a = surface(lock, disk, 'A');
  await a.coordinator.start();

  // Something else commits first — the case 0A refuses.
  await disk.saveChecked(ser({ schemaVersion: 1, groups: [{ id: 'elsewhere' }], shortcuts: [] }), disk.revision);

  const mine = { schemaVersion: 1, groups: [{ id: 'mine' }], shortcuts: [] };
  const result = await a.coordinator.saveSerialized(ser(mine));

  assert.deepEqual(result, { ok: false, code: 'STALE_REVISION' });
  assert.equal(a.coordinator.role, SURFACE_ROLE.CONFLICT);
  assert.equal(a.coordinator.frozen, ser(mine), 'the unsaved work is the only copy and must survive');
  assert.deepEqual(disk.state.groups, [{ id: 'elsewhere' }], 'the other version must not be overwritten');
});

test('a frozen surface ignores incoming snapshots so unsaved work is not overwritten', async () => {
  const lock = fakeLock();
  const disk = fakeDisk();
  const a = surface(lock, disk, 'A');
  await a.coordinator.start();
  await disk.saveChecked(ser({ schemaVersion: 1, groups: [{ id: 'elsewhere' }], shortcuts: [] }), disk.revision);
  await a.coordinator.saveSerialized(ser({ schemaVersion: 1, groups: [{ id: 'mine' }], shortcuts: [] }));

  const before = a.installed.length;
  assert.equal(
    a.coordinator.receive({ type: 'committed', clientId: 'B', revision: 'r9', serialized: ser({ schemaVersion: 1, groups: [], shortcuts: [] }) }),
    false,
  );
  assert.equal(a.installed.length, before);
});

test('Use latest version discards the frozen snapshot and resumes writing', async () => {
  const lock = fakeLock();
  const disk = fakeDisk();
  const a = surface(lock, disk, 'A');
  await a.coordinator.start();
  await disk.saveChecked(ser({ schemaVersion: 1, groups: [{ id: 'elsewhere' }], shortcuts: [] }), disk.revision);
  await a.coordinator.saveSerialized(ser({ schemaVersion: 1, groups: [{ id: 'mine' }], shortcuts: [] }));

  await a.coordinator.useLatest();

  assert.equal(a.coordinator.role, SURFACE_ROLE.WRITER);
  assert.equal(a.coordinator.frozen, null);
  assert.deepEqual(a.installed.at(-1).groups, [{ id: 'elsewhere' }]);
  assert.equal(a.coordinator.revision, disk.revision);
});

test('Keep my version replaces the other version, and only then', async () => {
  const lock = fakeLock();
  const disk = fakeDisk();
  const a = surface(lock, disk, 'A');
  await a.coordinator.start();
  await disk.saveChecked(ser({ schemaVersion: 1, groups: [{ id: 'elsewhere' }], shortcuts: [] }), disk.revision);
  const mine = { schemaVersion: 1, groups: [{ id: 'mine' }], shortcuts: [] };
  await a.coordinator.saveSerialized(ser(mine));

  const result = await a.coordinator.keepMine();

  assert.equal(result.ok, true);
  assert.equal(a.coordinator.role, SURFACE_ROLE.WRITER);
  assert.deepEqual(disk.state, mine);
  assert.equal(a.coordinator.frozen, null);
});

test('Keep my version losing a second race stays frozen instead of looping', async () => {
  const lock = fakeLock();
  const disk = fakeDisk();
  const a = surface(lock, disk, 'A');
  await a.coordinator.start();
  await disk.saveChecked(ser({ schemaVersion: 1, groups: [{ id: 'first' }], shortcuts: [] }), disk.revision);
  await a.coordinator.saveSerialized(ser({ schemaVersion: 1, groups: [{ id: 'mine' }], shortcuts: [] }));

  // Another writer commits again in the window between the reload and the save.
  const racing = { ...disk };
  const originalLoad = disk.loadVersioned.bind(disk);
  disk.loadVersioned = async () => {
    const loaded = await originalLoad();
    await disk.saveChecked(ser({ schemaVersion: 1, groups: [{ id: 'second' }], shortcuts: [] }), disk.revision);
    return loaded;
  };
  void racing;

  const result = await a.coordinator.keepMine();

  assert.deepEqual(result, { ok: false, code: 'STALE_REVISION' });
  assert.equal(a.coordinator.role, SURFACE_ROLE.CONFLICT, 'still frozen — never a retry loop');
  assert.deepEqual(JSON.parse(a.coordinator.frozen).groups, [{ id: 'mine' }]);
});

test('a surface that wins the lock later reloads from disk before it may write', async () => {
  const lock = fakeLock();
  const disk = fakeDisk();
  const a = surface(lock, disk, 'A');
  const b = surface(lock, disk, 'B');

  await a.coordinator.start();
  const bWriting = b.coordinator.start();
  await a.coordinator.saveSerialized(ser({ schemaVersion: 1, groups: [{ id: 'written-by-a' }], shortcuts: [] }));
  a.coordinator.release();
  await bWriting;

  assert.equal(b.coordinator.role, SURFACE_ROLE.WRITER);
  assert.equal(b.coordinator.revision, disk.revision, 'B must not inherit a revision observed before it waited');
  assert.deepEqual(b.installed.at(-1).groups, [{ id: 'written-by-a' }]);
});

test('while an ownership transfer is suspended an ordinary view does not queue for the lock', async () => {
  const lock = fakeLock();
  const disk = fakeDisk();
  const a = surface(lock, disk, 'A');
  const b = surface(lock, disk, 'B');
  await a.coordinator.start();

  b.coordinator.reserveTransfer();
  const attempted = await b.coordinator.start();

  assert.equal(attempted, null);
  assert.equal(lock.waitingCount, 0, 'a view must not sit in the queue during STOP -> ACTIVATE');
  assert.equal(b.coordinator.role, SURFACE_ROLE.VIEW);

  b.coordinator.completeTransfer();
  const resumed = b.coordinator.start();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(lock.waitingCount, 1);
  a.coordinator.release();
  await resumed;
  assert.equal(b.coordinator.role, SURFACE_ROLE.WRITER);
});

test('0B: a refused save freezes the newest queued local work, not the snapshot that lost', async () => {
  const lock = fakeLock();
  const disk = fakeDisk();
  // The store had a newer edit queued behind the save that raced and lost.
  const newest = ser({ schemaVersion: 1, groups: [{ id: 'newest-local' }], shortcuts: [] });
  const a = surface(lock, disk, 'A', { latestQueued: newest });
  await a.coordinator.start();
  await disk.saveChecked(ser({ schemaVersion: 1, groups: [{ id: 'elsewhere' }], shortcuts: [] }), disk.revision);

  await a.coordinator.saveSerialized(ser({ schemaVersion: 1, groups: [{ id: 'the-one-that-lost' }], shortcuts: [] }));

  assert.equal(a.coordinator.role, SURFACE_ROLE.CONFLICT);
  assert.equal(a.invalidations.length, 1, 'the queued generation is abandoned exactly once');
  assert.equal(a.coordinator.frozen, newest, 'Keep my version must offer the creator their latest work');
});

test('0B: Keep my version writes the newest queued work, not the losing snapshot', async () => {
  const lock = fakeLock();
  const disk = fakeDisk();
  const newest = ser({ schemaVersion: 1, groups: [{ id: 'newest-local' }], shortcuts: [] });
  const a = surface(lock, disk, 'A', { latestQueued: newest });
  await a.coordinator.start();
  await disk.saveChecked(ser({ schemaVersion: 1, groups: [{ id: 'elsewhere' }], shortcuts: [] }), disk.revision);
  await a.coordinator.saveSerialized(ser({ schemaVersion: 1, groups: [{ id: 'lost' }], shortcuts: [] }));

  await a.coordinator.keepMine();

  assert.deepEqual(disk.state.groups, [{ id: 'newest-local' }]);
});

test('0B: a malformed broadcast is ignored rather than installed', () => {
  const lock = fakeLock();
  const disk = fakeDisk();
  const b = surface(lock, disk, 'B');
  assert.equal(b.coordinator.receive({ type: 'committed', clientId: 'A', revision: 'r1', serialized: '{not json' }), false);
  assert.equal(b.installed.length, 0);
  assert.equal(b.coordinator.revision, null, 'a rejected broadcast must not move the revision');
});

test('C1: a versioned document reports hydration only after installation', async () => {
  const order = [];
  const coordinator = createSurfaceCoordinator({
    lock: fakeLock(),
    channel: fakeChannel(),
    host: fakeDisk({ schemaVersion: 1, groups: [{ id: 'g1' }], shortcuts: [] }),
    installDocument: () => order.push('installed'),
    onHydrated: (_snapshot, revision) => order.push(`hydrated:${revision}`),
  });

  await coordinator.start();
  assert.deepEqual(order, ['installed', 'installed', 'hydrated:r0']);
});

test('C1: failed model installation reports bounded metadata and no hydration success', async () => {
  const reports = [];
  const coordinator = createSurfaceCoordinator({
    lock: fakeLock(),
    channel: fakeChannel(),
    host: fakeDisk(),
    installDocument: () => { throw new Error('private state bytes'); },
    onHydrated: () => reports.push(['hydrated']),
    onHydrationFailed: (...args) => reports.push(args),
  });

  await assert.rejects(coordinator.start(), /private state bytes/);
  assert.deepEqual(reports, [['install', 'model-install-failed', 'r0']]);
});

test('C1: malformed broadcast reports decode failure without replacing the model', () => {
  const installed = [];
  const reports = [];
  const coordinator = createSurfaceCoordinator({
    lock: fakeLock(),
    channel: fakeChannel(),
    host: fakeDisk(),
    installDocument: (snapshot) => installed.push(snapshot),
    onHydrationFailed: (...args) => reports.push(args),
  });

  assert.equal(coordinator.receive({ type: 'committed', clientId: 'peer', revision: 'r7', serialized: '{bad' }), false);
  assert.deepEqual(installed, []);
  assert.deepEqual(reports, [['decode', 'broadcast-json-invalid', 'r7']]);
});

test('018: the reservation holds ordinary surfaces out until the designated surface owns the lock', async () => {
  const lock = fakeLock();
  const disk = fakeDisk();
  const oldWriter = surface(lock, disk, 'OLD');
  const designated = surface(lock, disk, 'TARGET');
  const ordinary = surface(lock, disk, 'ORDINARY');

  await oldWriter.coordinator.start();

  // Reserved BEFORE the flush. The old writer still owns the lock, so its one
  // authorized final save is still valid at this point.
  oldWriter.coordinator.reserveTransfer();
  ordinary.coordinator.reserveTransfer();
  assert.equal(await ordinary.coordinator.start(), null, 'an ordinary surface must not queue during the handoff');
  assert.equal(lock.waitingCount, 0);

  const flush = await oldWriter.coordinator.saveSerialized(ser({ schemaVersion: 1, groups: [{ id: 'final-flush' }], shortcuts: [] }));
  assert.equal(flush.ok, true, 'the final flush must still succeed while the old writer owns the lock');

  // Only now is the lock given up, and only the designated surface may take it.
  oldWriter.coordinator.release();
  designated.coordinator.reserveTransfer();
  await designated.coordinator.start({ designated: true });

  assert.equal(designated.coordinator.role, SURFACE_ROLE.WRITER);
  assert.deepEqual(designated.installed.at(-1).groups, [{ id: 'final-flush' }], 'the new writer reloads from disk, never from cached state');

  ordinary.coordinator.completeTransfer();
  const resumed = ordinary.coordinator.start();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(lock.waitingCount, 1, 'ordinary surfaces may queue again only after the handoff');
  designated.coordinator.release();
  await resumed;
  assert.equal(ordinary.coordinator.role, SURFACE_ROLE.WRITER);
});

test('018: a transfer aborted before release leaves the old writer still writing', async () => {
  const lock = fakeLock();
  const disk = fakeDisk();
  const oldWriter = surface(lock, disk, 'OLD');
  await oldWriter.coordinator.start();

  oldWriter.coordinator.reserveTransfer();
  oldWriter.coordinator.abortTransfer();

  assert.equal(oldWriter.coordinator.role, SURFACE_ROLE.WRITER, 'ownership was never given up');
  const result = await oldWriter.coordinator.saveSerialized(ser({ schemaVersion: 1, groups: [{ id: 'still-mine' }], shortcuts: [] }));
  assert.equal(result.ok, true);
});

test('018: a transfer aborted after release still forces a disk reload before anyone writes', async () => {
  const lock = fakeLock();
  const disk = fakeDisk();
  const oldWriter = surface(lock, disk, 'OLD');
  const ordinary = surface(lock, disk, 'ORDINARY');
  await oldWriter.coordinator.start();
  await oldWriter.coordinator.saveSerialized(ser({ schemaVersion: 1, groups: [{ id: 'before-abort' }], shortcuts: [] }));

  ordinary.coordinator.reserveTransfer();
  oldWriter.coordinator.release();
  // The designated surface never arrives; the handoff aborts.
  ordinary.coordinator.abortTransfer();
  await ordinary.coordinator.start();

  assert.equal(ordinary.coordinator.role, SURFACE_ROLE.WRITER);
  assert.deepEqual(ordinary.installed.at(-1).groups, [{ id: 'before-abort' }], 'election always reloads, even after an aborted transfer');
  assert.equal(ordinary.coordinator.revision, disk.revision);
});

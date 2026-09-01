import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SURFACE_ROLE,
  createSurfaceCoordinator,
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
    async saveChecked(next, expected) {
      if (expected !== revision) return { ok: false, code: 'STALE_REVISION', revision };
      state = next;
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

function surface(lock, disk, name) {
  const installed = [];
  const channel = fakeChannel();
  const coordinator = createSurfaceCoordinator({
    lock,
    channel,
    host: disk,
    installDocument: (snapshot) => { installed.push(snapshot); },
    newClientId: () => name,
  });
  return { coordinator, installed, channel };
}

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

test('a view may not save at all', async () => {
  const lock = fakeLock();
  const disk = fakeDisk();
  const b = surface(lock, disk, 'B');
  await assert.rejects(
    () => b.coordinator.save({ schemaVersion: 1, groups: [], shortcuts: [] }),
    /not the writer/,
  );
});

test('a successful save advances the revision and broadcasts the committed snapshot', async () => {
  const lock = fakeLock();
  const disk = fakeDisk();
  const a = surface(lock, disk, 'A');
  await a.coordinator.start();

  const board = { schemaVersion: 1, groups: [{ id: 'g' }], shortcuts: [] };
  const result = await a.coordinator.save(board);

  assert.equal(result.ok, true);
  assert.equal(a.coordinator.revision, disk.revision);
  assert.deepEqual(a.channel.sent.at(-1), {
    type: 'committed',
    clientId: 'A',
    revision: disk.revision,
    snapshot: board,
  });
});

test('a view installs a committed snapshot but never its own echo', async () => {
  const lock = fakeLock();
  const disk = fakeDisk();
  const b = surface(lock, disk, 'B');
  const board = { schemaVersion: 1, groups: [{ id: 'from-a' }], shortcuts: [] };

  assert.equal(b.coordinator.receive({ type: 'committed', clientId: 'A', revision: 'r1', snapshot: board }), true);
  assert.deepEqual(b.installed.at(-1), board);
  assert.equal(b.coordinator.revision, 'r1');

  assert.equal(b.coordinator.receive({ type: 'committed', clientId: 'B', revision: 'r2', snapshot: board }), false);
});

test('a save refused as stale freezes the surface and keeps the unsaved snapshot', async () => {
  const lock = fakeLock();
  const disk = fakeDisk();
  const a = surface(lock, disk, 'A');
  await a.coordinator.start();

  // Something else commits first — the case 0A refuses.
  await disk.saveChecked({ schemaVersion: 1, groups: [{ id: 'elsewhere' }], shortcuts: [] }, disk.revision);

  const mine = { schemaVersion: 1, groups: [{ id: 'mine' }], shortcuts: [] };
  const result = await a.coordinator.save(mine);

  assert.deepEqual(result, { ok: false, code: 'STALE_REVISION' });
  assert.equal(a.coordinator.role, SURFACE_ROLE.CONFLICT);
  assert.deepEqual(a.coordinator.frozen, mine, 'the unsaved work is the only copy and must survive');
  assert.deepEqual(disk.state.groups, [{ id: 'elsewhere' }], 'the other version must not be overwritten');
});

test('a frozen surface ignores incoming snapshots so unsaved work is not overwritten', async () => {
  const lock = fakeLock();
  const disk = fakeDisk();
  const a = surface(lock, disk, 'A');
  await a.coordinator.start();
  await disk.saveChecked({ schemaVersion: 1, groups: [{ id: 'elsewhere' }], shortcuts: [] }, disk.revision);
  await a.coordinator.save({ schemaVersion: 1, groups: [{ id: 'mine' }], shortcuts: [] });

  const before = a.installed.length;
  assert.equal(
    a.coordinator.receive({ type: 'committed', clientId: 'B', revision: 'r9', snapshot: { schemaVersion: 1, groups: [], shortcuts: [] } }),
    false,
  );
  assert.equal(a.installed.length, before);
});

test('Use latest version discards the frozen snapshot and resumes writing', async () => {
  const lock = fakeLock();
  const disk = fakeDisk();
  const a = surface(lock, disk, 'A');
  await a.coordinator.start();
  await disk.saveChecked({ schemaVersion: 1, groups: [{ id: 'elsewhere' }], shortcuts: [] }, disk.revision);
  await a.coordinator.save({ schemaVersion: 1, groups: [{ id: 'mine' }], shortcuts: [] });

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
  await disk.saveChecked({ schemaVersion: 1, groups: [{ id: 'elsewhere' }], shortcuts: [] }, disk.revision);
  const mine = { schemaVersion: 1, groups: [{ id: 'mine' }], shortcuts: [] };
  await a.coordinator.save(mine);

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
  await disk.saveChecked({ schemaVersion: 1, groups: [{ id: 'first' }], shortcuts: [] }, disk.revision);
  await a.coordinator.save({ schemaVersion: 1, groups: [{ id: 'mine' }], shortcuts: [] });

  // Another writer commits again in the window between the reload and the save.
  const racing = { ...disk };
  const originalLoad = disk.loadVersioned.bind(disk);
  disk.loadVersioned = async () => {
    const loaded = await originalLoad();
    await disk.saveChecked({ schemaVersion: 1, groups: [{ id: 'second' }], shortcuts: [] }, disk.revision);
    return loaded;
  };
  void racing;

  const result = await a.coordinator.keepMine();

  assert.deepEqual(result, { ok: false, code: 'STALE_REVISION' });
  assert.equal(a.coordinator.role, SURFACE_ROLE.CONFLICT, 'still frozen — never a retry loop');
  assert.deepEqual(a.coordinator.frozen.groups, [{ id: 'mine' }]);
});

test('a surface that wins the lock later reloads from disk before it may write', async () => {
  const lock = fakeLock();
  const disk = fakeDisk();
  const a = surface(lock, disk, 'A');
  const b = surface(lock, disk, 'B');

  await a.coordinator.start();
  const bWriting = b.coordinator.start();
  await a.coordinator.save({ schemaVersion: 1, groups: [{ id: 'written-by-a' }], shortcuts: [] });
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

  b.coordinator.suspendTransfer();
  const attempted = await b.coordinator.start();

  assert.equal(attempted, null);
  assert.equal(lock.waitingCount, 0, 'a view must not sit in the queue during STOP -> ACTIVATE');
  assert.equal(b.coordinator.role, SURFACE_ROLE.VIEW);

  b.coordinator.resumeTransfer();
  const resumed = b.coordinator.start();
  await Promise.resolve();
  assert.equal(lock.waitingCount, 1);
  a.coordinator.release();
  await resumed;
  assert.equal(b.coordinator.role, SURFACE_ROLE.WRITER);
});

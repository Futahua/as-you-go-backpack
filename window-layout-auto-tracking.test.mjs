import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createWindowLayoutAutoTracker,
  windowLayoutTrackingTransitions,
} from './public/app/window-layout-auto-tracking.js';
import { createWorkspaceStore } from './public/app/workspace-store.js';
import { createSurfaceCoordinator, SURFACE_ROLE } from './public/app/workspace-surface-coordinator.js';

const W = 'W0000000000000001';

function state({ enabled = true, members = [], suppressed = [] } = {}) {
  return { windowLayouts: [{
    id: 'layout-a',
    tracking: { enabled, suppressedInstanceIds: suppressed },
    arrangement: { members },
  }] };
}

function makeTracker(overrides = {}) {
  let current = state();
  let writer = true;
  let readOnly = false;
  let token = '1:0';
  const calls = { read: 0, resolve: 0, observe: 0, commit: 0, persist: 0, cache: [], after: [] };
  const tracker = createWindowLayoutAutoTracker({
    getState: () => current,
    isWriter: () => writer,
    isReadOnly: () => readOnly,
    getOperationToken: () => token,
    readSnapshot: async () => {
      calls.read += 1;
      return { outcome: 'success', snapshot: { complete: false, windows: [{ windowInstanceId: W }] } };
    },
    resolveWindowInstance: async (windowInstanceId) => {
      calls.resolve += 1;
      return { outcome: 'success', capability: { runtimeToken: 'cap-1' }, descriptor: { version: 1, title: 'Notepad', windowInstanceId } };
    },
    observeWindowCapability: async () => {
      calls.observe += 1;
      return { outcome: 'success', observation: { bounds: { x: 1 }, state: 'normal' } };
    },
    addMember: (latest, layoutId, member) => ({
      ...latest,
      windowLayouts: latest.windowLayouts.map((layout) => layout.id === layoutId
        ? { ...layout, arrangement: { ...layout.arrangement, members: [...layout.arrangement.members, member] } }
        : layout),
    }),
    commitState: async (next) => {
      calls.commit += 1;
      current = next;
      return true;
    },
    persistState: async () => {
      calls.persist += 1;
      return true;
    },
    cacheCapability: (...args) => calls.cache.push(args),
    afterCommit: async (layoutId) => calls.after.push(layoutId),
    createMemberId: () => 'member-new',
    ...overrides.dependencies,
  });
  return {
    tracker,
    calls,
    getState: () => current,
    setState: (next) => { current = next; },
    setWriter: (next) => { writer = next; },
    setReadOnly: (next) => { readOnly = next; },
    setToken: (next) => { token = next; },
  };
}

test('snapshot refresh uses identity snapshots only and accepts positive sightings from incomplete lists', async () => {
  const h = makeTracker();
  const result = await h.tracker.refresh();
  assert.deepEqual(result, { outcome: 'success', added: 1 });
  assert.equal(h.calls.read, 1);
  assert.equal(h.calls.resolve, 1);
  assert.equal(h.getState().windowLayouts[0].arrangement.members[0].descriptor.windowInstanceId, W);
  assert.deepEqual(h.calls.cache, [['layout-a', 'member-new', { runtimeToken: 'cap-1' }]]);
});

test('automatic population refuses view surfaces even when optimistic document writes are allowed', async () => {
  const h = makeTracker();
  h.setWriter(false);
  assert.deepEqual(await h.tracker.refresh(), { outcome: 'not-writer', added: 0 });
  assert.equal(h.calls.read, 0);
  assert.equal(h.calls.commit, 0);
});

test('an Auto-off transition during resolution invalidates the delayed addition', async () => {
  let release;
  const wait = new Promise((resolve) => { release = resolve; });
  const h = makeTracker({ dependencies: { resolveWindowInstance: async (windowInstanceId) => {
    await wait;
    return { outcome: 'success', capability: { runtimeToken: 'cap-1' }, descriptor: { version: 1, title: 'Notepad', windowInstanceId } };
  } } });
  const pending = h.tracker.addVisibleInstance('layout-a', W);
  await new Promise((resolve) => setImmediate(resolve));
  h.setState(state({ enabled: false }));
  h.setToken('1:1');
  release();
  assert.equal(await pending, false);
  assert.equal(h.calls.commit, 0);
  assert.deepEqual(h.calls.cache, []);
});

test('delayed observation rebases on current state instead of overwriting a concurrent edit', async () => {
  let release;
  const wait = new Promise((resolve) => { release = resolve; });
  const h = makeTracker({ dependencies: { observeWindowCapability: async () => {
    await wait;
    return { outcome: 'success', observation: { state: 'normal' } };
  } } });
  const pending = h.tracker.addVisibleInstance('layout-a', W);
  await new Promise((resolve) => setImmediate(resolve));
  const withConcurrentEdit = state({ members: [{ id: 'peer-edit', descriptor: { title: 'Other' } }] });
  h.setState(withConcurrentEdit);
  release();
  assert.equal(await pending, true);
  assert.deepEqual(h.getState().windowLayouts[0].arrangement.members.map((member) => member.id), ['peer-edit', 'member-new']);
});

test('a transient exact-resolution failure is retried while the identity stays visible', async () => {
  let attempts = 0;
  const h = makeTracker({ dependencies: { resolveWindowInstance: async (windowInstanceId) => {
    attempts += 1;
    if (attempts === 1) return { outcome: 'timeout' };
    return { outcome: 'success', capability: { runtimeToken: 'cap-1' }, descriptor: { version: 1, title: 'Notepad', windowInstanceId } };
  } } });
  assert.deepEqual(await h.tracker.refresh(), { outcome: 'success', added: 0 });
  assert.deepEqual(await h.tracker.refresh(), { outcome: 'success', added: 1 });
  assert.equal(attempts, 2);
  assert.equal(h.calls.commit, 1);
});

test('Auto membership retries after real store/coordinator CAS drops and preserves a peer edit', async () => {
  const initial = {
    schemaVersion: 1,
    groups: [],
    shortcuts: [],
    windowLayouts: state().windowLayouts,
    view: {},
  };
  let live = structuredClone(initial);
  let diskState = structuredClone(initial);
  let revision = 'r0';
  let revisionNumber = 0;
  let raceWrites = true;
  let racingWrites = 0;
  const host = {
    async loadVersioned() { return { state: structuredClone(diskState), revision }; },
    async saveChecked(serialized, expectedRevision) {
      if (raceWrites) {
        racingWrites += 1;
        diskState = { ...diskState, groups: [...diskState.groups, { id: `racer-${racingWrites}` }] };
        revision = `r${++revisionNumber}`;
      }
      if (expectedRevision !== revision) return { ok: false, code: 'STALE_REVISION', revision };
      diskState = JSON.parse(serialized);
      revision = `r${++revisionNumber}`;
      return { ok: true, revision };
    },
  };
  const coordinator = createSurfaceCoordinator({
    lock: { async request() { return { release() {} }; } },
    channel: { postMessage() {}, addEventListener() {}, removeEventListener() {} },
    host,
    installDocument: (next) => { live = next; },
    invalidatePendingSaves: () => null,
    newClientId: () => 'auto-test-writer',
  });
  await coordinator.start();
  let store;
  const cache = [];
  const tracker = createWindowLayoutAutoTracker({
    getState: () => live,
    isWriter: () => coordinator.role === SURFACE_ROLE.WRITER,
    isReadOnly: () => false,
    getOperationToken: () => 'writer-1',
    readSnapshot: async () => ({
      outcome: 'success',
      snapshot: { complete: false, windows: [{ windowInstanceId: W }] },
    }),
    resolveWindowInstance: async (windowInstanceId) => ({
      outcome: 'success',
      capability: { runtimeToken: 'cap-1' },
      descriptor: { version: 1, title: 'Notepad', windowInstanceId },
    }),
    observeWindowCapability: async () => ({ outcome: 'success', observation: { state: 'normal' } }),
    addMember: (latest, layoutId, member) => ({
      ...latest,
      windowLayouts: latest.windowLayouts.map((layout) => layout.id === layoutId
        ? { ...layout, arrangement: { ...layout.arrangement, members: [...layout.arrangement.members, member] } }
        : layout),
    }),
    commitState: (next) => store.commit(next, {
      saveMetadata: { rebaseAutomaticSave: true },
      requireDurable: true,
    }),
    persistState: async (current) => {
      const result = await store.save(current, { rebaseAutomaticSave: true });
      return result?.ok === true && result.dropped !== true && result.superseded !== true;
    },
    cacheCapability: (...args) => cache.push(args),
    afterCommit: async () => {},
    createMemberId: () => 'auto-member-1',
  });
  store = createWorkspaceStore({
    getState: () => live,
    setState: (next) => { live = next; },
    persist: (serialized, metadata) => coordinator.saveSerialized(serialized, metadata),
    normalizeState: (next) => next,
  });

  assert.equal(await tracker.addVisibleInstance('layout-a', W), false);
  assert.equal(coordinator.role, SURFACE_ROLE.WRITER, 'bounded automatic CAS contention does not freeze the writer');
  assert.ok(racingWrites >= 4, 'the initial CAS and bounded rebase retries all raced');
  assert.equal(diskState.windowLayouts[0].arrangement.members.length, 0, 'the dropped membership was not durable');
  assert.equal(live.windowLayouts[0].arrangement.members[0].id, 'auto-member-1', 'store commit installed the optimistic member');
  assert.deepEqual(cache, [], 'a dropped member is not given a live capability');

  raceWrites = false;
  diskState = { ...diskState, groups: [...diskState.groups, { id: 'peer-edit' }] };
  revision = `r${++revisionNumber}`;
  assert.deepEqual(await tracker.refresh(), { outcome: 'success', added: 1 });
  assert.ok(diskState.groups.some((group) => group.id === 'peer-edit'), 'retry rebases without losing the unrelated disk edit');
  assert.equal(diskState.windowLayouts[0].arrangement.members[0].descriptor.windowInstanceId, W);
  assert.equal(cache.length, 1, 'capability is cached only after the retried write is accepted');
  coordinator.release();
});

test('peer document installation reports Auto enable transitions for writer-side population', () => {
  const previous = state({ enabled: false });
  const next = state({ enabled: true });
  assert.deepEqual(windowLayoutTrackingTransitions(previous, next), {
    enabled: ['layout-a'],
    disabled: [],
  });
  assert.deepEqual(windowLayoutTrackingTransitions(next, state({ enabled: false })), {
    enabled: [],
    disabled: ['layout-a'],
  });
});

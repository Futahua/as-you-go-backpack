import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkspaceStore } from './public/app/workspace-store.js';

function createHarness({ normalize = (s) => s } = {}) {
  let state = { items: ['root'] };
  const saved = [];
  const statuses = [];
  const prepares = [];
  const afterCommits = [];

  const store = createWorkspaceStore({
    getState: () => state,
    setState: (next) => { state = next; },
    persist: async (snapshot) => { saved.push(snapshot); },
    normalizeState: normalize,
    setStatus: (text) => statuses.push(text),
    prepare: (next) => {
      prepares.push(next);
      return { ...next, prepared: true };
    },
    afterCommit: () => { afterCommits.push(state); },
  });

  return {
    store, saved, statuses, prepares, afterCommits,
    getState: () => state,
  };
}

test('commit installs the prepared state and persists it', async () => {
  const h = createHarness();
  const ok = await h.store.commit({ items: ['a'] }, {});
  assert.equal(ok, true);
  assert.deepEqual(h.getState(), { items: ['a'], prepared: true });
  assert.equal(h.prepares.length, 1);
  assert.deepEqual(JSON.parse(h.saved[0]), { items: ['a'], prepared: true });
  assert.equal(h.statuses[h.statuses.length - 1], '');
});

test('commit pushes history and clears redo on a fresh edit', async () => {
  const h = createHarness();
  await h.store.commit({ items: ['a'] }, {});
  await h.store.commit({ items: ['b'] }, {});
  assert.equal(h.store.canUndo(), true);
  assert.equal(h.store.canRedo(), false);
});

test('undo restores the previous state and makes it redoable', async () => {
  const h = createHarness();
  await h.store.commit({ items: ['a'] }, {});
  await h.store.commit({ items: ['b'] }, {});
  await h.store.undo();
  assert.deepEqual(h.getState().items, ['a']);
  assert.equal(h.store.canRedo(), true);
  await h.store.redo();
  assert.deepEqual(h.getState().items, ['b']);
});

test('commit reports failure and status when persist rejects', async () => {
  let state = { items: ['root'] };
  const statuses = [];
  const store = createWorkspaceStore({
    getState: () => state,
    setState: (next) => { state = next; },
    persist: async () => { throw new Error('disk full'); },
    normalizeState: (s) => s,
    setStatus: (text) => statuses.push(text),
  });
  const ok = await store.commit({ items: ['x'] }, {});
  assert.equal(ok, false);
  assert.match(statuses[statuses.length - 1], /disk full/);
});

test('replace installs without touching history or persisting', () => {
  const h = createHarness();
  const result = h.store.replace({ items: ['z'] });
  assert.deepEqual(result.items, ['z']);
  assert.equal(h.saved.length, 0);
  assert.equal(h.store.canUndo(), false);
});

test('install normalizes the initial state', () => {
  let state = null;
  const store = createWorkspaceStore({
    getState: () => state,
    setState: (next) => { state = next; },
    persist: async () => {},
    normalizeState: (s) => ({ ...s, normalized: true }),
    setStatus: () => {},
  });
  store.install({ items: ['loaded'] });
  assert.deepEqual(state, { items: ['loaded'], normalized: true });
});

test('afterCommit runs after the new state is installed', async () => {
  const h = createHarness();
  await h.store.commit({ items: ['a'] }, {});
  assert.deepEqual(h.afterCommits, [{ items: ['a'], prepared: true }]);
});

test('save queue serializes saves in order despite varying latencies', async () => {
  const order = [];
  let state = {};
  const store = createWorkspaceStore({
    getState: () => state,
    setState: (next) => { state = next; },
    persist: async (snapshot) => {
      await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 12)));
      order.push(JSON.parse(snapshot).tag);
    },
    normalizeState: (s) => s,
    setStatus: () => {},
  });
  await Promise.all([
    store.save({ tag: 'a' }),
    store.save({ tag: 'b' }),
    store.save({ tag: 'c' }),
  ]);
  assert.deepEqual(order, ['a', 'b', 'c']);
});

test('save queue recovers after a failed save so later saves still run', async () => {
  const order = [];
  let state = {};
  let shouldFail = true;
  const store = createWorkspaceStore({
    getState: () => state,
    setState: (next) => { state = next; },
    persist: async (snapshot) => {
      if (shouldFail) {
        shouldFail = false;
        throw new Error('disk full');
      }
      order.push(JSON.parse(snapshot).tag);
    },
    normalizeState: (s) => s,
    setStatus: () => {},
  });
  await assert.rejects(store.save({ tag: 'a' }), /disk full/);
  await store.save({ tag: 'b' });
  await store.save({ tag: 'c' });
  assert.deepEqual(order, ['b', 'c']);
});

test('commit clears session selection and passes the session to prepare', async () => {
  let state = { items: ['root'] };
  let preparedSession = null;
  const store = createWorkspaceStore({
    getState: () => state,
    setState: (next) => { state = next; },
    persist: async () => {},
    normalizeState: (s) => s,
    setStatus: () => {},
    prepare: (next, session) => {
      preparedSession = session;
      return next;
    },
  });
  store.getSession().selected.add('a');
  store.getSession().selected.add('b');
  await store.commit({ items: ['next'] }, {});
  assert.equal(store.getSession().selected.size, 0);
  assert.equal(preparedSession, store.getSession());
});

test('updateSession merges changes into the session object', () => {
  let state = {};
  const store = createWorkspaceStore({
    getState: () => state,
    setState: (next) => { state = next; },
    persist: async () => {},
    normalizeState: (s) => s,
    setStatus: () => {},
  });
  store.updateSession({ selectionAnchor: 'x' });
  assert.equal(store.getSession().selectionAnchor, 'x');
});

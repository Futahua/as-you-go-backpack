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
  store.setSelection(['a', 'b']);
  await store.commit({ items: ['next'] }, {});
  assert.equal(store.getSession().selected.size, 0);
  assert.equal(preparedSession, store.getSession());
});

test('explicit session operations drive selection and clipboard', () => {
  let state = {};
  const store = createWorkspaceStore({
    getState: () => state,
    setState: (next) => { state = next; },
    persist: async () => {},
    normalizeState: (s) => s,
    setStatus: () => {},
  });
  store.setSelection(['a', 'b']);
  assert.deepEqual([...store.getSession().selected], ['a', 'b']);
  store.addToSelection('c');
  assert.ok(store.getSession().selected.has('c'));
  store.removeFromSelection('a');
  assert.ok(!store.getSession().selected.has('a'));
  store.clearSelection();
  assert.equal(store.getSession().selected.size, 0);
  store.setSelectionAnchor('z');
  assert.equal(store.getSession().selectionAnchor, 'z');
  store.setClipboard({ mode: 'copy', ids: ['a'] });
  assert.equal(store.getSession().clipboard.mode, 'copy');
});

test('setNavigation and graph expansion operations update the session', () => {
  let state = {};
  const store = createWorkspaceStore({
    getState: () => state,
    setState: (next) => { state = next; },
    persist: async () => {},
    normalizeState: (s) => s,
    setStatus: () => {},
  });
  store.setNavigation({ currentId: 'folder-1', binMode: true });
  assert.equal(store.getSession().currentId, 'folder-1');
  assert.equal(store.getSession().binMode, true);

  store.setGraphExpanded(['g1']);
  assert.deepEqual([...store.getSession().graphExpanded], ['g1']);
  store.toggleGraphExpanded('g2');
  assert.ok(store.getSession().graphExpanded.has('g2'));
  store.toggleGraphExpanded('g1');
  assert.ok(!store.getSession().graphExpanded.has('g1'));
});

test('initialSession seeds navigation and bin session state', () => {
  let state = {};
  const store = createWorkspaceStore({
    getState: () => state,
    setState: (next) => { state = next; },
    persist: async () => {},
    normalizeState: (s) => s,
    setStatus: () => {},
    initialSession: { currentId: 'ROOT', binMode: true, binCurrentId: 'bin-deep' },
  });
  assert.equal(store.getSession().currentId, 'ROOT');
  assert.equal(store.getSession().binMode, true);
  assert.equal(store.getSession().binCurrentId, 'bin-deep');
});

test('a throwing normalizeState leaves the current selection untouched', async () => {
  let state = { items: ['root'] };
  const store = createWorkspaceStore({
    getState: () => state,
    setState: (next) => { state = next; },
    persist: async () => {},
    normalizeState: () => { throw new Error('bad state'); },
    setStatus: () => {},
  });
  const session = store.getSession();
  session.selected.add('keep-me');
  await assert.rejects(
    async () => store.commit({ items: ['broken'] }, {}),
    /bad state/,
  );
  // Selection survived the failed commit: it was cleared only after the
  // initial normalization succeeded.
  assert.ok(session.selected.has('keep-me'));
});

test('save queue waits for an in-flight save before starting the next one', async () => {
  const order = [];
  let state = {};
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  let firstStarted = false;
  let secondStarted = false;
  const store = createWorkspaceStore({
    getState: () => state,
    setState: (next) => { state = next; },
    persist: async (snapshot) => {
      if (!firstStarted) {
        firstStarted = true;
        order.push('a');
        await firstGate;
        return;
      }
      if (!secondStarted) {
        secondStarted = true;
        order.push('b');
      }
    },
    normalizeState: (s) => s,
    setStatus: () => {},
  });
  const first = store.save({ tag: 'a' });
  const second = store.save({ tag: 'b' });
  await Promise.resolve();
  assert.equal(secondStarted, false, 'save B must not start before save A resolves');
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(order, ['a', 'b']);
});

test('save queue runs a queued save even after the previous save rejects', async () => {
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
  // Queue save B before save A rejects, so recovery is exercised through the
  // queue rather than a fresh call.
  const first = store.save({ tag: 'a' });
  const second = store.save({ tag: 'b' });
  await assert.rejects(first, /disk full/);
  await second;
  assert.deepEqual(order, ['b']);
});

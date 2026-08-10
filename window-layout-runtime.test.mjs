import assert from 'node:assert/strict';
import test from 'node:test';

import { createWindowLayoutRuntime } from './public/app/window-layout-runtime.js';

const descriptor = (title) => ({ version: 1, title, executableFingerprint: title.repeat(64).slice(0, 64) });
const member = (id, title, bounds, state = 'normal') => ({ id, descriptor: descriptor(title), bounds, state });

function fixtures() {
  return {
    L1: { id: 'L1', arrangement: { members: [member('a1', 'A', { x: 1, y: 2, width: 300, height: 200 })] } },
    L2: { id: 'L2', arrangement: { members: [member('a2', 'A', { x: 9, y: 8, width: 400, height: 250 }, 'minimized'), member('b2', 'B', { x: 20, y: 30, width: 500, height: 300 })] } },
  };
}

function harness(overrides = {}) {
  const layouts = fixtures();
  const calls = [];
  const persisted = [];
  const observations = [];
  const results = [];
  const intervals = new Map();
  let nextTimer = 1;
  const host = {
    resolveWindowDescriptor: async (value) => {
      calls.push(['resolve', value.title]);
      return { outcome: 'success', capability: { title: value.title } };
    },
    applyWindowCapability: async (capability, bounds) => {
      calls.push(['apply', capability.title, bounds]);
      return { outcome: 'success' };
    },
    minimizeWindowCapability: async (capability) => {
      calls.push(['minimize', capability.title]);
      return { outcome: 'success' };
    },
    restoreWindowCapability: async (capability) => {
      calls.push(['restore', capability.title]);
      return { outcome: 'success' };
    },
    observeWindowCapability: async (capability) => {
      calls.push(['observe', capability.title]);
      return { outcome: 'success', observation: { bounds: { x: 1, y: 2, width: 300, height: 200 }, state: 'normal' } };
    },
  };
  Object.assign(host, overrides.host ?? {});
  const runtime = createWindowLayoutRuntime({
    getLayout: (id) => layouts[id] ?? null,
    host,
    persistActiveLayout: async (id) => persisted.push(id),
    persistObservation: (...args) => observations.push(args),
    onMemberResult: (result) => results.push(result),
    setIntervalFn: (callback) => { const id = nextTimer++; intervals.set(id, callback); return id; },
    clearIntervalFn: (id) => intervals.delete(id),
  });
  return { runtime, layouts, calls, persisted, observations, results, intervals };
}

test('switch applies members in persisted order and records every success', async () => {
  const h = harness();
  const result = await h.runtime.switchTo('L2');
  assert.equal(result.outcome, 'success');
  assert.deepEqual(h.persisted, ['L2']);
  assert.deepEqual(h.calls.slice(0, 6).map(([kind, title]) => [kind, title]), [
    ['resolve', 'A'], ['apply', 'A'], ['minimize', 'A'],
    ['resolve', 'B'], ['apply', 'B'], ['restore', 'B'],
  ]);
  assert.deepEqual(h.runtime.getSnapshot().recordingMemberIds, ['a2', 'b2']);
});

test('L1 -> L2 -> L1 uses independent saved geometry and one timer', async () => {
  const h = harness();
  await h.runtime.switchTo('L1');
  await h.runtime.switchTo('L2');
  await h.runtime.switchTo('L1');
  assert.deepEqual(h.calls.filter(([kind]) => kind === 'apply').map(([, , bounds]) => bounds), [
    { x: 1, y: 2, width: 300, height: 200 },
    { x: 9, y: 8, width: 400, height: 250 },
    { x: 20, y: 30, width: 500, height: 300 },
    { x: 1, y: 2, width: 300, height: 200 },
  ]);
  assert.equal(h.intervals.size, 1);
});

test('partial and zero-success switches retain the selected id but start no timer for zero', async () => {
  const h = harness({
    host: {
      resolveWindowDescriptor: async (value) => value.title === 'A'
        ? { outcome: 'success', capability: { title: 'A' } }
        : { outcome: 'ambiguous', error: 'duplicate' },
    },
  });
  const partial = await h.runtime.switchTo('L2');
  assert.equal(partial.outcome, 'partial');
  assert.deepEqual(h.runtime.getSnapshot().recordingMemberIds, ['a2']);
  await h.runtime.switchTo('L1');
  assert.equal(h.runtime.getSnapshot().timerActive, true);
  const zero = harness({ host: { resolveWindowDescriptor: async () => ({ outcome: 'missing' }) } });
  const result = await zero.runtime.switchTo('L1');
  assert.equal(result.outcome, 'partial');
  assert.equal(zero.runtime.getSnapshot().activeLayoutId, 'L1');
  assert.equal(zero.runtime.getSnapshot().timerActive, false);
});

test('stale switch results cannot become active or start a timer', async () => {
  let release;
  let resolveCalls = 0;
  const h = harness({
    host: {
      resolveWindowDescriptor: () => {
        resolveCalls += 1;
        if (resolveCalls === 1) {
          return new Promise((resolve) => { release = () => resolve({ outcome: 'success', capability: { title: 'A' } }); });
        }
        return Promise.resolve({ outcome: 'success', capability: { title: 'A' } });
      },
    },
  });
  const first = h.runtime.switchTo('L1');
  const second = h.runtime.switchTo('L2');
  await new Promise((resolve) => setImmediate(resolve));
  release();
  assert.equal((await first).outcome, 'superseded');
  assert.equal((await second).outcome, 'success');
  assert.equal(h.runtime.getSnapshot().activeLayoutId, 'L2');
});

test('matching application echo is swallowed once, then the next move records', async () => {
  const h = harness({ host: {
    observeWindowCapability: async () => ({ outcome: 'success', observation: { bounds: { x: 1, y: 2, width: 300, height: 200 }, state: 'normal' } }),
  } });
  await h.runtime.switchTo('L1');
  await h.runtime.observeActiveMembers();
  assert.equal(h.observations.length, 0);
  assert.equal(h.runtime.getSnapshot().suppressionKeys.length, 0);
  // The next real observation is accepted after the one-shot suppression.
  const next = h.runtime.observeActiveMembers();
  await next;
  assert.equal(h.observations.length, 1);
});

test('capability invalidation followed by retry re-resolves the selected layout', async () => {
  const h = harness();
  await h.runtime.switchTo('L1');
  const resolvesBefore = h.calls.filter(([kind]) => kind === 'resolve').length;
  h.runtime.invalidateCapabilities('L1');
  await h.runtime.retry();
  const resolvesAfter = h.calls.filter(([kind]) => kind === 'resolve').length;
  assert.equal(resolvesAfter, resolvesBefore + 1);
  assert.equal(h.runtime.getSnapshot().activeLayoutId, 'L1');
});

test('minimized observations preserve the saved restore bounds and stop cleans up', async () => {
  const h = harness({ host: {
    observeWindowCapability: async () => ({ outcome: 'success', observation: { bounds: { x: 0, y: 0, width: 1, height: 1 }, state: 'minimized' } }),
  } });
  await h.runtime.switchTo('L1');
  // Consume the normal application echo first.
  await h.runtime.observeActiveMembers();
  await h.runtime.observeActiveMembers();
  assert.deepEqual(h.observations.at(-1), ['L1', 'a1', { state: 'minimized' }]);
  await h.runtime.stop();
  assert.deepEqual(h.persisted.at(-1), null);
  assert.equal(h.intervals.size, 0);
  assert.equal(h.runtime.getSnapshot().capabilityKeys.length, 0);
});

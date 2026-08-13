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
  const intents = [];
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
    onRetireMember: (intent) => intents.push(intent),
    setIntervalFn: (callback) => { const id = nextTimer++; intervals.set(id, callback); return id; },
    clearIntervalFn: (id) => intervals.delete(id),
  });
  return { runtime, layouts, calls, persisted, observations, results, intents, intervals };
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
test('018X3 stop drains an in-flight switch apply before resolving (real stop barrier)', async () => {
  let releaseApply;
  const applyGate = new Promise((resolve) => { releaseApply = resolve; });
  const h = harness({ host: {
    applyWindowCapability: async (capability, bounds) => { await applyGate; return { outcome: 'success' }; },
  } });
  const switching = h.runtime.switchTo('L1');
  await new Promise((resolve) => setImmediate(resolve));
  let stopped = false;
  const stopping = h.runtime.stop().then(() => { stopped = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stopped, false, 'stop awaits the in-flight switch apply');
  releaseApply();
  await switching;
  await stopping;
  assert.equal(stopped, true, 'stop resolves only after the apply settles');
  assert.equal(h.intervals.size, 0);
});

test('018X3 stop drains an in-flight observation before resolving (real stop barrier)', async () => {
  let releaseObserve;
  const observeGate = new Promise((resolve) => { releaseObserve = resolve; });
  const h = harness({ host: {
    observeWindowCapability: async () => { await observeGate; return { outcome: 'success', observation: { bounds: { x: 1, y: 2, width: 300, height: 200 }, state: 'normal' } }; },
  } });
  await h.runtime.switchTo('L1');
  const timer = [...h.intervals.values()][0];
  timer(); // drive one observation tick into flight
  await new Promise((resolve) => setImmediate(resolve));
  let stopped = false;
  const stopping = h.runtime.stop().then(() => { stopped = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stopped, false, 'stop awaits the in-flight observation');
  releaseObserve();
  await stopping;
  assert.equal(stopped, true, 'stop resolves only after the observation settles');
});

// ---- 019B/019HR member retirement policy (pure controller) ------------------
// 019HR: a `missing` observe is only a GENUINE miss when a fresh re-resolution
// of the member's persisted descriptor CONFIRMS the window is missing. The
// retirement tests therefore supply an explicit resolve sequence: the first
// resolve (switch/applyMember) confirms a live window, and each subsequent
// resolve (the observe-time re-resolution) reports the stale-binding verdict.

function missingHarness(observeSequence, resolveSequence = []) {
  let observeIndex = 0;
  let resolveIndex = 0;
  return harness({
    host: {
      observeWindowCapability: async () => observeSequence[observeIndex++ % observeSequence.length],
      resolveWindowDescriptor: async (value) => {
        if (resolveSequence.length === 0) return { outcome: 'success', capability: { title: value.title } };
        return resolveSequence[Math.min(resolveIndex++, resolveSequence.length - 1)];
      },
    },
  });
}

test('019B emits one typed retirement intent after exactly two confirmed missing', async () => {
  const h = missingHarness([
    { outcome: 'missing', error: 'gone' },
    { outcome: 'missing', error: 'gone' },
  ], [
    { outcome: 'success', capability: { title: 'A' } }, // switch a1
    { outcome: 'missing', error: 'gone' }, // obs1 re-resolve confirms gone (1)
    { outcome: 'missing', error: 'gone' }, // obs2 re-resolve confirms gone (2) -> retire
  ]);
  await h.runtime.switchTo('L1');
  assert.equal(h.runtime.getSnapshot().timerActive, true);
  await h.runtime.observeActiveMembers(); // first confirmed missing
  assert.equal(h.intents.length, 0, 'one confirmed missing does not retire');
  await h.runtime.observeActiveMembers(); // second confirmed missing
  assert.equal(h.intents.length, 1);
  assert.deepEqual(h.intents[0], { layoutId: 'L1', memberId: 'a1', outcome: 'retire', consecutiveMissing: 2 });
  // A later observation of the retired member is a no-op: no helper round-trip,
  // no second intent.
  const observesBefore = h.calls.filter(([kind]) => kind === 'observe').length;
  await h.runtime.observeActiveMembers();
  assert.equal(h.calls.filter(([kind]) => kind === 'observe').length, observesBefore, 'retired member is not re-observed');
  assert.equal(h.intents.length, 1, 'one removal intent only');
});

test('019B the controller continues after the first missing and a later success records', async () => {
  const h = missingHarness([
    { outcome: 'missing', error: 'gone' },
    { outcome: 'success', observation: { bounds: { x: 100, y: 120, width: 320, height: 220 }, state: 'normal' } },
  ], [
    { outcome: 'success', capability: { title: 'A' } }, // switch a1
    { outcome: 'missing', error: 'gone' }, // obs1 re-resolve confirms gone (1)
    { outcome: 'success', capability: { title: 'A', generation: 2 } }, // obs2 re-resolve recovers
  ]);
  await h.runtime.switchTo('L1');
  await h.runtime.observeActiveMembers(); // missing (1 confirmed)
  assert.equal(h.runtime.getSnapshot().timerActive, true, 'timer stays after the first confirmed missing');
  assert.deepEqual(h.runtime.getSnapshot().recordingMemberIds, ['a1']);
  assert.equal(h.intents.length, 0);
  await h.runtime.observeActiveMembers(); // no capability -> re-resolve recovers (streak cleared)
  assert.equal(h.intents.length, 0, 'a recovery clears the streak without retiring');
  await h.runtime.observeActiveMembers(); // success -> recorded
  assert.deepEqual(h.observations.at(-1), ['L1', 'a1', { state: 'normal', bounds: { x: 100, y: 120, width: 320, height: 220 } }]);
  assert.equal(h.intents.length, 0, 'a success clears the streak');
});

test('019B a success resets the streak; a new confirmed-missing pair emits a new intent', async () => {
  const h = missingHarness([
    { outcome: 'missing', error: 'gone' },
    { outcome: 'success', observation: { bounds: { x: 100, y: 120, width: 320, height: 220 }, state: 'normal' } },
    { outcome: 'missing', error: 'gone' },
    { outcome: 'missing', error: 'gone' },
  ], [
    { outcome: 'success', capability: { title: 'A' } }, // switch a1
    { outcome: 'missing', error: 'gone' }, // obs1 re-resolve (1)
    { outcome: 'success', capability: { title: 'A', generation: 2 } }, // obs2 re-resolve recovers
    { outcome: 'missing', error: 'gone' }, // obs4 re-resolve (1 again)
    { outcome: 'missing', error: 'gone' }, // obs5 re-resolve (2) -> retire
  ]);
  await h.runtime.switchTo('L1');
  await h.runtime.observeActiveMembers(); // missing (1 confirmed)
  await h.runtime.observeActiveMembers(); // re-resolve recovers (streak cleared)
  await h.runtime.observeActiveMembers(); // success -> recorded (streak stays cleared)
  assert.equal(h.intents.length, 0);
  await h.runtime.observeActiveMembers(); // missing (1 again)
  assert.equal(h.intents.length, 0);
  await h.runtime.observeActiveMembers(); // missing (2 confirmed) -> retire
  assert.equal(h.intents.length, 1);
  assert.equal(h.intents[0].consecutiveMissing, 2);
});

test('019B/019HR timeout/helper-unavailable/denied re-resolution never counts as missing', async () => {
  const h = missingHarness([
    { outcome: 'missing', error: 'gone' },
    { outcome: 'missing', error: 'gone' },
    { outcome: 'missing', error: 'gone' },
    { outcome: 'missing', error: 'gone' },
    { outcome: 'missing', error: 'gone' },
    { outcome: 'missing', error: 'gone' },
  ], [
    { outcome: 'success', capability: { title: 'A' } }, // switch a1
    { outcome: 'timeout', error: 'slow' }, // obs1 re-resolve: transient, not counted
    { outcome: 'helper-unavailable', error: 'down' }, // obs2
    { outcome: 'denied', error: 'no' }, // obs3
    { outcome: 'timeout', error: 'slow' }, // obs4
    { outcome: 'missing', error: 'gone' }, // obs5 re-resolve confirms gone (1)
    { outcome: 'missing', error: 'gone' }, // obs6 re-resolve confirms gone (2) -> retire
  ]);
  await h.runtime.switchTo('L1');
  await h.runtime.observeActiveMembers(); // missing observe, re-resolve timeout: preserved
  await h.runtime.observeActiveMembers(); // helper-unavailable: preserved
  await h.runtime.observeActiveMembers(); // denied: preserved
  await h.runtime.observeActiveMembers(); // timeout: preserved
  assert.equal(h.intents.length, 0, 'no removal on transient re-resolutions');
  await h.runtime.observeActiveMembers(); // confirmed missing (1)
  assert.equal(h.intents.length, 0, 'one confirmed miss does not retire');
  await h.runtime.observeActiveMembers(); // confirmed missing (2) -> retire
  assert.equal(h.intents.length, 1, 'transient re-resolutions preserved the streak, never removed');
  assert.equal(h.intents[0].consecutiveMissing, 2);
});

test('019B retirement is member-independent', async () => {
  const h = missingHarness([
    { outcome: 'missing', error: 'gone' }, // a2 missing 1 (confirmed)
    { outcome: 'success', observation: { bounds: { x: 20, y: 30, width: 500, height: 300 }, state: 'normal' } }, // b2 success
    { outcome: 'missing', error: 'gone' }, // a2 missing 2 (confirmed) -> retire a2
    { outcome: 'success', observation: { bounds: { x: 20, y: 30, width: 500, height: 300 }, state: 'normal' } }, // b2 success
  ], [
    { outcome: 'success', capability: { title: 'A' } }, // switch a2
    { outcome: 'success', capability: { title: 'B' } }, // switch b2
    { outcome: 'missing', error: 'gone' }, // obs1 a2 re-resolve (1)
    { outcome: 'missing', error: 'gone' }, // obs2 a2 re-resolve (2) -> retire a2
  ]);
  await h.runtime.switchTo('L2');
  await h.runtime.observeActiveMembers(); // a2 missing(1), b2 success
  assert.equal(h.intents.length, 0);
  await h.runtime.observeActiveMembers(); // a2 missing(2) -> a2 retire; b2 success
  assert.equal(h.intents.length, 1);
  assert.deepEqual(h.intents[0], { layoutId: 'L2', memberId: 'a2', outcome: 'retire', consecutiveMissing: 2 });
  assert.equal(h.intents[0].memberId, 'a2', 'only the missing member is retired');
});

test('019B ownership stop/reset clears the tracker; a switch starts a fresh streak', async () => {
  const h = missingHarness([
    { outcome: 'missing', error: 'gone' },
  ], [
    { outcome: 'success', capability: { title: 'A' } }, // switch L1 a1
    { outcome: 'missing', error: 'gone' }, // obs1 a1 re-resolve (1)
    { outcome: 'success', capability: { title: 'A' } }, // switch L2 a2
    { outcome: 'success', capability: { title: 'B' } }, // switch L2 b2
    { outcome: 'success', capability: { title: 'A' } }, // switch L1 a1 again (fresh)
    { outcome: 'missing', error: 'gone' }, // obs2 a1 re-resolve (1 after reset)
    { outcome: 'missing', error: 'gone' }, // obs3 a1 re-resolve (2) -> retire
  ]);
  await h.runtime.switchTo('L1');
  await h.runtime.observeActiveMembers(); // a1 missing (1)
  assert.equal(h.intents.length, 0);
  // Ownership reset via switch: a fresh active layout clears the counter.
  await h.runtime.switchTo('L2');
  await h.runtime.switchTo('L1');
  await h.runtime.observeActiveMembers(); // a1 missing (1 again after reset)
  await h.runtime.observeActiveMembers(); // a1 missing (2) -> retire
  assert.equal(h.intents.length, 1);
  // stop() resets the tracker entirely.
  await h.runtime.stop();
  assert.equal(h.intents.length, 1, 'stop never emits retirement intents');
  assert.equal(h.runtime.getSnapshot().timerActive, false);
});

test('019B no counters/runtime keys are persisted or exposed in the snapshot', async () => {
  const h = missingHarness([
    { outcome: 'missing', error: 'gone' },
    { outcome: 'missing', error: 'gone' },
    { outcome: 'missing', error: 'gone' },
  ], [
    { outcome: 'success', capability: { title: 'A' } }, // switch a1
    { outcome: 'missing', error: 'gone' }, // obs1 (1)
    { outcome: 'missing', error: 'gone' }, // obs2 (2) -> retire
  ]);
  await h.runtime.switchTo('L1');
  await h.runtime.observeActiveMembers();
  await h.runtime.observeActiveMembers();
  assert.equal(h.intents.length, 1);
  const snapshot = h.runtime.getSnapshot();
  assert.deepEqual(Object.keys(snapshot).sort(), [
    'activeLayoutId', 'capabilityKeys', 'generation', 'recordingMemberIds', 'suppressionKeys', 'timerActive',
  ]);
  for (const persisted of h.persisted) {
    assert.ok(!JSON.stringify(persisted).includes('missingCounts'));
    assert.ok(!JSON.stringify(persisted).includes('retired'));
  }
  for (const observation of h.observations) {
    assert.ok(!JSON.stringify(observation).includes('missingCounts'));
    assert.ok(!JSON.stringify(observation).includes('retired'));
  }
});

// ---- 019HR stale-binding retirement (product fix) ---------------------------

test('019HR stale session capabilities after a helper restart never retire a live member', async () => {
  const h = missingHarness([
    { outcome: 'missing', error: 'stale' },
    { outcome: 'missing', error: 'stale' },
    { outcome: 'missing', error: 'stale' },
  ], [
    { outcome: 'success', capability: { title: 'A', generation: 1 } }, // switch a1
    { outcome: 'success', capability: { title: 'A', generation: 2 } }, // obs1 stale -> re-resolve LIVE -> recovered
    { outcome: 'success', capability: { title: 'A', generation: 3 } }, // obs2 stale -> re-resolve LIVE -> recovered
    { outcome: 'success', capability: { title: 'A', generation: 4 } }, // obs3 stale -> re-resolve LIVE -> recovered
  ]);
  await h.runtime.switchTo('L1');
  await h.runtime.observeActiveMembers(); // stale miss -> recovered
  await h.runtime.observeActiveMembers(); // stale miss -> recovered
  await h.runtime.observeActiveMembers(); // stale miss -> recovered
  assert.equal(h.intents.length, 0, 'stale misses must NEVER retire a live member');
  assert.equal(h.runtime.getSnapshot().timerActive, true, 'the member stays observed');
  assert.deepEqual(h.runtime.getSnapshot().recordingMemberIds, ['a1']);
});

test('019HR recovery replaces the stale capability before the next observe', async () => {
  const observedCapabilities = [];
  let resolveCalls = 0;
  const h = harness({
    host: {
      resolveWindowDescriptor: async (value) => {
        resolveCalls += 1;
        return { outcome: 'success', capability: { title: value.title, generation: resolveCalls } };
      },
      observeWindowCapability: async (capability) => {
        observedCapabilities.push(capability);
        // The session capability (generation 1) is stale after the helper
        // restart; the FRESH re-resolved capability observes successfully with
        // a state that differs from the applied suppression so it records.
        return capability.generation === 1
          ? { outcome: 'missing', error: 'stale' }
          : { outcome: 'success', observation: { bounds: { x: 1, y: 2, width: 300, height: 200 }, state: 'minimized' } };
      },
    },
  });
  await h.runtime.switchTo('L1'); // resolve gen 1 -> apply -> cache stale capability
  await h.runtime.observeActiveMembers(); // observe(gen 1) stale -> re-resolve gen 2 -> recovered
  await h.runtime.observeActiveMembers(); // observe(gen 2) -> success (differs from applied) -> recorded
  assert.equal(h.intents.length, 0, 'recovery never retires');
  assert.equal(observedCapabilities.length, 2);
  assert.equal(observedCapabilities[0].generation, 1, 'first observe used the stale session capability');
  assert.equal(observedCapabilities[1].generation, 2, 'recovery REPLACED the capability for the next observe');
  assert.equal(h.observations.length, 1, 'the recovered member records normally');
});

test('019HR stale capabilities cannot retire ANY live member; closing exactly B retires only B once', async () => {
  const closed = new Set();
  let staleSession = true;
  let resolveCalls = 0;
  const h = harness({
    host: {
      resolveWindowDescriptor: async (value) => {
        resolveCalls += 1;
        if (closed.has(value.title)) return { outcome: 'missing', error: 'gone' };
        return { outcome: 'success', capability: { title: value.title, gen: resolveCalls } };
      },
      observeWindowCapability: async (capability) => {
        if (closed.has(capability.title)) return { outcome: 'missing', error: 'gone' };
        if (staleSession) return { outcome: 'missing', error: 'stale' };
        return { outcome: 'success', observation: { bounds: { x: 20, y: 30, width: 500, height: 300 }, state: 'normal' } };
      },
    },
  });
  await h.runtime.switchTo('L2'); // a2+b2 resolve (live), applied
  // Stale session capabilities: both members observe missing, but the fresh
  // re-resolution confirms each window is LIVE -> recovered, never retired.
  for (let i = 0; i < 3; i += 1) await h.runtime.observeActiveMembers();
  assert.equal(h.intents.length, 0, 'stale misses never retire any live member');
  assert.deepEqual(h.runtime.getSnapshot().recordingMemberIds, ['a2', 'b2']);
  // Recovery replaced the capabilities: the members are still observed and
  // never retired (echo suppression may consume the first identical success,
  // so the membership, not the raw record count, is the assertion).
  staleSession = false;
  await h.runtime.observeActiveMembers();
  assert.equal(h.intents.length, 0);
  assert.deepEqual(h.runtime.getSnapshot().recordingMemberIds, ['a2', 'b2'], 'both members stay observed after recovery');
  // Close exactly B: its fresh re-resolution now CONFIRMS missing.
  closed.add('B');
  await h.runtime.observeActiveMembers(); // a2 success; b2 confirmed missing (1)
  assert.equal(h.intents.length, 0, 'one confirmed miss does not retire');
  await h.runtime.observeActiveMembers(); // a2 success; b2 confirmed missing (2) -> retire only B
  assert.equal(h.intents.length, 1);
  assert.deepEqual(h.intents[0], { layoutId: 'L2', memberId: 'b2', outcome: 'retire', consecutiveMissing: 2 });
  assert.equal(h.intents[0].memberId, 'b2', 'only the closed member is retired');
  // A remains live and observed.
  assert.deepEqual(h.runtime.getSnapshot().recordingMemberIds, ['a2', 'b2']);
  await h.runtime.observeActiveMembers(); // a2 success; b2 skipped (retired)
  assert.equal(h.intents.length, 1, 'no second intent for B');
});

test('019HR a helper-unavailable re-resolution never increments a genuine-missing streak', async () => {
  const h = missingHarness([
    { outcome: 'missing', error: 'stale' },
    { outcome: 'missing', error: 'stale' },
  ], [
    { outcome: 'success', capability: { title: 'A' } }, // switch a1
    { outcome: 'helper-unavailable', error: 'helper down' }, // obs1 re-resolve transient -> NOT counted
    { outcome: 'missing', error: 'gone' }, // obs2 re-resolve confirms gone (1)
  ]);
  await h.runtime.switchTo('L1');
  await h.runtime.observeActiveMembers(); // missing observe, re-resolution helper-unavailable -> preserved
  await h.runtime.observeActiveMembers(); // missing observe, re-resolution confirms gone (1)
  assert.equal(h.intents.length, 0, 'a transient re-resolution never counts as a genuine miss');
});

test('019HR2 reconcile resets the missing streak; only post-recovery confirmed misses retire', async () => {
  const h = missingHarness([
    { outcome: 'missing', error: 'gone' },
    { outcome: 'missing', error: 'gone' },
    { outcome: 'missing', error: 'gone' },
  ], [
    { outcome: 'success', capability: { title: 'A' } }, // switch a1
    { outcome: 'missing', error: 'gone' }, // obs1 re-resolve confirms gone (1)
    { outcome: 'success', capability: { title: 'A', generation: 2 } }, // reconcile resolves LIVE
    { outcome: 'missing', error: 'gone' }, // obs2 re-resolve confirms gone (1 again)
    { outcome: 'missing', error: 'gone' }, // obs3 re-resolve confirms gone (2) -> retire
  ]);
  await h.runtime.switchTo('L1');
  await h.runtime.observeActiveMembers(); // confirmed miss #1 (streak 1)
  assert.equal(h.intents.length, 0);
  await h.runtime.reconcileActive(); // proven-live reconcile resets retired + streak
  assert.equal(h.intents.length, 0);
  assert.deepEqual(h.runtime.getSnapshot().recordingMemberIds, ['a1']);
  await h.runtime.observeActiveMembers(); // one NEW confirmed miss after recovery
  assert.equal(h.intents.length, 0, 'a single post-recovery confirmed miss must NOT retire (streak was reset)');
  await h.runtime.observeActiveMembers(); // second post-recovery confirmed miss -> retire once
  assert.equal(h.intents.length, 1);
  assert.deepEqual(h.intents[0], { layoutId: 'L1', memberId: 'a1', outcome: 'retire', consecutiveMissing: 2 });
});

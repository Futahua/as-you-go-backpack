import assert from 'node:assert/strict';
import test from 'node:test';

import { createWindowLayoutAutoTracking } from './public/app/window-layout-auto-tracking.js';
import {
  createWindowLayout,
  setWindowLayoutInstanceSuppressed,
  setWindowLayoutTracking,
} from './public/workspace-model-20260730b.js';

const INSTANCE = 'W0123456789abcdef';
const descriptor = {
  version: 1,
  title: 'Notepad',
  executableFingerprint: 'a'.repeat(64),
  windowInstanceId: INSTANCE,
};

function stateWithAuto() {
  const layoutState = createWindowLayout({ groups: [], shortcuts: [], windowLayouts: [] }, { name: 'Auto' });
  const layout = layoutState.windowLayouts[0];
  return { ...setWindowLayoutTracking(layoutState, layout.id, true), layoutId: layout.id };
}

test('Auto lifecycle add resolves and observes a new exact window, then commits before publishing it', async () => {
  let state = stateWithAuto();
  const order = [];
  const auto = createWindowLayoutAutoTracking({
    getState: () => state,
    resolveWindowInstance: async (id) => {
      order.push(`resolve:${id}`);
      return { outcome: 'success', capability: { runtimeToken: 'ephemeral' }, descriptor };
    },
    observeWindowCapability: async (capability) => {
      order.push(`observe:${capability.runtimeToken}`);
      return { outcome: 'success', observation: { bounds: { x: 4, y: 8, width: 640, height: 480 }, state: 'normal' } };
    },
    commit: async (next) => {
      order.push('commit');
      state = next;
      return true;
    },
    createMemberId: () => 'member-1',
    onCommitted: async ({ layoutId, capability }) => order.push(`publish:${layoutId}:${capability.runtimeToken}`),
  });

  const result = await auto.addFromEvent({ kind: 'open', windowInstanceId: INSTANCE });
  assert.equal(result.outcome, 'added');
  const member = state.windowLayouts[0].arrangement.members[0];
  assert.equal(member.id, 'member-1');
  assert.deepEqual(member.descriptor, descriptor);
  assert.deepEqual(member.bounds, { x: 4, y: 8, width: 640, height: 480 });
  assert.equal(member.state, 'normal');
  assert.deepEqual(order, [`resolve:${INSTANCE}`, 'observe:ephemeral', 'commit', `publish:${state.layoutId}:ephemeral`]);
  assert.equal(JSON.stringify(state).includes('runtimeToken'), false, 'ephemeral host capability is never persisted');
});

test('Auto rechecks its owner after host waits and will not add after the creator disables it', async () => {
  let state = stateWithAuto();
  let releaseResolve;
  const resolved = new Promise((resolve) => { releaseResolve = resolve; });
  let commits = 0;
  const auto = createWindowLayoutAutoTracking({
    getState: () => state,
    resolveWindowInstance: () => resolved,
    observeWindowCapability: async () => ({ outcome: 'success', observation: {} }),
    commit: async (next) => { commits += 1; state = next; return true; },
    createMemberId: () => 'member-1',
  });
  const pending = auto.addFromEvent({ kind: 'open', windowInstanceId: INSTANCE });
  state = setWindowLayoutTracking(state, state.layoutId, false);
  releaseResolve({ outcome: 'success', capability: {}, descriptor });
  assert.deepEqual(await pending, { outcome: 'disabled' });
  assert.equal(commits, 0);
  assert.equal(state.windowLayouts[0].arrangement.members.length, 0);
});

test('Auto skips suppressed and already present window instances', async () => {
  let state = stateWithAuto();
  state = setWindowLayoutInstanceSuppressed(state, state.layoutId, INSTANCE, true);
  let resolveCalls = 0;
  const auto = createWindowLayoutAutoTracking({
    getState: () => state,
    resolveWindowInstance: async () => { resolveCalls += 1; return { outcome: 'success', capability: {}, descriptor }; },
    observeWindowCapability: async () => ({ outcome: 'success', observation: {} }),
    commit: async () => true,
  });
  assert.deepEqual(await auto.addFromEvent({ kind: 'open', windowInstanceId: INSTANCE }), { outcome: 'suppressed' });
  state = { ...state, windowLayouts: state.windowLayouts.map((layout) => ({ ...layout, tracking: { ...layout.tracking, suppressedInstanceIds: [] }, arrangement: { ...layout.arrangement, members: [{ id: 'existing', descriptor }] } })) };
  assert.deepEqual(await auto.addFromEvent({ kind: 'open', windowInstanceId: INSTANCE }), { outcome: 'duplicate' });
  assert.equal(resolveCalls, 0);
});

test('Auto leaves durable membership untouched when persistence refuses the new member', async () => {
  const state = stateWithAuto();
  let published = false;
  const auto = createWindowLayoutAutoTracking({
    getState: () => state,
    resolveWindowInstance: async () => ({ outcome: 'success', capability: {}, descriptor }),
    observeWindowCapability: async () => ({ outcome: 'success', observation: {} }),
    commit: async () => false,
    createMemberId: () => 'member-1',
    onCommitted: () => { published = true; },
  });
  assert.deepEqual(await auto.addFromEvent({ kind: 'open', windowInstanceId: INSTANCE }), { outcome: 'persistence-failed' });
  assert.equal(state.windowLayouts[0].arrangement.members.length, 0);
  assert.equal(published, false);
});

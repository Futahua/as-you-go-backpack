import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GLOBAL_INVOKE_REASON,
  QUICK_RUN_GLOBAL_INVOKE_IGNORE,
  globalInvokePayload,
  planQuickRunGlobalInvoke,
} from './public/app/quick-run/quick-run-global-invoke.js';

/**
 * The host's half of "Alt+A anywhere" belongs to Lane 4: it brings Papers to the front and relays a neutral
 * event, never learning what Quick Run is. This is the project side, and the two things it has to get right
 * are the reason filter and honesty about what a receiving surface can and cannot verify.
 */

test('only the accelerator reason opens anything', () => {
  assert.deepEqual(planQuickRunGlobalInvoke({ reason: GLOBAL_INVOKE_REASON }), { kind: 'invoke' });
  assert.deepEqual(
    planQuickRunGlobalInvoke({ reason: 'bring-to-front' }),
    { kind: 'ignore', reason: QUICK_RUN_GLOBAL_INVOKE_IGNORE.reason },
    'the same channel carries other neutral events, and they are not the command chord',
  );
  assert.deepEqual(
    planQuickRunGlobalInvoke({ reason: undefined }),
    { kind: 'ignore', reason: QUICK_RUN_GLOBAL_INVOKE_IGNORE.reason },
  );
  assert.deepEqual(planQuickRunGlobalInvoke({}), { kind: 'ignore', reason: QUICK_RUN_GLOBAL_INVOKE_IGNORE.reason });
});

test('projectId and surfaceId do not decide it, because a surface cannot verify either', () => {
  // Lane 4's caveat, measured rather than inherited: the payload's surfaceId is host-generated
  // (`sf-...`) and appears nowhere in the surface's own URL, which carries a different uuid. So a receiving
  // surface cannot tell "this one is me" from the ids, and a filter on them would either drop real
  // invocations or act on somebody else's. The ids ride along and change nothing.
  const withIds = planQuickRunGlobalInvoke({
    reason: GLOBAL_INVOKE_REASON, projectId: 'bp-1', surfaceId: 'sf-2f79607b', chord: 'Alt+A',
  });
  assert.deepEqual(withIds, { kind: 'invoke' });
  assert.deepEqual(
    planQuickRunGlobalInvoke({ reason: GLOBAL_INVOKE_REASON }),
    withIds,
    'and the answer is the same with the ids absent',
  );
});

test('there is no focus filter, because the one that was tried filters nothing', () => {
  // This test exists to keep a rejected design rejected. `document.hasFocus()` was the first discriminator
  // for the two-surface case, and the host measured it useless: with Electron reporting the host view
  // focused and the project view not, the project view's `document.hasFocus()` was still true - it reports
  // the window's focus, so every surface in a focused window agrees. A filter that never filters would hide
  // the residual risk instead of stating it, so the planner takes no focus input at all.
  assert.equal(planQuickRunGlobalInvoke.length, 1, 'the planner takes the payload and nothing else');
  assert.deepEqual(
    planQuickRunGlobalInvoke({ reason: GLOBAL_INVOKE_REASON }, { hasFocus: false }),
    { kind: 'invoke' },
    'a second argument is ignored rather than silently reinstating the old rule',
  );
});

test('a missing or unusable payload passes rather than throwing', () => {
  for (const payload of [undefined, null, 'global-accelerator', 7, [], true]) {
    const plan = planQuickRunGlobalInvoke(payload);
    assert.equal(plan.kind, 'ignore', `${JSON.stringify(payload)} opens nothing`);
  }
  // The two named reasons, so a caller can tell "not our event" from "nothing to read".
  assert.equal(planQuickRunGlobalInvoke(null).reason, QUICK_RUN_GLOBAL_INVOKE_IGNORE.malformed);
  assert.equal(planQuickRunGlobalInvoke('nonsense').reason, QUICK_RUN_GLOBAL_INVOKE_IGNORE.malformed);
  assert.equal(
    planQuickRunGlobalInvoke([]).reason,
    QUICK_RUN_GLOBAL_INVOKE_IGNORE.reason,
    'an array is an object with no reason on it, which is the ordinary "not our event" answer',
  );
});

test('the payload is read from whatever the transport used', () => {
  // The bridge hands over `event.data.detail ?? event.data` and the host sends a flat payload, so the flat
  // shape is what arrives today. The wrapped one is still accepted: the relaying side is not in this
  // repository, and this must not be the thing that breaks when a transport detail changes.
  const fields = { type: 'papers:project:global-invoke', reason: GLOBAL_INVOKE_REASON, projectId: 'bp-1', surfaceId: 'sf-1', chord: 'Alt+A' };
  assert.deepEqual(globalInvokePayload(fields), fields);
  assert.deepEqual(globalInvokePayload({ detail: fields }), fields);
  assert.deepEqual(globalInvokePayload({ data: fields }), fields);
  assert.equal(globalInvokePayload({ detail: {} }), null, 'a carrier with no reason is not a carrier');
  assert.equal(globalInvokePayload(null), null);
  assert.deepEqual(globalInvokePayload({ detail: { unrelated: true }, data: fields }), fields);
});

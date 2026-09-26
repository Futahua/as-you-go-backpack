import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { createWidgetHoverPolicy } from './public/app/widget-hover-policy.js';
import { planWindowLayoutShiftPeekTransition } from './public/app/window-layout-shift-peek.js';

test('ordinary hovered Quick Run typing with Shift false has no Peek lifecycle; Shift begins and releases it once', () => {
  const member = { id: 'member-1' };
  const policy = createWidgetHoverPolicy({ publish: () => ({ outcome: 'success' }) });
  policy.updateWorkspacePolicy(true, []);
  policy.setHovered(true);
  const quickRunPlan = policy.planInput({
    key: 'q', shiftKey: false, ctrlKey: false, altKey: false, metaKey: false,
    repeat: false, isComposing: false,
  }, { blockedBindings: [] });
  assert.deepEqual(quickRunPlan, { kind: 'open', seed: 'q' });

  let held = false;
  const begins = [];
  let ends = 0;
  const apply = (transition) => {
    if (!transition.handled) return;
    held = transition.held;
    if (transition.begin) begins.push(transition.begin);
    if (transition.end) ends += 1;
  };
  for (const [source, event, context] of [
    ['keydown', { key: 'q', shiftKey: false, repeat: false }, { member }],
    ['hover', { shiftKey: false }, { member }],
    ['pointermove', { shiftKey: false }, { member }],
    ['keyup', { key: 'q', shiftKey: false }, { member }],
  ]) {
    apply(planWindowLayoutShiftPeekTransition(source, event, { held, ...context }));
  }
  assert.deepEqual(begins, []);
  assert.equal(ends, 0);

  apply(planWindowLayoutShiftPeekTransition('keydown', { key: 'Shift', shiftKey: true, repeat: false }, { held, member }));
  apply(planWindowLayoutShiftPeekTransition('keydown', { key: 'Shift', shiftKey: true, repeat: true }, { held, member }));
  apply(planWindowLayoutShiftPeekTransition('keyup', { key: 'Shift' }, { held, member }));
  assert.deepEqual(begins, [member], 'one non-repeat Shift press starts the intended member Peek');
  assert.equal(ends, 1, 'Shift release ends that Peek once');
});

test('the workspace routes every Shift Peek event source through the tested planner', async () => {
  const source = await readFile(new URL('./public/workspace-20260730b.js', import.meta.url), 'utf8');
  assert.match(source, /planWindowLayoutShiftPeekTransition\('keydown'/);
  assert.match(source, /planWindowLayoutShiftPeekTransition\('keyup'/);
  assert.match(source, /planWindowLayoutShiftPeekTransition\('blur'/);
  assert.match(source, /planWindowLayoutShiftPeekTransition\('hover'/);
  assert.match(source, /planWindowLayoutShiftPeekTransition\('pointermove'/);
  assert.equal([...source.matchAll(/host\.windowPeekBeginCapability\(/g)].length, 1,
    'only the guarded Peek execution path calls the host begin API');
});

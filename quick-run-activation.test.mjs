import test from 'node:test';
import assert from 'node:assert/strict';
import { openQuickRunSession, quickRunSessionWithQuery } from './public/app/quick-run/quick-run-session.js';
import { planQuickRunActivation, QUICK_RUN_DEFERRED_WINDOW_ACTIVATION, QUICK_RUN_ENTER_COMMAND } from './public/app/quick-run/quick-run-activation.js';

const state = {
  groups: [{ id: 'g-root', parentId: 'root', name: 'Workspace' }],
  shortcuts: [
    { id: 's-1', name: 'Docs', target: 'https://example.com/docs', placements: [{ id: 'p-1', parentId: 'g-root', order: 1 }] },
    { id: 's-2', name: 'Office', target: '/tmp/office.md', placements: [{ id: 'p-2', parentId: 'g-root', order: 2 }] },
  ],
  windowLayouts: [
    { id: 'l-1', parentId: 'g-root', name: 'Focus', arrangement: { members: [{ id: 'm-1', descriptor: { title: 'Chrome' } }] } },
  ],
};

const rowsFor = (query) => quickRunSessionWithQuery(openQuickRunSession(state), query).rows;

test('a folder row plans navigation through the command the workspace already owns', () => {
  const plan = planQuickRunActivation(rowsFor('workspace')[0]);
  assert.deepEqual(plan, { action: 'navigate-folder', command: QUICK_RUN_ENTER_COMMAND, target: { groupId: 'g-root' } });
});

test('a shortcut and a link plan the launch and the URL, each naming its occurrence', () => {
  const link = planQuickRunActivation(rowsFor('docs')[0]);
  assert.equal(link.action, 'open-link');
  assert.equal(link.target.url, 'https://example.com/docs');
  assert.deepEqual(link.target, { shortcutId: 's-1', placementId: 'p-1', url: 'https://example.com/docs' });

  const shortcut = planQuickRunActivation(rowsFor('office')[0]);
  assert.equal(shortcut.action, 'launch-shortcut');
  assert.deepEqual(shortcut.target, { shortcutId: 's-2', placementId: 'p-2' });
  assert.equal(shortcut.command, QUICK_RUN_ENTER_COMMAND, 'one implementation, not a Quick Run copy');
});

test('a layout member plans a window activation that is marked deferred, and says why', () => {
  const plan = planQuickRunActivation(rowsFor('chrome')[0]);
  assert.equal(plan.action, 'activate-window');
  assert.equal(plan.command, null, 'there is no existing command to reuse for this one');
  assert.equal(plan.deferred, QUICK_RUN_DEFERRED_WINDOW_ACTIVATION);
  assert.deepEqual(plan.target, { layoutId: 'l-1', memberId: 'm-1' });
});

test('an unknown row type plans nothing rather than something arbitrary', () => {
  assert.equal(planQuickRunActivation({ type: 'mystery' }), null);
  assert.equal(planQuickRunActivation(null), null);
  assert.equal(planQuickRunActivation(undefined), null);
});
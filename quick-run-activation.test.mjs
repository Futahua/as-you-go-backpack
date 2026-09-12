import test from 'node:test';
import assert from 'node:assert/strict';
import { openQuickRunSession, quickRunSessionWithQuery } from './public/app/quick-run/quick-run-session.js';
import {
  DESCRIPTOR_IDENTITY_FIELDS,
  planQuickRunActivation,
  planQuickRunReveal,
  planQuickRunShiftEnter,
  QUICK_RUN_TARGET_GONE,
  revalidateQuickRunRow,
  quickRunDuplicateMemberId,
  quickRunWorkspaceItemId,
  QUICK_RUN_ADD_ALREADY_PRESENT,
  QUICK_RUN_ADD_NO_ACTIVE_LAYOUT,
  QUICK_RUN_ADD_ONLY_LAYOUT_ITEMS,
  QUICK_RUN_DEFERRED_WINDOW_ACTIVATION,
  QUICK_RUN_ENTER_COMMAND,
} from './public/app/quick-run/quick-run-activation.js';

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

test('Shift+Enter is enabled only for layout items and never silently ignored (section 1.6)', () => {
  // The three ordinary results are visibly disabled, each with the reason that says why.
  for (const query of ['workspace', 'docs', 'office']) {
    const plan = planQuickRunShiftEnter(rowsFor(query)[0], { activeLayoutId: 'l-active' });
    assert.deepEqual(plan, { disabled: QUICK_RUN_ADD_ONLY_LAYOUT_ITEMS }, query);
  }
  // A layout item with no active layout says so rather than doing nothing.
  const member = rowsFor('chrome')[0];
  assert.deepEqual(planQuickRunShiftEnter(member, { activeLayoutId: null }), { disabled: QUICK_RUN_ADD_NO_ACTIVE_LAYOUT });
  assert.deepEqual(planQuickRunShiftEnter(member, {}), { disabled: QUICK_RUN_ADD_NO_ACTIVE_LAYOUT });
  // Already in that layout: reported, not duplicated.
  assert.deepEqual(
    planQuickRunShiftEnter(member, { activeLayoutId: 'l-active', alreadyInActiveLayout: true }),
    { disabled: QUICK_RUN_ADD_ALREADY_PRESENT },
  );
  // Otherwise it is an action, naming the member and the layout it would join.
  assert.deepEqual(planQuickRunShiftEnter(member, { activeLayoutId: 'l-active' }), {
    action: 'add-to-layout',
    command: 'window-layout.add-member',
    target: { layoutId: 'l-active', memberId: 'm-1', sourceLayoutId: 'l-1' },
  });
  // And no input at all still answers with a reason rather than nothing.
  assert.deepEqual(planQuickRunShiftEnter(null), { disabled: QUICK_RUN_ADD_ONLY_LAYOUT_ITEMS });
});

test('a target is re-read from the current state by stable key, not trusted from the index (section 5)', () => {
  const row = rowsFor('docs')[0];
  // The state as drawn: the re-read returns the same occurrence, freshly built.
  const fresh = revalidateQuickRunRow(state, row.resultKey);
  assert.equal(fresh.ok, true);
  assert.equal(fresh.row.resultKey, row.resultKey);
  assert.equal(fresh.row.name, 'Docs');

  // The workspace moves under the index: the shortcut is renamed. The re-read is what an action would
  // plan from, so it carries the new name while the indexed row still carries the old one.
  const renamed = {
    ...state,
    shortcuts: state.shortcuts.map((entry) => (entry.id === 's-1' ? { ...entry, name: 'Handbook' } : entry)),
  };
  const after = revalidateQuickRunRow(renamed, row.resultKey);
  assert.equal(after.ok, true);
  assert.equal(after.row.name, 'Handbook', 'the current state wins over the indexed payload');
  assert.equal(row.name, 'Docs', 'and the indexed row is left as it was, as a snapshot should be');

  // The occurrence is gone: the caller gets a reason rather than an action built on stale data.
  const removed = { ...state, shortcuts: state.shortcuts.filter((entry) => entry.id !== 's-1') };
  assert.deepEqual(revalidateQuickRunRow(removed, row.resultKey), { ok: false, reason: QUICK_RUN_TARGET_GONE });
  assert.deepEqual(revalidateQuickRunRow(state, ''), { ok: false, reason: QUICK_RUN_TARGET_GONE });
  assert.deepEqual(revalidateQuickRunRow(state, 'link:p-999'), { ok: false, reason: QUICK_RUN_TARGET_GONE });
});

test('Ctrl+Enter reveals the occurrence inside the workspace and never through the host (section 1.6)', () => {
  const folder = planQuickRunReveal({
    type: 'folder', resultKey: 'folder:g-2', groupId: 'g-2', breadcrumbIds: ['root', 'g-1'],
  });
  assert.deepEqual(folder, {
    action: 'reveal-folder', navigateTo: 'g-1', select: 'g-2', hostReveal: false,
  });

  const link = planQuickRunReveal({
    type: 'link', resultKey: 'link:p-2', shortcutId: 's-1', placementId: 'p-2', breadcrumbIds: ['root'],
  });
  assert.equal(link.action, 'reveal-placement');
  assert.equal(link.select, 's-1', 'the shared record is what gets selected');
  assert.equal(link.placementId, 'p-2', 'and the occurrence travels with it, so the reader sees which one');
  assert.equal(link.navigateTo, 'root');

  const member = planQuickRunReveal({
    type: 'layout-item', resultKey: 'layout-member:l-1:m-1', layoutId: 'l-1', memberId: 'm-1',
    breadcrumbIds: ['root', 'g-1'],
  });
  assert.equal(member.action, 'reveal-layout-member');
  assert.equal(member.select, 'l-1', 'the containing layout');
  assert.equal(member.memberId, 'm-1', 'and the member inside it');
  assert.equal(member.navigateTo, 'g-1');

  // The boundary, asserted on every branch rather than once: a caller following this plan cannot reach the
  // host file manager, which is what section 1.6 forbids.
  for (const plan of [folder, link, member]) {
    assert.equal(plan.hostReveal, false);
  }
  assert.equal(planQuickRunReveal({ type: 'unknown-thing' }), null, 'an unknown type reveals nothing');
  assert.equal(planQuickRunReveal(null), null);
  assert.equal(
    planQuickRunReveal({ type: 'folder', groupId: 'g-9' }).navigateTo,
    null,
    'a row with no persisted ancestry has nowhere to navigate to, and says so rather than guessing',
  );
});

test('the duplicate rule compares the identity a member declares, and only that (AUTHOR ruling, 2026-09-12)', () => {
  const active = { arrangement: { members: [
    { id: 'm-1', descriptor: { version: 1, title: 'Chrome', executableFingerprint: 'sha256:aaa' } },
    { id: 'm-2', descriptor: { version: 1, title: 'Chrome', executableFingerprint: 'sha256:bbb' } },
  ] } };

  // Both fields declared and both agreeing: the same window is already there.
  assert.equal(
    quickRunDuplicateMemberId({ title: 'Chrome', executableFingerprint: 'sha256:bbb' }, active.arrangement.members),
    'm-2',
    'and it names the member that represents it, so a caller can say which one',
  );
  // A declared fingerprint that differs is a different window, even with the same title.
  assert.equal(
    quickRunDuplicateMemberId({ title: 'Chrome', executableFingerprint: 'sha256:ccc' }, active.arrangement.members),
    null,
  );
  // Title alone declares less, so it matches the first member with that title.
  assert.equal(quickRunDuplicateMemberId({ title: 'Chrome' }, active.arrangement.members), 'm-1');
  assert.equal(quickRunDuplicateMemberId({ title: 'Firefox' }, active.arrangement.members), null);
  // Nothing declared is nothing to compare - not a duplicate, and not a match either.
  assert.equal(quickRunDuplicateMemberId({}, active.arrangement.members), null);
  assert.equal(quickRunDuplicateMemberId({ title: '   ' }, active.arrangement.members), null);
  assert.equal(quickRunDuplicateMemberId(null, active.arrangement.members), null);
  assert.equal(quickRunDuplicateMemberId({ title: 'Chrome' }, []), null);
  assert.equal(quickRunDuplicateMemberId({ title: 'Chrome' }, undefined), null);
  // The fields are the ones the model writes, in that order, and they are frozen.
  assert.deepEqual([...DESCRIPTOR_IDENTITY_FIELDS], ['title', 'executableFingerprint']);
  assert.equal(Object.isFrozen(DESCRIPTOR_IDENTITY_FIELDS), true);
});

test('a plan names the workspace item the existing open-selection command takes (section 6.4)', () => {
  const folder = planQuickRunActivation({ type: 'folder', groupId: 'g-2' });
  const shortcut = planQuickRunActivation({ type: 'shortcut', shortcutId: 's-1', placementId: 'p-1' });
  const link = planQuickRunActivation({ type: 'link', shortcutId: 's-1', placementId: 'p-2', target: 'https://example.com' });
  const layoutItem = planQuickRunActivation({ type: 'layout-item', layoutId: 'l-1', memberId: 'm-1' });

  assert.equal(quickRunWorkspaceItemId(folder), 'g-2', 'a folder is opened by its group id');
  assert.equal(quickRunWorkspaceItemId(shortcut), 's-1', 'a shortcut is launched by its record, not by the placement');
  assert.equal(quickRunWorkspaceItemId(link), 's-1', 'a link is the same record with a web target');
  assert.equal(quickRunWorkspaceItemId(layoutItem), null, 'a deferred Layout Item has no workspace id to hand over');
  assert.equal(quickRunWorkspaceItemId(null), null);
  assert.equal(quickRunWorkspaceItemId({ action: 'launch-shortcut', target: {} }), null);
});
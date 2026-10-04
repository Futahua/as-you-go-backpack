import assert from 'node:assert/strict';
import test from 'node:test';
import { createWindowLayoutWorkspaceCardInput } from './public/app/window-layout-workspace-card-input.js';

function eventFor(matches, overrides = {}) {
  return {
    button: 0, ctrlKey: false, shiftKey: false,
    preventDefault() {}, stopPropagation() {},
    target: { closest: (selector) => matches.get(selector) ?? null },
    ...overrides,
  };
}

function harness() {
  const calls = [];
  const detachedWidgets = new Set();
  let consume = false;
  let isolateActive = false;
  let controlReady = true;
  let unavailable = '';
  const owner = createWindowLayoutWorkspaceCardInput({
    detachedWidgets,
    consumeDragClick: () => { const value = consume; consume = false; return value; },
    isolateMode: {
      isActive: () => isolateActive,
      click: (...args) => { calls.push(['isolate-click', ...args]); return ['M']; },
    },
    handleMemberClick: (...args) => calls.push(['member-click', ...args]),
    handlePickCandidate: (...args) => calls.push(['pick', ...args]),
    unlinkMember: (...args) => calls.push(['unlink', ...args]),
    closePicker: () => calls.push(['picker-close']),
    cancelListDwell: () => calls.push(['list-cancel']),
    beginDirectPick: (...args) => calls.push(['direct', ...args]),
    toggleTracking: (...args) => calls.push(['track', ...args]),
    groupAction: (...args) => calls.push(['group', ...args]),
    closeWidget: async (...args) => calls.push(['widget-close', ...args]),
    openWidget: (...args) => calls.push(['widget-open', ...args]),
    render: () => calls.push(['render']),
    cancelPreview: () => calls.push(['preview-cancel']),
    closeMember: (...args) => calls.push(['member-close', ...args]),
    toggleIsolateMode: (...args) => calls.push(['isolate-toggle', ...args]),
    toggleRange: (...args) => calls.push(['range', ...args]),
    isControlReady: () => controlReady,
    controlUnavailable: () => unavailable,
    setStatus: (...args) => calls.push(['status', ...args]),
  });
  return {
    calls, owner, detachedWidgets,
    setConsume(value) { consume = value; },
    setIsolate(value) { isolateActive = value; },
    setControlReady(value, message = '') { controlReady = value; unavailable = message; },
  };
}

test('non-layout clicks fall through and a detached placeholder blocks everything except reattach', async () => {
  const h = harness();
  assert.equal(h.owner.handleClick(eventFor(new Map())), false);
  const body = { dataset: { wlLayout: 'L' } };
  h.detachedWidgets.add('L');
  const member = { dataset: { wlLayout: 'L', wlMember: 'M' } };
  assert.equal(h.owner.handleClick(eventFor(new Map([['.window-layout-body', body], ['[data-wl-member]', member]]))), true);
  assert.equal(h.calls.length, 0);
  const reattach = { dataset: { wlReattach: 'L' } };
  h.owner.handleClick(eventFor(new Map([['.window-layout-body', body], ['[data-wl-reattach]', reattach]])));
  await Promise.resolve();
  assert.deepEqual(h.calls, [['render'], ['widget-close', 'L']]);
});

test('member click preserves post-drag suppression and modifier routing', () => {
  const h = harness();
  const body = { dataset: { wlLayout: 'L' } };
  const member = { dataset: { wlLayout: 'L', wlMember: 'M' } };
  const matches = new Map([['.window-layout-body', body], ['[data-wl-member]', member]]);
  h.setConsume(true);
  h.owner.handleClick(eventFor(matches));
  assert.deepEqual(h.calls, []);
  h.owner.handleClick(eventFor(matches));
  h.owner.handleClick(eventFor(matches, { ctrlKey: true }));
  assert.deepEqual(h.calls, [['member-click', 'L', 'M'], ['member-click', 'L', 'M', true, false]]);
});

test('card controls route to existing picker, tracking and group owners', () => {
  const h = harness();
  const body = { dataset: { wlLayout: 'L' } };
  const cases = [
    ['[data-wl-pick-candidate]', { dataset: { wlPick: 'L', wlPickCandidate: 'C' } }, ['pick', 'L', 'C']],
    ['[data-wl-list]', { dataset: { wlList: 'L' } }, ['direct', 'L']],
    ['[data-wl-track]', { dataset: { wlTrack: 'L' } }, ['track', 'L']],
    ['[data-wl-min-all]', { dataset: { wlMinAll: 'L' } }, ['group', 'L', 'minimize']],
    ['[data-wl-restore-all]', { dataset: { wlRestoreAll: 'L' } }, ['group', 'L', 'restore']],
  ];
  for (const [selector, control, expected] of cases) {
    h.calls.length = 0;
    h.owner.handleClick(eventFor(new Map([['.window-layout-body', body], [selector, control]])));
    assert.deepEqual(h.calls.at(-1), expected);
  }
});

test('middle click keeps widget open-close and member close separate from unlink', async () => {
  const h = harness();
  const restore = { dataset: { wlRestoreAll: 'L' } };
  h.owner.handleAuxClick(eventFor(new Map([['[data-wl-restore-all]', restore]]), { button: 1 }));
  assert.deepEqual(h.calls.at(-1), ['widget-open', 'L']);
  h.detachedWidgets.add('L');
  const minimize = { dataset: { wlMinAll: 'L' } };
  h.owner.handleAuxClick(eventFor(new Map([['[data-wl-min-all]', minimize]]), { button: 1 }));
  await Promise.resolve();
  assert.deepEqual(h.calls.slice(-2), [['render'], ['widget-close', 'L']]);
  const member = { dataset: { wlLayout: 'L', wlMember: 'M' }, disabled: false };
  h.owner.handleAuxClick(eventFor(new Map([['[data-wl-member]', member]]), { button: 1 }));
  h.owner.handleAuxClick(eventFor(new Map([['[data-wl-member]', member]]), { button: 1, ctrlKey: true }));
  assert.deepEqual(h.calls.slice(-4), [['preview-cancel'], ['unlink', 'L', 'M'], ['preview-cancel'], ['member-close', 'L', 'M']]);
});

test('context menu routes isolate/range and reports a not-ready plain member locally', () => {
  const h = harness();
  const member = { dataset: { wlLayout: 'L', wlMember: 'M' }, disabled: false };
  const matches = new Map([['[data-wl-member]', member]]);
  h.setIsolate(true);
  h.owner.handleContextMenu(eventFor(matches, { ctrlKey: true }));
  assert.deepEqual(h.calls.slice(-2), [['isolate-click', 'L', 'M', true], ['group', 'L', 'isolate', ['M']]]);
  h.owner.handleContextMenu(eventFor(matches, { shiftKey: true }));
  assert.deepEqual(h.calls.at(-1), ['range', 'L', 'M']);
  h.setControlReady(false, 'Preparing');
  h.owner.handleContextMenu(eventFor(matches));
  assert.deepEqual(h.calls.at(-1), ['status', 'L', 'Preparing']);
});
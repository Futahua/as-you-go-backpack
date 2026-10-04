import assert from 'node:assert/strict';
import test from 'node:test';
import { installWindowLayoutWorkspaceMemberDrag } from './public/app/window-layout-workspace-member-drag.js';

function target() {
  const listeners = new Map();
  return {
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); },
    emit(type, event = {}) { for (const fn of listeners.get(type) ?? []) fn(event); },
  };
}

function classes() {
  const values = new Set();
  return {
    remove: (value) => values.delete(value),
    toggle(value, on) { if (on) values.add(value); else values.delete(value); },
    has: (value) => values.has(value),
  };
}

function harness({ widgetSurface = false } = {}) {
  const calls = [];
  const grid = target();
  const doc = target();
  const member = { dataset: { wlLayout: 'L', wlMember: 'M' }, parentNode: null };
  const other = { dataset: { wlMember: 'N' }, parentNode: null };
  const members = {
    classList: classes(),
    querySelectorAll: () => [other, member],
    appendChild: (button) => calls.push(['append', button.dataset.wlMember]),
    getBoundingClientRect: () => ({ left: 0, right: 100, top: 0, bottom: 100 }),
  };
  member.parentNode = members;
  other.parentNode = members;
  doc.querySelector = (selector) => {
    if (selector === '[data-wl-members].wl-drag-out') return members.classList.has('wl-drag-out') ? members : null;
    if (selector.includes('[data-wl-members=')) return members;
    if (selector.includes('[data-wl-layout=') && selector.includes('[data-wl-member=')) return member;
    return null;
  };
  const body = { dataset: { wlLayout: 'L' } };
  const blank = { closest: (selector) => selector === '.window-layout-body' ? body : null };
  const memberTarget = {
    closest: (selector) => selector === '[data-wl-member]' ? member : (selector === '.window-layout-body' ? body : null),
  };
  const owner = installWindowLayoutWorkspaceMemberDrag({
    documentRef: doc,
    grid,
    CSS: { escape: (value) => value },
    widgetSurface,
    getLayout: () => ({ arrangement: { members: [{ id: 'N' }, { id: 'M' }] } }),
    clearSelection: (layoutId) => calls.push(['clear', layoutId]),
    cancelPreview: () => calls.push(['cancel-preview']),
    moveMemberButton: (...args) => calls.push(['move', ...args.slice(2)]),
    unlinkMember: (...args) => calls.push(['unlink', ...args]),
    commitReorder: (...args) => calls.push(['commit', ...args]),
    dropOutPx: 20,
  });
  return { calls, grid, doc, member, members, blank, memberTarget, owner };
}

test('workspace blank press clears inner selection while widget surface ignores attached drag input', () => {
  const h = harness();
  h.grid.emit('pointerdown', { target: h.blank, button: 0, ctrlKey: false, shiftKey: false });
  assert.deepEqual(h.calls, [['clear', 'L']]);
  const widget = harness({ widgetSurface: true });
  widget.grid.emit('pointerdown', { target: widget.blank, button: 0, ctrlKey: false, shiftKey: false });
  assert.deepEqual(widget.calls, []);
});

test('Ctrl-drag reorders through one injected durable callback and suppresses the following click once', () => {
  const h = harness();
  h.grid.emit('pointerdown', { target: h.memberTarget, button: 0, ctrlKey: true, shiftKey: false, clientX: 20, clientY: 20, pointerId: 1 });
  h.grid.emit('pointermove', { target: h.memberTarget, clientX: 60, clientY: 60, pointerId: 1 });
  h.grid.emit('pointerup', { target: h.memberTarget, clientX: 60, clientY: 60, pointerId: 1 });
  assert.equal(h.calls.some(([kind]) => kind === 'cancel-preview'), true);
  assert.equal(h.calls.some(([kind]) => kind === 'move'), true);
  assert.deepEqual(h.calls.find(([kind]) => kind === 'commit'), ['commit', 'L', 'M', 1]);
  assert.equal(h.owner.consumeJustMoved(), true);
  assert.equal(h.owner.consumeJustMoved(), false);
});

test('dropping outside unlinks data-only and never commits a reorder', () => {
  const h = harness();
  h.grid.emit('pointerdown', { target: h.memberTarget, button: 0, ctrlKey: true, shiftKey: false, clientX: 20, clientY: 20, pointerId: 2 });
  h.grid.emit('pointermove', { target: h.memberTarget, clientX: 200, clientY: 200, pointerId: 2 });
  h.grid.emit('pointerup', { target: h.memberTarget, clientX: 200, clientY: 200, pointerId: 2 });
  assert.deepEqual(h.calls.find(([kind]) => kind === 'unlink'), ['unlink', 'L', 'M']);
  assert.equal(h.calls.some(([kind]) => kind === 'commit'), false);
});

test('Escape cancels an active drag and restores canonical DOM order without committing', () => {
  const h = harness();
  h.grid.emit('pointerdown', { target: h.memberTarget, button: 0, ctrlKey: true, shiftKey: false, clientX: 20, clientY: 20, pointerId: 3 });
  h.doc.emit('keydown', { key: 'Escape' });
  assert.equal(h.calls.some(([kind]) => kind === 'append'), true);
  assert.equal(h.calls.some(([kind]) => kind === 'commit'), false);
  assert.equal(h.owner.consumeJustMoved(), false);
});
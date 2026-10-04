import assert from 'node:assert/strict';
import test from 'node:test';
import { installWindowLayoutPreviewInput } from './public/app/window-layout-preview-input.js';

function target() {
  const listeners = new Map();
  return {
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); },
    removeEventListener(type, fn) { listeners.set(type, (listeners.get(type) ?? []).filter((item) => item !== fn)); },
    emit(type, event = {}) { for (const fn of listeners.get(type) ?? []) fn(event); },
  };
}

function node({ member = null, list = null, popover = false, connected = true } = {}) {
  return {
    dataset: { ...(member ? { wlMember: member } : {}), ...(list ? { wlList: list } : {}) },
    isConnected: connected,
    closest(selector) {
      if (selector === '[data-wl-member]') return member ? this : null;
      if (selector === '[data-wl-list]') return list ? this : null;
      if (selector === '[data-wl-popover]') return popover ? this : null;
      return null;
    },
  };
}

function harness({ widgetSurface = false } = {}) {
  const calls = [];
  const windowRef = target();
  const documentRef = { ...target(), querySelector: () => null };
  const grid = { ...target(), matches: () => true, contains: (candidate) => candidate?.inside === true };
  const shiftPeek = {
    held: false,
    key: null,
    apply(transition) { calls.push(['apply', transition]); this.held = transition.held; this.key = transition.held ? 'k' : null; },
    keepAlive() { calls.push(['keep-alive']); },
    deferEnd() { calls.push(['defer-end']); },
    end() { calls.push(['end']); this.held = false; this.key = null; },
  };
  let nativeShift;
  const memberPreview = { cancel: () => calls.push(['preview-cancel']) };
  const memberPopover = { hide: () => calls.push(['hide']) };
  installWindowLayoutPreviewInput({
    windowRef, documentRef, grid,
    host: { onWindowControlShift: (fn) => { nativeShift = fn; } },
    widgetSurface, shiftPeek, memberPreview, memberPopover,
    schedulePreviewDwell: (member) => calls.push(['preview-dwell', member]),
    cancelPreviewDwell: () => calls.push(['preview-dwell-cancel']),
    scheduleListDwell: (button, open) => calls.push(['list-dwell', button, open]),
    cancelListDwell: () => calls.push(['list-dwell-cancel']),
    openWorkspacePicker: (layoutId) => calls.push(['open-picker', layoutId]),
  });
  return { calls, windowRef, documentRef, grid, shiftPeek, nativeShift: (held) => nativeShift(held) };
}

test('workspace list hover schedules the attached picker while compact-widget routing stays local', () => {
  const list = node({ list: 'L1' });
  const workspace = harness();
  workspace.grid.emit('mouseover', { target: list, relatedTarget: null, shiftKey: false });
  assert.equal(workspace.calls.filter(([kind]) => kind === 'list-dwell').length, 1);
  const widget = harness({ widgetSurface: true });
  widget.grid.emit('mouseover', { target: list, relatedTarget: null, shiftKey: false });
  assert.equal(widget.calls.some(([kind]) => kind === 'list-dwell'), false);
});

test('member hover and exit route preview dwell and cancellation without durable work', () => {
  const h = harness();
  const member = node({ member: 'M1' });
  h.grid.emit('mouseover', { target: member, relatedTarget: null, shiftKey: false });
  assert.deepEqual(h.calls.find(([kind]) => kind === 'preview-dwell'), ['preview-dwell', member]);
  h.grid.emit('mouseout', { target: member, relatedTarget: null, shiftKey: false });
  assert.equal(h.calls.some(([kind]) => kind === 'preview-dwell-cancel'), true);
  assert.equal(h.calls.some(([kind]) => kind === 'preview-cancel'), true);
});

test('Shift keyboard, native Shift and pointer movement all route through one Peek lifecycle', () => {
  const h = harness();
  const member = node({ member: 'M1' });
  h.documentRef.querySelector = () => member;
  h.windowRef.emit('keydown', { key: 'Shift', shiftKey: true, repeat: false });
  assert.equal(h.shiftPeek.held, true);
  h.grid.emit('pointermove', { target: member, shiftKey: true });
  assert.equal(h.calls.some(([kind]) => kind === 'keep-alive'), true);
  h.nativeShift(false);
  assert.equal(h.shiftPeek.held, false);
});

test('leaving a held Peek outside the surface defers the end; moving into blank in-surface space keeps it alive', () => {
  const h = harness();
  const member = node({ member: 'M1' });
  h.shiftPeek.held = true;
  h.shiftPeek.key = 'k';
  h.grid.emit('pointermove', { target: node(), shiftKey: true });
  assert.equal(h.calls.some(([kind]) => kind === 'keep-alive'), true);
  h.grid.emit('mouseout', { target: member, relatedTarget: null, shiftKey: true });
  assert.equal(h.calls.some(([kind]) => kind === 'defer-end'), true);
});

test('member press, scroll and resize cancel cosmetic preview work; pagehide also ends Peek', () => {
  const h = harness();
  const member = node({ member: 'M1' });
  h.documentRef.emit('pointerdown', { target: member });
  h.documentRef.emit('scroll', {});
  h.windowRef.emit('resize', {});
  h.shiftPeek.held = true;
  h.shiftPeek.key = 'k';
  h.windowRef.emit('pagehide', {});
  assert.equal(h.calls.filter(([kind]) => kind === 'preview-cancel').length, 4);
  assert.equal(h.calls.filter(([kind]) => kind === 'end').length, 1);
});
import test from 'node:test';
import assert from 'node:assert/strict';
import { browserTabClosePlan, createPaneFillControl } from './public/app/browser-pane-actions.js';
import { installChromeFocusPolicy } from './public/app/chrome-focus-policy.js';
const tabs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
test('closing the active tab chooses its neighbor without touching other tab objects', () => {
  const plan = browserTabClosePlan(tabs, 'b', 'b');
  assert.deepEqual(plan.tabs, [tabs[0], tabs[2]]); assert.equal(plan.activeId, 'c');
  assert.deepEqual(plan.closed, [tabs[1]]); assert.equal(tabs.length, 3);
});
test('close-others keeps and activates the right-clicked background tab', () => {
  const plan = browserTabClosePlan(tabs, 'a', 'b', true);
  assert.deepEqual(plan.tabs, [tabs[1]]); assert.equal(plan.activeId, 'b');
  assert.deepEqual(plan.closed, [tabs[0], tabs[2]]);
});
test('closing the last tab clears active state and stale tab intents do nothing', () => {
  assert.equal(browserTabClosePlan([tabs[0]], 'a', 'a').activeId, null);
  assert.equal(browserTabClosePlan(tabs, 'a', 'missing'), null);
});
test('fill control stays surface-local and refreshes native view geometry both ways', () => {
  const classes = new Set(); const attributes = new Map(); const events = new Map(); let refreshes = 0;
  const panel = { classList: { toggle: (name, yes) => yes ? classes.add(name) : classes.delete(name) } };
  const button = { setAttribute: (name, value) => attributes.set(name, value), addEventListener: (name, fn) => events.set(name, fn) };
  const control = createPaneFillControl({ panel, button, refresh: () => refreshes++ });
  events.get('click')(); assert.equal(control.isFilled(), true); assert.ok(classes.has('fills-tab'));
  events.get('click')(); assert.equal(control.isFilled(), false); assert.equal(refreshes, 3);
  assert.equal(attributes.get('aria-label'), 'Fill this Papers tab');
});
test('chrome focus policy excludes buttons and nontext controls and handles dynamic controls', () => {
  const button = { tabIndex: 0 }; const input = { tabIndex: 0 }; const buttons = [button]; let update; let disconnected = false;
  const doc = { body: {}, querySelectorAll: (selector) => { assert.equal(selector, 'button, [role="button"], [role="tab"], input[type="range"], input[type="checkbox"], input[type="radio"], select'); return buttons; } };
  class Observer { constructor(fn) { update = fn; } observe() {} disconnect() { disconnected = true; } }
  const stop = installChromeFocusPolicy(doc, Observer);
  assert.equal(button.tabIndex, -1); assert.equal(input.tabIndex, 0);
  const dynamic = { tabIndex: 0 }; buttons.push(dynamic); update(); assert.equal(dynamic.tabIndex, -1);
  stop(); assert.ok(disconnected);
});

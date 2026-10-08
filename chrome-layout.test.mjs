import test from 'node:test';
import assert from 'node:assert/strict';
import { chromeLayoutBounds, trackChromeLayout } from './public/app/chrome-layout.js';

test('Chrome bounds follow surrounding controls and viewport, with no preview node', () => {
  const panel = { getBoundingClientRect: () => ({ left: 600, top: 60, right: 1008, bottom: 808 }) };
  const header = { getBoundingClientRect: () => ({ bottom: 92 }) };
  assert.deepEqual(chromeLayoutBounds(panel, header, { innerWidth: 1000, innerHeight: 800 }),
    { x: 601, y: 93, width: 399, height: 707, rightInset: 0, bottomInset: 0 });
  assert.equal(chromeLayoutBounds(panel, header, { innerWidth: 500, innerHeight: 800 }), null);
});
test('outer edge insets remain stable across a Papers fullscreen transition', () => {
  let width = 1000, height = 800;
  const panel = { getBoundingClientRect: () => ({ left: 600, top: 60, right: width - 8, bottom: height - 8 }) };
  const header = { getBoundingClientRect: () => ({ bottom: 92 }) };
  const first = chromeLayoutBounds(panel, header, { innerWidth: width, innerHeight: height });
  width = 1920; height = 1080;
  const full = chromeLayoutBounds(panel, header, { innerWidth: width, innerHeight: height });
  assert.equal(first.rightInset, full.rightInset);
  assert.equal(first.bottomInset, full.bottomInset);
  assert.equal(full.x, first.x);
  assert.equal(full.width - first.width, 920);
});

test('layout coalesces updates and cancels pending work when Chrome leaves', () => {
  let callback; let updates = 0; let cancelled = false;
  const events = new Map();
  const viewport = {
    innerWidth: 1000, innerHeight: 800,
    requestAnimationFrame(fn) { callback = fn; return 1; },
    cancelAnimationFrame() { cancelled = true; },
    addEventListener(name, fn) { events.set(name, fn); },
    removeEventListener(name) { events.delete(name); },
  };
  const panel = { isConnected: true, getBoundingClientRect: () => ({ left: 600, top: 60, right: 990, bottom: 790 }), addEventListener() {}, removeEventListener() {} };
  const header = { getBoundingClientRect: () => ({ bottom: 92 }) };
  const layout = trackChromeLayout({ panel, header, viewport, update: () => updates++ });
  layout.refresh(); callback(); assert.equal(updates, 1);
  events.get('resize')(); layout.stop(); callback();
  assert.equal(updates, 1); assert.equal(cancelled, true); assert.equal(events.size, 0);
});

test('native windows sit below the visible tabs even when preview header retains extra height', () => {
  const panel = { getBoundingClientRect: () => ({ left: 600, top: 60, right: 1000, bottom: 800 }) };
  const tabs = { getBoundingClientRect: () => ({ bottom: 92, height: 28 }) };
  const header = { getBoundingClientRect: () => ({ bottom: 160 }), querySelector: () => tabs };
  assert.equal(chromeLayoutBounds(panel, header, { innerWidth: 1000, innerHeight: 800 }).y, 93);
});

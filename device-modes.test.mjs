import test from 'node:test'; import assert from 'node:assert/strict';
import { currentDeviceMode, sameDeviceMode, writeNavigateIntent, takeNavigateIntent } from './public/app/device-modes.js';
const LAP = 'b2b514db-668a-4092-bda4-67e33c52c807';
const store = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
test('the current place: own As you Go, own files, another device\'s files or As you Go', () => {
  assert.deepEqual(currentDeviceMode({ mode: 'ayg' }), { device: 'self', mode: 'ayg' });
  assert.deepEqual(currentDeviceMode({ mode: 'machine', path: 'D:\Work' }), { device: 'self', mode: 'files' });
  assert.deepEqual(currentDeviceMode({ mode: 'machine', path: '\\\\papers~phone\\primary' }), { device: 'self', mode: 'files' });
  assert.deepEqual(currentDeviceMode({ mode: 'machine', path: '\\\\papers~' + LAP.toUpperCase() + '\\C:' }), { device: LAP, mode: 'files' });
  assert.deepEqual(currentDeviceMode({ remoteDevice: LAP, mode: 'ayg', path: '\\\\papers~' + LAP }), { device: LAP, mode: 'ayg' });
  assert.ok(sameDeviceMode({ device: 'self', mode: 'ayg' }, { device: 'self', mode: 'ayg' }));
  assert.ok(!sameDeviceMode({ device: 'self', mode: 'ayg' }, { device: 'self', mode: 'files' }));
});
test('"This device" chosen on LapDog\'s As you Go reaches the phone\'s own page once, then is gone', () => {
  const s = store(), now = 1_000_000;
  assert.ok(writeNavigateIntent(s, { device: 'self', mode: 'ayg' }, now));
  assert.deepEqual(takeNavigateIntent(s, now + 500), { device: 'self', mode: 'ayg' });
  assert.equal(takeNavigateIntent(s, now + 600), null);
});
test('stale or malformed hand-offs are ignored', () => {
  const s = store();
  writeNavigateIntent(s, { device: LAP, mode: 'files' }, 0);
  assert.equal(takeNavigateIntent(s, 60_000), null);
  s.setItem('papers:ayg:navigate-intent', JSON.stringify({ device: '../x', mode: 'files', at: 5 }));
  assert.equal(takeNavigateIntent(s, 10), null);
  s.setItem('papers:ayg:navigate-intent', '{nope');
  assert.equal(takeNavigateIntent(s, 10), null);
});

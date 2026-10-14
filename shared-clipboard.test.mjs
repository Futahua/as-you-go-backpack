import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createSharedClipboard, devicePathOwner } from './public/app/shared-clipboard.js';

const device = '417c0ac8-2d5c-4f32-9cf0-61c22ac0d774';
const storage = () => { const memory = new Map(); return { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, String(v)), removeItem: (k) => memory.delete(k) }; };
const pane = (localStorage, deviceId = null) => createSharedClipboard({ window: { crypto: webcrypto, localStorage }, deviceId });

test('a copy in one pane is the clipboard of every other pane on the computer', () => {
  const shared = storage(), here = pane(shared), there = pane(shared);
  const id = here.write({ cut: false, paths: ['D:\\work\\plan.pdf'] });
  const record = there.current(null);
  assert.equal(record.id, id);
  assert.notEqual(record.page, there.page);
  assert.deepEqual(record.paths, ['D:\\work\\plan.pdf']);
});

test('a device view names its device in the paths it copies', () => {
  const view = pane(storage(), device);
  view.write({ paths: ['C:\\Users\\admin\\a.txt'] });
  const [path] = view.current(null).paths;
  assert.equal(path, `\\\\papers~${device}\\C:\\Users\\admin\\a.txt`);
  assert.equal(devicePathOwner(path), device);
  assert.equal(devicePathOwner('D:\\x'), 'local');
});

test('a later Windows copy wins; a pasted cut empties the clipboard everywhere', () => {
  const shared = storage(), here = pane(shared), there = pane(shared);
  const id = here.write({ cut: true, paths: ['D:\\a'] });
  here.setFingerprint(id, 'windows-1');
  assert.ok(there.current('windows-1'));
  assert.equal(there.current('windows-2'), null);
  there.consume(id);
  assert.equal(here.current(null), null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebLinkPreview } from './public/app/web-link-preview.js';

test('preview closes its view without creating durable browser tabs', async () => {
  const calls = [], sessions = [];
  const preview = createWebLinkPreview({ host: { async fileCapability(op, params) {
    calls.push([op, params]); return { ok: true, sessionId: 'one' };
  } }, onSession: id => sessions.push(id) });
  await preview.open('https://example.com', { x: 1 });
  await preview.close();
  assert.deepEqual(calls, [['browser-open', { url: 'https://example.com', rect: { x: 1 } }], ['browser-close', { sessionId: 'one' }]]);
  assert.deepEqual(sessions, ['one', null]);
});

test('selection change during loading releases stale view before opening the next', async () => {
  let finish;
  const calls = [];
  const preview = createWebLinkPreview({ host: { async fileCapability(op, params) {
    calls.push([op, params]);
    if (op === 'browser-open' && params.url.endsWith('/old')) return new Promise(resolve => { finish = resolve; });
    return { ok: true, sessionId: 'new' };
  } } });
  const old = preview.open('https://example.com/old', {});
  await Promise.resolve();
  const next = preview.open('https://example.com/new', {});
  finish({ ok: true, sessionId: 'old' });
  assert.equal(await old, null);
  assert.equal((await next).sessionId, 'new');
  assert.deepEqual(calls.map(([op, p]) => [op, p.sessionId || p.url]), [
    ['browser-open', 'https://example.com/old'], ['browser-close', 'old'], ['browser-open', 'https://example.com/new'],
  ]);
});

test('collapse during load closes the eventual view and skips queued obsolete selections', async () => {
  let finish;
  const calls = [];
  const preview = createWebLinkPreview({ host: { async fileCapability(op, params) {
    calls.push(op);
    if (op === 'browser-open') return new Promise(resolve => { finish = resolve; });
    return { ok: true };
  } } });
  const old = preview.open('https://example.com', {});
  await Promise.resolve();
  const skipped = preview.open('https://example.org', {});
  const closed = preview.close();
  finish({ ok: true, sessionId: 'old' });
  await Promise.all([old, skipped, closed]);
  assert.deepEqual(calls, ['browser-open', 'browser-close']);
});

test('failed load does not strand later preview work', async () => {
  let count = 0;
  const preview = createWebLinkPreview({ host: { async fileCapability() {
    if (++count === 1) throw new Error('offline');
    return { ok: true, sessionId: 'recovered' };
  } } });
  await assert.rejects(preview.open('https://example.com', {}), /offline/);
  assert.equal((await preview.open('https://example.org', {})).sessionId, 'recovered');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { createHostBridge } from './public/app/host/host-bridge.js';

/** Builds a minimal fake window whose parent postMessage is captured and
 * whose message listener can be driven by the test. */
function createMockWindow() {
  const listeners = new Map();
  const parent = {
    messages: [],
    postMessage(message, targetOrigin) {
      parent.messages.push({ message, targetOrigin });
    },
  };
  return {
    parent,
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    dispatchMessage(data, source = parent) {
      for (const handler of listeners.get('message') ?? []) {
        handler({ source, data });
      }
    },
  };
}

test('host bridge posts the protocol request and resolves a plain state response', async () => {
  const mock = createMockWindow();
  const host = createHostBridge(mock);

  const promise = host.loadWorkspace();
  const sent = mock.parent.messages[0].message;
  assert.equal(sent.type, 'papers:project:as-you-go-load');
  assert.ok(sent.requestId);

  mock.dispatchMessage({
    type: 'papers:host:result',
    requestId: sent.requestId,
    ok: true,
    state: { hello: 'world' },
  });
  assert.deepEqual(await promise, { hello: 'world' });
});

test('host bridge rejects when the host reports an error', async () => {
  const mock = createMockWindow();
  const host = createHostBridge(mock);

  const promise = host.saveWorkspace('{ "snapshot": true }');
  const sent = mock.parent.messages[0].message;
  assert.equal(sent.type, 'papers:project:as-you-go-save');
  assert.deepEqual(sent.state, '{ "snapshot": true }');

  mock.dispatchMessage({
    type: 'papers:host:result',
    requestId: sent.requestId,
    ok: false,
    error: 'disk full',
  });
  await assert.rejects(promise, /disk full/);
});

test('host bridge reversibly wraps an unresolved shortcut so one bad target cannot block saving', async () => {
  const mock = createMockWindow();
  const host = createHostBridge(mock);
  const state = {
    schemaVersion: 1,
    groups: [],
    shortcuts: [
      { id: 'valid', target: 'C:\\Apps\\valid.exe' },
      { id: 'unresolved', target: 'relative.cmd' },
    ],
  };

  const savePromise = host.saveWorkspace(JSON.stringify(state));
  const saveRequest = mock.parent.messages[0].message;
  const saved = JSON.parse(saveRequest.state);
  assert.equal(saved.shortcuts[0].target, 'C:\\Apps\\valid.exe');
  assert.equal(
    saved.shortcuts[1].target,
    'https://invalid.invalid/as-you-go/unresolved-shortcut',
  );
  assert.deepEqual(saved.shortcuts[1].__asYouGoUnresolvedTarget, {
    version: 1,
    target: 'relative.cmd',
  });
  mock.dispatchMessage({
    type: 'papers:host:result',
    requestId: saveRequest.requestId,
    ok: true,
  });
  await savePromise;

  const loadPromise = host.loadWorkspace();
  const loadRequest = mock.parent.messages[1].message;
  mock.dispatchMessage({
    type: 'papers:host:result',
    requestId: loadRequest.requestId,
    ok: true,
    state: JSON.stringify(saved),
  });
  assert.deepEqual(JSON.parse(await loadPromise), state);
});

test('host bridge never revives stale unresolved metadata after a target is repaired', async () => {
  const mock = createMockWindow();
  const host = createHostBridge(mock);
  const state = {
    schemaVersion: 1,
    groups: [],
    shortcuts: [{
      id: 'repaired',
      target: 'https://example.com',
      __asYouGoUnresolvedTarget: { version: 1, target: 'old-relative.cmd' },
    }],
  };

  const promise = host.saveWorkspace(JSON.stringify(state));
  const sent = mock.parent.messages[0].message;
  const saved = JSON.parse(sent.state);
  assert.equal(saved.shortcuts[0].target, 'https://example.com');
  assert.equal('__asYouGoUnresolvedTarget' in saved.shortcuts[0], false);
  mock.dispatchMessage({
    type: 'papers:host:result',
    requestId: sent.requestId,
    ok: true,
  });
  await promise;
});

test('host bridge unwraps the target+icon shape used by target picking', async () => {
  const mock = createMockWindow();
  const host = createHostBridge(mock);

  const promise = host.pickTarget('file');
  const sent = mock.parent.messages[0].message;
  assert.equal(sent.type, 'papers:project:as-you-go-pick-target');
  assert.equal(sent.kind, 'file');

  mock.dispatchMessage({
    type: 'papers:host:result',
    requestId: sent.requestId,
    ok: true,
    target: 'C:\\thing.txt',
    icon: 'data:image/png;base64,xx',
  });
  assert.deepEqual(await promise, {
    target: 'C:\\thing.txt',
    icon: 'data:image/png;base64,xx',
  });
});

test('host bridge sends dropped files flat and unwraps the returned targets array', async () => {
  const mock = createMockWindow();
  const host = createHostBridge(mock);

  const droppedFiles = [{ name: 'a.txt' }, { name: 'b.png' }];
  const promise = host.resolveDroppedTargets(droppedFiles);
  const sent = mock.parent.messages[0].message;

  // Regression: the outbound payload must be { files: droppedFiles }, never
  // { files: { files: droppedFiles } }.
  assert.equal(sent.type, 'papers:project:resolve-dropped-targets');
  assert.deepEqual(sent.files, droppedFiles);

  mock.dispatchMessage({
    type: 'papers:host:result',
    requestId: sent.requestId,
    ok: true,
    targets: [
      { kind: 'file', target: 'D:\\a.txt', name: 'a' },
      { kind: 'web', target: 'https://example.com', name: 'example' },
    ],
  });
  assert.deepEqual(await promise, [
    { kind: 'file', target: 'D:\\a.txt', name: 'a' },
    { kind: 'web', target: 'https://example.com', name: 'example' },
  ]);
});

test('host bridge unwraps the finalOrigin shape used for dropped images', async () => {
  const mock = createMockWindow();
  const host = createHostBridge(mock);

  const promise = host.resolveDroppedTargets([{ name: 'x.png' }]);
  const sent = mock.parent.messages[0].message;
  assert.equal(sent.type, 'papers:project:resolve-dropped-targets');

  mock.dispatchMessage({
    type: 'papers:host:result',
    requestId: sent.requestId,
    ok: true,
    icon: 'data:image/png;base64,yy',
    mime: 'image/png',
    finalOrigin: 'D:\\x.png',
    title: 'x.png',
  });
  assert.deepEqual(await promise, {
    icon: 'data:image/png;base64,yy',
    mime: 'image/png',
    finalOrigin: 'D:\\x.png',
    title: 'x.png',
  });
});

test('host bridge ignores messages that do not come from the parent frame', async () => {
  const mock = createMockWindow();
  const host = createHostBridge(mock);

  const promise = host.copyText('hello');
  const sent = mock.parent.messages[0].message;

  let settled = false;
  promise.then(() => { settled = true; });

  mock.dispatchMessage({
    type: 'papers:host:result',
    requestId: sent.requestId,
    ok: true,
    target: 'should be ignored',
  }, { /* not the parent frame */ });

  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(settled, false);

  mock.dispatchMessage({
    type: 'papers:host:result',
    requestId: sent.requestId,
    ok: true,
    target: 'clips',
  });
  assert.equal(await promise, 'clips');
});

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

test('host bridge window candidate methods post the enumerated protocol and unwrap shapes', async () => {
  const mock = createMockWindow();
  const host = createHostBridge(mock);

  const candidatesPromise = host.windowCandidates();
  const sentList = mock.parent.messages[0].message;
  assert.equal(sentList.type, 'papers:project:window-candidates');
  mock.dispatchMessage({
    type: 'papers:host:result', requestId: sentList.requestId, ok: true,
    outcome: 'success',
    candidates: [{ id: 'c1', title: 'Window A', processId: 1001, processPath: 'p', icon: 'data:icon', state: 'normal' }],
  });
  assert.deepEqual(await candidatesPromise, {
    outcome: 'success',
    candidates: [{ id: 'c1', title: 'Window A', processId: 1001, processPath: 'p', icon: 'data:icon', state: 'normal' }],
    error: null,
  });

  const bindPromise = host.bindWindowCandidate('c1');
  const sentBind = mock.parent.messages[1].message;
  assert.equal(sentBind.type, 'papers:project:window-bind-candidate');
  assert.equal(sentBind.candidateId, 'c1');
  mock.dispatchMessage({
    type: 'papers:host:result', requestId: sentBind.requestId, ok: true,
    outcome: 'success',
    capability: { version: 1, runtimeToken: 'Ta', title: 'Window A', processId: 1001 },
    descriptor: { version: 1, title: 'Window A', processId: 1001 },
  });
  assert.deepEqual(await bindPromise, {
    outcome: 'success',
    capability: { version: 1, runtimeToken: 'Ta', title: 'Window A', processId: 1001 },
    descriptor: { version: 1, title: 'Window A', processId: 1001 },
    observation: null,
    error: null,
  });
});

test('host bridge window observation/control methods carry the capability and unwrap outcomes', async () => {
  const mock = createMockWindow();
  const host = createHostBridge(mock);
  const capability = { version: 1, runtimeToken: 'Ta', title: 'Window A', processId: 1001 };

  const observe = host.observeWindowCapability(capability);
  const sentObserve = mock.parent.messages[0].message;
  assert.equal(sentObserve.type, 'papers:project:window-observe-capability');
  assert.deepEqual(sentObserve.capability, capability);
  mock.dispatchMessage({
    type: 'papers:host:result', requestId: sentObserve.requestId, ok: true,
    outcome: 'success', observation: { runtimeId: 'Ta', title: 'Window A', processId: 1001, processPath: 'p', state: 'minimized', bounds: { x: 1, y: 2, width: 300, height: 200 } },
  });
  const observed = await observe;
  assert.equal(observed.outcome, 'success');
  assert.equal(observed.observation.state, 'minimized');

  const minimized = host.minimizeWindowCapability(capability);
  const sentMin = mock.parent.messages[1].message;
  assert.equal(sentMin.type, 'papers:project:window-minimize-capability');
  mock.dispatchMessage({
    type: 'papers:host:result', requestId: sentMin.requestId, ok: true,
    outcome: 'success', observation: { runtimeId: 'Ta', title: 'Window A', processId: 1001, processPath: 'p', state: 'minimized', bounds: null },
  });
  assert.equal((await minimized).outcome, 'success');

  const restored = host.restoreWindowCapability(capability);
  const sentRestore = mock.parent.messages[2].message;
  assert.equal(sentRestore.type, 'papers:project:window-restore-capability');
  mock.dispatchMessage({
    type: 'papers:host:result', requestId: sentRestore.requestId, ok: true,
    outcome: 'missing', error: 'gone',
  });
  assert.deepEqual(await restored, { outcome: 'missing', observation: null, error: 'gone' });

  const applied = host.applyWindowCapability(capability, { x: 5, y: 6, width: 400, height: 300 });
  const sentApply = mock.parent.messages[3].message;
  assert.equal(sentApply.type, 'papers:project:window-apply-capability');
  assert.deepEqual(sentApply.bounds, { x: 5, y: 6, width: 400, height: 300 });
  mock.dispatchMessage({
    type: 'papers:host:result', requestId: sentApply.requestId, ok: true,
    outcome: 'success', observation: { runtimeId: 'Ta', title: 'Window A', processId: 1001, processPath: 'p', state: 'normal', bounds: { x: 5, y: 6, width: 400, height: 300 } },
  });
  assert.equal((await applied).outcome, 'success');

  const resolved = host.resolveWindowDescriptor({ version: 1, title: 'Window A', processId: 1001 });
  const sentResolve = mock.parent.messages[4].message;
  assert.equal(sentResolve.type, 'papers:project:window-resolve-descriptor');
  assert.deepEqual(sentResolve.descriptor, { version: 1, title: 'Window A', processId: 1001 });
  mock.dispatchMessage({
    type: 'papers:host:result', requestId: sentResolve.requestId, ok: true,
    outcome: 'missing', error: 'no visible window matches',
  });
  assert.deepEqual(await resolved, { outcome: 'missing', observation: null, error: 'no visible window matches' });
});

test('host bridge surfaces window capability failures as rejected outcomes, never as commands', async () => {
  const mock = createMockWindow();
  const host = createHostBridge(mock);
  const pending = host.windowCandidates();
  const sent = mock.parent.messages[0].message;
  assert.equal(sent.type, 'papers:project:window-candidates');
  assert.ok(!('method' in sent) && !('command' in sent) && !('action' in sent), 'no arbitrary method field is posted');
  mock.dispatchMessage({
    type: 'papers:host:result', requestId: sent.requestId, ok: false, error: 'denied',
  });
  await assert.rejects(pending, /denied/);
});

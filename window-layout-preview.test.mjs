// 019G (RoketPuncha AYG lane): deterministic tests for the member hover-preview
// controller. Debounce, latest-only generation guard, leave-before-response,
// strict-success-only rendering, typed/name-only fallbacks, cleanup, and the
// no-state/store surface. Fake timers + gated async responses, no DOM/host.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WINDOW_LAYOUT_PREVIEW_DEBOUNCE_MS,
  WINDOW_LAYOUT_PREVIEW_MAX_DECODED_BYTES,
  createWindowLayoutMemberPreview,
  isValidThumbnailSuccess,
  windowLayoutPreviewHoverState,
} from './public/app/window-layout-preview.js';

function fakeTimers() {
  const tasks = [];
  let nextId = 1;
  return {
    setTimeout(fn, ms) {
      const id = nextId++;
      tasks.push({ id, fn, ms });
      return id;
    },
    clearTimeout(id) {
      const index = tasks.findIndex((task) => task.id === id);
      if (index >= 0) tasks.splice(index, 1);
    },
    pending() {
      return tasks.length;
    },
    async flush() {
      const due = [...tasks].sort((a, b) => a.ms - b.ms);
      tasks.length = 0;
      for (const task of due) task.fn();
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

// Builds a data-PNG URL whose decoded bytes start with the real PNG magic
// signature, so the strict validator accepts it (decodedLength >= 8).
function pngDataUrl(decodedLength = 16) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const bytes = new Uint8Array(decodedLength);
  bytes.set(signature);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return `data:image/png;base64,${btoa(binary)}`;
}

function okResult(imageUrl = pngDataUrl(), width = 240, height = 135) {
  return { outcome: 'success', imageUrl, width, height };
}

function makePreview({ timers, resolveCapability = async () => ({ id: 'cap' }), requestThumbnail = async () => ({ outcome: 'missing' }), setPreviewImage = () => undefined, clearPreview = () => undefined, debounceMs = 10 }) {
  return createWindowLayoutMemberPreview({
    resolveCapability,
    requestThumbnail,
    setPreviewImage,
    clearPreview,
    debounceMs,
    setTimeoutFn: timers.setTimeout,
    clearTimeoutFn: timers.clearTimeout,
  });
}

test('capture is debounced; only the latest hover is captured', async () => {
  const timers = fakeTimers();
  const resolved = [];
  const requests = [];
  const preview = makePreview({
    timers,
    resolveCapability: async (layoutId, memberId) => { resolved.push(memberId); return { id: memberId }; },
    requestThumbnail: async (capability, options) => { requests.push([capability.id, options]); return okResult(); },
  });
  preview.schedule('L1', 'A');
  assert.equal(resolved.length, 0, 'no capture before the debounce elapses');
  preview.schedule('L1', 'B'); // replaces the pending A capture
  await timers.flush();
  assert.deepEqual(resolved, ['B'], 'only the latest hover is captured');
  assert.equal(requests.length, 1, 'one thumbnail request');
  assert.deepEqual(requests[0][1], { maxWidth: 240, maxHeight: 135 }, 'requests the 240x135 default');
});

test('rapid A->B: the stale A response is dropped by the generation guard', async () => {
  const timers = fakeTimers();
  let releaseA;
  const gateA = new Promise((resolve) => { releaseA = resolve; });
  let requests = 0;
  const images = [];
  const preview = makePreview({
    timers,
    requestThumbnail: async () => {
      requests += 1;
      if (requests === 1) await gateA; // A is held in flight
      return okResult(pngDataUrl(20));
    },
    setPreviewImage: (url) => images.push(url),
  });
  preview.schedule('L1', 'A');
  await timers.flush();
  preview.schedule('L1', 'B'); // hover moves on before A resolves
  await timers.flush();
  releaseA(); // A's late thumbnail arrives
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests, 2, 'A and B both requested');
  assert.equal(images.length, 1, 'only the latest (B) image renders');
});

test('pointer leave cancels pending work and discards late responses', async () => {
  const timers = fakeTimers();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let requests = 0;
  const images = [];
  const cleared = [];
  const preview = makePreview({
    timers,
    requestThumbnail: async () => {
      requests += 1;
      await gate;
      return okResult('data:image/png;base64,CCC');
    },
    setPreviewImage: (url) => images.push(url),
    clearPreview: () => cleared.push(1),
  });
  // Leave BEFORE the debounce fires.
  preview.schedule('L1', 'A');
  preview.cancel();
  await timers.flush();
  assert.equal(requests, 0, 'a cancelled pending debounce never captures');
  assert.equal(cleared.length, 1, 'cancel clears the preview');
  // Leave AFTER the capture started: the late response is discarded.
  preview.schedule('L1', 'B');
  await timers.flush();
  preview.cancel();
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(images.length, 0, 'a late response after leave is never rendered');
});

test('a strictly valid success renders the bounded thumbnail image', async () => {
  const timers = fakeTimers();
  const images = [];
  const preview = makePreview({
    timers,
    requestThumbnail: async () => okResult(pngDataUrl(24), 240, 135),
    setPreviewImage: (url, width, height) => images.push({ url, width, height }),
  });
  preview.schedule('L1', 'm1');
  await timers.flush();
  assert.equal(images.length, 1);
  assert.deepEqual(images[0], { url: pngDataUrl(24), width: 240, height: 135 });
});

test('malformed and typed-fallback results never fabricate a thumbnail', async () => {
  const timers = fakeTimers();
  const outcomes = [
    { outcome: 'minimized' },
    { outcome: 'missing' },
    { outcome: 'denied' },
    { outcome: 'malformed' },
    { outcome: 'helper-unavailable' },
    { outcome: 'timeout', error: 'took too long' },
    { outcome: 'success', imageUrl: 'not-a-data-url', width: 240, height: 135 },
    { outcome: 'success', imageUrl: 'data:image/jpeg;base64,AAA', width: 240, height: 135 },
    { outcome: 'success', imageUrl: 'data:image/png;base64,AAA', width: 999, height: 135 },
    { outcome: 'success', imageUrl: 'data:image/png;base64,AAA', width: 240, height: 999 },
    { outcome: 'success' },
    'not-an-object',
    null,
  ];
  let index = 0;
  const images = [];
  const preview = makePreview({
    timers,
    requestThumbnail: async () => outcomes[index++] ?? { outcome: 'timeout' },
    setPreviewImage: (url) => images.push(url),
  });
  for (let i = 0; i < outcomes.length; i += 1) {
    preview.schedule('L1', `m${i}`);
    await timers.flush();
  }
  assert.equal(images.length, 0, 'no fabricated/oversized placeholder thumbnail is ever rendered');
});

test('no resolvable capability keeps the icon/name-only fallback without a request', async () => {
  const timers = fakeTimers();
  let requests = 0;
  const preview = makePreview({
    timers,
    resolveCapability: async () => null,
    requestThumbnail: async () => { requests += 1; return okResult(); },
  });
  preview.schedule('L1', 'm1');
  await timers.flush();
  assert.equal(requests, 0, 'no thumbnail request without a capability');
});

test('a request rejection surfaces as a fallback, not a crash or image', async () => {
  const timers = fakeTimers();
  const images = [];
  const preview = makePreview({
    timers,
    requestThumbnail: async () => { throw new Error('helper exploded'); },
    setPreviewImage: (url) => images.push(url),
  });
  preview.schedule('L1', 'm1');
  await timers.flush();
  assert.equal(images.length, 0);
});

test('cancel cleans up the pending timer and the preview; a fresh hover restarts', async () => {
  const timers = fakeTimers();
  const images = [];
  const cleared = [];
  let requests = 0;
  const preview = makePreview({
    timers,
    requestThumbnail: async () => { requests += 1; return okResult(pngDataUrl(28)); },
    setPreviewImage: (url) => images.push(url),
    clearPreview: () => cleared.push(1),
  });
  preview.schedule('L1', 'm1');
  preview.cancel();
  assert.equal(timers.pending(), 0, 'cancel clears the pending debounce timer');
  assert.equal(cleared.length, 1);
  preview.schedule('L1', 'm2'); // fresh hover after cancel
  await timers.flush();
  assert.equal(requests, 1, 'a fresh hover captures again');
  assert.equal(images.length, 1);
});

test('the preview controller exposes only schedule/cancel and no store/save surface', () => {
  const timers = fakeTimers();
  const preview = makePreview({ timers });
  assert.deepEqual(Object.keys(preview).sort(), ['cancel', 'schedule']);
  for (const forbidden of ['saveWorkspace', 'commit', 'replace', 'install', 'persist', 'undo', 'redo']) {
    assert.equal(preview[forbidden], undefined, `the preview controller must not expose ${forbidden}`);
  }
});

test('isValidThumbnailSuccess accepts only strict success with a bounded data PNG', () => {
  const valid = pngDataUrl();
  assert.equal(isValidThumbnailSuccess({ outcome: 'success', imageUrl: valid, width: 240, height: 135 }), true);
  assert.equal(isValidThumbnailSuccess({ outcome: 'success', imageUrl: valid, width: 320, height: 180 }), true, 'the 320x180 clamp is the ceiling');
  assert.equal(isValidThumbnailSuccess({ outcome: 'success', imageUrl: valid, width: 321, height: 135 }), false);
  assert.equal(isValidThumbnailSuccess({ outcome: 'success', imageUrl: valid, width: 240, height: 181 }), false);
  assert.equal(isValidThumbnailSuccess({ outcome: 'success', imageUrl: valid, width: 0, height: 135 }), false);
  assert.equal(isValidThumbnailSuccess({ outcome: 'success', imageUrl: valid, width: 240.5, height: 135 }), false);
  assert.equal(isValidThumbnailSuccess({ outcome: 'success', imageUrl: 'data:image/jpeg;base64,AAAA', width: 240, height: 135 }), false);
  assert.equal(isValidThumbnailSuccess({ outcome: 'success', imageUrl: 'http://example.com/x.png', width: 240, height: 135 }), false);
  assert.equal(isValidThumbnailSuccess({ outcome: 'success' }), false);
  assert.equal(isValidThumbnailSuccess({ outcome: 'minimized' }), false);
  assert.equal(isValidThumbnailSuccess(null), false);
  assert.equal(isValidThumbnailSuccess('success'), false);
  // 019GR unexpected keys are rejected (the success payload is exactly 4 keys).
  assert.equal(isValidThumbnailSuccess({ outcome: 'success', imageUrl: valid, width: 240, height: 135, error: null }), false, 'extra keys are rejected');
  assert.equal(isValidThumbnailSuccess({ outcome: 'success', imageUrl: valid, width: 240 }), false, 'missing keys are rejected');
});

test('019GR strict base64 grammar and PNG signature are enforced', () => {
  const validBase64 = pngDataUrl().slice('data:image/png;base64,'.length);
  const badAlphabet = `data:image/png;base64,${validBase64.slice(0, -2)}!`;
  const badPadding = `data:image/png;base64,${validBase64.slice(0, -1)}`;
  const wrongSignature = `data:image/png;base64,${btoa(String.fromCharCode(0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3))}`;
  const dims = { width: 240, height: 135 };
  assert.equal(isValidThumbnailSuccess({ outcome: 'success', imageUrl: badAlphabet, ...dims }), false, 'bad base64 alphabet is rejected');
  assert.equal(isValidThumbnailSuccess({ outcome: 'success', imageUrl: badPadding, ...dims }), false, 'bad base64 padding is rejected');
  assert.equal(isValidThumbnailSuccess({ outcome: 'success', imageUrl: wrongSignature, ...dims }), false, 'non-PNG decoded bytes are rejected');
  assert.equal(isValidThumbnailSuccess({ outcome: 'success', imageUrl: 'data:image/png;base64,', ...dims }), false, 'empty payload is rejected');
  assert.equal(isValidThumbnailSuccess({ outcome: 'success', imageUrl: `data:image/png;base64,${validBase64}` , ...dims }), true);
});

test('019GR decoded PNG length is capped at exactly 256 KiB', () => {
  const atLimit = pngDataUrl(WINDOW_LAYOUT_PREVIEW_MAX_DECODED_BYTES);
  assert.equal(atLimit.length < 512 * 1024, true, 'the data-URL string stays within its bound');
  assert.equal(isValidThumbnailSuccess({ outcome: 'success', imageUrl: atLimit, width: 240, height: 135 }), true, 'exactly 256 KiB is accepted');
  const overLimit = pngDataUrl(WINDOW_LAYOUT_PREVIEW_MAX_DECODED_BYTES + 1);
  assert.equal(isValidThumbnailSuccess({ outcome: 'success', imageUrl: overLimit, width: 240, height: 135 }), false, '256 KiB + 1 byte is rejected');
});

test('019GR exact-member hover transition predicate', () => {
  const a = { id: 'a' };
  const b = { id: 'b' };
  assert.equal(windowLayoutPreviewHoverState(a, a), 'inside', 'moving within the SAME member is ignored');
  assert.equal(windowLayoutPreviewHoverState(a, b), 'enter', 'entering a member from another member is enter');
  assert.equal(windowLayoutPreviewHoverState(a, null), 'enter', 'entering from the outside is enter');
  assert.equal(windowLayoutPreviewHoverState(null, a), 'outside', 'the pointer is not over a member');
  assert.equal(windowLayoutPreviewHoverState(null, null), 'outside');
});

test('the default debounce is the shared 120 ms contract', () => {
  assert.equal(WINDOW_LAYOUT_PREVIEW_DEBOUNCE_MS, 120);
});

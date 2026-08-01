import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkspaceStore } from './public/app/workspace-store.js';
import { createPickupPromptEditor } from './public/app/components/pickup-prompt-editor.js';

function fakeNode() {
  return {
    hidden: false,
    value: '',
    textContent: '',
    _listeners: [],
    addEventListener(type, handler, options) {
      const entry = { type, handler, options };
      this._listeners.push(entry);
      if (options?.signal) {
        options.signal.addEventListener('abort', () => {
          const index = this._listeners.indexOf(entry);
          if (index >= 0) this._listeners.splice(index, 1);
        });
      }
    },
    _dispatch(type, event = {}) {
      const results = [];
      for (const entry of [...this._listeners]) {
        if (entry.type === type) results.push(entry.handler(event));
      }
      return results.length === 1 ? results[0] : Promise.all(results);
    },
    focus() {},
  };
}

function createHarness({ storedPrompt = null } = {}) {
  let state = { groups: [], shortcuts: [], view: { pickupPrompt: storedPrompt } };
  const store = createWorkspaceStore({
    getState: () => state,
    setState: (next) => { state = next; },
    persist: async () => {},
    normalizeState: (s) => s,
    setStatus: () => {},
  });
  const nodes = {};
  for (const key of ['prompt-layer', 'prompt-input', 'prompt-error', 'prompt-cancel', 'prompt-save', 'copy-prompt']) {
    nodes[key] = fakeNode();
  }
  const documentMock = { querySelector: (sel) => nodes[sel.slice(1)] ?? fakeNode() };
  const editor = createPickupPromptEditor({
    document: documentMock,
    store,
    fallbackPrompt: 'DEFAULT PROMPT',
  });
  editor.mount();
  return { editor, store, nodes, getState: () => state };
}

test('right-clicking the copy button opens the prompt editor', () => {
  const h = createHarness();
  h.nodes['copy-prompt']._dispatch('contextmenu', { preventDefault() {} });
  assert.equal(h.nodes['prompt-layer'].hidden, false);
  assert.equal(h.nodes['prompt-input'].value, 'DEFAULT PROMPT');
});

test('saving persists the edited prompt and closes the layer', async () => {
  const h = createHarness();
  h.nodes['copy-prompt']._dispatch('contextmenu', { preventDefault() {} });
  h.nodes['prompt-input'].value = 'MY CUSTOM PROMPT';
  await h.nodes['prompt-save']._dispatch('click', {});
  assert.equal(h.getState().view.pickupPrompt, 'MY CUSTOM PROMPT');
  assert.equal(h.nodes['prompt-layer'].hidden, true);
});

test('a stored prompt is shown and used as the default', () => {
  const h = createHarness({ storedPrompt: 'STORED' });
  assert.equal(h.editor.getPromptText(), 'STORED');
  h.nodes['copy-prompt']._dispatch('contextmenu', { preventDefault() {} });
  assert.equal(h.nodes['prompt-input'].value, 'STORED');
});

test('an empty saved prompt clears the override', async () => {
  const h = createHarness({ storedPrompt: 'STORED' });
  h.nodes['copy-prompt']._dispatch('contextmenu', { preventDefault() {} });
  h.nodes['prompt-input'].value = '   ';
  await h.nodes['prompt-save']._dispatch('click', {});
  assert.equal(h.getState().view.pickupPrompt, null);
  assert.equal(h.editor.getPromptText(), 'DEFAULT PROMPT');
});

test('destroy removes the listeners', () => {
  const h = createHarness();
  const before = h.nodes['copy-prompt']._listeners.length;
  assert.ok(before > 0);
  h.editor.destroy();
  assert.equal(h.nodes['copy-prompt']._listeners.length, 0);
});

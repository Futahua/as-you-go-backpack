/** Mounts the real composition root.
 *
 * Until this file existed, everything in the composition root was verified by
 * inspection only: it queried the document at module load, so importing it
 * threw and no test could reach it. Visual bugs reached the user through a
 * fully green suite because of that hole. These tests are deliberately about
 * the wiring — that the real construction runs, controllers exist, and
 * listeners are attached — not about geometry, which the pure modules cover. */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mountWorkspace } from './public/workspace-app.js';
import {
  createFakeDocument,
  createFakeWindow,
  idsInShippedMarkup,
  classSelectorsInShippedMarkup,
} from './fake-dom.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const markup = await readFile(path.join(root, 'public/workspace-20260730b.html'), 'utf8');
const selectors = [...idsInShippedMarkup(markup), ...classSelectorsInShippedMarkup(markup)];

function mount({ loadWorkspace = async () => ({ schemaVersion: 1, groups: [], shortcuts: [] }) } = {}) {
  const document = createFakeDocument({ selectors });
  const window = createFakeWindow(document);
  const saved = [];
  const host = {
    loadWorkspace,
    saveWorkspace: async (snapshot) => { saved.push(snapshot); },
    copyText: async () => true,
    launchTarget: async () => {},
    revealTarget: async () => {},
    pickTarget: async () => null,
    resolveShortcutIcon: async () => null,
    resolveWebLinkIcon: async () => null,
    resolveDroppedTargets: async () => [],
    openWebLink: async () => {},
  };
  const app = mountWorkspace({
    document,
    window,
    host,
    requestAnimationFrame: window.requestAnimationFrame,
    cancelAnimationFrame: window.cancelAnimationFrame,
    ResizeObserver: window.ResizeObserver,
  });
  return { app, document, window, saved };
}

test('the real composition mounts without a browser', () => {
  const { app } = mount();
  assert.ok(app, 'mountWorkspace returned an app');
  for (const part of ['store', 'graph', 'commands', 'keyboard', 'pointer', 'drop', 'elements']) {
    assert.ok(app[part], `composition exposes ${part}`);
  }
});

test('a click outside the context menu closes it', () => {
  const { app, document } = mount();
  const menu = app.elements.menu;
  menu.hidden = false;

  // Asserting a click listener merely *exists* proves nothing — other
  // components register their own, so the assertion stays true even with this
  // one removed. The dismissal itself is the behaviour worth pinning.
  document.dispatch('click', { target: { closest: () => null } });
  assert.equal(menu.hidden, true, 'outside click closed the menu');
});

test('a click inside the context menu leaves it open', () => {
  const { app, document } = mount();
  const menu = app.elements.menu;
  menu.hidden = false;

  document.dispatch('click', { target: { closest: (selector) => (selector === '#context-menu' ? menu : null) } });
  assert.equal(menu.hidden, false, 'menu survives a click on itself');
});

test('mounting resolves every element in the registry', () => {
  const { app } = mount();
  for (const [name, element] of Object.entries(app.elements)) {
    assert.ok(element, `element ${name} resolved`);
  }
});

test('a failing state load still leaves the interface mounted', async () => {
  const { app } = mount({ loadWorkspace: async () => { throw new Error('host unavailable'); } });
  // bootstrapWorkspace mounts behaviour-only controllers before loading, so a
  // dead host must not leave the workspace inert.
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(app.keyboard, 'keyboard controller still constructed');
  assert.ok(app.elements.status, 'status element still resolved');
});

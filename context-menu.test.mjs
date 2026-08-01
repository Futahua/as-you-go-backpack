import assert from 'node:assert/strict';
import test from 'node:test';
import { createContextMenu } from './public/app/components/context-menu.js';

function createHarness({ binMode = false, clipboard = null, selected = [], currentId = 'root' } = {}) {
  const actions = [];
  const menuNode = {
    hidden: null,
    innerHTML: '',
    dataset: {},
    style: {},
    scrollHeight: 120,
    _listeners: [],
    addEventListener(type, handler, options) {
      const entry = { type, handler, options };
      menuNode._listeners.push(entry);
      if (options?.signal) {
        options.signal.addEventListener('abort', () => {
          const index = menuNode._listeners.indexOf(entry);
          if (index >= 0) menuNode._listeners.splice(index, 1);
        });
      }
    },
    _dispatch(type, event) {
      for (const entry of [...menuNode._listeners]) {
        if (entry.type === type) entry.handler(event);
      }
    },
    querySelector() { return null; },
  };

  const menu = createContextMenu({
    elements: { menu: menuNode },
    window: { innerWidth: 1200, innerHeight: 900 },
    getCurrentId: () => currentId,
    getBinMode: () => binMode,
    getClipboard: () => clipboard,
    getSelectedItems: () => selected,
    isWebLink: (candidate) => candidate.target?.startsWith('https://'),
    onAction: (action) => actions.push(action),
  });

  return { menu, menuNode, actions };
}

test('menuButton builds an accessible action button', () => {
  const { menu } = createHarness();
  const plain = menu.menuButton('copy', 'Copy');
  assert.match(plain, /data-action="copy"/);
  assert.match(plain, /role="menuitem"/);
  assert.doesNotMatch(plain, /danger-text/);
  const danger = menu.menuButton('bin', 'Move to Bin', true);
  assert.match(danger, /danger-text/);
});

test('openMenu blank shows creation actions and paste when clipboard exists', () => {
  const { menu, menuNode } = createHarness({ clipboard: { mode: 'copy' } });
  menu.openMenu(100, 100, 'blank', 'parent-group');
  assert.equal(menuNode.hidden, false);
  assert.equal(menuNode.dataset.parent, 'parent-group');
  assert.match(menuNode.innerHTML, /New folder/);
  assert.match(menuNode.innerHTML, /Add shortcut/);
  assert.match(menuNode.innerHTML, /Add web link/);
  assert.match(menuNode.innerHTML, /Paste copied items/);
});

test('openMenu in bin mode shows restore and permanent delete', () => {
  const { menu, menuNode } = createHarness({ binMode: true });
  menu.openMenu(100, 100);
  assert.match(menuNode.innerHTML, /Restore/);
  assert.match(menuNode.innerHTML, /Delete permanently/);
});

test('openMenu with a single selection shows edit/rename and Open', () => {
  const selected = [
    { id: 's1', name: 'App', target: 'C:\\app.exe' },
  ];
  const { menu, menuNode } = createHarness({ selected });
  menu.openMenu(100, 100);
  assert.match(menuNode.innerHTML, /data-action="open"/);
  assert.match(menuNode.innerHTML, /data-action="edit"/);
  assert.doesNotMatch(menuNode.innerHTML, /data-action="rename"/);
});

test('click dispatch routes the action to onAction and closes', () => {
  const { menu, menuNode, actions } = createHarness();
  menu.mount();
  menuNode._dispatch('click', { target: { closest: (sel) => ({ dataset: { action: 'paste' } }) } });
  assert.deepEqual(actions, ['paste']);
});

test('destroy removes the menu click listener and closes', () => {
  const { menu, menuNode } = createHarness();
  menu.mount();
  menu.openMenu(100, 100);
  assert.ok(menuNode._listeners.length > 0);
  menu.destroy();
  assert.equal(menuNode._listeners.length, 0);
  assert.equal(menuNode.hidden, true);
  assert.equal(menuNode.innerHTML, '');
});

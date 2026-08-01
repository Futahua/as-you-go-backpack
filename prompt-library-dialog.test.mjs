import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkspaceStore } from './public/app/workspace-store.js';
import { createPromptLibraryDialog } from './public/app/components/prompt-library-dialog.js';

function matchSimple(node, selector) {
  if (!node) return false;
  if (selector.startsWith('#')) return node.attributes.id === selector.slice(1);
  if (selector.startsWith('.')) return node.classList.contains(selector.slice(1));
  if (selector.startsWith('[')) {
    const m = selector.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/);
    if (!m) return false;
    const attr = m[1];
    const value = m[2];
    const got = node.dataset[attr] ?? node.attributes[attr];
    if (value !== undefined) { if (got !== value) return false; }
    else if (got === undefined) return false;
  } else if (node.tagName !== selector.toUpperCase()) {
    return false;
  }
  return true;
}

function simpleParts(token) {
  const parts = [];
  const re = /([.#][\w-]+|\[[^\]]+\]|[\w-]+)/g;
  let match;
  while ((match = re.exec(token)) !== null) parts.push(match[0]);
  return parts;
}

function matchToken(node, token) {
  for (const part of simpleParts(token)) {
    if (part.startsWith('.')) {
      if (!node.classList.contains(part.slice(1))) return false;
    } else if (part.startsWith('#')) {
      if (node.attributes.id !== part.slice(1)) return false;
    } else if (part.startsWith('[')) {
      const m = part.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/);
      if (!m) return false;
      const attr = m[1];
      const value = m[2];
      const got = node.dataset[attr] ?? node.attributes[attr];
      if (value !== undefined) { if (got !== value) return false; }
      else if (got === undefined) return false;
    } else if (node.tagName !== part.toUpperCase()) {
      return false;
    }
  }
  return true;
}

function matchDescendant(node, parts, index) {
  if (index < 0) return true;
  if (!matchToken(node, parts[index])) return false;
  if (index === 0) return true;
  let current = node.parentNode;
  while (current) {
    if (matchDescendant(current, parts, index - 1)) return true;
    current = current.parentNode;
  }
  return false;
}

function matches(node, selector) {
  for (const group of selector.split(',')) {
    const parts = group.trim().split(/\s+/);
    if (matchDescendant(node, parts, parts.length - 1)) return true;
  }
  return false;
}

function makeNode(tag) {
  const node = {
    tagName: String(tag).toUpperCase(),
    isFragment: false,
    children: [],
    parentNode: null,
    attributes: {},
    listeners: {},
    dataset: {},
    value: '',
    checked: false,
    indeterminate: false,
    disabled: false,
    hidden: false,
    draggable: false,
    rows: 0,
    maxLength: 0,
    type: '',
    title: '',
    _style: {},
    appendChild(child) {
      if (typeof child === 'string') return child;
      if (child.isFragment) {
        for (const grandchild of [...child.children]) node.appendChild(grandchild);
        return child;
      }
      node.children.push(child);
      child.parentNode = node;
      return child;
    },
    append(...children) { for (const child of children) node.appendChild(child); },
    remove() {
      if (node.parentNode) {
        node.parentNode.children = node.parentNode.children.filter((c) => c !== node);
      }
      node.parentNode = null;
    },
    setAttribute(name, value) { node.attributes[name] = String(value); },
    getAttribute(name) { return node.attributes[name]; },
    addEventListener(type, fn, options) {
      const entry = { fn, options };
      node.listeners[type] = node.listeners[type] || [];
      node.listeners[type].push(entry);
      if (options?.signal) {
        options.signal.addEventListener('abort', () => {
          node.listeners[type] = (node.listeners[type] || []).filter((e) => e !== entry);
        });
      }
    },
    dispatch(type, event = {}) {
      const results = [];
      let current = node;
      while (current) {
        for (const entry of current.listeners[type] || []) results.push(entry.fn(event));
        current = current.parentNode;
      }
      return results.length === 1 ? results[0] : Promise.all(results);
    },
    querySelectorAll(selector) {
      const found = [];
      const walk = (current) => {
        for (const child of current.children) {
          if (matches(child, selector)) found.push(child);
          walk(child);
        }
      };
      walk(node);
      return found;
    },
    querySelector(selector) { return node.querySelectorAll(selector)[0] ?? null; },
    closest(selector) {
      let current = node;
      while (current) {
        if (matches(current, selector)) return current;
        current = current.parentNode;
      }
      return null;
    },
    focus() {},
    getBoundingClientRect() { return { top: 0, left: 0, width: 100, height: 100, right: 100, bottom: 100 }; },
    style: { setProperty(name, value) { node._style[name] = value; } },
  };
  const classes = new Set();
  Object.defineProperty(node, 'className', {
    get() { return [...classes].join(' '); },
    set(value) {
      classes.clear();
      for (const name of String(value).split(/\s+/).filter(Boolean)) classes.add(name);
    },
    configurable: true,
  });
  let textContentValue = '';
  Object.defineProperty(node, 'textContent', {
    get() { return textContentValue; },
    set(value) {
      textContentValue = value;
      if (value === '') node.children = [];
    },
    configurable: true,
  });
  node.classList = {
    add(...names) { for (const n of names) classes.add(n); },
    remove(...names) { for (const n of names) classes.delete(n); },
    toggle(name, force) {
      if (force === undefined) {
        if (classes.has(name)) classes.delete(name);
        else classes.add(name);
      } else if (force) { classes.add(name); } else { classes.delete(name); }
    },
    contains(name) { return classes.has(name); },
  };
  const dataset = new Proxy({}, {
    get(target, key) { return target[key]; },
    set(target, key, value) {
      target[key] = value;
      const attr = 'data-' + String(key).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
      node.attributes[attr] = value;
      return true;
    },
  });
  node.dataset = dataset;
  return node;
}

const treeFixture = () => ({
  groups: [],
  shortcuts: [],
  view: { promptLibrary: [
    {
      id: 'folder-dev', type: 'folder', title: 'Dev', includeAll: false,
      children: [
        { id: 'prompt-a', type: 'prompt', title: 'Alpha', text: 'one', includeInBatch: true },
        {
          id: 'folder-inner', type: 'folder', title: 'Inner', includeAll: false,
          children: [{ id: 'prompt-b', type: 'prompt', title: 'Beta', text: 'two', includeInBatch: false }],
        },
      ],
    },
    { id: 'prompt-root', type: 'prompt', title: 'Root', text: 'three', includeInBatch: true },
  ] },
});

function createHarness({ initialView = null } = {}) {
  let state = initialView
    ? { groups: [], shortcuts: [], view: initialView }
    : { groups: [], shortcuts: [], view: { promptLibrary: [] } };
  const store = createWorkspaceStore({
    getState: () => state,
    setState: (next) => { state = next; },
    persist: async () => {},
    normalizeState: (s) => s,
    setStatus: () => {},
  });
  const topIds = [
    'prompt-layer', 'prompt-add-prompt', 'prompt-add-folder', 'prompt-card-list', 'prompt-tree-menu', 'prompt-status',
    'prompt-error', 'prompt-cancel', 'prompt-save', 'copy-prompt',
    'prompt-delete-confirm', 'prompt-delete-message', 'prompt-delete-ok', 'prompt-delete-cancel',
  ];
  const nodes = Object.fromEntries(topIds.map((id) => [id, makeNode(id)]));
  nodes['prompt-layer'].hidden = true;
  nodes['prompt-card-list'].className = 'prompt-tree-list';
  nodes['prompt-status'].setAttribute('role', 'status');
  nodes['prompt-status'].setAttribute('aria-live', 'polite');

  const documentMock = {
    querySelector: (sel) => nodes[sel.slice(1)] ?? null,
    createElement: (tag) => makeNode(tag),
    createElementNS: (ns, tag) => makeNode(tag),
    createDocumentFragment: () => { const f = makeNode('fragment'); f.isFragment = true; return f; },
    listeners: {},
    addEventListener(type, fn, options) {
      const entry = { fn, options };
      documentMock.listeners[type] = documentMock.listeners[type] || [];
      documentMock.listeners[type].push(entry);
      if (options?.signal) {
        options.signal.addEventListener('abort', () => {
          documentMock.listeners[type] = (documentMock.listeners[type] || []).filter((e) => e !== entry);
        });
      }
    },
    dispatch(type, event = {}) {
      const results = [];
      for (const entry of documentMock.listeners[type] || []) results.push(entry.fn(event));
      return results.length === 1 ? results[0] : Promise.all(results);
    },
  };
  const copied = [];
  const statuses = [];
  const dialog = createPromptLibraryDialog({
    document: documentMock,
    store,
    fallbackPrompt: 'FALLBACK PROMPT',
    copyText: (text) => { copied.push(text); return Promise.resolve(); },
    setStatus: (message) => statuses.push(message),
  });
  dialog.mount();
  return {
    dialog, store, nodes, copied, statuses,
    getState: () => state,
    rows: () => nodes['prompt-card-list'].querySelectorAll('.prompt-tree-row'),
    rowFor: (id) => nodes['prompt-card-list'].querySelectorAll('.prompt-tree-row').find((r) => r.dataset.nodeId === id),
    promptRows: () => nodes['prompt-card-list'].querySelectorAll('.prompt-tree-row.prompt-prompt-row'),
    folderRows: () => nodes['prompt-card-list'].querySelectorAll('.prompt-tree-row.prompt-folder-row'),
    textareaFor: (id) => nodes['prompt-card-list'].querySelectorAll('.prompt-card-details').find((d) => d.dataset.nodeId === id)?.querySelector('.prompt-card-text') ?? null,
  };
}

const preventDefault = () => {};
const stopPropagation = () => {};
const open = (h, o) => h.dialog.open(o);

const clickRow = (h, id, modifiers = {}) => {
  const row = h.rowFor(id);
  row.dispatch('click', { target: row, ...modifiers, preventDefault, stopPropagation });
};
const keyOn = (h, event = {}) => {
  const list = h.nodes['prompt-card-list'];
  list.dispatch('keydown', { target: list, ...event, preventDefault, stopPropagation });
};
const openPrompt = (h, id) => {
  const chevron = h.rowFor(id).querySelector('.prompt-card-toggle');
  chevron.dispatch('click', { target: chevron, preventDefault, stopPropagation });
};
const chevronOf = (h, id) => h.rowFor(id).querySelector('.prompt-card-toggle');
const save = async (h) => { await h.nodes['prompt-save'].dispatch('click', { preventDefault }); };
const blankClick = (h) => h.nodes['prompt-card-list'].dispatch('click', { target: h.nodes['prompt-card-list'], preventDefault, stopPropagation });

test('Ctrl+Z/Y/Shift+Z drive local undo/redo', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  h.nodes['prompt-add-prompt'].dispatch('click', { preventDefault });
  assert.equal(h.promptRows().length, 3, 'prompt added');
  keyOn(h, { key: 'z', ctrlKey: true });
  assert.equal(h.promptRows().length, 2, 'undo removed the added prompt');
  keyOn(h, { key: 'y', ctrlKey: true });
  assert.equal(h.promptRows().length, 3, 'redo restored the added prompt');
  keyOn(h, { key: 'z', ctrlKey: true });
  keyOn(h, { key: 'z', ctrlKey: true, shiftKey: true });
  assert.equal(h.promptRows().length, 3, 'Ctrl+Shift+Z also redoes');
});

test('Ctrl+Z inside an editable control stays native', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  h.nodes['prompt-add-prompt'].dispatch('click', { preventDefault });
  const added = h.promptRows()[h.promptRows().length - 1];
  const input = added.querySelector('.prompt-card-title');
  input.dispatch('keydown', { target: input, key: 'z', ctrlKey: true, preventDefault, stopPropagation });
  assert.equal(h.promptRows().length, 3, 'tree undo is not triggered from inside an input');
});

test('20 title keystrokes are one undo step', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  openPrompt(h, 'prompt-root');
  const input = h.rowFor('prompt-root').querySelector('.prompt-card-title');
  for (let i = 0; i < 20; i += 1) {
    input.value += 'x';
    input.dispatch('input', { target: input });
  }
  chevronOf(h, 'prompt-root').dispatch('click', { target: chevronOf(h, 'prompt-root'), preventDefault, stopPropagation });
  keyOn(h, { key: 'z', ctrlKey: true });
  await save(h);
  assert.equal(h.getState().view.promptLibrary[1].title, 'Root', 'whole editing session undone in one step');
});

test('delete restores the complete folder subtree on undo', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'folder-dev');
  keyOn(h, { key: 'Delete' });
  h.nodes['prompt-delete-ok'].dispatch('click', { preventDefault });
  assert.equal(h.rowFor('folder-dev'), undefined);
  keyOn(h, { key: 'z', ctrlKey: true });
  await save(h);
  assert.equal(h.getState().view.promptLibrary[0].id, 'folder-dev', 'folder restored');
  assert.equal(h.getState().view.promptLibrary[0].children.length, 2, 'subtree restored');
});

test('copy paste is removed by one undo and redone with the same ids', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'prompt-a');
  keyOn(h, { key: 'c', ctrlKey: true });
  keyOn(h, { key: 'v', ctrlKey: true });
  await save(h);
  const afterPaste = h.getState().view.promptLibrary[0].children.map((n) => n.id);
  keyOn(h, { key: 'z', ctrlKey: true });
  keyOn(h, { key: 'y', ctrlKey: true });
  await save(h);
  assert.deepEqual(h.getState().view.promptLibrary[0].children.map((n) => n.id), afterPaste, 'redo restores the same nodes');
});

test('cut paste restores the exact source position by one undo', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'prompt-a');
  keyOn(h, { key: 'x', ctrlKey: true });
  blankClick(h);
  keyOn(h, { key: 'v', ctrlKey: true });
  await save(h);
  assert.ok(h.getState().view.promptLibrary.some((n) => n.id === 'prompt-a'), 'moved to root');
  keyOn(h, { key: 'z', ctrlKey: true });
  await save(h);
  assert.ok(h.getState().view.promptLibrary[0].children.some((n) => n.id === 'prompt-a'), 'restored to original parent');
});

test('expansion and selection alone create no history', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'prompt-root');
  chevronOf(h, 'prompt-root').dispatch('click', { target: chevronOf(h, 'prompt-root'), preventDefault, stopPropagation });
  keyOn(h, { key: 'z', ctrlKey: true });
  assert.ok(h.nodes['prompt-status'].textContent.includes('Nothing to undo'));
});

test('blank click targets the root and creates no history', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'prompt-a');
  keyOn(h, { key: 'c', ctrlKey: true });
  blankClick(h);
  assert.equal(h.rowFor('prompt-a').getAttribute('aria-selected'), 'false', 'blank clears selection');
  keyOn(h, { key: 'v', ctrlKey: true });
  await save(h);
  assert.equal(h.getState().view.promptLibrary.length, 3, 'copied node pasted at root');
  keyOn(h, { key: 'z', ctrlKey: true });
  await save(h);
  assert.equal(h.getState().view.promptLibrary.length, 2, 'root paste undone in one step');
});

test('right-click blank space opens the root menu with Paste at top level', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'prompt-a');
  keyOn(h, { key: 'c', ctrlKey: true });
  const list = h.nodes['prompt-card-list'];
  list.dispatch('contextmenu', { target: list, clientX: 10, clientY: 10, preventDefault });
  const labels = h.nodes['prompt-tree-menu'].querySelectorAll('[role="menuitem"]').map((b) => b.textContent);
  assert.ok(labels.includes('Paste at top level'));
  assert.ok(labels.includes('New prompt'));
  assert.ok(labels.includes('New folder'));
  assert.ok(labels.includes('Select all'));
  const pasteItem = h.nodes['prompt-tree-menu'].querySelectorAll('[role="menuitem"]').find((b) => b.textContent === 'Paste at top level');
  pasteItem.dispatch('click', { target: pasteItem, preventDefault, stopPropagation });
  assert.equal(h.rowFor('prompt-a').getAttribute('aria-selected'), 'false', 'blank right-click clears row selection');
  assert.equal(h.promptRows().length, 3, 'root paste duplicated a prompt at top level');
});

test('multiple selected rows paste at root by default', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'prompt-a');
  clickRow(h, 'prompt-root', { ctrlKey: true });
  keyOn(h, { key: 'c', ctrlKey: true });
  keyOn(h, { key: 'v', ctrlKey: true });
  await save(h);
  assert.equal(h.getState().view.promptLibrary.length, 4, 'both copied roots pasted at top level');
});

test('dragging below the final top-level row moves nodes to root', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  const src = h.rowFor('prompt-a');
  const list = h.nodes['prompt-card-list'];
  const data = { pointerId: 9 };
  src.dispatch('pointerdown', { ...data, button: 0, clientX: 50, clientY: 50, target: src });
  list.dispatch('pointermove', { ...data, clientX: 200, clientY: 200, target: list, preventDefault, stopPropagation });
  list.dispatch('pointerup', { ...data, clientX: 200, clientY: 200, target: list, preventDefault, stopPropagation });
  await save(h);
  assert.ok(h.getState().view.promptLibrary.some((n) => n.id === 'prompt-a'), 'dragged to root');
  assert.ok(h.getState().view.promptLibrary[0].children.every((n) => n.id !== 'prompt-a'), 'left its folder');
});

test('Cancel after undo/redo leaves the saved store unchanged', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  h.nodes['prompt-add-prompt'].dispatch('click', { preventDefault });
  keyOn(h, { key: 'z', ctrlKey: true });
  keyOn(h, { key: 'y', ctrlKey: true });
  h.nodes['prompt-cancel'].dispatch('click', { preventDefault });
  assert.equal(h.getState().view.promptLibrary.length, 2, 'saved store untouched by undo/redo drafts');
});

test('reopening the dialog starts with empty local history', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  h.nodes['prompt-add-prompt'].dispatch('click', { preventDefault });
  h.nodes['prompt-cancel'].dispatch('click', { preventDefault });
  open(h);
  keyOn(h, { key: 'z', ctrlKey: true });
  assert.ok(h.nodes['prompt-status'].textContent.includes('Nothing to undo'));
});

test('right-clicking the copy button opens the library', () => {
  const h = createHarness({ initialView: treeFixture().view });
  h.nodes['copy-prompt'].dispatch('contextmenu', { preventDefault });
  assert.equal(h.nodes['prompt-layer'].hidden, false);
  assert.ok(h.rows().length > 0);
});

test('left-click selects one row and ctrl-click toggles without clearing', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'prompt-a');
  assert.equal(h.rowFor('prompt-a').getAttribute('aria-selected'), 'true');
  clickRow(h, 'prompt-root', { ctrlKey: true });
  assert.equal(h.rowFor('prompt-root').getAttribute('aria-selected'), 'true');
  assert.equal(h.rowFor('prompt-a').getAttribute('aria-selected'), 'true', 'ctrl keeps prior selection');
  clickRow(h, 'prompt-a', { ctrlKey: true });
  assert.equal(h.rowFor('prompt-a').getAttribute('aria-selected'), 'false', 'ctrl toggles off');
});

test('pointerdown without movement never mutates selection', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'prompt-a');
  const row = h.rowFor('prompt-root');
  row.dispatch('pointerdown', { pointerId: 3, button: 0, clientX: 50, clientY: 50, target: row });
  assert.equal(h.rowFor('prompt-a').getAttribute('aria-selected'), 'true', 'selection untouched by pointerdown');
  assert.equal(h.rowFor('prompt-root').getAttribute('aria-selected'), 'false');
});

test('drag threshold selects an unselected drag source once and suppresses the following click', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'prompt-a');
  const src = h.rowFor('prompt-root');
  const target = h.rowFor('folder-dev');
  const data = { pointerId: 4 };
  src.dispatch('pointerdown', { ...data, button: 0, clientX: 50, clientY: 50, target: src });
  assert.equal(h.rowFor('prompt-root').getAttribute('aria-selected'), 'false', 'still unselected before threshold');
  target.dispatch('pointermove', { ...data, clientX: 200, clientY: 200, target, preventDefault, stopPropagation });
  assert.equal(h.rowFor('prompt-root').getAttribute('aria-selected'), 'true', 'selected once at threshold');
  target.dispatch('pointermove', { ...data, clientX: 200, clientY: 50, target, preventDefault, stopPropagation });
  target.dispatch('pointerup', { ...data, clientX: 200, clientY: 50, target, preventDefault, stopPropagation });
  const selectedBeforeClick = h.rowFor('prompt-root').getAttribute('aria-selected');
  target.dispatch('click', { target, preventDefault, stopPropagation });
  assert.equal(h.rowFor('prompt-root').getAttribute('aria-selected'), selectedBeforeClick, 'post-drag synthetic click suppressed');
});

test('folder title single-click selects without expanding', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  const title = h.rowFor('folder-inner').querySelector('.prompt-folder-title');
  title.dispatch('click', { target: title, preventDefault, stopPropagation });
  assert.equal(h.rowFor('folder-inner').getAttribute('aria-selected'), 'true', 'title selects the folder');
  assert.equal(h.rowFor('prompt-b'), undefined, 'title does not expand');
});

test('folder chevron expands without selecting', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  const chevron = h.rowFor('folder-inner').querySelector('.prompt-folder-toggle');
  chevron.dispatch('click', { target: chevron, preventDefault, stopPropagation });
  assert.ok(h.rowFor('prompt-b'), 'chevron expands the folder');
  assert.equal(h.rowFor('folder-inner').getAttribute('aria-selected'), 'false', 'chevron leaves selection untouched');
});

test('shift-click selects the visible range', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'prompt-a');
  clickRow(h, 'prompt-root', { shiftKey: true });
  assert.equal(h.rowFor('prompt-a').getAttribute('aria-selected'), 'true');
  assert.equal(h.rowFor('folder-inner').getAttribute('aria-selected'), 'true');
  assert.equal(h.rowFor('prompt-root').getAttribute('aria-selected'), 'true');
});

test('right-click preserves the selected group and selects an unselected row alone', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'prompt-a');
  clickRow(h, 'prompt-root', { ctrlKey: true });
  h.rowFor('prompt-a').dispatch('contextmenu', { target: h.rowFor('prompt-a'), clientX: 10, clientY: 10, preventDefault });
  assert.equal(h.rowFor('prompt-a').getAttribute('aria-selected'), 'true');
  assert.equal(h.rowFor('prompt-root').getAttribute('aria-selected'), 'true', 'existing group preserved');
  h.rowFor('folder-inner').dispatch('contextmenu', { target: h.rowFor('folder-inner'), clientX: 10, clientY: 10, preventDefault });
  assert.equal(h.rowFor('folder-inner').getAttribute('aria-selected'), 'true');
  assert.equal(h.rowFor('prompt-a').getAttribute('aria-selected'), 'false', 'unselected row selects alone');
});

test('checkbox and chevron clicks never alter row selection', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'prompt-root');
  h.rowFor('prompt-root').querySelector('.prompt-checkbox').dispatch('click', { target: h.rowFor('prompt-root').querySelector('.prompt-checkbox'), preventDefault, stopPropagation });
  assert.equal(h.rowFor('prompt-root').getAttribute('aria-selected'), 'true', 'checkbox leaves selection');
  chevronOf(h, 'prompt-root').dispatch('click', { target: chevronOf(h, 'prompt-root'), preventDefault, stopPropagation });
  assert.equal(h.rowFor('prompt-root').getAttribute('aria-selected'), 'true', 'chevron leaves selection');
});

test('blank click clears selection', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'prompt-root');
  h.nodes['prompt-card-list'].dispatch('click', { target: h.nodes['prompt-card-list'], preventDefault, stopPropagation });
  assert.equal(h.rowFor('prompt-root').getAttribute('aria-selected'), 'false');
});

test('Ctrl+A selects every visible row', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  keyOn(h, { key: 'a', ctrlKey: true });
  const selected = h.rows().filter((r) => r.getAttribute('aria-selected') === 'true').length;
  assert.equal(selected, h.rows().length, 'all visible rows selected');
});

test('double-clicking a prompt copies its current draft text only', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  openPrompt(h, 'prompt-root');
  const textarea = h.textareaFor('prompt-root');
  textarea.value = 'unsaved draft body';
  textarea.dispatch('input', { target: textarea });
  h.rowFor('prompt-root').dispatch('dblclick', { target: h.rowFor('prompt-root'), preventDefault, stopPropagation });
  return Promise.resolve().then(() => {
    assert.deepEqual(h.copied, ['unsaved draft body']);
  });
});

test('double-clicking a folder expands it instead of copying', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  h.rowFor('folder-inner').dispatch('dblclick', { target: h.rowFor('folder-inner'), preventDefault, stopPropagation });
  assert.ok(h.rowFor('prompt-b'), 'collapsed folder expanded on double-click');
  assert.deepEqual(h.copied, []);
  h.rowFor('folder-inner').dispatch('dblclick', { target: h.rowFor('folder-inner'), preventDefault, stopPropagation });
  assert.equal(h.rowFor('prompt-b'), undefined, 'double-click toggles back');
});

test('only one prompt editor opens at a time with no duplicate title field', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  openPrompt(h, 'prompt-a');
  openPrompt(h, 'prompt-root');
  const rootRow = h.rowFor('prompt-root');
  assert.ok(rootRow.querySelector('.prompt-card-title'), 'editor opens');
  assert.equal(rootRow.querySelectorAll('.prompt-card-title').length, 1, 'no duplicate title field');
  assert.equal(rootRow.querySelector('.prompt-prompt-title'), null, 'collapsed title replaced inline');
  assert.equal(h.rowFor('prompt-a').querySelector('.prompt-card-title'), null, 'first editor closed');
});

test('title and text survive collapse and re-render', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  openPrompt(h, 'prompt-root');
  const titleInput = h.rowFor('prompt-root').querySelector('.prompt-card-title');
  titleInput.value = 'Renamed';
  titleInput.dispatch('input', { target: titleInput });
  const textarea = h.textareaFor('prompt-root');
  textarea.value = 'edited body';
  textarea.dispatch('input', { target: textarea });
  chevronOf(h, 'prompt-root').dispatch('click', { target: chevronOf(h, 'prompt-root'), preventDefault, stopPropagation });
  openPrompt(h, 'prompt-root');
  assert.equal(h.rowFor('prompt-root').querySelector('.prompt-card-title').value, 'Renamed');
  assert.equal(h.textareaFor('prompt-root').value, 'edited body');
  await h.nodes['prompt-save'].dispatch('click', { preventDefault });
  assert.equal(h.getState().view.promptLibrary[1].title, 'Renamed');
  assert.equal(h.getState().view.promptLibrary[1].text, 'edited body');
});

test('folder F2 rename commits on Enter and cancels on Escape', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'folder-dev');
  keyOn(h, { key: 'F2' });
  let input = h.rowFor('folder-dev').querySelector('.prompt-folder-rename');
  assert.ok(input, 'rename input appears');
  input.value = 'Development';
  input.dispatch('input', { target: input });
  input.dispatch('keydown', { target: input, key: 'Enter', preventDefault, stopPropagation });
  assert.equal(h.rowFor('folder-dev').querySelector('.prompt-folder-title').textContent, 'Development');
  keyOn(h, { key: 'F2' });
  input = h.rowFor('folder-dev').querySelector('.prompt-folder-rename');
  input.value = 'Discarded';
  input.dispatch('input', { target: input });
  input.dispatch('keydown', { target: input, key: 'Escape', preventDefault, stopPropagation });
  assert.equal(h.rowFor('folder-dev').querySelector('.prompt-folder-title').textContent, 'Development');
  await h.nodes['prompt-save'].dispatch('click', { preventDefault });
  assert.equal(h.getState().view.promptLibrary[0].title, 'Development');
});

test('folder rename commits on focusout', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'folder-dev');
  keyOn(h, { key: 'F2' });
  const input = h.rowFor('folder-dev').querySelector('.prompt-folder-rename');
  input.value = 'Blurred';
  input.dispatch('input', { target: input });
  input.dispatch('focusout', { target: input, preventDefault, stopPropagation });
  assert.equal(h.rowFor('folder-dev').querySelector('.prompt-folder-title').textContent, 'Blurred');
});

test('multiple folders can remain expanded; collapse removes hidden selection', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  h.rowFor('folder-inner').querySelector('.prompt-folder-toggle').dispatch('click', { target: h.rowFor('folder-inner').querySelector('.prompt-folder-toggle'), preventDefault, stopPropagation });
  assert.ok(h.rowFor('prompt-b'), 'deep folder expands');
  clickRow(h, 'prompt-b', { ctrlKey: true });
  clickRow(h, 'folder-inner', { ctrlKey: true });
  assert.equal(h.rowFor('prompt-b').getAttribute('aria-selected'), 'true');
  h.rowFor('folder-inner').querySelector('.prompt-folder-toggle').dispatch('click', { target: h.rowFor('folder-inner').querySelector('.prompt-folder-toggle'), preventDefault, stopPropagation });
  assert.equal(h.rowFor('prompt-b'), undefined, 'folder collapsed');
  assert.equal(h.rowFor('folder-inner').getAttribute('aria-selected'), 'true', 'hidden selection repaired to the folder');
});

test('prompt and folder checkboxes update config without touching selection', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'prompt-root');
  const promptCheckbox = h.rowFor('prompt-root').querySelector('.prompt-checkbox');
  promptCheckbox.checked = false;
  promptCheckbox.dispatch('change', { target: promptCheckbox });
  assert.equal(h.rowFor('prompt-root').getAttribute('aria-selected'), 'true');
  const folderCheckbox = h.rowFor('folder-dev').querySelector('.prompt-checkbox');
  folderCheckbox.checked = true;
  folderCheckbox.dispatch('change', { target: folderCheckbox });
  assert.equal(h.rowFor('folder-dev').querySelector('.prompt-checkbox').checked, true);
  assert.equal(h.rowFor('folder-dev').querySelector('.prompt-checkbox').indeterminate, false);
});

test('folder includeAll never rewrites descendant prompt checkboxes', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  const folderCheckbox = h.rowFor('folder-dev').querySelector('.prompt-checkbox');
  folderCheckbox.checked = true;
  folderCheckbox.dispatch('change', { target: folderCheckbox });
  await h.nodes['prompt-save'].dispatch('click', { preventDefault });
  const saved = h.getState().view.promptLibrary[0];
  assert.equal(saved.includeAll, true);
  assert.equal(saved.children[0].includeInBatch, true);
  assert.equal(saved.children[1].children[0].includeInBatch, false, 'child state preserved');
});

test('checkboxes carry explicit accessible labels', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  assert.equal(h.rowFor('prompt-a').querySelector('.prompt-checkbox').getAttribute('aria-label'), 'Include Alpha in batch');
  assert.equal(h.rowFor('folder-dev').querySelector('.prompt-checkbox').getAttribute('aria-label'), 'Include every prompt inside Dev');
});

test('context menu for a single prompt offers copy/edit/include/delete', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'prompt-root');
  h.rowFor('prompt-root').dispatch('contextmenu', { target: h.rowFor('prompt-root'), clientX: 10, clientY: 10, preventDefault });
  const labels = h.nodes['prompt-tree-menu'].querySelectorAll('[role="menuitem"]').map((b) => b.textContent);
  assert.deepEqual(labels, ['Open / Edit', 'Copy prompt text', 'Copy item', 'Cut item', 'Exclude from batch', 'Delete']);
});

test('context menu for a folder offers expand/rename/include/new-inside/delete', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'folder-dev');
  h.rowFor('folder-dev').dispatch('contextmenu', { target: h.rowFor('folder-dev'), clientX: 10, clientY: 10, preventDefault });
  const labels = h.nodes['prompt-tree-menu'].querySelectorAll('[role="menuitem"]').map((b) => b.textContent);
  assert.ok(labels.includes('Collapse'));
  assert.ok(labels.includes('Rename'));
  assert.ok(labels.includes('New prompt inside'));
  assert.ok(labels.includes('New folder inside'));
  assert.ok(labels.includes('Delete'));
});

test('context menu include/exclude updates the node', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'prompt-a');
  h.rowFor('prompt-a').dispatch('contextmenu', { target: h.rowFor('prompt-a'), clientX: 10, clientY: 10, preventDefault });
  const includeItem = h.nodes['prompt-tree-menu'].querySelectorAll('[role="menuitem"]').find((b) => b.textContent === 'Exclude from batch');
  includeItem.dispatch('click', { target: includeItem, preventDefault, stopPropagation });
  assert.equal(h.rowFor('prompt-a').querySelector('.prompt-checkbox').checked, false, 'prompt excluded');
});

test('context-menu Copy prompt text copies the draft prompt body only', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  openPrompt(h, 'prompt-root');
  const textarea = h.textareaFor('prompt-root');
  textarea.value = 'unsaved body';
  textarea.dispatch('input', { target: textarea });
  clickRow(h, 'prompt-root');
  h.rowFor('prompt-root').dispatch('contextmenu', { target: h.rowFor('prompt-root'), clientX: 10, clientY: 10, preventDefault });
  const copyItem = h.nodes['prompt-tree-menu'].querySelectorAll('[role="menuitem"]').find((b) => b.textContent === 'Copy prompt text');
  copyItem.dispatch('click', { target: copyItem, preventDefault, stopPropagation });
  return Promise.resolve().then(() => {
    assert.deepEqual(h.copied, ['unsaved body']);
    assert.ok(h.nodes['prompt-status'].textContent.includes('Prompt copied'), 'feedback is local to the modal');
  });
});

test('Delete key deletes the selected roots once', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'prompt-a');
  clickRow(h, 'prompt-root', { ctrlKey: true });
  keyOn(h, { key: 'Delete' });
  assert.equal(h.nodes['prompt-delete-confirm'].hidden, false, 'multi-selection confirms');
  h.nodes['prompt-delete-ok'].dispatch('click', { preventDefault });
  assert.equal(h.rowFor('prompt-a'), undefined);
  assert.equal(h.rowFor('prompt-root'), undefined);
  await h.nodes['prompt-save'].dispatch('click', { preventDefault });
  assert.equal(h.getState().view.promptLibrary[0].children[0].children[0].id, 'prompt-b', 'remaining prompts preserved');
});

test('the final prompt cannot be deleted through folder confirmation', () => {
  const view = { promptLibrary: [
    { id: 'folder-x', type: 'folder', title: 'X', includeAll: false, children: [{ id: 'prompt-p', type: 'prompt', title: 'P', text: 'body', includeInBatch: true }] },
  ] };
  const h = createHarness({ initialView: view });
  open(h);
  clickRow(h, 'folder-x');
  keyOn(h, { key: 'Delete' });
  assert.equal(h.nodes['prompt-delete-confirm'].hidden, true, 'impossible delete never confirmed');
  assert.ok(h.nodes['prompt-error'].textContent.includes('at least one'));
  assert.ok(h.rowFor('folder-x'), 'folder intact');
});

test('confirmation message counts contained prompts', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'folder-dev');
  keyOn(h, { key: 'Delete' });
  assert.ok(h.nodes['prompt-delete-message'].textContent.includes('2 contained prompts'));
});

test('dragging a selected row moves the complete selection atomically in order', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'prompt-a');
  clickRow(h, 'prompt-root', { ctrlKey: true });
  const src = h.rowFor('prompt-a');
  const target = h.rowFor('folder-inner');
  const data = { pointerId: 8 };
  src.dispatch('pointerdown', { ...data, button: 0, clientX: 50, clientY: 50, target: src });
  target.dispatch('pointermove', { ...data, clientX: 200, clientY: 200, target, preventDefault, stopPropagation });
  target.dispatch('pointermove', { ...data, clientX: 200, clientY: 50, target, preventDefault, stopPropagation });
  target.dispatch('pointerup', { ...data, clientX: 200, clientY: 50, target, preventDefault, stopPropagation });
  await h.nodes['prompt-save'].dispatch('click', { preventDefault });
  const inner = h.getState().view.promptLibrary[0].children[0];
  assert.deepEqual(inner.children.map((n) => n.id), ['prompt-b', 'prompt-a', 'prompt-root'], 'selection appended inside in order');
  assert.equal(inner.children.length, 3);
  assert.equal(h.getState().view.promptLibrary[0].children.length, 1, 'prompt-a left its original parent');
});

test('pointer drag of an unselected row selects it first, then moves it inside a folder', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  const src = h.rowFor('prompt-root');
  const target = h.rowFor('folder-dev');
  const data = { pointerId: 5 };
  src.dispatch('pointerdown', { ...data, button: 0, clientX: 50, clientY: 50, target: src });
  target.dispatch('pointermove', { ...data, clientX: 200, clientY: 200, target, preventDefault, stopPropagation });
  target.dispatch('pointermove', { ...data, clientX: 200, clientY: 50, target, preventDefault, stopPropagation });
  assert.ok(src.classList.contains('prompt-dragging'), 'dragged styling persists during dragover');
  target.dispatch('pointerup', { ...data, clientX: 200, clientY: 50, target, preventDefault, stopPropagation });
  await h.nodes['prompt-save'].dispatch('click', { preventDefault });
  const saved = h.getState().view.promptLibrary[0].children;
  assert.deepEqual(saved.map((n) => n.id), ['prompt-a', 'folder-inner', 'prompt-root'], 'moved inside folder');
  assert.equal(h.getState().view.promptLibrary.some((n) => n.id === 'prompt-root'), false);
});

test('a folder cannot be dragged into its own descendant', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  const toggle = h.rowFor('folder-inner').querySelector('.prompt-folder-toggle');
  toggle.dispatch('click', { target: toggle, preventDefault, stopPropagation });
  const src = h.rowFor('folder-dev');
  const target = h.rowFor('prompt-b');
  const data = { pointerId: 6 };
  src.dispatch('pointerdown', { ...data, button: 0, clientX: 50, clientY: 50, target: src });
  target.dispatch('pointermove', { ...data, clientX: 200, clientY: 200, target, preventDefault, stopPropagation });
  target.dispatch('pointermove', { ...data, clientX: 200, clientY: 50, target, preventDefault, stopPropagation });
  target.dispatch('pointerup', { ...data, clientX: 200, clientY: 50, target, preventDefault, stopPropagation });
  await h.nodes['prompt-save'].dispatch('click', { preventDefault });
  assert.equal(h.getState().view.promptLibrary[0].id, 'folder-dev', 'cycle rejected');
  assert.equal(h.getState().view.promptLibrary.length, 2, 'no nodes lost');
});

test('Enter opens the focused prompt editor', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'prompt-root');
  keyOn(h, { key: 'Enter' });
  assert.ok(h.rowFor('prompt-root').querySelector('.prompt-card-title'), 'editor opened');
});

test('Save persists and Cancel discards all draft changes', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  openPrompt(h, 'prompt-root');
  const textarea = h.textareaFor('prompt-root');
  textarea.value = 'draft';
  textarea.dispatch('input', { target: textarea });
  h.nodes['prompt-cancel'].dispatch('click', { preventDefault });
  assert.equal(h.getState().view.promptLibrary[1].text, 'three', 'cancel discards');
  open(h);
  openPrompt(h, 'prompt-root');
  const t2 = h.textareaFor('prompt-root');
  t2.value = 'saved';
  t2.dispatch('input', { target: t2 });
  await h.nodes['prompt-save'].dispatch('click', { preventDefault });
  assert.equal(h.getState().view.promptLibrary[1].text, 'saved');
  assert.equal(h.nodes['prompt-layer'].hidden, true);
});

test('persistence failure leaves the dialog open and re-enables Save', async () => {
  let state = { groups: [], shortcuts: [], view: { promptLibrary: [{ id: 'prompt-x', type: 'prompt', title: 'X', text: 'body', includeInBatch: true }] } };
  const store = createWorkspaceStore({
    getState: () => state,
    setState: (next) => { state = next; },
    persist: async () => { throw new Error('disk full'); },
    normalizeState: (s) => s,
    setStatus: () => {},
  });
  const topIds = [
    'prompt-layer', 'prompt-add-prompt', 'prompt-add-folder', 'prompt-card-list', 'prompt-tree-menu', 'prompt-status',
    'prompt-error', 'prompt-cancel', 'prompt-save', 'copy-prompt',
    'prompt-delete-confirm', 'prompt-delete-message', 'prompt-delete-ok', 'prompt-delete-cancel',
  ];
  const nodes = Object.fromEntries(topIds.map((id) => [id, makeNode(id)]));
  nodes['prompt-layer'].hidden = true;
  nodes['prompt-status'].setAttribute('role', 'status');
  nodes['prompt-status'].setAttribute('aria-live', 'polite');

  const documentMock = {
    querySelector: (sel) => nodes[sel.slice(1)] ?? null,
    createElement: (tag) => makeNode(tag),
    createElementNS: (ns, tag) => makeNode(tag),
    createDocumentFragment: () => { const f = makeNode('fragment'); f.isFragment = true; return f; },
    listeners: {},
    addEventListener(type, fn, options) {
      const entry = { fn, options };
      documentMock.listeners[type] = documentMock.listeners[type] || [];
      documentMock.listeners[type].push(entry);
      if (options?.signal) {
        options.signal.addEventListener('abort', () => {
          documentMock.listeners[type] = (documentMock.listeners[type] || []).filter((e) => e !== entry);
        });
      }
    },
    dispatch(type, event = {}) {
      const results = [];
      for (const entry of documentMock.listeners[type] || []) results.push(entry.fn(event));
      return results.length === 1 ? results[0] : Promise.all(results);
    },
  };
  const dialog = createPromptLibraryDialog({
    document: documentMock,
    store,
    fallbackPrompt: 'FALLBACK',
    copyText: () => Promise.resolve(),
    setStatus: () => {},
  });
  dialog.mount();
  dialog.open();
  await nodes['prompt-save'].dispatch('click', { preventDefault });
  assert.equal(nodes['prompt-layer'].hidden, false, 'dialog stays open');
  assert.ok(nodes['prompt-error'].textContent.includes('disk full'));
  assert.equal(nodes['prompt-save'].disabled, false);
});

test('Ctrl+C stores nodes internally without calling copyText', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'prompt-a');
  clickRow(h, 'prompt-root', { ctrlKey: true });
  keyOn(h, { key: 'c', ctrlKey: true });
  assert.deepEqual(h.copied, [], 'no OS clipboard write');
  assert.ok(h.nodes['prompt-status'].textContent.includes('2 items copied'));
});

test('Ctrl+V duplicates copied nodes with recursively unique ids', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'prompt-a');
  clickRow(h, 'prompt-root', { ctrlKey: true });
  keyOn(h, { key: 'c', ctrlKey: true });
  keyOn(h, { key: 'v', ctrlKey: true });
  await h.nodes['prompt-save'].dispatch('click', { preventDefault });
  const saved = h.getState().view.promptLibrary;
  const ids = new Set();
  const walk = (list) => list.forEach((n) => { ids.add(n.id); if (n.type === 'folder') walk(n.children); });
  walk(saved);
  const count = [...ids].filter((id) => id.startsWith('prompt-') || id.startsWith('folder-')).length;
  assert.ok(count >= 6, 'originals and unique-id clones both present');
  assert.equal(ids.size, count, 'all ids unique across the tree');
});

test('Ctrl+X marks cut roots and Ctrl+V moves them atomically into a selected folder', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'prompt-root');
  keyOn(h, { key: 'x', ctrlKey: true });
  assert.ok(h.rowFor('prompt-root'), 'cut rows remain visible');
  assert.ok(h.rowFor('prompt-root').classList.contains('prompt-cut'));
  clickRow(h, 'folder-dev');
  keyOn(h, { key: 'v', ctrlKey: true });
  assert.ok(h.nodes['prompt-status'].textContent.includes('1 item pasted'));
  await h.nodes['prompt-save'].dispatch('click', { preventDefault });
  const children = h.getState().view.promptLibrary[0].children;
  assert.ok(children.some((n) => n.id === 'prompt-root'), 'cut prompt moved inside folder-dev');
  assert.equal(h.getState().view.promptLibrary.some((n) => n.id === 'prompt-root'), false);
});

test('pasting a folder into its own descendant is rejected', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'folder-dev');
  keyOn(h, { key: 'x', ctrlKey: true });
  const toggle = h.rowFor('folder-inner').querySelector('.prompt-folder-toggle');
  toggle.dispatch('click', { target: toggle, preventDefault, stopPropagation });
  clickRow(h, 'prompt-b');
  keyOn(h, { key: 'v', ctrlKey: true });
  assert.ok(h.nodes['prompt-status'].textContent.includes('cannot be moved inside itself'));
  await h.nodes['prompt-save'].dispatch('click', { preventDefault });
  assert.equal(h.getState().view.promptLibrary[0].id, 'folder-dev', 'folder stayed at root');
});

test('editable controls keep native copy/cut/paste', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  openPrompt(h, 'prompt-root');
  const input = h.rowFor('prompt-root').querySelector('.prompt-card-title');
  input.dispatch('keydown', { target: input, key: 'c', ctrlKey: true, preventDefault, stopPropagation });
  assert.deepEqual(h.copied, [], 'no copy triggered from inside an editable control');
});

test('New prompt respects the exactly-one-selected-folder rule', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'folder-inner');
  h.nodes['prompt-add-prompt'].dispatch('click', { preventDefault });
  await h.nodes['prompt-save'].dispatch('click', { preventDefault });
  const inner = h.getState().view.promptLibrary[0].children[1];
  assert.equal(inner.children[inner.children.length - 1].type, 'prompt', 'added inside the selected folder');

  const h2 = createHarness({ initialView: treeFixture().view });
  open(h2);
  clickRow(h2, 'prompt-a');
  clickRow(h2, 'prompt-root', { ctrlKey: true });
  h2.nodes['prompt-add-prompt'].dispatch('click', { preventDefault });
  await h2.nodes['prompt-save'].dispatch('click', { preventDefault });
  const saved = h2.getState().view.promptLibrary;
  assert.equal(saved[saved.length - 1].type, 'prompt', 'multi-selection adds at root');
});

test('New folder adds at root and enters rename', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  h.nodes['prompt-add-folder'].dispatch('click', { preventDefault });
  const newFolder = h.folderRows().find((row) => row.querySelector('.prompt-folder-rename'));
  assert.ok(newFolder, 'new folder in rename mode');
  assert.equal(newFolder.dataset.parentId, '', 'added at root');
});

test('local status is live feedback and not the global workspace status', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  assert.equal(h.nodes['prompt-status'].getAttribute('role'), 'status');
  assert.equal(h.nodes['prompt-status'].getAttribute('aria-live'), 'polite');
  clickRow(h, 'prompt-root');
  keyOn(h, { key: 'x', ctrlKey: true });
  assert.ok(h.nodes['prompt-status'].textContent.includes('1 item cut'));
  assert.deepEqual(h.statuses, [], 'global setStatus is never used for modal actions');
});

test('expanded prompt row carries the expanded styling class', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  openPrompt(h, 'prompt-root');
  assert.ok(h.rowFor('prompt-root').classList.contains('prompt-row-expanded'));
});

test('destroy removes all listeners', () => {
  const h = createHarness();
  const before = h.nodes['copy-prompt'].listeners.contextmenu?.length ?? 0;
  assert.ok(before > 0);
  h.dialog.destroy();
  assert.equal(h.nodes['copy-prompt'].listeners.contextmenu?.length ?? 0, 0);
  assert.equal(h.nodes['prompt-card-list'].listeners.pointerup?.length ?? 0, 0);
});

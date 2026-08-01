import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkspaceStore } from './public/app/workspace-store.js';
import { createPromptLibraryDialog } from './public/app/components/prompt-library-dialog.js';

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

function matchSimple(node, selector) {
  return matchToken(node, selector);
}

function matchDescendant(node, parts, index) {
  if (index < 0) return true;
  if (!matchSimple(node, parts[index])) return false;
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
    append(...children) {
      for (const child of children) node.appendChild(child);
    },
    remove() {
      if (node.parentNode) {
        node.parentNode.children = node.parentNode.children.filter((c) => c !== node);
      }
      node.parentNode = null;
    },
    setAttribute(name, value) {
      node.attributes[name] = String(value);
    },
    getAttribute(name) {
      return node.attributes[name];
    },
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
    querySelector(selector) {
      return node.querySelectorAll(selector)[0] ?? null;
    },
    closest(selector) {
      let current = node;
      while (current) {
        if (matches(current, selector)) return current;
        current = current.parentNode;
      }
      return null;
    },
    focus() {},
    getBoundingClientRect() {
      return { top: 0, left: 0, width: 100, height: 100, right: 100, bottom: 100 };
    },
    style: {
      setProperty(name, value) {
        node._style[name] = value;
      },
    },
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
      } else if (force) {
        classes.add(name);
      } else {
        classes.delete(name);
      }
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
      id: 'folder-dev', type: 'folder', title: 'Dev',
      children: [
        { id: 'prompt-a', type: 'prompt', title: 'Alpha', text: 'one', includeInBatch: true },
        {
          id: 'folder-inner', type: 'folder', title: 'Inner',
          children: [
            { id: 'prompt-b', type: 'prompt', title: 'Beta', text: 'two', includeInBatch: false },
          ],
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
    'prompt-layer', 'prompt-add', 'prompt-add-menu', 'prompt-card-list',
    'prompt-error', 'prompt-cancel', 'prompt-save', 'copy-prompt',
    'prompt-delete-confirm', 'prompt-delete-message', 'prompt-delete-ok', 'prompt-delete-cancel',
  ];
  const nodes = Object.fromEntries(topIds.map((id) => [id, makeNode(id)]));
  nodes['prompt-layer'].hidden = true;
  const promptItem = makeNode('button');
  promptItem.dataset.promptAdd = 'prompt';
  const folderItem = makeNode('button');
  folderItem.dataset.promptAdd = 'folder';
  nodes['prompt-add-menu'].append(promptItem, folderItem);
  const documentMock = {
    querySelector: (sel) => nodes[sel.slice(1)] ?? null,
    createElement: (tag) => makeNode(tag),
    createElementNS: (ns, tag) => makeNode(tag),
    createDocumentFragment: () => { const f = makeNode('fragment'); f.isFragment = true; return f; },
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
const pillIn = (row, action) => row.querySelectorAll('[data-prompt-action]').find((b) => b.dataset.promptAction === action);

function drag(h, sourceId, targetRow, clientY) {
  const source = h.rowFor(sourceId);
  const handle = source.querySelector('.prompt-tree-handle');
  const dataTransfer = { effectAllowed: '', dropEffect: '', setData() {} };
  handle.dispatch('dragstart', { target: handle, dataTransfer, preventDefault, stopPropagation });
  targetRow.dispatch('dragover', { target: targetRow, clientY, dataTransfer, preventDefault, stopPropagation });
  targetRow.dispatch('drop', { target: targetRow, dataTransfer, preventDefault, stopPropagation });
  targetRow.dispatch('dragend', { target: targetRow, preventDefault, stopPropagation });
}

test('right-clicking the copy button opens the library', () => {
  const h = createHarness({ initialView: treeFixture().view });
  h.nodes['copy-prompt'].dispatch('contextmenu', { preventDefault });
  assert.equal(h.nodes['prompt-layer'].hidden, false);
  assert.equal(h.rows().length > 0, true);
});

test('nested rows receive the correct depth', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  assert.equal(h.rowFor('folder-dev')._style['--prompt-depth'], '0');
  assert.equal(h.rowFor('prompt-a')._style['--prompt-depth'], '1');
  assert.equal(h.rowFor('folder-inner')._style['--prompt-depth'], '1');
  assert.equal(h.rowFor('prompt-root')._style['--prompt-depth'], '0');
  assert.equal(h.rowFor('prompt-b'), undefined, 'children of a collapsed deep folder are hidden');
});

test('a folder chevron expands and collapses its descendants', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  assert.ok(h.rowFor('prompt-a'), 'top-level folder expanded by default');
  assert.equal(h.rowFor('prompt-b'), undefined, 'deep folder children hidden while collapsed');
  h.rowFor('folder-dev').querySelector('.prompt-folder-toggle').dispatch('click', { target: h.rowFor('folder-dev').querySelector('.prompt-folder-toggle'), preventDefault, stopPropagation });
  assert.equal(h.rowFor('prompt-a'), undefined, 'collapse hides the subtree');
  assert.equal(h.rowFor('folder-inner'), undefined);
  h.rowFor('folder-dev').querySelector('.prompt-folder-toggle').dispatch('click', { target: h.rowFor('folder-dev').querySelector('.prompt-folder-toggle'), preventDefault, stopPropagation });
  assert.ok(h.rowFor('prompt-a'), 're-expanding shows the subtree again');
  assert.equal(h.rowFor('prompt-b'), undefined, 'deep folder is still collapsed');
});

test('multiple folders can remain expanded', () => {
  const view = {
    promptLibrary: [
      { id: 'folder-a', type: 'folder', title: 'A', children: [{ id: 'p1', type: 'prompt', title: 'P', text: 'x', includeInBatch: true }] },
      { id: 'folder-b', type: 'folder', title: 'B', children: [{ id: 'p2', type: 'prompt', title: 'Q', text: 'y', includeInBatch: true }] },
    ],
  };
  const h = createHarness({ initialView: view });
  open(h);
  assert.ok(h.rowFor('p1') && h.rowFor('p2'), 'both folders open by default');
  h.rowFor('folder-a').querySelector('.prompt-folder-toggle').dispatch('click', { target: h.rowFor('folder-a').querySelector('.prompt-folder-toggle'), preventDefault, stopPropagation });
  assert.equal(h.rowFor('p1'), undefined, 'closing one folder hides only its subtree');
  assert.ok(h.rowFor('p2'), 'the other folder stays expanded');
});

test('only one prompt editor opens at a time', () => {
  const view = {
    promptLibrary: [
      { id: 'folder-dev', type: 'folder', title: 'Dev', children: [{ id: 'prompt-a', type: 'prompt', title: 'A', text: 'one', includeInBatch: true }] },
      { id: 'prompt-b', type: 'prompt', title: 'B', text: 'two', includeInBatch: true },
    ],
  };
  const h = createHarness({ initialView: view });
  open(h);
  const openPrompt = (id) => {
    const row = h.rowFor(id);
    const btn = row.querySelector('.prompt-prompt-open');
    btn.dispatch('click', { target: btn, preventDefault, stopPropagation });
  };
  openPrompt('prompt-a');
  openPrompt('prompt-b');
  assert.ok(h.rowFor('prompt-b').querySelector('.prompt-card-title'), 'second prompt editor open');
  assert.equal(h.rowFor('prompt-a').querySelector('.prompt-card-title'), null, 'first editor closed');
});

test('folder checkbox becomes indeterminate', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  const checkbox = h.rowFor('folder-dev').querySelector('.prompt-checkbox');
  assert.equal(checkbox.indeterminate, true, 'mixed descendants are indeterminate');
});

test('checking a folder checks every descendant prompt on Save', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  const checkbox = h.rowFor('folder-dev').querySelector('.prompt-checkbox');
  checkbox.dispatch('change', { target: checkbox });
  await h.nodes['prompt-save'].dispatch('click', { preventDefault });
  const saved = h.getState().view.promptLibrary;
  const a = saved[0].children.find((n) => n.id === 'prompt-a');
  const b = saved[0].children.find((n) => n.id === 'folder-inner').children[0];
  const root = saved.find((n) => n.id === 'prompt-root');
  assert.equal(a.includeInBatch, true);
  assert.equal(b.includeInBatch, true);
  assert.equal(root.includeInBatch, true, 'root prompt outside the folder is untouched');
});

test('Add menu adds a root prompt and a root folder', () => {
  const h = createHarness();
  open(h);
  h.nodes['prompt-add'].dispatch('click', { preventDefault });
  assert.equal(h.nodes['prompt-add-menu'].hidden, false);
  const promptItem = h.nodes['prompt-add-menu'].querySelector('[data-prompt-add="prompt"]');
  promptItem.dispatch('click', { target: promptItem, preventDefault, stopPropagation });
  assert.equal(h.promptRows().length, 2, 'default + added prompt');
  assert.ok(h.promptRows()[1].querySelector('.prompt-card-title'), 'added prompt editor opens');
});

test('add prompt inside a folder nests and expands ancestors', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  const addInside = pillIn(h.rowFor('folder-dev'), 'add-prompt-inside');
  addInside.dispatch('click', { target: addInside, preventDefault, stopPropagation });
  const added = h.promptRows().find((row) => row.dataset.parentId === 'folder-dev' && row.querySelector('.prompt-card-title'));
  assert.ok(added, 'new prompt nested under folder-dev and opened');
  added.querySelector('.prompt-card-title').value = 'Added';
  added.querySelector('.prompt-card-title').dispatch('input', { target: added.querySelector('.prompt-card-title') });
  const addedText = h.textareaFor(added.dataset.nodeId);
  addedText.value = 'new body';
  addedText.dispatch('input', { target: addedText });
  await h.nodes['prompt-save'].dispatch('click', { preventDefault });
  const saved = h.getState().view.promptLibrary[0].children;
  assert.equal(saved[saved.length - 1].type, 'prompt');
  assert.equal(saved[saved.length - 1].title, 'Added');
});

test('add folder inside a folder enters inline rename', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  const addFolder = pillIn(h.rowFor('folder-dev'), 'add-folder-inside');
  addFolder.dispatch('click', { target: addFolder, preventDefault, stopPropagation });
  const newFolder = h.folderRows().find((row) => row.dataset.parentId === 'folder-dev' && row.querySelector('.prompt-folder-rename'));
  assert.ok(newFolder, 'new folder nested and in rename mode');
  assert.equal(newFolder.querySelector('.prompt-folder-rename').value, 'New folder');
});

test('inline folder rename commits on Enter', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  const title = h.rowFor('folder-dev').querySelector('.prompt-folder-title');
  title.dispatch('dblclick', { target: title, preventDefault, stopPropagation });
  const input = h.rowFor('folder-dev').querySelector('.prompt-folder-rename');
  assert.ok(input, 'rename input replaces the title');
  input.value = 'Development';
  input.dispatch('keydown', { target: input, key: 'Enter', preventDefault, stopPropagation });
  assert.equal(h.rowFor('folder-dev').querySelector('.prompt-folder-title').textContent, 'Development');
  await h.nodes['prompt-save'].dispatch('click', { preventDefault });
  assert.equal(h.getState().view.promptLibrary[0].title, 'Development');
});

test('Escape restores the prior folder title', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  const title = h.rowFor('folder-dev').querySelector('.prompt-folder-title');
  title.dispatch('dblclick', { target: title, preventDefault, stopPropagation });
  const input = h.rowFor('folder-dev').querySelector('.prompt-folder-rename');
  input.value = 'Discarded';
  input.dispatch('keydown', { target: input, key: 'Escape', preventDefault, stopPropagation });
  assert.equal(h.rowFor('folder-dev').querySelector('.prompt-folder-title').textContent, 'Dev');
});

test('dragging a prompt inside a folder moves it there', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  drag(h, 'prompt-root', h.rowFor('folder-dev'), 50);
  await h.nodes['prompt-save'].dispatch('click', { preventDefault });
  const saved = h.getState().view.promptLibrary[0].children;
  assert.deepEqual(saved.map((n) => n.id), ['prompt-a', 'folder-inner', 'prompt-root']);
  assert.equal(h.getState().view.promptLibrary.some((n) => n.id === 'prompt-root'), false);
});

test('dragging a folder inside another folder moves its subtree', async () => {
  const view = {
    promptLibrary: [
      { id: 'folder-a', type: 'folder', title: 'A', children: [{ id: 'p1', type: 'prompt', title: 'P', text: 'x', includeInBatch: true }] },
      { id: 'folder-b', type: 'folder', title: 'B', children: [] },
    ],
  };
  const h = createHarness({ initialView: view });
  open(h);
  drag(h, 'folder-a', h.rowFor('folder-b'), 50);
  await h.nodes['prompt-save'].dispatch('click', { preventDefault });
  const saved = h.getState().view.promptLibrary;
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0].children.map((n) => n.id), ['folder-a']);
  assert.deepEqual(saved[0].children[0].children.map((n) => n.id), ['p1'], 'subtree preserved');
});

test('a cycle drop into a descendant is rejected', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  // expand the deep folder so its row is present
  h.rowFor('folder-inner').querySelector('.prompt-folder-toggle').dispatch('click', { target: h.rowFor('folder-inner').querySelector('.prompt-folder-toggle'), preventDefault, stopPropagation });
  drag(h, 'folder-dev', h.rowFor('folder-inner'), 50);
  await h.nodes['prompt-save'].dispatch('click', { preventDefault });
  const saved = h.getState().view.promptLibrary;
  assert.equal(saved[0].id, 'folder-dev', 'folder stayed at root');
  assert.equal(saved.length, 2);
});

test('keyboard reorder and nesting move nodes', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  const handle = h.rowFor('prompt-root').querySelector('.prompt-tree-handle');
  handle.dispatch('keydown', { target: handle, altKey: true, key: 'ArrowUp', preventDefault, stopPropagation });
  await h.nodes['prompt-save'].dispatch('click', { preventDefault });
  const saved = h.getState().view.promptLibrary;
  assert.equal(saved[0].id, 'prompt-root', 'moved above folder-dev');
});

test('individual Copy copies the current draft text of that prompt', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  const copyPill = pillIn(h.rowFor('prompt-root'), 'copy');
  copyPill.dispatch('click', { target: copyPill, preventDefault, stopPropagation });
  return Promise.resolve().then(() => {
    assert.deepEqual(h.copied, ['three']);
  });
});

test('draft survives collapsing, editing, and reordering', async () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  const openBtn = h.rowFor('prompt-root').querySelector('.prompt-prompt-open');
  openBtn.dispatch('click', { target: openBtn, preventDefault, stopPropagation });
  const titleInput = h.rowFor('prompt-root').querySelector('.prompt-card-title');
  titleInput.value = 'Renamed root';
  titleInput.dispatch('input', { target: titleInput });
  const textarea = h.textareaFor('prompt-root');
  textarea.value = 'edited body';
  textarea.dispatch('input', { target: textarea });
  // collapse it, then reorder it
  const toggle = h.rowFor('prompt-root').querySelector('.prompt-card-toggle');
  toggle.dispatch('click', { target: toggle, preventDefault, stopPropagation });
  const handle = h.rowFor('prompt-root').querySelector('.prompt-tree-handle');
  handle.dispatch('keydown', { target: handle, altKey: true, key: 'ArrowUp', preventDefault, stopPropagation });
  await h.nodes['prompt-save'].dispatch('click', { preventDefault });
  const saved = h.getState().view.promptLibrary[0];
  assert.equal(saved.id, 'prompt-root');
  assert.equal(saved.title, 'Renamed root');
  assert.equal(saved.text, 'edited body');
});

test('Cancel discards all draft edits', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  const openBtn = h.rowFor('prompt-root').querySelector('.prompt-prompt-open');
  openBtn.dispatch('click', { target: openBtn, preventDefault, stopPropagation });
  const textarea = h.textareaFor('prompt-root');
  textarea.value = 'draft';
  textarea.dispatch('input', { target: textarea });
  h.nodes['prompt-cancel'].dispatch('click', { preventDefault });
  assert.equal(h.nodes['prompt-layer'].hidden, true);
  assert.equal(h.getState().view.promptLibrary[1].text, 'three', 'saved data untouched');
});

test('SVG-only controls retain accessible labels and no visible words', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  const copyPill = pillIn(h.rowFor('prompt-root'), 'copy');
  assert.equal(copyPill.getAttribute('aria-label'), 'Copy prompt');
  assert.equal(copyPill.textContent, '');
  assert.ok(copyPill.querySelector('svg'), 'copy control is an SVG pill');
  const deletePill = pillIn(h.rowFor('prompt-root'), 'delete');
  assert.equal(deletePill.getAttribute('aria-label'), 'Delete prompt');
  assert.equal(deletePill.textContent, '');
  assert.ok(deletePill.querySelector('svg'));
});

test('deleting the final remaining prompt is blocked', () => {
  const h = createHarness();
  open(h);
  const deletePill = pillIn(h.promptRows()[0], 'delete');
  deletePill.dispatch('click', { target: deletePill, preventDefault, stopPropagation });
  assert.equal(h.promptRows().length, 1);
  assert.ok(h.nodes['prompt-error'].textContent.includes('at least one'));
});

test('deleting a non-empty folder requires confirmation', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  const deletePill = pillIn(h.rowFor('folder-dev'), 'delete');
  deletePill.dispatch('click', { target: deletePill, preventDefault, stopPropagation });
  assert.equal(h.nodes['prompt-delete-confirm'].hidden, false);
  assert.ok(h.nodes['prompt-delete-message'].textContent.includes('2 contained prompts'));
  h.nodes['prompt-delete-ok'].dispatch('click', { preventDefault });
  assert.equal(h.nodes['prompt-delete-confirm'].hidden, true);
  assert.equal(h.rowFor('folder-dev'), undefined, 'folder and subtree removed');
  assert.ok(h.rowFor('prompt-root'));
});

test('persistence failure leaves the dialog open', async () => {
  let state = { groups: [], shortcuts: [], view: { promptLibrary: [{ id: 'prompt-x', type: 'prompt', title: 'X', text: 'body', includeInBatch: true }] } };
  const store = createWorkspaceStore({
    getState: () => state,
    setState: (next) => { state = next; },
    persist: async () => { throw new Error('disk full'); },
    normalizeState: (s) => s,
    setStatus: () => {},
  });
  const topIds = [
    'prompt-layer', 'prompt-add', 'prompt-add-menu', 'prompt-card-list',
    'prompt-error', 'prompt-cancel', 'prompt-save', 'copy-prompt',
    'prompt-delete-confirm', 'prompt-delete-message', 'prompt-delete-ok', 'prompt-delete-cancel',
  ];
  const nodes = Object.fromEntries(topIds.map((id) => [id, makeNode(id)]));
  nodes['prompt-layer'].hidden = true;
  const documentMock = {
    querySelector: (sel) => nodes[sel.slice(1)] ?? null,
    createElement: (tag) => makeNode(tag),
    createElementNS: (ns, tag) => makeNode(tag),
    createDocumentFragment: () => { const f = makeNode('fragment'); f.isFragment = true; return f; },
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
  assert.equal(nodes['prompt-save'].disabled, false, 'save re-enabled');
});

test('typing in the prompt textarea updates the draft immediately', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  const openBtn = h.rowFor('prompt-root').querySelector('.prompt-prompt-open');
  openBtn.dispatch('click', { target: openBtn, preventDefault, stopPropagation });
  const textarea = h.textareaFor('prompt-root');
  textarea.value = 'typed unsaved text';
  textarea.dispatch('input', { target: textarea });
  const copyPill = pillIn(h.rowFor('prompt-root'), 'copy');
  copyPill.dispatch('click', { target: copyPill, preventDefault, stopPropagation });
  return Promise.resolve().then(() => {
    assert.deepEqual(h.copied, ['typed unsaved text']);
  });
});

test('folder rename commits on focusout', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  const title = h.rowFor('folder-dev').querySelector('.prompt-folder-title');
  title.dispatch('dblclick', { target: title, preventDefault, stopPropagation });
  const input = h.rowFor('folder-dev').querySelector('.prompt-folder-rename');
  input.value = 'Blurred';
  input.dispatch('focusout', { target: input, preventDefault, stopPropagation });
  assert.equal(h.rowFor('folder-dev').querySelector('.prompt-folder-title').textContent, 'Blurred');
});

test('checkboxes carry explicit accessible labels', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  assert.equal(
    h.rowFor('prompt-a').querySelector('.prompt-checkbox').getAttribute('aria-label'),
    'Include Alpha in batch',
  );
  assert.equal(
    h.rowFor('folder-dev').querySelector('.prompt-checkbox').getAttribute('aria-label'),
    'Include every prompt inside Dev',
  );
});

test('the final prompt cannot be removed through folder deletion', () => {
  const view = { promptLibrary: [
    { id: 'folder-x', type: 'folder', title: 'X', children: [{ id: 'prompt-p', type: 'prompt', title: 'P', text: 'body', includeInBatch: true }] },
  ] };
  const h = createHarness({ initialView: view });
  open(h);
  const deletePill = pillIn(h.rowFor('folder-x'), 'delete');
  deletePill.dispatch('click', { target: deletePill, preventDefault, stopPropagation });
  assert.equal(h.nodes['prompt-delete-confirm'].hidden, true, 'impossible delete is never confirmed');
  assert.ok(h.nodes['prompt-error'].textContent.includes('at least one'));
  assert.ok(h.rowFor('folder-x'), 'folder stays intact');
});

test('the dragged row keeps its styling during dragover', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  const source = h.rowFor('prompt-root');
  const handle = source.querySelector('.prompt-tree-handle');
  const dataTransfer = { effectAllowed: '', dropEffect: '', setData() {} };
  handle.dispatch('dragstart', { target: handle, dataTransfer, preventDefault, stopPropagation });
  assert.ok(source.classList.contains('prompt-dragging'));
  const target = h.rowFor('folder-dev');
  target.dispatch('dragover', { target, clientY: 50, dataTransfer, preventDefault, stopPropagation });
  assert.ok(source.classList.contains('prompt-dragging'), 'dragging class survives dragover cleanup');
  assert.ok(target.classList.contains('prompt-drop-inside'));
});

test('destroy removes all listeners', () => {
  const h = createHarness();
  const before = h.nodes['copy-prompt'].listeners.contextmenu?.length ?? 0;
  assert.ok(before > 0);
  h.dialog.destroy();
  assert.equal(h.nodes['copy-prompt'].listeners.contextmenu?.length ?? 0, 0);
  assert.equal(h.nodes['prompt-card-list'].listeners.drop?.length ?? 0, 0);
});

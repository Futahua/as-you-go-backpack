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
    'prompt-layer', 'prompt-add', 'prompt-add-menu', 'prompt-card-list', 'prompt-tree-menu',
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
  input.dispatch('keydown', { target: input, key: 'Enter', preventDefault, stopPropagation });
  assert.equal(h.rowFor('folder-dev').querySelector('.prompt-folder-title').textContent, 'Development');
  keyOn(h, { key: 'F2' });
  input = h.rowFor('folder-dev').querySelector('.prompt-folder-rename');
  input.value = 'Discarded';
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
  assert.deepEqual(labels, ['Copy', 'Edit', 'Exclude from batch', 'Delete']);
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

test('context menu Copy selected deduplicates descendants and ignores checkboxes', () => {
  const h = createHarness({ initialView: treeFixture().view });
  open(h);
  clickRow(h, 'folder-dev');
  clickRow(h, 'prompt-a', { ctrlKey: true });
  h.rowFor('folder-dev').dispatch('contextmenu', { target: h.rowFor('folder-dev'), clientX: 10, clientY: 10, preventDefault });
  const copyItem = h.nodes['prompt-tree-menu'].querySelectorAll('[role="menuitem"]').find((b) => b.textContent === 'Copy selected');
  copyItem.dispatch('click', { target: copyItem, preventDefault, stopPropagation });
  return Promise.resolve().then(() => {
    assert.deepEqual(h.copied, ['one\n\ntwo'], 'folder descendants copied once, unchecked prompts included');
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
    'prompt-layer', 'prompt-add', 'prompt-add-menu', 'prompt-card-list', 'prompt-tree-menu',
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

test('destroy removes all listeners', () => {
  const h = createHarness();
  const before = h.nodes['copy-prompt'].listeners.contextmenu?.length ?? 0;
  assert.ok(before > 0);
  h.dialog.destroy();
  assert.equal(h.nodes['copy-prompt'].listeners.contextmenu?.length ?? 0, 0);
  assert.equal(h.nodes['prompt-card-list'].listeners.pointerup?.length ?? 0, 0);
});

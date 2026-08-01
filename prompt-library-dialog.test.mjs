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
    if (value !== undefined) return node.dataset[attr] === value || node.attributes[attr] === value;
    return attr in node.dataset || node.attributes[attr] !== undefined;
  }
  return node.tagName === selector.toUpperCase();
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
  const parts = selector.trim().split(/\s+/);
  return matchDescendant(node, parts, parts.length - 1);
}

function makeNode(tag) {
  const node = {
    tagName: String(tag).toUpperCase(),
    children: [],
    parentNode: null,
    attributes: {},
    listeners: {},
    dataset: {},
    value: '',
    checked: false,
    disabled: false,
    hidden: false,
    draggable: false,
    rows: 0,
    maxLength: 0,
    type: '',
    title: '',
    appendChild(child) {
      if (typeof child !== 'string') {
        node.children.push(child);
        child.parentNode = node;
      }
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

function createHarness({ storedCards = null, legacyPrompt = null } = {}) {
  let state = {
    groups: [],
    shortcuts: [],
    view: { promptCards: storedCards ?? [], pickupPrompt: legacyPrompt },
  };
  const store = createWorkspaceStore({
    getState: () => state,
    setState: (next) => { state = next; },
    persist: async () => {},
    normalizeState: (s) => s,
    setStatus: () => {},
  });
  const topIds = [
    'prompt-layer', 'prompt-add', 'prompt-card-list',
    'prompt-error', 'prompt-cancel', 'prompt-save', 'copy-prompt',
  ];
  const nodes = Object.fromEntries(topIds.map((id) => [id, makeNode(id)]));
  nodes['prompt-layer'].hidden = true;
  const documentMock = { querySelector: (sel) => nodes[sel.slice(1)] ?? null, createElement: (tag) => makeNode(tag) };
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
    cards: () => nodes['prompt-card-list'].querySelectorAll('.prompt-card'),
    cardTitle: (article) => article.querySelector('.prompt-card-title'),
    cardText: (article) => article.querySelector('.prompt-card-text'),
    cardCheckbox: (article) => article.querySelector('.prompt-batch-toggle input'),
    cardHandle: (article) => article.querySelector('.prompt-card-handle'),
  };
}

const preventDefault = () => {};
const stopPropagation = () => {};
const open = (h, options) => h.dialog.open(options);
const summaryOf = (h, i) => h.cards()[i].querySelector('.prompt-card-summary');
const detailsOf = (h, i) => h.cards()[i].querySelector('.prompt-card-details');
const summaryTitleOf = (h, i) => h.cards()[i].querySelector('.prompt-card-summary-title');
const toggleExpand = (h, i) => summaryOf(h, i).dispatch('click', { target: summaryOf(h, i), preventDefault, stopPropagation });
const setTitle = (h, i, value) => {
  const input = h.cardTitle(h.cards()[i]);
  input.value = value;
  input.dispatch('input', { target: input });
};
const setText = (h, i, value) => {
  const input = h.cardText(h.cards()[i]);
  input.value = value;
  input.dispatch('input', { target: input });
};

test('right-clicking the copy button opens the card library collapsed', () => {
  const h = createHarness();
  assert.equal(h.nodes['prompt-layer'].hidden, true);
  h.nodes['copy-prompt'].dispatch('contextmenu', { preventDefault });
  assert.equal(h.nodes['prompt-layer'].hidden, false);
  assert.equal(h.cards().length, 1);
  assert.equal(detailsOf(h, 0).hidden, true, 'default card starts collapsed');
  assert.equal(summaryTitleOf(h, 0).textContent, 'Agent pickup prompt');
  assert.equal(h.cardCheckbox(h.cards()[0]).checked, true);
});

test('opening with several saved cards shows every card collapsed', () => {
  const h = createHarness({
    storedCards: [
      { id: 'prompt-a', title: 'One', text: 'first', includeInBatch: true },
      { id: 'prompt-b', title: 'Two', text: 'second', includeInBatch: false },
    ],
  });
  open(h);
  assert.equal(h.cards().length, 2);
  assert.ok(h.cards().every((article) => detailsOf(h, 0).hidden && detailsOf(h, 1).hidden));
});

test('clicking a summary expands that card and clicking again collapses it', () => {
  const h = createHarness();
  open(h);
  toggleExpand(h, 0);
  assert.equal(detailsOf(h, 0).hidden, false);
  assert.ok(h.cards()[0].classList.contains('prompt-card-expanded'));
  assert.equal(summaryOf(h, 0).getAttribute('aria-expanded'), 'true');
  toggleExpand(h, 0);
  assert.equal(detailsOf(h, 0).hidden, true);
  assert.equal(summaryOf(h, 0).getAttribute('aria-expanded'), 'false');
});

test('expanding one card closes the other', () => {
  const h = createHarness({
    storedCards: [
      { id: 'prompt-a', title: 'One', text: 'first', includeInBatch: true },
      { id: 'prompt-b', title: 'Two', text: 'second', includeInBatch: false },
    ],
  });
  open(h);
  toggleExpand(h, 0);
  toggleExpand(h, 1);
  assert.equal(detailsOf(h, 0).hidden, true, 'first card closed');
  assert.equal(detailsOf(h, 1).hidden, false, 'second card open');
});

test('checkbox, Copy, Delete, and drag handle do not toggle expansion', () => {
  const h = createHarness({
    storedCards: [
      { id: 'prompt-a', title: 'One', text: 'first', includeInBatch: true },
      { id: 'prompt-b', title: 'Two', text: 'second', includeInBatch: false },
    ],
  });
  open(h);
  toggleExpand(h, 0);
  const article = h.cards()[0];
  h.cardCheckbox(article).dispatch('click', { target: h.cardCheckbox(article), preventDefault, stopPropagation });
  assert.equal(detailsOf(h, 0).hidden, false, 'checkbox keeps the card expanded');
  const copyButton = article.querySelector('[data-prompt-action="copy"]');
  copyButton.dispatch('click', { target: copyButton, preventDefault, stopPropagation });
  assert.equal(detailsOf(h, 0).hidden, false, 'Copy keeps the card expanded');
  h.cardHandle(article).dispatch('click', { target: h.cardHandle(article), preventDefault, stopPropagation });
  assert.equal(detailsOf(h, 0).hidden, false, 'drag handle keeps the card expanded');
  const deleteButton = h.cards()[1].querySelector('[data-prompt-action="delete"]');
  deleteButton.dispatch('click', { target: deleteButton, preventDefault, stopPropagation });
  assert.equal(detailsOf(h, 0).hidden, false, 'deleting another card keeps this one expanded');
  assert.equal(h.cards().length, 1);
});

test('Add creates an unchecked card and expands it immediately', () => {
  const h = createHarness();
  open(h);
  h.nodes['prompt-add'].dispatch('click', { preventDefault });
  assert.equal(h.cards().length, 2);
  assert.equal(detailsOf(h, 0).hidden, true, 'previous card collapsed');
  assert.equal(detailsOf(h, 1).hidden, false, 'new card expanded');
  assert.equal(h.cardTitle(h.cards()[1]).value, 'New prompt');
  assert.equal(h.cardText(h.cards()[1]).value, '');
  assert.equal(h.cardCheckbox(h.cards()[1]).checked, false);
});

test('editing the title updates the draft and the collapsed summary title', () => {
  const h = createHarness();
  open(h);
  toggleExpand(h, 0);
  setTitle(h, 0, 'Renamed');
  assert.equal(summaryTitleOf(h, 0).textContent, 'Renamed');
  assert.equal(h.dialog.getSnapshotCards()[0].title, 'Agent pickup prompt', 'saved snapshot untouched');
});

test('checkbox state saves', async () => {
  const h = createHarness();
  open(h);
  toggleExpand(h, 0);
  setText(h, 0, 'Checked body');
  h.cardCheckbox(h.cards()[0]).checked = true;
  h.cardCheckbox(h.cards()[0]).dispatch('change', { target: h.cardCheckbox(h.cards()[0]) });
  await h.nodes['prompt-save'].dispatch('click', { preventDefault });
  assert.deepEqual(h.getState().view.promptCards[0], {
    id: h.getState().view.promptCards[0].id,
    title: 'Agent pickup prompt',
    text: 'Checked body',
    includeInBatch: true,
  });
});

test('drag drop changes the saved array order', async () => {
  const h = createHarness();
  open(h);
  h.nodes['prompt-add'].dispatch('click', { preventDefault });
  setTitle(h, 0, 'First');
  setText(h, 0, 'one');
  setTitle(h, 1, 'Second');
  setText(h, 1, 'two');

  const second = h.cards()[1];
  const handle = h.cardHandle(second);
  const dataTransfer = { effectAllowed: '', dropEffect: '', setData() {} };
  handle.dispatch('dragstart', { target: handle, dataTransfer, preventDefault, stopPropagation });
  const first = h.cards()[0];
  first.dispatch('dragover', { target: first, clientY: 10, dataTransfer, preventDefault, stopPropagation });
  first.dispatch('drop', { target: first, dataTransfer, preventDefault, stopPropagation });
  first.dispatch('dragend', { target: first, preventDefault, stopPropagation });

  await h.nodes['prompt-save'].dispatch('click', { preventDefault });
  assert.deepEqual(
    h.getState().view.promptCards.map((c) => c.title),
    ['Second', 'First'],
    'the second card moved before the first',
  );
});

test('keyboard reorder works via Alt+ArrowUp', async () => {
  const h = createHarness();
  open(h);
  h.nodes['prompt-add'].dispatch('click', { preventDefault });
  setTitle(h, 1, 'Moved');
  setText(h, 1, 'moved body');
  h.cardHandle(h.cards()[1]).dispatch('keydown', {
    target: h.cardHandle(h.cards()[1]),
    altKey: true,
    key: 'ArrowUp',
    preventDefault,
    stopPropagation,
  });
  await h.nodes['prompt-save'].dispatch('click', { preventDefault });
  const titles = h.getState().view.promptCards.map((c) => c.title);
  assert.equal(titles[0], 'Moved', 'second card moved above the default card');
});

test('expanded state follows the card ID after reorder', () => {
  const h = createHarness();
  open(h);
  h.nodes['prompt-add'].dispatch('click', { preventDefault });
  h.cardHandle(h.cards()[1]).dispatch('keydown', {
    target: h.cardHandle(h.cards()[1]),
    altKey: true,
    key: 'ArrowUp',
    preventDefault,
    stopPropagation,
  });
  assert.ok(h.cards()[0].classList.contains('prompt-card-expanded'), 'the moved card stays expanded');
  assert.equal(h.cards()[1].classList.contains('prompt-card-expanded'), false);
});

test('individual Copy works while collapsed and copies the current draft text', () => {
  const h = createHarness();
  open(h);
  toggleExpand(h, 0);
  setText(h, 0, 'draft body');
  toggleExpand(h, 0);
  const copyButton = h.cards()[0].querySelector('[data-prompt-action="copy"]');
  copyButton.dispatch('click', { target: copyButton, preventDefault, stopPropagation });
  return Promise.resolve().then(() => {
    assert.deepEqual(h.copied, ['draft body']);
  });
});

test('edits survive collapsing, expanding another card, and reordering', async () => {
  const h = createHarness();
  open(h);
  toggleExpand(h, 0);
  setTitle(h, 0, 'Renamed');
  setText(h, 0, 'edited body');
  h.nodes['prompt-add'].dispatch('click', { preventDefault });
  setTitle(h, 1, 'Second');
  setText(h, 1, 'second body');
  h.cardHandle(h.cards()[1]).dispatch('keydown', {
    target: h.cardHandle(h.cards()[1]),
    altKey: true,
    key: 'ArrowUp',
    preventDefault,
    stopPropagation,
  });
  await h.nodes['prompt-save'].dispatch('click', { preventDefault });
  assert.deepEqual(
    h.getState().view.promptCards.map((c) => [c.title, c.text]),
    [['Second', 'second body'], ['Renamed', 'edited body']],
  );
});

test('Cancel discards every draft change', async () => {
  const h = createHarness();
  open(h);
  toggleExpand(h, 0);
  setText(h, 0, 'Draft body');
  h.nodes['prompt-add'].dispatch('click', { preventDefault });
  h.nodes['prompt-cancel'].dispatch('click', { preventDefault });
  assert.equal(h.nodes['prompt-layer'].hidden, true);
  assert.equal(h.getState().view.promptCards.length, 0, 'nothing was persisted');
  assert.equal(h.dialog.getBatchText(), 'FALLBACK PROMPT', 'snapshot unchanged');
});

test('Save persists all cards once', async () => {
  const h = createHarness();
  open(h);
  toggleExpand(h, 0);
  setTitle(h, 0, 'One');
  setText(h, 0, 'one');
  h.nodes['prompt-add'].dispatch('click', { preventDefault });
  setTitle(h, 1, 'Two');
  setText(h, 1, 'two');
  await h.nodes['prompt-save'].dispatch('click', { preventDefault });
  assert.equal(h.nodes['prompt-layer'].hidden, true);
  assert.deepEqual(
    h.getState().view.promptCards.map((c) => [c.title, c.text]),
    [['One', 'one'], ['Two', 'two']],
  );
});

test('persistence failure leaves the dialog open', async () => {
  let state = { groups: [], shortcuts: [], view: { promptCards: [] } };
  const store = createWorkspaceStore({
    getState: () => state,
    setState: (next) => { state = next; },
    persist: async () => { throw new Error('disk full'); },
    normalizeState: (s) => s,
    setStatus: () => {},
  });
  const topIds = [
    'prompt-layer', 'prompt-add', 'prompt-card-list',
    'prompt-error', 'prompt-cancel', 'prompt-save', 'copy-prompt',
  ];
  const nodes = Object.fromEntries(topIds.map((id) => [id, makeNode(id)]));
  nodes['prompt-layer'].hidden = true;
  const documentMock = { querySelector: (sel) => nodes[sel.slice(1)] ?? null, createElement: (tag) => makeNode(tag) };
  const dialog = createPromptLibraryDialog({
    document: documentMock,
    store,
    fallbackPrompt: 'FALLBACK',
    copyText: () => Promise.resolve(),
    setStatus: () => {},
  });
  dialog.mount();
  dialog.open();
  const article = nodes['prompt-card-list'].querySelector('.prompt-card');
  article.querySelector('.prompt-card-summary').dispatch('click', { target: article.querySelector('.prompt-card-summary'), preventDefault, stopPropagation });
  article.querySelector('.prompt-card-text').value = 'body';
  await nodes['prompt-save'].dispatch('click', { preventDefault });
  assert.equal(nodes['prompt-layer'].hidden, false, 'dialog stays open');
  assert.ok(nodes['prompt-error'].textContent.includes('disk full'));
  assert.equal(nodes['prompt-save'].disabled, false, 'save re-enabled');
});

test('deleting the last card is blocked', () => {
  const h = createHarness();
  open(h);
  const deleteButton = h.cards()[0].querySelector('[data-prompt-action="delete"]');
  deleteButton.dispatch('click', { target: deleteButton, preventDefault, stopPropagation });
  assert.equal(h.cards().length, 1, 'final card cannot be deleted');
  assert.ok(h.nodes['prompt-error'].textContent.includes('at least one'));
});

test('destroy removes all listeners', () => {
  const h = createHarness();
  const before = h.nodes['copy-prompt'].listeners.contextmenu?.length ?? 0;
  assert.ok(before > 0);
  h.dialog.destroy();
  assert.equal(h.nodes['copy-prompt'].listeners.contextmenu?.length ?? 0, 0);
  assert.equal(h.nodes['prompt-card-list'].listeners.drop?.length ?? 0, 0);
});

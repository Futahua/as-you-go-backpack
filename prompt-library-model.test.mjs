import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizePromptLibrary,
  createPromptNode,
  createPromptFolder,
  effectivePromptLibrary,
  findPromptNode,
  updatePromptNode,
  removePromptNode,
  movePromptNode,
  descendantPromptIds,
  countPromptNodes,
  folderBatchState,
  setFolderBatchIncluded,
  buildBatchPromptText,
  validatePromptLibrary,
  resolveCopierAction,
} from './public/prompt-library-model.js';

const prompt = (id, title, text, includeInBatch) => ({
  id, type: 'prompt', title, text, includeInBatch,
});

test('flat legacy promptCards migrate to root prompt nodes', () => {
  const library = normalizePromptLibrary(undefined, [
    { id: 'prompt-a', title: 'One', text: 'first', includeInBatch: true },
    { id: 'prompt-b', title: 'Two', text: 'second', includeInBatch: false },
  ], undefined);
  assert.deepEqual(library, [
    prompt('prompt-a', 'One', 'first', true),
    prompt('prompt-b', 'Two', 'second', false),
  ]);
});

test('a legacy pickupPrompt migrates to one root prompt node', () => {
  const library = normalizePromptLibrary(undefined, undefined, 'legacy prompt');
  assert.equal(library.length, 1);
  assert.equal(library[0].type, 'prompt');
  assert.equal(library[0].text, 'legacy prompt');
  assert.equal(library[0].includeInBatch, true);
});

test('nested normalization keeps folders, prompts, and order, dropping bad records', () => {
  const library = normalizePromptLibrary([
    {
      id: 'folder-dev',
      type: 'folder',
      title: 'Dev',
      children: [
        prompt('prompt-a', 'A', 'one', true),
        { id: 'prompt-b', type: 'prompt', title: 'B', text: 'two', includeInBatch: false },
        { id: '', type: 'prompt', title: 'no id' },
      ],
    },
    { id: 'prompt-root', type: 'prompt', title: 'Root', text: 'r', includeInBatch: true },
    'junk',
  ], undefined, undefined);
  assert.equal(library.length, 2);
  assert.equal(library[0].children.length, 2);
  assert.equal(library[1].type, 'prompt');
});

test('duplicate ids keep the first occurrence', () => {
  const library = normalizePromptLibrary([
    prompt('a', 'A', 'one', true),
    prompt('a', 'B', 'two', false),
  ], undefined, undefined);
  assert.equal(library.length, 1);
  assert.equal(library[0].title, 'A');
});

test('batch text is depth-first and ignores folder titles', () => {
  const library = [
    {
      id: 'folder-dev', type: 'folder', title: 'Dev',
      children: [
        prompt('p1', 'One', 'first', true),
        {
          id: 'folder-inner', type: 'folder', title: 'Inner',
          children: [prompt('p2', 'Two', 'second', true)],
        },
      ],
    },
    prompt('p3', 'Three', 'third', true),
  ];
  assert.equal(buildBatchPromptText(library), 'first\n\nsecond\n\nthird');
});

test('collapsed folders have no effect on copying (batch traverses the tree)', () => {
  const library = [
    {
      id: 'folder-dev', type: 'folder', title: 'Dev',
      children: [prompt('p1', 'One', 'inside', true)],
    },
  ];
  assert.equal(buildBatchPromptText(library), 'inside');
});

test('folder tri-state is derived from descendants', () => {
  const library = [
    {
      id: 'folder-dev', type: 'folder', title: 'Dev',
      children: [
        prompt('p1', 'A', 'one', true),
        prompt('p2', 'B', 'two', true),
        prompt('p3', 'C', 'three', false),
      ],
    },
  ];
  assert.equal(folderBatchState(library, 'folder-dev'), 'indeterminate');
  const allChecked = normalizePromptLibrary([
    {
      id: 'folder-dev', type: 'folder', title: 'Dev',
      children: [prompt('p1', 'A', 'one', true), prompt('p2', 'B', 'two', true)],
    },
  ], undefined, undefined);
  assert.equal(folderBatchState(allChecked, 'folder-dev'), 'checked');
  const noneChecked = normalizePromptLibrary([
    {
      id: 'folder-dev', type: 'folder', title: 'Dev',
      children: [prompt('p1', 'A', 'one', false), prompt('p2', 'B', 'two', false)],
    },
  ], undefined, undefined);
  assert.equal(folderBatchState(noneChecked, 'folder-dev'), 'unchecked');
  assert.equal(folderBatchState(library, 'missing'), 'unchecked');
});

test('checking and unchecking a folder updates every descendant prompt', () => {
  const library = [
    {
      id: 'folder-dev', type: 'folder', title: 'Dev',
      children: [
        prompt('p1', 'A', 'one', false),
        {
          id: 'folder-inner', type: 'folder', title: 'Inner',
          children: [prompt('p2', 'B', 'two', false)],
        },
      ],
    },
    prompt('p3', 'C', 'three', false),
  ];
  const checked = setFolderBatchIncluded(library, 'folder-dev', true);
  assert.equal(findPromptNode(checked, 'p1').includeInBatch, true);
  assert.equal(findPromptNode(checked, 'p2').includeInBatch, true);
  assert.equal(findPromptNode(checked, 'p3').includeInBatch, false, 'outside the folder is untouched');
  const unchecked = setFolderBatchIncluded(checked, 'folder-dev', false);
  assert.equal(findPromptNode(unchecked, 'p1').includeInBatch, false);
  assert.equal(findPromptNode(unchecked, 'p2').includeInBatch, false);
});

test('moving before, after, and inside a folder', () => {
  const library = [
    prompt('a', 'A', 'one', true),
    prompt('b', 'B', 'two', true),
    prompt('c', 'C', 'three', true),
    { id: 'folder-x', type: 'folder', title: 'X', children: [] },
  ];
  const before = movePromptNode(library, { nodeId: 'c', destinationParentId: null, beforeId: 'a' });
  assert.deepEqual(before.map((n) => n.id), ['c', 'a', 'b', 'folder-x']);
  const after = movePromptNode(library, { nodeId: 'a', destinationParentId: null, beforeId: 'c' });
  assert.deepEqual(after.map((n) => n.id), ['b', 'a', 'c', 'folder-x']);
  const inside = movePromptNode(library, { nodeId: 'a', destinationParentId: 'folder-x', beforeId: null });
  assert.deepEqual(inside.map((n) => n.id), ['b', 'c', 'folder-x']);
  assert.deepEqual(findPromptNode(inside, 'folder-x').children.map((n) => n.id), ['a']);
});

test('moving a nested node back to root', () => {
  const library = [
    {
      id: 'folder-dev', type: 'folder', title: 'Dev',
      children: [prompt('p1', 'A', 'one', true), prompt('p2', 'B', 'two', true)],
    },
  ];
  const moved = movePromptNode(library, { nodeId: 'p2', destinationParentId: null, beforeId: null });
  assert.deepEqual(moved.map((n) => n.id), ['folder-dev', 'p2']);
  assert.deepEqual(findPromptNode(moved, 'folder-dev').children.map((n) => n.id), ['p1']);
});

test('folder-to-descendant cycles are rejected', () => {
  const library = [
    {
      id: 'folder-a', type: 'folder', title: 'A',
      children: [
        { id: 'folder-b', type: 'folder', title: 'B', children: [prompt('p1', 'One', 'one', true)] },
      ],
    },
  ];
  const result = movePromptNode(library, { nodeId: 'folder-a', destinationParentId: 'folder-b', beforeId: null });
  assert.equal(result, library, 'cycle rejected without mutation');
  const intoSelf = movePromptNode(library, { nodeId: 'folder-a', destinationParentId: 'folder-a', beforeId: null });
  assert.equal(intoSelf, library);
});

test('movePromptNode rejects unknown ids, non-folder destinations, bad beforeId', () => {
  const library = [prompt('a', 'A', 'one', true), { id: 'folder-x', type: 'folder', title: 'X', children: [] }];
  assert.equal(movePromptNode(library, { nodeId: 'zz', destinationParentId: null, beforeId: null }), library);
  assert.equal(movePromptNode(library, { nodeId: 'a', destinationParentId: 'a', beforeId: null }), library);
  assert.equal(movePromptNode(library, { nodeId: 'a', destinationParentId: 'zz', beforeId: null }), library);
  assert.equal(movePromptNode(library, { nodeId: 'a', destinationParentId: null, beforeId: 'zz' }), library);
});

test('movePromptNode and update are non-mutating', () => {
  const library = [prompt('a', 'A', 'one', true), { id: 'folder-x', type: 'folder', title: 'X', children: [] }];
  movePromptNode(library, { nodeId: 'a', destinationParentId: 'folder-x', beforeId: null });
  updatePromptNode(library, 'a', (node) => ({ ...node, title: 'changed' }));
  removePromptNode(library, 'folder-x');
  assert.deepEqual(library.map((n) => n.id), ['a', 'folder-x']);
  assert.equal(findPromptNode(library, 'a').title, 'A');
});

test('subtree deletion removes the folder and its descendants', () => {
  const library = [
    {
      id: 'folder-a', type: 'folder', title: 'A',
      children: [
        prompt('p1', 'One', 'one', true),
        { id: 'folder-b', type: 'folder', title: 'B', children: [prompt('p2', 'Two', 'two', true)] },
      ],
    },
    prompt('p3', 'Three', 'three', true),
  ];
  const removed = removePromptNode(library, 'folder-a');
  assert.deepEqual(removed.map((n) => n.id), ['p3']);
  assert.equal(countPromptNodes(removed), 1);
  assert.equal(descendantPromptIds(library, 'folder-a').length, 2);
});

test('descendantPromptIds is depth-first', () => {
  const library = [
    {
      id: 'folder-a', type: 'folder', title: 'A',
      children: [
        prompt('p1', 'One', 'one', true),
        { id: 'folder-b', type: 'folder', title: 'B', children: [prompt('p2', 'Two', 'two', true)] },
      ],
    },
  ];
  assert.deepEqual(descendantPromptIds(library, 'folder-a'), ['p1', 'p2']);
});

test('validation covers prompts, titles, text, ids, types, and folders', () => {
  assert.ok(validatePromptLibrary([]), 'at least one prompt required');
  assert.ok(validatePromptLibrary([prompt('a', ' ', 'one', true)]), 'prompt title required');
  assert.ok(validatePromptLibrary([prompt('a', 'A', '  ', true)]), 'prompt text required');
  assert.ok(validatePromptLibrary([
    prompt('a', 'A', 'one', true),
    prompt('a', 'B', 'two', true),
  ]), 'ids must be unique');
  assert.ok(validatePromptLibrary([{ id: 'x', type: 'bogus' }]), 'unknown types rejected');
  assert.ok(validatePromptLibrary([
    { id: 'folder-a', type: 'folder', title: '  ', children: [] },
  ]), 'folder title required');
  assert.ok(validatePromptLibrary([
    { id: 'folder-a', type: 'folder', title: 'A', children: [prompt('p', 'P', 't', true)] },
  ]) === null, 'a valid tree passes');
});

test('effectivePromptLibrary resolves to a virtual fallback prompt when empty', () => {
  const library = effectivePromptLibrary({ promptLibrary: [] }, 'FALLBACK');
  assert.equal(library.length, 1);
  assert.equal(library[0].type, 'prompt');
  assert.equal(library[0].text, 'FALLBACK');
  assert.equal(library[0].includeInBatch, true);
});

test('created prompt and folder nodes have unique ids and correct types', () => {
  const ids = new Set();
  for (let i = 0; i < 40; i += 1) {
    ids.add(createPromptNode().id);
    ids.add(createPromptFolder().id);
  }
  assert.equal(ids.size, 80);
  assert.ok(createPromptNode().type === 'prompt');
  assert.ok(createPromptFolder().type === 'folder');
  assert.deepEqual(createPromptFolder().children, []);
  assert.equal(createPromptNode().includeInBatch, false);
});

test('resolveCopierAction keeps selected-target precedence', () => {
  const library = [prompt('a', 'A', 'prompt body', true)];
  assert.deepEqual(resolveCopierAction(['C:\\target'], library), { kind: 'copy', text: 'C:\\target' });
  assert.deepEqual(resolveCopierAction(['a', 'b'], library), { kind: 'copy', text: 'a\nb' });
  assert.deepEqual(resolveCopierAction([], library), { kind: 'copy', text: 'prompt body' });
});

test('resolveCopierAction opens the library when nothing is checked', () => {
  const library = [prompt('a', 'A', 'body', false)];
  assert.deepEqual(resolveCopierAction([], library), { kind: 'open' });
});

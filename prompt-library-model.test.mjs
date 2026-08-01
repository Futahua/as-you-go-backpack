import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizePromptCards,
  createPromptCard,
  effectivePromptCards,
  reorderPromptCards,
  buildBatchPromptText,
  validatePromptCards,
  resolveCopierAction,
} from './public/prompt-library-model.js';

test('a legacy pickupPrompt migrates to one checked card', () => {
  const cards = normalizePromptCards(undefined, 'legacy prompt body');
  assert.equal(cards.length, 1);
  assert.equal(cards[0].text, 'legacy prompt body');
  assert.equal(cards[0].includeInBatch, true);
  assert.equal(cards[0].title, 'Agent pickup prompt');
});

test('an empty or missing legacy prompt resolves to an empty list', () => {
  assert.deepEqual(normalizePromptCards(undefined, undefined), []);
  assert.deepEqual(normalizePromptCards(undefined, null), []);
  assert.deepEqual(normalizePromptCards(undefined, '   '), []);
});

test('malformed card records are dropped', () => {
  const cards = normalizePromptCards([
    { id: 'a', title: 'A', text: 'one', includeInBatch: true },
    { id: '', title: 'no id', text: 'x', includeInBatch: true },
    null,
    { id: 'b', title: 42, text: 'two', includeInBatch: 'yes' },
    'junk',
  ], undefined);
  assert.deepEqual(cards, [
    { id: 'a', title: 'A', text: 'one', includeInBatch: true },
    { id: 'b', title: 'New prompt', text: 'two', includeInBatch: false },
  ]);
});

test('duplicate ids keep the first occurrence', () => {
  const cards = normalizePromptCards([
    { id: 'a', title: 'A', text: 'one', includeInBatch: true },
    { id: 'a', title: 'dup', text: 'two', includeInBatch: false },
  ], undefined);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].title, 'A');
});

test('normalization preserves array order', () => {
  const cards = normalizePromptCards([
    { id: 'c', title: 'C', text: 'three', includeInBatch: true },
    { id: 'a', title: 'A', text: 'one', includeInBatch: true },
    { id: 'b', title: 'B', text: 'two', includeInBatch: true },
  ], undefined);
  assert.deepEqual(cards.map((c) => c.id), ['c', 'a', 'b']);
});

test('batch text includes only checked cards in order', () => {
  const cards = [
    { id: 'a', title: 'A', text: 'one', includeInBatch: true },
    { id: 'b', title: 'B', text: 'two', includeInBatch: false },
    { id: 'c', title: 'C', text: 'three', includeInBatch: true },
  ];
  assert.equal(buildBatchPromptText(cards), 'one\n\nthree');
});

test('unchecked and blank cards are omitted from batch text', () => {
  const cards = [
    { id: 'a', title: 'A', text: 'one', includeInBatch: true },
    { id: 'b', title: 'B', text: '   ', includeInBatch: true },
    { id: 'c', title: 'C', text: 'three', includeInBatch: false },
  ];
  assert.equal(buildBatchPromptText(cards), 'one');
  assert.equal(buildBatchPromptText([]), '');
});

test('batch text joins with exactly two newlines', () => {
  const cards = [
    { id: 'a', title: 'A', text: 'first line', includeInBatch: true },
    { id: 'b', title: 'B', text: 'second line', includeInBatch: true },
  ];
  assert.equal(buildBatchPromptText(cards), 'first line\n\nsecond line');
});

test('reorder places a card before and after another card', () => {
  const cards = [
    { id: 'a', title: 'A' },
    { id: 'b', title: 'B' },
    { id: 'c', title: 'C' },
  ];
  assert.deepEqual(
    reorderPromptCards(cards, 'c', 'a').map((c) => c.id),
    ['c', 'a', 'b'],
  );
  assert.deepEqual(
    reorderPromptCards(cards, 'a', 'c').map((c) => c.id),
    ['b', 'a', 'c'],
  );
  assert.deepEqual(
    reorderPromptCards(cards, 'b', null).map((c) => c.id),
    ['a', 'c', 'b'],
  );
});

test('reorder is non-mutating and ignores unknown ids', () => {
  const cards = [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }];
  const next = reorderPromptCards(cards, 'a', null);
  assert.notEqual(next, cards);
  assert.deepEqual(next.map((c) => c.id), ['b', 'a']);
  assert.deepEqual(reorderPromptCards(cards, 'zz', 'a').map((c) => c.id), ['a', 'b']);
  assert.deepEqual(reorderPromptCards(cards, 'a', 'zz').map((c) => c.id), ['a', 'b']);
});

test('created cards get unique ids', () => {
  const ids = new Set();
  for (let i = 0; i < 40; i += 1) ids.add(createPromptCard().id);
  assert.equal(ids.size, 40);
  assert.ok([...ids].every((id) => id.startsWith('prompt-')));
});

test('a missing card list resolves to a virtual fallback card', () => {
  const view = { promptCards: [] };
  const cards = effectivePromptCards(view, 'FALLBACK');
  assert.equal(cards.length, 1);
  assert.equal(cards[0].text, 'FALLBACK');
  assert.equal(cards[0].includeInBatch, true);
  assert.equal(cards[0].title, 'Agent pickup prompt');
});

test('persisted cards take precedence over the fallback', () => {
  const cards = effectivePromptCards(
    { promptCards: [{ id: 'x', title: 'X', text: 'saved', includeInBatch: true }] },
    'FALLBACK',
  );
  assert.equal(cards.length, 1);
  assert.equal(cards[0].text, 'saved');
});

test('validation rejects empty lists, blank titles, blank text, duplicate ids', () => {
  assert.ok(validatePromptCards([]));
  assert.ok(validatePromptCards([{ id: 'a', title: '  ', text: 'x' }]));
  assert.ok(validatePromptCards([{ id: 'a', title: 'A', text: '  ' }]));
  assert.ok(validatePromptCards([
    { id: 'a', title: 'A', text: 'x' },
    { id: 'a', title: 'B', text: 'y' },
  ]));
  assert.equal(
    validatePromptCards([{ id: 'a', title: 'A', text: 'x' }]),
    null,
  );
});

test('resolveCopierAction keeps selected-target precedence', () => {
  const cards = [{ id: 'a', title: 'A', text: 'prompt body', includeInBatch: true }];
  assert.deepEqual(resolveCopierAction(['C:\\target'], cards), {
    kind: 'copy',
    text: 'C:\\target',
  });
  assert.deepEqual(resolveCopierAction(['a', 'b'], cards), {
    kind: 'copy',
    text: 'a\nb',
  });
  assert.deepEqual(resolveCopierAction([], cards), {
    kind: 'copy',
    text: 'prompt body',
  });
});

test('resolveCopierAction opens the library when nothing is checked', () => {
  const cards = [
    { id: 'a', title: 'A', text: 'body', includeInBatch: false },
    { id: 'b', title: 'B', text: '', includeInBatch: true },
  ];
  assert.deepEqual(resolveCopierAction([], cards), { kind: 'open' });
});

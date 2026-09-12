// Ranking: the four tiers, their order, and what the tie-break actually is.
//
// Section 0.7 fixes the tiers - exact, whole-name prefix, word prefix, fuzzy subsequence - and says the
// order between them is fixed. The module implements them as numbers and sorts by tier, then by the
// position the row had in the universe. That second key is the whole story of "deterministic": there is
// no recency, no frequency and no clock anywhere in the ranking, so no amount of use can move a row across
// a tier, and equal-tier rows come out in the order the universe produced them, which the universe tests
// already pin.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { QUICK_RUN_TIERS, quickRunResults, tierForName } from './public/app/quick-run/quick-run-index.js';

const row = (key, name) => ({ resultKey: key, name, type: 'folder' });
const names = (rows) => rows.map((entry) => entry.name);
const keys = (rows) => rows.map((entry) => entry.resultKey);

// Four names, one per tier, for the single query "note":
//   note      -> exact
//   notebook  -> whole-name prefix
//   My note   -> word prefix
//   Knoten    -> no prefix anywhere, but n-o-t-e appear in order
const fourTiers = [
  row('f-knoten', 'Knoten'),
  row('f-my-note', 'My note'),
  row('f-notebook', 'notebook'),
  row('f-note', 'note'),
];

test('the four tiers are the contract tiers, in the contract order (section 0.7)', () => {
  assert.deepEqual(QUICK_RUN_TIERS, { exact: 0, wholeNamePrefix: 1, wordPrefix: 2, fuzzy: 3 });
  assert.equal(tierForName('note', 'note'), QUICK_RUN_TIERS.exact);
  assert.equal(tierForName('notebook', 'note'), QUICK_RUN_TIERS.wholeNamePrefix);
  assert.equal(tierForName('My note', 'note'), QUICK_RUN_TIERS.wordPrefix);
  assert.equal(tierForName('Knoten', 'note'), QUICK_RUN_TIERS.fuzzy);
  assert.equal(tierForName('Editor', 'note'), null);
});

test('exact beats prefix, prefix beats word-prefix, word-prefix beats subsequence', () => {
  // The input is in reverse tier order on purpose: if the ranking were the input order, this would fail.
  assert.deepEqual(names(quickRunResults(fourTiers, 'note')), ['note', 'notebook', 'My note', 'Knoten']);
  assert.deepEqual(
    quickRunResults(fourTiers, 'note').map((entry) => entry.tier),
    [0, 1, 2, 3],
  );
});

test('each adjacent pair holds on its own, not only as a run of four', () => {
  const pairs = [
    [['note', 'notebook'], 'note', ['note', 'notebook']],
    [['notebook', 'My note'], 'note', ['notebook', 'My note']],
    [['My note', 'Knoten'], 'note', ['My note', 'Knoten']],
    [['Knoten', 'Editor'], 'note', ['Knoten']],
  ];
  for (const [input, query, expected] of pairs) {
    assert.deepEqual(
      names(quickRunResults(input.map((name, index) => row(`f-${index}`, name)), query)),
      expected,
      `${input.join(' vs ')} for "${query}"`,
    );
  }
});

test('subsequence beats no match: a fuzzy row is ranked, an unmatched row is absent', () => {
  const results = quickRunResults([row('f-knoten', 'Knoten'), row('f-editor', 'Editor')], 'note');
  assert.deepEqual(keys(results), ['f-knoten']);
  assert.equal(results[0].tier, QUICK_RUN_TIERS.fuzzy);
});

test('recency never moves a lower tier above a higher tier, because recency is not an input', () => {
  const withUsage = fourTiers.map((entry, index) => ({
    ...entry,
    usage: { uses: 100 - index * 40, lastUsedAt: '2026-09-12T08:00:00+07:00' },
  }));
  assert.deepEqual(
    names(quickRunResults(withUsage, 'note')),
    ['note', 'notebook', 'My note', 'Knoten'],
    'heavily used rows stay in their tiers',
  );
});

test('frequency never moves a lower tier above a higher tier, because frequency is not an input', async () => {
  const source = await readFile(new URL('./public/app/quick-run/quick-run-index.js', import.meta.url), 'utf8');
  for (const forbidden of ['recency', 'frequency', 'lastUsed', 'uses', 'Date.now', 'clock']) {
    assert.equal(
      source.includes(forbidden),
      false,
      `the ranking must not consult ${forbidden}: a tie-break it does not have cannot reorder anything`,
    );
  }
});

test('deterministic fallback stable: same input, same order, and the tie-break is the universe order', () => {
  const first = quickRunResults(fourTiers, 'note');
  const second = quickRunResults(fourTiers, 'note');
  assert.deepEqual(keys(first), keys(second), 'the same query over the same rows is the same answer');

  // Two rows in one tier: the order is the order the universe gave them, so it is deterministic given a
  // deterministic universe, and it is not alphabetical, recency or anything else that could drift.
  const sameTier = [row('f-b', 'Blue note'), row('f-a', 'Amber note')];
  assert.deepEqual(keys(quickRunResults(sameTier, 'note')), ['f-b', 'f-a']);
  assert.deepEqual(keys(quickRunResults([...sameTier].reverse(), 'note')), ['f-a', 'f-b']);
});

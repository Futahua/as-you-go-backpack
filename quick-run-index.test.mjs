import test from 'node:test';
import assert from 'node:assert/strict';
import {
  QUICK_RUN_TIERS,
  normaliseQueryText,
  highlightAfterResults,
  moveHighlight,
  quickRunResults,
  tierForName,
} from './public/app/quick-run/quick-run-index.js';

const rows = [
  { kind: 'folder', key: 'folder:1', name: 'Docs', breadcrumb: 'Workspace' },
  { kind: 'folder', key: 'folder:2', name: 'Doc archive', breadcrumb: 'Workspace' },
  { kind: 'shortcut', key: 'placement:1', name: 'Read the docs', breadcrumb: 'Workspace / Alpha' },
  { kind: 'shortcut', key: 'placement:2', name: 'read-the-docs', breadcrumb: 'Workspace' },
  { kind: 'shortcut', key: 'placement:3', name: 'read_the_docs', breadcrumb: 'Workspace' },
  { kind: 'link', key: 'placement:4', name: 'Release notes (docs)', breadcrumb: 'Workspace' },
  { kind: 'link', key: 'placement:5', name: 'Downtown office', breadcrumb: 'Workspace' },
  { kind: 'layout-item', key: 'layout:1:1', name: 'Chrome', breadcrumb: 'Workspace / Focus' },
];

test('normalization is the pinned one: Unicode, case, trim, collapsed whitespace', () => {
  assert.equal(normaliseQueryText('  DOCs   '), 'docs');
  assert.equal(normaliseQueryText('CAFÉ'), 'café');
  assert.equal(normaliseQueryText('a\t b'), 'a b');
  assert.equal(normaliseQueryText(undefined), '');
});

test('the tiers are the fixed ones, and each is reachable', () => {
  assert.equal(tierForName('Docs', 'docs'), QUICK_RUN_TIERS.exact);
  assert.equal(tierForName('Docs archive', 'doc'), QUICK_RUN_TIERS.wholeNamePrefix);
  assert.equal(tierForName('Read the docs', 'the'), QUICK_RUN_TIERS.wordPrefix);
  assert.equal(tierForName('Downtown office', 'dno'), QUICK_RUN_TIERS.fuzzy);
  assert.equal(tierForName('Chrome', 'zzz'), null);
  assert.equal(tierForName('Chrome', '   '), null);
});

test('a word prefix is found across spaces, hyphens, underscores and punctuation', () => {
  for (const name of ['Read the docs', 'read-the-docs', 'read_the_docs', 'Release notes (docs)']) {
    assert.equal(tierForName(name, 'docs'), QUICK_RUN_TIERS.wordPrefix, name);
  }
});

test('matching reads the display name only, never the breadcrumb or a target', () => {
  const onlyBreadcrumbMatches = [
    { kind: 'folder', key: 'folder:9', name: 'Alpha', breadcrumb: 'Workspace / docs' },
  ];
  assert.deepEqual(quickRunResults(onlyBreadcrumbMatches, 'docs'), []);
  const targetMatches = [
    { kind: 'link', key: 'placement:9', name: 'Portal', breadcrumb: 'Workspace', target: 'https://docs.example.com' },
  ];
  assert.deepEqual(quickRunResults(targetMatches, 'docs'), []);
});

test('results are ranked, and a prefix never loses to a fuzzy match', () => {
  const results = quickRunResults(rows, 'docs');
  // 'Doc archive' is deliberately absent: 'doc' is not a whole-name prefix of 'docs', and it is not a
  // word prefix either, so it drops to fuzzy and fails it. The tier boundary is the reason, not a bug.
  assert.equal(tierForName('Doc archive', 'docs'), null);
  assert.deepEqual(results.map((row) => row.key), [
    'folder:1',
    'placement:1',
    'placement:2',
    'placement:3',
    'placement:4',
  ]);
  const tiers = results.map((row) => row.tier);
  assert.deepEqual(tiers, [...tiers].sort((left, right) => left - right));
  assert.equal(results[0].tier, QUICK_RUN_TIERS.exact);
  assert.equal(results.at(-1).tier, QUICK_RUN_TIERS.wordPrefix);
});

test('an empty query shows nothing, because there is no empty-query home screen', () => {
  assert.deepEqual(quickRunResults(rows, ''), []);
  assert.deepEqual(quickRunResults(rows, '   '), []);
});

test('the highlight is preserved by stable key, and falls to the first result when that row is gone', () => {
  const before = quickRunResults(rows, 'docs');
  assert.equal(before.length, 5, 'the first set is the five docs matches');
  // The row to preserve is a real row of the first set...
  assert.equal(highlightAfterResults(before[3].key, before), before[3].key);
  // ...and the second set is a genuinely different one, so the key really is absent from it.
  const after = quickRunResults(rows, 'chrome');
  assert.deepEqual(after.map((row) => row.key), ['layout:1:1']);
  assert.ok(!after.some((row) => row.key === before[3].key));
  assert.equal(highlightAfterResults(before[3].key, after), after[0].key);
  assert.equal(highlightAfterResults(null, after), after[0].key);
  assert.equal(highlightAfterResults('anything', []), null);
});

test('arrow movement steps one row and clamps at both ends instead of wrapping', () => {
  const results = quickRunResults(rows, 'docs');
  const first = results[0].key;
  const second = results[1].key;
  const last = results.at(-1).key;
  assert.equal(moveHighlight(results, first, 1), second);
  assert.equal(moveHighlight(results, second, -1), first);
  assert.equal(moveHighlight(results, first, -1), first);
  assert.equal(moveHighlight(results, last, 1), last);
  assert.equal(moveHighlight(results, 'not-in-the-set', 1), first);
  assert.equal(moveHighlight([], first, 1), null);
});
test('a row keeps the shape the universe gave it, plus its tier', () => {
  const result = quickRunResults(rows, 'chrome')[0];
  assert.equal(result.key, 'layout:1:1');
  assert.equal(result.name, 'Chrome');
  assert.equal(result.kind, 'layout-item');
  assert.equal(result.breadcrumb, 'Workspace / Focus');
  assert.equal(result.tier, QUICK_RUN_TIERS.exact);
});
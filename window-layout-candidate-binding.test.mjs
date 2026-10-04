import assert from 'node:assert/strict';
import test from 'node:test';
import { createWindowLayoutCandidateBinder as makeBinder } from './public/app/window-layout-candidate-binding.js';
const row = { id: 'old', title: 'Document', applicationLabel: 'Editor', icon: 'keep' };
function harness(first, candidates = [], rebound = { outcome: 'success', capability: { bindingId: 'fresh' } }, listing = 'success') {
  const calls = [];
  const bind = makeBinder({
    bindWindowCandidate: async (id) => { calls.push(['bind', id]); return calls.filter(([kind]) => kind === 'bind').length === 1 ? first : rebound; },
    windowCandidates: async (options) => { calls.push(['list', options]); return { outcome: listing, candidates }; },
  });
  return { bind, calls };
}
test('fresh binding retains the exact chooser row without enumeration', async () => {
  const bound = { outcome: 'success' }; const h = harness(bound);
  const result = await h.bind('old', row);
  assert.equal(result.row, row); assert.equal(result.bound, bound);
  assert.deepEqual(h.calls, [['bind', 'old']]);
});
for (const outcome of ['denied', 'helper-unavailable', 'timeout', 'malformed', 'ambiguous']) {
  test(`${outcome} does not trigger recovery`, async () => {
    const bound = { outcome }; const h = harness(bound);
    assert.deepEqual(await h.bind('old', row), { bound, row });
    assert.deepEqual(h.calls, [['bind', 'old']]);
  });
}
test('missing without a chooser row cannot guess', async () => {
  const h = harness({ outcome: 'missing' }); await h.bind('old', undefined);
  assert.deepEqual(h.calls, [['bind', 'old']]);
});
test('stale id recovers one exact title/application match and returns its row', async () => {
  const fresh = { ...row, id: 'fresh' };
  const h = harness({ outcome: 'missing' }, [{ ...fresh, id: 'other', applicationLabel: 'Other' }, fresh]);
  const result = await h.bind('old', row);
  assert.equal(result.row, fresh); assert.equal(result.bound.outcome, 'success');
  assert.deepEqual(h.calls, [['bind', 'old'], ['list', { includeNativeIcons: false }], ['bind', 'fresh']]);
});
for (const candidates of [[], [{ ...row, id: 'a' }, { ...row, id: 'b' }], [{ ...row, title: 'Different' }]]) {
  test(`zero or ambiguous matches fail closed (${candidates.length} rows)`, async () => {
    const bound = { outcome: 'missing' }; const h = harness(bound, candidates);
    assert.deepEqual(await h.bind('old', row), { bound, row }); assert.equal(h.calls.length, 2);
  });
}
test('unavailable enumeration preserves the original missing result and row', async () => {
  const bound = { outcome: 'missing' }; const h = harness(bound, [], undefined, 'helper-unavailable');
  assert.deepEqual(await h.bind('old', row), { bound, row }); assert.equal(h.calls.length, 2);
});
test('absent application labels retain the baseline title-only fallback', async () => {
  const fresh = { id: 'fresh', title: row.title }; const h = harness({ outcome: 'missing' }, [fresh]);
  assert.equal((await h.bind('old', row)).row, fresh);
});
test('failed rebound returns the fresh row and typed failure without another retry', async () => {
  const fresh = { ...row, id: 'fresh' }; const rebound = { outcome: 'denied' };
  const h = harness({ outcome: 'missing' }, [fresh], rebound);
  assert.deepEqual(await h.bind('old', row), { bound: rebound, row: fresh }); assert.equal(h.calls.length, 3);
});
test('transport rejection propagates unchanged', async () => {
  const error = new Error('transport');
  const bind = makeBinder({ bindWindowCandidate: async () => { throw error; } });
  await assert.rejects(bind('old', row), (caught) => caught === error);
});

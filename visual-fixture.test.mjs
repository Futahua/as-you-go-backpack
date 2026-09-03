import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { normalizeState } from './public/workspace-model-20260730b.js';
import { hydrationSummaryDisagrees, semanticKeyForItem, workspaceVisualSummary } from './public/app/visual-observability.js';

const FIXTURE = new URL('./test-fixtures/visual/non-empty-state.json', import.meta.url);

test('synthetic visual fixture is non-empty, semantically keyed and read-only', async () => {
  const before = await readFile(FIXTURE);
  const source = JSON.parse(before);
  const installed = normalizeState(source.state);
  assert.equal(source.revision, 'fixture-visual-non-empty-v1');
  assert.deepEqual(workspaceVisualSummary(installed), { groups: 1, shortcuts: 1, windowLayouts: 0 });
  assert.equal(hydrationSummaryDisagrees(source.state, installed), false);
  assert.equal(semanticKeyForItem({ ...installed.groups[0], kind: 'group' }), 'group.fixture-group');
  assert.equal(semanticKeyForItem({ ...installed.shortcuts[0], kind: 'shortcut' }), 'shortcut.fixture-shortcut');
  const after = await readFile(FIXTURE);
  assert.equal(createHash('sha256').update(before).digest('hex'), createHash('sha256').update(after).digest('hex'));
});

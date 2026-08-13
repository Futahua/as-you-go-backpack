import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./public/workspace-20260730b.js', import.meta.url), 'utf8');

test('022: active direct picker routes Space to stage and Enter to commit', () => {
  assert.match(source, /pickUnsubscribe && \(event\.key === ' ' \|\| event\.key === 'Enter'\)/);
  assert.match(source, /event\.key === ' '\s*\?\s*host\.pickWindowStage\(\)\s*:\s*host\.pickWindowCommit\(\)/);
  assert.match(source, /event\.preventDefault\(\);\s*event\.stopPropagation\(\);/);
  assert.match(source, /pickLayoutId/);
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./public/workspace-20260730b.js', import.meta.url), 'utf8');

test('active direct picker routes every non-Escape key to confirmation and Escape to cancellation', () => {
  assert.match(source, /if \(event\.key === 'Escape' && windowLayoutRuntime\.pickUnsubscribe\)[\s\S]*?host\.pickWindowCancel\(\)/);
  assert.match(source, /if \(windowLayoutRuntime\.pickUnsubscribe\) \{[\s\S]*?const request = host\.pickWindowCommit\(\)/);
  assert.match(source, /if \(event\.key === 'Escape'\) \{[\s\S]*?host\.pickWindowCancel\(\)[\s\S]*?\} else \{[\s\S]*?host\.pickWindowCommit\(\)/);
  assert.match(source, /event\.preventDefault\(\);\s*event\.stopPropagation\(\);/);
  assert.match(source, /pickLayoutId/);
});

test('the picker button click enters live pick mode before the hover list', () => {
  assert.match(source, /cancelWindowLayoutListDwell\(\);\s*void beginWindowLayoutDirectPick\(listButton\.dataset\.wlList\)/);
  assert.match(source, /cancelWindowLayoutListDwell\(\);\s*void beginWidgetDirectPick\(\)/);
  assert.match(source, /Live-pick an onscreen window \(hover for the list\)/);
});

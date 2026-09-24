import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./public/workspace-20260730b.js', import.meta.url), 'utf8');

test('active direct picker commits on every key except Escape', () => {
  assert.match(source, /if \(windowLayoutRuntime\.pickUnsubscribe\) \{[\s\S]*?host\.pickWindowCommit\(\)/);
  assert.match(source, /if \(!widgetState\.pickUnsubscribe\) return;[\s\S]*?event\.key === 'Escape'[\s\S]*?host\.pickWindowCancel\(\)[\s\S]*?host\.pickWindowCommit\(\)/);
  assert.match(source, /event\.preventDefault\(\);\s*event\.stopPropagation\(\);/);
  assert.match(source, /pickLayoutId/);
});

test('icon middle-click semantics stay separate: plain unlinks, Ctrl closes the process', () => {
  const attached = source.slice(source.indexOf("elements.grid.addEventListener('auxclick'"), source.indexOf('// A press on a member is a CONTROL intent'));
  const widget = source.slice(source.indexOf('function handleWidgetCardAuxClick(event)'), source.indexOf('async function handleWidgetCardContextMenu(event)'));
  for (const handler of [attached, widget]) {
    assert.match(handler, /if \(event\.ctrlKey\)[\s\S]*?closeWindowLayoutMember/);
    assert.match(handler, /remove-member|handleWindowLayoutUnlink/);
  }
});

test('the picker button click enters live pick mode before the hover list', () => {
  assert.match(source, /cancelWindowLayoutListDwell\(\);\s*void beginWindowLayoutDirectPick\(listButton\.dataset\.wlList\)/);
  assert.match(source, /cancelWindowLayoutListDwell\(\);\s*void beginWidgetDirectPick\(\)/);
  assert.match(source, /Live-pick an onscreen window \(hover for the list\)/);
});

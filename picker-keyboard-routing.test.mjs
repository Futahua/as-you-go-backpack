import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./public/workspace-20260730b.js', import.meta.url), 'utf8')
  + '\n' + await readFile(new URL('./public/app/window-layout-view.js', import.meta.url), 'utf8')
  + '\n' + await readFile(new URL('./public/app/window-layout-workspace-picker.js', import.meta.url), 'utf8')
  + '\n' + await readFile(new URL('./public/app/window-layout-workspace-card-input.js', import.meta.url), 'utf8')
  + '\n' + await readFile(new URL('./public/app/window-layout-widget-surface.js', import.meta.url), 'utf8');

test('active direct picker routes every non-Escape key to confirmation and Escape to cancellation', () => {
  assert.match(source, /if \(event\.key === 'Escape' && windowLayoutRuntime\.pickUnsubscribe\)[\s\S]*?host\.pickWindowCancel\(\)/);
  assert.match(source, /if \(windowLayoutRuntime\.pickUnsubscribe\) \{[\s\S]*?const request = host\.pickWindowCommit\(\)/);
  assert.match(source, /if \(event\.key === 'Escape'\) \{[\s\S]*?host\.pickWindowCancel\(\)[\s\S]*?\} else \{[\s\S]*?host\.pickWindowCommit\(\)/);
  assert.match(source, /event\.preventDefault\(\);\s*event\.stopPropagation\(\);/);
  assert.match(source, /pickLayoutId/);
});

test('icon middle-click semantics stay separate: plain unlinks, Ctrl closes the process', () => {
  const attached = source.slice(source.indexOf('function handleAuxClick(event)'), source.indexOf('function handleContextMenu(event)'));
  const widget = source.slice(source.indexOf('function handleWidgetCardAuxClick(event)'), source.indexOf('async function handleWidgetCardContextMenu(event)'));
  for (const handler of [attached, widget]) {
    assert.match(handler, /if \(event\.ctrlKey\)[\s\S]*?(closeMember|closeWindowLayoutMember)/);
    assert.match(handler, /remove-member|unlinkMember/);
  }
});

test('the picker button click enters live pick mode before the hover list', () => {
  assert.match(source, /cancelListDwell\(\);\s*void beginDirectPick\(list\.dataset\.wlList\)/);
  assert.match(source, /cancelWindowLayoutListDwell\(\);\s*void beginWidgetDirectPick\(\)/);
  assert.match(source, /Live-pick an onscreen window \(hover for the list\)/);
});

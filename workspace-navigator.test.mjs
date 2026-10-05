import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  aygNavigatorNativePaths,
  beginNavigatorNativeDrag,
  navigatorBreadcrumbMovePlan,
  navigatorDragItemIds,
  navigatorNativeDragSourceMatches,
  navigatorSelectedPaths,
  navigatorSavedStateForItem,
} from './public/app/workspace-navigator.js';

test('navigator native drag cancels Chromium drag before starting one Windows drag', async () => {
  const calls = [];
  let prevented = 0;
  const event = {
    dataTransfer: {
    },
    preventDefault() { prevented++; },
  };
  const host = {
    fileCapability(operation, params) {
      calls.push([operation, params]);
      return Promise.resolve({ ok: true });
    },
  };

  assert.equal(beginNavigatorNativeDrag({
    event,
    paths: ['D:\\Work\\plan.rvt', 'D:\\Work\\plan.rvt'],
    host,
  }), true);
  await Promise.resolve();

  assert.equal(prevented, 1);
  assert.deepEqual(calls, [[
    'native-drag',
    { paths: ['D:\\Work\\plan.rvt'] },
  ]]);
});

test('navigator native drag fails closed without a usable DataTransfer or path', () => {
  assert.equal(beginNavigatorNativeDrag({
    event: {},
    paths: ['D:\\Work\\plan.rvt'],
    host: {},
  }), false);
  assert.equal(beginNavigatorNativeDrag({
    event: { dataTransfer: {}, preventDefault() {} },
    paths: [''],
    host: {},
  }), false);
});

test('AYG navigator drags the whole current selection only when the dragged row is selected', () => {
  const calls = [];
  const resolvePaths = (ids) => {
    calls.push(ids);
    return ids.map((id) => `D:\\Files\\${id}.txt`);
  };

  assert.deepEqual(aygNavigatorNativePaths({
    itemId: 'b',
    selectedIds: new Set(['a', 'b']),
    resolvePaths,
  }), ['D:\\Files\\a.txt', 'D:\\Files\\b.txt']);
  assert.deepEqual(aygNavigatorNativePaths({
    itemId: 'c',
    selectedIds: new Set(['a', 'b']),
    resolvePaths,
  }), ['D:\\Files\\c.txt']);
  assert.deepEqual(calls, [['a', 'b'], ['c']]);
});

test('navigator breadcrumb drag identity follows the current AYG selection', () => {
  assert.deepEqual(navigatorDragItemIds('b', new Set(['a', 'b'])).sort(), ['a', 'b']);
  assert.deepEqual(navigatorDragItemIds('c', new Set(['a', 'b'])), ['c']);
});

test('breadcrumb move plans keep AYG reparenting and Opus filesystem moves separate', () => {
  assert.deepEqual(navigatorBreadcrumbMovePlan({
    segment: { item: { id: 'folder-b' } },
    rootId: 'root',
    aygItemIds: ['a', 'b', 'a'],
  }), {
    kind: 'ayg-move',
    itemIds: ['a', 'b'],
    destination: 'folder-b',
  });
  assert.deepEqual(navigatorBreadcrumbMovePlan({
    segment: { path: 'D:\\Work' },
    rootId: 'root',
    machinePaths: ['D:\\Desk\\one.txt', 'D:\\Desk\\one.txt'],
  }), {
    kind: 'machine-move',
    paths: ['D:\\Desk\\one.txt'],
    destination: 'D:\\Work',
  });
});

test('a recent native Ctrl-drag can return through Files only when exact source paths match', () => {
  const source = {
    mode: 'ayg',
    itemIds: ['a'],
    paths: ['D:\\Files\\a.txt'],
    startedAt: 1000,
  };
  assert.equal(navigatorNativeDragSourceMatches(source, ['d:\\files\\a.txt'], 2000), true);
  assert.equal(navigatorNativeDragSourceMatches(source, ['D:\\Files\\other.txt'], 2000), false);
  assert.equal(navigatorNativeDragSourceMatches(source, ['D:\\Files\\a.txt'], 31_001), false);
  assert.deepEqual(navigatorBreadcrumbMovePlan({
    segment: { item: { id: 'folder-b' } },
    rootId: 'root',
    nativeSource: source,
    droppedPaths: ['D:\\Files\\a.txt'],
    now: 2000,
  }), {
    kind: 'ayg-move',
    itemIds: ['a'],
    destination: 'folder-b',
  });
});

test('copy selected paths deduplicates AYG paths and uses the selected Opus path', () => {
  assert.deepEqual(navigatorSelectedPaths({
    mode: 'ayg',
    selectedIds: new Set(['a', 'b']),
    resolvePaths: () => ['D:\\A.txt', 'd:\\a.txt', 'D:\\B.txt'],
  }), ['D:\\A.txt', 'D:\\B.txt']);
  assert.deepEqual(navigatorSelectedPaths({
    mode: 'machine',
    selected: { path: 'D:\\Machine\\file.rvt' },
  }), ['D:\\Machine\\file.rvt']);
});

test('provider switching stays inline and navigator no longer constructs a Home button', async () => {
  const source = await readFile(new URL('./public/app/workspace-navigator.js', import.meta.url), 'utf8');
  const start = source.indexOf('async function switchProvider()');
  const end = source.indexOf('\n  function rememberNativeDrag', start);
  assert.ok(start >= 0 && end > start);
  const switchProvider = source.slice(start, end);
  assert.doesNotMatch(switchProvider, /pickTarget\(/);
  assert.doesNotMatch(source, /button\(d,'Home'/);
  assert.match(source, /if\(!event\.ctrlKey\)return;/, 'ordinary HTML5 drag must remain available for pills and breadcrumbs');
});

test('saved navigator shortcuts retain the identity needed to hydrate the same icon as their row', () => {
  assert.deepEqual(navigatorSavedStateForItem({
    id: 'placement-1', shortcutId: 'shortcut-1', kind: 'shortcut', name: 'Report.pptx',
    target: 'D:\\Files\\Report.pptx', icon: null,
  }), {
    mode: 'action', itemId: 'shortcut-1', name: 'Report.pptx', icon: null,
    art: { kind: 'shortcut', icon: null, target: 'D:\\Files\\Report.pptx', shortcutId: 'shortcut-1' },
  });
});
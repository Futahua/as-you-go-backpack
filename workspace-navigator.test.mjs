import assert from 'node:assert/strict';
import test from 'node:test';

import {
  aygNavigatorNativePaths,
  beginNavigatorNativeDrag,
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

test('saved navigator shortcuts retain the identity needed to hydrate the same icon as their row', () => {
  assert.deepEqual(navigatorSavedStateForItem({
    id: 'placement-1', shortcutId: 'shortcut-1', kind: 'shortcut', name: 'Report.pptx',
    target: 'D:\\Files\\Report.pptx', icon: null,
  }), {
    mode: 'action', itemId: 'shortcut-1', name: 'Report.pptx', icon: null,
    art: { kind: 'shortcut', icon: null, target: 'D:\\Files\\Report.pptx', shortcutId: 'shortcut-1' },
  });
});
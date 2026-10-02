import assert from 'node:assert/strict';
import test from 'node:test';

import { beginMachineRowDrag } from './public/app/workspace-navigator.js';

test('machine navigator drag keeps the AYG payload and starts one native Windows drag', async () => {
  const writes = [];
  const calls = [];
  const event = {
    dataTransfer: {
      effectAllowed: 'none',
      setData(type, value) {
        writes.push([type, value]);
      },
    },
  };
  const host = {
    fileCapability(operation, params) {
      calls.push([operation, params]);
      return Promise.resolve({ ok: true });
    },
  };

  assert.equal(beginMachineRowDrag({
    event,
    item: { path: 'D:\\Work\\plan.rvt', name: 'plan.rvt' },
    host,
  }), true);
  await Promise.resolve();

  assert.equal(event.dataTransfer.effectAllowed, 'link');
  assert.deepEqual(writes, [[
    'application/x-papers-native-items',
    JSON.stringify([{ target: 'D:\\Work\\plan.rvt', name: 'plan.rvt' }]),
  ]]);
  assert.deepEqual(calls, [[
    'native-drag',
    { paths: ['D:\\Work\\plan.rvt'] },
  ]]);
});

test('machine navigator drag fails closed without a usable DataTransfer or path', () => {
  assert.equal(beginMachineRowDrag({
    event: {},
    item: { path: 'D:\\Work\\plan.rvt' },
    host: {},
  }), false);
  assert.equal(beginMachineRowDrag({
    event: { dataTransfer: { setData() {} } },
    item: { path: '' },
    host: {},
  }), false);
});
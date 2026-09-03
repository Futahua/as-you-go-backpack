import assert from 'node:assert/strict';
import test from 'node:test';

import { hasSettledGraphPositions } from './public/graph-model-20260730b.js';

test('settled entry requires remembered positions for every ordinary body', () => {
  const positions = new Map([['a', { x: 10, y: 20 }], ['b', { x: 30, y: 40 }]]);
  const lookup = (id) => positions.get(id);
  assert.equal(hasSettledGraphPositions([{ id: 'a' }, { id: 'b' }], lookup), true);
  assert.equal(hasSettledGraphPositions([{ id: 'a' }, { id: 'new' }], lookup), false);
});

test('derived breadcrumb and Bin-origin nodes do not block settled entry', () => {
  const items = [
    { id: 'a' },
    { id: 'ancestor', ancestor: true },
    { id: 'trail', trail: true },
    { id: 'origin', kind: 'bin-origin' },
  ];
  assert.equal(hasSettledGraphPositions(items, (id) => (id === 'a' ? { x: 1, y: 2 } : null)), true);
});

test('invalid settled-position inputs fail closed', () => {
  assert.equal(hasSettledGraphPositions([], () => null), true);
  assert.equal(hasSettledGraphPositions(null, () => null), false);
  assert.equal(hasSettledGraphPositions([{ id: 'a' }], null), false);
});

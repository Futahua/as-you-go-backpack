import assert from 'node:assert/strict';
import test from 'node:test';
import { toolbarPositionFromRect } from './public/app/components/toolbar-controller.js';

const workspace = { left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800 };

test('toolbarPositionFromRect anchors to the nearer edge as a fraction', () => {
  // Near the left edge -> positive x fraction of width.
  const left = toolbarPositionFromRect({ left: 20, right: 120, top: 30, bottom: 80 }, workspace);
  assert.ok(Math.abs(left.x - 20 / 1000) < 1e-9);
  assert.ok(Math.abs(left.y - 30 / 800) < 1e-9);

  // Near the right edge -> negative x fraction (distance from right edge).
  const right = toolbarPositionFromRect({ left: 880, right: 980, top: 30, bottom: 80 }, workspace);
  assert.ok(Math.abs(right.x - (-20 / 1000)) < 1e-9);

  // Near the bottom edge -> negative y fraction.
  const bottom = toolbarPositionFromRect({ left: 20, right: 120, top: 720, bottom: 790 }, workspace);
  assert.ok(Math.abs(bottom.y - (-10 / 800)) < 1e-9);
});

test('toolbarPositionFromRect stays finite on degenerate empty rects', () => {
  const result = toolbarPositionFromRect({ left: 0, right: 0, top: 0, bottom: 0 }, workspace);
  assert.ok(Number.isFinite(result.x));
  assert.ok(Number.isFinite(result.y));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createPaneSelectionPolicy } from './public/app/pane-selection-policy.js';

test('repeated workspace selection cannot undo a manual window tab', () => {
  const policy = createPaneSelectionPolicy();
  const selected = { mode: 'web', item: { shortcutId: 'link', url: 'https://example.com' } };
  assert.equal(policy.observe(selected), true);
  policy.hold();
  assert.equal(policy.observe(structuredClone(selected)), false);
  assert.equal(policy.observe({ ...selected, item: { ...selected.item, name: 'Updated title' } }), false);
  assert.equal(policy.observe({ mode: 'empty', selectionCount: 0 }), true);
  assert.equal(policy.observe(selected), true);
});
test('a manual tab also holds an empty selection until the creator chooses another item', () => {
  const policy = createPaneSelectionPolicy();
  policy.observe({ mode: 'empty', selectionCount: 0 }); policy.hold();
  assert.equal(policy.observe({ mode: 'empty', selectionCount: 0 }), false);
  assert.equal(policy.observe({ mode: 'single', item: { shortcutId: 'file', path: 'D:\\file.docx' } }), true);
});
test('a navigator file preview holds against repeated empty workspace selection', () => {
  const policy = createPaneSelectionPolicy();
  const empty = { mode: 'empty', selectionCount: 0 };
  policy.observe(empty);
  // Direct navigator previews do not mutate the canvas selection.
  policy.hold();
  assert.equal(policy.observe(empty), false);
  assert.equal(policy.observe({ mode: 'web', item: { url: 'https://example.com' } }), true);
});


test('repeated empty or multiple notifications never reassert the fallback', () => {
  const policy = createPaneSelectionPolicy();
  const empty = {mode:'empty',selectionCount:0};
  assert.equal(policy.observe(empty),true);
  assert.equal(policy.observe(structuredClone(empty)),false);
  const file = {mode:'single',item:{path:'D:/a.jpg'}};
  assert.equal(policy.observe(file),true);
  assert.equal(policy.observe(empty),true);
  assert.equal(policy.observe(empty),false);
});

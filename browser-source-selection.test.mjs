import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserSourceSelection } from './public/app/browser-source-selection.js';
test('unchanged selection refreshes do not reactivate or navigate the browser source', () => {
  const selection = createBrowserSourceSelection(); const source = { shortcutId: 'gpt' };
  assert.equal(selection.update(source, 'https://chatgpt.com/'), true);
  for (let i = 0; i < 100; i++) assert.equal(selection.update(source, 'https://chatgpt.com/'), false);
});
test('a new source, changed URL, or selection after leaving the browser is actionable', () => {
  const selection = createBrowserSourceSelection();
  assert.equal(selection.update({ shortcutId: 'gpt' }, 'https://chatgpt.com/'), true);
  assert.equal(selection.update({ shortcutId: 'wiki' }, 'https://en.wikipedia.org/'), true);
  assert.equal(selection.update({ shortcutId: 'wiki' }, 'https://en.wikipedia.org/new'), true);
  selection.clear(); assert.equal(selection.update({ shortcutId: 'wiki' }, 'https://en.wikipedia.org/new'), true);
});

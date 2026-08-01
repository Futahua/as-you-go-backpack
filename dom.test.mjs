import assert from 'node:assert/strict';
import test from 'node:test';
import { getWorkspaceElements } from './public/app/dom.js';

function fakeDocument(selectors) {
  const elements = new Map(selectors.map((selector) => [selector, { selector }]));
  return {
    querySelector(selector) {
      return elements.get(selector) ?? null;
    },
  };
}

test('dom registry resolves every required workspace element', () => {
  const document = fakeDocument([
    '#status', '#icon-grid', '#explorer', '#selection-marquee', '#empty',
    '#breadcrumbs', '#delete-all-bin', '#restore-all-bin', '#selection-status',
    '#context-menu', '#bin-button', '#bin-label', '#bin-count', '#editor-layer',
    '#editor', '#save-editor', '#editor-title', '#editor-error', '#name-input',
    '#description-input', '#description-label', '#target-input', '#target-fields',
    '#target-actions', '#icon-input', '#icon-preview', '#icon-fallback',
    '#use-target-icon', '#confirm-layer', '#confirm-title', '#confirm-copy',
    '#confirm-delete', '#confirm-restore', '#cancel-confirm', '#link-edit-layer',
    '#prompt-layer',
  ]);

  const elements = getWorkspaceElements(document);
  assert.equal(elements.grid.selector, '#icon-grid');
  assert.equal(elements.editor.selector, '#editor');
  assert.equal(Object.keys(elements).length, 36);
});

test('dom registry fails fast when an element is missing', () => {
  const document = fakeDocument(['#icon-grid', '#editor']);
  assert.throws(
    () => getWorkspaceElements(document),
    /Required element missing: #status/,
  );
});

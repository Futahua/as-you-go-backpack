import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { separatedPaneWidths } from './public/app/paired-pane-resizer.js';

test('unclasp restores a real gap when the panes were clasped from a touching layout', () => {
  assert.deepEqual(separatedPaneWidths({ leftWidth: 420, rightWidth: 520, gap: 0 }, 34), {
    leftWidth: 403,
    rightWidth: 503,
  });
});

test('unclasp preserves an already separated independent layout', () => {
  assert.deepEqual(separatedPaneWidths({ leftWidth: 390, rightWidth: 480, gap: 80 }, 34), {
    leftWidth: 390,
    rightWidth: 480,
  });
});

test('unclasp uses the other pane when one pane is already at its minimum width', () => {
  assert.deepEqual(separatedPaneWidths({ leftWidth: 400, rightWidth: 300, gap: 0 }, 34), {
    leftWidth: 366,
    rightWidth: 300,
  });
});

test('clasp owns the shared seam and disables the two individual pane edges', async () => {
  const [source, css] = await Promise.all([
    readFile(new URL('./public/app/paired-pane-resizer.js', import.meta.url), 'utf8'),
    readFile(new URL('./public/styles/navigator.css', import.meta.url), 'utf8'),
  ]);
  assert.match(source, /pane-clasp-toggle/);
  assert.match(source, /classList\.toggle\('pane-clasp-control-visible', clasped \|\| b\.left - a\.right < 30\)/);
  assert.match(source, /clasped \? 'Separate panes' : 'Clasp panes'/);
  assert.match(source, /strip\.hidden = !clasped/);
  assert.match(css, /\.workspace-navigator\.pane-clasp-control-visible \.workspace-navigator-header\{padding-right:42px\}/);
  assert.match(css, /\.workspace-navigator\.pane-clasped \.workspace-navigator-resizer,\.file-capability-panel\.pane-clasped \.file-capability-resizer\{display:none!important\}/);
});
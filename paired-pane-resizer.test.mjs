import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { separatedPaneWidths, installPairedPaneResizer } from './public/app/paired-pane-resizer.js';

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
  assert.match(source, /clasped \? 'Separate panes' : 'Clasp panes'/);
  assert.match(source, /strip\.hidden = !clasped/);
  assert.match(css, /\.workspace-navigator\.pane-clasped \.workspace-navigator-resizer,\.file-capability-panel\.pane-clasped \.file-capability-resizer\{display:none!important\}/);
});

test('native Chrome moves the clasp and clasped navigator without moving Chrome', () => {
  const element = (rect, classes = []) => {
    const values = new Set(classes);
    return { hidden: false, dataset: {}, style: {}, listeners: {},
      classList: { contains: k => values.has(k), add: k => values.add(k), remove: k => values.delete(k), toggle(k, on) { on ? values.add(k) : values.delete(k); } },
      getBoundingClientRect: () => rect, setAttribute() {}, addEventListener(k, fn) { this.listeners[k] = fn; } };
  };
  const a = { left: 20, right: 320, width: 300, top: 50, bottom: 600 };
  const b = { left: 502, right: 1000, width: 498, top: 50, bottom: 600 };
  const left = element(a), right = element(b, ['expanded', 'native-chrome-layout']);
  right.dataset.chromeLeft = '500';
  const appended = [];
  const win = { localStorage: { getItem: () => null, setItem() {} }, getComputedStyle: e => ({ width: e.getBoundingClientRect().width + 'px' }),
    requestAnimationFrame: fn => fn(), addEventListener() {}, ResizeObserver: class { observe() {} }, MutationObserver: class { observe() {} } };
  const document = { defaultView: win, querySelector: s => s === '#workspace-navigator' ? left : right,
    createElement: () => element({}), body: { append: (...els) => appended.push(...els) } };
  const navigator = { isCollapsed: () => false, setWidth(width) { a.width = width; a.right = a.left + width; } };
  const preview = { setWidth() { throw new Error('Clasp overruled Chrome'); }, refreshPreviewGeometry() {} };
  const api = installPairedPaneResizer({ document, navigator, preview });
  assert.equal(appended[1].style.left, '485px');
  appended[1].listeners.click();
  assert.equal(a.right, 500); assert.equal(appended[0].hidden, true);
  right.dataset.chromeLeft = '420'; b.left = 422; api.refresh();
  assert.equal(a.right, 420); assert.equal(appended[1].style.left, '405px');
  appended[1].listeners.click(); assert.equal(a.width, 300);
});

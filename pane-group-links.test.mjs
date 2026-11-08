import assert from 'node:assert/strict';
import test from 'node:test';
import { createPaneGroupLinks } from './public/app/pane-group-links.js';

function memory() { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; }
const groups = (...entries) => entries.map(([id, presentation = 'normal']) => ({ id, presentation }));

test('two consecutive handle clicks link two groups with one colour; clicking a linked one removes just it', () => {
  const links = createPaneGroupLinks({ storage: memory() }); links.load('b');
  links.click('a'); assert.equal(links.look('a').pending, true);
  links.click('b'); assert.ok(links.look('a').color); assert.equal(links.look('a').color, links.look('b').color);
  links.click('c'); links.click('d');
  assert.notEqual(links.look('c').color, links.look('a').color, 'a second link gets its own colour');
  links.click('a'); assert.equal(links.linkOf('a'), null);
  assert.equal(links.linkOf('b'), null, 'a link left with one group ends');
  assert.ok(links.linkOf('c'));
});

test('Ctrl-click starts adding to that link; later clicks join it; Ctrl-click again stops', () => {
  const links = createPaneGroupLinks({ storage: memory() }); links.load('b');
  links.click('a', { ctrl: true }); links.click('b'); links.click('c');
  const link = links.linkOf('a');
  assert.equal(links.linkOf('b'), link); assert.equal(links.linkOf('c'), link);
  links.click('a', { ctrl: true }); assert.equal(links.adding, null);
  links.click('b'); assert.equal(links.linkOf('b'), null, 'out of adding mode a click unlinks again');
  assert.equal(links.linkOf('c'), link);
});

test('Esc cancels a half-made link and an adding mode that added nobody', () => {
  const links = createPaneGroupLinks({ storage: memory() }); links.load('b');
  links.click('a'); assert.equal(links.cancel(), true); assert.equal(links.look('a').pending, false);
  links.click('x', { ctrl: true }); links.cancel(); assert.equal(links.linkOf('x'), null);
});

test('linked groups minimize and restore together; unlinked ones act alone', () => {
  const links = createPaneGroupLinks({ storage: memory() }); links.load('b');
  links.click('a'); links.click('b');
  assert.deepEqual(links.present('a', 'minimized', groups(['a'], ['b'], ['c'])), [{ groupId: 'a', mode: 'minimized' }, { groupId: 'b', mode: 'minimized' }]);
  assert.deepEqual(links.present('c', 'minimized', groups(['a'], ['b'], ['c'])), [{ groupId: 'c', mode: 'minimized' }]);
});

test('maximizing a link gives it the page and restoring puts the others back as they were', () => {
  const links = createPaneGroupLinks({ storage: memory() }); links.load('b');
  links.click('a'); links.click('b');
  const max = links.present('a', 'maximized', groups(['a'], ['b', 'minimized'], ['c'], ['d', 'minimized']));
  assert.deepEqual(max, [{ groupId: 'a', mode: 'normal' }, { groupId: 'b', mode: 'normal' }, { groupId: 'c', mode: 'minimized' }]);
  assert.equal(links.linkMaximized('b'), true);
  const back = links.present('b', 'normal', groups(['a'], ['b'], ['c', 'minimized'], ['d', 'minimized']));
  assert.deepEqual(back, [{ groupId: 'c', mode: 'normal' }]);
  assert.equal(links.linkMaximized('a'), false);
});

test('links are remembered per layout', () => {
  const storage = memory();
  const one = createPaneGroupLinks({ storage }); one.load('layout-1'); one.click('a'); one.click('b');
  const two = createPaneGroupLinks({ storage }); two.load('layout-1');
  assert.ok(two.linkOf('a')); assert.equal(two.linkOf('a'), two.linkOf('b'));
  two.load('layout-2'); assert.equal(two.linkOf('a'), null);
});

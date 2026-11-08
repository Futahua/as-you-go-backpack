import assert from 'node:assert/strict';
import test from 'node:test';
import { createPaneGroupLinks } from './public/app/pane-group-links.js';

function memory() { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k) }; }
const groups = (...entries) => entries.map(([id, presentation = 'normal']) => ({ id, presentation }));
function view(storage, binding) { const links = createPaneGroupLinks({ storage }); links.load(binding); return links; }

test('two handle clicks link two groups; picking stays on until Esc; a click while picking toggles membership', () => {
  const links = view(memory(), 'w1');
  links.click('a'); assert.equal(links.look('a').pending, true); assert.equal(links.look('a').acting, true);
  links.click('b');
  assert.ok(links.linkOf('a')); assert.equal(links.linkOf('a'), links.linkOf('b'));
  assert.equal(links.snapshot().picking, true, 'picking stays on after the second click');
  assert.equal(links.look('b').acting, true, 'the strips of the link being built are rainbow');
  assert.equal(links.look('z').acting, false, 'other strips are not');
  links.click('e'); assert.equal(links.linkOf('e'), links.linkOf('a'));
  links.click('e'); assert.equal(links.linkOf('e'), null, 'clicking a member while picking takes it back out');
  links.cancel(); assert.equal(links.snapshot().picking, false);
  links.click('a'); assert.equal(links.linkOf('a'), null, 'outside picking a click unlinks');
  assert.equal(links.linkOf('b'), null, 'a link left with one group ends');
});

test('Ctrl-click picks for an existing link; Ctrl-click again stops', () => {
  const links = view(memory(), 'w1');
  links.click('a'); links.click('b'); links.cancel();
  links.click('a', { ctrl: true }); links.click('c');
  assert.equal(links.linkOf('c'), links.linkOf('a'));
  links.click('a', { ctrl: true }); assert.equal(links.adding, null);
});

test("links work across Papers windows and a linked action reaches each window's own members", () => {
  const storage = memory(), w1 = view(storage, 'window-1'), w2 = view(storage, 'window-2');
  w1.click('g1'); w2.click('g1');
  assert.equal(w1.linkOf('g1'), w2.linkOf('g1'), 'the same group id in two windows is two groups, linked together');
  w1.cancel();
  const { steps, announce } = w1.request('g1', 'minimized', groups(['g1'], ['g2']));
  assert.deepEqual(steps, [{ groupId: 'g1', mode: 'minimized' }]);
  assert.ok(announce);
  assert.deepEqual(w2.applyLink(announce.link, announce.mode, groups(['g1'], ['g3'])), [{ groupId: 'g1', mode: 'minimized' }]);
  assert.deepEqual(view(storage, 'window-3').applyLink(announce.link, announce.mode, groups(['g1'])), [], 'a window without members does nothing');
});

test('an unlinked group acts alone', () => {
  const links = view(memory(), 'w1');
  assert.deepEqual(links.request('c', 'minimized', groups(['c'])), { steps: [{ groupId: 'c', mode: 'minimized' }], announce: null });
});

test("maximizing a link gives its members the page in that window; restoring puts the others back", () => {
  const links = view(memory(), 'w1');
  links.click('a'); links.click('b'); links.cancel();
  const max = links.request('a', 'maximized', groups(['a'], ['b', 'minimized'], ['c'], ['d', 'minimized']));
  assert.deepEqual(max.steps, [{ groupId: 'a', mode: 'maximized', side: 'link:a,b' }], 'one coordinator command keeps their relative sizes');
  assert.equal(links.linkMaximized('b'), true);
  const back = links.request('b', 'normal', groups(['a'], ['b'], ['c', 'minimized'], ['d', 'minimized']));
  assert.deepEqual(back.steps, [{ groupId: 'a', mode: 'normal', side: 'link:a,b' }, { groupId: 'c', mode: 'normal' }]);
  assert.equal(links.linkMaximized('a'), false);
});

test('a link keeps one colour for every window, kept 45° from colours in use', () => {
  const storage = memory(), w1 = view(storage, 'w1'), w2 = view(storage, 'w2');
  w1.click('a'); w1.click('b'); w1.cancel(); w1.click('c'); w1.click('d'); w1.cancel();
  const first = w1.linkOf('a'), second = w1.linkOf('c');
  assert.equal(w1.snapshot().needsHue(first), true);
  w1.assignHues([[first, 100], [second, 110]]);
  assert.equal(w1.look('a').color, 'oklch(68% 0.18 100deg)');
  assert.equal(w1.look('c').color, 'oklch(68% 0.18 155deg)', 'a proposed hue too close to one in use moves 45° on');
  w2.assignHues([[first, 300]]);
  assert.equal(w1.look('a').color, 'oklch(68% 0.18 100deg)', 'a chosen colour never changes, whichever window proposes one');
});

test("picking started in one view shows in the other; neither overwrites the other's links", () => {
  const storage = memory(), left = view(storage, 'layout'), right = view(storage, 'layout');
  left.click('a'); left.click('b'); left.cancel();
  right.click('c', { ctrl: true });
  assert.equal(left.snapshot().picking, true);
  left.click('d'); right.cancel();
  assert.equal(left.linkOf('a'), right.linkOf('b'));
  assert.equal(right.linkOf('d'), right.linkOf('c'));
  assert.notEqual(right.linkOf('c'), right.linkOf('a'));
});

test('Ctrl acts on one group, which then keeps its state while its link moves; a plain click on it rejoins the link', () => {
  const links = view(memory(), 'page');
  links.click('a'); links.click('b'); links.cancel();
  const max = links.request('a', 'maximized', groups(['a'], ['b'], ['c']));
  assert.deepEqual(max.steps, [{ groupId: 'a', mode: 'maximized', side: 'link:a,b' }]);
  const alone = links.request('b', 'minimized', groups(['a'], ['b'], ['c', 'minimized']), { ctrl: true });
  assert.deepEqual(alone, { steps: [{ groupId: 'b', mode: 'minimized' }], announce: null });
  const back = links.request('a', 'normal', groups(['a'], ['b', 'minimized'], ['c', 'minimized']));
  assert.deepEqual(back.steps[0], { groupId: 'a', mode: 'normal', side: 'link:a|keep:b' }, 'the restore leaves B as you set it');
  assert.ok(!back.steps.some(step => step.groupId === 'b'));
  const rejoin = links.request('b', 'normal', groups(['a'], ['b', 'minimized'], ['c']));
  assert.deepEqual(rejoin.steps, [{ groupId: 'b', mode: 'normal' }], 'a plain click on B acts on the link again, B included');
});

test('links survive a reload: they are keyed by the page, not by the per-load layout binding', () => {
  const storage = memory();
  const before = view(storage, 'page-key'); before.click('a'); before.click('b'); before.cancel();
  const after = view(storage, 'page-key');
  assert.ok(after.linkOf('a')); assert.equal(after.linkOf('a'), after.linkOf('b'));
});

test('a removed group drops out of its link', () => {
  const links = view(memory(), 'page');
  links.click('a'); links.click('b'); links.click('c'); links.cancel();
  links.drop('a'); assert.equal(links.linkOf('a'), null); assert.equal(links.linkOf('b'), links.linkOf('c'));
  links.drop('b'); assert.equal(links.linkOf('c'), null, 'a link left with one group ends');
});

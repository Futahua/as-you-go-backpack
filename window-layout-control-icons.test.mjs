// 019F (RoketPuncha AYG lane): static tests for the exact six-icon control
// mapping and the taskbar-like member button markup. Pure string assertions on
// the shared builders - no DOM, no host, no globals.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WINDOW_LAYOUT_CONTROL_GLYPHS,
  WINDOW_LAYOUT_CONTROL_ORDER,
  windowLayoutControlGlyphMarkup,
  windowLayoutControlButton,
  windowLayoutMemberMarkup,
} from './public/app/window-layout-control-icons.js';

test('the six control actions map to six unique requested glyph shapes', () => {
  assert.deepEqual(WINDOW_LAYOUT_CONTROL_ORDER, ['pick', 'list', 'min-all', 'restore-all', 'isolate', 'detach']);
  assert.equal(WINDOW_LAYOUT_CONTROL_ORDER.length, new Set(WINDOW_LAYOUT_CONTROL_ORDER).size);
  const shapes = WINDOW_LAYOUT_CONTROL_ORDER.map((name) => WINDOW_LAYOUT_CONTROL_GLYPHS[name]);
  assert.ok(shapes.every((glyph) => glyph && typeof glyph.path === 'string' && glyph.path.length > 0), 'every control has a glyph');
  assert.equal(new Set(shapes.map((glyph) => glyph.path)).size, 6, 'all six shapes are unique');
});

test('each control maps to the exact requested shape', () => {
  // 1 cursor/pointer outline = Pick onscreen
  assert.match(WINDOW_LAYOUT_CONTROL_GLYPHS.pick.path, /^<path d="M6\.5 3\.5l/);
  // 2 outlined document/list with rows = List
  assert.match(WINDOW_LAYOUT_CONTROL_GLYPHS.list.path, /<rect x="6" y="3" width="12" height="18"/);
  assert.match(WINDOW_LAYOUT_CONTROL_GLYPHS.list.path, /stroke-linecap="round"/);
  // 3 horizontal minus = Minimize all
  assert.match(WINDOW_LAYOUT_CONTROL_GLYPHS['min-all'].path, /^<path d="M4 12h16"/);
  // 4 outlined square = Restore all
  assert.match(WINDOW_LAYOUT_CONTROL_GLYPHS['restore-all'].path, /<rect x="5" y="5" width="14" height="14"/);
  // 5 outlined circle = Isolate
  assert.match(WINDOW_LAYOUT_CONTROL_GLYPHS.isolate.path, /<circle cx="12" cy="12" r="7"/);
  // 6 unlocked padlock = Detach
  assert.match(WINDOW_LAYOUT_CONTROL_GLYPHS.detach.path, /<rect x="6" y="10\.5" width="12" height="10"/);
});

test('detach is an UNLOCKED padlock and reattach a LOCKED padlock', () => {
  const detach = WINDOW_LAYOUT_CONTROL_GLYPHS.detach.path;
  const reattach = WINDOW_LAYOUT_CONTROL_GLYPHS.reattach.path;
  assert.match(detach, /<rect x="6" y="10\.5" width="12" height="10"/, 'detach has the padlock body');
  assert.match(reattach, /<rect x="6" y="10\.5" width="12" height="10"/, 'reattach has the padlock body');
  // Unlocked: the shackle's right leg stops OPEN above the body.
  assert.doesNotMatch(detach, /v3/, 'detach shackle is open (unlocked)');
  // Locked: the shackle's right leg latches DOWN into the body.
  assert.match(reattach, /v3/, 'reattach shackle is latched (locked)');
  assert.notEqual(detach, reattach);
});

test('no old square or split-panel glyphs remain', () => {
  const oldMarkers = [
    'M4 4h16v16H4z', // old pick frame
    'M9 9v6h6v-6z', // old pick inner square
    'M5 5h14v14H5z', // old detach square
    'M7 7h10v10H7z', // old reattach square
    'M12 12l5-5', // old reattach split diagonal
    'M4 4l7 8-7 8z', // old isolate V
    'M12 4h8v16h-8z', // old isolate split panel
    'M5 5h14v3H5z', // old min-all bar
    'M9 12h6', // old detach split line
  ];
  const all = Object.values(WINDOW_LAYOUT_CONTROL_GLYPHS).map((glyph) => glyph.path).join('|');
  for (const marker of oldMarkers) {
    assert.ok(!all.includes(marker), `old square/split-panel marker must not remain: ${marker}`);
  }
});

test('control buttons keep exact title/aria-label semantics and data attributes', () => {
  const button = windowLayoutControlButton('min-all', 'Minimize all members', 'data-wl-min-all', 'L1');
  assert.ok(button.includes('title="Minimize all members"'), 'native title preserved');
  assert.ok(button.includes('aria-label="Minimize all members"'), 'aria-label preserved');
  assert.ok(button.includes('data-wl-min-all="L1"'), 'behavior data attribute preserved');
  assert.ok(button.includes('class="window-layout-control wl-min-all"'), 'behavior class preserved');
  assert.ok(button.includes('data-wl-glyph="min-all"'), 'stable semantic glyph identifier present');
  assert.ok(button.includes('type="button"'), 'button type preserved');
});

test('the six control buttons render in the exact left-to-right order with distinct identifiers', () => {
  const labels = {
    pick: 'Pick an onscreen window directly',
    list: 'Choose from the list of onscreen windows',
    'min-all': 'Minimize all members',
    'restore-all': 'Restore/open all members',
    isolate: 'Restore the selected members and minimize the rest of this layout',
    detach: 'Open this layout as a compact widget',
  };
  const html = WINDOW_LAYOUT_CONTROL_ORDER.map((name) => windowLayoutControlButton(name, labels[name], `data-wl-${name}`, 'L1')).join('');
  const order = WINDOW_LAYOUT_CONTROL_ORDER;
  for (let index = 0; index < order.length; index += 1) {
    const name = order[index];
    assert.ok(html.includes(`data-wl-glyph="${name}"`), `${name} glyph identifier present`);
    assert.ok(html.includes(`aria-label="${labels[name]}"`), `${name} label correct`);
    if (index > 0) {
      const prev = order[index - 1];
      assert.ok(
        html.indexOf(`data-wl-glyph="${name}"`) > html.indexOf(`data-wl-glyph="${prev}"`),
        `${name} follows ${prev} left-to-right`,
      );
    }
  }
});

test('member markup: bottom indicator, accessible name, centered icon, no duplicate tooltip', () => {
  const member = { id: 'm1', descriptor: { title: 'Notepad' }, state: 'normal' };
  const html = windowLayoutMemberMarkup('L1', member, 'data:icon');
  assert.ok(!html.includes(' title='), 'native tooltip is omitted because the preview already displays the name');
  assert.ok(html.includes('aria-label="Notepad"'), 'aria-label carries the full name');
  assert.ok(html.includes('aria-pressed="false"'), 'normal state is not pressed');
  assert.ok(html.includes('aria-selected="false"'), 'not selected by default');
  assert.ok(html.includes('data-wl-member-state="normal"'), 'stable indicator identifier reflects the known state');
  assert.ok(html.includes('<img class="window-layout-member-icon" src="data:icon"'), 'native artwork is an unfiltered img');
  assert.ok(html.includes('<span class="window-layout-member-state normal"'), 'the running indicator span is present');
  assert.ok(!/<span[^>]*class="[^"]*window-layout-member-label/.test(html), 'no text label inside the strip');
  assert.ok(html.includes('</button>'), 'one compact hit target');

  const minimized = windowLayoutMemberMarkup('L1', { ...member, state: 'minimized' }, null);
  assert.ok(minimized.includes('aria-pressed="true"'), 'minimized state is pressed');
  assert.ok(!minimized.includes('data-wl-member-state="minimized"'), 'minimized members omit the running indicator');
  assert.ok(minimized.includes('class="window-layout-member-icon placeholder"'), 'placeholder when no icon');
  assert.ok(!minimized.includes('window-layout-member-state'), 'minimized members have no running bar');
});

test('member markup handles missing descriptors without throwing', () => {
  const html = windowLayoutMemberMarkup('L1', { id: 'm9', title: 'Fallback' });
  assert.ok(html.includes('aria-label="Fallback"'), 'falls back to the member title');
});

test('035: a placeholder member is the same compact button, marked inert (disabled)', () => {
  const member = { id: 'm1', descriptor: { title: 'Notepad' }, state: 'normal' };
  const html = windowLayoutMemberMarkup('L1', member, 'data:icon', true);
  assert.ok(html.includes(' disabled>'), 'the placeholder member is disabled/inert');
  assert.ok(html.includes('class="window-layout-member normal"'), 'same taskbar-like look');
  assert.ok(html.includes('data-wl-member="m1"'), 'same stable identity for parity');
  const live = windowLayoutMemberMarkup('L1', member, 'data:icon');
  assert.ok(!live.includes(' disabled'), 'a live member is never disabled');
});

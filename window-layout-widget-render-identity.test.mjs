// Creator eye test, detached widget: hovering the member icons made EVERY icon
// flicker at once and swallowed clicks, while the widget window itself never
// moved. Simultaneous whole-strip flicker is the signature of the card DOM
// being replaced wholesale (renderWidgetCard assigns elements.grid.innerHTML),
// not of a per-element hover transition.
//
// Two defects produced it together:
//   1. the compact widget page constructs the WORKSPACE-side responder too, so
//      it answered its own snapshot-request out of a state that never loaded a
//      layout -> `unknown-layout` -> the widget's bounded retry re-armed and
//      requested again, endlessly;
//   2. every workspace responder owns a PRIVATE revision map starting at 0, so
//      two live workspace surfaces answer the same request with different
//      revisions for identical content. The widget's guard compared revisions
//      only, so r=3, r=0, r=3, r=0 rebuilt the card every single time.
//
// These tests pin the render-identity rule that makes duplicate snapshots inert
// while keeping genuinely-changed same-revision content live.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  windowLayoutWidgetRenderIdentity,
  windowLayoutWidgetSnapshot,
} from './public/app/window-layout-widget-channel.js';

// The snapshot omits members whose descriptor fails validation, so the
// fingerprint has to be a real 64-hex digest, not a readable stand-in.
const fingerprint = (seed) => seed.toLowerCase().padEnd(64, '0').slice(0, 64).replace(/[^a-f0-9]/g, '0');
const descriptor = (title) => ({ version: 1, title, executableFingerprint: fingerprint(title) });

function layout(members, cardSize = null) {
  return {
    id: 'layout-1',
    name: 'Layout One',
    cardSize,
    arrangement: {
      version: 2,
      members: members.map(([id, title, state]) => ({ id, descriptor: descriptor(title), state })),
    },
  };
}

const BASE = layout([['m1', 'Alpha', 'normal'], ['m2', 'Beta', 'normal']]);

test('identical snapshots share a render identity whatever revision carried them', () => {
  const a = windowLayoutWidgetSnapshot(BASE);
  const b = windowLayoutWidgetSnapshot(BASE);
  assert.equal(windowLayoutWidgetRenderIdentity(a), windowLayoutWidgetRenderIdentity(b));
});

test('the alternating-revision storm never changes render identity', () => {
  // The exact creator-facing sequence: two workspace responders, divergent
  // private revision counters, identical content. Under the old revision-only
  // guard every one of these rebuilt the card and destroyed the hovered button.
  const identities = [4, 0, 4, 0, 4].map(() =>
    windowLayoutWidgetRenderIdentity(windowLayoutWidgetSnapshot(BASE)));
  assert.equal(new Set(identities).size, 1);
});

test('cardSize alone is not render identity: persisted geometry must not rebuild the card', () => {
  const small = windowLayoutWidgetSnapshot(layout([['m1', 'Alpha', 'normal']], { width: 160, height: 90 }));
  const large = windowLayoutWidgetSnapshot(layout([['m1', 'Alpha', 'normal']], { width: 280, height: 140 }));
  assert.notDeepEqual(small.cardSize, large.cardSize);
  assert.equal(windowLayoutWidgetRenderIdentity(small), windowLayoutWidgetRenderIdentity(large));
});

test('appearance alone is not render identity', () => {
  const base = windowLayoutWidgetSnapshot(BASE);
  const themed = { ...base, appearance: { theme: 'dark', backdropOpacity: 0.4 } };
  assert.equal(windowLayoutWidgetRenderIdentity(base), windowLayoutWidgetRenderIdentity(themed));
});

test('a member state change IS render identity', () => {
  const before = windowLayoutWidgetSnapshot(BASE);
  const after = windowLayoutWidgetSnapshot(layout([['m1', 'Alpha', 'minimized'], ['m2', 'Beta', 'normal']]));
  assert.notEqual(windowLayoutWidgetRenderIdentity(before), windowLayoutWidgetRenderIdentity(after));
});

test('member order IS render identity', () => {
  const before = windowLayoutWidgetSnapshot(BASE);
  const after = windowLayoutWidgetSnapshot(layout([['m2', 'Beta', 'normal'], ['m1', 'Alpha', 'normal']]));
  assert.notEqual(windowLayoutWidgetRenderIdentity(before), windowLayoutWidgetRenderIdentity(after));
});

test('membership and layout name are render identity', () => {
  const before = windowLayoutWidgetSnapshot(BASE);
  const added = windowLayoutWidgetSnapshot(
    layout([['m1', 'Alpha', 'normal'], ['m2', 'Beta', 'normal'], ['m3', 'Gamma', 'normal']]));
  assert.notEqual(windowLayoutWidgetRenderIdentity(before), windowLayoutWidgetRenderIdentity(added));

  const renamed = windowLayoutWidgetSnapshot({ ...BASE, name: 'Layout Two' });
  assert.notEqual(windowLayoutWidgetRenderIdentity(before), windowLayoutWidgetRenderIdentity(renamed));
});

test('a newly hydrated icon IS render identity even at an equal revision', () => {
  // broadcast() deliberately re-sends resolved member icons WITHOUT bumping the
  // revision, so equal-revision snapshots can carry real new content. A guard
  // that keyed on revision would drop this and leave the placeholder forever.
  const withoutIcon = windowLayoutWidgetSnapshot(BASE);
  const withIcon = windowLayoutWidgetSnapshot(BASE, (_layoutId, memberId) =>
    (memberId === 'm1' ? 'data:image/png;base64,AAAA' : null));
  assert.equal(withoutIcon.members[0].icon, null);
  assert.equal(withIcon.members[0].icon, 'data:image/png;base64,AAAA');
  assert.notEqual(windowLayoutWidgetRenderIdentity(withoutIcon), windowLayoutWidgetRenderIdentity(withIcon));
});

test('render identity is stable under repeated evaluation of one snapshot', () => {
  const snapshot = windowLayoutWidgetSnapshot(BASE);
  assert.equal(windowLayoutWidgetRenderIdentity(snapshot), windowLayoutWidgetRenderIdentity(snapshot));
});

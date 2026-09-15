// Settings has one obvious top-level way in, and it is a word rather than a pictogram.
//
// The evidence behind this file is the creator's own: they asked for a hotkey setting that had been in the
// dialog all along, reachable only by right-clicking an unlabelled copy icon. The destination existed and
// the route did not. So the route is asserted here - that a control labelled Settings sits at top level in
// the toolbar, that its label is visible text rather than sr-only, and that it opens the existing dialog
// directly on the Settings tab instead of going through the copy button's own decision.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const markup = await readFile(new URL('./public/workspace-20260730b.html', import.meta.url), 'utf8');
const entry = await readFile(new URL('./public/workspace-20260730b.js', import.meta.url), 'utf8');

/** The markup of one element, from its opening tag to the matching close of a same-named tag. */
function elementFor(id) {
  const at = markup.indexOf(`id="${id}"`);
  if (at === -1) return '';
  const open = markup.lastIndexOf('<button', at);
  const close = markup.indexOf('</button>', at);
  return open === -1 || close === -1 ? '' : markup.slice(open, close + 9);
}

test('a Settings control exists at top level, beside the copy affordance', () => {
  const button = elementFor('open-settings');
  assert.notEqual(button, '', 'the toolbar carries a control with id "open-settings"');
  // "Beside it", literally: the same toolbar shell, so it moves with that float and needs no second keyed
  // toolbar position. The shell is the element the toolbar controller persists a position for.
  const shell = markup.indexOf('data-toolbar-key="copy-prompt"');
  const copyButton = markup.indexOf('id="copy-prompt"');
  const settingsButton = markup.indexOf('id="open-settings"');
  assert.ok(shell !== -1 && copyButton !== -1 && settingsButton !== -1);
  assert.ok(settingsButton > copyButton, 'the new control follows the copy button in the same shell');
  const shellEnd = markup.indexOf('</div>', shell);
  assert.ok(settingsButton < shellEnd, 'and it is inside that shell rather than a float of its own');
});

test('the label says Settings in visible text, not only to a screen reader', () => {
  const button = elementFor('open-settings');
  // The failure being fixed is a hunt: the creator went looking for a setting that existed. An icon with an
  // sr-only label would leave that hunt exactly where it was for a sighted reader.
  assert.match(button, /<span class="button-label">Settings<\/span>/, 'the word is rendered');
  assert.equal(/sr-only[^>]*>Settings</.test(button), false, 'and it is not hidden');
  assert.match(button, /title="Settings"/, 'the tooltip agrees with the label');
  assert.match(button, /<svg[^>]*aria-hidden="true"/, 'the pictogram is decoration beside the word, not the label');
});

test('it opens the existing dialog on the Settings tab, not through the copy button', () => {
  const at = entry.indexOf("document.querySelector('#open-settings')");
  assert.notEqual(at, '', 'the entry wires the control');
  const handler = entry.slice(at, entry.indexOf('});', at));
  assert.match(handler, /promptLibrary\.open\(\)/, 'it calls the dialog open() directly');
  assert.match(handler, /promptLibrary\.setActivePage\('hotkeys'\)/, 'and lands on the Settings tab');
  // The route it must NOT take is the copy button's, which copies whenever there is a batch to copy and
  // only opens the dialog when there is nothing - the explained reason the dialog looked unreliable.
  assert.equal(
    handler.includes('resolveCopierAction'),
    false,
    'the Settings route does not depend on the copy/open decision, which is the entry-point gap this closes',
  );
});

test('the copy affordance was not renamed into something vague', () => {
  // The reviewer ruled this out by name. "Library & Settings" would be the same hunt with a longer sign.
  assert.equal(markup.includes('Library &amp; Settings'), false);
  assert.equal(markup.includes('Library & Settings'), false);
  const copyButton = elementFor('copy-prompt');
  assert.match(copyButton, /title="Copy agent pickup prompt"/, 'the copy button still says what it does');
});

test('there is exactly one top-level Settings control', () => {
  const matches = [...markup.matchAll(/>\s*Settings\s*</g)].map((match) => match[0]);
  // The dialog's own tab is a second one, inside the dialog, and that is the point: one way IN from the
  // workspace, and the tab it lands on. Two top-level entries would be the second settings product the
  // reviewer ruled out.
  const topLevel = [...markup.matchAll(/<button[^>]*id="open-settings"[^>]*>/g)];
  assert.equal(topLevel.length, 1, 'one control, one id');
  assert.ok(matches.length <= 2, `the workspace markup names Settings at most twice (found ${matches.length})`);
});

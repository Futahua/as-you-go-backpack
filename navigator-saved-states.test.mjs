import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { decodeNavigatorSavedStates } from './public/app/navigator-saved-states.js';

test('saved navigator state decoder keeps only bounded semantic state kinds', () => {
  assert.deepEqual(decodeNavigatorSavedStates(JSON.stringify([
    { mode: 'ayg', name: 'Home' },
    { mode: 'machine', name: 'Files' },
    { mode: 'action', name: 'Wikipedia' },
    { mode: 'bogus', name: 'Nope' },
    null,
  ])), [
    { mode: 'ayg', name: 'Home' },
    { mode: 'machine', name: 'Files' },
    { mode: 'action', name: 'Wikipedia' },
  ]);
  assert.deepEqual(decodeNavigatorSavedStates('{broken'), []);
});

test('saved navigator states synchronize open tabs and require two clicks to clear all', async () => {
  const source = await readFile(new URL('./public/app/navigator-saved-states.js', import.meta.url), 'utf8');
  assert.match(source, /addEventListener\?\.\('storage'/);
  assert.match(source, /BroadcastChannel\('papers:ayg:navigator-saved-states-v1'\)/);
  assert.match(source, /if \(!clearArmed\)[\s\S]*classList\.add\('armed'\)[\s\S]*states = \[\]/);
  assert.match(source, /persistStates\(\);[\s\S]*render\(\);/);
});

test('navigator keeps the height grip invisible and toolbar controls present', async () => {
  const [css, source] = await Promise.all([
    readFile(new URL('./public/styles/navigator.css', import.meta.url), 'utf8'),
    readFile(new URL('./public/app/workspace-navigator.js', import.meta.url), 'utf8'),
  ]);
  assert.match(css, /\.navigator-pills-height-grip\{[^}]*background:transparent/);
  assert.match(css, /\.navigator-saved-clear\{[^}]*opacity:0/);
  assert.match(css, /\.navigator-saved-clear\.armed\{[^}]*#9f3434/);
  assert.doesNotMatch(source, /back\.hidden = fwd\.hidden = up\.hidden = home\.hidden = !nav/);
  assert.doesNotMatch(source, /saveState\.remove\(\)/);
  assert.doesNotMatch(source, /Save current navigation/);
});
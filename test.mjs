import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => readFile(path.join(root, name), 'utf8');

test('the local project owns its exact interface, pickup prompt and prepared actions', async () => {
  const [manifest, actions, html, script] = await Promise.all([
    read('project.json').then(JSON.parse),
    read('actions.json').then(JSON.parse),
    read('public/index.html'),
    read('public/app.js'),
  ]);

  assert.equal(manifest.backpackId, 'bp-4c43caab-6fc6-44e9-ab87-25b291d1cc0d');
  assert.equal(manifest.entry, 'public/index.html');
  assert.deepEqual(
    actions.actions.map(({ id }) => id),
    ['clips', 'sloptop-mode', 'slop-engine', 'usb'],
  );
  assert.match(html, /Copy agent pickup prompt/);
  assert.match(html, /Navigate groups/);
  assert.match(script, /New folder/);
  assert.match(script, /Add shortcut/);
  assert.match(script, /Paste moved items/);
  assert.match(script, /Paste copied items/);
  assert.match(html, /icon-grid/);
  assert.match(html, /data-context-menu/);
  assert.match(html, /data-bin-view/);
  assert.match(html, /icon-grid/);
  assert.doesNotMatch(html, /Your prepared shortcuts on this machine/);
  assert.match(script, /papers:project:as-you-go-pick-target/);
  assert.match(script, /papers:project:as-you-go-shortcut-icon/);
  assert.match(script, /papers:project:as-you-go-save/);
  assert.match(script, /ctrlKey.*deltaY|deltaY.*ctrlKey/s);
  assert.match(script, /keydown/);
  assert.match(script, /dblclick/);
  assert.match(script, /dragstart/);
  assert.match(script, /closest\(['"]\[data-blank-parent\]['"]\)/);
  assert.match(script, /iconCache\.delete/);
  assert.match(script, /binMode.*(?:ctrlKey|clipboard)|(?:ctrlKey|clipboard).*binMode/s);
  assert.match(html, /Use target icon/);
  assert.doesNotMatch(script, /description \|\| ['"]Shortcut['"]/);
  assert.match(script, /Backpack interfaces, behavior, and implementation belong outside Papers/);
  assert.match(script, /My request:\r?\n\[Describe what you want to experience\.\]/);

  for (const action of actions.actions) {
    assert.equal(path.isAbsolute(action.target), true);
    await access(action.target);
  }
});

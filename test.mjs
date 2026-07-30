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
  assert.match(html, /New group/);
  assert.match(html, /Add shortcut/);
  assert.match(html, /Move here/);
  assert.match(html, /Copy here/);
  assert.match(html, /explorer-list/);
  assert.match(script, /papers:project:as-you-go-pick-target/);
  assert.match(script, /papers:project:as-you-go-save/);
  assert.match(script, /Backpack interfaces, behavior, and implementation belong outside Papers/);
  assert.match(script, /My request:\r?\n\[Describe what you want to experience\.\]/);

  for (const action of actions.actions) {
    assert.equal(path.isAbsolute(action.target), true);
    await access(action.target);
  }
});

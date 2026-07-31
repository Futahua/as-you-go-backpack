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
    read('public/workspace-20260730b.html'),
    read('public/workspace-20260730b.js'),
  ]);

  assert.equal(manifest.backpackId, 'bp-4c43caab-6fc6-44e9-ab87-25b291d1cc0d');
  assert.equal(manifest.entry, 'public/workspace-20260730b.html');
  assert.deepEqual(
    actions.actions.map(({ id }) => id),
    ['clips', 'sloptop-mode', 'slop-engine', 'usb'],
  );
  assert.match(html, /Copy agent pickup prompt/);
  assert.match(html, /workspace-20260730b\.js/);
  assert.doesNotMatch(html, /class="identity"/);
  assert.doesNotMatch(html, /Navigate groups/);
  assert.doesNotMatch(html, /id="location-select"/);
  assert.match(script, /New folder/);
  assert.match(script, /Add shortcut/);
  assert.match(script, /Add web link/);
  assert.match(script, /papers:project:open-web-link/);
  assert.match(script, /papers:project:resolve-dropped-targets/);
  assert.match(script, /dataTransfer\.files/);
  assert.match(script, /Paste moved items/);
  assert.match(script, /Paste copied items/);
  assert.match(html, /icon-grid/);
  assert.match(html, /data-context-menu/);
  assert.match(html, /data-bin-view/);
  assert.match(html, /id="delete-all-bin"/);
  assert.match(html, /icon-grid/);
  assert.doesNotMatch(html, /Your prepared shortcuts on this machine/);
  assert.match(script, /papers:project:as-you-go-pick-target/);
  assert.match(script, /papers:project:as-you-go-shortcut-icon/);
  assert.match(script, /Use folder icon/);
  assert.match(script, /updateGroup/);
  assert.match(script, /createImageBitmap/);
  assert.match(script, /canvas\.toBlob/);
  assert.doesNotMatch(script, /That icon image is too large/);
  assert.doesNotMatch(script, /setStatus\(success\)/);
  assert.match(script, /Edit folder/);
  assert.doesNotMatch(script, /Rename folder/);
  assert.match(script, /papers:project:as-you-go-save/);
  assert.match(script, /ctrlKey.*deltaY|deltaY.*ctrlKey/s);
  assert.match(script, /keydown/);
  assert.match(script, /saveButton\.addEventListener\(['"]click['"]/);
  assert.match(html, /id="save-editor" type="button"/);
  assert.match(script, /dblclick/);
  assert.match(script, /contextmenu/);
  assert.match(script, /dragstart/);
  assert.match(script, /pointerdown/);
  assert.match(script, /pointermove/);
  assert.match(script, /selection-marquee/);
  assert.match(script, /workspace-model-20260730b\.js/);
  assert.match(script, /closest\(['"]\[data-blank-parent\]['"]\)/);
  assert.match(script, /iconCache\.delete/);
  assert.match(script, /binMode.*(?:ctrlKey|clipboard)|(?:ctrlKey|clipboard).*binMode/s);
  assert.match(script, /Delete all \$\{ids\.length\} items permanently/);
  assert.match(html, /Use target icon/);
  assert.doesNotMatch(script, /description \|\| ['"]Shortcut['"]/);
assert.match(script, /Backpack interfaces, behavior, and implementation belong outside Papers/);
assert.match(script, /My request:\r?\n\[Describe what you want to experience\.\]/);
assert.match(html, /id="graph-view-button"/);
assert.match(html, /id="graph-label"/);
assert.match(html, /data-view="explorer"/);
assert.match(script, /renderGraph/);
assert.match(script, /layout === 'graph'/);
assert.match(script, /state\.view\.layout/);
assert.match(script, /graph-model-20260730b\.js/);
assert.match(script, /vendor\/d3-force\.js/);
assert.match(script, /vendor\/d3-zoom\.js/);
assert.match(script, /vendor\/d3-selection\.js/);
assert.match(script, /ResizeObserver/);
assert.match(script, /fitGraph/);
assert.match(script, /translate3d/);
assert.match(script, /prefers-reduced-motion/);
assert.match(script, /createGraphView/);
assert.match(script, /destroyGraphView/);
assert.match(script, /updateGraphView/);
assert.match(script, /graph-node-shell/);
assert.match(script, /graph-viewport/);
assert.match(script, /graph-camera/);
assert.match(script, /dataset\.view/);
assert.match(script, /select\(viewport\)/);
assert.match(script, /\.call\(zoomBehavior\)/);
assert.match(script, /viewportSelection\.transition\(\)/);
assert.match(script, /buildCandidate/);
assert.match(script, /siblings\.findIndex/);
assert.match(script, /exitTimer/);
assert.match(script, /edges\.get\(/);
assert.match(script, /node\.exitTimer/);

  for (const action of actions.actions) {
    assert.equal(path.isAbsolute(action.target), true);
    await access(action.target);
  }
});

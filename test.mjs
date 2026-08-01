import assert from 'node:assert/strict';
import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => readFile(path.join(root, name), 'utf8');

/** Recursively collects every .js file under the public/ directory. */
async function listPublicJsFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await listPublicJsFiles(full));
    else if (entry.name.endsWith('.js')) files.push(full);
  }
  return files;
}

test('the local project owns its exact interface, pickup prompt and prepared actions', async () => {
  const [manifest, actions, html] = await Promise.all([
    read('project.json').then(JSON.parse),
    read('actions.json').then(JSON.parse),
    read('public/workspace-20260730b.html'),
  ]);

  // Entry-point contract: the manifest points at the static HTML entry.
  assert.equal(manifest.backpackId, 'bp-4c43caab-6fc6-44e9-ab87-25b291d1cc0d');
  assert.equal(manifest.entry, 'public/workspace-20260730b.html');

  // Prepared actions: exact stable set, and each target must resolve here.
  assert.deepEqual(
    actions.actions.map(({ id }) => id),
    ['clips', 'sloptop-mode', 'slop-engine', 'usb'],
  );
  for (const action of actions.actions) {
    assert.equal(path.isAbsolute(action.target), true);
    await access(action.target);
  }

  // Security boundary: a Content-Security-Policy that forbids inline and
  // remote scripts, and script/style references that stay local.
  const csp = html.match(/<meta http-equiv="Content-Security-Policy"[^>]*content="([^"]*)"/i);
  assert.ok(csp, 'a Content-Security-Policy meta tag is required');
  assert.match(csp[1], /script-src\s+'self'/i);
  assert.doesNotMatch(csp[1], /'unsafe-inline'|'unsafe-eval'/i);
  assert.match(html, /<script type="module" src="workspace-20260730b\.js"><\/script>/);
  assert.match(html, /<link rel="stylesheet" href="workspace-20260730b\.css" \/>/);
  assert.doesNotMatch(html, /<(script|link)[^>]+(src|href)="https?:/i);

  // Accessibility landmarks and the interactive surfaces the app drives.
  assert.match(html, /id="icon-grid"/);
  assert.match(html, /aria-label="Items in this folder"/);
  assert.match(html, /data-view="graph"/);
  assert.match(html, /data-context-menu/);
  assert.match(html, /data-bin-view/);
  assert.match(html, /id="delete-all-bin"/);
  assert.match(html, /id="restore-all-bin"/);
  assert.match(html, /id="save-editor"/);
  assert.match(html, /role="alertdialog"/);
  assert.match(html, /id="link-edit-layer"/);
  assert.match(html, /id="confirm-restore"/);
  assert.match(html, /toolbar-float/);
  assert.match(html, /icon-button/);

  // Required host protocol names must be present in the shipped JS — they
  // may move between modules as the workspace is split up, so scan the whole
  // public/ tree rather than pinning any single file.
  const jsFiles = await listPublicJsFiles(path.join(root, 'public'));
  const allJs = (await Promise.all(jsFiles.map((file) => readFile(file, 'utf8')))).join('\n');
  for (const protocol of [
    'papers:project:as-you-go-load',
    'papers:project:as-you-go-save',
    'papers:project:as-you-go-launch',
    'papers:project:as-you-go-reveal',
    'papers:project:as-you-go-pick-target',
    'papers:project:as-you-go-shortcut-icon',
    'papers:project:resolve-web-link-icon',
    'papers:project:resolve-dropped-targets',
    'papers:project:open-web-link',
  ]) {
    assert.ok(allJs.includes(protocol), `missing host protocol: ${protocol}`);
  }

  // The agent pickup prompt stays part of this project's interface.
  assert.match(allJs, /Backpack interfaces, behavior, and implementation belong outside Papers/);
  assert.match(allJs, /My request:\r?\n\[Describe what you want to experience\.\]/);
});

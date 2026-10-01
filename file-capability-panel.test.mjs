import assert from 'node:assert/strict';
import test from 'node:test';

import { isAbsoluteWindowsPath } from './public/app/file-capability-panel.js';

test('file capability accepts drive and UNC paths but rejects web and relative targets', () => {
  assert.equal(isAbsoluteWindowsPath('C:\\Users\\me\\file.txt'), true);
  assert.equal(isAbsoluteWindowsPath('D:/School/model.dwg'), true);
  assert.equal(isAbsoluteWindowsPath('\\\\server\\share\\file.pdf'), true);
  assert.equal(isAbsoluteWindowsPath('https://example.com/file.pdf'), false);
  assert.equal(isAbsoluteWindowsPath('relative\\file.txt'), false);
  assert.equal(isAbsoluteWindowsPath(''), false);
});

test('file preview is a collapsed/expanded dock with a draggable width and no fake file-manager UI', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('./public/app/file-capability-panel.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('./public/styles/file-capability.css', import.meta.url), 'utf8');
  const workspace = await readFile(new URL('./public/workspace-20260730b.js', import.meta.url), 'utf8');
  const html = await readFile(new URL('./public/workspace-20260730b.html', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /setOpen\(/, 'selection must never open/reposition a panel during pointerdown');
  assert.doesNotMatch(source, /file-capability-launcher/, 'the old floating launcher is gone');
  assert.match(source, /panel\.append\(resizer, header, body\)/);
  assert.match(source, /inspector\.append\(itemTitle, itemMeta, pathRow, preview\)/);
  assert.match(source, /file-capability-resizer/);
  assert.match(source, /setPointerCapture/);
  assert.match(source, /setPanelWidth\(viewportWidth - event\.clientX - 8\)/);
  assert.match(source, /setButtonSvg\(documentRef, copyPathButton, 'Copy path'/);
  assert.match(source, /setButtonSvg\(documentRef, revealButton, 'Reveal in file manager'/);
  assert.match(source, /No visual preview available yet\./);
  assert.match(source, /Folder navigation stays in your file manager\./);
  assert.match(source, /Multiple preview will take shape here\./);
  assert.match(css, /\.file-capability-panel \{[\s\S]*width: 38px/);
  assert.match(css, /\.file-capability-panel\.expanded \{[\s\S]*var\(--file-capability-width/);
  assert.match(css, /\.workspace\.file-capability-docked \.explorer \{[\s\S]*right: 46px/);
  assert.match(css, /file-capability-expanded \.explorer \{[\s\S]*right: calc\(var\(--file-capability-width/);
  assert.match(workspace, /mode: 'single'/);
  assert.match(workspace, /mode: 'multiple'/);
  assert.match(html, /img-src 'self' data: blob: papers-file-preview: https: http:/);
  assert.match(html, /media-src papers-file-preview: blob:/);
  assert.match(html, /frame-src papers-file-preview: blob:/);
});

test('file capability panel source keeps destructive retargeting verification-bound', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('./public/app/file-capability-panel.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('./public/styles/file-capability.css', import.meta.url), 'utf8');
  assert.match(source, /waitForPathState\(host, \{ present: expectedPath, absent: oldPath \}\)/);
  assert.match(source, /retargetShortcut\(\{[\s\S]*oldPath,[\s\S]*newPath: expectedPath/);
  assert.match(source, /fileCapability\('delete', \{ paths: \[target\] \}\)/);
  assert.match(source, /Moved to Recycle Bin\. The AYG reference was kept\./);
  assert.match(source, /URL\.createObjectURL\(new Blob/);
  assert.match(source, /URL\.revokeObjectURL\(state\.previewObjectUrl\)/);
  assert.match(source, /fileCapability\('preview-release', \{ resourceId \}\)/);
  assert.match(source, /parsed\.protocol === 'papers-file-preview:'/);
  assert.match(source, /fileCapability\('preview-text-chunk'/);
  assert.match(source, /media\.preload = 'metadata'/);
  assert.match(source, /fileCapability\('preview-native-open'/);
  assert.match(source, /fileCapability\('preview-native-move'/);
  assert.match(source, /fileCapability\('preview-native-close'/);
  assert.match(source, /ResizeObserver/);
  assert.match(css, /\.file-capability-text-scroller/);
  assert.match(css, /\.file-capability-native-preview/);
  assert.doesNotMatch(source, /frame\.src = data\.dataUrl/);
});

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

test('file capability panel source keeps destructive retargeting verification-bound', async () => {
  const source = await import('node:fs/promises').then(({ readFile }) =>
    readFile(new URL('./public/app/file-capability-panel.js', import.meta.url), 'utf8'));
  assert.match(source, /waitForPathState\(host, \{ present: expectedPath, absent: oldPath \}\)/);
  assert.match(source, /retargetShortcut\(\{[\s\S]*oldPath,[\s\S]*newPath: expectedPath/);
  assert.match(source, /fileCapability\('delete', \{ paths: \[target\] \}\)/);
  assert.match(source, /Moved to Recycle Bin\. The AYG reference was kept\./);
  assert.match(source, /URL\.createObjectURL\(new Blob/);
  assert.match(source, /URL\.revokeObjectURL\(state\.previewObjectUrl\)/);
  assert.doesNotMatch(source, /frame\.src = data\.dataUrl/);
});

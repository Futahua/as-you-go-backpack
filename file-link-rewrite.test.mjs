import test from 'node:test';
import assert from 'node:assert/strict';
import { movedPath, rewriteMovedFileLinks, repairBrokenFileLinks } from './public/app/file-link-rewrite.js';
import { followNavigatorRename } from './public/app/navigator-file-transfer.js';
import { createFileTargets, createFileTargetHost } from './public/app/file-targets.js';

const B5 = 'B5 TRẦN VÀ SÀN-20261005_180141-Meeting Recording.mp4';
const B7 = 'B7 THANG-20261012_61314\u202fpm-Meeting Recording.mp4';
const link = (id, target, extra = {}) => ({ id, name: target.split('\\').pop(), description: '', target, placements: [{ id: 'p-' + id, parentId: 'root', order: 0 }], ...extra });

test('movedPath covers the exact path and descendants, case- and separator-insensitively, and nothing else', () => {
  const moves = [{ oldPath: 'D:\\sort\\24K6 - LTKTCN', newPath: 'D:\\sort\\Oct 24 2026\\24K6 - LTKTCN' }];
  assert.equal(movedPath('D:\\sort\\24K6 - LTKTCN', moves), 'D:\\sort\\Oct 24 2026\\24K6 - LTKTCN');
  assert.equal(movedPath('d:/SORT/24k6 - ltktcn/BIỆN ANH QUÂN/a.pptx', moves), 'D:\\sort\\Oct 24 2026\\24K6 - LTKTCN\\BIỆN ANH QUÂN\\a.pptx');
  assert.equal(movedPath('D:\\sort\\24K6 - LTKTCN-20260922T110520Z-1-001.zip', moves), null, 'a sibling sharing a prefix is not inside the folder');
  assert.equal(movedPath('D:\\sort', moves), null);
  assert.equal(movedPath(42, moves), null);
  // The most specific move wins when a folder and something inside it both moved.
  const nested = [{ oldPath: 'D:\\a', newPath: 'D:\\b' }, { oldPath: 'D:\\a\\x.txt', newPath: 'E:\\x.txt' }];
  assert.equal(movedPath('D:\\a\\x.txt', nested), 'E:\\x.txt');
  assert.equal(movedPath('D:\\a\\y.txt', nested), 'D:\\b\\y.txt');
});

test('one rewrite moves every reference: files, descendants of a moved folder, pills and pinned previews; names stay authored', () => {
  const state = {
    schemaVersion: 1,
    groups: [],
    shortcuts: [
      link('b5', 'D:\\sort\\' + B5),
      link('b7', 'D:\\sort\\' + B7, { name: 'B7 THANG (renamed by me)' }),
      link('folder', 'D:\\sort\\24K6 - LTKTCN'),
      link('inside', 'D:\\sort\\24K6 - LTKTCN\\BIỆN ANH QUÂN-2451010321\\LTKTCTCN.pptx', { fileTarget: { id: 'id-1', status: 'present', revision: 1 } }),
      link('other', 'D:\\sort\\Documents\\Baitap3.rvt'),
      link('web', 'https://example.com/D:\\sort'),
    ],
    view: { preferences: {
      navigatorSavedStates: [{ path: 'D:\\sort\\24K6 - LTKTCN', machineRoot: 'D:\\sort\\24K6 - LTKTCN', art: { target: 'D:\\sort\\24K6 - LTKTCN' } }, { path: 'D:\\sort', machineRoot: 'D:\\sort' }],
      paneLayouts: { root: { pinned: [{ path: 'D:\\sort\\' + B5 }, { path: 'D:\\sort\\24K6 - LTKTCN\\BIỆN ANH QUÂN-2451010321\\LTKTCTCN.pptx' }] } },
    } },
  };
  const before = JSON.stringify(state);
  const moves = [
    { oldPath: 'D:\\sort\\' + B5, newPath: 'D:\\sort\\Oct 24 2026\\' + B5 },
    { oldPath: 'D:\\sort\\' + B7, newPath: 'D:\\sort\\Oct 24 2026\\' + B7 },
    { oldPath: 'D:\\sort\\24K6 - LTKTCN', newPath: 'D:\\sort\\Oct 24 2026\\24K6 - LTKTCN' },
  ];
  const { state: next, changed } = rewriteMovedFileLinks(state, moves);
  assert.equal(JSON.stringify(state), before, 'pure: the input document is not mutated');
  assert.ok(changed >= 4);
  const byId = Object.fromEntries(next.shortcuts.map((x) => [x.id, x]));
  assert.equal(byId.b5.target, 'D:\\sort\\Oct 24 2026\\' + B5);
  assert.equal(byId.b5.name, B5, 'a disk-name label follows the (unchanged) disk name');
  assert.equal(byId.b7.target, 'D:\\sort\\Oct 24 2026\\' + B7);
  assert.equal(byId.b7.name, 'B7 THANG (renamed by me)', 'authored names are kept');
  assert.equal(byId.folder.target, 'D:\\sort\\Oct 24 2026\\24K6 - LTKTCN');
  assert.equal(byId.inside.target, 'D:\\sort\\Oct 24 2026\\24K6 - LTKTCN\\BIỆN ANH QUÂN-2451010321\\LTKTCTCN.pptx');
  assert.deepEqual(byId.inside.fileTarget, state.shortcuts[3].fileTarget, 'owner identity is retained');
  assert.equal(byId.other, state.shortcuts[4], 'unrelated links are the same objects');
  assert.equal(byId.web, state.shortcuts[5]);
  const pills = next.view.preferences.navigatorSavedStates;
  assert.deepEqual(pills[0], { path: 'D:\\sort\\Oct 24 2026\\24K6 - LTKTCN', machineRoot: 'D:\\sort\\Oct 24 2026\\24K6 - LTKTCN', art: { target: 'D:\\sort\\Oct 24 2026\\24K6 - LTKTCN' } });
  assert.deepEqual(pills[1], { path: 'D:\\sort', machineRoot: 'D:\\sort' });
  assert.deepEqual(next.view.preferences.paneLayouts.root.pinned.map((x) => x.path), ['D:\\sort\\Oct 24 2026\\' + B5, 'D:\\sort\\Oct 24 2026\\24K6 - LTKTCN\\BIỆN ANH QUÂN-2451010321\\LTKTCTCN.pptx']);
});

test('a rename keeps a renamed disk-name label in step, and no-op moves leave the document identical', () => {
  const state = { shortcuts: [link('a', 'D:\\sort\\plan.html')], view: {} };
  const renamed = rewriteMovedFileLinks(state, [{ oldPath: 'D:\\sort\\plan.html', newPath: 'D:\\sort\\plan v2.html' }]).state;
  assert.equal(renamed.shortcuts[0].target, 'D:\\sort\\plan v2.html');
  assert.equal(renamed.shortcuts[0].name, 'plan v2.html');
  assert.equal(rewriteMovedFileLinks(state, [{ oldPath: 'D:\\elsewhere', newPath: 'D:\\x' }]).state, state);
  assert.equal(rewriteMovedFileLinks(state, [{ oldPath: 'D:\\sort\\plan.html', newPath: 'd:\\SORT\\plan.html' }]).state, state);
  assert.equal(rewriteMovedFileLinks(state, []).state, state);
});

// A fake disk: the creator's D:\sort after the move into "Oct 24 2026".
function disk(paths) {
  const entries = new Map();
  const add = (p, kind) => entries.set(p.toLowerCase(), { path: p, kind, name: p.split('\\').pop() });
  for (const p of paths) {
    const parts = p.split('\\');
    for (let n = 1; n < parts.length; n++) add(parts.slice(0, n).join('\\') + (n === 1 ? '\\' : ''), 'folder');
    add(p, p.endsWith('\\') ? 'folder' : (/\.[a-z0-9]{2,4}$/i.test(p) ? 'file' : 'folder'));
  }
  const calls = [];
  const fileCapability = async (operation, params) => {
    calls.push([operation, params.path]);
    const k = params.path.toLowerCase().replace(/\\+$/, '') || params.path.toLowerCase();
    const entry = entries.get(k) || entries.get(k + '\\');
    if (operation === 'stat') return entry ? { ok: true, entry } : { ok: false, code: 'ENOENT', message: 'ENOENT: no such file or directory, stat ' + params.path };
    if (operation === 'list') {
      if (!entry || entry.kind !== 'folder') return { ok: false, code: 'ENOENT' };
      const prefix = entry.path.replace(/\\+$/, '') + '\\';
      const items = [...entries.values()].filter((x) => x.path.toLowerCase().startsWith(prefix.toLowerCase()) && !x.path.slice(prefix.length).includes('\\') && x.path.length > prefix.length);
      return { ok: true, entry, items };
    }
    return { ok: false, code: 'OPERATION_UNKNOWN' };
  };
  return { fileCapability, calls };
}

test('repair re-finds identity-less links broken by an earlier move, including files inside a moved folder', async () => {
  const { fileCapability } = disk([
    'D:\\sort\\Oct 24 2026\\' + B5,
    'D:\\sort\\Oct 24 2026\\' + B7,
    'D:\\sort\\Oct 24 2026\\24K6 - LTKTCN\\BIỆN ANH QUÂN-2451010321\\LTKTCTCN.pptx',
    'D:\\sort\\Oct 24 2026\\24K6 - LTKTCN\\NGUYỄN DIỆU HUYỀN - 2451010168\\NHÀ MÁY BIA HUẾ.pdf',
    'D:\\sort\\Documents\\Baitap3.rvt',
    'D:\\sort\\a\\dup.png', 'D:\\sort\\b\\dup.png',
  ]);
  const state = {
    shortcuts: [
      link('b5', 'D:\\sort\\' + B5),
      link('b7', 'D:\\sort\\' + B7),
      link('pptx', 'D:\\sort\\24K6 - LTKTCN\\BIỆN ANH QUÂN-2451010321\\LTKTCTCN.pptx'),
      link('pdf', 'D:\\sort\\24K6 - LTKTCN\\NGUYỄN DIỆU HUYỀN - 2451010168\\NHÀ MÁY BIA HUẾ.pdf'),
      link('fine', 'D:\\sort\\Documents\\Baitap3.rvt'),
      link('dup', 'D:\\sort\\dup.png'),
      link('gone', 'D:\\sort\\never-existed.mp4'),
      link('owned', 'D:\\sort\\owned.mp4', { fileTarget: { id: 'x', status: 'missing', revision: 3 } }),
      link('offline', 'Z:\\share\\file.dwg'),
    ],
    view: { preferences: { paneLayouts: { root: { pinned: [{ path: 'D:\\sort\\24K6 - LTKTCN\\BIỆN ANH QUÂN-2451010321\\LTKTCTCN.pptx' }] } } } },
  };
  const before = JSON.stringify(state);
  const result = await repairBrokenFileLinks(state, { fileCapability });
  assert.equal(JSON.stringify(state), before, 'the input document is not mutated');
  const byId = Object.fromEntries(result.state.shortcuts.map((x) => [x.id, x.target]));
  assert.equal(byId.b5, 'D:\\sort\\Oct 24 2026\\' + B5);
  assert.equal(byId.b7, 'D:\\sort\\Oct 24 2026\\' + B7);
  assert.equal(byId.pptx, 'D:\\sort\\Oct 24 2026\\24K6 - LTKTCN\\BIỆN ANH QUÂN-2451010321\\LTKTCTCN.pptx');
  assert.equal(byId.pdf, 'D:\\sort\\Oct 24 2026\\24K6 - LTKTCN\\NGUYỄN DIỆU HUYỀN - 2451010168\\NHÀ MÁY BIA HUẾ.pdf');
  assert.equal(byId.fine, 'D:\\sort\\Documents\\Baitap3.rvt');
  assert.equal(byId.dup, 'D:\\sort\\dup.png', 'two candidates: ambiguous links are left untouched');
  assert.equal(byId.gone, 'D:\\sort\\never-existed.mp4');
  assert.equal(byId.owned, 'D:\\sort\\owned.mp4', 'links with an owner identity are left to the owner');
  assert.equal(byId.offline, 'Z:\\share\\file.dwg', 'a missing drive is not evidence of a move');
  assert.equal(result.state.view.preferences.paneLayouts.root.pinned[0].path, byId.pptx);
  assert.deepEqual(result.repaired.map((x) => x.id).sort(), ['b5', 'b7', 'pdf', 'pptx']);
  assert.deepEqual(result.unresolved.map((x) => [x.id, x.reason]).sort(), [['dup', 'several matching files'], ['gone', 'not found nearby'], ['offline', 'no surviving parent folder']]);
  // One folder move covers both files inside it.
  assert.equal(result.moves.filter((m) => m.oldPath === 'D:\\sort\\24K6 - LTKTCN').length, 1);
});

test('repair is bounded and scoped: `only` limits it to the accessed link', async () => {
  const { fileCapability, calls } = disk(['D:\\sort\\Oct 24 2026\\' + B5, 'D:\\sort\\Oct 24 2026\\' + B7]);
  const state = { shortcuts: [link('b5', 'D:\\sort\\' + B5), link('b7', 'D:\\sort\\' + B7)], view: {} };
  const result = await repairBrokenFileLinks(state, { fileCapability, only: new Set(['b5']) });
  assert.deepEqual(result.state.shortcuts.map((x) => x.target), ['D:\\sort\\Oct 24 2026\\' + B5, 'D:\\sort\\' + B7]);
  assert.ok(!calls.some(([, path]) => path === 'D:\\sort\\' + B7));
  const shallow = await repairBrokenFileLinks(state, { fileCapability, maxDepth: 0 });
  assert.equal(shallow.repaired.length, 0);
});

test('opening a broken identity-less link relinks it on access and saves the repaired document once', async () => {
  const { fileCapability } = disk(['D:\\sort\\Oct 24 2026\\' + B5]);
  let state = { shortcuts: [link('b5', 'D:\\sort\\' + B5)], view: {} };
  let saves = 0; const repairs = [];
  const host = { fileCapability: async (operation, params) => operation.startsWith('file-target-') ? { ok: true, target: { targetId: '', status: 'missing', revision: 0 } } : fileCapability(operation, params) };
  const controller = createFileTargets({ host, getState: () => state, save: async (build) => { saves++; state = build(state); return true; }, onRepair: (found) => repairs.push(found), repairEvery: Infinity });
  try {
    assert.equal(await controller.resolvePath('D:\\sort\\' + B5), 'D:\\sort\\Oct 24 2026\\' + B5);
    assert.equal(state.shortcuts[0].target, 'D:\\sort\\Oct 24 2026\\' + B5);
    assert.equal(saves, 1);
    assert.equal(repairs.length, 1);
  } finally { controller.dispose(); }
});

test('a verified rename makes links follow it; an unverified one leaves them unchanged', async () => {
  const exists = new Set(['d:\\sort\\new name']);
  const host = { fileCapability: async (_op, { path }) => exists.has(path.toLowerCase()) ? { ok: true } : { ok: false, code: 'ENOENT' } };
  let moves = null;
  assert.deepEqual(await followNavigatorRename({ host, path: 'D:\\sort\\old name', newName: 'new name', retarget: async (m) => { moves = m; return true; }, sleep: async () => {} }), { ok: true });
  assert.deepEqual(moves, [{ oldPath: 'D:\\sort\\old name', newPath: 'D:\\sort\\new name' }]);
  moves = null;
  const pending = await followNavigatorRename({ host, path: 'D:\\sort\\still here', newName: 'elsewhere', retarget: async (m) => { moves = m; return true; }, sleep: async () => {}, attempts: 3 });
  assert.equal(pending.ok, false);
  assert.equal(moves, null);
});

test('Kill on tracked files goes per item through file-target-delete and reports a locked file with the host delete shape', async () => {
  const free = 'D:/work/free.txt', held = 'D:/work/report.docx';
  const lockers = [{ pid: 4312, name: 'Microsoft Word', processName: 'WINWORD.EXE', imagePath: '', applicationType: 1 }];
  const controller = {
    hasPath: () => true,
    async deletePath(p) {
      if (p !== held) return { ok: true, recycle: true, target: { status: 'deleted' }, path: p };
      const error = Error('report.docx is open in Microsoft Word (WINWORD.EXE, pid 4312).');
      error.recycle = { ok: false, code: 'FILE_LOCKED', operation: 'file-target-delete', results: [{ path: 'D:/moved/report.docx', name: 'report.docx', ok: false, code: 'FILE_LOCKED', reason: 'Open in Microsoft Word (WINWORD.EXE, pid 4312)', lockers }] };
      throw error;
    },
  };
  const host = createFileTargetHost({ fileCapability: async () => { throw Error('untracked route used'); } }, () => controller, () => null);
  const result = await host.fileCapability('delete', { paths: [free, held] });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'DELETE_PARTIAL');
  assert.deepEqual(result.recycled, [free]);
  assert.deepEqual(result.failed, [held]);
  assert.equal(result.message, 'Recycled 1 of 2. report.docx is open in Microsoft Word (WINWORD.EXE, pid 4312).');
  // The AYG path, not the owner's current path, so the navigator can keep that row selected.
  assert.deepEqual(result.results[1], { path: held, name: 'report.docx', ok: false, code: 'FILE_LOCKED', reason: 'Open in Microsoft Word (WINWORD.EXE, pid 4312)', lockers });
  assert.equal(result.targets.length, 1);

  const only = await host.fileCapability('delete', { paths: [held] });
  assert.equal(only.code, 'FILE_LOCKED');
  const ok = await host.fileCapability('delete', { paths: [free] });
  assert.equal(ok.ok, true);
  assert.equal(ok.targets.length, 1);
});

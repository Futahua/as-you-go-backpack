import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import test from 'node:test';

const papersRoot = process.env.PAPERS_SOURCE_ROOT || 'D:/Letters/MatTroiSeConMoc/Products/Papers/Source';
const executable = process.env.PAPERS_PACKAGED_EXE;
const acceptance = executable ? test : test.skip;

acceptance('packaged Papers observes the As you Go success and failure fixtures', async () => {
  const require = createRequire(join(papersRoot, 'package.json'));
  const { _electron: electron } = require('playwright-core');
  const { connectPapersControl, readDescriptor } = await import(pathToFileURL(resolve(papersRoot, 'tools/papersControlClient.mjs')).href);
  const profile = await mkdtemp(join(tmpdir(), 'as-you-go-visual-'));
  const descriptor = join(profile, 'dev-control.json');
  const projectRoot = join(profile, 'project');
  const sourceRoot = fileURLToPath(new URL('./test-fixtures/visual/', import.meta.url));
  const projectId = 'bp-22222222-2222-4222-8222-222222222222';
  await mkdir(join(profile, 'PapersData', 'backpacks', projectId), { recursive: true });
  await cp(sourceRoot, projectRoot, { recursive: true });
  await writeFile(join(projectRoot, 'project.json'), JSON.stringify({ schemaVersion: 1, backpackId: projectId, entry: 'public/index.html' }));
  await writeFile(join(profile, 'PapersData', 'registry.json'), JSON.stringify({ schemaVersion: 1, backpacks: [{ id: projectId, name: 'Visual fixture', type: 'environment', createdAt: '2026-09-03T00:00:00.000Z', lastEnteredAt: null, archived: false, workspacePath: null }], lastActiveBackpackId: null }));
  await writeFile(join(profile, 'PapersData', 'backpacks', projectId, 'backpack.json'), JSON.stringify({ schemaVersion: 1, id: projectId, name: 'Visual fixture', type: 'environment', createdAt: '2026-09-03T00:00:00.000Z', lastEnteredAt: null, archived: false, workspacePath: null }));
  await writeFile(join(profile, 'PapersData', 'backpack-projects.json'), JSON.stringify({ schemaVersion: 1, projects: { [projectId]: { root: projectRoot } } }));
  const app = await electron.launch({ executablePath: executable, args: [], cwd: papersRoot, env: { ...process.env, PAPERS_TEST_USER_DATA: profile, PAPERS_ENABLE_FIXTURES: '0', PAPERS_DEV_CONTROL: '1', PAPERS_DEV_CONTROL_DESCRIPTOR: descriptor, ELECTRON_ENABLE_LOGGING: '1' } });
  const wait = async (probe, timeout = 15000) => { const end = Date.now() + timeout; while (Date.now() < end) { if (await probe()) return; await new Promise((r) => setTimeout(r, 100)); } throw new Error('visual acceptance timeout'); };
  const call = async (method, params = {}) => { const connection = await connectPapersControl(await readDescriptor(descriptor)); try { const result = await connection.call(method, params); if (!result.ok) throw new Error(result.error || method); return result.result; } finally { connection.close(); } };
  try {
    await wait(async () => { try { await readFile(descriptor); return true; } catch { return false; } });
    const windowId = await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0]?.id);
    const opened = await app.evaluate(async ({ BaseWindow }) => { const host = (BaseWindow.getAllWindows()[0].contentView.children)[0]; return host.webContents.executeJavaScript("window.papersHost.backpackProject.open('bp-22222222-2222-4222-8222-222222222222')", true); });
    await app.evaluate(async ({ BaseWindow }, args) => { const host = (BaseWindow.getAllWindows()[0].contentView.children)[0]; return host.webContents.executeJavaScript(`window.papersHost.backpackProject.showSurface(${JSON.stringify(args.surfaceId)}, ${JSON.stringify(args.url)})`, true); }, opened);
    await wait(async () => (await call('inspect.visual.elements', { windowId, surfaceId: opened.surfaceId })).elements?.some(({ key }) => key === 'primary-canvas'));
    const healthy = await call('visual.report.create', { windowId, surfaceId: opened.surfaceId, include: { surfaceCapture: true, semanticElements: true, recentLifecycle: true, recentDiagnostics: true, timeline: true }, beforeMs: 10000 });
    assert.equal(typeof healthy.artifactId, 'string');
    const failureUrl = `papers-backpack://bp-22222222-2222-4222-8222-222222222222/public/failure.html`;
    await app.evaluate(async ({ BaseWindow }, args) => { const host = BaseWindow.getAllWindows()[0].contentView.children[0]; await host.webContents.executeJavaScript(`window.papersHost.backpackProject.showSurface(${JSON.stringify(args.surfaceId)}, ${JSON.stringify(args.url)})`, true); }, { surfaceId: opened.surfaceId, url: failureUrl });
    await wait(async () => await app.evaluate(async ({ BaseWindow }) => { const project = BaseWindow.getAllWindows()[0].contentView.children.find((view) => view.webContents.getURL().includes('/failure.html')); if (!project) return false; return project.webContents.executeJavaScript('typeof window.__asYouGoVisualFixtureReportFailure === "function"', true); }));
    await app.evaluate(async ({ BaseWindow }) => { const project = BaseWindow.getAllWindows()[0].contentView.children.find((view) => view.webContents.getURL().includes('/failure.html')); if (project) await project.webContents.executeJavaScript('window.__asYouGoVisualFixtureReportFailure()', true); });
    await wait(async () => (await call('inspect.visual.diagnostics', { windowId, surfaceId: opened.surfaceId })).some(({ payload }) => payload.kind === 'lifecycle' && payload.phase === 'render-failed'), 20000);
    const failure = await call('visual.report.create', { windowId, surfaceId: opened.surfaceId, include: { surfaceCapture: true, semanticElements: true, recentLifecycle: true, recentDiagnostics: true, timeline: true }, beforeMs: 10000 });
    assert.equal(typeof failure.artifactId, 'string');
  } finally { await app.close(); }
});

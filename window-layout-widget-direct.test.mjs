import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  addWindowLayoutMember,
  createWindowLayout,
  emptyState,
  setWindowLayoutInstanceSuppressed,
  setWindowLayoutTracking,
} from './public/workspace-model-20260730b.js';
import { applyWindowLayoutWidgetPickDirect } from './public/app/window-layout-widget-direct.js';

const FINGERPRINT = 'a'.repeat(64);
const INSTANCE = 'W0123456789ABCDEF';

function projectWithLayout() {
  return createWindowLayout(emptyState(), { name: 'Widget' });
}

function pick() {
  return {
    outcome: 'committed',
    adds: [{
      descriptor: {
        version: 1,
        title: 'Notepad',
        executableFingerprint: FINGERPRINT,
        windowInstanceId: INSTANCE,
      },
      capability: { token: 'opaque' },
      candidate: { icon: 'data:image/png;base64,AA==' },
    }],
    removes: [],
  };
}

test('widget picker writes its own authoritative layout without a workspace writer channel', async () => {
  const initial = projectWithLayout();
  const layoutId = initial.windowLayouts[0].id;
  let durable = initial;
  let revision = 'r0';
  let acceptedWrites = 0;
  const host = {
    loadWorkspaceVersioned: async () => ({ state: durable, revision }),
    saveWorkspaceChecked: async (next, expected) => {
      assert.equal(expected, revision);
      acceptedWrites += 1;
      durable = next;
      revision = 'r1';
      return { ok: true, revision };
    },
  };

  const result = await applyWindowLayoutWidgetPickDirect({
    host,
    layoutId,
    pick: pick(),
    capabilities: new Map(),
    icons: new Map(),
    iconCacheEntry: (_member, icon) => icon,
  });

  assert.equal(result.outcome, 'committed');
  assert.equal(result.added, 1);
  assert.equal(acceptedWrites, 1);
  assert.equal(durable.activeWindowLayoutId, layoutId);
  assert.equal(durable.windowLayouts[0].arrangement.members.length, 1);
  assert.equal(durable.windowLayouts[0].arrangement.members[0].descriptor.windowInstanceId, INSTANCE);
  assert.equal(durable.windowLayouts[0].arrangement.members[0].bounds, null);
});

test('widget picker rebases once after a refused stale CAS and still accepts only one durable write', async () => {
  const initial = projectWithLayout();
  const layoutId = initial.windowLayouts[0].id;
  let durable = initial;
  let revision = 'r0';
  let saveAttempts = 0;
  let acceptedWrites = 0;
  const host = {
    loadWorkspaceVersioned: async () => ({ state: durable, revision }),
    saveWorkspaceChecked: async (next, expected) => {
      saveAttempts += 1;
      if (saveAttempts === 1) {
        assert.equal(expected, 'r0');
        revision = 'r-external';
        durable = { ...durable, view: { ...durable.view, iconSize: 120 } };
        return { ok: false, code: 'STALE_REVISION', revision };
      }
      assert.equal(expected, 'r-external');
      acceptedWrites += 1;
      durable = next;
      revision = 'r1';
      return { ok: true, revision };
    },
  };

  const result = await applyWindowLayoutWidgetPickDirect({
    host,
    layoutId,
    pick: pick(),
    capabilities: new Map(),
    icons: new Map(),
    iconCacheEntry: (_member, icon) => icon,
  });

  assert.equal(result.outcome, 'committed');
  assert.equal(saveAttempts, 2);
  assert.equal(acceptedWrites, 1);
  assert.equal(durable.view.iconSize, 120);
  assert.equal(durable.windowLayouts[0].arrangement.members.length, 1);
});

test('widget add does not need a second native observe after the host-bound pick', async () => {
  const initial = projectWithLayout();
  const layoutId = initial.windowLayouts[0].id;
  let durable = initial;
  const host = {
    loadWorkspaceVersioned: async () => ({ state: durable, revision: 'r0' }),
    saveWorkspaceChecked: async (next) => {
      durable = next;
      return { ok: true, revision: 'r1' };
    },
  };

  const result = await applyWindowLayoutWidgetPickDirect({
    host,
    layoutId,
    pick: pick(),
    capabilities: new Map(),
    icons: new Map(),
    iconCacheEntry: (_member, icon) => icon,
  });

  assert.equal(result.outcome, 'committed');
  assert.equal(result.added, 1);
  assert.equal(durable.windowLayouts[0].arrangement.members.length, 1);
});

test('manual widget remove suppresses the exact live instance while Auto is enabled', async () => {
  let initial = projectWithLayout();
  const layoutId = initial.windowLayouts[0].id;
  initial = setWindowLayoutTracking(initial, layoutId, true);
  initial = addWindowLayoutMember(initial, layoutId, {
    id: 'member-1',
    descriptor: {
      version: 1,
      title: 'Notepad',
      executableFingerprint: FINGERPRINT,
      windowInstanceId: INSTANCE,
    },
    bounds: null,
    state: 'normal',
  });
  let durable = initial;
  const host = {
    loadWorkspaceVersioned: async () => ({ state: durable, revision: 'r0' }),
    saveWorkspaceChecked: async (next) => {
      durable = next;
      return { ok: true, revision: 'r1' };
    },
  };

  const result = await applyWindowLayoutWidgetPickDirect({
    host,
    layoutId,
    pick: {
      outcome: 'committed',
      adds: [],
      removes: [{ descriptor: initial.windowLayouts[0].arrangement.members[0].descriptor }],
    },
    capabilities: new Map(),
    icons: new Map(),
  });

  assert.equal(result.outcome, 'committed');
  assert.equal(durable.windowLayouts[0].arrangement.members.length, 0);
  assert.deepEqual(durable.windowLayouts[0].tracking.suppressedInstanceIds, [INSTANCE]);
});

test('manual widget add clears an Auto suppression for that exact instance', async () => {
  let initial = projectWithLayout();
  const layoutId = initial.windowLayouts[0].id;
  initial = setWindowLayoutTracking(initial, layoutId, true);
  initial = setWindowLayoutInstanceSuppressed(initial, layoutId, INSTANCE, true);
  let durable = initial;
  const host = {
    loadWorkspaceVersioned: async () => ({ state: durable, revision: 'r0' }),
    saveWorkspaceChecked: async (next) => {
      durable = next;
      return { ok: true, revision: 'r1' };
    },
  };

  const result = await applyWindowLayoutWidgetPickDirect({
    host,
    layoutId,
    pick: pick(),
    capabilities: new Map(),
    icons: new Map(),
  });

  assert.equal(result.outcome, 'committed');
  assert.equal(durable.windowLayouts[0].arrangement.members.length, 1);
  assert.deepEqual(durable.windowLayouts[0].tracking.suppressedInstanceIds, []);
});

test('live compact-widget picker wiring bypasses the workspace-writer command relay', async () => {
  const source = await readFile(new URL('./public/workspace-20260730b.js', import.meta.url), 'utf8');
  const listStart = source.indexOf('async function handleWidgetListCandidate');
  const directStart = source.indexOf('async function beginWidgetDirectPick', listStart);
  const directEnd = source.indexOf("window.addEventListener('keydown'", directStart);
  assert.notEqual(listStart, -1);
  assert.notEqual(directStart, -1);
  assert.notEqual(directEnd, -1);

  const listPath = source.slice(listStart, directStart);
  const directPath = source.slice(directStart, directEnd);
  assert.match(listPath, /widgetState\.candidates[\s\S]*?resolveWindowInstance\(row\.windowInstanceId\)/);
  assert.match(listPath, /bindWindowLayoutPickerCandidate\(candidateId, row\)/);
  assert.match(listPath, /return applyWidgetPickDirect\(pick\)/);
  assert.doesNotMatch(listPath, /sendCommandAndWait/);
  assert.match(directPath, /await applyWidgetPickDirect\(result\)/);
  assert.doesNotMatch(directPath, /sendCommandAndWait/);
});
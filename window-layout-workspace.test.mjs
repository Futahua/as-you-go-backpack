// 019C (RoketPuncha sole-editor lane): the workspace-side durable writers.
// Winter's ONE typed committed pick set (single commit, cancel byte-zero,
// mixed add/remove, partial add failures) and Ning's retirement intent (one
// data-only removal, stale intents ignored, counters never persisted).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  createWindowLayoutPickApplier,
  createWindowLayoutRetirementWriter,
} from './public/app/window-layout-workspace.js';
import { windowLayoutMemberKey } from './public/app/window-layout-runtime.js';
import { createWorkspaceStore } from './public/app/workspace-store.js';
import {
  addWindowLayoutMember,
  removeWindowLayoutMember,
  normalizeState,
} from './public/workspace-model-20260730b.js';

function makeState(layouts) {
  return { windowLayouts: layouts };
}

function makeLayout(id, members) {
  return {
    id,
    name: id,
    arrangement: { members: members.map((member) => ({
      id: member.id,
      descriptor: { title: member.title },
      state: member.state ?? 'normal',
      bounds: null,
    })) },
  };
}

function makeHarness({ observe = async () => ({ outcome: 'success', observation: { bounds: { x: 0, y: 0, width: 100, height: 80 }, state: 'normal' } }), isReadOnly = () => false } = {}) {
  let state = makeState([makeLayout('L1', [
    { id: 'm1', title: 'Notepad' },
    { id: 'm2', title: 'Calculator' },
  ])]);
  let commits = 0;
  const capabilities = new Map();
  const icons = new Map();
  const model = {
    addWindowLayoutMember: (current, layoutId, member) => ({
      ...current,
      windowLayouts: current.windowLayouts.map((layout) => layout.id === layoutId
        ? { ...layout, arrangement: { ...layout.arrangement, members: [...layout.arrangement.members, member] } }
        : layout),
    }),
    removeWindowLayoutMember: (current, layoutId, memberId) => ({
      ...current,
      windowLayouts: current.windowLayouts.map((layout) => layout.id === layoutId
        ? { ...layout, arrangement: { ...layout.arrangement, members: layout.arrangement.members.filter((member) => member.id !== memberId) } }
        : layout),
    }),
  };
  const pickApplier = createWindowLayoutPickApplier({
    getState: () => state,
    commitState: (next) => { state = next; commits += 1; },
    observeCapability: observe,
    model,
    capabilities,
    icons,
    isReadOnly,
  });
  const retirementWriter = createWindowLayoutRetirementWriter({
    getState: () => state,
    commitState: (next) => { state = next; commits += 1; },
    model,
    capabilities,
    icons,
  });
  return { getState: () => state, countCommits: () => commits, pickApplier, retirementWriter, capabilities, icons };
}

function capabilityFor(title) {
  return { version: 1, bindingId: `b:${title}` };
}
function descriptor(title) {
  return { version: 1, title, executableFingerprint: 'a'.repeat(64) };
}

test('cancel is byte-zero: no commit, no mutation', async () => {
  const h = makeHarness();
  const before = JSON.stringify(h.getState());
  const result = await h.pickApplier.apply('L1', { outcome: 'cancelled' });
  assert.equal(result.outcome, 'cancelled');
  assert.equal(h.countCommits(), 0);
  assert.equal(JSON.stringify(h.getState()), before);
});

test('committed set removes data-only and adds every successful window in ONE commit', async () => {
  const h = makeHarness();
  const result = await h.pickApplier.apply('L1', {
    outcome: 'committed',
    removes: [{ descriptor: descriptor('Notepad') }],
    adds: [
      { descriptor: descriptor('Paint'), capability: capabilityFor('Paint'), candidate: { id: 'c1', title: 'Paint', icon: 'data:paint' } },
    ],
  });
  assert.equal(result.outcome, 'committed');
  assert.equal(result.removed, 1);
  assert.equal(result.added, 1);
  assert.equal(result.failures, 0);
  assert.equal(h.countCommits(), 1, 'persist exactly once');
  const layout = h.getState().windowLayouts[0];
  assert.deepEqual(layout.arrangement.members.map((member) => member.descriptor.title), ['Calculator', 'Paint']);
  assert.ok(h.capabilities.has(windowLayoutMemberKey('L1', layout.arrangement.members[1].id)), 'the added capability is cached');
  assert.equal(h.icons.get(windowLayoutMemberKey('L1', layout.arrangement.members[1].id)), 'data:paint', 'the candidate icon is cached');
});

test('mixed add/remove with partial add failures counts failures and still commits once', async () => {
  let calls = 0;
  const h = makeHarness({
    observe: async () => {
      calls += 1;
      // The first add's observe fails (window closed mid-pick).
      return calls === 1
        ? { outcome: 'missing' }
        : { outcome: 'success', observation: { bounds: { x: 0, y: 0, width: 10, height: 10 }, state: 'minimized' } };
    },
  });
  const result = await h.pickApplier.apply('L1', {
    outcome: 'committed',
    removes: [{ descriptor: descriptor('Calculator') }],
    adds: [
      { descriptor: descriptor('Paint'), capability: capabilityFor('Paint'), candidate: { id: 'c1', title: 'Paint' } },
      { descriptor: descriptor('Wordpad'), capability: capabilityFor('Wordpad'), candidate: { id: 'c2', title: 'Wordpad' } },
    ],
  });
  assert.equal(result.removed, 1);
  assert.equal(result.added, 1);
  assert.equal(result.failures, 1);
  assert.equal(h.countCommits(), 1, 'still one durable commit');
  const layout = h.getState().windowLayouts[0];
  assert.deepEqual(layout.arrangement.members.map((member) => member.descriptor.title), ['Notepad', 'Wordpad']);
  assert.equal(layout.arrangement.members[1].state, 'minimized', 'the successful add captures its live state');
});

test('a failed or malformed pick result is reported without committing', async () => {
  const h = makeHarness();
  const failed = await h.pickApplier.apply('L1', { outcome: 'failed', error: 'no display' });
  assert.equal(failed.outcome, 'failed');
  assert.equal(h.countCommits(), 0);
  const missing = await h.pickApplier.apply('L1', { outcome: 'committed', adds: [{ descriptor: { title: 'X' } }], removes: [] });
  assert.equal(missing.added, 0);
  assert.equal(missing.failures, 1);
  assert.equal(h.countCommits(), 0, 'an add with no capability must not commit');
});

test('removes never close or move the window (data-only)', async () => {
  const h = makeHarness();
  await h.pickApplier.apply('L1', {
    outcome: 'committed',
    removes: [{ descriptor: descriptor('Notepad') }, { descriptor: descriptor('Calculator') }],
    adds: [],
  });
  assert.equal(h.countCommits(), 1);
  assert.equal(h.getState().windowLayouts[0].arrangement.members.length, 0);
});

test('retirement removes ONE member data-only and commits once', () => {
  const h = makeHarness();
  h.capabilities.set(windowLayoutMemberKey('L1', 'm1'), capabilityFor('Notepad'));
  h.icons.set(windowLayoutMemberKey('L1', 'm1'), 'data:notepad');
  const result = h.retirementWriter.retire('L1', 'm1');
  assert.equal(result.outcome, 'removed');
  assert.equal(h.countCommits(), 1);
  const layout = h.getState().windowLayouts[0];
  assert.deepEqual(layout.arrangement.members.map((member) => member.id), ['m2']);
  assert.ok(!h.capabilities.has(windowLayoutMemberKey('L1', 'm1')), 'the retired member binding is deleted (composite key)');
  assert.ok(!h.icons.has(windowLayoutMemberKey('L1', 'm1')), 'the retired member icon is deleted (composite key)');
});

test('retirement ignores a missing member or layout without committing', () => {
  const h = makeHarness();
  const before = JSON.stringify(h.getState());
  assert.equal(h.retirementWriter.retire('L1', 'ghost').outcome, 'ignored');
  assert.equal(h.retirementWriter.retire('GHOST', 'm1').outcome, 'ignored');
  assert.equal(h.countCommits(), 0);
  assert.equal(JSON.stringify(h.getState()), before);
});

test('019DR: read-only begun during async observation returns superseded with zero commit', async () => {
  let readOnly = false;
  let release;
  const hold = new Promise((resolve) => { release = resolve; });
  const h = makeHarness({
    isReadOnly: () => readOnly,
    observe: async () => {
      await hold; // hold the observation open so the handoff can begin mid-apply
      return { outcome: 'success', observation: { bounds: { x: 0, y: 0, width: 10, height: 10 }, state: 'normal' } };
    },
  });
  // Seed the runtime maps for the existing persisted members so we can prove a
  // superseded apply leaves them byte/entry-identical. 040: composite keys.
  h.capabilities.set(windowLayoutMemberKey('L1', 'm1'), capabilityFor('Notepad'));
  h.icons.set(windowLayoutMemberKey('L1', 'm1'), 'data:notepad');
  h.capabilities.set(windowLayoutMemberKey('L1', 'm2'), capabilityFor('Calculator'));
  h.icons.set(windowLayoutMemberKey('L1', 'm2'), 'data:calc');
  const beforeState = JSON.stringify(h.getState());
  const beforeCaps = JSON.stringify([...h.capabilities.entries()]);
  const beforeIcons = JSON.stringify([...h.icons.entries()]);
  const pending = h.pickApplier.apply('L1', {
    outcome: 'committed',
    removes: [{ descriptor: descriptor('Notepad') }],
    adds: [{ descriptor: descriptor('Paint'), capability: capabilityFor('Paint'), candidate: { id: 'c1', title: 'Paint', icon: 'data:paint' } }],
  });
  await new Promise((resolve) => setImmediate(resolve)); // observation is in flight
  readOnly = true; // detach/read-only handoff begins
  release();
  const result = await pending;
  assert.equal(result.outcome, 'superseded', 'a typed superseded result surfaces');
  assert.equal(h.countCommits(), 0, 'zero durable commit');
  assert.equal(JSON.stringify(h.getState()), beforeState, 'state byte-identical');
  assert.equal(JSON.stringify([...h.capabilities.entries()]), beforeCaps, 'capabilities entry-identical (no delete of a retained member, no orphan set)');
  assert.equal(JSON.stringify([...h.icons.entries()]), beforeIcons, 'icons entry-identical');
  const layout = h.getState().windowLayouts[0];
  assert.deepEqual(layout.arrangement.members.map((member) => member.descriptor.title), ['Notepad', 'Calculator'],
    'byte-zero mutation: Notepad still bound, Paint never added');
  assert.equal(layout.arrangement.members.length, 2);
});

test('019DR2: the committed path applies the staged runtime-map changes exactly once', async () => {
  const h = makeHarness();
  h.capabilities.set(windowLayoutMemberKey('L1', 'm1'), capabilityFor('Notepad'));
  h.icons.set(windowLayoutMemberKey('L1', 'm1'), 'data:notepad');
  h.capabilities.set(windowLayoutMemberKey('L1', 'm2'), capabilityFor('Calculator'));
  h.icons.set(windowLayoutMemberKey('L1', 'm2'), 'data:calc');
  const result = await h.pickApplier.apply('L1', {
    outcome: 'committed',
    removes: [{ descriptor: descriptor('Notepad') }],
    adds: [{ descriptor: descriptor('Paint'), capability: capabilityFor('Paint'), candidate: { id: 'c1', title: 'Paint', icon: 'data:paint' } }],
  });
  assert.equal(result.outcome, 'committed');
  assert.equal(result.removed, 1);
  assert.equal(result.added, 1);
  assert.equal(h.countCommits(), 1);
  const layout = h.getState().windowLayouts[0];
  const addedId = layout.arrangement.members.find((member) => member.descriptor.title === 'Paint').id;
  // Exactly once: the removed member's binding/icon are gone, the added
  // member's are present, and nothing orphaned remains. 040: composite keys.
  assert.ok(!h.capabilities.has(windowLayoutMemberKey('L1', 'm1')), 'the removed member binding is deleted exactly once');
  assert.ok(!h.icons.has(windowLayoutMemberKey('L1', 'm1')), 'the removed member icon is deleted exactly once');
  assert.equal(h.capabilities.get(windowLayoutMemberKey('L1', addedId))?.bindingId, capabilityFor('Paint').bindingId, 'the added member binding is set exactly once');
  assert.equal(h.icons.get(windowLayoutMemberKey('L1', addedId)), 'data:paint', 'the added member icon is set exactly once');
  assert.equal(h.capabilities.size, 2, 'capabilities holds exactly the two remaining members');
  assert.equal(h.icons.size, 2, 'icons holds exactly the two remaining members');
});

test('019I picker commit and retirement leave state a valid object while persistence occurs', async () => {
  // Real store contract/wiring: setState updates the lexical state; store.commit
  // INSTALLS state synchronously and RETURNS Promise<boolean> for persistence.
  // The entry's FIXED commitState invokes the commit WITHOUT assigning that
  // Promise to state (JSON.stringify(Promise) == "{}" would corrupt the durable
  // snapshot and the recording timer).
  const seed = normalizeState({
    schemaVersion: 1,
    windowLayouts: [{
      id: 'L1',
      name: 'L1',
      arrangement: { version: 2, members: [{ id: 'a1', descriptor: { version: 1, title: 'A', executableFingerprint: 'a'.repeat(64) }, state: 'normal', bounds: null }] },
    }],
  });
  let state = seed;
  const saved = [];
  const commitPromises = [];
  const store = createWorkspaceStore({
    getState: () => state,
    setState: (next) => { state = next; },
    normalizeState,
    persist: async (snapshot, metadata) => { saved.push(snapshot); },
    afterCommit: () => {},
  });
  const commitState = (next) => {
    const pending = store.commit(next); // 019I: never assign the Promise to state
    commitPromises.push(pending);
    return pending;
  };
  const applier = createWindowLayoutPickApplier({
    getState: () => state,
    commitState,
    observeCapability: async () => ({ outcome: 'success', observation: { bounds: { x: 0, y: 0, width: 100, height: 80 }, state: 'normal' } }),
    model: { addWindowLayoutMember, removeWindowLayoutMember },
    capabilities: new Map(),
    icons: new Map(),
  });
  const applied = await applier.apply('L1', {
    outcome: 'committed',
    adds: [{ descriptor: { version: 1, title: 'Paint', executableFingerprint: 'f'.repeat(64) }, capability: { version: 1, bindingId: 'b:paint' }, candidate: { icon: 'data:paint' } }],
    removes: [],
  });
  assert.equal(applied.outcome, 'committed');
  await Promise.all(commitPromises.splice(0));
  assert.ok(state && typeof state === 'object' && !Array.isArray(state) && !(state instanceof Promise),
    'picker commit leaves state a valid workspace object, never a Promise');
  assert.ok(JSON.stringify(state).includes('"Paint"'), 'the picker commit installed the new member into state');
  assert.equal(saved.length, 1, 'picker commit persists one real snapshot');
  assert.ok(saved[0].includes('"Paint"'), 'the persisted snapshot serializes the committed member (not {} from a Promise)');
  const pickedSnapshot = JSON.parse(saved[0]);
  assert.equal(pickedSnapshot.schemaVersion, 1, 'persisted picker state keeps the Papers schema version');
  assert.ok(Array.isArray(pickedSnapshot.groups), 'persisted picker state keeps the Papers groups array');
  assert.ok(Array.isArray(pickedSnapshot.shortcuts), 'persisted picker state keeps the Papers shortcuts array');
  assert.ok(Array.isArray(pickedSnapshot.windowLayouts), 'persisted picker state keeps the window-layout extension array');

  const writer = createWindowLayoutRetirementWriter({
    getState: () => state,
    commitState,
    model: { removeWindowLayoutMember },
    capabilities: new Map(),
    icons: new Map(),
  });
  assert.equal(writer.retire('L1', 'a1').outcome, 'removed');
  await Promise.all(commitPromises.splice(0));
  assert.ok(state && typeof state === 'object' && !(state instanceof Promise),
    'retirement leaves state a valid object');
  assert.equal(saved.length, 2, 'retirement persists a second snapshot');
  const retiredSnapshot = JSON.parse(saved[1]);
  assert.equal(retiredSnapshot.schemaVersion, 1, 'persisted retirement state keeps the Papers schema version');
  assert.ok(Array.isArray(retiredSnapshot.groups), 'persisted retirement state keeps the Papers groups array');
  assert.ok(Array.isArray(retiredSnapshot.shortcuts), 'persisted retirement state keeps the Papers shortcuts array');
  assert.ok(Array.isArray(retiredSnapshot.windowLayouts), 'persisted retirement state keeps the window-layout extension array');
  assert.ok(!retiredSnapshot.windowLayouts[0].arrangement.members.some((m) => m.id === 'a1'),
    'the retired member is gone from the persisted snapshot');
});

test('019I both production writer adapters invoke store.commit without assigning its Promise to state', async () => {
  const source = await readFile(new URL('./public/workspace-20260730b.js', import.meta.url), 'utf8');
  const pickStart = source.indexOf('const windowLayoutPickApplier = createWindowLayoutPickApplier({');
  const retirementStart = source.indexOf('const windowLayoutRetirementWriter = createWindowLayoutRetirementWriter({');
  const retirementEnd = source.indexOf('\n});', retirementStart);
  assert.ok(pickStart >= 0 && retirementStart > pickStart && retirementEnd > retirementStart,
    'both production writer adapter blocks are present');
  const pickAdapter = source.slice(pickStart, retirementStart);
  const retirementAdapter = source.slice(retirementStart, retirementEnd + 4);
  const safeAdapter = /commitState:\s*\(next\)\s*=>\s*store\.commit\(next\)/;
  const corruptingAdapter = /commitState:[^\n]*\bstate\s*=\s*store\.commit\(next\)/;
  assert.match(pickAdapter, safeAdapter, 'picker production adapter invokes the real store commit');
  assert.doesNotMatch(pickAdapter, corruptingAdapter, 'picker production adapter never stores the commit Promise in state');
  assert.match(retirementAdapter, safeAdapter, 'retirement production adapter invokes the real store commit');
  assert.doesNotMatch(retirementAdapter, corruptingAdapter, 'retirement production adapter never stores the commit Promise in state');
});

test('040 two layouts referencing the SAME window stay cache- and state-isolated', async () => {
  // Layout A and layout B both contain a member for the SAME real window
  // (same descriptor title/fingerprint). The pick applier adds a new window to
  // LAYOUT A only; its composite capability/icon keys must not touch layout B,
  // and removing the member from A must byte-preserve B's saved arrangement.
  const makeState = (layouts) => ({ windowLayouts: layouts });
  const layoutB = {
    id: 'L2',
    name: 'L2',
    arrangement: { members: [{
      id: 'b1',
      descriptor: { version: 1, title: 'Notepad', executableFingerprint: 'a'.repeat(64) },
      state: 'minimized',
      bounds: { x: 40, y: 40, width: 300, height: 220 },
    }] },
  };
  const two = (() => {
    let state = makeState([
      { id: 'L1', name: 'L1', arrangement: { members: [] } },
      layoutB,
    ]);
    let commits = 0;
    const capabilities = new Map();
    const icons = new Map();
    const model = {
      addWindowLayoutMember: (current, layoutId, member) => ({
        ...current,
        windowLayouts: current.windowLayouts.map((layout) => layout.id === layoutId
          ? { ...layout, arrangement: { ...layout.arrangement, members: [...layout.arrangement.members, member] } }
          : layout),
      }),
      removeWindowLayoutMember: (current, layoutId, memberId) => ({
        ...current,
        windowLayouts: current.windowLayouts.map((layout) => layout.id === layoutId
          ? { ...layout, arrangement: { ...layout.arrangement, members: layout.arrangement.members.filter((member) => member.id !== memberId) } }
          : layout),
      }),
    };
    const pickApplier = createWindowLayoutPickApplier({
      getState: () => state,
      commitState: (next) => { state = next; commits += 1; },
      observeCapability: async () => ({ outcome: 'success', observation: { bounds: { x: 0, y: 0, width: 100, height: 80 }, state: 'normal' } }),
      model,
      capabilities,
      icons,
    });
    return { getState: () => state, countCommits: () => commits, pickApplier, capabilities, icons };
  })();
  const beforeB = JSON.stringify(two.getState().windowLayouts[1]);
  const applied = await two.pickApplier.apply('L1', {
    outcome: 'committed',
    adds: [{
      descriptor: { version: 1, title: 'Notepad', executableFingerprint: 'a'.repeat(64) },
      capability: { version: 1, bindingId: 'b:notepad' },
      candidate: { icon: 'data:notepad' },
    }],
    removes: [],
  });
  assert.equal(applied.outcome, 'committed');
  const layoutA = two.getState().windowLayouts[0];
  const aId = layoutA.arrangement.members[0].id;
  assert.ok(aId !== 'b1', 'each layout mints its OWN member id for the same window');
  // Composite cache keys keep layout B untouched.
  assert.ok(two.capabilities.has(windowLayoutMemberKey('L1', aId)), 'layout A capability cached under composite key');
  assert.ok(two.icons.has(windowLayoutMemberKey('L1', aId)), 'layout A icon cached under composite key');
  assert.ok(!two.capabilities.has(windowLayoutMemberKey('L2', aId)), 'no layout-A capability leaks to layout B');
  assert.ok(!two.capabilities.has(windowLayoutMemberKey('L2', 'b1')), 'layout B has no capability yet');
  // Removing the member from layout A leaves layout B byte-identical.
  const removed = two.pickApplier.apply('L1', {
    outcome: 'committed',
    adds: [],
    removes: [{ descriptor: { version: 1, title: 'Notepad', executableFingerprint: 'a'.repeat(64) } }],
  });
  assert.equal((await removed).removed, 1);
  assert.ok(!two.capabilities.has(windowLayoutMemberKey('L1', aId)), 'layout A capability removed after its member is removed');
  assert.ok(!two.icons.has(windowLayoutMemberKey('L1', aId)), 'layout A icon removed after its member is removed');
  assert.equal(JSON.stringify(two.getState().windowLayouts[1]), beforeB, 'layout B saved arrangement byte-identical after layout A add+remove');
  assert.equal(two.getState().windowLayouts[0].arrangement.members.length, 0, 'layout A member removed data-only');
});

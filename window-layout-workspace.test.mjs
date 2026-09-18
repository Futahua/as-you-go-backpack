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
  windowLayoutPickApplyOutcome,
  windowLayoutPickForBoundCandidate,
} from './public/app/window-layout-workspace.js';
import { windowLayoutMemberKey } from './public/app/window-layout-runtime.js';
import { windowLayoutWidgetCommittedStatus } from './public/app/window-layout-widget-channel.js';
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
      // The persisted descriptor is the PAIR the host's own matcher uses. The harness used to store the title
      // alone, which is what let a title-only member match look correct: a member with no fingerprint could
      // only ever be found by its title.
      descriptor: { version: 1, title: member.title, executableFingerprint: member.fingerprint ?? FINGERPRINT_A },
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
const FINGERPRINT_A = 'a'.repeat(64);
const FINGERPRINT_B = 'b'.repeat(64);

function descriptor(title) {
  return { version: 1, title, executableFingerprint: FINGERPRINT_A };
}

/** A descriptor for the SAME title on a DIFFERENT executable: the case a title-only match cannot tell apart. */
function descriptorOn(title, executableFingerprint) {
  return { version: 1, title, executableFingerprint };
}

function descriptorInstance(title, windowInstanceId, executableFingerprint = FINGERPRINT_A) {
  return { version: 1, title, executableFingerprint, windowInstanceId };
}

/* Identity in the pick applier.
 *
 * A picker-commit removal carries ONE thing - a persisted descriptor ({version, title, executableFingerprint}).
 * The wire format has no member id: the parser rejects any key but `descriptor`, and even the path that holds
 * an id in hand (the widget's context menu, which builds removals from snapshot members it just selected by
 * id) sends the descriptor alone. So the narrowest identity a removal actually carries is the PAIR, and it is
 * only usable when exactly one member carries it.
 *
 * These three tests are the cases title-only matching got wrong, and the applier is the last place in this
 * project that matched a member by a mutable, non-unique string. */
test('a removal matches the executable as well as the title, so a same-titled window is not the one removed', async () => {
  const harness = makeHarness();
  // Two windows titled the same, on different executables, with the WRONG one first: what a title-only match
  // removes is whatever happens to come first in the layout.
  const layout = harness.getState().windowLayouts[0];
  layout.arrangement.members = [
    { id: 'm-obsidian', descriptor: descriptorOn('GitHub', FINGERPRINT_B), state: 'normal', bounds: null },
    { id: 'm-chrome', descriptor: descriptorOn('GitHub', FINGERPRINT_A), state: 'normal', bounds: null },
  ];
  const result = await harness.pickApplier.apply('L1', {
    outcome: 'committed',
    adds: [],
    removes: [{ descriptor: descriptorOn('GitHub', FINGERPRINT_A) }],
  });
  assert.equal(result.removed, 1);
  assert.deepEqual(
    harness.getState().windowLayouts[0].arrangement.members.map((member) => member.id),
    ['m-obsidian'],
    'the Chrome member goes, the Obsidian member with the same title stays',
  );
});

test('an exact window instance distinguishes same-title siblings for add/remove decisions', async () => {
  const first = descriptorInstance('GitHub', 'W0000000000000001');
  const second = descriptorInstance('GitHub', 'W0000000000000002');
  const members = [{ id: 'm-first', descriptor: first, state: 'normal', bounds: null }];

  const addingSecond = windowLayoutPickForBoundCandidate(
    members,
    { descriptor: second, capability: capabilityFor('GitHub') },
    { icon: 'data:second' },
  );
  assert.equal(addingSecond.adds.length, 1, 'the sibling is an add, not a removal of the first same-title window');
  assert.deepEqual(addingSecond.adds[0].descriptor, second);
  assert.equal(addingSecond.removes.length, 0);

  const removingFirst = windowLayoutPickForBoundCandidate(
    members,
    { descriptor: first, capability: capabilityFor('GitHub') },
  );
  assert.equal(removingFirst.adds.length, 0);
  assert.deepEqual(removingFirst.removes, [{ descriptor: first }]);
});

test('an instance-qualified removal removes only that sibling when title and executable are identical', async () => {
  const harness = makeHarness();
  harness.getState().windowLayouts[0].arrangement.members = [
    { id: 'm-first', descriptor: descriptorInstance('GitHub', 'W0000000000000001'), state: 'normal', bounds: null },
    { id: 'm-second', descriptor: descriptorInstance('GitHub', 'W0000000000000002'), state: 'normal', bounds: null },
  ];
  const result = await harness.pickApplier.apply('L1', {
    outcome: 'committed',
    adds: [],
    removes: [{ descriptor: descriptorInstance('GitHub', 'W0000000000000002') }],
  });
  assert.equal(result.removed, 1);
  assert.equal(result.ambiguous, 0);
  assert.deepEqual(
    harness.getState().windowLayouts[0].arrangement.members.map((member) => member.id),
    ['m-first'],
    'the exact sibling remains untouched',
  );
});

test('two members with the same title AND executable are refused, not guessed between', async () => {
  const harness = makeHarness();
  harness.getState().windowLayouts[0].arrangement.members = [
    { id: 'm-first', descriptor: descriptor('GitHub'), state: 'normal', bounds: null },
    { id: 'm-second', descriptor: descriptor('GitHub'), state: 'normal', bounds: null },
  ];
  const before = JSON.stringify(harness.getState());
  const commitsBefore = harness.countCommits();
  const result = await harness.pickApplier.apply('L1', {
    outcome: 'committed',
    adds: [],
    removes: [{ descriptor: descriptor('GitHub') }],
  });
  assert.equal(result.removed, 0, 'nothing is removed when the pick cannot say which member it meant');
  assert.equal(result.ambiguous, 1, 'and the refusal is reported rather than passed off as a no-op');
  assert.equal(JSON.stringify(harness.getState()), before, 'byte-zero: no member moved');
  assert.equal(harness.countCommits(), commitsBefore, 'and nothing was written');
});

test('a retitled member is not removed by a stale descriptor, and the mismatch is reported', async () => {
  const harness = makeHarness();
  harness.getState().windowLayouts[0].arrangement.members = [
    { id: 'm-chrome', descriptor: descriptor('GitHub'), state: 'normal', bounds: null },
  ];
  const before = JSON.stringify(harness.getState());
  const commitsBefore = harness.countCommits();
  const result = await harness.pickApplier.apply('L1', {
    outcome: 'committed',
    adds: [],
    // The window was retitled between the pick and the apply - the creator's own example is a browser tab.
    removes: [{ descriptor: descriptorOn('GitHub — a new tab', FINGERPRINT_A) }],
  });
  assert.equal(result.removed, 0);
  assert.equal(result.unmatched, 1, 'a removal that found no member says so');
  assert.equal(JSON.stringify(harness.getState()), before);
  assert.equal(harness.countCommits(), commitsBefore);
});
/* The wrapper's decision, as a pure function so it can be tested rather than string-matched.
 *
 * The wrapper itself lives in the workspace entry and cannot be constructed here, so the POLICY lives in the
 * module that owns pick semantics and the entry is a three-line caller of it. These tests therefore prove the
 * decision behaviourally; that the entry obeys it is asserted separately, by reading the entry, because the
 * alternative is a harness that copies the wrapper and tests the copy. */
test('a pure refusal is not a mutation: nothing to commit, nothing to activate', () => {
  // The blocker: an inactive layout must not become active, persist, or apply real windows because a removal
  // was refused. `mutated` is what gates noteCommitted and ensureRecording.
  assert.deepEqual(
    windowLayoutPickApplyOutcome({ outcome: 'committed', added: 0, removed: 0, failures: 0, unmatched: 1, ambiguous: 0 }),
    { mutated: false, statusText: 'That window has changed since the pick — nothing was removed' },
  );
  assert.deepEqual(
    windowLayoutPickApplyOutcome({ outcome: 'committed', added: 0, removed: 0, failures: 0, unmatched: 0, ambiguous: 1 }),
    { mutated: false, statusText: 'Two windows here match that one — nothing was removed' },
  );
  assert.deepEqual(
    windowLayoutPickApplyOutcome({ outcome: 'committed', added: 0, removed: 0, failures: 0, unmatched: 1, ambiguous: 2 }),
    { mutated: false, statusText: 'Nothing was removed — 2 matched two windows; 1 could not be matched' },
    'both reasons are named rather than one standing in for the other',
  );
  // A failed add changes nothing either, so it activates nothing - only the wording is unchanged.
  assert.deepEqual(
    windowLayoutPickApplyOutcome({ outcome: 'committed', added: 0, removed: 0, failures: 2, unmatched: 0, ambiguous: 0 }),
    { mutated: false, statusText: '2 members could not be added' },
  );
});

test('a pick that changed something says what it did, including the half that was refused', () => {
  assert.deepEqual(
    windowLayoutPickApplyOutcome({ outcome: 'committed', added: 0, removed: 2, failures: 0, unmatched: 0, ambiguous: 0 }),
    { mutated: true, statusText: '' },
    'an ordinary removal says nothing extra',
  );
  assert.deepEqual(
    windowLayoutPickApplyOutcome({ outcome: 'committed', added: 1, removed: 0, failures: 0, unmatched: 0, ambiguous: 0 }),
    { mutated: true, statusText: '' },
  );
  // The second blocker: with one removal applied and one refused, "nothing was removed" is a lie.
  assert.deepEqual(
    windowLayoutPickApplyOutcome({ outcome: 'committed', added: 0, removed: 1, failures: 0, unmatched: 1, ambiguous: 0 }),
    { mutated: true, statusText: 'Removed 1 — 1 could not be matched' },
  );
  assert.deepEqual(
    windowLayoutPickApplyOutcome({ outcome: 'committed', added: 0, removed: 1, failures: 0, unmatched: 0, ambiguous: 1 }),
    { mutated: true, statusText: 'Removed 1 — 1 matched two windows' },
  );
  assert.deepEqual(
    windowLayoutPickApplyOutcome({ outcome: 'committed', added: 0, removed: 2, failures: 0, unmatched: 1, ambiguous: 1 }),
    { mutated: true, statusText: 'Removed 2 — 1 matched two windows; 1 could not be matched' },
  );
});

test('a missing or unusable result reads as no mutation and says nothing', () => {
  for (const applied of [null, undefined, {}, { outcome: 'committed' }, { outcome: 'cancelled' }]) {
    assert.deepEqual(windowLayoutPickApplyOutcome(applied), { mutated: false, statusText: '' }, JSON.stringify(applied));
  }
});
test('the workspace wrapper obeys that decision: a pure refusal notifies nothing and activates nothing', async () => {
  // The wrapper lives in the workspace entry and cannot be constructed in this suite, so what is proven here is
  // (a) the decision, behaviourally, above, and (b) that the entry gates BOTH calls on it and has no ungated
  // path left anywhere. The alternative - a harness that copies the wrapper - would test the copy.
  const source = await readFile(new URL('./public/workspace-20260730b.js', import.meta.url), 'utf8');
  // Scoped to the wrapper, because the entry legitimately notifies the channel from other paths - the
  // retirement writer's own removal does, after it has proved a member was removed.
  const start = source.indexOf('async function applyWindowLayoutPickSet(');
  assert.ok(start > 0, 'the pick wrapper is where this test thinks it is');
  const end = source.indexOf('/** 019C: Ning\'s onRetireMember intent', start);
  const wrapper = source.slice(start, end);
  assert.match(wrapper, /const outcome = windowLayoutPickApplyOutcome\(applied\);/);
  assert.match(wrapper, /if \(outcome\.mutated\) windowLayoutWidgetChannelWorkspace\.noteCommitted\(layoutId\);/,
    'the commit notification is gated on a real mutation');
  assert.match(wrapper, /if \(outcome\.mutated\) \{[\s\S]*if \(activateOnMutation\) \{[\s\S]*await windowLayoutRecording\.ensureRecording\(layoutId\);/,
    'recording activation is nested under a real mutation and the explicit activation policy');
  assert.match(wrapper, /else if \(isActiveRecordingContext\(layoutId\)\) \{[\s\S]*await windowLayoutRuntimeController\.reconcileActive\(\);/,
    'a data-only attached-list removal only reconciles when this layout is already active');
  // No unconditional call may remain inside the wrapper.
  assert.doesNotMatch(wrapper, /^\s*windowLayoutWidgetChannelWorkspace\.noteCommitted\(layoutId\);$/m);
});
test('the sentence a real refused or mixed pick produces is the one the widget receives, unabridged', async () => {
  // The end of the chain the widget blocker was about: the REAL applier's output, not a hand-written status.
  // The channel test proves the wire carries a status; this proves the string on it is the computed sentence.
  const refused = makeHarness();
  const refusedApplied = await refused.pickApplier.apply('L1', {
    outcome: 'committed',
    removes: [{ descriptor: descriptor('Paint') }],
    adds: [],
  });
  const refusedOutcome = windowLayoutPickApplyOutcome(refusedApplied);
  assert.equal(refusedApplied.outcome, 'committed');
  assert.equal(refusedOutcome.mutated, false, 'a refusal changed nothing');
  assert.equal(refusedOutcome.statusText, 'That window has changed since the pick — nothing was removed');
  // The widget branch bounds that sentence before it sends it; a bound that altered a real sentence would
  // put truncated words on the creator's card.
  assert.equal(windowLayoutWidgetCommittedStatus(refusedOutcome.statusText), refusedOutcome.statusText);
  assert.equal(refused.countCommits(), 0, 'a refusal still commits nothing');

  const mixed = makeHarness();
  const mixedOutcome = windowLayoutPickApplyOutcome(await mixed.pickApplier.apply('L1', {
    outcome: 'committed',
    removes: [{ descriptor: descriptor('Notepad') }, { descriptor: descriptor('Paint') }],
    adds: [],
  }));
  assert.equal(mixedOutcome.mutated, true, 'one member really went');
  assert.equal(mixedOutcome.statusText, 'Removed 1 — 1 could not be matched');
  assert.equal(windowLayoutWidgetCommittedStatus(mixedOutcome.statusText), mixedOutcome.statusText);
  assert.equal(mixed.countCommits(), 1);
});

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

test('direct picker self-recovers orphaned Papers sessions before attached and widget starts', async () => {
  const source = await readFile(new URL('./public/workspace-20260730b.js', import.meta.url), 'utf8');
  const attachedStart = source.indexOf('async function beginWindowLayoutDirectPick(layoutId)');
  const widgetStart = source.indexOf('async function beginWidgetDirectPick()');
  assert.ok(attachedStart >= 0 && widgetStart > attachedStart, 'both direct-pick entry points exist');
  const attached = source.slice(attachedStart, widgetStart);
  const widget = source.slice(widgetStart, source.indexOf("window.addEventListener('keydown'", widgetStart));
  for (const [surface, block] of [['attached', attached], ['widget', widget]]) {
    const cancel = block.indexOf('await host.pickWindowCancel()');
    const begin = block.indexOf('host.pickWindowBegin(members)');
    assert.ok(cancel >= 0 && begin > cancel, `${surface} cancels an orphan before beginning`);
    assert.match(block, /begin\.error \|\| 'Direct pick is unavailable'/,
      `${surface} exposes the real begin failure instead of masking it`);
  }
  assert.match(widget, /result\.outcome !== 'committed'/,
    'widget direct pick does not submit a cancelled native result');
  assert.match(widget, /client\.sendCommandAndWait\([\s\S]*picker-commit/,
    'widget direct pick waits for the authoritative picker commit');
  assert.match(widget, /acknowledgement\?\.type === 'stale'/,
    'widget direct pick retries once after a revision race');
  assert.match(attached, /windowLayoutRuntime\.pickUnsubscribe === pickUnsubscribe/,
    'an older attached attempt cannot unsubscribe a newer attempt');
  assert.match(widget, /widgetState\.pickUnsubscribe === pickUnsubscribe/,
    'an older widget attempt cannot unsubscribe a newer attempt');
  assert.match(widget, /const pickAttempt = Symbol\('window-layout-widget-direct-pick'\)/,
    'widget direct pick owns a per-attempt token like the attached surface');
  assert.match(widget, /widgetState\.pickAttempt !== pickAttempt/,
    'a superseded widget attempt stops after awaited host/channel work');
  assert.match(widget, /widgetState\.pickAttempt === pickAttempt/,
    'only the current widget attempt may clear shared picker ownership');
  assert.match(source, /function uniqueWindowLayoutMemberDescriptors\(members\)/,
    'duplicate saved members are collapsed before they can brick native preparation');
  assert.doesNotMatch(source, /unique\.set\(key, descriptor\)/,
    'picker begin never forwards persisted descriptor extras such as windowInstanceId');
  assert.match(source, /unique\.set\(key, \{[\s\S]*?version: 1,[\s\S]*?title: descriptor\.title,[\s\S]*?executableFingerprint: descriptor\.executableFingerprint,[\s\S]*?\}\)/,
    'picker begin rebuilds the exact legacy three-field preload descriptor');
  assert.equal((source.match(/uniqueWindowLayoutMemberDescriptors\(/g) ?? []).length, 3,
    'both attached and widget surfaces use the shared descriptor deduplication');
});

test('pagehide explicitly releases active native direct-pick ownership on both surfaces', async () => {
  const source = await readFile(new URL('./public/workspace-20260730b.js', import.meta.url), 'utf8');

  const teardownStart = source.indexOf('function teardownWindowLayoutRecording()');
  const teardownEnd = source.indexOf('// 018X1: pagehide', teardownStart);
  const teardown = source.slice(teardownStart, teardownEnd);
  assert.match(teardown, /const hadActivePick = Boolean\(windowLayoutRuntime\.pickAttempt \|\| windowLayoutRuntime\.pickUnsubscribe\)/);
  assert.match(teardown, /host\.pickWindowCancel\(\)\.catch\(\(\) => undefined\)/,
    'workspace pagehide releases a still-owned Papers picker instead of only dropping its listener');

  const widgetStart = source.indexOf('function bootstrapWindowLayoutWidget()');
  const pagehideStart = source.indexOf("  window.addEventListener('pagehide', () => {", widgetStart);
  const pagehideEnd = source.indexOf('// 035/037/039:', pagehideStart);
  const widgetPagehide = source.slice(pagehideStart, pagehideEnd);
  assert.match(widgetPagehide, /const hadActivePick = Boolean\(widgetState\.pickAttempt \|\| widgetState\.pickUnsubscribe\)/);
  assert.match(widgetPagehide, /widgetState\.pickAttempt = null/);
  assert.match(widgetPagehide, /host\.pickWindowCancel\(\)\.catch\(\(\) => undefined\)/,
    'widget pagehide invalidates the attempt and releases native ownership before the surface disappears');
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

test('picker apply waits for the durable workspace commit and reports persistence failure', async () => {
  let state = makeState([makeLayout('L1', [])]);
  let releaseCommit;
  const durable = new Promise((resolve) => { releaseCommit = resolve; });
  const applier = createWindowLayoutPickApplier({
    getState: () => state,
    commitState: (next) => { state = next; return durable; },
    observeCapability: async () => ({
      outcome: 'success',
      observation: { bounds: { x: 0, y: 0, width: 100, height: 80 }, state: 'normal' },
    }),
    model: {
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
    },
    capabilities: new Map(),
    icons: new Map(),
  });
  const pending = applier.apply('L1', {
    outcome: 'committed',
    adds: [{
      descriptor: descriptorOn('Chrome', FINGERPRINT_B),
      capability: capabilityFor('Chrome'),
      candidate: { icon: 'data:image/png;base64,AAAA' },
    }],
    removes: [],
  });
  let settled = false;
  void pending.then(() => { settled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false, 'the picker cannot ACK committed before the durable store promise settles');
  releaseCommit(false);
  const applied = await pending;
  assert.equal(applied.outcome, 'failed');
  assert.match(applied.error, /persistence/i);
});

test('bound list-pick identity treats same title on another executable as an add', () => {
  const members = makeLayout('L1', [{ id: 'chrome-a', title: 'Inbox', fingerprint: FINGERPRINT_A }]).arrangement.members;
  const differentExecutable = {
    descriptor: descriptorOn('Inbox', FINGERPRINT_B),
    capability: capabilityFor('Inbox'),
  };
  const add = windowLayoutPickForBoundCandidate(members, differentExecutable, { icon: 'data:second' });
  assert.equal(add.adds.length, 1);
  assert.equal(add.removes.length, 0);
  assert.equal(add.adds[0].descriptor.executableFingerprint, FINGERPRINT_B);

  const exact = {
    descriptor: descriptorOn('Inbox', FINGERPRINT_A),
    capability: capabilityFor('Inbox'),
  };
  const remove = windowLayoutPickForBoundCandidate(members, exact);
  assert.equal(remove.adds.length, 0);
  assert.deepEqual(remove.removes, [{ descriptor: exact.descriptor }]);
});
test('attached and detached list picks use bound descriptor identity and the shared durable writer', async () => {
  const source = await readFile(new URL('./public/workspace-20260730b.js', import.meta.url), 'utf8');
  const attachedStart = source.indexOf('async function handleWindowLayoutPickCandidate(layoutId, candidateId)');
  const attachedEnd = source.indexOf('/** 019B: bounded concurrent group scheduling.', attachedStart);
  const attached = source.slice(attachedStart, attachedEnd);
  assert.match(attached, /windowLayoutPickForBoundCandidate\(/);
  assert.match(attached, /await applyWindowLayoutPickSet\(/);
  assert.doesNotMatch(attached, /store\.commit\(|saveWorkspaceView\(|descriptor\.title\s*===\s*row\.title/,
    'attached list picking has no title-only or side-channel persistence path');

  const widgetStart = source.indexOf('  async function handleWidgetListCandidate(candidateId)');
  const widgetEnd = source.indexOf('  async function beginWidgetDirectPick()', widgetStart);
  const widget = source.slice(widgetStart, widgetEnd);
  assert.match(widget, /windowLayoutPickForBoundCandidate\(/);
  assert.doesNotMatch(widget, /selectedOverride|descriptor\.title\s*===\s*bound\.descriptor\.title/,
    'detached list picking decides add/remove only after binding the persisted descriptor pair');

  const commandStart = source.indexOf("    if (command.kind === 'picker-commit')");
  const commandEnd = source.indexOf("    return { ok: false, error: 'unknown command' };", commandStart);
  const command = source.slice(commandStart, commandEnd);
  assert.match(command, /applied\.outcome === 'failed'/);
  assert.match(command, /ok: false, error: applied\.error/,
    'a failed durable picker commit is an error ACK, never a false committed result');
});

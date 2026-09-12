// What Quick Run's keys are wired to, asserted where each half now lives.
//
// This file used to assert the wiring as source shape because the entry file cannot be imported here: it
// reads the document at load time and boots the whole workspace. That is still true of the entry, but the
// wiring has moved out of it - `public/app/quick-run/quick-run-workspace.js` is the composition seam, and
// `quick-run-workspace.test.mjs` drives it for real: production markup, a real store, the real command
// object, a typed query and a keypress. So the shape assertions here are about the seam's internals (which
// keys exist, which plan decides, that no second launcher was smuggled in) and about the one thing that is
// still entry-only: the element adapter that maps dom.js's registry keys onto the handles the surface takes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./public/workspace-20260730b.js', import.meta.url), 'utf8');
const binding = await readFile(new URL('./public/app/quick-run/quick-run-workspace.js', import.meta.url), 'utf8');

const regionStart = source.indexOf('// Quick Run (STAGE 5)');
const regionEnd = source.indexOf('const keyboard = createKeyboardController({');
const region = regionStart >= 0 && regionEnd > regionStart ? source.slice(regionStart, regionEnd) : '';

test('the workspace binding hands Quick Run an activation path (STAGE 5, step 4)', () => {
  assert.notEqual(region, '', 'the Quick Run region is where the seam is composed');
  assert.match(region, /bindQuickRunWorkspace\(\{/, 'the entry composes the binding rather than the wiring');
  assert.match(binding, /onActivate:/, 'Enter has somewhere to go');
  assert.match(
    binding,
    /revalidateQuickRunRow\(getState\(\), resultKey\)/,
    'the row is re-read from the current state by its stable key before anything happens (section 5)',
  );
  assert.match(
    binding,
    /commands\.activateItem\(itemId\)/,
    'execution names the workspace command Enter already uses (sections 1.5 and 6.4)',
  );
  assert.match(binding, /setStatus\(/, 'a row that cannot run says why instead of doing nothing (section 1.6)');
  assert.match(
    binding,
    /import \{[\s\S]*?\} from '\.\/quick-run-activation\.js';/,
    'the plan comes from the module that owns it rather than being rebuilt in the binding',
  );
  for (const imported of [
    'planQuickRunActivation',
    'planQuickRunReveal',
    'planQuickRunShiftEnter',
    'quickRunWorkspaceItemId',
    'revalidateQuickRunRow',
    'QUICK_RUN_ADD_NO_ACTIVE_LAYOUT',
    'QUICK_RUN_ADD_ONLY_LAYOUT_ITEMS',
  ]) {
    assert.match(binding, new RegExp(`${imported},`), `${imported} is imported from the activation module`);
  }
  // The entry keeps the adapter and the collaborators, and nothing else: a second plan or a second key
  // handler there would be the copy the seam exists to remove.
  for (const moved of ['onActivate', 'onShiftEnter', 'onReveal', 'planQuickRun']) {
    assert.equal(region.includes(moved), false, `${moved} lives in the binding, not in the entry`);
  }
});

test('Shift+Enter copies the member into the active layout, refusing a duplicate first (sections 1.6 and 10)', () => {
  assert.match(binding, /onShiftEnter: \(resultKey\) =>/, 'the key has a handler rather than a placeholder');
  assert.match(binding, /planQuickRunShiftEnter\(current\.row, \{ activeLayoutId: state\.activeWindowLayoutId \?\? null \}/, 'the plan decides whether it is available');
  assert.match(
    binding,
    /quickRunDuplicateMemberId\(member\.descriptor, target\.arrangement\?\.members\)/,
    'the duplicate check is on the persisted descriptor, before the write rather than after it',
  );
  assert.match(binding, /store\.replace\(addWindowLayoutMember\(state, plan\.target\.layoutId, member\)\)/, 'and the write is the model own add, not a second implementation of it');
  assert.match(binding, /already in the active layout/, 'a duplicate is reported rather than silently ignored');
  assert.match(
    binding,
    /quickRunDuplicateMemberId,/,
    'the helper is imported rather than assumed to be in scope',
  );
});
test('Ctrl+Enter reveals the occurrence inside the workspace (section 1.6)', () => {
  assert.match(binding, /onReveal: \(resultKey\) =>/, 'the mount has somewhere to hand the key');
  assert.match(
    binding,
    /const reveal = planQuickRunReveal\(current\.row\)/,
    'the plan is what decides where the reveal goes, from the row re-read out of the current tree',
  );
  assert.match(binding, /commands\.activateItem\(reveal\.navigateTo\)/, 'it navigates to the folder the occurrence lives in');
  assert.match(binding, /commands\.selectItem\(reveal\.select,/, 'and selects the occurrence itself');
  assert.match(
    binding,
    /visibleItemIds: getVisibleItemIds\(\)/,
    'the workspace own selection command takes the visible ids, supplied by the entry rather than reinvented',
  );
  assert.match(binding, /if \(!reveal\)/, 'a row with no occurrence to reveal says so instead of selecting nothing');
});

test('Shift+Enter is visibly disabled with a reason, and never silently ignored (section 1.6)', () => {
  assert.match(binding, /shiftEnterNotice: \(row\) =>/, 'the affordance is computed per highlighted row');
  assert.match(
    binding,
    /planQuickRunShiftEnter\(row, \{ activeLayoutId: getState\(\)\.activeWindowLayoutId \?\? null \}\)/,
    'enabled only for Layout Items in an active layout, decided by the plan rather than by the binding',
  );
  assert.match(binding, /onShiftEnter:/, 'an enabled press has somewhere to go');
  for (const reason of ['QUICK_RUN_ADD_NO_ACTIVE_LAYOUT', 'QUICK_RUN_ADD_ONLY_LAYOUT_ITEMS']) {
    assert.match(binding, new RegExp(reason), `${reason} is shown as a sentence rather than left as a code`);
  }
  assert.match(region, /notice: elements\.quickRunNotice,/, 'the line the reason is painted into is handed over');
});

test('Quick Run cannot render the workspace or reheat the graph: it holds no reference to either', async () => {
  const modules = [
    'quick-run-types.js',
    'quick-run-search.js',
    'quick-run-index.js',
    'quick-run-session.js',
    'quick-run-presentation.js',
    'quick-run-surface.js',
    'quick-run-activation.js',
  ];
  const sources = await Promise.all(
    modules.map((name) => readFile(new URL(`./public/app/quick-run/${name}`, import.meta.url), 'utf8')),
  );
  for (const [index, text] of sources.entries()) {
    for (const forbidden of ['render(', 'reheat', 'MutationObserver', 'ResizeObserver', 'setInterval', 'requestAnimationFrame']) {
      assert.equal(
        text.includes(forbidden),
        false,
        `${modules[index]} must not reference ${forbidden} (sections 6.2 and 6.3): a keystroke cannot rebuild the workspace or restart physics it cannot reach`,
      );
    }
  }
  // The typing guarantee is the module scan above: none of the seven modules contains `render(`, so a
  // keystroke cannot repaint the workspace. The binding is not one of them — it is the composition seam and
  // it is allowed exactly one render call, in the state-mutation callback: adding a member to a layout
  // changes persisted state, and refusing to repaint after that would be the bug, not the rule. The entry's
  // region does not call render at all; it hands the workspace's own render to the binding.
  assert.equal(binding.split('render(').length - 1, 1, 'the binding renders in exactly one place');
  assert.ok(
    binding.indexOf('render(') > binding.indexOf('onShiftEnter'),
    'and that place is the Shift+Enter mutation, not a keystroke path',
  );
  assert.equal(binding.includes('reheat'), false);
  assert.match(region, /render: \(\) => render\(\),/, 'the entry hands its own render over rather than calling it');
  assert.equal(region.includes('reheat'), false);
});

test('the four Quick Run elements meet their handles by name, checked across all three files', async () => {
  // A mismatch here does not fail a test anywhere else: the surface is driven by a harness that already
  // uses the short names, so only the real entry file can be wrong, and only the running app would show
  // it. This is the lockstep check for that seam - markup id, registry key, and the handle the surface
  // is handed.
  const [markup, registry] = await Promise.all([
    readFile(new URL('./public/workspace-20260730b.html', import.meta.url), 'utf8'),
    readFile(new URL('./public/app/dom.js', import.meta.url), 'utf8'),
  ]);
  const ids = [...markup.matchAll(/id="(quick-run-[a-z-]+)"/g)].map((match) => match[1]).sort();
  const registered = [...registry.matchAll(/(\w+): requiredElement\(document, '#(quick-run-[a-z-]+)'\)/g)]
    .map((match) => ({ key: match[1], id: match[2] }));
  assert.deepEqual(
    registered.map((entry) => entry.id).sort(),
    ids,
    'every quick-run element in the markup is registered, and the registry invents none',
  );
  const mapped = region.match(/elements: \{([\s\S]*?)\},/);
  assert.notEqual(mapped, null, 'the entry file adapts the registry to the handles the surface takes');
  for (const { key } of registered) {
    assert.match(
      mapped[1],
      new RegExp(`${key.replace('quickRun', '').toLowerCase()}: elements\\.${key},`),
      `${key} is handed over as the handle the surface reads`,
    );
  }
});

test('Quick Run activation adds no second launcher and no reveal path (sections 1.6 and 6.4)', () => {
  for (const text of [region, binding]) {
    for (const forbidden of [
      'revealShortcut',
      'revealSelection',
      'launchShortcut',
      'openWebLink',
      'host.',
      'setInterval',
      'fetch(',
    ]) {
      assert.equal(
        text.includes(forbidden),
        false,
        `${forbidden} must not appear in Quick Run's activation wiring`,
      );
    }
  }
});

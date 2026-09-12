// STAGE 5's last step lives in the entry file, which cannot be imported here: it reads the document at
// load time and boots the whole workspace. So the wiring is asserted by halves, the way this repository
// already asserts entry-file wiring elsewhere — the region that mounts Quick Run is read as source and
// checked for the calls the contract requires, and each of those calls has its own behavioural test in
// quick-run-activation.test.mjs. What this file can prove is the shape: that Enter goes somewhere, that
// the somewhere is the workspace's existing execution path, and that no second launcher or reveal path
// was smuggled in beside it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./public/workspace-20260730b.js', import.meta.url), 'utf8');

const regionStart = source.indexOf('// Quick Run (STAGE 5)');
const regionEnd = source.indexOf('const keyboard = createKeyboardController({');
const region = regionStart >= 0 && regionEnd > regionStart ? source.slice(regionStart, regionEnd) : '';

test('the entry file hands Quick Run an activation path (STAGE 5, step 4)', () => {
  assert.notEqual(region, '', 'the Quick Run region is where the surface is mounted');
  assert.match(region, /onActivate:/, 'Enter has somewhere to go');
  assert.match(
    region,
    /revalidateQuickRunRow\(state, resultKey\)/,
    'the row is re-read by its stable key before anything happens (section 5)',
  );
  assert.match(
    region,
    /commands\.activateItem\(itemId\)/,
    'execution names the workspace command Enter already uses (sections 1.5 and 6.4)',
  );
  assert.match(region, /setStatus\(/, 'a row that cannot run says why instead of doing nothing (section 1.6)');
  assert.match(
    source,
    /import \{[\s\S]*?\} from '\.\/app\/quick-run\/quick-run-activation\.js';/,
    'the plan comes from the module that owns it rather than being rebuilt in the entry file',
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
    assert.match(source, new RegExp(`${imported},`), `${imported} is imported from the activation module`);
  }
});

test('Shift+Enter copies the member into the active layout, refusing a duplicate first (sections 1.6 and 10)', () => {
  assert.match(region, /onShiftEnter: \(resultKey\) =>/, 'the key has a handler rather than a placeholder');
  assert.match(region, /planQuickRunShiftEnter\(current\.row, \{ activeLayoutId: state\.activeWindowLayoutId/, 'the plan decides whether it is available');
  assert.match(
    region,
    /quickRunDuplicateMemberId\(member\.descriptor, target\.arrangement\?\.members\)/,
    'the duplicate check is on the persisted descriptor, before the write rather than after it',
  );
  assert.match(region, /store\.replace\(addWindowLayoutMember\(state, plan\.target\.layoutId, member\)\)/, 'and the write is the model own add, not a second implementation of it');
  assert.match(region, /already in the active layout/, 'a duplicate is reported rather than silently ignored');
  assert.match(
    source,
    /quickRunDuplicateMemberId,/,
    'the helper is imported rather than assumed to be in scope',
  );
});
test('Ctrl+Enter reveals the occurrence inside the workspace (section 1.6)', () => {
  assert.match(region, /onReveal: \(resultKey\) =>/, 'the mount has somewhere to hand the key');
  assert.match(
    region,
    /const reveal = planQuickRunReveal\(current\.row\)/,
    'the plan is what decides where the reveal goes, from the row re-read out of the current tree',
  );
  assert.match(region, /commands\.activateItem\(reveal\.navigateTo\)/, 'it navigates to the folder the occurrence lives in');
  assert.match(region, /commands\.selectItem\(reveal\.select,/, 'and selects the occurrence itself');
  assert.match(
    region,
    /visibleItemIds: visibleItemIds\(\)/,
    'the workspace own selection command takes the visible ids, supplied here rather than reinvented',
  );
  assert.match(region, /if \(!reveal\)/, 'a row with no occurrence to reveal says so instead of selecting nothing');
});

test('Shift+Enter is visibly disabled with a reason, and never silently ignored (section 1.6)', () => {
  assert.match(region, /shiftEnterNotice: \(row\) =>/, 'the affordance is computed per highlighted row');
  assert.match(
    region,
    /planQuickRunShiftEnter\(row, \{ activeLayoutId: state\.activeWindowLayoutId \?\? null \}\)/,
    'enabled only for Layout Items in an active layout, decided by the plan rather than by the entry file',
  );
  assert.match(region, /onShiftEnter:/, 'an enabled press has somewhere to go');
  for (const reason of ['QUICK_RUN_ADD_NO_ACTIVE_LAYOUT', 'QUICK_RUN_ADD_ONLY_LAYOUT_ITEMS']) {
    assert.match(region, new RegExp(reason), `${reason} is shown as a sentence rather than left as a code`);
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
  // keystroke cannot repaint the workspace. The entry region is allowed exactly one render call, and it
  // must sit in the state-mutation callback: adding a member to a layout changes persisted state, and
  // refusing to repaint after that would be the bug, not the rule.
  const renderCalls = region.split('render(').length - 1;
  assert.equal(renderCalls, 1, 'the Quick Run region renders in exactly one place');
  assert.ok(
    region.indexOf('render(') > region.indexOf('onShiftEnter'),
    'and that place is the Shift+Enter mutation, not a keystroke path',
  );
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
      region.includes(forbidden),
      false,
      `${forbidden} must not appear in Quick Run's activation wiring`,
    );
  }
});

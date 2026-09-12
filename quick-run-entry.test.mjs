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
    /import \{ planQuickRunActivation, quickRunWorkspaceItemId, revalidateQuickRunRow \} from '\.\/app\/quick-run\/quick-run-activation\.js';/,
    'the plan comes from the module that owns it rather than being rebuilt in the entry file',
  );
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
  assert.equal(region.includes('render('), false, 'the entry wiring does not render on a keystroke either');
  assert.equal(region.includes('reheat'), false);
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

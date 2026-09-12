// Ephemeral availability: what is known about a layout item after something asked (section 10.1).
//
// The rule this file holds is narrow on purpose. Availability is never persisted, an untouched item is
// `unknown`, and a noted answer survives only while the descriptor it was noted against still describes
// the row - because a member whose descriptor changed is a different window as far as the surface can
// tell, which is section 10.5's reset. Whether the live resolution and activation ever happen is a
// separate question and is not claimed here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openQuickRunSession, quickRunSessionWithQuery } from './public/app/quick-run/quick-run-session.js';
import {
  quickRunDescriptorFingerprint,
  quickRunRowViews,
} from './public/app/quick-run/quick-run-presentation.js';
import { availabilityAfterResolution } from './public/app/quick-run/quick-run-resolution.js';

const layoutState = (title = 'Chrome') => ({
  groups: [{ id: 'g-root', parentId: 'root', name: 'Workspace' }],
  shortcuts: [],
  windowLayouts: [
    {
      id: 'l-1',
      parentId: 'g-root',
      name: 'Focus',
      arrangement: { members: [{ id: 'm-1', descriptor: { title } }] },
    },
  ],
});

const viewsOf = (state, noted) => quickRunRowViews(quickRunSessionWithQuery(openQuickRunSession(state), 'chrome'), noted);
const viewFor = (state, noted) => viewsOf(state, noted)[0];

const note = (state, availability) => {
  const row = viewsOf(state, undefined)[0];
  return { [row.key]: { availability, descriptor: quickRunDescriptorFingerprint({ ...row, ...rowIdentity(state) }) } };
};

/** The fields the fingerprint reads, taken from the state because a view carries the display name only. */
function rowIdentity(state) {
  const member = state.windowLayouts[0].arrangement.members[0];
  return { layoutId: 'l-1', memberId: member.id, name: member.descriptor.title };
}

test('an untouched layout item is unknown, and nothing else has availability at all', () => {
  const folderState = layoutState();
  assert.equal(viewFor(layoutState(), undefined).availability, 'unknown');
  const folders = quickRunRowViews(quickRunSessionWithQuery(openQuickRunSession(folderState), 'workspace'), undefined);
  assert.equal(folders.length, 1, 'the folder row is there to be asked about');
  assert.equal(folders[0].availability, null, 'and a folder has no availability at all');
});

test('a missing outcome leaves the row searchable and says unavailable (sections 10.3 and 10.4)', () => {
  const state = layoutState();
  const noted = note(state, availabilityAfterResolution('missing'));
  assert.equal(viewFor(state, noted).availability, 'unavailable');
  assert.equal(viewsOf(state, noted).length, 1, 'the occurrence is still in the list: a failed resolution is not a removal');
  assert.equal(viewsOf(state, noted)[0].primary, 'Chrome', 'and it still shows what it is');
});

test('an ambiguous outcome says unavailable, and says nothing about which window it meant', () => {
  const state = layoutState();
  const noted = note(state, availabilityAfterResolution('ambiguous'));
  assert.equal(viewFor(state, noted).availability, 'unavailable');
  assert.equal(viewsOf(state, noted).length, 1);
});

test('a unique resolution that was activated says available', () => {
  const state = layoutState();
  const noted = note(state, availabilityAfterResolution('unique'));
  assert.equal(viewFor(state, noted).availability, 'available');
});

test('a descriptor change resets the noted answer to unknown (section 10.5)', () => {
  const state = layoutState();
  const noted = note(state, availabilityAfterResolution('unique'));
  assert.equal(viewFor(state, noted).availability, 'available', 'while the descriptor is the one that was seen');
  const retitled = layoutState('Chrome Canary');
  assert.equal(
    viewFor(retitled, noted).availability,
    'unknown',
    'a member whose title changed is treated as a different window, so the prior answer does not survive it',
  );
});

test('a noted answer belongs to one occurrence, and reopening forgets all of them', () => {
  const state = layoutState();
  const noted = note(state, availabilityAfterResolution('missing'));
  const other = { ...layoutState(), windowLayouts: [
    layoutState().windowLayouts[0],
    {
      id: 'l-2',
      parentId: 'g-root',
      name: 'Second',
      arrangement: { members: [{ id: 'm-2', descriptor: { title: 'Chrome' } }] },
    },
  ] };
  const views = quickRunRowViews(quickRunSessionWithQuery(openQuickRunSession(other), 'chrome'), noted);
  assert.equal(views.length, 2, 'two occurrences of the same descriptor');
  assert.deepEqual(
    views.map((view) => view.availability),
    ['unavailable', 'unknown'],
    'the noted answer stays with the occurrence it was noted for',
  );
  assert.equal(
    quickRunRowViews(quickRunSessionWithQuery(openQuickRunSession(state), 'chrome'), {})[0].availability,
    'unknown',
    'and a session opened with nothing noted knows nothing, which is what reopening is',
  );
});

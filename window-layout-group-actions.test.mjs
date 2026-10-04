import assert from 'node:assert/strict';
import test from 'node:test';
import { createWindowLayoutGroupActions as makeActions } from './public/app/window-layout-group-actions.js';
function harness(overrides = {}) {
  let state = { marker: 'initial' }; let readOnly = false;
  const members = ['a','b','c'].map(id => ({id})); const calls = []; const selectedMembers = new Map(); const capabilities = new Map();
  const deps = {
    getState: () => state, windowLayoutDetachment: { isReadOnly: () => readOnly },
    windowLayoutFromState: () => ({arrangement:{members}}), windowLayoutMemberFromState: (_layout,id) => members.find(m => m.id === id),
    windowLayoutRuntime: { selectedMembers, capabilities }, windowLayoutMemberKey: (layout,id) => `${layout}:${id}`,
    host: { windowControlGroup: async (id, actions) => { calls.push(['host', id, actions]); return {outcome:'success'}; }, observeWindowCapability: async () => ({outcome:'success',observation:{state:'normal'}}) },
    updateWindowLayoutMember: (current,layout,id,patch) => { calls.push(['update', current.marker, layout,id,patch]); return current; },
    store: { replace: (next) => { state = next; calls.push(['replace']); } },
    noteWindowLayoutCommit: id => calls.push(['note',id]), queueWindowLayoutSave: () => calls.push(['save']),
    setWindowLayoutStatus: (id,text) => calls.push(['status',id,text]),
    windowLayoutRecording: { ensureRecording: async id => calls.push(['record',id]) },
    capabilityForMember: async () => ({bindingId:'cap'}),
    windowLayoutRuntimeController: { invalidateCapabilities: id => calls.push(['invalidate',id]) },
    windowLayoutStatusForOutcome: outcome => `status:${outcome}`, ...overrides,
  };
  return { actions: makeActions(deps), calls, selectedMembers, capabilities, deps, setState: next => { state = next; }, setReadOnly: value => { readOnly = value; } };
}
test('group uses all members, then replaces, notes, queues one save and ensures recording', async () => {
  const h = harness(); await h.actions.groupAction('L','minimize');
  assert.deepEqual(h.calls[0], ['host','L',['a','b','c'].map(memberId => ({memberId,operation:'minimize'}))]);
  assert.deepEqual(h.calls.slice(4), [['replace'],['note','L'],['save'],['status','L',''],['record','L']]);
});
test('explicit range overrides local selection without changing it', async () => {
  const h = harness(); h.selectedMembers.set('L',new Set(['a'])); await h.actions.groupAction('L','restore',['b']);
  assert.deepEqual(h.calls[0][2], [{memberId:'b',operation:'restore'}]); assert.deepEqual([...h.selectedMembers.get('L')],['a']);
});
test('isolate restores selection then minimizes only its unselected siblings', async () => {
  const h = harness(); h.selectedMembers.set('L',new Set(['b'])); await h.actions.groupAction('L','isolate');
  assert.deepEqual(h.calls[0][2], [{memberId:'b',operation:'restore'},{memberId:'a',operation:'minimize'},{memberId:'c',operation:'minimize'}]);
});
test('unavailable broker refuses locally without persistence or recording', async () => {
  const h = harness({host:{windowControlGroup:async () => { throw Error('outage'); }}}); await h.actions.groupAction('L','restore');
  assert.deepEqual(h.calls,[['status','L','Native window control is unavailable.']]);
});
test('handoff during broker await produces no state or presentation effect', async () => {
  const h = harness(); h.deps.host.windowControlGroup = async () => { h.setReadOnly(true); return {outcome:'success'}; };
  await h.actions.groupAction('L','restore'); assert.deepEqual(h.calls,[]);
});
test('successful batch patches the latest state after broker await', async () => {
  const h = harness(); h.deps.host.windowControlGroup = async () => { h.setState({marker:'peer'}); return {outcome:'success'}; };
  await h.actions.groupAction('L','restore'); assert.equal(h.calls.find(c => c[0] === 'update')[1],'peer');
});
test('range probes once and restores the clicked minimized member when selection is empty', async () => {
  const h = harness(); let observes = 0;
  h.deps.host.observeWindowCapability = async () => { observes++; return {outcome:'success',observation:{state:'minimized'}}; };
  await h.actions.toggleRange('L','b'); assert.equal(observes,1); assert.deepEqual(h.calls[0][2],[{memberId:'b',operation:'restore'}]);
});
test('missing range probe evicts only clicked capability and invalidates without saving', async () => {
  const h = harness(); h.capabilities.set('L:b',{}); h.capabilities.set('L:a',{});
  h.deps.host.observeWindowCapability = async () => ({outcome:'missing'});
  await h.actions.toggleRange('L','b'); assert.equal(h.capabilities.has('L:b'),false); assert.equal(h.capabilities.has('L:a'),true);
  assert.deepEqual(h.calls,[['invalidate','L'],['status','L','status:missing']]);
});

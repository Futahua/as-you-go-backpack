import assert from 'node:assert/strict';
import test from 'node:test';
import { createWindowLayoutWidgetLifecycle } from './public/app/window-layout-widget-lifecycle.js';
function makeLifecycle(options) {
  return createWindowLayoutWidgetLifecycle({
    getState: () => ({}), detachmentMode: () => 'attached', isReadOnly: () => false,
    itemsIn: (state) => state.windowLayouts ?? [], wait: async () => {}, ...options,
  });
}
test('open success predicate preserves all accepted and negative host shapes', () => {
  const lifecycle = makeLifecycle({ widgetOpen: async () => ({}) });
  for (const value of [null, undefined, false, { ok: false }, { widget: { ok: false } }, { outcome: 'failed' }, { outcome: 'error' }]) assert.equal(lifecycle.succeeded(value), false);
  for (const value of [{}, { ok: true }, { outcome: 'success' }, { widget: { ok: true } }]) assert.equal(lifecycle.succeeded(value), true);
});
test('direct opens pass exact options and succeed without a delay', async () => {
  const calls = []; const result = { ok: true }; const options = { activate: true };
  const lifecycle = makeLifecycle({ widgetOpen: async (...args) => { calls.push(args); return result; }, wait: async () => assert.fail('no wait') });
  assert.equal(await lifecycle.open('L1', options), result); assert.deepEqual(calls, [['L1', options]]);
});
test('transient errors retry at 100 then 200 milliseconds and retain final result', async () => {
  const delays = []; let attempts = 0; const result = { ok: true };
  const lifecycle = makeLifecycle({ widgetOpen: async () => { attempts++; if (attempts === 1) throw Error('outage'); return attempts === 2 ? { ok: false } : result; }, wait: async (ms) => { delays.push(ms); } });
  assert.equal(await lifecycle.open('L1'), result); assert.equal(attempts, 3); assert.deepEqual(delays, [100, 200]);
});
test('exhausted errors remain local and return null after exactly three attempts', async () => {
  let attempts = 0; const lifecycle = makeLifecycle({ widgetOpen: async () => { attempts++; throw Error('outage'); } });
  assert.equal(await lifecycle.open('L1'), null); assert.equal(attempts, 3);
});
test('startup filters docked, binned and absent placements; opens sequentially without activation', async () => {
  const state = { windowLayoutPillIds: ['dock'], windowLayouts: [{id:'first',parentId:'p'}, {id:'dock'}, {id:'bin',binned:true}, {id:'old-bin',bin:{}}, {id:'absent'}, {id:'last',parentId:'p'}] };
  const calls = []; let active = 0;
  const lifecycle = makeLifecycle({ getState: () => state, itemsIn: (_state, parent) => parent === 'p' ? [{id:'first'},{id:'last'}] : [], widgetOpen: async (...args) => { assert.equal(active++, 0); calls.push(args); await Promise.resolve(); active--; return {ok:true}; } });
  await lifecycle.ensureStartup(); assert.deepEqual(calls, [['first',{activate:false}],['last',{activate:false}]]);
});
for (const gate of [{ detachmentMode: () => 'detached' }, { isReadOnly: () => true }]) {
  test('detached/read-only startup performs no host call', async () => {
    const lifecycle = makeLifecycle({ ...gate, widgetOpen: async () => assert.fail('blocked'), getState: () => ({windowLayouts:[{id:'L1'}]}) });
    await lifecycle.ensureStartup();
  });
}
test('one exhausted widget does not prevent opening the next layout', async () => {
  const calls = []; const lifecycle = makeLifecycle({ getState: () => ({windowLayouts:[{id:'bad'},{id:'good'}]}), widgetOpen: async (id) => { calls.push(id); return {ok:id === 'good'}; } });
  await lifecycle.ensureStartup(); assert.deepEqual(calls, ['bad','bad','bad','good']);
});

test('empty startup asks the checked workspace owner for a layout before opening', async () => {
 const state={windowLayouts:[]};let created=0;const opened=[];
 const lifecycle=makeLifecycle({getState:()=>state,ensureLayout:async()=>{created++;state.windowLayouts.push({id:'original',parentId:'root'});},widgetOpen:async(id)=>{opened.push(id);return {ok:true};}});
 await lifecycle.ensureStartup();assert.equal(created,1);assert.deepEqual(opened,['original']);
});

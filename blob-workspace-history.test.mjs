import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspaceStore} from './public/app/workspace-store.js';
function fixture(historyEnabled){
  let state={items:[]};const saves=[];
  const store=createWorkspaceStore({getState:()=>state,setState:next=>{state=next;},normalizeState:value=>value,persist:async raw=>{saves.push(JSON.parse(raw));return {ok:true};},historyEnabled});
  return {store,saves,get state(){return state;}};
}
test('blob workspace edits persist without undo, redo or external-effect history',async()=>{
  const f=fixture(false);await f.store.commit({items:['file']});await f.store.commit({items:['renamed']});
  f.store.recordExternalEffect({undo(){throw Error('Must not replay');},redo(){throw Error('Must not replay');}});
  assert.equal(f.store.canUndo(),false);assert.equal(await f.store.undo(),false);assert.equal(await f.store.redo(),false);
  assert.deepEqual(f.state.items,['renamed']);assert.equal(f.saves.length,2);
});
test('standalone AYG retains its existing undo and redo',async()=>{
  const f=fixture(undefined);await f.store.commit({items:['file']});assert.equal(f.store.canUndo(),true);
  await f.store.undo();assert.deepEqual(f.state.items,[]);await f.store.redo();assert.deepEqual(f.state.items,['file']);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createStateSnapshot,readStateSnapshot,withStateSnapshots,snapshotDate} from './public/app/state-snapshots.js';
import {normalizeState} from './public/workspace-model-20260730b.js';

test('compressed snapshots preserve state and omit recursive backup history',async()=>{
  const state=normalizeState({groups:[{id:'g',name:'Folder',parentId:'root'}],shortcuts:[],view:{preferences:{navigatorSavedStates:[{mode:'ayg',currentId:'g',name:'Folder'}],stateSnapshots:[{data:'old'}]}}});
  const date=new Date('2026-10-06T18:00:00Z');
  const snapshot=await createStateSnapshot(state,'',date);
  assert.equal(snapshot.name,'2026-10-07');
  assert.equal(snapshotDate(date),'2026-10-07');
  const restored=await readStateSnapshot(snapshot);
  assert.deepEqual(restored.groups,state.groups);
  assert.deepEqual(restored.view.preferences.navigatorSavedStates,state.view.preferences.navigatorSavedStates);
  assert.equal(restored.view.preferences.stateSnapshots,undefined);
  assert.equal(state.view.preferences.stateSnapshots.length,1);
  assert.deepEqual(normalizeState(withStateSnapshots(restored,[snapshot])).view.preferences.stateSnapshots,[snapshot]);
});

test('snapshot metadata has no fixed workspace size ceiling',()=>{
  const state=normalizeState({});
  const records=[{data:'x'.repeat(5100000)}];
  assert.deepEqual(withStateSnapshots(state,records).view.preferences.stateSnapshots,records);
  assert.equal(state.view.preferences.stateSnapshots,undefined);
});

test('invalid snapshot payloads fail before restore',async()=>{
  await assert.rejects(readStateSnapshot({format:'bogus'}),/not supported/);
  await assert.rejects(readStateSnapshot({format:'gzip-base64',data:'bad!'}));
});


test('restore requires both independent confirmation stages and cancellation stops it',async()=>{
  const {confirmSnapshotRestore}=await import('./public/app/state-snapshots.js');
  const record={name:'2026-10-07',createdAt:'2026-10-07T01:00:00Z'};
  let finalCalls=0;
  assert.equal(await confirmSnapshotRestore(record,{verify:async()=>false,confirm:async()=>{finalCalls++;return true;}}),false);
  assert.equal(finalCalls,0);
  assert.equal(await confirmSnapshotRestore(record,{verify:async()=>true,confirm:async()=>{finalCalls++;return false;}}),false);
  assert.equal(finalCalls,1);
  assert.equal(await confirmSnapshotRestore(record,{verify:async()=>true,confirm:async question=>{assert.match(question.copy,/2026-10-07/);return true;}}),true);
});


test('file snapshots use existing file capabilities, read every chunk and reject changed bytes',async()=>{
  const {createFileStateSnapshot}=await import('./public/app/state-snapshots.js');
  const raw=JSON.stringify({schemaVersion:1,groups:[],shortcuts:[],view:{preferences:{}}});
  let content=raw;const calls=[];
  const capability=async(operation,params)=>{
    calls.push(operation);
    if(operation==='create-folder')return {ok:true,entry:{path:'D:/backups/one'}};
    if(operation==='copy')return {ok:true};
    if(operation==='preview-text-chunk')return {ok:true,text:content.slice(params.offset,params.offset+12),nextOffset:Math.min(content.length,params.offset+12),eof:params.offset+12>=content.length};
    throw new Error(operation);
  };
  const snapshot=await createFileStateSnapshot({directory:'D:/backups',statePath:'D:/project/state.json'},'Today',capability);
  assert.equal(snapshot.format,'file-json');assert.equal(snapshot.name,'Today');
  assert.deepEqual(await readStateSnapshot(snapshot,capability),JSON.parse(raw));
  assert.deepEqual(calls.slice(0,2),['create-folder','copy']);
  content=raw+' ';
  await assert.rejects(readStateSnapshot(snapshot,capability),/changed after/);
});

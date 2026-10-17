import {test} from 'node:test';import assert from 'node:assert/strict';import {applyFileTargetResult,createFileTargets,createFileTargetHost,createFileRecycleEffect,prepareFileTargetHistory} from './public/app/file-targets.js';

test('folder skull Undo restores disk children hidden by a binned ancestor and Redo recycles them',async()=>{
 const file={id:'file',target:'D:\\file.txt',placements:[{id:'p',parentId:'nested'}],fileTarget:{id:'ref',status:'present',revision:1}};
 const original={groups:[{id:'folder'},{id:'nested',parentId:'folder'}],shortcuts:[file]};
 const killed={groups:[{id:'folder',bin:{}},{id:'nested',parentId:'folder'}],shortcuts:[{...file,fileTarget:{id:'ref',status:'deleted',revision:2}}]};
 let restored=0,recycled=0;
 const owners={prepareRestore:async(state,ids)=>{assert.deepEqual(ids,['file']);restored++;return state;},deletePath:async()=>{recycled++;return{target:{targetId:'ref',status:'deleted',revision:4}};}};
 await prepareFileTargetHistory(killed,original,owners);assert.equal(restored,1);
 await prepareFileTargetHistory(original,killed,owners);assert.equal(recycled,1);
});
import {createWorkspaceStore} from './public/app/workspace-store.js';
const base=()=>({shortcuts:[{id:'one',target:'D:\\old.txt',name:'My label',icon:'custom',placements:[{id:'a',parentId:'root'},{id:'b',parentId:'folder'}]}],view:{preferences:{navigatorSavedStates:[{mode:'action',name:'Pin',art:{target:'D:\\old.txt',shortcutId:'one'}}]}}});
test('retargeting preserves record/placements/labels/icons and updates pills without duplicate entries',()=>{const s=base(),next=applyFileTargetResult(s,{kind:'shortcut',id:'one',path:'D:\\old.txt'},{targetId:'ref',status:'present',path:'D:\\new.txt',revision:2});assert.equal(next.shortcuts.length,1);assert.equal(next.shortcuts[0].name,'My label');assert.equal(next.shortcuts[0].icon,'custom');assert.deepEqual(next.shortcuts[0].placements,s.shortcuts[0].placements);assert.equal(next.view.preferences.navigatorSavedStates[0].art.target,'D:\\new.txt');});
test('confirmed deletion bins every placement, removes pills, and unavailable observations never bin',()=>{let s=base();const entry={kind:'shortcut',id:'one',path:'D:\\old.txt'};s=applyFileTargetResult(s,entry,{targetId:'ref',status:'unavailable'});assert.ok(s.shortcuts[0].placements.every(p=>!p.bin));s=applyFileTargetResult(s,entry,{targetId:'ref',status:'deleted'});assert.ok(s.shortcuts[0].placements.every(p=>p.bin));assert.equal(s.view.preferences.navigatorSavedStates.length,0);});
test('late replies cannot retarget an entry edited in the meantime',()=>{const s=base();s.shortcuts[0].target='D:\\different.txt';assert.equal(applyFileTargetResult(s,{kind:'shortcut',id:'one',path:'D:\\old.txt'},{targetId:'ref',status:'present',path:'D:\\moved.txt'}),s);});
test('effects resolve immediately, and deletion cannot fall back to a stale path',async()=>{let state=base(),mode='present';const calls=[];const original={fileCapability:async(op,p)=>{calls.push([op,p]);if(op.startsWith('file-target'))return{ok:true,target:{targetId:'ref',status:mode,path:'D:\\moved.txt',revision:1}};return{ok:true};}};const c=createFileTargets({host:original,getState:()=>state,save:fn=>{state=fn(state);return true;}});const host=createFileTargetHost(original,()=>c,id=>state.shortcuts.find(x=>x.id===id));try{await host.launchShortcut('one');assert.deepEqual(calls.at(-1),['open',{path:'D:\\moved.txt'}]);mode='missing';await assert.rejects(host.fileCapability('delete',{paths:['D:\\moved.txt']}),/verified|unavailable/);assert.ok(!calls.some(([op])=>op==='delete'));}finally{c.dispose();}});
test('disk deletion uses the owner reference and bins only after its receipt',async()=>{let state=base();const calls=[];const raw={fileCapability:async(op,p)=>{calls.push([op,p]);return{ok:true,target:{targetId:'ref',status:op==='file-target-delete'?'deleted':'present',path:'D:\\old.txt',revision:1}};}};const c=createFileTargets({host:raw,getState:()=>state,save:fn=>{state=fn(state);return true;}});const host=createFileTargetHost(raw,()=>c,()=>state.shortcuts[0]);try{await host.fileCapability('delete',{paths:['D:\\old.txt']});const request=calls.find(([op])=>op==='file-target-delete')[1];assert.equal(request.targetId,'ref');assert.equal(request.expectedRevision,1);assert.match(request.commandId,/^[a-f0-9-]{36}$/);assert.ok(state.shortcuts[0].placements.every(p=>p.bin));assert.ok(!calls.some(([op])=>op==='delete'));}finally{c.dispose();}});

test('a binned older identity cannot shadow the active file at the same path',async()=>{let state=base();state.shortcuts[0].placements.forEach(p=>p.bin={parentId:p.parentId});state.shortcuts[0].fileTarget={id:'retired'};state.shortcuts.push({...state.shortcuts[0],id:'active',fileTarget:{id:'current'},placements:[{id:'current-placement',parentId:'root'}]});const calls=[];const raw={fileCapability:async(op,p)=>{calls.push([op,p]);return {ok:true,target:{targetId:p.targetId,status:p.targetId==='retired'?'deleted':op==='file-target-delete'?'deleted':'present',path:'D:\\old.txt',revision:3}};}};const c=createFileTargets({host:raw,getState:()=>state,save:fn=>{state=fn(state);return true;}});try{assert.equal(await c.resolvePath('D:\\old.txt'),'D:\\old.txt');await c.deletePath('D:\\old.txt');assert.equal(calls.find(([op])=>op==='file-target-delete')[1].targetId,'current');assert.ok(!calls.some(([,p])=>p.targetId==='retired'));}finally{c.dispose();}});

test('restore verifies owner bytes before unbinning and keeps an entry on owner refusal',async()=>{let state=base();state.shortcuts[0].fileTarget={id:'ref',status:'deleted',revision:2};state.shortcuts[0].placements.forEach(p=>p.bin={parentId:p.parentId});let accept=false;const calls=[];const controller=createFileTargets({host:{async fileCapability(op,p){calls.push(op);return op==='file-target-resolve'?{ok:true,target:{targetId:'ref',status:'deleted',revision:2}}:accept?{ok:true,target:{targetId:'ref',status:'present',revision:3,path:'D:\\old.txt'}}:{ok:false,message:'Original occupied'};}},getState:()=>state,save:fn=>{state=fn(state);}});try{await assert.rejects(controller.prepareRestore(state,['a']),/Original occupied/);assert.ok(state.shortcuts[0].placements[0].bin);accept=true;const prepared=await controller.prepareRestore(state,['a']);assert.equal(prepared.shortcuts[0].fileTarget.status,'present');assert.ok(prepared.shortcuts[0].placements[0].bin);assert.deepEqual(calls,['file-target-resolve','file-target-restore','file-target-resolve','file-target-restore']);}finally{controller.dispose();}});

test('skull Undo and Redo replay checked bytes through the real store, retaining retry after refusal',async()=>{
 let state=base(),status='present',revision=1,refuse=false,saves=0;
 const calls=[];
 const raw={async fileCapability(op,p){calls.push(op);if(op==='file-target-restore'&&refuse)return {ok:false,message:'Original occupied'};if(op==='file-target-delete'){status='deleted';revision++;}if(op==='file-target-restore'){status='present';revision++;}return {ok:true,target:{targetId:'ref',status,revision,path:'D:\\old.txt'}};}};
 let controller;
 const store=createWorkspaceStore({getState:()=>state,setState:next=>state=next,normalizeState:s=>s,persist:async()=>({ok:true}),prepareHistoryChange:(a,b)=>controller.prepareHistory(a,b)});
 controller=createFileTargets({host:raw,getState:()=>state,save:fn=>{saves++;state=fn(state);}});
 try{
  const before=state;
  await controller.deletePath('D:\\old.txt');
  await store.commit(state,{historyBefore:before});
  refuse=true;assert.equal(await store.undo(),false);assert.equal(status,'deleted');assert.equal(store.canUndo(),true);assert.equal(store.canRedo(),false);
  refuse=false;assert.equal(await store.undo(),true);assert.equal(status,'present');assert.ok(state.shortcuts[0].placements.every(p=>!p.bin));assert.equal(state.shortcuts[0].fileTarget.status,'present');
  const beforeReplaySaves=saves;
  assert.equal(await store.redo(),true);assert.equal(status,'deleted');assert.ok(state.shortcuts[0].placements.every(p=>p.bin));assert.equal(saves,beforeReplaySaves);
  assert.equal(await store.undo(),true);assert.equal(status,'present');assert.equal(state.shortcuts.length,1);
  assert.deepEqual(calls.filter(op=>op==='file-target-delete'||op==='file-target-restore'),['file-target-delete','file-target-restore','file-target-restore','file-target-delete','file-target-restore']);
 }finally{controller.dispose();}
});

test('native skull participates in the same Undo/Redo history and refuses a replacement',async()=>{
 let state={shortcuts:[]},status='present',revision=1,collision=false;
 const raw={async fileCapability(op){if(op==='file-target-resolve'&&collision)return {ok:true,target:{targetId:'native',status:'replacement',revision}};if(op==='file-target-delete'){status='deleted';revision++;}if(op==='file-target-restore'){status='present';revision++;}return {ok:true,target:{targetId:'native',status,revision}};}};
 const store=createWorkspaceStore({getState:()=>state,setState:s=>state=s,normalizeState:s=>s,persist:async()=>({ok:true})});
 const effect=await createFileRecycleEffect(raw,['D:\\native.txt']);store.recordExternalEffect(effect);await effect.redo();
 assert.equal(status,'deleted');collision=true;assert.equal(await store.undo(),false);assert.equal(store.canUndo(),true);assert.equal(status,'deleted');
 collision=false;assert.equal(await store.undo(),true);assert.equal(status,'present');assert.equal(await store.redo(),true);assert.equal(status,'deleted');assert.equal(await store.undo(),true);assert.equal(status,'present');
});

test('concurrent reads share identity verification but the next action verifies afresh',async()=>{
 let calls=0,release;const state=base();state.shortcuts[0].fileTarget={id:'ref'};
 const controller=createFileTargets({getState:()=>state,save:async()=>{},host:{fileCapability:async()=>{calls++;await new Promise(r=>release=r);return{ok:true,target:{targetId:'ref',status:'present',path:'D:\\old.txt',revision:1}};}}});
 try{const reads=Array.from({length:24},()=>controller.resolvePath('D:\\old.txt'));assert.equal(calls,1);release();await Promise.all(reads);const next=controller.resolvePath('D:\\old.txt');assert.equal(calls,2);release();await next;}finally{controller.dispose();}
});

test('restricted launcher invokes a persisted record through its native launch owner',async()=>{
 const calls=[],baseHost={launchShortcut:async id=>{calls.push(id);},fileCapability:async()=>{throw Error('Arbitrary paths forbidden');}};
 const host=createFileTargetHost(baseHost,()=>({resolvePath:async()=>{throw Error('Launcher must not request arbitrary path capabilities');}}),()=>({target:'C:\\app.lnk',fileTarget:{id:'ref'}}),{launchByRecord:true});
 await host.launchShortcut('shortcut-app');assert.deepEqual(calls,['shortcut-app']);
});

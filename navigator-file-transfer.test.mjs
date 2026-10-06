import test from 'node:test';
import assert from 'node:assert/strict';
import {moveNavigatorFiles,retryNavigatorFileLinks} from './public/app/navigator-file-transfer.js';
test('retargets only after a queued physical move is verified',async()=>{
 const calls=[];let checks=0;
 const host={fileCapability:async(op,arg)=>{calls.push([op,arg]);if(op==='move')return {ok:true};if(arg.path==='D:\\old\\a.pdf'){checks++;return checks<2?{ok:true}:{ok:false,code:'ENOENT'};}return {ok:true};}};
 const moved=[];const r=await moveNavigatorFiles({host,paths:['D:\\old\\a.pdf'],destination:'D:\\new',sleep:async()=>{},retarget:async items=>{moved.push(...items);return true;}});
 assert.equal(r.ok,true);assert.deepEqual(moved,[{oldPath:'D:\\old\\a.pdf',newPath:'D:\\new\\a.pdf'}]);assert.equal(checks,2);
});
test('failed link persistence retains verified paths and retries without a second move',async()=>{
 const calls=[];
 const host={fileCapability:async(op,arg)=>{calls.push(op);return op==='move'||arg.path==='D:\\new\\a.dwg'?{ok:true}:{ok:false,code:'ENOENT'};}};
 const result=await moveNavigatorFiles({host,paths:['C:\\Downloads\\a.dwg'],destination:'D:\\new',retarget:async()=>false});
 assert.equal(result.ok,false);assert.deepEqual(result.unlinkedMoves,[{oldPath:'C:\\Downloads\\a.dwg',newPath:'D:\\new\\a.dwg'}]);
 let updated=[];
 assert.equal(await retryNavigatorFileLinks({host,moves:result.unlinkedMoves,retarget:async moves=>{updated=moves;return true;}}),true);
 assert.deepEqual(updated,result.unlinkedMoves);assert.equal(calls.filter(op=>op==='move').length,1);
});
test('link retry refuses a missing destination and preserves a failed save',async()=>{
 const moves=[{oldPath:'C:\\old\\a.dwg',newPath:'D:\\new\\a.dwg'}];let updated=false;
 assert.equal(await retryNavigatorFileLinks({host:{fileCapability:async()=>({ok:false,code:'ENOENT'})},moves,retarget:async()=>{updated=true;return true;}}),false);
 assert.equal(updated,false);
 assert.equal(await retryNavigatorFileLinks({host:{fileCapability:async(_op,arg)=>arg.path===moves[0].oldPath?{ok:false,code:'ENOENT'}:{ok:true}},moves,retarget:async()=>false}),false);
});
test('a rejected link save still reports the completed move for recovery',async()=>{
 const result=await moveNavigatorFiles({host:{fileCapability:async(op,arg)=>op==='move'||arg.path==='D:\\new\\a.dwg'?{ok:true}:{ok:false,code:'ENOENT'}},paths:['C:\\old\\a.dwg'],destination:'D:\\new',retarget:async()=>{throw new Error('writer disconnected');}});
 assert.equal(result.ok,false);assert.equal(result.unlinkedMoves.length,1);assert.match(result.message,/Refresh/);
});
test('a cancelled move never retargets AYG',async()=>{
 let updated=false;const r=await moveNavigatorFiles({host:{fileCapability:async op=>op==='move'?{ok:true}:{ok:true}},paths:['D:\\old\\a.pdf'],destination:'D:\\new',sleep:async()=>{},retarget:()=>{updated=true;}});
 assert.equal(r.ok,false);assert.equal(updated,false);
});
test('a denied stat is not mistaken for a removed source',async()=>{
 let updated=false;const r=await moveNavigatorFiles({host:{fileCapability:async(op,arg)=>op==='move'?{ok:true}:arg.path.includes('old')?{ok:false,code:'EACCES'}:{ok:true}},paths:['D:\\old\\a.pdf'],destination:'D:\\new',sleep:async()=>{},retarget:()=>{updated=true;}});
 assert.equal(r.ok,false);assert.equal(updated,false);
});


test('real folders reject self and descendant destinations before calling the host',async()=>{
  const {navigatorFileMoveAllowed,moveNavigatorFiles}=await import('./public/app/navigator-file-transfer.js');
  assert.equal(navigatorFileMoveAllowed(['D:/Work'], 'd:\\WORK\\'),false);
  assert.equal(navigatorFileMoveAllowed(['D:/Work'], 'D:/Work/child'),false);
  assert.equal(navigatorFileMoveAllowed(['D:/Work'], 'D:/Workmate'),true);
  let calls=0;
  const result=await moveNavigatorFiles({host:{fileCapability(){calls++;}},paths:['D:/Work'],destination:'D:/Work'});
  assert.equal(result.ok,false);assert.equal(calls,0);
});


test('Opus moves call only the filesystem move, with no AYG verification or link update',async()=>{
  const calls=[];
  const result=await moveNavigatorFiles({host:{fileCapability:async(operation)=>{calls.push(operation);return {ok:true};}},paths:['D:/old/a.txt'],destination:'D:/new'});
  assert.equal(result.ok,true);assert.deepEqual(calls,['move']);
});

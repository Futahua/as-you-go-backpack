import assert from 'node:assert/strict';
import test from 'node:test';
import {sharedPathCrumbs} from './public/app/navigator-address.js';
test('Android shared paths retain exact owner-relative segment destinations',()=>{
 assert.deepEqual(sharedPathCrumbs('Internal storage/Download/Test',p=>p.startsWith('Internal storage')), [{name:'Internal storage',path:'Internal storage'},{name:'Download',path:'Internal storage\\Download'},{name:'Test',path:'Internal storage\\Download\\Test'}]);
 assert.equal(sharedPathCrumbs('Unknown\\test',()=>false),null);
 assert.equal(sharedPathCrumbs('C:\\Documents',()=>true),null);
 assert.equal(sharedPathCrumbs('\\\\papers~owner\\Internal storage',()=>true),null);
});

test('artwork leaves host capacity available and retires each completed request',async()=>{
 const {createNavigatorArtworkQueue}=await import('./public/app/navigator-address.js');const queue=createNavigatorArtworkQueue(4);let active=0,max=0;const releases=[];
 const jobs=Array.from({length:20},()=>queue(async()=>{active++;max=Math.max(max,active);await new Promise(r=>releases.push(r));active--;}));
 for(let i=0;i<20;i++){await new Promise(r=>setImmediate(r));assert.ok(active<=4);releases.shift()();}
 await Promise.all(jobs);assert.equal(max,4);assert.equal(active,0);
});

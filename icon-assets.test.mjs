import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {createIconAssets} from './public/app/icon-assets.js';
test('verified assets replace duplicate images without changing authored data',async()=>{
 let calls=0;const image='data:image/png;base64,'+Buffer.from('test').toString('base64');
 const helper=createIconAssets({fileCapability:async(op,p)=>{calls++;assert.equal(op,'store-image-asset');assert.match(p.directory,/public\/icons$/);return {ok:true,filename:createHash('sha256').update(Buffer.from('test')).digest('hex')+'.png'};}});
 const original={schemaVersion:1,groups:[{id:'a',icon:image},{id:'b',icon:image}],shortcuts:[],view:{preferences:{snapshotStorage:{statePath:'D:/fixture/state.json'}}}};
 const output=JSON.parse(await helper.encode(JSON.stringify(original)));assert.equal(calls,1);assert.equal(output.groups[0].icon,output.groups[1].icon);assert.equal(output.groups[0].id,'a');assert.equal(original.groups[0].icon,image);
 await Promise.all([helper.encode(JSON.stringify(original)),helper.encode(JSON.stringify(original))]);assert.equal(calls,1);
 const metadata=await helper.metadata({generation:3,baseSerialized:JSON.stringify(original),pendingSnapshots:[{sequence:2,serialized:JSON.stringify(original)}]});assert.equal(metadata.generation,3);assert.equal(metadata.pendingSnapshots[0].sequence,2);assert.ok(!metadata.baseSerialized.includes('data:image'));assert.equal(calls,1);
});
test('asset failure blocks JSON replacement',async()=>{const h=createIconAssets({fileCapability:async()=>({ok:false,message:'disk full'})});await assert.rejects(h.encode(JSON.stringify({icon:'data:image/png;base64,dGVzdA==',view:{preferences:{snapshotStorage:{statePath:'D:/fixture/state.json'}}}})),/disk full/);});
test('workspace without a snapshot folder keeps icons embedded and still saves',async()=>{let calls=0;const h=createIconAssets({fileCapability:async()=>{calls++;return {ok:true};}});const state=JSON.stringify({icon:'data:image/png;base64,dGVzdA==',view:{preferences:{}}});assert.equal(await h.encode(state),state);assert.equal(calls,0);});
test('remote workspace preserves display icons and coordination bases for its owner',async()=>{
 const host={deviceId:'remote-owner',fileCapability:async()=>{throw Error('Viewer must not store owner assets');}};
 const assets=createIconAssets(host),state=JSON.stringify({groups:[{name:'Hello',icon:'data:image/png;base64,dGVzdA=='}],view:{preferences:{snapshotStorage:{statePath:'D:/owner/state.json'}}}});
 assert.equal(await assets.encode(state),state);
 const metadata=await assets.metadata({baseSerialized:state,pendingSnapshots:[{serialized:state,baseSerialized:state}]});
 assert.equal(metadata.baseSerialized,state);assert.equal(metadata.pendingSnapshots[0].serialized,state);assert.equal(metadata.pendingSnapshots[0].baseSerialized,state);
});

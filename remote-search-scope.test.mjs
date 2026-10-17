import test from 'node:test';import assert from 'node:assert/strict';
import {createRemoteWorkspaceHost} from './public/app/remote-workspace-host.js';
test('remote AYG search defaults to its owner and retains an explicit other-device scope',async()=>{const calls=[],owner='b2b514db-668a-4092-bda4-67e33c52c807';const host=createRemoteWorkspaceHost({fileCapability:async(op,params)=>{calls.push({op,params});return {ok:true,results:[]};}},owner);await host.fileCapability('search',{query:'sb'});assert.equal(calls[0].params.path,'\\\\papers~'+owner);await host.fileCapability('search',{query:'sb',path:'\\\\papers~other'});assert.equal(calls[1].params.path,'\\\\papers~other');});

test('fresh checked folder identity browses its owner resource without ancestor listings',async()=>{
 const owner='b2b514db-668a-4092-bda4-67e33c52c807',root='\\\\papers~'+owner,path='C:\\Download\\Test',calls=[];
 const host=createRemoteWorkspaceHost({fileCapability:async(operation,params)=>{calls.push({operation,params});if(operation==='file-target-resolve')return{ok:true,target:{status:'present',targetId:'target',path:root+'\\'+path,entry:{id:'folder',name:'Test',kind:'folder',version:'v'}}};if(operation==='remote-files')return{ok:true,result:{online:true,folder:{id:'folder'},entries:[{id:'child',name:params.offset?'two.txt':'one.txt',kind:'file'}],nextOffset:params.offset?null:1}};throw Error('Unexpected ancestor listing');}},owner);
 await host.fileCapability('file-target-resolve',{path,targetId:'target'});
 const result=await host.fileCapability('list',{path});assert.equal(result.items.length,2);assert.equal(result.items[0].path,path+'\\one.txt');assert.deepEqual(calls.map(c=>c.operation),['file-target-resolve','remote-files','remote-files']);assert.ok(calls.slice(1).every(c=>c.params.ownerId===owner&&c.params.resourceId==='folder'));
});
test('owners without resource metadata keep their existing checked path route',async()=>{
 const calls=[],host=createRemoteWorkspaceHost({fileCapability:async(operation,params)=>{calls.push(operation);return operation==='file-target-resolve'?{ok:true,target:{status:'present',path:'C:\\Test'}}:{ok:true,items:[]};}},'b2b514db-668a-4092-bda4-67e33c52c807');await host.fileCapability('file-target-resolve',{path:'C:\\Test'});await host.fileCapability('list',{path:'C:\\Test'});assert.deepEqual(calls,['file-target-resolve','list']);
});

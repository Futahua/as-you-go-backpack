import test from 'node:test';
import assert from 'node:assert/strict';
import {editingChoices,assignEditingFiles} from './public/app/navigator-editing.js';
test('device choices use known device menu entries rather than test grants',()=>{
 assert.deepEqual(editingChoices({editors:[{id:'test',name:'SlopTop device check'},{id:'a',name:'SlopTop'},{id:'again',name:'SlopTop'}]},{owner:{name:'SlopTop'},devices:[{name:'LapDog'}]}),[{id:'a',name:'SlopTop'}]);
});
test('batch uses each owner grant, skips an already active assignment and continues after a failure',async()=>{
 const commands=[];const host={async fileCapability(op,p){if(p.action==='status')return {ok:true,editors:[{id:p.path+'-grant',name:'SlopTop'}],assignments:p.path==='active'?[{active:true,editorDeviceId:'active-grant'}]:[]};commands.push(p);return p.path==='refused'?{ok:false,message:'Owner refused'}:{ok:true};}};
 const results=await assignEditingFiles(host,['active','refused','last'].map(path=>({path})),'SlopTop');
 assert.deepEqual(commands.map(p=>[p.path,p.editorDeviceId]),[['refused','refused-grant'],['last','last-grant']]);
 assert.deepEqual(results.map(r=>r.ok),[true,false,true]);
});

test('visible availability refresh clears stale offline dimming after reconnect',async()=>{const {createNavigatorEditing}=await import('./public/app/navigator-editing.js');let tick,offline=true;const classes=new Set(),row={isConnected:true,getBoundingClientRect:()=>({top:0,bottom:30}),querySelector:()=>null,classList:{toggle(name,on){if(on)classes.add(name);else classes.delete(name);}}};const w={innerHeight:600,setInterval:f=>(tick=f,1),clearInterval(){},setTimeout:()=>1,clearTimeout(){},addEventListener(){}};const c=createNavigatorEditing({document:{defaultView:w},host:{async fileCapability(op){return op==='stat'?{ok:true,entry:{offline}}:{ok:true,assignments:[]};}},paths:()=>[],setStatus(){}});c.observe(row,'C:\\file.txt');await tick();assert.ok(classes.has('navigator-offline-entry'));offline=false;await tick();assert.ok(!classes.has('navigator-offline-entry'));});

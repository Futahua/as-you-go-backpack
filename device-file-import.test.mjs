import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeviceFileImport } from './public/app/device-file-import.js';
const settle = async () => { for(let i=0;i<12;i++) await Promise.resolve(); };
function fixture(t, {scopeKey='page:a', storage=new Map(), link=async()=>true, filesOnly=false}={}) {
 const elements=[], intervals=new Set(), events=new Map(), jobs=[], calls=[];
 const element=tag=>{const e={tag,children:[],hidden:false,isConnected:true,dataset:{},style:{},classList:{remove(){},add(){},toggle(){}},listeners:{},append(...x){this.children.push(...x);},setAttribute(){},removeAttribute(){},addEventListener(k,f){this.listeners[k]=f;},after(){},getBoundingClientRect:()=>({left:0,right:400,width:400,bottom:32}),closest(){return this;}};elements.push(e);return e;};
 const lens=element('button');lens.className='native-window-lens';
 const domEvents=new Map();const d={addEventListener:(name,fn)=>domEvents.set(name,fn),removeEventListener:name=>domEvents.delete(name),dispatchEvent:event=>domEvents.get(event.type)?.(event),querySelectorAll:()=>[],createElement:element,body:element('body'),head:element('head'),querySelector:()=>lens,defaultView:{CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},innerWidth:400,localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},addEventListener:(k,f)=>events.set(k,f)}};
 t.mock.method(globalThis,'setInterval',f=>{intervals.add(f);return f;});t.mock.method(globalThis,'clearInterval',f=>intervals.delete(f));
 const old=globalThis.MutationObserver;globalThis.MutationObserver=class {observe(){} disconnect(){}};t.after(()=>{globalThis.MutationObserver=old;events.get('pagehide')?.();});
 const host={fileCapability:async(_,p)=>{calls.push(p);if(p.operation==='status')return {inboxTransfers:jobs.map(j=>({...j}))};if(p.operation==='inbox-import'){const j={id:p.commandId,phase:'downloading',bytes:0,totalBytes:10,results:[]};jobs.push(j);return j;}}};
 const api=createDeviceFileImport({document:d,host,scopeKey,link,filesOnly});
 return {api,storage,jobs,calls,elements,tick:async()=>{for(const f of intervals)await f();await settle();},text:()=>elements.map(e=>e.textContent).filter(Boolean).join('|')};
}
const path='\\\\papers~11111111-1111-1111-1111-111111111111\\C:\\file.txt';
test('download completion waits for durable linking; retry links without downloading twice',async t=>{
 let accepted=false, attempts=0;
 const h=fixture(t,{link:async()=>{attempts++;return accepted;}});await settle();
 await h.api.importPaths([path],'root');Object.assign(h.jobs[0],{phase:'completed',bytes:10,results:[{name:'file.txt',target:'D:\\inbox\\file.txt',kind:'file'}]});
 await h.tick();assert.match(h.text(),/Saved — link failed/);assert.equal(attempts,1);assert.match(h.text(),/Retry link/);
 await h.tick();assert.equal(attempts,1);accepted=true;
 await h.elements.find(e=>e.textContent==='Retry link').listeners.click();
 assert.match(h.text(),/Completed/);assert.equal(attempts,2);assert.equal(h.calls.filter(c=>c.operation==='inbox-import').length,1);
 assert.deepEqual(JSON.parse(h.storage.get('papers-device-imports:page:a')),[]);
});
test('one page cannot claim another page pending download',async t=>{
 const storage=new Map([['papers-device-imports:page:other',JSON.stringify([{jobId:'other',destination:'root'}])]]);
 let linked=0;const h=fixture(t,{storage,link:async()=>{linked++;return true;}});h.jobs.push({id:'other',phase:'completed',results:[{name:'x',target:'D:\\x'}]});await settle();await h.tick();assert.equal(linked,0);assert.ok(storage.get('papers-device-imports:page:other'));
});

test('a device-only Files toolbar mounts Downloads without a camera control',async t=>{
 const h=fixture(t,{filesOnly:true});await settle();
 const button=h.elements.find(e=>e.title==='Downloads');assert.ok(button);assert.equal(button.className,'navigator-icon-button');
 assert.ok(h.elements[0].children.includes(button));
});

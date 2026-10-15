import test from 'node:test';import assert from 'node:assert/strict';import {mountPhoneDownloads} from './public/app/phone-downloads.js';
test('Download submits every selected path as one batch',async t=>{
 const elements=[],events=new Map(),calls=[];const element=()=>{const e={children:[],style:{},classList:{remove(){},add(){},toggle(){}},listeners:{},setAttribute(){},addEventListener(k,f){this.listeners[k]=f;},append(...items){this.children.push(...items);this.firstChild=this.children[0];},replaceWith(){}};elements.push(e);return e;};const lens=element();lens.className='lens';
 const d={querySelector:()=>lens,createElement:element,createTextNode:text=>({textContent:text}),body:element(),head:element(),defaultView:{addEventListener:(k,f)=>events.set(k,f)}};
 t.mock.method(globalThis,'setInterval',()=>1);t.mock.method(globalThis,'clearInterval',()=>{});t.after(()=>events.get('pagehide')?.());
 const paths=['\\\\papers~owner\\D:\\one.pdf','\\\\papers~owner\\D:\\two.pdf'];
 mountPhoneDownloads({document:d,getPaths:()=>[...paths],host:{deviceId:'owner',fileCapability:async(_,p)=>{calls.push(p);return {ok:true,result:p.operation==='public-download-start'?{phase:'transferring',total:20,bytes:0,count:2,destination:{name:'Test'}}:{phase:'idle'}};}}});
 await Promise.resolve();await elements.find(e=>e.title==='Download selection to phone').listeners.click();
 const batches=calls.filter(c=>c.operation==='public-download-start');assert.equal(batches.length,1);assert.deepEqual(batches[0].paths,paths);
});

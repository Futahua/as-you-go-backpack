import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createNavigatorSavedStates, decodeNavigatorSavedStates, uniqueNavigatorSavedStates } from './public/app/navigator-saved-states.js';

function pillFixture(options={}) {
  const element=()=>Object.assign(new EventTarget(),{
    style:{setProperty(){}},classList:{add(){},remove(){}},children:[],setAttribute(){},after(){},
    prepend(...items){this.children.unshift(...items);},append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;},
  });
  const document={createElement:element,defaultView:{innerHeight:900,localStorage:options.storage||{getItem:()=>null,setItem(){}},addEventListener(){}}};
  Object.assign(document.defaultView,options.window||{});document.addEventListener=()=>{};
  const container=element();
  const saved=createNavigatorSavedStates({document,container,art(){},restore(){},...options});
  return {saved,container,names:()=>container.children[1].children.map(pill=>pill.children[1].textContent)};
}

test('older durable acknowledgements cannot erase additions while saves are queued',async()=>{
  let disk=[],acknowledge;
  const writes=[];
  let fixture;
  fixture=pillFixture({loadSavedStates:()=>disk,saveSavedStates:pills=>new Promise(resolve=>{
    writes.push(pills);acknowledge=()=>{disk=pills;fixture.saved.syncDurable();resolve(true);};
  })});
  const a={mode:'action',path:'D:/a.txt',name:'a'},b={...a,path:'D:/b.txt',name:'b'},c={...a,path:'D:/c.txt',name:'c'};
  fixture.saved.add(a);fixture.saved.add(b);
  await new Promise(resolve=>setImmediate(resolve));
  acknowledge();await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(fixture.names(),['a','b']);
  fixture.saved.add(c);
  acknowledge();await new Promise(resolve=>setImmediate(resolve));
  acknowledge();await new Promise(resolve=>setImmediate(resolve));
  fixture.saved.syncDurable();
  assert.deepEqual(disk,[a,b,c]);
  assert.deepEqual(writes.at(-1),[a,b,c]);
  assert.deepEqual(pillFixture({loadSavedStates:()=>disk}).names(),['a','b','c']);
});

test('the pills drop target accepts move-only folder drags and persists the folder',async()=>{
  const folder={mode:'ayg',currentId:'qq1',name:'QQ1',view:'nav'};
  let disk=[];
  const fixture=pillFixture({loadSavedStates:()=>disk,saveSavedStates:async pills=>{disk=pills;return true;},fromDrop:async()=>folder});
  const transfer={effectAllowed:'move',dropEffect:'none'};
  const over=new Event('dragover',{cancelable:true});Object.assign(over,{dataTransfer:transfer});fixture.container.dispatchEvent(over);
  assert.equal(transfer.dropEffect,'move');
  assert.equal(over.defaultPrevented,true);
  const drop=new Event('drop',{cancelable:true});Object.assign(drop,{dataTransfer:transfer});fixture.container.dispatchEvent(drop);
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(disk,[folder]);assert.deepEqual(fixture.names(),['QQ1']);
});

test('saved navigator state decoder keeps only bounded semantic state kinds', () => {
  assert.deepEqual(decodeNavigatorSavedStates(JSON.stringify([
    { mode: 'ayg', name: 'Home' },
    { mode: 'machine', name: 'Files' },
    { mode: 'action', name: 'Wikipedia' },
    { mode: 'bogus', name: 'Nope' },
    null,
  ])), [
    { mode: 'ayg', name: 'Home' },
    { mode: 'machine', name: 'Files' },
    { mode: 'action', name: 'Wikipedia' },
  ]);
  assert.deepEqual(decodeNavigatorSavedStates('{broken'), []);
});

test('saved navigator states synchronize open tabs and require two clicks to clear all', async () => {
  const source = await readFile(new URL('./public/app/navigator-saved-states.js', import.meta.url), 'utf8');
  assert.match(source, /addEventListener\?\.\('storage'/);
  assert.match(source, /BroadcastChannel\('papers:ayg:navigator-saved-states-v1'\)/);
  assert.match(source, /if \(!clearArmed\)[\s\S]*classList\.add\('armed'\)[\s\S]*states = \[\]/);
  assert.match(source, /persistStates\(\);[\s\S]*render\(\);/);
});

test('navigator keeps the height grip invisible and toolbar controls present', async () => {
  const [css, source] = await Promise.all([
    readFile(new URL('./public/styles/navigator.css', import.meta.url), 'utf8'),
    readFile(new URL('./public/app/workspace-navigator.js', import.meta.url), 'utf8'),
  ]);
  assert.match(css, /\.navigator-pills-height-grip\{[^}]*background:transparent/);
  assert.match(css, /\.navigator-saved-clear\{[^}]*opacity:0/);
  assert.match(css, /\.navigator-saved-clear\.armed\{[^}]*#9f3434/);
  assert.doesNotMatch(source, /back\.hidden = fwd\.hidden = up\.hidden = home\.hidden = !nav/);
  assert.doesNotMatch(source, /saveState\.remove\(\)/);
  assert.doesNotMatch(source, /Save current navigation/);
});

test('pills for the same file deduplicate across native and AYG saved states',()=>{
  const first={mode:'action',itemId:'a',name:'Drawing',art:{target:'D:\\Work\\Drawing.dwg'}};
  const duplicate={mode:'action',path:'d:/work/drawing.dwg',name:'Drawing'};
  const other={mode:'action',path:'D:/other/Drawing.dwg',name:'Drawing'};
  assert.deepEqual(uniqueNavigatorSavedStates([first,duplicate,other]),[first,other]);
  assert.deepEqual(decodeNavigatorSavedStates(JSON.stringify([first,duplicate,other])),[first,other]);
});
test('resolved quick-run targets and duplicate folder snapshots keep only the first pill',()=>{
  const file={mode:'action',path:'D:/work/a.txt',name:'a'};
  const quick={mode:'action',quickRunKey:'item:a',name:'a'};
  const folder={mode:'ayg',currentId:'group-a',view:'nav',name:'Folder'};
  assert.deepEqual(uniqueNavigatorSavedStates([file,quick,folder,{...folder,view:'tree',expanded:['child']}],
    saved=>saved.quickRunKey?'d:\\WORK\\A.TXT':null),[file,folder]);
});


test('dragging an AYG item replaces a filename-only duplicate with its authored name',()=>{
  const file={mode:'action',path:'D:/123.jpg',name:'123.jpg'};
  const ayg={mode:'action',itemId:'image-a',path:'d:/123.jpg',name:'tien 2'};
  assert.deepEqual(uniqueNavigatorSavedStates([file,ayg]),[ayg]);
});


test('saved pills survive a new browser session through durable preferences, including clearing', async()=>{
  const {createNavigatorSavedStates}=await import('./public/app/navigator-saved-states.js');
  const {normalizeState}=await import('./public/workspace-model-20260730b.js');
  let disk={view:{preferences:{}}};
  function mount(){
    const elements=[];
    const element=()=>{
      const node=new EventTarget();
      Object.assign(node,{style:{setProperty(){}},classList:{add(){},remove(){}},children:[],
        setAttribute(){},after(){},prepend(...items){this.children.unshift(...items);},append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;}});
      elements.push(node);return node;
    };
    const document={createElement:element,defaultView:{innerHeight:900,localStorage:{getItem:()=>null,setItem(){}},addEventListener(){}}};
    const container=element();
    const saved=createNavigatorSavedStates({document,container,art(){},restore(){},
      loadSavedStates:()=>normalizeState(disk).view.preferences.navigatorSavedStates,
      saveSavedStates:async pills=>{disk=normalizeState({...disk,view:{...disk.view,preferences:{navigatorSavedStates:pills}}});return true;}});
    return{saved,container,elements};
  }
  const pill={mode:'action',path:'D:/work/a.pdf',name:'My document'};
  const first=mount();first.saved.add(pill);
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(disk.view.preferences.navigatorSavedStates,[pill]);
  const rebooted=mount();
  assert.equal(rebooted.container.children[1].children.length,1);
  assert.equal(rebooted.container.children[1].children[0].children[1].textContent,'My document');
  const clear=rebooted.container.children[0];
  clear.dispatchEvent(new Event('click',{cancelable:true}));clear.dispatchEvent(new Event('click',{cancelable:true}));
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(disk.view.preferences.navigatorSavedStates,[]);
  assert.equal(mount().container.children[1].children.length,0);
});


test('shared cache cannot replace document-backed pills', () => {
  const listeners = {};
  const document = {createElement:()=>Object.assign(new EventTarget(), {
    style:{setProperty(){}},classList:{add(){},remove(){}},children:[],setAttribute(){},after(){},
    prepend(...items){this.children.unshift(...items);},append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;},
  }),defaultView:{innerHeight:900,localStorage:{getItem:()=>null,setItem(){}},
    addEventListener(type,fn){listeners[type]=fn;},
    BroadcastChannel:class {addEventListener(type,fn){listeners.broadcast=fn;} postMessage(){}},
  }};
  const pills=[{mode:'action',name:'a'},{mode:'action',name:'b'}];
  const fixture=pillFixture({document,loadSavedStates:()=>pills});
  listeners.storage({key:'papers:ayg:navigator-saved-states',newValue:'[]'});
  listeners.broadcast({data:{type:'states',states:[]}});
  assert.deepEqual(fixture.names(),['a','b']);
});


test('cold navigator never saves a stale browser cache over the document loaded later', async()=>{
  let ready=false,disk;
  const cached=[{mode:'action',path:'D:/old.txt',name:'Old cached pill'}];
  const durable=[{mode:'ayg',currentId:'work',name:'Work'},{mode:'action',path:'D:/new.txt',name:'New pill'}];
  const writes=[],cacheWrites=[];
  const fixture=pillFixture({isReady:()=>ready,loadSavedStates:()=>disk,
    saveSavedStates:async value=>{writes.push(value);disk=value;return true;},
    storage:{getItem:()=>JSON.stringify(cached),setItem:(_key,value)=>cacheWrites.push(value)},
  });
  assert.deepEqual(fixture.names(),[]);
  assert.deepEqual(cacheWrites,[]);
  disk=durable;ready=true;fixture.saved.syncDurable();
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(fixture.names(),['Work','New pill']);
  assert.deepEqual(writes,[]);
  assert.deepEqual(disk,durable);
});


test('an explicitly empty document list wins over cached pills after hydration',async()=>{
  let ready=false,disk;
  const writes=[];
  const fixture=pillFixture({isReady:()=>ready,loadSavedStates:()=>disk,
    storage:{getItem:()=>JSON.stringify([{mode:'ayg',currentId:'old',name:'Removed folder'}]),setItem(){}},
    saveSavedStates:async value=>{writes.push(value);return true;}});
  disk=[];ready=true;fixture.saved.syncDurable();
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(fixture.names(),[]);assert.deepEqual(writes,[]);
});

test('legacy cache migration waits for a loaded document without saved pills',async()=>{
  let ready=false,disk;
  const writes=[],legacy=[{mode:'ayg',currentId:'work',name:'Work'}];
  const fixture=pillFixture({isReady:()=>ready,loadSavedStates:()=>disk,
    storage:{getItem:()=>JSON.stringify(legacy),setItem(){}},
    saveSavedStates:async value=>{writes.push(value);disk=value;return true;}});
  await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(writes,[]);
  ready=true;fixture.saved.syncDurable();
  await new Promise(resolve=>setImmediate(resolve));
  fixture.saved.syncDurable();
  assert.deepEqual(writes,[legacy]);assert.deepEqual(fixture.names(),['Work']);
});

test('explicit pill removal waits for durable success and keeps unrelated pills',async()=>{
 let fail=true,disk=[{mode:'action',path:'D:/a.txt',name:'A'},{mode:'action',path:'D:/b.txt',name:'B'}];
 const f=pillFixture({loadSavedStates:()=>disk,saveSavedStates:async next=>{if(fail)return false;disk=next;return true;}});
 await assert.rejects(f.saved.remove(disk[0]),/could not be saved/);assert.deepEqual(f.names(),['A','B']);
 fail=false;await f.saved.remove(disk[0]);assert.deepEqual(f.names(),['B']);
});
test('move-and-clear removes the retargeted pill after a verified filesystem move',async()=>{
 let disk=[{mode:'action',path:'D:/a.txt',name:'Authored A'}];const old=disk[0];
 const f=pillFixture({loadSavedStates:()=>disk,saveSavedStates:async next=>{disk=next;return true;}});
 const moves=[{oldPath:'D:/a.txt',newPath:'D:/folder/a.txt'}];f.saved.retargetPaths(moves);await new Promise(r=>setImmediate(r));
 await f.saved.remove(old,moves);assert.deepEqual(f.names(),[]);assert.deepEqual(disk,[]);
});

test('phone pill selection survives durable hydration with reordered fields',()=>{
 let fire,disk=[{mode:'action',path:'D:/a.txt',name:'A'}];
 const f=pillFixture({window:{location:{href:'https://papers.local/ayg/?papers-phone=1'},setTimeout:fn=>{fire=fn;return 1;},clearTimeout(){}},loadSavedStates:()=>disk});
 const event=new Event('pointerdown');Object.assign(event,{pointerType:'touch',clientX:10,clientY:10});f.container.children[1].children[0].dispatchEvent(event);fire();assert.equal(f.saved.selected().length,1);
 f.container.children[1].children[0].dispatchEvent(new Event('click',{cancelable:true}));assert.equal(f.saved.selected().length,1,'lifting the held finger must not deselect the pill');
 disk=[{name:'A',path:'D:/a.txt',mode:'action',icon:null}];f.saved.syncDurable();assert.equal(f.saved.selected().length,1);assert.equal(f.saved.selected()[0].name,'A');
 f.saved.finishSelection();assert.equal(f.saved.selected().length,0);
});

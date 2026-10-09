import test from 'node:test';
import assert from 'node:assert/strict';
import { PREVIEW_TAB_MIME, createLensButton, installNativeWindowTabs } from './public/app/native-window-tabs.js';
import { WINDOW_TAB_MIME, paneWindowPickerRows } from './public/app/window-tab-transfer.js';

class Element {
  children = []; attributes = {}; listeners = {};
  setAttribute(key, value) { this.attributes[key] = value; }
  getAttribute(key) { return this.attributes[key]; }
  prepend(child) { this.children.unshift(child); }
  append(...children) { this.children.push(...children); }
  replaceChildren() { this.children = []; }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  remove() { this.removed = true; }
  click() { this.listeners.click?.({target:this,stopPropagation(){}}); }
}
function fixture(extra = {}, prepare = () => undefined) {
  const header = new Element(); header.getBoundingClientRect = () => ({left:0,top:0,right:500,bottom:40}); const calls = []; let pushed; const keys = {};
  const host = {
    fileCapability: async (operation, data) => { calls.push({ operation, data }); return { ok: true }; },
    onPaneTabs: (callback) => { pushed = callback; return () => { pushed = null; }; },
    windowCandidatePicker: async () => ({ action: 'select', candidateId: 'candidate' }),
    windowCandidates: async () => ({ outcome: 'success', candidates: [{ id: 'candidate', title: 'Writer' }] }),
    windowCandidatePickerUpdate: async () => ({ outcome: 'success', delivery: 'applied' }),
    bindWindowCandidate: async (id) => { assert.equal(id, 'candidate'); return { outcome: 'success', capability: { bindingId: 'trusted-binding' } }; },
    windowCandidatePickerClose: async () => {}, ...extra,
  };
  const api = installNativeWindowTabs({ document: { createElement: () => new Element(), elementFromPoint: () => extra.hitTarget?.(), addEventListener: (key, cb) => { keys[key] = cb; }, removeEventListener: () => {} }, header, host,
    bounds: () => ({ x: 10, y: 20, width: 400, height: 600 }),
    prepare: () => { calls.push({ operation: 'prepare' }); return prepare(); }, overlay: async () => {}, status: (message) => { throw new Error(message); } });
  return { api, calls, keys, strip: header.children[0], push: (tabs) => pushed(tabs) };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
test('application tabs select and release exact native peers without closing applications', async () => {
  const f = fixture();
  f.push([{ id: 'writer', title: 'Writer', active: true }, { id: 'cad', title: 'AutoCAD', active: false }]);
  f.strip.children[2].children[0].listeners.click(); await settle();
  assert.deepEqual(f.calls.at(-1), { operation: 'pane-window-select', data: { tabId: 'cad' } });
  f.strip.children[1].children[1].listeners.click(); await settle();
  assert.deepEqual(f.calls.at(-1), { operation: 'pane-window-detach', data: { tabId: 'writer' } });
  f.api.destroy(); assert.equal(f.strip.removed, true);
});
test('adding a window uses a fresh binding and never sends a raw window handle from the page', async () => {
  const f = fixture(); f.strip.children[0].listeners.click(); await settle();
  assert.deepEqual(f.calls.at(-1), { operation: 'pane-window-attach', data: { bindingId: 'trusted-binding', rect: { x: 10, y: 20, width: 400, height: 600 } } });
  f.api.destroy();
});
test('a late picker response cannot attach after the view is destroyed', async () => {
  let finish;
  const f = fixture({ windowCandidatePicker: () => new Promise(resolve => { finish = resolve; }) });
  f.strip.children[0].listeners.click(); await settle(); f.api.destroy();
  finish({ action: 'select', candidateId: 'candidate' }); await settle();
  assert.equal(f.calls.some(call => call.operation === 'pane-window-attach'), false);
});
test('window selection waits for preview release and only the latest click wins', async () => {
  const pending = [];
  const f = fixture({}, () => new Promise(resolve => pending.push(resolve)));
  f.push([{ id: 'first', title: 'Chrome one', active: false }, { id: 'second', title: 'Chrome two', active: true }]);
  let stopped = 0;
  f.strip.children[1].children[0].listeners.click({ stopPropagation() { stopped++; } });
  f.strip.children[2].children[0].listeners.click({ stopPropagation() { stopped++; } });
  assert.equal(f.calls.some(call => call.operation === 'pane-window-select'), false);
  pending[1](true); await settle(); pending[0](true); await settle();
  assert.equal(stopped, 2);
  assert.deepEqual(f.calls.filter(call => call.operation === 'pane-window-select'), [{ operation: 'pane-window-select', data: { tabId: 'second' } }]);
  f.api.destroy();
});
test('strip picker Remove releases a retained tab and never closes a widget window', async () => {
  const f = fixture({ windowCandidatePicker: async () => ({ action: 'close', candidateId: 'pane:writer' }) });
  f.push([{ id: 'writer', title: 'Writer', active: true }]);
  f.strip.children[0].listeners.click(); await settle();
  assert.deepEqual(f.calls.filter(call => call.operation === 'pane-window-detach'), [{ operation: 'pane-window-detach', data: { tabId: 'writer' } }]);
  assert.equal(f.calls.some(call => /close/.test(call.operation)), false);
  f.api.destroy();
});
test('dropping an already-tabbed widget icon selects it without binding or adding again', async () => {
  const f = fixture({ bindWindowCandidate: async () => { throw new Error('Duplicate was rebound'); } });
  f.push([{ id: 'chrome', title: 'Chrome', active: false, windowInstanceId: 'W0123456789abcdef' }]);
  await f.strip.listeners.drop({ preventDefault() {}, stopPropagation() {}, dataTransfer: { getData(type) { assert.equal(type, WINDOW_TAB_MIME); return 'W0123456789abcdef'; } } });
  assert.deepEqual(f.calls.at(-1), { operation: 'pane-window-select', data: { tabId: 'chrome' } });
  assert.equal(f.calls.some(call => call.operation === 'pane-window-attach'), false);
  f.api.destroy();
});
test('picker membership follows exact strip identities, keeping same-title windows separate', () => {
  const tabs = [{ id: 'a', title: 'Chrome', windowInstanceId: 'W0123456789abcdef' }];
  const rows = paneWindowPickerRows([
    { id: 'current', title: 'Chrome', windowInstanceId: 'W0123456789abcdef' },
    { id: 'other', title: 'Chrome', windowInstanceId: 'Wfedcba9876543210' },
  ], tabs);
  assert.deepEqual(rows.map(row => [row.id, row.current]), [['current', true], ['other', false]]);
});
test('foreign file/text drops cannot attach windows', async () => {
  const f = fixture();
  await f.strip.listeners.drop({ dataTransfer: { getData: () => 'D:\\file.docx' } });
  assert.equal(f.calls.some(call => call.operation === 'pane-window-attach'), false);
  f.api.destroy();
});
test('a widget drag binds the exact live identity and attaches once without changing widget membership', async () => {
  let binds = 0;
  const f = fixture({
    windowCandidates: async () => ({ outcome: 'success', candidates: [{ id: 'candidate', title: 'Writer', windowInstanceId: 'W0123456789abcdef' }] }),
    bindWindowCandidate: async id => { binds++; assert.equal(id, 'candidate'); return { outcome: 'success', capability: { bindingId: 'binding' } }; },
  });
  const event = { preventDefault() {}, stopPropagation() {}, dataTransfer: { getData: () => 'W0123456789abcdef' } };
  const first = f.strip.listeners.drop(event);
  await f.strip.listeners.drop(event); await first;
  assert.equal(binds, 1);
  assert.deepEqual(f.calls.filter(call => call.operation === 'pane-window-attach'), [{ operation: 'pane-window-attach', data: { bindingId: 'binding', rect: { x: 10, y: 20, width: 400, height: 600 } } }]);
  f.api.destroy();
});

test('picker remains first and pointer drag delegates the drop to native Shift handling', async () => {
  const f = fixture(); f.push([{id:'a',title:'A'},{id:'b',title:'B'}]);
  assert.equal(f.strip.children[0].attributes['aria-label'], 'Existing windows');
  const group=f.strip.children[1];
  group.listeners.pointerdown({button:0,pointerId:1,clientX:20,clientY:20});
  group.listeners.pointermove({pointerId:1,clientX:600,clientY:100});
  group.listeners.pointerup({pointerId:1,clientX:600,clientY:100,preventDefault(){},stopPropagation(){}}); await settle();
  assert.deepEqual(f.calls.find(call=>call.operation==='pane-window-drop'),{operation:'pane-window-drop',data:{tabId:'a',beforeId:'a',shiftHeld:false}});
  assert.equal(f.keys.keydown,undefined, 'Tab must retain its normal keyboard behavior'); f.api.destroy();
});

test('pointer-captured clicks still select a restored tab', async () => {
  const f=fixture();f.push([{id:'restored-a',title:'A',active:true},{id:'restored-b',title:'B',active:false}]);await settle();
  const group=f.strip.children[2];
  group.listeners.pointerdown({button:0,pointerId:1,clientX:200,clientY:20});
  group.listeners.pointerup({pointerId:1,clientX:200,clientY:20});
  group.listeners.click({target:group});await settle();
  assert.deepEqual(f.calls.find(call=>call.operation==='pane-window-select'),{operation:'pane-window-select',data:{tabId:'restored-b'}});f.api.destroy();
});

test('reordering on the header bypasses the native content-region drop check', async () => {
  let target;const f=fixture({hitTarget:()=>target});f.push([{id:'a',title:'A'},{id:'b',title:'B'}]);await settle();
  const a=f.strip.children[1],b=f.strip.children[2];
  b.getBoundingClientRect=()=>({left:100,right:200,top:0,bottom:30});target={closest:()=>b};
  f.strip.getBoundingClientRect=()=>({left:0,right:500,top:0,bottom:30});
  a.listeners.pointerdown({button:0,pointerId:1,clientX:20,clientY:10});
  a.listeners.pointermove({pointerId:1,clientX:180,clientY:10});
  a.listeners.pointerup({pointerId:1,clientX:180,clientY:10,preventDefault(){},stopPropagation(){}});await settle();
  assert.deepEqual(f.calls.find(c=>c.operation==='pane-window-reorder'),{operation:'pane-window-reorder',data:{tabId:'a',beforeId:''}});
  assert.equal(f.calls.some(c=>c.operation==='pane-window-drop'),false);f.api.destroy();
});


test('active-only tab switches retain existing strip nodes', () => {
  const f = fixture();
  f.push([{id:'one',title:'One',active:true},{id:'two',title:'Two',active:false}]);
  const nodes=[...f.strip.children];
  f.push([{id:'one',title:'One',active:false},{id:'two',title:'Two',active:true}]);
  assert.deepEqual(f.strip.children,nodes);
  assert.equal(nodes[1].children[0].attributes['aria-selected'],'false');
  assert.equal(nodes[2].children[0].attributes['aria-selected'],'true');
  f.api.destroy();
});

test('pinned preview tabs use local preview callbacks and never detach or select an external window',async()=>{
 const f=fixture();let selected=0,closed=0;
 f.push([{id:'native',title:'Chrome',active:true}]);
 f.api.setDocumentTabs([{id:'preview',title:'Drawing.png',active:true,onSelect:()=>selected++,onClose:()=>closed++}]);
 const tab=f.strip.children.at(-1);tab.children[0].listeners.click({stopPropagation(){}});tab.children[1].listeners.click({stopPropagation(){}});
 assert.equal(selected,1);assert.equal(closed,1);assert.equal(f.calls.some(c=>['pane-window-select','pane-window-detach'].includes(c.operation)),false);assert.equal(tab.children[0].getAttribute('aria-selected'),'true');assert.equal(f.strip.children[1].children[0].getAttribute('aria-selected'),'false');f.api.destroy();
});

test('restoration prepares the visible window surface before requesting retained tabs', async()=>{
 const f=fixture(); await settle(); f.calls.length=0;
 await f.api.restoreCurrent();
 assert.deepEqual(f.calls.map(c=>c.operation),['prepare','pane-window-tabs']);
 assert.deepEqual(f.calls[1].data.rect,{x:10,y:20,width:400,height:600});
 f.api.destroy();
});

test('pinned preview drag carries a local preview identity and reorders without native window mutations',async()=>{
 const f=fixture();const reordered=[];
 f.api.setDocumentTabs([{id:'one',title:'One',onSelect(){},onClose(){},onReorder:id=>reordered.push(id)},{id:'two',title:'Two',onSelect(){},onClose(){}}]);
 const one=f.strip.children[1],two=f.strip.children[2],data=new Map();
 const transfer={types:[PREVIEW_TAB_MIME],setData:(k,v)=>data.set(k,v),getData:k=>data.get(k)||''};
 assert.equal(one.draggable,true);one.listeners.dragstart({dataTransfer:transfer});
 two.getBoundingClientRect=()=>({left:100,right:200});two.closest=()=>two;
 await f.strip.listeners.drop({target:two,clientX:180,dataTransfer:transfer,preventDefault(){},stopPropagation(){}});
 assert.equal(data.get(PREVIEW_TAB_MIME),'one');assert.deepEqual(reordered,['']);
 assert.equal(f.calls.some(c=>['pane-window-reorder','pane-window-drop','pane-window-detach'].includes(c.operation)),false);
 one.listeners.dragend();f.api.destroy();
});


test('preview tabs reorder among application tabs without mutating native membership',async()=>{
 const f=fixture();f.strip.insertBefore=(child,anchor)=>f.strip.children.splice(f.strip.children.indexOf(anchor),0,child);
 f.push([{id:'cad',title:'CAD',active:true},{id:'chrome',title:'Chrome',active:false}]);
 const reordered=[];f.api.setDocumentTabs([{id:'doc',title:'Preview',nativeIndex:1,onReorder:(before,position)=>reordered.push({before,position})}]);
 assert.deepEqual(f.strip.children.slice(1).map(node=>node.getAttribute('data-pane-tab-id')||node.getAttribute('data-preview-tab-id')),['cad','doc','chrome']);
 const cad=f.strip.children[1],doc=f.strip.children[2],data=new Map();cad.getBoundingClientRect=()=>({left:100,right:200});cad.closest=()=>cad;
 const transfer={types:[PREVIEW_TAB_MIME],setData:(k,v)=>data.set(k,v),getData:k=>data.get(k)||''};doc.listeners.dragstart({dataTransfer:transfer});
 await f.strip.listeners.drop({target:cad,clientX:110,dataTransfer:transfer,preventDefault(){},stopPropagation(){}});
 assert.deepEqual(reordered,[{before:'',position:{nativeIndex:0}}]);
 assert.equal(f.calls.some(call=>['pane-window-reorder','pane-window-detach'].includes(call.operation)),false);doc.listeners.dragend();f.api.destroy();
});

test('preview tabs reuse supplied file icons and refresh when icon resolves',()=>{
 const f=fixture();const tab={id:'doc',title:'Drawing',onSelect(){},onClose(){}};
 f.api.setDocumentTabs([tab]);
 f.api.setDocumentTabs([{...tab,icon:'data:image/png;base64,file-icon'}]);
 const button=f.strip.children[1].children[0];
 assert.equal(button.children[0].src,'data:image/png;base64,file-icon');
 assert.equal(button.children[1].textContent,'Drawing');
 f.api.destroy();
});

test('toolbar lens preserves screen click and clipboard right-click activation',async()=>{
 const sources=[];const button=createLensButton({createElement:()=>new Element()},async source=>sources.push(source));
 const event={preventDefault(){},stopPropagation(){}};
 button.listeners.click(event);await settle();button.listeners.contextmenu(event);await settle();
 assert.deepEqual(sources,['screen','clipboard']);assert.equal(button.disabled,false);
});

for(const action of ['select','move'])test(`foreign in-use picker ${action} requires explicit host ownership action`,async()=>{
 const inUse={transferId:'ticket',samePage:false,label:'Other page · window 2'};
 let choose;const f=fixture({windowCandidates:async()=>({outcome:'success',candidates:[{id:'candidate',title:'Writer',inUse}]}),windowCandidatePicker:()=>new Promise(resolve=>choose=resolve),windowCandidatePickerUpdate:async()=>{choose({action,candidateId:'candidate'});return {outcome:'success',delivery:'applied'};}});
 f.strip.children[0].listeners.click();await settle();
 assert.equal(f.calls.some(c=>c.operation==='pane-window-attach'),false);
 assert.equal(f.calls.at(-1).operation,action==='move'?'pane-window-transfer':'pane-window-reveal');f.api.destroy();
});

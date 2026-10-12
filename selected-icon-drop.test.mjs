import test from 'node:test';
import assert from 'node:assert/strict';
import {bindSelectedIconDrop,replaceSelectedIcons} from './public/app/selected-icon-drop.js';
function harness(selection=[{id:'one'}],apply=async()=>true){
 const listeners=new Map(),classes=new Set(),calls=[],messages=[];
 const element={addEventListener(t,f){listeners.set(t,f)},contains:()=>false,classList:{add:x=>classes.add(x),remove:x=>classes.delete(x)}};
 bindSelectedIconDrop({element,getSelection:()=>selection,apply:async(...a)=>{calls.push(a);return apply(...a)},setStatus:x=>messages.push(x)});
 return {calls,messages,classes,async drop(files,types=[]){const e={dataTransfer:{files,types},preventDefault(){this.prevented=true},stopImmediatePropagation(){this.stopped=true}};await listeners.get('drop')(e);return e;},over(){const e={dataTransfer:{types:[],items:[{kind:'file',type:'image/png'}]},preventDefault(){},stopImmediatePropagation(){}};listeners.get('dragover')(e)}};
}
const image={name:'picture.png',type:'image/png'};
test('external image replaces selected icon and highlights pane',async()=>{const h=harness();h.over();assert.ok(h.classes.has('icon-drop-ready'));const e=await h.drop([image]);assert.ok(e.prevented&&e.stopped);assert.equal(h.calls.length,1);assert.equal(h.calls[0][1],image);assert.equal(h.classes.size,0);assert.equal(h.messages.at(-1),'Icon updated.');});
test('internal drags and normal imports remain untouched',async()=>{for(const [files,types,selection] of [[[image],['application/x-papers-ayg-navigator-items'],[{id:'one'}]],[[{name:'a.txt',type:'text/plain'}],[],[{id:'one'}]],[[image],[],[]],[[image,image],[],[{id:'one'}]]]){const h=harness(selection);assert.equal((await h.drop(files,types)).prevented,undefined);assert.equal(h.calls.length,0);}});
test('failed save reports error without claiming success',async()=>{const h=harness(undefined,async()=>{throw Error('Cannot save')});await h.drop([image]);assert.equal(h.messages.at(-1),'Cannot save');});
test('shared-entry decision does not prematurely report a save',async()=>{const h=harness(undefined,async()=>false);await h.drop([image]);assert.ok(!h.messages.includes('Icon updated.'));});

test('batch drop consumes image for all selected entries',async()=>{const selection=[{id:'one'},{id:'two'}];const h=harness(selection);await h.drop([image]);assert.deepEqual(h.calls[0][0],selection);});
test('icon batch preserves record data and updates linked placements without editor validation',()=>{
const group={id:'g',name:'Folder',extra:1};const record={id:'s',name:'Link',description:'Description',target:'D:/app.exe',placements:[{id:'p1'},{id:'p2'}]};const untouched={id:'other',icon:'old'};
const state={groups:[group],shortcuts:[record,untouched],view:{anything:true}};
const next=replaceSelectedIcons(state,[{kind:'group',item:group},{kind:'shortcut',item:record},{kind:'shortcut',item:record}],'new-image');
assert.deepEqual(next.groups[0],{...group,icon:'new-image'});assert.deepEqual(next.shortcuts[0],{...record,icon:'new-image'});assert.equal(next.shortcuts[0].placements,record.placements);assert.equal(next.shortcuts[1],untouched);assert.equal(next.view,state.view);assert.equal(group.icon,undefined);
});

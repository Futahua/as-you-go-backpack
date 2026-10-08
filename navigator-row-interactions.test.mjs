import test from 'node:test';
import assert from 'node:assert/strict';
import { navigatorReorderPlan, bindNavigatorRowInteractions } from './public/app/navigator-row-interactions.js';

test('reorder keeps batch order and moves it before/after the current cursor row',()=>{
  assert.deepEqual(navigatorReorderPlan({rows:['a','b','c','d'],selected:['c','a'],target:'d',after:true}),
    {moving:['a','c'],beforeId:null,order:['b','d','a','c']});
  assert.deepEqual(navigatorReorderPlan({rows:['a','b','c','d'],selected:['b','c'],target:'a',after:false}),
    {moving:['b','c'],beforeId:'a',order:['b','c','a','d']});
});
test('dropping a batch on itself does not change its order',()=>{
  assert.equal(navigatorReorderPlan({rows:['a','b'],selected:['a','b'],target:'a',after:true}),null);
});


function harness(options={}){
  const body=new EventTarget(), document=new EventTarget();
  let selected=['a'];const commits=[];
  const rows=['a','b','c'].map((id,index)=>({dataset:{id,reorderParent:'root',reorderFolder:'false'},
    getBoundingClientRect:()=>({left:0,right:100,top:index*30,bottom:index*30+25,height:25}),
    classList:{contains:()=>false,add(){},remove(){}}}));
  body.closest=()=>body.hoverRow||null;
  body.querySelectorAll=selector=>selector.includes('data-id')?rows:[];
  body.setPointerCapture=()=>{};body.hasPointerCapture=()=>false;body.releasePointerCapture=()=>{};
  body.contains=()=>false;
  body.insertBefore=()=>{};rows.forEach(row=>row.parentNode=body);
  const classes=new Set();
  const overlay={hidden:true,style:{},classList:{toggle(name,on){if(on)classes.add(name);else classes.delete(name);},contains:name=>classes.has(name)},remove(){}};
  document.createElement=()=>overlay;document.body={append(){}};
  const binding=bindNavigatorRowInteractions({document,body,getSelection:()=>selected,
    setSelection:ids=>{selected=[...new Set(ids)];},reorder:plan=>commits.push(plan),restore(){},...options});
  function event(type,props){const e=new Event(type,{cancelable:true});Object.assign(e,props);body.dispatchEvent(e);return e;}
  return {body,document,rows,overlay,binding,event,commits,selection:()=>selected};
}
test('right-to-left adds and left-to-right subtracts',()=>{
  const h=harness();
  h.event('pointerdown',{button:2,pointerId:1,clientX:90,clientY:29,shiftKey:false});
  h.event('pointermove',{pointerId:1,clientX:0,clientY:85});
  assert.deepEqual(h.selection(),['a','b','c']);
  assert.equal(h.overlay.hidden,false);
  h.event('pointerup',{pointerId:1});
  assert.equal(h.overlay.hidden,true);
  assert.equal(h.event('contextmenu',{}).defaultPrevented,true);
  h.event('pointerdown',{button:2,pointerId:2,clientX:0,clientY:29,shiftKey:false});
  h.event('pointermove',{pointerId:2,clientX:90,clientY:55});
  assert.deepEqual(h.selection(),['a','c']);
  h.event('pointerup',{pointerId:2});h.binding.cancel();
});
test('drag updates its destination on cursor motion and commits only the final drop',()=>{
  const h=harness();h.body.hoverRow=h.rows[0];
  h.event('dragstart',{});
  h.body.hoverRow=h.rows[1];h.event('dragover',{clientY:50,dataTransfer:{}});
  h.body.hoverRow=h.rows[2];h.event('dragover',{clientY:65,dataTransfer:{}});
  assert.equal(h.commits.length,0);
  h.event('drop',{});
  assert.equal(h.commits.length,1);
  assert.equal(h.commits[0].beforeId,'c');
  assert.deepEqual(h.commits[0].order,['b','a','c']);h.binding.cancel();
});


test('cross-folder preview inserts a batch into an empty folder and back into its parent',()=>{
  assert.deepEqual(navigatorReorderPlan({rows:[],sourceRows:['a','b'],selected:['a','b'],target:null,after:false}),
    {moving:['a','b'],beforeId:null,order:['a','b']});
  assert.deepEqual(navigatorReorderPlan({rows:['folder','c'],sourceRows:['a','b','folder','c'],selected:['a','b'],target:'c',after:false}),
    {moving:['a','b'],beforeId:'c',order:['folder','a','b','c']});
});


test('cursor can preview into a folder then back out, committing only its final destination',()=>{
  const inserts=[];
  const inside={insertBefore(row){inserts.push(['folder',row.dataset.id]);}};
  let h;
  h=harness({resolveDestination:(row,center)=>center
    ? {parent:'folder',container:inside,rows:[]}
    : {parent:'root',container:h.body,rows:h.rows.filter(r=>r.dataset.id!=='a')}});
  h.body.hoverRow=h.rows[0];h.event('dragstart',{});
  h.rows[1].dataset.reorderFolder='true';h.body.hoverRow=h.rows[1];
  h.event('dragover',{clientY:42,dataTransfer:{}});
  assert.deepEqual(inserts,[['folder','a']]);assert.equal(h.commits.length,0);
  h.body.hoverRow=h.rows[2];h.event('dragover',{clientY:65,dataTransfer:{}});
  h.event('drop',{});
  assert.equal(h.commits.length,1);assert.equal(h.commits[0].parent,'root');
  assert.equal(h.commits[0].beforeId,'c');h.binding.cancel();
});
test('invalid destinations do not create a pending move',()=>{
  const h=harness({canMove:()=>false});h.body.hoverRow=h.rows[0];h.event('dragstart',{});
  h.body.hoverRow=h.rows[1];h.event('dragover',{clientY:50,dataTransfer:{}});h.event('drop',{});
  assert.equal(h.commits.length,0);h.binding.cancel();
});


test('a previewed batch under the cursor retains its pending reorder until drop',()=>{
  const h=harness();h.body.getBoundingClientRect=()=>({left:0,top:0,right:100,bottom:100});
  h.body.hoverRow=h.rows[0];h.event('dragstart',{});
  h.body.hoverRow=h.rows[2];h.event('dragover',{clientY:65,dataTransfer:{}});
  h.body.hoverRow=h.rows[0];
  h.event('dragleave',{clientX:50,clientY:65,relatedTarget:null});
  assert.equal(h.event('dragover',{clientY:65,dataTransfer:{}}).defaultPrevented,true);
  h.event('drop',{});
  assert.equal(h.commits.length,1);
  assert.deepEqual(h.commits[0].order,['b','a','c']);
  assert.equal(h.commits[0].beforeId,'c');h.binding.cancel();
});


test('marquee switches mode across its origin using the original baseline and right click preserves selection',()=>{
  const h=harness();
  h.event('pointerdown',{button:2,pointerId:1,clientX:50,clientY:0});
  h.event('pointermove',{pointerId:1,clientX:60,clientY:25});
  assert.equal(h.overlay.classList.contains('deselecting'),true);
  assert.deepEqual(h.selection(),[]);
  h.event('pointermove',{pointerId:1,clientX:0,clientY:25});
  assert.equal(h.overlay.classList.contains('deselecting'),false);
  assert.deepEqual(h.selection(),['a']);
  h.event('pointermove',{pointerId:1,clientX:60,clientY:25});
  assert.equal(h.overlay.classList.contains('deselecting'),true);
  assert.deepEqual(h.selection(),[]);
  h.event('pointerup',{pointerId:1});
  h.event('pointerdown',{button:2,pointerId:2,clientX:50,clientY:29});
  h.event('pointermove',{pointerId:2,clientX:40,clientY:55});
  assert.deepEqual(h.selection(),['b']);
  h.event('pointermove',{pointerId:2,clientX:90,clientY:55});
  assert.deepEqual(h.selection(),[]);
  assert.equal(h.overlay.classList.contains('deselecting'),true);
  h.event('pointermove',{pointerId:2,clientX:40,clientY:55});
  assert.deepEqual(h.selection(),['b']);
  h.event('pointerup',{pointerId:2});
  h.event('pointerdown',{button:2,pointerId:3,clientX:50,clientY:40});
  h.event('pointerup',{pointerId:3});
  assert.equal(h.event('contextmenu',{}).defaultPrevented,false);
  assert.deepEqual(h.selection(),['b']);h.binding.cancel();
});


test('a drop on another destination consumes no pending reorder',async()=>{
  let restored=0;
  const h=harness({restore:()=>restored++});
  h.body.hoverRow=h.rows[0];h.event('dragstart',{});
  h.body.hoverRow=h.rows[2];h.event('dragover',{clientY:65,dataTransfer:{}});
  const drop=new Event('drop',{cancelable:true});h.document.dispatchEvent(drop);
  assert.equal(drop.defaultPrevented,false);
  h.event('drop',{});
  await Promise.resolve();
  assert.equal(h.commits.length,0);assert.equal(restored,1);h.binding.cancel();
});


test('plain right click reaches folder expansion while preserving selection',()=>{
  const h=harness();
  h.event('pointerdown',{button:2,pointerId:1,clientX:50,clientY:40,shiftKey:false});
  h.event('pointerup',{pointerId:1});
  assert.equal(h.event('contextmenu',{shiftKey:false}).defaultPrevented,false);
  assert.deepEqual(h.selection(),['a']);h.binding.cancel();
});


test('marquee updates selection live but only finishes preview once on release',()=>{
  let previews=0;const h=harness({finishSelection:()=>previews++});
  h.event('pointerdown',{button:2,pointerId:1,clientX:90,clientY:29});
  h.event('pointermove',{pointerId:1,clientX:0,clientY:55});
  h.event('pointermove',{pointerId:1,clientX:0,clientY:85});
  assert.equal(previews,0);assert.deepEqual(h.selection(),['a','b','c']);
  h.event('pointerup',{pointerId:1});assert.equal(previews,1);h.binding.cancel();
});

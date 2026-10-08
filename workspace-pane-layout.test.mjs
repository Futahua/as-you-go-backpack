import test from 'node:test';
import assert from 'node:assert/strict';
import { paneRegions, PREVIEW_SURFACES } from './public/app/workspace-pane-layout.js';
const input={left:8,right:700,top:60,bottom:792,viewportWidth:1200,preview:true,windows:true};
const overlaps=(a,b)=>a&&b&&Math.min(a.x+a.width,b.x+b.width)>Math.max(a.x,b.x)&&Math.min(a.y+a.height,b.y+b.height)>Math.max(a.y,b.y);
test('all preview surfaces leave the left and native-window regions disjoint',()=>{
 for(const placement of PREVIEW_SURFACES){const regions=paneRegions({...input,placement});assert.equal(overlaps(regions.left,regions.preview),false,placement);assert.equal(overlaps(regions.right,regions.preview),false,placement);assert.equal(overlaps(regions.left,regions.right),false,placement);assert.equal(regions.right.x,700,'native left edge remains authoritative');}
});
test('preview and native windows toggle independently without stranding the left pane',()=>{
 const hiddenPreview=paneRegions({...input,preview:false,placement:'middle'});assert.equal(hiddenPreview.preview,null);assert.equal(hiddenPreview.left.width,692);
 const hiddenWindows=paneRegions({...input,windows:false,placement:'middle'});assert.equal(hiddenWindows.right,null);assert.ok(hiddenWindows.preview);assert.equal(overlaps(hiddenWindows.left,hiddenWindows.preview),false);
 const both=paneRegions({...input,windows:false,preview:false});assert.equal(both.left.width,1184);assert.equal(both.right,null);assert.equal(both.preview,null);
});

import {previewDropSurface,installPreviewDocking} from './public/app/preview-docking.js';
test('preview docking targets both pane halves and middle, rejecting outside drops',()=>{
 const g={left:8,right:700,top:8,bottom:792,width:1200,windows:true};
 for(const [x,y,target] of [[200,100,'left-top'],[200,600,'left-bottom'],[1000,100,'right-top'],[1000,600,'right-bottom'],[700,400,'middle'],[0,100,null],[100,800,null]])assert.equal(previewDropSurface(x,y,g),target);
 assert.equal(previewDropSurface(1000,100,{...g,windows:false}),'left-top');
});
test('preview drag commits only armed drops and cancellation restores without saving',async()=>{
 class E{listeners={};style={};classList={add(){},remove(){},toggle(){}};append(){}prepend(){}setAttribute(){}addEventListener(k,f){this.listeners[k]=f}setPointerCapture(){}hasPointerCapture(){return false}remove(){}}
 const elements=[],events={};const header=new E();let release,starts=0,finishes=0;const drops=[];
 const document={createElement(){const e=new E();elements.push(e);return e},body:new E(),defaultView:{addEventListener(k,f){events[k]=f},removeEventListener(){}}};
 const docking=installPreviewDocking({document,header,getGeometry:()=>({left:8,right:700,top:8,bottom:792,width:1200,windows:true}),getRegion:()=>({x:8,y:8,width:300,height:300}),onStart:()=>{starts++;return new Promise(r=>release=r)},onFinish:()=>finishes++,onDrop:p=>drops.push(p)});
 const handle=elements[0],event=(x,y)=>({button:0,pointerId:1,clientX:x,clientY:y,preventDefault(){}});
 handle.listeners.pointerdown(event(20,20));handle.listeners.pointermove(event(200,100));handle.listeners.pointerup(event(200,100));release();await Promise.resolve();assert.deepEqual(drops,[]);
 handle.listeners.pointerdown(event(20,20));handle.listeners.pointermove(event(1000,600));release();await Promise.resolve();handle.listeners.pointerup(event(1000,600));assert.deepEqual(drops,['right-bottom']);
 handle.listeners.pointerdown(event(20,20));handle.listeners.pointermove(event(700,400));release();await Promise.resolve();events.keydown({key:'Escape',preventDefault(){}});assert.deepEqual(drops,['right-bottom']);assert.equal(starts,3);assert.equal(finishes,3);assert.equal(elements[2].hidden,true);docking.destroy();
});

import {resizedPreviewShare} from './public/app/preview-resizing.js';
test('resizing preview changes only its shared boundary and preserves the native right column',()=>{
 for(const placement of PREVIEW_SURFACES){for(const previewShare of [.2,.7]){
  const regions=paneRegions({...input,placement,previewShare});
  assert.equal(regions.right.x,input.right,'Proxima and AYG windows remain in their right column');
  assert.equal(overlaps(regions.preview,regions.right),false);
  assert.equal(overlaps(regions.preview,regions.left),false);
 }}
 assert.equal(resizedPreviewShare('left-bottom','top',100,1000,.5),.4);
 assert.equal(resizedPreviewShare('right-top','bottom',100,1000,.5),.6);
 assert.equal(resizedPreviewShare('middle','left',100,1000,.5),.4);
 assert.equal(resizedPreviewShare('middle','left',9999,1000,.5),.12);
});

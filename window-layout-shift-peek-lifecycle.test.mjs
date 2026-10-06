import assert from 'node:assert/strict';
import test from 'node:test';
import { activateAndDismissWidgetMember } from './public/app/window-layout-widget-surface.js';
import { createWindowLayoutShiftPeekLifecycle as createLifecycle } from './public/app/window-layout-shift-peek-lifecycle.js';
const tick=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};
const member=id=>({dataset:{wlLayout:'L',wlMember:id}});
function harness(overrides={}){
 const calls=[];const timers=new Map();let id=0;
 const deps={host:{windowPeekBeginCapability:async cap=>{calls.push(['begin',cap.id]);return {outcome:'success'};},windowPeekEnd:async()=>{calls.push(['end']);}},resolveWindowLayoutPreviewCapability:async(_layout,id)=>({id}),cancelWindowLayoutPreviewDwell:()=>calls.push(['dwell']),windowLayoutMemberPopover:{hide:()=>calls.push(['hide'])},windowLayoutMemberPreview:{cancel:()=>calls.push(['cancel'])},WIDGET_SURFACE:false,document:{title:''},setTimeout:(fn,ms)=>{timers.set(++id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),...overrides};
 const lifecycle=createLifecycle(deps);
 return {lifecycle,calls,timers,deps,start:id=>lifecycle.apply({handled:true,held:true,begin:member(id),end:false}),fire:ms=>{for(const [id,timer]of [...timers])if(timer.ms===ms){timers.delete(id);timer.fn();}}};
}
test('rapid traversal coalesces to the last target after 32ms',async()=>{const h=harness();h.start('a');h.start('b');h.start('c');assert.equal(h.timers.size,1);h.fire(32);await tick();assert.deepEqual(h.calls.filter(c=>c[0]==='begin'),[['begin','c']]);});
test('release before dwell cancels begin and converging ends issue one native end',async()=>{const h=harness();h.start('a');h.lifecycle.apply({handled:true,held:false,begin:null,end:true});h.lifecycle.end();h.fire(32);await tick();assert.deepEqual(h.calls.filter(c=>['begin','end'].includes(c[0])),[['end']]);assert.equal(h.lifecycle.key,null);});
test('capability lookup resolving after release cannot begin a stale target',async()=>{let resolve;const h=harness({resolveWindowLayoutPreviewCapability:()=>new Promise(done=>{resolve=done;})});h.start('a');h.fire(32);await tick();h.lifecycle.apply({handled:true,held:false,begin:null,end:true});resolve({id:'a'});await tick();assert.deepEqual(h.calls.filter(c=>c[0]==='begin'),[]);});
test('transient missing capabilities retry with bounded cadence while held',async()=>{const h=harness({resolveWindowLayoutPreviewCapability:async()=>null});h.start('a');h.fire(32);await tick();assert.equal([...h.timers.values()][0].ms,180);h.fire(180);await tick();assert.equal([...h.timers.values()][0].ms,300);h.lifecycle.end();assert.equal(h.timers.size,0);});
test('leave grace is 120ms and pointer re-entry cancels it',async()=>{const h=harness();h.start('a');h.fire(32);await tick();h.lifecycle.deferEnd();assert.equal([...h.timers.values()][0].ms,120);h.lifecycle.keepAlive();assert.equal(h.timers.size,0);h.lifecycle.deferEnd();h.fire(120);await tick();assert.equal(h.lifecycle.held,false);assert.equal(h.lifecycle.key,null);});
test('dismissal reaches the host immediately while an old begin reply is unfinished',async()=>{
 let finish;const calls=[];const h=harness({host:{windowPeekBeginCapability:async cap=>{calls.push(['begin',cap.id]);if(cap.id==='a')await new Promise(done=>{finish=done;});return {outcome:'success'};},windowPeekEnd:async()=>calls.push(['end'])}});
 h.start('a');h.fire(32);await tick();await h.lifecycle.endAndWait();
 assert.deepEqual(calls,[['begin','a'],['end']]);
 h.start('b');h.fire(32);await tick();assert.deepEqual(calls,[['begin','a'],['end'],['begin','b']]);
 finish();await tick();assert.equal(h.lifecycle.key,'L\u0000b');assert.deepEqual(calls,[['begin','a'],['end'],['begin','b']]);
});
test('new hover waits for actual native release, without waiting for obsolete begin reply',async()=>{
 let finishBegin,finishEnd;const calls=[];const h=harness({host:{windowPeekBeginCapability:async cap=>{calls.push(['begin',cap.id]);if(cap.id==='a')await new Promise(done=>{finishBegin=done;});return {outcome:'success'};},windowPeekEnd:async()=>{calls.push(['end']);await new Promise(done=>{finishEnd=done;});}}});
 h.start('a');h.fire(32);await tick();h.lifecycle.end();await tick();h.start('b');h.fire(32);await tick();
 assert.deepEqual(calls,[['begin','a'],['end']]);finishEnd();await tick();assert.deepEqual(calls,[['begin','a'],['end'],['begin','b']]);finishBegin();await tick();assert.equal(h.lifecycle.key,'L\u0000b');
});

test('two immediate Alt+Q picks activate and dismiss while old hover replies remain pending',async()=>{
 const pending=[];const actions=[];const h=harness({host:{windowPeekBeginCapability:cap=>new Promise(resolve=>pending.push({cap,resolve})),windowPeekEnd:async()=>{actions.push('release');return {outcome:'success'};}}});
 const host={windowControlActivate:async(_layout,id)=>{actions.push('activate:'+id);return {outcome:'activated'};},widgetMinimize:async()=>actions.push('hide')};
 for(const id of ['a','b']){h.start(id);h.fire(32);await tick();const pick=activateAndDismissWidgetMember({host,layoutId:'L',memberId:id,peek:true,shiftPeek:h.lifecycle});await tick();assert.ok(actions.includes('activate:'+id));await pick;}
 assert.deepEqual(actions,['release','activate:a','hide','release','activate:b','hide']);
 assert.equal(pending.length,2);for(const reply of pending)reply.resolve({outcome:'success'});await tick();assert.equal(h.lifecycle.key,null);assert.equal(h.timers.size,0);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { createWindowLayoutCardPresentation as createPresentation } from './public/app/window-layout-card-presentation.js';
function harness(options={}){
 const calls=[];const timers=new Map();let timerId=0;let callback;let state={version:1};
 class Observer{constructor(fn){callback=fn;}observe(card){calls.push(['observe',card]);}unobserve(card){calls.push(['unobserve',card]);}}
 const props=new Map();const members={querySelectorAll:()=>Array(options.count??9).fill({}),style:{setProperty:(key,value)=>props.set(key,value),removeProperty:key=>props.delete(key)}};
 const shell={style:{setProperty:(key,value)=>calls.push(['shell',key,value])}};
 const card={clientWidth:options.width??280,isConnected:true,style:{width:'200px'},dataset:{wlCard:'L'},scrollHeight:55.2,querySelector:()=>members,matches:()=>false,getBoundingClientRect:()=>({width:301.4}),closest:()=>shell};
 const root={querySelectorAll:()=>[card]};
 const deps={ResizeObserver:Observer,WIDGET_SURFACE:false,WINDOW_LAYOUT_CARD_MAX_WIDTH:280,getState:()=>state,windowLayoutFromState:()=>({id:'L'}),setTimeout:(fn,ms)=>{timers.set(++timerId,{fn,ms});return timerId;},clearTimeout:id=>timers.delete(id),setWindowLayoutCardSize:(current,id,width,height)=>{calls.push(['size',current.version,id,width,height]);return {...current,version:current.version+1};},store:{replace:next=>{state=next;calls.push(['replace']);},save:async(next,metadata)=>{calls.push(['save',next.version,metadata]);}},...options.deps};
 const presentation=createPresentation(deps);
 return {presentation,card,root,props,calls,timers,deps,resize:()=>callback([{target:card}]),flush:()=>{const pending=[...timers.values()];timers.clear();for(const timer of pending)timer.fn();}};
}
test('balance uses measured width and distributes nine icons as five plus four',()=>{const h=harness();h.presentation.install(h.root);assert.equal(h.props.get('--wl-balanced-member-width'),'156px');assert.equal(h.calls[0][0],'observe');});
test('empty cards remove the balancing property',()=>{const h=harness({count:0});h.props.set('--wl-balanced-member-width','stale');h.presentation.balance(h.card);assert.equal(h.props.has('--wl-balanced-member-width'),false);});
test('resize caps width, rounds height and debounces through the existing save metadata',()=>{const h=harness();h.resize();h.resize();assert.equal(h.timers.size,1);assert.equal([...h.timers.values()][0].ms,180);h.flush();assert.deepEqual(h.calls.filter(c=>c[0]!=='shell'),[['size',1,'L',280,56],['replace'],['save',2,{rebaseAutomaticSave:true}]]);});
for(const kind of ['widget','placeholder','disconnected','no-explicit-width'])test(`resize ignores persistence for ${kind}`,()=>{const h=harness({deps:kind==='widget'?{WIDGET_SURFACE:true}:{}});if(kind==='placeholder')h.card.matches=()=>true;if(kind==='disconnected')h.card.isConnected=false;if(kind==='no-explicit-width')h.card.style.width='';h.resize();assert.equal(h.timers.size,0);assert.equal(h.props.has('--wl-balanced-member-width'),true);});
test('disconnection before trailing save prevents a write',()=>{const h=harness();h.resize();h.card.isConnected=false;h.flush();assert.equal(h.calls.some(c=>c[0]==='save'),false);});
test('remove unobserves every card without cancelling an existing trailing timer',()=>{const h=harness();h.resize();h.presentation.remove(h.root);assert.equal(h.calls.at(-1)[0],'unobserve');assert.equal(h.timers.size,1);});
test('missing layout prevents a trailing write',()=>{const h=harness({deps:{windowLayoutFromState:()=>null}});h.resize();h.flush();assert.equal(h.calls.some(c=>c[0]==='save'),false);});

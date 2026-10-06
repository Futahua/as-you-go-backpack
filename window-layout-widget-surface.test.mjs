import assert from 'node:assert/strict';
import test from 'node:test';
import { createWindowLayoutSelection } from './public/app/window-layout-selection.js';
import { createWindowLayoutWidgetPicker } from './public/app/window-layout-widget-picker.js';
import { createClickTwiceGuard } from './public/app/click-twice-guard.js';
import { createWidgetHoverPolicy, createWidgetHoverPolicyDiagnostics } from './public/app/widget-hover-policy.js';
import { handleWidgetClearActivation, handleWidgetDeleteActivation } from './public/app/widget-clear-activation.js';
import { createWindowLayoutMemberDrag } from './public/app/window-layout-detached.js';
import { windowLayoutWidgetRenderIdentity, windowLayoutWidgetCommittedStatus } from './public/app/window-layout-widget-channel.js';
import { closeAndRemoveWidgetMember, activateAndDismissWidgetMember, bootstrapWindowLayoutWidget as bootstrap } from './public/app/window-layout-widget-surface.js';
function eventTarget(){const listeners=new Map();return {listeners,addEventListener:(type,fn)=>{if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(fn);},removeEventListener:(type,fn)=>{listeners.set(type,(listeners.get(type)??[]).filter(x=>x!==fn));},emit(type,event={}){for(const fn of listeners.get(type)??[])fn(event);}};}
async function harness(overrides={}){
 const calls=[];const timers=new Map();let timerId=0;let receive;let sharedClient=null;let controlSnapshot=null;let previewSnapshot=null;const values=new Map();
 const root={...eventTarget(),style:{setProperty:(...args)=>calls.push(['style',...args])}};
 const card={...eventTarget()};const grid={...eventTarget(),innerHTML:'',replaceChildren:child=>calls.push(['bootstrap-card',child.textContent]),querySelector:selector=>selector==='.window-layout-body'?card:null,querySelectorAll:()=>[]};
 const document={documentElement:root,querySelectorAll:()=>[],createElement:()=>({setAttribute(){}})};
 const window={...eventTarget(),innerWidth:200,innerHeight:80,location:{origin:'test'},postMessage:()=>{}};
 const client={ready:()=>calls.push(['channel-ready']),requestSnapshot:()=>calls.push(['snapshot-request']),requestHoverPolicy:()=>calls.push(['hover-request']),sendCommand:command=>calls.push(['command',command]),sendCommandAndWait:async()=>({type:'success'}),sendCardSize:(...args)=>calls.push(['card-size',...args]),dispose:()=>calls.push(['dispose']),close:()=>calls.push(['close'])};
 const host={widgetReady:async()=>calls.push(['host-ready']),setWidgetHoverPolicy:async()=>({ok:true}),onWidgetQuickRunSealRequest:()=>{},widgetReportSize:async(...args)=>calls.push(['host-size',...args]),widgetCloseSelf:async()=>calls.push(['close-self']),pickWindowCancel:async()=>calls.push(['pick-cancel'])};
 const deps={WIDGET_SURFACE:{layoutId:'L'},localStorage:{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)},document,window,elements:{grid},CSS:{escape:x=>x},Element:class{},host,createSafeBroadcastChannel:()=>({}),WINDOW_LAYOUT_WIDGET_CHANNEL:'channel',WINDOW_LAYOUT_CARD_MAX_WIDTH:280,WINDOW_LAYOUT_DROP_OUT_PX:20,createWindowLayoutSelection,createWindowLayoutWidgetPicker,createClickTwiceGuard,createWidgetHoverPolicy,createWidgetHoverPolicyDiagnostics,handleWidgetClearActivation,handleWidgetDeleteActivation,createWindowLayoutMemberDrag,windowLayoutWidgetRenderIdentity,windowLayoutWidgetCommittedStatus,createWindowLayoutWidgetChannelClient:options=>{receive=options.onMessage;calls.push(['listener-installed']);return client;},createBoundedRetry:()=>({start:()=>calls.push(['retry-start']),cancel:()=>calls.push(['retry-cancel'])}),windowLayoutRuntime:{icons:new Map(),isolateMode:{click:()=>null,isActive:()=>false}},windowLayoutMemberPreview:{cancel:()=>calls.push(['preview-cancel'])},windowLayoutMemberPopover:{hide:()=>calls.push(['popover-hide'])},windowLayoutWidgetPreviewCapabilities:new Map(),windowLayoutWidgetSelectionChannel:eventTarget(),setWindowLayoutStatus:(...args)=>calls.push(['status',...args]),closeWindowLayoutMember:()=>{},toggleWindowLayoutIsolateMode:()=>{},cancelWindowLayoutPreviewDwell:()=>{},scheduleWindowLayoutListDwell:()=>{},cancelWindowLayoutListDwell:()=>{},moveWindowLayoutMemberButton:()=>{},evictStaleWidgetPreviewCapabilities:()=>{},reconcileWindowLayoutIconSnapshotCache:()=>{},windowLayoutMemberKey:(l,m)=>l+':'+m,removeWindowLayoutCardPresentation:()=>{},installWindowLayoutCardPresentation:()=>{},windowLayoutCardMarkup:()=>{calls.push(['render']);return 'card';},applyTheme:()=>calls.push(['theme']),closeWindowLayoutCandidate:()=>{},restoreHoveredWindowLayoutPreview:()=>{},bindWindowLayoutPickerCandidate:()=>{},windowLayoutCandidateIsMember:()=>false,escapeHtml:x=>x,quickRun:{session:()=>({open:false})},menu:{mount:()=>calls.push(['menu'])},crypto:{randomUUID:()=> 'P'},setTimeout:(fn,ms)=>{timers.set(++timerId,{fn,ms});return timerId;},clearTimeout:id=>timers.delete(id),setInterval:(fn,ms)=>{timers.set(++timerId,{fn,ms});return timerId;},clearInterval:id=>timers.delete(id),get windowLayoutWidgetClient(){return sharedClient;},set windowLayoutWidgetClient(value){sharedClient=value;},set windowControlWidgetSnapshot(value){controlSnapshot=value;},set windowControlSignature(_value){},set windowLayoutWidgetPreviewSnapshot(value){previewSnapshot=value;},setWidgetClient:value=>{sharedClient=value;},setControlSnapshot:value=>{controlSnapshot=value;},setPreviewSnapshot:value=>{previewSnapshot=value;}};
 Object.assign(deps,overrides);await bootstrap(deps);return {calls,deps,window,root,grid,card,host,client,timers,values,receive:message=>receive(message),sharedClient:()=>sharedClient,controlSnapshot:()=>controlSnapshot,previewSnapshot:()=>previewSnapshot};
}
const snapshot=(members=[])=>({id:'L',name:'L',tracking:{enabled:false},members,cardSize:{width:220,height:90},appearance:{backdropOpacity:0.2}});
test('widget installs its channel listener before ready and requests snapshot without workspace startup',async()=>{const h=await harness();const names=h.calls.map(x=>x[0]);assert.ok(names.indexOf('listener-installed')<names.indexOf('host-ready'));assert.ok(names.indexOf('host-ready')<names.indexOf('channel-ready'));assert.equal(names.filter(x=>x==='snapshot-request').length,1);assert.equal(h.sharedClient(),h.client);});
test('duplicate snapshot preserves DOM and native resize while committed status remains visible',async()=>{const h=await harness();const value=snapshot();h.receive({type:'snapshot',revision:1,snapshot:value});h.receive({type:'committed',revision:2,snapshot:value,status:'Nothing removed.'});assert.equal(h.calls.filter(x=>x[0]==='render').length,1);assert.equal(h.calls.filter(x=>x[0]==='host-size').length,1);assert.equal(h.calls.some(x=>x[0]==='status'&&x[2]==='Nothing removed.'),true);assert.equal(h.controlSnapshot(),value);assert.equal(h.previewSnapshot(),value);});
test('first real snapshot restores capped geometry once and reorder skips resize',async()=>{const h=await harness();const value={...snapshot(),cardSize:{width:900,height:91}};h.receive({type:'snapshot',revision:1,snapshot:value});h.receive({type:'committed',revision:2,snapshot:{...value,name:'Renamed'},reason:'reorder'});assert.deepEqual(h.calls.filter(x=>x[0]==='host-size'),[['host-size',280,91]]);assert.equal(h.calls.some(x=>x[0]==='card-size'),false);});
test('fresh widget opacity stays independent of workspace appearance and wheel stores local value',async()=>{const h=await harness();h.receive({type:'snapshot',revision:1,snapshot:snapshot()});assert.equal(h.calls.some(x=>x[0]==='style'&&x[1]==='--workspace-backdrop-opacity'&&x[2]==='1'),true);h.window.emit('wheel',{deltaY:1,preventDefault(){},stopImmediatePropagation(){}});assert.equal(h.values.get('papers-window-layout-widget-opacity:L'),'0.95');});
test('unknown layout after a real snapshot closes the exact widget',async()=>{const h=await harness();h.receive({type:'snapshot',revision:1,snapshot:snapshot()});h.receive({type:'error',code:'unknown-layout'});assert.equal(h.calls.filter(x=>x[0]==='close-self').length,1);});
test('committed deletion closes the exact native widget without rebuilding',async()=>{const h=await harness();h.receive({type:'committed',revision:1,deleted:true});assert.equal(h.calls.filter(x=>x[0]==='close-self').length,1);assert.equal(h.calls.some(x=>x[0]==='render'),false);});
test('pagehide disposes channel and shared references and clears timers and preview capabilities',async()=>{const h=await harness();h.deps.windowLayoutWidgetPreviewCapabilities.set('L:M','cap');h.window.emit('pagehide');assert.equal(h.sharedClient(),null);assert.equal(h.timers.size,0);assert.equal(h.deps.windowLayoutWidgetPreviewCapabilities.size,0);assert.equal(h.calls.filter(x=>x[0]==='dispose').length,1);assert.equal(h.calls.filter(x=>x[0]==='close').length,1);assert.equal(h.calls.some(x=>x[0]==='pick-cancel'),false);});
test('resize bursts retain one eighty millisecond correction',async()=>{const h=await harness();h.window.emit('resize');h.window.emit('resize');assert.equal([...h.timers.values()].filter(x=>x.ms===80).length,1);h.window.emit('pagehide');assert.equal(h.timers.size,0);});

for (const outcome of ['activated','refused','helper-unavailable']) {
 test(`Alt+Q click dismisses after ${outcome} activation verdict`,async()=>{
  const calls=[];
  const result=await activateAndDismissWidgetMember({layoutId:'L',memberId:'M',peek:true,
   shiftPeek:{endAndWait:async()=>calls.push('end')},host:{
    windowControlActivate:async()=>{calls.push('activate');return {outcome};},
    widgetMinimize:async()=>calls.push('hide')}});
  assert.equal(result.outcome,outcome);assert.deepEqual(calls,['end','activate','hide']);
 });
}
test('Alt+Q activation exception still dismisses, while Alt+W stays visible',async()=>{
 for(const peek of [true,false]){
  let hides=0;
  const result=await activateAndDismissWidgetMember({layoutId:'L',memberId:'M',peek,
   host:{windowControlActivate:async()=>{throw new Error('bridge');},widgetMinimize:async()=>{hides++;}}});
  assert.equal(result.outcome,'helper-unavailable');assert.equal(hides,peek?1:0);
 }
});

test('successful close removes the exact icon through the writer with stale retry',async()=>{
 const calls=[];let attempts=0;
 const result=await closeAndRemoveWidgetMember({layoutId:'L',memberId:'M',closeMember:async(l,m)=>{calls.push([l,m]);return true;},client:{sendCommandAndWait:async command=>{calls.push(command);return {type:++attempts===1?'stale':'committed'};}}});
 assert.equal(result,true);assert.deepEqual(calls,[['L','M'],{kind:'remove-member',memberId:'M'},{kind:'remove-member',memberId:'M'}]);
});
test('failed close preserves the icon',async()=>{
 assert.equal(await closeAndRemoveWidgetMember({layoutId:'L',memberId:'M',closeMember:async()=>false,client:{sendCommandAndWait:()=>assert.fail('must preserve icon')}}),false);
});

test('Alt+Q member press activates without a subsequent click, and duplicate click is ignored',async()=>{
 const h=await harness();h.root.dataset={widgetInteraction:'peek'};
 h.receive({type:'snapshot',revision:1,snapshot:snapshot([{id:'M',descriptor:{}}])});
 h.host.windowControlActivate=async(l,m)=>{h.calls.push(['activate',l,m]);return {outcome:'activated'};};h.host.widgetMinimize=async()=>h.calls.push(['hide']);
 const member={dataset:{wlMember:'M'},disabled:false};
 const event={button:0,target:{closest:s=>s==='[data-wl-member]'?member:null},stopPropagation(){}};
 const tick=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
 h.card.emit('pointerdown',event);await tick();assert.equal(h.calls.filter(x=>x[0]==='activate').length,1);
 h.card.emit('click',event);await tick();assert.equal(h.calls.filter(x=>x[0]==='activate').length,1);
 h.card.emit('pointerdown',event);await tick();assert.equal(h.calls.filter(x=>x[0]==='activate').length,2);assert.equal(h.calls.filter(x=>x[0]==='hide').length,2);
});
test('Alt+W and modified member presses retain their existing click handling',async()=>{
 for(const options of [{mode:'legacy'},{mode:'peek',ctrlKey:true},{mode:'peek',shiftKey:true}]){
 const h=await harness();h.root.dataset={widgetInteraction:options.mode};h.receive({type:'snapshot',revision:1,snapshot:snapshot([{id:'M',descriptor:{}}])});h.host.windowControlActivate=()=>assert.fail('not a plain Alt+Q press');const member={dataset:{wlMember:'M'},disabled:false};h.card.emit('pointerdown',{...options,button:0,target:{closest:s=>s==='[data-wl-member]'?member:null},stopPropagation(){}});for(let i=0;i<10;i++)await Promise.resolve();
 }
});

test('plain Alt+Q icons reuse list activation: refresh controls and bypass isolate consumption',async()=>{
 const order=[];const h=await harness({syncControls:async()=>order.push('refresh')});h.root.dataset={widgetInteraction:'peek'};
 h.deps.windowLayoutRuntime.isolateMode.click=()=>assert.fail('Alt+Q selection must not become an isolate command');
 h.receive({type:'snapshot',revision:1,snapshot:snapshot([{id:'M',descriptor:{}}])});
 h.host.windowControlActivate=async()=>{order.push('activate');return {outcome:'activated'};};h.host.widgetMinimize=async()=>order.push('hide');
 const member={dataset:{wlMember:'M'},disabled:false};const event={button:0,target:{closest:s=>s==='[data-wl-member]'?member:null},stopPropagation(){}};
 h.card.emit('pointerdown',event);for(let i=0;i<25;i++)await Promise.resolve();assert.deepEqual(order,['refresh','activate','hide']);
 h.card.emit('click',event);for(let i=0;i<10;i++)await Promise.resolve();assert.deepEqual(order,['refresh','activate','hide']);
});

test('input trace retains second-use press and activation verdict across the same surface',async()=>{
 const h=await harness();h.root.dataset={widgetInteraction:'peek'};h.receive({type:'snapshot',revision:1,snapshot:snapshot([{id:'M',descriptor:{}}])});
 h.host.windowControlActivate=async()=>({outcome:'activated'});h.host.widgetMinimize=async()=>{};
 const member={dataset:{wlMember:'M'},disabled:false};const event={button:0,target:{closest:s=>s==='[data-wl-member]'?member:null},stopPropagation(){}};
 for(let press=1;press<=2;press++){h.window.emit('pointerdown',event);h.card.emit('pointerdown',event);for(let i=0;i<25;i++)await Promise.resolve();assert.match(h.root.dataset.widgetInputTrace,new RegExp('press='+press));assert.match(h.root.dataset.widgetInputTrace,/result=activated/);assert.ok(h.root.dataset.widgetInputTrace.length<=220);}
});

import {resolvePaneLayout} from './pane-layout-model.js';
import {installNativeWindowTabs,PREVIEW_TAB_MIME,NATIVE_TAB_MIME} from './native-window-tabs.js';
import {createFileCapabilityPanel} from './file-capability-panel.js';
import {WINDOW_TAB_MIME,windowTabTransfer} from './window-tab-transfer.js';

export const sliceIds=tree=>tree?.id?[tree.id]:tree?.first&&tree?.second?[...sliceIds(tree.first),...sliceIds(tree.second)]:[];
export function splitSlice(tree,id,next,side){if(tree.id)return tree.id===id?{axis:['left','right'].includes(side)?'x':'y',ratio:.5,first:['left','top'].includes(side)?{id:next}:tree,second:['left','top'].includes(side)?tree:{id:next}}:tree;return {...tree,first:splitSlice(tree.first,id,next,side),second:splitSlice(tree.second,id,next,side)};}
export function closeSlicePlan(tree,id){
 const ids=sliceIds(tree);if(ids.length<2||!ids.includes(id))return null;
 const target=id==='main'?ids.find(key=>key!=='main'):'main';
 const remove=node=>node.id?(node.id===id?null:node):(()=>{const first=remove(node.first),second=remove(node.second);return first&&second?{...node,first,second}:first||second;})();
 const rename=node=>node.id?{id:node.id===target&&id==='main'?'main':node.id}:{...node,first:rename(node.first),second:rename(node.second)};
 const destination=id==='main'?'main':target;
 return {tree:rename(remove(tree)),destination,remap:key=>key===id||id==='main'&&key===target?destination:key};
}

export function sliceRectangles(tree,box,minimized=[],maximized=null){
 const ids=sliceIds(tree),out={};if(maximized&&ids.includes(maximized)){out[maximized]={...box};return out;}
 const prune=node=>node.id?(minimized.includes(node.id)?null:node):(()=>{const first=prune(node.first),second=prune(node.second);return first&&second?{...node,first,second}:first||second;})();
 const draw=(node,r)=>{if(!node)return;if(node.id){out[node.id]=r;return;}const ratio=Math.max(.15,Math.min(.85,node.ratio||.5));if(node.axis==='x'){const span=r.width*ratio;draw(node.first,{...r,width:span});draw(node.second,{...r,x:r.x+span,width:r.width-span});}else{const span=r.height*ratio;draw(node.first,{...r,height:span});draw(node.second,{...r,y:r.y+span,height:r.height-span});}};
 const mini=ids.filter(id=>minimized.includes(id));draw(prune(tree),{...box,height:Math.max(32,box.height-(mini.length?32:0))});mini.forEach((id,i)=>out[id]={x:box.x+i*box.width/mini.length,y:box.y+box.height-32,width:box.width/mini.length,height:32});return out;
}
export function followSliceLeft(tree,id,x,box,minimized=[]){
 if(tree.id)return tree;
 const shown=node=>sliceIds(node).some(key=>!minimized.includes(key));
 if(!shown(tree.first)){const next=followSliceLeft(tree.second,id,x,box,minimized);return next===tree.second?tree:{...tree,second:next};}
 if(!shown(tree.second)){const next=followSliceLeft(tree.first,id,x,box,minimized);return next===tree.first?tree:{...tree,first:next};}
 const ratio=Math.max(.15,Math.min(.85,tree.ratio||.5));
 const first=tree.axis==='x'?{...box,width:box.width*ratio}:{...box,height:box.height*ratio};
 const second=tree.axis==='x'?{...box,x:box.x+first.width,width:box.width-first.width}:{...box,y:box.y+first.height,height:box.height-first.height};
 if(sliceIds(tree.first).includes(id)){const next=followSliceLeft(tree.first,id,x,first,minimized);return next===tree.first?tree:{...tree,first:next};}
 if(!sliceIds(tree.second).includes(id))return tree;
 const next=followSliceLeft(tree.second,id,x,second,minimized);if(next!==tree.second)return {...tree,second:next};
 const target=sliceRectangles(tree.second,second,minimized)[id];
 if(tree.axis!=='x'||Math.abs(target.x-second.x)>2||Math.abs(x-second.x)<2)return tree;
 const adjusted=Math.max(.15,Math.min(.85,(x-box.x)/box.width));
 return Math.abs(adjusted-ratio)*box.width<2?tree:{...tree,ratio:adjusted};
}
export function followsNativeOuterEdge(rect,boxes,outer,minimized=[],maximized=false){const id=rect?.sliceId||"main";return Number.isFinite(rect?.x)&&["resize","placement"].includes(rect.reason)&&!maximized&&!minimized.includes(id)&&Math.abs((boxes[id]?.x??-999)-outer.x)<2;}
export function sliceDropSide(x,y,box){const nx=(x-box.x)/box.width,ny=(y-box.y)/box.height;if(nx<0||nx>1||ny<0||ny>1)return null;const distance=Math.min(nx,1-nx,ny,1-ny);if(distance>.24)return 'center';return distance===nx?'left':distance===1-nx?'right':distance===ny?'top':'bottom';}
export function validSliceTree(tree,seen=new Set()){if(!tree||typeof tree!=='object'||seen.size>=32)return false;if(typeof tree.id==='string'){if(!/^[a-zA-Z0-9-]{1,64}$/.test(tree.id)||seen.has(tree.id))return false;seen.add(tree.id);return true;}return ['x','y'].includes(tree.axis)&&validSliceTree(tree.first,seen)&&validSliceTree(tree.second,seen);}

/** One native owner presents every slice; layout preferences contain no HWNDs or peer IDs. */
export function installWindowSlices({document,host,root,onSettings,onPreviews,onMinimumWidth=()=>{},onStatus=()=>{}}){
 const win=document.defaultView;root.replaceNativeTabs();root.element.classList.add('window-slices-root');
 const region=document.createElement('div');region.className='window-slices-region';document.body.append(region);
 const cue=document.createElement('div');cue.className='preview-split-cue is-armed window-slice-drop';cue.hidden=true;document.body.append(cue);
 let state={tree:{id:'main'},minimized:[],maximized:null},previews=[],tabs=[],ready=false,disposed=false,frame=0,overlay=false,geometry='',sending=false,queued=false;
 const retired=new Set();let closingGroup=null;const views=new Map(),moves=new Map(),activeDocs=new Map(),activeNative=new Map(),constraints=new Map();let focused='main',presentation=null;
 const save=()=>onSettings({tree:state.tree,minimized:[...state.minimized],maximized:state.maximized});
 const outer=()=>{const b=root.element.getBoundingClientRect();return {x:b.left,y:b.top,width:b.width,height:b.height};};
 const page=()=>({x:8,y:8,width:win.innerWidth-16,height:win.innerHeight-16});
 const regions=()=>{const sizes={};for(const tab of tabs)if(tab.active&&!activeDocs.has(tab.sliceId||'main')&&constraints.has(tab.id)){const measured=constraints.get(tab.id),view=views.get(tab.sliceId||'main');sizes[tab.sliceId||'main']={width:measured.width,height:measured.height?measured.height+(view?.header.getBoundingClientRect().height||32)+3:0};}presentation=resolvePaneLayout(state.tree,state.maximized?page():outer(),{constraints:sizes,minimized:state.minimized,maximized:state.maximized,focused});onMinimumWidth(presentation.minimumWidth);return presentation.boxes;};
 const member=id=>tabs.filter(t=>(moves.get(t.id)||t.sliceId||'main')===id);
 function schedule(){if(!frame&&!disposed)frame=win.requestAnimationFrame(render);}
 function savePreviews(next){previews=next;onPreviews(next);schedule();}
 function showDoc(id,tab){activeDocs.set(id,tab.id);const view=views.get(id);if(view){if(!view.preview){view.preview=createFileCapabilityPanel({document,host,previewOnly:true,setStatus:onStatus});view.preview.element.classList.add('slice-file-preview');}void view.preview.previewPath(tab.path,tab.name);}schedule();}
 function moveDoc(id,target,before=''){const record=previews.find(t=>t.id===id);if(!record)return;const old=record.sliceId||'main';if(activeDocs.get(old)===id)activeDocs.delete(old);const next=previews.filter(t=>t.id!==id);const at=next.findIndex(t=>t.id===before);next.splice(at<0?next.length:at,0,{...record,sliceId:target});activeDocs.set(target,id);savePreviews(next);showDoc(target,record);}
 async function publish(layout){if(!ready||disposed)return;if(sending){queued=true;return;}sending=true;const closeTransaction=closingGroup;try{const reply=await host.fileCapability('pane-window-slices',{slices:layout});if(reply?.ok===false)throw new Error(reply.message||reply.error||'Window slices could not be placed');if(closingGroup===closeTransaction)closingGroup=null;}catch(error){moves.clear();activeNative.clear();if(closingGroup){state=closingGroup.state;previews=closingGroup.previews;closingGroup=null;retired.clear();save();onPreviews(previews);schedule();}onStatus(error.message);geometry='';}finally{sending=false;if(queued){queued=false;geometry='';schedule();}}}
 function createView(id){
  const element=document.createElement('section');element.className='window-slice';element.dataset.sliceId=id;
  const header=document.createElement('header');header.className='window-slice-header';
  const number=document.createElement('span');number.className='window-slice-number';header.append(number);
  const tools=document.createElement('span');tools.className='window-slice-controls';
  const button=(label,icon,action)=>{const b=document.createElement('button');b.type='button';b.title=label;b.setAttribute('aria-label',label);b.textContent=icon;b.addEventListener('click',action);tools.append(b);return b;};
  const min=button('Minimize slice','−',()=>{if(state.minimized.includes(id))state.minimized=state.minimized.filter(t=>t!==id);else if(presentation?.autoMinimized.includes(id)){focused=id;}else state.minimized.push(id);if(state.maximized===id)state.maximized=null;save();schedule();});
  const max=button('Maximize slice to page','□',()=>{state.minimized=state.minimized.filter(t=>t!==id);state.maximized=state.maximized===id?null:id;save();schedule();});
  const close=button('Remove window group','×',()=>{
    const plan=closeSlicePlan(state.tree,id);if(!plan||closingGroup)return;
    closingGroup={state:{...state,minimized:[...state.minimized]},previews:[...previews]};
    for(const key of sliceIds(state.tree))if(!sliceIds(plan.tree).includes(key))retired.add(key);
    for(const tab of tabs){const old=moves.get(tab.id)||tab.sliceId||'main',next=plan.remap(old);if(old!==next)moves.set(tab.id,next);}
    for(const [key,doc] of [...activeDocs])if(plan.remap(key)!==key){if(!activeDocs.has(plan.destination))activeDocs.set(plan.destination,doc);activeDocs.delete(key);}
    state={tree:plan.tree,minimized:state.minimized.filter(key=>sliceIds(plan.tree).includes(key)),maximized:null};focused=plan.destination;
    previews=previews.map(tab=>({...tab,sliceId:plan.remap(tab.sliceId||'main')}));save();onPreviews(previews);for(const [key,doc] of activeDocs){const record=previews.find(tab=>tab.id===doc);if(record)showDoc(key,record);}geometry='';schedule();
  });
  element.append(header);region.append(element);
  const listeners=new Set();
  const scopedHost={...host,onPaneTabs:cb=>{listeners.add(cb);return()=>listeners.delete(cb);},fileCapability:(operation,data={})=>{
    if(operation==='pane-window-tabs'){for(const cb of listeners)cb(member(id));return Promise.resolve({ok:true});}
    if(operation==='pane-window-select'){focused=id;state.minimized=state.minimized.filter(key=>key!==id);activeDocs.delete(id);schedule();return host.fileCapability(operation,data);}
    if(operation==='pane-window-attach')return host.fileCapability(operation,{...data,sliceId:id});
    if(operation==='chrome-pane-visible'){overlay=data.visible===false;schedule();return Promise.resolve({ok:true});}
    return host.fileCapability(operation,data);
  }};
  const bounds=()=>{const b=element.getBoundingClientRect(),h=header.getBoundingClientRect();return {x:Math.round(b.left),y:Math.round(h.bottom+1),width:Math.max(1,Math.round(b.width)),height:Math.max(1,Math.round(b.bottom-h.bottom-2))};};
  const native=installNativeWindowTabs({document,header,host:scopedHost,bounds,prepare:async()=>{activeDocs.delete(id);schedule();return true;},overlay:async active=>{overlay=active&&!activeDocs.has(id);schedule();},status:onStatus,sliceId:id,sliceDocking:true,
    lens:async(source='clipboard')=>{const result=await host.fileCapability('browser-lens-screen',{nativeChrome:true,source});if(result.cancelled)return;if(!result.ok)throw new Error(result.message||'Lens could not start');await host.fileCapability('chrome-pane-open',{source:'lens:'+win.crypto.randomUUID(),url:result.url,rect:bounds()});},
  });header.append(tools);
  const view={element,header,number,min,max,close,native,listeners,bounds,preview:null};views.set(id,view);return view;
 }
 function render(){
  frame=0;if(disposed)return;const boxes=regions(),ids=sliceIds(state.tree),layout=[];
  region.hidden=root.element.hidden;region.classList.toggle('slice-page-maximized',Boolean(state.maximized));
  for(const [id,view] of views)if(!ids.includes(id)){view.native.destroy();view.preview?.destroy();view.element.remove();views.delete(id);}
  for(const [index,id] of ids.entries()){
    const view=views.get(id)||createView(id),box=boxes[id];view.element.hidden=!box;
    if(!box){layout.push({id,rect:{x:0,y:0,width:1,height:1},visible:false,tabIds:member(id).map(t=>t.id)});if(view.preview)view.preview.element.hidden=true;continue;}
    Object.assign(view.element.style,{left:box.x+'px',top:box.y+'px',width:box.width+'px',height:box.height+'px'});
    const minimized=state.minimized.includes(id)||presentation.autoMinimized.includes(id);view.element.classList.toggle('slice-minimized',minimized);
    view.close.hidden=ids.length<2;view.number.textContent=String(index+1);view.number.title='Slice '+(index+1);view.min.title=minimized?'Restore slice':'Minimize slice';view.min.textContent=minimized?'▔':'−';view.max.textContent=state.maximized===id?'❐':'□';
    const own=previews.filter(t=>(t.sliceId||'main')===id),active=own.find(t=>t.id===activeDocs.get(id));if(!active)activeDocs.delete(id);
    view.native.setDocumentTabs(own.map(t=>({id:t.id,title:t.name,active:t.id===activeDocs.get(id),onSelect:()=>showDoc(id,t),onClose:()=>savePreviews(previews.filter(p=>p.id!==t.id)),onReorder:before=>moveDoc(t.id,id,before)})));
    for(const cb of view.listeners)cb(member(id));
    if(active&&!view.preview)showDoc(id,active);
    const rect=view.bounds();
    if(view.preview){view.preview.element.hidden=!active||minimized;Object.assign(view.preview.element.style,{left:rect.x+'px',top:rect.y+'px',width:rect.width+'px',height:rect.height+'px',bottom:'auto',right:'auto'});view.preview.refreshPreviewGeometry();}
    // Geometry updates must never replay an old tab selection.
    const selected=member(id).find(t=>moves.get(t.id)===id&&t.id===activeNative.get(id));
    layout.push({id,rect,visible:!overlay&&!minimized&&!active,tabIds:member(id).map(t=>t.id),...(selected?{activeTabId:selected.id}:{})});
  }
  const next=JSON.stringify(layout);if(next!==geometry){geometry=next;void publish(layout);}
 }
 const receive=host.onPaneTabs(next=>{if(disposed)return;tabs=next;let recovered=false;for(const tab of tabs){const key=tab.sliceId||'main';if(ready&&!retired.has(key)&&!sliceIds(state.tree).includes(key)){state.tree=splitSlice(state.tree,'main',key,'right');recovered=true;}}if(recovered)save();for(const tab of tabs){const id=tab.sliceId||'main';if(moves.get(tab.id)===id)moves.delete(tab.id);if(tab.active&&activeNative.get(id)===tab.id)activeNative.delete(id);}schedule();});
 const releaseEdge=host.onChromeLayout?.(rect=>{if(disposed||!Number.isFinite(rect?.x))return;if(rect.tabId&&(rect.minimumWidth>0||rect.minimumHeight>0)){const old=constraints.get(rect.tabId)||{};const next={width:Math.max(old.width||0,rect.minimumWidth||0),height:Math.max(old.height||0,rect.minimumHeight||0)};if(next.width!==old.width||next.height!==old.height){constraints.set(rect.tabId,next);schedule();}}if(rect.reason!=='resize'||state.maximized||state.minimized.includes(rect.sliceId||'main'))return;const box=outer();if(Math.abs((regions()[rect.sliceId||'main']?.x??-999)-box.x)<2)return;if(state.minimized.length)box.height=Math.max(32,box.height-32);const next=followSliceLeft(state.tree,rect.sliceId||'main',rect.x,box,state.minimized);if(next!==state.tree){state.tree=next;save();schedule();}});
 const observer=new win.ResizeObserver(schedule);observer.observe(root.element);win.addEventListener('resize',schedule);
 function destination(event){const boxes=regions();for(const [id,box] of Object.entries(boxes)){const side=sliceDropSide(event.clientX,event.clientY,box);if(side)return {id,side:event.target?.closest?.('.pane-window-tabs')?'center':side,box};}return null;}
 function relevant(event){return Array.from(event.dataTransfer?.types??[]).some(t=>[PREVIEW_TAB_MIME,NATIVE_TAB_MIME,WINDOW_TAB_MIME].includes(t));}
 const dragOver=event=>{if(!relevant(event))return;const target=destination(event);if(!target){cue.hidden=true;return;}event.preventDefault();event.dataTransfer.dropEffect='move';let box=target.box;
    if(target.side==='left')box={...box,width:box.width/2};if(target.side==='right')box={...box,x:box.x+box.width/2,width:box.width/2};if(target.side==='top')box={...box,height:box.height/2};if(target.side==='bottom')box={...box,y:box.y+box.height/2,height:box.height/2};
    if(event.target?.closest?.('.pane-window-tabs')){cue.hidden=true;for(const node of region.querySelectorAll('.reorder-before,.reorder-after'))node.classList.remove('reorder-before','reorder-after');const tab=event.target?.closest?.('[data-pane-tab-id],[data-preview-tab-id]');tab?.classList.add('reorder-before');return;}
    cue.hidden=false;Object.assign(cue.style,{left:box.x+'px',top:box.y+'px',width:box.width+'px',height:box.height+'px'});
 };
 const clear=()=>{cue.hidden=true;overlay=false;for(const node of region.querySelectorAll('.reorder-before,.reorder-after'))node.classList.remove('reorder-before','reorder-after');schedule();};
 const drop=async event=>{
  if(!relevant(event))return;const target=destination(event);if(!target)return;event.preventDefault();event.stopPropagation();clear();
  const documentId=event.dataTransfer.getData(PREVIEW_TAB_MIME);let nativeTab;try{nativeTab=JSON.parse(event.dataTransfer.getData(NATIVE_TAB_MIME)||'null');}catch{}
  const instance=windowTabTransfer(event.dataTransfer.getData(WINDOW_TAB_MIME));
  if(documentId&&!previews.some(t=>t.id===documentId)||nativeTab&&!tabs.some(t=>t.id===nativeTab.id)||!documentId&&!nativeTab&&!instance)return;
  let id=target.id;if(target.side!=='center'){id='slice-'+win.crypto.randomUUID();state.tree=splitSlice(state.tree,target.id,id,target.side);state.maximized=null;save();}
  state.minimized=state.minimized.filter(t=>t!==id);
  if(documentId){const before=event.target?.closest?.('[data-preview-tab-id]')?.getAttribute('data-preview-tab-id')||'';if(before!==documentId)moveDoc(documentId,id,before);}
  else if(nativeTab){
    const targetNode=event.target?.closest?.('[data-pane-tab-id]');const before=targetNode?.getAttribute('data-pane-tab-id')||'';
    if((tabs.find(t=>t.id===nativeTab.id)?.sliceId||'main')!==id)moves.set(nativeTab.id,id);
    activeDocs.delete(id);activeNative.set(id,nativeTab.id);if(before!==nativeTab.id)await host.fileCapability('pane-window-reorder',{tabId:nativeTab.id,beforeId:before});geometry='';schedule();
  }
  else if(instance){const existing=tabs.find(t=>t.windowInstanceId===instance);if(existing){moves.set(existing.id,id);activeNative.set(id,existing.id);activeDocs.delete(id);geometry='';schedule();return;}schedule();await new Promise(win.requestAnimationFrame);const listed=await host.windowCandidates({includeNativeIcons:false}),candidate=listed.candidates?.find(t=>t.windowInstanceId===instance);if(!candidate)return;const binding=await host.bindWindowCandidate(candidate.id);if(binding?.outcome==='success')await host.fileCapability('pane-window-attach',{bindingId:binding.capability.bindingId,sliceId:id,rect:views.get(id).bounds()});}
 };
 // Capture handles drops before a strip's single-group handler can consume them.
 document.addEventListener('dragover',dragOver,true);document.addEventListener('drop',drop,true);document.addEventListener('dragend',clear);win.addEventListener('blur',clear);
 return {setSettings(value){if(value?.tree&&validSliceTree(value.tree)&&sliceIds(value.tree).includes('main'))state={tree:value.tree,minimized:Array.isArray(value.minimized)?value.minimized.filter(id=>sliceIds(value.tree).includes(id)):[],maximized:sliceIds(value.tree).includes(value.maximized)?value.maximized:null};ready=true;let recovered=false;for(const tab of tabs){const id=tab.sliceId||'main';if(!retired.has(id)&&!sliceIds(state.tree).includes(id)){state.tree=splitSlice(state.tree,'main',id,'right');recovered=true;}}if(recovered)save();schedule();},
  setPreviews(value){previews=value;schedule();},splitPreview(id,side){if(!previews.some(t=>t.id===id))return;const next='slice-'+win.crypto.randomUUID();state.tree=splitSlice(state.tree,'main',next,['left','right','top','bottom'].includes(side)?side:'right');state.maximized=null;save();moveDoc(id,next);},selectPreview(tab){showDoc(tab.sliceId||'main',tab);},nativeSelected(){activeDocs.delete('main');schedule();},setOverlay(value){if(overlay!==value){overlay=value;schedule();}},
  refresh(){geometry='';schedule();},isMaximized:()=>Boolean(state.maximized),ownsNativeEdge:rect=>followsNativeOuterEdge(rect,regions(),outer(),state.minimized,state.maximized),
  restore:async()=>{await host.fileCapability('pane-window-tabs',{rect:outer()});schedule();},
  destroy(){disposed=true;if(frame)win.cancelAnimationFrame(frame);receive();releaseEdge?.();observer.disconnect();win.removeEventListener('resize',schedule);document.removeEventListener('dragover',dragOver,true);document.removeEventListener('drop',drop,true);document.removeEventListener('dragend',clear);win.removeEventListener('blur',clear);for(const view of views.values()){view.native.destroy();view.preview?.destroy();}region.remove();cue.remove();},
 };
}





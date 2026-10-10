import {installNativeWindowTabs,PREVIEW_TAB_MIME,NATIVE_TAB_MIME,PANE_TRANSFER_MIME} from './native-window-tabs.js';
import {createFileCapabilityPanel} from './file-capability-panel.js';
import {sliceDropSide} from './window-slices.js';
import {showMoveRefusal} from './move-feedback.js';
import {WINDOW_TAB_MIME,windowTabTransfer} from './window-tab-transfer.js';

export const GROUP_DRAG_MIME='application/x-papers-pane-group';
const PAGE_TAB_MIME='application/x-papers-page';
const ref=id=>'preview:'+id;
const docId=id=>id?.startsWith('preview:')?id.slice(8):null;
export const paneSnapshotIsNewer=(previous,next)=>Boolean(next&&Array.isArray(next.groups)&&Number.isSafeInteger(next.stateRevision)&&
  (!previous||next.binding!==previous.binding&&next.bindingGeneration>previous.bindingGeneration||next.binding===previous.binding&&next.bindingGeneration>=previous.bindingGeneration&&next.stateRevision>=previous.stateRevision&&next.geometryRevision>=previous.geometryRevision));

/** Presentation only: snapshots own all native geometry, membership and selection.
 * No per-leaf rectangle, inferred minimum, resize ratio or automatic fallback is
 * sent back. Only a root viewport and explicit creator commands cross the bridge. */
export function installCoordinatedWindowSlices({document,host,root,pagePanels=null,resolvePreviewDrag=()=>null,onSettings=()=>{},onPreviews=()=>{},onStatus=()=>{},onOuterEdge=()=>{},onActive=()=>{}}){
  // This element supplies native geometry, including the first retained-window
  // mount. Legacy collapsed/expanded width animation exposes intermediate
  // widths that can fail native minimum sizes and must not drive this owner.
  root.element.style.transition='none';
  const icons=new Map();
  function previewIcon(tab){if(!tab)return null;if(!icons.has(tab.path)){icons.set(tab.path,null);void host.fileCapability("icon",{path:tab.path}).then(reply=>{if(disposed)return;if(reply?.ok&&reply.icon){icons.set(tab.path,reply.icon);schedule();}}).catch(()=>{});}return icons.get(tab.path)||tab.previewIcon||tab.icon||null;}
  const win=document.defaultView,views=new Map();let snapshot=null,previews=[],disposed=false,mounted=false,mounting=null,frame=0,geometry='',overlay=false,dragging=false,savedSettings='',queue=Promise.resolve(),groupDragId=null,lensGroup=null,dragHeartbeat=0,dragYield=Promise.resolve();
  const retainedPreviews=new Map();
  const protectedTabs=pagePanels?[{id:'workspace-files',name:'Files',panel:pagePanels.files},{id:'workspace-preview',name:'Preview',panel:pagePanels.preview}]:[];
  for(const tab of protectedTabs)tab.panel.element.classList.add('slice-page-panel');
  const region=document.createElement('div');region.className='window-slices-region';region.hidden=true;document.body.append(region);
  const cue=document.createElement('div');cue.className='preview-split-cue is-armed window-slice-drop';cue.hidden=true;document.body.append(cue);
  const outer=()=>{const b=root.element.getBoundingClientRect();return {x:Math.round(b.left),y:Math.round(b.top),width:Math.round(b.width),height:Math.round(b.height),rightInset:Math.max(0,win.innerWidth-b.right),bottomInset:Math.max(0,win.innerHeight-b.bottom)};};
  let lastRefusal='';
  function accept(next){if(disposed)return;if(next?.moveRejected&&next.moveRejected.id!==lastRefusal){lastRefusal=next.moveRejected.id;const r=next.moveRejected;showMoveRefusal(document,r.tabId?Array.from(region.querySelectorAll('[data-pane-tab-id],[data-preview-tab-id]')).find(n=>n.dataset.paneTabId===r.tabId||ref(n.dataset.previewTabId)===r.tabId):views.get(r.groupId)?.element);}if(!paneSnapshotIsNewer(snapshot,next))return;const previous=snapshot;snapshot=next;
    let refsChanged=false;
    const remaining=previews.filter(tab=>!(next.removedDocumentIds||[]).includes(ref(tab.id)));
    if(remaining.length!==previews.length){previews=remaining;refsChanged=true;}
    for(const group of next.groups)for(const tab of group.tabs)if(tab.kind==='document'&&tab.preview?.Path&&!previews.some(p=>ref(p.id)===tab.id)){
      previews.push({id:docId(tab.id),path:tab.preview.Path,name:tab.preview.Name||tab.preview.Path,sliceId:group.id});refsChanged=true;
    }
    if(refsChanged)onPreviews(previews);
    schedule();if(mounted&&(!previous||(next.nativeEdgeRevision||0)>(previous.nativeEdgeRevision||0)))onOuterEdge(next.viewport);
    const settings={version:2,tree:next.tree,minimized:next.groups.filter(g=>g.presentation==='minimized').map(g=>g.id),maximized:next.groups.find(g=>g.presentation==='maximized')?.id||null},key=JSON.stringify(settings);
    if(mounted&&key!==savedSettings){savedSettings=key;onSettings(settings);}
    const places=new Map(next.groups.flatMap(g=>g.tabs.filter(t=>t.kind==='document').map((t,index)=>[docId(t.id),{sliceId:g.id,nativeIndex:g.tabs.slice(0,g.tabs.indexOf(t)).filter(t=>t.kind==='native').length}])));
    let changed=false;const saved=previews.map(tab=>{const place=places.get(tab.id);if(!place||place.sliceId===tab.sliceId&&place.nativeIndex===tab.nativeIndex)return tab;changed=true;return {...tab,...place};});
    if(changed){previews=saved;onPreviews(saved);}
  }
  const release=host.onPaneLayout?.(accept);
  function command(command,params={}){const task=queue.then(async()=>{
    await dragYield;if(disposed||!mounted||!snapshot)throw new Error('Window layout is not ready.');
    const reply=await host.fileCapability('pane-layout-command',{command,revision:snapshot.stateRevision,...(typeof params==='function'?params():params)});
    if(reply?.snapshot)accept(reply.snapshot);if(reply?.ok===false)throw new Error(reply.error||reply.message||'Window action could not complete');return reply;
  });queue=task.catch(error=>{if(!disposed)onStatus(error.message);});return task;}
  const groupFor=id=>snapshot?.groups.find(g=>g.tabs.some(t=>t.id===id))?.id;
  async function ensureDocument(tab){const id=ref(tab.id);if(!groupFor(id)||!snapshot.groups.flatMap(g=>g.tabs).find(t=>t.id===id)?.preview)await command('document-add',{tabId:id,groupId:snapshot.groups.some(g=>g.id===tab.sliceId)?tab.sliceId:snapshot.groups[0].id,preview:{path:tab.path,name:tab.name}});return id;}
  async function selectPreview(tab){if(!mounted)return;const id=await ensureDocument(tab);await command('select',()=>({groupId:groupFor(id),tabId:id}));}
  function schedule(){if(!frame&&!disposed)frame=win.requestAnimationFrame(render);}
  function documentEdges(view,groupId){for(const edge of ['left','right','top','bottom']){
    const handle=document.createElement('div');handle.className='slice-document-edge slice-document-'+edge;handle.title='Resize preview split';let pointer=null,point=null,pending=false;
    const resize=()=>{if(pending||!point)return;pending=true;const current=point;point=null;
      void command('document-edge',()=>({groupId,edge,position:(edge==='left'||edge==='right'?current.x-snapshot.viewport.x:current.y-snapshot.viewport.y)})).catch(()=>{}).finally(()=>{pending=false;resize();});};
    handle.addEventListener('pointerdown',event=>{if(event.button!==0)return;event.preventDefault();event.stopPropagation();pointer=event.pointerId;handle.setPointerCapture(pointer);});
    handle.addEventListener('pointermove',event=>{if(pointer!==event.pointerId)return;event.preventDefault();point={x:event.clientX,y:event.clientY};resize();});
    const finish=()=>{pointer=null;point=null;};handle.addEventListener('pointerup',finish);handle.addEventListener('pointercancel',finish);handle.addEventListener('lostpointercapture',finish);
    view.preview.element.append(handle);
  }}
  function documentEdgesOnce(view,groupId){if(view.preview.element.dataset.edgeGroup===groupId)return;
    for(const handle of view.preview.element.querySelectorAll('.slice-document-edge'))handle.remove();
    view.preview.element.dataset.edgeGroup=groupId;documentEdges(view,groupId);
  }
  function toolsButton(tools,label,text,action){const b=document.createElement('button');b.type='button';b.title=label;b.setAttribute('aria-label',label);b.textContent=text;b.addEventListener('click',()=>{void action().catch(()=>{});});tools.append(b);return b;}
  function createView(group){
    const element=document.createElement('section');element.className='window-slice';element.dataset.sliceId=group.id;
    const header=document.createElement('header');header.className='window-slice-header';element.append(header);region.append(element);
    const handle=document.createElement('button');handle.type='button';handle.className='slice-group-handle';handle.draggable=true;handle.textContent='⠿';handle.title='Move group — center swaps; edge resplits';handle.setAttribute('aria-label','Move entire group');handle.dataset.groupId=group.id;
    handle.addEventListener('dragstart',event=>{groupDragId=group.id;event.dataTransfer.setData(GROUP_DRAG_MIME,group.id);const current=snapshot.groups.find(g=>g.id===group.id);if(current?.transferId)event.dataTransfer.setData(PANE_TRANSFER_MIME,JSON.stringify({transferId:current.transferId,binding:snapshot.binding,kind:'group'}));event.dataTransfer.effectAllowed='move';void setOverlay(true).catch(()=>{});});
    element.addEventListener('pointerdown',()=>{lensGroup=group.id;},true);
    const listeners=new Set(),tools=document.createElement('span');tools.className='window-slice-controls';
    const rail=document.createElement("div");rail.className="slice-vertical-restore";element.append(rail);
    const railControls=document.createElement('div');railControls.className='slice-vertical-controls';rail.append(railControls);
    const view={element,header,handle,listeners,rail,railControls,preview:null,previewId:null};
    const bounds=()=>snapshot.groups.find(g=>g.id===group.id)?.content||outer();
    const scopedHost={...host,onPaneTabs:cb=>{listeners.add(cb);return()=>listeners.delete(cb);},fileCapability:async(operation,data={})=>{
      if(operation==='pane-window-tabs')return {ok:true};
      if(operation==='pane-window-select'){
        const tab=snapshot.groups.flatMap(g=>g.tabs).find(t=>t.id===data.tabId);
        if(tab?.kind==='dormant'){
          await command('select',{groupId:group.id,tabId:data.tabId});
          if(!tab.canOpen){onStatus('Application unavailable — the window picker will replace this selected tab.');return {ok:true};}
          const reply=await host.fileCapability('pane-window-resume',{tabId:data.tabId});if(reply.snapshot)accept(reply.snapshot);return reply;
        }
        return command('select',{groupId:group.id,tabId:data.tabId});
      }
      if(operation==='pane-window-reorder')return command('reorder',{groupId:group.id,tabId:data.tabId,beforeId:data.beforeId});
      if(operation==='pane-window-detach')return command('detach',{tabId:data.tabId});
      if(operation==='pane-window-attach'){
        const current=snapshot.groups.find(g=>g.id===group.id),selected=current?.tabs.find(t=>t.id===current.selected&&t.kind==='dormant');
        if(selected){const result=await host.fileCapability('pane-window-replace',{bindingId:data.bindingId,tabId:selected.id});if(result.snapshot)accept(result.snapshot);return result;}
      }
      if(operation==='pane-window-attach'||operation==='pane-window-transfer'){const result=await host.fileCapability(operation,{...data,groupId:group.id});if(result.snapshot)accept(result.snapshot);return result;}
      if(operation==='chrome-pane-visible')return {ok:true};
      return host.fileCapability(operation,data);
    }};
    view.native=installNativeWindowTabs({document,header,host:scopedHost,bounds,prepare:async()=>true,overlay:async value=>setOverlay(value&&dragging),status:onStatus,sliceId:group.id,sliceDocking:true,
      groupHandle:handle,layoutBinding:()=>snapshot?.binding
    });
    view.resume=toolsButton(tools,'Resume remaining applications','↻',async()=>{
      for(const tab of snapshot.groups.find(g=>g.id===group.id)?.tabs.filter(t=>t.kind==='dormant'&&t.canOpen)||[]){
        const reply=await host.fileCapability('pane-window-resume',{tabId:tab.id});if(reply.snapshot)accept(reply.snapshot);if(!reply.ok)onStatus(reply.error||'Application could not reopen');
      }
    });
    view.min=toolsButton(tools,'Minimize group','−',()=>command('presentation',{groupId:group.id,mode:snapshot.groups.find(g=>g.id===group.id)?.presentation==='minimized'?'normal':'minimized'}));
    view.max=toolsButton(tools,'Maximize group','□',()=>command('presentation',{groupId:group.id,mode:snapshot.groups.find(g=>g.id===group.id)?.presentation==='maximized'?'normal':'maximized'}));
    view.close=toolsButton(tools,'Remove window group','×',()=>command('close-group',{groupId:group.id,destination:snapshot.groups.find(g=>g.id!==group.id).id}));
    // A vertical minimized group can be empty. Its header is hidden, and a
    // tab-icon-only restore rail would otherwise leave it impossible to reopen.
    view.railRestore=toolsButton(railControls,'Restore group','↗',()=>command('presentation',{groupId:group.id,mode:'normal'}));
    view.railMax=toolsButton(railControls,'Maximize group','□',()=>command('presentation',{groupId:group.id,mode:'maximized'}));
    view.railClose=toolsButton(railControls,'Remove window group','×',()=>command('close-group',{groupId:group.id,destination:snapshot.groups.find(g=>g.id!==group.id).id}));
    header.append(tools);views.set(group.id,view);return view;
  }
  function render(){frame=0;if(disposed||!mounted||!snapshot)return;
    const hidden=root.element.hidden,maximum=snapshot.groups.find(g=>g.presentation==='maximized')?.id;
    region.hidden=hidden;region.classList.toggle('slice-page-maximized',Boolean(maximum));
    for(const [id,view] of views)if(!snapshot.groups.some(g=>g.id===id)){view.native.destroy();view.element.remove();views.delete(id);}
    const visibleDocuments=new Set(snapshot.groups.filter(g=>!hidden&&!overlay&&g.presentation!=='minimized'&&(!maximum||maximum===g.id)).map(g=>g.selected));
    for(const [id,panel] of retainedPreviews){if(!snapshot.groups.some(g=>g.tabs.some(t=>t.id===ref(id)))){panel.destroy();retainedPreviews.delete(id);}else if(!visibleDocuments.has(ref(id))){panel.setPreviewSuspended(true);panel.element.hidden=true;}}
    for(const tab of protectedTabs)if(!visibleDocuments.has(ref(tab.id))){tab.panel.element.hidden=true;tab.panel.setPreviewSuspended?.(true);}
    for(const [index,group] of snapshot.groups.entries()){
      const view=views.get(group.id)||createView(group),box=group.slot;
      view.element.hidden=hidden||Boolean(maximum&&maximum!==group.id);
      Object.assign(view.element.style,{left:box.x+'px',top:box.y+'px',width:box.width+'px',height:box.height+'px'});
      const vertical=group.presentation==='minimized'&&box.width===32;
      view.element.classList.toggle('slice-vertical-minimized',vertical);view.rail.hidden=!vertical;view.rail.replaceChildren(view.railControls);
      if(vertical)for(const tab of group.tabs){const button=document.createElement('button');button.type='button';button.title=tab.title;button.setAttribute('aria-label','Restore '+tab.title);
        const source=tab.icon||previewIcon(previews.find(p=>ref(p.id)===tab.id));if(source){const icon=document.createElement('img');icon.src=source;icon.alt='';button.append(icon);}else button.textContent='▣';
        button.addEventListener('click',()=>{void (async()=>{await command('presentation',{groupId:group.id,mode:'normal'});await command('select',{groupId:group.id,tabId:tab.id});if(tab.kind==='dormant'&&tab.canOpen){const reply=await host.fileCapability('pane-window-resume',{tabId:tab.id});if(reply.snapshot)accept(reply.snapshot);if(!reply.ok)throw Error(reply.error||'Application could not reopen');}})().catch(error=>onStatus(error.message));});view.rail.append(button);}
      view.resume.hidden=!group.tabs.some(t=>t.kind==='dormant'&&t.canOpen);
      view.close.hidden=snapshot.groups.length<2||group.tabs.some(t=>protectedTabs.some(p=>ref(p.id)===t.id));view.handle.disabled=false;
      view.railClose.hidden=view.close.hidden;
      view.min.textContent=group.presentation==='minimized'?'↗':'−';view.max.textContent=group.presentation==='maximized'?'❐':'□';
      const docs=group.tabs.filter(t=>t.kind==='document').map(t=>{const tab=protectedTabs.find(p=>ref(p.id)===t.id)||previews.find(p=>ref(p.id)===t.id)||(t.preview?.PageKey?{id:docId(t.id),name:t.preview.Name,pageKey:t.preview.PageKey,tabStyle:t.preview.TabStyle}:null);if(!tab)return null;
        return {id:tab.id,transferId:t.transferId,title:tab.name,icon:previewIcon(tab),active:t.active,nativeIndex:group.tabs.slice(0,group.tabs.indexOf(t)).filter(p=>p.kind==='native').length,
          protected:Boolean(tab.panel),tabStyle:tab.tabStyle,onSelect:()=>{void (tab.panel||tab.pageKey?command('select',{groupId:group.id,tabId:t.id}):selectPreview(tab)).catch(()=>{});},onClose:()=>{void command('document-remove',{tabId:t.id}).then(()=>{previews=previews.filter(p=>p.id!==tab.id);onPreviews(previews);schedule();}).catch(()=>{});},
          onReorder:(beforeId,position)=>{const before=beforeId?ref(beforeId):group.tabs.filter(p=>p.kind==='native')[position?.nativeIndex]?.id||'';void command('reorder',{groupId:group.id,tabId:t.id,beforeId:before}).catch(()=>{});}};
      }).filter(Boolean);
      view.native.setDocumentTabs(docs);for(const cb of view.listeners)cb(group.tabs.filter(t=>t.kind==='native'||t.kind==='dormant'));
      const active=protectedTabs.find(tab=>ref(tab.id)===group.selected)||previews.find(tab=>ref(tab.id)===group.selected),shown=active&&!hidden&&!overlay&&group.presentation!=='minimized'&&(!maximum||maximum===group.id);
      view.preview=active?.panel||retainedPreviews.get(active?.id)||null;
      if(shown&&!view.preview){
        const previewHost={...host,fileCapability:(operation,data={})=>host.fileCapability(operation,['preview-pdf-open','preview-html-open','preview-native-open'].includes(operation)?{...data,surfaceId:'tab:'+active.id}:data)};
        view.preview=createFileCapabilityPanel({document,host:previewHost,previewOnly:true,setStatus:onStatus});view.preview.element.classList.add('slice-file-preview');retainedPreviews.set(active.id,view.preview);view.preview.setExpanded(true);void view.preview.previewPath(active.path,active.name);}
      if(view.preview){documentEdgesOnce(view,group.id);
        // Reattach the DOM surface before unsuspending its retained host. A
        // hidden element otherwise yields a zero rectangle on the first move.
        if(shown)view.preview.element.hidden=false;
        view.preview.setPreviewSuspended?.(!shown);
        if(!shown)view.preview.element.hidden=true;
        for(const handle of view.preview.element.querySelectorAll('.slice-document-edge')){const edge=handle.className.split('slice-document-').at(-1);handle.hidden=group.presentation!=='normal'||edge==='right'&&group.slot.x+group.slot.width>=snapshot.viewport.x+snapshot.viewport.width-1||edge==='top'&&group.slot.y<=snapshot.viewport.y+1||edge==='bottom'&&group.slot.y+group.slot.height>=snapshot.viewport.y+snapshot.viewport.height-1;}
        if(shown){const r=group.content;Object.assign(view.preview.element.style,{left:r.x+'px',top:r.y+'px',width:r.width+'px',height:r.height+'px',right:'auto',bottom:'auto'});
          view.preview.refreshPreviewGeometry?.();}}
    }
    const rect=outer(),next=JSON.stringify(rect);if(next!==geometry){geometry=next;void host.fileCapability('pane-layout-viewport',{rect}).then(reply=>{if(reply?.snapshot)accept(reply.snapshot);if(reply?.ok===false)onStatus(reply.error||reply.message||'Window layout could not resize');}).catch(error=>onStatus(error.message));}
  }
  async function setOverlay(value){if(overlay===value)return;overlay=value;schedule();if(mounted)await command('present',{visible:!value&&!root.element.hidden});}
  const relevant=event=>Array.from(event.dataTransfer?.types||[]).some(t=>[PREVIEW_TAB_MIME,NATIVE_TAB_MIME,WINDOW_TAB_MIME,GROUP_DRAG_MIME,PAGE_TAB_MIME].includes(t));
  function destination(event){for(const group of snapshot?.groups||[]){const view=views.get(group.id);if(view?.element.hidden||groupDragId===group.id)continue;const side=sliceDropSide(event.clientX,event.clientY,group.slot);if(side){const foreignGroup=!groupDragId&&Array.from(event.dataTransfer.types||[]).includes(GROUP_DRAG_MIME);return {group,side:!foreignGroup&&!groupDragId&&event.target?.closest?.('.pane-window-tabs')?'center':side};}}return null;}
  let dragSource=null;
  const startDrag=event=>{dragSource=event.target?.closest?.('[data-pane-tab-id],[data-preview-tab-id],.preview-pin,.slice-group-handle');if(dragSource?.classList.contains('slice-group-handle'))dragSource=dragSource.closest('.window-slice');dragging=true;dragYield=Promise.resolve().then(()=>{if(dragging&&relevant(event)){let transfer;try{transfer=JSON.parse(event.dataTransfer.getData(PANE_TRANSFER_MIME)||'null');}catch{}return host.fileCapability('pane-transfer-overlay',{active:true,...(transfer?.transferId?{transferId:transfer.transferId}:{})});}}).then(reply=>{if(reply?.snapshot)accept(reply.snapshot);}).catch(()=>{});};
  let completingDrop=false;
  let cueRevision=0,cueTarget='',cueError='';
  const clearStrip=()=>{for(const node of region.querySelectorAll('.is-tab-drop-target,.is-tab-drop-refused,.reorder-before'))node.classList.remove('is-tab-drop-target','is-tab-drop-refused','reorder-before');};
  const clear=(cancelled=false)=>{clearStrip();cueRevision++;cueTarget='';cueError='';cue.hidden=true;if(completingDrop)return;if(dragging)void host.fileCapability('pane-transfer-overlay',{active:false,cancelled:cancelled===true}).catch(()=>{});dragging=false;groupDragId=null;for(const node of region.querySelectorAll('.reorder-before'))node.classList.remove('reorder-before');void setOverlay(false).catch(()=>{});};
  const dragOver=event=>{clearStrip();if(!mounted||!relevant(event))return;if(dragging&&Date.now()-dragHeartbeat>1000){dragHeartbeat=Date.now();void host.fileCapability('pane-transfer-overlay',{active:true}).catch(()=>{});}const target=destination(event);if(!target){cueRevision++;cueTarget='';cue.hidden=true;return;}event.preventDefault();event.dataTransfer.dropEffect='move';
    const groupMove=Boolean(groupDragId||Array.from(event.dataTransfer.types).includes(GROUP_DRAG_MIME));
    let box={...target.group.slot};const side=target.side;
    const pageMove=Array.from(event.dataTransfer.types).includes(PAGE_TAB_MIME);
    if(pageMove){const identity='page:'+target.group.id+':'+side;if(identity!==cueTarget){cueTarget=identity;const rev=++cueRevision;cueError='';void host.fileCapability('pane-page-check',{pageId:event.dataTransfer.getData(PAGE_TAB_MIME)||undefined,groupId:target.group.id,side}).then(result=>{if(rev!==cueRevision)return;cueError=result.ok?'':result.error||'This page cannot fit here';views.get(target.group.id)?.header.classList.toggle('is-tab-drop-refused',!result.ok);if(!result.ok){cue.classList.add('is-rejected');cue.textContent=cueError;}}).catch(()=>{});}event.dataTransfer.dropEffect=cueError?'none':'move';}
    if(side==='center'&&!groupMove){if(!pageMove){cueRevision++;cueTarget='';}cue.hidden=true;views.get(target.group.id)?.header.classList.add('is-tab-drop-target');views.get(target.group.id)?.header.classList.toggle('is-tab-drop-refused',Boolean(cueError));event.target?.closest?.('[data-pane-tab-id],[data-preview-tab-id]')?.classList.add('reorder-before');return;}
    cue.textContent=groupMove?(side==='center'?'Swap this group':'Move group '+side):'';cue.classList.toggle('is-group-drop',groupMove);
    cue.classList.toggle('is-group-insertion',Boolean(groupMove&&side!=='center'));
    if(groupMove&&side!=='center'){
      const thickness=6;
      if(side==='left'||side==='right'){if(side==='right')box.x+=box.width-thickness;box.width=thickness;}
      else{if(side==='bottom')box.y+=box.height-thickness;box.height=thickness;}
      cue.textContent='';cue.setAttribute('aria-label','Insert group '+side);
    }else if(side==='left'||side==='right'){box.width/=2;if(side==='right')box.x+=box.width;}else if(side==='top'||side==='bottom'){box.height/=2;if(side==='bottom')box.y+=box.height;}
    const identity=target.group.id+':'+side;if(groupMove&&identity!==cueTarget){cueTarget=identity;const rev=++cueRevision;cueError='';cue.classList.remove('is-rejected');void Promise.resolve(dragYield).then(()=>host.fileCapability('pane-transfer-check',{groupId:target.group.id,side})).then(result=>{if(rev!==cueRevision)return;if(!result.ok){cue.classList.add('is-rejected');cueError=result.error||'Cannot swap this group';cue.textContent=cueError;cue.setAttribute('aria-label',cue.textContent);}}).catch(()=>{});}
    if((groupMove||pageMove)&&cueError){cue.textContent=cueError;cue.setAttribute('aria-label',cueError);event.dataTransfer.dropEffect='none';}
    cue.hidden=false;Object.assign(cue.style,{left:box.x+'px',top:box.y+'px',width:box.width+'px',height:box.height+'px'});
  };
  const drop=async event=>{if(!mounted||!relevant(event))return;const target=destination(event);if(!target)return;event.preventDefault();event.stopPropagation();cue.hidden=true;const localSource=dragging?dragSource:null;completingDrop=true;
    try{
      const pageId=event.dataTransfer.getData(PAGE_TAB_MIME);if(pageId){const result=await host.fileCapability('pane-page-attach',{pageId,groupId:target.group.id,side:target.side});if(result.snapshot)accept(result.snapshot);if(!result.ok)throw Error(result.error||'Page could not move here');return;}
      let transfer;try{transfer=JSON.parse(event.dataTransfer.getData(PANE_TRANSFER_MIME)||'null');}catch{}
      if(transfer?.transferId&&transfer.binding!==snapshot.binding){
        const result=await host.fileCapability('pane-window-transfer',{transferId:transfer.transferId,groupId:target.group.id,side:target.side});
        if(result.snapshot)accept(result.snapshot);if(!result.ok)throw Error(result.error||'Group could not move here');
        if(transfer.kind==='tab'&&target.side==='center'&&result.tabId){const node=event.target?.closest?.('[data-pane-tab-id],[data-preview-tab-id]');const beforeId=node?.dataset.paneTabId||(node?.dataset.previewTabId?ref(node.dataset.previewTabId):'');if(beforeId!==result.tabId)await command('reorder',()=>({groupId:groupFor(result.tabId),tabId:result.tabId,beforeId}));}
        return;
      }
      const source=event.dataTransfer.getData(GROUP_DRAG_MIME)||groupDragId;if(source){await command('relocate-group',{groupId:source,destination:target.group.id,side:target.side});return;}
      const preview=event.dataTransfer.getData(PREVIEW_TAB_MIME);let native;try{native=JSON.parse(event.dataTransfer.getData(NATIVE_TAB_MIME)||'null');}catch{}
      let id=preview?ref(preview):native?.id;
      if(preview&&!snapshot.groups.flatMap(g=>g.tabs).some(t=>t.id===id&&t.preview?.PageKey)){let tab=protectedTabs.find(p=>p.id===preview)||previews.find(p=>p.id===preview);if(!tab){tab=resolvePreviewDrag(preview);if(!tab)return;previews=[...previews,tab];onPreviews(previews);}if(!tab.panel)await ensureDocument(tab);}
      if(!id){const instance=windowTabTransfer(event.dataTransfer.getData(WINDOW_TAB_MIME));if(!instance)return;
        id=snapshot.groups.flatMap(g=>g.tabs).find(t=>t.windowInstanceId===instance)?.id;
        if(!id){const listed=await host.windowCandidates({includeNativeIcons:false}),candidate=listed.candidates?.find(t=>t.windowInstanceId===instance);if(!candidate)return;
          const bound=await host.bindWindowCandidate(candidate.id);if(bound?.outcome!=='success')return;
          const result=await host.fileCapability('pane-window-attach',{bindingId:bound.capability.bindingId,groupId:target.group.id,rect:target.group.content});if(result.snapshot)accept(result.snapshot);if(!result.ok)throw new Error(result.error||'Window could not attach');id=result.tabId;}}
      if(!groupFor(id))return;
      let group=target.group.id;
      if(target.side!=='center'){const next='slice-'+win.crypto.randomUUID();await command('split',{tabId:id,groupId:group,newGroupId:next,side:target.side});group=next;}
      else if(groupFor(id)!==group)await command('move',{tabId:id,groupId:group});
      const tabNode=event.target?.closest?.('[data-pane-tab-id],[data-preview-tab-id]');
      const before=tabNode?.getAttribute('data-pane-tab-id')||(tabNode?.getAttribute('data-preview-tab-id')?ref(tabNode.getAttribute('data-preview-tab-id')):'');
      if(target.side==='center'&&before!==id)await command('reorder',{groupId:group,tabId:id,beforeId:before});
      // A rapid X/merge may finish while this drag continuation is awaiting
      // another command. Resolve the tab's current group at dispatch time.
      await command('select',()=>({groupId:groupFor(id),tabId:id}));
    }catch(error){showMoveRefusal(document,localSource);onStatus(error.message);}finally{completingDrop=false;clear();}
  };
  const leave=event=>{if(event.clientX<=0||event.clientY<=0||event.clientX>=win.innerWidth||event.clientY>=win.innerHeight){clearStrip();cueRevision++;cueTarget='';cue.hidden=true;}};
  const cancel=event=>{if(event.key==='Escape')clear(true);};
  const blur=()=>{clearStrip();if(!dragging)clear();};
  document.addEventListener('dragstart',startDrag,true);document.addEventListener('dragover',dragOver,true);document.addEventListener('drop',drop,true);document.addEventListener('dragend',clear,true);document.addEventListener('dragleave',leave,true);document.addEventListener('keydown',cancel,true);win.addEventListener('blur',blur);
  const observer=new win.ResizeObserver(schedule);observer.observe(root.element);win.addEventListener('resize',schedule);
  async function searchLens(source='screen'){
    const result=await host.fileCapability('browser-lens-screen',{nativeChrome:true,source});if(result.cancelled)return;if(!result.ok)throw new Error(result.message||'Lens could not start');
    const groupId=snapshot?.groups.find(g=>g.id===lensGroup&&g.presentation!=='minimized')?.id||snapshot?.groups.find(g=>g.presentation!=='minimized')?.id||snapshot?.groups[0]?.id;
    if(!groupId)throw new Error('Window layout is not ready.');
    const opened=await host.fileCapability('pane-layout-open',{groupId,source:'lens:'+win.crypto.randomUUID(),url:result.url});if(opened.snapshot)accept(opened.snapshot);if(!opened.ok)throw new Error(opened.error||'Lens could not open');
  }
  return {searchLens,active:()=>mounted,setSettings(){},setPreviews(next){previews=next;schedule();if(mounted)void (async()=>{for(const tab of previews)await ensureDocument(tab);
    for(const tab of snapshot.groups.flatMap(g=>g.tabs).filter(t=>t.kind==='document'&&!t.preview?.PageKey))if(!protectedTabs.some(p=>ref(p.id)===tab.id)&&!previews.some(p=>ref(p.id)===tab.id))await command('document-remove',{tabId:tab.id});})().catch(()=>{});},
    selectPreview:tab=>{void selectPreview(tab).catch(()=>{});},nativeSelected(){},setOverlay:value=>{void setOverlay(value).catch(()=>{});},refresh:schedule,isMaximized:()=>Boolean(snapshot?.groups.some(g=>g.presentation==='maximized')),ownsNativeEdge:()=>false,
    splitPreview:async(id,side)=>{const tab=previews.find(p=>p.id===id);if(!tab)return;const key=await ensureDocument(tab);await command('split',{tabId:key,groupId:snapshot.groups[0].id,newGroupId:'slice-'+win.crypto.randomUUID(),side});},
    async suspend(){if(mounted)await command('present',{visible:false});},
    async restore(){if(mounted)return;if(mounting)return mounting;mounting=(async()=>{
      // Papers can load a project before its native WebContentsView has bounds.
      // Do not mount zero geometry or fall back to a competing legacy helper.
      let rect=outer();while(!disposed&&(rect.width<240||rect.height<192)){await new Promise(resolve=>win.setTimeout(resolve,50));rect=outer();}if(disposed)return;
      const reply=await host.fileCapability('pane-layout-mount',{rect,headerHeight:32});
      if(!reply.ok){if(reply.code==='OPERATION_UNKNOWN'||reply.message==='Native window layouts are unavailable.'){await root.restoreWindows();return;}throw new Error(reply.error||reply.message||'Window layout could not mount');}
      // Native migration adds both page-owned panels atomically once. Later
      // mounts retain the creator's mixed tabs, selection and presentation;
      // only unique membership is required, not the initial solo-panel layout.
      let ready=reply;
      if(protectedTabs.length){
        ready=await host.fileCapability('pane-layout-command',{command:'ensure-panels',revision:reply.snapshot.stateRevision});
        if(!ready?.ok)throw new Error(ready?.error||ready?.message||'Files and Preview could not be restored');
        const groups=ready.snapshot?.groups||[];
        for(const tab of protectedTabs){const matches=groups.flatMap(g=>g.tabs).filter(t=>t.id===ref(tab.id));
          if(matches.length!==1||matches[0].kind!=='document')
            throw new Error('Files and Preview must each appear once in the native layout.');}
      }
      mounted=true;root.replaceNativeTabs();root.element.classList.add('window-slices-root');accept(ready.snapshot);
      onOuterEdge(snapshot.viewport);onActive();schedule();})();
      try{await mounting;}finally{mounting=null;}},
    destroy(){clear(true);disposed=true;release?.();observer.disconnect();if(frame)win.cancelAnimationFrame(frame);win.removeEventListener('resize',schedule);document.removeEventListener('dragstart',startDrag,true);document.removeEventListener('dragover',dragOver,true);document.removeEventListener('drop',drop,true);document.removeEventListener('dragend',clear,true);document.removeEventListener('dragleave',leave,true);document.removeEventListener('keydown',cancel,true);win.removeEventListener('blur',blur);for(const view of views.values())view.native.destroy();for(const panel of retainedPreviews.values())panel.destroy();region.remove();cue.remove();}
  };
}

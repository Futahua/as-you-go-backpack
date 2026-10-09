import {installNativeWindowTabs,PREVIEW_TAB_MIME,NATIVE_TAB_MIME} from './native-window-tabs.js';
import {createFileCapabilityPanel} from './file-capability-panel.js';
import {sliceDropSide} from './window-slices.js';
import {WINDOW_TAB_MIME,windowTabTransfer} from './window-tab-transfer.js';

const ref=id=>'preview:'+id;
const docId=id=>id?.startsWith('preview:')?id.slice(8):null;
export const paneSnapshotIsNewer=(previous,next)=>Boolean(next&&Array.isArray(next.groups)&&Number.isSafeInteger(next.stateRevision)&&
  (!previous||next.binding!==previous.binding&&next.bindingGeneration>previous.bindingGeneration||next.binding===previous.binding&&next.bindingGeneration>=previous.bindingGeneration&&next.stateRevision>=previous.stateRevision&&next.geometryRevision>=previous.geometryRevision));

/** Presentation only: snapshots own all native geometry, membership and selection.
 * No per-leaf rectangle, inferred minimum, resize ratio or automatic fallback is
 * sent back. Only a root viewport and explicit creator commands cross the bridge. */
export function installCoordinatedWindowSlices({document,host,root,onSettings=()=>{},onPreviews=()=>{},onStatus=()=>{},onOuterEdge=()=>{},onActive=()=>{}}){
  // This element supplies native geometry, including the first retained-window
  // mount. Legacy collapsed/expanded width animation exposes intermediate
  // widths that can fail native minimum sizes and must not drive this owner.
  root.element.style.transition='none';
  const win=document.defaultView,views=new Map();let snapshot=null,previews=[],disposed=false,mounted=false,mounting=null,frame=0,geometry='',overlay=false,dragging=false,savedSettings='',queue=Promise.resolve();
  const region=document.createElement('div');region.className='window-slices-region';region.hidden=true;document.body.append(region);
  const cue=document.createElement('div');cue.className='preview-split-cue is-armed window-slice-drop';cue.hidden=true;document.body.append(cue);
  const outer=()=>{const b=root.element.getBoundingClientRect();return {x:Math.round(b.left),y:Math.round(b.top),width:Math.round(b.width),height:Math.round(b.height),rightInset:Math.max(0,win.innerWidth-b.right),bottomInset:Math.max(0,win.innerHeight-b.bottom)};};
  function accept(next){if(disposed||!paneSnapshotIsNewer(snapshot,next))return;const previous=snapshot;snapshot=next;schedule();if(mounted&&(!previous||(next.nativeEdgeRevision||0)>(previous.nativeEdgeRevision||0)))onOuterEdge(next.viewport);
    const settings={version:2,tree:next.tree,minimized:next.groups.filter(g=>g.presentation==='minimized').map(g=>g.id),maximized:next.groups.find(g=>g.presentation==='maximized')?.id||null},key=JSON.stringify(settings);
    if(mounted&&key!==savedSettings){savedSettings=key;onSettings(settings);}
    const places=new Map(next.groups.flatMap(g=>g.tabs.filter(t=>t.kind==='document').map((t,index)=>[docId(t.id),{sliceId:g.id,nativeIndex:g.tabs.slice(0,g.tabs.indexOf(t)).filter(t=>t.kind==='native').length}])));
    let changed=false;const saved=previews.map(tab=>{const place=places.get(tab.id);if(!place||place.sliceId===tab.sliceId&&place.nativeIndex===tab.nativeIndex)return tab;changed=true;return {...tab,...place};});
    if(changed){previews=saved;onPreviews(saved);}
  }
  const release=host.onPaneLayout?.(accept);
  function command(command,params={}){const task=queue.then(async()=>{
    if(disposed||!mounted||!snapshot)throw new Error('Window layout is not ready.');
    const reply=await host.fileCapability('pane-layout-command',{command,revision:snapshot.stateRevision,...(typeof params==='function'?params():params)});
    if(reply?.snapshot)accept(reply.snapshot);if(reply?.ok===false)throw new Error(reply.error||reply.message||'Window action could not complete');return reply;
  });queue=task.catch(error=>{if(!disposed)onStatus(error.message);});return task;}
  const groupFor=id=>snapshot?.groups.find(g=>g.tabs.some(t=>t.id===id))?.id;
  async function ensureDocument(tab){const id=ref(tab.id);if(!groupFor(id))await command('document-add',{tabId:id,groupId:snapshot.groups.some(g=>g.id===tab.sliceId)?tab.sliceId:snapshot.groups[0].id});return id;}
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
  function toolsButton(tools,label,text,action){const b=document.createElement('button');b.type='button';b.title=label;b.setAttribute('aria-label',label);b.textContent=text;b.addEventListener('click',()=>{void action().catch(()=>{});});tools.append(b);return b;}
  function createView(group){
    const element=document.createElement('section');element.className='window-slice';element.dataset.sliceId=group.id;
    const header=document.createElement('header');header.className='window-slice-header';const number=document.createElement('span');number.className='window-slice-number';header.append(number);element.append(header);region.append(element);
    const listeners=new Set(),tools=document.createElement('span');tools.className='window-slice-controls';
    const view={element,header,number,listeners,preview:null,previewId:null};
    const bounds=()=>snapshot.groups.find(g=>g.id===group.id)?.content||outer();
    const scopedHost={...host,onPaneTabs:cb=>{listeners.add(cb);return()=>listeners.delete(cb);},fileCapability:async(operation,data={})=>{
      if(operation==='pane-window-tabs')return {ok:true};
      if(operation==='pane-window-select')return command('select',{groupId:group.id,tabId:data.tabId});
      if(operation==='pane-window-reorder')return command('reorder',{groupId:group.id,tabId:data.tabId,beforeId:data.beforeId});
      if(operation==='pane-window-detach')return command('detach',{tabId:data.tabId});
      if(operation==='pane-window-attach'){const result=await host.fileCapability(operation,{...data,groupId:group.id});if(result.snapshot)accept(result.snapshot);return result;}
      if(operation==='chrome-pane-visible')return {ok:true};
      return host.fileCapability(operation,data);
    }};
    view.native=installNativeWindowTabs({document,header,host:scopedHost,bounds,prepare:async()=>true,overlay:async value=>setOverlay(value&&dragging),status:onStatus,sliceId:group.id,sliceDocking:true,
      lens:async(source='screen')=>{const result=await host.fileCapability('browser-lens-screen',{nativeChrome:true,source});if(result.cancelled)return;if(!result.ok)throw new Error(result.message||'Lens could not start');
        const opened=await host.fileCapability('pane-layout-open',{groupId:group.id,source:'lens:'+win.crypto.randomUUID(),url:result.url});if(opened.snapshot)accept(opened.snapshot);if(!opened.ok)throw new Error(opened.error||'Lens could not open');}
    });
    view.min=toolsButton(tools,'Minimize group','−',()=>command('presentation',{groupId:group.id,mode:snapshot.groups.find(g=>g.id===group.id)?.presentation==='minimized'?'normal':'minimized'}));
    view.max=toolsButton(tools,'Maximize group','□',()=>command('presentation',{groupId:group.id,mode:snapshot.groups.find(g=>g.id===group.id)?.presentation==='maximized'?'normal':'maximized'}));
    view.close=toolsButton(tools,'Remove window group','×',()=>command('close-group',{groupId:group.id,destination:snapshot.groups.find(g=>g.id!==group.id).id}));
    header.append(tools);views.set(group.id,view);return view;
  }
  function render(){frame=0;if(disposed||!mounted||!snapshot)return;
    const hidden=root.element.hidden,maximum=snapshot.groups.find(g=>g.presentation==='maximized')?.id;
    region.hidden=hidden;region.classList.toggle('slice-page-maximized',Boolean(maximum));
    for(const [id,view] of views)if(!snapshot.groups.some(g=>g.id===id)){view.native.destroy();view.preview?.destroy();view.element.remove();views.delete(id);}
    for(const [index,group] of snapshot.groups.entries()){
      const view=views.get(group.id)||createView(group),box=group.slot;
      view.element.hidden=hidden||Boolean(maximum&&maximum!==group.id);
      Object.assign(view.element.style,{left:box.x+'px',top:box.y+'px',width:box.width+'px',height:group.presentation==='minimized'?'32px':box.height+'px'});
      view.number.textContent=String(index+1);view.number.title='Group '+(index+1);view.close.hidden=snapshot.groups.length<2;
      view.min.textContent=group.presentation==='minimized'?'↗':'−';view.max.textContent=group.presentation==='maximized'?'❐':'□';
      const docs=group.tabs.filter(t=>t.kind==='document').map(t=>{const tab=previews.find(p=>ref(p.id)===t.id);if(!tab)return null;
        return {id:tab.id,title:tab.name,active:t.active,nativeIndex:group.tabs.slice(0,group.tabs.indexOf(t)).filter(p=>p.kind==='native').length,
          onSelect:()=>{void selectPreview(tab).catch(()=>{});},onClose:()=>{void command('document-remove',{tabId:t.id}).then(()=>{previews=previews.filter(p=>p.id!==tab.id);onPreviews(previews);schedule();}).catch(()=>{});},
          onReorder:(beforeId,position)=>{const before=beforeId?ref(beforeId):group.tabs.filter(p=>p.kind==='native')[position?.nativeIndex]?.id||'';void command('reorder',{groupId:group.id,tabId:t.id,beforeId:before}).catch(()=>{});}};
      }).filter(Boolean);
      view.native.setDocumentTabs(docs);for(const cb of view.listeners)cb(group.tabs.filter(t=>t.kind==='native'));
      const active=previews.find(tab=>ref(tab.id)===group.selected),shown=active&&!hidden&&!overlay&&group.presentation!=='minimized'&&(!maximum||maximum===group.id);
      if(shown&&!view.preview){
        const previewHost={...host,fileCapability:(operation,data={})=>host.fileCapability(operation,operation==='preview-pdf-open'?{...data,surfaceId:'pane:'+group.id}:data)};
        view.preview=createFileCapabilityPanel({document,host:previewHost,previewOnly:true,setStatus:onStatus});view.preview.element.classList.add('slice-file-preview');documentEdges(view,group.id);}
      if(view.preview){view.preview.element.hidden=!shown;view.preview.setExpanded(Boolean(shown));
        for(const handle of view.preview.element.querySelectorAll('.slice-document-edge')){const edge=handle.className.split('slice-document-').at(-1);handle.hidden=group.presentation!=='normal'||edge==='right'&&group.slot.x+group.slot.width>=snapshot.viewport.x+snapshot.viewport.width-1||edge==='top'&&group.slot.y<=snapshot.viewport.y+1||edge==='bottom'&&group.slot.y+group.slot.height>=snapshot.viewport.y+snapshot.viewport.height-1;}
        if(shown){const r=group.content;Object.assign(view.preview.element.style,{left:r.x+'px',top:r.y+'px',width:r.width+'px',height:r.height+'px',right:'auto',bottom:'auto'});
          if(view.previewId!==active.id){view.previewId=active.id;void view.preview.previewPath(active.path,active.name);}view.preview.refreshPreviewGeometry();}}
    }
    const rect=outer(),next=JSON.stringify(rect);if(next!==geometry){geometry=next;void host.fileCapability('pane-layout-viewport',{rect}).then(reply=>{if(reply?.snapshot)accept(reply.snapshot);if(reply?.ok===false)onStatus(reply.error||reply.message||'Window layout could not resize');}).catch(error=>onStatus(error.message));}
  }
  async function setOverlay(value){if(overlay===value)return;overlay=value;schedule();if(mounted)await command('present',{visible:!value&&!root.element.hidden});}
  const relevant=event=>Array.from(event.dataTransfer?.types||[]).some(t=>[PREVIEW_TAB_MIME,NATIVE_TAB_MIME,WINDOW_TAB_MIME].includes(t));
  function destination(event){for(const group of snapshot?.groups||[]){const view=views.get(group.id);if(view?.element.hidden)continue;const side=sliceDropSide(event.clientX,event.clientY,group.slot);if(side)return {group,side:event.target?.closest?.('.pane-window-tabs')?'center':side};}return null;}
  const startDrag=()=>{dragging=true;};
  const clear=()=>{dragging=false;cue.hidden=true;for(const node of region.querySelectorAll('.reorder-before'))node.classList.remove('reorder-before');void setOverlay(false).catch(()=>{});};
  const dragOver=event=>{if(!mounted||!relevant(event))return;const target=destination(event);if(!target)return;event.preventDefault();event.dataTransfer.dropEffect='move';
    let box={...target.group.slot};const side=target.side;
    if(side==='center'){cue.hidden=true;event.target?.closest?.('[data-pane-tab-id],[data-preview-tab-id]')?.classList.add('reorder-before');return;}
    if(side==='left'||side==='right'){box.width/=2;if(side==='right')box.x+=box.width;}else{box.height/=2;if(side==='bottom')box.y+=box.height;}
    cue.hidden=false;Object.assign(cue.style,{left:box.x+'px',top:box.y+'px',width:box.width+'px',height:box.height+'px'});
  };
  const drop=async event=>{if(!mounted||!relevant(event))return;const target=destination(event);if(!target)return;event.preventDefault();event.stopPropagation();cue.hidden=true;
    try{
      const preview=event.dataTransfer.getData(PREVIEW_TAB_MIME);let native;try{native=JSON.parse(event.dataTransfer.getData(NATIVE_TAB_MIME)||'null');}catch{}
      let id=preview?ref(preview):native?.id;
      if(preview){const tab=previews.find(p=>p.id===preview);if(!tab)return;await ensureDocument(tab);}
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
    }catch(error){onStatus(error.message);}finally{clear();}
  };
  document.addEventListener('dragstart',startDrag,true);document.addEventListener('dragover',dragOver,true);document.addEventListener('drop',drop,true);document.addEventListener('dragend',clear,true);win.addEventListener('blur',clear);
  const observer=new win.ResizeObserver(schedule);observer.observe(root.element);win.addEventListener('resize',schedule);
  return {active:()=>mounted,setSettings(){},setPreviews(next){previews=next;schedule();if(mounted)void (async()=>{for(const tab of previews)await ensureDocument(tab);
    for(const tab of snapshot.groups.flatMap(g=>g.tabs).filter(t=>t.kind==='document'))if(!previews.some(p=>ref(p.id)===tab.id))await command('document-remove',{tabId:tab.id});})().catch(()=>{});},
    selectPreview:tab=>{void selectPreview(tab).catch(()=>{});},nativeSelected(){},setOverlay:value=>{void setOverlay(value).catch(()=>{});},refresh:schedule,isMaximized:()=>Boolean(snapshot?.groups.some(g=>g.presentation==='maximized')),ownsNativeEdge:()=>false,
    splitPreview:async(id,side)=>{const tab=previews.find(p=>p.id===id);if(!tab)return;const key=await ensureDocument(tab);await command('split',{tabId:key,groupId:snapshot.groups[0].id,newGroupId:'slice-'+win.crypto.randomUUID(),side});},
    async suspend(){if(mounted)await command('present',{visible:false});},
    async restore(){if(mounted)return;if(mounting)return mounting;mounting=(async()=>{
      // Papers can load a project before its native WebContentsView has bounds.
      // Do not mount zero geometry or fall back to a competing legacy helper.
      let rect=outer();while(!disposed&&(rect.width<240||rect.height<192)){await new Promise(resolve=>win.setTimeout(resolve,50));rect=outer();}if(disposed)return;
      const reply=await host.fileCapability('pane-layout-mount',{rect,headerHeight:32});
      if(!reply.ok){if(reply.code==='OPERATION_UNKNOWN'||reply.message==='Native window layouts are unavailable.'){await root.restoreWindows();return;}throw new Error(reply.error||reply.message||'Window layout could not mount');}
      mounted=true;root.replaceNativeTabs();root.element.classList.add('window-slices-root');accept(reply.snapshot);onOuterEdge(snapshot.viewport);onActive();schedule();})();
      try{await mounting;}finally{mounting=null;}},
    destroy(){disposed=true;release?.();observer.disconnect();if(frame)win.cancelAnimationFrame(frame);win.removeEventListener('resize',schedule);document.removeEventListener('dragstart',startDrag,true);document.removeEventListener('dragover',dragOver,true);document.removeEventListener('drop',drop,true);document.removeEventListener('dragend',clear,true);win.removeEventListener('blur',clear);for(const view of views.values()){view.native.destroy();view.preview?.destroy();}region.remove();cue.remove();}
  };
}

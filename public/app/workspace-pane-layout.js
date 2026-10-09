import {installPreviewPinDrag} from './preview-pin-drag.js';

import { PREVIEW_TAB_MIME,createLensButton } from './native-window-tabs.js';
import { previewDropSurface } from './preview-docking.js';
import { installPreviewResizing } from './preview-resizing.js';
import { installPreviewDocking } from './preview-docking.js';
import { createFileCapabilityPanel } from './file-capability-panel.js';
import { installCoordinatedWindowSlices } from './coordinated-window-slices.js';

export const PREVIEW_SURFACES = ['left-top','left-bottom','right-top','right-bottom','middle'];
export function paneRegions({left, right, top, bottom, preview, placement, windows, viewportWidth, previewShare=.5}) {
  const share=Math.max(.15,Math.min(.85,Number.isFinite(previewShare)?previewShare:.5));
  const seam = windows ? right : preview&&placement==='middle'?Math.round(viewportWidth*(1-share)):viewportWidth - 8;
  const middle = preview && placement === 'middle' && windows ? Math.max(120,Math.min(right-left-176,(right-left)*share)) : 0;
  const regions = { left:{x:left,y:top,width:Math.max(176,seam-left-middle),height:bottom-top}, right:null, preview:null };
  if (windows) regions.right={x:right,y:top,width:viewportWidth-8-right,height:bottom-top};
  if (!preview) return regions;
  if (placement === 'middle') regions.preview={x:windows?right-middle:seam,y:top,width:windows?middle:viewportWidth-8-seam,height:bottom-top};
  else {
    const side=placement.startsWith('right')&&windows?'right':'left';
    const box=regions[side]; const half=box.height*share;
    regions.preview={...box,y:placement.endsWith('top')?top:bottom-half,height:half};
    box.y=placement.endsWith('top')?top+half:top;box.height-=half;
  }
  return regions;
}

/** Layout owns composition only; existing panels keep preview and native lifecycles. */
export function installWorkspacePaneLayout({externalWindows=false,document,host,navigator,windows,getSettings,saveSettings,isReady,setStatus}) {
  const win=document.defaultView, left=document.querySelector('#workspace-navigator');
  const right=windows.element;
  const baseTop=8;
  let lastSeam=right.getBoundingClientRect().left;
  let settings={preview:true,windows:!externalWindows,placement:'left-bottom',previewSizes:{},pinned:[]};
  let loaded=false,disposed=false,frame=0,pinnedId=null,lastSelection=null,lastGeometry='',restoredWindows=false,draggingPreview=false;
  const preview=createFileCapabilityPanel({document,host,previewOnly:true,setStatus});
  const pinned=createFileCapabilityPanel({document,host,previewOnly:true,setStatus});
  preview.element.classList.add('workspace-follow-preview');pinned.element.classList.add('workspace-pinned-preview');
  preview.setExpanded(true);pinned.setExpanded(true);pinned.element.hidden=true;
  right.classList.add('workspace-window-pane');document.documentElement.classList.add('workspace-two-pane');
  const controls=document.createElement('div');controls.className='workspace-pane-controls';
  const toggle=(label,action)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.addEventListener('click',action);controls.append(b);return b;};
  const commit=()=>{if(loaded)void saveSettings({...settings,pinned:settings.pinned.map(({id,path,name,sliceId,nativeIndex})=>({id,path,name,...(sliceId?{sliceId}:{}),...(Number.isInteger(nativeIndex)?{nativeIndex}:{})}))});};
  const previewToggle=toggle('Preview',()=>{settings.preview=!settings.preview;commit();schedule();});
  const windowsToggle=externalWindows?null:toggle('Windows',()=>{settings.windows=!settings.windows;commit();schedule();});
  const pin=toggle('Pin preview',()=>{
    const item=lastSelection?.mode==='single'?lastSelection.item:null;
    if(!item?.path)return;
    let tab=settings.pinned.find(t=>t.path===item.path);
    if(!tab){tab={id:win.crypto.randomUUID(),path:item.path,name:item.name||item.path.split(/[\\/]/).pop()};settings.pinned.push(tab);commit();}
    selectPinned(tab);
  });
  pin.textContent='';pin.title='Pin preview';pin.setAttribute('aria-label','Pin preview');pin.classList.add('preview-pin','file-capability-icon-button');pin.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M9 3h6l-1 7 4 4v2H6v-2l4-4zM12 16v6"/></svg>';preview.header.append(pin);
  const resolvePreviewDrag=installPreviewPinDrag({pin,getItem:()=>lastSelection?.mode==='single'?lastSelection.item:null,createId:()=>win.crypto.randomUUID()});
  const leftHeader=left.querySelector('.workspace-navigator-header');
  const actions=document.createElement('div');actions.className='workspace-left-actions';
  for(const action of document.querySelectorAll('.navigation .toolbar-shell')) {
    action.classList.remove('toolbar-float');
    actions.append(action);
  }
  const lens=createLensButton(document,source=>{if(externalWindows){win.parent.postMessage({type:'papers:proxima-lens-request',source},'*');return;}return slices.searchLens(source);},setStatus);
  actions.append(lens);leftHeader.append(actions,controls);
  function selectPinned(tab){if(slices?.active()){settings.windows=true;slices.selectPreview(tab);schedule();return;}pinnedId=tab.id;if(externalWindows){win.parent.postMessage({type:'papers:proxima-pinned-preview',tab},'*');renderTabs();return;}settings.windows=true;void pinned.previewPath(tab.path,tab.name);renderTabs();schedule();}
  function reorderPinned(id,beforeId,position){const tab=settings.pinned.find(t=>t.id===id);if(!tab||id===beforeId)return;const next=settings.pinned.filter(t=>t.id!==id),index=next.findIndex(t=>t.id===beforeId);if(Number.isInteger(position?.nativeIndex))tab.nativeIndex=position.nativeIndex;next.splice(index<0?next.length:index,0,tab);settings.pinned=next;commit();renderTabs();}
  function unpinToSurface(id,placement){const tab=settings.pinned.find(t=>t.id===id);if(!tab)return;settings.pinned=settings.pinned.filter(t=>t.id!==id);if(pinnedId===id)pinnedId=null;settings.preview=true;settings.placement=placement;lastSelection={mode:'single',item:{path:tab.path,name:tab.name}};void preview.previewPath(tab.path,tab.name);commit();renderTabs();lastGeometry='';schedule();}
  function renderTabs(){if(slices?.active()){slices.setPreviews(settings.pinned);return;}if(externalWindows){win.parent.postMessage({type:'papers:proxima-document-tabs',tabs:settings.pinned.map(t=>({...t,active:t.id===pinnedId})),slices:settings.windowSlices},'*');return;}windows.setDocumentTabs(settings.pinned.map(tab=>({id:tab.id,title:tab.name,nativeIndex:tab.nativeIndex,active:tab.id===pinnedId,onReorder:(beforeId,position)=>reorderPinned(tab.id,beforeId,position),onSelect:()=>selectPinned(tab),onClose:()=>{settings.pinned=settings.pinned.filter(t=>t.id!==tab.id);if(pinnedId===tab.id)pinnedId=null;commit();renderTabs();schedule();}})));}
  const box=(element,r)=>{if(!r){element.hidden=true;return;}element.hidden=false;Object.assign(element.style,{left:r.x+'px',top:r.y+'px',width:r.width+'px',height:r.height+'px',bottom:'auto',right:'auto'});};
  const previewShare=placement=>{const value=settings.previewSizes?.[placement];return Number.isFinite(value)?value:placement==='middle'?.3:.5;};
  function layout(){
    frame=0;if(disposed)return;
    if(!externalWindows){
      settings.windows=true;document.documentElement.classList.add('workspace-unified-panes');
      Object.assign(right.style,{left:'8px',top:'8px',width:(win.innerWidth-16)+'px',height:(win.innerHeight-16)+'px',bottom:'auto',right:'auto'});right.hidden=false;
      previewToggle.hidden=true;if(windowsToggle)windowsToggle.hidden=true;
      if(!slices?.active()){left.hidden=true;preview.element.hidden=true;}
      pinned.element.hidden=true;
      if(loaded&&!restoredWindows){restoredWindows=true;void slices.restore().catch(error=>{restoredWindows=false;setStatus(error?.message||String(error));});}
      slices?.refresh();pin.disabled=!lastSelection?.item?.path;return;
    }
    const workspace=document.querySelector('.workspace'),top=baseTop,bottom=win.innerHeight-8;
    const rb=right.getBoundingClientRect();if(rb.width>0)lastSeam=rb.left;const rightX=Math.max(184,Math.min(win.innerWidth-184,lastSeam));
    const regions=paneRegions({left:8,right:rightX,top,bottom,preview:settings.preview,placement:settings.placement,windows:settings.windows,viewportWidth:win.innerWidth,previewShare:previewShare(settings.placement)});
    if(regions.right)regions.right.width=win.innerWidth-8-rightX;
    if(settings.placement.startsWith('right')&&regions.preview&&settings.windows)regions.preview.width=win.innerWidth-8-rightX;
    // The native window's left edge remains authoritative. No second seam tracker.
    workspace?.style.setProperty('--workspace-navigator-width',regions.left.width+'px');
    Object.assign(left.style,{top:regions.left.y+'px',height:regions.left.height+'px',bottom:'auto',maxWidth:'none'});
    box(preview.element,regions.preview);preview.setExpanded(settings.preview);resizing?.sync(settings.placement);
    right.hidden=!settings.windows;
    if(regions.right)Object.assign(right.style,{top:regions.right.y+'px',height:regions.right.height+'px',bottom:'auto'});
    const header=right.header||right.querySelector('.file-capability-header');
    const activePinned=settings.windows&&settings.pinned.some(t=>t.id===pinnedId);
    box(pinned.element,activePinned?{x:rightX,y:header.getBoundingClientRect().bottom,width:win.innerWidth-8-rightX,height:right.getBoundingClientRect().bottom-header.getBoundingClientRect().bottom}:null);
    if(slices?.active())slices.setOverlay(draggingPreview||!settings.windows);else if(!externalWindows)windows.setTransientOverlay(draggingPreview||!settings.windows||activePinned);
    const geometry=JSON.stringify([regions,activePinned]);
    if(!externalWindows&&geometry!==lastGeometry){lastGeometry=geometry;preview.refreshPreviewGeometry();pinned.refreshPreviewGeometry();windows.refreshPreviewGeometry();
      if(!slices?.active())void host.fileCapability('chrome-pane-visible',{visible:!draggingPreview&&settings.windows&&!activePinned}).catch(()=>{});
      if(!slices?.active()&&settings.windows&&!activePinned){const b=right.getBoundingClientRect(),h=header.getBoundingClientRect();void host.fileCapability('chrome-pane-move',{rect:{x:Math.round(b.left+1),y:Math.round(h.bottom+1),width:Math.round(b.width-2),height:Math.max(1,Math.round(b.bottom-h.bottom-2)),rightInset:Math.max(0,win.innerWidth-b.right+1),bottomInset:Math.max(0,win.innerHeight-b.bottom+1)}}).catch(()=>{});}
    }
    if(loaded&&settings.windows&&!restoredWindows){restoredWindows=true;void (slices?slices.restore():windows.restoreWindows()).catch(error=>{restoredWindows=false;setStatus(error?.message||String(error));});}
    previewToggle.setAttribute('aria-pressed',String(settings.preview));windowsToggle?.setAttribute('aria-pressed',String(settings.windows));pin.disabled=!lastSelection?.item?.path;
  }
  function schedule(){if(!frame&&!disposed)frame=win.requestAnimationFrame(layout);}
  const observer=new win.ResizeObserver(schedule);observer.observe(left);observer.observe(right);
  const release=externalWindows?undefined:host.onChromeLayout?.(rect=>{if(!settings.windows||!Number.isFinite(rect?.x)||slices?.active())return;const width=win.innerWidth-8-rect.x;if(width>0){right.style.setProperty('--file-capability-width',width+'px');if(rect.reason==='resize'){settings.windowWidth=width;commit();}schedule();}});
  win.addEventListener('resize',schedule);
  navigator.setCollapsed(false);windows.setExpanded(true);
  function syncSettings(){if(loaded||!isReady())return;loaded=true;const saved=getSettings();if(saved){settings={...settings,...saved,placement:PREVIEW_SURFACES.includes(saved.placement)?saved.placement:'left-bottom',pinned:Array.isArray(saved.pinned)?saved.pinned.filter(t=>typeof t.path==='string'&&typeof t.id==='string'&&typeof t.name==='string'):[]};}if(externalWindows)settings.windows=false;else if(Number.isFinite(settings.windowWidth))right.style.setProperty('--file-capability-width',Math.min(win.innerWidth-192,Math.max(128,settings.windowWidth))+'px');slices?.setSettings(settings.windowSlices);renderTabs();schedule();if(saved)commit();}
  const slices=externalWindows?null:installCoordinatedWindowSlices({document,host,root:windows,pagePanels:{files:{element:left},preview},resolvePreviewDrag,onStatus:setStatus,
    onSettings:value=>{settings.windowSlices=value;commit();},
    onPreviews:value=>{settings.pinned=value;commit();},
    onActive:()=>{pinnedId=null;pinned.element.hidden=true;renderTabs();lastGeometry='';schedule();},
    onOuterEdge:()=>schedule(),
  });
  const resizing=installPreviewResizing({document,panel:preview.element,
    getState:()=>({placement:settings.placement,share:previewShare(settings.placement),span:settings.placement==='middle'?(settings.windows?lastSeam-8:win.innerWidth):win.innerHeight-8-baseTop}),
    onStart:()=>{},
    onChange:share=>{settings.previewSizes={...settings.previewSizes,[settings.placement]:share};schedule();},
    onFinish:save=>{draggingPreview=false;lastGeometry='';if(save)commit();schedule();},
  });
  const docking=installPreviewDocking({document,header:preview.header,
    getGeometry:()=>({left:8,right:lastSeam,top:baseTop,bottom:win.innerHeight-8,width:win.innerWidth,windows:settings.windows}),
    getRegion:placement=>paneRegions({left:8,right:lastSeam,top:baseTop,bottom:win.innerHeight-8,viewportWidth:win.innerWidth,preview:true,placement,windows:settings.windows,previewShare:previewShare(placement)}).preview,
    onStart:async()=>{draggingPreview=true;if(externalWindows)return;windows.setTransientOverlay(true);const result=await host.fileCapability('chrome-pane-visible',{visible:false});if(result?.ok===false)throw new Error('Window surface could not yield for docking');},
    onFinish:()=>{draggingPreview=false;lastGeometry='';schedule();},
    onDrop:placement=>{settings.placement=placement;commit();schedule();},
  });
  const receiveExternal=event=>{
    if(!externalWindows||event.source!==win.parent)return;
    let origin;try{origin=new URL(document.referrer).origin;}catch{return;}
    if(origin!=='null'&&event.origin!==origin)return;
    const data=event.data;
    if(data?.type==='papers:proxima-window-surface-ready')renderTabs();
    if(data?.type==='papers:proxima-slices-save'){settings.windowSlices=data.slices;commit();}
    if(data?.type==='papers:proxima-previews-save'&&Array.isArray(data.previews)){settings.pinned=data.previews;commit();renderTabs();}
    if(data?.type==='papers:proxima-document-select'){const tab=settings.pinned.find(t=>t.id===data.id);if(tab)selectPinned(tab);}
    if(data?.type==='papers:proxima-document-reorder')reorderPinned(data.id,data.beforeId,data.position);
    if(data?.type==='papers:proxima-document-close'){settings.pinned=settings.pinned.filter(t=>t.id!==data.id);if(pinnedId===data.id)pinnedId=null;commit();renderTabs();}
    if(data?.type==='papers:proxima-native-selected'){pinnedId=null;renderTabs();}
  };
  const dropCue=document.createElement('div');dropCue.className='preview-split-cue is-armed pinned-tab-drop-cue';dropCue.hidden=true;document.body.append(dropCue);
  const dragOverPinned=event=>{
    if(slices?.active())return;
    if(!Array.from(event.dataTransfer?.types??[]).includes(PREVIEW_TAB_MIME)||event.target?.closest?.('.pane-window-tabs'))return;
    const placement=previewDropSurface(event.clientX,event.clientY,{left:8,right:lastSeam,top:baseTop,bottom:win.innerHeight-8,width:win.innerWidth,windows:settings.windows});
    if(!placement){dropCue.hidden=true;return;}event.preventDefault();event.dataTransfer.dropEffect='move';
    const region=paneRegions({left:8,right:lastSeam,top:baseTop,bottom:win.innerHeight-8,viewportWidth:win.innerWidth,preview:true,placement,windows:settings.windows,previewShare:previewShare(placement)}).preview;
    Object.assign(dropCue.style,{left:region.x+'px',top:region.y+'px',width:region.width+'px',height:region.height+'px'});dropCue.hidden=false;
  };
  const dropPinned=event=>{if(slices?.active())return;dropCue.hidden=true;if(event.target?.closest?.('.pane-window-tabs'))return;const id=event.dataTransfer?.getData(PREVIEW_TAB_MIME);if(!settings.pinned.some(t=>t.id===id))return;const placement=previewDropSurface(event.clientX,event.clientY,{left:8,right:lastSeam,top:baseTop,bottom:win.innerHeight-8,width:win.innerWidth,windows:settings.windows});if(placement){event.preventDefault();event.stopPropagation();if(externalWindows)win.parent.postMessage({type:'papers:proxima-preview-slice-drop',id,side:placement.endsWith('top')?'top':placement.endsWith('bottom')?'bottom':'left'},'*');else unpinToSurface(id,placement);}};
  const clearDrop=()=>{dropCue.hidden=true;};
  const leaveDrop=event=>{if(!event.relatedTarget)clearDrop();};
  document.addEventListener('dragover',dragOverPinned);document.addEventListener('drop',dropPinned);document.addEventListener('dragend',clearDrop);document.addEventListener('dragleave',leaveDrop);win.addEventListener('blur',clearDrop);
  win.addEventListener('message',receiveExternal);
  syncSettings();schedule();
  return {syncSettings,toggleSurfaces(){const show=!settings.preview&&!settings.windows;settings.preview=show;settings.windows=externalWindows?false:show;commit();schedule();},selectNative(){slices?.nativeSelected();pinnedId=null;renderTabs();schedule();},syncSelection(selection){lastSelection=selection;pin.disabled=!selection?.item?.path;if(selection?.mode==='web'){pinnedId=null;if(externalWindows){win.parent.postMessage({type:'papers:proxima-preview-selection',selection},'*');renderTabs();return;}settings.windows=true;renderTabs();schedule();windows.syncSelection(selection);}else preview.syncSelection(selection);},previewPath(path,name){lastSelection={mode:'single',item:{path,name}};pin.disabled=false;return preview.previewPath(path,name);},destroy(){slices?.destroy();document.removeEventListener('dragover',dragOverPinned);document.removeEventListener('drop',dropPinned);document.removeEventListener('dragend',clearDrop);document.removeEventListener('dragleave',leaveDrop);win.removeEventListener('blur',clearDrop);dropCue.remove();win.removeEventListener('message',receiveExternal);resizing.destroy();docking.destroy();disposed=true;observer.disconnect();release?.();win.removeEventListener('resize',schedule);if(frame)win.cancelAnimationFrame(frame);preview.destroy();pinned.destroy();controls.remove();}};
}

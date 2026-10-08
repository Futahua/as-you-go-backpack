import { createHostBridge } from './host/host-bridge.js?build=coordination-v18';

import { createFileCapabilityPanel } from './file-capability-panel.js';

function parentOrigin() {
  try {
    const parsed = new URL(document.referrer);
    const origin = parsed.origin === 'null' ? `${parsed.protocol}//${parsed.host}` : parsed.origin;
    return origin && origin !== 'null' ? origin : '*';
  } catch {
    return '*';
  }
}

const expectedParentOrigin = parentOrigin();
const host = createHostBridge(window);
let disposed = false;
const tellParent=message=>window.parent.postMessage(message,expectedParentOrigin);

const panel = createFileCapabilityPanel({
  document,
  host,
  setStatus: () => {},
  windowsOnly:true,
  onNativeSelected:()=>{activeDocument=null;pinned.element.hidden=true;tellParent({type:'papers:proxima-native-selected'});renderDocuments();},
});
panel.openSearch();
let documents=[],activeDocument=null;
const pinned=createFileCapabilityPanel({document,host,previewOnly:true,setStatus:()=>{}});
pinned.element.classList.add('workspace-pinned-preview','proxima-pinned-preview','slice-file-preview');pinned.element.hidden=true;
function placeDocument(){if(!activeDocument)return;const b=panel.element.getBoundingClientRect(),h=panel.header.getBoundingClientRect();Object.assign(pinned.element.style,{position:'fixed',left:b.left+'px',top:h.bottom+'px',width:b.width+'px',height:Math.max(1,b.bottom-h.bottom)+'px',right:'auto',bottom:'auto'});pinned.refreshPreviewGeometry();}
function selectDocument(tab){activeDocument=tab.id;pinned.element.hidden=false;pinned.setExpanded(true);void pinned.previewPath(tab.path,tab.name);panel.setTransientOverlay(true);void host.fileCapability('chrome-pane-visible',{visible:false});renderDocuments();placeDocument();}
function renderDocuments(){panel.setDocumentTabs(documents.map(tab=>({id:tab.id,title:tab.name,active:activeDocument===tab.id,onSelect:()=>{selectDocument(tab);tellParent({type:'papers:proxima-document-select',id:tab.id});},onClose:()=>{documents=documents.filter(t=>t.id!==tab.id);if(activeDocument===tab.id){activeDocument=null;pinned.element.hidden=true;panel.setTransientOverlay(false);}tellParent({type:'papers:proxima-document-close',id:tab.id});renderDocuments();},onReorder:beforeId=>tellParent({type:'papers:proxima-document-reorder',id:tab.id,beforeId})})));}
void panel.restoreWindows().catch(()=>{});
const releaseNativeEdge = host.onChromeLayout?.(rect => {
  if (disposed || !Number.isFinite(rect?.x)) return;
  window.parent.postMessage({ type: 'papers:proxima-preview-native-edge', x: rect.x, parentX: rect.parentX }, expectedParentOrigin);
});


window.addEventListener('keydown', (event) => {
  if (event.defaultPrevented || event.key !== 'Tab'
    || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey
    || event.isComposing || event.repeat) return;
  event.preventDefault();
  event.stopPropagation();
  window.parent.postMessage({ type: 'papers:proxima-toggle-left-pane-request' }, expectedParentOrigin);
}, true);

function disposePreview() {
  if (disposed) return;
  disposed = true;
  releaseNativeEdge?.();
  pinned.destroy();panel.destroy();
}

window.addEventListener('message', (event) => {
  if (event.source !== window.parent) return;
  if (expectedParentOrigin !== '*' && event.origin !== expectedParentOrigin) return;
  if(disposed)return;
  if(event.data?.type==='papers:proxima-document-tabs'){documents=Array.isArray(event.data.tabs)?event.data.tabs:[];if(activeDocument&&!documents.some(t=>t.id===activeDocument)){activeDocument=null;pinned.element.hidden=true;panel.setTransientOverlay(false);}renderDocuments();return;}
  if(event.data?.type==='papers:proxima-pinned-preview'){if(event.data.tab)selectDocument(event.data.tab);return;}
  if(event.data?.type==='papers:proxima-preview-slice-drop')return;
  if (event.data?.type === 'papers:proxima-preview-selection') {
    if (disposed) return;
    panel.syncSelection(event.data.selection);
    return;
  }
  if (event.data?.type === 'papers:proxima-preview-reposition') {
    if (disposed) return;
    panel.refreshPreviewGeometry();placeDocument();
    return;
  }
  if (event.data?.type === 'papers:proxima-preview-dispose') {
    disposePreview();
    window.parent.postMessage({ type: 'papers:proxima-preview-disposed' }, expectedParentOrigin);
  }
});

window.addEventListener('pagehide', disposePreview, { once: true });
window.parent.postMessage({ type: 'papers:proxima-preview-ready' }, expectedParentOrigin);

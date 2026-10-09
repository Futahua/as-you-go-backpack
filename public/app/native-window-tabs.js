export const NATIVE_TAB_MIME='application/x-papers-native-pane-tab';
export const PREVIEW_TAB_MIME='application/x-papers-preview-tab';
import { isValidThumbnailSuccess } from './window-layout-preview.js';
import { openWindowLayoutPickerSession } from './window-layout-picker-session.js';
import { windowLayoutControlGlyphMarkup } from './window-layout-control-icons.js';
import { WINDOW_TAB_MIME, windowTabTransfer, paneWindowPickerRows } from './window-tab-transfer.js';

/** Retained window membership belongs to the native host, including restart recovery. */
export function installNativeWindowTabs({ document, header, host, bounds, prepare, overlay, status, lens, sliceId='main', sliceDocking=false }) {
  const strip = document.createElement('div');
  strip.className = 'pane-window-tabs file-capability-browser-tabs';
  strip.addEventListener('wheel', event => { if (strip.scrollWidth > strip.clientWidth) { event.preventDefault(); strip.scrollLeft += event.deltaY || event.deltaX; } }, { passive: false });
  strip.setAttribute('role', 'tablist');
  strip.setAttribute('aria-label', 'Application windows');
  header.prepend(strip);
  let lensButton = null;
  if (lens) {
    lensButton = document.createElement('button'); lensButton.type = 'button'; lensButton.className = 'file-capability-browser-nav native-window-lens'; lensButton.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 6l1.5-2h5L16 6h4a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="4"/><path d="M18 9h.01"/></svg>'; lensButton.title = 'Google Lens — click: screen region · right-click: copied image'; lensButton.setAttribute('aria-label','Google Lens screen region search');
    const runLens = async (event, source) => { event.preventDefault(); event.stopPropagation(); if (lensButton.disabled) return; lensButton.disabled=true; try { await lens(source); } catch(error) { status(error?.message || String(error)); } finally { lensButton.disabled=false; } };
    lensButton.addEventListener('click', event => { void runLens(event, 'screen'); });
    lensButton.addEventListener('contextmenu', event => { void runLens(event, 'clipboard'); });
  }
  let disposed = false;
  let busy = false;
  let selectionGeneration = 0;
  let tabs = [];
  let documentTabs = [];
  let documentDragId=null;
  let dwell = null;
  let pointerDrag = null; let suppressClick = false;
  let hoverTimer = null, hoverGeneration = 0;
  const stopHover = () => {
    ++hoverGeneration; clearTimeout(hoverTimer); hoverTimer = null;
    void host.windowPreviewHide?.().catch(() => {});
  };
  const previewTab = (tab, button) => {
    stopHover();
    const generation = hoverGeneration;
    hoverTimer = setTimeout(async () => {
      try {
        const listed = await host.windowCandidates({ includeNativeIcons: false });
        if (disposed || generation !== hoverGeneration) return;
        const candidate = listed.candidates?.find(item =>
          tab.windowInstanceId ? item.windowInstanceId === tab.windowInstanceId
            : tab.handle && item.handle === tab.handle);
        if (!candidate) return;
        const bound = await host.bindWindowCandidate(candidate.id);
        if (disposed || generation !== hoverGeneration || !bound?.capability) return;
        const show = async result => {
          if (disposed || generation !== hoverGeneration || !isValidThumbnailSuccess(result)) return;
          const box = button.getBoundingClientRect();
          const win = document.defaultView || globalThis;
          await host.windowPreviewShow(result.imageUrl, tab.title, result.width, result.height,
            {x:Math.round((win.screenX||0)+box.left),y:Math.round((win.screenY||0)+box.top),width:Math.round(box.width),height:Math.round(box.height)});
          if (generation !== hoverGeneration) await host.windowPreviewHide();
        };
        if (host.windowThumbnailCacheCapability) await show(await host.windowThumbnailCacheCapability(bound.capability));
        if (generation !== hoverGeneration) return;
        await show(await host.windowThumbnailCapability(bound.capability, {maxWidth:240,maxHeight:135}));
      } catch { /* Unavailable capture leaves the current pane untouched. */ }
    }, 180);
  };
  const report = (error) => { if (!disposed) status(error?.message || String(error)); };
  const request = async (operation, data) => {
    const reply = await host.fileCapability(operation, data);
    if (reply?.ok === false) throw new Error(reply.message || reply.error || 'Window could not be shown');
    return reply;
  };
  async function add() {
    if (busy || disposed) return;
    stopHover();
    busy = true; render();
    try {
      const pickerId = globalThis.crypto.randomUUID();
      const session = await openWindowLayoutPickerSession({
        pickerId,
        openPicker: (id) => host.windowCandidatePicker([], id),
        loadCandidates: async () => {
          const listed = await host.windowCandidates({ includeNativeIcons: false });
          await request('pane-window-tabs', {});
          return listed;
        },
        updatePicker: (candidates, id) => host.windowCandidatePickerUpdate(paneWindowPickerRows(candidates, tabs), id),
        isCurrent: () => !disposed,
      });
      if (disposed || session.outcome === 'stale') return;
      if (!['success', 'action'].includes(session.outcome)) throw new Error('Window list could not be loaded');
      const picked = session.outcome === 'action' ? session.action : await session.actionPromise;
      if (disposed || picked?.action === 'cancel') return;
      const pickedCandidate = session.candidates?.find(candidate => candidate.id === picked?.candidateId);
      const retained = tabs.find(tab => ('pane:' + tab.id === picked?.candidateId)
        || (tab.windowInstanceId && tab.windowInstanceId === pickedCandidate?.windowInstanceId));
      // Remove means release this strip's membership, never close the app or
      // remove the same window from a widget layout.
      if (['select', 'close'].includes(picked?.action) && retained) {
        await request('pane-window-detach', { tabId: retained.id });
        return;
      }
      if (picked?.action !== 'select') {
        if (picked?.action) throw new Error('Choose a window from the list to add it here');
        return;
      }
      const binding = await host.bindWindowCandidate(picked.candidateId);
      if (disposed) return;
      if (binding?.outcome !== 'success' || !binding.capability?.bindingId) throw new Error('This window is no longer available');
      if (await prepare() === false || disposed) return;
      await request('pane-window-attach', { bindingId: binding.capability.bindingId, rect: bounds() });
    } catch (error) { report(error); }
    finally {
      busy = false;
      await host.windowCandidatePickerClose().catch(() => {});
      if (!disposed) render();
    }
  }
  function render() {
    if (pointerDrag) return;
    strip.replaceChildren();
    for (const tab of tabs) {
      const group = document.createElement('span'); group.className = 'pane-window-tab file-capability-browser-tab' + (tab.active && !documentTabs.some(t=>t.active) ? ' active' : '');
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'file-capability-browser-tab-label'; button.title = tab.title;
      const icon = document.createElement(tab.icon ? 'img' : 'span');
      icon.className = 'file-capability-browser-tab-favicon';
      if (tab.icon) icon.src = tab.icon; else icon.textContent = '▣';
      const label = document.createElement('span'); label.className = 'file-capability-browser-tab-text'; label.textContent = tab.title;
      button.append(icon, label);
      button.setAttribute('role', 'tab'); button.setAttribute('aria-selected', String(tab.active && !documentTabs.some(t=>t.active)));
      button.addEventListener('pointerenter', () => previewTab(tab, button));
      button.addEventListener('pointerleave', stopHover);
      button.addEventListener('click', async (event) => {
        stopHover();
        event?.stopPropagation();
        if (suppressClick) { suppressClick = false; return; }
        if (disposed) return;
        const generation = ++selectionGeneration;
        try {
          if (await prepare() === false || disposed || generation !== selectionGeneration) return;
          await request('pane-window-select', { tabId: tab.id });
        } catch (error) { report(error); }
      });
      const release = document.createElement('button');
      release.type = 'button'; release.className = 'pane-window-release file-capability-browser-tab-close'; release.textContent = '×';
      release.title = 'Release window'; release.setAttribute('aria-label', `Release ${tab.title}`);
      release.addEventListener('click', () => { if (!disposed) void request('pane-window-detach', { tabId: tab.id }).catch(report); });
      group.addEventListener('click', event => { if (event.target === group) button.click?.(); });
      group.setAttribute('data-pane-tab-id', tab.id);
      if(sliceDocking){group.draggable=true;group.addEventListener('dragstart',event=>{stopHover();event.dataTransfer.setData(NATIVE_TAB_MIME,JSON.stringify({id:tab.id,sliceId}));event.dataTransfer.effectAllowed='move';void overlay(true).catch(report);});group.addEventListener('dragend',()=>{void overlay(documentTabs.some(t=>t.active)).catch(report);});}
      group.addEventListener('pointerdown', event => {
        if(sliceDocking)return;
        if (event.button !== 0 || event.target === release) return;
        suppressClick=false;
        pointerDrag = { id:tab.id, x:event.clientX, y:event.clientY, moved:false, pointerId:event.pointerId, beforeId:tab.id };
        group.setPointerCapture?.(event.pointerId);
      });
      group.addEventListener('pointermove', event => {
        if (!pointerDrag || pointerDrag.pointerId !== event.pointerId) return;
        if (Math.hypot(event.clientX-pointerDrag.x,event.clientY-pointerDrag.y)>5) pointerDrag.moved=true;
        if (!pointerDrag.moved) return;
        const pane=bounds(); const outside=pane && (event.clientX<pane.x||event.clientX>pane.x+pane.width||event.clientY>pane.y+pane.height||event.clientY<(header.getBoundingClientRect?.().top??0));
        strip.classList?.toggle('detach-ready',Boolean(event.shiftKey&&outside));
        for (const child of strip.children) child.classList?.remove('reorder-before','reorder-after');
        const target=document.elementFromPoint?.(event.clientX,event.clientY)?.closest?.('[data-pane-tab-id]');
        const targetId=target?.getAttribute('data-pane-tab-id');
        if(targetId&&targetId!==pointerDrag.id){
          const box=target.getBoundingClientRect?.(); const after=box&&event.clientX>(box.left+box.right)/2;
          pointerDrag.beforeId=after?(tabs[tabs.findIndex(t=>t.id===targetId)+1]?.id||''):targetId;
          target.classList?.add(after?'reorder-after':'reorder-before');
        }
      });
      group.addEventListener('pointerup', event => {
        const drag=pointerDrag; pointerDrag=null; group.releasePointerCapture?.(event.pointerId);
        if (!drag?.moved || disposed) return;
        suppressClick=true; event.preventDefault(); event.stopPropagation();
        const target=document.elementFromPoint?.(event.clientX,event.clientY)?.closest?.('[data-pane-tab-id]');
        const beforeId=drag.beforeId ?? target?.getAttribute('data-pane-tab-id') ?? '';
        strip.classList?.remove('detach-ready'); strip.setAttribute('data-drag-hint','');
        const stripBox=strip.getBoundingClientRect?.();
        const inStrip=stripBox ? event.clientX>=stripBox.left&&event.clientX<=stripBox.right&&event.clientY>=stripBox.top&&event.clientY<=stripBox.bottom : Boolean(target);
        render();
        if(inStrip) { if(beforeId!==drag.id) void request('pane-window-reorder',{tabId:drag.id,beforeId}).catch(report); }
        else void request('pane-window-drop',{tabId:drag.id,beforeId,shiftHeld:Boolean(event.shiftKey)}).catch(report);
      });
      group.addEventListener('pointercancel', () => { pointerDrag=null; strip.classList?.remove('detach-ready'); strip.setAttribute('data-drag-hint',''); render(); });
      group.append(button, release); strip.append(group);
    }
    const addButton = document.createElement('button'); addButton.type = 'button';
    addButton.innerHTML = windowLayoutControlGlyphMarkup('pick');
    addButton.title = 'Existing windows — hover for the list'; addButton.setAttribute('aria-label', 'Existing windows');
    addButton.addEventListener('mouseenter', () => { if (!busy && !disposed) dwell = setTimeout(() => { dwell = null; void add(); }, 200); });
    addButton.addEventListener('mouseleave', () => { clearTimeout(dwell); dwell = null; });
    addButton.disabled = busy; addButton.addEventListener('click', add);
    if (lensButton) strip.prepend(lensButton);
    strip.prepend(addButton);
    for (const tab of documentTabs) {
      const group = document.createElement('span'); group.className = 'pane-window-tab file-capability-browser-tab' + (tab.active ? ' active' : '');
      const button = document.createElement('button'); button.type = 'button'; button.className = 'file-capability-browser-tab-label'; const icon=document.createElement(tab.icon?'img':'span');icon.className='file-capability-browser-tab-favicon';if(tab.icon){icon.src=tab.icon;icon.alt='';}else icon.textContent='▧';const label=document.createElement('span');label.className='file-capability-browser-tab-text';label.textContent=tab.title;button.append(icon,label); button.title = tab.title; button.setAttribute('role','tab'); button.setAttribute('aria-selected',String(Boolean(tab.active)));
      button.addEventListener('click', event => { event.stopPropagation(); if(suppressClick){suppressClick=false;return;} stopHover(); tab.onSelect(); });
      const close = document.createElement('button'); close.type='button'; close.className='file-capability-browser-tab-close'; close.textContent='×'; close.setAttribute('aria-label','Unpin '+tab.title); close.addEventListener('click',event=>{event.stopPropagation();tab.onClose();});
      group.draggable=true;group.setAttribute('data-preview-tab-id',tab.id);
      group.addEventListener('dragstart',event=>{documentDragId=tab.id;stopHover();event.dataTransfer.setData(PREVIEW_TAB_MIME,tab.id);event.dataTransfer.effectAllowed='move';void overlay(true).catch(report);});
      group.addEventListener('dragend',()=>{documentDragId=null;for(const child of strip.children)child.classList?.remove('reorder-before','reorder-after');void overlay(documentTabs.some(t=>t.active)).catch(report);});
      group.append(button,close);
      const nativeGroups=Array.from(strip.children).filter(node=>node.getAttribute?.('data-pane-tab-id'));
      const anchor=Number.isInteger(tab.nativeIndex)?nativeGroups[Math.max(0,tab.nativeIndex)]:null;
      if(anchor&&strip.insertBefore)strip.insertBefore(group,anchor);else strip.append(group);
    }
  }
  const unsubscribe = host.onPaneTabs((next) => {
    if (disposed) return;
    const updated = next.filter(tab => typeof tab.id === 'string' && typeof tab.title === 'string');
    const presentation = list => JSON.stringify(list.map(tab => [tab.id, tab.title, tab.icon || '']));
    const sameStrip = presentation(tabs) === presentation(updated);
    tabs = updated;
    if (sameStrip && !pointerDrag) {
      for (const group of strip.children) {
        const tab = tabs.find(item => item.id === group.getAttribute('data-pane-tab-id'));
        if (!tab) continue;
        group.classList?.toggle('active', Boolean(tab.active && !documentTabs.some(t=>t.active)));
        group.children[0]?.setAttribute('aria-selected', String(Boolean(tab.active && !documentTabs.some(t=>t.active))));
      }
    } else render();
  });
  render();
  strip.addEventListener('dragover', event => {
    if(sliceDocking&&Array.from(event.dataTransfer?.types??[]).includes(NATIVE_TAB_MIME)){event.preventDefault();event.dataTransfer.dropEffect='move';return;}
    if(documentDragId&&Array.from(event.dataTransfer?.types??[]).includes(PREVIEW_TAB_MIME)){
      event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect='move';
      for(const child of strip.children)child.classList?.remove('reorder-before','reorder-after');
      const target=event.target?.closest?.('[data-preview-tab-id],[data-pane-tab-id]');if(target&&target.getAttribute('data-preview-tab-id')!==documentDragId){const box=target.getBoundingClientRect();target.classList?.add(event.clientX>(box.left+box.right)/2?'reorder-after':'reorder-before');}return;
    }
    if (disposed || !Array.from(event.dataTransfer?.types ?? []).includes(WINDOW_TAB_MIME)) return;
    event.preventDefault(); event.dataTransfer.dropEffect = 'copy';
  });
  strip.addEventListener('drop', async event => {
    if(sliceDocking&&Array.from(event.dataTransfer?.types??[]).includes(NATIVE_TAB_MIME))return;
    const previewId=(documentDragId||Array.from(event.dataTransfer?.types??[]).includes(PREVIEW_TAB_MIME))?event.dataTransfer?.getData(PREVIEW_TAB_MIME):null;
    if(previewId){
      const source=documentTabs.find(t=>t.id===previewId);if(!source)return;
      event.preventDefault();event.stopPropagation();
      const target=event.target?.closest?.('[data-preview-tab-id],[data-pane-tab-id]');
      if(target?.getAttribute('data-preview-tab-id')===previewId)return;
      const ordered=Array.from(strip.children).filter(node=>node.getAttribute?.('data-pane-tab-id')||node.getAttribute?.('data-preview-tab-id')).filter(node=>node.getAttribute('data-preview-tab-id')!==previewId);
      const box=target?.getBoundingClientRect();let at=ordered.indexOf(target);
      if(at<0)at=ordered.length;else if(event.clientX>(box.left+box.right)/2)at++;
      const beforeId=ordered.slice(at).find(node=>node.getAttribute('data-preview-tab-id'))?.getAttribute('data-preview-tab-id')||'';
      const nativeIndex=ordered.slice(0,at).filter(node=>node.getAttribute('data-pane-tab-id')).length;
      source.onReorder?.(beforeId,{nativeIndex});
      return;
    }
    const instance = windowTabTransfer(event.dataTransfer?.getData(WINDOW_TAB_MIME));
    if (!instance || disposed || busy) return;
    event.preventDefault(); event.stopPropagation();
    busy = true;
    try {
      const existing = tabs.find(tab => tab.windowInstanceId === instance);
      if (existing) {
        if (await prepare() !== false && !disposed) await request('pane-window-select', { tabId: existing.id });
        return;
      }
      const listed = await host.windowCandidates({ includeNativeIcons: false });
      if (disposed) return;
      const candidate = listed.candidates?.find(candidate => candidate.windowInstanceId === instance);
      if (!candidate) throw new Error('This exact window is no longer available');
      const binding = await host.bindWindowCandidate(candidate.id);
      if (disposed) return;
      if (binding?.outcome !== 'success' || !binding.capability?.bindingId) throw new Error('This window is no longer available');
      if (await prepare() !== false && !disposed) await request('pane-window-attach', { bindingId: binding.capability.bindingId, rect: bounds() });
    } catch (error) { report(error); }
    finally { busy = false; if (!disposed) render(); }
  });
  void request('pane-window-tabs', { rect: bounds() }).catch(() => {});
  return {
    setDocumentTabs(next) { const key=tabs=>JSON.stringify(tabs.map(({id,title,icon,active,nativeIndex})=>({id,title,icon,active,nativeIndex})));const changed=key(next)!==key(documentTabs);documentTabs = next; if (!disposed && changed) render(); },
    hasWindows() { return !disposed && tabs.length > 0; },
    async restoreCurrent() {
      if (disposed || await prepare() === false) return;
      await request('pane-window-tabs', { rect: bounds() });
      if (!disposed) await overlay(false);
    },
    async showCurrent() { if (!disposed && await prepare() !== false) await overlay(false); },
    destroy() { if(disposed)return;stopHover(); disposed = true; clearTimeout(dwell); unsubscribe(); strip.remove(); lensButton?.remove(); if (busy) void host.windowCandidatePickerClose().catch(() => {}); },
  };
}

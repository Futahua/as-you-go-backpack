import { openWindowLayoutPickerSession } from './window-layout-picker-session.js';
import { windowLayoutControlGlyphMarkup } from './window-layout-control-icons.js';
import { WINDOW_TAB_MIME, windowTabTransfer, paneWindowPickerRows } from './window-tab-transfer.js';

/** Retained window membership belongs to the native host, including restart recovery. */
export function installNativeWindowTabs({ document, header, host, bounds, prepare, overlay, status, lens }) {
  const strip = document.createElement('div');
  strip.className = 'pane-window-tabs file-capability-browser-tabs';
  strip.addEventListener('wheel', event => { if (strip.scrollWidth > strip.clientWidth) { event.preventDefault(); strip.scrollLeft += event.deltaY || event.deltaX; } }, { passive: false });
  strip.setAttribute('role', 'tablist');
  strip.setAttribute('aria-label', 'Application windows');
  header.prepend(strip);
  let lensButton = null;
  if (lens) {
    lensButton = document.createElement('button'); lensButton.type = 'button'; lensButton.className = 'file-capability-browser-nav native-window-lens'; lensButton.textContent = '⌾'; lensButton.title = 'Google Lens — select anywhere on this machine'; lensButton.setAttribute('aria-label','Google Lens screen capture');
    lensButton.addEventListener('click', async event => { event.stopPropagation(); lensButton.disabled=true; try { await lens(); } catch(error) { status(error?.message || String(error)); } finally { lensButton.disabled=false; } });
    header.append(lensButton);
  }
  let disposed = false;
  let busy = false;
  let selectionGeneration = 0;
  let tabs = [];
  let dwell = null;
  let initialTabs = true;
  let pointerDrag = null; let suppressClick = false;
  const report = (error) => { if (!disposed) status(error?.message || String(error)); };
  const request = async (operation, data) => {
    const reply = await host.fileCapability(operation, data);
    if (reply?.ok === false) throw new Error(reply.message || reply.error || 'Window could not be shown');
    return reply;
  };
  async function add() {
    if (busy || disposed) return;
    busy = true; render();
    try {
      await overlay(true);
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
      if (!disposed) { await overlay(false).catch(() => {}); render(); }
    }
  }
  function render() {
    if (pointerDrag) return;
    strip.replaceChildren();
    for (const tab of tabs) {
      const group = document.createElement('span'); group.className = 'pane-window-tab file-capability-browser-tab' + (tab.active ? ' active' : '');
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'file-capability-browser-tab-label'; button.title = tab.title;
      const icon = document.createElement(tab.icon ? 'img' : 'span');
      icon.className = 'file-capability-browser-tab-favicon';
      if (tab.icon) icon.src = tab.icon; else icon.textContent = '▣';
      const label = document.createElement('span'); label.className = 'file-capability-browser-tab-text'; label.textContent = tab.title;
      button.append(icon, label);
      button.setAttribute('role', 'tab'); button.setAttribute('aria-selected', String(tab.active));
      button.addEventListener('click', async (event) => {
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
      group.addEventListener('pointerdown', event => {
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
    addButton.disabled = busy; addButton.addEventListener('click', add); strip.prepend(addButton);
  }
  const unsubscribe = host.onPaneTabs((next) => {
    if (disposed) return;
    tabs = next.filter(tab => typeof tab.id === 'string' && typeof tab.title === 'string'); render();
    if (initialTabs && tabs.length) { initialTabs = false; void Promise.resolve().then(async () => { if (!disposed && selectionGeneration === 0 && await prepare() !== false) await overlay(false); }).catch(report); }
  });
  render();
  strip.addEventListener('dragover', event => {
    if (disposed || !Array.from(event.dataTransfer?.types ?? []).includes(WINDOW_TAB_MIME)) return;
    event.preventDefault(); event.dataTransfer.dropEffect = 'copy';
  });
  strip.addEventListener('drop', async event => {
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
    hasWindows() { return !disposed && tabs.length > 0; },
    async showCurrent() { if (!disposed && await prepare() !== false) await overlay(false); },
    destroy() { disposed = true; clearTimeout(dwell); unsubscribe(); strip.remove(); lensButton?.remove(); if (busy) void host.windowCandidatePickerClose().catch(() => {}); },
  };
}

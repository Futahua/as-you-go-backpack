/** Saved pills belong to document preferences; browser storage is a legacy fallback. */
const MODES = new Set(['ayg', 'machine', 'action']);

export function navigatorDropEffect(effectAllowed, preferred='move') {
  const allowed={none:[],copy:['copy'],link:['link'],move:['move'],copyLink:['copy','link'],copyMove:['copy','move'],linkMove:['link','move'],all:['copy','link','move'],uninitialized:['copy','link','move']}[effectAllowed]||['copy','link','move'];
  return allowed.includes(preferred)?preferred:allowed[0]||'none';
}

/** Same targets share a pill even when saved through different entry points. */
export function uniqueNavigatorSavedStates(states, resolveTarget = () => null) {
  const seen = new Set(), result = [];
  for (const state of states) {
    if (!state || typeof state.name !== 'string' || !MODES.has(state.mode)) continue;
    const keys = [];
    const target = state.path || state.art?.target || resolveTarget(state);
    if (typeof target === 'string' && target) {
      const windows = /^[a-z]:[\\/]|^\\\\/i.test(target);
      keys.push('target:' + (windows ? target.replace(/\//g,'\\').replace(/\\+$/,'').toLowerCase() : target));
    }
    if(state.mode==='ayg' && state.currentId)keys.push('group:'+state.currentId);
    if(state.itemId || state.art?.shortcutId)keys.push('item:'+(state.itemId||state.art.shortcutId));
    if(state.quickRunKey)keys.push(state.quickRunKey.startsWith('group:')?state.quickRunKey:'quick:'+state.quickRunKey);
    const duplicate=keys.some(key=>seen.has(key));
    keys.forEach(key=>seen.add(key));
    if(!duplicate)result.push(state);
    else if(state.itemId){
      const index=result.findIndex(saved=>saved.itemId===state.itemId ||
        (saved.path||saved.art?.target) && keys.includes('target:'+String(saved.path||saved.art.target).replace(/\//g,'\\').replace(/\\+$/,'').toLowerCase()));
      if(index>=0)result[index]=state;
    }
  }
  return result;
}

export function decodeNavigatorSavedStates(raw, resolveTarget) {
  try {
    const parsed = JSON.parse(raw || '[]');
    if (!Array.isArray(parsed)) return [];
    return uniqueNavigatorSavedStates(parsed,resolveTarget);
  } catch {
    return [];
  }
}

export function createNavigatorSavedStates({ document, container, snapshot, restore, art, fromDrop, dragFile, decorateLabel, resolveTarget, loadSavedStates, saveSavedStates, isReady = () => true, onSaveError = () => {}, onSelectionChange = () => {} }) {
  const win = document.defaultView;
  const storage = win?.localStorage;
  const key = 'papers:ayg:navigator-saved-states';
  const heightKey = `${key}-height`;
  const channel = typeof win?.BroadcastChannel === 'function'
    ? new win.BroadcastChannel('papers:ayg:navigator-saved-states-v1')
    : null;
  let initialized = isReady();
  const durableStates = initialized ? loadSavedStates?.() : undefined;
  let durableSignature = JSON.stringify(durableStates);
  let states = !initialized ? [] : Array.isArray(durableStates) ? uniqueNavigatorSavedStates(durableStates,resolveTarget) : decodeNavigatorSavedStates(storage?.getItem(key),resolveTarget);
  let saveQueue = Promise.resolve();
  let pendingSaves = 0;
  let clearArmed = false;
  let heldClick=null;let selecting=false;const selected=new Set();const selectionKey=state=>JSON.stringify([state.mode,state.itemId||state.currentId||state.quickRunKey||state.path||state.url||state.art?.target||state.name]);
  const phone=new URL(win?.location?.href||"https://papers.local/").searchParams.has("papers-phone");

  const track = document.createElement('div');
  track.className = 'navigator-saved-track';
  const grip = document.createElement('div');
  grip.className = 'navigator-pills-height-grip';
  grip.setAttribute('role', 'separator');
  grip.setAttribute('aria-orientation', 'horizontal');
  grip.title = 'Resize saved items height';
  container.after(grip);

  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'navigator-saved-clear';
  clear.title = 'Clear all saved items';
  clear.setAttribute('aria-label', clear.title);
  clear.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 6h12M7 6v10h6V6M8 4h4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  const applyHeight = (value) => {
    const height = Math.max(28, Math.min(Math.max(28, win.innerHeight * .45), value));
    container.style.height = `${height}px`;
    track.style.setProperty('--pill-rows', String(Math.max(1, Math.floor((height - 4) / 26))));
    return height;
  };
  try { applyHeight(Number(storage?.getItem(heightKey)) || 80); } catch { applyHeight(80); }

  const disarmClear = () => {
    clearArmed = false;
    clear.classList.remove('armed');
    clear.title = 'Clear all saved items';
    clear.setAttribute('aria-label', clear.title);
  };
  const persistStates = () => {
    try { storage?.setItem(key, JSON.stringify(states)); } catch {}
    try { channel?.postMessage({ type: 'states', states }); } catch {}
    if(saveSavedStates){
      const snapshot=JSON.parse(JSON.stringify(states));
      pendingSaves++;
      saveQueue=saveQueue.catch(()=>{}).then(()=>saveSavedStates(snapshot)).then(saved=>{
        if(saved===false)throw new Error('Saved items could not be saved.');
        return true;
      }).catch(error=>{onSaveError(error);return false;}).finally(()=>{pendingSaves--;});
    }
    return saveQueue;
  };
  const persistHeight = (height) => {
    try { storage?.setItem(heightKey, String(height)); } catch {}
    try { channel?.postMessage({ type: 'height', height }); } catch {}
  };
  const installRemoteStates = (next) => {
    states = Array.isArray(next)
      ? uniqueNavigatorSavedStates(next,resolveTarget)
      : [];
    disarmClear();
    render();
  };

  let resizing = false;
  grip.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    resizing = true;
    grip.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  });
  grip.addEventListener('pointermove', (event) => {
    if (!resizing) return;
    const height = applyHeight(event.clientY - container.getBoundingClientRect().top);
    persistHeight(height);
    event.preventDefault();
  });
  const finishResize = () => { resizing = false; };
  grip.addEventListener('pointerup', finishResize);
  grip.addEventListener('pointercancel', finishResize);
  container.addEventListener('wheel', (event) => {
    if (event.ctrlKey || container.scrollWidth <= container.clientWidth) return;
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (!delta) return;
    event.preventDefault();
    container.scrollLeft += delta * (event.deltaMode === 1 ? 20 : event.deltaMode === 2 ? container.clientWidth : 1);
  }, { passive: false });

  win?.addEventListener?.('storage', (event) => {
    if (event.storageArea && event.storageArea !== storage) return;
    if (!loadSavedStates && !pendingSaves && event.key === key) installRemoteStates(decodeNavigatorSavedStates(event.newValue));
    if (event.key === heightKey && event.newValue != null) applyHeight(Number(event.newValue) || 80);
  });
  if (channel) {
    channel.addEventListener('message', (event) => {
      if (!loadSavedStates && !pendingSaves && event.data?.type === 'states') installRemoteStates(event.data.states);
      if (event.data?.type === 'height') applyHeight(Number(event.data.height) || 80);
    });
  }

  container.addEventListener('dragover', (event) => {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = navigatorDropEffect(event.dataTransfer.effectAllowed, 'copy');
    container.classList.add('drop-target');
  });
  container.addEventListener('dragleave', () => container.classList.remove('drop-target'));
  container.addEventListener('drop', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    container.classList.remove('drop-target');
    const state = await fromDrop?.(event.dataTransfer);
    if (!state) return;
    states=uniqueNavigatorSavedStates([...states,...(Array.isArray(state)?state:[state])],resolveTarget);
    persistStates();
    render();
  });

  clear.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!clearArmed) {
      clearArmed = true;
      clear.classList.add('armed');
      clear.title = 'Click again to clear all saved items';
      clear.setAttribute('aria-label', clear.title);
      return;
    }
    states = [];
    persistStates();
    disarmClear();
    render();
  });

  function render() {
    track.replaceChildren();
    container.replaceChildren(clear, track);
    clear.hidden = states.length === 0;
    for (const state of states) {
      const pill = document.createElement('button');
      pill.draggable=!selecting;
      pill.addEventListener('dragstart',event=>dragFile?.(event,state));
      pill.type = 'button';
      pill.tabIndex = -1;
      pill.className = 'navigator-saved-pill';
      pill.title = `Restore ${state.name}`;
      const image = document.createElement('span');
      image.className = 'workspace-navigator-crumb-art';
      art(image, state);
      const label = document.createElement('span');
      label.textContent = state.name;
      pill.append(image, label);
      decorateLabel?.(label,state);
      if(phone){
        let timer=null,origin=null;
        const cancel=()=>{win.clearTimeout(timer);timer=null;};
        pill.addEventListener('pointerdown',e=>{if(e.pointerType!=='touch')return;origin={x:e.clientX,y:e.clientY};timer=win.setTimeout(()=>{win.getSelection?.()?.removeAllRanges();selecting=true;selected.add(selectionKey(state));heldClick={key:selectionKey(state),until:Date.now()+1200};render();onSelectionChange(true);},450);});
        pill.addEventListener('pointermove',e=>{if(origin&&Math.hypot(e.clientX-origin.x,e.clientY-origin.y)>10)cancel();});
        for(const type of ['pointerup','pointercancel'])pill.addEventListener(type,cancel);
        pill.addEventListener('contextmenu',e=>{e.preventDefault();});
        if(selecting){const box=document.createElement('span');box.setAttribute('role','checkbox');box.setAttribute('aria-checked',String(selected.has(selectionKey(state))));box.className='phone-pill-check';box.textContent=selected.has(selectionKey(state))?'✓':'';pill.prepend(box);}
        pill.addEventListener('click',event=>{if(heldClick?.key===selectionKey(state)&&Date.now()<heldClick.until){heldClick=null;event.preventDefault();return;}if(selecting){event.preventDefault();selected.has(selectionKey(state))?selected.delete(selectionKey(state)):selected.add(selectionKey(state));render();onSelectionChange(true);}else restore(state,{run:false});});
      }else pill.addEventListener('click', (event) => restore(state, { run: event.shiftKey === true }));
      pill.addEventListener('mousedown', (event) => { if (event.button === 1) event.preventDefault(); });
      pill.addEventListener('auxclick', (event) => {
        if (event.button !== 1) return;
        event.preventDefault();
        event.stopPropagation();
        states = states.filter((saved) => saved !== state);
        persistStates();
        render();
      });
      track.append(pill);
    }
  }

  if(phone)document.addEventListener('click',event=>{
    if(!selecting||container.contains(event.target)||event.target.closest?.('.phone-pill-transfer,.phone-pill-transfer-clear,.phone-paste-icon'))return;
    selecting=false;selected.clear();render();onSelectionChange(false);
    event.preventDefault();event.stopImmediatePropagation();
  },true);
  // Persist removal of old duplicates so they cannot return after a reload.
  if(initialized)try {storage?.setItem(key,JSON.stringify(states));} catch {}
  render();
  if(initialized&&!Array.isArray(durableStates)&&states.length&&saveSavedStates)persistStates();
  return {
    selected:()=>states.filter(state=>selected.has(selectionKey(state))),
    async setSelectedIcon(icon){
      const next=states.map(state=>selected.has(selectionKey(state))?{...state,icon,art:state.art?{...state.art,icon}:state.art}:state);
      await saveQueue;if(saveSavedStates&&await saveSavedStates(JSON.parse(JSON.stringify(next)))!==true)throw Error('Icons could not be saved.');
      selected.clear();states=next;persistStates();render();
    },
    isSelecting:()=>selecting,
    finishSelection(){selecting=false;selected.clear();render();onSelectionChange(false);},
    async remove(state,moves=[]){
      const replace=path=>moves.find(move=>typeof path==='string'&&move.oldPath.toLowerCase()===path.toLowerCase())?.newPath||path;
      if(moves.length)state={...state,path:replace(state.path),art:state.art?{...state.art,target:replace(state.art.target)}:state.art};
      await saveQueue;
      const next=states.filter(saved=>selectionKey(saved)!==selectionKey(state));
      if(saveSavedStates&&await saveSavedStates(JSON.parse(JSON.stringify(next)))!==true)throw Error('Saved items could not be saved.');
      states=next;selected.delete(selectionKey(state));persistStates();render();
    },
    syncDurable(){
      // Construction precedes the document load. Never import a browser cache
      // into the save queue until we know whether the document owns a list.
      if(!initialized){
        if(!isReady())return;
        initialized=true;
        const loaded=loadSavedStates?.();
        durableSignature=JSON.stringify(loaded);
        installRemoteStates(Array.isArray(loaded)?loaded:decodeNavigatorSavedStates(storage?.getItem(key),resolveTarget));
        try {storage?.setItem(key,JSON.stringify(states));} catch {}
        if(!Array.isArray(loaded)&&states.length&&saveSavedStates)persistStates();
        return;
      }
      // Earlier queued acknowledgements must not replace newer local additions.
      if(pendingSaves)return;
      const next=loadSavedStates?.();
      const signature=JSON.stringify(next);
      if(Array.isArray(next)&&signature!==durableSignature){durableSignature=signature;installRemoteStates(next);}
    },
    retargetPaths(moves){
      const replace=path=>moves.find(move=>typeof path==='string'&&move.oldPath.toLowerCase()===path.toLowerCase())?.newPath||path;
      states=states.map(state=>({...state,path:replace(state.path),art:state.art?{...state.art,target:replace(state.art.target)}:state.art}));
      states=uniqueNavigatorSavedStates(states,resolveTarget);
      persistStates();render();
    },
    async add(state) {
      if (!state) return false;
      states=uniqueNavigatorSavedStates([...states,state],resolveTarget);
      const saving=persistStates();
      render();
      return await saving;
    },
    save() {
      const state = snapshot();
      if (!state) return;
      states=uniqueNavigatorSavedStates([...states,state],resolveTarget);
      persistStates();
      render();
    },
  };
}

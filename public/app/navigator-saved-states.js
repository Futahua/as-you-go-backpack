/** Saved navigation snapshots are shared UI state, separate from workspace documents. */
const MODES = new Set(['ayg', 'machine', 'action']);

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

export function createNavigatorSavedStates({ document, container, snapshot, restore, art, fromDrop, dragFile, decorateLabel, resolveTarget }) {
  const win = document.defaultView;
  const storage = win?.localStorage;
  const key = 'papers:ayg:navigator-saved-states';
  const heightKey = `${key}-height`;
  const channel = typeof win?.BroadcastChannel === 'function'
    ? new win.BroadcastChannel('papers:ayg:navigator-saved-states-v1')
    : null;
  let states = decodeNavigatorSavedStates(storage?.getItem(key),resolveTarget);
  let clearArmed = false;

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
    if (event.key === key) installRemoteStates(decodeNavigatorSavedStates(event.newValue));
    if (event.key === heightKey && event.newValue != null) applyHeight(Number(event.newValue) || 80);
  });
  if (channel) {
    channel.addEventListener('message', (event) => {
      if (event.data?.type === 'states') installRemoteStates(event.data.states);
      if (event.data?.type === 'height') applyHeight(Number(event.data.height) || 80);
    });
  }

  container.addEventListener('dragover', (event) => {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
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
      pill.draggable=true;
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
      pill.addEventListener('click', (event) => restore(state, { run: event.shiftKey === true }));
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

  // Persist removal of old duplicates so they cannot return after a reload.
  try {storage?.setItem(key,JSON.stringify(states));} catch {}
  render();
  return {
    retargetPaths(moves){
      const replace=path=>moves.find(move=>typeof path==='string'&&move.oldPath.toLowerCase()===path.toLowerCase())?.newPath||path;
      states=states.map(state=>({...state,path:replace(state.path),art:state.art?{...state.art,target:replace(state.art.target)}:state.art}));
      states=uniqueNavigatorSavedStates(states,resolveTarget);
      persistStates();render();
    },
    add(state) {
      if (!state) return;
      states=uniqueNavigatorSavedStates([...states,state],resolveTarget);
      persistStates();
      render();
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

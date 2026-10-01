const svg = (paths) => `<svg viewBox="0 0 20 20" aria-hidden="true">${paths.map((d) => `<path d="${d}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}</svg>`;
function button(doc, title, paths) {
  const b = doc.createElement('button');
  b.type = 'button'; b.className = 'navigator-icon-button'; b.title = title;
  b.setAttribute('aria-label', title); b.innerHTML = svg(paths); return b;
}
const parentPath = (value) => {
  const p = String(value || '').replace(/[\\/]+$/, '');
  const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
  return i < 3 ? p.slice(0, 3) : p.slice(0, i);
};

export function createWorkspaceNavigator(o) {
  const d = o.document, panel = d.querySelector('#workspace-navigator');
  if (!panel || !o.workspace || !o.host?.fileCapability) return Object.freeze({
    render() {},
    syncCanvasSelection() {},
    isMachineMode: () => false,
  });
  o.workspace.classList.add('navigator-docked');
  const s = {
    mode: 'ayg',
    view: 'tree',
    collapsed: false,
    expanded: new Set([o.rootId]),
    machineExpanded: new Set(),
    machineRoot: null,
    machineListings: new Map(),
    selected: null,
    path: null,
    history: [],
    hi: -1,
    aygHistory: [],
    aygHi: -1,
    aygSkipHistory: false,
    gen: 0,
    renderGen: 0,
    icons: new Map(),
    locationKey: '',
    width: 252,
  };
  try {
    const savedWidthRaw = d.defaultView?.localStorage?.getItem('papers:ayg:navigator-width');
    const savedWidth = savedWidthRaw == null ? NaN : Number(savedWidthRaw);
    if (Number.isFinite(savedWidth)) s.width = Math.max(176, Math.min(560, savedWidth));
    const savedView = d.defaultView?.localStorage?.getItem('papers:ayg:navigator-view');
    if (savedView === 'nav' || savedView === 'tree') s.view = savedView;
    s.collapsed = d.defaultView?.localStorage?.getItem('papers:ayg:navigator-collapsed') === '1';
  } catch {
    // Storage is convenience only.
  }
  const head = d.createElement('header'); head.className = 'workspace-navigator-header';
  const title = d.createElement('strong'); title.textContent = 'Navigator';
  const provider = d.createElement('span'); provider.className = 'workspace-navigator-provider';
  const viewToggle = button(d,'Switch navigation mode',['M4 5h3','M4 10h3','M4 15h3','M9 5h7','M9 10h7','M9 15h7']);
  viewToggle.classList.add('workspace-navigator-view-toggle');
  const viewLabel = d.createElement('span'); viewLabel.className = 'workspace-navigator-view-label'; viewToggle.append(viewLabel);
  const collapse = button(d,'Collapse navigator',['M12.5 4.5 7 10l5.5 5.5']); collapse.classList.add('workspace-navigator-collapse');
  head.append(title, provider, viewToggle, collapse);
  const tools = d.createElement('div'); tools.className = 'workspace-navigator-toolbar';
  const back = button(d,'Back',['M12.5 4.5 7 10l5.5 5.5']), fwd = button(d,'Forward',['M7.5 4.5 13 10l-5.5 5.5']);
  const up = button(d,'Up',['M5 11l5-5 5 5','M10 6v9']), home = button(d,'Home',['M3.5 9.5 10 4l6.5 5.5','M5.5 8.5v7h9v-7']), refresh = button(d,'Refresh',['M15.5 7A6 6 0 1 0 16 12','M15.5 7V3.5','M15.5 7H12']), copy = button(d,'Copy',['M7 7h9v9H7z','M4 13H3.5A1.5 1.5 0 0 1 2 11.5v-8A1.5 1.5 0 0 1 3.5 2h8A1.5 1.5 0 0 1 13 3.5V4']);
  const move = button(d,'Move',['M4 4l12 12','M16 4 4 16']), paste = button(d,'Paste',['M6 5h8v12H6z','M8 5V3h4v2']);
  const rename = button(d,'Rename',['M4 15h4l8-8-4-4-8 8z','M11 4l4 4']), del = button(d,'Delete',['M4 6h12','M7 6v10h6V6','M8 4h4']);
  const reveal = button(d,'Reveal',['M3 6h5l1.5 2H17v8H3z','M3 9h14']); tools.append(back,fwd,up,home,refresh,copy,move,paste,rename,del,reveal);
  const loc = d.createElement('div'); loc.className = 'workspace-navigator-location';
  const locTrack = d.createElement('div'); locTrack.className = 'workspace-navigator-location-track'; loc.append(locTrack);
  const body = d.createElement('div'); body.className = 'workspace-navigator-body';
  const resizer = d.createElement('div'); resizer.className = 'workspace-navigator-resizer'; resizer.setAttribute('role','separator'); resizer.setAttribute('aria-orientation','vertical'); resizer.setAttribute('aria-label','Resize navigator');
  panel.replaceChildren(head,tools,loc,body,resizer);
  o.workspace.style.setProperty('--workspace-navigator-width', `${s.width}px`);
  const icon = (x) => x.icon ? `<img src="${x.icon}" alt="">` : (x.kind === 'group' || x.kind === 'folder')
    ? svg(['M2.5 6h5l1.5 2h8.5v8.5h-15z']) : o.isWebLink(x)
      ? svg(['M3 10a7 7 0 1 0 14 0 7 7 0 1 0-14 0','M3.5 10h13','M10 3c2 2 2 12 0 14','M10 3c-2 2-2 12 0 14'])
      : svg(['M5 2.5h7l3 3v12H5z','M12 2.5v4h4']);
  function hydrateArt(art, item) {
    if (item.kind !== 'shortcut' || item.icon) return;
    const web = o.isWebLink(item);
    const key = web ? `web:${item.target}` : `shortcut:${item.shortcutId}`;
    let pending = s.icons.get(key);
    if (!pending) {
      pending = Promise.resolve(
        web ? o.host.resolveWebIcon(item.target) : o.host.shortcutIcon({ actionId: item.shortcutId }),
      ).then((result) => web ? result?.icon ?? null : result ?? null).catch(() => null);
      s.icons.set(key, pending);
    }
    pending.then((source) => {
      if (!source || !art.isConnected) return;
      const image = d.createElement('img');
      image.src = source;
      image.alt = '';
      art.replaceChildren(image);
    });
  }
  const machineIconTargets = new WeakMap();
  let machineIconObserver = null;
  function loadMachineArt(art, item) {
    const key = 'native:' + item.path.toLocaleLowerCase();
    let pending = s.icons.get(key);
    if (!pending) {
      pending = o.host.fileCapability('icon', { path: item.path })
        .then((result) => result?.ok ? result.icon ?? null : null)
        .catch(() => null);
      s.icons.set(key, pending);
    }
    pending.then((source) => {
      if (!source || !art.isConnected) return;
      const image = d.createElement('img');
      image.src = source;
      image.alt = '';
      art.replaceChildren(image);
    });
  }
  function hydrateMachineArt(art, item) {
    if (!machineIconObserver) {
      loadMachineArt(art, item);
      return;
    }
    machineIconTargets.set(art, item);
    machineIconObserver.observe(art);
  }
  if (typeof d.defaultView?.IntersectionObserver === 'function') {
    machineIconObserver = new d.defaultView.IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        machineIconObserver.unobserve(entry.target);
        const item = machineIconTargets.get(entry.target);
        if (item) loadMachineArt(entry.target, item);
      }
    }, { root: body, rootMargin: '96px 0px' });
  }
  function syncChrome() {
    panel.dataset.mode = s.mode;
    panel.dataset.view = s.view;
    provider.textContent = s.mode === 'machine' ? 'Opus' : 'As you Go';
    viewLabel.textContent = s.view === 'tree' ? 'Tree' : 'Nav';
    viewToggle.title = s.view === 'tree' ? 'Switch to navigation mode' : 'Switch to tree mode';
    viewToggle.setAttribute('aria-label', viewToggle.title);
    panel.classList.toggle('collapsed', s.collapsed);
    o.workspace.classList.toggle('navigator-collapsed', s.collapsed);
    collapse.title = s.collapsed ? 'Expand navigator' : 'Collapse navigator';
    collapse.setAttribute('aria-label', collapse.title);
    collapse.innerHTML = s.collapsed
      ? svg(['M7.5 4.5 13 10l-5.5 5.5'])
      : svg(['M12.5 4.5 7 10l5.5 5.5']);
    const nav = s.view === 'nav';
    back.hidden = fwd.hidden = up.hidden = home.hidden = !nav;
    reveal.hidden = s.mode !== 'machine';
    paste.hidden = s.mode === 'machine';
  }
  function setMode(mode) {
    s.mode = mode;
    syncChrome();
    render();
  }
  function setView(view, renderNow = true) {
    s.view = view === 'nav' ? 'nav' : 'tree';
    persistUi('papers:ayg:navigator-view', s.view);
    syncChrome();
    if (renderNow) render();
  }
  function persistUi(key, value) {
    try { d.defaultView?.localStorage?.setItem(key, String(value)); } catch { /* optional */ }
  }
  function setLocation(segments) {
    const key = segments.map((segment) => segment.key || segment.label).join('\u0000');
    locTrack.replaceChildren();
    segments.forEach((segment, index) => {
      if (index > 0) {
        const separator = d.createElement('span');
        separator.className = 'workspace-navigator-location-separator';
        separator.textContent = '›';
        locTrack.append(separator);
      }
      const crumb = d.createElement('button');
      crumb.type = 'button';
      crumb.className = 'workspace-navigator-crumb';
      crumb.textContent = segment.label;
      crumb.title = segment.title || segment.label;
      if (segment.activate) crumb.addEventListener('click', segment.activate);
      else crumb.disabled = true;
      locTrack.append(crumb);
    });
    if (key !== s.locationKey) {
      s.locationKey = key;
      d.defaultView?.requestAnimationFrame?.(() => { loc.scrollLeft = loc.scrollWidth; });
    }
  }
  loc.addEventListener('wheel', (event) => {
    if (loc.scrollWidth <= loc.clientWidth) return;
    const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? -event.deltaY : event.deltaX;
    if (!delta) return;
    event.preventDefault();
    loc.scrollBy({ left: delta, behavior: 'smooth' });
  }, { passive: false });
  const visibleIds=()=>[...body.querySelectorAll('[data-id]')].map((n)=>n.dataset.id).filter(Boolean);
  const currentAyG=()=>o.getSession().currentId||o.rootId;
  function navigateAyG(id,record=true){if(!record)s.aygSkipHistory=true;o.navigateAyG(id);}
  function aygCrumbs(){
    const groups=o.getState().groups||[],out=[];let id=currentAyG();
    while(id&&id!==o.rootId){const g=groups.find((x)=>x.id===id);if(!g)break;out.unshift({id:g.id,name:g.name});id=g.parentId;}
    return [{id:o.rootId,name:'As you Go'},...out];
  }
  async function enterAyG(x){
    if(x.kind==='group'){
      const nextView=s.view==='tree'?'nav':'tree';
      if(nextView==='tree'){
        let cursor=x;
        while(cursor&&cursor.id!==o.rootId){
          s.expanded.add(cursor.id);
          cursor=(o.getState().groups||[]).find((candidate)=>candidate.id===cursor.parentId);
        }
      }
      setView(nextView,false);
      navigateAyG(x.id);
      return;
    }
    if(!o.isWebLink(x)&&o.isAbsoluteWindowsPath(x.target)){
      const stat=await o.host.fileCapability('stat',{path:x.target}).catch(()=>null);
      if(stat?.ok&&stat.entry?.kind==='folder'){await enterMachine(x.target,true);return;}
    }
    await o.activateAyG(x.shortcutId||x.id);render();
  }
  function aygChildren(parent, depth = 0) {
    const f = d.createDocumentFragment();
    for (const x of o.itemsIn(o.getState(), parent).filter((v) => v.kind !== 'window-layout')) {
      const id = x.id, row = d.createElement('div');
      row.className = 'workspace-navigator-row'; row.dataset.id = id; row.style.paddingLeft = `${4 + depth * 13}px`; row.classList.toggle('selected', o.getSession().selected.has(id));
      if (x.kind === 'group' && s.view === 'tree') {
        const t = d.createElement('button'); t.type='button'; t.className='navigator-tree-toggle'; t.textContent=s.expanded.has(x.id)?'▾':'▸';
        t.addEventListener('click',(e)=>{e.stopPropagation(); s.expanded.has(x.id)?s.expanded.delete(x.id):s.expanded.add(x.id); render();}); row.append(t);
      } else { const sp=d.createElement('span'); sp.className='navigator-tree-spacer'; row.append(sp); }
      const art=d.createElement('span'); art.className='workspace-navigator-art'; art.innerHTML=icon(x);
      hydrateArt(art, x);
      const label=d.createElement('span'); label.className='workspace-navigator-label'; label.textContent=x.name||'Untitled'; row.append(art,label);
      row.addEventListener('click',(e)=>{if(e.shiftKey&&!e.ctrlKey){e.preventDefault();void enterAyG(x);return;}o.selectAyG(id,visibleIds(),{ctrlKey:e.ctrlKey});});
      row.addEventListener('contextmenu',(e)=>{
        if(!e.shiftKey||x.kind!=='group')return;
        e.preventDefault();e.stopPropagation();
        if(s.view==='nav'){
          let cursor=x;
          while(cursor&&cursor.id!==o.rootId){
            const parent=(o.getState().groups||[]).find((candidate)=>candidate.id===cursor.parentId);
            if(parent)s.expanded.add(parent.id);
            cursor=parent;
          }
          setView('tree',false);
        }
        s.expanded.has(x.id)?s.expanded.delete(x.id):s.expanded.add(x.id);
        render();
      });
      f.append(row); if (s.view==='tree'&&x.kind==='group'&&s.expanded.has(x.id)) f.append(aygChildren(x.id,depth+1));
    } return f;
  }
  function renderAyG() {
    if(s.view==='tree'){
      setLocation([{key:'ayg-root',label:'As you Go'}]);
      body.replaceChildren(aygChildren(o.rootId));
    }
    else{
      const current=currentAyG();
      if(s.aygSkipHistory)s.aygSkipHistory=false;else if(s.aygHistory[s.aygHi]!==current){s.aygHistory=s.aygHistory.slice(0,s.aygHi+1);s.aygHistory.push(current);s.aygHi=s.aygHistory.length-1;}
      setLocation(aygCrumbs().map((crumb)=>({
        key:crumb.id,
        label:crumb.name,
        activate:()=>navigateAyG(crumb.id),
      })));
      body.replaceChildren(aygChildren(current));
    }
    back.disabled=s.view!=='nav'||s.aygHi<=0;
    fwd.disabled=s.view!=='nav'||s.aygHi>=s.aygHistory.length-1;
    up.disabled=s.view!=='nav'||currentAyG()===o.rootId;
    home.disabled=s.view!=='nav'||currentAyG()===o.rootId;
    if (!body.childElementCount) body.innerHTML = '<p class="workspace-navigator-empty">Workspace is empty.</p>';
  }
  async function machineList(path, force = false) {
    const key = path.toLocaleLowerCase();
    if (!force && s.machineListings.has(key)) return s.machineListings.get(key);
    const pending = o.host.fileCapability('list', { path, limit: 500 })
      .catch((e) => ({ ok: false, message: String(e), items: [] }));
    s.machineListings.set(key, pending);
    return pending;
  }
  async function toggleMachine(path) {
    if (s.machineExpanded.has(path)) s.machineExpanded.delete(path);
    else { s.machineExpanded.add(path); await machineList(path); }
    render();
  }
  async function revealMachinePathInTree(path) {
    const root=s.machineRoot;
    if(!root)return;
    s.machineExpanded.add(root);
    let cursor=root.replace(/[\\/]+$/,'');
    const relative=path.slice(root.length).split(/[\\/]+/).filter(Boolean);
    for(const part of relative){
      cursor+='\\'+part;
      s.machineExpanded.add(cursor);
      await machineList(cursor);
    }
    s.path=path;
  }
  function machineRow(x, depth = 0) {
    const row=d.createElement('div'); row.className='workspace-navigator-row machine-row'; row.style.paddingLeft=`${4+depth*13}px`; row.classList.toggle('selected',s.selected?.path===x.path);
    const folder=x.kind==='folder', lead=d.createElement(folder&&s.view==='tree'?'button':'span'); lead.className=folder&&s.view==='tree'?'navigator-tree-toggle':'navigator-tree-spacer';
    if(folder&&s.view==='tree'){lead.type='button';lead.textContent=s.machineExpanded.has(x.path)?'▾':'▸';lead.addEventListener('click',(e)=>{e.stopPropagation();void toggleMachine(x.path);});}
    const art=d.createElement('span'); art.className='workspace-navigator-art'; art.innerHTML=icon(x); hydrateMachineArt(art,x);
    const label=d.createElement('span'); label.className='workspace-navigator-label'; label.textContent=x.name; row.append(lead,art,label);
    row.addEventListener('click',(e)=>{
      if(e.shiftKey&&!e.ctrlKey){
        e.preventDefault();
        if(folder){
          const nextView=s.view==='tree'?'nav':'tree';
          setView(nextView,false);
          if(nextView==='nav')void loadMachine(x.path,true);
          else void revealMachinePathInTree(x.path).then(()=>render());
        }else{
          void o.host.fileCapability('open',{path:x.path});
        }
        return;
      }
      s.selected=x;o.clearCanvasForMachine();o.previewMachinePath(x.path,x.name);render();
    });
    row.addEventListener('contextmenu',(e)=>{
      if(!e.shiftKey||!folder)return;
      e.preventDefault();e.stopPropagation();
      if(s.view==='nav'){
        let ancestor=parentPath(x.path), root=s.machineRoot?.toLocaleLowerCase();
        while(ancestor&&root&&ancestor.toLocaleLowerCase().startsWith(root)){s.machineExpanded.add(ancestor);if(ancestor.toLocaleLowerCase()===root)break;const next=parentPath(ancestor);if(!next||next===ancestor)break;ancestor=next;}
        setView('tree',false);
      }
      void toggleMachine(x.path);
    });
    return row;
  }
  async function machineTree(path, depth, generation) {
    const fragment=d.createDocumentFragment(), result=await machineList(path);
    if(generation!==s.renderGen||s.mode!=='machine'||s.view!=='tree'||!result?.ok)return fragment;
    for(const x of result.items||[]){fragment.append(machineRow(x,depth));if(x.kind==='folder'&&s.machineExpanded.has(x.path))fragment.append(await machineTree(x.path,depth+1,generation));}
    return fragment;
  }
  async function renderMachineTree() {
    const generation=++s.renderGen, root=s.machineRoot; if(!root)return;
    setLocation([{key:root.toLocaleLowerCase(),label:root,title:root}]);
    const fragment=d.createDocumentFragment(); fragment.append(machineRow({path:root,name:root,kind:'folder'}));
    if(s.machineExpanded.has(root))fragment.append(await machineTree(root,1,generation));
    if(generation===s.renderGen&&s.mode==='machine'&&s.view==='tree')body.replaceChildren(fragment);
  }
  function renderMachineCrumbs(path) {
    const root=s.machineRoot, entries=[{path:root,name:root}];
    if(path!==root){
      let cursor=root.replace(/[\\/]+$/,'');
      for(const part of path.slice(root.length).split(/[\\/]+/).filter(Boolean)){cursor+='\\'+part;entries.push({path:cursor,name:part});}
    }
    setLocation(entries.map((entry)=>({
      key:entry.path.toLocaleLowerCase(),
      label:entry.name,
      title:entry.path,
      activate:()=>void loadMachine(entry.path,true),
    })));
  }
  async function loadMachine(path, push = true) {
    s.path = path;
    if (push && s.history[s.hi]?.toLocaleLowerCase() !== path.toLocaleLowerCase()) {
      s.history = s.history.slice(0, s.hi + 1);
      s.history.push(path);
      s.hi = s.history.length - 1;
    }
    if (s.view !== 'nav' || s.mode !== 'machine') return;
    const gen = ++s.renderGen; renderMachineCrumbs(path);
    body.innerHTML = '<p class="workspace-navigator-empty">Loading…</p>';
    const result = await machineList(path);
    if (gen !== s.renderGen || s.mode !== 'machine' || s.view !== 'nav' || s.path !== path) return;
    if (!result?.ok) { body.innerHTML = `<p class="workspace-navigator-empty">${result?.message || 'Could not list this folder.'}</p>`; return; }
    back.disabled=s.hi<=0; fwd.disabled=s.hi>=s.history.length-1; up.disabled=parentPath(path).toLowerCase()===path.toLowerCase();
    body.replaceChildren();
    for (const x of (result.items || [])) {
      body.append(machineRow(x));
    }
    if (!body.childElementCount) body.innerHTML='<p class="workspace-navigator-empty">This folder is empty.</p>';
  }
  async function enterMachine(path, fromGesture = false) {
    const changed = !s.machineRoot || s.machineRoot.toLocaleLowerCase() !== path.toLocaleLowerCase();
    if (changed) {
      s.machineRoot = path; s.path = path; s.selected = null;
      s.history = [path]; s.hi = 0;
      s.machineExpanded = new Set([path]);
      s.machineListings.clear();
    }
    s.mode = 'machine';
    if (fromGesture) setView(s.view==='tree'?'nav':'tree', false);
    syncChrome();
    if (s.view === 'nav') await loadMachine(path, false);
    else render();
  }
  async function syncCanvasSelection(selection) {
    if (selection?.mode === 'empty' && selection.selectionCount === 0) {
      if (s.mode === 'ayg') render();
      return;
    }
    const gen=++s.gen, path=selection?.mode==='single'?selection.item?.path:null;
    if (!path || !o.isAbsoluteWindowsPath(path)) { if(s.mode!=='ayg') setMode('ayg'); else render(); return; }
    const result=await o.host.fileCapability('stat',{path}).catch(()=>null); if(gen!==s.gen) return;
    if(result?.ok && result.entry?.kind==='folder') return enterMachine(path, false);
    if(s.mode!=='ayg') setMode('ayg'); else render();
  }
  const destination=()=>{const ids=[...o.getSession().selected]; return ids.length===1&&o.getState().groups.some((g)=>g.id===ids[0])?ids[0]:(o.getSession().currentId||o.rootId);};
  viewToggle.addEventListener('click',()=>setView(s.view==='tree'?'nav':'tree'));
  collapse.addEventListener('click',()=>{
    s.collapsed=!s.collapsed;
    persistUi('papers:ayg:navigator-collapsed',s.collapsed?'1':'0');
    render();
  });
  resizer.addEventListener('pointerdown',(e)=>{if(e.button!==0||s.collapsed)return;resizer.setPointerCapture?.(e.pointerId);panel.classList.add('resizing');e.preventDefault();});
  resizer.addEventListener('pointermove',(e)=>{
    if(!resizer.hasPointerCapture?.(e.pointerId)||s.collapsed)return;
    const width=Math.max(176,Math.min(d.defaultView.innerWidth*.55,e.clientX-panel.getBoundingClientRect().left));
    s.width=Math.round(width);
    o.workspace.style.setProperty('--workspace-navigator-width',s.width+'px');
    e.preventDefault();
  });
  const finishResize=(e)=>{
    if(!resizer.hasPointerCapture?.(e.pointerId))return;
    resizer.releasePointerCapture?.(e.pointerId);
    panel.classList.remove('resizing');
    persistUi('papers:ayg:navigator-width',s.width);
  };
  resizer.addEventListener('pointerup',finishResize);resizer.addEventListener('pointercancel',finishResize);
  back.addEventListener('click',()=>{
    if(s.mode==='ayg'){if(s.aygHi<=0)return;s.aygHi--;navigateAyG(s.aygHistory[s.aygHi],false);return;}
    if(s.hi>0){s.hi--;void loadMachine(s.history[s.hi],false);}
  });
  fwd.addEventListener('click',()=>{
    if(s.mode==='ayg'){if(s.aygHi>=s.aygHistory.length-1)return;s.aygHi++;navigateAyG(s.aygHistory[s.aygHi],false);return;}
    if(s.hi<s.history.length-1){s.hi++;void loadMachine(s.history[s.hi],false);}
  });
  up.addEventListener('click',()=>{
    if(s.mode==='ayg'){const g=o.getState().groups.find((x)=>x.id===currentAyG());navigateAyG(g?.parentId||o.rootId);return;}
    const p=parentPath(s.path);if(p&&p.toLocaleLowerCase().startsWith(s.machineRoot.toLocaleLowerCase()))void loadMachine(p,true);
  });
  home.addEventListener('click',()=>{if(s.mode==='ayg')navigateAyG(o.rootId);else if(s.machineRoot)void loadMachine(s.machineRoot,true);});
  refresh.addEventListener('click',()=>{if(s.mode==='machine'&&s.path)s.machineListings.delete(s.path.toLocaleLowerCase());render();});
  copy.addEventListener('click',async()=>{if(s.mode==='ayg')return o.copyAyG();if(!s.selected)return;const p=await o.host.pickTarget('folder').catch(()=>null),dst=typeof p==='string'?p:p?.path||p?.target;if(dst){const r=await o.host.fileCapability('copy',{paths:[s.selected.path],destination:dst});if(!r?.ok){o.setStatus(r?.message||'Copy failed.');return;}s.machineListings.clear();render();}});
  move.addEventListener('click',async()=>{if(s.mode==='ayg')return o.cutAyG();if(!s.selected)return;const p=await o.host.pickTarget('folder').catch(()=>null),dst=typeof p==='string'?p:p?.path||p?.target;if(dst){const r=await o.host.fileCapability('move',{paths:[s.selected.path],destination:dst});if(!r?.ok){o.setStatus(r?.message||'Move failed.');return;}s.selected=null;s.machineListings.clear();render();}});
  paste.addEventListener('click',()=>o.pasteAyG(destination()));
  rename.addEventListener('click',async()=>{if(s.mode==='ayg')return o.renameAyG();if(!s.selected)return;const n=d.defaultView?.prompt('Rename',s.selected.name)?.trim();if(n&&n!==s.selected.name){const r=await o.host.fileCapability('rename',{path:s.selected.path,newName:n});if(!r?.ok){o.setStatus(r?.message||'Rename failed.');return;}s.selected=null;s.machineListings.clear();render();}});
  del.addEventListener('click',async()=>{if(s.mode==='ayg')return o.deleteAyG();if(!s.selected||!d.defaultView?.confirm(`Move "${s.selected.name}" to Recycle Bin?`))return;const r=await o.host.fileCapability('delete',{paths:[s.selected.path]});if(!r?.ok){o.setStatus(r?.message||'Delete failed.');return;}s.selected=null;s.machineListings.clear();render();});
  reveal.addEventListener('click',()=>{const p=s.selected?.path||s.path;if(p)void o.host.fileCapability('reveal',{path:p});});
  function render(){
    syncChrome();
    if (s.collapsed) return;
    if(s.mode==='ayg')renderAyG();
    else if(s.view==='tree')void renderMachineTree();
    else if(s.path)void loadMachine(s.path,false);
  }
  syncChrome(); render();
  return Object.freeze({
    render,
    syncCanvasSelection,
    isMachineMode: () => s.mode === 'machine',
  });
}
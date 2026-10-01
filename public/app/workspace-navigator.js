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
  if (!panel || !o.workspace || !o.host?.fileCapability) return Object.freeze({ render() {}, syncCanvasSelection() {} });
  o.workspace.classList.add('navigator-docked');
  const s = { mode: 'ayg', expanded: new Set([o.rootId]), selected: null, path: null, history: [], hi: -1, gen: 0, ignore: false, icons: new Map() };
  const head = d.createElement('header'); head.className = 'workspace-navigator-header';
  const title = d.createElement('strong'); title.textContent = 'Navigator';
  const provider = d.createElement('span'); provider.className = 'workspace-navigator-provider'; head.append(title, provider);
  const tools = d.createElement('div'); tools.className = 'workspace-navigator-toolbar';
  const back = button(d,'Back',['M12.5 4.5 7 10l5.5 5.5']), fwd = button(d,'Forward',['M7.5 4.5 13 10l-5.5 5.5']);
  const up = button(d,'Up',['M5 11l5-5 5 5','M10 6v9']), copy = button(d,'Copy',['M7 7h9v9H7z','M4 13H3.5A1.5 1.5 0 0 1 2 11.5v-8A1.5 1.5 0 0 1 3.5 2h8A1.5 1.5 0 0 1 13 3.5V4']);
  const move = button(d,'Move',['M4 4l12 12','M16 4 4 16']), paste = button(d,'Paste',['M6 5h8v12H6z','M8 5V3h4v2']);
  const rename = button(d,'Rename',['M4 15h4l8-8-4-4-8 8z','M11 4l4 4']), del = button(d,'Delete',['M4 6h12','M7 6v10h6V6','M8 4h4']);
  const reveal = button(d,'Reveal',['M3 6h5l1.5 2H17v8H3z','M3 9h14']); tools.append(back,fwd,up,copy,move,paste,rename,del,reveal);
  const loc = d.createElement('div'); loc.className = 'workspace-navigator-location';
  const body = d.createElement('div'); body.className = 'workspace-navigator-body'; panel.replaceChildren(head,tools,loc,body);
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
  function setMode(mode) {
    s.mode = mode; panel.dataset.mode = mode; provider.textContent = mode === 'machine' ? 'Machine · Opus' : 'As you Go';
    back.hidden = fwd.hidden = up.hidden = reveal.hidden = mode !== 'machine'; paste.hidden = mode === 'machine'; render();
  }
  function aygChildren(parent, depth = 0) {
    const f = d.createDocumentFragment();
    for (const x of o.itemsIn(o.getState(), parent).filter((v) => v.kind !== 'window-layout')) {
      const id = x.kind === 'shortcut' ? x.shortcutId : x.id, row = d.createElement('div');
      row.className = 'workspace-navigator-row'; row.dataset.id = id; row.style.paddingLeft = `${4 + depth * 13}px`; row.classList.toggle('selected', o.getSession().selected.has(id));
      if (x.kind === 'group') {
        const t = d.createElement('button'); t.type='button'; t.className='navigator-tree-toggle'; t.textContent=s.expanded.has(x.id)?'▾':'▸';
        t.addEventListener('click',(e)=>{e.stopPropagation(); s.expanded.has(x.id)?s.expanded.delete(x.id):s.expanded.add(x.id); render();}); row.append(t);
      } else { const sp=d.createElement('span'); sp.className='navigator-tree-spacer'; row.append(sp); }
      const art=d.createElement('span'); art.className='workspace-navigator-art'; art.innerHTML=icon(x);
      hydrateArt(art, x);
      const label=d.createElement('span'); label.className='workspace-navigator-label'; label.textContent=x.name||'Untitled'; row.append(art,label);
      row.addEventListener('click',()=>o.selectAyG(id,[...body.querySelectorAll('[data-id]')].map((n)=>n.dataset.id)));
      row.addEventListener('dblclick',()=>x.kind==='group'?(s.expanded.has(x.id)?s.expanded.delete(x.id):s.expanded.add(x.id),render()):o.activateAyG(id));
      f.append(row); if (x.kind==='group' && s.expanded.has(x.id)) f.append(aygChildren(x.id,depth+1));
    } return f;
  }
  function renderAyG() {
    loc.textContent = 'As you Go workspace';
    body.replaceChildren(aygChildren(o.rootId));
    if (!body.childElementCount) body.innerHTML = '<p class="workspace-navigator-empty">Workspace is empty.</p>';
  }
  async function loadMachine(path, push = true) {
    const gen = ++s.gen; s.path = path; loc.textContent = path;
    body.innerHTML = '<p class="workspace-navigator-empty">Loading…</p>';
    const result = await o.host.fileCapability('list', { path, limit: 500 }).catch((e)=>({ok:false,message:String(e)}));
    if (gen !== s.gen || s.mode !== 'machine') return;
    if (!result?.ok) { body.innerHTML = `<p class="workspace-navigator-empty">${result?.message || 'Could not list this folder.'}</p>`; return; }
    if (push) { s.history = s.history.slice(0,s.hi+1); s.history.push(path); s.hi=s.history.length-1; }
    back.disabled=s.hi<=0; fwd.disabled=s.hi>=s.history.length-1; up.disabled=parentPath(path).toLowerCase()===path.toLowerCase();
    body.replaceChildren();
    for (const x of (result.items || [])) {
      const row=d.createElement('div'); row.className='workspace-navigator-row machine-row'; row.classList.toggle('selected',s.selected?.path===x.path);
      row.innerHTML='<span class="navigator-tree-spacer"></span>';
      const art=d.createElement('span'); art.className='workspace-navigator-art'; art.innerHTML=icon(x);
      const label=d.createElement('span'); label.className='workspace-navigator-label'; label.textContent=x.name; row.append(art,label);
      row.addEventListener('click',()=>{ s.selected=x; s.ignore=true; o.clearCanvasForMachine(); o.previewMachinePath(x.path,x.name); render(); });
      row.addEventListener('dblclick',()=>{ if(x.kind==='folder') void loadMachine(x.path,true); });
      body.append(row);
    }
    if (!body.childElementCount) body.innerHTML='<p class="workspace-navigator-empty">This folder is empty.</p>';
  }
  async function enterMachine(path) { s.selected=null; s.history=[]; s.hi=-1; setMode('machine'); await loadMachine(path,true); }
  async function syncCanvasSelection(selection) {
    if (s.ignore) { s.ignore=false; return; }
    const gen=++s.gen, path=selection?.mode==='single'?selection.item?.path:null;
    if (!path || !o.isAbsoluteWindowsPath(path)) { if(s.mode!=='ayg') setMode('ayg'); else render(); return; }
    const result=await o.host.fileCapability('stat',{path}).catch(()=>null); if(gen!==s.gen) return;
    if(result?.ok && result.entry?.kind==='folder') return enterMachine(path);
    if(s.mode!=='ayg') setMode('ayg'); else render();
  }
  const destination=()=>{const ids=[...o.getSession().selected]; return ids.length===1&&o.getState().groups.some((g)=>g.id===ids[0])?ids[0]:(o.getSession().currentId||o.rootId);};
  back.addEventListener('click',()=>{if(s.hi>0){s.hi--;void loadMachine(s.history[s.hi],false);}});
  fwd.addEventListener('click',()=>{if(s.hi<s.history.length-1){s.hi++;void loadMachine(s.history[s.hi],false);}});
  up.addEventListener('click',()=>{const p=parentPath(s.path);if(p)void loadMachine(p,true);});
  copy.addEventListener('click',async()=>{if(s.mode==='ayg')return o.copyAyG();if(!s.selected)return;const p=await o.host.pickTarget('folder').catch(()=>null),dst=typeof p==='string'?p:p?.path||p?.target;if(dst)await o.host.fileCapability('copy',{paths:[s.selected.path],destination:dst});});
  move.addEventListener('click',async()=>{if(s.mode==='ayg')return o.cutAyG();if(!s.selected)return;const p=await o.host.pickTarget('folder').catch(()=>null),dst=typeof p==='string'?p:p?.path||p?.target;if(dst){const r=await o.host.fileCapability('move',{paths:[s.selected.path],destination:dst});if(!r?.ok)o.setStatus(r?.message||'Move failed.');s.selected=null;await loadMachine(s.path,false);}});
  paste.addEventListener('click',()=>o.pasteAyG(destination()));
  rename.addEventListener('click',async()=>{if(s.mode==='ayg')return o.renameAyG();if(!s.selected)return;const n=d.defaultView?.prompt('Rename',s.selected.name)?.trim();if(n&&n!==s.selected.name){const r=await o.host.fileCapability('rename',{path:s.selected.path,newName:n});if(!r?.ok)o.setStatus(r?.message||'Rename failed.');s.selected=null;await loadMachine(s.path,false);}});
  del.addEventListener('click',async()=>{if(s.mode==='ayg')return o.deleteAyG();if(!s.selected||!d.defaultView?.confirm(`Move "${s.selected.name}" to Recycle Bin?`))return;const r=await o.host.fileCapability('delete',{paths:[s.selected.path]});if(!r?.ok)o.setStatus(r?.message||'Delete failed.');s.selected=null;await loadMachine(s.path,false);});
  reveal.addEventListener('click',()=>{const p=s.selected?.path||s.path;if(p)void o.host.fileCapability('reveal',{path:p});});
  function render(){if(s.mode==='ayg')renderAyG();else if(s.path)void loadMachine(s.path,false);}
  setMode('ayg');
  return Object.freeze({render,syncCanvasSelection});
}
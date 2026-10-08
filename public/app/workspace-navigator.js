import { bindNavigatorRowInteractions } from './navigator-row-interactions.js';
import { moveNavigatorFiles, retryNavigatorFileLinks, navigatorFileMoveAllowed } from './navigator-file-transfer.js';
const svg = (paths) => `<svg viewBox="0 0 20 20" aria-hidden="true">${paths.map((d) => `<path d="${d}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}</svg>`;
import { createBreadcrumbPopup } from './navigator-breadcrumb-popup.js';
import { createNavigatorSavedStates, navigatorDropEffect } from './navigator-saved-states.js';
export { navigatorDropEffect } from './navigator-saved-states.js';
import { assignSpatialFolderHues, FOLDER_DISTANCE } from '../graph-model-20260730b.js';
export function navigatorBranchHues(branches, colors = new Map()) {
 const nodes=branches.map(b=>({...b,x:b.depth*13,y:b.start*34})),pairs=[];
 for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){const a=nodes[i],b=nodes[j],gap=Math.max(0,a.start-b.end,b.start-a.end)*34;if(Math.hypot(a.x-b.x,gap)<FOLDER_DISTANCE)pairs.push([a,b]);}
 assignSpatialFolderHues(nodes,colors,{cx:0,cy:0},new Map(),null,pairs);return colors;
}
export function navigatorFolderPill(saved,groups){if(saved?.mode!=='action'||!saved.quickRunKey?.startsWith('folder:'))return saved;const id=saved.quickRunKey.slice(7);return groups.some(g=>g.id===id&&!g.bin)?{...saved,mode:'ayg',currentId:id,view:'nav'}:saved;}

export const NAVIGATOR_AYG_DRAG_TYPE = 'application/x-papers-ayg-navigator-items';
export const NAVIGATOR_MACHINE_DRAG_TYPE = 'application/x-papers-machine-navigator-items';
export async function searchNavigatorFiles({search,query,isCurrent=()=>true,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}) {
  for(let attempt=0;attempt<3;attempt++){
    if(!isCurrent())return null;
    const result=await search(query).catch(error=>({ok:false,message:error instanceof Error?error.message:String(error),results:[]}));
    if(!isCurrent())return null;
    if(result.ok||attempt===2||!String(result.message||result.error||'').includes('Everything IPC query failed (2)'))return result;
    await wait(350*(attempt+1));
  }
}
const NATIVE_DRAG_SOURCE_TTL_MS = 30_000;
function button(doc, title, paths) {
  const b = doc.createElement('button');
  b.type = 'button'; b.className = 'navigator-icon-button'; b.title = title;
  b.setAttribute('aria-label', title); b.innerHTML = svg(paths); return b;
}
const parentPath = (value) => {
  const p = String(value || '').replace(/\//g, '\\').replace(/\\+$/, '');
  const unc = p.match(/^\\\\([^\\]+)\\([^\\]+)(?:\\.*)?$/);
  if (unc) {
    const shareRoot = `\\\\${unc[1]}\\${unc[2]}`;
    if (p.toLocaleLowerCase() === shareRoot.toLocaleLowerCase()) return shareRoot;
    const i = p.lastIndexOf('\\');
    return i < shareRoot.length ? shareRoot : p.slice(0, i);
  }
  const drive = p.match(/^[A-Za-z]:/);
  if (drive) {
    const driveRoot = `${drive[0]}\\`;
    if (p.length <= driveRoot.length) return driveRoot;
    const i = p.lastIndexOf('\\');
    return i < driveRoot.length ? driveRoot : p.slice(0, i);
  }
  const i = p.lastIndexOf('\\');
  return i <= 0 ? p : p.slice(0, i);
};

export function beginNavigatorNativeDrag({ event, paths, host }) {
  const unique = [...new Set((paths || []).filter((path) => typeof path === 'string' && path))];
  if (!event?.dataTransfer || unique.length === 0) return false;

  // Electron's native file-drag handoff replaces Chromium's HTML5 drag.
  // If both are left alive, two drag loops overlap and can strand the Chromium
  // drag image or tear down the renderer. Cancel the browser drag first.
  event.preventDefault();
  try {
    void Promise.resolve(host?.fileCapability?.('native-drag', { paths: unique })).catch(() => {});
  } catch {
    // The cancelled HTML5 drag stays cancelled if the host seam is unavailable.
  }
  return true;
}

export function navigatorCapturedDropPaths(source, files, now=Date.now()) {
  if(!source||!Number.isFinite(source.startedAt)||now-source.startedAt>NATIVE_DRAG_SOURCE_TTL_MS)return [];
  const paths=uniquePaths(source.paths);
  const names=files.map(file=>file?.name?.toLowerCase()).filter(Boolean).sort();
  const expected=paths.map(path=>path.split(/[\\/]/).pop().toLowerCase()).sort();
  return names.length===expected.length&&names.length>0&&names.every((name,i)=>name===expected[i])?paths:[];
}

export async function navigatorResolveDropPaths(source, files, resolve) {
  const captured=navigatorCapturedDropPaths(source,files);
  return captured.length?captured:await resolve(files);
}

// Electron startDrag advertises copyLink on Windows. The negotiated cursor
// effect must be allowed by the source or Chromium cancels before firing drop.
// The navigator's move plan, not this transport effect, owns the file operation.

export async function navigatorNewFolderDestination({mode,selected,currentId,path,rootId,stat,isAbsoluteWindowsPath}) {
  if(mode==='machine')return {mode:'machine',parent:selected?.kind==='folder'?selected.path:selected?.path?parentPath(selected.path):path};
  if(selected?.kind==='group')return {mode:'ayg',parent:selected.id};
  if(selected?.target&&isAbsoluteWindowsPath(selected.target)){
    const result=await stat(selected.target);
    if(!result?.ok)throw Error(result?.message||'Selected target is unavailable.');
    if(result.entry?.kind==='folder')return {mode:'machine',parent:selected.target};
  }
  return {mode:'ayg',parent:selected?.parentId||currentId||rootId};
}

export function aygNavigatorNativePaths({ itemId, selectedIds, resolvePaths }) {
  if (typeof itemId !== 'string' || typeof resolvePaths !== 'function') return [];
  const selected = selectedIds instanceof Set ? selectedIds : new Set(selectedIds || []);
  return resolvePaths(selected.has(itemId) ? [...selected] : [itemId]);
}

export function navigatorDragItemIds(itemId, selectedIds) {
  if (typeof itemId !== 'string' || !itemId) return [];
  const selected = selectedIds instanceof Set ? selectedIds : new Set(selectedIds || []);
  return selected.has(itemId) ? [...selected] : [itemId];
}

export function navigatorAyGDragPayload({ itemId, selectedIds, resolveIdentity }) {
  const sourceIds = navigatorDragItemIds(itemId, selectedIds);
  const itemIds = [];
  const placementIds = [];
  for (const sourceId of sourceIds) {
    const identity = typeof resolveIdentity === 'function'
      ? resolveIdentity(sourceId)
      : { itemId: sourceId, placementId: null };
    const canonicalId = identity?.itemId;
    if (typeof canonicalId !== 'string' || !canonicalId) continue;
    if (!itemIds.includes(canonicalId)) itemIds.push(canonicalId);
    const placementId = identity?.placementId;
    if (typeof placementId === 'string' && placementId) placementIds.push([canonicalId, placementId]);
  }
  return { itemIds, placementIds };
}

function normalizePlacementPairs(pairs, itemIds) {
  const allowed = new Set(itemIds);
  const byItem = new Map();
  for (const pair of pairs || []) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    const [itemId, placementId] = pair;
    if (!allowed.has(itemId) || typeof placementId !== 'string' || !placementId) continue;
    byItem.set(itemId, placementId);
  }
  return [...byItem.entries()];
}

function uniquePaths(paths) {
  const seen = new Set();
  const out = [];
  for (const value of paths || []) {
    if (typeof value !== 'string' || !value) continue;
    const key = value.replace(/\//g, '\\').toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

export function navigatorSelectedPaths({ mode, selected, selectedIds, resolvePaths }) {
  if (mode === 'machine') return uniquePaths(selected?.path ? [selected.path] : []);
  if (typeof resolvePaths !== 'function') return [];
  return uniquePaths(resolvePaths([...(selectedIds || [])]));
}

export function navigatorNativeDragSourceMatches(source, droppedPaths, now = Date.now()) {
  if (!source || !Number.isFinite(source.startedAt) || now - source.startedAt > NATIVE_DRAG_SOURCE_TTL_MS) return false;
  const expected = uniquePaths(source.paths).map((path) => path.replace(/\//g, '\\').toLocaleLowerCase()).sort();
  const actual = uniquePaths(droppedPaths).map((path) => path.replace(/\//g, '\\').toLocaleLowerCase()).sort();
  return expected.length > 0 && expected.length === actual.length && expected.every((path, index) => path === actual[index]);
}

export function navigatorBreadcrumbMovePlan({
  segment,
  rootId,
  aygDrag = null,
  aygItemIds = [],
  machinePaths = [],
  nativeSource = null,
  droppedPaths = [],
  now = Date.now(),
}) {
  if (!segment) return null;
  if (segment.path) {
    let paths = uniquePaths(machinePaths);
    if (paths.length === 0 && ['machine','ayg'].includes(nativeSource?.mode)
      && navigatorNativeDragSourceMatches(nativeSource, droppedPaths, now)) paths = uniquePaths(nativeSource.paths);
    return paths.length && navigatorFileMoveAllowed(paths,segment.path) ? { kind: 'machine-move', paths, destination: segment.path } : null;
  }
  let itemIds = [...new Set(((aygDrag?.itemIds ?? aygItemIds) || []).filter((id) => typeof id === 'string' && id))];
  let placementIds = normalizePlacementPairs(aygDrag?.placementIds, itemIds);
  if (itemIds.length === 0 && nativeSource?.mode === 'ayg'
    && navigatorNativeDragSourceMatches(nativeSource, droppedPaths, now)) {
    itemIds = [...new Set((nativeSource.itemIds || []).filter((id) => typeof id === 'string' && id))];
    placementIds = normalizePlacementPairs(nativeSource.placementIds, itemIds);
  }
  const destination = segment.item?.id || rootId;
  return itemIds.length && destination
    ? { kind: 'ayg-move', itemIds, placementIds, destination }
    : null;
}

export function navigatorDropDragSources({ transferredAyG, transferredMachine, internalDragSource }) {
  const ayg = transferredAyG?.itemIds?.length
    ? transferredAyG
    : (internalDragSource?.mode === 'ayg'
      ? { itemIds:internalDragSource.itemIds || [], placementIds:internalDragSource.placementIds || [] }
      : null);
  const machine = Array.isArray(transferredMachine) && transferredMachine.length
    ? transferredMachine
    : (internalDragSource?.mode === 'machine' ? internalDragSource.paths || [] : []);
  return { ayg, machine };
}

export function navigatorSavedStateForItem(item) {
  if (!item || typeof item.name !== 'string') return null;
  if (item.kind === 'group') {
    return {
      mode: 'ayg', currentId: item.id, view: 'nav', name: item.name, icon: item.icon ?? null,
      art: { kind: 'group', icon: item.icon ?? null },
    };
  }
  const shortcutId = item.shortcutId || item.id;
  return {
    mode: 'action', itemId: shortcutId, name: item.name, icon: item.icon ?? null,
    art: {
      kind: 'shortcut',
      icon: item.icon ?? null,
      target: typeof item.target === 'string' ? item.target : null,
      shortcutId,
    },
  };
}

export async function activateNavigatorFilePill(saved, { run = false } = {}, o) {
  const target = saved.path || saved.art?.target || (saved.quickRunKey ? o.pinnedQuickRunPath?.(saved.quickRunKey) : null)
    || o.nativeDragPaths?.([saved.itemId])?.[0];
  if (run || !target || !o.isAbsoluteWindowsPath(target)) return false;
  const rows = o.itemsIn(o.getState(), o.currentAyG());
  const row = rows.find(item => item.id === saved.itemId || item.shortcutId === saved.itemId);
  if (row) o.selectAyG(row.id, rows.map(item => item.id), {});
  await o.previewMachinePath(target, saved.name);
  return true;
}

export async function deleteNavigatorSelection(mode, selected, o) {
  if (mode === 'ayg') return o.deleteAyG();
  if (!selected || !o.confirm(`Delete machine file or folder "${selected.name}"?\n\n${selected.path}\n\nThis moves the actual file or folder to the Windows Recycle Bin, including its contents. Continue?`)) return;
  return o.host.fileCapability('delete', { paths: [selected.path] });
}

export function createWorkspaceNavigator(o) {
  const d = o.document, panel = d.querySelector('#workspace-navigator');
  if (!panel || !o.workspace || !o.host?.fileCapability) return Object.freeze({
    render() {},
    syncCanvasSelection() {},
    copySelectionPaths() { return false; },
    isMachineMode: () => false,
    isCollapsed: () => true,
    setCollapsed() {},
  });
  o.workspace.classList.add('navigator-docked');
  let savedStates = null;
  const s = {
    mode: 'ayg',
    view: 'tree',
    collapsed: false,
    expanded: new Set([o.rootId]),
    machineExpanded: new Set(),
    machineSelected: new Set(),
    machineRows: new Map(),
    machineOrders: new Map(),
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
    searchQuery: '',
    searchGeneration: 0,
    searchTimer: null,
    searchResult: null,
    searchFilters: { name:'', path:'', type:'', size:'', modified:'' },
    searchSort: { key:null, direction:1 },
    machineSort: { key:'name', direction:1 },
    internalDragSource: null,
    nativeDragSource: null,
    activeDropTarget: null,
  };
  try {
    const savedWidthRaw = d.defaultView?.localStorage?.getItem('papers:ayg:navigator-width');
    const savedWidth = savedWidthRaw == null ? NaN : Number(savedWidthRaw);
    if (Number.isFinite(savedWidth)) s.width = Math.max(176, Math.min(560, savedWidth));
    const savedView = d.defaultView?.localStorage?.getItem('papers:ayg:navigator-view');
    if (savedView === 'nav' || savedView === 'tree') s.view = savedView;
    s.machineOrders = new Map(JSON.parse(d.defaultView?.localStorage?.getItem('papers:ayg:navigator-machine-orders') || '[]'));
    s.collapsed = d.defaultView?.localStorage?.getItem('papers:ayg:navigator-collapsed') === '1';
    const savedMachineRoot = d.defaultView?.localStorage?.getItem('papers:ayg:navigator-machine-root');
    if (o.isAbsoluteWindowsPath(savedMachineRoot)) s.machineRoot = savedMachineRoot;
  } catch {
    // Storage is convenience only.
  }
  const head = d.createElement('header'); head.className = 'workspace-navigator-header';
  const provider = d.createElement('button'); provider.type = 'button'; provider.className = 'workspace-navigator-provider';
  const collapse = button(d,'Collapse navigator',['M12.5 4.5 7 10l5.5 5.5']); collapse.classList.add('workspace-navigator-collapse');
  const tools = d.createElement('div'); tools.className = 'workspace-navigator-toolbar';
  const back = button(d,'Back',['M12.5 4.5 7 10l5.5 5.5']), fwd = button(d,'Forward',['M7.5 4.5 13 10l-5.5 5.5']);
  const up = button(d,'Up',['M5 11l5-5 5 5','M10 6v9']), refresh = button(d,'Refresh',['M15.5 7A6 6 0 1 0 16 12','M15.5 7V3.5','M15.5 7H12']), copy = button(d,'Copy',['M7 7h9v9H7z','M4 13H3.5A1.5 1.5 0 0 1 2 11.5v-8A1.5 1.5 0 0 1 3.5 2h8A1.5 1.5 0 0 1 13 3.5V4']);
  const move = button(d,'Cut',['M7 13L16 3','M7 7l9 10','M7 6a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0','M7 14a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0']), paste = button(d,'Paste',['M6 5h8v12H6z','M8 5V3h4v2']);
  const rename = button(d,'Rename',['M4 15h4l8-8-4-4-8 8z','M11 4l4 4']), del = button(d,'Delete',['M4 6h12','M7 6v10h6V6','M8 4h4']);
  const newFolder = button(d,'New folder',['M10 4v12','M4 10h12']);
  const reveal = button(d,'Reveal',['M3 6h5l1.5 2H17v8H3z','M3 9h14']); tools.append(back,fwd,up,refresh,newFolder,copy,move,paste,rename,del,reveal);
  const collapseAll = button(d,'Collapse all folders',['M5 9l5-4 5 4','M5 15l5-4 5 4']);
  collapseAll.classList.add('workspace-navigator-collapse-all');
  collapseAll.addEventListener('click',()=>{s.expanded.clear();s.machineExpanded.clear();render();});
  head.append(provider, tools, collapseAll, collapse);
  const navActions=d.createElement('div');navActions.className='navigator-state-actions';
  const quickSearch=button(d,'Quick Run in navigator',['M8.5 3a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11','M12.5 12.5 17 17']);
  navActions.append(quickSearch);head.insertBefore(navActions,collapseAll);
  quickSearch.addEventListener('click',()=>o.openPaneQuickRun?.(panel));
  const loc = d.createElement('div'); loc.className = 'workspace-navigator-location';
  const locTrack = d.createElement('div'); locTrack.className = 'workspace-navigator-location-track'; loc.append(locTrack);
  loc.prepend(navActions);
  const search = d.createElement('div'); search.className = 'workspace-navigator-search';
  const searchInput = d.createElement('input');
  searchInput.type = 'search';
  searchInput.placeholder = 'Everything';
  searchInput.autocomplete = 'off';
  searchInput.spellcheck = false;
  searchInput.setAttribute('aria-label', 'Search files with Everything');
  const searchInfo = d.createElement('div'); searchInfo.className = 'workspace-navigator-search-info';
  search.append(searchInput, searchInfo);
  const savedPills=d.createElement('div');savedPills.className='navigator-saved-pills';search.insertBefore(savedPills,searchInfo);
  const body = d.createElement('div'); body.className = 'workspace-navigator-body';
  const graphSlot = o.graphContent ? d.createElement('div') : null;
  let refreshGraphVisibility = () => {};
  if (graphSlot) {
    graphSlot.className = 'navigator-graph-surface'; graphSlot.append(o.graphContent);
    const graphToggle = button(d,'Switch list / graph',['M3 4h4v4H3z','M13 12h4v4h-4z','M7 6l8 8']);
    let graphMode = false;
    try { graphMode = d.defaultView.localStorage.getItem('papers:ayg:left-graph:'+o.rootId) === '1'; } catch {}
    const apply = () => { const visible=graphMode&&s.mode==='ayg'&&!s.searchQuery;s.graphViewActive=visible;panel.classList.toggle('graph-mode',visible);graphSlot.hidden = !visible; body.hidden = visible; graphToggle.setAttribute('aria-pressed',String(graphMode)); };
    refreshGraphVisibility=apply;
    graphToggle.addEventListener('click',()=>{graphMode=!graphMode;persistUi('papers:ayg:left-graph:'+o.rootId,graphMode?'1':'0');apply();});
    tools.append(graphToggle); apply();
  }
  const resizer = d.createElement('div'); resizer.className = 'workspace-navigator-resizer'; resizer.setAttribute('role','separator'); resizer.setAttribute('aria-orientation','vertical'); resizer.setAttribute('aria-label','Resize navigator');
  panel.replaceChildren(head,search,loc,body,resizer);
  if (graphSlot) { panel.insertBefore(graphSlot,resizer); panel.classList.add('has-graph-surface'); }
  installNavigatorDropTarget(body,()=>s.mode==='machine'?{path:s.view==='tree'?s.machineRoot:s.path}:{item:{id:s.view==='tree'?o.rootId:currentAyG()}});
  const rowInteractions = bindNavigatorRowInteractions({document:d,body,
    dropEffect: allowed => navigatorDropEffect(allowed,'move'),
    canMove: (ids,parent) => s.mode==='ayg' ? o.canMoveAyGItems?.(ids,parent) !== false : navigatorFileMoveAllowed(ids,parent),
    resolveDestination: (row,folderCenter,source) => {
      let parent=row.dataset.reorderParent,container=row.parentNode;
      if(folderCenter){
        parent=row.dataset.id;
        if(!(s.mode==='ayg'?o.canMoveAyGItems?.(source.ids,parent)!==false:navigatorFileMoveAllowed(source.ids,parent)))return null;
        container=row.nextElementSibling?.classList.contains('navigator-tree-branch')?row.nextElementSibling:null;
        // A closed folder remains closed. Its existing center-drop owner
        // handles the move without creating a preview branch or expanding it.
        if(!container)return null;
      }
      const rows=[...body.querySelectorAll('.workspace-navigator-row[data-id]')].filter(candidate=>candidate.dataset.reorderParent===parent && !source.ids.includes(candidate.dataset.id));
      return {parent,container,rows};
    },
    isNativeDrag: () => Boolean(s.nativeDragSource && Date.now()-s.nativeDragSource.startedAt<30_000),
    getSelection: () => s.mode==='ayg' ? o.getSession().selected : s.machineSelected,
    finishSelection: () => {if(s.mode==='ayg')o.finishAyGMarquee?.();},
    setSelection: ids => {
      if(s.mode==='ayg') o.setAyGSelection?.(ids);
      else {s.machineSelected=new Set(ids);s.selected=s.machineRows.get(ids.at(-1))||null;}
      const selected=s.mode==='ayg'?o.getSession().selected:s.machineSelected;
      body.querySelectorAll('.workspace-navigator-row[data-id]').forEach(row=>row.classList.toggle('selected',selected.has(row.dataset.id)));
    },
    reorder: async plan => {
      if(s.mode==='ayg') {
        const saved=await o.reorderAyGItems?.(plan.moving,plan.parent,plan.beforeId);
        if(saved!==true){o.setStatus('The item order could not be saved.');render();return;}
      } else {
        let order=plan.order;
        if(plan.parent!==plan.sourceParent){
          const result=await moveNavigatorFiles({host:o.host,paths:plan.moving,destination:plan.parent});
          if(!result?.ok){reportDropResult(result?.message||'Move failed.');render();return;}
          order=order.map(id=>plan.moving.includes(id)?plan.parent.replace(/[\\/]$/,'')+'\\'+id.split(/[\\/]/).pop():id);
          s.machineListings.clear();s.machineSelected.clear();
        }
        s.machineOrders.set(plan.parent,order);
        try {d.defaultView?.localStorage?.setItem('papers:ayg:navigator-machine-orders',JSON.stringify([...s.machineOrders]));} catch {}
      }
      render();
    },
    restore: () => render(),
  });
  function orderedMachineItems(items,parent) {
    const order=s.machineOrders.get(parent);
    if(!order)return items;
    const positions=new Map(order.map((id,index)=>[id,index]));
    return [...items].sort((a,b)=>(positions.get(a.path)??Infinity)-(positions.get(b.path)??Infinity));
  }
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
    provider.title = s.mode === 'machine' ? 'Switch to As you Go' : 'Switch to Opus';
    provider.setAttribute('aria-label', provider.title);
    panel.classList.toggle('collapsed', s.collapsed);
    o.workspace.classList.toggle('navigator-collapsed', s.collapsed);
    collapse.title = s.collapsed ? 'Expand navigator' : 'Collapse navigator';
    collapse.setAttribute('aria-label', collapse.title);
    collapse.innerHTML = s.collapsed
      ? svg(['M8.5 3.5a5 5 0 1 0 0 10a5 5 0 1 0 0-10', 'M12.2 12.2 16.5 16.5'])
      : svg(['M12.5 4.5 7 10l5.5 5.5']);
    const nav = s.view === 'nav' || s.graphViewActive;
    // Keep the toolbar spatially stable when the pane narrows or changes mode.
    // Context-specific controls stay visible but disabled instead of disappearing.
    back.hidden = fwd.hidden = up.hidden = false;
    if (!nav) back.disabled = fwd.disabled = up.disabled = true;
    reveal.hidden = false;
    paste.hidden = false;
    reveal.disabled = s.mode !== 'machine';
    paste.disabled = false;
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
  function clearSearch({ renderNow = true } = {}) {
    if (s.searchTimer) clearTimeout(s.searchTimer);
    s.searchTimer = null;
    s.searchQuery = '';
    s.searchResult = null;
    s.searchFilters = { name:'', path:'', type:'', size:'', modified:'' };
    ++s.searchGeneration;
    if (searchInput.value) searchInput.value = '';
    if (renderNow) render();
  }
  async function switchProvider() {
    if (s.mode === 'machine') {
      clearSearch({ renderNow: false });
      setMode('ayg');
      return;
    }
    let root = s.machineRoot;
    if (root) {
      const stat = await o.host.fileCapability('stat', { path: root }).catch(() => null);
      if (!stat?.ok || stat.entry?.kind !== 'folder') root = null;
    }
    if (!root) {
      const selectedPaths = o.nativeDragPaths?.([...o.getSession().selected]) || [];
      const visiblePaths = o.nativeDragPaths?.(o.itemsIn(o.getState(), currentAyG()).map((item) => item.id)) || [];
      for (const candidate of uniquePaths([...selectedPaths, ...visiblePaths])) {
        const stat = await o.host.fileCapability('stat', { path: candidate }).catch(() => null);
        if (!stat?.ok) continue;
        root = stat.entry?.kind === 'folder' ? candidate : parentPath(candidate);
        if (root) break;
      }
    }
    if (!root || !o.isAbsoluteWindowsPath(root)) {
      o.setStatus('Opus needs a local file or folder in this AYG location before it can switch inline.');
      return;
    }
    clearSearch({ renderNow: false });
    await enterMachine(root, false);
  }
  function rememberNativeDrag(source) {
    s.nativeDragSource = {
      ...source,
      paths: uniquePaths(source.paths),
      startedAt: Date.now(),
    };
  }
  function rememberInternalDrag(source) {
    s.internalDragSource = source ? { ...source, startedAt: Date.now() } : null;
  }
  function parseDragList(dataTransfer, type) {
    try {
      const parsed = JSON.parse(dataTransfer?.getData?.(type) || '[]');
      return Array.isArray(parsed) ? parsed.filter((value) => typeof value === 'string' && value) : [];
    } catch {
      return [];
    }
  }
  function parseAyGDragPayload(dataTransfer) {
    try {
      const parsed = JSON.parse(dataTransfer?.getData?.(NAVIGATOR_AYG_DRAG_TYPE) || 'null');
      if (Array.isArray(parsed)) return { itemIds: parsed, placementIds: [] };
      if (!parsed || typeof parsed !== 'object') return { itemIds: [], placementIds: [] };
      return {
        itemIds: Array.isArray(parsed.itemIds) ? parsed.itemIds : [],
        placementIds: Array.isArray(parsed.placementIds) ? parsed.placementIds : [],
      };
    } catch {
      return { itemIds: [], placementIds: [] };
    }
  }
  async function droppedPaths(files) {
    if (!files.length) return [];
    let timer;
    const result = await Promise.race([
      o.host.resolveDroppedTargets(files).catch(() => null),
      new Promise(resolve=>{timer=setTimeout(()=>resolve(null),2000);}),
    ]).finally(()=>clearTimeout(timer));
    const entries = result?.targets || result || [];
    return uniquePaths(entries.map((entry) => typeof entry === 'string' ? entry : entry?.target || entry?.path));
  }
  const pendingFileLinks=new Map();
  async function retargetMovedFiles(moves){
    for(const move of moves)pendingFileLinks.set(move.oldPath.toLowerCase(),move);
    const saved=await o.retargetMovedFiles?.(moves);
    if(saved===true){
      savedStates.retargetPaths(moves);
      for(const move of moves)pendingFileLinks.delete(move.oldPath.toLowerCase());
    }
    return saved;
  }
  async function handleNavigatorDrop(segment, event) {
    const files = [...(event.dataTransfer?.files || [])];
    const transferredAyG = parseAyGDragPayload(event.dataTransfer);
    const transferredMachine = parseDragList(event.dataTransfer, NAVIGATOR_MACHINE_DRAG_TYPE);
    const dragSources = navigatorDropDragSources({
      transferredAyG,
      transferredMachine,
      internalDragSource:s.internalDragSource,
    });
    const nativeSource=s.nativeDragSource;
    const resolvedPaths=await navigatorResolveDropPaths(nativeSource,files,droppedPaths);
    if(segment.path && !navigatorFileMoveAllowed(resolvedPaths.length?resolvedPaths:nativeSource?.paths||[],segment.path)){reportDropResult('A folder cannot be moved into itself or its contents.');return;}
    const plan = navigatorBreadcrumbMovePlan({
      segment,
      rootId: o.rootId,
      aygDrag: dragSources.ayg,
      machinePaths: dragSources.machine,
      nativeSource: nativeSource,
      droppedPaths: resolvedPaths,
    });
    const updatesLinks=Boolean(dragSources.ayg?.itemIds?.length && !dragSources.machine.length)
      || (nativeSource?.mode==='ayg' && navigatorNativeDragSourceMatches(nativeSource,resolvedPaths));
    s.internalDragSource = null;
    s.nativeDragSource = null;
    if (plan?.kind === 'ayg-move') {
      const moved = await o.moveAyGItemsToFolder?.(plan.itemIds, plan.placementIds, plan.destination);
      if (moved !== true) return;
      render();
      return;
    }
    if (plan?.kind === 'machine-move') {
      const result = await moveNavigatorFiles({host:o.host,paths:plan.paths,destination:plan.destination,retarget:updatesLinks?retargetMovedFiles:undefined});
      if (!result?.ok) reportDropResult(result?.message || 'Move failed.',updatesLinks);
      else {
        reportDropResult(`Moved to (${plan.destination})`,updatesLinks);
        s.selected = null;
        s.machineListings.clear();
        render();
      }
      return;
    }
    if (!files.length) {reportDropResult('The drop did not contain a readable file. Nothing moved.');return;}
    if (segment.path) {
      if (!resolvedPaths.length) {reportDropResult(`Could not resolve the dropped file path (${files.map(file=>file.name).join(', ')}). Nothing moved.`);return;}
      const result = await o.host.fileCapability('copy', { paths: resolvedPaths, destination: segment.path });
      if (!result?.ok) reportDropResult(result?.message || 'Copy failed.');
      else {
        s.machineListings.clear();
        render();
      }
      return;
    }
    await o.dropNavigatorFiles?.(files, segment.item?.id || o.rootId);
    render();
  }
  const moveHint=d.createElement('div');moveHint.className='navigator-move-hint';moveHint.hidden=true;d.body.append(moveHint);
  let dropPending=false,dropNoticeTimer;
  function reportDropResult(message,showAtCursor=false){
    dropPending=false;o.setStatus(message);moveHint.textContent=message;moveHint.hidden=!showAtCursor;
    moveHint.classList.remove('fading');
    clearTimeout(dropNoticeTimer);dropNoticeTimer=setTimeout(()=>{
      moveHint.classList.add('fading');
      dropNoticeTimer=setTimeout(()=>{moveHint.hidden=true;moveHint.classList.remove('fading');},250);
    },1500);
  }
  d.addEventListener('dragend',()=>{if(!dropPending)moveHint.hidden=true;});
  function installNavigatorDropTarget(element, destination) {
    // Rows and expanded branch bodies share this handler. Stopping propagation
    // makes the deepest nested branch (or directly hovered folder row) win.
    element.addEventListener('dragover',(event)=>{
      const segment=typeof destination==='function'?destination():destination;
      const types=[...(event.dataTransfer?.types || [])];
      const internalType = segment.path ? NAVIGATOR_MACHINE_DRAG_TYPE : NAVIGATOR_AYG_DRAG_TYPE;
      const expectedMode = segment.path ? 'machine' : 'ayg';
      if(!types.includes('Files')&&!types.includes(internalType)&&s.internalDragSource?.mode!==expectedMode)return;
      const paths=s.nativeDragSource?.paths||[];
      if((segment.path && paths.length && !navigatorFileMoveAllowed(paths,segment.path)) || (segment.item && s.internalDragSource?.mode==='ayg' && o.canMoveAyGItems?.(s.internalDragSource.itemIds,segment.item.id)===false)){
        event.preventDefault();event.stopPropagation();element.classList.remove('drop-target');moveHint.hidden=true;if(event.dataTransfer)event.dataTransfer.dropEffect='none';return;
      }
      event.preventDefault();
      event.stopPropagation();
      clearTimeout(dropNoticeTimer);
      moveHint.classList.remove('fading');
      event.dataTransfer.dropEffect=navigatorDropEffect(event.dataTransfer.effectAllowed,types.includes(internalType)?'move':'copy');
      if(segment.path&&paths.length && s.nativeDragSource?.mode==='ayg'){
        event.dataTransfer.dropEffect=navigatorDropEffect(event.dataTransfer.effectAllowed,'move');moveHint.textContent=`move to (${segment.path})`;
        moveHint.style.left=`${event.clientX+14}px`;moveHint.style.top=`${event.clientY+18}px`;moveHint.hidden=false;
      }else moveHint.hidden=true;
      if(s.activeDropTarget!==element){
        s.activeDropTarget?.classList.remove('drop-target');
        s.activeDropTarget=element;
        element.classList.add('drop-target');
      }
    });
    element.addEventListener('dragleave',(event)=>{
      if(!element.contains(event.relatedTarget)&&s.activeDropTarget===element){
        if(!dropPending)moveHint.hidden=true;
        element.classList.remove('drop-target');
        s.activeDropTarget=null;
      }
    });
    element.addEventListener('drop',(event)=>{
      event.preventDefault();
      event.stopPropagation();
      s.activeDropTarget?.classList.remove('drop-target');
      s.activeDropTarget=null;
      dropPending=true;
      clearTimeout(dropNoticeTimer);moveHint.classList.remove('fading');
      moveHint.style.left=`${event.clientX+14}px`;moveHint.style.top=`${event.clientY+18}px`;
      moveHint.textContent='Checking dropped file…';moveHint.hidden=!(s.nativeDragSource?.mode==='ayg'||s.internalDragSource?.mode==='ayg');
      void handleNavigatorDrop(typeof destination==='function'?destination():destination,event)
        .catch(error=>reportDropResult(error.message||'Move failed.'))
        .finally(()=>{if(dropPending){dropPending=false;moveHint.hidden=true;}});
    });
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
      const art = d.createElement('span');
      art.className = 'workspace-navigator-crumb-art';
      art.setAttribute('aria-hidden','true');
      const item = segment.item || {kind:'folder'};
      art.innerHTML = icon(item);
      if(segment.path) loadMachineArt(art,{path:segment.path,kind:'folder'});
      else hydrateArt(art,item);
      const label = d.createElement('span');
      label.className = 'workspace-navigator-crumb-label';
      label.textContent = segment.label;
      crumb.append(art,label);
      crumb.title = segment.title || segment.label;
      crumb.draggable=true;
      crumb.addEventListener('dragstart',event=>event.dataTransfer?.setData('application/x-papers-pill',JSON.stringify(segment.path?{mode:'machine',path:segment.path,machineRoot:segment.path,view:'nav',name:segment.label}:{mode:'ayg',currentId:segment.item?.id||o.rootId,view:'nav',name:segment.label,icon:segment.item?.icon})));
      installNavigatorDropTarget(crumb,segment);
      crumb.addEventListener('contextmenu',event=>{
        event.preventDefault();event.stopPropagation();
        const parent = segment.path
          ? {kind:'folder',path:parentPath(segment.path)}
          : {kind:'group',id:segment.item?.parentId || o.rootId};
        void breadcrumbPopup.show(crumb,parent);
      });
      if (segment.activate) crumb.addEventListener('click', segment.activate);
      else crumb.setAttribute('aria-disabled','true');
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
    while(id&&id!==o.rootId){const g=groups.find((x)=>x.id===id);if(!g)break;out.unshift({id:g.id,name:g.name,item:g});id=g.parentId;}
    return [{id:o.rootId,name:'As you Go'},...out];
  }
  async function enterAyG(x){
    if(x.kind==='group'){
      s.expanded.clear();
      setView('nav',false);
      navigateAyG(x.id);
      return;
    }
    if(!o.isWebLink(x)&&o.isAbsoluteWindowsPath(x.target)){
      const stat=await o.host.fileCapability('stat',{path:x.target}).catch(()=>null);
      if(stat?.ok&&stat.entry?.kind==='folder'){await enterMachine(x.target,true);return;}
    }
    await o.activateAyG(x.shortcutId||x.id);render();
  }
  const branchColors=new Map();let treeBranches=[],treeRowIndex=0;
  function paintTreeBranches(branches=treeBranches){navigatorBranchHues(branches,branchColors);for(const b of branches){const color=b.id.startsWith('group-proxima-')?'oklch(68% 0.18 145deg)':`oklch(68% 0.18 ${branchColors.get(b.id)}deg)`;b.row.style.setProperty('--branch-color',color);b.children.style.setProperty('--branch-color',color);}}
  function aygChildren(parent, depth = 0) {
    const f = d.createDocumentFragment();
    for (const x of o.itemsIn(o.getState(), parent).filter((v) => v.kind !== 'window-layout')) {
      const id = x.id, row = d.createElement('div');const start=treeRowIndex++;
      row.draggable=true;
      row.addEventListener('dragstart',event=>{
        const dragPayload=navigatorAyGDragPayload({
          itemId:id,
          selectedIds:o.getSession().selected,
          resolveIdentity:o.resolveAyGDragIdentity,
        });
        event.dataTransfer?.setData(NAVIGATOR_AYG_DRAG_TYPE,JSON.stringify(dragPayload));
        if(event.ctrlKey)return;
        rememberInternalDrag({mode:'ayg',...dragPayload});
        const saved=navigatorSavedStateForItem(x);
        if(saved)event.dataTransfer?.setData('application/x-papers-pill',JSON.stringify(saved));
      });
      row.addEventListener('dragend',()=>{s.internalDragSource=null;});
      row.className = 'workspace-navigator-row'; row.dataset.id = id; row.dataset.reorderParent=parent;row.dataset.reorderFolder=String(x.kind==='group'); row.style.paddingLeft = `${4 + depth * 13}px`; row.classList.toggle('selected', o.getSession().selected.has(id));
      const ownNativePaths = o.nativeDragPaths?.([id]) || [];
      if (ownNativePaths.length > 0) {
        row.draggable = true;
        row.addEventListener('dragstart', (event) => {
          const dragPayload = navigatorAyGDragPayload({
            itemId:id,
            selectedIds:o.getSession().selected,
            resolveIdentity:o.resolveAyGDragIdentity,
          });
          const paths = aygNavigatorNativePaths({
            itemId: id,
            selectedIds: o.getSession().selected,
            resolvePaths: o.nativeDragPaths,
          });
          rememberNativeDrag({ mode:'ayg', ...dragPayload, paths });
          beginNavigatorNativeDrag({
            event,
            paths,
            host: o.host,
          });
        });
      }
      if (x.kind === 'group') {
        const t = d.createElement('button'); t.type='button'; t.className='navigator-tree-toggle'; t.textContent=s.expanded.has(x.id)?'':'>';
        t.addEventListener('click',(e)=>{e.stopPropagation(); s.expanded.has(x.id)?s.expanded.delete(x.id):s.expanded.add(x.id); render();}); row.append(t);
      } else { const sp=d.createElement('span'); sp.className='navigator-tree-spacer'; row.append(sp); }
      const art=d.createElement('span'); art.className='workspace-navigator-art'; art.innerHTML=icon(x);
      hydrateArt(art, x);
      const label=d.createElement('span'); label.className='workspace-navigator-label'; label.textContent=(x.id.startsWith('group-proxima-')?'\u2605 ':'')+(x.name||'Untitled');
      if(x.kind!=='group'&&!o.isWebLink(x)&&o.isAbsoluteWindowsPath(x.target)){
        void o.host.fileCapability('stat',{path:x.target}).then(result=>{
          if(result?.ok&&result.entry?.kind==='folder'&&label.isConnected){
            row.classList.add('navigator-filesystem-link');
            installNavigatorDropTarget(row,{path:x.target});
            const marker=d.createElement('span');marker.className='navigator-linked-folder-marker';marker.textContent=' <';label.append(marker);
          }
        }).catch(()=>{});
      }

      if(x.id.startsWith('group-proxima-'))label.classList.add('navigator-proxima-label');
      if(x.kind==='group'&&s.expanded.has(x.id)){const h=d.createElement('span');h.className='navigator-tree-folder-heading';h.append(art,label);row.append(h);row.classList.add('navigator-tree-expanded');}else row.append(art,label);
      row.tabIndex=-1;
      row.addEventListener('click',(e)=>{row.focus({preventScroll:true});if(e.shiftKey&&!e.ctrlKey){e.preventDefault();void enterAyG(x);return;}o.selectAyG(id,visibleIds(),{ctrlKey:e.ctrlKey});body.querySelectorAll('.workspace-navigator-row[data-id]').forEach(candidate=>candidate.classList.toggle('selected',o.getSession().selected.has(candidate.dataset.id)));body.tabIndex=-1;body.focus({preventScroll:true});});
      row.addEventListener('dblclick',(e)=>{
        if(e.button!==0)return;
        e.preventDefault();e.stopPropagation();void enterAyG(x);
      });
      row.addEventListener('contextmenu',(e)=>{
        if(x.kind!=='group')return;
        e.preventDefault();e.stopPropagation();
        s.expanded.has(x.id)?s.expanded.delete(x.id):s.expanded.add(x.id);
        render();
      });
      if(x.kind==='group')installNavigatorDropTarget(row,{item:x});
      f.append(row);if(x.kind==='group'&&s.expanded.has(x.id)){const children=d.createElement('div');children.className='navigator-tree-branch';children.style.setProperty('--branch-left',`${14+depth*13}px`);children.append(aygChildren(x.id,depth+1));installNavigatorDropTarget(children,{item:x});f.append(children);treeBranches.push({id,depth,start,end:treeRowIndex-1,row,children});}
    } return f;
  }
  function renderAyG() {treeBranches=[];treeRowIndex=0;
    if(s.view==='tree'&&!s.graphViewActive){
      setLocation([{key:'ayg-root',label:'As you Go'}]);
      body.replaceChildren(aygChildren(o.rootId));paintTreeBranches();
    }
    else{
      const current=currentAyG();
      if(s.aygSkipHistory)s.aygSkipHistory=false;else if(s.aygHistory[s.aygHi]!==current){s.aygHistory=s.aygHistory.slice(0,s.aygHi+1);s.aygHistory.push(current);s.aygHi=s.aygHistory.length-1;}
      setLocation(aygCrumbs().map((crumb)=>({
        key:crumb.id,
        label:crumb.name,
        item:crumb.item,
        activate:()=>navigateAyG(crumb.id),
      })));
      body.replaceChildren(aygChildren(current));paintTreeBranches();
    }
    back.disabled=s.view!=='nav'||s.aygHi<=0;
    fwd.disabled=s.view!=='nav'||s.aygHi>=s.aygHistory.length-1;
    up.disabled=s.view!=='nav'||currentAyG()===o.rootId;
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
  function formatSearchSize(value) {
    if (!Number.isFinite(value) || value < 0) return '';
    if (value < 1024) return `${value} B`;
    const units=['KB','MB','GB','TB'];
    let size=value/1024, unit=0;
    while(size>=1024&&unit<units.length-1){size/=1024;unit++;}
    return `${size>=100?Math.round(size):size>=10?size.toFixed(1):size.toFixed(2)} ${units[unit]}`;
  }
  function formatSearchDate(value) {
    if (!Number.isFinite(value) || value <= 0) return '';
    try {
      return new Date(value).toLocaleString([], { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
    } catch { return ''; }
  }
  function searchTypeLabel(item) {
    if (item.kind === 'folder') return 'Folder';
    const match = /(?:^|[\\/])([^\\/]+)$/.exec(item.path || '');
    const name = match?.[1] || item.name || '';
    const dot = name.lastIndexOf('.');
    return dot > 0 && dot < name.length - 1 ? name.slice(dot).toLocaleLowerCase() : 'File';
  }
  function parseSizeFilter(raw) {
    const match = String(raw || '').trim().toLocaleLowerCase().match(/^\s*(<=|>=|<|>|=)?\s*(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|tb)?\s*$/);
    if (!match) return null;
    const multipliers={b:1,kb:1024,mb:1024**2,gb:1024**3,tb:1024**4};
    return { op:match[1]||'>=', bytes:Number(match[2])*(multipliers[match[3]||'b']||1) };
  }
  function matchesSizeFilter(value, raw) {
    if (!String(raw || '').trim()) return true;
    if (!Number.isFinite(value) || value < 0) return false;
    const parsed=parseSizeFilter(raw);
    if(!parsed)return formatSearchSize(value).toLocaleLowerCase().includes(String(raw).trim().toLocaleLowerCase());
    if(parsed.op==='<')return value<parsed.bytes;
    if(parsed.op==='<=')return value<=parsed.bytes;
    if(parsed.op==='>')return value>parsed.bytes;
    if(parsed.op==='=')return value===parsed.bytes;
    return value>=parsed.bytes;
  }
  function filteredSearchResults() {
    const source=[...(s.searchResult?.results||[])], filters=s.searchFilters;
    const contains=(value,needle)=>!needle||String(value||'').toLocaleLowerCase().includes(String(needle).toLocaleLowerCase());
    const filtered=source.filter((item)=>{
      const parent=parentPath(item.path);
      const type=searchTypeLabel(item);
      const modified=formatSearchDate(item.modifiedAt);
      return contains(item.name,filters.name)
        && contains(parent,filters.path)
        && contains(type,filters.type)
        && matchesSizeFilter(item.size,filters.size)
        && contains(modified,filters.modified);
    });
    const {key,direction}=s.searchSort;
    if(!key)return filtered;
    const value=(item)=>{
      if(key==='path')return parentPath(item.path).toLocaleLowerCase();
      if(key==='type')return searchTypeLabel(item).toLocaleLowerCase();
      if(key==='size')return Number.isFinite(item.size)?item.size:-1;
      if(key==='modified')return Number.isFinite(item.modifiedAt)?item.modifiedAt:-1;
      return String(item.name||'').toLocaleLowerCase();
    };
    filtered.sort((a,b)=>{
      const av=value(a),bv=value(b);
      return (typeof av==='number'&&typeof bv==='number' ? av-bv : String(av).localeCompare(String(bv))) * direction;
    });
    return filtered;
  }
  function machineSortValue(item, key) {
    if (key === 'type') return searchTypeLabel(item).toLocaleLowerCase();
    if (key === 'size') return Number.isFinite(item.size) ? item.size : -1;
    if (key === 'modified') return Number.isFinite(item.modifiedAt) ? item.modifiedAt : -1;
    return String(item.name || '').toLocaleLowerCase();
  }
  function sortedMachineItems(items) {
    const { key, direction } = s.machineSort;
    return [...(items || [])].sort((a, b) => {
      if (a.kind === 'folder' && b.kind !== 'folder') return -1;
      if (a.kind !== 'folder' && b.kind === 'folder') return 1;
      const av = machineSortValue(a, key), bv = machineSortValue(b, key);
      const compared = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv));
      if (compared) return compared * direction;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
  }
  function machineColumnHeader() {
    const header=d.createElement('div'); header.className='workspace-navigator-machine-columns';
    const iconSpacer=d.createElement('span'); iconSpacer.className='workspace-navigator-machine-column-icon';
    header.append(iconSpacer);
    for (const [key,label] of [['name','Name'],['type','Type'],['size','Size'],['modified','Date Modified']]) {
      const sort=d.createElement('button'); sort.type='button'; sort.className='workspace-navigator-machine-sort';
      sort.textContent=label+(s.machineSort.key===key?(s.machineSort.direction===1?' ↑':' ↓'):'');
      sort.title=`Sort by ${label}`;
      sort.addEventListener('click',()=>{
        if(s.machineSort.key===key)s.machineSort.direction*=-1;
        else s.machineSort={key,direction:1};
        s.machineOrders.delete(s.path);
        if(s.path)void loadMachine(s.path,false);
      });
      header.append(sort);
    }
    return header;
  }
  function searchColumnHeader() {
    const header=d.createElement('div'); header.className='workspace-navigator-search-columns';
    const iconSpacer=d.createElement('span'); iconSpacer.className='workspace-navigator-search-column-icon';
    header.append(iconSpacer);
    const specs=[
      ['name','Name','name'],
      ['path','Path','path contains…'],
      ['type','Type','folder / .rvt'],
      ['size','Size','>10mb'],
      ['modified','Date Modified','date contains…'],
    ];
    for(const [key,label,placeholder] of specs){
      const column=d.createElement('div'); column.className='workspace-navigator-search-column'; column.dataset.column=key;
      const sort=d.createElement('button'); sort.type='button'; sort.className='workspace-navigator-search-sort';
      sort.textContent=label+(s.searchSort.key===key?(s.searchSort.direction===1?' ↑':' ↓'):'');
      sort.title=`Sort by ${label}`;
      sort.addEventListener('click',()=>{
        if(s.searchSort.key===key)s.searchSort.direction*=-1;
        else s.searchSort={key,direction:1};
        renderSearch();
      });
      const input=d.createElement('input'); input.type='search'; input.value=s.searchFilters[key]||''; input.placeholder=placeholder; input.autocomplete='off'; input.spellcheck=false;
      input.setAttribute('aria-label',`Filter ${label}`);
      input.addEventListener('input',()=>{s.searchFilters[key]=input.value;renderSearch({preserveFocus:key});});
      column.append(sort,input); header.append(column);
    }
    return header;
  }
  function machineRow(x, depth = 0, { searchResult = false } = {}) {
    const row=d.createElement('div'); row.className='workspace-navigator-row machine-row'; row.style.paddingLeft=`${4+depth*13}px`;row.dataset.id=x.path;row.dataset.reorderParent=parentPath(x.path);row.dataset.reorderFolder=String(x.kind==='folder');s.machineRows.set(x.path,x); row.classList.toggle('selected',s.machineSelected.has(x.path));
    row.classList.toggle('search-result',searchResult);
    row.draggable = true;
    row.title = x.path;
    if(x.kind==='folder')row.dataset.folderPath=x.path;
    row.addEventListener('dragstart',(event)=>{
      const paths=s.machineSelected.has(x.path)?[...s.machineSelected]:[x.path];
      event.dataTransfer?.setData(NAVIGATOR_MACHINE_DRAG_TYPE,JSON.stringify(paths));
      if(!event.ctrlKey){
        rememberInternalDrag({mode:'machine',paths});
        event.dataTransfer?.setData('application/x-papers-pill',JSON.stringify({mode:'action',path:x.path,name:x.name}));
      }
      rememberNativeDrag({ mode:'machine', paths });
      beginNavigatorNativeDrag({ event, paths, host: o.host });
    });
    row.addEventListener('dragend',()=>{s.internalDragSource=null;});
    const folder=x.kind==='folder', lead=d.createElement(folder?'button':'span'); lead.className=folder?'navigator-tree-toggle':'navigator-tree-spacer';
    if(folder){lead.type='button';lead.textContent=s.machineExpanded.has(x.path)?'':'>';lead.addEventListener('click',(e)=>{e.stopPropagation();void toggleMachine(x.path);});}
    const art=d.createElement('span'); art.className='workspace-navigator-art'; art.innerHTML=icon(x); hydrateMachineArt(art,x);
    const label=d.createElement('span'); label.className='workspace-navigator-label'; label.textContent=x.name;row.append(lead);if(folder&&!searchResult&&s.machineExpanded.has(x.path)){const h=d.createElement('span');h.className='navigator-tree-folder-heading';h.append(art,label);row.append(h);row.classList.add('navigator-tree-expanded');}else row.append(art,label);
    if(folder&&!searchResult)installNavigatorDropTarget(row,{path:x.path});
    if(!searchResult&&s.view==='nav'){
      row.classList.add('machine-list-row');
      const type=d.createElement('span'); type.className='workspace-navigator-machine-type'; type.textContent=searchTypeLabel(x);
      const size=d.createElement('span'); size.className='workspace-navigator-machine-size'; size.textContent=x.kind==='folder'?'':formatSearchSize(x.size);
      const modified=d.createElement('span'); modified.className='workspace-navigator-machine-modified'; modified.textContent=formatSearchDate(x.modifiedAt);
      row.append(type,size,modified);
    }
    if(searchResult){
      row.replaceChildren(art,label);
      const where=d.createElement('span'); where.className='workspace-navigator-search-path'; where.textContent=parentPath(x.path);
      const type=d.createElement('span'); type.className='workspace-navigator-search-type'; type.textContent=searchTypeLabel(x);
      const size=d.createElement('span'); size.className='workspace-navigator-search-size'; size.textContent=x.kind==='folder'?'':formatSearchSize(x.size);
      const modified=d.createElement('span'); modified.className='workspace-navigator-search-modified'; modified.textContent=formatSearchDate(x.modifiedAt);
      row.append(where,type,size,modified);
    }
    row.addEventListener('click',(e)=>{
      if(e.shiftKey&&!e.ctrlKey){
        e.preventDefault();
        if(folder){
          s.machineExpanded.clear();
          setView('nav',false);
          if(searchResult){
            clearSearch({renderNow:false});
            void enterMachine(x.path,false);
          }else void loadMachine(x.path,true);
        }else{
          void o.host.fileCapability('open',{path:x.path});
        }
        return;
      }
      if(searchResult&&s.mode!=='machine'){
        s.mode='machine';
        if(!s.machineRoot){
          s.machineRoot=folder?x.path:parentPath(x.path);
          persistUi('papers:ayg:navigator-machine-root',s.machineRoot);
        }
        syncChrome();
      }
      if(e.ctrlKey){s.machineSelected.has(x.path)?s.machineSelected.delete(x.path):s.machineSelected.add(x.path);}
      else s.machineSelected=new Set([x.path]);
      s.selected=s.machineSelected.has(x.path)?x:(s.machineRows.get([...s.machineSelected].at(-1))||null);
      body.querySelectorAll('.machine-row').forEach(candidate=>candidate.classList.toggle('selected',s.machineSelected.has(candidate.dataset.id)));
      o.clearCanvasForMachine();
      o.previewMachinePath(x.path,x.name);
    });
    row.addEventListener('dblclick',(e)=>{
      if(e.button!==0)return;
      e.preventDefault();e.stopPropagation();
      if(folder){
        clearSearch({renderNow:false});
        setView('nav',false);
        if(searchResult||s.mode!=='machine')void enterMachine(x.path,false);
        else void loadMachine(x.path,true);
      }else{
        void o.host.fileCapability('open',{path:x.path});
      }
    });
    row.addEventListener('contextmenu',(e)=>{
      if(!folder)return;
      e.preventDefault();e.stopPropagation();
      void toggleMachine(x.path);
    });
    return row;
  }
  async function machineTree(path,depth,generation,tree){
 const fragment=d.createDocumentFragment(),result=await machineList(path);if(generation!==s.renderGen||s.mode!=='machine'||!result?.ok)return fragment;
 for(const x of orderedMachineItems(result.items||[],path)){const start=tree.index++,row=machineRow(x,depth);fragment.append(row);if(x.kind==='folder'&&s.machineExpanded.has(x.path)){const children=d.createElement('div');children.className='navigator-tree-branch';children.style.setProperty('--branch-left',`${14+depth*13}px`);children.append(await machineTree(x.path,depth+1,generation,tree));installNavigatorDropTarget(children,{path:x.path});fragment.append(children);tree.branches.push({id:`machine:${x.path.toLowerCase()}`,depth,start,end:tree.index-1,row,children});}}return fragment;
 }
 async function renderMachineTree(){const generation=++s.renderGen,root=s.machineRoot;if(!root)return;setLocation([{key:root.toLowerCase(),label:root,title:root,path:root}]);const tree={index:1,branches:[]},fragment=d.createDocumentFragment(),row=machineRow({path:root,name:root,kind:'folder'});fragment.append(row);if(s.machineExpanded.has(root)){const children=d.createElement('div');children.className='navigator-tree-branch';children.style.setProperty('--branch-left','14px');children.append(await machineTree(root,1,generation,tree));installNavigatorDropTarget(children,{path:root});fragment.append(children);tree.branches.push({id:`machine:${root.toLowerCase()}`,depth:0,start:0,end:tree.index-1,row,children});}if(generation===s.renderGen&&s.mode==='machine'&&s.view==='tree'){body.replaceChildren(fragment);paintTreeBranches(tree.branches);}}
  function machinePathCrumbs(path) {
    const normalized=String(path||'').replace(/\//g,'\\').replace(/\\+$/,'');
    const unc=normalized.match(/^\\\\([^\\]+)\\([^\\]+)(?:\\(.*))?$/);
    if(unc){
      let cursor=`\\\\${unc[1]}\\${unc[2]}`;
      const entries=[{path:cursor,name:cursor}];
      for(const part of String(unc[3]||'').split('\\').filter(Boolean)){cursor+='\\'+part;entries.push({path:cursor,name:part});}
      return entries;
    }
    const drive=normalized.match(/^([A-Za-z]:)(?:\\(.*))?$/);
    if(drive){
      let cursor=drive[1]+'\\';
      const entries=[{path:cursor,name:cursor}];
      for(const part of String(drive[2]||'').split('\\').filter(Boolean)){cursor+=part;entries.push({path:cursor,name:part});cursor+='\\';}
      for(let i=1;i<entries.length;i++)entries[i].path=entries[i].path.replace(/\\+$/,'');
      return entries;
    }
    return [{path:normalized,name:normalized}];
  }
  function renderMachineCrumbs(path) {
    setLocation(machinePathCrumbs(path).map((entry)=>({
      key:entry.path.toLocaleLowerCase(),
      label:entry.name,
      title:entry.path,
      path:entry.path,
      activate:()=>void loadMachine(entry.path,true),
    })));
  }
  async function loadMachine(path, push = true) {
    if(s.path!==path){s.machineSelected.clear();s.selected=null;}
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
    const items=orderedMachineItems(sortedMachineItems(result.items || []),path);
    if(items.length){
      body.append(machineColumnHeader());
      const rows=d.createElement('div'); rows.className='workspace-navigator-machine-rows';
      const tree={index:0,branches:[]};
      for (const x of items) {
        const start=tree.index++,row=machineRow(x);rows.append(row);
        if(x.kind==='folder'&&s.machineExpanded.has(x.path)) {
          const children=d.createElement('div');children.className='navigator-tree-branch';children.style.setProperty('--branch-left','14px');children.append(await machineTree(x.path,1,gen,tree));
          if(gen!==s.renderGen)return;
          rows.append(children);tree.branches.push({id:`machine:${x.path.toLowerCase()}`,depth:0,start,end:tree.index-1,row,children});
        }
      }
      body.append(rows);paintTreeBranches(tree.branches);
    }else body.innerHTML='<p class="workspace-navigator-empty">This folder is empty.</p>';
  }
  async function enterMachine(path, fromGesture = false) {
    const changed = !s.path || !s.machineRoot || s.machineRoot.toLocaleLowerCase() !== path.toLocaleLowerCase();
    if (changed) {
      s.machineRoot = path; s.path = path; s.selected = null;s.machineSelected.clear();
      s.history = [path]; s.hi = 0;
      s.machineExpanded = new Set([path]);
      s.machineListings.clear();
    }
    persistUi('papers:ayg:navigator-machine-root', s.machineRoot);
    s.mode = 'machine';
    if (fromGesture) setView('nav', false);
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
  function renderSearch({preserveFocus=null} = {}) {
    setLocation([{key:'everything',label:'Everything'},{key:s.searchQuery,label:s.searchQuery}]);
    body.replaceChildren();
    if (!s.searchResult) {
      searchInfo.textContent = 'Everything · searching…';
      body.innerHTML = '<p class="workspace-navigator-empty">Searching…</p>';
      return;
    }
    if (!s.searchResult.ok) {
      searchInfo.textContent = s.searchResult.message || s.searchResult.error || 'Everything unavailable';
      body.innerHTML = `<p class="workspace-navigator-empty">${s.searchResult.message || s.searchResult.error || 'Everything search is unavailable.'}</p>`;
      return;
    }
    const shown = (s.searchResult.results || []).length;
    const total = Number.isFinite(s.searchResult.total) ? s.searchResult.total : shown;
    const filtered=filteredSearchResults();
    const version = s.searchResult.version ? ` ${s.searchResult.version}` : '';
    searchInfo.textContent = `Everything${version} · ${total.toLocaleString()} result${total===1?'':'s'} · ${shown.toLocaleString()} loaded${filtered.length!==shown?` · ${filtered.length.toLocaleString()} visible`:''}`;
    body.append(searchColumnHeader());
    const rows=d.createElement('div'); rows.className='workspace-navigator-search-rows';
    for (const item of filtered) rows.append(machineRow(item, 0, { searchResult: true }));
    if (!rows.childElementCount) rows.innerHTML = '<p class="workspace-navigator-empty">No results match these column filters.</p>';
    body.append(rows);
    if(preserveFocus){
      const active=body.querySelector(`.workspace-navigator-search-column[data-column="${preserveFocus}"] input`);
      active?.focus();
      active?.setSelectionRange?.(active.value.length,active.value.length);
    }
  }
  async function runSearch(query) {
    const normalized=String(query||'').trim();
    s.searchQuery=normalized;
    s.searchResult=null;
    const generation=++s.searchGeneration;
    if(!normalized){render();return;}
    renderSearch();
    const result=await searchNavigatorFiles({query:normalized,search:query=>o.host.fileCapability('search',{query,limit:1000}),isCurrent:()=>generation===s.searchGeneration&&s.searchQuery===normalized});
    if(generation!==s.searchGeneration||s.searchQuery!==normalized)return;
    s.searchResult=result;
    renderSearch();
  }
  const destination=()=>{const ids=[...o.getSession().selected]; return ids.length===1&&o.getState().groups.some((g)=>g.id===ids[0])?ids[0]:(o.getSession().currentId||o.rootId);};
  provider.addEventListener('click',()=>{void switchProvider();});
  searchInput.addEventListener('input',()=>{
    if(s.searchTimer)clearTimeout(s.searchTimer);
    s.searchTimer=setTimeout(()=>{s.searchTimer=null;void runSearch(searchInput.value);},120);
  });
  searchInput.addEventListener('keydown',(event)=>{
    if(event.key==='Enter'){event.preventDefault();if(s.searchTimer)clearTimeout(s.searchTimer);s.searchTimer=null;void runSearch(searchInput.value);}
    if(event.key==='Escape'&&searchInput.value){event.preventDefault();clearSearch();}
  });
  function setCollapsed(collapsed){
    s.collapsed=o.permanentPane ? false : Boolean(collapsed);
    persistUi('papers:ayg:navigator-collapsed',s.collapsed?'1':'0');
    render();
  }
  collapse.addEventListener('click',()=>setCollapsed(!s.collapsed));
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
    const p=parentPath(s.path);if(p&&p.toLocaleLowerCase()!==s.path.toLocaleLowerCase())void loadMachine(p,true);
  });
  refresh.addEventListener('click',async()=>{
    if(s.mode==='machine'&&s.path)s.machineListings.delete(s.path.toLocaleLowerCase());
    if(pendingFileLinks.size){
      refresh.disabled=true;
      try{
        const saved=await retryNavigatorFileLinks({host:o.host,moves:[...pendingFileLinks.values()],retarget:retargetMovedFiles});
        o.setStatus(saved?'Moved file links updated.':'Moved file links still could not be saved. Resolve any workspace save conflict, then Refresh to retry.');
      }catch(error){o.setStatus(error.message||'Moved file links could not be saved. Refresh to retry.');}
      finally{refresh.disabled=false;}
    }
    render();
  });
  newFolder.addEventListener('click',async()=>{
    const existing=body.querySelector('[data-new-folder] input');if(existing){existing.focus();return;}
    const state=o.getState(),selectedId=[...o.getSession().selected].at(-1);
    const selected=s.mode==='machine'?s.selected:
      state.groups.find(item=>item.id===selectedId)||[o.rootId,...state.groups.map(item=>item.id)].flatMap(id=>o.itemsIn(state,id)).find(item=>item.id===selectedId);
    let target;
    newFolder.disabled=true;
    try{target=await navigatorNewFolderDestination({mode:s.mode,selected,currentId:currentAyG(),path:s.path,rootId:o.rootId,isAbsoluteWindowsPath:o.isAbsoluteWindowsPath,stat:path=>o.host.fileCapability('stat',{path})});}
    catch(error){o.setStatus(error.message||'Folder destination is unavailable.');return;}
    finally{newFolder.disabled=false;}
    const {mode,parent}=target;
    if(!parent){o.setStatus('Open a folder first.');return;}
    const row=d.createElement('div');row.className='workspace-navigator-row';row.dataset.newFolder='true';
    const input=d.createElement('input');input.className='navigator-inline-rename';input.type='text';input.value='New folder';input.setAttribute('aria-label','New folder name');row.append(input);body.prepend(row);
    let busy=false;
    const save=async()=>{
      if(busy)return;const name=input.value.trim();if(!name){input.focus();return;}
      busy=true;input.disabled=true;
      try{
        if(mode==='ayg'){if(await o.createAyGFolder(parent,name)===false)throw Error('Folder could not be saved.');}
        else{const result=await o.host.fileCapability('create-folder',{path:parent,newName:name});if(!result?.ok)throw Error(result?.message||'Folder could not be created.');s.machineListings.clear();}
        row.remove();render();
      }catch(error){o.setStatus(error.message||'Folder could not be created.');busy=false;input.disabled=false;input.focus();}
    };
    ['click','pointerdown','dblclick'].forEach(type=>input.addEventListener(type,event=>event.stopPropagation()));
    input.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Enter'){event.preventDefault();void save();}else if(event.key==='Escape'&&!busy){event.preventDefault();row.remove();}});
    input.addEventListener('blur',()=>{if(!busy)row.remove();});input.focus();input.select();
  });
  let machineClipboard=null;
  function copyNavigator(cut=false){
    if(s.mode==='ayg'){machineClipboard=null;return cut?o.cutAyG():o.copyAyG();}
    if(s.machineSelected.size)machineClipboard={paths:[...s.machineSelected],cut,base:o.getSession().clipboard};
  }
  async function pasteNavigator(){
    if(machineClipboard&&machineClipboard.base!==o.getSession().clipboard)machineClipboard=null;
    if(s.mode==='ayg'){
      if(machineClipboard){await o.linkNavigatorPaths?.(machineClipboard.paths,destination());return;}
      return o.pasteAyG(destination());
    }
    const clipboard=o.getSession().clipboard;
    const source=machineClipboard||{paths:o.nativeDragPaths?.(clipboard?.ids||[])||[],cut:clipboard?.mode==='cut'};
    if(!source.paths.length){o.setStatus('Copy files before pasting into a real folder.');return;}
    const result=source.cut?await moveNavigatorFiles({host:o.host,paths:source.paths,destination:s.path,retarget:machineClipboard?undefined:retargetMovedFiles})
      :await o.host.fileCapability('copy',{paths:source.paths,destination:s.path});
    if(!result?.ok)o.setStatus(result?.message||'File transfer failed.');else{s.machineListings.clear();render();if(source.cut)machineClipboard=null;}
  }
  copy.addEventListener('click',()=>copyNavigator());
  move.addEventListener('click',()=>copyNavigator(true));
  paste.addEventListener('click',()=>void pasteNavigator());
  d.addEventListener('keydown',event=>{
    if(s.collapsed||!panel.contains(event.target)||event.target?.closest?.('input,textarea,[contenteditable="true"]')||!event.ctrlKey||event.altKey)return;
    const key=event.key.toLowerCase();if(!['c','x','v'].includes(key))return;
    event.preventDefault();event.stopImmediatePropagation();
    if(key==='v')void pasteNavigator();else copyNavigator(key==='x');
  },true);
  d.addEventListener('paste',event=>{
    if(s.mode!=='machine'||!panel.contains(event.target)||event.target?.closest?.('input,textarea,[contenteditable="true"]'))return;
    event.preventDefault();event.stopImmediatePropagation();void pasteNavigator();
  },true);
  rename.addEventListener('click',()=>{
    if(s.mode==='ayg'&&o.getSession().selected.size!==1){o.setStatus('Select one item to rename.');return;}
    const row=body.querySelector('.workspace-navigator-row.selected');
    const label=row?.querySelector('.workspace-navigator-label');
    if(!label){o.setStatus('Select an item in this pane to rename.');return;}
    if(label.querySelector('input'))return;
    const mode=s.mode, selected=s.selected, id=row.dataset.id, previous=label.textContent;
    const input=d.createElement('input');input.type='text';input.className='navigator-inline-rename';input.value=previous;
    input.setAttribute('aria-label','Rename '+previous);label.replaceChildren(input);row.draggable=false;
    let finished=false;
    const finish=async save=>{
      if(finished)return;
      const name=input.value.trim();
      if(save&&!name){input.focus();return;}
      finished=true;input.disabled=true;
      try{
        if(save&&name!==previous){
          if(mode==='ayg')await o.renameAyG(id,name);
          else {const r=await o.host.fileCapability('rename',{path:selected.path,newName:name});if(!r?.ok)throw new Error(r?.message||'Rename failed.');s.selected=null;s.machineListings.clear();}
        }
        label.textContent=save?name:previous;row.draggable=true;render();
      }catch(error){o.setStatus(error.message||'Rename failed.');finished=false;input.disabled=false;input.focus();}
    };
    ['click','pointerdown','dblclick'].forEach(type=>input.addEventListener(type,e=>e.stopPropagation()));
    input.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Enter'||e.key==='Escape'){e.preventDefault();void finish(e.key==='Enter');}});
    input.addEventListener('blur',()=>{if(!finished)void finish(true);});
    input.focus();input.select();
  });
  del.addEventListener('click',async()=>{
    let r;del.disabled=true;
    try{r=await deleteNavigatorSelection(s.mode,s.selected,{...o,confirm:message=>d.defaultView?.confirm(message)});}
    catch(error){o.setStatus(error.message||'Delete failed.');return;}
    finally{del.disabled=false;}
    if(s.mode==='ayg'||!r)return;
    if(!r.ok){o.setStatus(r.message||'Delete failed.');return;}
    s.selected=null;s.machineListings.clear();render();
  });
  reveal.addEventListener('click',()=>{const p=s.selected?.path||s.path;if(p)void o.host.fileCapability('reveal',{path:p});});
  async function copySelectionPaths(){
    const paths=navigatorSelectedPaths({
      mode:s.mode,
      selected:s.selected,
      selectedIds:o.getSession().selected,
      resolvePaths:o.nativeDragPaths,
    });
    if(!paths.length){
      o.setStatus('No selected item has a local filesystem path.');
      return false;
    }
    try{
      await o.host.copyText(paths.join('\r\n'));
      o.setStatus(`Copied ${paths.length} path${paths.length===1?'':'s'}.`);
      return true;
    }catch(error){
      o.setStatus(error instanceof Error?error.message:'Could not copy selected paths.');
      return false;
    }
  }
  function render(){
    refreshGraphVisibility();
    savedStates?.syncDurable();
    syncChrome();
    if (s.collapsed) return;
    if(s.searchQuery){renderSearch();return;}
    searchInfo.textContent = '';
    if(s.mode==='ayg')renderAyG();
    else if(s.view==='tree')void renderMachineTree();
    else if(s.path)void loadMachine(s.path,false);
  }
  const breadcrumbPopup = createBreadcrumbPopup({
    paintBranches:paintTreeBranches,
    document:d,
    children:async parent=>parent.path ? (await machineList(parent.path))?.items || []
      : o.itemsIn(o.getState(),parent.id).filter(item=>item.kind!=='window-layout'),
    art:(element,item)=>{element.innerHTML=icon(item);if(item.path)loadMachineArt(element,item);else hydrateArt(element,item);},
    activate:async item=>{if(item.path){if(item.kind==='folder'){s.machineExpanded.clear();setView('nav',false);await enterMachine(item.path,false);}else await o.host.fileCapability('open',{path:item.path});}else await enterAyG(item);},
  });
  const savedArtItem = (saved) => {
    if (saved?.itemId) {
      const shortcut = (o.getState().shortcuts || []).find((candidate) => candidate.id === saved.itemId);
      if (shortcut) return { ...shortcut, kind:'shortcut', shortcutId:shortcut.id };
    }
    if (saved?.currentId) {
      const group = (o.getState().groups || []).find((candidate) => candidate.id === saved.currentId);
      if (group) return { ...group, kind:'group' };
    }
    if (saved?.art?.kind) return saved.art;
    if(saved?.itemId)return {kind:'shortcut',shortcutId:saved.itemId,icon:typeof saved.icon==='string'?saved.icon:null};
    return { kind:saved?.mode === 'ayg' ? 'group' : 'folder', icon:typeof saved?.icon === 'string' ? saved.icon : null };
  };
  savedStates=createNavigatorSavedStates({document:d,container:savedPills,
    loadSavedStates:()=>o.getState().view?.preferences?.navigatorSavedStates,
    isReady:()=>o.savedStatesReady?.() ?? true,
    saveSavedStates:o.saveNavigatorSavedStates,
    onSaveError:error=>o.setStatus(error.message||'Saved items could not be saved.'),
    resolveTarget:saved=>(saved.quickRunKey?o.pinnedQuickRunPath?.(saved.quickRunKey):null)||o.nativeDragPaths?.([saved.itemId||saved.art?.shortcutId])?.[0],
    decorateLabel:(label,saved)=>{
      const normalized=navigatorFolderPill(saved,o.getState().groups||[]);
      if(normalized.mode==='ayg'){label.textContent=(s.expanded.has(normalized.currentId)?'':'> ')+saved.name;return;}
      if(saved.mode==='machine'){label.textContent=saved.name+' <';label.closest('.navigator-saved-pill')?.classList.add('navigator-filesystem-link');return;}
      const target=saved.path||saved.art?.target||o.nativeDragPaths?.([saved.itemId])?.[0];
      if(target&&o.isAbsoluteWindowsPath(target))void o.host.fileCapability('stat',{path:target}).then(result=>{
        if(label.isConnected&&result?.ok&&result.entry?.kind==='folder'){
          label.textContent=saved.name+' <';
          label.closest('.navigator-saved-pill')?.classList.add('navigator-filesystem-link');
        }
      }).catch(()=>{});
    },
    dragFile:(event,saved)=>{
      s.nativeDragSource=null;
      const target=saved.path||saved.art?.target;
      const paths=target&&o.isAbsoluteWindowsPath(target)?[target]:o.nativeDragPaths?.([saved.itemId])||[];
      if(paths.length){rememberNativeDrag({mode:saved.itemId?'ayg':'machine',itemIds:saved.itemId?[saved.itemId]:[],paths});beginNavigatorNativeDrag({event,paths,host:o.host});}
    },
    fromDrop:async data=>{
      const capturedPaths=navigatorCapturedDropPaths(s.nativeDragSource,[...(data.files||[])]);
      const aygSource=s.internalDragSource?.mode==='ayg'?s.internalDragSource:s.nativeDragSource?.mode==='ayg'&&capturedPaths.length?s.nativeDragSource:null;
      if(aygSource?.itemIds?.length){
        const state=o.getState();
        const items=[...(state.groups||[]).map(group=>({...group,kind:'group'})),...(state.shortcuts||[])];
        const pills=aygSource.itemIds.map(id=>items.find(item=>item.id===id)).filter(Boolean).map(navigatorSavedStateForItem).filter(Boolean);
        if(pills.length)return pills;
      }
      // Preserve the authored name before falling back to the disk filename.
      try{const item=JSON.parse(data.getData('application/x-papers-pill'));if(item&&typeof item.name==='string'&&['ayg','machine','action'].includes(item.mode))return navigatorFolderPill(item,o.getState().groups||[]);}catch{}
      if(data.files?.length){
        const captured=navigatorCapturedDropPaths(s.nativeDragSource,[...data.files]);
        if(s.nativeDragSource?.mode==='ayg' && captured.length){
          const path=captured[0],key=value=>String(value||'').replace(/\//g,'\\').toLowerCase();
          const record=(o.getState().shortcuts||[]).find(item=>s.nativeDragSource.itemIds?.includes(item.id)&&key(item.target)===key(path));
          if(record)return {...navigatorSavedStateForItem(record),path};
        }
        const result=await o.host.resolveDroppedTargets([...data.files]);
        const pills=(result?.targets||result||[]).map(item=>{
          const path=typeof item==='string'?item:item?.target||item?.path;
          return path?{mode:'action',path,name:item?.name||path.split(/[\\/]/).pop()||path}:null;
        }).filter(Boolean);
        if(pills.length)return pills;
      }
      const raw=(data.getData('text/uri-list')||data.getData('text/plain')||'').trim();
      if(!raw)return null;
      if(o.isAbsoluteWindowsPath(raw))return {mode:'action',path:raw,name:raw.split(/[\\/]/).pop()||raw};
      try{const url=new URL(raw);if(['https:','http:'].includes(url.protocol))return {mode:'action',url:raw,name:url.hostname};}catch{}
      return null;
    },
    snapshot:()=>{
      const item=s.mode==='ayg'?(o.getState().groups||[]).find(g=>g.id===currentAyG()):null;
      return {mode:s.mode,view:s.view,currentId:currentAyG(),path:s.path,machineRoot:s.machineRoot,expanded:[...s.expanded],machineExpanded:[...s.machineExpanded],query:s.searchQuery,name:s.mode==='machine'?(s.path?.split(/[\\/]/).filter(Boolean).pop()||s.path||'Folder'):(item?.name||'As you Go'),icon:item?.icon||null};
    },
    restore:async (saved, modifiers)=>{
      saved=navigatorFolderPill(saved,o.getState().groups||[]);
      if(saved.mode==='action'){
        if(await activateNavigatorFilePill(saved, modifiers, { ...o, currentAyG }))return;
        if(saved.quickRunKey)return o.runPinnedQuickRun?.(saved.quickRunKey);
        if(saved.itemId)return o.activateAyG(saved.itemId);
        if(saved.path)return o.host.fileCapability('open',{path:saved.path});
        if(saved.url)return o.openPinnedUrl?.(saved.url,saved.name);
        return;
      }
      clearSearch({renderNow:false});s.mode=saved.mode;s.expanded=new Set(saved.expanded||[]);s.machineExpanded=new Set(saved.machineExpanded||[]);s.machineRoot=saved.machineRoot;s.path=saved.path;setView(saved.view,false);
      if(saved.mode==='ayg')navigateAyG(saved.currentId||o.rootId);syncChrome();render();
      if(saved.query){searchInput.value=saved.query;searchInput.dispatchEvent(new d.defaultView.Event('input',{bubbles:true}));}
    },
    art:(element,saved)=>{const folder=navigatorFolderPill(saved,o.getState().groups||[]);const linked=(folder.currentId||'').startsWith('group-proxima-');element.classList.toggle('navigator-proxima-pill-art',linked);const item=savedArtItem(saved);element.innerHTML=icon(item);const path=saved.path||(o.isAbsoluteWindowsPath(item.target)?item.target:null);if(path)loadMachineArt(element,{path,kind:saved.mode==='machine'?'folder':'file'});else hydrateArt(element,item);},
  });
  syncChrome(); render();
  o.workspace.addEventListener('pointerdown',(event)=>{
    if(event.button!==0||panel.contains(event.target))return;
    const canvas=event.target?.closest?.('#graph-viewport, .icon-item, #icon-grid, #workspace-backdrop');
    if(!canvas&&event.target!==o.workspace)return;
    // Canvas focus does not change the navigator's folder expansion.
    clearSearch({renderNow:false});
    s.mode='ayg';
    setView('nav',false);
    render();
  });
  return Object.freeze({
    render,
    rememberNativeFileDrag(source){rememberNativeDrag(source);},
    syncCanvasSelection,
    copySelectionPaths,
    isMachineMode: () => s.mode === 'machine',
    isCollapsed: () => s.collapsed,
    setCollapsed,
    pinDroppedItems(ids,x,y){
      const rect=savedPills.getBoundingClientRect();
      if(x<rect.left||x>rect.right||y<rect.top||y>rect.bottom)return false;
      for(const id of ids){
        const item=[...(o.getState().groups||[]).map(group=>({...group,kind:'group'})),...o.itemsIn(o.getState(),currentAyG())].find(item=>item.id===id||item.shortcutId===id);
        if(item){const saved=navigatorSavedStateForItem(item);if(saved)savedStates.add(saved);}
      }
      return true;
    },
    setWidth(width,{nativeEdge=false}={}){s.width=Math.round(Math.max(176,Math.min(d.defaultView.innerWidth*(nativeEdge?1:.55),width)));o.workspace.style.setProperty('--workspace-navigator-width',s.width+'px');persistUi('papers:ayg:navigator-width',s.width);},
  });
}

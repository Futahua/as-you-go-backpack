import {currentDeviceMode,sameDeviceMode,takeNavigateIntent,parseNavigateTarget,formatNavigateTarget,NAVIGATE_INTENT_KEY} from './device-modes.js';
import {defaultViewOptions,validateViewOptions,projectNavigatorItems} from './navigator-view-options.js';
import {bindPhoneControlScale,bindDesktopControlScale} from './phone-control-scale.js';
import {fileFallbackIcon} from './file-type-icons.js';
import { bindPhoneFileGestures } from './phone-file-gestures.js';
import {deviceFilesUrl} from './device-files-pane.js';
import { bindNavigatorRowInteractions } from './navigator-row-interactions.js';
import { createRemoteFileView } from './remote-file-view.js';
import { REMOTE_ROOT, remoteDeviceNames } from './remote-paths.js';
import { moveNavigatorFiles as runNavigatorFileMove, retryNavigatorFileLinks, navigatorFileMoveAllowed } from './navigator-file-transfer.js';
const svg = (paths) => `<svg viewBox="0 0 20 20" aria-hidden="true">${paths.map((d) => `<path d="${d}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}</svg>`;
import { createBreadcrumbPopup } from './navigator-breadcrumb-popup.js';
import { createThumbnailLoader, installThumbnailZoom, isThumbnailImage, FOLDER_ART } from './navigator-thumbnails.js';
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
// Files on another device, dragged between Papers pages: {page, paths:[device paths]}.
export const DEVICE_FILES_DRAG_TYPE = 'application/x-papers-device-files';
// One id per page, shared by the list and the icon grid, so a page ignores its own drags.
const DRAG_PAGE = (globalThis.__papersDragPage ??= (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Math.random())));
// paths: files on another device. local: this computer's files, which a device's view sends to that device's inbox.
export function readDeviceFilesDrag(dataTransfer) {
  try {
    const parsed = JSON.parse(dataTransfer?.getData?.(DEVICE_FILES_DRAG_TYPE) || 'null');
    if (!parsed || parsed.page === DRAG_PAGE) return { paths: [], local: [] };
    return { paths: (Array.isArray(parsed.paths) ? parsed.paths : []).filter((path) => typeof path === 'string' && REMOTE_ROOT.test(path)),
      local: (Array.isArray(parsed.local) ? parsed.local : []).filter((path) => typeof path === 'string' && /^[A-Za-z]:[\\/]/.test(path)) };
  } catch { return { paths: [], local: [] }; }
}
function setDeviceFilesDrag(dataTransfer, paths, local = []) {
  if (paths.length || local.length) dataTransfer?.setData(DEVICE_FILES_DRAG_TYPE, JSON.stringify({ page: DRAG_PAGE, paths, local }));
}
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
export function navigatorPhoneLabel(name,path) {
  if(!/^\\\\papers~phone\\/i.test(String(path||'')))return name;
  const part=String(path).split('\\').filter(Boolean).at(-1);
  if(name!==part)return name; // Preserve authored pill names.
  try{return decodeURIComponent(name);}catch{return name;}
}
const parentPath = (value) => {
  const p = String(value || '').replace(/\//g, '\\').replace(/\\+$/, '');
  const remote = p.match(REMOTE_ROOT);
  if (remote) { const i = p.lastIndexOf('\\'); return i < remote[0].length ? remote[0] : p.slice(0, i); }
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
  if(o.openMachineFolder && (await o.host.fileCapability('stat',{path:target}))?.entry?.kind==='folder'){
    await o.openMachineFolder(target);return true;
  }
  const rows = o.itemsIn(o.getState(), o.currentAyG());
  const row = rows.find(item => item.id === saved.itemId || item.shortcutId === saved.itemId);
  if (row) o.selectAyG(row.id, rows.map(item => item.id), {});
  await o.previewMachinePath(target, saved.name);
  return true;
}

export async function deleteNavigatorSelection(mode, selected, o, selectedPaths = []) {
  if (mode === 'ayg') return o.deleteAyG();
  // The whole batch selection, not only the last clicked row.
  const paths = [...new Set(selectedPaths.length ? selectedPaths : selected ? [selected.path] : [])];
  if (!paths.length) return;
  const recycle = paths.every(path=>/^\\\\papers~phone\\/i.test(path)) ? 'the phone’s Papers recycle folder' : 'the Windows Recycle Bin';
  const message = paths.length === 1
    ? `Delete machine file or folder "${selected?.path === paths[0] ? selected.name : paths[0].split('\\').pop()}"?\n\n${paths[0]}\n\nThis moves the actual file or folder to ${recycle}, including its contents. Continue?`
    : `Delete ${paths.length} machine files or folders?\n\n${paths.slice(0, 8).join('\n')}${paths.length > 8 ? `\n…and ${paths.length - 8} more` : ''}\n\nThis moves the actual files or folders to ${recycle}, including their contents. Continue?`;
  if (!o.confirm(message)) return;
  return o.host.fileCapability('delete', { paths });
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
  const rename = button(d,'Rename',['M4 15h4l8-8-4-4-8 8z','M11 4l4 4']), del = button(d,'Delete',['M4 6h12','M5 6l1 11h8l1-11','M8 6V4h4v2','M8 10l1-2 2 1','M12 11l1 2-2 1','M9 14H7l.5-2']);
  del.classList.add('navigator-recycle-button');
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
  const transferNotice=d.createElement('div');transferNotice.className='workspace-navigator-transfer-notice';transferNotice.hidden=true;transferNotice.setAttribute('role','status');transferNotice.setAttribute('aria-live','polite');let transferNoticeTimer=0;function transferStatus(text,finished=false){clearTimeout(transferNoticeTimer);transferNotice.textContent=text;transferNotice.hidden=!text;if(finished)transferNoticeTimer=setTimeout(()=>transferNotice.hidden=true,5000);o.setStatus(text);}
  const searchInfo = d.createElement('div'); searchInfo.className = 'workspace-navigator-search-info';
  search.append(searchInput, searchInfo,transferNotice);
  const savedPills=d.createElement('div');savedPills.className='navigator-saved-pills';search.insertBefore(savedPills,searchInfo);
  const body = d.createElement('div'); body.className = 'workspace-navigator-body';
  const phoneMode=new URL(d.defaultView.location.href).searchParams.has('papers-phone');
  const graphSlot = o.graphContent ? d.createElement('div') : null;
  // Graph tiles take the same hold-to-select / tap-to-toggle / double-tap-to-open gestures as rows.
  const phoneGestures=phoneMode?bindPhoneFileGestures({body,extra:[graphSlot],window:d.defaultView}):null;
  let refreshGraphVisibility = () => {};
  // The view button shows the current view (list, graph, thumbnails); clicking it drops down the other
  // views to pick from (graph only where it applies: As you Go, not a real folder). The mode is
  // remembered per root here and in the document's preferences.
  const VIEW_MODES=['list','graph','thumbs'];
  const VIEW_ICONS={list:['M3 5h14','M3 10h14','M3 15h14'],graph:['M3 4h4v4H3z','M13 12h4v4h-4z','M7 6l8 8'],thumbs:['M4 4h12v12H4z']};
  const VIEW_NAMES={list:'List',graph:'Graph',thumbs:'Thumbnails'};
  const thumbnails=createThumbnailLoader({host:o.host,window:d.defaultView});
  {
    if (graphSlot) { graphSlot.className = 'navigator-graph-surface'; graphSlot.append(o.graphContent); }
    const viewToggle = button(d,'View: list, graph or thumbnails',VIEW_ICONS.list);
    viewToggle.classList.add('navigator-view-toggle');
    let viewMode = 'list', viewModeSaving = false;
    try { const stored = d.defaultView.localStorage.getItem('papers:ayg:left-graph:'+o.rootId); viewMode = stored === '1' ? 'graph' : VIEW_MODES.includes(stored) ? stored : 'list'; } catch {}
    const saved = () => { const p=o.getState().view?.preferences||{}; return VIEW_MODES.includes(p.navigatorViewMode) ? p.navigatorViewMode : typeof p.navigatorGraphMode==='boolean' ? (p.navigatorGraphMode ? 'graph' : 'list') : null; };
    const available = () => graphSlot && s.mode==='ayg' ? VIEW_MODES : ['list','thumbs'];
    const apply = () => {
      const stored=saved(); if(!viewModeSaving&&stored)viewMode=stored;
      const graphVisible=!!graphSlot&&viewMode==='graph'&&s.mode==='ayg'&&!s.searchQuery;
      s.graphViewActive=graphVisible; panel.classList.toggle('graph-mode',graphVisible);
      if (graphSlot) { graphSlot.hidden = !graphVisible; body.hidden = graphVisible; }
      const thumbs=viewMode==='thumbs'&&!s.searchQuery;
      if (thumbs !== Boolean(s.thumbsActive)) {
        s.thumbsActive=thumbs; panel.classList.toggle('thumbs-mode',thumbs);
        // Thumbnails show one folder at a time; the list's own tree/flat choice comes back after.
        if (thumbs) { s.viewBeforeThumbs=s.view; s.view='nav'; if(s.mode==='machine'&&!s.path)s.path=s.machineRoot; }
        else { if (s.viewBeforeThumbs) s.view=s.viewBeforeThumbs; s.viewBeforeThumbs=null; thumbnails.releaseAll(); }
      }
      const shown=available().includes(viewMode)?viewMode:'list';
      if(viewToggle.dataset.viewMode!==viewMode||viewToggle.dataset.shown!==shown){viewToggle.innerHTML=svg(VIEW_ICONS[shown]);viewToggle.dataset.shown=shown;}
      viewToggle.setAttribute('aria-pressed',String(viewMode!=='list')); viewToggle.dataset.viewMode=viewMode;
    };
    let viewMenu=null;
    const closeViewMenu=()=>{viewMenu?.remove();viewMenu=null;};
    const chooseView=mode=>{
      closeViewMenu();if(mode===viewMode)return;viewMode=mode;
      persistUi('papers:ayg:left-graph:'+o.rootId,viewMode);viewModeSaving=true;render();
      Promise.resolve(o.saveNavigatorGraphMode?.(viewMode)).finally(()=>{viewModeSaving=false;render();});
    };
    refreshGraphVisibility=apply;
    const openViewMenu=()=>{
      if(viewMenu)return;
      const current=available().includes(viewMode)?viewMode:'list';
      viewMenu=d.createElement('div');viewMenu.className='navigator-view-menu';viewMenu.setAttribute('role','menu');
      for(const mode of available().filter(m=>m!==current)){const item=button(d,VIEW_NAMES[mode],VIEW_ICONS[mode]);item.setAttribute('role','menuitem');item.addEventListener('click',e=>{e.stopPropagation();chooseView(mode);});viewMenu.append(item);}
      const box=viewToggle.getBoundingClientRect();viewMenu.style.left=Math.round(box.left)+'px';viewMenu.style.top=Math.round(box.bottom+4)+'px';
      d.body.append(viewMenu);
      setTimeout(()=>d.addEventListener('pointerdown',function away(e){if(viewMenu&&!viewMenu.contains(e.target)&&e.target!==viewToggle&&!viewToggle.contains(e.target))closeViewMenu();if(!viewMenu)d.removeEventListener('pointerdown',away,true);},true));
      // On a computer the menu also follows the mouse: it opens on hover and closes once the mouse
      // has left both the button and the menu.
      if(!hoverMenus)return;
      viewMenu.addEventListener('mouseenter',()=>clearTimeout(hoverClose));
      viewMenu.addEventListener('mouseleave',scheduleHoverClose);
    };
    const hoverMenus=!new URL(d.defaultView.location.href).searchParams.has('papers-phone')&&d.defaultView.matchMedia?.('(hover: hover)')?.matches!==false;
    let hoverClose=0;const scheduleHoverClose=()=>{clearTimeout(hoverClose);hoverClose=setTimeout(closeViewMenu,250);};
    viewToggle.addEventListener('click',event=>{event.stopPropagation();if(viewMenu&&!hoverMenus){closeViewMenu();return;}openViewMenu();});
    if(hoverMenus){viewToggle.addEventListener('mouseenter',()=>{clearTimeout(hoverClose);openViewMenu();});viewToggle.addEventListener('mouseleave',scheduleHoverClose);}
    tools.append(viewToggle); apply();
  }
  const viewOptions={ayg:defaultViewOptions(),machine:{...defaultViewOptions(),key:'name'}},viewMetadata=new Map(),metadataPending=new Set(),metadataQueue=[];let metadataRunning=0;let metadataTimer=0,optionsPanel=null;
  for(const mode of ['ayg','machine'])try{Object.assign(viewOptions[mode],JSON.parse(d.defaultView.localStorage.getItem('papers:ayg:view-options:'+o.rootId+':'+(o.host.deviceId||'local')+':'+mode)||'null'));validateViewOptions(viewOptions[mode]);}catch{viewOptions[mode]=mode==='machine'?{...defaultViewOptions(),key:'name'}:defaultViewOptions();}
  const saveViewOptions=()=>{try{d.defaultView.localStorage.setItem('papers:ayg:view-options:'+o.rootId+':'+(o.host.deviceId||'local')+':'+s.mode,JSON.stringify(viewOptions[s.mode]));}catch{}};
  const pumpMetadata=()=>{while(metadataRunning<4&&metadataQueue.length){const path=metadataQueue.shift();metadataRunning++;Promise.resolve(o.host.fileCapability('stat',{path})).then(result=>viewMetadata.set(path,result?.ok?result.entry:{})).catch(()=>viewMetadata.set(path,{})).finally(()=>{metadataPending.delete(path);metadataRunning--;clearTimeout(metadataTimer);metadataTimer=setTimeout(()=>render(),70);pumpMetadata();});}};
  s.machineSort={key:viewOptions.machine.key,direction:viewOptions.machine.direction};
  refresh.addEventListener('click',()=>{viewMetadata.clear();customIcons.clear();});
  const projectRows=items=>{
    const options=viewOptions[s.mode];
    if(s.mode==='ayg'&&(options.key==='size'||options.key==='modified'||options.minSize||options.maxSize||options.after||options.before||/folder/.test(options.type))){
      for(const item of items){const path=item.target;if(!path||item.kind==='group'||viewMetadata.has(path)||metadataPending.has(path))continue;metadataPending.add(path);metadataQueue.push(path);}
    }
    pumpMetadata();return projectNavigatorItems(items,options,viewMetadata);
  };
  const optionsButton=button(d,'Sort and filter this folder',['M3 4h14l-5.5 6v6l-3-1v-5z']);tools.append(optionsButton);
  optionsButton.addEventListener('click',event=>{
    event.stopPropagation();if(optionsPanel){optionsPanel.remove();optionsPanel=null;return;}
    const mode=s.mode,current={...viewOptions[mode]},form=d.createElement('form');form.dataset.mode=mode;optionsPanel=form;form.className='navigator-view-options';form.setAttribute('aria-label','Sort and filter this folder');const title=d.createElement('strong');title.textContent='Sort & filter';form.append(title);
    const fields={};
    const field=(key,label,type='text',choices=null)=>{const wrap=d.createElement('label');wrap.textContent=label;const input=d.createElement(choices?'select':'input');if(choices)for(const [value,text]of choices){const option=d.createElement('option');option.value=value;option.textContent=text;input.append(option);}else input.type=type;input.name=key;input.setAttribute('aria-label',label);input.value=String(current[key]??'');wrap.append(input);form.append(wrap);fields[key]=input;};
    if(!s.graphViewActive){field('key','Sort by','text',[['manual','Manual order'],['name','Name'],['type','Type'],['size','Size'],['modified','Modified date'],...(s.searchQuery?[['path','Path']]:[])]);field('direction','Order','text',[['1','Ascending'],['-1','Descending']]);}
    field('name','Name contains');field('type','Type / extension');fields.type.placeholder='pdf, jpg, folders, images…';field('minSize','Minimum size');fields.minSize.placeholder='500 KB';field('maxSize','Maximum size');fields.maxSize.placeholder='10 MB';field('after','Modified from','date');field('before','Modified through','date');
    {const wrap=d.createElement('label');wrap.className='navigator-view-options-check';const input=d.createElement('input');input.type='checkbox';input.name='showHidden';input.checked=current.showHidden===true;wrap.append(input,d.createTextNode('Show hidden items'));form.append(wrap);fields.showHidden=input;}
    const message=d.createElement('p');message.setAttribute('role','status');form.append(message);const actions=d.createElement('div');for(const [label,action]of [['Reset','reset'],['Cancel','button'],['Apply','submit']]){const b=d.createElement('button');b.type=action;b.textContent=label;if(label==='Cancel')b.addEventListener('click',()=>{form.remove();optionsPanel=null;});actions.append(b);}form.append(actions);
    form.addEventListener('reset',event=>{event.preventDefault();Object.assign(viewOptions[mode],defaultViewOptions());if(mode==='machine')s.machineSort={key:'manual',direction:1};s.searchSort={key:null,direction:1};saveViewOptions();form.remove();optionsPanel=null;render();});
    form.addEventListener('submit',event=>{event.preventDefault();try{const next={...current};for(const [key,input]of Object.entries(fields))next[key]=key==='direction'?Number(input.value):input.type==='checkbox'?input.checked:input.value;validateViewOptions(next);viewOptions[mode]=next;saveViewOptions();if(mode==='machine')s.machineSort={key:next.key,direction:next.direction};if(s.searchQuery)s.searchSort={key:next.key==='manual'?null:next.key,direction:next.direction};form.remove();optionsPanel=null;render();}catch(error){message.textContent=error.message;}});
    const rect=optionsButton.getBoundingClientRect();form.style.left=Math.max(8,Math.min(rect.left,d.defaultView.innerWidth-320))+'px';form.style.top=Math.min(rect.bottom+6,Math.max(8,d.defaultView.innerHeight-440))+'px';d.body.append(form);fields.name.focus();
  });
  const resizer = d.createElement('div'); resizer.className = 'workspace-navigator-resizer'; resizer.setAttribute('role','separator'); resizer.setAttribute('aria-orientation','vertical'); resizer.setAttribute('aria-label','Resize navigator');
  panel.replaceChildren(head,search,loc,body,resizer);
  const remoteFiles = createRemoteFileView({ document: d, container: panel, call: params => o.host.fileCapability('remote-files', params) });
  const devices = button(d, 'Files on another device', ['M2 3h10v8H2z', 'M6 11v3', 'M3 14h6', 'M14 7h4v10h-4z']);
  devices.classList.add('navigator-devices-button');
  devices.addEventListener('click', () => { void breadcrumbPopup.show(devices, { devices: true }, addDeviceSettings); });
  // The pill opens the six places (each device's files or As you Go); right-click opens it too.
  provider.addEventListener('contextmenu', event => { event.preventDefault(); event.stopPropagation(); void openModeMenu(); });
  if (graphSlot) { panel.insertBefore(graphSlot,resizer); panel.classList.add('has-graph-surface'); }
  // Holding Shift turns the selection blue: a drag now carries the real files to other apps.
  const shiftExport=on=>panel.classList.toggle('shift-export',Boolean(on));
  d.addEventListener('keydown',event=>{if(event.key==='Shift')shiftExport(true);},true);
  d.addEventListener('keyup',event=>{if(event.key==='Shift')shiftExport(false);},true);
  d.addEventListener('pointermove',event=>shiftExport(event.shiftKey),{capture:true,passive:true});
  d.defaultView.addEventListener('blur',()=>shiftExport(false));
  installThumbnailZoom({panel,surface:body,window:d.defaultView,isActive:()=>Boolean(s.thumbsActive)});
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
      else {s.machineSelected=new Set(ids);s.selected=s.machineRows.get(ids.at(-1))||null;if(ids.length)claimSelection();}
      const selected=s.mode==='ayg'?o.getSession().selected:s.machineSelected;
      body.querySelectorAll('.workspace-navigator-row[data-id]').forEach(row=>row.classList.toggle('selected',selected.has(row.dataset.id)));
    },
    reorder: async plan => {
      viewOptions[s.mode].key='manual';saveViewOptions();
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
      : fileFallbackIcon(x);
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
      if (!source || !art.isConnected || art.classList.contains('has-custom-icon')) return;
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
  // Custom pictures of real files and folders, kept on the device that owns them (Papers
  // customIconStore / PhoneCustomIcons): one request per folder, shared by its rows.
  const customIcons = new Map();
  function customIconsIn(folder) {
    const key = String(folder || '').toLocaleLowerCase();
    if (!customIcons.has(key)) customIcons.set(key, Promise.resolve(o.host.fileCapability('custom-icons', { path: folder }))
      .then((result) => result?.ok && result.icons && typeof result.icons === 'object' ? result.icons : {}).catch(() => ({})));
    return customIcons.get(key);
  }
  function applyCustomIcon(art, item) {
    void customIconsIn(parentPath(item.path)).then((icons) => {
      const name = String(item.name || ''), lower = name.toLocaleLowerCase();
      const icon = icons[name] ?? Object.entries(icons).find(([key]) => key.toLocaleLowerCase() === lower)?.[1];
      if (!icon || !art.isConnected || !/^data:image\//.test(icon)) return;
      const image = d.createElement('img'); image.src = icon; image.alt = ''; image.className = 'navigator-custom-icon';
      art.classList.add('has-custom-icon'); art.replaceChildren(image);
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
  // The provider pill names the device whose As you Go this is (this one, or the device opened here).
  let deviceLabel = null;
  void (async () => {
    if (o.remoteDevice) { await remoteDevices(); deviceLabel = remoteDeviceNames.get(`\\\\papers~${o.remoteDevice}`.toLowerCase()) || null; }
    else { const status = await o.host.fileCapability('remote-files', { operation: 'status' }).catch(() => null); deviceLabel = status?.ok ? status.result?.owner?.name || null : null; }
    syncChrome();
  })();
  // "This device" heads the devices popup: back to this device's own As you Go from another device's.
  function returnToThisDevice() {
    if (o.remoteDevice) { o.leaveDevice?.(); return; }
    if (s.mode === 'machine' && REMOTE_ROOT.test(String(s.path || ''))) { clearSearch({ renderNow: false }); setMode('ayg'); }
  }
  // Gear in the devices popup: each device's inbox, where files dropped into its As you Go land.
  function addDeviceSettings(popup, { isOpen }) {
    const gear = button(d, 'Device settings', ['M10 7.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5z', 'M10 2v2.5M10 15.5V18M2 10h2.5M15.5 10H18M4.3 4.3l1.8 1.8M13.9 13.9l1.8 1.8M4.3 15.7l1.8-1.8M13.9 6.1l1.8-1.8']);
    gear.classList.add('navigator-device-settings-button');
    gear.addEventListener('click', async event => {
      event.stopPropagation();
      const devicesList = await remoteDevices();
      // This computer's own inbox comes first.
      const own = o.host.deviceId ? null : await o.host.fileCapability('remote-files', { operation: 'status' }).then(value => value?.result?.owner).catch(() => null);
      if (!isOpen()) return;
      popup.replaceChildren(gear);
      // The phone's download folder lives with the other device settings.
    if(new URL(d.defaultView.location.href).searchParams.has('papers-phone')){
      const folder=d.createElement('button');folder.type='button';folder.style.cssText='display:flex;align-items:center;gap:12px;width:100%;max-width:none;padding:8px 10px;margin:0 0 6px;background:transparent;border:0;border-bottom:1px solid #ffffff18;border-radius:0;color:inherit;font:inherit;text-align:left;white-space:nowrap';const title=d.createElement('span'),value=d.createElement('span');title.textContent='Download to';title.style.opacity='.65';value.textContent='Loading…';value.style.cssText='margin-left:auto;overflow:hidden;text-overflow:ellipsis;min-width:0;font-size:12px';folder.append(title,value);popup.append(folder);
      const show=response=>{const result=response?.result??response;value.textContent=result?.valid?result.name:'Choose folder…';folder.title=result?.valid?'Change phone download folder':'Choose a writable phone folder';};
      void o.host.fileCapability('remote-files',{operation:'download-folder'}).then(value=>{if(isOpen())show(value);});
      folder.addEventListener('click',async()=>{folder.disabled=true;try{const value=await o.host.fileCapability('remote-files',{operation:'download-folder-pick'});if(value?.ok===false)throw Error(value.message);if(isOpen())show(value);}catch(error){o.setStatus(error.message);}finally{folder.disabled=false;}});
    }
      for (const device of [...(own?.id ? [{ path: '\\\\papers~' + own.id, name: own.name || 'This device' }] : []), ...devicesList]) {
        const id = device.path.slice(9);
        const row = d.createElement('label'); row.className = 'navigator-device-inbox';
        const name = d.createElement('span'); name.className = 'navigator-device-inbox-name'; name.textContent = device.name + ' inbox';
        const input = d.createElement('input'); input.type = 'text'; input.spellcheck = false; input.placeholder = 'Loading…'; input.setAttribute('aria-label', device.name + ' inbox folder');
        const note = d.createElement('span'); note.className = 'navigator-device-inbox-note'; note.setAttribute('role', 'status');
        row.append(name, input, note); popup.append(row);
        const show = result => { if (result?.ok) { input.value = result.result.parts.join('\\'); input.placeholder = ''; note.textContent = result.result.chosen ? '' : 'Default'; } else note.textContent = result?.message || 'That device is unavailable.'; };
        void o.host.fileCapability('remote-files', { operation: 'inbox', ownerId: id }).then(show);
        input.addEventListener('keydown', async keyEvent => {
          if (keyEvent.key !== 'Enter') return;
          keyEvent.preventDefault(); note.textContent = 'Saving…';
          const result = await o.host.fileCapability('remote-files', { operation: 'inbox-set', ownerId: id, path: input.value.trim() || null });
          show(result); if (result?.ok) note.textContent = result.result.chosen ? 'Saved' : 'Default';
        });
      }
    });
    popup.append(gear);
  }
  // The pill's menu: every device, each with its real files and its As you Go.
  const PHONE_PAGE = new URL(d.defaultView.location.href).searchParams.has('papers-phone');
  const MODE_ICONS = { files: ['M2.5 6h5l1.5 2h8.5v8.5h-15z'], ayg: ['M3 3.5h6v6H3z', 'M11 3.5h6v6h-6z', 'M3 11.5h6v5H3z', 'M11 11.5h6v5h-6z'] };
  const MODE_NAMES = { files: 'Files', ayg: 'As you Go' };
  let modeMenu = null, modeHoverClose = 0;
  const closeModeMenu = () => { clearTimeout(modeHoverClose); modeMenu?.remove(); modeMenu = null; };
  // On a computer the menu follows the mouse, like the view button's: hover opens it, leaving both
  // the pill and the menu closes it.
  const HOVER_MENUS = !PHONE_PAGE && d.defaultView.matchMedia?.('(hover: hover)')?.matches !== false;
  const scheduleModeClose = () => { clearTimeout(modeHoverClose); modeHoverClose = setTimeout(closeModeMenu, 250); };
  if (HOVER_MENUS) {
    provider.addEventListener('mouseenter', () => { clearTimeout(modeHoverClose); if (!modeMenu) void openModeMenu(); });
    provider.addEventListener('mouseleave', scheduleModeClose);
  }
  async function openModeMenu({ toggle = true } = {}) {
    if (modeMenu) { if (toggle && !HOVER_MENUS) closeModeMenu(); return; }
    const menu = modeMenu = d.createElement('div'); menu.className = 'navigator-mode-menu'; menu.setAttribute('role', 'menu');
    if (HOVER_MENUS) { menu.addEventListener('mouseenter', () => clearTimeout(modeHoverClose)); menu.addEventListener('mouseleave', scheduleModeClose); }
    const box = provider.getBoundingClientRect();
    menu.style.left = Math.round(Math.max(8, Math.min(box.left, d.defaultView.innerWidth - 280))) + 'px'; menu.style.top = Math.round(box.bottom + 4) + 'px';
    d.body.append(menu);
    setTimeout(() => d.addEventListener('pointerdown', function away(event) { if (modeMenu === menu && !menu.contains(event.target) && !provider.contains(event.target)) closeModeMenu(); if (modeMenu !== menu) d.removeEventListener('pointerdown', away, true); }, true));
    const devicesList = await remoteDevices().catch(() => []);
    if (modeMenu !== menu) return;
    const current = currentDeviceMode({ remoteDevice: o.remoteDevice, mode: s.mode, path: s.path });
    const rows = [{ device: 'self', name: 'This device' }, ...devicesList.map(device => ({ device: device.deviceId.toLowerCase(), name: device.name }))];
    for (const row of rows) {
      const line = d.createElement('div'); line.className = 'navigator-mode-row';
      const name = d.createElement('span'); name.className = 'navigator-mode-name'; name.textContent = row.name;
      line.append(name);
      for (const mode of ['files', 'ayg']) {
        const target = { device: row.device, mode }, choice = button(d, `${row.name}: ${MODE_NAMES[mode]}`, MODE_ICONS[mode]);
        choice.classList.add('navigator-mode-choice'); choice.setAttribute('role', 'menuitemradio');
        const active = sameDeviceMode(current, target); choice.classList.toggle('active', active); choice.setAttribute('aria-checked', String(active));
        choice.addEventListener('click', event => { event.stopPropagation(); closeModeMenu(); void navigateToMode(target); });
        // Middle-click: the same place in a new tab (computers).
        choice.addEventListener('mousedown', event => { if (event.button === 1) event.preventDefault(); });
        choice.addEventListener('auxclick', event => { if (event.button !== 1) return; event.preventDefault(); event.stopPropagation(); closeModeMenu(); void openModeInNewTab(target); });
        line.append(choice);
      }
      menu.append(line);
    }
    addDeviceSettings(menu, { isOpen: () => modeMenu === menu });
  }
  // This device's own files: the phone's internal storage, or the folder Files last showed on a computer.
  async function ownFilesRoot() {
    if (PHONE_PAGE) return '\\\\papers~phone\\primary';
    let root = null; try { root = d.defaultView.localStorage.getItem('papers:ayg:navigator-local-root'); } catch {}
    if (!root && s.machineRoot && !/^\\\\papers~/i.test(s.machineRoot)) root = s.machineRoot;
    if (root) { const stat = await o.host.fileCapability('stat', { path: root }).catch(() => null); if (stat?.ok && stat.entry?.kind === 'folder') return root; }
    return null;
  }
  async function openDeviceAyg(deviceId) {
    const next = new URL(d.defaultView.location.href);
    for (const key of ['papers-surface', 'as-you-go-folder']) next.searchParams.delete(key);
    next.searchParams.set('papers-device', deviceId);
    try { if (await o.openDeviceInline?.(next.toString())) return; await o.host.openNewSurface(next.toString()); }
    catch (error) { o.setStatus(error instanceof Error ? error.message : String(error)); }
  }
  async function openModeInNewTab(target) {
    const next = new URL(d.defaultView.location.href);
    for (const key of ['papers-surface', 'as-you-go-folder', 'papers-device', 'papers-navigate', 'papers-inline-device', 'papers-files-parent', 'papers-files-group']) next.searchParams.delete(key);
    if (target.device !== 'self' && target.mode === 'ayg') next.searchParams.set('papers-device', target.device);
    else next.searchParams.set('papers-navigate', formatNavigateTarget(target));
    try { await o.host.openNewSurface(next.toString()); } catch (error) { o.setStatus(error instanceof Error ? error.message : String(error)); }
  }
  async function navigateToMode(target) {
    if (sameDeviceMode(currentDeviceMode({ remoteDevice: o.remoteDevice, mode: s.mode, path: s.path }), target)) return;
    if (o.remoteDevice) {
      // On another device's As you Go page, its own As you Go stays here; anything else goes back to
      // this device's page, which carries the choice out (device-modes.js).
      if (target.device === String(o.remoteDevice).toLowerCase() && target.mode === 'ayg') { clearSearch({ renderNow: false }); setMode('ayg'); return; }
      o.leaveDevice?.(target); return;
    }
    clearSearch({ renderNow: false });
    if (target.device === 'self' && target.mode === 'ayg') { setMode('ayg'); return; }
    if (target.device === 'self') {
      const root = await ownFilesRoot();
      if (root) { await enterMachine(root, false); return; }
      if (s.mode === 'machine') setMode('ayg');
      await switchProvider();
      // Nothing remembered and nothing local in this As you Go: start at the system drive.
      if (s.mode !== 'machine' && !PHONE_PAGE) await enterMachine('C:\\', false);
      return;
    }
    if (target.mode === 'files') { await enterMachine(`\\\\papers~${target.device}`, false); return; }
    await openDeviceAyg(target.device);
  }
  // A choice made on another device's page arrives at this page only: in its address when a computer
  // tab returns here, from the phone shell when the device's layer closes, or (a device shown inside a
  // Files group) through storage, taken once.
  if (!o.remoteDevice) {
    const url = new URL(d.defaultView.location.href), carried = parseNavigateTarget(url.searchParams.get('papers-navigate'));
    if (url.searchParams.has('papers-navigate')) { url.searchParams.delete('papers-navigate'); try { d.defaultView.history.replaceState(d.defaultView.history.state, '', url.toString()); } catch {} }
    if (carried) setTimeout(() => void navigateToMode(carried), 0);
    d.defaultView.addEventListener('message', event => {
      if (event.source !== d.defaultView.parent || event.origin !== d.defaultView.location.origin || event.data?.type !== 'papers:phone:navigate') return;
      const target = parseNavigateTarget(event.data.navigate); if (target) void navigateToMode(target);
    });
    const applyStored = () => { const target = takeNavigateIntent(d.defaultView.localStorage); if (target) void navigateToMode(target); };
    if (!PHONE_PAGE) d.defaultView.addEventListener('storage', event => { if (event.key === NAVIGATE_INTENT_KEY && event.newValue && d.defaultView.document.visibilityState === 'visible') applyStored(); });
  }
  async function remoteDevices() {
    const status = await o.host.fileCapability('remote-files', { operation: 'status' }).catch(() => null);
    const devices = status?.ok ? status.result?.devices || [] : [];
    for (const device of devices) remoteDeviceNames.set(`\\\\papers~${device.id}`.toLowerCase(), device.name);
    return devices.map(device => ({ deviceId:device.id, path: `\\\\papers~${device.id}`, name: device.name, kind: 'folder' }));
  }
  function syncChrome() {
    panel.dataset.mode = s.mode;
    panel.dataset.view = s.view;
    const remoteRoot = s.mode === 'machine' && String(s.path || '').match(REMOTE_ROOT);
    provider.textContent = remoteRoot ? remoteDeviceNames.get(remoteRoot[0].toLowerCase()) || 'Device' : s.mode === 'machine' ? (/^\\\\papers~phone\\/i.test(s.path||'') ? deviceLabel || 'This phone' : 'Opus') : deviceLabel || 'As you Go';
    provider.title = 'Devices: files or As you Go (middle-click a choice for a new tab)';
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
    reveal.disabled = !revealPath();
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
    const device = s.mode === 'machine' && String(s.path || '').match(REMOTE_ROOT);
    if (device) {
      // Inside a device's drives, the provider switch opens that device's own As you Go.
      const next = new URL(d.defaultView.location.href);
      for (const key of ['papers-surface', 'as-you-go-folder']) next.searchParams.delete(key);
      next.searchParams.set('papers-device', device[0].slice(9).toLowerCase());
      // Inline where the page can navigate itself (a computer's tab); the phone opens it as a layer.
      try { if (await o.openDeviceInline?.(next.toString())) return; } catch(error) { o.setStatus(error instanceof Error ? error.message : String(error)); return; }
      try { await o.host.openNewSurface(next.toString()); }
      catch (error) { o.setStatus(error instanceof Error ? error.message : String(error)); }
      return;
    }
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
    const deviceDrag=segment.item&&!s.internalDragSource?readDeviceFilesDrag(event.dataTransfer):{paths:[],local:[]};
    if((deviceDrag.paths.length||deviceDrag.local.length)&&o.importDevicePaths){s.nativeDragSource=null;dropPending=false;await o.importDevicePaths(deviceDrag.paths,segment.item.id||o.rootId,deviceDrag.local);render();return;}
    const files = [...(event.dataTransfer?.files || [])];
    const transferredAyG = parseAyGDragPayload(event.dataTransfer);
    const transferredMachine = parseDragList(event.dataTransfer, NAVIGATOR_MACHINE_DRAG_TYPE);
    const dragSources = navigatorDropDragSources({
      transferredAyG,
      transferredMachine,
      internalDragSource:s.internalDragSource,
    });
    if(segment.item && dragSources.machine.length && dragSources.machine.every(path=>/^\\\\papers~phone\\/i.test(path)) && o.importDevicePaths){await o.importDevicePaths(dragSources.machine,segment.item.id||o.rootId);render();return;}
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
      const deviceFiles=Boolean(segment.item&&o.importDevicePaths&&types.includes(DEVICE_FILES_DRAG_TYPE)&&!s.internalDragSource);
      if(deviceFiles){event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect=navigatorDropEffect(event.dataTransfer.effectAllowed,'copy');moveHint.hidden=true;if(s.activeDropTarget!==element){s.activeDropTarget?.classList.remove('drop-target');s.activeDropTarget=element;element.classList.add('drop-target');}return;}
      const phoneLinks=segment.item&&o.importDevicePaths&&types.includes(NAVIGATOR_MACHINE_DRAG_TYPE)&&s.internalDragSource?.paths?.every(path=>/^\\\\papers~phone\\/i.test(path));
      if(!types.includes('Files')&&!types.includes(internalType)&&s.internalDragSource?.mode!==expectedMode&&!phoneLinks)return;
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
      crumb.addEventListener('pointerdown',event=>{if(event.button===1)event.preventDefault();});
      crumb.addEventListener('auxclick',async event=>{if(event.button!==1)return;event.preventDefault();event.stopPropagation();const absolute=segment.path||o.nativeDragPaths?.([segment.item?.id])?.[0];if(!absolute||!o.isAbsoluteWindowsPath(absolute)){o.setStatus('This breadcrumb has no local folder path.');return;}try{await o.host.copyText(absolute);o.setStatus('Copied '+absolute);}catch(error){o.setStatus(error.message||'Could not copy this path.');}});
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
    for (const x of projectRows(o.itemsIn(o.getState(), parent).filter((v) => v.kind !== 'window-layout'))) {
      const id = x.id, row = d.createElement('div');const start=treeRowIndex++;
      row.draggable=true;
      row.addEventListener('dragstart',event=>{
        const dragPayload=navigatorAyGDragPayload({
          itemId:id,
          selectedIds:o.getSession().selected,
          resolveIdentity:o.resolveAyGDragIdentity,
        });
        event.dataTransfer?.setData(NAVIGATOR_AYG_DRAG_TYPE,JSON.stringify(dragPayload));
        if(!o.host?.deviceId)setDeviceFilesDrag(event.dataTransfer,[],aygNavigatorNativePaths({itemId:id,selectedIds:o.getSession().selected,resolvePaths:o.nativeDragPaths}));
        else setDeviceFilesDrag(event.dataTransfer,aygNavigatorNativePaths({itemId:id,selectedIds:o.getSession().selected,resolvePaths:o.nativeDragPaths}).map(path=>REMOTE_ROOT.test(path)?path:'\\\\papers~'+o.host.deviceId+'\\'+path));
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
          // Normal dragging moves the AYG link. Shift explicitly exports the
          // underlying file to Windows, whose native loop cancels HTML drag.
          if (!event.shiftKey) return;
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
        row.title = 'Drag to move in As you Go; Shift-drag to drag the file into another application';
      }
      if (x.kind === 'group') {
        const t = d.createElement('button'); t.type='button'; t.className='navigator-tree-toggle'; t.textContent=s.thumbsActive?'>':s.expanded.has(x.id)?'':'>'; if(s.thumbsActive)t.classList.toggle('is-expanded',s.expanded.has(x.id));
        t.addEventListener('click',(e)=>{e.stopPropagation(); s.expanded.has(x.id)?s.expanded.delete(x.id):s.expanded.add(x.id); render();}); row.append(t);
      } else { const sp=d.createElement('span'); sp.className='navigator-tree-spacer'; row.append(sp); }
      const art=d.createElement('span'); art.className='workspace-navigator-art'; art.innerHTML=icon(x);
      // Thumbnails: folders take the graph's folder art and images their real picture; the icon
      // loader would overwrite either when it finishes, so it runs only for the rest.
      const thumbArt=s.thumbsActive&&!x.icon&&(x.kind==='group'||(!o.isWebLink(x)&&(isThumbnailImage(x.target)||isThumbnailImage(x.name))));
      // A link to a real path waits for its stat below in thumbnails: a folder takes folder art.
      const awaitStat=s.thumbsActive&&!x.icon&&!thumbArt&&x.kind!=='group'&&!o.isWebLink(x)&&o.isAbsoluteWindowsPath(x.target);
      if(!thumbArt&&!awaitStat)hydrateArt(art, x);
      else if(x.kind==='group')art.innerHTML=FOLDER_ART;else thumbnails.observe(art,x.target,x.name);
      const label=d.createElement('span'); label.className='workspace-navigator-label'; label.textContent=(x.id.startsWith('group-proxima-')?'\u2605 ':'')+(s.thumbsActive&&x.kind==='group'?'> ':'')+(x.name||'Untitled');
      if(x.kind!=='group'&&!o.isWebLink(x)&&o.isAbsoluteWindowsPath(x.target)){
        void o.host.fileCapability('stat',{path:x.target}).then(result=>{
          if(awaitStat){if(result?.ok&&result.entry?.kind==='folder')art.innerHTML=FOLDER_ART;else hydrateArt(art,x);}
          if(result?.ok&&result.entry?.kind==='folder'&&label.isConnected){
            row.classList.add('navigator-filesystem-link');
            installNavigatorDropTarget(row,{path:x.target});
            const marker=d.createElement('span');marker.className='navigator-linked-folder-marker';marker.textContent=' <';label.append(marker);
          }
        }).catch(()=>{if(awaitStat)hydrateArt(art,x);});
      }

      if(x.id.startsWith('group-proxima-'))label.classList.add('navigator-proxima-label');
      if(x.kind==='group'&&s.expanded.has(x.id)&&!s.thumbsActive){const h=d.createElement('span');h.className='navigator-tree-folder-heading';h.append(art,label);row.append(h);row.classList.add('navigator-tree-expanded');}else row.append(art,label);
      row.tabIndex=-1;
      row.addEventListener('click',(e)=>{row.focus({preventScroll:true});if(e.shiftKey&&!e.ctrlKey){e.preventDefault();void enterAyG(x);return;}o.selectAyG(id,visibleIds(),{ctrlKey:e.ctrlKey});syncChrome();body.querySelectorAll('.workspace-navigator-row[data-id]').forEach(candidate=>candidate.classList.toggle('selected',o.getSession().selected.has(candidate.dataset.id)));body.tabIndex=-1;body.focus({preventScroll:true});});
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
      body.replaceChildren(...(s.thumbsActive?[thumbsSortBar()]:[]),aygChildren(current));paintTreeBranches();
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
    const source=projectRows([...(s.searchResult?.results||[])]), filters=s.searchFilters;
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
    return filtered;
  }
  // Thumbnails get Opus's sort bar above the grid: Name, Size, Type, Modified; again reverses. In As you
  // Go a third press returns to its own (manual) order.
  function thumbsSortBar() {
    const bar = d.createElement('div'); bar.className = 'navigator-thumbs-sort'; bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'Sort');
    const machine = s.mode === 'machine', current = machine ? s.machineSort : viewOptions.ayg;
    for (const [key, label] of [['name', 'Name'], ['size', 'Size'], ['type', 'Type'], ['modified', 'Modified']]) {
      const sort = d.createElement('button'); sort.type = 'button'; sort.className = 'navigator-thumbs-sort-key';
      const active = current.key === key; sort.classList.toggle('active', active);
      sort.textContent = label + (active ? (current.direction === -1 ? ' ▼' : ' ▲') : '');
      sort.title = `Sort by ${label}`; sort.setAttribute('aria-pressed', String(active));
      sort.addEventListener('click', () => {
        if (machine) {
          s.machineSort = s.machineSort.key === key ? { key, direction: -s.machineSort.direction } : { key, direction: 1 };
          viewOptions.machine.key = key; viewOptions.machine.direction = s.machineSort.direction; saveViewOptions(); s.machineOrders.delete(s.path);
          if (s.path) void loadMachine(s.path, false);
          return;
        }
        const options = viewOptions.ayg;
        if (options.key !== key) { options.key = key; options.direction = 1; }
        else if (options.direction === 1) options.direction = -1;
        else { options.key = 'manual'; options.direction = 1; }
        saveViewOptions(); render();
      });
      bar.append(sort);
    }
    return bar;
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
        viewOptions.machine.key=key;viewOptions.machine.direction=s.machineSort.direction;saveViewOptions();s.machineOrders.delete(s.path);
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
        viewOptions[s.mode].key=key;viewOptions[s.mode].direction=s.searchSort.direction;saveViewOptions();renderSearch();
      });
      const input=d.createElement('input'); input.type='search'; input.value=s.searchFilters[key]||''; input.placeholder=placeholder; input.autocomplete='off'; input.spellcheck=false;
      input.setAttribute('aria-label',`Filter ${label}`);
      input.addEventListener('input',()=>{s.searchFilters[key]=input.value;renderSearch({preserveFocus:key});});
      column.append(sort);if(key==='path')column.append(input);header.append(column);
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
        event.dataTransfer?.setData('application/x-papers-pill',JSON.stringify(x.kind==='folder'?{mode:'machine',path:x.path,machineRoot:x.path,view:'nav',name:x.name}:{mode:'action',path:x.path,name:x.name}));
      }
      rememberNativeDrag({ mode:'machine', paths });
      // A device's files stay a Papers drag: As you Go downloads them into its inbox on drop.
      if(paths.some(path=>REMOTE_ROOT.test(path))){setDeviceFilesDrag(event.dataTransfer,paths.filter(path=>REMOTE_ROOT.test(path)));if(event.dataTransfer)event.dataTransfer.effectAllowed='copyLink';return;}
      if(paths.some(path=>/^\\\\papers~phone\\/i.test(path))){if(event.dataTransfer)event.dataTransfer.effectAllowed='copyLink';return;}
      beginNavigatorNativeDrag({ event, paths, host: o.host });
    });
    row.addEventListener('dragend',()=>{s.internalDragSource=null;});
    const folder=x.kind==='folder', lead=d.createElement(folder?'button':'span'); lead.className=folder?'navigator-tree-toggle':'navigator-tree-spacer';
    if(folder){lead.type='button';lead.textContent=s.thumbsActive?'>':s.machineExpanded.has(x.path)?'':'>';if(s.thumbsActive)lead.classList.toggle('is-expanded',s.machineExpanded.has(x.path));lead.addEventListener('click',(e)=>{e.stopPropagation();void toggleMachine(x.path);});}
    const art=d.createElement('span'); art.className='workspace-navigator-art'; art.innerHTML=icon(x);
    if(!s.thumbsActive||(x.kind!=='folder'&&!isThumbnailImage(x.path)&&!isThumbnailImage(x.name)))hydrateMachineArt(art,x);
    else if(x.kind==='folder')art.innerHTML=FOLDER_ART;else thumbnails.observe(art,x.path,x.name);
    if(!searchResult)applyCustomIcon(art,x);
    const label=d.createElement('span'); label.className='workspace-navigator-label'; label.textContent=x.name;row.append(lead);if(folder&&!searchResult&&s.machineExpanded.has(x.path)&&!s.thumbsActive){const h=d.createElement('span');h.className='navigator-tree-folder-heading';h.append(art,label);row.append(h);row.classList.add('navigator-tree-expanded');}else row.append(art,label);
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
      if(s.machineSelected.size)claimSelection();
      if(!e.papersTouchSelection)o.previewMachinePath(x.path,x.name);
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
        if(new URL(d.defaultView.location.href).searchParams.has('papers-phone')){o.setStatus(REMOTE_ROOT.test(x.path)?'Fetching file to open…':'Opening file…');void o.host.fileCapability('open',{path:x.path}).then(result=>o.setStatus(result?.ok?'':result?.message||'The file could not be opened.')).catch(error=>o.setStatus(error.message));}else void o.host.fileCapability('open',{path:x.path});
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
 for(const x of projectRows(orderedMachineItems(result.items||[],path))){const start=tree.index++,row=machineRow(x,depth);fragment.append(row);if(x.kind==='folder'&&s.machineExpanded.has(x.path)){const children=d.createElement('div');children.className='navigator-tree-branch';children.style.setProperty('--branch-left',`${14+depth*13}px`);children.append(await machineTree(x.path,depth+1,generation,tree));installNavigatorDropTarget(children,{path:x.path});fragment.append(children);tree.branches.push({id:`machine:${x.path.toLowerCase()}`,depth,start,end:tree.index-1,row,children});}}return fragment;
 }
 async function renderMachineTree(){const generation=++s.renderGen,root=s.machineRoot;if(!root)return;setLocation([{key:root.toLowerCase(),label:root,title:root,path:root}]);const tree={index:1,branches:[]},fragment=d.createDocumentFragment(),row=machineRow({path:root,name:root,kind:'folder'});fragment.append(row);if(s.machineExpanded.has(root)){const children=d.createElement('div');children.className='navigator-tree-branch';children.style.setProperty('--branch-left','14px');children.append(await machineTree(root,1,generation,tree));installNavigatorDropTarget(children,{path:root});fragment.append(children);tree.branches.push({id:`machine:${root.toLowerCase()}`,depth:0,start:0,end:tree.index-1,row,children});}if(generation===s.renderGen&&s.mode==='machine'&&s.view==='tree'){body.replaceChildren(fragment);paintTreeBranches(tree.branches);}}
  function machinePathCrumbs(path) {
    const normalized=String(path||'').replace(/\//g,'\\').replace(/\\+$/,'');
    if(/^\\\\papers~phone\\/i.test(normalized)){
      const parts=normalized.slice('\\\\papers~phone\\'.length).split('\\').filter(Boolean);
      let cursor='\\\\papers~phone';return parts.map((part,index)=>{cursor+='\\'+part;return {path:cursor,name:index===0?(part==='primary'?'Internal storage':navigatorPhoneLabel(part,cursor)):navigatorPhoneLabel(part,cursor)};});
    }
    const remote=normalized.match(REMOTE_ROOT);
    if(remote){
      let cursor=remote[0];
      const entries=[{path:cursor,name:remoteDeviceNames.get(cursor.toLowerCase())||'Device'}];
      for(const part of normalized.slice(cursor.length).split('\\').filter(Boolean)){cursor+='\\'+part;entries.push({path:cursor,name:part});}
      return entries;
    }
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
    const items=projectRows(orderedMachineItems(result.items || [],path));
    if(items.length){
      body.append(s.thumbsActive?thumbsSortBar():machineColumnHeader());
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
    if (REMOTE_ROOT.test(path) && !remoteDeviceNames.has(path.match(REMOTE_ROOT)[0].toLowerCase())) await remoteDevices();
    const changed = !s.path || !s.machineRoot || s.machineRoot.toLocaleLowerCase() !== path.toLocaleLowerCase();
    if (changed) {
      s.machineRoot = path; s.path = path; s.selected = null;s.machineSelected.clear();
      s.history = [path]; s.hi = 0;
      s.machineExpanded = new Set([path]);
      s.machineListings.clear();
    }
    persistUi('papers:ayg:navigator-machine-root', s.machineRoot);
    if (!/^\\\\papers~/i.test(path)) persistUi('papers:ayg:navigator-local-root', path);
    s.mode = 'machine';
    if (fromGesture) setView('nav', false);
    syncChrome();
    if (s.view === 'nav') await loadMachine(path, false);
    else render();
  }
  // One selection at a time across As you Go pages (this computer's Files, a device's Files, other
  // windows): clipboard, delete, rename and Preview each act on one selection, so a new selection
  // anywhere clears the others instead of leaving two live selections to disambiguate.
  const selectionPeers=typeof d.defaultView.BroadcastChannel==='function'?new d.defaultView.BroadcastChannel('papers-selection-owner'):null;
  const selectionPageId=d.defaultView.crypto?.randomUUID?.()||String(Math.random());
  let releasingSelection=false;
  function claimSelection(){if(!releasingSelection)selectionPeers?.postMessage({owner:selectionPageId});}
  if(selectionPeers)selectionPeers.onmessage=event=>{
    if(!event.data?.owner||event.data.owner===selectionPageId)return;
    releasingSelection=true;
    try{
      if(o.getSession().selected.size)o.setAyGSelection?.([]);
      if(s.machineSelected.size){s.machineSelected.clear();s.selected=null;}
      body.querySelectorAll('.workspace-navigator-row.selected').forEach(row=>row.classList.remove('selected'));
    }finally{releasingSelection=false;}
  };
  d.defaultView.addEventListener('pagehide',()=>selectionPeers?.close(),{once:true});
  async function syncCanvasSelection(selection) {
    if (selection?.selectionCount > 0) claimSelection();
    if (selection?.mode === 'empty' && selection.selectionCount === 0) {
      if (s.mode === 'ayg') render();
      return;
    }
    const gen=++s.gen, path=selection?.mode==='single'?selection.item?.path:null;
    if (!path || !o.isAbsoluteWindowsPath(path)) { if(s.mode!=='ayg') setMode('ayg'); else render(); return; }
    const result=await o.host.fileCapability('stat',{path}).catch(()=>null); if(gen!==s.gen) return;
    // While the graph is this pane's view, selecting a linked folder only selects it; entering it
    // (double tap / double-click) would replace the graph the selection was made in.
    if(result?.ok && result.entry?.kind==='folder' && !s.graphViewActive) return enterMachine(path, false);
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
    const result=await searchNavigatorFiles({query:normalized,search:query=>o.host.fileCapability('search',{query,limit:1000,...(s.mode==='machine'&&REMOTE_ROOT.test(s.path||'')?{path:s.path.match(REMOTE_ROOT)[0]}:{})}),isCurrent:()=>generation===s.searchGeneration&&s.searchQuery===normalized});
    if(generation!==s.searchGeneration||s.searchQuery!==normalized)return;
    s.searchResult=result;
    renderSearch();
  }
  const destination=()=>{const ids=[...o.getSession().selected]; return ids.length===1&&o.getState().groups.some((g)=>g.id===ids[0])?ids[0]:(currentAyG()||o.rootId);};
  provider.addEventListener('click',event=>{event.stopPropagation();void openModeMenu();});
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
    const existing=panel.querySelector('[data-new-folder] input');if(existing){existing.focus();return;}
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
    const input=d.createElement('input');input.className='navigator-inline-rename';input.type='text';input.value='New folder';input.setAttribute('aria-label','New folder name');row.append(input);
    const folderEditorHost=s.graphViewActive&&graphSlot?graphSlot:body;
    if(folderEditorHost===graphSlot)row.classList.add('navigator-graph-folder-editor');
    folderEditorHost.prepend(row);
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
    input.addEventListener('blur',()=>{queueMicrotask(()=>{if(!busy&&d.activeElement!==input)row.remove();});});input.focus();input.select();
  });
  let machineClipboard=null;
  function finishPhoneClipboard(){if(!phoneMode)return;phoneGestures?.finish();if(savedStates?.isSelecting())savedStates.finishSelection();paintPhoneCut();}
  function paintPhoneCut(){if(!phoneMode)return;const record=o.sharedClipboard?.current(null),ids=new Set(record?.cut?record.ayg?.ids||[]:[]),paths=new Set(record?.cut?(record.paths||[]).map(x=>x.toLowerCase()):[]);for(const root of [body,graphSlot].filter(Boolean))for(const row of root.querySelectorAll('[data-id]')){const id=row.dataset.id,identity=o.resolveAyGDragIdentity?.(id)?.itemId;const cut=ids.has(id)||ids.has(identity)||paths.has(id.toLowerCase());if(row.classList.contains('phone-cut-item')!==cut)row.classList.toggle('phone-cut-item',cut);}}

  function copyNavigator(cut=false){
    if(s.mode==='ayg'){machineClipboard=null;const result=cut?o.cutAyG():o.copyAyG();finishPhoneClipboard();return result;}
    if(!s.machineSelected.size)return;
    const paths=[...s.machineSelected],sharedId=o.sharedClipboard?.write({cut,paths})??null;
    machineClipboard={paths,cut,base:o.getSession().clipboard,sharedId};finishPhoneClipboard();
    // Also on the Windows clipboard, as Explorer does (Cut included), so other apps can paste them.
    const local=paths.filter(path=>!REMOTE_ROOT.test(path));
    const written=local.length?Promise.resolve(o.host.fileCapability('clipboard-write-files',{paths:local,cut})).then(value=>value?.ok===true?value.fingerprint:null).catch(()=>null):Promise.resolve(null);
    if(sharedId)void written.then(fingerprint=>fingerprint??Promise.resolve(o.host.fileCapability('clipboard-read',{})).then(value=>value?.fingerprint).catch(()=>null)).then(fingerprint=>o.sharedClipboard.setFingerprint(sharedId,fingerprint));
  }
  // Files another pane copied, pasted into this folder. On one device: copy or move as usual.
  // Across devices: always a copy (the originals stay); Papers downloads or uploads the files.
  async function pasteForeignFiles(record){
    const owner=path=>REMOTE_ROOT.test(path)?path.slice(9,45).toLowerCase():'local';
    const here=o.host.deviceId?String(o.host.deviceId).toLowerCase():'local',target=owner(s.path)==='local'?here:owner(s.path);
    // A device's view reads drive paths as that device's, so this computer's files go in long-path form.
    const longPath=String.fromCharCode(92,92,63,92);
    const paths=record.paths.map(path=>owner(path)==='local'&&o.host.deviceId?longPath+path:path);
    const cut=record.cut&&record.paths.every(path=>owner(path)===target||(owner(path)==='local'&&target==='local'));
    transferStatus(cut?'Moving files…':'Copying files…');
    const result=await o.host.fileCapability(cut?'move':'copy',{paths,destination:s.path}).catch(error=>({ok:false,message:error.message}));
    if(!result?.ok){transferStatus(result?.message||'File transfer failed.');return;}
    if(cut)o.sharedClipboard.consume(record.id);
    s.machineListings.clear();render();
    transferStatus(result.pending?result.message:cut?'Files moved.':record.cut?'Copied; the originals stay on their device.':'Files copied.',!result.pending);
  }
  async function moveNavigatorFiles(options){return runNavigatorFileMove({...options,onProgress:options.onProgress||((progress)=>{s.machineListings.clear();render();transferStatus('Moving files… '+progress.completed+'/'+progress.total+' confirmed'+(progress.pending?' · waiting for Directory Opus':''));})});}
  async function pasteNavigator(){
    // The computer-wide clipboard decides: a newer copy in another pane replaces this pane's own.
    const shared=o.sharedClipboard?.current(null)||null,foreign=shared&&shared.page!==o.sharedClipboard.page?shared:null;
    if(machineClipboard&&(foreign||machineClipboard.base!==o.getSession().clipboard))machineClipboard=null;
    if(s.mode==='ayg'){
      if(machineClipboard){await o.linkNavigatorPaths?.(machineClipboard.paths,destination());return;}
      return o.pasteAyG(destination());
    }
    const clipboard=o.getSession().clipboard;
    if(foreign&&foreign.paths.length){await pasteForeignFiles(foreign);return;}
    if(foreign){o.setStatus('Those are As you Go folders or links; copy files to paste them into a folder.');return;}
    const source=machineClipboard||{paths:o.nativeDragPaths?.(clipboard?.ids||[])||[],cut:clipboard?.mode==='cut'};
    if(!source.paths.length){o.setStatus('Copy files before pasting into a real folder.');return;}
    transferStatus(source.cut?'Moving files with Directory Opus…':'Copying files with Directory Opus…');
    const updateMove=progress=>{s.machineListings.clear();render();transferStatus('Moving files… '+progress.completed+'/'+progress.total+' confirmed'+(progress.pending?' · waiting for Directory Opus':''));};
    const result=source.cut?await moveNavigatorFiles({host:o.host,paths:source.paths,destination:s.path,retarget:machineClipboard?undefined:retargetMovedFiles,onProgress:updateMove})
      :await o.host.fileCapability('copy',{paths:source.paths,destination:s.path});
    if(!result?.ok)transferStatus(result?.message||'File transfer failed.');else{s.machineListings.clear();render();transferStatus(result.pending?result.message:source.cut?'Files moved.':'Copy requested in Directory Opus.',!result.pending);if(source.cut&&!result.pending)machineClipboard=null;}
  }
  copy.addEventListener('click',()=>copyNavigator());
  move.addEventListener('click',()=>copyNavigator(true));
  paste.addEventListener('click',()=>void pasteNavigator());
  d.addEventListener('keydown',event=>{
    if(s.collapsed||!panel.contains(event.target)||event.target?.closest?.('input,textarea,[contenteditable="true"]')||!event.ctrlKey||event.altKey)return;
    const key=event.key.toLowerCase();if(!['c','x','v'].includes(key))return;
    if(key==='v'&&s.mode==='ayg')return; // handled by the paste event below, which carries pasted images
    event.preventDefault();event.stopImmediatePropagation();
    if(key==='v')void pasteNavigator();else copyNavigator(key==='x');
  },true);
  d.addEventListener('paste',event=>{
    if(s.collapsed||!panel.contains(event.target)||event.target?.closest?.('input,textarea,[contenteditable="true"]'))return;
    event.preventDefault();event.stopImmediatePropagation();void pasteNavigator();
  },true);
  rename.addEventListener('click',()=>{
    if(s.mode==='ayg'&&o.getSession().selected.size!==1){o.setStatus('Select one item to rename.');return;}
    if(phoneMode){
      const id=[...o.getSession().selected][0],identity=o.resolveAyGDragIdentity?.(id)?.itemId||id;const item=s.mode==='machine'?s.selected:(o.getState().groups||[]).find(x=>x.id===identity)||(o.getState().shortcuts||[]).find(x=>x.id===identity);
      if(!item){transferStatus('Select one entry to rename.',true);return;}
      if(d.querySelector('.phone-rename-dialog'))return;const dialog=d.createElement('dialog');dialog.className='phone-rename-dialog';dialog.setAttribute('aria-label','Rename');const form=d.createElement('form'),title=d.createElement('strong'),input=d.createElement('input'),message=d.createElement('p'),actions=d.createElement('div'),cancel=d.createElement('button'),save=d.createElement('button');title.textContent='Rename';input.value=item.name||'';input.setAttribute('aria-label','New name');cancel.type='button';cancel.textContent='Cancel';save.type='submit';save.textContent='Save';actions.append(cancel,save);form.append(title,input,message,actions);dialog.append(form);d.body.append(dialog);const close=()=>{input.blur();dialog.close();dialog.remove();};cancel.addEventListener('click',close);dialog.addEventListener('cancel',()=>dialog.remove());
      form.addEventListener('submit',async event=>{event.preventDefault();const name=input.value.trim();if(!name){message.textContent='Enter a name.';return;}save.disabled=true;try{if(s.mode==='ayg'){if(await o.renameAyG(id,name)===false)throw Error('Rename could not be saved.');}else{const result=await o.host.fileCapability('rename',{path:item.path,newName:name});if(!result?.ok)throw Error(result?.message||'Rename failed.');s.selected=null;s.machineListings.clear();}close();render();}catch(error){message.textContent=error.message;save.disabled=false;}});dialog.showModal();input.focus();input.select();return;
    }
    let row=body.querySelector('.workspace-navigator-row.selected');
    let label=row?.querySelector('.workspace-navigator-label');
    let graphEditor=false;
    if(s.mode==='ayg'&&s.graphViewActive&&graphSlot){
      const existing=graphSlot.querySelector('[data-rename] input');if(existing){existing.focus();return;}
      const id=[...o.getSession().selected][0],state=o.getState();
      const item=state.groups.find(x=>x.id===id)||[o.rootId,...state.groups.map(x=>x.id)].flatMap(parent=>o.itemsIn(state,parent)).find(x=>x.id===id||x.shortcutId===id);
      if(!item){o.setStatus('Select an entry to rename.');return;}
      row=d.createElement('div');row.className='workspace-navigator-row navigator-graph-rename-editor';row.dataset.id=id;row.dataset.rename='true';
      label=d.createElement('span');label.className='workspace-navigator-label';label.textContent=item.name;row.append(label);graphSlot.prepend(row);graphEditor=true;
      const tile=[...graphSlot.querySelectorAll('.icon-item[data-id]')].find(x=>x.dataset.id===id);
      if(tile){const bounds=tile.getBoundingClientRect(),host=graphSlot.getBoundingClientRect();const width=Math.min(220,Math.max(120,host.width-24));row.style.width=width+'px';row.style.left=Math.max(8,Math.min(host.width-width-8,bounds.left-host.left+bounds.width/2-width/2))+'px';row.style.top=Math.max(8,Math.min(host.height-42,bounds.bottom-host.top))+'px';}
    }
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
        label.textContent=save?name:previous;row.draggable=true;if(graphEditor)row.remove();render();
      }catch(error){o.setStatus(error.message||'Rename failed.');finished=false;input.disabled=false;input.focus();}
    };
    ['click','pointerdown','dblclick'].forEach(type=>input.addEventListener(type,e=>e.stopPropagation()));
    input.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Enter'||e.key==='Escape'){e.preventDefault();void finish(e.key==='Enter');}});
    input.addEventListener('blur',()=>{queueMicrotask(()=>{if(!finished&&d.activeElement!==input)void finish(true);});});
    input.focus();input.select();
  });
  del.addEventListener('click',async()=>{
    let r;del.disabled=true;
    try{r=await deleteNavigatorSelection(s.mode,s.selected,{...o,confirm:message=>d.defaultView?.confirm(message)},s.mode==='machine'?[...s.machineSelected]:[]);}
    catch(error){o.setStatus(error.message||'Delete failed.');return;}
    finally{del.disabled=false;}
    if(s.mode==='ayg'||!r)return;
    if(!r.ok){o.setStatus(r.message||'Delete failed.');return;}
    s.selected=null;s.machineSelected.clear();s.machineListings.clear();render();
  });
  function revealPath(){return s.mode==='machine'?(s.selected?.path||s.path):(o.nativeDragPaths?.([...o.getSession().selected])||[])[0];}
  reveal.addEventListener('click',()=>{const path=revealPath();if(path)void o.host.fileCapability('reveal',{path}).then(result=>{if(!result?.ok)o.setStatus(result?.message||'Could not reveal that file.');}).catch(error=>o.setStatus(error.message||'Could not reveal that file.'));});
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
    if(optionsPanel&&optionsPanel.dataset.mode&&optionsPanel.dataset.mode!==s.mode){optionsPanel.remove();optionsPanel=null;}
    refreshGraphVisibility();
    const activeOptions=viewOptions[s.mode];optionsButton.classList.toggle('is-filtered',Boolean(activeOptions.name||activeOptions.type||activeOptions.minSize||activeOptions.maxSize||activeOptions.after||activeOptions.before));
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
    children:async parent=>parent.devices ? await remoteDevices() : parent.path ? (await machineList(parent.path))?.items || []
      : o.itemsIn(o.getState(),parent.id).filter(item=>item.kind!=='window-layout'),
    art:(element,item)=>{element.innerHTML=icon(item);if(item.path)loadMachineArt(element,item);else hydrateArt(element,item);},
    activate:async item=>{if(item.deviceId && o.openDeviceInline){try{if(await o.openDeviceInline(deviceFilesUrl(d.defaultView.location,item.deviceId)))return;}catch(error){o.setStatus(error.message);return;}}if(item.path){if(item.kind==='folder'){s.machineExpanded.clear();setView('nav',false);await enterMachine(item.path,false);}else await o.host.fileCapability('open',{path:item.path});}else await enterAyG(item);},
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
    onSelectionChange:active=>{if(active)phoneGestures?.finish();},
    loadSavedStates:()=>o.getState().view?.preferences?.navigatorSavedStates,
    isReady:()=>o.savedStatesReady?.() ?? true,
    saveSavedStates:o.saveNavigatorSavedStates,
    onSaveError:error=>o.setStatus(error.message||'Saved items could not be saved.'),
    resolveTarget:saved=>(saved.quickRunKey?o.pinnedQuickRunPath?.(saved.quickRunKey):null)||o.nativeDragPaths?.([saved.itemId||saved.art?.shortcutId])?.[0],
    decorateLabel:(label,saved)=>{
      const normalized=navigatorFolderPill(saved,o.getState().groups||[]);
      if(normalized.mode==='ayg'){label.textContent=(s.expanded.has(normalized.currentId)?'':'> ')+saved.name;return;}
      if(saved.mode==='machine'){label.textContent=navigatorPhoneLabel(saved.name,saved.path)+' <';label.closest('.navigator-saved-pill')?.classList.add('navigator-filesystem-link');return;}
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
      const machinePaths=s.internalDragSource?.mode==='machine' ? s.internalDragSource.paths : capturedPaths;
      if(machinePaths?.length){
        const pills=[];
        for(const path of machinePaths){
          const entry=s.machineRows.get(path)|| (await o.host.fileCapability('stat',{path}))?.entry;
          pills.push(entry?.kind==='folder'?{mode:'machine',path,machineRoot:path,view:'nav',name:entry.name||path.split(/[\\/]/).pop()}:{mode:'action',path,name:entry?.name||path.split(/[\\/]/).pop()});
        }
        return pills;
      }
      if(data.files?.length){
        const captured=navigatorCapturedDropPaths(s.nativeDragSource,[...data.files]);
        if(s.nativeDragSource?.mode==='ayg' && captured.length){
          const path=captured[0],key=value=>String(value||'').replace(/\//g,'\\').toLowerCase();
          const record=(o.getState().shortcuts||[]).find(item=>s.nativeDragSource.itemIds?.includes(item.id)&&key(item.target)===key(path));
          if(record)return {...navigatorSavedStateForItem(record),path};
        }
        const result=await o.host.resolveDroppedTargets([...data.files]);
        const pills=[];
        for(const item of result?.targets||result||[]){
          const path=typeof item==='string'?item:item?.target||item?.path;
          if(!path)continue;
          const entry=item?.kind?item:(await o.host.fileCapability('stat',{path}))?.entry;
          const name=item?.name||entry?.name||path.split(/[\\/]/).pop()||path;
          pills.push(entry?.kind==='folder'?{mode:'machine',path,machineRoot:path,view:'nav',name}:{mode:'action',path,name});
        }
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
      return {mode:s.mode,view:s.view,currentId:currentAyG(),path:s.path,machineRoot:s.machineRoot,expanded:[...s.expanded],machineExpanded:[...s.machineExpanded],query:s.searchQuery,name:s.mode==='machine'?navigatorPhoneLabel(s.path?.split(/[\\/]/).filter(Boolean).pop()||s.path||'Folder',s.path):(item?.name||'As you Go'),icon:item?.icon||null};
    },
    restore:async (saved, modifiers)=>{
      saved=navigatorFolderPill(saved,o.getState().groups||[]);
      if(saved.mode==='action'){
        if(await activateNavigatorFilePill(saved, modifiers, { ...o, currentAyG, openMachineFolder:async path=>{clearSearch({renderNow:false});s.mode='machine';s.machineRoot=path;s.machineExpanded=new Set();setView('nav',false);await loadMachine(path,true);syncChrome();} }))return;
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
  const graphFilter=()=>{if(!graphSlot)return;const opt=viewOptions.ayg,active=s.mode==='ayg'&&Boolean(opt.name||opt.type||opt.minSize||opt.maxSize||opt.after||opt.before);const allowed=new Set(projectRows(o.itemsIn(o.getState(),currentAyG())).flatMap(x=>[x.id,x.shortcutId].filter(Boolean)));for(const tile of graphSlot.querySelectorAll('.icon-item[data-id]')){const hidden=active&&!allowed.has(tile.dataset.id);if(tile.classList.contains('navigator-filter-hidden')!==hidden)tile.classList.toggle('navigator-filter-hidden',hidden);}};
  if(graphSlot){const observer=new d.defaultView.MutationObserver(graphFilter);observer.observe(graphSlot,{childList:true,subtree:true});d.defaultView.addEventListener('pagehide',()=>observer.disconnect(),{once:true});}
  const filterTimer=d.defaultView.setInterval(graphFilter,350);d.defaultView.addEventListener('pagehide',()=>d.defaultView.clearInterval(filterTimer),{once:true});
  if(!phoneMode)bindDesktopControlScale({panel,window:d.defaultView});
  if(phoneMode){
    bindPhoneControlScale({document:d,window:d.defaultView});
    const cutObserver=new d.defaultView.MutationObserver(paintPhoneCut);for(const root of [body,graphSlot].filter(Boolean))cutObserver.observe(root,{childList:true,subtree:true});
    d.defaultView.addEventListener('storage',paintPhoneCut);const cutTimer=d.defaultView.setInterval(paintPhoneCut,400);d.defaultView.addEventListener('pagehide',()=>{cutObserver.disconnect();d.defaultView.clearInterval(cutTimer);},{once:true});
    const transfer=d.createElement('button');transfer.type='button';transfer.className='phone-pill-transfer';transfer.hidden=true;const clearTransfer=d.createElement('button');clearTransfer.type='button';clearTransfer.className='phone-pill-transfer phone-pill-transfer-clear';clearTransfer.hidden=true;clearTransfer.textContent='↓×';clearTransfer.title='Move selected entries and clear their pills';clearTransfer.setAttribute('aria-label',clearTransfer.title);const pasteIcon=d.createElement('button');pasteIcon.type='button';pasteIcon.className='phone-pill-transfer phone-paste-icon';pasteIcon.hidden=true;pasteIcon.title='Paste clipboard image as selected icons';pasteIcon.setAttribute('aria-label',pasteIcon.title);pasteIcon.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 5V3h8v2M6 17l5-5 3 3 3-2 3 4"/><circle cx="16" cy="9" r="1"/></svg>';const removePills=d.createElement('button');removePills.type='button';removePills.className='phone-pill-transfer phone-pill-remove';removePills.hidden=true;removePills.textContent='×';removePills.title='Remove selected pills';removePills.setAttribute('aria-label',removePills.title);d.body.append(transfer,clearTransfer,pasteIcon,removePills);
    removePills.addEventListener('click',async()=>{removePills.disabled=true;try{await savedStates.removeSelected();savedStates.finishSelection();}catch(error){transferStatus(error.message,true);}finally{removePills.disabled=false;update();}});
    pasteIcon.addEventListener('click',async()=>{pasteIcon.disabled=true;try{const pills=savedStates.isSelecting()?savedStates.selected():null;const icon=await o.pasteSelectionIcon?.(pills);if(pills&&icon)await savedStates.setSelectedIcon(icon);transferStatus('Icons updated.',true);}catch(error){transferStatus(error.message,true);}finally{pasteIcon.disabled=false;}});
    const update=()=>{if(phoneGestures.isSelecting()&&savedStates.isSelecting())savedStates.finishSelection();const down=savedStates.isSelecting();transfer.hidden=!down&&!phoneGestures.isSelecting();clearTransfer.hidden=!down;removePills.hidden=!down;pasteIcon.hidden=!down&&!phoneGestures.isSelecting();transfer.textContent=down?'↓':'↑';transfer.title=down?'Move selected pills into this folder':'Add selection to saved items';transfer.setAttribute('aria-label',transfer.title);};
    body.addEventListener('pointerup',()=>d.defaultView.setTimeout(update,0));body.addEventListener('click',update);
    const watch=new d.defaultView.MutationObserver(update);watch.observe(body,{attributes:true,attributeFilter:['class']});watch.observe(savedPills,{childList:true,subtree:true});
    const performTransfer=async clearPills=>{transfer.disabled=clearTransfer.disabled=true;try{
      if(savedStates.isSelecting()){
        const chosen=savedStates.selected();if(!chosen.length)throw Error('Select at least one pill.');
        for(const saved of chosen){
          const id=saved.itemId||saved.currentId||saved.art?.shortcutId;
          const paths=saved.path||saved.art?.target;
          let ok=false,completedMoves=[];
          if(s.mode==='machine'){
            const targets=paths?[paths]:o.nativeDragPaths?.([id])||[];
            if(!targets.length)throw Error('This entry has no file to move into this directory.');
            const aliases=[];const moveTargets=[];for(const path of targets){let canonical=path;if(phoneMode){const resolved=await o.host.fileCapability('resolve-storage-path',{path});if(!resolved?.ok)throw Error(resolved?.message||'This file has no accessible Android storage location.');canonical=resolved.path;}moveTargets.push(canonical);if(canonical!==path)aliases.push({oldPath:path,canonical});}
            const result=await moveNavigatorFiles({host:o.host,paths:moveTargets,destination:s.path,retarget:async moves=>{completedMoves=[...moves,...aliases.flatMap(alias=>{const move=moves.find(x=>x.oldPath===alias.canonical);return move?[{oldPath:alias.oldPath,newPath:move.newPath}]:[];})];return await retargetMovedFiles(completedMoves);}});ok=result?.ok===true;
          }else{
            const group=(o.getState().groups||[]).find(x=>x.id===id);const shortcut=(o.getState().shortcuts||[]).find(x=>x.id===id);
            const active=group?!group.bin:shortcut?.placements?.some(x=>!x.bin);
            if(id&&active)ok=await o.moveAyGItemsToFolder?.([id],[],currentAyG());
            else if(paths)ok=await o.linkNavigatorPaths?.([paths],currentAyG(),{name:saved.name,icon:saved.icon||saved.art?.icon});
          }
          if(ok===true&&s.mode==='ayg')ok=o.itemsIn(o.getState(),currentAyG()).some(item=>item.id===id||item.shortcutId===id||(paths&&String(item.target||'').toLowerCase()===paths.toLowerCase()));
          if(ok!==true)throw Error('The entry was not added to this folder. Its pill was kept.');
          if(clearPills)await savedStates.remove(saved,completedMoves);
        }
        savedStates.finishSelection();s.machineListings.clear();render();transferStatus(chosen.length+' entr'+(chosen.length===1?'y':'ies')+' added to '+(s.mode==='machine'?'this directory':'As you Go')+'.',true);
      }else{
        if(s.mode==='machine')for(const path of [...s.machineSelected]){const result=await o.host.fileCapability('stat',{path});if(!result?.ok)throw Error(result?.message||'File unavailable.');const entry=result.entry;if(await savedStates.add({mode:entry.kind==='folder'?'machine':'action',path,machineRoot:path,view:'nav',name:entry.name})===false)throw Error('Saved items could not be saved.');}
        else for(const id of [...o.getSession().selected]){const item=[...(o.getState().groups||[]).map(x=>({...x,kind:'group'})),...(o.getState().shortcuts||[])].find(x=>x.id===id||x.id===o.resolveAyGDragIdentity?.(id)?.itemId);const saved=item&&navigatorSavedStateForItem(item);if(saved&&await savedStates.add(saved)===false)throw Error('Saved items could not be saved.');}
        phoneGestures.finish();
      }
    }catch(error){transferStatus(error.message,true);}finally{transfer.disabled=clearTransfer.disabled=false;update();}};
    transfer.addEventListener('click',()=>performTransfer(false));clearTransfer.addEventListener('click',()=>performTransfer(true));
    d.defaultView.addEventListener('pagehide',()=>{watch.disconnect();transfer.remove();clearTransfer.remove();pasteIcon.remove();removePills.remove();},{once:true});
  }
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
    downloadSelectionPaths:()=>s.mode==='machine'?[...s.machineSelected]:(o.nativeDragPaths?.([...o.getSession().selected])||[]),
    isMachineMode: () => s.mode === 'machine',
    selectedMachinePaths: () => s.mode === 'machine' ? [...s.machineSelected] : [],
    /** Gives real files and folders a custom picture (null removes it), stored on their own device. */
    async setMachineIcons(paths, icon) {
      const result = await o.host.fileCapability('custom-icon-set', { paths, icon });
      if (!result?.ok) throw Error(result?.message || 'The picture could not be saved.');
      for (const path of paths) customIcons.delete(parentPath(path).toLocaleLowerCase());
      render(); return true;
    },
    currentFolder: () => s.mode === 'ayg' && s.view !== 'tree' ? currentAyG() : o.rootId,
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

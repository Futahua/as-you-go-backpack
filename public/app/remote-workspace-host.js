// A Papers tab showing another device's As you Go. The page is the same; only its host
// changes: the document loads from that device and saves through its checked writes
// (a save built on an older revision is refused there), file paths in the document are
// that device's own paths, and nothing here can launch or control anything on it.
import { decodeWorkspaceState, encodeWorkspaceState } from './host/workspace-state-codec.js';
import { remoteDeviceNames } from './remote-paths.js';

export function remoteDeviceFromUrl(location) {
  const id = new URL(location.href).searchParams.get('papers-device');
  return /^[0-9a-f-]{36}$/i.test(id || '') ? id.toLowerCase() : null;
}

/** Keeps this tab's remembered view (navigator mode, folders, widths) apart from this computer's own As you Go. */
export function scopeLocalStorage(ownerId, storage = globalThis.localStorage) {
  if (!storage) return;
  const prefix = `papers-device:${ownerId}:`;
  for (const name of ['getItem', 'setItem', 'removeItem']) {
    const original = storage[name].bind(storage);
    // The pill's hand-off to this device's own page (device-modes.js) is shared, not scoped.
    storage[name] = (key, ...rest) => original(['papers:ayg:navigate-intent','papers-shared-clipboard'].includes(key) ? key : prefix + key, ...rest);
  }
}

const NOT_HERE = 'Not available for another device.';
// Window layouts, launching and picking act on this computer's windows and apps; for
// another device's workspace they would act on the wrong machine, so they are refused.
const REFUSED = new Set([
  'launchShortcut', 'revealShortcut', 'pickWindowBegin', 'pickWindowStage', 'pickWindowCommit',
  'bindWindowCandidate', 'activateWindowCapability', 'minimizeWindowCapability', 'toggleWindowCapability',
  'restoreWindowCapability', 'closeWindowCapability', 'endProcessWindowCapability', 'applyWindowCapability',
  'windowControlActivate', 'windowControlGroup', 'windowPreviewShow', 'windowPreviewHold', 'detachOpen',
  // Reading this computer's windows would let them reconcile into the device's window layouts.
  'windowCandidates', 'windowLifecycleSnapshot', 'windowControlSync', 'observeWindowCapability',
  'resolveWindowDescriptor', 'resolveWindowInstance',
]);
const SILENT = new Set(['onWindowLifecycleEvent', 'onWindowLifecycleBaseline', 'onWindowControlEvent', 'onWindowControlShift', 'onWindowControlUnavailable', 'onPickResult']);

export function createRemoteWorkspaceHost(base, ownerId) {
  const root = `\\\\papers~${ownerId}`;
  const rootLower = root.toLowerCase() + '\\';
  let workspaceId = null;
  let sharedRoots = [];
  let loadedState = null;
  const verifiedResources=new Map();
  const pathKey=value=>String(value||'').replace(/\//g,'\\').toLowerCase();
  async function fileCapability(operation,params={}) {
    if(operation==='remote-files')return base.fileCapability(operation,params);
    const known=verifiedResources.get(pathKey(params.path));
    // The checked target owner has just resolved this exact path and supplied its
    // scoped resource. Browse that resource directly instead of enumerating parents.
    if(known&&Date.now()-known.at<2000){
      if(operation==='stat')return {ok:true,entry:{...known.entry,path:known.path,attributes:0,offline:false}};
      if(operation==='list'&&known.entry.kind==='folder'){
        const items=[];let offset=0,online=true;
        do {
          const page=await call({operation:'browse',resourceId:known.entry.id,offset});
          if(page.folder?.id!==known.entry.id)throw Error('The owner returned a different folder.');
          online&&=page.online!==false;
          for(const item of page.entries||[])items.push({...item,path:known.path+'\\'+item.name,attributes:0,offline:page.online===false});
          offset=page.nextOffset;
        }while(offset!==null&&offset!==undefined);
        return {ok:true,entry:{...known.entry,path:known.path},items,truncated:false,online};
      }
    }
    const result=toDevice(await base.fileCapability(operation,toRemote(operation==='search'&&!params.path?{...params,path:root}:params)));
    if(operation==='file-target-resolve'){
      verifiedResources.delete(pathKey(params.path));
      const target=result?.target;
      if(result?.ok&&target?.status==='present'&&target.entry?.id&&target.path)verifiedResources.set(pathKey(target.path),{at:Date.now(),path:target.path,entry:target.entry});
    }
    return result;
  }
  // Last 50 device requests, readable from DevTools as __papersRemoteTrace.
  const trace = (globalThis.__papersRemoteTrace = []);
  const call = async (params) => {
    const entry = { at: new Date().toISOString(), operation: params.operation };
    trace.push(entry); if (trace.length > 50) trace.shift();
    const result = await base.fileCapability('remote-files', { ...params, ownerId }).catch((error) => ({ ok: false, message: error?.message }));
    entry.ok = Boolean(result?.ok); if (result?.ok && result.result?.code) entry.code = result.result.code; if (!result?.ok) entry.error = result?.message;
    if (!result?.ok) throw new Error(result?.message || 'That device is unavailable.');
    return result.result;
  };
  const workspace = async () => {
    if (workspaceId) return workspaceId;
    const status = await call({ operation: 'status' }).catch(() => null);
    for (const device of status?.devices || []) remoteDeviceNames.set(`\\\\papers~${device.id}`.toLowerCase(), device.name);
    const found = await call({ operation: 'workspaces' });
    if (!found[0]) throw new Error('That device has no As you Go to open.');
    return (workspaceId = found[0].id);
  };
  const isDevicePath = (value) => typeof value === 'string' && (/^[A-Za-z]:[\\/]/.test(value) || sharedRoots.some(name => value === name || value.startsWith(name + '\\')));
  const toRemote = (value) => {
    if (isDevicePath(value)) return `${root}\\${value.replace(/\//g, '\\')}`;
    if (Array.isArray(value)) return value.map(toRemote);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toRemote(item)]));
    return value;
  };
  const toDevice = (value) => {
    if (typeof value === 'string') return value.toLowerCase().startsWith(rootLower) ? value.slice(rootLower.length) : value;
    if (Array.isArray(value)) return value.map(toDevice);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toDevice(item)]));
    return value;
  };
  // Icons are files in the device's own As you Go folder (./icons/<sha256>.<ext>). They are shown
  // inline here and put back as the same references on save, so the device's document never changes for it.
  const ICON = /^\.\/icons\/([a-f0-9]{64}\.[a-z]{2,4})$/;
  const iconData = new Map(), iconRefs = new Map();
  const mapStrings = (value, map) => {
    if (typeof value === 'string') return map(value);
    if (Array.isArray(value)) return value.map((item) => mapStrings(item, map));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapStrings(item, map)]));
    return value;
  };
  const inlineIcons = async (state) => {
    const names = new Set();
    mapStrings(state, (text) => { const m = ICON.exec(text); if (m && !iconData.has(m[1])) names.add(m[1]); return text; });
    const id = await workspace();
    await Promise.all([...names].map(async (name) => {
      const data = await call({ operation: 'workspace-icon', workspaceId: id, name }).catch(() => null);
      if (data) { iconData.set(name, data); iconRefs.set(data, `./icons/${name}`); }
    }));
    return mapStrings(state, (text) => { const m = ICON.exec(text); return m && iconData.has(m[1]) ? iconData.get(m[1]) : text; });
  };
  const restoreIcons = (state) => mapStrings(state, (text) => iconRefs.get(text) ?? text);
  const loadVersioned = async () => {
    const loaded = await call({ operation: 'workspace-load', workspaceId: await workspace() });
    sharedRoots = loaded.sharedRoots || [];
    const decoded = decodeWorkspaceState(JSON.stringify(loaded.state));
    const state = typeof decoded === 'string' ? JSON.parse(decoded) : decoded;
    loadedState = state;
    return { state: await inlineIcons(state), revision: loaded.revision };
  };
  const overrides = {
    deviceId: ownerId,
    // Export only paths belonging to this device, including Android shared roots.
    deviceFilePath: (value) => isDevicePath(value) ? toRemote(value) : null,
    loadWorkspaceVersioned: loadVersioned,
    loadWorkspace: async () => (await loadVersioned()).state,
    saveWorkspaceChecked: async (state, revision) => {
      const plain = typeof state === 'string' ? JSON.stringify(restoreIcons(JSON.parse(state))) : restoreIcons(state);
      const encoded = encodeWorkspaceState(plain);
      return call({ operation: 'workspace-save', workspaceId: await workspace(), state: typeof encoded === 'string' ? encoded : JSON.stringify(encoded), revision });
    },
    saveWorkspace: async () => { throw new Error('Saves to another device are always checked.'); },
    // The device's own copy decides between writers; this tab never holds this computer's lease.
    acquireWorkspaceWriterLease: async () => null,
    releaseWorkspaceWriterLease: async () => ({ ok: true }),
    fileCapability,
    // Files dropped from this computer are copied into the device's inbox, then referenced there.
    resolveDroppedTargets: async (files) => {
      const local = await base.resolveDroppedTargets(files);
      if (!Array.isArray(local) || !local.length) return local;
      const sent = await call({ operation: 'send-to-inbox', paths: local.map((item) => item.target) });
      return local.map((item, index) => ({ ...item, target: toDevice(sent[index]) }));
    },
    pickTarget: async () => { throw new Error(NOT_HERE); },
    shortcutIcon: async ({actionId}) => {
      const item=loadedState?.shortcuts?.find(x=>x.id===actionId||x.placements?.some(p=>p.id===actionId));
      if(!item?.target||!isDevicePath(item.target))return null;
      const result=await overrides.fileCapability('icon',{path:item.target});
      return result?.ok?result.icon??null:null;
    },
  };
  return new Proxy(base, {
    get(target, key) {
      if (Object.prototype.hasOwnProperty.call(overrides, key)) return overrides[key];
      if (REFUSED.has(key)) return async () => { throw new Error(NOT_HERE); };
      if (SILENT.has(key)) return () => () => {};
      return target[key];
    },
  });
}

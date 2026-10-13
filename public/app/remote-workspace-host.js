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
    storage[name] = (key, ...rest) => original(prefix + key, ...rest);
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
  const isDevicePath = (value) => typeof value === 'string' && /^[A-Za-z]:[\\/]/.test(value);
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
  const loadVersioned = async () => {
    const loaded = await call({ operation: 'workspace-load', workspaceId: await workspace() });
    const decoded = decodeWorkspaceState(JSON.stringify(loaded.state));
    return { state: typeof decoded === 'string' ? JSON.parse(decoded) : decoded, revision: loaded.revision };
  };
  const overrides = {
    deviceId: ownerId,
    loadWorkspaceVersioned: loadVersioned,
    loadWorkspace: async () => (await loadVersioned()).state,
    saveWorkspaceChecked: async (state, revision) => call({ operation: 'workspace-save', workspaceId: await workspace(), state: encodeWorkspaceState(state), revision }),
    saveWorkspace: async () => { throw new Error('Saves to another device are always checked.'); },
    // The device's own copy decides between writers; this tab never holds this computer's lease.
    acquireWorkspaceWriterLease: async () => null,
    releaseWorkspaceWriterLease: async () => ({ ok: true }),
    fileCapability: (operation, params = {}) => operation === 'remote-files'
      ? base.fileCapability(operation, params)
      : base.fileCapability(operation, toRemote(params)).then(toDevice),
    // Files dropped from this computer are copied into the device's inbox, then referenced there.
    resolveDroppedTargets: async (files) => {
      const local = await base.resolveDroppedTargets(files);
      if (!Array.isArray(local) || !local.length) return local;
      const sent = await call({ operation: 'send-to-inbox', paths: local.map((item) => item.target) });
      return local.map((item, index) => ({ ...item, target: toDevice(sent[index]) }));
    },
    pickTarget: async () => { throw new Error(NOT_HERE); },
    shortcutIcon: async () => null,
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

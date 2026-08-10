import {
  decodeWorkspaceState,
  encodeWorkspaceState,
} from './workspace-state-codec.js';

/** The papers:host:result message type the parent frame uses to answer a
 * request sent via postMessage. */
const HOST_RESULT = 'papers:host:result';

/** Owns the postMessage request/response protocol with the Papers host
 * frame. Every host call resolves a Promise when its requestId comes back,
 * and named methods below hide the protocol strings from the rest of the
 * workspace. */
export function createHostBridge(window) {
  const pending = new Map();
  const MAX_PENDING = 64;
  const REQUEST_TIMEOUT_MS = 15000;
  const pickListeners = new Set();

  function request(type, detail = {}) {
    if (pending.size >= MAX_PENDING) {
      return Promise.reject(new Error('Host request capacity reached.'));
    }
    const requestId = crypto.randomUUID();
    window.parent.postMessage({ type, requestId, ...detail }, '*');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error('Host request timed out.'));
      }, REQUEST_TIMEOUT_MS);
      pending.set(requestId, { resolve, reject, timer });
    });
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window.parent) return;
    // 016: the Papers-owned direct-pick session pushes one typed result.
    if (event.data?.type === 'papers:project:window-pick-result') {
      for (const listener of pickListeners) {
        listener(event.data.result);
      }
      return;
    }
    if (event.data?.type !== HOST_RESULT) return;
    const task = pending.get(event.data.requestId);
    if (!task) return;
    pending.delete(event.data.requestId);
    clearTimeout(task.timer);
    if (!event.data.ok) {
      task.reject(new Error(event.data.error || 'The request could not be completed.'));
      return;
    }
    if ('target' in event.data && 'icon' in event.data) {
      task.resolve({ target: event.data.target, icon: event.data.icon });
      return;
    }
    if ('finalOrigin' in event.data) {
      task.resolve({
        icon: event.data.icon,
        mime: event.data.mime,
        finalOrigin: event.data.finalOrigin,
        title: event.data.title ?? null,
      });
      return;
    }
    if ('candidates' in event.data) {
      task.resolve({
        outcome: event.data.outcome,
        candidates: event.data.candidates ?? [],
        error: event.data.error ?? null,
      });
      return;
    }
    if ('capability' in event.data || 'observation' in event.data) {
      task.resolve({
        outcome: event.data.outcome,
        capability: event.data.capability ?? null,
        descriptor: event.data.descriptor ?? null,
        observation: event.data.observation ?? null,
        error: event.data.error ?? null,
      });
      return;
    }
    if ('outcome' in event.data) {
      task.resolve({
        outcome: event.data.outcome,
        observation: event.data.observation ?? null,
        error: event.data.error ?? null,
      });
      return;
    }
    task.resolve(
      event.data.state
      ?? event.data.icon
      ?? event.data.target
      ?? event.data.targets
      ?? undefined,
    );
  });

  return {
    loadWorkspace: () => request('papers:project:as-you-go-load').then(decodeWorkspaceState),
    saveWorkspace: (state) => request('papers:project:as-you-go-save', {
      state: encodeWorkspaceState(state),
    }),
    launchShortcut: (actionId) => request('papers:project:as-you-go-launch', { actionId }),
    revealShortcut: (actionId) => request('papers:project:as-you-go-reveal', { actionId }),
    openWebLink: (url) => request('papers:project:open-web-link', { url }),
    pickTarget: (kind) => request('papers:project:as-you-go-pick-target', { kind }),
    shortcutIcon: (detail) => request('papers:project:as-you-go-shortcut-icon', detail),
    resolveWebIcon: (url) => request('papers:project:resolve-web-link-icon', { url }),
    resolveDroppedTargets: (files) =>
      request('papers:project:resolve-dropped-targets', { files }),
    copyText: (text) => request('papers:project:copy-text', { text }),
    windowCandidates: () => request('papers:project:window-candidates'),
    bindWindowCandidate: (candidateId) =>
      request('papers:project:window-bind-candidate', { candidateId }),
    observeWindowCapability: (capability) =>
      request('papers:project:window-observe-capability', { capability }),
    minimizeWindowCapability: (capability) =>
      request('papers:project:window-minimize-capability', { capability }),
    restoreWindowCapability: (capability) =>
      request('papers:project:window-restore-capability', { capability }),
    applyWindowCapability: (capability, bounds) =>
      request('papers:project:window-apply-capability', { capability, bounds }),
    resolveWindowDescriptor: (descriptor) =>
      request('papers:project:window-resolve-descriptor', { descriptor }),
    // 016: direct onscreen pick (Papers-owned overlay + eligibility).
    pickWindowBegin: (members) => request('papers:project:window-pick-begin', { members }),
    pickWindowCancel: () => request('papers:project:window-pick-cancel'),
    onPickResult: (callback) => {
      pickListeners.add(callback);
      return () => pickListeners.delete(callback);
    },
  };
}

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

  function request(type, detail = {}) {
    const requestId = crypto.randomUUID();
    window.parent.postMessage({ type, requestId, ...detail }, '*');
    return new Promise((resolve, reject) => pending.set(requestId, { resolve, reject }));
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window.parent || event.data?.type !== HOST_RESULT) return;
    const task = pending.get(event.data.requestId);
    if (!task) return;
    pending.delete(event.data.requestId);
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
  };
}

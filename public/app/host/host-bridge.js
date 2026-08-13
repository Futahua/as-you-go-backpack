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
  const detachListeners = new Set();

  function request(type, detail = {}) {
    if (pending.size >= MAX_PENDING) {
      return Promise.reject(new Error('Host request capacity reached.'));
    }
    const requestId = crypto.randomUUID();
    if (type === 'papers:project:window-pick-begin') console.info('[045-direct-pick] host-request', requestId);
    window.parent.postMessage({ type, requestId, ...detail }, '*');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error('Host request timed out.'));
      }, REQUEST_TIMEOUT_MS);
      pending.set(requestId, { resolve, reject, timer, type });
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
    // 018X1: canonical detach lifecycle PUSH shape is FLAT:
    //   { type: 'papers:project:detach-*', transferId, reason? }
    // The legacy `{ detail: {...} }` wrapper is accepted too. The opaque token
    // never reaches page code.
    if (typeof event.data?.type === 'string'
      && event.data.type.startsWith('papers:project:detach-')
      && !event.data.requestId) {
      const detail = event.data.detail ?? event.data;
      for (const listener of detachListeners) {
        listener(event.data.type, detail);
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
    if (task.type === 'papers:project:window-thumbnail') {
      // 019GR: the compact hover preview consumes ONLY the exact shared result.
      // Success is exactly { outcome, imageUrl, width, height }; a fallback is
      // exactly { outcome } plus an optional bounded error - never generic
      // capability fields such as observation:null.
      if ('imageUrl' in event.data) {
        task.resolve({
          outcome: event.data.outcome,
          imageUrl: event.data.imageUrl,
          width: event.data.width,
          height: event.data.height,
        });
      } else {
        task.resolve({
          outcome: event.data.outcome,
          ...(event.data.error !== undefined ? { error: event.data.error } : {}),
        });
      }
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
    if ('widget' in event.data) {
      // 019C: the compact-widget host wraps its typed result under one key so
      // the protocol-level ok flag is never shadowed by the session's own ok.
      task.resolve({
        ok: event.data.widget?.ok === true,
        reused: event.data.widget?.reused === true,
        error: event.data.widget?.error ?? null,
      });
      return;
    }
    if ('menu' in event.data) {
      task.resolve({ action: event.data.menu?.action === 'remove' ? 'remove' : 'cancel' });
      return;
    }
    if ('picker' in event.data) {
      task.resolve({ candidateId: event.data.picker?.candidateId ?? null });
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
    terminateWindowCapability: (capability) =>
      request('papers:project:window-terminate-capability', { capability }),
    applyWindowCapability: (capability, bounds) =>
      request('papers:project:window-apply-capability', { capability, bounds }),
    resolveWindowDescriptor: (descriptor) =>
      request('papers:project:window-resolve-descriptor', { descriptor }),
    // 016: direct onscreen pick (Papers-owned overlay + eligibility).
    pickWindowBegin: (members) => request('papers:project:window-pick-begin', { members }),
    // 022: active picker keyboard controls are handled by the Papers picker
    // session; the page only requests stage/commit and never mutates state.
    pickWindowStage: () => request('papers:project:window-pick-stage'),
    pickWindowCommit: () => request('papers:project:window-pick-commit'),
    pickWindowCancel: () => request('papers:project:window-pick-cancel'),
    onPickResult: (callback) => {
      pickListeners.add(callback);
      return () => pickListeners.delete(callback);
    },
    // 018A1/018X1 frozen detach lifecycle (As You Go half). Every call is an
    // enumerated argument-free request in the existing project vocabulary; the
    // opaque transferId/projectId are attached by the Papers preload, never by
    // page data. The preload answers one-way ACK sends with an immediate OK
    // host result, so these resolve without the 15s timeout.
    detachOpen: () => request('papers:project:detach-open'),
    // 018V2: the exact two-sided-latch page request. A fresh DETACHED page
    // reports renderer lifecycle-ready exactly once, AFTER its detach-message
    // listener is installed and BEFORE it waits for ACTIVATE/load/bootstrap.
    // The page carries NO token/transfer; the preload latches token + READY.
    detachReady: () => request('papers:project:detach-ready'),
    // 018V4: receipt-confirmed ACTIVATE. The detached page ACKs every valid
    // ACTIVATE push for the active transfer (duplicate resends included) with
    // the exact request below; the preload validates it against the hidden
    // token/transfer and returns an immediate OK host result.
    detachActivatedAck: (transferId) =>
      request('papers:project:detach-activated-ack', { transferId }),
    detachStopAck: (transferId) => request('papers:project:detach-stop-ack', { transferId }),
    detachFlushAck: (transferId) => request('papers:project:detach-flush-ack', { transferId }),
    detachReattach: () => request('papers:project:detach-reattach'),
    detachFocus: () => request('papers:project:detach-focus'),
    detachResumedAck: (transferId) => request('papers:project:detach-resumed-ack', { transferId }),
    onDetachMessage: (callback) => {
      detachListeners.add(callback);
      return () => detachListeners.delete(callback);
    },
    // 019C: compact widget surface (one native widget per layout). open/focus/
    // close are workspace requests carrying the opaque bounded layout key;
    // widgetCloseSelf is the WIDGET page's token-attached self-close; ready is
    // the two-sided-latch page request the preload answers with the hidden
    // token (019B).
    widgetOpen: (layoutKey) => request('papers:project:widget-open', { layoutKey }),
    widgetFocus: (layoutKey) => request('papers:project:widget-focus', { layoutKey }),
    widgetClose: (layoutKey) => request('papers:project:widget-close', { layoutKey }),
    widgetCloseSelf: () => request('papers:project:widget-close'),
    widgetReady: () => request('papers:project:widget-ready'),
    // 024: the compact-widget page reports its bounded card content size after
    // each render so the host refits the frameless window to the compact card.
    widgetReportSize: (width, height) => request('papers:project:widget-report-size', { width, height }),
    widgetPreviewShow: (imageUrl, title, width, height, anchor) => request('papers:project:widget-preview-show', {
      imageUrl, title, width, height, anchor,
    }),
    widgetPreviewHide: () => request('papers:project:widget-preview-hide'),
    widgetContextMenu: () => request('papers:project:widget-context-menu'),
    windowCandidatePicker: (candidates) => request('papers:project:window-candidate-picker', { candidates }),
    // 019G: real window thumbnail (Windows-taskbar-like hover preview). Consumes
    // ONLY the exact shared API: page request `papers:project:window-thumbnail`
    // with `{ capability, options: { maxWidth, maxHeight } }` (defaults 240x135;
    // Papers clamps/rejects above 320x180). The result is a strict data-PNG
    // success or a payload-free typed fallback.
    windowThumbnailCapability: (capability, options = {}) => request('papers:project:window-thumbnail', {
      capability,
      options: {
        maxWidth: options.maxWidth ?? 240,
        maxHeight: options.maxHeight ?? 135,
      },
    }),
    windowPeekBeginCapability: (capability) => request('papers:project:window-peek-begin', { capability }),
    windowPeekEnd: () => request('papers:project:window-peek-end'),
  };
}

import { createHostBridge } from './host/host-bridge.js?build=coordination-v18';
import { createFileCapabilityPanel } from './file-capability-panel.js';

function parentOrigin() {
  try {
    const parsed = new URL(document.referrer);
    const origin = parsed.origin === 'null' ? `${parsed.protocol}//${parsed.host}` : parsed.origin;
    return origin && origin !== 'null' ? origin : '*';
  } catch {
    return '*';
  }
}

const expectedParentOrigin = parentOrigin();
const host = createHostBridge(window);
let disposed = false;

const panel = createFileCapabilityPanel({
  document,
  host,
  setStatus: () => {},
});
panel.openSearch();

const releaseNativeEdge = host.onChromeLayout?.(rect => {
  if (disposed || !Number.isFinite(rect?.x)) return;
  window.parent.postMessage({ type: 'papers:proxima-preview-native-edge', x: rect.x, parentX: rect.parentX }, expectedParentOrigin);
});


window.addEventListener('keydown', (event) => {
  if (event.defaultPrevented || event.key !== 'Tab'
    || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey
    || event.isComposing || event.repeat) return;
  event.preventDefault();
  event.stopPropagation();
  window.parent.postMessage({ type: 'papers:proxima-toggle-left-pane-request' }, expectedParentOrigin);
}, true);

function disposePreview() {
  if (disposed) return;
  disposed = true;
  releaseNativeEdge?.();
  panel.destroy();
}

window.addEventListener('message', (event) => {
  if (event.source !== window.parent) return;
  if (expectedParentOrigin !== '*' && event.origin !== expectedParentOrigin) return;
  if (event.data?.type === 'papers:proxima-preview-selection') {
    if (disposed) return;
    panel.syncSelection(event.data.selection);
    return;
  }
  if (event.data?.type === 'papers:proxima-preview-reposition') {
    if (disposed) return;
    panel.refreshPreviewGeometry();
    return;
  }
  if (event.data?.type === 'papers:proxima-preview-dispose') {
    disposePreview();
    window.parent.postMessage({ type: 'papers:proxima-preview-disposed' }, expectedParentOrigin);
  }
});

window.addEventListener('pagehide', disposePreview, { once: true });
window.parent.postMessage({ type: 'papers:proxima-preview-ready' }, expectedParentOrigin);

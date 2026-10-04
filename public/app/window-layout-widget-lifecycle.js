/** Native widget presentation only; no writer/store/recording authority. */
export function createWindowLayoutWidgetLifecycle({
  widgetOpen, getState, detachmentMode, isReadOnly, itemsIn,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  function windowLayoutWidgetOpenSucceeded(result) {
    return Boolean(result)
      && result.ok !== false
      && result.widget?.ok !== false
      && result.outcome !== 'failed'
      && result.outcome !== 'error';
  }

  async function openWindowLayoutWidgetWithRetry(layoutId, options = {}) {
    let result = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        result = await widgetOpen(layoutId, options);
      } catch {
        result = null;
      }
      if (windowLayoutWidgetOpenSucceeded(result)) return result;
      if (attempt < 2) await wait(100 * (2 ** attempt));
    }
    return result;
  }

  async function ensureStartupWindowLayoutWidget() {
    if (detachmentMode() === 'detached'
      || isReadOnly()) return;
    // Every layout is a native widget by default. Only layouts explicitly
    // middle-clicked into the AYG pill tray stay docked across startup.
    const docked = new Set(getState().windowLayoutPillIds ?? []);
    const layouts = (getState().windowLayouts ?? []).filter((layout) =>
      layout.binned !== true
        && !layout.bin
        && !docked.has(layout.id)
        && itemsIn(getState(), layout.parentId).some((candidate) => candidate.id === layout.id));
    // Writer handoff can happen when a new AYG tab opens. Reconcile widgets
    // without activating every existing native window and disturbing taskbar
    // order/focus; direct user opens retain the normal activate behavior.
    for (const layout of layouts) await openWindowLayoutWidgetWithRetry(layout.id, { activate: false });
  }
  return { open: openWindowLayoutWidgetWithRetry, ensureStartup: ensureStartupWindowLayoutWidget, succeeded: windowLayoutWidgetOpenSucceeded };
}

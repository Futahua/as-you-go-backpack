/** AYG card measurement/observation lifecycle and existing trailing size-save path.
 * No native or host operations; persistence stays in the injected existing store. */
export function createWindowLayoutCardPresentation({
  ResizeObserver, WIDGET_SURFACE, WINDOW_LAYOUT_CARD_MAX_WIDTH, getState,
  windowLayoutFromState, setWindowLayoutCardSize, store,
  setTimeout = globalThis.setTimeout, clearTimeout = globalThis.clearTimeout,
}) {
function balanceWindowLayoutMemberRows(card) {
  const members = card?.querySelector?.('[data-wl-members]');
  if (!members) return;
  const count = members.querySelectorAll('[data-wl-member]').length;
  if (count === 0) {
    members.style.removeProperty('--wl-balanced-member-width');
    return;
  }
  const available = Math.max(28, card.clientWidth - 16);
  const maxColumns = Math.max(1, Math.floor((available + 4) / 32));
  const rows = Math.max(1, Math.ceil(count / maxColumns));
  const columns = Math.ceil(count / rows);
  members.style.setProperty('--wl-balanced-member-width', `${(columns * 28) + ((columns - 1) * 4)}px`);
}

const windowLayoutCardResizeTimers = new WeakMap();
const windowLayoutCardResizeObserver = typeof ResizeObserver === 'function'
  ? new ResizeObserver((entries) => {
    for (const { target: card } of entries) {
      balanceWindowLayoutMemberRows(card);
      if (WIDGET_SURFACE || !card.isConnected || !card.style.width || card.matches('.window-layout-card--placeholder')) continue;
      const layoutId = card.dataset.wlCard;
      const width = Math.min(Math.round(card.getBoundingClientRect().width), WINDOW_LAYOUT_CARD_MAX_WIDTH);
      const height = Math.ceil(card.scrollHeight);
      const shell = card.closest('.window-layout-shell');
      if (shell) shell.style.setProperty('--wl-card-width', `${width}px`);
      const prior = windowLayoutCardResizeTimers.get(card);
      if (prior) clearTimeout(prior);
      windowLayoutCardResizeTimers.set(card, setTimeout(() => {
        windowLayoutCardResizeTimers.delete(card);
        const layout = windowLayoutFromState(layoutId);
        if (!layout || !card.isConnected) return;
        let next;
        try { next = setWindowLayoutCardSize(getState(), layoutId, width, height); } catch { return; }
        if (next === getState()) return;
        store.replace(next);
        void store.save(next, { rebaseAutomaticSave: true }).catch(() => undefined);
      }, 180));
    }
  })
  : null;

function installWindowLayoutCardPresentation(root) {
  for (const card of root?.querySelectorAll?.('.window-layout-card') ?? []) {
    balanceWindowLayoutMemberRows(card);
    windowLayoutCardResizeObserver?.observe(card);
  }
}

function removeWindowLayoutCardPresentation(root) {
  for (const card of root?.querySelectorAll?.('.window-layout-card') ?? []) {
    windowLayoutCardResizeObserver?.unobserve(card);
  }
}


return { install: installWindowLayoutCardPresentation, remove: removeWindowLayoutCardPresentation, balance: balanceWindowLayoutMemberRows };
}

/** Browser tab mutation policy. Both the close button and menu use this plan. */
export function browserTabClosePlan(tabs, activeId, tabId, others = false) {
  const index = tabs.findIndex((tab) => tab.id === tabId);
  if (index < 0) return null;
  const remaining = others ? [tabs[index]] : tabs.filter((tab) => tab.id !== tabId);
  return {
    tabs: remaining,
    closed: tabs.filter((tab) => !remaining.includes(tab)),
    activeId: others ? tabId : activeId === tabId ? remaining[Math.min(index, remaining.length - 1)]?.id || null : activeId,
  };
}

export function createPaneFillControl({ panel, button, refresh, schedule = (callback) => callback() }) {
  let filled = false;
  const setFilled = (next) => {
    filled = Boolean(next);
    panel.classList.toggle('fills-tab', filled);
    button.setAttribute('aria-pressed', String(filled));
    button.setAttribute('aria-label', filled ? 'Restore side pane' : 'Fill this Papers tab');
    button.title = filled ? 'Restore side pane' : 'Fill this Papers tab';
    schedule(refresh);
  };
  button.addEventListener('click', () => setFilled(!filled));
  setFilled(false);
  return { setFilled, isFilled: () => filled };
}

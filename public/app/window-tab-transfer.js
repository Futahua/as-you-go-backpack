export const WINDOW_TAB_MIME = 'application/x-papers-window-instance';
export function windowTabTransfer(value) {
  return typeof value === 'string' && /^W[0-9a-f]{16}$/i.test(value) ? value : null;
}
export function paneWindowPickerRows(candidates, tabs) {
  const rows = tabs.map(tab => {
    const candidate = candidates.find(candidate => tab.windowInstanceId && candidate.windowInstanceId === tab.windowInstanceId);
    return { id: candidate?.id ?? 'pane:' + tab.id, title: tab.title, icon: candidate?.icon ?? null, current: true };
  });
  for (const candidate of candidates) {
    if (tabs.some(tab => tab.windowInstanceId && tab.windowInstanceId === candidate.windowInstanceId)) continue;
    rows.push({ id: candidate.id, title: candidate.title, icon: candidate.icon ?? null, current: false, ...(candidate.inUse?{inUse:candidate.inUse}:{}) });
  }
  return rows.slice(0, 64);
}

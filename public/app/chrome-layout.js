// Surrounding controls supply the initial slot and its outer boundaries.
// After native resizing Chrome's left edge owns the split; the host sends it
// back to the layout. No preview node is created or used as an input surface.
export function chromeLayoutBounds(panel, header, viewport) {
  const box = panel.getBoundingClientRect();
  // The tab row is the visible boundary. The enclosing preview header can
  // retain extra height from file-preview layout during restoration.
  const tabStrip = header.querySelector?.('.pane-window-tabs');
  const controls = (tabStrip && tabStrip.getBoundingClientRect().height > 0
    ? tabStrip : header).getBoundingClientRect();
  const left = Math.max(0, Math.round(box.left + 1));
  const top = Math.max(0, Math.round(Math.max(box.top + 1, controls.bottom + 1)));
  const right = Math.min(viewport.innerWidth, Math.round(box.right - 1));
  const bottom = Math.min(viewport.innerHeight, Math.round(box.bottom - 1));
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top,
    rightInset: Math.max(0, viewport.innerWidth - right),
    bottomInset: Math.max(0, viewport.innerHeight - bottom) };
}

export function trackChromeLayout({ panel, header, viewport, update }) {
  let frame = null;
  let stopped = false;
  const refresh = () => {
    if (stopped || frame !== null) return;
    frame = viewport.requestAnimationFrame(() => {
      frame = null;
      if (!stopped && panel.isConnected) update(chromeLayoutBounds(panel, header, viewport));
    });
  };
  const Observer = viewport.ResizeObserver;
  const observer = Observer ? new Observer(refresh) : null;
  observer?.observe(panel);
  observer?.observe(header);
  viewport.addEventListener('resize', refresh);
  // Keep up with the existing layout transition without a perpetual poll.
  panel.addEventListener('transitionend', refresh);
  panel.addEventListener('transitionrun', refresh);
  refresh();
  return {
    refresh,
    stop() {
      stopped = true;
      if (frame !== null) viewport.cancelAnimationFrame(frame);
      observer?.disconnect();
      viewport.removeEventListener('resize', refresh);
      panel.removeEventListener('transitionend', refresh);
      panel.removeEventListener('transitionrun', refresh);
    },
  };
}

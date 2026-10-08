// Native providers report their current stage. Startup without a real range
// remains indeterminate; never extrapolate elapsed time into a percentage.
export function createEditorLoadingProgress({ document, container, status, active, schedule = setTimeout, cancel = clearTimeout }) {
  const row = document.createElement('div');
  row.className = 'file-capability-editor-loading';
  const label = document.createElement('span');
  label.textContent = 'Opening document…';
  const bar = document.createElement('progress');
  bar.setAttribute('aria-label', 'Document loading progress');
  row.append(label, bar);
  container.prepend(row);
  let stopped = false, timer = null;
  async function poll() {
    if (stopped || !active()) return;
    try {
      const progress = await status();
      if (stopped || !active()) return;
      if (progress) {
        label.textContent = progress.text || 'Opening document…';
        if (Number.isFinite(progress.maximum) && progress.maximum > 0 && Number.isFinite(progress.value)) {
          bar.max = progress.maximum;
          bar.value = Math.max(0, Math.min(progress.maximum, progress.value));
          bar.setAttribute('aria-valuetext', `${Math.floor(bar.value / bar.max * 100)}% of the current loading stage`);
        } else {
          bar.removeAttribute('value');
          bar.removeAttribute('aria-valuetext');
        }
      }
    } catch { /* The open request owns failure reporting. */ }
    if (!stopped && active()) timer = schedule(poll, 250);
  }
  void poll();
  return {
    stop() { stopped = true; if (timer !== null) cancel(timer); row.remove(); },
  };
}

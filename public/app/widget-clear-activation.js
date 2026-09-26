/** Process a widget clear only for a real pointer-generated click. */
export function handleWidgetClearActivation(event, button, guard, clear) {
  event?.preventDefault?.();
  if (!button || !guard || typeof clear !== 'function') return 'ignored';
  // Enter/Space synthesize click events with detail 0 on a focused button.
  // This control is intentionally a two-pointer-click confirmation, so a key
  // press can never become the second destructive activation.
  if (!Number.isFinite(event?.detail) || event.detail <= 0) {
    button.blur?.();
    return 'ignored-keyboard';
  }

  const activation = guard.activate();
  if (!activation.confirmed) {
    button.classList?.add('is-clear-armed');
    button.blur?.();
    return 'armed';
  }

  guard.reset();
  button.classList?.remove('is-clear-armed');
  button.blur?.();
  clear();
  return 'cleared';
}

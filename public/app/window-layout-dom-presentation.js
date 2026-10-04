/** Live member-state DOM patches and transient status lifecycle; no document writes. */
import { windowLayoutMemberKey } from './window-layout-runtime.js';
export function createWindowLayoutDomPresentation({
  document, CSS, WIDGET_SURFACE, windowLayoutRuntime,
  setTimeout = globalThis.setTimeout, clearTimeout = globalThis.clearTimeout,
}) {
const windowLayoutTransientStatusTimers = new Map();
function setWindowLayoutStatus(layoutId, text) {
  const previous = windowLayoutTransientStatusTimers.get(layoutId);
  if (previous) {
    clearTimeout(previous);
    windowLayoutTransientStatusTimers.delete(layoutId);
  }
  const status = document.querySelector(`[data-wl-status="${CSS.escape(layoutId)}"]`);
  if (status) status.textContent = text;
  if (WIDGET_SURFACE && text) {
    const timer = setTimeout(() => {
      windowLayoutTransientStatusTimers.delete(layoutId);
      const current = document.querySelector(`[data-wl-status="${CSS.escape(layoutId)}"]`);
      if (current?.textContent === text) current.textContent = '';
    }, 2400);
    windowLayoutTransientStatusTimers.set(layoutId, timer);
  }
}

function setWindowLayoutTransientStatus(layoutId, text, durationMs = 2400) {
  if (WIDGET_SURFACE) {
    setWindowLayoutStatus(layoutId, text);
    return;
  }
  const previous = windowLayoutTransientStatusTimers.get(layoutId);
  if (previous) clearTimeout(previous);
  setWindowLayoutStatus(layoutId, text);
  const timer = setTimeout(() => {
    windowLayoutTransientStatusTimers.delete(layoutId);
    setWindowLayoutStatus(layoutId, '');
  }, durationMs);
  windowLayoutTransientStatusTimers.set(layoutId, timer);
}

function patchWindowLayoutMember(layoutId, memberId, liveState) {
  // 040: scope the DOM selector by layout+member so a state patch for one
  // layout can never touch the same-window member of another layout. There
  // can be two legitimate matches while a compact widget is detached: update
  // both copies instead of leaving one surface with stale underlines.
  //
  // LIVE state, not persisted state. The underline is presentation truth, and
  // only a live observation is allowed to paint it. An action's own result says
  // what was ASKED for, and the atomic toggle's observation describes the window
  // BEFORE the mutation - neither proves what is on screen now, so both paint
  // `unknown` until an observation confirms.
  const state = liveState === 'minimized' ? 'minimized' : (liveState === 'normal' ? 'normal' : 'unknown');
  windowLayoutRuntime.liveMemberState.set(windowLayoutMemberKey(layoutId, memberId), state);
  const buttons = document.querySelectorAll(
    `[data-wl-layout="${CSS.escape(layoutId)}"] [data-wl-member="${CSS.escape(memberId)}"]`);
  for (const button of buttons) {
    button.classList.remove('normal', 'minimized', 'unknown');
    button.classList.add(state);
    button.setAttribute('aria-pressed', state === 'minimized' ? 'true' : 'false');
    button.removeAttribute('title');
    // ONE stable element, always present: its state is inspectable at any moment
    // and there is no create/remove churn. Removing it for minimized made sense
    // while the model had only two states; "unknown" is a real state now.
    let marker = button.querySelector('.window-layout-member-state');
    if (!marker) {
      marker = document.createElement('span');
      marker.setAttribute('aria-hidden', 'true');
      button.append(marker);
    }
    marker.className = `window-layout-member-state ${state}`;
    marker.setAttribute('data-wl-live-state', state);
  }
}


return { status: setWindowLayoutStatus, transient: setWindowLayoutTransientStatus, patch: patchWindowLayoutMember };
}

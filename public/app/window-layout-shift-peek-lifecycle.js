/** One Shift Peek timer/generation/host-queue owner; native Peek remains host-owned. */
export function createWindowLayoutShiftPeekLifecycle({
  host, resolveWindowLayoutPreviewCapability, cancelWindowLayoutPreviewDwell,
  windowLayoutMemberPopover, windowLayoutMemberPreview, WIDGET_SURFACE, document,
  setTimeout = globalThis.setTimeout, clearTimeout = globalThis.clearTimeout,
}) {
let windowLayoutShiftPeekHeld = false;
let windowLayoutShiftPeekGeneration = 0;
let windowLayoutShiftPeekKey = null;
let windowLayoutShiftPeekEndTimer = null;
let windowLayoutShiftPeekStartTimer = null;
let windowLayoutShiftPeekRetryTimer = null;
let windowLayoutShiftPeekHostQueue = Promise.resolve();

function enqueueWindowLayoutShiftPeekHostOperation(operation) {
  const pending = windowLayoutShiftPeekHostQueue.then(operation, operation);
  windowLayoutShiftPeekHostQueue = pending.catch(() => undefined);
  return pending;
}

function endWindowLayoutShiftPeek() {
  // Planner keyup/blur and pointer-leave can converge on this function. Once
  // this target's lifecycle has been cleared, later notifications must not
  // issue another host end (or let an old completion end a newer target).
  if (windowLayoutShiftPeekKey === null
    && windowLayoutShiftPeekStartTimer === null
    && windowLayoutShiftPeekEndTimer === null
    && windowLayoutShiftPeekRetryTimer === null) return;
  if (windowLayoutShiftPeekStartTimer !== null) {
    clearTimeout(windowLayoutShiftPeekStartTimer);
    windowLayoutShiftPeekStartTimer = null;
  }
  if (windowLayoutShiftPeekEndTimer !== null) {
    clearTimeout(windowLayoutShiftPeekEndTimer);
    windowLayoutShiftPeekEndTimer = null;
  }
  if (windowLayoutShiftPeekRetryTimer !== null) {
    clearTimeout(windowLayoutShiftPeekRetryTimer);
    windowLayoutShiftPeekRetryTimer = null;
  }
  windowLayoutShiftPeekGeneration += 1;
  windowLayoutShiftPeekKey = null;
  void enqueueWindowLayoutShiftPeekHostOperation(() => host.windowPeekEnd()).catch(() => undefined);
}

function deferWindowLayoutShiftPeekEnd() {
  if (windowLayoutShiftPeekEndTimer !== null) clearTimeout(windowLayoutShiftPeekEndTimer);
  windowLayoutShiftPeekEndTimer = setTimeout(() => {
    windowLayoutShiftPeekEndTimer = null;
    windowLayoutShiftPeekHeld = false;
    endWindowLayoutShiftPeek();
  }, 120);
}

function keepWindowLayoutShiftPeekAlive() {
  if (windowLayoutShiftPeekEndTimer === null) return;
  clearTimeout(windowLayoutShiftPeekEndTimer);
  windowLayoutShiftPeekEndTimer = null;
}

function beginWindowLayoutShiftPeek(member) {
  const layoutId = member?.dataset?.wlLayout;
  const memberId = member?.dataset?.wlMember;
  if (!layoutId || !memberId) return;
  const key = `${layoutId}\u0000${memberId}`;
  if (windowLayoutShiftPeekKey === key) return;
  const generation = ++windowLayoutShiftPeekGeneration;
  windowLayoutShiftPeekKey = key;
  if (windowLayoutShiftPeekStartTimer !== null) clearTimeout(windowLayoutShiftPeekStartTimer);
  if (windowLayoutShiftPeekRetryTimer !== null) clearTimeout(windowLayoutShiftPeekRetryTimer);
  cancelWindowLayoutPreviewDwell();
  windowLayoutMemberPopover.hide();
  windowLayoutMemberPreview.cancel();
  // Explorer's compositor path is private; our bounded foreign-window
  // fallback must never queue one native transition for every icon crossed.
  // Coalesce traversal within two display frames: an A->B->C sweep performs C
  // only, while an intentional hover remains effectively immediate.
  windowLayoutShiftPeekStartTimer = setTimeout(() => {
    windowLayoutShiftPeekStartTimer = null;
    void performWindowLayoutShiftPeek(layoutId, memberId, generation);
  }, 32);
}

async function performWindowLayoutShiftPeek(layoutId, memberId, generation, attempt = 0) {
  let capability = null;
  try {
    capability = await resolveWindowLayoutPreviewCapability(layoutId, memberId);
  } catch {
    // Capability lookup may briefly fail while the host is catching up. Keep
    // retrying this same hovered target while Shift remains held.
  }
  if (!capability && WIDGET_SURFACE) document.title = 'peek: no capability';
  if (generation !== windowLayoutShiftPeekGeneration || !windowLayoutShiftPeekHeld
    || windowLayoutShiftPeekKey !== `${layoutId}\u0000${memberId}`) return;
  if (!capability) {
    windowLayoutShiftPeekRetryTimer = setTimeout(() => {
      windowLayoutShiftPeekRetryTimer = null;
      void performWindowLayoutShiftPeek(layoutId, memberId, generation, attempt + 1);
    }, Math.min(1000, 180 + attempt * 120));
    return;
  }
  const result = await enqueueWindowLayoutShiftPeekHostOperation(() => {
    // A newer target or release may have arrived while this operation waited
    // behind an in-flight host call. Never let the stale target start late.
    if (generation !== windowLayoutShiftPeekGeneration || !windowLayoutShiftPeekHeld
      || windowLayoutShiftPeekKey !== `${layoutId}\u0000${memberId}`) return { outcome: 'cancelled' };
    return host.windowPeekBeginCapability(capability);
  }).catch((error) => ({ outcome: 'error', error: String(error) }));
  // ONE LINE THAT PROVES THE WHOLE REMAINING CHAIN: the broker noticed physical
  // Shift, Node parsed it, IPC forwarded it, the preload posted it, the host bridge
  // relayed it, the widget received it, resolved a capability and Peek began. The
  // native watcher is already proven separately, so nothing else needs proving.
  if (WIDGET_SURFACE) document.title = 'shift-peek | held=1 | begin=' + String(result?.outcome ?? 'empty')
    + ' ' + String(result?.error ?? '').slice(0, 60);
  if (generation !== windowLayoutShiftPeekGeneration) {
    // The lifecycle owner already ended or superseded this attempt. An extra
    // global end here could cancel a newer member's Peek.
    return;
  }
  if (result?.outcome !== 'success' && windowLayoutShiftPeekHeld) {
    windowLayoutShiftPeekRetryTimer = setTimeout(() => {
      windowLayoutShiftPeekRetryTimer = null;
      void performWindowLayoutShiftPeek(layoutId, memberId, generation, attempt + 1);
    }, Math.min(1000, 180 + attempt * 120));
  }
}

function applyWindowLayoutShiftPeekTransition(transition) {
  if (!transition.handled) return false;
  windowLayoutShiftPeekHeld = transition.held;
  if (transition.begin) void beginWindowLayoutShiftPeek(transition.begin);
  if (transition.end) endWindowLayoutShiftPeek();
  return true;
}


return { begin: beginWindowLayoutShiftPeek, end: endWindowLayoutShiftPeek, deferEnd: deferWindowLayoutShiftPeekEnd, keepAlive: keepWindowLayoutShiftPeekAlive, apply: applyWindowLayoutShiftPeekTransition, get held() { return windowLayoutShiftPeekHeld; }, get key() { return windowLayoutShiftPeekKey; } };
}

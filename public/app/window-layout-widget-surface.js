/** Compact widget surface: ephemeral presentation/input and channel wiring, no durable writer. */
import { createWindowLayoutSelection } from './window-layout-selection.js';
import { createWindowLayoutWidgetPicker } from './window-layout-widget-picker.js';
import { createClickTwiceGuard } from './click-twice-guard.js';
import { createWidgetHoverPolicy, createWidgetHoverPolicyDiagnostics } from './widget-hover-policy.js';
import { handleWidgetClearActivation, handleWidgetDeleteActivation } from './widget-clear-activation.js';
import { createWindowLayoutMemberDrag } from './window-layout-detached.js';
import { createWindowLayoutWidgetChannelClient as defaultChannelClient,
  createBoundedRetry as defaultBoundedRetry, windowLayoutWidgetRenderIdentity,
  windowLayoutWidgetCommittedStatus, WINDOW_LAYOUT_WIDGET_CHANNEL,
  WINDOW_LAYOUT_CARD_MAX_WIDTH } from './window-layout-widget-channel.js';
import { reconcileWindowLayoutIconSnapshotCache } from './window-layout-icon-hydration.js';
import { windowLayoutMemberKey } from './window-layout-runtime.js';
export function bootstrapWindowLayoutWidget({
  WIDGET_SURFACE, localStorage = globalThis.localStorage, document = globalThis.document,
  window = globalThis.window, CSS = globalThis.CSS, Element = globalThis.Element,
  crypto = globalThis.crypto, setTimeout = globalThis.setTimeout, clearTimeout = globalThis.clearTimeout,
  setInterval = globalThis.setInterval, clearInterval = globalThis.clearInterval,
  host, elements, createSafeBroadcastChannel, windowLayoutRuntime, windowLayoutMemberPreview,
  windowLayoutMemberPopover, windowLayoutWidgetPreviewCapabilities, windowLayoutWidgetSelectionChannel,
  setWindowLayoutStatus, closeWindowLayoutMember, toggleWindowLayoutIsolateMode,
  cancelWindowLayoutPreviewDwell, scheduleWindowLayoutListDwell, cancelWindowLayoutListDwell,
  moveWindowLayoutMemberButton, evictStaleWidgetPreviewCapabilities,
  removeWindowLayoutCardPresentation, installWindowLayoutCardPresentation, windowLayoutCardMarkup,
  applyTheme, closeWindowLayoutCandidate, restoreHoveredWindowLayoutPreview, bindWindowLayoutPickerCandidate,
  quickRun, menu, WINDOW_LAYOUT_DROP_OUT_PX, setWidgetClient, setControlSnapshot, setPreviewSnapshot,
  createWindowLayoutWidgetChannelClient = defaultChannelClient, createBoundedRetry = defaultBoundedRetry,
}) {
  const { layoutId } = WIDGET_SURFACE;
  const widgetOpacityStorageKey = `papers-window-layout-widget-opacity:${layoutId}`;
  const storedWidgetOpacity = localStorage.getItem(widgetOpacityStorageKey);
  const parsedWidgetOpacity = storedWidgetOpacity === null ? Number.NaN : Number(storedWidgetOpacity);
  let widgetOpacity = Number.isFinite(parsedWidgetOpacity)
    ? Math.max(0, Math.min(1, parsedWidgetOpacity))
    : 1;

  function applyWidgetOpacity() {
    const opacity = widgetOpacity;
    document.documentElement.style.setProperty('--workspace-backdrop-opacity', String(opacity));
    document.documentElement.style.setProperty(
      '--workspace-backdrop-opacity-percent',
      `${Math.round(opacity * 10000) / 100}%`,
    );
  }
  const channel = createSafeBroadcastChannel(WINDOW_LAYOUT_WIDGET_CHANNEL);
  const widgetState = {
    selection: new Set(),
    clearArmed: false,
    clearArmTimer: null,
    anchor: new Map(),
    snapshot: { id: layoutId, name: layoutId, tracking: { enabled: false }, members: [] },
    candidates: null,
    pickUnsubscribe: null,
    pickAttempt: null,
    lastRevision: -1,
    // What the currently mounted card DOM was built from. Protocol revision is
    // NOT that identity: see windowLayoutWidgetRenderIdentity.
    lastRenderIdentity: null,
    // 035: true once a real workspace snapshot has been received (the restore
    // below must never run against the empty initial default snapshot).
    snapshotReceived: false,
    blockedHotkeyBindings: [],
    hoverPolicyReceived: false,
  };
  const widgetClearGuard = createClickTwiceGuard();
  const widgetDeleteGuard = createClickTwiceGuard();
  const widgetHoverPolicyDiagnostics = createWidgetHoverPolicyDiagnostics();
  const widgetHoverPolicy = createWidgetHoverPolicy({
    publish: (enabled, blockedBindings) => host.setWidgetHoverPolicy(enabled, blockedBindings),
    onPublishFailure: widgetHoverPolicyDiagnostics.onPublishFailure,
    onPublishSuccess: widgetHoverPolicyDiagnostics.onPublishSuccess,
  });
  const widgetRoot = document.documentElement;
  const onWidgetPointerEnter = (event) => {
    if (event.pointerType === 'mouse') widgetHoverPolicy.setHovered(true);
  };
  const onWidgetPointerLeave = (event) => {
    if (event.pointerType === 'mouse') widgetHoverPolicy.setHovered(false);
  };
  widgetRoot.addEventListener('pointerenter', onWidgetPointerEnter);
  widgetRoot.addEventListener('pointermove', onWidgetPointerEnter);
  widgetRoot.addEventListener('pointerleave', onWidgetPointerLeave);
  // 035: the widget restores its window size EXACTLY ONCE after the first real
  // snapshot; every later resize is user-owned and only reported for persistence.
  let windowRestoredOnce = false;
  // 019G/021: bounded snapshot re-request for a transient unknown-layout.
  let snapshotRetry = null;
  let snapshotRetryCooldownTimer = null;
  const MAX_SNAPSHOT_RETRY_ARMINGS = 3;
  let snapshotRetryArmings = 0;
  function renderWidgetBootstrapCard(message) {
    const card = document.createElement('div');
    card.className = 'window-layout-card window-layout-card--bootstrap';
    card.setAttribute('role', 'status');
    card.setAttribute('aria-live', 'polite');
    card.textContent = message;
    elements.grid.replaceChildren(card);
  }
  /** A resolved open ends the cold-open episode: stop any running retry and let
   * a LATER unresolved open arm a fresh budget rather than inheriting a spent
   * one from this widget's whole lifetime. */
  function cancelSnapshotRetry() {
    snapshotRetry?.cancel?.();
    snapshotRetry = null;
    if (snapshotRetryCooldownTimer !== null) clearTimeout(snapshotRetryCooldownTimer);
    snapshotRetryCooldownTimer = null;
    snapshotRetryArmings = 0;
  }

  /** A cold widget can miss the first BroadcastChannel request before its
   * workspace writer is ready. Unlike an explicit unknown-layout response,
   * that race is silent, so retry a small bounded number of times and leave a
   * compact, understandable surface instead of exposing the whole Backpack
   * shell or remaining blank forever. */
  function armSnapshotRetry() {
    if (widgetState.snapshotReceived || snapshotRetry || snapshotRetryCooldownTimer !== null
      || snapshotRetryArmings >= MAX_SNAPSHOT_RETRY_ARMINGS) return;
    snapshotRetryArmings += 1;
    snapshotRetry = createBoundedRetry({
      attempts: 3,
      delayMs: 250,
      request: () => { client.requestSnapshot(); return null; },
      shouldRetry: () => !widgetState.snapshotReceived,
      onResult: () => {
        snapshotRetry = null;
        if (widgetState.snapshotReceived) return;
        const exhausted = snapshotRetryArmings >= MAX_SNAPSHOT_RETRY_ARMINGS;
        renderWidgetBootstrapCard(exhausted
          ? 'This window layout no longer exists.'
          : 'Waiting for the window layout…');
        if (exhausted) {
          void host.widgetCloseSelf().catch(() => undefined);
          return;
        }
        if (snapshotRetryArmings < MAX_SNAPSHOT_RETRY_ARMINGS) {
          snapshotRetryCooldownTimer = setTimeout(() => {
            snapshotRetryCooldownTimer = null;
            armSnapshotRetry();
          }, 500);
        }
      },
    });
    snapshotRetry.start();
  }

  function handleWidgetMessage(message) {
    // Deletion is document-global but native widget ownership is Papers-window
    // scoped. The elected writer may live in a different Papers window, so its
    // best-effort widgetClose(layoutId) can target the wrong owner even after
    // the durable delete succeeded. A committed deletion therefore closes from
    // the widget's own authenticated surface, which always names the exact
    // native window that must disappear.
    if (message.type === 'committed' && message.deleted === true) {
      cancelSnapshotRetry();
      void host.widgetCloseSelf().catch(() => undefined);
      return;
    }
    if (message.type === 'hover-policy') {
      if (typeof message.enabled !== 'boolean'
        || !Array.isArray(message.blockedBindings) || message.blockedBindings.length > 256
        || message.blockedBindings.some((binding) => typeof binding !== 'string' || binding.length > 64)) return;
      const modalOpen = [...document.querySelectorAll('[role="dialog"], dialog')]
        .some((dialog) => !dialog.hidden && dialog.getClientRects().length > 0);
      widgetState.blockedHotkeyBindings = message.blockedBindings;
      widgetState.hoverPolicyReceived = true;
      widgetHoverPolicy.updateWorkspacePolicy(message.enabled && !modalOpen, message.blockedBindings);
      return;
    }
    if (message.type === 'snapshot' || message.type === 'committed' || message.type === 'stale') {
      if (typeof message.revision !== 'number') return;
      // A committed response may carry one short sentence about what actually happened (a pick whose
      // removals were all refused, or one that removed some and could not match others). It is shown HERE,
      // before the render-identity guard below and not inside it: a refusal-only pick changes nothing, so
      // its snapshot is identical to the card already on screen and that guard would return early - leaving
      // this surface exactly as silent about the refusal as it was before the sentence existed.
      const committedStatus = windowLayoutWidgetCommittedStatus(message.status);
      if (committedStatus !== null) setWindowLayoutStatus(layoutId, committedStatus);
      widgetState.lastRevision = message.revision;
      if (message.snapshot && typeof message.snapshot === 'object' && message.snapshot.id === layoutId) {
        widgetState.snapshot = message.snapshot;
        setControlSnapshot(message.snapshot);
        if (message.snapshot.appearance && typeof message.snapshot.appearance === 'object') {
          applyTheme(message.snapshot.appearance);
          // Widget opacity is independent of workspace opacity. A fresh widget
          // is solid; only this widget's own saved/wheel-adjusted value applies.
          applyWidgetOpacity();
        }
        widgetState.snapshotReceived = true;
        const memberIds = new Set((message.snapshot.members ?? []).map((member) => member.id));
        widgetSelection.retain(layoutId, memberIds);
        // renderWidgetCard replaces elements.grid.innerHTML wholesale, which
        // destroys every member button and the pointer's hover target with it.
        // A duplicate message must therefore leave the live DOM alone: the
        // creator saw every icon flicker at once, and clicks fall through,
        // when repeated snapshots rebuild a card whose content never changed.
        // A real snapshot arrived, so any in-flight cold-open retry has served
        // its purpose; leaving it running would emit redundant requests.
        cancelSnapshotRetry();
        const renderIdentity = windowLayoutWidgetRenderIdentity(message.snapshot);
        if (renderIdentity === widgetState.lastRenderIdentity) return;
        // Recorded only AFTER a successful render: were the render to throw,
        // latching the identity first would suppress every identical retry and
        // strand the card on stale DOM.
        renderWidgetCard({ skipHostResize: message.reason === 'reorder' || message.commandKind === 'reorder' });
        widgetState.lastRenderIdentity = renderIdentity;
      }
      return;
    }
    if (message.type === 'error') {
      if (message.code === 'unknown-layout') {
        if (widgetState.snapshotReceived) {
          // A widget that previously held an authoritative snapshot cannot
          // legitimately outlive that layout. This is the orphan case left by
          // cross-window deletion or an external durable removal: close the
          // exact widget instead of leaving an interactive-looking dead shell.
          cancelSnapshotRetry();
          void host.widgetCloseSelf().catch(() => undefined);
          return;
        }
        armSnapshotRetry();
        return;
      }
      if (!widgetState.snapshotReceived) {
        renderWidgetBootstrapCard(message.message || 'The window layout is not available yet.');
        armSnapshotRetry();
        return;
      }
      setWindowLayoutStatus(layoutId, message.message || message.code || 'Command failed');
    }
  }

  function renderWidgetCard({ skipHostResize = false } = {}) {
    // 019GR: replacing the card must cancel the hover preview and hide the
    // popover so a late reply cannot paint a removed/replaced card. The
    // snapshot ref feeds the surface-aware preview resolver.
    windowLayoutMemberPreview.cancel();
    windowLayoutMemberPopover.hide();
    // The previous button node is about to be replaced; discard any armed
    // confirmation so its invisible state cannot survive without a red cue.
    resetWidgetClearArm();
    resetWidgetDeleteArm();
    // A capability identifies a WINDOW. A member going normal -> minimized does
    // not change which window it is, yet member state is part of the widget's
    // render identity, so the old blanket clear threw away every warm
    // capability on every successful toggle. That is what made ping-ponging
    // between two icons uniquely slow: each click re-cooled BOTH members, so
    // the next hover paid a fresh desktop list plus a bind/observe on the same
    // serial helper the click needs. Evict by descriptor identity instead.
    evictStaleWidgetPreviewCapabilities(widgetState.snapshot);
    setPreviewSnapshot(widgetState.snapshot);
    // 019G/021: seed the shared icon cache from the snapshot's bounded icons so
    // the SAME member markup renders REAL member icons (prune stale ones).
    // 040: composite layout\u0000member cache identity — prune only THIS
    // layout's keys that are no longer in the snapshot.
    const snapshot = widgetState.snapshot;
    reconcileWindowLayoutIconSnapshotCache(
      windowLayoutRuntime.icons,
      layoutId,
      snapshot.members,
      windowLayoutMemberKey,
    );
    // 033 C5: the detached widget renders the EXACT SAME card component as the
    // attached grid node - one shared card, two homes.
    removeWindowLayoutCardPresentation(elements.grid);
    elements.grid.innerHTML = windowLayoutCardMarkup(
      {
        id: snapshot.id,
        name: snapshot.name,
        tracking: snapshot.tracking,
        arrangement: { members: snapshot.members },
      },
      { widgetSurface: true },
    );
    installWindowLayoutCardPresentation(elements.grid);
    const card = elements.grid.querySelector('.window-layout-body');
    if (card) {
      card.addEventListener('pointerdown', (event) => {
        event.stopPropagation();
        if (event.button === 0 && !event.ctrlKey && !event.shiftKey
          && !event.target.closest('button, input, [data-wl-member]')) {
          clearWidgetSelection();
          beginBlankWidgetDrag(event, card);
        }
      });
      card.addEventListener('click', handleWidgetCardClick);
      card.addEventListener('auxclick', handleWidgetCardAuxClick);
      card.addEventListener('mouseover', (event) => {
        const listButton = event.target.closest('[data-wl-list]');
        const relatedListButton = event.relatedTarget?.closest?.('[data-wl-list]') ?? null;
        if (listButton && listButton !== relatedListButton) {
          scheduleWindowLayoutListDwell(listButton, openWidgetPicker);
        }
      });
      card.addEventListener('mouseout', (event) => {
        const listButton = event.target.closest('[data-wl-list]');
        const relatedListButton = event.relatedTarget?.closest?.('[data-wl-list]') ?? null;
        if (listButton && listButton !== relatedListButton) cancelWindowLayoutListDwell();
      });
      card.addEventListener('contextmenu', handleWidgetCardContextMenu);
    }
    syncWidgetSelection();
    // 035: restore the window ONCE after the first real snapshot (persisted
    // shared card geometry, or a content-fit when none exists yet). 039: after
    // that, EVERY re-render (e.g. a member-count change) auto-corrects the
    // native client height to the rendered card content height. The FIRST
    // restore reports BOTH axes itself; its own native resize event drives the
    // follow-up height correction, so the correction never measures the
    // transient default width (which would clobber the restored width).
    const wasRestored = windowRestoredOnce;
    restoreWidgetWindowSize();
    if (wasRestored && !skipHostResize) reportWidgetSize();
  }

  /** 035: the full card content size — the card root plus any member/control
   * strip content that must not be clipped by the hidden scrollbars. The card
   * fills its host width, so the measured width equals the window content
   * width and only the height is a real content-fit input. */
  function measureWidgetCardContent() {
    const cardEl = elements.grid.querySelector('.window-layout-card');
    if (!cardEl) return null;
    const rect = cardEl.getBoundingClientRect();
    let width = rect.width;
    // `getBoundingClientRect()` is clipped to the current native viewport when
    // a width resize creates extra wrapped rows. scrollHeight retains the full
    // laid-out card, including content below the clipped bottom edge.
    let height = Math.max(rect.height, cardEl.scrollHeight);
    for (const strip of cardEl.querySelectorAll('[data-wl-members], .window-layout-controls')) {
      if (strip.scrollWidth > width) width = strip.scrollWidth;
    }
    return { width: Math.ceil(width), height: Math.ceil(height) };
  }

  /** 035: restore the frameless widget window exactly once, after the first
   * real workspace snapshot. With a persisted shared geometry the window opens
   * at that size (the layout's last resize); without one it content-fits to
   * the card's natural size. The host applies the report verbatim (no
   * +tolerance), so the card's fill-width never creeps. */
  function restoreWidgetWindowSize() {
    if (windowRestoredOnce || !widgetState.snapshotReceived) return;
    windowRestoredOnce = true;
    const cardSize = widgetState.snapshot?.cardSize;
    if (cardSize && typeof cardSize.width === 'number' && typeof cardSize.height === 'number'
      && Number.isFinite(cardSize.width) && Number.isFinite(cardSize.height)
      && cardSize.width >= 1 && cardSize.height >= 1) {
      // 037: a persisted width is the actual card/client width; an over-max
      // legacy value is capped so the window opens content-fitted immediately.
      void host.widgetReportSize(
        Math.round(Math.min(cardSize.width, WINDOW_LAYOUT_CARD_MAX_WIDTH)),
        Math.round(cardSize.height),
      ).catch(() => undefined);
      return;
    }
    const memberCount = widgetState.snapshot?.members?.length ?? 0;
    const preferredColumns = memberCount <= 8 ? Math.max(1, memberCount) : Math.ceil(memberCount / Math.ceil(memberCount / 8));
    const naturalWidth = Math.min(WINDOW_LAYOUT_CARD_MAX_WIDTH, Math.max(158, (preferredColumns * 28) + ((preferredColumns - 1) * 4) + 16));
    const content = measureWidgetCardContent();
    if (content && content.height > 0) {
      void host.widgetReportSize(naturalWidth, content.height).catch(() => undefined);
    }
  }

  /** 039/041: report the ACTUAL shared card/client presentation geometry —
   * WIDTH = the rendered card border-box width (content-fit, capped at the
   * compact maximum; a few-member card never retains a wide empty minimum) and
   * HEIGHT = the rendered card content height. When the card reflows (a user
   * width resize or a member-count change) the native client is auto-corrected
   * to the card border box, so the detached host equals the card in BOTH axes
   * with no empty vertical canvas and no clipping. The width stays user-
   * resizable (narrowing drives wrapping) and continuously measurement-driven;
   * the report also persists the shared geometry so reattach matches. */
  function reportWidgetSize() {
    const width = window.innerWidth;
    const content = measureWidgetCardContent();
    const cardWidth = Math.min(width, WINDOW_LAYOUT_CARD_MAX_WIDTH);
    const height = content && content.height > 0 ? content.height : window.innerHeight;
    // 037: snap an over-max client width; 039: auto-correct the client height;
    // 041: snap the client width to the content-fit card border box. One report.
    if (width > WINDOW_LAYOUT_CARD_MAX_WIDTH
      || Math.abs(height - window.innerHeight) > 1) {
      void host.widgetReportSize(cardWidth, height).catch(() => undefined);
    }
    client.sendCardSize(cardWidth, height);
  }

  function syncWidgetSelection() {
    for (const button of elements.grid.querySelectorAll('[data-wl-member]')) {
      const selected = widgetState.selection.has(button.dataset.wlMember);
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-selected', String(selected));
    }
  }

  const widgetSelection = createWindowLayoutSelection({
    read: () => widgetState.selection,
    write: (_id, selected) => { widgetState.selection = selected; },
    erase: () => widgetState.selection.clear(),
    anchors: widgetState.anchor,
    orderedIds: () => (widgetState.snapshot.members ?? []).map((member) => member.id),
    copyOnToggle: false,
  });
  function toggleWidgetMemberSelection(memberId) {
    widgetSelection.toggle(layoutId, memberId);
    syncWidgetSelection();
  }

  function clearWidgetSelection() {
    if (!widgetSelection.clear(layoutId)) return;
    syncWidgetSelection();
  }

  let blankWidgetDrag = null;
  function signalBlankWidgetDrag(phase, event) {
    window.postMessage({
      type: 'papers:project:widget-drag',
      phase,
      x: event.screenX,
      y: event.screenY,
    }, window.location.origin);
  }

  function beginBlankWidgetDrag(event, card) {
    blankWidgetDrag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      dragging: false,
    };
    card.setPointerCapture?.(event.pointerId);
    signalBlankWidgetDrag('begin', event);
  }

  window.addEventListener('pointermove', (event) => {
    if (!blankWidgetDrag || blankWidgetDrag.pointerId !== event.pointerId) return;
    if (!blankWidgetDrag.dragging) {
      const distance = Math.hypot(event.clientX - blankWidgetDrag.startX, event.clientY - blankWidgetDrag.startY);
      if (distance < 4) return;
      blankWidgetDrag.dragging = true;
    }
    event.preventDefault();
    signalBlankWidgetDrag('move', event);
  }, { capture: true });

  const endBlankWidgetDrag = (event) => {
    if (!blankWidgetDrag || blankWidgetDrag.pointerId !== event.pointerId) return;
    signalBlankWidgetDrag('end', event);
    blankWidgetDrag = null;
  };
  window.addEventListener('pointerup', endBlankWidgetDrag, { capture: true });
  window.addEventListener('pointercancel', endBlankWidgetDrag, { capture: true });

  // Leaving the detached widget for Papers/Backpack cancels only its ephemeral
  // Ctrl/Shift member selection. The widget and persisted layout stay open and
  // unchanged.
  // Capture the plain press at the window boundary as well as the card click:
  // native frameless dragging/pointer capture may suppress the later click,
  // but a blank press must always clear the ephemeral Ctrl/range selection.
  window.addEventListener('pointerdown', (event) => {
    if (event.button === 0 && !event.ctrlKey && !event.shiftKey
      && !event.target.closest('button, input, [data-wl-member]')) clearWidgetSelection();
  }, { capture: true });
  window.addEventListener('blur', clearWidgetSelection);
  windowLayoutWidgetSelectionChannel?.addEventListener('message', (event) => {
    if (event.data?.type === 'clear-selection') clearWidgetSelection();
  });

  async function sendWidgetNativeActions(actions) {
    if (typeof host.windowControlGroup !== 'function') {
      setWindowLayoutStatus(layoutId, 'Native window control is unavailable.');
      return;
    }
    const result = await host.windowControlGroup(layoutId, actions).catch(() => ({ outcome: 'helper-unavailable' }));
    if (result?.outcome !== 'success') {
      setWindowLayoutStatus(layoutId, 'Native window control is unavailable.');
    }
  }

  async function activateWidgetMember(memberId) {
    windowLayoutMemberPreview.cancel();
    const activated = await host.windowControlActivate(layoutId, memberId)
      .catch(() => ({ outcome: 'helper-unavailable' }));
    if (activated?.outcome !== 'activated') {
      setWindowLayoutStatus(layoutId, 'Windows did not give that window the foreground ('
        + String(activated?.outcome ?? 'no answer') + ').');
    }
  }

  function widgetGroupTargets() {
    const members = widgetState.snapshot.members ?? [];
    return widgetState.selection.size > 0
      ? members.filter((member) => widgetState.selection.has(member.id))
      : members;
  }

  function handleWidgetCardClick(event) {
    event.stopPropagation();
    const deleteButton = event.target.closest('[data-wl-delete]');
    if (deleteButton) {
      const outcome = handleWidgetDeleteActivation(event, deleteButton, widgetDeleteGuard, () => {
        resetWidgetDeleteArm();
        client.sendCommand({ kind: 'delete-layout' });
      });
      if (outcome === 'armed' || outcome === 'deleted') event.stopPropagation();
      return;
    }
    const clearButton = event.target.closest('[data-wl-clear]');
    if (clearButton) {
      const outcome = handleWidgetClearActivation(event, clearButton, widgetClearGuard, () => {
        resetWidgetClearArm();
        client.sendCommand({ kind: 'clear-layout' });
      });
      if (outcome === 'armed' || outcome === 'cleared') event.stopPropagation();
      return;
    }
    const member = event.target.closest('[data-wl-member]');
    if (member) {
      if (widgetDragJustMoved) {
        widgetDragJustMoved = false;
        return;
      }
      const memberId = member.dataset.wlMember;
      const isolationTargets = !event.ctrlKey && !event.shiftKey
        ? windowLayoutRuntime.isolateMode.click(layoutId, memberId, false)
        : null;
      if (isolationTargets !== null) {
        client.sendCommand({ kind: 'group-action', action: 'isolate', memberIds: isolationTargets });
        return;
      }
      if (event.ctrlKey) {
        // 019C: widget-local ephemeral selection (Ctrl toggle / Shift range);
        // only committed actions are routed to the workspace writer.
        toggleWidgetMemberSelection(memberId);
        return;
      }
      if (event.shiftKey) {
        widgetSelection.range(layoutId, memberId);
        syncWidgetSelection();
        return;
      }
      // A plain left click raises this exact member. Right click owns the
      // minimize/restore toggle in handleWidgetCardContextMenu.
      if (!member.disabled) void activateWidgetMember(memberId);
      return;
    }
    const pickCandidate = event.target.closest('[data-wl-pick-candidate]');
    if (pickCandidate) {
      void handleWidgetListCandidate(pickCandidate.dataset.wlPickCandidate);
      return;
    }
    const pickerClose = event.target.closest('[data-wl-picker-close]');
    if (pickerClose) {
      closeWidgetPicker();
      return;
    }
    const listButton = event.target.closest('[data-wl-list]');
    if (listButton) {
      cancelWindowLayoutListDwell();
      void beginWidgetDirectPick();
      return;
    }
    const trackingButton = event.target.closest('[data-wl-track]');
    if (trackingButton) {
      client.sendCommand({ kind: 'toggle-tracking' });
      return;
    }
    const minAll = event.target.closest('[data-wl-min-all]');
    if (minAll) {
      void sendWidgetNativeActions(widgetGroupTargets().map(({ id: memberId }) => ({ memberId, operation: 'minimize' })));
      return;
    }
    const restoreAll = event.target.closest('[data-wl-restore-all]');
    if (restoreAll) {
      void sendWidgetNativeActions(widgetGroupTargets().map(({ id: memberId }) => ({ memberId, operation: 'restore' })));
      return;
    }
    // Plain blank-card click exits the widget-local Ctrl/range selection. This
    // is ephemeral presentation state only: no member is toggled, no command
    // is sent to the workspace writer, and no layout data is changed.
    if (widgetState.selection.size > 0) {
      clearWidgetSelection();
    }
  }

  function resetWidgetClearArm() {
    widgetClearGuard.reset();
    elements.grid.querySelector('.window-layout-card [data-wl-clear]')?.classList.remove('is-clear-armed');
  }

  function resetWidgetDeleteArm() {
    widgetDeleteGuard.reset();
    elements.grid.querySelector('.window-layout-card [data-wl-delete]')?.classList.remove('is-delete-armed');
  }

  elements.grid.addEventListener('pointerout', (event) => {
    if (event.target.closest('[data-wl-clear]')
      && !event.relatedTarget?.closest?.('[data-wl-clear]')) resetWidgetClearArm();
    if (event.target.closest('[data-wl-delete]')
      && !event.relatedTarget?.closest?.('[data-wl-delete]')) resetWidgetDeleteArm();
  });
  window.addEventListener('blur', resetWidgetClearArm);
  window.addEventListener('blur', resetWidgetDeleteArm);

  function handleWidgetCardAuxClick(event) {
    if (event.button !== 1) return;
    const member = event.target.closest('[data-wl-member]');
    if (member && !member.disabled) {
      event.preventDefault();
      event.stopPropagation();
      windowLayoutMemberPreview.cancel();
      if (event.ctrlKey) {
        // Ctrl+MMB closes the native window/process, then the confirmed close
        // retires its exact member identity from every layout.
        void closeWindowLayoutMember(layoutId, member.dataset.wlMember);
      } else {
        // Plain MMB only unlinks the clicked icon from this layout.
        client.sendCommand({ kind: 'remove-member', memberId: member.dataset.wlMember });
      }
      return;
    }
    const minimizeAll = event.target.closest('[data-wl-min-all]');
    if (!minimizeAll) return;
    event.preventDefault();
    event.stopPropagation();
    client.sendCommand({ kind: 'dock-widget-to-pill' });
  }

  async function handleWidgetCardContextMenu(event) {
    event.preventDefault();
    event.stopPropagation();
    const isolateToggle = event.target.closest('[data-wl-min-all]');
    if (isolateToggle) {
      toggleWindowLayoutIsolateMode(isolateToggle.dataset.wlMinAll);
      return;
    }
    const member = event.target.closest('[data-wl-member]');
    if (member && event.ctrlKey && !event.shiftKey && windowLayoutRuntime.isolateMode.isActive(layoutId)) {
      const targets = windowLayoutRuntime.isolateMode.click(layoutId, member.dataset.wlMember, true);
      if (targets !== null) client.sendCommand({ kind: 'group-action', action: 'isolate', memberIds: targets });
      return;
    }
    if (member && event.shiftKey) {
      client.sendCommand({
        kind: 'range-toggle',
        memberId: member.dataset.wlMember,
        memberIds: [...widgetState.selection],
      });
      return;
    }
    // A detached widget is frequently narrower than an ordinary menu. Ask its
    // trusted native host for a real popup so the action can extend beyond the
    // widget bounds and dismiss normally with Escape, blur or an outside click.
    if (member) {
      const memberId = member.dataset.wlMember;
      if (!memberId || member.disabled) return;
      windowLayoutMemberPreview.cancel();
      // The browser context menu is suppressed above; the right button is the
      // member's minimize/restore gesture instead.
      await sendWidgetNativeActions([{ memberId, operation: 'toggle' }]);
      return;
    }
  }

  const widgetPicker = createWindowLayoutWidgetPicker({
    host: {
      windowCandidatePicker: (...args) => host.windowCandidatePicker(...args),
      windowCandidates: (...args) => host.windowCandidates(...args),
      ...(typeof host.windowCandidatePickerUpdate === 'function' ? {
        windowCandidatePickerUpdate: (...args) => host.windowCandidatePickerUpdate(...args),
      } : {}),
      windowCandidatePickerClose: (...args) => host.windowCandidatePickerClose(...args),
      pickWindowCancel: (...args) => host.pickWindowCancel(...args),
      pickWindowBegin: (...args) => host.pickWindowBegin(...args),
      onPickResult: (...args) => host.onPickResult(...args),
    },
    widgetState, windowLayoutRuntime,
    client: { sendCommandAndWait: (...args) => client.sendCommandAndWait(...args) },
    layoutId, windowLayoutMemberPreview,
    setWindowLayoutStatus, closeWindowLayoutCandidate, restoreHoveredWindowLayoutPreview,
    elements, CSS, bindWindowLayoutPickerCandidate,
  });
  const openWidgetPicker = widgetPicker.open;
  const closeWidgetPicker = widgetPicker.close;
  const handleWidgetListCandidate = widgetPicker.candidate;
  const beginWidgetDirectPick = widgetPicker.direct;

  window.addEventListener('keydown', (event) => {
    if (!widgetState.pickUnsubscribe) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      void host.pickWindowCancel();
    } else {
      event.preventDefault();
      event.stopPropagation();
      void host.pickWindowCommit();
    }
  });

  window.addEventListener('pagehide', () => {
    widgetHoverPolicy.dispose();
    widgetRoot.removeEventListener('pointerenter', onWidgetPointerEnter);
    widgetRoot.removeEventListener('pointermove', onWidgetPointerEnter);
    widgetRoot.removeEventListener('pointerleave', onWidgetPointerLeave);
    if (hoverPolicyTimer !== null) clearInterval(hoverPolicyTimer);
    const hadActivePick = Boolean(widgetState.pickAttempt || widgetState.pickUnsubscribe);
    widgetState.pickAttempt = null;
    widgetState.pickUnsubscribe?.();
    widgetState.pickUnsubscribe = null;
    if (hadActivePick) void host.pickWindowCancel().catch(() => undefined);
    cancelSnapshotRetry();
    if (cardSizeTimer !== null) {
      clearTimeout(cardSizeTimer);
      cardSizeTimer = null;
    }
    // 019GR: pagehide discards pending preview work and clears the ephemeral
    // widget capability cache.
    windowLayoutMemberPreview.cancel();
    windowLayoutWidgetPreviewCapabilities.clear();
    // 035: report the widget is closing so the workspace restores its attached
    // card (no longer a greyed placeholder).
    client.dispose();
    client.close();
    setWidgetClient(null);
  });

  // 035/037/039: the live widget reports its shared card geometry whenever the
  // creator resizes it (debounced) so the workspace persists it. The width is
  // capped at the compact presentation maximum (over-max snaps), and the
  // HEIGHT is the rendered card content height, so the native client
  // auto-corrects to fit the card in both axes after every reflow.
  let cardSizeTimer = null;
  window.addEventListener('resize', () => {
    // Trailing-edge correction: while the creator is dragging an edge Windows
    // owns the native size and can overwrite an early correction. Re-arm on
    // every event, then fit the wrapped height once that resize burst settles.
    if (cardSizeTimer !== null) clearTimeout(cardSizeTimer);
    cardSizeTimer = setTimeout(() => {
      cardSizeTimer = null;
      reportWidgetSize();
    }, 80);
  });

  // 019C: the widget channel client installs its message listener in the
  // factory, so widget-ready is reported ONLY after the listener exists. The
  // preload latches the hidden token and forwards READY to the session; no
  // ACTIVATE/load gate.
  const client = createWindowLayoutWidgetChannelClient({
    channel,
    layoutId,
    onMessage: handleWidgetMessage,
  });
  setWidgetClient(client);
  renderWidgetBootstrapCard('Loading window layout…');
  let hoverPolicyTimer = setInterval(() => client.requestHoverPolicy(), 400);
  client.requestHoverPolicy();
  let widgetQuickRunOpening = false;
  const widgetQuickRunAppends = new Set();
  host.onWidgetQuickRunSealRequest(async ({ generation } = {}) => {
    if (!Number.isSafeInteger(generation) || generation < 1) return;
    try {
      await Promise.all([...widgetQuickRunAppends]);
      await host.acknowledgeWidgetQuickRunSeal(generation);
    } catch (error) {
      setWindowLayoutStatus(layoutId, error instanceof Error ? error.message : 'Quick Run input handoff failed.');
    }
  });
  window.addEventListener('keydown', (event) => {
    if (!widgetState.hoverPolicyReceived || !widgetHoverPolicy.isHovered()
      || widgetState.pickUnsubscribe || event.defaultPrevented) return;
    const target = event.target;
    const editingTarget = target instanceof Element
      && target.matches('input, textarea, select, [contenteditable="true"], .set-name-editor');
    const modalOpen = [...document.querySelectorAll('[role="dialog"], dialog')]
      .some((dialog) => !dialog.hidden && dialog.getClientRects().length > 0);
    const plan = widgetHoverPolicy.planInput(event, {
      modalOpen,
      paletteOpen: quickRun.session().open,
      editingTarget,
      blockedBindings: widgetState.blockedHotkeyBindings,
      opening: widgetQuickRunOpening,
    });
    if (plan.kind !== 'open' && plan.kind !== 'append') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (plan.kind === 'open') {
      widgetQuickRunOpening = true;
      void host.widgetQuickRunInput('open', plan.seed).then((result) => {
        if (result?.ok !== true) setWindowLayoutStatus(
          layoutId,
          typeof result?.detail === 'string' && result.detail.trim() !== ''
            ? `Quick Run could not open: ${result.detail}`
            : 'Quick Run could not open from this widget.',
        );
      }).catch((error) => {
        setWindowLayoutStatus(layoutId, error instanceof Error ? error.message : 'Quick Run could not open from this widget.');
      }).finally(() => { widgetQuickRunOpening = false; });
      return;
    }
    const request = host.widgetQuickRunInput('append', plan.text);
    widgetQuickRunAppends.add(request);
    void request.then((result) => {
      if (result?.ok !== true) setWindowLayoutStatus(layoutId, 'A character could not be added to Quick Run.');
    }).catch(() => setWindowLayoutStatus(layoutId, 'A character could not be added to Quick Run.'))
      .finally(() => widgetQuickRunAppends.delete(request));
  }, { capture: true });
  // 040: the widget card's member context menu (`Remove from this layout`) is
  // the SHARED context menu component; it must be mounted in the widget surface
  // too (the workspace bootstrap does this, but the widget never runs it).
  menu.mount();
  // 024: member-icon reordering in the DETACHED/compact-widget card. The widget
  // never writes the store: a drag reorders the live DOM and sends a bounded
  // `reorder` intent through the channel; the workspace applies + broadcasts
  // the fresh snapshot. Capture-phase listeners run before the card's own
  // stopPropagation handlers.
  const widgetMemberDrag = createWindowLayoutMemberDrag();
  let widgetDragJustMoved = false;
  window.addEventListener('wheel', (event) => {
    // A detached widget has no scrollable document. Chromium does not always
    // preserve Ctrl in wheel events for a non-focusable native window, so the
    // wheel itself is the stable input contract here (Ctrl+wheel still works).
    event.preventDefault();
    event.stopImmediatePropagation();
    const current = widgetOpacity;
    widgetOpacity = Math.max(0, Math.min(1, Math.round((current + (event.deltaY < 0 ? 0.05 : -0.05)) * 100) / 100));
    localStorage.setItem(widgetOpacityStorageKey, String(widgetOpacity));
    applyWidgetOpacity();
  }, { capture: true, passive: false });
  function suppressNextWidgetMemberClick() {
    widgetDragJustMoved = true;
    setTimeout(() => { widgetDragJustMoved = false; }, 0);
  }
  elements.grid.addEventListener('pointerdown', (event) => {
    const member = event.target.closest('[data-wl-member]');
    if (!member || !event.ctrlKey || event.button !== 0) return;
    event.preventDefault();
    cancelWindowLayoutPreviewDwell();
    windowLayoutMemberPopover.hide();
    windowLayoutMemberPreview.cancel();
    // A lost pointerup from a previous OS/native transition must not poison the
    // next Ctrl-drag. Each press owns a fresh captured pointer session.
    widgetMemberDrag.cancel();
    widgetMemberDrag.start({
      layoutId: member.dataset.wlLayout,
      memberId: member.dataset.wlMember,
      clientX: event.clientX,
      clientY: event.clientY,
      pointerId: event.pointerId,
    });
    member.classList.add('wl-member-dragging');
    // Capture on the stable grid, not the button whose DOM position changes
    // during live reorder. Moving a captured button can release capture after
    // the first insertion and incorrectly limit a drag to one slot.
    try { elements.grid.setPointerCapture(event.pointerId); } catch { /* unsupported */ }
  }, true);
  elements.grid.addEventListener('pointermove', (event) => {
    const drag = widgetMemberDrag.move(event.pointerId, event.clientX, event.clientY);
    if (!drag) return;
    event.preventDefault();
    const members = elements.grid.querySelector(`[data-wl-members="${CSS.escape(drag.layoutId)}"]`);
    const button = elements.grid.querySelector(`[data-wl-layout="${CSS.escape(drag.layoutId)}"] [data-wl-member="${CSS.escape(drag.memberId)}"]`);
    if (!members || !button) return;
    const row = members.getBoundingClientRect();
    const outside = event.clientY < row.top - WINDOW_LAYOUT_DROP_OUT_PX
      || event.clientY > row.bottom + WINDOW_LAYOUT_DROP_OUT_PX
      || event.clientX < row.left - WINDOW_LAYOUT_DROP_OUT_PX
      || event.clientX > row.right + WINDOW_LAYOUT_DROP_OUT_PX;
    members.classList.toggle('wl-drag-out', outside);
    if (outside) return;
    moveWindowLayoutMemberButton(members, button, event.clientX, event.clientY);
  }, true);
  elements.grid.addEventListener('pointerup', (event) => {
    widgetMemberDrag.finalize(event.pointerId, (drag) => {
      const members = elements.grid.querySelector(`[data-wl-members="${CSS.escape(drag.layoutId)}"]`);
      if (!members) return;
      const dragged = members.querySelector(`[data-wl-member="${CSS.escape(drag.memberId)}"]`);
      dragged?.classList.remove('wl-member-dragging');
      members.classList.remove('wl-drag-out');
      if (!drag.moved) {
        // Pointer capture retargets the eventual click to the grid. Complete
        // Ctrl-click selection here when the gesture never became a drag.
        toggleWidgetMemberSelection(drag.memberId);
        suppressNextWidgetMemberClick();
        return;
      }
      suppressNextWidgetMemberClick();
      const buttons = [...members.querySelectorAll('[data-wl-member]')];
      const toIndex = buttons.findIndex((button) => button.dataset.wlMember === drag.memberId);
      if (toIndex === -1) return;
      client.sendCommand({ kind: 'reorder', memberId: drag.memberId, toIndex });
    });
    const captured = elements.grid.querySelector(`[data-wl-member].wl-member-dragging`);
    captured?.classList.remove('wl-member-dragging');
    try { elements.grid.releasePointerCapture(event.pointerId); } catch { /* already released */ }
  }, true);
  elements.grid.addEventListener('pointercancel', (event) => {
    const active = widgetMemberDrag.get();
    if (!active || !widgetMemberDrag.cancelMatching(event.pointerId)) return;
    const members = elements.grid.querySelector(`[data-wl-members="${CSS.escape(active.layoutId)}"]`);
    if (members) members.classList.remove('wl-drag-out');
    const captured = elements.grid.querySelector(`[data-wl-member="${CSS.escape(active.memberId)}"]`);
    captured?.classList.remove('wl-member-dragging');
    try { elements.grid.releasePointerCapture(event.pointerId); } catch { /* already released */ }
  }, true);
  elements.grid.addEventListener('lostpointercapture', (event) => {
    const active = widgetMemberDrag.get();
    if (!active || active.pointerId !== event.pointerId) return;
    widgetMemberDrag.cancelMatching(event.pointerId);
    const members = elements.grid.querySelector(`[data-wl-members="${CSS.escape(active.layoutId)}"]`);
    if (members) members.classList.remove('wl-drag-out');
    members?.querySelector(`[data-wl-member="${CSS.escape(active.memberId)}"]`)?.classList.remove('wl-member-dragging');
  }, true);
  return host.widgetReady().then(() => {
    client.ready();
    client.requestSnapshot();
    armSnapshotRetry();
  });
}

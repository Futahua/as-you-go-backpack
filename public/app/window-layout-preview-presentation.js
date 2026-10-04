/** Shared member popover/native-preview routing and hover dwell ownership. */
export function createWindowLayoutPreviewPresentation({
  document, window, host, WIDGET_SURFACE, windowLayoutMemberPreview,
  requestAnimationFrame = globalThis.requestAnimationFrame,
  cancelAnimationFrame = globalThis.cancelAnimationFrame,
  setTimeout = globalThis.setTimeout, clearTimeout = globalThis.clearTimeout,
}) {
function createWindowLayoutMemberPopover() {
  let element = null;
  let lastAnchor = null;
  let lastName = '';
  let animationFrame = null;
  function ensure() {
    if (element) return element;
    element = document.createElement('div');
    element.className = 'window-layout-member-popover';
    element.setAttribute('data-wl-popover', 'true');
    element.hidden = true;
    element.innerHTML =
      '<div class="window-layout-member-popover-title">'
      + '<img class="window-layout-member-popover-icon" data-wl-popover-icon alt="" hidden>'
      + '<div class="window-layout-member-popover-name" data-wl-popover-name></div>'
      + '</div>'
      + '<div class="window-layout-member-popover-preview" data-wl-popover-preview></div>';
    document.body.appendChild(element);
    return element;
  }
  function position() {
    const popover = element;
    if (!popover || !lastAnchor) return;
    const rect = popover.getBoundingClientRect();
    const margin = 6;
    const left = Math.max(margin, Math.min(
      window.innerWidth - rect.width - margin,
      lastAnchor.left + lastAnchor.width / 2 - rect.width / 2,
    ));
    let top = lastAnchor.top - rect.height - margin;
    if (top < margin) top = lastAnchor.bottom + margin;
    // 034: keep the WHOLE popover (including a real-window preview) inside the
    // viewport - in the content-fit detached widget the window is small, so a
    // top-placed preview must not overflow the bottom edge.
    if (top + rect.height > window.innerHeight - margin) top = window.innerHeight - rect.height - margin;
    if (top < margin) top = margin;
    popover.style.left = `${Math.round(left)}px`;
    popover.style.top = `${Math.round(top)}px`;
  }
  return {
    show(name, anchorRect, iconSrc = null) {
      lastName = name;
      // Widget thumbnails live in their own naturally-sized native window.
      // Retain only the anchor here; a local name popover is cramped by the
      // compact widget viewport and duplicates the preview's title.
      if (WIDGET_SURFACE) {
        lastAnchor = anchorRect;
        if (element) {
          element.classList.remove('is-visible');
          element.hidden = true;
        }
        return;
      }
      const popover = ensure();
      const nameNode = popover.querySelector('[data-wl-popover-name]');
      if (nameNode) nameNode.textContent = name;
      const iconNode = popover.querySelector('[data-wl-popover-icon]');
      if (iconNode) {
        if (iconSrc) {
          iconNode.src = iconSrc;
          iconNode.hidden = false;
        } else {
          iconNode.removeAttribute('src');
          iconNode.hidden = true;
        }
      }
      const preview = popover.querySelector('[data-wl-popover-preview]');
      if (preview) preview.replaceChildren();
      popover.hidden = false;
      popover.classList.remove('is-visible');
      lastAnchor = anchorRect;
      position();
      if (animationFrame !== null) cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => {
        animationFrame = null;
        if (!popover.hidden) popover.classList.add('is-visible');
      });
    },
    hide() {
      if (animationFrame !== null) {
        cancelAnimationFrame(animationFrame);
        animationFrame = null;
      }
      if (element) {
        element.classList.remove('is-visible');
        element.hidden = true;
      }
      if (WIDGET_SURFACE) void host.widgetPreviewHide().catch(() => undefined);
      else void host.windowPreviewHide().catch(() => undefined);
    },
    /** 019GR: the preview image changed the popover size - re-clamp placement
     * against the SAME member anchor so it never jumps off-screen. */
    reposition() {
      if (!element || element.hidden || !lastAnchor) return;
      position();
    },
    /** 019C seam: fill the live-preview slot (thumbnail markup). Passing null
     * clears it back to the icon/name-only fallback. 034: once the preview
     * image finishes decoding it changes the popover size, so placement is
     * re-clamped then (and when already complete) to keep the WHOLE popover
     * inside the host viewport - never clipped by host/card bounds. */
    updatePreview(memberId, previewMarkup) {
      const preview = ensure().querySelector('[data-wl-popover-preview]');
      if (!preview) return;
      // BOTH surfaces now use Papers' own always-on-top preview window. The
      // in-page popover could only ever be as visible as this project window, so
      // any other application's window could hide the preview - the creator saw
      // exactly that. The widget keeps its own authorized message; the workspace
      // uses the project-authorized one; the anchor is the same screen rectangle.
      {
        preview.replaceChildren();
        if (previewMarkup == null) {
          void (WIDGET_SURFACE ? host.widgetPreviewHide() : host.windowPreviewHide()).catch(() => undefined);
          return;
        }
        const holder = document.createElement('div');
        holder.innerHTML = previewMarkup;
        const img = holder.querySelector('.window-layout-member-preview-image');
        if (!img || !lastAnchor) return;
        const width = Number(img.getAttribute('width'));
        const height = Number(img.getAttribute('height'));
        if (!Number.isFinite(width) || !Number.isFinite(height)) return;
        const anchor = {
          x: Math.round(window.screenX + lastAnchor.left),
          y: Math.round(window.screenY + lastAnchor.top),
          width: Math.round(lastAnchor.width),
          height: Math.round(lastAnchor.height),
        };
        void (WIDGET_SURFACE
          ? host.widgetPreviewShow(img.src, lastName, width, height, anchor)
          : host.windowPreviewShow(img.src, lastName, width, height, anchor)).catch(() => undefined);
        return;
      }
    },
  };
}
const windowLayoutMemberPopover = createWindowLayoutMemberPopover();
const WINDOW_LAYOUT_PREVIEW_DWELL_MS = 100;
let windowLayoutPreviewDwellTimer = null;

function cancelWindowLayoutPreviewDwell() {
  if (windowLayoutPreviewDwellTimer !== null) {
    clearTimeout(windowLayoutPreviewDwellTimer);
    windowLayoutPreviewDwellTimer = null;
  }
}

function scheduleWindowLayoutPreviewDwell(member) {
  cancelWindowLayoutPreviewDwell();
  const layoutId = member.dataset.wlLayout;
  const memberId = member.dataset.wlMember;
  const name = member.getAttribute('aria-label') ?? member.title ?? '';
  const iconSrc = member.querySelector('.window-layout-member-icon')?.getAttribute('src') ?? null;
  const anchor = member.getBoundingClientRect();
  windowLayoutPreviewDwellTimer = setTimeout(() => {
    windowLayoutPreviewDwellTimer = null;
    if (!member.isConnected || !member.matches(':hover')) return;
    if (name) windowLayoutMemberPopover.show(name, anchor, iconSrc);
    windowLayoutMemberPreview.schedule(layoutId, memberId);
  }, WINDOW_LAYOUT_PREVIEW_DWELL_MS);
}

// 019GR surface-aware preview capability resolution. The WORKSPACE resolves the
// member's capability from durable state via the existing runtime logic. The
// COMPACT-WIDGET surface owns only widgetState.snapshot (durable state lives in
// the workspace window), so it turns the snapshot member descriptor into a
// capability through the host and caches it in a MEMORY-ONLY map — a capability
// is never placed in snapshot/channel/durable state. The cache is cleared on
// missing/removal, snapshot replacement (renderWidgetCard) and pagehide.

return { popover: windowLayoutMemberPopover, schedule: scheduleWindowLayoutPreviewDwell, cancel: cancelWindowLayoutPreviewDwell };
}

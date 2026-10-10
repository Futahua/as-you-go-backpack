/** Shared attached/widget card and picker presentation; no host, saves or mutation. */
import { windowLayoutControlButton, windowLayoutMemberMarkup } from './window-layout-control-icons.js';
import { windowLayoutPresentationMode } from './window-layout-detached.js';
export function createWindowLayoutView({
  escapeHtml, windowLayoutDetachment, windowLayoutStatusText, windowLayoutMemberIcon,
  windowLayoutMemberNote, windowLayoutRuntime, windowLayoutFromState,
}) {
function windowLayoutCardPlaceholder(options) {
  if (options.widgetSurface === true) return false;
  return options.detached === true
    || windowLayoutDetachment.isReadOnly()
    || windowLayoutDetachment.getState().mode === 'detached';
}

function windowLayoutCardMarkup(candidate, options = {}) {
  const placeholder = windowLayoutCardPlaceholder(options);
  return `<div class="window-layout-card${placeholder ? ' window-layout-card--placeholder' : ''}" data-wl-card="${escapeHtml(candidate.id)}"${placeholder ? ' data-wl-placeholder="true"' : ''}>
    ${windowLayoutBodyMarkup(candidate, options)}
  </div>`;
}

/** 019B compact card live body inside a window-layout shell: a fixed-height,
 * one-row, taskbar-like icon strip (one compact icon button per persisted
 * member - every member is visible; large counts compact instead of clipping),
 * a single row of compact static inline-SVG controls, a picker host and a
 * status line. Buttons never begin outer graph dragging because the graph drag
 * excludes <button> pointerdowns by design (Assignment 015/016). No Activate
 * control and no affirmative Recording furniture (016 creator correction):
 * adding a member captures its bounds/state immediately and tracking is
 * implicit. 035: the attached placeholder shows the same greyed members and the
 * lock ONLY (reattach); the widget is the sole live card. */
function windowLayoutBodyMarkup(candidate, options = {}) {
  const emptyHint = (candidate.arrangement?.members ?? []).length === 0
    ? '<div class="window-layout-empty" data-wl-empty="true">No windows yet</div>'
    : '';
  const status = windowLayoutStatusText(candidate.id);
  // 018V7R3: one shared bounded presentation mode (readonly/detached/workspace)
  // so the body markup and the node content signatures cannot disagree.
  const presentationMode = windowLayoutPresentationMode({
    isReadOnly: windowLayoutDetachment.isReadOnly(),
    mode: windowLayoutDetachment.getState().mode,
  });
  const placeholder = windowLayoutCardPlaceholder(options);
  if (placeholder) {
    const members = (candidate.arrangement?.members ?? []).map((member) =>
      windowLayoutMemberMarkup(candidate.id, member, windowLayoutMemberIcon(candidate.id, member), true,
        windowLayoutMemberNote(candidate.id, member))).join('');
    // Inert greyed workspace summary while the widget is the sole live card:
    // disabled members and status, with one plain-click reattach lock.
    return `<div class="window-layout-body" data-wl-layout="${escapeHtml(candidate.id)}" data-wl-placeholder-body="true" aria-label="Window group (detached)">
    <div class="window-layout-members" data-wl-members="${escapeHtml(candidate.id)}">${members}${emptyHint}</div>
    <div class="window-layout-controls">${windowLayoutControlButton('reattach', 'Reattach this window-layout widget', 'data-wl-reattach', candidate.id)}</div>
    <div class="window-layout-status" data-wl-status="${escapeHtml(candidate.id)}">${escapeHtml(status)}</div>
  </div>`;
  }
  const members = (candidate.arrangement?.members ?? []).map((member) =>
    windowLayoutMemberMarkup(candidate.id, member, windowLayoutMemberIcon(candidate.id, member), false,
      windowLayoutMemberNote(candidate.id, member))).join('');
  const widgetSurface = options.widgetSurface === true;
  const trackingControl = widgetSurface
    ? windowLayoutControlButton('tracking', candidate.tracking?.enabled === true ? 'Stop automatic window tracking' : 'Start automatic window tracking', 'data-wl-track', candidate.id, { toggle: true, active: candidate.tracking?.enabled === true, activeClass: 'tracking-enabled' })
    : '';
  return `<div class="window-layout-body" data-wl-layout="${escapeHtml(candidate.id)}" aria-label="Window group">
    ${widgetSurface ? windowLayoutControlButton('clear', 'Click twice to clear all windows from this layout', 'data-wl-clear', candidate.id) : ''}
    <div class="window-layout-members" data-wl-members="${escapeHtml(candidate.id)}">${members}${emptyHint}</div>
    ${trackingControl}
    <div class="window-layout-controls">
      ${windowLayoutControlButton('list', 'Live-pick an onscreen window (hover for the list)', 'data-wl-list', candidate.id, { glyph: 'pick' })}
      ${windowLayoutControlButton('min-all', widgetSurface ? 'Minimize all members; middle-click to dock as an AYG pill' : 'Minimize all members; right-click to toggle isolate mode', 'data-wl-min-all', candidate.id, { toggle: true, active: windowLayoutRuntime.isolateMode.isActive(candidate.id) })}
      ${windowLayoutControlButton('restore-all', widgetSurface ? 'Restore/open all members' : 'Restore/open all members; middle-click to undock widget', 'data-wl-restore-all', candidate.id)}
    </div>
    <div class="window-layout-picker" data-wl-picker="${escapeHtml(candidate.id)}"></div>
    <div class="window-layout-status" data-wl-status="${escapeHtml(candidate.id)}">${escapeHtml(status)}</div>
  </div>`;
}

/** 019F: the four persistent controls and taskbar-like member button live in
 * ./app/window-layout-control-icons.js (static inline SVG, exact creator
 * mapping, stable data-wl-glyph identifiers). The body wires them with the
 * exact title/aria-label semantics and behavior data attributes. */

/** Picker list markup (016): a vertical list of compact rows from the host
 * candidate list. Every row toggles: a row whose title matches an existing
 * member removes it (data-only), any other row binds it. */
function windowLayoutPickerMarkup(layoutId, candidates) {
  const layout = windowLayoutFromState(layoutId);
  const members = layout?.arrangement?.members ?? [];
  const rows = candidates.map((candidate) => {
    const isCurrentMember = members.some((member) => candidate.title === member.descriptor.title);
    return `<button class="window-layout-pick-candidate${isCurrentMember ? ' current-member' : ''}" data-wl-pick-candidate="${escapeHtml(candidate.id)}" data-wl-pick="${escapeHtml(layoutId)}" type="button" title="${escapeHtml(candidate.title)}">
      ${candidate.icon
        ? `<img class="window-layout-pick-icon" src="${escapeHtml(candidate.icon)}" alt="">`
        : '<span class="window-layout-pick-icon placeholder" aria-hidden="true"></span>'}
      <span class="window-layout-pick-label">${escapeHtml(candidate.title)}</span>
      <span class="window-layout-pick-state ${escapeHtml(candidate.state)}">${isCurrentMember ? 'remove' : escapeHtml(candidate.state)}</span>
    </button>`;
  }).join('');
  return `<div class="window-layout-picker-panel">
    <div class="window-layout-picker-head">Choose an onscreen window (click a member row to remove it)
      <button class="window-layout-picker-close" data-wl-picker-close="true" type="button" title="Close picker">×</button>
    </div>
    <div class="window-layout-picker-list">${rows || '<div class="window-layout-empty">No eligible windows</div>'}</div>
  </div>`;
  }
  return { card: windowLayoutCardMarkup, body: windowLayoutBodyMarkup, picker: windowLayoutPickerMarkup, placeholder: windowLayoutCardPlaceholder };
}

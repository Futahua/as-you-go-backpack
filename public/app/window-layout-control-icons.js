/**
 * 019F (RoketPuncha AYG lane): compact window-layout control glyphs + the
 * taskbar-like member button markup. Pure string builders (no DOM, no host),
 * statically testable. The six controls map to the creator's exact left-to-right
 * sketch semantics; Detach uses the UNLOCKED padlock family and the widget
 * replacement control uses the LOCKED padlock so the two can never be confused.
 * Every glyph is a clean static inline SVG (viewBox 0 0 24 24, round caps/joins,
 * no animation), legible at 12px. Each button keeps its exact title/aria-label
 * semantics, behavior data attributes, and a stable semantic glyph identifier.
 */

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** Exact requested shapes (left-to-right):
 * 1 cursor/pointer outline = Pick onscreen
 * 2 outlined document/list with rows = List
 * 3 horizontal minus = Minimize all
 * 4 outlined square = Restore all
 * 5 outlined circle = Isolate
 * 6 unlocked padlock = Detach
 * reattach = locked padlock (widget replacement control). */
export const WINDOW_LAYOUT_CONTROL_GLYPHS = {
  pick: { path: '<path d="M6.5 3.5l13.5 6.5-6.3 2.1-2.1 6.3z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>' },
  list: { path: '<rect x="6" y="3" width="12" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M9 8h6M9 12.5h6M9 17h4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' },
  'min-all': { path: '<path d="M4 12h16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' },
  'restore-all': { path: '<rect x="5" y="5" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>' },
  isolate: { path: '<circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="1.6"/>' },
  detach: { path: '<path d="M8 10.5V7.5a4 4 0 0 1 8 0" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><rect x="6" y="10.5" width="12" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>' },
  reattach: { path: '<path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><rect x="6" y="10.5" width="12" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>' },
};

/** The six control actions (left-to-right); reattach is the widget replacement. */
export const WINDOW_LAYOUT_CONTROL_ORDER = ['pick', 'list', 'min-all', 'restore-all', 'isolate', 'detach'];

export function windowLayoutControlGlyphMarkup(name) {
  const glyph = WINDOW_LAYOUT_CONTROL_GLYPHS[name];
  return `<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" data-wl-glyph="${escapeHtml(name)}">${glyph?.path ?? ''}</svg>`;
}

/** Compact static inline-SVG control button (title/aria-label carry the
 * accessible label, glyphs never animate). `data-wl-glyph` is the stable
 * semantic glyph identifier; behavior data attributes are preserved exactly. */
export function windowLayoutControlButton(name, label, attr, value = 'true') {
  return `<button class="window-layout-control wl-${name}" type="button" ${attr}="${escapeHtml(value)}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}" data-wl-glyph="${escapeHtml(name)}">${windowLayoutControlGlyphMarkup(name)}</button>`;
}

/** 019F taskbar-like member button: native program artwork centered and never
 * filtered/recolored, NO text inside the strip, and a small BOTTOM running
 * indicator (a Windows-taskbar-style line) driven by the actual known state
 * (normal running vs minimized). The accent surface/indicator is reserved ONLY
 * for this product's explicit Ctrl/Shift selection (`aria-selected`). The FULL
 * persisted title stays on aria-label for the hover popover seam without a
 * duplicate native browser tooltip. `disabled` renders the inert placeholder member (035): same
 * look, not interactive. */
export function windowLayoutMemberMarkup(layoutId, member, icon = null, disabled = false) {
  const iconMarkup = icon
    ? `<img class="window-layout-member-icon" src="${escapeHtml(icon)}" alt="" draggable="false" data-wl-member-icon="${escapeHtml(member.id)}">`
    : `<span class="window-layout-member-icon placeholder" data-wl-member-icon="${escapeHtml(member.id)}" aria-hidden="true"></span>`;
  const stateClass = member.state === 'minimized' ? 'minimized' : 'normal';
  const title = member.descriptor?.title ?? member.title ?? 'Untitled';
  const runningIndicator = stateClass === 'normal'
    ? `<span class="window-layout-member-state ${stateClass}" data-wl-member-state="${stateClass}" aria-hidden="true"></span>`
    : '';
  return `<button class="window-layout-member ${stateClass}" data-wl-member="${escapeHtml(member.id)}" data-wl-layout="${escapeHtml(layoutId)}" type="button" aria-label="${escapeHtml(title)}" aria-pressed="${stateClass === 'minimized' ? 'true' : 'false'}" aria-selected="false"${disabled ? ' disabled' : ''}>
    ${iconMarkup}
    ${runningIndicator}
  </button>`;
}

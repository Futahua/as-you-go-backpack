/**
 * Quick Run — the surface: the layer, the line, the chips, the flat result list and its two sentences.
 *
 * The module owns the elements the page declares (#quick-run-layer, -input, -chips, -results, and the two
 * lines -cap and -notice) and paints them from a session. It draws nothing the contract has not decided:
 * section 1.2's row content (icon kind, primary name, faint trailing breadcrumb, one flat list) and section
 * 1.4's chips come from quick-run-presentation.js as data, and this module only turns that data into nodes.
 *
 * Four rules it does not invent:
 *
 * - **The input is the reader's while they are typing.** The value is set from the session when the
 *   session's query is empty (opening and closing), and never while a query is live — a repaint that
 *   overwrote what someone was typing would be the surface fighting the person using it.
 * - **Keys are stable and semantic**, so a later acceptance test can name a row without depending on
 *   order: data-quick-run-key carries the row's resultKey, data-quick-run-highlighted marks the one row
 *   the session highlighted, data-quick-run-chip marks an active chip, and data-quick-run-cap is `true`
 *   exactly while the cap line is on screen.
 * - **The highlight travels with the scroll.** Section 6.3 leaves the list to scroll normally, and the
 *   other half of that sentence is that the selection must not be left behind: the wheel moves the
 *   highlight by the rows it scrolled — accumulating the device's deltas, in whatever unit it reports them,
 *   until a whole row of travel has arrived — and a highlight *moved* by the keyboard, the wheel or a
 *   refresh is brought back into view. Typing is deliberately not in that set: a new query is a new list and
 *   starts at its own top, where its first row already is, and touching the scroll box on every keystroke
 *   forces the layout the paint cap exists to keep out of the keystroke (measured: forcing it there took the
 *   integrated harness from p95 4.3 ms to 8.1 ms). The list's own scroll event feeds that same bookkeeping,
 *   so a dragged scrollbar counts as the reader having scrolled.
 * - **Nothing is drawn for a state that has nothing to say.** An empty query shows no home screen, an
 *   uncapped list shows no cap line, and a query that matches draws the no-matches line rather than a
 *   blank layer that reads like a stall.
 *
 * Shift+Enter is not handled here: the gesture was cut with its plan (see quick-run-activation.js).
 */
import { quickRunCapNotice, quickRunChipViews, quickRunEmptyNotice, quickRunRowViews } from './quick-run-presentation.js';
import {
  closeQuickRunSession,
  closedQuickRunSession,
  openQuickRunSession,
  quickRunSessionAfterArrow,
  quickRunSessionAfterScroll,
  quickRunSessionAfterTab,
  quickRunSessionRefreshed,
  quickRunSessionWithQuery,
} from './quick-run-session.js';

const ROW_CLASS = 'quick-run-result';
const CHIP_CLASS = 'quick-run-chip';

/**
 * How many pixels one row of the list is worth when a wheel delta is translated into rows.
 *
 * The painted row's own height is preferred when it can be measured (`offsetHeight`), and this is the
 * fallback for a caller without layout — and the number quick-run.css's row `min-height` is written to, so
 * the fallback and the stylesheet agree.
 */
export const QUICK_RUN_WHEEL_ROW_HEIGHT_PX = 24;

function rowNode(document, view, onRowClick, clearHover) {
  const item = document.createElement('li');
  item.className = ROW_CLASS + (view.highlighted ? ' highlighted' : '');
  item.dataset.quickRunKey = view.key;
  item.dataset.quickRunHighlighted = view.highlighted ? 'true' : 'false';
  item.dataset.quickRunHovered = 'false';
  item.addEventListener('mouseover', () => {
    if (typeof clearHover === 'function') clearHover();
    item.dataset.quickRunHovered = 'true';
  });
  const icon = document.createElement('span');
  icon.className = 'quick-run-icon quick-run-icon-' + view.iconKind;
  const primary = document.createElement('span');
  primary.className = 'quick-run-name';
  primary.textContent = view.primary;
  const breadcrumb = document.createElement('span');
  breadcrumb.className = 'quick-run-breadcrumb';
  breadcrumb.textContent = view.breadcrumb;
  item.append(icon, primary, breadcrumb);
  // One activation path for both entry points: a click reports the same key a keyboard activation would.
  if (typeof onRowClick === 'function') item.addEventListener('click', () => onRowClick(view.key));
  return item;
}

function chipNode(document, view) {
  const chip = document.createElement('li');
  chip.className = CHIP_CLASS + (view.active ? ' active' : '');
  chip.dataset.quickRunChip = view.label;
  chip.textContent = view.label;
  return chip;
}

/** Bring the highlighted row into view, minimally. A caller without layout (a mock) simply reports nothing. */
function revealHighlightedRow(elements) {
  for (const row of elements.results?.children ?? []) {
    if (row?.dataset?.quickRunHighlighted !== 'true') continue;
    row.scrollIntoView?.({ block: 'nearest' });
    return;
  }
}

/**
 * Paint a session into the elements. Returns the number of rows drawn, for a caller that cares.
 *
 * The cap line is painted from `quickRunCapNotice(session)` and the no-matches line from
 * `quickRunEmptyNotice(session)`: both sentences come from the presentation layer as data, and the surface
 * only decides that `null` means hidden and empty. They are separate elements because they say different
 * things — the cap line is about the list being longer than what is shown, the no-matches line is about
 * there being no list at all — and each appears only while it is true.
 *
 * The list's own scroll position is handled by `keepScroll` and `resetScroll`. A repaint that follows a
 * *movement* inside the list (arrow, wheel, Tab, a refreshed snapshot) keeps where the reader was and
 * brings the moved highlight into view. A repaint that follows typing resets the new list to its own top,
 * so the row the highlight moved to is the first thing on screen. Neither is done unless it is needed:
 * reading or writing a scroll box forces style-and-layout, and the keystroke path is the one the
 * integrated harness measures, so the mount only asks for the reset once the reader has actually scrolled.
 */
export function paintQuickRunSurface({ document, elements, session, onRowClick, keepScroll = false, resetScroll = false }) {
  elements.layer.hidden = !session.open;
  if (elements.notice) {
    const empty = quickRunEmptyNotice(session);
    elements.notice.textContent = empty ? empty.text : '';
    elements.notice.hidden = !empty;
  }
  if (elements.cap) {
    const cap = quickRunCapNotice(session);
    elements.cap.textContent = cap ? cap.text : '';
    elements.cap.dataset.quickRunCap = cap ? 'true' : 'false';
    elements.cap.hidden = !cap;
  }
  if (!session.open) {
    elements.input.value = '';
    elements.chips.replaceChildren();
    elements.results.replaceChildren();
    return 0;
  }
  // Only an empty query may overwrite the field: that is opening (and a cleared line), not typing.
  if (session.query === '') elements.input.value = '';
  const chips = quickRunChipViews(session).map((view) => chipNode(document, view));
  elements.chips.replaceChildren(...chips);
  const rows = quickRunRowViews(session).map((view) => rowNode(document, view, onRowClick, clearHover));
  // Hover is a marker of its own, never the keyboard highlight (sections 6.3 and 6.4): moving the pointer
  // may show where the pointer is, and Enter still runs whatever the keyboard highlighted.
  function clearHover() {
    for (const row of elements.results.children ?? []) row.dataset.quickRunHovered = 'false';
  }
  // Touching the scroll box forces style-and-layout, so it happens only on the two paths that need it, and
  // never on an ordinary keystroke: `keepScroll || resetScroll` short-circuits before the scrollTop read.
  const touchesScroll = keepScroll || resetScroll;
  const canScroll = touchesScroll && typeof elements.results.scrollTop === 'number';
  const scrollTop = canScroll && keepScroll ? elements.results.scrollTop : 0;
  elements.results.replaceChildren(...rows);
  if (canScroll) elements.results.scrollTop = scrollTop;
  if (keepScroll) revealHighlightedRow(elements);
  return rows.length;
}

/**
 * The two lengths a wheel delta is measured against: how tall a painted row is, and how much of the list
 * the reader can see at once.
 *
 * The painted row's own height is preferred when it can be measured (`offsetHeight`), and the exported
 * fallback is what quick-run.css's row `min-height` is written to, so the two agree. A caller without
 * layout (a test mock) gets the fallbacks.
 */
function wheelMetrics(elements) {
  const measuredRow = Number(elements.results?.children?.[0]?.offsetHeight);
  const rowHeight = Number.isFinite(measuredRow) && measuredRow > 0 ? measuredRow : QUICK_RUN_WHEEL_ROW_HEIGHT_PX;
  const measuredViewport = Number(elements.results?.clientHeight);
  const viewportHeight = Number.isFinite(measuredViewport) && measuredViewport > 0 ? measuredViewport : rowHeight;
  return { rowHeight, viewportHeight };
}

/**
 * One wheel event's travel in pixels, whatever unit the device reported.
 *
 * `deltaMode` is the part that is easy to miss: 0 is pixels, 1 is lines and 2 is pages. A device that
 * reports lines would otherwise be read as a handful of pixels and a device that reports pages as a whole
 * screenful of them. A line in a list of rows is one row, and a page is what the list can show at once.
 */
function wheelPixels(event, { rowHeight, viewportHeight }) {
  const delta = Number(event?.deltaY);
  if (!Number.isFinite(delta) || delta === 0) return 0;
  const mode = Number(event?.deltaMode ?? 0);
  if (mode === 1) return delta * rowHeight;
  if (mode === 2) return delta * viewportHeight;
  return delta;
}

/**
 * Mount Quick Run on the five elements and return the handles the entry file needs.
 *
 * This is the whole wiring, kept out of the composition root on purpose: the entry file passes the
 * elements and a way to read the workspace state, then gives open to the keyboard controller as its
 * openQuickRun callback. Everything else — the input listener, the arrow keys, the wheel, Tab and Escape —
 * lives here, where a test can drive it with element mocks instead of by launching the app.
 */
export function mountQuickRun(input) {
  const { document, elements, getState, onActivate, onReveal } = input ?? {};
  if (!document || !elements || typeof getState !== 'function') {
    throw new TypeError('mountQuickRun needs a document, the four elements and a getState function');
  }
  let session = closedQuickRunSession();
  // Whether this session's list has actually been scrolled by a movement. Tracked here rather than read
  // back from the element, because reading it is a layout flush and a keystroke must not pay for one: with
  // this flag, an ordinary typed character touches the scroll box not at all, and the reset happens only
  // when there is something to reset.
  let listScrolled = false;
  // Wheel travel that has not yet added up to a whole row (see the wheel handler below).
  let wheelRemainderPx = 0;
  // Section 6.4: one execution implementation, reached from the keyboard and the pointer alike.
  const activate = (key) => { if (key && typeof onActivate === 'function') onActivate(key); };
  const highlighted = () => (typeof session.highlightKey === 'string' ? session.highlightKey : null);
  const paint = (options = {}) => {
    const keepScroll = options.keepScroll === true;
    const resetScroll = !keepScroll && listScrolled;
    const drawn = paintQuickRunSurface({
      document,
      elements,
      session,
      onRowClick: activate,
      keepScroll,
      resetScroll,
    });
    if (keepScroll) listScrolled = true;
    else if (resetScroll) listScrolled = false;
    return drawn;
  };

  elements.input.addEventListener('input', () => {
    // A new query is a new list: any part of a wheel gesture still owed to the old one is dropped, and the
    // painted list starts at its own top.
    wheelRemainderPx = 0;
    session = quickRunSessionWithQuery(session, elements.input.value);
    paint();
  });

  // The list is natively scrollable, so a dragged scrollbar or a touch scroll moves it without any repaint
  // of ours. The dirty flag has to come from the element's own scroll event as well, or typing after such a
  // scroll would leave the newly highlighted row above the viewport - the list was scrolled, and only the
  // flag knows it. It stays false for a session the reader never scrolls, which is what keeps the keystroke
  // path free of the layout flush this flag exists to avoid.
  elements.results.addEventListener?.('scroll', () => { listScrolled = true; });

  elements.layer.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (event.preventDefault) event.preventDefault();
      session = closeQuickRunSession();
      paint();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (event.preventDefault) event.preventDefault();
      session = quickRunSessionAfterArrow(session, event.key === 'ArrowDown' ? 1 : -1);
      paint({ keepScroll: true });
      return;
    }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      // Section 1.6: Ctrl+Enter reveals the occurrence inside the workspace. The mount does not know what
      // revealing means; it hands the key to the caller, which is where section 1.6's boundary lives. With
      // no row highlighted there is no occurrence to reveal, and the key is left alone rather than being
      // handed over as a target that never existed.
      if (event.preventDefault) event.preventDefault();
      const key = highlighted();
      if (key && typeof onReveal === 'function') onReveal(key);
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.altKey) {
      // Only the unmodified key is the default action. Shift+Enter used to mean "add to the active layout"
      // and was cut (see quick-run-activation.js); leaving it to fall through here would turn a cut gesture
      // into a silent second Enter, so a modified Enter no longer claimed by anything is deliberately inert.
      if (event.preventDefault) event.preventDefault();
      activate(highlighted());
      return;
    }
    if (event.key === 'Tab') {
      if (event.preventDefault) event.preventDefault();
      // The AUTHOR ruling of 2026-09-12: Tab steps through the chips on offer, never onto a type the
      // current query has emptied.
      session = quickRunSessionAfterTab(session, event.shiftKey ? -1 : 1);
      paint({ keepScroll: true });
    }
  });

  // Section 6.3, both halves: the list scrolls normally — this handler never calls preventDefault — and the
  // highlight moves with it, so the row Enter would run is the row the reader is looking at.
  //
  // Travel is accumulated rather than rounded per event. A precision touchpad reports a stream of sub-row
  // deltas, and treating every non-zero one as a whole row ran the selection ahead of the list by however
  // many events the gesture happened to produce; a row moves only once a row's worth of travel has arrived,
  // and the remainder is kept for the next event.
  elements.layer.addEventListener('wheel', (event) => {
    if (!session.open || session.rows.length === 0) return;
    const metrics = wheelMetrics(elements);
    const pixels = wheelPixels(event, metrics);
    if (pixels === 0) return;
    wheelRemainderPx += pixels;
    const rows = Math.trunc(wheelRemainderPx / metrics.rowHeight);
    if (rows === 0) return;
    wheelRemainderPx -= rows * metrics.rowHeight;
    session = quickRunSessionAfterScroll(session, rows);
    paint({ keepScroll: true });
  });

  paint();

  return {
    /** The keyboard controller's openQuickRun callback: open on the current state and show the line. */
    open() {
      listScrolled = false;
      wheelRemainderPx = 0;
      session = openQuickRunSession(getState());
      paint();
      // One empty *focused* line: the section says the reader types immediately, so the field takes
      // focus on open. Guarded because a caller may mount without a focusable input.
      elements.input.focus?.();
      return true;
    },
    close() {
      listScrolled = false;
      wheelRemainderPx = 0;
      session = closeQuickRunSession();
      paint();
    },
    /**
     * Rebuild the snapshot from the current state, keeping the query and the filter (section 5).
     *
     * The caller uses this after an action found its target gone: without it the dead row stays on screen
     * and the reader can only hit it again, which is how a stale index turns into a loop.
     */
    refresh() {
      if (!session.open) return session;
      session = quickRunSessionRefreshed(session, getState());
      paint({ keepScroll: true });
      return session;
    },
    session: () => session,
  };
}

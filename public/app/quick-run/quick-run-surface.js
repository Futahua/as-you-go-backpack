/**
 * Quick Run — the surface: the layer, the line, the chips, the flat result list and the cap line.
 *
 * The module owns the elements the page declares (#quick-run-layer, -input, -chips, -results, and the two
 * lines -cap and -notice) and paints them from a session. It draws nothing the contract has not decided:
 * section 1.2's row content (icon kind, primary name, faint trailing breadcrumb, one flat list) and section
 * 1.4's chips come from quick-run-presentation.js as data, and this module only turns that data into nodes.
 *
 * Two rules it does not invent:
 *
 * - **The input is the reader's while they are typing.** The value is set from the session when the
 *   session's query is empty (opening and closing), and never while a query is live — a repaint that
 *   overwrote what someone was typing would be the surface fighting the person using it.
 * - **Keys are stable and semantic**, so a later acceptance test can name a row without depending on
 *   order: data-quick-run-key carries the row's resultKey, data-quick-run-highlighted marks the one row
 *   the session highlighted, data-quick-run-chip marks an active chip, and data-quick-run-cap is `true`
 *   exactly while the cap line is on screen.
 */
import { quickRunCapNotice, quickRunChipViews, quickRunRowViews } from './quick-run-presentation.js';
import {
  closeQuickRunSession,
  closedQuickRunSession,
  openQuickRunSession,
  quickRunSessionAfterArrow,
  quickRunSessionAfterTab,
  quickRunSessionWithQuery,
} from './quick-run-session.js';

const ROW_CLASS = 'quick-run-result';
const CHIP_CLASS = 'quick-run-chip';

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

/**
 * Paint a session into the elements. Returns the number of rows drawn, for a caller that cares.
 *
 * `notice` is section 1.6's visible half: one line, painted with the row it describes, so a key that is
 * disabled for that row says why before it is pressed instead of looking like a key that does nothing.
 * It is optional because a caller may mount without that element, exactly as the other four are required.
 *
 * The cap line is the same shape and its own element (`data-quick-run-cap`), because the two say different
 * things: the notice is about the highlighted row, the cap line is about the list. It is painted from
 * `quickRunCapNotice(session)` — the sentence comes from the presentation layer as data — and the surface
 * only decides that `null` means hidden and empty. No cap line ever appears for an uncapped session, so a
 * query that matches fewer rows than the cap says nothing about a cap at all.
 */
export function paintQuickRunSurface({ document, elements, session, onRowClick, notice = '' }) {
  elements.layer.hidden = !session.open;
  if (elements.notice) {
    elements.notice.textContent = notice;
    elements.notice.hidden = notice === '';
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
  elements.results.replaceChildren(...rows);
  return rows.length;
}

/**
 * Mount Quick Run on the four elements and return the handles the entry file needs.
 *
 * This is the whole wiring, kept out of the composition root on purpose: the entry file passes the
 * elements and a way to read the workspace state, then gives open to the keyboard controller as its
 * openQuickRun callback. Everything else — the input listener, the arrow keys, Tab and Escape — lives
 * here, where a test can drive it with element mocks instead of by launching the app.
 */
export function mountQuickRun(input) {
  const { document, elements, getState, onActivate, onShiftEnter, shiftEnterNotice, onReveal } = input ?? {};
  if (!document || !elements || typeof getState !== 'function') {
    throw new TypeError('mountQuickRun needs a document, the four elements and a getState function');
  }
  let session = closedQuickRunSession();
  // Section 6.4: one execution implementation, reached from the keyboard and the pointer alike.
  const activate = (key) => { if (key && typeof onActivate === 'function') onActivate(key); };
  // The highlighted row comes out of the session, never out of the workspace: asking the tree again on
  // every keystroke is the re-read section 5 forbids, and the session tests already count those reads.
  const highlightedRow = () => session.rows.find((row) => row.resultKey === session.highlightKey) ?? null;
  const shiftState = () => {
    if (typeof shiftEnterNotice !== 'function') return { text: '', enabled: false };
    const answer = shiftEnterNotice(highlightedRow());
    if (!answer || typeof answer.text !== 'string') return { text: '', enabled: false };
    return { text: answer.text, enabled: answer.enabled === true };
  };
  const paint = () => paintQuickRunSurface({
    document,
    elements,
    session,
    onRowClick: activate,
    notice: shiftState().text,
  });

  elements.input.addEventListener('input', () => {
    session = quickRunSessionWithQuery(session, elements.input.value);
    paint();
  });

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
      paint();
      return;
    }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      // Section 1.6: Ctrl+Enter reveals the occurrence inside the workspace. The mount does not know what
      // revealing means; it hands the key to the caller, which is where section 1.6's boundary lives.
      if (event.preventDefault) event.preventDefault();
      if (typeof onReveal === 'function') onReveal(session.highlightKey);
      return;
    }
    if (event.key === 'Enter' && event.shiftKey) {
      if (event.preventDefault) event.preventDefault();
      // Section 1.6: enabled only for Layout Items, visibly disabled for the other three, and never
      // silently ignored - the reason is on screen already, and an enabled press goes to the caller.
      if (shiftState().enabled) onShiftEnter?.(session.highlightKey);
      return;
    }
    if (event.key === 'Enter') {
      if (event.preventDefault) event.preventDefault();
      activate(session.highlightKey);
      return;
    }
    if (event.key === 'Tab') {
      if (event.preventDefault) event.preventDefault();
      // The AUTHOR ruling of 2026-09-12: Tab steps through the chips on offer, never onto a type the
      // current query has emptied.
      session = quickRunSessionAfterTab(session, event.shiftKey ? -1 : 1);
      paint();
    }
  });

  paint();

  return {
    /** The keyboard controller's openQuickRun callback: open on the current state and show the line. */
    open() {
      session = openQuickRunSession(getState());
      paint();
      // One empty *focused* line: the section says the reader types immediately, so the field takes
      // focus on open. Guarded because a caller may mount without a focusable input.
      elements.input.focus?.();
      return true;
    },
    close() {
      session = closeQuickRunSession();
      paint();
    },
    session: () => session,
  };
}
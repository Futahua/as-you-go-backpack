/**
 * Quick Run — the session: what is open, what is typed, what is shown, what is highlighted.
 *
 * This is section 1.1's behaviour as a pure state machine, with no markup at all. The surface that draws
 * it is a later stage, and the rules here are the ones the contract fixes in as many words:
 *
 * - opening shows one **empty** line, no result rows, filter All, no highlight — there is no
 *   empty-query home screen, so an empty query shows nothing rather than everything;
 * - results first appear after the first non-empty query;
 * - Escape closes the session and leaves **no** result action behind: closing produces a closed session
 *   and nothing else, so no create/move/launch/select/navigate/persist can ride along with it;
 * - closing clears the query, the highlight, the rows and the filter — a reopened session starts empty
 *   rather than resuming a previous search.
 *
 * The rows it narrows are the ones quick-run-search.js builds, ranked by quick-run-index.js, filtered by
 * quick-run-types.js: this module owns only the session around them.
 */
import { quickRunRows } from './quick-run-search.js';
import { quickRunResults } from './quick-run-index.js';
import { chipsFor, nextAvailableFilter, normaliseFilter, resolveFilter } from './quick-run-types.js';

/** A closed session: the state a surface draws nothing for. */
export function closedQuickRunSession() {
  return { open: false, query: '', filter: 'All', rows: [], chips: [], highlightKey: null, fellBack: false };
}

function withResults(base, query, filter) {
  const needle = query.trim();
  if (needle === '') {
    // No empty-query home screen: an empty query shows nothing, and no chips either.
    return { ...base, query, filter: normaliseFilter(filter), rows: [], chips: [], highlightKey: null, fellBack: false };
  }
  const matched = quickRunResults(base.allRows, needle);
  const resolved = resolveFilter(matched, filter);
  return {
    ...base,
    query,
    filter: resolved.filter,
    fellBack: resolved.fellBack,
    rows: resolved.rows,
    chips: chipsFor(matched),
    highlightKey: resolved.rows.length === 0 ? null : resolved.rows[0].resultKey,
  };
}

/** Opening Quick Run: one empty line, nothing else. */
export function openQuickRunSession(state) {
  const base = { ...closedQuickRunSession(), open: true, allRows: quickRunRows(state) };
  return withResults(base, '', 'All');
}

/** A keystroke into the search line. */
export function quickRunSessionWithQuery(session, query) {
  if (!session.open) return session;
  return withResults(session, query, session.filter);
}

/** Tab (forward) and Shift+Tab (backward) over the type filters, re-resolving the rows. */
export function quickRunSessionWithFilter(session, filter) {
  if (!session.open) return session;
  return withResults(session, session.query, filter);
}

/**
 * Tab and Shift+Tab as the AUTHOR ruled: over the chips that are actually offered, skipping the types the
 * current query has emptied. The session already knows them - `chips` is All plus one per type with a
 * match - so the traversal needs no second opinion about what is available.
 */
export function quickRunSessionAfterTab(session, direction = 1) {
  if (!session.open) return session;
  const offered = Array.isArray(session.chips) ? session.chips : [];
  if (offered.length < 2) return session;
  return quickRunSessionWithFilter(session, nextAvailableFilter(session.filter, direction, offered));
}

/** ArrowUp and ArrowDown, which move the highlight without changing the result set. */
export function quickRunSessionAfterArrow(session, delta) {
  if (!session.open || session.rows.length === 0) return session;
  const index = session.rows.findIndex((row) => row.resultKey === session.highlightKey);
  const from = index === -1 ? 0 : index;
  const next = Math.min(Math.max(from + (delta < 0 ? -1 : 1), 0), session.rows.length - 1);
  return { ...session, highlightKey: session.rows[next].resultKey };
}

/** Closing: everything the session held is gone, and nothing else is produced. */
export function closeQuickRunSession() {
  return closedQuickRunSession();
}
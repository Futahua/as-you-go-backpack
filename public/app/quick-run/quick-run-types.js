/**
 * Quick Run — type-filter vocabulary and cycle.
 *
 * The contract's first export, because it is the only part of Quick Run that is fully specified and
 * entirely pure. Section 1.4 of the checklist fixes: the cycle All, Folders, Shortcuts, Links, Layout
 * Items with Tab forward and Shift+Tab backward; only result types with at least one current query match
 * receive type chips; All is shown whenever there is at least one result; and an active filter that loses
 * all matches falls back to All immediately.
 *
 * No DOM, no host, no hotkey, no persisted state: every later stage consumes this.
 */

export const QUICK_RUN_FILTERS = Object.freeze([
  'All',
  'Folders',
  'Shortcuts',
  'Links',
  'Layout Items',
]);

/** The result kinds the searchable universe produces (section 2.1). */
export const QUICK_RUN_RESULT_KINDS = Object.freeze([
  'folder',
  'shortcut',
  'link',
  'layout-item',
]);

const KIND_BY_FILTER = Object.freeze({
  Folders: 'folder',
  Shortcuts: 'shortcut',
  Links: 'link',
  'Layout Items': 'layout-item',
});

export function isQuickRunFilter(value) {
  return QUICK_RUN_FILTERS.includes(value);
}

/** An unknown or missing filter is All: a bad value never hides results. */
export function normaliseFilter(value) {
  return isQuickRunFilter(value) ? value : 'All';
}

/** Tab (direction 1) and Shift+Tab (direction -1), wrapping at both ends. */
export function nextFilter(current, direction = 1) {
  const index = QUICK_RUN_FILTERS.indexOf(normaliseFilter(current));
  const step = direction < 0 ? -1 : 1;
  return QUICK_RUN_FILTERS[(index + step + QUICK_RUN_FILTERS.length) % QUICK_RUN_FILTERS.length];
}

/** The rows a filter shows. All shows everything, in the order the search ranked it. */
export function rowsForFilter(rows, filter) {
  const active = normaliseFilter(filter);
  if (active === 'All') return rows.slice();
  const kind = KIND_BY_FILTER[active];
  return rows.filter((row) => row.kind === kind);
}

/**
 * What the surface should show after a keystroke.
 *
 * fellBack is reported so the caller can move the highlight to the first All result, which is the next
 * sentence of the same rule.
 */
export function resolveFilter(rows, filter) {
  const active = normaliseFilter(filter);
  if (active === 'All') return { filter: 'All', rows: rows.slice(), fellBack: false };
  const filtered = rowsForFilter(rows, active);
  if (filtered.length === 0) return { filter: 'All', rows: rows.slice(), fellBack: true };
  return { filter: active, rows: filtered, fellBack: false };
}

/** The chips to draw: All whenever there is a result, then one per type that has a match. */
export function chipsFor(rows) {
  if (rows.length === 0) return [];
  const chips = ['All'];
  for (const filter of QUICK_RUN_FILTERS) {
    if (filter === 'All') continue;
    const kind = KIND_BY_FILTER[filter];
    if (rows.some((row) => row.kind === kind)) chips.push(filter);
  }
  return chips;
}
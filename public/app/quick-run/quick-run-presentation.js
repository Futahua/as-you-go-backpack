/**
 * Quick Run — what the surface draws, as data (section 1.2).
 *
 * Section 1.2 fixes the row's content and the list's shape, and this module is that mapping with no markup
 * and no selectors in it at all — the surface decides how to draw, this decides what:
 *
 * - every visible row carries an icon kind, a primary name and a faint trailing breadcrumb;
 * - **one flat list only**, no grouped sections;
 * - duplicate names are allowed and expected when breadcrumbs differ, so nothing here de-duplicates: two
 *   placements of one shortcut are two rows that happen to share a primary name.
 *
 * The icon is a *kind* rather than a glyph: the contract says a row has an icon, and glyph choice is
 * presentation, so the surface picks the picture from the kind it is given.
 */
const ICON_BY_TYPE = Object.freeze({
  folder: 'folder',
  shortcut: 'shortcut',
  link: 'link',
  'layout-item': 'layout-item',
});

/** The rows to draw, in the order the session ranked and highlighted them. */
export function quickRunRowViews(session) {
  return session.rows.map((row) => ({
    key: row.resultKey,
    iconKind: ICON_BY_TYPE[row.type] ?? 'item',
    primary: row.name,
    breadcrumb: row.breadcrumb,
    highlighted: row.resultKey === session.highlightKey,
    // Section 5: a layout item's actionability is never guessed from persisted state, and an untouched one
    // starts at 'unknown' rather than 'Not running'. Only a live native resolution could answer otherwise,
    // and that is deliberately not built here, so this says unknown and keeps saying it.
    availability: row.type === 'layout-item' ? 'unknown' : null,
  }));
}

/** The type chips to draw, with the active one marked. All is first whenever there is a result. */
export function quickRunChipViews(session) {
  return session.chips.map((label) => ({ label, active: label === session.filter }));
}
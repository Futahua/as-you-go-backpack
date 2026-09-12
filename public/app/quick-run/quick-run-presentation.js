/**
 * Quick Run — what the surface draws, as data (section 1.2).
 *
 * Section 1.2 fixes the row's content and the list's shape, and this module is that mapping with no markup
 * and no selectors in it at all — the surface decides how to draw, this decides what:
 *
 * - every visible row carries an icon kind, a primary name and a faint trailing breadcrumb;
 * - **one flat list only**, no grouped sections;
 * - duplicate names are allowed and expected when breadcrumbs differ, so nothing here de-duplicates: two
 *   placements of one shortcut are two rows that happen to share a primary name;
 * - the **cap line** (below) is a sentence this module owns, so the surface paints a string it was handed
 *   rather than composing copy of its own.
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

/**
 * What is known about a layout item's availability right now (section 10.1).
 *
 * `noted` is ephemeral session knowledge, keyed by the stable result key, and it is never persisted: an
 * untouched item is `unknown`, and it goes back to `unknown` the moment the thing that was noted no
 * longer describes the row. That last part is section 10.5's reset rule and it is why an entry carries the
 * descriptor it was noted against rather than only the state: a member whose descriptor changed is a
 * different window as far as anything here can tell, so the prior answer must not survive it.
 */
export function quickRunAvailabilityFor(noted, row) {
  if (row?.type !== 'layout-item') return null;
  const entry = noted ? noted[row.resultKey] : null;
  if (!entry) return 'unknown';
  if (entry.descriptor !== quickRunDescriptorFingerprint(row)) return 'unknown';
  return entry.availability;
}

/** The part of a row a noted availability belongs to: the occurrence and the descriptor it was seen with. */
export function quickRunDescriptorFingerprint(row) {
  return [row?.layoutId ?? null, row?.memberId ?? null, row?.name ?? null].join('\u0000');
}

/** The rows to draw, in the order the session ranked and highlighted them. */
export function quickRunRowViews(session, noted) {
  return session.rows.map((row) => ({
    key: row.resultKey,
    iconKind: ICON_BY_TYPE[row.type] ?? 'item',
    primary: row.name,
    breadcrumb: row.breadcrumb,
    highlighted: row.resultKey === session.highlightKey,
    // Section 5: a layout item's actionability is never guessed from persisted state, and an untouched one
    // starts at 'unknown' rather than 'Not running'. A noted resolution may answer otherwise, and only
    // while the descriptor it was noted against still describes the row.
    availability: quickRunAvailabilityFor(noted, row),
  }));
}

/** The type chips to draw, with the active one marked. All is first whenever there is a result. */
export function quickRunChipViews(session) {
  return session.chips.map((label) => ({ label, active: label === session.filter }));
}

/**
 * The cap line, as data: what the surface says when the list it painted is a prefix of the match set.
 *
 * `null` — not an empty sentence — when nothing is capped, because the line exists only while it is true:
 * a query that matches fewer rows than the cap paints all of them and says nothing about a cap.
 *
 * The count is all that is said, and it is said honestly in both directions: the first number is what is
 * actually on screen (`session.rows`, never the cap constant, which a future change to the cap would
 * otherwise make this sentence lie about), and `totalRows` is the whole match set the chips were built
 * from. The digits are grouped here rather than through the reader's locale so the sentence reads the same
 * on every machine and a test can hold it exactly.
 */
export function quickRunCapNotice(session) {
  if (session?.capped !== true) return null;
  return {
    text: `Showing the first ${session.rows.length} of ${groupDigits(session.totalRows)} matches — keep typing to narrow.`,
  };
}

/** 12213 -> "12,213", with no locale to vary and no Intl object to construct. */
function groupDigits(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
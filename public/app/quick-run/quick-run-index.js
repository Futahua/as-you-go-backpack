/**
 * Quick Run — the index: normalization, the fixed ranking tiers, and the query.
 *
 * Sections 0.5 to 0.7 of the contract fix all of it, and this module is only that:
 *
 * - **Matching reads the display name and nothing else.** The document lists what must NOT be ranked
 *   against — breadcrumb, shortcut target path, URL, executable fingerprint, descriptor metadata — and
 *   says that widening it is an explicit product change, not a convenience.
 * - **One pinned normalization function**, unit-tested: Unicode normalize, case-fold, trim, collapse
 *   repeated whitespace. The display string itself is never normalized: only the comparison is.
 * - **The ranking order is fixed**: Tier 0 exact, Tier 1 whole-name prefix, Tier 2 word prefix, Tier 3
 *   fuzzy subsequence, and no match below that. A fuzzy result may not outrank a prefix result because of
 *   usage history — which is why nothing here consults history at all.
 *
 * Within a tier the incoming row order is preserved. The contract does not order inside a tier, so this
 * module does not invent one.
 */
import { quickRunRows } from './quick-run-search.js';

/** Tier 0 exact, 1 whole-name prefix, 2 word prefix, 3 fuzzy subsequence; null when nothing matches. */
export const QUICK_RUN_TIERS = Object.freeze({ exact: 0, wholeNamePrefix: 1, wordPrefix: 2, fuzzy: 3 });

const WORD_SPLIT = /[^\p{L}\p{N}]+/u;

/** Section 0.6, pinned here and nowhere else. */
export function normaliseQueryText(value) {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFKC')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function isSubsequence(haystack, needle) {
  let index = 0;
  for (const character of haystack) {
    if (character === needle[index]) index += 1;
    if (index === needle.length) return true;
  }
  return needle.length === 0;
}

/** The tier a name matches at, or null. The name is the only field consulted. */
export function tierForName(name, query) {
  const text = normaliseQueryText(name);
  const needle = normaliseQueryText(query);
  if (needle === '') return null;
  if (text === needle) return QUICK_RUN_TIERS.exact;
  if (text.startsWith(needle)) return QUICK_RUN_TIERS.wholeNamePrefix;
  // Word prefix: any word of the name — split on spaces, hyphens, underscores and punctuation — begins
  // with the query.
  for (const word of text.split(WORD_SPLIT)) {
    if (word !== '' && word.startsWith(needle)) return QUICK_RUN_TIERS.wordPrefix;
  }
  if (isSubsequence(text, needle)) return QUICK_RUN_TIERS.fuzzy;
  return null;
}

/**
 * The rows a query shows, in ranked order.
 *
 * An empty query shows nothing: the contract has no empty-query home screen, so [] is the answer
 * rather than every row.
 */
export function quickRunResults(rows, query) {
  const needle = normaliseQueryText(query);
  if (needle === '') return [];
  const ranked = [];
  rows.forEach((row, index) => {
    const tier = tierForName(row.name, needle);
    if (tier === null) return;
    ranked.push({ row, tier, index });
  });
  ranked.sort((left, right) => left.tier - right.tier || left.index - right.index);
  return ranked.map((entry) => ({ ...entry.row, tier: entry.tier }));
}

/** The whole query path over a workspace state: rows from the universe, then the ranked match. */
export function quickRunQuery(state, query) {
  return quickRunResults(quickRunRows(state), query);
}
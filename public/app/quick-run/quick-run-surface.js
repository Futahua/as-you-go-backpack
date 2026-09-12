/**
 * Quick Run — the surface: the layer, the line, the chips and the flat result list.
 *
 * The module owns the four elements the page declares (#quick-run-layer, -input, -chips, -results) and
 * paints them from a session. It draws nothing the contract has not decided: section 1.2's row content
 * (icon kind, primary name, faint trailing breadcrumb, one flat list) and section 1.4's chips come from
 * quick-run-presentation.js as data, and this module only turns that data into nodes.
 *
 * Two rules it does not invent:
 *
 * - **The input is the reader's while they are typing.** The value is set from the session when the
 *   session's query is empty (opening and closing), and never while a query is live — a repaint that
 *   overwrote what someone was typing would be the surface fighting the person using it.
 * - **Keys are stable and semantic**, so a later acceptance test can name a row without depending on
 *   order: data-quick-run-key carries the row's resultKey, data-quick-run-highlighted marks the one row
 *   the session highlighted, and data-quick-run-chip marks an active chip.
 */
import { quickRunChipViews, quickRunRowViews } from './quick-run-presentation.js';

const ROW_CLASS = 'quick-run-result';
const CHIP_CLASS = 'quick-run-chip';

function rowNode(document, view) {
  const item = document.createElement('li');
  item.className = ROW_CLASS + (view.highlighted ? ' highlighted' : '');
  item.dataset.quickRunKey = view.key;
  item.dataset.quickRunHighlighted = view.highlighted ? 'true' : 'false';
  const icon = document.createElement('span');
  icon.className = 'quick-run-icon quick-run-icon-' + view.iconKind;
  const primary = document.createElement('span');
  primary.className = 'quick-run-name';
  primary.textContent = view.primary;
  const breadcrumb = document.createElement('span');
  breadcrumb.className = 'quick-run-breadcrumb';
  breadcrumb.textContent = view.breadcrumb;
  item.append(icon, primary, breadcrumb);
  return item;
}

function chipNode(document, view) {
  const chip = document.createElement('li');
  chip.className = CHIP_CLASS + (view.active ? ' active' : '');
  chip.dataset.quickRunChip = view.label;
  chip.textContent = view.label;
  return chip;
}

/** Paint a session into the four elements. Returns the number of rows drawn, for a caller that cares. */
export function paintQuickRunSurface({ document, elements, session }) {
  elements.layer.hidden = !session.open;
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
  const rows = quickRunRowViews(session).map((view) => rowNode(document, view));
  elements.results.replaceChildren(...rows);
  return rows.length;
}
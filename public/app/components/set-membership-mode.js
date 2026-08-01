/** The Ctrl+G membership picker.
 *
 * A dialog-free mode over the canvas: while it is open, clicking any item
 * toggles the set that item belongs to, so sets are chosen by pointing at
 * their contents rather than by reading a list of names. Enter commits the
 * chosen sets onto the selection that opened the mode; Escape abandons it.
 *
 * The mode owns only transient picking state — which sets are currently
 * chosen, and which items it opened over. Deciding what membership results
 * belongs to the pure model, and persisting it to the command layer. */
import { setsContaining } from '../../sets-model.js';

export function createSetMembershipMode({
  getSets,
  getSelectedIds,
  shareSelectionWithSets,
  render,
  setStatus,
}) {
  let active = false;
  let itemIds = [];
  let chosen = new Set();

  function isActive() {
    return active;
  }

  /** Sets currently chosen, for the renderer to light up. */
  function chosenSetIds() {
    return [...chosen];
  }

  /** The items the mode is editing, so the renderer can keep showing them as
   * the subjects while the selection itself is not being changed. */
  function subjectIds() {
    return [...itemIds];
  }

  /** Opens the mode over the current selection, pre-choosing the sets those
   * items already belong to — so confirming immediately is a no-op rather
   * than a surprise removal. */
  function begin() {
    const ids = getSelectedIds();
    if (ids.length === 0) return false;
    active = true;
    itemIds = [...ids];
    chosen = new Set();
    for (const itemId of itemIds) {
      for (const set of setsContaining(getSets(), itemId)) chosen.add(set.id);
    }
    describe();
    render();
    return true;
  }

  /** Clicking an item toggles the set it belongs to. A setless item has no
   * set to toggle and is reported rather than silently ignored. */
  function toggleFromItem(itemId) {
    if (!active) return;
    const sets = setsContaining(getSets(), itemId);
    if (sets.length === 0) {
      setStatus('That item is in no set. Click an item inside the set you want.');
      return;
    }
    for (const set of sets) {
      if (chosen.has(set.id)) chosen.delete(set.id);
      else chosen.add(set.id);
    }
    describe();
    render();
  }

  function describe() {
    const count = chosen.size;
    const subject = itemIds.length === 1 ? '1 item' : `${itemIds.length} items`;
    setStatus(count === 0
      ? `${subject}: no sets chosen — Enter removes them from every set, Escape cancels.`
      : `${subject} in ${count} ${count === 1 ? 'set' : 'sets'} — Enter confirms, Escape cancels.`);
  }

  /** Enter: applies the chosen sets. An empty choice is meaningful — it is
   * how items are returned to setless — so it commits rather than cancelling. */
  async function confirm() {
    if (!active) return;
    const setIds = [...chosen];
    const subjects = [...itemIds];
    close();
    await shareSelectionWithSets(setIds, subjects);
  }

  function cancel() {
    if (!active) return;
    close();
    setStatus('');
  }

  function close() {
    active = false;
    itemIds = [];
    chosen = new Set();
    render();
  }

  return { isActive, begin, toggleFromItem, confirm, cancel, chosenSetIds, subjectIds };
}

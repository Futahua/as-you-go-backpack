/** Application command layer. Commands are the named user-intent operations
 * that coordinate session mutation, persistence, and narrow rendering
 * effects. They depend only on the store, model/host operations, and the
 * injected effect callbacks (rendering, view persistence) — never on UI
 * components or browser events. Event handlers and the menu map call these
 * instead of orchestrating the store inline. */
export function createWorkspaceCommands({
  store,
  syncSelection,
  saveWorkspaceView,
}) {
  /** Applies click / ctrl-click / shift-click selection rules. Takes plain
   * modifier flags and the ordered visible ids, not a DOM event. */
  function selectItem(itemId, { shiftKey, ctrlKey, visibleItemIds }) {
    const session = store.getSession();
    if (shiftKey && session.selectionAnchor) {
      const from = visibleItemIds.indexOf(session.selectionAnchor);
      const to = visibleItemIds.indexOf(itemId);
      if (from >= 0 && to >= 0) {
        if (!ctrlKey) store.clearSelection();
        const [start, end] = from < to ? [from, to] : [to, from];
        visibleItemIds.slice(start, end + 1).forEach((id) => store.addToSelection(id));
      }
    } else if (ctrlKey) {
      if (session.selected.has(itemId)) store.removeFromSelection(itemId);
      else store.addToSelection(itemId);
      store.setSelectionAnchor(itemId);
    } else {
      store.setSelection([itemId]);
      store.setSelectionAnchor(itemId);
    }
    syncSelection();
    saveWorkspaceView();
  }

  async function undo() {
    await store.undo();
  }

  async function redo() {
    await store.redo();
  }

  return { selectItem, undo, redo };
}

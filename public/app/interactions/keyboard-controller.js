/** Translates keyboard events into plain command inputs. The controller only
 * reads session state and DOM, then delegates session/persistence/host work
 * to the command layer — it never mutates document or session state itself. */
export function createKeyboardController({
  document,
  elements,
  store,
  commands,
  closeMenu,
  getVisibleItemIds,
  confirmDialog,
}) {
  let abortController = null;

  function mount() {
    abortController = new AbortController();
    document.addEventListener('keydown', (event) => {
      if (!elements.editorLayer.hidden || !elements.confirmLayer.hidden || !elements.linkEditLayer.hidden) return;
      const session = store.getSession();
      const key = event.key.toLowerCase();

      // In Bin mode, cut/copy/paste must not reach the host's clipboard.
      if (session.binMode && event.ctrlKey && ['c', 'x', 'v'].includes(key)) {
        event.preventDefault();
        return;
      }
      if (event.key === 'Escape') {
        commands.clearSelection();
        closeMenu();
        return;
      }
      if (event.ctrlKey && key === 'a') {
        event.preventDefault();
        commands.selectAllVisible(getVisibleItemIds());
        return;
      }
      if (event.ctrlKey && key === 'c') {
        event.preventDefault();
        commands.copySelection();
        return;
      }
      if (event.ctrlKey && key === 'x') {
        event.preventDefault();
        commands.cutSelection();
        return;
      }
      if (event.ctrlKey && key === 'v') {
        event.preventDefault();
        commands.pasteInto(commands.selectedPasteDestinations());
        return;
      }
      if (event.ctrlKey && !event.shiftKey && key === 'z') {
        event.preventDefault();
        commands.undo();
        return;
      }
      if (event.ctrlKey && (key === 'y' || (event.shiftKey && key === 'z'))) {
        event.preventDefault();
        commands.redo();
        return;
      }
      if (event.key === 'Delete' && session.selected.size > 0) {
        event.preventDefault();
        if (session.binMode) confirmDialog.askPermanentDelete();
        else commands.moveSelectionToBin();
        return;
      }
      if (event.key === 'Enter' && event.ctrlKey && session.selected.size > 0 && !session.binMode) {
        event.preventDefault();
        commands.revealSelection();
        return;
      }
      if (event.key === 'Enter' && session.selected.size === 1 && !session.binMode) {
        event.preventDefault();
        commands.activateItem([...session.selected][0]);
        return;
      }
      if (event.key === 'Enter' && session.selected.size > 1 && !session.binMode) {
        event.preventDefault();
        commands.activateSelection();
      }
    }, { signal: abortController.signal });
  }

  function destroy() {
    abortController?.abort();
    abortController = null;
  }

  return { mount, destroy };
}

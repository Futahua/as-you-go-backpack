/** Translates keyboard events into plain command inputs. The controller only
 * reads session state and DOM, then delegates session/persistence/host work
 * to the command layer — it never mutates document or session state itself. */
/** True when the event came from a text field, where a bare letter shortcut
 * must not steal the keystroke. */
function isTypingTarget(target) {
  return Boolean(target?.closest?.('input, textarea, [contenteditable="true"]'));
}

export function createKeyboardController({
  document,
  elements,
  store,
  commands,
  closeMenu,
  getVisibleItemIds,
  confirmDialog,
  beginSetMembershipEdit,
  setMembershipMode,
}) {
  let abortController = null;

  function mount() {
    abortController = new AbortController();
    document.addEventListener('keydown', (event) => {
      // Any modal layer (including the prompt library) takes over keyboard
      // handling. While the prompt library is open the tree controller owns
      // tree shortcuts and editable controls keep native text behavior.
      if (!elements.editorLayer.hidden || !elements.confirmLayer.hidden
        || !elements.linkEditLayer.hidden || !elements.promptLayer.hidden) return;
      const session = store.getSession();
      const key = event.key.toLowerCase();

      // In Bin mode, cut/copy/paste must not reach the host's clipboard.
      if (session.binMode && event.ctrlKey && ['c', 'x', 'v'].includes(key)) {
        event.preventDefault();
        return;
      }
      // The set membership picker owns Escape and Enter while it is open, so
      // cancelling it does not also clear the selection it is editing.
      if (setMembershipMode?.isActive()) {
        if (event.key === 'Escape') {
          event.preventDefault();
          setMembershipMode.cancel();
          return;
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          void setMembershipMode.confirm();
          return;
        }
      }
      if (event.key === 'Escape') {
        // Close the menu before clearing/syncing/saving, matching the
        // original handler's sequence.
        closeMenu();
        commands.clearSelection();
        return;
      }
      // Ctrl+G edits which sets the selection belongs to; G alone groups it
      // into a new set. Both are checked before the bare-key shortcuts below
      // so the Ctrl form is never mistaken for the plain one.
      if (key === 'g') {
        if (isTypingTarget(event.target)) return;
        event.preventDefault();
        if (event.ctrlKey || event.metaKey) beginSetMembershipEdit?.();
        else void commands.groupSelectionIntoSet();
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

import { HOTKEY_CATALOG, bindingMatchesAction } from '../hotkeys-model.js';

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
  // Ctrl+G membership picking. Optional so the controller still mounts in
  // tests and contexts that have no set support.
  beginSetMembershipEdit = () => false,
  setMembershipMode = null,
  setStatus = () => {},
  beginSetRename = () => false,
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
      const editingTarget = event.target?.matches?.('input, textarea, [contenteditable="true"], .set-name-editor')
        || document.activeElement?.matches?.('input, textarea, [contenteditable="true"], .set-name-editor');
      if (editingTarget) return;
      const session = store.getSession();
      const preferences = store.getSnapshot?.()?.view?.preferences?.hotkeys ?? {};
      const matches = (actionId) => bindingMatchesAction(actionId, event, preferences, HOTKEY_CATALOG);

      // In Bin mode, cut/copy/paste must not reach the host's clipboard.
      if (session.binMode && (
        matches('workspace.copy') || matches('workspace.cut') || matches('workspace.paste')
      )) {
        event.preventDefault();
        return;
      }
      if (matches('workspace.escape')) {
        // Close the menu before clearing/syncing/saving, matching the
        // original handler's sequence.
        closeMenu();
        // A live set selection is dismissed first and on its own. Clearing
        // both at once would make one Escape undo two different things.
        if (setMembershipMode?.isActive()) {
          setMembershipMode.cancel();
          return;
        }
        if (session.selectedSets.size > 0) {
          commands.clearSetSelection();
          return;
        }
        commands.clearSelection();
        return;
      }
      // Plain G groups. No modifier, so it must not fire while the user is
      // typing — the guard above already returned for editable layers.
      if (matches('workspace.group-selection')) {
        event.preventDefault();
        void commands.groupSelectionIntoSet();
        return;
      }
      if (matches('sets.rename-selected')) {
        event.preventDefault();
        beginSetRename();
        return;
      }
      if (matches('workspace.edit-set-membership')) {
        event.preventDefault();
        if (!beginSetMembershipEdit()) {
          setStatus('Select items first, then press Ctrl+G to change their sets.');
        }
        return;
      }
      if (setMembershipMode?.isActive() && matches('workspace.open-selection')) {
        event.preventDefault();
        void setMembershipMode.confirm();
        return;
      }
      if (matches('workspace.select-all')) {
        event.preventDefault();
        commands.selectAllVisible(getVisibleItemIds());
        return;
      }
      if (matches('workspace.copy')) {
        event.preventDefault();
        commands.copySelection();
        return;
      }
      if (matches('workspace.cut')) {
        event.preventDefault();
        commands.cutSelection();
        return;
      }
      if (matches('workspace.paste')) {
        event.preventDefault();
        commands.pasteInto(commands.selectedPasteDestinations());
        return;
      }
      if (matches('workspace.undo')) {
        event.preventDefault();
        commands.undo();
        return;
      }
      if (matches('workspace.redo')) {
        event.preventDefault();
        commands.redo();
        return;
      }
      // Checked before the item branch: with a set selected, Delete removes
      // the grouping and leaves the items alone. Binning a set's contents
      // because a set was selected would be a bad surprise, and the two
      // selections are separate precisely so this choice can be made.
      if (matches('workspace.delete') && session.selectedSets.size > 0) {
        event.preventDefault();
        void commands.deleteSelectedSets();
        return;
      }
      if (matches('workspace.delete') && session.selected.size > 0) {
        event.preventDefault();
        if (session.binMode) confirmDialog.askPermanentDelete();
        else commands.moveSelectionToBin();
        return;
      }
      if (matches('workspace.reveal-selection') && session.selected.size > 0 && !session.binMode) {
        event.preventDefault();
        commands.revealSelection();
        return;
      }
      if (matches('workspace.open-selection') && session.selected.size === 1 && !session.binMode) {
        event.preventDefault();
        commands.activateItem([...session.selected][0]);
        return;
      }
      if (matches('workspace.open-selection') && session.selected.size > 1 && !session.binMode) {
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

/** Owns the "Delete permanently?" / "Restore?" confirmation layer. It holds
 * the pending id lists, shows the correct copy for a single item vs. a batch
 * vs. the whole Bin, and wires the cancel/delete/restore buttons. Committing
 * the destructive action goes through the injected commit() so the dialog
 * never mutates workspace state itself. */
export function createConfirmationDialog({
  elements,
  getState,
  getSelectedIds,
  binItemName,
  permanentlyDelete,
  restoreSelection,
  commit,
}) {
  let pendingPermanentIds = [];
  let pendingRestoreIds = [];
  let abortController = null;

  function askPermanentDelete(ids, deletingAll = false) {
    const targetIds = ids ?? getSelectedIds();
    if (targetIds.length === 0) return;
    pendingPermanentIds = [...targetIds];
    pendingRestoreIds = [];
    elements.confirmTitle.textContent = 'Delete permanently?';
    elements.confirmCopy.textContent = deletingAll
      ? `Delete all ${targetIds.length} items permanently? This cannot be undone.`
      : targetIds.length === 1
        ? `Delete “${binItemName(targetIds[0]) ?? 'this item'}” permanently? This cannot be undone.`
        : `Delete these ${targetIds.length} items permanently? This cannot be undone.`;
    elements.confirmDelete.hidden = false;
    elements.confirmRestore.hidden = true;
    elements.confirmLayer.hidden = false;
  }

  function askRestoreConfirm(ids, restoringAll = false) {
    const targetIds = ids ?? getSelectedIds();
    if (targetIds.length === 0) return;
    pendingRestoreIds = [...targetIds];
    pendingPermanentIds = [];
    elements.confirmTitle.textContent = 'Restore?';
    elements.confirmCopy.textContent = restoringAll
      ? `Restore all ${targetIds.length} items?`
      : targetIds.length === 1
        ? `Restore “${binItemName(targetIds[0]) ?? 'this item'}”?`
        : `Restore these ${targetIds.length} items?`;
    elements.confirmDelete.hidden = true;
    elements.confirmRestore.hidden = false;
    elements.confirmLayer.hidden = false;
  }

  function close() {
    pendingPermanentIds = [];
    pendingRestoreIds = [];
    elements.confirmLayer.hidden = true;
  }

  function mount() {
    abortController = new AbortController();
    const signal = abortController.signal;
    elements.cancelConfirm.addEventListener('click', close, { signal });
    elements.confirmDelete.addEventListener('click', async () => {
      const next = permanentlyDelete(getState(), pendingPermanentIds);
      pendingPermanentIds = [];
      elements.confirmLayer.hidden = true;
      await commit(next, 'Deleted permanently.');
    }, { signal });
    elements.confirmRestore.addEventListener('click', async () => {
      const next = restoreSelection(getState(), pendingRestoreIds);
      pendingRestoreIds = [];
      elements.confirmLayer.hidden = true;
      await commit(next, 'Restored.');
    }, { signal });
  }

  function destroy() {
    abortController?.abort();
    abortController = null;
    pendingPermanentIds = [];
    pendingRestoreIds = [];
  }

  return { askPermanentDelete, askRestoreConfirm, close, mount, destroy };
}

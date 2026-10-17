/** Owns the "Delete permanently?" / "Restore?" confirmation layer. It holds
 * the pending id lists, shows the correct copy for a single item vs. a batch
 * vs. the whole Bin, and wires the cancel/delete/restore buttons. Committing
 * the destructive action goes through the injected commit() so the dialog
 * never mutates workspace state itself. */
export function compactConfirmationPath(path) {
  const parts = String(path ?? '').split(/[\\/]+/).filter(Boolean);
  return parts.length > 3 ? '…/' + parts.slice(-3).join('/') : parts.join('/');
}

export function createConfirmationDialog({
  elements,
  getState,
  getSelectedIds,
  binItemName,
  permanentlyDelete,
  restoreSelection,
  prepareRestore = async state => state,
  commit,
  present = () => {},
}) {
  let pendingPermanentIds = [];
  let pendingRestoreIds = [];
  let abortController = null;
  /** 0B: a generic yes/no question answered through this same layer, so a
   * destructive choice outside the Bin still looks and behaves like every
   * other confirmation. Resolves false if the creator cancels or the layer is
   * closed any other way -- never left hanging. */
  let pendingConfirm = null;
  let confirmLabelBefore = null;

  function restoreConfirmLabel() {
    if (confirmLabelBefore === null) return;
    elements.confirmDelete.textContent = confirmLabelBefore;
    confirmLabelBefore = null;
  }

  function settleConfirm(answer) {
    const resolve = pendingConfirm;
    pendingConfirm = null;
    restoreConfirmLabel();
    if (resolve) resolve(answer);
  }

  function askConfirm({ title, copy, confirmLabel = 'Continue', rows = null }) {
    settleConfirm(false);
    pendingPermanentIds = [];
    pendingRestoreIds = [];
    elements.confirmTitle.textContent = title;
    elements.confirmCopy.textContent = copy;
    if (rows?.length) {
      const d = elements.confirmCopy.ownerDocument;
      const table = d.createElement('table'); table.className = 'confirm-paths';
      const head = table.createTHead().insertRow();
      for (const name of ['AYG', 'Native path']) { const cell=d.createElement('th'); cell.textContent=name; head.append(cell); }
      const body = table.createTBody();
      for (const row of rows) {
        const tr = body.insertRow();
        for (const value of [row.ayg || '—', row.native || '—']) {
          const cell=tr.insertCell(), label=d.createElement('span');
          const text=d.createElement('bdi'); text.dir='ltr'; text.textContent=compactConfirmationPath(value); label.append(text); label.title=value;
          label.tabIndex=0; label.setAttribute('aria-label',value); cell.append(label);
        }
      }
      elements.confirmCopy.prepend(table);
    }
    confirmLabelBefore = elements.confirmDelete.textContent;
    elements.confirmDelete.textContent = confirmLabel;
    elements.confirmDelete.hidden = false;
    elements.confirmRestore.hidden = true;
    present(elements.confirmLayer);
    elements.confirmLayer.hidden = false;
    return new Promise((resolve) => { pendingConfirm = resolve; });
  }

  async function askFileDelete({count,paths,deleteDisk=false}) {
    const question=askConfirm({title:count===1?'Remove this entry?':`Remove ${count} entries?`,copy:paths.join('\n'),confirmLabel:'Remove'});
    const d=elements.confirmCopy.ownerDocument,label=d.createElement('label'),toggle=d.createElement('input');toggle.type='checkbox';toggle.checked=deleteDisk;label.style.cssText='display:flex;gap:8px;align-items:center;margin-top:12px';label.append(toggle,d.createTextNode('Also recycle the actual files on their owning device'));elements.confirmCopy.after(label);
    try{return{confirmed:await question,deleteDisk:toggle.checked};}finally{label.remove();}
  }

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
    present(elements.confirmLayer);
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
    present(elements.confirmLayer);
    elements.confirmLayer.hidden = false;
  }

  function close() {
    settleConfirm(false);
    pendingPermanentIds = [];
    pendingRestoreIds = [];
    elements.confirmLayer.hidden = true;
  }

  function mount() {
    abortController = new AbortController();
    const signal = abortController.signal;
    elements.cancelConfirm.addEventListener('click', close, { signal });
    elements.confirmDelete.addEventListener('click', async () => {
      // A generic question owns the button while it is pending; it must not
      // fall through into a permanent delete.
      if (pendingConfirm) {
        elements.confirmLayer.hidden = true;
        settleConfirm(true);
        return;
      }
      const next = permanentlyDelete(getState(), pendingPermanentIds);
      pendingPermanentIds = [];
      elements.confirmLayer.hidden = true;
      await commit(next, 'Deleted permanently.');
    }, { signal });
    elements.confirmRestore.addEventListener('click', async () => {
      elements.confirmRestore.disabled=true;
      try{const prepared=await prepareRestore(getState(),pendingRestoreIds);const next=restoreSelection(prepared,pendingRestoreIds);await commit(next,'Restored.');pendingRestoreIds=[];elements.confirmLayer.hidden=true;}catch(error){elements.confirmCopy.textContent=error.message||'Restore failed. The entries remain in the Bin.';}finally{elements.confirmRestore.disabled=false;}
    }, { signal });
  }

  function destroy() {
    abortController?.abort();
    abortController = null;
    settleConfirm(false);
    pendingPermanentIds = [];
    pendingRestoreIds = [];
  }

  return { askPermanentDelete, askRestoreConfirm, askConfirm, askFileDelete, close, mount, destroy };
}

import {
  createPromptNode,
  createPromptFolder,
  effectivePromptLibrary,
  findPromptNode,
  updatePromptNode,
  removePromptNode,
  movePromptNodes,
  clonePromptNodesForPaste,
  insertPromptNodes,
  descendantPromptIds,
  buildBatchPromptText,
  validatePromptLibrary,
  selectedRootIds,
  folderBatchState,
  folderBatchFields,
  nextFolderBatchState,
} from '../../prompt-library-model.js';
import {
  createTreeSelection,
  clearSelection,
  repairSelectionAfterCollapse,
  repairSelectionAfterTreeChange,
  visibleDepthFirstIds,
  selectAllVisible,
} from './prompt-tree-selection.js';
import { createPromptTreeController } from './prompt-tree-controller.js';
import { createPromptTreeContextMenu } from './prompt-tree-context-menu.js';
import {
  createPromptLibraryHistory,
  canUndoPromptLibrary,
  canRedoPromptLibrary,
  recordPromptLibraryChange,
  replacePromptLibraryPresent,
  undoPromptLibrary,
  redoPromptLibrary,
  beginPromptLibraryTransaction,
  commitPromptLibraryTransaction,
  cancelPromptLibraryTransaction,
} from './prompt-library-history.js';
import { setPromptLibrary } from '../../workspace-model-20260730b.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Small local SVG icon set for the prompt tree. */
const ICONS = {
  chevron: [{ d: 'M6 8l4 4 4-4' }],
  folder: [
    { d: 'M3 6a1.5 1.5 0 0 1 1.5-1.5h4l1.5 2H16a1 1 0 0 1 1 1v8a1.5 1.5 0 0 1-1.5 1.5H4.5A1.5 1.5 0 0 1 3 15.5V6z' },
  ],
  doc: [
    { d: 'M5 3h6l4 4v10a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 4 17V4.5A1.5 1.5 0 0 1 5.5 3z' },
  ],
};

function createSvg(document, parts, viewBox = '0 0 20 20') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('aria-hidden', 'true');
  for (const part of parts) {
    const element = document.createElementNS(SVG_NS, part.tag || 'path');
    for (const [name, value] of Object.entries(part)) {
      if (name === 'tag') continue;
      element.setAttribute(name, value);
    }
    svg.append(element);
  }
  return svg;
}

function createIconButton(document, { className, label, icon }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.title = label;
  button.setAttribute('aria-label', label);
  button.append(icon);
  return button;
}

/** Panel composition root for the prompt library. Owns opening/closing, the
 * draft tree, expansion/editor/rename/delete-confirm state, rendering, and
 * Save/Cancel. Selection, keyboard, double-click, context menu, and drag
 * interactions are delegated to the prompt-tree controller and context menu,
 * which emit plain intents back into this panel. */
export function createPromptLibraryDialog({
  document,
  store,
  fallbackPrompt,
  copyText,
  setStatus,
}) {
  let abortController = null;
  let history = createPromptLibraryHistory([]);
  let draftLibrary = history.present;
  let expandedFolderIds = new Set();
  let expandedPromptId = null;
  let editingFolderId = null;
  let confirmingDeleteIds = null;
  let treeClipboard = null;
  let cutIds = new Set();
  let activeEditSession = null;
  /** The one place the paste destination lives. `{ type: 'root' }` means the
   * top level, outside every folder; `{ type: 'node', nodeId }` means a row.
   * Derived from selection changes so it can never drift from what is visible;
   * validated against the live tree when a paste resolves. */
  let activeDestination = { type: 'root', nodeId: null };
  let saving = false;

  const icon = (name) => createSvg(document, ICONS[name]);

  const layer = document.querySelector('#prompt-layer');
  const addPromptButton = document.querySelector('#prompt-add-prompt');
  const addFolderButton = document.querySelector('#prompt-add-folder');
  const cardList = document.querySelector('#prompt-card-list');
  // The viewport owns the root pointer surface and scrolling; older markup
  // without the wrapper falls back to the row list itself.
  const viewport = document.querySelector('#prompt-tree-viewport') ?? cardList;
  const error = document.querySelector('#prompt-error');
  const cancelButton = document.querySelector('#prompt-cancel');
  const saveButton = document.querySelector('#prompt-save');
  const copyButton = document.querySelector('#copy-prompt');
  const status = document.querySelector('#prompt-status');
  const deleteConfirm = document.querySelector('#prompt-delete-confirm');
  const deleteMessage = document.querySelector('#prompt-delete-message');
  const deleteOk = document.querySelector('#prompt-delete-ok');
  const deleteCancel = document.querySelector('#prompt-delete-cancel');
  const contextMenu = createPromptTreeContextMenu({
    document,
    menu: document.querySelector('#prompt-tree-menu'),
  });

  function snapshotLibrary() {
    return effectivePromptLibrary(store.getSnapshot().view, fallbackPrompt);
  }

  function getSnapshotLibrary() {
    return snapshotLibrary();
  }

  function getBatchText() {
    return buildBatchPromptText(snapshotLibrary());
  }

  function cloneNode(node) {
    return node.type === 'folder'
      ? { ...node, children: node.children.map(cloneNode) }
      : { ...node };
  }

  // ------------------------------------------------------------------ intents

  const intents = {
    onSelectionChange(selection) {
      // Every selection change — pointer or programmatic — flows through here,
      // so the destination always describes the visible selection.
      const selected = [...selection.selectedIds];
      activeDestination = selected.length === 1
        ? { type: 'node', nodeId: selected[0] }
        : { type: 'root', nodeId: null };
    },

    onToggleFolder(id) {
      if (expandedFolderIds.has(id)) collapseFolder(id);
      else {
        expandedFolderIds.add(id);
        render();
      }
    },
    onExpandFolder(id) {
      expandedFolderIds.add(id);
      render();
    },
    onCollapseFolder(id) {
      collapseFolder(id);
    },
    onTogglePromptEditor(id) {
      commitActiveEditTransaction();
      expandedPromptId = expandedPromptId === id ? null : id;
      render();
      if (expandedPromptId) focusInRow(expandedPromptId, '.prompt-card-title');
    },
    onOpenPrompt(id) {
      commitActiveEditTransaction();
      expandedPromptId = id;
      render();
      focusInRow(id, '.prompt-card-title');
    },
    onCollapsePromptEditor(id) {
      commitActiveEditTransaction();
      if (expandedPromptId === id) expandedPromptId = null;
      render();
    },
    onCopyPrompt(id) {
      const node = findPromptNode(draftLibrary, id);
      if (node && node.type === 'prompt') copyToClipboard(node.text);
    },
    onCopyNodes(ids) {
      copyNodes(ids);
    },
    onCutNodes(ids) {
      cutNodes(ids);
    },
    onPaste() {
      pasteTreeClipboard();
    },
    onDelete(ids) {
      deleteRoots(ids);
    },
    onBeginRename(id) {
      commitActiveEditTransaction();
      editingFolderId = id;
      render();
      focusInRow(id, '.prompt-folder-rename');
    },
    onAddPrompt(parentId) {
      addPrompt(parentId);
    },
    onAddFolder(parentId) {
      addFolder(parentId);
    },
    onMove(ids, destinationParentId, beforeId) {
      commitTreeMutation(
        movePromptNodes(history.present, { nodeIds: ids, destinationParentId, beforeId }),
        'move',
        { onChanged: () => {
          if (destinationParentId && !expandedFolderIds.has(destinationParentId)) {
            expandedFolderIds.add(destinationParentId);
          }
        } },
      );
    },
    onOpenContextMenu(x, y, id) {
      openTreeMenu(x, y, id);
    },
    onOpenRootContextMenu(x, y) {
      openRootMenu(x, y);
    },
    onCloseContextMenu() {
      contextMenu.close();
    },
    onBlankClick() {
      // Root targeting only changes the destination. The internal clipboard is
      // deliberately preserved so copy → click root → paste works.
      activeDestination = { type: 'root', nodeId: null };
      contextMenu.close();
      render();
    },
    onUndo() {
      handleUndo();
    },
    onRedo() {
      handleRedo();
    },
    onEscape() {
      escapePriority();
    },
  };

  const controller = createPromptTreeController({
    document,
    list: cardList,
    viewport,
    // Whole-modal keyboard scope: tree shortcuts must work from the add
    // buttons, Save/Cancel and blank dialog background, not only from a row.
    keyboardTarget: layer,
    getTree: () => draftLibrary,
    getExpandedFolders: () => expandedFolderIds,
    getPromptEditorId: () => expandedPromptId,
    getRenamingFolderId: () => editingFolderId,
    intents,
  });

  function copyToClipboard(text) {
    void copyText(text).then(() => {
      statusMessage('Prompt copied.');
    }).catch((caught) => {
      error.textContent = caught instanceof Error ? caught.message : String(caught);
    });
  }

  /** Prompt-library-local live feedback, always inside the modal. */
  function statusMessage(message) {
    status.textContent = message;
  }

  function copyNodes(ids) {
    const roots = selectedRootIds(draftLibrary, ids);
    if (roots.length === 0) return;
    const nodes = roots
      .map((id) => findPromptNode(draftLibrary, id))
      .filter(Boolean)
      .map(cloneNode);
    // Folders are independent local containers, not synced aliases: copying a
    // folder pastes a separate subtree with new ids, which is expected.
    treeClipboard = { mode: 'copy', nodes };
    cutIds.clear();
    statusMessage(`${nodes.length} ${nodes.length === 1 ? 'item' : 'items'} copied.`);
    render();
  }

  function cutNodes(ids) {
    const roots = selectedRootIds(draftLibrary, ids);
    if (roots.length === 0) return;
    treeClipboard = { mode: 'cut', nodeIds: roots };
    cutIds = new Set(roots);
    statusMessage(`${roots.length} ${roots.length === 1 ? 'item' : 'items'} cut.`);
    render();
  }

  function pasteTreeClipboard() {
    if (!treeClipboard) return;
    const { destinationParentId, beforeId } = resolvePasteDestination();
    let pastedIds = null;
    let ok = false;
    if (treeClipboard.mode === 'copy') {
      const clones = clonePromptNodesForPaste(treeClipboard.nodes);
      pastedIds = clones.map((node) => node.id);
      ok = commitTreeMutation(
        insertPromptNodes(history.present, destinationParentId, beforeId, clones),
        'paste',
        { selectIds: pastedIds },
      );
    } else {
      pastedIds = treeClipboard.nodeIds;
      ok = commitTreeMutation(
        movePromptNodes(history.present, { nodeIds: treeClipboard.nodeIds, destinationParentId, beforeId }),
        'paste',
        {
          selectIds: pastedIds,
          onChanged: () => {
            treeClipboard = null;
            cutIds.clear();
          },
        },
      );
    }
    if (ok) {
      if (destinationParentId && !expandedFolderIds.has(destinationParentId)) {
        expandedFolderIds.add(destinationParentId);
      }
      statusMessage(`${pastedIds.length} ${pastedIds.length === 1 ? 'item' : 'items'} pasted.`);
    } else {
      statusMessage('This folder cannot be moved inside itself.');
    }
  }

  function selectOnlyPaste(ids) {
    const first = ids[0] ?? null;
    return { selectedIds: new Set(ids), anchorId: first, focusedId: first };
  }

  // ----------------------------------------------------- draft history

  /** Ends the active text-editing transaction, producing at most one undo entry
   * for the whole editing session. */
  function commitActiveEditTransaction() {
    if (history.transaction) {
      history = commitPromptLibraryTransaction(history, history.present);
    }
    activeEditSession = null;
    draftLibrary = history.present;
  }

  /** Structural cleanup after a history tree change: close the context menu,
   * cancel delete confirmation and drag, drop invalid editor/rename/expansion
   * state, repair the cut clipboard, repair selection, and render once. */
  function afterHistoryTreeChange({ repairSelection = true } = {}) {
    contextMenu.close();
    confirmingDeleteIds = null;
    controller.cancelDrag();
    if (expandedPromptId && !findPromptNode(draftLibrary, expandedPromptId)) {
      expandedPromptId = null;
    }
    if (editingFolderId && !findPromptNode(draftLibrary, editingFolderId)) {
      editingFolderId = null;
    }
    for (const id of [...expandedFolderIds]) {
      const node = findPromptNode(draftLibrary, id);
      if (!node || node.type !== 'folder') expandedFolderIds.delete(id);
    }
    if (treeClipboard?.mode === 'cut') {
      const valid = treeClipboard.nodeIds.filter((id) => findPromptNode(draftLibrary, id));
      if (valid.length === 0) {
        treeClipboard = null;
        cutIds.clear();
      } else {
        treeClipboard = { ...treeClipboard, nodeIds: valid };
        cutIds = new Set(valid);
      }
    }
    if (repairSelection) {
      const visible = visibleDepthFirstIds(draftLibrary, expandedFolderIds);
      controller.setSelection(repairSelectionAfterTreeChange(controller.getSelection(), visible));
    }
    render();
  }

  /** Routes a completed draft-data mutation through the local history: commits
   * any active edit transaction, records one undo entry (no entry when the
   * mutator returned the same tree), and re-renders. Returns whether a change
   * happened. `selectIds` optionally selects the resulting roots. */
  function commitTreeMutation(nextTree, metadata, { selectIds = null, onChanged = null } = {}) {
    commitActiveEditTransaction();
    if (nextTree === history.present) return false;
    history = recordPromptLibraryChange(history, nextTree, metadata);
    draftLibrary = history.present;
    if (onChanged) onChanged();
    if (selectIds) controller.setSelection(selectOnlyPaste(selectIds));
    afterHistoryTreeChange({ repairSelection: !selectIds });
    return true;
  }

  /** Applies an editable-field input within one editing session transaction:
   * the first input of a session records the pre-edit baseline; subsequent
   * inputs replace present without creating separate history entries. */
  function applyEditInput(ownerId, updater) {
    if (activeEditSession !== ownerId) {
      commitActiveEditTransaction();
      history = beginPromptLibraryTransaction(history, 'edit');
      activeEditSession = ownerId;
    }
    const next = updater(history.present);
    history = replacePromptLibraryPresent(history, next);
    draftLibrary = history.present;
  }

  function handleUndo() {
    commitActiveEditTransaction();
    if (!canUndoPromptLibrary(history)) {
      statusMessage('Nothing to undo.');
      return;
    }
    const label = history.lastLabel;
    history = undoPromptLibrary(history);
    draftLibrary = history.present;
    statusMessage(`Undid ${label ?? 'change'}.`);
    afterHistoryTreeChange();
  }

  function handleRedo() {
    commitActiveEditTransaction();
    if (!canRedoPromptLibrary(history)) {
      statusMessage('Nothing to redo.');
      return;
    }
    const label = history.lastLabel;
    history = redoPromptLibrary(history);
    draftLibrary = history.present;
    statusMessage(`Redid ${label ?? 'change'}.`);
    afterHistoryTreeChange();
  }

  /** Resolves where a paste should land: an explicit root destination first,
   * otherwise exactly one selected folder (inside), otherwise one selected
   * non-folder row (after it), otherwise root. */
  function resolvePasteDestination() {
    const ROOT = { destinationParentId: null, beforeId: null };
    if (activeDestination.type !== 'node') return ROOT;
    const { nodeId } = activeDestination;
    // A destination row that no longer exists (deleted, or undone away) falls
    // back to root rather than resolving against stale DOM.
    const node = findPromptNode(draftLibrary, nodeId);
    if (!node) return ROOT;
    if (node.type === 'folder') return { destinationParentId: nodeId, beforeId: null };
    const row = rowForId(nodeId);
    return { destinationParentId: row?.dataset.parentId || null, beforeId: row?.dataset.nextId || null };
  }

  function collapseFolder(id) {
    commitActiveEditTransaction();
    expandedFolderIds.delete(id);
    const visible = visibleDepthFirstIds(draftLibrary, expandedFolderIds);
    controller.setSelection(repairSelectionAfterCollapse(controller.getSelection(), id, visible));
    render();
  }

  function escapePriority() {
    if (contextMenu.isOpen) {
      contextMenu.close();
      return;
    }
    if (editingFolderId) {
      editingFolderId = null;
      activeEditSession = null;
      render();
      return;
    }
    if (expandedPromptId) {
      commitActiveEditTransaction();
      expandedPromptId = null;
      render();
      return;
    }
    controller.cancelDrag();
    controller.setSelection(clearSelection());
  }

  // --------------------------------------------------------------- rendering

  function render() {
    cardList.textContent = '';
    cardList.append(renderNodes(draftLibrary, null, 0));
    controller.refreshRowStates();
    for (const row of rows()) {
      row.classList.toggle('prompt-cut', cutIds.has(row.dataset.nodeId));
    }
    viewport.classList.toggle('prompt-root-target', activeDestination.type === 'root');
    renderDeleteConfirm();
  }

  /** `inherited` is the nearest ancestor folder override ('include',
   * 'exclude', or 'neutral'). Rows under a non-neutral ancestor render greyed
   * out, because their own checkbox no longer decides anything. */
  function renderNodes(nodes, parentId, depth, inherited = 'neutral') {
    const fragment = document.createDocumentFragment();
    nodes.forEach((node, index) => {
      const nextId = nodes[index + 1]?.id ?? null;
      fragment.append(node.type === 'folder'
        ? createFolderElement(node, parentId, depth, nextId, inherited)
        : createPromptElement(node, parentId, depth, nextId, inherited));
    });
    return fragment;
  }

  /** Marks a row as governed by an ancestor folder override, so its own
   * checkbox reads as overridden (green under include, red under exclude)
   * rather than as the thing deciding inclusion. */
  function applyInheritedBatch(row, inherited) {
    if (inherited !== 'include' && inherited !== 'exclude') return;
    row.classList.add('prompt-batch-forced', `prompt-batch-${inherited}`);
    row.dataset.batchForced = inherited;
  }

  function setRowMeta(row, node, parentId, depth, nextId) {
    row.dataset.nodeId = node.id;
    row.dataset.nodeType = node.type;
    row.dataset.parentId = parentId ?? '';
    row.dataset.nextId = nextId ?? '';
    row.style.setProperty('--prompt-depth', String(depth));
  }

  function createPromptElement(node, parentId, depth, nextId, inherited = 'neutral') {
    const expanded = node.id === expandedPromptId;
    const fragment = document.createDocumentFragment();
    const row = document.createElement('div');
    row.className = 'prompt-tree-row prompt-prompt-row';
    applyInheritedBatch(row, inherited);
    setRowMeta(row, node, parentId, depth, nextId);
    row.setAttribute('role', 'treeitem');
    row.setAttribute('aria-level', String(depth + 1));
    row.setAttribute('aria-expanded', String(expanded));
    row.classList.toggle('prompt-row-expanded', expanded);

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'prompt-checkbox';
    checkbox.setAttribute('aria-label', `Include ${node.title} in batch`);
    checkbox.checked = node.includeInBatch === true;

    const iconSpan = document.createElement('span');
    iconSpan.className = 'prompt-row-icon';
    iconSpan.setAttribute('aria-hidden', 'true');
    iconSpan.append(icon('doc'));

    if (expanded) {
      const titleInput = document.createElement('input');
      titleInput.className = 'prompt-card-title';
      titleInput.setAttribute('aria-label', 'Prompt title');
      titleInput.value = node.title;
      const chevronBtn = createIconButton(document, { className: 'prompt-card-toggle', label: 'Collapse prompt', icon: icon('chevron') });
      chevronBtn.setAttribute('aria-expanded', 'true');
      row.append(checkbox, iconSpan, titleInput, chevronBtn);

      const details = document.createElement('div');
      details.className = 'prompt-card-details';
      details.dataset.nodeId = node.id;
      const textarea = document.createElement('textarea');
      textarea.className = 'prompt-card-text';
      textarea.setAttribute('aria-label', 'Prompt text');
      textarea.value = node.text;
      details.append(textarea);
      fragment.append(row, details);
      return fragment;
    }

    const titleSpan = document.createElement('span');
    titleSpan.className = 'prompt-prompt-title';
    titleSpan.textContent = node.title;
    const chevronBtn = createIconButton(document, { className: 'prompt-card-toggle', label: 'Expand prompt', icon: icon('chevron') });
    chevronBtn.setAttribute('aria-expanded', 'false');
    row.append(checkbox, iconSpan, titleSpan, chevronBtn);
    fragment.append(row);
    return fragment;
  }

  function createFolderElement(node, parentId, depth, nextId, inherited = 'neutral') {
    const expanded = expandedFolderIds.has(node.id);
    const renaming = editingFolderId === node.id;
    const fragment = document.createDocumentFragment();
    const row = document.createElement('div');
    row.className = 'prompt-tree-row prompt-folder-row';
    applyInheritedBatch(row, inherited);
    setRowMeta(row, node, parentId, depth, nextId);
    row.setAttribute('role', 'treeitem');
    row.setAttribute('aria-level', String(depth + 1));
    row.setAttribute('aria-expanded', String(expanded));

    // Three-state folder override. A native checkbox has no "excluded" state,
    // so exclude renders as an indeterminate box styled red with a minus.
    const state = folderBatchState(node);
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'prompt-checkbox prompt-folder-checkbox';
    checkbox.dataset.batchState = state;
    checkbox.setAttribute('aria-label', state === 'exclude'
      ? `Exclude every prompt inside ${node.title}`
      : `Include every prompt inside ${node.title}`);
    checkbox.checked = state === 'include';
    checkbox.indeterminate = state === 'exclude';

    const chevronBtn = document.createElement('button');
    chevronBtn.type = 'button';
    chevronBtn.className = 'prompt-folder-toggle';
    chevronBtn.setAttribute('aria-expanded', String(expanded));
    const chevronSpan = document.createElement('span');
    chevronSpan.className = 'prompt-folder-chevron';
    chevronSpan.append(icon('chevron'));
    chevronBtn.append(chevronSpan);

    const iconSpan = document.createElement('span');
    iconSpan.className = 'prompt-folder-icon';
    iconSpan.setAttribute('aria-hidden', 'true');
    iconSpan.append(icon('folder'));

    let titleControl;
    if (renaming) {
      titleControl = document.createElement('input');
      titleControl.className = 'prompt-folder-rename';
      titleControl.setAttribute('aria-label', 'Folder title');
      titleControl.value = node.title;
    } else {
      titleControl = document.createElement('span');
      titleControl.className = 'prompt-folder-title';
      titleControl.textContent = node.title;
    }

    row.append(checkbox, chevronBtn, iconSpan, titleControl);
    fragment.append(row);

    if (expanded) {
      const children = document.createElement('div');
      children.className = 'prompt-tree-children';
      children.setAttribute('role', 'group');
      children.style.setProperty('--prompt-depth', String(depth + 1));
      // The nearest override wins: a neutral folder passes its ancestor's
      // state through, a non-neutral one replaces it for everything below.
      children.append(renderNodes(
        node.children, node.id, depth + 1,
        state === 'neutral' ? inherited : state,
      ));
      fragment.append(children);
    }
    return fragment;
  }

  function rows() {
    return cardList.querySelectorAll('.prompt-tree-row');
  }

  function rowForId(id) {
    for (const row of rows()) {
      if (row.dataset.nodeId === id) return row;
    }
    return null;
  }

  function detailsForId(id) {
    for (const details of cardList.querySelectorAll('.prompt-card-details')) {
      if (details.dataset.nodeId === id) return details;
    }
    return null;
  }

  function focusInRow(id, selector) {
    rowForId(id)?.querySelector(selector)?.focus();
  }

  function renderDeleteConfirm() {
    if (!confirmingDeleteIds) {
      deleteConfirm.hidden = true;
      return;
    }
    const count = promptsInRoots(confirmingDeleteIds);
    if (confirmingDeleteIds.length === 1) {
      const node = findPromptNode(draftLibrary, confirmingDeleteIds[0]);
      if (node?.type === 'folder') {
        deleteMessage.textContent = count === 1
          ? 'Delete folder and its contained prompt?'
          : `Delete folder and ${count} contained prompts?`;
      } else {
        deleteMessage.textContent = 'Delete this prompt?';
      }
    } else {
      deleteMessage.textContent = `Delete ${confirmingDeleteIds.length} items and ${count} contained prompts?`;
    }
    deleteConfirm.hidden = false;
  }

  function promptsInRoots(ids) {
    let count = 0;
    for (const id of ids) {
      const node = findPromptNode(draftLibrary, id);
      if (!node) continue;
      count += node.type === 'prompt' ? 1 : descendantPromptIds(draftLibrary, id).length;
    }
    return count;
  }

  // ------------------------------------------------------------- draft safety

  /** Resolves the owning prompt node id for a focused control; the prompt
   * textarea lives in the details element, a sibling of the row. */
  function ownerNodeId(target) {
    const details = target.closest('.prompt-card-details');
    if (details?.dataset.nodeId) return details.dataset.nodeId;
    const row = target.closest('.prompt-tree-row');
    return row?.dataset.nodeId ?? null;
  }

  function onTreeInput(event) {
    if (event.target.classList.contains('prompt-folder-rename')) {
      const id = ownerNodeId(event.target);
      if (!id) return;
      applyEditInput(id, (nodes) => updatePromptNode(nodes, id, (node) => ({ ...node, title: event.target.value })));
      return;
    }
    const id = ownerNodeId(event.target);
    if (!id) return;
    if (event.target.classList.contains('prompt-card-title')) {
      applyEditInput(id, (nodes) => updatePromptNode(nodes, id, (node) => ({ ...node, title: event.target.value })));
    } else if (event.target.classList.contains('prompt-card-text')) {
      applyEditInput(id, (nodes) => updatePromptNode(nodes, id, (node) => ({ ...node, text: event.target.value })));
    }
  }

  /** Anchor for Shift+click checkbox ranges, and the modifier state captured
   * on click — `change` events do not carry shiftKey. */
  let checkboxAnchorId = null;
  let pendingCheckboxShift = false;

  function onCheckboxClick(event) {
    const checkbox = event.target.closest('.prompt-checkbox');
    if (!checkbox) return;
    pendingCheckboxShift = event.shiftKey === true;

    // A folder's override has three states, which a native checkbox cannot
    // express on its own, so folders cycle here and never reach the change
    // handler. Bulk and range gestures still apply the two-state value.
    const row = checkbox.closest('.prompt-tree-row');
    const id = row?.dataset.nodeId;
    if (!id || row.dataset.nodeType !== 'folder') return;
    const selected = [...controller.getSelection().selectedIds];
    const bulk = selected.length > 1 && selected.includes(id);
    if (bulk || (pendingCheckboxShift && checkboxAnchorId && checkboxAnchorId !== id)) return;
    event.preventDefault();
    checkboxAnchorId = id;
    cycleFolderBatch(id);
  }

  /** Applies one checked value to many rows as a single undo entry. Prompts get
   * `includeInBatch`, folders get the `includeAll` override. */
  function setCheckedFor(ids, checked) {
    if (ids.length === 0) return;
    const next = ids.reduce(
      (tree, id) => updatePromptNode(tree, id, (node) => (
        node.type === 'folder'
          ? { ...node, ...folderBatchFields(checked ? 'include' : 'neutral') }
          : { ...node, includeInBatch: checked }
      )),
      history.present,
    );
    commitTreeMutation(next, checked ? 'include' : 'exclude');
  }

  /** Advances one folder through neutral → include → exclude → neutral. */
  function cycleFolderBatch(id) {
    const node = findPromptNode(draftLibrary, id);
    if (node?.type !== 'folder') return;
    const state = nextFolderBatchState(folderBatchState(node));
    commitTreeMutation(
      updatePromptNode(history.present, id, (folder) => ({ ...folder, ...folderBatchFields(state) })),
      state === 'exclude' ? 'exclude' : 'include',
    );
  }

  function onCheckboxChange(event) {
    const row = event.target.closest('.prompt-tree-row');
    if (!row) return;
    const id = row.dataset.nodeId;
    if (!id) return;
    const checked = event.target.checked;
    const shift = pendingCheckboxShift;
    pendingCheckboxShift = false;

    // Shift+click a checkbox: apply this box's resulting state to the whole
    // visible range between the last-clicked checkbox and this one. Checkbox
    // clicks never alter row selection, so this cannot collide with the
    // Shift+click row-range gesture.
    if (shift && checkboxAnchorId && checkboxAnchorId !== id) {
      const visible = visibleDepthFirstIds(draftLibrary, expandedFolderIds);
      const from = visible.indexOf(checkboxAnchorId);
      const to = visible.indexOf(id);
      if (from !== -1 && to !== -1) {
        const range = visible.slice(Math.min(from, to), Math.max(from, to) + 1);
        setCheckedFor(range, checked);
        checkboxAnchorId = id;
        return;
      }
    }
    checkboxAnchorId = id;

    // Clicking the checkbox of a row inside a multi-row selection applies the
    // clicked value to every selected row. Clicking a row outside the selection
    // touches only that row and leaves the selection alone.
    const selected = [...controller.getSelection().selectedIds];
    if (selected.length > 1 && selected.includes(id)) {
      setCheckedFor(selected, checked);
      return;
    }
    setCheckedFor([id], checked);
  }

  // ------------------------------------------------------------- delete

  function countPromptsAfterRemoving(ids) {
    const removed = new Set(ids);
    let count = 0;
    const walk = (list) => {
      for (const node of list) {
        if (removed.has(node.id)) continue;
        if (node.type === 'prompt') count += 1;
        else walk(node.children);
      }
    };
    walk(draftLibrary);
    return count;
  }

  function needsDeleteConfirm(roots) {
    if (roots.length > 1) return true;
    const node = findPromptNode(draftLibrary, roots[0]);
    return node?.type === 'folder' && descendantPromptIds(draftLibrary, roots[0]).length > 0;
  }

  function deleteRoots(ids) {
    const list = ids.filter((id) => findPromptNode(draftLibrary, id));
    if (list.length === 0) return;
    if (countPromptsAfterRemoving(list) === 0) {
      error.textContent = 'Keep at least one prompt.';
      return;
    }
    if (needsDeleteConfirm(list)) {
      confirmingDeleteIds = list;
      render();
      return;
    }
    applyDelete(list);
  }

  function applyDelete(ids) {
    const next = ids.reduce(
      (tree, id) => removePromptNode(tree, id),
      history.present,
    );
    for (const id of ids) expandedFolderIds.delete(id);
    if (expandedPromptId && ids.includes(expandedPromptId)) expandedPromptId = null;
    commitTreeMutation(next, 'delete');
  }

  function onDeleteOk() {
    if (!confirmingDeleteIds) return;
    if (countPromptsAfterRemoving(confirmingDeleteIds) === 0) {
      confirmingDeleteIds = null;
      error.textContent = 'Keep at least one prompt.';
      render();
      return;
    }
    applyDelete(confirmingDeleteIds);
  }

  function onDeleteCancel() {
    confirmingDeleteIds = null;
    render();
  }

  // -------------------------------------------------------------- add

  function addPromptFromHeader() {
    const selected = [...controller.getSelection().selectedIds];
    let parentId = null;
    if (selected.length === 1) {
      const node = findPromptNode(draftLibrary, selected[0]);
      if (node?.type === 'folder') parentId = selected[0];
    }
    addPrompt(parentId);
  }

  function addPrompt(parentId) {
    const added = createPromptNode();
    const next = parentId == null
      ? [...history.present, added]
      : updatePromptNode(history.present, parentId, (folder) => ({
          ...folder,
          children: [...folder.children, added],
        }));
    expandedPromptId = added.id;
    if (parentId) expandedFolderIds.add(parentId);
    commitTreeMutation(next, 'add prompt', { selectIds: [added.id] });
    focusInRow(added.id, '.prompt-card-title');
  }

  function addFolder(parentId) {
    const added = createPromptFolder();
    const next = parentId == null
      ? [...history.present, added]
      : updatePromptNode(history.present, parentId, (folder) => ({
          ...folder,
          children: [...folder.children, added],
        }));
    expandedFolderIds.add(added.id);
    if (parentId) expandedFolderIds.add(parentId);
    editingFolderId = added.id;
    commitTreeMutation(next, 'add folder', { selectIds: [added.id] });
    focusInRow(added.id, '.prompt-folder-rename');
  }

  // -------------------------------------------------------------- rename

  function commitFolderRename() {
    commitActiveEditTransaction();
    editingFolderId = null;
    render();
  }

  function onRenameKeydown(event) {
    const input = event.target.closest('.prompt-folder-rename');
    if (!input) return;
    const id = input.closest('.prompt-tree-row')?.dataset.nodeId;
    if (!id) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      commitFolderRename();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (history.transaction) {
        history = cancelPromptLibraryTransaction(history);
      }
      editingFolderId = null;
      activeEditSession = null;
      draftLibrary = history.present;
      render();
    }
  }

  function onRenameFocusout(event) {
    const input = event.target.closest('.prompt-folder-rename');
    if (!input) return;
    const id = input.closest('.prompt-tree-row')?.dataset.nodeId;
    if (!id || editingFolderId !== id) return;
    commitFolderRename();
  }

  // ---------------------------------------------------------- context menu

  function openTreeMenu(x, y, id) {
    const node = findPromptNode(draftLibrary, id);
    if (!node) return;
    const multi = controller.getSelection().selectedIds.size > 1;
    const items = buildMenuItems(id, node, multi);
    contextMenu.open({
      x,
      y,
      items,
      onAction: (action) => handleMenuAction(action, id, multi),
    });
  }

  /** Root context menu for blank tree space: paste at top level, new prompt,
   * new folder, and select all. Targets the root as the paste destination. */
  function openRootMenu(x, y) {
    activeDestination = { type: 'root', nodeId: null };
    // Reflect the root target before the menu opens, so the highlight matches
    // where a "Paste at top level" would actually land.
    render();
    const items = [];
    if (treeClipboard) items.push({ id: 'paste-root', label: 'Paste at top level' });
    items.push(
      { id: 'new-prompt', label: 'New prompt' },
      { id: 'new-folder', label: 'New folder' },
      { id: 'select-all', label: 'Select all' },
    );
    contextMenu.open({
      x,
      y,
      items,
      onAction: (action) => {
        if (action === 'new-prompt') addPrompt(null);
        else if (action === 'new-folder') addFolder(null);
        else handleMenuAction(action, null, false);
      },
    });
  }

  function buildMenuItems(id, node, multi) {
    const hasClipboard = treeClipboard != null;
    if (multi) {
      const items = [
        { id: 'copy-items', label: 'Copy items' },
        { id: 'cut-items', label: 'Cut items' },
      ];
      if (hasClipboard) items.push({ id: 'paste', label: 'Paste' });
      items.push(
        { id: 'include', label: 'Include in batch' },
        { id: 'exclude', label: 'Exclude from batch' },
        { id: 'delete', label: 'Delete' },
      );
      return items;
    }
    if (node.type === 'folder') {
      const expanded = expandedFolderIds.has(id);
      const items = [
        { id: 'expand-toggle', label: expanded ? 'Collapse' : 'Expand' },
        { id: 'rename', label: 'Rename' },
        { id: 'copy-items', label: 'Copy item' },
        { id: 'cut-items', label: 'Cut item' },
      ];
      if (hasClipboard) items.push({ id: 'paste', label: 'Paste inside' });
      items.push(
        ...folderBatchMenuItems(node),
        { id: 'new-prompt-inside', label: 'New prompt inside' },
        { id: 'new-folder-inside', label: 'New folder inside' },
        { id: 'delete', label: 'Delete' },
      );
      return items;
    }
    const items = [
      { id: 'edit', label: 'Open / Edit' },
      { id: 'copy-text', label: 'Copy prompt text' },
      { id: 'copy-items', label: 'Copy item' },
      { id: 'cut-items', label: 'Cut item' },
    ];
    if (hasClipboard) items.push({ id: 'paste', label: 'Paste after' });
    items.push(
      { id: node.includeInBatch ? 'exclude' : 'include', label: node.includeInBatch ? 'Exclude from batch' : 'Include in batch' },
      { id: 'delete', label: 'Delete' },
    );
    return items;
  }

  /** The two folder-override states other than the current one, so the menu
   * always offers a way into each of the three. */
  function folderBatchMenuItems(node) {
    const state = folderBatchState(node);
    const items = [];
    if (state !== 'include') items.push({ id: 'folder-include', label: 'Include everything inside' });
    if (state !== 'exclude') items.push({ id: 'folder-exclude', label: 'Exclude everything inside' });
    if (state !== 'neutral') items.push({ id: 'folder-neutral', label: 'Use child selections' });
    return items;
  }

  function handleMenuAction(action, id, multi) {
    if (action === 'paste-root') {
      activeDestination = { type: 'root', nodeId: null };
      pasteTreeClipboard();
      return;
    }
    if (action === 'select-all') {
      const visible = visibleDepthFirstIds(draftLibrary, expandedFolderIds);
      controller.setSelection(selectAllVisible(controller.getSelection(), visible));
      return;
    }
    const ids = multi ? [...controller.getSelection().selectedIds] : [id];
    if (action === 'edit') intents.onOpenPrompt(id);
    else if (action === 'copy-text') intents.onCopyPrompt(id);
    else if (action === 'copy-items') copyNodes(ids);
    else if (action === 'cut-items') cutNodes(ids);
    else if (action === 'paste') pasteTreeClipboard();
    else if (action === 'expand-toggle') intents.onToggleFolder(id);
    else if (action === 'rename') intents.onBeginRename(id);
    else if (action === 'include') setBatchIncludedFor(ids, true);
    else if (action === 'exclude') setBatchIncludedFor(ids, false);
    else if (action === 'folder-include') setBatchIncludedFor(ids, true, 'include');
    else if (action === 'folder-exclude') setBatchIncludedFor(ids, false, 'exclude');
    else if (action === 'folder-neutral') setBatchIncludedFor(ids, false, 'neutral');
    else if (action === 'new-prompt-inside') addPrompt(id);
    else if (action === 'new-folder-inside') addFolder(id);
    else if (action === 'delete') deleteRoots(ids);
  }

  /** Menu include/exclude. Folders take an explicit three-state value so
   * "Use child selections" clears both override flags rather than leaving a
   * folder stranded in exclude. */
  function setBatchIncludedFor(ids, included, folderState = null) {
    const state = folderState ?? (included ? 'include' : 'neutral');
    const next = ids.reduce(
      (tree, id) => updatePromptNode(tree, id, (node) => (
        node.type === 'prompt'
          ? { ...node, includeInBatch: included }
          : { ...node, ...folderBatchFields(state) }
      )),
      history.present,
    );
    commitTreeMutation(next, included ? 'include' : 'exclude');
  }

  // ------------------------------------------------------------------ open

  function open(options = {}) {
    history = createPromptLibraryHistory(snapshotLibrary().map(cloneNode));
    draftLibrary = history.present;
    expandedFolderIds = new Set();
    for (const node of draftLibrary) {
      if (node.type === 'folder') expandedFolderIds.add(node.id);
    }
    expandedPromptId = null;
    editingFolderId = null;
    confirmingDeleteIds = null;
    treeClipboard = null;
    cutIds.clear();
    activeEditSession = null;
    activeDestination = { type: 'root', nodeId: null };
    contextMenu.close();
    controller.setSelection(createTreeSelection());
    error.textContent = options.message || '';
    status.textContent = '';
    render();
    layer.hidden = false;
    // Never leave focus on document.body: with nothing selected, root is the
    // active destination and owns the keyboard.
    controller.focusRoot();
  }

  function close() {
    contextMenu.close();
    treeClipboard = null;
    cutIds.clear();
    activeEditSession = null;
    status.textContent = '';
    layer.hidden = true;
    error.textContent = '';
  }

  // ------------------------------------------------------------------- save

  async function onSave() {
    if (saving) return;
    commitActiveEditTransaction();
    const validationError = validatePromptLibrary(history.present);
    if (validationError) {
      error.textContent = validationError;
      return;
    }
    saving = true;
    saveButton.disabled = true;
    try {
      const next = setPromptLibrary(store.getSnapshot(), history.present);
      store.replace(next);
      await store.save(next);
      close();
    } catch (caught) {
      error.textContent = caught instanceof Error ? caught.message : String(caught);
    } finally {
      saving = false;
      saveButton.disabled = false;
    }
  }

  function onCancel() {
    close();
  }

  // ------------------------------------------------------------------ mount

  function mount() {
    abortController = new AbortController();
    const signal = abortController.signal;
    contextMenu.mount();
    controller.mount();
    copyButton.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      open();
    }, { signal });
    addPromptButton.addEventListener('click', addPromptFromHeader, { signal });
    addFolderButton.addEventListener('click', () => addFolder(null), { signal });
    deleteOk.addEventListener('click', onDeleteOk, { signal });
    deleteCancel.addEventListener('click', onDeleteCancel, { signal });
    cancelButton.addEventListener('click', onCancel, { signal });
    saveButton.addEventListener('click', () => onSave(), { signal });
    cardList.addEventListener('input', onTreeInput, { signal });
    // click runs before change and is the only place shiftKey is visible.
    cardList.addEventListener('click', onCheckboxClick, { signal });
    cardList.addEventListener('change', onCheckboxChange, { signal });
    cardList.addEventListener('keydown', onRenameKeydown, { signal });
    cardList.addEventListener('focusout', onRenameFocusout, { signal });
  }

  function destroy() {
    abortController?.abort();
    abortController = null;
    controller.destroy();
    contextMenu.destroy();
  }

  return { mount, destroy, open, close, getBatchText, getSnapshotLibrary };
}

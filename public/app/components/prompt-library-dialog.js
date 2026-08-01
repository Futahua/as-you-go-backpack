import {
  createPromptNode,
  createPromptFolder,
  effectivePromptLibrary,
  findPromptNode,
  updatePromptNode,
  removePromptNode,
  movePromptNodes,
  descendantPromptIds,
  collectPromptsFromSelectedRoots,
  buildBatchPromptText,
  validatePromptLibrary,
} from '../../prompt-library-model.js';
import {
  createTreeSelection,
  clearSelection,
  repairSelectionAfterCollapse,
  repairSelectionAfterTreeChange,
  visibleDepthFirstIds,
} from './prompt-tree-selection.js';
import { createPromptTreeController } from './prompt-tree-controller.js';
import { createPromptTreeContextMenu } from './prompt-tree-context-menu.js';
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
  let draftLibrary = [];
  let expandedFolderIds = new Set();
  let expandedPromptId = null;
  let editingFolderId = null;
  let confirmingDeleteIds = null;
  let saving = false;

  const icon = (name) => createSvg(document, ICONS[name]);

  const layer = document.querySelector('#prompt-layer');
  const addButton = document.querySelector('#prompt-add');
  const addMenu = document.querySelector('#prompt-add-menu');
  const cardList = document.querySelector('#prompt-card-list');
  const error = document.querySelector('#prompt-error');
  const cancelButton = document.querySelector('#prompt-cancel');
  const saveButton = document.querySelector('#prompt-save');
  const copyButton = document.querySelector('#copy-prompt');
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
    onSelectionChange: () => {},

    onToggleFolder(id) {
      if (expandedFolderIds.has(id)) collapseFolder(id);
      else {
        syncExpandedEditorFromDom();
        expandedFolderIds.add(id);
        render();
      }
    },
    onExpandFolder(id) {
      syncExpandedEditorFromDom();
      expandedFolderIds.add(id);
      render();
    },
    onCollapseFolder(id) {
      collapseFolder(id);
    },
    onTogglePromptEditor(id) {
      syncExpandedEditorFromDom();
      expandedPromptId = expandedPromptId === id ? null : id;
      render();
      if (expandedPromptId) focusInRow(expandedPromptId, '.prompt-card-title');
    },
    onOpenPrompt(id) {
      syncExpandedEditorFromDom();
      expandedPromptId = id;
      render();
      focusInRow(id, '.prompt-card-title');
    },
    onCollapsePromptEditor(id) {
      syncExpandedEditorFromDom();
      if (expandedPromptId === id) expandedPromptId = null;
      render();
    },
    onCopyPrompt(id) {
      const node = findPromptNode(draftLibrary, id);
      if (node && node.type === 'prompt') copyToClipboard(node.text);
    },
    onCopySelected(ids) {
      const text = collectPromptsFromSelectedRoots(draftLibrary, ids);
      if (text) copyToClipboard(text);
    },
    onDelete(ids) {
      deleteRoots(ids);
    },
    onBeginRename(id) {
      syncExpandedEditorFromDom();
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
      syncExpandedEditorFromDom();
      const next = movePromptNodes(draftLibrary, {
        nodeIds: ids,
        destinationParentId,
        beforeId,
      });
      if (next !== draftLibrary) {
        draftLibrary = next;
        if (destinationParentId && !expandedFolderIds.has(destinationParentId)) {
          expandedFolderIds.add(destinationParentId);
        }
        repairSelectionAfterTreeChangeAndRender();
      }
    },
    onOpenContextMenu(x, y, id) {
      openTreeMenu(x, y, id);
    },
    onCloseContextMenu() {
      contextMenu.close();
    },
    onBlankClick() {
      contextMenu.close();
    },
    onEscape() {
      escapePriority();
    },
  };

  const controller = createPromptTreeController({
    document,
    list: cardList,
    getTree: () => draftLibrary,
    getExpandedFolders: () => expandedFolderIds,
    getPromptEditorId: () => expandedPromptId,
    getRenamingFolderId: () => editingFolderId,
    intents,
  });

  function copyToClipboard(text) {
    void copyText(text).then(() => {
      if (setStatus) setStatus('Prompt copied.');
    }).catch((caught) => {
      error.textContent = caught instanceof Error ? caught.message : String(caught);
    });
  }

  function collapseFolder(id) {
    syncExpandedEditorFromDom();
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
      render();
      return;
    }
    if (expandedPromptId) {
      syncExpandedEditorFromDom();
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
    renderDeleteConfirm();
  }

  function renderNodes(nodes, parentId, depth) {
    const fragment = document.createDocumentFragment();
    nodes.forEach((node, index) => {
      const nextId = nodes[index + 1]?.id ?? null;
      fragment.append(node.type === 'folder'
        ? createFolderElement(node, parentId, depth, nextId)
        : createPromptElement(node, parentId, depth, nextId));
    });
    return fragment;
  }

  function setRowMeta(row, node, parentId, depth, nextId) {
    row.dataset.nodeId = node.id;
    row.dataset.nodeType = node.type;
    row.dataset.parentId = parentId ?? '';
    row.dataset.nextId = nextId ?? '';
    row.style.setProperty('--prompt-depth', String(depth));
  }

  function createPromptElement(node, parentId, depth, nextId) {
    const expanded = node.id === expandedPromptId;
    const fragment = document.createDocumentFragment();
    const row = document.createElement('div');
    row.className = 'prompt-tree-row prompt-prompt-row';
    setRowMeta(row, node, parentId, depth, nextId);
    row.setAttribute('role', 'treeitem');
    row.setAttribute('aria-level', String(depth + 1));
    row.setAttribute('aria-expanded', String(expanded));

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

  function createFolderElement(node, parentId, depth, nextId) {
    const expanded = expandedFolderIds.has(node.id);
    const renaming = editingFolderId === node.id;
    const fragment = document.createDocumentFragment();
    const row = document.createElement('div');
    row.className = 'prompt-tree-row prompt-folder-row';
    setRowMeta(row, node, parentId, depth, nextId);
    row.setAttribute('role', 'treeitem');
    row.setAttribute('aria-level', String(depth + 1));
    row.setAttribute('aria-expanded', String(expanded));

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'prompt-checkbox';
    checkbox.setAttribute('aria-label', `Include every prompt inside ${node.title}`);
    checkbox.checked = node.includeAll === true;

    let titleControl;
    if (renaming) {
      titleControl = document.createElement('input');
      titleControl.className = 'prompt-folder-rename';
      titleControl.setAttribute('aria-label', 'Folder title');
      titleControl.value = node.title;
    } else {
      titleControl = document.createElement('button');
      titleControl.type = 'button';
      titleControl.className = 'prompt-folder-toggle';
      titleControl.setAttribute('aria-expanded', String(expanded));
      const chevronSpan = document.createElement('span');
      chevronSpan.className = 'prompt-folder-chevron';
      chevronSpan.append(icon('chevron'));
      const folderIconSpan = document.createElement('span');
      folderIconSpan.className = 'prompt-folder-icon';
      folderIconSpan.append(icon('folder'));
      const titleSpan = document.createElement('span');
      titleSpan.className = 'prompt-folder-title';
      titleSpan.textContent = node.title;
      titleControl.append(chevronSpan, folderIconSpan, titleSpan);
    }

    row.append(checkbox, titleControl);
    fragment.append(row);

    if (expanded) {
      const children = document.createElement('div');
      children.className = 'prompt-tree-children';
      children.setAttribute('role', 'group');
      children.style.setProperty('--prompt-depth', String(depth + 1));
      children.append(renderNodes(node.children, node.id, depth + 1));
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

  function syncExpandedEditorFromDom() {
    if (!expandedPromptId) return;
    const row = rowForId(expandedPromptId);
    if (!row) return;
    const titleInput = row.querySelector('.prompt-card-title');
    const textarea = detailsForId(expandedPromptId)?.querySelector('.prompt-card-text');
    if (titleInput) {
      draftLibrary = updatePromptNode(draftLibrary, expandedPromptId, (node) => ({ ...node, title: titleInput.value }));
    }
    if (textarea) {
      draftLibrary = updatePromptNode(draftLibrary, expandedPromptId, (node) => ({ ...node, text: textarea.value }));
    }
  }

  /** Resolves the owning prompt node id for a focused control; the prompt
   * textarea lives in the details element, a sibling of the row. */
  function ownerNodeId(target) {
    const details = target.closest('.prompt-card-details');
    if (details?.dataset.nodeId) return details.dataset.nodeId;
    const row = target.closest('.prompt-tree-row');
    return row?.dataset.nodeId ?? null;
  }

  function onTreeInput(event) {
    if (event.target.classList.contains('prompt-folder-rename')) return;
    const id = ownerNodeId(event.target);
    if (!id) return;
    if (event.target.classList.contains('prompt-card-title')) {
      draftLibrary = updatePromptNode(draftLibrary, id, (node) => ({ ...node, title: event.target.value }));
    } else if (event.target.classList.contains('prompt-card-text')) {
      draftLibrary = updatePromptNode(draftLibrary, id, (node) => ({ ...node, text: event.target.value }));
    }
  }

  function onCheckboxChange(event) {
    const row = event.target.closest('.prompt-tree-row');
    if (!row) return;
    const id = row.dataset.nodeId;
    if (!id) return;
    if (row.dataset.nodeType === 'folder') {
      draftLibrary = updatePromptNode(draftLibrary, id, (node) => ({ ...node, includeAll: event.target.checked }));
    } else {
      draftLibrary = updatePromptNode(draftLibrary, id, (node) => ({ ...node, includeInBatch: event.target.checked }));
    }
    render();
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
    syncExpandedEditorFromDom();
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
    for (const id of ids) {
      draftLibrary = removePromptNode(draftLibrary, id);
      expandedFolderIds.delete(id);
    }
    if (expandedPromptId && ids.includes(expandedPromptId)) expandedPromptId = null;
    confirmingDeleteIds = null;
    repairSelectionAfterTreeChangeAndRender();
  }

  function repairSelectionAfterTreeChangeAndRender() {
    const visible = visibleDepthFirstIds(draftLibrary, expandedFolderIds);
    controller.setSelection(repairSelectionAfterTreeChange(controller.getSelection(), visible));
    render();
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

  function addPrompt(parentId) {
    const added = createPromptNode();
    if (parentId == null) {
      draftLibrary = [...draftLibrary, added];
    } else {
      draftLibrary = updatePromptNode(draftLibrary, parentId, (folder) => ({
        ...folder,
        children: [...folder.children, added],
      }));
      expandedFolderIds.add(parentId);
    }
    expandedPromptId = added.id;
    render();
    focusInRow(added.id, '.prompt-card-title');
  }

  function addFolder(parentId) {
    const added = createPromptFolder();
    if (parentId == null) {
      draftLibrary = [...draftLibrary, added];
    } else {
      draftLibrary = updatePromptNode(draftLibrary, parentId, (folder) => ({
        ...folder,
        children: [...folder.children, added],
      }));
      expandedFolderIds.add(parentId);
    }
    expandedFolderIds.add(added.id);
    editingFolderId = added.id;
    render();
    focusInRow(added.id, '.prompt-folder-rename');
  }

  function onAddClick() {
    addMenu.hidden = !addMenu.hidden;
    addButton.setAttribute('aria-expanded', String(!addMenu.hidden));
  }

  function onAddMenuItem(event) {
    const kind = event.target.dataset?.promptAdd;
    if (!kind) return;
    addMenu.hidden = true;
    addButton.setAttribute('aria-expanded', 'false');
    if (kind === 'prompt') addPrompt(null);
    else addFolder(null);
  }

  // -------------------------------------------------------------- rename

  function commitFolderRename(id, value) {
    const title = typeof value === 'string' ? value : '';
    if (title.trim()) {
      draftLibrary = updatePromptNode(draftLibrary, id, (node) => ({ ...node, title }));
    }
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
      commitFolderRename(id, input.value);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      editingFolderId = null;
      render();
    }
  }

  function onRenameFocusout(event) {
    const input = event.target.closest('.prompt-folder-rename');
    if (!input) return;
    const id = input.closest('.prompt-tree-row')?.dataset.nodeId;
    if (!id || editingFolderId !== id) return;
    commitFolderRename(id, input.value);
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

  function buildMenuItems(id, node, multi) {
    if (multi) {
      return [
        { id: 'copy-selected', label: 'Copy selected' },
        { id: 'include', label: 'Include in batch' },
        { id: 'exclude', label: 'Exclude from batch' },
        { id: 'delete', label: 'Delete' },
      ];
    }
    if (node.type === 'folder') {
      const expanded = expandedFolderIds.has(id);
      return [
        { id: 'expand-toggle', label: expanded ? 'Collapse' : 'Expand' },
        { id: 'rename', label: 'Rename' },
        { id: node.includeAll ? 'exclude' : 'include', label: node.includeAll ? 'Use child selections' : 'Include everything inside' },
        { id: 'new-prompt-inside', label: 'New prompt inside' },
        { id: 'new-folder-inside', label: 'New folder inside' },
        { id: 'delete', label: 'Delete' },
      ];
    }
    return [
      { id: 'copy', label: 'Copy' },
      { id: 'edit', label: 'Edit' },
      { id: node.includeInBatch ? 'exclude' : 'include', label: node.includeInBatch ? 'Exclude from batch' : 'Include in batch' },
      { id: 'delete', label: 'Delete' },
    ];
  }

  function handleMenuAction(action, id, multi) {
    const ids = multi ? [...controller.getSelection().selectedIds] : [id];
    if (action === 'copy') intents.onCopyPrompt(id);
    else if (action === 'copy-selected') intents.onCopySelected(ids);
    else if (action === 'edit') intents.onOpenPrompt(id);
    else if (action === 'expand-toggle') intents.onToggleFolder(id);
    else if (action === 'rename') intents.onBeginRename(id);
    else if (action === 'include') setBatchIncludedFor(ids, true);
    else if (action === 'exclude') setBatchIncludedFor(ids, false);
    else if (action === 'new-prompt-inside') addPrompt(id);
    else if (action === 'new-folder-inside') addFolder(id);
    else if (action === 'delete') deleteRoots(ids);
  }

  function setBatchIncludedFor(ids, included) {
    for (const id of ids) {
      draftLibrary = updatePromptNode(draftLibrary, id, (node) => (
        node.type === 'prompt'
          ? { ...node, includeInBatch: included }
          : { ...node, includeAll: included }
      ));
    }
    render();
  }

  // ------------------------------------------------------------------ open

  function open(options = {}) {
    draftLibrary = snapshotLibrary().map(cloneNode);
    expandedFolderIds = new Set();
    for (const node of draftLibrary) {
      if (node.type === 'folder') expandedFolderIds.add(node.id);
    }
    expandedPromptId = null;
    editingFolderId = null;
    confirmingDeleteIds = null;
    contextMenu.close();
    addMenu.hidden = true;
    addButton.setAttribute('aria-expanded', 'false');
    controller.setSelection(createTreeSelection());
    error.textContent = options.message || '';
    render();
    layer.hidden = false;
  }

  function close() {
    contextMenu.close();
    layer.hidden = true;
    error.textContent = '';
  }

  // ------------------------------------------------------------------- save

  async function onSave() {
    if (saving) return;
    syncExpandedEditorFromDom();
    if (editingFolderId) commitFolderRename(editingFolderId, rowForId(editingFolderId)?.querySelector('.prompt-folder-rename')?.value ?? '');
    const validationError = validatePromptLibrary(draftLibrary);
    if (validationError) {
      error.textContent = validationError;
      return;
    }
    saving = true;
    saveButton.disabled = true;
    try {
      const next = setPromptLibrary(store.getSnapshot(), draftLibrary);
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
    addButton.addEventListener('click', onAddClick, { signal });
    addMenu.addEventListener('click', onAddMenuItem, { signal });
    deleteOk.addEventListener('click', onDeleteOk, { signal });
    deleteCancel.addEventListener('click', onDeleteCancel, { signal });
    cancelButton.addEventListener('click', onCancel, { signal });
    saveButton.addEventListener('click', () => onSave(), { signal });
    cardList.addEventListener('input', onTreeInput, { signal });
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

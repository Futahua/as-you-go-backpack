import {
  createPromptNode,
  createPromptFolder,
  effectivePromptLibrary,
  findPromptNode,
  updatePromptNode,
  removePromptNode,
  movePromptNode,
  descendantPromptIds,
  buildBatchPromptText,
  validatePromptLibrary,
} from '../../prompt-library-model.js';
import { setPromptLibrary } from '../../workspace-model-20260730b.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Small local SVG icon library. A project-wide icon framework would be
 * unnecessary for these six shapes. */
const ICONS = {
  grip: [
    { tag: 'circle', cx: 6.5, cy: 6, r: 1.3, fill: 'currentColor', stroke: 'none' },
    { tag: 'circle', cx: 13.5, cy: 6, r: 1.3, fill: 'currentColor', stroke: 'none' },
    { tag: 'circle', cx: 6.5, cy: 10, r: 1.3, fill: 'currentColor', stroke: 'none' },
    { tag: 'circle', cx: 13.5, cy: 10, r: 1.3, fill: 'currentColor', stroke: 'none' },
    { tag: 'circle', cx: 6.5, cy: 14, r: 1.3, fill: 'currentColor', stroke: 'none' },
    { tag: 'circle', cx: 13.5, cy: 14, r: 1.3, fill: 'currentColor', stroke: 'none' },
  ],
  chevron: [{ d: 'M6 8l4 4 4-4' }],
  copy: [
    { d: 'M7.5 12.5h8a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1v-4.5a1 1 0 0 1 1-1z' },
    { d: 'M4.5 13.5H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h8.5A1 1 0 0 1 13.5 4v1.5' },
  ],
  trash: [
    { d: 'M4 6h12M8 6V4.5A1.5 1.5 0 0 1 9.5 3h1A1.5 1.5 0 0 1 12 4.5V6' },
    { d: 'M6 6v9.5A1.5 1.5 0 0 0 7.5 17h5A1.5 1.5 0 0 0 14 15.5V6M8.5 9v5M11.5 9v5' },
  ],
  plusDoc: [
    { d: 'M5 3h6l4 4v10a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 4 17V4.5A1.5 1.5 0 0 1 5.5 3z' },
    { d: 'M10 8v6M7 11h6' },
  ],
  plusFolder: [
    { d: 'M3 6a1.5 1.5 0 0 1 1.5-1.5h4l1.5 2H16a1 1 0 0 1 1 1v8a1.5 1.5 0 0 1-1.5 1.5H4.5A1.5 1.5 0 0 1 3 15.5V6z' },
    { d: 'M8.5 11h5M11 8.5v5' },
  ],
  folder: [
    { d: 'M3 6a1.5 1.5 0 0 1 1.5-1.5h4l1.5 2H16a1 1 0 0 1 1 1v8a1.5 1.5 0 0 1-1.5 1.5H4.5A1.5 1.5 0 0 1 3 15.5V6z' },
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

function createIconButton(document, { className, label, action, icon }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.title = label;
  button.setAttribute('aria-label', label);
  if (action) button.dataset.promptAction = action;
  button.append(icon);
  return button;
}

/** Owns the prompt-library panel opened from the copy button. The library is a
 * nested tree of folders and prompts with dialog-local expansion, rename, and
 * drag state. This component knows nothing about selected workspace shortcuts
 * or the toolbar's target-copy behavior. */
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
  let confirmingDeleteId = null;
  let dragState = null;
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

  function open(options = {}) {
    draftLibrary = snapshotLibrary().map(cloneNode);
    expandedFolderIds = new Set();
    for (const node of draftLibrary) {
      if (node.type === 'folder') expandedFolderIds.add(node.id);
    }
    expandedPromptId = null;
    editingFolderId = null;
    confirmingDeleteId = null;
    dragState = null;
    addMenu.hidden = true;
    addButton.setAttribute('aria-expanded', 'false');
    error.textContent = options.message || '';
    render();
    layer.hidden = false;
  }

  function close() {
    layer.hidden = true;
    error.textContent = '';
  }

  // --------------------------------------------------------------- rendering

  function render() {
    cardList.textContent = '';
    cardList.append(renderNodes(draftLibrary, null, null, 0));
    renderDeleteConfirm();
  }

  function renderNodes(nodes, parentId, grandparentId, depth) {
    const fragment = document.createDocumentFragment();
    nodes.forEach((node, index) => {
      const nextId = nodes[index + 1]?.id ?? null;
      fragment.append(node.type === 'folder'
        ? createFolderElement(node, parentId, grandparentId, depth, nextId)
        : createPromptElement(node, parentId, grandparentId, depth, nextId));
    });
    return fragment;
  }

  function createPromptElement(node, parentId, grandparentId, depth, nextId) {
    const expanded = node.id === expandedPromptId;
    const fragment = document.createDocumentFragment();

    const row = document.createElement('div');
    row.className = 'prompt-tree-row prompt-prompt-row';
    setRowMeta(row, node, parentId, grandparentId, depth, nextId);
    row.classList.toggle('prompt-row-expanded', expanded);

    const handle = createIconButton(document, { className: 'prompt-tree-handle', label: 'Drag to reorder', icon: icon('grip') });
    handle.draggable = true;

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'prompt-checkbox';
    checkbox.setAttribute('aria-label', `Include ${node.title} in batch`);
    checkbox.checked = node.includeInBatch === true;

    if (expanded) {
      const titleInput = document.createElement('input');
      titleInput.className = 'prompt-card-title';
      titleInput.setAttribute('aria-label', 'Prompt title');
      titleInput.value = node.title;
      const copyBtn = createIconButton(document, { className: 'prompt-icon-pill', label: 'Copy prompt', action: 'copy', icon: icon('copy') });
      const deleteBtn = createIconButton(document, { className: 'prompt-icon-pill danger', label: 'Delete prompt', action: 'delete', icon: icon('trash') });
      const toggleBtn = createIconButton(document, { className: 'prompt-icon-pill prompt-card-toggle', label: 'Collapse prompt', icon: icon('chevron') });
      toggleBtn.setAttribute('aria-expanded', 'true');
      row.append(handle, checkbox, titleInput, copyBtn, deleteBtn, toggleBtn);

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

    const openButton = document.createElement('button');
    openButton.type = 'button';
    openButton.className = 'prompt-prompt-open';
    openButton.setAttribute('aria-expanded', 'false');
    const titleSpan = document.createElement('span');
    titleSpan.className = 'prompt-prompt-title';
    titleSpan.textContent = node.title;
    openButton.append(titleSpan);
    const copyBtn = createIconButton(document, { className: 'prompt-icon-pill', label: 'Copy prompt', action: 'copy', icon: icon('copy') });
    const deleteBtn = createIconButton(document, { className: 'prompt-icon-pill danger', label: 'Delete prompt', action: 'delete', icon: icon('trash') });
    const toggleBtn = createIconButton(document, { className: 'prompt-icon-pill prompt-card-toggle', label: 'Expand prompt', icon: icon('chevron') });
    toggleBtn.setAttribute('aria-expanded', 'false');
    row.append(handle, checkbox, openButton, copyBtn, deleteBtn, toggleBtn);
    fragment.append(row);
    return fragment;
  }

  function createFolderElement(node, parentId, grandparentId, depth, nextId) {
    const expanded = expandedFolderIds.has(node.id);
    const renaming = editingFolderId === node.id;
    const fragment = document.createDocumentFragment();

    const row = document.createElement('div');
    row.className = 'prompt-tree-row prompt-folder-row';
    setRowMeta(row, node, parentId, grandparentId, depth, nextId);

    const handle = createIconButton(document, { className: 'prompt-tree-handle', label: 'Drag to reorder', icon: icon('grip') });
    handle.draggable = true;

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

    const count = document.createElement('span');
    count.className = 'prompt-folder-count';
    const promptCount = descendantPromptIds(draftLibrary, node.id).length;
    count.textContent = promptCount > 0 ? String(promptCount) : '';

    const addPrompt = createIconButton(document, { className: 'prompt-icon-pill', label: 'Add prompt inside', action: 'add-prompt-inside', icon: icon('plusDoc') });
    const addFolder = createIconButton(document, { className: 'prompt-icon-pill', label: 'Add folder inside', action: 'add-folder-inside', icon: icon('plusFolder') });
    const deleteBtn = createIconButton(document, { className: 'prompt-icon-pill danger', label: 'Delete folder', action: 'delete', icon: icon('trash') });

    row.append(handle, checkbox, titleControl, count, addPrompt, addFolder, deleteBtn);
    fragment.append(row);

    if (expanded) {
      const children = document.createElement('div');
      children.className = 'prompt-tree-children';
      children.style.setProperty('--prompt-depth', String(depth + 1));
      children.append(renderNodes(node.children, node.id, parentId, depth + 1));
      fragment.append(children);
    }
    return fragment;
  }

  function setRowMeta(row, node, parentId, grandparentId, depth, nextId) {
    row.dataset.nodeId = node.id;
    row.dataset.nodeType = node.type;
    row.dataset.parentId = parentId ?? '';
    row.dataset.grandparentId = grandparentId ?? '';
    row.dataset.nextId = nextId ?? '';
    row.style.setProperty('--prompt-depth', String(depth));
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
    if (!confirmingDeleteId) {
      deleteConfirm.hidden = true;
      return;
    }
    const count = descendantPromptIds(draftLibrary, confirmingDeleteId).length;
    deleteMessage.textContent = count === 1
      ? 'Delete folder and its contained prompt?'
      : `Delete folder and ${count} contained prompts?`;
    deleteConfirm.hidden = false;
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

  // --------------------------------------------------------------- events

  /** Resolves the owning prompt node id for a focused control. The prompt
   * textarea lives in the details element, which is a sibling of the row, so it
   * is resolved through .prompt-card-details[data-node-id] before falling back
   * to the row. */
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

  function onRowClick(event) {
    const folderToggle = event.target.closest('.prompt-folder-toggle');
    if (folderToggle) {
      const row = folderToggle.closest('.prompt-tree-row');
      const id = row?.dataset.nodeId;
      if (id) {
        if (expandedFolderIds.has(id)) expandedFolderIds.delete(id);
        else expandedFolderIds.add(id);
        render();
      }
      return;
    }

    const promptOpen = event.target.closest('.prompt-prompt-open, .prompt-card-toggle');
    if (promptOpen) {
      const row = promptOpen.closest('.prompt-tree-row');
      const id = row?.dataset.nodeId;
      if (id) {
        syncExpandedEditorFromDom();
        expandedPromptId = expandedPromptId === id ? null : id;
        render();
        if (expandedPromptId) focusInRow(expandedPromptId, '.prompt-card-title');
      }
      return;
    }

    if (event.target.closest('.prompt-tree-handle')) return;

    const pill = event.target.closest('[data-prompt-action]');
    if (!pill) return;
    event.preventDefault();
    event.stopPropagation();
    const row = pill.closest('.prompt-tree-row');
    const id = row?.dataset.nodeId;
    if (!id) return;
    const action = pill.dataset.promptAction;
    if (action === 'copy') {
      const node = findPromptNode(draftLibrary, id);
      if (node && node.type === 'prompt') {
        void copyText(node.text).then(() => {
          if (setStatus) setStatus('Prompt copied.');
        }).catch((caught) => {
          error.textContent = caught instanceof Error ? caught.message : String(caught);
        });
      }
    } else if (action === 'delete') {
      deleteNode(id, row.dataset.nodeType);
    } else if (action === 'add-prompt-inside') {
      addPrompt(id);
    } else if (action === 'add-folder-inside') {
      addFolder(id);
    }
  }

  /** Number of prompts that would remain after removing the given roots (each
   * removing its whole subtree). Used to block operations that would leave the
   * library with zero prompts. */
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

  function deleteNode(id, type) {
    if (countPromptsAfterRemoving([id]) === 0) {
      error.textContent = 'Keep at least one prompt.';
      return;
    }
    if (type === 'prompt') {
      draftLibrary = removePromptNode(draftLibrary, id);
      if (expandedPromptId === id) expandedPromptId = null;
      render();
      return;
    }
    if (descendantPromptIds(draftLibrary, id).length === 0) {
      draftLibrary = removePromptNode(draftLibrary, id);
      expandedFolderIds.delete(id);
      render();
      return;
    }
    confirmingDeleteId = id;
    render();
  }

  function onDeleteOk() {
    if (!confirmingDeleteId) return;
    if (countPromptsAfterRemoving([confirmingDeleteId]) === 0) {
      confirmingDeleteId = null;
      error.textContent = 'Keep at least one prompt.';
      render();
      return;
    }
    draftLibrary = removePromptNode(draftLibrary, confirmingDeleteId);
    expandedFolderIds.delete(confirmingDeleteId);
    confirmingDeleteId = null;
    render();
  }

  function onDeleteCancel() {
    confirmingDeleteId = null;
    render();
  }

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

  function onDblClick(event) {
    const title = event.target.closest('.prompt-folder-title');
    if (!title) return;
    const row = title.closest('.prompt-tree-row');
    const id = row?.dataset.nodeId;
    if (!id) return;
    editingFolderId = id;
    render();
    focusInRow(id, '.prompt-folder-rename');
  }

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

  // ------------------------------------------------------------ drag & drop

  function onDragStart(event) {
    const handle = event.target.closest('.prompt-tree-handle');
    if (!handle) return;
    const row = handle.closest('.prompt-tree-row');
    if (!row) return;
    dragState = { nodeId: row.dataset.nodeId };
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', dragState.nodeId);
    }
    row.classList.add('prompt-dragging');
  }

  function resolveDropPlan(nodeId, row, y, height) {
    const targetId = row.dataset.nodeId;
    const targetType = row.dataset.nodeType;
    const parentId = row.dataset.parentId || null;
    const nextId = row.dataset.nextId || null;
    if (targetType === 'folder') {
      if (y < height * 0.25) return { zone: 'before', destinationParentId: parentId, beforeId: targetId };
      if (y > height * 0.75) return { zone: 'after', destinationParentId: parentId, beforeId: nextId };
      return { zone: 'inside', destinationParentId: targetId, beforeId: null };
    }
    return y < height / 2
      ? { zone: 'before', destinationParentId: parentId, beforeId: targetId }
      : { zone: 'after', destinationParentId: parentId, beforeId: nextId };
  }

  function clearDropIndicators() {
    for (const row of rows()) {
      row.classList.remove('prompt-drop-before', 'prompt-drop-inside', 'prompt-drop-after');
      delete row.dataset.dropParent;
      delete row.dataset.dropBefore;
    }
  }

  function clearDragVisuals() {
    for (const row of rows()) row.classList.remove('prompt-dragging');
  }

  function onDragOver(event) {
    if (!dragState) return;
    const row = event.target.closest('.prompt-tree-row');
    if (!row) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    const rect = row.getBoundingClientRect();
    const plan = resolveDropPlan(dragState.nodeId, row, event.clientY - rect.top, rect.height);
    // Only drop indicators are cleared; the dragged row's styling must persist.
    clearDropIndicators();
    if (!plan) {
      row.dataset.dropParent = '';
      row.dataset.dropBefore = '';
      return;
    }
    if (plan.zone === 'before') row.classList.add('prompt-drop-before');
    else if (plan.zone === 'inside') row.classList.add('prompt-drop-inside');
    else row.classList.add('prompt-drop-after');
    row.dataset.dropParent = plan.destinationParentId ?? '';
    row.dataset.dropBefore = plan.beforeId ?? '';
  }

  function onDrop(event) {
    if (!dragState) return;
    event.preventDefault();
    event.stopPropagation();
    const row = event.target.closest('.prompt-tree-row');
    let next = draftLibrary;
    let droppedInside = null;
    if (row) {
      const destinationParentId = row.dataset.dropParent === '' ? null : row.dataset.dropParent;
      const beforeId = row.dataset.dropBefore === '' ? null : row.dataset.dropBefore;
      if (destinationParentId) droppedInside = destinationParentId;
      next = movePromptNode(draftLibrary, {
        nodeId: dragState.nodeId,
        destinationParentId,
        beforeId,
      });
    }
    clearDropIndicators();
    clearDragVisuals();
    dragState = null;
    if (next !== draftLibrary) {
      draftLibrary = next;
      if (droppedInside && !expandedFolderIds.has(droppedInside)) {
        expandedFolderIds.add(droppedInside);
      }
      render();
    }
  }

  function onDragEnd(event) {
    event.stopPropagation();
    clearDropIndicators();
    clearDragVisuals();
    dragState = null;
  }

  // ------------------------------------------------------- keyboard reorder

  function onKeyDown(event) {
    if (!event.altKey) return;
    const handle = event.target.closest('.prompt-tree-handle');
    if (!handle) return;
    const row = handle.closest('.prompt-tree-row');
    if (!row) return;
    const nodeId = row.dataset.nodeId;
    const parentId = row.dataset.parentId || null;
    const grandparentId = row.dataset.grandparentId || null;
    const siblings = parentId
      ? (findPromptNode(draftLibrary, parentId)?.children ?? [])
      : draftLibrary;
    const index = siblings.findIndex((node) => node.id === nodeId);
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      if (index > 0) {
        draftLibrary = movePromptNode(draftLibrary, { nodeId, destinationParentId: parentId, beforeId: siblings[index - 1].id });
        render();
      }
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      if (index !== -1 && index < siblings.length - 1) {
        const after = siblings[index + 2];
        draftLibrary = movePromptNode(draftLibrary, {
          nodeId,
          destinationParentId: parentId,
          beforeId: after ? after.id : null,
        });
        render();
      }
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      event.stopPropagation();
      if (index > 0 && siblings[index - 1].type === 'folder') {
        const target = siblings[index - 1];
        draftLibrary = movePromptNode(draftLibrary, { nodeId, destinationParentId: target.id, beforeId: null });
        expandedFolderIds.add(target.id);
        render();
      }
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      event.stopPropagation();
      if (parentId) {
        draftLibrary = movePromptNode(draftLibrary, { nodeId, destinationParentId: grandparentId, beforeId: null });
        render();
      }
    }
  }

  // ------------------------------------------------------------------- save

  async function onSave() {
    if (saving) return;
    syncExpandedEditorFromDom();
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
    cardList.addEventListener('click', onRowClick, { signal });
    cardList.addEventListener('dblclick', onDblClick, { signal });
    cardList.addEventListener('keydown', onKeyDown, { signal });
    cardList.addEventListener('keydown', onRenameKeydown, { signal });
    cardList.addEventListener('focusout', onRenameFocusout, { signal });
    cardList.addEventListener('dragstart', onDragStart, { signal });
    cardList.addEventListener('dragover', onDragOver, { signal });
    cardList.addEventListener('drop', onDrop, { signal });
    cardList.addEventListener('dragend', onDragEnd, { signal });
  }

  function destroy() {
    abortController?.abort();
    abortController = null;
  }

  return { mount, destroy, open, close, getBatchText, getSnapshotLibrary };
}

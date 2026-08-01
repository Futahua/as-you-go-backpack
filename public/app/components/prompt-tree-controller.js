/** Owns prompt-tree DOM interaction: row selection, keyboard navigation,
 * double-click, context-menu requests, and pointer drag planning. Translates
 * events into plain intents via injected callbacks; never calls the host,
 * persists state, or owns Save/Cancel. Tree traversal comes from the pure
 * prompt-library-model and prompt-tree-selection modules. */
import {
  createTreeSelection,
  selectOnly,
  toggleSelected,
  selectVisibleRange,
  clearSelection,
  selectAllVisible,
  visibleDepthFirstIds,
} from './prompt-tree-selection.js';
import { selectedRootIds } from '../../prompt-library-model.js';

const DRAG_THRESHOLD = 6;

/** True when keyboard focus is inside an editable control, where native text
 * editing (selection, copy/cut/paste, caret movement) must be left alone. */
function isEditableTarget(target) {
  return Boolean(target?.closest?.('input, textarea, [contenteditable="true"]'));
}

export function createPromptTreeController({
  document,
  list,
  getTree,
  getExpandedFolders,
  getPromptEditorId,
  getRenamingFolderId,
  intents,
}) {
  let abortController = null;
  let selection = createTreeSelection();
  let drag = null;

  function visibleIds() {
    return visibleDepthFirstIds(getTree(), getExpandedFolders());
  }

  function rows() {
    return list.querySelectorAll('.prompt-tree-row');
  }

  function rowFor(id) {
    for (const row of rows()) {
      if (row.dataset.nodeId === id) return row;
    }
    return null;
  }

  function getSelection() {
    return selection;
  }

  function setSelection(next) {
    selection = next;
    refreshRowStates();
  }

  function refreshRowStates() {
    for (const row of rows()) {
      const id = row.dataset.nodeId;
      const selected = selection.selectedIds.has(id);
      row.classList.toggle('prompt-selected', selected);
      row.setAttribute('aria-selected', String(selected));
      row.setAttribute('tabindex', selection.focusedId === id ? '0' : '-1');
    }
  }

  function emitSelection(next) {
    selection = next;
    refreshRowStates();
    intents.onSelectionChange?.(selection);
  }

  // ------------------------------------------------------------------ clicks

  function onRowClick(event) {
    if (event.target.closest('.prompt-checkbox')) return;
    if (event.target.closest('.prompt-card-toggle')) {
      const row = event.target.closest('.prompt-tree-row');
      if (row?.dataset.nodeId) intents.onTogglePromptEditor(row.dataset.nodeId);
      return;
    }
    if (event.target.closest('.prompt-folder-toggle')) {
      const row = event.target.closest('.prompt-tree-row');
      if (row?.dataset.nodeId) intents.onToggleFolder(row.dataset.nodeId);
      return;
    }
    if (event.target.closest('.prompt-card-title, .prompt-card-text, .prompt-folder-rename')) return;

    const row = event.target.closest('.prompt-tree-row');
    if (!row) {
      emitSelection(clearSelection());
      intents.onBlankClick?.();
      return;
    }
    const id = row.dataset.nodeId;
    if (event.ctrlKey || event.metaKey) {
      emitSelection(toggleSelected(selection, id));
    } else if (event.shiftKey) {
      emitSelection(selectVisibleRange(selection, id, visibleIds()));
    } else {
      emitSelection(selectOnly(selection, id));
    }
  }

  function onRowDoubleClick(event) {
    if (event.target.closest('.prompt-checkbox, .prompt-card-title, .prompt-card-text, .prompt-folder-rename')) return;
    const row = event.target.closest('.prompt-tree-row');
    if (!row) return;
    const id = row.dataset.nodeId;
    if (row.dataset.nodeType === 'prompt') intents.onCopyPrompt(id);
    else intents.onToggleFolder(id);
  }

  function onContextMenu(event) {
    event.preventDefault();
    const row = event.target.closest('.prompt-tree-row');
    if (!row) {
      intents.onCloseContextMenu?.();
      return;
    }
    const id = row.dataset.nodeId;
    if (!selection.selectedIds.has(id)) {
      emitSelection(selectOnly(selection, id));
    }
    intents.onOpenContextMenu(event.clientX, event.clientY, id);
  }

  // ---------------------------------------------------------------- keyboard

  function onKeyDown(event) {
    if (isEditableTarget(event.target)) return;
    const key = event.key;
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      event.preventDefault();
      const ids = visibleIds();
      const index = ids.indexOf(selection.focusedId);
      const target = key === 'ArrowDown' ? ids[Math.min(ids.length - 1, index + 1)] : ids[Math.max(0, index - 1)];
      if (!target) return;
      if (event.shiftKey) {
        const range = selectVisibleRange({ ...selection, focusedId: selection.focusedId }, target, ids);
        selection = { ...range, focusedId: target };
        refreshRowStates();
      } else {
        selection = { ...selection, focusedId: target };
        refreshRowStates();
      }
      rowFor(target)?.focus?.();
      return;
    }
    if (key === 'ArrowRight' || key === 'ArrowLeft') {
      event.preventDefault();
      const id = selection.focusedId;
      if (!id) return;
      const node = findPromptNodeAt(getTree(), id);
      if (!node) return;
      if (key === 'ArrowRight') {
        if (node.type === 'folder') {
          if (getExpandedFolders().has(id)) {
            const ids = visibleIds();
            const childIndex = ids.indexOf(id) + 1;
            const firstChild = ids[childIndex];
            if (firstChild) {
              selection = { ...selection, focusedId: firstChild };
              refreshRowStates();
              rowFor(firstChild)?.focus?.();
            }
          } else {
            intents.onExpandFolder(id);
          }
        } else {
          intents.onOpenPrompt(id);
        }
      } else if (node.type === 'folder') {
        if (getExpandedFolders().has(id)) {
          intents.onCollapseFolder(id);
        } else {
          moveFocusToVisibleParent(id);
        }
      } else if (getPromptEditorId() === id) {
        intents.onCollapsePromptEditor(id);
      } else {
        moveFocusToVisibleParent(id);
      }
      return;
    }
    if (key === 'Enter') {
      event.preventDefault();
      const id = selection.focusedId;
      if (!id) return;
      const node = findPromptNodeAt(getTree(), id);
      if (!node) return;
      if (node.type === 'prompt') intents.onOpenPrompt(id);
      else intents.onToggleFolder(id);
      return;
    }
    if (key === 'F2') {
      event.preventDefault();
      const id = selection.focusedId;
      if (id) {
        const node = findPromptNodeAt(getTree(), id);
        if (node.type === 'folder') intents.onBeginRename(id);
        else intents.onOpenPrompt(id);
      }
      return;
    }
    if (key === 'Delete' || key === 'Backspace') {
      event.preventDefault();
      if (selection.selectedIds.size > 0) {
        intents.onDelete([...selectedRootIds(getTree(), [...selection.selectedIds])]);
      }
      return;
    }
    if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === 'c') {
      event.preventDefault();
      if (selection.selectedIds.size > 0) {
        intents.onCopySelected([...selectedRootIds(getTree(), [...selection.selectedIds])]);
      }
      return;
    }
    if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === 'a') {
      event.preventDefault();
      emitSelection(selectAllVisible(selection, visibleIds()));
      return;
    }
    if (event.key === 'Escape') {
      intents.onEscape?.();
    }
  }

  function findPromptNodeAt(tree, id) {
    for (const node of tree) {
      if (node.id === id) return node;
      if (node.type === 'folder') {
        const found = findPromptNodeAt(node.children, id);
        if (found) return found;
      }
    }
    return null;
  }

  function moveFocusToVisibleParent(id) {
    const row = rowFor(id);
    const parentId = row?.dataset.parentId;
    if (parentId) {
      selection = { ...selection, focusedId: parentId };
      refreshRowStates();
      rowFor(parentId)?.focus?.();
    }
  }

  // ------------------------------------------------------------------- drag

  function onPointerDown(event) {
    if (event.button !== 0) return;
    if (event.target.closest('.prompt-checkbox, .prompt-card-toggle, .prompt-folder-toggle, .prompt-card-title, .prompt-card-text, .prompt-folder-rename')) return;
    const row = event.target.closest('.prompt-tree-row');
    if (!row) return;
    const id = row.dataset.nodeId;
    if (!selection.selectedIds.has(id)) {
      emitSelection(selectOnly(selection, id));
    }
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      draggedIds: [...selectedRootIds(getTree(), [...selection.selectedIds])],
    };
  }

  function onPointerMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!drag.moved) {
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
      drag.moved = true;
      setDraggingVisual(drag.draggedIds);
      intents.onDragStart?.(drag.draggedIds);
    }
    const row = event.target.closest('.prompt-tree-row');
    if (!row) {
      clearDropIndicators();
      return;
    }
    event.preventDefault();
    const rect = row.getBoundingClientRect();
    const plan = resolveDropPlan(row, event.clientY - rect.top, rect.height);
    clearDropIndicators();
    if (!plan) return;
    if (plan.zone === 'before') row.classList.add('prompt-drop-before');
    else if (plan.zone === 'inside') row.classList.add('prompt-drop-inside');
    else row.classList.add('prompt-drop-after');
    row.dataset.dropParent = plan.destinationParentId ?? '';
    row.dataset.dropBefore = plan.beforeId ?? '';
  }

  function resolveDropPlan(row, y, height) {
    const targetType = row.dataset.nodeType;
    const parentId = row.dataset.parentId || null;
    const nextId = row.dataset.nextId || null;
    const targetId = row.dataset.nodeId;
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

  function setDraggingVisual(ids) {
    const set = new Set(ids);
    for (const row of rows()) {
      row.classList.toggle('prompt-dragging', set.has(row.dataset.nodeId));
    }
  }

  function onPointerUp(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const wasMoved = drag.moved;
    const draggedIds = drag.draggedIds;
    const row = event.target.closest('.prompt-tree-row');
    let plan = null;
    if (row) {
      const destinationParentId = row.dataset.dropParent === '' ? null : row.dataset.dropParent;
      const beforeId = row.dataset.dropBefore === '' ? null : row.dataset.dropBefore;
      plan = { destinationParentId, beforeId };
    }
    clearDropIndicators();
    setDraggingVisual([]);
    drag = null;
    intents.onDragEnd?.(draggedIds);
    if (wasMoved && plan) {
      intents.onMove?.(draggedIds, plan.destinationParentId, plan.beforeId);
    }
  }

  function onPointerCancel(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    clearDropIndicators();
    setDraggingVisual([]);
    drag = null;
    intents.onDragEnd?.([]);
  }

  function cancelDrag() {
    clearDropIndicators();
    setDraggingVisual([]);
    drag = null;
  }

  // ------------------------------------------------------------------- mount

  function mount() {
    abortController = new AbortController();
    const signal = abortController.signal;
    list.addEventListener('click', onRowClick, { signal });
    list.addEventListener('dblclick', onRowDoubleClick, { signal });
    list.addEventListener('keydown', onKeyDown, { signal });
    list.addEventListener('contextmenu', onContextMenu, { signal });
    list.addEventListener('pointerdown', onPointerDown, { signal });
    list.addEventListener('pointermove', onPointerMove, { signal });
    list.addEventListener('pointerup', onPointerUp, { signal });
    list.addEventListener('pointercancel', onPointerCancel, { signal });
  }

  function destroy() {
    abortController?.abort();
    abortController = null;
    cancelDrag();
  }

  return { mount, destroy, getSelection, setSelection, refreshRowStates, cancelDrag };
}

/** Pure tree operations for the prompt library. This module must not touch
 * the clipboard, DOM, store, or status messages.
 *
 * The library is an ordered recursive array of nodes:
 *   prompt:  { id, type: 'prompt',  title, text, includeInBatch }
 *   folder:  { id, type: 'folder',  title, children: [...] }
 * Folders may contain prompts and other folders without a fixed depth limit.
 */

const makeId = (kind) => `${kind}-${crypto.randomUUID()}`;

function createId(kind = 'prompt') {
  return makeId(kind);
}

/** Creates a prompt node. New prompts default to unchecked and empty so an
 * unfinished prompt never enters a normal batch copy. */
export function createPromptNode(overrides = {}) {
  return {
    id: typeof overrides.id === 'string' && overrides.id ? overrides.id : createId('prompt'),
    type: 'prompt',
    title: typeof overrides.title === 'string' ? overrides.title : 'New prompt',
    text: typeof overrides.text === 'string' ? overrides.text : '',
    includeInBatch: overrides.includeInBatch === true,
  };
}

/** Creates a folder node. New folders are empty. */
export function createPromptFolder(overrides = {}) {
  return {
    id: typeof overrides.id === 'string' && overrides.id ? overrides.id : createId('folder'),
    type: 'folder',
    title: typeof overrides.title === 'string' ? overrides.title : 'New folder',
    children: [],
  };
}

function normalizeNode(raw, seen) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.type === 'folder') {
    const id = typeof raw.id === 'string' && raw.id ? raw.id : null;
    if (!id || seen.has(id)) return null;
    seen.add(id);
    const children = Array.isArray(raw.children)
      ? raw.children.map((child) => normalizeNode(child, seen)).filter(Boolean)
      : [];
    return {
      id,
      type: 'folder',
      title: typeof raw.title === 'string' ? raw.title : 'New folder',
      children,
    };
  }
  if (raw.type === 'prompt') {
    const id = typeof raw.id === 'string' && raw.id ? raw.id : null;
    if (!id || seen.has(id)) return null;
    seen.add(id);
    return {
      id,
      type: 'prompt',
      title: typeof raw.title === 'string' ? raw.title : 'New prompt',
      text: typeof raw.text === 'string' ? raw.text : '',
      includeInBatch: raw.includeInBatch === true,
    };
  }
  return null;
}

/**
 * Normalizes the prompt library tree. Malformed records and duplicate ids are
 * dropped, order is preserved, and only recognized node types are kept.
 *
 * When no library is present it migrates older shapes: a flat `promptCards`
 * array becomes root prompt nodes, and a legacy `pickupPrompt` string becomes
 * a single root prompt. Empty input normalizes to an empty library (the dialog
 * supplies a virtual fallback prompt).
 */
export function normalizePromptLibrary(raw, legacyPromptCards, legacyPrompt) {
  if (Array.isArray(raw) && raw.length > 0) {
    const seen = new Set();
    const normalized = [];
    for (const rawNode of raw) {
      const node = normalizeNode(rawNode, seen);
      if (node) normalized.push(node);
    }
    return normalized;
  }
  if (Array.isArray(legacyPromptCards) && legacyPromptCards.length > 0) {
    const seen = new Set();
    const normalized = [];
    for (const card of legacyPromptCards) {
      const id = typeof card?.id === 'string' && card.id ? card.id : null;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      normalized.push({
        id,
        type: 'prompt',
        title: typeof card.title === 'string' ? card.title : 'New prompt',
        text: typeof card.text === 'string' ? card.text : '',
        includeInBatch: card.includeInBatch === true,
      });
    }
    return normalized;
  }
  if (typeof legacyPrompt === 'string' && legacyPrompt.trim()) {
    return [createPromptNode({
      title: 'Agent pickup prompt',
      text: legacyPrompt,
      includeInBatch: true,
    })];
  }
  return [];
}

/** The effective library to show and copy from: the persisted tree when it has
 * nodes, otherwise one virtual root prompt built from `fallbackPrompt`. The
 * virtual prompt is not persisted until the user saves. */
export function effectivePromptLibrary(view, fallbackPrompt) {
  if (Array.isArray(view?.promptLibrary) && view.promptLibrary.length > 0) {
    return view.promptLibrary;
  }
  return [createPromptNode({
    title: 'Agent pickup prompt',
    text: typeof fallbackPrompt === 'string' ? fallbackPrompt : '',
    includeInBatch: true,
  })];
}

/** Finds a node by id anywhere in the tree, or returns null. */
export function findPromptNode(nodes, id) {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.type === 'folder') {
      const found = findPromptNode(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

/** Returns a new tree with the node identified by `id` replaced by the result
 * of `updater(node)`. Non-mutating; returns the original when not found. */
export function updatePromptNode(nodes, id, updater) {
  let updated = false;
  const walk = (list) => list.map((node) => {
    if (node.id === id) {
      updated = true;
      return updater(node);
    }
    if (node.type === 'folder') {
      const children = walk(node.children);
      return children === node.children ? node : { ...node, children };
    }
    return node;
  });
  const result = walk(nodes);
  return updated ? result : nodes;
}

/** Returns a new tree without the node `id` and its entire subtree. */
export function removePromptNode(nodes, id) {
  let removed = false;
  const walk = (list) => {
    const next = [];
    for (const node of list) {
      if (node.id === id) {
        removed = true;
        continue;
      }
      if (node.type === 'folder') {
        const children = walk(node.children);
        next.push(children === node.children ? node : { ...node, children });
      } else {
        next.push(node);
      }
    }
    return next;
  };
  const result = walk(nodes);
  return removed ? result : nodes;
}

function isDescendantOf(candidateId, ancestorId, nodes) {
  const ancestor = findPromptNode(nodes, ancestorId);
  if (!ancestor || ancestor.type !== 'folder') return false;
  return findPromptNode(ancestor.children, candidateId) != null;
}

function removeNode(nodes, id) {
  let removed = null;
  const walk = (list) => {
    const next = [];
    for (const node of list) {
      if (node.id === id) {
        removed = node;
        continue;
      }
      if (node.type === 'folder') {
        const children = walk(node.children);
        next.push(children === node.children ? node : { ...node, children });
      } else {
        next.push(node);
      }
    }
    return next;
  };
  const result = walk(nodes);
  return { nodes: removed ? result : nodes, removed };
}

function insertNode(nodes, parentId, node, beforeId) {
  if (parentId == null) {
    const next = [...nodes];
    const index = beforeId == null
      ? next.length
      : next.findIndex((candidate) => candidate.id === beforeId);
    if (index === -1) return nodes;
    next.splice(index, 0, node);
    return next;
  }
  return nodes.map((candidate) => {
    if (candidate.id === parentId) {
      const children = [...candidate.children];
      const index = beforeId == null
        ? children.length
        : children.findIndex((child) => child.id === beforeId);
      if (index === -1) return candidate;
      children.splice(index, 0, node);
      return { ...candidate, children };
    }
    if (candidate.type === 'folder') {
      const inner = insertNode(candidate.children, parentId, node, beforeId);
      if (inner !== candidate.children) return { ...candidate, children: inner };
    }
    return candidate;
  });
}

/**
 * Moves a node (and its subtree) to a new position. `destinationParentId` is
 * the folder to drop into (null means root); `beforeId` is the sibling to
 * insert before (null appends). Rejects unknown ids, non-folder destinations,
 * folder-into-descendant cycles, and unknown `beforeId` siblings. Non-mutating.
 */
export function movePromptNode(nodes, { nodeId, destinationParentId = null, beforeId = null }) {
  if (nodeId == null) return nodes;
  const moved = findPromptNode(nodes, nodeId);
  if (!moved) return nodes;
  if (destinationParentId != null) {
    const destination = findPromptNode(nodes, destinationParentId);
    if (!destination || destination.type !== 'folder') return nodes;
    if (destinationParentId === nodeId) return nodes;
    if (isDescendantOf(destinationParentId, nodeId, nodes)) return nodes;
  }
  const { nodes: without, removed } = removeNode(nodes, nodeId);
  if (!removed) return nodes;
  if (beforeId != null) {
    const siblings = destinationParentId == null
      ? without
      : (findPromptNode(without, destinationParentId)?.children ?? []);
    if (!siblings.some((candidate) => candidate.id === beforeId)) return nodes;
  }
  return insertNode(without, destinationParentId, removed, beforeId);
}

/** Ids of every prompt under `folderId`, in depth-first order. */
export function descendantPromptIds(nodes, folderId) {
  const folder = findPromptNode(nodes, folderId);
  if (!folder || folder.type !== 'folder') return [];
  const ids = [];
  const walk = (list) => {
    for (const node of list) {
      if (node.type === 'prompt') ids.push(node.id);
      else walk(node.children);
    }
  };
  walk(folder.children);
  return ids;
}

/** Total number of prompt nodes anywhere in the tree. */
export function countPromptNodes(nodes) {
  let count = 0;
  const walk = (list) => {
    for (const node of list) {
      if (node.type === 'prompt') count += 1;
      else walk(node.children);
    }
  };
  walk(nodes);
  return count;
}

/**
 * Derived tri-state for a folder checkbox: 'checked' when every descendant
 * prompt is included, 'unchecked' when none are, 'indeterminate' otherwise.
 * Empty folders are 'unchecked'.
 */
export function folderBatchState(nodes, folderId) {
  const ids = descendantPromptIds(nodes, folderId);
  if (ids.length === 0) return 'unchecked';
  let included = 0;
  for (const id of ids) {
    const node = findPromptNode(nodes, id);
    if (node?.includeInBatch) included += 1;
  }
  if (included === 0) return 'unchecked';
  if (included === ids.length) return 'checked';
  return 'indeterminate';
}

/** Sets `includeInBatch` on every prompt under `folderId`. */
export function setFolderBatchIncluded(nodes, folderId, included) {
  const ids = new Set(descendantPromptIds(nodes, folderId));
  const walk = (list) => list.map((node) => {
    if (node.type === 'prompt' && ids.has(node.id)) {
      return { ...node, includeInBatch: included === true };
    }
    if (node.type === 'folder') {
      const children = walk(node.children);
      return children === node.children ? node : { ...node, children };
    }
    return node;
  });
  return walk(nodes);
}

/** Batch text from checked, non-empty prompts in depth-first order, joined
 * with two blank lines. Folder titles are never included. Returns '' when no
 * checked prompt has text. */
export function buildBatchPromptText(nodes) {
  const parts = [];
  const walk = (list) => {
    for (const node of list) {
      if (node.type === 'prompt') {
        if (node.includeInBatch === true
          && typeof node.text === 'string' && node.text.trim() !== '') {
          parts.push(node.text);
        }
      } else {
        walk(node.children);
      }
    }
  };
  walk(nodes);
  return parts.join('\n\n');
}

/** Returns an error string when the library cannot be saved, else null. */
export function validatePromptLibrary(nodes) {
  const list = Array.isArray(nodes) ? nodes : [];
  const ids = new Set();
  let error = null;
  let promptCount = 0;
  const walk = (level) => {
    if (error) return;
    for (const node of level) {
      if (error) return;
      if (node.type !== 'prompt' && node.type !== 'folder') {
        error = 'Unknown node type.';
        return;
      }
      if (!node.id || ids.has(node.id)) {
        error = 'Node ids must be unique.';
        return;
      }
      ids.add(node.id);
      if (node.type === 'folder') {
        if (!Array.isArray(node.children)) {
          error = 'Only folders can contain children.';
          return;
        }
        if (typeof node.title !== 'string' || node.title.trim() === '') {
          error = 'Every folder needs a title.';
          return;
        }
        walk(node.children);
      } else {
        promptCount += 1;
        if (typeof node.title !== 'string' || node.title.trim() === '') {
          error = 'Every prompt needs a title.';
          return;
        }
        if (typeof node.text !== 'string' || node.text.trim() === '') {
          error = 'Every prompt needs text.';
          return;
        }
      }
    }
  };
  walk(list);
  if (error) return error;
  if (promptCount === 0) return 'Add at least one prompt.';
  return null;
}

/** Decides what the copier should do, preserving the existing precedence:
 * selected shortcut targets win; otherwise the checked prompt batch is copied;
 * when nothing is checked the copier opens the library instead of copying. */
export function resolveCopierAction(selectedTargets, promptNodes) {
  const targets = Array.isArray(selectedTargets) ? selectedTargets : [];
  if (targets.length > 0) {
    return { kind: 'copy', text: targets.join('\n') };
  }
  const text = buildBatchPromptText(promptNodes);
  if (!text) return { kind: 'open' };
  return { kind: 'copy', text };
}

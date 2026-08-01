/** Pure card-list operations for the prompt library. This module must not
 * touch the clipboard, DOM, store, or status messages. */

function makeId() {
  return `prompt-${crypto.randomUUID()}`;
}

/** Creates a card. New cards default to an unchecked, empty prompt so an
 * unfinished prompt never enters a normal batch copy. */
export function createPromptCard(overrides = {}) {
  return {
    id: typeof overrides.id === 'string' && overrides.id ? overrides.id : makeId(),
    title: typeof overrides.title === 'string' ? overrides.title : 'New prompt',
    text: typeof overrides.text === 'string' ? overrides.text : '',
    includeInBatch: overrides.includeInBatch === true,
  };
}

/**
 * Normalizes a raw prompt card list, preserving array order. Malformed
 * records and duplicate ids are dropped. When the list is empty or absent, a
 * legacy `pickupPrompt` string migrates to a single checked card; otherwise
 * the empty list is preserved (the dialog supplies a virtual fallback card).
 */
export function normalizePromptCards(rawCards, legacyPrompt) {
  if (Array.isArray(rawCards) && rawCards.length > 0) {
    const seen = new Set();
    const normalized = [];
    for (const raw of rawCards) {
      const id = typeof raw?.id === 'string' && raw.id ? raw.id : null;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      normalized.push({
        id,
        title: typeof raw.title === 'string' ? raw.title : 'New prompt',
        text: typeof raw.text === 'string' ? raw.text : '',
        includeInBatch: raw.includeInBatch === true,
      });
    }
    return normalized;
  }
  if (typeof legacyPrompt === 'string' && legacyPrompt.trim()) {
    return [createPromptCard({
      title: 'Agent pickup prompt',
      text: legacyPrompt,
      includeInBatch: true,
    })];
  }
  return [];
}

/**
 * The effective cards to show and to copy from: the persisted list when it has
 * cards, otherwise one virtual card built from `fallbackPrompt`. The virtual
 * card is not persisted until the user saves the panel.
 */
export function effectivePromptCards(view, fallbackPrompt) {
  if (Array.isArray(view?.promptCards) && view.promptCards.length > 0) {
    return view.promptCards;
  }
  return [createPromptCard({
    title: 'Agent pickup prompt',
    text: typeof fallbackPrompt === 'string' ? fallbackPrompt : '',
    includeInBatch: true,
  })];
}

/** Returns a new array with `movedId` placed immediately before `beforeId`
 * (or moved to the end when `beforeId` is null). Non-mutating and
 * deterministic; returns the original array when either id is unknown. */
export function reorderPromptCards(cards, movedId, beforeId) {
  const list = Array.isArray(cards) ? cards : [];
  const sourceIndex = list.findIndex((card) => card.id === movedId);
  if (sourceIndex === -1) return list;
  const moved = list[sourceIndex];
  const rest = list.filter((card) => card.id !== movedId);
  if (beforeId == null) return [...rest, moved];
  const targetIndex = rest.findIndex((card) => card.id === beforeId);
  if (targetIndex === -1) return list;
  const next = [...rest];
  next.splice(targetIndex, 0, moved);
  return next;
}

/** Batch text from checked, non-empty cards, in array order, joined with two
 * blank lines. Returns '' when no checked cards have text. */
export function buildBatchPromptText(cards) {
  const list = Array.isArray(cards) ? cards : [];
  return list
    .filter((card) => card.includeInBatch === true
      && typeof card.text === 'string' && card.text.trim() !== '')
    .map((card) => card.text)
    .join('\n\n');
}

/** Returns an error string when the card list cannot be saved, else null. */
export function validatePromptCards(cards) {
  const list = Array.isArray(cards) ? cards : [];
  if (list.length === 0) return 'Add at least one prompt card.';
  const ids = new Set();
  for (const card of list) {
    if (!card.id || ids.has(card.id)) return 'Card ids must be unique.';
    ids.add(card.id);
    if (typeof card.title !== 'string' || card.title.trim() === '') {
      return 'Every card needs a title.';
    }
    if (typeof card.text !== 'string' || card.text.trim() === '') {
      return 'Every card needs prompt text.';
    }
  }
  return null;
}

/**
 * Decides what the copier should do, preserving the existing precedence:
 * selected shortcut targets win; otherwise the checked prompt batch is copied;
 * when nothing is checked the copier opens the library instead of copying.
 */
export function resolveCopierAction(selectedTargets, promptCards) {
  const targets = Array.isArray(selectedTargets) ? selectedTargets : [];
  if (targets.length > 0) {
    return { kind: 'copy', text: targets.join('\n') };
  }
  const text = buildBatchPromptText(promptCards);
  if (!text) return { kind: 'open' };
  return { kind: 'copy', text };
}

import {
  createPromptCard,
  effectivePromptCards,
  reorderPromptCards,
  buildBatchPromptText,
  validatePromptCards,
} from '../../prompt-library-model.js';
import { setPromptCards } from '../../workspace-model-20260730b.js';

/** Owns the prompt-library panel opened from the copy button. All edits live in
 * a private draft until Save; Cancel discards them. This component knows
 * nothing about selected workspace shortcuts or the toolbar's target-copy
 * behavior. */
export function createPromptLibraryDialog({
  document,
  store,
  fallbackPrompt,
  copyText,
  setStatus,
}) {
  let abortController = null;
  let draftCards = [];
  let dragId = null;
  let saving = false;

  const layer = document.querySelector('#prompt-layer');
  const addButton = document.querySelector('#prompt-add');
  const cardList = document.querySelector('#prompt-card-list');
  const error = document.querySelector('#prompt-error');
  const cancelButton = document.querySelector('#prompt-cancel');
  const saveButton = document.querySelector('#prompt-save');
  const copyButton = document.querySelector('#copy-prompt');

  function snapshotCards() {
    return effectivePromptCards(store.getSnapshot().view, fallbackPrompt);
  }

  function getSnapshotCards() {
    return snapshotCards();
  }

  function getBatchText() {
    return buildBatchPromptText(snapshotCards());
  }

  function open(options = {}) {
    draftCards = snapshotCards().map((card) => ({ ...card }));
    error.textContent = options.message || '';
    renderCards();
    layer.hidden = false;
  }

  function close() {
    layer.hidden = true;
    error.textContent = '';
  }

  function clearDropIndicators() {
    for (const article of cardList.querySelectorAll('.prompt-card')) {
      article.classList.remove('prompt-card-drop-before', 'prompt-card-drop-after');
      delete article.dataset.dropBefore;
    }
  }

  function renderCards() {
    cardList.textContent = '';
    for (const card of draftCards) {
      cardList.append(createCardElement(card));
    }
  }

  function createCardElement(card) {
    const article = document.createElement('article');
    article.className = 'prompt-card';
    article.dataset.promptId = card.id;

    const header = document.createElement('header');
    header.className = 'prompt-card-header';

    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'prompt-card-handle';
    handle.draggable = true;
    handle.title = 'Drag to reorder';
    handle.textContent = '⋮⋮';
    const handleLabel = document.createElement('span');
    handleLabel.className = 'sr-only';
    handleLabel.textContent = 'Drag to reorder';
    handle.append(handleLabel);

    const titleInput = document.createElement('input');
    titleInput.className = 'prompt-card-title';
    titleInput.type = 'text';
    titleInput.setAttribute('aria-label', 'Prompt title');
    titleInput.maxLength = 120;
    titleInput.value = card.title;

    const toggleLabel = document.createElement('label');
    toggleLabel.className = 'prompt-batch-toggle';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = card.includeInBatch;
    toggleLabel.append(checkbox);
    toggleLabel.append('Include in batch');

    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.dataset.promptAction = 'copy';
    copyButton.textContent = 'Copy';

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.dataset.promptAction = 'delete';
    deleteButton.textContent = 'Delete';

    header.append(handle, titleInput, toggleLabel, copyButton, deleteButton);

    const textarea = document.createElement('textarea');
    textarea.className = 'prompt-card-text';
    textarea.rows = 8;
    textarea.setAttribute('aria-label', 'Prompt text');
    textarea.value = card.text;

    article.append(header, textarea);
    return article;
  }

  function findCard(id) {
    return draftCards.find((card) => card.id === id) ?? null;
  }

  function syncDraftFromDom() {
    draftCards = [...cardList.querySelectorAll('.prompt-card')].map((article) => ({
      id: article.dataset.promptId,
      title: article.querySelector('.prompt-card-title').value,
      text: article.querySelector('.prompt-card-text').value,
      includeInBatch: article.querySelector('.prompt-batch-toggle input').checked,
    }));
  }

  function onCardInput(event) {
    const article = event.target.closest('.prompt-card');
    if (!article) return;
    const card = findCard(article.dataset.promptId);
    if (!card) return;
    if (event.target.classList.contains('prompt-card-title')) {
      card.title = event.target.value;
    } else if (event.target.classList.contains('prompt-card-text')) {
      card.text = event.target.value;
    }
  }

  function onCardChange(event) {
    const article = event.target.closest('.prompt-card');
    if (!article) return;
    const card = findCard(article.dataset.promptId);
    if (!card) return;
    if (event.target.type === 'checkbox') {
      card.includeInBatch = event.target.checked;
    }
  }

  function onCardClick(event) {
    const article = event.target.closest('.prompt-card');
    if (!article) return;
    const action = event.target.dataset?.promptAction;
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    const card = findCard(article.dataset.promptId);
    if (!card) return;
    if (action === 'copy') {
      void copyText(card.text).then(() => {
        if (setStatus) setStatus('Prompt copied.');
      }).catch((caught) => {
        error.textContent = caught instanceof Error ? caught.message : String(caught);
      });
    } else if (action === 'delete') {
      if (draftCards.length <= 1) {
        error.textContent = 'Keep at least one prompt card.';
        return;
      }
      draftCards = draftCards.filter((candidate) => candidate.id !== card.id);
      renderCards();
    }
  }

  function onAdd() {
    draftCards.push(createPromptCard());
    renderCards();
    const articles = cardList.querySelectorAll('.prompt-card');
    const last = articles[articles.length - 1];
    last?.querySelector('.prompt-card-title')?.focus();
  }

  function onKeyDown(event) {
    const handle = event.target.closest('.prompt-card-handle');
    if (!handle) return;
    const article = handle.closest('.prompt-card');
    if (!article) return;
    const id = article.dataset.promptId;
    const index = draftCards.findIndex((card) => card.id === id);
    if (index === -1) return;
    if (event.altKey && event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      if (index > 0) {
        draftCards = reorderPromptCards(draftCards, id, draftCards[index - 1].id);
        renderCards();
      }
    } else if (event.altKey && event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      if (index < draftCards.length - 1) {
        draftCards = reorderPromptCards(draftCards, id, draftCards[index + 2]?.id ?? null);
        renderCards();
      }
    }
  }

  function onDragStart(event) {
    const handle = event.target.closest('.prompt-card-handle');
    if (!handle) return;
    const article = handle.closest('.prompt-card');
    if (!article) return;
    dragId = article.dataset.promptId;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', dragId);
    }
    article.classList.add('prompt-card-dragging');
  }

  function onDragOver(event) {
    if (!dragId) return;
    const article = event.target.closest('.prompt-card');
    if (!article) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    const rect = article.getBoundingClientRect();
    const before = event.clientY < rect.top + rect.height / 2;
    clearDropIndicators();
    article.classList.add(before ? 'prompt-card-drop-before' : 'prompt-card-drop-after');
    article.dataset.dropBefore = String(before);
  }

  function onDrop(event) {
    if (!dragId) return;
    event.preventDefault();
    event.stopPropagation();
    const article = event.target.closest('.prompt-card');
    if (article) {
      const beforeId = article.dataset.dropBefore === 'true'
        ? article.dataset.promptId
        : nextCardId(article.dataset.promptId);
      draftCards = reorderPromptCards(draftCards, dragId, beforeId);
    }
    clearDropIndicators();
    dragId = null;
    renderCards();
  }

  function nextCardId(id) {
    const index = draftCards.findIndex((card) => card.id === id);
    const next = draftCards[index + 1];
    return next ? next.id : null;
  }

  function onDragEnd(event) {
    event.stopPropagation();
    clearDropIndicators();
    dragId = null;
  }

  async function onSave() {
    if (saving) return;
    syncDraftFromDom();
    const validationError = validatePromptCards(draftCards);
    if (validationError) {
      error.textContent = validationError;
      return;
    }
    saving = true;
    saveButton.disabled = true;
    try {
      const next = setPromptCards(store.getSnapshot(), draftCards);
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

  function mount() {
    abortController = new AbortController();
    const signal = abortController.signal;
    copyButton.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      open();
    }, { signal });
    addButton.addEventListener('click', onAdd, { signal });
    cancelButton.addEventListener('click', onCancel, { signal });
    saveButton.addEventListener('click', () => onSave(), { signal });
    cardList.addEventListener('input', onCardInput, { signal });
    cardList.addEventListener('change', onCardChange, { signal });
    cardList.addEventListener('click', onCardClick, { signal });
    cardList.addEventListener('keydown', onKeyDown, { signal });
    cardList.addEventListener('dragstart', onDragStart, { signal });
    cardList.addEventListener('dragover', onDragOver, { signal });
    cardList.addEventListener('drop', onDrop, { signal });
    cardList.addEventListener('dragend', onDragEnd, { signal });
  }

  function destroy() {
    abortController?.abort();
    abortController = null;
  }

  return { mount, destroy, open, close, getBatchText, getSnapshotCards };
}

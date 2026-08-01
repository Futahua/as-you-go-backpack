import { setPickupPrompt } from '../../workspace-model-20260730b.js';

/** Owns the pickup-prompt editor opened by right-clicking the copy button.
 * Editing the prompt persists it to the project's view state (a non-history
 * view change) and falls back to the built-in prompt when empty. */
export function createPickupPromptEditor({ document, store, fallbackPrompt }) {
  let abortController = null;
  const layer = document.querySelector('#prompt-layer');
  const textarea = document.querySelector('#prompt-input');
  const error = document.querySelector('#prompt-error');
  const cancel = document.querySelector('#prompt-cancel');
  const save = document.querySelector('#prompt-save');
  const copyButton = document.querySelector('#copy-prompt');

  function currentPrompt() {
    const stored = store.getSnapshot().view?.pickupPrompt;
    return typeof stored === 'string' && stored ? stored : fallbackPrompt;
  }

  function open() {
    textarea.value = currentPrompt();
    error.textContent = '';
    layer.hidden = false;
    textarea.focus();
  }

  function close() {
    layer.hidden = true;
  }

  async function commit() {
    const text = textarea.value;
    const next = setPickupPrompt(store.getSnapshot(), text.trim() ? text : null);
    store.replace(next);
    await store.save(next);
    close();
  }

  function mount() {
    abortController = new AbortController();
    const signal = abortController.signal;
    copyButton.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      open();
    }, { signal });
    cancel.addEventListener('click', close, { signal });
    save.addEventListener('click', async () => {
      try {
        await commit();
      } catch (caught) {
        error.textContent = caught instanceof Error ? caught.message : String(caught);
      }
    }, { signal });
  }

  function destroy() {
    abortController?.abort();
    abortController = null;
  }

  return { mount, destroy, getPromptText: currentPrompt };
}

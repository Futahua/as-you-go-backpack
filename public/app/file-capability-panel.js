const SEARCH_DEBOUNCE_MS = 120;
const VERIFY_ATTEMPTS = 40;
const VERIFY_DELAY_MS = 250;

export function isAbsoluteWindowsPath(value) {
  return typeof value === 'string'
    && (/^[A-Za-z]:[\\/]/.test(value) || /^\\\\[^\\]+\\[^\\]+/.test(value));
}

function basename(target) {
  const normalized = String(target || '').replace(/[\\/]+$/, '');
  const slash = Math.max(normalized.lastIndexOf('\\'), normalized.lastIndexOf('/'));
  return slash >= 0 ? normalized.slice(slash + 1) : normalized;
}

function dirname(target) {
  const normalized = String(target || '').replace(/[\\/]+$/, '');
  const slash = Math.max(normalized.lastIndexOf('\\'), normalized.lastIndexOf('/'));
  if (slash <= 2 && /^[A-Za-z]:/.test(normalized)) return normalized.slice(0, Math.max(3, slash + 1));
  return slash > 0 ? normalized.slice(0, slash) : normalized;
}

function joinPath(parent, leaf) {
  return String(parent || '').replace(/[\\/]+$/, '') + '\\' + leaf;
}

function formatBytes(value) {
  if (!Number.isFinite(value) || value < 0) return '';
  if (value < 1024) return String(value) + ' B';
  const units = ['KB', 'MB', 'GB', 'TB'];
  let current = value / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && current >= 1024; index += 1) {
    current /= 1024;
    unit = units[index];
  }
  return (current >= 10 ? current.toFixed(0) : current.toFixed(1)) + ' ' + unit;
}

function normalizePickerTarget(result) {
  if (typeof result === 'string') return result;
  if (result && typeof result === 'object' && typeof result.target === 'string') return result.target;
  return null;
}

function createButton(documentRef, label, className) {
  const button = documentRef.createElement('button');
  button.type = 'button';
  button.textContent = label;
  if (className) button.className = className;
  return button;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPathState(host, options) {
  for (let attempt = 0; attempt < VERIFY_ATTEMPTS; attempt += 1) {
    let presentOk = options.present == null;
    let absentOk = options.absent == null;
    if (options.present != null) {
      const result = await host.fileCapability('stat', { path: options.present }).catch(() => null);
      presentOk = result && result.ok === true;
    }
    if (options.absent != null) {
      const result = await host.fileCapability('stat', { path: options.absent }).catch(() => null);
      absentOk = result && result.ok === false && result.code === 'ENOENT';
    }
    if (presentOk && absentOk) return true;
    await sleep(VERIFY_DELAY_MS);
  }
  return false;
}

export function createFileCapabilityPanel(options) {
  const documentRef = options.document;
  const host = options.host;
  const setStatus = options.setStatus || (() => {});
  const retargetShortcut = options.retargetShortcut || (async () => false);

  if (!documentRef || !documentRef.body || !host || !host.fileCapability) {
    return Object.freeze({ syncSelection() {}, openSearch() {}, destroy() {}, isOpen: () => false });
  }

  const state = {
    open: false,
    context: null,
    inspectedPath: null,
    searchTimer: null,
    searchGeneration: 0,
    inspectGeneration: 0,
    deleteArmed: false,
    previewObjectUrl: null,
  };

  const launcher = createButton(documentRef, '⌕', 'file-capability-launcher');
  launcher.title = 'Files';
  launcher.setAttribute('aria-label', 'Open files');

  const panel = documentRef.createElement('aside');
  panel.className = 'file-capability-panel';
  panel.hidden = true;
  panel.setAttribute('aria-label', 'Files');

  const header = documentRef.createElement('header');
  header.className = 'file-capability-header';
  const title = documentRef.createElement('strong');
  title.textContent = 'Files';
  const providerStatus = documentRef.createElement('span');
  providerStatus.className = 'file-capability-provider-status';
  const closeButton = createButton(documentRef, '×', 'file-capability-close');
  closeButton.setAttribute('aria-label', 'Close files');
  header.append(title, providerStatus, closeButton);

  const searchWrap = documentRef.createElement('div');
  searchWrap.className = 'file-capability-search';
  const searchInput = documentRef.createElement('input');
  searchInput.type = 'search';
  searchInput.placeholder = 'Search all files';
  searchInput.autocomplete = 'off';
  searchInput.spellcheck = false;
  const searchHint = documentRef.createElement('span');
  searchHint.textContent = 'Everything';
  searchWrap.append(searchInput, searchHint);

  const body = documentRef.createElement('div');
  body.className = 'file-capability-body';

  const resultsPane = documentRef.createElement('section');
  resultsPane.className = 'file-capability-results';
  const resultsStatus = documentRef.createElement('div');
  resultsStatus.className = 'file-capability-results-status';
  resultsStatus.textContent = 'Type to search the whole machine.';
  const resultsList = documentRef.createElement('div');
  resultsList.className = 'file-capability-results-list';
  resultsPane.append(resultsStatus, resultsList);

  const inspector = documentRef.createElement('section');
  inspector.className = 'file-capability-inspector';
  const itemTitle = documentRef.createElement('strong');
  itemTitle.className = 'file-capability-item-title';
  itemTitle.textContent = 'Select a file';
  const itemMeta = documentRef.createElement('span');
  itemMeta.className = 'file-capability-item-meta';
  const pathRow = documentRef.createElement('div');
  pathRow.className = 'file-capability-path-row';
  const pathText = documentRef.createElement('code');
  pathText.className = 'file-capability-path';
  pathText.textContent = 'Select a local file or folder in As you Go.';
  const copyPathButton = createButton(documentRef, 'Copy path', 'file-capability-path-copy');
  copyPathButton.hidden = true;
  pathRow.append(pathText, copyPathButton);

  const actions = documentRef.createElement('div');
  actions.className = 'file-capability-actions';
  const openButton = createButton(documentRef, 'Open');
  const revealButton = createButton(documentRef, 'Reveal');
  const copyButton = createButton(documentRef, 'Copy to…');
  const moveButton = createButton(documentRef, 'Move to…');
  const renameButton = createButton(documentRef, 'Rename');
  const deleteButton = createButton(documentRef, 'Delete', 'file-capability-delete');
  actions.append(openButton, revealButton, copyButton, moveButton, renameButton, deleteButton);
  actions.hidden = true;

  const renameRow = documentRef.createElement('form');
  renameRow.className = 'file-capability-rename';
  renameRow.hidden = true;
  const renameInput = documentRef.createElement('input');
  renameInput.type = 'text';
  renameInput.maxLength = 255;
  renameInput.autocomplete = 'off';
  const renameSave = createButton(documentRef, 'Save');
  renameSave.type = 'submit';
  const renameCancel = createButton(documentRef, 'Cancel');
  renameRow.append(renameInput, renameSave, renameCancel);

  const preview = documentRef.createElement('div');
  preview.className = 'file-capability-preview';
  const initialPreview = documentRef.createElement('p');
  initialPreview.className = 'file-capability-empty';
  initialPreview.textContent = 'Preview appears here.';
  preview.append(initialPreview);

  inspector.append(itemTitle, itemMeta, pathRow, actions, renameRow, preview);
  body.append(resultsPane, inspector);
  panel.append(header, searchWrap, body);
  documentRef.body.append(panel, launcher);

  function setOpen(open) {
    state.open = Boolean(open);
    panel.hidden = !state.open;
    launcher.classList.toggle('active', state.open);
    launcher.setAttribute('aria-pressed', String(state.open));
    if (state.open && !providerStatus.textContent) {
      void host.fileCapability('providers', {}).then((result) => {
        if (!result || !result.ok || !result.providers) return;
        const names = [];
        if (result.providers.everything) names.push('Everything');
        if (result.providers.directoryOpus) names.push('Opus');
        if (result.providers.libreOffice) names.push('LibreOffice');
        providerStatus.textContent = names.join(' · ');
      }).catch(() => {});
    }
  }

  function disarmDelete() {
    state.deleteArmed = false;
    deleteButton.classList.remove('armed');
    deleteButton.textContent = 'Delete';
  }

  function setBusy(button, busy, busyText) {
    if (busy) {
      button.dataset.previousText = button.textContent;
      button.textContent = busyText || 'Working…';
      button.disabled = true;
      return;
    }
    button.textContent = button.dataset.previousText || button.textContent;
    delete button.dataset.previousText;
    button.disabled = false;
  }

  function clearPreview() {
    if (state.previewObjectUrl) {
      URL.revokeObjectURL(state.previewObjectUrl);
      state.previewObjectUrl = null;
    }
    preview.replaceChildren();
  }

  function previewBlobUrl(data) {
    if (!data || typeof data.dataUrl !== 'string') return null;
    const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/.exec(data.dataUrl);
    if (!match) return null;
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    state.previewObjectUrl = URL.createObjectURL(new Blob([bytes], { type: data.mime || match[1] }));
    return state.previewObjectUrl;
  }

  function renderEntry(entry) {
    if (!entry) {
      itemTitle.textContent = basename(state.inspectedPath) || 'File';
      itemMeta.textContent = '';
      return;
    }
    itemTitle.textContent = entry.name || basename(entry.path);
    const meta = [];
    meta.push(entry.kind === 'folder' ? 'Folder' : (entry.extension || 'File'));
    if (entry.kind === 'file' && Number.isFinite(entry.size)) meta.push(formatBytes(entry.size));
    if (Number.isFinite(entry.modifiedAt)) {
      try { meta.push(new Date(entry.modifiedAt).toLocaleString()); } catch {}
    }
    itemMeta.textContent = meta.filter(Boolean).join(' · ');
  }

  function renderDirectory(items) {
    clearPreview();
    const list = documentRef.createElement('div');
    list.className = 'file-capability-directory';
    for (const entry of items || []) {
      const button = createButton(documentRef, '', 'file-capability-directory-entry');
      const name = documentRef.createElement('strong');
      name.textContent = entry.name;
      const meta = documentRef.createElement('span');
      meta.textContent = entry.kind === 'folder' ? 'Folder' : formatBytes(entry.size);
      button.append(name, meta);
      button.addEventListener('click', () => void inspectPath(entry.path, null));
      list.append(button);
    }
    if (!list.childElementCount) {
      const empty = documentRef.createElement('p');
      empty.className = 'file-capability-empty';
      empty.textContent = 'This folder is empty.';
      list.append(empty);
    }
    preview.append(list);
  }

  function renderPreview(result) {
    clearPreview();
    if (!result || !result.ok) {
      const message = documentRef.createElement('p');
      message.className = 'file-capability-empty file-capability-error';
      message.textContent = result && result.message ? result.message : 'This item could not be inspected.';
      preview.append(message);
      return;
    }
    const data = result.preview || {};
    if (data.kind === 'image') {
      const image = documentRef.createElement('img');
      image.src = data.dataUrl;
      image.alt = itemTitle.textContent || '';
      image.className = 'file-capability-preview-image';
      preview.append(image);
      return;
    }
    if (data.kind === 'pdf') {
      const source = previewBlobUrl(data);
      if (source) {
        const frame = documentRef.createElement('iframe');
        frame.src = source;
        frame.title = itemTitle.textContent || 'PDF preview';
        frame.className = 'file-capability-preview-frame';
        preview.append(frame);
        return;
      }
    }
    if (data.kind === 'audio' || data.kind === 'video') {
      const source = previewBlobUrl(data);
      if (source) {
        const media = documentRef.createElement(data.kind);
        media.src = source;
        media.controls = true;
        media.className = 'file-capability-preview-' + data.kind;
        preview.append(media);
        return;
      }
    }
    if (data.kind === 'text') {
      const pre = documentRef.createElement('pre');
      pre.className = 'file-capability-preview-text';
      pre.textContent = data.text || '';
      preview.append(pre);
      return;
    }
    if (data.kind === 'directory') {
      renderDirectory(Array.isArray(data.items) ? data.items : []);
      return;
    }
    if (data.kind === 'binary') {
      const strings = Array.isArray(data.strings) ? data.strings : [];
      if (strings.length) {
        const details = documentRef.createElement('details');
        details.open = true;
        const summary = documentRef.createElement('summary');
        summary.textContent = 'Strings';
        const pre = documentRef.createElement('pre');
        pre.className = 'file-capability-preview-text';
        pre.textContent = strings.join('\n');
        details.append(summary, pre);
        preview.append(details);
      }
      const details = documentRef.createElement('details');
      details.open = strings.length === 0;
      const summary = documentRef.createElement('summary');
      summary.textContent = 'Hex';
      const pre = documentRef.createElement('pre');
      pre.className = 'file-capability-preview-hex';
      pre.textContent = data.hex || '';
      details.append(summary, pre);
      preview.append(details);
      return;
    }
    const message = documentRef.createElement('p');
    message.className = 'file-capability-empty';
    message.textContent = 'No preview data was returned.';
    preview.append(message);
  }

  async function inspectPath(target, context) {
    if (!isAbsoluteWindowsPath(target)) return false;
    const generation = ++state.inspectGeneration;
    state.inspectedPath = target;
    if (context !== undefined) state.context = context;
    setOpen(true);
    disarmDelete();
    renameRow.hidden = true;
    itemTitle.textContent = basename(target) || target;
    itemMeta.textContent = 'Loading…';
    pathText.textContent = target;
    copyPathButton.hidden = false;
    actions.hidden = false;
    clearPreview();
    const loading = documentRef.createElement('p');
    loading.className = 'file-capability-empty';
    loading.textContent = 'Loading preview…';
    preview.append(loading);

    const result = await host.fileCapability('preview', { path: target }).catch((error) => ({
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    }));
    if (generation !== state.inspectGeneration) return false;
    renderEntry(result && result.entry);
    renderPreview(result);
    return result && result.ok === true;
  }

  function renderSearchResults(result, query) {
    resultsList.replaceChildren();
    if (!query) {
      resultsStatus.textContent = 'Type to search the whole machine.';
      return;
    }
    if (!result || !result.ok) {
      resultsStatus.textContent = result && result.message ? result.message : 'Everything search is unavailable.';
      return;
    }
    const rows = Array.isArray(result.results) ? result.results : [];
    const total = Number.isFinite(result.total) ? result.total : rows.length;
    resultsStatus.textContent = total.toLocaleString() + ' result' + (total === 1 ? '' : 's');
    for (const entry of rows) {
      const button = createButton(documentRef, '', 'file-capability-result');
      const name = documentRef.createElement('strong');
      name.textContent = entry.name;
      const parent = documentRef.createElement('span');
      parent.textContent = dirname(entry.path);
      const meta = documentRef.createElement('small');
      meta.textContent = entry.kind === 'folder' ? 'Folder' : formatBytes(entry.size);
      button.append(name, parent, meta);
      button.addEventListener('click', () => void inspectPath(entry.path, null));
      resultsList.append(button);
    }
    if (!rows.length) {
      const empty = documentRef.createElement('p');
      empty.className = 'file-capability-empty';
      empty.textContent = 'No matches.';
      resultsList.append(empty);
    }
  }

  async function runSearch(query) {
    const generation = ++state.searchGeneration;
    const trimmed = query.trim();
    if (!trimmed) {
      renderSearchResults({ ok: true, results: [], total: 0 }, '');
      return;
    }
    resultsStatus.textContent = 'Searching…';
    const result = await host.fileCapability('search', { query: trimmed, limit: 150 }).catch((error) => ({
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      results: [],
    }));
    if (generation !== state.searchGeneration) return;
    renderSearchResults(result, trimmed);
  }

  async function chooseDestination() {
    const picked = await host.pickTarget('folder').catch(() => null);
    const target = normalizePickerTarget(picked);
    return isAbsoluteWindowsPath(target) ? target : null;
  }

  async function verifyAndRetarget(oldPath, expectedPath) {
    if (!state.context || !state.context.shortcutId) return false;
    const verified = await waitForPathState(host, { present: expectedPath, absent: oldPath });
    if (!verified) return false;
    const nextName = state.context.name === basename(oldPath) ? basename(expectedPath) : state.context.name;
    const changed = await retargetShortcut({
      shortcutId: state.context.shortcutId,
      oldPath,
      newPath: expectedPath,
      nextName,
    });
    if (changed) state.context = { shortcutId: state.context.shortcutId, path: expectedPath, name: nextName };
    return changed;
  }

  launcher.addEventListener('click', () => {
    setOpen(!state.open);
    if (state.open) searchInput.focus();
  });
  closeButton.addEventListener('click', () => setOpen(false));
  searchInput.addEventListener('input', () => {
    if (state.searchTimer) clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => {
      state.searchTimer = null;
      void runSearch(searchInput.value);
    }, SEARCH_DEBOUNCE_MS);
  });

  copyPathButton.addEventListener('click', () => {
    if (!state.inspectedPath) return;
    void host.copyText(state.inspectedPath)
      .then(() => setStatus('Path copied.', { level: 'success' }))
      .catch((error) => setStatus(error instanceof Error ? error.message : String(error)));
  });
  openButton.addEventListener('click', () => {
    if (!state.inspectedPath) return;
    void host.fileCapability('open', { path: state.inspectedPath }).then((result) => {
      if (!result || !result.ok) setStatus(result && result.message ? result.message : 'Could not open that item.');
    });
  });
  revealButton.addEventListener('click', () => {
    if (!state.inspectedPath) return;
    void host.fileCapability('reveal', { path: state.inspectedPath }).then((result) => {
      if (!result || !result.ok) setStatus(result && result.message ? result.message : 'Could not reveal that item.');
    });
  });
  copyButton.addEventListener('click', async () => {
    const source = state.inspectedPath;
    const destination = source ? await chooseDestination() : null;
    if (!source || !destination) return;
    setBusy(copyButton, true, 'Copying…');
    try {
      const result = await host.fileCapability('copy', { paths: [source], destination });
      if (!result || !result.ok) throw new Error(result && result.message ? result.message : 'Copy failed.');
      setStatus('Copy sent to Directory Opus.', { level: 'success' });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(copyButton, false);
    }
  });
  moveButton.addEventListener('click', async () => {
    const source = state.inspectedPath;
    const destination = source ? await chooseDestination() : null;
    if (!source || !destination) return;
    const expected = joinPath(destination, basename(source));
    setBusy(moveButton, true, 'Moving…');
    try {
      const result = await host.fileCapability('move', { paths: [source], destination });
      if (!result || !result.ok) throw new Error(result && result.message ? result.message : 'Move failed.');
      const retargeted = await verifyAndRetarget(source, expected);
      if (state.context && state.context.shortcutId && !retargeted) {
        setStatus('Move was submitted, but the new path was not verified; the AYG reference was left unchanged.');
        return;
      }
      setStatus('Moved with Directory Opus.', { level: 'success' });
      await inspectPath(expected, state.context);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(moveButton, false);
    }
  });
  renameButton.addEventListener('click', () => {
    if (!state.inspectedPath) return;
    renameInput.value = basename(state.inspectedPath);
    renameRow.hidden = false;
    renameInput.focus();
    renameInput.select();
  });
  renameCancel.addEventListener('click', () => { renameRow.hidden = true; });
  renameRow.addEventListener('submit', async (event) => {
    event.preventDefault();
    const source = state.inspectedPath;
    const newName = renameInput.value.trim();
    if (!source || !newName || newName === basename(source)) {
      renameRow.hidden = true;
      return;
    }
    const expected = joinPath(dirname(source), newName);
    setBusy(renameSave, true, 'Renaming…');
    try {
      const result = await host.fileCapability('rename', { path: source, newName });
      if (!result || !result.ok) throw new Error(result && result.message ? result.message : 'Rename failed.');
      const retargeted = await verifyAndRetarget(source, expected);
      if (state.context && state.context.shortcutId && !retargeted) {
        setStatus('Rename was submitted, but the new path was not verified; the AYG reference was left unchanged.');
        return;
      }
      renameRow.hidden = true;
      setStatus('Renamed with Directory Opus.', { level: 'success' });
      await inspectPath(expected, state.context);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(renameSave, false);
    }
  });
  deleteButton.addEventListener('pointerleave', disarmDelete);
  deleteButton.addEventListener('click', async () => {
    const target = state.inspectedPath;
    if (!target) return;
    if (!state.deleteArmed) {
      state.deleteArmed = true;
      deleteButton.classList.add('armed');
      deleteButton.textContent = 'Delete again';
      return;
    }
    disarmDelete();
    setBusy(deleteButton, true, 'Deleting…');
    try {
      const result = await host.fileCapability('delete', { paths: [target] });
      if (!result || !result.ok) throw new Error(result && result.message ? result.message : 'Delete failed.');
      const removed = await waitForPathState(host, { absent: target });
      if (!removed) {
        setStatus('Directory Opus accepted the recycle request, but disappearance was not verified.');
        return;
      }
      setStatus('Moved to Recycle Bin. The AYG reference was kept.', { level: 'success' });
      itemMeta.textContent = 'Missing';
      clearPreview();
      const message = documentRef.createElement('p');
      message.className = 'file-capability-empty';
      message.textContent = 'The file is now in Recycle Bin. This As you Go reference is still here.';
      preview.append(message);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(deleteButton, false);
    }
  });

  panel.addEventListener('pointerdown', (event) => event.stopPropagation());
  panel.addEventListener('click', (event) => event.stopPropagation());
  launcher.addEventListener('pointerdown', (event) => event.stopPropagation());

  function syncSelection(context) {
    const next = context && isAbsoluteWindowsPath(context.path)
      ? { shortcutId: context.shortcutId || null, path: context.path, name: context.name || basename(context.path) }
      : null;
    const same = next && state.context
      && next.shortcutId === state.context.shortcutId
      && next.path === state.context.path;
    state.context = next;
    if (!next) return;
    if (!same || state.inspectedPath !== next.path) void inspectPath(next.path, next);
  }

  return Object.freeze({
    syncSelection,
    openSearch() {
      setOpen(true);
      searchInput.focus();
      searchInput.select();
    },
    destroy() {
      if (state.searchTimer) clearTimeout(state.searchTimer);
      clearPreview();
      panel.remove();
      launcher.remove();
    },
    isOpen: () => state.open,
  });
}

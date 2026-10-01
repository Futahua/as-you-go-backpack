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

function setButtonSvg(documentRef, button, label, paths) {
  const svg = documentRef.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('aria-hidden', 'true');
  for (const definition of paths) {
    const node = documentRef.createElementNS('http://www.w3.org/2000/svg', 'path');
    node.setAttribute('d', definition);
    node.setAttribute('fill', 'none');
    node.setAttribute('stroke', 'currentColor');
    node.setAttribute('stroke-width', '1.5');
    node.setAttribute('stroke-linecap', 'round');
    node.setAttribute('stroke-linejoin', 'round');
    svg.append(node);
  }
  button.replaceChildren(svg);
  button.title = label;
  button.setAttribute('aria-label', label);
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
    expanded: false,
    width: 380,
    resizing: false,
    context: null,
    inspectedPath: null,
    searchTimer: null,
    searchGeneration: 0,
    inspectGeneration: 0,
    deleteArmed: false,
    previewObjectUrl: null,
    previewResourceId: null,
    nativePreviewSessionId: null,
    nativePreviewObserver: null,
    pdfPreviewSessionId: null,
    pdfPreviewObserver: null,
    lastPreviewResult: null,
  };

  const workspace = documentRef.querySelector('.workspace');
  const panel = documentRef.createElement('aside');
  panel.className = 'file-capability-panel';
  panel.setAttribute('aria-label', 'File preview');
  panel.style.setProperty('--file-capability-width', state.width + 'px');
  workspace?.style.setProperty('--file-capability-width', state.width + 'px');
  workspace?.classList.add('file-capability-docked');
  const resizer = documentRef.createElement('div');
  resizer.className = 'file-capability-resizer';
  resizer.setAttribute('role', 'separator');
  resizer.setAttribute('aria-orientation', 'vertical');
  resizer.setAttribute('aria-label', 'Resize file preview');

  const header = documentRef.createElement('header');
  header.className = 'file-capability-header';
  const title = documentRef.createElement('strong');
  title.textContent = 'Preview';
  const providerStatus = documentRef.createElement('span');
  providerStatus.className = 'file-capability-provider-status';
  const expandButton = createButton(documentRef, 'Expand', 'file-capability-expand');
  expandButton.setAttribute('aria-label', 'Expand file preview');
  expandButton.setAttribute('aria-pressed', 'false');
  header.append(title, expandButton);

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
  const copyPathButton = createButton(documentRef, 'Copy path', 'file-capability-icon-button');
  copyPathButton.hidden = true;
  setButtonSvg(documentRef, copyPathButton, 'Copy path', ['M6.5 6.5h8v8h-8z', 'M4 11.5H3.5A1.5 1.5 0 0 1 2 10V3.5A1.5 1.5 0 0 1 3.5 2H10A1.5 1.5 0 0 1 11.5 3.5V4']);
  pathRow.append(pathText);

  const actions = documentRef.createElement('div');
  actions.className = 'file-capability-actions';
  const openButton = createButton(documentRef, 'Open');
  const revealButton = createButton(documentRef, 'Reveal', 'file-capability-icon-button');
  revealButton.hidden = true;
  setButtonSvg(documentRef, revealButton, 'Reveal in file manager', ['M2.5 5.5h5l1.4 1.7h8.6v8.3A1.5 1.5 0 0 1 16 17H4a1.5 1.5 0 0 1-1.5-1.5z', 'M2.5 8h15']);
  pathRow.append(revealButton, copyPathButton);
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

  inspector.append(itemTitle, itemMeta, pathRow, preview);
  resultsPane.hidden = true;
  body.append(inspector);
  panel.append(resizer, header, body);
  documentRef.body.append(panel);

  function loadProviders() {
    if (providerStatus.textContent) return;
    void host.fileCapability('providers', {}).then((result) => {
      if (!result || !result.ok || !result.providers) return;
      const names = [];
      if (result.providers.everything) names.push('Everything');
      if (result.providers.directoryOpus) names.push('Opus');
      if (result.providers.libreOffice) names.push('LibreOffice');
      providerStatus.textContent = names.join(' · ');
    }).catch(() => {});
  }

  function setExpanded(expanded) {
    state.expanded = Boolean(expanded);
    panel.classList.toggle('expanded', state.expanded);
    workspace?.classList.toggle('file-capability-expanded', state.expanded);
    expandButton.textContent = state.expanded ? 'Collapse' : 'Expand';
    expandButton.setAttribute('aria-label', state.expanded ? 'Collapse file preview' : 'Expand file preview');
    expandButton.setAttribute('aria-pressed', String(state.expanded));
  }

  function setPanelWidth(width) {
    const viewportWidth = documentRef.defaultView?.innerWidth ?? 1200;
    const maxWidth = Math.max(300, Math.min(900, Math.floor(viewportWidth * 0.75)));
    state.width = Math.max(300, Math.min(maxWidth, Math.round(width)));
    panel.style.setProperty('--file-capability-width', state.width + 'px');
    workspace?.style.setProperty('--file-capability-width', state.width + 'px');
  }

  loadProviders();

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

  function releasePreviewResource(resourceId = state.previewResourceId) {
    if (!resourceId) return;
    if (resourceId === state.previewResourceId) state.previewResourceId = null;
    void host.fileCapability('preview-release', { resourceId }).catch(() => {});
  }

  function closeNativePreview() {
    state.nativePreviewObserver?.disconnect();
    state.nativePreviewObserver = null;
    const sessionId = state.nativePreviewSessionId;
    state.nativePreviewSessionId = null;
    if (sessionId) void host.fileCapability('preview-native-close', { sessionId }).catch(() => {});
  }

  function closePdfPreview() {
    state.pdfPreviewObserver?.disconnect();
    state.pdfPreviewObserver = null;
    const sessionId = state.pdfPreviewSessionId;
    state.pdfPreviewSessionId = null;
    if (sessionId) void host.fileCapability('preview-pdf-close', { sessionId }).catch(() => {});
  }

  function clearPreview() {
    closeNativePreview();
    closePdfPreview();
    releasePreviewResource();
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

  function previewSource(data) {
    if (data && typeof data.url === 'string') {
      try {
        const parsed = new URL(data.url);
        if (parsed.protocol === 'papers-file-preview:') return parsed.toString();
      } catch {}
    }
    return previewBlobUrl(data);
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

  function nativePreviewRect(node) {
    const rect = node.getBoundingClientRect();
    return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)) };
  }

  async function startNativePreview(data) {
    const target = state.inspectedPath;
    const generation = state.inspectGeneration;
    const surface = documentRef.createElement('div');
    surface.className = 'file-capability-native-preview';
    preview.append(surface);
    if (!state.expanded || !target) {
      surface.textContent = 'Expand the preview pane to show the Windows preview.';
      return;
    }
    await new Promise((resolve) => (documentRef.defaultView?.requestAnimationFrame ?? ((callback) => setTimeout(callback, 0)))(resolve));
    if (generation !== state.inspectGeneration || state.inspectedPath !== target) return;
    const opened = await host.fileCapability('preview-native-open', { path: target, rect: nativePreviewRect(surface) }).catch((error) => ({ ok: false, message: error instanceof Error ? error.message : String(error) }));
    if (generation !== state.inspectGeneration || state.inspectedPath !== target) {
      if (opened && opened.ok && typeof opened.sessionId === 'string') void host.fileCapability('preview-native-close', { sessionId: opened.sessionId }).catch(() => {});
      return;
    }
    if (!opened || !opened.ok || typeof opened.sessionId !== 'string') {
      surface.textContent = opened && opened.message ? opened.message : 'Windows preview could not be hosted.';
      return;
    }
    state.nativePreviewSessionId = opened.sessionId;
    const move = () => {
      if (!state.nativePreviewSessionId || !state.expanded) return;
      void host.fileCapability('preview-native-move', { sessionId: state.nativePreviewSessionId, rect: nativePreviewRect(surface) }).catch(() => {});
    };
    if (typeof ResizeObserver === 'function') {
      state.nativePreviewObserver = new ResizeObserver(move);
      state.nativePreviewObserver.observe(surface);
    }
    documentRef.defaultView?.addEventListener('resize', move, { passive: true, once: true });
  }

  async function startPdfPreview(data) {
    const target = state.inspectedPath;
    const generation = state.inspectGeneration;
    const resourceId = typeof data.resourceId === 'string' ? data.resourceId : null;
    const surface = documentRef.createElement('div');
    surface.className = 'file-capability-native-preview';
    preview.append(surface);
    if (!resourceId) {
      surface.textContent = 'PDF preview resource is unavailable.';
      return;
    }
    if (!state.expanded || !target) {
      surface.textContent = 'Expand the preview pane to show the PDF.';
      return;
    }
    await new Promise((resolve) => (documentRef.defaultView?.requestAnimationFrame ?? ((callback) => setTimeout(callback, 0)))(resolve));
    if (generation !== state.inspectGeneration || state.inspectedPath !== target) {
      releasePreviewResource(resourceId);
      return;
    }

    if (state.previewResourceId === resourceId) state.previewResourceId = null;
    const opened = await host.fileCapability('preview-pdf-open', {
      resourceId,
      rect: nativePreviewRect(surface),
    }).catch((error) => {
      releasePreviewResource(resourceId);
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    });
    if (generation !== state.inspectGeneration || state.inspectedPath !== target) {
      if (opened && opened.ok && typeof opened.sessionId === 'string') {
        void host.fileCapability('preview-pdf-close', { sessionId: opened.sessionId }).catch(() => {});
      } else {
        releasePreviewResource(resourceId);
      }
      return;
    }
    if (!opened || !opened.ok || typeof opened.sessionId !== 'string') {
      releasePreviewResource(resourceId);
      surface.textContent = opened && opened.message ? opened.message : 'PDF preview could not be hosted.';
      return;
    }
    state.pdfPreviewSessionId = opened.sessionId;
    const move = () => {
      if (!state.pdfPreviewSessionId || !state.expanded) return;
      void host.fileCapability('preview-pdf-move', {
        sessionId: state.pdfPreviewSessionId,
        rect: nativePreviewRect(surface),
      }).catch(() => {});
    };
    if (typeof ResizeObserver === 'function') {
      state.pdfPreviewObserver = new ResizeObserver(move);
      state.pdfPreviewObserver.observe(surface);
    }
    documentRef.defaultView?.addEventListener('resize', move, { passive: true, once: true });
  }

  function renderPreview(result) {
    clearPreview();
    state.lastPreviewResult = result;
    if (!result || !result.ok) {
      const message = documentRef.createElement('p');
      message.className = 'file-capability-empty file-capability-error';
      message.textContent = result && result.message ? result.message : 'This item could not be inspected.';
      preview.append(message);
      return;
    }
    const data = result.preview || {};
    if (data.kind === 'windows-preview-handler') {
      void startNativePreview(data);
      return;
    }
    if (typeof data.resourceId === 'string') state.previewResourceId = data.resourceId;
    if (data.kind === 'hosted-pdf') {
      void startPdfPreview(data);
      return;
    }
    if (data.kind === 'image') {
      const source = previewSource(data);
      if (source) {
        const image = documentRef.createElement('img');
        image.src = source;
        image.alt = itemTitle.textContent || '';
        image.className = 'file-capability-preview-image';
        preview.append(image);
        return;
      }
    }
    if (data.kind === 'pdf') {
      const source = previewSource(data);
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
      const source = previewSource(data);
      if (source) {
        const media = documentRef.createElement(data.kind);
        media.src = source;
        media.controls = true;
        media.preload = 'metadata';
        media.className = 'file-capability-preview-' + data.kind;
        preview.append(media);
        return;
      }
    }
    if (data.kind === 'text') {
      const scroller = documentRef.createElement('div');
      scroller.className = 'file-capability-text-scroller';
      const pre = documentRef.createElement('pre');
      pre.className = 'file-capability-preview-text';
      pre.textContent = data.text || '';
      scroller.append(pre);
      preview.append(scroller);

      let nextOffset = Number.isSafeInteger(data.nextOffset) ? data.nextOffset : 0;
      let eof = data.eof === true;
      let loading = false;
      const target = state.inspectedPath;
      const generation = state.inspectGeneration;
      const loadMore = async () => {
        if (loading || eof || !target || generation !== state.inspectGeneration || state.inspectedPath !== target) return;
        loading = true;
        try {
          const chunk = await host.fileCapability('preview-text-chunk', {
            path: target,
            offset: nextOffset,
          });
          if (generation !== state.inspectGeneration || state.inspectedPath !== target) return;
          if (!chunk || !chunk.ok) throw new Error(chunk && chunk.message ? chunk.message : 'Could not continue text preview.');
          if (typeof chunk.text === 'string') pre.textContent += chunk.text;
          if (Number.isSafeInteger(chunk.nextOffset)) nextOffset = chunk.nextOffset;
          eof = chunk.eof === true;
        } catch (error) {
          setStatus(error instanceof Error ? error.message : String(error));
          eof = true;
        } finally {
          loading = false;
        }
      };
      scroller.addEventListener('scroll', () => {
        if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 320) void loadMore();
      }, { passive: true });
      if (!eof && scroller.scrollHeight <= scroller.clientHeight + 320) void loadMore();
      return;
    }
    if (data.kind === 'directory') {
      const message = documentRef.createElement('p');
      message.className = 'file-capability-empty';
      message.textContent = 'Folder navigation stays in your file manager.';
      preview.append(message);
      return;
    }
    if (data.kind === 'binary') {
      const message = documentRef.createElement('p');
      message.className = 'file-capability-empty';
      message.textContent = 'No visual preview available yet.';
      preview.append(message);
      return;
    }
    const message = documentRef.createElement('p');
    message.className = 'file-capability-empty';
    message.textContent = 'No preview data was returned.';
    preview.append(message);
  }

  function renderEmptySelection(selectionCount = 0) {
    ++state.inspectGeneration;
    state.context = null;
    state.inspectedPath = null;
    state.lastPreviewResult = null;
    disarmDelete();
    renameRow.hidden = true;
    itemTitle.textContent = selectionCount > 0 ? `${selectionCount} item${selectionCount === 1 ? '' : 's'} selected` : 'Select a file';
    itemMeta.textContent = selectionCount > 0 ? 'No local file content in this selection yet.' : '';
    pathText.textContent = selectionCount > 0 ? 'Selection stays fully controlled by As you Go.' : 'Select a local file or folder in As you Go.';
    copyPathButton.hidden = true;
    revealButton.hidden = true;
    actions.hidden = true;
    clearPreview();
    const message = documentRef.createElement('p');
    message.className = 'file-capability-empty';
    message.textContent = selectionCount > 0
      ? 'The file pane is observing this selection without changing how AYG selection or dragging works.'
      : 'Preview appears here.';
    preview.append(message);
  }

  function renderMultipleSelection(selection) {
    ++state.inspectGeneration;
    state.context = null;
    state.inspectedPath = null;
    state.lastPreviewResult = null;
    const count = Number.isSafeInteger(selection?.selectionCount) ? selection.selectionCount : selection.items.length;
    itemTitle.textContent = `${count} items selected`;
    itemMeta.textContent = '';
    pathText.textContent = 'Multiple preview is not defined yet.';
    copyPathButton.hidden = true;
    revealButton.hidden = true;
    clearPreview();
    const message = documentRef.createElement('p');
    message.className = 'file-capability-empty';
    message.textContent = 'Multiple preview will take shape here.';
    preview.append(message);
  }

  async function inspectPath(target, context) {
    if (!isAbsoluteWindowsPath(target)) return false;
    const generation = ++state.inspectGeneration;
    state.inspectedPath = target;
    if (context !== undefined) state.context = context;
    disarmDelete();
    renameRow.hidden = true;
    itemTitle.textContent = basename(target) || target;
    itemMeta.textContent = 'Loading…';
    pathText.textContent = target;
    copyPathButton.hidden = false;
    revealButton.hidden = false;
    state.lastPreviewResult = null;
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
    if (generation !== state.inspectGeneration) {
      const staleResourceId = result && result.preview && typeof result.preview.resourceId === 'string'
        ? result.preview.resourceId
        : null;
      if (staleResourceId) releasePreviewResource(staleResourceId);
      return false;
    }
    renderEntry(result && result.entry);
    renderPreview(result);
    return result && result.ok === true;
  }

  function renderSearchResults(result, query) {
    resultsList.replaceChildren();
    if (!query) {
      resultsPane.hidden = true;
      resultsStatus.textContent = 'Type to search the whole machine.';
      return;
    }
    resultsPane.hidden = false;
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

  expandButton.addEventListener('click', () => {
    const next = !state.expanded;
    setExpanded(next);
    if (!next) {
      closeNativePreview();
      closePdfPreview();
    }
    else if (state.lastPreviewResult?.preview?.kind === 'windows-preview-handler') renderPreview(state.lastPreviewResult);
    else if (state.lastPreviewResult?.preview?.kind === 'hosted-pdf' && state.inspectedPath) {
      void inspectPath(state.inspectedPath, state.context);
    }
  });
  resizer.addEventListener('pointerdown', (event) => {
    if (!state.expanded || event.button !== 0) return;
    state.resizing = true;
    panel.classList.add('resizing');
    resizer.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  });
  resizer.addEventListener('pointermove', (event) => {
    if (!state.resizing) return;
    const viewportWidth = documentRef.defaultView?.innerWidth ?? 0;
    if (viewportWidth > 0) setPanelWidth(viewportWidth - event.clientX - 8);
    event.preventDefault();
  });
  const finishResize = (event) => {
    if (!state.resizing) return;
    state.resizing = false;
    panel.classList.remove('resizing');
    if (resizer.hasPointerCapture?.(event.pointerId)) resizer.releasePointerCapture?.(event.pointerId);
  };
  resizer.addEventListener('pointerup', finishResize);
  resizer.addEventListener('pointercancel', finishResize);
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

  function syncSelection(selection) {
    if (selection?.mode === 'multiple') {
      renderMultipleSelection({
        selectionCount: selection.selectionCount,
        items: Array.isArray(selection.items) ? selection.items.filter((entry) => isAbsoluteWindowsPath(entry?.path)) : [],
      });
      return;
    }
    if (selection?.mode === 'empty') {
      renderEmptySelection(selection.selectionCount ?? 0);
      return;
    }
    const source = selection?.mode === 'single' ? selection.item : selection;
    const next = source && isAbsoluteWindowsPath(source.path)
      ? { shortcutId: source.shortcutId || null, path: source.path, name: source.name || basename(source.path) }
      : null;
    const same = next && state.context
      && next.shortcutId === state.context.shortcutId
      && next.path === state.context.path;
    state.context = next;
    if (!next) {
      renderEmptySelection(0);
      return;
    }
    if (!same || state.inspectedPath !== next.path) void inspectPath(next.path, next);
  }

  return Object.freeze({
    syncSelection,
    openSearch() {
      setExpanded(true);
    },
    destroy() {
      if (state.searchTimer) clearTimeout(state.searchTimer);
      clearPreview();
      workspace?.classList.remove('file-capability-docked', 'file-capability-expanded');
      workspace?.style.removeProperty('--file-capability-width');
      panel.remove();
    },
    isOpen: () => true,
    isExpanded: () => state.expanded,
  });
}

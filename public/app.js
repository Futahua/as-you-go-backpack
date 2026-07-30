const ROOT_ID = 'root';
const PICKUP_PROMPT = `You are picking up Papers and its Backpack projects.

Canonical Papers repository: https://github.com/Futahua/Papers-3
Primary-machine source checkout: D:\\Letters\\MatTroiSeConMoc\\PAPERS 3\\Papers-3

Before acting, read AGENTS.md and HERMES.md completely from the current repository, then follow the document map in README.md. Treat those current files as authoritative over this copied orientation.

I do not code or design technical architecture. I describe the experience I want; you must construct it, test it, protect my data, and explain the result in plain language. Clicking buttons, entering information, choosing files, opening applications, organizing work, and confirming actions are normal use—not configuration or permission to invent editors, frameworks, or product-wide abstractions.

Treat Backpacks as independently developed projects, closest to plugins in ownership. Backpack interfaces, behavior, and implementation belong outside Papers' main binaries unless a concrete requirement genuinely needs a Papers-host change. A local Backpack is local in experience, implementation, and data; its ordinary development must not create a Papers version or update other machines.

My request:
[Describe what you want to experience.]`;

const status = document.querySelector('#status');
const pending = new Map();
let state = { schemaVersion: 1, groups: [], shortcuts: [] };
let currentId = ROOT_ID;
let selected = new Set();
let editorMode = null;
let editorIcon = null;

function request(type, detail = {}) {
  const requestId = crypto.randomUUID();
  window.parent.postMessage({ type, requestId, ...detail }, '*');
  return new Promise((resolve, reject) => pending.set(requestId, { resolve, reject }));
}

function setStatus(text = '') { status.textContent = text; }
function group(id) { return state.groups.find((item) => item.id === id) ?? null; }
function currentGroup() { return group(currentId); }
function children(parentId = currentId) {
  return {
    groups: state.groups.filter((item) => item.parentId === parentId),
    shortcuts: state.shortcuts.filter((item) => item.parentId === parentId),
  };
}
function allGroups() {
  const result = [{ id: ROOT_ID, name: 'As you Go', depth: 0 }];
  const visit = (parentId, depth) => state.groups.filter((item) => item.parentId === parentId).forEach((item) => {
    result.push({ id: item.id, name: item.name, depth });
    visit(item.id, depth + 1);
  });
  visit(ROOT_ID, 1);
  return result;
}
function pathTo(id) {
  const path = [{ id: ROOT_ID, name: 'As you Go' }];
  const chain = [];
  let cursor = group(id);
  while (cursor) { chain.unshift({ id: cursor.id, name: cursor.name }); cursor = group(cursor.parentId); }
  return path.concat(chain);
}
function optionMarkup(groups, selectedId) {
  return groups.map((item) => `<option value="${item.id}" ${item.id === selectedId ? 'selected' : ''}>${'— '.repeat(item.depth)}${escapeHtml(item.name)}</option>`).join('');
}
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char])); }
function iconMarkup(item) { return item.icon ? `<img src="${item.icon}" alt="" />` : '<span aria-hidden="true">↗</span>'; }

function render() {
  const options = allGroups();
  document.querySelector('#location-select').innerHTML = optionMarkup(options, currentId);
  document.querySelector('#destination-select').innerHTML = optionMarkup(options, currentId);
  document.querySelector('#breadcrumbs').innerHTML = pathTo(currentId).map((item, index, path) => `<button type="button" data-breadcrumb="${item.id}">${escapeHtml(item.name)}</button>${index < path.length - 1 ? '<span aria-hidden="true">›</span>' : ''}`).join('');
  const list = document.querySelector('#explorer-list');
  const items = children();
  list.innerHTML = [...items.groups.map((item) => `<div class="explorer-row folder-row" data-id="${item.id}" data-kind="group"><input type="checkbox" ${selected.has(item.id) ? 'checked' : ''} aria-label="Select ${escapeHtml(item.name)}" /><button class="row-main" type="button"><span class="row-icon folder-icon">▱</span><span><strong>${escapeHtml(item.name)}</strong><small>Group</small></span></button><button class="row-more" type="button" data-rename="${item.id}">Rename</button></div>`), ...items.shortcuts.map((item) => `<div class="explorer-row" data-id="${item.id}" data-kind="shortcut"><input type="checkbox" ${selected.has(item.id) ? 'checked' : ''} aria-label="Select ${escapeHtml(item.name)}" /><button class="row-main" type="button"><span class="row-icon">${iconMarkup(item)}</span><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.description || 'Shortcut')}</small></span></button><button class="row-more" type="button" data-rename="${item.id}">Rename</button></div>`)].join('');
  document.querySelector('#empty').hidden = items.groups.length + items.shortcuts.length !== 0;
  const toolbar = document.querySelector('#selection-toolbar');
  toolbar.hidden = selected.size === 0;
  document.querySelector('#selection-count').textContent = `${selected.size} selected`;
}

async function persist() {
  await request('papers:project:as-you-go-save', { state: JSON.stringify(state) });
}
function mutate(next) { state = next; render(); return persist().catch((error) => setStatus(String(error))); }

function showEditor(mode, item = null) {
  editorMode = { kind: mode, item };
  editorIcon = item?.icon ?? null;
  document.querySelector('#editor-title').textContent = mode === 'group' ? 'New group' : item ? 'Rename shortcut' : 'Add shortcut';
  document.querySelector('#name-input').value = item?.name ?? '';
  document.querySelector('#description-input').value = item?.description ?? '';
  document.querySelector('#target-input').value = item?.target ?? '';
  document.querySelector('#target-fields').hidden = mode === 'group' || Boolean(item);
  document.querySelector('#description-label').hidden = mode === 'group';
  document.querySelector('#icon-preview').hidden = !editorIcon;
  if (editorIcon) document.querySelector('#icon-preview').src = editorIcon;
  document.querySelector('#editor').hidden = false;
  document.querySelector('#name-input').focus();
}
function hideEditor() { editorMode = null; editorIcon = null; document.querySelector('#editor').hidden = true; }

document.querySelector('#location-select').addEventListener('change', (event) => { currentId = event.target.value; selected.clear(); render(); });
document.querySelector('#destination-select').addEventListener('change', () => {});
document.querySelector('#breadcrumbs').addEventListener('click', (event) => { const id = event.target.dataset.breadcrumb; if (id) { currentId = id; selected.clear(); render(); } });
document.querySelector('#explorer-list').addEventListener('click', (event) => {
  const row = event.target.closest('.explorer-row');
  if (!row) return;
  if (event.target.matches('input')) { if (event.target.checked) selected.add(row.dataset.id); else selected.delete(row.dataset.id); render(); return; }
  const rename = event.target.dataset.rename;
  if (rename) { showEditor(row.dataset.kind === 'group' ? 'group' : 'shortcut', row.dataset.kind === 'group' ? group(rename) : state.shortcuts.find((item) => item.id === rename)); return; }
  if (row.dataset.kind === 'group') { currentId = row.dataset.id; selected.clear(); render(); return; }
  const shortcut = state.shortcuts.find((item) => item.id === row.dataset.id);
  if (shortcut) request('papers:project:as-you-go-launch', { actionId: shortcut.id }).catch((error) => setStatus(String(error)));
});
document.querySelector('#new-group').addEventListener('click', () => showEditor('group'));
document.querySelector('#new-shortcut').addEventListener('click', () => showEditor('shortcut'));
document.querySelector('#cancel-editor').addEventListener('click', hideEditor);
document.querySelector('#pick-file').addEventListener('click', async () => { const target = await request('papers:project:as-you-go-pick-target', { kind: 'file' }); if (target) document.querySelector('#target-input').value = target; });
document.querySelector('#pick-folder').addEventListener('click', async () => { const target = await request('papers:project:as-you-go-pick-target', { kind: 'folder' }); if (target) document.querySelector('#target-input').value = target; });
document.querySelector('#icon-input').addEventListener('change', () => { const file = document.querySelector('#icon-input').files[0]; if (!file) return; if (file.size > 750_000) { setStatus('That icon image is too large. Choose an image under 750 KB.'); return; } const reader = new FileReader(); reader.onload = () => { editorIcon = reader.result; document.querySelector('#icon-preview').src = editorIcon; document.querySelector('#icon-preview').hidden = false; }; reader.readAsDataURL(file); });
document.querySelector('#save-editor').addEventListener('click', async () => {
  const name = document.querySelector('#name-input').value.trim();
  if (!name) return setStatus('Name must not be empty.');
  if (editorMode.kind === 'group' && !editorMode.item) state = { ...state, groups: [...state.groups, { id: `group-${crypto.randomUUID()}`, parentId: currentId, name }] };
  else if (editorMode.item) state = editorMode.kind === 'group' ? { ...state, groups: state.groups.map((item) => item.id === editorMode.item.id ? { ...item, name } : item) } : { ...state, shortcuts: state.shortcuts.map((item) => item.id === editorMode.item.id ? { ...item, name, description: document.querySelector('#description-input').value.trim(), icon: editorIcon } : item) };
  else { const target = document.querySelector('#target-input').value.trim(); if (!target) return setStatus('Choose a file, app, or folder first.'); state = { ...state, shortcuts: [...state.shortcuts, { id: `shortcut-${crypto.randomUUID()}`, parentId: currentId, name, description: document.querySelector('#description-input').value.trim(), target, icon: editorIcon }] }; }
  hideEditor(); render(); try { await persist(); } catch (error) { setStatus(String(error)); }
});
document.querySelector('#move-selected').addEventListener('click', async () => { const destination = document.querySelector('#destination-select').value; try { const ids = [...selected]; const movingGroup = ids.find((id) => group(id)); if (movingGroup && (destination === movingGroup || pathTo(destination).some((item) => item.id === movingGroup))) throw new Error('A group cannot be moved inside itself.'); state = { ...state, groups: state.groups.map((item) => selected.has(item.id) ? { ...item, parentId: destination } : item), shortcuts: state.shortcuts.map((item) => selected.has(item.id) ? { ...item, parentId: destination } : item) }; selected.clear(); render(); await persist(); } catch (error) { setStatus(String(error)); } });
document.querySelector('#copy-selected').addEventListener('click', async () => { setStatus('Copying selections…'); const destination = document.querySelector('#destination-select').value; try { const copiedGroups = []; const copiedShortcuts = []; const copyGroup = (source, parentId) => { const clone = { ...source, id: `group-${crypto.randomUUID()}`, parentId }; copiedGroups.push(clone); state.groups.filter((item) => item.parentId === source.id).forEach((child) => copyGroup(child, clone.id)); state.shortcuts.filter((item) => item.parentId === source.id).forEach((child) => copiedShortcuts.push({ ...child, id: `shortcut-${crypto.randomUUID()}`, parentId: clone.id })); }; [...selected].forEach((id) => { const source = state.groups.find((item) => item.id === id); if (source) copyGroup(source, destination); else { const shortcut = state.shortcuts.find((item) => item.id === id); if (shortcut) copiedShortcuts.push({ ...shortcut, id: `shortcut-${crypto.randomUUID()}`, parentId: destination }); } }); state = { ...state, groups: [...state.groups, ...copiedGroups], shortcuts: [...state.shortcuts, ...copiedShortcuts] }; selected.clear(); render(); await persist(); setStatus(''); } catch (error) { setStatus(String(error)); } });
document.querySelector('#clear-selected').addEventListener('click', () => { selected.clear(); render(); });
document.querySelector('#delete-selected').addEventListener('click', async () => { if (!confirm('Delete the selected shortcuts? Empty groups can also be removed.')) return; const ids = new Set(selected); state = { ...state, shortcuts: state.shortcuts.filter((item) => !ids.has(item.id)), groups: state.groups.filter((item) => !ids.has(item.id) || state.groups.some((child) => child.parentId === item.id) || state.shortcuts.some((child) => child.parentId === item.id)) }; selected.clear(); render(); await persist(); });
document.querySelector('#copy-prompt').addEventListener('click', async () => { try { await request('papers:project:copy-text', { text: PICKUP_PROMPT }); document.querySelector('.copy-label').textContent = 'Copied'; setTimeout(() => { document.querySelector('.copy-label').textContent = 'Copy agent pickup prompt'; }, 1800); } catch (error) { setStatus(String(error)); } });
document.querySelector('#back').addEventListener('click', () => window.parent.postMessage({ type: 'papers:project:close' }, '*'));

window.addEventListener('message', (event) => {
  if (event.source !== window.parent || event.data?.type !== 'papers:host:result') return;
  const task = pending.get(event.data.requestId);
  if (!task) return;
  pending.delete(event.data.requestId);
  if (event.data.ok) task.resolve(event.data.state ?? event.data.target ?? undefined);
  else task.reject(new Error(event.data.error || 'The request could not be completed.'));
});

(async () => { try { const loaded = await request('papers:project:as-you-go-load'); state = typeof loaded === 'string' ? JSON.parse(loaded) : loaded; render(); } catch (error) { setStatus(String(error)); render(); } })();

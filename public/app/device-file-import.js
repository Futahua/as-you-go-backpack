// Files dropped from another device's Files tab are downloaded into the receiving device's inbox
// by Papers (remote-files inbox-import), then linked here only after the saved copy is verified.
// The panel follows the phone download panel: progress at once, speed, result or failure stays.
const REMOTE = /^\\\\papers~([0-9a-f-]{36})\\/i;
const PENDING = 'papers-device-imports';
const bytes = n => { if (n < 1024) return n + ' B'; const unit = n < 1048576 ? 'KB' : n < 1073741824 ? 'MB' : 'GB', div = unit === 'KB' ? 1024 : unit === 'MB' ? 1048576 : 1073741824; return (n / div).toFixed(1) + ' ' + unit; };

export const isDevicePath = path => typeof path === 'string' && REMOTE.test(path);

export function createDeviceFileImport({ document: d, host, link: saveLink, scopeKey, filesOnly = false }) {
  const pendingKey = PENDING + ':' + (scopeKey || 'main');
  const link = async (...args) => { if (await saveLink(...args) !== true) throw Error('The workspace did not confirm saving the link.'); };
  const linkResults = new Map();
  const panel = d.createElement('section'); panel.className = 'device-import-panel'; panel.hidden = true; panel.setAttribute('aria-label', 'Downloads');
  const heading = d.createElement('strong'), close = d.createElement('button'); close.type = 'button'; close.textContent = '×'; close.setAttribute('aria-label', 'Hide download progress');
  const top = d.createElement('div'); top.className = 'device-import-heading'; top.append(heading, close);
  const file = d.createElement('div'), progress = d.createElement('progress'), detail = d.createElement('div'), destination = d.createElement('div'), actions = d.createElement('div'), pause = d.createElement('button');
  file.className = 'device-import-file'; detail.className = 'device-import-detail'; destination.className = 'device-import-destination'; actions.className = 'device-import-actions'; pause.type = 'button'; actions.append(pause);
  panel.append(top, file, progress, detail, destination, actions); d.body.append(panel);
  const style = d.createElement('style');
  // Compact and sized to its pane: it sits under the download button and never spans the whole tab.
  style.textContent = '.device-import-panel{position:fixed;top:48px;left:8px;width:min(300px,calc(100vw - 16px));box-sizing:border-box;z-index:5000;padding:7px 10px 8px;background:var(--panel,#30332e);color:var(--text,#eee);border:1px solid #ffffff1f;border-radius:7px;box-shadow:0 4px 14px #0005;font:11.5px system-ui;line-height:1.35}.device-import-panel[hidden]{display:none}.device-import-heading{display:flex;align-items:center;justify-content:space-between;gap:8px}.device-import-heading strong{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.device-import-heading button{border:0;background:transparent;color:inherit;opacity:.7;font-size:15px;line-height:1;padding:0 2px;cursor:pointer}.device-import-file{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin:3px 0 5px;opacity:.9}.device-import-panel progress{display:block;width:100%;height:3px;accent-color:var(--accent,#b6c4af)}.device-import-detail{font-variant-numeric:tabular-nums;margin-top:4px;opacity:.8}.device-import-detail:empty{display:none}.device-import-destination{opacity:.55;margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.device-import-destination:empty{display:none}.device-import-actions{display:flex;justify-content:flex-end;margin-top:5px}.device-import-actions[hidden]{display:none}.device-import-button.is-running{color:var(--accent,#b6c4af)}.device-import-actions button{font:inherit;border:1px solid #ffffff2a;border-radius:4px;padding:2px 9px;background:transparent;color:inherit;cursor:pointer}';
  d.head.append(style);
  // Like the phone: a download button after the camera opens this panel, lit while a download runs.
  let button = null;
  const mountButton = () => {
    if (button?.isConnected) return true;
    const lens = filesOnly ? null : d.querySelector('.workspace-left-actions .native-window-lens');
    const toolbar = filesOnly ? d.querySelector('.workspace-navigator-toolbar') : null;
    if (!lens && !toolbar) return false;
    button = d.createElement('button'); button.type = 'button'; button.className = lens?.className || 'navigator-icon-button'; button.classList.remove('native-window-lens'); button.classList.add('device-import-button');
    button.title = 'Downloads'; button.setAttribute('aria-label', 'Downloads');
    button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/></svg>';
    button.addEventListener('click', () => { if (!panel.hidden) { panel.hidden = true; return; } panel.hidden = false; if (!shown) { heading.textContent = 'No downloads yet'; file.textContent = 'Drop files from another device into As you Go.'; progress.hidden = true; detail.textContent = ''; destination.textContent = ''; actions.hidden = true; } else void poll(true); });
    if (lens) lens.after(button); else toolbar.append(button); return true;
  };
  const place = () => {
    if (panel.hidden) return;
    // The page spans the window; the visible tab is the navigator pane, so size and clamp to it.
    const view = d.defaultView, anchor = button?.isConnected ? button.getBoundingClientRect() : null;
    const pane = button?.closest('.workspace-navigator')?.getBoundingClientRect() || { left: 0, right: view.innerWidth, width: view.innerWidth };
    const width = Math.max(180, Math.min(300, pane.width - 16));
    panel.style.width = width + 'px';
    panel.style.top = (anchor ? anchor.bottom + 6 : 48) + 'px';
    panel.style.left = Math.max(pane.left + 8, Math.min(anchor ? anchor.left - 8 : pane.left + 8, pane.right - width - 8)) + 'px';
  };
  new MutationObserver(place).observe(panel, { attributes: true, attributeFilter: ['hidden'] });
  d.defaultView.addEventListener('resize', place);
  if (!mountButton()) { const observer = new MutationObserver(() => { if (mountButton()) observer.disconnect(); }); observer.observe(d.body, { childList: true, subtree: true }); setTimeout(() => observer.disconnect(), 60000); }

  const storage = (() => { try { return d.defaultView.localStorage; } catch { return null; } })();
  const readPending = () => { try { const value = JSON.parse(storage?.getItem(pendingKey) || '[]'); return Array.isArray(value) ? value.filter(item => typeof item?.jobId === 'string') : []; } catch { return []; } };
  const writePending = list => { try { storage?.setItem(pendingKey, JSON.stringify(list)); } catch { /* the link is still made while this page stays open */ } };
  const pending = new Map(readPending().map(item => [item.jobId, item]));
  const save = () => writePending([...pending.values()]);

  let shown = null, previous = null, speed = 0, timer = null, polling = false, disposed = false;
  const call = async params => { const value = await host.fileCapability('remote-files', params); if (value?.ok === false) throw Error(value.message || 'Download unavailable.'); return value?.result ?? value; };
  // A remote As you Go keeps targets in its device's own form (C:\...), like its drops from this computer.
  const ownPath = path => host.deviceId && path.toLowerCase().startsWith(`\\\\papers~${host.deviceId}\\`.toLowerCase()) ? path.slice(`\\\\papers~${host.deviceId}\\`.length) : path;

  function showError(title, error) { panel.hidden = false; heading.textContent = title; file.textContent = error?.message || String(error); file.title = file.textContent; progress.hidden = true; detail.textContent = ''; destination.textContent = ''; actions.hidden = true; }
  function draw(job) {
    if (linkResults.has(job.id)) Object.assign(job, linkResults.get(job.id));
    const now = performance.now(), active = ['preparing', 'downloading', 'verifying', 'publishing'].includes(job.phase);
    if (previous?.id === job.id && now > previous.time && job.bytes >= previous.bytes && job.phase === 'downloading') speed = speed * .65 + (job.bytes - previous.bytes) / ((now - previous.time) / 1000) * .35; else if (previous?.id !== job.id) speed = 0;
    previous = { id: job.id, time: now, bytes: job.bytes || 0 };
    const count = job.results?.length || 0;
    heading.textContent = job.phase === 'completed' ? (job.linked === true ? 'Downloaded and linked' : job.linked === false ? 'Downloaded, not linked' : 'Downloaded') : job.phase === 'paused' ? 'Download paused' : job.phase === 'failed' ? 'Download stopped' : job.phase === 'uncertain' ? 'Download interrupted' : job.phase === 'preparing' ? 'Finding files…' : job.phase === 'verifying' ? 'Checking file' : job.phase === 'publishing' ? 'Saving to inbox' : 'Downloading';
    file.textContent = job.error || (job.phase === 'completed' && count ? job.results.map(item => item.name).join(', ') : job.name || ''); file.title = file.textContent;
    progress.hidden = false; progress.max = Math.max(1, job.totalBytes || 0);
    if (job.totalBytes == null && active) progress.removeAttribute('value'); else progress.value = job.phase === 'completed' ? progress.max : job.bytes || 0;
    detail.textContent = job.totalBytes == null ? '' : bytes(job.bytes || 0) + ' / ' + bytes(job.totalBytes) + (job.phase === 'downloading' ? ' · ' + bytes(Math.round(speed)) + '/s' : '');
    destination.textContent = job.destination ? 'To ' + job.destination : '';
    actions.hidden = !(active || job.phase === 'paused' || job.phase === 'failed' || (job.phase === 'completed' && pending.has(job.id) && job.linked === false));
    pause.textContent = job.phase === 'completed' ? 'Retry link' : active ? 'Pause' : 'Resume'; pause.disabled = job.phase === 'publishing';
  }

  async function finish(job, entry) {
    if (job.phase !== 'completed') return;
    if (entry.linkFailed) { Object.assign(job, { linked: false, error: entry.linkError }); return; }
    try { await link(job.results.map(item => ({ target: ownPath(item.target), name: item.name, kind: item.kind })), entry.destination); job.linked = true; pending.delete(job.id); save(); }
    catch (error) { job.linked = false; job.error = 'Saved in the inbox, but the link failed: ' + (error?.message || error); entry.linkFailed = true; entry.linkError = job.error; save(); }
    linkResults.set(job.id, { linked: job.linked, error: job.error });
  }
  async function poll(force = false) {
    if (polling || disposed) return; polling = true;
    try {
      const status = await call({ operation: 'status' });
      const jobs = new Map((status?.inboxTransfers || []).map(job => [job.id, job]));
      for (const [id, entry] of [...pending]) {
        const job = jobs.get(id);
        if (!job) { pending.delete(id); save(); continue; }
        if (['completed', 'failed', 'uncertain'].includes(job.phase) && !(job.phase === 'failed' && id === shown)) await finish(job, entry);
        else if (job.phase === 'failed') { /* stays pending so Resume can still link it */ }
        if (id === shown) draw(job);
      }
      if (force && shown && !pending.has(shown) && jobs.has(shown)) draw(jobs.get(shown));
      if (!shown) { const latest = [...jobs.values()].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0]; if (latest) { shown = latest.id; if (force) draw(latest); } }
      button?.classList.toggle('is-running', [...jobs.values()].some(job => ['preparing', 'downloading', 'verifying', 'publishing'].includes(job.phase)));
    } catch { /* the next poll retries; the job itself runs in Papers */ }
    finally { polling = false; if (!pending.size && timer) { clearInterval(timer); timer = null; } }
  }
  const watch = () => { if (!timer && !disposed) timer = setInterval(poll, 500); };

  pause.addEventListener('click', async () => {
    if (!shown) return; pause.disabled = true;
    try {
      if (pause.textContent === 'Retry link') { const entry = pending.get(shown); if (entry) { delete entry.linkFailed; delete entry.linkError; linkResults.delete(shown); save(); await poll(true); } return; }
      const job = await call({ operation: pause.textContent === 'Pause' ? 'inbox-pause' : 'inbox-resume', jobId: shown }); if (job) draw(job); watch(); }
    catch (error) { file.textContent = error.message; }
    finally { pause.disabled = false; }
  });
  close.addEventListener('click', () => { panel.hidden = true; });

  // This computer's files dropped into another device's As you Go: copied into that device's inbox, then linked there.
  async function sendLocal(local, destinationId) {
    const name = local.length === 1 ? local[0].split('\\').pop() : local.length + ' items';
    if (!host.deviceId) { await link(local.map(path => ({ target: path, name: path.split('\\').pop() })), destinationId); return; }
    shown = null; panel.hidden = false; heading.textContent = 'Sending…'; file.textContent = name; file.title = name; progress.hidden = false; progress.removeAttribute('value'); detail.textContent = ''; destination.textContent = ''; actions.hidden = true;
    try {
      const sent = await call({ operation: 'send-to-inbox', ownerId: host.deviceId, paths: local });
      if (!Array.isArray(sent) || sent.length !== local.length) throw Error('The device did not confirm the copy.');
      await link(sent.map((target, index) => ({ target: ownPath(target), name: String(target).split('\\').pop() || local[index].split('\\').pop() })), destinationId);
      heading.textContent = 'Sent and linked'; file.textContent = sent.map(target => String(target).split('\\').pop()).join(', '); progress.max = 1; progress.value = 1;
      destination.textContent = 'To ' + String(sent[0]).replace(/^\\\\papers~[^\\]+\\/i, '').replace(/\\[^\\]*$/, '');
    } catch (error) { showError('Not sent', error); }
  }

  async function importPaths(paths, destinationId, local = []) {
    if (local.length) await sendLocal([...new Set(local)], destinationId);
    const devicePaths = [...new Set(paths.filter(isDevicePath))];
    if (!devicePaths.length) return local.length > 0;
    // Files already on the device this As you Go belongs to need no download.
    const here = host.deviceId ? devicePaths.filter(path => ownPath(path) !== path) : [];
    if (here.length) await link(here.map(path => ({ target: ownPath(path), name: path.split('\\').pop() })), destinationId);
    const fetch = devicePaths.filter(path => !here.includes(path));
    if (!fetch.length) return true;
    panel.hidden = false; heading.textContent = 'Finding files…'; file.textContent = fetch.length === 1 ? fetch[0].split('\\').pop() : fetch.length + ' items'; progress.hidden = false; progress.removeAttribute('value'); detail.textContent = ''; destination.textContent = ''; actions.hidden = true;
    const commandId = crypto.randomUUID();
    pending.set(commandId, { jobId: commandId, destination: destinationId }); save();
    try {
      const job = await call({ operation: 'inbox-import', commandId, paths: fetch, ...(host.deviceId ? { destinationOwnerId: host.deviceId } : {}) });
      shown = commandId; previous = null; speed = 0; if (job) draw(job); watch();
    } catch (error) { pending.delete(commandId); save(); showError('Download not started', error); }
    return true;
  }

  if (pending.size) { shown = [...pending.keys()].pop(); panel.hidden = false; heading.textContent = 'Downloading'; file.textContent = ''; watch(); void poll(); } else void poll();
  d.defaultView.addEventListener('pagehide', () => { disposed = true; if (timer) clearInterval(timer); }, { once: true });
  return { importPaths };
}

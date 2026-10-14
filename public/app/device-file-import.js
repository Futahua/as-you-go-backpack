// Files dropped from another device's Files tab are downloaded into the receiving device's inbox
// by Papers (remote-files inbox-import), then linked here only after the saved copy is verified.
// The panel follows the phone download panel: progress at once, speed, result or failure stays.
const REMOTE = /^\\\\papers~([0-9a-f-]{36})\\/i;
const PENDING = 'papers-device-imports';
const bytes = n => { if (n < 1024) return n + ' B'; const unit = n < 1048576 ? 'KB' : n < 1073741824 ? 'MB' : 'GB', div = unit === 'KB' ? 1024 : unit === 'MB' ? 1048576 : 1073741824; return (n / div).toFixed(1) + ' ' + unit; };

export const isDevicePath = path => typeof path === 'string' && REMOTE.test(path);

export function createDeviceFileImport({ document: d, host, link }) {
  const panel = d.createElement('section'); panel.className = 'device-import-panel'; panel.hidden = true; panel.setAttribute('aria-label', 'Downloads');
  const heading = d.createElement('strong'), close = d.createElement('button'); close.type = 'button'; close.textContent = '×'; close.setAttribute('aria-label', 'Hide download progress');
  const top = d.createElement('div'); top.className = 'device-import-heading'; top.append(heading, close);
  const file = d.createElement('div'), progress = d.createElement('progress'), detail = d.createElement('div'), destination = d.createElement('div'), actions = d.createElement('div'), pause = d.createElement('button');
  file.className = 'device-import-file'; detail.className = 'device-import-detail'; destination.className = 'device-import-destination'; actions.className = 'device-import-actions'; pause.type = 'button'; actions.append(pause);
  panel.append(top, file, progress, detail, destination, actions); d.body.append(panel);
  const style = d.createElement('style');
  style.textContent = '.device-import-panel{position:fixed;right:12px;bottom:12px;width:min(400px,calc(100vw - 24px));box-sizing:border-box;z-index:5000;padding:14px;background:var(--panel,#30332e);color:var(--text,#eee);border:1px solid #ffffff24;border-radius:10px;box-shadow:0 8px 28px #0006;font:13px system-ui}.device-import-panel[hidden]{display:none}.device-import-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}.device-import-heading button{border:0;background:transparent;color:inherit;font-size:20px;padding:0 4px;cursor:pointer}.device-import-file{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin:10px 0 8px}.device-import-panel progress{width:100%;height:5px;accent-color:var(--accent,#b6c4af)}.device-import-detail{font-variant-numeric:tabular-nums;margin-top:8px}.device-import-destination{opacity:.65;margin-top:5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.device-import-actions{display:flex;justify-content:flex-end;margin-top:10px}.device-import-actions button{font:inherit;border:1px solid #ffffff30;border-radius:5px;padding:6px 12px;background:transparent;color:inherit;cursor:pointer}';
  d.head.append(style);

  const storage = (() => { try { return d.defaultView.localStorage; } catch { return null; } })();
  const readPending = () => { try { const value = JSON.parse(storage?.getItem(PENDING) || '[]'); return Array.isArray(value) ? value.filter(item => typeof item?.jobId === 'string') : []; } catch { return []; } };
  const writePending = list => { try { storage?.setItem(PENDING, JSON.stringify(list)); } catch { /* the link is still made while this page stays open */ } };
  const pending = new Map(readPending().map(item => [item.jobId, item]));
  const save = () => writePending([...pending.values()]);

  let shown = null, previous = null, speed = 0, timer = null, polling = false, disposed = false;
  const call = async params => { const value = await host.fileCapability('remote-files', params); if (value?.ok === false) throw Error(value.message || 'Download unavailable.'); return value?.result ?? value; };
  // A remote As you Go keeps targets in its device's own form (C:\...), like its drops from this computer.
  const ownPath = path => host.deviceId && path.toLowerCase().startsWith(`\\\\papers~${host.deviceId}\\`.toLowerCase()) ? path.slice(`\\\\papers~${host.deviceId}\\`.length) : path;

  function showError(title, error) { panel.hidden = false; heading.textContent = title; file.textContent = error?.message || String(error); file.title = file.textContent; progress.hidden = true; detail.textContent = ''; destination.textContent = ''; actions.hidden = true; }
  function draw(job) {
    const now = performance.now(), active = ['preparing', 'downloading', 'verifying', 'publishing'].includes(job.phase);
    if (previous?.id === job.id && now > previous.time && job.bytes >= previous.bytes && job.phase === 'downloading') speed = speed * .65 + (job.bytes - previous.bytes) / ((now - previous.time) / 1000) * .35; else if (previous?.id !== job.id) speed = 0;
    previous = { id: job.id, time: now, bytes: job.bytes || 0 };
    const count = job.results?.length || 0;
    heading.textContent = job.phase === 'completed' ? (job.linked === false ? 'Downloaded, not linked' : 'Downloaded and linked') : job.phase === 'paused' ? 'Download paused' : job.phase === 'failed' ? 'Download stopped' : job.phase === 'uncertain' ? 'Download interrupted' : job.phase === 'preparing' ? 'Finding files…' : job.phase === 'verifying' ? 'Checking file' : job.phase === 'publishing' ? 'Saving to inbox' : 'Downloading';
    file.textContent = job.error || (job.phase === 'completed' && count ? job.results.map(item => item.name).join(', ') : job.name || ''); file.title = file.textContent;
    progress.hidden = false; progress.max = Math.max(1, job.totalBytes || 0);
    if (job.totalBytes == null && active) progress.removeAttribute('value'); else progress.value = job.phase === 'completed' ? progress.max : job.bytes || 0;
    detail.textContent = job.totalBytes == null ? '' : bytes(job.bytes || 0) + ' / ' + bytes(job.totalBytes) + (job.phase === 'downloading' ? ' · ' + bytes(Math.round(speed)) + '/s' : '');
    destination.textContent = job.destination ? 'To ' + job.destination : '';
    actions.hidden = !(active || job.phase === 'paused' || job.phase === 'failed');
    pause.textContent = active ? 'Pause' : 'Resume'; pause.disabled = job.phase === 'publishing';
  }

  async function finish(job, entry) {
    pending.delete(job.id); save();
    if (job.phase !== 'completed') return;
    try { await link(job.results.map(item => ({ target: ownPath(item.target), name: item.name, kind: item.kind })), entry.destination); job.linked = true; }
    catch (error) { job.linked = false; job.error = 'Saved in the inbox, but the link failed: ' + (error?.message || error); }
  }
  async function poll() {
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
      if (shown && !pending.has(shown) && !jobs.has(shown)) shown = null;
    } catch { /* the next poll retries; the job itself runs in Papers */ }
    finally { polling = false; if (!pending.size && timer) { clearInterval(timer); timer = null; } }
  }
  const watch = () => { if (!timer && !disposed) timer = setInterval(poll, 500); };

  pause.addEventListener('click', async () => {
    if (!shown) return; pause.disabled = true;
    try { const job = await call({ operation: pause.textContent === 'Pause' ? 'inbox-pause' : 'inbox-resume', jobId: shown }); if (job) draw(job); watch(); }
    catch (error) { file.textContent = error.message; }
    finally { pause.disabled = false; }
  });
  close.addEventListener('click', () => { panel.hidden = true; });

  async function importPaths(paths, destinationId) {
    const devicePaths = [...new Set(paths.filter(isDevicePath))];
    if (!devicePaths.length) return false;
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

  if (pending.size) { shown = [...pending.keys()].pop(); panel.hidden = false; heading.textContent = 'Downloading'; file.textContent = ''; watch(); void poll(); }
  d.defaultView.addEventListener('pagehide', () => { disposed = true; if (timer) clearInterval(timer); }, { once: true });
  return { importPaths };
}

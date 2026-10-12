/** Remote file presentation; Papers/native clients own connections and verified bytes. */
export function createRemoteFileView({ document: d, container, call, close = () => {}, localLabel = 'Local files' }) {
  const root = d.createElement('section');
  root.className = 'ayg-remote-files';
  root.setAttribute('aria-label', 'Files on another device');
  root.style.cssText = 'position:absolute;inset:0;z-index:20;background:var(--surface,#2b302f);color:inherit;display:none;flex-direction:column;padding:10px;gap:10px;overflow:auto';
  let active = false, generation = 0, owner = null, history = [], offlineMode = false, timer = null, polling = false;
  const toolbar = d.createElement('div'); toolbar.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;align-items:center';
  const heading = d.createElement('strong'); heading.textContent = 'Devices';
  const message = d.createElement('p'); message.setAttribute('role', 'status'); message.style.cssText = 'margin:0;font-size:12px';
  const location = d.createElement('nav'); location.setAttribute('aria-label', 'Remote location');
  const body = d.createElement('div'); body.style.cssText = 'display:flex;flex-direction:column;gap:6px';
  const progress = d.createElement('div'); progress.setAttribute('aria-live', 'polite');
  function button(label, action) {
    const element = d.createElement('button'); element.type = 'button'; element.className = 'quiet-button'; element.textContent = label;
    element.addEventListener('click', () => { void Promise.resolve().then(action).catch(error => { message.textContent = error.message || String(error); }); });
    return element;
  }
  const back = button('Back', async () => {
    if (offlineMode) { offlineMode = false; await render(); }
    else if (history.length) { history.pop(); await render(); }
    else { owner = null; await render(); }
  });
  toolbar.append(button(localLabel, () => hide()), heading, back, button('Refresh', () => render()), button('Offline copies', () => { if (!owner) return; offlineMode = true; return render(); }));
  root.append(toolbar, location, message, body, progress); root.hidden = true; container.append(root);
  const request = async params => {
    const result = await call(params);
    if (result?.ok === false) throw new Error(result.message || result.code || 'Remote files are unavailable.');
    return result?.result ?? result;
  };
  function row(name) {
    const element = d.createElement('div'); element.className = 'navigator-row'; element.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:8px;border-bottom:1px solid #ffffff18;min-height:36px';
    const label = d.createElement('span'); label.textContent = name; label.style.cssText = 'flex:1;min-width:90px;overflow-wrap:anywhere'; element.append(label); return element;
  }
  async function render() {
    if (!active) return;
    const current = ++generation; message.textContent = 'Loading…';
    try {
      const snapshot = await request({ operation: 'status' });
      if (current !== generation || !active) return;
      body.replaceChildren(); location.replaceChildren();
      heading.textContent = owner?.name || 'Devices'; back.disabled = !owner;
      if (!owner) {
        message.textContent = snapshot.devices.length ? 'Choose a computer.' : 'Connect a computer in Papers Settings → Devices.';
        for (const device of snapshot.devices) { const element = row(device.name); element.append(button('Browse', () => { owner = device; history = []; offlineMode = false; return render(); })); body.append(element); }
        return;
      }
      location.textContent = [owner.name, ...history.map(item => item.name)].join(' › ');
      if (offlineMode) {
        const copies = await request({ operation: 'offline', ownerId: owner.id });
        if (current !== generation || !active) return;
        message.textContent = copies.length ? 'Verified local copies. Opening uses this device.' : 'No files kept offline yet.';
        for (const copy of copies) { const element = row(copy.entry.name); element.append(button('Open local copy', () => request({ operation: 'open-cache', ownerId: owner.id, key: copy.key }))); body.append(element); }
        return;
      }
      const folder = history.at(-1);
      let offset = 0;
      do {
        const listing = await request({ operation: 'browse', ownerId: owner.id, resourceId: folder?.id, offset });
        if (current !== generation || !active) return;
        message.textContent = listing.online ? 'Online' : `Offline — showing saved listing. ${listing.error || ''}`;
        for (const entry of listing.entries) {
          const element = row(entry.name);
          if (entry.kind === 'folder') element.append(button('Open folder', () => { history.push(entry); return render(); }));
          else {
            const keep = button('Keep offline', async () => { await request({ operation: 'download', ownerId: owner.id, entry }); await poll(); });
            keep.disabled = !listing.online; element.append(keep);
          }
          body.append(element);
        }
        offset = listing.nextOffset;
      } while (offset !== null && offset !== undefined);
    } catch (error) { if (current === generation) message.textContent = error.message || 'Owner unavailable.'; }
  }
  async function poll() {
    if (!active || polling) return;
    polling = true;
    try {
      const snapshot = await request({ operation: 'status' });
      if (!active) return;
      progress.replaceChildren();
      for (const job of snapshot.jobs.filter(job => job.ownerId === owner?.id)) {
        const element = row(job.entry.name);
        const label = d.createElement('span');
        label.textContent = job.error || (job.phase === 'completed' ? 'Available offline' : `${job.phase} — ${(job.bytes / 1024 / 1024).toFixed(1)} / ${(job.entry.size / 1024 / 1024).toFixed(1)} MiB`);
        element.append(label);
        if (job.phase === 'queued' || job.phase === 'transferring' || job.phase === 'verifying') element.append(button('Cancel', () => request({ operation: 'cancel', jobId: job.id })));
        progress.append(element);
      }
    } catch (error) { message.textContent = error.message || 'Connection unavailable.'; }
    finally { polling = false; }
  }
  function hide() { active = false; generation++; root.hidden = true; root.style.display = 'none'; clearInterval(timer); timer = null; close(); }
  return {
    async show() { active = true; root.hidden = false; root.style.display = 'flex'; if (!timer) timer = setInterval(() => { void poll(); }, 500); await render(); await poll(); },
    async home() { owner = null; history = []; offlineMode = false; await this.show(); },
    hide,
    dispose() { hide(); root.remove(); },
  };
}

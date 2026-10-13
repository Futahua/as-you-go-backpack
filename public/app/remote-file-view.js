/** Remote file presentation; Papers/native clients own connections and verified bytes. */
export function createRemoteFileView({ document: d, container, call, close = () => {}, localLabel = 'Local files' }) {
  const root = d.createElement('section');
  root.className = 'ayg-remote-files';
  root.setAttribute('aria-label', 'Files on another device');
  root.style.cssText = 'position:absolute;inset:0;z-index:20;background:var(--surface,#2b302f);color:inherit;display:none;flex-direction:column;padding:10px;gap:10px;overflow:auto';
  let active = false, generation = 0, owner = null, history = [], offlineMode = false, timer = null, polling = false, changesAllowed = false, transfer = null, lastChanges = '';
  const toolbar = d.createElement('div'); toolbar.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;align-items:center';
  const heading = d.createElement('strong'); heading.textContent = 'Devices';
  const message = d.createElement('p'); message.setAttribute('role', 'status'); message.style.cssText = 'margin:0;font-size:12px';
  const location = d.createElement('nav'); location.setAttribute('aria-label', 'Remote location');
  const body = d.createElement('div'); body.style.cssText = 'display:flex;flex-direction:column;gap:6px';
  const progress = d.createElement('div'); progress.setAttribute('aria-live', 'polite');
  const edits = d.createElement('div'); edits.setAttribute('aria-label', 'Local working copies');
  let editMode = false, editBusy = false, editClientAvailable = false, editRecoveryAvailable = false;
  function button(label, action) {
    const element = d.createElement('button'); element.type = 'button'; element.className = 'quiet-button'; element.textContent = label;
    element.addEventListener('click', () => { void Promise.resolve().then(action).catch(error => { message.textContent = error.message || String(error); }); });
    return element;
  }
  const back = button('Back', async () => {
    if (offlineMode || editMode) { offlineMode = false; editMode = false; await render(); }
    else if (history.length) { history.pop(); await render(); }
    else { owner = null; await render(); }
  });
  const newFolder = button('New folder', () => editName(null));
  const paste = button('Paste here', async () => {
    const folder = history.at(-1);
    if (!changesAllowed || !folder || !transfer || transfer.ownerId !== owner.id) return;
    if(!transfer.command||transfer.command.destinationId!==folder.id)transfer.command={commandId:d.defaultView.crypto.randomUUID(),operation:transfer.operation,resourceId:transfer.entry.id,expectedVersion:transfer.entry.version,destinationId:folder.id,destinationVersion:folder.version};
    await request({ operation:'change',ownerId:owner.id,command:transfer.command });
    transfer = null; paste.disabled = true; await poll();
  });
  toolbar.append(button(localLabel, () => hide()), heading, back, button('Refresh', () => render()), button('Offline copies', () => { if (!owner) return; offlineMode = true; editMode = false; return render(); }));
  toolbar.append(newFolder,paste); newFolder.disabled = true; paste.disabled = true;
  const workingCopies = button('Working copies', () => { if (!owner) return; editMode = true; offlineMode = false; return render(); });
  workingCopies.hidden = true;
  toolbar.append(workingCopies);
  root.append(toolbar, location, message, body, edits, progress); root.hidden = true; container.append(root);
  const request = async params => {
    const result = await call(params);
    if (result?.ok === false) throw new Error(result.message || result.code || 'Remote files are unavailable.');
    return result?.result ?? result;
  };
  function editName(entry) {
    const folder=history.at(-1);if(!changesAllowed||(!entry&&!folder))return;
    const form=d.createElement('form'),input=d.createElement('input');input.value=entry?.name||'';input.placeholder=entry?'New name':'Folder name';input.setAttribute('aria-label',input.placeholder);
    let command=null;
    form.append(input,button('Cancel',()=>form.remove()));const submit=d.createElement('button');submit.type='submit';submit.textContent=entry?'Rename':'Create folder';form.append(submit);body.prepend(form);input.focus();
    form.addEventListener('submit',async event=>{event.preventDefault();submit.disabled=true;try{if(!command||command.newName!==input.value)command={commandId:d.defaultView.crypto.randomUUID(),operation:entry?'rename':'create-folder',resourceId:(entry||folder).id,expectedVersion:(entry||folder).version,newName:input.value};await request({operation:'change',ownerId:owner.id,command});form.remove();await poll();}catch(error){message.textContent=error.message;}finally{submit.disabled=false;}});
  }
  function row(name) {
    const element = d.createElement('div'); element.className = 'navigator-row'; element.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:8px;border-bottom:1px solid #ffffff18;min-height:36px';
    const label = d.createElement('span'); label.textContent = name; label.style.cssText = 'flex:1;min-width:90px;overflow-wrap:anywhere'; element.append(label); return element;
  }
  async function render() {
    if (!active) return;
    const current = ++generation; message.textContent = 'Loading…';changesAllowed=false;newFolder.disabled=true;paste.disabled=true;
    try {
      const snapshot = await request({ operation: 'status' });
      if (current !== generation || !active) return;
      body.replaceChildren(); location.replaceChildren(); edits.replaceChildren(); workingCopies.disabled = !owner;
      editClientAvailable = snapshot.capabilities?.edits === true;
      editRecoveryAvailable = snapshot.capabilities?.editRecovery === true;
      workingCopies.hidden = !editClientAvailable;
      if (!editClientAvailable) editMode = false;
      heading.textContent = owner?.name || 'Devices'; back.disabled = !owner;
      if (!owner) {
        message.textContent = snapshot.devices.length ? 'Choose a computer.' : 'Connect a computer in Papers Settings → Devices.';
        for (const device of snapshot.devices) { const element = row(device.name); element.append(button('Browse', () => { owner = device; history = []; offlineMode = false; editMode = false; return render(); })); body.append(element); }
        return;
      }
      location.textContent = [owner.name, ...history.map(item => item.name)].join(' › ');
      if (editMode) {
        const copies = await request({ operation: 'edit-list', ownerId: owner.id });
        const recovery = editRecoveryAvailable ? await request({ operation: 'edit-recovery', ownerId: owner.id }) : [];
        if (current !== generation || !active) return;
        message.textContent = copies.length ? 'Local working copies are retained here. Save back checks the owner’s original before changing it.' : 'No local working copies yet. Choose Edit local copy beside an online file.';
        if (recovery.length) message.textContent = 'Some local edits need recovery. Their files were retained here; other working copies remain available.';
        for (const item of recovery) {
          const element = row(item.name || 'Retained editing files'), label = d.createElement('span'); label.textContent = item.message;
          element.append(label, button('Open retained files', () => request({ operation: 'edit-recovery-open', editId: item.id }))); body.append(element);
        }
        for (const copy of copies) {
          const element = row(copy.name), label = d.createElement('span');
          label.textContent = { editing: 'Local edits — not saved to owner', saving: 'Save snapshot retained — ready to resume', saved: 'Saved to owner; local copy retained', conflict: 'Owner changed — both versions retained', uncertain: 'Save unconfirmed — retained snapshot can be checked again' }[copy.phase] || 'Retained locally';
          element.append(label, button('Open local editor', () => request({ operation: 'edit-open', editId: copy.id })));
          if (!['saved', 'conflict'].includes(copy.phase)) {
            const save = button(copy.phase === 'editing' ? 'Save back' : 'Resume / check save', async () => {
              if (editBusy) return;
              editBusy = true; save.disabled = true;
              message.textContent = 'Saving retained edited bytes to the owner…';
              try { await request({ operation: 'edit-save', editId: copy.id }); }
              finally { editBusy = false; await render(); }
            });
            save.disabled = editBusy; element.append(save);
          }
          if (copy.phase === 'conflict') {
            const recovery = d.createElement('span'); recovery.textContent = 'Keep this local copy. Browse the owner’s current file to begin a new edit session.'; element.append(recovery);
          }
          body.append(element);
        }
        return;
      }
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
        changesAllowed=listing.online&&listing.capabilities?.changes===true;
        if(folder&&listing.folder)folder.version=listing.folder.version;
        newFolder.disabled=!changesAllowed||!folder;paste.disabled=!changesAllowed||!folder||!transfer||transfer.ownerId!==owner.id;
        for (const entry of listing.entries) {
          const element = row(entry.name);
          if (entry.kind === 'folder') element.append(button('Open folder', () => { history.push(entry); return render(); }));
          else {
            const keep = button('Keep offline', async () => { await request({ operation: 'download', ownerId: owner.id, entry }); await poll(); });
            keep.disabled = !listing.online; element.append(keep);
            if (editClientAvailable && listing.online && listing.capabilities?.edits === true) {
              const edit = button('Edit local copy', async () => {
                if (editBusy) return;
                editBusy = true; edit.disabled = true; message.textContent = 'Preparing a verified local working copy…';
                const clickedOwner = owner.id, clickedGeneration = generation;
                try {
                  const copy = await request({ operation: 'edit-begin', ownerId: clickedOwner, entry });
                  if (!active || generation !== clickedGeneration || owner?.id !== clickedOwner) return;
                  await request({ operation: 'edit-open', editId: copy.id });
                  editMode = true;
                } finally { editBusy = false; await render(); }
              });
              edit.disabled = editBusy; element.append(edit);
            }
          }
          if(changesAllowed&&folder){
            element.append(button('Rename',()=>editName(entry)));
            for(const operation of ['move','copy'])element.append(button(operation==='move'?'Move':'Copy',()=>{transfer={ownerId:owner.id,entry,operation};paste.disabled=!history.length;message.textContent='Open the destination folder, then choose Paste here.';}));
            element.append(button('Recycle',()=>{
              const command={commandId:d.defaultView.crypto.randomUUID(),operation:'delete',resourceId:entry.id,expectedVersion:entry.version};
              const confirmation=row(`Move ${entry.name} to the owner’s Recycle Bin?`);
              confirmation.append(button('Cancel',()=>confirmation.remove()),button('Recycle',async()=>{await request({operation:'change',ownerId:owner.id,command});confirmation.remove();await poll();}));body.prepend(confirmation);
            }));
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
    const current=generation,pollOwner=owner;
    try {
      const snapshot = await request({ operation: 'status' });
      if (!active||current!==generation) return;
      progress.replaceChildren();
      for (const job of snapshot.jobs.filter(job => job.ownerId === owner?.id)) {
        const element = row(job.entry.name);
        const label = d.createElement('span');
        label.textContent = job.error || (job.phase === 'completed' ? 'Available offline' : `${job.phase} — ${(job.bytes / 1024 / 1024).toFixed(1)} / ${(job.entry.size / 1024 / 1024).toFixed(1)} MiB`);
        element.append(label);
        if (job.phase === 'queued' || job.phase === 'transferring' || job.phase === 'verifying') element.append(button('Cancel', () => request({ operation: 'cancel', jobId: job.id })));
        progress.append(element);
      }
      for(const job of (snapshot.commandJobs||[]).filter(job=>job.ownerId===owner?.id&&['submitting','uncertain'].includes(job.phase))){
        const action={'create-folder':'Create folder',rename:'Rename',move:'Move',copy:'Copy',delete:'Recycle'}[job.operation]||job.operation;
        const element=row(action),label=d.createElement('span');label.textContent=job.error||'Sending request…';element.append(label);
        if(job.phase==='uncertain')element.append(button('Retry saved request',async()=>{await request({operation:'change-retry',ownerId:owner.id,commandId:job.commandId});await poll();}));
        progress.append(element);
      }
      if(changesAllowed&&pollOwner){
        const jobs=await request({operation:'changes',ownerId:pollOwner.id});
        if(!active||current!==generation)return;
        const state=JSON.stringify(jobs.map(job=>[job.commandId,job.phase]));
        for(const job of jobs){const action={'create-folder':'Create folder',rename:'Rename',move:'Move',copy:'Copy',delete:'Recycle'}[job.operation]||job.operation;const element=row(`${action}${job.name?' — '+job.name:''}`);const label=d.createElement('span');label.textContent=job.error||(job.phase==='completed'?'Completed':job.phase==='waiting'?'Waiting for the owner’s file operation':job.phase);element.append(label);progress.append(element);}
        if(state!==lastChanges&&jobs.some(job=>job.phase==='completed')){lastChanges=state;await render();}else lastChanges=state;
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

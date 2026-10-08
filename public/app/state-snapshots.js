import { bindNavigatorRowInteractions } from './navigator-row-interactions.js';
export function snapshotDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Saigon',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
}

export async function createStateSnapshot(state, name = snapshotDate(), date = new Date()) {
  const copy = structuredClone(state);
  if(copy.view?.preferences)delete copy.view.preferences.stateSnapshots;
  const compressed = await new Response(new Blob([JSON.stringify(copy)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  let binary='';for(const byte of new Uint8Array(compressed))binary+=String.fromCharCode(byte);
  return {id:crypto.randomUUID(),name:name.trim()||snapshotDate(date),createdAt:date.toISOString(),format:'gzip-base64',data:btoa(binary)};
}

async function readSnapshotFile(path,fileCapability){
  let offset=0,text='';
  while(true){
    const result=await fileCapability('preview-text-chunk',{path,offset,maxBytes:262144});
    if(!result?.ok)throw new Error(result?.message||'Snapshot file could not be read.');
    text+=result.text||'';
    if(result.eof)return text;
    if(result.nextOffset<=offset)throw new Error('Snapshot file could not be read completely.');
    offset=result.nextOffset;
  }
}
async function snapshotHash(text){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');}

export async function createFileStateSnapshot(storage,name,fileCapability){
  const id=crypto.randomUUID(),date=new Date();
  const folder=await fileCapability('create-folder',{path:storage.directory,newName:id});
  if(!folder?.ok)throw new Error(folder?.message||'Snapshot folder could not be created.');
  const directory=folder.entry?.path||`${storage.directory}\\${id}`;
  const copied=await fileCapability('copy',{paths:[storage.statePath],destination:directory});
  if(!copied?.ok)throw new Error(copied?.message||'Snapshot file could not be copied.');
  const path=`${directory}\\state.json`;
  for(let attempt=0;attempt<40;attempt++){
    try{
      const text=await readSnapshotFile(path,fileCapability),state=JSON.parse(text);
      if(state.schemaVersion!==1||!Array.isArray(state.groups)||!Array.isArray(state.shortcuts))throw new Error('Snapshot file is incomplete.');
      return {id,name:name.trim()||snapshotDate(date),createdAt:date.toISOString(),format:'file-json',path,hash:await snapshotHash(text)};
    }catch(error){if(attempt===39)throw error;await new Promise(resolve=>setTimeout(resolve,100));}
  }
}

export async function readStateSnapshot(snapshot,fileCapability) {
  if(snapshot.format==='file-json'){
    const text=await readSnapshotFile(snapshot.path,fileCapability);
    if(snapshot.hash&&await snapshotHash(text)!==snapshot.hash)throw new Error('This snapshot file changed after it was saved. Restore was stopped.');
    const state=JSON.parse(text);
    if(state.schemaVersion!==1||!Array.isArray(state.groups)||!Array.isArray(state.shortcuts))throw new Error('This snapshot does not contain a workspace.');
    return state;
  }
  if(snapshot.format!=='gzip-base64')throw new Error('This snapshot format is not supported.');
  const bytes=Uint8Array.from(atob(snapshot.data),char=>char.charCodeAt(0));
  const raw=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  const state=JSON.parse(raw);
  if(state.schemaVersion!==1||!Array.isArray(state.groups)||!Array.isArray(state.shortcuts))throw new Error('This snapshot does not contain a workspace.');
  return state;
}

export function withStateSnapshots(state, snapshots) {
  const next={...state,view:{...state.view,preferences:{...state.view?.preferences,stateSnapshots:snapshots}}};
  return next;
}

export async function confirmSnapshotRestore(record, {verify,confirm}) {
  if(!await verify(record))return false;
  return await confirm({title:'Final confirmation: restore snapshot?',copy:`Replace the current workspace with “${record.name}” from ${new Date(record.createdAt).toLocaleString()}? A snapshot of the current state will be saved first.`,confirmLabel:'Restore this snapshot'})===true;
}

export function bindStateSnapshots({document,button,getState,save,confirm,setStatus,fileCapability}) {
  if(!button)return {close(){}};
  let panel=null,body=null,search=null,interactions=null,busy=false,selected=new Set();
  const list=()=>getState().view?.preferences?.stateSnapshots||[];
  const close=()=>{if(busy)return;interactions?.cancel();interactions=null;panel?.remove();panel=null;document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',escape,true);};
  const outside=event=>{if(panel&&!panel.contains(event.target)&&!button.contains(event.target)&&!busy)close();};
  const escape=event=>{if(event.key==='Escape'&&panel&&!busy){event.preventDefault();event.stopPropagation();close();}};
  const paintSelection=()=>body?.querySelectorAll('[data-id]').forEach(row=>row.classList.toggle('selected',selected.has(row.dataset.id)));
  async function perform(action){
    if(busy)return;busy=true;panel?.setAttribute('aria-busy','true');
    try{await action();if(panel)render();}catch(error){setStatus(error.message||'Snapshot could not be saved.');}
    finally{busy=false;panel?.removeAttribute('aria-busy');}
  }
  async function persist(build){if(await save(build)===false)throw new Error('Snapshots could not be saved.');}
  async function createBackup(name){
    const storage=getState().view?.preferences?.snapshotStorage;
    if(storage&&fileCapability){await persist(current=>current);return createFileStateSnapshot(storage,name,fileCapability);}
    return createStateSnapshot(getState(),name);
  }
  function verifyRestore(record){
    return new Promise(resolve=>{
      const layer=document.createElement('div');layer.className='snapshots-restore-check';
      const card=document.createElement('section');card.className='snapshots-restore-card';card.setAttribute('role','dialog');card.setAttribute('aria-modal','true');card.setAttribute('aria-label','Verify snapshot restore');
      const title=document.createElement('strong');title.textContent='Verify snapshot restore';
      const details=document.createElement('p');details.textContent=`${record.name} — ${new Date(record.createdAt).toLocaleString()}`;
      const phrase=`RESTORE ${record.name}`;
      const instruction=document.createElement('p');instruction.textContent=`Type “${phrase}” to continue to the final confirmation.`;
      const input=document.createElement('input');input.setAttribute('aria-label','Restore confirmation phrase');input.autocomplete='off';input.spellcheck=false;
      const cancel=document.createElement('button');cancel.className='quiet-button';cancel.type='button';cancel.textContent='Cancel';
      const next=document.createElement('button');next.className='quiet-button';next.type='button';next.textContent='Review final confirmation';next.disabled=true;
      const finish=answer=>{layer.remove();resolve(answer);};
      input.addEventListener('input',()=>{next.disabled=input.value!==phrase;});
      layer.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Escape'){event.preventDefault();finish(false);}});
      cancel.addEventListener('click',()=>finish(false));next.addEventListener('click',()=>{if(input.value===phrase)finish(true);});
      card.append(title,details,instruction,input,cancel,next);layer.append(card);document.body.append(layer);input.focus();
    });
  }
  async function restore(record){
    const restored=await readStateSnapshot(record,fileCapability);
    if(!await confirmSnapshotRestore(record,{verify:verifyRestore,confirm}))return;
    const safety=await createBackup(snapshotDate());
    await persist(current=>withStateSnapshots({...restored,view:{...restored.view,preferences:{...restored.view?.preferences,snapshotStorage:current.view?.preferences?.snapshotStorage}}},[safety,...(current.view?.preferences?.stateSnapshots||[])]));setStatus('Snapshot restored.');
  }
  const tool=(title,paths,action,managed=true)=>{
    const b=document.createElement('button');b.type='button';b.className='navigator-icon-button';b.title=title;b.setAttribute('aria-label',title);
    b.innerHTML=`<svg viewBox="0 0 20 20" aria-hidden="true">${paths.map(path=>`<path d="${path}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}</svg>`;
    b.addEventListener('click',()=>{if(managed)void perform(action);else action();});return b;
  };
  function render(){
    body.replaceChildren();
    const query=search.value.trim().toLowerCase();
    const columns=document.createElement('div');columns.className='workspace-navigator-machine-columns snapshots-columns';
    for(const text of ['','Name','Date created']){const label=document.createElement('span');label.textContent=text;columns.append(label);}body.append(columns);
    for(const record of list().filter(record=>record.name.toLowerCase().includes(query))){
      const row=document.createElement('div');row.className='workspace-navigator-row snapshots-row';row.draggable=true;
      row.dataset.id=record.id;row.dataset.reorderParent='snapshots';row.dataset.reorderFolder='false';
      const image=document.createElement('span');image.className='workspace-navigator-art';image.textContent='◷';
      const label=document.createElement('span');label.className='workspace-navigator-label';label.textContent=record.name;
      const time=document.createElement('span');time.className='workspace-navigator-machine-modified';time.textContent=new Date(record.createdAt).toLocaleString();
      row.append(image,label,time);row.classList.toggle('selected',selected.has(record.id));
      row.addEventListener('click',event=>{if(event.ctrlKey){selected.has(record.id)?selected.delete(record.id):selected.add(record.id);}else selected=new Set([record.id]);paintSelection();});
      row.addEventListener('dblclick',()=>void perform(()=>restore(record)));
      row.addEventListener('dragstart',event=>{event.dataTransfer?.setData('application/x-papers-snapshots',record.id);if(event.dataTransfer)event.dataTransfer.effectAllowed='move';});
      body.append(row);
    }
    if(!list().length){const empty=document.createElement('p');empty.className='workspace-navigator-empty';empty.textContent='No snapshots yet. Use + to create one.';body.append(empty);}
  }
  button.addEventListener('click',()=>{
    if(busy)return;if(panel){close();return;}
    selected=new Set();panel=document.createElement('section');panel.className='workspace-navigator snapshots-panel';panel.setAttribute('role','dialog');panel.setAttribute('aria-label','Snapshots');
    const header=document.createElement('div');header.className='workspace-navigator-header';
    const title=document.createElement('span');title.className='workspace-navigator-provider';title.textContent='Snapshots';
    const tools=document.createElement('div');tools.className='workspace-navigator-toolbar';
    tools.append(tool('Create snapshot',['M10 4v12','M4 10h12'],async()=>{
      const record=await createBackup(snapshotDate());
      await persist(current=>withStateSnapshots(current,[record,...(current.view?.preferences?.stateSnapshots||[])]));setStatus('Snapshot saved.');
    }),tool('Rename selected snapshot',['M4 14l1 3 3-1L16 8l-4-4z','M10 6l4 4'],async()=>{
      if(selected.size!==1){setStatus('Select one snapshot to rename.');return;}
      const id=[...selected][0],record=list().find(item=>item.id===id);
      const row=[...body.querySelectorAll('[data-id]')].find(item=>item.dataset.id===id);
      if(!record||!row)return;
      const label=row.querySelector('.workspace-navigator-label');
      const input=document.createElement('input');input.className='navigator-inline-rename';input.value=record.name;input.setAttribute('aria-label','Snapshot name');label.replaceChildren(input);
      const value=await new Promise(resolve=>{
        let done=false;const finish=value=>{if(done)return;done=true;resolve(value);};
        input.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Enter'){event.preventDefault();finish(input.value.trim());}else if(event.key==='Escape'){event.preventDefault();finish(null);}});
        input.addEventListener('blur',()=>finish(input.value.trim()));
        ['pointerdown','click','dblclick'].forEach(type=>input.addEventListener(type,event=>event.stopPropagation()));
        input.focus();input.select();
      });
      if(!value)return;
      await persist(current=>withStateSnapshots(current,(current.view?.preferences?.stateSnapshots||[]).map(record=>record.id===id?{...record,name:value}:record)));
    }),tool('Delete selected snapshots',['M4 6h12','M7 6v10h6V6','M8 4h4'],async()=>{
      if(!selected.size)return;
      if(!await confirm({title:'Delete snapshots?',copy:`Delete ${selected.size} selected snapshot${selected.size===1?'':'s'}?`,confirmLabel:'Delete'}))return;
      const removed=list().filter(record=>selected.has(record.id));
      await persist(current=>withStateSnapshots(current,(current.view?.preferences?.stateSnapshots||[]).filter(record=>!selected.has(record.id))));selected.clear();
      const root=getState().view?.preferences?.snapshotStorage?.directory;
      if(root&&fileCapability){
        const normalized=String(root).replace(/\//g,'\\').replace(/\\+$/,'').toLowerCase()+'\\';
        const folders=removed.filter(record=>record.format==='file-json'&&String(record.path).replace(/\//g,'\\').toLowerCase().startsWith(normalized)).map(record=>record.path.replace(/[\\/]state\.json$/i,''));
        if(folders.length){const result=await fileCapability('delete',{paths:[...new Set(folders)]});if(!result?.ok)setStatus('Snapshots removed from the list, but their backup files could not be recycled.');}
      }
    }),tool('Restore selected snapshot',['M3 6h5l1.5 2H17v8H3z','M3 9h14'],async()=>{
      if(selected.size!==1){setStatus('Select one snapshot to restore.');return;}
      const record=list().find(item=>selected.has(item.id));if(record)await restore(record);
    }));
    const collapse=tool('Close snapshots',['M12 5l-5 5 5 5'],close,false);collapse.classList.add('workspace-navigator-collapse');
    header.append(title,tools,collapse);
    const searchBox=document.createElement('div');searchBox.className='workspace-navigator-search';search=document.createElement('input');search.placeholder='Search snapshots';search.setAttribute('aria-label','Search snapshots');search.addEventListener('input',render);searchBox.append(search);
    body=document.createElement('div');body.className='workspace-navigator-body';
    panel.append(header,searchBox,body);document.body.append(panel);render();
    interactions=bindNavigatorRowInteractions({document,body,getSelection:()=>selected,setSelection:ids=>{selected=new Set(ids);paintSelection();},restore:render,
      reorder:plan=>perform(()=>persist(current=>{const records=current.view?.preferences?.stateSnapshots||[];const moving=records.filter(record=>plan.moving.includes(record.id));const remaining=records.filter(record=>!plan.moving.includes(record.id));const index=plan.beforeId?remaining.findIndex(record=>record.id===plan.beforeId):remaining.length;remaining.splice(index<0?remaining.length:index,0,...moving);return withStateSnapshots(current,remaining);})),canMove:()=>!busy});
    const rect=button.getBoundingClientRect();panel.style.left=`${Math.max(8,Math.min(rect.left,document.defaultView.innerWidth-600))}px`;panel.style.top=`${Math.min(rect.bottom+8,document.defaultView.innerHeight-240)}px`;
    document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',escape,true);
  });
  return {close};
}

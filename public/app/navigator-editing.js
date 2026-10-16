/** Editing commands stay with the file owner. This module only presents its status. */
export function editingChoices(result, devices) {
  const names=new Set([devices?.owner,...(devices?.devices||[])].filter(Boolean).map(x=>String(x.name||'').trim().toLowerCase())),seen=new Set();
  return (result.editors||[]).filter(x=>{const key=String(x.name||'').trim().toLowerCase();if(!key||!names.has(key)||seen.has(key))return false;seen.add(key);return true;});
}
export async function assignEditingFiles(host, files, name) {
  const results=[];
  for(const file of files){try{
    const fresh=await host.fileCapability('editing',{path:file.path,action:'status'});
    if(!fresh?.ok)throw Error(fresh?.message||'File owner unavailable');
    const editor=(fresh.editors||[]).find(e=>e.name.toLowerCase()===name.toLowerCase());
    if(!editor)throw Error('Device is no longer authorized');
    if(!(fresh.assignments||[]).some(a=>a.active&&a.editorDeviceId===editor.id)){
      const result=await host.fileCapability('editing',{path:file.path,action:'assign',editorDeviceId:editor.id});
      if(!result?.ok)throw Error(result?.message||'Assignment refused');
    }
    results.push({path:file.path,ok:true});
  }catch(error){results.push({path:file.path,ok:false,message:error.message});}}
  return results;
}
export function createNavigatorEditing({document:d,host,paths,setStatus}) {
  const w=d.defaultView, rows=new Map(), cache=new Map();let timer=0,busy=false,closed=false;
  const active=status=>(status?.assignments||[]).find(a=>a.active);
  async function read(path,force=false){const old=cache.get(path);if(!force&&old&&Date.now()-old.at<5000)return old.value;
    const value=await host.fileCapability('editing',{path,action:'status'});if(!value?.ok)throw Error(value?.message||'Editing unavailable');cache.set(path,{at:Date.now(),value});return value;}
  function paint(row,path,status){row.querySelector('.navigator-editing-stamp')?.remove();row.classList.toggle('navigator-editing-local',Boolean(status.localCopy));const assignment=active(status);if(!assignment)return;
    const editor=(status.editors||[]).find(e=>e.id===assignment.editorDeviceId),name=editor?.name||'another device';
    const stamp=d.createElement('button');stamp.type='button';stamp.className='navigator-editing-stamp';stamp.title=`Editing on ${name}. Click to stop writing back to the original.`;stamp.setAttribute('aria-label',`Stop editing on ${name}`);
    const label=d.createElement('span');label.textContent=`(${name})`;const pen=d.createElement('span');pen.textContent='✎';pen.className='navigator-editing-pen';stamp.append(label,pen);
    stamp.addEventListener('pointerdown',e=>e.stopPropagation());stamp.addEventListener('dblclick',e=>{e.stopPropagation();e.preventDefault();});
    stamp.addEventListener('click',async e=>{e.stopPropagation();e.preventDefault();stamp.disabled=true;try{const result=await host.fileCapability('editing',{path,action:'stop',assignmentId:assignment.id});if(!result?.ok)throw Error(result?.message||'Owner did not confirm stopping');cache.delete(path);await update(path);setStatus('Editing stopped. The original keeps its last accepted save.');}catch(error){setStatus(error.message);stamp.disabled=false;}});
    row.append(stamp);
  }
  async function update(path){try{const status=await read(path,true);for(const [row,p] of rows)if(p===path&&row.isConnected)paint(row,path,status);}catch{/* An unreachable owner is not proof that editing stopped. */}}
  async function poll(){if(closed||busy)return;busy=true;try{const visible=new Set();for(const [row,path] of rows){if(!row.isConnected){rows.delete(row);continue;}const r=row.getBoundingClientRect();if(r.bottom>=0&&r.top<=w.innerHeight)visible.add(path);}
    const queue=[...visible];await Promise.all([0,1].map(async()=>{while(queue.length){const path=queue.shift();try{const result=await host.fileCapability('stat',{path});if(result?.ok&&typeof result.entry?.offline==='boolean')for(const [row,p] of rows)if(p===path&&row.isConnected)row.classList.toggle('navigator-offline-entry',result.entry.offline);}catch{}try{const status=await read(path);for(const [row,p] of rows)if(p===path&&row.isConnected)paint(row,path,status);}catch{}}}));
  }finally{busy=false;}}
  function observe(row,path){if(!path)return;rows.set(row,path);const old=cache.get(path);if(old)paint(row,path,old.value);w.clearTimeout(timer);timer=w.setTimeout(poll,50);}
  async function start(){const selected=[...new Set(paths().filter(Boolean))];if(!selected.length){setStatus('Select files first.');return;}
    const files=[];let skipped=0;const failures=[];
    setStatus('Checking selected files…');
    const devices=await host.fileCapability('remote-files',{operation:'status'}).catch(()=>null);if(!devices?.ok){setStatus('Device list is unavailable.');return;}
    for(const path of selected){try{const stat=await host.fileCapability('stat',{path});if(!stat?.ok)throw Error(stat?.message||'File unavailable');if(stat.entry?.kind!=='file'){skipped++;continue;}const status=await read(path,true);files.push({path,status,editors:editingChoices(status,devices.result)});}catch(error){failures.push(error.message);}}
    if(!files.length){setStatus(failures[0]||'Choose files; folders are not enrolled in editing.');return;}
    const choices=files[0].editors.filter(editor=>files.every(file=>file.editors.some(e=>e.name.toLowerCase()===editor.name.toLowerCase())));
    if(!choices.length){setStatus('No device can edit every selected file. Select files with a common editing destination.');return;}
    const assign=async editor=>{const results=await assignEditingFiles(host,files,editor.name);await Promise.all(files.map(f=>update(f.path)));const failed=results.filter(r=>!r.ok);setStatus(`${results.length-failed.length} file(s) assigned to ${editor.name}.${skipped?' '+skipped+' folder(s) skipped.':''}${failures.length?' '+failures.length+' file(s) unavailable.':''}${failed.length?' '+failed.length+' failed: '+failed[0].message:''}`);};
    if(choices.length===1){await assign(choices[0]);return;}
    const overlay=d.createElement('div');overlay.className='navigator-edit-assignment-overlay';const dialog=d.createElement('section');dialog.className='navigator-edit-assignment-dialog';dialog.setAttribute('role','dialog');dialog.setAttribute('aria-label','Choose editing device');const title=d.createElement('strong');title.textContent=`Edit ${files.length} file(s) on…`;dialog.append(title);
    for(const editor of choices){const choose=d.createElement('button');choose.type='button';choose.textContent=editor.name;choose.addEventListener('click',async()=>{overlay.remove();await assign(editor);});dialog.append(choose);}
    const close=d.createElement('button');close.type='button';close.textContent='Cancel';close.addEventListener('click',()=>overlay.remove());dialog.append(close);overlay.append(dialog);overlay.addEventListener('click',e=>{if(e.target===overlay)overlay.remove();});d.body.append(overlay);close.focus();
  }
  const interval=w.setInterval(poll,5000);w.addEventListener('pagehide',()=>{closed=true;w.clearInterval(interval);w.clearTimeout(timer);rows.clear();},{once:true});
  return {observe,start};
}

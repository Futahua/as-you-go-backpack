/** File identity is owned by the device. This adapter only reconciles the existing AYG document. */
export const isFileTarget=target=>typeof target==='string'&&(/^(?:[a-z]:[\\/]|\\\\)/i.test(target)||target.startsWith('content://'));
const key=p=>String(p||'').replace(/\//g,'\\').toLowerCase();
const refId=x=>x?.fileTarget?.id;
const diskName=p=>{const name=String(p||'').split(/[\\/]/).filter(Boolean).pop()||'';try{return decodeURIComponent(name);}catch{return name;}};
function entries(state,isTarget=isFileTarget){return [...(state.shortcuts||[]).filter(x=>isTarget(x.target)).map(x=>({kind:'shortcut',id:x.id,path:x.target,ref:x.fileTarget,active:(x.placements||[]).some(p=>!p.bin)})),...(state.view?.preferences?.navigatorSavedStates||[]).map(x=>({kind:'pill',path:x.path||x.art?.target,ref:x.fileTarget})).filter(x=>isTarget(x.path))];}
export async function enrollNewFileTargets(state,before,call){let next=state;const old=entries(before);for(const entry of entries(state)){if(entry.ref?.id)continue;const previous=old.find(x=>entry.kind==='shortcut'?x.kind==='shortcut'&&x.id===entry.id:x.kind==='pill'&&key(x.path)===key(entry.path));if(previous&&previous.path===entry.path&&!previous.ref?.id)continue;try{const response=await call('file-target-track',{path:entry.path});if(response?.ok&&response.target?.targetId)next=applyFileTargetResult(next,entry,response.target);}catch{}}return next;}
function retarget(value,oldPath,newPath){if(typeof value==='string'){const p=key(value),old=key(oldPath);return p===old?newPath:p.startsWith(old+'\\')?newPath+value.slice(oldPath.length):value;}if(Array.isArray(value))return value.map(x=>retarget(x,oldPath,newPath));if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,retarget(v,oldPath,newPath)]));return value;}

export function applyFileTargetResult(state,entry,result,at=new Date().toISOString()){
 if(!result?.targetId||!result.status)return state;
 const matches=x=>(entry.kind==='shortcut'?x.id===entry.id:key(x.path||x.art?.target)===key(entry.path))&&(!refId(x)||refId(x)===result.targetId);
 // The name comes from the owner's path when it reports one; otherwise keep the name this record has
 // now. Falling back to the entry read before the owner answered let two panes of one workspace
 // alternately add and drop it, re-saving each other's document without end.
 const refFor=x=>{const name=result.path?diskName(result.path):(x.fileTarget?.name||entry.ref?.name);return{id:result.targetId,status:result.status,revision:result.revision??0,...(name?{name}:{})};};let changed=false;
 const update=(x,pill=false)=>{if(!matches(x))return x;const nextRef=refFor(x);const old=pill?(x.path||x.art?.target):x.target;if(key(old)!==key(entry.path))return x;
 if(refId(x)===result.targetId&&(x.fileTarget.revision??0)>(result.revision??0))return x;
 if(JSON.stringify(x.fileTarget)!==JSON.stringify(nextRef))changed=true;
 let next={...x,fileTarget:nextRef};
 if(result.status==='present'&&result.path&&old!==result.path){changed=true;if(next.name===(x.fileTarget?.name||diskName(old)))next.name=diskName(result.path);if(pill){next=retarget(next,old,result.path);}else next.target=result.path;}
 if(result.status==='deleted'&&!pill){next.placements=(x.placements||[]).map(p=>p.bin?p:{...p,bin:{parentId:p.parentId,order:p.order??0,binnedAt:at}});if(JSON.stringify(next.placements)!==JSON.stringify(x.placements))changed=true;}
 return next;};
 let shortcuts=(state.shortcuts||[]).map(x=>entry.kind==='shortcut'?update(x):x);
 let pills=state.view?.preferences?.navigatorSavedStates;
 if(Array.isArray(pills)){pills=pills.flatMap(x=>{const matching=entry.kind==='pill'&&matches(x)||refId(x)===result.targetId||(result.status==='deleted'&&key(x.path||x.art?.target)===key(entry.path));if(!matching)return[x];if(result.status==='deleted'){changed=true;return[];}if(entry.kind==='pill')return[update(x,true)];if(result.status==='present'&&result.path){const next=retarget(x,entry.path,result.path);if(JSON.stringify(next)!==JSON.stringify(x))changed=true;return[next];}return[x];});}
 if(!changed)return state;
 let view={...state.view,preferences:{...state.view?.preferences,...(pills?{navigatorSavedStates:pills}:{})}};
 if(result.status==='present'&&result.path&&result.path!==entry.path)view=retarget(view,entry.path,result.path);
 return{...state,shortcuts,view};
}

export function createFileTargets({host,getState,save,ready=()=>true,onError=()=>{}}){
 let busy=false,disposed=false,cursor=0;const recent=new Map(),inspections=new Map();
 async function inspect(entry,{persist=true}={}){const inspectionKey=JSON.stringify([entry.kind,entry.id,entry.path,entry.ref?.id,persist]);if(inspections.has(inspectionKey))return inspections.get(inspectionKey);const pending=inspectOnce(entry,{persist});inspections.set(inspectionKey,pending);try{return await pending;}finally{if(inspections.get(inspectionKey)===pending)inspections.delete(inspectionKey);}}
 async function inspectOnce(entry,{persist=true}={}){const op=entry.ref?.id?'file-target-resolve':'file-target-track';const response=await host.fileCapability(op,{path:entry.path,...(entry.ref?.id?{targetId:entry.ref.id}:{})});if(response?.ok!==true)return null;const result=response.target;if(!result?.targetId)return null;recent.set(key(entry.path),result);if(persist)await save(state=>applyFileTargetResult(state,entry,result));return result;}
 async function refresh(){if(busy||disposed||!ready())return;busy=true;try{const all=entries(getState(),path=>isFileTarget(path)||Boolean(host.deviceFilePath?.(path)));if(!all.length)return;const chosen=all.slice(cursor,cursor+12);cursor=cursor+12>=all.length?0:cursor+12;for(const entry of chosen){if(disposed)break;try{await inspect(entry);}catch(error){onError(error);}}}finally{busy=false;}}
 function currentEntry(target){const matches=entries(getState(),path=>isFileTarget(path)||Boolean(host.deviceFilePath?.(path))).filter(x=>key(x.path)===key(target));return matches.find(x=>x.kind==='shortcut'&&x.active)||matches.find(x=>x.kind==='pill')||matches[0];}
 async function resolvePath(target){const entry=currentEntry(target);if(!entry)return target;let result=await inspect(entry);if(!result){if(entry.ref?.id)throw Error('This file reference could not be verified.');return target;}if(result.status==='unavailable'&&host.blobWorkspaceId){const downloaded=await host.fileCapability('workspace-download',{path:target,targetId:result.targetId});if(downloaded?.ok)result=downloaded.target;}if(result.status!=='present')throw Error(result.status==='deleted'?'This file was deleted on its device.':result.status==='replacement'?'This path now belongs to a different file. Relink it before continuing.':'Not available locally. Connect to a device holding this file to download it.');return result.path;}
 async function deletePath(target,{persist=true}={}){const entry=currentEntry(target);if(!entry)throw Error('Choose a current file entry.');const result=await inspect(entry,{persist});if(!result||result.status!=='present')throw Error('The file identity could not be verified; remove only the AYG entry instead.');const commandId=globalThis.crypto.randomUUID();const response=await host.fileCapability('file-target-delete',{path:result.path,targetId:result.targetId,expectedRevision:result.revision,commandId});if(!response?.ok)throw Error(response?.message||'The owner refused recycling this file.');let confirmed=response.target;for(let n=0;confirmed?.status!=='deleted'&&n<120;n++){await new Promise(r=>setTimeout(r,250));const check=await host.fileCapability('file-target-resolve',{path:result.path,targetId:result.targetId});confirmed=check?.target;}if(confirmed?.status!=='deleted')throw Error('The device has not confirmed recycling this file. Check its operation before trying again.');if(persist)await save(state=>applyFileTargetResult(state,entry,confirmed));return{ok:true,recycle:true,target:confirmed,recordId:entry.id,path:entry.path};}
 async function prepareRestore(state,ids){let next=state;const chosen=new Set(ids);const files=(state.shortcuts||[]).filter(file=>chosen.has(file.id)||(file.placements||[]).some(p=>chosen.has(p.id)));for(const file of files){if(!file.fileTarget?.id)continue;const status=await host.fileCapability('file-target-resolve',{path:file.target,targetId:file.fileTarget.id});if(!status?.ok)throw Error(status?.message||'File owner unavailable; entry kept in Bin.');let result=status.target;if(result?.status==='deleted'){const restored=await host.fileCapability('file-target-restore',{path:file.target,targetId:result.targetId,expectedRevision:result.revision,commandId:globalThis.crypto.randomUUID()});if(!restored?.ok||restored.target?.status!=='present')throw Error(restored?.message||'The owner could not restore this file. Entry kept in Bin.');result=restored.target;}if(result?.status!=='present')throw Error('The original file is unavailable; entry kept in Bin.');next=applyFileTargetResult(next,{kind:'shortcut',id:file.id,path:file.target,ref:file.fileTarget},result);}return next;}
 const timer=setInterval(()=>{void refresh();},8000);timer.unref?.();
 return{refresh,resolvePath,deletePath,prepareRestore,prepareHistory:(current,next,confirmDelete)=>prepareFileTargetHistory(current,next,{prepareRestore,deletePath:target=>deletePath(target,{persist:false}),confirmDelete}),hasPath:p=>entries(getState(),path=>isFileTarget(path)||Boolean(host.deviceFilePath?.(path))).some(x=>key(x.path)===key(p)),async beforeDelete(paths){for(const p of paths)await resolvePath(p);},dispose(){disposed=true;clearInterval(timer);},recent};
}

/** History replays the same checked disk commands, rather than resurrecting only a tile. */
export async function prepareFileTargetHistory(current,next,{prepareRestore,deletePath,confirmDelete=async()=>true}) {
 const active=(state,file)=>(file?.placements||[]).some(p=>{
  if(p.bin)return false;let parent=p.parentId;const seen=new Set();
  while(parent&&!seen.has(parent)){seen.add(parent);const folder=state.groups?.find(g=>g.id===parent);if(!folder)break;if(folder.bin)return false;parent=folder.parentId;}
  return true;
 });
 const previous=new Map((current.shortcuts||[]).map(file=>[file.id,file]));
 const restoring=[],recycling=[];
 let prepared={...next,shortcuts:(next.shortcuts||[]).map(file=>{
  const before=previous.get(file.id);
  if(!before||key(before.target)!==key(file.target))return file;
  if(active(next,file)&&!active(current,before)&&before.fileTarget?.status==='deleted'){
   restoring.push(file.id);return {...file,fileTarget:before.fileTarget};
  }
  if(active(current,before)&&!active(next,file)&&file.fileTarget?.status==='deleted')recycling.push(before);
  return file;
 })};
 if(recycling.length&&!await confirmDelete(recycling))return false;
 if(restoring.length)prepared=await prepareRestore(prepared,restoring);
 for(const file of recycling){
  const receipt=await deletePath(file.target);
  if(!receipt?.target?.targetId||receipt.target.status!=='deleted')throw Error('The file owner did not confirm recycling.');
  prepared=applyFileTargetResult(prepared,{kind:'shortcut',id:file.id,path:file.target,ref:file.fileTarget},receipt.target);
 }
 return prepared;
}

/** Native-pane recycling uses the same history owner as AYG; receipts remain owner-issued. */
export async function createFileRecycleEffect(host,paths) {
 const targets=[];
 for(const path of [...new Set(paths)]){
  const result=await host.fileCapability('file-target-track',{path});
  if(!result?.ok||result.target?.status!=='present')throw Error(result?.message||'The file identity could not be verified.');
  targets.push({path,id:result.target.targetId});
 }
 async function transition(restore){
  for(const target of targets){
   const check=await host.fileCapability('file-target-resolve',{path:target.path,targetId:target.id});
   if(!check?.ok)throw Error(check?.message||'The file owner is unavailable.');
   const status=check.target?.status;
   if(status===(restore?'present':'deleted'))continue;
   if(status!==(restore?'deleted':'present'))throw Error('The file identity changed; history was not applied.');
   const result=await host.fileCapability(restore?'file-target-restore':'file-target-delete',{path:target.path,targetId:target.id,expectedRevision:check.target.revision,commandId:globalThis.crypto.randomUUID()});
   if(!result?.ok||result.target?.status!==(restore?'present':'deleted'))throw Error(result?.message||'The file owner did not confirm this action.');
  }
 }
 return {undo:()=>transition(true),redo:()=>transition(false)};
}

/** Resolve immediately before effects too; polling alone leaves a race after an external move. */
export function createFileTargetHost(base,controller,record,{launchByRecord=false}={}){return new Proxy(base,{get(target,name){
 if(name==='fileCapability')return async(operation,params={})=>{if(operation.startsWith('file-target-'))return base.fileCapability(operation,params);const c=controller();if(!c)return base.fileCapability(operation,params);if(operation==='delete'&&params.paths?.length&&params.paths.every(p=>c.hasPath(p))){const targets=[];for(const p of params.paths)targets.push(await c.deletePath(p));return{ok:true,recycle:true,targets};}let next={...params};if(typeof next.path==='string')next.path=await c.resolvePath(next.path);if(typeof next.destination==='string')next.destination=await c.resolvePath(next.destination);if(Array.isArray(next.paths)){next.paths=[];for(const p of params.paths)next.paths.push(await c.resolvePath(p));}return base.fileCapability(operation,next);};
 if(name==='launchShortcut'&&launchByRecord)return id=>base.launchShortcut(id);
 if(name==='launchShortcut'||name==='revealShortcut')return async id=>{const chosen=record(id),c=controller();if(c&&isFileTarget(chosen?.target)){const p=await c.resolvePath(chosen.target);if(!record(id)?.fileTarget?.id&&p===chosen.target)return base[name](id);const result=await base.fileCapability(name==='launchShortcut'?'open':'reveal',{path:p});if(result?.ok===false)throw Error(result.message||'The file could not be opened.');return result;}return base[name](id);};
 return target[name];}});}

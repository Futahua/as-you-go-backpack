/** A folder cannot contain itself, including case/separator variants and descendants. */
export function navigatorFileMoveAllowed(paths,destination) {
 const key=path=>String(path||'').replace(/\//g,'\\').replace(/\\+$/,'').toLowerCase();
 const target=key(destination);
 return Boolean(target)&&paths.every(path=>{const source=key(path);return source && target!==source && !target.startsWith(source+'\\');});
}

/** File operations stay in the existing host; AYG links follow verified moves. */
export async function moveNavigatorFiles({host,paths,destination,retarget,onProgress,sleep=ms=>new Promise(r=>setTimeout(r,ms))}) {
 if(!navigatorFileMoveAllowed(paths,destination))return {ok:false,message:'A folder cannot be moved into itself or its contents.'};
 const result=await host.fileCapability('move',{paths,destination});
 if(!result?.ok)return result;
 const pending=new Map(paths.map(oldPath=>[oldPath,destination.replace(/[\\/]$/,'')+'\\'+oldPath.split(/[\\/]/).pop()]));
 const verified=[];
 for(let attempt=0;attempt<600&&pending.size;attempt++){
  for(const [oldPath,newPath] of pending){
   if(oldPath.toLowerCase()===newPath.toLowerCase()){pending.delete(oldPath);continue;}
   const [oldStat,newStat]=await Promise.all([host.fileCapability('stat',{path:oldPath}),host.fileCapability('stat',{path:newPath})]);
   if(oldStat?.ok===false&&oldStat.code==='ENOENT'&&newStat?.ok===true){verified.push({oldPath,newPath});pending.delete(oldPath);}
  }
  onProgress?.({completed:paths.length-pending.size,total:paths.length,pending:pending.size});
  if(pending.size)await sleep(500);
 }
 if(verified.length&&typeof retarget==='function'){
  let saved=false;
  try{saved=await retarget?.(verified)===true;}catch{}
  if(!saved)return {ok:false,unlinkedMoves:verified,message:'Files moved, but AYG links could not be saved. Refresh to retry the links without moving the files again.'};
 }
 return pending.size?{ok:false,pending:true,message:'Move is still pending in Directory Opus. Check its progress or confirmation dialog.'}:{ok:true};
}

/** A real rename is a move in place; links follow it only after the owner verifies the new path. */
export async function followNavigatorRename({host,path,newName,retarget,sleep=ms=>new Promise(r=>setTimeout(r,ms)),attempts=120}) {
 const parent=String(path||'').replace(/[\\/]+$/,'').replace(/[\\/][^\\/]*$/,'');
 const newPath=parent+'\\'+newName;
 if(!parent||!newName||newPath.toLowerCase()===String(path).toLowerCase()||typeof retarget!=='function')return {ok:true};
 for(let attempt=0;attempt<attempts;attempt++){
  const [oldStat,newStat]=await Promise.all([host.fileCapability('stat',{path}),host.fileCapability('stat',{path:newPath})]);
  if(oldStat?.ok===false&&oldStat.code==='ENOENT'&&newStat?.ok===true){
   let saved=false;try{saved=await retarget([{oldPath:path,newPath}])===true;}catch{}
   return saved?{ok:true}:{ok:false,unlinkedMoves:[{oldPath:path,newPath}],message:'Renamed, but AYG links could not be saved. Refresh to retry the links without renaming again.'};
  }
  await sleep(500);
 }
 return {ok:false,pending:true,message:'Rename is still pending in Directory Opus; AYG links were left unchanged.'};
}

/** Retry only a verified link update, never the completed filesystem move. */
export async function retryNavigatorFileLinks({host,moves,retarget}) {
 const verified=[];
 for(const move of moves){
  const [oldStat,newStat]=await Promise.all([host.fileCapability('stat',{path:move.oldPath}),host.fileCapability('stat',{path:move.newPath})]);
  if(oldStat?.ok!==false||oldStat.code!=='ENOENT'||newStat?.ok!==true)return false;
  verified.push(move);
 }
 return verified.length>0&&await retarget(verified)===true;
}

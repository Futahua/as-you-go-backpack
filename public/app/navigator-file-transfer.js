/** File operations stay in the existing host; AYG links follow verified moves. */
export async function moveNavigatorFiles({host,paths,destination,retarget,sleep=ms=>new Promise(r=>setTimeout(r,ms))}) {
 const result=await host.fileCapability('move',{paths,destination});
 if(!result?.ok)return result;
 const pending=new Map(paths.map(oldPath=>[oldPath,destination.replace(/[\\/]$/,'')+'\\'+oldPath.split(/[\\/]/).pop()]));
 const verified=[];
 for(let attempt=0;attempt<30&&pending.size;attempt++){
  for(const [oldPath,newPath] of pending){
   if(oldPath.toLowerCase()===newPath.toLowerCase()){pending.delete(oldPath);continue;}
   const [oldStat,newStat]=await Promise.all([host.fileCapability('stat',{path:oldPath}),host.fileCapability('stat',{path:newPath})]);
   if(oldStat?.ok===false&&oldStat.code==='ENOENT'&&newStat?.ok===true){verified.push({oldPath,newPath});pending.delete(oldPath);}
  }
  if(pending.size)await sleep(200);
 }
 if(verified.length){
  let saved=false;
  try{saved=await retarget?.(verified)===true;}catch{}
  if(!saved)return {ok:false,unlinkedMoves:verified,message:'Files moved, but AYG links could not be saved. Refresh to retry the links without moving the files again.'};
 }
 return pending.size?{ok:false,message:'Move is not confirmed yet. AYG links were preserved for unconfirmed files.'}:{ok:true};
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

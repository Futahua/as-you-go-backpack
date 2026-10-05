// Keep only the newest geometry while a frame or host request is outstanding.
export function createPreviewGeometryScheduler({ schedule, send }) {
  let latest=null, queued=false, busy=false, last=null, disposed=false;
  const flush=async()=>{
    queued=false;
    if(disposed||busy||!latest)return;
    const next=latest;latest=null;
    const key=JSON.stringify(next);
    if(key===last)return;
    busy=true;
    try{await send(next);last=key;}catch{}finally{busy=false;if(latest)queue();}
  };
  const queue=()=>{if(!queued&&!busy&&!disposed){queued=true;schedule(flush);}};
  return {update(value){if(disposed)return;latest=value;queue();},dispose(){disposed=true;latest=null;}};
}

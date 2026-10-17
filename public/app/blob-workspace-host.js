/** AYG remains the pane renderer and checked local writer. Proxima owns this
 * workspace's replicated records; ordinary AYG never enters this adapter. */
export function blobWorkspaceFromUrl(location) {
  const value=new URL(location.href).searchParams.get('papers-blob-workspace');
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value||'')?value:null;
}
export function createBlobWorkspaceHost(base,workspaceId,win=window){
  const pending=new Map();let sequence=0;
  const origin=()=>{try{const declared=new URL(win.location.href).searchParams.get('papers-blob-parent-origin'),url=new URL(declared||win.document.referrer);if(!['papers-backpack:','https:','http:'].includes(url.protocol))throw Error('Invalid parent origin');return url.origin==='null'?url.protocol+'//'+url.host:url.origin;}catch{return win.location.origin;}};
  function request(method,args=[]){return new Promise((resolve,reject)=>{
    const requestId='blob-'+(++sequence)+'-'+win.crypto.randomUUID(),timer=win.setTimeout(()=>{pending.delete(requestId);reject(Error('The workspace did not confirm this action; pending work is retained.'));},180000);
    pending.set(requestId,{resolve,reject,timer});win.parent.postMessage({type:'proxima:workspace:request',workspaceId,requestId,method,args},origin());
  });}
  win.addEventListener('message',event=>{
    if(event.source!==win.parent||event.origin!==origin()||event.data?.workspaceId!==workspaceId)return;
    const value=event.data;
    if(value.type==='proxima:workspace:flush'){
      Promise.resolve(win.__papersFlushBeforeClose?.()).then(()=>win.parent.postMessage({type:'proxima:workspace:flushed',workspaceId,requestId:value.requestId,ok:true},origin()),error=>win.parent.postMessage({type:'proxima:workspace:flushed',workspaceId,requestId:value.requestId,ok:false,error:error.message},origin()));return;
    }
    if(value.type==='proxima:workspace:result'){
      const task=pending.get(value.requestId);if(!task)return;pending.delete(value.requestId);win.clearTimeout(task.timer);value.ok?task.resolve(value.result):task.reject(Error(value.error||'The workspace refused this action.'));
    }
  });
  return {...base,
    blobWorkspaceId:workspaceId,
    loadWorkspace:()=>request('load').then(value=>value.state),
    loadWorkspaceVersioned:()=>request('load'),
    saveWorkspaceChecked:(state,revision,metadata)=>request('save',[state,revision,{automatic:metadata?.rebaseAutomaticSave===true}]),
    saveWorkspace:async()=>{throw Error('Workspace saves require a checked revision.');},
    launchShortcut:id=>request('launch',[id]),revealShortcut:id=>request('reveal',[id]),
    resolveDroppedTargets:files=>request('resolve-dropped',[files]),pickTarget:kind=>request('pick-target',[kind]),pickPhoneFiles:()=>request('pick-phone'),
    fileCapability:(operation,detail={})=>request('file',[operation,detail]),
    acquireWorkspaceWriterLease:async()=>null,releaseWorkspaceWriterLease:async()=>{},
    // A pasted or dropped link's title and icon come from Papers through the Proxima page.
    resolveWebIcon:url=>request('resolve-web-icon',[url]),
    // Native window layouts and widgets do not exist in a blob folder: answer at once with "none"
    // (never a thrown error, which would restart the pane's startup) instead of waiting out a timeout.
    windowLifecycleSnapshot:async()=>null,
    windowControlSync:async()=>({outcome:'unavailable',results:[]}),
    windowPreviewHide:async()=>({ok:true}),
    widgetOpen:async()=>({ok:false,code:'UNAVAILABLE',message:'Widgets are not available in a blob folder.'}),
    // The pane's close button (in the pill strip) closes the Proxima blob pane.
    closeBlobPane:()=>win.parent.postMessage({type:'proxima:workspace:close',workspaceId},origin()),
  };
}

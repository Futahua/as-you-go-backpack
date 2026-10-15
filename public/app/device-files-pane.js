/** Device tabs contain Files only. The containing page owns pane composition. */
export function isDeviceFilesPane(location) {
  const query=new URL(location.href).searchParams;
  return query.get('papers-inline-device')==='1' && !query.has('papers-phone');
}
export function deviceFilesUrl(location,deviceId) {
  const url=new URL(location.href);
  for(const key of ['papers-surface','as-you-go-folder'])url.searchParams.delete(key);
  url.searchParams.set('papers-device',deviceId);
  return url.toString();
}
export function installDeviceFilesPane({document,host}) {
  const win=document.defaultView,query=new URL(win.location.href).searchParams;
  const pageKey=query.get('papers-surface-key');
  const channel=typeof win.BroadcastChannel==='function'?new win.BroadcastChannel('papers-device-files'):null;
  const pending=new Map();
  if(channel)channel.onmessage=event=>{const reply=event.data,request=pending.get(reply?.requestId);if(!request)return;pending.delete(reply.requestId);clearTimeout(request.timer);reply.ok?request.resolve():request.reject(Error(reply.error||'Device view could not open.'));};
  const qualify=value=>{
    if(Array.isArray(value))return value.map(qualify);
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,
      key==='path'&&typeof item==='string'&&!item.startsWith('\\\\papers~')&&host.deviceId
        ?`\\\\papers~${host.deviceId}\\${item}`:qualify(item)]));
    return value;
  };
  const send=selection=>channel?.postMessage({pageKey,selection:qualify(selection)});
  return {
    openDevice:url=>new Promise((resolve,reject)=>{if(!channel||!pageKey){reject(Error('The containing Files group is unavailable.'));return;}const requestId=win.crypto.randomUUID(),timer=setTimeout(()=>{pending.delete(requestId);reject(Error('The containing Files group did not respond.'));},15000);pending.set(requestId,{resolve,reject,timer});channel.postMessage({pageKey,requestId,openDevice:url});}),
    syncSettings(){},selectNative(){},syncSelection:send,
    previewPath:(path,name)=>send({mode:'single',selectionCount:1,item:{path,name},items:[{path,name}]}),
    destroy(){for(const request of pending.values()){clearTimeout(request.timer);request.reject(Error('Files tab closed.'));}pending.clear();channel?.close();},
  };
}

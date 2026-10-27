// The address belongs to the pane's host: never resolve a remote address locally.
// Artwork is optional; reserve bridge capacity for navigation and checked actions.
export function createNavigatorArtworkQueue(limit=4) {
  let running=0;const waiting=[];
  const pump=()=>{while(running<limit&&waiting.length){const {task,resolve,reject}=waiting.shift();running++;Promise.resolve().then(task).then(resolve,reject).finally(()=>{running--;pump();});}};
  return task=>new Promise((resolve,reject)=>{if(waiting.length>=256){resolve(null);return;}waiting.push({task,resolve,reject});pump();});
}

export function sharedPathCrumbs(path, isDevicePath) {
  const normalized=String(path||'').replace(/\//g,'\\').replace(/\\+$/,'');
  if(!isDevicePath?.(normalized)||normalized.startsWith('\\\\')||/^[A-Za-z]:/.test(normalized))return null;
  let cursor='';
  return normalized.split('\\').filter(Boolean).map(name=>({name,path:cursor=cursor?cursor+'\\'+name:name}));
}

export function bindNavigatorAddress({document:d,location,track,currentPath,navigate,onError}) {
  const space=d.createElement('button');space.type='button';space.className='navigator-address-space';space.title='Enter a path';space.setAttribute('aria-label','Enter a path');
  const input=d.createElement('input');input.className='navigator-address-input';input.type='text';input.autocomplete='off';input.spellcheck=false;input.setAttribute('aria-label','File or folder path');input.hidden=true;
  location.append(space,input);
  const close=()=>{input.hidden=true;track.hidden=false;space.hidden=false;location.classList.remove('editing-address');};
  space.addEventListener('click',()=>{input.value=currentPath()||'';track.hidden=true;space.hidden=true;input.hidden=false;location.classList.add('editing-address');input.focus();input.select();});
  let submitting=false;
  input.addEventListener('keydown',async event=>{
    if(event.key==='Escape'){event.preventDefault();close();return;}
    if(event.key!=='Enter'||submitting)return;
    event.preventDefault();event.stopPropagation();
    const path=input.value.trim().replace(/^"(.*)"$/,'$1');if(!path)return;
    submitting=true;input.readOnly=true;
    try{await navigate(path);close();}catch(error){onError(error.message||'Path unavailable.');input.focus();input.select();}
    finally{submitting=false;input.readOnly=false;}
  });
  input.addEventListener('blur',()=>{if(!submitting)close();});
}

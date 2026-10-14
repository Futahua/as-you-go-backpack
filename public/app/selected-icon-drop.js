const internalTypes=['application/x-papers-ayg-navigator-items','application/x-papers-navigator-items','application/x-papers-machine-navigator-items','application/x-papers-items','application/x-papers-pill'];
export function bindSelectedIconDrop({element,getSelection,apply,setStatus}) {
  // Dropped onto a row: that row's item (or the selection it belongs to). Elsewhere: the selection.
  const targetId=event=>event.target?.closest?.('.workspace-navigator-row[data-id]')?.dataset.id||null;
  let busy=false;
  const internal=dt=>internalTypes.some(t=>Array.from(dt?.types||[]).includes(t));
  const image=file=>file&&(file.type?.startsWith('image/')||/\.(png|jpe?g|webp|gif|svg|ico|bmp|avif)$/i.test(file.name||''));
  element.addEventListener('dragover',event=>{
    if(internal(event.dataTransfer)||getSelection(targetId(event)).length===0)return;
    if([...event.dataTransfer?.items||[]].some(i=>i.kind==='file'&&(!i.type||i.type.startsWith('image/')))){
      event.preventDefault();event.stopImmediatePropagation();event.dataTransfer.dropEffect='copy';element.classList.add('icon-drop-ready');
    }
  },true);
  const clear=()=>element.classList.remove('icon-drop-ready');
  element.addEventListener('dragleave',event=>{if(!element.contains(event.relatedTarget))clear();});
  element.addEventListener('dragend',clear);
  element.addEventListener('drop',async event=>{
    clear();if(internal(event.dataTransfer))return;
    const files=[...event.dataTransfer?.files||[]],selection=getSelection(targetId(event));
    if(files.length!==1||!image(files[0])||selection.length===0)return;
    event.preventDefault();event.stopImmediatePropagation();
    if(busy){setStatus('The previous icon is still saving.');return;}
    busy=true;setStatus('Preparing icon…');
    try{const saved=await apply(selection,files[0]);if(saved)setStatus('Icon updated.');}
    catch(error){setStatus(error.message||'Icon could not be updated.');}
    finally{busy=false;}
  },true);
}

/** Pasted image data (a screenshot, an image copied from a page) becomes the selection's icon.
 * A real file copied in Explorer keeps its usual paste (a link): isRealFile decides, then fallback runs. */
export function bindSelectedIconPaste({window:win,getSelection,apply,setStatus,isRealFile,fallback}) {
  let busy=false;
  win.addEventListener('paste',event=>{
    const target=event.target,editable=target?.closest?.('input,textarea,select,[contenteditable="true"]')||win.document.activeElement?.closest?.('input,textarea,select,[contenteditable="true"]');
    if(editable)return;
    const files=[...event.clipboardData?.files||[]];
    if(files.length!==1||!files[0].type?.startsWith('image/'))return;
    const selection=getSelection();if(!selection.length)return;
    const text=event.clipboardData?.getData?.('text/plain')??'';
    event.preventDefault();event.stopImmediatePropagation();
    void (async()=>{
      if(await isRealFile(files[0]).catch(()=>false)){fallback(files,text);return;}
      if(busy){setStatus('The previous icon is still saving.');return;}
      busy=true;setStatus('Preparing icon…');
      try{const saved=await apply(selection,files[0]);if(saved)setStatus('Icon updated.');}
      catch(error){setStatus(error.message||'Icon could not be updated.');}
      finally{busy=false;}
    })();
  },true);
}

/** Icon-only batch edit: retains all other record fields and placements. */
export function replaceSelectedIcons(state,selection,icon) {
  const groups=new Set(selection.filter(x=>x.kind==='group').map(x=>x.item.id));
  const shortcuts=new Set(selection.filter(x=>x.kind==='shortcut'||x.kind==='web').map(x=>x.item.id));
  return {...state,
    groups:state.groups.map(x=>groups.has(x.id)?{...x,icon}:x),
    shortcuts:state.shortcuts.map(x=>shortcuts.has(x.id)?{...x,icon}:x),
  };
}

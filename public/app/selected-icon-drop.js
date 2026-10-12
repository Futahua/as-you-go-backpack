const internalTypes=['application/x-papers-ayg-navigator-items','application/x-papers-navigator-items','application/x-papers-machine-navigator-items','application/x-papers-items','application/x-papers-pill'];
export function bindSelectedIconDrop({element,getSelection,apply,setStatus}) {
  let busy=false;
  const internal=dt=>internalTypes.some(t=>Array.from(dt?.types||[]).includes(t));
  const image=file=>file&&(file.type?.startsWith('image/')||/\.(png|jpe?g|webp|gif|svg|ico|bmp|avif)$/i.test(file.name||''));
  element.addEventListener('dragover',event=>{
    if(internal(event.dataTransfer)||getSelection().length===0)return;
    if([...event.dataTransfer?.items||[]].some(i=>i.kind==='file'&&(!i.type||i.type.startsWith('image/')))){
      event.preventDefault();event.stopImmediatePropagation();event.dataTransfer.dropEffect='copy';element.classList.add('icon-drop-ready');
    }
  },true);
  const clear=()=>element.classList.remove('icon-drop-ready');
  element.addEventListener('dragleave',event=>{if(!element.contains(event.relatedTarget))clear();});
  element.addEventListener('dragend',clear);
  element.addEventListener('drop',async event=>{
    clear();if(internal(event.dataTransfer))return;
    const files=[...event.dataTransfer?.files||[]],selection=getSelection();
    if(files.length!==1||!image(files[0])||selection.length===0)return;
    event.preventDefault();event.stopImmediatePropagation();
    if(busy){setStatus('The previous icon is still saving.');return;}
    busy=true;setStatus('Preparing icon…');
    try{const saved=await apply(selection,files[0]);if(saved)setStatus('Icon updated.');}
    catch(error){setStatus(error.message||'Icon could not be updated.');}
    finally{busy=false;}
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

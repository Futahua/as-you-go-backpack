/** Saved navigation snapshots are local UI state, separate from workspace documents. */
export function createNavigatorSavedStates({document,container,snapshot,restore,art,fromDrop}) {
  const storage=document.defaultView?.localStorage, key='papers:ayg:navigator-saved-states';
  let states=[];
  const track=document.createElement('div');track.className='navigator-saved-track';
  const grip=document.createElement('div');grip.className='navigator-pills-height-grip';
  grip.setAttribute('role','separator');grip.setAttribute('aria-orientation','horizontal');grip.title='Resize saved items height';
  container.after(grip);
  const applyHeight=value=>{
    const height=Math.max(28,Math.min(Math.max(28,document.defaultView.innerHeight*.45),value));
    container.style.height=height+'px';track.style.setProperty('--pill-rows',String(Math.max(1,Math.floor((height-4)/26))));
    return height;
  };
  try{applyHeight(Number(storage?.getItem(key+'-height'))||80);}catch{applyHeight(80);}
  let resizing=false;
  grip.addEventListener('pointerdown',event=>{if(event.button!==0)return;resizing=true;grip.setPointerCapture?.(event.pointerId);event.preventDefault();event.stopPropagation();});
  grip.addEventListener('pointermove',event=>{if(!resizing)return;const height=applyHeight(event.clientY-container.getBoundingClientRect().top);try{storage?.setItem(key+'-height',String(height));}catch{}event.preventDefault();});
  const finish=()=>{resizing=false;};grip.addEventListener('pointerup',finish);grip.addEventListener('pointercancel',finish);
  container.addEventListener('wheel',event=>{if(event.ctrlKey||container.scrollWidth<=container.clientWidth)return;const delta=Math.abs(event.deltaX)>Math.abs(event.deltaY)?event.deltaX:event.deltaY;if(!delta)return;event.preventDefault();container.scrollLeft+=delta*(event.deltaMode===1?20:event.deltaMode===2?container.clientWidth:1);},{passive:false});
  try{const parsed=JSON.parse(storage?.getItem(key)||'[]');if(Array.isArray(parsed))states=parsed.filter(s=>s&&typeof s.name==='string'&&['ayg','machine','action'].includes(s.mode));}catch{}
  container.addEventListener('dragover',event=>{event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect='copy';container.classList.add('drop-target');});
  container.addEventListener('dragleave',()=>container.classList.remove('drop-target'));
  container.addEventListener('drop',async event=>{
    event.preventDefault();event.stopPropagation();container.classList.remove('drop-target');
    const state=await fromDrop?.(event.dataTransfer);if(!state)return;
    states.push(state);try{storage?.setItem(key,JSON.stringify(states));}catch{}render();
  });
  function render(){
    track.replaceChildren();container.replaceChildren(track);
    for(const state of states){
      const pill=document.createElement('button');pill.type='button';pill.tabIndex=-1;pill.className='navigator-saved-pill';pill.title='Restore '+state.name;
      const image=document.createElement('span');image.className='workspace-navigator-crumb-art';art(image,state);
      const label=document.createElement('span');label.textContent=state.name;pill.append(image,label);
      pill.addEventListener('click',()=>restore(state));
      pill.addEventListener('mousedown',event=>{if(event.button===1)event.preventDefault();});
      pill.addEventListener('auxclick',event=>{
        if(event.button!==1)return;
        event.preventDefault();event.stopPropagation();
        states=states.filter(saved=>saved!==state);
        try{storage?.setItem(key,JSON.stringify(states));}catch{}
        render();
      });
      track.append(pill);
    }
  }
  render();
  return {add(state){if(!state)return;states.push(state);try{storage?.setItem(key,JSON.stringify(states));}catch{}render();},save(){const state=snapshot();if(!state)return;states.push(state);try{storage?.setItem(key,JSON.stringify(states));}catch{}render();}};
}

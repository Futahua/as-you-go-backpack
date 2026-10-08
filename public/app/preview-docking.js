/** Preview docking uses the same half-pane destinations and translucent split cue as Papers. */
export function previewDropSurface(x, y, {left, right, top, bottom, width, windows}) {
  if (x < left || x > width - 8 || y < top || y > bottom) return null;
  if (Math.abs(x - right) <= 42) return 'middle';
  const side = windows && x > right ? 'right' : 'left';
  return side + (y < (top + bottom) / 2 ? '-top' : '-bottom');
}

export function installPreviewDocking({document,header,getGeometry,getRegion,onStart,onFinish,onDrop}) {
  const win=document.defaultView;
  const handle=document.createElement('button');handle.type='button';handle.className='preview-dock-handle';
  handle.innerHTML='<svg viewBox="0 0 20 20" width="16" height="16" fill="currentColor" aria-hidden="true"><circle cx="7" cy="5" r="1.3"/><circle cx="13" cy="5" r="1.3"/><circle cx="7" cy="10" r="1.3"/><circle cx="13" cy="10" r="1.3"/><circle cx="7" cy="15" r="1.3"/><circle cx="13" cy="15" r="1.3"/></svg>';handle.title='Drag grip to place preview';handle.setAttribute('aria-label','Drag preview to split a pane');
  const title=document.createElement('span');title.className='preview-pane-label';title.textContent='Preview';header.prepend(title);header.prepend(handle);
  const shield=document.createElement('div');shield.className='preview-dock-shield';shield.hidden=true;
  const cue=document.createElement('div');cue.className='preview-split-cue';cue.hidden=true;shield.append(cue);document.body.append(shield);
  let drag=null,disposed=false;
  function paint(x,y){
    if(!drag?.moving)return;
    drag.target=previewDropSurface(x,y,getGeometry());
    const region=drag.target&&getRegion(drag.target);cue.hidden=!region;
    if(region)Object.assign(cue.style,{left:region.x+'px',top:region.y+'px',width:region.width+'px',height:region.height+'px'});
    cue.classList.toggle('is-armed',Boolean(drag.ready));
  }
  function finish(commit){
    const active=drag;if(!active)return;drag=null;
    shield.hidden=true;cue.hidden=true;handle.classList.remove('dragging');
    if(handle.hasPointerCapture?.(active.id))handle.releasePointerCapture(active.id);
    if(active.moving){if(commit&&active.ready&&active.target)onDrop(active.target);onFinish();}
  }
  handle.addEventListener('pointerdown',event=>{
    if(event.button!==0||disposed||drag)return;
    drag={id:event.pointerId,x:event.clientX,y:event.clientY,moving:false,ready:false,target:null};
    handle.setPointerCapture(event.pointerId);event.preventDefault();
  });
  handle.addEventListener('pointermove',event=>{
    if(!drag||event.pointerId!==drag.id)return;
    if(!drag.moving&&Math.hypot(event.clientX-drag.x,event.clientY-drag.y)<5)return;
    if(!drag.moving){
      drag.moving=true;shield.hidden=false;handle.classList.add('dragging');const active=drag;
      Promise.resolve(onStart()).then(()=>{if(disposed||drag!==active)return;active.ready=true;cue.classList.add('is-armed');}).catch(()=>{if(drag===active)finish(false);});
    }
    paint(event.clientX,event.clientY);event.preventDefault();
  });
  handle.addEventListener('pointerup',event=>{if(drag?.id!==event.pointerId)return;paint(event.clientX,event.clientY);finish(true);});
  handle.addEventListener('pointercancel',()=>finish(false));
  handle.addEventListener('lostpointercapture',()=>finish(false));
  const escape=event=>{if(event.key==='Escape'&&drag){event.preventDefault();finish(false);}};
  const blur=()=>finish(false);win.addEventListener('keydown',escape,true);win.addEventListener('blur',blur);
  return {destroy(){disposed=true;finish(false);win.removeEventListener('keydown',escape,true);win.removeEventListener('blur',blur);shield.remove();handle.remove();title.remove();}};
}

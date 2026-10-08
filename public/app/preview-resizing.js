export function resizedPreviewShare(placement, edge, delta, span, initial) {
  const sign=placement==='middle'||placement.endsWith('bottom') ? -1 : 1;
  const minimum=Math.min(.4,120/Math.max(1,span));
  return Math.max(minimum,Math.min(1-minimum,initial+sign*delta/Math.max(1,span)));
}

/** Resize only shared boundaries: the native window column never moves with Preview. */
export function installPreviewResizing({document,panel,getState,onStart,onChange,onFinish}) {
  const win=document.defaultView,edges=[];let drag=null;
  const shield=document.createElement('div');shield.className='preview-resize-shield';shield.hidden=true;document.body.append(shield);
  function finish(commit){const active=drag;if(!active)return;drag=null;shield.hidden=true;if(active.edge.hasPointerCapture?.(active.id))active.edge.releasePointerCapture(active.id);if(!commit)onChange(active.initial);onFinish(commit);}
  for(const side of ['top','bottom','left']){
    const edge=document.createElement('div');edge.className='preview-resize-edge preview-resize-'+side;edge.setAttribute('role','separator');edge.setAttribute('aria-label','Resize preview');edge.setAttribute('aria-orientation',side==='left'?'vertical':'horizontal');panel.append(edge);edges.push(edge);
    edge.addEventListener('pointerdown',event=>{if(event.button!==0||drag)return;const state=getState();drag={...state,initial:state.share,edge,id:event.pointerId,x:event.clientX,y:event.clientY};edge.setPointerCapture(event.pointerId);shield.style.cursor=side==='left'?'ew-resize':'ns-resize';shield.hidden=false;onStart();event.preventDefault();event.stopPropagation();});
    edge.addEventListener('pointermove',event=>{if(drag?.id!==event.pointerId)return;const delta=side==='left'?event.clientX-drag.x:event.clientY-drag.y;onChange(resizedPreviewShare(drag.placement,side,delta,drag.span,drag.initial));event.preventDefault();event.stopPropagation();});
    edge.addEventListener('pointerup',event=>{if(drag?.id===event.pointerId)finish(true);});edge.addEventListener('pointercancel',()=>finish(false));edge.addEventListener('lostpointercapture',()=>finish(false));
  }
  const escape=event=>{if(event.key==='Escape'&&drag){event.preventDefault();finish(false);}};const blur=()=>finish(false);win.addEventListener('keydown',escape,true);win.addEventListener('blur',blur);
  return {sync(placement){for(const edge of edges)edge.hidden=!edge.classList.contains('preview-resize-'+(placement==='middle'?'left':placement.endsWith('top')?'bottom':'top'));},destroy(){finish(false);win.removeEventListener('keydown',escape,true);win.removeEventListener('blur',blur);shield.remove();edges.forEach(edge=>edge.remove());}};
}

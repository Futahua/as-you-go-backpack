/** Couples only the touching pane edges; pane owners retain their own widths. */
export function installPairedPaneResizer({document, navigator, preview}) {
  const left=document.querySelector('#workspace-navigator'), right=document.querySelector('.file-capability-panel');
  if(!left||!right)return;
  const strip=document.createElement('div');strip.className='paired-pane-resizer';
  strip.setAttribute('role','separator');strip.setAttribute('aria-orientation','vertical');strip.setAttribute('aria-label','Resize both panes');
  document.body.append(strip);
  let dragging=false;
  function refresh(){
    const a=left.getBoundingClientRect(),b=right.getBoundingClientRect();
    const visible=!left.hidden&&!navigator.isCollapsed()&&right.classList.contains('expanded')&&!right.classList.contains('fills-tab')&&!right.classList.contains('full-page')&&a.right>=b.left-7&&a.bottom>b.top&&b.bottom>a.top;
    strip.hidden=!visible;
    if(visible){strip.style.left=(b.left-6)+'px';strip.style.top=Math.max(a.top,b.top)+'px';strip.style.height=(Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top))+'px';}
  }
  strip.addEventListener('pointerdown',event=>{if(event.button!==0)return;dragging=true;strip.setPointerCapture(event.pointerId);left.classList.add('resizing');right.classList.add('resizing');event.preventDefault();event.stopPropagation();});
  strip.addEventListener('pointermove',event=>{
    if(!dragging)return;
    const a=left.getBoundingClientRect(),b=right.getBoundingClientRect();
    const viewport=document.defaultView.innerWidth;
    const previewMax=Math.max(300,Math.min(900,Math.floor(viewport*.75)));
    const minX=Math.max(a.left+179,b.right-previewMax-3);
    const maxX=Math.min(b.right-303,viewport*.55+a.left+3);
    if(minX>maxX)return;
    const x=Math.max(minX,Math.min(maxX,event.clientX));
    navigator.setWidth(x-a.left-3);
    preview.setWidth(b.right-x-3);
    preview.refreshPreviewGeometry();refresh();event.preventDefault();
  });
  const finish=()=>{dragging=false;left.classList.remove('resizing');right.classList.remove('resizing');refresh();};
  strip.addEventListener('pointerup',finish);strip.addEventListener('pointercancel',finish);
  const observer=new document.defaultView.ResizeObserver(refresh);observer.observe(left);observer.observe(right);
  const mutations=new document.defaultView.MutationObserver(refresh);mutations.observe(left,{attributes:true,attributeFilter:['class','hidden']});mutations.observe(right,{attributes:true,attributeFilter:['class']});
  document.defaultView.addEventListener('resize',refresh);refresh();
}

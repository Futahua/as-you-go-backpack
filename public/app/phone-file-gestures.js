/** Phone-only row gestures. Selection stays with the existing navigator owner.
 * The same gestures apply to graph tiles (`extra` roots, e.g. the navigator's graph slot): hold
 * selects and enters selection mode, taps then toggle, a tap on blank space leaves it, and a double
 * tap opens. Tiles are toggled with the same Ctrl-click their own owner already handles.
 * A double tap that opens something swallows the browser's own follow-up click and dblclick for
 * 700 ms wherever they land: opening a folder redraws the view, and they must not open what is now
 * under the finger. */
const ITEM='.workspace-navigator-row[data-id],.icon-item[data-id]';
export function bindPhoneFileGestures({body,extra=[],window:w}) {
 let mode=false,press=null,timer=null,last=null,suppressed=null;
 const roots=[body,...extra.filter(Boolean)];
 const rowAt=e=>e.target.closest(ITEM);
 const items=()=>roots.flatMap(root=>[...root.querySelectorAll(ITEM)]);
 const clear=()=>{if(timer)w.clearTimeout(timer);timer=null;press=null;};
 const emit=(row,type,toggle=false)=>{const e=new w.MouseEvent(type,{bubbles:true,cancelable:true,button:0,ctrlKey:toggle});e.papersTouchGenerated=true;e.papersTouchSelection=toggle;row.dispatchEvent(e);};
 const boxes=()=>{for(const root of roots)if(root.classList.contains('phone-selection-mode')!==mode)root.classList.toggle('phone-selection-mode',mode);for(const row of items()){let box=row.querySelector(':scope>.phone-selection-checkbox');if(!mode){box?.remove();continue;}if(!box){box=body.ownerDocument.createElement('span');box.className='phone-selection-checkbox';box.setAttribute('role','checkbox');row.prepend(box);}const selected=row.classList.contains('selected');if(box.getAttribute('aria-checked')!==String(selected))box.setAttribute('aria-checked',String(selected));const text=selected?'✓':'';if(box.textContent!==text)box.textContent=text;}};
 for(const root of roots){
  root.addEventListener('pointerdown',e=>{if(e.pointerType!=='touch')return;clear();const row=rowAt(e);if(!row||e.target.closest('input,textarea,button'))return;press={row,id:e.pointerId,x:e.clientX,y:e.clientY,held:false};timer=w.setTimeout(()=>{if(!press)return;press.held=true;last=null;mode=true;if(!row.classList.contains('selected'))emit(row,'click',true);suppressed={id:row.dataset.id,until:Date.now()+700};boxes();},450);},true);
  root.addEventListener('pointermove',e=>{if(press&&e.pointerId===press.id&&Math.hypot(e.clientX-press.x,e.clientY-press.y)>10)clear();},true);
  root.addEventListener('pointercancel',clear,true);
  root.addEventListener('pointerup',e=>{if(!press||e.pointerId!==press.id)return;const p=press;clear();if(p.held)return;if(mode)return;const now=Date.now();if(last?.id===p.row.dataset.id&&now-last.at<320){suppressed={id:p.row.dataset.id,any:true,until:now+700};last=null;emit(p.row,'dblclick');}else last={id:p.row.dataset.id,at:now};},true);
  root.addEventListener('click',e=>{if(e.papersTouchGenerated)return;const row=rowAt(e);if((suppressed?.any||suppressed?.id===row?.dataset.id)&&!suppressed.clicked&&Date.now()<suppressed.until){e.preventDefault();e.stopImmediatePropagation();suppressed.clicked=true;return;}if(!mode)return;if(!row){mode=false;last=null;for(const selected of items())if(selected.classList.contains('selected'))emit(selected,'click',true);boxes();return;}if(e.target.closest('button')&&!e.target.closest('.phone-selection-checkbox'))return;e.preventDefault();e.stopImmediatePropagation();emit(row,'click',true);boxes();},true);
  root.addEventListener('dblclick',e=>{if(e.papersTouchGenerated)return;if(mode||((suppressed?.any||suppressed?.id===rowAt(e)?.dataset.id)&&Date.now()<suppressed.until)){e.preventDefault();e.stopImmediatePropagation();}},true);
  root.addEventListener('contextmenu',e=>{if(mode&&rowAt(e)){e.preventDefault();e.stopImmediatePropagation();}},true);
  root.addEventListener('dragstart',e=>{if(mode){e.preventDefault();e.stopImmediatePropagation();}},true);
 }
 const observers=roots.map(root=>{const observer=new w.MutationObserver(boxes);observer.observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});return observer;});
 w.addEventListener('pagehide',()=>{clear();for(const observer of observers)observer.disconnect();},{once:true});
 return {isSelecting:()=>mode,finish(){mode=false;last=null;boxes();}};
}

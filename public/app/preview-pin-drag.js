import { PREVIEW_TAB_MIME } from './native-window-tabs.js';

/** A cancelled drag never adds a saved tab. Resolve only on an accepted drop. */
export function installPreviewPinDrag({pin,getItem,createId}) {
  let pending=null;
  pin.draggable=true;
  pin.title='Pin preview · drag to a group or split';
  pin.addEventListener('dragstart',event=>{
    const item=getItem();
    if(!item?.path){event.preventDefault();return;}
    pending={id:createId(),path:item.path,name:item.name||item.path.split(/[\\\\/]/).pop()};
    event.dataTransfer.effectAllowed='copyMove';
    event.dataTransfer.setData(PREVIEW_TAB_MIME,pending.id);
    event.stopPropagation();
  });
  pin.addEventListener('dragend',()=>{pending=null;});
  return id=>pending?.id===id?{...pending}:null;
}

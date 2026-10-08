import { createMarqueeController } from './interactions/marquee-controller.js';
import { itemsIntersectingMarquee } from '../workspace-model-20260730b.js';

export function navigatorReorderPlan({ rows, selected, target, after, sourceRows = rows }) {
  const moving = sourceRows.filter(id => selected.includes(id));
  if (!moving.length || moving.includes(target)) return null;
  const remaining = rows.filter(id => !moving.includes(id));
  const index = target == null ? remaining.length : remaining.indexOf(target) + (after ? 1 : 0);
  if (target != null && remaining.indexOf(target) < 0) return null;
  return { moving, beforeId: remaining[index] ?? null,
    order: [...remaining.slice(0,index), ...moving, ...remaining.slice(index)] };
}

/** Shares canvas marquee geometry/capture and the navigator's existing selection and drop owners. */
export function bindNavigatorRowInteractions({ document, body, getSelection, setSelection, finishSelection = () => {}, reorder, restore, isNativeDrag = () => false, resolveDestination = null, canMove = () => true, dropEffect = () => 'move' }) {
  const marquee = document.createElement('div');
  marquee.className = 'navigator-marquee'; marquee.hidden = true; document.body.append(marquee);
  let subtract = false, base = [], suppressContext = false, source = null, pending = null;
  let startX = 0;
  const controller = createMarqueeController({
    elements: { grid: body, marquee, explorer: {getBoundingClientRect: () => ({left:0,top:0})} },
    itemSelector: '.workspace-navigator-row[data-id]', itemsIntersectingMarquee,
    commands: {
      beginMarqueeSelection: () => {base = [...getSelection()]; return [];},
      updateMarqueeSelection: ids => setSelection(subtract ? base.filter(id => !ids.includes(id)) : [...new Set([...base, ...ids])]),
      finishMarqueeSelection: ({moved}) => {if(moved)finishSelection();},
    },
  });
  body.addEventListener('pointerdown', event => {
    if (event.button !== 2 || event.target.closest('input, button, textarea')) return;
    startX = event.clientX; subtract = false; suppressContext = true;
    marquee.classList.toggle('deselecting', false);
    controller.start(event); event.stopPropagation();
  });
  body.addEventListener('pointermove', event => {
    if (!controller.isActive(event.pointerId)) return;
    subtract = event.clientX > startX;
    marquee.classList.toggle('deselecting', subtract);
    controller.move(event);
    if (!marquee.hidden) {suppressContext = true;event.preventDefault();event.stopPropagation();}
  });
  body.addEventListener('pointerup', event => {
    if (!controller.isActive(event.pointerId)) return;
    suppressContext = controller.finish(event.pointerId) === true;
    if(suppressContext){event.preventDefault();event.stopPropagation();}
  });
  body.addEventListener('pointercancel', () => controller.cancel());
  body.addEventListener('contextmenu', event => {
    if(suppressContext || !marquee.hidden){event.preventDefault();event.stopImmediatePropagation();}
  }, true);
  body.addEventListener('dragstart', event => {
    const row = event.target.closest('.workspace-navigator-row[data-id]');
    if(!row)return;
    const selected = [...getSelection()];
    const siblings=[...body.querySelectorAll('.workspace-navigator-row[data-id]')];
    const dragged=selected.includes(row.dataset.id)?selected:[row.dataset.id];
    const parents=new Map(siblings.map(candidate=>[candidate.dataset.id,candidate.dataset.reorderParent]));
    const roots=dragged.filter(id=>{let parent=parents.get(id);const seen=new Set();while(parent&&!seen.has(parent)){if(dragged.includes(parent))return false;seen.add(parent);parent=parents.get(parent);}return true;});
    source = {parent:row.dataset.reorderParent, ids:roots, rows:siblings, previewed:false};
    pending = null;
  }, true);
  const clear = () => {body.querySelectorAll('.reorder-before, .reorder-after, .drop-target').forEach(row=>row.classList.remove('reorder-before','reorder-after','drop-target'));};
  document.addEventListener('drop', event => {
    if (body.contains(event.target)) return;
    const previewed = source?.previewed;
    source = null; pending = null; clear();
    // Let the destination consume its payload before restoring the row preview.
    if (previewed) queueMicrotask(() => restore());
  }, true);
  body.addEventListener('dragover', event => {
    const row = event.target.closest('.workspace-navigator-row[data-id]');
    if(source && pending && row && source.ids.includes(row.dataset.id)) {
      // The preview itself can move the selected rows underneath the cursor.
      // Keep its destination instead of falling through to append-to-folder.
      event.preventDefault();event.stopImmediatePropagation();
      if(event.dataTransfer)event.dataTransfer.dropEffect=dropEffect(event.dataTransfer.effectAllowed);
      return;
    }
    clear();pending=null;
    if(!source || !row)return;
    const rect=row.getBoundingClientRect(), fraction=(event.clientY-rect.top)/Math.max(1,rect.height);
    const folderCenter=row.dataset.reorderFolder==='true' && fraction > .25 && fraction < .75;
    const destination=resolveDestination?.(row,folderCenter,source) ?? (!resolveDestination && row.dataset.reorderParent===source.parent && !folderCenter
      ? {parent:source.parent,container:row.parentNode,rows:source.rows.filter(r=>r.dataset.reorderParent===source.parent)} : null);
    if(!destination || !canMove(source.ids,destination.parent))return;
    const siblings=destination.rows;
    const plan=navigatorReorderPlan({rows:siblings.map(r=>r.dataset.id),selected:source.ids,
      sourceRows:source.rows.map(r=>r.dataset.id),target:folderCenter?null:row.dataset.id,after:fraction>=.5});
    if(!plan)return;
    pending={...plan,parent:destination.parent,sourceParent:source.parent};
    row.classList.add(folderCenter?'drop-target':fraction>=.5?'reorder-after':'reorder-before');
    const anchor=siblings.find(candidate=>candidate.dataset.id===plan.beforeId);
    for(const id of plan.moving){
      const moving=source.rows.find(candidate=>candidate.dataset.id===id);
      if(!moving)continue;
      const branch=moving.nextElementSibling?.classList.contains('navigator-tree-branch')?moving.nextElementSibling:null;
      destination.container.insertBefore(moving,anchor??null);
      if(branch)destination.container.insertBefore(branch,anchor??null);
    }
    source.previewed=true;
    event.preventDefault();event.stopImmediatePropagation();
    if(event.dataTransfer)event.dataTransfer.dropEffect=dropEffect(event.dataTransfer.effectAllowed);
  }, true);
  body.addEventListener('drop', event => {
    if(!pending)return;
    event.preventDefault();event.stopImmediatePropagation();
    const plan=pending;pending=null;source=null;clear();
    Promise.resolve(reorder(plan)).catch(()=>restore());
  }, true);
  document.addEventListener('dragend',()=>{if(isNativeDrag())return;const previewed=source?.previewed;source=null;pending=null;clear();if(previewed)restore();});
  body.addEventListener('dragleave',event=>{
    const rect=body.getBoundingClientRect?.();
    const inside=rect && event.clientX>=rect.left && event.clientX<=rect.right && event.clientY>=rect.top && event.clientY<=rect.bottom;
    if(!inside && !body.contains(event.relatedTarget)){pending=null;clear();}
  });
  return { cancel: () => {controller.cancel();source=null;pending=null;clear();marquee.remove();} };
}

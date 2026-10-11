/** Offset handles describe every contiguous run of adjoining, facing edges.
 * Slots supply hit testing only; native preflight supplies the committed rectangle. */
export function paneSpanTargets(groups,excluded=null){
  const visible=groups.filter(g=>g.id!==excluded&&g.presentation==='normal'),targets=[];
  for(const edge of ['left','right','top','bottom']){
    const vertical=edge==='left'||edge==='right',before=edge==='left'||edge==='top',lines=new Map();
    for(const group of visible){const r=group.slot,at=vertical?r.x+(before?0:r.width):r.y+(before?0:r.height);const key=Math.round(at);if(!lines.has(key))lines.set(key,[]);lines.get(key).push(group);}
    for(const [at,line] of lines){
      line.sort((a,b)=>vertical?a.slot.y-b.slot.y:a.slot.x-b.slot.x);
      const candidates=[];
      for(let start=0;start<line.length;start++)for(let end=start;end<line.length;end++){
        const first=line[start].slot,last=line[end].slot;
        if(end>start){const prev=line[end-1].slot;if(Math.abs((vertical?prev.y+prev.height:prev.x+prev.width)-(vertical?last.y:last.x))>1)break;}
        const low=vertical?first.y:first.x,high=vertical?last.y+last.height:last.x+last.width,ids=line.slice(start,end+1).map(g=>g.id);
        candidates.push({group:line[start],edge,side:'span-'+edge+':'+ids.map(encodeURIComponent).join(','),ids,length:high-low,middle:(low+high)/2,at,vertical,before});
      }
      candidates.sort((a,b)=>a.length-b.length||a.middle-b.middle);
      const placed=[];
      for(const target of candidates){
        let lane=0;while(placed.some(p=>p.lane===lane&&Math.abs(p.middle-target.middle)<38))lane++;
        const depth=14+lane*24;target.lane=lane;
        target.x=vertical?at+(before?depth:-depth):target.middle;
        target.y=vertical?target.middle:at+(before?depth:-depth);
        placed.push(target);targets.push(target);
      }
    }
  }
  return targets;
}
export function paneSpanDrop(x,y,targets){
  let closest=null,distance=23;
  for(const target of targets){const d=Math.hypot(x-target.x,y-target.y);if(d<distance){closest=target;distance=d;}}
  return closest;
}

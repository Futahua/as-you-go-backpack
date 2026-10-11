/** A shared horizontal seam's outer endpoint targets the stacked column. */
export function paneColumnDrop(x,y,groups,excluded=null){
  const visible=groups.filter(g=>g.id!==excluded&&g.presentation==='normal');
  for(const top of visible)for(const bottom of visible){
    const a=top.slot,b=bottom.slot;
    if(top===bottom||Math.abs(a.y+a.height-b.y)>3||Math.abs(a.x-b.x)>3||Math.abs(a.width-b.width)>3)continue;
    if(Math.abs(y-b.y)>28)continue;
    const edge=Math.abs(x-a.x)<=28?'column-l':Math.abs(x-a.x-a.width)<=28?'column-r':null;
    if(edge)return {group:top,side:edge,box:{x:a.x,y:a.y,width:a.width,height:b.y+b.height-a.y}};
  }
  return null;
}

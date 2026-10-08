/** Pure presentation layout. Native constraints never mutate authored topology. */
export const leaves=t=>t.id?[t.id]:[...leaves(t.first),...leaves(t.second)];
export function resolvePaneLayout(tree,box,{constraints={},minimized=[],maximized=null,focused=null}={}){
 const ids=leaves(tree),hidden=new Set(minimized),auto=[];
 const size=id=>({width:Math.max(128,constraints[id]?.width||128),height:Math.max(160,constraints[id]?.height||160)});
 const prune=t=>t.id?(hidden.has(t.id)?null:t):(()=>{const a=prune(t.first),b=prune(t.second);return a&&b?{...t,first:a,second:b}:a||b;})();
 const minimum=t=>!t?{width:0,height:0}:t.id?size(t.id):(()=>{const a=minimum(t.first),b=minimum(t.second);return {width:Math.max(a.width,b.width),height:Math.max(a.height,b.height)};})();
 function draw(t,r,out){if(!t)return true;if(t.id){const min=size(t.id);if(r.width+2<min.width||r.height+2<min.height)return false;out[t.id]=r;return true;}
 const a=minimum(t.first),b=minimum(t.second);let axis=t.axis;
 const fitsX=a.width+b.width<=r.width+2&&Math.max(a.height,b.height)<=r.height+2;
 const fitsY=a.height+b.height<=r.height+2&&Math.max(a.width,b.width)<=r.width+2;
 if(axis==='x'&&!fitsX&&fitsY)axis='y';else if(axis==='y'&&!fitsY&&fitsX)axis='x';
 if(axis==='x'&&!fitsX||axis==='y'&&!fitsY)return false;
 const span=axis==='x'?r.width:r.height,low=axis==='x'?a.width:a.height,high=axis==='x'?b.width:b.height;
 const cut=Math.max(low,Math.min(span-high,span*(Number.isFinite(t.ratio)?t.ratio:.5)));
 const first=axis==='x'?{...r,width:cut}:{...r,height:cut};
 const second=axis==='x'?{...r,x:r.x+cut,width:r.width-cut}:{...r,y:r.y+cut,height:r.height-cut};
 return draw(t.first,first,out)&&draw(t.second,second,out);
 }
 if(maximized&&ids.includes(maximized))return {boxes:{[maximized]:{...box}},autoMinimized:[],minimumWidth:size(maximized).width};
 let visible=prune(tree),boxes={},minimumWidth=minimum(visible).width;
 const candidates=ids.filter(id=>!hidden.has(id)&&id!==focused).reverse();
 while(!draw(visible,{...box,height:Math.max(1,box.height-(hidden.size?32:0))},boxes)){
  const id=candidates.shift();if(!id)break;hidden.add(id);auto.push(id);visible=prune(tree);boxes={};
 }
 // If the viewport itself is too small, retain the focused slice and report its requirement.
 if(!Object.keys(boxes).length&&visible?.id)boxes[visible.id]={...box,height:Math.max(1,box.height-(hidden.size?32:0))};
 const mini=ids.filter(id=>hidden.has(id));mini.forEach((id,index)=>boxes[id]={x:box.x+index*box.width/mini.length,y:box.y+box.height-32,width:box.width/mini.length,height:32});
 return {boxes,autoMinimized:auto,minimumWidth};
}

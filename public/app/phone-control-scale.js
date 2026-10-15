export function isPhoneResizeLocked(w){try{return w.localStorage.getItem('papers:phone:resize-locked')==='1';}catch{return false;}}
export const clampControlScale=value=>Math.max(.65,Math.min(1.7,value));
export function bindPhoneControlScale({document:d,window:w}){
 const root=d.documentElement,keys={floating:'papers:phone:floating-scale',toolbar:'papers:phone:toolbar-scale'};const values={floating:1,toolbar:1};let pinch=null,suppressUntil=0;
 for(const key of Object.keys(keys)){try{values[key]=clampControlScale(Number(w.localStorage.getItem(keys[key]))||1);}catch{}root.style.setProperty('--phone-'+key+'-scale',String(values[key]));}
 const inside=(r,p)=>p.clientX>=r.left-16&&p.clientX<=r.right+16&&p.clientY>=r.top-16&&p.clientY<=r.bottom+16;
 const area=points=>{const header=d.querySelector('.workspace-navigator-header');if(header&&points.every(p=>inside(header.getBoundingClientRect(),p)))return 'toolbar';const nodes=[...d.querySelectorAll('.phone-pill-transfer,.phone-attach,.phone-mouse-button')].filter(e=>!e.hidden&&e.getBoundingClientRect().width>0);for(const side of ['left','right']){const boxes=nodes.map(e=>e.getBoundingClientRect()).filter(r=>side==='left'?r.left<w.innerWidth/2:r.left>=w.innerWidth/2);if(!boxes.length)continue;const box={left:Math.min(...boxes.map(r=>r.left)),right:Math.max(...boxes.map(r=>r.right)),top:Math.min(...boxes.map(r=>r.top)),bottom:Math.max(...boxes.map(r=>r.bottom))};if(points.every(p=>inside(box,p)))return 'floating';}return null;};
 const gap=points=>Math.hypot(points[0].clientX-points[1].clientX,points[0].clientY-points[1].clientY);
 d.addEventListener('touchstart',e=>{if(isPhoneResizeLocked(w)||e.touches.length!==2)return;const points=[...e.touches],key=area(points);if(!key)return;pinch={key,ids:points.map(p=>p.identifier),distance:Math.max(1,gap(points)),scale:values[key]};suppressUntil=Date.now()+800;e.preventDefault();e.stopImmediatePropagation();},{capture:true,passive:false});
 d.addEventListener('touchmove',e=>{if(!pinch)return;if(isPhoneResizeLocked(w)){pinch=null;return;}const points=pinch.ids.map(id=>[...e.touches].find(t=>t.identifier===id));if(points.some(p=>!p))return;e.preventDefault();e.stopImmediatePropagation();values[pinch.key]=clampControlScale(pinch.scale*gap(points)/pinch.distance);root.style.setProperty('--phone-'+pinch.key+'-scale',String(values[pinch.key]));},{capture:true,passive:false});
 const finish=e=>{if(!pinch)return;e.preventDefault();e.stopImmediatePropagation();try{w.localStorage.setItem(keys[pinch.key],String(values[pinch.key]));}catch{}pinch=null;suppressUntil=Date.now()+500;};d.addEventListener('touchend',finish,{capture:true,passive:false});d.addEventListener('touchcancel',finish,{capture:true,passive:false});
 d.addEventListener('click',e=>{if(Date.now()<suppressUntil&&e.target.closest?.('button')){e.preventDefault();e.stopImmediatePropagation();}},true);
}

/** Desktop toolbar resizing shares the phone's bounds but keeps a local preference. */
export function bindDesktopControlScale({panel,window:w}){
 const key='papers:ayg:toolbar-scale';let scale=1;try{scale=clampControlScale(Number(w.localStorage.getItem(key))||1);}catch{}
 const apply=()=>panel.style.setProperty('--navigator-toolbar-scale',String(scale));apply();
 panel.addEventListener('wheel',e=>{if(!e.ctrlKey||!e.deltaY||!e.target.closest?.('.workspace-navigator-header'))return;e.preventDefault();e.stopImmediatePropagation();scale=clampControlScale(scale*(e.deltaY<0?1.08:1/1.08));apply();try{w.localStorage.setItem(key,String(scale));}catch{}},{capture:true,passive:false});
}

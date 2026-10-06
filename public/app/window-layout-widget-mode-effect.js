/** Alt+Q mode presentation reuses the canvas selection wash controller. */
import { createSetEffectsController } from '../set-effects-model.js';
import { animate } from '../vendor/anime.js';

export function createWidgetModeEffect({document,windowRef,grid,
  createEffects=createSetEffectsController,animateEffect=animate,ResizeObserver=windowRef.ResizeObserver}) {
  const effects=createEffects({document,animate:animateEffect,random:()=>0.99});
  let active=document.documentElement?.dataset?.widgetInteraction==='peek';
  let card=null,svg=null,path=null;
  const observer=ResizeObserver?new ResizeObserver(()=>paint()):null;
  function clear(){effects.clear();svg?.remove();svg=null;path=null;observer?.disconnect();card=null;}
  function paint(){
    if(!active){clear();return;}
    const next=grid.querySelector('.window-layout-card:not(.window-layout-card--bootstrap)');
    if(!next){clear();return;}
    if(next!==card){
      clear();card=next;
      svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
      svg.setAttribute('class','widget-mode-wave');svg.setAttribute('aria-hidden','true');
      path=document.createElementNS('http://www.w3.org/2000/svg','path');
      path.setAttribute('fill','none');svg.append(path);card.prepend(svg);observer?.observe(card);
    }
    const {width,height}=card.getBoundingClientRect();
    svg.setAttribute('viewBox',`0 0 ${Math.max(1,width)} ${Math.max(1,height)}`);
    path.setAttribute('d',`M0 0H${width}V${height}H0Z`);
    effects.sync({selectedSetIds:['alt-q'],regions:[{id:'widget',setIds:['alt-q'],path}],
      colorFor:()=> '#6a93b5',effectsLayer:svg});
  }
  const onMode=event=>{
    if(event.source!==windowRef||event.data?.type!=='papers:project:widget-interaction-mode')return;
    active=event.data.mode==='peek';paint();
  };
  windowRef.addEventListener('message',onMode);
  return {refresh:paint,dispose(){windowRef.removeEventListener('message',onMode);clear();}};
}

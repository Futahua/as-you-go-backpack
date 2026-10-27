import { validateViewOptions } from './navigator-view-options.js';

const fields={name:[['name','Contains','text']],type:[['type','Extension / type','text']],size:[['minSize','From','text'],['maxSize','Through','text']],modified:[['after','From','date'],['before','Through','date']]};
export function inlineFilterSummary(key,options){
  const values=(fields[key]||[]).map(([name])=>String(options[name]||'').trim());
  if(values.length===1)return values[0];
  return values.some(Boolean)?`${values[0]||'…'} – ${values[1]||'…'}`:'';
}
/** Inline presentation only; existing view-options validation and persistence remain authoritative. */
export function bindInlineFilter({button,key,options,onApply}){
  if(!fields[key])return button;
  const d=button.ownerDocument,wrap=d.createElement('span');wrap.className='navigator-inline-filter';wrap.dataset.filterKey=key;wrap.append(button);
  const summary=inlineFilterSummary(key,options),badge=d.createElement('small');badge.className='navigator-filter-value';badge.textContent=summary;badge.hidden=!summary;
  button.append(badge);button.classList.toggle('is-filtered',!!summary);button.title+=(summary?' · '+summary:'')+' · Right-click or hold to filter';
  let form=null,timer=null,origin=null,suppressClick=false;
  const stop=()=>{clearTimeout(timer);timer=null;};
  function open(){
    stop();if(form){form.querySelector('input')?.focus();return;}
    form=d.createElement('form');form.className='navigator-inline-filter-editor';form.setAttribute('aria-label',`Filter ${key}`);
    const inputs=[];let closing=false;
    for(const [name,label,type]of fields[key]){const holder=d.createElement('label');holder.textContent=label;const input=d.createElement('input');input.type=type;input.value=options[name]||'';input.name=name;input.autocomplete='off';input.setAttribute('aria-label',key+' '+label);if(key==='size')input.placeholder=name==='minSize'?'500 KB':'10 MB';if(key==='type')input.placeholder='pdf, jpg, folders…';holder.append(input);inputs.push(input);form.append(holder);}
    const message=d.createElement('span');message.className='navigator-filter-error';message.setAttribute('role','alert');
    const done=d.createElement('button');done.type='submit';done.textContent='✓';done.title='Apply filter';done.setAttribute('aria-label','Apply filter');form.append(done,message);
    const close=()=>{closing=true;form?.remove();form=null;button.setAttribute('aria-expanded','false');};
    const apply=()=>{if(closing)return;const next={...options};for(const input of inputs)next[input.name]=input.value.trim();try{validateViewOptions(next);}catch(error){message.textContent=error.message;return;}close();onApply(next);};
    form.addEventListener('submit',event=>{event.preventDefault();event.stopPropagation();apply();});
    form.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Escape'){event.preventDefault();close();button.focus();}});
    form.addEventListener('pointerdown',event=>event.stopPropagation());
    form.addEventListener('focusout',()=>queueMicrotask(()=>{if(form&&!wrap.contains(d.activeElement))apply();}));
    wrap.append(form);button.setAttribute('aria-expanded','true');inputs[0].focus();
  }
  button.setAttribute('aria-expanded','false');
  button.addEventListener('contextmenu',event=>{event.preventDefault();event.stopPropagation();open();});
  button.addEventListener('pointerdown',event=>{if(event.pointerType!=='touch'||event.button!==0)return;origin={x:event.clientX,y:event.clientY};suppressClick=false;timer=setTimeout(()=>{suppressClick=true;open();},450);});
  button.addEventListener('pointermove',event=>{if(origin&&Math.hypot(event.clientX-origin.x,event.clientY-origin.y)>8)stop();});
  for(const name of ['pointerup','pointercancel','pointerleave'])button.addEventListener(name,stop);
  button.addEventListener('click',event=>{if(suppressClick){suppressClick=false;event.preventDefault();event.stopImmediatePropagation();}},true);
  return wrap;
}

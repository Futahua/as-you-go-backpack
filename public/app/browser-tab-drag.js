export const BROWSER_TAB_DRAG_TYPE = 'application/x-papers-browser-tab';
export function droppedBrowserUrl(data) {
  const uri = (data.getData('text/uri-list') || '').split(/\r?\n/).find(line => line.trim() && !line.startsWith('#'));
  const text = (uri || data.getData('text/plain') || '').trim();
  if (!text) return null;
  try { const url = new URL(text); if (['http:','https:'].includes(url.protocol)) return url.href; } catch {}
  return 'https://www.google.com/search?q=' + encodeURIComponent(text);
}
export function insertBrowserTab(tabs, tab, index) {
  const from = tabs.findIndex(item => item.id === tab.id);
  const next = tabs.filter(item => item.id !== tab.id);
  const target = Math.max(0, Math.min(next.length, index - (from >= 0 && from < index ? 1 : 0)));
  next.splice(target, 0, tab);
  return next;
}
export function installBrowserTabDrag(bar, { tabs, reorder, open }) {
  bar.addEventListener('wheel',event=>{
    if(event.ctrlKey || bar.scrollWidth<=bar.clientWidth)return;
    const delta=Math.abs(event.deltaX)>Math.abs(event.deltaY)?event.deltaX:event.deltaY;
    if(!delta)return;
    event.preventDefault();
    bar.scrollLeft+=delta*(event.deltaMode===1?20:event.deltaMode===2?bar.clientWidth:1);
  },{passive:false});
  const position = x => {
    const items = [...bar.querySelectorAll('[data-browser-tab-id]')];
    const index = items.findIndex(item => { const rect = item.getBoundingClientRect(); return x < rect.left + rect.width / 2; });
    return index < 0 ? items.length : index;
  };
  bar.querySelectorAll('[data-browser-tab-id]').forEach(item => {
    item.draggable = true;
    item.addEventListener('dragstart', event => {
      event.dataTransfer.setData(BROWSER_TAB_DRAG_TYPE, item.dataset.browserTabId);
      event.dataTransfer.effectAllowed = 'move';
    });
  });
  bar.addEventListener('dragover', event => {
    if (![BROWSER_TAB_DRAG_TYPE,'text/plain','text/uri-list'].some(type => [...event.dataTransfer.types].includes(type))) return;
    event.preventDefault(); event.dataTransfer.dropEffect = event.dataTransfer.types.includes(BROWSER_TAB_DRAG_TYPE) ? 'move' : 'copy';
    const index = position(event.clientX);
    bar.querySelectorAll('[data-browser-tab-id]').forEach((item,i) => { item.classList.toggle('drop-before',i === index); item.classList.toggle('drop-after',index === tabs().length && i === index - 1); });
  });
  const clear = () => bar.querySelectorAll('.drop-before,.drop-after').forEach(item => item.classList.remove('drop-before','drop-after'));
  bar.addEventListener('dragleave',event => { if (!bar.contains(event.relatedTarget)) clear(); });
  bar.addEventListener('dragend',clear);
  bar.addEventListener('drop',event => {
    event.preventDefault(); event.stopPropagation(); clear();
    const index = position(event.clientX), id = event.dataTransfer.getData(BROWSER_TAB_DRAG_TYPE);
    if (id) { const tab = tabs().find(item => item.id === id); if (tab) reorder(insertBrowserTab(tabs(),tab,index)); }
    else { const url = droppedBrowserUrl(event.dataTransfer); if (url) open(url,index); }
  });
}

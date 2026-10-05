/** Temporary sibling browsing with local, reversible branch expansion. */
export function createBreadcrumbPopup({ document, children, art, activate }) {
  let popup = null, generation = 0;
  function close() {
    generation++; popup?.remove(); popup = null;
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', escape, true);
  }
  function outside(event) { if (!popup?.contains(event.target)) close(); }
  function escape(event) { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } }
  async function show(anchor, parent) {
    close(); const current = generation;
    popup = document.createElement('div'); popup.className = 'navigator-breadcrumb-popup';
    popup.setAttribute('aria-label', 'Same level items');
    const rect = anchor.getBoundingClientRect(), win = document.defaultView;
    popup.style.left = Math.max(8, Math.min(rect.left, win.innerWidth - 288)) + 'px';
    popup.style.top = Math.min(rect.bottom + 4, win.innerHeight - 100) + 'px';
    popup.style.maxHeight = Math.max(72, win.innerHeight - parseFloat(popup.style.top) - 8) + 'px';
    document.body.append(popup);
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape, true);
    async function appendRows(container, owner, depth) {
      const items = await children(owner);
      if (current !== generation || !container.isConnected) return;
      for (const item of items) {
        const row = document.createElement('div'); row.className = 'workspace-navigator-row';
        row.draggable=true;
        row.addEventListener('dragstart',event=>event.dataTransfer?.setData('application/x-papers-pill',JSON.stringify(item.kind==='group'?{mode:'ayg',currentId:item.id,view:'nav',name:item.name,icon:item.icon}:{mode:'action',path:item.path,itemId:item.shortcutId||item.id,name:item.name,icon:item.icon})));
        row.style.paddingLeft = (6 + depth * 13) + 'px';
        const image = document.createElement('span'); image.className = 'workspace-navigator-art'; art(image, item);
        const label = document.createElement('span'); label.className = 'workspace-navigator-label'; label.textContent = item.name || item.path || 'Untitled';
        row.append(image, label); container.append(row);
        let branch = null;
        row.addEventListener('contextmenu', async event => {
          if (!event.shiftKey || !['group','folder'].includes(item.kind)) return;
          event.preventDefault(); event.stopPropagation();
          if (branch) { branch.remove(); branch = null; }
          else { branch = document.createElement('div'); row.after(branch); await appendRows(branch, item, depth + 1); }
        });
        row.addEventListener('click', () => { close(); void activate(item); });
      }
    }
    await appendRows(popup, parent, 0);
  }
  return { show, close };
}

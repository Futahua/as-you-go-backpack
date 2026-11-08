/* Linked window groups (creator, 2026-11-08). A group's grab handle (⠿) links it with others:
 * - click one handle, then another: the two become a link group, and their handles share a colour;
 * - click a handle that is already linked: that group leaves its link (a link left with one group ends);
 * - Ctrl-click a handle: every following click adds to that handle's link; Ctrl-click it again to stop;
 * - Esc cancels a half-made link or the adding mode.
 * Linked groups minimize, maximize and restore together. The host keeps at most one maximized group,
 * so maximizing a link gives the linked groups the page: the others are minimized, and restoring puts
 * them back as they were. Dragging a handle still moves its group. Links are remembered per layout. */

const PALETTE = ['#e5a83b', '#4fb0e8', '#c678dd', '#7cc86d', '#e46b74', '#d7c650', '#4fd3c2', '#f08cba'];

export function createPaneGroupLinks({ storage = globalThis.localStorage } = {}) {
  let key = null;
  let state = empty();
  let pending = null; // first handle of a link being made
  let adding = null; // { link, anchor } while Ctrl adding mode is on

  function empty() { return { members: {}, colors: {}, maxed: null }; }
  function load(binding) {
    const next = 'papers.paneGroupLinks.' + (binding || 'default');
    if (next === key) return;
    key = next; pending = null; adding = null;
    try {
      const value = JSON.parse(storage?.getItem(key) || 'null');
      state = value && typeof value === 'object' && value.members && value.colors ? { ...empty(), ...value } : empty();
    } catch { state = empty(); }
  }
  function save() { try { storage?.setItem(key, JSON.stringify(state)); } catch {} }
  const linkOf = groupId => state.members[groupId] || null;
  const membersOf = (link, existing) => Object.keys(state.members).filter(id => state.members[id] === link && (!existing || existing.has(id)));
  function newLink() {
    const link = 'link-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const used = new Set(Object.values(state.colors));
    state.colors[link] = PALETTE.find(color => !used.has(color)) || PALETTE[Object.keys(state.colors).length % PALETTE.length];
    return link;
  }
  function dissolveIfSingle(link) {
    if (adding?.link === link) return;
    const members = membersOf(link);
    if (members.length > 1) return;
    for (const id of members) delete state.members[id];
    delete state.colors[link];
    if (state.maxed?.link === link) state.maxed = null;
  }
  function leave(groupId) {
    const link = linkOf(groupId);
    if (!link) return;
    delete state.members[groupId];
    dissolveIfSingle(link);
  }

  /** A click (not a drag) on a group's grab handle. */
  function click(groupId, { ctrl = false } = {}) {
    if (ctrl) {
      if (adding && (adding.anchor === groupId || adding.link === linkOf(groupId))) {
        const link = adding.link; adding = null; dissolveIfSingle(link);
      } else {
        if (adding) { const old = adding.link; adding = null; dissolveIfSingle(old); }
        let link = linkOf(groupId);
        if (!link) { link = newLink(); state.members[groupId] = link; }
        adding = { link, anchor: groupId }; pending = null;
      }
    } else if (adding) {
      if (linkOf(groupId) !== adding.link) { leave(groupId); state.members[groupId] = adding.link; }
    } else if (linkOf(groupId)) {
      leave(groupId); pending = null;
    } else if (pending && pending !== groupId) {
      const link = newLink(); state.members[pending] = link; state.members[groupId] = link; pending = null;
    } else {
      pending = pending === groupId ? null : groupId;
    }
    save();
  }
  function cancel() {
    const had = pending || adding;
    pending = null;
    if (adding) { const link = adding.link; adding = null; dissolveIfSingle(link); save(); }
    return Boolean(had);
  }

  /** Presentation commands for a min/max/restore request on one group. */
  function present(groupId, mode, groups) {
    const link = linkOf(groupId), existing = new Set(groups.map(g => g.id));
    const members = link ? membersOf(link, existing) : [];
    if (members.length < 2) return [{ groupId, mode }];
    const current = new Map(groups.map(g => [g.id, g.presentation]));
    const set = new Set(members);
    if (mode === 'maximized') {
      // A host-maximized group outside the link is restored first, or it would keep the page.
      const others = groups.filter(g => !set.has(g.id));
      state.maxed = { link, others: Object.fromEntries(others.map(g => [g.id, g.presentation === 'maximized' ? 'normal' : g.presentation])) };
      save();
      return [...members.map(id => ({ groupId: id, mode: 'normal' })), ...others.filter(g => g.presentation !== 'minimized').map(g => ({ groupId: g.id, mode: 'minimized' }))];
    }
    if (mode === 'normal' && state.maxed?.link === link) {
      const others = state.maxed.others; state.maxed = null; save();
      return [...members.filter(id => current.get(id) !== 'normal').map(id => ({ groupId: id, mode: 'normal' })),
        ...Object.entries(others).filter(([id, was]) => existing.has(id) && current.get(id) !== was).map(([id, was]) => ({ groupId: id, mode: was }))];
    }
    if (state.maxed?.link === link) { state.maxed = null; save(); }
    return members.filter(id => current.get(id) !== mode).map(id => ({ groupId: id, mode }));
  }
  /** Whether this group's link currently holds the page (shows the maximize button as restore). */
  const linkMaximized = groupId => Boolean(linkOf(groupId) && state.maxed?.link === linkOf(groupId));

  /** How a handle looks: its link colour, and whether it is the half-made link or the adding anchor. */
  function look(groupId) {
    const link = linkOf(groupId);
    return { color: link ? state.colors[link] || null : null, pending: pending === groupId, adding: Boolean(adding && adding.link === link && link), anchor: adding?.anchor === groupId };
  }
  return { load, click, cancel, present, linkMaximized, look, linkOf, get pending() { return pending; }, get adding() { return adding; } };
}

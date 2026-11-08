/* Linked window groups (creator, 2026-11-08). A group's grab handle (⠿) links it with others:
 * - click one handle, then another: the two become a link group, and their handles share a colour;
 * - click a handle that is already linked: that group leaves its link (a link left with one group ends);
 * - Ctrl-click a handle: every following click adds to that handle's link; Ctrl-click it again or Esc to stop;
 * - Esc cancels a half-made link or the adding mode. While picking, every group strip turns rainbow.
 * Linked groups minimize, maximize and restore together. The host keeps at most one maximized group,
 * so maximizing a link gives the linked groups the page: the others are minimized, and restoring puts
 * them back as they were. Dragging a handle still moves its group.
 *
 * Several window-group views can be open at once (one per page or window), each with its own copy of
 * this module. The links, their colours and the picking mode therefore live only in storage, read fresh
 * on every use, so every view agrees and no view overwrites another's links or reuses a colour. */

const PALETTE = ['#e5a83b', '#4fb0e8', '#c678dd', '#7cc86d', '#e46b74', '#d7c650', '#4fd3c2', '#f08cba'];
const PICK_TTL_MS = 10 * 60 * 1000; // a forgotten picking mode ends by itself

export function createPaneGroupLinks({ storage = globalThis.localStorage, now = () => Date.now() } = {}) {
  let key = 'papers.paneGroupLinks.default';

  function empty() { return { members: {}, colors: {}, maxed: null, pending: null, adding: null, pickAt: 0 }; }
  function read() {
    let state;
    try {
      const value = JSON.parse(storage?.getItem(key) || 'null');
      state = value && typeof value === 'object' && value.members && value.colors ? { ...empty(), ...value } : empty();
    } catch { state = empty(); }
    if ((state.pending || state.adding) && now() - (state.pickAt || 0) > PICK_TTL_MS) { state.pending = null; state.adding = null; }
    return state;
  }
  function write(state) { try { storage?.setItem(key, JSON.stringify(state)); } catch {} }
  /** Run a change against the freshest stored state and save it. */
  function change(work) { const state = read(); const result = work(state); write(state); return result; }

  function load(binding) { key = 'papers.paneGroupLinks.' + (binding || 'default'); }
  const membersOf = (state, link, existing) => Object.keys(state.members).filter(id => state.members[id] === link && (!existing || existing.has(id)));
  function newLink(state) {
    const link = 'link-' + now().toString(36) + Math.random().toString(36).slice(2, 6);
    const used = new Set(Object.keys(state.colors).filter(other => membersOf(state, other).length).map(other => state.colors[other]));
    state.colors[link] = PALETTE.find(color => !used.has(color)) || PALETTE[Object.keys(state.colors).length % PALETTE.length];
    return link;
  }
  function dissolveIfSingle(state, link) {
    if (state.adding?.link === link) return;
    const members = membersOf(state, link);
    if (members.length > 1) return;
    for (const id of members) delete state.members[id];
    delete state.colors[link];
    if (state.maxed?.link === link) state.maxed = null;
  }
  function leave(state, groupId) {
    const link = state.members[groupId];
    if (!link) return;
    delete state.members[groupId];
    dissolveIfSingle(state, link);
  }

  /** A click (not a drag) on a group's grab handle. */
  function click(groupId, { ctrl = false } = {}) {
    change(state => {
      const linkOf = id => state.members[id] || null;
      if (ctrl) {
        if (state.adding && (state.adding.anchor === groupId || state.adding.link === linkOf(groupId))) {
          const link = state.adding.link; state.adding = null; dissolveIfSingle(state, link);
        } else {
          if (state.adding) { const old = state.adding.link; state.adding = null; dissolveIfSingle(state, old); }
          let link = linkOf(groupId);
          if (!link) { link = newLink(state); state.members[groupId] = link; }
          state.adding = { link, anchor: groupId }; state.pending = null; state.pickAt = now();
        }
      } else if (state.adding) {
        if (linkOf(groupId) !== state.adding.link) { leave(state, groupId); state.members[groupId] = state.adding.link; }
        state.pickAt = now();
      } else if (linkOf(groupId)) {
        leave(state, groupId); state.pending = null;
      } else if (state.pending && state.pending !== groupId) {
        const link = newLink(state); state.members[state.pending] = link; state.members[groupId] = link; state.pending = null;
      } else {
        state.pending = state.pending === groupId ? null : groupId; state.pickAt = now();
      }
    });
  }
  function cancel() {
    return change(state => {
      const had = Boolean(state.pending || state.adding);
      state.pending = null;
      if (state.adding) { const link = state.adding.link; state.adding = null; dissolveIfSingle(state, link); }
      return had;
    });
  }

  /** Presentation commands for a min/max/restore request on one group. */
  function present(groupId, mode, groups) {
    return change(state => {
      const link = state.members[groupId] || null, existing = new Set(groups.map(g => g.id));
      const members = link ? membersOf(state, link, existing) : [];
      if (members.length < 2) return [{ groupId, mode }];
      const current = new Map(groups.map(g => [g.id, g.presentation]));
      const set = new Set(members);
      if (mode === 'maximized') {
        // A host-maximized group outside the link is restored first, or it would keep the page.
        const others = groups.filter(g => !set.has(g.id));
        state.maxed = { link, others: Object.fromEntries(others.map(g => [g.id, g.presentation === 'maximized' ? 'normal' : g.presentation])) };
        return [...members.map(id => ({ groupId: id, mode: 'normal' })), ...others.filter(g => g.presentation !== 'minimized').map(g => ({ groupId: g.id, mode: 'minimized' }))];
      }
      if (mode === 'normal' && state.maxed?.link === link) {
        const others = state.maxed.others; state.maxed = null;
        return [...members.filter(id => current.get(id) !== 'normal').map(id => ({ groupId: id, mode: 'normal' })),
          ...Object.entries(others).filter(([id, was]) => existing.has(id) && current.get(id) !== was).map(([id, was]) => ({ groupId: id, mode: was }))];
      }
      if (state.maxed?.link === link) state.maxed = null;
      return members.filter(id => current.get(id) !== mode).map(id => ({ groupId: id, mode }));
    });
  }
  /** Whether this group's link currently holds the page (shows the maximize button as restore). */
  function linkMaximized(groupId) { const state = read(); const link = state.members[groupId]; return Boolean(link && state.maxed?.link === link); }

  /** One fresh read for a whole render: each handle's look, and whether picking is on. */
  function snapshot() {
    const state = read();
    return {
      picking: Boolean(state.pending || state.adding),
      linkOf: groupId => state.members[groupId] || null,
      look(groupId) {
        const link = state.members[groupId] || null;
        return { link, color: link ? state.colors[link] || null : null, pending: state.pending === groupId, adding: Boolean(link && state.adding?.link === link), anchor: state.adding?.anchor === groupId };
      },
    };
  }
  const look = groupId => snapshot().look(groupId);
  const linkOf = groupId => read().members[groupId] || null;
  return { load, click, cancel, present, linkMaximized, snapshot, look, linkOf, get key() { return key; }, get pending() { return read().pending; }, get adding() { return read().adding; } };
}

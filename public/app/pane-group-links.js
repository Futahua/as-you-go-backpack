/* Linked window groups (creator, 2026-11-08). A group's grab handle (⠿) links it with others, also across
 * Papers windows:
 * - click one handle, then another: the two become a link and their handles share a colour; picking stays on
 *   so every further click adds a group to that link, or takes a member back out, until Esc;
 * - outside picking, clicking a linked handle takes that group out (a link left with one group ends);
 * - Ctrl-click a handle to pick for its existing link; Ctrl-click it again or Esc to stop.
 * While picking, the strips of the groups in the link being built turn rainbow.
 * Linked groups minimize, maximize and restore together. Each window applies a linked action to its own
 * members. The host keeps at most one maximized group per window, so maximizing a link gives its members
 * the page in each window where it has members: the other groups there are minimized, and restoring puts
 * them back as they were. Dragging a handle still moves its group.
 *
 * Every window and every window-group view keeps its own copy of this module, so the links, their colours
 * and the picking mode live only in storage (one key for all windows), read fresh on every use. A group is
 * known as "<page key>|<group id>" (the page key survives reloads and reboots). Each window remembers what it minimized for a maximize under its
 * own key, so windows never overwrite each other's restore state. A link's colour is chosen once, the way
 * As you Go colours a folder, so it is the same in every window. */

const KEY = 'papers.paneGroupLinks.v2';
const PICK_TTL_MS = 10 * 60 * 1000; // a forgotten picking mode ends by itself
const MIN_SEPARATION = 45; // As you Go's folder hue separation

export function createPaneGroupLinks({ storage = globalThis.localStorage, now = () => Date.now() } = {}) {
  let binding = 'default';
  const id = groupId => binding + '|' + groupId;

  // own: linked groups the creator set on their own with Ctrl-click; linked actions skip them until a plain click on
  // one of that group's own buttons makes it follow its link again.
  function empty() { return { members: {}, own: {}, hues: {}, maxedLinks: {}, pending: null, adding: null, pickAt: 0 }; }
  function read() {
    let state;
    try {
      const value = JSON.parse(storage?.getItem(KEY) || 'null');
      state = value && typeof value === 'object' && value.members ? { ...empty(), ...value } : empty();
    } catch { state = empty(); }
    if ((state.pending || state.adding) && now() - (state.pickAt || 0) > PICK_TTL_MS) { state.pending = null; state.adding = null; }
    return state;
  }
  function write(state) { try { storage?.setItem(KEY, JSON.stringify(state)); } catch {} }
  function change(work) { const state = read(); const result = work(state); write(state); return result; }
  const localMaxKey = () => KEY + '.maxed.' + binding;
  function readLocalMax() { try { return JSON.parse(storage?.getItem(localMaxKey()) || 'null'); } catch { return null; } }
  function writeLocalMax(value) { try { if (value) storage?.setItem(localMaxKey(), JSON.stringify(value)); else storage?.removeItem?.(localMaxKey()); } catch {} }

  function load(nextBinding) { binding = nextBinding || 'default'; }
  const membersOf = (state, link) => Object.keys(state.members).filter(member => state.members[member] === link);
  function newLink() { return 'link-' + now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function dissolveIfSingle(state, link) {
    if (state.adding?.link === link) return;
    const members = membersOf(state, link);
    if (members.length > 1) return;
    for (const member of members) { delete state.members[member]; delete state.own[member]; }
    delete state.hues[link]; delete state.maxedLinks[link];
  }
  function leave(state, member) {
    const link = state.members[member];
    if (!link) return;
    delete state.members[member]; delete state.own[member];
    dissolveIfSingle(state, link);
  }

  /** A click (not a drag) on a group's grab handle. */
  function click(groupId, { ctrl = false } = {}) {
    const me = id(groupId);
    change(state => {
      const linkOf = member => state.members[member] || null;
      if (ctrl) {
        if (state.adding && (state.adding.anchor === me || state.adding.link === linkOf(me))) {
          const link = state.adding.link; state.adding = null; dissolveIfSingle(state, link);
        } else {
          if (state.adding) { const old = state.adding.link; state.adding = null; dissolveIfSingle(state, old); }
          let link = linkOf(me);
          if (!link) { link = newLink(); state.members[me] = link; }
          state.adding = { link, anchor: me }; state.pending = null; state.pickAt = now();
        }
      } else if (state.adding) {
        // While picking, a click adds a group to the link being built, or takes one of its members back out.
        if (linkOf(me) !== state.adding.link) { leave(state, me); state.members[me] = state.adding.link; }
        else if (state.adding.anchor !== me) delete state.members[me];
        state.pickAt = now();
      } else if (linkOf(me)) {
        leave(state, me); state.pending = null;
      } else if (state.pending && state.pending !== me) {
        const link = newLink(); state.members[state.pending] = link; state.members[me] = link;
        state.adding = { link, anchor: state.pending }; state.pending = null; state.pickAt = now();
      } else {
        state.pending = state.pending === me ? null : me; state.pickAt = now();
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

  /** This window's presentation steps for a linked action (also run when another window announces one). */
  function applyLink(link, mode, groups) {
    const state = read(), set = new Set(membersOf(state, link)), own = state.own || {};
    const linked = groups.filter(g => set.has(id(g.id))), others = groups.filter(g => !set.has(id(g.id)));
    const mine = linked.filter(g => !own[id(g.id)]), kept = linked.filter(g => own[id(g.id)]);
    if (!mine.length) return [];
    const spec = 'link:' + mine.map(g => g.id).join(',') + (kept.length ? '|keep:' + kept.map(g => g.id).join(',') : '');
    const local = readLocalMax();
    if (mode === 'maximized') {
      // A host-maximized group outside the link is restored first, or it would keep the page.
      writeLocalMax({ link, others: Object.fromEntries(others.map(g => [g.id, g.presentation === 'maximized' ? 'normal' : g.presentation])) });
      // Groups set on their own keep their state; only the rest of the link and the unlinked groups move.
      // One coordinator command: it minimizes the other groups and keeps the linked groups' sizes relative to each other.
      return [{ groupId: mine[0].id, mode: 'maximized', side: spec }];
    }
    if (mode === 'normal' && local?.link === link) {
      writeLocalMax(null);
      const current = new Map(groups.map(g => [g.id, g.presentation]));
      // The coordinator puts back the saved split ratios and presentations; the explicit steps after it only matter
      // if Papers restarted since the maximize (they find every group already as it was otherwise).
      return [{ groupId: mine[0].id, mode: 'normal', side: spec },
        ...mine.filter(g => g.presentation !== 'normal').map(g => ({ groupId: g.id, mode: 'normal' })),
        ...Object.entries(local.others).filter(([groupId, was]) => current.has(groupId) && current.get(groupId) !== was).map(([groupId, was]) => ({ groupId, mode: was }))];
    }
    if (local?.link === link) writeLocalMax(null);
    return mine.filter(g => g.presentation !== mode).map(g => ({ groupId: g.id, mode }));
  }
  /** A min/max/restore on one group: this window's steps, and the action to announce to other windows. */
  function request(groupId, mode, groups, { ctrl = false } = {}) {
    const me = id(groupId);
    // Ctrl: this group alone, and it keeps that state while its link moves around it.
    if (ctrl) { change(state => { if (state.members[me]) state.own[me] = mode; }); return { steps: [{ groupId, mode }], announce: null }; }
    const link = change(state => {
      delete state.own[me]; // a plain click on its own buttons makes it follow its link again
      const link = state.members[me] || null;
      if (!link || membersOf(state, link).length < 2) return null;
      if (mode === 'maximized') state.maxedLinks[link] = true; else delete state.maxedLinks[link];
      return link;
    });
    if (!link) return { steps: [{ groupId, mode }], announce: null };
    return { steps: applyLink(link, mode, groups), announce: { link, mode } };
  }
  /** A group removed with its × drops out of its link (a link left with one group ends). */
  function drop(groupId) { change(state => leave(state, id(groupId))); }
  /** Whether this group's link currently holds the page (shows the maximize button as restore). */
  function linkMaximized(groupId) { const state = read(); const link = state.members[id(groupId)]; return Boolean(link && state.maxedLinks[link]); }

  /** Give links that have no colour yet the hue As you Go's folder logic proposes, kept apart from colours in use. */
  function assignHues(proposed) {
    const list = [...proposed];
    if (!list.length) return;
    change(state => {
      for (const [link, hue] of list) {
        if (typeof state.hues[link] === 'number' || !Object.values(state.members).includes(link)) continue;
        const used = Object.entries(state.hues).filter(([other]) => other !== link).map(([, h]) => h);
        let chosen = hue;
        for (let step = 0; step < 8 && used.some(h => distance(h, chosen) < MIN_SEPARATION); step += 1) chosen = (chosen + MIN_SEPARATION) % 360;
        state.hues[link] = chosen;
      }
    });
  }

  /** One fresh read for a whole render: each handle's look, and which links still need a colour. */
  function snapshot() {
    const state = read();
    const acting = state.adding?.link || null;
    return {
      picking: Boolean(state.pending || state.adding),
      linkOf: groupId => state.members[id(groupId)] || null,
      needsHue: link => typeof state.hues[link] !== 'number',
      look(groupId) {
        const me = id(groupId), link = state.members[me] || null, hue = link ? state.hues[link] : undefined;
        return {
          link,
          color: typeof hue === 'number' ? 'oklch(68% 0.18 ' + hue + 'deg)' : null,
          pending: state.pending === me,
          // The strips of the groups in the link being built (or the first picked group) turn rainbow.
          acting: state.pending === me || Boolean(acting && link === acting),
          anchor: state.adding?.anchor === me,
        };
      },
    };
  }
  const look = groupId => snapshot().look(groupId);
  const linkOf = groupId => read().members[id(groupId)] || null;
  return { load, click, cancel, request, applyLink, drop, linkMaximized, assignHues, snapshot, look, linkOf, key: KEY,
    get pending() { return read().pending; }, get adding() { return read().adding; } };
}

function distance(a, b) { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); }

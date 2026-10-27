/**
 * AYG links name real files by path (plus an owner-issued fileTarget id when the host could enroll it).
 * When AYG itself moves or renames a real file or folder, every stored reference to it, or to anything
 * beneath it, is rewritten in one document change: link targets, saved pills and pinned previews.
 * Authored names are kept; a name that was only the old disk name follows the new disk name.
 */
const key = (value) => String(value || '').replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
const diskName = (value) => String(value || '').split(/[\\/]/).filter(Boolean).pop() || '';

/** The moved path for `value`, or null when no move covers it (exactly or as a descendant). */
export function movedPath(value, moves) {
  if (typeof value !== 'string' || !value) return null;
  const current = key(value);
  // The longest (most specific) source wins when a folder and something inside it both moved.
  let best = null;
  for (const move of moves || []) {
    const old = key(move?.oldPath);
    if (!old || typeof move.newPath !== 'string' || !move.newPath) continue;
    if (current !== old && !current.startsWith(old + '\\')) continue;
    if (!best || old.length > key(best.oldPath).length) best = move;
  }
  if (!best) return null;
  const oldLength = String(best.oldPath).replace(/\//g, '\\').replace(/\\+$/, '').length;
  const suffix = value.replace(/\//g, '\\').slice(oldLength);
  return best.newPath.replace(/[\\/]+$/, '') + suffix;
}

function rewriteStrings(value, moves) {
  if (typeof value === 'string') return movedPath(value, moves) ?? value;
  if (Array.isArray(value)) return value.map((item) => rewriteStrings(item, moves));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, rewriteStrings(item, moves)]));
  return value;
}

/** Pure: returns { state, changed } with every reference under each moved path rewritten. */
export function rewriteMovedFileLinks(state, moves) {
  const valid = (moves || []).filter((move) => key(move?.oldPath) && typeof move.newPath === 'string' && key(move.oldPath) !== key(move.newPath));
  if (!state || !valid.length) return { state, changed: 0 };
  let changed = 0;
  const shortcuts = (state.shortcuts || []).map((record) => {
    const target = movedPath(record?.target, valid);
    if (target === null || target === record.target) return record;
    changed++;
    const exact = valid.some((move) => key(move.oldPath) === key(record.target));
    const followsDisk = exact && record.name === diskName(record.target);
    return { ...record, target, ...(followsDisk ? { name: diskName(target) } : {}) };
  });
  const view = state.view ? rewriteStrings(state.view, valid) : state.view;
  const viewChanged = JSON.stringify(view) !== JSON.stringify(state.view);
  if (!changed && !viewChanged) return { state, changed: 0 };
  return { state: { ...state, shortcuts, ...(state.view ? { view } : {}) }, changed: changed + (viewChanged ? 1 : 0) };
}

const isLocalPath = (value) => typeof value === 'string' && /^[a-z]:[\\/]/i.test(value);
const normal = (value) => String(value).replace(/\//g, '\\').replace(/\\+$/, '');
const parentOf = (value) => { const text = normal(value); const at = text.lastIndexOf('\\'); return at > 2 ? text.slice(0, at) : at === 2 && text.length > 3 ? text.slice(0, 3) : null; };
const join = (folder, name) => folder.replace(/\\+$/, '') + '\\' + name;
const missing = (result) => result?.ok === false && result.code === 'ENOENT';

/**
 * Repair for links an earlier move already broke (moved outside AYG, or before links followed moves).
 * A link qualifies only when its path is verifiably absent (ENOENT, so offline drives are left alone) and
 * it has no owner-issued identity to follow. The first missing path component is searched for, by its
 * exact name, beneath the nearest folder that still exists (bounded depth and folder count). Exactly one
 * candidate under which the rest of the link's path exists is accepted; anything ambiguous or absent is
 * reported and left untouched. Nothing on disk is changed; the result is one ordinary document rewrite.
 */
export async function repairBrokenFileLinks(state, { fileCapability, maxDepth = 3, maxFolders = 400, only = null } = {}) {
  const repaired = [], unresolved = [];
  if (!state || typeof fileCapability !== 'function') return { state, repaired, unresolved };
  const stats = new Map(), listings = new Map(), searches = new Map();
  const stat = (path) => { const k = key(path); if (!stats.has(k)) stats.set(k, fileCapability('stat', { path }).catch(() => null)); return stats.get(k); };
  const list = (path) => { const k = key(path); if (!listings.has(k)) listings.set(k, fileCapability('list', { path, limit: 500 }).then((r) => (r?.ok ? r.items || [] : [])).catch(() => [])); return listings.get(k); };
  async function find(root, name) {
    const found = [], queue = [{ folder: root, depth: 0 }];
    let visited = 0;
    while (queue.length && visited < maxFolders) {
      const { folder, depth } = queue.shift(); visited++;
      for (const item of await list(folder)) {
        const path = item.path || join(folder, item.name);
        if (/^\$recycle\.bin$|^system volume information$/i.test(item.name || '')) continue;
        if (depth > 0 && String(item.name).toLowerCase() === name.toLowerCase()) found.push(path);
        if (item.kind === 'folder' && depth + 1 <= maxDepth) queue.push({ folder: path, depth: depth + 1 });
      }
    }
    return found;
  }
  const moves = [];
  const records = (state.shortcuts || []).filter((record) => isLocalPath(record?.target) && !record.fileTarget?.id && (!only || only.has(record.id)));
  for (const record of records) {
    if (movedPath(record.target, moves) !== null) { repaired.push({ id: record.id, oldPath: record.target, newPath: movedPath(record.target, moves) }); continue; }
    if (!missing(await stat(record.target))) continue;
    // Walk up to the nearest folder that still exists; `lost` is its child on the link's path.
    let lost = normal(record.target), ancestor = parentOf(lost);
    while (ancestor && missing(await stat(ancestor))) { lost = ancestor; ancestor = parentOf(ancestor); }
    const ancestorStat = ancestor ? await stat(ancestor) : null;
    if (!ancestorStat?.ok || ancestorStat.entry?.kind !== 'folder') { unresolved.push({ id: record.id, path: record.target, reason: 'no surviving parent folder' }); continue; }
    const name = diskName(lost), rest = normal(record.target).slice(lost.length);
    const searchKey = key(lost);
    if (!searches.has(searchKey)) searches.set(searchKey, find(ancestor, name));
    const candidates = [];
    for (const candidate of await searches.get(searchKey)) if ((await stat(candidate + rest))?.ok === true) candidates.push(candidate);
    if (candidates.length !== 1) { unresolved.push({ id: record.id, path: record.target, reason: candidates.length ? 'several matching files' : 'not found nearby', candidates: candidates.map((c) => c + rest) }); continue; }
    moves.push({ oldPath: lost, newPath: candidates[0] });
    repaired.push({ id: record.id, oldPath: record.target, newPath: candidates[0] + rest });
  }
  if (!moves.length) return { state, repaired, unresolved };
  return { state: rewriteMovedFileLinks(state, moves).state, repaired, unresolved, moves };
}

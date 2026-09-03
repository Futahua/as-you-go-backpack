/**
 * 0B: which surface may write the board.
 *
 * Papers can show this project in more than one surface at once. The store is
 * the single owner of history and persistence *within* one surface, and every
 * save carries the WHOLE board — so two surfaces saving independently means the
 * later save silently erases the earlier one. Papers refuses a save built on a
 * stale revision (0A), but a refusal is only a backstop: it says the write was
 * wrong, not who should have written.
 *
 * So exactly one surface writes. The election is a Web Lock, not a scheme of
 * our own: the browser releases it when a surface closes or crashes, which is
 * the case a peer heartbeat cannot decide safely. A "peer looks dead, take the
 * lock" rule would be precisely the split brain the lock exists to prevent.
 *
 * The writer broadcasts each committed snapshot; views install it WITHOUT the
 * writer's navigation session, so two windows genuinely show different places
 * in one board. Views never call save.
 *
 * Nothing here is merged. On a refused save the coordinator freezes durable
 * editing and hands the creator the choice, because only they know whether
 * their version or the other one should survive.
 *
 * Everything external is injected, so the whole protocol is testable without a
 * browser, a lock manager or Papers.
 */

export const SURFACE_DOCUMENT_CHANNEL = 'as-you-go:workspace-document';
export const SURFACE_DOCUMENT_LOCK = 'as-you-go:workspace-document-writer';

/** What this surface may currently do. */
export const SURFACE_ROLE = {
  /** Reading and following the writer. Durable editing is unavailable. */
  VIEW: 'view',
  /** Holds the lock. The only surface permitted to save. */
  WRITER: 'writer',
  /** Held the lock, lost a save to a newer revision. Durable editing frozen
   * until the creator chooses which version survives. */
  CONFLICT: 'conflict',
};

const SNAPSHOT_MESSAGE = 'committed';
const MUTATION_MESSAGE = 'mutation-request';
const MUTATION_ACK_MESSAGE = 'mutation-ack';

function sameJson(a, b) {
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
}

function mergeChangedMap(baseValue, localValue, currentValue) {
  const base = isPlainObject(baseValue) ? baseValue : {};
  const local = isPlainObject(localValue) ? localValue : {};
  const result = isPlainObject(currentValue) ? { ...currentValue } : {};
  const keys = new Set([...Object.keys(base), ...Object.keys(local)]);
  for (const key of keys) {
    const baseHas = Object.prototype.hasOwnProperty.call(base, key);
    const localHas = Object.prototype.hasOwnProperty.call(local, key);
    if (!baseHas && localHas) result[key] = local[key];
    else if (baseHas && !localHas) delete result[key];
    else if (localHas && !sameJson(local[key], base[key])) result[key] = local[key];
  }
  return result;
}

function mergePositionMap(baseValue, localValue, currentValue, nested) {
  if (!nested) return mergeChangedMap(baseValue, localValue, currentValue);
  const base = isPlainObject(baseValue) ? baseValue : {};
  const local = isPlainObject(localValue) ? localValue : {};
  const current = isPlainObject(currentValue) ? currentValue : {};
  const result = {};
  const contexts = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(current)]);
  for (const context of contexts) {
    const merged = mergeChangedMap(base[context], local[context], current[context]);
    if (Object.keys(merged).length > 0) result[context] = merged;
  }
  return result;
}

/** Merge the recursive prompt/folder library by stable node id. */
function flattenPromptTree(nodes, map = new Map()) {
  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (!node?.id) continue;
    map.set(node.id, node);
    if (node.type === 'folder') flattenPromptTree(node.children, map);
  }
  return map;
}
function promptParentMap(nodes, parentId = null, map = new Map()) {
  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (!node?.id) continue;
    map.set(node.id, parentId);
    if (node.type === 'folder') promptParentMap(node.children, node.id, map);
  }
  return map;
}

/** Combine sibling ordering constraints without letting one stale reorder
 * erase a compatible reorder or positioned insertion from the other lane.
 * Relations changed from the shared base are the structural intent; when both
 * lanes change the same pair, the current writer is the deterministic winner.
 * Local-only and current-only nodes contribute all of their lane relations. */
function mergePromptOrder(baseIds, localIds, currentIds, resultIds) {
  const baseIndex = new Map(baseIds.map((id, index) => [id, index]));
  const pairKey = (a, b) => [String(a), String(b)].sort().join('\u0000');
  const relation = (ids, a, b) => {
    const ai = ids.indexOf(a);
    const bi = ids.indexOf(b);
    if (ai < 0 || bi < 0 || ai === bi) return 0;
    return ai < bi ? -1 : 1;
  };
  const changedPairs = (ids) => {
    const changed = new Set();
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const a = ids[i];
        const b = ids[j];
        if (!baseIndex.has(a) || !baseIndex.has(b)) continue;
        const baseRelation = baseIndex.get(a) < baseIndex.get(b) ? -1 : 1;
        if (relation(ids, a, b) !== baseRelation) changed.add(pairKey(a, b));
      }
    }
    return changed;
  };
  const localChanged = changedPairs(localIds);
  const currentChanged = changedPairs(currentIds);
  const baseSet = new Set(baseIds);
  const adjacency = new Map(resultIds.map((id) => [id, new Set()]));
  const addEdge = (from, to) => {
    if (from !== to && adjacency.has(from) && adjacency.has(to)) adjacency.get(from).add(to);
  };
  for (let i = 0; i < resultIds.length; i += 1) {
    for (let j = i + 1; j < resultIds.length; j += 1) {
      const a = resultIds[i];
      const b = resultIds[j];
      const baseRelation = baseSet.has(a) && baseSet.has(b)
        ? (baseIndex.get(a) < baseIndex.get(b) ? -1 : 1) : 0;
      const localRelation = relation(localIds, a, b);
      const currentRelation = relation(currentIds, a, b);
      const key = pairKey(a, b);
      const localIntent = localRelation && (baseRelation === 0 || localChanged.has(key));
      const currentIntent = currentRelation && (baseRelation === 0 || currentChanged.has(key));
      const winner = currentIntent ? currentRelation : localIntent ? localRelation : baseRelation;
      if (winner < 0) addEdge(a, b);
      else if (winner > 0) addEdge(b, a);
    }
  }
  const rank = (id) => {
    const local = localIds.indexOf(id);
    if (local >= 0) return local;
    const current = currentIds.indexOf(id);
    if (current >= 0) return localIds.length + current;
    return localIds.length + currentIds.length + (baseIndex.get(id) ?? resultIds.length);
  };
  const remaining = new Set(resultIds);
  const indegree = new Map(resultIds.map((id) => [id, 0]));
  for (const [from, targets] of adjacency) for (const to of targets) indegree.set(to, indegree.get(to) + 1);
  const ordered = [];
  while (remaining.size) {
    let next = [...remaining].filter((id) => indegree.get(id) === 0).sort((a, b) => rank(a) - rank(b))[0];
    if (next == null) {
      // Conflicting same-node moves can form a cycle. Drop the lowest-priority
      // incoming constraints for the stable lane winner rather than dropping
      // an entire sibling collection.
      next = [...remaining].sort((a, b) => rank(a) - rank(b))[0];
      for (const [from, targets] of adjacency) {
        if (!remaining.has(from)) continue;
        if (targets.delete(next)) indegree.set(next, indegree.get(next) - 1);
      }
    }
    remaining.delete(next);
    ordered.push(next);
    for (const to of adjacency.get(next)) indegree.set(to, indegree.get(to) - 1);
  }
  return ordered;
}

function mergePromptTree(baseValue, localValue, currentValue, global = null, parentId = null) {
  const base = Array.isArray(baseValue) ? baseValue : [];
  const local = Array.isArray(localValue) ? localValue : [];
  const current = Array.isArray(currentValue) ? currentValue : [];
  const baseGlobal = global?.base ?? flattenPromptTree(base);
  const localGlobal = global?.local ?? flattenPromptTree(local);
  const currentGlobal = global?.current ?? flattenPromptTree(current);
  const baseParents = global?.baseParents ?? promptParentMap(base);
  const localParents = global?.localParents ?? promptParentMap(local);
  const currentParents = global?.currentParents ?? promptParentMap(current);
  const baseById = new Map(base.map((node) => [node?.id, node]));
  const localById = new Map(local.map((node) => [node?.id, node]));
  const currentById = new Map(current.map((node) => [node?.id, node]));
  const mergeNode = (baseNode, localNode, currentNode) => {
    if (!localNode) return null;
    if (baseNode && !currentNode && !currentGlobal.has(baseNode.id)) return null;
    if (!baseNode) {
      const historicalBase = baseGlobal.get(localNode.id);
      const historicalCurrent = currentGlobal.get(localNode.id);
      if (historicalBase && historicalCurrent) return mergeNode(historicalBase, localNode, historicalCurrent);
      if (historicalBase && !historicalCurrent) return null;
      return historicalCurrent ?? localNode;
    }
    if (sameJson(localNode, baseNode)
      && !(localNode.type === 'folder' && currentNode?.type === 'folder'
        && !sameJson(localNode.children, currentNode.children))) return currentNode ?? localNode;
    if (localNode.type === 'folder' && currentNode?.type === 'folder') {
      const scalarChanges = Object.fromEntries(Object.keys(localNode)
        .filter((key) => key !== 'children' && !sameJson(localNode[key], baseNode[key]))
        .map((key) => [key, localNode[key]]));
      return {
        ...currentNode,
        ...scalarChanges,
        children: mergePromptTree(baseNode.children, localNode.children, currentNode.children, {
          base: baseGlobal, local: localGlobal, current: currentGlobal,
          baseParents, localParents, currentParents,
        }, localNode.id),
      };
    }
    const fieldChanges = Object.fromEntries(Object.keys(localNode)
      .filter((key) => key !== 'id' && !sameJson(localNode[key], baseNode[key]))
      .map((key) => [key, localNode[key]]));
    return { ...(currentNode ?? {}), ...fieldChanges, id: localNode.id, type: localNode.type };
  };
  const result = [];
  for (const currentNode of current) {
    const id = currentNode?.id;
    if (!localById.has(id)) {
      // A node created only by the current writer must survive a concurrent
      // reorder/insert. Nodes that the local snapshot moved away or deleted
      // are handled from their destination/source collection instead.
      if (baseById.has(id)) continue;
      // A local identity deletion is global, not a parent-local absence. It
      // must beat a stale current move that would otherwise look like a new
      // destination-only node.
      if (baseGlobal.has(id) && !localGlobal.has(id)) continue;
      if (localGlobal.has(id)) {
        const localMoved = localParents.get(id) !== baseParents.get(id);
        const currentMoved = currentParents.get(id) !== baseParents.get(id);
        if (localMoved && currentMoved && localParents.get(id) !== currentParents.get(id)) continue;
        // The current writer may have relocated this identity into a sibling
        // collection while the local lane edited it in its old location. Use
        // the global stable-id copy here so the node (or whole subtree) is
        // installed exactly once at the current destination with local field
        // changes merged.
        const moved = mergeNode(baseGlobal.get(id), localGlobal.get(id), currentNode);
        if (moved) result.push(moved);
        continue;
      }
      result.push(currentNode);
      continue;
    }
    const merged = mergeNode(baseById.get(id), localById.get(id), currentNode);
    if (merged) result.push(merged);
  }
  for (const localNode of local) {
    const id = localNode?.id;
    if (id == null || currentById.has(id) || baseById.has(id)) continue;
    const mergedLocal = mergeNode(baseGlobal.get(id), localNode, currentGlobal.get(id));
    if (mergedLocal) result.push(mergedLocal);
  }
  // Merge stable ordering constraints from both lanes. This preserves local
  // positioned inserts/reorders alongside compatible current moves/inserts,
  // while resolving a conflicting same-pair move deterministically.
  const resultById = new Map(result.map((node) => [node?.id, node]));
  const resultIds = result.map((node) => node?.id);
  const localIds = local.map((node) => node?.id);
  const baseIds = base.map((node) => node?.id);
  const currentIds = current.map((node) => node?.id);
  return mergePromptOrder(baseIds, localIds, currentIds, resultIds).map((id) => resultById.get(id));
}

function mergeKeyedArray(baseValue, localValue, currentValue) {
  const base = Array.isArray(baseValue) ? baseValue : [];
  const local = Array.isArray(localValue) ? localValue : [];
  const current = Array.isArray(currentValue) ? currentValue : [];
  const baseById = new Map(base.map((item) => [item?.id, item]));
  const localById = new Map(local.map((item) => [item?.id, item]));
  const currentById = new Map(current.map((item) => [item?.id, item]));
  const result = [];
  for (const currentItem of current) {
    const id = currentItem?.id;
    if (baseById.has(id) && !localById.has(id)) continue;
    const localItem = localById.get(id);
    if (!localItem || !baseById.has(id) || sameJson(localItem, baseById.get(id))) {
      result.push(currentItem);
      continue;
    }
    const mergedItem = {
      ...currentItem,
      ...Object.fromEntries(Object.keys(localItem)
        .filter((key) => key !== 'id' && key !== 'placements' && key !== 'arrangement'
          && !sameJson(localItem[key], baseById.get(id)?.[key]))
        .map((key) => [key, localItem[key]])),
      ...(Array.isArray(localItem.placements) ? {
        placements: mergeKeyedArray(baseById.get(id)?.placements, localItem.placements, currentItem.placements),
      } : {}),
      ...(localItem.arrangement?.members && currentItem.arrangement?.members ? {
        arrangement: {
          ...currentItem.arrangement,
          members: mergeKeyedArray(
            baseById.get(id)?.arrangement?.members,
            localItem.arrangement.members,
            currentItem.arrangement.members,
          ),
        },
      } : {}),
    };
    for (const key of Object.keys(baseById.get(id) ?? {})) {
      if (key !== 'id' && !Object.prototype.hasOwnProperty.call(localItem, key)
        && Object.prototype.hasOwnProperty.call(currentItem, key)) delete mergedItem[key];
    }
    result.push(mergedItem);
  }
  for (const localItem of local) {
    const id = localItem?.id;
    if (id == null || currentById.has(id) || baseById.has(id)) continue;
    result.push(localItem);
  }
  return result;
}

function mergeSetArray(baseValue, localValue, currentValue) {
  const base = Array.isArray(baseValue) ? baseValue : [];
  const local = Array.isArray(localValue) ? localValue : [];
  const current = Array.isArray(currentValue) ? currentValue : [];
  const removed = new Set(base.filter((id) => !local.includes(id)));
  const result = current.filter((id) => !removed.has(id));
  for (const id of local) if (!base.includes(id) && !result.includes(id)) result.push(id);
  return result;
}

function mergeItemSet(baseItem, localItem, currentItem) {
  if (!currentItem) return null;
  if (!baseItem || sameJson(localItem, baseItem)) return currentItem;
  const result = { ...currentItem };
  for (const key of ['itemIds', 'memberIds', 'excludedIds']) {
    if (Array.isArray(localItem[key])) {
      result[key] = mergeSetArray(baseItem[key], localItem[key], currentItem[key]);
    } else if (!sameJson(localItem[key], baseItem[key])) {
      result[key] = localItem[key];
    }
  }
  for (const key of Object.keys(localItem)) {
    if (key === 'id' || key === 'itemIds' || key === 'memberIds' || key === 'excludedIds') continue;
    if (!sameJson(localItem[key], baseItem[key])) result[key] = localItem[key];
  }
  for (const key of Object.keys(baseItem)) {
    if (key !== 'id' && !Object.prototype.hasOwnProperty.call(localItem, key)
      && Object.prototype.hasOwnProperty.call(currentItem, key)) delete result[key];
  }
  return result;
}

const LOCAL_VIEW_KEYS = Object.freeze([
  'currentGroupId',
  'graphExpandedGroupIds',
  'trailExpandedByContext',
  'selectedItemIds',
  'binMode',
]);

/** Remove this surface's navigation/session fallback from a forwarded board
 * snapshot. Those fields are useful when reopening a single surface, but are
 * not shared document actions and must never make another window jump folders
 * or inherit its selection. */
function stripLocalViewFields(serialized, baseSerialized) {
  if (typeof baseSerialized !== 'string') return serialized;
  try {
    const local = JSON.parse(serialized);
    const base = JSON.parse(baseSerialized);
    if (!isPlainObject(local?.view) || !isPlainObject(base?.view)) return serialized;
    const view = { ...local.view };
    for (const key of LOCAL_VIEW_KEYS) {
      if (Object.prototype.hasOwnProperty.call(base.view, key)) view[key] = base.view[key];
      else delete view[key];
    }
    return JSON.stringify({ ...local, view });
  } catch {
    return serialized;
  }
}

/** Merge a view's action snapshot onto the writer's current snapshot. Entity
 * collections are merged by stable id so two windows cannot erase unrelated
 * edits. View/position maps intentionally use last-writer-wins: a later drag
 * is the authoritative placement. */
export function mergeSurfaceSnapshots(base, local, current) {
  if (!isPlainObject(base) || !isPlainObject(local) || !isPlainObject(current)) return local;
  const merged = { ...current };
  for (const key of ['groups', 'shortcuts', 'windowLayouts']) {
    if (!Array.isArray(local[key]) || !Array.isArray(current[key])) continue;
    const baseItems = new Map((Array.isArray(base[key]) ? base[key] : []).map((item) => [item?.id, item]));
    const localItems = new Map(local[key].map((item) => [item?.id, item]));
    const currentItems = new Map(current[key].map((item) => [item?.id, item]));
    const result = [...current[key]];
    const index = new Map(result.map((item, i) => [item?.id, i]));
    for (const [id, localItem] of localItems) {
      if (id == null) continue;
      const baseItem = baseItems.get(id);
      const currentItem = currentItems.get(id);
      if (!baseItems.has(id) || !sameJson(localItem, baseItem)) {
        if (!currentItems.has(id)) {
          // A deletion in the current authoritative lane wins over a stale
          // edit; do not resurrect the pre-delete identity.
          if (baseItems.has(id)) continue;
          index.set(id, result.length);
          result.push(localItem);
        } else if (!sameJson(currentItem, localItem)) {
          const mergedItem = {
            ...currentItem,
            ...Object.fromEntries(Object.keys(localItem)
              .filter((key) => key !== 'id' && key !== 'placements' && key !== 'arrangement'
                && !sameJson(localItem[key], baseItem?.[key]))
              .map((key) => [key, localItem[key]])),
          };
          for (const key of Object.keys(baseItem ?? {})) {
            if (key !== 'id' && !Object.prototype.hasOwnProperty.call(localItem, key)
              && Object.prototype.hasOwnProperty.call(currentItem, key)) delete mergedItem[key];
          }
          if (Array.isArray(localItem.placements)) {
            mergedItem.placements = mergeKeyedArray(baseItem?.placements, localItem.placements, currentItem.placements);
          }
          if (localItem.arrangement?.members && currentItem.arrangement?.members) {
            mergedItem.arrangement = {
              ...currentItem.arrangement,
              members: mergeKeyedArray(
                baseItem?.arrangement?.members,
                localItem.arrangement.members,
                currentItem.arrangement.members,
              ),
            };
          }
          result[index.get(id)] = mergedItem;
        }
      }
    }
    const deleted = new Set([...baseItems.keys()].filter((id) => !localItems.has(id) && currentItems.has(id)));
    merged[key] = result.filter((item) => !deleted.has(item?.id));
  }
  const baseView = isPlainObject(base.view) ? base.view : {};
  const localView = isPlainObject(local.view) ? local.view : {};
  const currentView = isPlainObject(current.view) ? current.view : {};
  const view = { ...currentView };
  for (const [key, value] of Object.entries(localView)) {
    if (key === 'graphPositions' || key === 'graphRestPositions' || key === 'toolbarPositions') {
      if (!sameJson(value, baseView[key])) {
        view[key] = mergePositionMap(
          baseView[key],
          value,
          currentView[key],
          key !== 'toolbarPositions',
        );
      }
    } else if (key === 'itemSets' && Array.isArray(value) && Array.isArray(currentView[key])) {
      // Sets are document semantics stored under view; merge independent set
      // IDs instead of replacing the whole collection on a stale snapshot.
      const baseSets = Array.isArray(baseView[key]) ? baseView[key] : [];
      const baseById = new Map(baseSets.map((item) => [item?.id, item]));
      const localById = new Map(value.map((item) => [item?.id, item]));
      const currentById = new Map(currentView[key].map((item) => [item?.id, item]));
      const mergedSets = [...currentView[key]];
      const indexes = new Map(mergedSets.map((item, index) => [item?.id, index]));
      for (const [id, item] of localById) {
        if (id == null) continue;
        if (!baseById.has(id)) {
          if (!currentById.has(id)) { indexes.set(id, mergedSets.length); mergedSets.push(item); }
        } else if (!sameJson(item, baseById.get(id))) {
          if (currentById.has(id)) mergedSets[indexes.get(id)] = mergeItemSet(baseById.get(id), item, currentById.get(id));
          else { /* current deletion wins over a stale set edit */ }
        }
      }
      const deletedSetIds = new Set([...baseById.keys()].filter((id) => !localById.has(id)));
      view[key] = mergedSets.filter((item) => !deletedSetIds.has(item?.id));
    } else if (key === 'promptLibrary' && Array.isArray(value)) {
      view[key] = mergePromptTree(baseView[key], value, currentView[key]);
    } else if (!sameJson(value, baseView[key])) {
      view[key] = value;
    }
  }
  merged.view = view;
  if (!sameJson(local.activeWindowLayoutId, base.activeWindowLayoutId)) {
    merged.activeWindowLayoutId = local.activeWindowLayoutId;
  }
  return merged;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The default lock adapter: a real Web Lock held for as long as this surface
 * is the writer. `navigator.locks.request` keeps the lock until the callback's
 * promise settles, so the callback parks on a promise that is resolved by
 * release(). A surface that dies never resolves it and the browser reclaims
 * the lock — which is the whole reason for using it.
 */
export function webLockAdapter(navigatorRef) {
  return {
    available: Boolean(navigatorRef && navigatorRef.locks),
    request(name) {
      let release = () => {};
      const held = new Promise((resolveHeld, rejectHeld) => {
        const parked = new Promise((resolveParked) => { release = resolveParked; });
        let requestPromise;
        try {
          requestPromise = navigatorRef.locks.request(name, () => { resolveHeld({ release }); return parked; });
        } catch (error) {
          rejectHeld(error);
          return;
        }
        Promise.resolve(requestPromise).catch(rejectHeld);
      });
      return held;
    },
  };
}

/**
 * @param {object} options
 * @param {{ request(name: string): Promise<{ release(): void }> }} options.lock
 * @param {{ postMessage(value: unknown): void, addEventListener?: Function }} options.channel
 * @param {{ loadVersioned(): Promise<{ state: object, revision: string }>,
 *           saveChecked(state: object, revision: string): Promise<object> }} options.host
 * @param {(snapshot: object) => void} options.installDocument
 *        Installs a document WITHOUT touching this surface's navigation session.
 * @param {(snapshot: object) => void} [options.installExternalDocument]
 *        Installs a peer/external document and may invalidate local history.
 * @param {(snapshot: object, revision: string) => void} [options.onHydrated]
 * @param {(stage: string, code: string, revision?: string) => void} [options.onHydrationFailed]
 * @param {(role: string, detail: object) => void} [options.onRoleChange]
 * @param {() => string} [options.newClientId]
 */
export function createSurfaceCoordinator({
  lock,
  channel,
  host,
  installDocument,
  installExternalDocument = installDocument,
  onHydrated = () => {},
  onHydrationFailed = () => {},
  /** Abandons the store's queued saves and returns the newest serialized
   * snapshot of that generation. Called the moment a save is refused, so the
   * frozen "my version" is the creator's latest local work rather than
   * whichever snapshot happened to lose the race. */
  invalidatePendingSaves = () => null,
  onRoleChange = () => {},
  newClientId = () => `s-${Math.random().toString(36).slice(2, 10)}`,
}) {
  const clientId = newClientId();
  let role = SURFACE_ROLE.VIEW;
  let revision = null;
  /** The snapshot a refused save was carrying. Kept intact: it is the
   * creator's unsaved work and the only copy of it. */
  let frozenSnapshot = null;
  /** While an ownership handover is in flight elsewhere (the 018 detach
   * STOP -> ACTIVATE gap), an ordinary view must not be queued for the lock —
   * it could win the gap and become writer in the middle of the handshake. */
  let transferSuspended = false;
  let pendingAcquire = null;
  let held = null;
  let lastSerialized = null;
  let baselineReady = false;
  let baselinePromise = null;
  let conflictGeneration = null;
  // BroadcastChannel can deliver mutations from several views back-to-back.
  // Serialize them at the elected writer so each request rebases on the
  // revision committed immediately before it instead of racing two CAS calls
  // and silently dropping the loser.
  let mutationQueue = Promise.resolve();
  const ackEnabled = typeof channel?.addEventListener === 'function';
  let requestSequence = 0;
  const pendingRequests = new Map();
  const pendingLocalSnapshots = [];
  const appliedRequests = new Map();
  const inFlightRequests = new Set();
  const rememberApplied = (key, result) => {
    if (!key) return;
    appliedRequests.set(key, result);
    while (appliedRequests.size > 512) appliedRequests.delete(appliedRequests.keys().next().value);
  };
  function overlayPendingSnapshots(serialized) {
    if (!pendingLocalSnapshots.length) return serialized;
    try {
      let merged = JSON.parse(serialized);
      const pendingInOrder = [...pendingLocalSnapshots].sort((left, right) => {
        const leftSequence = Number.isFinite(left.sequence) ? left.sequence : Number.MAX_SAFE_INTEGER;
        const rightSequence = Number.isFinite(right.sequence) ? right.sequence : Number.MAX_SAFE_INTEGER;
        return leftSequence - rightSequence;
      });
      for (const pending of pendingInOrder) {
        merged = mergeSurfaceSnapshots(
          JSON.parse(pending.baseSerialized ?? serialized),
          JSON.parse(pending.serialized),
          merged,
        );
      }
      return JSON.stringify(merged);
    } catch {
      return serialized;
    }
  }
  function installExternalPreservingPending(decoded) {
    const preserved = JSON.parse(overlayPendingSnapshots(JSON.stringify(decoded)));
    installExternalDocument(preserved, JSON.stringify(decoded));
  }
  function registerQueuedHints(metadata) {
    for (const hint of Array.isArray(metadata?.pendingSnapshots) ? metadata.pendingSnapshots : []) {
      if (typeof hint?.serialized !== 'string') continue;
      if (!pendingLocalSnapshots.some((pending) => (
        Number.isFinite(hint.sequence) && Number.isFinite(pending.sequence)
          ? pending.sequence === hint.sequence
          : pending.serialized === hint.serialized && pending.baseSerialized === hint.baseSerialized
      ))) {
        pendingLocalSnapshots.push({ ...hint, queuedHint: true });
      }
    }
  }
  function clearPendingGeneration(generation) {
    if (generation == null) return;
    for (let index = pendingLocalSnapshots.length - 1; index >= 0; index -= 1) {
      if (pendingLocalSnapshots[index].generation === generation) pendingLocalSnapshots.splice(index, 1);
    }
  }
  function removePendingOverlay(pending) {
    const index = pendingLocalSnapshots.indexOf(pending);
    if (index >= 0) pendingLocalSnapshots.splice(index, 1);
  }
  function retireQueuedHint(sequence, serialized, baseSerialized) {
    for (let index = pendingLocalSnapshots.length - 1; index >= 0; index -= 1) {
      const pending = pendingLocalSnapshots[index];
      const sameIdentity = Number.isFinite(sequence) && Number.isFinite(pending.sequence)
        ? pending.sequence === sequence
        : pending.serialized === serialized && (baseSerialized == null || pending.baseSerialized === baseSerialized);
      if (pending.queuedHint && sameIdentity) pendingLocalSnapshots.splice(index, 1);
    }
  }

  function setRole(next, detail = {}) {
    if (role === next) return;
    role = next;
    onRoleChange(role, detail);
  }

  /** Every follower needs a versioned base before it can forward a durable
   * action; waiting for the writer lock is not a substitute for hydration. */
  async function ensureBaseline() {
    if (baselineReady) return;
    if (!baselinePromise) {
      const loadPromise = (async () => {
        let loaded;
        try {
          loaded = await host.loadVersioned();
        } catch (error) {
          onHydrationFailed('load', 'versioned-load-failed');
          throw error;
        }
        // A committed broadcast may have won the race while this load was in
        // flight. Never let the older load regress the already-installed base.
        if (baselineReady) return;
        try {
          installDocument(loaded.state);
        } catch (error) {
          onHydrationFailed('install', 'model-install-failed', loaded.revision);
          throw error;
        }
        revision = loaded.revision;
        lastSerialized = JSON.stringify(loaded.state);
        baselineReady = true;
      })();
      baselinePromise = loadPromise.catch((error) => {
        // A transient load/install failure must be retryable; otherwise one
        // rejected promise permanently bricks this surface until restart.
        baselinePromise = null;
        throw error;
      });
    }
    return baselinePromise;
  }

  /** Broadcast the exact bytes that were committed. Views decode these; a
   * second representation built alongside the save could differ from what is
   * actually on disk. */
  function publish(serialized, atRevision, requestId = null) {
    lastSerialized = serialized;
    channel.postMessage({
      type: SNAPSHOT_MESSAGE,
      clientId,
      revision: atRevision,
      serialized,
      ...(requestId ? { requestId } : {}),
    });
  }

  async function becomeWriter() {
    let loaded;
    try {
      loaded = await host.loadVersioned();
    } catch (error) {
      onHydrationFailed('load', 'versioned-load-failed');
      throw error;
    }
    // The lock may have been won after another writer committed, so the disk
    // is read BEFORE this surface is allowed to write. Never inherit a
    // revision observed before waiting.
    try {
      installExternalPreservingPending(loaded.state);
    } catch (error) {
      onHydrationFailed('install', 'model-install-failed', loaded.revision);
      throw error;
    }
    revision = loaded.revision;
    lastSerialized = JSON.stringify(loaded.state);
    baselineReady = true;
    onHydrated(loaded.state, revision);
    setRole(SURFACE_ROLE.WRITER, { revision });
    // Any follower mutations that were awaiting the old writer's ACK remain
    // recoverable across promotion. Replay them in request order against the
    // freshly hydrated authoritative base instead of silently discarding the
    // optimistic work on the promotion install.
    for (const [requestId, pending] of pendingRequests) {
      mutationQueue = mutationQueue.then(async () => {
        try {
          if (pending.revision !== revision) {
            pending.resolve({ ok: false, code: 'PROMOTION_REPLAY_AMBIGUOUS' });
            return;
          }
          const current = lastSerialized ? JSON.parse(lastSerialized) : loaded.state;
          const incoming = JSON.parse(pending.serialized);
          const base = pending.baseSerialized ? JSON.parse(pending.baseSerialized) : current;
          const decoded = mergeSurfaceSnapshots(base, incoming, current);
          const payload = JSON.stringify(decoded);
          const result = await host.saveChecked(payload, revision);
          if (!result || result.ok !== true) {
            pending.resolve({ ok: false, code: 'PROMOTION_REPLAY_REFUSED' });
            return;
          }
          removePendingOverlay(pending.localPending);
          const visible = JSON.parse(overlayPendingSnapshots(payload));
          installDocument(visible, payload);
          revision = result.revision;
          lastSerialized = payload;
          publish(payload, revision);
          pending.resolve({ ok: true, revision });
        } catch {
          pending.resolve({ ok: false, code: 'PROMOTION_REPLAY_FAILED' });
        } finally {
          removePendingOverlay(pending.localPending);
          clearTimeout(pending.timer);
          pendingRequests.delete(requestId);
        }
      });
    }
    return loaded;
  }

  return {
    get role() { return role; },
    get revision() { return revision; },
    get clientId() { return clientId; },
    get baselineReady() { return baselineReady; },
    get frozen() { return frozenSnapshot; },
    get transferSuspended() { return transferSuspended; },
    retirePendingGeneration(generation) { clearPendingGeneration(generation); },

    /**
     * Queue for write ownership. Resolves when this surface becomes the
     * writer, which may be immediately or when the current writer goes away.
     *
     * `designated` is the surface a detach handoff is transferring ownership
     * TO. It is the one surface allowed through a reservation, because the
     * reservation exists to keep everyone ELSE out of the queue until the
     * handoff completes.
     */
    async start({ designated = false } = {}) {
      if (transferSuspended && !designated) return null;
      if (pendingAcquire) return pendingAcquire;
      pendingAcquire = (async () => {
        await ensureBaseline();
        held = await lock.request(SURFACE_DOCUMENT_LOCK);
        try {
          return await becomeWriter();
        } catch (error) {
          // A failed post-lock load/install must not strand the Web Lock and
          // prevent every other surface from recovering ownership.
          held?.release?.();
          held = null;
          setRole(SURFACE_ROLE.VIEW, {});
          throw error;
        }
      })();
      try {
        return await pendingAcquire;
      } finally {
        pendingAcquire = null;
      }
    },

    /**
     * Save the board. The store owns serialization and ordering, so the
     * already-serialized snapshot arrives here as-is and is never decoded and
     * re-encoded on the way to disk.
     *
     * Only the writer may save; a view reaching here is a caller bug, not a
     * race to resolve.
     */
    async saveSerialized(serialized, metadata = {}) {
      registerQueuedHints(metadata);
      if (role === SURFACE_ROLE.VIEW) {
        // Views may edit optimistically. The elected writer serializes their
        // request and broadcasts the committed result back to every surface.
        // This keeps ordinary document actions usable from every window while
        // retaining one durable writer and CAS protection.
        if (!baselineReady) await ensureBaseline();
        const baseSerialized = typeof metadata.baseSerialized === 'string'
          ? metadata.baseSerialized : lastSerialized;
        serialized = stripLocalViewFields(serialized, baseSerialized);
        if (baseSerialized && sameJson(serialized, baseSerialized)) {
          retireQueuedHint(metadata.sequence, serialized, baseSerialized);
          return { ok: true, forwarded: true, unchanged: true, revision };
        }
        const requestId = ackEnabled ? `${clientId}:${++requestSequence}` : null;
        let acknowledgement = null;
        if (requestId) {
          acknowledgement = new Promise((resolve) => {
          const localPending = { serialized, baseSerialized, generation: metadata.generation, sequence: metadata.sequence };
          const hintIndex = pendingLocalSnapshots.findIndex((pending) => pending.queuedHint
            && (Number.isFinite(metadata.sequence) && Number.isFinite(pending.sequence)
              ? pending.sequence === metadata.sequence
              : pending.serialized === serialized && pending.baseSerialized === baseSerialized));
          if (hintIndex >= 0) pendingLocalSnapshots.splice(hintIndex, 1);
          pendingLocalSnapshots.push(localPending);
          const timer = setTimeout(() => {
            if (!pendingRequests.delete(requestId)) return;
            const pendingIndex = pendingLocalSnapshots.indexOf(localPending);
            if (pendingIndex >= 0) pendingLocalSnapshots.splice(pendingIndex, 1);
            onHydrationFailed('mutation', 'writer-ack-timeout', revision ?? undefined);
            resolve({ ok: false, code: 'WRITER_ACK_TIMEOUT' });
          }, 30000);
          timer.unref?.();
          pendingRequests.set(requestId, { timer, resolve, serialized, baseSerialized, revision, localPending });
          });
        }
        const message = {
          type: MUTATION_MESSAGE,
          clientId,
          revision,
          serialized,
          baseSerialized,
        };
        if (requestId) message.requestId = requestId;
        channel.postMessage(message);
        const forwarded = { ok: true, forwarded: true, revision };
        if (acknowledgement) Object.defineProperty(forwarded, 'acknowledgement', {
          value: acknowledgement,
          enumerable: false,
        });
        return forwarded;
      }
      if (role !== SURFACE_ROLE.WRITER) throw new Error('This surface is not the writer and may not save the board.');
      const baseSerialized = typeof metadata.baseSerialized === 'string'
        ? metadata.baseSerialized : lastSerialized;
      serialized = stripLocalViewFields(serialized, baseSerialized);
      if (lastSerialized && sameJson(serialized, lastSerialized)) {
        retireQueuedHint(metadata.sequence, serialized, baseSerialized);
        return { ok: true, revision, unchanged: true };
      }
      const localPending = { serialized, baseSerialized, generation: metadata.generation, sequence: metadata.sequence };
      const hintIndex = pendingLocalSnapshots.findIndex((pending) => pending.queuedHint
        && (Number.isFinite(metadata.sequence) && Number.isFinite(pending.sequence)
          ? pending.sequence === metadata.sequence
          : pending.serialized === serialized && pending.baseSerialized === baseSerialized));
      if (hintIndex >= 0) pendingLocalSnapshots.splice(hintIndex, 1);
      pendingLocalSnapshots.push(localPending);
      mutationQueue = mutationQueue
        .catch(() => undefined)
        .then(async () => {
          let payload = serialized;
          if (baseSerialized && lastSerialized && !sameJson(baseSerialized, lastSerialized)) {
            try {
              payload = JSON.stringify(mergeSurfaceSnapshots(
                JSON.parse(baseSerialized),
                JSON.parse(serialized),
                JSON.parse(lastSerialized),
              ));
            } catch {
              payload = serialized;
            }
          }
          const result = await host.saveChecked(payload, revision);
          if (result && result.ok === true) {
            revision = result.revision;
            lastSerialized = payload;
            const pendingIndex = pendingLocalSnapshots.indexOf(localPending);
            if (pendingIndex >= 0) pendingLocalSnapshots.splice(pendingIndex, 1);
            try { installDocument(JSON.parse(overlayPendingSnapshots(payload)), payload); } catch { /* host bytes are already committed */ }
            publish(payload, revision);
            return { ok: true, revision, serialized: payload };
          }
          // Fail closed, synchronously enough that no further durable mutation
          // is accepted: the role changes before this returns. Queued saves from
          // the same generation are abandoned without ever reaching persistence,
          // and the newest of them becomes the version the creator is offered.
          conflictGeneration = metadata.generation;
          clearPendingGeneration(conflictGeneration);
          const latestLocal = invalidatePendingSaves();
          frozenSnapshot = typeof latestLocal === 'string' ? latestLocal : payload;
          setRole(SURFACE_ROLE.CONFLICT, { revision: result && result.revision });
          return { ok: false, code: 'STALE_REVISION' };
        })
        .finally(() => {
          const pendingIndex = pendingLocalSnapshots.indexOf(localPending);
          if (pendingIndex >= 0) pendingLocalSnapshots.splice(pendingIndex, 1);
        });
      return mutationQueue;
    },

    /** Conflict recovery: abandon this surface's unsaved version. */
    async useLatest() {
      if (role !== SURFACE_ROLE.CONFLICT) throw new Error('There is no conflict to resolve.');
      clearPendingGeneration(conflictGeneration);
      let loaded;
      try {
        loaded = await host.loadVersioned();
      } catch (error) {
        onHydrationFailed('load', 'versioned-load-failed');
        throw error;
      }
      try {
        installExternalDocument(loaded.state);
      } catch (error) {
        onHydrationFailed('install', 'model-install-failed', loaded.revision);
        throw error;
      }
      revision = loaded.revision;
      lastSerialized = JSON.stringify(loaded.state);
      baselineReady = true;
      frozenSnapshot = null;
      conflictGeneration = null;
      onHydrated(loaded.state, revision);
      setRole(SURFACE_ROLE.WRITER, { revision });
      return loaded;
    },

    /**
     * Conflict recovery: keep this surface's version, replacing what was saved
     * elsewhere. Destructive, so the caller must confirm with the creator
     * first. Re-reads only to obtain the current revision — if that save is
     * refused too, the surface stays frozen rather than retrying, because a
     * loop here would be an unbounded fight with another live writer.
     */
    async keepMine() {
      if (role !== SURFACE_ROLE.CONFLICT) throw new Error('There is no conflict to resolve.');
      clearPendingGeneration(conflictGeneration);
      const loaded = await host.loadVersioned();
      const serialized = stripLocalViewFields(frozenSnapshot, JSON.stringify(loaded.state));
      const result = await host.saveChecked(serialized, loaded.revision);
      if (result && result.ok === true) {
        revision = result.revision;
        lastSerialized = serialized;
        frozenSnapshot = null;
        conflictGeneration = null;
        publish(serialized, revision);
        setRole(SURFACE_ROLE.WRITER, { revision });
        return { ok: true, revision };
      }
      return { ok: false, code: 'STALE_REVISION' };
    },

    /** A committed snapshot from the writer. Views follow it; the writer
     * ignores its own echo, and a frozen surface ignores everything — its
     * unsaved work must not be overwritten behind the creator's back. */
    receive(message) {
      if (!isPlainObject(message) || typeof message.clientId !== 'string' || message.clientId === clientId) return false;
      if (message.type === MUTATION_MESSAGE) {
        if (role !== SURFACE_ROLE.WRITER || typeof message.serialized !== 'string') return false;
        const requestKey = typeof message.requestId === 'string'
          ? `${message.clientId}:${message.requestId}` : null;
        if (requestKey && inFlightRequests.has(requestKey)) return true;
        const hasPrior = requestKey ? appliedRequests.has(requestKey) : false;
        const prior = requestKey ? appliedRequests.get(requestKey) : null;
        if (hasPrior) {
          if (prior) channel.postMessage({
              type: MUTATION_ACK_MESSAGE,
              clientId,
              ackClientId: message.clientId,
              requestId: message.requestId,
              ok: prior.ok,
              revision: prior.revision,
              code: prior.code,
            });
          return true;
        }
        // Mark before queueing so duplicate delivery while this request is
        // still in flight cannot schedule a second durable save. The first
        // execution will emit the one correlated acknowledgement.
        if (requestKey) inFlightRequests.add(requestKey);
        mutationQueue = mutationQueue
          .catch(() => undefined)
          .then(async () => {
            let serialized = message.serialized;
            try {
              const incoming = JSON.parse(message.serialized);
              let decoded = incoming;
              const base = typeof message.baseSerialized === 'string'
                ? JSON.parse(message.baseSerialized)
                : null;
              const current = lastSerialized ? JSON.parse(lastSerialized) : null;
              if (base && current && (message.revision !== revision || !sameJson(base, current))) {
                decoded = mergeSurfaceSnapshots(base, incoming, current);
                serialized = JSON.stringify(decoded);
              }
              let result = await host.saveChecked(serialized, revision);
              if (!result || result.ok !== true) {
                // An external writer may have advanced the opaque host revision
                // despite our Web Lock. Reload, rebase this same request once,
                // and retry; never discard a queued peer action merely because
                // the first CAS observed a stale revision.
                const latest = await host.loadVersioned();
                installExternalPreservingPending(latest.state);
                revision = latest.revision;
                lastSerialized = JSON.stringify(latest.state);
                decoded = base
                  ? mergeSurfaceSnapshots(base, incoming, latest.state)
                  : incoming;
                serialized = JSON.stringify(decoded);
                result = await host.saveChecked(serialized, revision);
              }
              if (!result || result.ok !== true) {
                onHydrationFailed('mutation', 'remote-save-stale', revision ?? undefined);
                if (requestKey) {
                  const failed = { ok: false, code: 'STALE_REVISION', revision };
                  inFlightRequests.delete(requestKey);
                  rememberApplied(requestKey, failed);
                  channel.postMessage({ type: MUTATION_ACK_MESSAGE, clientId, ackClientId: message.clientId, requestId: message.requestId, ...failed });
                }
                return;
              }
              installExternalPreservingPending(decoded);
              revision = result.revision;
              lastSerialized = serialized;
              publish(serialized, revision, message.requestId);
              if (requestKey) {
                const committed = { ok: true, revision };
                inFlightRequests.delete(requestKey);
                rememberApplied(requestKey, committed);
                channel.postMessage({ type: MUTATION_ACK_MESSAGE, clientId, ackClientId: message.clientId, requestId: message.requestId, ...committed });
              }
            } catch {
              onHydrationFailed('mutation', 'remote-save-failed', revision ?? undefined);
              if (requestKey) {
                const failed = { ok: false, code: 'REMOTE_SAVE_FAILED', revision };
                inFlightRequests.delete(requestKey);
                rememberApplied(requestKey, failed);
                channel.postMessage({ type: MUTATION_ACK_MESSAGE, clientId, ackClientId: message.clientId, requestId: message.requestId, ...failed });
              }
            }
          });
        return true;
      }
      if (message.type === MUTATION_ACK_MESSAGE) {
        if (message.ackClientId !== clientId || typeof message.requestId !== 'string') return false;
        const pending = pendingRequests.get(message.requestId);
        if (!pending) return false;
        clearTimeout(pending.timer);
        pendingRequests.delete(message.requestId);
        const pendingIndex = pendingLocalSnapshots.indexOf(pending.localPending);
        if (pendingIndex >= 0) pendingLocalSnapshots.splice(pendingIndex, 1);
        pending.resolve({
          ok: message.ok === true,
          revision: message.revision,
          ...(message.ok === true ? {} : { code: message.code ?? 'REMOTE_MUTATION_FAILED' }),
        });
        return true;
      }
      if (message.type !== SNAPSHOT_MESSAGE) return false;
      if (role !== SURFACE_ROLE.VIEW) return false;
      if (typeof message.revision !== 'string' || typeof message.serialized !== 'string') return false;
      let decoded;
      try {
        decoded = JSON.parse(message.serialized);
      } catch {
        onHydrationFailed('decode', 'broadcast-json-invalid', message.revision);
        // A malformed broadcast is ignored rather than installed: a view must
        // never replace a good document with something it could not read.
        return false;
      }
      if (!isPlainObject(decoded)) {
        onHydrationFailed('decode', 'broadcast-state-invalid', message.revision);
        return false;
      }
      try {
        installExternalPreservingPending(decoded);
      } catch {
        onHydrationFailed('install', 'model-install-failed', message.revision);
        return false;
      }
      if (typeof message.requestId === 'string') {
        const pending = pendingRequests.get(message.requestId);
        if (pending) {
          clearTimeout(pending.timer);
          pendingRequests.delete(message.requestId);
          const pendingIndex = pendingLocalSnapshots.indexOf(pending.localPending);
          if (pendingIndex >= 0) pendingLocalSnapshots.splice(pendingIndex, 1);
          pending.resolve({ ok: true, revision: message.revision, via: 'committed-broadcast' });
        }
      }
      revision = message.revision;
      lastSerialized = message.serialized;
      baselineReady = true;
      onHydrated(decoded, revision);
      return true;
    },

    /**
     * 018 seam. DORMANT, deliberately kept.
     *
     * The legacy full-surface detach is retired from reachability -- see the
     * `windowLayoutDetachment` stub in the entry file, where mode is always
     * 'workspace'. Detach now opens the compact widget, which never writes the
     * store, so the ownership race this seam exists for cannot occur on the
     * live path. It is not wired to anything, and its tests stand as the
     * specification rather than as coverage of a running path.
     *
     * INVARIANT: if full-surface ownership transfer is ever made reachable
     * again, it MUST integrate this coordinator before shipping -- reserve
     * before FLUSH, release only after the flush settles, designated
     * acquisition after ACTIVATE, and the mandatory versioned reload. Enabling
     * that path without this is the split brain the Web Lock exists to prevent.
     *
     * The handoff ordering it supports, in full:
     *
     *   reserveTransfer()      ordinary surfaces leave the election
     *   ...FLUSH settles...    the old writer still owns the lock, so its one
     *                          authorized final save is still valid
     *   release()              only now is the lock given up
     *   ...ACTIVATE...         the designated surface starts
     *   start({designated})    it, and only it, may take the lock
     *   (reload from disk)     mandatory, never from cached state
     *   completeTransfer()     ordinary surfaces may queue again
     *
     * The reservation must be taken BEFORE the flush, and must outlive the
     * release: releasing while ordinary surfaces are queued would turn the
     * handoff into a free-for-all that the designated surface could lose.
     */
    reserveTransfer() { transferSuspended = true; },

    /** The handoff finished — ownership reached the designated surface. */
    completeTransfer() { transferSuspended = false; },

    /**
     * The handoff failed. If it failed before release(), this surface still
     * owns the lock and simply keeps writing. If it failed after, nobody owns
     * it and the next surface to elect itself still reloads from disk first —
     * an aborted transfer never leaves anyone writable from cached state.
     */
    abortTransfer() { transferSuspended = false; },

    /** Give up write ownership. The lock is released, so a waiting surface
     * elects itself and reloads from disk before it may write. */
    release() {
      if (held) held.release();
      held = null;
      setRole(SURFACE_ROLE.VIEW, {});
    },
  };
}

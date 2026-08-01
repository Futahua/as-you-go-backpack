import { selectAllScope, inverseScope, addItemSet, setMembership } from '../sets-model.js';

/** Application command layer. Commands are the named user-intent operations
 * that coordinate session mutation, persistence, and narrow rendering/host
 * effects. They depend only on the store, model/host operations, and the
 * injected effect callbacks — never on UI components or browser events.
 * Event handlers and the menu map call these instead of orchestrating the
 * store inline. */
export function createWorkspaceCommands({
  store,
  group,
  shortcut,
  item,
  isWebLink,
  host,
  graph,
  resolveBinTargets,
  visiblePlacementIdFor,
  visibleParentCountFor,
  allActivePlacementIds,
  anyActivePlacementId,
  moveSelection,
  copySelection: copySelectionModel,
  collapsePlacements,
  binSelection,
  graphContextId,
  removeGraphPositions,
  setGraphPositions,
  setItemSets,
  createWebLink,
  createDroppedShortcuts,
  syncSelection,
  saveWorkspaceView,
  closeMenu,
  render,
  setStatus,
}) {
  /** Applies click / ctrl-click / shift-click selection rules. Takes plain
   * modifier flags and the ordered visible ids, not a DOM event. */
  function selectItem(itemId, { shiftKey, ctrlKey, visibleItemIds }) {
    const session = store.getSession();
    if (shiftKey && session.selectionAnchor) {
      const from = visibleItemIds.indexOf(session.selectionAnchor);
      const to = visibleItemIds.indexOf(itemId);
      if (from >= 0 && to >= 0) {
        if (!ctrlKey) store.clearSelection();
        const [start, end] = from < to ? [from, to] : [to, from];
        visibleItemIds.slice(start, end + 1).forEach((id) => store.addToSelection(id));
      }
    } else if (ctrlKey) {
      if (session.selected.has(itemId)) store.removeFromSelection(itemId);
      else store.addToSelection(itemId);
      store.setSelectionAnchor(itemId);
    } else {
      store.setSelection([itemId]);
      store.setSelectionAnchor(itemId);
    }
    syncSelection();
    saveWorkspaceView();
  }

  function clearSelection() {
    store.clearSelection();
    syncSelection();
    saveWorkspaceView();
  }

  /** Ctrl+A, scoped by sets: with a set picked (from the last clicked item)
   * only its members are selected; with none picked only setless items are,
   * so select-all outside a set never reaches inside one.
   *
   * The anchor is deliberately preserved — it is what picks the set, and
   * clearing it would make a second Ctrl+A silently widen its own scope. */
  function selectAllVisible(visibleItemIds) {
    const session = store.getSession();
    const sets = store.getSnapshot().view?.itemSets ?? [];
    store.setSelection(selectAllScope(sets, visibleItemIds, session.selectionAnchor));
    syncSelection();
    saveWorkspaceView();
  }

  /** G: groups the current selection into a new set. Sets may overlap, so
   * items already in another set keep that membership too. */
  async function groupSelectionIntoSet(title) {
    const ids = [...store.getSession().selected];
    if (ids.length === 0) return;
    const snapshot = store.getSnapshot();
    const next = addItemSet(snapshot.view?.itemSets ?? [], ids, title ? { title } : {});
    if (next === (snapshot.view?.itemSets ?? [])) return;
    try {
      await store.commit(setItemSets(snapshot, next));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  /** Ctrl+G: replaces which sets the selection belongs to. An empty setIds
   * regresses the items to setless, which is how something leaves every set.
   * Sets left with no members are dropped. */
  async function shareSelectionWithSets(setIds) {
    const ids = [...store.getSession().selected];
    if (ids.length === 0) return;
    const snapshot = store.getSnapshot();
    const current = snapshot.view?.itemSets ?? [];
    const next = setMembership(current, ids, setIds);
    if (next === current) return;
    try {
      await store.commit(setItemSets(snapshot, next));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  /** The folders Alt+click acts on: the select-all scope minus the current
   * selection. Collapses "select all, deselect a few, act" into one gesture. */
  function inverseSelectionScope(visibleItemIds) {
    const session = store.getSession();
    return inverseScope(
      store.getSnapshot().view?.itemSets ?? [],
      visibleItemIds,
      session.selectionAnchor,
      [...session.selected],
    );
  }

  /** Begins a marquee gesture. With preserveSelection, the current selection
   * is kept as the base; otherwise it is cleared. Returns the base ids. */
  function beginMarqueeSelection({ preserveSelection }) {
    if (preserveSelection) return [...store.getSession().selected];
    store.clearSelection();
    store.setSelectionAnchor(null);
    syncSelection();
    return [];
  }

  /** Replaces the transient marquee selection without saving on every move. */
  function updateMarqueeSelection(ids) {
    store.setSelection(ids);
    syncSelection();
  }

  /** Ends a marquee gesture; saves the view only when it actually moved. */
  function finishMarqueeSelection({ moved }) {
    if (moved) saveWorkspaceView();
  }

  function navigateToFolder(folderId) {
    const session = store.getSession();
    if (session.binMode) {
      // Drilling into a binned folder stays inside the Bin — it must never
      // jump to the real explorer, since the folder (and everything under
      // it) is still hidden there and would just show up empty.
      store.setNavigation({ binCurrentId: folderId });
    } else {
      store.setNavigation({ currentId: folderId });
    }
    store.clearSelection();
    graph.destroyGraphView();
    closeMenu();
    render();
    saveWorkspaceView();
  }

  async function launchShortcut(itemId) {
    closeMenu();
    try {
      const chosen = shortcut(itemId);
      if (isWebLink(chosen)) {
        await host.openWebLink(chosen.target);
      } else {
        await host.launchShortcut(itemId);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  /** Reveals a single shortcut's target in the file manager. */
  async function revealShortcut(itemId) {
    closeMenu();
    try {
      await host.revealShortcut(itemId);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  /** Exact copy of the pre-refactor heuristic: a target whose last path
   * segment has no extension is treated as a directory for double-click. */
  function isDirectoryTarget(target) {
    if (!target) return false;
    const normalized = target.replace(/\\/g, '/');
    const lastSlash = normalized.lastIndexOf('/');
    const basename = lastSlash === -1 ? normalized : normalized.slice(lastSlash + 1);
    return !basename.includes('.');
  }

  /** Owns the folder-versus-shortcut decision for opening an item: a group
   * navigates into it (explorer or Bin), a shortcut launches or opens it. With
   * revealDirectoryTarget, a non-web directory shortcut reveals its target in
   * the file manager instead of launching. */
  function activateItem(itemId, { revealDirectoryTarget = false } = {}) {
    if (group(itemId)) return navigateToFolder(itemId);
    const chosen = shortcut(itemId);
    if (!chosen) return;
    if (
      revealDirectoryTarget
      && !isWebLink(chosen)
      && isDirectoryTarget(chosen.target)
    ) {
      return revealShortcut(itemId);
    }
    return launchShortcut(itemId);
  }

  function directoryOf(target) {
    const normalized = target.replace(/\\/g, '/');
    const lastSlash = normalized.lastIndexOf('/');
    return lastSlash === -1 ? normalized : normalized.slice(0, lastSlash).toLocaleLowerCase();
  }

  async function revealSelection() {
    const targets = [...store.getSession().selected]
      .map((itemId) => shortcut(itemId))
      .filter((candidate) => candidate && !isWebLink(candidate));
    if (targets.length === 0) return;
    const seenDirectories = new Set();
    for (const target of targets) {
      const directory = directoryOf(target.target);
      if (seenDirectories.has(directory)) continue;
      seenDirectories.add(directory);
      try {
        await host.revealShortcut(target.id);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error));
      }
    }
  }

  async function activateSelection() {
    const shortcuts = [...store.getSession().selected]
      .map((itemId) => shortcut(itemId))
      .filter(Boolean);
    if (shortcuts.length === 0) return;
    closeMenu();
    await Promise.all(shortcuts.map(async (chosen) => {
      try {
        if (isWebLink(chosen)) {
          await host.openWebLink(chosen.target);
        } else {
          await host.launchShortcut(chosen.id);
        }
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error));
      }
    }));
  }

  async function undo() {
    await store.undo();
  }

  async function redo() {
    await store.redo();
  }

  function selectedPasteDestinations() {
    const folders = [...store.getSession().selected]
      .map((itemId) => group(itemId)).filter(Boolean);
    return folders.length > 0 ? folders.map((folder) => folder.id) : [store.getSession().currentId];
  }

  function copyOrCut(mode) {
    if (store.getSession().selected.size === 0) return;

    // Capture right now, at the moment of Ctrl+C/Ctrl+X, both which specific
    // placement each selected shortcut represents and (for a cut) whether it
    // currently shows more than one edge on screen — both decide behavior at
    // paste time and must not drift if selection or graph visibility changes
    // before the user pastes.
    const collapseWhole = new Set();
    const placementIds = new Map();
    const session = store.getSession();

    for (const selectedId of session.selected) {
      if (group(selectedId)) continue;

      const placementId = visiblePlacementIdFor(selectedId);
      if (placementId) placementIds.set(selectedId, placementId);

      if (mode === 'cut' && visibleParentCountFor(selectedId) > 1) {
        collapseWhole.add(selectedId);
      }
    }

    store.setClipboard({
      mode,
      ids: [...session.selected],
      collapseWhole,
      placementIds,
    });

    setStatus('');
    closeMenu();
  }

  function copySelection() {
    return copyOrCut('copy');
  }

  function cutSelection() {
    return copyOrCut('cut');
  }

  async function pasteInto(parentIds) {
    const destinations = Array.isArray(parentIds) ? parentIds : [parentIds];
    const clipboard = store.getSession().clipboard;
    if (!clipboard || destinations.length === 0 || destinations.includes('bin')) return;
    try {
      const wasCut = clipboard.mode === 'cut';
      let next = store.getSnapshot();
      if (wasCut) {
        // A cut item can only move to one place, so multi-folder selection is
        // ignored here — only the first destination applies.
        const parentId = destinations[0];
        const groupIds = clipboard.ids.filter((selectedId) => group(selectedId));
        const wholeShortcutIds = clipboard.ids.filter((selectedId) => clipboard.collapseWhole.has(selectedId));
        const singlePlacementIds = clipboard.ids
          .filter((selectedId) => !group(selectedId) && !clipboard.collapseWhole.has(selectedId))
          .map((selectedId) => clipboard.placementIds.get(selectedId) ?? anyActivePlacementId(selectedId))
          .filter(Boolean);
        if (groupIds.length > 0 || singlePlacementIds.length > 0) {
          next = moveSelection(next, [...groupIds, ...singlePlacementIds], parentId);
        }
        for (const shortcutId of wholeShortcutIds) {
          next = collapsePlacements(next, shortcutId, parentId);
        }
      } else {
        const ids = clipboard.ids
          .map((selectedId) => group(selectedId)
            ? selectedId
            : clipboard.placementIds.get(selectedId) ?? anyActivePlacementId(selectedId))
          .filter(Boolean);
        // Copying always links; pasting into multiple selected folders at once
        // links a new placement into each one.
        for (const parentId of destinations) {
          next = copySelectionModel(next, ids, parentId);
        }
      }
      if (wasCut) store.setClipboard(null);
      await store.commit(next);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function moveSelectionToBin() {
    if (store.getSession().selected.size === 0) return;
    await store.commit(
      binSelection(store.getSnapshot(), resolveBinTargets([...store.getSession().selected])),
    );
  }

  function resetGraphPositions() {
    const session = store.getSession();
    const ctxId = graphContextId(session.currentId, session.binMode);
    store.replace(removeGraphPositions(store.getSnapshot(), ctxId, [...session.selected]));
    for (const id of session.selected) {
      const node = graph._getNode(id);
      if (node) {
        node.fx = null;
        node.fy = null;
        node.positioned = false;
        node.vx = 0;
        node.vy = 0;
      }
    }
    graph.reheat(0.3);
    closeMenu();
    saveWorkspaceView();
  }

  /** Drops a dragged selection onto the Bin pill: bins every resolved
   * placement and clears their graph positions. */
  async function dragDropToBin({ itemIds }) {
    const session = store.getSession();
    const ctxId = graphContextId(session.currentId, session.binMode);
    try {
      const next = removeGraphPositions(
        binSelection(store.getSnapshot(), resolveBinTargets(itemIds)),
        ctxId,
        itemIds,
      );
      await store.commit(next);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  /** Drops a dragged selection into a folder: moves groups and single
   * placements, collapses whole linked shortcuts, and clears positions. */
  async function dragDropToFolder({ itemIds, placementIds, folderId }) {
    const session = store.getSession();
    const ctxId = graphContextId(session.currentId, session.binMode);
    try {
      const groupIds = itemIds.filter((draggedId) => group(draggedId));
      const wholeShortcutIds = itemIds.filter((draggedId) =>
        !group(draggedId) && visibleParentCountFor(draggedId) > 1);
      const singlePlacementIds = itemIds
        .filter((draggedId) => !group(draggedId) && visibleParentCountFor(draggedId) <= 1)
        .map((shortcutId) => placementIds.get(shortcutId) ?? anyActivePlacementId(shortcutId))
        .filter(Boolean);
      let next = store.getSnapshot();
      if (groupIds.length > 0 || singlePlacementIds.length > 0) {
        next = moveSelection(next, [...groupIds, ...singlePlacementIds], folderId);
      }
      for (const shortcutId of wholeShortcutIds) {
        next = collapsePlacements(next, shortcutId, folderId);
      }
      await store.commit(removeGraphPositions(next, ctxId, itemIds));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  /** Pins a dragged selection to its current graph coordinates. */
  function pinDraggedNodes({ positions }) {
    const session = store.getSession();
    const ctxId = graphContextId(session.currentId, session.binMode);
    store.replace(setGraphPositions(store.getSnapshot(), ctxId, positions));
    saveWorkspaceView();
  }

  /** Releases a dragged selection, clearing its saved graph positions. */
  function releaseDraggedNodes({ itemIds }) {
    const session = store.getSession();
    const ctxId = graphContextId(session.currentId, session.binMode);
    store.replace(removeGraphPositions(store.getSnapshot(), ctxId, itemIds));
    saveWorkspaceView();
  }

  function nameForDroppedUrl(url) {
    try {
      const hostname = new URL(url).hostname.replace(/^www\./i, '');
      return hostname || url;
    } catch {
      return url;
    }
  }

  /** Drops a URL into a destination: resolves the web icon, creates the web
   * link, and commits. Reports errors through setStatus. */
  async function dropUrl(url, destination) {
    try {
      let name = nameForDroppedUrl(url);
      let icon = null;
      try {
        const resolved = await host.resolveWebIcon(url);
        if (resolved?.title) name = resolved.title;
        if (resolved?.icon) icon = resolved.icon;
      } catch {
        // Fall back to the hostname-derived name/no icon — the link is
        // still worth creating even if the page couldn't be reached.
      }
      const next = createWebLink(store.getSnapshot(), {
        name,
        target: url,
        icon,
        parentId: destination,
      });
      await store.commit(next);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  /** Drops files into a destination: resolves targets, creates shortcuts,
   * and commits — or reports that they already exist. */
  async function dropFiles(files, destination) {
    try {
      const targets = await host.resolveDroppedTargets(files);
      const next = createDroppedShortcuts(store.getSnapshot(), targets, destination);
      if (next.shortcuts.length === store.getSnapshot().shortcuts.length) {
        setStatus('Those shortcuts already exist here.');
        return;
      }
      await store.commit(next);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  return {
    selectItem,
    clearSelection,
    selectAllVisible,
    groupSelectionIntoSet,
    shareSelectionWithSets,
    inverseSelectionScope,
    beginMarqueeSelection,
    updateMarqueeSelection,
    finishMarqueeSelection,
    activateItem,
    revealSelection,
    activateSelection,
    copySelection,
    cutSelection,
    pasteInto,
    moveSelectionToBin,
    resetGraphPositions,
    dragDropToBin,
    dragDropToFolder,
    pinDraggedNodes,
    releaseDraggedNodes,
    dropUrl,
    dropFiles,
    selectedPasteDestinations,
    undo,
    redo,
  };
}

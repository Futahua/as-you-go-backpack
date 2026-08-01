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

  /** Owns the folder-versus-shortcut decision for opening an item: a group
   * navigates into it (explorer or Bin), a shortcut launches or opens it. */
  function activateItem(itemId) {
    if (group(itemId)) return navigateToFolder(itemId);
    if (shortcut(itemId)) return launchShortcut(itemId);
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

  return {
    selectItem,
    activateItem,
    revealSelection,
    activateSelection,
    copySelection,
    cutSelection,
    pasteInto,
    moveSelectionToBin,
    selectedPasteDestinations,
    undo,
    redo,
  };
}

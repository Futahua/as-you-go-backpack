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
  isWebLink,
  host,
  graph,
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

  return { selectItem, activateItem, revealSelection, activateSelection, undo, redo };
}

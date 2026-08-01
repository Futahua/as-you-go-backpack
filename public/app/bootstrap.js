/** Orchestrates workspace startup. Behavior-only components (context menu,
 * editor, confirmation dialog, Bin controls) mount synchronously so their
 * listeners are attached regardless of whether host state loading succeeds —
 * the rendered fallback interface stays interactive even when loading fails.
 * The toolbar mounts only after state is restored, since it immediately
 * re-applies saved positions. */
export function bootstrapWorkspace({
  loadState,
  setState,
  normalizeState,
  restoreWorkspaceView,
  setStatus,
  render,
  toolbar,
  confirmDialog,
  menu,
  editorDialog,
  binControls,
}) {
  confirmDialog.mount();
  menu.mount();
  editorDialog.mount();
  binControls.mount();

  return (async () => {
    try {
      const loaded = await loadState();
      setState(normalizeState(
        typeof loaded === 'string' ? JSON.parse(loaded) : loaded,
      ));
      restoreWorkspaceView();
      toolbar.mount();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
    render();
  })();
}

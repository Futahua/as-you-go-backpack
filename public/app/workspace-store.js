/** Single owner of workspace history and persistence. All state mutations
 * route through this store: history-bearing edits go through commit(), and
 * non-historical view/position changes go through replace(). The document
 * state itself lives in the injected getState/setState pair so the entry can
 * keep its existing references while every write funnels through the store.
 *
 * prepare() (when provided) runs before installing a committed state — the
 * entry uses it to fold the current navigation session into the saved view.
 * The store clears the session selection directly before invoking prepare().
 * afterCommit() runs after the new state is installed but before persisting. */
export function createWorkspaceStore({
  getState,
  setState,
  persist,
  normalizeState,
  prepare,
  afterCommit,
  setStatus,
  initialSession = {},
  // 0B: document-write authority. A surface that is not the writer must stop
  // before it changes local document or history state -- not after, and never
  // by quietly dropping the save. A dropped save is the silent loss this whole
  // effort exists to remove. `install` is deliberately NOT gated: the writer's
  // broadcasts and conflict recovery must still be able to replace the
  // authoritative document, and session-only setters stay free so a view can
  // still navigate, select and expand.
  canMutateDocument = () => true,
  onMutationBlocked = () => {},
}) {
  let undoStack = [];
  let redoStack = [];
  let saveQueue = Promise.resolve();
  const session = {
    selected: new Set(),
    // Sets are selected separately from items, and deliberately so: it lets
    // Delete mean two different things without either being a surprise —
    // removing a grouping and leaving its contents alone, or binning items.
    // A shared selection would have to guess which was meant.
    selectedSets: new Set(),
    selectionAnchor: null,
    currentId: null,
    binCurrentId: 'bin',
    binMode: false,
    graphExpanded: new Set(),
    // The active trail-expansion set for the CURRENT view context
    // (Assignment 007). Synced by the render path from
    // view.trailExpandedByContext; each view context has its own set and
    // defaults to empty. Never seeded from or written into graphExpanded.
    trailExpanded: new Set(),
    clipboard: null,
    ...initialSession,
  };

  function save(nextState = getState(), metadata) {
    const snapshot = JSON.stringify(nextState);
    const operation = saveQueue
      .catch(() => undefined)
      .then(() => persist(snapshot, metadata));
    saveQueue = operation;
    return operation;
  }

  function commit(nextState, { isUndo = false, isRedo = false } = {}) {
    if (!canMutateDocument()) {
      // Refused before the history stacks or the document are touched, so a
      // blocked edit leaves nothing behind to resurface later.
      onMutationBlocked('commit');
      return Promise.resolve(false);
    }
    const previous = getState();
    if (isUndo) {
      redoStack.push(previous);
    } else if (isRedo) {
      undoStack.push(previous);
    } else {
      undoStack.push(previous);
      redoStack.length = 0;
    }
    let final = normalizeState(nextState);
    // Selection is cleared only after the initial normalization succeeds, so
    // a malformed state that makes normalizeState throw does not destroy the
    // current selection.
    session.selected.clear();
    if (prepare) final = normalizeState(prepare(final, session) ?? final);
    setState(final);
    afterCommit?.();
    return save(final)
      .then(() => {
        setStatus?.('');
        return true;
      })
      .catch((error) => {
        setStatus?.(error instanceof Error ? error.message : String(error));
        return false;
      });
  }

  async function undo() {
    if (!canMutateDocument()) { onMutationBlocked('undo'); return; }
    if (undoStack.length === 0) return;
    const previous = undoStack.pop();
    return commit(previous, { isUndo: true });
  }

  async function redo() {
    if (!canMutateDocument()) { onMutationBlocked('redo'); return; }
    if (redoStack.length === 0) return;
    const next = redoStack.pop();
    return commit(next, { isRedo: true });
  }

  return {
    getSnapshot: getState,
    getSession: () => session,
    setSelection: (ids) => { session.selected = new Set(ids); },
    addToSelection: (id) => { session.selected.add(id); },
    removeFromSelection: (id) => { session.selected.delete(id); },
    clearSelection: () => { session.selected.clear(); },
    setSelectedSets: (ids) => { session.selectedSets = new Set(ids); },
    addToSelectedSets: (id) => { session.selectedSets.add(id); },
    clearSelectedSets: () => { session.selectedSets.clear(); },
    setSelectionAnchor: (anchor) => { session.selectionAnchor = anchor; },
    setNavigation: ({ currentId, binCurrentId, binMode } = {}) => {
      if (currentId !== undefined) session.currentId = currentId;
      if (binCurrentId !== undefined) session.binCurrentId = binCurrentId;
      if (binMode !== undefined) session.binMode = binMode;
    },
    setGraphExpanded: (ids) => { session.graphExpanded = new Set(ids); },
    toggleGraphExpanded: (id) => {
      if (session.graphExpanded.has(id)) session.graphExpanded.delete(id);
      else session.graphExpanded.add(id);
    },
    addToGraphExpanded: (id) => { session.graphExpanded.add(id); },
    removeFromGraphExpanded: (id) => { session.graphExpanded.delete(id); },
    setTrailExpanded: (ids) => { session.trailExpanded = new Set(ids); },
    setClipboard: (clipboard) => { session.clipboard = clipboard; },
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    install(nextState) {
      setState(normalizeState(nextState));
      return getState();
    },
    replace(nextState) {
      if (!canMutateDocument()) {
        onMutationBlocked('replace');
        return getState();
      }
      setState(nextState);
      return getState();
    },
    save,
    commit,
    undo,
    redo,
  };
}

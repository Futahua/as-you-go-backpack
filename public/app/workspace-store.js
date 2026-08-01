/** Single owner of workspace history and persistence. All state mutations
 * route through this store: history-bearing edits go through commit(), and
 * non-historical view/position changes go through replace(). The document
 * state itself lives in the injected getState/setState pair so the entry can
 * keep its existing references while every write funnels through the store.
 *
 * prepare() (when provided) runs before installing a committed state — the
 * entry uses it to clear the selection and fold the current navigation
 * session into the saved view. afterCommit() runs after the new state is
 * installed but before persisting. */
export function createWorkspaceStore({
  getState,
  setState,
  persist,
  normalizeState,
  prepare,
  afterCommit,
  setStatus,
}) {
  let undoStack = [];
  let redoStack = [];
  let saveQueue = Promise.resolve();

  function save(nextState = getState()) {
    const snapshot = JSON.stringify(nextState);
    const operation = saveQueue
      .catch(() => undefined)
      .then(() => persist(snapshot));
    saveQueue = operation;
    return operation;
  }

  function commit(nextState, { isUndo = false, isRedo = false } = {}) {
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
    if (prepare) final = normalizeState(prepare(final) ?? final);
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
    if (undoStack.length === 0) return;
    const previous = undoStack.pop();
    return commit(previous, { isUndo: true });
  }

  async function redo() {
    if (redoStack.length === 0) return;
    const next = redoStack.pop();
    return commit(next, { isRedo: true });
  }

  return {
    getSnapshot: getState,
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    install(nextState) {
      setState(normalizeState(nextState));
      return getState();
    },
    replace(nextState) {
      setState(nextState);
      return getState();
    },
    save,
    commit,
    undo,
    redo,
  };
}

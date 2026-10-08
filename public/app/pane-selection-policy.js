// Workspace rerenders repeat the current selection. They must not undo a
// deliberate native-window tab choice; an actual selection change still wins.
export function createPaneSelectionPolicy() {
  let current = null;
  let held;
  return {
    observe(selection) {
      const item = selection?.item ?? selection;
      const key = JSON.stringify([
        selection?.mode ?? 'single', selection?.selectionCount ?? null,
        item?.shortcutId ?? null, item?.path ?? null, item?.url ?? null,
        (selection?.items ?? []).map(entry => [entry.shortcutId ?? null, entry.path ?? null, entry.url ?? null]),
      ]);
      current = key;
      if (held === key) return false;
      held = undefined;
      return true;
    },
    hold() { held = current; },
  };
}

import {
  normalizeState,
  setActiveWindowLayoutId,
  addWindowLayoutMember,
  removeWindowLayoutMember,
} from '../workspace-model-20260730b.js';
import { createWindowLayoutPickApplier } from './window-layout-workspace.js';
import { windowLayoutMemberKey } from './window-layout-runtime.js';

/** Apply one compact-widget picker result directly against host authority.
 *
 * The widget is a project surface in its own right. It does not need to find
 * whichever ordinary AYG renderer currently owns the document writer lock just
 * to honor one mouse pick. Load the latest versioned document, apply the
 * already-bounded pick with the shared model, and offer exactly that revision
 * back through checked CAS. A stale CAS changed nothing, so one fresh rebase is
 * safe; there is still at most one accepted durable write for the gesture.
 */
export async function applyWindowLayoutWidgetPickDirect({
  host,
  layoutId,
  pick,
  capabilities,
  icons,
  iconCacheEntry,
  attempts = 2,
}) {
  if (!host || typeof host.loadWorkspaceVersioned !== 'function'
    || typeof host.saveWorkspaceChecked !== 'function') {
    return { outcome: 'failed', error: 'Widget persistence is unavailable' };
  }

  const boundedAttempts = Math.max(1, Math.min(2, Math.trunc(attempts) || 1));
  let lastSave = null;

  for (let attempt = 0; attempt < boundedAttempts; attempt += 1) {
    let loaded;
    try {
      loaded = await host.loadWorkspaceVersioned();
    } catch (error) {
      return {
        outcome: 'failed',
        error: error instanceof Error ? error.message : 'Window layout could not be loaded',
      };
    }

    let working = normalizeState(loaded?.state);
    if (!(working.windowLayouts ?? []).some((layout) => layout.id === layoutId)) {
      return { outcome: 'missing', state: working };
    }

    lastSave = null;
    const applier = createWindowLayoutPickApplier({
      getState: () => working,
      commitState: async (next) => {
        const durableNext = setActiveWindowLayoutId(next, layoutId);
        lastSave = await host.saveWorkspaceChecked(durableNext, loaded.revision);
        if (lastSave?.ok !== true) return false;
        working = normalizeState(durableNext);
        return true;
      },
      // Both widget picker paths already cross a host-owned exact-window
      // binding boundary before they can produce an add:
      // - list pick -> bindWindowCandidate(), which re-observes the candidate;
      // - direct pick -> WindowPickSession commit, which binds each staged
      //   candidate before returning the committed result.
      //
      // Re-observing the just-issued capability here adds a second helper
      // round-trip after the creator's click and can fail independently even
      // though the pick itself was already proven. Membership persistence only
      // needs the exact persisted descriptor; live bounds/state are hydrated by
      // the normal runtime afterward. Keep this widget path one click -> one
      // checked document write.
      observeCapability: async () => ({
        outcome: 'success',
        observation: { state: 'normal', bounds: null },
      }),
      model: { addWindowLayoutMember, removeWindowLayoutMember },
      capabilities,
      icons,
      iconCacheEntry,
      isReadOnly: () => false,
      memberKey: windowLayoutMemberKey,
    });

    const applied = await applier.apply(layoutId, pick);
    if (applied.outcome === 'failed' && lastSave?.code === 'STALE_REVISION'
      && attempt + 1 < boundedAttempts) {
      continue;
    }
    return {
      ...applied,
      state: working,
      revision: lastSave?.revision ?? loaded?.revision ?? null,
      save: lastSave,
    };
  }

  return { outcome: 'failed', error: 'Window layout changed while the pick was being applied', save: lastSave };
}
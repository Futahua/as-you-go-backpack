import { quickRunRows } from './quick-run-search.js';

/**
 * Quick Run — what Enter means, as a plan rather than a launch.
 *
 * Section 1.5 fixes the four default actions and this module only decides which one applies and what it
 * needs; nothing here launches, navigates or focuses anything. That split is deliberate: the workspace
 * already owns the execution paths — the keyboard controller handles workspace.open-selection for Enter
 * and workspace.reveal-selection for Ctrl+Enter — and section 1.6's own note says Quick Run must take
 * those keys over only while its input surface is active. So a plan names **the command the workspace
 * already has**, plus the target ids the row already carries, and a caller that has those commands can run
 * it without a second launch implementation.
 *
 * The layout-item case is the one that is not autonomous work: activating and focusing a live foreign
 * application window (restoring it if minimized) is not reversible by a commit, so the plan reports it as
 * deferred with the reason instead of pretending it is ready. A caller that sees deferred must not
 * silently do nothing; the box that owns it waits for a session with the creator at the machine.
 */


/** The workspace command each type's default action belongs to (section 1.5, via the existing keys). */
export const QUICK_RUN_ENTER_COMMAND = 'workspace.open-selection';

export const QUICK_RUN_DEFERRED_WINDOW_ACTIVATION = 'live-window-control-is-not-autonomous';

export function planQuickRunActivation(row) {
  if (!row || typeof row !== 'object') return null;
  switch (row.type) {
    case 'folder':
      return { action: 'navigate-folder', command: QUICK_RUN_ENTER_COMMAND, target: { groupId: row.groupId } };
    case 'shortcut':
      return {
        action: 'launch-shortcut',
        command: QUICK_RUN_ENTER_COMMAND,
        target: { shortcutId: row.shortcutId, placementId: row.placementId },
      };
    case 'link':
      return {
        action: 'open-link',
        command: QUICK_RUN_ENTER_COMMAND,
        target: { shortcutId: row.shortcutId, placementId: row.placementId, url: row.target },
      };
    case 'layout-item':
      return {
        action: 'activate-window',
        command: null,
        deferred: QUICK_RUN_DEFERRED_WINDOW_ACTIVATION,
        target: { layoutId: row.layoutId, memberId: row.memberId },
      };
    default:
      // A row whose type this module does not know is not runnable, and guessing would be worse than
      // doing nothing: the caller can say so rather than launch something arbitrary.
      return null;
  }
}


/**
 * The workspace item id a plan's default action belongs to, in the id space the workspace's own
 * open-selection command already uses: a group id for a folder, a shortcut id for a shortcut or a link.
 * The entry file hands this to the same activateItem the workspace's Enter calls, so Quick Run names the
 * existing execution path rather than growing a second one (section 6.4). A plan with no such id - a
 * Layout Item, whose activation waits on live window control - answers null instead of an id that would
 * launch the wrong thing.
 */
export function quickRunWorkspaceItemId(plan) {
  if (!plan || typeof plan !== 'object' || !plan.target) return null;
  return plan.target.groupId ?? plan.target.shortcutId ?? null;
}

/**
 * What Ctrl+Enter means (section 1.6): reveal this exact occurrence **inside the workspace**.
 *
 * The section is explicit about the boundary, and it is the whole reason this is a separate function from
 * the Enter plan: it must not reuse `workspace.reveal-selection` or `revealShortcut()`, because those
 * reveal a shortcut's target through the host file manager. So the plan navigates to the folder the
 * occurrence lives in and selects the occurrence itself, and `hostReveal` is false on every branch - a
 * caller that wanted an OS reveal would have to ignore the plan rather than follow it.
 *
 * The folder to navigate to is the last entry of the row's persisted ancestor chain, which the row already
 * carries as `breadcrumbIds` (section 0.4), so no caller has to re-walk the hierarchy per keystroke.
 */
export function planQuickRunReveal(row) {
  if (!row || typeof row !== 'object') return null;
  const chain = Array.isArray(row.breadcrumbIds) ? row.breadcrumbIds : [];
  const navigateTo = chain.length > 0 ? chain[chain.length - 1] : null;
  switch (row.type) {
    case 'folder':
      return { action: 'reveal-folder', navigateTo, select: row.groupId, hostReveal: false };
    case 'shortcut':
    case 'link':
      return {
        action: 'reveal-placement',
        navigateTo,
        select: row.shortcutId,
        placementId: row.placementId,
        hostReveal: false,
      };
    case 'layout-item':
      return {
        action: 'reveal-layout-member',
        navigateTo,
        select: row.layoutId,
        memberId: row.memberId,
        hostReveal: false,
      };
    default:
      // A row whose type this module does not know has no occurrence to reveal, and guessing one would
      // select something the reader did not ask for.
      return null;
  }
}
/** The reasons Shift+Enter may be unavailable, so a caller can show one rather than ignore the key. */
export const QUICK_RUN_ADD_ONLY_LAYOUT_ITEMS = 'only-layout-items';
export const QUICK_RUN_ADD_NO_ACTIVE_LAYOUT = 'no-active-window-layout';
export const QUICK_RUN_ADD_ALREADY_PRESENT = 'already-in-the-active-layout';


/**
 * What Shift+Enter means (section 1.6): add the highlighted item to the active window layout.
 *
 * The section states five rules and this function is all of them: it is enabled **only** for Layout Items,
 * visibly disabled for the other three, and never silently ignored — every call returns either an action or
 * a disabled reason, never nothing. The two reasons a caller cannot work out for itself are supplied as
 * facts: whether an active layout exists, and whether the member is already in it. Reporting the second is
 * what stops an accidental duplicate, which is the rule the section names.
 *
 * Whether a layout member is *supported* by the active layout stays the caller's answer, because the model
 * owns that: this plan says what the key means, not what the layout accepts.
 */
export function planQuickRunShiftEnter(row, facts = {}) {
  if (!row || typeof row !== 'object') return { disabled: QUICK_RUN_ADD_ONLY_LAYOUT_ITEMS };
  if (row.type !== 'layout-item') return { disabled: QUICK_RUN_ADD_ONLY_LAYOUT_ITEMS };
  const activeLayoutId = facts.activeLayoutId ?? null;
  if (activeLayoutId === null) return { disabled: QUICK_RUN_ADD_NO_ACTIVE_LAYOUT };
  if (facts.alreadyInActiveLayout === true) return { disabled: QUICK_RUN_ADD_ALREADY_PRESENT };
  return {
    action: 'add-to-layout',
    command: 'window-layout.add-member',
    target: { layoutId: activeLayoutId, memberId: row.memberId, sourceLayoutId: row.layoutId },
  };
}

/** What a re-read can answer: the row as the state has it now, or that it is no longer there. */
export const QUICK_RUN_TARGET_GONE = 'the-result-is-no-longer-in-the-workspace';

/**
 * Re-read the target of a row from the current state, by its stable result key (section 5).
 *
 * The invariant is *"Enter re-reads the selected object from the current state by stable IDs before
 * acting"*, and the companion one is that *"indexed result payloads are never treated as current
 * authority"*. Both are about the same moment: an index is a snapshot, the workspace moves under it, and
 * an action must be planned from what is true now rather than from what the row said when it was drawn.
 *
 * So this rebuilds the universe from the state it is handed, finds the row by esultKey — the stable key
 * the contract pins, not a position — and either returns the current row or says the result is gone. A
 * caller that gets ok: false has a sentence to show instead of an action built on stale data.
 */
export function revalidateQuickRunRow(state, resultKey) {
  if (typeof resultKey !== 'string' || resultKey === '') {
    return { ok: false, reason: QUICK_RUN_TARGET_GONE };
  }
  const current = quickRunRows(state).find((row) => row.resultKey === resultKey);
  if (!current) return { ok: false, reason: QUICK_RUN_TARGET_GONE };
  return { ok: true, row: current };
}
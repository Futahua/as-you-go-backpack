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
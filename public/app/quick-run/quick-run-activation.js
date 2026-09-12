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
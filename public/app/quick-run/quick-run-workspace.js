/**
 * Quick Run — the workspace binding: the composition seam between the surface and the workspace.
 *
 * The surface module knows how to paint a session and which key means which action; the workspace owns
 * navigation, launching and selection. This module is the one place the two meet, and it exists so the
 * meeting can be exercised without booting the app: the entry file passes the elements and its
 * collaborators, and a test can pass the production markup's elements, a real store and the real
 * `createWorkspaceCommands` and press the keys for real.
 *
 * That is not a refactor for its own sake. Before this module existed the wiring lived inside
 * `workspace-20260730b.js`, which boots from the document and cannot be imported - so every claim about
 * what Enter does had to be split in two: a test that re-implemented the entry's steps against the real
 * command object, and a source-shape assertion that the entry still contained those steps. A test that
 * re-implements the thing it is testing proves the copy, not the production line. Here the production line
 * *is* the module the test drives.
 *
 * Three rules it follows rather than invents:
 *
 * - **Re-read before acting (section 5).** Every key re-resolves the row by its stable result key against
 *   the current state. An index is a snapshot; the workspace moves under it, and a stale payload is never
 *   executed. When the re-read says the result is gone, the surface rebuilds its snapshot from the state
 *   that refused it - so the reader is shown what is true now instead of a row that will refuse again.
 * - **Name the workspace's own command (sections 1.5, 6.4).** Enter hands an item id to
 *   `commands.activateItem` - the same call workspace Enter makes - and Ctrl+Enter follows
 *   `planQuickRunReveal`, which never delegates to the host file manager. No second launcher is grown here.
 * - **Close on success, stay open on refusal (sections 16.1 and 16.2).** A refusal is something this module
 *   can see - the row is gone, the plan is deferred, no command applies - so it keeps the layer open and
 *   says why. What happens after a hand-off is the host's, and its failures reach the status line where
 *   they stay visible, so closing there is not a silent close.
 *
 * Shift+Enter (add to the active layout) is not bound here. It was cut rather than repaired: its only write
 * path installed state in memory without committing it, so a surface without document-write authority could
 * be told "added" after a refused write. This module no longer takes the store, the render callback or the
 * window-layout helpers, because nothing here needs them - which is also what makes the false-success path
 * unreachable rather than merely unused.
 */
import { mountQuickRun } from './quick-run-surface.js';
import {
  planQuickRunActivation,
  planQuickRunReveal,
  quickRunWorkspaceItemId,
  revalidateQuickRunRow,
} from './quick-run-activation.js';

/** The sentence for a row that the workspace no longer holds (section 16.3), and what was done about it. */
const GONE = 'Quick Run: that result is no longer in the workspace. The list now shows the current matches.';

export function bindQuickRunWorkspace({
  document,
  elements,
  commands,
  getState,
  getVisibleItemIds,
  setStatus,
}) {
  if (typeof getState !== 'function') {
    throw new TypeError('bindQuickRunWorkspace needs a getState function to re-read the workspace');
  }
  if (!commands) {
    throw new TypeError('bindQuickRunWorkspace needs the workspace command object');
  }
  // Assigned by the mount below; the callbacks close over it so a successful action can close the layer
  // without the mount having to know what success meant.
  let surface = null;
  const closeAfterSuccess = () => { surface?.close(); };
  // A vanished target is reported and the snapshot is rebuilt from the state that refused it, keeping the
  // reader's query and filter and moving the highlight to the nearest survivor (section 5). Without the
  // rebuild the dead row would stay on screen and the next Enter would refuse it again.
  const reportGone = () => {
    surface?.refresh();
    setStatus(GONE);
  };

  surface = mountQuickRun({
    document,
    elements,
    getState,
    // What Enter does (section 1.5). The row is re-read from the current state by its stable key before
    // anything happens (section 5), then the plan is executed by naming the workspace's own
    // open-selection path - activateItem - instead of growing a second launcher (sections 1.5 and 6.4). A
    // row that cannot run yet says so in the status line rather than appearing to do nothing (section 1.6),
    // and only a hand-off closes the layer (section 16.1).
    onActivate: (resultKey) => {
      const current = revalidateQuickRunRow(getState(), resultKey);
      if (!current.ok) {
        reportGone();
        return;
      }
      const plan = planQuickRunActivation(current.row);
      if (plan?.deferred) {
        setStatus('Quick Run: activating a live application window is not wired up yet.');
        return;
      }
      const itemId = plan ? quickRunWorkspaceItemId(plan) : null;
      if (!itemId) {
        setStatus('Quick Run: that result has no workspace action.');
        return;
      }
      void commands.activateItem(itemId);
      closeAfterSuccess();
    },
    // Ctrl+Enter (section 1.6): reveal the exact occurrence inside the workspace. It navigates to the folder
    // the occurrence lives in and selects the occurrence itself, and it never delegates to the file manager
    // the way the ordinary reveal command does - which is why `planQuickRunReveal` answers hostReveal: false
    // on every branch and this callback follows the plan rather than any other command.
    //
    // The navigation names `goToFolder` rather than `activateItem` because the destination may be the
    // workspace root, which has no group record for activateItem to match - handing it one navigated
    // nowhere at all. goToFolder is the workspace's own go-to-a-folder command (the same call its root
    // breadcrumb makes), so this is still one navigation implementation rather than a second one.
    onReveal: (resultKey) => {
      const current = revalidateQuickRunRow(getState(), resultKey);
      if (!current.ok) {
        reportGone();
        return;
      }
      const reveal = planQuickRunReveal(current.row);
      if (!reveal) {
        setStatus('Quick Run: that result cannot be revealed.');
        return;
      }
      if (reveal.navigateTo) commands.goToFolder(reveal.navigateTo);
      if (reveal.select) {
        commands.selectItem(reveal.select, {
          shiftKey: false,
          ctrlKey: false,
          visibleItemIds: getVisibleItemIds(),
        });
      }
      // Section 1.6 puts the reveal inside the workspace and section 16.1 closes the layer on success, so a
      // reveal that had a target to show is a success even when the occurrence shares its record with
      // another placement: the folder navigated to is the occurrence's own.
      closeAfterSuccess();
    },
  });

  return surface;
}

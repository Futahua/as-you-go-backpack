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
 *   executed.
 * - **Name the workspace's own command (sections 1.5, 6.4).** Enter hands an item id to
 *   `commands.activateItem` - the same call workspace Enter makes - and Ctrl+Enter follows
 *   `planQuickRunReveal`, which never delegates to the host file manager. No second launcher is grown here.
 * - **Close on success, stay open on refusal (sections 16.1 and 16.2).** A refusal is something this module
 *   can see - the row is gone, the plan is deferred, no command applies - so it keeps the layer open and
 *   says why. What happens after a hand-off is the host's, and its failures reach the status line where
 *   they stay visible, so closing there is not a silent close.
 */
import { mountQuickRun } from './quick-run-surface.js';
import {
  QUICK_RUN_ADD_NO_ACTIVE_LAYOUT,
  QUICK_RUN_ADD_ONLY_LAYOUT_ITEMS,
  planQuickRunActivation,
  planQuickRunReveal,
  planQuickRunShiftEnter,
  quickRunDuplicateMemberId,
  quickRunWorkspaceItemId,
  revalidateQuickRunRow,
} from './quick-run-activation.js';

/** The sentence for a row that the workspace no longer holds (section 16.3). */
const GONE = 'Quick Run: that result is no longer in the workspace.';

export function bindQuickRunWorkspace({
  document,
  elements,
  store,
  commands,
  getState,
  getVisibleItemIds,
  setStatus,
  render,
  windowLayout,
  addWindowLayoutMember,
}) {
  if (typeof getState !== 'function') {
    throw new TypeError('bindQuickRunWorkspace needs a getState function to re-read the workspace');
  }
  if (!store || !commands) {
    throw new TypeError('bindQuickRunWorkspace needs the workspace store and its command object');
  }
  // Assigned by the mount below; the callbacks close over it so a successful action can close the layer
  // without the mount having to know what success meant.
  let surface = null;
  const closeAfterSuccess = () => { surface?.close(); };

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
        setStatus(GONE);
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
    // Section 1.6's affordance, painted with the highlighted row, so the key is visibly disabled with its
    // reason rather than silently dead. The active layout is read from the tree this binding is handed. The
    // duplicate check the plan also accepts needs native identity, so it is not answered here - claiming
    // "not present" would be a guess.
    shiftEnterNotice: (row) => {
      if (!row) return { text: '' };
      const plan = planQuickRunShiftEnter(row, { activeLayoutId: getState().activeWindowLayoutId ?? null });
      if (!plan.disabled) return { text: 'Shift+Enter adds this window to the active layout.', enabled: true };
      if (plan.disabled === QUICK_RUN_ADD_NO_ACTIVE_LAYOUT) return { text: 'Shift+Enter: no active window layout.' };
      if (plan.disabled === QUICK_RUN_ADD_ONLY_LAYOUT_ITEMS) return { text: 'Shift+Enter: only Layout Items can join a layout.' };
      return { text: 'Shift+Enter: not available for this result.' };
    },
    // Shift+Enter, the action itself (sections 1.6 and 10): copy the member into the active layout, unless a
    // member there already represents the same window. The comparison is on the persisted descriptor, which
    // the AUTHOR ruled is the durable native identity rather than an approximation of one, and it happens
    // before the write rather than being left to the model's same-id guard, because two different members
    // can describe one window.
    onShiftEnter: (resultKey) => {
      const state = getState();
      const current = revalidateQuickRunRow(state, resultKey);
      if (!current.ok) {
        setStatus(GONE);
        return;
      }
      const plan = planQuickRunShiftEnter(current.row, { activeLayoutId: state.activeWindowLayoutId ?? null });
      if (plan.disabled) {
        setStatus('Quick Run: that window cannot join the active layout.');
        return;
      }
      const source = windowLayout(plan.target.sourceLayoutId);
      const member = source?.arrangement?.members?.find((candidate) => candidate.id === plan.target.memberId) ?? null;
      const target = windowLayout(plan.target.layoutId);
      if (!member || !target) {
        setStatus('Quick Run: that window layout is no longer in the workspace.');
        return;
      }
      if (quickRunDuplicateMemberId(member.descriptor, target.arrangement?.members)) {
        setStatus('Quick Run: that window is already in the active layout.');
        return;
      }
      try {
        store.replace(addWindowLayoutMember(state, plan.target.layoutId, member));
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error));
        return;
      }
      setStatus('Quick Run: added that window to the active layout.');
      render();
      closeAfterSuccess();
    },
    // Ctrl+Enter (section 1.6): reveal the exact occurrence inside the workspace. It navigates to the folder
    // the occurrence lives in and selects the occurrence itself, and it never delegates to the file manager
    // the way the ordinary reveal command does - which is why `planQuickRunReveal` answers hostReveal: false
    // on every branch and this callback follows the plan rather than any other command.
    onReveal: (resultKey) => {
      const current = revalidateQuickRunRow(getState(), resultKey);
      if (!current.ok) {
        setStatus(GONE);
        return;
      }
      const reveal = planQuickRunReveal(current.row);
      if (!reveal) {
        setStatus('Quick Run: that result cannot be revealed.');
        return;
      }
      if (reveal.navigateTo) void commands.activateItem(reveal.navigateTo);
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

// Build marker. Papers runs from a packaged copy, so the first question when a
// change appears to have no effect is whether this file is the one running at
// all. Logged once at module load: if this line is absent from the console, the
// renderer is serving a different build and no amount of editing here will show.
console.info('[as-you-go] workspace module loaded: set-gravity branch, rings enabled');

import {
  ROOT_ID,
  binSelection,
  binnedItems,
  itemsInBinnedGroup,
  copySelection,
  createGroup,
  createDroppedShortcuts,
  createShortcut,
  createWebLink,
  isWebLink,
  itemsIntersectingMarquee,
  itemsIn,
  moveSelection,
  normalizeState,
  permanentlyDelete,
  renameItem,
  restoreSelection,
  setIconSize,
  updateGroup,
  updateShortcut,
  updateWebLink,
  updateWorkspaceView,
  graphContextId,
  getGraphPosition,
  setGraphPositions,
  getGraphRestPosition,
  setGraphRestPositions,
  removeGraphPositions,
  setToolbarPosition,
  getToolbarPosition,
  forkPlacement,
  collapsePlacements,
  placementCount,
  setItemSets,
  setTrailExpandedByContext,
  createWindowLayout,
  addWindowLayoutMember,
  removeWindowLayoutMember,
  removeClosedWindowFromAllLayouts,
  updateWindowLayoutMember,
  reorderWindowLayoutMember,
  setWindowLayoutCardSize,
  setActiveWindowLayoutId,
} from './workspace-model-20260730b.js';

import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCollide,
  forceX,
  forceY,
} from './vendor/d3-force.js';
import { zoom, zoomIdentity, zoomTransform } from './vendor/d3-zoom.js';
import { select } from './vendor/d3-selection.js';
import { animate } from './vendor/anime.js';
import { visibleGraphItems, directSetMemberIdsVisible, inheritedSetMemberIdsVisible, graphEdges, binOriginEdges, seedPosition, assignSpatialFolderHues } from './graph-model-20260730b.js';
import { belongsToSet } from './sets-model.js';
import {
  reconcileRing,
  ringPath,
  ringHull,
  resampleHull,
  easeOutline,
  floorOutline,
  memberFloorHull,
  forceRingShape,
  ejectionTarget,
  outlineCentroid,
} from './set-ring-model.js';
import { forceSetGravity, forceSetExclusion, forceSetSeparation } from './set-gravity-model.js';
import { assignBranchRigidity, branchCenterGravityStrength, branchLinkDistance, branchLinkStrength, forceBranchUncross } from './branch-uncross-force.js';
import { glyphPath, layoutTitleGlyphs } from './set-glyph-model.js';
import { createSetEffectsController } from './set-effects-model.js';
import { createDragTrailController } from './drag-trail-model.js';
import { regionCentroid, regionPath } from './set-region-model.js';
import { createRegionLayout } from './set-region-layout.js';
import { hydrateIcons as hydrateIconsScoped, hydrateWebPreview } from './web-link-icon-20260730b.js';
import { createHostBridge } from './app/host/host-bridge.js';
import { createWindowLayoutRecordingWiring, windowLayoutMemberKey } from './app/window-layout-runtime.js';
import { createDetachSaveGate, createDetachReadOnlyInputGuards, createWindowLayoutMemberDrag, createWindowLayoutGroupActionRunner, createReadOnlyStatusSink, orderWindowLayoutMemberButtons, windowLayoutPresentationMode, windowLayoutContentSignature, DETACH_ACTIVATE_CANCELLED } from './app/window-layout-detached.js';
import { runBoundedConcurrent } from './app/window-layout-actions.js';
import { createWindowLayoutWidgetChannelWorkspace, createWindowLayoutWidgetChannelClient, windowLayoutWidgetSnapshot, createBoundedRetry, WINDOW_LAYOUT_WIDGET_CHANNEL, WINDOW_LAYOUT_CARD_MAX_WIDTH } from './app/window-layout-widget-channel.js';
import { createWindowLayoutPickApplier, createWindowLayoutRetirementWriter } from './app/window-layout-workspace.js';
import { windowLayoutControlButton, windowLayoutMemberMarkup } from './app/window-layout-control-icons.js';
import { createWindowLayoutIsolateMode } from './app/window-layout-isolate-mode.js';
import { createWindowLayoutMemberPreview, windowLayoutPreviewHoverState } from './app/window-layout-preview.js';
import { compressIconFile } from './app/utilities/image-compression.js';
import { getWorkspaceElements } from './app/dom.js';
import { createToolbarController } from './app/components/toolbar-controller.js';
import { createStatusToast } from './app/components/status-toast.js';
import { createPromptLibraryDialog } from './app/components/prompt-library-dialog.js';
import { getBackdropOpacity, getBreadcrumbMiddleScale, getBreadcrumbRootScale, getEdgeOpacity, getOutlineOpacity, getRegionOpacity, getTheme, getTrailOpacity, getTransparentBackground, setBackdropOpacity } from './app/hotkeys-model.js';
import { resolveCopierAction } from './prompt-library-model.js';
import { createConfirmationDialog } from './app/components/confirmation-dialog.js';
import { createContextMenu } from './app/components/context-menu.js';
import { createEditorDialog } from './app/components/editor-dialog.js';
import { createBinControls } from './app/components/bin-controls.js';
import { createSetMembershipMode } from './app/components/set-membership-mode.js';
import { bootstrapWorkspace } from './app/bootstrap.js';
import { createWorkspaceStore } from './app/workspace-store.js';
import { createWorkspaceCommands } from './app/workspace-commands.js';
import { resolveContextTarget } from './app/context-target-model.js';
import { createKeyboardController } from './app/interactions/keyboard-controller.js';
import { createMarqueeController } from './app/interactions/marquee-controller.js';
import { createDropController } from './app/interactions/drop-controller.js';
import { createPointerController } from './app/interactions/pointer-controller.js';
import {
  SURFACE_DOCUMENT_CHANNEL,
  SURFACE_ROLE,
  createSurfaceCoordinator,
  webLockAdapter,
} from './app/workspace-surface-coordinator.js';
import {
  VIEW_BLOCKED_MESSAGE,
  createDocumentConflictPanel,
} from './app/components/document-conflict-panel.js';

const host = createHostBridge(window);

const PICKUP_PROMPT = `You are picking up Papers and its Backpack projects.

Canonical Papers repository: https://github.com/Futahua/Papers-3
Primary-machine source checkout: D:\\Letters\\MatTroiSeConMoc\\PAPERS 3\\Papers-3

Before acting, read AGENTS.md and HERMES.md completely from the current repository, then follow the document map in README.md. Treat those current files as authoritative over this copied orientation.

I do not code or design technical architecture. I describe the experience I want; you must construct it, test it, protect my data, and explain the result in plain language. Clicking buttons, entering information, choosing files, opening applications, organizing work, and confirming actions are normal use—not configuration or permission to invent editors, frameworks, or product-wide abstractions.

Treat Backpacks as independently developed projects, closest to plugins in ownership. Backpack interfaces, behavior, and implementation belong outside Papers' main binaries unless a concrete requirement genuinely needs a Papers-host change. A local Backpack is local in experience, implementation, and data; its ordinary development must not create a Papers version or update other machines.

My request:
[Describe what you want to experience.]`;

const elements = getWorkspaceElements(document);
const statusToast = createStatusToast({ element: elements.status });

// 019C: the compact-widget surface is the SAME project entry loaded by the
// Papers compact-widget host with `papers-surface=compact-widget` plus the
// opaque layout key (papers-layout-key is what Papers writes; layout-key is
// accepted for the assignment's literal URL). Only that named layout's card is
// rendered; the graph/workspace and the old 018 wait-for-ACTIVATE/read-only
// lifecycle never run here.
function windowLayoutWidgetSurfaceParams(locationRef) {
  const search = new URLSearchParams(locationRef.search);
  if (search.get('papers-surface') !== 'compact-widget') return null;
  const layoutId = search.get('papers-layout-key') ?? search.get('layout-key');
  if (!layoutId || layoutId.length === 0 || layoutId.length > 512) return null;
  return { layoutId };
}
const WIDGET_SURFACE = windowLayoutWidgetSurfaceParams(window.location);
if (WIDGET_SURFACE) document.documentElement.dataset.widgetSurface = 'true';
const windowLayoutWidgetSelectionChannel = typeof BroadcastChannel === 'function'
  ? new BroadcastChannel('ayg-window-layout-widget-selection')
  : null;
if (!WIDGET_SURFACE) {
  // A click back in the Backpack explicitly exits every detached widget's
  // ephemeral Ctrl/Shift selection, even when its always-on-top native window
  // was shown inactive and therefore has no reliable browser blur transition.
  window.addEventListener('pointerdown', () => {
    windowLayoutWidgetSelectionChannel?.postMessage({ type: 'clear-selection' });
  }, { capture: true });
}

const iconCache = new Map();
let state = normalizeState({ schemaVersion: 1, groups: [], shortcuts: [] });

// 018X7: the store's internal commit save-rejection handler must not paint a
// stale persistence error once a detach handoff is read-only. The sink checks
// the gate (declared later; only invoked on commit-save settle, so no TDZ).
const workspaceStoreStatus = createReadOnlyStatusSink({
  isReadOnly: () => detachSaveGate.isReadOnly(),
  show: (text, options) => statusToast.show(text, options),
});

// 0B: created after the store, because it needs the store's queue. Until it
// exists this surface behaves exactly as it always has -- a single writer.
let surfaceCoordinator = null;

/** Does this surface currently own the shared document? */
function hasDocumentWriteAuthority() {
  return !surfaceCoordinator || surfaceCoordinator.role === SURFACE_ROLE.WRITER;
}

const store = createWorkspaceStore({
  getState: () => state,
  setState: (next) => { state = next; },
  normalizeState,
  // 0B: a surface that does not own the document stops here, before any
  // document or history state changes. This is conjunctive with the 018
  // read-only gate below, not a replacement for it.
  canMutateDocument: hasDocumentWriteAuthority,
  onMutationBlocked: () => {
    // A plain view being blocked is ordinary, not a conflict: say so lightly
    // and leave the conflict panel for an actual refused save.
    if (surfaceCoordinator?.role === SURFACE_ROLE.VIEW) {
      statusToast.show(VIEW_BLOCKED_MESSAGE);
    }
  },
  persist: (snapshot, metadata) => {
    // 018X1/018X8: every save funnels through the store's persist callback.
    // Persistence is blocked while read-only UNLESS the metadata carries the
    // gate's exact current flush permit (an older queued save has no token and
    // resolves as suppressed; the handoff FLUSH saves the final snapshot once).
    if (!detachSaveGate.permitsPersist(metadata)) return Promise.resolve();
    // 0B: the coordinator owns the revision and the compare-and-set, and
    // broadcasts the exact bytes that landed. The snapshot is already
    // serialized here, and is passed through untouched.
    if (surfaceCoordinator) return surfaceCoordinator.saveSerialized(snapshot);
    return host.saveWorkspace(snapshot);
  },
  setStatus: workspaceStoreStatus,
  initialSession: { currentId: ROOT_ID },
  prepare: (next, session) => captureWorkspaceViewFrom(next, session),
  afterCommit: () => {
    closeMenu();
    render();
  },
});
// 018X1 read-only gate: every workspace mutation funnels through commit/
// replace. While a layout controller is detached these are no-ops; the handoff
// flush temporarily raises the override so the final capture+save still runs.
const storeCommit = store.commit.bind(store);
const storeReplace = store.replace.bind(store);
const detachSaveGate = createDetachSaveGate({
  getState: () => state,
  replaceState: (next) => storeReplace(next),
  commitState: (next, options) => storeCommit(next, options),
  // 018X8: the flush permit token is carried through the REAL store save queue.
  saveState: (current, metadata) => store.save(current, metadata),
});
store.commit = (next, options) => detachSaveGate.commit(next, options);
store.replace = (next) => detachSaveGate.replace(next);
// 018X2 item 7: the store's exported undo/redo call the LEXICAL internal
// commit (not the monkeypatched wrapper), so they are gated explicitly while
// read-only. All other exported mutators are session-only (non-durable) except
// commit/replace (gated) and install (the load path, intentionally ungated).
const storeUndo = store.undo.bind(store);
const storeRedo = store.redo.bind(store);
store.undo = () => (detachSaveGate.isReadOnly())
  ? Promise.resolve(false)
  : storeUndo();
store.redo = () => (detachSaveGate.isReadOnly())
  ? Promise.resolve(false)
  : storeRedo();
const session = store.getSession();

let suppressBlankClick = false;
let suppressGraphClick = false;
let zoomTimer = null;

function setStatus(text = '', options) {
  statusToast.show(text, options);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }[character]));
}

function group(groupId) {
  return state.groups.find((candidate) => candidate.id === groupId) ?? null;
}

function shortcut(shortcutId) {
  return state.shortcuts.find((candidate) => candidate.id === shortcutId) ?? null;
}

function item(itemId) {
  return group(itemId) ?? windowLayout(itemId) ?? shortcut(itemId);
}

/** A persisted window-layout record by its own id. Window layouts are
 * single-parent entities (like groups): one record, one location, their own
 * identity — never shortcut-style linked placements. */
function windowLayout(windowLayoutId) {
  return state.windowLayouts?.find((candidate) => candidate.id === windowLayoutId) ?? null;
}

/** Resolves a shortcut by either its shared record id or one of its
 * placement ids — bin-mode graph tiles are keyed by placement id (each
 * binned placement is its own independent tile), so looking a bin
 * shortcut tile up by shortcut() alone (which only matches the record id)
 * always misses. */
function shortcutByRecordOrPlacementId(candidateId) {
  return shortcut(candidateId)
    ?? state.shortcuts.find((record) => record.placements.some((placement) => placement.id === candidateId))
    ?? null;
}

/** Any one active (non-bin) placement id belonging to the given shortcut
 * identity — enough for the model layer's placement-scoped functions
 * (copySelection/moveSelection/collapsePlacements) to find the record. */
function anyActivePlacementId(shortcutId) {
  const record = shortcut(shortcutId);
  return record?.placements.find((placement) => !placement.bin)?.id ?? null;
}

function allActivePlacementIds(shortcutId) {
  const record = shortcut(shortcutId);
  return record?.placements.filter((placement) => !placement.bin).map((placement) => placement.id) ?? [];
}

/** The specific placement the user is currently looking at for this
 * shortcut — the one matching its visible parent in the currently
 * rendered graph node, falling back to any active placement if the node
 * isn't on screen. Must be resolved at gesture-start time (copy/cut,
 * drag start, bin move, editor open), not at commit time, since
 * navigation or selection changes between gesture and commit shouldn't
 * change which placement the action targets. */
function visiblePlacementIdFor(shortcutId) {
  const record = shortcut(shortcutId);
  const visibleParentId = graph._getNode(shortcutId)?.parentIds?.[0];

  return record?.placements.find((placement) =>
    !placement.bin
    && (!visibleParentId || placement.parentId === visibleParentId)
  )?.id ?? anyActivePlacementId(shortcutId);
}

/** Resolves a Bin-context id — a group id, or one specific placement id —
 * to its display name. Used for the Bin, where a tile's own id is the
 * placement, not the shared shortcut identity. */
function binItemName(binItemId) {
  const asGroup = group(binItemId);
  if (asGroup) return asGroup.name;
  const owner = state.shortcuts.find((candidate) =>
    candidate.placements.some((placement) => placement.id === binItemId));
  return owner?.name ?? null;
}

/** How many distinct folders the given shortcut is currently shown linked
 * into, in the graph node currently on screen for it — this is what decides
 * whether cutting it collapses every placement into one, or only moves the
 * one this view represents (per the creator's rule: 2+ visible edges means
 * "act on the whole shared thing," exactly 1 means "act on this location"). */
function visibleParentCountFor(shortcutId) {
  const node = graph._getNode(shortcutId);
  return node?.parentIds?.length ?? 1;
}

function isAvailableItem(itemId) {
  const candidate = item(itemId);
  if (!candidate || candidate.bin) return false;
  let parent = group(candidate.parentId);
  while (parent) {
    if (parent.bin) return false;
    parent = group(parent.parentId);
  }
  return true;
}

function captureWorkspaceViewFrom(currentState, currentSession) {
  return updateWorkspaceView(currentState, {
    currentGroupId: currentSession.currentId,
    graphExpandedGroupIds: [...currentSession.graphExpanded],
    selectedItemIds: [...currentSession.selected],
    binMode: currentSession.binMode,
  });
}

function captureWorkspaceView() {
  return captureWorkspaceViewFrom(state, session);
}

function restoreWorkspaceView() {
  const requestedCurrent = state.view.currentGroupId;
  store.setNavigation({
    currentId:
      requestedCurrent === ROOT_ID || (group(requestedCurrent) && isAvailableItem(requestedCurrent))
        ? requestedCurrent
        : ROOT_ID,
    binMode: state.view.binMode,
  });
  store.setGraphExpanded(
    (state.view.graphExpandedGroupIds ?? []).filter((groupId) =>
      Boolean(group(groupId))),
  );
  const binnedIds = new Set(binnedItems(state).map((candidate) => candidate.id));
  store.setSelection(
    state.view.selectedItemIds.filter((itemId) =>
      store.getSession().binMode ? binnedIds.has(itemId) : isAvailableItem(itemId)),
  );
  store.setSelectionAnchor([...store.getSession().selected].at(-1) ?? null);
  state = store.replace(captureWorkspaceView());
}

function saveWorkspaceView() {
  if (detachSaveGate.isReadOnly()) return;
  // 0B: a view's navigation is deliberately local and ephemeral. Checked
  // explicitly here rather than inferred from replace()'s return value, so an
  // ordinary view never reaches store.save at all -- `state.view` is a
  // fallback for a fresh surface, not a channel between live ones.
  if (!hasDocumentWriteAuthority()) return;
  state = store.replace(captureWorkspaceView());
  void store.save(state).catch((error) => {
    // 018X6: a delayed persistence error must not paint status over the
    // handoff if read-only began before this catch ran.
    if (detachSaveGate.isReadOnly()) return;
    setStatus(error instanceof Error ? error.message : String(error));
  });
}

/** 018A1/018X1 handoff flush: capture the current view into state and await the
 * REAL store save queue (the single write that completes before the stop/flush
 * ACK). The read-only gate's override is raised BEFORE the capture so the final
 * state is never discarded, and released in finally so no write can race the
 * ACK and no new gesture save can slip through. */
function flushWorkspaceSave() {
  return detachSaveGate.flush(() => captureWorkspaceView());
}

function pathTo(groupId) {
  const result = [];
  let cursor = group(groupId);
  while (cursor) {
    result.unshift({ id: cursor.id, name: cursor.name });
    cursor = group(cursor.parentId);
  }
  return [{ id: ROOT_ID, name: 'As you Go' }, ...result];
}

/** Breadcrumb path while drilled into a folder inside the Bin — walks up
 * from groupId through its real (original) ancestor chain, stopping at
 * the first folder that isn't itself binned (its own placement in the
 * Bin's top-level list), so the trail reads "Bin › outerBinnedFolder ›
 * ... › groupId" without ever crossing into the real explorer tree. */
function pathToBin(groupId) {
  const result = [];
  let cursor = group(groupId);
  while (cursor) {
    result.unshift({ id: cursor.id, name: cursor.name });
    if (cursor.bin) break;
    cursor = group(cursor.parentId);
  }
  return [{ id: 'bin', name: 'Bin' }, ...result];
}

/** The explicit view-context key for trail expansion (Assignment 007):
 * `folder:<id>` for explorer views (root is `folder:root`), `bin:<id>` for
 * Bin views (the Bin top level is `bin:bin`). Each key remembers its own
 * trail choices; a view with no entry defaults every trail folder to
 * collapsed. Never derived from or written into ordinary expansion. */
function currentTrailContextKey() {
  return session.binMode
    ? `bin:${session.binCurrentId ?? 'bin'}`
    : `folder:${session.currentId ?? ROOT_ID}`;
}

/** Persists THIS view context's trail-expansion ids and syncs the session
 * set. Empty collapses everything and drops the key. Callers render and
 * save through the normal paths. */
function setCurrentTrailExpanded(ids) {
  const unique = [...new Set(ids)];
  state = store.replace(setTrailExpandedByContext(state, currentTrailContextKey(), unique));
  store.setTrailExpanded(unique);
}

function iconMarkup(candidate) {
  if (candidate.kind === 'bin-origin') {
    return '<span class="folder-art" aria-hidden="true"><span></span></span>';
  }
  if (candidate.kind === 'window-layout') {
    return '';
  }
  if (candidate.kind === 'group') {
    if (candidate.icon) {
      return `<img src="${escapeHtml(candidate.icon)}" alt="" />`;
    }
    return '<span class="folder-art" aria-hidden="true"><span></span></span>';
  }
  if (candidate.icon) {
    return `<img src="${escapeHtml(candidate.icon)}" alt="" />`;
  }
  if (isWebLink(candidate)) {
    return `<img data-web-icon="${escapeHtml(candidate.target)}" alt="" hidden /><span class="shortcut-fallback" aria-hidden="true">↗</span>`;
  }
  return `<img data-default-icon="${candidate.id}" alt="" hidden /><span class="shortcut-fallback" aria-hidden="true">↗</span>`;
}

function linkMarkup(candidate) {
  return candidate.linked
    ? '<span class="link-badge" title="Linked into more than one folder" aria-hidden="true">⛓</span>'
    : '';
}

/** 024: a layout has no icon of its own (members carry the real icons), so its
 * card is content-sized - the empty icon box that would otherwise sit above the
 * name is omitted. Folders/shortcuts/groups keep their icon box. */
function iconItemMarkup(candidate) {
  if (candidate.kind === 'window-layout') return '';
  return `<div class="item-icon">${iconMarkup(candidate)}</div>`;
}

function descriptionMarkup(candidate) {
  return candidate.kind === 'shortcut' && candidate.description
    ? `<small>${escapeHtml(candidate.description)}</small>`
    : '';
}

/** 035: the attached workspace card becomes a greyed, noninteractive placeholder
 * while its compact widget is open (`options.detached`), or during the retired
 * full-detach handoff (`readonly`/`detached` presentation modes). The widget
 * surface itself is never a placeholder. One predicate so the card class and
 * the body markup cannot disagree. */
function windowLayoutCardPlaceholder(options) {
  if (options.widgetSurface === true) return false;
  return options.detached === true
    || windowLayoutDetachment.isReadOnly()
    || windowLayoutDetachment.getState().mode === 'detached';
}

function windowLayoutCardMarkup(candidate, options = {}) {
  const placeholder = windowLayoutCardPlaceholder(options);
  return `<div class="window-layout-card${placeholder ? ' window-layout-card--placeholder' : ''}" data-wl-card="${escapeHtml(candidate.id)}"${placeholder ? ' data-wl-placeholder="true"' : ''}>
    ${windowLayoutBodyMarkup(candidate, options)}
  </div>`;
}

/** 019B compact card live body inside a window-layout shell: a fixed-height,
 * one-row, taskbar-like icon strip (one compact icon button per persisted
 * member - every member is visible; large counts compact instead of clipping),
 * a single row of compact static inline-SVG controls, a picker host and a
 * status line. Buttons never begin outer graph dragging because the graph drag
 * excludes <button> pointerdowns by design (Assignment 015/016). No Activate
 * control and no affirmative Recording furniture (016 creator correction):
 * adding a member captures its bounds/state immediately and tracking is
 * implicit. 035: the attached placeholder shows the same greyed members and the
 * lock ONLY (reattach); the widget is the sole live card. */
function windowLayoutBodyMarkup(candidate, options = {}) {
  const emptyHint = (candidate.arrangement?.members ?? []).length === 0
    ? '<div class="window-layout-empty" data-wl-empty="true">No windows yet</div>'
    : '';
  const status = windowLayoutStatusText(candidate.id);
  // 018V7R3: one shared bounded presentation mode (readonly/detached/workspace)
  // so the body markup and the node content signatures cannot disagree.
  const presentationMode = windowLayoutPresentationMode({
    isReadOnly: windowLayoutDetachment.isReadOnly(),
    mode: windowLayoutDetachment.getState().mode,
  });
  const placeholder = windowLayoutCardPlaceholder(options);
  if (placeholder) {
    const members = (candidate.arrangement?.members ?? []).map((member) =>
      windowLayoutMemberMarkup(candidate.id, member, windowLayoutMemberIcon(candidate.id, member.id), true)).join('');
    // Inert greyed workspace summary while the widget is the sole live card:
    // disabled members and status, with one plain-click reattach lock.
    return `<div class="window-layout-body" data-wl-layout="${escapeHtml(candidate.id)}" data-wl-placeholder-body="true" aria-label="Window group (detached)">
    <div class="window-layout-members" data-wl-members="${escapeHtml(candidate.id)}">${members}${emptyHint}</div>
    <div class="window-layout-controls">${windowLayoutControlButton('reattach', 'Reattach this window-layout widget', 'data-wl-reattach', candidate.id)}</div>
    <div class="window-layout-status" data-wl-status="${escapeHtml(candidate.id)}">${escapeHtml(status)}</div>
  </div>`;
  }
  const members = (candidate.arrangement?.members ?? []).map((member) =>
    windowLayoutMemberMarkup(candidate.id, member, windowLayoutMemberIcon(candidate.id, member.id))).join('');
  const widgetSurface = options.widgetSurface === true;
  return `<div class="window-layout-body" data-wl-layout="${escapeHtml(candidate.id)}" aria-label="Window group">
    <div class="window-layout-members" data-wl-members="${escapeHtml(candidate.id)}">${members}${emptyHint}</div>
    <div class="window-layout-controls">
      ${windowLayoutControlButton('list', 'Choose from the list of onscreen windows', 'data-wl-list', candidate.id, { glyph: 'pick' })}
      ${windowLayoutControlButton('min-all', widgetSurface ? 'Minimize all members; middle-click to reattach widget' : 'Minimize all members; right-click to toggle isolate mode', 'data-wl-min-all', candidate.id, { toggle: true, active: windowLayoutRuntime.isolateMode.isActive(candidate.id) })}
      ${windowLayoutControlButton('restore-all', widgetSurface ? 'Restore/open all members' : 'Restore/open all members; middle-click to undock widget', 'data-wl-restore-all', candidate.id)}
    </div>
    <div class="window-layout-picker" data-wl-picker="${escapeHtml(candidate.id)}"></div>
    <div class="window-layout-status" data-wl-status="${escapeHtml(candidate.id)}">${escapeHtml(status)}</div>
  </div>`;
}

/** 019F: the four persistent controls and taskbar-like member button live in
 * ./app/window-layout-control-icons.js (static inline SVG, exact creator
 * mapping, stable data-wl-glyph identifiers). The body wires them with the
 * exact title/aria-label semantics and behavior data attributes. */

/** Picker list markup (016): a vertical list of compact rows from the host
 * candidate list. Every row toggles: a row whose title matches an existing
 * member removes it (data-only), any other row binds it. */
function windowLayoutPickerMarkup(layoutId, candidates) {
  const layout = windowLayoutFromState(layoutId);
  const members = layout?.arrangement?.members ?? [];
  const rows = candidates.map((candidate) => {
    const isCurrentMember = members.some((member) => candidate.title === member.descriptor.title);
    return `<button class="window-layout-pick-candidate${isCurrentMember ? ' current-member' : ''}" data-wl-pick-candidate="${escapeHtml(candidate.id)}" data-wl-pick="${escapeHtml(layoutId)}" type="button" title="${escapeHtml(candidate.title)}">
      ${candidate.icon
        ? `<img class="window-layout-pick-icon" src="${escapeHtml(candidate.icon)}" alt="">`
        : '<span class="window-layout-pick-icon placeholder" aria-hidden="true"></span>'}
      <span class="window-layout-pick-label">${escapeHtml(candidate.title)}</span>
      <span class="window-layout-pick-state ${escapeHtml(candidate.state)}">${isCurrentMember ? 'remove' : escapeHtml(candidate.state)}</span>
    </button>`;
  }).join('');
  return `<div class="window-layout-picker-panel">
    <div class="window-layout-picker-head">Choose an onscreen window (click a member row to remove it)
      <button class="window-layout-picker-close" data-wl-picker-close="true" type="button" title="Close picker">×</button>
    </div>
    <div class="window-layout-picker-list">${rows || '<div class="window-layout-empty">No eligible windows</div>'}</div>
  </div>`;
}

// ---- window-layout runtime (Assignment 015/016) ----------------------------
// One explicit active-recording layout at a time, tracked IMPLICITLY (no
// Activate button, no affirmative Recording furniture - 016 creator
// correction): adding a window captures its bounds/state immediately and
// recording follows the last-touched layout context. Capabilities and icons
// are ephemeral session state (never persisted); descriptors are the only
// durable member identity and resolve fail-closed against visible windows.
// 017I2: recording (switch, timer, observation, echo suppression) is owned
// exclusively by the pure controller in ./app/window-layout-runtime.js; this
// object keeps only the entry-side per-layout UI/interaction state.
// 040: capabilities and icons are keyed by the composite
// `layoutId\u0000memberId` identity (windowLayoutMemberKey) so two layouts
// referencing the same real window never share ephemeral state; every cache,
// DOM selector and removal path uses the composite key.
const windowLayoutRuntime = {
  capabilities: new Map(),   // `${layoutId}\u0000${memberId}` -> capability (ephemeral, entry-side discrete actions)
  icons: new Map(),          // `${layoutId}\u0000${memberId}` -> data URL (ephemeral)
  pickerOpenFor: null,
  pickerGeneration: 0,
  pickerCandidates: null,
  pickLayoutId: null,
  saveTimer: null,
  selectedMembers: new Map(), // layoutId -> Set<memberId> (inner multiselect)
  selectionAnchor: new Map(), // layoutId -> memberId (Shift+click range anchor, 019B)
  isolateMode: createWindowLayoutIsolateMode(), // ephemeral; right-click minimize toggles it
  pickUnsubscribe: null,
};

const WINDOW_LAYOUT_SAVE_DEBOUNCE_MS = 300;
const WINDOW_LAYOUT_LIST_DWELL_MS = 200;
let windowLayoutListDwell = null;

function cancelWindowLayoutListDwell() {
  if (windowLayoutListDwell) clearTimeout(windowLayoutListDwell);
  windowLayoutListDwell = null;
}

function scheduleWindowLayoutListDwell(button, open) {
  cancelWindowLayoutListDwell();
  windowLayoutListDwell = setTimeout(() => {
    windowLayoutListDwell = null;
    // Mouseout is the authoritative cancellation seam. Chromium's `:hover`
    // query is unreliable in transparent frameless widget surfaces and can
    // report false while the pointer is visibly stationary over this button.
    // A rerender may replace the node during the dwell, but the stable opener
    // already carries the layout identity and remains safe to invoke once.
    void open();
  }, WINDOW_LAYOUT_LIST_DWELL_MS);
}

/** Balance wrapped member rows against the card's actual live width. If one
 * more icon would create an 8+1 orphan, two near-even rows are chosen; a user
 * resize recomputes the columns continuously instead of relying on a hardcoded
 * member-count breakpoint. */
function balanceWindowLayoutMemberRows(card) {
  const members = card?.querySelector?.('[data-wl-members]');
  if (!members) return;
  const count = members.querySelectorAll('[data-wl-member]').length;
  if (count === 0) {
    members.style.removeProperty('--wl-balanced-member-width');
    return;
  }
  const available = Math.max(28, card.clientWidth - 16);
  const maxColumns = Math.max(1, Math.floor((available + 4) / 32));
  const rows = Math.max(1, Math.ceil(count / maxColumns));
  const columns = Math.ceil(count / rows);
  members.style.setProperty('--wl-balanced-member-width', `${(columns * 28) + ((columns - 1) * 4)}px`);
}

const windowLayoutCardResizeTimers = new WeakMap();
const windowLayoutCardResizeObserver = typeof ResizeObserver === 'function'
  ? new ResizeObserver((entries) => {
    for (const { target: card } of entries) {
      balanceWindowLayoutMemberRows(card);
      if (WIDGET_SURFACE || !card.isConnected || !card.style.width || card.matches('.window-layout-card--placeholder')) continue;
      const layoutId = card.dataset.wlCard;
      const width = Math.min(Math.round(card.getBoundingClientRect().width), WINDOW_LAYOUT_CARD_MAX_WIDTH);
      const height = Math.ceil(card.scrollHeight);
      const shell = card.closest('.window-layout-shell');
      if (shell) shell.style.setProperty('--wl-card-width', `${width}px`);
      const prior = windowLayoutCardResizeTimers.get(card);
      if (prior) clearTimeout(prior);
      windowLayoutCardResizeTimers.set(card, setTimeout(() => {
        windowLayoutCardResizeTimers.delete(card);
        const layout = windowLayoutFromState(layoutId);
        if (!layout || !card.isConnected) return;
        let next;
        try { next = setWindowLayoutCardSize(state, layoutId, width, height); } catch { return; }
        if (next === state) return;
        store.replace(next);
        void store.save(next).catch(() => undefined);
      }, 180));
    }
  })
  : null;

function installWindowLayoutCardPresentation(root) {
  for (const card of root?.querySelectorAll?.('.window-layout-card') ?? []) {
    balanceWindowLayoutMemberRows(card);
    windowLayoutCardResizeObserver?.observe(card);
  }
}

function removeWindowLayoutCardPresentation(root) {
  for (const card of root?.querySelectorAll?.('.window-layout-card') ?? []) {
    windowLayoutCardResizeObserver?.unobserve(card);
  }
}

/** Move a dragged member in visual row-major order. The old X-only comparator
 * was wrong after wrapping and made later drags appear to time out or jump. */
function moveWindowLayoutMemberButton(members, button, clientX, clientY) {
  const candidates = [...members.querySelectorAll('[data-wl-member]')].filter((candidate) => candidate !== button);
  let before = null;
  for (const candidate of candidates) {
    const rect = candidate.getBoundingClientRect();
    if (clientY < rect.top + (rect.height / 2)
      || (clientY <= rect.bottom && clientX < rect.left + (rect.width / 2))) {
      before = candidate;
      break;
    }
  }
  if (button.nextElementSibling === before || (!before && button === members.lastElementChild)) return false;
  members.insertBefore(button, before);
  return true;
}

function windowLayoutFromState(layoutId) {
  return state.windowLayouts?.find((candidate) => candidate.id === layoutId) ?? null;
}

function windowLayoutMemberFromState(layoutId, memberId) {
  return windowLayoutFromState(layoutId)?.arrangement?.members
    .find((member) => member.id === memberId) ?? null;
}

function windowLayoutStatusText(layoutId) {
  const layout = windowLayoutFromState(layoutId);
  if (!layout) return '';
  if ((layout.arrangement?.members ?? []).length === 0) return 'Pick an onscreen window or open the list';
  // No affirmative Recording/Not-recording furniture; the status line is
  // reserved for missing, denied, partial or error outcomes.
  return '';
}

const windowLayoutTransientStatusTimers = new Map();
function setWindowLayoutStatus(layoutId, text) {
  const previous = windowLayoutTransientStatusTimers.get(layoutId);
  if (previous) {
    clearTimeout(previous);
    windowLayoutTransientStatusTimers.delete(layoutId);
  }
  const status = document.querySelector(`[data-wl-status="${CSS.escape(layoutId)}"]`);
  if (status) status.textContent = text;
  if (WIDGET_SURFACE && text) {
    const timer = setTimeout(() => {
      windowLayoutTransientStatusTimers.delete(layoutId);
      const current = document.querySelector(`[data-wl-status="${CSS.escape(layoutId)}"]`);
      if (current?.textContent === text) current.textContent = '';
    }, 2400);
    windowLayoutTransientStatusTimers.set(layoutId, timer);
  }
}

/** 040: ONE shared/batched layout-scoped icon refresh. Members whose icon is
 * not yet cached are queued by their composite layout\u0000member key; a single
 * bounded `windowCandidates()` request resolves every queued member's icon in
 * one pass (never one enumeration per member). Committed pick icons are cached
 * immediately at add time; everything else is filled here. A member with no
 * icon yet renders a stable explicit placeholder cell (no blank geometry, no
 * layout shift). The refresh is shared by the workspace and widget surfaces and
 * re-broadcasts resolved icons to open widgets. */
const windowLayoutPendingIcons = new Map(); // compositeKey -> { layoutId, memberId, member }
let windowLayoutIconRefreshScheduled = false;

function queueWindowLayoutIconRefresh(layoutId, memberId) {
  const member = windowLayoutMemberFromState(layoutId, memberId);
  if (!member) return;
  const key = windowLayoutMemberKey(layoutId, memberId);
  if (windowLayoutRuntime.icons.has(key)) return;
  windowLayoutPendingIcons.set(key, { layoutId, memberId, member });
  if (windowLayoutIconRefreshScheduled) return;
  windowLayoutIconRefreshScheduled = true;
  setTimeout(() => {
    windowLayoutIconRefreshScheduled = false;
    void runWindowLayoutIconRefresh();
  }, 0);
}

async function runWindowLayoutIconRefresh() {
  if (windowLayoutPendingIcons.size === 0) return;
  if (windowLayoutDetachment.isReadOnly()) return;
  const pending = new Map(windowLayoutPendingIcons);
  windowLayoutPendingIcons.clear();
  const result = await host.windowCandidates();
  // 018X4: a handoff begun during the host call must abort before any UI
  // cache/src side effect.
  if (windowLayoutDetachment.isReadOnly()) return;
  if (result.outcome !== 'success') return;
  const candidates = result.candidates ?? [];
  const updatedLayouts = new Set();
  for (const { layoutId, memberId, member } of pending.values()) {
    const key = windowLayoutMemberKey(layoutId, memberId);
    if (windowLayoutRuntime.icons.has(key)) continue;
    const titleMatches = candidates.filter((candidate) =>
      candidate.title === member.descriptor.title);
    if (titleMatches.length !== 1) continue;
    const match = titleMatches[0];
    let icon = match.icon ?? null;
    // 040I: hydrate the exact HWND/class icon via a separate post-list request.
    // This keeps the latency-critical desktop enumeration small while allowing
    // packaged/Electron apps (ChatGPT, OpenCode) to use their taskbar icon
    // instead of the executable's generic fallback. Work is sequential and
    // bounded to actual layout members, never every visible desktop window.
    try {
      const bound = await host.bindWindowCandidate(match.id);
      if (windowLayoutDetachment.isReadOnly()) return;
      if (bound.outcome === 'success' && bound.capability) {
        windowLayoutRuntime.capabilities.set(key, bound.capability);
        const nativeIcon = await host.windowThumbnailCapability(bound.capability, {
          maxWidth: 48,
          maxHeight: 48,
        });
        if (windowLayoutDetachment.isReadOnly()) return;
        if (nativeIcon.outcome === 'success' && nativeIcon.imageUrl) {
          icon = nativeIcon.imageUrl;
        }
      }
    } catch {
      // Keep the executable icon fallback when the native icon is unavailable.
    }
    if (!icon) continue;
    windowLayoutRuntime.icons.set(key, icon);
    updatedLayouts.add(layoutId);
  }
  if (updatedLayouts.size > 0) {
    // Update scoped DOM (each layout's own member icon only) and re-broadcast
    // the resolved icons to any open widget for those layouts.
    for (const layoutId of updatedLayouts) {
      const container = document.querySelector(`[data-wl-members="${CSS.escape(layoutId)}"]`);
      if (container) {
        for (const button of container.querySelectorAll('[data-wl-member]')) {
          const memberId = button.dataset.wlMember;
          const icon = windowLayoutRuntime.icons.get(windowLayoutMemberKey(layoutId, memberId));
          if (!icon) continue;
          const cell = button.querySelector('[data-wl-member-icon]');
          if (cell && cell.classList.contains('placeholder')) {
            const img = document.createElement('img');
            img.className = 'window-layout-member-icon';
            img.setAttribute('data-wl-member-icon', memberId);
            img.alt = '';
            img.src = icon;
            cell.replaceWith(img);
          } else if (cell && cell.tagName === 'IMG' && cell.getAttribute('src') !== icon) {
            cell.setAttribute('src', icon);
          }
        }
      }
      windowLayoutWidgetChannelWorkspace.broadcast(layoutId);
    }
  }
}

function windowLayoutMemberIcon(layoutId, memberId) {
  const cached = windowLayoutRuntime.icons.get(windowLayoutMemberKey(layoutId, memberId));
  if (cached !== undefined) return cached;
  queueWindowLayoutIconRefresh(layoutId, memberId);
  return null;
}

function setWindowLayoutTransientStatus(layoutId, text, durationMs = 2400) {
  if (WIDGET_SURFACE) {
    setWindowLayoutStatus(layoutId, text);
    return;
  }
  const previous = windowLayoutTransientStatusTimers.get(layoutId);
  if (previous) clearTimeout(previous);
  setWindowLayoutStatus(layoutId, text);
  const timer = setTimeout(() => {
    windowLayoutTransientStatusTimers.delete(layoutId);
    setWindowLayoutStatus(layoutId, '');
  }, durationMs);
  windowLayoutTransientStatusTimers.set(layoutId, timer);
}

async function capabilityForMember(layoutId, memberId) {
  // 018X5: reject immediately when read-only, BEFORE the cached-capability fast
  // path, so a later group member cannot issue observe/mutation calls without
  // awaiting a fresh resolve.
  if (windowLayoutDetachment.isReadOnly()) return null;
  const member = windowLayoutMemberFromState(layoutId, memberId);
  if (!member) return null;
  const key = windowLayoutMemberKey(layoutId, memberId);
  const cached = windowLayoutRuntime.capabilities.get(key);
  if (cached) return cached;
  const resolved = await host.resolveWindowDescriptor(member.descriptor);
  // 018X4: a handoff begun during the resolve must abort IMMEDIATELY after the
  // await, before either the failure status or the success cache side effect.
  if (windowLayoutDetachment.isReadOnly()) return null;
  if (resolved.outcome !== 'success') {
    setWindowLayoutStatus(layoutId, windowLayoutStatusForOutcome(resolved.outcome));
    return null;
  }
  windowLayoutRuntime.capabilities.set(key, resolved.capability);
  return resolved.capability;
}

function windowLayoutStatusForOutcome(outcome) {
  if (outcome === 'missing') return 'Window not visible';
  if (outcome === 'ambiguous') return 'Ambiguous match';
  if (outcome === 'helper-unavailable') return 'Helper unavailable';
  if (outcome === 'timeout') return 'Timed out';
  return 'Failed';
}

async function handleWindowLayoutMemberClick(layoutId, memberId, ctrlKey = false, shiftKey = false) {
  if (windowLayoutDetachment.isReadOnly()) return;
  const member = windowLayoutMemberFromState(layoutId, memberId);
  if (!member) return;
  const isolationTargets = !ctrlKey && !shiftKey
    ? windowLayoutRuntime.isolateMode.click(layoutId, memberId, false)
    : null;
  if (isolationTargets !== null) {
    await windowLayoutGroupAction(layoutId, 'isolate', isolationTargets);
    return;
  }
  if (ctrlKey) {
    // 016 inner multiselection: separate from workspace selection.
    const selected = new Set(windowLayoutRuntime.selectedMembers.get(layoutId) ?? []);
    if (selected.has(memberId)) selected.delete(memberId);
    else selected.add(memberId);
    windowLayoutRuntime.selectedMembers.set(layoutId, selected);
    windowLayoutRuntime.selectionAnchor.set(layoutId, memberId);
    syncWindowLayoutMemberSelection(layoutId);
    return;
  }
  if (shiftKey) {
    // 019B: Shift+click selects the first-to-last range between the anchor and
    // the clicked member in persisted member order. With no anchor (or an
    // anchor that left the layout), the clicked member alone becomes the range
    // AND the new anchor.
    const ordered = (windowLayoutFromState(layoutId)?.arrangement?.members ?? [])
      .map((existing) => existing.id);
    const anchorId = windowLayoutRuntime.selectionAnchor.get(layoutId);
    const anchorIndex = ordered.indexOf(anchorId);
    const clickedIndex = ordered.indexOf(memberId);
    const selected = new Set();
    if (anchorIndex === -1 || clickedIndex === -1) {
      selected.add(memberId);
    } else {
      const [start, end] = anchorIndex <= clickedIndex
        ? [anchorIndex, clickedIndex] : [clickedIndex, anchorIndex];
      for (let index = start; index <= end; index += 1) selected.add(ordered[index]);
    }
    windowLayoutRuntime.selectedMembers.set(layoutId, selected);
    windowLayoutRuntime.selectionAnchor.set(layoutId, memberId);
    syncWindowLayoutMemberSelection(layoutId);
    return;
  }
  windowLayoutRuntime.selectedMembers.delete(layoutId);
  windowLayoutRuntime.selectionAnchor.delete(layoutId);
  syncWindowLayoutMemberSelection(layoutId);
  // 016 contextual occurrences: an icon click from a DIFFERENT layout (or
  // with no active context) applies THIS layout's saved arrangement for every
  // member and selects this layout's recording context. A click in the
  // already-current context toggles minimize/restore.
  if (state.activeWindowLayoutId !== layoutId) {
    await windowLayoutRecording.ensureRecording(layoutId);
    return;
  }
  const capability = await capabilityForMember(layoutId, memberId);
  // 018X7: capabilityForMember yields even on the cached fast path; a handoff
  // entered during that microtask must abort before observe.
  if (windowLayoutDetachment.isReadOnly()) return;
  if (!capability) return;
  const observed = await host.observeWindowCapability(capability);
  // 018X4: abort immediately after the observe await, before success OR failure
  // handling.
  if (windowLayoutDetachment.isReadOnly()) return;
  if (observed.outcome !== 'success' || !observed.observation) {
    if (observed.outcome === 'missing') {
      // Stale binding after a helper restart: drop it and re-sync the
      // controller's capabilities so the observer re-resolves once.
      windowLayoutRuntime.capabilities.delete(windowLayoutMemberKey(layoutId, memberId));
      windowLayoutRuntimeController.invalidateCapabilities(layoutId);
      if (state.activeWindowLayoutId === layoutId) {
        await windowLayoutRuntimeController.reconcileActive();
        // 018X5: abort immediately after the reconcile await before the status.
        if (windowLayoutDetachment.isReadOnly()) return;
      }
    }
    setWindowLayoutStatus(layoutId, windowLayoutStatusForOutcome(observed.outcome));
    return;
  }
  // 018X2: a handoff begun during the observe must abort before any side effect.
  if (windowLayoutDetachment.isReadOnly()) return;
  const liveState = observed.observation.state === 'minimized' ? 'minimized' : 'normal';
  const targetState = liveState === 'minimized' ? 'restore' : 'minimize';
  const result = targetState === 'restore'
    ? await host.restoreWindowCapability(capability)
    : await host.minimizeWindowCapability(capability);
  // 018X4: abort immediately after the mutation await, before failure status.
  if (windowLayoutDetachment.isReadOnly()) return;
  if (result.outcome !== 'success') {
    setWindowLayoutStatus(layoutId, windowLayoutStatusForOutcome(result.outcome));
    return;
  }
  // 018X2: re-check after the minimize/restore await too.
  if (windowLayoutDetachment.isReadOnly()) return;
  const nextState = targetState === 'restore' ? 'normal' : 'minimized';
  store.replace(updateWindowLayoutMember(state, layoutId, memberId, {
    state: nextState,
    bounds: observed.observation.bounds,
  }));
  patchWindowLayoutMember(layoutId, memberId, nextState);
  noteWindowLayoutCommit(layoutId);
  queueWindowLayoutSave();
}

function patchWindowLayoutMember(layoutId, memberId, stateValue) {
  // 040: scope the DOM selector by layout+member so a state patch for one
  // layout can never touch the same-window member of another layout.
  const button = document.querySelector(
    `[data-wl-layout="${CSS.escape(layoutId)}"] [data-wl-member="${CSS.escape(memberId)}"]`);
  if (!button) return;
  button.classList.remove('normal', 'minimized');
  button.classList.add(stateValue);
  button.setAttribute('aria-pressed', stateValue === 'minimized' ? 'true' : 'false');
  button.removeAttribute('title');
  const marker = button.querySelector('.window-layout-member-state');
  if (marker) {
    marker.className = `window-layout-member-state ${stateValue}`;
    marker.setAttribute('data-wl-member-state', stateValue);
  }
}

async function openWindowLayoutPicker(layoutId) {
  if (windowLayoutRuntime.pickerOpenFor === layoutId) {
    // A native chooser can disappear independently (focus loss, renderer
    // restart, or a failed IPC response). Re-entering the list control is an
    // explicit recovery request; clear the stale session instead of leaving
    // this layout permanently unable to open its picker.
    closeWindowLayoutPicker();
  }
  // 019G: a picker covering the desktop must clear/discard the hover preview.
  windowLayoutMemberPreview.cancel();
  const generation = ++windowLayoutRuntime.pickerGeneration;
  windowLayoutRuntime.pickerOpenFor = layoutId;
  try {
    while (windowLayoutRuntime.pickerOpenFor === layoutId
      && windowLayoutRuntime.pickerGeneration === generation) {
      const result = await host.windowCandidates();
      // 018X4: abort immediately after the await, before the failure or success UI.
      if (windowLayoutDetachment.isReadOnly()) return;
      if (windowLayoutRuntime.pickerOpenFor !== layoutId
        || windowLayoutRuntime.pickerGeneration !== generation) return; // closed meanwhile
      if (result.outcome !== 'success') {
        setWindowLayoutStatus(layoutId, windowLayoutStatusForOutcome(result.outcome));
        break;
      }
      windowLayoutRuntime.pickerCandidates = result.candidates;
      const currentTitles = new Set((windowLayoutFromState(layoutId)?.arrangement?.members ?? [])
        .map((member) => member.descriptor.title));
      const picked = await host.windowCandidatePicker(result.candidates.map((candidate) => ({
        id: candidate.id,
        title: candidate.title,
        icon: candidate.icon ?? null,
        current: currentTitles.has(candidate.title),
      })));
      if (windowLayoutRuntime.pickerOpenFor !== layoutId
        || windowLayoutRuntime.pickerGeneration !== generation) return;
      if (picked.action === 'close' && picked.candidateId) {
        await closeWindowLayoutCandidate(layoutId, picked.candidateId, result.candidates);
        continue;
      }
      if (picked.action === 'direct-pick') {
        await beginWindowLayoutDirectPick(layoutId);
        break;
      }
      if (picked.action !== 'select' || !picked.candidateId) break;
      await handleWindowLayoutPickCandidate(layoutId, picked.candidateId);
    }
  } catch (error) {
    setWindowLayoutTransientStatus(
      layoutId,
      error instanceof Error ? error.message : 'List unavailable',
    );
  } finally {
    if (windowLayoutRuntime.pickerOpenFor === layoutId
      && windowLayoutRuntime.pickerGeneration === generation) closeWindowLayoutPicker();
  }
}

async function closeWindowLayoutCandidate(layoutId, candidateId, candidates) {
  if (!candidates.some((candidate) => candidate.id === candidateId)) return false;
  const bound = await host.bindWindowCandidate(candidateId);
  if (bound.outcome !== 'success') {
    setWindowLayoutTransientStatus(layoutId, bound.error || 'Window is no longer available');
    return false;
  }
  const result = await host.closeWindowCapability(bound.capability);
  if (result.outcome !== 'success') {
    setWindowLayoutTransientStatus(layoutId, result.error || 'Window could not be closed');
    return false;
  }
  await retireClosedWindowEverywhere(bound.descriptor);
  setWindowLayoutTransientStatus(layoutId, 'Window closed', 1200);
  return true;
}

async function closeWindowLayoutMember(layoutId, memberId) {
  const descriptor = WIDGET_SURFACE
    ? (windowLayoutWidgetPreviewSnapshot?.members ?? []).find((member) => member.id === memberId)?.descriptor
    : windowLayoutMemberFromState(layoutId, memberId)?.descriptor;
  const capability = WIDGET_SURFACE
    ? await resolveWindowLayoutPreviewCapability(layoutId, memberId)
    : await capabilityForMember(layoutId, memberId);
  if (!capability) {
    setWindowLayoutTransientStatus(layoutId, 'Window is no longer available');
    return;
  }
  const result = await host.closeWindowCapability(capability);
  if (result.outcome !== 'success') {
    setWindowLayoutTransientStatus(layoutId, result.error || 'Window could not be closed');
    return;
  }
  windowLayoutRuntime.capabilities.delete(windowLayoutMemberKey(layoutId, memberId));
  windowLayoutWidgetPreviewCapabilities.delete(windowLayoutMemberKey(layoutId, memberId));
  if (descriptor) await retireClosedWindowEverywhere(descriptor);
  setWindowLayoutTransientStatus(layoutId, 'Window closed', 1200);
}

function closeWindowLayoutPicker() {
  const layoutId = windowLayoutRuntime.pickerOpenFor;
  windowLayoutRuntime.pickerOpenFor = null;
  windowLayoutRuntime.pickerGeneration += 1;
  const closeRequest = layoutId
    ? host.windowCandidatePickerClose().catch(() => undefined)
    : Promise.resolve();
  windowLayoutRuntime.pickerCandidates = null;
  const pickerHost = layoutId
    ? document.querySelector(`[data-wl-picker="${CSS.escape(layoutId)}"]`)
    : null;
  if (pickerHost) pickerHost.innerHTML = '';
  restoreHoveredWindowLayoutPreview(layoutId);
  return closeRequest;
}

function restoreHoveredWindowLayoutPreview(layoutId) {
  if (!layoutId) return;
  queueMicrotask(() => {
    const member = document.querySelector(`[data-wl-layout="${CSS.escape(layoutId)}"][data-wl-member]:hover`);
    if (!member) return;
    scheduleWindowLayoutPreviewDwell(member);
  });
}

async function handleWindowLayoutPickCandidate(layoutId, candidateId) {
  if (windowLayoutDetachment.isReadOnly()) return;
  const layout = windowLayoutFromState(layoutId);
  if (!layout) return;
  const members = layout.arrangement?.members ?? [];
  const row = (windowLayoutRuntime.pickerCandidates ?? [])
    .find((candidate) => candidate.id === candidateId);
  // 016 toggle: a row matching an existing member removes it (data-only);
  // any other row binds the window and captures its state immediately.
  const existing = row ? members.find((member) => member.descriptor.title === row.title) : null;
  if (existing) {
    const next = removeWindowLayoutMember(state, layoutId, existing.id);
    windowLayoutRuntime.capabilities.delete(windowLayoutMemberKey(layoutId, existing.id));
    windowLayoutRuntime.icons.delete(windowLayoutMemberKey(layoutId, existing.id));
    store.commit(next);
    saveWorkspaceView();
    noteWindowLayoutCommit(layoutId);
    // Removing a member of the active layout re-syncs the observer; removing
    // from an inactive layout never starts recording there.
    if (state.activeWindowLayoutId === layoutId) {
      await windowLayoutRuntimeController.reconcileActive();
    }
    return;
  }
  const bound = await host.bindWindowCandidate(candidateId);
  // 018X4: abort immediately after the await, before the failure status or the
  // success continuation.
  if (windowLayoutDetachment.isReadOnly()) return;
  if (bound.outcome !== 'success') {
    setWindowLayoutStatus(layoutId, windowLayoutStatusForOutcome(bound.outcome));
    return;
  }
  const memberId = crypto.randomUUID();
  // 016: adding a window captures its current valid bounds/state immediately;
  // the creator never presses another button to make the member useful.
  const observed = await host.observeWindowCapability(bound.capability);
  // 018X2: a handoff begun during the bind/observe must abort before the add.
  if (windowLayoutDetachment.isReadOnly()) return;
  const member = {
    id: memberId,
    descriptor: bound.descriptor,
    bounds: observed.outcome === 'success' && observed.observation?.bounds
      ? observed.observation.bounds : null,
    state: observed.outcome === 'success' && observed.observation?.state === 'minimized'
      ? 'minimized' : 'normal',
  };
  const next = addWindowLayoutMember(state, layoutId, member);
  windowLayoutRuntime.capabilities.set(windowLayoutMemberKey(layoutId, memberId), bound.capability);
  const icon = (windowLayoutRuntime.pickerCandidates ?? [])
    .find((candidate) => candidate.id === candidateId)?.icon ?? null;
  if (icon) windowLayoutRuntime.icons.set(windowLayoutMemberKey(layoutId, memberId), icon);
  store.commit(next);
  saveWorkspaceView();
  noteWindowLayoutCommit(layoutId);
  // Adding to a layout selects/persists that layout as the recording context
  // and leaves one active observer.
  await windowLayoutRecording.ensureRecording(layoutId);
}

/** 019B: bounded concurrent group scheduling. At most
 * WINDOW_LAYOUT_GROUP_CONCURRENCY members observe/mutate in flight, so a group
 * action's latency scales with the slowest helper call instead of a fully
 * serialized tail; results stay typed per member and a superseded result
 * (read-only handoff begun mid-batch) aborts the whole batch. */
const WINDOW_LAYOUT_GROUP_CONCURRENCY = 4;
const WINDOW_LAYOUT_GROUP_ABORT = (result) => result === 'superseded';

/** 016 group actions (selected members when any are selected, otherwise all):
 * minimize, restore/open (applies saved bounds), or isolate (restore the
 * targets, minimize only the unselected members OF THIS LAYOUT). One bounded
 * per-member loop with typed results; partial failures are visible. */
async function runGroupMemberAction(layoutId, member, action, results, patches) {
  const capability = await capabilityForMember(layoutId, member.id);
  // 018X7: capabilityForMember yields even on the cached fast path; a handoff
  // entered during that microtask must abort before any host call.
  if (windowLayoutDetachment.isReadOnly()) return 'superseded';
  if (!capability) return 'missing';
  // 018X5: the runner owns the systematic barriers (observe/apply/restore/
  // minimize each abort on read-only at the next executable boundary).
  const outcome = await windowLayoutGroupActionRunner.runMember(capability, member, action);
  if (outcome === 'superseded') return outcome;
  if (outcome !== 'success') return outcome;
  const nextState = action === 'minimize' ? 'minimized' : 'normal';
  if (windowLayoutDetachment.isReadOnly()) return 'superseded';
  results.push({ memberId: member.id, outcome });
  patches.push({ memberId: member.id, state: nextState });
  patchWindowLayoutMember(layoutId, member.id, nextState);
  return outcome;
}

/** 019B: the stale-binding retry moves INSIDE the concurrent worker so a
 * helper restart fails one member's first observe with missing, drops and
 * re-resolves that member ONCE, and retries without deserializing the batch. */
async function runGroupMemberActionWithRetry(layoutId, member, action, results, patches) {
  let outcome = await runGroupMemberAction(layoutId, member, action, results, patches);
  if (outcome === 'missing') {
    windowLayoutRuntime.capabilities.delete(windowLayoutMemberKey(layoutId, member.id));
    const freshCapability = await capabilityForMember(layoutId, member.id);
    // 018X5: abort immediately after the retry resolution await.
    if (windowLayoutDetachment.isReadOnly()) return 'superseded';
    if (freshCapability) {
      outcome = await runGroupMemberAction(layoutId, member, action, results, patches);
      if (outcome !== 'missing') return outcome;
    }
    results.push({ memberId: member.id, outcome: 'missing' });
  }
  return outcome;
}

/** 019B: isolate minimizes ONE unselected member (a bounded concurrent
 * worker); the handoff barriers are identical to the per-member runner. */
async function isolateMinimizeMember(layoutId, member, results, patches) {
  const capability = await capabilityForMember(layoutId, member.id);
  // 018X5: abort immediately after the isolate resolution await.
  if (windowLayoutDetachment.isReadOnly()) return 'superseded';
  if (!capability) {
    results.push({ memberId: member.id, outcome: 'missing' });
    return 'missing';
  }
  const result = await host.minimizeWindowCapability(capability);
  // 018X5: abort immediately after the minimize await before the UI patch.
  if (windowLayoutDetachment.isReadOnly()) return 'superseded';
  results.push({ memberId: member.id, outcome: result.outcome });
  if (result.outcome === 'success') {
    patches.push({ memberId: member.id, state: 'minimized' });
    patchWindowLayoutMember(layoutId, member.id, 'minimized');
  }
  return result.outcome;
}

/** 019B: prewarms every target's capability concurrently (the host descriptor
 * resolves fan out in one round trip instead of a serialized tail), then runs
 * the per-member actions through a BOUNDED concurrent scheduler with typed
 * results, a superseded abort and a final abort barrier before the single
 * committed state. `explicitTargetIds` lets Shift+right-click toggle ONLY the
 * clicked member when no inner range is selected (019B) without disturbing the
 * selection UI. */
async function windowLayoutGroupAction(layoutId, action, explicitTargetIds = null) {
  if (windowLayoutDetachment.isReadOnly()) return;
  const layout = windowLayoutFromState(layoutId);
  if (!layout) return;
  const members = layout.arrangement?.members ?? [];
  if (members.length === 0) return;
  const selected = explicitTargetIds
    ? new Set(explicitTargetIds)
    : windowLayoutRuntime.selectedMembers.get(layoutId);
  const targets = selected && selected.size > 0
    ? members.filter((member) => selected.has(member.id)) : members;
  const results = [];
  const patches = [];
  // 019B prewarm: resolve every target's capability before the batch so the
  // bounded observes/mutates below are cache-hot. A handoff entered during the
  // fan-out aborts before any host call.
  await Promise.all(targets.map((member) => capabilityForMember(layoutId, member.id)));
  if (windowLayoutDetachment.isReadOnly()) return;
  await runBoundedConcurrent(
    targets,
    WINDOW_LAYOUT_GROUP_CONCURRENCY,
    (member) => runGroupMemberActionWithRetry(layoutId, member, action, results, patches),
    WINDOW_LAYOUT_GROUP_ABORT,
  );
  if (action === 'isolate') {
    const unselected = selected && selected.size > 0
      ? members.filter((member) => !selected.has(member.id)) : [];
    if (unselected.length > 0) {
      await Promise.all(unselected.map((member) => capabilityForMember(layoutId, member.id)));
      if (windowLayoutDetachment.isReadOnly()) return;
      await runBoundedConcurrent(
        unselected,
        WINDOW_LAYOUT_GROUP_CONCURRENCY,
        (member) => isolateMinimizeMember(layoutId, member, results, patches),
        WINDOW_LAYOUT_GROUP_ABORT,
      );
    }
  }
  // 018X5/019B: the FINAL abort barrier — a handoff begun during any in-flight
  // member (returned 'superseded') or discovered by the runner aborts the
  // ENTIRE action before the committed state, status and controller ensure.
  if (windowLayoutDetachment.isReadOnly() || windowLayoutGroupActionRunner.aborted()) return;
  // Chain every member patch into ONE next state and commit once, so a later
  // patch can never clobber an earlier one with stale state.
  let nextState = state;
  for (const patch of patches) {
    nextState = updateWindowLayoutMember(nextState, layoutId, patch.memberId, { state: patch.state });
  }
  if (patches.length > 0) {
    store.replace(nextState);
    noteWindowLayoutCommit(layoutId);
  }
  queueWindowLayoutSave();
  const failed = results.filter((result) => result.outcome !== 'success').length;
  if (failed > 0) setWindowLayoutStatus(layoutId, `${failed} of ${results.length} members failed`);
  else setWindowLayoutStatus(layoutId, '');
  // Group actions select/persist this layout as the recording context and
  // leave one active observer; an already-active layout only re-syncs members.
  await windowLayoutRecording.ensureRecording(layoutId);
}

/** 019B/019C Shift+right-click: minimizes/restores the SELECTED RANGE (or just
 * the clicked member when no inner range is selected) toward the OPPOSITE of
 * the clicked member's live state — clicking a minimized member restores the
 * range, otherwise it minimizes it. `explicitMemberIds` (the widget-sourced
 * range, 019C) overrides the workspace-local inner selection without touching
 * it. The direction is probed once (one observe) and the batch keeps per-member
 * typed results through the bounded scheduler. Plain right-click on a member
 * still falls through to the workspace menu. */
async function windowLayoutToggleRange(layoutId, clickedMemberId, explicitMemberIds = null) {
  if (windowLayoutDetachment.isReadOnly()) return;
  const member = windowLayoutMemberFromState(layoutId, clickedMemberId);
  if (!member) return;
  const selected = explicitMemberIds !== null
    ? new Set(explicitMemberIds)
    : windowLayoutRuntime.selectedMembers.get(layoutId);
  const hasRange = Boolean(selected && selected.size > 0);
  const capability = await capabilityForMember(layoutId, clickedMemberId);
  // 018X5: abort immediately after the probe resolution await.
  if (windowLayoutDetachment.isReadOnly()) return;
  if (!capability) {
    setWindowLayoutStatus(layoutId, 'Window not visible');
    return;
  }
  const observed = await host.observeWindowCapability(capability);
  // 018X4: abort immediately after the observe await, before success/failure.
  if (windowLayoutDetachment.isReadOnly()) return;
  if (observed.outcome !== 'success' || !observed.observation) {
    if (observed.outcome === 'missing') {
      windowLayoutRuntime.capabilities.delete(windowLayoutMemberKey(layoutId, clickedMemberId));
      windowLayoutRuntimeController.invalidateCapabilities(layoutId);
    }
    setWindowLayoutStatus(layoutId, windowLayoutStatusForOutcome(observed.outcome));
    return;
  }
  const liveState = observed.observation.state === 'minimized' ? 'minimized' : 'normal';
  const action = liveState === 'minimized' ? 'restore' : 'minimize';
  const range = explicitMemberIds !== null
    ? explicitMemberIds
    : (hasRange ? null : [clickedMemberId]);
  await windowLayoutGroupAction(layoutId, action, range);
}

/** 016 direct onscreen pick: begin the Papers-owned pick session for THIS
 * layout and wait for its single typed result (Escape/right-click cancels). */
function uniqueWindowLayoutMemberDescriptors(members) {
  const unique = new Map();
  for (const descriptor of members) {
    const key = `${descriptor.executableFingerprint ?? ''}|${descriptor.title ?? ''}`;
    if (!unique.has(key)) unique.set(key, descriptor);
  }
  return [...unique.values()];
}

async function beginWindowLayoutDirectPick(layoutId) {
  console.info('[045-direct-pick] begin-enter', layoutId);
  if (windowLayoutDetachment.isReadOnly()) return;
  const layout = windowLayoutFromState(layoutId);
  if (!layout) return;
  // 019G: the pick overlay covers the desktop; clear/discard the hover preview.
  windowLayoutMemberPreview.cancel();
  // The chooser is a native always-on-top window. Do not race its asynchronous
  // destruction against the Papers-owned direct picker: until it is gone it
  // can retain foreground/ownership and make the picker appear to do nothing.
  await closeWindowLayoutPicker();
  windowLayoutRuntime.pickLayoutId = layoutId;
  const pickAttempt = Symbol('window-layout-direct-pick');
  windowLayoutRuntime.pickAttempt = pickAttempt;
  const members = uniqueWindowLayoutMemberDescriptors(
    (layout.arrangement?.members ?? []).map((member) => member.descriptor),
  );
  let result = null;
  let pickUnsubscribe = null;
  try {
    // A renderer reload or an abandoned picker can leave the Papers-owned
    // session alive after this page has lost its result listener. Always
    // cancel that one-shot session first so clicking Direct Pick is itself
    // the recovery action. Cancelling an idle session is intentionally a
    // no-op.
    await host.pickWindowCancel();
    // 016R: subscribe to the result push BEFORE awaiting begin, so a pick
    // that completes while begin() is still resolving (immediate click on an
    // eligible window) is never missed. A failed begin removes the listener
    // again; the main-side session clears onResult on failure, so nothing
    // can deliver afterwards.
    console.info('[045-direct-pick] begin-request', layoutId, members.length);
    const beginPromise = host.pickWindowBegin(members);
    const pickPromise = new Promise((resolve) => {
      pickUnsubscribe = host.onPickResult(resolve);
      windowLayoutRuntime.pickUnsubscribe = pickUnsubscribe;
    });
    const begin = await beginPromise;
    console.info('[045-direct-pick] begin-result', layoutId, begin?.outcome, begin?.error ?? '');
    // 018X4: abort immediately after the begin await, before the failure status.
    if (windowLayoutDetachment.isReadOnly()) {
      pickUnsubscribe?.();
      if (windowLayoutRuntime.pickUnsubscribe === pickUnsubscribe) {
        windowLayoutRuntime.pickUnsubscribe = null;
      }
      return;
    }
    if (begin.outcome !== 'started') {
      pickUnsubscribe?.();
      if (windowLayoutRuntime.pickUnsubscribe === pickUnsubscribe) {
        windowLayoutRuntime.pickUnsubscribe = null;
      }
      setWindowLayoutStatus(layoutId, begin.error || 'Direct pick is unavailable');
      return;
    }
    result = await pickPromise;
    // 018X4: abort immediately after the result, before success OR failure
    // handling (the non-picked status must never fire post-handoff).
    if (windowLayoutDetachment.isReadOnly()) return;
  } catch (error) {
    console.error('[045-direct-pick] begin-error', String(error));
    pickUnsubscribe?.();
    if (windowLayoutRuntime.pickUnsubscribe === pickUnsubscribe) {
      windowLayoutRuntime.pickUnsubscribe = null;
    }
    if (windowLayoutDetachment.isReadOnly()) return;
    setWindowLayoutStatus(layoutId, 'Direct pick is unavailable');
    return;
  } finally {
    pickUnsubscribe?.();
    if (windowLayoutRuntime.pickUnsubscribe === pickUnsubscribe) {
      windowLayoutRuntime.pickUnsubscribe = null;
    }
    if (windowLayoutRuntime.pickAttempt === pickAttempt) {
      windowLayoutRuntime.pickAttempt = null;
      windowLayoutRuntime.pickLayoutId = null;
    }
  }
  // 019C: Winter's pick session returns ONE typed committed set (Enter) or a
  // zero-mutation cancel (Escape). Every remove is applied data-only and every
  // successful add is bound, all persisted ONCE by the pick applier; the active
  // layout identity is preserved and the one recording controller continues.
  if (result.outcome === 'cancelled') {
    setWindowLayoutStatus(layoutId, '');
    return;
  }
  if (result.outcome !== 'committed') {
    setWindowLayoutStatus(layoutId, result.error || 'Pick failed');
    return;
  }
  // 018X1R: after awaited pick/host work, re-check the read-only handoff so an
  // in-flight pick result can never mutate post-handoff state.
  if (windowLayoutDetachment.isReadOnly()) return;
  await applyWindowLayoutPickSet(layoutId, result);
}

function syncWindowLayoutMemberSelection(layoutId) {
  const selected = windowLayoutRuntime.selectedMembers.get(layoutId);
  const container = document.querySelector(`[data-wl-members="${CSS.escape(layoutId)}"]`);
  if (!container) return;
  for (const button of container.querySelectorAll('[data-wl-member]')) {
    const isSelected = Boolean(selected?.has(button.dataset.wlMember));
    button.classList.toggle('selected', isSelected);
    button.setAttribute('aria-selected', String(isSelected));
  }
}

function clearWindowLayoutMemberSelection(layoutId) {
  if (!layoutId || !(windowLayoutRuntime.selectedMembers.get(layoutId)?.size > 0)) return;
  windowLayoutRuntime.selectedMembers.delete(layoutId);
  windowLayoutRuntime.selectionAnchor.delete(layoutId);
  syncWindowLayoutMemberSelection(layoutId);
}

function toggleWindowLayoutIsolateMode(layoutId) {
  if (!layoutId || windowLayoutDetachment.isReadOnly()) return;
  const active = windowLayoutRuntime.isolateMode.toggle(layoutId);
  for (const button of document.querySelectorAll(`[data-wl-min-all="${CSS.escape(layoutId)}"]`)) {
    button.classList.toggle('isolate-mode-active', active);
    button.setAttribute('aria-pressed', String(active));
  }
}

/** 019B/019GR bounded tooltip/popover DOM seam for a member. ONE shared fixed
 * popover (per document) is reused across every layout and card: it shows the
 * member's NATIVE ICON (when available) + FULL name and carries the live
 * preview slot (`data-wl-popover-preview`) for the real thumbnail. The
 * icon/name fallback stays when no preview is supplied. Bounded: pointer-events
 * none, positioned on hover and RE-POSITIONED when the preview image changes
 * the popover size, hidden on leave/scroll/resize; it never makes a host call. */
function createWindowLayoutMemberPopover() {
  let element = null;
  let lastAnchor = null;
  let lastName = '';
  let animationFrame = null;
  function ensure() {
    if (element) return element;
    element = document.createElement('div');
    element.className = 'window-layout-member-popover';
    element.setAttribute('data-wl-popover', 'true');
    element.hidden = true;
    element.innerHTML =
      '<div class="window-layout-member-popover-title">'
      + '<img class="window-layout-member-popover-icon" data-wl-popover-icon alt="" hidden>'
      + '<div class="window-layout-member-popover-name" data-wl-popover-name></div>'
      + '</div>'
      + '<div class="window-layout-member-popover-preview" data-wl-popover-preview></div>';
    document.body.appendChild(element);
    return element;
  }
  function position() {
    const popover = element;
    if (!popover || !lastAnchor) return;
    const rect = popover.getBoundingClientRect();
    const margin = 6;
    const left = Math.max(margin, Math.min(
      window.innerWidth - rect.width - margin,
      lastAnchor.left + lastAnchor.width / 2 - rect.width / 2,
    ));
    let top = lastAnchor.top - rect.height - margin;
    if (top < margin) top = lastAnchor.bottom + margin;
    // 034: keep the WHOLE popover (including a real-window preview) inside the
    // viewport - in the content-fit detached widget the window is small, so a
    // top-placed preview must not overflow the bottom edge.
    if (top + rect.height > window.innerHeight - margin) top = window.innerHeight - rect.height - margin;
    if (top < margin) top = margin;
    popover.style.left = `${Math.round(left)}px`;
    popover.style.top = `${Math.round(top)}px`;
  }
  return {
    show(name, anchorRect, iconSrc = null) {
      lastName = name;
      // Widget thumbnails live in their own naturally-sized native window.
      // Retain only the anchor here; a local name popover is cramped by the
      // compact widget viewport and duplicates the preview's title.
      if (WIDGET_SURFACE) {
        lastAnchor = anchorRect;
        if (element) {
          element.classList.remove('is-visible');
          element.hidden = true;
        }
        return;
      }
      const popover = ensure();
      const nameNode = popover.querySelector('[data-wl-popover-name]');
      if (nameNode) nameNode.textContent = name;
      const iconNode = popover.querySelector('[data-wl-popover-icon]');
      if (iconNode) {
        if (iconSrc) {
          iconNode.src = iconSrc;
          iconNode.hidden = false;
        } else {
          iconNode.removeAttribute('src');
          iconNode.hidden = true;
        }
      }
      const preview = popover.querySelector('[data-wl-popover-preview]');
      if (preview) preview.replaceChildren();
      popover.hidden = false;
      popover.classList.remove('is-visible');
      lastAnchor = anchorRect;
      position();
      if (animationFrame !== null) cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => {
        animationFrame = null;
        if (!popover.hidden) popover.classList.add('is-visible');
      });
    },
    hide() {
      if (animationFrame !== null) {
        cancelAnimationFrame(animationFrame);
        animationFrame = null;
      }
      if (element) {
        element.classList.remove('is-visible');
        element.hidden = true;
      }
      if (WIDGET_SURFACE) void host.widgetPreviewHide().catch(() => undefined);
    },
    /** 019GR: the preview image changed the popover size - re-clamp placement
     * against the SAME member anchor so it never jumps off-screen. */
    reposition() {
      if (!element || element.hidden || !lastAnchor) return;
      position();
    },
    /** 019C seam: fill the live-preview slot (thumbnail markup). Passing null
     * clears it back to the icon/name-only fallback. 034: once the preview
     * image finishes decoding it changes the popover size, so placement is
     * re-clamped then (and when already complete) to keep the WHOLE popover
     * inside the host viewport - never clipped by host/card bounds. */
    updatePreview(memberId, previewMarkup) {
      const preview = ensure().querySelector('[data-wl-popover-preview]');
      if (!preview) return;
      if (WIDGET_SURFACE) {
        preview.replaceChildren();
        if (previewMarkup == null) {
          void host.widgetPreviewHide().catch(() => undefined);
          return;
        }
        const holder = document.createElement('div');
        holder.innerHTML = previewMarkup;
        const img = holder.querySelector('.window-layout-member-preview-image');
        if (!img || !lastAnchor) return;
        const width = Number(img.getAttribute('width'));
        const height = Number(img.getAttribute('height'));
        if (!Number.isFinite(width) || !Number.isFinite(height)) return;
        void host.widgetPreviewShow(img.src, lastName, width, height, {
          x: Math.round(window.screenX + lastAnchor.left),
          y: Math.round(window.screenY + lastAnchor.top),
          width: Math.round(lastAnchor.width),
          height: Math.round(lastAnchor.height),
        }).catch(() => undefined);
        return;
      }
      const popover = ensure();
      if (previewMarkup == null) {
        preview.replaceChildren();
        popover.classList.remove('has-preview');
        popover.style.removeProperty('width');
      } else {
        preview.innerHTML = previewMarkup;
        const declaredWidth = Number(preview.querySelector('.window-layout-member-preview-image')?.getAttribute('width'));
        if (Number.isFinite(declaredWidth) && declaredWidth > 0) {
          popover.classList.add('has-preview');
          popover.style.width = `${declaredWidth}px`;
        }
      }
      const img = preview.querySelector('.window-layout-member-preview-image');
      if (img) {
        img.addEventListener('load', () => windowLayoutMemberPopover.reposition(), { once: true });
        if (img.complete) windowLayoutMemberPopover.reposition();
      }
    },
  };
}
const windowLayoutMemberPopover = createWindowLayoutMemberPopover();
const WINDOW_LAYOUT_PREVIEW_DWELL_MS = 100;
let windowLayoutPreviewDwellTimer = null;

function cancelWindowLayoutPreviewDwell() {
  if (windowLayoutPreviewDwellTimer !== null) {
    clearTimeout(windowLayoutPreviewDwellTimer);
    windowLayoutPreviewDwellTimer = null;
  }
}

function scheduleWindowLayoutPreviewDwell(member) {
  cancelWindowLayoutPreviewDwell();
  const layoutId = member.dataset.wlLayout;
  const memberId = member.dataset.wlMember;
  const name = member.getAttribute('aria-label') ?? member.title ?? '';
  const iconSrc = member.querySelector('.window-layout-member-icon')?.getAttribute('src') ?? null;
  const anchor = member.getBoundingClientRect();
  windowLayoutPreviewDwellTimer = setTimeout(() => {
    windowLayoutPreviewDwellTimer = null;
    if (!member.isConnected || !member.matches(':hover')) return;
    if (name) windowLayoutMemberPopover.show(name, anchor, iconSrc);
    windowLayoutMemberPreview.schedule(layoutId, memberId);
  }, WINDOW_LAYOUT_PREVIEW_DWELL_MS);
}

// 019GR surface-aware preview capability resolution. The WORKSPACE resolves the
// member's capability from durable state via the existing runtime logic. The
// COMPACT-WIDGET surface owns only widgetState.snapshot (durable state lives in
// the workspace window), so it turns the snapshot member descriptor into a
// capability through the host and caches it in a MEMORY-ONLY map — a capability
// is never placed in snapshot/channel/durable state. The cache is cleared on
// missing/removal, snapshot replacement (renderWidgetCard) and pagehide.
const windowLayoutWidgetPreviewCapabilities = new Map();
let windowLayoutWidgetPreviewSnapshot = null;

function resolveWindowLayoutPreviewCapability(layoutId, memberId) {
  if (!WIDGET_SURFACE) return capabilityForMember(layoutId, memberId);
  // 040: composite layout\u0000member cache identity so the widget preview for
  // one layout never reuses a capability cached under another layout's member.
  const key = windowLayoutMemberKey(layoutId, memberId);
  const member = (windowLayoutWidgetPreviewSnapshot?.members ?? [])
    .find((candidate) => candidate.id === memberId);
  if (!member || !member.descriptor || typeof member.descriptor !== 'object' || Array.isArray(member.descriptor)) {
    windowLayoutWidgetPreviewCapabilities.delete(key);
    return Promise.resolve(null);
  }
  const cached = windowLayoutWidgetPreviewCapabilities.get(key);
  if (cached) return Promise.resolve(cached);
  return Promise.resolve(host.resolveWindowDescriptor(member.descriptor)).then((resolved) => {
    if (!resolved || resolved.outcome !== 'success' || !resolved.capability) {
      windowLayoutWidgetPreviewCapabilities.delete(key);
      return null;
    }
    windowLayoutWidgetPreviewCapabilities.set(key, resolved.capability);
    return resolved.capability;
  });
}

// 019G real window thumbnail preview (Windows-taskbar-like hover card). The
// shared popover shows the member ICON + FULL title immediately; the thumbnail
// capture is debounced 120 ms and requests the member's CURRENT capability at
// 240x135. A strictly valid data-PNG success renders a bounded static <img> and
// re-clamps popover placement; everything else stays an honest icon/name-only
// fallback. The generation/latest-only guard drops stale replies, and cancel()
// (pointer leave, scroll, resize, picker start, card removal, pagehide)
// discards pending work + clears the preview. No state/store writes, no
// animation/flashing.
const windowLayoutMemberPreview = createWindowLayoutMemberPreview({
  resolveCapability: resolveWindowLayoutPreviewCapability,
  requestThumbnail: (capability, options) => host.windowThumbnailCapability(capability, options),
  setPreviewImage: (imageUrl, width, height) => {
    windowLayoutMemberPopover.updatePreview(null,
      `<img class="window-layout-member-preview-image" src="${escapeHtml(imageUrl)}" alt="" width="${width}" height="${height}">`);
    // 019GR: the image changed the popover size - re-clamp placement.
    windowLayoutMemberPopover.reposition();
  },
  clearPreview: () => windowLayoutMemberPopover.updatePreview(null, null),
});

// Shift-hover mirrors taskbar Peek semantics using a reversible host session:
// every other currently visible eligible window is temporarily minimized, and
// only windows changed by this session are restored on release/leave.
let windowLayoutShiftPeekHeld = false;
let windowLayoutShiftPeekGeneration = 0;
let windowLayoutShiftPeekKey = null;
let windowLayoutShiftPeekEndTimer = null;
let windowLayoutShiftPeekStartTimer = null;

function endWindowLayoutShiftPeek() {
  if (windowLayoutShiftPeekStartTimer !== null) {
    clearTimeout(windowLayoutShiftPeekStartTimer);
    windowLayoutShiftPeekStartTimer = null;
  }
  if (windowLayoutShiftPeekEndTimer !== null) {
    clearTimeout(windowLayoutShiftPeekEndTimer);
    windowLayoutShiftPeekEndTimer = null;
  }
  windowLayoutShiftPeekGeneration += 1;
  windowLayoutShiftPeekKey = null;
  void host.windowPeekEnd().catch(() => undefined);
}

function deferWindowLayoutShiftPeekEnd() {
  if (windowLayoutShiftPeekEndTimer !== null) clearTimeout(windowLayoutShiftPeekEndTimer);
  windowLayoutShiftPeekEndTimer = setTimeout(() => {
    windowLayoutShiftPeekEndTimer = null;
    windowLayoutShiftPeekHeld = false;
    endWindowLayoutShiftPeek();
  }, 120);
}

function keepWindowLayoutShiftPeekAlive() {
  if (windowLayoutShiftPeekEndTimer === null) return;
  clearTimeout(windowLayoutShiftPeekEndTimer);
  windowLayoutShiftPeekEndTimer = null;
}

function beginWindowLayoutShiftPeek(member) {
  const layoutId = member?.dataset?.wlLayout;
  const memberId = member?.dataset?.wlMember;
  if (!layoutId || !memberId) return;
  const key = `${layoutId}\u0000${memberId}`;
  if (windowLayoutShiftPeekKey === key) return;
  const generation = ++windowLayoutShiftPeekGeneration;
  windowLayoutShiftPeekKey = key;
  if (windowLayoutShiftPeekStartTimer !== null) clearTimeout(windowLayoutShiftPeekStartTimer);
  cancelWindowLayoutPreviewDwell();
  windowLayoutMemberPopover.hide();
  windowLayoutMemberPreview.cancel();
  // Explorer's compositor path is private; our bounded foreign-window
  // fallback must never queue one native transition for every icon crossed.
  // Coalesce traversal within two display frames: an A->B->C sweep performs C
  // only, while an intentional hover remains effectively immediate.
  windowLayoutShiftPeekStartTimer = setTimeout(() => {
    windowLayoutShiftPeekStartTimer = null;
    void performWindowLayoutShiftPeek(member, layoutId, memberId, generation);
  }, 32);
}

async function performWindowLayoutShiftPeek(member, layoutId, memberId, generation) {
  const capability = await resolveWindowLayoutPreviewCapability(layoutId, memberId);
  if (generation !== windowLayoutShiftPeekGeneration
    || !windowLayoutShiftPeekHeld
    || !member.isConnected
    || !member.matches(':hover')
    || !capability) return;
  await host.windowPeekBeginCapability(capability).catch(() => undefined);
  if (generation !== windowLayoutShiftPeekGeneration) void host.windowPeekEnd().catch(() => undefined);
}

window.addEventListener('keydown', (event) => {
  if (event.key !== 'Shift' || event.repeat) return;
  windowLayoutShiftPeekHeld = true;
  const member = document.querySelector('[data-wl-member]:hover');
  if (member) void beginWindowLayoutShiftPeek(member);
});
window.addEventListener('keyup', (event) => {
  if (event.key !== 'Shift') return;
  windowLayoutShiftPeekHeld = false;
  endWindowLayoutShiftPeek();
});
window.addEventListener('blur', () => {
  windowLayoutShiftPeekHeld = false;
  endWindowLayoutShiftPeek();
});

// 019B/019GR hover wiring via the pure exact-member transition predicate: a move
// between descendants of the SAME member (icon/indicator) is ignored (no
// reschedule/clear); entering a member shows icon+title and schedules; leaving
// this EXACT member (to another member or the outside) hides + cancels before
// the next member schedules. Scrolling (a card may have scrolled the strip) or
// resizing hides the popover and cancels the pending preview. Read-only safe.
elements.grid.addEventListener('mouseover', (event) => {
  const listButton = event.target.closest('[data-wl-list]');
  const relatedListButton = event.relatedTarget?.closest?.('[data-wl-list]') ?? null;
  // The compact widget installs its own membership-aware opener on the card.
  // Do not let this workspace delegate replace that dwell after the event
  // bubbles to the grid; widget-local state is authoritative there.
  if (!WIDGET_SURFACE && listButton && listButton !== relatedListButton) {
    scheduleWindowLayoutListDwell(
      listButton,
      () => openWindowLayoutPicker(listButton.dataset.wlList),
    );
    return;
  }
  const member = event.target.closest('[data-wl-member]');
  const relatedMember = event.relatedTarget?.closest?.('[data-wl-member]') ?? null;
  if (member && member !== relatedMember && (event.shiftKey || windowLayoutShiftPeekHeld)) {
    keepWindowLayoutShiftPeekAlive();
    windowLayoutShiftPeekHeld = true;
    void beginWindowLayoutShiftPeek(member);
    return;
  }
  const state = windowLayoutPreviewHoverState(member, relatedMember);
  if (state === 'outside') {
    if (!event.target.closest('[data-wl-popover]')) {
      cancelWindowLayoutPreviewDwell();
      windowLayoutMemberPopover.hide();
      windowLayoutMemberPreview.cancel();
    }
    return;
  }
  if (state === 'inside') return;
  scheduleWindowLayoutPreviewDwell(member);
});
// The detached widget is deliberately non-focusable, so it cannot reliably
// receive Shift keydown/keyup. Mouse/pointer events still carry the physical
// modifier state. Track that state while the pointer moves so Shift Peek works
// even when Shift was pressed before entering the widget.
elements.grid.addEventListener('pointermove', (event) => {
  const member = event.target.closest('[data-wl-member]');
  if (event.shiftKey && member) {
    keepWindowLayoutShiftPeekAlive();
    windowLayoutShiftPeekHeld = true;
    void beginWindowLayoutShiftPeek(member);
    return;
  }
  if (!event.shiftKey && windowLayoutShiftPeekHeld) {
    windowLayoutShiftPeekHeld = false;
    endWindowLayoutShiftPeek();
  }
});
elements.grid.addEventListener('mouseout', (event) => {
  const listButton = event.target.closest('[data-wl-list]');
  const relatedListButton = event.relatedTarget?.closest?.('[data-wl-list]') ?? null;
  if (listButton && listButton !== relatedListButton) cancelWindowLayoutListDwell();
  const member = event.target.closest('[data-wl-member]');
  const relatedMember = event.relatedTarget?.closest?.('[data-wl-member]') ?? null;
  // Crossing directly from one member to another is a Peek transition, not a
  // release. Keep the session alive so the host can reveal only the new target
  // and hide only the old one. End only when the pointer leaves the member row.
  if (member && !relatedMember && windowLayoutShiftPeekKey) deferWindowLayoutShiftPeekEnd();
  const state = windowLayoutPreviewHoverState(member, relatedMember);
  if (state === 'enter') {
    cancelWindowLayoutPreviewDwell();
    windowLayoutMemberPopover.hide();
    windowLayoutMemberPreview.cancel();
  }
});
elements.grid.addEventListener('auxclick', (event) => {
  if (event.button !== 1) return;
  const restoreAll = event.target.closest('[data-wl-restore-all]');
  if (restoreAll && !detachedWidgets.has(restoreAll.dataset.wlRestoreAll)) {
    event.preventDefault();
    event.stopPropagation();
    void host.widgetOpen(restoreAll.dataset.wlRestoreAll).catch(() => undefined);
    return;
  }
  const minimizeAll = event.target.closest('[data-wl-min-all]');
  if (minimizeAll && detachedWidgets.has(minimizeAll.dataset.wlMinAll)) {
    event.preventDefault();
    event.stopPropagation();
    const layoutId = minimizeAll.dataset.wlMinAll;
    if (detachedWidgets.delete(layoutId)) render();
    void host.widgetClose(layoutId).catch(() => undefined);
    return;
  }
  if (!event.ctrlKey) return;
  const member = event.target.closest('[data-wl-member]');
  if (!member || member.disabled) return;
  event.preventDefault();
  event.stopPropagation();
  cancelWindowLayoutPreviewDwell();
  windowLayoutMemberPopover.hide();
  windowLayoutMemberPreview.cancel();
  void closeWindowLayoutMember(member.dataset.wlLayout, member.dataset.wlMember);
});
document.addEventListener('scroll', () => {
  cancelWindowLayoutPreviewDwell();
  windowLayoutMemberPopover.hide();
  windowLayoutMemberPreview.cancel();
}, true);
window.addEventListener('resize', () => {
  cancelWindowLayoutPreviewDwell();
  windowLayoutMemberPopover.hide();
  windowLayoutMemberPreview.cancel();
});
window.addEventListener('pagehide', () => {
  endWindowLayoutShiftPeek();
  cancelWindowLayoutPreviewDwell();
  windowLayoutMemberPreview.cancel();
});

/** 017I2: exactly ONE controller owns recording (switch, timer, observation,
 * echo suppression). This wiring glues the pure controller to the real model
 * and store: persisted active id, byte-stable inactive arrangements,
 * minimized restore bounds preserved, debounced prompt saves and typed
 * status. The old per-entry recording timer / global observationPending /
 * single suppression path are retired. */
const windowLayoutRecording = createWindowLayoutRecordingWiring({
  getLayout: windowLayoutFromState,
  host: {
    resolveWindowDescriptor: (descriptor) => host.resolveWindowDescriptor(descriptor),
    observeWindowCapability: (capability) => host.observeWindowCapability(capability),
    applyWindowCapability: (capability, bounds) => host.applyWindowCapability(capability, bounds),
    minimizeWindowCapability: (capability) => host.minimizeWindowCapability(capability),
    restoreWindowCapability: (capability) => host.restoreWindowCapability(capability),
  },
  model: { setActiveWindowLayoutId, updateWindowLayoutMember },
  getState: () => state,
  replaceState: (next) => { state = store.replace(next); },
  scheduleSave: queueWindowLayoutSave,
  setStatus: setWindowLayoutStatus,
  patchMember: patchWindowLayoutMember,
  statusText: windowLayoutStatusForOutcome,
  onRetireMember: (intent) => handleWindowLayoutRetireMember(intent),
});
const windowLayoutRuntimeController = windowLayoutRecording.runtime;

// ---- 018A1 exclusive-controller handoff (As You Go half) ------------------
// One controller/observer/save owner at any time. While detached the workspace
// is read-only (persist gate + stopped controller + cancelled pick); the
// detached surface loads durable state and starts the controller ONLY after
// ACTIVATE. Detached READY is reported before any load/bootstrap.
function cancelWindowLayoutPick() {
  windowLayoutRuntime.pickUnsubscribe?.();
  windowLayoutRuntime.pickUnsubscribe = null;
  // 018X1R: return the host cancel promise so the handoff AWAITS the pick
  // cancel before controller stop/flush/ACK (a late pick result must not
  // overtake the handoff).
  return host.pickWindowCancel().catch(() => undefined);
}

// 018A1/018X1 read-only capture guard: while a layout controller is detached
// the workspace is an inert summary. A full-viewport transparent overlay
// swallows every pointer gesture (navigation/selection included); a small fixed
// toolbar ABOVE the overlay keeps only Focus/Reattach usable. Durable writes
// are additionally blocked by the detach save gate (persist/commit/replace).
// Z-indexes stay within the CSS 32-bit clamp: overlay 2147483646, toolbar
// 2147483647 (toolbar one above the overlay, neither exceeding the max).
let detachReadOnlyOverlay = null;
let detachReadOnlyToolbar = null;
// 018X1R/018X2: while read-only, capture-phase keyboard/beforeinput events are
// swallowed so keyboard mutations (typing, Ctrl+Z, workspace hotkeys) cannot
// reach the workspace. No arbitrary toolbar key is exempted; only Enter/Space
// 018X3: read-only input guards (workspace hotkeys blocked; only the
// Focus/Reattach toolbar is usable — pointer events targeted at it pass
// through, Enter/Space on a focused button activate it exactly once).
const detachReadOnlyInputGuards = createDetachReadOnlyInputGuards({
  windowRef: window,
  getToolbar: () => detachReadOnlyToolbar,
});
function buildDetachReadOnlyToolbar() {
  const toolbar = document.createElement('div');
  toolbar.setAttribute('data-detach-readonly', 'true');
  Object.assign(toolbar.style, {
    position: 'fixed',
    top: '12px',
    right: '12px',
    zIndex: '2147483647',
    display: 'flex',
    gap: '6px',
  });
  const focus = document.createElement('button');
  focus.type = 'button';
  focus.textContent = 'Focus';
  focus.className = 'window-layout-control wl-focus';
  focus.addEventListener('click', () => void windowLayoutDetachment.focusDetached().catch(() => undefined));
  const reattach = document.createElement('button');
  reattach.type = 'button';
  reattach.textContent = 'Reattach';
  reattach.className = 'window-layout-control wl-reattach';
  reattach.addEventListener('click', () => void windowLayoutDetachment.reattach().catch(() => undefined));
  toolbar.append(focus, reattach);
  return toolbar;
}
function setDetachReadOnly(flag) {
  detachSaveGate.setReadOnly(flag);
  if (flag) {
    // 018X2 item 9: cancel any in-progress graph drag (rolls back node
    // positions) and any active marquee (releases capture / hides the overlay
    // WITHOUT the finish command), before the capture guards prevent a
    // still-captured pointerup from finalizing after the handoff.
    pointer?.cancelDrag?.();
    marquee?.cancel?.();
    // 018X4: cancel the separate 016 member drag (clears state/capture/visuals
    // without finalizing a move) so it cannot revive after disarm/pointer reuse.
    cancelWindowLayoutDrag();
    if (!detachReadOnlyOverlay) {
      detachReadOnlyOverlay = document.createElement('div');
      detachReadOnlyOverlay.setAttribute('data-detach-readonly', 'true');
      Object.assign(detachReadOnlyOverlay.style, {
        position: 'fixed',
        inset: '0',
        zIndex: '2147483646',
        cursor: 'default',
        background: 'transparent',
      });
      document.body.appendChild(detachReadOnlyOverlay);
    }
    if (!detachReadOnlyToolbar) {
      detachReadOnlyToolbar = buildDetachReadOnlyToolbar();
      document.body.appendChild(detachReadOnlyToolbar);
    }
    detachReadOnlyInputGuards.arm();
  } else {
    if (detachReadOnlyOverlay) {
      detachReadOnlyOverlay.remove();
      detachReadOnlyOverlay = null;
    }
    if (detachReadOnlyToolbar) {
      detachReadOnlyToolbar.remove();
      detachReadOnlyToolbar = null;
    }
    detachReadOnlyInputGuards.disarm();
  }
}

// 019G/021: the legacy 018 full-surface detach (windowLayoutDetachment) is
// RETIRED from reachability. Detach now opens the compact layout-only widget
// (widgetOpen) which never freezes the workspace, so these guards are inert:
// the workspace is never read-only and the old `?detach=1` branch below can
// never activate (mode is always 'workspace'). The compact-widget guards (the
// widget never writes the store) are untouched.
const windowLayoutDetachment = {
  isReadOnly: () => false,
  getState: () => ({ mode: 'workspace', readOnly: false, detachedActive: false, stopped: false, transferId: null, busy: false }),
  isStopped: () => false,
  stop: () => undefined,
  reattach: () => Promise.resolve(),
  focusDetached: () => Promise.resolve(),
  reportReady: () => Promise.resolve(),
  waitForActivate: () => Promise.resolve(null),
};

// 018X5: systematic await/read-only barrier for the group member actions.
const windowLayoutGroupActionRunner = createWindowLayoutGroupActionRunner({
  isReadOnly: () => windowLayoutDetachment.isReadOnly(),
  host,
});

// ---- 019C compact widget surface (As You Go half) -------------------------
// One native widget per layout, opened/focused by the workspace and closed by
// the widget itself. The workspace is the SOLE durable writer and revision
// source: the widget only sends bounded command intents over a same-origin
// BroadcastChannel and never touches the store/save/recording persistence.
// The workspace writer applies commands through the EXISTING functions/store.
// 035: layouts whose compact widget is currently open. Their attached card is
// a greyed placeholder (the widget is the sole live card); the set is driven by
// the widget's widget-ready/dispose channel announcements.
const detachedWidgets = new Set();
// 040: module-level handle to the WIDGET surface's channel client so the shared
// context-menu action (`Remove from this layout`) can route the removal intent
// through the widget channel instead of writing the store from the widget. Set
// when the widget bootstraps, cleared on pagehide.
let windowLayoutWidgetClient = null;

async function retireClosedWindowEverywhere(descriptor) {
  if (WIDGET_SURFACE) {
    return Boolean(windowLayoutWidgetClient?.sendCommand({
      kind: 'retire-closed-window',
      descriptor,
    }));
  }
  if (windowLayoutDetachment.isReadOnly()) return false;
  const removedByLayout = new Map();
  for (const layout of state.windowLayouts ?? []) {
    const removed = (layout.arrangement?.members ?? []).filter((member) =>
      member.descriptor.title === descriptor.title
      && member.descriptor.executableFingerprint.toLowerCase()
        === descriptor.executableFingerprint.toLowerCase());
    if (removed.length > 0) removedByLayout.set(layout.id, removed);
  }
  if (removedByLayout.size === 0) return false;
  const next = removeClosedWindowFromAllLayouts(state, descriptor);
  const persisted = await store.commit(next);
  for (const [changedLayoutId, removed] of removedByLayout) {
    const removedIds = new Set(removed.map((member) => member.id));
    for (const memberId of removedIds) {
      const key = windowLayoutMemberKey(changedLayoutId, memberId);
      windowLayoutRuntime.capabilities.delete(key);
      windowLayoutRuntime.icons.delete(key);
      windowLayoutWidgetPreviewCapabilities.delete(key);
    }
    const selected = windowLayoutRuntime.selectedMembers.get(changedLayoutId);
    if (selected) {
      for (const memberId of removedIds) selected.delete(memberId);
      if (selected.size === 0) windowLayoutRuntime.selectedMembers.delete(changedLayoutId);
      syncWindowLayoutMemberSelection(changedLayoutId);
    }
    if (removedIds.has(windowLayoutRuntime.selectionAnchor.get(changedLayoutId))) {
      windowLayoutRuntime.selectionAnchor.delete(changedLayoutId);
    }
    setWindowLayoutStatus(changedLayoutId, '');
    noteWindowLayoutCommit(changedLayoutId, { reason: 'closed-window-retired' });
  }
  windowLayoutMemberPreview.cancel();
  if ([...removedByLayout.keys()].includes(state.activeWindowLayoutId)) {
    await windowLayoutRuntimeController.reconcileActive();
  }
  return persisted;
}

const windowLayoutWidgetChannelWorkspace = createWindowLayoutWidgetChannelWorkspace({
  channel: new BroadcastChannel(WINDOW_LAYOUT_WIDGET_CHANNEL),
  getLayout: windowLayoutFromState,
  snapshot: (layout, memberIcon) => ({
    ...windowLayoutWidgetSnapshot(layout, memberIcon),
    // The compact surface does not load the whole workspace state. Carry only
    // the bounded visual preferences needed to render the same native window
    // transparency/theme as its host Backpack.
    appearance: {
      theme: getTheme(state.view?.preferences),
      transparentBackground: getTransparentBackground(state.view?.preferences),
      backdropOpacity: getBackdropOpacity(state.view?.preferences),
    },
  }),
  // 019G/021: the workspace's icon cache feeds the bounded snapshot icon so the
  // widget renders REAL member icons (bounded to the channel byte cap).
  // 040: composite layout\u0000member cache identity.
  memberIcon: (layoutId, memberId) => windowLayoutRuntime.icons.get(windowLayoutMemberKey(layoutId, memberId)) ?? null,
  // 035: a widget announcing itself marks its attached card as a placeholder;
  // a dispose restores it. Both re-render the graph node.
  onWidgetOpen: (layoutId) => {
    if (detachedWidgets.has(layoutId)) return;
    detachedWidgets.add(layoutId);
    render();
  },
  onWidgetDispose: (layoutId) => {
    if (!detachedWidgets.delete(layoutId)) return;
    render();
  },
  // 035: the live widget reports its window content size; the workspace persists
  // it to the shared card geometry (replace + save, no history/selection churn)
  // so reattach mirrors it.
  onCardSize: (layoutId, width, height) => {
    let next;
    try {
      next = setWindowLayoutCardSize(state, layoutId, width, height);
    } catch {
      return;
    }
    if (next === state) return;
    store.replace(next);
    void store.save(next).catch(() => undefined);
  },
  applyCommand: async (layoutId, command) => {
    if (windowLayoutDetachment.isReadOnly()) return { ok: false, error: 'read-only' };
    if (command.kind === 'member-toggle') {
      await handleWindowLayoutMemberClick(layoutId, command.memberId);
      return { ok: true };
    }
    if (command.kind === 'remove-member') {
      // 040: the widget's `Remove from this layout` routes to the existing
      // scoped data-only unlink writer (composite cache cleanup, one
      // persistence, active-only reconcile). Never a cross-layout mutation.
      handleWindowLayoutUnlink(layoutId, command.memberId);
      return { ok: true };
    }
    if (command.kind === 'retire-closed-window') {
      await retireClosedWindowEverywhere(command.descriptor);
      return { ok: true };
    }
    if (command.kind === 'group-action') {
      await windowLayoutGroupAction(layoutId, command.action,
        command.memberIds.length > 0 ? command.memberIds : null);
      return { ok: true };
    }
    if (command.kind === 'range-toggle') {
      await windowLayoutToggleRange(layoutId, command.memberId,
        command.memberIds.length > 0 ? command.memberIds : [command.memberId]);
      return { ok: true };
    }
    if (command.kind === 'reorder') {
      // 024: the widget drag-reorder intent - applied through the EXISTING
      // model reorder, persisted once and broadcast back to open widgets.
      const next = reorderWindowLayoutMember(state, layoutId, command.memberId, command.toIndex);
      if (next !== state) {
        // commit() already owns the one queued persistence write. The former
        // saveWorkspaceView() issued a second identical host request per drop;
        // repeated drags could backlog the bridge and surface a false timeout.
        const persisted = await store.commit(next);
        if (!persisted) return { ok: false, error: 'reorder persistence failed' };
        noteWindowLayoutCommit(layoutId, { reason: 'reorder' });
      }
      return { ok: true };
    }
    if (command.kind === 'picker-commit') {
      const applied = await applyWindowLayoutPickSet(layoutId, command.pick);
      // 019DR: a read-only handoff that began during observation surfaces as a
      // typed superseded failure (zero commit/save/recording mutation), so the
      // widget never sees a false committed result.
      return applied.outcome === 'superseded'
        ? { ok: false, error: 'superseded' }
        : { ok: true };
    }
    return { ok: false, error: 'unknown command' };
  },
});
const windowLayoutPickApplier = createWindowLayoutPickApplier({
  getState: () => state,
  // 019I: store.commit() installs state synchronously via setState and RETURNS
  // a Promise<boolean> for persistence. NEVER assign that Promise to `state`
  // (JSON.stringify(Promise) == "{}" would corrupt the durable snapshot).
  commitState: (next) => store.commit(next),
  observeCapability: (capability) => host.observeWindowCapability(capability),
  model: { addWindowLayoutMember, removeWindowLayoutMember },
  capabilities: windowLayoutRuntime.capabilities,
  icons: windowLayoutRuntime.icons,
  isReadOnly: () => windowLayoutDetachment.isReadOnly(),
});
const windowLayoutRetirementWriter = createWindowLayoutRetirementWriter({
  getState: () => state,
  // 019I: same rule as the pick applier - invoke the real commit, never assign
  // its persistence Promise to the global state.
  commitState: (next) => store.commit(next),
  model: { removeWindowLayoutMember },
  capabilities: windowLayoutRuntime.capabilities,
  icons: windowLayoutRuntime.icons,
});

/** 019C/019DR: applies Winter's ONE typed committed pick set (every remove
 * data-only, every successful add) with a single durable commit; cancel is
 * byte-zero and a read-only handoff begun mid-apply surfaces as typed
 * `superseded` with zero commit/save/recording mutation. */
async function applyWindowLayoutPickSet(layoutId, result) {
  if (windowLayoutDetachment.isReadOnly()) return { outcome: 'failed', error: 'read-only' };
  const applied = await windowLayoutPickApplier.apply(layoutId, result);
  if (applied.outcome === 'committed') {
    windowLayoutWidgetChannelWorkspace.noteCommitted(layoutId);
    if (applied.failures > 0) {
      setWindowLayoutStatus(layoutId, `${applied.failures} member${applied.failures === 1 ? '' : 's'} could not be added`);
    } else {
      setWindowLayoutStatus(layoutId, '');
    }
    // Adding to a layout selects/persists it as the recording context and
    // leaves one active observer; an already-active layout only re-syncs.
    await windowLayoutRecording.ensureRecording(layoutId);
  }
  return applied;
}

/** 019C: Ning's onRetireMember intent -> ONE data-only removal/save and a
 * status/selection refresh. An intent for a member/layout that no longer
 * exists is ignored; counters are never persisted. */
function handleWindowLayoutRetireMember(intent) {
  const { layoutId, memberId } = intent ?? {};
  if (!layoutId || !memberId) return;
  if (windowLayoutDetachment.isReadOnly()) return;
  const result = windowLayoutRetirementWriter.retire(layoutId, memberId);
  if (result.outcome !== 'removed') return;
  // 019G: a removed card must clear/discard any pending hover preview.
  windowLayoutMemberPreview.cancel();
  windowLayoutWidgetChannelWorkspace.noteCommitted(layoutId);
  setWindowLayoutStatus(layoutId, '');
  const selected = windowLayoutRuntime.selectedMembers.get(layoutId);
  if (selected?.delete(memberId)) syncWindowLayoutMemberSelection(layoutId);
}

/** 019C: after any OTHER durable window-layout commit the workspace broadcasts
 * the fresh snapshot/revision so open widgets re-sync (the channel workspace
 * also answers command intents itself). */
function noteWindowLayoutCommit(layoutId, options) {
  windowLayoutWidgetChannelWorkspace.noteCommitted(layoutId, options);
}

function queueWindowLayoutSave() {
  clearTimeout(windowLayoutRuntime.saveTimer);
  windowLayoutRuntime.saveTimer = setTimeout(() => {
    saveWorkspaceView();
  }, WINDOW_LAYOUT_SAVE_DEBOUNCE_MS);
}

/** Bootstrap: reconcile the persisted active id WITHOUT inventing one. Returns
 * the real controller switch promise so the detached/workspace RESUMED ACK
 * follows actual owner start (018X1). A null id means no recording context
 * until the creator touches a layout. */
function bootstrapWindowLayoutRecording() {
  if (state.activeWindowLayoutId) {
    return windowLayoutRecording.ensureRecording(state.activeWindowLayoutId);
  }
  return Promise.resolve();
}

/** Teardown: stop the recording timer and drop ephemeral capabilities without
 * a late save (the persisted active id stays for the next open to reconcile).
 * A pending debounced save is cancelled so no write races the unload. This is
 * the CONTROLLER stop used by the detach handoff too, so it must NOT stop the
 * detach lifecycle: the workspace still has to receive CLOSED/crash and
 * resume. 018X2 item 8: the runtime stop Promise is RETURNED so the factory's
 * `await stopController()` is a real await. The pagehide handler performs the
 * full lifecycle stop. */
function teardownWindowLayoutRecording() {
  clearTimeout(windowLayoutRuntime.saveTimer);
  windowLayoutRuntime.saveTimer = null;
  windowLayoutRuntime.pickUnsubscribe?.();
  windowLayoutRuntime.pickUnsubscribe = null;
  return windowLayoutRuntimeController.stop({ clearActive: false });
}

// 018X1: pagehide performs only the detach LIFECYCLE stop (the controller stop
// is owned by the handoff and by the controller's own seams; a second stop here
// would be a duplicate that could race an in-flight transfer).
window.addEventListener('pagehide', () => windowLayoutDetachment.stop());

window.addEventListener('pagehide', () => teardownWindowLayoutRecording());

function handleWindowLayoutUnlink(layoutId, memberId) {
  if (windowLayoutDetachment.isReadOnly()) return;
  const layout = windowLayoutFromState(layoutId);
  if (!layout || !memberId) return;
  // 019G: a removed card must clear/discard any pending hover preview.
  windowLayoutMemberPreview.cancel();
  const next = removeWindowLayoutMember(state, layoutId, memberId);
  windowLayoutRuntime.capabilities.delete(windowLayoutMemberKey(layoutId, memberId));
  windowLayoutRuntime.icons.delete(windowLayoutMemberKey(layoutId, memberId));
  store.commit(next);
  closeWindowLayoutPicker();
  saveWorkspaceView();
  noteWindowLayoutCommit(layoutId);
  // Unlinking a member of the active layout re-syncs the observer; unlinking
  // from an inactive layout never starts recording there. Unlinking the last
  // member leaves the id retained with no timer (retry on the next add).
  if (state.activeWindowLayoutId === layoutId) {
    void windowLayoutRuntimeController.reconcileActive();
  }
}

const graph = createGraphController();

function createGraphController() {
  const nodes = new Map();
  const edges = new Map();
  const originEdges = new Map();
  let onDragCancel = null;
  let onRestPositions = null;
  let simulation = null;
  let zoomBehavior = null;
  let viewportSelection = null;
  let viewport = null;
  let camera = null;
  let edgeLayer = null;
  let setLayer = null;
  let regionLayer = null;
  let effectsLayer = null;
  // One path per set, and the ring nodes whose positions it is drawn through.
  // The nodes live in the simulation alongside the icons, so the outline is
  // wherever the physics put them rather than a shape computed from the
  // members' positions.
  const setShapes = new Map();
  const regionShapes = new Map();
  // Overlap-component discovery, per-component caching and the dense-cluster
  // fallback all live in the layout engine; this file only composes.
  const regionLayout = createRegionLayout();
  const setRings = new Map();
  const setEffects = createSetEffectsController({ document, animate });
  const dragTrail = createDragTrailController({ document, animate });
  // A ring node's collision radius.
  //
  // This was 18, reasoned as "only has to exceed half the spacing, since an
  // icon is stopped by the pair of nodes it meets". That holds for an icon the
  // simulation is free to move, and fails for a dragged one: a drag pins the
  // node's position outright, so the ring must physically occupy the space
  // rather than push back. Measured with a foreign tile pinned and walked to
  // the set centre, 18 was breached at x=20 and 26 at x=0.
  //
  // 36 is half a tile, so a ring node is as substantial as the thing it is
  // resisting, and the boundary holds at every position. Tighter spacing
  // (linkDistance 40, radius 26) also works but costs 50% more ring nodes for
  // the same result.
  const RING_NODE_RADIUS = 30;
  const RING_LINK_DISTANCE = 60;
  let nodeLayer = null;
  let svg = null;
  let resizeObserver = null;
  let rafId = 0;
  let pendingFrame = false;
  let initialized = false;
  let fitPending = false;
  let attached = false;
  let updatePending = false;
  let pendingInitialFit = false;
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');

  // Folder hues retain their position solver state; set hues retain a seeded,
  // distance-drift state. Both maps are session-only and never persisted.
  // One namespace is shared by folders and visible set outlines. Prefixing
  // ids prevents a folder id and set id with the same text from colliding.
  const spatialColors = new Map();
  const spatialHueState = new Map();

  function folderColor(id) {
    const hue = spatialColors.get(`folder:${id}`);
    // OKLCH spacing tracks perceived difference better than HSL; 68% lightness
    // and 0.18 chroma read clearly on the warm paper background.
    return typeof hue === 'number' ? `oklch(68% 0.18 ${hue}deg)` : null;
  }

  function setColor(id) {
    const hue = spatialColors.get(`set:${id}`);
    return typeof hue === 'number' ? `oklch(68% 0.18 ${hue}deg)` : null;
  }

  function regionColor(id) {
    const hue = spatialColors.get(`region:${id}`);
    return typeof hue === 'number' ? `oklch(68% 0.18 ${hue}deg)` : null;
  }

  function createGraphView() {
    if (attached) return;
    viewport = document.createElement('div');
    viewport.className = 'graph-viewport';
    viewport.id = 'graph-viewport';
    viewport.dataset.blankParent = session.binMode ? 'bin' : session.currentId;

    camera = document.createElement('div');
    camera.className = 'graph-camera';

    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'graph-edges-svg');
    svg.setAttribute('aria-hidden', 'true');
    // Set outlines sit behind the edges so tiles and links stay readable on
    // top of them.
    setLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    setLayer.setAttribute('class', 'graph-set-layer');
    regionLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    regionLayer.setAttribute('class', 'graph-set-region-layer');
    effectsLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    effectsLayer.setAttribute('class', 'graph-set-effects-layer');
    dragTrail.setLayer(effectsLayer);
    edgeLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    svg.append(regionLayer, effectsLayer, setLayer, edgeLayer);
    syncEdgeOpacity();

    nodeLayer = document.createElement('div');
    nodeLayer.className = 'graph-node-layer';

    camera.append(svg, nodeLayer);
    viewport.append(camera);
    elements.grid.append(viewport);

    try {
      zoomBehavior = zoom()
        .scaleExtent([0.35, 3])
        .filter((event) => {
          if (event.type === 'mousedown' && event.button === 0) return false;
          if (event.type === 'dblclick') return false;
          if (event.type === 'wheel' && event.ctrlKey) return false;
          return true;
        })
        .on('zoom', ({ transform }) => {
          if (camera) {
            camera.style.transform = `translate(${transform.x}px, ${transform.y}px) scale(${transform.k})`;
          }
        });
      viewportSelection = select(viewport);
      viewportSelection.call(zoomBehavior);
    } catch (error) {
      viewport.remove();
      viewport = null;
      camera = null;
      edgeLayer = null;
      setLayer = null;
      regionLayer = null;
      effectsLayer = null;
      setShapes.clear();
      setRings.clear();
      nodeLayer = null;
      svg = null;
      throw error;
    }

    resizeObserver = new ResizeObserver(() => {
      const w = viewport?.clientWidth ?? 0;
      const h = viewport?.clientHeight ?? 0;
      if (w >= 2 && h >= 2) {
        if (simulation) {
          simulation.force('cx').x(w / 2);
          simulation.force('cy').y(h / 2);
        }
        if (updatePending || fitPending) {
          updatePending = false;
          updateGraphView(pendingInitialFit);
        }
      }
    });
    resizeObserver.observe(viewport);
    attached = true;
  }

  function destroyGraphView() {
    onDragCancel?.();
    if (simulation) { simulation.stop(); simulation = null; }
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; pendingFrame = false; }
    nodes.forEach((node) => {
      if (node.exitTimer) { clearTimeout(node.exitTimer); node.exitTimer = null; }
      removeWindowLayoutCardPresentation(node.shell);
    });
    if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null; }
    nodes.clear();
    edges.clear();
    originEdges.clear();
    // The paths go with the viewport below, but the maps that track them would
    // otherwise survive into the next attach and describe rings that no longer
    // exist.
    setShapes.clear();
    regionShapes.clear();
    regionLayout.update([]);
    setRings.clear();
    setEffects.clear();
    dragTrail.clear();
    if (viewport) { viewport.remove(); viewport = null; }
    camera = null;
    edgeLayer = null;
    setLayer = null;
    regionLayer = null;
    effectsLayer = null;
    nodeLayer = null;
    svg = null;
    viewportSelection = null;
    zoomBehavior = null;
    attached = false;
    initialized = false;
    fitPending = false;
    updatePending = false;
    pendingInitialFit = false;
  }

  function scheduleRender() {
    if (pendingFrame) return;
    pendingFrame = true;
    rafId = requestAnimationFrame(() => {
      pendingFrame = false;
      rafId = 0;
      drawFrame();
    });
  }

  function drawFrame() {
    nodes.forEach((node) => {
      if (node.exiting || !node.shell) return;
      node.shell.style.transform =
        `translate3d(${node.x}px, ${node.y}px, 0) translate(-50%, -50%) scale(${node.visualScale ?? 1})`;
    });
    drawSetRings();
    syncEdgeOpacity();
    syncFolderColors();
    edges.forEach((edge) => {
      const source = nodes.get(edge.sourceId);
      const target = nodes.get(edge.targetId);
      if (!source || !target || !edge.path) return;
      const d = edgePath(source.x, source.y, target.x, target.y);
      if (edge.lastPathD === d) return;
      edge.lastPathD = d;
      edge.path.setAttribute('d', d);
    });
    originEdges.forEach((edge) => {
      const source = nodes.get(edge.sourceId);
      const target = nodes.get(edge.targetId);
      if (!source || !target || !edge.path) return;
      const d = edgePath(source.x, source.y, target.x, target.y);
      if (edge.lastPathD === d) return;
      edge.lastPathD = d;
      edge.path.setAttribute('d', d);
    });
  }

  function syncEdgeOpacity() {
    const preferences = state.view?.preferences;
    // Trail opacity styles ancestor TILES, which live in the node layer rather
    // than inside the edges <svg> — so it is written to the root element, and
    // written BEFORE the svg guard below, or it would silently never apply
    // whenever the graph view happens not to be attached yet.
    const trailOpacity = String(getTrailOpacity(preferences));
    if (document.documentElement.style.getPropertyValue('--graph-trail-opacity') !== trailOpacity) {
      document.documentElement.style.setProperty('--graph-trail-opacity', trailOpacity);
    }
    if (!svg) return;
    const values = {
      '--graph-edge-opacity': getEdgeOpacity(preferences),
      '--graph-outline-opacity': getOutlineOpacity(preferences),
      '--graph-region-opacity': getRegionOpacity(preferences),
    };
    for (const [property, value] of Object.entries(values)) {
      const opacity = String(value);
      if (svg.style.getPropertyValue(property) !== opacity) svg.style.setProperty(property, opacity);
    }
  }

  function edgePath(x1, y1, x2, y2) {
    const mx = (x1 + x2) / 2;
    return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
  }

  /** Every folder an item sits inside, walked up to the root, nearest first.
   *
   * belongsToSet uses this to decide inherited membership: putting a folder in
   * a set covers its contents, so a child is a member when any ancestor is.
   * Passing nothing would make inheritance silently stop working, and passing
   * an undefined identifier — which is what this replaces — threw on every
   * group attempt with "ancestorsOfNode is not defined".
   *
   * The chain comes from the graph's own parentIds rather than the stored
   * folder tree, because that is what the visible layout is built from. */
  function ancestorsOfNode(nodeId) {
    const chain = [];
    const seen = new Set();
    const node = nodes.get(nodeId);
    const queue = (node?.parentIds?.length ? [...node.parentIds] : [node?.parentId]).filter(Boolean);
    while (queue.length > 0) {
      const parentId = queue.shift();
      if (!parentId || parentId === ROOT_ID || parentId === 'bin' || seen.has(parentId)) continue;
      seen.add(parentId);
      chain.push(parentId);
      const parent = nodes.get(parentId);
      if (parent?.parentIds?.length) queue.push(...parent.parentIds);
      else if (parent?.parentId) queue.push(parent.parentId);
    }
    return chain;
  }

  /** Which sets this node belongs to, by the same rule the ring is drawn from.
   *
   * Membership is inherited, so a folder's contents count — resolving it any
   * other way here would let the forces disagree with the outline about who is
   * inside what. */
  /** Whether an id is trail-derived in this view (an ancestor body or
   * anything revealed beneath an expanded ancestor). Trail items are
   * outside the set system here: they never join a ring, never receive a
   * set force, and are never ejected. This is the single predicate every
   * set consumer reads, so none of them can disagree. */
  function isTrailNode(id) {
    return nodes.get(id)?.candidate?.trail === true;
  }

  /** Every non-trail node — the bodies that participate in the set system
   * for this view. Shared by membership resolution, ring members and the
   * ejection sweep, so they all see the same eligible set. */
  function setEligibleNodes() {
    return [...nodes.values()].filter((node) => !node.exiting && !node.candidate?.trail);
  }

  function setIdsContaining(nodeId) {
    // Trail bodies are not members of anything drawn here. Sets express how
    // the creator organised their real items, and a trail body wandering
    // into a ring — or being pulled by its gravity — misrepresents that.
    // Excluding them at this one function keeps the outline and the forces
    // agreeing, which is the invariant the rest of this block depends on.
    if (isTrailNode(nodeId)) return [];
    const ids = [];
    for (const itemSet of state.view?.itemSets ?? []) {
      if (belongsToSet(itemSet, nodeId, ancestorsOfNode)) ids.push(itemSet.id);
    }
    return ids;
  }

  /** A direct member visible at this level makes the set eligible to draw here. */
  function setDrawsAtCurrentLevel(itemSet, visibleIds) {
    return directSetMemberIdsVisible(itemSet, visibleIds).length > 0;
  }

  /** The visible members of a set, as rectangles the ring can enclose. The
   * eligibility gate above is intentionally separate: once a set draws, its
   * outline encloses every visible inherited member, not only direct members.
   * Trail bodies are excluded from the visible ids entirely, so they can
   * neither make a set eligible to draw nor be enclosed by its outline. */
  function membersOnScreen(setId) {
    const itemSet = (state.view?.itemSets ?? []).find((candidate) => candidate.id === setId);
    if (!itemSet) return [];
    const eligible = setEligibleNodes();
    const visibleIds = eligible.map((node) => node.id);
    if (!setDrawsAtCurrentLevel(itemSet, visibleIds)) return [];
    const inheritedIds = new Set(inheritedSetMemberIdsVisible(itemSet, visibleIds, ancestorsOfNode));
    const members = [];
    for (const node of eligible) {
      if (!inheritedIds.has(node.id)) continue;
      members.push({ id: node.id, x: node.x, y: node.y, width: node.width, height: node.height });
    }
    return members;
  }

  /** Creates and removes the ring for each set that has members on screen.
   *
   * The ring nodes are added to the simulation by syncSimulation, so this only
   * decides how many there should be and where new ones start. It runs on
   * structural changes rather than every frame: the node count follows the
   * ring's perimeter, which only changes when members move appreciably. */
  function syncSetRings() {
    if (!setLayer) {
      console.warn('[as-you-go] syncSetRings called with no set layer');
      return;
    }
    const wanted = new Set();
    for (const itemSet of (state.view?.itemSets ?? [])) {
      const members = membersOnScreen(itemSet.id);
      // A set with nothing on screen has no ring to draw; it still exists in
      // the data and comes back when its members do.
      if (members.length === 0) continue;
      wanted.add(itemSet.id);

      const previous = setRings.get(itemSet.id)?.nodes ?? [];
      const ring = reconcileRing({ setId: itemSet.id, members, existing: previous });
      setRings.set(itemSet.id, ring);

      const existingShape = setShapes.get(itemSet.id);
      if (existingShape) {
        // Back before the fade finished. Clearing the flag both restores the
        // outline and tells the pending timer to leave it alone.
        if (existingShape.retiring) {
          existingShape.retiring = false;
          existingShape.path?.classList.remove('set-retiring');
          existingShape.glyphs?.classList.remove('set-retiring');
        }
      } else {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const glyphs = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('class', 'graph-set-outline');
        glyphs.setAttribute('class', 'graph-set-glyphs');
        path.dataset.setId = itemSet.id;
        glyphs.dataset.setId = itemSet.id;
        setLayer.append(path);
        setLayer.append(glyphs);
        setShapes.set(itemSet.id, { setId: itemSet.id, path, glyphs, glyphLayoutKey: null });
      }
    }

    for (const [setId, shape] of setShapes) {
      if (wanted.has(setId)) continue;
      // Faded rather than cut. A set loses its ring whenever its members leave
      // the screen, and removing the path outright made the outline disappear
      // between two frames — indistinguishable, to the eye, from the set
      // popping. The CSS transition carries it out; the node is removed when
      // that finishes, so a set whose members come straight back reuses it.
      if (!shape.retiring) {
        shape.retiring = true;
        shape.path?.classList.add('set-retiring');
        shape.glyphs?.classList.add('set-retiring');
        setRings.delete(setId);
        window.setTimeout(() => {
          // Re-checked on landing. The members may have returned during the
          // fade and cleared the flag, or the layer may have been rebuilt
          // wholesale and this entry replaced — the identity check catches the
          // second, which a flag alone would not.
          if (setShapes.get(setId) !== shape || !shape.retiring) return;
          shape.path?.remove();
          shape.glyphs?.remove();
          setShapes.delete(setId);
      }, 200);
      }
    }

    const picking = setMembershipMode?.isActive() === true;
    const chosen = picking ? new Set(setMembershipMode.chosenSetIds()) : null;
    const partial = picking ? new Set(setMembershipMode.mixedSetIds()) : null;
    syncSetRegions({ picking, chosen, partial });
    setEffects.sync({
      selectedSetIds: session.selectedSets,
      regions: regionShapes,
      colorFor: regionColor,
      effectsLayer,
    });

    // One line per reconcile, so a set that exists in the data but never
    // reaches the screen can be told apart from one that was never created.
    // The three numbers are the three places it can go wrong: no sets stored,
    // sets stored but no members matched on screen, or members matched but no
    // ring built.
    const stored = (state.view?.itemSets ?? []).length;
    let ringNodes = 0;
    for (const ring of setRings.values()) ringNodes += ring.nodes.length;
    console.info(`[as-you-go] rings: ${stored} set(s) stored, ${setShapes.size} drawn, ${ringNodes} ring nodes`);
  }

  /** Which sets' rings enclose a point, smallest first.
   *
   * Tested against the ring nodes rather than the drawn path: the nodes are
   * where the physics put them and the path is drawn through them, so the two
   * agree by construction — there is no second geometry to fall out of step
   * with what is on screen.
   *
   * Smallest first so clicking inside a small set nested in a larger one picks
   * the small one, which is the set the click is most specifically about. */
  function setIdsAtPoint(point) {
    const hits = [];
    for (const [setId, ring] of setRings) {
      if (ring.nodes.length < 3) continue;
      if (!pointInRing(point, ring.nodes)) continue;
      hits.push({ setId, area: ringArea(ring.nodes) });
    }
    return hits.sort((a, b) => a.area - b.area).map((hit) => hit.setId);
  }

  /** Moves any of these items that ended up inside a set they do not belong to
   * back outside it, along the shortest path.
   *
   * Called when a drag is released, not while it runs. The ring cannot stop a
   * drag: a dragged node's position is set outright rather than nudged, so
   * collision has nothing to push back against, and stiffening the boundary
   * enough to try made the whole set convulse while foreign items still got in.
   * Letting the gesture do whatever it likes and correcting afterwards means
   * the screen the user is left looking at states the true relationship.
   *
   * Members are exempt: an item inside its own set is where it should be. A
   * folder's contents inherit its sets, so belongsToSet decides this rather
   * than the stored member list. */
  function ejectTrespassers(itemIds) {
    // Every visible node by default, not only the ones just dragged. An item
    // can end up inside a set it does not belong to without being touched —
    // the ring moves when its members do, and expanding a folder drops new
    // tiles wherever the layout puts them. Checking only the drag left those
    // sitting inside with nothing to correct them.
    const candidates = itemIds ?? [...nodes.keys()];
    for (const itemId of candidates) {
      const node = nodes.get(itemId);
      if (!node || node.exiting) continue;
      // Trail bodies are outside the set system entirely. They are not
      // members, but they are not trespassers either — ejecting them would
      // still be a set acting on the trail, and it would shove a navigation
      // or trail-revealed body across the canvas for being near a ring it
      // has nothing to do with.
      if (node.candidate?.trail) continue;

      for (const [setId, ring] of setRings) {
        if (ring.nodes.length < 3) continue;
        const itemSet = (state.view?.itemSets ?? []).find((candidate) => candidate.id === setId);
        if (!itemSet) continue;
        if (belongsToSet(itemSet, itemId, ancestorsOfNode)) continue;

        const target = ejectionTarget({ x: node.x, y: node.y }, ring.nodes);
        if (!target) continue;
        node.x = target.x;
        node.y = target.y;
        // The pinned coordinates too, or the next tick puts it straight back
        // where it was — a drag leaves fx/fy set, and they win over x/y.
        if (node.fx != null) node.fx = target.x;
        if (node.fy != null) node.fy = target.y;
      }
    }
  }

  /** Ray casting against the ring's hull — the shape actually on screen.
   *
   * This walked the chain in ringIndex order, which assumed the loop stays
   * ordered. It does not: RING-TANGLE.md measured neighbours 317 degrees apart
   * after a drag, and a ray cast over a crossed loop reports points plainly
   * inside the outline as outside, silently.
   *
   * A click has to select what the user pointed at, so this must read the same
   * hull that drawSetRings draws. */
  function pointInRing(point, nodes) {
    const ring = ringHull(nodes);
    if (ring.length < 3) return false;
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const a = ring[i];
      const b = ring[j];
      if ((a.y > point.y) === (b.y > point.y)) continue;
      const crossX = a.x + ((point.y - a.y) / (b.y - a.y)) * (b.x - a.x);
      if (point.x < crossX) inside = !inside;
    }
    return inside;
  }

  /** Shoelace area of the hull, used only to order overlapping hits.
   *
   * Same reason as pointInRing: the formula sums signed trapezoids around a
   * loop, so a reordered node list gives a number that is not the area of
   * anything and nested sets get ranked wrongly. The hull is also the area the
   * user perceives, which is what "smallest first where they nest" means. */
  function ringArea(nodes) {
    const ring = ringHull(nodes);
    let total = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      total += (ring[j].x * ring[i].y) - (ring[i].x * ring[j].y);
    }
    return Math.abs(total) / 2;
  }

  /** Redraws each outline through its ring nodes' current positions.
   *
   * Cheap enough for every frame — it reads positions and builds a path string,
   * with no sampling, routing or contour extraction. That is the whole point of
   * the ring: the expensive part is the simulation, which was already running.
   */
  function drawSetRings() {
    // Read once per frame rather than per set: while the picker is open these
    // are the same for every outline, and they are what makes the canvas the
    // picker rather than a list.
    const picking = setMembershipMode?.isActive() === true;
    const chosen = picking ? new Set(setMembershipMode.chosenSetIds()) : null;
    const partial = picking ? new Set(setMembershipMode.mixedSetIds()) : null;
    for (const [setId, shape] of setShapes) {
      const ring = setRings.get(setId);

      // The outline is eased towards the physics rather than snapped to it, and
      // held open to a floor area. Recomputing the hull per frame is what made a
      // set able to shrivel or blink out between frames when its ring collapsed
      // or briefly degenerated; the drawn shape is its own state, so it settles
      // instead of popping. A null target leaves the last good shape standing.
      // The floor is the members' own tiles, so the outline can never shrink
      // inside the items it is drawn around. Read live rather than cached: the
      // members are what the floor is made of, and they move every frame.
      // 40 matches reconcileRing's and forceRingShape's padding default, which
      // is the gap the ring settles at: the floor has to agree with where the
      // physics is already trying to hold the boundary, or the two fight.
      const floor = ring ? memberFloorHull(membersOnScreen(setId), 40) : null;
      const target = ring ? floorOutline(resampleHull(ringHull(ring.nodes)), floor) : null;
      shape.outline = easeOutline(shape.outline, target);
      const outlinePath = shape.outline ? ringPath(shape.outline, { hulled: true }) : '';
      if (shape.lastPathD !== outlinePath) {
        shape.lastPathD = outlinePath;
        shape.path.setAttribute('d', outlinePath);
      }
      const title = (state.view?.itemSets ?? []).find((candidate) => candidate.id === setId)?.title?.trim() ?? '';
      const named = title.length > 0 && Array.isArray(shape.outline);
      shape.path.classList.toggle('set-named', named);
      shape.glyphs?.classList.toggle('set-named', named);
      // The outline is live while a ring moves, so every coordinate belongs in
      // the key: caching a partial geometry key would visibly detach lettering
      // from its body. Once the eased outline and title are unchanged, settled
      // frames reuse the exact decorative path instead of rebuilding it.
      const glyphLayoutKey = named
        ? `${title}|${shape.outline.map(({ x, y }) => `${x},${y}`).join('|')}`
        : '';
      if (shape.glyphLayoutKey !== glyphLayoutKey) {
        shape.glyphs?.setAttribute('d', named ? glyphPath(layoutTitleGlyphs(shape.outline, title)) : '');
        shape.glyphLayoutKey = glyphLayoutKey;
      }
      shape.path.classList.toggle('set-selected', session.selectedSets?.has(setId) === true);
      shape.path.classList.toggle('set-picking', picking);
      shape.path.classList.toggle('set-chosen', picking && chosen.has(setId));
      // Neither in nor out: Enter leaves a partial set exactly as it is, so it
      // must not read as either.
      shape.path.classList.toggle('set-partial', picking && partial.has(setId));
      shape.glyphs?.classList.toggle('set-selected', session.selectedSets?.has(setId) === true);
      shape.glyphs?.classList.toggle('set-picking', picking);
      shape.glyphs?.classList.toggle('set-chosen', picking && chosen.has(setId));
      shape.glyphs?.classList.toggle('set-partial', picking && partial.has(setId));
    }
    syncSetRegions({ picking, chosen, partial });
    setEffects.sync({
      selectedSetIds: session.selectedSets,
      regions: regionShapes,
      colorFor: regionColor,
      effectsLayer,
    });
  }

  function syncSetRegions({ picking, chosen, partial }) {
    if (!regionLayer) return;
    const source = [...setShapes.values()]
      .filter((shape) => !shape.retiring && Array.isArray(shape.outline) && shape.outline.length >= 3)
      .map((shape) => ({ id: shape.setId, outline: shape.outline }))
      .sort((a, b) => a.id.localeCompare(b.id));
    const regions = regionLayout.update(source);
    // Regions come back identity-stable while their component is unchanged, so
    // the centroid is computed once per rebuild rather than once per frame.
    for (const region of regions) {
      if (region.center === undefined) region.center = regionCentroid(region);
    }
    const wanted = new Set(regions.map(({ id }) => id));
    for (const region of regions) {
      let shape = regionShapes.get(region.id);
      if (!shape) {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('class', 'graph-set-region');
        path.setAttribute('fill-rule', 'nonzero');
        path.dataset.regionId = `region:${region.id}`;
        path.dataset.setIds = region.setIds.join('|');
        regionLayer.append(path);
        shape = { id: region.id, path, setIds: region.setIds, center: null };
        regionShapes.set(region.id, shape);
      }
      const d = regionPath(region);
      if (shape.path.getAttribute('d') !== d) shape.path.setAttribute('d', d);
      shape.setIds = region.setIds;
      shape.center = region.center;
      shape.path.dataset.setIds = region.setIds.join('|');
      const selected = region.setIds.some((setId) => session.selectedSets?.has(setId) === true);
      shape.path.classList.toggle('region-selected', selected);
      shape.path.classList.toggle('region-picking', picking);
      shape.path.classList.toggle('region-chosen', picking && region.setIds.some((setId) => chosen?.has(setId)));
      shape.path.classList.toggle('region-partial', picking && region.setIds.some((setId) => partial?.has(setId)));
    }
    for (const [id, shape] of regionShapes) {
      if (wanted.has(id)) continue;
      shape.path.remove();
      regionShapes.delete(id);
    }
  }

  function recordDragTrail(itemIds) {
    const points = (itemIds ?? [])
      .map((id) => nodes.get(id))
      .filter((node) => node && !node.exiting)
      .map((node) => ({ x: node.x, y: node.y }));
    dragTrail.record(points);
  }

  function buildCandidate(vi) {
    if (vi.kind === 'bin-origin') {
      // A ghost node standing in for a folder that isn't itself visible in
      // the current Bin walk — just a "this is where it came from" label,
      // not a real interactive item. The folder may since have been
      // deleted or renamed to nothing findable; fall back to a generic
      // label rather than dropping the edge entirely.
      const origin = group(vi.groupId);
      return {
        id: vi.id,
        kind: 'bin-origin',
        name: origin?.name ?? 'Elsewhere',
        parentId: null,
        parentIds: [],
        linked: false,
      };
    }
    const stored = vi.kind === 'shortcut'
      ? shortcutByRecordOrPlacementId(vi.id)
      : vi.kind === 'window-layout'
        ? windowLayout(vi.id)
        : (vi.id === ROOT_ID || vi.id === 'bin'
          // The two pseudo heads of the ancestor chain ("As you Go" and the
          // Bin) have no stored record — pathTo synthesises their names, and
          // this fallback lets them render and navigate like the folders
          // they stand for.
          ? { kind: 'group', name: vi.name ?? (vi.id === 'bin' ? 'Bin' : 'As you Go') }
          : group(vi.id));
    if (!stored) return null;
    return {
      ...stored,
      // The graph node's identity is always vi.id (a placement id for a
      // bin-mode shortcut tile, the shared record id everywhere else) —
      // never stored.id, which for a resolved-by-placement bin tile would
      // be the shared shortcut record id and corrupt every DOM/selection
      // lookup keyed off candidate.id (dataset.id, dataset.graphNodeId).
      id: vi.id,
      kind: vi.kind,
      parentId: vi.parentId,
      // Every folder this shortcut is currently placed in, per the visible
      // graph (used to decide whether Ctrl+X collapses everything into one
      // place or moves just the one placement this view represents).
      parentIds: vi.parentIds ?? [vi.parentId],
      // Whether the underlying shortcut has more than one active placement
      // anywhere at all (not just in this view) — drives the link marker
      // and the apply-everywhere-or-fork prompt on edit.
      linked: vi.kind === 'shortcut' ? placementCount(stored) > 1 : false,
      // Assignment 003: an ancestor of the current folder, prepended to
      // this view by collectVisible. Ordinary body in every way except:
      // --text outline, never selected, never deletable, never persisted.
      ancestor: vi.ancestor === true,
      // Assignment 005: the broader derived-branch provenance. Every
      // ancestor AND everything revealed beneath an expanded ancestor is a
      // trail item — outside the set system for this view, styled by the
      // Trail opacity slider. Expanded trail descendants are trail items,
      // not ancestors.
      trail: vi.trail === true,
      // Pure render metadata: breadcrumb ancestors and anything expanded from
      // one inherit that path node's depth scale. Ordinary workspace bodies
      // remain exactly 1.
      trailScale: Number.isFinite(vi.trailScale) ? vi.trailScale : 1,
    };
  }

  function syncNodes(visibleItems) {
    const incoming = new Set(visibleItems.map((vi) => vi.id));
    for (const id of [...nodes.keys()]) {
      if (!incoming.has(id)) removeNode(id);
    }
    // Seed-position buckets. The head of the ancestor chain has no parent, so
    // keying it by `parentId ?? ROOT_ID` used to drop it in with every real
    // top-level item — and seedPosition's parentless ring grows with the
    // bucket's size (RADIUS * 2.4 * total/4), so in a crowded folder the trail
    // head seeded past the viewport edge and appeared to land off screen.
    // Giving the chain its own bucket makes its seed independent of how many
    // items happen to share the view.
    const TRAIL_SEED_BUCKET = 'ancestor-chain:seed-bucket';
    const seedBucketKey = (vi) => (vi.ancestor ? TRAIL_SEED_BUCKET : (vi.parentId ?? ROOT_ID));
    const byParent = new Map();
    for (const vi of visibleItems) {
      const key = seedBucketKey(vi);
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key).push(vi);
    }
    const ctxId = graphContextId(session.currentId, session.binMode);
    for (const vi of visibleItems) {
      const parentIds = vi.parentIds ?? [vi.parentId];
      let node = nodes.get(vi.id);
      if (node) {
        if (node.exitTimer) {
          clearTimeout(node.exitTimer);
          node.exitTimer = null;
          node.exiting = false;
          if (node.shell) {
            node.shell.classList.remove('exiting');
            node.shell.style.opacity = '';
            node.shell.style.scale = '';
          }
        }
        node.candidate = buildCandidate(vi);
        node.parentIds = parentIds;
        node.depth = vi.depth;
        node.visualScale = node.candidate?.trailScale ?? 1;
        refreshNodeContent(node);
        continue;
      }
      const candidate = buildCandidate(vi);
      if (!candidate) continue;
      const firstParentId = parentIds[0];
      const parent = firstParentId && firstParentId !== ROOT_ID && firstParentId !== 'bin'
        ? nodes.get(firstParentId)
        : null;
      const siblings = byParent.get(seedBucketKey(vi)) ?? [];
      const index = Math.max(0, siblings.findIndex((s) => s.id === vi.id));
      const originX = viewport ? viewport.clientWidth / 2 : 400;
      const originY = viewport ? viewport.clientHeight / 2 : 300;
      // Ancestors never read a stored position. Their ids collide with real
      // records — 'root' and 'bin' have saved coordinates from before the
      // trail existed, several of them negative (off the left edge) — and a
      // saved position is applied as fx/fy, which PINS the node so the solver
      // can never pull it back into view. That is why the trail sometimes
      // appeared stuck off screen. Ancestors are derived from the path, not
      // creator-placed, so they always seed fresh and float.
      const saved = vi.ancestor ? null : getGraphPosition(state, ctxId, vi.id);
      // Where this node last came to rest, if it is not pinned. Applied to x/y
      // only — never to fx/fy — so the node still floats and every force still
      // moves it. Without this an unpinned node seeds onto a generic ring and
      // the solver settles it somewhere new on every open, which rearranges a
      // workspace the creator had learned the shape of.
      const remembered = (saved || vi.ancestor) ? null : getGraphRestPosition(state, ctxId, vi.id);
      const seed = remembered ?? seedPosition(vi.id, parent, index, siblings.length, originX, originY);
      node = {
        id: vi.id,
        candidate,
        depth: vi.depth,
        visualScale: candidate.trailScale ?? 1,
        x: saved ? saved.x : seed.x,
        y: saved ? saved.y : seed.y,
        fx: saved ? saved.x : null,
        fy: saved ? saved.y : null,
        vx: 0,
        vy: 0,
        width: 0,
        height: 0,
        parentIds,
        parentNode: parent ?? null,
        shell: null,
        exiting: false,
        exitTimer: null,
        positioned: Boolean(saved),
      };
      nodes.set(vi.id, node);
      createNodeShell(node);
    }
  }

  /** Frames a folder's icon square with its assigned color; non-folders are
   * left plain. The color is exposed as --folder-color and styled in CSS so
   * it wraps only the icon graphic, not the tile's text. An ancestor of the
   * current folder wears the --text outline instead of a hue — the existing
   * folder-colored rule draws both the ring and its color-mix fill; nothing
   * else about the tile changes. */
  function applyFolderColor(iconItem, candidate) {
    if (candidate.ancestor) {
      iconItem.classList.add('folder-colored');
      iconItem.style.setProperty('--folder-color', 'var(--text)');
      return;
    }
    const color = candidate.kind === 'group' ? folderColor(candidate.id) : null;
    iconItem.classList.toggle('folder-colored', Boolean(color));
    if (color) iconItem.style.setProperty('--folder-color', color);
    else iconItem.style.removeProperty('--folder-color');
  }

  /** Recomputes folder hues from their current canvas positions (so colors
   * follow dragging and relative distance), then re-applies only the shells
   * and edges whose color actually changed. Ancestor bodies are excluded:
   * they wear the --text outline instead of a hue, and joining the near-pair
   * projection would perturb the real folders' hue assignment. */
  function syncFolderColors() {
    const folderNodes = [...nodes.values()].filter(
      (node) => !node.exiting && node.shell && node.candidate?.kind === 'group'
        && !node.candidate.ancestor,
    );
    const center = {
      cx: (viewport?.clientWidth ?? 800) / 2,
      cy: (viewport?.clientHeight ?? 600) / 2,
    };
    const spatialNodes = [
      ...folderNodes.map((node) => ({ id: `folder:${node.id}`, x: node.x, y: node.y })),
      ...[...setShapes.values()]
        .filter((shape) => !shape.retiring)
        .map((shape) => {
          const point = outlineCentroid(shape.outline);
          return point ? { id: `set:${shape.setId}`, ...point } : null;
        })
        .filter(Boolean),
      ...[...regionShapes.values()]
        .filter((shape) => shape.center)
        .map((shape) => ({ id: `region:${shape.id}`, ...shape.center })),
    ];
    assignSpatialFolderHues(
      spatialNodes,
      spatialColors,
      center,
      spatialHueState,
    );
    for (const node of folderNodes) {
      const hue = spatialColors.get(`folder:${node.id}`);
      if (node.appliedFolderHue === hue) continue;
      node.appliedFolderHue = hue;
      const iconItem = node.shell.querySelector('.icon-item');
      if (iconItem) applyFolderColor(iconItem, node.candidate);
    }
    edges.forEach((edge) => {
      const source = nodes.get(edge.sourceId);
      if (!source || source.candidate?.kind !== 'group' || source.candidate?.ancestor || !edge.path) return;
      const stroke = folderColor(source.candidate.id) ?? '';
      if (edge.appliedStroke === stroke) return;
      edge.appliedStroke = stroke;
      edge.path.style.stroke = stroke;
    });
    for (const shape of setShapes.values()) {
      const color = setColor(shape.setId);
      if (color) {
        shape.path.style.setProperty('--set-color', color);
        shape.glyphs?.style.setProperty('--set-color', color);
      }
    }
    for (const shape of regionShapes.values()) {
      const color = regionColor(shape.id);
      if (color) shape.path.style.setProperty('--region-color', color);
    }
  }

  /** 035: the attached window-layout shell takes the layout's persisted shared
   * card width (the detached widget's latest window content width) so attached
   * and detached cards are 1:1. No persisted width -> the CSS default. */
  function applyWindowLayoutShellWidth(shell, candidate) {
    if (candidate.kind !== 'window-layout') return;
    const raw = candidate.cardSize?.width;
    // 037: the attached host footprint is the CARD's client width, capped at
    // the shared compact presentation maximum - never a larger empty host
    // footprint (a legacy over-max persisted value cannot stretch the node).
    if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 1) {
      const width = Math.min(raw, WINDOW_LAYOUT_CARD_MAX_WIDTH);
      shell.style.setProperty('--wl-card-width', `${Math.round(width)}px`);
    } else {
      shell.style.removeProperty('--wl-card-width');
    }
  }

  function refreshNodeContent(node) {
    if (!node.shell) return;
    const candidate = node.candidate;
    if (!candidate) return;
    const iconItem = node.shell.querySelector('.icon-item');
    if (!iconItem) return;
    applyFolderColor(iconItem, candidate);
    const isGhost = candidate.kind === 'bin-origin';
    const canExpand = candidate.kind === 'group';
    const isExpanded = canExpand && (candidate.trail
      ? session.trailExpanded.has(candidate.id)
      : session.graphExpanded.has(candidate.id));
    const isSelected = !isGhost && session.selected.has(candidate.id);
    iconItem.dataset.kind = candidate.kind;
    iconItem.dataset.parent = candidate.parentId ?? (session.binMode ? 'bin' : session.currentId);
    iconItem.setAttribute('draggable', 'false');
    iconItem.setAttribute('aria-selected', String(isSelected));
    iconItem.classList.toggle('selected', isSelected);
    iconItem.classList.toggle('bin-origin-ghost', isGhost);
    iconItem.classList.toggle('ancestor-item', candidate.ancestor === true);
    iconItem.classList.toggle('trail-item', candidate.trail === true);
    node.shell.classList.toggle('bin-origin-ghost', isGhost);
    // 035: the shared card width updates whenever it changes, even when the
    // inner HTML is otherwise unchanged.
    applyWindowLayoutShellWidth(node.shell, candidate);
    // 018V7R3: the window-layout signature includes the bounded presentation
    // mode so the cached inert read-only HTML is not reused for the writable
    // view (the Detach control must appear after the unlock render). 035: the
    // detached-widget placeholder state + persisted width also change the
    // signature so the node re-renders when a widget opens/closes or resizes.
    const windowLayoutMode = windowLayoutPresentationMode({
      isReadOnly: windowLayoutDetachment.isReadOnly(),
      mode: windowLayoutDetachment.getState().mode,
    });
    const signature = JSON.stringify([
      candidate.kind,
      candidate.name,
      candidate.description ?? '',
      candidate.target ?? '',
      candidate.icon ?? null,
      candidate.linked ?? false,
      isExpanded,
      session.binMode,
      state.view.iconSize,
      candidate.kind === 'window-layout'
        ? `${windowLayoutContentSignature(candidate, windowLayoutMode)}|d:${detachedWidgets.has(candidate.id)}|w:${candidate.cardSize?.width ?? 0}`
        : 0,
    ]);
    if (node.contentSignature !== signature) {
      removeWindowLayoutCardPresentation(iconItem);
      node.contentSignature = signature;
      iconItem.innerHTML =
        `${canExpand ? `<button class="folder-expander ${isExpanded ? 'expanded' : ''}" data-expand="${candidate.id}" type="button" aria-label="${isExpanded ? 'Collapse' : 'Expand'} ${escapeHtml(candidate.name)}">›</button>` : ''}`
        + `${linkMarkup(candidate)}`
        + (candidate.kind === 'window-layout'
          ? windowLayoutCardMarkup(candidate, { detached: detachedWidgets.has(candidate.id) })
          : `${iconItemMarkup(candidate)}<strong>${escapeHtml(candidate.name)}</strong>${descriptionMarkup(candidate)}`);
      hydrateNodeIcons(node.shell);
      installWindowLayoutCardPresentation(iconItem);
    }
    const visualScale = node.visualScale ?? 1;
    node.width = (node.shell.offsetWidth || (state.view.iconSize + 42)) * visualScale;
    node.height = (node.shell.offsetHeight || (state.view.iconSize + 64)) * visualScale;
  }

  function createNodeShell(node) {
    const candidate = node.candidate;
    if (!candidate) return;
    const isGhost = candidate.kind === 'bin-origin';
    const isSelected = !isGhost && session.selected.has(candidate.id);
    const canExpand = candidate.kind === 'group';
    const isExpanded = canExpand && (candidate.trail
      ? session.trailExpanded.has(candidate.id)
      : session.graphExpanded.has(candidate.id));

    const shell = document.createElement('div');
    shell.className = `graph-node-shell${isGhost ? ' bin-origin-ghost' : ''}${candidate.kind === 'window-layout' ? ' window-layout-shell' : ''}`;
    shell.dataset.graphNodeId = candidate.id;
    shell.style.transform = `translate3d(${node.x}px, ${node.y}px, 0) translate(-50%, -50%) scale(${node.visualScale ?? 1})`;

    const iconItem = document.createElement('div');
    iconItem.className = `icon-item${isSelected ? ' selected' : ''}${isGhost ? ' bin-origin-ghost' : ''}${candidate.ancestor ? ' ancestor-item' : ''}${candidate.trail ? ' trail-item' : ''}`;
    applyFolderColor(iconItem, candidate);
    iconItem.dataset.id = candidate.id;
    iconItem.dataset.kind = candidate.kind;
    iconItem.dataset.parent = candidate.parentId ?? (session.binMode ? 'bin' : session.currentId);
    iconItem.setAttribute('draggable', 'false');
    iconItem.setAttribute('role', isGhost ? 'presentation' : 'option');
    iconItem.setAttribute('aria-selected', String(isSelected));
    iconItem.setAttribute('tabindex', '-1');
    iconItem.setAttribute('aria-label', `${candidate.ancestor ? 'Go to ' : ''}${escapeHtml(candidate.name)}`);
    iconItem.innerHTML =
      `${canExpand ? `<button class="folder-expander ${isExpanded ? 'expanded' : ''}" data-expand="${candidate.id}" type="button" aria-label="${isExpanded ? 'Collapse' : 'Expand'} ${escapeHtml(candidate.name)}">›</button>` : ''}`
      + `${linkMarkup(candidate)}`
      + (candidate.kind === 'window-layout'
        ? windowLayoutCardMarkup(candidate, { detached: detachedWidgets.has(candidate.id) })
        : `${iconItemMarkup(candidate)}<strong>${escapeHtml(candidate.name)}</strong>${descriptionMarkup(candidate)}`);

    shell.append(iconItem);
    nodeLayer.append(shell);
    node.shell = shell;
    installWindowLayoutCardPresentation(iconItem);
    // 035: the shell takes the layout's persisted shared card width so the
    // initial node width/height measure the real footprint.
    applyWindowLayoutShellWidth(shell, candidate);

    // 018V7R3: the initial signature includes the bounded presentation mode so
    // the create and refresh signatures agree with the body markup. 035: the
    // detached-widget placeholder state + persisted width are included too.
    const windowLayoutMode = windowLayoutPresentationMode({
      isReadOnly: windowLayoutDetachment.isReadOnly(),
      mode: windowLayoutDetachment.getState().mode,
    });
    node.contentSignature = JSON.stringify([
      candidate.kind,
      candidate.name,
      candidate.description ?? '',
      candidate.target ?? '',
      candidate.icon ?? null,
      candidate.linked ?? false,
      isExpanded,
      session.binMode,
      state.view.iconSize,
      candidate.kind === 'window-layout'
        ? `${windowLayoutContentSignature(candidate, windowLayoutMode)}|d:${detachedWidgets.has(candidate.id)}|w:${candidate.cardSize?.width ?? 0}`
        : 0,
    ]);

    const visualScale = node.visualScale ?? 1;
    node.width = (shell.offsetWidth || (state.view.iconSize + 42)) * visualScale;
    node.height = (shell.offsetHeight || (state.view.iconSize + 64)) * visualScale;

    if (reducedMotion?.matches) {
      shell.style.opacity = '1';
    } else {
      shell.style.opacity = '0';
      shell.style.scale = '0.7';
      requestAnimationFrame(() => {
        if (node.shell) {
          shell.style.opacity = '1';
          shell.style.scale = '1';
        }
      });
    }
  }

  function removeNode(id) {
    const node = nodes.get(id);
    if (!node) return;
    if (reducedMotion?.matches || node.exiting) {
      node.shell?.remove();
      nodes.delete(id);
      return;
    }
    node.exiting = true;
    const parent = node.parentNode;
    const targetX = parent ? parent.x : node.x;
    const targetY = parent ? parent.y : node.y;
    if (node.shell) {
      node.shell.classList.add('exiting');
      node.shell.style.transform = `translate3d(${targetX}px, ${targetY}px, 0) translate(-50%, -50%) scale(${node.visualScale ?? 1})`;
      node.shell.style.opacity = '0';
      node.shell.style.scale = '0.5';
    }
    node.exitTimer = setTimeout(() => {
      node.shell?.remove();
      nodes.delete(id);
      node.exitTimer = null;
    }, 200);
  }

  function syncEdges(visibleItems) {
    if (!edgeLayer) return;
    const wanted = new Map();
    for (const edge of graphEdges(visibleItems)) {
      const source = nodes.get(edge.source);
      const target = nodes.get(edge.target);
      if (!source || !target || source.exiting || target.exiting) continue;
      wanted.set(edge.id, { sourceId: edge.source, targetId: edge.target });
    }
    for (const [key, edge] of edges) {
      if (!wanted.has(key)) {
        edge.path?.remove();
        edges.delete(key);
      }
    }
    for (const [key, info] of wanted) {
      let edge = edges.get(key);
      const source = nodes.get(info.sourceId);
      const target = nodes.get(info.targetId);
      if (!source || !target) continue;
      // Edge stroke colors are owned by syncFolderColors, which recomputes them
      // from folder positions each frame.
      if (!edge) {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('class', 'graph-edge');
        const d = edgePath(source.x, source.y, target.x, target.y);
        path.setAttribute('d', d);
        edgeLayer.append(path);
        edge = { key, sourceId: info.sourceId, targetId: info.targetId, path, lastPathD: d };
        edges.set(key, edge);
      }
    }
  }

  /** Draws the "where did this come from" edges for binned tiles (see
   * binOriginEdges) — kept in a separate map/CSS class from the normal
   * graph-edge set above, since these connect to a possibly-ghost node
   * and are always styled distinctly (red) rather than the default gray. */
  function syncOriginEdges(edgeList) {
    if (!edgeLayer) return;
    const wanted = new Map();
    for (const edge of edgeList) {
      const source = nodes.get(edge.source);
      const target = nodes.get(edge.target);
      if (!source || !target || source.exiting || target.exiting) continue;
      wanted.set(edge.id, { sourceId: edge.source, targetId: edge.target });
    }
    for (const [key, edge] of originEdges) {
      if (!wanted.has(key)) {
        edge.path?.remove();
        originEdges.delete(key);
      }
    }
    for (const [key, info] of wanted) {
      let edge = originEdges.get(key);
      const source = nodes.get(info.sourceId);
      const target = nodes.get(info.targetId);
      if (!source || !target) continue;
      if (!edge) {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('class', 'graph-edge bin-origin-edge');
        const d = edgePath(source.x, source.y, target.x, target.y);
        path.setAttribute('d', d);
        edgeLayer.append(path);
        edge = { key, sourceId: info.sourceId, targetId: info.targetId, path, lastPathD: d };
        originEdges.set(key, edge);
      }
    }
  }

  function ensureSimulation() {
    if (simulation) return;
    const w = viewport?.clientWidth || 800;
    const h = viewport?.clientHeight || 600;
    simulation = forceSimulation()
      .force('cx', forceX(w / 2).strength((node) => (
        node.ring ? 0.05 : branchCenterGravityStrength(node)
      )))
      .force('cy', forceY(h / 2).strength((node) => (
        node.ring ? 0.05 : branchCenterGravityStrength(node)
      )))
      // Ring nodes do not repel. Hundreds of them each pushing on everything
      // would both swamp the layout the icons make between themselves and pay
      // the charge cost for nodes whose position is already decided by their
      // links and the shape force.
      .force('charge', forceManyBody().strength((n) => (n.ring ? 0 : -280)))
      .force('collide', forceCollide()
        .radius((n) => (n.ring ? RING_NODE_RADIUS : Math.max(n.width, n.height) / 2 + 20))
        .strength(0.9))
      // Ring links are short and stiff: the boundary has to hold its spacing
      // against the icons pushing on it, where the graph's own links are long
      // and slack so the layout can breathe.
      .force('link', forceLink()
        .id((n) => n.id)
        .distance((link) => (link.source.ring ? RING_LINK_DISTANCE : branchLinkDistance(link)))
        .strength((link) => (link.source.ring ? 0.9 : branchLinkStrength(link))))
      // A maximal non-branching path may not fold through itself. Its closest
      // monotone projection is approached with a capped velocity; sibling
      // paths and ordinary item bodies remain completely uninvolved.
      .force('branchUncross', forceBranchUncross())
      // Holds each ring around its own members rather than letting it drift.
      //
      // The alpha floor inside it is gated on a drag being in progress. It
      // refuses to cool, which is what keeps a ring with its member during a
      // drag, but d3 cools everything else — so on a settled scene it was the
      // only force still injecting velocity, driving icons through the ring
      // nodes' collision and chasing them as they moved. Measured: two disjoint
      // sets stretched without bound and their outlines crossed.
      .force('ring', forceRingShape({
        membersOf: membersOnScreen,
        // Same test the other two set forces use for a held node, asked across
        // the whole graph rather than about one id.
        isDragging: () => {
          for (const node of nodes.values()) if (node.fx != null) return true;
          return false;
        },
      }))
      // Gathers a set's members towards each other. Without it they sprawl
      // wherever the graph's own layout puts them, and a boundary drawn round
      // a sprawl is mostly empty space with bystanders sitting in it — the ring
      // then has no way to exclude anything, because a point between two
      // members is interior however the outline is drawn. Measured on a
      // six-member set: without gravity only 4 of 6 members were inside their
      // own ring and 2 foreign items were; with it, 6 of 6 and none.
      .force('setGravity', forceSetGravity({
        setsOf: (nodeId) => setIdsContaining(nodeId),
        isHeld: (nodeId) => nodes.get(nodeId)?.fx != null,
      }))
      // Keeps unrelated sets from drawing through each other. Nothing else
      // acts between two sets: ring nodes carry zero charge, and collision only
      // separates node from node at 60px, which two rings can satisfy while the
      // curves drawn through them still cross. Sets sharing a member are exempt,
      // so the Venn that gravity builds is left alone.
      .force('setSeparation', forceSetSeparation({
        setsOf: (nodeId) => setIdsContaining(nodeId),
        // The shape actually on screen, so the force parts what the creator
        // sees rather than a proxy for it — the same rule drawing and
        // hit-testing already follow. shape.outline is the eased, resampled,
        // member-floored outline drawSetRings last put on screen; recomputing
        // the hull from physics nodes would read a different shape. A null
        // outline (not yet drawn, or retired) is a safe no-op: the node pass
        // above covers the ring until a visible outline exists.
        hullOf: (setId) => setShapes.get(setId)?.outline ?? null,
        // A set whose member is under the pointer is anchored: it takes no
        // separation impulse, and the other set absorbs the whole response.
        isHeld: (nodeId) => nodes.get(nodeId)?.fx != null,
      }))
      // And pushes non-members back out of a set they have wandered into. The
      // outline cannot do this alone: it can only exclude what lies outside the
      // region its members occupy, so the layout has to express membership too.
      .force('setExclusion', forceSetExclusion({
        setsOf: (nodeId) => setIdsContaining(nodeId),
        membersOf: membersOnScreen,
        // The visible outline, so the force and the drawn shape agree on who is
        // inside — the same source separation uses. Proximity to a member is a
        // proxy for that and disagrees with it in open space within the
        // boundary, which is where foreign items leaked. A null outline (not
        // yet drawn, or retired) is a safe no-op: the set contributes nothing
        // until its visible outline exists.
        hullOf: (setId) => setShapes.get(setId)?.outline ?? null,
        isHeld: (nodeId) => nodes.get(nodeId)?.fx != null,
      }))
      .alphaDecay(0.028)
      .velocityDecay(0.32);
    simulation.on('tick', () => {
      scheduleRender();
      scheduleRestPositionSave();
    });
  }

  // Remembering where unpinned nodes rest. Throttled, NOT debounced: the
  // simulation never truly stops ticking — sets keep nudging each other — so a
  // debounce that waits for quiet waits forever and nothing is ever written.
  // This fires at most once an interval while the layout is live, which keeps
  // the durable snapshot from being rewritten every frame while still recording
  // where things ended up.
  let restSaveTimer = null;
  const lastSavedRest = new Map();
  const REST_SAVE_INTERVAL_MS = 1500;
  // Below this a node has not meaningfully moved, and rewriting it would churn
  // the snapshot over sub-pixel drift.
  const REST_SAVE_MIN_SHIFT = 4;

  function scheduleRestPositionSave() {
    if (!onRestPositions || restSaveTimer) return;
    restSaveTimer = setTimeout(() => {
      restSaveTimer = null;
      saveRestPositions();
    }, REST_SAVE_INTERVAL_MS);
  }

  function saveRestPositions() {
    if (!onRestPositions) return;
    const updates = {};
    let changed = false;
    for (const node of nodes.values()) {
      // Pinned nodes already persist through graphPositions; ring nodes and
      // ancestors are derived rather than placed, and a node on its way out
      // should not leave a resting place behind.
      if (node.exiting || node.ring || node.fx != null) continue;
      if (isTrailNode(node.id)) continue;
      if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) continue;
      const previous = lastSavedRest.get(node.id);
      if (previous && Math.hypot(node.x - previous.x, node.y - previous.y) < REST_SAVE_MIN_SHIFT) continue;
      updates[node.id] = { x: node.x, y: node.y };
      changed = true;
    }
    if (!changed) return;
    for (const [id, pos] of Object.entries(updates)) lastSavedRest.set(id, pos);
    onRestPositions(updates);
  }
  function syncSimulation() {
    ensureSimulation();
    syncSetRings();
    const nodeArray = [...nodes.values()].filter((n) => !n.exiting);
    // Ring nodes are ordinary simulation nodes. That is the whole design: they
    // collide with icons, so a member cannot leave its set and an outsider
    // cannot get in, and the outline dents and stretches because the same
    // forces act on it as on everything else. Nothing about containment is
    // enforced separately.
    const edgeArray = [];
    const hierarchyEdgeArray = [];
    edges.forEach((edge) => {
      const link = { source: edge.sourceId, target: edge.targetId };
      edgeArray.push(link);
      hierarchyEdgeArray.push(link);
    });
    originEdges.forEach((edge) => {
      edgeArray.push({ source: edge.sourceId, target: edge.targetId });
    });
    // The links closing each ring into a loop, which is what stops the boundary
    // opening up under load.
    for (const ring of setRings.values()) edgeArray.push(...ring.links);

    // ForceX/ForceY cache their per-node strengths when simulation.nodes() is
    // called. Compute branch rigidity first so the cached gravity coefficient
    // already reflects the current expansion depth on this very tick.
    assignBranchRigidity(nodeArray, hierarchyEdgeArray);
    for (const ring of setRings.values()) nodeArray.push(...ring.nodes);
    simulation.nodes(nodeArray);

    simulation.force('link').links(edgeArray);
    simulation.force('branchUncross').links(hierarchyEdgeArray);
    // Ring nodes are small, so they pack tightly along the boundary instead of
    // being held a whole icon apart by the padding icons need.
    simulation.force('collide').radius((n) => (n.ring
      ? RING_NODE_RADIUS
      : Math.max(n.width, n.height) / 2 + 20));
    const w = viewport?.clientWidth || 800;
    const h = viewport?.clientHeight || 600;
    simulation.force('cx').x(w / 2);
    simulation.force('cy').y(h / 2);
  }

  function reheat(level = 0.35) {
    if (!simulation) return;
    simulation.alpha(Math.max(simulation.alpha(), level)).restart();
  }

  function fitGraph(padding = 90) {
    if (!camera || !viewport || !viewportSelection || nodes.size === 0) return false;
    const w = viewport.clientWidth;
    const h = viewport.clientHeight;
    if (w < 2 || h < 2) return false;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let activeCount = 0;
    nodes.forEach((n) => {
      if (n.exiting) return;
      activeCount += 1;
      const halfW = (n.width || 100) / 2;
      const halfH = (n.height || 120) / 2;
      minX = Math.min(minX, n.x - halfW);
      minY = Math.min(minY, n.y - halfH);
      maxX = Math.max(maxX, n.x + halfW);
      maxY = Math.max(maxY, n.y + halfH);
    });
    if (!Number.isFinite(minX) || activeCount === 0) return false;
    const scale = Math.min(
      (w - padding * 2) / Math.max(1, maxX - minX),
      (h - padding * 2) / Math.max(1, maxY - minY),
      2,
    );
    const k = Math.max(0.35, Math.min(3, scale));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const tx = w / 2 - cx * k;
    const ty = h / 2 - cy * k;
    const transform = zoomIdentity.translate(tx, ty).scale(k);
    // 043: the vendored d3-selection.js selection (what `select(viewport)`
    // returns) has NO transition() method — the transition machinery is only
    // bundled inside d3-zoom.js against its private selection copy, so the
    // previous animated branch always threw `viewportSelection.transition is
    // not a function` on normal first render. Apply the transform directly
    // (the same zoomBehavior.transform the old non-animated branch used) so
    // the initial fit works for every renderer.
    zoomBehavior.transform(viewportSelection, transform);
    return true;
  }

  function updateGraphView(initialFit = false) {
    const w = viewport?.clientWidth ?? 0;
    const h = viewport?.clientHeight ?? 0;
    if (w < 2 || h < 2) {
      updatePending = true;
      pendingInitialFit = initialFit;
      return;
    }
    updatePending = false;
    // Assignment 007: trail expansion is remembered per view context and is
    // fully independent of ordinary expansion. The active set for THIS view
    // is synced into the session here — one place, every render — so the
    // chevrons and the walk below read one source.
    const trailExpanded = new Set(
      state.view?.trailExpandedByContext?.[currentTrailContextKey()] ?? [],
    );
    store.setTrailExpanded([...trailExpanded]);
    const visible = visibleGraphItems(
      state,
      // Navigating to the root via an ancestor tile sets currentId to null
      // (the store's own "no folder" value), but items at the top level are
      // stored under ROOT_ID — collectVisible finds nothing for null and the
      // whole workspace renders empty. Normalise here so both spellings of
      // "the root" resolve to the same folder.
      session.currentId ?? ROOT_ID,
      session.graphExpanded,
      session.binMode,
      session.binCurrentId,
      // Assignment 003: the ancestors of the current folder join its item
      // list as ordinary bodies. The chain is the path TO here, so the
      // current folder's own entry is sliced off — at root it is empty.
      session.binMode
        ? pathToBin(session.binCurrentId === 'bin' ? null : session.binCurrentId).slice(0, -1)
        : pathTo(session.currentId).slice(0, -1),
      trailExpanded,
      {
        rootScale: getBreadcrumbRootScale(state.view?.preferences),
        middleScale: getBreadcrumbMiddleScale(state.view?.preferences),
      },
    );
    if (visible.length === 0) {
      nodes.forEach((_, id) => removeNode(id));
      syncEdges([]);
      syncOriginEdges([]);
      // Nothing on screen means no members, so every ring goes too. Without
      // this the previous view's outlines would stay drawn over an empty graph.
      syncSetRings();
      return;
    }
    const originEdges = session.binMode ? binOriginEdges(visible) : [];
    const ghostIds = new Set(originEdges.filter((e) => e.ghost).map((e) => e.ghostGroupId));
    const ghostItems = [...ghostIds].map((groupId, index) => ({
      id: `bin-origin:${groupId}`,
      parentId: null,
      kind: 'bin-origin',
      groupId,
      depth: 0,
      siblingIndex: index,
      siblingCount: ghostIds.size,
    }));
    syncNodes([...visible, ...ghostItems]);
    syncEdges(visible);
    syncOriginEdges(originEdges);
    syncSimulation();
    reheat(initialFit ? 0.7 : 0.35);
    if (initialFit && !initialized) {
      fitPending = true;
      setTimeout(() => {
        if (fitPending && fitGraph()) {
          fitPending = false;
          initialized = true;
        }
      }, 500);
    }
  }

  function refreshSelection() {
    nodes.forEach((node) => {
      if (!node.shell) return;
      const iconItem = node.shell.querySelector('.icon-item');
      if (!iconItem) return;
      const isSelected = session.selected.has(node.id);
      iconItem.classList.toggle('selected', isSelected);
      iconItem.setAttribute('aria-selected', String(isSelected));
    });
  }

  return {
    createGraphView,
    updateGraphView,
    destroyGraphView,
    refreshSelection,
    refreshEdgeOpacity: syncEdgeOpacity,
    reheat,
    fitGraph,
    ancestorsOfNode,
    setIdsAtPoint,
    setPathFor: (id) => setShapes.get(id)?.path ?? null,
    ejectTrespassers,
    recordDragTrail,
    clearDragTrail: () => dragTrail.clear(),
    get dragTrailCount() { return dragTrail.count; },
    _getNode: (id) => nodes.get(id) ?? null,
    _isTrailNode: (id) => isTrailNode(id),
    // Which sets a node belongs to, by the same inherited-membership rule the
    // ring is drawn from. Exposed so gestures can be scoped by set membership
    // rather than by whatever happens to be on screen.
    setIdsContaining: (id) => setIdsContaining(id),
    _setOnDragCancel(callback) { onDragCancel = callback; },
    _setOnRestPositions(callback) { onRestPositions = callback; },
    _saveRestPositionsNow() { saveRestPositions(); },
    _setSimulationDecay() {
      if (simulation) {
        simulation.alphaTarget(0);
        if (simulation.alpha() < simulation.alphaMin()) {
          simulation.alpha(0.05).restart();
        }
      }
    },
    get hasNodes() { return nodes.size > 0; },
    get isAttached() { return attached; },
    get nodeCount() { return [...nodes.values()].filter((n) => !n.exiting).length; },
    get edgeCount() { return edges.size; },
    get _needsFullRebuild() { return false; },
  };
}

function renderGraph(initialFit = false) {
  if (!graph.isAttached) {
    graph.createGraphView();
  }
  graph.updateGraphView(initialFit);
}

function applyTheme(preferences) {
  document.documentElement.dataset.theme = getTheme(preferences);
  document.documentElement.dataset.transparentBackground = String(getTransparentBackground(preferences));
  applyBackdropOpacity(preferences);
}

/** Drives the .workspace-backdrop panel and keeps the pill's slider/readout in
 * step. Split out so the drag handler can repaint on every input event without
 * paying for a full render(). */
function applyBackdropOpacity(preferences) {
  const opacity = getBackdropOpacity(preferences);
  document.documentElement.style.setProperty('--workspace-backdrop-opacity', String(opacity));
  document.documentElement.style.setProperty(
    '--workspace-backdrop-opacity-percent',
    `${Math.round(opacity * 10000) / 100}%`,
  );
  const slider = elements.backdropOpacitySlider;
  if (slider && document.activeElement !== slider) slider.value = String(opacity);
  if (elements.backdropOpacityValue) {
    elements.backdropOpacityValue.textContent = `${Math.round(opacity * 100)}%`;
  }
}

function render() {
  applyTheme(state.view?.preferences);
  if (WIDGET_SURFACE) return; // 019C: the widget renders only its own card
  if (session.binMode && session.binCurrentId !== 'bin' && !group(session.binCurrentId)?.bin) {
    // The folder we'd drilled into was restored or deleted out from under
    // us (e.g. via the top-level Bin list or "Delete all") — fall back to
    // the top of the Bin rather than rendering a dangling, nonexistent
    // breadcrumb segment.
    store.setNavigation({ binCurrentId: 'bin' });
  }
  const iconSize = state.view.iconSize;
  document.documentElement.style.setProperty('--icon-size', `${iconSize}px`);
  elements.breadcrumbs.innerHTML = session.binMode
    ? pathToBin(session.binCurrentId === 'bin' ? null : session.binCurrentId).map((candidate, index, path) =>
        `<button type="button" data-bin-breadcrumb="${candidate.id}">${escapeHtml(candidate.name)}</button>${index < path.length - 1 ? '<span aria-hidden="true">›</span>' : ''}`,
      ).join('')
    : pathTo(session.currentId).map((candidate, index, path) =>
        `<button type="button" data-breadcrumb="${candidate.id}">${escapeHtml(candidate.name)}</button>${index < path.length - 1 ? '<span aria-hidden="true">›</span>' : ''}`,
      ).join('');

  const visible = session.binMode
    ? (session.binCurrentId === 'bin' ? binnedItems(state) : itemsInBinnedGroup(state, session.binCurrentId))
    // Same null-vs-ROOT_ID normalisation as the graph view above: an
    // ancestor tile navigating to the root leaves currentId null, and
    // itemsIn(null) is empty, which would show the "folder is empty" line
    // over a workspace that is not empty.
    : itemsIn(state, session.currentId ?? ROOT_ID);
  elements.grid.dataset.blankParent = session.binMode ? session.binCurrentId : (session.currentId ?? ROOT_ID);
  elements.grid.dataset.view = 'graph';
  elements.grid.classList.toggle('bin-canvas', session.binMode);

  if (!graph.isAttached) {
    elements.grid.innerHTML = '';
    renderGraph(true);
  } else {
    graph.updateGraphView(false);
  }
  elements.empty.hidden = visible.length !== 0
    || (session.binMode
      ? pathToBin(session.binCurrentId === 'bin' ? null : session.binCurrentId).slice(0, -1).length
      : pathTo(session.currentId).slice(0, -1).length) > 0;
  elements.empty.textContent = session.binMode
    ? (session.binCurrentId === 'bin' ? 'The Bin is empty.' : 'Nothing left here.')
    : 'This folder is empty. Right-click here to add something.';

  syncSelection();

  const binCount = binnedItems(state).length;
  elements.binCount.hidden = binCount === 0;
  elements.binCount.textContent = String(binCount);
  elements.binButton.setAttribute('aria-pressed', String(session.binMode));
  elements.binLabel.textContent = session.binMode ? 'Close Bin' : 'Bin';
  elements.binButton.title = session.binMode ? 'Close Bin' : 'Bin';
  const hasSelection = session.binMode && session.selected.size > 0;
  elements.deleteAllBin.hidden = !session.binMode || binCount === 0;
  elements.restoreAllBin.hidden = !session.binMode || binCount === 0;
  elements.deleteAllBin.classList.toggle('selective', hasSelection);
  elements.restoreAllBin.classList.toggle('selective', hasSelection);
  elements.deleteAllBin.title = hasSelection ? 'Delete selection permanently' : 'Delete all';
  elements.restoreAllBin.title = hasSelection ? 'Restore selection' : 'Restore all';

  hydrateIcons();
}

function syncSelection() {
  if (graph.isAttached) {
    graph.refreshSelection();
  } else {
    document.querySelectorAll('.icon-item').forEach((tile) => {
      const isSelected = session.selected.has(tile.dataset.id);
      tile.classList.toggle('selected', isSelected);
      tile.setAttribute('aria-selected', String(isSelected));
    });
  }
  elements.selectionStatus.hidden = session.selected.size === 0;
  elements.selectionStatus.textContent = session.selected.size === 1
    ? '1 item selected'
    : `${session.selected.size} items selected`;
}

async function hydrateIcons() {
  await hydrateIconsScoped(
    document,
    iconCache,
    (detail) => host.shortcutIcon(detail),
    (url) => host.resolveWebIcon(url),
  );
}

function hydrateNodeIcons(shell) {
  if (!shell) return;
  hydrateIconsScoped(
    shell,
    iconCache,
    (detail) => host.shortcutIcon(detail),
    (url) => host.resolveWebIcon(url),
  );
}

async function persist(nextState = state) {
  return store.save(nextState);
}

async function commit(nextState, options = {}) {
  return store.commit(nextState, options);
}

function visibleItemIds() {
  // Ancestors never enter the selection: select-all and shift-ranges read
  // this list, and the marquee filters separately — the bin-origin pattern
  // for keeping derived bodies out of selection and deletion.
  return [...elements.grid.querySelectorAll('.icon-item')]
    .filter((node) => !node.classList.contains('ancestor-item'))
    .map((node) => node.dataset.id);
}

function currentSelectionParent() {
  const first = item([...session.selected][0]);
  return first?.parentId ?? session.currentId;
}




/** Resolves a set of graph item ids (groups or shared shortcut identities)
 * to the exact Bin-context ids binSelection() needs — a linked shortcut
 * with more than one visible edge bins every one of its placements (the
 * whole shared thing), while one with a single visible edge only bins the
 * placement this view represents. Shared by the Bin button/keyboard path
 * and drag-onto-the-bin-pill. */
function resolveBinTargets(itemIds) {
  return itemIds.flatMap((itemId) => {
    if (group(itemId) || windowLayout(itemId)) return [itemId];
    return visibleParentCountFor(itemId) > 1
      ? allActivePlacementIds(itemId)
      : [visiblePlacementIdFor(itemId)].filter(Boolean);
  });
}


async function runMenuAction(action) {
  const onlyId = session.selected.size === 1 ? [...session.selected][0] : null;
  if (action === 'new-folder') return editorDialog.showEditor('group', null, elements.menu.dataset.parent);
  if (action === 'new-shortcut') return editorDialog.showEditor('shortcut', null, elements.menu.dataset.parent);
  if (action === 'new-web-link') return editorDialog.showEditor('web', null, elements.menu.dataset.parent);
  if (action === 'new-window-layout') {
    try {
      await commit(createWindowLayout(state, { parentId: elements.menu.dataset.parent ?? session.currentId ?? ROOT_ID }));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
    return;
  }
  if (action === 'paste') return commands.pasteInto(elements.menu.dataset.parent);
  if (action === 'open' && onlyId) return commands.activateItem(onlyId);
  if (action === 'edit' && onlyId) {
    const chosen = shortcut(onlyId);
    return editorDialog.showEditor(isWebLink(chosen) ? 'web' : 'shortcut', chosen);
  }
  if (action === 'rename' && onlyId) {
    if (windowLayout(onlyId)) {
      setStatus('Window layout names and icons are fixed.');
      return;
    }
    return editorDialog.showEditor('group', group(onlyId) ?? windowLayout(onlyId));
  }
  if (action === 'copy') return commands.copySelection();
  if (action === 'cut') return commands.cutSelection();
  if (action === 'bin') return commands.moveSelectionToBin();
  if (action === 'restore') return confirmDialog.askRestoreConfirm([...session.selected]);
  if (action === 'delete-forever') return confirmDialog.askPermanentDelete();
  if (action === 'reset-graph-position') return commands.resetGraphPositions();
  if (action === 'rename-set') return beginSetRename();
  if (action === 'delete-sets') return commands.deleteSelectedSets();
  if (action === 'remove-from-layout') {
    // 040: member context action -> the existing scoped data-only unlink
    // writer with the clicked composite layout/member key. Scoped cache
    // cleanup, one persistence, active-only reconcile; never a cross-layout
    // mutation. Read the target from the menu dataset (set at open time).
    // On the WIDGET surface the intent routes through the widget channel to
    // the workspace writer (the widget never writes the store itself).
    const layoutId = elements.menu.dataset.wlLayout;
    const memberId = elements.menu.dataset.wlMember;
    delete elements.menu.dataset.wlLayout;
    delete elements.menu.dataset.wlMember;
    if (!layoutId || !memberId) return;
    if (WIDGET_SURFACE && windowLayoutWidgetClient) {
      windowLayoutWidgetClient.sendCommand({ kind: 'remove-member', memberId });
      return;
    }
    handleWindowLayoutUnlink(layoutId, memberId);
    return;
  }
}

// 016 inner member drag: reorder within the layout, or unlink (data-only)
// beyond a clear outside threshold. Never starts outer graph drag and never
// moves/resizes/minimizes/closes the external window. 018X4: the drag state
// machine lives in the shared createWindowLayoutMemberDrag guard so the
// read-only handoff can cancel it and a later pointerup / reused pointer ID
// cannot finalize an unlink/reorder after reattach.
const windowLayoutMemberDrag = createWindowLayoutMemberDrag();
let windowLayoutDragJustMoved = false;
const WINDOW_LAYOUT_DROP_OUT_PX = 40;

/** 018X6: restores the member row's live DOM order back to the canonical
 * persisted arrangement order (a pointermove may already have reordered the
 * buttons before a read-only cancellation). Same DOM nodes/listeners are
 * preserved; nothing is committed/saved/finalized. */
function restoreWindowLayoutMemberDomOrder(layoutId) {
  const members = document.querySelector(`[data-wl-members="${CSS.escape(layoutId)}"]`);
  const layout = windowLayoutFromState(layoutId);
  if (!members || !layout) return;
  const memberIds = (layout.arrangement?.members ?? []).map((member) => member.id);
  const ordered = orderWindowLayoutMemberButtons(
    [...members.querySelectorAll('[data-wl-member]')],
    memberIds,
  );
  for (const button of ordered) {
    if (button.parentNode === members) members.appendChild(button);
  }
}

/** 018X4/018X6: cancels an in-progress 016 member drag WITHOUT finalizing a
 * move: rolls back any visual DOM reorder to the canonical order, clears the
 * drag state and the drag-out visual, so a later pointerup (e.g. after the
 * read-only handoff disarms) or a reused pointer ID cannot trigger an unlink
 * or reorder. Used by read-only entry and Escape (force-cancel). */
function cancelWindowLayoutDrag() {
  const layoutId = windowLayoutMemberDrag.get()?.layoutId;
  windowLayoutMemberDrag.cancel();
  if (layoutId) restoreWindowLayoutMemberDomOrder(layoutId);
  const members = document.querySelector('[data-wl-members].wl-drag-out');
  if (members) members.classList.remove('wl-drag-out');
}

elements.grid.addEventListener('pointerdown', (event) => {
  if (WIDGET_SURFACE) return;
  const body = event.target.closest('.window-layout-body');
  if (body && event.button === 0 && !event.ctrlKey && !event.shiftKey
    && !event.target.closest('button, input, [data-wl-member]')) {
    // Attached cards need their own inner-selection clear. The outer graph
    // blank handler never sees this press because card events intentionally
    // stop before workspace selection/navigation. Clear on pointerdown so a
    // graph drag or pointer capture cannot swallow the later click.
    clearWindowLayoutMemberSelection(body.dataset.wlLayout);
  }
  const member = event.target.closest('[data-wl-member]');
  if (!member || !event.ctrlKey || event.button !== 0) return;
  cancelWindowLayoutPreviewDwell();
  windowLayoutMemberPopover.hide();
  windowLayoutMemberPreview.cancel();
  windowLayoutMemberDrag.start({
    layoutId: member.dataset.wlLayout,
    memberId: member.dataset.wlMember,
    clientX: event.clientX,
    clientY: event.clientY,
    pointerId: event.pointerId,
  });
});

elements.grid.addEventListener('pointermove', (event) => {
  if (WIDGET_SURFACE) return;
  const drag = windowLayoutMemberDrag.move(event.pointerId, event.clientX, event.clientY);
  if (!drag) return;
    const members = document.querySelector(`[data-wl-members="${CSS.escape(drag.layoutId)}"]`);
    const button = document.querySelector(`[data-wl-layout="${CSS.escape(drag.layoutId)}"] [data-wl-member="${CSS.escape(drag.memberId)}"]`);
  if (!members || !button) return;
  const row = members.getBoundingClientRect();
  const outside = event.clientY < row.top - WINDOW_LAYOUT_DROP_OUT_PX
    || event.clientY > row.bottom + WINDOW_LAYOUT_DROP_OUT_PX
    || event.clientX < row.left - WINDOW_LAYOUT_DROP_OUT_PX
    || event.clientX > row.right + WINDOW_LAYOUT_DROP_OUT_PX;
  members.classList.toggle('wl-drag-out', outside);
  if (outside) return;
  moveWindowLayoutMemberButton(members, button, event.clientX, event.clientY);
});

elements.grid.addEventListener('pointerup', (event) => {
  if (WIDGET_SURFACE) return;
  windowLayoutMemberDrag.finalize(event.pointerId, (drag) => {
    const members = document.querySelector(`[data-wl-members="${CSS.escape(drag.layoutId)}"]`);
    if (!members) return;
    const row = members.getBoundingClientRect();
    const outside = event.clientY < row.top - WINDOW_LAYOUT_DROP_OUT_PX
      || event.clientY > row.bottom + WINDOW_LAYOUT_DROP_OUT_PX
      || event.clientX < row.left - WINDOW_LAYOUT_DROP_OUT_PX
      || event.clientX > row.right + WINDOW_LAYOUT_DROP_OUT_PX;
    members.classList.remove('wl-drag-out');
    const layout = windowLayoutFromState(drag.layoutId);
    if (!layout) return;
    if (!drag.moved) return; // plain click: handled by the click delegation
    windowLayoutDragJustMoved = true;
    if (outside) {
      // Escape-like cancel path: data-only unlink, never closes or moves it.
      handleWindowLayoutUnlink(drag.layoutId, drag.memberId);
      return;
    }
    const buttons = [...members.querySelectorAll('[data-wl-member]')];
    const toIndex = buttons.findIndex((button) => button.dataset.wlMember === drag.memberId);
    if (toIndex === -1) return;
    const next = reorderWindowLayoutMember(state, drag.layoutId, drag.memberId, toIndex);
    // One commit = one persistence request; only broadcast after it settles.
    void store.commit(next).then((persisted) => {
      if (persisted) noteWindowLayoutCommit(drag.layoutId);
    });
  });
});

elements.grid.addEventListener('pointercancel', (event) => {
  if (WIDGET_SURFACE) return;
  // 018X6: ordinary pointercancel cancels ONLY when its pointerId matches the
  // active drag (preserving prior multi-pointer behavior); read-only/Escape
  // force-cancel via cancelWindowLayoutDrag().
  const active = windowLayoutMemberDrag.get();
  if (!active || !windowLayoutMemberDrag.cancelMatching(event.pointerId)) return;
  restoreWindowLayoutMemberDomOrder(active.layoutId);
  const members = document.querySelector('[data-wl-members].wl-drag-out');
  if (members) members.classList.remove('wl-drag-out');
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && windowLayoutMemberDrag.isActive()) {
    cancelWindowLayoutDrag();
  }
});

elements.grid.addEventListener('click', (event) => {
  if (WIDGET_SURFACE) return;
  event.stopPropagation();
  const expandButton = event.target.closest('[data-expand]');
  if (expandButton) {
    const folderId = expandButton.dataset.expand;
    // Assignment 007: a trail tile's chevron expands the trail branch for
    // THIS view context; an ordinary tile's chevron expands ordinary
    // content. The two sets never touch.
    if (graph._isTrailNode(folderId)) {
      const next = new Set(store.getSession().trailExpanded);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      setCurrentTrailExpanded([...next]);
    } else {
      store.toggleGraphExpanded(folderId);
    }
    closeMenu();
    render();
    saveWorkspaceView();
    return;
  }
  // Assignment 015/016: window-layout member/control clicks are handled here
  // and never fall through to selection, navigation or graph drag.
  const windowLayoutBody = event.target.closest('.window-layout-body');
  if (windowLayoutBody) {
    // 035: while a layout's widget is open its attached card is a greyed
    // placeholder — every ordinary interaction is inert except its explicit
    // plain-click reattach lock.
    const bodyLayoutId = windowLayoutBody.dataset?.wlLayout;
    const detachedLayout = typeof bodyLayoutId === 'string' && bodyLayoutId && detachedWidgets.has(bodyLayoutId);
    if (detachedLayout && !event.target.closest('[data-wl-reattach]')) return;
    const memberButton = event.target.closest('[data-wl-member]');
    if (memberButton) {
      if (windowLayoutDragJustMoved) {
        windowLayoutDragJustMoved = false;
        return;
      }
      void handleWindowLayoutMemberClick(memberButton.dataset.wlLayout, memberButton.dataset.wlMember, event.ctrlKey, event.shiftKey);
      return;
    }
    const pickCandidate = event.target.closest('[data-wl-pick-candidate]');
    if (pickCandidate) {
      void handleWindowLayoutPickCandidate(pickCandidate.dataset.wlPick, pickCandidate.dataset.wlPickCandidate);
      return;
    }
    const unlink = event.target.closest('[data-wl-unlink]');
    if (unlink) {
      void handleWindowLayoutUnlink(unlink.dataset.wlPick, unlink.dataset.wlUnlink);
      return;
    }
    const pickerClose = event.target.closest('[data-wl-picker-close]');
    if (pickerClose) {
      closeWindowLayoutPicker();
      return;
    }
    const listButton = event.target.closest('[data-wl-list]');
    if (listButton) {
      void openWindowLayoutPicker(listButton.dataset.wlList);
      return;
    }
    const minAll = event.target.closest('[data-wl-min-all]');
    if (minAll) {
      void windowLayoutGroupAction(minAll.dataset.wlMinAll, 'minimize');
      return;
    }
    const restoreAll = event.target.closest('[data-wl-restore-all]');
    if (restoreAll) {
      void windowLayoutGroupAction(restoreAll.dataset.wlRestoreAll, 'restore');
      return;
    }
    const reattach = event.target.closest('[data-wl-reattach]');
    if (reattach) {
      const layoutId = reattach.dataset.wlReattach;
      if (detachedWidgets.delete(layoutId)) render();
      void host.widgetClose(layoutId).catch(() => undefined);
      return;
    }
    return;
  }
  const tile = event.target.closest('.icon-item');
  if (tile) {
    if (suppressGraphClick) {
      suppressGraphClick = false;
      return;
    }
    if (tile.classList.contains('bin-origin-ghost')) return;
    // Assignment 003: an ancestor tile is the breadcrumb as folder
    // contents — clicking it navigates into that folder, never selects.
    if (tile.classList.contains('ancestor-item')) {
      // Assignment 003: an ancestor tile is the breadcrumb as folder
      // contents — clicking it navigates exactly as the pill's crumb
      // buttons do, never selecting.
      if (session.binMode) {
        store.setNavigation({ binCurrentId: tile.dataset.id });
      } else {
        // Navigate with ROOT_ID itself, not null: top-level items are stored
        // under ROOT_ID, so a null current folder makes itemsIn and
        // collectVisible find nothing and the workspace renders empty.
        store.setNavigation({ currentId: tile.dataset.id });
      }
      store.clearSelection();
      graph.destroyGraphView();
      closeMenu();
      render();
      saveWorkspaceView();
      return;
    }
    // While Ctrl+G is open a click picks the set the item belongs to, rather
    // than changing the selection being edited — the subjects were captured
    // when the mode opened, so changing selection underneath it would edit
    // membership for items the user is no longer looking at. Trail items are
    // outside the set system in this view: pointing at one must not drive
    // the subjects' membership.
    if (setMembershipMode.isActive()) {
      if (tile.classList.contains('trail-item')) return;
      setMembershipMode.toggleFromItem(tile.dataset.id);
      return;
    }
    // Shift+left-click stands in for double-click: it opens the item. The
    // range-selection it used to do assumed items sit in a linear order,
    // which is meaningless in a force-directed graph where "between" has no
    // definition. Shift+DRAG still pins (pointer-controller owns that) — this
    // only fires on a click that never became a drag.
    if (event.shiftKey && !event.ctrlKey) {
      commands.activateItem(tile.dataset.id, { revealDirectoryTarget: true });
      return;
    }
    commands.selectItem(tile.dataset.id, {
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      visibleItemIds: visibleItemIds(),
    });
    return;
  }
  const blank = event.target.closest('[data-blank-parent], [data-icon-grid]');
  if (blank) {
    if (suppressBlankClick) {
      suppressBlankClick = false;
      return;
    }
    if (suppressGraphClick) {
      suppressGraphClick = false;
      return;
    }
    // Blank space inside a set's ring selects that set. The click landed on the
    // canvas rather than an icon, so the outline is the only thing it could
    // have been about — and this has to come before clearing, or selecting a
    // set would immediately deselect it.
    // No optional chaining: while clientToWorld was missing from the pointer
    // controller's exports, `?.` turned its absence into undefined, then into
    // an empty hit list, and clicking inside a ring did nothing at all with no
    // way to tell a missing function from a missed ring. A throw here would at
    // least reach the status bar.
    const world = pointer.clientToWorld(event.clientX, event.clientY);
    const hitSets = graph.setIdsAtPoint(world);
    if (hitSets.length > 0) {
      commands.selectSets([hitSets[0]], { additive: event.ctrlKey === true });
      closeMenu();
      return;
    }
    store.clearSelection();
    commands.clearSetSelection();
    store.setSelectionAnchor(null);
    syncSelection();
    closeMenu();
    saveWorkspaceView();
  }
});


elements.grid.addEventListener('contextmenu', (event) => {
  if (WIDGET_SURFACE) return;
  event.preventDefault();
  event.stopPropagation();
  // Opening the context menu can implicitly cancel an in-progress pointer
  // sequence without ever dispatching pointerup/pointercancel to the grid
  // (observed with Shift+right-click on a folder) — leaving graph-dragging/
  // will-pin/graph-drop-target visuals stuck on whatever tile the pointer
  // last touched. Cancel the drag defensively any time the menu opens.
  pointer.cancelDrag();
  const isolateToggle = event.target.closest('[data-wl-min-all]');
  if (isolateToggle) {
    toggleWindowLayoutIsolateMode(isolateToggle.dataset.wlMinAll);
    return;
  }
  // 019B: Shift+right-click on a member minimizes/restores the selected range
  // (direction from the clicked member's live state). 040: a PLAIN right-click
  // on a member opens the member context menu (`Remove from this layout`); it
  // must never trigger preview, reorder, selection, or removal from another
  // layout, and the inert grey placeholder card refuses removal.
  const wlMember = event.target.closest('[data-wl-member]');
  if (wlMember) {
    if (event.ctrlKey && !event.shiftKey && windowLayoutRuntime.isolateMode.isActive(wlMember.dataset.wlLayout)) {
      const targets = windowLayoutRuntime.isolateMode.click(wlMember.dataset.wlLayout, wlMember.dataset.wlMember, true);
      if (targets !== null) void windowLayoutGroupAction(wlMember.dataset.wlLayout, 'isolate', targets);
      return;
    }
    if (event.shiftKey) {
      void windowLayoutToggleRange(wlMember.dataset.wlLayout, wlMember.dataset.wlMember);
      return;
    }
    const layoutId = wlMember.dataset.wlLayout;
    const memberId = wlMember.dataset.wlMember;
    if (!layoutId || !memberId) return;
    // 040: grey placeholder refusal — the placeholder card's members are
    // disabled and never offer removal.
    if (wlMember.disabled) return;
    // 040: scope the removal target on the menu element (layoutId/memberId).
    elements.menu.dataset.wlLayout = layoutId;
    elements.menu.dataset.wlMember = memberId;
    openMenu(event.clientX, event.clientY, 'member', layoutId);
    return;
  }
  const tile = event.target.closest('.icon-item');
  if (tile && tile.classList.contains('bin-origin-ghost')) return;
  // An ancestor tile has no context menu (nothing on it can be renamed,
  // moved or deleted), but Shift+right-click is this workspace's expand
  // gesture and must keep working on it — returning early here is what
  // made expanding a trail folder impossible.
  const isAncestorTile = tile?.classList.contains('ancestor-item') === true;
  if (isAncestorTile && !event.shiftKey && !event.altKey) return;
  if (tile) {
    if ((event.shiftKey || event.altKey) && tile.dataset.kind === 'group') {
      const id = tile.dataset.id;
      if (event.altKey) {
        // Alt+right-click is the inverse of Shift: Shift toggles the folder
        // you clicked, Alt toggles every OTHER folder IN THAT FOLDER'S SETS.
        // Sets are what express "these belong together", so the gesture is
        // scoped by membership rather than by whatever happens to be on
        // screen. It is a toggle, not a collapse — if the others are open it
        // closes them ("isolate this one within its set"), and pressing it
        // again reopens them. Direction is decided once, from whether ANY
        // other member is currently open, so one gesture never both opens
        // and closes. A folder in no set has no others to act on.
        const ownSetIds = new Set(graph.setIdsContaining(id));
        const others = [...elements.grid.querySelectorAll('.icon-item')]
          .filter((node) => node.dataset.kind === 'group' && node.dataset.id !== id)
          .map((node) => node.dataset.id)
          .filter((folderId) => graph.setIdsContaining(folderId)
            .some((setId) => ownSetIds.has(setId)));
        const anyOtherExpanded = others.some((folderId) => session.graphExpanded.has(folderId));
        for (const folderId of others) {
          if (anyOtherExpanded) store.removeFromGraphExpanded(folderId);
          else store.addToGraphExpanded(folderId);
        }
      } else {
        const folderIds = session.selected.has(id)
          ? [...session.selected].filter((selectedId) => group(selectedId))
          : [id];
        const shouldExpand = !session.graphExpanded.has(id);
        for (const folderId of folderIds) {
          // Assignment 007: trail tiles expand only the current view
          // context's trail set; ordinary folders expand ordinary content.
          if (graph._isTrailNode(folderId)) {
            const next = new Set(store.getSession().trailExpanded);
            if (next.has(folderId)) next.delete(folderId);
            else next.add(folderId);
            setCurrentTrailExpanded([...next]);
          } else if (shouldExpand) {
            store.addToGraphExpanded(folderId);
          } else {
            store.removeFromGraphExpanded(folderId);
          }
        }
      }
      closeMenu();
      // Right-clicking a tile moves DOM focus onto it (standard mousedown
      // behavior) even though it's only tabindex="-1" — the plain
      // right-click path clears this because opening the context menu
      // moves focus onto one of its buttons, but this Shift+right-click
      // expand shortcut never opens a menu, so the tile's :focus-visible
      // outline would otherwise stay stuck on screen until something else
      // happens to move focus away.
      tile.blur();
      render();
      saveWorkspaceView();
      return;
    }
    if (!session.selected.has(tile.dataset.id)) {
      store.setSelection([tile.dataset.id]);
      store.setSelectionAnchor(tile.dataset.id);
      syncSelection();
      saveWorkspaceView();
    }
    openMenu(event.clientX, event.clientY);
    return;
  }
  const blank = event.target.closest('[data-blank-parent], [data-icon-grid]');
  if (!blank) return;
  const world = pointer.clientToWorld(event.clientX, event.clientY);
  const contextTarget = resolveContextTarget({
    hitSetIds: graph.setIdsAtPoint(world),
    selectedSetIds: session.selectedSets,
  });
  if (contextTarget.kind === 'set') {
    openMenu(event.clientX, event.clientY);
    return;
  }
  if (session.binMode) {
    if (session.selected.size > 0) openMenu(event.clientX, event.clientY);
    return;
  }
  if (session.selected.size > 0) {
    openMenu(event.clientX, event.clientY);
    return;
  }
  openMenu(
    event.clientX,
    event.clientY,
    'blank',
    blank.dataset.blankParent ?? session.currentId,
  );
});

document.addEventListener('click', (event) => {
  if (!elements.menu.hidden && !event.target.closest('#context-menu') && !event.target.closest('.icon-item')) {
    closeMenu();
  }
});

// Escape (or a click anywhere else) closes an open window-layout picker
// without changing anything (Assignment 015).
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && windowLayoutRuntime.pickUnsubscribe) {
    event.preventDefault();
    event.stopPropagation();
    void cancelWindowLayoutPick();
    return;
  }
  if (windowLayoutRuntime.pickUnsubscribe && (event.key === ' ' || event.key === 'Enter')) {
    event.preventDefault();
    event.stopPropagation();
    const activePickLayout = windowLayoutRuntime.pickLayoutId;
    const request = event.key === ' '
      ? host.pickWindowStage()
      : host.pickWindowCommit();
    void request.catch((error) => setWindowLayoutStatus(
      activePickLayout ?? 'active',
      error instanceof Error ? error.message : String(error),
    ));
    return;
  }
  if (event.key === 'Escape' && windowLayoutRuntime.pickerOpenFor) {
    closeWindowLayoutPicker();
  }
});
document.addEventListener('click', (event) => {
  if (windowLayoutRuntime.pickerOpenFor && !event.target.closest('[data-wl-picker]')) {
    closeWindowLayoutPicker();
  }
});

elements.explorer.addEventListener('wheel', (event) => {
  if (WIDGET_SURFACE) return;
  if (!event.ctrlKey) return;
  event.preventDefault();
  state = store.replace(setIconSize(state, state.view.iconSize + (event.deltaY < 0 ? 12 : -12)));
  render();
  clearTimeout(zoomTimer);
  zoomTimer = setTimeout(() => persist().catch((error) => {
    // 018X6: a delayed persistence error must not paint status over the
    // handoff if read-only began before this catch ran.
    if (detachSaveGate.isReadOnly()) return;
    setStatus(String(error));
  }), 250);
}, { passive: false });

elements.breadcrumbs.addEventListener('click', (event) => {
  const binCrumb = event.target.closest('[data-bin-breadcrumb]');
  if (binCrumb) {
    store.setNavigation({ binCurrentId: binCrumb.dataset.binBreadcrumb });
    store.clearSelection();
    graph.destroyGraphView();
    render();
    saveWorkspaceView();
    return;
  }
  const crumb = event.target.closest('[data-breadcrumb]');
  if (!crumb) return;
  store.setNavigation({ currentId: crumb.dataset.breadcrumb });
  store.clearSelection();
  graph.destroyGraphView();
  render();
  saveWorkspaceView();
});

const PICKUP_COPY_LABEL = 'Copy agent pickup prompt';
const PICKUP_COPY_FLASH_MS = 1800;
let pickupCopyTimer = null;

/** Confirms a pickup copy. The button is icon-only and its label is sr-only,
 * so the visible acknowledgement has to be on the button itself; the label
 * still changes for screen readers. One timer, so a rapid second copy restarts
 * the confirmation instead of the first firing partway through and clearing
 * it early. */
function confirmPickupCopy(message) {
  const button = document.querySelector('#copy-prompt');
  const label = document.querySelector('.copy-label');
  if (pickupCopyTimer != null) {
    clearTimeout(pickupCopyTimer);
    button?.classList.remove('pickup-copied');
  }
  if (label) label.textContent = 'Copied';
  button?.classList.add('pickup-copied');
  setStatus(message);
  elements.status.classList.add('status-copied');
  pickupCopyTimer = setTimeout(() => {
    pickupCopyTimer = null;
    button?.classList.remove('pickup-copied');
    if (label) label.textContent = PICKUP_COPY_LABEL;
    // Clear the text as well as the emphasis. Dropping only the class would
    // leave the confirmation behind in the red error styling.
    if (elements.status.textContent === message) setStatus('');
  }, PICKUP_COPY_FLASH_MS);
}

// Background-opacity pill. `input` repaints live while dragging so the panel
// tracks the thumb; `change` is what persists, so a drag writes state once on
// release instead of on every frame.
elements.backdropOpacitySlider.addEventListener('input', () => {
  const opacity = Number(elements.backdropOpacitySlider.value);
  document.documentElement.style.setProperty('--workspace-backdrop-opacity', String(opacity));
  document.documentElement.style.setProperty(
    '--workspace-backdrop-opacity-percent',
    `${Math.round(opacity * 10000) / 100}%`,
  );
  elements.backdropOpacityValue.textContent = `${Math.round(opacity * 100)}%`;
});

elements.backdropOpacitySlider.addEventListener('change', async () => {
  const preferences = setBackdropOpacity(
    state.view?.preferences,
    Number(elements.backdropOpacitySlider.value),
  );
  const nextState = { ...state, view: { ...state.view, preferences } };
  try {
    await commit(nextState);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  }
});

document.querySelector('#copy-prompt').addEventListener('click', async () => {
  try {
    const selectedTargets = [...session.selected]
      .map((selectedId) => shortcutByRecordOrPlacementId(selectedId))
      .filter(Boolean)
      .map((candidate) => candidate.target);
    const outcome = resolveCopierAction(selectedTargets, promptLibrary.getSnapshotLibrary());
    if (outcome.kind === 'open') {
      promptLibrary.open({ message: 'Select at least one prompt for batch copying.' });
      return;
    }
    await host.copyText(outcome.text);
    const noun = outcome.copied === 'paths' ? 'path' : 'prompt';
    confirmPickupCopy(`Copied ${outcome.count} ${outcome.count === 1 ? noun : `${noun}s`}.`);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  }
});

const toolbar = createToolbarController({
  window,
  document,
  getState: () => state,
  setState: (next) => { state = store.replace(next); },
  setToolbarPosition,
  getToolbarPosition,
  persist,
  setStatus,
});

const confirmDialog = createConfirmationDialog({
  elements,
  getState: () => state,
  getSelectedIds: () => [...session.selected],
  binItemName,
  permanentlyDelete,
  restoreSelection,
  commit,
});

const menu = createContextMenu({
  elements,
  window,
  getCurrentId: () => session.currentId,
  getBinMode: () => session.binMode,
  getClipboard: () => session.clipboard,
  getSelectedItems: () => [...session.selected].map(item).filter(Boolean),
  getSelectedSets: () => [...session.selectedSets]
    .map((id) => (state.view?.itemSets ?? []).find((candidate) => candidate.id === id))
    .filter(Boolean),
  isWebLink,
  onAction: runMenuAction,
});
// Thin compatibility shims so the entry file's existing call sites stay put
// while the context menu's real implementation lives in the module above.
const closeMenu = () => menu.closeMenu();
const openMenu = (...args) => menu.openMenu(...args);

// Constructed after graph and closeMenu are initialized (both are consts
// declared later in the file); evaluating graph/closeMenu as argument
// values any earlier would hit the temporal dead zone.
const commands = createWorkspaceCommands({
  store,
  group,
  windowLayout,
  shortcut,
  item,
  isWebLink,
  host,
  graph,
  resolveBinTargets,
  visiblePlacementIdFor,
  visibleParentCountFor,
  allActivePlacementIds,
  anyActivePlacementId,
  moveSelection,
  copySelection,
  collapsePlacements,
  binSelection,
  graphContextId,
  removeGraphPositions,
  setGraphPositions,
  createWebLink,
  createDroppedShortcuts,
  setItemSets,
  // The graph's own ancestor chain, so inherited membership is resolved the
  // same way the ring is drawn. A separate walk here would let the two disagree
  // about which items a folder set covers.
  ancestorsOfNode: (id) => graph.ancestorsOfNode(id),
  // Assignment 003: the ancestors currently shown in this view (the path
  // to here, excluding the current folder itself) cannot be binned or
  // moved.
  isAncestorItem: (id) => (session.binMode
    ? pathToBin(session.binCurrentId === 'bin' ? null : session.binCurrentId).slice(0, -1)
    : pathTo(session.currentId).slice(0, -1)
  ).some((entry) => entry.id === id),
  syncSelection,
  saveWorkspaceView,
  closeMenu,
  render,
  setStatus,
});

let activeSetRename = null;
function beginSetRename() {
  const ids = [...store.getSession().selectedSets];
  if (ids.length !== 1) {
    setStatus('Select exactly one set to rename.');
    return false;
  }
  const setId = ids[0];
  const itemSet = (state.view?.itemSets ?? []).find((candidate) => candidate.id === setId);
  const path = graph.setPathFor(setId);
  if (!itemSet || !path) {
    setStatus('That set is not visible here.');
    return false;
  }
  activeSetRename?.cancel();
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'set-name-editor';
  input.value = itemSet.title ?? '';
  input.setAttribute('aria-label', 'Set name');
  const rect = path.getBoundingClientRect();
  input.style.left = `${rect.left + rect.width / 2 - 90}px`;
  input.style.top = `${rect.top + rect.height / 2 - 18}px`;
  document.body.append(input);
  const finish = async (save) => {
    if (!activeSetRename) return;
    activeSetRename = null;
    input.remove();
    if (save) await commands.renameSet(setId, input.value);
  };
  activeSetRename = { cancel: () => { activeSetRename = null; input.remove(); } };
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); void finish(true); }
    else if (event.key === 'Escape') { event.preventDefault(); void finish(false); }
  });
  input.addEventListener('blur', () => { void finish(true); }, { once: true });
  input.focus();
  input.select();
  return true;
}

// Constructed after commands: the controller delegates session mutation and
// persistence to the marquee commands.
const marquee = createMarqueeController({
  elements,
  commands,
  itemsIntersectingMarquee,
});

const drop = createDropController({
  document,
  elements,
  store,
  commands,
});

const pointer = createPointerController({
  window,
  document,
  elements,
  store,
  commands,
  graph,
  marquee,
  zoomTransform,
  group,
  visiblePlacementIdFor,
  closeMenu,
  onDragTrail: (itemIds) => graph.recordDragTrail(itemIds),
  clearDragTrail: () => graph.clearDragTrail(),
  setSuppressGraphClick: (value) => { suppressGraphClick = value; },
  setSuppressBlankClick: (value) => { suppressBlankClick = value; },
  consumeSuppressGraphClick: () => {
    if (!suppressGraphClick) return false;
    suppressGraphClick = false;
    return true;
  },
});
graph._setOnDragCancel(() => pointer.cancelDrag());
// Where unpinned nodes came to rest. Written through `state` rather than
// through the store alone: saveWorkspaceView rebuilds the view from this
// variable, so an update that only reached the store would be overwritten by
// the next save before it ever hit disk.
graph._setOnRestPositions((positions) => {
  state = store.replace(
    setGraphRestPositions(state, graphContextId(session.currentId, session.binMode), positions),
  );
  saveWorkspaceView();
});

const editorDialog = createEditorDialog({
  elements,
  document,
  getState: () => state,
  getCurrentId: () => session.currentId,
  closeMenu,
  host,
  iconCache,
  compressIconFile,
  hydrateWebPreview,
  commit,
  render,
  shortcut,
  isWebLink,
  placementCount,
  forkPlacement,
  anyActivePlacementId,
  visiblePlacementIdFor,
  updateGroup,
  createGroup,
  updateWebLink,
  createWebLink,
  updateShortcut,
  createShortcut,
});
const showEditor = (...args) => editorDialog.showEditor(...args);

const binControls = createBinControls({
  elements,
  getState: () => state,
  getBinMode: () => session.binMode,
  setBinMode: (next) => store.setNavigation({ binMode: next }),
  getSelectedIds: () => [...session.selected],
  clearSelection: () => { store.clearSelection(); },
  resetDrillDown: () => store.setNavigation({ binCurrentId: 'bin' }),
  binnedItems,
  moveToBin: () => commands.moveSelectionToBin(),
  confirmDialog,
  closeMenu,
  render,
  saveWorkspaceView,
});

/** Ctrl+G membership picking.
 *
 * Constructed before the keyboard controller, which needs it to route Enter
 * and Escape while the mode is open. Sets are chosen by clicking their
 * contents rather than from a list, so the mode also intercepts canvas clicks
 * — see the graph click handler. */
const setMembershipMode = createSetMembershipMode({
  getSets: () => state.view?.itemSets ?? [],
  // Trail items are outside the set system in this view: they never open
  // the picker as subjects, and confirming must not write their (view-
  // suppressed) membership into the persisted sets.
  getSelectedIds: () => [...store.getSession().selected]
    .filter((id) => !graph._isTrailNode(id)),
  shareSelectionWithSets: (desired, itemIds, before) =>
    commands.shareSelectionWithSets(desired, itemIds, before),
  // The graph's chain, matching how the ring decides membership. Resolving
  // inheritance two different ways here would let the picker disagree with the
  // outline about which items a folder set covers.
  ancestorsOf: (itemId) => graph.ancestorsOfNode(itemId),
  render: () => render(),
  setStatus,
});

const keyboard = createKeyboardController({
  document,
  elements,
  store,
  commands,
  closeMenu,
  getVisibleItemIds: visibleItemIds,
  confirmDialog,
  beginSetMembershipEdit: () => setMembershipMode.begin(),
  setMembershipMode,
  setStatus,
  beginSetRename,
});

const promptLibrary = createPromptLibraryDialog({
  document,
  store,
  fallbackPrompt: PICKUP_PROMPT,
  copyText: (text) => host.copyText(text),
  setStatus,
  onViewPreferencesChanged: (next) => {
    applyTheme(next.view?.preferences);
    graph.refreshEdgeOpacity();
    render();
  },
});

// ---- 019C compact-widget surface bootstrap --------------------------------
// `?papers-surface=compact-widget&papers-layout-key=<id>` renders ONLY the named
// layout's card and routes every card interaction through the same-origin
// widget channel to the WORKSPACE writer. No old 018 wait-for-ACTIVATE/read-only
// lifecycle; widget-ready is reported after the channel message listener exists.
// The widget never writes the store/save/recording persistence.
function bootstrapWindowLayoutWidget() {
  const { layoutId } = WIDGET_SURFACE;
  const widgetOpacityStorageKey = `papers-window-layout-widget-opacity:${layoutId}`;
  const storedWidgetOpacity = Number(localStorage.getItem(widgetOpacityStorageKey));
  let widgetOpacity = Number.isFinite(storedWidgetOpacity)
    ? Math.max(0, Math.min(1, storedWidgetOpacity))
    : null;

  function applyWidgetOpacity(fallback = 1) {
    const opacity = widgetOpacity ?? fallback;
    document.documentElement.style.setProperty('--workspace-backdrop-opacity', String(opacity));
    document.documentElement.style.setProperty(
      '--workspace-backdrop-opacity-percent',
      `${Math.round(opacity * 10000) / 100}%`,
    );
  }
  const channel = new BroadcastChannel(WINDOW_LAYOUT_WIDGET_CHANNEL);
  const widgetState = {
    selection: new Set(),
    anchor: new Map(),
    snapshot: { id: layoutId, name: layoutId, members: [] },
    candidates: null,
    pickUnsubscribe: null,
    lastRevision: -1,
    // 035: true once a real workspace snapshot has been received (the restore
    // below must never run against the empty initial default snapshot).
    snapshotReceived: false,
  };
  // 035: the widget restores its window size EXACTLY ONCE after the first real
  // snapshot; every later resize is user-owned and only reported for persistence.
  let windowRestoredOnce = false;
  // 019G/021: bounded snapshot re-request for a transient unknown-layout.
  let snapshotRetry = null;

  function handleWidgetMessage(message) {
    if (message.type === 'snapshot' || message.type === 'committed' || message.type === 'stale') {
      if (typeof message.revision !== 'number' || message.revision === widgetState.lastRevision) return;
      widgetState.lastRevision = message.revision;
      if (message.snapshot && typeof message.snapshot === 'object' && message.snapshot.id === layoutId) {
        widgetState.snapshot = message.snapshot;
        if (message.snapshot.appearance && typeof message.snapshot.appearance === 'object') {
          applyTheme(message.snapshot.appearance);
          applyWidgetOpacity(Number(message.snapshot.appearance.backdropOpacity) || 0);
        }
        widgetState.snapshotReceived = true;
        const memberIds = new Set((message.snapshot.members ?? []).map((member) => member.id));
        for (const memberId of [...widgetState.selection]) {
          if (!memberIds.has(memberId)) widgetState.selection.delete(memberId);
        }
         renderWidgetCard({ skipHostResize: message.reason === 'reorder' || message.commandKind === 'reorder' });
      }
      return;
    }
    if (message.type === 'error') {
      if (message.code === 'unknown-layout') {
        // 019G/021: the workspace may still be loading durable state. Bounded
        // re-request so the first open is never stuck on the empty card.
        if (!snapshotRetry) {
          snapshotRetry = createBoundedRetry({
            attempts: 3,
            delayMs: 250,
            request: () => client.requestSnapshot(),
            shouldRetry: () => true,
            onResult: () => { snapshotRetry = null; },
          });
          snapshotRetry.start();
        }
        return;
      }
      setWindowLayoutStatus(layoutId, message.message || message.code || 'Command failed');
    }
  }

  function renderWidgetCard({ skipHostResize = false } = {}) {
    // 019GR: replacing the card must cancel the hover preview, hide the popover
    // and clear the ephemeral widget capability cache so a late reply cannot
    // paint a removed/replaced card. The snapshot ref feeds the surface-aware
    // preview resolver.
    windowLayoutMemberPreview.cancel();
    windowLayoutMemberPopover.hide();
    windowLayoutWidgetPreviewCapabilities.clear();
    windowLayoutWidgetPreviewSnapshot = widgetState.snapshot;
    // 019G/021: seed the shared icon cache from the snapshot's bounded icons so
    // the SAME member markup renders REAL member icons (prune stale ones).
    // 040: composite layout\u0000member cache identity — prune only THIS
    // layout's keys that are no longer in the snapshot.
    const snapshot = widgetState.snapshot;
    const snapshotKeys = new Set((snapshot.members ?? []).map((member) => windowLayoutMemberKey(layoutId, member.id)));
    const layoutPrefix = `${layoutId}\u0000`;
    for (const key of [...windowLayoutRuntime.icons.keys()]) {
      if (key.startsWith(layoutPrefix) && !snapshotKeys.has(key)) windowLayoutRuntime.icons.delete(key);
    }
    for (const member of snapshot.members ?? []) {
      if (typeof member.icon === 'string' && member.icon.length > 0) {
        windowLayoutRuntime.icons.set(windowLayoutMemberKey(layoutId, member.id), member.icon);
      }
    }
    // 033 C5: the detached widget renders the EXACT SAME card component as the
    // attached grid node - one shared card, two homes.
    removeWindowLayoutCardPresentation(elements.grid);
    elements.grid.innerHTML = windowLayoutCardMarkup(
      { id: snapshot.id, name: snapshot.name, arrangement: { members: snapshot.members } },
      { widgetSurface: true },
    );
    installWindowLayoutCardPresentation(elements.grid);
    const card = elements.grid.querySelector('.window-layout-body');
    if (card) {
      card.addEventListener('pointerdown', (event) => {
        event.stopPropagation();
        if (event.button === 0 && !event.ctrlKey && !event.shiftKey
          && !event.target.closest('button, input, [data-wl-member]')) {
          clearWidgetSelection();
          beginBlankWidgetDrag(event, card);
        }
      });
      card.addEventListener('click', handleWidgetCardClick);
      card.addEventListener('auxclick', handleWidgetCardAuxClick);
      card.addEventListener('mouseover', (event) => {
        const listButton = event.target.closest('[data-wl-list]');
        const relatedListButton = event.relatedTarget?.closest?.('[data-wl-list]') ?? null;
        if (listButton && listButton !== relatedListButton) {
          scheduleWindowLayoutListDwell(listButton, openWidgetPicker);
        }
      });
      card.addEventListener('mouseout', (event) => {
        const listButton = event.target.closest('[data-wl-list]');
        const relatedListButton = event.relatedTarget?.closest?.('[data-wl-list]') ?? null;
        if (listButton && listButton !== relatedListButton) cancelWindowLayoutListDwell();
      });
      card.addEventListener('contextmenu', handleWidgetCardContextMenu);
    }
    syncWidgetSelection();
    // 035: restore the window ONCE after the first real snapshot (persisted
    // shared card geometry, or a content-fit when none exists yet). 039: after
    // that, EVERY re-render (e.g. a member-count change) auto-corrects the
    // native client height to the rendered card content height. The FIRST
    // restore reports BOTH axes itself; its own native resize event drives the
    // follow-up height correction, so the correction never measures the
    // transient default width (which would clobber the restored width).
    const wasRestored = windowRestoredOnce;
    restoreWidgetWindowSize();
    if (wasRestored && !skipHostResize) reportWidgetSize();
  }

  /** 035: the full card content size — the card root plus any member/control
   * strip content that must not be clipped by the hidden scrollbars. The card
   * fills its host width, so the measured width equals the window content
   * width and only the height is a real content-fit input. */
  function measureWidgetCardContent() {
    const cardEl = elements.grid.querySelector('.window-layout-card');
    if (!cardEl) return null;
    const rect = cardEl.getBoundingClientRect();
    let width = rect.width;
    // `getBoundingClientRect()` is clipped to the current native viewport when
    // a width resize creates extra wrapped rows. scrollHeight retains the full
    // laid-out card, including content below the clipped bottom edge.
    let height = Math.max(rect.height, cardEl.scrollHeight);
    for (const strip of cardEl.querySelectorAll('[data-wl-members], .window-layout-controls')) {
      if (strip.scrollWidth > width) width = strip.scrollWidth;
    }
    return { width: Math.ceil(width), height: Math.ceil(height) };
  }

  /** 035: restore the frameless widget window exactly once, after the first
   * real workspace snapshot. With a persisted shared geometry the window opens
   * at that size (the layout's last resize); without one it content-fits to
   * the card's natural size. The host applies the report verbatim (no
   * +tolerance), so the card's fill-width never creeps. */
  function restoreWidgetWindowSize() {
    if (windowRestoredOnce || !widgetState.snapshotReceived) return;
    windowRestoredOnce = true;
    const cardSize = widgetState.snapshot?.cardSize;
    if (cardSize && typeof cardSize.width === 'number' && typeof cardSize.height === 'number'
      && Number.isFinite(cardSize.width) && Number.isFinite(cardSize.height)
      && cardSize.width >= 1 && cardSize.height >= 1) {
      // 037: a persisted width is the actual card/client width; an over-max
      // legacy value is capped so the window opens content-fitted immediately.
      void host.widgetReportSize(
        Math.round(Math.min(cardSize.width, WINDOW_LAYOUT_CARD_MAX_WIDTH)),
        Math.round(cardSize.height),
      ).catch(() => undefined);
      return;
    }
    const memberCount = widgetState.snapshot?.members?.length ?? 0;
    const preferredColumns = memberCount <= 8 ? Math.max(1, memberCount) : Math.ceil(memberCount / Math.ceil(memberCount / 8));
    const naturalWidth = Math.min(WINDOW_LAYOUT_CARD_MAX_WIDTH, Math.max(158, (preferredColumns * 28) + ((preferredColumns - 1) * 4) + 16));
    const content = measureWidgetCardContent();
    if (content && content.height > 0) {
      void host.widgetReportSize(naturalWidth, content.height).catch(() => undefined);
    }
  }

  /** 039/041: report the ACTUAL shared card/client presentation geometry —
   * WIDTH = the rendered card border-box width (content-fit, capped at the
   * compact maximum; a few-member card never retains a wide empty minimum) and
   * HEIGHT = the rendered card content height. When the card reflows (a user
   * width resize or a member-count change) the native client is auto-corrected
   * to the card border box, so the detached host equals the card in BOTH axes
   * with no empty vertical canvas and no clipping. The width stays user-
   * resizable (narrowing drives wrapping) and continuously measurement-driven;
   * the report also persists the shared geometry so reattach matches. */
  function reportWidgetSize() {
    const width = window.innerWidth;
    const content = measureWidgetCardContent();
    const cardWidth = Math.min(width, WINDOW_LAYOUT_CARD_MAX_WIDTH);
    const height = content && content.height > 0 ? content.height : window.innerHeight;
    // 037: snap an over-max client width; 039: auto-correct the client height;
    // 041: snap the client width to the content-fit card border box. One report.
    if (width > WINDOW_LAYOUT_CARD_MAX_WIDTH
      || Math.abs(height - window.innerHeight) > 1) {
      void host.widgetReportSize(cardWidth, height).catch(() => undefined);
    }
    client.sendCardSize(cardWidth, height);
  }

  function syncWidgetSelection() {
    for (const button of elements.grid.querySelectorAll('[data-wl-member]')) {
      const selected = widgetState.selection.has(button.dataset.wlMember);
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-selected', String(selected));
    }
  }

  function toggleWidgetMemberSelection(memberId) {
    if (widgetState.selection.has(memberId)) widgetState.selection.delete(memberId);
    else widgetState.selection.add(memberId);
    widgetState.anchor.set(layoutId, memberId);
    syncWidgetSelection();
  }

  function clearWidgetSelection() {
    if (widgetState.selection.size === 0) return;
    widgetState.selection.clear();
    widgetState.anchor.delete(layoutId);
    syncWidgetSelection();
  }

  let blankWidgetDrag = null;
  function signalBlankWidgetDrag(phase, event) {
    window.postMessage({
      type: 'papers:project:widget-drag',
      phase,
      x: event.screenX,
      y: event.screenY,
    }, window.location.origin);
  }

  function beginBlankWidgetDrag(event, card) {
    blankWidgetDrag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      dragging: false,
    };
    card.setPointerCapture?.(event.pointerId);
    signalBlankWidgetDrag('begin', event);
  }

  window.addEventListener('pointermove', (event) => {
    if (!blankWidgetDrag || blankWidgetDrag.pointerId !== event.pointerId) return;
    if (!blankWidgetDrag.dragging) {
      const distance = Math.hypot(event.clientX - blankWidgetDrag.startX, event.clientY - blankWidgetDrag.startY);
      if (distance < 4) return;
      blankWidgetDrag.dragging = true;
    }
    event.preventDefault();
    signalBlankWidgetDrag('move', event);
  }, { capture: true });

  const endBlankWidgetDrag = (event) => {
    if (!blankWidgetDrag || blankWidgetDrag.pointerId !== event.pointerId) return;
    signalBlankWidgetDrag('end', event);
    blankWidgetDrag = null;
  };
  window.addEventListener('pointerup', endBlankWidgetDrag, { capture: true });
  window.addEventListener('pointercancel', endBlankWidgetDrag, { capture: true });

  // Leaving the detached widget for Papers/Backpack cancels only its ephemeral
  // Ctrl/Shift member selection. The widget and persisted layout stay open and
  // unchanged.
  // Capture the plain press at the window boundary as well as the card click:
  // native frameless dragging/pointer capture may suppress the later click,
  // but a blank press must always clear the ephemeral Ctrl/range selection.
  window.addEventListener('pointerdown', (event) => {
    if (event.button === 0 && !event.ctrlKey && !event.shiftKey
      && !event.target.closest('button, input, [data-wl-member]')) clearWidgetSelection();
  }, { capture: true });
  window.addEventListener('blur', clearWidgetSelection);
  windowLayoutWidgetSelectionChannel?.addEventListener('message', (event) => {
    if (event.data?.type === 'clear-selection') clearWidgetSelection();
  });

  function handleWidgetCardClick(event) {
    event.stopPropagation();
    const member = event.target.closest('[data-wl-member]');
    if (member) {
      if (widgetDragJustMoved) {
        widgetDragJustMoved = false;
        return;
      }
      const memberId = member.dataset.wlMember;
      const isolationTargets = !event.ctrlKey && !event.shiftKey
        ? windowLayoutRuntime.isolateMode.click(layoutId, memberId, false)
        : null;
      if (isolationTargets !== null) {
        client.sendCommand({ kind: 'group-action', action: 'isolate', memberIds: isolationTargets });
        return;
      }
      if (event.ctrlKey) {
        // 019C: widget-local ephemeral selection (Ctrl toggle / Shift range);
        // only committed actions are routed to the workspace writer.
        toggleWidgetMemberSelection(memberId);
        return;
      }
      if (event.shiftKey) {
        const ordered = (widgetState.snapshot.members ?? []).map((candidate) => candidate.id);
        const anchorId = widgetState.anchor.get(layoutId);
        const anchorIndex = ordered.indexOf(anchorId);
        const clickedIndex = ordered.indexOf(memberId);
        widgetState.selection = new Set();
        if (anchorIndex === -1 || clickedIndex === -1) {
          widgetState.selection.add(memberId);
        } else {
          const [start, end] = anchorIndex <= clickedIndex
            ? [anchorIndex, clickedIndex] : [clickedIndex, anchorIndex];
          for (let index = start; index <= end; index += 1) widgetState.selection.add(ordered[index]);
        }
        widgetState.anchor.set(layoutId, memberId);
        syncWidgetSelection();
        return;
      }
      client.sendCommand({ kind: 'member-toggle', memberId });
      return;
    }
    const pickCandidate = event.target.closest('[data-wl-pick-candidate]');
    if (pickCandidate) {
      void handleWidgetListCandidate(pickCandidate.dataset.wlPickCandidate);
      return;
    }
    const pickerClose = event.target.closest('[data-wl-picker-close]');
    if (pickerClose) {
      closeWidgetPicker();
      return;
    }
    const listButton = event.target.closest('[data-wl-list]');
    if (listButton) {
      return;
    }
    const minAll = event.target.closest('[data-wl-min-all]');
    if (minAll) {
      client.sendCommand({ kind: 'group-action', action: 'minimize', memberIds: [...widgetState.selection] });
      return;
    }
    const restoreAll = event.target.closest('[data-wl-restore-all]');
    if (restoreAll) {
      client.sendCommand({ kind: 'group-action', action: 'restore', memberIds: [...widgetState.selection] });
      return;
    }
    // Plain blank-card click exits the widget-local Ctrl/range selection. This
    // is ephemeral presentation state only: no member is toggled, no command
    // is sent to the workspace writer, and no layout data is changed.
    if (widgetState.selection.size > 0) {
      clearWidgetSelection();
    }
  }

  function handleWidgetCardAuxClick(event) {
    if (event.button !== 1) return;
    const minimizeAll = event.target.closest('[data-wl-min-all]');
    if (!minimizeAll) return;
    event.preventDefault();
    event.stopPropagation();
    client.dispose();
    void host.widgetCloseSelf().catch(() => undefined);
  }

  async function handleWidgetCardContextMenu(event) {
    event.preventDefault();
    event.stopPropagation();
    const isolateToggle = event.target.closest('[data-wl-min-all]');
    if (isolateToggle) {
      toggleWindowLayoutIsolateMode(isolateToggle.dataset.wlMinAll);
      return;
    }
    const member = event.target.closest('[data-wl-member]');
    if (member && event.ctrlKey && !event.shiftKey && windowLayoutRuntime.isolateMode.isActive(layoutId)) {
      const targets = windowLayoutRuntime.isolateMode.click(layoutId, member.dataset.wlMember, true);
      if (targets !== null) client.sendCommand({ kind: 'group-action', action: 'isolate', memberIds: targets });
      return;
    }
    if (member && event.shiftKey) {
      client.sendCommand({
        kind: 'range-toggle',
        memberId: member.dataset.wlMember,
        memberIds: [...widgetState.selection],
      });
      return;
    }
    // A detached widget is frequently narrower than an ordinary menu. Ask its
    // trusted native host for a real popup so the action can extend beyond the
    // widget bounds and dismiss normally with Escape, blur or an outside click.
    if (member) {
      const memberId = member.dataset.wlMember;
      if (!memberId || member.disabled) return;
      windowLayoutMemberPreview.cancel();
      try {
        const result = await host.widgetContextMenu();
        if (result?.action === 'remove') {
          const selectedIds = widgetState.selection.size > 0
            ? [...widgetState.selection]
            : [memberId];
          const selectedSet = new Set(selectedIds);
          const removes = (widgetState.snapshot.members ?? [])
            .filter((candidate) => selectedSet.has(candidate.id))
            .map((candidate) => ({ descriptor: candidate.descriptor }));
          if (removes.length === 0) return;
          client.sendCommand({
            kind: 'picker-commit',
            pick: { outcome: 'committed', adds: [], removes },
          });
          clearWidgetSelection();
        }
      } catch (error) {
        setWindowLayoutStatus(layoutId, error instanceof Error ? error.message : String(error));
      }
    }
  }

  let widgetPickerOpen = false;
  async function openWidgetPicker() {
    if (widgetPickerOpen) {
      return;
    }
    widgetPickerOpen = true;
    // 019G: a picker covering the desktop must clear/discard the hover preview.
    windowLayoutMemberPreview.cancel();
    try {
      const selectedTitles = new Set((widgetState.snapshot.members ?? [])
        .map((member) => member.descriptor.title));
      while (true) {
        const result = await host.windowCandidates();
        if (result.outcome !== 'success') {
          setWindowLayoutStatus(layoutId, result.error || 'List unavailable');
          break;
        }
        widgetState.candidates = result.candidates;
        const picked = await host.windowCandidatePicker(result.candidates.map((candidate) => ({
          id: candidate.id,
          title: candidate.title,
          icon: candidate.icon ?? null,
          current: selectedTitles.has(candidate.title),
        })));
        if (picked.action === 'close' && picked.candidateId) {
          await closeWindowLayoutCandidate(layoutId, picked.candidateId, result.candidates);
          continue;
        }
        if (picked.action === 'direct-pick') {
          await beginWidgetDirectPick();
          break;
        }
        if (picked.action !== 'select' || !picked.candidateId) break;
        const pickedRow = result.candidates.find((candidate) => candidate.id === picked.candidateId);
        const changed = await handleWidgetListCandidate(
          picked.candidateId,
          pickedRow ? selectedTitles.has(pickedRow.title) : null,
        );
        if (changed && pickedRow) {
          if (selectedTitles.has(pickedRow.title)) selectedTitles.delete(pickedRow.title);
          else selectedTitles.add(pickedRow.title);
        }
      }
    } catch (error) {
      setWindowLayoutStatus(layoutId, error instanceof Error ? error.message : String(error));
    } finally {
      widgetPickerOpen = false;
      closeWidgetPicker();
    }
  }

  function windowLayoutWidgetPickerMarkup(candidates) {
    const currentTitles = new Set((widgetState.snapshot.members ?? []).map((member) => member.descriptor.title));
    const rows = candidates.map((candidate) => {
      const isCurrent = currentTitles.has(candidate.title);
      return `<button class="window-layout-pick-candidate${isCurrent ? ' current-member' : ''}" data-wl-pick-candidate="${escapeHtml(candidate.id)}" type="button" title="${escapeHtml(candidate.title)}">
        ${candidate.icon
          ? `<img class="window-layout-pick-icon" src="${escapeHtml(candidate.icon)}" alt="">`
          : '<span class="window-layout-pick-icon placeholder" aria-hidden="true"></span>'}
        <span class="window-layout-pick-label">${escapeHtml(candidate.title)}</span>
        <span class="window-layout-pick-state">${isCurrent ? 'remove' : escapeHtml(candidate.state ?? 'add')}</span>
      </button>`;
    }).join('');
    return `<div class="window-layout-picker-panel">
      <div class="window-layout-picker-head">Choose an onscreen window (click a member row to remove it)
        <button class="window-layout-picker-close" data-wl-picker-close="true" type="button" title="Close picker">×</button>
      </div>
      <div class="window-layout-picker-list">${rows || '<div class="window-layout-empty">No eligible windows</div>'}</div>
    </div>`;
  }

  function closeWidgetPicker() {
    widgetState.candidates = null;
    const pickerHost = elements.grid.querySelector(`[data-wl-picker="${CSS.escape(layoutId)}"]`);
    if (pickerHost) pickerHost.innerHTML = '';
    restoreHoveredWindowLayoutPreview(layoutId);
    return host.windowCandidatePickerClose().catch(() => undefined);
  }

  async function handleWidgetListCandidate(candidateId, selectedOverride = null) {
    const row = (widgetState.candidates ?? []).find((candidate) => candidate.id === candidateId);
    if (!row) return false;
    const bound = await host.bindWindowCandidate(candidateId);
    if (bound.outcome !== 'success') {
      setWindowLayoutStatus(layoutId, bound.error || 'Pick failed');
      return false;
    }
    const isMember = typeof selectedOverride === 'boolean'
      ? selectedOverride
      : (widgetState.snapshot.members ?? [])
        .some((member) => member.descriptor.title === bound.descriptor.title);
    if (isMember) {
      client.sendCommand({ kind: 'picker-commit', pick: { outcome: 'committed', adds: [], removes: [{ descriptor: bound.descriptor }] } });
    } else {
      client.sendCommand({ kind: 'picker-commit', pick: { outcome: 'committed', adds: [{ descriptor: bound.descriptor, capability: bound.capability, candidate: row }], removes: [] } });
    }
    return true;
  }

  async function beginWidgetDirectPick() {
    // 019G: the pick overlay covers the desktop; clear/discard the hover preview.
    windowLayoutMemberPreview.cancel();
    // As on the attached surface, the native chooser must be fully destroyed
    // before starting the direct picker or it can steal picker ownership.
    await closeWidgetPicker();
    windowLayoutRuntime.pickLayoutId = layoutId;
    const members = uniqueWindowLayoutMemberDescriptors(
      (widgetState.snapshot.members ?? []).map((member) => member.descriptor),
    );
    let pickUnsubscribe = null;
    try {
      // Recover an orphaned main-process picker before starting this widget's
      // fresh one-shot session. This also makes a second click a clean restart.
      await host.pickWindowCancel();
      // Subscribe to the result push BEFORE awaiting begin, so an immediate
      // pick never misses its result (016R pattern).
      const beginPromise = host.pickWindowBegin(members);
      const pickPromise = new Promise((resolve) => {
        pickUnsubscribe = host.onPickResult(resolve);
        widgetState.pickUnsubscribe = pickUnsubscribe;
      });
      const begin = await beginPromise;
      if (begin.outcome !== 'started') {
        pickUnsubscribe?.();
        if (widgetState.pickUnsubscribe === pickUnsubscribe) {
          widgetState.pickUnsubscribe = null;
        }
        setWindowLayoutStatus(layoutId, begin.error || 'Direct pick is unavailable');
        return;
      }
      const result = await pickPromise;
      if (result.outcome === 'failed') {
        setWindowLayoutStatus(layoutId, result.error || 'Pick failed');
        return;
      }
      // Winter's one typed committed set goes to the WORKSPACE writer; the
      // widget never applies it locally.
      client.sendCommand({ kind: 'picker-commit', pick: result });
    } catch {
      pickUnsubscribe?.();
      if (widgetState.pickUnsubscribe === pickUnsubscribe) {
        widgetState.pickUnsubscribe = null;
      }
      setWindowLayoutStatus(layoutId, 'Direct pick is unavailable');
    } finally {
      pickUnsubscribe?.();
      if (widgetState.pickUnsubscribe === pickUnsubscribe) {
        widgetState.pickUnsubscribe = null;
      }
      if (windowLayoutRuntime.pickLayoutId === layoutId) {
        windowLayoutRuntime.pickLayoutId = null;
      }
    }
  }

  window.addEventListener('keydown', (event) => {
    if (!widgetState.pickUnsubscribe) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      void host.pickWindowCancel();
    } else if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      void (event.key === ' ' ? host.pickWindowStage() : host.pickWindowCommit());
    }
  });

  window.addEventListener('pagehide', () => {
    widgetState.pickUnsubscribe?.();
    widgetState.pickUnsubscribe = null;
    snapshotRetry?.cancel();
    snapshotRetry = null;
    if (cardSizeTimer !== null) {
      clearTimeout(cardSizeTimer);
      cardSizeTimer = null;
    }
    // 019GR: pagehide discards pending preview work and clears the ephemeral
    // widget capability cache.
    windowLayoutMemberPreview.cancel();
    windowLayoutWidgetPreviewCapabilities.clear();
    // 035: report the widget is closing so the workspace restores its attached
    // card (no longer a greyed placeholder).
    client.dispose();
    client.close();
    windowLayoutWidgetClient = null;
  });

  // 035/037/039: the live widget reports its shared card geometry whenever the
  // creator resizes it (debounced) so the workspace persists it. The width is
  // capped at the compact presentation maximum (over-max snaps), and the
  // HEIGHT is the rendered card content height, so the native client
  // auto-corrects to fit the card in both axes after every reflow.
  let cardSizeTimer = null;
  window.addEventListener('resize', () => {
    // Trailing-edge correction: while the creator is dragging an edge Windows
    // owns the native size and can overwrite an early correction. Re-arm on
    // every event, then fit the wrapped height once that resize burst settles.
    if (cardSizeTimer !== null) clearTimeout(cardSizeTimer);
    cardSizeTimer = setTimeout(() => {
      cardSizeTimer = null;
      reportWidgetSize();
    }, 80);
  });

  // 019C: the widget channel client installs its message listener in the
  // factory, so widget-ready is reported ONLY after the listener exists. The
  // preload latches the hidden token and forwards READY to the session; no
  // ACTIVATE/load gate.
  const client = createWindowLayoutWidgetChannelClient({
    channel,
    layoutId,
    onMessage: handleWidgetMessage,
  });
  windowLayoutWidgetClient = client;
  // 040: the widget card's member context menu (`Remove from this layout`) is
  // the SHARED context menu component; it must be mounted in the widget surface
  // too (the workspace bootstrap does this, but the widget never runs it).
  menu.mount();
  // 024: member-icon reordering in the DETACHED/compact-widget card. The widget
  // never writes the store: a drag reorders the live DOM and sends a bounded
  // `reorder` intent through the channel; the workspace applies + broadcasts
  // the fresh snapshot. Capture-phase listeners run before the card's own
  // stopPropagation handlers.
  const widgetMemberDrag = createWindowLayoutMemberDrag();
  let widgetDragJustMoved = false;
  window.addEventListener('wheel', (event) => {
    // A detached widget has no scrollable document. Chromium does not always
    // preserve Ctrl in wheel events for a non-focusable native window, so the
    // wheel itself is the stable input contract here (Ctrl+wheel still works).
    event.preventDefault();
    event.stopImmediatePropagation();
    const hostOpacity = Number(widgetState.snapshot.appearance?.backdropOpacity) || 0;
    const current = widgetOpacity ?? hostOpacity;
    widgetOpacity = Math.max(0, Math.min(1, Math.round((current + (event.deltaY < 0 ? 0.05 : -0.05)) * 100) / 100));
    localStorage.setItem(widgetOpacityStorageKey, String(widgetOpacity));
    applyWidgetOpacity(hostOpacity);
  }, { capture: true, passive: false });
  function suppressNextWidgetMemberClick() {
    widgetDragJustMoved = true;
    setTimeout(() => { widgetDragJustMoved = false; }, 0);
  }
  elements.grid.addEventListener('pointerdown', (event) => {
    const member = event.target.closest('[data-wl-member]');
    if (!member || !event.ctrlKey || event.button !== 0) return;
    event.preventDefault();
    cancelWindowLayoutPreviewDwell();
    windowLayoutMemberPopover.hide();
    windowLayoutMemberPreview.cancel();
    // A lost pointerup from a previous OS/native transition must not poison the
    // next Ctrl-drag. Each press owns a fresh captured pointer session.
    widgetMemberDrag.cancel();
    widgetMemberDrag.start({
      layoutId: member.dataset.wlLayout,
      memberId: member.dataset.wlMember,
      clientX: event.clientX,
      clientY: event.clientY,
      pointerId: event.pointerId,
    });
    member.classList.add('wl-member-dragging');
    // Capture on the stable grid, not the button whose DOM position changes
    // during live reorder. Moving a captured button can release capture after
    // the first insertion and incorrectly limit a drag to one slot.
    try { elements.grid.setPointerCapture(event.pointerId); } catch { /* unsupported */ }
  }, true);
  elements.grid.addEventListener('pointermove', (event) => {
    const drag = widgetMemberDrag.move(event.pointerId, event.clientX, event.clientY);
    if (!drag) return;
    event.preventDefault();
    const members = elements.grid.querySelector(`[data-wl-members="${CSS.escape(drag.layoutId)}"]`);
    const button = elements.grid.querySelector(`[data-wl-layout="${CSS.escape(drag.layoutId)}"] [data-wl-member="${CSS.escape(drag.memberId)}"]`);
    if (!members || !button) return;
    const row = members.getBoundingClientRect();
    const outside = event.clientY < row.top - WINDOW_LAYOUT_DROP_OUT_PX
      || event.clientY > row.bottom + WINDOW_LAYOUT_DROP_OUT_PX
      || event.clientX < row.left - WINDOW_LAYOUT_DROP_OUT_PX
      || event.clientX > row.right + WINDOW_LAYOUT_DROP_OUT_PX;
    members.classList.toggle('wl-drag-out', outside);
    if (outside) return;
    moveWindowLayoutMemberButton(members, button, event.clientX, event.clientY);
  }, true);
  elements.grid.addEventListener('pointerup', (event) => {
    widgetMemberDrag.finalize(event.pointerId, (drag) => {
      const members = elements.grid.querySelector(`[data-wl-members="${CSS.escape(drag.layoutId)}"]`);
      if (!members) return;
      const dragged = members.querySelector(`[data-wl-member="${CSS.escape(drag.memberId)}"]`);
      dragged?.classList.remove('wl-member-dragging');
      members.classList.remove('wl-drag-out');
      if (!drag.moved) {
        // Pointer capture retargets the eventual click to the grid. Complete
        // Ctrl-click selection here when the gesture never became a drag.
        toggleWidgetMemberSelection(drag.memberId);
        suppressNextWidgetMemberClick();
        return;
      }
      suppressNextWidgetMemberClick();
      const buttons = [...members.querySelectorAll('[data-wl-member]')];
      const toIndex = buttons.findIndex((button) => button.dataset.wlMember === drag.memberId);
      if (toIndex === -1) return;
      client.sendCommand({ kind: 'reorder', memberId: drag.memberId, toIndex });
    });
    const captured = elements.grid.querySelector(`[data-wl-member].wl-member-dragging`);
    captured?.classList.remove('wl-member-dragging');
    try { elements.grid.releasePointerCapture(event.pointerId); } catch { /* already released */ }
  }, true);
  elements.grid.addEventListener('pointercancel', (event) => {
    const active = widgetMemberDrag.get();
    if (!active || !widgetMemberDrag.cancelMatching(event.pointerId)) return;
    const members = elements.grid.querySelector(`[data-wl-members="${CSS.escape(active.layoutId)}"]`);
    if (members) members.classList.remove('wl-drag-out');
    const captured = elements.grid.querySelector(`[data-wl-member="${CSS.escape(active.memberId)}"]`);
    captured?.classList.remove('wl-member-dragging');
    try { elements.grid.releasePointerCapture(event.pointerId); } catch { /* already released */ }
  }, true);
  elements.grid.addEventListener('lostpointercapture', (event) => {
    const active = widgetMemberDrag.get();
    if (!active || active.pointerId !== event.pointerId) return;
    widgetMemberDrag.cancelMatching(event.pointerId);
    const members = elements.grid.querySelector(`[data-wl-members="${CSS.escape(active.layoutId)}"]`);
    if (members) members.classList.remove('wl-drag-out');
    members?.querySelector(`[data-wl-member="${CSS.escape(active.memberId)}"]`)?.classList.remove('wl-member-dragging');
  }, true);
  return host.widgetReady().then(() => {
    client.ready();
    client.requestSnapshot();
  });
}

// 018A1/018X1/018X2/018V2: the detached surface (?detach=1) registers lifecycle
// listeners at factory creation, then (018V2 two-sided latch) reports page
// READY EXACTLY ONCE — only after its detach-message listener is installed and
// BEFORE it waits for ACTIVATE/load/bootstrap. The durable-state load is gated
// on ACTIVATE (after the workspace stop+flush ACK). On pagehide the activate
// waiter resolves the explicit CANCELLED sentinel: the loadState rejects
// (bootstrap must not load) and the controller bootstrap is skipped while
// stopped, so neither durable state nor the controller starts.
// 019C: the compact-widget surface never runs the workspace graph/workspace
// bootstrap, the old 018 wait-for-ACTIVATE lifecycle or the recording
// controller (the workspace window owns all of those).
if (WIDGET_SURFACE) {
  void bootstrapWindowLayoutWidget();
} else {
  const DETACHED_SURFACE = windowLayoutDetachment.getState().mode === 'detached';
  if (DETACHED_SURFACE) {
    void windowLayoutDetachment.reportReady();
  }
  /**
   * 0B composition. The coordinator owns write authority, the revision and the
   * conflict; the store keeps the document, history, serialization and save
   * ordering; the panel only follows the role.
   */
  function startSurfaceCoordination() {
    if (typeof navigator === 'undefined' || !navigator.locks || typeof BroadcastChannel !== 'function') {
      // Without both primitives there can be no safe election, so this surface
      // stays exactly as it was rather than pretending to coordinate.
      return;
    }
    const channel = new BroadcastChannel(SURFACE_DOCUMENT_CHANNEL);
    const conflictPanel = createDocumentConflictPanel({
      document,
      onUseLatest: () => surfaceCoordinator.useLatest().then(render),
      onKeepMine: () => surfaceCoordinator.keepMine().then(render),
      confirm: (message) => confirmDialog.askConfirm({
        title: 'Keep your version?',
        copy: message,
        confirmLabel: 'Keep my version',
      }),
    });
    surfaceCoordinator = createSurfaceCoordinator({
      lock: webLockAdapter(navigator),
      channel,
      host: {
        loadVersioned: () => host.loadWorkspaceVersioned(),
        saveChecked: (serialized, revision) => host.saveWorkspaceChecked(serialized, revision),
      },
      // Installs the document only. This surface's navigation is deliberately
      // preserved, so two windows keep showing different places.
      installDocument: (document_) => { state = store.install(document_); render(); },
      invalidatePendingSaves: () => store.invalidatePendingSaves(),
      onRoleChange: (role) => {
        conflictPanel.syncToRole(role, elements.explorer);
        render();
      },
    });
    channel.addEventListener('message', (event) => {
      if (surfaceCoordinator.receive(event.data)) render();
    });
    void surfaceCoordinator.start();
  }

  void bootstrapWorkspace({
    loadState: DETACHED_SURFACE
      ? () => windowLayoutDetachment.waitForActivate().then((transferId) => {
        if (transferId === DETACH_ACTIVATE_CANCELLED) {
          throw new Error('detach activate cancelled');
        }
        return host.loadWorkspace();
      })
      : () => host.loadWorkspace(),
    setState: (next) => { state = store.install(next); },
    restoreWorkspaceView,
    setStatus,
    render,
    toolbar,
    confirmDialog,
    menu,
    editorDialog,
    binControls,
    keyboard,
    drop,
    pointer,
    promptLibrary,
  }).then(() => {
    if (!windowLayoutDetachment.isStopped()) bootstrapWindowLayoutRecording();
    // 0B: elect a document writer among the surfaces of this project.
    //
    // Only ordinary workspace surfaces take part. A detached surface receives
    // ownership through the existing 018 STOP -> FLUSH -> ACTIVATE handshake,
    // and until the coordinator's reservation is wired into that handshake,
    // giving a detached surface a lock to wait on could deadlock against a
    // workspace that never releases. That integration is deliberately separate.
    if (!DETACHED_SURFACE) startSurfaceCoordination();
    // 019G/021: after durable state loads, broadcast a real snapshot for every
    // layout so an already-open widget is never stuck on `unknown-layout` /
    // the empty default card (cold-open readiness race).
    for (const layout of state.windowLayouts ?? []) {
      windowLayoutWidgetChannelWorkspace.broadcast(layout.id);
    }
  });
}

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
  updateWindowLayoutMember,
  reorderWindowLayoutMember,
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
import { glyphPath, layoutTitleGlyphs } from './set-glyph-model.js';
import { createSetEffectsController } from './set-effects-model.js';
import { createDragTrailController } from './drag-trail-model.js';
import { decomposeRegions, regionCentroid, regionPath } from './set-region-model.js';
import { hydrateIcons as hydrateIconsScoped, hydrateWebPreview } from './web-link-icon-20260730b.js';
import { createHostBridge } from './app/host/host-bridge.js';
import { compressIconFile } from './app/utilities/image-compression.js';
import { getWorkspaceElements } from './app/dom.js';
import { createToolbarController } from './app/components/toolbar-controller.js';
import { createStatusToast } from './app/components/status-toast.js';
import { createPromptLibraryDialog } from './app/components/prompt-library-dialog.js';
import { getBackdropOpacity, getEdgeOpacity, getOutlineOpacity, getRegionOpacity, getTheme, getTrailOpacity, getTransparentBackground, setBackdropOpacity } from './app/hotkeys-model.js';
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

const iconCache = new Map();
let state = normalizeState({ schemaVersion: 1, groups: [], shortcuts: [] });

const store = createWorkspaceStore({
  getState: () => state,
  setState: (next) => { state = next; },
  normalizeState,
  persist: (snapshot) => host.saveWorkspace(snapshot),
  setStatus,
  initialSession: { currentId: ROOT_ID },
  prepare: (next, session) => captureWorkspaceViewFrom(next, session),
  afterCommit: () => {
    closeMenu();
    render();
  },
});
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
  state = store.replace(captureWorkspaceView());
  void store.save(state).catch((error) =>
    setStatus(error instanceof Error ? error.message : String(error)));
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
    return '<span class="window-layout-art" aria-hidden="true"><span></span><span></span></span>';
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

function descriptionMarkup(candidate) {
  return candidate.kind === 'shortcut' && candidate.description
    ? `<small>${escapeHtml(candidate.description)}</small>`
    : '';
}

/** The compact live body inside a window-layout shell: one button per
 * persisted member (program icon, exact title, static state marker), group
 * controls, a picker host and a status line. Buttons never begin outer
 * graph dragging because the graph drag excludes <button> pointerdowns
 * by design (Assignment 015/016). No Activate control and no affirmative
 * Recording furniture (016 creator correction): adding a member captures
 * its bounds/state immediately and tracking is implicit. */
function windowLayoutBodyMarkup(candidate) {
  const members = (candidate.arrangement?.members ?? []).map((member) =>
    windowLayoutMemberMarkup(candidate.id, member)).join('');
  const emptyHint = (candidate.arrangement?.members ?? []).length === 0
    ? '<div class="window-layout-empty" data-wl-empty="true">No windows yet</div>'
    : '';
  const status = windowLayoutStatusText(candidate.id);
  return `<div class="window-layout-body" data-wl-layout="${escapeHtml(candidate.id)}" aria-label="Window group">
    <div class="window-layout-members" data-wl-members="${escapeHtml(candidate.id)}">${members}${emptyHint}</div>
    <div class="window-layout-controls">
      <button class="window-layout-control wl-pick" type="button" data-wl-pick="${escapeHtml(candidate.id)}" title="Pick an onscreen window directly">Pick onscreen</button>
      <button class="window-layout-control wl-list" type="button" data-wl-list="${escapeHtml(candidate.id)}" title="Choose from the list of onscreen windows">List</button>
      <button class="window-layout-control wl-min-all" type="button" data-wl-min-all="${escapeHtml(candidate.id)}" title="Minimize all members">Minimize all</button>
      <button class="window-layout-control wl-restore-all" type="button" data-wl-restore-all="${escapeHtml(candidate.id)}" title="Restore/open all members">Restore all</button>
      <button class="window-layout-control wl-isolate" type="button" data-wl-isolate="${escapeHtml(candidate.id)}" title="Restore the selected members and minimize the rest of this layout">Isolate</button>
    </div>
    <div class="window-layout-picker" data-wl-picker="${escapeHtml(candidate.id)}"></div>
    <div class="window-layout-status" data-wl-status="${escapeHtml(candidate.id)}">${escapeHtml(status)}</div>
  </div>`;
}

function windowLayoutMemberMarkup(layoutId, member) {
  const icon = windowLayoutMemberIcon(layoutId, member.id);
  const iconMarkup = icon
    ? `<img class="window-layout-member-icon" src="${escapeHtml(icon)}" alt="" data-wl-member-icon="${escapeHtml(member.id)}">`
    : `<span class="window-layout-member-icon placeholder" data-wl-member-icon="${escapeHtml(member.id)}" aria-hidden="true"></span>`;
  const stateClass = member.state === 'minimized' ? 'minimized' : 'normal';
  return `<button class="window-layout-member ${stateClass}" data-wl-member="${escapeHtml(member.id)}" data-wl-layout="${escapeHtml(layoutId)}" type="button" title="${escapeHtml(member.descriptor.title)} - ${stateClass}">
    ${iconMarkup}
    <span class="window-layout-member-label">${escapeHtml(member.descriptor.title)}</span>
    <span class="window-layout-member-state ${stateClass}" aria-hidden="true"></span>
  </button>`;
}

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
const windowLayoutRuntime = {
  activeRecordingLayoutId: null,
  capabilities: new Map(),   // memberId -> capability (ephemeral)
  icons: new Map(),          // memberId -> data URL (ephemeral)
  pickerOpenFor: null,
  pickerCandidates: null,
  recordingTimer: null,
  observationPending: false,
  suppression: null,
  saveTimer: null,
  selectedMembers: new Map(), // layoutId -> Set<memberId> (inner multiselect)
  pickUnsubscribe: null,
};

const WINDOW_LAYOUT_OBSERVE_CADENCE_MS = 500;
const WINDOW_LAYOUT_SAVE_DEBOUNCE_MS = 300;

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

function setWindowLayoutStatus(layoutId, text) {
  const status = document.querySelector(`[data-wl-status="${CSS.escape(layoutId)}"]`);
  if (status) status.textContent = text;
}

function windowLayoutMemberIcon(layoutId, memberId) {
  const cached = windowLayoutRuntime.icons.get(memberId);
  if (cached !== undefined) return cached;
  const member = windowLayoutMemberFromState(layoutId, memberId);
  if (!member) return null;
  // Lazy host-side re-enrichment after reload: match the persisted
  // descriptor against the trusted candidate list (bounded, cached).
  void host.windowCandidates().then((result) => {
    if (result.outcome !== 'success') return;
    const match = result.candidates.find((candidate) =>
      candidate.title === member.descriptor.title && candidate.icon);
    if (!match) return;
    windowLayoutRuntime.icons.set(memberId, match.icon);
    const img = document.querySelector(`[data-wl-member-icon="${CSS.escape(memberId)}"]`);
    if (img) img.src = match.icon;
  }).catch(() => undefined);
  return null;
}

async function capabilityForMember(layoutId, memberId) {
  const member = windowLayoutMemberFromState(layoutId, memberId);
  if (!member) return null;
  const cached = windowLayoutRuntime.capabilities.get(memberId);
  if (cached) return cached;
  const resolved = await host.resolveWindowDescriptor(member.descriptor);
  if (resolved.outcome !== 'success') {
    setWindowLayoutStatus(layoutId, windowLayoutStatusForOutcome(resolved.outcome));
    return null;
  }
  windowLayoutRuntime.capabilities.set(memberId, resolved.capability);
  return resolved.capability;
}

function windowLayoutStatusForOutcome(outcome) {
  if (outcome === 'missing') return 'Window not visible';
  if (outcome === 'ambiguous') return 'Ambiguous match';
  if (outcome === 'helper-unavailable') return 'Helper unavailable';
  if (outcome === 'timeout') return 'Timed out';
  return 'Failed';
}

async function handleWindowLayoutMemberClick(layoutId, memberId, ctrlKey = false) {
  const member = windowLayoutMemberFromState(layoutId, memberId);
  if (!member) return;
  if (ctrlKey) {
    // 016 inner multiselection: separate from workspace selection.
    const selected = new Set(windowLayoutRuntime.selectedMembers.get(layoutId) ?? []);
    if (selected.has(memberId)) selected.delete(memberId);
    else selected.add(memberId);
    windowLayoutRuntime.selectedMembers.set(layoutId, selected);
    syncWindowLayoutMemberSelection(layoutId);
    return;
  }
  windowLayoutRuntime.selectedMembers.delete(layoutId);
  syncWindowLayoutMemberSelection(layoutId);
  // 016 contextual occurrences: an icon click from a DIFFERENT layout (or
  // with no active context) applies THIS layout's saved arrangement for the
  // member and selects this layout's recording context. A click in the
  // already-current context toggles minimize/restore.
  if (windowLayoutRuntime.activeRecordingLayoutId !== layoutId) {
    await selectWindowLayoutContext(layoutId, memberId);
    return;
  }
  const capability = await capabilityForMember(layoutId, memberId);
  if (!capability) return;
  const observed = await host.observeWindowCapability(capability);
  if (observed.outcome !== 'success' || !observed.observation) {
    if (observed.outcome === 'missing') {
      windowLayoutRuntime.capabilities.delete(memberId);
      stopWindowLayoutRecording();
    }
    setWindowLayoutStatus(layoutId, windowLayoutStatusForOutcome(observed.outcome));
    return;
  }
  const liveState = observed.observation.state === 'minimized' ? 'minimized' : 'normal';
  const targetState = liveState === 'minimized' ? 'restore' : 'minimize';
  const result = targetState === 'restore'
    ? await host.restoreWindowCapability(capability)
    : await host.minimizeWindowCapability(capability);
  if (result.outcome !== 'success') {
    setWindowLayoutStatus(layoutId, windowLayoutStatusForOutcome(result.outcome));
    return;
  }
  const nextState = targetState === 'restore' ? 'normal' : 'minimized';
  store.replace(updateWindowLayoutMember(state, layoutId, memberId, {
    state: nextState,
    bounds: observed.observation.bounds,
  }));
  patchWindowLayoutMember(layoutId, memberId, nextState);
  queueWindowLayoutSave();
}

function patchWindowLayoutMember(layoutId, memberId, stateValue) {
  const button = document.querySelector(`[data-wl-member="${CSS.escape(memberId)}"]`);
  if (!button) return;
  button.classList.remove('normal', 'minimized');
  button.classList.add(stateValue);
  const marker = button.querySelector('.window-layout-member-state');
  if (marker) {
    marker.className = `window-layout-member-state ${stateValue}`;
  }
}

async function openWindowLayoutPicker(layoutId) {
  windowLayoutRuntime.pickerOpenFor = layoutId;
  const pickerHost = document.querySelector(`[data-wl-picker="${CSS.escape(layoutId)}"]`);
  if (!pickerHost) return;
  pickerHost.innerHTML = '<div class="window-layout-picker-panel"><div class="window-layout-empty">Loading candidates…</div></div>';
  const result = await host.windowCandidates();
  if (windowLayoutRuntime.pickerOpenFor !== layoutId) return; // closed meanwhile
  if (result.outcome !== 'success') {
    pickerHost.innerHTML = `<div class="window-layout-picker-panel"><div class="window-layout-empty">${escapeHtml(windowLayoutStatusForOutcome(result.outcome))}</div></div>`;
    return;
  }
  windowLayoutRuntime.pickerCandidates = result.candidates;
  pickerHost.innerHTML = windowLayoutPickerMarkup(layoutId, result.candidates);
}

function closeWindowLayoutPicker() {
  windowLayoutRuntime.pickerOpenFor = null;
  windowLayoutRuntime.pickerCandidates = null;
  const pickerHost = document.querySelector('[data-wl-picker]');
  if (pickerHost) pickerHost.innerHTML = '';
}

async function handleWindowLayoutPickCandidate(layoutId, candidateId) {
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
    windowLayoutRuntime.capabilities.delete(existing.id);
    windowLayoutRuntime.icons.delete(existing.id);
    stopWindowLayoutRecording();
    store.commit(next);
    closeWindowLayoutPicker();
    saveWorkspaceView();
    return;
  }
  const bound = await host.bindWindowCandidate(candidateId);
  if (bound.outcome !== 'success') {
    setWindowLayoutStatus(layoutId, windowLayoutStatusForOutcome(bound.outcome));
    return;
  }
  const memberId = crypto.randomUUID();
  // 016: adding a window captures its current valid bounds/state immediately;
  // the creator never presses another button to make the member useful.
  const observed = await host.observeWindowCapability(bound.capability);
  const member = {
    id: memberId,
    descriptor: bound.descriptor,
    bounds: observed.outcome === 'success' && observed.observation?.bounds
      ? observed.observation.bounds : null,
    state: observed.outcome === 'success' && observed.observation?.state === 'minimized'
      ? 'minimized' : 'normal',
  };
  const next = addWindowLayoutMember(state, layoutId, member);
  windowLayoutRuntime.capabilities.set(memberId, bound.capability);
  const icon = (windowLayoutRuntime.pickerCandidates ?? [])
    .find((candidate) => candidate.id === candidateId)?.icon ?? null;
  if (icon) windowLayoutRuntime.icons.set(memberId, icon);
  store.commit(next);
  closeWindowLayoutPicker();
  setActiveWindowLayoutRecording(layoutId);
  saveWorkspaceView();
}

/** 016 contextual application: applies THIS layout's saved arrangement for
 * the member (echo-suppressed per operation/member) and selects this layout
 * as the sole recording context. */
async function selectWindowLayoutContext(layoutId, memberId) {
  const member = windowLayoutMemberFromState(layoutId, memberId);
  if (!member) return;
  const capability = await capabilityForMember(layoutId, memberId);
  if (!capability) return;
  windowLayoutRuntime.suppression = { layoutId, memberId, bounds: member.bounds, state: member.state };
  if (member.bounds) {
    const applied = await host.applyWindowCapability(capability, member.bounds);
    if (applied.outcome !== 'success') {
      windowLayoutRuntime.suppression = null;
      setWindowLayoutStatus(layoutId, windowLayoutStatusForOutcome(applied.outcome));
      return;
    }
  }
  // A click from a DIFFERENT layout context always RESTORES that occurrence
  // (per the creator's contextual model); only a click in the already-current
  // context toggles minimize/restore, so the saved state is never used here.
  const restored = await host.restoreWindowCapability(capability);
  if (restored.outcome !== 'success') {
    windowLayoutRuntime.suppression = null;
    setWindowLayoutStatus(layoutId, windowLayoutStatusForOutcome(restored.outcome));
    return;
  }
  setActiveWindowLayoutRecording(layoutId);
}

/** 016 group actions (selected members when any are selected, otherwise all):
 * minimize, restore/open (applies saved bounds), or isolate (restore the
 * targets, minimize only the unselected members OF THIS LAYOUT). One bounded
 * per-member loop with typed results; partial failures are visible. */
async function runGroupMemberAction(layoutId, member, action, results, patches) {
  const started = Date.now();
  const capability = await capabilityForMember(layoutId, member.id);
  if (!capability) return 'missing';
  const observed = await host.observeWindowCapability(capability);
  if (observed.outcome !== 'success' || !observed.observation) {
    return observed.outcome;
  }
  let result = null;
  let nextState = observed.observation.state === 'minimized' ? 'minimized' : 'normal';
  if (action === 'minimize') {
    result = await host.minimizeWindowCapability(capability);
    nextState = 'minimized';
  } else {
    windowLayoutRuntime.suppression = { layoutId, memberId: member.id, bounds: member.bounds, state: member.state };
    if (member.bounds) result = await host.applyWindowCapability(capability, member.bounds);
    if (!result || result.outcome === 'success') {
      result = await host.restoreWindowCapability(capability);
    }
    windowLayoutRuntime.suppression = null;
    nextState = 'normal';
  }
  results.push({ memberId: member.id, outcome: result.outcome });
  if (result.outcome === 'success') {
    patches.push({ memberId: member.id, state: nextState });
    patchWindowLayoutMember(layoutId, member.id, nextState);
  }
  return result.outcome;
}

async function windowLayoutGroupAction(layoutId, action) {
  const layout = windowLayoutFromState(layoutId);
  if (!layout) return;
  const members = layout.arrangement?.members ?? [];
  if (members.length === 0) return;
  const selected = windowLayoutRuntime.selectedMembers.get(layoutId);
  const targets = selected && selected.size > 0
    ? members.filter((member) => selected.has(member.id)) : members;
  const results = [];
  const patches = [];
  for (const member of targets) {
    const outcome = await runGroupMemberAction(layoutId, member, action, results, patches);
    // A stale binding (helper restart) fails the first observe with missing:
    // drop it, re-resolve ONCE, and retry the full action.
    if (outcome === 'missing') {
      windowLayoutRuntime.capabilities.delete(member.id);
      const freshCapability = await capabilityForMember(layoutId, member.id);
      if (freshCapability) {
        const retried = await runGroupMemberAction(layoutId, member, action, results, patches);
        if (retried !== 'missing') continue;
      }
      results.push({ memberId: member.id, outcome: 'missing' });
    }
  }
  if (action === 'isolate') {
    const unselected = selected && selected.size > 0
      ? members.filter((member) => !selected.has(member.id)) : [];
    for (const member of unselected) {
      const capability = await capabilityForMember(layoutId, member.id);
      if (!capability) {
        results.push({ memberId: member.id, outcome: 'missing' });
        continue;
      }
      const result = await host.minimizeWindowCapability(capability);
      results.push({ memberId: member.id, outcome: result.outcome });
      if (result.outcome === 'success') {
        patches.push({ memberId: member.id, state: 'minimized' });
        patchWindowLayoutMember(layoutId, member.id, 'minimized');
      }
    }
  }
  // Chain every member patch into ONE next state and commit once, so a later
  // patch can never clobber an earlier one with stale state.
  let nextState = state;
  for (const patch of patches) {
    nextState = updateWindowLayoutMember(nextState, layoutId, patch.memberId, { state: patch.state });
  }
  if (patches.length > 0) store.replace(nextState);
  queueWindowLayoutSave();
  const failed = results.filter((result) => result.outcome !== 'success').length;
  if (failed > 0) setWindowLayoutStatus(layoutId, `${failed} of ${results.length} members failed`);
  else setWindowLayoutStatus(layoutId, '');
  setActiveWindowLayoutRecording(layoutId);
}

/** 016 direct onscreen pick: begin the Papers-owned pick session for THIS
 * layout and wait for its single typed result (Escape/right-click cancels). */
async function beginWindowLayoutDirectPick(layoutId) {
  const layout = windowLayoutFromState(layoutId);
  if (!layout) return;
  closeWindowLayoutPicker();
  const members = (layout.arrangement?.members ?? []).map((member) => member.descriptor);
  let result = null;
  try {
    // 016R: subscribe to the result push BEFORE awaiting begin, so a pick
    // that completes while begin() is still resolving (immediate click on an
    // eligible window) is never missed. A failed begin removes the listener
    // again; the main-side session clears onResult on failure, so nothing
    // can deliver afterwards.
    const beginPromise = host.pickWindowBegin(members);
    const pickPromise = new Promise((resolve) => {
      windowLayoutRuntime.pickUnsubscribe = host.onPickResult(resolve);
    });
    const begin = await beginPromise;
    if (begin.outcome !== 'started') {
      windowLayoutRuntime.pickUnsubscribe?.();
      windowLayoutRuntime.pickUnsubscribe = null;
      setWindowLayoutStatus(layoutId, 'Direct pick is unavailable');
      return;
    }
    result = await pickPromise;
  } catch {
    windowLayoutRuntime.pickUnsubscribe?.();
    windowLayoutRuntime.pickUnsubscribe = null;
    setWindowLayoutStatus(layoutId, 'Direct pick is unavailable');
    return;
  } finally {
    windowLayoutRuntime.pickUnsubscribe?.();
    windowLayoutRuntime.pickUnsubscribe = null;
  }
  if (result.outcome !== 'picked' || !result.capability || !result.descriptor) {
    if (result.outcome === 'cancelled') setWindowLayoutStatus(layoutId, '');
    else setWindowLayoutStatus(layoutId, result.error || 'Pick failed');
    return;
  }
  const current = windowLayoutFromState(layoutId);
  if (!current) return;
  const existing = (current.arrangement?.members ?? [])
    .find((member) => member.descriptor.title === result.descriptor.title);
  if (existing) {
    // Toggled off: data-only unlink, never closes or moves the window.
    const next = removeWindowLayoutMember(state, layoutId, existing.id);
    windowLayoutRuntime.capabilities.delete(existing.id);
    windowLayoutRuntime.icons.delete(existing.id);
    stopWindowLayoutRecording();
    store.commit(next);
    saveWorkspaceView();
    return;
  }
  const memberId = crypto.randomUUID();
  const observed = await host.observeWindowCapability(result.capability);
  const member = {
    id: memberId,
    descriptor: result.descriptor,
    bounds: observed.outcome === 'success' && observed.observation?.bounds
      ? observed.observation.bounds : null,
    state: observed.outcome === 'success' && observed.observation?.state === 'minimized'
      ? 'minimized' : 'normal',
  };
  const next = addWindowLayoutMember(state, layoutId, member);
  windowLayoutRuntime.capabilities.set(memberId, result.capability);
  if (result.candidate?.icon) windowLayoutRuntime.icons.set(memberId, result.candidate.icon);
  store.commit(next);
  setActiveWindowLayoutRecording(layoutId);
  saveWorkspaceView();
}

function syncWindowLayoutMemberSelection(layoutId) {
  const selected = windowLayoutRuntime.selectedMembers.get(layoutId);
  const container = document.querySelector(`[data-wl-members="${CSS.escape(layoutId)}"]`);
  if (!container) return;
  for (const button of container.querySelectorAll('[data-wl-member]')) {
    button.classList.toggle('selected', Boolean(selected?.has(button.dataset.wlMember)));
  }
}

function setActiveWindowLayoutRecording(layoutId) {
  stopWindowLayoutRecording();
  windowLayoutRuntime.activeRecordingLayoutId = layoutId;
  const layout = windowLayoutFromState(layoutId);
  const member = layout?.arrangement?.members?.[0];
  if (!member) return;
  void (async () => {
    const capability = await capabilityForMember(layoutId, member.id);
    if (!capability) return;
    if (windowLayoutRuntime.activeRecordingLayoutId !== layoutId) return;
    windowLayoutRuntime.recordingTimer = setInterval(() => {
      void observeWindowLayoutMember(layoutId, member.id, capability);
    }, WINDOW_LAYOUT_OBSERVE_CADENCE_MS);
  })();
}

async function observeWindowLayoutMember(layoutId, memberId, capability) {
  if (windowLayoutRuntime.activeRecordingLayoutId !== layoutId) return;
  const layout = windowLayoutFromState(layoutId);
  if (!layout || layout.bin) {
    // The layout was deleted or binned: stop observing; never keep a
    // timer alive for an inactive/no-consumer layout.
    stopWindowLayoutRecording();
    return;
  }
  if (windowLayoutRuntime.observationPending) return;
  windowLayoutRuntime.observationPending = true;
  const result = await host.observeWindowCapability(capability);
  windowLayoutRuntime.observationPending = false;
  if (result.outcome !== 'success') {
    if (result.outcome === 'missing') {
      patchWindowLayoutMember(layoutId, memberId, 'missing');
      windowLayoutRuntime.capabilities.delete(memberId);
      stopWindowLayoutRecording();
      setWindowLayoutStatus(layoutId, 'Window not visible');
    }
    return;
  }
  const observation = result.observation;
  if (!observation) return;
  const suppression = windowLayoutRuntime.suppression;
  if (suppression && suppression.layoutId === layoutId && suppression.memberId === memberId) {
    const sameBounds = JSON.stringify(suppression.bounds) === JSON.stringify(observation.bounds);
    const sameState = (suppression.state === 'minimized' && observation.state === 'minimized')
      || (suppression.state !== 'minimized' && observation.state !== 'minimized');
    windowLayoutRuntime.suppression = null;
    if (sameBounds && sameState) return;
  }
  const stateValue = observation.state === 'minimized' ? 'minimized' : 'normal';
  // A minimized window's rectangle is its taskbar/minimized rect, never a
  // valid arrangement: record the state but KEEP the saved restore bounds.
  const next = updateWindowLayoutMember(state, layoutId, memberId, {
    bounds: stateValue === 'minimized' ? undefined : observation.bounds,
    state: stateValue,
  });
  store.replace(next);
  patchWindowLayoutMember(layoutId, memberId, stateValue);
  queueWindowLayoutSave();
}

function queueWindowLayoutSave() {
  clearTimeout(windowLayoutRuntime.saveTimer);
  windowLayoutRuntime.saveTimer = setTimeout(() => {
    saveWorkspaceView();
  }, WINDOW_LAYOUT_SAVE_DEBOUNCE_MS);
}

function stopWindowLayoutRecording() {
  if (windowLayoutRuntime.recordingTimer) {
    clearInterval(windowLayoutRuntime.recordingTimer);
    windowLayoutRuntime.recordingTimer = null;
  }
  windowLayoutRuntime.activeRecordingLayoutId = null;
}

function handleWindowLayoutUnlink(layoutId, memberId) {
  const layout = windowLayoutFromState(layoutId);
  if (!layout || !memberId) return;
  const next = removeWindowLayoutMember(state, layoutId, memberId);
  windowLayoutRuntime.capabilities.delete(memberId);
  windowLayoutRuntime.icons.delete(memberId);
  stopWindowLayoutRecording();
  store.commit(next);
  closeWindowLayoutPicker();
  saveWorkspaceView();
}

const graph = createGraphController();

function createGraphController() {
  const nodes = new Map();
  const edges = new Map();
  const originEdges = new Map();
  let onDragCancel = null;
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
  let regionLayoutKey = null;
  let regionCache = [];
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
    regionLayoutKey = null;
    regionCache = [];
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
        `translate3d(${node.x}px, ${node.y}px, 0) translate(-50%, -50%)`;
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
    const layoutKey = source.map((shape) => `${shape.id}:${shape.outline.map(({ x, y }) => `${x},${y}`).join('|')}`).join(';');
    if (layoutKey !== regionLayoutKey) {
      regionCache = decomposeRegions(source).map((region) => ({
        ...region,
        center: regionCentroid(region),
      }));
      regionLayoutKey = layoutKey;
    }
    const regions = regionCache;
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
      const seed = seedPosition(vi.id, parent, index, siblings.length, originX, originY);
      node = {
        id: vi.id,
        candidate,
        depth: vi.depth,
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
      candidate.kind === 'window-layout' ? ((candidate.arrangement?.version ?? 0) + '|' + (candidate.arrangement?.members ?? []).map((m) => m.id + ':' + m.state).join(',')) : 0,
    ]);
    if (node.contentSignature !== signature) {
      node.contentSignature = signature;
      iconItem.innerHTML =
        `${canExpand ? `<button class="folder-expander ${isExpanded ? 'expanded' : ''}" data-expand="${candidate.id}" type="button" aria-label="${isExpanded ? 'Collapse' : 'Expand'} ${escapeHtml(candidate.name)}">›</button>` : ''}`
        + `${linkMarkup(candidate)}`
        + `<div class="item-icon">${iconMarkup(candidate)}</div>`
        + `<strong>${escapeHtml(candidate.name)}</strong>`
        + `${descriptionMarkup(candidate)}`
        + `${candidate.kind === 'window-layout' ? windowLayoutBodyMarkup(candidate) : ''}`;
      hydrateNodeIcons(node.shell);
    }
    node.width = node.shell.offsetWidth || (state.view.iconSize + 42);
    node.height = node.shell.offsetHeight || (state.view.iconSize + 64);
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
    shell.style.transform = `translate3d(${node.x}px, ${node.y}px, 0) translate(-50%, -50%)`;

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
      + `<div class="item-icon">${iconMarkup(candidate)}</div>`
      + `<strong>${escapeHtml(candidate.name)}</strong>`
      + `${descriptionMarkup(candidate)}`
      + `${candidate.kind === 'window-layout' ? windowLayoutBodyMarkup(candidate) : ''}`;

    shell.append(iconItem);
    nodeLayer.append(shell);
    node.shell = shell;

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
      candidate.kind === 'window-layout' ? ((candidate.arrangement?.version ?? 0) + '|' + (candidate.arrangement?.members ?? []).map((m) => m.id + ':' + m.state).join(',')) : 0,
    ]);

    node.width = shell.offsetWidth || (state.view.iconSize + 42);
    node.height = shell.offsetHeight || (state.view.iconSize + 64);

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
      node.shell.style.transform = `translate3d(${targetX}px, ${targetY}px, 0) translate(-50%, -50%)`;
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
      .force('cx', forceX(w / 2).strength(0.05))
      .force('cy', forceY(h / 2).strength(0.05))
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
        .distance((link) => (link.source.ring ? RING_LINK_DISTANCE : 145))
        .strength((link) => (link.source.ring ? 0.9 : 0.14)))
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
    simulation.on('tick', scheduleRender);
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
    for (const ring of setRings.values()) nodeArray.push(...ring.nodes);
    simulation.nodes(nodeArray);

    const edgeArray = [];
    edges.forEach((edge) => {
      edgeArray.push({ source: edge.sourceId, target: edge.targetId });
    });
    originEdges.forEach((edge) => {
      edgeArray.push({ source: edge.sourceId, target: edge.targetId });
    });
    // The links closing each ring into a loop, which is what stops the boundary
    // opening up under load.
    for (const ring of setRings.values()) edgeArray.push(...ring.links);

    simulation.force('link').links(edgeArray);
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

  function fitGraph(padding = 90, animate = true) {
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
    if (animate && !reducedMotion?.matches) {
      viewportSelection.transition().duration(550).call(zoomBehavior.transform, transform);
    } else {
      zoomBehavior.transform(viewportSelection, transform);
    }
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
  const slider = elements.backdropOpacitySlider;
  if (slider && document.activeElement !== slider) slider.value = String(opacity);
  if (elements.backdropOpacityValue) {
    elements.backdropOpacityValue.textContent = `${Math.round(opacity * 100)}%`;
  }
}

function render() {
  applyTheme(state.view?.preferences);
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
    // A window-layout is edited through the same name+icon surface as a
    // folder (updateGroup handles both), so the existing editor renames it.
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
}

// 016 inner member drag: reorder within the layout, or unlink (data-only)
// beyond a clear outside threshold. Never starts outer graph drag and never
// moves/resizes/minimizes/closes the external window.
let windowLayoutDrag = null; // { layoutId, memberId, startX, startY, moved, pointerId }
let windowLayoutDragJustMoved = false;
const WINDOW_LAYOUT_DRAG_THRESHOLD_PX = 8;
const WINDOW_LAYOUT_DROP_OUT_PX = 40;

elements.grid.addEventListener('pointerdown', (event) => {
  const member = event.target.closest('[data-wl-member]');
  if (!member || event.ctrlKey || event.button !== 0) return;
  windowLayoutDrag = {
    layoutId: member.dataset.wlLayout,
    memberId: member.dataset.wlMember,
    startX: event.clientX,
    startY: event.clientY,
    moved: false,
    pointerId: event.pointerId,
  };
});

elements.grid.addEventListener('pointermove', (event) => {
  const drag = windowLayoutDrag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < WINDOW_LAYOUT_DRAG_THRESHOLD_PX) return;
  drag.moved = true;
  const members = document.querySelector(`[data-wl-members="${CSS.escape(drag.layoutId)}"]`);
  const button = document.querySelector(`[data-wl-member="${CSS.escape(drag.memberId)}"]`);
  if (!members || !button) return;
  const row = members.getBoundingClientRect();
  const outside = event.clientY < row.top - WINDOW_LAYOUT_DROP_OUT_PX
    || event.clientY > row.bottom + WINDOW_LAYOUT_DROP_OUT_PX
    || event.clientX < row.left - WINDOW_LAYOUT_DROP_OUT_PX
    || event.clientX > row.right + WINDOW_LAYOUT_DROP_OUT_PX;
  members.classList.toggle('wl-drag-out', outside);
  if (outside) return;
  const buttons = [...members.querySelectorAll('[data-wl-member]')];
  let targetIndex = buttons.length - 1;
  for (let index = 0; index < buttons.length; index += 1) {
    const rect = buttons[index].getBoundingClientRect();
    if (event.clientX < rect.left + rect.width / 2) { targetIndex = index; break; }
  }
  const currentIndex = buttons.indexOf(button);
  if (currentIndex === -1 || targetIndex === currentIndex) return;
  button.remove();
  const children = [...members.children];
  const at = Math.max(0, Math.min(targetIndex, children.length));
  members.insertBefore(button, children[at] ?? null);
});

elements.grid.addEventListener('pointerup', (event) => {
  const drag = windowLayoutDrag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  windowLayoutDrag = null;
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
  store.commit(next);
  saveWorkspaceView();
});

elements.grid.addEventListener('pointercancel', (event) => {
  const drag = windowLayoutDrag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  windowLayoutDrag = null;
  const members = document.querySelector(`[data-wl-members="${CSS.escape(drag.layoutId)}"]`);
  if (members) members.classList.remove('wl-drag-out');
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && windowLayoutDrag) {
    windowLayoutDrag = null;
    const members = document.querySelector('[data-wl-members].wl-drag-out');
    if (members) members.classList.remove('wl-drag-out');
  }
});

elements.grid.addEventListener('click', (event) => {
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
    const memberButton = event.target.closest('[data-wl-member]');
    if (memberButton) {
      if (windowLayoutDragJustMoved) {
        windowLayoutDragJustMoved = false;
        return;
      }
      void handleWindowLayoutMemberClick(memberButton.dataset.wlLayout, memberButton.dataset.wlMember, event.ctrlKey);
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
    const directPick = event.target.closest('[data-wl-pick]');
    if (directPick) {
      void beginWindowLayoutDirectPick(directPick.dataset.wlPick);
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
    const isolate = event.target.closest('[data-wl-isolate]');
    if (isolate) {
      void windowLayoutGroupAction(isolate.dataset.wlIsolate, 'isolate');
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
  event.preventDefault();
  event.stopPropagation();
  // Opening the context menu can implicitly cancel an in-progress pointer
  // sequence without ever dispatching pointerup/pointercancel to the grid
  // (observed with Shift+right-click on a folder) — leaving graph-dragging/
  // will-pin/graph-drop-target visuals stuck on whatever tile the pointer
  // last touched. Cancel the drag defensively any time the menu opens.
  pointer.cancelDrag();
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
  if (!event.ctrlKey) return;
  event.preventDefault();
  state = store.replace(setIconSize(state, state.view.iconSize + (event.deltaY < 0 ? 12 : -12)));
  render();
  clearTimeout(zoomTimer);
  zoomTimer = setTimeout(() => persist().catch((error) => setStatus(String(error))), 250);
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

bootstrapWorkspace({
  loadState: () => host.loadWorkspace(),
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
});

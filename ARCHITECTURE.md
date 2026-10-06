# As you Go — architecture and change guide

## Alt+Q second-use input trace — 2026-10-06

Creator evidence: the parity correction still works only once after refresh.
The existing diagnostic window title now keeps a bounded (220-character) trace
of each pointerdown: press count, whether its target is a member/disabled,
button/modifier flags, mode, refresh/activation stages and the actual verdict.
Peek's diagnostic title preserves this trace instead of overwriting it.
No click/activation behavior was changed by this diagnostic addition.

A private Windows desktop probe used Electron input events only in its own
synthetic window, then the actual host focus-release helper and hide/park/reveal
sequence four times. It delivered four pointerdowns and four clicks, retained
non-focusability and reported no modifiers. This excludes that simplified cycle
as a reproduction; it does not exercise the creator's live DWM Peek session.
Evidence: `D:/CodexTemp/shift-drag-proof/input-cycle-result.json`. Focused
widget/Peek tests passed (25). A real failed second press is needed to identify
which boundary fails; creator input remains untouched by the probe.

## Alt+Q icon and list route parity — 2026-10-06

Creator evidence: everything except icon clicks works, including adding from the
list, bringing that exact window forward, and dismissing. The list previously
awaited the existing native control refresh before activateWidgetMember; icons
skipped refresh and passed through the legacy isolate-mode click handler.
activateWidgetMember now owns the existing refresh for both routes. Plain Alt+Q
pointerdown directly invokes that same function, preserving its press-scoped
follow-up-click suppression and bypassing legacy isolate-command consumption.
Modified/Alt+W handling stays in the existing click handler. No new native broker,
writer, foreground policy, or cooldown is introduced.

The real surface test asserts one refresh -> activation -> hide sequence even
when isolation would consume ordinary clicks, and no duplicate follow-up action.
Full project suite: 1,903 passed. Normal Papers restarted to load the local
route correction without desktop input or a host rebuild. Creator-visible
behavior remains open pending eye testing.

## Alt+Q press delivery — 2026-10-06

Creator reports Peek and other behavior work but clicks still fail after the
queue correction. Plain Alt+Q member activation now begins at the card's
pointerdown handler, rather than depending on a later click event after native
Peek dismissal changes window state. The existing activation/dismissal helper
remains the action owner. The same press's follow-up click is ignored; every
fresh pointerdown resets the marker without any timeout. Alt+W and modifier
selection/drag behavior retain their existing handling. The frameless window's
existing diagnostic title records activation requested and its actual verdict.

Tests verify activation with no subsequent click, no duplicate action when the
click does arrive, immediate next press, and unchanged modified/legacy presses.
Full project suite: 1,902 passed. Normal Papers restarted to load the local
project change, without desktop input or a host rebuild. Actual creator-visible
behavior remains open until the installed eye test.

## Alt+Q interaction queue cancellation — 2026-10-06

The creator confirmed the renderer no longer freezes, but icon clicks still wait
on subsequent summons. The existing Shift Peek lifecycle previously queued end
behind the renderer's unfinished begin reply; endAndWait then waited on that old
reply before activation. End now immediately sends the existing host cancellation
request and replaces the renderer queue tail with its release acknowledgement.
The host remains the sole native preview serialization/generation owner. A fresh
begin waits for release, while late old replies cannot end a newer target.

Tests cover unfinished old begins, pending real releases, late replies, and two
back-to-back Alt+Q activations/dismissals without completing either old begin
reply. Full project suite: 1,900 passed. Normal Papers restarted to load the local
project correction; creator interaction eye test remains outstanding. No host
build or publication was required.

## Alt+Q picker and mode wave — 2026-10-06

Follow-up: the wave uses an isolated negative stacking layer so the tracking dot
keeps its card corner anchor. Ctrl+middle-click reuses the existing close action
and, on success, awaits the existing scoped remove-member writer command with
one stale retry. Full project suite: 1,898 passed. An isolated offscreen Electron
check confirmed dot corner placement, wave animation, button hit testing and mode
cleanup without desktop input. Real desktop foreground behavior remains for the
creator to confirm.

Opening the widget window list awaits the existing Shift Peek lifecycle's end
before showing its chooser. An Alt+Q list addition waits for the workspace's
committed acknowledgement, closes the chooser, matches the exact committed member
through the existing identity policy, awaits the existing native control sync, then
uses the same foreground activation and dismissal as an icon click. Legacy picker
behavior and removal remain unchanged.

`window-layout-widget-mode-effect.js` reuses `createSetEffectsController` and
its Anime.js wash to mark Alt+Q mode with a blue wave behind the card controls.
It follows the existing interaction-mode message, cancels on dismissal or
legacy mode, and is disposed on page exit. A hidden Electron fixture verified
the gradient advances, controls remain hit-testable, and legacy removes the
effect without desktop input.

This is the machine-local “As you Go” Backpack project. It is a modular, vanilla-JavaScript
app served as static files from `public/` inside the Papers host. Read `README.md` for
ownership, data and behavior; read this file before changing the code so new work lands in
the right module and preserves the interaction behavior.

## Module map

The entry file `public/workspace-20260730b.js` is a thin composition root. It wires modules
together and keeps the tiny amount of glue that has nowhere else to live. Everything with a
clear responsibility lives in a module.

| Change type | Correct location |
|---|---|
| Keyboard, pointer, marquee, drop events | `public/app/interactions/` |
| Dialogs, menus, toolbar, Bin controls | `public/app/components/` |
| User-intent operations and host coordination | `public/app/workspace-commands.js` |
| Session, history, persistence queue | `public/app/workspace-store.js` |
| Data transformations and invariants | `public/workspace-model-20260730b.js` |
| Papers messaging | `public/app/host/host-bridge.js` |
| Startup and synchronous mounting | `public/app/bootstrap.js` |
| Styling | the matching file under `public/styles/` |
| Compatibility composition | `public/workspace-20260730b.js` |
| Quick Run search (filter vocabulary and cycle, the searchable universe, the index, the session, what the surface draws) | `public/app/quick-run/quick-run-types.js`, `quick-run-search.js`, `quick-run-index.js`, `quick-run-session.js`, `quick-run-presentation.js`, `quick-run-surface.js`, `quick-run-activation.js` |
| Quick Run layout-item resolution (the fail-closed decision that names one window or refuses, and the ephemeral availability the surface shows) | `public/app/quick-run/quick-run-resolution.js`, `quick-run-presentation.js` |
| Quick Run workspace binding (what Enter and Ctrl+Enter execute against the workspace, and the close-on-success rule) | `public/app/quick-run/quick-run-workspace.js` |
| Quick Run presentation (the palette, its chips, rows and two sentences) | `public/styles/quick-run.css`, imported by `public/workspace-20260730b.css` |

Quick Run writes no workspace state. Its binding is handed commands, the state reader, the visible ids and
the status line, and nothing else: Shift+Enter (add to the active layout) was cut on 2026-09-13 rather than
repaired, because its only write installed state in memory without committing it, so a surface without
document-write authority could report success after a refused write. The gesture has no key, no plan and no
notice; `quick-run-entry.test.mjs` fails if any of them comes back, and `papers/quick-run.md` carries the
cut note.

The palette is an overlay (`z-index: 60`: above the graph viewport and toolbars, below the context menu and
dialogs). That is not decoration — measured in the real host before `public/styles/quick-run.css` existed,
the layer computed to a static transparent block underneath the absolutely-positioned `#graph-viewport`, so
its rows were painted but every pointer event at their coordinates hit the graph. `quick-run-style.test.mjs`
holds the layering, the scrollable list, the row height the wheel arithmetic falls back to, and the rule
that keeps `[hidden]` able to hide a `display: flex` layer.

## Quick Run's paint cap

One keystroke can rank thousands of matches — the fuzzy subsequence tier in `quick-run-index.js` matches a
single letter against a large slice of a 20,000-occurrence corpus — and the surface paints every row it is
handed, so a keystroke's cost tracks the size of the ranked result set rather than the query. The session
therefore holds at most `QUICK_RUN_MAX_PAINTED_ROWS` (200) rows, a measured number rather than a taste: in
`quick-run-integrated-perf.mjs` the bucket at or below 200 painted rows measured p95 6.1 ms against the
contract's 16 ms gate, while 201–1,000 is already at 10.8 ms and 1,001–3,000 misses outright.

The rule lives in `quick-run-session.js` because `rows` is the single list three consumers share: what the
surface paints, what `quickRunSessionAfterArrow` walks, and what the highlight is chosen from. Bounding it
there bounds all three together, so the highlight can never land on a row that is not on screen; a cap in
the DOM layer would leave navigation and highlight pointing at unpainted rows.

Nothing else is capped. `chipsFor` and the filter-fallback rule still read every match, the session carries
`totalRows` and `capped` so the surface can say what it is not showing (`quickRunCapNotice` in
`quick-run-presentation.js`, painted into `#quick-run-cap` only while the cap actually bites), and Enter
still revalidates the row by stable result key against the current workspace (`quick-run-activation.js`), so
a match past the cap is exactly as actionable as one on screen. `quick-run-paint-cap.test.mjs` holds each of
those rules individually, and `npm run test:quick-run:integrated-perf` is the acceptance instrument for the
number itself.

## Multi-window document behavior

Papers projects a scoped workspace from the same `state.json` and merges its
checked saves back into that file. Scoped and full surfaces therefore retain
separate channels and writer locks: their snapshots have different shapes.
Each ordinary surface reads its own versioned host projection every two seconds,
including while unfocused. A changed revision is installed as an external
generation; the writer broadcasts it within its scope. This also makes direct
edits to `state.json` visible without treating a file change as an unchecked
save. The host revision remains the CAS authority across every scope.

Every open As you Go surface accepts document actions. One surface remains the
durable writer, while other surfaces apply the action optimistically and send a
bounded snapshot over the same-origin channel. The writer merges entity edits
by stable id, commits through Papers' versioned state service, and broadcasts
the exact committed bytes back to every surface. This prevents a delete, bin,
rename, move, or other action in one window from disappearing in another.

Peer mutation requests are serialized at the writer. Each request is rebased
against the latest committed snapshot before its compare-and-set; if an
unexpected external revision advances the host, the writer reloads and retries
that same request once instead of dropping it. This preserves disjoint edits
when two windows act at nearly the same time.

On real BroadcastChannel surfaces, forwarded mutations carry a stable request
id. The writer deduplicates an id before queueing it and emits one correlated
acknowledgement containing the committed revision; the sender exposes that
acknowledgement for diagnostics and reports a bounded timeout if the writer
dies. Missing or failing Web Locks/BroadcastChannel primitives fail closed:
document/history mutations are disabled and never fall back to unchecked
`host.saveWorkspace` writes. A stale compare-and-set enters CONFLICT and the
store gate freezes further document/history changes until Use latest or Keep
my version resolves it. External installs and writer promotion reloads clear
snapshot undo/redo history so an old generation cannot resurrect peer edits.
If a forwarded mutation receives a negative acknowledgement or reaches the
writer-ack timeout, its optimistic overlay is retired and the surface reloads
the versioned authoritative document before reporting failure. This keeps a
transport miss from leaving a folder, prompt, or rename painted in only one
window. A timeout remains an uncertain request while recovery is in flight: the
follower sends a correlated cancellation, and the writer either suppresses a
queued request before `host.saveChecked` or returns the already-committed result.
Only the actual Web-Lock writer may answer cancellation; an observed successful
ACK owns terminal resolution and suppresses cancellation exhaustion until a
fresh authority read proves it. The follower retries a bounded number of times
so a newly promoted writer can observe it. If no writer
answers, the surface becomes an explicit non-editable CONFLICT and settles as
`MUTATION_UNCERTAIN`, never continuing to accept speculative document actions.
That cancellation fence prevents a late writer queue turn from committing after
the follower has declared failure. Installed-app proof still needs two native
Papers windows on a cloned real profile; synthetic coordinator tests do not
establish channel or session scope by themselves. Recovery is fenced by the
latest authoritative-generation epoch, keeps the request correlation alive
through timeout recovery so a late committed broadcast can win, and enters
CONFLICT if the authoritative reload itself cannot complete rather than silently
presenting the speculative state as reconciled. Every terminal ACK, including a
cancellation ACK, reloads the versioned authority before settling, so a dropped
committed broadcast cannot leave a stale follower behind. If the reload finds
the forwarded bytes already durable, the request resolves as a successful
recovery rather than invalidating dependent edits. A follower conflict never
becomes a writer without first acquiring the same Web Lock; successful Keep my
version also reinstalls its own committed bytes through the store before
publishing them.

Committed frames carry their parent revision. A view that receives a frame whose
parent does not match its current authority performs a host-authoritative load
instead of installing the frame directly; this prevents a delayed former-writer
frame from regressing a view after a cross-writer promotion when opaque host
revisions cannot be ordered locally.

The merge is three-way and stable-id aware for entities, item sets, prompt
library trees, and per-context graph/rest/toolbar position keys. Local surface
navigation, selection, expansion, trail expansion, and Bin-mode UI are stripped
from forwarded document snapshots; they remain owned by the live surface.

Graph, resting, and toolbar position maps are deliberately last-writer-wins;
the most recently committed drag is the visible placement everywhere.
Creator correction (2026-09-04): restore natural positioning on entry, followed
by cooling and rest. Remembered coordinates seed unpinned items; saved positions
do not freeze the graph. Entry, topology, set membership, pin, node-size and
viewport changes reheat the simulation. Rest-position commits and unchanged
renders do not reheat it: doing so fed every periodic save back into another
physics pass and prevented settling. Coordinated writes, last-writer-wins
placement, and close-time save draining remain in place. A
surface opening a folder with the context-menu action or middle mouse button
requests a new generic Papers surface on its own authenticated project URL;
the host does not interpret As you Go's folder id.

Papers also supplies each project tab an opaque stable surface key. As you Go
uses that key only to store a bounded `{ currentGroupId }` entry, so each tab
can restore its own last-opened folder after runtime surface ids are recreated
at startup. These entries merge by key; they never make a peer tab navigate.

The creator confirmed working multi-window interactions before requesting this correction.
Validation of the cooling correction: 1,116 unit tests and 8 visual pretests
pass. Five production-function entry tests include a two-simulation reproduction
with periodic position commits; it fails against `d15f717` and passes with the
correction. `npm run test:graph:settling` (with `PAPERS_PACKAGED_EXE`) opens two
native Papers windows on a disposable synthetic profile containing six folders
and overlapping sets. After 12 seconds, both views must remain still over a
further 3 seconds, with all six positions durably saved. This test fails on
`d15f717` and passes with the correction against the installed Papers executable.
The earlier saved-PNG hash mismatch remains a separate baseline issue; no
baseline was updated by this correction.

## Prompt library (copy button)

The prompt library is a nested tree of prompts and folders persisted in
`view.promptLibrary`. It is split across four modules plus one pure model:

| Responsibility | Module |
|---|---|
| Pure tree data (normalize/migrate, create/find/update/remove, single and atomic multi-node move, batch inclusion via folder `includeAll`, explicit Copy Selected, validation) | `public/prompt-library-model.js` |
| Pure temporary row-selection logic (select/toggle/range/visible order/collapse repair; no DOM/store/host) | `public/app/components/prompt-tree-selection.js` |
| Pure dialog-local undo/redo (past/present/future, edit transactions, limit; no DOM/store/host) | `public/app/components/prompt-library-history.js` |
| Tree DOM interaction → plain intents (clicks, keyboard, drag, context-menu requests; selection state; no host/persistence) | `public/app/components/prompt-tree-controller.js` |
| Prompt-tree context menu (rendering, keyboard nav, dismissal, action intents) | `public/app/components/prompt-tree-context-menu.js` |
| Panel composition root (open/close, draft tree, expansion/editor/rename/delete-confirm, rendering, auto-save) | `public/app/components/prompt-library-dialog.js` |

Rules: the dialog clones the saved library into a `draftLibrary` and owns
persistence via `setPromptLibrary` + `store.replace/save`; the controller and
context menu never call the host or persist state; the toolbar copier keeps
selected-shortcut precedence and reads the saved snapshot through
`getSnapshotLibrary()`/`getBatchText()`. Folder checkboxes persist an explicit
override (never a derived tri-state) and setting one never rewrites descendant
prompt checkboxes.

A folder's override is one of three states, stored as two booleans so libraries
saved before exclude-all existed migrate untouched:

| state | stored | meaning |
| --- | --- | --- |
| neutral | both false | each descendant's own checkbox decides |
| include | `includeAll` | everything inside is copied |
| exclude | `excludeAll` | nothing inside is copied, even a checked prompt |

The **nearest** override wins, so an excluded folder inside an included one
copies nothing and an included folder inside an excluded one copies everything.
Clicking a folder checkbox cycles neutral → include → exclude → neutral; the
context menu offers whichever two states the folder is not currently in, and
"Use child selections" clears both flags so a folder is never stranded in
exclude. Exclude renders as a red box with a white minus (a native checkbox has
no excluded state), and rows under a non-neutral folder take that override's
colour — green for include, struck-through red for exclude — because their own
checkbox no longer decides anything.

Batch checkboxes support two bulk gestures, each one undo entry, and neither
ever changes row selection (the tree controller ignores `.prompt-checkbox`
clicks entirely, so they cannot collide with Shift+click row ranges):

- Clicking the checkbox of a row **inside** a multi-row selection forces every
  selected row to the clicked value — checking and unchecking alike. Clicking a
  row outside the selection touches only that row and leaves the selection
  intact.
- **Shift+click** applies the clicked box's resulting state to the visible range
  between the last-clicked checkbox and this one. `change` does not carry
  `shiftKey`, so the modifier is captured on the preceding `click`.

While `#prompt-layer` is open, the workspace keyboard controller is inert; the
prompt-tree controller owns tree shortcuts (Ctrl/C/X/V are dialog-local
copy/cut/paste via `treeClipboard` — never the OS clipboard or `copyText`,
which is reserved for prompt double-click and "Copy prompt text"). Feedback
for modal actions uses the local `#prompt-status`, not the workspace status.
New prompt / New folder are permanent header buttons; New prompt inserts
inside the selected folder only when exactly one folder row is selected,
otherwise at root. Ctrl/Meta+Z/Y/Shift+Z drive a dialog-local undo/redo on the
draft (never the workspace store history); each completed data mutation is one
entry, a focused editing session is one transaction, and editable controls keep
native text editing. The tree root is a first-class paste destination: blank
tree space (or the root context menu) targets the root while the internal
clipboard is preserved, and dragging below the last top-level row moves nodes
to root.

Three invariants keep the tree usable in a real browser, each covered by tests
that dispatch bubbling events from the actually-focused element:

- **Keyboard scope is the modal, not the row list.** The controller takes a
  `keyboardTarget` (`#prompt-layer`) for `keydown` while pointer listeners stay
  on the viewport. Tree shortcuts therefore work from New prompt/New folder,
  Close and the status line — anywhere non-editable. `isEditableTarget()`
  still excludes inputs, textareas and contenteditable, which never get
  `preventDefault()`, so native text undo/redo survives.
- **Focus is explicit.** Setting `tabindex` does not move focus, so selection
  calls `row.focus({ preventScroll: true })` and root targeting focuses
  `#prompt-tree-viewport`. Opening the dialog focuses the root surface rather
  than leaving `document.body` active.
- **One destination, never a drift-prone boolean.** `activeDestination` is
  `{ type: 'root' | 'node', nodeId }`, updated from a single
  `controller.setSelection()` path that always notifies `onSelectionChange` —
  pointer-driven and programmatic alike. `resolvePasteDestination()` reads it
  and falls back to root when the node no longer exists, so paste can never
  target a row that undo or delete removed.

`#prompt-tree-viewport` owns scrolling and the blank `.prompt-root-surface`
below the last row, so clicking, right-clicking, or dropping in empty space is
a real root gesture. There is no persisted root node.

The dialog auto-saves; there is no Save step and no discard. Every structural
change persists from the shared `afterHistoryTreeChange()` tail, so mutations,
undo and redo all reach the store the same way. Text editing persists once per
session when its transaction commits, not once per keystroke, which is also
what Close flushes before hiding the layer. `autoSave()` installs the draft
with `store.replace()` synchronously — so the next edit reads it — and hands
the write to the store's existing save queue rather than adding a second queue
on top; layering one caused an edit landing mid-save to be silently dropped. An
invalid draft (the last prompt removed) is reported in `#prompt-error` and left
unsaved, so the persisted library never goes empty. Ctrl+Z is the only way
back, which is why the local history covers every tree operation.

## Interaction controllers

Controllers live in `public/app/interactions/` and own browser events for one gesture
family: `keyboard-controller.js`, `pointer-controller.js` (graph drag + marquee + the
double-click listener), `marquee-controller.js`, `drop-controller.js`.

Controllers may read the DOM and the event, but they must not mutate document/session state
and must not call the host. They translate an event into plain command inputs and call
`commands`.

## Command layer

`public/app/workspace-commands.js` owns every user-intent operation: activation, reveal,
copy/cut/paste, moving to the Bin, graph reset, drag outcomes, drops. Commands receive
plain values (IDs, placement maps, destination IDs, position maps, modifier booleans) —
never a raw browser event.

Commands are the only layer that coordinates host calls, document mutation, session
mutation, history, rendering and persistence for a user action. The entry's menu map
(`runMenuAction`) delegates to commands; editor and confirmation dialogs stay in the entry
wiring and call `commit`.

## Store

`public/app/workspace-store.js` owns session state, undo/redo history and the save queue.
The store exposes explicit operations; components and controllers never assign to
`session.*` directly.

- Persistent document changes that belong in history: `store.commit(nextState)`.
- Non-history view/position changes (toolbar position, graph positions, icon size):
  the appropriate store operation or `store.replace(...)`.
- Session writes: `setSelection`, `addToSelection`, `removeFromSelection`, `clearSelection`,
  `setSelectionAnchor`, `setNavigation`, `setGraphExpanded`, `toggleGraphExpanded`,
  `addToGraphExpanded`, `removeFromGraphExpanded`, `setClipboard`.

## Host bridge

`public/app/host/host-bridge.js` is the only place that talks to Papers over
`postMessage`. It owns the pending-request map and the response listener, and exposes named
methods (`loadWorkspace`, `saveWorkspace`, `launchShortcut`, `revealShortcut`, `openWebLink`,
`pickTarget`, `shortcutIcon`, `resolveWebIcon`, `resolveDroppedTargets`, `copyText`). No
other module should post a Papers message directly.

## Bootstrap

`public/app/bootstrap.js` mounts the behavior-only components (context menu, editor,
confirmation dialog, Bin controls, keyboard, drop, pointer controllers) synchronously so the
fallback workspace stays interactive even when host loading fails. The toolbar mounts only
after state is restored because it immediately re-applies saved positions.

## Styling

`public/workspace-20260730b.css` is an `@import` aggregator over `public/styles/`: tokens,
base, workspace, toolbar, items, graph, context-menu, dialogs, utilities, responsive. Put a
rule in the file that owns its category; do not rename selectors or custom properties that
the interaction code depends on.

## Compatibility contracts

These are stable and must not change casually:

- `project.json` `backpackId` and `entry` (`public/workspace-20260730b.html`).
- Serialized state fields in `state.json` (`schemaVersion`, `groups`, `shortcuts`, `view`).
- The dated compatibility filenames: `public/workspace-20260730b.html`,
  `public/workspace-20260730b.js`, `public/workspace-20260730b.css`.
- The host protocol messages sent by `host-bridge.js` (e.g. `papers:project:as-you-go-load`,
  `as-you-go-save`, `as-you-go-launch`, `as-you-go-reveal`, `open-web-link`).

## Required checks before finishing a change

- Every changed interaction needs a behavioral unit test in the matching `*.test.mjs` (not a
  source-text regex).
- Run `npm test` after a change; it is self-contained and never launches a prepared action.
- After interaction changes, run a short browser smoke test in Papers covering: group
  double-click navigation, file/app double-click launch, web-link open, directory
  double-click reveal, keyboard Enter, drag, marquee, external drop, Bin restore/delete,
  and the failed-load fallback staying interactive.

## Reincarnation checkpoint — 2026-10-04

Window-layout chooser binding/recovery now belongs to
`public/app/window-layout-candidate-binding.js`, constructed with only
`bindWindowCandidate` and `windowCandidates`. Attached toggle/removal and widget
list picks retain their exact chooser row and call the same binder in the entry.
The binder owns no membership, recording, document, identity, or persistence state.

Invariant: bind first; relist only on typed missing with a retained row; rebind
only one title/application match; retain the original baseline fallback when
application labels are absent; refuse ambiguous matches. Outcomes and transport
errors propagate unchanged. Durable writers and native identity authority stay
in their existing owners.

Changed files: `public/workspace-20260730b.js`,
`public/app/window-layout-candidate-binding.js`,
`window-layout-candidate-binding.test.mjs`, `window-layout-member-icon.test.mjs`,
`package.json`, and this architecture guide. The icon test's inline-source
assumption was replaced by a production-binder behavior check.

Validation: 15 characterization tests passed against the original inline binder
before movement; focused suite 113 pass / 0 fail / 0 skip; full main suite
1691 pass / 0 fail / 0 skip, plus npm pretest 8 pass / 0 fail / 0 skip.
No environmental failure occurred on this machine. Browser/filesystem panels,
Papers host/preload/runtime, recording, store, and unrelated Backpacks are unchanged.
No installed-runtime/native eye test was run: this is source and automated-test
acceptance of a nonvisual extraction, not a claim of creator visual acceptance.
No packaging, installation, release, restart, or creator-data mutation was performed.
Existing untracked work artifacts were preserved. The commit containing this section
is the code-only rollback point; no state migration is needed.

Widget opening and startup presentation policy now belong to
`public/app/window-layout-widget-lifecycle.js`. It receives host widget opening,
state reading, detachment/read-only checks, placement selection, and waiting as
explicit dependencies. It has no store, save, revision, membership, or recording
interface. Direct opens retain activation; startup uses activate:false and bounded
retries. Remaining completion work and validation receipts are tracked in
`REINCARNATION-PROGRESS.md`; the overall refactor remains in progress.

Pure window-layout membership policy lives in `public/app/window-layout-membership.js`:
instance/fingerprint validation, descriptor relation, direct-picker seed shaping,
candidate membership and bound toggle/remove decisions. `window-layout-workspace.js`
retains compatibility exports and durable mutation orchestration; it consumes the
same policy for post-await rebase decisions. Native identity continues to come
from Papers descriptors, with no host calls or persistence in the policy module.

Active group and range orchestration now lives in
`public/app/window-layout-group-actions.js`. It consumes explicit injected
selectors, native broker/observation operations, capability access, read-only
gates and existing state/save/recording callbacks. Group controls use one
resident-broker batch; the former uncalled worker wrappers were removed from
the entry. The separate bounded scheduling/runner modules retain their contracts.

`public/app/window-layout-selection.js` owns ephemeral Ctrl toggling, ordered
Shift ranges, clearing and membership repair. It uses explicit read/write/erase,
anchor and order adapters over the existing attached-map and widget-set storage.
Attached Ctrl toggles clone; widget toggles mutate; ranges replace. The module
has no DOM, native, host, store or save access; callers synchronize presentation.

Shared card/body/picker HTML lives in `public/app/window-layout-view.js`.
The entry wires read-only presentation readers, icon/note/status readers and
layout selection into that owner; attached and widget surfaces call the same
builders. It has no host, store, native-operation or save access. Committed
baseline HTML fixtures verify exact strings; DOM patching and presentation
lifecycle remain pending extractions.

Card row balancing, ResizeObserver registration/removal and the 180ms trailing
size update now live in `public/app/window-layout-card-presentation.js`. The
owner consumes the existing store/model callbacks and adds no persistence queue.
Widget, placeholder, disconnected and no-explicit-width gates remain unchanged.

Shift Peek timers, generation fencing, retries and serialized native begin/end
operations live in `public/app/window-layout-shift-peek-lifecycle.js`. The entry
retains event translation through the existing pure Shift planner and supplies
only Peek host methods, capability resolution, preview cancellation and existing
diagnostic presentation dependencies. Read-only held/key getters expose ephemeral
lifecycle state; no durable state or second native authority is introduced.

Preview capability resolution and identity-based retention live in
`public/app/window-layout-preview-capabilities.js`. It consumes the existing
capability map and a widget snapshot getter; native descriptor fallback remains
in the runtime module. State-only rerenders retain warm tokens, changed identities
and missing outcomes evict, and attached surfaces delegate to their existing resolver.

Compact-widget surface wiring now belongs to
`public/app/window-layout-widget-surface.js`. It owns the live compact surface's
snapshot/render loop, local selection/drag gestures, resize fitting, hover policy,
Quick Run key handoff, picker/event wiring and teardown. It receives shared card,
picker, preview and native-operation owners through explicit dependencies and reports
only command intents through the existing widget channel. It has no direct durable
store/save/commit or recording-writer interface; the workspace remains the sole
durable writer. `public/workspace-20260730b.js` retains only construction and narrow
callbacks for the few shared ephemeral references needed by other composition code.

The old full-workspace `?detach=1` architecture is already retired from reachability;
the production detachment shim always remains in workspace/non-read-only mode while
compact widgets provide the live detached-card experience. Therefore the historical
roadmap item to extract a separate full-surface detached bootstrap is not a current
completion requirement unless that product behavior is deliberately revived later.

Shared preview and Shift-Peek input routing now belongs to
`public/app/window-layout-preview-input.js`. It translates keyboard, native Shift,
hover, pointer, scroll, resize and pagehide events into the existing preview
presentation and Shift-Peek lifecycle owners. Workspace list-hover still opens the
attached picker, while compact-widget list-hover remains widget-local. The input
router owns no persistence, recording, native identity or capability authority.

Attached member-drag lifecycle now belongs to
`public/app/window-layout-workspace-member-drag.js`. It owns Ctrl-drag state,
live DOM reordering, drag-out unlink intent, pointer-cancel/Escape rollback and the
one-shot post-drag click suppression. Durable unlink/reorder decisions remain
injected callbacks; the owner has no store/save/commit or recording authority.

Attached card/control input routing now belongs to
`public/app/window-layout-workspace-card-input.js`. It owns the window-layout
branches of click, middle-click and context-menu handling and returns a bounded
handled/not-handled decision to the generic graph listeners. Picker, group, tracking,
widget, preview and member actions remain injected owners; graph/folder input and
durable persistence stay outside this router.

`public/app/window-layout-preview-presentation.js` owns the one popover's DOM,
anchor/name/icon state, animation-frame cleanup, native preview presentation
routing and 100ms hover dwell. The existing thumbnail scheduler is supplied lazily;
only authorized preview-show/hide host methods are injected. Superseded unreachable
in-page thumbnail rendering was removed. Surface event translation stays separate.

Live member DOM patches and transient-status timers live in
`public/app/window-layout-dom-presentation.js`. It consumes the existing live-state
map and no store/host operations. Scoped selectors update every matching copy,
retain stable marker nodes, and normalize unconfirmed live results to unknown.

`public/app/window-layout-workspace-picker.js` owns workspace list/direct/close/
cancel orchestration over existing runtime session fields. It uses the shared
native picker-session helper and pure membership seed/row decisions. Pick
application, exact process closing and preview restoration remain explicit injected
callbacks; no store, save or native identity authority is introduced. Widget
picker coordination remains surface-local until its own extraction. Global document
keyboard confirmation/cancellation and outside-click dismissal now terminate in this
same picker owner instead of being duplicated in the dated entry.

Widget list/direct/close and acknowledgement orchestration now live in
`public/app/window-layout-widget-picker.js`. Its one ephemeral list generation
fences native chooser replies; direct attempts retain the existing widget state
fields and listener cleanup. The widget sends typed picker-commit commands through
the existing channel and waits for the workspace writer, retrying one stale
acknowledgement. Host methods are restricted to picker operations. There is no
local durable writer, save queue or second identity authority in this owner.

`public/app/window-layout-tracking-lifecycle.js` owns the lifecycle event drain,
pending-open retries, tracker-session/sequence recovery, complete startup baseline,
periodic close confirmation, initial Auto population and tracking toggles. All state
and surface-role reads use getters across awaits; detachment checks are lazy because
the coordinator is constructed later. Native descriptors and the existing Auto
writer remain authoritative. One owner retains the bounded queues, missing counts,
population lock and sweep timer. Durable changes still call the existing store.
Recording demand, retirement callbacks and surface activation/teardown remain the
next extraction boundary; no new persistence or identity authority was added.

`public/app/window-layout-recording-lifecycle.js` owns recording-context queries,
trailing save demand, durable-id resume, controller/native-pick draining, retirement
intents, confirmed cross-layout retirement and explicit unlink policy. It receives
controller/recording getters, the existing retirement writer, one narrow store
commit adapter and presentation/selection callbacks. Widget removal routes through
the channel command; it never acquires a local writer. The entry keeps hoisted
compatibility delegates for callbacks wired before construction. Observation cadence
still belongs to `window-layout-runtime.js`; native identity remains host-owned.

## Browser pane controls — 2026-10-05

public/app/browser-pane-actions.js owns the tab-close plan shared by the close
button and native tab-menu intent, plus the reversible surface-local fill control.
The panel remains its browser metadata/persistence owner; no second writer or tab
store is introduced. Native menu display is requested through the existing host
bridge/file capability seam. Full-pane presentation changes only this surface's
viewport; monitor video fullscreen belongs to Papers browserVideoFullscreen.ts.
public/app/chrome-focus-policy.js removes workspace buttons and tab labels from
sequential Tab focus while leaving text inputs and the separate browser document
alone. Dynamic controls and tabindex updates use the same policy.

Browser-source-selection.js distinguishes a changed workspace shortcut from an
unchanged selection refresh. The panel activates/navigates a shortcut only on
change, preserving manual browser tab choice through repeated synchronization.
Nonweb selection clears the guard so selecting a web shortcut again remains an
explicit activation. Papers independently gates native view presentation by
host surface visibility and pane demand, including delayed opens.

## Paired-pane Tab priority — 2026-10-05

Plain Tab is reserved in document capture for the paired Navigator/Preview toggle,
before focused workspace controls can consume it. The same guard protects dialogs,
Quick Run, composing events and held-key repeats. Workspace text inputs no longer
send plain Tab into chrome focus traversal. Nontext inputs (including opacity
sliders) and selects join buttons outside sequential focus; mouse use remains.
Isolated Chromium proof: three focused controls produce three pane toggles, zero
button activations; slider/button tabindex -1 and modal Tab stays native.

## Explicit Navigator mouse views — 2026-10-05

Shift+left-click now chooses Nav instead of toggling the current view for AYG
groups, machine folders, search folders and filesystem shortcut folders.
Shift+right-click remains a Tree expansion gesture. The toolbar view toggle
retains its explicit toggle behavior. Isolated real Chromium nested-group proof:
Tree -> Shift-left A gives Nav -> Shift-left B stays Nav -> Shift-right C gives
Tree -> Shift-left A gives Nav. AYG suite: 1846 passed / 0 failed.

## Inline branches and canvas reset — 2026-10-05

Creator correction supersedes the preceding whole-view Shift-right behavior:
Shift-right expands/collapses a branch beneath its row without replacing the
current Nav directory with the root Tree. Applies to AYG groups and filesystem
folders. Shift-left clears temporary expansion and navigates directly in Nav.
Left canvas pointerdown clears temporary branches/search and returns to the
canvas session directory in AYG Nav; navigator controls do not trigger this.
Isolated Chromium proof: consecutive Shift-left stays Nav, Shift-right stays
Nav with nested child directly below the row, canvas click removes that branch,
and subsequent Shift-left stays Nav. Full AYG suite: 1846 passed / 0 failed.

## Breadcrumb sibling popup — 2026-10-05

navigator-breadcrumb-popup.js owns an ephemeral themed sibling list opened by
Shift-right on a breadcrumb. AYG breadcrumbs resolve siblings in their parent
group; machine breadcrumbs resolve their parent directory through the existing
cached host listing. Popup Shift-right expands/collapses only its local branch,
without changing navigator view or expansion state. Row click activates/navigates;
outside pointerdown or Escape disposes the popup and listeners. Uses existing
icons and theme variables. Isolated Chromium verified sibling list, inline child
expansion, Escape disposal and preserved main Nav view. AYG: 1846 passed / 0 failed.

## Browser tab drag and selection search — 2026-10-05

browser-tab-drag.js owns drop URL/search parsing and position-aware insertion
and reordering. Tabs keep their existing IDs and WebContents; order is persisted
through the existing panel metadata writer. Text drops create Google searches,
HTTP(S) link drops navigate, and tab drops reorder at the pointer midpoint.
Selection context menu exposes Search Google in new tab, through the existing
native browser tab creation seam. Close buttons are visible only on tab hover.
AYG suite 1848 passed. Papers 1367 passed / 4 skipped; typecheck passed.
Isolated Chromium pane proof asserted phrase search creation, existing-tab
reordering, hidden unhovered close controls and preserved selection refreshes.

Browser strip presentation — 2026-10-05: fixed right controls have reserved space
and a fading theme backdrop. Tab container queries hide labels below 100px,
with favicon/monogram and full-title tooltip. Wheel events pan an overflowing
strip horizontally, including its scrollbar region; Ctrl-wheel remains native.
Isolated Chromium proof with 16 tabs asserted compact labels, wheel scrolling,
and strip bounds ending before the fixed controls. Focused drag tests: 2 passed.

## Shared pane boundary and themed scrollbars — 2026-10-05

paired-pane-resizer.js owns only coordinated touching-edge presentation. When
Navigator and Preview overlap/touch, its separator moves both existing width
owners together, preserving minimum/maximum widths and a 6px shared drag gap.
It is hidden for collapsed, full-page or filled previews. Resize observers keep
it aligned. Native browser geometry refreshes through the existing preview API.
Base scrollbar styles now use theme tokens for popup and Proxima surfaces.
AYG suite: 1848 passed; isolated Chromium drag proof confirmed both edges move,
6px gap, separator remains visible, and computed thin themed scrollbar style.

## Saved navigator states and embedded Quick Run — 2026-10-05

navigator-saved-states.js stores explicit UI snapshots in localStorage and renders
named directory/icon pills below Everything. Snapshots restore provider, directory,
view, branches and search without introducing another workspace document writer.
Navigator plus records the current snapshot; magnifier mounts the existing Quick
Run layer inside the navigator. Ordinary Quick Run invocation restores the layer
to its workspace placement. Compact action controls have a themed backdrop.
Browser tab scrollbar is hidden while wheel panning and drag insertion remain.
AYG suite: 1848 passed. Isolated Chromium saved C, navigated into D, and restored
C via its pill, with existing sibling popup/inline expansion behaviors passing.

Pill drag refinement — 2026-10-05: plus removed. Breadcrumb, navigator, sibling
popup and Quick Run rows supply structured pill drops; paths/HTTP links accepted.
Canvas pointer drops pin activation records while restoring initial graph positions.
Folder breadcrumbs restore navigation; item/Quick Run pills invoke existing actions.
Embedded Quick Run starts below the pill row and tracks row wrapping. MMB deletion
remains. AYG 1848 passed; isolated Chromium verified dropped folder pill restoration.

Pill height and wrapped controls — 2026-10-05: Navigator header and tools wrap
instead of clipping on narrow surfaces. Full-width saved-pill viewport has a
horizontal height separator, persists its height, lays out as many rows as fit,
and translates wheel motion into horizontal panning without a visible scrollbar.
Quick Run's existing observer follows the resized viewport. AYG suite 1848 passed;
isolated Chromium asserted 28px collapsed pill height, drop restoration and wheel
panning after overflow. All changes remain in the local Backpack project.

Navigator saved states are shared UI state, not workspace-document authority. All
current As You Go surfaces use the same registered Backpack project/origin, so the
saved-pill owner persists through that origin's local storage and synchronizes live
surfaces with storage/BroadcastChannel events. Pill height is shared the same way;
the workspace model remains untouched.

Pane clasp ownership — 2026-10-05: navigator and preview keep independent width
and resizer ownership while unclasped. The link clasp is the only coordinator that
may join them: it snapshots the independent layout, snaps to one rendered seam,
disables both pane-owned edge hit targets, and makes the paired seam the sole resize
path. Unclasp restores the independent layout (or opens a real gap if they originally
touched). Saved navigator pills resolve the same shortcut identity/icon hydration
path as the rows they came from; this remains UI state, not workspace authority.

## Navigator file transfers — 2026-10-06

Creator request: linked file drags onto real folders move the actual files and
show the destination beside the cursor. Copying AYG file selections into real
folders copies the files; copying real files into AYG creates shortcut links.
`navigator-file-transfer.js` verifies source absence and destination presence
before requesting the existing workspace writer to retarget AYG references.
Saved-pill paths follow verified moves through their existing shared UI store.
The navigator owns clipboard provider routing, transient destination notices and
folder markers; Papers retains its existing generic file-operation seam.

When the physical move succeeds but its workspace link save fails, the live
navigator retains the verified old/new paths. Its existing Refresh action
rechecks the filesystem and retries only the link save, never the file move.
The existing workspace-ready commit helper owns coordination readiness and
durable acknowledgement; an optimistic in-memory target does not count as a
saved link. Pending recovery is session-local and must be retried before closing
that view. This recovery does not establish the cause of a particular save
refusal; conflict and writer failures still remain visible through the existing
workspace save system.

Native drop negotiation must respect the source's `effectAllowed`. Electron
43.1.1 starts Windows file drags with copy/link transport effects; demanding a
move cursor cancels the drop before the navigator receives it. The navigator
negotiates an allowed effect while keeping actual move/copy authority in its
existing transfer plan. A real Chromium drag reproduced zero drop events with
the old move effect and one with the compatible effect (isolated synthetic UI).

The navigator toolbar plus creates inside the selected folder or in the selected
item's parent; without selection it uses the displayed location. Real folder
links in AYG create real subfolders through the same filesystem capability. Its
inline name field commits on Enter and cancels on Escape or blur. AYG folders
use the existing createGroup/workspace writer; Opus folders use the generic
host create-folder capability, which creates exactly one child directory and
reports collisions instead of overwriting existing contents.

Restored clasp intent is suspended while either pane is collapsed. A collapsed
Proxima preview uses a compact border instead of the expanded full-height edge.
When both panes become eligible again, the existing width owners snap back to
one seam before the clasp and paired resize strip are shown.

Folder previews retain the existing active browser and its tabs. If no browser
tabs exist, they show an empty browser tab with an empty address field. The
blank tab is local UI state until an address is entered; its first navigation
opens the existing generic native browser host. It does not load a homepage or
request native browser resources for about:blank. Opus uses a muted blue pane
background to distinguish its filesystem provider.

## Alt+Q widget input and activation — 2026-10-06

The host enables mouse activation for Peek mode before showInactive, since non-focusable Windows widgets return MA_NOACTIVATEANDEAT and discard physical icon presses. The shared widget activation path ends Peek, refreshes existing control bindings, activates the exact member, and hides through the existing host owner. Chooser additions reuse that path; legacy Alt+W stays non-focusable. Blue wash uses the existing selection-effects controller and Anime.js. Ctrl+MMB closes and removes the same member. Creator confirmed the installed repeated-click fix and authorized push. Host typecheck and 1396 tests passed; Backpack tests: 1904 passed. The bounded title trace remains available for input diagnosis.

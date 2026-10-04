# Reincarnation completion checklist

Scope: preserve stable post-mortem behavior while bounding the unrelated context
needed to change one capability. Follow Papers REINCARNATION-HANDOFF.md and the
exact historical north star; faulty-refactor code is research, not a donor baseline.
No release, installation, restart, process termination, or creator-data mutation.

## Accepted checkpoints

- Candidate binding/recovery: `9c74871588020bf78e00d75b2c315c1aee19288f`.
  Before movement 15 behavioral tests pass; focused 113 pass; full 1691 pass,
  0 fail, 0 skip plus 8 pretests. One retained-row binder serves attached/widget.
- Separate baseline correction: `2f3299680c402742949eb424913e1969a0c325f9`.
  Reproduced undefined identity helper and missing entry import for explicit list
  removal; repaired through the existing validated identity decision. Focused 92
  pass; full 1695 pass, 0 fail, 0 skip plus 8 pretests. Absence cannot become add.
- Widget presentation lifecycle: the commit containing this file.
  Original inline behavior characterized by 8 tests before extraction; focused
  100 pass; full 1703 pass, 0 fail, 0 skip plus 8 pretests. Success classification,
  three attempts, 100/200 ms delays, sequential startup, docked/binned/placement
  filtering, detached/read-only gate, and activate:false remain identical.

## Remaining acceptance work

- [x] Isolate window-layout identity/membership policy from durable mutation,
      retaining public compatibility exports and all established validation.
- [x] Isolate member selection/range state and repair from DOM/persistence.
- [ ] Finish view lifecycle and DOM patching (shared card/body/picker HTML extracted).
- [ ] Extract picker coordination and cleanup for attached/widget callers; preserve
      supersession, subscribe-before-begin, cancellation and byte-zero no-op rules.
- [x] Extract group-action orchestration and target selection; preserve current
      broker batching and existing state/save/recording sequence. Unused worker orchestration removed.
- [x] Extract recording/tracking orchestration, demand, retirement and draining;
      retain native identity authority and two genuine missing observations.
- [x] Isolate preview coordination/cache lifecycle and Shift peek ownership.
- [ ] Finish live surface separation. Compact-widget wiring is now extracted;
      the dated entry still carries attached/workspace window-layout event wiring.
      The historical full-surface detach path is retired/unreachable and is not a
      required extraction target merely because the old roadmap named it.
- [ ] Refresh architecture/dependency map, remove superseded implementations and
      audit for duplicate persistence, identity or lifecycle authorities.
- [ ] Run complete automated gates and applicable isolated runtime/visual proofs.
      Current evidence is source/unit evidence, not installed/creator acceptance.
- [ ] Audit completion against every retained invariant and explicit deliverable.

Papers shared-host/browser/filesystem/other-Backpack extraction is deferred by the
current guardrail. Reconsider only a concrete named authority with wider tests;
never widen AYG work casually. The old roadmap's speculative registry, parser,
observability and framework proposals are not automatic required implementations.
Evaluate them against actual reduction in required unrelated context.

## Current slice change boundary

Widget lifecycle production files: `public/workspace-20260730b.js` and
`public/app/window-layout-widget-lifecycle.js`. Supporting changes:
`window-layout-widget-lifecycle.test.mjs`, `window-layout-workspace.test.mjs`,
`package.json`, `ARCHITECTURE.md`, and this checklist. Existing source-location
assertions were repointed to the new owner; behavior tests cover the contract.
Protected file-capability-panel, browser, filesystem, Papers host/preload/runtime,
store, recording and unrelated Backpack code are unchanged. No environmental
failure occurred. Existing untracked work artifacts are preserved.

## Identity/membership extraction receipt

Production changes: `public/app/window-layout-workspace.js` and new
`public/app/window-layout-membership.js`. Supporting changes:
`window-layout-workspace.test.mjs`, `ARCHITECTURE.md`, and this checklist.
All existing exports remain available through the workspace module. The writer
imports validators and identity relation from the pure owner; direct policy tests
import that owner. No second identity authority is introduced: host descriptors
still supply native truth, and this module only classifies membership.

Before movement: workspace characterization 51 pass / 0 fail / 0 skip.
After movement: focused 97 pass / 0 fail / 0 skip; full 1703 pass / 0 fail / 0 skip
plus 8 pretests. Exact/legacy/mixed identity, malformed rejection, ambiguity,
seed deduplication, remove-only no-op, commit rebasing and refusal remain covered.
No environmental failure. Entry, native host, browser/filesystem, store, recording,
other Backpacks and creator data unchanged. Commit containing this receipt is
the extraction checkpoint. Overall refactor is still incomplete.
## Group/range orchestration receipt

Changed production files: `public/workspace-20260730b.js` and new
`public/app/window-layout-group-actions.js`. Supporting changes:
`window-layout-group-actions.test.mjs`, `window-layout-workspace.test.mjs`,
`package.json`, `ARCHITECTURE.md`, and this checklist.

Evidence corrected an obsolete architectural assumption: current group controls
use the resident broker's one native batch, not the bounded worker helpers still
sitting unused in the entry. Extracted the active group/range paths unchanged and
removed only the unreachable worker wrappers, constants, import and construction.
The existing worker primitives/tests in their owning modules remain intact.
No legacy worker implementation was reintroduced into the live control path.

Before movement: 8 behavioral tests passed against the original production
functions. After movement: focused 127 pass / 0 fail / 0 skip; full 1711 pass /
0 fail / 0 skip plus 8 pretests. Target/all/range/isolate action order, host refusal,
post-await handoff, latest-state patches, one queued save and recording sequence,
live range direction and missing-capability invalidation are characterized.
No environmental failure. Native broker, recording implementation, store,
browser/filesystem, host/preload, other Backpacks and creator data untouched.
This commit is the code-only rollback checkpoint; overall refactor remains active.
## Selection ownership receipt

Changed production files: `public/workspace-20260730b.js` and new
`public/app/window-layout-selection.js`. Supporting changes:
`window-layout-selection.test.mjs`, `package.json`, `ARCHITECTURE.md`, and this
checklist. Storage stays in existing surface-local maps/sets; all selection
writes now flow through the owner or its explicit storage adapters.

Before movement: 7 tests characterized the original attached Ctrl/range/clear
path. After movement: focused 152 pass / 0 fail / 0 skip; full 1721 pass / 0 fail /
0 skip plus 8 pretests. Additional tests cover widget in-place toggle versus range
set replacement, empty clear leaving anchors untouched, single retirement,
startup/closed-window repair, snapshot pruning, and layout isolation. Existing
retirement anchor differences are deliberately preserved, not silently corrected.
No environmental failure. Rendering remains caller-owned; no host/native control,
store/persistence, browser/filesystem, Papers host/preload or other Backpack edits.
Existing creator data/untracked artifacts preserved. Commit containing this
receipt is the selection checkpoint. Overall refactor still incomplete.
## Shared card/picker HTML extraction receipt

Production changes: `public/workspace-20260730b.js` and new
`public/app/window-layout-view.js`. Supporting changes: `window-layout-view.test.mjs`,
`test-fixtures/window-layout-view.json`, `compact-card-parity.test.mjs`,
`card-implementation.test.mjs`, `picker-keyboard-routing.test.mjs`,
`window-layout-clear.test.mjs`, `package.json`, `ARCHITECTURE.md`, and this checklist.
Existing source checks read both the wiring and extracted presentation owner.

Baseline: 7 cases captured original production HTML before movement. Golden
fixtures cover attached, widget, detached placeholder, read-only, widget during
handoff, empty card, picker row and empty picker. Test fixture authoring code was
removed after capture; ordinary tests cannot bless new output. After movement:
focused 69 pass / 0 fail / 0 skip; full 1728 pass / 0 fail / 0 skip plus 8 pretests.
Markup strings match baseline byte-for-byte, including whitespace, selector,
attribute, label and escaping contracts. An extraction indentation mistake was
caught by these checks and corrected without modifying the fixtures.
No environmental failure. No CSS/DOM event, picker policy, native control,
recording, store/persistence, browser/filesystem, host/preload or other Backpack
changes. Existing untracked work and creator state preserved. View lifecycle,
DOM patching and surface separation are still pending; this is not full completion.
## Card presentation lifecycle receipt

Production: `public/workspace-20260730b.js`, new
`public/app/window-layout-card-presentation.js`. Supporting:
`window-layout-card-presentation.test.mjs`, `package.json`, `ARCHITECTURE.md`, this
checklist. Before movement 10 tests pass against the original functions; focused
34 pass / 0 fail / 0 skip; full 1738 pass / 0 fail / 0 skip plus 8 pretests.
Measured balancing, empty rows, capped width/rounded height, 180ms debounce,
existing rebaseAutomaticSave metadata, observation/removal and disconnected,
placeholder, widget, missing-layout gates are preserved. Remove still unobserves
without cancelling an existing timer; changing that would be a behavior change.
No environmental failure. Browser/filesystem, host/native, recording, unrelated
Backpacks and creator data untouched. This commit is the lifecycle checkpoint.
DOM state/status patching and surface separation remain pending.

## Shift Peek lifecycle receipt

Production: `public/workspace-20260730b.js`, new
`public/app/window-layout-shift-peek-lifecycle.js`. Supporting:
`window-layout-shift-peek-lifecycle.test.mjs`, `window-layout-shift-peek.test.mjs`,
`package.json`, `ARCHITECTURE.md`, this checklist. Original 6 behavioral cases
passed before movement. After extraction: focused 35 pass / 0 fail / 0 skip;
full 1744 pass / 0 fail / 0 skip plus 8 pretests. Preserved 32ms traversal coalescing,
120ms leave grace, generation/key fencing, bounded 180+120*attempt retry up to
1000ms, release deduplication, late capability refusal and native begin/end queue
ordering. Existing diagnostic titles and event planner semantics unchanged.
No environmental failure. Browser/filesystem, native host, recording, durable
store/state and unrelated Backpacks untouched. Commit containing this receipt
is the code-only checkpoint. Ordinary preview lifecycle/cache and surface wiring
remain pending; overall completion remains unproven.

## Preview capability ownership receipt

Production: `public/workspace-20260730b.js`, new
`public/app/window-layout-preview-capabilities.js`. Supporting:
`window-layout-preview-capabilities.test.mjs`, `package.json`, `ARCHITECTURE.md`, this
checklist. Baseline 7 behavioral cases pass before movement; focused 60 pass /
0 fail / 0 skip; full 1751 pass / 0 fail / 0 skip plus 8 pretests. Retains state-only
warm capabilities, isolates composite keys, evicts changed/removed identity,
recovers after explicit missing invalidation, binds exact instance descriptors,
refuses capability-free success/error and delegates attached resolution unchanged.
No environmental failure. Thumbnail/ordinary preview lifecycle, native identity,
store/persistence, browser/filesystem, host/preload and other Backpacks unchanged.
Existing snapshot and cache storage remain caller-owned, with no second authority.
This commit is the checkpoint; popover/dwell and surface extraction still pending.

## Preview presentation/dwell receipt

Production: `public/workspace-20260730b.js`, new
`public/app/window-layout-preview-presentation.js`. Supporting:
`window-layout-preview-presentation.test.mjs`, `package.json`, `ARCHITECTURE.md`, this
checklist. Baseline 8 behavioral cases pass against original production functions;
focused 42 pass / 0 fail / 0 skip; full 1759 pass / 0 fail / 0 skip plus 8 pretests.
Preserved one shared popover, text/icon updates, viewport clamping, animation-frame
cancellation, widget local-name suppression, native show/hide authorization and
screen-anchor payloads, 100ms coalesced dwell and disconnected/non-hover gates.
Deleted the superseded in-page thumbnail branch already unreachable after the
native-preview path's unconditional return; focused/full gates rerun afterward.
No environmental failure. Thumbnail generation scheduler and Shift planner/owner,
native host, persistence, browser/filesystem, other Backpacks and creator data
untouched. This commit is the presentation checkpoint. Event routing remains in
the entry until surface extraction; no installed/native visual acceptance claimed.
## DOM presentation receipt

Production: `public/workspace-20260730b.js`, new
`public/app/window-layout-dom-presentation.js`. Supporting:
`window-layout-dom-presentation.test.mjs`, `package.json`, `ARCHITECTURE.md`, this
checklist. Original 9 behavior cases pass before movement; focused 83 pass / 0 fail /
0 skip; full 1768 pass / 0 fail / 0 skip plus 8 pretests. Preserves scoped duplicate
DOM patches, live normal/minimized/unknown state, marker identity, title removal,
status replacement/cancellation, widget 2400ms auto-clear and attached explicit
duration. No environmental failure. No persistence, picker policy, native control,
recording, browser/filesystem, host/preload, other Backpack or creator-data changes.
This commit is the checkpoint. Surface-local event wiring is still pending.

## Workspace picker orchestration receipt

Production: `public/workspace-20260730b.js`, new
`public/app/window-layout-workspace-picker.js`. Supporting:
`window-layout-workspace-picker.test.mjs`, `window-layout-workspace.test.mjs`,
`window-layout-member-icon.test.mjs`, `package.json`, `ARCHITECTURE.md`, this checklist.
Before movement 8 behavioral cases pass; focused 72 pass / 0 fail / 0 skip;
full 1776 pass / 0 fail / 0 skip plus 8 pretests. Preserves required-close rejection,
ordinary-close fail-local cleanup, cancelled pick zero application, result buffering
before begin settles, begin-failure unsubscribe, post-await read-only gates, stale
list generation refusal and cancellation draining promise. Existing shared picker
session/identity/writer modules remain unchanged. Source tests now read the moved
owner plus composition; their semantic assertions remain intact.
No environmental failure. Protected browser/filesystem, native host/preload,
recording, persistence and other Backpacks unchanged; creator data untouched.
This commit is the checkpoint. Widget picker coordination, recording/tracking
orchestration and surface separation remain open; overall completion unproven.

## Widget picker orchestration receipt

Production: `public/workspace-20260730b.js`, new
`public/app/window-layout-widget-picker.js`. Supporting:
`window-layout-widget-picker.test.mjs`, `window-layout-workspace.test.mjs`,
`window-layout-member-icon.test.mjs`, `package.json`, `ARCHITECTURE.md`, this checklist.
Before movement 10 behavioral cases pass against original functions. After movement:
focused 87 pass / 0 fail / 0 skip; full 1786 pass / 0 fail / 0 skip plus 8 pretests.
Idle dismiss avoids native close; required close failure blocks direct begin;
list/direct generations fence retired responses; early result buffering, cancellation
zero-command behavior, listener cleanup, exact retained rows and one stale workspace
acknowledgement retry are preserved. Source assertions read the actual moved owner;
the right-click source delimiter now uses its composition declaration.
No environmental failure. Protected browser/filesystem, native host/preload,
recording, persistence, other Backpacks and creator data unchanged. This is the
code checkpoint; surface separation and recording/tracking orchestration remain.

## Tracking lifecycle orchestration receipt

Production: `public/workspace-20260730b.js`, new
`public/app/window-layout-tracking-lifecycle.js`. Supporting:
`window-layout-tracking-lifecycle.test.mjs`, `window-layout-auto-tracking.test.mjs`,
`window-layout-workspace.test.mjs`, `package.json`, `ARCHITECTURE.md`, this checklist.
All 16 characterization cases pass against the original code and new owner.
Focused 156 pass / 0 fail / 0 skip; full 1802 pass / 0 fail / 0 skip plus 8 pretests.
Preserves serialized failure-tolerant events, 64 pending opens, 2s retries/sweeps,
60s expiry and four retries per sweep; complete startup reconciliation only once;
refused startup commits stay retryable; live snapshots/outages clear missing
counts; lifecycle gone needs an independent exact resolution; periodic retirement
requires two positives. Population rechecks current suppression after observation,
commits before capability publication and refreshes recording once after additions.
The moved owner uses state/role getters so awaited host work sees current authority.
Source assertions now read the owner and composition and retain semantic guards.
No environmental failure. Protected browser/filesystem, host/preload, other
Backpacks and creator data untouched. Recording demand/retirement orchestration,
surface separation and final acceptance remain pending; completion is unproven.

## Recording demand and retirement lifecycle receipt

Production: `public/workspace-20260730b.js`, new
`public/app/window-layout-recording-lifecycle.js`. Supporting:
`window-layout-recording-lifecycle.test.mjs`, `window-layout-workspace.test.mjs`,
`package.json`, `ARCHITECTURE.md`, this checklist. Baseline 11 cases pass before
movement; focused 161 pass / 0 fail / 0 skip; full 1813 pass / 0 fail / 0 skip,
plus 8 pretests. Resume observes the durable id without applying saved rectangles;
active queries use runtime ownership; stop clears pending save/listener/attempt
synchronously and awaits both native cancellation and controller stop with
clearActive:false. Confirmed retirement commits once across layouts before cache,
selection and preview cleanup; refused persistence does no cleanup; widget routes
one command; unlink retains exact Auto suppression and inactive-context behavior.
Existing retirement writer and recording runtime remain the sole authorities.
No environmental failure. Protected browser/filesystem, host/preload, unrelated
Backpacks and creator data untouched. Surface split, final architecture/authority
audit and runtime/visual acceptance still remain; overall completion is unproven.

## Compact widget surface receipt

Checkpoint: `d3455899068201852adc1dd1af34d328aba61744`.

Production: `public/workspace-20260730b.js` and new
`public/app/window-layout-widget-surface.js`. Supporting changes retarget the existing
compact-card, picker, hover-policy, clear, channel, render-identity and workspace
characterization tests to the owner that now contains the behavior; new
`window-layout-widget-surface.test.mjs` covers listener-before-ready ordering,
duplicate snapshot stability, one-time geometry restoration, widget-local opacity,
orphan/deletion close behavior, pagehide teardown and resize debounce.

The extraction moves compact-surface snapshot handling, resize, selection, drag,
hover input, picker intents, Quick Run handoff and teardown together. The dated entry
keeps only dependency construction plus explicit callbacks for shared ephemeral
references. The widget owner contains no direct store/save/commit/document-writer
surface; durable commands still cross the existing widget channel to the workspace
writer. An unused legacy in-card picker-markup function disappeared with the moved
block; both live native chooser branches remain characterized as using the same exact
membership identity rule.

Focused affected gate: 163 pass / 0 fail / 0 skip. Full `npm test`: 1821 pass /
0 fail / 0 skip. `git diff --check` passed. Browser, filesystem/file capability,
Papers host/preload/runtime, Proxima, Delegate Wave and creator data were untouched.
Existing untracked `work/` evidence was preserved. No package/install/restart/release
or installed-runtime claim was made. Live attached/workspace surface wiring and the
final authority/completion audit remain open.

## Preview / Shift-Peek input routing receipt

Production: `public/workspace-20260730b.js` and new
`public/app/window-layout-preview-input.js`. Supporting changes:
`window-layout-preview-input.test.mjs`, `window-layout-shift-peek.test.mjs`,
`compact-card-parity.test.mjs`, `package.json`, this architecture guide and this
checklist.

The moved owner contains only surface input translation: keyboard/native Shift,
member/list hover, pointer movement/leave, member press, scroll, resize and pagehide.
It calls the already-extracted preview presentation and Shift-Peek lifecycle owners;
it has no store/save/commit/recording/document-writer surface. Workspace list hover
still opens the attached native chooser, while compact-widget list hover remains
owned by the widget surface. Folder middle-click and member close/unlink gestures
stay in the entry and were not widened into this slice.

Focused surface gate: 73 pass / 0 fail / 0 skip. Full `npm test`: 1826 pass /
0 fail / 0 skip. `git diff --check` passed. Protected browser/filesystem,
Papers host/preload/runtime, Proxima, Delegate Wave and creator data were untouched.
The dated entry is down to 5901 lines; remaining live attached/member-control wiring
and the final authority/completion audit remain open.

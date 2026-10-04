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
- [ ] Extract recording/tracking orchestration, demand, retirement and draining;
      retain native identity authority and two genuine missing observations.
- [ ] Isolate preview coordination/cache lifecycle and Shift peek ownership.
- [ ] Separate workspace/widget/detached surface wiring. The dated entry must
      compose named owners rather than carry feature business logic or markup.
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

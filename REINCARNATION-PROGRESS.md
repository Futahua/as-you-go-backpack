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

- [ ] Isolate window-layout identity/membership policy from durable mutation,
      retaining public compatibility exports and all established validation.
- [ ] Isolate member selection/range state and repair from DOM/persistence.
- [ ] Extract card/member/picker view and DOM patching behind presentation inputs.
- [ ] Extract picker coordination and cleanup for attached/widget callers; preserve
      supersession, subscribe-before-begin, cancellation and byte-zero no-op rules.
- [ ] Extract group-action orchestration, target selection, prewarm/retry and
      bounded concurrency; keep existing one commit and partial failure behavior.
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

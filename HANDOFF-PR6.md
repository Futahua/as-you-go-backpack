# Handoff: PR #6 — Item sets

You are picking up a feature branch in a local Backpack project. Read this
whole file before touching anything.

## Where the code is

```
D:\Letters\MatTroiSeConMoc\Papers\Backpack projects\As you Go
```

That directory is the git repository and the working directory. Everything you
need is inside it.

- Repository: https://github.com/Futahua/as-you-go-backpack
- Pull request: **PR #6**
- Branch: `feat/item-sets`
- Base: `main` at `37542c92f467062a318a377b2fe06c6e5217b7b5`
- Branch head at handoff: `fa80525`

Related but **out of scope** — do not change unless a requirement genuinely
forces it:

- `D:\Letters\MatTroiSeConMoc\PAPERS 3\Papers-3` — the Papers host source
- `state.json` — the user's real data, already gitignored
- `D:\...\Papers\Data` — the host's binding and records

`ARCHITECTURE.md` in the repo maps each kind of change to its module. Read it
before adding code so new work lands in the right place.

## Running it

```bash
npm test
```

533 tests, all passing at handoff. There is no build step and no framework —
plain ES modules served as static files inside the Papers host.

To see it running, launch Papers and open this Backpack. **Nothing in this
branch has been verified that way** (see Known gaps).

## What the feature is

**Sets** are named groupings over workspace items, drawn as animated outlines
on the graph view.

- An item may belong to several sets (they overlap, forming a Venn) or to none.
- Membership is independent of folder location.
- Membership is *inherited through folders*: `G` on a folder covers its whole
  subtree, but only the folder id is stored, so items added to that folder
  later join the set automatically.
- Sets store no position or size. The outline is derived every frame from where
  members are, so a member that moves reshapes its own set rather than crossing
  a boundary it cannot cross.
- Names are optional — the user navigates visually, and sets are picked by
  clicking their contents rather than by reading a list.

### Gestures

| Gesture | Behaviour |
| --- | --- |
| `G` | Group the current selection into a new set |
| `Ctrl+G` | Membership picker: click items to toggle their sets, `Enter` confirms, `Escape` cancels |
| `Ctrl+A` | Scoped to the picked set (derived from the last clicked item); outside any set it selects only setless items |
| `Alt+click` a folder | Batch-expand the inverse of the selection |
| `Delete` | Delete selected sets — removes only the grouping, the items are untouched |

## Module map for this feature

| Responsibility | File |
| --- | --- |
| Pure set data: membership, scoping, drop rules | `public/sets-model.js` |
| Pure region geometry: occupancy field, contours, hit tests | `public/set-region-model.js` |
| Ctrl+G picking mode (transient state only) | `public/app/components/set-membership-mode.js` |
| Commands: `G`, `Ctrl+G`, scoped `Ctrl+A`, set deletion | `public/app/workspace-commands.js` |
| Key bindings | `public/app/interactions/keyboard-controller.js` |
| Rendering, Alt+click, set layer | `public/workspace-app.js` |
| Browser entry (just calls `mountWorkspace`) | `public/workspace-20260730b.js` |
| DOM stand-in for mounting the app in tests | `fake-dom.mjs` |
| Outline styling and picking states | `public/styles/graph.css` |

The two pure modules hold the real logic and are fully unit tested. Keep them
free of DOM, store and host access.

## The separation requirement — now met

**Requirement: two sets that share no members must never blend into one shape.**
If exclusive outlines merge, you cannot tell which items belong to which set.

**This is met**, and met by construction rather than by tuning. Verified
exhaustively: every integer centre separation from 95 to 500px keeps the two
regions apart, tightest observed gap 5px. Previously, separations below ~200px
touched by 3–12px.

### How

The old pipeline (`set-hull-model.js`, now removed) drew a Catmull-Rom curve
through padded hull points. The curve bows past the points it passes through
by an amount that scales with the shape, so the drawn edge was never the edge
that had been checked. Six attempts at bounding that with constants each fixed
some separations and broke others.

`public/set-region-model.js` decides membership per unit of space instead. A
cell joins a set only when all three hold:

1. it is within `padding` of one of the set's members;
2. it is at least `gap` from every non-member;
3. it is outside the **separation band** of any set this one shares no member
   with.

The boundary is extracted from those cells with marching squares, and that
extracted polygon is both what renders and what hit-testing will use. Nothing
is drawn that was not tested.

Rule 3 is the part that finishes it, and it is easy to leave out — the first
implementation here had only rules 1 and 2, and 13 aligned separations between
96 and 144px still touched. Clearance from foreign *tiles* is not enough: the
corridor between two close sets is within padding of both, so each claims it.

Sets that **do** share a member are exempt from the band. That overlap is the
Venn, and banding them apart removes the shared item from both regions.

### If you change this code

Drive it from measurement, not from a formula — that is what the old approach
got wrong. Two traps this work fell into and had to climb out of:

- **A randomized test passed while the bug was live.** It jittered members
  off-axis and never sampled the aligned separations that were failing. The
  exhaustive integer sweep in `set-region-model.test.mjs` replaced it. Prefer
  sweeps to sampling when the failure might be systematic.
- **`cellSize` is a correctness parameter**, not a performance knob. Sample too
  coarsely and the gap quantizes away. It is explicit in the API for that
  reason, and guarded by a test across 2/4/8px.

## Other known gaps

- **Nothing is verified in the live Papers app.** The composition root is now
  mountable in tests (`mountWorkspace()` in `public/workspace-app.js`, with a
  DOM stand-in in `fake-dom.mjs`), and the rendered outline paths are asserted
  on directly. But `fake-dom.mjs` models structure, attributes and listeners —
  **not layout**. It catches wiring regressions and crashes; it cannot tell you
  an outline looks right. Driving the real app by hand is still required before
  any visual claim.
- **The graph's zoom-to-fit throws**, in both motion modes, because the two
  vendored d3 bundles each carry a private copy of `d3-selection`, so the
  selection the app passes `d3-zoom` is missing `.transition` / `.interrupt`.
  Pre-existing on `main` since the graph view landed (`a22fe9a`) and unrelated
  to sets. **Being fixed separately** — if that work has landed, the
  `destroyGraphView()` call in `renderGraph()` in `workspace-app.test.mjs` is
  no longer needed to keep the fit timer from firing, and the render tests can
  simply await it. Reproduce with the snippet in the commit message for
  `fa80525`.
- **Drop blocking is modelled but not wired.** `canDropInsideRegions()` decides
  it and is tested; the drag code does not call it yet, so a non-member can
  still be dropped inside a set. `graph.getSetRegions()` is the geometry it
  should consult, so that hit-testing matches what is drawn.
- **Inherited membership cannot be edited.** A child cannot leave a set it
  inherits from its parent folder — the storage model has no `excludedIds`.
- **Ctrl+G takes the union across a mixed selection**, so opening the picker
  and pressing Enter immediately can change membership. It needs tri-state
  (all / none / mixed) with only user-changed states applied.
- **The intersection movement rule is untried.** An item in several sets is
  confined to their intersection, and a member cannot leave its own set region
  by dragging. The user asked to revisit this once the outlines were visible;
  that has not happened. With three or more overlapping sets it may feel too
  restrictive.
- **Right-click-drag to multi-select sets is not bound**, and sets have no
  visible name or delete affordance beyond the `Delete` key.

## How this work is expected to be done

- Every rule in the pure modules was **mutation-checked**: the rule was
  disabled, the suite was confirmed to go red, then the rule was restored.
  Keep doing this — several tests written here initially passed with the
  feature disabled and had to be rewritten to be worth anything.
- Comments explain *why*, not *what*. Match the surrounding style.
- Do not merge PR #6 or modify `main` without being asked.
- Do not reintroduce mandatory names, folder-copy rejection, or the
  no-nesting rule (one set inside another is just a total overlap and is
  allowed).

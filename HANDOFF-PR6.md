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
- Branch head at handoff: `52b209a`

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

551 tests, all passing at handoff. There is no build step and no framework —
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
| Pure outline geometry: hulls, clustering, wobble, hit tests | `public/set-hull-model.js` |
| Ctrl+G picking mode (transient state only) | `public/app/components/set-membership-mode.js` |
| Commands: `G`, `Ctrl+G`, scoped `Ctrl+A`, set deletion | `public/app/workspace-commands.js` |
| Key bindings | `public/app/interactions/keyboard-controller.js` |
| Rendering, Alt+click, set layer | `public/workspace-20260730b.js` |
| Outline styling and picking states | `public/styles/graph.css` |

The two pure modules hold the real logic and are fully unit tested. Keep them
free of DOM, store and host access.

## THE UNFINISHED WORK — start here

**Requirement: two sets that share no members must never blend into one shape.**
If exclusive outlines merge, you cannot tell which items belong to which set.

**This is not met.** Measured across member separations of 105–500px:

| Separation | Result |
| --- | --- |
| ~200px and beyond | Clear, correct |
| Below ~200px | Outlines still touch, by 3–12px |

### What is already in place

- `safePadding()` in `set-hull-model.js` caps a set's padding by the distance
  to items belonging to sets it shares nothing with.
- Sets that **do** share a member are deliberately exempt — that overlap is the
  Venn and must be preserved. The renderer computes the disjoint set for each
  outline in `drawSetShapes()`.
- `closedCurvePath()` takes a `smoothing` parameter; a constrained outline
  reduces it to hug its hull more tightly.

Both help. Neither guarantees.

### Why the obvious fixes do not work

The drawn curve bows outward past the hull points it passes through, and **that
bow scales with the shape's size** (measured: 12.5px on a small shape, 27px on
a larger one). Consequences:

- No fixed padding reserve or amplitude cap can bound it.
- Clamping the hull *points* does not help, because the curve between two
  clamped points still bulges outward. This was tried and does not work.

Four parameter-tuning attempts (padding floor, amplitude budget, a fixed bulge
constant, a derived smoothing) each fixed some separations and broke others.
**Do not continue down that path.**

### Two approaches that should work

1. Derive the outline from a true offset curve with a provable maximum
   deviation, rather than a Catmull-Rom through hull points.
2. Sample the finished curve and shrink until containment actually holds —
   verify rather than predict.

There is a ready-made harness for measuring this: the PR discussion contains a
script that samples cubic segments and reports, for each separation, the
maximum x of set A against the minimum x of set B. Reproduce it and drive the
fix from measurement, not from a formula.

## Other known gaps

- **Nothing is verified in the live Papers app.** Outlines render and gestures
  are wired, but this has not been driven by hand. `workspace-20260730b.js`
  performs DOM queries at module load, so the composition root cannot be
  imported by the test suite — everything in that file is verified by
  inspection only. Several visual bugs in earlier work reached the user because
  a green suite said nothing about them.
- **Drop blocking is modelled but not wired.** `canDropInsideRegions()` and
  `regionsAt()` decide it and are tested; the drag code does not call them yet,
  so a non-member can still be dropped inside a set.
- **The intersection movement rule is untried.** An item in several sets is
  confined to their intersection, and a member cannot leave its own set region
  by dragging. The user asked to revisit this once the outlines were visible;
  that has not happened. With three or more overlapping sets it may feel too
  restrictive.
- **Right-click-drag to multi-select sets is not bound.** The hit testing
  exists (`setsIntersectingRect`), the gesture does not.
- **Sets have no visible name or delete affordance** beyond the `Delete` key.

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

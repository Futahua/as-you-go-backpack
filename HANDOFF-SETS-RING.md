# Handoff: item sets, branch `feat/sets-ring`

Read this whole file before touching anything.

## Where the code is

```
D:\Letters\MatTroiSeConMoc\Papers\Backpack projects\As you Go
```

That directory is the git repository and the working directory. Do not edit
outside it — the Papers host source lives elsewhere and is out of scope, as is
`state.json` (the user's real data, gitignored).

- Repository: https://github.com/Futahua/as-you-go-backpack
- Branch: `feat/sets-ring`. Base: `main` at `37542c9`.
- Head at handoff: `ee59878`. **565 tests passing**, working tree clean.

**The head commit is a known-broken work in progress.** See "Start here" below.
Everything before it (`5accc4d` and earlier) is sound.

Three earlier attempts are pushed as snapshots and should be read, not merged:

| Branch | What it was | Why it stopped |
| --- | --- | --- |
| `retired/1-item-sets-geometry` | sets as computed geometry | thin connector necks, concave bites, 87.8ms rebuilds |
| `retired/2-set-gravity` | sets as physics | right idea, wiring half-finished |
| `retired/3-sets-ring-tangle` | the ring, first pass | outline lagged behind dragged members |

The prior-art file on branch 3 is **`RING-TANGLE.md`**, at the repo root. (An
earlier version of this handoff called it `RING-LAG.md`; there is no such file.)
It records what was ruled out there by measurement, so it does not have to be
re-diagnosed, and it carries a correction worth reading: its first diagnosis
(that the ring tangles) was **wrong**, and came from reproducing a drag as one
large jump instead of many small steps.

## Running it

```bash
npm test
```

No build step, no framework — plain ES modules served as static files inside
the Papers host.

**Papers is at** `C:\Users\admin\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Papers.exe.lnk`.
It reads these files from disk, so edits are live.

**Use Ctrl+Shift+R, not Ctrl+R.** Papers serves the backpack through a custom
scheme with no cache headers, and Chromium holds the ES modules. A plain reload
shows stale code. This has already cost one session an entire afternoon, during
which the outlines on screen were rendering from an earlier load.

**The packaged build has no devtools**, so `console.log` is useless for
diagnosis. Put diagnostics in the status bar — it is visible and already
carries error text. (`syncSetRings` still has a `console.info` on every
reconcile that nobody can see; harmless, but do not add more.)

## What a set is

A named grouping over workspace items, drawn as an outline on the graph view.
Membership is independent of folder location and is inherited through folders.
An item may belong to several sets, or none.

The user's model: sets behave "like water droplets but strong", and "icons are
ants" sitting on the surface.

### Hotkeys

| Key | Behaviour |
| --- | --- |
| `G` | Group the current selection into a new set |
| `Ctrl+G` | Open the membership picker — click items to cycle their sets |
| `Enter` | Confirm the picker, applying only what changed |
| `Escape` | Cancel the picker; else clear the set selection; else clear the item selection — one press undoes one thing |
| `Ctrl+A` | Scoped to the picked set: its members inside one, the setless items outside every set |
| `Delete` | On a selected set, removes the grouping and leaves the items. Checked **before** the item branch, so a live set selection wins |
| Click inside an outline | Selects that set (smallest first where they nest) |
| `Alt+click` a folder | Batch-expand the inverse of the selection |

`G` is deliberately unmodified, so it must not fire while typing; every modal
layer returns early before the workspace bindings are reached.

## The architecture

**The outline is a ring of nodes in the simulation, but what is drawn is the
convex hull of those nodes.** A closed chain of small invisible nodes, linked to
their neighbours and subject to the same collision as the icons; the hull is
taken over where they ended up, and a spline is drawn through that.

The hull is not only a rendering choice. It is the single shape every consumer
reads — drawing, click hit-testing, nesting order, ejection, and the exclusion
force. That is deliberate: on the retired geometry branch the drawn shape and
the hit-tested shape disagreed, and the user was interacting with something they
could not see. **If you add a consumer, give it the hull.**

Five forces act:

| Force | What it does |
| --- | --- |
| `forceRingShape` | holds each ring on the ellipse enclosing its own members |
| `forceSetGravity` | gathers a set's members towards their common centre |
| `forceSetExclusion` | pushes non-members out of a set they are inside |
| `forceSetSeparation` | keeps unrelated sets from crossing |
| charge / collide / link | the graph's own layout, unchanged |

`forceSpeedLimit` exists in `set-ring-model.js`, tested, and is **still
deliberately not wired**. Read `bda8229` before re-enabling it. Re-measured this
session and it remains the wrong instrument: it does not behave monotonically —
a cap of 6 or 16 holds where 8 diverges.

## START HERE — the head commit is broken

`ee59878` is a work in progress that **must not ship as is**.

The user's report, with a screenshot: *"physics may not overlap anymore, but the
rendering trick certainly does."* Two set outlines met along a shared border
with nothing between them.

The diagnosis is certain. `forceSetSeparation` pushes **ring nodes** apart, and
what the user sees is the **hull** drawn around them. A hull spans outward
across a concavity, so it occupies space no ring node is in — two rings whose
every node is comfortably clear can still be *drawn* as two shapes that overlap.

The direction of the fix is the user's own, and it is right: **make the force
read the shape on screen.** Same principle as drawing and hit-testing the hull.

`ee59878` adds that second pass, over the drawn hulls, using the separating axis
theorem (exact for convex shapes, and a hull is convex). **The push direction is
wrong for the second shape.** Measured on two 100x400 squares overlapping by
20px in x, with nodes far enough apart that only the hull pass could act:

```
A pushed x: -15.0   correct, left
B pushed x: -20.0   WRONG, should be positive — both sets driven the same way
vertical leakage: 0.00   so the axis CHOICE is right, only its sign is wrong
```

The `flip` term in `hullOverlap` is the suspect. Fix that first, then:

- **There is no test for the hull pass.** The 565 passing tests say nothing
  about it. Write one that fails against the current code.
- **Cost is unmeasured.** The pass is O(sets²) in hull edges, which reasoning
  says is small next to the node pass — but that is reasoning, not a
  measurement. The node pass was 46% of a frame before bucketing, so measure.
- **Check the Venn still forms** after any change here. Sets sharing a member
  are exempt from separation on purpose; that exemption is what lets the
  overlap the user wants exist at all.

If the fix does not come out clean, `git revert ee59878` returns to a sound
state with problem 1 fixed at the physics level and only the rendering overlap
outstanding.

## The other open problems

### 2. Dragging a member extends the set the wrong way

Pulling one member towards the bottom-right stretched its set up-and-left as
well, sweeping over four foreign items and enclosing them.

`enclosingEllipse` grows each axis until every member fits. A diagonal drag puts
the outlier off both axes, so both grow — the boundary reaches sideways as well
as along the drag. Exclusion did not clear the swept items, either because the
boundary expanded faster than the force could move them, or because the push
direction (away from the centre of mass) points a deeply enclosed item *through*
more of the set.

Untouched this session. Note that the hull now bridges concavities, which may
change how this looks on screen without changing its cause.

### 3. Foreign items collect in the intersection

With one item deliberately shared between two sets, the lens also held three
items belonging to **neither**.

The likely mechanism, worth testing before fixing: in the overlap an item is
pushed by both sets at once, and the two pushes roughly cancel, leaving it
stranded exactly where the two boundaries cross.

**Possibly improved, unverified.** `forceSetExclusion` now reads the hull, so it
no longer silently fails to fire on a ring whose chain has reordered — which it
did before, because a ray cast over a crossed loop reports interior points as
outside. Whether that helps in practice was not measured.

### 4. A set can convulse until it pops

**The rendering half is fixed and the physics half is not.** The drawn outline
can no longer tear into spikes or lobes, because a hull cannot express them.
That is by construction, not by tuning.

But nothing was done to the underlying agitation, and it was never reproduced in
a harness matching the app. A calm-looking outline is now consistent with a ring
that is still thrashing underneath. Do not read "it looks fine" as "it is fixed".

## What was fixed this session

| Commit | What |
| --- | --- |
| `092f47a` | Draw and hit-test the hull, not the chain. Kills the tearing at the rendering layer |
| `7e03839` | Ease the outline across frames, and floor it at the members' own shape |
| `c576ae6` | Let `forceRingShape` cool when nothing is held — a settled scene was pumping itself apart |
| `5accc4d` | `forceSetSeparation`, so unrelated sets stop crossing |
| `ee59878` | **Broken.** Hull-level separation, wrong push direction |

Two findings worth carrying forward:

**A settled scene never settled.** `forceRingShape` floors its alpha so it never
cools, which is what keeps a ring with a dragged member — but d3 cools
everything else, so on a quiet scene it was the only force still injecting
velocity, driving icons through the ring nodes' collision and chasing them as
they moved. A set 10px tall stretched to 7495px over 4000 ticks. The floor is
now gated on something actually being held. Its default is `() => true`, the old
behaviour, so a caller that cannot see drag state keeps the floor rather than
silently losing it.

**The measured cost of the hull.** A set whose members form two distant clusters
draws as one blob, and a foreigner at the midpoint reads as inside. Two clusters
600px apart do this. If it shows on screen the answer is a hull per cluster —
which is what branch 3's notes say the user's sketch showed — not abandoning the
hull.

## Files

| File | What |
| --- | --- |
| `public/sets-model.js` | membership, inheritance, exclusions, tri-state matrix. Pure |
| `public/set-ring-model.js` | ring construction, hull, resampling, easing, member floor, spline, shape force, ejection, speed limit |
| `public/set-gravity-model.js` | set attraction, exclusion, and separation forces |
| `public/app/components/set-membership-mode.js` | the Ctrl+G picker |
| `public/app/workspace-commands.js` | `groupSelectionIntoSet`, `selectSets`, `deleteSelectedSets`, `shareSelectionWithSets` |
| `public/app/interactions/keyboard-controller.js` | the bindings above |
| `public/workspace-20260730b.js` | ring reconciliation, drawing, simulation wiring, hit testing |
| `public/styles/graph.css` | `.graph-set-outline` and its picking and retiring states |

## How this work is expected to be done

These are not general advice. Each one cost this branch real time.

- **Reproduce the gesture the user actually makes.** A drag is many small steps
  that pin `fx`/`fy` **and** `x`/`y` and reheat to 0.12 — not one large jump,
  and not `fx` alone. Three test harnesses were wrong this way, and one of them
  produced a completely wrong diagnosis that took a branch retirement to
  correct.
- **Use the constants the app ships.** `forceCollide` at strength 0.9, ring
  radius 30, link distance 60, charge −280 and 0 for ring nodes. A run at d3's
  defaults disagreed with the app and sent two investigations the wrong way.
- **Ablate before blaming.** The runaway looked exactly like a gravity fault.
  Leave-one-out showed removing *any* single force stopped it — the signature of
  a feedback loop, not of one force being wrong. Guessing would have "fixed"
  gravity and left the loop.
- **Do not tune your way out.** Both `minAlpha` and the speed cap behave
  non-monotonically: `minAlpha` 0.10 settles at 216 where 0.05 gives 1795. A
  threshold that works is working by luck. Find the mechanism.
- **Check the file on disk is the one being measured.** A `git checkout` once
  reverted a fix mid-investigation and the next measurement was of the old code.
- **Mutation-check every load-bearing rule**, and assert the mutation applied.
  These files are **CRLF**, and `sed`-style replacements silently fail against
  them, reporting "the fix is not load-bearing" when nothing changed. This
  session a patch also injected three **NUL bytes** into template literals; the
  code still worked, because a NUL is a consistent separator, which is exactly
  how it would have shipped unnoticed. Grep for `\x00` after scripted edits.
- **Write the test against a case that can fail.** A containment test passed
  with the feature disabled, because the proxy it replaced is sufficient in a
  small set — it took a large one to make the test mean anything.
- **Never let an error hide.** The worst bug here was a command that threw on
  every press, invisible because the caller used optional chaining and dropped
  the returned promise. A broken command and an unbound key looked identical.
  Route failures to the status bar.
- Comments explain *why*, not *what*.
- Do not merge or modify `main` without being asked.

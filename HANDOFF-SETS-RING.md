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
- Branch: `feat/sets-ring`, pushed. Base: `main` at `37542c9`.
- Head at handoff: `0f4bfa6`. **555 tests passing**, working tree clean.

Three earlier attempts are pushed as snapshots and should be read, not merged:

| Branch | What it was | Why it stopped |
| --- | --- | --- |
| `retired/1-item-sets-geometry` | sets as computed geometry | thin connector necks, concave bites, 87.8ms rebuilds |
| `retired/2-set-gravity` | sets as physics | right idea, wiring half-finished |
| `retired/3-sets-ring-tangle` | the ring, first pass | outline lagged behind dragged members |

`RING-LAG.md` on branch 3 records what was ruled out there by measurement, so it
does not have to be re-diagnosed. It also carries a correction worth reading:
its first diagnosis (that the ring tangles) was **wrong**, and came from
reproducing a drag as one large jump instead of many small steps.

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
carries error text.

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

**The outline is a ring of nodes in the simulation, not computed geometry.** A
closed chain of small invisible nodes, linked to their neighbours, subject to
the same charge and collision as the icons. What is drawn is a spline through
where those nodes ended up.

Four forces act, and all four are needed — this was measured, not assumed:

| Force | What it does |
| --- | --- |
| `forceRingShape` | holds each ring on the ellipse enclosing its own members |
| `forceSetGravity` | gathers a set's members towards their common centre |
| `forceSetExclusion` | pushes non-members out of a set they are inside |
| charge / collide / link | the graph's own layout, unchanged |

On a seven-member set reproduced from a real screenshot:

```
forces enabled     members inside their ring   foreign items inside
neither                    4/6                        2
exclusion only             3/6                        0
gravity only               4/6                        0
both                       6/6                        0
```

`forceSetGravity` existed on branch 2 with passing tests and had **never been
wired into the app**. That was why members sprawled and bystanders fell into
the gaps.

## THE OPEN PROBLEMS — start here

All four were seen live. They interact, and fixing them one force at a time has
repeatedly traded one for another.

### 1. Disjoint sets overlap for no reason

Two sets sharing no members settle with their outlines crossing, the lens
between them containing no icons at all.

Verified by inspection, and this part is certain: **no force acts between two
sets**, and ring nodes are given **zero charge** (`workspace-20260730b.js`, the
`charge` force). So one ring passes through another with nothing resisting.

Not reproduced in isolation — a symmetric two-set layout settles apart
correctly, so it needs the asymmetry of a real scene. Do not assume the cause
is the global centre pull without measuring it.

### 2. Dragging a member extends the set the wrong way

Pulling one member towards the bottom-right stretched its set up-and-left as
well, sweeping over four foreign items and enclosing them.

`enclosingEllipse` grows each axis until every member fits. A diagonal drag
puts the outlier off both axes, so both grow — the boundary reaches sideways as
well as along the drag. Exclusion did not clear the swept items, either because
the boundary expanded faster than the force could move them, or because the
push direction (away from the centre of mass) points a deeply enclosed item
*through* more of the set.

### 3. Foreign items collect in the intersection

With one item deliberately shared between two sets, the lens also held three
items belonging to **neither**.

The likely mechanism, worth testing before fixing: in the overlap an item is
pushed by both sets at once, and the two pushes roughly cancel, leaving it
stranded exactly where the two boundaries cross.

### 4. A set can convulse until it pops

Under heavy dragging the outline tears into angular spikes and lobes with a
pinched neck, and members escape through the tear.

The angular spikes are diagnostic: a smooth ring cannot produce them unless the
ring nodes have been flung apart faster than the links can pull them back. That
is a velocity blow-up.

`forceSpeedLimit` exists in `set-ring-model.js`, tested, and is **deliberately
not wired**. Every reproduction attempted for it either failed to reproduce the
explosion, or showed the cap making things *worse* (peak 14.4px capped against
7.8px uncapped). Read the commit message on `bda8229` before re-enabling it —
the honest state is that the convulsing is real but has never been reproduced
in a harness that matches the app.

## The direction the user wants

> "I'd like for it to come up with a way that no matter what happens, it
> retains its overall round shape, never trips over itself or looks like virus."
>
> "like a rendering trick after the fact, physics stay the same"

That is the right shape of fix, and it is much better than more force tuning:
**leave the physics alone and stop drawing a spline through a chain that can
knot itself.** Take the ring node positions as a point cloud and draw a
guaranteed-simple shape around them.

A convex hull of the ring nodes is the obvious candidate, and it is already
measured:

```
a deliberately spiky ring, 24 nodes, radii 60..280
  -> convex hull: 8 points, 0 self-intersections, all at radius 280
```

A hull cannot knot, by construction rather than by tuning. That kills problem 4
outright at the rendering layer, and it does it without touching a single
force.

**The cost, measured:** a pure convex hull is convex, so a set whose members
form two distant clusters becomes one blob. Two clusters 600px apart leave a
foreigner at the midpoint reading as inside. That trades problem 4 for a milder
version of problem 3, and is worth knowing before committing to it.

Worth considering: a concave hull / alpha shape, which follows the cloud more
closely while still being a simple closed curve; or a hull per cluster, giving
one set several round lobes, which is what branch 3's notes say the user's
sketch showed ("it can get as big as needed" is literally more nodes).

Whatever is chosen, the invariant to hold is: **the drawn outline is always a
simple closed curve, whatever the simulation does.**

## Files

| File | What |
| --- | --- |
| `public/sets-model.js` | membership, inheritance, exclusions, tri-state matrix. Pure |
| `public/set-ring-model.js` | ring construction, enclosing ellipse, spline, shape force, ejection, speed limit |
| `public/set-gravity-model.js` | set attraction and exclusion forces |
| `public/app/components/set-membership-mode.js` | the Ctrl+G picker |
| `public/app/workspace-commands.js` | `groupSelectionIntoSet`, `selectSets`, `deleteSelectedSets`, `shareSelectionWithSets` |
| `public/app/interactions/keyboard-controller.js` | the bindings above |
| `public/workspace-20260730b.js` | ring reconciliation, drawing, simulation wiring, hit testing |
| `public/styles/graph.css` | `.graph-set-outline` and its picking states |

## How this work is expected to be done

These are not general advice. Each one cost this branch real time.

- **Reproduce the gesture the user actually makes.** A drag is many small steps
  that pin `fx`/`fy` **and** `x`/`y` and reheat to 0.12 — not one large jump,
  and not `fx` alone. Three test harnesses were wrong this way, and one of them
  produced a completely wrong diagnosis that took a branch retirement to
  correct.
- **Use the constants the app ships.** `forceCollide` at strength 0.9, ring
  radius 30, link distance 60. A run at d3's defaults disagreed with the app and
  sent two investigations the wrong way.
- **Check the file on disk is the one being measured.** A `git checkout` once
  reverted a fix mid-investigation and the next measurement was of the old
  code.
- **Mutation-check every load-bearing rule**, and verify the mutation actually
  applied. Several `sed`-style replacements silently failed against CRLF line
  endings, reporting "the fix is not load-bearing" when nothing had changed.
  Prefer an editor that errors when the pattern does not match.
- **Write the test against a case that can fail.** A containment test passed
  with the feature disabled, because the proxy it replaced is sufficient in a
  small set — it took a large one to make the test mean anything.
- **Never let an error hide.** The worst bug here was a command that threw on
  every press, invisible because the caller used optional chaining and dropped
  the returned promise. A broken command and an unbound key looked identical.
  Route failures to the status bar.
- Comments explain *why*, not *what*.
- Do not merge or modify `main` without being asked.

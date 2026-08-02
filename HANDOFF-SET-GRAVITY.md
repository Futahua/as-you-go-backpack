# Handoff: sets as physics, not geometry

Branch `feat/set-gravity`, pushed to `Futahua/as-you-go-backpack`.
Base: `main` at `37542c9`. Head at handoff: `963ded0`.
**523 tests passing.** Working tree clean.

## The immediate blocker

**Pressing `G` with items selected does nothing in the real Papers app.**

One cause was found and fixed (`963ded0`): the command called `store.getState()`,
which the store does not expose — it is `getSnapshot`. Every press threw on the
first line, invisibly, because the keyboard handler used optional chaining and
dropped the returned promise.

**That fix did not resolve the symptom.** After reloading Papers, `G` still does
nothing. So there is at least one more break in the chain, and it has not been
found. What is verified:

- `groupSelectionIntoSet` is defined (`workspace-commands.js:79`), exported
  (`:463`), and injected at the call site (`workspace-20260730b.js:1506-1507`).
- The key binding exists (`keyboard-controller.js:45-53`), fires on plain `g`
  with no Ctrl/Alt, and requires `session.selected.size > 0`.
- Three unit tests drive the command against the real store and model and pass;
  reverting to `getState()` reddens two of them, so they do test the real path.
- Set outlines **do** render — the ring drawing works, confirmed on screen.

What has **not** been checked, in the order I would check it:

1. **Whether the running Papers loads this code at all.** It runs from
   `D:\Letters\MatTroiSeConMoc\PAPERS 3\Papers-3\release\win-unpacked\papers.exe`,
   a *built* copy. If the renderer is bundled rather than read from
   `public/` on disk, none of these edits are running and the rings on screen
   are from an older build. This is the single most likely explanation and
   should be ruled out first — add a `console.log` at the top of
   `workspace-20260730b.js` and see whether it appears in devtools.
2. **Whether the keydown handler receives the event.** The graph viewport may
   hold focus in a way that swallows it, or an early `return` in the handler
   may fire first. Log at the top of the keydown listener.
3. **Whether `session.selected` is populated** when the graph has a selection.
   The guard `session.selected.size > 0` silently skips otherwise.
4. **Whether `render()` re-reads `itemSets`** after a commit. If the set is
   created but nothing redraws, `G` would look like a no-op.

Do not assume the fix in `963ded0` was the whole problem. It was *a* bug, proven
by test, but the symptom survived it.

## What this branch is

A restart. The previous attempt (`feat/item-sets`, also pushed) treated a set as
a **shape**: sample an occupancy field, extract a contour, route connectors
between distant members, then constrain movement to respect the result. It does
not work, and the commit messages there record why in detail — thin connector
necks that pinch around bystanders, concave bites, geometry that changes
discontinuously with the sampling grid, and an 87.8ms rebuild for a two-set
scene.

This branch treats a set as **physics**. Two ideas, both the user's:

### Sets are centres of gravity (`public/set-gravity-model.js`)

Members are attracted to their set's centre of mass, so they gather on their
own. The centre is the members' own mean, so it moves with them.

Two behaviours fall out of the arithmetic rather than needing rules: a member of
several sets is pulled toward each centre and settles in the overlap (the Venn);
and a held member is exempt from the pull but still counts toward the centre, so
picking one up draws the others after it.

A rest radius stops it collapsing. Measured in isolation a three-member set
contracts to a spread of zero — charge and collision mask this in the real
graph, but a force that only behaves because something else props it up is not
worth having.

### The outline is a ring of nodes (`public/set-ring-model.js`)

**This is the key idea.** The boundary is not computed geometry. It is a closed
chain of small invisible nodes, linked to their neighbours, in the same
simulation as the icons, subject to the same charge and collision. What is drawn
is a spline through wherever those nodes ended up.

Everything the previous approach fought for is free here:

| Property | Why it holds |
| --- | --- |
| Closed | The chain loops |
| Smooth | Even link spacing, plus a spline through the nodes |
| Even thickness | The nodes are identical |
| Contains its members | Ring nodes collide with icons like anything else |

**Containment is not implemented anywhere.** A member cannot leave and an
outsider cannot get in for the same reason a node cannot walk through another
node. That is the whole point.

The user's sketch (four panels, "Imagine" vs "Actually") is the specification:
push a member in and the ring dents; pull one out and the ring stretches and
**spawns more links** — "it can get as big as needed" is literally more nodes;
two rings crossing is an overlap, with no special case.

## Performance

The obvious risk was putting hundreds of nodes into the simulation. Measured:

| Scene | Ring nodes | ms/tick |
| --- | --- | --- |
| 24 icons, 2 sets | 48 | 0.19 |
| 60 icons, 6 sets | 244 | 0.71 |
| 120 icons, 8 sets | 292 | 0.95 |

Under 6% of a frame budget at worst, against 87.8ms to rebuild a two-set scene
the old way. d3 approximates charge with Barnes-Hut, so it is O(n log n).

The node count only has to capture the *shape*, not the smoothness — a spline
hides the facets — so ring spacing went from 34 to 60, halving the count for the
same outline. Rendering a spline was rejected on the old branch because it would
disagree with the hit-tested polygon; here nothing is hit-tested against the
path, so there is no second opinion to disagree with.

## Force tuning

Ring nodes needed three adjustments to behave as a boundary rather than as more
icons, all in `ensureSimulation` in `workspace-20260730b.js`:

- **Zero charge.** Hundreds of nodes each repelling everything would swamp the
  layout the icons make between themselves.
- **Collision radius 18**, not the icons' half-width-plus-20, so neighbours pack
  shoulder to shoulder into a solid edge.
- **Short, stiff links** (distance 60, strength 0.9) where the graph's own links
  are long and slack (145, 0.14), because the boundary must hold its spacing
  against icons pushing on it.

If the shape needs adjusting once `G` works, these are the dials, plus
`padding` (40) and `strength` (0.35) in `forceRingShape`. They are constants in
known places — the difference from the old branch, where the failures were
architectural.

## Files

| File | What |
| --- | --- |
| `public/set-gravity-model.js` | Set attraction force. 8 tests. |
| `public/set-ring-model.js` | Ring construction, spline, shape force. 9 tests. |
| `public/sets-model.js` | Membership, inheritance, exclusions. Ported unchanged from `feat/item-sets`; it was the part that held up. |
| `public/app/components/set-membership-mode.js` | Ctrl+G picking mode. Ported, **not yet wired**. |
| `public/workspace-20260730b.js` | Ring reconciliation, drawing, simulation wiring. |
| `public/app/workspace-commands.js` | `groupSelectionIntoSet`. |
| `public/app/interactions/keyboard-controller.js` | The `G` binding. |
| `public/styles/graph.css` | `.graph-set-outline`. |

`canDropInsideRegions` and `droppableItems` came along in `sets-model.js` unused.
They are drag rules from the membrane design, which the ring makes unnecessary.
Delete them once the ring is confirmed working.

## Not built

- Ctrl+G membership picker (module ported, no binding)
- Set selection and deletion
- Per-set colour — every set currently uses the same green, which during testing
  made set fill and selection highlight indistinguishable and caused a
  misdiagnosis. Worth doing early for that reason alone.
- Any verification that the ring *feels* right. Nothing has been seen working,
  because `G` does not yet create a set.

## How this work is expected to be done

- Drive from measurement. Several wrong conclusions were drawn this session from
  reading screenshots — a selection highlight mistaken for a membrane, a zoom
  change mistaken for a moved node. Prefer computing a number over reading
  pixels.
- Mutation-check load-bearing rules: disable the rule, confirm the suite goes
  red, restore it. Two tests written this session initially passed with the
  feature broken.
- Do not let an error hide. The `G` bug survived because of optional chaining
  and a dropped promise, which together made a throw look like an unbound key.
- Comments explain *why*, not *what*.

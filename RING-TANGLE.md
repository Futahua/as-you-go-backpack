# Why this branch was retired: the ring tangles

Snapshot of the ring-as-physics build at the point where a live run in Papers
found a fault the unit tests could not. Everything here works except the
behaviour below. **533 tests pass**, which is exactly the problem — the tests
never move a member far enough or fast enough to trigger it.

## What was seen

`G` created a set and an outline drew around the member. Dragging that member
an inch left the ring behind: it detached, collapsed into a flat lens, and
stayed there. The user reported it "followed briefly, then stopped".

## What it actually is

Not lag, and not a tuning problem. **The ring turns itself inside out.**

Measured on a single-member set, ten ring nodes, angles measured around the
member:

```
settled      0  36  72 108 144 180 216 252 288 324     even, 36 deg apart
after drag 102  59  88 121 161 204 178 209 179 140     order destroyed
gaps       317  29  33  40  43 334  31 330 321 322     five backward jumps
```

A gap of 317 degrees between neighbours means the chain crosses itself. Drawn
as a spline, a self-crossing loop renders as the lens that appeared on screen.

Every node is still the right distance from the member — 82 to 117px against a
target radius of 91 — so the shape force is working. What fails is that nothing
preserves **angular order**. The links hold neighbours ~60px apart and the
shape force holds everyone ~91px from the centre, and a tangled ring satisfies
both constraints exactly as well as an untangled one. When the member jumps,
each node takes the shortest path to the new circle and slides past its
neighbours on the way.

The ring then reaches equilibrium in the wrong place and stops:

```
ticks   ring centre    lag from member
   30      326,-244        92
   60      338,-253        77
  120      343,-261        69
  240      344,-262        68
  480      344,-262        67     converged, permanently wrong
```

## What it is not

Ruled out by measurement, so as not to be re-diagnosed:

- **Not the alpha decay.** The `* alpha` in forceRingShape does weaken the
  force as the simulation cools, and flooring it improves the lag from 67 to
  45px — but the tangle survives, so it is a contributor and not the cause.
- **Not the links or the collision.** Removing either makes it *worse*: with
  both stripped the ring collapses to 20x26. They are holding the shape
  together, not fighting it.
- **Not a membership lookup failure.** `membersOnScreen` reads live node
  positions and resolves correctly throughout; the ring is being pulled towards
  the right circle the whole time.
- **Not the enclosing circle's size.** Links imply a radius of 95.5 against the
  shape force's 90.9. Real, but far too small to explain a 67px offset.

## Two candidate fixes

**A — carry the ring with its members.** Translate the ring nodes by the
members' centroid delta before the forces run each tick. The ring never has to
chase, so it cannot tangle. Cheap, and closer to the physical intuition: a
droplet moves with what is inside it rather than being dragged after it.

**B — an angular restoring force.** Pull each node towards its own slot angle,
derived from `ringIndex / ringCount`, both of which are already stored on the
node. Principled, and keeps spacing even under any disturbance, but it is
another force to balance against the existing three.

A first, B as a follow-up if slow drags still deform it.

## The other thing measured here

Containment is weaker than the architecture claims. "An outsider cannot get in
because ring nodes collide with icons like anything else" holds only for nodes
the simulation is free to move:

| Situation | Result |
| --- | --- |
| Ring encloses its own settled members | holds |
| Outsider pushed by a gentle force (0.001/tick) | held out |
| Outsider pushed firmly (0.01/tick) | breaches |
| Outsider **dragged** | passes straight through |

Dragging pins `fx`/`fy`, which sets position outright, so collision can shove
the ring aside but has nothing to push back against. Containment is resistance,
not prevention; anything needing a hard boundary must enforce it in the drag
code. Three tests in `set-ring-model.test.mjs` pin this, including the drag case
asserted *as* a failure so that making the ring impassable breaks the test and
forces this note to be rewritten.

## Cost, for reference

Well inside budget, and not a reason to change anything:

| Ring nodes | ms/tick | per node |
| --- | --- | --- |
| 158 | 0.29 | 1.84us |
| 692 | 1.67 | 2.41us |

692 ring nodes is 10.4% of a 16ms frame.

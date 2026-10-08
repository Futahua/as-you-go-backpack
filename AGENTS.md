# As you Go — governing document

Read this first and completely before working in this repository.

## Product north star

Papers is the creator's **personal programmable environment on an actual machine,
layered over Windows**. Its scope includes the machine's real files, installed
applications, native windows, devices, running processes, services and working state.
Actions must work with those real things and produce the intended result on the machine.

It keeps the best tools, applications, native machinery, agents, custom surfaces,
scripts and behaviors under the creator's fingers with minimal cognitive overhead.
Windows is the compatibility substrate for the software and machine the creator uses.
Electron, C#, Win32, Chromium, external programs, local services, agents and remote
systems are implementation choices; none defines or limits the product.

The creator describes the desired experience. Agents own architecture, implementation,
migration, testing and evidence. Internal implementation state must not become work
for the creator to manage.

The goal is maximum useful capability and excellent UX without growth making the
system progressively more brittle or expensive for agents to change.
**Capability is unbounded. Coupling is bounded.** Architecture preserves freedom.
Use the existing owner when it owns the truth; widen its contract when needed; create
another owner when the truth or lifecycle differs. Do not make unrelated systems own
new truth or sacrifice accepted behavior for architectural uniformity.

This vision is recorded in the opening of [the original north-star handoff](https://github.com/Futahua/Papers-3/blob/251aa0bf9e9ba3fe336b3354c3cd4b7f972af5c6/REFACTOR-HANDOFF.md).
Its dated paths, implementation plans and old runtime instructions are historical.

## Authority and working rules

This is this repository's single governing document. Current creator instructions
outrank it. Other documents supply technical reference, evidence, history or proposals;
they do not independently govern product direction or authorize work. Record accepted
corrections here rather than making several competing contracts.

- Preserve accepted behavior, creator data and unrelated changes. If recently working
  behavior regresses, compare history before inventing replacement architecture.
- Reuse existing trackers, services, applications and native behavior. Equivalent actions
  should converge on the same owner before identity, mutation and persistence.
- Keep failure local. A preview failure must not disable unrelated work or durable state.
- Inspect the actual source and running build; distinguish source tests from installed
  behavior. Use isolated fixtures and avoid taking the creator's mouse or keyboard.
- Honor authorization already given in the conversation. A document does not revoke it
  or require repeated permission. Publishing, installing, restarting or destructive work
  needs applicable authorization; ordinary inspection and reversible fixes can proceed.
- **Current cleanup scope (2026-10-07): documentation and comments first.** Reconcile
  stale or conflicting descriptions and clarify ownership. This cleanup does not authorize
  code rewrites, refactoring, behavior changes, deployment or publication. Historical
  refactor roadmaps are not the current assignment.

## What this Backpack is for

As you Go is the creator's machine-local workspace for organizing and invoking files,
links, folders, applications and windows through the canvas, navigator, embedded browser
and compact widget. Its authored names and arrangements are creator work. It is an
independent project, not a universal definition of what every Backpack must contain.

AYG owns its interface, document state, interaction policy and window-layout composition.
Papers owns generic host capabilities such as durable saves, native window/input control,
file operations and browser surfaces. Existing host operations are current contracts,
not permanent limits. When accepted UX needs more, evolve the correct owner rather than
inventing a second tracker, writer or authority. For host edits, also read Papers' AGENTS.md
in the actual Source checkout; do not depend on an obsolete hard-coded checkout path.

## Current interaction and data contracts

- AYG links reference real targets. Importing a link does not itself move the target.
  Explicit real-file moves/copies are supported. AYG link-to-real-folder movement updates
  the link only after successful movement; Opus real-file movement does not run AYG link
  retargeting. Prevent moving a folder into itself or its descendants.
- Navigator selections support batches, pills, breadcrumbs and folder drops. Accepted
  destination drops take priority over reorder. Live reorder previews follow the cursor
  without expanding a collapsed destination folder.
- Navigator RMB drag selects left of the origin (green) and deselects right (red), changing
  as the cursor crosses the origin. Plain RMB toggles folders, including breadcrumb folders;
  it does not clear selection. Plain RMB on a breadcrumb opens its same-level popup,
  where folder rows also expand/collapse on plain RMB. Double-click opens/runs. Marquee updates selection live and
  refreshes the preview once at completion.
- Saved pills are durable, deduplicated, and retain authored AYG names. Linked folders use
  the theme's blue tint and trailing < marker; file pills do not get folder markers.
  Earlier queued save acknowledgements must not replace newer additions. Navigator pills must wait for the durable document load before reading or migrating a browser cache; a loaded empty list is authoritative. Pill drops
  negotiate an effect allowed by the source; accepting a move-only drag pins the item
  without moving its underlying folder or file.
- Left navigator open disables canvas type-to-run. Right pane alone permits Quick Run in
  front of it. Preserve browser identity and accepted pane behavior across reopen/reboot.
- Chrome uses its existing personal profile and native interface. Its placement follows
  surrounding layout elements, independently of file previews. Keep the experiment's
  native host cut-out and recovery so Papers cannot cover or intercept Chrome.
  Chrome's native left edge controls the split; the surrounding layout follows it.
  Do not reset that edge from preview widths or add a competing drag strip.
- Snapshots use separate backup files and small list metadata, with date default names,
  rename and search. Restore requires the exact typed confirmation and a separate final
  confirmation, creates a safety backup, and retains the current snapshot list.
- The compact widget is a client of existing document and native owners. Alt+Q must remain
  usable on repeated summons, release Peek on dismissal, and activate the selected window
  in front while hiding the widget. Do not add cooldowns or widget-local durable writers.
- Preserve state.json and its durable preferences. Runtime identities, helper credentials,
  HWNDs, candidates and transient preview state are not authored document state.
- The right pane's pencil explicitly edits supported Writer/Calc files through the
  installed LibreOffice host; selecting a file still previews it. Save writes the
  original file. Collapse preserves the editor; leaving it preserves unsaved work
  in a normal LibreOffice window. Never discard edits on navigation or host teardown.
- Inline editors reuse the host's healthy runtime lifecycle across files. Their
  loading bar reflects provider-reported stage progress; engine startup and other
  stages without a measured total remain indeterminate. Stop status polling when
  the load finishes or is cancelled, and never show a previous file's progress.

## References and checks

- [README.md](README.md): project layout, commands and native source location.
- [ARCHITECTURE.md](ARCHITECTURE.md): module map and implementation evidence; dated
  diagnostic hypotheses are not current product instructions.
- [EYE-TEST-PROBLEMS.md](EYE-TEST-PROBLEMS.md): observed failures and acceptance gaps.
- Handoffs, refactor plans and progress files are historical/proposed work records.
- [docs/WORKER_WORKFLOW.md](docs/WORKER_WORKFLOW.md): optional historical procedure.

Serve public/; keep project.json, actions.json and state.json private. state.json is
creator data ignored by Git. Use the existing store and durable persistence queue.
Run focused checks for behavior changes and npm test for the integration checkpoint.
Docs-only changes require consistency/link checks, not runtime reload or host release.

Proxima embedded workspaces use Papers scope-bound writer leases, retain checked revisions, and map synthetic-root additions into the real project scope. Background window requests must have a bounded response through the verified embedded bridge.

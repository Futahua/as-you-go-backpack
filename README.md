# As you Go

This is the creator's machine-local “As you Go” Backpack project.

Its interface, prompt and prepared actions are owned here, outside the Papers application
binary and the Papers source repository. Ordinary changes to this project must not bump,
build or release Papers.

Only static interface files under `public/` are displayable. `project.json`, `actions.json`
and `state.json` remain private project control records. The explorer state belongs to this
project; Papers only provides the narrow persistence, target-picker and launch seam needed
for this explicitly requested local workflow.

Papers supplies only the demonstrated host seam:

- display this static project inside the Backpack;
- copy text after a project interaction;
- run an action already declared in `actions.json`;
- persist the As you Go explorer state in this project;
- choose and launch a local shortcut target through the host seam;
- return to Papers.

The As you Go workspace behaves like a file explorer: groups can nest, the current group
opens in the main pane, a dropdown/tree jumps directly to any group, and selected shortcuts
or groups can be moved or copied into another group. Shortcut descriptions and icon images
are project-owned presentation data; the external target itself is never copied or changed.

The local binding from the protected Backpack ID to this folder is stored in
`Papers/Data/PapersData/backpack-projects.json`. Do not modify the protected Backpack
record to establish or change that binding.

Before changing this project, read the canonical Papers repository's `AGENTS.md` and
`HERMES.md` completely. A change here applies only to “As you Go.”

Run `npm test` here after a change. The test is self-contained and does not launch any
prepared action or modify Papers data.

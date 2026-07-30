# As you Go

This is the creator's machine-local “As you Go” Backpack project.

Its interface, prompt and prepared actions are owned here, outside the Papers application
binary and the Papers source repository. Ordinary changes to this project must not bump,
build or release Papers.

Only static interface files under `public/` are displayable. `project.json` and
`actions.json` remain private main-process control records, so their absolute paths never
cross into the displayed project.

Papers supplies only the demonstrated host seam:

- display this static project inside the Backpack;
- copy text after a project interaction;
- run an action already declared in `actions.json`;
- return to Papers.

The local binding from the protected Backpack ID to this folder is stored in
`Papers/Data/PapersData/backpack-projects.json`. Do not modify the protected Backpack
record to establish or change that binding.

Before changing this project, read the canonical Papers repository's `AGENTS.md` and
`HERMES.md` completely. A change here applies only to “As you Go.”

Run `npm test` here after a change. The test is self-contained and does not launch any
prepared action or modify Papers data.

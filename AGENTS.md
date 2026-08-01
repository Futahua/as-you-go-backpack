Read `README.md`, then read `AGENTS.md` and `HERMES.md` completely in the canonical Papers
repository at `D:\Letters\MatTroiSeConMoc\PAPERS 3\Papers-3` before acting.

Before changing code, read `ARCHITECTURE.md` in this repository: it maps each change type
to the module that owns it and lists the interaction, store, host and compatibility rules
that keep this codebase from reverting to a monolith. New features belong in the named
modules, not back in the entry file.

This is the machine-local “As you Go” Backpack project. Modify it here; do not place its
name, ID, interface, prompt or action definitions into Papers' compiled source. Do not
release Papers for ordinary changes to this project.

The creator has explicitly authorized the As you Go explorer feature. Its tree model,
presentation, persistence shape and ordinary behavior belong here. Papers may carry only
the generic project-state, target-picker and shortcut-launch seam required to host it; do
not generalize that seam into a universal Backpack editor or file manager.

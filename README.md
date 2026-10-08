# As you Go

Read [AGENTS.md](AGENTS.md), this repository's single governing document.

This independent, machine-local Backpack supplies the creator's canvas, navigator,
file/browser panes and window-layout widget. [ARCHITECTURE.md](ARCHITECTURE.md) maps
implementation owners. Dated handoffs and plans record history, not new authorization.

## Project and runtime

public/ contains the served interface. project.json, actions.json and state.json are
private control/data records. state.json is local creator work and ignored by Git.
The Papers project binding associates the Backpack with this directory; do not rewrite
its identity to change that binding. Ordinary AYG changes do not release Papers.

The current static hosting and host bridge are implementation contracts that may evolve
for accepted UX. AYG owns composition and policy; Papers owns reusable native, browser,
file and persistence capabilities. Real-file operations and link creation are distinct.

## Verification

Run npm test for the project integration checkpoint; use focused tests while changing a
specific owner. Keep live creator data and physical desktop input out of synthetic tests.
Documentation-only changes need consistency and link checks.

## Native SlopTop bridge source

native/sloptop_engine.ahk backs up the AutoHotkey v2 engine. The creator's live copy is
D:\333\SlopTop\sloptop_engine.ahk. The repo copy is not an automatic installer or launcher.
For an authorized synchronization, compare SHA-256 hashes before restarting the live
process. Its cursor assets are relative to its live SlopTop directory.

## Refactor: modular workspace — Phases 0–5

Behavior-preserving refactor of the monolithic `workspace-20260730b.js` per the approved strangler-style plan. No user-visible behavior changes; all 184 tests pass.

### Phase 0 — test boundary repair

`test.mjs` pinned function names, code patterns, and variable names to the single entry file, which would break as responsibilities move into modules. Replaced implementation-coupled source assertions with genuine contract checks:

- manifest entry point and exact prepared actions
- actions targets resolve on this machine
- Content-Security-Policy forbids inline/remote scripts
- local-only script and stylesheet references
- accessibility landmarks and interactive surfaces in the HTML
- required host protocol names present anywhere under `public/`
- agent pickup prompt remains part of the interface

Host protocol checks scan the whole `public/` tree so they survive responsibility extraction.

### Phase 1 — infrastructure extraction

Each extraction is its own commit with its own tests, and the full suite runs green after every step.

| Module | Moved | Tests |
|---|---|---|
| `app/host/host-bridge.js` | `pending` map, `request()`, `papers:host:result` listener → named methods (`loadWorkspace`, `saveWorkspace`, `launchShortcut`, `revealShortcut`, `openWebLink`, `pickTarget`, `shortcutIcon`, `resolveWebIcon`, `resolveDroppedTargets`, `copyText`) | `host-bridge.test.mjs` (mock window) |
| `app/utilities/image-compression.js` | `readAsDataUrl`, `canvasBlob`, `compressIconFile` | — |
| `app/dom.js` | inline `elements` object → `getWorkspaceElements(document)` with fail-fast validation | `dom.test.mjs` |
| `app/components/toolbar-controller.js` | position math, restore, drag lifecycle, click suppression, resize handling → `createToolbarController` with `mount`/`destroy` and `AbortController` listeners | `toolbar-controller.test.mjs` |

### Conventions applied

- named exports, one responsibility per file
- components receive dependencies via injection (`getState`, `setState`, `persist`, `setStatus`) instead of reading shared globals
- event listeners registered with `AbortController.signal` for deterministic cleanup
- `workspace-20260730b.js` remains the compatibility entry (manifest/HTML unchanged)

### Review fixes (commits after initial push)

- **`83bbe3f` fix dropped-files payload**: the workspace now calls `host.resolveDroppedTargets(droppedFiles)` directly; the bridge already wraps the argument, so the host receives `{ files: droppedFiles }` instead of a double-wrapped `{ files: { files: droppedFiles } }`. Regression test asserts both the flat outbound payload and the returned `targets` array.
- **`2f27a60` toolbar lifecycle**: `destroy()` now clears the pending debounced resize timeout; tests expanded to cover mount position restore, drag persistence with clamping, sub-threshold no-op, resize re-apply, and destroy cleanup.
- **`4e09549` fix startup mount ordering**: Phase 2 mounted the context menu, editor, confirmation dialog, and Bin controls only after `host.loadWorkspace()` resolved — so a load failure rendered a fallback workspace with inert controls. Startup now runs through `app/bootstrap.js`: the behavior-only components mount synchronously, then state loads, then the toolbar mounts, and `render()` always runs. `bootstrap.test.mjs` proves the four components stay wired when loading rejects, the toolbar is skipped, and the success path restores state and mounts the toolbar.

### Phase 2 — dialogs and menus (approved)

Each of the four components is its own commit with its own tests; the suite runs green after every step.

| Component | Responsibility | Tests |
|---|---|---|
| `app/components/confirmation-dialog.js` | restore/delete confirmation, pending id lists, cancel/delete/restore wiring | `confirmation-dialog.test.mjs` |
| `app/components/context-menu.js` | menu button markup, open/close, blank/bin/selection content, click dispatch | `context-menu.test.mjs` |
| `app/components/editor-dialog.js` | editor session state, form/icon/target UI, save path, linked-shortcut fork decision | `editor-dialog.test.mjs` |
| `app/components/bin-controls.js` | Bin pill toggle + move-to-bin, Delete-all / Restore-all selective vs whole-Bin | `bin-controls.test.mjs` |

Each reads workspace state through injected getters and commits through the injected `commit()`, so none mutate shared state directly. All event listeners use `AbortController.signal`. The entry keeps thin `closeMenu`/`openMenu`/`showEditor` compatibility shims.

### Phase 3 — workspace store (in progress)

`d3ff40b` introduces `app/workspace-store.js`. All state mutations now funnel through the store, which owns the undo/redo stacks and the save queue:

- `commit()` — the single history-bearing mutation path: pushes history, runs a `prepare` hook (clear selection, fold navigation session into the saved view), installs the normalized state, runs `afterCommit` (close menu, render), persists, and reports status.
- `replace()` — non-historical view/position state (toolbar position, graph positions, icon size) without history or persistence.
- `install()` — installs loaded state; `save()` serializes and queues the host save.

`captureWorkspaceView` is now pure; `saveWorkspaceView`, reset-graph-position, graph-drag, and wheel writes all route through the store; `commit`/`undo`/`redo`/`persist` remain thin wrappers so call sites keep working. `workspace-store.test.mjs` covers commit/prepare/afterCommit, history push/clear, undo/redo restore, persist failure, replace-without-history, install normalization, and afterCommit ordering.

The remaining Phase 3 work — moving session state (`selected`, `currentId`, `binMode`, `binCurrentId`, `selectionAnchor`, `graphExpanded`, `clipboard`) into the store and separating document vs session explicitly — is being landed as separate reviewable increments.

### Session migration (Phase 3 step 2, complete)

- **`f6ca1f4` guardrails**: bootstrap no longer pre-normalizes loaded state (`store.install()` is the single normalizing install point); save-queue ordering and recovery tests added.
- **`5120617` increment 1 (`selected` + `selectionAnchor`)**: store session holds `selected` (a Set) and `selectionAnchor`; `commit()` clears `session.selected`; entry binds `const session = store.getSession()`.
- **`8600ecc` fix**: selection is cleared only after commit normalization succeeds (a throwing `normalizeState` preserves the selection). Deterministic queue-order and recovery tests.
- **`fd332b7` increment 2 (`currentId` + `binCurrentId` + `binMode`)**: seeded via `initialSession`; `captureWorkspaceViewFrom`/`restoreWorkspaceView` read/write the session; component injections (`getCurrentId`, `getBinMode`, `setBinMode`, `resetDrillDown`) route through it.
- **`fa3baa7` increment 3 (`graphExpanded`)**: expansion Set lives in the session; expand toggles and visibility reads route through it.
- **`70124ec` increment 4 (`clipboard`)**: copy/cut buffer lives in the session; paste and the context menu read it via `getClipboard`.

All seven session fields (`selected`, `selectionAnchor`, `currentId`, `binCurrentId`, `binMode`, `graphExpanded`, `clipboard`) are now owned by the store session, separating them from the persistent document state. No session state remains as entry-file module variables.

- **`5511fdb` explicit session operations**: the store exposes `setSelection`, `addToSelection`, `removeFromSelection`, `clearSelection`, `setSelectionAnchor`, `setNavigation`, `setGraphExpanded`, `toggleGraphExpanded`, `addToGraphExpanded`, `removeFromGraphExpanded`, and `setClipboard`. The entry routes every session mutation through them; `getSession()` remains for reads. The generic `updateSession` write is removed. Components invoke injected callbacks rather than touching `session` directly.

### Git safety

- Work performed in an isolated worktree on `refactor/modular-workspace`
- `main` branch untouched; the original checkout remains clean and usable
- no destructive git commands; no rewrites of existing commits
- baseline (100 tests) captured before editing; 184 tests now

## Phase 4 — command layer (complete)

`app/workspace-commands.js` is the seam between the store and the UI. Commands are named user-intent operations that coordinate document mutation, session mutation, history, rendering, and persistence — depending only on the store, model/host operations, and injected narrow effects, never on UI components or browser events.

API: `selectItem`, `activateItem`, `revealSelection`, `activateSelection`, `copySelection`, `cutSelection`, `pasteInto`, `moveSelectionToBin`, `resetGraphPositions`, `selectedPasteDestinations`, `undo`, `redo`.

Four increments, each with tests landing alongside:
- **`4698d6a`** `selectItem(itemId, { shiftKey, ctrlKey, visibleItemIds })` (plain input, no DOM event) + `undo`/`redo`
- **`611f669`** `activateItem` owning the folder-vs-shortcut / Bin-vs-explorer decision; `revealSelection`, `activateSelection`
- **`44f309d`** `copySelection`/`cutSelection`/`pasteInto`/`moveSelectionToBin`/`selectedPasteDestinations`; `store.commit(next)` without success-message args. Renamed the `copySelection` model parameter to avoid the hoisted command method shadowing it.
- **`456f710`** `resetGraphPositions`; `runMenuAction` is now a thin action map (dialog-opening stays in the entry per the no-UI-dependency constraint).

## Phase 5 — interaction controllers (in progress)

Controllers translate DOM events into plain command inputs only — no document/session mutation, persistence, or host calls inside.

- **`9da43e5`** TDZ fix: command layer constructed after `graph` and `closeMenu`; startup-composition smoke test added.
- **`bf82eb3`** keyboard controller: `app/interactions/keyboard-controller.js` moved the document keydown handler (Escape, Ctrl+A, copy/cut/paste, undo/redo, Delete, Enter, Ctrl+Enter) onto the commands, mounted synchronously via bootstrap. Added `clearSelection` and `selectAllVisible` commands.

### Next steps

Remaining Phase 5 increments: marquee controller, drop controller, remaining pointer/interaction coordination; then Phase 6 (CSS split). Each step is independently testable and reviewable.

# As you Go — architecture and change guide

This is the machine-local “As you Go” Backpack project. It is a modular, vanilla-JavaScript
app served as static files from `public/` inside the Papers host. Read `README.md` for
ownership, data and behavior; read this file before changing the code so new work lands in
the right module and preserves the interaction behavior.

## Module map

The entry file `public/workspace-20260730b.js` is a thin composition root. It wires modules
together and keeps the tiny amount of glue that has nowhere else to live. Everything with a
clear responsibility lives in a module.

| Change type | Correct location |
|---|---|
| Keyboard, pointer, marquee, drop events | `public/app/interactions/` |
| Dialogs, menus, toolbar, Bin controls | `public/app/components/` |
| User-intent operations and host coordination | `public/app/workspace-commands.js` |
| Session, history, persistence queue | `public/app/workspace-store.js` |
| Data transformations and invariants | `public/workspace-model-20260730b.js` |
| Papers messaging | `public/app/host/host-bridge.js` |
| Startup and synchronous mounting | `public/app/bootstrap.js` |
| Styling | the matching file under `public/styles/` |
| Compatibility composition | `public/workspace-20260730b.js` |

## Prompt library (copy button)

The prompt library is a nested tree of prompts and folders persisted in
`view.promptLibrary`. It is split across four modules plus one pure model:

| Responsibility | Module |
|---|---|
| Pure tree data (normalize/migrate, create/find/update/remove, single and atomic multi-node move, batch inclusion via folder `includeAll`, explicit Copy Selected, validation) | `public/prompt-library-model.js` |
| Pure temporary row-selection logic (select/toggle/range/visible order/collapse repair; no DOM/store/host) | `public/app/components/prompt-tree-selection.js` |
| Tree DOM interaction → plain intents (clicks, keyboard, drag, context-menu requests; selection state; no host/persistence) | `public/app/components/prompt-tree-controller.js` |
| Prompt-tree context menu (rendering, keyboard nav, dismissal, action intents) | `public/app/components/prompt-tree-context-menu.js` |
| Panel composition root (open/close, draft tree, expansion/editor/rename/delete-confirm, rendering, Save/Cancel) | `public/app/components/prompt-library-dialog.js` |

Rules: the dialog clones the saved library into a `draftLibrary` and owns
persistence via `setPromptLibrary` + `store.replace/save`; the controller and
context menu never call the host or persist state; the toolbar copier keeps
selected-shortcut precedence and reads the saved snapshot through
`getSnapshotLibrary()`/`getBatchText()`. Folder checkboxes persist an
`includeAll` override (never a derived tri-state) and checking a folder never
rewrites descendant prompt checkboxes.

## Interaction controllers

Controllers live in `public/app/interactions/` and own browser events for one gesture
family: `keyboard-controller.js`, `pointer-controller.js` (graph drag + marquee + the
double-click listener), `marquee-controller.js`, `drop-controller.js`.

Controllers may read the DOM and the event, but they must not mutate document/session state
and must not call the host. They translate an event into plain command inputs and call
`commands`.

## Command layer

`public/app/workspace-commands.js` owns every user-intent operation: activation, reveal,
copy/cut/paste, moving to the Bin, graph reset, drag outcomes, drops. Commands receive
plain values (IDs, placement maps, destination IDs, position maps, modifier booleans) —
never a raw browser event.

Commands are the only layer that coordinates host calls, document mutation, session
mutation, history, rendering and persistence for a user action. The entry's menu map
(`runMenuAction`) delegates to commands; editor and confirmation dialogs stay in the entry
wiring and call `commit`.

## Store

`public/app/workspace-store.js` owns session state, undo/redo history and the save queue.
The store exposes explicit operations; components and controllers never assign to
`session.*` directly.

- Persistent document changes that belong in history: `store.commit(nextState)`.
- Non-history view/position changes (toolbar position, graph positions, icon size):
  the appropriate store operation or `store.replace(...)`.
- Session writes: `setSelection`, `addToSelection`, `removeFromSelection`, `clearSelection`,
  `setSelectionAnchor`, `setNavigation`, `setGraphExpanded`, `toggleGraphExpanded`,
  `addToGraphExpanded`, `removeFromGraphExpanded`, `setClipboard`.

## Host bridge

`public/app/host/host-bridge.js` is the only place that talks to Papers over
`postMessage`. It owns the pending-request map and the response listener, and exposes named
methods (`loadWorkspace`, `saveWorkspace`, `launchShortcut`, `revealShortcut`, `openWebLink`,
`pickTarget`, `shortcutIcon`, `resolveWebIcon`, `resolveDroppedTargets`, `copyText`). No
other module should post a Papers message directly.

## Bootstrap

`public/app/bootstrap.js` mounts the behavior-only components (context menu, editor,
confirmation dialog, Bin controls, keyboard, drop, pointer controllers) synchronously so the
fallback workspace stays interactive even when host loading fails. The toolbar mounts only
after state is restored because it immediately re-applies saved positions.

## Styling

`public/workspace-20260730b.css` is an `@import` aggregator over `public/styles/`: tokens,
base, workspace, toolbar, items, graph, context-menu, dialogs, utilities, responsive. Put a
rule in the file that owns its category; do not rename selectors or custom properties that
the interaction code depends on.

## Compatibility contracts

These are stable and must not change casually:

- `project.json` `backpackId` and `entry` (`public/workspace-20260730b.html`).
- Serialized state fields in `state.json` (`schemaVersion`, `groups`, `shortcuts`, `view`).
- The dated compatibility filenames: `public/workspace-20260730b.html`,
  `public/workspace-20260730b.js`, `public/workspace-20260730b.css`.
- The host protocol messages sent by `host-bridge.js` (e.g. `papers:project:as-you-go-load`,
  `as-you-go-save`, `as-you-go-launch`, `as-you-go-reveal`, `open-web-link`).

## Required checks before finishing a change

- Every changed interaction needs a behavioral unit test in the matching `*.test.mjs` (not a
  source-text regex).
- Run `npm test` after a change; it is self-contained and never launches a prepared action.
- After interaction changes, run a short browser smoke test in Papers covering: group
  double-click navigation, file/app double-click launch, web-link open, directory
  double-click reveal, keyboard Enter, drag, marquee, external drop, Bin restore/delete,
  and the failed-load fallback staying interactive.

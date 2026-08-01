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
| Pure dialog-local undo/redo (past/present/future, edit transactions, limit; no DOM/store/host) | `public/app/components/prompt-library-history.js` |
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

Batch checkboxes support two bulk gestures, each one undo entry, and neither
ever changes row selection (the tree controller ignores `.prompt-checkbox`
clicks entirely, so they cannot collide with Shift+click row ranges):

- Clicking the checkbox of a row **inside** a multi-row selection forces every
  selected row to the clicked value — checking and unchecking alike. Clicking a
  row outside the selection touches only that row and leaves the selection
  intact.
- **Shift+click** applies the clicked box's resulting state to the visible range
  between the last-clicked checkbox and this one. `change` does not carry
  `shiftKey`, so the modifier is captured on the preceding `click`.

While `#prompt-layer` is open, the workspace keyboard controller is inert; the
prompt-tree controller owns tree shortcuts (Ctrl/C/X/V are dialog-local
copy/cut/paste via `treeClipboard` — never the OS clipboard or `copyText`,
which is reserved for prompt double-click and "Copy prompt text"). Feedback
for modal actions uses the local `#prompt-status`, not the workspace status.
New prompt / New folder are permanent header buttons; New prompt inserts
inside the selected folder only when exactly one folder row is selected,
otherwise at root. Ctrl/Meta+Z/Y/Shift+Z drive a dialog-local undo/redo on the
draft (never the workspace store history); each completed data mutation is one
entry, a focused editing session is one transaction, and editable controls keep
native text editing. The tree root is a first-class paste destination: blank
tree space (or the root context menu) targets the root while the internal
clipboard is preserved, and dragging below the last top-level row moves nodes
to root.

Three invariants keep the tree usable in a real browser, each covered by tests
that dispatch bubbling events from the actually-focused element:

- **Keyboard scope is the modal, not the row list.** The controller takes a
  `keyboardTarget` (`#prompt-layer`) for `keydown` while pointer listeners stay
  on the viewport. Tree shortcuts therefore work from New prompt/New folder,
  Save/Cancel and the status line — anywhere non-editable. `isEditableTarget()`
  still excludes inputs, textareas and contenteditable, which never get
  `preventDefault()`, so native text undo/redo survives.
- **Focus is explicit.** Setting `tabindex` does not move focus, so selection
  calls `row.focus({ preventScroll: true })` and root targeting focuses
  `#prompt-tree-viewport`. Opening the dialog focuses the root surface rather
  than leaving `document.body` active.
- **One destination, never a drift-prone boolean.** `activeDestination` is
  `{ type: 'root' | 'node', nodeId }`, updated from a single
  `controller.setSelection()` path that always notifies `onSelectionChange` —
  pointer-driven and programmatic alike. `resolvePasteDestination()` reads it
  and falls back to root when the node no longer exists, so paste can never
  target a row that undo or delete removed.

`#prompt-tree-viewport` owns scrolling and the blank `.prompt-root-surface`
below the last row, so clicking, right-clicking, or dropping in empty space is
a real root gesture. There is no persisted root node.

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

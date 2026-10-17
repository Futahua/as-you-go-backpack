# As you Go — governing document

Relocation repair, 2026-10-10: normal Files-pane AYG drags move exact link placements or folders through the existing durable store. Alt-drag exports a local file through Windows' native drag loop; do not cancel ordinary internal drags for that export. Navigator folder drops use the tree's exact placement identity and model cycle checks, independently of the canvas's ancestor/shared-link policy. Cross-page pane drops explicitly finish their transfer overlay by ticket, even if moving the source removes its dragend event. Native group acquisition selects the intended member first and then restores the original tab order.

Read this first and completely before working in this repository.

Web-link preview acceptance, 2026-10-11: the independent follow Preview receives web selections alongside the existing native Chrome route. It uses Papers' ephemeral browser-open/move/close owner and existing persist:papers-web-browser profile; no durable legacy browser tabs or new profile are created. Collapse, transient overlays, suspension, selection replacement and disposal release the preview view while retaining profile storage. Serialized preview loads discard stale results before opening the latest selection. Native Chrome keeps its personal profile and opening behavior.

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

- Main workspace composition: the left pane stays open and substitutes graph for list
  while retaining search, breadcrumbs and actions. Workspace actions live in that pane;
  graph appearance controls appear only in graph mode. Preview is independent of native
  window tabs, with left/right half surfaces or a full-height middle column. Pinned file
  previews are document tabs. Persist these preferences per workspace scope. Proxima
  uses the scoped left composition and a separate sticky native-window surface beside
  the scrolling project; the right surface remains visible above the workspace fold.

Preview placement is changed by dragging its header into a pane half or middle column,
using a translucent split cue. Cancelled or unarmed drops never change saved placement.

Only the dedicated Preview grip docks/splits it. Shared preview edges resize its saved
height or middle-column width; they never relocate native window tabs from the right pane.

Pinned preview tabs can be dragged to reorder within the strip or into a split preview
surface. Validate local saved preview identities on drop; never send preview IDs to
native application-window detach/reorder operations. Proxima relays through its sidecar.

Pane composition now resolves native size constraints in the pure `public/app/pane-layout-model.js`. Authored topology/ratios and explicit minimized state are durable; stacking and temporary neighbor minimization are presentation only. Reserve the strip height above a native window when satisfying its minimum height. Native placement observations cannot become authored resize intent. Saved slice membership arriving before preferences is reconciled after preferences load. Preview resize keeps the native surface presented. The Papers host serializes native geometry transactions and composes cut-outs across Backpack groups.

Each additional numbered window group now has an X. Removing a split merges its native tabs and pinned previews into a retained group; the final group remains. Closing the primary group retains the main identity by promoting its neighbor. Group removal rolls back its presentation preferences if native placement fails. The isolated Electron fixture exercises the X control; pure tests cover nested and primary group removal.

Creator-directed single-pane restoration, 2026-10-08: numbered native window groups are disabled; workspace composition uses the existing single native tab strip and the Papers pane engine from commit 561de29. Proxima likewise keeps one native right pane. Independent preview placement, compact preview controls and pinned document tabs are retained. Saved windowSlices preferences are left intact but dormant; no creator data is rewritten to remove them. Backup: D:\CodexTemp\pane-single-split-backup-20261008-2345. AYG suite 1983 passed, hidden composition fixture verifies no numbered window slices are installed.


Creator-directed single-pane restoration, 2026-10-09: the attempted independent multi-group rebuild was rejected. Restore the accepted single native controller and original divider/geometry path in both AYG and Proxima. Keep the corrected pin button styling, reorderable pinned document tabs and native owned-dialog stacking/focus handling. No numbered native window groups are installed; saved split preferences remain dormant. Do not reactivate multi-group layout without a new creator request.

Creator acceptance and integration, 2026-10-09: the isolated native coordinator experiment was accepted and committed in Papers as `07091d9`; the creator requested its integration. This supersedes the preceding single-group prohibition for that coordinator. `coordinated-window-slices.js` presents native snapshots and sends explicit select/reorder/move/split/merge/document-edge commands plus one root viewport. It must not infer native per-group fitting, minimum sizes or ratios. Start with one group; add numbered groups by dragging a native/document tab onto a pane edge. Both adjoining native edges author shared boundaries; preview edge handles use the same native owner. Independent Preview docking remains local. Existing `window-slices.js` rendering stays dormant when the coordinator mounts; legacy fallback is only for hosts lacking the capability. Native checkpoints own local topology and retained HWND identities; document paths and pills remain in the existing checked Backpack store. Proxima uses this renderer in its sticky sidecar, suspends before teardown, and retains independent native membership from AYG.

Pinned preview follow-up, 2026-10-09: coordinated document panels expand only while selected and presented, and collapse their hosted sessions when inactive. Keep the compact directory/control strip above content. PDF panels identify their group surface to the existing Papers preview host, so pinned and ordinary PDF viewers can coexist. The legacy root grab edge remains two pixels inside native content, below picker chrome, with pointer events disabled while coordinated; native borders and document split edges are the resize authorities. Integration checks inspect visible text, decoded images and simultaneous live PDF viewer frames, rather than only tab membership.
Whole-group grip acceptance, 2026-10-09: file toolbar owns the shared Lens camera control; native group headers use a draggable grip instead of Lens and omit group numbers. Center drop swaps groups, edge drop resplits the entire group through native relocate-group; the overlay describes that action. Never simulate this as per-tab transfers or author group geometry in the renderer.

Page persistence acceptance, 2026-10-09: each durable Papers page and AYG root owns independent pane preferences. Legacy root preferences migrate once into the designated old page. Native snapshots carry preview references when a group/tab transfers between pages; preserve their paths and opaque IDs. Picker rows distinguish Remove here, In use elsewhere and Add; selecting In use reveals its owner, and explicit Move here transfers. Drag overlays yield native content across windows until the drop completes; await the current revision before issuing layout mutations. Dormant application tabs remain compact, can resume supported URLs or be replaced from the picker. Papers persists unclosed pages and reunites them in one window on reload, never saves window arrangement as page identity.


Drag feedback and hosted pages, 2026-10-10: lightly tint the destination group's whole tab-strip backdrop while a tab will join it. Failed moves pulse the source red with a decaying 400ms shake/fade and leave geometry unchanged; Escape cancels silently. Files tabs use muted yellow and follow Preview purple. Other Backpack pages can join AYG native groups through Papers' existing logical-page owner, retain their renderer while inactive, and split/reorder like document tabs. Refuse AYG's own page and recursive containment. Hosted-page tab X removes its group membership, not the logical page. Proxima retains its blue time-pill appearance. Papers owns PageKey persistence and closure cleanup; AYG must not copy Backpack document state or create another durable writer.

Protected-panel remount correction, 2026-10-10: native ensure-panels establishes the initial Files/Preview layout only once. Renderer startup requires exactly one document reference for each protected panel; mixed membership, inactive selection, minimization and maximization remain valid authored layouts. Do not reapply the initial solo/visible requirement on restart. Regression checks must await renderer readiness and visible group controls, not just native recovered membership.

Read-only command launchers never participate in document writer election or create the startup widget. Ordinary pages own and forward durable edits through the elected editing page. Former Proxima folders are ordinary AYG folders; only an actual current scope root remains protected from binning.

Web-link interaction correction, 2026-10-11: selecting a web entry updates only follow Preview. The preview pin commits that link through the existing native Chrome opening owner; existing entry double-click launch behavior remains. Reuse the ephemeral Chromium view across web selections rather than closing it for each render. Collapse, non-web selection, overlays and teardown still release it. No saved browser-tab list or additional profile is introduced.

Shared-seam column drops, 2026-10-11: dragging a whole native group to either outer endpoint of the horizontal seam between aligned stacked groups targets their column. The cue spans both panes and labels New column; ordinary pane edges retain their existing leaf split and center swap behavior. Papers owns the subtree split and minimum-size checks; AYG sends column-l/column-r intent without authored geometry. Creator authorization covers local installation and restart for these fixes.

Offset span target acceptance, 2026-10-11: whole-group grips show small targets near the midpoint of each contiguous edge span. Conflicting midpoints fan inward, with shorter spans nearest the edge. Horizontal rows and vertical columns use the same gesture. The native preflight supplies the exact translucent cue rectangle; release commits only an armed, current preview. Snapshot changes recheck the stationary hover and invalidate stale cues. Selection, pane/tab identity, resizing and persistence remain with the native owner. All six spans in a three-band edge and both real direct/embedded drag routes are covered. Local install/restart remains creator-authorized.

Creator-directed settings entry, 2026-10-11: the existing copy-prompt toolbar placement is now a gear opening the existing Settings controls inside Files. Reuse the prompt/settings preference owner and durable save path; closing restores the unchanged file view. Other prompt-library entrances retain their existing behavior.

Icon assets, 2026-10-11: AYG stores authored image payloads under public/icons/<SHA-256>.<extension> and persists ./icons/ references. Its save adapter externalizes snapshots and their coordination bases before the existing elected writer/CAS owner, using Papers verified immutable image writes. Failed writes retain the original JSON. Files snapshots include and verify icons; restore restores missing immutable assets. Keep assets when removing links: snapshots and undo may still reference them. Moving or exporting AYG must carry state.json and public/icons together. Never move only state.json or garbage-collect assets solely from the current state.

Creator-directed dead-window replacement, 2026-10-12: Shift-drag a live window onto a dormant native tab, or onto its selected pane, to replace that slot. External windows bind through the existing pane-window-replace/reconnect owner; retained transfers move successfully before removing only the dormant placeholder. Keep pane topology, independent page/document tabs and ordinary unmodified drag behavior. The drop cue names the replacement. Save before refreshing a live AYG renderer; a failed coordination flush leaves it open.
Creator-directed transfer UI, 2026-10-14: phone lens is replaced by Download selection, not a broad toolbar restyle. Phone destination is an explicitly chosen writable Android folder, edited from the device popup or the clickable destination name. Preserve recursive folder structure, verified bytes, pause/resume and keep-both filenames. PC local copy/move and device downloads show compact progress indicators; do not invent byte counts or reissue operations to obtain progress. See Papers docs/FILE_TRANSFER_INDICATORS_EVIDENCE.md for deployed evidence and verification limits.

Creator clarification, 2026-10-14: clicking a device name in the PC Devices popup immediately creates only a Files tab in the existing native group. It never switches the current Files view or embeds another workspace composition. Name the tab explicitly for its owner, e.g. LapDog · Files. The containing page owns Preview and native pane composition; the device tab must not mount another coordinator, Preview panel or native-window area. Remote file selection updates the containing Preview through checked page membership. Preserve phone behavior.


Creator-directed bidirectional files and history, 2026-10-15: dragging or pasting a file from a device into real storage copies its bytes through the existing host transfer owner. Pasting into another device's AYG copies into its chosen inbox/download folder before durable linking; ordinary same-workspace AYG placement copies remain links. Android shared-root paths must retain their owning device on PC drag/clipboard export. Cross-device cut/paste keeps originals. Consume a cut marker only after confirmed persistence/real-file movement, preserving newer clipboard records and failed cuts. Back/Forward uses one bounded visit trail across AYG and native folders/devices; Android's shell retains that trail across its existing device layers. No parallel clipboard, transfer controls, or workspace-composition owner is introduced.

File-backed entries, 2026-10-15: retain owner-issued fileTarget bindings in existing shortcuts and saved pills. Reconcile through the existing durable writer and resolve before file effects. Confirmed deletion bins placements; unavailable/missing/replacement never auto-bins. Creator correction, 2026-10-16: ordinary AYG trash removes only representations without confirmation. A compact red skull directly beside trash explicitly recycles selected disk targets and removes their representations without confirmation. Resolve placement IDs as well as shortcut IDs, skip virtual items, retain entries on owner refusal, and reuse the existing checked file owner. Pill X only unpins. Preserve placement IDs and artwork on moves. See docs/FILE_TARGET_IMPLEMENTATION_EVIDENCE.md for verified installations and observation/cross-volume limits.


Remote owner authority correction, 2026-10-16: device panes follow the physical owner's saved document. Background file identity reconciliation runs on the owner, not replicas. Rejected remote snapshots are retired, owner state is installed, failed actions are reported, and refresh remains active; never freeze remote views offering Keep my version. Reuse the existing coordinator and checked writer. Remote default artwork comes from the owning device's bounded thumbnail/app-icon service; authored icons retain precedence. Shared A -> B receipt/content reuse remains an isolated experiment, not a deployed new transfer owner. See docs/REMOTE_OWNER_REFRESH_EVIDENCE.md and docs/TRANSFER_RECORD_MODEL_EXPERIMENT.md.

Creator clarification, 2026-10-16: cross-device byte movement is file transfer, not directory synchronization. Research mature resumable engines before extending bespoke recovery rules. A deliberate remote-file editing assignment keeps the original device as file owner and chooses one working-copy device whose saved changes write back to that original. Any authorized paired device may request assignment or stop; owner acknowledgement determines the effective state. Preserve unsent working copies and prevent revoked assignments from publishing delayed uploads. Reuse Papers' existing checked edit/transfer owners, with status rendered consistently by AYG. Research and proposed behavior are recorded in docs/FILE_TRANSFER_ENGINE_RESEARCH_20261016.md; this entry does not claim implementation or installation.


Transfer/edit implementation, 2026-10-16: official tus server/client libraries now own resumable bytes on Windows and Android. Keep existing pairing, scoped file access, checked publication, AYG linking and edit journals as their owners. Assignment/stop serializes at the original file owner; saves carry assignment generation and checked source version. Stop preserves unsent working copies. Chokidar and the phone foreground peer service drive successive checked saves. Do not replace this with directory synchronization or timestamp-based winner selection. See Papers docs/TRANSFER_EDITING_IMPLEMENTATION_20261016.md for actual tests, deployment evidence and limits; earlier model experiments remain separate.

Editing picker correction, 2026-10-16: authorization grants include headless verification clients and must not be presented as machines. Intersect editing grant names with the existing device-menu owner/connections and retain the owner's grant IDs for assignment. Do not revoke credentials or delete pairings merely to clean the picker. The modal is appended to body, so style its buttons explicitly instead of relying on navigator-descendant button CSS. Both PC public assets updated and flushed surfaces refreshed; 41 focused tests pass.

Editing mark follow-up, 2026-10-16: marking prepares without opening apps. The yellow pen acts on all selected regular files; a single common destination skips the picker, active assignments are reused, and per-file failures remain visible. Owner-confirmed stop now authorizes deleting that working copy and its owned sidecars/snapshots, superseding the earlier retain-unsent-on-stop instruction for this explicit unlink action. Preserve originals and unknown offline state. New copies use original filenames under Papers/Working files and retain exact original disk metadata and folder structure. Retained offline neighbours are dim; local editable entries remain opaque. Remote Reveal navigates the pane to the native containing folder. See Papers docs/EDITING_MARKS_WORKING_FILES_20261016.md.

Inline filters, 2026-10-17: replace the Sort & filter popup with editors in the Name, Size, Type and Modified strip. Right-click or touch-hold a heading; ordinary clicks retain sorting. Size and Modified expose paired From/Through inputs. Validate before applying, show compact active parameters, preserve drafts during background refresh, and retain reset and hidden-file visibility through toolbar controls. Keep filtering with the existing view-options owner. The creator explicitly requires installation and verification without controlling their mouse. Current delivery and activation limits are recorded in docs/INLINE_FILTERS_20261017.md.

Folder/remote pane correction, 2026-10-17: skull expands selected virtual AYG folders through active nested placements, confirms their disk targets, deduplicates effects, and bins the folder only after owner success. Empty virtual folders remain eligible. Undo/Redo includes files hidden under binned ancestors. Ctrl+A selects rendered pane entries or graph nodes while excluding ancestors, protected roots, hidden filters and text inputs. Remote Files graph surfaces own a clipped containing block so their canvas cannot cover controls. Android shared-root paths use the paired owner's device-path resolver rather than a Windows-only predicate. Install/reload by code; never inject mouse or keyboard input. See docs/FOLDER_GRAPH_PHONE_FIXES_20261017.md.

Native address navigation, 2026-10-17: remote Android shared-root paths render individual clickable breadcrumbs. Both AYG and native modes retain a blank address target; click/tap selects the full current native address, Enter navigates through the pane host, Escape/blur cancels. Folder navigation reuses its successful listing instead of stat followed by another listing. Typed files select their containing-folder entry without launching. Remote address entry rejects explicitly different owners. Concurrent identity reads share only an in-flight verification; later actions always reverify. No mouse/keyboard automation. See docs/NATIVE_ADDRESS_20261017.md for evidence and limits.

Verified folder shortcut browse, 2026-10-17: optional fresh entry metadata from the original owner's target resolution feeds the same authenticated browse operation directly for two seconds. This bypasses ancestor enumeration for verified linked folders without changing checked mutations or other owners' fallback. Full suite 2105 passed plus pretests. Installed reported-folder list timings across six cache-expired samples were 127–200 ms; real-host isolated navigator first rows 122 ms. See Papers docs/USB_FOLDER_LATENCY_20261017.md.

Remote Files empty drop-area correction, 2026-10-17: the remote graph-capable navigator is a flex column, so its list body must flex to consume the remaining pane height even when empty. The missing device-only rule collapsed empty LapDog receiving bodies to 35px and left the visible blank space outside the drop listener. Added the same flex/min-height/position contract as the existing local pane. Live body grew from 35px to 340px (second pane 322px), and blank-area hit testing returned the receiving body. Applied to running panes via exact CSS insertion; durable public CSS updated on both PCs. Remote owner IDs were already correct. No upload was initiated merely for verification.

Launcher identity correction, 2026-10-17: transient launchers invoke only persisted shortcut IDs through the existing launch-shortcut channel. The main Backpack project owner verifies a bound fileTarget through the existing local target registry immediately before opening, and refuses unavailable/replaced identities. Full project surfaces retain their ordinary checked file-effect wrapper. Do not grant launchers broad file-capability access to solve this regression. The launcher displays action status/errors inline. See docs/LAUNCHER_IDENTITY_20261017.md.

Optional Proxima blob templates, 2026-10-17: creator-approved new blob workspaces use imported independent managed copies and are intended to replicate offline across three devices through Proxima's existing causal rules and Papers' transfers. Only blob/template binding changes enter Proxima undo; edits inside the new blob workspace have no undo/redo and rely on a replicated recoverable Bin. Preserve standalone AYG's existing history. The opt-in embedded surface `papers-embedded-surface=proxima-blob` with a valid scope disables history through the existing workspace store; it does not implement file replication. Incoming sync retains original action provenance and applies through the checked local writer. An optional future server is a durable relay/replica, not a new edit authority.

Proxima blob folders, 2026-10-17: the embedded `papers-blob-workspace` surface opens the synced root at its `as-you-go-folder`. There, Tree view starts at the open folder with breadcrumbs back to the root (treeFollowsFolder), the trash is hidden and every route to the Bin kills (killOnly), which only moves entries to the kill bin. The kill bin's Empty button sits in the navigator toolbar, and the skull empties it while in the Bin; emptying is what recycles files. Holding (mouse or touch) or right-clicking the skull opens the Bin and never also kills. Standalone AYG keeps its trash, skull and root-based Tree view unchanged.

# File-backed AYG entries: identity, movement, and deletion

Research and implementation proposal, 2026-10-15. Requested scope: SlopTop, LapDog, and Poordroid; native file views and AYG, accessed locally or remotely. This document proposes changes; it does not claim implementation or authorize a deployment.

## Intended behavior

An AYG “dummy” is a representation of a real file or directory. Its current path is an address, not its identity. Moving or renaming the disk target should preserve the AYG entry, placements, custom icon, authored label, and organization. Confirmed disk deletion should remove its live representations. Deleting a representation should offer an explicit choice about the real target.

| Action | Result |
| --- | --- |
| Rename/move a disk file within supported storage, including through Opus/Explorer/Android Files | Existing AYG entry follows the target; no replacement entry or duplicate |
| Move/rename a real parent directory | Linked descendants resolve at their new locations; virtual AYG organization stays put |
| Delete/recycle the actual disk target | Remove the file-backed representation from active AYG views and pills; retain recovery metadata in AYG's existing Bin/history |
| Remove an AYG placement with “Also delete from device” off | Remove only that placement using existing AYG semantics; keep the disk target and other placements |
| Remove with “Also delete from device” on | Recycle the real target on its owner, then reconcile all representations of that target |
| Remove a saved pill with its X | Unpin only; this is not the disk-delete control |
| Device offline, drive disconnected, revoked access, incomplete scan | Keep entries with an unavailable/checking state; do not infer deletion |
| Explicit copy/download/upload | A distinct destination file and target identity; no implicit mirroring or deletion of its source |

Proposed deletion UI: one compact delete sheet, showing the real owning device, filename/location, selected count, and “Also delete files from [device]”. Default off, with an explicit remember-choice option scoped to the owner/device. A mixed-device batch names every owner and reports per-item results. Native views inherently act on real files, so they show “Delete from [device]”; the representation-only choice applies to AYG entries. Existing generic folders, notes, URLs, and app/window entries keep their own behavior.

## What the current code actually does

- AYG `public/app/navigator-file-transfer.js` observes the old path disappearing and the expected new path appearing after an AYG-requested move, then requests retargeting. It does not establish that arbitrary external moves are followed.
- `public/workspace-20260730b.js`, `retargetMovedFiles`, updates shortcut `target` strings through the existing durable writer. `public/app/navigator-saved-states.js` retargets saved navigation paths. These are integration points to retain, not parallel state stores to replace.
- `public/app/workspace-commands.js`, `moveSelectionToBin` and `dragDropToBin`, currently perform AYG model/bin mutations. File-backed deletion needs a common operation above these entry points; adding an isolated phone button would leave other routes inconsistent.
- Papers `src/main/backpacks/remoteFileResources.ts` derives remote resource IDs from share/path and resolves the stored path. Its version hash includes metadata and is an optimistic concurrency token, not a durable identity that follows a move.
- Papers `remoteFileMutations.ts` already owns checked, journaled remote operations. Extend its receipts rather than introduce a second remote mutation queue.
- Android `PhoneIndex.java` already has SQLite/WAL, retained directory observers, dirty-directory refresh, periodic reconciliation, and guarded pruning. Its table primary key is currently the path, and its external-storage URI is built from volume plus relative path. Reuse this owner and evolve its identity model.
- Android `PhonePeerServer.java` already has mutation jobs, copy/verify/move logic, and a `.PapersRecycle` path for deletion. A phone “move” can currently be copy-and-remove, so assuming that every AYG move preserves an inode would already be incorrect.

Read-only environment check: SlopTop C: and D: are NTFS; running Everything reports 1.4.1.1032. LapDog's Everything/provider capabilities and the phone's actual storage identity behavior still require probes. No live files were moved or deleted for this research.

## Identity and ownership

Use two different identities, with separate jobs:

1. **AYG item/placement IDs** remain the existing authored identities. They own layout, custom labels/icons, and membership.
2. **File target reference** is an owner-issued persistent opaque ID, addressed as `(deviceId, targetId)`. The owner maps it to native identity, current locator, aliases, observation revision, and lifecycle state.

Proposed persistent fields on a file-backed record: target reference plus a last-known display cache. Keep legacy `target` during migration for compatibility, but resolve the target reference before opening, previewing, revealing, copying, moving, changing its icon, or deleting. Never fall back to deleting the stale cached path. Keep physical IDs, filesystem cursors, credentials, and access grants in the owner-local registry, not AYG documents. Serialize large native IDs as strings/bytes, never JavaScript numbers.

Papers owns generic file identity/resolution and filesystem operations. AYG owns authored entries and their reconciliation through its current revision-checked writer. Poordroid's existing phone storage/index/peer owners provide the Android implementation. Extend the current remote gateway with target resolution and changes; remote clients do not run another filesystem tracker for someone else's disk. One tracked target may have many placements without duplicating the underlying record.

## Windows backend

Use volume identity plus the full file ID acquired through `GetFileInformationByHandleEx(FileIdInfo)`. Microsoft defines the combined volume serial and 128-bit ID as an identifier for a file on a computer. Test `OpenFileById` plus final-path resolution for local supported volumes, so a saved target can be found after a same-volume move while AYG was closed. Preserve delete/read/write sharing and use short-lived handles; tracking must not keep files locked. [FILE_ID_INFO](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_id_info), [OpenFileById](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-openfilebyid).

Use directory notifications as fast invalidation hints, followed by identity checks. Do not interpret a missing watcher message as proof that nothing changed: Windows documents overflow and enumeration recovery. Track moved parent directories as well as targets. Add a persisted USN cursor where the filesystem and available privileges support it; journal gaps/reset require reconciliation before advancing deletion state. Do not require running all of Papers elevated. [ReadDirectoryChangesW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-readdirectorychangesw), [change journal records](https://learn.microsoft.com/en-us/windows/win32/fileio/change-journal-records).

Keep a registry of referenced targets, not another whole-disk search index. Reuse Everything for bounded candidate lookup and validate candidates against native identity. The documented Everything CLI journal is a 1.5 feature, so it cannot be a baseline dependency on the observed 1.4 installation. Capability-test an optional adapter before choosing to use it; never silently upgrade Everything as part of this feature. Search misses are not deletion evidence. [Everything SDK](https://www.voidtools.com/en-us/support/everything/sdk/), [CLI journal options](https://www.voidtools.com/support/everything/command_line_interface/).

Shell shortcuts/distributed link tracking are worth a bounded spike for recovery hints, particularly NTFS shell moves, but are not the universal identity format. Their documented scope concerns shell/OLE links on NTFS, and does not provide Android support or a general copy-delete identity contract. [Microsoft distributed link tracking](https://learn.microsoft.com/en-us/windows/win32/fileio/distributed-link-tracking-and-object-identifiers).

## Android backend

Extend `PhoneIndex` rather than add another crawler/database. Assign target UUIDs to tracked files and store the current path/URI separately. Evaluate `Os.stat` device/inode observations on this phone's shared-storage layer, including reboot, parent move, SD/USB remount, and copy-delete operations. Treat inode observations as scoped evidence until persistence and reuse behavior are measured; do not assume emulated storage behaves like an ordinary desktop filesystem. [Android StructStat](https://developer.android.com/reference/android/system/StructStat).

Retain existing directory observers and reconciliation. Android supplies moved-from/to, delete, and self-move events, but `FileObserver` does not supply an application-wide durable change history. Existing dirty-directory handling and complete readable scans remain necessary after suspension/restart; bound watchers and background work rather than poll the whole phone continuously. [FileObserver](https://developer.android.com/reference/android/os/FileObserver).

For SAF/provider-only documents, keep authority/document URI and returned replacement URI. The API explicitly permits rename to return a new document URI and invalidates the original in that case; persisted permission alone is not a universal move-following guarantee. MediaStore generations can assist indexed media reconciliation, but are not the identity engine for every folder and document. [DocumentsContract](https://developer.android.com/reference/android/provider/DocumentsContract), [persistent-access limitations](https://developer.android.com/training/data-storage/shared/documents-files), [MediaStore](https://developer.android.com/reference/android/provider/MediaStore).

The supported scope is storage actually accessible to Papers. Even all-files access excludes other apps' private directories. A move into inaccessible storage becomes unavailable, not deleted. [Android all-files access](https://developer.android.com/training/data-storage/manage-all-files).

## Moves, replacements, and deletion evidence

There is no universal OS identity that survives every arbitrary cross-volume or cross-device copy-and-delete. AYG/Papers-initiated moves can preserve the logical target reference by recording the verified source-to-destination receipt, even when the physical ID changes. Cross-device moves must not silently redirect other clients' destructive authority: retain an explicit relocation receipt/new owner reference and refresh authorization. Ordinary transfers remain copies unless the user explicitly chooses move.

For external cross-volume moves, offer recovery candidates using bounded metadata/content checks and user confirmation when needed. Identical bytes, name, and size cannot distinguish an intentional copy from a move; never merge or redirect two files merely because their hashes match. Same-volume external movement should be automatic where native identities resolve; unsupported/ambiguous cases must remain visible for repair rather than silently bind the wrong file.

Handle save-by-replacement separately from deletion. Many editors replace the disk object while preserving the logical document location. Coalesce those events, recognize known operation receipts, and apply a tested replacement policy. A naked physical-ID change must not cause the document's AYG entry to disappear during ordinary saves. Ambiguous replacement remains unresolved instead of auto-deleting or rebinding solely by filename.

Distinguish `present`, `resolving`, `offline`, `permission-denied`, `outside-share`, `missing-unconfirmed`, and `deleted-confirmed`. Only the owner can issue the last state. Proof can be a completed checked delete/recycle receipt, or a trustworthy deletion observation plus identity/location reconciliation. A missing old path, a timeout, an empty search page, or two failed stats is insufficient. An unobserved move cannot always be distinguished from deletion; report that limitation rather than invent certainty.

Windows hard links and filesystem symlinks/junctions require explicit alias policy. Keep a preferred directory entry plus known aliases; removing one hard link must not falsely report that the remaining file object disappeared. Deleting a symlink/junction must never recursively delete its target. Protect volume roots and existing shared roots. Directory deletion affects file-backed descendants; it must not cascade through an AYG virtual grouping and delete unrelated linked files.

## Remote propagation and consistent commands

Extend existing paired-device transport with `resolve targets`, paged changes with an owner epoch/cursor, and checked mutation receipts. Keep durable target references distinct from session resource IDs/access capabilities. A reference does not grant access. Revalidate current share boundaries, permissions, owner, target identity, and expected version on every mutation. If a target moves outside a remote share, conceal its new location from unauthorized clients and report unavailable/outside-share.

Route phone/PC, AYG/native, toolbar/keyboard/context menu/drag-to-bin through the same owner operation. Recycle on the actual device, never on the viewing device. Reuse Windows' existing recycle provider and Android's existing recycle/job path; check their current recovery and quota behavior. Do not silently substitute permanent deletion if recycling fails.

For delete-with-disk enabled: persist a command ID and expected target revision; resolve/recheck; recycle once; persist its receipt and target tombstone; then commit AYG reconciliation through the elected document writer. If that final save fails, retry the metadata update, not the disk deletion. Mixed batches report partial outcomes. Offline real deletion is visibly pending or refused, not silently queued to execute later without revalidation. Disk deletion removes all corresponding live placements/pills when their documents reconnect/load; deleting one representation without disk deletion does not remove other placements.

Maintain owner epochs, monotonic revisions, and recoverable tombstones so duplicate/out-of-order events, stale clients, and restored snapshots cannot resurrect deleted live targets. On reconnection or cursor gaps, batch-resolve referenced targets before applying removals. Unopened workspaces reconcile on their next authoritative load; don't create a second background AYG document writer.

## Delivery sequence and acceptance gates

1. **Capability spike:** isolated fixtures on both PCs and the actual phone. Measure same-volume rename, parent move, restart, provider rename, copy-delete, replacement saves, and deletion/recycle. Record installed Everything capabilities and ordinary-user ID/journal access. No creator-file experiments. This gates the strongest guarantees, especially Android external moves.
2. **Target references and migration:** enroll new imports first, then bind existing reachable paths lazily/batched through the current writer. Preserve item IDs and custom data. Existing missing paths become unresolved; no bulk pruning. Preserve a recoverable schema migration and compatibility with older clients.
3. **Follow moves and replacements:** read-only observations first; update resolution, names, previews, reveal, pills, and navigation history. Auto display names follow disk rename; explicit authored labels/icons remain authored. Verify no duplicate entries or stale caches.
4. **Confirmed disk-deletion reconciliation:** enable removal only after observing the required identity/evidence cases. Apply through the existing Bin/store with recovery records.
5. **Optional disk deletion:** add the compact toggle, checked owner operations, recovery receipts, and consistent batch feedback across every route.
6. **Cross-device rollout:** deploy compatible host/gateway/phone/UI versions together, preserving old clients' representation-only behavior. Validate each owner from every other device before enabling destructive controls.

Acceptance matrix covers all nine viewer-to-owner combinations (three local and six remote), both native and AYG entry points, and files plus native folders. Include same-folder rename; parent move; external Opus/Explorer/Android Files move; move while Papers is closed; cross-volume/cross-device copy versus move; repeated import and multiple placements; atomic save; recycled then restored file; filename reused by a different file; offline owner/drive; permission loss; move outside share; watcher overflow/journal gap; hard links and junctions; crash after disk success before document save; double-clicked/retried commands; mixed batch partial failure; stale snapshot restore. Verify actual file identity, contents, owner recycle receipt, persisted AYG state after restart, and no unrelated deletion.

Performance gates: baseline idle CPU/battery, watcher count, registry size, reconciliation latency, event bursts, and reconnect cost measured on the three actual devices. Set numeric budgets from the capability spike rather than inventing battery or latency guarantees. Hash content only for checked transfers or bounded recovery, not on every repaint or periodic whole-disk scan.

Implementation update, 2026-10-15: see [delivered behavior, installation evidence and limits](FILE_TARGET_IMPLEMENTATION_EVIDENCE.md). This research document retains proposed follow-up behavior; it is not an assertion that every proposal was shipped.


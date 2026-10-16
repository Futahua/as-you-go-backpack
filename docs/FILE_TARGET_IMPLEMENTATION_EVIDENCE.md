# File-backed AYG implementation and installed evidence — 2026-10-15

Implemented for SlopTop, LapDog and Poordroid, using the existing local/remote file capability route and AYG durable writer. This records the delivered subset of FILE_TARGET_IDENTITY_PLAN.md; proposed features in that research document are not automatically implemented.

## Delivered behavior

- AYG shortcuts and saved pills retain an owner-issued target ID in their existing document. The physical device owns identity and current-path resolution; paths are no longer the sole binding.
- Windows uses volume/file IDs plus NTFS object IDs for supported atomic replacements. Android uses device/inode identity and the existing PhoneIndex observer/census, with a separate small reference registry to avoid blocking its search-index database writer.
- Same-volume moves/renames and parent moves preserve the representation, placements and custom artwork. Existing labels follow the filename only when they were the default filename.
- Resolve before file effects and periodically reconcile through the existing AYG writer. New entries enroll before saving; existing entries enroll gradually. Concurrent document changes during enrollment are refused instead of overwritten.
- Confirmed disk deletion bins live AYG placements and removes saved pills. Offline, missing, inaccessible and replacement results never trigger speculative deletion.
- AYG deletion uses the existing compact confirmation with an explicit, initially unchecked disk-recycle choice. Checked deletion verifies owner target ID and revision immediately before recycling, and records command receipts. Pill X remains unpin-only.
- Relink unresolved entries explicitly through the editor. Copy/download/upload creates a separate physical identity. No folder mirror or duplicate AYG store was introduced.

## Installed verification

Windows supported installer on both PCs, after verified recovery copies of App, profile and registered Backpack roots. Six AYG public files updated; authored state was not replaced. Existing page keys reopened.

- Installer SHA-256: 8883dd0714170bf1630325ecd23616399b904b2e3760abad249c619ea9fddc29
- Installed app.asar SHA-256, independently checked on both PCs: 1b50d836ad16dca6abb5ac892633ec16aae7298789e53f37a393536e71fa1d77
- Both running PC hosts: temporary fixture tracked, externally renamed, resolved, externally deleted, and recreated at the old name without rebinding the deleted reference. No authored entry was added for this test.
- SlopTop client -> LapDog owner: remote tracking and resolution followed an external owner-side rename through the authenticated gateway.
- Debugger script inventory confirms file-targets.js loaded in both installed PC AYG pages. Custom-scheme resources are absent from Performance resource entries; the runtime fixture's earlier trackingModuleLoaded:false was a measurement limitation, corrected by Debugger.scriptParsed verification.
- Final Android APK installed and MainActivity reopened. Its AYG iframe loaded file-targets.js. Authored AYG state bytes were unchanged by installation (604528 bytes; SHA-256 0d9019723b6a71cdb163ef4be3a82de56c8c1bf148d30357f7e83505dc430fd3).
- Android physical-device instrumentation: 16 checks, including file/parent moves, distinct copies, observed deletion, filename reuse, reference-mismatch refusal and checked recycling with retained bytes.
- AYG full suite: 2078 passing; additional file-target module suite: 5 passing. Host related suites: 59 passing. Final registry/gateway suites: 4 passing, including real Windows move, ReplaceFile, observed deletion and name reuse.

Evidence logs/recovery:
- SlopTop: D:\Programs\evTEMP\file-target-install-20261015 (verified manifests, recovery, runtime-check.json and remote-check-*.json).
- LapDog: C:\Users\admin\Documents\Papers-Updates\file-targets-20261015 (same installer/public-file manifests, recovery and runtime-check.json).
- Phone state recovery: D:\Programs\evTEMP\file-target-phone-recovery-20261015.
- Test logs: D:\Programs\evTEMP\file-target-{full-ayg-tests,broader-host-tests,host-tests-final,phone-checks}.log.

## Explicit limits

- No privileged Windows journal service was installed. The normal-user Windows process cannot read the tested volume journal. Deletion missed while the app is closed remains unresolved rather than automatically removing the representation; an observed deletion or a confirmed Papers operation is required.
- Arbitrary external cross-volume copy-then-delete is not provably the same file. Papers operations provide verified move receipts; otherwise explicit relink may be necessary. Content similarity is never authority to recycle or silently bind another file.
- Android provider identity and atomic replacement are not universally stable; ambiguous replacement remains unresolved. Android background scheduling can delay observation.
- Recycle recovery bytes and AYG Bin metadata are preserved, but restoring a deleted target does not automatically resurrect every AYG placement.
- Actual installed checks above are evidence for the named routes, not a claim that every local/remote nine-way combination was manually exercised.

## Creator correction delivered, 2026-10-16

The checkbox/delete confirmation is superseded by an explicit compact red skull immediately beside the trash icon. Ordinary AYG trash is representation-only and does not confirm. The skull immediately recycles actual selected file/folder targets through the existing checked owner, then bins their representations. Virtual groups are skipped; failed owner operations retain their entries. Placement IDs resolve to their shared shortcut record. Native-view skull uses the existing real-file deletion route without a confirmation.

Verified red skull adjacency and rendered RGB(240,91,96) on installed SlopTop and LapDog Files panes and the updated physical Android AYG iframe. Android APK installed successfully after its save barrier. Full AYG suite: 2081 passed; focused identity/command/navigator suite: 105 passed. SlopTop's existing conflicted LapDog Files pane refused its save barrier and was preserved open without refresh; other safe panes were refreshed. Recovery and verified public-file manifest: D:\Programs\evTEMP\phone-pc-drag-20261015\skull and C:\Users\admin\Documents\Papers-Updates\skull-20261016. Source tests/log: D:\Programs\evTEMP\skull-full-tests.log.


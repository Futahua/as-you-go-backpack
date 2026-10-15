# Download feedback follow-up — 2026-10-14

Continued after Claude session 99a06f29-3f97-42c6-8cfd-d6c0d754f058. Preserves its compact Downloads panel, batch remote deletion, shared clipboard and Shift export.

- Device-only Files panes lacked `.workspace-left-actions .native-window-lens`, so their Downloads control never mounted. They now mount the same control in `.workspace-navigator-toolbar`.
- Download receipts are linked with `requireDurable:true`; false acknowledgements remain visibly failed. Retry link uses the existing verified copy, without a second download.
- Pending link work is scoped by logical page/root. Compact widgets and command overlays do not instantiate an import controller. Unknown historical link status is labelled Downloaded, never falsely Downloaded and linked.
- Remote close skips a new view-position write, waits for the edit queue, and tolerates only the exact automatic not-writer refusal. Real edit errors and I/O errors remain close barriers.

Validation: full AYG suite 2,045 passed before the final toolbar fallback; focused controller/close checks passed afterward, including the added no-camera toolbar regression. Actual installed local and device Files pages on SlopTop and LapDog report a 26px Downloads control and the corrected close hook. Desktop has three visible restored windows; laptop restored one. No App binaries or Android APK changed. Installed files compared ignoring CRLF and backed up in download-hardening-backup-20261014 and download-toolbar-backup-20261014 under each machine's task scratch area. Desktop inbox remains D:\sort.

During the second desktop restart a remote Files page correctly refused closure because of a previous Host request capacity reached save error. Its existing store save was retried through its writer/CAS owner, returned ok:true, and its flush then passed. No force close or blanket error suppression was used. This is recovery evidence, not a fix or load test for general host request saturation.

No new real-file transfer was performed in this follow-up. Download/link failure and retry coverage uses deterministic controller tests and the actual workspace store. Earlier Claude installed-transfer evidence remains separate.

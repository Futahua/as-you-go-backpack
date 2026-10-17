# Folder skull, selection and remote navigation

17 October 2026. Selected virtual AYG folders now enumerate active nested disk-backed links for the existing Kill confirmation. Unique backing paths are recycled through their existing checked owners. Cancellation performs no deletion; owner failure keeps the selected folder. Undo/Redo detects entries hidden by ancestor binning. Native file identity tracking also recognizes Android paths qualified by the existing device owner.

Navigator Ctrl+A uses rendered rows in list/thumbnail mode and rendered graph nodes in graph mode; protected roots, ancestors and zero-size hidden entries are excluded. Text inputs retain native select-all behaviour.

Files-only remote pages lacked the full workspace's graph containing-block styles. Their absolute explorer could extend over the toolbar. Files-only graph slots now establish and clip their own bounds. Isolated Electron fixture `D:/Programs/evTEMP/ayg-device-graph-fixture.cjs` confirms positive graph size, containment below the toolbar, and toolbar hit testing even with a high-z-index graph descendant.

The remote phone document exposes owner shared roots such as `Internal storage`. The navigator now recognizes `host.deviceFilePath(path)` alongside Windows absolute paths, preserving the existing owner conversion and browse service. A live read-only probe on the installed app confirmed stat and list success for the circled authored folder and Downloads. It did not change creator navigation or data.

Checks: full AYG suite 2,103 passed plus pretests; focused owner/history/selection/phone tests passed. Six public assets were backed up, installed and SHA-256 checked on SlopTop and LapDog. Backup directories: SlopTop `D:/Programs/evTEMP/folder-graph-backup-20261017`, LapDog `C:/Users/admin/Documents/Papers-Updates/folder-graph-20261017`. Both PCs reloaded through their existing registered `host:app:reload` handler and completed shutdown before new process startup. The same-key APK was rebuilt and installed with `adb install -r` after the phone save barrier. No mouse or keyboard automation and no real creator-file deletion were used for acceptance.

This is a renderer update. The separately built USB desktop transport update still awaits its own host installation and live acceptance.

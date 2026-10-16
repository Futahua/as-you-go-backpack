# Remote owner refresh and icon repair — 2026-10-16

The reported LapDog Files replica had stopped after a STALE_REVISION response from a background metadata save. Its coordinator deliberately refused subsequent owner refresh while in conflict, leaving a one-entry historical view beside the owner's five live entries.

Delivered repair:
- The physical owner's document is authoritative for device panes. Remote panes no longer run background binding reconciliation or write identity metadata during pre-effect checks; the owning workspace handles this.
- Owner-side background identity saves use the existing automatic-save metadata and bounded rebase path.
- Remote coordinators opt into ownerAuthoritative. A rejected stale save invalidates its dependent queued generation, clears pending overlays, reads and installs the physical owner's document, reports that the rejected change was not applied, and stays refreshable. It does not offer Keep my version or reapply the rejected document. Existing local/scoped coordinator policy is unchanged.
- The existing two-second owner refresh continues after rejection and after temporary disconnection. Selection/navigation handling remains in the existing install/store owner.
- PC remote icon requests now use the owner's bounded thumbnail endpoint, falling back on that owner's installed application icon when no thumbnail exists. Remote AYG icon lookup resolves both shared record IDs and placement IDs. Authored artwork retains precedence. Remote thumbnail/graph paths share these existing owners; no full file download is needed for icons.

Validation:
- Full AYG integration suite before the final remote icon bridge correction: 2084 pass. Focused final coordinator/device/icon suites: 92 pass. Final full-suite log: D:\Programs\evTEMP\remote-freshness-final-full-ayg.log.
- Typecheck passed. Host provider/path/client suites: 13 pass; final owner-thumbnail/provider paths: 10 pass.
- Live installed SlopTop -> LapDog: a temporary, unique owner-side fixture was saved through checked authority; it appeared in the real remote DOM without manual reload. A deliberately stale request was refused; the owner document was installed, no conflict was entered, and subsequent updates continued. The fixture was removed with a fresh checked write, preserving concurrent owner state. Evidence: D:\Programs\evTEMP\remote-freshness-install-20261016\live-convergence.json.
- Final rendered remote tiles: Word (40px owner image), SketchUp and both CAD files (256px owner images), plus the virtual folder. Conflict false. Cache-bypassing page refresh was necessary to pick up the final remote icon bridge module.
- Supported Windows installer installed and verified on both PCs; saved page keys reopened. Final installed app.asar: 2b8e4d2f5e6ca14258d0ee049cd9a2026fb2a8cf6b28591c2ebfefadb2351b42. Installer: f420c93124906c5c51ce47d25e272c86f223310ac71c58a0c2e9881ab74cd749.
- Android signed APK installed after its existing frame save barriers; final APK includes the remote icon bridge correction. These are shared phone/PC client code paths; not every possible nine-way local/remote combination was manually tested.
- Recovery: D:\Programs\evTEMP\remote-freshness-install-20261016 and C:\Users\admin\Documents\Papers-Updates\freshness-20261016. Public file recovery/manifests: D:\Programs\evTEMP\phone-pc-drag-20261015\freshness and matching LapDog stage.
- SlopTop's previous close path retained stale replica save errors and timed out. After the creator explicitly confirmed no pending work and replicas reloaded saved authority, the old main process was ended after normal close requests; the installer verified all retained profile/Backpack bytes. Native application processes were not terminated.

The separately requested shared transfer record/content reuse idea is an isolated experiment, not this shipped repair. See TRANSFER_RECORD_MODEL_EXPERIMENT.md for 11 passing model cases and the production gaps found.

Final integration checkpoint including the remote icon bridge test: 2085 tests passed, zero failures.


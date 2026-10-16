# File transfer and deliberate remote editing

Research date: 16 October 2026. The sections below record the original evaluation and contract. Implementation now embeds official tus engines and extends the existing checked edit owners; see Papers `docs/TRANSFER_EDITING_IMPLEMENTATION_20261016.md` for tested behavior, installation evidence and remaining limits. The earlier isolated transfer-record experiment is not the deployed engine.

## Decision

Treat device-to-device actions as transfers, with one receiver-owned operation and durable result. Do not introduce directory synchronization, replicated competing file truth, or deletion propagation to make transfers reliable.

Shortlist two engines for an isolated failure-injection evaluation:

1. **tus/tusd** as the preferred standardized resumable byte-transfer foundation. It fits the existing authenticated HTTP device gateway and has Java/Android clients. Android receiving still needs a proven server/storage implementation; an Android client library does not solve receiving.
2. **Copyparty/up2k** as the strongest complete file-service alternative found in this review. Evaluate its actual upload engine rather than reimplementing its chunk/content-reuse behavior. Its Python server and Android deployment requirements make it a larger packaging change.

This ranking is an architectural inference from the sources below, not a benchmark or proof that either embeds cleanly into the current APK. Keep the existing file owner, pairing, share authorization, transfer UI, and AYG durable writer. Replace the byte-transfer mechanism behind them if the evaluation passes; do not add a competing application queue or file inventory.

## What a dead or stalled connection means

A connection timeout cannot distinguish a dead process from a slow or partitioned peer. It establishes that this attempt stopped making progress. It does not establish whether the receiver committed the last request.

Use the same operation after reconnecting and ask the receiver for its durable status:

| Receiver result | Next action |
| --- | --- |
| Partial bytes retained | Resume from the receiver's verified position/chunks. |
| Complete bytes, not published | Verify and finish publishing once. |
| Published with receipt | Return that result; do not create another destination file. |
| Published, AYG link pending | Retry the checked AYG action only. Keep the disk file. |
| Explicitly expired or cancelled | Report that result; a restart is a distinct, deliberate transition. |
| Unreachable or ambiguous | Show Waiting for device / Checking completion. Retain recovery data. |

The sender's last progress counter is never proof of receiver state. A hash identifies content, not the user's action: two intentional copies can have identical bytes, while one retried action must retain its operation identity.

## Mature candidates

| Candidate | Established capability | Fit and unresolved work |
| --- | --- | --- |
| [tus protocol](https://tus.io/protocols/resumable-upload), [tusd](https://tus.github.io/tusd/) | Receiver offset discovery; offset-checked appends; optional checksum, expiration and termination extensions. | Best narrow protocol fit. Detect extensions rather than assuming checksum support. Publishing, authorization, folder manifests and AYG completion remain application responsibilities. |
| [Copyparty](https://github.com/9001/copyparty) | up2k checksummed chunks, interrupted-upload recovery, restart recovery by reselecting files, corruption repair and avoiding redundant network uploads. | Best full-service candidate. Its Android app is an uploader, not the server; server instructions use Termux/Python. Avoid symlink/hardlink dedup for independent user files. Do not enable the fast dedup mode that skips verification when other applications edit these files. |
| [LocalSend protocol](https://github.com/localsend/protocol/blob/main/README.md) | Receiver prepares a session with per-file tokens; upload and optional SHA-256 checking; cancellation and reverse transfer. | Good explicit-handoff model. The reviewed v2.2 specification has no offset-resume/status contract comparable to tus; do not infer durable crash recovery merely from its cross-platform UI. |
| [croc](https://github.com/schollz/croc) | File/folder transfer, interrupted resume, end-to-end encryption and relay fallback; Android implementations exist. | Good separate handoff tool. Embedding its runtime and mapping persistent editing/receipts still need evaluation. Existing paired Tailscale peers do not inherently need another invitation or relay workflow. |
| [SFTPGo](https://docs.sftpgo.com/) | Managed multi-protocol file service and access controls. | Substantial service/runtime integration. Current TUS features are documented for Enterprise; do not silently assume Community has them. Android receiving and exact backend resume guarantees need separate verification. |
| [rclone](https://rclone.org/faq/) | Mature multi-backend file copying. | Useful bulk-copy adapter, not evidence that every backend resumes a partially uploaded file after process death. Use copy, not sync, for this product's transfer actions. |
| [Windows BITS](https://learn.microsoft.com/en-us/windows/win32/bits/life-cycle-of-a-bits-job) | Persistent jobs distinguish transient error, terminal error, transferred and acknowledged states; retry/no-progress policies. | Strong lifecycle reference, not a common Windows/Android transport. Its Complete and Cancel have materially different retention effects. |

Important tusd integration limit: [finish hooks](https://tus.github.io/tusd/advanced-topics/hooks/) do not make the application transaction atomic. post-finish runs after the response; hook delivery/order and post-processing failure require care. A pre-finish result lost on the network cannot simply be fetched again using that hook. A durable, queryable publish/link receipt is still needed.

Android lifecycle is separate from transport. [User-initiated data-transfer jobs](https://developer.android.com/develop/background-work/background-tasks/uidt) start at Android 14; the current Android 12 phone needs the appropriate older-platform execution path. A background scheduler cannot establish that a remote write committed.

## Required failure evaluation before choosing an engine

Use disposable folders and a controllable proxy, never creator files. Run each direction on SlopTop, LapDog and Android, including transfers initiated from a third device's view.

1. Disconnect during a chunk, between chunks, and after the receiver accepts the final bytes but before its reply arrives.
2. Kill sender, receiver, and both; restart with the same job. Also test a receiver power-loss scenario separately from graceful shutdown.
3. Repeat a request concurrently and after restart. Exactly one operation result; no accidental numbered duplicate.
4. Corrupt one chunk, retained partial data, and final data. No false success; failed verification must not replace an existing destination.
5. Change or replace the source during transfer. Do not combine bytes from different source generations.
6. Exercise full disk, read-only destination, revoked access, expired partial data, Android permission loss and app termination.
7. Destination already exists: identical bytes, identical name/different bytes, case differences, intentional second copy and concurrent unrelated creation. Preserve established keep-both behavior for genuinely distinct files.
8. Publish succeeds but AYG persistence rejects or crashes. Keep the physical result and retry only linking. A later explicit owner deletion must not be undone by replay.
9. Folder transfers: empty directories, partial children, renamed/moved destination, interrupted manifests, invalid paths and symlink escape attempts. Report per-file results; do not imply a whole folder was atomic.
10. Retention expiry and cleanup race with resume, cancel, finalization and editing revocation. Cleanup must never mistake a published user file for temporary transfer storage.

## Deliberate remote editing: creator's added requirement

This is an explicit, single-file editing assignment, not general synchronization. Original device A remains the file owner. Chosen device B downloads a working copy and writes saved revisions back to the exact file on A. A third paired device C may inspect, assign or stop it, subject to the owner's existing write grant.

Proposed interaction:

- On a remote file, **Edit on…** chooses one of the three devices. Show **Editing on LapDog**, for example, consistently in native and AYG views.
- Assignment is only active after the original owner acknowledges it and the chosen editor obtains the checked baseline. Offline requests show pending, not a false active status.
- Saved changes on the chosen machine upload automatically. Show **Uploading changes**, **Up to date**, **Waiting for owner**, or **Needs attention**. File selection alone never enrolls editing.
- **Stop editing** is available from any authorized device. The original owner keeps the latest committed disk version. Unsent changes remain on the editor as a recoverable local copy; stopping does not silently upload them or restore an older baseline.
- A stop requested while the owner is offline remains visibly pending. No device can truthfully promise that another unreachable device has already revoked a writer.

Owner-held assignment binds stable target identity, editor device, assignment ID/generation, active/stopped status and last accepted revision. File paths and display names are insufficient identities. Only one editor assignment is active for a target; changing editor invalidates the old generation.

Every write-back carries that assignment generation, a stable save ID, expected owner revision and content digest. The owner rechecks assignment and file revision immediately before replacement. Receiving all upload bytes is not authorization to publish them. Assignment stop and publish must serialize at the owner: if publish wins, stop keeps that result; if stop wins, the stale publish is refused. A stop acknowledgement is the boundary after which the old assignment cannot publish.

HTTP [conditional updates](https://www.rfc-editor.org/rfc/rfc9110.html#section-13.1.1) provide the standard lost-update principle. [WebDAV locking](https://www.rfc-editor.org/rfc/rfc4918.html#section-6) provides established editing/lock semantics, but a cooperative network lock cannot prevent an unrelated desktop application from writing directly to disk. Recheck the actual owner file, not just network metadata.

If the original is independently edited, deleted or ambiguously replaced, preserve the working copy and show a conflict. Do not blindly overwrite, resurrect, or select a same-name replacement. A checked known move can continue through the existing file-target identity owner.

Detect editor saves through the existing local file-observation owner, coalesce save bursts, and upload immutable snapshots. Handle applications that save by replacing the working-copy inode; do not bind observation solely to the old open handle. Edits made while an upload is running schedule the next revision rather than changing the bytes of the current upload. Retrying a lost reply queries the same save receipt. No clock-based last-writer-wins rule.

## Current code reuse and gaps

Inspection found existing Papers edit machinery: remoteFileEditSessions.ts, remoteFileEditOwner.ts, remoteFileEditUploads.ts, remoteFileEditWorkingCopies.ts, remoteFileEditRoutes.ts and Android MobileEditCopies/MobileFiles. They already capture source versions, retain working copies, verify uploads and persist save receipts. Reuse these owners rather than introducing a second editor service.

The inspected sessions are per requesting device and effectively one checked save per session, with continuation for later saves. They are not yet the creator's shared, persistent editing assignment: no all-device assignment/stop contract or automatic watching/write-back was established by this inspection. Interrupted saving is retained as uncertain; this must not be advertised as automatically reconciled completion.

Extend that existing owner with assignment generation and owner-serialized stop/publication; add shared scoped status, automatic save observation, and Android receiver parity. The mature byte engine should serve ordinary transfers and edited-snapshot uploads without merging their distinct publication policies. AYG only renders status and sends commands; it must not decide which disk file is authoritative.

## Delivery boundaries

First evaluate engine restart/lost-ack behavior and Android receiving. Then implement the shared transfer receipt and editing assignment in the existing host owners, test revocation/write races, wire the UI, and verify installed behavior on all three devices. Keep icon/preview work separate from this change. Do not ship unfinished bespoke content-reuse code as if this research had validated it.

Original research verification used primary documentation and source inspection. The subsequent implementation and fault-test evidence is recorded separately in the implementation document, rather than treating this proposal as acceptance evidence.

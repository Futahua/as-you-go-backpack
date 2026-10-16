# Shared transfer identity and content reuse experiment — 2026-10-16

This is an isolated experiment under experiments/transfer-record-model*.mjs. It is not imported into the production application and is not a claim that the new receipt model or content reuse policy has shipped.

## Interpretation of the creator's suggestion

One user action has one operation ID and immutable direction A -> B, source owner/file identity/revision, destination owner/folder, and requested filename. The initiating computer is not part of that identity. Both devices should report the same recipient-owned receipt, rather than reinterpret a sender-local upload and receiver-local download as unrelated actions. A fresh, deliberate second copy has a fresh operation ID.

A shared ID alone is insufficient. The recipient separately records planned, prepared physical file identity, received bytes, and saved AYG link. A rejected AYG save leaves received bytes intact and the link pending. Retrying from either perspective finishes the missing step without recopying. A recorded completion is not authority to recreate a file the recipient later deleted or bind its old AYG entry to an unrelated byte-identical copy.

## What was tested

Node test runner against real temporary filesystem files and JSON receipts, with simulated action origin, restart and failures. 11/11 passing:

1. Concurrent retries from A and B reuse one file and one link.
2. Rejected link CAS retains received bytes, preserves the owner's intervening edit, and retries only the link.
3. Lost acknowledgement plus a new receiver instance reuses its saved receipt.
4. Crash injected after staged-file promotion, before the received receipt, recovers from prepared physical identity.
5. Recipient deletion after receipt cannot be overruled by a sender retry.
6. An operation ID reused for another intent is rejected; distinct intentional transfers remain distinct.
7. Changed source identity/content cannot satisfy the requested source version.
8. A renamed received file is found by its physical identity without another copy.
9. Matching filename and size with different bytes does not qualify for reuse.
10. Identical bytes at the intended destination qualify for reuse; identical bytes needed under a different logical name may be copied locally while preserving separate files; explicit duplicate intent is retained.
11. A byte-identical copy cannot impersonate a deleted object in an old transfer receipt.

Limits: same-process concurrency is serialized by the simulated recipient. Restart is object re-creation from saved JSON, not an actual killed process or power-loss durability test. There is no real network, production authentication, permission projection or multi-process writer election in this experiment. The model's identity resolver only scans its private temporary recipient directory; production must use the existing owner identity registry, not add another whole-device crawler. The checksum decision is SHA-256 plus size and before/after identity/version checks, not proof of semantic document identity. No throughput or phone battery benchmark is claimed.

## Existing production behavior found

- remoteFileClient.upload already computes source SHA-256 and sends size/name/digest. Download cache keys use source owner, resource ID and version; downloaded bytes are checked against the owner digest.
- Android PhonePeerServer.upload uses sender + destination folder path + name + size + digest for resumable/completed upload receipts. An existing receipt is checked at its old path using size/digest; a moved target is not followed by that receipt.
- Windows RemoteFileCatalog.receive validates bytes but keeps both names on collision. InboxTransfers likewise publishes to a numbered filename rather than comparing existing content. Existing same-job IDs prevent some repeat work, but new retries / different routes are not a unified bytes-and-link operation.
- Therefore current handling is asymmetric. Checksums already exist for integrity, but they are not yet a consistent end-to-end duplicate-download policy.

## Recommended production policy

1. Reuse a confirmed operation receipt and resolve the destination's physical identity first. This handles renames without trusting the filename.
2. Without such a receipt, examine candidates at the intended destination: size first, then a checksum tied to current owner identity/version. Same filename alone, timestamps alone and equal size alone are insufficient.
3. If bytes are identical and the requested destination is already satisfied, reuse that physical target and ensure its AYG link. Do not make a numbered duplicate by accident.
4. If a different filename/folder or explicit second copy is requested, preserve that logical intent. Identical local content may avoid network traffic, but does not justify silently aliasing two independently editable files.
5. Same name but different bytes retains conflict/keep-both behavior. Never use content matching to delete the source or infer that a missing file moved.
6. Reuse integrity digests already calculated during transfer. Hashing an otherwise unknown candidate requires reading its contents; narrow candidates by size and destination and cache by stable identity/version. Do not continuously hash all phone or PC storage.
7. Extend the current transfer owner and its durable jobs/receipts. Do not add a second clipboard, download queue, delete reconciler or competing AYG store.

This fits established practice: [Syncthing's algorithm](https://docs.syncthing.net/users/syncing.html) reuses locally available verified content to avoid fetching it over the network; it also explains why content changes require reading and hashing. [Microsoft's file information contract](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getfileinformationbyhandle) distinguishes physical identity through volume and file identifiers. These are different questions: which file is this, and are these bytes already available?

Test log: D:\Programs\evTEMP\transfer-record-model-tests.log.

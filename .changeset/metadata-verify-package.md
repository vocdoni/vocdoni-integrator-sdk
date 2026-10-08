---
'@vocdoni/metadata-verify': minor
---

New package `@vocdoni/metadata-verify`: framework-agnostic verification of election metadata against the hashes committed on the Vochain, shared by the voter view, the organizer view and the voting report. `verifyProcessMetadata(process, { vochainApiUrl, fetch })` checks what a page shows (a process as the SaaS API returns it) against the parent and question elections' documents, field by field, and hashes the header and choice images, returning the verified image bytes; the video and images embedded in descriptions are reported as covered by URL only. `auditElectionMetadata` / `auditProcessMetadata` read `GET /elections/{id}/metadata/history`, verify every version and diff consecutive versions field by field (`diffMetadata`, with `diffWords` / `condenseDiff` for word-level text diffs). Results are structured codes, with no UI strings.

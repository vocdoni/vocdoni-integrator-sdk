---
'@vocdoni/metadata-verify': minor
---

New package `@vocdoni/metadata-verify`: framework-agnostic verification of election metadata against the hashes its elections committed, shared by the voter view, the organizer view and the voting report.

- `verifyProcessMetadata(process, options?)` checks what a page shows (a process as the SaaS API returns it, with `metadataURL` / `metadataHash` on the process and each question) against the parent and question documents, field by field, and hashes the header and choice images, returning the verified image bytes. The video and images embedded in descriptions are reported as covered by URL only. By default it makes no Vochain API request: every vote carries the question's and the parent's metadata hash, which the chain checks. `{ independent: true, vochainApiUrl }` reads the hashes, URLs and parent links from the Vochain API instead.
- `auditProcessMetadata` / `auditElectionMetadata` read the Vochain API: the metadata history of the parent election and of each of its children (`GET /elections/{id}/children`, `getElectionChildren`), every version verified and diffed against the previous one (`diffMetadata`, with `diffWords` / `condenseDiff` for word-level text diffs), and per question election the parent-link issues `wrong-parent`, `not-a-child` and `not-in-process`.

Results are structured codes, with no UI strings.

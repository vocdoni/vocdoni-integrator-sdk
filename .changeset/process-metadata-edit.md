---
'@vocdoni/api-types': minor
'@vocdoni/api-client': minor
---

Read and edit the text of a voting process. `@vocdoni/api-types` adds `VotingProcessMetadata` (title, description, header, stream URI, and each question's and choice's text, matched by position). `ElectionsClient` adds `getProcessMetadata(processId)` (`GET /processes/{id}/metadata`) and `updateProcessMetadata(processId, metadata)` (`PUT`, Manager/Admin), which resolves to `undefined` when a draft is updated in place and to `{ jobId }` when a published process is updated on chain, plus `updateProcessMetadataAndWait` to poll that job.

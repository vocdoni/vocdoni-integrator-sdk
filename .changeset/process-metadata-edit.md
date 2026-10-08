---
'@vocdoni/api-types': minor
'@vocdoni/api-client': minor
---

Read and edit the text of a voting process. `@vocdoni/api-types` adds `VotingProcessMetadata` (title, description, header, stream URI, and each question's and choice's text, matched by position). `ElectionsClient` adds `getProcessMetadata(processId)` (`GET /processes/{id}/metadata`) and `updateProcessMetadata(processId, metadata)` (`PUT`, Manager/Admin), which resolves to `undefined` when a draft is updated in place and to `{ jobId }` when a published process is updated on chain, plus `updateProcessMetadataAndWait`, which polls that job for up to `METADATA_UPDATE_TIMEOUT_MS` (16 minutes, as the transactions can stay pending for the mempool TTL) and resolves to it. `JobType` gains `set_process_metadata`, and `JobResult` gains `questions` (per-question metadata outcomes) and `parent` (the process parent election's outcome).

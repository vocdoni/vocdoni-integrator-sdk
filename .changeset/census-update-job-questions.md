---
'@vocdoni/api-types': minor
'@vocdoni/api-client': patch
---

Census updates report per question. `QuestionJobResult` is new and `JobResult` gains `questions`, the per-question outcomes of `set_process_status` and `set_process_census` jobs in target order. On a census update, `noOp: true` means no transaction was sent because the election was no longer open on chain or already had the room, and a job fails if any attempted resize failed while the other resizes still apply. `UpdateProcessCensusResponse` and `elections.addCensusMembers` document that `jobId` is absent when no election can grow (only READY/PAUSED questions are resized), so callers must skip `jobs.waitFor` then.

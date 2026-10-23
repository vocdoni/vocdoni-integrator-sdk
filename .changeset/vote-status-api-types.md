---
'@vocdoni/api-types': minor
---

Add `hasSigned?: boolean` to `ProcessQuestionStatus` and `ProcessParticipantQuestionVote`, and document `hasVoted` as "the vote is on chain" (a backend without `hasSigned` still reports "the CSP signed" there). Add `VerifyVotesRequest`, `VerifyVotesResponse` and `VerifiedVote` for `POST /votes/verify`.

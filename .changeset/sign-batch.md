---
'@vocdoni/api-types': minor
'@vocdoni/api-client': minor
'@vocdoni/react-providers': minor
---

Sign every question of a process in one call via `POST /processes/{id}/sign-batch` (vocdoni/saas-backend#634).

- `@vocdoni/api-types`: the `SignBatchRequest` / `SignBatchResponse` / `SignBatchResult` / `SignBatchBallot` shapes and the stable `SignFailureCode` union the backend reports per-ballot failures with.
- `@vocdoni/api-client`: `processes.signBatch()` wraps the endpoint — one auth token, N ballots, one response, always in request order.
- `@vocdoni/react-providers`: `useElectionAuth().signBatch()` signs every ballot in one round trip (matching results by `upstreamId`, so a dropped entry can never shift a signature onto the wrong question), and `vote()` now uses it instead of looping `processes.sign` per question — even for a single question. Per-question sign refusals are reported inline: the questions that DID sign are still built and relayed (a CSP signature is one-shot — discarding it would strand those questions forever), surfacing as `PartialVoteError`; when nothing signs at all the call throws a plain, fully-retryable error and relays nothing.

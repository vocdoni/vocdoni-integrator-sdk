---
'@vocdoni/react-providers': major
---

`ElectionProvider` reports a vote only on on-chain evidence, and recovers a signed vote that did not land.

**Breaking**
- `hasVoted`, `voterQuestions[].hasVoted` and `voteStatus` `confirmed` now mean "on chain": the relay job completed, `check()` reports `hasVoted`, or (anonymous census) `POST /votes/verify` confirms the vote's nullifier. A job-failed envelope is no longer marked confirmed because the CSP signed it, `PartialVoteError` never sets `hasVoted`, and `hasVoted` turns true only when every question is on chain.
- `vote()` throws `Could not verify your voting status; try again` when its pre-flight `check()` (or the verification it needs) fails, instead of falling back to the last known state.
- `QuestionVoteStatus` gains `'unconfirmed'` (signed, not on chain, nothing stored in this tab) and `'signed'` (anonymous census, not confirmable from this tab); both are also set on connect. `vote()` throws the new `UnconfirmedVoteError` when only such questions are left.
- `isAbleToVote` also requires some eligible question that is not signed yet or is pending a re-send.
- A vote id recovered without a job result is the vote's nullifier (bare hex), derived locally, instead of the sign-info lookup.
- A successful `auth0()` now drops the previous voter's token: a connected session reads disconnected (vote state reset) until the new identity's `auth1()` completes, instead of staying connected as the previous voter in between.
- The unknown-outcome reconciliation polls on-chain evidence and its default window grows from 8 to 48 polls (× 2.5 s), to cover the backend's retry and mined waits.

**New**
- Every signed tx is stored in the tab's `sessionStorage` (`vocdoni.pendingVote.<upstreamId>.<nullifier>`, bound to the voter's auth0 identity) before it is relayed. A question whose relay failed is exposed in `pendingVotes` and re-sent — the same tx, no new CSP signature — by the next `vote()` (its ballot is ignored) and once on connect while the process is `ONGOING`. `clearVoter()` keeps the entries; an ended process drops them.
- `voterQuestions[]` carry `hasSigned` from backends that report it. Against an older backend (no `hasSigned`) the provider behaves as before.

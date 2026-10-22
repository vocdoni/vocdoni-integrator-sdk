---
'@vocdoni/api-client': minor
---

Add `elections.verifyVotes(nullifiers)` (`POST /votes/verify`): checks vote nullifiers against the chain, one `{ nullifier, verified, … }` per nullifier in request order. An unreachable chain throws instead of reporting "not voted".

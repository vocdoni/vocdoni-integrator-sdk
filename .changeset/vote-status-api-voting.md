---
'@vocdoni/api-voting': minor
---

Add `voteNullifier(address, electionId)`: the Vochain vote nullifier, `0x` + keccak256(address ‖ electionId), identical to Go `state.GenerateNullifier`. Accepts bare or 0x-prefixed hex in any case.

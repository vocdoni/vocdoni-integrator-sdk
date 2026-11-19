---
"@vocdoni/react-providers": minor
---

Adds `challengePending` to the voter session (`useElectionAuth()` and `useElection()`): `true` after a 2FA `auth0()` until `auth1()` confirms the code, and back to `false` once connected or after `clear()`. Apps can use it to show the code step only while a code is due. A confirmed challenge is spent, so a second `auth1()` without a new `auth0()` throws. An `auth0()` or `auth1()` that settles after the process changed is ignored, and does not connect or identify the voter for the new process.

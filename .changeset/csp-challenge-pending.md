---
"@vocdoni/react-providers": minor
---

Adds `challengePending` to the voter session (`useElectionAuth()` and `useElection()`): `true` after a 2FA `auth0()` until `auth1()` confirms the code, and back to `false` once connected or after `clear()`. Apps can use it to show the code step only while a code is due.

---
'@vocdoni/api-types': minor
---

`ApiErrorCode.NotSupported` (40025): CSP auth step 0 and resend answer it when the backend has no SMS or email provider for the census's challenge, instead of accepting a code that is never sent. It is the same code a backend without certificate gateway keys returns for certificate auth.

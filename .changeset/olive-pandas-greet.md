---
"@vocdoni/api-types": minor
---

Add an optional `lang` field to `ApiClientConfig`. It takes the same shapes as `authToken` — a string, or a sync/async getter re-read on every request — and tells the SaaS API which language to render anything it produces on the caller's behalf, above all the 2FA OTP email/SMS. Purely additive; existing configs are unaffected.

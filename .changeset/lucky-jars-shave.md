---
"@vocdoni/api-client": minor
---

Send the configured language to the API. `new VocdoniApiClient({ apiUrl, lang })` now appends `?lang=<value>` to every request, so the OTP email/SMS triggered by `elections.authStep0()` and `elections.resend()` reaches the voter in the language they are actually reading — until now those always came out in the backend's fallback language, whatever the UI showed.

`lang` accepts a string or a sync/async getter (`lang: () => i18n.language`), matching `authToken`, and the new `client.setLang(lang)` changes it after construction for the voter who switches locale mid-session — the next request carries the new value, with no need to rebuild the client. Leave `lang` unset, or `setLang(undefined)`, and no param is sent at all. Per-call params are untouched: `lang` is a default, so an explicit param of the same name still wins. A `lang` getter that throws degrades to sending nothing rather than failing the request — a locale is cosmetic, the call it rides on is not.

One behaviour change worth knowing about: the client now keeps its own snapshot of the config fields you pass in (including inherited properties), so setters never mutate yours. Mutating that object after construction — `config.authToken = next` — no longer affects the client; use the getter form for values that change, or update credentials with `client.setAuthToken(...)`.

Add `client.setAuthToken(authToken?)` to replace the default Bearer token after construction. It accepts a string or sync/async getter, just like the constructor option; call `setAuthToken()` or `setAuthToken(undefined)` to clear the default Authorization header. Token getter failures continue to reject requests.

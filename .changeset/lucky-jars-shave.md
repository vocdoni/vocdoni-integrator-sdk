---
"@vocdoni/api-client": minor
---

Send the configured language to the API. `new VocdoniApiClient({ apiUrl, lang })` now appends `?lang=<value>` to every request, so the OTP email/SMS triggered by `elections.authStep0()` and `elections.resend()` reaches the voter in the language they are actually reading — until now those always came out in the backend's fallback language, whatever the UI showed.

`lang` accepts a string or a sync/async getter (`lang: () => i18n.language`), matching `authToken`, and the new `client.setLang(lang)` changes it after construction for the voter who switches locale mid-session — the next request carries the new value, with no need to rebuild the client. Leave `lang` unset, or `setLang(undefined)`, and no param is sent at all. Per-call params are untouched: `lang` is a default, so an explicit param of the same name still wins.

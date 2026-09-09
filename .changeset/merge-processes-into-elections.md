---
'@vocdoni/api-client': minor
'@vocdoni/api-voting': minor
'@vocdoni/react-providers': patch
---

Merge the voter CSP client into `ElectionsClient`; `client.processes` stays as a deprecated alias.

`client.elections` (`ElectionsClient`) and `client.processes` (`ProcessesCspClient`) were never two resources. Both wrapped the same `/processes/{id}` endpoints through the same `up-fetch` instance — so they had identical auth behaviour — and two methods, `getQuestion` and `signInfo`, were duplicated verbatim between them. The "admin surface vs voter surface" split the docblocks claimed never held either: `vote`, `voteBatch`, `get`, `list`, `getResults` and `getQuestion` are all public voter calls that lived on `elections`, and a voter app built with no API key at all already had to call both properties. The split is a fossil — `ElectionsClient` was written against the old singular `/process/*` routes and kept its name when the resource moved to `/processes`, then `ProcessesCspClient` arrived later named after the route family. `react-providers` resolved its half of the same duplication when `ProcessProvider` was merged into `ElectionProvider`; this finishes the job one layer down.

`ElectionsClient` now carries all 30 methods: the public process/question/results reads, the authenticated authoring writes, the voter CSP flow (`authStep0`, `authStep1`, `resend`, `check`, `sign`, `signBatch`, `blindPoint`, `blindSign`, `weight`), and the vote relay.

**Nothing breaks at runtime.** `client.processes` is the very same instance as `client.elections`, and the exported `ProcessesCspClient` is an alias of `ElectionsClient` (`ProcessesCspClient === ElectionsClient`, so `instanceof` works either way). Both are deprecated and **will be removed in the next major version** — migrate by replacing `client.processes.` with `client.elections.`, which is a pure rename with no signature changes.

In `@vocdoni/api-voting`, `BlindCspApiClient` accepts a client keyed by either `elections` or the deprecated `processes`, so clients written against api-client 2.x keep working — including a whole api-client 2.x `VocdoniApiClient`, where both keys exist but only `processes` carries the blind methods, so the endpoints are resolved by capability rather than by key name. The endpoint shape is now exported separately as `BlindCspEndpoints`. Note `BlindCspApiClient` is now a union type alias rather than an interface, so it can no longer be `extends`-ed or `implements`-ed — annotate the object instead. That fallback is removed in the next major too.

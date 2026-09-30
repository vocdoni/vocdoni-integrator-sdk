---
'@vocdoni/api-client': minor
'@vocdoni/api-types': minor
---

Remove the wrappers for the legacy SaaS routes that saas-backend#722 retires (`/census`, `/process`, `/process/bundle`, `/transactions`, plus `/organizations/{address}/processes/drafts` and `POST /organizations/{address}/groups/{groupId}/validate`). Once that backend change is deployed they all return 404.

Removed from `@vocdoni/api-client`:

- `CensusClient` and `client.census` (`get`, `create`, `addParticipants`, `getParticipants`, `publish`, `publishGroup`). A process now embeds its CSP census on create: pass `census: { groupId, authFields, twoFaFields? }` (or `memberIds` instead of `groupId`) to `client.elections.create()`. Use `client.elections.addCensusMembers()` to grow a published process's census, and `client.elections.validateCensus()` for a pre-flight check. The census is published together with its process (`client.elections.publishAndWait()`); read it back from `(await client.elections.get(id)).census`, or list the organization's censuses with `client.organizations.listCensuses()`. There is no census member listing anymore: `client.elections.participants(id, { field, value })` looks members up by credential.
- `client.elections.getMetadata()`: read `title`/`description`/`header` from `client.elections.get()`.
- `client.elections.setStatus()` / `setStatusAndWait()`: use `setQuestionStatus()` / `bulkSetQuestionStatus()` with the same wire status names (`ready`, `paused`, `ended`, `canceled` — not the read-side `ONGOING`; omit `questions` to target every published question), then `client.jobs.waitFor(jobId)` on the returned job.
- `client.organizations.validateGroup()`: use `client.elections.validateCensus({ orgAddress, census: { groupId, authFields } })`.
- `client.organizations.listProcessDrafts()`: use `client.elections.list({ orgAddress, published: false })` with a manager/admin session or a scoped API key (drafts only; without `published: false` a manager gets drafts and published processes together).

Removed from `@vocdoni/api-types`, which only those wrappers used: `CreateCensusRequest`, `CreateCensusResponse`, `PublishCensusRequest`, `PublishCensusGroupRequest`, `PublishedCensusResponse`, `AddCensusParticipantsRequest`, `CensusParticipantsResponse`, `ElectionMetadata`, `ConsumedAddressResponse`, `ValidateGroupRequest` and `OrganizationProcessDraftsResponse`. `OrganizationCensus` stays: `organizations.listCensuses()` still returns it. `SetElectionStatusRequest` stays too, now documented as the writable status vocabulary of `setQuestionStatus` / `bulkSetQuestionStatus`, which consumers use to type those calls.

**Why this is a minor and not a major.** Removing exported members is nominally breaking, but once the backend change deploys every removed method can only 404: the routes behind them are gone. A sweep of the known consumers (this SDK, `vocdoni-app`) found no caller of any of them, so anyone still referencing one holds a call that cannot work, and the migration above replaces it. This follows the `@vocdoni/api-types` 1.2.0 precedent.

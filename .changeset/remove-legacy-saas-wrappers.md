---
'@vocdoni/api-client': major
'@vocdoni/api-types': major
---

Remove the wrappers for the legacy SaaS routes that saas-backend#722 retires (`/census`, `/process`, `/process/bundle`, `/transactions`, plus `/organizations/{address}/processes/drafts` and `POST /organizations/{address}/groups/{groupId}/validate`). Once that backend change is deployed they all return 404.

**BREAKING CHANGE:** removed from `@vocdoni/api-client`:

- `CensusClient` and `client.census` (`get`, `create`, `addParticipants`, `getParticipants`, `publish`, `publishGroup`). A process now embeds its CSP census on create: pass `census: { groupId, authFields, twoFaFields? }` (or `memberIds` instead of `groupId`) to `client.elections.create()`. Use `client.elections.addCensusMembers()` to grow a published process's census, and `client.elections.validateCensus()` for a pre-flight check.
- `client.elections.getMetadata()`: read `title`/`description`/`header` from `client.elections.get()`.
- `client.elections.setStatus()` / `setStatusAndWait()`: use `setQuestionStatus()` / `bulkSetQuestionStatus()`.
- `client.organizations.validateGroup()`: use `client.elections.validateCensus({ orgAddress, census: { groupId, authFields } })`.
- `client.organizations.listProcessDrafts()`: use `client.elections.list()` with a manager/admin session or a scoped API key, which includes drafts.

Removed from `@vocdoni/api-types`, which only those wrappers used: `CreateCensusRequest`, `CreateCensusResponse`, `PublishCensusRequest`, `PublishCensusGroupRequest`, `PublishedCensusResponse`, `AddCensusParticipantsRequest`, `CensusParticipantsResponse`, `SetElectionStatusRequest`, `ElectionMetadata`, `ConsumedAddressResponse`, `ValidateGroupRequest` and `OrganizationProcessDraftsResponse`. `OrganizationCensus` stays: `organizations.listCensuses()` still returns it.

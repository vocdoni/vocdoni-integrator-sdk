---
'@vocdoni/api-client': minor
'@vocdoni/api-types': minor
---

Remove the wrappers for the legacy SaaS routes that vocdoni/saas-backend#725 deletes (`/census/*`, `/process/*`, `/organizations/{address}/processes/drafts` and `POST /organizations/{address}/groups/{groupId}/validate`):

- `@vocdoni/api-client`: `CensusClient` and `client.census` (`get`, `create`, `addParticipants`, `getParticipants`, `publish`, `publishGroup`); `elections.getMetadata`, `elections.setStatus` and `elections.setStatusAndWait`; `organizations.validateGroup` and `organizations.listProcessDrafts`.
- `@vocdoni/api-types`: `CreateCensusRequest`, `CreateCensusResponse`, `PublishCensusGroupRequest`, `PublishCensusRequest`, `PublishedCensusResponse`, `AddCensusParticipantsRequest`, `CensusParticipantsResponse`, `ElectionMetadata`, `ConsumedAddressResponse`, `ValidateGroupRequest` and `OrganizationProcessDraftsResponse`.

Migration: declare the census on the process itself — `census: { groupId, authFields, … }` on `elections.create` (the published census from `census.publishGroup` was never read by a `/processes` election anyway). Change status per question with `elections.setQuestionStatus` / `bulkSetQuestionStatus`. Read `title` / `description` / `header` from `elections.get` instead of `getMetadata`.

`SetElectionStatusRequest` stays: it is the status vocabulary consumers use to type `bulkSetQuestionStatus` calls. `OrganizationCensus` stays for `organizations.listCensuses`.

**Why this is a minor and not a major.** Removing exported members is nominally breaking, but once the backend change deploys, every removed method can only 404, since the routes behind them are gone. A sweep of the known consumers (this SDK, `vocdoni-app`) found no caller of any of them. Anyone still referencing one has a call that already cannot work, and the migration above replaces it.

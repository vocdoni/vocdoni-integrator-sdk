# @vocdoni/api-types

## 2.0.0

### Major Changes

- e6ff0b2: Support anonymous (blind CSP) voting end to end.

  A census can now be created with `anonymous: true` (vocdoni/saas-backend#641). Such a process publishes under the `OFF_CHAIN_CA_V2` census origin (vocdoni/vocdoni-node#1434) with the CSP's _blind_ public key as census root: the CSP signs a ballot it cannot read, so it can no longer link the authorization it granted to the vote that appears on chain. Until now every SaaS process was CSP-based but linkable — the CSP signed a `CAbundle` carrying the voter's plaintext ephemeral address.

  The blind and unblind operations are the voter's, by construction, so they have to live in the SDK. This adds them:

  - **`@vocdoni/api-types`** — `CensusSpec.anonymous` and the `BlindPoint*` / `BlindSign*` request and response types. Both blind rounds reuse the batch sign's `SignBatchResult` and `SignFailureCode`, which the sign-batch release adds; the two blind-only codes are `blind_request_missing` and `invalid_blinded_message`.
  - **`@vocdoni/api-client`** — `processes.blindPoint()` and `processes.blindSign()`, the two rounds. There is no single-election blind endpoint: authorization is checked once per batch.
  - **`@vocdoni/api-voting`** — `signBlindCspBallots()` runs both rounds and the client-side blinding in one call, returning the same result shape as the plain batch sign. The primitives (`blind`, `unblind`, `decompressBlindPoint`, `serializeBlindSignature`, `blindMessageFromBundle`) are exported for custom flows; they are built on the already-present `@noble/curves`, add no dependency, and their encodings are pinned byte-for-byte against Go-generated fixtures from `arnaucube/go-blindsecp256k1`. `buildCaBundle` / `encodeCaBundle` are now exported so the bundle that gets blinded and the bundle that goes on chain are built at one site and cannot drift apart.
  - **`@vocdoni/react-providers`** — `useElectionAuth().signBatch()` picks the plain or blind flow itself from `census.anonymous`, and `ElectionProvider.vote()` tags anonymous ballots `ProofCA_Type.ECDSA_BLIND_PIDSALTED`. Nothing to configure — an anonymous process votes anonymously.

  This is a blind signature, not zero-knowledge: `EnvelopeType.Anonymous` stays `false` and `@vocdoni/api-voting-zk` remains a separate, unrelated path.

  **BREAKING CHANGE:** `QuestionConsumedAddress.address` and `.nullifier` are now optional (`string` → `string | undefined`). An anonymous census reports neither — the CSP never learns the address — so the backend omits them, and the type has to admit it. TypeScript code that reads either field unconditionally stops compiling; the fix is a guard:

  ```ts
  // before
  const nullifier = entry.nullifier.toLowerCase();
  // after
  const nullifier = entry.nullifier?.toLowerCase();
  ```

  Runtime behaviour on a non-anonymous process is unchanged: both fields are still populated on every `sign-info` entry. `@vocdoni/api-client` majors with the types it re-exports. The practical consequence is that vote ids on an anonymous process exist only for the session that cast them: `useElection().voteIds` cannot be recovered from `sign-info` after a reload.

  `@vocdoni/proto` is bumped `1.15.13` → `1.15.14` in the packages that pin it exactly. The published diff is one additive line (`CensusOrigin.OFF_CHAIN_CA_V2`); nothing here needs it to build, but the pin is the version of the protocol the SDK claims to speak.

### Minor Changes

- 7492468: Sign every question of a process in one call via `POST /processes/{id}/sign-batch` (vocdoni/saas-backend#634).

  - `@vocdoni/api-types`: the `SignBatchRequest` / `SignBatchResponse` / `SignBatchResult` / `SignBatchBallot` shapes and the stable `SignFailureCode` union the backend reports per-ballot failures with.
  - `@vocdoni/api-client`: `processes.signBatch()` wraps the endpoint — one auth token, N ballots, one response, always in request order.
  - `@vocdoni/react-providers`: `useElectionAuth().signBatch()` signs every ballot in one round trip (matching results by `upstreamId`, so a dropped entry can never shift a signature onto the wrong question), and `vote()` now uses it instead of looping `processes.sign` per question — even for a single question. Per-question sign refusals are reported inline: the questions that DID sign are still built and relayed (a CSP signature is one-shot — discarding it would strand those questions forever), surfacing as `PartialVoteError`; when nothing signs at all the call throws a plain, fully-retryable error and relays nothing.

## 1.2.0

### Minor Changes

- d9212f0: Remove the organization `active` flag from `Organization` and `CreateOrganizationRequest`. The SaaS backend drops the field entirely (vocdoni/saas-backend#626), so it no longer exists on organization responses or on the create/update request bodies.

  The flag was never honoured: no handler, middleware or subscription check gated on it, and both creation paths hardcoded it to `true` while discarding whatever the request body sent. It was also actively harmful — `PUT /organizations/{address}` is a partial update, but `active` was the one field opted out of zero-value protection, so a request body that merely _omitted_ it decoded to `false` and was force-persisted, silently deactivating the organization.

  **Why this is a minor and not a major.** Removing an exported property is nominally breaking, but nothing could have depended on this one: reads returned a value the backend hardcoded, and writes were discarded. There is no behaviour to migrate and no value to preserve — a sweep of the known consumers found no reader of `organization.active`. Anyone still referencing it can delete the reference outright, since whatever it returned was meaningless.

  `SubscriptionDetails.active` is unrelated (Stripe-driven) and is unchanged.

## 1.1.2

### Patch Changes

- e7a7dae: Stop creating multichoice elections whose votes are silently discarded at tally.

  The backend derives the **dense** layout for `type: 'multichoice'` (one 0/1 field per
  choice, `maxTotalCost = typeSetup.maxChoices`) while also mapping
  `typeSetup.uniqueChoices` onto the on-chain `voteMode.uniqueValues`. The scrutinizer
  applies `uniqueValues` to the raw field values, so a 0/1 vector over more than two
  choices always repeats one — even a single pick, `[1, 0, 0, 0]`, repeats `0`. Every
  ballot was rejected during aggregation while the vote still counted towards
  `voteCount`, producing elections that reported an all-zero tally with
  `finalResults: true`.

  - `@vocdoni/api-client`: `elections.create` / `elections.update` now reject
    `typeSetup.uniqueChoices` on `multichoice` questions, and reject a raw
    `ballotProtocol` that is unsatisfiable, instead of publishing an election that cannot
    be tallied. Both checks mirror what the API itself enforces, so this fails fast and
    locally without masking the server's answer — a ranked ballot is expressed as a raw
    `ballotProtocol` instead. Adds `@vocdoni/ballot` as a dependency.
  - `@vocdoni/ballot`: new `unsatisfiableProtocolReason`, `unsatisfiableQuestionReason`,
    `isUnsatisfiableProtocol`, `isUnsatisfiableQuestion`, `voteTypeBounds`,
    `assertEncodedBallot` and the `ProtocolBounds` type, plus `isDenseBallotProtocol` is
    now exported. `encodeBallot`, `encodeQuestionBallot` and `validateSelections` throw
    on an unsatisfiable config rather than encoding a ballot that will never count.
    `unsatisfiableQuestionReason` works off `type` + `typeSetup` too, so a UI can flag an
    already-created broken question from a public read (which omits the derived protocol).

    The guard covers the _product_ as well as the config: both encoders now run
    `assertEncodedBallot` on every ballot they build and throw when a field exceeds
    `maxValue` or repeats a value the protocol requires unique (duplicate ranks on a
    ranked ballot, both picks of a two-field dense unique layout, an out-of-range
    single-choice value) — a satisfiable config still admits ballots the chain accepts,
    counts in `voteCount`, and silently drops during aggregation, and a vote must either
    count or fail loudly. `validateSelections` mirrors the same rules on raw selections
    (duplicate unique picks, repeated amounts on a legacy unique budget shape), and
    `unsatisfiableProtocolReason` returns `null` on malformed bounds instead of a
    NaN-laden reason.

  - `@vocdoni/api-types`: documents the constraint on `BallotProtocol.uniqueValues` and
    `QuestionTypeSetup.uniqueChoices`.
  - `@vocdoni/react-components`: the vote form catches these encode-time rejections and
    marks the offending question invalid instead of letting them escape `handleSubmit`
    as an unhandled promise rejection on an already-broken election.

  Already-published elections with this config cannot be repaired — their votes are on
  chain but were never aggregated. The derivation bug itself is upstream
  (vocdoni/saas-backend#619), so processes created outside this SDK are still affected.

## 1.1.1

### Patch Changes

- f84bf33: Surface extended choice info (per-choice image and description) on process reads

  The API stores a choice's image/description on its **parent question**, under
  `metadata.choices` keyed by choice `value` — `db.Choice` is `{Title, Value}` and
  has nowhere to put it. The display components have always read it off
  `choice.meta`, and nothing mapped between the two, so images and descriptions
  were stored correctly and dropped on read: every question rendered
  `basic`/`list`.

  - `@vocdoni/api-types`: `Choice` gains a `meta?: ChoiceMeta`
    (`{ description?, image?: { default?, thumbnail? } }`), plus a
    `ChoiceMetadataEntry` type documenting the storage form. Both are open bags —
    creator-defined keys are part of the contract, not stripped.
  - `@vocdoni/api-client`: `elections.get`, `elections.list`,
    `elections.getQuestion` and `processes.getQuestion` now fold
    `metadata.choices` onto the matching choice as `choice.meta`. Both stored
    image shapes are tolerated — a plain URL string is normalized to
    `{ default: url }`, an object is passed through — and entries matching no
    choice are ignored. `description`/`image` are validated; every other key on
    the entry rides along untouched, so custom `QuestionChoice` slots keep seeing
    the open bag they saw when meta lived on the choice directly. The `value` join
    key is stripped. Exported as `normalizeQuestionChoiceMeta` for hand-normalizing
    raw wire data.
  - `@vocdoni/react-providers`: `<ElectionProvider election>` runs a prefetched
    process through the same normalization, so extended choices (and normalized
    statuses) are right on the first paint instead of only after the refetch.
  - `@vocdoni/react-components`: questions with extended choice info render the
    `extended` presentation again, and the `grid` layout when a choice has an
    image. `ipfs://` URLs and empty descriptions keep behaving as before.

  Two rendering fixes ride along, where the layout and `compact` checks read
  `choice.meta.image.default` raw while the presentation check read it through
  `getQuestionChoiceMeta`:

  - A whitespace-only image URL no longer flips a question to the `grid` layout
    with nothing to show in it — it is trimmed away like every other empty-ish
    string, and the question stays `basic`/`list`.
  - A thumbnail-only image now counts for the layout too. The default choice
    renderer resolves `image.thumbnail ?? image.default`, so such a choice did
    render an image, but inside a control styled as image-less.

  No stored data is migrated — both image shapes are tolerated on read.

  Released as a patch across the board on purpose. `api-types`/`api-client` are
  additive (a new optional field and a new export), which would normally be a
  minor — but `react-components`/`react-providers` **peer**-depend on them, and
  Changesets bumps a peer dependent to _major_ on any peer bump. That would push
  them to `3.0.0` and out of the `^2.0.0` range the consuming app pins, for what
  is a read-side bug fix.

## 1.1.0

### Minor Changes

- 180a9b3: Support the batch vote relay (`POST /votes`, saas-backend#610). New `RelayVotesRequest` and per-envelope `VoteJobResult` types, the `relay_votes` job type, and `JobResult` gains `nullifier`/`processId` (seeded at job creation on relay jobs — readable while pending) plus `votes` (batch outcomes in request order; present on failed jobs too). `elections.voteBatch()` relays up to 100 signed envelopes in one call that the backend accepts or rejects as a unit, and `jobs.waitFor()` gains an `onPoll` callback to observe intermediate job states (e.g. batch entries settling one by one). Also documents that `CensusSpec.groupId` round-trips on process reads since saas-backend#606 (and that org-wide censuses no longer report an all-zeros `groupID` on the org censuses list).
- 41497df: Add the `published?: boolean` drafts filter to `ElectionListParams` (saas-backend#607). `true` lists published processes only; `false` lists drafts only and requires Manager/Admin (401 otherwise); omitted keeps the caller's default view. Combining `published: false` with `status` returns nothing — drafts have no on-chain question status yet. `elections.list` already forwards the param; `published: false` is verified to serialize as `published=false` on the wire.

### Patch Changes

- 8212fcd: Normalize the wire question status `READY` to `ONGOING` at the read boundary. The backend emits `READY` for a live question — semantically identical to `ONGOING`, the only name `QuestionStatus` declares — which leaked through `elections.get`/`list`/`getQuestion` and broke every `status === 'ONGOING'` comparison downstream (e.g. `VoteButton` disabling itself on a live process). All process/question reads now map it via the exported `normalizeQuestionStatus`/`normalizeVotingProcess`, and `computeProcessStatus` also normalizes defensively so raw wire data that skipped the client (e.g. SSR payloads passed to `<ElectionProvider election>`) derives correctly too. The lowercase `ready` of the write API (`SetElectionStatusRequest`, bulk question status) is unchanged.

## 1.0.0

### Major Changes

- a280996: Drop the legacy bundle flow (breaking): the backend removed every
  `/process/bundle/*` route — all voter logic is process-scoped now.

  - **api-client**: `BundleClient` and `client.bundle` are gone (auth, check,
    sign, weight, participantsCheck, create, get); `organizations.listBundles()`
    removed (its route no longer exists — list processes via `elections.list()`).
  - **api-types**: removed `Bundle`, `CreateProcessBundleRequest/Response`,
    `BundleParticipantsCheckRequest/Entry/Response`, `OrganizationBundle`,
    `OrganizationBundlesResponse`, `CheckMembershipResponse`, and the deprecated
    `BundleAuthRequest`/`BundleAuthChallengeRequest` aliases.
    `CheckMembershipRequest` stays — the process check (`POST
/processes/{id}/check`) shares that wire shape.

  Migration: replace `bundle.authStep0/1/check/sign(bundleId, …)` with
  `client.processes.authStep0/1/check/sign(processId, …)` (the check reports
  every question at once), and read `chainId` from the public
  `elections.get(processId)` instead of the bundle info.

- 19a0b09: Align process types with the real backend contract.

  **Breaking changes (`@vocdoni/api-types`):**

  - `VotingProcessResponse` is now a discriminated union on `published`:
    `DraftVotingProcessResponse` (dates optional — drafts legitimately lack them) |
    `PublishedVotingProcessResponse` (dates required). Narrow on `published` before
    reading `startDate`/`endDate`. Note: the published `startDate` guarantee lands
    with saas-backend#586; stay defensive about it until that deploys.
  - `VotingProcessQuestionRequest.type` is now `'singlechoice' | 'multichoice'`
    (new `VotingProcessQuestionType` union / `VOTING_PROCESS_QUESTION_TYPES` const)
    instead of `string`. The backend only accepts these lowercase names — camelCase
    (`'singleChoice'`) is rejected with error 40037, and `'approval'` never existed.

  **Doc fixes (`@vocdoni/api-types`):**

  - Process reads return `orgAddress` as UNPREFIXED lowercase hex, while other
    endpoints (`auth/addresses`, `organizations/{address}`) return the same value
    `0x`-prefixed — never compare the raw strings across endpoints. The create
    request tolerates the `0x`-prefixed form (asymmetry documented).
  - Question `type`/`typeSetup`/`ballotProtocol` contract documented: each question
    needs a named `type` or a raw `ballotProtocol` (the latter wins when both are
    given); `'multichoice'` requires `typeSetup`, `'singlechoice'` ignores it.

- 2a0cbed: Migrate from monolithic `Election` to `VotingProcessResponse` with per-question model.

  **Breaking changes:**

  - `@vocdoni/api-types`: Introduces `VotingProcessResponse`, `VotingProcessQuestion`, `BallotProtocol`, `QuestionStatus`, and `VotingProcessResultsResponse`. The old `Election` type is removed.
  - `@vocdoni/api-client`: `elections.get()` now returns `VotingProcessResponse` (hits `GET /processes/{id}`). New `elections.getResults()` method (`GET /processes/{id}/results`). Exports `computeProcessStatus(questions)` which derives a top-level `QuestionStatus` from all question statuses.

  **New features:**

  - `@vocdoni/ballot`: New exports `inferQuestionBallotType`, `encodeQuestionBallot`, `decodeQuestionResults`, `questionReservesAbstain`, `questionSelectionRange` — per-question ballot helpers based on `BallotProtocol`.

  (The react-providers/react-components side of this migration is tracked in a
  separate changeset, held back until the React packages release.)

### Minor Changes

- 915f278: Align with the saas-backend `/processes` migration cleanup (saas-backend#582:
  jobs/apikeys consolidation) and fill audited coverage gaps.

  Breaking (routes the backend removed — the old methods 404ed against a current
  backend anyway):

  - API keys moved under `/integrator`: `organizations.listApiKeys` /
    `createApiKey` / `revokeApiKey` now call
    `/integrator/organizations/{addr}/apikeys[/{keyId}]`.
  - `organizations.listJobs`, `organizations.getMembersJob` and
    `organizations.waitForMembersJob` (and `WaitForMembersJobOptions`,
    `AddMembersJobResponse`, `JobInfo`) are removed. Jobs are unified: list org
    jobs via the new `jobs.list({ orgAddress, type?, page?, limit? })`
    (`GET /jobs`), and poll member/census imports with `jobs.waitFor(jobId)` —
    import progress now lives in `job.result.added/total/progress`.
  - `JobStatusResponse.error` (string) is now `errors?: string[]`;
    `JobFailedError` joins them into its message. `JobType` gains
    `set_process_census` and `publish_voting_process`.
  - Integrator quota types match the backend again: `IntegratorLimits` is
    `{ maxManagedOrgs, maxManagedProcesses, maxVotes, maxSMS, maxEmails }`
    (0 = unlimited), `IntegratorUsage` is
    `{ managedOrgs, managedProcesses, sentVotes, sentSMS, sentEmails }`, and
    `IntegratorInfo.limits` is optional (omitted when `enabled` is false).
    `CreateManagedOrganizationRequest` is now `CreateOrganizationRequest &
{ ownerEmail?: string }` (gains `name`, `integrator`, etc.).

  New:

  - `client.info()` — public `GET /info` (`{ chainId, version, goVersion }`;
    the chainId is the service's current chain, not a per-process value).
  - `elections.validateCensus(...)` — `POST /processes/census/validation`.
  - `organizations.addMembers(..., { async: true })` — opt into background
    import, returning a `jobId` for `jobs.waitFor`.

- d65439b: Align with saas-backend #595, #596 and #599 (public draft-gated process reads,
  live per-question results, census totalWeight):

  - New `QuestionResults` type (`voteCount`, `maxVoters`, `finalResults`,
    `results?: string[][]`) — the live on-chain tally resolved on the single
    reads (`GET /processes/{id}` and the public question read) for any published
    question; list items never resolve it (N+1 avoidance).
  - `VotingProcessQuestion.results?` and `PublicQuestionResponse.results?` typed
    accordingly.
  - `VotingProcessQuestionResults` (the `GET /processes/{id}/results` entry)
    reshaped to `QuestionResults` + `questionId`/`upstreamId` — the old
    `status`/`startDate`/`endDate` fields are gone from the backend response and
    `voteCount`/`finalResults` are now optional.
  - `CensusSpec.totalWeight?` (saas-backend#595): whole-census total voting
    weight, response-only; equals `size` for a non-weighted census.
  - `GET /processes` and `GET /processes/{id}` are now **public and draft-gated**
    (saas-backend#599): published processes — including their `chainId` — are
    readable without auth, drafts 404 to non-managers, and `eligibleMemberIds`
    is stripped for non-managers. `elections.get`/`list`/`getResults` docs
    updated; voter apps no longer need an integrator-backend `chainId` handoff.

- 9bb1937: Census surface aligned with the backend's "no census identity" design: the
  process read already carries everything clients need, and the new
  process-scoped admin routes replace the legacy census workarounds.

  **`@vocdoni/api-types`:**

  - `CensusSpec.size` — member count, response-only (`omitempty`; for published
    processes it equals the on-chain `maxCensusSize`). `groupId`/`memberIds`
    documented as create/update inputs that are not returned on reads.
  - `VotingProcessBase.chainId` — the Vochain chain id votes are signed against
    (previously unavailable on process reads).
  - New `ProcessParticipantsResponse` / `ProcessParticipantEntry` /
    `ProcessParticipantQuestionVote` / `ProcessParticipantLookupField` /
    `UpdateProcessCensusResponse` types.

  **`@vocdoni/api-client`:**

  - `elections.participants(id, { field, value })` — admin census-member lookup
    (`GET /processes/{id}/participants`) with per-question voted status.
  - `elections.addCensusMembers(id, memberIds)` — append org members to a
    published process's census (`PUT /processes/{id}/census`); the returned
    `jobId` tracks the async on-chain `maxCensusSize` bump.
  - Fix: `elections.validate()` now targets the real dry-run route
    `GET /processes/{id}/validation` — it previously hit
    `/processes/{id}/check`, which is the public POST CSP voter-eligibility
    route and always failed with a method mismatch.

- 7801e6d: Process listing and status helpers (previously uncovered by any changeset):

  - `elections.list({ orgAddress, page?, limit?, status? })` now targets the
    new-model `GET /processes` route and returns `VotingProcessListResponse`
    (`{ processes, pagination }`). List items carry no tallies — fetch
    `elections.getResults(id)` per process when you need vote counts.
  - New status predicates exported from `@vocdoni/api-client` alongside
    `computeProcessStatus`: `isLive`, `isUpcoming`, `hasResults`,
    `isSecretUntilTheEnd`, and `processVoteCount(results)` (derives a
    process-level ballot count from a results response).

- 0d630b3: Expand `Organization` to faithfully match the SaaS `apicommon.OrganizationInfo`
  schema returned by `GET /organizations/{address}`.

  **Breaking:** `Organization.name`, `description`, and `logo` are now
  `MultilingualText` (locale maps, e.g. `{ default: 'Acme' }`) instead of plain
  `string`s — they are shorthands for `meta["name"]` / `meta["description"]` /
  `meta["logo"]`. Resolve `.default` (or the first value) when displaying them.

  New `MultilingualText` type (`Record<string, string>`). `Organization` now also
  carries `color`, `size`, `type`, `country`, `timezone`, `subdomain`, `active`,
  `communications`, `integrator`, `createdAt`, `managedBy`, `meta`, `counters`
  (`SubscriptionUsage`), `subscription` (`SubscriptionDetails`), and a recursive
  `parent`. `address` stays a hex `string` (the swagger models it as a byte array).
  `SubscriptionUsage` gains `sentVotes`. The standalone `OrganizationInfo` interface
  is now a type alias of `Organization` (same schema, used by managed-org flows).

  `CreateOrganizationRequest` accepts `string | MultilingualText` for `name` /
  `description` / `logo` (a plain string is stored as `{ default: value }`) and gains
  the writable profile fields; `provisionAccount` is unchanged.

- 0f27337: Bundle-less voter CSP flow: new `ProcessesCspClient` exposed as `client.processes`,
  wrapping the process-scoped CSP routes (`/processes/{processId}/auth/{step}`,
  `auth/resend`, `check`, `sign`, `weight`, `sign-info`, and the public
  `questions/{questionId}` read). A voter flow now needs only the process's Mongo
  id — auth tokens are anchored to the process, `chainId` comes from the process
  read, and `sign()` takes each question's `upstreamId` as `electionId`.

  api-types:

  - New `ProcessCheckResponse` / `ProcessQuestionStatus` — the process check
    returns `belongsToProcess` plus per-question `canVote`/`hasVoted` entries
    (one call reports every question).
  - `encryptionKeys?: EncryptionKey[]` added to `VotingProcessQuestion` and
    `PublicQuestionResponse` (absent until the keykeepers publish — poll before
    building an encrypted ballot).
  - Auth request shapes exposed as `AuthRequest` /
    `AuthChallengeRequest` (the shapes are shared by both CSP flows); the old
    names remain as deprecated aliases.

- 0b4c33b: Confirmed-review fixes across the per-question model surface.

  **`@vocdoni/api-client` (breaking):**

  - `elections.update()` now resolves `void` — the backend answers a bare
    `200 OK` with no body, so the previous `Promise<string>` never carried the
    process id it claimed to. Re-`get()` the process if you need the updated shape.
  - `elections.delete()` now targets the new-model `DELETE /processes/{id}` route.
  - `elections.signInfo()` migrated to `POST /processes/{id}/sign-info` and now
    returns the per-question `ProcessSignInfoResponse` (`{ consumed: [...] }`)
    instead of the legacy single-election `ConsumedAddressResponse`.
  - `setStatus()`/`setStatusAndWait()` and `getMetadata()` are documented as
    legacy-only (single-election model, vochain ids); new-model lifecycle goes
    through `setQuestionStatus()`/`bulkSetQuestionStatus()`.
  - Fix: the client's response parser no longer throws `SyntaxError` on the bare
    `200 OK` (`"\n"`) bodies the backend writes for update/delete/status
    endpoints — blank bodies now resolve as empty instead of failing JSON.parse.

  **`@vocdoni/api-types`:** new `ProcessSignInfoResponse` /
  `QuestionConsumedAddress` types; `QuestionStatusID` JSDoc corrected (it is the
  per-question entry of `SetQuestionsStatusRequest`, not a request body).

  **`@vocdoni/ballot`:** the per-question helpers no longer guess.
  `inferQuestionBallotType()` falls back to the named question `type`
  (`singlechoice`/`multichoice`) when `ballotProtocol` is missing and throws
  instead of silently assuming single-choice; `encodeQuestionBallot()` throws on
  more than one selection for single-choice questions (previously extras were
  silently dropped) and on multichoice questions lacking a `ballotProtocol`.

## 0.0.1

### Patch Changes

- Initial release

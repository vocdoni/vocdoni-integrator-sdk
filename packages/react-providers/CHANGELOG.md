# @vocdoni/react-providers

## 3.0.0

### Minor Changes

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

- 7492468: Sign every question of a process in one call via `POST /processes/{id}/sign-batch` (vocdoni/saas-backend#634).

  - `@vocdoni/api-types`: the `SignBatchRequest` / `SignBatchResponse` / `SignBatchResult` / `SignBatchBallot` shapes and the stable `SignFailureCode` union the backend reports per-ballot failures with.
  - `@vocdoni/api-client`: `processes.signBatch()` wraps the endpoint — one auth token, N ballots, one response, always in request order.
  - `@vocdoni/react-providers`: `useElectionAuth().signBatch()` signs every ballot in one round trip (matching results by `upstreamId`, so a dropped entry can never shift a signature onto the wrong question), and `vote()` now uses it instead of looping `processes.sign` per question — even for a single question. Per-question sign refusals are reported inline: the questions that DID sign are still built and relayed (a CSP signature is one-shot — discarding it would strand those questions forever), surfacing as `PartialVoteError`; when nothing signs at all the call throws a plain, fully-retryable error and relays nothing.

### Patch Changes

- Updated dependencies [e6ff0b2]
- Updated dependencies [833a472]
- Updated dependencies [7492468]
  - @vocdoni/api-types@2.0.0
  - @vocdoni/api-client@2.0.0

## 2.2.0

### Minor Changes

- 5c805d3: `vote()` no longer reports failure for votes that actually landed on chain. The relay pipeline previously trusted every negative signal as definitive: a lost `POST /votes` response (network error, proxy 502/504) marked the whole batch failed even when the backend had accepted and enqueued it, a job-reported per-envelope failure ("nullifier already exists") surfaced as a `PartialVoteError` even when the vote was recorded, and a relay job outliving the wait window silently closed the flow with statuses stuck at `confirming`. All three paths now reconcile against the authoritative voter state (`check()` + `sign-info`) before declaring anything failed, recovering the vote ids of whatever landed. Overlapping `vote()` calls are refused while a relay is in flight — a resubmit during the confirmation window would race the pending batch with a fresh ephemeral signer. New `voteOptions` prop on `ElectionProvider` tunes the reconciliation window and the job wait timeout.

## 2.1.1

### Patch Changes

- 242f6f0: Promote `@vocdoni/ballot` and `@vocdoni/api-voting` to 1.0.0.

  No API changes in either package — this is a versioning fix.

  While they sat on `0.x`, every additive change forced a **major** on the React
  packages. `^0.1.2` means `>=0.1.2 <0.2.0`, so a minor (`0.1.2` → `0.2.0`) is
  _out of range_ for a caret dependent and gets majored. That defeats the
  `onlyUpdatePeerDependentsWhenOutOfRange` fix, which only helps when the bump is
  genuinely in range — and for a `0.x` package a minor never is. The practical
  effect was that adding an export to `@vocdoni/ballot` had to ship as a `patch`
  just to avoid gratuitously majoring `@vocdoni/react-components`.

  At `1.x`, `^1.0.0` covers every later minor, so additive changes cascade as
  patches and can be declared honestly.

  The React packages take only a **patch**: their peer ranges on these two
  packages widen from `workspace:^` to `workspace:>=0.1.2 <2`, which spans both
  the old and new majors. That is accurate rather than a workaround — 1.0.0
  changes no API, so `react-components` really does work with both. Consumers on
  `@vocdoni/react-components@^2` keep working with no range change.

## 2.1.0

### Minor Changes

- 26228bf: Surface every question's vote id, not just the first one.

  **`@vocdoni/react-providers`:** `useElection()` gains `voteIds: Record<questionId, string>` — every nullifier the voter holds for the process. It is populated from the outcomes of `vote()`, from the questions that _did_ land when `vote()` throws `PartialVoteError` (a partial cast no longer loses the ids it produced), and, on connect, recovered from `POST /processes/{id}/sign-info` when the membership check reports something voted — so a voter returning after a page reload still sees all of their ids instead of none. A sign-info failure is swallowed and leaves membership resolved. `voteId` keeps working unchanged and is now marked `@deprecated`: votes are relayed per question, so it only ever exposes one of them.

  **`@vocdoni/react-components`:** `<Voted />` now renders one entry per voted question, pairing each question's title with its vote id (still link-ified), in process order. The `Voted` slot gains an additive `votes: VotedVote[]` prop (`{ questionId, questionTitle, voteId, description }`); the existing `description` prop now carries every line joined, so slot overrides written against the old single-string API keep showing all of the ids. A single voted question still renders the exact `vote.voted_description` sentence it did before; multiple questions use the new `vote.voted_question_description` key.

### Patch Changes

- 3e867d2: Publish internal peer dependencies as caret ranges instead of exact pins.

  `workspace:*` peers resolve to the exact version at publish time, so every
  release of a peer forced a lockstep major on its dependents and pinned
  consumers to one precise version. Peers now use `workspace:^`, which publishes
  as `^x.y.z`, and changesets is configured with
  `onlyUpdatePeerDependentsWhenOutOfRange` so an in-range peer bump cascades as
  a patch (via `updateInternalDependents: 'always'`) rather than a major.

## 2.0.1

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

- Updated dependencies [f84bf33]
  - @vocdoni/api-client@1.1.1
  - @vocdoni/api-types@1.1.1
  - @vocdoni/api-voting@0.1.2

## 2.0.0

### Major Changes

- dac953d: Merge `ProcessProvider` into `ElectionProvider`. The CSP voter session (auth0/auth1/resend/check/sign) and the election data + vote flow always target the same voting process, so the two-provider split bought no real composability — one provider now does everything, matching the pre-migration SDK's mental model.

  - `useElection()` additionally exposes the session: `authToken`, `auth0`, `auth1`, `resend`, `check`, `sign`, plus `chainId`. `clearVoter()` clears the session and the vote state.
  - New `useElectionAuth()` hook reads the session from its own context, so auth-only widgets (identify forms, OTP inputs, logout buttons) don't re-render on election data/results updates. Its `clear()` also resets the vote state (`hasVoted`, `voteId`, `isInCensus`).
  - BREAKING: `ProcessProvider`, `useProcess`, `useProcessOptional`, `ProcessContextValue`, `ProcessProviderProps` and `ProcessSignResult` are removed. Replace `<ProcessProvider id><ElectionProvider id>` nesting with a single `<ElectionProvider id>`; replace `useProcess()` with `useElectionAuth()` (session) or `useElection()` (everything). `ProcessSignResult` is now `ElectionSignResult`.
  - BREAKING: `processQueryKeys` is renamed to `electionQueryKeys` (`.process(id)` → `.election(id)`; key shapes are unchanged, so seeded caches keep working).

- 80bef5b: Migrate the React voter flow to the process-scoped CSP routes (the backend dropped the bundle routes):

  - `BundleProvider`/`useBundle` removed; the voter session is anchored to the voting process Mongo id and exposes `auth0`/`auth1`/`resend`/`check`/`sign` — one verified token covers every question of the process.
  - `ElectionProvider`: new `voterQuestions` (per-question `canVote`/`hasVoted` from the CSP check); `hasVoted` derives as "every question voted"; read-only use (results, status) needs no auth session at all.
  - `vote()` signs via `processes.sign` and seals `secretUntilTheEnd` ballots with `question.encryptionKeys` — encrypted voting now works in React. A secret question with unpublished keys throws before the CSP sign is consumed (never casts cleartext).

- bf2f39e: Complete rewrite for the Vocdoni SaaS API. Both packages are rebuilt on `@vocdoni/api-client`/`@vocdoni/api-voting` (the SaaS multi-question `/processes` model) instead of `@vocdoni/sdk` and direct chain access: one `ElectionProvider` per voting process drives election data, the CSP voter auth session (`useElectionAuth`) and the phased multi-question vote flow (`vote()`, `PartialVoteError`, per-question `voteStatus`), with `ClientProvider`/`AuthProvider`/`OrganizationProvider`/`ActionsProvider` around it and react-query as the fetching layer. Peer dependencies change accordingly: `@vocdoni/sdk`, `@ethersproject/*` and `react-router` are gone; `@tanstack/react-query` and the `@vocdoni/api-*` workspace packages are required. APIs kept from the old packages keep their names and props (`id`/`election` prefetching, `queryOptions`, `useElection`, the `<Election* />` components); anything tied to the legacy single-election/bundle model is removed.
- 80bef5b: React layer of the `Election` → `VotingProcessResponse` per-question migration.

  **Breaking (`@vocdoni/react-providers`):** `useElection()` returns
  `election: VotingProcessResponse | null`, `status: QuestionStatus | null`
  (computed via `computeProcessStatus`), and
  `results: VotingProcessResultsResponse | null`. `vote()` signature changed from
  `vote(choices: number[])` to `vote(encodedBallots: number[][])` — one encoded
  ballot array per question.

  **`@vocdoni/react-components`:** components updated for the new process model.
  `QuestionStatus` values now use `ONGOING` (replaces `READY`).

### Minor Changes

- 80bef5b: Expose session expiry and external token injection from `AuthProvider` / `useAuth`.

  `useAuth()` now returns `expiry` (the current token's expiry timestamp, read from
  `AuthToken.expirity`) and `setSession(session)`, which stores a token obtained
  out-of-band (e.g. OAuth or an app's own login mutation) without calling the API.
  `login()` and `refresh()` now capture and persist the expiry and return the full
  `AuthToken` (awaiting them for side effects only remains backwards compatible).
  Expiry is persisted to `localStorage` under `${storageKey}.expiry` alongside the
  token, and `logout()` clears both. No auto-refresh timers are added — the
  consuming app owns its renew policy.

- 180a9b3: `ElectionProvider.vote()` now relays every question's envelope in ONE batch call (`POST /votes`) instead of one relay per question. The backend accepts or rejects the batch as a unit, so a rejection (bad payload, full queue…) relays nothing and surfaces as a plain, fully-retryable error — never a partial vote; `PartialVoteError` keeps its exact shape but is now only thrown for chain-level failures reported by the batch job's per-envelope outcomes. New `voteStatus` on `useElection()`: per-question progress of the current/last `vote()` call (`signing` → `submitting` → `confirming` → `confirmed` | `failed`, with already-voted questions as `confirmed`), updated live while the batch job settles — drive per-question spinners with it. `vote()` also refuses more than 100 questions per call (the relay cap) before consuming any CSP signature. Requires a backend with saas-backend#610.
- 3dc0a36: Restore `ElectionProvider`'s `election` prop for prefetched data. The provider again accepts a `VotingProcessResponse` (e.g. from SSR or a list view) and renders it immediately with no loading state, seeding it into the react-query cache as `initialData` — so it still refetches by id once the data goes stale. `id` is now optional and derived from `election.id` when omitted; the props type requires at least one of the two. A prefetched election whose id mismatches an explicit `id` prop is ignored rather than seeded under the wrong cache entry.
- 80bef5b: Pagination and cache-control surface (previously uncovered by any changeset):

  **Breaking (`@vocdoni/react-components`):** pagination is always 1-based — the
  `initialPage` abstraction was dropped from `PaginationProvider` /
  `RoutedPaginationProvider` and the `Pagination` components. The
  `RoutedPagination` component is exported from the package root again.

  **`@vocdoni/react-providers` / `@vocdoni/react-components`:** both packages
  export `electionQueryKeys` (the TanStack Query keys `ElectionProvider` uses for
  its election and results fetches) so host apps can invalidate or prefetch that
  cached state.

- f7b332f: Restore per-provider react-query configuration and the organization prefetch prop, matching the old ui-components API. `ElectionProvider` accepts `queryOptions` (the election read) and `resultsQueryOptions` (the results read — e.g. `refetchInterval` for live tallies); `OrganizationProvider` accepts `queryOptions` and an `organization` prop for prefetched data (seeded as `initialData`, with `id` derived from `organization.address` when omitted). As in the old API, `queryKey`/`queryFn`/`enabled`/`initialData` stay provider-owned. `OrganizationProvider`'s fetch prop is `id` (the org address), and `organizationQueryKeys` is exported for cache pre-seeding/invalidation, mirroring `electionQueryKeys`.
- fa7c1be: Expose the vote-in-flight state. `useElection()` gains `voting: boolean`, true exactly while a `vote()` call runs — from entry until it settles, on both success and error — for "processing your vote" overlays. `<VoteButton />` now disables itself and reports `loading` while a vote is in flight, closing the double-submit window (previously it stayed clickable with `loading` hardcoded to `false`).
- 80bef5b: Per-question vote memos in React (`VoteEnvelope.memo`, proto 1.15.13):

  - `ElectionProvider.vote(encodedBallots, memos?)` — optional per-question
    memo strings, validated pre-flight (memo count and the chain's 256
    UTF-8-byte cap are checked before any one-shot CSP signature is consumed).
  - `react-components`: reserved `memo.{index}` form fields (`memo.0`, …) in
    the questions form are collected as per-question memos; empty strings are
    dropped. No memo input is rendered by default — register one in the form
    slot to collect it.
  - Memos ride the vote envelope in cleartext, even on `secretUntilTheEnd`
    elections — only the vote package is encrypted.

- 80bef5b: `ElectionProvider.vote()` can no longer half-vote a multi-question process silently (#5). Casting is now phased: every question is pre-flight-validated (upstreamId, published encryption keys) and every transaction CSP-signed and built **before** anything is relayed — a failure in those phases aborts with zero votes on chain. A fresh `processes.check()` on entry skips questions already voted, so calling `vote()` again after a failure resumes the remaining questions instead of failing on a double-vote. When some questions land and others fail at relay/confirmation, `vote()` refreshes the voter state to the on-chain truth and throws the new `PartialVoteError` (exported), which names `succeeded` (with per-question vote ids) and `failed` (with per-question errors) so UIs can offer a retry.

  Note: the vochain has an ordered batch-submit endpoint (`POST /chain/transactions/batch`, vocdoni-node#1420), but saas-backend does not expose it to voters yet — `POST /vote` takes one signed envelope. Until it does, the relay phase is one call per question; once a SaaS batch relay exists, the already-built transactions can go out in a single call and shrink the partial window to nothing.

### Patch Changes

- 80bef5b: ElectionProvider: treat a 404 from `GET /processes/{id}/results` as "no results yet". The results query now resolves to `null` on 404 instead of erroring, so react-query no longer retries an endpoint that legitimately 404s before results exist.
- 80bef5b: `ElectionProvider.vote()` fails fast — before consuming any one-shot CSP
  signature — when the encoded-ballot count doesn't match the question count or
  the process has no questions. Previously a missing ballot was silently cast as
  an empty one (`?? []`), and a zero-question process "succeeded" with
  `hasVoted = true` and an empty voteId.
- Updated dependencies [180a9b3]
- Updated dependencies [41497df]
- Updated dependencies [8212fcd]
  - @vocdoni/api-types@1.1.0
  - @vocdoni/api-client@1.1.0
  - @vocdoni/api-voting@0.1.1

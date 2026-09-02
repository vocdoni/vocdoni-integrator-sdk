# @vocdoni/api-client

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

### Patch Changes

- 833a472: Read a ranking back out of a ranked election.

  A ranked question could be encoded but not decoded: its results were only ever readable as
  "how many voters ranked each option", which is the same number for every option and
  therefore useless. The winner was unrecoverable through the SDK, and any UI built on
  `inferQuestionBallotType` rendered a checkbox group for it.

  The obstacle is that a ranked `ballotProtocol` is **byte-identical** to a pick-slot
  multichoice whose voters fill every slot, while meaning the transpose of it — ranked reads
  the field index as the _option_ and its value as the _rank_; pick-slot reads the field
  index as a _slot_ and its value as the _chosen option_. No shape rule can separate them, so
  this plugs into the declared-name channel instead:

  ```ts
  // creation — the raw protocol alone is ambiguous, the metadata bag is not
  {
    choices: [/* … */],
    ballotProtocol: { maxCount: 4, maxValue: 3, uniqueValues: true, /* … */ },
    metadata: { type: { name: 'ranked' } },
  }
  ```

  The backend's own `type` vocabulary is `['singlechoice', 'multichoice']` and rejects
  anything else, but it stores and echoes the creator metadata bag verbatim — the same route
  the legacy `multiple-choice` name already uses — so no backend change is involved.
  `type: 'ranked'` is read too, for callers keeping their own record of the kind.

  **`@vocdoni/ballot`**

  - `BallotType.Ranked`, selected only by that declaration. It is never inferred from the
    protocol, because nothing in the protocol distinguishes it.
  - `decodeQuestionResults` / `decodeResults` aggregate ranked questions with **Borda**
    (`Σ count × rank`) — the only method the tally can express, since it is a per-field
    histogram with the individual ballots already discarded, and what `saas-integrator-demo`
    computes. `votes` is therefore **points, not voters**, and percentages are each option's
    share of the total points. **No `abstain` bucket**: those sentinel columns are a pick-slot
    device for unfilled slots, and a ranking has none.
  - `rankedOrderToScores(question, order)` turns the voter's ordering (choice values, best
    first) into the wire ballot, applying the canonical **highest = best** orientation. Use it
    rather than building the array by hand: the decode is an index-weighted sum, so a ballot
    ranked with `0` as "best" is perfectly valid and elects the loser, with nothing on either
    side able to notice. It throws on a ranking that repeats a choice, names an unpublished
    one, or leaves any option unranked.
  - `encodeQuestionSelections(question, selections)` encodes what a voter-facing form
    collects, for **any** ballot type: the ordering for a ranked question (transposed for
    you), the raw selections for everything else. The per-type branch lives here rather than
    at every call site, where writing it the wrong way round produces a valid ballot that
    elects the loser. Prefer it over `encodeQuestionBallot` in UI code.
  - `encodeQuestionBallot` / `encodeBallot` keep passing a ranking straight through, and still
    refuse a duplicated rank or one above `maxValue`. They now also refuse a ranking that is
    not **one rank per option** — previously a short slate encoded fine while
    `validateSelections` rejected the identical input, so a UI gating its submit button on the
    validator disagreed with the codec. `validateSelections` gained the matching ranked rules,
    `questionSelectionRange` reports `{min: n, max: n}` (a partial ranking cannot be counted),
    and `declaresRanked(question)` exposes the check — resolving the declared name exactly as
    `inferQuestionBallotType` does, so the two can never disagree in either direction.
  - Two more ranked defects are refused for every voter and at creation, because no individual
    ballot shows either: **two choices sharing a `value`** (the ballots stay well-formed, but
    the decoded rows are keyed by choice value, so two options return under one id and a
    ranking cannot order them), and an election-level `ranked` declaration carrying **more than
    one question** — a ranking fills the whole ballot, so `inferBallotType` now throws rather
    than let `encodeBallot` put only `questions[0]` on the wire and `decodeResults` report
    `questions[0]`'s scores for every question.
  - `unrankableProtocolReason(numChoices, maxValue)` catches the one protocol a ranking can
    never survive: `maxValue: 0`. That means "no upper bound" for every other type, but on
    chain it switches the scrutinizer to discrete aggregation — one column per option instead
    of a histogram — so the Borda index-weighted sum scores every option zero however anyone
    votes, and the result is indistinguishable from an election nobody voted in. Folded into
    `unsatisfiableQuestionReason` (whose parameter type gained `metadata`, needed to see the
    declaration) and refused up front by both encoders and `validateSelections`, so the three
    cannot drift apart.

  **`@vocdoni/react-components`**

  - Ranked questions render a **rank widget** — one position control per option, through a new
    `QuestionRankChoice` slot — instead of the checkbox group they used to get. Assigning an
    option a position another holds swaps the two. The default slot is a `<select>`; override
    it for drag-and-drop.
  - `QuestionSelectionMode` gained `'ranked'` alongside `'single'` / `'multiple'`.
  - The form collects the voter's ordering and `QuestionsFormProvider` encodes it with
    `encodeQuestionSelections`; submitting is blocked until every option is placed. Assigning
    a position held by another option when the moved one was unranked now **reseats** the
    displaced option in the first free place instead of silently dropping it.
  - `<QuestionsTypeBadge />` and `<QuestionTip />` label and count ranked questions.

  **`@vocdoni/api-client`**

  - `elections.create` / `update` validate each question's ballot config with the
    _question_-level rule instead of the protocol-level one, so a question declared `ranked`
    with `maxValue: 0` — or with duplicate choice values — is refused at the one moment it can
    still be fixed. The protocol-level rule waves both through by design: it mirrors the
    backend, which has no concept of a ranked question.

  The integration suite now casts a real ranked vote and asserts the recovered ordering plus
  the raw matrix the chain produced, replacing the placeholder that had to enshrine a
  meaningless tally.

  Closes #22.

- Updated dependencies [e6ff0b2]
- Updated dependencies [833a472]
- Updated dependencies [7492468]
  - @vocdoni/api-types@2.0.0
  - @vocdoni/ballot@1.2.0

## 1.2.1

### Patch Changes

- fbe32bf: Refuse questions that publish an option no voter can cast.

  A ballot config can be perfectly satisfiable and still carry a choice that is dead on
  arrival. That failure is nastier than an all-zero tally: the election runs, most votes
  count, and the unreachable option quietly polls zero while `voteCount` keeps rising.
  Confirmed against a live chain (`integration/value-skew.itest.ts`) — the API accepts the
  config, the relay accepts the ballot, the chain counts the envelope, and the scrutinizer
  discards it at aggregation with no error on any surface:

  ```
  API ACCEPTED the malformed election (values 1/2/3 under maxValue 2)
  member 1 → wire [1] relay=completed
  member 2 → wire [3] relay=completed
  voteCount  = 2
  raw matrix = [["0","1","0"]]     ← C1 counted, C3 lost
  ```

  - New `uncastableChoicesReason(question)` / `hasUncastableChoices(question)` explain
    the defect, or return `null`/`false` when every choice is reachable. The rule follows
    how each layout addresses its fields:
    - **single-choice** is _value_-addressed (the field carries `choice.value` and the
      results row is indexed by it), so every value must fit `0..maxValue` and no two
      choices may share a value — duplicates read the same column, so one vote is counted
      for both and the percentages sum past 100. Sparse values are legal and deliberate;
      `maxValue` is derived from the highest value, not the option count, and unused
      columns simply stay empty. `maxValue: 0` means unbounded, not a ceiling of zero.
    - **pick-slot multichoice** shares one value space with the abstain sentinels
      (`choices.length`, `+1`, …, and decode claims every column `>= choices.length`), so
      its values must be exactly the _set_ `0..choices.length-1` — in any order, since
      nothing in that layout is positional — and `maxValue` must still clear the highest
      of them.
    - **approval / dense multichoice / budget / quadratic** are position-addressed, where
      `choice.value` is a display label the wire never sees, and carry no constraint.
  - `client.elections.create/update` rejects the config at creation, where it is still
    fixable; after publish the only remedy is a new election. This is a gap the backend
    does not cover — `VoteTypeFromQuestion` passes a raw `ballotProtocol` straight through
    without ever comparing it to the question's own choice values.
  - At **encode** time the two halves of the rule are treated differently, because they
    fail differently:
    - A value above `maxValue` is already caught per ballot by `assertEncodedBallot`, so
      only the voter picking the unreachable option is refused. The live run above shows
      why the line is drawn there: on such an election the in-range votes are still
      tallied correctly, and refusing everybody would discard ballots the chain records
      fine. `encodeBallot` / `encodeQuestionBallot` now explain _why_ when this happens,
      replacing the wire-level "field 0 is 3, above maxValue 2" with the election-level
      diagnosis. Failure path only — a healthy vote pays nothing for it.
    - A pick-slot value colliding with the abstain sentinels has no per-ballot backstop:
      the colliding values are _within_ `maxValue`, so no individual ballot is wrong while
      abstentions and real picks are being conflated. That one is refused up front, for
      every voter.
  - `validateSelections` mirrors the same split, so a UI gating its submit button on it no
    longer enables a vote that `encodeBallot` then refuses.
  - `isPickSlotLayout(question)` is now the single home for the pick-slot/dense
    discrimination, replacing three hand-written copies (one of them a de Morgan'd
    negation) in encode, decode and the reachability check.
  - `@vocdoni/react-components` no longer renders the encoder's creator-facing explanation
    as a voter's field error. A question that cannot accept votes shows a voter-appropriate
    message (`errors.question_not_votable`); the technical detail goes to the console.

  Only reachable through a raw `ballotProtocol`: the named types either derive their bounds
  _from_ the values (`singlechoice`) or ignore them entirely (`multichoice`). Decoding is
  unchanged — single-choice results are read by `choice.value`, which is the backend
  contract (saas-backend `account/ballot.go` and `db/types.go`) and is now pinned by unit
  tests and a live round-trip (`raw matrix = [["0","1","1","1"]]` for values 1/2/3, column 0
  empty) so it is not "fixed" into positional indexing. See integrator-sdk#28.

- Updated dependencies [d9212f0]
- Updated dependencies [a5f94b1]
- Updated dependencies [4491324]
- Updated dependencies [fbe32bf]
  - @vocdoni/api-types@1.2.0
  - @vocdoni/ballot@1.1.0

## 1.2.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [e7a7dae]
- Updated dependencies [e7a7dae]
- Updated dependencies [242f6f0]
  - @vocdoni/ballot@1.0.0
  - @vocdoni/api-types@1.1.2

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

- Updated dependencies [f84bf33]
  - @vocdoni/api-types@1.1.1

## 1.1.0

### Minor Changes

- 180a9b3: Support the batch vote relay (`POST /votes`, saas-backend#610). New `RelayVotesRequest` and per-envelope `VoteJobResult` types, the `relay_votes` job type, and `JobResult` gains `nullifier`/`processId` (seeded at job creation on relay jobs — readable while pending) plus `votes` (batch outcomes in request order; present on failed jobs too). `elections.voteBatch()` relays up to 100 signed envelopes in one call that the backend accepts or rejects as a unit, and `jobs.waitFor()` gains an `onPoll` callback to observe intermediate job states (e.g. batch entries settling one by one). Also documents that `CensusSpec.groupId` round-trips on process reads since saas-backend#606 (and that org-wide censuses no longer report an all-zeros `groupID` on the org censuses list).

### Patch Changes

- 8212fcd: Normalize the wire question status `READY` to `ONGOING` at the read boundary. The backend emits `READY` for a live question — semantically identical to `ONGOING`, the only name `QuestionStatus` declares — which leaked through `elections.get`/`list`/`getQuestion` and broke every `status === 'ONGOING'` comparison downstream (e.g. `VoteButton` disabling itself on a live process). All process/question reads now map it via the exported `normalizeQuestionStatus`/`normalizeVotingProcess`, and `computeProcessStatus` also normalizes defensively so raw wire data that skipped the client (e.g. SSR payloads passed to `<ElectionProvider election>`) derives correctly too. The lowercase `ready` of the write API (`SetElectionStatusRequest`, bulk question status) is unchanged.
- Updated dependencies [180a9b3]
- Updated dependencies [41497df]
- Updated dependencies [8212fcd]
  - @vocdoni/api-types@1.1.0

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

- f6ed4f3: Remove `BundleClient.getParticipant()` (breaking). The by-id participant reads
  — bundle-scoped and the process-scoped equivalent — were backend placeholders
  that always returned `null` (pending a CSP indexer lookup that never landed),
  no frontend ever called them, and the backend is removing the endpoints from
  the API. Voter status checks go through `check()` / `signInfo()` /
  `participantsCheck()`; admin member lookups through `elections.participants()`.
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

- b3dd6b9: `jobs.waitFor` accepts a new optional `expectType` in `WaitForJobOptions`; when set, a completed job with a different type now throws instead of resolving silently.
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

### Patch Changes

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

- Updated dependencies [915f278]
- Updated dependencies [d65439b]
- Updated dependencies [9bb1937]
- Updated dependencies [a280996]
- Updated dependencies [7801e6d]
- Updated dependencies [0d630b3]
- Updated dependencies [19a0b09]
- Updated dependencies [0f27337]
- Updated dependencies [0b4c33b]
- Updated dependencies [2a0cbed]
  - @vocdoni/api-types@1.0.0

## 0.0.1

### Patch Changes

- Initial release
- Updated dependencies
  - @vocdoni/api-types@0.0.1

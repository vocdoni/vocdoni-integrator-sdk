# @vocdoni/react-components

## 3.0.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [e6ff0b2]
- Updated dependencies [7492468]
  - @vocdoni/api-types@2.0.0
  - @vocdoni/react-providers@3.0.0

## 2.1.2

### Patch Changes

- 2ca5cc9: `<ElectionResults />` no longer renders an "Abstention" row for elections where abstaining
  is impossible.

  The decoder always emits the multichoice `{ choice: 'abstain' }` bucket, so a pick-slot
  protocol reserving no sentinel headroom (`maxValue < numChoices - 1 + (uniqueValues ?
maxCount : 1)`) surfaced a permanent "Abstention: 0" on a ballot no voter can abstain on —
  the matrix has no sentinel column, so the chain has nowhere to record one. Confirmed against
  a dev election whose own metadata reports `canAbstain: false`.

  The row is now suppressed only when abstention is both structurally impossible **and**
  unmeasured:

  - headroom reserved → shown, including at `0`, because that zero is a real measurement;
  - no headroom, bucket `0` → hidden (the fix);
  - no headroom but a non-zero bucket → still shown. Sentinel _columns_ appear at
    `maxValue >= numChoices`, slightly before headroom is formally reserved, so a protocol
    in between can carry real abstentions. Hiding those would lose a measurement and leave
    the visible percentages summing to under 100%, since the decoder counts abstain in the
    denominator either way.

  This also reconciles the two multichoice wire layouts, which previously disagreed: the dense
  layout decodes as approval and emits no bucket at all, while pick-slot always emitted one.
  Both now reach the same verdict for the same election.

  Integrators overriding the `ElectionResults` slot who index `choices` positionally, or who
  assume a trailing abstain entry, will see one fewer row for no-headroom multichoice
  questions. Decoding is unchanged — `@vocdoni/ballot` is untouched.

- 7271b7e: Fix the multichoice selection counter in `QuestionTip`: it read form field `0` regardless of which question it belonged to, and through a non-reactive `getValues()` snapshot, so the "you selected X options" count never followed the voter's selections. The tip now subscribes to its own question's field via `useWatch`.
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

## 2.1.1

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
  - @vocdoni/react-providers@2.0.1
  - @vocdoni/api-types@1.1.1
  - @vocdoni/ballot@0.1.2

## 2.0.0

### Major Changes

- dac953d: Merge `ProcessProvider` into `ElectionProvider`. The CSP voter session (auth0/auth1/resend/check/sign) and the election data + vote flow always target the same voting process, so the two-provider split bought no real composability — one provider now does everything, matching the pre-migration SDK's mental model.

  - `useElection()` additionally exposes the session: `authToken`, `auth0`, `auth1`, `resend`, `check`, `sign`, plus `chainId`. `clearVoter()` clears the session and the vote state.
  - New `useElectionAuth()` hook reads the session from its own context, so auth-only widgets (identify forms, OTP inputs, logout buttons) don't re-render on election data/results updates. Its `clear()` also resets the vote state (`hasVoted`, `voteId`, `isInCensus`).
  - BREAKING: `ProcessProvider`, `useProcess`, `useProcessOptional`, `ProcessContextValue`, `ProcessProviderProps` and `ProcessSignResult` are removed. Replace `<ProcessProvider id><ElectionProvider id>` nesting with a single `<ElectionProvider id>`; replace `useProcess()` with `useElectionAuth()` (session) or `useElection()` (everything). `ProcessSignResult` is now `ElectionSignResult`.
  - BREAKING: `processQueryKeys` is renamed to `electionQueryKeys` (`.process(id)` → `.election(id)`; key shapes are unchanged, so seeded caches keep working).

- bf2f39e: Complete rewrite for the Vocdoni SaaS API. Both packages are rebuilt on `@vocdoni/api-client`/`@vocdoni/api-voting` (the SaaS multi-question `/processes` model) instead of `@vocdoni/sdk` and direct chain access: one `ElectionProvider` per voting process drives election data, the CSP voter auth session (`useElectionAuth`) and the phased multi-question vote flow (`vote()`, `PartialVoteError`, per-question `voteStatus`), with `ClientProvider`/`AuthProvider`/`OrganizationProvider`/`ActionsProvider` around it and react-query as the fetching layer. Peer dependencies change accordingly: `@vocdoni/sdk`, `@ethersproject/*` and `react-router` are gone; `@tanstack/react-query` and the `@vocdoni/api-*` workspace packages are required. APIs kept from the old packages keep their names and props (`id`/`election` prefetching, `queryOptions`, `useElection`, the `<Election* />` components); anything tied to the legacy single-election/bundle model is removed.
- 80bef5b: Pagination and cache-control surface (previously uncovered by any changeset):

  **Breaking (`@vocdoni/react-components`):** pagination is always 1-based — the
  `initialPage` abstraction was dropped from `PaginationProvider` /
  `RoutedPaginationProvider` and the `Pagination` components. The
  `RoutedPagination` component is exported from the package root again.

  **`@vocdoni/react-providers` / `@vocdoni/react-components`:** both packages
  export `electionQueryKeys` (the TanStack Query keys `ElectionProvider` uses for
  its election and results fetches) so host apps can invalidate or prefetch that
  cached state.

### Minor Changes

- 80bef5b: Confirm dialogs work out of the box: `QuestionsFormProvider`, `ActionCancel`
  and `ActionEnd` now mount their own `ConfirmProvider` when none is present, so
  they no longer crash without a manually-mounted provider. New
  `EnsureConfirmProvider` export (idempotent — an app-provided `ConfirmProvider`
  still takes precedence).
- 80bef5b: Migrate the React voter flow to the process-scoped CSP routes (the backend dropped the bundle routes):

  - `BundleProvider`/`useBundle` removed; the voter session is anchored to the voting process Mongo id and exposes `auth0`/`auth1`/`resend`/`check`/`sign` — one verified token covers every question of the process.
  - `ElectionProvider`: new `voterQuestions` (per-question `canVote`/`hasVoted` from the CSP check); `hasVoted` derives as "every question voted"; read-only use (results, status) needs no auth session at all.
  - `vote()` signs via `processes.sign` and seals `secretUntilTheEnd` ballots with `question.encryptionKeys` — encrypted voting now works in React. A secret question with unpublished keys throws before the CSP sign is consumed (never casts cleartext).

- f7b332f: Restore per-provider react-query configuration and the organization prefetch prop, matching the old ui-components API. `ElectionProvider` accepts `queryOptions` (the election read) and `resultsQueryOptions` (the results read — e.g. `refetchInterval` for live tallies); `OrganizationProvider` accepts `queryOptions` and an `organization` prop for prefetched data (seeded as `initialData`, with `id` derived from `organization.address` when omitted). As in the old API, `queryKey`/`queryFn`/`enabled`/`initialData` stay provider-owned. `OrganizationProvider`'s fetch prop is `id` (the org address), and `organizationQueryKeys` is exported for cache pre-seeding/invalidation, mirroring `electionQueryKeys`.
- 80bef5b: React layer of the `Election` → `VotingProcessResponse` per-question migration.

  **Breaking (`@vocdoni/react-providers`):** `useElection()` returns
  `election: VotingProcessResponse | null`, `status: QuestionStatus | null`
  (computed via `computeProcessStatus`), and
  `results: VotingProcessResultsResponse | null`. `vote()` signature changed from
  `vote(choices: number[])` to `vote(encodedBallots: number[][])` — one encoded
  ballot array per question.

  **`@vocdoni/react-components`:** components updated for the new process model.
  `QuestionStatus` values now use `ONGOING` (replaces `READY`).

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

### Patch Changes

- 80bef5b: Use `questionSelectionRange` for the multichoice pick bound in `QuestionsTypeBadge`, `QuestionTip` and the multichoice checkbox fields instead of raw `ballotProtocol.maxCount`. On the dense named-multichoice layout `maxCount` is the number of choices — the real bound is `maxTotalCost` — so the UI previously showed the wrong "select up to N" figure and failed to cap selections, letting voters build ballots the chain silently discards.
- 80bef5b: Fix QuestionsConfirmation slot props: `election` is now typed as `VotingProcessResponse` (was legacy `Election`), matching what the component actually passes.
- 80bef5b: `ElectionResults` now pairs results entries to questions by `questionId`
  instead of array position, so reordered or sparse results responses (e.g. a
  question not yet published) can no longer render tallies under the wrong
  question.
- Updated dependencies [80bef5b]
- Updated dependencies [180a9b3]
- Updated dependencies [aaa4765]
- Updated dependencies [41497df]
- Updated dependencies [180a9b3]
- Updated dependencies [3dc0a36]
- Updated dependencies [80bef5b]
- Updated dependencies [dac953d]
- Updated dependencies [8212fcd]
- Updated dependencies [80bef5b]
- Updated dependencies [bf2f39e]
- Updated dependencies [80bef5b]
- Updated dependencies [f7b332f]
- Updated dependencies [80bef5b]
- Updated dependencies [80bef5b]
- Updated dependencies [fa7c1be]
- Updated dependencies [80bef5b]
- Updated dependencies [80bef5b]
  - @vocdoni/react-providers@2.0.0
  - @vocdoni/api-types@1.1.0
  - @vocdoni/ballot@0.1.1

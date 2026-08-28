# Reference: @vocdoni/api-voting

The client-side cryptography and transaction-building layer. It knows nothing about HTTP — it produces a signed hex payload (`SignedTx`) that the api-client relays via `POST /vote`.

Install alongside api-client:

```bash
pnpm add @vocdoni/api-voting @vocdoni/api-client
```

---

## VotingClient

The high-level entry point. Inject a `VocdoniApiClient` (or any object that satisfies the `VoteApiClient` interface) at construction; call `vote()` to build, sign, and relay in one step.

```ts
import { VotingClient } from '@vocdoni/api-voting'
import { VocdoniApiClient } from '@vocdoni/api-client'

const client = new VocdoniApiClient({ apiUrl })
const voting = new VotingClient({ client })

const jobId = await voting.vote(options) // returns the async job id
const job   = await client.jobs.waitFor(jobId)
const nullifier = job.result?.voteID
```

`VoteApiClient` interface — only `elections.vote()` is required, so you can pass the full client or a slimmer adapter:

```ts
interface VoteApiClient {
  elections: { vote(req: RelayVoteRequest): Promise<RelayVoteResponse> }
}
```

---

## buildVoteTransaction

Lower-level function for when you want to relay the tx yourself or inspect the payload.

```ts
import { buildVoteTransaction } from '@vocdoni/api-voting'

const txPayload = buildVoteTransaction(options) // hex-encoded SignedTx
await client.elections.vote({ txPayload })
```

### BuildVoteTransactionOptions

| Field | Type | Required | Notes |
|---|---|---|---|
| `processId` | `string` | yes | On-chain (Vochain) hex id for ONE question — `question.upstreamId` from `VotingProcessResponse.questions[i]`, not the process's Mongo `id` |
| `choices` | `number[]` | yes | Ballot values for that one question — see "Choices format" below |
| `chainId` | `string` | yes | From `election.chainId` on the public process read (`client.elections.get` — published processes need no auth). There is no per-question `chainId`, and `client.info().chainId` is NOT a substitute (it's the service's current chain, not the process's) |
| `signer` | `EphemeralSigner` | yes | Fresh per-vote ephemeral keypair |
| `cspSignature` | `string` | yes | Hex signature from `processes.sign()` |
| `cspWeight` | `string` | no | Hex census weight from the same sign response; omit if absent |
| `encryptionKeys` | `EncryptionKey[]` | no | Required when `question.secretUntilTheEnd` is `true`; see "Encrypted elections" below for how keys are sourced |
| `proofType` | `ProofCA_Type` | no | Defaults to `ECDSA_PIDSALTED` (correct for all SaaS CSP processes) |
| `memo` | `string` | no | Free-text note attached to the vote (e.g. an open "Other" answer). Max 256 UTF-8 **bytes** (`MAX_MEMO_BYTES`, validated client-side; throws when over). ⚠️ Always cleartext on the envelope — never put sensitive text here, even on `secretUntilTheEnd` elections (only the vote package is encrypted) |

---

## EphemeralSigner

Generates a fresh secp256k1 keypair per vote. The CSP signs its Ethereum address; the signer then signs the Vochain transaction (EIP-191 `personal_sign`).

```ts
import { EphemeralSigner } from '@vocdoni/api-voting'

const signer = new EphemeralSigner()
signer.address    // '0x...' — pass to processes.sign() as `payload`
signer.publicKey  // Uint8Array (65 bytes, uncompressed)
signer.privateKey // Uint8Array (32 bytes) — ephemeral, safe to discard after the vote
```

Never reuse a signer across votes. One `new EphemeralSigner()` per vote call.

---

## Choices format

`buildVoteTransaction` builds ONE transaction for ONE question. `choices` maps
directly to the `votes` field in that question's on-chain vote package JSON.
The array length must equal `question.ballotProtocol.maxCount`; each value
must be in `[0, question.ballotProtocol.maxValue]`.

A multi-question process still casts one transaction per question — call
`buildVoteTransaction` (or `voting.vote`) once per entry in
`election.questions`, each with its own `processId` (`question.upstreamId`)
and `choices` array. There is no format where a single `choices` array spans
multiple questions.

The encoding pattern depends on the question's `ballotProtocol`:

> ⚠️ **Shape is a lossy reconstruction of intent — pass the declared type name when you
> have one.** At `maxValue = 1` two different wire layouts collapse onto identical
> numbers: a legacy two-option multichoice with repeatable picks and no abstain
> allowance generates `{maxCount: 2, maxValue: 1, uniqueValues: false}`, which is
> byte-identical to a two-option approval ballot. Nothing in the protocol separates
> them, so inferring by shape alone silently reports the wrong tally.
>
> Every `@vocdoni/ballot` entry point prefers a recognized declared type name over
> shape, and falls through to shape when the name is absent, empty or unrecognized.
> Two sources are consulted, and **the vocabulary follows the field, not the
> function** — each vocabulary names the opposite wire layout:
>
> | source | recognized names | layout meant |
> |---|---|---|
> | `type` — the SaaS `question.type` field | `singlechoice`, `multichoice` | `multichoice` = **dense** 0/1 |
> | `metadata.type.name` / `meta.type.name` — the legacy bag | `single-choice-multiquestion`, `multiple-choice`, `approval`, `budget-based`, `quadratic` | `multiple-choice` = **pick-slot** index list |
> | *either* — names this SDK defines | `ranked` | one rank per option, highest = best |
>
> ```ts
> // A question mapped over from a legacy @vocdoni/sdk election. In the SaaS model
> // each question is its own vochain process, so it carries that election's metadata.
> const decoded = decodeQuestionResults(
>   { ballotProtocol, metadata: { type: { name: 'multiple-choice' } }, choices },
>   results,
> )
> ```
>
> Reading a SaaS spelling as a legacy one would column-sum a dense matrix; the
> reverse inverts a two-option tally. Note that a legacy `multiple-choice` name also
> suppresses the dense remap in `decodeQuestionResults` / `encodeQuestionBallot` —
> at two options its protocol satisfies `isDenseBallotProtocol` too, so without the
> name the tally reads off the wrong axis.
>
> `ranked` is the odd one out: it is this SDK's own name, in neither upstream
> vocabulary, and it is the **only** way to reach `BallotType.Ranked` — no shape rule
> produces it, because a ranking is byte-identical to a full-slate pick-slot
> multichoice. The backend's `type` vocabulary is fixed at
> `singlechoice`/`multichoice`, so create a ranked question with a raw
> `ballotProtocol` plus the metadata bag; `type: 'ranked'` is still *read* for callers
> keeping their own record of it. See the ranked section below.

### Single choice, pick one option (value format)

`ballotProtocol.maxCount = 1`, `ballotProtocol.maxValue = max(choice.value)`

The array has one element: the **`choice.value`** of the chosen option — not its
position in `choices`. The two coincide in the common case where choices are
numbered `0..n-1`, which is why this is often described as an index, but the wire
and the tally both speak values.

```ts
// 3 options: "Yes" (0), "No" (1), "Abstain" (2)
choices: [0]   // voted "Yes"
choices: [1]   // voted "No"
choices: [2]   // voted "Abstain"
```

Values need not be contiguous, and `maxValue` is derived from the **highest value**
rather than from the option count (saas-backend `VoteTypeFromQuestion`). The results
row is indexed the same way, so unused values simply leave empty columns:

```ts
// choices published at values 1, 2, 3 → maxValue 3, one vote for each
// results row: [ "0", "1", "1", "1" ]
//                ^ column 0 stays empty — no choice carries value 0
```

⚠️ **`maxValue` must cover every published `choice.value`, and no two choices may
share one.** A raw `ballotProtocol` is the only way to get this wrong (the named
`singlechoice` type derives `maxValue` from the values), and it fails silently in the
worst way: the option above the ceiling can never be recorded, yet the chain accepts
such a ballot, counts it in `voteCount`, and discards it at tally. Duplicated values
fail the other direction — both choices read the same results column, so one vote is
reported for both. `client.elections.create/update` refuses such a question — see the
box below for what happens at encode time.

This is the most common format and the one used by the integration tests.

### Approve multiple options (binary format)

`ballotProtocol.maxCount = numOptions`, `ballotProtocol.maxValue = 1`

The array has one element per option: `1` = approved, `0` = not approved.

```ts
// 4 options; voter approves options 0 and 2
choices: [1, 0, 1, 0]
```

For approval questions that cap the number of approvals, `ballotProtocol.maxTotalCost = N` enforces the count on-chain.

This is also the layout the backend derives for the named `multichoice`
question type (`maxTotalCost = typeSetup.maxChoices`). A `maxValue = 1` protocol
is this binary format **when `uniqueValues` is false** — the one with
`uniqueValues: true` is a 2-option index-list instead (see the next section).

> ⚠️ **`uniqueValues` must be `false` on the dense layout.** It does not change the
> wire format — the scrutinizer applies it to the *raw field values*, and a 0/1
> vector over more than two options always repeats one of them (even a single
> pick, `[1, 0, 0, 0]`, repeats `0`). Every ballot is then discarded during
> aggregation: the election keeps counting `voteCount` while the tally stays all
> zeros. Uniqueness is already implicit here — each choice is its own field, so
> a voter *cannot* pick the same option twice.
>
> `client.elections.create/update` rejects `typeSetup.uniqueChoices` on
> `type: 'multichoice'` (as the API itself does) and throws on an unsatisfiable
> `ballotProtocol`; `encodeQuestionBallot` refuses to encode a ballot for such a
> question rather than casting a vote that will never count. The encoders also
> check the ballot they *produce* (`assertEncodedBallot`): a field above
> `maxValue` or a repeated value under `uniqueValues` throws instead of casting a
> vote the chain accepts and never counts. To check a question you did not
> create:
>
> ```ts
> import { unsatisfiableQuestionReason } from '@vocdoni/ballot'
>
> const reason = unsatisfiableQuestionReason(question)
> if (reason) console.error('this question can never be tallied:', reason)
> ```

> ⚠️ **A question can be satisfiable and still publish an option nobody can vote
> for.** `unsatisfiableQuestionReason` asks "can *any* ballot count here?";
> `uncastableChoicesReason` asks the narrower and more common "can every *published
> choice* be recorded?". The second failure is nastier: the election runs, most votes
> count, and the unreachable option quietly polls zero while `voteCount` keeps
> rising. Two ways to get there, both only via a raw `ballotProtocol`:
>
> - **single-choice** — a `choice.value` above `maxValue`, or two choices sharing one
>   value. Value-addressed, so the first addresses a column the protocol forbids and
>   the second makes two options share a column: one vote is counted for both and the
>   percentages sum past 100. (`maxValue: 0` means *unbounded*, not a ceiling of zero.)
> - **pick-slot multichoice** — values that are not exactly `0..numChoices-1`.
>   Unfilled pick-slots are padded with abstain sentinels starting at `numChoices`,
>   and decoding treats every column `>= numChoices` as an abstention, so a value in
>   that range is indistinguishable from an abstain and a gap below it pushes a real
>   choice into sentinel space.
>
> Position-addressed layouts (approval, dense multichoice, budget, quadratic) are
> unaffected — there `choice.value` is a display label the wire never sees.
>
> ```ts
> import { uncastableChoicesReason } from '@vocdoni/ballot'
>
> const reason = uncastableChoicesReason(question)
> if (reason) console.error('this question publishes an unreachable option:', reason)
> ```
>
> `client.elections.create/update` rejects such a config outright — that is the only
> moment it is still fixable, since after publish the sole remedy is a new election.
>
> At **encode** time the two defects are refused differently, because they fail
> differently:
>
> - A value above `maxValue` refuses only the voter who picks that option.
>   `assertEncodedBallot` already catches it per ballot; the other voters' ballots are
>   recorded correctly by the chain (verified live), so refusing them too would throw
>   away votes that would have counted. `encodeBallot` / `encodeQuestionBallot` swap
>   the wire-level bounds message for the election-level diagnosis when this happens.
> - A pick-slot sentinel collision refuses **every** voter. The colliding values are
>   within `maxValue`, so no individual ballot looks wrong and nothing downstream can
>   catch it — an abstention and a vote for the colliding choice are the same number.
>
> `validateSelections` applies the same split, so a UI can gate its submit button on it
> and get the same answer `encodeBallot` will give.

### Multichoice, pick up to N (index-list / pick-slot format)

`ballotProtocol.maxCount = maxPicks`, `ballotProtocol.maxValue >= numOptions - 1`,
`ballotProtocol.uniqueValues = true`, `ballotProtocol.maxTotalCost = 0`

One field per *pick-slot*, each holding the chosen option's value. This is the legacy
`@vocdoni/sdk` layout and what any raw `ballotProtocol` with `maxValue >= 2` (or the
2-option `maxValue: 1 && uniqueValues` shape) produces — the named `multichoice` type derives
the dense binary layout above instead.

```ts
// 4 options (values 0–3), maxPicks 4. Voter picks options 1 and 2 only.
choices: [1, 2]
```

Ballots may be **shorter than `maxCount`** — the vochain enforces only the upper bound.
`encodeQuestionBallot` pads unfilled slots with abstain sentinels when the protocol reserves
room for them, and returns the short ballot as-is otherwise. The reservation threshold depends
on whether values may repeat, because a unique ballot needs one *distinct* sentinel per empty
slot while a repeatable one reuses a single value:

```
uniqueValues: true   →  maxValue >= numOptions - 1 + maxCount
uniqueValues: false  →  maxValue >= numOptions - 1 + 1
```

(The field is `ballotProtocol.uniqueValues`; the election-level `voteType` spells the same flag
`uniqueChoices`. Most legacy pick-slot elections set it `true`, but `false` is valid here and
takes the lower threshold.) A minimum pick count is enforced by the UI
(`typeSetup.minChoices`), not the encoder. On decode, each option's tally is the **column
sum** across the pick-slots, plus a trailing `abstain` bucket — always present, but
structurally always `0` when the protocol reserves no sentinel headroom (the matrix has no
sentinel column to read). Use `questionReservesAbstain(question)` from `@vocdoni/ballot` to
decide whether to render an "Abstention" field. `<ElectionResults />` already applies this —
it drops the bucket only when the protocol reserves no headroom *and* the tally is 0, so a
headroom election still shows "Abstention: 0" (a real measurement) and a bucket holding real
votes is never hidden. The dense layout emits no bucket at all, so both layouts agree.

> ℹ️ This layout is wire-identical to a full-slate ranked ballot — see the ranked section.

### Ranked / rated (unique values)

`ballotProtocol.maxCount = numOptions`, `ballotProtocol.maxValue = numOptions - 1`,
`ballotProtocol.uniqueValues = true`, **plus** `metadata: { type: { name: 'ranked' } }`

Each option is ranked; values must not repeat. This is the one layout where
`uniqueValues` is satisfiable — `maxValue` has to leave at least `maxCount`
distinct values (`maxValue >= maxCount - 1`), or no ballot can fill the fields
without repeating one.

⚠️ **The metadata declaration is not optional.** A ranked protocol is byte-identical
to a pick-slot multichoice whose voters fill every slot, and the two mean transposed
things — ranked reads the field index as the *option* and its value as the *rank*;
pick-slot reads the field index as a *slot* and its value as the *chosen option*.
Nothing in `ballotProtocol` separates them, so a question created without the
declaration is labelled `multichoice`, decodes by column-sum, and reports the same
number for every option (this was
[integrator-sdk#22](https://github.com/vocdoni/integrator-sdk/issues/22)). The
backend's own `type` vocabulary is `['singlechoice', 'multichoice']` and rejects
anything else, so the metadata bag — which it stores and echoes back verbatim — is
the channel. `declaresRanked(question)` reports whether a question carries it.

```ts
await client.elections.create({
  /* … */
  questions: [
    {
      title: 'Rank the candidates',
      choices: [{ title: 'A', value: 0 }, { title: 'B', value: 1 }, { title: 'C', value: 2 }],
      ballotProtocol: { maxCount: 3, maxValue: 2, uniqueValues: true, /* … */ },
      metadata: { type: { name: 'ranked' } },   // ← without this it is a multichoice
    },
  ],
})
```

The array is one **rank per option, in choice order** — the field index is the
option, the value is its score. **Higher wins**: give your top pick
`numOptions - 1` and your last pick `0`. That orientation is a convention, not
something the protocol enforces, and both halves of the SDK assume it: the decode is
an index-weighted sum, so a ballot ranked with `0` as "best" is perfectly valid and
elects the loser, with nothing on either side able to notice. Build the array with
`rankedOrderToScores` instead of by hand and it is applied for you:

```ts
import { encodeQuestionSelections } from '@vocdoni/ballot'

// 3 candidates, voter ranks C2 > C0 > C1 — pass the ORDERING, best first.
const ballot = encodeQuestionSelections(question, [2, 0, 1])   // → [1, 0, 2]
```

**`encodeQuestionSelections` is the entry point a form should use**, for every ballot
type. It is `encodeQuestionBallot` plus the one thing that differs per type: a ranked
question's form value is the voter's *ordering*, everything else's already is its wire
input. Writing that branch by hand at the call site is how an ordering ends up on the
wire unchanged — a valid ballot the Borda decode reads upside-down.

The two-step form still works when you already hold wire ranks:

```ts
import { encodeQuestionBallot, rankedOrderToScores } from '@vocdoni/ballot'

const ranks = rankedOrderToScores(question, [2, 0, 1])   // → [1, 0, 2]
const ballot = encodeQuestionBallot(question, ranks)     // → [1, 0, 2] (pass-through)
```

Everything a ranking can get wrong throws rather than casting a vote the chain accepts
and never counts. `rankedOrderToScores` rejects an ordering that repeats a choice or
names an unpublished one; both it and `encodeQuestionBallot` reject an **incomplete**
slate (a ranked protocol is pigeonhole-tight, so a partial ranking repeats a value and
the chain drops the whole ballot), and `encodeQuestionBallot` additionally rejects a
duplicate rank or one above `maxValue`. `validateSelections` gives the same verdicts on
the wire ranks, so a UI can gate its submit button without discovering the refusal at
cast time.

Three defects are refused for **every** voter, up front, because no individual ballot
shows them. The first two belong to the question, and `client.elections.create` refuses
them too — the only moment they can still be fixed:

- `maxValue: 0` on a ranked question. It means "unbounded" for every other type; here it
  switches the chain to discrete aggregation and every option scores 0 however anyone
  votes, indistinguishable from an election nobody voted in.
- **Two choices sharing a `value`.** Ranked is position-addressed, so the ballots stay
  well-formed — but the decoded rows are keyed by `choice.value`, so two options come
  back under one id, and a ranking cannot order them.
- **More than one question** on an election-level `ranked` declaration. A ranking is one
  field per option and fills the whole ballot, so there is no room for a second question;
  `inferBallotType`, `encodeBallot`, `validateSelections` and `decodeResults` all refuse
  it. Rank per question with `encodeQuestionSelections` / `decodeQuestionResults`.

**Decoding is Borda** — `Σ count × rank`, the index-weighted sum of each option's
row. It is not one option among several: the tally is a per-field histogram with the
individual ballots already discarded, and positional/Condorcet methods need the
ballots. This matches `saas-integrator-demo`, the reference implementation.

```ts
// 3 voters all rank C2 > C0 > C1
// raw: [['0','3','0'], ['3','0','0'], ['0','0','3']]
const decoded = decodeQuestionResults(question, results)
const points = decoded.map((row) => row.votes)               // [3, 0, 6]
const ranking = [...decoded].sort((a, b) => b.votes - a.votes).map((r) => r.choice)  // [2, 0, 1] — C2 wins
```

Two things to know about the decoded shape:

- `votes` is **points, not people**. Percentages are each option's share of the total
  points. (Budget and quadratic already work this way.)
- There is **no `abstain` bucket**. The sentinel columns the multichoice branch
  unifies are a pick-slot device for unfilled slots, and ranked has none — every
  option is a field.

`react-components` renders a rank widget for these questions (one position control
per option, via the `QuestionRankChoice` slot), requires a complete ranking before it
will submit, and converts the ordering with `rankedOrderToScores` on the way out —
see [react.md](react.md).

### Budget / quadratic (per-option amounts)

`ballotProtocol.maxCount = numOptions`, `ballotProtocol.maxValue = 0`,
`costExponent = 1` (budget) or `2` (quadratic), `maxTotalCost` caps the spend.

The array has one element per option: the amount allocated to it, in choice
order.

```ts
// 4 options; voter allocates 4 to option 0 and 6 to option 2
choices: [4, 0, 6, 0]
```

`maxValue = 0` means "no upper bound per option" — and it also changes how the
**results** come back. The scrutinizer switches to discrete aggregation: each
option's row holds a single cell with `Σ amount × weight`, not a histogram.
`decodeQuestionResults` handles that; if you read the matrix by hand, take
`results[optionPosition][0]`.

Prefer `encodeQuestionBallot(question, selections)` from `@vocdoni/ballot`
over hand-building this array — it infers the ballot type from
`question.ballotProtocol` and handles multichoice abstain-padding for you
(see the recipes).

---

## Encrypted elections (secretUntilTheEnd)

Each question carries its own `secretUntilTheEnd: boolean`
(`VotingProcessQuestion.secretUntilTheEnd`). When `true`,
`buildVoteTransaction` seals the ballot with NaCl SealedBox automatically if
you pass `encryptionKeys`; you don't call `BallotEncryptor` directly.

```ts
// Public single-question read — no API key needed, so the voter app can call it.
// (chainId is not here — read it off the public process read, elections.get.)
const question = await client.processes.getQuestion(processMongoId, questionId)
// question.secretUntilTheEnd === true
// question.encryptionKeys — the keys; may be absent right after publish (see below)

const txPayload = buildVoteTransaction({
  processId: question.upstreamId!,
  choices: [0],
  chainId, // from the public process read — elections.get(processMongoId).chainId
  signer,
  cspSignature: signature,
  cspWeight: weight,
  encryptionKeys: question.encryptionKeys!, // ← triggers NaCl sealing; Array<{ index: number; key: string }>
})
```

When multiple keys are present they are applied in ascending `index` order (innermost first), matching how the Vochain unseals them.

> **Key sourcing:** `encryptionKeys` lives on the question — on the public
> process read (`elections.get(id).questions[i].encryptionKeys`) and the
> public single-question read
> (`processes.getQuestion(id, qId).encryptionKeys`); no auth for either. The
> keykeepers publish keys asynchronously right after publish, and the field is
> **absent** (not an empty array) until then — treat absence as "not yet
> published" and poll before building the ballot. See
> `recipes/encrypted-vote.ts`.

---

## BallotEncryptor (advanced)

Used internally by `buildVotePackage`. Exposed for testing:

```ts
import { BallotEncryptor } from '@vocdoni/api-voting'

const sealed = BallotEncryptor.seal(plaintext, hexCurve25519PublicKey)
// → Uint8Array: ephemeralPublicKey(32) || box

// open (test/debug only — requires the private key)
const opened = BallotEncryptor.open(sealed, recipientPk, recipientSk)
```

---

## Cross-references

- [[integrator-sdk]] — overview and vote flow sequence
- [[client]] — `ProcessesCspClient` (auth, check, sign), `JobsClient` (waitFor), `ElectionsClient` (vote relay)
- [[react]] — `useElection().vote()` automates this entire flow in React

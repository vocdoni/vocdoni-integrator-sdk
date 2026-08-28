# @vocdoni/ballot

Framework-agnostic Vocdoni ballot semantics: type inference, choice encoding, and results decoding.

## Purpose

This package provides pure functions for working with Vocdoni election ballots without any HTTP, React, or crypto dependencies. It is the lowest-level runtime package after `@vocdoni/api-types`.

## Public API

```typescript
// Election type names (runtime const + type)
export const BallotType: {
  SingleChoice: 'single-choice'
  MultiChoice: 'multichoice'
  Approval: 'approval'
  // Only ever selected by a declared `ranked` name — never inferred from shape, because
  // a ranked protocol is byte-identical to a full-slate pick-slot multichoice.
  Ranked: 'ranked'
  Budget: 'budget'
  Quadratic: 'quadratic'
}
export type BallotType = (typeof BallotType)[keyof typeof BallotType]

// Every election-level entry point takes the same two optional declared-type inputs
// on top of the election config: `type` (the explicit name) and `meta` (the legacy
// metadata bag, read as `meta.type.name`). See "Declared type names" below.

// Infer the ballot type from the declared type name, falling back to election config
export function inferBallotType(
  input: Pick<Election, 'questions' | 'voteType'> & { type?: string; meta?: Record<string, unknown> }
): BallotType

// Encode high-level selections into the on-chain ballot array
export function encodeBallot(
  input: Pick<Election, 'questions' | 'voteType'> & { type?: string; meta?: Record<string, unknown> },
  selections: BallotSelections
): number[]

// Decode raw results into per-question/per-choice tallies
export function decodeResults(
  input: Pick<Election, 'questions' | 'voteType' | 'results'> & { type?: string; meta?: Record<string, unknown> }
): DecodedResults

// Validate selections against election constraints (optional)
export function validateSelections(
  input: Pick<Election, 'questions' | 'voteType'> & { type?: string; meta?: Record<string, unknown> },
  selections: BallotSelections
): void

// Whether a multichoice election reserves enough maxValue room to abstain-pad a
// partial selection (false for every other ballot type). Handy for UI validation.
export function multichoiceReservesAbstain(
  input: Pick<Election, 'questions' | 'voteType'> & { type?: string; meta?: Record<string, unknown> }
): boolean

// Why a ballot config admits no usable ballot, or null when it is fine.
// See "Unsatisfiable ballot configs" below.
export function unsatisfiableProtocolReason(bp: ProtocolBounds): string | null
export function unsatisfiableQuestionReason(question: {
  ballotProtocol?: BallotProtocol
  type?: string
  metadata?: Record<string, unknown>
  typeSetup?: QuestionTypeSetup
  choices: Choice[]
}): string | null
export function isUnsatisfiableProtocol(bp: ProtocolBounds): boolean
export function isUnsatisfiableQuestion(question: { /* as above */ }): boolean

// Why a RANKED question's protocol can never produce a ranking, or null. The one case
// is `maxValue: 0` — "unbounded" for every other type, but it puts the chain in discrete
// aggregation, and the Borda decode then scores every option zero. Folded into
// `unsatisfiableQuestionReason` and refused by both encoders; exported for read-side checks.
export function unrankableProtocolReason(numChoices: number, maxValue: number): string | null

// The part of a ballot protocol the satisfiability rule reads.
export type ProtocolBounds = Pick<BallotProtocol, 'maxCount' | 'maxValue' | 'uniqueValues'>

// Read the satisfiability bounds off an election-level voteType.
export function voteTypeBounds(
  voteType: Pick<VoteType, 'maxCount' | 'maxValue' | 'uniqueChoices'>
): ProtocolBounds

// True for the dense 0/1 wire layout (one field per choice) — what the backend
// derives for the named multichoice type.
//
// ⚠️ Not sufficient on its own to route a decode. A legacy two-option pick-slot
// multichoice has the same params, so this answers `true` for it too; pair it with
// `declaresLegacyPickSlot` (below), which is what the built-in codecs do.
export function isDenseBallotProtocol(
  bp: Pick<BallotProtocol, 'maxCount' | 'maxValue' | 'uniqueValues'>
): boolean

// True when a question's legacy metadata bag declares `multiple-choice` — the
// pick-slot index list, NOT the dense layout the SaaS `multichoice` type names.
// Use it to suppress a dense read that `isDenseBallotProtocol` would otherwise
// green-light; without it a two-option tally comes out inverted.
export function declaresLegacyPickSlot(question: {
  metadata?: Record<string, unknown>
}): boolean

// True when a question declares itself `ranked`, in either name channel. The same
// question `inferQuestionBallotType` asks, minus the shape fallback and minus its throw,
// so it is safe on a partial read that carries neither a protocol nor a type.
export function declaresRanked(question: {
  type?: string
  metadata?: Record<string, unknown>
}): boolean

// Turn a voter's ranking — the choice VALUES they ordered, best first — into the wire
// ballot: one rank per option in choice order, highest = best. This is where the
// orientation lives; building the array by hand risks inverting it, and the Borda decode
// cannot tell. Throws on a ranking that repeats a choice, names an unpublished one,
// leaves any option unranked, or belongs to a question with duplicate choice values.
export function rankedOrderToScores(question: { choices: Choice[] }, order: number[]): number[]

// Encode one question's ballot from what a voter-facing form collects, whatever the
// ballot type: the ORDERING for a ranked question (transposed for you), the raw
// selections for everything else. The entry point a UI should use — it keeps the
// per-type branch in one place, where it cannot be written the wrong way round.
export function encodeQuestionSelections(question: QuestionLike, selections: number[]): number[]

// Assert an encoded wire ballot would survive the scrutinizer's per-field checks
// (range + uniqueness). The encoders run it on everything they produce; call it
// directly on a ballot built by hand. See "Unsatisfiable ballot configs" below.
export function assertEncodedBallot(ballot: number[], bounds: ProtocolBounds): void
```

## Usage

```typescript
import { inferBallotType, encodeBallot, decodeResults } from '@vocdoni/ballot'

// Infer the type from an election object
const type = inferBallotType({ questions, voteType })

// Encode voter selections into a ballot array. `selections` is the chosen choice
// values — a flat number[] (or nested number[][], one array per question):
const ballot = encodeBallot({ questions, voteType }, [2])       // single-choice → [2]
const approval = encodeBallot({ questions, voteType }, [0, 2])  // approval → [1,0,1,…]

// Decode results from the API response
const decoded = decodeResults({ questions, voteType, results })
```

## Declared type names

Protocol shape is a *reconstruction* of the election's intent, and at `maxValue === 1` the
reconstruction is lossy. A legacy `MultiChoiceElection` over two choices with repeatable
picks and no abstain allowance generates `{ maxCount: 2, maxValue: 1, uniqueChoices: false }`
— byte-identical to a two-option `ApprovalElection`. Nothing in the protocol separates them,
so reading the results by shape alone silently reports the wrong tally.

If the type is known, it is used. Two sources are consulted, in order, before shape:

```typescript
// 1. the explicit field — SaaS `question.type`, or an election-level override
const decoded = decodeQuestionResults({ ballotProtocol, type: 'multichoice', choices }, results)

// 2. the legacy metadata bag, for elections mapped over from @vocdoni/sdk
const decoded = decodeResults({
  questions, voteType, results,
  meta: { type: { name: 'multiple-choice' } },   // election-level bag
})
```

**The vocabulary follows the field it came from, not the function.** This matters because
each vocabulary names the opposite wire layout:

| source | recognized names | layout |
| --- | --- | --- |
| `type` (SaaS field) | `singlechoice`, `multichoice` | `multichoice` = **dense** 0/1 |
| `meta.type.name` / `metadata.type.name` (legacy bag) | `single-choice-multiquestion`, `multiple-choice`, `approval`, `budget-based`, `quadratic` | `multiple-choice` = **pick-slot** index list |
| *both* — names this SDK defines | `ranked` | one rank per option, highest = best |

Reading a SaaS spelling as a legacy one would column-sum a dense matrix; the reverse
inverts a two-option tally. So a name is only ever resolved against its own table.

The legacy bag is read per question as well as per election, because in the SaaS model each
question *is* its own vochain process — a question mapped from a legacy election carries
that election's `metadata.type`.

An absent, empty or unrecognized name falls through to the shape rules unchanged.

`ranked` is the exception to the follows-the-field rule, because it belongs to neither
upstream vocabulary — it is this SDK's own name, so no layout is ambiguous between the two
tables and both consult it. It is also the **only** way to reach `BallotType.Ranked`: no
shape rule produces it, since a ranked protocol is byte-identical to a pick-slot multichoice
whose voters fill every slot. In practice the writable channel is the metadata bag — the
backend's `type` vocabulary is `['singlechoice', 'multichoice']` and it rejects anything
else, while storing and echoing `metadata` verbatim:

```typescript
const decoded = decodeQuestionResults(
  { ballotProtocol, metadata: { type: { name: 'ranked' } }, choices },
  results,
)
```

## Encoding semantics

`encodeBallot` takes `selections` — the chosen choice values — and produces the on-chain
ballot the scrutinizer expects. `selections` accepts a flat `number[]` (the ergonomic
default) or a nested `number[][]` (one array per question); both normalize identically.
Only single-choice is ever multi-question, so a flat array is unambiguous:

| Type | `selections` (flat) | Ballot |
|---|---|---|
| single-choice | one chosen value per question `[v0, v1, …]` | one value per question `[v0, v1, …]` |
| approval | the approved choice values | dense `0/1` vector over every option |
| multichoice | the picked choice values | one value per pick-slot; unfilled slots padded with abstain sentinels when the protocol reserves them, otherwise a short ballot |
| ranked | one rank per option, in choice order, highest = best | the rank array unchanged |
| budget / quadratic | the per-option amounts, in choice order | the amount array unchanged |

**Ranked** takes ranks, not an ordering. Hand the voter's ordering (choice values, best
first) to `encodeQuestionSelections(question, order)` — or convert it yourself with
`rankedOrderToScores(question, order)` — rather than building the rank array by hand. The
orientation is a convention the protocol has no opinion about, and the decode is an
index-weighted sum, so a ballot ranked with `0` as "best" is perfectly valid and elects the
loser with nothing on either side able to notice. A ranking must be **complete**: the
protocol leaves exactly one rank per option, so a partial one repeats a value and the chain
discards the whole ballot — every encoder refuses a short slate, matching
`validateSelections`. Two more ranked-only refusals apply to the *question* rather than the
ballot, and are enforced for every voter as well as at creation: `maxValue: 0` (see the
decoding section) and two choices sharing a `value`, which would return two decoded rows
under one choice id. An election-level `ranked` declaration with more than one question is
refused outright — a ranking fills the whole ballot, so rank per question instead.

**Abstaining:**

- **single-choice** has **no abstain concept**. If abstaining is offered, the process creator
  adds an explicit "Abstain" option as a normal choice (e.g. `Yes=0, No=1, Abstain=2`), so the
  voter always picks exactly one value. An empty selection is invalid input and **throws** — in
  both `encodeBallot` and `validateSelections`.
- **multichoice** pads short selections up to `maxCount` with abstain sentinels — a single
  repeated value `choices.length` when `uniqueChoices` is `false`, or distinct ascending
  values `choices.length, choices.length + 1, …` when `uniqueChoices` is `true` — but only when
  the election reserves enough room (`maxValue >= choices.length - 1 + (uniqueChoices ?
  maxCount : 1)`). With no reserved room the ballot is sent **short**: the vochain enforces
  only the upper bound, and the legacy SDK sends short ballots unpadded. A minimum pick count
  is the UI's job (`typeSetup.minChoices`), not the encoder's. On the way back,
  `decodeResults` **unifies** all sentinel columns into a single trailing
  `{ choice: 'abstain', … }` bucket per multichoice question. That bucket is always present
  for multichoice; when the protocol reserves no headroom the matrix has no sentinel column
  at all, so it is structurally always `0` — call `questionReservesAbstain(question)` to
  decide whether an "Abstention" field is worth rendering.

## Decoding semantics

`decodeResults` / `decodeQuestionResults` read the raw on-chain matrix, whose layout
depends on the protocol:

| Type | Matrix | Per-choice tally |
|---|---|---|
| single-choice | one row per question, one column per choice value | `results[q][choiceValue]` |
| approval / dense multichoice | one row per option, `[notSelected, selected]` | `results[optionPos][1]` |
| pick-slot multichoice | one row per pick-slot, columns are choice values | column sum across rows; sentinel columns (`>= choices.length`) unify into one `abstain` bucket |
| ranked | one row per option, columns are ranks | **Borda**: `Σ count × rank` over the row |
| budget / quadratic | one row per option, **one column** | `results[optionPos][0]` |

The decoder tells dense and pick-slot multichoice apart from the protocol, not a flag: dense
is `maxValue === 1 && !uniqueValues` (one 0/1 field per choice), pick-slot is every other
`maxCount > 1` multichoice (`uniqueValues: true`, or `maxValue >= 2`). A protocol-less named
`multichoice` question decodes dense.

The budget/quadratic row is a single cell because `maxValue === 0` switches the
scrutinizer to *discrete aggregation*: it accumulates `Σ amount × weight` into column
0 instead of bucketing a histogram (vocdoni-node `vochain/results/results.go` —
"The results are aggregated, so we use only the first column of the results matrix").
Reading such a row as a histogram yields zero for every option.

**Ranked** aggregates with Borda, and that is not one method among several: the matrix is a
per-field histogram with the individual ballots already discarded, and positional/Condorcet
methods need the ballots. Two consequences for the decoded shape:

- `votes` is **points, not voters** (as it already is for budget/quadratic amounts), and
  `percentage` is each option's share of the total points. Sort descending for the ranking.
- There is **no `abstain` bucket**. The sentinel columns the multichoice branch unifies are a
  pick-slot device for unfilled slots; a ranking has none, since every option is a field.

Ranked is also the only type for which `maxValue: 0` is fatal rather than lax — it puts the
chain in the discrete aggregation described above, so the index-weighted sum reads column 0
and scores every option zero. `unrankableProtocolReason` reports it, and both encoders and
`validateSelections` refuse such a question outright.

```typescript
// 3 voters all rank C2 > C0 > C1 → raw [['0','3','0'], ['3','0','0'], ['0','0','3']]
const decoded = decodeQuestionResults(question, results)
const points = decoded.map((r) => r.votes)                            // [3, 0, 6]
const ranking = [...decoded].sort((a, b) => b.votes - a.votes).map((r) => r.choice) // [2, 0, 1] — C2 wins
```

## Unsatisfiable ballot configs

The vochain scrutinizer applies `uniqueValues` (`voteType.uniqueChoices`) to the **raw
field values** of a ballot, not to "the choices a voter picked": one repeated value and
the whole ballot is rejected during aggregation. The vote still counts towards
`voteCount`, so a broken election looks like a working one that nobody voted in.

Some configs can therefore never be tallied:

- **Dense `0/1` layout + `uniqueValues`** (`maxValue === 1`, `maxCount > 2`) — one field
  per choice means only the values `0` and `1` exist. Above two choices no ballot
  survives: even a single pick (`[1, 0, 0, 0]`) repeats `0`, so the tally is all zero.
  This is what the backend derives for a `multichoice` question created with
  `typeSetup.uniqueChoices: true`. At **exactly two** choices the config is *not*
  unsatisfiable — `[0, 1]` and `[1, 0]` pass. That shape (`maxValue === 1`,
  `uniqueValues: true`) is a 2-option index-list multichoice, wire-identical to a 2-option
  ranked ballot, so `unsatisfiableProtocolReason` deliberately returns `null` there (matching
  the backend) and the codec routes it as pick-slot. Individual ballots that repeat a value
  (e.g. abstaining as `[0, 0]`) are refused at **encode** time — see below.
- **Pigeonhole** (`uniqueValues`, `0 < maxValue + 1 < maxCount`) — fewer distinct legal
  values than fields to fill.

The scrutinizer's field checks also drop **individual ballots** whose config is fine:
a value above `maxValue`, or a repeated value under `uniqueValues` (duplicate ranks on
a ranked ballot, both picks of a two-field unique layout). Nothing downstream reports
those either — the envelope is accepted, `voteCount` rises, the ballot never counts.

So the guard runs at both levels: `encodeBallot` / `encodeQuestionBallot` /
`validateSelections` **throw** on an unsatisfiable *config* rather than producing a
ballot that will be discarded, and the encoders additionally run
`assertEncodedBallot` on every ballot they *produce*, refusing one the chain would
silently drop — a vote must either count or fail loudly, never mutate into silence.
`unsatisfiableProtocolReason` / `unsatisfiableQuestionReason` expose the config check
so a UI can detect an already-created broken question instead of rendering an empty
result chart. `unsatisfiableQuestionReason` also works on a public question read,
which omits the derived `ballotProtocol` — the contradiction is still visible in
`type` + `typeSetup`.

## Installation

```bash
pnpm add @vocdoni/ballot
```

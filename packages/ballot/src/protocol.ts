import type { BallotProtocol, Choice, QuestionTypeSetup, VoteType } from '@vocdoni/api-types'
import { BallotType } from './types'
import { declaresRanked, inferQuestionBallotType, isPickSlotLayout } from './infer'

/** The part of a ballot protocol the satisfiability rule reads. */
export type ProtocolBounds = Pick<BallotProtocol, 'maxCount' | 'maxValue' | 'uniqueValues'>

/**
 * Explain why a ballot protocol admits no usable ballot, or `null` when it is fine.
 *
 * The vochain scrutinizer applies `uniqueValues` to the **raw field values** of the
 * ballot, not to "the choices a voter picked": `results.AddVote` rejects the whole
 * ballot with `values are not unique` as soon as one value repeats
 * (vocdoni-node `vochain/results/results.go`). A rejected ballot is dropped from the
 * tally while the vote still counts towards `voteCount` — the election accepts votes
 * and reports zeros, which is why an unsatisfiable protocol must be caught before
 * anyone votes rather than diagnosed from an empty result matrix.
 *
 * The rule is **pigeonhole only** — `uniqueValues` with fewer distinct legal values
 * (`0..maxValue`) than fields to fill (`maxCount`). It deliberately mirrors the
 * backend's `ValidateBallotProtocol` (saas-backend `account/ballot.go`), which
 * checks *unsatisfiability only, never plausibility*: a raw protocol is exactly how
 * the shapes with no named type are expressed, so anything a voter could actually
 * satisfy has to stay expressible. Diverging would mean rejecting protocols the API
 * accepts. Two scope notes on that mirror:
 *
 * - Neither side checks cost bounds, so a `uniqueValues` protocol whose *cheapest*
 *   legal ballot exceeds a non-zero `maxTotalCost` (e.g. `maxCount: 4, maxValue: 3,
 *   maxTotalCost: 3` — any permutation costs ≥ 0+1+2+3 = 6) passes here and at the
 *   API, yet tallies to zero all the same. "Unsatisfiable" in this module means
 *   *pigeonhole-unsatisfiable*, not "every possible way to never count".
 * - The `maxValue === 0` carve-out below is client-only: the backend applies the
 *   pigeonhole literally and rejects `uniqueValues` with `maxValue: 0` and
 *   `maxCount > 1`. This function stays silent there and lets the API answer, so
 *   the laxness fails slow (a 400 on create), never silent.
 *
 * The dense 0/1 multichoice layout (`maxValue === 1`) is the shape this exists for:
 * over more than two choices only 0 and 1 are available, so every ballot repeats a
 * value — even a single pick, `[1, 0, 0, 0]`, repeats `0`. Note that at *exactly* two
 * fields `[0, 1]` and `[1, 0]` do satisfy it — a satisfiable 2-option index-list
 * multichoice, wire-identical to a 2-option ranked ballot, which is why only a
 * declared name tells the two apart ({@link BallotType.Ranked}); that is allowed
 * here, matching the backend. The named `multichoice` type cannot reach it either
 * way, because the API rejects `typeSetup.uniqueChoices` outright.
 *
 * `maxValue === 0` means "no upper bound" (budget / quadratic), so uniqueness is
 * always satisfiable there and is never reported.
 */
export function unsatisfiableProtocolReason(bp: ProtocolBounds): string | null {
  // Malformed bounds (missing, negative, fractional — reachable only from untyped JS
  // or hand-built objects) get no verdict rather than a NaN-laden one: this function
  // explains why a well-formed protocol can never be tallied; rejecting malformed
  // input is the API's job, and it never reaches the chain.
  if (!Number.isInteger(bp.maxCount) || bp.maxCount < 0) return null
  if (!Number.isInteger(bp.maxValue) || bp.maxValue < 0) return null
  if (!bp.uniqueValues) return null
  // maxValue 0 is the budget/quadratic "unbounded value" marker, not a one-value range.
  if (bp.maxValue === 0) return null
  if (bp.maxValue + 1 >= bp.maxCount) return null

  const dense =
    bp.maxValue === 1
      ? ' This is the dense 0/1 multichoice layout, where each choice is its own field and ' +
        'uniqueness is already implicit — a voter cannot select the same choice twice.'
      : ''
  return (
    `uniqueValues is true but maxValue ${bp.maxValue} allows only ${bp.maxValue + 1} distinct ` +
    `value(s) for ${bp.maxCount} ballot fields, so no ballot can fill them without repeating ` +
    `one — every vote would be discarded at tally, leaving an all-zero result.${dense} ` +
    `Raise maxValue to at least ${bp.maxCount - 1}, or set uniqueValues/typeSetup.uniqueChoices false`
  )
}

/**
 * Explain why a *ranked* question's protocol can never produce a ranking, or `null`
 * when it is fine.
 *
 * Separate from {@link unsatisfiableProtocolReason} because that function deliberately
 * mirrors the backend's `ValidateBallotProtocol` and must not diverge from it — and
 * because the backend has no concept of a ranked question at all, so there is nothing
 * there to mirror. This is a rule about a label the SDK alone applies.
 *
 * One case, and it is the one the rest of the module reads the opposite way.
 * `maxValue === 0` means "no upper bound" everywhere else (see
 * {@link assertEncodedBallot}'s `maxValue > 0 &&` guard, `decode.ts`,
 * {@link unsatisfiableProtocolReason}'s carve-out) — laxness that fails slow at worst.
 * For ranked it is fatal: on chain `maxValue === 0` switches the scrutinizer to
 * **discrete aggregation**, accumulating `results[field][0] += value * weight` and
 * leaving the row one cell wide (vochain `results/results.go`). The Borda decode is an
 * index-weighted sum over a histogram, so it reads column 0 — weight 0 — and every
 * option scores zero however anyone votes. An all-zero tally is indistinguishable from
 * "nobody voted", which is why this has to be caught before anyone votes rather than
 * diagnosed afterwards.
 *
 * Only reachable by hand: a protocol with `uniqueValues` and `maxValue: 0` over more
 * than one field is rejected at creation by the API, so a question that gets here
 * either dropped `uniqueValues` (and is not a ranking) or was never created through it.
 * Cheap to check, silent and total when it hits.
 *
 * Deliberately NOT checked here: `maxValue < numChoices - 1`, which leaves too few
 * distinct ranks for a full slate. That one already fails loudly per ballot in
 * {@link assertEncodedBallot} (the top rank exceeds the ceiling), so an up-front
 * refusal would only duplicate it.
 *
 * Returns `null` for shapes it cannot judge, like its neighbours here.
 */
export function unrankableProtocolReason(numChoices: number, maxValue: number): string | null {
  if (!Number.isInteger(numChoices) || numChoices < 2) return null
  if (!Number.isInteger(maxValue) || maxValue < 0) return null
  if (maxValue !== 0) return null

  return (
    'this question is declared ranked, but its protocol has maxValue 0. That means "no upper ' +
    'bound" everywhere else, and on chain it switches the scrutinizer to discrete aggregation: ' +
    'the ranks are accumulated into a single column instead of bucketed into a histogram. The ' +
    'Borda decode is an index-weighted sum over that histogram, so every option would score 0 ' +
    'no matter how anyone votes, and the result is indistinguishable from an election nobody ' +
    `voted in. Set maxValue to ${numChoices - 1} (one distinct rank per option), or drop the ` +
    'ranked declaration if this is really a budget/quadratic ballot'
  )
}

/** True when {@link unsatisfiableProtocolReason} has something to say about `bp`. */
export function isUnsatisfiableProtocol(bp: ProtocolBounds): boolean {
  return unsatisfiableProtocolReason(bp) !== null
}

/** Read the satisfiability bounds off an election-level {@link VoteType}. */
export function voteTypeBounds(voteType: Pick<VoteType, 'maxCount' | 'maxValue' | 'uniqueChoices'>): ProtocolBounds {
  return { maxCount: voteType.maxCount, maxValue: voteType.maxValue, uniqueValues: voteType.uniqueChoices }
}

/**
 * Assert an encoded wire ballot would survive the scrutinizer's per-field checks.
 *
 * {@link unsatisfiableProtocolReason} judges the *config*; this judges the *product*:
 * every field a non-negative integer no greater than `maxValue` (when `maxValue > 0` —
 * `0` is the budget/quadratic "unbounded" marker), and no repeated value under
 * `uniqueValues`. A ballot violating either is not refused at cast time — the chain
 * accepts the envelope, counts it in `voteCount`, and silently drops it during tally
 * aggregation — so this is the last place the mistake can be loud. Encoders call it on
 * everything they produce; call it directly on a ballot built by hand.
 *
 * @throws When a field is negative, fractional, above `maxValue`, or repeats a value
 *   the protocol requires to be unique.
 */
export function assertEncodedBallot(ballot: number[], bounds: ProtocolBounds): void {
  ballot.forEach((value, field) => {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(
        `encoded ballot field ${field} is ${value}; ballot fields must be non-negative integers — ` +
          'the chain would accept this vote and silently drop it at tally'
      )
    }
    if (bounds.maxValue > 0 && value > bounds.maxValue) {
      throw new Error(
        `encoded ballot field ${field} is ${value}, above maxValue ${bounds.maxValue} — the chain ` +
          'would accept this vote and silently drop it at tally'
      )
    }
  })
  if (!bounds.uniqueValues) return
  const seen = new Map<number, number>()
  ballot.forEach((value, field) => {
    const first = seen.get(value)
    if (first !== undefined) {
      throw new Error(
        `encoded ballot repeats value ${value} (fields ${first} and ${field}), but uniqueValues ` +
          'requires every field distinct — the chain would accept this vote and silently drop it at tally'
      )
    }
    seen.set(value, field)
  })
}

/**
 * Explain why a question's ballot config admits no usable ballot, or `null` when it
 * is fine. Use it on the read side to detect an already-created broken question —
 * an all-zero tally is otherwise indistinguishable from "nobody voted".
 *
 * A raw `ballotProtocol` is checked directly (it overrides the named type on
 * creation). Otherwise the named type's derivation is checked: the backend turns
 * `type: 'multichoice'` into the dense layout (`maxCount = choices.length`,
 * `maxValue = 1`, `maxTotalCost = typeSetup.maxChoices`) and maps
 * `typeSetup.uniqueChoices` straight onto the on-chain `uniqueValues`, so the same
 * contradiction is visible from `type` + `typeSetup` alone — which is all a public
 * read exposes, since it omits the derived protocol.
 */
export function unsatisfiableQuestionReason(question: {
  ballotProtocol?: BallotProtocol
  type?: string
  metadata?: Record<string, unknown>
  typeSetup?: QuestionTypeSetup
  choices: Choice[]
}): string | null {
  const bp = question.ballotProtocol

  // Ranked before the general rule: `maxValue: 0` is the one shape
  // unsatisfiableProtocolReason waves through — correctly, since it means "unbounded"
  // for every other type — that a ranking can never survive. Only when a protocol was
  // actually read: public reads may omit it, and absent is not zero.
  if (bp && declaresRanked(question)) {
    const unrankable = unrankableProtocolReason(question.choices?.length ?? 0, bp.maxValue)
    if (unrankable) return unrankable
  }

  if (bp) return unsatisfiableProtocolReason(bp)

  if (question.type === 'multichoice' && question.typeSetup?.uniqueChoices && question.choices.length > 1) {
    return unsatisfiableProtocolReason({
      maxCount: question.choices.length,
      maxValue: 1,
      uniqueValues: true,
    })
  }

  return null
}

/** True when {@link unsatisfiableQuestionReason} has something to say about `question`. */
export function isUnsatisfiableQuestion(question: {
  ballotProtocol?: BallotProtocol
  type?: string
  metadata?: Record<string, unknown>
  typeSetup?: QuestionTypeSetup
  choices: Choice[]
}): boolean {
  return unsatisfiableQuestionReason(question) !== null
}

/**
 * The question shape {@link uncastableChoicesReason} reads.
 *
 * No `typeSetup`, deliberately: reachability is decided by the layout and the choice
 * values alone, and `minChoices`/`maxChoices` bound how many options a voter picks,
 * never which ones can be recorded. Declaring it here would advertise a check that
 * does not exist. {@link unsatisfiableQuestionReason} does read it — that rule asks
 * whether any ballot counts at all, which `maxChoices` genuinely affects.
 */
type QuestionLike = {
  ballotProtocol?: BallotProtocol
  type?: string
  /** Legacy metadata bag — `metadata.type.name` names the wire layout when present. */
  metadata?: Record<string, unknown>
  choices: Choice[]
}

/**
 * Explain why a question publishes a choice no voter can actually cast, or `null`
 * when every choice is reachable.
 *
 * {@link unsatisfiableProtocolReason} asks "can *any* ballot count here?"; this asks
 * the narrower and far more common question "can every *published choice* be
 * recorded?". A question can be perfectly satisfiable and still carry an option that
 * is dead on arrival, which is more insidious than an all-zero tally: the election
 * runs, most votes count, and the unreachable option quietly polls zero. Verified
 * live in `integration/value-skew.itest.ts` — the relay accepts an out-of-range
 * ballot, the chain counts it in `voteCount`, and the scrutinizer discards it at
 * aggregation without surfacing an error anywhere.
 *
 * What "reachable" means depends on how the layout addresses its fields:
 *
 * - **single-choice** — value-addressed. The one field carries the chosen
 *   `choice.value` and the results row is indexed by it (saas-backend `db/types.go`:
 *   "indexed by choice value (0..MaxValue, so sparse choice values leave empty
 *   buckets)"). Gaps are legal and deliberate — `VoteTypeFromQuestion` derives
 *   `maxValue` from the highest value for exactly this reason — so the rule is only
 *   that every value fits `0..maxValue`.
 * - **pick-slot multichoice** — value-addressed picks sharing one value space with
 *   the abstain sentinels. {@link requiredAbstainMaxValue} places those at
 *   `choices.length`, `choices.length + 1`, …, and decode claims every column
 *   `>= choices.length` as abstention, so the real values must occupy exactly
 *   `0..choices.length-1`. Contiguity, not merely a bound: with values 1/2/3 the
 *   first sentinel *is* 3, so an abstention would be recorded as a vote for C3 and
 *   decode would then reassign that column to the abstain bucket.
 * - **approval / dense multichoice / budget / quadratic** — position-addressed. One
 *   field per choice in choice order, so `choice.value` is a display label the wire
 *   never sees and any values at all are fine.
 * - **ranked** — position-addressed too (it shares the pick-slot *protocol* but not
 *   its addressing: its fields are options, not slots, so there are no abstain
 *   sentinels for a value to collide with), with one exception. The values still
 *   label the decoded rows, and a ranking is expressed in them, so two choices
 *   sharing one are unorderable and come back as a single row id — see
 *   {@link duplicateRankedValuesReason}.
 *
 * Returns `null` rather than a verdict for shapes it cannot judge (no derivable
 * ballot type, no choices, non-integer or negative values), matching
 * {@link unsatisfiableProtocolReason}: this explains a well-formed config, it does
 * not police malformed input.
 */
export function uncastableChoicesReason(question: QuestionLike): string | null {
  let ballotType: BallotType
  try {
    ballotType = inferQuestionBallotType(question)
  } catch {
    // Neither a ballotProtocol nor a recognized type — nothing to judge against.
    return null
  }

  const bp = question.ballotProtocol
  // Without a raw protocol the named singlechoice type derives maxValue from these
  // very values (questionProtocolBounds, mirroring VoteTypeFromQuestion), so every
  // value fits by construction and there is nothing to report.
  //
  // Ranked is the exception, because its defect is not measured against a ceiling at
  // all: two choices sharing a value are unorderable and decode to one row whatever the
  // protocol says. `encodeQuestionBallot` refuses such a question with or without a
  // protocol, so staying silent here would leave `hasUncastableChoices` disagreeing with
  // the encoder — and callers use it to decide whether the encoder's message is the
  // voter's to act on (see react-components' QuestionsFormProvider).
  if (!bp) {
    return ballotType === BallotType.Ranked ? duplicateRankedValuesReason(question.choices) : null
  }

  return uncastableChoicesReasonFor(
    ballotType,
    question.choices,
    bp.maxValue,
    // Per-question, the MultiChoice label covers both wire layouts; only the
    // pick-slot one shares its value space with the abstain sentinels.
    isPickSlotLayout(question)
  )
}

/**
 * The part of {@link uncastableChoicesReason} that no per-ballot check can reach:
 * pick-slot choice values colliding with the abstain sentinel space.
 *
 * Split out because encode treats the two halves of the rule differently.
 * {@link assertEncodedBallot} already catches a value above `maxValue` on the one
 * ballot that carries it, so the ceiling half needs no separate up-front refusal — it
 * surfaces for the voter who picks the unreachable option and nobody else. This half
 * has no such backstop: the colliding values sit *within* `maxValue`, so every
 * individual ballot passes the bounds check while meaning something other than what
 * the voter picked. With values 1/2/3 the first sentinel *is* 3, so an abstention is
 * recorded as a vote for C3 and decode then reassigns that column to the abstain
 * bucket — a corruption no ballot inspection can detect, because no ballot is wrong.
 *
 * Returns `null` for shapes it cannot judge, like its caller.
 */
export function pickSlotCollisionReason(choices: Choice[]): string | null {
  const values = choices?.map((choice) => choice.value) ?? []
  if (values.length === 0) return null
  if (values.some((value) => !Number.isInteger(value) || value < 0)) return null

  // Only the *set* of values matters, not the order they appear in: encode passes the
  // picked value through and decode reads column `choice.value`, so a permutation like
  // [2, 0, 1] maps every choice to its own column just fine. What breaks is a value
  // landing at or above `numChoices`, where the sentinels live.
  const numChoices = values.length
  const sorted = [...values].sort((a, b) => a - b)
  if (sorted.every((value, i) => value === i)) return null

  return (
    `pick-slot multichoice requires the choice values to be exactly the set 0..${numChoices - 1} ` +
    `(in any order), but they are ${values.join(', ')}. Unfilled pick-slots are padded with ` +
    `abstain sentinels starting at ${numChoices}, and decoding treats every column >= ` +
    `${numChoices} as an abstention — so a value in that range is indistinguishable from an ` +
    'abstain, and a gap below it pushes a real choice up into sentinel space. Renumber the ' +
    `choices 0..${numChoices - 1}`
  )
}

/**
 * Explain why a *ranked* question's choice values make its result unreadable, or
 * `null` when every choice carries its own value.
 *
 * The mirror image of {@link pickSlotCollisionReason}, and split out for the same
 * reason: no ballot inspection can reach it. Ranked is position-addressed, so a
 * duplicated `choice.value` never touches the wire — `[2, 1, 0]` is a perfectly
 * well-formed ranking whatever the choices are called — and
 * {@link assertEncodedBallot} has nothing to object to. The damage is on the way back
 * out: `decodeQuestionResults` keys each row by `choice.value`, so two options return
 * under one id, and a consumer looking a row up by choice id finds one title carrying
 * two different scores (React additionally sees duplicate keys). A ranking cannot
 * express a preference between them either, which is why
 * {@link rankedOrderToScores} refuses the same shape.
 *
 * Returns `null` for shapes it cannot judge, like its neighbours here.
 */
export function duplicateRankedValuesReason(choices: Choice[]): string | null {
  const values = choices?.map((choice) => choice.value) ?? []
  if (values.length === 0) return null
  if (values.some((value) => !Number.isInteger(value) || value < 0)) return null

  const duplicated = [...new Set(values.filter((value, i) => values.indexOf(value) !== i))]
  if (duplicated.length === 0) return null

  return (
    `choice value(s) ${duplicated.join(', ')} are used by more than one choice. A ranking is ` +
    'keyed by choice value, so it cannot tell those options apart, and the decoded results ' +
    'would report both under one choice id — one option rendered twice, with two different ' +
    'scores. Give every choice a distinct value'
  )
}

/**
 * The rule behind {@link uncastableChoicesReason}, with the ballot type already
 * resolved.
 *
 * Election-level callers ({@link encodeBallot}) must not re-infer per question:
 * `inferBallotType` reads the whole election — most importantly "more than one
 * question ⇒ single-choice" — which no per-question view can reconstruct. They pass
 * the election's own verdict in instead. Not re-exported from the package index;
 * `uncastableChoicesReason` is the public entry point.
 *
 * @param isPickSlot - only consulted for {@link BallotType.MultiChoice}, which names
 *   two different wire layouts per question. At election level the discrimination has
 *   already happened (dense lands on {@link BallotType.Approval}), so pass `true`.
 */
export function uncastableChoicesReasonFor(
  ballotType: BallotType,
  choices: Choice[],
  maxValue: number,
  isPickSlot: boolean
): string | null {
  const values = choices?.map((choice) => choice.value) ?? []
  if (values.length === 0) return null
  if (values.some((value) => !Number.isInteger(value) || value < 0)) return null

  // Shared by both value-addressed layouts: a value above the protocol's ceiling
  // addresses a column the chain refuses, so that option can never be recorded.
  //
  // `maxValue === 0` is NOT a ceiling of zero — module-wide it means "no upper
  // bound" (`unsatisfiableProtocolReason` below, `assertEncodedBallot`'s
  // `bounds.maxValue > 0 &&` guard, `decode.ts`). Treating it as a real ceiling
  // would refuse every non-zero value on a protocol the chain does not bound, and
  // diagnose it as a ceiling problem. Reachable whenever a declared type outranks
  // the shape rules, e.g. `{type: 'singlechoice', ballotProtocol: {maxValue: 0}}`,
  // which `inferQuestionBallotType` resolves by name before it can read the 0 as
  // budget/quadratic.
  const beyondCeiling = (): number[] =>
    Number.isInteger(maxValue) && maxValue > 0 ? values.filter((value) => value > maxValue) : []

  if (ballotType === BallotType.SingleChoice) {
    // Two choices sharing one value are one column on the wire. Decode reads
    // `results[q][choice.value]` for each, so a single vote for either reports as a
    // vote for BOTH and the question's percentages sum past 100 — the second option
    // can never be recorded *as itself*, which is the same defect as an out-of-range
    // value wearing a different face. Named before the ceiling check because it is
    // the more specific diagnosis when a config manages both.
    const duplicated = [...new Set(values.filter((value, i) => values.indexOf(value) !== i))]
    if (duplicated.length > 0) {
      return (
        `choice value(s) ${duplicated.join(', ')} are used by more than one choice, but ` +
        'single-choice is value-addressed: the results row is indexed by choice value, so ' +
        'those choices share one column and a vote for either is counted for all of them, ' +
        'pushing the percentages past 100. Give every choice a distinct value'
      )
    }

    const beyond = beyondCeiling()
    if (beyond.length === 0) return null
    return (
      `choice value(s) ${beyond.join(', ')} exceed maxValue ${maxValue}, so no voter can ` +
      'record them: the chain accepts such a ballot, counts it in voteCount and discards it at ' +
      'tally, leaving the option polling zero while the vote looks cast. Raise maxValue to at ' +
      `least ${Math.max(...values)}, or renumber the choices into 0..${maxValue}`
    )
  }

  if (ballotType === BallotType.MultiChoice && isPickSlot) {
    // Pick-slot has two ways to publish an unreachable option, and needs both checks.
    // The first also covers duplicates, as a side effect of requiring the exact set
    // 0..n-1: a repeat forces some other value out of range.
    const numChoices = values.length

    const collision = pickSlotCollisionReason(choices)
    if (collision) return collision

    // The ceiling still has to clear the highest of those values — a pick-slot
    // protocol may carry any maxValue >= 2, including one below numChoices - 1.
    const beyond = beyondCeiling()
    if (beyond.length === 0) return null
    return (
      `choice value(s) ${beyond.join(', ')} exceed maxValue ${maxValue}, so no voter can ` +
      'record them: the chain accepts such a ballot, counts it in voteCount and discards it at ' +
      `tally. A pick-slot multichoice over ${numChoices} choices needs maxValue >= ` +
      `${numChoices - 1}, plus headroom for abstain sentinels if partial selections should be ` +
      'castable (see requiredAbstainMaxValue)'
    )
  }

  if (ballotType === BallotType.Ranked) {
    // Position-addressed, so the values never reach the wire — but they do label the
    // decoded rows, and a ranking has no way to order two options that share one.
    return duplicateRankedValuesReason(choices)
  }

  // The remaining position-addressed layouts: choice.value never reaches the wire.
  return null
}

/** True when {@link uncastableChoicesReason} has something to say about `question`. */
export function hasUncastableChoices(question: QuestionLike): boolean {
  return uncastableChoicesReason(question) !== null
}

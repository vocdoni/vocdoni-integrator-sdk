import type { BallotProtocol, Choice, Election, Question, QuestionTypeSetup, VoteType } from '@vocdoni/api-types'
import { BallotType, type BallotSelections } from './types'
import { declaresRanked, inferBallotType, inferQuestionBallotType, isPickSlotLayout } from './infer'
import { normalizeSelections } from './selections'
import { requiredAbstainMaxValue } from './abstain'
import {
  assertEncodedBallot,
  duplicateRankedValuesReason,
  pickSlotCollisionReason,
  uncastableChoicesReason,
  uncastableChoicesReasonFor,
  unrankableProtocolReason,
  unsatisfiableProtocolReason,
  unsatisfiableQuestionReason,
  voteTypeBounds,
  type ProtocolBounds,
} from './protocol'

/**
 * Encode high-level voter selections into the on-chain ballot array format.
 *
 * `selections` accepts a flat `number[]` (the ergonomic default) or a nested
 * `number[][]` (one array per question); both normalize to the same output — see
 * {@link BallotSelections}.
 *
 * Encoding rules (must match vochain scrutinizer):
 * - single-choice (multi-question): one chosen choice value per question: [v0, v1, …]
 * - approval: dense 0/1 vector over options: choices.map(c => selected.has(c) ? 1 : 0)
 * - multichoice: exactly `maxCount` picked option values, unfilled slots padded with abstain
 *   sentinels (values ≥ choices.length; see encodeMultiChoice)
 * - ranked: per-option rank array in choice order, highest = best — pass-through, but one
 *   rank per option is required; build it with {@link rankedOrderToScores}, or hand the
 *   voter's ordering to {@link encodeQuestionSelections} and let it do both (see encodeRanked)
 * - budget / quadratic: per-option amount array [a0, a1, …]
 *
 * @param input - Election config with questions and voteType
 * @param selections - Per-question choice values (single/multi) or per-option amounts (budget/quadratic)
 * @returns The ballot array as numbers
 * @throws When the election's ballot config is unsatisfiable — see
 *   {@link unsatisfiableProtocolReason} — when a pick-slot question's choice values
 *   collide with the abstain sentinels (see {@link pickSlotCollisionReason}, refused
 *   for every voter because no individual ballot shows the defect), or when the
 *   encoded ballot itself would violate the protocol's per-field bounds (a value above
 *   `maxValue`, or a repeat under `uniqueChoices` — see {@link assertEncodedBallot}),
 *   which refuses only the voter who picked it. Either way the chain would accept the
 *   vote and drop it at tally, so refuse rather than cast a vote that never counts.
 */
export function encodeBallot(
  input: Pick<Election, 'questions' | 'voteType'> & { type?: string; meta?: Record<string, unknown> },
  selections: BallotSelections
): number[] {
  const { questions, voteType } = input
  const bounds = voteTypeBounds(voteType)
  const unsatisfiable = unsatisfiableProtocolReason(bounds)
  if (unsatisfiable) {
    throw new Error(`cannot encode a ballot for this election: ${unsatisfiable}`)
  }
  const ballotType = inferBallotType(input)
  // A satisfiable protocol can still publish an option no voter can reach, and the two
  // ways it can differ in who has to be refused.
  //
  // A value above maxValue is caught by assertEncodedBallot below, on the one ballot
  // that carries it — so the voter who picks the dead option is stopped and everyone
  // else votes normally. That matters: verified live in value-skew.itest.ts, an
  // election with values 1/2/3 under maxValue 2 still tallies the in-range votes
  // correctly (raw matrix [["0","1","0"]] — C1's vote counted, C3's lost). Refusing
  // every voter would discard ballots the chain records correctly.
  //
  // A pick-slot value colliding with the abstain sentinels has no such backstop — the
  // colliding values are *within* maxValue, so no ballot is individually wrong while
  // abstentions and real picks are being conflated. Nothing downstream can notice, so
  // this one is refused up front, for everybody.
  //
  // Dense already resolved to Approval by inferBallotType, so MultiChoice here can
  // only be the pick-slot layout. Only questions[0] reaches the wire for it (see the
  // switch below), so questions nobody encodes are not judged.
  if (ballotType === BallotType.MultiChoice) {
    const collision = pickSlotCollisionReason(questions[0]?.choices ?? [])
    if (collision) {
      throw new Error(`cannot encode a ballot for question 0: ${collision}`)
    }
  }
  // Same shape of defect for ranked, and refused the same way — for every voter, up
  // front. `assertEncodedBallot` cannot stand in for it: at maxValue 0 it treats the
  // bound as absent, so every ballot passes while the tally is structurally zero.
  if (ballotType === BallotType.Ranked) {
    const unrankable = unrankableProtocolReason(questions[0]?.choices.length ?? 0, voteType.maxValue)
    if (unrankable) {
      throw new Error(`cannot encode a ballot for question 0: ${unrankable}`)
    }
    // Same reason again: a duplicated choice value leaves every ballot well-formed
    // and the results unreadable, so no per-ballot check downstream can notice.
    const ambiguous = duplicateRankedValuesReason(questions[0]?.choices ?? [])
    if (ambiguous) {
      throw new Error(`cannot encode a ballot for question 0: ${ambiguous}`)
    }
  }
  const perQuestion = normalizeSelections(input, selections)

  const ballot = ((): number[] => {
    switch (ballotType) {
      case BallotType.SingleChoice:
        return encodeSingleChoice(questions, perQuestion)

      case BallotType.Approval:
        // approval: dense 0/1 vector, confirmed correct vs vochain scrutinizer
        // (NOT the legacy Form.tsx index list, which is buggy for >2 options)
        return encodeApproval(questions[0], perQuestion[0] ?? [])

      case BallotType.MultiChoice:
        return encodeMultiChoice(voteType, questions[0], perQuestion[0] ?? [])

      case BallotType.Ranked:
        return encodeRanked(perQuestion[0] ?? [], questions[0]?.choices.length ?? 0)

      case BallotType.Budget:
      case BallotType.Quadratic:
        return encodeBudgetOrQuadratic(perQuestion[0] ?? [])

      default:
        throw new Error(`Unknown ballot type: ${ballotType}`)
    }
  })()

  // The config being satisfiable does not make this ballot satisfying: a stray
  // selection value or a duplicated unique pick still yields a ballot the chain
  // accepts and never counts, so check the product, not just the config.
  //
  // When it does fail, say *why* if the election itself explains it. The bounds error
  // is accurate but wire-level ("field 0 is 3, above maxValue 2"), and a voter reading
  // it cannot tell a mistyped selection from a question that published an option
  // nobody can cast. Only consulted on the failure path, so a healthy vote never pays
  // for the diagnosis.
  try {
    assertEncodedBallot(ballot, bounds)
  } catch (err) {
    // Only the questions that actually reached the wire can explain this ballot.
    // Single-choice lays out one field per question; every other type encodes
    // questions[0] alone (see the switch above), so blaming questions[1] for a
    // failure it could not have caused would be a worse diagnosis than none.
    const encoded = ballotType === BallotType.SingleChoice ? questions : questions.slice(0, 1)
    for (const [q, question] of encoded.entries()) {
      const uncastable = uncastableChoicesReasonFor(ballotType, question.choices, voteType.maxValue, true)
      if (uncastable) {
        throw new Error(`cannot encode a ballot for question ${q}: ${uncastable}`)
      }
    }
    throw err
  }
  return ballot
}

/**
 * Encode single-choice ballot: one choice value per question.
 *
 * Each question is a field whose value is the chosen choice. Single-choice has no
 * abstain concept: if abstaining is offered, the process creator adds an explicit
 * "Abstain" option as a normal choice, so the voter always picks exactly one value.
 * An empty selection is therefore invalid input, not an abstention.
 */
function encodeSingleChoice(questions: Question[], selections: number[][]): number[] {
  return selections.map((choices, q) => {
    if (choices.length === 0) {
      throw new Error(`Question ${q}: single-choice requires exactly one choice`)
    }
    // Take the first selected value. encodeBallot does not run validateSelections, so it
    // only guards against an empty pick here; if a caller passes more than one value, the
    // extras are ignored. Call validateSelections separately to reject that up front.
    return choices[0]
  })
}

/**
 * Encode approval ballot: dense 0/1 vector over all choices.
 */
function encodeApproval(question: Question, selections: number[]): number[] {
  const has = new Set(selections)
  return question.choices.map((choice) => (has.has(choice.value) ? 1 : 0))
}

/**
 * Encode multichoice ballot: the picked option values, one per pick-slot.
 *
 * The scrutinizer enforces only the *upper* bound — a ballot may hold fewer than `maxCount`
 * picks (the legacy SDK sends short ballots unpadded), so a partial selection is returned
 * as-is unless the protocol reserves abstain sentinels, in which case unfilled slots are
 * padded. The sentinels are the values just past the valid choice indices
 * (`0..choices.length-1`); the ballot config reserves them by setting
 * `maxValue >= choices.length` (legacy SDK: `maxValue = choices.length - 1 + abstainAllowance`):
 *
 * - `uniqueChoices === false` (choices may repeat): a single abstain value `choices.length`,
 *   reused for every empty slot.
 * - `uniqueChoices === true` (choices are unique): distinct ascending values
 *   `choices.length, choices.length + 1, …`, one per empty slot, so no value repeats.
 *
 * Throws only when there are more selections than `maxCount`. Fewer than `maxCount` is
 * always allowed: padded with abstain sentinels when the config reserves enough room (the
 * reservation formula `maxValue >= choices.length - 1 + (uniqueChoices ? maxCount : 1)`),
 * otherwise returned short — the vochain accepts it, and a minimum-pick count is the UI's
 * concern (`typeSetup.minChoices`), not the encoder's (there is no on-chain minimum).
 */
function encodeMultiChoice(voteType: VoteType, question: Question, selections: number[]): number[] {
  const numChoices = question.choices.length
  const { maxCount } = voteType
  const ballot = [...selections]

  if (ballot.length > maxCount) {
    throw new Error(
      `multichoice: too many selections (${ballot.length}); at most maxCount (${maxCount}) allowed`
    )
  }
  if (ballot.length === maxCount) return ballot

  // Fewer picks than slots. Pad with abstain sentinels only when the config reserves enough
  // room (repeatable ballots reuse a single sentinel +1; unique ballots need one distinct
  // ascending sentinel per slot +maxCount — matching the legacy maxValue reservation).
  // Otherwise return the short ballot as-is: the vochain accepts ballots shorter than
  // maxCount (it enforces only the upper bound) and the legacy SDK sends them unpadded.
  const neededMaxValue = requiredAbstainMaxValue(numChoices, voteType)
  if (voteType.maxValue >= neededMaxValue) {
    const unique = voteType.uniqueChoices
    let abstainSlot = 0
    while (ballot.length < maxCount) {
      ballot.push(unique ? numChoices + abstainSlot : numChoices)
      abstainSlot++
    }
  }
  return ballot
}

/**
 * Encode a ranked ballot: **pass-through** of one rank per option, in choice order.
 *
 * The wire layout *is* the caller's array — the field index is the option's position
 * in `choices` and its value is that option's rank — so there is nothing to
 * rearrange, exactly like budget/quadratic. What this function contributes is the
 * name: the ballot is the voter's ranking, not a list of picks, and the two are
 * indistinguishable on the wire.
 *
 * **Canonical orientation: highest value = best.** Top choice gets `numChoices - 1`,
 * last gets `0`. This is a choice, not a fact — the protocol has no opinion — and it
 * is the one `saas-integrator-demo` ships and `decodeQuestionResults` assumes. Its
 * Borda decode is an index-weighted sum, so a ballot built the other way round
 * elects the loser and nothing on either side can detect it. Build the array with
 * {@link rankedOrderToScores} rather than by hand and the orientation is applied for
 * you.
 *
 * Length is checked here and nowhere else. `assertEncodedBallot` (run by both
 * encoders on what they produce) refuses a duplicated rank under `uniqueValues` and a
 * rank above `maxValue`, but it has no opinion on how many fields a ballot has — so a
 * short slate would sail through as a valid ballot that simply leaves the last options
 * unranked and skews the Borda tally, while {@link validateSelections} refuses the
 * identical input. The two have to agree, or a UI gating its submit button on the
 * validator enables a vote the encoder then rejects (and a caller building the ranks
 * by hand gets no verdict at all). Padding is not an option: a ranked protocol is
 * pigeonhole-tight, so any filler value repeats a rank and the chain drops the whole
 * ballot at tally.
 */
function encodeRanked(selections: number[], numChoices: number): number[] {
  if (selections.length !== numChoices) {
    throw new Error(
      `ranked requires one rank per option (${numChoices}), got ${selections.length}`
    )
  }
  return [...selections]
}

/**
 * Turn a voter's ranking — the choice **values** they ordered, best first — into the
 * wire ballot {@link encodeQuestionBallot} expects for a ranked question: one rank
 * per option, in **choice order**, highest = best.
 *
 * The two are transposes of each other, and the conversion is where the orientation
 * decision physically lives. Written by hand it is `n - 1 - position`, the line
 * `saas-integrator-demo` open-codes in its vote page; getting it backwards produces
 * a perfectly valid ballot that the Borda decode reads upside-down.
 *
 * ```ts
 * // choices C0..C3, voter ranks C2 > C0 > C3 > C1
 * rankedOrderToScores(question, [2, 0, 3, 1])  // → [2, 0, 3, 1]
 * // choices C0..C2, voter ranks C2 > C0 > C1
 * rankedOrderToScores(question, [2, 0, 1])     // → [1, 0, 2]
 * ```
 *
 * (The first example round-trips to itself only because that particular ordering is
 * its own transpose — do not read it as a pass-through.)
 *
 * @param question - the ranked question, read for its `choices`
 * @param order - the choice values, best first; must be a complete permutation
 * @throws When the ranking names an unpublished choice, repeats one, or leaves any
 *   option unranked. A ranked protocol is pigeonhole-tight (`maxValue = numChoices -
 *   1` with `uniqueValues`), so a partial ranking cannot be padded into anything the
 *   chain will count — it would repeat a rank and be discarded at tally with the
 *   vote still counted in `voteCount`.
 */
export function rankedOrderToScores(question: { choices: Choice[] }, order: number[]): number[] {
  const choices = question.choices ?? []
  const values = choices.map((choice) => choice.value)
  const published = new Set(values)

  // Ranks are keyed by choice value, so two choices sharing one value have no ranking
  // between them. This cannot corrupt a ballot — a complete ranking needs one distinct
  // published value per choice and duplicates leave fewer, so every possible `order`
  // already fails one of the checks below — but it fails describing the *ranking* when
  // the defect is in the *question*. Say so directly, in the words the encoders and the
  // creation-time guard use for the same defect.
  const ambiguous = duplicateRankedValuesReason(choices)
  if (ambiguous) {
    throw new Error(`ranked: ${ambiguous}`)
  }

  const rankByValue = new Map<number, number>()

  order.forEach((value, position) => {
    if (!published.has(value)) {
      throw new Error(
        `ranked: ${value} is not a choice value of this question (published: ${values.join(', ')})`
      )
    }
    if (rankByValue.has(value)) {
      throw new Error(`ranked: choice ${value} appears more than once in the ranking`)
    }
    // Highest = best: the first-placed option takes the top rank.
    rankByValue.set(value, choices.length - 1 - position)
  })

  if (order.length !== choices.length) {
    const missing = values.filter((value) => !rankByValue.has(value))
    throw new Error(
      `ranked: every option must be ranked (${order.length} of ${choices.length} ranked` +
        `${missing.length > 0 ? `, missing ${missing.join(', ')}` : ''}). A ranked protocol ` +
        'leaves exactly one rank per option, so a partial ranking repeats a value and the ' +
        'chain discards the whole ballot at tally'
    )
  }

  return choices.map((choice) => rankByValue.get(choice.value)!)
}

/**
 * Encode one question's ballot from the selections a **voter-facing form** collects,
 * whatever its ballot type — the entry point a UI should reach for.
 *
 * The difference from {@link encodeQuestionBallot} is one question wide, and it is the
 * whole reason this exists. Every other type's selections *are* its wire input (choice
 * values for single/multi/approval, per-option amounts for budget/quadratic), but a
 * ranked question's are the voter's **ordering** — the choice values they placed, best
 * first — while the wire wants one rank per option in choice order. The two are
 * transposes, and {@link rankedOrderToScores} is where the highest-is-best orientation
 * is applied.
 *
 * Without this function that branch has to be written out at every call site, and
 * getting it wrong is undetectable: an ordering passed straight to
 * `encodeQuestionBallot` is a perfectly valid ballot that the Borda decode reads
 * upside-down, so the chain accepts it, the tally looks healthy, and the loser wins.
 * Here the branch lives once, in the package that owns the orientation.
 *
 * @param question - The question, read for its declaration, protocol and choices
 * @param selections - What the form collected: the ordering (best first) for a ranked
 *   question, the raw selections for every other type
 * @throws Everything {@link encodeQuestionBallot} throws, plus — for ranked — whatever
 *   {@link rankedOrderToScores} refuses: an unpublished choice, a repeat, or an
 *   incomplete ordering.
 */
export function encodeQuestionSelections(
  question: { ballotProtocol?: BallotProtocol; type?: string; metadata?: Record<string, unknown>; typeSetup?: QuestionTypeSetup; choices: Choice[] },
  selections: number[]
): number[] {
  return encodeQuestionBallot(
    question,
    declaresRanked(question) ? rankedOrderToScores(question, selections) : selections
  )
}

/**
 * Encode budget or quadratic ballot: per-option amount array, in choice order.
 */
function encodeBudgetOrQuadratic(selections: number[]): number[] {
  // For budget/quadratic, selections are the amounts allocated to each option; the
  // caller supplies them already in choice order, so pass them through unchanged.
  return [...selections]
}

function ballotProtocolToVoteType(bp: BallotProtocol): VoteType {
  return {
    maxCount: bp.maxCount,
    maxValue: bp.maxValue,
    maxVoteOverwrites: bp.maxVoteOverwrites,
    costExponent: bp.costExponent,
    uniqueChoices: bp.uniqueValues,
    costFromWeight: bp.costFromWeight,
  }
}

/**
 * The protocol bounds a question's encoded ballot is judged against on chain: its raw
 * `ballotProtocol` when it carries one (the protocol overrides the named type at
 * creation), otherwise the named type's canonical derivation, mirroring saas-backend's
 * `BallotProtocolFromType` — `singlechoice` is one field whose `maxValue` covers the
 * highest `Choice.value` (values need not be contiguous), `multichoice` is the dense
 * 0/1 layout. A question with neither half has no derivable bounds.
 */
function questionProtocolBounds(question: {
  ballotProtocol?: BallotProtocol
  type?: string
  metadata?: Record<string, unknown>
  typeSetup?: QuestionTypeSetup
  choices: Choice[]
}): ProtocolBounds | null {
  if (question.ballotProtocol) return question.ballotProtocol
  // A declared ranking has a canonical protocol even when the read omitted it (public
  // reads may): one field per option, ranks 0..n-1, no two the same. Deriving it is not
  // a convenience — the `?? { maxValue: 0, uniqueValues: false }` fallback at the call
  // site means "unbounded, repeats fine", so without this `[1, 1, 1]` encodes cleanly as
  // a ranking and the chain records the envelope then drops the ballot at tally, with
  // nothing on either side having objected. Not in the switch below because `ranked` is
  // not a backend type name — it is reachable through the metadata bag too.
  if (declaresRanked(question)) {
    const n = question.choices.length
    return { maxCount: n, maxValue: Math.max(0, n - 1), uniqueValues: true }
  }
  switch (question.type) {
    case 'singlechoice':
      return {
        maxCount: 1,
        maxValue: Math.max(0, ...question.choices.map((choice) => choice.value)),
        uniqueValues: false,
      }
    case 'multichoice':
      return {
        maxCount: question.choices.length,
        maxValue: 1,
        uniqueValues: question.typeSetup?.uniqueChoices ?? false,
      }
    default:
      return null
  }
}

/**
 * Encode a single question's ballot using its own {@link BallotProtocol}.
 *
 * @param question - The question with `ballotProtocol` and `choices`
 * @param selections - The voter's raw selections for this question
 * @throws When the question's ballot config is unsatisfiable — see
 *   {@link unsatisfiableQuestionReason} — when a pick-slot question's choice values
 *   collide with the abstain sentinels (see {@link pickSlotCollisionReason}), or when
 *   the encoded ballot itself would violate the question's protocol bounds (a value
 *   above `maxValue`, or a repeat under `uniqueValues` — see
 *   {@link assertEncodedBallot}). Every such ballot is dropped by the scrutinizer at
 *   tally while still counting towards `voteCount`, so refuse instead of letting the
 *   voter cast a vote that never counts. The first refuses every voter, the last only
 *   the one whose selection is out of range — see the note in {@link encodeBallot}.
 */
export function encodeQuestionBallot(
  question: { ballotProtocol?: BallotProtocol; type?: string; metadata?: Record<string, unknown>; typeSetup?: QuestionTypeSetup; choices: Choice[] },
  selections: number[]
): number[] {
  const unsatisfiable = unsatisfiableQuestionReason(question)
  if (unsatisfiable) {
    throw new Error(`cannot encode a ballot for this question: ${unsatisfiable}`)
  }
  const ballotType = inferQuestionBallotType(question)
  // Satisfiable is not the same as fully castable — see the note in encodeBallot for
  // why only this half of the rule is refused up front. The sentinel collision leaves
  // no trace on any individual ballot, so assertEncodedBallot below cannot stand in
  // for it; the ceiling half can, and does.
  if (ballotType === BallotType.MultiChoice && isPickSlotLayout(question)) {
    const collision = pickSlotCollisionReason(question.choices)
    if (collision) {
      throw new Error(`cannot encode a ballot for this question: ${collision}`)
    }
  }
  // Ranked's version of the same defect: duplicated choice values leave every ballot
  // well-formed and the decoded rows sharing an id, so nothing downstream can notice.
  if (ballotType === BallotType.Ranked) {
    const ambiguous = duplicateRankedValuesReason(question.choices)
    if (ambiguous) {
      throw new Error(`cannot encode a ballot for this question: ${ambiguous}`)
    }
  }
  const fakeQuestion: Question = { title: { default: '' }, choices: question.choices }

  const ballot = ((): number[] => {
    switch (ballotType) {
      case BallotType.SingleChoice:
        if (selections.length !== 1) {
          throw new Error(`single-choice requires exactly one choice (got ${selections.length})`)
        }
        return [selections[0]]

      case BallotType.Approval:
        return encodeApproval(fakeQuestion, selections)

      case BallotType.MultiChoice: {
        const bp = question.ballotProtocol
        // Named multichoice derives the dense layout on chain (one 0/1 field per
        // choice, maxTotalCost = typeSetup.maxChoices bounding the picks) —
        // encode dense, not pick-slot. Pick-slot values (choice values, abstain
        // sentinels >= numChoices) would exceed maxValue = 1 and the chain
        // silently discards them at tally. Public reads of named-type questions
        // may omit the protocol entirely; the layout is still fully determined
        // by the type, with the pick bound read from typeSetup.
        //
        // The legacy `multiple-choice` metadata name means the opposite — pick-slot.
        // isPickSlotLayout owns that discrimination and decode makes the same call;
        // the two disagreeing is how a ballot goes out on the wrong axis.
        if (!isPickSlotLayout(question)) {
          const cap = bp?.maxTotalCost || question.typeSetup?.maxChoices || 0
          if (cap > 0 && selections.length > cap) {
            throw new Error(
              `multichoice: too many selections (${selections.length}); at most ${cap} allowed`
            )
          }
          return encodeApproval(fakeQuestion, selections)
        }
        if (!bp) {
          // Only reachable via a legacy pick-slot name on a protocol-less read. Pick-slot
          // needs `maxCount` to size the slate and `maxValue` to know whether abstain
          // sentinels are reserved; guessing either produces a ballot the chain accepts
          // and drops at tally, so refuse and let the caller fetch the protocol.
          throw new Error(
            'cannot encode a legacy multiple-choice ballot without a ballotProtocol: ' +
              'the pick-slot layout needs maxCount/maxValue to pad abstain slots'
          )
        }
        return encodeMultiChoice(ballotProtocolToVoteType(bp), fakeQuestion, selections)
      }

      case BallotType.Ranked:
        return encodeRanked(selections, question.choices.length)

      case BallotType.Budget:
      case BallotType.Quadratic:
        return encodeBudgetOrQuadratic(selections)

      default:
        throw new Error(`Unknown ballot type: ${ballotType}`)
    }
  })()

  // A satisfiable config still admits unsatisfying ballots — duplicate ranks on a
  // unique-values protocol, an amount above maxValue, a stray selection value. The
  // chain accepts all of those and never counts them, so check the product too.
  // Without derivable bounds only the fields' basic shape can be checked.
  //
  // On failure, prefer the election-level diagnosis when there is one: this is where
  // a voter meets a question that published an option nobody can cast, and the bounds
  // error alone reads as if they mistyped something. Failure path only, so the common
  // case never pays for the extra inference.
  try {
    assertEncodedBallot(ballot, questionProtocolBounds(question) ?? { maxCount: ballot.length, maxValue: 0, uniqueValues: false })
  } catch (err) {
    const uncastable = uncastableChoicesReason(question)
    if (uncastable) {
      throw new Error(`cannot encode a ballot for this question: ${uncastable}`)
    }
    throw err
  }
  return ballot
}

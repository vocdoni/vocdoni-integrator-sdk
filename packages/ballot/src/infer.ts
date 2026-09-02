import type { BallotProtocol, Election } from '@vocdoni/api-types'
import { BallotType } from './types'

/**
 * Legacy vochain type names — the `ElectionResultsTypeNames` enum of `@vocdoni/sdk`,
 * as stored under `type.name` in an election's (or, in the SaaS model, a question's)
 * open-ended metadata bag.
 *
 * Deliberately separate from {@link SAAS_TYPE_NAMES}: the vocabulary is keyed by the
 * *field the name came from*, because each vocabulary names a different wire layout. Legacy
 * `"multiple-choice"` is the pick-slot index list; the SaaS `"multichoice"` is the dense
 * 0/1 layout the backend derives. Reading a SaaS spelling as a legacy one at the election
 * level would column-sum a dense matrix ({@link decodeResults} has no dense remap), and
 * vice versa inverts a two-option tally — so a name is only ever resolved against the
 * table belonging to the field it was read from.
 *
 * No `ranked` entry: the legacy enum has no such member. `ranked` is this SDK's own
 * name — see {@link SDK_TYPE_NAMES}.
 */
const LEGACY_TYPE_NAMES: Record<string, BallotType> = {
  'single-choice-multiquestion': BallotType.SingleChoice,
  'multiple-choice': BallotType.MultiChoice,
  approval: BallotType.Approval,
  'budget-based': BallotType.Budget,
  quadratic: BallotType.Quadratic,
}

/**
 * SaaS question type names (`VotingProcessQuestion.type`, i.e.
 * `VOTING_PROCESS_QUESTION_TYPES`) mapped onto this package's labels. Stored empty for
 * raw-`ballotProtocol` questions, which is why an empty string must read as "no name".
 * See {@link LEGACY_TYPE_NAMES} for why the two tables are not merged.
 */
const SAAS_TYPE_NAMES: Record<string, BallotType> = {
  singlechoice: BallotType.SingleChoice,
  multichoice: BallotType.MultiChoice,
}

/**
 * Names this SDK defines itself (`ranked`, issue #22), recognized in **both** name
 * channels since they belong to neither upstream vocabulary. Ranked is reachable only
 * by name: its protocol is byte-identical to a full-slate pick-slot multichoice with
 * transposed field/value meanings, so shape carries no signal. The backend rejects
 * `type: 'ranked'` at creation — a ranked question is created as a raw
 * `ballotProtocol` plus `metadata: {type: {name: 'ranked'}}`, stored and echoed back
 * verbatim — but `type` is still resolved here for callers keeping their own record.
 * See packages/ballot/README.md for the full model.
 */
const SDK_TYPE_NAMES: Record<string, BallotType> = {
  ranked: BallotType.Ranked,
}

/**
 * True when a question's legacy metadata bag declares `multiple-choice` — the *pick-slot*
 * index list, not the dense layout the SaaS `multichoice` type names.
 *
 * `decodeQuestionResults` needs this to know when to skip its dense remap. Both layouts can
 * present as `{maxValue: 1, maxCount > 1, uniqueValues: false}`, so
 * {@link isDenseBallotProtocol} answers "true" for a legacy pick-slot ballot too; without
 * this check the remap would relabel it approval and invert a two-option tally — exactly
 * the defect this declared-name lookup exists to prevent.
 */
export function declaresLegacyPickSlot(question: { metadata?: Record<string, unknown> }): boolean {
  return legacyTypeFromMeta(question.metadata) === BallotType.MultiChoice
}

/**
 * True when a question declares itself `ranked`, in either name channel.
 *
 * Delegates to {@link inferQuestionBallotType} (minus its throw) so the two can never
 * disagree — including in the negative: a recognized SaaS `type` shadows a `ranked`
 * metadata name here exactly as it does there. The two answers feed different halves
 * of the same form, so disagreement is a form that cannot be submitted.
 */
export function declaresRanked(question: { type?: string; metadata?: Record<string, unknown> }): boolean {
  try {
    return inferQuestionBallotType(question) === BallotType.Ranked
  } catch {
    // Neither a recognized name nor a protocol: nothing declares anything.
    return false
  }
}

/**
 * Read a legacy `type.name` out of an open-ended metadata bag and resolve it against
 * {@link LEGACY_TYPE_NAMES}.
 *
 * The bag is `Record<string, unknown>` by declaration and creator-controlled in practice,
 * so every level is probed defensively — a bag whose `type` is a string, or whose `name`
 * is a number, yields `undefined` rather than throwing. In the SaaS model each question is
 * itself a vochain process, so this shape is reachable per question
 * (`VotingProcessQuestion.metadata`) as well as per election (`Election.meta`).
 */
function legacyTypeFromMeta(meta: Record<string, unknown> | undefined): BallotType | undefined {
  if (!meta || typeof meta !== 'object') return undefined
  const type = (meta as { type?: unknown }).type
  if (!type || typeof type !== 'object') return undefined
  const name = (type as { name?: unknown }).name
  if (typeof name !== 'string') return undefined
  return LEGACY_TYPE_NAMES[name] ?? SDK_TYPE_NAMES[name]
}

/**
 * Infer the ballot type from election configuration (declared type, questions, voteType).
 *
 * Decision tree (precedence matters):
 * 0. If `type`, or failing that `meta.type.name`, names a recognized legacy election
 *    type → that type, full stop.
 * 1. If questions.length > 1 → single-choice (multi-question elections are always single-choice)
 * 2. Else if voteType.maxValue === 0 → budget (costExponent === 1) | quadratic (costExponent === 2)
 * 3. Else (single question):
 *    - If voteType.maxCount === 1 → single-choice (pick one of N)
 *    - If voteType.maxValue === 1 → approval (dense 0/1 per option) when !uniqueChoices,
 *      else multichoice (a 2-option index-list, the only satisfiable maxValue===1 &&
 *      uniqueChoices shape)
 *    - Otherwise → multichoice (maxValue = numChoices-1, list of picks)
 *
 * Rule 0 exists because shape is a *reconstruction* of intent, and at `maxValue === 1` the
 * reconstruction is lossy. A legacy `MultiChoiceElection` over 2 choices with repeatable
 * picks and no abstain allowance generates `{maxCount: 2, maxValue: 1, uniqueChoices: false}`
 * — byte-identical to a 2-option `ApprovalElection`. `uniqueChoices` splits the *other*
 * maxValue===1 pair but not this one, and nothing else in the protocol can. The declared
 * name is the only signal, which is why the legacy SDK dispatches on `resultsType.name`
 * (`calculateChoiceResults`, `checkVote`) and never on shape.
 *
 * An absent, empty or unrecognized name falls through to the shape rules unchanged, so
 * callers with nothing to declare lose nothing. {@link BallotType.Ranked} is reachable
 * **only** by name — no shape rule below can produce it.
 *
 * Assumptions (shape path only):
 * - Approval/multichoice/budget/quadratic are single-question (questions.length === 1)
 * - Multi-question implies single-choice-per-question
 * - At maxValue === 1, uniqueChoices disambiguates dense approval from a 2-option index-list
 *
 * @param input - Election config with questions and voteType, optionally carrying the
 *   declared `type` and/or the legacy metadata bag (`meta.type.name`)
 * @returns The inferred ballot type
 * @throws When the declared type is `ranked` and the election has more than one
 *   question — see the guard below.
 */
export function inferBallotType(
  input: Pick<Election, 'questions' | 'voteType'> & {
    type?: string
    meta?: Record<string, unknown>
  }
): BallotType {
  const { questions, voteType } = input

  // Rule 0: a declared type is intent, not a reconstruction of it — prefer it. The
  // explicit field wins over the legacy bag, so a caller can override a stale metadata
  // name without editing the bag.
  const declared =
    (input.type ? (LEGACY_TYPE_NAMES[input.type] ?? SDK_TYPE_NAMES[input.type]) : undefined) ??
    legacyTypeFromMeta(input.meta)
  // A multi-question ranked election describes no layout: a ranking is one field per
  // *option* of one question, multi-question is one field per *question*, and either
  // reading tallies garbage silently. Refuse like every other uncountable config.
  if (declared === BallotType.Ranked && questions.length > 1) {
    throw new Error(
      `a ranked election must have exactly one question (got ${questions.length}): a ranking ` +
        'lays out one ballot field per option, which leaves no room for a second question. ' +
        'Encode and decode each ranked question on its own with encodeQuestionSelections / ' +
        'decodeQuestionResults'
    )
  }
  if (declared) return declared

  // Rule 1: Multiple questions → single-choice per question (highest precedence)
  if (questions.length > 1) {
    return BallotType.SingleChoice
  }

  // Rule 2: maxValue === 0 means budget or quadratic (costExponent distinguishes)
  if (voteType.maxValue === 0) {
    return voteType.costExponent === 2 ? BallotType.Quadratic : BallotType.Budget
  }

  // Single question - more specific rules
  // Rule 3a: maxCount === 1 means pick exactly one (single-choice)
  if (voteType.maxCount === 1) {
    return BallotType.SingleChoice
  }

  // Rule 3b: maxValue === 1 splits dense approval from a 2-option index-list on uniqueChoices.
  // !uniqueChoices → the dense 0/1 wire layout (approval): one field per choice, each 0/1.
  // uniqueChoices here can only be a 2-option index-list multichoice — it is the sole
  // satisfiable maxValue===1 && uniqueChoices shape (maxCount===2, pigeonhole; anything denser
  // is unsatisfiable and rejected at creation — see unsatisfiableProtocolReason). Its decode is
  // the pick-slot column sum, so it needs the MultiChoice label.
  // Load-bearing: the election-level decodeResults path has no dense remap, so its decode
  // routing depends entirely on this label.
  if (voteType.maxValue === 1) {
    return voteType.uniqueChoices ? BallotType.MultiChoice : BallotType.Approval
  }

  // Rule 3c: Otherwise → multichoice
  return BallotType.MultiChoice
}

/**
 * Infer the ballot type for a single question from its declared `type`, falling back to
 * its `ballotProtocol`. Mirrors the {@link inferBallotType} precedence for the
 * per-question model: declared intent first, reconstructed shape second.
 *
 * The named type is authoritative because the backend *derives* the protocol from it at
 * creation — so when the two appear to disagree, the name is the input and the shape is
 * the output. A `multichoice` question is dense whatever its `maxCount` says, and the
 * MultiChoice label is semantic only: the dense wire layout is selected by the codec via
 * {@link isDenseBallotProtocol}, not by the label (see `decodeQuestionResults`).
 *
 * Two name sources, each resolved against its own vocabulary — the table follows the
 * field, not the function (see {@link LEGACY_TYPE_NAMES}):
 *
 * 1. `type`, the SaaS field → {@link SAAS_TYPE_NAMES} (`singlechoice` / `multichoice`).
 * 2. `metadata.type.name`, the legacy bag → {@link LEGACY_TYPE_NAMES}. Reachable per
 *    question because in the SaaS model each question *is* its own vochain process, so a
 *    question mapped from a legacy election carries that election's `metadata.type`.
 *
 * Both also consult {@link SDK_TYPE_NAMES} (`ranked`) — the only route to
 * {@link BallotType.Ranked}, since no shape rule can produce it.
 *
 * An unrecognized or empty name (the stored form for raw-`ballotProtocol` questions) falls
 * through to the shape rules.
 *
 * Backend reads always carry a `ballotProtocol`, so the no-protocol path only applies to
 * partial shapes (e.g. `PublicQuestionResponse`); with neither a recognized name nor a
 * protocol there is nothing to infer from, so it throws rather than silently assuming
 * single-choice.
 */
export function inferQuestionBallotType(question: {
  ballotProtocol?: BallotProtocol
  type?: string
  metadata?: Record<string, unknown>
}): BallotType {
  const declared =
    (question.type ? (SAAS_TYPE_NAMES[question.type] ?? SDK_TYPE_NAMES[question.type]) : undefined) ??
    legacyTypeFromMeta(question.metadata)
  if (declared) return declared

  const bp = question.ballotProtocol
  if (!bp) {
    throw new Error(
      'cannot infer ballot type: question has neither a ballotProtocol nor a supported type'
    )
  }
  if (bp.maxValue === 0) {
    return bp.costExponent === 2 ? BallotType.Quadratic : BallotType.Budget
  }
  if (bp.maxCount === 1) return BallotType.SingleChoice
  if (bp.maxValue === 1) {
    // uniqueValues → a 2-option index-list (the only satisfiable maxValue===1 &&
    // uniqueValues shape is maxCount===2 — see isDenseBallotProtocol); it takes the
    // MultiChoice label even without a named type, since the backend empties the type
    // label for shapes it cannot name. Otherwise the dense layout applies, which with no
    // name to say otherwise is approval.
    if (bp.uniqueValues) return BallotType.MultiChoice
    return BallotType.Approval
  }
  return BallotType.MultiChoice
}

/**
 * True when a question's protocol uses the dense 0/1 wire layout: one ballot field
 * per choice, each 0 or 1, with `maxTotalCost` bounding the number of picks. This is
 * what the backend derives for the named `multichoice` type, and what legacy approval
 * elections use.
 *
 * `maxValue === 1` alone is not enough: a 2-option index-list (pick-slot) multichoice also
 * has `maxValue === 1` (two choices ⇒ values 0/1) but carries `uniqueValues: true`. Dense is
 * `uniqueValues: false` — uniqueness is already implicit (a choice can't be picked twice), and
 * dense + uniqueValues is the unsatisfiable pigeonhole shape rejected at creation — so
 * `uniqueValues` is what separates the two at `maxValue === 1`.
 */
export function isDenseBallotProtocol(
  bp: Pick<BallotProtocol, 'maxCount' | 'maxValue' | 'uniqueValues'>,
): boolean {
  return bp.maxValue === 1 && bp.maxCount > 1 && !bp.uniqueValues
}

/**
 * Which of the two wire layouts a MultiChoice question uses: the pick-slot index list
 * (`true`) or the dense 0/1 vector (`false`).
 *
 * Only meaningful once {@link inferQuestionBallotType} has said MultiChoice — the label
 * covers both layouts, and nothing else in the question distinguishes them. Callers that
 * already resolved a different type must not consult this.
 *
 * The single home for a rule that used to be written out at three call sites — encode,
 * decode and the uncastable-choices check — one of them as its own de Morgan'd negation.
 * They have to agree exactly: encode picking dense while validation judges pick-slot
 * waves through a question the codec then refuses, and decode disagreeing with encode
 * reads the tally off the wrong axis. Commit 0a6ee28 exists because one copy drifted.
 *
 * A missing protocol reads as dense: public reads of a named-type question may omit it,
 * and the named type always derives the dense layout. The legacy `multiple-choice`
 * metadata name overrides the shape test, because at two options a pick-slot protocol
 * also satisfies {@link isDenseBallotProtocol}.
 */
export function isPickSlotLayout(question: {
  ballotProtocol?: BallotProtocol
  metadata?: Record<string, unknown>
}): boolean {
  if (declaresLegacyPickSlot(question)) return true
  return !!question.ballotProtocol && !isDenseBallotProtocol(question.ballotProtocol)
}

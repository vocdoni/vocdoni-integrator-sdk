import type { BallotProtocol, Choice, Election } from '@vocdoni/api-types'
import { BallotType } from './types'

/**
 * A name → type lookup table with no prototype. The names it is indexed with are
 * creator-controlled (`type`, `metadata.type.name`), and on a plain object literal an
 * inherited key such as `constructor` or `toString` would resolve to a function — a
 * truthy non-{@link BallotType} that short-circuits every inference below.
 */
function nameTable(entries: Record<string, BallotType>): Readonly<Record<string, BallotType | undefined>> {
  return Object.freeze(Object.assign(Object.create(null) as Record<string, BallotType>, entries))
}

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
const LEGACY_TYPE_NAMES = nameTable({
  'single-choice-multiquestion': BallotType.SingleChoice,
  'multiple-choice': BallotType.MultiChoice,
  approval: BallotType.Approval,
  'budget-based': BallotType.Budget,
  quadratic: BallotType.Quadratic,
})

/**
 * SaaS question type names (`VotingProcessQuestion.type`, i.e.
 * `VOTING_PROCESS_QUESTION_TYPES`) mapped onto this package's labels. Stored empty for
 * raw-`ballotProtocol` questions, which is why an empty string must read as "no name".
 * See {@link LEGACY_TYPE_NAMES} for why the two tables are not merged.
 */
const SAAS_TYPE_NAMES = nameTable({
  singlechoice: BallotType.SingleChoice,
  multichoice: BallotType.MultiChoice,
})

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
const SDK_TYPE_NAMES = nameTable({
  ranked: BallotType.Ranked,
})

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
 * True when a question declares `ranked` and its protocol (if any) can hold a ranking.
 * Delegates to {@link inferQuestionBallotType} so the two never disagree.
 */
export function declaresRanked(question: {
  ballotProtocol?: BallotProtocol
  type?: string
  metadata?: Record<string, unknown>
  choices?: Choice[]
}): boolean {
  // Neither a recognized name nor a protocol reads as undefined: nothing declares anything.
  return tryInferQuestionBallotType(question) === BallotType.Ranked
}

/**
 * True when a question *names* itself `ranked`, whatever its protocol says. Only for the
 * guards that refuse a ranked name the protocol can't honour; never a decode input. Internal.
 */
export function namesRanked(question: { type?: string; metadata?: Record<string, unknown> }): boolean {
  return questionNames(question)[0]?.type === BallotType.Ranked
}

/** Election-level {@link namesRanked}: the raw `type` / `meta.type.name` declaration. */
export function electionNamesRanked(input: { type?: string; meta?: Record<string, unknown> }): boolean {
  return electionNames(input)[0]?.type === BallotType.Ranked
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
 * A declared name resolved against its channel's table. `pickSlot` marks the legacy
 * `multiple-choice` name, the only one meaning the pick-slot index list.
 */
interface DeclaredName {
  type: BallotType
  pickSlot: boolean
}

/**
 * The protocol fields inference reads — common to a question's protocol and an election's
 * voteType — plus the option count when the caller has the choices.
 */
interface ProtocolShape {
  maxCount: number
  maxValue: number
  uniqueValues: boolean
  costExponent: number
  numChoices?: number
}

/**
 * Whether a legacy pick-slot list fits `{maxValue: 1, !uniqueValues}`: two slots, or at most
 * two options (a repeatable list may have more slots than options; only the choices tell).
 */
function pickSlotFitsBinaryValues(maxCount: number, numChoices: number | undefined): boolean {
  return maxCount === 2 || (numChoices !== undefined && numChoices <= 2)
}

/** The names a question declares, in precedence order: SaaS `type`, then `metadata.type.name`. */
function questionNames(question: { type?: string; metadata?: Record<string, unknown> }): DeclaredName[] {
  const names: DeclaredName[] = []
  const fromType = question.type ? (SAAS_TYPE_NAMES[question.type] ?? SDK_TYPE_NAMES[question.type]) : undefined
  if (fromType) names.push({ type: fromType, pickSlot: false })
  const fromMeta = legacyTypeFromMeta(question.metadata)
  if (fromMeta) names.push({ type: fromMeta, pickSlot: fromMeta === BallotType.MultiChoice })
  return names
}

/**
 * The names an election declares, in precedence order: `type`, then `meta.type.name`.
 * Both read the legacy vocabulary, whose `multiple-choice` is pick-slot.
 */
function electionNames(input: { type?: string; meta?: Record<string, unknown> }): DeclaredName[] {
  const names: DeclaredName[] = []
  const fromType = input.type ? (LEGACY_TYPE_NAMES[input.type] ?? SDK_TYPE_NAMES[input.type]) : undefined
  if (fromType) names.push({ type: fromType, pickSlot: fromType === BallotType.MultiChoice })
  const fromMeta = legacyTypeFromMeta(input.meta)
  if (fromMeta) names.push({ type: fromMeta, pickSlot: fromMeta === BallotType.MultiChoice })
  return names
}

/**
 * The ballot types a protocol shape admits, default first. Ranked needs room for one distinct
 * rank per field; `uniqueValues` isn't required, as creation never demanded it for ranked.
 */
function admittedTypes(shape: ProtocolShape): readonly BallotType[] {
  if (shape.maxValue === 0) {
    return [shape.costExponent === 2 ? BallotType.Quadratic : BallotType.Budget]
  }
  if (shape.maxCount === 1) return [BallotType.SingleChoice]
  const base =
    shape.maxValue === 1 && !shape.uniqueValues
      ? [BallotType.Approval, BallotType.MultiChoice]
      : [BallotType.MultiChoice]
  return shape.maxValue >= shape.maxCount - 1 ? [...base, BallotType.Ranked] : base
}

/**
 * Whether `shape` (admitting `admitted`) admits the layout `name` declares. At `maxValue == 1`
 * a pick-slot list only has values for two options ({@link pickSlotFitsBinaryValues}), and a
 * ranking needs one field per option, so with the choices known `maxCount` must match them.
 */
function admits(shape: ProtocolShape, admitted: readonly BallotType[], name: DeclaredName): boolean {
  if (!admitted.includes(name.type)) return false
  if (name.pickSlot && shape.maxValue === 1 && !shape.uniqueValues) {
    return pickSlotFitsBinaryValues(shape.maxCount, shape.numChoices)
  }
  if (name.type === BallotType.Ranked && shape.numChoices !== undefined) {
    return shape.maxCount === shape.numChoices
  }
  return true
}

/**
 * The first declared name the shape admits, else the shape's default: a name the
 * protocol rules out is ignored.
 */
function resolveType(shape: ProtocolShape, names: DeclaredName[]): BallotType {
  const admitted = admittedTypes(shape)
  return names.find((name) => admits(shape, admitted, name))?.type ?? admitted[0]
}

/**
 * Infer the ballot type from election config. Multi-question is always single-choice;
 * otherwise `voteType` decides and `type` / `meta.type.name` only break its ties
 * ({@link admittedTypes}). Names aren't trusted beyond that: the SaaS API mislabels ballots.
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

  // A ranking is one field per option, multi-question one field per question: there is
  // no telling which the creator meant, so refuse loudly rather than pick one.
  if (electionNamesRanked(input) && questions.length > 1) {
    throw new Error(
      `a ranked election must have exactly one question (got ${questions.length}): a ranking ` +
        'lays out one ballot field per option, which leaves no room for a second question. ' +
        'Encode and decode each ranked question on its own with encodeQuestionSelections / ' +
        'decodeQuestionResults'
    )
  }

  if (questions.length > 1) return BallotType.SingleChoice

  return resolveType(
    {
      maxCount: voteType.maxCount,
      maxValue: voteType.maxValue,
      uniqueValues: voteType.uniqueChoices,
      costExponent: voteType.costExponent,
      numChoices: questions[0]?.choices.length,
    },
    electionNames(input)
  )
}

/**
 * Per-question {@link inferBallotType}: `ballotProtocol` decides, and `type` then
 * `metadata.type.name` only break its ties. With no protocol the name is taken as is; with
 * neither it throws — render code should use {@link tryInferQuestionBallotType}.
 */
export function inferQuestionBallotType(question: {
  ballotProtocol?: BallotProtocol
  type?: string
  metadata?: Record<string, unknown>
  choices?: Choice[]
}): BallotType {
  const ballotType = tryInferQuestionBallotType(question)
  if (ballotType === undefined) {
    throw new Error(
      'cannot infer ballot type: question has neither a ballotProtocol nor a supported type'
    )
  }
  return ballotType
}

/**
 * Non-throwing {@link inferQuestionBallotType}: the same answer, or `undefined` when the
 * question has neither a recognized type name nor a `ballotProtocol` to infer from.
 *
 * For render paths and other callers that must degrade rather than fail on such a
 * question — e.g. legacy vochain elections the SaaS API projects without a type, a
 * protocol or metadata. `undefined` means "unknown", never "single-choice": callers
 * must not let a voter cast a ballot for it, nor decode its results.
 */
export function tryInferQuestionBallotType(question: {
  ballotProtocol?: BallotProtocol
  type?: string
  metadata?: Record<string, unknown>
  choices?: Choice[]
}): BallotType | undefined {
  const names = questionNames(question)
  const bp = question.ballotProtocol
  if (!bp) return names[0]?.type
  return resolveType({ ...bp, numChoices: question.choices?.length }, names)
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
 * For a MultiChoice question: pick-slot index list (`true`) or dense 0/1 vector (`false`).
 * The one rule encode, decode and validation share. No protocol reads as dense; on the
 * dense-looking shape the legacy `multiple-choice` name picks pick-slot only where a
 * two-value list fits ({@link pickSlotFitsBinaryValues}), as inference admits it.
 */
export function isPickSlotLayout(question: {
  ballotProtocol?: BallotProtocol
  metadata?: Record<string, unknown>
  choices?: Choice[]
}): boolean {
  const bp = question.ballotProtocol
  if (!bp) return declaresLegacyPickSlot(question)
  if (!isDenseBallotProtocol(bp)) return true
  return pickSlotFitsBinaryValues(bp.maxCount, question.choices?.length) && declaresLegacyPickSlot(question)
}

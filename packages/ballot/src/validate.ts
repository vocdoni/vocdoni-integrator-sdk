import type { Election, Question, VoteType } from '@vocdoni/api-types'
import { BallotType, type BallotSelections } from './types'
import { inferBallotType } from './infer'
import { normalizeSelections } from './selections'
import {
  duplicateRankedValuesReason,
  pickSlotCollisionReason,
  unrankableProtocolReason,
  unsatisfiableProtocolReason,
  voteTypeBounds,
} from './protocol'

/**
 * Validate voter selections against election constraints.
 *
 * `selections` accepts a flat `number[]` or a nested `number[][]`; both normalize to
 * the same per-question form — see {@link BallotSelections}.
 *
 * This function performs basic validation that can be done with ballot config alone.
 * It does NOT validate on-chain-only constraints (like minNumberOfChoices) which would
 * require additional metadata.
 *
 * It DOES reject the election itself when its ballot config admits no usable
 * ballot at all (see {@link unsatisfiableProtocolReason}) — no selection can be
 * valid there, and the failure is otherwise invisible until the tally comes back
 * all zeros.
 *
 * @param input - Election config with questions and voteType
 * @param selections - The selections to validate
 * @throws Error if selections are invalid, or if the election's ballot config is unsatisfiable
 */
export function validateSelections(
  input: Pick<Election, 'questions' | 'voteType'> & { type?: string; meta?: Record<string, unknown> },
  selections: BallotSelections
): void {
  const { questions, voteType } = input
  const unsatisfiable = unsatisfiableProtocolReason(voteTypeBounds(voteType))
  if (unsatisfiable) {
    throw new Error(`this election's ballot config admits no valid ballot: ${unsatisfiable}`)
  }
  const ballotType = inferBallotType(input)
  const perQuestion = normalizeSelections(input, selections)

  // Validate we have the right number of question arrays
  if (perQuestion.length !== questions.length) {
    throw new Error(
      `Selections count (${perQuestion.length}) does not match questions count (${questions.length})`
    )
  }

  // Mirror how encodeBallot splits the uncastable-choices rule, or a caller that gates
  // its submit button on this validator enables the vote and then throws at cast time —
  // which is exactly the late discovery the encode-side check exists to prevent. The
  // per-selection half lives in the validators below, next to the values it judges;
  // this half belongs to the question and blocks every voter (see pickSlotCollisionReason).
  // Dense already resolved to Approval by inferBallotType, so MultiChoice is pick-slot,
  // and only questions[0] is ever encoded for it.
  if (ballotType === BallotType.MultiChoice) {
    const collision = pickSlotCollisionReason(questions[0]?.choices ?? [])
    if (collision) {
      throw new Error(`Question 0: ${collision}`)
    }
  }
  // Ranked's question-level defects, refused in the same order as encodeBallot so the
  // two agree on verdict and diagnosis; neither shows on any individual selection.
  if (ballotType === BallotType.Ranked) {
    const choices = questions[0]?.choices ?? []
    const unrankable = unrankableProtocolReason(choices.length, voteType.maxValue)
    if (unrankable) {
      throw new Error(`Question 0: ${unrankable}`)
    }
    const ambiguous = duplicateRankedValuesReason(choices)
    if (ambiguous) {
      throw new Error(`Question 0: ${ambiguous}`)
    }
  }

  switch (ballotType) {
    case BallotType.SingleChoice:
      validateSingleChoice(questions, perQuestion, voteType.maxValue)
      break

    case BallotType.Approval:
      validateApproval(questions[0], perQuestion[0] ?? [])
      break

    case BallotType.MultiChoice:
      validateMultiChoice(voteType, questions[0], perQuestion[0] ?? [])
      break

    case BallotType.Ranked:
      validateRanked(voteType, questions[0], perQuestion[0] ?? [])
      break

    case BallotType.Budget:
    case BallotType.Quadratic:
      validateBudgetOrQuadratic(voteType, questions[0], perQuestion[0] ?? [])
      break

    default:
      throw new Error(`Unknown ballot type: ${ballotType}`)
  }
}

/**
 * Validate single-choice selections: exactly one choice per question, and that
 * choice must be a valid value of that question.
 *
 * Single-choice has no abstain concept — if abstaining is offered it is an explicit
 * choice placed by the process creator — so an empty selection is invalid input.
 */
function validateSingleChoice(questions: Question[], selections: number[][], maxValue: number): void {
  for (let q = 0; q < selections.length; q++) {
    const questionSelections = selections[q]

    if (questionSelections.length !== 1) {
      throw new Error(
        `Question ${q}: single-choice requires exactly 1 selection, got ${questionSelections.length}`
      )
    }

    const validValues = new Set(questions[q].choices.map((c) => c.value))
    const value = questionSelections[0]
    if (!validValues.has(value)) {
      throw new Error(
        `Question ${q}: invalid choice ${value}; must be one of [${Array.from(validValues).join(', ')}]`
      )
    }
    // Being a published choice is not enough to be a castable one. Single-choice puts
    // choice.value on the wire, so a value above maxValue is a ballot the chain accepts,
    // counts in voteCount and drops at tally — confirmed live in value-skew.itest.ts.
    // encodeBallot refuses this same pick via assertEncodedBallot; without the check
    // here the two disagree and the voter finds out at cast time. maxValue 0 is
    // "unbounded" module-wide, not a ceiling of zero.
    if (maxValue > 0 && value > maxValue) {
      throw new Error(
        `Question ${q}: choice ${value} is above maxValue ${maxValue}, so no voter can record ` +
          'it — the chain accepts such a ballot and discards it at tally. This question ' +
          'publishes an option nobody can cast; it cannot be fixed after publish'
      )
    }
  }
}

/**
 * Validate approval selections.
 */
function validateApproval(question: Question, selections: number[]): void {
  const validValues = new Set(question.choices.map((c) => c.value))

  for (const value of selections) {
    if (!validValues.has(value)) {
      throw new Error(
        `Invalid choice value ${value} for approval ballot; must be one of [${Array.from(validValues).join(', ')}]`
      )
    }
  }
}

/**
 * Validate multichoice selections.
 */
function validateMultiChoice(voteType: VoteType, question: Question, selections: number[]): void {
  const validValues = new Set(question.choices.map((c) => c.value))

  if (selections.length > voteType.maxCount) {
    throw new Error(
      `Question 0: multichoice allows at most ${voteType.maxCount} selections, got ${selections.length}`
    )
  }

  const seen = new Set<number>()
  for (const value of selections) {
    if (!validValues.has(value)) {
      throw new Error(
        `Invalid choice value ${value} for multichoice ballot; must be one of [${Array.from(validValues).join(', ')}]`
      )
    }
    // On a uniqueChoices ballot a repeated pick encodes to a repeated value, which the
    // chain accepts and silently drops at tally — reject it here, where it is loud.
    if (voteType.uniqueChoices && seen.has(value)) {
      throw new Error(`Question 0: multichoice with uniqueChoices does not allow picking choice ${value} twice`)
    }
    seen.add(value)
  }
}

/**
 * Validate ranked selections: one rank per option, in choice order, all distinct and
 * within `maxValue`. These are **ranks, not choice values** — the wire shape itself
 * (see `encodeRanked`); a voter-facing ordering goes through `rankedOrderToScores`
 * first. Every rule is a way the chain would accept the vote and silently drop it at
 * tally, and must agree with the encoder so a UI gating its submit button on this
 * validator never enables a vote the encoder then refuses. Question-level defects are
 * refused by {@link validateSelections} before this runs.
 */
function validateRanked(voteType: VoteType, question: Question, selections: number[]): void {
  if (selections.length !== question.choices.length) {
    throw new Error(
      `Question 0: ranked requires one rank per option (${question.choices.length}), got ${selections.length}`
    )
  }

  const seen = new Set<number>()
  for (const rank of selections) {
    if (!Number.isInteger(rank) || rank < 0) {
      throw new Error(`Question 0: invalid rank ${rank} for ranked ballot; ranks must be non-negative integers`)
    }
    // maxValue 0 means "unbounded" module-wide, never a ceiling of zero.
    if (voteType.maxValue > 0 && rank > voteType.maxValue) {
      throw new Error(
        `Question 0: rank ${rank} is above maxValue ${voteType.maxValue}; the chain accepts such a ` +
          'ballot and discards it at tally'
      )
    }
    if (seen.has(rank)) {
      throw new Error(
        `Question 0: rank ${rank} is used twice; a ranking must give every option a distinct rank ` +
          'or the chain drops the whole ballot at tally'
      )
    }
    seen.add(rank)
  }
}

/**
 * Validate budget or quadratic selections.
 *
 * These selections are per-option *amounts* (not choice indices): one non-negative
 * integer per option, in choice order. The total-cost bounds (maxTotalCost /
 * costExponent) are not part of the on-chain voteType surface here, so only the
 * per-option shape and the per-field `maxValue` cap are validated.
 */
function validateBudgetOrQuadratic(voteType: VoteType, question: Question, selections: number[]): void {
  // Budget/quadratic require exactly one amount per option.
  if (selections.length !== question.choices.length) {
    throw new Error(
      `Question 0: budget/quadratic requires ${question.choices.length} amounts, got ${selections.length}`
    )
  }

  const seen = new Set<number>()
  for (const amount of selections) {
    if (!Number.isInteger(amount) || amount < 0) {
      throw new Error(
        `Invalid amount ${amount} for budget/quadratic ballot; amounts must be non-negative integers`
      )
    }
    // The scrutinizer applies uniqueValues to raw field values whatever the
    // aggregation mode, so a repeated amount on such an election (a legacy shape —
    // the API no longer creates them) is a ballot it drops at tally.
    if (voteType.uniqueChoices && seen.has(amount)) {
      throw new Error(
        `Invalid amount ${amount} for budget/quadratic ballot; this election requires every amount to be distinct`
      )
    }
    seen.add(amount)
  }
}

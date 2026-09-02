import type { Election, Question, Choice, VoteType } from '@vocdoni/api-types'

/**
 * Runtime enum for ballot/election types. This is a runtime value (unlike the types-only
 * @vocdoni/api-types package), and is used to distinguish between different voting modes.
 */
export const BallotType = {
  SingleChoice: 'single-choice',
  MultiChoice: 'multichoice',
  Approval: 'approval',
  /**
   * A ranking: one rank per option, in choice order, no two the same, **highest =
   * best**. Never inferred from shape (byte-identical to a full-slate pick-slot
   * multichoice) — it must be declared by name; see {@link inferQuestionBallotType}.
   */
  Ranked: 'ranked',
  Budget: 'budget',
  Quadratic: 'quadratic',
} as const

/**
 * Type representing the ballot/election type. Derived from the runtime const above.
 */
export type BallotType = (typeof BallotType)[keyof typeof BallotType]

/**
 * High-level selections for a ballot. Accepts two interchangeable shapes:
 *
 * - **Flat `number[]`** (the ergonomic default): the selected choice *values* for the
 *   election. For single-choice it is one value per question, positionally
 *   (`[1, 0, 2]` = value 1 for Q0, 0 for Q1, 2 for Q2); for the single-question types
 *   (approval/multichoice/budget/quadratic) it is that question's values/amounts
 *   (`[0, 2]`, `[3, 0, 5]`, …).
 * - **Nested `number[][]`**: one array per question. Clearer for multi-question
 *   single-choice (`[[1], [0], [2]]`); required if you want to be explicit.
 *
 * Both forms normalize to the same on-chain vector — only single-choice is ever
 * multi-question (one pick each), and every other type is single-question, so the
 * flat form is unambiguous once the ballot type is known.
 *
 * Per-question, the values are:
 * - single-choice: exactly one choice value per question
 * - multichoice/approval: zero or more selected choice values
 * - budget/quadratic: the amount allocated to each option, in choice order
 */
export type BallotSelections = number[] | number[][]

/**
 * A decoded result entry for a single choice within a question.
 */
export interface DecodedChoiceResult {
  /** The choice's `value` (its `choice.value`, not its position in the choices array) */
  choice: number
  /**
   * The tally: a voter count for single-choice / approval / multichoice, a summed
   * amount for budget / quadratic, and the **Borda score** (`Σ count × rank`) for
   * ranked — points, not people; sort descending for the ranking.
   */
  votes: number
  /** The percentage of total votes (0-100), or null if not computable */
  percentage: number | null
}

/**
 * A decoded result entry for abstentions in a question. Produced only for multichoice
 * questions, where the reserved abstain sentinel columns are unified into one bucket.
 */
export interface DecodedAbstainResult {
  /** Always 'abstain' as the identifier */
  choice: 'abstain'
  /** The vote count/tally for abstentions */
  votes: number
  /** The percentage of total votes (0-100), or null if not computable */
  percentage: number | null
}

/**
 * Decoded results for a single question: one entry per choice, plus a trailing
 * `DecodedAbstainResult` bucket for multichoice questions (only).
 */
export type DecodedQuestionResults = Array<DecodedChoiceResult | DecodedAbstainResult>

/**
 * Complete decoded results for all questions in an election.
 */
export type DecodedResults = DecodedQuestionResults[]

import type { BallotProtocol, Choice, QuestionTypeSetup } from '@vocdoni/api-types'
import { BallotType } from './types'
import { tryInferQuestionBallotType } from './infer'

/**
 * Voting power cast on one question, read from its raw results matrix. Decoded tallies cannot
 * give it: decoding drops the `notSelected` column of a dense question. Budget and quadratic
 * store `value × weight` in one cell, so their power is not recoverable and return `null`.
 */
export function castVotingPower(
  question: {
    ballotProtocol?: BallotProtocol
    type?: string
    metadata?: Record<string, unknown>
    typeSetup?: QuestionTypeSetup
    choices: Choice[]
  },
  results: string[][] | null | undefined,
): number | null {
  if (!results?.length) return null
  const ballotType = tryInferQuestionBallotType(question)
  if (ballotType === undefined) return null
  if (ballotType === BallotType.Budget || ballotType === BallotType.Quadratic) return null

  // Each field row sums to the weight of the ballots that wrote that field. The max is exact
  // for one row and for dense or padded layouts, and a lower bound for an unpadded short pick-slot.
  let max = 0n
  for (const row of results) {
    const sum = row.reduce((acc, cell) => acc + toBigInt(cell), 0n)
    if (sum > max) max = sum
  }
  return Number(max)
}

/**
 * Parse a results cell as an exact non-negative integer, treating missing or non-numeric cells as 0.
 * Unlike `toInt` in decode.ts, it does not go through `Number`, so weights above 2^53 stay exact.
 */
function toBigInt(cell: string | undefined): bigint {
  return cell && /^\d+$/.test(cell) ? BigInt(cell) : 0n
}

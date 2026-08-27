import type { BallotProtocol, Choice, Election, QuestionTypeSetup, VoteType } from '@vocdoni/api-types'
import { BallotType } from './types'
import { declaresRanked, inferBallotType, inferQuestionBallotType, isDenseBallotProtocol } from './infer'

/**
 * Lowest `maxValue` a multichoice election must reserve so that a partial selection
 * (fewer than `maxCount` picks) can be padded with abstain sentinel values.
 *
 * Mirrors the legacy `@vocdoni/sdk` reservation: repeatable ballots reuse a single
 * sentinel (`+1`); unique ballots need one distinct ascending sentinel per empty slot
 * (`+maxCount`).
 */
export function requiredAbstainMaxValue(
  numChoices: number,
  voteType: Pick<VoteType, 'maxCount' | 'uniqueChoices'>
): number {
  return numChoices - 1 + (voteType.uniqueChoices ? voteType.maxCount : 1)
}

/**
 * True when a multichoice election reserves enough values to encode abstain padding —
 * i.e. a voter may pick *fewer* than `maxCount` options and `encodeBallot` fills the
 * empty pick-slots with sentinels. Returns false for every non-multichoice ballot type
 * (single-choice/approval/budget/quadratic have no abstain padding).
 *
 * UIs use this to decide whether a partial multichoice selection is castable; the
 * encoder uses the same reservation formula internally.
 */
export function multichoiceReservesAbstain(input: Pick<Election, 'questions' | 'voteType'> & { type?: string; meta?: Record<string, unknown> }): boolean {
  if (inferBallotType(input) !== BallotType.MultiChoice) return false
  const numChoices = input.questions[0]?.choices.length ?? 0
  return input.voteType.maxValue >= requiredAbstainMaxValue(numChoices, input.voteType)
}

/** True when a per-question multichoice ballot reserves abstain sentinels. */
export function questionReservesAbstain(question: {
  ballotProtocol?: BallotProtocol
  type?: string
  metadata?: Record<string, unknown>
  choices: Choice[]
}): boolean {
  if (inferQuestionBallotType(question) !== BallotType.MultiChoice) return false
  const bp = question.ballotProtocol
  if (!bp) return false
  const neededMaxValue = requiredAbstainMaxValue(question.choices.length, {
    maxCount: bp.maxCount,
    uniqueChoices: bp.uniqueValues,
  })
  return bp.maxValue >= neededMaxValue
}

/** Selection range for a per-question multichoice ballot. */
export function questionSelectionRange(question: {
  ballotProtocol?: BallotProtocol
  type?: string
  metadata?: Record<string, unknown>
  typeSetup?: QuestionTypeSetup
  choices: Choice[]
}): { min: number; max: number } {
  // Ranked is a full slate: a partial ranking repeats a rank and the chain drops the
  // whole ballot at tally, so minChoices/maxChoices do not apply.
  if (declaresRanked(question)) {
    const n = question.choices.length
    return { min: n, max: n }
  }
  const bp = question.ballotProtocol
  // Dense layout (named multichoice, protocol optionally omitted on public
  // reads): maxCount is the number of choices, not the pick bound — picks are
  // bounded by maxTotalCost (maxChoices at creation), and a partial selection
  // is always encodable (unpicked choices are just 0 fields, no sentinel
  // reservation involved).
  if ((bp && isDenseBallotProtocol(bp)) || (!bp && question.type === 'multichoice')) {
    const max = bp?.maxTotalCost || question.typeSetup?.maxChoices || question.choices.length
    const min = Math.min(max, Math.max(1, question.typeSetup?.minChoices ?? 1))
    return { min, max }
  }
  // Pick-slot layout (legacy index-list): maxCount is the pick bound. A partial selection is
  // always encodable now — encodeMultiChoice pads with sentinels when the protocol reserves
  // room (questionReservesAbstain) and returns a short ballot otherwise — so min follows
  // minChoices like the dense branch instead of forcing a full maxCount slate.
  //
  // An *empty* selection is only offered when the chain can record it, which is why the floor
  // depends on abstain headroom (both cases verified against a live vochain):
  // - with headroom, `[]` encodes to sentinels (e.g. `[4,5,6,7]`) that land in the abstain
  //   bucket, so the abstention is counted and visible;
  // - without headroom, `[]` encodes to `[]`. The chain accepts the envelope and bumps
  //   voteCount, but the ballot touches no column, so the tally cannot tell an abstention
  //   from a voter who never showed up.
  // Offering min 0 in that second case would let a voter cast something that silently does
  // not count, so the floor stays at 1 there. Only an explicit `minChoices: 0` opts in.
  const max = bp?.maxCount ?? 1
  const floor = questionReservesAbstain(question) ? 0 : 1
  const min = Math.min(max, Math.max(floor, question.typeSetup?.minChoices ?? 1))
  return { min, max }
}

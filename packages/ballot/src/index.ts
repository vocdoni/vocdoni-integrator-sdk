// Re-export types
export type {
  DecodedChoiceResult,
  DecodedAbstainResult,
  DecodedQuestionResults,
  DecodedResults,
  BallotSelections,
} from './types'

export { BallotType } from './types'
export type { ProtocolBounds } from './protocol'

// Re-export functions
export {
  declaresLegacyPickSlot,
  declaresRanked,
  inferBallotType,
  inferQuestionBallotType,
  isDenseBallotProtocol,
  isPickSlotLayout,
} from './infer'
export {
  assertEncodedBallot,
  hasUncastableChoices,
  isUnsatisfiableProtocol,
  isUnsatisfiableQuestion,
  uncastableChoicesReason,
  unrankableProtocolReason,
  unsatisfiableProtocolReason,
  unsatisfiableQuestionReason,
  voteTypeBounds,
} from './protocol'
export { encodeBallot, encodeQuestionBallot, encodeQuestionSelections, rankedOrderToScores } from './encode'
export { decodeResults, decodeQuestionResults } from './decode'
export { validateSelections } from './validate'
export { multichoiceReservesAbstain, questionReservesAbstain, questionSelectionRange } from './abstain'

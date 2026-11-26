---
"@vocdoni/api-types": minor
"@vocdoni/ballot": minor
---

Carry the ballot protocol minimums `minValue` and `minTotalCost` (optional, absent means no minimum) on `BallotProtocol` and `VoteType`, and refuse a ballot below them before it is encoded: `encodeBallot`, `encodeQuestionBallot` and `validateSelections` throw a `BallotMinimumError`, and `questionSelectionRange` raises a dense multichoice's minimum picks to `minTotalCost`. The chain drops an encrypted ballot below a minimum at tally without telling the voter, so this check is what protects secret elections.

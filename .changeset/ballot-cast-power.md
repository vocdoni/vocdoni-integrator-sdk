---
"@vocdoni/ballot": minor
---

New `castVotingPower(question, results)` reads the voting power cast on one question from its raw results matrix, or returns `null` when it is not recoverable (no tally, undeterminable type, budget or quadratic). New `isAbstainVisible(question, abstainVotes)` tells whether a multichoice abstain row should be shown.

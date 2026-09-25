---
'@vocdoni/ballot': minor
---

Add `tryInferQuestionBallotType(question)`: the non-throwing counterpart of `inferQuestionBallotType`, returning `undefined` for a question with neither a recognized type name nor a `ballotProtocol` (e.g. a legacy election projected by `GET /processes`). `inferQuestionBallotType` still throws on such a question.

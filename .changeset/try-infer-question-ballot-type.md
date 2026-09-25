---
'@vocdoni/ballot': minor
---

Add `tryInferQuestionBallotType(question)`: the non-throwing counterpart of `inferQuestionBallotType`, returning `undefined` for a question with neither a recognized type name nor a `ballotProtocol` (e.g. a legacy election projected by `GET /processes`). `inferQuestionBallotType` still throws on such a question.

Type-name lookups no longer resolve inherited object keys: a `type` or `metadata.type.name` such as `constructor` or `toString` is now treated as unrecognized instead of short-circuiting inference with a non-`BallotType` value.

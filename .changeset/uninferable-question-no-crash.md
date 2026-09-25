---
'@vocdoni/react-components': patch
---

Stop crashing the page on a question whose ballot type cannot be inferred (e.g. legacy elections served by `GET /processes` with no `type`, `ballotProtocol` or `metadata`), which threw "cannot infer ballot type" during render. `QuestionsTypeBadge` and `QuestionTip` render nothing for it; `ElectionQuestions` shows its choices disabled with an `errors.question_unsupported` message and refuses to submit a ballot including it; `ElectionResults` lists its choices with empty `votes`/`percent` while still decoding the process's other questions. The default `ElectionResults` slot omits the tally when `votes` is empty.

---
'@vocdoni/api-types': minor
---

`QuestionResults` (and so `VotingProcessQuestionResults`) now declares `memos?: string[]`, the free-text voter memos of a question's open-value choice. The API serves them only to org managers/admins or a scoped API key, and omits the field when there are none, so `client.elections.getResults()` and the question `results` of the single reads expose them without a cast.

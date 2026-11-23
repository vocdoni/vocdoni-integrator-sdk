---
'@vocdoni/react-providers': minor
---

`vote()` now signs and relays only the questions that are open (`ONGOING`), leaving paused, upcoming or ended ones for a later call, so a voter can vote the open question of a question-by-question process (#111). `isAbleToVote` is false when no unvoted question is open, and `vote()` throws the new `NoOpenQuestionError` in that case.

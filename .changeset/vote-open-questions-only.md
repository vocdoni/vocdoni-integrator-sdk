---
'@vocdoni/react-providers': minor
'@vocdoni/react-components': minor
---

`vote()` now signs and relays only the questions that are open (`ONGOING`), leaving paused, upcoming or ended ones for a later call, so a voter can vote the open question of a question-by-question process (#111). `isAbleToVote` is false when no unvoted question is open, and `vote()` throws the new `NoOpenQuestionError` in that case.

`<ElectionQuestions />` locks a question that is not open while the process is (`vote.disabled.question_not_open`) and a question already voted (`vote.disabled.question_voted`): they need no answer, get a placeholder ballot and are left out of the confirmation (new `skip` prop of `QuestionsConfirmation`). `lockedQuestionNotice` takes an optional `{ questionStatus, processStatus }`. `<VoteButton />` explains a disabled button while the next question is not open (`vote.disabled.waiting_question`), and a `NoOpenQuestionError` reads `errors.vote_no_open_question`. `NoOpenQuestionError.questions` reports each question's own status.

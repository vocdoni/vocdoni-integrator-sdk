---
'@vocdoni/react-providers': minor
'@vocdoni/react-components': minor
---

`vote()` now signs and relays only the questions that are open (`ONGOING`), leaving paused, upcoming or ended ones for a later call, so a voter can vote the open question of a question-by-question process (#111). `isAbleToVote` is false when no unvoted question is open, and `vote()` throws the new `NoOpenQuestionError` in that case. `voteStatus` gets no entry for a question `vote()` skips.

`<ElectionQuestions />` locks a question that is not open while the process is (`vote.disabled.question_not_open`, also when its stored tx is pending: it is re-sent only once the question reopens) and a question already voted (`vote.disabled.question_voted`): they need no answer, get a placeholder ballot and are left out of the confirmation (new `skip` prop of `QuestionsConfirmation`). `lockedQuestionNotice` takes an optional `{ questionStatus, processStatus, voted }` (`voted`: the voter state's `hasVoted`, so a question voted in an earlier session stays locked). `<VoteButton />` explains a disabled button while no open question is left and the next one is paused or upcoming (`vote.disabled.waiting_question` once the voter has voted a question, `vote.disabled.waiting_question_none` otherwise), and a `NoOpenQuestionError` reads `errors.vote_no_open_question`. `NoOpenQuestionError.questions` reports each question's own status. A locked question with no inferable ballot type no longer blocks the vote on the open ones.

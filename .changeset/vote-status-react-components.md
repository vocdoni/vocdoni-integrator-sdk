---
'@vocdoni/react-components': major
---

Requires `@vocdoni/react-providers` 4. `VoteButton` explains a disabled button for `unconfirmed` and `signed` questions (`vote.disabled.unconfirmed`, `vote.disabled.signed`). `ElectionQuestions` shows a notice instead of the fields of a question whose vote is pending a re-send (`vote.pending_resend`) or cannot be sent from this tab, and passes a placeholder ballot for it. A vote whose outcome could not be confirmed reads `errors.vote_unconfirmed` instead of a failure.

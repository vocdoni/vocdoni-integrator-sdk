---
'@vocdoni/api-client': minor
'@vocdoni/react-providers': patch
'@vocdoni/react-components': minor
---

Disable voting before a process's scheduled start, and explain why the vote button is disabled.

The chain rejects votes cast before a process's `startDate`, but the backend reports the questions of such a process as live (`READY`), so the public voting page let voters complete the whole flow and silently discarded the vote (#53). This restores the pre-refactor behaviour the old SDK provided:

- `@vocdoni/api-client`: `computeProcessStatus(questions, { startDate, now })` reads a live question as `UPCOMING` while `startDate` is ahead; `isLive` / `isUpcoming` pass the process's own `startDate` and accept an optional `now`; new `isBeforeStart(startDate, now)` helper.
- `@vocdoni/react-providers`: `useElection().status` honours the process's `startDate` and flips from `UPCOMING` to `ONGOING` on its own when the start passes, without a refetch. Everything that gates on `status === 'ONGOING'` (the vote button, the question fields) stays disabled until then.
- `@vocdoni/react-components`: `<ElectionQuestions />` now renders a failed cast instead of dropping it. The form submits through react-hook-form, whose `handleSubmit` rejects when the handler throws; with nothing awaiting that promise the chain's rejection was lost and the page stayed silent. The failure is recorded as the form-level error `root.vote` and rendered through the `QuestionsError` slot with `variant='form'`, keeping the reason the chain reported (relayed verbatim by the backend as each envelope's `error`). New `errors.vote_failed`, `errors.vote_partial` and `errors.vote_failed_unknown` i18n keys. `useQuestionsForm().vote()` resolves `false` on a failed cast rather than rejecting; `useElection().vote()` still throws.
- `@vocdoni/react-components`: `getElectionDate` now reports an unparseable date as absent (`undefined`) instead of returning a truthy `Invalid Date`, which threw inside date-fns `format` and could take a render down. The default `VoteButton` slot also no longer erases a `title` the caller passed when the SDK has no reason of its own to supply.
- `@vocdoni/react-components`: `<VoteButton />` passes its slot a new `tooltip` prop naming why it is disabled ("Voting opens on …", "Voting not open yet", "Voting is paused", "Voting has ended", "Voting was canceled", "You have already voted", "Identify first to vote", "You are not eligible to vote in this process"); the default slot renders it as the button's `title`. New `vote.disabled.*` i18n keys.

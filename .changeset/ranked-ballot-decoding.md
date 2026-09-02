---
'@vocdoni/ballot': minor
'@vocdoni/react-components': minor
'@vocdoni/api-client': patch
---

Read a ranking back out of a ranked election.

A ranked question could be encoded but not decoded: its results were only ever readable as
"how many voters ranked each option", which is the same number for every option and
therefore useless. The winner was unrecoverable through the SDK, and any UI built on
`inferQuestionBallotType` rendered a checkbox group for it.

The obstacle is that a ranked `ballotProtocol` is **byte-identical** to a pick-slot
multichoice whose voters fill every slot, while meaning the transpose of it — ranked reads
the field index as the *option* and its value as the *rank*; pick-slot reads the field
index as a *slot* and its value as the *chosen option*. No shape rule can separate them, so
this plugs into the declared-name channel instead:

```ts
// creation — the raw protocol alone is ambiguous, the metadata bag is not
{
  choices: [/* … */],
  ballotProtocol: { maxCount: 4, maxValue: 3, uniqueValues: true, /* … */ },
  metadata: { type: { name: 'ranked' } },
}
```

The backend's own `type` vocabulary is `['singlechoice', 'multichoice']` and rejects
anything else, but it stores and echoes the creator metadata bag verbatim — the same route
the legacy `multiple-choice` name already uses — so no backend change is involved.
`type: 'ranked'` is read too, for callers keeping their own record of the kind.

**`@vocdoni/ballot`**

- `BallotType.Ranked`, selected only by that declaration. It is never inferred from the
  protocol, because nothing in the protocol distinguishes it.
- `decodeQuestionResults` / `decodeResults` aggregate ranked questions with **Borda**
  (`Σ count × rank`) — the only method the tally can express, since it is a per-field
  histogram with the individual ballots already discarded, and what `saas-integrator-demo`
  computes. `votes` is therefore **points, not voters**, and percentages are each option's
  share of the total points. **No `abstain` bucket**: those sentinel columns are a pick-slot
  device for unfilled slots, and a ranking has none.
- `rankedOrderToScores(question, order)` turns the voter's ordering (choice values, best
  first) into the wire ballot, applying the canonical **highest = best** orientation. Use it
  rather than building the array by hand: the decode is an index-weighted sum, so a ballot
  ranked with `0` as "best" is perfectly valid and elects the loser, with nothing on either
  side able to notice. It throws on a ranking that repeats a choice, names an unpublished
  one, or leaves any option unranked.
- `encodeQuestionSelections(question, selections)` encodes what a voter-facing form
  collects, for **any** ballot type: the ordering for a ranked question (transposed for
  you), the raw selections for everything else. The per-type branch lives here rather than
  at every call site, where writing it the wrong way round produces a valid ballot that
  elects the loser. Prefer it over `encodeQuestionBallot` in UI code.
- `encodeQuestionBallot` / `encodeBallot` keep passing a ranking straight through, and still
  refuse a duplicated rank or one above `maxValue`. They now also refuse a ranking that is
  not **one rank per option** — previously a short slate encoded fine while
  `validateSelections` rejected the identical input, so a UI gating its submit button on the
  validator disagreed with the codec. `validateSelections` gained the matching ranked rules,
  `questionSelectionRange` reports `{min: n, max: n}` (a partial ranking cannot be counted),
  and `declaresRanked(question)` exposes the check — resolving the declared name exactly as
  `inferQuestionBallotType` does, so the two can never disagree in either direction.
- Two more ranked defects are refused for every voter and at creation, because no individual
  ballot shows either: **two choices sharing a `value`** (the ballots stay well-formed, but
  the decoded rows are keyed by choice value, so two options return under one id and a
  ranking cannot order them), and an election-level `ranked` declaration carrying **more than
  one question** — a ranking fills the whole ballot, so `inferBallotType` now throws rather
  than let `encodeBallot` put only `questions[0]` on the wire and `decodeResults` report
  `questions[0]`'s scores for every question.
- `unrankableProtocolReason(numChoices, maxValue)` catches the one protocol a ranking can
  never survive: `maxValue: 0`. That means "no upper bound" for every other type, but on
  chain it switches the scrutinizer to discrete aggregation — one column per option instead
  of a histogram — so the Borda index-weighted sum scores every option zero however anyone
  votes, and the result is indistinguishable from an election nobody voted in. Folded into
  `unsatisfiableQuestionReason` (whose parameter type gained `metadata`, needed to see the
  declaration) and refused up front by both encoders and `validateSelections`, so the three
  cannot drift apart.

**`@vocdoni/react-components`**

- Ranked questions render a **rank widget** — one position control per option, through a new
  `QuestionRankChoice` slot — instead of the checkbox group they used to get. Assigning an
  option a position another holds swaps the two. The default slot is a `<select>`; override
  it for drag-and-drop.
- `QuestionSelectionMode` gained `'ranked'` alongside `'single'` / `'multiple'`.
- The form collects the voter's ordering and `QuestionsFormProvider` encodes it with
  `encodeQuestionSelections`; submitting is blocked until every option is placed. Assigning
  a position held by another option when the moved one was unranked now **reseats** the
  displaced option in the first free place instead of silently dropping it.
- `<QuestionsTypeBadge />` and `<QuestionTip />` label and count ranked questions.

**`@vocdoni/api-client`**

- `elections.create` / `update` validate each question's ballot config with the
  *question*-level rule instead of the protocol-level one, so a question declared `ranked`
  with `maxValue: 0` — or with duplicate choice values — is refused at the one moment it can
  still be fixed. The protocol-level rule waves both through by design: it mirrors the
  backend, which has no concept of a ranked question.

The integration suite now casts a real ranked vote and asserts the recovered ordering plus
the raw matrix the chain produced, replacing the placeholder that had to enshrine a
meaningless tally.

Closes #22.

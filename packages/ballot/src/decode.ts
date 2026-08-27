import type { BallotProtocol, Choice, Election, Question } from '@vocdoni/api-types'
import { BallotType, type DecodedResults, type DecodedQuestionResults } from './types'
import { inferBallotType, inferQuestionBallotType, isPickSlotLayout } from './infer'

/**
 * Decode a raw Vocdoni results matrix into per-question / per-choice tallies.
 *
 * The on-chain results are a **histogram**, not a per-option tally:
 *
 *   results[fieldIndex][value] = number of voters who put `value` in that field
 *
 * A "field" is either a question (multi-question single-choice) or an option of a
 * single question (approval / multichoice / budget / quadratic). How a field's row
 * collapses into a per-choice tally depends on the ballot type — see the branches
 * below. See the vocdoni-ballot-protocol spec for the full model.
 *
 * Every branch returns the same shape (one array per question, one entry per choice)
 * so consumers render all types uniformly. Missing / empty results decode to zeroes
 * rather than throwing, so the returned structure is always fully populated.
 */
export function decodeResults(input: Pick<Election, 'questions' | 'voteType' | 'results'> & { type?: string; meta?: Record<string, unknown> }): DecodedResults {
  const { questions, results } = input
  const ballotType = inferBallotType(input)
  const raw = results ?? []

  return questions.map((question, q) => decodeQuestion(ballotType, question, q, raw))
}

function decodeQuestion(
  ballotType: BallotType,
  question: Question,
  q: number,
  results: string[][]
): DecodedQuestionResults {
  switch (ballotType) {
    case BallotType.SingleChoice: {
      // One field per question; the field carries the chosen `choice.value`, so
      // results[q][choice.value] is that choice's tally directly.
      //
      // ⚠️ BY VALUE, deliberately — the opposite of the approval / budget branches
      // below, and it is NOT a bug to "fix" into positional indexing. The backend
      // contract:
      //   saas-backend account/ballot.go — `MaxValue = max(Choice.Value)`, derived
      //     from the values *because* they "need not be a contiguous 0..n-1 range"
      //     (pinned by TestVoteTypeSingleChoiceNonContiguousValues)
      //   saas-backend db/types.go       — the row is "indexed by choice value
      //     (0..MaxValue, so sparse choice values leave empty buckets)"
      // Confirmed on a live chain, not merely read: an election published with
      // values 1/2/3 and one vote per choice returns [["0","1","1","1"]] — column 0
      // empty. See integration/value-skew.itest.ts and integrator-sdk#28, which
      // argued for positional indexing on the strength of an election whose
      // `ballotProtocol` contradicted its own choice values. That shape is now
      // refused at both creation and encode time — see `uncastableChoicesReason`.
      const row = results[q] ?? []
      const counts = question.choices.map((c) => toInt(row[c.value]))
      return withPercentages(question, counts)
    }

    case BallotType.Approval: {
      // One field per option, value ∈ {0,1} (dense 0/1 vector). The field index is the
      // option's *position* in choices (that's how encode lays out the dense vector),
      // NOT its choice.value — those differ when values are non-contiguous. The approval
      // count for an option is the number of voters who put 1 → results[optionIndex][1].
      const counts = question.choices.map((_c, i) => toInt((results[i] ?? [])[1]))
      return withPercentages(question, counts)
    }

    case BallotType.MultiChoice: {
      // Fields are pick-slots; each field row is a histogram over choice values.
      // A choice's tally is the number of (voter, slot) selections of it, i.e. the
      // sum of column `choiceValue` across every field row.
      const numChoices = question.choices.length
      const counts = question.choices.map((c) =>
        results.reduce((sum, row) => sum + toInt(row[c.value]), 0)
      )
      // This branch (and the sentinel rule below) assumes the choice values occupy
      // exactly 0..numChoices-1: picks and abstain sentinels share one value space,
      // so a value >= numChoices would be indistinguishable from an abstention.
      // `uncastableChoicesReason` refuses to encode such a question, which is where
      // that assumption is enforced rather than merely hoped for.
      //
      // Abstain sentinels are the columns beyond the real choices (value >= numChoices);
      // a unique-choices abstention spreads across several of them, so unify every
      // sentinel column across every field into one bucket (mirrors the legacy SDK's
      // calculateMultichoiceAbstains). The bucket is always emitted — a protocol with no
      // sentinel headroom simply reports 0. Use `questionReservesAbstain(question)` to
      // decide whether to *render* it.
      const abstain = results.reduce(
        (sum, row) =>
          sum + row.reduce((s, cell, value) => (value >= numChoices ? s + toInt(cell) : s), 0),
        0
      )
      return withPercentages(question, counts, abstain)
    }

    case BallotType.Ranked: {
      // Position-addressed: results[optionIndex][rank] = voters who gave that option
      // that rank, highest = best. The tally is the Borda score (Σ count × rank) — the
      // only aggregation a rank histogram can express, and what saas-integrator-demo
      // computes. The orientation must match the encode side (rankedOrderToScores):
      // read the other way round it elects the loser, and the matrix cannot tell which
      // way it was written. No abstain bucket: ranked has no unfilled slots, so a
      // sentinel column would be a corrupt rank, not an abstention.
      const counts = question.choices.map((_c, i) =>
        (results[i] ?? []).reduce((sum, cell, rank) => sum + toInt(cell) * rank, 0)
      )
      return withPercentages(question, counts)
    }

    case BallotType.Budget:
    case BallotType.Quadratic: {
      // One field per option; value = amount allocated. `maxValue === 0` is not just
      // a marker — it switches the scrutinizer to **discrete aggregation**: rather
      // than bucketing each ballot into a histogram, it accumulates
      // `results[field][0] += value * weight` and leaves the row one cell wide
      // (vochain/results/results.go, the `MaxValue == 0` branch: "The results are
      // aggregated, so we use only the first column of the results matrix").
      // So the per-option total is that single cell, already weighted — NOT an
      // index-weighted sum over the row, which would read the sole column at index
      // 0 and always evaluate to zero.
      //
      // The field index is the option's *position* in choices (amounts are laid out
      // in choice order by encode), NOT its choice.value — those differ when values
      // are non-contiguous.
      const counts = question.choices.map((_c, i) => toInt((results[i] ?? [])[0]))
      return withPercentages(question, counts)
    }

    default:
      throw new Error(`Unknown ballot type: ${ballotType}`)
  }
}

/**
 * Decode results for a single question using its own {@link BallotProtocol}.
 */
export function decodeQuestionResults(
  question: { ballotProtocol?: BallotProtocol; type?: string; metadata?: Record<string, unknown>; choices: Choice[] },
  results: string[][]
): DecodedQuestionResults {
  let ballotType = inferQuestionBallotType(question)
  // A named multichoice question with a dense protocol keeps the MultiChoice
  // *label* (for UI purposes), but its results matrix is the dense per-choice
  // [notSelected, selected] histogram — decode it as approval, not pick-slot.
  // Public reads of named-type questions may omit the protocol entirely; the
  // named type always derives the dense layout, so decode dense then too.
  //
  // Unless the legacy metadata declares `multiple-choice`, which is the *pick-slot*
  // index list. That layout also presents as {maxValue: 1, maxCount > 1, uniqueValues:
  // false} at two options, so isDenseBallotProtocol says "dense" for it as well — and
  // remapping there would read the tally off the wrong axis and invert it.
  // {@link isPickSlotLayout} is the single home for that discrimination; encode makes
  // the same call, and the two disagreeing is how a tally ends up on the wrong axis.
  if (ballotType === BallotType.MultiChoice && !isPickSlotLayout(question)) {
    ballotType = BallotType.Approval
  }
  const fakeQuestion: Question = { title: { default: '' }, choices: question.choices }
  return decodeQuestion(ballotType, fakeQuestion, 0, results)
}

/** Parse a results cell to a non-negative integer, treating missing / NaN as 0. */
function toInt(cell: string | undefined): number {
  const n = parseInt(cell ?? '0', 10)
  return Number.isNaN(n) ? 0 : n
}

/**
 * Attach a per-question percentage (share of that question's own total).
 *
 * When `abstain` is provided (multichoice), it is included in the denominator and
 * appended as a single `{ choice: 'abstain' }` bucket so choices + abstain share one
 * total. Other ballot types omit it entirely.
 */
function withPercentages(
  question: Question,
  counts: number[],
  abstain?: number
): DecodedQuestionResults {
  const total = counts.reduce((acc, n) => acc + n, 0) + (abstain ?? 0)
  const pct = (n: number) => (total > 0 ? (n / total) * 100 : null)

  const results: DecodedQuestionResults = question.choices.map((c, i) => ({
    choice: c.value,
    votes: counts[i],
    percentage: pct(counts[i]),
  }))

  if (abstain !== undefined) {
    results.push({ choice: 'abstain', votes: abstain, percentage: pct(abstain) })
  }

  return results
}

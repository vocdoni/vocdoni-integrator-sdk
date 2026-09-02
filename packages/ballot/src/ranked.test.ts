import { describe, it, expect } from 'vitest'
import type { BallotProtocol, Choice, Election } from '@vocdoni/api-types'
import { decodeQuestionResults, decodeResults } from './decode'
import { encodeBallot, encodeQuestionBallot, encodeQuestionSelections, rankedOrderToScores } from './encode'
import { declaresRanked, inferBallotType, inferQuestionBallotType } from './infer'
import { questionReservesAbstain, questionSelectionRange } from './abstain'
import { uncastableChoicesReason, unsatisfiableQuestionReason } from './protocol'
import { validateSelections } from './validate'
import { BallotType } from './types'

/**
 * Ranked ballots (integrator-sdk#22).
 *
 * The whole point of the type is that it is NOT inferable: a ranked protocol and a
 * pick-slot multichoice whose voters fill every slot are byte-identical, meaning
 * opposite things. So every test here that asserts ranked behaviour is paired, where
 * it matters, with the same input minus the declaration — if the declaration were
 * ignored the pair would collapse into agreement and the test would fail.
 */

/** The canonical ranked protocol over `n` options: one field each, ranks 0..n-1, no repeats. */
const rankedProtocol = (n: number): BallotProtocol => ({
  maxCount: n,
  maxValue: n - 1,
  maxVoteOverwrites: 0,
  maxTotalCost: 0,
  costExponent: 1,
  uniqueValues: true,
  costFromWeight: false,
})

const choices = (n: number): Choice[] =>
  Array.from({ length: n }, (_, i) => ({ title: { default: `C${i}` }, value: i }))

/** A ranked question, declared through the metadata bag (the channel the backend stores). */
const rankedQuestion = (n: number) => ({
  ballotProtocol: rankedProtocol(n),
  type: '',
  metadata: { type: { name: 'ranked' } },
  choices: choices(n),
})

/** The same question with the declaration removed — the ambiguity this type exists to resolve. */
const undeclaredQuestion = (n: number) => ({
  ballotProtocol: rankedProtocol(n),
  type: '',
  choices: choices(n),
})

/** The issue's worked example: 3 voters, all ranking C2 > C0 > C1. */
const THREE_VOTERS_C2_C0_C1 = [
  ['0', '3', '0'], // C0 got rank 1 from 3 voters
  ['3', '0', '0'], // C1 got rank 0 from 3 voters
  ['0', '0', '3'], // C2 got rank 2 from 3 voters
]

describe('ranked: the declared name is the only signal', () => {
  it('reads a ranked question from metadata.type.name', () => {
    expect(inferQuestionBallotType(rankedQuestion(4))).toBe(BallotType.Ranked)
    expect(declaresRanked(rankedQuestion(4))).toBe(true)
  })

  it('reads a ranked question from the type field, for callers keeping their own kind', () => {
    const question = { ballotProtocol: rankedProtocol(4), type: 'ranked', choices: choices(4) }
    expect(inferQuestionBallotType(question)).toBe(BallotType.Ranked)
    expect(declaresRanked(question)).toBe(true)
  })

  it('never infers ranked from the protocol — the identical shape reads as multichoice', () => {
    expect(inferQuestionBallotType(undeclaredQuestion(4))).toBe(BallotType.MultiChoice)
    expect(declaresRanked(undeclaredQuestion(4))).toBe(false)
    // Byte-identical inputs: only the declaration differs.
    expect(rankedQuestion(4).ballotProtocol).toEqual(undeclaredQuestion(4).ballotProtocol)
  })

  it('lets a recognized SaaS type shadow a stale ranked metadata name', () => {
    // `inferQuestionBallotType` resolves `type` first and only falls back to the bag, so
    // a question carrying both reads as multichoice. `declaresRanked` has to reach the
    // same verdict or the two halves of the UI disagree about the same question:
    // `Fields.tsx` picks the widget from the former (a checkbox group capped at 2) while
    // `questionSelectionRange` and `Form.tsx`'s transposition follow the latter (a full
    // 4-option slate), leaving a form that can never be submitted.
    const question = {
      type: 'multichoice',
      typeSetup: { minChoices: 0, maxChoices: 2, uniqueChoices: false },
      metadata: { type: { name: 'ranked' } },
      ballotProtocol: { ...rankedProtocol(4), maxValue: 1, uniqueValues: false, maxTotalCost: 2 },
      choices: choices(4),
    }

    expect(inferQuestionBallotType(question)).toBe(BallotType.MultiChoice)
    expect(declaresRanked(question)).toBe(false)
    expect(questionSelectionRange(question)).toEqual({ min: 1, max: 2 })
    // And no ranked diagnosis for a question that is not one.
    expect(unsatisfiableQuestionReason({ ...question, ballotProtocol: { ...question.ballotProtocol, maxValue: 0 } })).toBeNull()
  })

  it('declaresRanked answers for a question with neither a protocol nor a type', () => {
    // inferQuestionBallotType throws on that input; the predicate must not, so a UI
    // can ask "is this a ranking?" of a partial read without handling an exception.
    // `as never` on both: neither signature declares `choices` (neither function reads
    // it), and a bare `{}` would not say what this input is meant to be.
    expect(() => inferQuestionBallotType({ choices: choices(3) } as never)).toThrow()
    expect(declaresRanked({ choices: choices(3) } as never)).toBe(false)
  })

  it('reads a ranked election from type / meta.type.name', () => {
    const election = (declared: Record<string, unknown>) =>
      ({
        voteType: {
          maxCount: 3,
          maxValue: 2,
          maxVoteOverwrites: 0,
          costExponent: 1,
          uniqueChoices: true,
          costFromWeight: false,
        },
        questions: [{ title: { default: 'Q0' }, choices: choices(3) }],
        ...declared,
      }) as Pick<Election, 'questions' | 'voteType'> & { type?: string; meta?: Record<string, unknown> }

    expect(inferBallotType(election({ type: 'ranked' }))).toBe(BallotType.Ranked)
    expect(inferBallotType(election({ meta: { type: { name: 'ranked' } } }))).toBe(BallotType.Ranked)
    // Same shape, nothing declared → the pre-existing multichoice reading.
    expect(inferBallotType(election({}))).toBe(BallotType.MultiChoice)
  })

  it('refuses a ranked election with more than one question', () => {
    // A ranking occupies the whole ballot: one field per option of one question. A
    // multi-question vochain election lays out one field per *question* instead, so the
    // two layouts cannot coexist and the declaration describes nothing that exists.
    // Read as ranked it is silently wrong in both directions — `encodeBallot` puts only
    // questions[0] on the wire, and the decode branch is position-addressed with no `q`,
    // so every question reports questions[0]'s Borda scores as its own. Refuse instead:
    // per-question ranked ballots go through the question-level API.
    const election = {
      type: 'ranked',
      voteType: {
        maxCount: 3,
        maxValue: 2,
        maxVoteOverwrites: 0,
        costExponent: 1,
        uniqueChoices: true,
        costFromWeight: false,
      },
      questions: [
        { title: { default: 'Q0' }, choices: choices(3) },
        { title: { default: 'Q1' }, choices: choices(3) },
      ],
      results: THREE_VOTERS_C2_C0_C1,
    }

    expect(() => inferBallotType(election)).toThrow(/exactly one question/)
    expect(() => decodeResults(election)).toThrow(/exactly one question/)
    expect(() => encodeBallot(election, [[1, 0, 2], [1, 0, 2]])).toThrow(/exactly one question/)
    expect(() => validateSelections(election, [[1, 0, 2], [1, 0, 2]])).toThrow(/exactly one question/)
    // The same election with one question is fine — it is the pairing that is refused.
    expect(inferBallotType({ ...election, questions: election.questions.slice(0, 1) })).toBe(BallotType.Ranked)
  })
})

describe('ranked: decodeQuestionResults does Borda', () => {
  it('recovers the ranking from the issue\'s worked example', () => {
    const decoded = decodeQuestionResults(rankedQuestion(3), THREE_VOTERS_C2_C0_C1)

    // Σ count × rank, highest = best.
    expect(decoded.map((row) => row.votes)).toEqual([3, 0, 6])
    // The point of the whole issue: the winner is readable.
    const ranking = [...decoded]
      .sort((a, b) => b.votes - a.votes)
      .map((row) => row.choice)
    expect(ranking).toEqual([2, 0, 1])
  })

  it('is what the undeclared reading is not — same matrix, no ranking at all', () => {
    const decoded = decodeQuestionResults(undeclaredQuestion(3), THREE_VOTERS_C2_C0_C1)
    // Column sums: every option "got 3", plus the spurious abstain bucket. This is
    // the defect #22 reported, pinned here so the two readings cannot converge.
    expect(decoded.map((row) => row.votes)).toEqual([3, 3, 3, 0])
  })

  it('emits no abstain bucket', () => {
    const decoded = decodeQuestionResults(rankedQuestion(3), THREE_VOTERS_C2_C0_C1)
    expect(decoded).toHaveLength(3)
    expect(decoded.some((row) => row.choice === 'abstain')).toBe(false)
    expect(questionReservesAbstain(rankedQuestion(3))).toBe(false)
  })

  it('reports percentages as a share of the total points', () => {
    const decoded = decodeQuestionResults(rankedQuestion(3), THREE_VOTERS_C2_C0_C1)
    // 3 + 0 + 6 = 9 points.
    expect(decoded.map((row) => row.percentage)).toEqual([(3 / 9) * 100, 0, (6 / 9) * 100])
  })

  it('addresses fields by choice POSITION, not choice.value', () => {
    // Ranked lays one field out per option in choice order (like budget), so
    // non-contiguous values must not move the columns that are read.
    const question = {
      ballotProtocol: rankedProtocol(3),
      metadata: { type: { name: 'ranked' } },
      choices: [
        { title: { default: 'C7' }, value: 7 },
        { title: { default: 'C8' }, value: 8 },
        { title: { default: 'C9' }, value: 9 },
      ],
    }
    const decoded = decodeQuestionResults(question, THREE_VOTERS_C2_C0_C1)
    expect(decoded.map((row) => row.choice)).toEqual([7, 8, 9])
    expect(decoded.map((row) => row.votes)).toEqual([3, 0, 6])
  })

  it('decodes zeroes rather than throwing on a missing matrix', () => {
    expect(decodeQuestionResults(rankedQuestion(3), []).map((row) => row.votes)).toEqual([0, 0, 0])
  })

  it('aggregates voters who disagree', () => {
    // 2 voters rank C0 > C1 (C0=1, C1=0), 1 voter ranks C1 > C0.
    const matrix = [
      ['1', '2'], // C0: rank 0 once, rank 1 twice → 2
      ['2', '1'], // C1: rank 0 twice, rank 1 once → 1
    ]
    expect(decodeQuestionResults(rankedQuestion(2), matrix).map((row) => row.votes)).toEqual([2, 1])
  })

  it('decodes a ranked election through decodeResults too', () => {
    const decoded = decodeResults({
      type: 'ranked',
      voteType: {
        maxCount: 3,
        maxValue: 2,
        maxVoteOverwrites: 0,
        costExponent: 1,
        uniqueChoices: true,
        costFromWeight: false,
      },
      questions: [{ title: { default: 'Q0' }, choices: choices(3) }],
      results: THREE_VOTERS_C2_C0_C1,
    })
    expect(decoded[0].map((row) => row.votes)).toEqual([3, 0, 6])
  })
})

describe('rankedOrderToScores', () => {
  it('turns an ordering into ranks in choice order, highest = best', () => {
    // 3 candidates, voter ranks C2 > C0 > C1.
    expect(rankedOrderToScores({ choices: choices(3) }, [2, 0, 1])).toEqual([1, 0, 2])
  })

  it('gives the first-placed option the top rank', () => {
    const scores = rankedOrderToScores({ choices: choices(4) }, [2, 0, 3, 1])
    expect(scores[2]).toBe(3)
    expect(scores[1]).toBe(0)
    expect(scores).toEqual([2, 0, 3, 1])
  })

  it('follows choice VALUES, not positions', () => {
    const question = {
      choices: [
        { title: { default: 'C7' }, value: 7 },
        { title: { default: 'C8' }, value: 8 },
      ],
    }
    // Voter ranks C8 first → C8 (position 1) gets rank 1.
    expect(rankedOrderToScores(question, [8, 7])).toEqual([0, 1])
  })

  it('refuses a ranking that names an unpublished choice', () => {
    expect(() => rankedOrderToScores({ choices: choices(3) }, [0, 1, 9])).toThrow(/not a choice value/)
  })

  it('refuses a ranking that places the same choice twice', () => {
    expect(() => rankedOrderToScores({ choices: choices(3) }, [0, 1, 1])).toThrow(/more than once/)
  })

  it('refuses a partial ranking, naming what is missing', () => {
    // Not a style preference: a ranked protocol leaves exactly one rank per option,
    // so a short slate repeats a value and the chain drops the whole ballot.
    expect(() => rankedOrderToScores({ choices: choices(3) }, [2, 0])).toThrow(/missing 1/)
  })

  it('blames the question, not the ranking, when two choices share a value', () => {
    // Ranks are keyed by choice value, so duplicates have no ranking between them.
    // They cannot corrupt a ballot — a complete ranking needs one distinct published
    // value per choice, so every order shape already failed a check below — but it
    // failed describing the ranking, when the defect is in the question.
    const dupes = {
      choices: [
        { title: { default: 'A' }, value: 0 },
        { title: { default: 'B' }, value: 1 },
        { title: { default: 'C' }, value: 1 },
      ],
    }
    for (const order of [
      [0, 1, 2],
      [0, 1, 1],
      [0, 1],
    ]) {
      expect(() => rankedOrderToScores(dupes, order)).toThrow(/used by more than one choice/)
    }
  })
})

describe('ranked: a protocol that can never produce a ranking', () => {
  // maxValue 0 means "no upper bound" everywhere else in this module, and on chain it
  // switches the scrutinizer to discrete aggregation — one column per option instead of
  // a histogram. The Borda decode is an index-weighted sum over that histogram, so it
  // reads 0 for every option however anyone votes. Ranked is therefore the one type for
  // which maxValue 0 is not laxness but a dead election, and the guards below exist
  // because nothing downstream can tell that tally from "nobody voted".
  const zeroMaxValue = {
    ballotProtocol: {
      maxCount: 3,
      maxValue: 0,
      maxVoteOverwrites: 0,
      maxTotalCost: 0,
      costExponent: 1,
      uniqueValues: false,
      costFromWeight: false,
    },
    metadata: { type: { name: 'ranked' } },
    choices: choices(3),
  }

  const zeroMaxValueElection = {
    type: 'ranked',
    voteType: {
      maxCount: 3,
      maxValue: 0,
      maxVoteOverwrites: 0,
      costExponent: 1,
      uniqueChoices: false,
      costFromWeight: false,
    },
    questions: [{ title: { default: 'Q0' }, choices: choices(3) }],
  }

  it('is the failure this guards: every option decodes to zero', () => {
    // Pinned so the guards below are not mistaken for pedantry. Discrete aggregation
    // leaves one cell per option at column 0, and 0 × count is 0.
    expect(decodeQuestionResults(zeroMaxValue, [['18'], ['10'], ['2']]).map((r) => r.votes)).toEqual([
      0, 0, 0,
    ])
  })

  it('is reported as an unsatisfiable question config', () => {
    expect(unsatisfiableQuestionReason(zeroMaxValue)).toMatch(/maxValue 0/)
  })

  it('is refused by encodeQuestionBallot', () => {
    expect(() => encodeQuestionBallot(zeroMaxValue, [2, 1, 0])).toThrow(/maxValue 0/)
  })

  it('is refused by encodeBallot and validateSelections alike', () => {
    // The two must agree: a UI that gates its submit button on the validator would
    // otherwise enable the vote and then throw at cast time.
    expect(() => encodeBallot(zeroMaxValueElection, [[2, 1, 0]])).toThrow(/maxValue 0/)
    expect(() => validateSelections(zeroMaxValueElection, [[2, 1, 0]])).toThrow(/maxValue 0/)
  })

  it('leaves the same protocol alone when nothing declares it ranked', () => {
    // Undeclared, this is a budget ballot and maxValue 0 is exactly right for it.
    const { metadata, ...undeclared } = zeroMaxValue
    expect(unsatisfiableQuestionReason(undeclared)).toBeNull()
    expect(() => encodeQuestionBallot(undeclared, [2, 1, 0])).not.toThrow()
  })

  it('says nothing about a ranked question whose protocol was not read', () => {
    // Public reads may omit ballotProtocol entirely; absent is not zero, and reporting
    // a dead election on a partial read would be a false alarm.
    expect(unsatisfiableQuestionReason({ metadata: { type: { name: 'ranked' } }, choices: choices(3) })).toBeNull()
  })

  it('leaves a single-option ranked question alone', () => {
    expect(unsatisfiableQuestionReason({ ...zeroMaxValue, choices: choices(1) })).toBeNull()
  })
})

describe('ranked: two choices sharing a value', () => {
  // Ranked is position-addressed, so duplicates cannot corrupt the *ballot* — but the
  // decoded rows are keyed by `choice.value`, so two options come back under one id:
  // a renderer looking a row up by choice id shows one title twice with two different
  // scores, and React sees duplicate keys. `rankedOrderToScores` already refuses it;
  // the guards below are the paths that did not, including the one moment it is
  // fixable (creation).
  const dupes = {
    ballotProtocol: rankedProtocol(3),
    metadata: { type: { name: 'ranked' } },
    choices: [
      { title: { default: 'A' }, value: 0 },
      { title: { default: 'B' }, value: 1 },
      { title: { default: 'C' }, value: 1 },
    ],
  }

  it('is the failure this guards: two decoded rows under one choice id', () => {
    const decoded = decodeQuestionResults(dupes, THREE_VOTERS_C2_C0_C1)
    expect(decoded.map((row) => row.choice)).toEqual([0, 1, 1])
  })

  it('is reported as an uncastable choice', () => {
    expect(uncastableChoicesReason(dupes)).toMatch(/used by more than one choice/)
  })

  it('is refused by both encoders, even with a perfectly well-formed rank array', () => {
    // [2, 1, 0] is a valid ranking on the wire — distinct, in range, one per option —
    // so no per-ballot check can catch this. It has to be refused for the question.
    expect(() => encodeQuestionBallot(dupes, [2, 1, 0])).toThrow(/used by more than one choice/)
    expect(() =>
      encodeBallot(
        {
          type: 'ranked',
          voteType: {
            maxCount: 3,
            maxValue: 2,
            maxVoteOverwrites: 0,
            costExponent: 1,
            uniqueChoices: true,
            costFromWeight: false,
          },
          questions: [{ title: { default: 'Q0' }, choices: dupes.choices }],
        },
        [[2, 1, 0]]
      )
    ).toThrow(/used by more than one choice/)
  })

  it('is refused by validateSelections too, or the submit button lies', () => {
    // The half `encodeBallot` refuses for the *question* has to be refused here as
    // well: a UI gating its submit button on the validator would otherwise enable the
    // vote and throw at cast time — the late discovery the encode-side check exists to
    // prevent. Nothing in a selection shows this defect, so only a question-level rule
    // can reach it.
    expect(() =>
      validateSelections(
        {
          type: 'ranked',
          voteType: {
            maxCount: 3,
            maxValue: 2,
            maxVoteOverwrites: 0,
            costExponent: 1,
            uniqueChoices: true,
            costFromWeight: false,
          },
          questions: [{ title: { default: 'Q0' }, choices: dupes.choices }],
        },
        [[2, 1, 0]]
      )
    ).toThrow(/used by more than one choice/)
  })

  it('is reported on a protocol-less read, where the ceiling rule has nothing to say', () => {
    // `uncastableChoicesReason` returns null without a protocol for every other type,
    // because their bounds are *derived from* the values. A ranking's defect is not
    // measured against a ceiling at all, and `encodeQuestionBallot` refuses it either
    // way — so staying silent would leave `hasUncastableChoices` (which the vote form
    // consults to decide whose mistake to report) disagreeing with the encoder.
    const noProtocol = { type: 'ranked', choices: dupes.choices }
    expect(uncastableChoicesReason(noProtocol)).toMatch(/used by more than one choice/)
    expect(() => encodeQuestionBallot(noProtocol, [2, 1, 0])).toThrow(/used by more than one choice/)
  })

  it('leaves non-contiguous but distinct values alone', () => {
    // Position-addressed means the values are display labels; only *collisions* matter.
    const sparse = { ...dupes, choices: [7, 8, 9].map((v) => ({ title: { default: `C${v}` }, value: v })) }
    expect(uncastableChoicesReason(sparse)).toBeNull()
    expect(encodeQuestionBallot(sparse, [2, 1, 0])).toEqual([2, 1, 0])
    // …and a protocol-less read of the same choices stays quiet, as every other type does.
    expect(uncastableChoicesReason({ type: 'ranked', choices: sparse.choices })).toBeNull()
  })
})

describe('ranked: a question read without its ballotProtocol', () => {
  // Public reads may omit `ballotProtocol`. Every other type either derives its bounds
  // from the named type or has none — a ranking has a canonical protocol (one field per
  // option, ranks 0..n-1, no repeats), and deriving it is what keeps the encoder honest:
  // the no-bounds fallback means "unbounded, repeats fine", which is exactly the ballot
  // the chain records and drops at tally.
  const noProtocol = { metadata: { type: { name: 'ranked' } }, choices: choices(3) }

  it('still refuses a duplicated rank', () => {
    expect(() => encodeQuestionBallot(noProtocol, [1, 1, 1])).toThrow(/repeats value 1/)
  })

  it('still refuses a rank above the derived ceiling', () => {
    expect(() => encodeQuestionBallot(noProtocol, [9, 1, 0])).toThrow(/above maxValue 2/)
  })

  it('encodes a well-formed ranking unchanged', () => {
    expect(encodeQuestionBallot(noProtocol, [2, 1, 0])).toEqual([2, 1, 0])
    expect(encodeQuestionSelections(noProtocol, [2, 0, 1])).toEqual([1, 0, 2])
  })

  it('leaves protocol-less questions of every other type alone', () => {
    // The derivation keys off the ranked declaration, not off the missing protocol:
    // singlechoice still derives maxValue from its own values, multichoice still goes
    // dense, and neither gains a uniqueness rule.
    expect(encodeQuestionBallot({ type: 'singlechoice', choices: choices(3) }, [2])).toEqual([2])
    const multi = {
      type: 'multichoice',
      typeSetup: { minChoices: 0, maxChoices: 2, uniqueChoices: false },
      choices: choices(3),
    }
    expect(encodeQuestionBallot(multi, [0, 2])).toEqual([1, 0, 1])
  })
})

describe('ranked: encodeQuestionBallot', () => {
  it('passes the ranks through unchanged', () => {
    expect(encodeQuestionBallot(rankedQuestion(4), [2, 0, 3, 1])).toEqual([2, 0, 3, 1])
  })

  it('composes with rankedOrderToScores', () => {
    const question = rankedQuestion(3)
    const ballot = encodeQuestionBallot(question, rankedOrderToScores(question, [2, 0, 1]))
    expect(ballot).toEqual([1, 0, 2])
  })

  it('refuses a duplicated rank rather than casting a ballot the chain drops', () => {
    expect(() => encodeQuestionBallot(rankedQuestion(3), [2, 2, 0])).toThrow(/repeats value 2/)
  })

  it('refuses a rank above maxValue', () => {
    expect(() => encodeQuestionBallot(rankedQuestion(3), [5, 1, 0])).toThrow(/above maxValue 2/)
  })

  it('refuses a partial ranking, exactly as validateSelections does', () => {
    // The pair that has to agree: a UI gating its submit button on the validator would
    // otherwise enable the vote and then throw at cast time — and a caller building the
    // ranks by hand (the direct path the docs describe) would cast a 2-field ballot on a
    // 4-option question, leaving C2/C3 unranked and skewing the Borda tally with nothing
    // downstream able to notice. A short slate cannot be padded either: the protocol is
    // pigeonhole-tight, so any filler repeats a rank.
    expect(() => encodeQuestionBallot(rankedQuestion(4), [2, 0])).toThrow(/one rank per option \(4\), got 2/)

    const election = {
      type: 'ranked',
      voteType: {
        maxCount: 3,
        maxValue: 2,
        maxVoteOverwrites: 0,
        costExponent: 1,
        uniqueChoices: true,
        costFromWeight: false,
      },
      questions: [{ title: { default: 'Q0' }, choices: choices(3) }],
    }
    expect(() => encodeBallot(election, [[1, 0]])).toThrow(/one rank per option \(3\), got 2/)
    expect(() => validateSelections(election, [[1, 0]])).toThrow(/one rank per option \(3\), got 2/)
  })

  it('refuses a ranking with more entries than options', () => {
    expect(() => encodeQuestionBallot(rankedQuestion(3), [2, 1, 0, 3])).toThrow(
      /one rank per option \(3\), got 4/
    )
  })

  it('encodes a ranked election through encodeBallot too', () => {
    const ballot = encodeBallot(
      {
        type: 'ranked',
        voteType: {
          maxCount: 3,
          maxValue: 2,
          maxVoteOverwrites: 0,
          costExponent: 1,
          uniqueChoices: true,
          costFromWeight: false,
        },
        questions: [{ title: { default: 'Q0' }, choices: choices(3) }],
      },
      [[1, 0, 2]]
    )
    expect(ballot).toEqual([1, 0, 2])
  })
})

describe('encodeQuestionSelections: one entry point for what a form collects', () => {
  // The orientation lives in exactly one place, and this is the function that puts it
  // there. Without it every consumer has to know that ranked — and only ranked — needs
  // `rankedOrderToScores` before `encodeQuestionBallot`, and that skipping the step
  // yields a perfectly valid ballot that elects the loser with nothing on either side
  // able to detect it.
  it('transposes a ranked question\'s ordering, and encodes everything else as-is', () => {
    // Voter ranks C2 > C0 > C1 — the ordering a form collects, not the wire ranks.
    expect(encodeQuestionSelections(rankedQuestion(3), [2, 0, 1])).toEqual([1, 0, 2])

    // A dense (approval) question: the same selections stay selections.
    const approval = {
      ballotProtocol: { ...rankedProtocol(3), maxValue: 1, uniqueValues: false },
      choices: choices(3),
    }
    expect(inferQuestionBallotType(approval)).toBe(BallotType.Approval)
    expect(encodeQuestionSelections(approval, [0, 2])).toEqual([1, 0, 1])
  })

  it('agrees with the two-step form it replaces', () => {
    const question = rankedQuestion(4)
    const order = [2, 0, 3, 1]
    expect(encodeQuestionSelections(question, order)).toEqual(
      encodeQuestionBallot(question, rankedOrderToScores(question, order))
    )
  })

  it('refuses an incomplete ordering', () => {
    expect(() => encodeQuestionSelections(rankedQuestion(3), [2, 0])).toThrow(/every option must be ranked/)
  })
})

describe('ranked: round-trip through a one-voter histogram', () => {
  it.each([
    { n: 3, order: [2, 0, 1] },
    { n: 4, order: [2, 0, 3, 1] },
    { n: 5, order: [4, 3, 2, 1, 0] },
  ])('recovers the voter\'s own order ($n options)', ({ n, order }) => {
    const question = rankedQuestion(n)
    const ballot = encodeQuestionBallot(question, rankedOrderToScores(question, order))

    // One voter's ballot as the chain would histogram it: results[field][value] = 1.
    const matrix = ballot.map((rank) =>
      Array.from({ length: n }, (_, value) => (value === rank ? '1' : '0'))
    )

    const decoded = decodeQuestionResults(question, matrix)
    const recovered = [...decoded].sort((a, b) => b.votes - a.votes).map((row) => row.choice)
    expect(recovered).toEqual(order)
  })

  it('would elect the loser if either side flipped the orientation', () => {
    // The guard for the one thing no matrix can reveal: encode and decode agree on
    // "highest = best" by convention only. A 0-is-best ballot is perfectly valid and
    // decodes to the exact reverse ranking, which is why the orientation is pinned in
    // both docstrings and here.
    const question = rankedQuestion(3)
    const inverted = [1, 2, 0] // C1 ranked "best" under a 0-is-best reading
    const matrix = inverted.map((rank) =>
      Array.from({ length: 3 }, (_, value) => (value === rank ? '1' : '0'))
    )
    const decoded = decodeQuestionResults(question, matrix)
    expect(decoded.map((row) => row.votes)).toEqual([1, 2, 0])
    expect([...decoded].sort((a, b) => b.votes - a.votes).map((row) => row.choice)).toEqual([1, 0, 2])
  })
})

describe('ranked: surrounding guards', () => {
  it('is satisfiable — uniqueValues is exactly affordable', () => {
    expect(unsatisfiableQuestionReason(rankedQuestion(4))).toBeNull()
  })

  it('publishes no uncastable choice, whatever the choice values are', () => {
    // Position-addressed: choice.value never reaches the wire, so the pick-slot
    // sentinel rule (which demands exactly 0..n-1) must not fire here.
    const question = {
      ballotProtocol: rankedProtocol(3),
      metadata: { type: { name: 'ranked' } },
      choices: [
        { title: { default: 'C7' }, value: 7 },
        { title: { default: 'C8' }, value: 8 },
        { title: { default: 'C9' }, value: 9 },
      ],
    }
    expect(uncastableChoicesReason(question)).toBeNull()
    // Undeclared, the same question is a pick-slot multichoice and IS broken —
    // proof that the declaration, not the shape, is doing the work.
    expect(uncastableChoicesReason({ ...question, metadata: undefined })).toMatch(/pick-slot/)
  })

  it('asks the voter for a full slate', () => {
    expect(questionSelectionRange(rankedQuestion(4))).toEqual({ min: 4, max: 4 })
  })

  it('validateSelections accepts a full distinct ranking and rejects the rest', () => {
    const election = {
      type: 'ranked',
      voteType: {
        maxCount: 3,
        maxValue: 2,
        maxVoteOverwrites: 0,
        costExponent: 1,
        uniqueChoices: true,
        costFromWeight: false,
      },
      questions: [{ title: { default: 'Q0' }, choices: choices(3) }],
    }
    expect(() => validateSelections(election, [[1, 0, 2]])).not.toThrow()
    expect(() => validateSelections(election, [[1, 0]])).toThrow(/one rank per option/)
    expect(() => validateSelections(election, [[1, 1, 0]])).toThrow(/used twice/)
    expect(() => validateSelections(election, [[5, 1, 0]])).toThrow(/above maxValue 2/)
  })
})

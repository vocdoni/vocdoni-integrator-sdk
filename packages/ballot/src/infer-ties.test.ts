import { describe, expect, it } from 'vitest'
import type { BallotProtocol, Choice, Election } from '@vocdoni/api-types'
import { declaresRanked, inferBallotType, inferQuestionBallotType, isPickSlotLayout } from './infer'
import { BallotType } from './types'
import { questionSelectionRange } from './abstain'
import { decodeQuestionResults, decodeResults } from './decode'
import { encodeQuestionBallot, encodeQuestionSelections } from './encode'
import { hasUncastableChoices, unsatisfiableQuestionReason } from './protocol'

/**
 * Issue #58: the protocol decides the ballot type, and a declared name only breaks its
 * ties. A name the shape rules out is ignored — names are not always honest.
 */

const bp = (shape: Partial<BallotProtocol>): BallotProtocol => ({
  maxCount: 1,
  maxValue: 1,
  maxVoteOverwrites: 0,
  maxTotalCost: 0,
  costExponent: 1,
  uniqueValues: false,
  costFromWeight: false,
  ...shape,
})

const choices = (n: number, values?: number[]): Choice[] =>
  Array.from({ length: n }, (_, i) => ({ title: { default: `C${i}` }, value: values?.[i] ?? i }))

type Name = { type?: string; metadata?: Record<string, unknown> }
const saas = (type: string): Name => ({ type })
const legacy = (name: string): Name => ({ metadata: { type: { name } } })

describe('inferQuestionBallotType: a name only breaks a tie the protocol cannot', () => {
  // One row per protocol shape: [label, protocol, no-name answer, names the shape admits
  // (with the answer each selects), names it rules out]. A ruled-out name must read
  // exactly like no name at all.
  const rows: Array<{
    shape: string
    protocol: BallotProtocol
    fallback: BallotType
    admitted: Array<[Name, BallotType]>
    contradicting: Name[]
  }> = [
    {
      shape: 'maxValue 0, costExponent 1',
      protocol: bp({ maxCount: 3, maxValue: 0, costExponent: 1 }),
      fallback: BallotType.Budget,
      admitted: [[legacy('budget-based'), BallotType.Budget]],
      contradicting: [legacy('quadratic'), legacy('approval'), saas('multichoice'), legacy('ranked')],
    },
    {
      shape: 'maxValue 0, costExponent 2',
      protocol: bp({ maxCount: 3, maxValue: 0, costExponent: 2 }),
      fallback: BallotType.Quadratic,
      admitted: [[legacy('quadratic'), BallotType.Quadratic]],
      contradicting: [legacy('budget-based'), saas('singlechoice'), saas('ranked')],
    },
    {
      shape: 'maxCount 1',
      protocol: bp({ maxCount: 1, maxValue: 3 }),
      fallback: BallotType.SingleChoice,
      admitted: [
        [saas('singlechoice'), BallotType.SingleChoice],
        [legacy('single-choice-multiquestion'), BallotType.SingleChoice],
      ],
      contradicting: [saas('multichoice'), legacy('multiple-choice'), legacy('approval'), saas('ranked')],
    },
    {
      shape: 'maxValue 1, maxCount 3, !uniqueValues (dense)',
      protocol: bp({ maxCount: 3, maxValue: 1, maxTotalCost: 3 }),
      fallback: BallotType.Approval,
      admitted: [
        [legacy('approval'), BallotType.Approval],
        [saas('multichoice'), BallotType.MultiChoice],
      ],
      // A pick-slot list at maxValue 1 has values for two options only, so the legacy
      // `multiple-choice` name cannot describe three fields.
      contradicting: [
        legacy('single-choice-multiquestion'),
        saas('singlechoice'),
        legacy('multiple-choice'),
        legacy('budget-based'),
        legacy('ranked'),
      ],
    },
    {
      shape: 'maxValue 1, maxCount 2, !uniqueValues (dense or 2-option pick-slot)',
      protocol: bp({ maxCount: 2, maxValue: 1 }),
      fallback: BallotType.Approval,
      admitted: [
        [legacy('approval'), BallotType.Approval],
        [saas('multichoice'), BallotType.MultiChoice],
        [legacy('multiple-choice'), BallotType.MultiChoice],
      ],
      contradicting: [legacy('single-choice-multiquestion'), saas('singlechoice'), legacy('ranked')],
    },
    {
      shape: 'maxValue 1, maxCount 2, uniqueValues (2-option index list or ranking)',
      protocol: bp({ maxCount: 2, maxValue: 1, uniqueValues: true }),
      fallback: BallotType.MultiChoice,
      admitted: [
        [legacy('multiple-choice'), BallotType.MultiChoice],
        [legacy('ranked'), BallotType.Ranked],
      ],
      contradicting: [legacy('approval'), saas('singlechoice'), legacy('single-choice-multiquestion')],
    },
    {
      shape: 'full slate maxCount n, maxValue n-1, uniqueValues (pick-slot or ranking)',
      protocol: bp({ maxCount: 3, maxValue: 2, uniqueValues: true }),
      fallback: BallotType.MultiChoice,
      admitted: [
        [legacy('multiple-choice'), BallotType.MultiChoice],
        [saas('ranked'), BallotType.Ranked],
        [legacy('ranked'), BallotType.Ranked],
      ],
      contradicting: [legacy('approval'), saas('singlechoice'), legacy('single-choice-multiquestion')],
    },
    {
      shape: 'pick-slot with headroom, uniqueValues (still room for a ranking)',
      protocol: bp({ maxCount: 3, maxValue: 5, uniqueValues: true }),
      fallback: BallotType.MultiChoice,
      admitted: [[legacy('ranked'), BallotType.Ranked]],
      contradicting: [legacy('approval'), legacy('budget-based')],
    },
    {
      shape: 'pick-slot with repeats (no ranking without uniqueValues)',
      protocol: bp({ maxCount: 3, maxValue: 2 }),
      fallback: BallotType.MultiChoice,
      admitted: [[legacy('multiple-choice'), BallotType.MultiChoice]],
      contradicting: [legacy('ranked'), legacy('approval'), legacy('single-choice-multiquestion')],
    },
  ]

  for (const row of rows) {
    describe(row.shape, () => {
      it('falls back to the shape default with no name', () => {
        expect(inferQuestionBallotType({ ballotProtocol: row.protocol })).toBe(row.fallback)
      })

      it('lets an admitted name pick', () => {
        for (const [name, expected] of row.admitted) {
          expect(inferQuestionBallotType({ ballotProtocol: row.protocol, ...name })).toBe(expected)
        }
      })

      it('ignores a name the shape rules out', () => {
        for (const name of row.contradicting) {
          expect(inferQuestionBallotType({ ballotProtocol: row.protocol, ...name })).toBe(row.fallback)
        }
      })
    })
  }

  it('still takes the name as is when there is no protocol to weigh it against', () => {
    // Public reads of named questions may omit ballotProtocol; the name is then the only
    // source, exactly as before.
    expect(inferQuestionBallotType(legacy('ranked'))).toBe(BallotType.Ranked)
    expect(inferQuestionBallotType(legacy('single-choice-multiquestion'))).toBe(BallotType.SingleChoice)
    expect(inferQuestionBallotType(saas('multichoice'))).toBe(BallotType.MultiChoice)
  })
})

describe('the explorer case: an approval ballot stamped single-choice-multiquestion', () => {
  // Sampled from the vochain gateway: an approval ballot over three options whose metadata
  // names it single-choice. Read as single-choice, only the first matrix row is decoded.
  const question = {
    ballotProtocol: bp({ maxCount: 3, maxValue: 1, maxTotalCost: 3 }),
    metadata: { type: { name: 'single-choice-multiquestion' } },
    choices: choices(3),
  }
  // Dense histograms: row i is option i's [notSelected, selected].
  const results = [
    ['4', '6'],
    ['7', '3'],
    ['1', '9'],
  ]

  it('is inferred and decoded as approval', () => {
    expect(inferQuestionBallotType(question)).toBe(BallotType.Approval)
    expect(decodeQuestionResults(question, results).map((row) => row.votes)).toEqual([6, 3, 9])
  })

  it('reads the same at the election level', () => {
    const election = {
      meta: question.metadata,
      voteType: {
        maxCount: 3,
        maxValue: 1,
        maxVoteOverwrites: 0,
        costExponent: 1,
        uniqueChoices: false,
        costFromWeight: false,
      },
      questions: [{ title: { default: 'Q0' }, choices: choices(3) }],
      results,
    }
    expect(inferBallotType(election)).toBe(BallotType.Approval)
    expect(decodeResults(election)[0].map((row) => row.votes)).toEqual([6, 3, 9])
  })

  it('agrees across every helper that asks part of the same question', () => {
    expect(questionSelectionRange(question)).toEqual({ min: 1, max: 3 })
    expect(encodeQuestionBallot(question, [0, 2])).toEqual([1, 0, 1])
    // Sparse values are fine for a position-addressed layout. Read as single-choice
    // under maxValue 1, values 5/6/7 would all be flagged unreachable.
    expect(hasUncastableChoices({ ...question, choices: choices(3, [5, 6, 7]) })).toBe(false)
  })
})

describe('inferBallotType: the same rule at the election level', () => {
  const election = (
    voteType: Partial<Election['voteType']>,
    declared: { type?: string; meta?: Record<string, unknown> } = {},
    questions = 1
  ) => ({
    voteType: {
      maxCount: 1,
      maxValue: 1,
      maxVoteOverwrites: 0,
      costExponent: 1,
      uniqueChoices: false,
      costFromWeight: false,
      ...voteType,
    },
    questions: Array.from({ length: questions }, (_, q) => ({ title: { default: `Q${q}` }, choices: choices(3) })),
    ...declared,
  })

  it('reads a multi-question election as single-choice whatever the name says', () => {
    expect(inferBallotType(election({ maxCount: 2, maxValue: 2 }, { type: 'approval' }, 2))).toBe(
      BallotType.SingleChoice
    )
    expect(inferBallotType(election({ maxCount: 2, maxValue: 0 }, { type: 'budget-based' }, 2))).toBe(
      BallotType.SingleChoice
    )
  })

  it('keeps the name-dependent 2-option tie', () => {
    const tie = { maxCount: 2, maxValue: 1 }
    expect(inferBallotType(election(tie, { type: 'multiple-choice' }))).toBe(BallotType.MultiChoice)
    expect(inferBallotType(election(tie, { type: 'approval' }))).toBe(BallotType.Approval)
    expect(inferBallotType(election(tie))).toBe(BallotType.Approval)
  })

  it('ignores a legacy pick-slot name over a dense shape too wide for it', () => {
    expect(inferBallotType(election({ maxCount: 3, maxValue: 1 }, { type: 'multiple-choice' }))).toBe(
      BallotType.Approval
    )
  })

  it('lets a ruled-out explicit type yield to an admitted metadata name', () => {
    expect(
      inferBallotType(
        election({ maxCount: 2, maxValue: 1 }, { type: 'budget-based', meta: { type: { name: 'multiple-choice' } } })
      )
    ).toBe(BallotType.MultiChoice)
  })

  it('reads a ranked name over a single field as single-choice', () => {
    expect(inferBallotType(election({ maxCount: 1, maxValue: 2 }, { type: 'ranked' }))).toBe(BallotType.SingleChoice)
  })
})

describe('ranked: only where the protocol can hold a ranking', () => {
  const rankedName = legacy('ranked')

  it('reads a ranked name over a single field as single-choice, everywhere', () => {
    // The issue's own example: before #58 this was ranked, and the form demanded a full slate
    // of three ranks for a protocol with room for one value.
    const question = { ballotProtocol: bp({ maxCount: 1, maxValue: 2 }), ...rankedName, choices: choices(3) }
    expect(inferQuestionBallotType(question)).toBe(BallotType.SingleChoice)
    expect(declaresRanked(question)).toBe(false)
    expect(questionSelectionRange(question)).toEqual({ min: 1, max: 1 })
    // Not transposed as an ordering: a single-choice selection goes through as is.
    expect(encodeQuestionSelections(question, [2])).toEqual([2])
    expect(decodeQuestionResults(question, [['1', '2', '3']]).map((row) => row.votes)).toEqual([1, 2, 3])
  })

  it('keeps a well-formed ranked question ranked, everywhere', () => {
    const question = { ballotProtocol: bp({ maxCount: 3, maxValue: 2, uniqueValues: true }), ...rankedName, choices: choices(3) }
    expect(inferQuestionBallotType(question)).toBe(BallotType.Ranked)
    expect(declaresRanked(question)).toBe(true)
    expect(questionSelectionRange(question)).toEqual({ min: 3, max: 3 })
  })

  it('still refuses a ranked declaration over maxValue 0, though it decodes as budget', () => {
    // The name loses the decode, but the contradiction is still reported: whoever
    // declared a ranking gets none out of this protocol.
    const question = { ballotProtocol: bp({ maxCount: 3, maxValue: 0 }), ...rankedName, choices: choices(3) }
    expect(inferQuestionBallotType(question)).toBe(BallotType.Budget)
    expect(declaresRanked(question)).toBe(false)
    expect(unsatisfiableQuestionReason(question)).toMatch(/declared ranked/)
  })
})

describe('isPickSlotLayout agrees with inference', () => {
  it('honours the legacy pick-slot name only where two fields can hold it', () => {
    const named = legacy('multiple-choice')
    const two = { ballotProtocol: bp({ maxCount: 2, maxValue: 1 }), ...named, choices: choices(2) }
    const three = { ballotProtocol: bp({ maxCount: 3, maxValue: 1 }), ...named, choices: choices(3) }

    expect(inferQuestionBallotType(two)).toBe(BallotType.MultiChoice)
    expect(isPickSlotLayout(two)).toBe(true)
    // Pick-slot column sums (plus the abstain bucket): slot 0 picked C1 twice, slot 1
    // picked C0 once. A dense read would report the selected column instead: [2, 0].
    expect(decodeQuestionResults(two, [['0', '2'], ['1', '0']]).map((row) => row.votes)).toEqual([1, 2, 0])

    expect(inferQuestionBallotType(three)).toBe(BallotType.Approval)
    expect(isPickSlotLayout(three)).toBe(false)
    expect(questionSelectionRange({ ...three, ballotProtocol: bp({ maxCount: 3, maxValue: 1, maxTotalCost: 2 }) })).toEqual({
      min: 1,
      max: 2,
    })
  })

  it('honours it over two options with more (repeatable) slots than options', () => {
    // Legacy MultiChoiceElection, canRepeatChoices, 2 options, maxNumberOfChoices 3, no
    // abstain: {maxCount: 3, maxValue: 1, uniqueChoices: false}. Two options can't fill
    // three dense fields, so this is pick-slot, not approval.
    const question = {
      ballotProtocol: bp({ maxCount: 3, maxValue: 1 }),
      ...legacy('multiple-choice'),
      choices: choices(2),
    }
    expect(inferQuestionBallotType(question)).toBe(BallotType.MultiChoice)
    expect(isPickSlotLayout(question)).toBe(true)
    expect(
      inferBallotType({
        type: 'multiple-choice',
        voteType: { maxCount: 3, maxValue: 1, maxVoteOverwrites: 0, costExponent: 1, uniqueChoices: false, costFromWeight: false },
        questions: [{ title: { default: 'Q0' }, choices: choices(2) }],
      })
    ).toBe(BallotType.MultiChoice)
  })
})

describe('ranked needs one field per option', () => {
  it('ignores a ranked name when maxCount does not match the choices', () => {
    // A 2-slot pick list over 5 options has room for 2 ranks, not 5: reading it ranked
    // would demand a full slate the protocol can't hold.
    const question = {
      ballotProtocol: bp({ maxCount: 2, maxValue: 4, uniqueValues: true }),
      ...legacy('ranked'),
      choices: choices(5),
    }
    expect(inferQuestionBallotType(question)).toBe(BallotType.MultiChoice)
    expect(declaresRanked(question)).toBe(false)
  })
})

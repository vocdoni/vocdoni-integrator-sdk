import { describe, it, expect } from 'vitest'
import type { BallotProtocol, Election } from '@vocdoni/api-types'
import { assertBallotMinimums, BallotMinimumError, voteTypeBounds } from './protocol'
import { encodeBallot, encodeQuestionBallot } from './encode'
import { validateSelections } from './validate'
import { questionSelectionRange } from './abstain'

// Shapes from the sequencer's CheckVote table (vocdoni-sequencer ballot-minimums spec).

const bp = (overrides: Partial<BallotProtocol> = {}): BallotProtocol => ({
  maxCount: 1,
  maxValue: 1,
  maxVoteOverwrites: 0,
  maxTotalCost: 0,
  costExponent: 1,
  uniqueValues: false,
  costFromWeight: false,
  ...overrides,
})

const choices = (n: number) => Array.from({ length: n }, (_, j) => ({ title: { default: `C${j}` }, value: j }))

const election = (voteType: Partial<Election['voteType']>, numChoices = 4): Pick<Election, 'questions' | 'voteType'> => ({
  voteType: {
    maxCount: 1,
    maxValue: 0,
    maxVoteOverwrites: 0,
    costExponent: 0,
    uniqueChoices: false,
    costFromWeight: false,
    ...voteType,
  },
  questions: [{ title: { default: 'Q0' }, choices: choices(numChoices) }],
})

const minimumError = (fn: () => unknown): BallotMinimumError => {
  try {
    fn()
  } catch (err) {
    expect(err).toBeInstanceOf(BallotMinimumError)
    return err as BallotMinimumError
  }
  throw new Error('expected a BallotMinimumError')
}

describe('assertBallotMinimums', () => {
  it('is a no-op when the minimums are absent or 0', () => {
    expect(() => assertBallotMinimums([], {})).not.toThrow()
    expect(() => assertBallotMinimums([0, 0], { minValue: 0, minTotalCost: 0, costExponent: 1 })).not.toThrow()
  })

  it('costExponent 0 counts fields (0^0 = 1): [] is below minTotalCost 1, [0] and [1] are not', () => {
    const bounds = { costExponent: 0, minTotalCost: 1 }
    const err = minimumError(() => assertBallotMinimums([], bounds))
    expect(err.rule).toBe('minTotalCost')
    expect(err.minimum).toBe(1)
    expect(err.actual).toBe(0)
    expect(() => assertBallotMinimums([0], bounds)).not.toThrow()
    expect(() => assertBallotMinimums([1], bounds)).not.toThrow()
  })

  it('costExponent 1 sums the values', () => {
    const bounds = { costExponent: 1, minTotalCost: 2 }
    expect(() => assertBallotMinimums([0, 0, 0, 0], bounds)).toThrow(BallotMinimumError)
    expect(() => assertBallotMinimums([1, 0, 0, 0], bounds)).toThrow(/total cost is 1.*minimum of 2/)
    expect(() => assertBallotMinimums([1, 1, 0, 0], bounds)).not.toThrow()
  })

  it('costExponent 2 sums the squares', () => {
    const bounds = { costExponent: 2, minTotalCost: 10 }
    expect(() => assertBallotMinimums([1, 2], bounds)).toThrow(BallotMinimumError)
    expect(() => assertBallotMinimums([1, 3], bounds)).not.toThrow()
  })

  it('minValue: [0, 1] is rejected, [1, 1] and [] are not', () => {
    const err = minimumError(() => assertBallotMinimums([1, 0], { minValue: 1 }))
    expect(err.rule).toBe('minValue')
    expect(err.field).toBe(1)
    expect(err.actual).toBe(0)
    expect(err.message).toMatch(/field 1 is 0, below .* minimum value of 1/)
    expect(() => assertBallotMinimums([1, 1], { minValue: 1 })).not.toThrow()
    expect(() => assertBallotMinimums([], { minValue: 1 })).not.toThrow()
  })

  it('refuses minTotalCost with a costExponent above 8, which the chain never evaluates', () => {
    expect(() => assertBallotMinimums([5], { costExponent: 9, minTotalCost: 1 })).toThrow(/refuses every ballot/)
    expect(() => assertBallotMinimums([5], { costExponent: 8, minTotalCost: 1 })).not.toThrow()
    // No minimum: the exponent is not the minimum check's business.
    expect(() => assertBallotMinimums([5], { costExponent: 10000 })).not.toThrow()
  })
})

describe('voteTypeBounds', () => {
  it('carries the minimums and costExponent when present', () => {
    expect(
      voteTypeBounds({ maxCount: 2, maxValue: 3, uniqueChoices: false, costExponent: 1, minValue: 1, minTotalCost: 2 })
    ).toEqual({ maxCount: 2, maxValue: 3, uniqueValues: false, costExponent: 1, minValue: 1, minTotalCost: 2 })
  })
})

describe('encodeQuestionBallot with minimums', () => {
  it('dense multichoice minTotalCost 2: one pick is refused, two are encoded', () => {
    const question = {
      ballotProtocol: bp({ maxCount: 4, maxValue: 1, maxTotalCost: 4, minTotalCost: 2 }),
      type: 'multichoice',
      choices: choices(4),
    }
    expect(() => encodeQuestionBallot(question, [])).toThrow(BallotMinimumError)
    expect(() => encodeQuestionBallot(question, [2])).toThrow(BallotMinimumError)
    expect(encodeQuestionBallot(question, [0, 2])).toEqual([1, 0, 1, 0])
  })

  it('budget with minTotalCost = maxTotalCost: under-spend is refused, exact spend is encoded', () => {
    const question = {
      ballotProtocol: bp({ maxCount: 3, maxValue: 0, maxTotalCost: 10, minTotalCost: 10, costExponent: 1 }),
      type: 'budget',
      choices: choices(3),
    }
    expect(() => encodeQuestionBallot(question, [3, 3, 3])).toThrow(BallotMinimumError)
    expect(encodeQuestionBallot(question, [5, 3, 2])).toEqual([5, 3, 2])
  })

  it('reads a protocol without the fields as no minimum', () => {
    const question = { ballotProtocol: bp({ maxCount: 4, maxValue: 1, maxTotalCost: 4 }), type: 'multichoice', choices: choices(4) }
    expect(encodeQuestionBallot(question, [])).toEqual([0, 0, 0, 0])
  })
})

describe('encodeBallot and validateSelections with minimums', () => {
  it('budget minTotalCost: both refuse the under-spend and accept the full spend', () => {
    const budget = election({ maxCount: 3, maxValue: 0, costExponent: 1, minTotalCost: 6 }, 3)
    expect(() => encodeBallot(budget, [1, 2, 2])).toThrow(BallotMinimumError)
    expect(() => validateSelections(budget, [1, 2, 2])).toThrow(BallotMinimumError)
    expect(encodeBallot(budget, [1, 2, 3])).toEqual([1, 2, 3])
    expect(() => validateSelections(budget, [1, 2, 3])).not.toThrow()
  })

  it('minValue: both refuse a zero amount', () => {
    const budget = election({ maxCount: 3, maxValue: 0, costExponent: 1, minValue: 1 }, 3)
    expect(() => encodeBallot(budget, [0, 2, 2])).toThrow(BallotMinimumError)
    expect(() => validateSelections(budget, [0, 2, 2])).toThrow(BallotMinimumError)
    expect(() => validateSelections(budget, [1, 2, 2])).not.toThrow()
  })

  it('approval minTotalCost judges the dense wire ballot', () => {
    const approval = election({ maxCount: 4, maxValue: 1, costExponent: 1, minTotalCost: 2 })
    expect(() => validateSelections(approval, [3])).toThrow(BallotMinimumError)
    expect(() => validateSelections(approval, [1, 3])).not.toThrow()
    expect(encodeBallot(approval, [1, 3])).toEqual([0, 1, 0, 1])
  })

  it('ranked minTotalCost with costExponent 0 counts the ranks', () => {
    const ranked = election({ maxCount: 3, maxValue: 2, uniqueChoices: true, costExponent: 0, minTotalCost: 3 }, 3)
    expect(encodeBallot(ranked, [2, 0, 1])).toEqual([2, 0, 1])
    expect(() => validateSelections(ranked, [2, 0, 1])).not.toThrow()
  })
})

describe('questionSelectionRange with minTotalCost', () => {
  it('dense multichoice: minTotalCost raises the minimum pick count', () => {
    const dense = bp({ maxCount: 4, maxValue: 1, maxTotalCost: 4, minTotalCost: 2 })
    expect(questionSelectionRange({ ballotProtocol: dense, type: 'multichoice', choices: choices(4) })).toEqual({
      min: 2,
      max: 4,
    })
  })
})

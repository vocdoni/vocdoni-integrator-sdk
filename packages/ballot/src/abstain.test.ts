import { describe, it, expect } from 'vitest'
import type { BallotProtocol, Election } from '@vocdoni/api-types'
import {
  isAbstainVisible,
  multichoiceReservesAbstain,
  questionReservesAbstain,
  questionSelectionRange,
} from './abstain'

const vt = (partial: Partial<Election['voteType']>): Election['voteType'] => ({
  maxCount: 1,
  maxValue: 0,
  maxVoteOverwrites: 0,
  costExponent: 0,
  uniqueChoices: false,
  costFromWeight: false,
  ...partial,
})

/** One question with `n` choices (values 0..n-1). */
const question = (n: number) => [
  {
    title: { default: 'Q0' },
    choices: Array.from({ length: n }, (_, j) => ({ title: { default: `C${j}` }, value: j })),
  },
]

describe('multichoiceReservesAbstain', () => {
  it('is false for non-multichoice ballots', () => {
    // single-choice
    expect(multichoiceReservesAbstain({ voteType: vt({ maxCount: 1, maxValue: 2 }), questions: question(3) })).toBe(false)
    // approval (maxValue 1, repeatable)
    expect(
      multichoiceReservesAbstain({ voteType: vt({ maxCount: 3, maxValue: 1, uniqueChoices: false }), questions: question(3) })
    ).toBe(false)
    // budget (maxValue 0)
    expect(multichoiceReservesAbstain({ voteType: vt({ maxCount: 3, maxValue: 0, costExponent: 1 }), questions: question(3) })).toBe(false)
  })

  it('repeatable multichoice: reserves abstain iff maxValue >= numChoices', () => {
    // numChoices 3, uniqueChoices false → needed = 3 - 1 + 1 = 3
    expect(multichoiceReservesAbstain({ voteType: vt({ maxCount: 3, maxValue: 3, uniqueChoices: false }), questions: question(3) })).toBe(true)
    expect(multichoiceReservesAbstain({ voteType: vt({ maxCount: 3, maxValue: 2, uniqueChoices: false }), questions: question(3) })).toBe(false)
  })

  it('unique multichoice: reserves abstain iff maxValue >= numChoices - 1 + maxCount', () => {
    // numChoices 3, uniqueChoices true, maxCount 3 → needed = 3 - 1 + 3 = 5
    expect(multichoiceReservesAbstain({ voteType: vt({ maxCount: 3, maxValue: 5, uniqueChoices: true }), questions: question(3) })).toBe(true)
    expect(multichoiceReservesAbstain({ voteType: vt({ maxCount: 3, maxValue: 4, uniqueChoices: true }), questions: question(3) })).toBe(false)
  })
})

describe('questionSelectionRange', () => {
  const bp = (overrides: Record<string, number | boolean> = {}) => ({
    maxCount: 1,
    maxValue: 1,
    maxVoteOverwrites: 0,
    maxTotalCost: 0,
    costExponent: 1,
    uniqueValues: false,
    costFromWeight: false,
    ...overrides,
  })
  const choices = Array.from({ length: 3 }, (_, j) => ({ title: { default: `C${j}` }, value: j }))

  it('dense multichoice: max is maxTotalCost, min defaults to 1', () => {
    // Backend derivation for the named type: maxCount = numChoices, maxValue = 1,
    // maxTotalCost = maxChoices. maxCount is NOT the pick bound here.
    const dense = bp({ maxCount: 3, maxValue: 1, maxTotalCost: 2, uniqueValues: false })
    expect(questionSelectionRange({ ballotProtocol: dense, type: 'multichoice', choices })).toEqual({
      min: 1,
      max: 2,
    })
  })

  it('dense multichoice: min comes from typeSetup.minChoices when present', () => {
    const dense = bp({ maxCount: 3, maxValue: 1, maxTotalCost: 3, uniqueValues: false })
    expect(
      questionSelectionRange({
        ballotProtocol: dense,
        type: 'multichoice',
        typeSetup: { maxChoices: 3, minChoices: 2, uniqueChoices: false },
        choices,
      })
    ).toEqual({ min: 2, max: 3 })
  })

  it('dense multichoice: works without a ballotProtocol (typeSetup bounds)', () => {
    // Public reads of named-type questions may omit the derived protocol.
    expect(
      questionSelectionRange({
        type: 'multichoice',
        typeSetup: { maxChoices: 2, minChoices: 1, uniqueChoices: false },
        choices,
      })
    ).toEqual({ min: 1, max: 2 })
    expect(questionSelectionRange({ type: 'multichoice', choices })).toEqual({ min: 1, max: 3 })
  })

  it('dense multichoice: falls back to numChoices when maxTotalCost is 0', () => {
    const dense = bp({ maxCount: 3, maxValue: 1, maxTotalCost: 0 })
    expect(questionSelectionRange({ ballotProtocol: dense, type: 'multichoice', choices })).toEqual({
      min: 1,
      max: 3,
    })
  })

  it('pick-slot multichoice: max is maxCount, min follows minChoices', () => {
    // maxCount is the pick bound. A partial selection is always encodable now (padded with
    // sentinels when the protocol reserves headroom, returned short otherwise), so min
    // follows typeSetup.minChoices rather than forcing a full maxCount slate.
    const withHeadroom = bp({ maxCount: 3, maxValue: 5, uniqueValues: true })
    expect(questionSelectionRange({ ballotProtocol: withHeadroom, choices })).toEqual({ min: 1, max: 3 })
    const noHeadroom = bp({ maxCount: 3, maxValue: 2, uniqueValues: false })
    expect(questionSelectionRange({ ballotProtocol: noHeadroom, choices })).toEqual({ min: 1, max: 3 })
    expect(
      questionSelectionRange({
        ballotProtocol: noHeadroom,
        typeSetup: { maxChoices: 3, minChoices: 2, uniqueChoices: false },
        choices,
      })
    ).toEqual({ min: 2, max: 3 })
  })

  it('pick-slot multichoice: minChoices 0 is honoured only with abstain headroom', () => {
    // Verified against a live vochain: an empty selection relays fine either way, but only a
    // headroom protocol can RECORD it. With headroom, `[]` encodes to abstain sentinels that
    // land in the abstain bucket; without, `[]` encodes to `[]` — accepted, voteCount bumped,
    // but touching no column, so the tally cannot distinguish it from not voting. Offering an
    // empty submission there would let a voter cast something that silently does not count.
    const zero = { maxChoices: 3, minChoices: 0, uniqueChoices: true }

    const withHeadroom = bp({ maxCount: 3, maxValue: 5, uniqueValues: true })
    expect(questionReservesAbstain({ ballotProtocol: withHeadroom, choices })).toBe(true)
    expect(
      questionSelectionRange({ ballotProtocol: withHeadroom, typeSetup: zero, choices })
    ).toEqual({ min: 0, max: 3 })

    const noHeadroom = bp({ maxCount: 3, maxValue: 2, uniqueValues: true })
    expect(questionReservesAbstain({ ballotProtocol: noHeadroom, choices })).toBe(false)
    expect(
      questionSelectionRange({ ballotProtocol: noHeadroom, typeSetup: zero, choices })
    ).toEqual({ min: 1, max: 3 })

    // Headroom alone does not drop the floor — minChoices must actually say 0.
    expect(questionSelectionRange({ ballotProtocol: withHeadroom, choices })).toEqual({
      min: 1,
      max: 3,
    })
  })

  it('single-choice: exactly one', () => {
    expect(questionSelectionRange({ ballotProtocol: bp({ maxCount: 1, maxValue: 2 }), choices })).toEqual({
      min: 1,
      max: 1,
    })
  })
})

describe('isAbstainVisible', () => {
  const bp = (overrides: Partial<BallotProtocol> = {}): BallotProtocol => ({
    maxCount: 3,
    maxValue: 1,
    maxVoteOverwrites: 0,
    maxTotalCost: 0,
    costExponent: 1,
    uniqueValues: false,
    costFromWeight: false,
    ...overrides,
  })
  const choices = Array.from({ length: 3 }, (_, j) => ({ title: { default: `C${j}` }, value: j }))

  it('shows the abstain row at zero when the question reserves headroom', () => {
    // Repeatable multichoice with maxValue 3 over 3 choices reserves sentinel headroom.
    const withHeadroom = { ballotProtocol: bp({ maxCount: 3, maxValue: 3 }), choices }
    expect(questionReservesAbstain(withHeadroom)).toBe(true)
    expect(isAbstainVisible(withHeadroom, 0)).toBe(true)
  })

  it('hides the abstain row at zero when the question has no headroom', () => {
    const noHeadroom = { ballotProtocol: bp({ maxCount: 3, maxValue: 2, uniqueValues: true }), choices }
    expect(questionReservesAbstain(noHeadroom)).toBe(false)
    expect(isAbstainVisible(noHeadroom, 0)).toBe(false)
  })

  it('shows the abstain row without headroom once someone abstained', () => {
    const noHeadroom = { ballotProtocol: bp({ maxCount: 3, maxValue: 2, uniqueValues: true }), choices }
    expect(isAbstainVisible(noHeadroom, 2)).toBe(true)
  })

  it('does not throw on an un-inferable question: shows the row only with votes', () => {
    const unknown = { choices }
    expect(isAbstainVisible(unknown, 0)).toBe(false)
    expect(isAbstainVisible(unknown, 1)).toBe(true)
  })
})

import { describe, it, expect } from 'vitest'
import type { BallotProtocol, Choice } from '@vocdoni/api-types'
import { castVotingPower } from './power'

const choices = (n: number): Choice[] =>
  Array.from({ length: n }, (_, j) => ({ title: { default: `C${j}` }, value: j }))

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

describe('castVotingPower', () => {
  it('single-choice: the single row sums the weight of every ballot', () => {
    // Weighted voters: 5 + 3 chose choice 0, 7 chose choice 1.
    const question = { ballotProtocol: bp({ maxCount: 1, maxValue: 2 }), choices: choices(3) }
    expect(castVotingPower(question, [['8', '7', '0']])).toBe(15)
  })

  it('approval: each [notSelected, selected] row sums to the total weight, not the selected part', () => {
    // Ballot A (weight 10) picks options 0 and 2; ballot B (weight 5) picks option 2.
    // Option rows are [notSelected, selected], so every row sums to 15.
    const question = { ballotProtocol: bp({ maxCount: 3, maxValue: 1 }), choices: choices(3) }
    const results = [
      ['5', '10'],
      ['15', '0'],
      ['0', '15'],
    ]
    expect(castVotingPower(question, results)).toBe(15)
  })

  it('dense multichoice: uses the notSelected column that decoding drops', () => {
    const question = {
      ballotProtocol: bp({ maxCount: 3, maxValue: 1, maxTotalCost: 2 }),
      type: 'multichoice',
      choices: choices(3),
    }
    // One ballot of weight 4 picks option 1; every row sums to 4 via its notSelected or selected cell.
    const results = [
      ['4', '0'],
      ['0', '4'],
      ['4', '0'],
    ]
    expect(castVotingPower(question, results)).toBe(4)
  })

  it('pick-slot multichoice: padded sentinel columns count toward each slot row', () => {
    // 2 slots over 3 choices, sentinels at values 3 and 4. Two ballots of weights 6 and 5.
    const question = {
      ballotProtocol: bp({ maxCount: 2, maxValue: 4, uniqueValues: true }),
      type: 'multichoice',
      choices: choices(3),
    }
    const results = [
      ['6', '0', '5', '0', '0'],
      ['0', '5', '6', '0', '0'],
    ]
    expect(castVotingPower(question, results)).toBe(11)
  })

  it('pick-slot multichoice: a short ballot yields the largest slot row', () => {
    // Slot 0 was written by weights 6 and 5, slot 1 only by weight 2 (unpadded).
    const question = {
      ballotProtocol: bp({ maxCount: 2, maxValue: 2, uniqueValues: true }),
      type: 'multichoice',
      choices: choices(3),
    }
    expect(castVotingPower(question, [['6', '5', '0'], ['2']])).toBe(11)
  })

  it('uneven rows: takes the max row sum across rows of different lengths', () => {
    const question = { ballotProtocol: bp({ maxCount: 2, maxValue: 2 }), choices: choices(2) }
    expect(castVotingPower(question, [['1', '2'], ['3', '4', '5']])).toBe(12)
  })

  it('treats empty and non-numeric cells as 0', () => {
    const question = { ballotProtocol: bp({ maxCount: 1, maxValue: 2 }), choices: choices(3) }
    expect(castVotingPower(question, [['', '4', ' '], ['2', '', 'x']])).toBe(4)
  })

  it('sums exactly above 2^53', () => {
    const question = { ballotProtocol: bp({ maxCount: 1, maxValue: 2 }), choices: choices(2) }
    const results = [['9007199254740993', '1']]
    expect(castVotingPower(question, results)).toBe(Number(9007199254740994n))
  })

  it('budget: returns null because value × weight is not recoverable', () => {
    const question = {
      ballotProtocol: bp({ maxCount: 3, maxValue: 0, maxTotalCost: 10, costExponent: 1 }),
      choices: choices(3),
    }
    expect(castVotingPower(question, [['30'], ['20'], ['0']])).toBeNull()
  })

  it('quadratic: returns null because value × weight is not recoverable', () => {
    const question = {
      ballotProtocol: bp({ maxCount: 3, maxValue: 0, maxTotalCost: 10, costExponent: 2 }),
      choices: choices(3),
    }
    expect(castVotingPower(question, [['30'], ['20'], ['0']])).toBeNull()
  })

  it('null, undefined and empty results return null', () => {
    const question = { ballotProtocol: bp({ maxCount: 1, maxValue: 2 }), choices: choices(3) }
    expect(castVotingPower(question, null)).toBeNull()
    expect(castVotingPower(question, undefined)).toBeNull()
    expect(castVotingPower(question, [])).toBeNull()
  })

  it('undeterminable ballot type returns null', () => {
    expect(castVotingPower({ choices: choices(3) }, [['1', '2']])).toBeNull()
  })

  it('ranked: every option row sums to the total weight', () => {
    // Ballot A (weight 10) ranks options 0, 1, 2 as 2, 1, 0; ballot B (weight 5) as 0, 2, 1.
    // results[option][rank], so each option row sums to 15.
    const question = {
      ballotProtocol: bp({ maxCount: 3, maxValue: 2, uniqueValues: true }),
      metadata: { type: { name: 'ranked' } },
      choices: choices(3),
    }
    const results = [
      ['5', '0', '10'],
      ['0', '10', '5'],
      ['10', '5', '0'],
    ]
    expect(castVotingPower(question, results)).toBe(15)
  })

  it('name-only budget-based and quadratic questions return null', () => {
    for (const name of ['budget-based', 'quadratic']) {
      const question = { metadata: { type: { name } }, choices: choices(3) }
      expect(castVotingPower(question, [['30'], ['20'], ['0']])).toBeNull()
    }
  })

  it('maxValue 0 with a conflicting singlechoice type returns null', () => {
    const question = {
      ballotProtocol: bp({ maxCount: 3, maxValue: 0, costExponent: 1 }),
      type: 'singlechoice',
      choices: choices(3),
    }
    expect(castVotingPower(question, [['30'], ['20'], ['0']])).toBeNull()
  })
})

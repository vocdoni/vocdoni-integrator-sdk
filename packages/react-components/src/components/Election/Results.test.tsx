import type { QuestionStatus, VotingProcessResultsResponse } from '@vocdoni/api-types'
import { describe, expect, it, vi } from 'vitest'
import { makeProcess, makeResults, renderWithComponents } from '../../test-utils'

const state = vi.hoisted(() => ({
  election: null as ReturnType<typeof makeProcess> | null,
  status: null as QuestionStatus | null,
  results: null as VotingProcessResultsResponse | null,
}))
vi.mock('@vocdoni/react-providers', () => ({ useElection: () => state }))

import { ElectionResults } from './Results'

// Capture the props the slot receives so we can assert on the computed results.
let captured: any
const Slot = (props: any) => {
  captured = props
  return null
}
const slots = { components: { ElectionResults: Slot } }

const question = {
  title: 'Q1',
  choices: [
    { title: 'A', value: 0 },
    { title: 'B', value: 1 },
  ],
}

describe('ElectionResults', () => {
  it('defaults a missing choice result to zero votes', () => {
    state.election = makeProcess({ questions: [question] })
    state.status = 'RESULTS'
    state.results = makeResults([{ results: [['5']] }])
    renderWithComponents(<ElectionResults />, slots)

    const choices = captured.questions[0].choices
    expect(choices[0].votes).toBe('5')
    expect(choices[1].votes).toBe('0')
    expect(choices[0].percent).toBe('100.0%')
    expect(choices[1].percent).toBe('0.0%')
  })

  it('decodes multichoice results by column-sum and appends a unified abstain row', () => {
    const multichoice = {
      title: 'Q1',
      choices: [
        { title: 'A', value: 0 },
        { title: 'B', value: 1 },
        { title: 'C', value: 2 },
      ],
    }
    state.election = makeProcess({
      questions: [multichoice],
      voteType: { maxCount: 3, maxValue: 3, uniqueChoices: false },
    })
    state.status = 'RESULTS'
    // 3 pick-slots; each real choice picked once, the rest abstained (column 3).
    state.results = makeResults([{
      results: [
        ['1', '0', '0', '2'],
        ['0', '1', '0', '2'],
        ['0', '0', '1', '2'],
      ],
    }])
    renderWithComponents(<ElectionResults />, slots)

    const choices = captured.questions[0].choices
    // 3 real choices (column-summed to 1 each) + 1 unified abstain row (2+2+2 = 6)
    expect(choices.map((c: any) => c.votes)).toEqual(['1', '1', '1', '6'])
    expect(choices[3].title).toBe('Abstain')
    // percentages share the question total (9): abstain = 6/9
    expect(choices[3].percent).toBe('66.7%')
  })

  // Abstain is only recordable when the protocol reserves sentinel headroom
  // (maxValue >= numChoices - 1 + (uniqueValues ? maxCount : 1)). The decoder emits
  // the bucket regardless, so the render layer is what decides to show it — and both
  // multichoice wire layouts (dense and pick-slot) must reach the same verdict.
  const fourChoices = [
    { title: 'A', value: 0 },
    { title: 'B', value: 1 },
    { title: 'C', value: 2 },
    { title: 'D', value: 3 },
  ]
  const threeChoices = [
    { title: 'A', value: 0 },
    { title: 'B', value: 1 },
    { title: 'C', value: 2 },
  ]

  it('hides the abstain row when the protocol reserves no headroom for it', () => {
    // Dev election 6be21a5a…7a020800000000: pick-slot, 4 choices, uniqueValues.
    // Abstain needs maxValue >= 4-1+4 = 7 but the protocol has 3, so the rows are
    // 4 wide (values 0..3) and no column index >= 4 exists — the chain has nowhere
    // to record an abstention, and its metadata says so ("canAbstain": false).
    state.election = makeProcess({
      questions: [{ title: 'Q1', choices: fourChoices }],
      voteType: { maxCount: 4, maxValue: 3, uniqueChoices: true },
    })
    state.status = 'RESULTS'
    state.results = makeResults([{
      results: [
        ['1', '1', '0', '0'],
        ['0', '1', '1', '0'],
        ['0', '0', '1', '0'],
        ['0', '0', '0', '1'],
      ],
    }])
    renderWithComponents(<ElectionResults />, slots)

    const choices = captured.questions[0].choices
    expect(choices.map((c: any) => c.title)).toEqual(['A', 'B', 'C', 'D'])
    expect(choices.map((c: any) => c.votes)).toEqual(['1', '2', '2', '1'])
    // Nothing is hidden from the denominator: the shown shares still total 100%.
    expect(choices.map((c: any) => c.percent)).toEqual(['16.7%', '33.3%', '33.3%', '16.7%'])
  })

  it('hides the abstain row on the dense layout too, matching the pick-slot verdict', () => {
    // Dev election 6be21a5a…303000000000a: the same question as a named multichoice
    // on the dense wire layout — one [notSelected, selected] row per choice. The
    // decoder reads it as approval and emits no abstain bucket at all, so this pins
    // the two layouts to the same outcome.
    state.election = makeProcess({
      questions: [{ title: 'Q1', choices: fourChoices, type: 'multichoice' }],
      voteType: { maxCount: 4, maxValue: 1, maxTotalCost: 4, uniqueChoices: false },
    })
    state.status = 'RESULTS'
    state.results = makeResults([{
      results: [
        ['1', '3'],
        ['0', '4'],
        ['0', '4'],
        ['1', '3'],
      ],
    }])
    renderWithComponents(<ElectionResults />, slots)

    const choices = captured.questions[0].choices
    expect(choices.map((c: any) => c.title)).toEqual(['A', 'B', 'C', 'D'])
    expect(choices.map((c: any) => c.votes)).toEqual(['3', '4', '4', '3'])
  })

  it('shows a zero abstain row when the protocol reserves headroom', () => {
    // 3 choices, uniqueValues, maxCount 3 → abstain needs maxValue >= 3-1+3 = 5, and
    // the protocol has exactly that. Nobody abstained, but that zero is a real
    // measurement, so the row stays: the gate is possibility, not votes > 0.
    state.election = makeProcess({
      questions: [{ title: 'Q1', choices: threeChoices }],
      voteType: { maxCount: 3, maxValue: 5, uniqueChoices: true },
    })
    state.status = 'RESULTS'
    state.results = makeResults([{
      results: [
        ['2', '0', '0', '0', '0', '0'],
        ['0', '2', '0', '0', '0', '0'],
        ['0', '0', '2', '0', '0', '0'],
      ],
    }])
    renderWithComponents(<ElectionResults />, slots)

    const choices = captured.questions[0].choices
    expect(choices).toHaveLength(4)
    expect(choices[3].title).toBe('Abstain')
    expect(choices[3].votes).toBe('0')
  })

  it('keeps a non-zero abstain row even when the protocol reserves no headroom', () => {
    // Partial headroom: 3 choices, uniqueValues, maxCount 3 needs maxValue >= 5, so
    // this protocol (4) does not reserve abstain — yet columns 3 and 4 exist and hold
    // real selections. Hiding them would drop a measurement and leave the visible
    // percentages summing to under 100%, since the decoder keeps abstain in the
    // denominator. Reachable via a raw ballotProtocol rather than the legacy SDK.
    state.election = makeProcess({
      questions: [{ title: 'Q1', choices: threeChoices }],
      voteType: { maxCount: 3, maxValue: 4, uniqueChoices: true },
    })
    state.status = 'RESULTS'
    state.results = makeResults([{
      results: [
        ['1', '0', '0', '1', '0'],
        ['0', '1', '0', '0', '1'],
        ['0', '0', '1', '1', '0'],
      ],
    }])
    renderWithComponents(<ElectionResults />, slots)

    const choices = captured.questions[0].choices
    expect(choices).toHaveLength(4)
    expect(choices[3].title).toBe('Abstain')
    expect(choices[3].votes).toBe('3')
    expect(choices[3].percent).toBe('50.0%')
  })

  it('matches results to questions by questionId, not array position', () => {
    const q2 = {
      title: 'Q2',
      choices: [
        { title: 'C', value: 0 },
        { title: 'D', value: 1 },
      ],
    }
    state.election = makeProcess({ questions: [question, q2] })
    state.status = 'RESULTS'
    // Results arrive reversed: q-1 first, q-0 second.
    state.results = makeResults([
      { questionId: 'q-1', results: [['7', '0']] },
      { questionId: 'q-0', results: [['0', '9']] },
    ])
    renderWithComponents(<ElectionResults />, slots)

    expect(captured.questions[0].choices.map((c: any) => c.votes)).toEqual(['0', '9'])
    expect(captured.questions[1].choices.map((c: any) => c.votes)).toEqual(['7', '0'])
  })

  it('renders zero votes for a question missing from the results response', () => {
    const q2 = {
      title: 'Q2',
      choices: [
        { title: 'C', value: 0 },
        { title: 'D', value: 1 },
      ],
    }
    state.election = makeProcess({ questions: [question, q2] })
    state.status = 'RESULTS'
    // Only the second question has results (e.g. the first is not yet published).
    state.results = makeResults([{ questionId: 'q-1', results: [['3', '4']] }])
    renderWithComponents(<ElectionResults />, slots)

    expect(captured.questions[0].choices.map((c: any) => c.votes)).toEqual(['0', '0'])
    expect(captured.questions[1].choices.map((c: any) => c.votes)).toEqual(['3', '4'])
  })

  it('renders nothing for a canceled election', () => {
    state.election = makeProcess({ questions: [question] })
    state.status = 'CANCELED'
    state.results = null
    const { container } = renderWithComponents(<ElectionResults />, slots)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the secret-until-the-end placeholder before final results', () => {
    captured = undefined
    state.election = makeProcess({
      electionType: { secretUntilTheEnd: true },
      questions: [question],
    })
    state.status = 'ONGOING'
    state.results = makeResults([{ finalResults: false }])
    renderWithComponents(<ElectionResults />, slots)

    expect(captured.secretText).toContain('Secret until the end')
    expect(captured.questions).toBeUndefined()
  })

  it('shows the real end in the secret placeholder for an early-ended election', () => {
    captured = undefined
    state.election = makeProcess({
      electionType: { secretUntilTheEnd: true },
      questions: [question],
      endDate: '2020-12-31T12:00:00Z',
      endedAt: '2020-02-01T12:00:00Z',
    })
    state.status = 'ENDED'
    state.results = makeResults([{ finalResults: false }])
    renderWithComponents(<ElectionResults />, slots)

    expect(captured.secretText).toContain('1-2-2020')
    expect(captured.secretText).not.toContain('31-12-2020')
  })

  it('uses the secret question endedAt when another question keeps the process open', () => {
    captured = undefined
    state.election = makeProcess({
      questions: [
        { ...question, secretUntilTheEnd: true, endedAt: '2020-02-01T12:00:00Z' },
        { ...question, secretUntilTheEnd: false },
      ],
      endDate: '2020-12-31T12:00:00Z',
    })
    state.status = 'ONGOING'
    state.results = makeResults([{ finalResults: false }])
    renderWithComponents(<ElectionResults />, slots)

    expect(captured.secretText).toContain('1-2-2020')
  })

  it('forceRender overrides the secret placeholder', () => {
    state.election = makeProcess({
      electionType: { secretUntilTheEnd: true },
      questions: [question],
    })
    state.status = 'ONGOING'
    state.results = makeResults([{ finalResults: false, results: [['1', '2']] }])
    renderWithComponents(<ElectionResults forceRender />, slots)
    expect(captured.questions[0].choices).toHaveLength(2)
  })
})

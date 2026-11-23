import { describe, expect, it, vi } from 'vitest'
import { makeProcess, renderWithComponents } from '../../../test-utils'

vi.mock('../../../confirm/useConfirm', () => ({
  useConfirm: () => ({ proceed: vi.fn(), cancel: vi.fn() }),
}))

import { QuestionsConfirmation } from './Confirmation'

let captured: any
const slots = {
  components: {
    QuestionsConfirmation: (props: any) => {
      captured = props
      return null
    },
  },
}

function renderConfirmation(
  election: ReturnType<typeof makeProcess>,
  answers: Record<string, unknown>,
  skip?: number[],
) {
  captured = undefined
  renderWithComponents(<QuestionsConfirmation election={election} answers={answers} skip={skip} />, slots)
  return captured.answersView
}

describe('QuestionsConfirmation answersView', () => {
  it('single-choice: resolves the picked value by value, not position', () => {
    // Non-sequential values: 'Yes' is value 5 but the 2nd choice — a positional
    // lookup would resolve the wrong (or no) choice.
    const question = { title: 'Q', choices: [{ title: 'No', value: 0 }, { title: 'Yes', value: 5 }] }
    const view = renderConfirmation(makeProcess({ questions: [question] }), { '0': '5' })
    expect(view[0].answers).toEqual(['Yes'])
  })

  it('multi-question single-choice: reads each question by its own index', () => {
    const q0 = { title: 'Q1', choices: [{ title: 'A', value: 0 }, { title: 'B', value: 1 }] }
    const q1 = { title: 'Q2', choices: [{ title: 'C', value: 0 }, { title: 'D', value: 1 }] }
    const view = renderConfirmation(makeProcess({ questions: [q0, q1] }), { '0': '1', '1': '0' })
    expect(view[0].answers).toEqual(['B'])
    expect(view[1].answers).toEqual(['C'])
  })

  it('approval/multichoice: resolves each selected value by value', () => {
    const question = {
      title: 'Q',
      choices: [{ title: 'A', value: 0 }, { title: 'B', value: 2 }, { title: 'C', value: 4 }],
    }
    // Selecting values 4 and 0 must map to C and A — the old positional code read
    // question.choices[4] (undefined) and wrongly showed abstain.
    const view = renderConfirmation(
      makeProcess({ questions: [question], voteType: { maxCount: 3, maxValue: 1 } }),
      { '0': ['4', '0'] },
    )
    expect(view[0].answers).toEqual(['C', 'A'])
  })

  it('multichoice: a value with no matching choice shows as abstain', () => {
    const question = { title: 'Q', choices: [{ title: 'A', value: 0 }, { title: 'B', value: 1 }] }
    const view = renderConfirmation(
      makeProcess({ questions: [question], voteType: { maxCount: 3, maxValue: 4 } }),
      { '0': ['0', '9'] },
    )
    expect(view[0].answers).toEqual(['A', 'Abstain'])
  })

  it('leaves out the skipped (locked) questions', () => {
    const q0 = { title: 'Q1', choices: [{ title: 'A', value: 0 }, { title: 'B', value: 1 }] }
    const q1 = { title: 'Q2', choices: [{ title: 'C', value: 0 }, { title: 'D', value: 1 }] }
    const view = renderConfirmation(makeProcess({ questions: [q0, q1] }), { '0': '', '1': '1' }, [0])
    expect(view).toEqual([{ question: 'Q2', answers: ['D'] }])
  })
})

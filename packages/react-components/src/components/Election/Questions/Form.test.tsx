import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { makeProcess } from '../../../test-utils'

// Election + a spy vote() come from the (mocked) providers; confirm() is forced true.
const state = vi.hoisted(() => ({
  election: null as ReturnType<typeof makeProcess> | null,
  vote: vi.fn(),
  confirmResult: true,
}))
vi.mock('@vocdoni/react-providers', () => ({
  useElection: () => ({ election: state.election, vote: state.vote }),
}))
vi.mock('../../../confirm/useConfirm', () => ({
  useConfirm: () => ({ confirm: () => Promise.resolve(state.confirmResult) }),
}))

import { I18nextProvider } from 'react-i18next'
import { lockedQuestionNotice, QuestionsFormProvider, useQuestionsForm } from './Form'
import { ComponentsProvider } from '../../context/ComponentsProvider'
import { createTestI18n } from '../../../i18n/test-i18n'

// ComponentsProvider is needed because QuestionsFormProvider auto-mounts a
// ConfirmProvider, whose modal renders through the ConfirmShell slot.
// Real i18n resources, so an assertion on a rendered message reads the English string
// a voter would actually see rather than the bare key.
const testI18n = createTestI18n()

const wrapper = ({ children }: { children: ReactNode }) => (
  <I18nextProvider i18n={testI18n}>
    <ComponentsProvider>
      <QuestionsFormProvider>{children}</QuestionsFormProvider>
    </ComponentsProvider>
  </I18nextProvider>
)

function setup(election: ReturnType<typeof makeProcess> | null, confirmResult = true) {
  state.election = election
  state.vote = vi.fn().mockResolvedValue('vote-id')
  state.confirmResult = confirmResult
  return renderHook(useQuestionsForm, { wrapper })
}

const twoQuestions = [
  { title: 'Q1', choices: [{ title: 'A', value: 0 }, { title: 'B', value: 1 }] },
  { title: 'Q2', choices: [{ title: 'A', value: 0 }, { title: 'B', value: 1 }] },
]

const threeChoices = [
  { title: 'Q1', choices: [{ title: 'A', value: 0 }, { title: 'B', value: 1 }, { title: 'C', value: 2 }] },
]

const fourChoices = [
  {
    title: 'Q1',
    choices: [
      { title: 'A', value: 0 },
      { title: 'B', value: 1 },
      { title: 'C', value: 2 },
      { title: 'D', value: 3 },
    ],
  },
]

// The payloads below go through @vocdoni/ballot's encodeQuestionBallot, so the expected
// vectors are the real on-chain encodings. vote() now receives number[][] — one encoded
// ballot array per question.
describe('QuestionsFormProvider vote payload', () => {
  it('single choice: one chosen value per question', async () => {
    const { result } = setup(makeProcess({ questions: twoQuestions }))
    await result.current.vote({ '0': '1', '1': '0' })
    expect(state.vote).toHaveBeenCalledWith([[1], [0]])
  })

  it('approval: dense 0/1 vector over all choices (not an index list)', async () => {
    const { result } = setup(
      makeProcess({ questions: threeChoices, voteType: { maxCount: 3, maxValue: 1 } }),
    )
    // Approve A and C → [1,0,1]. The old code wrongly emitted the index list [0,2].
    await result.current.vote({ '0': ['0', '2'] })
    expect(state.vote).toHaveBeenCalledWith([[1, 0, 1]])
  })

  it('multichoice (fully filled): the picked values, in pick order', async () => {
    const { result } = setup(
      makeProcess({ questions: threeChoices, voteType: { maxCount: 3, maxValue: 2, uniqueChoices: true } }),
    )
    await result.current.vote({ '0': ['2', '0', '1'] })
    expect(state.vote).toHaveBeenCalledWith([[2, 0, 1]])
  })

  it('multichoice (abstain): unfilled slots padded with the abstain sentinel', async () => {
    const { result } = setup(
      makeProcess({ questions: fourChoices, voteType: { maxCount: 3, maxValue: 4 } }),
    )
    // One real pick for a 3-slot ballot → [1,4,4] (value 4 is the abstain sentinel).
    await result.current.vote({ '0': ['1'] })
    expect(state.vote).toHaveBeenCalledWith([[1, 4, 4]])
  })

  it('threads reserved memo.{index} fields through as per-question memos', async () => {
    const { result } = setup(makeProcess({ questions: twoQuestions }))
    // Only question 0 carries a memo; empty strings are dropped, not sent.
    await result.current.vote({ '0': '1', '1': '0', memo: { '0': 'Other: neither', '1': '' } })
    expect(state.vote).toHaveBeenCalledWith([[1], [0]], ['Other: neither', undefined])
  })

  it('does not vote when the confirmation is declined', async () => {
    const { result } = setup(makeProcess({ questions: twoQuestions }), false)
    const out = await result.current.vote({ '0': '1', '1': '0' })
    expect(out).toBe(false)
    expect(state.vote).not.toHaveBeenCalled()
  })

  it('returns false when there is no election', async () => {
    const { result } = setup(null)
    await waitFor(() => expect(result.current).toBeDefined())
    expect(await result.current.vote({ '0': '0' })).toBe(false)
    expect(state.vote).not.toHaveBeenCalled()
  })

  describe('a question that publishes an option nobody can cast', () => {
    // integrator-sdk#28: values 1/2/3 under maxValue 2, so C3 addresses a column the
    // chain refuses. Confirmed live — the relay takes such a ballot, voteCount counts
    // it, and the tally drops it, so encode refuses rather than let it be cast.
    const oneIndexed = [
      {
        title: 'Q1',
        choices: [
          { title: 'C1', value: 1 },
          { title: 'C2', value: 2 },
          { title: 'C3', value: 3 },
        ],
        ballotProtocol: { maxCount: 1, maxValue: 2 },
      },
    ]

    it('shows the voter a message they can act on, not the encoder’s wire-level prose', async () => {
      const { result } = setup(makeProcess({ questions: oneIndexed }))
      expect(await result.current.vote({ '0': '3' })).toBe(false)
      expect(state.vote).not.toHaveBeenCalled()

      await waitFor(() => expect(result.current.fmethods.formState.errors['0']).toBeDefined())
      const message = result.current.fmethods.formState.errors['0']?.message
      // The defect belongs to whoever created the election and cannot be fixed after
      // publish, so the voter gets told what happened to their vote — not an
      // instruction to raise maxValue, which is not theirs to raise.
      expect(message).toBe(
        "This question can't accept votes: one of its options was set up in a way the ledger can't record. " +
          'Your vote has not been cast. Please contact the organizer.',
      )
      expect(message).not.toMatch(/maxValue|voteCount|scrutinizer/)
    })

    it('still lets the other voters cast, because their ballots are recorded correctly', async () => {
      const { result } = setup(makeProcess({ questions: oneIndexed }))
      await result.current.vote({ '0': '1' })
      expect(state.vote).toHaveBeenCalledWith([[1]])
    })
  })
})

describe('lockedQuestionNotice', () => {
  it('locks an open process question whose status is not open', () => {
    expect(lockedQuestionNotice('q-1', undefined, undefined, { questionStatus: 'PAUSED', processStatus: 'ONGOING' })).toBe(
      'vote.disabled.question_not_open',
    )
  })

  it('reads a raw wire READY as open', () => {
    const open = { questionStatus: 'READY', processStatus: 'ONGOING' }
    expect(lockedQuestionNotice('q-0', undefined, undefined, open)).toBeUndefined()
    expect(lockedQuestionNotice('q-0', undefined, undefined, { ...open, processStatus: 'PROCESS_UNKNOWN' })).toBeUndefined()
  })

  it('does not lock by status when the question carries no status', () => {
    expect(lockedQuestionNotice('q-0', undefined, undefined, { processStatus: 'ONGOING' })).toBeUndefined()
    expect(lockedQuestionNotice('q-0', undefined, undefined, { processStatus: 'PROCESS_UNKNOWN' })).toBeUndefined()
  })
})

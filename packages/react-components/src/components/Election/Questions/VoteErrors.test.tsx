import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { makeProcess, renderWithComponents } from '../../../test-utils'

const state = vi.hoisted(() => ({
  election: null as ReturnType<typeof makeProcess> | null,
  vote: vi.fn(),
  confirmResult: true,
}))
vi.mock('@vocdoni/react-providers', () => ({
  useElection: () => ({
    election: state.election,
    vote: state.vote,
    status: 'ONGOING',
    hasVoted: false,
    isAbleToVote: true,
    voteIds: {},
  }),
}))
vi.mock('../../../confirm/useConfirm', () => ({
  useConfirm: () => ({ confirm: () => Promise.resolve(state.confirmResult) }),
}))

import { ElectionQuestions } from './Questions'

const oneQuestion = [{ title: 'Q1', choices: [{ title: 'A', value: 0 }, { title: 'B', value: 1 }] }]
const twoQuestions = [
  { title: 'Q1', choices: [{ title: 'A', value: 0 }, { title: 'B', value: 1 }] },
  { title: 'Q2', choices: [{ title: 'C', value: 0 }, { title: 'D', value: 1 }] },
]

/** A PartialVoteError as `useElection().vote()` throws it, matched by name. */
const partialVoteError = (
  succeeded: Array<{ questionId: string }>,
  failed: Array<{ questionId: string; error: unknown }>,
) => {
  const error = new Error('Vote partially failed') as Error & Record<string, unknown>
  error.name = 'PartialVoteError'
  error.succeeded = succeeded
  error.failed = failed
  return error
}

function render(questions = oneQuestion) {
  state.election = makeProcess({ questions })
  state.confirmResult = true
  return renderWithComponents(<ElectionQuestions />)
}

/** Answers every question, then submits. */
function submit(container: HTMLElement, answers = ['A']) {
  for (const answer of answers) fireEvent.click(screen.getByLabelText(answer))
  fireEvent.submit(container.querySelector('form')!)
}

// The chain's own words for a vote cast before the process opens — the failure
// behind integrator-sdk#53. The backend relays each envelope's error verbatim,
// so this is the string that reaches the SDK.
const NOT_STARTED =
  'process 0abc starts at time 2026-09-29 09:00:00 +0000 UTC, current time is 2026-09-15 12:00:00 +0000 UTC'

describe('a failed vote is reported to the voter', () => {
  it('renders the reason the chain refused the vote', async () => {
    // Before the fix this rejection escaped handleSubmit with nobody awaiting
    // it: the page stayed on the form, showed nothing, and the voter believed
    // the vote was cast.
    state.vote = vi.fn().mockRejectedValue(new Error(NOT_STARTED))
    const { container } = render()
    submit(container)

    await waitFor(() => expect(state.vote).toHaveBeenCalled())
    const message = await screen.findByText(/could not be cast/)
    expect(message).toHaveTextContent('Your vote could not be cast')
    // The chain's reason survives: it is the only account of why it failed.
    expect(message).toHaveTextContent(NOT_STARTED)
  })

  it('marks the message as a form-level error, not a field one', async () => {
    state.vote = vi.fn().mockRejectedValue(new Error(NOT_STARTED))
    const { container } = render()
    submit(container)

    const message = await screen.findByText(/could not be cast/)
    expect(message).toHaveAttribute('data-variant', 'form')
  })

  it('falls back to a plain message when the failure carries no reason', async () => {
    state.vote = vi.fn().mockRejectedValue(new Error('   '))
    const { container } = render()
    submit(container)

    expect(await screen.findByText('Your vote could not be cast. Please try again.')).toBeInTheDocument()
  })

  it('reports a non-Error rejection rather than swallowing it', async () => {
    state.vote = vi.fn().mockRejectedValue('relay unreachable')
    const { container } = render()
    submit(container)

    expect(await screen.findByText(/relay unreachable/)).toBeInTheDocument()
  })

  it('says how much of a partial vote was recorded, and why the rest was not', async () => {
    state.vote = vi.fn().mockRejectedValue(
      partialVoteError([{ questionId: 'q-0' }], [{ questionId: 'q-1', error: new Error(NOT_STARTED) }]),
    )
    const { container } = render(twoQuestions)
    submit(container, ['A', 'C'])

    const message = await screen.findByText(/Only part of your vote was cast/)
    expect(message).toHaveTextContent('1 of 2 questions were recorded')
    expect(message).toHaveTextContent(NOT_STARTED)
    // A partial cast is resumable — the voter must know to submit again.
    expect(message).toHaveTextContent('Submit again')
  })

  it('states a shared reason once instead of repeating it per question', async () => {
    state.vote = vi.fn().mockRejectedValue(
      partialVoteError(
        [],
        [
          { questionId: 'q-0', error: new Error(NOT_STARTED) },
          { questionId: 'q-1', error: new Error(NOT_STARTED) },
        ],
      ),
    )
    const { container } = render(twoQuestions)
    submit(container, ['A', 'C'])

    const message = await screen.findByText(/Only part of your vote was cast/)
    expect(message).toHaveTextContent('0 of 2 questions were recorded')
    expect(message.textContent?.match(/starts at time/g)).toHaveLength(1)
  })

  it('keeps distinct per-question reasons', async () => {
    state.vote = vi.fn().mockRejectedValue(
      partialVoteError(
        [],
        [
          { questionId: 'q-0', error: new Error('the census proof is no longer valid') },
          { questionId: 'q-1', error: new Error(NOT_STARTED) },
        ],
      ),
    )
    const { container } = render(twoQuestions)
    submit(container, ['A', 'C'])

    const message = await screen.findByText(/Only part of your vote was cast/)
    expect(message).toHaveTextContent('the census proof is no longer valid')
    expect(message).toHaveTextContent(NOT_STARTED)
  })

  it('clears the message when a retry succeeds', async () => {
    state.vote = vi.fn().mockRejectedValueOnce(new Error(NOT_STARTED)).mockResolvedValueOnce('vote-id')
    const { container } = render()
    submit(container)
    await screen.findByText(/could not be cast/)

    fireEvent.submit(container.querySelector('form')!)
    await waitFor(() => expect(state.vote).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByText(/could not be cast/)).toBeNull())
  })

  it('shows nothing when the voter cancels the confirmation', async () => {
    state.vote = vi.fn()
    const { container } = render()
    state.confirmResult = false
    submit(container)

    await waitFor(() => expect(screen.queryByText(/could not be cast/)).toBeNull())
    expect(state.vote).not.toHaveBeenCalled()
  })
})

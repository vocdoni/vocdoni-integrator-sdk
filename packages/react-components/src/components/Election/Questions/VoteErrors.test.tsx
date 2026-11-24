import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeProcess, renderWithComponents } from '../../../test-utils'

const state = vi.hoisted(() => ({
  election: null as ReturnType<typeof makeProcess> | null,
  vote: vi.fn(),
  confirmResult: true,
  pendingVotes: {} as Record<string, true>,
  voteStatus: {} as Record<string, string>,
  voterQuestions: [] as Array<{ questionId: string; hasVoted: boolean }>,
  status: 'ONGOING',
}))
vi.mock('@vocdoni/react-providers', () => ({
  useElection: () => ({
    election: state.election,
    vote: state.vote,
    status: state.status,
    hasVoted: false,
    isAbleToVote: true,
    voteIds: {},
    pendingVotes: state.pendingVotes,
    voteStatus: state.voteStatus,
    voterQuestions: state.voterQuestions,
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

// A failing test must not leak its process or voter state into the next one.
beforeEach(() => {
  state.status = 'ONGOING'
  state.voterQuestions = []
  state.confirmResult = true
})

function render(questions = oneQuestion) {
  state.election = makeProcess({ questions })
  state.confirmResult = true
  state.pendingVotes = {}
  state.voteStatus = {}
  state.voterQuestions = []
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

describe('a question-by-question vote (#111)', () => {
  it('locks a paused question and votes only the open one', async () => {
    state.vote = vi.fn().mockResolvedValue('vote-id')
    state.election = makeProcess({ questions: [twoQuestions[0], { ...twoQuestions[1], status: 'PAUSED' }] })
    state.confirmResult = true
    state.pendingVotes = {}
    state.voteStatus = {}
    const { container } = renderWithComponents(<ElectionQuestions />)

    expect(screen.getByText('This question is not open for voting right now.')).toBeInTheDocument()
    expect(screen.queryByLabelText('C')).toBeNull()
    // Only the open question needs an answer: the paused one does not block the submit.
    submit(container, ['A'])
    await waitFor(() => expect(state.vote).toHaveBeenCalledWith([[0], []]))
  })

  it('says a pending question that is not open waits, not that it is being re-sent', () => {
    state.election = makeProcess({ questions: [twoQuestions[0], { ...twoQuestions[1], status: 'PAUSED' }] })
    state.pendingVotes = { 'q-1': true }
    state.voteStatus = {}
    state.voterQuestions = []
    renderWithComponents(<ElectionQuestions />)

    expect(screen.getByText('This question is not open for voting right now.')).toBeInTheDocument()
    expect(screen.queryByText('Your vote for this question is being sent again.')).toBeNull()
  })

  it('locks a question already voted once the next one opens', () => {
    state.election = makeProcess({ questions: twoQuestions })
    state.pendingVotes = {}
    state.voteStatus = { [state.election.questions[0].id]: 'confirmed' }
    renderWithComponents(<ElectionQuestions />)
    expect(screen.getByText('You have already voted this question.')).toBeInTheDocument()
    expect(screen.queryByLabelText('A')).toBeNull()
    expect(screen.getByLabelText('C')).toBeInTheDocument()
  })

  it('locks a question voted in an earlier session (voter state, not voteStatus)', async () => {
    state.vote = vi.fn().mockResolvedValue('vote-id')
    state.election = makeProcess({ questions: twoQuestions })
    state.confirmResult = true
    state.pendingVotes = {}
    state.voteStatus = {}
    state.voterQuestions = [{ questionId: state.election.questions[0].id, hasVoted: true }]
    const { container } = renderWithComponents(<ElectionQuestions />)
    expect(screen.getByText('You have already voted this question.')).toBeInTheDocument()
    expect(screen.queryByLabelText('A')).toBeNull()
    submit(container, ['C'])
    await waitFor(() => expect(state.vote).toHaveBeenCalledWith([[], [0]]))
  })

  it('locks the next question between two questions (q-0 closed, q-1 not open: PROCESS_UNKNOWN)', () => {
    state.election = makeProcess({
      questions: [
        { ...twoQuestions[0], status: 'ENDED' },
        { ...twoQuestions[1], status: 'PAUSED' },
      ],
    })
    state.status = 'PROCESS_UNKNOWN'
    state.pendingVotes = {}
    state.voteStatus = { [state.election.questions[0].id]: 'confirmed' }
    state.voterQuestions = []
    renderWithComponents(<ElectionQuestions />)
    expect(screen.getByText('You have already voted this question.')).toBeInTheDocument()
    expect(screen.getByText('This question is not open for voting right now.')).toBeInTheDocument()
    expect(screen.queryByLabelText('C')).toBeNull()
  })

  it('explains a NoOpenQuestionError without the provider wording', async () => {
    const error = new Error('No question open for voting: q-0 (PAUSED)')
    error.name = 'NoOpenQuestionError'
    state.vote = vi.fn().mockRejectedValue(error)
    const { container } = render()
    submit(container)
    expect(await screen.findByText(/not open for voting right now\. Try again/)).toBeInTheDocument()
    expect(screen.queryByText(/q-0 \(PAUSED\)/)).toBeNull()
  })

  it.each([
    [
      'one question that will not open',
      [{ questionId: 'q-0', status: 'PAUSED' }],
      'This question is not open for voting right now. Try again once it opens.',
    ],
    [
      'questions that will not open',
      [
        { questionId: 'q-0', status: 'PAUSED' },
        { questionId: 'q-1', status: 'UPCOMING' },
      ],
      'These questions are not open for voting right now. Try again once they open.',
    ],
    [
      'one ended question',
      [{ questionId: 'q-0', status: 'ENDED' }],
      'Voting is closed for this question.',
    ],
    [
      'ended questions',
      [
        { questionId: 'q-0', status: 'ENDED' },
        { questionId: 'q-1', status: 'RESULTS' },
      ],
      'Voting is closed for these questions.',
    ],
  ])('words a NoOpenQuestionError for %s', async (_case, questions, text) => {
    const error = new Error('No question open for voting') as Error & { questions: unknown }
    error.name = 'NoOpenQuestionError'
    error.questions = questions
    state.vote = vi.fn().mockRejectedValue(error)
    const { container } = render(twoQuestions)
    submit(container, ['A', 'C'])
    expect(await screen.findByText(text)).toBeInTheDocument()
  })
})

describe('a question whose vote is already signed', () => {
  it('renders "being sent again" instead of the fields of a pending question, and votes the rest', async () => {
    state.vote = vi.fn().mockResolvedValue('vote-id')
    state.election = makeProcess({ questions: twoQuestions })
    state.confirmResult = true
    state.voteStatus = {}
    state.pendingVotes = { [state.election.questions[0].id]: true }
    const { container } = renderWithComponents(<ElectionQuestions />)

    expect(screen.getByText('Your vote for this question is being sent again.')).toBeInTheDocument()
    expect(screen.queryByLabelText('A')).toBeNull()
    submit(container, ['C'])
    // The pending question's ballot is a placeholder: the provider re-sends its stored tx.
    await waitFor(() => expect(state.vote).toHaveBeenCalledWith([[], [0]]))
  })

  it('re-sends straight away after a partial failure, with no confirmation to show', async () => {
    // q-0 confirmed, q-1 pending: every question is locked, so there is nothing to confirm.
    state.vote = vi.fn().mockResolvedValue('vote-id')
    state.election = makeProcess({ questions: twoQuestions })
    state.confirmResult = false // a confirmation would stop the submit
    state.voteStatus = { 'q-0': 'confirmed' }
    state.pendingVotes = { 'q-1': true }
    const { container } = renderWithComponents(<ElectionQuestions />)

    fireEvent.submit(container.querySelector('form')!)
    await waitFor(() => expect(state.vote).toHaveBeenCalledWith([[], []]))
  })

  it.each([
    ['unconfirmed', 'Your vote was authorized but did not reach the ledger'],
    ['signed', 'Your vote was already authorized'],
  ])('renders the %s notice instead of the fields', (status, text) => {
    state.election = makeProcess({ questions: oneQuestion })
    state.pendingVotes = {}
    state.voteStatus = { [state.election.questions[0].id]: status }
    renderWithComponents(<ElectionQuestions />)
    expect(screen.getByText(new RegExp(text))).toBeInTheDocument()
    expect(screen.queryByLabelText('A')).toBeNull()
  })

  it('says an unknown outcome could not be confirmed yet, not that it failed', async () => {
    state.vote = vi.fn().mockRejectedValue(
      partialVoteError([], [{ questionId: 'q', error: new Error('could not confirm the vote on chain yet') }]),
    )
    const { container } = render()
    submit(container)
    expect(await screen.findByText(/could not be confirmed yet/)).toBeInTheDocument()
    expect(screen.queryByText(/could not confirm the vote on chain yet/)).toBeNull()
  })
})

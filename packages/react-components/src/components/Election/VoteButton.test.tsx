import type { QuestionStatus } from '@vocdoni/api-types'
import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { makeProcess, renderWithComponents } from '../../test-utils'

const state = vi.hoisted(() => ({
  election: null as ReturnType<typeof makeProcess> | null,
  status: 'ONGOING' as QuestionStatus | null,
  isAbleToVote: false,
  hasVoted: false,
  voting: false,
  connected: true,
  isInCensus: true,
}))
vi.mock('@vocdoni/react-providers', () => ({ useElection: () => state }))

import { VoteButton } from './VoteButton'

const Slot = ({ disabled, loading, label, tooltip }: any) => (
  <button data-testid="vote" disabled={disabled} data-loading={loading} title={tooltip}>
    {label}
  </button>
)
const slots = { components: { VoteButton: Slot } }

function setVoter(over: Partial<typeof state>) {
  Object.assign(
    state,
    {
      election: makeProcess(),
      status: 'ONGOING',
      isAbleToVote: false,
      hasVoted: false,
      voting: false,
      connected: true,
      isInCensus: true,
    },
    over,
  )
}

describe('VoteButton', () => {
  it('is enabled and labelled "Vote" when the voter can vote on an ONGOING election', () => {
    setVoter({ isAbleToVote: true })
    renderWithComponents(<VoteButton />, slots)
    const btn = screen.getByTestId('vote')
    expect(btn).toBeEnabled()
    expect(btn).toHaveTextContent('Vote')
    // Nothing to explain on an enabled button.
    expect(btn).not.toHaveAttribute('title')
  })

  it('keeps the plain label and disables once the voter has already voted', () => {
    // Re-voting isn't supported: a voted user loses `isAbleToVote`, so there
    // is no "update your vote" state — just the disabled plain button.
    setVoter({ isAbleToVote: false, hasVoted: true })
    renderWithComponents(<VoteButton />, slots)
    const btn = screen.getByTestId('vote')
    expect(btn).toBeDisabled()
    expect(btn).toHaveTextContent('Vote')
    expect(btn).toHaveAttribute('title', 'You have already voted')
  })

  it('is disabled and loading while a vote is in flight — no double submit', () => {
    setVoter({ isAbleToVote: true, voting: true })
    renderWithComponents(<VoteButton />, slots)
    const btn = screen.getByTestId('vote')
    expect(btn).toBeDisabled()
    expect(btn).toHaveAttribute('data-loading', 'true')
    // The loading state is the explanation; no tooltip on top of it.
    expect(btn).not.toHaveAttribute('title')
  })

  it('is disabled when the voter is not able to vote', () => {
    setVoter({ isAbleToVote: false })
    renderWithComponents(<VoteButton />, slots)
    expect(screen.getByTestId('vote')).toBeDisabled()
  })

  it('is disabled when the election is not ONGOING', () => {
    setVoter({ status: 'PAUSED', isAbleToVote: true })
    renderWithComponents(<VoteButton />, slots)
    expect(screen.getByTestId('vote')).toBeDisabled()
  })

  it('honours an external disabled prop even when otherwise votable', () => {
    setVoter({ isAbleToVote: true })
    renderWithComponents(<VoteButton disabled />, slots)
    const btn = screen.getByTestId('vote')
    expect(btn).toBeDisabled()
    // The consumer's reason is theirs to show — the SDK has none to name.
    expect(btn).not.toHaveAttribute('title')
  })

  it('renders nothing without an election', () => {
    setVoter({ election: null })
    const { container } = renderWithComponents(<VoteButton />, slots)
    expect(container).toBeEmptyDOMElement()
  })

  describe('explains why it is disabled (integrator-sdk#53)', () => {
    it('is disabled before the scheduled start and says when voting opens', () => {
      // A voter who has identified and belongs to the census still can't vote
      // on a scheduled process: the chain rejects votes cast before the start.
      const startDate = '2026-09-29T09:00:00Z'
      setVoter({ status: 'UPCOMING', isAbleToVote: true, election: makeProcess({ startDate }) })
      renderWithComponents(<VoteButton />, slots)
      const btn = screen.getByTestId('vote')
      expect(btn).toBeDisabled()
      expect(btn).toHaveAttribute('title', expect.stringMatching(/^Voting opens on /))
      // The date is rendered in the voter's locale/timezone, so only pin the
      // parts a timezone can't move: the calendar month and year.
      expect(btn.getAttribute('title')).toMatch(/Sep \d{1,2}, 2026/)
    })

    it('falls back to "not open yet" when the process carries no start date', () => {
      const election = makeProcess()
      delete (election as { startDate?: string }).startDate
      setVoter({ status: 'UPCOMING', isAbleToVote: true, election })
      renderWithComponents(<VoteButton />, slots)
      expect(screen.getByTestId('vote')).toHaveAttribute('title', 'Voting not open yet')
    })

    it.each([
      ['PAUSED', 'Voting is paused'],
      ['ENDED', 'Voting has ended'],
      ['RESULTS', 'Voting has ended'],
      ['CANCELED', 'Voting was canceled'],
      ['PROCESS_UNKNOWN', 'Voting is not open'],
    ] as const)('names the %s process state', (status, text) => {
      setVoter({ status, isAbleToVote: true })
      const btn = renderWithComponents(<VoteButton />, slots).getByTestId('vote')
      expect(btn).toBeDisabled()
      expect(btn).toHaveAttribute('title', text)
    })

    it('puts the process state before the voter state', () => {
      // An unidentified voter on an upcoming process is told about the
      // schedule, which holds for everyone, rather than to identify first.
      setVoter({ status: 'UPCOMING', isAbleToVote: false, connected: false })
      renderWithComponents(<VoteButton />, slots)
      expect(screen.getByTestId('vote')).toHaveAttribute('title', expect.stringMatching(/^Voting opens on /))
    })

    it('asks an unidentified voter to identify first', () => {
      setVoter({ isAbleToVote: false, connected: false, isInCensus: false })
      renderWithComponents(<VoteButton />, slots)
      expect(screen.getByTestId('vote')).toHaveAttribute('title', 'Identify first to vote')
    })

    it('tells an identified voter outside the census they are not eligible', () => {
      setVoter({ isAbleToVote: false, connected: true, isInCensus: false })
      renderWithComponents(<VoteButton />, slots)
      expect(screen.getByTestId('vote')).toHaveAttribute(
        'title',
        'You are not eligible to vote in this process',
      )
    })

    it('reports the vote already cast ahead of any other voter state', () => {
      setVoter({ isAbleToVote: false, hasVoted: true, isInCensus: false })
      renderWithComponents(<VoteButton />, slots)
      expect(screen.getByTestId('vote')).toHaveAttribute('title', 'You have already voted')
    })
  })
})

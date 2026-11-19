import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { makeProcess, renderWithComponents } from '../../../test-utils'

const state = vi.hoisted(() => ({
  election: null as ReturnType<typeof makeProcess> | null,
  voteIds: {} as Record<string, string>,
  voteId: null as string | null,
  explorerUrl: null as string | null,
}))
vi.mock('@vocdoni/react-providers', () => ({
  useElection: () => ({
    election: state.election,
    voteIds: state.voteIds,
    voteId: state.voteId,
    explorerUrl: state.explorerUrl,
  }),
}))

import { Voted } from './Voted'
import type { VotedSlotProps } from '../../context/types'

let captured: VotedSlotProps | undefined
const capture = {
  components: {
    Voted: (props: VotedSlotProps) => {
      captured = props
      return null
    },
  },
}

const twoQuestions = [
  { title: 'Favourite fruit', choices: [{ title: 'A', value: 0 }] },
  { title: 'Favourite veg', choices: [{ title: 'B', value: 0 }] },
]

function setup(
  election: ReturnType<typeof makeProcess> | null,
  voteIds: Record<string, string>,
  voteId: string | null = null,
  explorerUrl: string | null = 'https://explorer.vote',
) {
  captured = undefined
  state.election = election
  state.voteIds = voteIds
  state.voteId = voteId
  state.explorerUrl = explorerUrl
}

describe('Voted', () => {
  it('renders one entry per voted question, titled and in process order', () => {
    setup(makeProcess({ questions: twoQuestions }), { 'q-1': 'null-b', 'q-0': 'null-a' })
    renderWithComponents(<Voted />, capture)

    // Process order, not the (insertion-ordered) id map's.
    expect(captured!.votes.map((v) => [v.questionId, v.questionTitle, v.voteId])).toEqual([
      ['q-0', 'Favourite fruit', 'null-a'],
      ['q-1', 'Favourite veg', 'null-b'],
    ])
  })

  it('renders each vote id as a link next to its question title', () => {
    setup(makeProcess({ questions: twoQuestions }), { 'q-0': 'null-a', 'q-1': 'null-b' })
    renderWithComponents(<Voted />)

    expect(screen.getByText(/Your vote id for "Favourite fruit" is/)).toBeInTheDocument()
    expect(screen.getByText(/Your vote id for "Favourite veg" is/)).toBeInTheDocument()
    const links = screen.getAllByRole('link')
    expect(links.map((a) => a.textContent)).toEqual(['null-a', 'null-b'])
    expect(links[0]).toHaveAttribute('href', 'https://explorer.vote/verify/null-a')
    expect(links[0]).toHaveAttribute('target', '_blank')
    expect(links[0]).toHaveAttribute('rel', 'noreferrer')
  })

  it('links each vote to its explorer verify page, with the id encoded', () => {
    setup(makeProcess({ questions: [twoQuestions[0]] }), { 'q-0': 'a/b c' }, null, 'https://dev.explorer.vote')
    renderWithComponents(<Voted />)
    expect(screen.getByRole('link')).toHaveAttribute('href', 'https://dev.explorer.vote/verify/a%2Fb%20c')
  })

  it('exposes the explorer verify link as `url` on each vote for slot overrides', () => {
    setup(makeProcess({ questions: [twoQuestions[0]] }), { 'q-0': 'null-a' })
    renderWithComponents(<Voted />, capture)
    expect(captured!.votes[0].url).toBe('https://explorer.vote/verify/null-a')
  })

  it('renders the vote id as plain text, with no link, when the explorer is unknown', () => {
    setup(makeProcess({ questions: [twoQuestions[0]] }), { 'q-0': 'null-a' }, null, null)
    renderWithComponents(<Voted />)

    expect(screen.getByText(/Your vote id is null-a/)).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('leaves `url` absent on each vote when the explorer is unknown', () => {
    setup(makeProcess({ questions: twoQuestions }), { 'q-0': 'null-a' }, null, null)
    renderWithComponents(<Voted />, capture)
    expect(captured!.votes[0].url).toBeUndefined()
  })

  it('single question: reads exactly as the singular sentence, id still link-ified', () => {
    setup(makeProcess({ questions: [twoQuestions[0]] }), { 'q-0': 'null-a' })
    renderWithComponents(<Voted />)

    expect(screen.getByText(/Your vote id is/)).toBeInTheDocument()
    expect(screen.queryByText(/Favourite fruit/)).not.toBeInTheDocument()
    expect(screen.getByRole('link')).toHaveAttribute('href', 'https://explorer.vote/verify/null-a')
  })

  it('renders nothing when the voter holds no vote id', () => {
    setup(makeProcess({ questions: twoQuestions }), {})
    const { container } = renderWithComponents(<Voted />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows only the questions actually voted on a partial cast', () => {
    setup(makeProcess({ questions: twoQuestions }), { 'q-0': 'null-a' })
    renderWithComponents(<Voted />, capture)

    expect(captured!.votes).toHaveLength(1)
    expect(captured!.votes[0].questionId).toBe('q-0')
  })

  it('keeps an id whose question is missing from the process read', () => {
    setup(makeProcess({ questions: [twoQuestions[0]] }), { 'q-0': 'null-a', 'q-9': 'null-z' })
    renderWithComponents(<Voted />, capture)

    expect(captured!.votes.map((v) => v.voteId)).toEqual(['null-a', 'null-z'])
    // No title to show, so it falls back to the untitled sentence.
    expect(captured!.votes[1].questionTitle).toBe('')
  })

  it('falls back to the legacy single voteId when voteIds is empty', () => {
    setup(makeProcess({ questions: twoQuestions }), {}, 'legacy-id')
    renderWithComponents(<Voted />, capture)

    expect(captured!.votes.map((v) => v.voteId)).toEqual(['legacy-id'])
  })

  it('joins every line into `description`, so old single-string overrides show them all', () => {
    setup(makeProcess({ questions: twoQuestions }), { 'q-0': 'null-a', 'q-1': 'null-b' })
    const { container } = renderWithComponents(<Voted />, {
      components: { Voted: ({ description }: VotedSlotProps) => <p>{description}</p> },
    })

    expect(container.textContent).toContain('null-a')
    expect(container.textContent).toContain('null-b')
  })
})

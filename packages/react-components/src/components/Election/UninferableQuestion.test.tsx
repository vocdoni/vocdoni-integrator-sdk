import type { QuestionStatus, VotingProcessResponse, VotingProcessResultsResponse } from '@vocdoni/api-types'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { legacyProjectedProcess } from '../../test-fixtures/legacy-process'
import { makeProcess, makeResults, renderWithComponents } from '../../test-utils'

// Regression for the prod crash "cannot infer ballot type: question has neither a
// ballotProtocol nor a supported type": a legacy election projected by GET /processes
// has no type, protocol or metadata, and every component below used to infer its ballot
// type during render — so one such question took down the whole page.

const state = vi.hoisted(() => ({
  election: null as VotingProcessResponse | null,
  status: 'RESULTS' as QuestionStatus | null,
  results: null as VotingProcessResultsResponse | null,
  isAbleToVote: false,
  vote: vi.fn(),
  confirm: vi.fn(),
}))
vi.mock('@vocdoni/react-providers', () => ({
  useElection: () => ({
    election: state.election,
    status: state.status,
    results: state.results,
    isAbleToVote: state.isAbleToVote,
    hasVoted: false,
    voteIds: {},
    vote: state.vote,
  }),
}))
vi.mock('../../confirm/useConfirm', () => ({
  useConfirm: () => ({ confirm: state.confirm, proceed: vi.fn(), cancel: vi.fn() }),
}))

import { QuestionsConfirmation } from './Questions/Confirmation'
import { ElectionQuestions } from './Questions/Questions'
import { QuestionsFormProvider } from './Questions/Form'
import { QuestionTip } from './Questions/Tip'
import { QuestionsTypeBadge } from './Questions/TypeBadge'
import { ElectionResults } from './Results'

const legacyQuestion = legacyProjectedProcess.questions[0]
const choiceTitles = ['Teular el garatge', 'Teular la casa sencera', 'Pagar la hipoteca']
const UNSUPPORTED = /ballot type isn't supported/

// Results as the SaaS API serves them for the same process (inline on the question).
const legacyResults = (): VotingProcessResultsResponse =>
  makeResults([
    {
      questionId: legacyQuestion.id,
      finalResults: true,
      results: (legacyQuestion as unknown as { results: { results: string[][] } }).results.results,
    },
  ])

beforeEach(() => {
  state.election = legacyProjectedProcess
  state.status = 'RESULTS'
  state.results = legacyResults()
  state.isAbleToVote = false
  state.vote = vi.fn().mockResolvedValue('vote-id')
  state.confirm = vi.fn().mockResolvedValue(true)
})

it('the fixture really is uninferable (guards against a fixture that stops reproducing)', () => {
  expect(legacyQuestion.type).toBe('')
  expect(legacyQuestion.ballotProtocol).toBeUndefined()
  expect(legacyQuestion.metadata).toBeUndefined()
})

describe('QuestionsTypeBadge', () => {
  it('renders nothing instead of throwing', () => {
    const Slot = vi.fn(() => null)
    const { container } = renderWithComponents(<QuestionsTypeBadge />, { components: { QuestionsTypeBadge: Slot } })
    expect(Slot).not.toHaveBeenCalled()
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing for the question passed explicitly, too', () => {
    const Slot = vi.fn(() => null)
    renderWithComponents(<QuestionsTypeBadge question={legacyQuestion} />, { components: { QuestionsTypeBadge: Slot } })
    expect(Slot).not.toHaveBeenCalled()
  })
})

describe('QuestionTip', () => {
  it('renders nothing instead of throwing', () => {
    const Slot = vi.fn(() => null)
    renderWithComponents(
      <QuestionsFormProvider>
        <QuestionTip question={legacyQuestion} index='0' />
      </QuestionsFormProvider>,
      { components: { QuestionTip: Slot } },
    )
    expect(Slot).not.toHaveBeenCalled()
  })
})

describe('ElectionQuestions (Fields + Form)', () => {
  it('renders the question read-only with an explanation, on the real (ended) process', () => {
    renderWithComponents(<ElectionQuestions />)

    expect(screen.getByText(legacyQuestion.title.default)).toBeInTheDocument()
    for (const title of choiceTitles) {
      expect(screen.getByLabelText(title)).toBeDisabled()
    }
    expect(screen.getByText(UNSUPPORTED)).toBeInTheDocument()
  })

  it('stays read-only even where the process would otherwise accept votes', () => {
    state.status = 'ONGOING'
    state.isAbleToVote = true
    renderWithComponents(<ElectionQuestions />)

    for (const title of choiceTitles) {
      expect(screen.getByLabelText(title)).toBeDisabled()
    }
  })

  it('refuses to submit a ballot for it: no confirmation, no vote', async () => {
    state.status = 'ONGOING'
    state.isAbleToVote = true
    const onInvalid = vi.fn()
    const { container } = renderWithComponents(<ElectionQuestions onInvalid={onInvalid} />)

    fireEvent.submit(container.querySelector('form')!)

    // The field error lands on the question (index 0) and flags it invalid — through
    // validation, so onInvalid hears about it on the very first submit.
    await waitFor(() => expect(container.querySelector('[aria-invalid="true"], [data-invalid]')).not.toBeNull())
    expect(onInvalid).toHaveBeenCalledTimes(1)
    expect(state.confirm).not.toHaveBeenCalled()
    expect(state.vote).not.toHaveBeenCalled()
  })

  it('refuses the whole ballot when only one of several questions is uninferable', async () => {
    const votable = makeProcess({ questions: [{ title: 'Votable', choices: [{ title: 'Yes', value: 0 }] }] })
    state.election = { ...legacyProjectedProcess, questions: [votable.questions[0], legacyQuestion] }
    state.status = 'ONGOING'
    state.isAbleToVote = true
    const { container } = renderWithComponents(<ElectionQuestions />)

    fireEvent.click(screen.getByLabelText('Yes'))
    fireEvent.submit(container.querySelector('form')!)

    await waitFor(() => expect(container.querySelector('[aria-invalid="true"], [data-invalid]')).not.toBeNull())
    expect(state.confirm).not.toHaveBeenCalled()
    expect(state.vote).not.toHaveBeenCalled()
  })
})

describe('QuestionsConfirmation', () => {
  it('renders without throwing and shows no answer for the question', () => {
    let captured: any
    renderWithComponents(<QuestionsConfirmation election={legacyProjectedProcess} answers={{ '0': '' }} />, {
      components: {
        QuestionsConfirmation: (props: any) => {
          captured = props
          return null
        },
      },
    })
    expect(captured.answersView).toEqual([{ question: legacyQuestion.title.default, answers: [''] }])
  })
})

describe('ElectionResults', () => {
  it('lists the choices without tallies instead of throwing', () => {
    let captured: any
    renderWithComponents(<ElectionResults />, {
      components: {
        ElectionResults: (props: any) => {
          captured = props
          return null
        },
      },
    })

    expect(captured.questions).toHaveLength(1)
    expect(captured.questions[0].choices).toEqual(
      choiceTitles.map((title) => ({ title, votes: '', percent: '', image: undefined })),
    )
  })

  it('still decodes the other questions of the same process', () => {
    const votable = makeProcess({
      questions: [{ title: 'Votable', choices: [{ title: 'Yes', value: 0 }, { title: 'No', value: 1 }] }],
    })
    state.election = { ...legacyProjectedProcess, questions: [votable.questions[0], legacyQuestion] }
    state.results = {
      ...legacyResults(),
      questions: [
        { ...legacyResults().questions[0], questionId: votable.questions[0].id, results: [['3', '1']] },
        ...legacyResults().questions,
      ],
    }
    let captured: any
    renderWithComponents(<ElectionResults />, {
      components: {
        ElectionResults: (props: any) => {
          captured = props
          return null
        },
      },
    })

    expect(captured.questions[0].choices.map((c: any) => c.votes)).toEqual(['3', '1'])
    expect(captured.questions[1].choices.map((c: any) => c.votes)).toEqual(['', '', ''])
  })

  it('renders through the default slot without an empty tally', () => {
    renderWithComponents(<ElectionResults />)
    for (const title of choiceTitles) {
      expect(screen.getByText(title).parentElement).toHaveTextContent(new RegExp(`^${title}$`))
    }
  })
})

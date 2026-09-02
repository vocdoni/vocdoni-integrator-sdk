import { act, render, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeProcess, renderWithComponents } from '../../../test-utils'
import { createTestI18n } from '../../../i18n/test-i18n'

const state = vi.hoisted(() => ({
  election: null as ReturnType<typeof makeProcess> | null,
  status: 'ONGOING' as string,
  isAbleToVote: true,
  vote: vi.fn(),
}))
vi.mock('@vocdoni/react-providers', () => ({
  useElection: () => ({
    election: state.election,
    status: state.status,
    isAbleToVote: state.isAbleToVote,
    vote: state.vote,
  }),
}))
vi.mock('../../../confirm/useConfirm', () => ({
  useConfirm: () => ({ confirm: () => Promise.resolve(true) }),
}))

import { ComponentsProvider } from '../../context/ComponentsProvider'
import type { QuestionRankChoiceSlotProps } from '../../context/types'
import { ElectionQuestion } from './Fields'
import { QuestionsFormProvider, useQuestionsForm, type QuestionsFormContextState } from './Form'
import { QuestionsTypeBadge } from './TypeBadge'

const testI18n = createTestI18n()

// `state` is shared by every test in the file, so anything a test changes has to be put
// back even when that test fails — otherwise one broken assertion cascades into the rest.
afterEach(() => {
  state.status = 'ONGOING'
  state.isAbleToVote = true
})

/**
 * A ranked question as the backend stores one: a raw `ballotProtocol` (the named type
 * vocabulary has no `ranked`) plus the declaration in the metadata bag.
 */
const rankedQuestion = (n = 4) => ({
  title: 'Rank them',
  choices: Array.from({ length: n }, (_, i) => ({ title: `C${i}`, value: i })),
  ballotProtocol: { maxCount: n, maxValue: n - 1, uniqueValues: true },
  metadata: { type: { name: 'ranked' } },
})

/** The identical question with the declaration removed — a pick-slot multichoice. */
const undeclaredQuestion = (n = 4) => {
  const { metadata, ...rest } = rankedQuestion(n)
  return rest
}

describe('ranked questions render a rank widget, not a checkbox group', () => {
  function renderQuestion(question: ReturnType<typeof rankedQuestion>) {
    state.election = makeProcess({ questions: [question] })
    const captured: { selectionMode?: string; controls: string[]; ranks: string[] } = {
      controls: [],
      ranks: [],
    }
    renderWithComponents(<Host question={0} />, {
      components: {
        ElectionQuestion: (props: any) => {
          captured.selectionMode = props.selectionMode
          return <>{props.fields}</>
        },
        QuestionChoice: (props: any) => {
          captured.controls.push(props.controlType)
          return null
        },
        QuestionRankChoice: (props: any) => {
          captured.ranks.push(props.value)
          return null
        },
      },
    })
    return captured
  }

  const Host = ({ question }: { question: number }) => (
    <QuestionsFormProvider>
      <ElectionQuestion question={state.election!.questions[question]} index='0' />
    </QuestionsFormProvider>
  )

  it('renders one rank control per choice and no checkbox/radio', () => {
    const captured = renderQuestion(rankedQuestion(4))
    expect(captured.selectionMode).toBe('ranked')
    expect([...new Set(captured.ranks)]).toEqual(['0', '1', '2', '3'])
    expect(captured.controls).toEqual([])
  })

  it('renders checkboxes for the byte-identical undeclared question', () => {
    // The pair that proves the declaration is doing the work: same protocol, same
    // choices, different widget. Before #22 the ranked one got this too.
    const captured = renderQuestion(undeclaredQuestion(4) as ReturnType<typeof rankedQuestion>)
    expect(captured.selectionMode).toBe('multiple')
    expect([...new Set(captured.controls)]).toEqual(['checkbox'])
    expect(captured.ranks).toEqual([])
  })
})

/**
 * Drives the real widget inside the real form provider and submits, so the assertion
 * covers the whole chain — rank clicks → form value → `rankedOrderToScores` → encoded
 * ballot — rather than assuming the intermediate shape.
 */
function renderVotableQuestion(question: ReturnType<typeof rankedQuestion>) {
  state.election = makeProcess({ questions: [question] })
  state.vote = vi.fn().mockResolvedValue('vote-id')

  const slots = new Map<string, QuestionRankChoiceSlotProps>()
  const tip = { text: '' }
  let api: QuestionsFormContextState | undefined

  const Capture = () => {
    api = useQuestionsForm()
    return null
  }

  const wrapper = ({ children }: { children: ReactNode }) => (
    <I18nextProvider i18n={testI18n}>
      <ComponentsProvider
        components={{
          QuestionRankChoice: (props) => {
            slots.set(props.value, props)
            return null
          },
          QuestionTip: (props) => {
            tip.text = props.text
            return null
          },
        }}
      >
        {children}
      </ComponentsProvider>
    </I18nextProvider>
  )

  render(
    wrapper({
      children: (
        <QuestionsFormProvider>
          <Capture />
          <ElectionQuestion question={state.election.questions[0]} index='0' />
        </QuestionsFormProvider>
      ),
    })
  )

  return {
    /** Assign choice `value` the 1-based position `position` (null unranks it). */
    rank: (value: number, position: number | null) =>
      act(() => slots.get(String(value))!.onRank(position)),
    /** Latest props the slot received for that choice. */
    slot: (value: number) => slots.get(String(value))!,
    /** Latest text the tip rendered. */
    tip: () => tip.text,
    submit: async () => {
      await act(async () => {
        await api!.fmethods.handleSubmit(api!.vote)()
      })
    },
    api: () => api!,
  }
}

describe('ranked widget → wire ballot', () => {
  it('sends one rank per option in choice order, highest = best', async () => {
    const ui = renderVotableQuestion(rankedQuestion(4))

    // Voter's ranking: C2 > C0 > C3 > C1.
    ui.rank(2, 1)
    ui.rank(0, 2)
    ui.rank(3, 3)
    ui.rank(1, 4)
    await ui.submit()

    // C2 → 3, C0 → 2, C3 → 1, C1 → 0, laid out in choice order.
    expect(state.vote).toHaveBeenCalledWith([[2, 0, 3, 1]])
  })

  it('transposes the ordering rather than passing it through', async () => {
    // The 4-option ranking above happens to be its own transpose, which would hide a
    // pass-through bug. This one does not: order [C2, C0, C1] → ranks [1, 0, 2].
    const ui = renderVotableQuestion(rankedQuestion(3))
    ui.rank(2, 1)
    ui.rank(0, 2)
    ui.rank(1, 3)
    await ui.submit()

    expect(state.vote).toHaveBeenCalledWith([[1, 0, 2]])
  })

  it('reports the position each choice holds', async () => {
    const ui = renderVotableQuestion(rankedQuestion(3))
    expect(ui.slot(0).position).toBeNull()

    ui.rank(2, 1)
    expect(ui.slot(2).position).toBe(1)
    expect(ui.slot(0).position).toBeNull()
    // Position 1 is taken for everyone else, and not for its own holder.
    expect(ui.slot(0).options.map((option) => option.taken)).toEqual([true, false, false])
    expect(ui.slot(2).options.map((option) => option.taken)).toEqual([false, false, false])
  })

  it('swaps two options when one is dropped on the other\'s position', async () => {
    const ui = renderVotableQuestion(rankedQuestion(3))
    ui.rank(0, 1)
    ui.rank(1, 2)
    ui.rank(2, 3)
    // C2 takes first place; C0, which held it, drops into the slot C2 vacated.
    ui.rank(2, 1)

    expect(ui.slot(2).position).toBe(1)
    expect(ui.slot(0).position).toBe(3)
    expect(ui.slot(1).position).toBe(2)

    await ui.submit()
    // order [C2, C1, C0] → C2 → 2, C1 → 1, C0 → 0.
    expect(state.vote).toHaveBeenCalledWith([[0, 1, 2]])
  })

  it('reseats a displaced option in the free slot rather than dropping it', () => {
    // The swap above has a second case: the option being moved was not ranked yet, so
    // it has no slot to hand back. Dropping the displaced one loses a placement the
    // voter made, silently — the tip still reads "2 of 3" and submit stays blocked with
    // nothing on screen explaining why. There is a free slot; use it.
    const ui = renderVotableQuestion(rankedQuestion(3))
    ui.rank(0, 1)
    ui.rank(1, 2)
    expect(ui.tip()).toBe('You ranked 2 of 3 options')

    // C2, still unranked, takes first place from C0.
    ui.rank(2, 1)

    expect(ui.slot(2).position).toBe(1)
    expect(ui.slot(1).position).toBe(2)
    expect(ui.slot(0).position).toBe(3)
    expect(ui.tip()).toBe('You ranked 3 of 3 options')
  })

  it('unranks an option without disturbing the others', () => {
    const ui = renderVotableQuestion(rankedQuestion(3))
    ui.rank(0, 1)
    ui.rank(1, 2)
    ui.rank(0, null)

    expect(ui.slot(0).position).toBeNull()
    expect(ui.slot(1).position).toBe(2)
  })

  it('refuses to submit a partial ranking', async () => {
    // Not a UI preference: a ranked protocol is pigeonhole-tight, so a short slate
    // repeats a rank and the chain drops the whole ballot while counting the envelope.
    const ui = renderVotableQuestion(rankedQuestion(3))
    ui.rank(2, 1)
    await ui.submit()

    expect(state.vote).not.toHaveBeenCalled()
    await waitFor(() => expect(ui.api().fmethods.formState.errors['0']).toBeDefined())
    expect(ui.api().fmethods.formState.errors['0']?.message).toBe('Rank all 3 options')
  })

  it('does not offer the widget once voting is closed', () => {
    // Restored by the afterEach below, not on the last line of the test: an assertion
    // failure here would otherwise leak 'ENDED' into every test that follows, turning
    // one real failure into three that point at the wrong code.
    state.status = 'ENDED'
    const ui = renderVotableQuestion(rankedQuestion(3))
    expect(ui.slot(0).disabled).toBe(true)
  })
})

describe('ranked chrome', () => {
  it('labels the question Ranked Voting', () => {
    state.election = makeProcess({ questions: [rankedQuestion(4)] })
    const captured: { title?: string; tooltip?: string } = {}
    renderWithComponents(<QuestionsTypeBadge question={state.election.questions[0]} />, {
      components: {
        QuestionsTypeBadge: (props: any) => {
          captured.title = props.title
          captured.tooltip = props.tooltip
          return null
        },
      },
    })
    expect(captured.title).toBe('Ranked Voting ')
    expect(captured.tooltip).toMatch(/order all 4 options/)
  })

  it('counts placed options in the tip, ignoring the empty slots', () => {
    const ui = renderVotableQuestion(rankedQuestion(3))
    expect(ui.tip()).toBe('You ranked 0 of 3 options')

    // The widget keeps the slate at full length and writes '' into the positions
    // nobody has filled — those must not read as ranked.
    ui.rank(2, 1)
    expect(ui.tip()).toBe('You ranked 1 of 3 options')

    ui.rank(0, 2)
    ui.rank(1, 3)
    expect(ui.tip()).toBe('You ranked 3 of 3 options')
  })
})

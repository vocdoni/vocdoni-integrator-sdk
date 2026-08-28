import { questionSelectionRange } from '@vocdoni/ballot'
import type { ReactNode } from 'react'
import { FormProvider, useForm } from 'react-hook-form'
import { describe, expect, it, vi } from 'vitest'
import { makeProcess, renderWithComponents } from '../../../test-utils'

const state = vi.hoisted(() => ({
  election: null as ReturnType<typeof makeProcess> | null,
  status: 'ONGOING' as string,
  isAbleToVote: true,
}))
vi.mock('@vocdoni/react-providers', () => ({
  useElection: () => ({ election: state.election, status: state.status, isAbleToVote: state.isAbleToVote }),
}))

import { ElectionQuestion } from './Fields'
import { QuestionsFormProvider } from './Form'

const FormHost = ({ children }: { children: ReactNode }) => {
  const methods = useForm()
  return <FormProvider {...methods}>{children}</FormProvider>
}

const threeChoices = {
  title: 'Q1',
  choices: [
    { title: 'A', value: 0 },
    { title: 'B', value: 1 },
    { title: 'C', value: 2 },
  ],
}

function renderQuestion(election: ReturnType<typeof makeProcess>) {
  state.election = election
  const captured: { selectionMode?: string; controls: string[] } = { controls: [] }
  renderWithComponents(
    <FormHost>
      <ElectionQuestion question={election.questions[0]} index='0' />
    </FormHost>,
    {
      components: {
        ElectionQuestion: (props: any) => {
          captured.selectionMode = props.selectionMode
          return <>{props.fields}</>
        },
        QuestionChoice: (props: any) => {
          captured.controls.push(props.controlType)
          return null
        },
      },
    },
  )
  return captured
}

// The choice list may render more than once (StrictMode double-invoke), so assert
// on the distinct control type rather than the exact array length.
const onlyControl = (controls: string[]) => [...new Set(controls)]

describe('ElectionQuestion field switching (via inferQuestionBallotType)', () => {
  it('single-choice: radios, single selection mode', () => {
    const captured = renderQuestion(makeProcess({ questions: [threeChoices] }))
    expect(captured.selectionMode).toBe('single')
    expect(onlyControl(captured.controls)).toEqual(['radio'])
  })

  it('approval (maxValue 1, repeatable): checkboxes, multiple selection mode', () => {
    const captured = renderQuestion(
      makeProcess({ questions: [threeChoices], voteType: { maxCount: 3, maxValue: 1 } }),
    )
    expect(captured.selectionMode).toBe('multiple')
    expect(onlyControl(captured.controls)).toEqual(['checkbox'])
  })

  it('multichoice (maxValue > 1, unique): checkboxes, multiple selection mode', () => {
    const captured = renderQuestion(
      makeProcess({ questions: [threeChoices], voteType: { maxCount: 3, maxValue: 2, uniqueChoices: true } }),
    )
    expect(captured.selectionMode).toBe('multiple')
    expect(onlyControl(captured.controls)).toEqual(['checkbox'])
  })

  it('budget/quadratic: selectionMode matches the rendered radios (no dedicated widget yet)', () => {
    // maxValue 0 → budget/quadratic; they fall through to the SingleChoice widget
    // (radios), so selectionMode must stay 'single' to match what is rendered.
    const captured = renderQuestion(
      makeProcess({ questions: [threeChoices], voteType: { maxCount: 3, maxValue: 0, costExponent: 1 } }),
    )
    expect(captured.selectionMode).toBe('single')
    expect(onlyControl(captured.controls)).toEqual(['radio'])
  })
})

describe('extended choice presentation (driven by choice.meta)', () => {
  /** Renders one question of `election` and captures the layout/presentation it picks. */
  function renderQuestionAt(election: ReturnType<typeof makeProcess>, index: number) {
    state.election = election
    const captured: { layout?: string; hasExtendedChoices?: boolean; presentations: string[]; compacts: boolean[] } = {
      presentations: [],
      compacts: [],
    }
    renderWithComponents(
      <FormHost>
        <ElectionQuestion question={election.questions[index]} index={String(index)} />
      </FormHost>,
      {
        components: {
          ElectionQuestion: (props: any) => {
            captured.layout = props.layout
            captured.hasExtendedChoices = props.hasExtendedChoices
            return <>{props.fields}</>
          },
          QuestionChoice: (props: any) => {
            captured.presentations.push(props.presentation)
            captured.compacts.push(props.compact)
            return null
          },
        },
      },
    )
    return captured
  }

  const withImage = {
    title: 'Q1',
    choices: [
      { title: 'A', value: 0, meta: { image: { default: 'https://cdn.example/a.jpeg' } } },
      { title: 'B', value: 1 },
    ],
  }

  const withDescriptionOnly = {
    title: 'Q1',
    choices: [
      { title: 'A', value: 0, meta: { description: 'Peeled beforehand' } },
      { title: 'B', value: 1 },
    ],
  }

  const withEmptyDescription = {
    title: 'Q1',
    choices: [{ title: 'A', value: 0, meta: { description: '' } }, { title: 'B', value: 1 }],
  }

  it('renders basic/list when no choice carries extended info', () => {
    const captured = renderQuestionAt(makeProcess({ questions: [threeChoices] }), 0)
    expect(captured.layout).toBe('list')
    expect(captured.hasExtendedChoices).toBe(false)
    expect([...new Set(captured.presentations)]).toEqual(['basic'])
  })

  it('renders extended/grid when a choice carries an image', () => {
    const captured = renderQuestionAt(makeProcess({ questions: [withImage] }), 0)
    expect(captured.layout).toBe('grid')
    expect(captured.hasExtendedChoices).toBe(true)
    expect([...new Set(captured.presentations)]).toEqual(['extended'])
  })

  it('renders extended but stays on the list layout for a description-only question', () => {
    const captured = renderQuestionAt(makeProcess({ questions: [withDescriptionOnly] }), 0)
    expect(captured.layout).toBe('list')
    expect(captured.hasExtendedChoices).toBe(true)
    expect([...new Set(captured.presentations)]).toEqual(['extended'])
  })

  it('stays basic/list when the only stored info is an empty description', () => {
    const captured = renderQuestionAt(makeProcess({ questions: [withEmptyDescription] }), 0)
    expect(captured.layout).toBe('list')
    expect(captured.hasExtendedChoices).toBe(false)
    expect([...new Set(captured.presentations)]).toEqual(['basic'])
  })

  const withWhitespaceImage = {
    title: 'Q1',
    choices: [{ title: 'A', value: 0, meta: { image: { default: '   ' } } }, { title: 'B', value: 1 }],
  }

  const withThumbnailOnly = {
    title: 'Q1',
    choices: [
      { title: 'A', value: 0, meta: { image: { thumbnail: 'https://cdn.example/t.jpeg' } } },
      { title: 'B', value: 1 },
    ],
  }

  it('stays basic/list and compact when an image URL is whitespace-only', () => {
    const captured = renderQuestionAt(makeProcess({ questions: [withWhitespaceImage] }), 0)
    expect(captured.layout).toBe('list')
    expect(captured.hasExtendedChoices).toBe(false)
    expect([...new Set(captured.presentations)]).toEqual(['basic'])
    expect([...new Set(captured.compacts)]).toEqual([true])
  })

  it('treats a thumbnail-only image as an image, for the layout as well as the presentation', () => {
    const captured = renderQuestionAt(makeProcess({ questions: [withThumbnailOnly] }), 0)
    expect(captured.layout).toBe('grid')
    expect(captured.hasExtendedChoices).toBe(true)
    expect([...new Set(captured.presentations)]).toEqual(['extended'])
  })

  it('keeps each question of a mixed process on its own presentation', () => {
    const mixed = makeProcess({ questions: [withImage, threeChoices] })

    const first = renderQuestionAt(mixed, 0)
    expect(first.layout).toBe('grid')
    expect([...new Set(first.presentations)]).toEqual(['extended'])

    const second = renderQuestionAt(mixed, 1)
    expect(second.layout).toBe('list')
    expect([...new Set(second.presentations)]).toEqual(['basic'])
  })
})

describe('questionSelectionRange', () => {
  it('allows 1..maxCount even when abstain is not reserved (short ballots encodable)', () => {
    // uniqueChoices needs maxValue >= (numChoices); maxValue 2 does not reserve for 3 choices,
    // but a partial selection is still encodable (returned short), so min follows minChoices —
    // headroom now only governs encode padding, not the selection range.
    const question = makeProcess({
      questions: [threeChoices],
      voteType: { maxCount: 3, maxValue: 2, uniqueChoices: true },
    }).questions[0]
    expect(questionSelectionRange(question)).toEqual({ min: 1, max: 3 })
  })

  it('allows 1..maxCount when abstain is reserved (partial selection castable)', () => {
    // repeatable multichoice, numChoices 3 → needed maxValue 3; maxValue 3 reserves.
    const question = makeProcess({
      questions: [threeChoices],
      voteType: { maxCount: 3, maxValue: 3, uniqueChoices: false },
    }).questions[0]
    expect(questionSelectionRange(question)).toEqual({ min: 1, max: 3 })
  })
})

describe('the default choice slots keep component props off the DOM', () => {
  // `hasImage` is a slot prop, not an HTML attribute. A default slot that forgets to
  // destructure it spreads it onto the <label>, which React renders as a stray
  // `hasimage="true"` and warns about once per option per render.
  const imaged = (metadata?: Record<string, unknown>) => ({
    title: 'Q',
    choices: [0, 1, 2].map((v) => ({
      title: `C${v}`,
      value: v,
      meta: { image: { default: 'https://cdn.example/a.jpeg' } },
    })),
    ballotProtocol: { maxCount: 3, maxValue: 2, uniqueValues: true },
    ...(metadata ? { metadata } : {}),
  })

  // The real form provider, not the bare FormHost above: nothing is overridden here, so
  // the default `ElectionQuestion` slot renders its tip, which reads the questions form.
  const renderDefault = (question: ReturnType<typeof imaged>) => {
    state.election = makeProcess({ questions: [question] })
    return renderWithComponents(
      <QuestionsFormProvider>
        <ElectionQuestion question={state.election.questions[0]} index='0' />
      </QuestionsFormProvider>,
    )
  }

  /**
   * React 19 does not render an unknown `true`-valued prop as an attribute — it drops
   * it and logs instead, so the DOM looks clean and only the console says otherwise.
   * The global setup silences console.error with a spy, which is what makes the noise
   * invisible in the first place; read that spy back rather than trusting the markup.
   */
  const reactComplaintsAbout = (prop: string) =>
    vi
      .mocked(console.error)
      .mock.calls.map((args) => args.join(' '))
      .filter((message) => message.toLowerCase().includes(prop.toLowerCase()))

  // Both slots in one test, on purpose: React remembers which attribute names it has
  // already objected to, so whichever renders first is the only one that can warn.
  // Split in two, the second test would pass vacuously on the back of the first.
  it('does not forward hasImage to the DOM, from either choice slot', () => {
    const checkboxes = renderDefault(imaged())
    expect(checkboxes.container.querySelectorAll('input[type="checkbox"]')).not.toHaveLength(0)
    expect(reactComplaintsAbout('hasimage')).toEqual([])

    const ranked = renderDefault(imaged({ type: { name: 'ranked' } }))
    expect(ranked.container.querySelectorAll('select')).not.toHaveLength(0)
    expect(reactComplaintsAbout('hasimage')).toEqual([])
  })
})

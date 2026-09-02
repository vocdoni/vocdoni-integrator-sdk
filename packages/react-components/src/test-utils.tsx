import type {
  BallotProtocol,
  ChoiceMeta,
  Election,
  QuestionStatus,
  VotingProcessQuestion,
  VotingProcessResponse,
  VotingProcessResultsResponse,
} from '@vocdoni/api-types'
import { render, type RenderOptions } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import type { ReactElement, ReactNode } from 'react'
import { ComponentsProvider } from './components/context/ComponentsProvider'
import type { ComponentsPartialDefinition } from './components/context/types'
import { createTestI18n } from './i18n/test-i18n'

// A dedicated i18n instance preloaded with the package's English resources, so
// components render real labels ("Ongoing", "Vote", …) under test instead of
// raw keys. Created once and reused across the suite.
const testI18n = createTestI18n()

export interface RenderWithComponentsOptions extends Omit<RenderOptions, 'wrapper'> {
  /** Slot overrides — inject simple test slots to assert on the props a component emits. */
  components?: ComponentsPartialDefinition
}

/**
 * Renders `ui` inside the real i18n + component-slot providers. Pass `components`
 * to override individual slots with capture-friendly test implementations.
 *
 * Election/organization state is NOT provided here — mock `@vocdoni/react-providers`
 * in the test to control `useElection()` / `useOrganization()` / `useActions()`.
 */
export function renderWithComponents(
  ui: ReactElement,
  { components, ...options }: RenderWithComponentsOptions = {},
) {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <I18nextProvider i18n={testI18n}>
      <ComponentsProvider components={components}>{children}</ComponentsProvider>
    </I18nextProvider>
  )
  return render(ui, { wrapper: Wrapper, ...options })
}

const DEFAULT_BALLOT_PROTOCOL: BallotProtocol = {
  maxCount: 1,
  maxValue: 1,
  maxVoteOverwrites: 0,
  maxTotalCost: 0,
  costExponent: 1,
  uniqueValues: false,
  costFromWeight: false,
}

type MakeProcessQuestionInput = {
  title?: string
  /**
   * `meta` mirrors what the API client derives from the question's
   * `metadata.choices` — set it to exercise the extended choice presentation.
   */
  choices?: Array<{ title: string; value: number; meta?: ChoiceMeta }>
  ballotProtocol?: Partial<BallotProtocol>
  /**
   * Named question type as stored. Inference reads it ahead of the protocol, so it
   * decides the layout wherever the two could disagree — a `maxValue === 1` protocol
   * decodes as approval unless the question is a named `multichoice`.
   *
   * Defaults to `'singlechoice'` for the untouched default protocol and to `''` as
   * soon as a protocol override is supplied — the backend only names
   * `singlechoice`/`multichoice` and empties the label for every other shape, and a
   * named `singlechoice` always derives `maxCount: 1`. Set it explicitly to exercise
   * a genuinely named question.
   */
  type?: string
  /**
   * Open-ended creator metadata bag, stored and echoed verbatim by the backend. Its
   * `type.name` is the second name source inference consults, and the only channel that
   * can declare a `ranked` question — the backend's own `type` vocabulary is limited to
   * `singlechoice`/`multichoice`.
   */
  metadata?: Record<string, unknown>
  status?: QuestionStatus
  secretUntilTheEnd?: boolean
  upstreamId?: string
}

type MakeProcessOptions = {
  id?: string
  title?: string
  startDate?: string
  endDate?: string
  published?: boolean
  census?: Record<string, unknown>
  questions?: MakeProcessQuestionInput[]
  /** Shortcut: apply the same ballotProtocol to every question (maps old voteType field names). */
  voteType?: {
    maxCount?: number
    maxValue?: number
    maxVoteOverwrites?: number
    maxTotalCost?: number
    costExponent?: number
    uniqueChoices?: boolean
    costFromWeight?: boolean
  }
  /** Status assigned to every question (default: 'ONGOING'). */
  status?: QuestionStatus
  /** Maps secretUntilTheEnd to every question. */
  electionType?: { secretUntilTheEnd?: boolean }
}

/** Builds a {@link VotingProcessResponse} with per-question ballotProtocol. */
export function makeProcess(opts: MakeProcessOptions = {}): VotingProcessResponse {
  const { voteType, status = 'ONGOING', electionType, questions: qInputs, ...rest } = opts

  const bpOverrides: Partial<BallotProtocol> = voteType
    ? {
        maxCount: voteType.maxCount ?? 1,
        maxValue: voteType.maxValue ?? 1,
        maxVoteOverwrites: voteType.maxVoteOverwrites ?? 0,
        maxTotalCost: voteType.maxTotalCost ?? 0,
        costExponent: voteType.costExponent ?? 1,
        uniqueValues: voteType.uniqueChoices ?? false,
        costFromWeight: voteType.costFromWeight ?? false,
      }
    : {}

  const questions: VotingProcessQuestion[] = (qInputs ?? []).map((q, i) => ({
    id: `q-${i}`,
    parentProcessId: opts.id ?? 'proc-1',
    upstreamId: q.upstreamId ?? `upstream-${i}`,
    title: { default: q.title ?? `Question ${i + 1}` },
    choices: (q.choices ?? []).map((c) => ({
      title: { default: c.title },
      value: c.value,
      ...(c.meta && { meta: c.meta }),
    })),
    ballotProtocol: { ...DEFAULT_BALLOT_PROTOCOL, ...bpOverrides, ...(q.ballotProtocol ?? {}) },
    // A protocol override means a raw-`ballotProtocol` question, which the backend stores
    // with an empty type label — `inferQuestionBallotType` prefers a recognized name over
    // shape, so claiming `singlechoice` here would mask whatever the protocol expresses.
    type: q.type ?? (voteType || q.ballotProtocol ? '' : 'singlechoice'),
    ...(q.metadata ? { metadata: q.metadata } : {}),
    secretUntilTheEnd: q.secretUntilTheEnd ?? electionType?.secretUntilTheEnd ?? false,
    status: q.status ?? status,
  }))

  // Process reads return orgAddress as unprefixed lowercase hex.
  const common = {
    id: rest.id ?? 'proc-1',
    orgAddress: '0000000000000000000000000000000000000001',
    title: { default: rest.title ?? 'Test Process' },
    startDate: rest.startDate ?? '2024-01-01T00:00:00Z',
    endDate: rest.endDate ?? '2024-12-31T23:59:59Z',
    census: rest.census ?? {},
    questions,
  }

  return (rest.published ?? true) ? { ...common, published: true } : { ...common, published: false }
}

/** Builds a {@link VotingProcessResultsResponse} for use in Results tests. */
export function makeResults(
  questionResults: Array<{ questionId?: string; results?: string[][]; finalResults?: boolean }> = [],
): VotingProcessResultsResponse {
  return {
    id: 'proc-1',
    questions: questionResults.map((qr, i) => ({
      questionId: qr.questionId ?? `q-${i}`,
      upstreamId: `upstream-${i}`,
      status: 'RESULTS' as QuestionStatus,
      voteCount: 0,
      startDate: '2024-01-01T00:00:00Z',
      endDate: '2024-12-31T23:59:59Z',
      finalResults: qr.finalResults ?? true,
      results: qr.results ?? [],
    })),
  }
}

/** Builds a flat {@link Election} with sane defaults; override any field per test. */
export function makeElection(overrides: Partial<Election> = {}): Election {
  return {
    id: 'election-1',
    address: '6be21a5a9dc01036097ea184999095aed31735e7264a19652130030800000001',
    title: 'Test Election',
    status: 'READY',
    startDate: '2024-01-01T00:00:00Z',
    endDate: '2024-12-31T23:59:59Z',
    organizationId: 'org-1',
    voteCount: 0,
    finalResults: false,
    questions: [],
    voteType: {
      maxCount: 1,
      maxValue: 1,
      maxVoteOverwrites: 0,
      costExponent: 1,
      uniqueChoices: false,
      costFromWeight: false,
    },
    electionType: { interruptible: true, secretUntilTheEnd: false, anonymous: false },
    ...overrides,
  }
}

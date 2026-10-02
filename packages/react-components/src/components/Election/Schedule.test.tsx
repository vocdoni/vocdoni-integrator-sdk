import type { QuestionStatus } from '@vocdoni/api-types'
import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { makeProcess, renderWithComponents } from '../../test-utils'

const state = vi.hoisted(() => ({
  election: null as ReturnType<typeof makeProcess> | null,
  status: null as QuestionStatus | null,
}))
vi.mock('@vocdoni/react-providers', () => ({ useElection: () => state }))

import { ElectionSchedule } from './Schedule'

// Local-noon timestamps keep date-only assertions stable in every timezone.
const localNoon = (month: number, day: number) => new Date(2020, month, day, 12).toISOString()

const Slot = ({ text }: any) => <p data-testid="sched">{text}</p>
const slots = { components: { ElectionSchedule: Slot } }

describe('ElectionSchedule', () => {
  it('renders nothing without an election', () => {
    state.election = null
    state.status = null
    const { container } = renderWithComponents(<ElectionSchedule />, slots)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when dates are missing', () => {
    state.election = makeProcess({ startDate: '', endDate: '' })
    state.status = 'ONGOING'
    const { container } = renderWithComponents(<ElectionSchedule />, slots)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the from→to range by default', () => {
    state.election = makeProcess()
    state.status = 'ONGOING'
    renderWithComponents(<ElectionSchedule />, slots)
    expect(screen.getByTestId('sched')).toHaveTextContent('Voting from')
  })

  it('shows an "Ended" remaining label for an ended election', () => {
    state.election = makeProcess({
      startDate: '2020-01-01T00:00:00Z',
      endDate: '2020-02-01T00:00:00Z',
    })
    state.status = 'ENDED'
    renderWithComponents(<ElectionSchedule showRemaining />, slots)
    expect(screen.getByTestId('sched')).toHaveTextContent('Ended')
  })

  it('shows endedAt instead of the scheduled end for an early-ended election', () => {
    state.election = makeProcess({
      startDate: localNoon(0, 1),
      endDate: localNoon(11, 31),
      endedAt: localNoon(1, 1),
    })
    state.status = 'ENDED'
    renderWithComponents(<ElectionSchedule format="yyyy-MM-dd" />, slots)
    const text = screen.getByTestId('sched').textContent
    expect(text).toContain('2020-02-01')
    expect(text).not.toContain('2020-12-31')
  })

  it('shows the scheduled end when endedAt is absent', () => {
    state.election = makeProcess({
      startDate: localNoon(0, 1),
      endDate: localNoon(11, 31),
    })
    state.status = 'ENDED'
    renderWithComponents(<ElectionSchedule format="yyyy-MM-dd" />, slots)
    expect(screen.getByTestId('sched').textContent).toContain('2020-12-31')
  })

  it('measures the "Ended X ago" distance from endedAt, not the scheduled end', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2020-02-03T00:00:00Z'))
    try {
      state.election = makeProcess({
        startDate: '2020-01-01T00:00:00Z',
        endDate: '2020-12-31T00:00:00Z',
        endedAt: '2020-02-01T00:00:00Z',
      })
      state.status = 'ENDED'
      renderWithComponents(<ElectionSchedule showRemaining />, slots)
      expect(screen.getByTestId('sched')).toHaveTextContent('Ended 2 days ago')
    } finally {
      vi.useRealTimers()
    }
  })

  it('falls back to the scheduled end when endedAt precedes the start', () => {
    state.election = makeProcess({
      startDate: localNoon(2, 1),
      endDate: localNoon(11, 31),
      endedAt: localNoon(1, 1),
    })
    state.status = 'CANCELED'
    renderWithComponents(<ElectionSchedule format="yyyy-MM-dd" />, slots)
    const text = screen.getByTestId('sched').textContent
    expect(text).toContain('2020-03-01')
    expect(text).toContain('2020-12-31')
    expect(text).not.toContain('2020-02-01')
  })
})

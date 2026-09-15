import { act, renderHook } from '@testing-library/react'
import type { VotingProcessResponse } from '@vocdoni/api-types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockProcess } from '../../../../mocks/handlers'
import { useProcessStatus } from './use-process-status'

const NOW = new Date('2026-09-15T12:00:00Z')

/** A process whose single question is live on the wire (`READY`). */
const scheduled = (startDate: string | undefined): VotingProcessResponse =>
  ({
    ...mockProcess,
    startDate,
    questions: mockProcess.questions.map((q) => ({ ...q, status: 'READY' })),
  }) as unknown as VotingProcessResponse

describe('useProcessStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns null without an election', () => {
    const { result } = renderHook(() => useProcessStatus(null))
    expect(result.current).toBeNull()
  })

  it('reads a live process whose start has passed as ONGOING', () => {
    const { result } = renderHook(() => useProcessStatus(scheduled('2026-09-01T09:00:00Z')))
    expect(result.current).toBe('ONGOING')
  })

  it('reads a live process without a start date as ONGOING', () => {
    // Processes published before the backend backfilled startDate.
    const { result } = renderHook(() => useProcessStatus(scheduled(undefined)))
    expect(result.current).toBe('ONGOING')
  })

  it('reads a live process as UPCOMING until its start, then flips to ONGOING on its own', () => {
    const { result } = renderHook(() => useProcessStatus(scheduled('2026-09-15T12:00:10Z')))
    expect(result.current).toBe('UPCOMING')

    act(() => {
      vi.advanceTimersByTime(9_999)
    })
    expect(result.current).toBe('UPCOMING')

    // No refetch involved: the flip is driven purely by the clock.
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current).toBe('ONGOING')
  })

  it('flips at a start beyond the timer ceiling by re-arming in chunks', () => {
    const days = 24 * 60 * 60 * 1000
    const start = new Date(NOW.getTime() + 40 * days)
    const { result } = renderHook(() => useProcessStatus(scheduled(start.toISOString())))
    expect(result.current).toBe('UPCOMING')

    // A naive setTimeout(40 days) overflows and fires immediately, which
    // would still read UPCOMING here — so also check the flip actually lands.
    act(() => {
      vi.advanceTimersByTime(30 * days)
    })
    expect(result.current).toBe('UPCOMING')

    act(() => {
      vi.advanceTimersByTime(10 * days)
    })
    expect(result.current).toBe('ONGOING')
  })

  it('re-arms when the election (and its start date) changes', () => {
    const { result, rerender } = renderHook(({ e }) => useProcessStatus(e), {
      initialProps: { e: scheduled('2026-09-01T09:00:00Z') },
    })
    expect(result.current).toBe('ONGOING')

    rerender({ e: scheduled('2026-09-15T12:00:05Z') })
    expect(result.current).toBe('UPCOMING')

    act(() => {
      vi.advanceTimersByTime(5_000)
    })
    expect(result.current).toBe('ONGOING')
  })
})

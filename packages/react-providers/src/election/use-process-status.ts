import type { QuestionStatus, VotingProcessResponse } from '@vocdoni/api-types'
import { computeProcessStatus, isBeforeStart } from '@vocdoni/api-client'
import { useEffect, useState } from 'react'

/** `setTimeout`'s ceiling (2^31 − 1 ms ≈ 24.8 days); a longer delay overflows and fires at once. */
const MAX_TIMEOUT_MS = 2_147_483_647

/**
 * Process status honouring the scheduled start: a live question reads as
 * `UPCOMING` until `startDate` passes. Nothing on the wire changes then, so a
 * refetch would never flip it — a timer re-renders at the start instant.
 */
export function useProcessStatus(election: VotingProcessResponse | null | undefined): QuestionStatus | null {
  const startDate = election?.startDate
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!isBeforeStart(startDate)) return
    const remaining = new Date(startDate as string).getTime() - Date.now()
    // Re-arm in chunks for starts beyond the timer ceiling: the re-render
    // re-runs this effect, which measures the remaining delay afresh.
    const timer = setTimeout(() => setTick((t) => t + 1), Math.min(remaining, MAX_TIMEOUT_MS))
    return () => clearTimeout(timer)
  }, [startDate, tick])

  return election ? computeProcessStatus(election.questions, { startDate }) : null
}

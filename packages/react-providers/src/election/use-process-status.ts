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
  // One clock read for both, so the gate and the status can never disagree and
  // leave a process stranded on `UPCOMING` with no timer armed.
  const now = new Date()
  const beforeStart = isBeforeStart(startDate, now)

  useEffect(() => {
    if (!beforeStart || !startDate) return
    const remaining = new Date(startDate).getTime() - Date.now()
    // Clamped at 0 so a start that elapsed between render and commit settles at
    // once; capped at the ceiling so a far-off start re-arms on the re-render.
    const timer = setTimeout(() => setTick((t) => t + 1), Math.max(0, Math.min(remaining, MAX_TIMEOUT_MS)))
    return () => clearTimeout(timer)
  }, [beforeStart, startDate, tick])

  return election ? computeProcessStatus(election.questions, { startDate, now }) : null
}

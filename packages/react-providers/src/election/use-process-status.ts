import type { QuestionStatus, VotingProcessResponse } from '@vocdoni/api-types'
import { computeProcessStatus, isBeforeStart } from '@vocdoni/api-client'
import { useEffect, useState } from 'react'

/** `setTimeout`'s ceiling (2^31 − 1 ms ≈ 24.8 days); a longer delay overflows and fires at once. */
const MAX_TIMEOUT_MS = 2_147_483_647

/**
 * Derives the process status from its questions, honouring the scheduled
 * start: a live (`READY`) question of a process whose `startDate` is still
 * ahead reads as `UPCOMING`, because the chain refuses votes until then even
 * though the wire status does not change at the start.
 *
 * Since nothing on the wire changes when the start passes, a refetch would
 * not flip the status — so the hook arms a timer for the start instant and
 * re-renders then, turning `UPCOMING` into `ONGOING` without a reload.
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

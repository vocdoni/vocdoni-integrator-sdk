import { describe, expect, it } from 'vitest'
import type {
  VotingProcessQuestion,
  VotingProcessResponse,
  VotingProcessResultsResponse,
} from '@vocdoni/api-types'
import {
  computeProcessStatus,
  hasResults,
  isBeforeStart,
  isLive,
  isSecretUntilTheEnd,
  isUpcoming,
  normalizeQuestionStatus,
  normalizeVotingProcess,
  processVoteCount,
} from './election-status'

const q = (status: VotingProcessQuestion['status']): VotingProcessQuestion =>
  ({ status } as VotingProcessQuestion)

/** The wire's live-question name that QuestionStatus doesn't declare. */
const READY = 'READY' as VotingProcessQuestion['status']

const base: VotingProcessResponse = {
  id: 'proc-1',
  orgAddress: '0000000000000000000000000000000000000001',
  title: { default: 'Test process' },
  startDate: '2024-01-01T00:00:00Z',
  endDate: '2024-12-31T23:59:59Z',
  published: true,
  census: {},
  questions: [],
}

describe('normalizeQuestionStatus', () => {
  it('maps the wire READY to ONGOING — same semantic state', () => {
    expect(normalizeQuestionStatus('READY')).toBe('ONGOING')
  })

  it('passes every declared status through untouched', () => {
    for (const s of ['PROCESS_UNKNOWN', 'UPCOMING', 'ONGOING', 'ENDED', 'CANCELED', 'PAUSED', 'RESULTS']) {
      expect(normalizeQuestionStatus(s)).toBe(s)
    }
  })
})

describe('normalizeVotingProcess', () => {
  it('normalizes every question status of a process read', () => {
    const normalized = normalizeVotingProcess({ ...base, questions: [q(READY), q('ENDED')] })
    expect(normalized.questions.map((x) => x.status)).toEqual(['ONGOING', 'ENDED'])
  })
})

describe('isLive', () => {
  it('is true when the process status is ONGOING', () => {
    const p: VotingProcessResponse = { ...base, questions: [q('ONGOING')] }
    expect(isLive(p)).toBe(true)
  })

  it('is false when the process status is UPCOMING', () => {
    const p: VotingProcessResponse = { ...base, questions: [q('UPCOMING')] }
    expect(isLive(p)).toBe(false)
  })

  it('is false when the process status is PAUSED', () => {
    const p: VotingProcessResponse = { ...base, questions: [q('PAUSED')] }
    expect(isLive(p)).toBe(false)
  })

  it('is false when the process status is ENDED', () => {
    const p: VotingProcessResponse = { ...base, questions: [q('ENDED')] }
    expect(isLive(p)).toBe(false)
  })

  it('is false when the process status is CANCELED', () => {
    const p: VotingProcessResponse = { ...base, questions: [q('CANCELED')] }
    expect(isLive(p)).toBe(false)
  })

  it('is true when any question is ONGOING (mixed)', () => {
    const p: VotingProcessResponse = { ...base, questions: [q('ENDED'), q('ONGOING')] }
    expect(isLive(p)).toBe(true)
  })

  it('is true for the wire READY status — raw data that skipped the client', () => {
    const p: VotingProcessResponse = { ...base, questions: [q(READY)] }
    expect(isLive(p)).toBe(true)
    expect(computeProcessStatus(p.questions)).toBe('ONGOING')
    // Mixed with a non-live status, READY still wins as ONGOING (rule 1).
    expect(computeProcessStatus([q('ENDED'), q(READY)])).toBe('ONGOING')
  })

  it('is false when no questions', () => {
    expect(isLive(base)).toBe(false)
  })
})

describe('isUpcoming', () => {
  it('is true when the process status is UPCOMING', () => {
    const p: VotingProcessResponse = { ...base, questions: [q('UPCOMING')] }
    expect(isUpcoming(p)).toBe(true)
  })

  it('is false when status is ONGOING', () => {
    const p: VotingProcessResponse = { ...base, questions: [q('ONGOING')] }
    expect(isUpcoming(p)).toBe(false)
  })

  it('is false when status is PAUSED', () => {
    const p: VotingProcessResponse = { ...base, questions: [q('PAUSED')] }
    expect(isUpcoming(p)).toBe(false)
  })

  it('is false when status is CANCELED', () => {
    const p: VotingProcessResponse = { ...base, questions: [q('CANCELED')] }
    expect(isUpcoming(p)).toBe(false)
  })
})

describe('hasResults', () => {
  it('is true when all questions are RESULTS', () => {
    const p: VotingProcessResponse = { ...base, questions: [q('RESULTS'), q('RESULTS')] }
    expect(hasResults(p)).toBe(true)
  })

  it('is false when status is ENDED (results still computing)', () => {
    const p: VotingProcessResponse = { ...base, questions: [q('ENDED')] }
    expect(hasResults(p)).toBe(false)
  })

  it('is false when mixed ENDED+RESULTS (ENDED status)', () => {
    const p: VotingProcessResponse = { ...base, questions: [q('ENDED'), q('RESULTS')] }
    expect(hasResults(p)).toBe(false)
  })

  it('is false when status is ONGOING', () => {
    const p: VotingProcessResponse = { ...base, questions: [q('ONGOING')] }
    expect(hasResults(p)).toBe(false)
  })
})

describe('computeProcessStatus', () => {
  it('returns PROCESS_UNKNOWN for an empty question list', () => {
    expect(computeProcessStatus([])).toBe('PROCESS_UNKNOWN')
  })

  it('returns ONGOING when any question is ONGOING', () => {
    expect(computeProcessStatus([q('ONGOING'), q('ENDED')])).toBe('ONGOING')
    expect(computeProcessStatus([q('RESULTS'), q('ONGOING'), q('PAUSED')])).toBe('ONGOING')
  })

  it('returns ENDED when all questions are ENDED or RESULTS (results still computing)', () => {
    expect(computeProcessStatus([q('ENDED'), q('RESULTS')])).toBe('ENDED')
    expect(computeProcessStatus([q('RESULTS'), q('ENDED'), q('ENDED')])).toBe('ENDED')
  })

  it('returns RESULTS when all questions are RESULTS', () => {
    expect(computeProcessStatus([q('RESULTS'), q('RESULTS')])).toBe('RESULTS')
  })

  it('returns the shared status when all questions agree', () => {
    expect(computeProcessStatus([q('PAUSED'), q('PAUSED')])).toBe('PAUSED')
    expect(computeProcessStatus([q('CANCELED'), q('CANCELED')])).toBe('CANCELED')
    expect(computeProcessStatus([q('UPCOMING'), q('UPCOMING')])).toBe('UPCOMING')
    expect(computeProcessStatus([q('ENDED'), q('ENDED')])).toBe('ENDED')
    expect(computeProcessStatus([q('ONGOING')])).toBe('ONGOING')
  })

  it('returns PROCESS_UNKNOWN for an unresolvable mixed state', () => {
    expect(computeProcessStatus([q('PAUSED'), q('ENDED')])).toBe('PROCESS_UNKNOWN')
    expect(computeProcessStatus([q('CANCELED'), q('PAUSED')])).toBe('PROCESS_UNKNOWN')
    expect(computeProcessStatus([q('UPCOMING'), q('PAUSED')])).toBe('PROCESS_UNKNOWN')
    // ENDED+CANCELED: CANCELED is terminal but not ENDED/RESULTS, so the mix is unresolvable
    expect(computeProcessStatus([q('ENDED'), q('CANCELED')])).toBe('PROCESS_UNKNOWN')
  })
})

describe('computeProcessStatus with startDate (scheduled processes)', () => {
  // The backend reports a scheduled-but-not-started question as READY (the
  // chain has no UPCOMING state), yet the chain rejects votes until the start.
  const now = new Date('2026-09-15T12:00:00Z')
  const future = '2026-09-29T09:00:00Z'
  const past = '2026-09-01T09:00:00Z'

  it('reads a live question as UPCOMING while the start date is ahead', () => {
    expect(computeProcessStatus([q(READY)], { startDate: future, now })).toBe('UPCOMING')
    expect(computeProcessStatus([q('ONGOING'), q('ONGOING')], { startDate: future, now })).toBe('UPCOMING')
    expect(computeProcessStatus([q(READY)], { startDate: new Date(future), now })).toBe('UPCOMING')
  })

  it('reads a live question as ONGOING once the start date has passed', () => {
    expect(computeProcessStatus([q(READY)], { startDate: past, now })).toBe('ONGOING')
    // Exactly at the start instant voting is open.
    expect(computeProcessStatus([q(READY)], { startDate: now.toISOString(), now })).toBe('ONGOING')
  })

  it('leaves non-live statuses untouched before the start', () => {
    expect(computeProcessStatus([q('PAUSED'), q('PAUSED')], { startDate: future, now })).toBe('PAUSED')
    expect(computeProcessStatus([q('CANCELED')], { startDate: future, now })).toBe('CANCELED')
    expect(computeProcessStatus([q('ENDED'), q('RESULTS')], { startDate: future, now })).toBe('ENDED')
  })

  it('does not let a live question win the mix while before the start', () => {
    // Rule 1 (any ONGOING wins) must not apply to a question that is really
    // UPCOMING — otherwise the mix would read as votable.
    expect(computeProcessStatus([q(READY), q('PAUSED')], { startDate: future, now })).toBe('PROCESS_UNKNOWN')
  })

  it('treats a missing or unparseable start date as already started', () => {
    expect(computeProcessStatus([q(READY)], { startDate: undefined, now })).toBe('ONGOING')
    expect(computeProcessStatus([q(READY)], { startDate: null, now })).toBe('ONGOING')
    expect(computeProcessStatus([q(READY)], { startDate: '', now })).toBe('ONGOING')
    expect(computeProcessStatus([q(READY)], { startDate: 'not a date', now })).toBe('ONGOING')
  })

  it('defaults `now` to the current time', () => {
    const inAnHour = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    const anHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    expect(computeProcessStatus([q(READY)], { startDate: inAnHour })).toBe('UPCOMING')
    expect(computeProcessStatus([q(READY)], { startDate: anHourAgo })).toBe('ONGOING')
  })

  it('isLive / isUpcoming honour the process start date', () => {
    const scheduled: VotingProcessResponse = { ...base, startDate: future, questions: [q(READY)] }
    expect(isLive(scheduled, now)).toBe(false)
    expect(isUpcoming(scheduled, now)).toBe(true)
    // Past the start, the same process is live.
    const later = new Date('2026-09-29T09:00:01Z')
    expect(isLive(scheduled, later)).toBe(true)
    expect(isUpcoming(scheduled, later)).toBe(false)
  })
})

describe('isBeforeStart', () => {
  const now = new Date('2026-09-15T12:00:00Z')

  it('is true only for a parseable start after now', () => {
    expect(isBeforeStart('2026-09-16T12:00:00Z', now)).toBe(true)
    expect(isBeforeStart(new Date('2026-09-16T12:00:00Z'), now)).toBe(true)
    expect(isBeforeStart('2026-09-15T12:00:00Z', now)).toBe(false)
    expect(isBeforeStart('2026-09-14T12:00:00Z', now)).toBe(false)
  })

  it('is false for missing or unparseable dates', () => {
    expect(isBeforeStart(undefined, now)).toBe(false)
    expect(isBeforeStart(null, now)).toBe(false)
    expect(isBeforeStart('', now)).toBe(false)
    expect(isBeforeStart('garbage', now)).toBe(false)
  })
})

describe('isSecretUntilTheEnd', () => {
  const secretQ = (secret: boolean): VotingProcessQuestion =>
    ({ status: 'ONGOING', secretUntilTheEnd: secret } as VotingProcessQuestion)

  it('is true when any question hides tallies until the end', () => {
    expect(isSecretUntilTheEnd({ ...base, questions: [secretQ(false), secretQ(true)] })).toBe(true)
  })

  it('is false when no question is secret', () => {
    expect(isSecretUntilTheEnd({ ...base, questions: [secretQ(false)] })).toBe(false)
    expect(isSecretUntilTheEnd(base)).toBe(false)
  })
})

describe('processVoteCount', () => {
  const results = (...voteCounts: number[]): VotingProcessResultsResponse => ({
    id: base.id,
    questions: voteCounts.map((voteCount, i) => ({
      questionId: `q-${i}`,
      status: 'RESULTS',
      voteCount,
      startDate: base.startDate,
      endDate: base.endDate,
      finalResults: true,
    })),
  })

  it('returns the highest per-question count (unique ballots, not a sum)', () => {
    expect(processVoteCount(results(10, 8, 10))).toBe(10)
  })

  it('returns 0 for missing results or an empty question list', () => {
    expect(processVoteCount(undefined)).toBe(0)
    expect(processVoteCount(null)).toBe(0)
    expect(processVoteCount(results())).toBe(0)
  })
})

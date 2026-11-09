import type { JobsResponse, JobStatusResponse } from '@vocdoni/api-types'
import type { UpFetch } from 'up-fetch'
import { handleError, VocdoniApiError } from './errors'

/**
 * Default `waitFor` deadline. A tx job stays pending while it waits for a relay worker and then
 * for its block, which takes longer than a minute when many votes arrive at once; giving up
 * earlier reports a vote as failed that is included later. The backend settles every job: one
 * whose worker stopped is marked failed within minutes.
 */
const DEFAULT_JOB_TIMEOUT_MS = 5 * 60_000
/** Default cap of the poll interval, which grows from `intervalMs` while the job is pending. */
const DEFAULT_MAX_INTERVAL_MS = 5_000
/**
 * Default time polls may keep failing in a row before `waitFor` gives up, counted from the last
 * poll that got an answer. It bounds an outage independently of the job deadline, which callers
 * such as `publishAndWait` leave infinite.
 */
const DEFAULT_MAX_FAILING_MS = 60_000
/** Growth factor of the poll interval after each pending poll. */
const INTERVAL_BACKOFF = 1.5
/** Each wait is randomized down by up to this fraction, so voters who sent together do not poll together. */
const INTERVAL_JITTER = 0.2
/**
 * Messages fetch implementations give the TypeError of a request that never got a response
 * (Chromium, Firefox, Safari, undici, cross-fetch). Other TypeErrors, such as an invalid URL or
 * header, are programming errors that a retry cannot fix.
 */
const NETWORK_ERROR_MESSAGES = new Set([
  'Failed to fetch',
  'NetworkError when attempting to fetch resource.',
  'Load failed',
  'The Internet connection appears to be offline.',
  'network error',
  'fetch failed',
  'terminated',
  'Network request failed',
])

export interface WaitForJobOptions {
  /** First poll interval in ms; it grows ×1.5 per pending poll up to `maxIntervalMs`. Default 1000. */
  intervalMs?: number
  /** Cap of the poll interval in ms. Default 5000, or `intervalMs` when larger. */
  maxIntervalMs?: number
  /**
   * Max time to wait before giving up, in ms. Default 300000 (5 min). Transient poll failures
   * (network errors, 429, 502, 503, 504) are retried until then, or until `maxFailingMs`.
   */
  timeoutMs?: number
  /**
   * Max time polls may keep failing transiently in a row, in ms, counted from the last poll that
   * got an answer; the last failure is then rethrown. Default 60000 (1 min).
   */
  maxFailingMs?: number
  /** Abort signal to cancel polling. */
  signal?: AbortSignal
  /**
   * When set, a completed job whose `type` does not match this value throws
   * instead of resolving silently — guards against polling the wrong job id.
   */
  expectType?: string
  /**
   * Called with every polled job state, including the terminal one. Lets
   * callers observe intermediate progress — e.g. the per-envelope
   * `result.votes` of a `relay_votes` batch, whose entries settle one by one
   * while the job is still pending. Exceptions thrown by the callback abort
   * the wait.
   */
  onPoll?: (job: JobStatusResponse) => void
}

/** Thrown when a polled job ends in the `failed` state. */
export class JobFailedError extends Error {
  constructor(public readonly job: JobStatusResponse) {
    super(job.errors?.length ? job.errors.join('; ') : `Job ${job.jobId} failed`)
    this.name = 'JobFailedError'
  }
}

/** Whether a failed poll is worth retrying: the job may still settle. */
const isTransientPollError = (err: unknown) =>
  err instanceof VocdoniApiError
    ? err.status === 429 || err.status === 502 || err.status === 503 || err.status === 504
    : err instanceof TypeError && NETWORK_ERROR_MESSAGES.has(err.message)

const jittered = (ms: number) => ms * (1 - Math.random() * INTERVAL_JITTER)

const delay = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const onAbort = () => {
      clearTimeout(id)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    const id = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })

/**
 * Client for async transaction jobs (vote relay, publish, status change…).
 * Long-running backend transactions return a jobId; poll until completion.
 */
export class JobsClient {
  constructor(private readonly fetch: UpFetch) {}

  async get(jobId: string, signal?: AbortSignal): Promise<JobStatusResponse> {
    return this.fetch<JobStatusResponse>(`/jobs/${jobId}`, { signal }).catch(handleError)
  }

  /**
   * List an organization's async jobs (member/census imports and tx jobs: publish, status
   * change, census update, vote relay), newest first. Requires Manager/Admin of the org.
   * @param params.orgAddress Organization address (required).
   * @param params.type Filter by job type, e.g. `org_members`, `census_participants`, `relay_vote`.
   */
  async list(params: {
    orgAddress: string
    type?: string
    page?: number
    limit?: number
  }): Promise<JobsResponse> {
    return this.fetch<JobsResponse>('/jobs', { params }).catch(handleError)
  }

  /**
   * Poll a job until it reaches a terminal state, backing off from `intervalMs` to
   * `maxIntervalMs` and retrying transient poll failures for up to `maxFailingMs` in a row,
   * waiting at least their `Retry-After`.
   * @returns The completed job (status `completed`).
   * @throws {JobFailedError} when the job ends as `failed`.
   */
  async waitFor(jobId: string, opts: WaitForJobOptions = {}): Promise<JobStatusResponse> {
    const {
      intervalMs = 1000,
      timeoutMs = DEFAULT_JOB_TIMEOUT_MS,
      maxFailingMs = DEFAULT_MAX_FAILING_MS,
      signal,
      expectType,
      onPoll,
    } = opts
    const maxIntervalMs = Math.max(opts.maxIntervalMs ?? DEFAULT_MAX_INTERVAL_MS, intervalMs)
    const deadline = Date.now() + timeoutMs
    let answeredAt = Date.now()
    let interval = intervalMs

    for (;;) {
      signal?.throwIfAborted()
      let job: JobStatusResponse | undefined
      let retryAfterMs = 0
      try {
        job = await this.get(jobId, signal)
        answeredAt = Date.now()
      } catch (err) {
        signal?.throwIfAborted()
        const now = Date.now()
        if (!isTransientPollError(err) || now >= deadline || now - answeredAt >= maxFailingMs) throw err
        retryAfterMs = (err instanceof VocdoniApiError && err.retryAfterMs) || 0
      }
      signal?.throwIfAborted()
      if (job) {
        onPoll?.(job)
        if (job.status === 'completed') {
          if (expectType && job.type !== expectType) {
            throw new Error(`Job ${jobId} completed with unexpected type "${job.type}" (expected "${expectType}")`)
          }
          return job
        }
        if (job.status === 'failed') throw new JobFailedError(job)
      }
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for job ${jobId} after ${timeoutMs}ms`)
      }
      // a failing streak wakes up once more at its limit, so it rethrows the failure then
      const until = job ? deadline : Math.min(deadline, answeredAt + maxFailingMs)
      const wait = Math.max(jittered(interval), retryAfterMs)
      await delay(Math.min(wait, Math.max(until - Date.now(), 0)), signal)
      interval = Math.min(interval * INTERVAL_BACKOFF, maxIntervalMs)
    }
  }
}

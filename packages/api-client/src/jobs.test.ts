import type { QuestionJobResult } from '@vocdoni/api-types'
import { http, HttpResponse } from 'msw'
import { server } from '../../../mocks/server'
import { VocdoniApiClient } from './client'
import { JobFailedError } from './jobs'

const BASE_URL = 'http://localhost'
const ORG = '0xorg'

describe('jobs.list', () => {
  let client: VocdoniApiClient

  beforeEach(() => {
    client = new VocdoniApiClient({ apiUrl: BASE_URL })
  })

  it('GETs /jobs with orgAddress, type, page and limit as query params', async () => {
    let search: URLSearchParams | undefined
    server.use(
      http.get(`${BASE_URL}/jobs`, ({ request }) => {
        search = new URL(request.url).searchParams
        return HttpResponse.json({
          jobs: [{ jobId: 'j1', type: 'org_members', status: 'completed' }],
        })
      }),
    )

    const res = await client.jobs.list({ orgAddress: ORG, type: 'org_members', page: 2, limit: 5 })
    expect(res.jobs).toHaveLength(1)
    expect(res.jobs[0].jobId).toBe('j1')
    expect(search?.get('orgAddress')).toBe(ORG)
    expect(search?.get('type')).toBe('org_members')
    expect(search?.get('page')).toBe('2')
    expect(search?.get('limit')).toBe('5')
  })
})

describe('jobs.waitFor', () => {
  let client: VocdoniApiClient

  beforeEach(() => {
    client = new VocdoniApiClient({ apiUrl: BASE_URL })
  })

  it('resolves as before when expectType is not set, even if types differ', async () => {
    server.use(
      http.get(`${BASE_URL}/jobs/:jobId`, ({ params }) =>
        HttpResponse.json({
          jobId: params.jobId as string,
          status: 'completed',
          type: 'set_process_status',
          result: {},
        }),
      ),
    )

    const job = await client.jobs.waitFor('job-1')
    expect(job.status).toBe('completed')
    expect(job.type).toBe('set_process_status')
  })

  it('rejects when a completed job has a type that does not match expectType', async () => {
    server.use(
      http.get(`${BASE_URL}/jobs/:jobId`, ({ params }) =>
        HttpResponse.json({
          jobId: params.jobId as string,
          status: 'completed',
          type: 'set_process_status',
          result: {},
        }),
      ),
    )

    await expect(client.jobs.waitFor('job-1', { expectType: 'relay_vote' })).rejects.toThrow(
      'Job job-1 completed with unexpected type "set_process_status" (expected "relay_vote")',
    )
  })

  it('resolves when the completed job type matches expectType', async () => {
    server.use(
      http.get(`${BASE_URL}/jobs/:jobId`, ({ params }) =>
        HttpResponse.json({
          jobId: params.jobId as string,
          status: 'completed',
          type: 'relay_vote',
          result: { voteID: 'nullifier-job-1' },
        }),
      ),
    )

    const job = await client.jobs.waitFor('job-1', { expectType: 'relay_vote' })
    expect(job.status).toBe('completed')
    expect(job.type).toBe('relay_vote')
  })

  it('throws JobFailedError with the joined errors when the job fails', async () => {
    server.use(
      http.get(`${BASE_URL}/jobs/failed-1`, () =>
        HttpResponse.json({
          jobId: 'failed-1',
          type: 'org_members',
          status: 'failed',
          errors: ['row 3: invalid email', 'row 7: duplicate memberNumber'],
        }),
      ),
    )

    await expect(client.jobs.waitFor('failed-1', { intervalMs: 1 })).rejects.toMatchObject({
      name: 'JobFailedError',
      message: 'row 3: invalid email; row 7: duplicate memberNumber',
    })
  })

  it('falls back to a generic message when the job has no errors', async () => {
    server.use(
      http.get(`${BASE_URL}/jobs/failed-2`, () =>
        HttpResponse.json({ jobId: 'failed-2', type: 'relay_vote', status: 'failed' }),
      ),
    )

    let caught: unknown
    try {
      await client.jobs.waitFor('failed-2', { intervalMs: 1 })
    } catch (err) {
      caught = err
    }

    expect(caught).toBeInstanceOf(JobFailedError)
    expect((caught as Error).message).toBe('Job failed-2 failed')
  })

  it('calls onPoll with every polled state, including the terminal one', async () => {
    let polls = 0
    server.use(
      http.get(`${BASE_URL}/jobs/:jobId`, ({ params }) => {
        polls++
        // First poll pending (with a settling per-vote entry), then completed.
        return HttpResponse.json({
          jobId: params.jobId as string,
          status: polls === 1 ? 'pending' : 'completed',
          type: 'relay_votes',
          result: {
            votes: [
              { processId: 'aa', nullifier: 'n-0', status: polls === 1 ? 'pending' : 'completed' },
            ],
          },
        })
      }),
    )

    const seen: string[] = []
    const job = await client.jobs.waitFor('batch-1', {
      intervalMs: 5,
      onPoll: (j) => seen.push(`${j.status}:${j.result?.votes?.[0]?.status}`),
    })

    expect(job.status).toBe('completed')
    expect(seen).toEqual(['pending:pending', 'completed:completed'])
  })

  it('returns per-question census outcomes typed on result.questions', async () => {
    server.use(
      http.get(`${BASE_URL}/jobs/census-1`, () =>
        HttpResponse.json({
          jobId: 'census-1',
          status: 'completed',
          type: 'set_process_census',
          result: {
            questions: [
              { questionId: 'q-0', status: 'completed' },
              { questionId: 'q-1', noOp: true },
            ],
          },
        }),
      ),
    )

    const job = await client.jobs.waitFor('census-1', { intervalMs: 1 })
    const questions: QuestionJobResult[] = job.result?.questions ?? []
    expect(questions).toHaveLength(2)
    expect(questions[0]).toMatchObject({ questionId: 'q-0', status: 'completed' })
    expect(questions[1].noOp).toBe(true)
  })
})

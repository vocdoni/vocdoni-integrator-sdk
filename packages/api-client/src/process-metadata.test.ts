import type { VotingProcessMetadata } from '@vocdoni/api-types'
import { http, HttpResponse } from 'msw'
import { server } from '../../../mocks/server'
import { vi } from 'vitest'
import { VocdoniApiClient } from './client'
import { METADATA_UPDATE_TIMEOUT_MS } from './elections'
import { VocdoniApiError } from './errors'
import { JobFailedError, JobsClient } from './jobs'

const BASE_URL = 'http://localhost'
const PROCESS_ID = '0123456789abcdef01234567'

const METADATA: VotingProcessMetadata = {
  title: { default: 'Board election' },
  description: { default: 'Pick the next board' },
  header: 'https://example.com/header.png',
  questions: [
    {
      title: { default: 'President' },
      choices: [
        {
          title: { default: 'Alice' },
          meta: {
            description: 'Current treasurer',
            image: { default: 'https://cdn.example/alice.jpeg', thumbnail: 'https://cdn.example/alice-t.jpeg' },
            slogan: 'Keep it running',
          },
        },
        { title: { default: 'Bob' }, meta: { image: 'https://cdn.example/bob.jpeg' } },
        { title: { default: 'Carol' } },
      ],
    },
  ],
}

const PARENT_OUTCOME = {
  processId: 'bb'.repeat(32),
  metadataURL: 'https://example.com/parent.json',
  metadataHash: 'cc'.repeat(32),
  status: 'completed',
}
const QUESTION_OUTCOME = { ...PARENT_OUTCOME, questionId: 'q-0', processId: 'aa'.repeat(32) }

describe('process metadata', () => {
  let client: VocdoniApiClient

  beforeEach(() => {
    client = new VocdoniApiClient({ apiUrl: BASE_URL })
  })

  it('reads the process text from GET /processes/{id}/metadata', async () => {
    server.use(
      http.get(`${BASE_URL}/processes/${PROCESS_ID}/metadata`, () => HttpResponse.json(METADATA)),
    )

    await expect(client.elections.getProcessMetadata(PROCESS_ID)).resolves.toEqual(METADATA)
  })

  it('PUTs the text and resolves to undefined when a draft is updated in place', async () => {
    let body: unknown
    server.use(
      http.put(`${BASE_URL}/processes/${PROCESS_ID}/metadata`, async ({ request }) => {
        body = await request.json()
        return new HttpResponse(null, { status: 200 })
      }),
    )

    await expect(client.elections.updateProcessMetadata(PROCESS_ID, METADATA)).resolves.toBeUndefined()
    expect(body).toEqual(METADATA)
  })

  it('resolves to the job when a published process is updated on chain', async () => {
    server.use(
      http.put(`${BASE_URL}/processes/${PROCESS_ID}/metadata`, () =>
        HttpResponse.json({ jobId: 'meta-job' }, { status: 202 }),
      ),
    )

    await expect(client.elections.updateProcessMetadata(PROCESS_ID, METADATA)).resolves.toEqual({
      jobId: 'meta-job',
    })
  })

  it('surfaces a shape mismatch as a VocdoniApiError', async () => {
    server.use(
      http.put(`${BASE_URL}/processes/${PROCESS_ID}/metadata`, () =>
        HttpResponse.json({ error: 'question count mismatch', code: 40004 }, { status: 400 }),
      ),
    )

    await expect(client.elections.updateProcessMetadata(PROCESS_ID, METADATA)).rejects.toMatchObject({
      name: 'VocdoniApiError',
      status: 400,
    })
    await expect(client.elections.updateProcessMetadata(PROCESS_ID, METADATA)).rejects.toBeInstanceOf(
      VocdoniApiError,
    )
  })

  describe('updateProcessMetadataAndWait', () => {
    it('waits for the on-chain update job of a published process', async () => {
      let polls = 0
      server.use(
        http.put(`${BASE_URL}/processes/${PROCESS_ID}/metadata`, () =>
          HttpResponse.json({ jobId: 'meta-job' }, { status: 202 }),
        ),
        http.get(`${BASE_URL}/jobs/meta-job`, () => {
          polls++
          return HttpResponse.json({
            jobId: 'meta-job',
            type: 'set_process_metadata',
            status: polls === 1 ? 'pending' : 'completed',
            result: { questions: [QUESTION_OUTCOME], parent: PARENT_OUTCOME },
          })
        }),
      )

      const job = await client.elections.updateProcessMetadataAndWait(PROCESS_ID, METADATA, { intervalMs: 1 })
      expect(polls).toBe(2)
      expect(job?.result?.questions).toEqual([QUESTION_OUTCOME])
      expect(job?.result?.parent).toEqual(PARENT_OUTCOME)
    })

    it('waits METADATA_UPDATE_TIMEOUT_MS by default, overridable per call', async () => {
      const waitFor = vi.spyOn(JobsClient.prototype, 'waitFor').mockResolvedValue({
        jobId: 'meta-job',
        type: 'set_process_metadata',
        status: 'completed',
      })
      server.use(
        http.put(`${BASE_URL}/processes/${PROCESS_ID}/metadata`, () =>
          HttpResponse.json({ jobId: 'meta-job' }, { status: 202 }),
        ),
      )

      try {
        await client.elections.updateProcessMetadataAndWait(PROCESS_ID, METADATA)
        expect(METADATA_UPDATE_TIMEOUT_MS).toBeGreaterThanOrEqual(16 * 60 * 1000)
        expect(waitFor).toHaveBeenLastCalledWith('meta-job', {
          expectType: 'set_process_metadata',
          timeoutMs: METADATA_UPDATE_TIMEOUT_MS,
        })

        await client.elections.updateProcessMetadataAndWait(PROCESS_ID, METADATA, { timeoutMs: 5 })
        expect(waitFor).toHaveBeenLastCalledWith('meta-job', {
          expectType: 'set_process_metadata',
          timeoutMs: 5,
        })
      } finally {
        waitFor.mockRestore()
      }
    })

    it('rejects a completed job of another type', async () => {
      server.use(
        http.put(`${BASE_URL}/processes/${PROCESS_ID}/metadata`, () =>
          HttpResponse.json({ jobId: 'meta-job' }, { status: 202 }),
        ),
        http.get(`${BASE_URL}/jobs/meta-job`, () =>
          HttpResponse.json({ jobId: 'meta-job', type: 'publish_voting_process', status: 'completed' }),
        ),
      )

      await expect(
        client.elections.updateProcessMetadataAndWait(PROCESS_ID, METADATA, { intervalMs: 1 }),
      ).rejects.toThrow('expected "set_process_metadata"')
    })

    it('does not poll when a draft is updated in place', async () => {
      let polled = false
      server.use(
        http.put(`${BASE_URL}/processes/${PROCESS_ID}/metadata`, () => new HttpResponse(null, { status: 200 })),
        http.get(`${BASE_URL}/jobs/:jobId`, () => {
          polled = true
          return HttpResponse.json({})
        }),
      )

      await expect(client.elections.updateProcessMetadataAndWait(PROCESS_ID, METADATA)).resolves.toBeUndefined()
      expect(polled).toBe(false)
    })

    it('throws JobFailedError when the on-chain update fails', async () => {
      server.use(
        http.put(`${BASE_URL}/processes/${PROCESS_ID}/metadata`, () =>
          HttpResponse.json({ jobId: 'meta-job' }, { status: 202 }),
        ),
        http.get(`${BASE_URL}/jobs/meta-job`, () =>
          HttpResponse.json({
            jobId: 'meta-job',
            type: 'set_process_metadata',
            status: 'failed',
            errors: ['question 0: tx failed'],
          }),
        ),
      )

      await expect(
        client.elections.updateProcessMetadataAndWait(PROCESS_ID, METADATA, { intervalMs: 1 }),
      ).rejects.toBeInstanceOf(JobFailedError)
    })
  })
})

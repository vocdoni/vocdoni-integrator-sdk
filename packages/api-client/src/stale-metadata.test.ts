import type { JobStatusResponse } from '@vocdoni/api-types'
import { http, HttpResponse } from 'msw'
import { server } from '../../../mocks/server'
import { VocdoniApiClient } from './client'
import { StaleMetadataError, VocdoniApiError } from './errors'
import { JobFailedError } from './jobs'
import { isStaleMetadataError, isStaleMetadataMessage } from './stale-metadata'

const BASE_URL = 'http://localhost'
const CHAIN_ERROR =
  'vote metadata hash abcd does not match the election metadata hash 1234'

const failedJob = (job: Partial<JobStatusResponse>): JobFailedError =>
  new JobFailedError({ jobId: 'j1', type: 'relay_votes', status: 'failed', ...job })

describe('stale election metadata', () => {
  let client: VocdoniApiClient

  beforeEach(() => {
    client = new VocdoniApiClient({ apiUrl: BASE_URL })
  })

  it('turns a 409 metadata rejection of the vote relay into a StaleMetadataError', async () => {
    server.use(
      http.post(`${BASE_URL}/votes`, () =>
        HttpResponse.json({ error: 'vote metadata changed', code: 40904 }, { status: 409 }),
      ),
    )

    let caught: unknown
    try {
      await client.elections.voteBatch({ votes: [{ txPayload: '00' }] })
    } catch (err) {
      caught = err
    }

    expect(caught).toBeInstanceOf(StaleMetadataError)
    expect(caught).toBeInstanceOf(VocdoniApiError)
    expect((caught as StaleMetadataError).status).toBe(409)
    expect((caught as StaleMetadataError).code).toBe(40904)
    expect(isStaleMetadataError(caught)).toBe(true)
  })

  it('keeps other 409s as plain VocdoniApiErrors, whatever their message says', async () => {
    server.use(
      http.post(`${BASE_URL}/votes`, () =>
        HttpResponse.json({ error: 'metadata already exists', code: 40901 }, { status: 409 }),
      ),
    )

    let caught: unknown
    try {
      await client.elections.voteBatch({ votes: [{ txPayload: '00' }] })
    } catch (err) {
      caught = err
    }

    expect(caught).toBeInstanceOf(VocdoniApiError)
    expect(caught).not.toBeInstanceOf(StaleMetadataError)
    expect(isStaleMetadataError(caught)).toBe(false)
  })

  it('recognizes the chain rejection on a failed vote job, per envelope or job-wide', () => {
    expect(
      isStaleMetadataError(
        failedJob({
          result: {
            votes: [
              { processId: 'p1', nullifier: 'n1', status: 'completed', voteID: 'n1' },
              { processId: 'p2', nullifier: 'n2', status: 'failed', error: CHAIN_ERROR },
            ],
          },
        }),
      ),
    ).toBe(true)
    expect(isStaleMetadataError(failedJob({ type: 'relay_vote', errors: [CHAIN_ERROR] }))).toBe(true)
    expect(isStaleMetadataError(failedJob({ errors: ['nullifier already exists'] }))).toBe(false)
  })

  it('recognizes the chain rejection text on any error, and nothing else', () => {
    expect(isStaleMetadataError(new Error(CHAIN_ERROR))).toBe(true)
    expect(isStaleMetadataError(new Error('nullifier already exists'))).toBe(false)
    expect(isStaleMetadataError(CHAIN_ERROR)).toBe(false)
    expect(isStaleMetadataMessage(CHAIN_ERROR)).toBe(true)
    expect(isStaleMetadataMessage(undefined)).toBe(false)
  })
})

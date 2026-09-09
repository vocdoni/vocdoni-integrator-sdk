import { http, HttpResponse } from 'msw'
import { server } from '../../../mocks/server'
import {
  mockAuthToken,
  mockElection,
  mockOrganization,
  mockProcess,
} from '../../../mocks/handlers'
import { ElectionsClient, ProcessesCspClient } from './elections'
import { VocdoniApiClient } from './client'

const BASE_URL = 'http://localhost'

describe('VocdoniApiClient', () => {
  let client: VocdoniApiClient

  beforeEach(() => {
    client = new VocdoniApiClient({ apiUrl: BASE_URL })
  })

  describe('elections.get', () => {
    it('returns process data for the given id', async () => {
      const process = await client.elections.get('abc123')
      expect(process.id).toBe('abc123')
      expect(process.title).toEqual(mockProcess.title)
      expect(process.published).toBe(true)
      expect(process.questions).toHaveLength(mockProcess.questions.length)
    })

    it('normalizes the wire READY question status to ONGOING', async () => {
      server.use(
        http.get(`${BASE_URL}/processes/:id`, ({ params }) =>
          HttpResponse.json({
            ...mockProcess,
            id: params.id as string,
            questions: [{ ...mockProcess.questions[0], status: 'READY' }],
          }),
        ),
      )
      const process = await client.elections.get('abc123')
      expect(process.questions[0].status).toBe('ONGOING')
    })
  })

  describe('elections.list', () => {
    it('serializes the published drafts filter — false must survive as published=false', async () => {
      const queries: Array<URLSearchParams> = []
      server.use(
        http.get(`${BASE_URL}/processes`, ({ request }) => {
          queries.push(new URL(request.url).searchParams)
          return HttpResponse.json({ processes: [], pagination: { total: 0 } })
        }),
      )

      // `false` is the manager-only drafts view: it must reach the wire, not
      // be dropped as falsy by the param serialization.
      await client.elections.list({ orgAddress: '0xabc', published: false })
      expect(queries[0].get('published')).toBe('false')

      await client.elections.list({ orgAddress: '0xabc', published: true })
      expect(queries[1].get('published')).toBe('true')

      // Omitted → absent, so the backend applies the caller's default view.
      await client.elections.list({ orgAddress: '0xabc' })
      expect(queries[2].has('published')).toBe(false)
    })
  })

  describe('elections.voteBatch', () => {
    it('relays the batch to POST /votes and returns the covering job id', async () => {
      let received: Array<{ txPayload: string }> | undefined
      server.use(
        http.post(`${BASE_URL}/votes`, async ({ request }) => {
          const body = (await request.json()) as { votes: Array<{ txPayload: string }> }
          received = body.votes
          return HttpResponse.json({ jobId: 'batch-1' }, { status: 202 })
        }),
      )

      const res = await client.elections.voteBatch({
        votes: [{ txPayload: 'aa' }, { txPayload: 'bb' }],
      })
      expect(res.jobId).toBe('batch-1')
      expect(received).toEqual([{ txPayload: 'aa' }, { txPayload: 'bb' }])
    })
  })

  describe('elections.vote', () => {
    it('relays the tx to POST /vote and returns an async job id', async () => {
      const payload = { txPayload: 'encoded-tx-payload' }
      const result = await client.elections.vote(payload)
      expect(result.jobId).toMatch(/^job-/)
    })
  })

  describe('organizations.get', () => {
    it('returns organization data for the given address', async () => {
      const org = await client.organizations.get('0xdeadbeef')
      expect(org.address).toBe('0xdeadbeef')
      expect(org.name).toEqual(mockOrganization.name)
    })
  })

  describe('auth header injection', () => {
    it('injects a static token into the Authorization header', async () => {
      let capturedAuth: string | null = null

      server.use(
        http.get(`${BASE_URL}/processes/:id`, ({ request }) => {
          capturedAuth = request.headers.get('Authorization')
          return HttpResponse.json({ ...mockProcess, id: 'abc123' })
        }),
      )

      const authedClient = new VocdoniApiClient({
        apiUrl: BASE_URL,
        authToken: 'my-static-token',
      })
      await authedClient.elections.get('abc123')

      expect(capturedAuth).toBe('Bearer my-static-token')
    })

    it('injects a token from a sync getter function', async () => {
      let capturedAuth: string | null = null

      server.use(
        http.get(`${BASE_URL}/processes/:id`, ({ request }) => {
          capturedAuth = request.headers.get('Authorization')
          return HttpResponse.json({ ...mockProcess, id: 'abc123' })
        }),
      )

      const authedClient = new VocdoniApiClient({
        apiUrl: BASE_URL,
        authToken: () => 'sync-getter-token',
      })
      await authedClient.elections.get('abc123')

      expect(capturedAuth).toBe('Bearer sync-getter-token')
    })

    it('injects a token from an async getter function', async () => {
      let capturedAuth: string | null = null

      server.use(
        http.get(`${BASE_URL}/processes/:id`, ({ request }) => {
          capturedAuth = request.headers.get('Authorization')
          return HttpResponse.json({ ...mockProcess, id: 'abc123' })
        }),
      )

      const authedClient = new VocdoniApiClient({
        apiUrl: BASE_URL,
        authToken: async () => 'async-getter-token',
      })
      await authedClient.elections.get('abc123')

      expect(capturedAuth).toBe('Bearer async-getter-token')
    })

    it('sends no Authorization header when no token is configured', async () => {
      let capturedAuth: string | null = null

      server.use(
        http.get(`${BASE_URL}/processes/:id`, ({ request }) => {
          capturedAuth = request.headers.get('Authorization')
          return HttpResponse.json({ ...mockProcess, id: 'abc123' })
        }),
      )

      await client.elections.get('abc123')

      expect(capturedAuth).toBeNull()
    })
  })

  describe('auth.login', () => {
    it('returns an AuthToken on successful email/password login', async () => {
      const token = await client.auth.login('user@example.com', 'secret')
      expect(token.token).toBe(mockAuthToken.token)
      expect(token.expirity).toBe(mockAuthToken.expirity)
    })
  })

  describe('deprecated `processes` alias', () => {
    it('is the very same instance as `elections`, so old call sites still work', async () => {
      expect(client.processes).toBe(client.elections)

      // Exercised through the alias, not just compared by identity.
      const process = await client.processes.get('abc123')
      expect(process.id).toBe('abc123')
    })

    it('exports ProcessesCspClient as an alias of ElectionsClient', () => {
      expect(ProcessesCspClient).toBe(ElectionsClient)
      expect(client.elections).toBeInstanceOf(ProcessesCspClient)
    })
  })

  describe('info', () => {
    it('reads GET /info without an API key', async () => {
      let auth: string | null = 'unset'
      server.use(
        http.get(`${BASE_URL}/info`, ({ request }) => {
          auth = request.headers.get('Authorization')
          return HttpResponse.json({ chainId: 'vocdoni/DEV/36', version: '1.2.3', goVersion: 'go1.22' })
        }),
      )

      const info = await client.info()
      expect(info.chainId).toBe('vocdoni/DEV/36')
      expect(info.version).toBe('1.2.3')
      expect(info.goVersion).toBe('go1.22')
      expect(auth).toBeNull()
    })
  })
})

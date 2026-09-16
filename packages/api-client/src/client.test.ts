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

  it('reads configuration properties defined on a class prototype', async () => {
    class ClientConfig {
      get apiUrl() { return BASE_URL }
      get authToken() { return 'prototype-token' }
      get lang() { return 'ca' }
    }

    const requests: Array<{ auth: string | null; lang: string | null }> = []
    server.use(
      http.get(`${BASE_URL}/processes/:id`, ({ request }) => {
        requests.push({
          auth: request.headers.get('Authorization'),
          lang: new URL(request.url).searchParams.get('lang'),
        })
        return HttpResponse.json(mockProcess)
      }),
    )

    const configuredClient = new VocdoniApiClient(new ClientConfig())
    await configuredClient.elections.get('abc123')

    expect(requests).toEqual([{ auth: 'Bearer prototype-token', lang: 'ca' }])
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

  describe('lang query param', () => {
    // The endpoint that motivates the whole feature: auth step 0 is what makes
    // the backend render and send the OTP email/SMS.
    const captureAuth0Query = () => {
      const queries: Array<URLSearchParams> = []
      server.use(
        http.post(`${BASE_URL}/processes/:processId/auth/0`, ({ request }) => {
          queries.push(new URL(request.url).searchParams)
          return HttpResponse.json({ authToken: 'csp-token' })
        }),
      )
      return queries
    }

    it('sends a statically configured lang on the OTP-triggering auth step 0', async () => {
      const queries = captureAuth0Query()

      const langClient = new VocdoniApiClient({ apiUrl: BASE_URL, lang: 'ca' })
      await langClient.elections.authStep0('abc123', { email: 'voter@example.com' })

      expect(queries[0].get('lang')).toBe('ca')
    })

    it('sends no lang param at all when none is configured', async () => {
      const queries = captureAuth0Query()

      await client.elections.authStep0('abc123', { email: 'voter@example.com' })

      expect(queries[0].has('lang')).toBe(false)
      expect(queries[0].toString()).toBe('')
    })

    it('applies a lang set after construction to the next request', async () => {
      const queries = captureAuth0Query()

      const langClient = new VocdoniApiClient({ apiUrl: BASE_URL, lang: 'ca' })
      await langClient.elections.authStep0('abc123', { email: 'voter@example.com' })

      // The voter switched locale mid-session: no re-instantiation, and the
      // change must land on the very next request.
      langClient.setLang('es')
      await langClient.elections.authStep0('abc123', { email: 'voter@example.com' })

      expect(queries[0].get('lang')).toBe('ca')
      expect(queries[1].get('lang')).toBe('es')
    })

    it('stops sending the param when lang is cleared with setLang(undefined)', async () => {
      const queries = captureAuth0Query()

      const langClient = new VocdoniApiClient({ apiUrl: BASE_URL, lang: 'ca' })
      langClient.setLang(undefined)
      await langClient.elections.authStep0('abc123', { email: 'voter@example.com' })

      expect(queries[0].has('lang')).toBe(false)
    })

    it('does not mutate the caller\'s config object when lang changes', async () => {
      const queries = captureAuth0Query()
      const config = { apiUrl: BASE_URL, lang: 'ca' }

      const langClient = new VocdoniApiClient(config)
      langClient.setLang('es')
      await langClient.elections.authStep0('abc123', { email: 'voter@example.com' })

      // The new lang is live on the wire, yet the object the caller still holds
      // (and may reuse for a second client) is untouched.
      expect(queries[0].get('lang')).toBe('es')
      expect(config.lang).toBe('ca')
    })

    it('resolves a lang getter per request, sync and async alike', async () => {
      const queries: Array<URLSearchParams> = []
      server.use(
        http.get(`${BASE_URL}/processes/:id`, ({ request, params }) => {
          queries.push(new URL(request.url).searchParams)
          return HttpResponse.json({ ...mockProcess, id: params.id as string })
        }),
      )

      // A getter is the point of the union type: the app's locale lives in a
      // store and the client reads it fresh on every call.
      let locale = 'ca'
      const syncClient = new VocdoniApiClient({ apiUrl: BASE_URL, lang: () => locale })
      await syncClient.elections.get('abc123')
      locale = 'es'
      await syncClient.elections.get('abc123')

      const asyncClient = new VocdoniApiClient({
        apiUrl: BASE_URL,
        lang: async () => 'eu',
      })
      await asyncClient.elections.get('abc123')

      expect(queries[0].get('lang')).toBe('ca')
      expect(queries[1].get('lang')).toBe('es')
      expect(queries[2].get('lang')).toBe('eu')
    })

    it('survives a throwing lang getter instead of failing the request', async () => {
      const queries = captureAuth0Query()

      // The classic shape: `lang: () => i18n.language` evaluated before the
      // i18n instance exists. A cosmetic preference must not break the vote
      // path — the request goes out, simply without the param.
      const langClient = new VocdoniApiClient({
        apiUrl: BASE_URL,
        lang: () => {
          throw new TypeError('i18n is not initialised yet')
        },
      })
      const res = await langClient.elections.authStep0('abc123', { email: 'voter@example.com' })

      expect(res.authToken).toBe('csp-token')
      expect(queries[0].has('lang')).toBe(false)
    })

    it('clears the lang with a bare setLang()', async () => {
      const queries = captureAuth0Query()

      const langClient = new VocdoniApiClient({ apiUrl: BASE_URL, lang: 'ca' })
      langClient.setLang()
      await langClient.elections.authStep0('abc123', { email: 'voter@example.com' })

      expect(queries[0].has('lang')).toBe(false)
    })

    it('rides alongside per-call params instead of clobbering them', async () => {
      const queries: Array<URLSearchParams> = []
      server.use(
        http.get(`${BASE_URL}/processes`, ({ request }) => {
          queries.push(new URL(request.url).searchParams)
          return HttpResponse.json({ processes: [], pagination: { total: 0 } })
        }),
      )

      const langClient = new VocdoniApiClient({ apiUrl: BASE_URL, lang: 'ca' })
      await langClient.elections.list({ orgAddress: '0xabc', published: false })

      expect(queries[0].get('lang')).toBe('ca')
      expect(queries[0].get('orgAddress')).toBe('0xabc')
      expect(queries[0].get('published')).toBe('false')
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

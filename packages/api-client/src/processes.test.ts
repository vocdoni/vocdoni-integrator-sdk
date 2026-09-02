import { http, HttpResponse } from 'msw'
import { server } from '../../../mocks/server'
import {
  MOCK_CSP_SIGNATURE,
  MOCK_PROCESS_ADDRESS,
  MOCK_WEIGHT_HEX,
  mockProcess,
} from '../../../mocks/handlers'
import { VocdoniApiClient } from './client'

const BASE_URL = 'http://localhost'
const PROCESS_ID = 'proc-1'

describe('ProcessesCspClient (voter CSP routes on /processes)', () => {
  let client: VocdoniApiClient

  beforeEach(() => {
    client = new VocdoniApiClient({ apiUrl: BASE_URL })
  })

  describe('authStep0', () => {
    it('POSTs the member fields to /processes/{id}/auth/0 and returns a token', async () => {
      let body: unknown
      server.use(
        http.post(`${BASE_URL}/processes/${PROCESS_ID}/auth/0`, async ({ request }) => {
          body = await request.json()
          return HttpResponse.json({ authToken: 'step0-token' })
        }),
      )

      const res = await client.processes.authStep0(PROCESS_ID, { memberNumber: '42' })
      expect(res.authToken).toBe('step0-token')
      expect(body).toEqual({ memberNumber: '42' })
    })
  })

  describe('authStep1', () => {
    it('POSTs the challenge solution to /processes/{id}/auth/1 and returns the verified token', async () => {
      let body: unknown
      server.use(
        http.post(`${BASE_URL}/processes/${PROCESS_ID}/auth/1`, async ({ request }) => {
          body = await request.json()
          return HttpResponse.json({ authToken: 'verified-token', weight: MOCK_WEIGHT_HEX })
        }),
      )

      const res = await client.processes.authStep1(PROCESS_ID, {
        authToken: 'step0-token',
        authData: ['123456'],
      })
      expect(res.authToken).toBe('verified-token')
      expect(res.weight).toBe(MOCK_WEIGHT_HEX)
      expect(body).toEqual({ authToken: 'step0-token', authData: ['123456'] })
    })
  })

  describe('resend', () => {
    it('POSTs the token + contact to /processes/{id}/auth/resend', async () => {
      let body: unknown
      server.use(
        http.post(`${BASE_URL}/processes/${PROCESS_ID}/auth/resend`, async ({ request }) => {
          body = await request.json()
          return HttpResponse.json({ authToken: 'step0-token' })
        }),
      )

      const res = await client.processes.resend(PROCESS_ID, {
        authToken: 'step0-token',
        email: 'v@example.com',
      })
      expect(res.authToken).toBe('step0-token')
      expect(body).toEqual({ authToken: 'step0-token', email: 'v@example.com' })
    })
  })

  describe('check', () => {
    it('returns per-question canVote/hasVoted entries (ProcessCheckResponse shape)', async () => {
      server.use(
        http.post(`${BASE_URL}/processes/${PROCESS_ID}/check`, () =>
          HttpResponse.json({
            belongsToProcess: true,
            weight: MOCK_WEIGHT_HEX,
            questions: [
              { questionId: 'q-0', upstreamId: MOCK_PROCESS_ADDRESS, canVote: true, hasVoted: true },
              { questionId: 'q-1', upstreamId: 'ee'.repeat(32), canVote: false, hasVoted: false },
            ],
          }),
        ),
      )

      const res = await client.processes.check(PROCESS_ID, { authToken: 'verified-token' })
      expect(res.belongsToProcess).toBe(true)
      expect(res.weight).toBe(MOCK_WEIGHT_HEX)
      expect(res.questions).toHaveLength(2)
      expect(res.questions[0]).toEqual({
        questionId: 'q-0',
        upstreamId: MOCK_PROCESS_ADDRESS,
        canVote: true,
        hasVoted: true,
      })
      expect(res.questions[1].canVote).toBe(false)
    })

    it('reports ineligibility as belongsToProcess=false with HTTP 200, not an error', async () => {
      server.use(
        http.post(`${BASE_URL}/processes/${PROCESS_ID}/check`, () =>
          HttpResponse.json({ belongsToProcess: false, questions: [] }),
        ),
      )

      const res = await client.processes.check(PROCESS_ID, { authToken: 'stranger-token' })
      expect(res.belongsToProcess).toBe(false)
      expect(res.questions).toEqual([])
    })
  })

  describe('sign', () => {
    it("POSTs the question's on-chain electionId + payload and returns the CSP signature", async () => {
      let body: unknown
      server.use(
        http.post(`${BASE_URL}/processes/${PROCESS_ID}/sign`, async ({ request }) => {
          body = await request.json()
          return HttpResponse.json({ signature: MOCK_CSP_SIGNATURE })
        }),
      )

      const res = await client.processes.sign(PROCESS_ID, {
        authToken: 'verified-token',
        electionId: MOCK_PROCESS_ADDRESS,
        payload: 'aa'.repeat(20),
      })
      expect(res.signature).toBe(MOCK_CSP_SIGNATURE)
      expect(body).toEqual({
        authToken: 'verified-token',
        electionId: MOCK_PROCESS_ADDRESS,
        payload: 'aa'.repeat(20),
      })
    })
  })

  describe('signBatch', () => {
    it('POSTs every ballot to /processes/{id}/sign-batch and returns one result per ballot', async () => {
      let body: unknown
      server.use(
        http.post(`${BASE_URL}/processes/${PROCESS_ID}/sign-batch`, async ({ request }) => {
          body = await request.json()
          return HttpResponse.json({
            signatures: [
              { upstreamId: 'aa'.repeat(32), signature: MOCK_CSP_SIGNATURE, weight: MOCK_WEIGHT_HEX },
              { upstreamId: 'bb'.repeat(32), signature: MOCK_CSP_SIGNATURE, weight: MOCK_WEIGHT_HEX },
            ],
          })
        }),
      )

      const res = await client.processes.signBatch(PROCESS_ID, {
        authToken: 'verified-token',
        ballots: [
          { upstreamId: 'aa'.repeat(32), address: '11'.repeat(20) },
          { upstreamId: 'bb'.repeat(32), address: '22'.repeat(20) },
        ],
      })
      expect(res.signatures).toHaveLength(2)
      expect(res.signatures[0].signature).toBe(MOCK_CSP_SIGNATURE)
      expect(res.signatures[1].weight).toBe(MOCK_WEIGHT_HEX)
      expect(body).toEqual({
        authToken: 'verified-token',
        ballots: [
          { upstreamId: 'aa'.repeat(32), address: '11'.repeat(20) },
          { upstreamId: 'bb'.repeat(32), address: '22'.repeat(20) },
        ],
      })
    })

    it('passes per-ballot failures through inline instead of throwing', async () => {
      server.use(
        http.post(`${BASE_URL}/processes/${PROCESS_ID}/sign-batch`, () =>
          HttpResponse.json({
            signatures: [
              { upstreamId: 'aa'.repeat(32), signature: MOCK_CSP_SIGNATURE, weight: MOCK_WEIGHT_HEX },
              {
                upstreamId: 'bb'.repeat(32),
                code: 'already_consumed',
                error: "this election's signing slot is already consumed",
              },
            ],
          }),
        ),
      )

      const res = await client.processes.signBatch(PROCESS_ID, {
        authToken: 'verified-token',
        ballots: [
          { upstreamId: 'aa'.repeat(32), address: '11'.repeat(20) },
          { upstreamId: 'bb'.repeat(32), address: '22'.repeat(20) },
        ],
      })
      expect(res.signatures[0].signature).toBe(MOCK_CSP_SIGNATURE)
      expect(res.signatures[1].signature).toBeUndefined()
      expect(res.signatures[1].code).toBe('already_consumed')
    })
  })

  describe('weight', () => {
    it('POSTs the token and returns the hex weight', async () => {
      const res = await client.processes.weight(PROCESS_ID, { authToken: 'verified-token' })
      expect(res.weight).toBe(MOCK_WEIGHT_HEX)
    })
  })

  describe('signInfo', () => {
    it('returns the per-question consumed entries', async () => {
      let body: unknown
      server.use(
        http.post(`${BASE_URL}/processes/${PROCESS_ID}/sign-info`, async ({ request }) => {
          body = await request.json()
          return HttpResponse.json({
            consumed: [
              {
                questionId: 'q-0',
                upstreamId: MOCK_PROCESS_ADDRESS,
                address: 'aa'.repeat(20),
                nullifier: 'bb'.repeat(32),
                at: '2026-01-01T00:00:00Z',
              },
            ],
          })
        }),
      )

      const res = await client.processes.signInfo(PROCESS_ID, { authToken: 'verified-token' })
      expect(res.consumed).toHaveLength(1)
      expect(res.consumed[0].nullifier).toBe('bb'.repeat(32))
      expect(body).toEqual({ authToken: 'verified-token' })
    })
  })

  describe('getQuestion', () => {
    it('reads the public question without an API key', async () => {
      let auth: string | null = 'unset'
      server.use(
        http.get(`${BASE_URL}/processes/${PROCESS_ID}/questions/q-0`, ({ request }) => {
          auth = request.headers.get('Authorization')
          return HttpResponse.json({ ...mockProcess.questions[0], parentProcessId: PROCESS_ID })
        }),
      )

      const q = await client.processes.getQuestion(PROCESS_ID, 'q-0')
      expect(q.upstreamId).toBe(MOCK_PROCESS_ADDRESS)
      expect(q.ballotProtocol?.maxCount).toBe(1)
      expect(auth).toBeNull()
    })

    it('folds metadata.choices onto choice.meta, like every other question read', async () => {
      server.use(
        http.get(`${BASE_URL}/processes/${PROCESS_ID}/questions/q-0`, () =>
          HttpResponse.json({
            ...mockProcess.questions[0],
            parentProcessId: PROCESS_ID,
            status: 'READY',
            choices: [
              { title: { default: 'With skin' }, value: 0 },
              { title: { default: 'Without skin' }, value: 1 },
            ],
            metadata: {
              choices: [{ value: 0, description: 'Unpeeled', image: 'https://cdn.example/a.jpeg' }],
            },
          }),
        ),
      )

      const q = await client.processes.getQuestion(PROCESS_ID, 'q-0')
      expect(q.choices[0].meta).toEqual({
        description: 'Unpeeled',
        image: { default: 'https://cdn.example/a.jpeg' },
      })
      expect(q.choices[1].meta).toBeUndefined()
      expect(q.status).toBe('ONGOING')
    })

    it('has no encryptionKeys until the keykeepers publish them (omitempty)', async () => {
      server.use(
        http.get(`${BASE_URL}/processes/${PROCESS_ID}/questions/q-0`, () =>
          HttpResponse.json({
            ...mockProcess.questions[0],
            parentProcessId: PROCESS_ID,
            secretUntilTheEnd: true,
          }),
        ),
      )

      const q = await client.processes.getQuestion(PROCESS_ID, 'q-0')
      expect(q.secretUntilTheEnd).toBe(true)
      expect(q.encryptionKeys).toBeUndefined()
    })

    it('exposes encryptionKeys once published', async () => {
      server.use(
        http.get(`${BASE_URL}/processes/${PROCESS_ID}/questions/q-0`, () =>
          HttpResponse.json({
            ...mockProcess.questions[0],
            parentProcessId: PROCESS_ID,
            secretUntilTheEnd: true,
            encryptionKeys: [{ index: 0, key: 'cc'.repeat(32) }],
          }),
        ),
      )

      const q = await client.processes.getQuestion(PROCESS_ID, 'q-0')
      expect(q.encryptionKeys).toHaveLength(1)
      expect(q.encryptionKeys?.[0].key).toBe('cc'.repeat(32))
    })
  })

})

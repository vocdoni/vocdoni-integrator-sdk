import { http, HttpResponse } from 'msw'
// A real (fixed-key) blind signer, reused rather than re-implemented here — a
// mock that faked the crypto would let a real encoding bug through.
import { mockBlindCsp } from '../packages/api-voting/src/blind-secp256k1.testkit'

const BASE = 'http://localhost'
export const BUNDLE_ID = 'bundle-1'
/** Vochain process id (64-hex) the process info exposes as `address`. */
export const MOCK_PROCESS_ADDRESS =
  '6be21a5a9dc01036097ea184999095aed31735e7264a19652130030800000001'
/** A valid 64-byte hex CSP signature placeholder (decodable by the vote builder). */
export const MOCK_CSP_SIGNATURE = 'ab'.repeat(64)
/** Hex-encoded weight "2a" === 42. */
export const MOCK_WEIGHT_HEX = '2a'

/**
 * The blind census key of `electionId`, as the Vochain would derive it. Verify
 * a mock-signed anonymous ballot against this.
 */
export const mockBlindCensusKey = (electionId: string) =>
  mockBlindCsp.censusKey(electionId, MOCK_WEIGHT_HEX)

/**
 * Batch relay jobs registered by the default `POST /votes` handler: jobId →
 * number of envelopes. Cleared between tests (see setup-tests.ts) so batch job
 * ids stay deterministic per test.
 */
export const mockBatchJobs = new Map<string, number>()

export const mockElection = {
  id: 'abc123',
  title: 'Test Election',
  description: 'A test election',
  status: 'READY',
  startDate: '2024-01-01T00:00:00Z',
  endDate: '2024-12-31T23:59:59Z',
  organizationId: 'org1',
  voteCount: 0,
  finalResults: false,
  questions: [],
  voteType: {
    maxCount: 1,
    maxValue: 1,
    maxVoteOverwrites: 0,
    costExponent: 1,
    uniqueChoices: false,
    costFromWeight: false,
  },
  electionType: {
    interruptible: true,
    secretUntilTheEnd: false,
    anonymous: false,
  },
}

export const mockProcess = {
  id: 'abc123',
  // Process reads return orgAddress as unprefixed lowercase hex.
  orgAddress: '1a9ffe1f4c2493578ce4a7dbebd7d95433eee6f0',
  title: { default: 'Test Process' },
  description: { default: 'A test process' },
  startDate: '2024-01-01T00:00:00Z',
  endDate: '2024-12-31T23:59:59Z',
  published: true,
  chainId: 'test',
  // 2FA census (twoFaFields populated) → exercises the auth0 → auth1 flow.
  census: { authFields: ['memberNumber'], twoFaFields: ['phone'] },
  questions: [
    {
      id: 'q-0',
      parentProcessId: 'abc123',
      upstreamId: MOCK_PROCESS_ADDRESS,
      title: { default: 'Test Question' },
      choices: [],
      ballotProtocol: {
        maxCount: 1,
        maxValue: 1,
        maxVoteOverwrites: 0,
        maxTotalCost: 0,
        costExponent: 1,
        uniqueValues: false,
        costFromWeight: false,
      },
      type: 'singlechoice',
      secretUntilTheEnd: false,
      status: 'ONGOING',
    },
  ],
}

// name/description are locale maps on read (shorthands for meta["name"] etc.).
export const mockOrganization = {
  address: '0xdeadbeef',
  name: { default: 'Test Org' },
  description: { default: 'A test organization' },
}

export const mockAuthToken = {
  token: 'test-jwt-token',
  expirity: '2099-01-01T00:00:00Z',
}

export const handlers = [
  // New multi-question process endpoint (`GET /processes/:id`).
  http.get(`${BASE}/processes/:id`, ({ params }) =>
    HttpResponse.json({ ...mockProcess, id: params.id as string }),
  ),

  // Per-process results endpoint.
  http.get(`${BASE}/processes/:id/results`, ({ params }) =>
    HttpResponse.json({
      id: params.id as string,
      questions: mockProcess.questions.map((q) => ({
        questionId: q.id,
        upstreamId: q.upstreamId,
        voteCount: 0,
        maxVoters: 0,
        finalResults: false,
        // `results` (the tally matrix) is omitted, as the backend does until a tally exists.
      })),
    }),
  ),

  // Legacy single-process endpoint — kept for tests that still exercise old paths.
  http.get(`${BASE}/process/:id`, ({ params }) =>
    HttpResponse.json({
      id: params.id as string,
      address: MOCK_PROCESS_ADDRESS,
      chainId: 'test',
      status: mockElection.status,
      orgAdress: mockElection.organizationId,
      census: {
        id: 'census-1',
        type: 'csp',
        weighted: false,
        size: 10,
        published: { uri: 'https://example.org/census-1', root: '0xroot' },
        authFields: ['memberNumber'],
        twoFaFields: [],
      },
      metadata: { title: mockElection.title, description: mockElection.description },
      electionParams: {
        startDate: mockElection.startDate,
        endDate: mockElection.endDate,
        questions: mockElection.questions,
        voteType: mockElection.voteType,
        electionType: mockElection.electionType,
      },
      publishedAt: '2024-01-01T00:00:00Z',
    }),
  ),

  // Vote relay — flat public POST /vote; the process is named in the envelope.
  // Returns an async job id (202).
  http.post(`${BASE}/vote`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>
    return HttpResponse.json(
      { jobId: `job-${String(body.txPayload ?? '').slice(0, 8)}` },
      { status: 202 },
    )
  }),

  // Batch vote relay — POST /votes (saas-backend#610). Accepts the batch and
  // returns one job id; the size is remembered so the jobs handler can report
  // one per-envelope outcome per vote, in request order.
  http.post(`${BASE}/votes`, async ({ request }) => {
    const body = (await request.json()) as { votes?: Array<{ txPayload?: string }> }
    const jobId = `batch-job-${mockBatchJobs.size}`
    mockBatchJobs.set(jobId, body.votes?.length ?? 0)
    return HttpResponse.json({ jobId }, { status: 202 })
  }),

  // Job polling — batch jobs resolve to a completed relay_votes with one
  // per-envelope outcome each; anything else is a completed relay_vote.
  http.get(`${BASE}/jobs/:jobId`, ({ params }) => {
    const jobId = params.jobId as string
    const batchSize = mockBatchJobs.get(jobId)
    if (batchSize !== undefined) {
      return HttpResponse.json({
        jobId,
        status: 'completed',
        type: 'relay_votes',
        result: {
          votes: Array.from({ length: batchSize }, (_, i) => ({
            processId: MOCK_PROCESS_ADDRESS,
            nullifier: `nullifier-${jobId}-${i}`,
            status: 'completed',
            voteID: `nullifier-${jobId}-${i}`,
          })),
        },
      })
    }
    return HttpResponse.json({
      jobId,
      status: 'completed',
      type: 'relay_vote',
      result: { voteID: `nullifier-${jobId}` },
    })
  }),

  http.get(`${BASE}/organizations/:address`, ({ params }) =>
    HttpResponse.json({ ...mockOrganization, address: params.address as string }),
  ),

  // Org update — echo the merged organization so update() assertions can see the change.
  http.put(`${BASE}/organizations/:address`, async ({ params, request }) => {
    const body = (await request.json()) as Record<string, unknown>
    return HttpResponse.json({
      ...mockOrganization,
      address: params.address as string,
      ...body,
    })
  }),

  // Process status change (pause/resume/end/cancel) — 200, body is { status }.
  http.put(`${BASE}/process/:id/status`, () => HttpResponse.json({}, { status: 200 })),

  http.post(`${BASE}/auth/login`, () => HttpResponse.json(mockAuthToken)),
  http.post(`${BASE}/auth/refresh`, () => HttpResponse.json(mockAuthToken)),

  // ─── Bundle info ─────────────────────────────────────────────────────────────
  http.get(`${BASE}/process/bundle/:bundleId`, ({ params }) =>
    HttpResponse.json({
      id: params.bundleId as string,
      chainId: 'test',
      processes: [mockElection.id],
      orgAddress: '0xorg',
      // 2FA census (twoFaFields populated) → exercises the auth0 → auth1 flow.
      census: { id: 'census-1', type: 'sms', authFields: ['memberNumber'], twoFaFields: ['phone'] },
    }),
  ),

  // ─── Bundle CSP auth ─────────────────────────────────────────────────────────
  http.post(`${BASE}/process/bundle/:bundleId/auth/0`, () =>
    HttpResponse.json({ authToken: 'csp-step0-token' }),
  ),

  http.post(`${BASE}/process/bundle/:bundleId/auth/1`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>
    return HttpResponse.json({
      authToken: `confirmed-${body.authToken ?? ''}`,
      weight: MOCK_WEIGHT_HEX,
    })
  }),

  http.post(`${BASE}/process/bundle/:bundleId/auth/resend`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>
    return HttpResponse.json({ authToken: body.authToken ?? 'csp-step0-token' })
  }),

  http.post(`${BASE}/process/bundle/:bundleId/check`, () =>
    HttpResponse.json({ belongs: true, hasVoted: false, weight: MOCK_WEIGHT_HEX }),
  ),

  http.post(`${BASE}/process/bundle/:bundleId/sign`, () =>
    HttpResponse.json({ signature: MOCK_CSP_SIGNATURE, weight: MOCK_WEIGHT_HEX }),
  ),

  http.post(`${BASE}/process/bundle/:bundleId/weight`, () =>
    HttpResponse.json({ weight: MOCK_WEIGHT_HEX }),
  ),

  // ─── Process-scoped CSP voter routes (bundle-less flow) ──────────────────────
  http.post(`${BASE}/processes/:processId/auth/0`, () =>
    HttpResponse.json({ authToken: 'csp-step0-token' }),
  ),

  http.post(`${BASE}/processes/:processId/auth/1`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>
    return HttpResponse.json({
      authToken: `confirmed-${body.authToken ?? ''}`,
      weight: MOCK_WEIGHT_HEX,
    })
  }),

  http.post(`${BASE}/processes/:processId/auth/resend`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>
    return HttpResponse.json({ authToken: body.authToken ?? 'csp-step0-token' })
  }),

  http.post(`${BASE}/processes/:processId/check`, () =>
    HttpResponse.json({
      belongsToProcess: true,
      weight: MOCK_WEIGHT_HEX,
      questions: mockProcess.questions.map((q) => ({
        questionId: q.id,
        upstreamId: q.upstreamId,
        canVote: true,
        hasVoted: false,
      })),
    }),
  ),

  http.post(`${BASE}/processes/:processId/sign`, () =>
    HttpResponse.json({ signature: MOCK_CSP_SIGNATURE, weight: MOCK_WEIGHT_HEX }),
  ),

  // Batch sign — one signature per ballot, in request order.
  http.post(`${BASE}/processes/:processId/sign-batch`, async ({ request }) => {
    const body = (await request.json()) as { ballots: { upstreamId: string }[] }
    return HttpResponse.json({
      signatures: body.ballots.map((b) => ({
        upstreamId: b.upstreamId,
        signature: MOCK_CSP_SIGNATURE,
        weight: MOCK_WEIGHT_HEX,
      })),
    })
  }),

  // Blind CSP round 1 — a genuine curve point per election; the client
  // decompresses it and blinds against it.
  http.post(`${BASE}/processes/:processId/blind-point`, async ({ request }) => {
    const body = (await request.json()) as { electionIds: string[] }
    return HttpResponse.json({
      points: body.electionIds.map((upstreamId) => ({
        upstreamId,
        tokenR: mockBlindCsp.point(upstreamId),
        weight: MOCK_WEIGHT_HEX,
      })),
    })
  }),

  // Blind CSP round 2 — signs the blinded message it cannot read, with the
  // salted key {@link mockBlindCensusKey} verifies against.
  http.post(`${BASE}/processes/:processId/blind-sign`, async ({ request }) => {
    const body = (await request.json()) as { ballots: { upstreamId: string; blindedMessage: string }[] }
    return HttpResponse.json({
      signatures: body.ballots.map(({ upstreamId, blindedMessage }) => ({
        upstreamId,
        signature: mockBlindCsp.sign(upstreamId, blindedMessage, MOCK_WEIGHT_HEX),
        weight: MOCK_WEIGHT_HEX,
      })),
    })
  }),

  http.post(`${BASE}/processes/:processId/weight`, () =>
    HttpResponse.json({ weight: MOCK_WEIGHT_HEX }),
  ),

  // Consumed sign info — nothing voted by default; override per test to hand
  // the voter back their per-question nullifiers.
  http.post(`${BASE}/processes/:processId/sign-info`, () => HttpResponse.json({ consumed: [] })),

  http.get(`${BASE}/processes/:processId/questions/:questionId`, ({ params }) =>
    HttpResponse.json({
      ...mockProcess.questions[0],
      id: params.questionId as string,
      parentProcessId: params.processId as string,
    }),
  ),
]

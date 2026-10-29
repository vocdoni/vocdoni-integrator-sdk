import {
  ApiErrorCode,
  type CensusGrowthQuote,
  type PaymentRequiredData,
  type ProcessPriceResponse,
} from '@vocdoni/api-types'
import { http, HttpResponse } from 'msw'
import { server } from '../../../mocks/server'
import { VocdoniApiClient } from './client'
import { isApiError, isCensusGrowthQuote, VocdoniApiError } from './errors'
import { JobsClient } from './jobs'

const BASE_URL = 'http://localhost'
const ORG = '0xorg'
const PROCESS_ID = '65a1f0c2b4e5d6f7a8b9c0d1'

const price: ProcessPriceResponse = {
  lines: [{ kind: 'base', description: 'Base', amountCents: 5000 }],
  totalCents: 5000,
  quoteRecommended: false,
  quoteRequired: false,
  currency: 'eur',
}

describe('payment: elections.getPrice / checkout / getCheckout / cancelCheckout', () => {
  let client: VocdoniApiClient

  beforeEach(() => {
    client = new VocdoniApiClient({ apiUrl: BASE_URL })
  })

  it('GETs /processes/{id}/price and passes the quote through', async () => {
    server.use(
      http.get(`${BASE_URL}/processes/${PROCESS_ID}/price`, () => HttpResponse.json(price)),
    )

    const res = await client.elections.getPrice(PROCESS_ID)
    expect(res).toEqual(price)
  })

  it('POSTs the return URL and locale to /processes/{id}/checkout', async () => {
    let body: unknown
    server.use(
      http.post(`${BASE_URL}/processes/${PROCESS_ID}/checkout`, async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({
          clientSecret: 'cs_1',
          sessionId: 'cs_sess_1',
          amountCents: 2500,
          currency: 'eur',
        })
      }),
    )

    const res = await client.elections.checkout(PROCESS_ID, {
      returnURL: 'https://app.test/done',
      locale: 'es',
    })
    expect(body).toEqual({ returnURL: 'https://app.test/done', locale: 'es' })
    expect(res).toEqual({
      clientSecret: 'cs_1',
      sessionId: 'cs_sess_1',
      amountCents: 2500,
      currency: 'eur',
    })
  })

  it('GETs /processes/{id}/checkout and passes the payment status through', async () => {
    const status = {
      status: 'pending',
      amountCents: 2500,
      currency: 'eur',
      sessionStatus: 'open',
      sessionPaymentStatus: 'unpaid',
    }
    server.use(
      http.get(`${BASE_URL}/processes/${PROCESS_ID}/checkout`, () => HttpResponse.json(status)),
    )

    const res = await client.elections.getCheckout(PROCESS_ID)
    expect(res).toEqual(status)
  })

  it('DELETEs /processes/{id}/checkout and resolves on a bare 200 "\\n" body', async () => {
    let method: string | undefined
    server.use(
      http.delete(`${BASE_URL}/processes/${PROCESS_ID}/checkout`, ({ request }) => {
        method = request.method
        return new HttpResponse('\n', { status: 200 })
      }),
    )

    await expect(client.elections.cancelCheckout(PROCESS_ID)).resolves.toBeUndefined()
    expect(method).toBe('DELETE')
  })
})

describe('payment: elections.censusCheckout', () => {
  let client: VocdoniApiClient

  beforeEach(() => {
    client = new VocdoniApiClient({ apiUrl: BASE_URL })
  })

  it('POSTs censusSize and returnURL to /processes/{id}/census/checkout', async () => {
    let body: unknown
    server.use(
      http.post(`${BASE_URL}/processes/${PROCESS_ID}/census/checkout`, async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({
          clientSecret: 'cs_2',
          sessionId: 'cs_sess_2',
          amountCents: 1200,
          currency: 'eur',
        })
      }),
    )

    await client.elections.censusCheckout(PROCESS_ID, {
      censusSize: 20000,
      returnURL: 'https://app.test/census',
    })
    expect(body).toEqual({ censusSize: 20000, returnURL: 'https://app.test/census' })
  })

  it('passes a wallet-covered response through with an empty sessionId', async () => {
    server.use(
      http.post(`${BASE_URL}/processes/${PROCESS_ID}/census/checkout`, () =>
        HttpResponse.json({ clientSecret: '', sessionId: '', amountCents: 1200, currency: 'eur' }),
      ),
    )

    const res = await client.elections.censusCheckout(PROCESS_ID, {
      censusSize: 20000,
      returnURL: 'https://app.test/census',
    })
    expect(res).toEqual({ clientSecret: '', sessionId: '', amountCents: 1200, currency: 'eur' })
  })
})

describe('payment: elections.update and publishAndWait', () => {
  let client: VocdoniApiClient
  let waitForSpy: ReturnType<typeof vi.spyOn> | undefined

  beforeEach(() => {
    client = new VocdoniApiClient({ apiUrl: BASE_URL })
  })

  afterEach(() => {
    waitForSpy?.mockRestore()
  })

  it('sends addOns in the PUT body', async () => {
    let body: Record<string, unknown> | undefined
    server.use(
      http.put(`${BASE_URL}/processes/${PROCESS_ID}`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>
        return new HttpResponse('\n', { status: 200 })
      }),
    )

    await client.elections.update(PROCESS_ID, {
      orgAddress: ORG,
      title: 'Election',
      questions: [],
      addOns: { branding: true, customUrl: false },
    })
    expect(body?.addOns).toEqual({ branding: true, customUrl: false })
  })

  it('waits for the publish job with timeoutMs Infinity by default', async () => {
    server.use(
      http.post(`${BASE_URL}/processes/${PROCESS_ID}/publish`, () =>
        HttpResponse.json({ jobId: 'pub-1' }),
      ),
    )
    waitForSpy = vi.spyOn(JobsClient.prototype, 'waitFor').mockResolvedValue({
      jobId: 'pub-1',
      type: 'publish_process',
      status: 'completed',
      result: { address: '0xabc', status: 'ready' },
    } as never)

    const res = await client.elections.publishAndWait(PROCESS_ID)
    expect(waitForSpy).toHaveBeenCalledWith('pub-1', { timeoutMs: Infinity })
    expect(res).toEqual({ address: '0xabc', status: 'ready' })
  })

  it('lets the caller timeoutMs and signal win over the default', async () => {
    server.use(
      http.post(`${BASE_URL}/processes/${PROCESS_ID}/publish`, () =>
        HttpResponse.json({ jobId: 'pub-2' }),
      ),
    )
    waitForSpy = vi.spyOn(JobsClient.prototype, 'waitFor').mockResolvedValue({
      jobId: 'pub-2',
      type: 'publish_process',
      status: 'completed',
      result: { address: '0xdef', status: 'ready' },
    } as never)
    const signal = new AbortController().signal

    await client.elections.publishAndWait(PROCESS_ID, { timeoutMs: 5000, signal })
    expect(waitForSpy).toHaveBeenCalledWith('pub-2', { timeoutMs: 5000, signal })
  })
})

describe('payment: organizations wallet and managed spend cap', () => {
  let client: VocdoniApiClient

  beforeEach(() => {
    client = new VocdoniApiClient({ apiUrl: BASE_URL })
  })

  it('PUTs the spend cap to /integrator/organizations/{address}', async () => {
    let body: unknown
    server.use(
      http.put(`${BASE_URL}/integrator/organizations/${ORG}`, async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({ address: ORG, spendCapCents: null, spentCents: 300 })
      }),
    )

    const res = await client.organizations.updateManaged(ORG, { spendCapCents: null })
    expect(body).toEqual({ spendCapCents: null })
    expect(res).toEqual({ address: ORG, spendCapCents: null, spentCents: 300 })
  })

  it('GETs /organizations/{address}/wallet with page and limit as query params', async () => {
    let search: URLSearchParams | undefined
    const wallet = {
      balanceCents: 10000,
      currency: 'eur',
      history: [
        {
          id: 'l1',
          orgAddress: ORG,
          amountCents: -2500,
          kind: 'payment',
          processId: PROCESS_ID,
          processOrgAddress: '0xmanaged',
          createdAt: '2026-10-01T00:00:00Z',
        },
      ],
      pagination: { totalItems: 1, previousPage: null, currentPage: 2, nextPage: null, lastPage: 2 },
    }
    server.use(
      http.get(`${BASE_URL}/organizations/${ORG}/wallet`, ({ request }) => {
        search = new URL(request.url).searchParams
        return HttpResponse.json(wallet)
      }),
    )

    const res = await client.organizations.getWallet(ORG, { page: 2, limit: 10 })
    expect(search?.get('page')).toBe('2')
    expect(search?.get('limit')).toBe('10')
    expect(res).toEqual(wallet)
  })

  it('GETs the wallet without query params when none are given', async () => {
    let search: URLSearchParams | undefined
    server.use(
      http.get(`${BASE_URL}/organizations/${ORG}/wallet`, ({ request }) => {
        search = new URL(request.url).searchParams
        return HttpResponse.json({ balanceCents: 0, currency: 'eur', history: [], pagination: {} })
      }),
    )

    await client.organizations.getWallet(ORG)
    expect(search).toBeDefined()
    expect(search?.toString()).toBe('')
  })

  it('POSTs the top-up to /organizations/{address}/wallet/topup', async () => {
    let body: unknown
    server.use(
      http.post(`${BASE_URL}/organizations/${ORG}/wallet/topup`, async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({
          clientSecret: 'cs_3',
          sessionId: 'cs_sess_3',
          amountCents: 5000,
          currency: 'eur',
        })
      }),
    )

    const res = await client.organizations.topUpWallet(ORG, {
      amountCents: 5000,
      returnURL: 'https://app.test/wallet',
    })
    expect(body).toEqual({ amountCents: 5000, returnURL: 'https://app.test/wallet' })
    expect(res.sessionId).toBe('cs_sess_3')
  })
})

describe('payment: client.pricing', () => {
  it('GETs /pricing with the calculator params and no Authorization header', async () => {
    const client = new VocdoniApiClient({ apiUrl: BASE_URL })
    let search: URLSearchParams | undefined
    let auth: string | null | undefined
    server.use(
      http.get(`${BASE_URL}/pricing`, ({ request }) => {
        search = new URL(request.url).searchParams
        auth = request.headers.get('Authorization')
        return HttpResponse.json({ ...price, currency: 'eur' })
      }),
    )

    const res = await client.pricing({ voters: 20000, emailTwoFA: true, branding: false })
    expect(search?.get('voters')).toBe('20000')
    expect(search?.get('emailTwoFA')).toBe('true')
    expect(search?.get('branding')).toBe('false')
    expect(search?.has('smsTwoFA')).toBe(false)
    expect(auth).toBeNull()
    expect(res.totalCents).toBe(5000)
  })
})

describe('payment: errors', () => {
  const paymentRequired: PaymentRequiredData = {
    lines: [{ kind: 'base', description: 'Base', amountCents: 5000 }],
    totalCents: 5000,
    quoteRecommended: false,
    quoteRequired: false,
    balanceCents: 1000,
    shortfallCents: 4000,
  }

  let client: VocdoniApiClient

  beforeEach(() => {
    client = new VocdoniApiClient({ apiUrl: BASE_URL })
  })

  it('carries the backend code and data of a 402 on the VocdoniApiError', async () => {
    server.use(
      http.post(`${BASE_URL}/processes/${PROCESS_ID}/publish`, () =>
        HttpResponse.json(
          { error: 'payment required', code: ApiErrorCode.PaymentRequired, data: paymentRequired },
          { status: 402 },
        ),
      ),
    )

    const err = await client.elections.publish(PROCESS_ID).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(VocdoniApiError)
    const apiErr = err as VocdoniApiError
    expect(apiErr.status).toBe(402)
    expect(apiErr.code).toBe(40178)
    expect(apiErr.data).toEqual(paymentRequired)
    expect(isApiError(err, ApiErrorCode.PaymentRequired)).toBe(true)
    expect(isApiError(err, ApiErrorCode.SpendCapReached)).toBe(false)
    expect(isApiError(new Error('boom'), ApiErrorCode.PaymentRequired)).toBe(false)
  })

  it('leaves data undefined when the error body has none', async () => {
    server.use(
      http.get(`${BASE_URL}/processes/${PROCESS_ID}/price`, () =>
        HttpResponse.json({ error: 'nope', code: 40174 }, { status: 403 }),
      ),
    )

    const err = (await client.elections.getPrice(PROCESS_ID).catch((e: unknown) => e)) as VocdoniApiError
    expect(err.code).toBe(40174)
    expect(err.data).toBeUndefined()
  })

  it('tells the census-growth quote apart from the publish-time quote', () => {
    const growth: CensusGrowthQuote = {
      processId: PROCESS_ID,
      lines: [{ kind: 'base', description: 'Base', amountCents: 9000 }],
      totalCents: 9000,
      paidCents: 5000,
      dueCents: 4000,
      censusSize: 600,
      currency: 'eur',
      balanceCents: 0,
      shortfallCents: 4000,
    }
    expect(isCensusGrowthQuote(growth)).toBe(true)
    expect(isCensusGrowthQuote(paymentRequired)).toBe(false)
  })
})

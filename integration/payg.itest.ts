import type { CreateVotingProcessRequest } from '@vocdoni/api-types'
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import {
  ApiErrorCode,
  isApiError,
  VocdoniApiError,
} from '@vocdoni/api-client'
import { apiKey, integratorOrgAddress, makeAdminClient, makeClient } from './helpers'

// Pay-per-process billing (saas-backend#819) via the integrator key. No Stripe,
// and the one publish is refused by the spend cap before any debit. Skips on
// backends that predate #819 (wallet route 404).
const suite = apiKey ? describe : describe.skip

const MEMBER_NUMBERS = ['1', '2', '3']
// Three voters are free on the base price, so the draft costs only its add-on.
const SIGNED_CERT_CENTS = 3900

suite('pay-per-process billing (saas-backend#819, live)', () => {
  let admin: ReturnType<typeof makeAdminClient>
  let paygBackend = false
  let managed = ''
  let draftId = ''
  let groupId = ''

  // Body of the draft, with or without the paid add-on. PUT replaces the draft,
  // so an update that omits `addOns` clears them: the tests rely on that.
  const draftBody = (withAddOns: boolean): CreateVotingProcessRequest => ({
    orgAddress: managed,
    census: { authFields: ['memberNumber'], groupId },
    title: 'Pay-per-process billing',
    endDate: new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
    questions: [
      {
        title: 'Approve?',
        choices: [
          { title: 'No', value: 0 },
          { title: 'Yes', value: 1 },
        ],
        type: 'singlechoice',
      },
    ],
    ...(withAddOns ? { addOns: { signedCertificate: true } } : {}),
  })

  // listManaged is paginated: walk the pages until the managed org shows up.
  const findManaged = async () => {
    let page: number | null = 1
    while (page !== null) {
      const res = await admin.organizations.listManaged(page)
      const row = res.organizations.find((o) => o.address.toLowerCase() === managed.toLowerCase())
      if (row) return row
      page = res.pagination?.nextPage ?? null
    }
    return undefined
  }

  beforeAll(async () => {
    if (!integratorOrgAddress) {
      console.warn('[payg] INTEGRATION_ORG_ADDRESS is not set: skipping pay-per-process billing')
      return
    }
    admin = makeAdminClient()
    try {
      await admin.organizations.getWallet(integratorOrgAddress)
      paygBackend = true
    } catch (err) {
      // A plain-text 404 is a route the backend lacks; a coded one is a real error.
      if (err instanceof VocdoniApiError && err.status === 404 && err.code === undefined) {
        console.warn('[payg] backend predates saas-backend#819 (wallet route is 404): skipping')
        return
      }
      throw err
    }

    const org = await admin.organizations.createManaged({
      name: `payg-${Date.now()}`,
      type: 'company',
    })
    managed = org.address
    expect(managed, 'managed org has no address').toBeTruthy()

    const added = await admin.organizations.addMembers(
      managed,
      MEMBER_NUMBERS.map((memberNumber) => ({ memberNumber })),
    )
    if (added.jobId) {
      await admin.jobs.waitFor(added.jobId, {
        timeoutMs: 120000,
        intervalMs: 2000,
        expectType: 'org_members',
      })
    }
    groupId = (await admin.organizations.listGroups(managed)).groups[0].id

    draftId = await admin.elections.create(draftBody(true))
  }, 180000)

  afterAll(async () => {
    if (!paygBackend || !managed) return
    // Best effort: the org is disposable, so a failed cleanup must not fail the run.
    await admin.organizations.deleteManaged(managed).catch(() => undefined)
  })

  it('reads the integrator wallet: integer balanceCents and a history array', async ({ skip }) => {
    if (!paygBackend) skip()
    const wallet = await admin.organizations.getWallet(integratorOrgAddress!)
    expect(Number.isInteger(wallet.balanceCents)).toBe(true)
    expect(Array.isArray(wallet.history)).toBe(true)
  })

  it('echoes draft add-ons, and an update without them clears them', async ({ skip }) => {
    if (!paygBackend) skip()
    expect((await admin.elections.get(draftId)).addOns).toEqual({ signedCertificate: true })

    await admin.elections.update(draftId, draftBody(false))
    expect((await admin.elections.get(draftId)).addOns?.signedCertificate).toBeFalsy()

    // restored for the tests below, which price and publish the paid draft
    await admin.elections.update(draftId, draftBody(true))
    expect((await admin.elections.get(draftId)).addOns).toEqual({ signedCertificate: true })
  })

  it('quotes the draft with a signed-certificate line', async ({ skip }) => {
    if (!paygBackend) skip()
    const price = await admin.elections.getPrice(draftId)
    const line = price.lines.find((l) => l.kind === 'signedCertificate')
    expect(line?.amountCents).toBe(SIGNED_CERT_CENTS)
    expect(price.totalCents).toBe(price.lines.reduce((sum, l) => sum + l.amountCents, 0))
    expect(price.currency).toBe('eur')
    expect(price.quoteRequired).toBe(false)
  })

  it('refuses a managed organization its own wallet (the key is pinned to its integrator)', async ({ skip }) => {
    if (!paygBackend) skip()
    let caught: unknown
    try {
      await admin.organizations.getWallet(managed)
    } catch (err) {
      caught = err
    }
    // The key may only read its own organization's wallet, so it is refused with
    // 40157 before the managed-org check (40181) can run. 40181 needs a session.
    expect(caught).toBeInstanceOf(VocdoniApiError)
    expect((caught as VocdoniApiError).status).toBe(403)
    expect((caught as VocdoniApiError).code).toBe(40157)
  })

  it('caps the managed org spend and refuses a publish past it', async ({ skip }) => {
    if (!paygBackend) skip()
    // Re-arm the paid add-on: an earlier failed test may have left the draft without it.
    await admin.elections.update(draftId, draftBody(true))
    const { totalCents } = await admin.elections.getPrice(draftId)
    // Without a price above the cap, publishing would not test the cap; refuse to publish.
    if (!(totalCents > 100)) {
      throw new Error(`draft is priced ${totalCents} cents, not above the 100 cent cap: not publishing`)
    }

    const capped = await admin.organizations.updateManaged(managed, { spendCapCents: 100 })
    expect(capped.spendCapCents).toBe(100)
    expect(capped.spentCents).toBe(0)

    const row = await findManaged()
    expect(row, 'managed org missing from listManaged').toBeDefined()
    expect(row!.spendCapCents).toBe(100)
    expect(row!.spentCents).toBe(0)

    let caught: unknown
    try {
      await admin.elections.publish(draftId)
    } catch (err) {
      caught = err
    }
    expect(isApiError(caught, ApiErrorCode.SpendCapReached), 'publish was not refused by the spend cap').toBe(true)
    if (!isApiError(caught, ApiErrorCode.SpendCapReached)) return
    expect(caught.data.capCents).toBe(100)
    expect(caught.data.spentCents).toBe(0)
    expect(caught.data.requiredCents).toBeGreaterThan(100)

    const lifted = await admin.organizations.updateManaged(managed, { spendCapCents: null })
    expect(lifted.spendCapCents).toBeNull()
  })

  it('prices a census through the public calculator', async ({ skip }) => {
    if (!paygBackend) skip()
    // 26 is past the 25-voter free tier, so all 26 are priced in the 1-100 band at €0.66.
    const price = await makeClient().pricing({ voters: 26 })
    expect(price.totalCents).toBe(1716)
  })
})

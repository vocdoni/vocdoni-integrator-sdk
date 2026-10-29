import type { CreateVotingProcessRequest } from '@vocdoni/api-types'
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import {
  ApiErrorCode,
  isApiError,
  VocdoniApiError,
} from '@vocdoni/api-client'
import { apiKey, integratorOrgAddress, makeAdminClient, makeClient } from './helpers'

// Pay-per-process billing (saas-backend#819), driven with the integrator API
// key only: no Stripe, so nothing here moves money. The wallet is read, never
// topped up; the one publish is refused by the managed org's spend cap before
// any debit. Needs INTEGRATION_ORG_ADDRESS (the key's integrator org, exported
// by scripts/integration-stack.sh). A backend that predates #819 answers 404 to
// GET /organizations/{integrator}/wallet, so every test skips rather than fails.
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
      if (err instanceof VocdoniApiError && err.status === 404) {
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
    const capped = await admin.organizations.updateManaged(managed, { spendCapCents: 100 })
    expect(capped.spendCapCents).toBe(100)
    expect(capped.spentCents).toBe(0)

    const listed = await admin.organizations.listManaged()
    const row = listed.organizations.find((o) => o.address.toLowerCase() === managed.toLowerCase())
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

import { VocdoniApiClient } from '@vocdoni/api-client'

/** Base URL of the SaaS API under test (trailing slash trimmed). */
export const API_URL = (
  process.env.INTEGRATION_API_URL ?? 'https://saas-api-dev.vocdoni.net'
).replace(/\/$/, '')

export function makeClient(authToken?: () => string | null | undefined): VocdoniApiClient {
  return new VocdoniApiClient({ apiUrl: API_URL, authToken })
}

/** Integrator API key (`vsk_…`) used to drive the organizer-side admin flow. */
export const apiKey = process.env.INTEGRATION_API_KEY
/** Address of the key's integrator organization, set by integration-stack.sh (pay-per-process suite). */
export const integratorOrgAddress = process.env.INTEGRATION_ORG_ADDRESS

/**
 * A client authenticated with the integrator API key. The key rides the same
 * `Authorization: Bearer` path as a JWT, so we just feed it as the authToken.
 */
export function makeAdminClient(): VocdoniApiClient {
  if (!apiKey) throw new Error('INTEGRATION_API_KEY is required for the admin client')
  return makeClient(() => apiKey)
}

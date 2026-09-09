import type { ApiClientConfig, InfoResponse } from '@vocdoni/api-types'
import { up } from 'up-fetch'
import type { UpFetch } from 'up-fetch'
import { AuthClient } from './auth'
import { CensusClient } from './census'
import { ElectionsClient } from './elections'
import { handleError } from './errors'
import { JobsClient } from './jobs'
import { OrganizationsClient } from './organizations'

async function resolveToken(
  authToken: ApiClientConfig['authToken'],
): Promise<string | null | undefined> {
  if (typeof authToken === 'function') {
    return authToken()
  }
  return authToken
}

export class VocdoniApiClient {
  /**
   * The `/processes` resource in full: public process/question/results reads,
   * the authenticated authoring writes (create, publish, census, status), the
   * voter CSP flow (auth, check, sign, blind sign, weight) and the vote relay.
   */
  readonly elections: ElectionsClient
  /**
   * @deprecated Alias of {@link elections} — the very same instance, so every
   * call keeps working unchanged. The voter CSP client was merged into
   * {@link ElectionsClient}: both always wrapped the same `/processes/{id}`
   * resource through this same fetcher (identical auth behaviour), two methods
   * were duplicated verbatim between them, and the "admin vs voter" split they
   * claimed never held — an API-key-less voter app called both. Migrate to
   * `client.elections`; this alias will be REMOVED IN THE NEXT MAJOR VERSION.
   */
  readonly processes: ElectionsClient
  readonly organizations: OrganizationsClient
  readonly census: CensusClient
  readonly auth: AuthClient
  readonly jobs: JobsClient
  private readonly fetch: UpFetch

  constructor(config: ApiClientConfig) {
    const fetcher = up(fetch, async () => {
      const token = await resolveToken(config.authToken)
      return {
        baseUrl: config.apiUrl,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        parseResponse: async (res) => {
          if (res.status === 204) return undefined as never
          const text = await res.text()
          // Write endpoints (process update/delete, status changes) answer a
          // bare 200 with a "\n" body — treat any blank body as empty, not JSON.
          if (!text.trim()) return undefined as never
          return JSON.parse(text)
        },
      }
    })

    this.fetch = fetcher
    this.elections = new ElectionsClient(fetcher)
    // Same instance, not a second client: see the `processes` docblock above.
    this.processes = this.elections
    this.organizations = new OrganizationsClient(fetcher)
    this.census = new CensusClient(fetcher)
    this.auth = new AuthClient(fetcher)
    this.jobs = new JobsClient(fetcher)
  }

  /**
   * Public service info via `GET /info` — no API key needed.
   *
   * `chainId` here is the service's CURRENT Vochain chain id — NOT
   * necessarily the chain id a given process's votes must sign against: a
   * process published before a chain migration signs against its own, older
   * chain id. Always prefer the process's own `chainId` from the (public)
   * `elections.get()` read.
   */
  async info(): Promise<InfoResponse> {
    return this.fetch<InfoResponse>('/info').catch(handleError)
  }
}

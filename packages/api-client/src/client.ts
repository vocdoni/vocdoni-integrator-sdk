import type { ApiClientConfig, InfoResponse } from '@vocdoni/api-types'
import { up } from 'up-fetch'
import type { UpFetch } from 'up-fetch'
import { AuthClient } from './auth'
import { CensusClient } from './census'
import { ElectionsClient } from './elections'
import { handleError } from './errors'
import { JobsClient } from './jobs'
import { OrganizationsClient } from './organizations'

/** Resolve a static value or sync/async getter on each request. */
async function resolveConfigValue(
  value: ApiClientConfig['authToken'] | ApiClientConfig['lang'],
): Promise<string | null | undefined> {
  if (typeof value === 'function') {
    return value()
  }
  return value
}

export class VocdoniApiClient {
  /** The whole `/processes` resource: reads, authoring, voter CSP, vote relay. */
  readonly elections: ElectionsClient
  /**
   * @deprecated Alias of {@link elections} — the very same instance, so every
   * call keeps working. Removed in the next major version.
   */
  readonly processes: ElectionsClient
  readonly organizations: OrganizationsClient
  readonly census: CensusClient
  readonly auth: AuthClient
  readonly jobs: JobsClient
  private readonly fetch: UpFetch
  private readonly config: ApiClientConfig

  constructor(config: ApiClientConfig) {
    // Snapshot fields so setters don't mutate the caller's config.
    // Explicit reads preserve inherited and non-enumerable settings.
    this.config = {
      apiUrl: config.apiUrl,
      authToken: config.authToken,
      lang: config.lang,
    }

    const fetcher = up(fetch, async () => {
      const [token, lang] = await Promise.all([
        resolveConfigValue(this.config.authToken),
        // Locale lookup failures omit lang; token failures must reject the request.
        resolveConfigValue(this.config.lang).catch(() => undefined),
      ])
      return {
        baseUrl: this.config.apiUrl,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        // Per-call params override this default; an empty lang sends nothing.
        params: lang ? { lang } : undefined,
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
    this.processes = this.elections // deprecated alias, not a second client
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

  /**
   * Set the Bearer token for subsequent requests (string or sync/async getter).
   * Omit or pass undefined to clear it. Getter failures reject the request.
   */
  setAuthToken(authToken?: ApiClientConfig['authToken']): void {
    this.config.authToken = authToken
  }

  /**
   * Set lang for subsequent requests (string or sync/async getter).
   * Omit or pass undefined to use the backend fallback; in-flight requests are unchanged.
   */
  setLang(lang?: ApiClientConfig['lang']): void {
    this.config.lang = lang
  }
}

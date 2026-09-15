import type { ApiClientConfig, InfoResponse } from '@vocdoni/api-types'
import { up } from 'up-fetch'
import type { UpFetch } from 'up-fetch'
import { AuthClient } from './auth'
import { CensusClient } from './census'
import { ElectionsClient } from './elections'
import { handleError } from './errors'
import { JobsClient } from './jobs'
import { OrganizationsClient } from './organizations'

/**
 * Config fields double as getters (sync or async) so callers can keep a live
 * source of truth — a store, an i18n instance — instead of rebuilding the
 * client whenever the value changes. Resolved on every request.
 */
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
    // Copied, not referenced: `setLang()` mutates this object, and the caller's
    // config is theirs, not ours. The defaults callback below reads the copy on
    // every request, which is what makes a later `setLang()` take effect
    // without rebuilding the fetcher.
    this.config = { ...config }

    const fetcher = up(fetch, async () => {
      const [token, lang] = await Promise.all([
        resolveConfigValue(this.config.authToken),
        resolveConfigValue(this.config.lang),
      ])
      return {
        baseUrl: this.config.apiUrl,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        // A default param, so per-call `params` still win on a key clash —
        // and an unset lang adds nothing to the query string at all.
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
   * Change the language sent with every subsequent request — the voter picked a
   * new locale mid-session and the next OTP should follow them there.
   *
   * Takes the same shapes as the `lang` config field (string, sync or async
   * getter); pass `undefined` to stop sending the param and let the backend
   * fall back on its own. Requests already in flight keep the old value.
   */
  setLang(lang: ApiClientConfig['lang']): void {
    this.config.lang = lang
  }
}

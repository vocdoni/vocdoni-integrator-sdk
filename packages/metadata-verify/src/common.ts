/**
 * Primitives shared by the live verification and the history audit: hashing, hex handling,
 * byte fetching with a size cap and a timeout, and reading the Vochain API.
 *
 * The contract both rely on (vocdoni/vocdoni-node#1486): an election's `metadataHash` is the
 * lowercase hex SHA-256 of the exact bytes served at its `metadataURL`, and images are
 * covered by a `meta.mediaHashes` map from each image URL, as written in the document, to
 * the SHA-256 of its bytes.
 */

/** Outcome of comparing fetched bytes with a committed hash. */
export type HashCheck = 'verified' | 'mismatch' | 'unverifiable' | 'no-hash'

/** Why a document or image could not be checked (or, for `not-listed`, why it failed). */
export type UnverifiableReason =
  /** The Vochain API could not be read (independent mode and audits only). */
  | 'chain-unavailable'
  /** The URL is not http(s), so it cannot be fetched (e.g. `ipfs://`). */
  | 'unsupported-url'
  /** Network or CORS error, non-2xx response, or timeout. */
  | 'fetch-failed'
  /** Larger than the byte cap ({@link MAX_VERIFIABLE_BYTES} by default). */
  | 'too-large'
  /** A verified document does not list the image in `meta.mediaHashes`: reported with `mismatch`. */
  | 'not-listed'
  /** The process was published without a parent election, so nothing commits its own fields. */
  | 'no-parent'
  /** The election committing the image exists but its document could not be verified. */
  | 'document-unverified'
  /** The election the image belongs to committed no metadata hash, so nothing covers it. */
  | 'not-committed'

/** The subset of a `fetch` response this package reads. */
export interface FetchResponse {
  ok: boolean
  status?: number
  headers?: { get(name: string): string | null }
  body?: ReadableStream<Uint8Array> | null
  json(): Promise<unknown>
  arrayBuffer(): Promise<ArrayBuffer>
}

/** A `fetch`-compatible function; `globalThis.fetch` satisfies it. */
export type FetchLike = (
  url: string,
  init?: { credentials?: 'omit' | 'same-origin' | 'include'; signal?: AbortSignal }
) => Promise<FetchResponse>

/** Network options shared by every entry point. */
export interface FetchOptions {
  /** Defaults to `globalThis.fetch`. */
  fetch?: FetchLike
  /** Largest resource downloaded to be hashed; defaults to {@link MAX_VERIFIABLE_BYTES}. */
  maxBytes?: number
  /** Per-request timeout in milliseconds; none when omitted, unless the entry point says otherwise. */
  timeoutMs?: number
}

/** Options of the entry points that read the Vochain API. */
export interface VochainOptions extends FetchOptions {
  /** Vochain API base URL including the version, e.g. `https://api-dev.vocdoni.net/v2`. */
  vochainApiUrl: string
}

/** Largest resource downloaded to be hashed. Larger ones are reported as `too-large`. */
export const MAX_VERIFIABLE_BYTES = 25 * 1024 * 1024

/** Thrown when a resource exceeds the byte cap. */
export class ResourceTooLargeError extends Error {
  constructor(url: string) {
    super(`resource too large to verify: ${url}`)
    this.name = 'ResourceTooLargeError'
  }
}

/** Lowercase hex without a `0x` prefix; undefined for a missing or blank value. */
export const normalizeHex = (value?: string | null): string | undefined => {
  const hex = value?.trim().replace(/^0x/i, '').toLowerCase()
  return hex ? hex : undefined
}

/** True when both are present and equal once normalized: ids and hashes compare case-insensitively. */
export const sameHex = (a?: string | null, b?: string | null): boolean => {
  const left = normalizeHex(a)
  return !!left && left === normalizeHex(b)
}

/** Compares a computed hash with a committed one. */
export const compareHash = (actual: string | undefined, expected?: string | null): HashCheck => {
  if (!normalizeHex(expected)) return 'no-hash'
  if (!normalizeHex(actual)) return 'unverifiable'
  return sameHex(actual, expected) ? 'verified' : 'mismatch'
}

const toHex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

/** SHA-256 of the bytes as lowercase hex, through WebCrypto. */
export const sha256Hex = async (bytes: ArrayBuffer | Uint8Array): Promise<string> => {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new Error('webcrypto is not available')
  return toHex(new Uint8Array(await subtle.digest('SHA-256', new Uint8Array(bytes))))
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const asRecord = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {})

export const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

export const isFetchableUrl = (url?: string): url is string => !!url && /^https?:\/\//i.test(url)

/** Parses bytes as JSON; undefined when they are not valid JSON. */
export const parseJson = (bytes: ArrayBuffer | Uint8Array): unknown => {
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return undefined
  }
}

/** Multi-language text as a `lang → text` map: a plain string is the `default` language. */
export const toLanguageMap = (value: unknown): Record<string, string> => {
  if (typeof value === 'string') return value ? { default: value } : {}
  if (!isRecord(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== '')
  )
}

/** A choice image's URLs by variant: a plain URL string is the `default` one. */
export const imageVariants = (image: unknown): Record<string, string> => toLanguageMap(image)

/** `meta.mediaHashes` of a metadata document, normalized, keeping only string entries. */
export const readMediaHashes = (metadata: unknown): Record<string, string> => {
  const hashes: Record<string, string> = {}
  for (const [url, hash] of Object.entries(asRecord(asRecord(asRecord(metadata).meta).mediaHashes))) {
    const normalized = typeof hash === 'string' ? normalizeHex(hash) : undefined
    if (normalized) hashes[url] = normalized
  }
  return hashes
}

export const defaultFetch: FetchLike = (url, init) => globalThis.fetch(url, init)

/** Rejects with a timeout error when `ms` is set and elapses first; aborts `controller` then. */
export const withTimeout = <T>(promise: Promise<T>, ms?: number, controller?: AbortController): Promise<T> => {
  if (!ms) return promise
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      controller?.abort()
      reject(new Error('timed out'))
    }, ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

/**
 * Downloads a URL's raw bytes without credentials (public resources only), enforcing the byte
 * cap from `Content-Length` and while streaming, so an oversized resource is not downloaded
 * just to be hashed. Rejects on network/CORS errors, non-2xx responses and timeouts, and with
 * {@link ResourceTooLargeError} above the cap.
 */
export const fetchBytes = (url: string, options: FetchOptions = {}): Promise<ArrayBuffer> => {
  const { fetch = defaultFetch, maxBytes = MAX_VERIFIABLE_BYTES, timeoutMs } = options
  const controller = new AbortController()

  const read = async (): Promise<ArrayBuffer> => {
    const response = await fetch(url, { credentials: 'omit', signal: controller.signal })
    if (!response.ok) throw new Error(`request failed (${response.status ?? 'unknown'}) for ${url}`)

    const declared = Number(response.headers?.get('content-length') ?? Number.NaN)
    if (Number.isFinite(declared) && declared > maxBytes) {
      controller.abort()
      throw new ResourceTooLargeError(url)
    }

    if (!response.body) {
      const buffer = await response.arrayBuffer()
      if (buffer.byteLength > maxBytes) throw new ResourceTooLargeError(url)
      return buffer
    }

    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        controller.abort()
        throw new ResourceTooLargeError(url)
      }
      chunks.push(value)
    }

    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return bytes.buffer
  }

  return withTimeout(read(), timeoutMs, controller)
}

/** The reason a {@link fetchBytes} rejection maps to. */
export const fetchFailureReason = (error: unknown): UnverifiableReason =>
  error instanceof ResourceTooLargeError ? 'too-large' : 'fetch-failed'

/** `GET {vochainApiUrl}/{path}` as JSON; rejects on a non-2xx response. */
export const getVochainJson = async (path: string, options: VochainOptions): Promise<unknown> => {
  const { fetch = defaultFetch, timeoutMs, vochainApiUrl } = options
  const controller = new AbortController()
  const request = (async () => {
    const response = await fetch(`${vochainApiUrl.replace(/\/+$/, '')}/${path}`, { signal: controller.signal })
    if (!response.ok) throw new Error(`vochain request failed (${response.status ?? 'unknown'}) for ${path}`)
    return response.json()
  })()
  return withTimeout(request, timeoutMs, controller)
}

/** An election id as a URL path segment: normalized, and escaped so it cannot leave the path. */
export const electionPath = (electionId: string): string => encodeURIComponent(normalizeHex(electionId) ?? '')

// @vitest-environment node
import { type FetchLike, ResourceTooLargeError, fetchBytes, sameHex } from './common'

const RESOURCE = 'https://cdn.example.org/header.png'
const bytes = new TextEncoder().encode('header-image-bytes')

const respond =
  (body: Uint8Array, headers: Record<string, string> = {}): FetchLike =>
  async () =>
    new Response(new Uint8Array(body), { headers })

describe('sameHex', () => {
  it('compares ids and hashes case-insensitively and without 0x', () => {
    expect(sameHex('0xABcd', 'abCD')).toBe(true)
    expect(sameHex('abcd', 'abce')).toBe(false)
    expect(sameHex(undefined, undefined)).toBe(false)
  })
})

describe('fetchBytes', () => {
  it('returns the response bytes', async () => {
    const result = await fetchBytes(RESOURCE, { fetch: respond(bytes) })
    expect(Array.from(new Uint8Array(result))).toEqual(Array.from(bytes))
  })

  it('requests without credentials', async () => {
    const fetch = vi.fn(respond(bytes))
    await fetchBytes(RESOURCE, { fetch })
    expect(fetch).toHaveBeenCalledWith(RESOURCE, expect.objectContaining({ credentials: 'omit' }))
  })

  it('refuses a resource above the cap, by header or while streaming', async () => {
    await expect(
      fetchBytes(RESOURCE, { fetch: respond(bytes, { 'content-length': '999' }), maxBytes: 10 })
    ).rejects.toBeInstanceOf(ResourceTooLargeError)
    await expect(fetchBytes(RESOURCE, { fetch: respond(bytes), maxBytes: 4 })).rejects.toBeInstanceOf(
      ResourceTooLargeError
    )
  })

  it('reads a response without a body stream', async () => {
    const fetch: FetchLike = async () => ({
      ok: true,
      json: async () => ({}),
      arrayBuffer: async () => new Uint8Array(bytes).buffer,
    })
    const result = await fetchBytes(RESOURCE, { fetch })
    expect(result.byteLength).toBe(bytes.byteLength)
  })

  it('rejects a non-2xx response', async () => {
    const notFound: FetchLike = async () => new Response('nope', { status: 404 })
    await expect(fetchBytes(RESOURCE, { fetch: notFound })).rejects.toThrow(/404/)
  })

  it('rejects when the request outlives the timeout', async () => {
    const never: FetchLike = () => new Promise(() => {})
    await expect(fetchBytes(RESOURCE, { fetch: never, timeoutMs: 5 })).rejects.toThrow(/timed out/)
  })
})

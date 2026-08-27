import { mod } from '@noble/curves/abstract/modular'
import { bytesToNumberBE } from '@noble/curves/abstract/utils'
import { secp256k1 } from '@noble/curves/secp256k1'
import { keccak_256 } from '@noble/hashes/sha3'
import type { BlindPoint, BlindSignature } from './blind-secp256k1'
import { fromHex, toHex } from './hex'

/**
 * The CSP's half of the blind scheme, plus the chain's key salting — the parts
 * a client never performs. Test-only: not exported from the package index, so
 * it stays out of the published surface.
 *
 * Mirrors go-blindsecp256k1 (`PrivateKey.BlindSign`, `Verify`, `Point.Compress`)
 * and vocdoni-node's `crypto/saltedkey`. Anchored against real Go output by the
 * fixture cases in blind-secp256k1.test.ts, so it is a reference, not a guess.
 */

export const G = secp256k1.ProjectivePoint.BASE
export const N = secp256k1.CURVE.n

/** go-blindsecp256k1: `s' = (d*m' + k) mod n`. */
export const blindSign = (mBlinded: bigint, d: bigint, k: bigint): bigint => mod(d * mBlinded + k, N)

/** go-blindsecp256k1 `Verify`: `sG == F + (rx*h(m) mod n)*Q`. */
export function verify(m: bigint, signature: BlindSignature, q: BlindPoint): boolean {
  const h = bytesToNumberBE(keccak_256(minimalBytes(m)))
  const rx = mod(signature.f.toAffine().x, N)
  return G.multiply(signature.s).equals(signature.f.add(q.multiply(mod(rx * h, N))))
}

/** saltedkey.Salt: `keccak256(processID || weight-as-32-byte-BE)[:20]`. */
export function salt(processId: Uint8Array, weight: bigint): bigint {
  const preimage = new Uint8Array(processId.length + 32)
  preimage.set(processId)
  for (let i = 31, rest = weight; i >= 0; i--, rest >>= 8n) preimage[processId.length + i] = Number(rest & 0xffn)
  return bytesToNumberBE(keccak_256(preimage).subarray(0, 20))
}

/** Go's `big.Int.Bytes()`: minimal big-endian, leading zeros dropped. */
export function minimalBytes(value: bigint): Uint8Array {
  let hex = value.toString(16)
  if (hex === '0') return new Uint8Array(0)
  if (hex.length % 2 === 1) hex = `0${hex}`
  return fromHex(hex)
}

/** go-blindsecp256k1 `Point.Compress`: X big-endian (32 bytes) then an oddness byte. */
export function compress(point: BlindPoint): Uint8Array {
  const { x, y } = point.toAffine()
  const out = new Uint8Array(33)
  for (let i = 31, rest = x; i >= 0; i--, rest >>= 8n) out[i] = Number(rest & 0xffn)
  out[32] = y & 1n ? 1 : 0
  return out
}

/** go-blindsecp256k1 rejects a `k` (and an `m'`) narrower than 32 bytes. */
export function scalar32(): bigint {
  for (;;) {
    const candidate = bytesToNumberBE(secp256k1.utils.randomPrivateKey())
    if (candidate >= 1n << 248n) return candidate
  }
}

/** Fixed 32-byte big-endian encoding, the width the wire uses. */
export function bytes32(value: bigint): Uint8Array {
  const out = new Uint8Array(32)
  for (let i = 31, rest = value; i >= 0; i--, rest >>= 8n) out[i] = Number(rest & 0xffn)
  return out
}

/** The inverse of `serializeBlindSignature`: `LE32(s) | LE32(F.x) | LE32(F.y)`. */
export function deserializeBlindSignature(bytes: Uint8Array): BlindSignature {
  const le = (from: number) => bytesToNumberBE(bytes.slice(from, from + 32).reverse())
  return { s: le(0), f: secp256k1.ProjectivePoint.fromAffine({ x: le(32), y: le(64) }) }
}

/**
 * A whole blind CSP with a fixed key, for mocks: hex in, hex out, everything
 * derived from the election id. No state to reset between tests, and round 1
 * is idempotent like the real endpoint. A mock that faked the crypto would let
 * a real encoding bug through, so this one actually signs.
 */
export const mockBlindCsp = {
  /** Compressed blind point R (hex) for an election. */
  point: (electionId: string): string => toHex(compress(G.multiply(mockNonce(electionId)))),

  /** Blind-signs a blinded message (hex in, 32-byte scalar hex out). */
  sign: (electionId: string, blindedMessage: string, weight: string): string =>
    toHex(bytes32(blindSign(BigInt(`0x${blindedMessage}`), mockSaltedKey(electionId, weight), mockNonce(electionId)))),

  /** The salted census key the chain would verify this election's ballots against. */
  censusKey: (electionId: string, weight: string): BlindPoint =>
    G.multiply(mockSaltedKey(electionId, weight)),
}

/** A constant in a mock, not a secret. */
const MOCK_BLIND_PRIVKEY = 0xc87509a1c067bbde78beb793e6fa76530b6382a4c0241e5e4a9ec0a0f44dc0d3n

/** This election's one-time nonce; top bit forced so it stays 32 bytes wide. */
function mockNonce(electionId: string): bigint {
  const digest = keccak_256(new TextEncoder().encode(`mock-csp-nonce:${electionId}`))
  digest[0] |= 0x80
  return mod(bytesToNumberBE(digest), N)
}

const mockSaltedKey = (electionId: string, weight: string): bigint =>
  mod(MOCK_BLIND_PRIVKEY + salt(fromHex(electionId), BigInt(`0x${weight}`)), N)

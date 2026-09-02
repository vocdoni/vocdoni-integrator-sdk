import { invert, mod } from '@noble/curves/abstract/modular'
import { secp256k1 } from '@noble/curves/secp256k1'
import { keccak_256 } from '@noble/hashes/sha3'
import { bytesToNumberBE, numberToBytesLE, numberToVarBytesBE } from '@noble/curves/abstract/utils'

/**
 * Blind signatures over secp256k1, as used by the Vocdoni CSP for anonymous
 * (unlinkable) voting — the scheme of Mala & Nezhadansari, matching
 * `github.com/arnaucube/go-blindsecp256k1` **byte for byte**.
 *
 * The voter blinds the hash of its CA bundle, the CSP signs bytes it cannot
 * read, the voter unblinds into a signature that verifies against the census
 * root. Nothing the CSP sees links the authorization to the ballot.
 *
 * Only the voter's half lives here (decompress / blind / unblind / serialize).
 * Key salting is the CSP's and the chain's business, not the client's, and the
 * signer half is only ever needed by tests.
 *
 * Every Go quirk mirrored below is called out where it happens; they look like
 * bugs otherwise, and a silent mismatch here produces a signature that is
 * rejected on chain with no useful diagnostic.
 */

/** Point on secp256k1, in the representation `@noble/curves` hands back. */
export type BlindPoint = ReturnType<typeof secp256k1.ProjectivePoint.fromHex>

const G = secp256k1.ProjectivePoint.BASE
const N = secp256k1.CURVE.n

/** Compressed blind point (`tokenR`) size, in bytes. */
export const BLIND_POINT_BYTES = 33

/** Serialized blind signature size, in bytes (`S | F.X | F.Y`). */
export const BLIND_SIGNATURE_BYTES = 96

/** Smallest integer whose minimal big-endian encoding is 32 bytes. */
const MIN_32_BYTE_SCALAR = 1n << 248n

/**
 * The blinding factors and the public point `F` produced by {@link blind}.
 * Keep it until the CSP answers: unblinding is impossible without it, and it
 * must never leave the client — `a`/`b` are what make the ballot unlinkable.
 */
export interface BlindUserSecret {
  a: bigint
  b: bigint
  /** The signature's `F` point (named `R` in the paper). */
  f: BlindPoint
}

/** An unblinded blind signature, ready for {@link serializeBlindSignature}. */
export interface BlindSignature {
  s: bigint
  f: BlindPoint
}

/**
 * Decodes a CSP blind point (`tokenR`, 33 bytes) into a curve point.
 *
 * The encoding is go-blindsecp256k1's `Point.Compress`: X big-endian
 * (32 bytes) followed by a single oddness byte. Despite what that function's
 * doc comment says, it is **not** little-endian, and it is **not** SEC1 —
 * hence the repack below before handing it to noble, which also validates that
 * the result is on the curve.
 */
export function decompressBlindPoint(bytes: Uint8Array): BlindPoint {
  if (bytes.length !== BLIND_POINT_BYTES) {
    throw new Error(`blind point must be ${BLIND_POINT_BYTES} bytes, got ${bytes.length}`)
  }
  const sec1 = new Uint8Array(BLIND_POINT_BYTES)
  sec1[0] = bytes[32] === 1 ? 0x03 : 0x02
  sec1.set(bytes.subarray(0, 32), 1)
  return secp256k1.ProjectivePoint.fromHex(sec1)
}

/**
 * Blinds `m` against the CSP's blind point `r`, returning the message to send
 * to the sign endpoint plus the secret needed to {@link unblind} the answer.
 *
 * `m` is the CA bundle hash as an integer — see {@link blindMessageFromBundle}.
 *
 * Retries internally: go-blindsecp256k1 rejects a blinded message whose
 * *minimal* big-endian encoding isn't exactly 32 bytes, which happens for
 * roughly 1 in 256 random blindings. That is cheap to detect locally, so we
 * re-blind here rather than burn a round trip on a `invalid_blinded_message`.
 */
export function blind(m: bigint, r: BlindPoint): { mBlinded: bigint; secret: BlindUserSecret } {
  const h = hashScalar(m)
  // Bounded retry — each attempt fails with probability ~1/256, so
  // exhausting 32 of them means something structural is wrong, not bad luck.
  for (let attempt = 0; attempt < 32; attempt++) {
    const a = randomScalar()
    const b = randomScalar()
    // F = aR + bG
    const f = r.multiply(a).add(G.multiply(b))
    const rx = mod(f.toAffine().x, N)
    // m' = a^-1 * rx * h(m)  (mod n)
    const mBlinded = mod(invert(a, N) * rx * h, N)
    if (mBlinded >= MIN_32_BYTE_SCALAR) return { mBlinded, secret: { a, b, f } }
  }
  throw new Error('could not produce a valid blinded message')
}

/** Unblinds the CSP's blind-signature scalar into the final signature. */
export function unblind(sBlind: bigint, secret: BlindUserSecret): BlindSignature {
  // s = a*s' + b  (mod n)
  return { s: mod(secret.a * sBlind + secret.b, N), f: secret.f }
}

/**
 * Serializes a signature into the 96 bytes a `ProofCA` of type
 * `ECDSA_BLIND_PIDSALTED` carries: `S | F.X | F.Y`, each a 32-byte
 * **little-endian** scalar (go-blindsecp256k1's `BytesUncompressed`).
 */
export function serializeBlindSignature(signature: BlindSignature): Uint8Array {
  const { x, y } = signature.f.toAffine()
  const out = new Uint8Array(BLIND_SIGNATURE_BYTES)
  out.set(numberToBytesLE(signature.s, 32), 0)
  out.set(numberToBytesLE(x, 32), 32)
  out.set(numberToBytesLE(y, 32), 64)
  return out
}

/**
 * Turns the encoded CA bundle into the integer `m` the blind scheme signs:
 * `keccak256(bundle)` read as a big-endian integer, exactly as the Vochain
 * does when it verifies the proof.
 */
export function blindMessageFromBundle(bundle: Uint8Array): bigint {
  return bytesToNumberBE(keccak_256(bundle))
}

/**
 * `h(m)` as go-blindsecp256k1 computes it: `keccak256(m.Bytes())`, where
 * `m.Bytes()` is Go's **minimal** big-endian encoding. That drops leading zero
 * bytes, so an `m` whose top byte is zero hashes 31 bytes, not 32 — padding to
 * a fixed width here would silently produce signatures the chain rejects, once
 * every 256 votes.
 */
function hashScalar(m: bigint): bigint {
  // Go's minimal encoding of zero is empty; noble's is a single 0x00 byte.
  return bytesToNumberBE(keccak_256(m === 0n ? new Uint8Array(0) : numberToVarBytesBE(m)))
}

/** A uniform scalar in [1, n-1], the range Go's `newRand` draws from. */
function randomScalar(): bigint {
  return bytesToNumberBE(secp256k1.utils.randomPrivateKey())
}

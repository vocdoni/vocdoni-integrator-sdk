import { mod } from '@noble/curves/abstract/modular'
import { bytesToNumberBE, concatBytes, numberToBytesBE } from '@noble/curves/abstract/utils'
import { secp256k1 } from '@noble/curves/secp256k1'
import { keccak_256 } from '@noble/hashes/sha3'
import { utf8ToBytes } from '@noble/hashes/utils'
import { blindSign, compress, G, N } from './blind-secp256k1.testkit'
import { fromHex, toHex } from './hex'

/**
 * The CSP's per-election keys of the `OFF_CHAIN_CA_V3_*` census origins, for
 * tests that fake a V3 CSP. Test-only: not exported from the package index.
 *
 * Mirrors saas-backend `csp/signers/electionkey` and is anchored on its golden
 * vectors (testdata/csp-v3-vectors.json, a byte-identical copy):
 *
 *     hashToScalar(tag, data) = first keccak256(tag || u32be(i) || data) in (0, n), i = 0..255
 *     dE = hashToScalar("vocdoni/csp/v3/election-ecdsa", root || seed)
 *     dB = hashToScalar("vocdoni/csp/v3/election-blind", root || seed)
 *     dX = hashToScalar("vocdoni/csp/v3/weight-key", u256be(dB) || u256be(w))
 *     certificate = personal_sign_dB("vocdoni/csp/v3/weight-cert" || processId || u256be(w) || X)
 */

export const TAG_ELECTION_ECDSA = 'vocdoni/csp/v3/election-ecdsa'
export const TAG_ELECTION_BLIND = 'vocdoni/csp/v3/election-blind'
export const TAG_WEIGHT_KEY = 'vocdoni/csp/v3/weight-key'
export const CERT_TAG = 'vocdoni/csp/v3/weight-cert'

/** The first `keccak256(tag || u32be(i) || data)` that is a valid secp256k1 private scalar. */
export function hashToScalar(tag: string, data: Uint8Array): bigint {
  const counter = new Uint8Array(4)
  for (let i = 0; i < 256; i++) {
    new DataView(counter.buffer).setUint32(0, i)
    const h = bytesToNumberBE(keccak_256(concatBytes(utf8ToBytes(tag), counter, data)))
    if (h > 0n && h < N) return h
  }
  throw new Error(`no valid scalar for tag ${tag}`)
}

/** dE: the key of an `OFF_CHAIN_CA_V3_ECDSA` election, whose public key is its census root. */
export const electionEcdsaKey = (root: Uint8Array, seed: Uint8Array): bigint =>
  hashToScalar(TAG_ELECTION_ECDSA, concatBytes(root, seed))

/** dB: the key of an `OFF_CHAIN_CA_V3_BLIND` election, whose public key is its census root. */
export const electionBlindKey = (root: Uint8Array, seed: Uint8Array): bigint =>
  hashToScalar(TAG_ELECTION_BLIND, concatBytes(root, seed))

/** dX: the blind signing key of weight `w` in the blind election of `dB`. */
export const weightKey = (dB: bigint, w: bigint): bigint =>
  hashToScalar(TAG_WEIGHT_KEY, concatBytes(numberToBytesBE(dB, 32), numberToBytesBE(w, 32)))

/** The 33-byte compressed public key of a private scalar. */
export const compressedPubKey = (d: bigint): Uint8Array => secp256k1.getPublicKey(d, true)

/** The curve point of a compressed public key, as the blind verifier takes it. */
export const publicKeyPoint = (key: Uint8Array) => secp256k1.ProjectivePoint.fromHex(key)

/** The message a weight certificate signs: tag || processId (32) || u256be(w) || weight key (33). */
export const certMessage = (processId: Uint8Array, w: bigint, weightKeyPub: Uint8Array): Uint8Array =>
  concatBytes(utf8ToBytes(CERT_TAG), processId, numberToBytesBE(w, 32), weightKeyPub)

/** The 65-byte Ethereum personal-sign signature (`r || s || v`, v in {0, 1}) of `msg` by `d`. */
export function personalSign(d: bigint, msg: Uint8Array): Uint8Array {
  const prefix = utf8ToBytes(`\x19Ethereum Signed Message:\n${msg.length}`)
  const sig = secp256k1.sign(keccak_256(concatBytes(prefix, msg)), d)
  return concatBytes(sig.toCompactRawBytes(), Uint8Array.of(sig.recovery))
}

/** The weight key of weight `w` in election `processId` and its certificate by `dB`, all hex. */
export function weightCredential(dB: bigint, processId: string, w: bigint) {
  const dX = weightKey(dB, w)
  const weightKeyPub = compressedPubKey(dX)
  const certificate = personalSign(dB, certMessage(fromHex(processId), w, weightKeyPub))
  return { dX, weightKey: toHex(weightKeyPub), weightCertificate: toHex(certificate) }
}

/** A constant in a mock, not a secret. */
const MOCK_ROOT = fromHex('5b3c1e8f2a4d6c7b9e0f1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f')

/** Seed of an election in the mock: the first 12 bytes of its id stand in for the question id. */
const mockSeed = (electionId: string): Uint8Array => fromHex(electionId).subarray(0, 12)

/** This election's one-time nonce; top bit forced so it stays 32 bytes wide. */
function mockNonce(electionId: string): bigint {
  const digest = keccak_256(utf8ToBytes(`mock-csp-v3-nonce:${electionId}`))
  digest[0] |= 0x80
  return mod(bytesToNumberBE(digest), N)
}

/**
 * A V3 CSP with a fixed root, for mocks: hex in, hex out, everything derived
 * from the election id. Like the real CSP, the ECDSA key signs bundles, and the
 * blind flow signs with the weight key and returns its certificate.
 */
export const mockV3Csp = {
  /** Census root (compressed, hex) of the election as an `OFF_CHAIN_CA_V3_ECDSA` election. */
  ecdsaRoot: (electionId: string): string =>
    toHex(compressedPubKey(electionEcdsaKey(MOCK_ROOT, mockSeed(electionId)))),

  /** Census root (compressed, hex) of the election as an `OFF_CHAIN_CA_V3_BLIND` election. */
  blindRoot: (electionId: string): string =>
    toHex(compressedPubKey(electionBlindKey(MOCK_ROOT, mockSeed(electionId)))),

  /** Signs an encoded CA bundle (hex) for an `OFF_CHAIN_CA_V3_ECDSA` election. */
  signBundle: (electionId: string, bundle: string): string =>
    toHex(personalSign(electionEcdsaKey(MOCK_ROOT, mockSeed(electionId)), fromHex(bundle))),

  /** Compressed blind point R (hex) for an election. */
  point: (electionId: string): string => toHex(compress(G.multiply(mockNonce(electionId)))),

  /** Round 2 of an `OFF_CHAIN_CA_V3_BLIND` election: blind-signs with the weight key of `weight` (hex). */
  blindSign: (electionId: string, blindedMessage: string, weight: string) => {
    const dB = electionBlindKey(MOCK_ROOT, mockSeed(electionId))
    const credential = weightCredential(dB, electionId, BigInt(`0x${weight}`))
    const signature = blindSign(BigInt(`0x${blindedMessage}`), credential.dX, mockNonce(electionId))
    return {
      signature: toHex(numberToBytesBE(signature, 32)),
      weightKey: credential.weightKey,
      weightCertificate: credential.weightCertificate,
    }
  },
}

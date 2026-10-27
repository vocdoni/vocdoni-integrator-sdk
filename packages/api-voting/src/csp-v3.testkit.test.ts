import { secp256k1 } from '@noble/curves/secp256k1'
import { keccak_256 } from '@noble/hashes/sha3'
import { utf8ToBytes } from '@noble/hashes/utils'
import { describe, expect, it } from 'vitest'
import { blindMessageFromBundle } from './blind-secp256k1'
import { deserializeBlindSignature, verify } from './blind-secp256k1.testkit'
import {
  certMessage,
  compressedPubKey,
  electionBlindKey,
  electionEcdsaKey,
  personalSign,
  weightKey,
} from './csp-v3.testkit'
import { fromHex, toHex } from './hex'
// A byte-identical copy of saas-backend csp/signers/electionkey/testdata/csp-v3-vectors.json.
import vectorsJson from './testdata/csp-v3-vectors.json'

interface KeyPair {
  private: string
  public: string
}

interface Vectors {
  root: string
  elections: Array<{
    seed: string
    processIdBlind: string
    electionEcdsaKey: KeyPair
    electionBlindKey: KeyPair
    weights: Array<{ weight: string; weightKey: KeyPair; certMessage: string; certSignature: string }>
  }>
  proofs: Array<{
    name: string
    censusRoot: string
    bundle: string
    proofType: string
    signature: string
    weightKey?: string
  }>
}

const vectors: Vectors = vectorsJson

const hexScalar = (d: bigint) => d.toString(16).padStart(64, '0')

describe('CSP V3 key derivation (golden vectors)', () => {
  const root = fromHex(vectors.root)

  for (const election of vectors.elections) {
    it(`derives the election keys of seed ${election.seed}`, () => {
      const seed = fromHex(election.seed)
      const dE = electionEcdsaKey(root, seed)
      const dB = electionBlindKey(root, seed)
      expect(hexScalar(dE)).toBe(election.electionEcdsaKey.private)
      expect(toHex(compressedPubKey(dE))).toBe(election.electionEcdsaKey.public)
      expect(hexScalar(dB)).toBe(election.electionBlindKey.private)
      expect(toHex(compressedPubKey(dB))).toBe(election.electionBlindKey.public)

      for (const w of election.weights) {
        const weight = BigInt(w.weight)
        const dX = weightKey(dB, weight)
        expect(hexScalar(dX)).toBe(w.weightKey.private)
        expect(toHex(compressedPubKey(dX))).toBe(w.weightKey.public)
        const msg = certMessage(fromHex(election.processIdBlind), weight, compressedPubKey(dX))
        expect(toHex(msg)).toBe(w.certMessage)
        expect(toHex(personalSign(dB, msg))).toBe(w.certSignature)
      }
    })
  }

  it('verifies every vector proof signature under its key', () => {
    for (const proof of vectors.proofs) {
      const bundle = fromHex(proof.bundle)
      if (proof.proofType === 'ECDSA') {
        // a personal-sign signature over the bundle, recovering to the census root
        const sig = fromHex(proof.signature)
        const prefix = utf8ToBytes(`\x19Ethereum Signed Message:\n${bundle.length}`)
        const recovered = secp256k1.Signature.fromCompact(sig.subarray(0, 64))
          .addRecoveryBit(sig[64])
          .recoverPublicKey(keccak_256(new Uint8Array([...prefix, ...bundle])))
        expect(toHex(recovered.toRawBytes(true)), proof.name).toBe(proof.censusRoot)
      } else {
        // an unblinded blind signature over the bundle, verifying under the weight key
        const key = secp256k1.ProjectivePoint.fromHex(proof.weightKey!)
        expect(
          verify(blindMessageFromBundle(bundle), deserializeBlindSignature(fromHex(proof.signature)), key),
          proof.name,
        ).toBe(true)
        expect(proof.weightKey).not.toBe(proof.censusRoot)
      }
    }
  })
})

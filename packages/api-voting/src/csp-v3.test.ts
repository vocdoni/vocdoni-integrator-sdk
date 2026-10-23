import { secp256k1 } from '@noble/curves/secp256k1'
import { keccak_256 } from '@noble/hashes/sha3'
import { concatBytes, utf8ToBytes } from '@noble/hashes/utils'
import type { BlindPointRequest, BlindSignRequest } from '@vocdoni/api-types'
import { CAbundle, ProofCA, ProofCA_Type, SignedTx, Tx } from '@vocdoni/proto/vochain'
import { describe, expect, it } from 'vitest'
import { signBlindCspBallots, type BlindCspApiClient } from './blind-csp'
import { blindMessageFromBundle } from './blind-secp256k1'
import { deserializeBlindSignature, verify } from './blind-secp256k1.testkit'
import { cspProofOptions } from './csp-proof'
import { certMessage, mockV3Csp } from './csp-v3.testkit'
import { EphemeralSigner } from './ephemeral-signer'
import { fromHex, toHex } from './hex'
import { buildVoteTransaction, encodeCaBundle } from './vote-transaction'

const PROCESS_ID = '6be21a5a9dc01036097ea184999095aed31735e7264a19652130030800000001'
const ELECTION = 'c0ffee0000010000000000000000000000000000000000aa0600000000000001'
const CHAIN_ID = 'vocdoni-test-1'
const WEIGHT = '2a'

/** The ProofCA a built vote transaction carries on chain. */
function proofOnChain(txPayload: string): ProofCA {
  const tx = Tx.decode(SignedTx.decode(fromHex(txPayload)).tx)
  if (tx.payload?.$case !== 'vote') throw new Error('not a vote tx')
  const proof = tx.payload.vote.proof?.payload
  if (proof?.$case !== 'ca') throw new Error('not a CA proof')
  return proof.ca
}

/** Recovers the compressed public key of a 65-byte personal-sign signature over msg. */
function recoverSigner(msg: Uint8Array, signature: Uint8Array): string {
  const digest = keccak_256(concatBytes(utf8ToBytes(`\x19Ethereum Signed Message:\n${msg.length}`), msg))
  const sig = secp256k1.Signature.fromCompact(signature.subarray(0, 64)).addRecoveryBit(signature[64])
  return toHex(sig.recoverPublicKey(digest).toRawBytes(true))
}

/** A blind CSP whose elections are all OFF_CHAIN_CA_V3_BLIND, signing with mockV3Csp. */
const v3BlindClient: BlindCspApiClient = {
  elections: {
    blindPoint: async (_processId: string, body: BlindPointRequest) => ({
      points: body.electionIds.map((upstreamId) => ({
        upstreamId,
        tokenR: mockV3Csp.point(upstreamId),
        weight: WEIGHT,
      })),
    }),
    blindSign: async (_processId: string, body: BlindSignRequest) => ({
      signatures: body.ballots.map(({ upstreamId, blindedMessage }) => ({
        upstreamId,
        weight: WEIGHT,
        proofType: 'ECDSA_BLIND' as const,
        ...mockV3Csp.blindSign(upstreamId, blindedMessage, WEIGHT),
      })),
    }),
  },
}

describe('cspProofOptions', () => {
  it('falls back to the salted type when the CSP names none', () => {
    expect(cspProofOptions({}, ProofCA_Type.ECDSA_BLIND_PIDSALTED)).toEqual({
      proofType: ProofCA_Type.ECDSA_BLIND_PIDSALTED,
    })
    expect(cspProofOptions({}, ProofCA_Type.ECDSA_PIDSALTED)).toEqual({ proofType: ProofCA_Type.ECDSA_PIDSALTED })
  })

  it('uses the type the CSP names over the fallback', () => {
    expect(cspProofOptions({ proofType: 'ECDSA' }, ProofCA_Type.ECDSA_PIDSALTED)).toEqual({
      proofType: ProofCA_Type.ECDSA,
    })
    expect(cspProofOptions({ proofType: 'ECDSA_PIDSALTED' }, ProofCA_Type.ECDSA_BLIND_PIDSALTED)).toEqual({
      proofType: ProofCA_Type.ECDSA_PIDSALTED,
    })
    expect(
      cspProofOptions({ proofType: 'ECDSA_BLIND', weightKey: '02aa', weightCertificate: 'bb' }, ProofCA_Type.ECDSA_PIDSALTED),
    ).toEqual({ proofType: ProofCA_Type.ECDSA_BLIND, weightCertificate: { weightKey: '02aa', signature: 'bb' } })
  })

  it('refuses results that would build a vote the chain rejects', () => {
    const fallback = ProofCA_Type.ECDSA_PIDSALTED
    expect(() => cspProofOptions({ proofType: 'ECDSA_BLIND' }, fallback)).toThrow('without its weight certificate')
    expect(() => cspProofOptions({ proofType: 'ECDSA', weightKey: '02aa', weightCertificate: 'bb' }, fallback)).toThrow(
      'weight certificate with a ECDSA signature',
    )
    expect(() => cspProofOptions({ weightKey: '02aa', weightCertificate: 'bb' }, fallback)).toThrow('without a proof type')
    expect(() => cspProofOptions({ proofType: 'toString' as never }, fallback)).toThrow('Unknown CSP proof type')
  })
})

describe('buildVoteTransaction on per-election CSP keys', () => {
  it('builds an ECDSA proof that recovers to the election census root', () => {
    const signer = new EphemeralSigner()
    const bundle = toHex(encodeCaBundle({ processId: ELECTION, address: signer.address, weight: WEIGHT }))
    const txPayload = buildVoteTransaction({
      processId: ELECTION,
      choices: [0],
      chainId: CHAIN_ID,
      signer,
      cspSignature: mockV3Csp.signBundle(ELECTION, bundle),
      cspWeight: WEIGHT,
      ...cspProofOptions({ proofType: 'ECDSA' }, ProofCA_Type.ECDSA_PIDSALTED),
    })

    const ca = proofOnChain(txPayload)
    expect(ca.type).toBe(ProofCA_Type.ECDSA)
    expect(ca.weightCertificate).toBeUndefined()
    const onChainBundle = new Uint8Array(CAbundle.encode(ca.bundle!).finish())
    expect(recoverSigner(onChainBundle, new Uint8Array(ca.signature))).toBe(mockV3Csp.ecdsaRoot(ELECTION))
  })

  it('defaults to ECDSA_BLIND and encodes the certificate when one is given', () => {
    const txPayload = buildVoteTransaction({
      processId: ELECTION,
      choices: [0],
      chainId: CHAIN_ID,
      signer: new EphemeralSigner(),
      cspSignature: 'ab'.repeat(96),
      cspWeight: WEIGHT,
      weightCertificate: { weightKey: '02' + '11'.repeat(32), signature: '22'.repeat(65) },
    })
    const ca = proofOnChain(txPayload)
    expect(ca.type).toBe(ProofCA_Type.ECDSA_BLIND)
    expect(toHex(ca.weightCertificate!.weightKey)).toBe('02' + '11'.repeat(32))
    expect(toHex(ca.weightCertificate!.signature)).toBe('22'.repeat(65))
  })

  it('refuses a certificate on any other proof type', () => {
    expect(() =>
      buildVoteTransaction({
        processId: ELECTION,
        choices: [0],
        chainId: CHAIN_ID,
        signer: new EphemeralSigner(),
        cspSignature: 'ab'.repeat(96),
        proofType: ProofCA_Type.ECDSA_BLIND_PIDSALTED,
        weightCertificate: { weightKey: '02' + '11'.repeat(32), signature: '22'.repeat(65) },
      }),
    ).toThrow('only valid on an ECDSA_BLIND proof')
  })

  it('leaves the certificate out of a legacy proof', () => {
    const txPayload = buildVoteTransaction({
      processId: ELECTION,
      choices: [0],
      chainId: CHAIN_ID,
      signer: new EphemeralSigner(),
      cspSignature: 'ab'.repeat(65),
    })
    const ca = proofOnChain(txPayload)
    expect(ca.type).toBe(ProofCA_Type.ECDSA_PIDSALTED)
    expect(ca.weightCertificate).toBeUndefined()
  })
})

describe('signBlindCspBallots on an OFF_CHAIN_CA_V3_BLIND election', () => {
  it('returns the certificate and builds a proof the chain verifies', async () => {
    const signer = new EphemeralSigner()
    const [result] = await signBlindCspBallots({
      processId: PROCESS_ID,
      authToken: 'deadbeef',
      client: v3BlindClient,
      ballots: [{ upstreamId: ELECTION, address: signer.address }],
    })
    expect(result.code).toBeUndefined()
    expect(result.proofType).toBe('ECDSA_BLIND')
    expect(fromHex(result.weightKey!).length).toBe(33)
    expect(fromHex(result.weightCertificate!).length).toBe(65)

    const txPayload = buildVoteTransaction({
      processId: ELECTION,
      choices: [0],
      chainId: CHAIN_ID,
      signer,
      cspSignature: result.signature!,
      cspWeight: result.weight,
      ...cspProofOptions(result, ProofCA_Type.ECDSA_BLIND_PIDSALTED),
    })

    // what the chain checks: the blind signature under the weight key, over the bundle on chain...
    const ca = proofOnChain(txPayload)
    expect(ca.type).toBe(ProofCA_Type.ECDSA_BLIND)
    const weightKey = new Uint8Array(ca.weightCertificate!.weightKey)
    const bundle = new Uint8Array(CAbundle.encode(ca.bundle!).finish())
    expect(
      verify(
        blindMessageFromBundle(bundle),
        deserializeBlindSignature(new Uint8Array(ca.signature)),
        secp256k1.ProjectivePoint.fromHex(weightKey),
      ),
    ).toBe(true)
    // ...and the certificate of that key for this election and weight, by the census root
    const msg = certMessage(fromHex(ELECTION), BigInt(`0x${WEIGHT}`), weightKey)
    expect(recoverSigner(msg, new Uint8Array(ca.weightCertificate!.signature))).toBe(mockV3Csp.blindRoot(ELECTION))
  })
})

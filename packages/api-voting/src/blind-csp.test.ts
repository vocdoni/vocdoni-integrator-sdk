import { mod } from '@noble/curves/abstract/modular'
import { bytesToNumberBE, numberToBytesBE } from '@noble/curves/abstract/utils'
import type { BlindPointRequest, BlindSignRequest } from '@vocdoni/api-types'
import { CAbundle, ProofCA_Type, SignedTx, Tx } from '@vocdoni/proto/vochain'
import { describe, expect, it, vi } from 'vitest'
import { signBlindCspBallots, type BlindCspApiClient } from './blind-csp'
import { blindMessageFromBundle } from './blind-secp256k1'
import {
  blindSign,
  compress,
  deserializeBlindSignature,
  G,
  N,
  salt,
  scalar32,
  verify,
} from './blind-secp256k1.testkit'
import { EphemeralSigner } from './ephemeral-signer'
import { fromHex, toHex } from './hex'
import { buildVoteTransaction } from './vote-transaction'

const PROCESS_ID = '000000000000000000000000000000000000000a'
const ELECTION_A = '00'.repeat(31) + 'aa'
const ELECTION_B = '00'.repeat(31) + 'bb'
const AUTH_TOKEN = 'deadbeef'

/**
 * A CSP that really blind-signs, rather than a canned response: it issues a
 * fresh R per election and signs with the salted key the chain will verify
 * against. That makes the assertions the real ones — a signature that verifies
 * end to end — instead of "we round-tripped our own fixture".
 */
function fakeCsp(
  options: {
    weights?: Record<string, string>
    pointCodes?: Record<string, string>
    signCodes?: Record<string, string>
    /** Emit this tokenR verbatim instead of a real point — for malformed input. */
    badTokenR?: Record<string, string>
    /** Emit the point with no weight at all. */
    dropWeight?: string[]
  } = {}
) {
  const d = scalar32()
  const nonces = new Map<string, bigint>()
  const weightOf = (electionId: string) => options.weights?.[electionId] ?? '01'

  const saltedKey = (electionId: string) =>
    mod(d + salt(fromHex(electionId), BigInt(`0x${weightOf(electionId)}`)), N)

  const client: BlindCspApiClient = {
    processes: {
      blindPoint: vi.fn(async (_processId: string, body: BlindPointRequest) => ({
        points: body.electionIds.map((electionId) => {
          const code = options.pointCodes?.[electionId]
          if (code) return { upstreamId: electionId, code: code as never, error: 'nope' }
          const k = nonces.get(electionId) ?? scalar32()
          nonces.set(electionId, k) // idempotent, like the real endpoint
          return {
            upstreamId: electionId,
            tokenR: options.badTokenR?.[electionId] ?? toHex(compress(G.multiply(k))),
            weight: options.dropWeight?.includes(electionId) ? undefined : weightOf(electionId),
          }
        }),
      })),
      blindSign: vi.fn(async (_processId: string, body: BlindSignRequest) => ({
        signatures: body.ballots.map((ballot) => {
          const code = options.signCodes?.[ballot.upstreamId]
          if (code) return { upstreamId: ballot.upstreamId, code: code as never, error: 'nope' }
          const k = nonces.get(ballot.upstreamId)!
          const mBlinded = bytesToNumberBE(fromHex(ballot.blindedMessage))
          return {
            upstreamId: ballot.upstreamId,
            signature: toHex(numberToBytesBE(blindSign(mBlinded, saltedKey(ballot.upstreamId), k), 32)),
            weight: weightOf(ballot.upstreamId),
          }
        }),
      })),
    },
  }

  return { client, saltedPubKey: (electionId: string) => G.multiply(saltedKey(electionId)) }
}

/** The CA bundle bytes a built vote transaction actually carries on chain. */
function bundleOnChain(txPayload: string): Uint8Array {
  const tx = Tx.decode(SignedTx.decode(fromHex(txPayload)).tx)
  if (tx.payload?.$case !== 'vote') throw new Error('not a vote tx')
  const proof = tx.payload.vote.proof?.payload
  if (proof?.$case !== 'ca') throw new Error('not a CA proof')
  // Copied into a realm-local Uint8Array: protobufjs hands back a Buffer.
  return new Uint8Array(CAbundle.encode(proof.ca.bundle!).finish())
}

describe('signBlindCspBallots', () => {
  it('returns signatures the salted census key verifies, over the bundle that goes on chain', async () => {
    const csp = fakeCsp({ weights: { [ELECTION_A]: '01', [ELECTION_B]: '2a' } })
    const signers = [new EphemeralSigner(), new EphemeralSigner()]

    const results = await signBlindCspBallots({
      processId: PROCESS_ID,
      authToken: AUTH_TOKEN,
      client: csp.client,
      ballots: [
        { upstreamId: ELECTION_A, address: signers[0].address },
        { upstreamId: ELECTION_B, address: signers[1].address },
      ],
    })

    expect(results.map((r) => r.upstreamId)).toEqual([ELECTION_A, ELECTION_B])
    expect(results.map((r) => r.weight)).toEqual(['01', '2a'])

    results.forEach((result, i) => {
      expect(result.code).toBeUndefined()
      // The proof signature is what the chain reads: 96 bytes.
      const signatureBytes = fromHex(result.signature!)
      expect(signatureBytes.length).toBe(96)

      // Build the real transaction, pull the bundle back out of it, and check
      // the blind signature covers exactly those bytes. This is the invariant
      // that breaks silently if the two paths ever build the bundle differently.
      const txPayload = buildVoteTransaction({
        processId: result.upstreamId,
        choices: [0],
        chainId: 'vocdoni-test-1',
        signer: signers[i],
        cspSignature: result.signature!,
        cspWeight: result.weight,
        proofType: ProofCA_Type.ECDSA_BLIND_PIDSALTED,
      })

      expect(
        verify(
          blindMessageFromBundle(bundleOnChain(txPayload)),
          deserializeBlindSignature(signatureBytes),
          csp.saltedPubKey(result.upstreamId)
        )
      ).toBe(true)
    })
  })

  it('is a no-op for an empty ballot list', async () => {
    const csp = fakeCsp()
    expect(await signBlindCspBallots({ processId: PROCESS_ID, authToken: AUTH_TOKEN, client: csp.client, ballots: [] })).toEqual([])
    expect(csp.client.processes.blindPoint).not.toHaveBeenCalled()
  })

  it('reports a round-1 failure and never sends that election to round 2', async () => {
    const csp = fakeCsp({ pointCodes: { [ELECTION_A]: 'already_consumed' } })
    const results = await signBlindCspBallots({
      processId: PROCESS_ID,
      authToken: AUTH_TOKEN,
      client: csp.client,
      ballots: [
        { upstreamId: ELECTION_A, address: new EphemeralSigner().address },
        { upstreamId: ELECTION_B, address: new EphemeralSigner().address },
      ],
    })

    expect(results[0]).toMatchObject({ upstreamId: ELECTION_A, code: 'already_consumed' })
    expect(results[0].signature).toBeUndefined()
    expect(results[1].signature).toBeDefined()
    expect(csp.client.processes.blindSign).toHaveBeenCalledWith(
      PROCESS_ID,
      expect.objectContaining({ ballots: [expect.objectContaining({ upstreamId: ELECTION_B })] })
    )
  })

  it('reports a round-2 failure per election, leaving the others signed', async () => {
    const csp = fakeCsp({ signCodes: { [ELECTION_B]: 'already_consumed' } })
    const results = await signBlindCspBallots({
      processId: PROCESS_ID,
      authToken: AUTH_TOKEN,
      client: csp.client,
      ballots: [
        { upstreamId: ELECTION_A, address: new EphemeralSigner().address },
        { upstreamId: ELECTION_B, address: new EphemeralSigner().address },
      ],
    })

    expect(results[0].signature).toBeDefined()
    expect(results[1]).toMatchObject({ upstreamId: ELECTION_B, code: 'already_consumed' })
    expect(results[1].signature).toBeUndefined()
  })

  it('never reports an election the CSP silently dropped as signed', async () => {
    const csp = fakeCsp()
    csp.client.processes.blindSign = vi.fn(async () => ({ signatures: [] }))
    const [result] = await signBlindCspBallots({
      processId: PROCESS_ID,
      authToken: AUTH_TOKEN,
      client: csp.client,
      ballots: [{ upstreamId: ELECTION_A, address: new EphemeralSigner().address }],
    })

    expect(result.signature).toBeUndefined()
    expect(result.error).toMatch(/no result/)
  })

  it('reports a point that will not decode instead of rejecting the whole batch', async () => {
    // A truncated tokenR makes decompressBlindPoint throw. Before this was
    // caught, the throw escaped the per-ballot loop and B — which is perfectly
    // signable — never got signed or cast.
    const csp = fakeCsp({ badTokenR: { [ELECTION_A]: 'aa'.repeat(32) } })
    const results = await signBlindCspBallots({
      processId: PROCESS_ID,
      authToken: AUTH_TOKEN,
      client: csp.client,
      ballots: [
        { upstreamId: ELECTION_A, address: new EphemeralSigner().address },
        { upstreamId: ELECTION_B, address: new EphemeralSigner().address },
      ],
    })

    expect(results[0].signature).toBeUndefined()
    expect(results[0].error).toMatch(/could not blind/)
    expect(results[1].signature).toBeDefined()
    // ...and A was never sent to round 2, so its nonce is untouched.
    expect(csp.client.processes.blindSign).toHaveBeenCalledWith(
      PROCESS_ID,
      expect.objectContaining({ ballots: [expect.objectContaining({ upstreamId: ELECTION_B })] })
    )
  })

  it('treats a point with no weight as a round-1 failure', async () => {
    // The weight is hashed into the key salt: signing without it would spend
    // the nonce on a proof the chain can never verify.
    const csp = fakeCsp({ dropWeight: [ELECTION_A] })
    const results = await signBlindCspBallots({
      processId: PROCESS_ID,
      authToken: AUTH_TOKEN,
      client: csp.client,
      ballots: [
        { upstreamId: ELECTION_A, address: new EphemeralSigner().address },
        { upstreamId: ELECTION_B, address: new EphemeralSigner().address },
      ],
    })

    expect(results[0].signature).toBeUndefined()
    expect(results[0].error).toMatch(/no weight/)
    expect(results[1].signature).toBeDefined()
    expect(csp.client.processes.blindSign).toHaveBeenCalledWith(
      PROCESS_ID,
      expect.objectContaining({ ballots: [expect.objectContaining({ upstreamId: ELECTION_B })] })
    )
  })

  it('sends a fixed-width 32-byte blinded message', async () => {
    const csp = fakeCsp()
    await signBlindCspBallots({
      processId: PROCESS_ID,
      authToken: AUTH_TOKEN,
      client: csp.client,
      ballots: [{ upstreamId: ELECTION_A, address: new EphemeralSigner().address }],
    })
    const [, body] = vi.mocked(csp.client.processes.blindSign).mock.calls[0]
    expect(fromHex(body.ballots[0].blindedMessage).length).toBe(32)
  })
})

import type {
  BlindPointRequest,
  BlindPointResponse,
  BlindSignRequest,
  BlindSignResponse,
  SignFailureCode,
} from '@vocdoni/api-types'
import { bytesToNumberBE } from '@noble/curves/abstract/utils'
import {
  blind,
  blindMessageFromBundle,
  decompressBlindPoint,
  serializeBlindSignature,
  unblind,
  type BlindUserSecret,
} from './blind-secp256k1'
import { fromHex, toHex } from './hex'
import { encodeCaBundle } from './vote-transaction'

/**
 * The slice of `@vocdoni/api-client`'s client the blind flow needs. The full
 * `VocdoniApiClient` satisfies it structurally, mirroring
 * {@link VoteApiClient} — api-voting never imports api-client.
 */
export interface BlindCspApiClient {
  processes: {
    blindPoint(processId: string, body: BlindPointRequest): Promise<BlindPointResponse>
    blindSign(processId: string, body: BlindSignRequest): Promise<BlindSignResponse>
  }
}

/** One question to be blind-signed. */
export interface BlindCspBallot {
  /** Vochain election id of the question (hex) — the bundle's process id. */
  upstreamId: string
  /** Ephemeral address (hex) that will cast this question's vote. */
  address: string
}

export interface SignBlindCspBallotsOptions {
  /** Process id (the Mongo id these endpoints are scoped by), not the election id. */
  processId: string
  /** Verified CSP auth token for the process. */
  authToken: string
  /** One entry per question to vote, each with its own ephemeral address. */
  ballots: BlindCspBallot[]
  client: BlindCspApiClient
}

/**
 * One question's outcome. Same shape as the plain `SignBatchResult`, so callers
 * branch on `signature` regardless of which flow produced it: exactly one of
 * `signature` and `code` is set.
 */
export interface BlindCspResult {
  upstreamId: string
  /** Unblinded 96-byte blind signature (hex), on success. */
  signature?: string
  /** Weight the CSP authorized — feed it back as `cspWeight`, unchanged. */
  weight?: string
  code?: SignFailureCode
  error?: string
}

/**
 * Obtains an anonymous (blind) CSP signature per question, for a process whose
 * census is `anonymous`.
 *
 * Two rounds: the CSP issues a blind point per election, the client blinds the
 * CA bundle it will later put on chain, the CSP signs bytes it cannot read, the
 * client unblinds. What comes back is a `ProofCA` signature to pass to
 * `buildVoteTransaction` with `proofType: ProofCA_Type.ECDSA_BLIND_PIDSALTED`
 * and `cspWeight` set to the returned `weight` — the weight is baked into the
 * key salt, so altering it invalidates the signature.
 *
 * The blinding factors never leave this function, which is the whole point: the
 * CSP cannot link the authorization it granted to the ballot that appears on
 * chain.
 *
 * Failures are per question, reported inline with a stable `code`; the batch
 * itself only rejects on a bad auth token. Retrying the whole call is safe —
 * round 1 is idempotent (same election, same point) and a failed round 2 does
 * not consume the election's one-time nonce.
 */
export async function signBlindCspBallots(opts: SignBlindCspBallotsOptions): Promise<BlindCspResult[]> {
  const { processId, authToken, ballots, client } = opts
  if (ballots.length === 0) return []

  const { points } = await client.processes.blindPoint(processId, {
    authToken,
    electionIds: ballots.map((b) => b.upstreamId),
  })
  const pointsById = new Map(points.map((p) => [p.upstreamId, p]))

  const results = new Map<string, BlindCspResult>()
  const secrets = new Map<string, BlindUserSecret>()
  const toSign: { upstreamId: string; blindedMessage: string }[] = []

  for (const ballot of ballots) {
    const point = pointsById.get(ballot.upstreamId)
    if (!point?.tokenR) {
      results.set(ballot.upstreamId, {
        upstreamId: ballot.upstreamId,
        code: point?.code,
        error: point?.error ?? 'the CSP issued no blind point for this election',
      })
      continue
    }
    // The bundle blinded here is the one buildVoteTransaction puts on chain —
    // same builder, so the signature covers exactly the bytes the chain checks.
    const bundle = encodeCaBundle({
      processId: ballot.upstreamId,
      address: ballot.address,
      weight: point.weight,
    })
    const { mBlinded, secret } = blind(blindMessageFromBundle(bundle), decompressBlindPoint(fromHex(point.tokenR)))
    secrets.set(ballot.upstreamId, secret)
    // Placeholder until round 2 answers; an election the CSP silently drops
    // from the response keeps it, so a missing entry never reads as a success.
    results.set(ballot.upstreamId, {
      upstreamId: ballot.upstreamId,
      error: 'the CSP returned no result for this election',
    })
    toSign.push({ upstreamId: ballot.upstreamId, blindedMessage: toHex(bigintTo32Bytes(mBlinded)) })
  }

  if (toSign.length > 0) {
    const { signatures } = await client.processes.blindSign(processId, { authToken, ballots: toSign })
    for (const signed of signatures) {
      const secret = secrets.get(signed.upstreamId)
      if (!secret) continue
      const result: BlindCspResult = signed.signature
        ? {
            upstreamId: signed.upstreamId,
            signature: toHex(serializeBlindSignature(unblind(bytesToNumberBE(fromHex(signed.signature)), secret))),
            weight: pointsById.get(signed.upstreamId)?.weight,
          }
        : {
            upstreamId: signed.upstreamId,
            code: signed.code,
            error: signed.error ?? 'the CSP returned no signature for this election',
          }
      results.set(signed.upstreamId, result)
    }
  }

  return ballots.map(
    (b) => results.get(b.upstreamId) ?? { upstreamId: b.upstreamId, error: 'no result for this election' }
  )
}

/**
 * The blinded message goes out as a fixed 32 bytes. The signer parses it as a
 * big-endian integer and then requires its *minimal* encoding to be 32 bytes
 * wide — which `blind` already guarantees, so no padding is ever stripped here.
 */
function bigintTo32Bytes(value: bigint): Uint8Array {
  const out = new Uint8Array(32)
  let rest = value
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(rest & 0xffn)
    rest >>= 8n
  }
  return out
}

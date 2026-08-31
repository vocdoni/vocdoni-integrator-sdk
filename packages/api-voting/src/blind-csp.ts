import type {
  BlindPointRequest,
  BlindPointResponse,
  BlindSignRequest,
  BlindSignResponse,
  SignFailureCode,
} from '@vocdoni/api-types'
import { bytesToNumberBE, numberToBytesBE } from '@noble/curves/abstract/utils'
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
 * itself only rejects on a bad auth token.
 *
 * On retry: round 1 is idempotent (same election, same point), and a question
 * this call reported as failed *before* round 2 — no point, no weight, a point
 * that would not decode — never consumed anything, so it is safe to ask again.
 * A question that came back signed is not: its nonce is spent, and a rerun
 * blinds under a fresh secret, so the earlier signature is the only usable one.
 * If the round-2 response is lost in flight the outcome is simply unknown —
 * check the voter state rather than re-signing blind.
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
    // A point without a weight is as unusable as no point at all: the weight is
    // hashed into the salt of the key the chain verifies against, so signing
    // without it would spend the nonce on a proof that can never verify.
    if (!point?.tokenR || !point.weight) {
      results.set(ballot.upstreamId, {
        upstreamId: ballot.upstreamId,
        code: point?.code,
        error:
          point?.error ??
          (point?.tokenR
            ? 'the CSP issued a blind point with no weight for this election'
            : 'the CSP issued no blind point for this election'),
      })
      continue
    }
    // The bundle blinded here is the one buildVoteTransaction puts on chain —
    // same builder, so the signature covers exactly the bytes the chain checks.
    //
    // Blinding is local but not infallible: a malformed tokenR fails to decode
    // and blind() gives up after 32 attempts. Either would otherwise throw out
    // of this loop and reject the whole batch, stranding the questions that are
    // perfectly fine — so it is reported inline like any other per-ballot fault.
    let mBlinded: bigint
    let secret: BlindUserSecret
    try {
      const bundle = encodeCaBundle({
        processId: ballot.upstreamId,
        address: ballot.address,
        weight: point.weight,
      })
      ;({ mBlinded, secret } = blind(blindMessageFromBundle(bundle), decompressBlindPoint(fromHex(point.tokenR))))
    } catch (err) {
      results.set(ballot.upstreamId, {
        upstreamId: ballot.upstreamId,
        error: `could not blind this election's ballot: ${err instanceof Error ? err.message : String(err)}`,
      })
      continue
    }
    secrets.set(ballot.upstreamId, secret)
    // Placeholder until round 2 answers; an election the CSP silently drops
    // from the response keeps it, so a missing entry never reads as a success.
    results.set(ballot.upstreamId, {
      upstreamId: ballot.upstreamId,
      error: 'the CSP returned no result for this election',
    })
    // Fixed 32 bytes out. The signer reads it back as a big-endian integer and
    // then demands its *minimal* encoding be exactly 32 wide — which `blind`
    // already guarantees, so no padding is ever stripped on the far side.
    toSign.push({ upstreamId: ballot.upstreamId, blindedMessage: toHex(numberToBytesBE(mBlinded, 32)) })
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

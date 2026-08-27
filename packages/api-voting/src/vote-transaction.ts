import type { EncryptionKey } from '@vocdoni/api-types'
import { CAbundle, Proof, ProofCA, ProofCA_Type, SignedTx, Tx, VoteEnvelope } from '@vocdoni/proto/vochain'
import { keccak_256 } from '@noble/hashes/sha3'
import { randomBytes, utf8ToBytes } from '@noble/hashes/utils'
import { EphemeralSigner } from './ephemeral-signer'
import { fromHex, strip0x, toHex } from './hex'
import { buildVotePackage } from './vote-package'

const VOTE_MESSAGE =
  'You are signing a Vocdoni transaction of type VOTE for process ID {processId}.\n\n' +
  'The hash of this transaction is {hash} and the destination chain is {chainId}.'

export interface BuildVoteTransactionOptions {
  /** On-chain process id (hex). */
  processId: string
  /** Vote choices, one per question. */
  choices: number[]
  /** Vochain chain id the vote is destined for (e.g. "vocdoni-stage-12"). */
  chainId: string
  /** Ephemeral signer whose address was signed by the CSP. */
  signer: EphemeralSigner
  /**
   * CSP signature (hex): from the sign endpoints for a plain census, or the
   * unblinded 96-byte blind signature (`signBlindCspBallots`) for an anonymous
   * one — pair the latter with `proofType: ECDSA_BLIND_PIDSALTED`.
   */
  cspSignature: string
  /**
   * Hex-encoded census weight returned alongside the CSP signature. It is part
   * of the signed bundle and, for salted proofs, of the salt itself — pass back
   * exactly what the CSP returned.
   */
  cspWeight?: string
  /** Election encryption keys, for secretUntilTheEnd elections. */
  encryptionKeys?: EncryptionKey[]
  /** CSP proof type. Defaults to ECDSA_PIDSALTED (the SaaS CSP signer). */
  proofType?: ProofCA_Type
  /**
   * Optional free-text note attached to the vote (e.g. an open "Other"
   * answer). The chain caps it at {@link MAX_MEMO_BYTES} UTF-8 bytes —
   * validated here, since the protocol deliberately leaves it to the app
   * layer. Goes out as-is (cleartext) even on secretUntilTheEnd elections:
   * it lives on the envelope, not inside the (encrypted) vote package.
   */
  memo?: string
}

/** Chain-level cap on `VoteEnvelope.memo`, in UTF-8 bytes (not characters). */
export const MAX_MEMO_BYTES = 256

export interface CaBundleOptions {
  /** On-chain election id (hex) of the question being voted. */
  processId: string
  /** Ephemeral address (hex) the CSP authorizes. */
  address: string
  /** Hex-encoded census weight the CSP signed with, if any. */
  weight?: string
}

/**
 * The `CAbundle` the CSP signs and the Vochain re-derives to verify the proof.
 *
 * Shared with the blind (anonymous) flow, where the bundle is hashed and
 * blinded *before* the CSP ever sees it: the bytes blinded then and the bytes
 * put on chain later must be identical, so both paths build the bundle here
 * rather than each rolling their own.
 */
export function buildCaBundle(opts: CaBundleOptions): CAbundle {
  return CAbundle.fromPartial({
    processId: fromHex(opts.processId),
    address: fromHex(opts.address),
    voteWeight: opts.weight ? fromHex(opts.weight) : undefined,
  })
}

/** {@link buildCaBundle}, encoded to the bytes the CSP signature covers. */
export function encodeCaBundle(opts: CaBundleOptions): Uint8Array {
  return asLocalBytes(CAbundle.encode(buildCaBundle(opts)).finish())
}

/**
 * Builds and signs a Vochain vote transaction carrying a CSP (CA) proof, and
 * returns the hex-encoded `SignedTx` ready for POST /process/{processId}/vote.
 *
 * The proof reconstructs the exact `CAbundle{processId, address, voteWeight}`
 * the CSP signed, so the Vochain can verify the signature. The transaction is
 * then signed by the ephemeral key via EIP-191, which is what the chain expects.
 */
export function buildVoteTransaction(opts: BuildVoteTransactionOptions): string {
  const {
    processId,
    choices,
    chainId,
    signer,
    cspSignature,
    cspWeight,
    encryptionKeys,
    proofType = ProofCA_Type.ECDSA_PIDSALTED,
    memo,
  } = opts

  let memoBytes: Uint8Array | undefined
  if (memo !== undefined) {
    memoBytes = utf8ToBytes(memo)
    if (memoBytes.length > MAX_MEMO_BYTES) {
      throw new Error(`Vote memo is ${memoBytes.length} UTF-8 bytes; the chain caps it at ${MAX_MEMO_BYTES}`)
    }
  }

  const processIdBytes = fromHex(processId)
  const { votePackage, keyIndexes } = buildVotePackage({ choices, encryptionKeys })

  const proof = Proof.fromPartial({
    payload: {
      $case: 'ca',
      ca: ProofCA.fromPartial({
        type: proofType,
        signature: fromHex(cspSignature),
        bundle: buildCaBundle({ processId, address: signer.address, weight: cspWeight }),
      }),
    },
  })

  const vote = VoteEnvelope.fromPartial({
    proof,
    processId: processIdBytes,
    nonce: randomBytes(32),
    votePackage,
    encryptionKeyIndexes: keyIndexes,
    memo: memoBytes,
  })

  const tx = asLocalBytes(Tx.encode({ payload: { $case: 'vote', vote } }).finish())

  // EIP-191 personal_sign over the human-readable VOTE message, exactly as the
  // Vochain validates it (keccak256 of the raw tx fills the {hash} field).
  const hash = toHex(keccak_256(tx))
  const message = VOTE_MESSAGE.replace('{processId}', strip0x(processId))
    .replace('{hash}', hash)
    .replace('{chainId}', chainId)
  const signature = signer.signMessage(utf8ToBytes(message))

  const signedTx = asLocalBytes(SignedTx.encode({ tx, signature: fromHex(signature) }).finish())
  return toHex(signedTx)
}

/**
 * protobufjs's `Writer.finish()` returns a `Buffer` whenever a global one is
 * reachable (since the protobufjs bundled in @vocdoni/proto 1.15.13). Inside a
 * jsdom/VM test realm that Buffer is not an `instanceof` of the local
 * `Uint8Array`, which noble's strict byte checks (`keccak_256`, `toHex`)
 * reject — pass same-realm bytes through, copy foreign ones.
 */
const asLocalBytes = (bytes: Uint8Array): Uint8Array =>
  bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes as ArrayLike<number>)

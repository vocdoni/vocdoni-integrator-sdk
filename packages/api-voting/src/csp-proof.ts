import type { CspProofType } from '@vocdoni/api-types'
import { ProofCA_Type } from '@vocdoni/proto/vochain'

/**
 * The certificate of the key that blind-signed an `OFF_CHAIN_CA_V3_BLIND`
 * ballot, as the CSP returns it (hex). It goes in `ProofCA.weightCertificate`.
 */
export interface WeightCertificate {
  /** Compressed public key (33 bytes) that blind-signed the ballot. */
  weightKey: string
  /** 65-byte signature of the weight key by the election's census root key. */
  signature: string
}

/** What a CSP signature result says about the proof it must be spent as. */
export interface CspProofFields {
  proofType?: CspProofType
  weightKey?: string
  weightCertificate?: string
}

/** The proof options of {@link buildVoteTransaction} a CSP result determines. */
export interface CspProofOptions {
  proofType: ProofCA_Type
  weightCertificate?: WeightCertificate
}

const PROOF_TYPES: Record<CspProofType, ProofCA_Type> = {
  ECDSA: ProofCA_Type.ECDSA,
  ECDSA_PIDSALTED: ProofCA_Type.ECDSA_PIDSALTED,
  ECDSA_BLIND: ProofCA_Type.ECDSA_BLIND,
  ECDSA_BLIND_PIDSALTED: ProofCA_Type.ECDSA_BLIND_PIDSALTED,
}

/**
 * The proof type, and for `ECDSA_BLIND` the weight certificate, to build a
 * vote with from one CSP signature result.
 *
 * The CSP names the proof type of every signature, because it depends on the
 * census origin of each question's election. A CSP that does not name it signs
 * only the salted proof types, so `fallback` applies: `ECDSA_BLIND_PIDSALTED`
 * for an anonymous census, `ECDSA_PIDSALTED` otherwise. An unknown name, or an
 * `ECDSA_BLIND` result without its certificate, throws: either would build a
 * vote the chain rejects.
 */
export function cspProofOptions(result: CspProofFields, fallback: ProofCA_Type): CspProofOptions {
  if (result.proofType === undefined) {
    if (result.weightKey || result.weightCertificate) {
      throw new Error('The CSP returned a weight certificate without a proof type')
    }
    return { proofType: fallback }
  }
  if (!Object.hasOwn(PROOF_TYPES, result.proofType)) {
    throw new Error(`Unknown CSP proof type ${result.proofType}`)
  }
  const proofType = PROOF_TYPES[result.proofType]
  if (proofType !== ProofCA_Type.ECDSA_BLIND) {
    if (result.weightKey || result.weightCertificate) {
      throw new Error(`The CSP returned a weight certificate with a ${result.proofType} signature`)
    }
    return { proofType }
  }
  if (!result.weightKey || !result.weightCertificate) {
    throw new Error('The CSP returned an ECDSA_BLIND signature without its weight certificate')
  }
  return { proofType, weightCertificate: { weightKey: result.weightKey, signature: result.weightCertificate } }
}

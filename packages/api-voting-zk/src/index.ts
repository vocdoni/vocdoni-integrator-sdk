// @vocdoni/api-voting-zk — anonymous (ZK-SNARK) voting for the Vocdoni SaaS API.
// Ported from the Vocdoni SDK's AnonymousService / ZkAPI, adapted to the new
// functional, tree-shakeable paradigm. Heavy deps (snarkjs) live only in this
// package so they never load unless anonymous voting is used.

export {
  VOCDONI_SIK_PAYLOAD,
  VOCDONI_SIK_SIGNATURE_LENGTH,
  type ZkProof,
  type CircuitInputs,
  type ChainCircuits,
  type ChainCircuitInfo,
  type SikResponse,
  type ZkCensusProofResponse,
} from './types'

export { arbo, ff, bigIntToHex, arrayBufferToHex, hexToArrayBuffer } from './field'

export {
  signatureToVocdoniSikSignature,
  calcCircuitInputs,
  calcNullifier,
  calcVoteId,
  calcSik,
  prepareCircuitInputs,
} from './sik'

export { fetchCircuitInfo, fetchCircuits, checkCircuitsHashes } from './circuits'

export { generateGroth16Proof, packageZkProof } from './zk-proof'

export { fetchSik, fetchZkCensusProof, hasRegisteredSik } from './zk-api'

export { EphemeralSigner } from './ephemeral-signer'
export { BallotEncryptor } from './ballot-encryptor'
export { buildVotePackage, type VotePackageOptions, type VotePackageResult } from './vote-package'
export {
  buildCaBundle,
  buildVoteTransaction,
  encodeCaBundle,
  MAX_MEMO_BYTES,
  type BuildVoteTransactionOptions,
  type CaBundleOptions,
} from './vote-transaction'
export {
  signBlindCspBallots,
  type BlindCspApiClient,
  type BlindCspBallot,
  type BlindCspResult,
  type SignBlindCspBallotsOptions,
} from './blind-csp'
export {
  blind,
  blindMessageFromBundle,
  decompressBlindPoint,
  serializeBlindSignature,
  unblind,
  BLIND_POINT_BYTES,
  BLIND_SIGNATURE_BYTES,
  type BlindPoint,
  type BlindSignature,
  type BlindUserSecret,
} from './blind-secp256k1'
export {
  VotingClient,
  type VotingClientOptions,
  type VoteApiClient,
} from './voting-client'
export { strip0x, ensure0x, fromHex, toHex } from './hex'
// Re-exported so callers can tag a proof without depending on @vocdoni/proto
// themselves. It is an enum, so it exists at runtime: a package that imports it
// from proto directly gets protobufjs inlined into its bundle for one integer.
export { ProofCA_Type } from '@vocdoni/proto/vochain'

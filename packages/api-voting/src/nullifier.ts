import { keccak_256 } from '@noble/hashes/sha3'
import { concatBytes } from '@noble/hashes/utils'
import { ensure0x, fromHex, toHex } from './hex'

/**
 * The Vochain vote nullifier of `address` in election `electionId` (a
 * question's `upstreamId`): `0x` + hex of keccak256(address[20] ‖ electionId),
 * the same as Go `state.GenerateNullifier`. Both inputs take 0x-prefixed or
 * bare hex, any case. It is the vote id `POST /votes/verify` checks.
 */
export function voteNullifier(address: string, electionId: string): string {
  const addr = fromHex(address.toLowerCase())
  if (addr.length !== 20) throw new Error(`voteNullifier: address must be 20 bytes, got ${addr.length}`)
  return ensure0x(toHex(keccak_256(concatBytes(addr, fromHex(electionId.toLowerCase())))))
}

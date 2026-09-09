// Secret Identity Key (SIK), nullifier and circuit-input derivation, ported
// from the Vocdoni SDK's AnonymousService. The poseidon hashing and field
// encoding are consensus-critical and kept identical to the SDK.

import { utf8ToBytes } from '@noble/hashes/utils'
import { strip0x } from '@vocdoni/api-voting'
import { arbo, arrayBufferToHex, bigIntToHex, ff, hexToArrayBuffer } from './field'
import { poseidon } from './poseidon'
import { VOCDONI_SIK_SIGNATURE_LENGTH, type CircuitInputs } from './types'

/**
 * Drops the recovery byte of a personal_sign signature (the last byte differs
 * from a go-generated signature), keeping the first {@link VOCDONI_SIK_SIGNATURE_LENGTH} bytes.
 */
export function signatureToVocdoniSikSignature(personalSign: string): string {
  const buffSign = hexToArrayBuffer(personalSign)
  return arrayBufferToHex(buffSign.slice(0, VOCDONI_SIK_SIGNATURE_LENGTH))
}

/** Computes the field-encoded signature, password and arbo election id, plus the nullifier. */
export async function calcCircuitInputs(signature: string, password: string, electionId: string) {
  const safeSignature = signatureToVocdoniSikSignature(strip0x(signature))
  const arboElectionId = await arbo.toHash(electionId)
  const ffsignature = ff.hexToFFBigInt(strip0x(safeSignature)).toString()
  const ffpassword = ff.hexToFFBigInt(arrayBufferToHex(utf8ToBytes(password))).toString()

  const nullifier = poseidon([ffsignature, ffpassword, arboElectionId[0], arboElectionId[1]])

  return { nullifier, arboElectionId, ffsignature, ffpassword }
}

/** The vote nullifier for the (signature, password, election) triple. */
export async function calcNullifier(
  signature: string,
  password: string,
  electionId: string,
): Promise<bigint> {
  return calcCircuitInputs(signature, password, electionId).then((i) => i.nullifier)
}

/** Hex vote id derived from the nullifier. */
export async function calcVoteId(
  signature: string,
  password: string,
  electionId: string,
): Promise<string> {
  return calcNullifier(signature, password ?? '0', electionId).then((n) => bigIntToHex(n))
}

/** Computes the Secret Identity Key for an address from its signed SIK payload. */
export async function calcSik(
  address: string,
  personalSign: string,
  password: string = '0',
): Promise<string> {
  const arboAddress = arbo.toBigInt(strip0x(address)).toString()
  const safeSignature = signatureToVocdoniSikSignature(strip0x(personalSign))

  const ffsignature = ff.hexToFFBigInt(safeSignature).toString()
  const ffpassword = ff.hexToFFBigInt(arrayBufferToHex(utf8ToBytes(password))).toString()

  const hash = poseidon([arboAddress, ffpassword, ffsignature])
  return arbo.toString(hash)
}

/**
 * Assembles the full set of circuit inputs for proof generation. Mirrors
 * `AnonymousService.prepareCircuitInputs`.
 */
export async function prepareCircuitInputs(
  electionId: string,
  address: string,
  password: string,
  signature: string,
  voteWeight: string,
  availableWeight: string,
  sikRoot: string,
  sikSiblings: string[],
  censusRoot: string,
  censusSiblings: string[],
  votePackage: Uint8Array,
): Promise<CircuitInputs> {
  const [circuitInputs, voteHash] = await Promise.all([
    calcCircuitInputs(signature, password, electionId),
    arbo.toHash(bigIntToHex(BigInt('0x' + arrayBufferToHex(votePackage)))),
  ])

  return {
    electionId: circuitInputs.arboElectionId,
    nullifier: circuitInputs.nullifier.toString(),
    availableWeight: arbo.toBigInt(availableWeight).toString(),
    voteHash,
    sikRoot: arbo.toBigInt(sikRoot).toString(),
    censusRoot: arbo.toBigInt(censusRoot).toString(),
    address: arbo.toBigInt(strip0x(address)).toString(),
    password: circuitInputs.ffpassword,
    signature: circuitInputs.ffsignature,
    voteWeight: arbo.toBigInt(voteWeight).toString(),
    sikSiblings,
    censusSiblings,
  }
}

// Poseidon hash over the BN254 scalar field, built from @noble/curves'
// generic permutation primitive with circomlib's parameters (8 full rounds,
// alpha=5 S-box, width-dependent partial rounds). Verified to reproduce
// circomlibjs's `buildPoseidon()` output bit-for-bit for every width used
// here — consensus-critical, do not change the round counts.

import { grainGenConstants, poseidon as noblePoseidon } from '@noble/curves/abstract/poseidon.js'
import { Field } from '@noble/curves/abstract/modular.js'
import { ff } from './field'

const ROUNDS_FULL = 8

// circomlib's N_ROUNDS_P, indexed by state width t (= number of inputs + 1).
const ROUNDS_PARTIAL: Record<number, number> = {
  4: 56,
  5: 60,
}

const Fp = Field(ff.q)

function buildHasher(t: number) {
  const roundsPartial = ROUNDS_PARTIAL[t]
  if (roundsPartial === undefined) {
    throw new Error(`poseidon: unsupported width t=${t}`)
  }
  const base = { Fp, t, roundsFull: ROUNDS_FULL, roundsPartial, sboxPower: 5 }
  const constants = grainGenConstants(base)
  // `noblePoseidon` validates the options itself; no need to pre-run `validateOpts`.
  return noblePoseidon({ ...base, ...constants })
}

const hashers = new Map<number, ReturnType<typeof buildHasher>>()

function hasherFor(t: number) {
  let hash = hashers.get(t)
  if (!hash) {
    hash = buildHasher(t)
    hashers.set(t, hash)
  }
  return hash
}

/** Poseidon hash of `inputs`, matching circomlib's `poseidon(inputs)` output. */
export function poseidon(inputs: Array<bigint | string>): bigint {
  const state = [0n, ...inputs.map((i) => (typeof i === 'string' ? BigInt(i) : i))]
  return hasherFor(state.length)(state)[0]
}

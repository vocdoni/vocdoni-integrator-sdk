# Reference: @vocdoni/api-voting-zk

ZK-SNARK (Groth16) anonymous-voting primitives for the Vocdoni SaaS API, ported from the Vocdoni SDK's `AnonymousService` / `ZkAPI` and adapted to the SDK's functional, tree-shakeable paradigm. The heavy proving dependencies (`snarkjs`, `circomlibjs`) live only in this package, so they never load unless anonymous voting is used.

A voter derives a **SIK** (Secret Identity Key) from a wallet signature, registers it on chain, then proves census membership with a Groth16 proof instead of revealing an address. The SIK tree and its membership proof come from a **Vochain gateway**, not the SaaS API — every function in `zk-api.ts` takes a `gatewayUrl`.

---

## SIK derivation and circuit inputs (`sik.ts`)

```ts
// Constant payload the voter signs (personal_sign) to seed the SIK
VOCDONI_SIK_PAYLOAD: string
VOCDONI_SIK_SIGNATURE_LENGTH: 64

// Truncates a personal_sign signature to the 64 bytes the SIK uses
signatureToVocdoniSikSignature(personalSign: string): string

// Secret Identity Key for an address (poseidon over address, password, signature)
calcSik(address: string, personalSign: string, password?: string): Promise<string>

// Field-encoded signature/password/election id + the poseidon nullifier
calcCircuitInputs(signature: string, password: string, electionId: string)
  : Promise<{ nullifier: bigint; arboElectionId: string[]; ffsignature: string; ffpassword: string }>

// Vote nullifier for the (signature, password, election) triple
calcNullifier(signature: string, password: string, electionId: string): Promise<bigint>

// Hex vote id derived from the nullifier
calcVoteId(signature: string, password: string, electionId: string): Promise<string>

// Full witness for proof generation (mirrors AnonymousService.prepareCircuitInputs)
prepareCircuitInputs(
  electionId, address, password, signature,
  voteWeight, availableWeight,
  sikRoot, sikSiblings, censusRoot, censusSiblings,
  votePackage: Uint8Array,
): Promise<CircuitInputs>
```

## Proof generation (`zk-proof.ts`)

```ts
// Runs groth16.fullProve over the witness with the circuit's wasm + zkey bytes
generateGroth16Proof(inputs: CircuitInputs, wasmData: Uint8Array, zKeyData: Uint8Array): Promise<ZkProof>

// Wraps a ZkProof into a Vochain `Proof` (ProofZkSNARK, G2 point flattened),
// ready to drop into a VoteEnvelope
packageZkProof(zk: ZkProof, circuitParametersIndex?: number): Proof
```

## Circuit artifacts (`circuits.ts`)

```ts
fetchCircuitInfo(gatewayUrl: string): Promise<ChainCircuitInfo>  // chain's circuit metadata
fetchCircuits(gatewayUrl: string): Promise<ChainCircuits>        // downloads wasm/zkey/vkey + verifies hashes
checkCircuitsHashes(circuits: ChainCircuits): ChainCircuits      // throws on hash mismatch
```

## Gateway API (`zk-api.ts`)

```ts
fetchSik(gatewayUrl: string, address: string): Promise<SikResponse>                 // GET /siks/{address}
fetchZkCensusProof(gatewayUrl: string, address: string): Promise<ZkCensusProofResponse> // GET /siks/proof/{address}

// Compares the locally-computed SIK against the registered one — decides
// whether a REGISTER_SIK tx is needed first
hasRegisteredSik(gatewayUrl: string, address: string, calcSik: () => Promise<string>): Promise<boolean>
```

## Field helpers (`field.ts`)

```ts
arbo  // arbo-tree encodings: toBigInt, toHash, toString
ff    // finite-field encodings: hexToFFBigInt, ...
bigIntToHex(bi: bigint): string
arrayBufferToHex(input: Uint8Array): string
hexToArrayBuffer(input: string): Uint8Array
```

## Types (`types.ts`)

`ZkProof`, `CircuitInputs`, `ChainCircuits`, `ChainCircuitInfo`, `SikResponse`, `ZkCensusProofResponse`.

---

## Notes

- This is the ZK path (`EnvelopeType.Anonymous`), distinct from blind-CSP anonymous voting — see [[voting]] for the blind-signature flow, which lives in `@vocdoni/api-voting` and needs no circuits.
- Proof encodings mirror the Vocdoni SDK byte-for-byte (`packageZkProof` matches `Vote.packageSignedProof`'s ANONYMOUS branch).

## Cross-references

- [[integrator-sdk]] — overview and packages
- [[voting]] — the CSP-based vote flow (plain and blind)

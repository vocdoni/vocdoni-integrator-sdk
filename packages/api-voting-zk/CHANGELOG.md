# @vocdoni/api-voting-zk

## 1.0.1

### Patch Changes

- c5e803d: Remove the now-unused `circomlibjs` dependency. Poseidon hashing moved to `@noble/curves` in the previous release and nothing imports `circomlibjs` any more, but it was still declared in `package.json` and therefore still installed by every consumer. Dropping it prunes 57 packages from the install tree; no runtime behaviour changes.
- a088d8b: Replace the `circomlibjs` Poseidon hash with an equivalent built on `@noble/curves`. Output is bit-for-bit identical (pinned by regression tests against circomlibjs reference vectors) and the built output no longer imports `circomlibjs` at runtime. `circomlibjs` remains listed in `package.json` but is no longer imported.
- Updated dependencies [49e57c8]
  - @vocdoni/api-voting@1.2.0

## 1.0.0

### Major Changes

- 7bb69a9: First release of `@vocdoni/api-voting-zk`: ZK (zk-SNARK) anonymous voting primitives for the Vocdoni SaaS API. Ported from the Vocdoni SDK's `AnonymousService` / `ZkAPI` and adapted to the SDK's functional, tree-shakeable paradigm — the heavy proving dependencies (`snarkjs`, `circomlibjs`) live only in this package, so they never load unless anonymous voting is actually used.

  What ships:

  - **SIK primitives** — `calcSik`, `calcNullifier`, `calcVoteId`, `signatureToVocdoniSikSignature`, plus `calcCircuitInputs` / `prepareCircuitInputs` to assemble the witness for the census-membership circuit.
  - **Proof generation** — `generateGroth16Proof` and `packageZkProof` to produce and encode the Groth16 proof the vote envelope carries.
  - **Circuit management** — `fetchCircuitInfo`, `fetchCircuits`, `checkCircuitsHashes` to download the chain's circuit artifacts and verify their integrity before proving.
  - **ZK API calls** — `fetchSik`, `fetchZkCensusProof`, `hasRegisteredSik`.
  - **Field helpers** — `arbo`, `ff`, and the hex/buffer conversion utilities the above are built on.

  This entry also covers the `@vocdoni/proto` `1.15.13` → `1.15.14` pin bump previously tracked as a patch: the pin is the version of the protocol the package claims to speak, and it now ships at `1.15.14` from the start.

### Patch Changes

- Updated dependencies [e6ff0b2]
- Updated dependencies [7492468]
  - @vocdoni/api-types@2.0.0
  - @vocdoni/api-voting@1.1.0

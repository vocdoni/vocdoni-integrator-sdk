---
'@vocdoni/api-voting-zk': major
---

First release of `@vocdoni/api-voting-zk`: ZK (zk-SNARK) anonymous voting primitives for the Vocdoni SaaS API. Ported from the Vocdoni SDK's `AnonymousService` / `ZkAPI` and adapted to the SDK's functional, tree-shakeable paradigm — the heavy proving dependencies (`snarkjs`, `circomlibjs`) live only in this package, so they never load unless anonymous voting is actually used.

What ships:

- **SIK primitives** — `calcSik`, `calcNullifier`, `calcVoteId`, `signatureToVocdoniSikSignature`, plus `calcCircuitInputs` / `prepareCircuitInputs` to assemble the witness for the census-membership circuit.
- **Proof generation** — `generateGroth16Proof` and `packageZkProof` to produce and encode the Groth16 proof the vote envelope carries.
- **Circuit management** — `fetchCircuitInfo`, `fetchCircuits`, `checkCircuitsHashes` to download the chain's circuit artifacts and verify their integrity before proving.
- **ZK API calls** — `fetchSik`, `fetchZkCensusProof`, `hasRegisteredSik`.
- **Field helpers** — `arbo`, `ff`, and the hex/buffer conversion utilities the above are built on.

This entry also covers the `@vocdoni/proto` `1.15.13` → `1.15.14` pin bump previously tracked as a patch: the pin is the version of the protocol the package claims to speak, and it now ships at `1.15.14` from the start.

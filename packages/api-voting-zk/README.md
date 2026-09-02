<p align="center" width="100%">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://developer.vocdoni.io/img/vocdoni_logotype_full_blank.svg" />
      <source media="(prefers-color-scheme: light)" srcset="https://developer.vocdoni.io/img/vocdoni_logotype_full_white.svg" />
      <img alt="Vocdoni" src="https://developer.vocdoni.io/img/vocdoni_logotype_full_white.svg" />
  </picture>
</p>

<p align="center" width="100%">
    <a href="https://github.com/vocdoni/integrator-sdk/commits/main/"><img src="https://img.shields.io/github/commit-activity/m/vocdoni/integrator-sdk" /></a>
    <a href="https://github.com/vocdoni/integrator-sdk/issues"><img src="https://img.shields.io/github/issues/vocdoni/integrator-sdk" /></a>
    <a href="https://discord.gg/xFTh8Np2ga"><img src="https://img.shields.io/badge/discord-join%20chat-blue.svg" /></a>
    <a href="https://twitter.com/vocdoni"><img src="https://img.shields.io/twitter/follow/vocdoni.svg?style=social&label=Follow" /></a>
</p>

# @vocdoni/api-voting-zk

Anonymous (ZK-SNARK) voting for the Vocdoni SaaS API. It complements
[`@vocdoni/api-voting`](../api-voting) for processes that hide the voter's identity, adding
the zero-knowledge machinery: secret identity keys (SIK), nullifiers, census proofs and
Groth16 proof generation.

It is ported from the Vocdoni SDK's `AnonymousService` / `ZkAPI` and adapted to the App
SDK's functional, tree-shakeable paradigm. The heavy dependencies (`snarkjs`,
`circomlibjs`) are isolated in this package, so they are only ever loaded by apps that
actually use anonymous voting.

What it provides:

- **Circuits** — fetch and verify the proving circuits (`fetchCircuits`, `fetchCircuitInfo`).
- **SIK & inputs** — derive the secret identity key and circuit inputs (`calcSik`,
  `calcCircuitInputs`, `calcNullifier`).
- **Proofs** — generate and package the Groth16 proof (`generateGroth16Proof`,
  `packageZkProof`).
- **ZK census** — register and fetch the anonymous census proof (`fetchZkCensusProof`,
  `hasRegisteredSik`).

## Install

~~~bash
pnpm add @vocdoni/api-voting-zk
~~~

## Usage

~~~ts
import { calcSik, generateGroth16Proof } from '@vocdoni/api-voting-zk'

const sik = await calcSik(address, personalSignature)
~~~

## License

This package is licensed under the [GNU General Public License v3.0](../../LICENSE).

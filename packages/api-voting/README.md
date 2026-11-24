<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://app.vocdoni.io/assets/logo-classic-white.svg" />
    <source media="(prefers-color-scheme: light)" srcset="https://app.vocdoni.io/assets/logo-classic.svg" />
    <img alt="Vocdoni" width="280" src="https://app.vocdoni.io/assets/logo-classic.svg" />
  </picture>
</p>
<h1 align="center">@vocdoni/api-voting</h1>
<p align="center">Client-side voting for the Vocdoni SaaS API (CSP auth, vote envelope, encrypted ballots).</p>
<p align="center">
  <a href="https://www.npmjs.com/package/@vocdoni/api-voting"><img alt="npm version" src="https://img.shields.io/npm/v/@vocdoni/api-voting?label=npm" /></a>
  <a href="https://www.npmjs.com/package/@vocdoni/api-voting"><img alt="npm downloads" src="https://img.shields.io/npm/dm/@vocdoni/api-voting" /></a>
  <a href="https://github.com/vocdoni/vocdoni-integrator-sdk/actions/workflows/release.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/vocdoni/vocdoni-integrator-sdk/release.yml?branch=main&label=CI" /></a>
  <a href="https://github.com/vocdoni/vocdoni-integrator-sdk/blob/main/LICENSE"><img alt="license" src="https://img.shields.io/badge/license-LGPL--3.0--or--later-blue" /></a>
</p>
<p align="center">
  <a href="https://vocdoni.io/developers">Docs</a> · <a href="https://github.com/vocdoni/vocdoni-integrator-sdk#packages">All packages</a> · <a href="https://chat.vocdoni.io">Discord</a>
</p>

The client-side voting primitives for the Vocdoni SaaS API. This package owns the
cryptography and transaction building that turn a voter's choices into a signed Vochain
vote envelope, which is then relayed to the SaaS API.

It provides:

- **`VotingClient`** — the high-level entry point. `vote()` builds, signs and relays a vote
  in one call, returning an async job id. The api-client is injected at construction (see below).
- **`buildVotePackage`** — assembles the vote package, optionally encrypting the ballot for
  `secretUntilTheEnd` elections.
- **`buildVoteTransaction`** — builds the protobuf Vochain vote transaction with its CSP
  (CA) proof and signs it (EIP-191).
- **`EphemeralSigner`** / **`BallotEncryptor`** — the per-vote signer and ballot encryption
  helpers used under the hood.

Authentication and the CSP signature (and census weight) are obtained beforehand from the
process CSP auth/sign flow — typically through
[`@vocdoni/api-client`](https://github.com/vocdoni/vocdoni-integrator-sdk/tree/main/packages/api-client).
This package picks up from there and produces the vote.

## Install

This package builds and signs the vote, but it does **not** talk to the network — it stays
free of any HTTP client so its bundle never leaks into read-only consumers. The actual relay is
performed by [`@vocdoni/api-client`](https://github.com/vocdoni/vocdoni-integrator-sdk/tree/main/packages/api-client),
which you inject. Install both:

```bash
pnpm add @vocdoni/api-voting @vocdoni/api-client
```

## Usage

`VotingClient` takes your api-client at construction and relays through it internally — you
don't have to know which endpoint it uses. The `VoteApiClient` interface is satisfied
structurally by the full `VocdoniApiClient`, so you pass the client you already have, and
api-voting never imports api-client:

```ts
import { VocdoniApiClient } from '@vocdoni/api-client'
import { VotingClient, EphemeralSigner } from '@vocdoni/api-voting'

const client = new VocdoniApiClient({ apiUrl })
const voting = new VotingClient({ client })

// `signer` and `cspSignature` come from the process CSP auth/sign flow (via api-client).
const jobId = await voting.vote({
  processId,
  chainId, // Vochain chain id the vote is destined for
  choices: [1],
  signer, // ephemeral signer whose address the CSP signed
  cspSignature, // signature returned by the process CSP sign endpoint
})

// Poll GET /jobs/{jobId} to obtain the vote nullifier once the job completes.
const job = await client.jobs.waitFor(jobId)
const nullifier = job.result?.voteID
```

## License

This package is licensed under the [GNU Lesser General Public License v3.0 or later](https://github.com/vocdoni/vocdoni-integrator-sdk/blob/main/LICENSE).

Note: this package depends on [@vocdoni/proto](https://www.npmjs.com/package/@vocdoni/proto), which is published under GPL-3.0-or-later. Applications that bundle it are bound by the GPL terms of that dependency.

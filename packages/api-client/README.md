<p align="center" width="100%">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://developer.vocdoni.io/img/vocdoni_logotype_full_blank.svg" />
      <source media="(prefers-color-scheme: light)" srcset="https://developer.vocdoni.io/img/vocdoni_logotype_full_white.svg" />
      <img alt="Vocdoni" src="https://developer.vocdoni.io/img/vocdoni_logotype_full_white.svg" />
  </picture>
</p>

<p align="center" width="100%">
    <a href="https://github.com/vocdoni/vocdoni-integrator-sdk/commits/main/"><img src="https://img.shields.io/github/commit-activity/m/vocdoni/vocdoni-integrator-sdk" /></a>
    <a href="https://github.com/vocdoni/vocdoni-integrator-sdk/issues"><img src="https://img.shields.io/github/issues/vocdoni/vocdoni-integrator-sdk" /></a>
    <a href="https://discord.gg/xFTh8Np2ga"><img src="https://img.shields.io/badge/discord-join%20chat-blue.svg" /></a>
    <a href="https://twitter.com/vocdoni"><img src="https://img.shields.io/twitter/follow/vocdoni.svg?style=social&label=Follow" /></a>
</p>

# @vocdoni/api-client

The HTTP client for the [Vocdoni SaaS API](https://developer.vocdoni.io/). It is a thin,
typed wrapper around the SaaS REST endpoints and the foundation the rest of the Integrator SDK
builds on. Every call goes through the SaaS API — the client never talks to the blockchain
directly.

A single `VocdoniApiClient` groups the API surface into focused sub-clients:

- **`elections`** — read, create, publish and manage voting processes.
- **`organizations`** — manage organizations and their members.
- **`census`** — create and populate censuses.
- **`auth`** — account authentication against the SaaS API.
- **`bundle`** — the voter-facing CSP / two-factor auth flow for a bundle of processes.
- **`jobs`** — poll the status of asynchronous operations (publishing, vote relaying…).

Authentication is optional and lazy: pass `authToken` as a string or as a (possibly async)
getter and it is resolved and attached as a `Bearer` token on every request.

## Install

~~~bash
pnpm add @vocdoni/api-client
~~~

## Usage

~~~ts
import { VocdoniApiClient } from '@vocdoni/api-client'

const client = new VocdoniApiClient({ apiUrl: 'https://saas-api.vocdoni.net' })

const election = await client.elections.get('<electionId>')
~~~

## License

This package is licensed under the [GNU General Public License v3.0](../../LICENSE).

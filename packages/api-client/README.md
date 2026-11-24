<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://app.vocdoni.io/assets/logo-classic-white.svg" />
    <source media="(prefers-color-scheme: light)" srcset="https://app.vocdoni.io/assets/logo-classic.svg" />
    <img alt="Vocdoni" width="280" src="https://app.vocdoni.io/assets/logo-classic.svg" />
  </picture>
</p>
<h1 align="center">@vocdoni/api-client</h1>
<p align="center">HTTP client for the Vocdoni SaaS API.</p>
<p align="center">
  <a href="https://www.npmjs.com/package/@vocdoni/api-client"><img alt="npm version" src="https://img.shields.io/npm/v/@vocdoni/api-client?label=npm" /></a>
  <a href="https://www.npmjs.com/package/@vocdoni/api-client"><img alt="npm downloads" src="https://img.shields.io/npm/dm/@vocdoni/api-client" /></a>
  <a href="https://github.com/vocdoni/vocdoni-integrator-sdk/actions/workflows/release.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/vocdoni/vocdoni-integrator-sdk/release.yml?branch=main&label=CI" /></a>
  <a href="https://github.com/vocdoni/vocdoni-integrator-sdk/blob/main/LICENSE"><img alt="license" src="https://img.shields.io/badge/license-LGPL--3.0--or--later-blue" /></a>
</p>
<p align="center">
  <a href="https://vocdoni.io/developers">Docs</a> · <a href="https://github.com/vocdoni/vocdoni-integrator-sdk#packages">All packages</a> · <a href="https://chat.vocdoni.io">Discord</a>
</p>

The HTTP client for the [Vocdoni SaaS API](https://vocdoni.io/developers). It is a thin,
typed wrapper around the SaaS REST endpoints and the foundation the rest of the Integrator SDK
builds on. Every call goes through the SaaS API — the client never talks to the blockchain
directly.

A single `VocdoniApiClient` groups the API surface into focused sub-clients:

- **`elections`** — read, create, publish and manage voting processes (each embeds its own
  census), plus the voter-facing CSP / two-factor auth flow and vote relay.
- **`organizations`** — manage organizations, their members and groups.
- **`auth`** — account authentication against the SaaS API.
- **`jobs`** — poll the status of asynchronous operations (publishing, vote relaying…).

Authentication is optional and lazy: pass `authToken` as a string or as a (possibly async)
getter and it is resolved and attached as a `Bearer` token on every request.

## Install

```bash
pnpm add @vocdoni/api-client
```

## Usage

```ts
import { VocdoniApiClient } from '@vocdoni/api-client'

const client = new VocdoniApiClient({ apiUrl: 'https://saas-api.vocdoni.net' })

const election = await client.elections.get('<electionId>')
```

## License

This package is licensed under the [GNU Lesser General Public License v3.0 or later](https://github.com/vocdoni/vocdoni-integrator-sdk/blob/main/LICENSE).

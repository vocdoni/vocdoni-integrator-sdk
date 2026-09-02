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

# @vocdoni/api-types

Shared TypeScript types for the Vocdoni SaaS API. This package is **type-only**: it has no
runtime code, just the interfaces and types that describe the shapes the SaaS API speaks —
`Organization`, `Census`, `Election`, `Bundle`, the CSP bundle auth flow, vote relay
requests, async jobs, auth tokens and the client config.

It is the single source of truth for those shapes across the SDK: the other `@vocdoni/*`
packages depend on it, and you can use it directly in your own app code to type SaaS
responses and request bodies without pulling in any runtime dependency.

## Install

~~~bash
pnpm add -D @vocdoni/api-types
~~~

## Usage

~~~ts
import type { Election, Bundle } from '@vocdoni/api-types'

function describe(election: Election): string {
  return `${election.title} — ${election.status}`
}
~~~

## License

This package is licensed under the [GNU General Public License v3.0](../../LICENSE).

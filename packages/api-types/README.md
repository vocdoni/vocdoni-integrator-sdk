<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://app.vocdoni.io/assets/logo-classic-white.svg" />
    <source media="(prefers-color-scheme: light)" srcset="https://app.vocdoni.io/assets/logo-classic.svg" />
    <img alt="Vocdoni" width="280" src="https://app.vocdoni.io/assets/logo-classic.svg" />
  </picture>
</p>
<h1 align="center">@vocdoni/api-types</h1>
<p align="center">Shared TypeScript types for the Vocdoni Integrator SDK.</p>
<p align="center">
  <a href="https://www.npmjs.com/package/@vocdoni/api-types"><img alt="npm version" src="https://img.shields.io/npm/v/@vocdoni/api-types?label=npm" /></a>
  <a href="https://www.npmjs.com/package/@vocdoni/api-types"><img alt="npm downloads" src="https://img.shields.io/npm/dm/@vocdoni/api-types" /></a>
  <a href="https://github.com/vocdoni/vocdoni-integrator-sdk/actions/workflows/release.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/vocdoni/vocdoni-integrator-sdk/release.yml?branch=main&label=CI" /></a>
  <a href="https://github.com/vocdoni/vocdoni-integrator-sdk/blob/main/LICENSE"><img alt="license" src="https://img.shields.io/badge/license-LGPL--3.0--or--later-blue" /></a>
</p>
<p align="center">
  <a href="https://vocdoni.io/developers">Docs</a> · <a href="https://github.com/vocdoni/vocdoni-integrator-sdk#packages">All packages</a> · <a href="https://chat.vocdoni.io">Discord</a>
</p>

Shared TypeScript types for the Vocdoni SaaS API. This package is **type-only**: it has no
runtime code, just the interfaces and types that describe the shapes the SaaS API speaks —
`Organization`, `VotingProcessResponse` and its questions, the process CSP auth flow, vote relay
requests, async jobs, auth tokens and the client config.

It is the single source of truth for those shapes across the SDK: the other `@vocdoni/*`
packages depend on it, and you can use it directly in your own app code to type SaaS
responses and request bodies without pulling in any runtime dependency.

## Install

```bash
pnpm add -D @vocdoni/api-types
```

## Usage

```ts
import type { VotingProcessResponse } from '@vocdoni/api-types'

function describe(process: VotingProcessResponse): string {
  // `title` is a MultiLangString: `default` exists only when it was created from a plain string.
  const title = process.title.default ?? Object.values(process.title)[0] ?? ''
  return `${title} — ${process.questions.length} question(s)`
}
```

## License

This package is licensed under the [GNU Lesser General Public License v3.0 or later](https://github.com/vocdoni/vocdoni-integrator-sdk/blob/main/LICENSE).

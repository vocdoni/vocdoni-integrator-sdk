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

# @vocdoni/react-providers

Headless React providers and hooks for the Vocdoni Integrator SDK. This package owns all the state
and data wiring for a voting app — fetching, caching and exposing SaaS data through context
— while shipping **no UI at all**. You bring your own components and render however you
like.

The providers compose from the top down, each one exposing a matching hook:

- **`ClientProvider`** / `useClient` — configures the `@vocdoni/api-client` client. Wrap your
  app once.
- **`AuthProvider`** / `useAuth` — account authentication state.
- **`OrganizationProvider`** / `useOrganization` — the current organization and its data.
- **`ElectionProvider`** / `useElection` and **`ActionsProvider`** / `useActions` — a single
  election plus the actions (vote, etc.) available on it.
- **`ProcessProvider`** / `useProcess` — the voter-facing CSP auth flow for a voting
  process.

If you also want ready-made UI, use [`@vocdoni/react-components`](../react-components), which
re-exports everything here.

## Install

~~~bash
pnpm add @vocdoni/react-providers
~~~

## Usage

~~~tsx
import { ClientProvider, useClient } from '@vocdoni/react-providers'

function App() {
  return (
    <ClientProvider apiUrl="https://saas-api.vocdoni.net">
      <MyComponent />
    </ClientProvider>
  )
}

function MyComponent() {
  const { client } = useClient()
  // use the client...
}
~~~

## License

This package is licensed under the [GNU General Public License v3.0](../../LICENSE).

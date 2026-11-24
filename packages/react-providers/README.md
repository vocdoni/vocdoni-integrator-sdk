<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://app.vocdoni.io/assets/logo-classic-white.svg" />
    <source media="(prefers-color-scheme: light)" srcset="https://app.vocdoni.io/assets/logo-classic.svg" />
    <img alt="Vocdoni" width="280" src="https://app.vocdoni.io/assets/logo-classic.svg" />
  </picture>
</p>
<h1 align="center">@vocdoni/react-providers</h1>
<p align="center">Headless React providers and hooks for the Vocdoni Integrator SDK.</p>
<p align="center">
  <a href="https://www.npmjs.com/package/@vocdoni/react-providers"><img alt="npm version" src="https://img.shields.io/npm/v/@vocdoni/react-providers?label=npm" /></a>
  <a href="https://www.npmjs.com/package/@vocdoni/react-providers"><img alt="npm downloads" src="https://img.shields.io/npm/dm/@vocdoni/react-providers" /></a>
  <a href="https://github.com/vocdoni/vocdoni-integrator-sdk/actions/workflows/release.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/vocdoni/vocdoni-integrator-sdk/release.yml?branch=main&label=CI" /></a>
  <a href="https://github.com/vocdoni/vocdoni-integrator-sdk/blob/main/LICENSE"><img alt="license" src="https://img.shields.io/badge/license-LGPL--3.0--or--later-blue" /></a>
</p>
<p align="center">
  <a href="https://vocdoni.io/developers">Docs</a> · <a href="https://github.com/vocdoni/vocdoni-integrator-sdk#packages">All packages</a> · <a href="https://chat.vocdoni.io">Discord</a>
</p>

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
- `useElectionAuth` — the voter-facing CSP auth session, provided by `ElectionProvider`.

If you also want ready-made UI, use [`@vocdoni/react-components`](https://github.com/vocdoni/vocdoni-integrator-sdk/tree/main/packages/react-components), which
re-exports everything here.

## Install

```bash
pnpm add @vocdoni/react-providers
```

Peer dependencies: the packages below are required peers and must be installed in your app alongside this one. React 18 or later is also required.

```bash
pnpm add @tanstack/react-query @vocdoni/api-client @vocdoni/api-types @vocdoni/api-voting
```

## Usage

```tsx
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
```

## License

This package is licensed under the [GNU Lesser General Public License v3.0 or later](https://github.com/vocdoni/vocdoni-integrator-sdk/blob/main/LICENSE).

Note: this package requires [`@vocdoni/api-voting`](https://github.com/vocdoni/vocdoni-integrator-sdk/tree/main/packages/api-voting), which depends on [@vocdoni/proto](https://www.npmjs.com/package/@vocdoni/proto), published under GPL-3.0-or-later. Applications that bundle it are bound by the GPL terms of that dependency.

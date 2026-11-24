<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://app.vocdoni.io/assets/logo-classic-white.svg" />
    <source media="(prefers-color-scheme: light)" srcset="https://app.vocdoni.io/assets/logo-classic.svg" />
    <img alt="Vocdoni" width="280" src="https://app.vocdoni.io/assets/logo-classic.svg" />
  </picture>
</p>
<h1 align="center">@vocdoni/react-components</h1>
<p align="center">React UI components for Vocdoni voting.</p>
<p align="center">
  <a href="https://www.npmjs.com/package/@vocdoni/react-components"><img alt="npm version" src="https://img.shields.io/npm/v/@vocdoni/react-components?label=npm" /></a>
  <a href="https://www.npmjs.com/package/@vocdoni/react-components"><img alt="npm downloads" src="https://img.shields.io/npm/dm/@vocdoni/react-components" /></a>
  <a href="https://github.com/vocdoni/vocdoni-integrator-sdk/actions/workflows/release.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/vocdoni/vocdoni-integrator-sdk/release.yml?branch=main&label=CI" /></a>
  <a href="https://github.com/vocdoni/vocdoni-integrator-sdk/blob/main/LICENSE"><img alt="license" src="https://img.shields.io/badge/license-LGPL--3.0--or--later-blue" /></a>
</p>
<p align="center">
  <a href="https://vocdoni.io/developers">Docs</a> · <a href="https://github.com/vocdoni/vocdoni-integrator-sdk#packages">All packages</a> · <a href="https://chat.vocdoni.io">Discord</a>
</p>

React UI components for building Vocdoni voting interfaces. This is the batteries-included
entry point to the Integrator SDK on the frontend: it pairs ready-made components with the data
wiring, so most apps only need to install this one package.

On top of the components it ships:

- **A component slot system** (`ComponentsProvider`, `composeComponents`, `defineComponent`)
  that lets you override any built-in component with your own, without forking.
  Default slots show descriptions as plain text, never HTML; to render Markdown or HTML, override the slot and sanitize the output.
- **i18n** — a localization layer for all the bundled UI.
- **Helpers** — pagination, a confirmation dialog (`ConfirmProvider` / `useConfirm`) and
  election-normalization utilities. Components that need a confirmation dialog
  (`QuestionsFormProvider`, `ActionCancel`, `ActionEnd`) mount their own `ConfirmProvider`
  automatically; mount one yourself (app-wide) only if you want them to share a single
  dialog boundary — a provider you mount always takes precedence.
- **The providers and hooks** from [`@vocdoni/react-providers`](https://github.com/vocdoni/vocdoni-integrator-sdk/tree/main/packages/react-providers),
  re-exported, so you import everything from this package (it is still a required peer, see Install).

## Install

```bash
pnpm add @vocdoni/react-components
```

Peer dependencies: the packages below are required peers and must be installed in your app alongside this one, including `@vocdoni/api-voting`, which `@vocdoni/react-providers` requires. React 18 or later is also required.

```bash
pnpm add @tanstack/react-query @vocdoni/api-client @vocdoni/api-types @vocdoni/api-voting @vocdoni/ballot @vocdoni/react-providers date-fns i18next react-i18next
```

`react-router-dom` (>= 6.0.0) is an optional peer, needed only for `RoutedPagination` and `RoutedPaginationProvider`.

## Usage

Wrap your app in the client provider and the component slot provider, then build your UI
inside:

```tsx
import { ClientProvider, ComponentsProvider } from '@vocdoni/react-components'

export const App = () => (
  <ClientProvider apiUrl="https://saas-api.vocdoni.net">
    <ComponentsProvider>
      {/* your voting UI */}
    </ComponentsProvider>
  </ClientProvider>
)
```

## License

This package is licensed under the [GNU Lesser General Public License v3.0 or later](https://github.com/vocdoni/vocdoni-integrator-sdk/blob/main/LICENSE).

Note: this package requires [`@vocdoni/api-voting`](https://github.com/vocdoni/vocdoni-integrator-sdk/tree/main/packages/api-voting), which depends on [@vocdoni/proto](https://www.npmjs.com/package/@vocdoni/proto), published under GPL-3.0-or-later. Applications that bundle it are bound by the GPL terms of that dependency.

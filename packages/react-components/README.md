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

# @vocdoni/react-components

React UI components for building Vocdoni voting interfaces. This is the batteries-included
entry point to the Integrator SDK on the frontend: it pairs ready-made components with the data
wiring, so most apps only need to install this one package.

On top of the components it ships:

- **A component slot system** (`ComponentsProvider`, `composeComponents`, `defineComponent`)
  that lets you override any built-in component with your own, without forking.
- **i18n** — a localization layer for all the bundled UI.
- **Helpers** — pagination, a confirmation dialog (`ConfirmProvider` / `useConfirm`) and
  election-normalization utilities. Components that need a confirmation dialog
  (`QuestionsFormProvider`, `ActionCancel`, `ActionEnd`) mount their own `ConfirmProvider`
  automatically; mount one yourself (app-wide) only if you want them to share a single
  dialog boundary — a provider you mount always takes precedence.
- **The providers and hooks** from [`@vocdoni/react-providers`](../react-providers),
  re-exported so you don't have to install it separately.

## Install

~~~bash
pnpm add @vocdoni/react-components
~~~

## Usage

Wrap your app in the client provider and the component slot provider, then build your UI
inside:

~~~tsx
import { ClientProvider, ComponentsProvider } from '@vocdoni/react-components'

export const App = () => (
  <ClientProvider apiUrl="https://saas-api.vocdoni.net">
    <ComponentsProvider>
      {/* your voting UI */}
    </ComponentsProvider>
  </ClientProvider>
)
~~~

## License

This package is licensed under the [GNU General Public License v3.0](../../LICENSE).

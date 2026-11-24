<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://app.vocdoni.io/assets/logo-classic-white.svg" />
    <source media="(prefers-color-scheme: light)" srcset="https://app.vocdoni.io/assets/logo-classic.svg" />
    <img alt="Vocdoni" width="280" src="https://app.vocdoni.io/assets/logo-classic.svg" />
  </picture>
</p>
<h1 align="center">Vocdoni Integrator SDK</h1>
<p align="center">A modular, tree-shakeable toolkit for building voting applications on top of the Vocdoni SaaS API.</p>
<p align="center">
  <a href="https://github.com/vocdoni/vocdoni-integrator-sdk/actions/workflows/release.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/vocdoni/vocdoni-integrator-sdk/release.yml?branch=main&label=CI" /></a>
  <a href="https://github.com/vocdoni/vocdoni-integrator-sdk/blob/main/LICENSE"><img alt="license" src="https://img.shields.io/badge/license-LGPL--3.0--or--later-blue" /></a>
  <a href="https://chat.vocdoni.io"><img alt="Discord" src="https://img.shields.io/badge/discord-join%20chat-blue.svg" /></a>
</p>
<p align="center">
  <a href="https://vocdoni.io/developers">Developer portal</a> · <a href="https://vocdoni.io">Website</a> · <a href="https://app.vocdoni.io">Web app</a> · <a href="https://explorer.vote/">Explorer</a> · <a href="https://vocdoni.io/contact">Contact</a>
</p>

The Vocdoni Integrator SDK replaces the monolithic `@vocdoni/sdk` with a set of small,
focused packages: a typed HTTP client, the client-side voting primitives (CSP
auth, vote envelopes, ballot encryption), and a set of headless React providers
and UI components.

> The SDK talks **only** to the Vocdoni SaaS API. It never reaches the
> blockchain directly.

## Packages

| Package | npm | Description |
| --- | --- | --- |
| [`@vocdoni/api-client`](./packages/api-client) | [![npm](https://img.shields.io/npm/v/@vocdoni/api-client?label=)](https://www.npmjs.com/package/@vocdoni/api-client) | HTTP client for the Vocdoni SaaS API. |
| [`@vocdoni/api-types`](./packages/api-types) | [![npm](https://img.shields.io/npm/v/@vocdoni/api-types?label=)](https://www.npmjs.com/package/@vocdoni/api-types) | Shared TypeScript types for the SaaS API. |
| [`@vocdoni/ballot`](./packages/ballot) | [![npm](https://img.shields.io/npm/v/@vocdoni/ballot?label=)](https://www.npmjs.com/package/@vocdoni/ballot) | Framework-agnostic ballot semantics: type inference, choice encoding, results decoding. |
| [`@vocdoni/api-voting`](./packages/api-voting) | [![npm](https://img.shields.io/npm/v/@vocdoni/api-voting?label=)](https://www.npmjs.com/package/@vocdoni/api-voting) | Client-side voting: CSP auth, vote envelope, encrypted ballots. |
| [`@vocdoni/react-providers`](./packages/react-providers) | [![npm](https://img.shields.io/npm/v/@vocdoni/react-providers?label=)](https://www.npmjs.com/package/@vocdoni/react-providers) | Headless React providers and hooks. |
| [`@vocdoni/react-components`](./packages/react-components) | [![npm](https://img.shields.io/npm/v/@vocdoni/react-components?label=)](https://www.npmjs.com/package/@vocdoni/react-components) | React UI components for voting. |

## Which package do I need?

- **React app with ready-made UI:** `@vocdoni/react-components`. It re-exports the providers, which remain a required peer.
- **React app with your own UI:** `@vocdoni/react-providers`.
- **No React:** `@vocdoni/api-client`, plus `@vocdoni/api-voting` to cast votes.
- **Types only:** `@vocdoni/api-types`.
- **Encoding ballots or decoding results:** `@vocdoni/ballot`.

## AI coding agents

This repo ships a Claude Code skill at [`skills/vocdoni-integrator-sdk/`](./skills/vocdoni-integrator-sdk).
It is distributed through the Vocdoni skills marketplace at [vocdoni/skills](https://github.com/vocdoni/skills).

## Development

This is a [pnpm](https://pnpm.io) + [Turborepo](https://turborepo.dev) monorepo.

```bash
pnpm install
pnpm build              # build every package
pnpm test               # run unit tests
pnpm dev                # watch-build all packages
pnpm test:integration   # run the integration suite
```

The integration suite runs against a live SaaS API and needs an API key; see [integration/README.md](./integration/README.md).

Changes to a publishable package need a changeset: run `pnpm changeset` and commit the generated file with your PR.

## Contributing

Contributions are welcome, though the team may not have the capacity to review large pull requests, so open an issue on the [issue tracker](https://github.com/vocdoni/vocdoni-integrator-sdk/issues) first to discuss bigger changes.

Repository conventions are in [`AGENTS.md`](./AGENTS.md).

## License

This repository is licensed under the [GNU Lesser General Public License v3.0 or later](./LICENSE).

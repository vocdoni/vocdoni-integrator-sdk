<p align="center" width="100%">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://app-dev.vocdoni.io/assets/logo-classic-white.svg" />
      <source media="(prefers-color-scheme: light)" srcset="https://app-dev.vocdoni.io/assets/logo-classic.svg" />
      <img alt="Vocdoni logo" src="https://app-dev.vocdoni.io/assets/logo-classic.svg" />
  </picture>
</p>

<p align="center" width="100%">
    <a href="https://github.com/vocdoni/vocdoni-integrator-sdk/commits/main/"><img src="https://img.shields.io/github/commit-activity/m/vocdoni/vocdoni-integrator-sdk" /></a>
    <a href="https://github.com/vocdoni/vocdoni-integrator-sdk/issues"><img src="https://img.shields.io/github/issues/vocdoni/vocdoni-integrator-sdk" /></a>
    <a href="https://chat.vocdoni.io"><img src="https://img.shields.io/badge/discord-join%20chat-blue.svg" /></a>
    <a href="https://twitter.com/vocdoni"><img src="https://img.shields.io/twitter/follow/vocdoni.svg?style=social&label=Follow" /></a>
</p>

  <div align="center">
    Vocdoni is the first universally verifiable, censorship-resistant, anonymous, and self-sovereign governance protocol. <br />
    Our main aim is a trustless voting system where anyone can speak their voice and where everything is auditable. <br />
    We are engineering building blocks for a permissionless, private and censorship resistant democracy.
    <br />
    <a href="https://vocdoni.io/developers"><strong>Explore the developer portal »</strong></a>
    <br />
    <h3>More About Us</h3>
    <a href="https://vocdoni.io">Vocdoni Website</a>
    |
    <a href="https://vocdoni.app">Web Application</a>
    |
    <a href="https://explorer.vote/">Blockchain Explorer</a>
    |
    <a href="https://law.mit.edu/pub/remotevotingintheageofcryptography/release/1">MIT Law Publication</a>
    |
    <a href="https://vocdoni.io/contact">Contact Us</a>
    <br />
    <h3>Key Repositories</h3>
    <a href="https://github.com/vocdoni/vocdoni-app">Vocdoni App</a>
    |
    <a href="https://github.com/vocdoni/vocdoni-node">Vocdoni Node</a>
    |
    <a href="https://github.com/vocdoni/vocdoni-integrator-sdk">Vocdoni Integrator SDK</a>
  </div>

# Vocdoni Integrator SDK

A modular, tree-shakeable toolkit for building voting applications on top of the
Vocdoni SaaS API. It replaces the monolithic `@vocdoni/sdk` with a set of small,
focused packages: a typed HTTP client, the client-side voting primitives (CSP
auth, vote envelopes, ballot encryption), optional anonymous (ZK) voting, and a
set of headless React providers and UI components.

> The SDK talks **only** to the Vocdoni SaaS API — it never reaches the
> blockchain directly.

## Packages

| Package | Description |
| --- | --- |
| [`@vocdoni/api-client`](./packages/api-client) | HTTP client for the Vocdoni SaaS API. |
| [`@vocdoni/api-types`](./packages/api-types) | Shared TypeScript types for the SaaS API. |
| [`@vocdoni/ballot`](./packages/ballot) | Framework-agnostic ballot semantics: type inference, choice encoding, results decoding. |
| [`@vocdoni/api-voting`](./packages/api-voting) | Client-side voting: CSP auth, vote envelope, encrypted ballots. |
| [`@vocdoni/api-voting-zk`](./packages/api-voting-zk) | ZK / anonymous voting. |
| [`@vocdoni/react-providers`](./packages/react-providers) | Headless React providers and hooks. |
| [`@vocdoni/react-components`](./packages/react-components) | React UI components for voting. |

## Development

This is a [pnpm](https://pnpm.io) + [Turborepo](https://turbo.build) monorepo.

~~~bash
pnpm install
pnpm build        # build every package
pnpm test         # run unit tests
pnpm dev          # watch-build all packages
~~~

## Contributing

While we welcome contributions from the community, we do not track all of our issues on Github and we may not have the resources to onboard developers and review complex pull requests. That being said, there are multiple ways you can get involved with the project.

Please review our [development guidelines](https://developer.vocdoni.io/development-guidelines).

## License

This repository is licensed under the [GNU General Public License v3.0](./LICENSE).

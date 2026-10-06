# AI Agent Guidance

## Skills Maintenance

This repo ships a Claude Code skill at `skills/vocdoni-integrator-sdk/` (and its `references/` and `recipes/` subdirs). The skill is consumed by the `@vocdoni/skills` marketplace — users install it from there and Claude Code loads it as live guidance.

**Rule: any PR that adds or changes public API surface must either update the skill or include a brief note in the PR explaining why it's not worth documenting (e.g. internal, unstable, trivial).**

This covers:
- New classes, methods, options, or return shapes
- Changed auth flows, vote steps, or polling behaviour
- New packages or clients added to the SDK
- Deprecated APIs removed or replaced

When updating skills:
- Keep `SKILL.md` accurate: class names, method signatures, step-by-step flows.
- Update the relevant `references/*.md` file for detailed API docs.
- Update or add a `recipes/*.ts` file when the change affects a runnable example.

## Downstream Repositories

The SDK has consumers outside this repo that do not update themselves. Changing public API surface here leaves them stale until someone tells them, so suggest the follow-up to the user. Do not open issues or PRs in other repos without asking: suggest them, and let the user decide.

### Developer docs (`vocdoni/vocdoni.io`)

The public developer documentation lives in [vocdoni/vocdoni.io](https://github.com/vocdoni/vocdoni.io), under `content/developers/docs/` (e.g. `sdk-quickstart.md`, `sdks-and-tools.md`, `casting-votes.md`), served at `vocdoni.io/developers`. It is not generated from this repo, and the skill in `skills/` does not replace it.

**Rule: when a change adds, changes, renames or removes public API surface (the same list as in Skills Maintenance), suggest opening an issue or a PR in `vocdoni/vocdoni.io` to update the docs.** Name the affected pages if you can, and describe what changed: the old and new signatures, the removed method and its replacement, the new step in the flow.

### Vocdoni App (`vocdoni/vocdoni-app`)

[vocdoni/vocdoni-app](https://github.com/vocdoni/vocdoni-app) consumes the published `@vocdoni/*` packages from npm.

**Rule: when a release is about to publish API changes (a `chore(release): version packages` PR, or pending changesets with API changes), suggest opening an issue or a PR in `vocdoni/vocdoni-app` to adopt the new version.** Point at the changelog entries that need action: breaking changes, removed or replaced APIs, new required options.

## Changesets / Release Workflow

This repo uses [Changesets](https://github.com/changesets/changesets) for versioning and publishing. The release workflow is automated via GitHub Actions using npm's **trusted publishing** (OIDC/trust token). No `NPM_TOKEN` is required or should be configured.

### Quick Rules

- **Use Changesets:** For any change to a publishable package, run `changeset add` and describe the change (major/minor/patch).
- **Do not edit versions/changelogs manually:** Changesets manages version bumps and changelog generation via `changeset version`.
- **Publish flow:** CI owns publishing. When a release PR is merged with changesets, GitHub Actions runs `changeset publish` automatically. If there are no pending changesets after merge, you may run `pnpm release` directly.
- **Private package:** `packages/tsconfig` is private and must never be published. Changesets respects this via its `package.json` `"private": true`.
- **Downstream follow-up:** Before a release with API changes, suggest the `vocdoni/vocdoni-app` issue or PR described in [Downstream Repositories](#downstream-repositories).
- **Workflow filename matters:** The workflow file is `.github/workflows/release.yml`. Keep this name for npm trusted publishing.

### Typical Workflow

1. Make changes to publishable packages under `packages/*`.
2. Run `pnpm changeset` (or `changeset add`) to create a changeset describing your change.
3. Commit the changeset files.
4. Open/submit a PR. CI will verify and prepare release artifacts.
5. Merge the release PR → GitHub Actions publishes the packages using OIDC.

### npm Trusted Publishing Setup

- Configure trusted publisher on npmjs.com for each publishable package: go to the package page → Settings → Trusted publishing → Add GitHub Actions (select this repo and `.github/workflows/release.yml` workflow).
- Workflow filename must be `.github/workflows/release.yml`. It's the standard name npm's OIDC templates expect.

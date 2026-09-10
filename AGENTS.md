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

## Changesets / Release Workflow

This repo uses [Changesets](https://github.com/changesets/changesets) for versioning and publishing. The release workflow is automated via GitHub Actions using npm's **trusted publishing** (OIDC/trust token). No `NPM_TOKEN` is required or should be configured.

### Quick Rules

- **Use Changesets:** For any change to a publishable package, run `changeset add` and describe the change (major/minor/patch).
- **Do not edit versions/changelogs manually:** Changesets manages version bumps and changelog generation via `changeset version`.
- **Publish flow:** CI owns publishing. When a release PR is merged with changesets, GitHub Actions runs `changeset publish` automatically. If there are no pending changesets after merge, you may run `pnpm release` directly.
- **Private package:** `packages/tsconfig` is private and must never be published. Changesets respects this via its `package.json` `"private": true`.
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

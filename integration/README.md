# Integration tests

A single suite, `full-flow.itest.ts`, runs the entire organizer→voter lifecycle
against a **live SaaS API**. It is excluded from the normal unit run
(`pnpm test`); run it explicitly:

```bash
INTEGRATION_API_KEY=vsk_… pnpm test:integration
```

The command builds the workspace packages first, then runs vitest with
`integration/vitest.config.ts`. No MSW mocking is loaded — requests hit the
real API.

## Why one suite

Everything that needs a real backend is asserted inside the lifecycle, which
creates all of its own data — org, members, group, census, processes, votes —
so there are no dev-DB fixtures to rot. It runs in CI
(`.github/workflows/integration.yml`) against a disposable saas-api + vochain
container on every pull request, on pushes to `main`, and on a nightly
schedule. The whole job takes ~7 minutes (~5.7 min of it the suite itself:
11 on-chain elections and 44 votes, each a CSP sign + relay + job poll).

To run the same stack locally:

```bash
pnpm test:integration:stack
```

This boots `mongo` + `vocone` + `saas-backend` (`integration/docker-compose.ci.yml`),
seeds a default plan, mints an integrator API key, funds that integrator's prepaid
wallet (`integration/seed-wallet.js`), and runs the suite against it — identical to
what CI does. Tear it down afterwards with:

```bash
scripts/integration-stack.sh down
```

The stack pins `ghcr.io/vocdoni/vocdoni-node:main` and
`ghcr.io/vocdoni/saas-backend:main`. Override either with `VOCDONI_NODE_IMAGE`
or `SAAS_BACKEND_IMAGE` to run against an unmerged build. Neither upstream
publishes per-commit images, so build one from source; see
[Pinning upstream commits](#pinning-upstream-commits).

To drive the stack and the suite as separate steps (e.g. to reuse the same
stack across repeated test runs), use `scripts/integration-stack.sh up` to
start it — it prints `INTEGRATION_API_URL`, `INTEGRATION_API_KEY` and
`INTEGRATION_ORG_ADDRESS` — then export those and run `pnpm test:integration`
directly. If port `8080` (or `8025`) is already taken locally, set
`INTEGRATION_HOST_PORT` (and/or `INTEGRATION_MAILHOG_PORT`) to an alternate port
before calling `up`.
`up` funds the integrator wallet with `INTEGRATION_WALLET_CENTS` (default
€100,000). Each run spends €330 of it and nothing refunds it, so a reused stack
lasts about 300 runs.

## Pinning upstream commits

Comment on a pull request to run the suite against `vocdoni-node` and/or
`saas-backend` built from source at a given ref:

```text
/integration vocdoni-node=1a2b3c4 saas-backend=feat/wallets
```

- Each key is optional; a bare `/integration` uses the published `:main` images.
- A ref can be a commit SHA (short or full, 7-40 hex), a branch, a tag, or
  `#<PR number>` (its current head commit, e.g. `saas-backend=#760`). A bare PR number
  works too (`saas-backend=760`); a branch or tag named only with 1-6 digits can't be pinned by name.
- A short SHA only resolves when a current branch, tag or PR head of the upstream
  reaches it; use the full SHA for commits from deleted branches or force-pushed PR iterations.
- Only users with write access can trigger it; comments from anyone else are
  ignored silently.
- The run tests the PR's merge commit, as the `pull_request` check does, as it
  is when the run starts. The SDK SHA it tested is in the result comment.
- Each comment starts its own run; earlier ones are not cancelled.
- Images are built from source, so allow ~10+ extra minutes.
- The result is posted back to the PR as a comment with the SHAs and the run link.
- The comment trigger runs the workflow file from `main`, so changes to it only
  take effect once merged.

### One-shot or sticky

- A comment with any SHA runs once.
- A comment whose refs are all branches, tags or PRs sticks: every push to the
  PR re-resolves those refs and builds them again, until `/integration reset`.
  A later sticky comment replaces the earlier one.
- A bare `/integration` is one-shot and does not change the sticky state.
- `/integration reset` clears the sticky state, and takes no other token.
- Only sticky refs from users with write access count, checked the same way as
  comment runs. Other comments are ignored for this purpose.
- Pushes to the upstream PR do not re-run this check. Push to the SDK PR, re-run
  the check, or comment again.
- The `pull_request` check runs the workflow from the PR's merge commit, so once
  this is on `main` open PRs pick it up on their next push, unless they conflict with `main`.

### Actions tab

The "Run workflow" form takes `vocdoni_node_ref`, `saas_backend_ref` (same forms
as above) and `integrator_sdk_ref`: the SDK commit, branch or `#PR` to test.
Leave it empty to test the branch picked in "Use workflow from".

Locally, build an image and point the stack at it:

```bash
image=$(scripts/integration-build-image.sh vocdoni-node <ref> | sed -n 's/^image=//p')
[ -n "$image" ] && VOCDONI_NODE_IMAGE=$image pnpm test:integration:stack
```

The `up` step prints the two images it is using, so a run shows what it tested.

Use `SAAS_BACKEND_IMAGE` and `saas-backend` the same way.

saas-backend is private, so building it locally needs your own SSH access to
`vocdoni/saas-backend`. If the `ghcr.io/vocdoni/saas-backend` package is private
too, run `docker login ghcr.io` before pulling it.

CI needs the `SAAS_BACKEND_DEPLOY_KEY` repo secret (a read-only deploy key on
saas-backend) and read access to that package for this repo. Fork PR pushes
get no secrets, so they cannot build a pinned saas-backend; a maintainer's
`/integration` comment can.

## What it covers

1. Create a managed organization.
2. Load a 100-member memberbase (`memberNumber` 1..100), polling the unified
   jobs endpoint for the import.
3. Read the auto-created "All members" group.
4. No standalone census step: each process embeds its CSP census from that
   group (below).
5. Create and publish 5 processes (each embedding its census via
   `census: { groupId, authFields }` — publish rejects censusless processes) —
   single-choice, multi-choice, a `secretUntilTheEnd` single-choice whose
   per-question encryption keys are polled after publish, an **anonymous**
   single-choice (`census.anonymous`, voted through the two-round blind CSP
   flow), and a **ballot protocol matrix** (6 questions: approval, capped approval, pick-slot
   multichoice, ranked, budget, quadratic). For each, prove the
   **public voter surface** (saas-backend#599): the draft 404s on the
   token-less process read before publish; once published the process read is
   fully public — `chainId`, census `size`/`totalWeight`, questions — with
   `eligibleMemberIds` stripped; plus the token-less question read (choices,
   `ballotProtocol`/`type`, `upstreamId`, and the secret question's
   `encryptionKeys`) and the public process list. Also assert no question ships
   an unsatisfiable ballot config, and that a multichoice question created with
   `uniqueChoices: true` was normalized to `false`.
6. 4 members vote on every question through the **process-scoped CSP flow**
   (`client.elections`: `authStep0` → `check` → `sign`), with `chainId` read
   straight off the **public** process read — no integrator handoff. The secret
   question's ballots are sealed with its encryption keys. The anonymous
   process instead goes through `signBlindCspBallots()` — `blindPoint` → blind
   → `blindSign` → unblind — and casts an `ECDSA_BLIND_PIDSALTED` proof, which
   is the only end-to-end check that the SDK, the backend and the chain salt
   the census key identically.
7. Assert one distinct vote nullifier per (member, question) — 40 in total —
   and that `sign-info` reports neither address nor nullifier for the anonymous
   process while reporting both for every other one.
8. Read the live public tallies (`getResults` + single reads): every question
   reaches `voteCount = 4` with `finalResults = false`, `maxVoters` = census
   size, and — for cleartext questions — the **decoded per-choice tally**
   matches the expected result exactly (a secret question's matrix stays hidden
   until key reveal).

### Why decoded tallies, not just `voteCount`

`voteCount` counts accepted *envelopes*. The vochain scrutinizer validates the
ballot separately, during aggregation, and a ballot it rejects is skipped with
only a log line while `voteCount` keeps rising. A broken election is therefore
indistinguishable from an unpopular one unless you decode the tally and compare
it to what the voters actually picked. Two silent all-zero-results bugs were
found exactly this way, which is why every supported ballot type is voted and
asserted here rather than only the two named question types.

## Pay-per-process billing (`payg.itest.ts`)

Covers the saas-backend#819 billing surface through the integrator key, with no
Stripe: the integrator wallet read (`getWallet`), draft add-ons and their echo,
the per-draft price quote, the managed org's spend cap (set, listed, and a
publish refused with `40183` before any debit), and the public `/pricing`
calculator. It publishes nothing that spends money and cleans up its managed org
at the end.

The suite creates a managed org first and finds the integrator org from
`INTEGRATION_ORG_ADDRESS`, or else from the new org's `managedBy`. If neither
gives an address it fails. Against a backend that predates #819 the wallet route
answers 404, and the suite skips every test with a console note instead of
failing.

## Configuration

| Env var                   | Default                              | Purpose                          |
| ------------------------- | ------------------------------------ | -------------------------------- |
| `INTEGRATION_API_URL`     | `https://saas-api-dev.vocdoni.net`   | Target API base URL              |
| `INTEGRATION_API_KEY`     | — (suite skips without it)           | Integrator API key (`vsk_…`)     |
| `INTEGRATION_ORG_ADDRESS` | — (else `managedBy`)                 | The key's integrator org (`0x…`) |

The key's organization must be an **integrator** with scopes `managed:write` +
`members:write` + `voting:write`, and quota for ≥5 processes / ≥11 on-chain
elections / ≥300 census size, and its prepaid wallet must hold ≥€330 per run:
each of the 5 processes has a 100-voter census, above the free tier, so
publishing it debits the €66 base price (100 × €0.66) from the integrator's
wallet. The census is auth-only, so no email 2FA is charged; an integrator with
email 2FA pays €0.01 more per voter (€1 for 100). An empty wallet answers `402
insufficient integrator wallet balance`. The suite creates real on-chain
elections and casts 40 real votes, so expect it to take ~6 minutes. (The
disposable stack above provisions all of that for you — this only applies when
pointing `INTEGRATION_API_URL` at a shared environment.)

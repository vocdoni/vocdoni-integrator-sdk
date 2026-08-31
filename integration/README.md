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
10 on-chain elections and 40 votes, each a CSP sign + relay + job poll).

To run the same stack locally:

```bash
pnpm test:integration:stack
```

This boots `mongo` + `vocone` + `saas-backend` (`integration/docker-compose.ci.yml`),
seeds a default plan, mints an integrator API key, and runs the suite against it —
identical to what CI does. Tear it down afterwards with:

```bash
scripts/integration-stack.sh down
```

The stack pins `ghcr.io/vocdoni/saas-backend:main`. Override it to run against
an unmerged backend branch:

```bash
SAAS_BACKEND_IMAGE=ghcr.io/vocdoni/saas-backend:pr-641 pnpm test:integration:stack
```

To drive the stack and the suite as separate steps (e.g. to reuse the same
stack across repeated test runs), use `scripts/integration-stack.sh up` to
start it — it prints `INTEGRATION_API_URL` and `INTEGRATION_API_KEY` — then
export those and run `pnpm test:integration` directly. If port `8080` (or
`8025`) is already taken locally, set `INTEGRATION_HOST_PORT` (and/or
`INTEGRATION_MAILHOG_PORT`) to an alternate port before calling `up`.

## What it covers

1. Create a managed organization.
2. Load a 100-member memberbase (`memberNumber` 1..100), polling the unified
   jobs endpoint for the import.
3. Read the auto-created "All members" group.
4. Build and publish a CSP census from that group.
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
   (`client.processes`: `authStep0` → `check` → `sign`), with `chainId` read
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

## Configuration

| Env var               | Default                            | Purpose                       |
| --------------------- | ---------------------------------- | ----------------------------- |
| `INTEGRATION_API_URL` | `https://saas-api-dev.vocdoni.net` | Target API base URL           |
| `INTEGRATION_API_KEY` | — (suite skips without it)         | Integrator API key (`vsk_…`)  |

The key's organization must be an **integrator** with scopes `managed:write` +
`members:write` + `voting:write`, and quota for ≥5 processes / ≥10 on-chain
elections / ≥300 census size. The suite creates real on-chain elections and
casts 40 real votes, so expect it to take ~6 minutes. (The disposable stack
above provisions all of that for you — this only applies when pointing
`INTEGRATION_API_URL` at a shared environment.)

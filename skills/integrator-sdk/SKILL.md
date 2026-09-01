---
name: integrator-sdk
description: Use this skill whenever working with the Vocdoni Integrator SDK packages — @vocdoni/api-client, @vocdoni/api-voting, @vocdoni/react-providers, or @vocdoni/react-components. Triggers on imports from any of those packages, mentions of VocdoniApiClient, VotingClient, ProcessProvider, ElectionProvider, CSP auth flow, vote relay, encrypted ballots (secretUntilTheEnd), or any task like "cast a vote", "set up voting in React", "build the vote transaction", "poll a job". The SDK talks exclusively to the Vocdoni SaaS API — no direct blockchain access.
---

# Vocdoni Integrator SDK

A monorepo of TypeScript packages that replaces the `@vocdoni/sdk` with a SaaS-first approach. Everything goes through the Vocdoni SaaS API; the SDK never talks to the blockchain directly.

## Packages at a glance

| Package | What it does |
|---|---|
| `@vocdoni/api-types` | Shared TypeScript interfaces — no runtime code |
| `@vocdoni/api-client` | HTTP client wrapping the SaaS REST API ⚠️ surface in flux |
| `@vocdoni/api-voting` | CSP auth, vote envelope, ballot encryption, vote-tx signing |
| `@vocdoni/api-voting-zk` | ZK/anonymous voting — phase 2, not stable yet |
| `@vocdoni/react-providers` | Headless React context providers and hooks |
| `@vocdoni/react-components` | Unstyled React UI components built on react-providers |

## Common task → reference

| User wants to… | Read first | Recipe |
|---|---|---|
| Understand the HTTP client, sub-clients, jobs | `references/client.md` | — |
| Cast a vote (low-level, no React) | `references/voting.md` | `recipes/single-choice-vote.ts` |
| Cast a multi-choice or approval vote | `references/voting.md` | `recipes/multichoice-vote.ts` |
| Create, cast or tally a **ranked** question | `references/voting.md` (ranked section) | `recipes/multichoice-vote.ts` (Format C) |
| Cast a vote on an encrypted election | `references/voting.md` | `recipes/encrypted-vote.ts` |
| Set up the CSP auth flow manually | `references/client.md` + `references/voting.md` | `recipes/single-choice-vote.ts` |
| Add voting to a React app | `references/react.md` | — |
| Manage election lifecycle (pause/end/cancel) | `references/react.md` + `references/client.md` | — |
| ZK/anonymous voting | `references/zk-voting.md` | — |

## The vote flow in one minute

Every vote follows the same steps regardless of election type. The whole voter
flow is public or auth-token-identified — no bundle, no API key: the process
read (`GET /processes/{id}`, `client.elections.get`) is **public for published
processes** (drafts 404 to anyone but the org's managers), so the voter app
reads `chainId` and the questions directly:

```
1. GET  /processes/{id}                      → VotingProcessResponse: chainId (vote signatures
                                               are bound to it), questions[] with per-question
                                               ballotProtocol/encryptionKeys and live results
   GET  /processes/{id}/questions/{qId}      → public single-question read (same data, one question)
   GET  /processes/{id}/results              → public live per-question tallies (optional, for results view)
2. POST /processes/{id}/auth/0               → auth step 0 (identify the voter)
   POST /processes/{id}/auth/1               → auth step 1 (confirm 2FA — skip if auth-only census)
3. POST /processes/{id}/check                → belongsToProcess + per-question {questionId, upstreamId, canVote, hasVoted}
   [repeat steps 4–6 for each votable question]
4. POST /processes/{id}/sign                 → CSP signs voter's ephemeral address for question.upstreamId
   POST /processes/{id}/sign-batch           → same, all questions in one call (client.processes.signBatch — prefer it)
5. buildVoteTransaction(...)                 → build + sign the protobuf tx locally
6. POST /vote                                → relay tx → jobId
   GET  /jobs/{jobId}                        → poll until completed → voteID (nullifier)
```

Steps 1–4 are handled by `@vocdoni/api-client` (`client.elections.get` /
`getResults` for the public reads; `client.processes` — `ProcessesCspClient` —
for the CSP auth/check/sign routes).
Steps 5–6 are handled by `@vocdoni/api-voting` (`VotingClient` or `buildVoteTransaction` directly).
In React, `ElectionProvider` automates the whole flow — election data, the
voter's CSP auth session (`useElectionAuth`) and voting (`useElection`).
(There is no separate `ProcessProvider` — it was merged into `ElectionProvider`.)

There is no bundle flow anymore: the legacy `/process/bundle/*` routes were
removed from the backend along with `BundleClient` — everything is
process-scoped.

## Quick-start (vanilla TS)

```ts
import { VocdoniApiClient } from '@vocdoni/api-client'
import { EphemeralSigner, VotingClient } from '@vocdoni/api-voting'

const processId = '<process-mongo-id>'

const client = new VocdoniApiClient({ apiUrl: 'https://saas-api.vocdoni.net' })
const voting = new VotingClient({ client })

// 0. Public process read (published processes need no auth; drafts 404) — the
// chainId vote signatures are bound to comes from here.
const process = await client.elections.get(processId)
const chainId = process.chainId!

// 1. Auth (auth-only census — no 2FA step; else follow with authStep1)
const { authToken } = await client.processes.authStep0(processId, { memberNumber: '42' })

// 2. Check — per-question {questionId, upstreamId, canVote, hasVoted} in one call
const { belongsToProcess, questions } = await client.processes.check(processId, { authToken })
const q = questions.find((s) => s.canVote && !s.hasVoted)
if (!belongsToProcess || !q?.upstreamId) throw new Error('Cannot vote')

// 3. Display data — public single-question read (choices, ballotProtocol, encryptionKeys)
const question = await client.processes.getQuestion(processId, q.questionId)

// 4. CSP sign — electionId is the QUESTION's on-chain id (upstreamId)
const signer = new EphemeralSigner()
const { signature, weight } = await client.processes.sign(processId, {
  authToken, electionId: q.upstreamId, payload: signer.address,
})

// 5–6. Build tx, relay, poll for nullifier
const jobId = await voting.vote({
  processId: q.upstreamId, chainId, choices: [0],
  signer, cspSignature: signature, cspWeight: weight,
})
const job = await client.jobs.waitFor(jobId)
console.log('nullifier:', job.result?.voteID)
```

## Mental model

- **The voter's auth token is anchored to the process.** `client.processes` authenticates the voter directly against the voting process; one verified `authToken` covers check/sign for every question.
- **Reads are public, writes are authed, drafts are gated.** `client.elections` reads (`get`, `list`, `getResults`) work on a token-less client for **published** processes — a draft 404s (single read) or is filtered out (list) unless the caller is an org manager/admin or a scoped API key, and the PII `eligibleMemberIds` lists are stripped for non-managers. Everything that mutates (`create`, `publish`, `setStatus`, census writes) stays API-key/JWT authed. `client.processes` is the voter-side CSP surface (auth/check/sign/weight/getQuestion — token-identified).
- **`chainId` comes from the public process read.** Vote signatures are chain-id-bound; read the process's own `chainId` off `client.elections.get(processId)`. Do NOT use `client.info().chainId` — that is the service's *current* chain id, wrong for processes published before a chain migration.
- **Results are live and public.** Published questions carry a live `results` (`QuestionResults`: `voteCount`, `maxVoters`, `finalResults`, tally matrix) on the single reads and on `GET /processes/{id}/results` — `finalResults` distinguishes live from final, and a `secretUntilTheEnd` tally matrix stays empty until the keys are revealed. List items never resolve results (poll a single read instead).
- **One process, many questions.** `GET /processes/{id}` returns a `VotingProcessResponse` with a `questions[]` array. Each question is a separate on-chain Vochain election (`question.upstreamId` is its Vochain hex id — also reported publicly by the process check). Voting casts one Vochain transaction per question.
- **Process status is computed.** `computeProcessStatus(questions)` derives the top-level status from all question statuses. Any question `ONGOING` → `ONGOING`; all `ENDED`/`RESULTS` → `ENDED`. Statuses: `ONGOING`, `PAUSED`, `ENDED`, `CANCELED`, `UPCOMING`, `RESULTS`, `PROCESS_UNKNOWN`.
- **Ballot encoding is per-question.** Use `encodeQuestionSelections(question, answers)` from `@vocdoni/ballot` to produce each question's `number[]`, then pass `number[][]` to `vote()`. It is `encodeQuestionBallot` plus the one branch that differs per type — a ranked question's collected answer is the voter's *ordering*, everything else's already is its wire input — so reach for `encodeQuestionBallot` only when you already hold wire values.
- **A ranked question must declare itself; nothing else can tell.** A ranked `ballotProtocol` (`maxCount = numOptions`, `maxValue = numOptions - 1`, `uniqueValues: true`) is byte-identical to a pick-slot multichoice whose voters fill every slot, and the two are transposes — ranked reads the field index as the *option* and its value as the *rank*; pick-slot reads it as a *slot* holding a chosen option. Create one with `metadata: { type: { name: 'ranked' } }` alongside the raw protocol (the backend's `type` vocabulary is `singlechoice`/`multichoice` only, and it stores/echoes the metadata bag verbatim). Without it the question decodes as a multichoice and reports the same number for every option — integrator-sdk#22. Then: ranks go on the wire **highest = best** — pass the voter's ordering (best first) to `encodeQuestionSelections(question, order)`, which transposes it and encodes in one step; `rankedOrderToScores` does the transposition alone. A ranking must be complete, every choice needs a distinct `value`, `maxValue` must not be 0, and an election-level `ranked` declaration must have exactly one question — all four are refused at creation *and* at encode time. `decodeQuestionResults` aggregates **Borda** (`Σ count × rank`, so `votes` is points, not people) and emits **no abstain bucket**, and `react-components` renders a rank widget requiring a complete ranking. `declaresRanked(question)` reports whether a question carries the declaration.
- **Never set `uniqueChoices` / `uniqueValues` on a *named* `multichoice` question (the dense layout).** The named `multichoice` type derives the **dense** layout (one 0/1 field per choice), and the scrutinizer applies uniqueness to raw field values — so a dense ballot over more than two choices always repeats a value and is discarded at tally. The election then accepts votes and reports an all-zero result while `voteCount` keeps rising. `client.elections.create/update` rejects `typeSetup.uniqueChoices` on multichoice — as the API itself now does — and rejects an unsatisfiable `ballotProtocol`; `encodeQuestionBallot` refuses to encode for such a question, and also refuses a *ballot* the chain would drop (a value above `maxValue`, a repeated value under `uniqueValues` — e.g. duplicate ranks). Detect an already-created broken one with `unsatisfiableQuestionReason(question)` from `@vocdoni/ballot`. (A raw `ballotProtocol` pick-slot multichoice legitimately carries `uniqueValues: true` — that is the index-list layout, distinct from dense.)
- **A raw `ballotProtocol` must reach every published `choice.value`.** Single-choice is *value*-addressed: the ballot field and the results column are both `choice.value`, and `maxValue` is derived from the highest value (values may be sparse — unused columns just stay empty). A value above `maxValue` (or two choices sharing one value) makes that option uncastable; on a pick-slot multichoice, values that are not exactly `0..numChoices-1` collide with the abstain sentinels instead. Either way the chain accepts the ballot, counts it in `voteCount` and drops it at tally, so the option polls zero while the vote looks cast. `client.elections.create/update` refuses such a question outright — the only moment it is still fixable. At encode time `encodeQuestionBallot` / `validateSelections` refuse only the voter picking an out-of-range value (the in-range votes are recorded correctly, so refusing everyone would discard good ballots), but refuse **every** voter on a pick-slot sentinel collision, which no per-ballot check can detect. Check a question you did not create with `uncastableChoicesReason(question)` / `hasUncastableChoices(question)`. Position-addressed layouts (approval, dense multichoice, budget, quadratic) are unaffected — there `choice.value` is only a label.
- **The vote tx is signed by an ephemeral key, not the voter's wallet.** `EphemeralSigner` generates a fresh secp256k1 keypair per vote; the CSP signs its Ethereum address. This decouples the voter's identity from the on-chain signature.
- **Relaying is async.** `elections.vote()` returns a `jobId`. Poll `jobs.waitFor(jobId)` to get the vote nullifier (`voteID`). The `VotingClient.vote()` method returns the jobId; the React `useElection().vote()` awaits the full job for each question.
- **One nullifier per question, not per process.** A voter who answered N questions holds N vote ids. Read them all from `useElection().voteIds` (`Record<questionId, string>`) — the older single `voteId` is deprecated and only ever shows one. Server-side, `processes.signInfo(id, { authToken })` returns the same set as `consumed[]`.

## A note on api-client stability

`@vocdoni/api-client` is actively evolving. Always read `references/client.md` for the current class/method names rather than recalling from training data.

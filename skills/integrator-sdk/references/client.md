# Reference: @vocdoni/api-client

> ⚠️ **API surface in flux.** Sub-client method names and signatures are actively evolving. Always verify against the current source (`packages/api-client/src/`) rather than recalling from memory.

The typed HTTP client for the Vocdoni SaaS API. Wraps every SaaS endpoint; never talks to the blockchain directly.

```bash
pnpm add @vocdoni/api-client
```

---

## VocdoniApiClient

```ts
import { VocdoniApiClient } from '@vocdoni/api-client'

const client = new VocdoniApiClient({
  apiUrl: 'https://saas-api.vocdoni.net',
  // Optional — string or sync/async getter; resolved and attached as Bearer on every request
  authToken: () => myStore.getToken(),
})
```

`ApiClientConfig`:

| Field | Type | Notes |
|---|---|---|
| `apiUrl` | `string` | Base URL of the SaaS API |
| `authToken` | `string \| (() => string \| null)` \| async version | Optional; omit for public (voter) flows |

Sub-clients accessed as properties:

```ts
client.elections    // ElectionsClient — /processes: public reads (get/list/getResults), authed writes
client.processes    // ProcessesCspClient — VOTER CSP surface of /processes (auth, check, sign)
client.organizations // OrganizationsClient
client.census       // CensusClient
client.auth         // AuthClient
client.jobs         // JobsClient
```

Plus one method on the client itself: `client.info()` (`GET /info`, public) →
`{ chainId, version, goVersion }`. Careful: that `chainId` is the service's
CURRENT Vochain chain id, not necessarily the one a given process's votes sign
against — always prefer the process's own `chainId` from the (public)
`elections.get()` read.

---

## ProcessesCspClient (`client.processes`)

The voter-facing CSP / two-factor auth flow, anchored directly to a voting
process. All routes are public: the voter is identified by the CSP
`authToken`, never by an API key.

Ids to keep straight: `processId` is the process's **Mongo id** (what
`elections.get` takes), and `electionId` in
`sign()` is the **question's** on-chain Vochain id (`question.upstreamId`).

Note the full process read (`client.elections.get`) is **public** for
published processes (saas-backend#599; drafts 404 to non-managers, and
`eligibleMemberIds` is stripped) — the voter app reads `chainId` and the
questions from it directly, then uses the CSP routes below.

```ts
// Public single-question read — no API key. Includes choices, ballotProtocol,
// census auth config and (for secretUntilTheEnd questions) encryptionKeys.
const question = await client.processes.getQuestion(processId, questionId)
// question.encryptionKeys — ABSENT until the keykeepers publish the keys;
//                           poll until present before building an encrypted ballot

// Auth step 0 — identify the voter.
// Pass all fields the census requires (see question.census.authFields)
const res0 = await client.processes.authStep0(processId, {
  memberNumber: '42',      // or: name, surname, birthDate, nationalId, email, phone
})
// res0.authToken — verified immediately if question.census.twoFaFields is empty (auth-only)
//               — pending verification otherwise (proceed to step 1)

// Auth step 1 — confirm the 2FA OTP (skip for auth-only censuses)
const res1 = await client.processes.authStep1(processId, {
  authToken: res0.authToken!,
  authData: ['123456'],    // OTP as first element
})

// Resend challenge
await client.processes.resend(processId, { authToken, email: 'voter@example.com' })

// Voter status — census membership, weight and PER-QUESTION eligibility in one
// call. Ineligibility is belongsToProcess=false with HTTP 200, not an error.
const { belongsToProcess, questions, weight } = await client.processes.check(processId, { authToken })
// questions[i] — { questionId, upstreamId, canVote, hasVoted }

// Get CSP signature over an ephemeral voter address, per question.
// A question's signing slot is consumed on success — it cannot be signed twice.
const { signature, weight } = await client.processes.sign(processId, {
  authToken,
  electionId: question.upstreamId!, // the QUESTION's vochain id, NOT the processId
  payload: signer.address,          // hex Ethereum address from EphemeralSigner
})

// Same, but every question in ONE call. Per-question failures are reported
// inline with a stable `code` — the batch only rejects on a bad auth token.
const { signatures } = await client.processes.signBatch(processId, {
  authToken,
  ballots: [{ upstreamId: question.upstreamId!, address: signer.address }],
})
// signatures[i] — { upstreamId, signature?, weight?, code?, error? }
// ⚠️ Match by `upstreamId`, do not zip: a dropped entry would silently shift
//    every signature onto the wrong question.

// Voter's census weight
const { weight } = await client.processes.weight(processId, { authToken })

// Consumed sign info — per-question address/nullifier/timestamp for the
// questions the voter already cast (others omitted)
const { consumed } = await client.processes.signInfo(processId, { authToken })
// ⚠️ `address` and `nullifier` are OPTIONAL — an anonymous census reports
//    neither, because the CSP blind-signs and never learns the address.
```

### Anonymous census: blind signing

When `process.census.anonymous` is `true`, `sign`/`signBatch` are replaced by
two rounds. Prefer `signBlindCspBallots()` from `@vocdoni/api-voting`, which
wraps both plus the client-side blinding — call these directly only for a
custom flow.

```ts
// Round 1 — one blind point per election. Atomic and idempotent: a repeat
// returns the same tokenR, so retrying the flow is safe.
const { points } = await client.processes.blindPoint(processId, {
  authToken,
  electionIds: [question.upstreamId!],
})
// points[i] — { upstreamId, tokenR?, weight?, code?, error? }
//   tokenR — 33 bytes: X big-endian (32) then an oddness byte. NOT SEC1.
//   weight — pinned here and hashed into the signing key's salt; carry it verbatim.

// Round 2 — the CSP signs bytes it cannot read.
const { signatures } = await client.processes.blindSign(processId, {
  authToken,
  ballots: [{ upstreamId: question.upstreamId!, blindedMessage }],
})
// Same result shape as signBatch. A failed round 2 does not consume the
// election's one-time nonce; `already_consumed` is terminal.
```

`SignFailureCode` (shared by `signBatch` and `blindSign`): `already_consumed`,
`already_signing`, `auth_invalid`, `address_mismatch`, `sign_failed`,
`blind_request_missing`, `invalid_blinded_message`.

(The backend also exposes `GET /processes/{id}/participants/{participantId}`,
but it is a documented placeholder that always returns `null`, so the SDK does
not wrap it — voters check their own status via `check()`/`signInfo()`.)

**Census type detection** — check `census.twoFaFields` (on the public question
read's `question.census`, or on the integrator backend's process read):
- Empty or absent → auth-only census; step 0 returns a verified token, skip step 1.
- Non-empty → 2FA census; step 0 returns a pending token, confirm with step 1.

---

## ElectionsClient (`client.elections`)

Reads (`get`, `list`, `getResults`) are **public** for published processes
(saas-backend#599): drafts 404 on `get` and are filtered from `list` unless the
caller is an org manager/admin or a scoped API key, and the PII
`eligibleMemberIds` lists are stripped for non-managers. Writes (create,
publish, status, census) require the API key / JWT.

```ts
// Fetch a process by Mongo id — per-question vochain data lives on questions[]
const election = await client.elections.get(mongoId)
// election.id              — Mongo id (admin endpoints)
// election.orgAddress      — owner org address, UNPREFIXED lowercase hex.
//                            Other endpoints (auth/addresses, organizations/{address})
//                            return the same value 0x-prefixed — normalize before comparing.
// election.title           — MultiLangString ({ default, [lang]: string })
// election.census          — CensusSpec ({ weighted, authFields, twoFaFields, size?,
//                            totalWeight?, anonymous?, ... })
//   census.anonymous       — set at create time; the CSP then BLIND-signs, so it cannot
//                            link voter → vote. Round-trips on read, and is the only
//                            switch the voter side needs (see "Anonymous census" above).
//   census.size            — member count (response-only; omitted when 0). There is
//                            deliberately NO census type/uri/id over this API: the census
//                            "type" is inferred from authFields/twoFaFields (every
//                            new-model census is CSP-backed).
//   census.totalWeight     — whole-census total voting weight (response-only; equals
//                            size for a non-weighted census — use it for percentages)
// election.questions       — VotingProcessQuestion[]
//   question.upstreamId        — vochain hex id (voting; the `electionId` of CSP check/sign)
//   question.ballotProtocol    — { maxCount, maxValue, uniqueValues, ... }
//   question.secretUntilTheEnd — boolean
//   question.status            — QuestionStatus
//   question.encryptionKeys    — vote-encryption public keys (secretUntilTheEnd only;
//                                absent until the keykeepers publish — poll)
//   question.results           — live QuestionResults ({ voteCount, maxVoters,
//                                finalResults, results?: string[][] }) — single reads
//                                only; a secret question's matrix stays empty until
//                                the keys are revealed
// election.chainId         — vochain chain id votes are signed against (omitempty).

// List processes
const { processes, pagination } = await client.elections.list({ orgAddress, page, limit, status })
// List items never resolve question.results (N+1 guard) — use get()/getResults().
// Drafts filter (saas-backend#607): published: true → published only;
// published: false → drafts only (Manager/Admin REQUIRED, 401 otherwise);
// omitted → caller's default view (anonymous: published only; manager: all).
// Don't combine published: false with status — drafts have no on-chain
// question status yet, so that combination returns nothing.

// Get per-question results — public, LIVE tallies (finalResults marks live vs final)
const { questions } = await client.elections.getResults(mongoId)
// questions[i] — { questionId, upstreamId, voteCount, maxVoters, finalResults,
//                 results?: string[][] (raw histogram; see ballot protocol) }

// Admin: create a draft process → returns the draft id (Mongo hex string).
// Text fields (title/description, question & choice titles) may be a plain
// string or a { default, <lang> } language map — plain strings are normalized
// to { default } for you. Each question carries its own type/ballotProtocol.
const draftId = await client.elections.create({
  orgAddress,
  title: 'My election',
  // endDate is required; omit startDate to start immediately on publish.
  endDate: new Date(Date.now() + 2 * 3_600_000).toISOString(),
  questions: [
    {
      title: 'Approve?',
      // Lowercase only: 'singlechoice' | 'multichoice'. camelCase is rejected
      // (40037 unsupported type). Alternatively pass a raw ballotProtocol
      // (which wins when both are given); omitting both is an error.
      // 'multichoice' requires typeSetup ({ maxChoices, minChoices, uniqueChoices });
      // 'singlechoice' ignores typeSetup.
      // ⚠️ typeSetup.uniqueChoices MUST be false on 'multichoice' — the derived
      // dense 0/1 layout makes it unsatisfiable and the chain would discard
      // every ballot at tally. create/update reject it, as the API does, and
      // throw on a raw ballotProtocol whose uniqueValues cannot be satisfied.
      // A ranked ballot uses a ballotProtocol instead. See references/voting.md.
      type: 'singlechoice',
      choices: [{ title: 'No', value: 0 }, { title: 'Yes', value: 1 }],
    },
  ],
})

// Admin: publish the draft on-chain. Async — returns { jobId } to poll (or
// { address, status } if already published). publishAndWait does the polling.
const published = await client.elections.publishAndWait(draftId)
// published.address — on-chain address from the publish job. The per-question
// vochain ids appear as questions[i].upstreamId on the next get(draftId).

// Admin: lifecycle — per-QUESTION status changes (the new model has no
// process-level status route). Async: each returns { jobId } to poll.
const { jobId: sjob } = await client.elections.bulkSetQuestionStatus(mongoId, {
  status: 'paused', // 'ready' | 'paused' | 'ended' | 'canceled'
  questions: process.questions.map((q) => ({ id: q.id })), // omit → all published questions
})
await client.jobs.waitFor(sjob)
// Single question: setQuestionStatus(processId, questionId, status).

// Admin: look up census members by credential, with per-question voted status.
// field is limited to 'email' | 'phone' | 'memberNumber' | 'nationalId'.
const { participants } = await client.elections.participants(mongoId, {
  field: 'memberNumber',
  value: '42',
})
// participants[i] — { memberId, name?, surname?, email?, memberNumber?,
//                     questions: [{ questionId, upstreamId?, hasVoted }] }

// Admin: append org members to a PUBLISHED process's census (append-only;
// drafts 409 — edit those via update()). jobId tracks the async on-chain
// maxCensusSize bump when one is needed.
const { added, jobId } = await client.elections.addCensusMembers(mongoId, ['m-1', 'm-2'])
if (jobId) await client.jobs.waitFor(jobId)

// Admin: publish-readiness dry-run (GET /processes/{id}/validation).
const { valid, errors } = await client.elections.validate(mongoId)

// Admin: validate a census spec before wiring it to a process
// (POST /processes/census/validation; resolves an OK string, 400s with detail).
await client.elections.validateCensus({ orgAddress, census: { authFields: ['memberNumber'] } })

// Drafts: update(id, draft) PUTs the same shape as create and resolves void
// (re-get() for the stored shape; 409 once published). delete(id) removes it.
// signInfo(id, { authToken }) → { consumed: [{ questionId, nullifier, … }] },
// one entry per question the voter already cast.
// Legacy-only (single-election model, vochain ids): setStatus()/setStatusAndWait()
// (PUT /process/{id}/status) and getMetadata() — do not use with mongo process ids.

// Relay a vote (called internally by VotingClient — you rarely call this directly)
const { jobId } = await client.elections.vote({ txPayload })

// Relay a BATCH of signed votes in one call (POST /votes, saas-backend#610;
// used internally by ElectionProvider.vote()). At most 100; the backend
// validates the batch synchronously and accepts or rejects it AS A UNIT, so a
// rejection relays nothing — this closes the half-voted window of relaying a
// multi-question process envelope by envelope. One job covers the batch.
const { jobId } = await client.elections.voteBatch({ votes: [{ txPayload }, ...] })
```

---

## CensusClient (`client.census`) & OrganizationsClient (`client.organizations`)

The organizer-side surface used to set up an election before anyone votes. Only
relevant for admin/integrator flows (an API key with `managed:write` +
`members:write`); voter apps never touch these.

```ts
// Census: create an org-level CSP census, then publish it from a member group.
const { id: censusId } = await client.census.create({ orgAddress, authFields: ['memberNumber'] })
await client.census.publishGroup(censusId, groupId, { authFields: ['memberNumber'], weighted: false })

// Organizations: managed orgs, members, groups, and reads.
const org = await client.organizations.createManaged({ name: 'Acme', type: 'company', website })
const { jobId } = await client.organizations.addMembers(org.address, members, { async: true })
if (jobId) await client.jobs.waitFor(jobId) // progress in job.result.added/total/progress
const { groups } = await client.organizations.listGroups(org.address)         // auto "All members" group

// Integrator quota/usage (also callable with a scoped API key, scope quota:read).
const { enabled, limits, usage } = await client.organizations.getIntegratorInfo()
// limits — { maxManagedOrgs, maxManagedProcesses, maxVotes, maxSMS, maxEmails } (0 = unlimited;
//           omitted entirely when enabled is false)
// usage  — { managedOrgs, managedProcesses, sentVotes, sentSMS, sentEmails }

// API keys (integrator-only, /integrator/organizations/{addr}/apikeys routes):
const key = await client.organizations.createApiKey(org.address, {
  label: 'ci', scopes: ['quota:read', 'managed:write'],
})
// key.secret — the vsk_-prefixed plaintext, returned ONCE and never retrievable again
// listApiKeys(addr) returns metadata only; revokeApiKey(addr, keyId) disables permanently.
```

`OrganizationsClient` also covers groups CRUD, meta, subscription, and
list-reads (censuses/drafts). See `packages/api-client/src/{census,organizations}.ts`
for the full set — the live `integration/full-flow.itest.ts` drives the whole flow end to end.

---

## JobsClient (`client.jobs`)

Async outcomes, unified: vote relays, publishes, status changes AND member/census
imports all return a `jobId` polled here (the old
`organizations.listJobs`/`getMembersJob`/`waitForMembersJob` methods and their
`/organizations/{addr}/…` routes are gone).

```ts
// One-shot status check
const job = await client.jobs.get(jobId)
// job.status  — 'pending' | 'completed' | 'failed'
// job.type    — 'relay_vote' | 'relay_votes' | 'publish_process' | 'set_process_status'
//               | 'set_process_census' | 'org_members' | 'census_participants'
//               | 'publish_voting_process'
// job.result?.voteID — vote nullifier (relay_vote jobs)
// job.result?.nullifier/processId — seeded at creation on relay jobs: readable while PENDING
// job.result?.votes — relay_votes only: per-envelope outcomes in request order, each
//   { processId, nullifier, status, voteID?, error? }. The job completes only when EVERY
//   envelope landed and fails otherwise — a failed job still carries the array.
// job.result?.added/total/progress — import counters (org_members / census_participants jobs)
// job.errors — error detail lines (e.g. "line 3: invalid email" on imports)

// Poll until terminal state
const job = await client.jobs.waitFor(jobId, {
  intervalMs: 1000,        // default 1000
  timeoutMs: 60000,        // default 60000
  signal,                  // optional AbortSignal
  expectType: 'relay_vote', // optional: throw if the completed job.type differs
  onPoll: (j) => {},       // optional: observe every polled state (e.g. relay_votes
                           //   entries settling one by one while the job is pending)
})
// throws JobFailedError if job.status === 'failed'
// throws Error on timeout, or on job.type mismatch when expectType is set

// Admin: paginated org job history (GET /jobs — orgAddress is required)
const { jobs, pagination } = await client.jobs.list({
  orgAddress, type: 'org_members', page: 1, limit: 10,
})
```

`JobFailedError` carries the full `JobStatusResponse` on `error.job`; its message
joins `job.errors` when present.

---

## AuthClient (`client.auth`)

The **normal SaaS user** auth flow: a signed-up user logs in with email/password
to get a JWT, then drives the SDK under their own organization (create processes,
etc.). This is distinct from the **integrator** flow (a `vsk_…` API key passed as
the client's `authToken`, used to manage orgs), and from the **voter** CSP flow
(`ProcessesCspClient`).

```ts
const session = await client.auth.login('user@example.com', 'secret')
// session.token   — JWT; feed it back as the client's Bearer to authenticate calls:
//                   new VocdoniApiClient({ apiUrl, authToken: () => session.token })
// session.expirity — expiry timestamp (the API's field spelling)

// Re-issue using the current token (no refresh token exists — the client must
// already be sending the JWT as Bearer).
const refreshed = await client.auth.refresh()

// Organizations the logged-in user belongs to:
const { addresses } = await client.auth.addresses()
```

---

## Key types from @vocdoni/api-types

```ts
import type { VotingProcessResponse, VotingProcessQuestion, BallotProtocol } from '@vocdoni/api-types'

// Discriminated union on `published`: drafts may lack both dates; published
// processes always carry endDate (startDate backfill merged in saas-backend#586;
// processes published before it may still lack startDate). Narrow before reading dates.
type VotingProcessResponse = DraftVotingProcessResponse | PublishedVotingProcessResponse

interface VotingProcessBase {
  id: string                          // Mongo ObjectID (admin endpoints, getResults) — never 0x-hex
  orgAddress: string                  // owner org address, UNPREFIXED lowercase hex (other
                                      // endpoints return it 0x-prefixed — normalize to compare)
  title: MultiLangString              // { default, [lang]: string }
  description?: MultiLangString
  census: CensusSpec                  // { weighted?, authFields?, twoFaFields?, ... }
  questions: VotingProcessQuestion[]
}
interface DraftVotingProcessResponse extends VotingProcessBase {
  published: false
  startDate?: string
  endDate?: string
}
interface PublishedVotingProcessResponse extends VotingProcessBase {
  published: true
  startDate: string
  endDate: string
}

interface VotingProcessQuestion {
  id: string
  upstreamId?: string                 // on-chain vochain hex id (voting; `electionId` of CSP check/sign)
  title: MultiLangString
  choices: Choice[]                   // { title, value, meta? } — see "Extended choice info" below
  ballotProtocol: BallotProtocol
  type: string                        // 'singlechoice' | 'multichoice' when created with a named
                                      // type; empty for raw-ballotProtocol questions
  typeSetup?: QuestionTypeSetup       // { minChoices, maxChoices, uniqueChoices }
  secretUntilTheEnd: boolean
  status: QuestionStatus              // 'UPCOMING' | 'ONGOING' | 'ENDED' | 'CANCELED' | 'PAUSED' | 'RESULTS' | 'PROCESS_UNKNOWN'
                                      // wire may say 'READY' for live; the client normalizes it to 'ONGOING' on read
  metadata?: Record<string, unknown>  // free-form creator bag; its `choices` key is SDK-recognized
  encryptionKeys?: EncryptionKey[]    // secretUntilTheEnd only; ABSENT until keykeepers publish — poll
  results?: QuestionResults           // live tally — single reads only (never on list items)
}

// Live per-question tally (single reads + getResults; finalResults marks live vs final)
interface QuestionResults {
  voteCount?: number
  maxVoters?: number                  // on-chain maxCensusSize
  finalResults?: boolean
  results?: string[][]                // raw histogram; absent until a tally exists (secret
                                      // questions stay empty until key reveal)
}

// Voter status for a process (client.processes.check)
interface ProcessCheckResponse {
  belongsToProcess: boolean
  questions: ProcessQuestionStatus[]  // { questionId, upstreamId?, canVote, hasVoted }
  weight?: string                     // hex census weight
}

interface BallotProtocol {
  maxCount: number          // ballot length (number of fields)
  maxValue: number          // max value per field
  uniqueValues: boolean     // values must be unique (ranked voting)
  maxTotalCost: number
  maxVoteOverwrites: number
  costExponent: number
  costFromWeight: boolean
}

interface CensusInfo {
  type?: string
  authFields?: string[]       // fields required at auth step 0
  twoFaFields?: string[]      // empty/absent → auth-only (no 2FA)
}
```

---

## Extended choice info (image + description)

A choice can carry an illustrative image and a longer description. The API has
nowhere to store this on a choice (`db.Choice` is `{Title, Value}`), so it lives
on the **parent question**, in its free-form `metadata` bag under `choices`,
keyed by choice `value`:

```ts
// What you WRITE (create/update): on the question, not the choice
{
  title: { default: 'How do you eat it?' },
  choices: [{ title: { default: 'With skin' }, value: 0 }, …],
  type: 'singlechoice',
  metadata: {
    choices: [
      { value: 0, description: 'Unpeeled', image: 'https://cdn.example/a.jpeg' },
      { value: 1, image: { default: 'https://…/full.jpg', thumbnail: 'https://…/t.jpg' } },
    ],
  },
}
```

On **read**, every question-bearing endpoint — `elections.get`,
`elections.list`, `elections.getQuestion` and the voter-side
`processes.getQuestion` — folds those entries onto the matching choice as
`choice.meta`, so components read it straight off the choice:

```ts
interface ChoiceMeta {
  description?: string
  image?: { default?: string; thumbnail?: string }
  [key: string]: unknown   // creator-defined keys ride along untouched
}

interface Choice {
  title: LocalizedInput
  value: number
  meta?: ChoiceMeta   // response-only, client-derived — writing it here is ignored
}
```

Rules:

- `image` is tolerated in both stored shapes — a plain URL string is normalized
  to `{ default: url }`, an object is passed through.
- `description` and `image` are the recognized keys and get validated (an
  unusable one is dropped). **Any other key on the entry is carried over
  verbatim**, so a custom `QuestionChoice` slot can read it off `choice.meta`.
  The `value` join key is the one thing stripped — it identifies the choice, it
  is not part of its meta.
- An entry carrying only creator-defined keys still produces a `choice.meta`;
  it just does not count as "extended" for presentation purposes.
- Entries whose `value` matches no choice are ignored; a question with no
  `metadata.choices` leaves every `choice.meta` undefined (and so renders the
  basic, non-extended presentation in `@vocdoni/react-components`).
- `ipfs://` URLs are stored as-is and resolved to a gateway URL by the display
  layer, not by the client. Empty and whitespace-only strings are likewise
  dropped by the display layer, not the client — `choice.meta` holds what was
  stored.
- The mapping is exported as `normalizeQuestionChoiceMeta(question)` for anyone
  normalizing raw wire data by hand (it also runs inside `normalizeVotingProcess`).

---

## Cross-references

- [[integrator-sdk]] — vote flow overview
- [[voting]] — `buildVoteTransaction`, `VotingClient`, choices format
- [[react]] — `ClientProvider` wraps `VocdoniApiClient` for React apps

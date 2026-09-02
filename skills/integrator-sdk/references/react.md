# Reference: @vocdoni/react-providers + @vocdoni/react-components

Two packages that work together. `react-providers` is the headless logic layer (context + hooks); `react-components` is the unstyled UI layer built on top of it.

The voter flow is process-scoped and lives in ONE provider: `ElectionProvider`
fetches the voting process, drives the per-question vote AND holds the voter's
CSP auth session (`client.processes`). `useElection()` exposes everything;
`useElectionAuth()` exposes just the session (for auth-only widgets that
shouldn't re-render on data/results updates). Query keys are exported as
`electionQueryKeys` for cache pre-seeding/invalidation.

```bash
pnpm add @vocdoni/react-providers @vocdoni/react-components
# peer deps:
pnpm add react @tanstack/react-query
```

---

## Provider tree

Providers must be nested in this order. Inner providers consume context from outer ones.

```tsx
<ClientProvider apiUrl="..." authToken={...}>
  <AuthProvider storageKey="vocdoni-auth">   {/* optional — for admin flows */}
    <OrganizationProvider id={orgAddress}>   {/* optional — for org management */}
      <ElectionProvider id={processMongoId}> {/* data + auth session + voting */}
        <ActionsProvider>                    {/* optional — pause/end/cancel */}
          <YourVotingUI />
        </ActionsProvider>
      </ElectionProvider>
    </OrganizationProvider>
  </AuthProvider>
</ClientProvider>
```

For read-only views (results, status) just render `ElectionProvider` and never call the auth methods — nothing else is required.

---

## ClientProvider / useClient

Creates and owns the `VocdoniApiClient` instance. All other providers consume it.

```tsx
import { ClientProvider, useClient } from '@vocdoni/react-providers'

// Setup
<ClientProvider
  apiUrl="https://saas-api.vocdoni.net"
  authToken={() => myStore.getJwt()}  // optional; re-evaluated per request
>
  ...
</ClientProvider>

// Inside any child
const { client, apiUrl } = useClient()
// client — VocdoniApiClient (fully typed, all sub-clients available)
```

---

## AuthProvider / useAuth

Normal-SaaS-user session management — a signed-up user logging in with
email/password to drive the SDK under their own organization. Not the integrator
API-key flow, and not the voter CSP flow (that's `ElectionProvider`'s session,
read via `useElectionAuth`). Persists the JWT to `localStorage` when
`storageKey` is provided.

```tsx
import { AuthProvider, useAuth } from '@vocdoni/react-providers'

<AuthProvider storageKey="vocdoni-auth">...</AuthProvider>

const { token, isAuthenticated, login, logout, refresh } = useAuth()

await login('user@example.com', 'secret')  // email + password → JWT
logout()
await refresh()                            // re-issues the JWT using the current token
```

For authenticated calls to actually carry the JWT, wire the same token into
`ClientProvider` (e.g. `authToken={() => readTokenFromStorage()}`) so the client
sends it as Bearer.

---

## ElectionProvider / useElection

Fetches the voting process and exposes its data, results, the full vote flow AND the voter's CSP auth session. The process read is PUBLIC for published processes (drafts 404), so no API key is involved anywhere in the voter path.

```tsx
import { ElectionProvider, useElection } from '@vocdoni/react-providers'

<ElectionProvider id="<processMongoId>">...</ElectionProvider>

// Or with prefetched data (e.g. from SSR or a list view). Rendered instantly —
// no loading state — and seeded into the react-query cache as initialData, so
// the provider still refetches when the data goes stale. `id` is optional here
// (derived from election.id); at least one of the two props is required.
<ElectionProvider election={prefetchedProcess}>...</ElectionProvider>

// Tune the underlying react-query reads: `queryOptions` (election read) and
// `resultsQueryOptions` (results read). queryKey/queryFn/enabled/initialData
// are provider-owned.
<ElectionProvider
  id="<processMongoId>"
  queryOptions={{ refetchInterval: 30_000 }}        // poll for status changes
  resultsQueryOptions={{ refetchInterval: 10_000 }} // live tallies
>...</ElectionProvider>

const {
  // data
  election,      // VotingProcessResponse | null — full process with questions[]
  status,        // QuestionStatus | null — derived from all question statuses
  chainId,       // string | null — Vochain chain id votes are signed against
  results,       // VotingProcessResultsResponse | null — per-question results
  loading,       // boolean
  error,         // Error | null
  // voter auth session (also available standalone via useElectionAuth())
  authToken,     // string | null — verified CSP token; null until authenticated
  connected,     // boolean — true once the voter holds a verified authToken
  weight,        // number | null — census weight (decoded from hex)
  auth0,         // (participant: AuthRequest) => Promise<void>
  auth1,         // (solution: string | string[]) => Promise<void> — confirm 2FA OTP
  resend,        // ({ email?, phone? }) => Promise<void>
  check,         // () => Promise<ProcessCheckResponse> — per-question canVote/hasVoted
  sign,          // (electionId, address) => Promise<ElectionSignResult> — electionId = question.upstreamId
                 //   throws on an anonymous census: that proof would be rooted at the
                 //   wrong key, and asking would spend the one-shot authorization
  signBatch,     // (ballots: ElectionSignBatchBallot[]) => Promise<ElectionSignBatchResult[]>
                 //   ballot = {electionId, address}. All questions in ONE call — what vote()
                 //   uses; picks the plain (POST /sign-batch) or blind CSP flow itself from
                 //   census.anonymous. Results are in request order, one per ballot, with
                 //   per-question failures reported inline ({code, error}) rather than thrown.
  // voting
  isInCensus,    // boolean — true if voter belongs to this process's census
  voterQuestions,// ProcessQuestionStatus[] — per-question canVote/hasVoted (empty until connected)
  hasVoted,      // boolean — true once EVERY question is voted (or right after vote())
  isAbleToVote,  // boolean — connected && isInCensus && !hasVoted
  vote,          // (encodedBallots: number[][]) => Promise<string> — per-question ballots
  voting,        // boolean — true while vote() is in flight (success OR error settles it)
  voteStatus,    // Record<questionId, 'signing'|'submitting'|'confirming'|'confirmed'|'failed'>
                 //   per-question progress of the current/last vote() call (already-voted → 'confirmed')
  voteIds,       // Record<questionId, string> — EVERY vote id (nullifier) the voter holds
  voteId,        // string | null — DEPRECATED: only ever one of them; read voteIds
  clearVoter,    // () => void — clears the auth session and vote state
} = useElection()
```

**One vote id per question.** Votes are relayed per question, so a voter who
answered 5 questions holds 5 nullifiers. `voteIds` carries all of them keyed by
question id; the legacy `voteId` exposes just the first and is deprecated.
`voteIds` is filled from three places:

- the outcomes of a successful `vote()`;
- the questions that **did** land when `vote()` throws `PartialVoteError` — a
  partial cast never loses the ids it produced;
- on connect, `POST /processes/{id}/sign-info` (only when the check reports
  something voted), so a voter returning after a reload still sees every id.
  A failure there is swallowed: membership stays resolved, `voteIds` stays empty.

**Exception — anonymous census.** A process whose `census.anonymous` is `true`
returns no nullifiers from `sign-info`, because the CSP blind-signs and never
learns the address. There is nothing to recover after a reload there: `voteIds`
holds only what the current session's `vote()` produced. `hasVoted` and
`voterQuestions` still work — those come from `check()`.

```tsx
const { election, voteIds } = useElection()
election.questions
  .filter((q) => voteIds[q.id])
  .map((q) => `${q.title.default}: ${voteIds[q.id]}`)
```

### Voter authentication

**Auth-only census** (no 2FA): `election?.census?.twoFaFields` is empty/absent. `auth0()` sets `connected = true` immediately; skip `auth1`.

**2FA census**: `auth0()` sends the challenge; call `auth1(otp)` to confirm. `connected` becomes `true` after `auth1`.

```tsx
// Auth-only flow
await auth0({ memberNumber: '42' })
// connected === true

// 2FA flow
await auth0({ email: 'voter@example.com' })
// Show OTP input...
await auth1('123456')
// connected === true
```

`useElectionAuth()` returns just the session slice (`authToken`, `connected`, `weight`, `auth0`, `auth1`, `resend`, `check`, `sign`, `signBatch`, `clear`) from its own context — auth-only widgets (identify forms, OTP inputs, logout buttons) using it don't re-render when election data or results update. Its `clear()` is equivalent to `clearVoter()`: clearing the session also resets the vote state.

`vote(encodedBallots, memos?)` takes one pre-encoded `number[]` per question (plus optional per-question memo strings — free-text notes like an open "Other" answer, max 256 UTF-8 bytes each, validated pre-flight; ⚠️ memos ride the envelope in cleartext even for secret questions), casts a separate Vochain vote for each, and returns the first nullifier cast by the call. In `react-components`, registering reserved `memo.{index}` fields (`memo.0`, `memo.1`, …) in the questions form collects memos automatically.

Casting is **phased** so a failure can never half-vote silently:

1. **Pre-flight** — every question is validated up front (`upstreamId` present; `secretUntilTheEnd` questions have published `encryptionKeys` — never casts cleartext; at most 100 questions, the batch relay cap). Any problem throws before anything is consumed.
2. **Resume check** — a fresh `processes.check()` marks questions already voted; they are skipped, so calling `vote()` again after a failure completes the remaining questions instead of dying on a double-vote.
3. **Sign + build** — every remaining question gets an ephemeral signer, then all of them are signed in ONE call (`session.signBatch` → `POST /processes/{id}/sign-batch`) and each tx is built locally. A CSP signature is **one-shot**, so a question the CSP refuses is collected into `failed` and the questions that *did* sign are still built and relayed — discarding them would strand those questions forever, since a retry uses a fresh address and gets `already_consumed`. If nothing signs at all, the call throws the first signing error and relays nothing (fully retryable). On an anonymous census that one call runs the blind CSP flow instead and the txs carry `ProofCA_Type.ECDSA_BLIND_PIDSALTED` — automatic, nothing to configure.
4. **Batch relay + await** — every tx is relayed in ONE `POST /votes` call (saas-backend#610) that the backend accepts or rejects **as a unit**: a rejection (bad payload, queue full…) relays nothing and throws a plain, fully-retryable error — never a partial vote. On accept, one job covers the batch; its per-envelope outcomes settle one by one and are mirrored into `voteStatus` while pending. If, on chain, some votes land and some fail, `vote()` throws `PartialVoteError` (exported from `@vocdoni/react-providers`) with `succeeded: {questionId, voteId}[]` and `failed: {questionId, error}[]`, and refreshes `voterQuestions`/`hasVoted` to the on-chain truth. Catch it and offer a retry — the next `vote()` call resumes.

Drive a per-question spinner off `voteStatus`: `signing` → `submitting` (tx built, batch not yet sent) → `confirming` (enqueued, awaiting the chain) → `confirmed` | `failed`.

Use `@vocdoni/ballot` to encode ballots before calling `vote()`:

```tsx
import { encodeQuestionSelections } from '@vocdoni/ballot'

const encodedBallots = election.questions.map((q, i) =>
  encodeQuestionSelections(q, answers[i])
)
const nullifier = await vote(encodedBallots)
```

`encodeQuestionSelections` — not `encodeQuestionBallot` — is the entry point for a form,
because a ranked question's collected answer is the voter's *ordering* while the wire
wants one rank per option (see [voting.md](voting.md)). Passing an ordering to
`encodeQuestionBallot` produces a perfectly valid ballot that the Borda decode reads
upside-down, so nothing fails and the loser wins. For every other type the two are
identical.

`status` is computed by `computeProcessStatus(election.questions)` from `@vocdoni/api-client`:
- Any question `ONGOING` → `ONGOING`
- All same status → that status
- All `ENDED` or `RESULTS` → `ENDED`
- Otherwise → `PROCESS_UNKNOWN`

The wire status `READY` (a live question) is normalized to `ONGOING` on every
client read — and defensively inside `computeProcessStatus` too, so raw SSR
data passed via `<ElectionProvider election>` derives correctly as well.

---

## ActionsProvider / useActions

Admin lifecycle controls: pause, resume, end, cancel. Must be inside `<ElectionProvider>`.

```tsx
import { ActionsProvider, useActions } from '@vocdoni/react-providers'

<ElectionProvider id={id}>
  <ActionsProvider>
    <AdminControls />
  </ActionsProvider>
</ElectionProvider>

const { pause, resume, end, cancel, loading, error } = useActions()
await pause()    // → status 'paused'
await resume()   // → status 'ready'
await end()      // → status 'ended'
await cancel()   // → status 'canceled'
```

---

## OrganizationProvider / useOrganization

```tsx
import { OrganizationProvider, useOrganization } from '@vocdoni/react-providers'

<OrganizationProvider id={orgAddress}>...</OrganizationProvider>

// Or with prefetched data — rendered instantly and seeded as initialData;
// still refetches when stale. `id` derives from organization.address if omitted.
<OrganizationProvider organization={prefetchedOrg}>...</OrganizationProvider>

// Optional: tune the underlying react-query read
// (queryKey/queryFn/enabled/initialData are provider-owned).
<OrganizationProvider id={orgAddress} queryOptions={{ staleTime: 60_000 }}>
  ...
</OrganizationProvider>

const { organization, loading, error, fetch, update } = useOrganization()
```

`organizationQueryKeys.organization(address)` is exported for cache pre-seeding/invalidation, mirroring `electionQueryKeys`.

---

## @vocdoni/react-components

Unstyled building blocks. Every component reads from the nearest provider context. Components accept standard HTML props and forward them to the root element.

```bash
pnpm add @vocdoni/react-components
```

Key election components (all from `@vocdoni/react-components`):

| Component | What it renders |
|---|---|
| `<ElectionTitle />` | `election.title` as a heading |
| `<ElectionDescription />` | `election.description` |
| `<ElectionHeader />` | Header image / media |
| `<ElectionSchedule />` | Start/end dates |
| `<ElectionStatusBadge />` | Status chip (ONGOING, PAUSED, ENDED…) |
| `<ElectionQuestions />` | Full question + choices form (calls `vote()` on submit) |
| `<VoteButton />` | Submit button; auto-disabled when `!isAbleToVote` |
| `<VoteWeight />` | Voter's census weight |
| `<ElectionResults />` | Results histogram; respects `secretUntilTheEnd`; renders the abstain row only when it is meaningful |
| `<Voted />` | The voter's vote ids — one line per voted question |
| `<ElectionEnvelope />` | Vote envelope / nullifier display |

**`<Voted />`** renders one entry per question the voter cast, in process order,
each pairing the question's title with its vote id (rendered as a link). Its
`Voted` slot gets both a `votes: VotedVote[]` array
(`{ questionId, questionTitle, voteId, description }`) to lay out yourself and a
joined `description` node, so overrides written against the old single-string
`description` keep showing every id. With a single voted question it renders the
plain `vote.voted_description` sentence, exactly as before; with more, it uses
`vote.voted_question_description` (`Your vote id for "{{ title }}" is {{ id }}.`).

Components that open a confirmation dialog (`<ElectionQuestions />` via its
`QuestionsFormProvider`, `<ActionCancel />`, `<ActionEnd />`) mount their own
`ConfirmProvider` automatically. Mount one yourself (e.g. app-wide) only to make
them share a single dialog boundary — a provider you mount takes precedence.

**Extended choices** — `<ElectionQuestions />` renders a question in the
`extended` presentation as soon as any of its choices has a non-empty
`meta.description` or `meta.image` — the per-choice image/description the API
client folds in from the question's `metadata.choices` on read (see [[client]]).
It switches to the `grid` layout (and drops `compact` on the choice controls)
when any choice has an image, `default` or `thumbnail`. Empty and
whitespace-only strings do not count, so a stored `"description": ""` keeps the
plain `basic`/`list` rendering, as does a question with no `metadata.choices` at
all. When you hand `<ElectionProvider>` a prefetched `election`, it runs the
same normalization, so extended choices show on the first paint too.

**Ranked questions** — a question declaring `metadata.type.name = 'ranked'` (see
[voting.md](voting.md)) renders a **rank widget** instead of the checkbox group its
protocol would otherwise get: one position control per option, through the
`QuestionRankChoice` slot rather than `QuestionChoice`. The question's
`selectionMode` is `'ranked'` (a third value alongside `'single'` / `'multiple'`).

The slot receives `position` (1-based, `null` while unranked), the full list of
`options` (`{ position, label, taken }` — `taken` marks a place another option
already holds, and picking it **swaps** the two), and `onRank(position | null)`. The
default implementation is a `<select>` per option; override the slot for
drag-and-drop or numbered buttons.

The form value is the voter's **ordering** — a `string[]` of choice values, best
first, padded with `''` for unfilled places — and `QuestionsFormProvider` transposes
it into wire ranks on submit (`encodeQuestionSelections`, which owns a
transposition that would otherwise be written out at every call site). Submitting is
blocked until every option is placed (`questionSelectionRange` reports `{min: n, max: n}`): a
ranked protocol leaves exactly one rank per option, so a partial ranking repeats a
value and the chain discards the whole ballot while still counting the envelope.

Note that `<ElectionResults />` shows the **Borda score** for such a question, not a
voter count — same as it already does for budget/quadratic amounts.

**Slot customization** — every component accepts a slot override for rendering:

```tsx
// Not yet documented — check packages/react-components/src/components/ for the current API
```

---

## Complete minimal voting UI

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  ClientProvider,
  ElectionProvider,
  useElection,
  useElectionAuth,
} from '@vocdoni/react-providers'

const qc = new QueryClient()

function VoterAuth() {
  const { connected, auth0 } = useElectionAuth()
  if (connected) return null
  return (
    <button onClick={() => auth0({ memberNumber: '42' })}>
      Log in to vote
    </button>
  )
}

function VotingForm() {
  const { election, status, isAbleToVote, vote, hasVoted, voteIds } = useElection()
  if (!election) return <p>Loading…</p>
  // One vote id per question — never just voteIds[questions[0].id].
  if (hasVoted)
    return (
      <ul>
        {election.questions.map((q) => (
          <li key={q.id}>
            {typeof q.title === 'string' ? q.title : q.title.default}: {voteIds[q.id]}
          </li>
        ))}
      </ul>
    )
  if (status !== 'ONGOING') return <p>Voting is not open</p>

  // Process text is a language map ({ default, … }); resolve it for display.
  const text = (t: string | Record<string, string>) => (typeof t === 'string' ? t : t.default)
  const q = election.questions[0]
  return (
    <div>
      <h2>{text(q.title)}</h2>
      {q.choices.map((c) => (
        <button key={c.value} onClick={() => vote([[c.value]])} disabled={!isAbleToVote}>
          {text(c.title)}
        </button>
      ))}
    </div>
  )
}

export function App() {
  return (
    <QueryClientProvider client={qc}>
      <ClientProvider apiUrl="https://saas-api.vocdoni.net">
        <ElectionProvider id="<processMongoId>">
          <VoterAuth />
          <VotingForm />
        </ElectionProvider>
      </ClientProvider>
    </QueryClientProvider>
  )
}
```

---

## Cross-references

- [[integrator-sdk]] — provider nesting, vote flow overview
- [[voting]] — `VotingClient` and `choices` format details (what `useElection().vote()` calls internally)
- [[client]] — `VocdoniApiClient` and all sub-clients

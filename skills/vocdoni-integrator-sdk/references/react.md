# Reference: @vocdoni/react-providers + @vocdoni/react-components

Two packages that work together. `react-providers` is the headless logic layer (context + hooks); `react-components` is the unstyled UI layer built on top of it.

The voter flow is process-scoped and lives in ONE provider: `ElectionProvider`
fetches the voting process, drives the per-question vote AND holds the voter's
CSP auth session (`client.elections`). `useElection()` exposes everything;
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

`ClientProvider` takes no `lang` prop yet, so the client's language — the one
that decides which language the 2FA OTP email/SMS arrives in — has to be set on
the instance itself. Once i18n is initialized, synchronize it below
`ClientProvider` and above request-starting descendants. Use a layout effect so
it runs before descendant passive (`useEffect`) effects, including automatic
OTP requests on mount, and updates again whenever the locale changes:

```tsx
import { useLayoutEffect } from 'react'

const { client } = useClient()
const { i18n } = useTranslation()
useLayoutEffect(() => client.setLang(i18n.language), [client, i18n.language])
```

A parent `useEffect` is too late for a child's mount effect. This layout-effect
pattern covers descendant passive effects and subsequent user interactions,
not requests started during render, descendant layout effects, or SSR. If
requests can start earlier, gate those descendants until language setup has
completed; configure server-side clients with `lang` at construction.

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

// Block-explorer base URL for the vote-id links (trailing slashes are stripped; empty falls
// back). Defaults to the explorer of the process's own chainId, so pass it only to override that.
<ElectionProvider id="<processMongoId>" explorerUrl="https://explorer.example">...</ElectionProvider>

const {
  // data
  election,      // VotingProcessResponse | null — full process with questions[]
  status,        // QuestionStatus | null — derived from all question statuses
  chainId,       // string | null — Vochain chain id votes are signed against
  explorerUrl,   // string | null — explorer base: the explorerUrl prop, else the explorer of
                 //   chainId; null when neither resolves (an unknown chain)
  results,       // VotingProcessResultsResponse | null — per-question results
  loading,       // boolean
  error,         // Error | null
  // voter auth session (also available standalone via useElectionAuth())
  authToken,     // string | null — verified CSP token; null until authenticated
  connected,     // boolean — true once the voter holds a verified authToken
  challengePending, // boolean — true after a 2FA auth0() until auth1() confirms it (or clear() drops it)
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
  voterQuestions,// ProcessQuestionStatus[] — per-question canVote/hasVoted/hasSigned (empty until connected);
                 //   hasVoted = on chain (an anonymous question verified via /votes/verify reads true)
  hasVoted,      // boolean — true once EVERY question is on chain
  pendingVotes,  // Record<questionId, true> — signed txs stored in this tab, not on chain yet;
                 //   re-sent on connect and by the next vote() while the question is open (process
                 //   and question ONGOING), so it waits while paused/upcoming/ended; render those
                 //   questions read-only
  isAbleToVote,  // boolean — connected && isInCensus && !hasVoted && some eligible, open (ONGOING)
                 //   question is not signed yet or pending a re-send
  vote,          // (encodedBallots: number[][]) => Promise<string> — per-question ballots
                 //   (a pending question's ballot is ignored: its stored tx is re-sent). Only open
                 //   (ONGOING) questions are signed and relayed; the ballots of paused/upcoming/ended
                 //   ones are ignored and can be voted by a later call once they open. Throws
                 //   NoOpenQuestionError (`questions: {questionId, status}[]`) when unvoted questions
                 //   remain but none is open (e.g. between questions of a question-by-question vote)
  voting,        // boolean — true while vote() or the re-send on connect is in flight
  voteStatus,    // Record<questionId, 'signing'|'submitting'|'confirming'|'confirmed'|'failed'
                 //   |'unconfirmed'|'signed'> — per-question progress of the current/last vote()
                 //   (already-voted → 'confirmed'); 'unconfirmed'/'signed' also set on connect
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
learns the address, and `check()` never reports `hasVoted` there. The provider
keeps each confirmed nullifier in the tab's `sessionStorage` and re-verifies it
on connect (`client.elections.verifyVotes`), so a reload of the same tab
recovers `hasVoted` and `voteIds`. A new tab or device has nothing to verify:
the question reads `signed` (authorized, not confirmable from here).

### Verified vote status and the pending-vote store

A question counts as voted only on on-chain evidence: the relay job said
`completed`, `check()` reports `hasVoted` (plain census), or
`POST /votes/verify` confirms the stored nullifier (anonymous census).
`hasSigned` alone never confirms anything. Every signed tx is written to
`sessionStorage` under `vocdoni.pendingVote.<upstreamId>.<nullifier>` before it
is relayed, as `{ owner, nullifier, txPayload?, savedAt, confirmedAt? }`, where
`owner` is the sha256 of the voter's canonical `auth0()` payload, or the step-0
`voterRef` when the backend returns one (certificate censuses, `census.certAuth`,
where the payload is a fresh `{ certCode, codeVerifier }` on every login). So:

- a relay that fails or never answers leaves the question `failed` and in
  `pendingVotes`; the next `vote()` — or the next connect in the same tab —
  re-sends the same bytes (no new CSP signature; idempotent on chain);
- a question signed but not on chain with nothing stored reads `unconfirmed`
  (plain census) or `signed` (anonymous), cannot be voted again, and makes
  `vote()` throw `UnconfirmedVoteError` (`questions: {questionId, status}[]`)
  once nothing else is left;
- entries of another voter in the same tab are never relayed, verified or
  deleted; `clearVoter()` keeps the entries; a process `ENDED`/`RESULTS`/
  `CANCELED` drops them; the store dies with the tab;
- a backend without `hasSigned` keeps the old behaviour: `hasVoted` is trusted
  as on chain and `verifyVotes` is never called.

```tsx
const { election, voteIds } = useElection()
election.questions
  .filter((q) => voteIds[q.id])
  .map((q) => `${q.title.default}: ${voteIds[q.id]}`)
```

### Voter authentication

For a ready-made UI, `<CspAuth />` from `@vocdoni/react-components` runs this whole flow (fields, one-time code, resend, logout); see "CSP voter identify" below. The calls here are what it uses, for a custom flow.

**Auth-only census** (no 2FA): `election?.census?.twoFaFields` is empty/absent. `auth0()` sets `connected = true` immediately; skip `auth1`.

**2FA census**: `auth0()` sends the challenge; call `auth1(otp)` to confirm. `connected` becomes `true` after `auth1`. While the challenge awaits, `challengePending` is `true`; `clear()` drops it, so a code step must go back to identify.

A successful `auth0()` replaces the current session: an already connected voter is disconnected (`authToken` null, vote state reset) until the new identity's `auth1()` completes (auth-only census: at once), so the previous voter's token is never used for the new identity.

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

`useElectionAuth()` returns just the session slice (`authToken`, `connected`, `challengePending`, `weight`, `auth0`, `auth1`, `resend`, `check`, `sign`, `signBatch`, `clear`) from its own context — auth-only widgets (identify forms, OTP inputs, logout buttons) using it don't re-render when election data or results update. Its `clear()` is equivalent to `clearVoter()`: clearing the session also resets the vote state.

`vote(encodedBallots, memos?)` takes one pre-encoded `number[]` per question (plus optional per-question memo strings — free-text notes like an open "Other" answer, max 256 UTF-8 bytes each, validated pre-flight; ⚠️ memos ride the envelope in cleartext even for secret questions), casts a separate Vochain vote for each, and returns the first nullifier cast by the call. In `react-components`, registering reserved `memo.{index}` fields (`memo.0`, `memo.1`, …) in the questions form collects memos automatically.

Casting is **phased** so a failure can never half-vote silently:

1. **Pre-flight** — every question is validated up front (`upstreamId` present; open (`ONGOING`) `secretUntilTheEnd` questions have published `encryptionKeys` — never casts cleartext; at most 100 questions, the batch relay cap). Any problem throws before anything is consumed.
2. **Resume check** — a fresh `elections.check()` (plus `verifyVotes` for an anonymous census) decides each question: on chain → skipped; pending → its stored tx is reused (only while the question is open; otherwise it waits); `unconfirmed`/`signed` → left alone; otherwise signed below. If that check fails, `vote()` throws `Could not verify your voting status; try again` without signing or relaying anything.
3. **Sign + build** — every open question gets an ephemeral signer, then all of them are signed in ONE call (`session.signBatch` → `POST /processes/{id}/sign-batch`) and each tx is built locally. A CSP signature is **one-shot**, so a question the CSP refuses is collected into `failed` and the questions that *did* sign are still built and relayed — discarding them would strand those questions forever, since a retry uses a fresh address and gets `already_consumed`. If nothing signs at all, the call throws the first signing error and relays nothing (fully retryable). On an anonymous census that one call runs the blind CSP flow instead and the txs carry `ProofCA_Type.ECDSA_BLIND_PIDSALTED` — automatic, nothing to configure. Each built tx is stored (see above) before the relay.
4. **Batch relay + await** — every tx is relayed in ONE `POST /votes` call (saas-backend#610) that the backend accepts or rejects **as a unit**: a rejection (bad payload, queue full…) relays nothing and throws a plain, fully-retryable error — never a partial vote. On accept, one job covers the batch; its per-envelope outcomes settle one by one and are mirrored into `voteStatus` while pending. A job-reported failure, a missing outcome, a lost relay response or a job wait that times out is verified on chain before it is reported (a lost response or a timeout is polled for up to `voteOptions.reconcile`, default 48 × 2.5 s); a verification that itself fails reports the question `failed` with the error `could not confirm the vote on chain yet` — unknown, not rejected. If some votes land and some fail, `vote()` throws `PartialVoteError` (exported from `@vocdoni/react-providers`) with `succeeded: {questionId, voteId}[]` and `failed: {questionId, error}[]`; `hasVoted` turns true only when every question is on chain. Catch it and offer a retry — the next `vote()` call re-sends the stored txs.

Drive a per-question spinner off `voteStatus`: `signing` → `submitting` (tx built, batch not yet sent) → `confirming` (enqueued, awaiting the chain) → `confirmed` | `failed`. `unconfirmed` and `signed` are terminal for this tab. A question `vote()` skips because it is not open gets no entry.

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

`status` is computed by `computeProcessStatus(election.questions, { startDate: election.startDate })`
from `@vocdoni/api-client`:
- Live question (`ONGOING`) while `startDate` is still ahead → read as `UPCOMING`
- Any question `ONGOING` → `ONGOING`
- All same status → that status
- All `ENDED` or `RESULTS` → `ENDED`
- Otherwise → `PROCESS_UNKNOWN`

The wire status `READY` (a live question) is normalized to `ONGOING` on every
client read — and defensively inside `computeProcessStatus` too, so raw SSR
data passed via `<ElectionProvider election>` derives correctly as well.

The chain has no "upcoming" state: a published process with a future
`startDate` reports its questions as `READY` before and after the start, but
rejects every vote cast before it. The provider therefore reads a live
question as `UPCOMING` until the start passes, and arms a timer so `status`
flips to `ONGOING` at that instant without a refetch. Everything that gates on
`status === 'ONGOING'` (`<VoteButton />`, the question fields, `<ActionPause />`)
stays locked until then. A process that lacks `startDate` (published before
the backend backfilled it) is treated as already started.

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
| `<ElectionSchedule />` | Start/end dates (end is `endedAt ?? endDate`, so an early-ended vote shows when it really stopped; a custom slot gets only `text`, so compute it with `resolveEndDate(election)`, re-exported from `@vocdoni/react-components`) |
| `<ElectionStatusBadge />` | Status chip (ONGOING, PAUSED, ENDED…) |
| `<ElectionQuestions />` | Full question + choices form (calls `vote()` on submit); renders a failed cast as a form-level `QuestionsError` |
| `<VoteButton />` | Submit button; auto-disabled when `!isAbleToVote`, when `status !== 'ONGOING'`, or while a vote is in flight. Passes the slot a `tooltip` naming why it is disabled ("Voting opens on Sep 29, 2026, 9:00 AM", "Voting not open yet" without a start date, "Voting is paused", "Voting has ended", "Voting was canceled", "You have already voted", "Identify first to vote", "You are not eligible to vote in this process", and — when a question is `unconfirmed` or `signed` — `vote.disabled.unconfirmed` / `vote.disabled.signed`; in a question-by-question vote where the voter has no open question left and the remaining ones are paused or upcoming (process `ONGOING`, or `PROCESS_UNKNOWN` between two questions), `vote.disabled.waiting_question` once the voter has voted a question, `vote.disabled.waiting_question_none` otherwise) — the default slot renders it as the button's `title`, which is a minimal reference only — a disabled button takes no keyboard focus and touch devices never reveal `title`, so a production slot should render the reason as visible helper text tied to the button with `aria-describedby`. A consumer-passed `disabled` carries no tooltip. Strings live under `vote.disabled.*` in the `react-components` i18n namespace; `vote.disabled.upcoming_date_format` is the date-fns pattern of the dated one. |
| `<VoteWeight />` | Voter's census weight |
| `<ElectionResults />` | Results histogram; respects `secretUntilTheEnd`; renders the abstain row only when it is meaningful |
| `<Voted />` | The voter's vote ids — one line per voted question, each linked to the explorer |
| `<ElectionEnvelope />` | Vote envelope / nullifier display |
| `<CspAuth />` | The voter's identify flow: an Identify button opening a modal (census fields, then the one-time code when the census has 2FA), or a Logout button once connected. Renders nothing until the election loads. See below |

**CSP voter identify — `<CspAuth />` and `<CspAuthSession />`.** `<CspAuth />` asks for
the census `authFields` (the password always last). When `twoFaFields` is set, one contact
input follows. Its type is `email` for an email-only census and `tel` for phone-only; with both
channels it is `text`, and the value is routed to `email` if it contains `@`, otherwise to `phone`.
Whitespace-only values are rejected as required. Step 1 then asks for the 6-digit one-time code,
which submits itself once all six digits are in (a code typed while a resend is in flight goes out
when the resend settles) and offers resend and start over. An auth-only census is connected after step 0.
Props: `terms?: ReactNode` (content above the submit button), `requireTerms?: boolean` (makes
`terms` the label of a required checkbox, so submit is blocked until it is checked), `className?`.

```tsx
<CspAuthSession>
  <CspAuth requireTerms terms={<>I accept the <a href="/terms">terms</a></>} />
  <CspAuth />
</CspAuthSession>
```

Wrap a page's identify buttons in one `<CspAuthSession>`: every `<CspAuth />` under it shares
one step, so closing the code dialog and reopening it from another button resumes the same
step. Without it each `<CspAuth />` keeps its own step. A session from an outer `ElectionProvider`
is reused only when it belongs to the same `ElectionProvider` instance and process; a nested provider
gets its own flow. A request in flight outlives the dialog that sent it: the trigger gets `loading`
(rendered as `aria-busy`) until it settles, and only requests of the same session mark it busy.
A failure that settles after the dialog closed is kept in the session and shown when it reopens.
A process change sends the flow back to identify and drops the typed values, the contact, the notice
and the error. A request still in flight for the previous process keeps the session busy until it
settles, but its outcome is ignored: it does not move the flow, nor write the voter session. A process
change does not clear the voter session itself (`authToken`, a pending challenge): the app calls
`clear()` or `clearVoter()`. Start over, or the app clearing the voter while the flow is on step 1,
drops a request that is still in flight, so its outcome never moves the flow. Clearing the voter during
an identify request (step 0) does not: if it succeeds, the flow still moves to step 1.

`useCspAuthSession()` reads the shared session under a `<CspAuthSession>` (it throws outside one):
`currentStep` (0 identify, 1 code), `contact`, `error`, `authFields`, `twoFaFields`, `processId` and
`resetFlow()`, which goes back to step 0. Use it to show the current step elsewhere on the page; its
other fields are the components' own bookkeeping.

The code step maps the backend codes to these messages: a resend that hits the per-token cap
(40017 without a `retryAfter`) says to start over (`csp.errors.resend_limit`); a rejected code
(40001) says it is not valid or has expired (`csp.errors.code_rejected`), and a resend rejected
with 40001 says the code has expired (`csp.errors.resend_expired`); missing identify data
(40005) asks to fill in every field (`csp.errors.missing_data`). If the app clears the voter while
the flow is on step 1 (`clear()`, `clearVoter()`), the flow goes back to identify.
Auth requests are never retried, whatever the app's `QueryClient` mutation defaults, so a failed
identify or code costs one attempt.

**Certificate censuses are not handled by `<CspAuth />`.** A census with `certAuth` logs in with a
certificate (`certCode` and `codeVerifier`), not with the census fields. For it `<CspAuth />` renders
nothing until the app connects the voter by other means; once connected it shows the Logout button.

**The password is never sent in plaintext.** It is hashed with
`hashMemberPassword(orgAddress, password)` from `@vocdoni/api-client` before the identify request.
If the election has no org address, or hashing fails, the form shows "the password cannot be
checked right now" and sends nothing.

The flow is customizable through five slots, all in `ComponentsProvider`:

| Slot | Props |
|---|---|
| `CspAuthTrigger` | `label`, `onClick`, `loading?` (aria-busy), plus HTML button attributes. Default: `<button>` |
| `CspAuthLogout` | `label`, `onClick` (calls `clear()`), `disabled?` (true while a vote is being sent), `autoFocus?` (true when it replaces an open dialog; the default takes focus). Default: `<button>` |
| `CspAuthModal` | `isOpen`, `onClose`, `title`, `closeLabel`, `content`. Rendered whenever `<CspAuth />` renders, with `isOpen` false while closed and once connected (so it sees the close); nothing renders before the election loads, nor for a certificate census before the voter connects. Default: overlay and `role="dialog"`; focus moves into the dialog on open, Tab and Shift+Tab stay inside it, and focus returns to the opening element on close unless it has left the page; Escape and a click that starts and ends on the overlay close it. The default has no positioning or visual styles |
| `CspAuthIdentifyForm` (step 0) | `fields: CspAuthField[]`, `terms?`, `termsField?: { error?, inputProps }` (set with `requireTerms`), `error?`, `loading`, `submitLabel`, `info?`, `onSubmit(event)` |
| `CspAuthCodeForm` (step 1) | `title`, `helper`, `code`, `length`, `onCodeChange(code)`, `error?`, `notice?`, `loading`, `submitLabel`, `onSubmit(event)`, `resendLabel`, `onResend`, `resending`, `startOverLabel`, `onStartOver`, `actionsDisabled`, `footer?` |

`CspAuthField` is `{ name, label, type, required, helper?, error?, inputProps }`; spread
`inputProps` (react-hook-form's `register` result) on the input. Whatever a custom slot passes to
`onCodeChange`, the component keeps only its digits, up to the code length. Labels and messages live under the
`csp.*` keys of the `react-components` i18n namespace. The code input has no `maxLength`: a pasted
"123 456" is filtered to its digits, not cut.

**A question with no inferable ballot type degrades instead of crashing.** Legacy
elections projected by `GET /processes` can carry questions with an empty `type`, no
`ballotProtocol` and no `metadata`. None of the components infer a type for them by
throwing — they use `tryInferQuestionBallotType` from `@vocdoni/ballot` and:

- `<QuestionsTypeBadge />` and `<QuestionTip />` render nothing;
- `<ElectionQuestions />` renders the question's choices disabled plus a `QuestionsError`
  (`variant='field'`, key `errors.question_unsupported`), and registers the question as a
  field that always fails validation, so every submit is refused before the confirmation
  dialog (reaching `onInvalid`, with the question flagged invalid) — no vote is cast for
  any question of that process, unless the question is locked (not open, or already
  voted): then it renders its lock notice, is ignored like any locked question, and the
  open questions can be voted;
- `<ElectionResults />` lists the choices with `votes` and `percent` set to `''` (the
  default slot then omits the tally), while the process's other questions decode normally.

Custom slots receiving `ElectionResultChoice` should handle the empty `votes`/`percent`.
Code of your own that runs at render time should use `tryInferQuestionBallotType` too.

**Failed votes are shown, not swallowed.** `<ElectionQuestions />` submits through
react-hook-form, whose `handleSubmit` rejects when the handler throws — with nothing
awaiting that promise, a rejected cast used to leave the page silent while the vote was
discarded (integrator-sdk#53). The form now catches the failure, records it as the
form-level error `root.vote`, and renders it through the `QuestionsError` slot with
`variant='form'` (field validation uses `variant='field'`). React-hook-form clears `root`
errors on the next submit, so a retry starts clean.

The message keeps the chain's own reason, which the backend relays verbatim as each
envelope's `error` — it is the only account of why a vote did not count. A whole-batch
failure reads `errors.vote_failed` ("Your vote could not be cast: …"), a
`PartialVoteError` reads `errors.vote_partial` (how many questions were recorded, the
distinct reasons, and that submitting again retries the rest), a failure with no
message reads `errors.vote_failed_unknown`, and an unknown outcome (`could not confirm`)
reads `errors.vote_unconfirmed`, and a `NoOpenQuestionError` reads
`errors.vote_no_open_question`. `<ElectionQuestions />` replaces the fields of a
question already voted (`voteStatus` `confirmed`, or `voterQuestions` `hasVoted` for a vote cast in an earlier session) with `vote.disabled.question_voted`,
— while the process is `ONGOING`, or `PROCESS_UNKNOWN` between two questions (one `ENDED`, the next `PAUSED`) — of a question that is not open itself (question by
question: paused, upcoming, ended; even one in `pendingVotes`, whose stored tx waits
until it reopens) with `vote.disabled.question_not_open`, of an open one in
`pendingVotes` with `vote.pending_resend`, and of an `unconfirmed`/`signed` one with the
matching `vote.disabled.*` text, through the `QuestionsError` slot
(`variant='field'`, `data-question-id`); those questions get a placeholder ballot, need
no answer to submit, and are left out of the confirmation (`QuestionsConfirmation`'s
`skip` prop, the indexes it omits from `answersView`). `lockedQuestionNotice(id,
pendingVotes, voteStatus, { questionStatus, processStatus, voted }?)` returns that key.

Consequently `useQuestionsForm().vote(values)` resolves `false` on a failed cast rather
than rejecting — same as when the voter cancels the confirmation, and the same contract
the encode-error branch already used. `useElection().vote()` still throws, so a custom UI
that drives the cast itself keeps full control of the error.

**`<Voted />`** renders one entry per question the voter cast, in process order,
each pairing the question's title with its vote id. The id links to
`${explorerUrl}/verify/{voteId}`; without an `explorerUrl` (unknown chain) it is plain text. Its
`Voted` slot gets both a `votes: VotedVote[]` array
(`{ questionId, questionTitle, voteId, description, url? }`, where `url` is that vote's verify link,
absent when the network is unknown) to lay out yourself and a
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

Pass overrides to `<ComponentsProvider components={…}>`; slots you leave out keep their default.
Each slot receives the props typed as `<SlotName>SlotProps` (exported from `@vocdoni/react-components`):

```tsx
import { ComponentsProvider, CspAuth, type CspAuthTriggerSlotProps } from '@vocdoni/react-components'

const Trigger = ({ label, loading, className, ...props }: CspAuthTriggerSlotProps) => (
  <button {...props} className={`btn btn-primary ${className ?? ''}`.trim()} aria-busy={loading || undefined}>
    {label}
  </button>
)

<ComponentsProvider components={{ CspAuthTrigger: Trigger }}>
  <ElectionProvider id={processId}>
    <CspAuth />
  </ElectionProvider>
</ComponentsProvider>
```

The full list of slots is the `ComponentsDefinition` type.

Default slots render every metadata text (election, question, choice and organization descriptions) as plain text with line breaks, never as HTML, because any account can write it. To show Markdown or HTML, override the slot and sanitize the output (for example, react-markdown without raw HTML, or DOMPurify).

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

- [[vocdoni-integrator-sdk]] — provider nesting, vote flow overview
- [[voting]] — `VotingClient` and `choices` format details (what `useElection().vote()` calls internally)
- [[client]] — `VocdoniApiClient` and all sub-clients

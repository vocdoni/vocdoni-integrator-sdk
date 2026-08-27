/**
 * Anonymous vote — blind CSP census (`census.anonymous === true`).
 *
 * On a normal SaaS process the CSP signs the voter's ephemeral address in the
 * clear, so it could link voter → vote. On an anonymous census it signs a
 * BLINDED message instead: it authorizes the ballot without ever seeing it, and
 * cannot recognise the signature when it later appears on chain.
 *
 * This is a blind signature, NOT zero-knowledge. `EnvelopeType.Anonymous` stays
 * false and this has nothing to do with `@vocdoni/api-voting-zk`.
 *
 * What changes versus `recipes/single-choice-vote.ts`:
 *   - `processes.sign()` → `signBlindCspBallots()` (two rounds, batched, all
 *     questions at once — there is no single-election blind endpoint)
 *   - `buildVoteTransaction` gets `proofType: ProofCA_Type.ECDSA_BLIND_PIDSALTED`
 *   - the relay (`POST /vote`) and job polling are unchanged
 *
 * Everything else — auth, check, ballot encoding, encryption — is identical.
 *
 * Prerequisites:
 *   pnpm add @vocdoni/api-client @vocdoni/api-voting @vocdoni/ballot @vocdoni/proto
 */

import { VocdoniApiClient } from '@vocdoni/api-client'
import { EphemeralSigner, signBlindCspBallots, VotingClient } from '@vocdoni/api-voting'
import { encodeQuestionBallot } from '@vocdoni/ballot'
import { ProofCA_Type } from '@vocdoni/proto/vochain'

// ─── Config ──────────────────────────────────────────────────────────────────

const API_URL = 'https://saas-api.vocdoni.net'
const PROCESS_ID = '<process-mongo-id>' // the SaaS process id (24-hex Mongo ObjectID)
const VOTER = { memberNumber: '42' } // fields required by election.census.authFields

const CHOSEN_OPTION_BY_QUESTION: Record<string, number> = {
  // '<questionId>': 0,
}

const client = new VocdoniApiClient({ apiUrl: API_URL })
const voting = new VotingClient({ client })

// ─── 0. Public process read ──────────────────────────────────────────────────

const election = await client.elections.get(PROCESS_ID)
if (!election.chainId) throw new Error('Process has no chainId (not published?)')
if (!election.census.anonymous) {
  throw new Error('Census is not anonymous — use recipes/single-choice-vote.ts instead')
}
const CHAIN_ID = election.chainId

// ─── 1-2. Auth + check (unchanged by anonymity) ──────────────────────────────

const res0 = await client.processes.authStep0(PROCESS_ID, VOTER)
if (!res0.authToken) throw new Error('Auth step 0 did not return a token')
let authToken = res0.authToken

if ((election.census.twoFaFields?.length ?? 0) > 0) {
  const otp = await promptForOtp() // your UI
  const res1 = await client.processes.authStep1(PROCESS_ID, { authToken, authData: [otp] })
  authToken = res1.authToken ?? authToken
}

const check = await client.processes.check(PROCESS_ID, { authToken })
if (!check.belongsToProcess) throw new Error('Voter is not in this census')

const votable = check.questions.filter((q) => q.canVote && !q.hasVoted && q.upstreamId)
if (votable.length === 0) throw new Error('Nothing left to vote on')

// ─── 3. Blind CSP signing — ALL questions in one call ────────────────────────
// One fresh signer per question, decided BEFORE signing: the address goes
// inside the blinded CA bundle, so swapping signers afterwards produces a
// transaction the chain rejects.
//
// signBlindCspBallots does both rounds and the blinding/unblinding:
//   POST /blind-point  → a blind point R + the authorized weight, per election
//   (blind locally)    → the CA bundle this vote will actually carry on chain
//   POST /blind-sign   → the CSP signs bytes it cannot read
//   (unblind locally)  → a 96-byte ProofCA signature
//
// Retrying the whole call is safe: round 1 is idempotent and a failed round 2
// does not consume the election's one-time nonce.

const signers = votable.map(() => new EphemeralSigner())

const signed = await signBlindCspBallots({
  processId: PROCESS_ID, // the MONGO id — the blind endpoints are process-scoped
  authToken,
  client, // VocdoniApiClient satisfies BlindCspApiClient structurally
  ballots: votable.map((q, i) => ({ upstreamId: q.upstreamId!, address: signers[i].address })),
})

// ─── 4-6. Build, relay and poll — once per question ──────────────────────────

for (const [i, result] of signed.entries()) {
  const status = votable[i]
  if (!result.signature) {
    // Per-question failure, reported inline with a stable code.
    // `already_consumed` is terminal; the batch itself only rejects on bad auth.
    console.warn(`CSP refused question ${status.questionId}: ${result.code ?? result.error}`)
    continue
  }

  const question = await client.processes.getQuestion(PROCESS_ID, status.questionId)
  const choices = encodeQuestionBallot(question, [CHOSEN_OPTION_BY_QUESTION[question.id] ?? 0])

  const jobId = await voting.vote({
    processId: result.upstreamId,
    chainId: CHAIN_ID,
    choices,
    signer: signers[i],
    cspSignature: result.signature, // 96 bytes here, not the usual 65
    cspWeight: result.weight, // MUST be passed back verbatim — it is hashed
    //                            into the salt of the key the chain verifies
    //                            against, so changing it breaks the signature
    proofType: ProofCA_Type.ECDSA_BLIND_PIDSALTED,
    encryptionKeys: question.encryptionKeys, // ignored unless secretUntilTheEnd
  })

  const job = await client.jobs.waitFor(jobId, { timeoutMs: 90_000 })
  console.log(`Vote cast on question ${question.id} — nullifier:`, job.result?.voteID)
  // ⚠️ This nullifier only exists for THIS session. processes.signInfo() reports
  // no address and no nullifier for an anonymous census — by design, since the
  // CSP never learned either — so it cannot be recovered after a reload.
}

// ─── Helpers (replace with your own) ─────────────────────────────────────────

async function promptForOtp(): Promise<string> {
  throw new Error('Implement promptForOtp() with your own UI')
}

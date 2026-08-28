/**
 * Multi-choice voting patterns.
 *
 * A process casts ONE Vochain transaction per question — this recipe loops the
 * questions reported by the process check and encodes each question's raw
 * `selections` (the voter's picks) into the on-chain `choices` array via
 * `encodeQuestionBallot`, which infers the ballot type from that question's
 * `ballotProtocol`. The auth + CSP-sign steps are identical to
 * single-choice-vote.ts; only how you build `selections` per question changes.
 *
 * ─── Format A: Single choice, pick one option ─────────────────────────────
 *   question.ballotProtocol.maxCount = 1
 *   question.ballotProtocol.maxValue = numOptions - 1
 *   selections = [optionIndex]   (the 0-based index of the chosen option)
 *
 * ─── Format B: Multichoice / approval (dense 0/1 per option) ──────────────
 *   question.ballotProtocol.maxCount = numOptions
 *   question.ballotProtocol.maxValue = 1
 *   selections = the option indexes the voter picked, e.g. [0, 2, 4]
 *   encodeQuestionBallot turns that into the dense 0/1 vector expected on-chain.
 *   question.ballotProtocol.maxTotalCost caps the number of picks (the backend
 *   sets it from typeSetup.maxChoices).
 *
 *   This is what the named `multichoice` question type derives, so it is the
 *   format you get from client.elections.create({ type: 'multichoice' }).
 *   ⚠️ uniqueValues / typeSetup.uniqueChoices MUST be false here: uniqueness is
 *   checked against the raw 0/1 field values, so any dense ballot over more than
 *   two options repeats one and the chain discards it at tally — the election
 *   reports zeros while voteCount keeps rising. encodeQuestionBallot throws for
 *   such a question instead of casting a vote that cannot count.
 *
 * ─── Format C: Ranked voting (unique values) ──────────────────────────────
 *   question.ballotProtocol.maxCount = numOptions
 *   question.ballotProtocol.maxValue >= numOptions - 1
 *   question.ballotProtocol.uniqueValues = true
 *   question.metadata = { type: { name: 'ranked' } }   ⚠️ REQUIRED
 *   selections = rank value per option in choice order, e.g. [2, 0, 3, 1]
 *   (must be a permutation of 0..numOptions-1 — no repeated ranks)
 *   HIGHER WINS: top pick gets numOptions-1, last pick gets 0. Build the array
 *   with rankedOrderToScores(question, order) rather than by hand — decoding is
 *   an index-weighted Borda sum, so ranking with 0 as "best" elects the loser
 *   and nothing on either side can detect it.
 *   The metadata declaration is what makes this ranked: the protocol above is
 *   byte-identical to Format D with every slot filled, and without the name the
 *   SDK reads it as a pick-slot multichoice and column-sums the tally, which
 *   reports the same number for every option (integrator-sdk#22).
 *
 * ─── Format D: Legacy pick-slot multichoice (raw ballotProtocol only) ──────
 *   question.ballotProtocol.maxCount = maximum number of picks allowed
 *   question.ballotProtocol.maxValue = numOptions - 1 (no abstain headroom), or
 *     numOptions - 1 + abstain allowance when the election allows abstention
 *   question.ballotProtocol.uniqueValues = true
 *   selections = the option indexes the voter picked, e.g. [1, 3]
 *   Ballots may be shorter than maxCount: encodeQuestionBallot pads unpicked slots
 *   with abstain sentinels when maxValue reserves room for them, and returns the
 *   short ballot as-is otherwise (the chain accepts it; the vochain enforces only
 *   the upper bound). The minimum pick count is a UI concern (typeSetup.minChoices).
 *   Only produced by passing a raw ballotProtocol — the named `multichoice`
 *   type always derives Format B.
 *
 * Prerequisites:
 *   pnpm add @vocdoni/api-client @vocdoni/api-voting @vocdoni/ballot
 */

import { VocdoniApiClient } from '@vocdoni/api-client'
import { EphemeralSigner, VotingClient } from '@vocdoni/api-voting'
import { encodeQuestionBallot } from '@vocdoni/ballot'

// ─── Config ──────────────────────────────────────────────────────────────────

const API_URL = 'https://saas-api.vocdoni.net'
const PROCESS_ID = '<process-mongo-id>' // the SaaS process id (24-hex Mongo ObjectID)
const VOTER = { memberNumber: '42' } // fields required by election.census.authFields

// ─── Shared setup + auth (identical to single-choice-vote.ts) ────────────────

const client = new VocdoniApiClient({ apiUrl: API_URL })
const voting = new VotingClient({ client })

// Public process read (published processes need no auth; drafts 404) — the
// chainId vote signatures are bound to comes from here, NOT client.info().
const election = await client.elections.get(PROCESS_ID)
if (!election.chainId) throw new Error('Process has no chainId (not published?)')
const CHAIN_ID = election.chainId

const res0 = await client.processes.authStep0(PROCESS_ID, VOTER)
if (!res0.authToken) throw new Error('Auth step 0 did not return a token')
const authToken = res0.authToken
// (add authStep1 here for 2FA censuses — see single-choice-vote.ts)

// Membership + per-question eligibility in one call. Each entry carries the
// question's id and its on-chain Vochain id (upstreamId) — no authed process
// read needed to discover them.
const check = await client.processes.check(PROCESS_ID, { authToken })
if (!check.belongsToProcess) throw new Error('Voter is not in this census')

// ─── Per-question selections ──────────────────────────────────────────────
// Replace this with however your UI collects the voter's picks. Each entry is
// the RAW selections for that question (see the Format A-D comments above) —
// encodeQuestionBallot maps them to the on-chain `choices` array using that
// question's ballotProtocol.

const SELECTIONS_BY_QUESTION: Record<string, number[]> = {
  // Format A — single choice: pick option 2
  // '<questionId>': [2],

  // Format B — multichoice / approval: pick options 0, 2 and 4
  // '<questionId>': [0, 2, 4],

  // Format C — ranked, 4 options, voter's order C2 > C0 > C3 > C1.
  // Ranks in choice order, highest wins: C0=2, C1=0, C2=3, C3=1.
  // Prefer encodeQuestionSelections(question, [2, 0, 3, 1]) — same result, and it
  // applies the orientation and rejects an incomplete or repeated ranking.
  // '<questionId>': [2, 0, 3, 1],

  // Format D — legacy pick-slot multichoice: pick options 1 and 3
  // '<questionId>': [1, 3],
}

// ─── Vote — once per question ──────────────────────────────────────────────
// A multi-question process casts one Vochain transaction per question, so
// question-read / CSP-sign / build-transaction / relay / poll repeat for every
// question.

for (const status of check.questions) {
  const processId = status.upstreamId
  if (!processId) {
    console.warn(`Question ${status.questionId} has no upstreamId yet (not published?) — skipping`)
    continue
  }

  const selections = SELECTIONS_BY_QUESTION[status.questionId]
  if (!selections) {
    console.warn(`No selections configured for question ${status.questionId} — skipping`)
    continue
  }

  if (!status.canVote || status.hasVoted) {
    console.log(`Cannot vote on question ${status.questionId} (ineligible or already voted) — skipping`)
    continue
  }

  // Public single-question read — choices + ballotProtocol; no API key needed.
  const question = await client.processes.getQuestion(PROCESS_ID, status.questionId)
  console.log(`Question ${question.id} ballotProtocol:`, question.ballotProtocol)
  // question.ballotProtocol.maxCount      — number of ballot fields (dense: one per option)
  // question.ballotProtocol.maxValue      — max encoded value per element
  // question.ballotProtocol.uniqueValues  — true for ranked voting; MUST be false on dense
  // question.ballotProtocol.maxTotalCost  — caps total picks/weight, if set
  // question.typeSetup?.minChoices/maxChoices — UI-facing pick bounds, if set
  // Public reads of a named-type question may omit ballotProtocol entirely —
  // encodeQuestionBallot falls back to type + typeSetup, so pass the whole
  // question rather than reading the protocol yourself.

  const signer = new EphemeralSigner()
  const { signature, weight } = await client.processes.sign(PROCESS_ID, {
    authToken,
    electionId: processId, // the QUESTION's vochain id (upstreamId), not PROCESS_ID
    payload: signer.address,
  })
  if (!signature) throw new Error(`CSP did not return a signature for question ${question.id}`)

  // encodeQuestionBallot infers the ballot type (single-choice / approval /
  // multichoice / ranked) from question.ballotProtocol (or type + typeSetup) and
  // produces the exact on-chain `choices` array — including abstain-padding for
  // the legacy pick-slot multichoice. It THROWS when the question's ballot config
  // can never be tallied (e.g. a dense multichoice created with uniqueChoices
  // true), so the voter sees an error instead of casting a vote that is silently
  // discarded during aggregation.
  const choices = encodeQuestionBallot(question, selections)

  const jobId = await voting.vote({
    processId,
    chainId: CHAIN_ID,
    choices,
    signer,
    cspSignature: signature,
    cspWeight: weight,
  })

  const job = await client.jobs.waitFor(jobId, { timeoutMs: 90_000 })
  console.log(`Vote cast on question ${question.id} — nullifier:`, job.result?.voteID)
}

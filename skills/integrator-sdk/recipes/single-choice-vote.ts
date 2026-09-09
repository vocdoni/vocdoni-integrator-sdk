/**
 * Single-choice vote — pick one option per question.
 *
 * Ballot protocol for a plain single-choice pick:
 *   question.ballotProtocol.maxCount = 1
 *   question.ballotProtocol.maxValue = numOptions - 1
 *
 * choices[0] = 0-based index of the chosen option
 *   [0] → first option ("Yes" / option A / …)
 *   [1] → second option
 *   [N-1] → last option
 *
 * This is the most common election format and the one used by the integration tests.
 *
 * A process casts ONE Vochain transaction per question — `question.upstreamId`
 * is that question's on-chain process id. This recipe loops the questions
 * reported by the process check and votes on each one with the voter's chosen
 * option index.
 *
 * The whole flow needs NO API key: the process read (`client.elections.get`)
 * is public for published processes (drafts 404 to non-managers) and provides
 * everything the voter app needs — the chainId vote signatures are bound to,
 * the census auth shape, and the questions. The CSP flow lives on the same
 * `client.elections` (ElectionsClient).
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

// Voter's chosen option index, keyed by question id. Replace with the voter's
// real picks (e.g. collected from a UI form).
const CHOSEN_OPTION_BY_QUESTION: Record<string, number> = {
  // '<questionId>': 0,
}

// ─── Setup ───────────────────────────────────────────────────────────────────

const client = new VocdoniApiClient({ apiUrl: API_URL })
const voting = new VotingClient({ client })

// ─── 0. Public process read ──────────────────────────────────────────────────
// Published processes are public (no auth). This is where the voter app gets
// the process's own chainId — never use client.info().chainId, which is the
// service's CURRENT chain id and diverges for processes published before a
// chain migration.

const election = await client.elections.get(PROCESS_ID)
if (!election.chainId) throw new Error('Process has no chainId (not published?)')
const CHAIN_ID = election.chainId
const CENSUS_HAS_2FA = (election.census.twoFaFields?.length ?? 0) > 0

// ─── 1. Auth (auth-only census — no 2FA step) ────────────────────────────────
// One auth token is obtained once and reused for every question in the process.

const res0 = await client.elections.authStep0(PROCESS_ID, VOTER)
if (!res0.authToken) throw new Error('Auth step 0 did not return a token')

let authToken = res0.authToken

if (CENSUS_HAS_2FA) {
  // Prompt for OTP here (SMS / email / TOTP)
  const otp = await promptForOtp() // your UI
  const res1 = await client.elections.authStep1(PROCESS_ID, { authToken, authData: [otp] })
  authToken = res1.authToken ?? authToken
}

// ─── 2. Check — membership + per-question eligibility in ONE call ────────────
// The process check reports every question at once — including each question's
// id and its on-chain Vochain id (upstreamId).

const check = await client.elections.check(PROCESS_ID, { authToken })
if (!check.belongsToProcess) throw new Error('Voter is not in this census')

// ─── 3-7. Read, sign, build, relay and poll — once per question ──────────────
// A multi-question process casts one Vochain transaction per question, so the
// question-read / CSP-sign / build-transaction / relay / poll steps repeat for
// every question.

const text = (t: string | Record<string, string>) => (typeof t === 'string' ? t : t.default)

for (const status of check.questions) {
  if (!status.canVote) {
    console.log(`Not eligible for question ${status.questionId} — skipping`)
    continue
  }
  if (status.hasVoted) {
    console.log(`Already voted on question ${status.questionId} — skipping`)
    continue
  }
  const processId = status.upstreamId
  if (!processId) {
    console.warn(`Question ${status.questionId} has no upstreamId yet (not published?) — skipping`)
    continue
  }

  // Public single-question read — title, choices, ballotProtocol; no API key.
  // (The same data is already in `election.questions` from step 0 — re-reading
  // here just demonstrates the single-question route.)
  const question = await client.elections.getQuestion(PROCESS_ID, status.questionId)
  console.log(`Question ${question.id}: ${text(question.title)}`)
  for (const [ci, c] of question.choices.entries()) {
    console.log(`  [${ci}] ${text(c.title)}`)
  }

  const signer = new EphemeralSigner()
  const { signature, weight } = await client.elections.sign(PROCESS_ID, {
    authToken,
    electionId: processId, // the QUESTION's vochain id (upstreamId), not PROCESS_ID
    payload: signer.address,
  })
  if (!signature) throw new Error(`CSP did not return a signature for question ${question.id}`)

  // choices: [optionIndex] — single element, 0-based index of the chosen option.
  // encodeQuestionBallot infers the ballot type from question.ballotProtocol; for
  // a plain single-choice question it just validates and wraps the index.
  const chosenOption = CHOSEN_OPTION_BY_QUESTION[question.id] ?? 0 // ← set the voter's pick
  const choices = encodeQuestionBallot(question, [chosenOption])

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

// ─── Helpers (replace with your own) ─────────────────────────────────────────

async function promptForOtp(): Promise<string> {
  // Your UI: show an OTP input, return the string the voter typed
  throw new Error('Implement promptForOtp() with your own UI')
}

/**
 * Issue #28 — how are single-choice results columns addressed when choice values
 * are NOT a contiguous 0..n-1 range?
 *
 * Two mutually exclusive models, and no amount of source-reading settles it:
 *
 * - **by value** (what `decode.ts` does today): `results[q][choice.value]`. The
 *   backend says this is the contract — `saas-backend/account/ballot.go` derives
 *   `MaxValue = max(Choice.Value)` *deliberately* ("which need not be a contiguous
 *   0..n-1 range"), and `db/types.go` documents the row as "indexed by choice value
 *   (0..MaxValue, so sparse choice values leave empty buckets)".
 * - **by position**: `results[q][i]`. Issue #28 claims this is correct and cites a
 *   live election whose column 0 holds votes under choice values 1/2/3.
 *
 * The decisive observable is the RAW matrix of a well-formed sparse election, so
 * this test asserts it directly rather than only asserting the decoded output — a
 * decoder and its fixture can be wrong together, a live chain cannot.
 *
 * Choices are published at values 1/2/3 with NO explicit `ballotProtocol`, so the
 * backend derives the protocol itself (expected `maxValue: 3`). Three members each
 * cast a different choice through `encodeQuestionBallot` — the real codec path, not
 * hand-rolled wire values, which is what made the probe in #28 ambiguous.
 *
 *   by value    → [["0","1","1","1"]]   column 0 empty (no choice has value 0)
 *   by position → [["1","1","1"]]       column 0 holds C1's vote
 */
import { describe, expect, it } from 'vitest'
import { EphemeralSigner, VotingClient } from '@vocdoni/api-voting'
import { decodeQuestionResults, encodeQuestionBallot } from '@vocdoni/ballot'
import { API_URL, apiKey, makeAdminClient, makeClient } from './helpers'

const suite = apiKey ? describe : describe.skip

/** Choice values published for the question — deliberately 1-indexed, no 0. */
const VALUES = [1, 2, 3]
const VOTERS = ['1', '2', '3']

suite('issue #28: sparse single-choice values (live)', () => {
  it(
    'addresses results columns by choice value, leaving value-0 empty',
    async () => {
      const admin = makeAdminClient()
      const voterClient = makeClient()
      const voting = new VotingClient({ client: voterClient })
      const step = (msg: string) => console.info(`[value-skew] ${msg}`)

      const org = await admin.organizations.createManaged({
        name: `skew-${Date.now()}`,
        type: 'company',
      })
      const orgAddress = org.address
      expect(orgAddress, 'managed org has no address').toBeTruthy()

      const added = await admin.organizations.addMembers(
        orgAddress,
        VOTERS.map((memberNumber) => ({ memberNumber })),
      )
      if (added.jobId) {
        await admin.jobs.waitFor(added.jobId, {
          timeoutMs: 120000,
          intervalMs: 2000,
          expectType: 'org_members',
        })
      }

      const groups = await admin.organizations.listGroups(orgAddress)
      const groupId = groups.groups[0].id
      const census = await admin.census.create({ orgAddress, authFields: ['memberNumber'] })
      await admin.census.publishGroup(census.id, groupId, {
        authFields: ['memberNumber'],
        weighted: false,
      })
      step(`org ${orgAddress}, census ${census.id}, group ${groupId}`)

      // No ballotProtocol on purpose: the backend must derive it from the choice
      // values. That derivation is half the contract under test — a maxValue of 2
      // here (count-derived) rather than 3 (value-derived) would make C3
      // uncastable, which is exactly the malformed shape #28 reported.
      const draftId = await admin.elections.create({
        orgAddress,
        census: { authFields: ['memberNumber'], groupId },
        title: 'sparse single-choice values',
        endDate: new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
        questions: [
          {
            title: '1-indexed choice values',
            choices: VALUES.map((v) => ({ title: `C${v}`, value: v })),
            type: 'singlechoice',
          },
        ],
      })
      await admin.elections.publishAndWait(draftId, { timeoutMs: 180000, intervalMs: 2000 })

      const info = await admin.elections.get(draftId)
      const question = info.questions[0]
      expect(question.upstreamId, 'question has no upstreamId').toMatch(/^[0-9a-f]{64}$/i)
      step(`choices: ${JSON.stringify(question.choices)}`)
      step(`ballotProtocol: ${JSON.stringify(question.ballotProtocol)}`)

      // The backend's own derivation, asserted before any vote: maxValue must cover
      // the highest published value, or C3 can never be recorded and the tally below
      // would be short for a reason that has nothing to do with column addressing.
      if (question.ballotProtocol) {
        expect(
          question.ballotProtocol.maxValue,
          'derived maxValue does not cover the highest choice value — C3 is uncastable',
        ).toBeGreaterThanOrEqual(Math.max(...VALUES))
      }

      // One member per choice: member 1 → C1 (value 1), member 2 → C2, member 3 → C3.
      for (const [i, memberNumber] of VOTERS.entries()) {
        const value = VALUES[i]
        const auth = await voterClient.elections.authStep0(draftId, { memberNumber })
        expect(auth.authToken, `auth failed (member ${memberNumber})`).toBeTruthy()

        const check = await voterClient.elections.check(draftId, { authToken: auth.authToken! })
        const status = check.questions[0]
        expect(status.canVote, `member ${memberNumber} cannot vote`).toBe(true)

        const signer = new EphemeralSigner()
        const sign = await voterClient.elections.sign(draftId, {
          authToken: auth.authToken!,
          electionId: status.upstreamId!,
          payload: signer.address,
        })
        expect(sign.signature, `no CSP signature (member ${memberNumber})`).toBeTruthy()

        // The real codec path. If encodeQuestionBallot maps value→position this
        // emits [i]; if it passes the value through it emits [value]. Whichever it
        // does, the raw matrix below reports what the chain actually recorded.
        const ballot = encodeQuestionBallot(question, [value])
        step(`member ${memberNumber} → choice value ${value} → wire ${JSON.stringify(ballot)}`)

        const jobId = await voting.vote({
          processId: status.upstreamId!,
          choices: ballot,
          chainId: info.chainId!,
          signer,
          cspSignature: sign.signature!,
          cspWeight: sign.weight,
        })
        const job = await voterClient.jobs.waitFor(jobId, { timeoutMs: 90000, intervalMs: 2000 })
        expect(job.status, `vote relay failed (member ${memberNumber})`).toBe('completed')
      }

      // The indexer lags the relay by a few blocks — converge on voteCount first.
      let results = await voterClient.elections.getResults(draftId)
      const deadline = Date.now() + 120000
      while ((results.questions[0]?.voteCount ?? 0) < VOTERS.length && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 3000))
        results = await voterClient.elections.getResults(draftId)
      }
      const q = results.questions[0]
      expect(q.voteCount, 'not every vote reached the chain').toBe(VOTERS.length)
      step(`voteCount = ${q.voteCount}`)
      step(`raw matrix = ${JSON.stringify(q.results)}`)

      // THE DECISIVE ASSERTION. One row (maxCount 1), four columns (0..maxValue 3),
      // with column 0 empty because no choice carries value 0. If this comes back
      // ["1","1","1"] instead, columns are addressed by POSITION, the value-indexed
      // contract is wrong, and issue #28 is right.
      expect(q.results, 'no tally matrix').toBeTruthy()
      expect(q.results).toEqual([['0', '1', '1', '1']])

      // And the decoded view must agree: one vote per choice, none lost.
      const decoded = decodeQuestionResults(question, q.results!)
      step(`decoded = ${decoded.map((c) => `${c.choice}=${c.votes}`).join('  ')}`)
      expect(decoded.map((c) => [c.choice, c.votes])).toEqual([
        [1, 1],
        [2, 1],
        [3, 1],
      ])
    },
    900000,
  )

  /**
   * The counterfactual behind the guard.
   *
   * The election in #28 pairs choice values 1/2/3 with an explicit
   * `ballotProtocol` whose `maxValue` is 2 — self-contradictory, since C3 then
   * exceeds the highest legal field value. `encodeQuestionBallot` already refuses
   * such a ballot (`assertEncodedBallot`), and the guard extends that to refusing
   * the whole question up front. That is only the right call if the chain really
   * does swallow the vote silently, so prove it rather than assume it.
   *
   * Both of our own guards have to be stepped around for the proof to mean
   * anything, and each is bypassed at a different layer:
   *
   * - **create** goes out as a raw `POST /processes`, not through
   *   `client.elections.create`. The guard lives in `normalizeVotingProcessRequest`,
   *   so the client would refuse this body before any HTTP call and the test would
   *   pass having asked the API nothing. The claim under test is "the *API* accepts
   *   this", so the API is what must be asked.
   * - **the vote** is hand-rolled onto the wire, not built by `encodeQuestionBallot`,
   *   which `assertEncodedBallot` would already stop.
   *
   * Expected: the envelope is accepted and `voteCount` counts it, but the
   * scrutinizer drops the ballot at aggregation — so the tally is short while
   * nothing anywhere reports an error. That gap is the whole reason to refuse
   * before the voter ever casts.
   *
   * If the API starts rejecting the body, this test FAILS rather than skipping.
   * That result would be good news — the backend closing the gap — but it changes
   * what the guard is for, so it has to be noticed, not swallowed.
   */
  it(
    'silently drops a ballot whose value exceeds maxValue (voteCount still counts it)',
    async () => {
      const admin = makeAdminClient()
      const voterClient = makeClient()
      const voting = new VotingClient({ client: voterClient })
      const step = (msg: string) => console.info(`[value-skew:malformed] ${msg}`)

      const org = await admin.organizations.createManaged({
        name: `skew-bad-${Date.now()}`,
        type: 'company',
      })
      const orgAddress = org.address
      const added = await admin.organizations.addMembers(
        orgAddress,
        VOTERS.map((memberNumber) => ({ memberNumber })),
      )
      if (added.jobId) {
        await admin.jobs.waitFor(added.jobId, {
          timeoutMs: 120000,
          intervalMs: 2000,
          expectType: 'org_members',
        })
      }
      const groups = await admin.organizations.listGroups(orgAddress)
      const groupId = groups.groups[0].id
      const census = await admin.census.create({ orgAddress, authFields: ['memberNumber'] })
      await admin.census.publishGroup(census.id, groupId, {
        authFields: ['memberNumber'],
        weighted: false,
      })

      // The malformed shape from #28: values 1/2/3 under maxValue 2. Posted raw,
      // for the reason in the docblock — `client.elections.create` refuses this
      // body locally, so going through it would prove nothing about the API. The
      // body is what `normalizeVotingProcessRequest` would have produced: plain
      // strings widened to `{ default: … }`, everything else passed through.
      const res = await fetch(`${API_URL}/processes`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          orgAddress,
          census: { authFields: ['memberNumber'], groupId },
          title: { default: 'malformed: values beyond maxValue' },
          endDate: new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
          questions: [
            {
              title: { default: 'values 1/2/3 under maxValue 2' },
              choices: VALUES.map((v) => ({ title: { default: `C${v}` }, value: v })),
              ballotProtocol: {
                maxCount: 1,
                maxValue: 2,
                maxTotalCost: 0,
                costExponent: 1,
                uniqueValues: false,
                maxVoteOverwrites: 0,
                costFromWeight: false,
              },
            },
          ],
        }),
      })
      const payload = await res.text()
      // A rejection here is a real result, not a reason to stop: it would mean the
      // backend has closed the gap and `uncastableChoicesReason` is no longer the
      // only thing standing between a creator and an unvotable election. Fail so
      // somebody re-reads the guard, instead of returning green on a claim the
      // test never got to make.
      expect(
        res.ok,
        `API REJECTED the malformed election (${res.status}): ${payload}\n` +
          'The premise of the uncastable-choices guard is that it does NOT. Re-check ' +
          'saas-backend VoteTypeFromQuestion before trusting either.',
      ).toBe(true)
      const draftId = (JSON.parse(payload) as { processId: string }).processId
      step(`API ACCEPTED the malformed election → ${draftId}`)
      await admin.elections.publishAndWait(draftId, { timeoutMs: 180000, intervalMs: 2000 })

      const info = await admin.elections.get(draftId)
      const question = info.questions[0]
      step(`ballotProtocol: ${JSON.stringify(question.ballotProtocol)}`)

      // Member 1 casts an in-range value (1) — must count.
      // Member 2 casts the unreachable value (3) — bypassing encodeQuestionBallot,
      // which is precisely what the guard exists to prevent.
      const cast = async (memberNumber: string, wireValue: number) => {
        const auth = await voterClient.elections.authStep0(draftId, { memberNumber })
        const check = await voterClient.elections.check(draftId, { authToken: auth.authToken! })
        const status = check.questions[0]
        const signer = new EphemeralSigner()
        const sign = await voterClient.elections.sign(draftId, {
          authToken: auth.authToken!,
          electionId: status.upstreamId!,
          payload: signer.address,
        })
        const jobId = await voting.vote({
          processId: status.upstreamId!,
          choices: [wireValue], // hand-rolled on purpose — no codec, no guard
          chainId: info.chainId!,
          signer,
          cspSignature: sign.signature!,
          cspWeight: sign.weight,
        })
        const job = await voterClient.jobs.waitFor(jobId, { timeoutMs: 90000, intervalMs: 2000 })
        step(`member ${memberNumber} → wire [${wireValue}] relay=${job.status}`)
        return job.status
      }

      // The relay accepting the out-of-range ballot is itself part of the finding:
      // nothing on the cast path objects.
      expect(await cast('1', 1)).toBe('completed')
      expect(await cast('2', 3)).toBe('completed')

      let results = await voterClient.elections.getResults(draftId)
      const deadline = Date.now() + 120000
      while ((results.questions[0]?.voteCount ?? 0) < 2 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 3000))
        results = await voterClient.elections.getResults(draftId)
      }
      const q = results.questions[0]
      step(`voteCount = ${q.voteCount}`)
      step(`raw matrix = ${JSON.stringify(q.results)}`)

      // Both envelopes counted…
      expect(q.voteCount, 'the chain did not accept both envelopes').toBe(2)

      // …but only the in-range one is in the tally. This is the silent loss.
      const decoded = decodeQuestionResults(question, q.results!)
      step(`decoded = ${decoded.map((c) => `${c.choice}=${c.votes}`).join('  ')}`)
      const counted = decoded.reduce((sum, c) => sum + c.votes, 0)
      step(`counted ${counted} of ${q.voteCount} envelopes`)

      expect(decoded.map((c) => [c.choice, c.votes])).toEqual([
        [1, 1], // in range → counted
        [2, 0],
        [3, 0], // above maxValue → dropped at tally, with no error anywhere
      ])
      expect(
        counted,
        'the out-of-range ballot was counted after all — refusing it at encode time would be wrong',
      ).toBeLessThan(q.voteCount!)
    },
    900000,
  )
})

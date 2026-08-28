import { http, HttpResponse } from 'msw'
import { server } from '../../../mocks/server'
import { VocdoniApiClient } from './client'

const BASE_URL = 'http://localhost'
const ORG = '0xorg'

describe('admin / integrator client methods', () => {
  let client: VocdoniApiClient

  beforeEach(() => {
    client = new VocdoniApiClient({ apiUrl: BASE_URL })
  })

  describe('organizations.createManaged', () => {
    it('POSTs to /integrator/organizations and returns the org', async () => {
      let body: unknown
      server.use(
        http.post(`${BASE_URL}/integrator/organizations`, async ({ request }) => {
          body = await request.json()
          return HttpResponse.json({ address: ORG, type: 'company' })
        }),
      )

      const org = await client.organizations.createManaged({ name: 'Acme Corp', type: 'company' })
      expect(org.address).toBe(ORG)
      expect(body).toEqual({ name: 'Acme Corp', type: 'company' })
    })
  })

  describe('organizations.addMembers', () => {
    it('wraps members in { members } and returns a job id', async () => {
      let body: unknown
      server.use(
        http.post(`${BASE_URL}/organizations/${ORG}/members`, async ({ request }) => {
          body = await request.json()
          return HttpResponse.json({ added: 0, jobId: 'mjob-1' })
        }),
      )

      const res = await client.organizations.addMembers(ORG, [
        { memberNumber: '1' },
        { memberNumber: '2' },
      ])
      expect(res.jobId).toBe('mjob-1')
      expect(body).toEqual({ members: [{ memberNumber: '1' }, { memberNumber: '2' }] })
    })
  })

  describe('jobs.waitFor (member-add job)', () => {
    it('polls GET /jobs/:jobId until the org_members job completes', async () => {
      let calls = 0
      server.use(
        http.get(`${BASE_URL}/jobs/mjob-1`, () => {
          calls += 1
          const done = calls >= 2
          return HttpResponse.json({
            jobId: 'mjob-1',
            type: 'org_members',
            status: done ? 'completed' : 'pending',
            result: { added: done ? 2 : 1, total: 2, progress: done ? 100 : 50 },
          })
        }),
      )

      const job = await client.jobs.waitFor('mjob-1', { intervalMs: 1 })
      expect(job.status).toBe('completed')
      expect(job.result?.progress).toBe(100)
      expect(calls).toBeGreaterThanOrEqual(2)
    })
  })

  describe('organizations.listGroups', () => {
    it('returns the groups list (autogroup first)', async () => {
      server.use(
        http.get(`${BASE_URL}/organizations/${ORG}/groups`, () =>
          HttpResponse.json({ groups: [{ id: 'g1', isAutoGroup: true, membersCount: 100 }] }),
        ),
      )

      const res = await client.organizations.listGroups(ORG)
      expect(res.groups[0].id).toBe('g1')
      expect(res.groups[0].isAutoGroup).toBe(true)
    })
  })

  describe('census.create + publishGroup', () => {
    it('creates an org census and publishes it from a group', async () => {
      let createBody: unknown
      let publishBody: unknown
      server.use(
        http.post(`${BASE_URL}/census`, async ({ request }) => {
          createBody = await request.json()
          return HttpResponse.json({ id: 'c1' })
        }),
        http.post(`${BASE_URL}/census/c1/group/g1/publish`, async ({ request }) => {
          publishBody = await request.json()
          return HttpResponse.json({ uri: 'ipfs://x', root: '0xroot', size: 100 })
        }),
      )

      const census = await client.census.create({ orgAddress: ORG, authFields: ['memberNumber'] })
      expect(census.id).toBe('c1')
      expect(createBody).toEqual({ orgAddress: ORG, authFields: ['memberNumber'] })

      const published = await client.census.publishGroup('c1', 'g1', { authFields: ['memberNumber'] })
      expect(published.root).toBe('0xroot')
      expect(publishBody).toEqual({ authFields: ['memberNumber'] })
    })
  })

  describe('elections.create', () => {
    it('POSTs a CreateVotingProcessRequest to /processes and returns the draft id string', async () => {
      let body: unknown
      server.use(
        http.post(`${BASE_URL}/processes`, async ({ request }) => {
          body = await request.json()
          return HttpResponse.json({ processId: 'draft-123' })
        }),
      )

      const draftId = await client.elections.create({
        orgAddress: ORG,
        title: 'Q',
        questions: [
          {
            title: 'Question?',
            choices: [{ title: 'Yes', value: 1 }],
            ballotProtocol: { maxCount: 1, maxValue: 1, maxVoteOverwrites: 0, costExponent: 1, maxTotalCost: 0, uniqueValues: false, costFromWeight: false },
          },
        ],
      })
      expect(draftId).toBe('draft-123')
      expect((body as { orgAddress: string }).orgAddress).toBe(ORG)
    })

    it('normalizes plain-string text to { default } language maps', async () => {
      let body: any
      server.use(
        http.post(`${BASE_URL}/processes`, async ({ request }) => {
          body = await request.json()
          return HttpResponse.json({ processId: 'draft-ml' })
        }),
      )

      await client.elections.create({
        orgAddress: ORG,
        title: 'Plain title',
        description: 'Plain description',
        questions: [
          {
            title: 'Question?',
            choices: [
              { title: 'No', value: 0 },
              { title: { default: 'Yes', es: 'Sí' }, value: 1 },
            ],
            ballotProtocol: { maxCount: 1, maxValue: 1, maxVoteOverwrites: 0, costExponent: 1, maxTotalCost: 0, uniqueValues: false, costFromWeight: false },
          },
        ],
      })

      // Plain strings become { default }, existing maps pass through untouched.
      expect(body.title).toEqual({ default: 'Plain title' })
      expect(body.description).toEqual({ default: 'Plain description' })
      expect(body.questions[0].title).toEqual({ default: 'Question?' })
      expect(body.questions[0].choices[0].title).toEqual({ default: 'No' })
      expect(body.questions[0].choices[1].title).toEqual({ default: 'Yes', es: 'Sí' })
    })

    describe('multichoice ballot config', () => {
      // The backend derives the dense 0/1 layout for `multichoice` but still maps
      // typeSetup.uniqueChoices onto the on-chain uniqueValues, which the
      // scrutinizer applies to raw field values — the combination discards every
      // ballot at tally. This is the config the two broken dev processes were
      // created with (4 choices, maxChoices 4, uniqueChoices true).
      const postDraft = () => {
        let body: any
        server.use(
          http.post(`${BASE_URL}/processes`, async ({ request }) => {
            body = await request.json()
            return HttpResponse.json({ processId: 'draft-mc' })
          }),
        )
        return () => body
      }

      const multichoiceDraft = (uniqueChoices: boolean) => ({
        orgAddress: ORG,
        title: 'MC',
        questions: [
          {
            title: 'Pick up to 4',
            choices: Array.from({ length: 4 }, (_, v) => ({ title: `C${v}`, value: v })),
            type: 'multichoice' as const,
            typeSetup: { minChoices: 0, maxChoices: 4, uniqueChoices },
          },
        ],
      })

      it('rejects typeSetup.uniqueChoices instead of silently rewriting it', async () => {
        // Rewriting it to false would swallow the 400 the backend returns for this
        // config, leaving the caller believing a rejected question was accepted.
        postDraft()
        await expect(client.elections.create(multichoiceDraft(true))).rejects.toThrow(
          /uniqueChoices is not supported for multichoice/,
        )
      })

      it('rejects it on update too, not just create', async () => {
        await expect(
          client.elections.update('draft-mc', multichoiceDraft(true)),
        ).rejects.toThrow(/uniqueChoices is not supported for multichoice/)
      })

      it('leaves the rest of typeSetup and an already-false flag untouched', async () => {
        const body = postDraft()
        await client.elections.create(multichoiceDraft(false))
        expect(body().questions[0].typeSetup).toEqual({
          minChoices: 0,
          maxChoices: 4,
          uniqueChoices: false,
        })
      })

      it('does not touch singlechoice typeSetup', async () => {
        const body = postDraft()
        await client.elections.create({
          orgAddress: ORG,
          title: 'SC',
          questions: [
            {
              title: 'Pick one',
              choices: [{ title: 'A', value: 0 }],
              type: 'singlechoice',
              typeSetup: { minChoices: 0, maxChoices: 0, uniqueChoices: true },
            },
          ],
        })
        expect(body().questions[0].typeSetup.uniqueChoices).toBe(true)
      })

      it('rejects an explicitly unsatisfiable ballotProtocol instead of creating a zero-tally election', async () => {
        await expect(
          client.elections.create({
            orgAddress: ORG,
            title: 'Broken',
            questions: [
              {
                title: 'Pick up to 4',
                choices: Array.from({ length: 4 }, (_, v) => ({ title: `C${v}`, value: v })),
                ballotProtocol: {
                  maxCount: 4,
                  maxValue: 1,
                  maxVoteOverwrites: 0,
                  costExponent: 1,
                  maxTotalCost: 4,
                  uniqueValues: true,
                  costFromWeight: false,
                },
              },
            ],
          }),
        ).rejects.toThrow(/Question 0: unsatisfiable ballotProtocol/)
      })

      it('rejects a ballotProtocol whose maxValue cannot reach every choice value', async () => {
        // integrator-sdk#28: choices published 1-indexed (1/2/3) under maxValue 2, so
        // C3 addresses a field value the chain refuses. The API accepts this shape —
        // confirmed live in integration/value-skew.itest.ts, where the resulting
        // election counted 2 envelopes and tallied 1. Stop it at creation, since after
        // publish the only remedy is a new election.
        await expect(
          client.elections.create({
            orgAddress: ORG,
            title: 'One-indexed',
            questions: [
              {
                title: 'Pick one',
                choices: [1, 2, 3].map((v) => ({ title: `C${v}`, value: v })),
                ballotProtocol: {
                  maxCount: 1,
                  maxValue: 2,
                  maxVoteOverwrites: 0,
                  costExponent: 1,
                  maxTotalCost: 0,
                  uniqueValues: false,
                  costFromWeight: false,
                },
              },
            ],
          }),
        ).rejects.toThrow(/Question 0: .*choice value\(s\) 3 exceed maxValue 2/)
      })

      it('accepts sparse choice values that still fit maxValue', async () => {
        // Gaps are legal — saas-backend derives maxValue from the highest value
        // precisely so {0,2,5} works, and the unused columns just stay empty.
        const body = postDraft()
        await client.elections.create({
          orgAddress: ORG,
          title: 'Sparse',
          questions: [
            {
              title: 'Pick one',
              choices: [0, 2, 5].map((v) => ({ title: `C${v}`, value: v })),
              ballotProtocol: {
                maxCount: 1,
                maxValue: 5,
                maxVoteOverwrites: 0,
                costExponent: 1,
                maxTotalCost: 0,
                uniqueValues: false,
                costFromWeight: false,
              },
            },
          ],
        })
        expect(body().questions[0].ballotProtocol.maxValue).toBe(5)
      })

      // The two below pin that creation resolves the ballot type from the *same* inputs
      // `encodeQuestionBallot` does. `metadata.type.name` is the second type source in
      // `inferQuestionBallotType`, ahead of every shape rule, and it is the only source
      // on this branch: `type` is stored empty for raw-`ballotProtocol` questions. Judge
      // by shape here and by name at encode time and the two disagree in both
      // directions — which is what makes this worth a test per direction rather than one.
      it('rejects by the legacy metadata name, not the shape it happens to resemble', async () => {
        // {maxCount: 2, maxValue: 1, uniqueValues: false} is the dense shape, and dense is
        // position-addressed, so by shape alone these values carry no constraint at all.
        // The legacy `multiple-choice` name says pick-slot, where value 5 collides with
        // the abstain sentinels at >= 2. `encodeQuestionBallot` reads the name and refuses;
        // creation must refuse too, or it publishes an election its own codec cannot vote.
        await expect(
          client.elections.create({
            orgAddress: ORG,
            title: 'Legacy pick-slot',
            questions: [
              {
                title: 'Pick some',
                choices: [0, 5].map((v) => ({ title: `C${v}`, value: v })),
                metadata: { type: { name: 'multiple-choice' } },
                ballotProtocol: {
                  maxCount: 2,
                  maxValue: 1,
                  maxVoteOverwrites: 0,
                  costExponent: 1,
                  maxTotalCost: 0,
                  uniqueValues: false,
                  costFromWeight: false,
                },
              },
            ],
          }),
        ).rejects.toThrow(/Question 0: .*exactly the set 0\.\.1 \(in any order\), but they are 0, 5/)
      })

      it('accepts by the legacy metadata name what the shape alone would reject', async () => {
        // By shape this is MultiChoice and non-dense, i.e. pick-slot, whose values must be
        // exactly 0..3 — so the gap at 3 would be refused. The legacy
        // `single-choice-multiquestion` name says single-choice, which is value-addressed
        // with a ceiling only: gaps are legal and every value clears maxValue 5. Refusing
        // it would block a draft the codec encodes and decodes correctly.
        const body = postDraft()
        await client.elections.create({
          orgAddress: ORG,
          title: 'Legacy multiquestion',
          questions: [
            {
              title: 'Pick one per question',
              choices: [0, 1, 2, 4].map((v) => ({ title: `C${v}`, value: v })),
              metadata: { type: { name: 'single-choice-multiquestion' } },
              ballotProtocol: {
                maxCount: 3,
                maxValue: 5,
                maxVoteOverwrites: 0,
                costExponent: 1,
                maxTotalCost: 0,
                uniqueValues: false,
                costFromWeight: false,
              },
            },
          ],
        })
        expect(body().questions[0].metadata).toEqual({ type: { name: 'single-choice-multiquestion' } })
      })

      it('accepts a dense ballotProtocol with uniqueValues false', async () => {
        const body = postDraft()
        await client.elections.create({
          orgAddress: ORG,
          title: 'Fine',
          questions: [
            {
              title: 'Pick up to 4',
              choices: Array.from({ length: 4 }, (_, v) => ({ title: `C${v}`, value: v })),
              ballotProtocol: {
                maxCount: 4,
                maxValue: 1,
                maxVoteOverwrites: 0,
                costExponent: 1,
                maxTotalCost: 4,
                uniqueValues: false,
                costFromWeight: false,
              },
            },
          ],
        })
        expect(body().questions[0].ballotProtocol.uniqueValues).toBe(false)
      })

      const rankedDraft = () => ({
        orgAddress: ORG,
        title: 'Dead ranking',
        questions: [
          {
            title: 'Rank them',
            choices: [0, 1, 2].map((v) => ({ title: `C${v}`, value: v })),
            metadata: { type: { name: 'ranked' } },
            ballotProtocol: {
              maxCount: 3,
              maxValue: 0,
              maxVoteOverwrites: 0,
              costExponent: 1,
              maxTotalCost: 0,
              uniqueValues: false,
              costFromWeight: false,
            },
          },
        ],
      })

      it('rejects a ranked question whose protocol can never produce a ranking', async () => {
        // maxValue 0 means "unbounded" for every other type, so the protocol-level rule
        // waves it through by design. For a declared ranking it is fatal: the chain
        // switches to discrete aggregation and every option tallies zero, which is
        // indistinguishable from nobody voting. Creation is the only moment it can be
        // fixed, so the *question*-level rule — the one that reads the declaration — has
        // to be the one that runs here.
        await expect(client.elections.create(rankedDraft())).rejects.toThrow(/Question 0: .*maxValue 0/)
      })

      it('rejects the dead ranking on update too, not just create', async () => {
        await expect(client.elections.update('draft-ranked', rankedDraft())).rejects.toThrow(
          /Question 0: .*maxValue 0/,
        )
      })

      it('rejects a ranked question whose choices share a value', async () => {
        // Every ballot for this question is well-formed, so no per-vote check can ever
        // catch it — but the decoded results key their rows by choice value, so two
        // options come back under one id. Creation is the only place it is fixable.
        await expect(
          client.elections.create({
            orgAddress: ORG,
            title: 'Ambiguous ranking',
            questions: [
              {
                title: 'Rank them',
                choices: [0, 1, 1].map((v, i) => ({ title: `C${i}`, value: v })),
                metadata: { type: { name: 'ranked' } },
                ballotProtocol: {
                  maxCount: 3,
                  maxValue: 2,
                  maxVoteOverwrites: 0,
                  costExponent: 1,
                  maxTotalCost: 0,
                  uniqueValues: true,
                  costFromWeight: false,
                },
              },
            ],
          }),
        ).rejects.toThrow(/Question 0: .*used by more than one choice/)
      })

      it('leaves the same protocol alone when nothing declares it ranked', async () => {
        // Undeclared this is a budget ballot, where maxValue 0 is exactly right — the
        // guard must key off the declaration, not the shape.
        const body = postDraft()
        const { metadata, ...question } = rankedDraft().questions[0]
        await client.elections.create({ orgAddress: ORG, title: 'Budget', questions: [question] })
        expect(body().questions[0].ballotProtocol.maxValue).toBe(0)
      })
    })
  })

  describe('elections.update', () => {
    it('PUTs the draft and resolves void (backend answers a bare 200 OK)', async () => {
      let body: any
      server.use(
        http.put(`${BASE_URL}/processes/draft-9`, async ({ request }) => {
          body = await request.json()
          // The real handler writes a bare "\n" text body, not JSON.
          return HttpResponse.text('\n', { status: 200 })
        }),
      )

      const res = await client.elections.update('draft-9', {
        orgAddress: ORG,
        title: 'Edited title',
        questions: [{ title: 'Q?', type: 'singlechoice', choices: [{ title: 'A', value: 0 }] }],
      })
      expect(res).toBeUndefined()
      expect(body.title).toEqual({ default: 'Edited title' })
      expect(body.questions[0].title).toEqual({ default: 'Q?' })
    })
  })

  describe('elections.delete', () => {
    it('DELETEs the new-model /processes/{id} route', async () => {
      let hit = false
      server.use(
        http.delete(`${BASE_URL}/processes/draft-9`, () => {
          hit = true
          return HttpResponse.text('\n', { status: 200 })
        }),
      )

      await expect(client.elections.delete('draft-9')).resolves.toBeUndefined()
      expect(hit).toBe(true)
    })
  })

  describe('elections.signInfo', () => {
    it('POSTs the auth token and returns the per-question consumed entries', async () => {
      let body: unknown
      server.use(
        http.post(`${BASE_URL}/processes/p1/sign-info`, async ({ request }) => {
          body = await request.json()
          return HttpResponse.json({
            consumed: [
              {
                questionId: 'q-0',
                upstreamId: 'deadbeef',
                address: 'aa'.repeat(20),
                nullifier: 'bb'.repeat(32),
                at: '2026-01-01T00:00:00Z',
              },
            ],
          })
        }),
      )

      const res = await client.elections.signInfo('p1', { authToken: 'tok-1' })
      expect(res.consumed).toHaveLength(1)
      expect(res.consumed[0].questionId).toBe('q-0')
      expect(body).toEqual({ authToken: 'tok-1' })
    })
  })

  describe('elections.validate', () => {
    it('GETs the /processes/{id}/validation dry-run route', async () => {
      server.use(
        http.get(`${BASE_URL}/processes/draft-5/validation`, () =>
          HttpResponse.json({ valid: false, errors: ['census is empty'] }),
        ),
      )

      const res = await client.elections.validate('draft-5')
      expect(res.valid).toBe(false)
      expect(res.errors).toEqual(['census is empty'])
    })
  })

  describe('elections.participants', () => {
    it('GETs the lookup with field/value query params and returns per-question voted status', async () => {
      let query: URLSearchParams | undefined
      server.use(
        http.get(`${BASE_URL}/processes/p1/participants`, ({ request }) => {
          query = new URL(request.url).searchParams
          return HttpResponse.json({
            participants: [
              {
                memberId: 'm-1',
                name: 'Ada',
                surname: 'Lovelace',
                memberNumber: '42',
                questions: [
                  { questionId: 'q-0', upstreamId: 'deadbeef', hasVoted: true },
                  { questionId: 'q-1', hasVoted: false },
                ],
              },
            ],
          })
        }),
      )

      const res = await client.elections.participants('p1', { field: 'memberNumber', value: '42' })
      expect(query?.get('field')).toBe('memberNumber')
      expect(query?.get('value')).toBe('42')
      expect(res.participants).toHaveLength(1)
      expect(res.participants[0].questions[0].hasVoted).toBe(true)
      expect(res.participants[0].questions[1].hasVoted).toBe(false)
    })
  })

  describe('elections.addCensusMembers', () => {
    it('PUTs { memberIds } to /processes/{id}/census and returns the added count + job', async () => {
      let body: unknown
      server.use(
        http.put(`${BASE_URL}/processes/p1/census`, async ({ request }) => {
          body = await request.json()
          return HttpResponse.json({ added: 2, jobId: 'cjob-1' })
        }),
      )

      const res = await client.elections.addCensusMembers('p1', ['m-1', 'm-2'])
      expect(res.added).toBe(2)
      expect(res.jobId).toBe('cjob-1')
      expect(body).toEqual({ memberIds: ['m-1', 'm-2'] })
    })
  })

  describe('elections.publishAndWait', () => {
    it('enqueues a publish job and resolves the on-chain address', async () => {
      server.use(
        http.post(`${BASE_URL}/processes/draft-1/publish`, () =>
          HttpResponse.json({ jobId: 'pjob-1' }),
        ),
        http.get(`${BASE_URL}/jobs/pjob-1`, () =>
          HttpResponse.json({
            jobId: 'pjob-1',
            status: 'completed',
            type: 'publish_process',
            result: { address: '0xonchain', status: 'READY' },
          }),
        ),
      )

      const res = await client.elections.publishAndWait('draft-1', { intervalMs: 1 })
      expect(res.address).toBe('0xonchain')
      expect(res.status).toBe('READY')
    })

    it('returns directly when the process is already published', async () => {
      server.use(
        http.post(`${BASE_URL}/processes/draft-2/publish`, () =>
          HttpResponse.json({ address: '0xalready', status: 'READY' }),
        ),
      )

      const res = await client.elections.publishAndWait('draft-2')
      expect(res.address).toBe('0xalready')
    })
  })

  describe('elections.setStatus', () => {
    it('PUTs the status and returns the enqueued job', async () => {
      let body: unknown
      server.use(
        http.put(`${BASE_URL}/process/p1/status`, async ({ request }) => {
          body = await request.json()
          return HttpResponse.json({ jobId: 'sjob-1' })
        }),
      )

      const res = await client.elections.setStatus('p1', { status: 'ended' })
      expect(res.jobId).toBe('sjob-1')
      expect(body).toEqual({ status: 'ended' })
    })
  })

})


describe('organizations API keys (integrator) + getIntegratorInfo', () => {
  let client: VocdoniApiClient

  beforeEach(() => {
    client = new VocdoniApiClient({ apiUrl: BASE_URL })
  })

  describe('organizations.listApiKeys', () => {
    it('GETs /integrator/organizations/:address/apikeys', async () => {
      let requestUrl = ''
      server.use(
        http.get(`${BASE_URL}/integrator/organizations/${ORG}/apikeys`, ({ request }) => {
          requestUrl = request.url
          return HttpResponse.json({ apiKeys: [{ id: 'k1', label: 'ci', prefix: 'vsk_ab', scopes: ['quota:read'], createdBy: 'u1', createdAt: '2026-01-01', revoked: false }] })
        }),
      )

      const res = await client.organizations.listApiKeys(ORG)
      expect(requestUrl).toBe(`${BASE_URL}/integrator/organizations/${ORG}/apikeys`)
      expect(res.apiKeys[0].id).toBe('k1')
    })
  })

  describe('organizations.createApiKey', () => {
    it('POSTs to /integrator/organizations/:address/apikeys and returns the one-time secret', async () => {
      let requestUrl = ''
      let body: unknown
      server.use(
        http.post(`${BASE_URL}/integrator/organizations/${ORG}/apikeys`, async ({ request }) => {
          requestUrl = request.url
          body = await request.json()
          return HttpResponse.json({
            id: 'k1',
            label: 'ci',
            prefix: 'vsk_ab',
            scopes: ['quota:read', 'managed:read'],
            createdBy: 'u1',
            createdAt: '2026-01-01',
            revoked: false,
            secret: 'vsk_abcdef',
          })
        }),
      )

      const res = await client.organizations.createApiKey(ORG, {
        label: 'ci',
        scopes: ['quota:read', 'managed:read'],
      })
      expect(requestUrl).toBe(`${BASE_URL}/integrator/organizations/${ORG}/apikeys`)
      expect(body).toEqual({ label: 'ci', scopes: ['quota:read', 'managed:read'] })
      expect(res.secret).toBe('vsk_abcdef')
    })
  })

  describe('organizations.revokeApiKey', () => {
    it('DELETEs /integrator/organizations/:address/apikeys/:keyId', async () => {
      let requestUrl = ''
      server.use(
        http.delete(`${BASE_URL}/integrator/organizations/${ORG}/apikeys/k1`, ({ request }) => {
          requestUrl = request.url
          return HttpResponse.json('revoked')
        }),
      )

      await client.organizations.revokeApiKey(ORG, 'k1')
      expect(requestUrl).toBe(`${BASE_URL}/integrator/organizations/${ORG}/apikeys/k1`)
    })
  })

  describe('organizations.getIntegratorInfo', () => {
    it('parses an enabled integrator with limits and usage', async () => {
      server.use(
        http.get(`${BASE_URL}/integrator`, () =>
          HttpResponse.json({
            enabled: true,
            limits: { maxManagedOrgs: 10, maxManagedProcesses: 100, maxVotes: 1000, maxSMS: 500, maxEmails: 500 },
            usage: { managedOrgs: 1, managedProcesses: 2, sentVotes: 3, sentSMS: 4, sentEmails: 5 },
          }),
        ),
      )

      const info = await client.organizations.getIntegratorInfo()
      expect(info.enabled).toBe(true)
      expect(info.limits).toEqual({
        maxManagedOrgs: 10,
        maxManagedProcesses: 100,
        maxVotes: 1000,
        maxSMS: 500,
        maxEmails: 500,
      })
      expect(info.usage).toEqual({
        managedOrgs: 1,
        managedProcesses: 2,
        sentVotes: 3,
        sentSMS: 4,
        sentEmails: 5,
      })
    })

    it('parses a non-integrator org: enabled false, limits omitted', async () => {
      server.use(
        http.get(`${BASE_URL}/integrator`, () =>
          HttpResponse.json({
            enabled: false,
            usage: { managedOrgs: 0, managedProcesses: 0, sentVotes: 0, sentSMS: 0, sentEmails: 0 },
          }),
        ),
      )

      const info = await client.organizations.getIntegratorInfo()
      expect(info.enabled).toBe(false)
      expect(info.limits).toBeUndefined()
      expect(info.usage).toEqual({
        managedOrgs: 0,
        managedProcesses: 0,
        sentVotes: 0,
        sentSMS: 0,
        sentEmails: 0,
      })
    })
  })
})

describe('workstream C: new methods and list fixes', () => {
  let client: VocdoniApiClient

  beforeEach(() => {
    client = new VocdoniApiClient({ apiUrl: BASE_URL })
  })

  describe('elections.validateCensus', () => {
    it('POSTs the org address + census spec and resolves the OK string', async () => {
      let body: unknown
      server.use(
        http.post(`${BASE_URL}/processes/census/validation`, async ({ request }) => {
          body = await request.json()
          return HttpResponse.json('OK')
        }),
      )

      const res = await client.elections.validateCensus({
        orgAddress: ORG,
        census: { authFields: ['memberNumber'], twoFaFields: ['email'] },
      })
      expect(res).toBe('OK')
      expect(body).toEqual({
        orgAddress: ORG,
        census: { authFields: ['memberNumber'], twoFaFields: ['email'] },
      })
    })

    it('throws with the offending member ids on 400 (duplicates/missing data)', async () => {
      server.use(
        http.post(`${BASE_URL}/processes/census/validation`, () =>
          HttpResponse.json({ error: 'invalid census', duplicates: ['m-1'] }, { status: 400 }),
        ),
      )

      await expect(
        client.elections.validateCensus({ orgAddress: ORG, census: { groupId: 'g1' } }),
      ).rejects.toThrow('invalid census')
    })
  })

  describe('organizations.addMembers', () => {
    it('sends async=true as a query param and returns the jobId to poll', async () => {
      let query: URLSearchParams | undefined
      let body: unknown
      server.use(
        http.post(`${BASE_URL}/organizations/${ORG}/members`, async ({ request }) => {
          query = new URL(request.url).searchParams
          body = await request.json()
          return HttpResponse.json({ added: 0, jobId: 'mjob-async-1' })
        }),
      )

      const res = await client.organizations.addMembers(ORG, [{ memberNumber: '1' }], { async: true })
      expect(query?.get('async')).toBe('true')
      expect(res.jobId).toBe('mjob-async-1')
      expect(body).toEqual({ members: [{ memberNumber: '1' }] })
    })
  })
})

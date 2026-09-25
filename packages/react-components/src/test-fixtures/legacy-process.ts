import type { VotingProcessResponse } from '@vocdoni/api-types'

/**
 * A legacy vochain election exactly as the SaaS API serves it through `GET /processes`
 * (saas-backend #698): a read-only projection whose question carries an empty `type`,
 * no `ballotProtocol` and no `metadata`, so no ballot type can be inferred from it.
 *
 * Verbatim from `GET https://saas-api-lts.vocdoni.net/processes?orgAddress=0x08e42f4f97f32930c3e579f53494304a3aca365c`
 * (process 690e1e8b2035563c86664907, fetched 2026-09-25). On chain it is a legacy
 * `multiple-choice` election, but nothing in this payload says so.
 *
 * Cast because the payload breaks the declared type: `ballotProtocol` is required there.
 */
export const legacyProjectedProcess = {
  id: '690e1e8b2035563c86664907',
  orgAddress: '08e42f4f97f32930c3e579f53494304a3aca365c',
  published: true,
  census: {
    weighted: false,
    authFields: ['name', 'surname'],
    groupId: '690e1e7c2035563c86664905',
    size: 4,
    totalWeight: 4,
  },
  title: {
    default: 'Tria on destinar els fons per a les obres',
  },
  description: {
    default: '',
  },
  startDate: '2025-11-07T16:30:03Z',
  endDate: '2025-11-10T21:22:03Z',
  questions: [
    {
      id: '33a0c93b068faee308277157',
      parentProcessId: '690e1e8b2035563c86664907',
      title: {
        default: 'Quins dels següents projectes voldries que es duguessin a terme?',
      },
      description: {
        default: '',
      },
      choices: [
        {
          title: {
            default: 'Teular el garatge',
          },
          value: 0,
        },
        {
          title: {
            default: 'Teular la casa sencera',
          },
          value: 1,
        },
        {
          title: {
            default: 'Pagar la hipoteca',
          },
          value: 2,
        },
      ],
      type: '',
      typeSetup: {
        minChoices: 0,
        maxChoices: 0,
        uniqueChoices: false,
        budget: 0,
        costExponent: 0,
      },
      secretUntilTheEnd: true,
      upstreamId: '6b342d99f21808e42f4f97f32930c3e579f53494304a3aca365c030c00000001',
      status: 'RESULTS',
      results: {
        voteCount: 0,
        maxVoters: 1,
        finalResults: true,
        results: [
          ['0', '0', '0'],
          ['0', '0', '0'],
          ['0', '0', '0'],
        ],
      },
    },
  ],
  chainId: 'vocdoni/LTS/1.2',
  legacy: true,
} as unknown as VotingProcessResponse

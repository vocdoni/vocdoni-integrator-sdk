import { ApiErrorCode, type ApiErrorDataByCode } from '@vocdoni/api-types'
import { http, HttpResponse } from 'msw'
import { server } from '../../../mocks/server'
import { VocdoniApiClient } from './client'
import { isApiError } from './errors'

const BASE_URL = 'http://localhost'
const ORG = '0xorg'
const PROCESS_ID = 'proc-1'

describe('typed backend error codes and data', () => {
  let client: VocdoniApiClient

  beforeEach(() => {
    client = new VocdoniApiClient({ apiUrl: BASE_URL })
  })

  it('keeps the numeric values of the CSP voter and census error codes', () => {
    expect(ApiErrorCode.CensusParticipantNotFound).toBe(40029)
    expect(ApiErrorCode.CspAuthFailed).toBe(40802)
    expect(ApiErrorCode.VerificationMaxAttempts).toBe(40017)
    expect(ApiErrorCode.AttemptCooldown).toBe(40103)
    expect(ApiErrorCode.ZeroWeightVoter).toBe(40801)
    expect(ApiErrorCode.InvalidData).toBe(40037)
  })

  it('narrows a census-validation 400 to CensusValidationErrorData', async () => {
    server.use(
      http.post(`${BASE_URL}/processes/census/validation`, () =>
        HttpResponse.json(
          {
            error: 'invalid census',
            code: ApiErrorCode.InvalidData,
            data: { memberIds: ['m-2'], duplicates: ['m-1'], missingData: null, notFound: null },
          },
          { status: 400 },
        ),
      ),
    )

    const err = await client.elections
      .validateCensus({ orgAddress: ORG, census: { groupId: 'g1' } })
      .catch((e: unknown) => e)

    expect(isApiError(err, ApiErrorCode.InvalidData)).toBe(true)
    if (isApiError(err, ApiErrorCode.InvalidData)) {
      const duplicates: string[] | null | undefined = err.data?.duplicates
      expect(duplicates).toEqual(['m-1'])
      expect(err.data?.missingData).toBeNull()
      expect(err.data?.notFound).toBeNull()
    }
  })

  it('narrows a 40017 rate-limit error and reads retryAfter in seconds', async () => {
    server.use(
      http.post(`${BASE_URL}/processes/${PROCESS_ID}/auth/0`, () =>
        HttpResponse.json(
          {
            error: 'too many verification attempts',
            code: ApiErrorCode.VerificationMaxAttempts,
            data: { retryAfter: 30 },
          },
          { status: 400 },
        ),
      ),
    )

    const err = await client.elections
      .authStep0(PROCESS_ID, { memberNumber: '42' })
      .catch((e: unknown) => e)

    expect(isApiError(err, ApiErrorCode.VerificationMaxAttempts)).toBe(true)
    if (isApiError(err, ApiErrorCode.VerificationMaxAttempts)) {
      expect(err.data?.retryAfter).toBe(30)
    }
  })

  it('narrows a 40103 cooldown error and reads coolDownTime in milliseconds', async () => {
    server.use(
      http.post(`${BASE_URL}/processes/${PROCESS_ID}/auth/0`, () =>
        HttpResponse.json(
          { error: 'cooldown', code: ApiErrorCode.AttemptCooldown, data: { coolDownTime: 5000 } },
          { status: 401 },
        ),
      ),
    )

    const err = await client.elections
      .authStep0(PROCESS_ID, { memberNumber: '42' })
      .catch((e: unknown) => e)

    expect(isApiError(err, ApiErrorCode.AttemptCooldown)).toBe(true)
    if (isApiError(err, ApiErrorCode.AttemptCooldown)) {
      expect(err.data?.coolDownTime).toBe(5000)
    }
  })

  it('types the 40017 and 40037 data as optional, for answers that carry none', () => {
    const rateLimited: ApiErrorDataByCode[40017] = undefined
    const invalidData: ApiErrorDataByCode[40037] = undefined
    expect(rateLimited).toBeUndefined()
    expect(invalidData).toBeUndefined()
  })
})

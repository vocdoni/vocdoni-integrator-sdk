import { VocdoniApiError } from '@vocdoni/api-client'
import { describe, expect, it } from 'vitest'
import { CspCooldownError, translateCspAuthError, type CspAuthErrorStep, type CspAuthTranslate } from './errors'

// Echoes the key and its count, so each assertion names the message branch it reached.
const t: CspAuthTranslate = (key, substitutions) =>
  substitutions?.count === undefined ? key : `${key}:${String(substitutions.count)}`

const apiError = (code: number, body: unknown = { code }) => new VocdoniApiError(400, body, 'api failed', code)

const retryBody = (retryAfter: number) => ({ code: 40017, data: { retryAfter } })
const coolDownBody = (coolDownTime: number) => ({ code: 40103, data: { coolDownTime } })

const options = (hasPassword = false, step: CspAuthErrorStep = 'identify') => ({ step, hasPassword })

describe('translateCspAuthError', () => {
  it.each([40029, 40802])('maps %i to the participant-not-found message', (code) => {
    expect(translateCspAuthError(apiError(code), t, options()).message).toBe('csp.errors.participant_not_found')
  })

  it.each([40029, 40802])('maps %i to the password-aware message when the census has a password', (code) => {
    expect(translateCspAuthError(apiError(code), t, options(true)).message).toBe('csp.errors.credentials_or_password_incorrect')
  })

  it('maps 40103 to a CspCooldownError with the cooldown message', () => {
    const result = translateCspAuthError(apiError(40103), t, options())
    expect(result).toBeInstanceOf(CspCooldownError)
    expect(result.message).toBe('csp.errors.requests_on_cooldown')
  })

  it('reads coolDownTime (ms) from the 40103 body into the CspCooldownError', () => {
    const result = translateCspAuthError(apiError(40103, coolDownBody(45000)), t, options())
    expect(result).toBeInstanceOf(CspCooldownError)
    expect((result as CspCooldownError).coolDownMs).toBe(45000)
  })

  it('defaults coolDownMs to 0 when the 40103 body has no coolDownTime', () => {
    const result = translateCspAuthError(apiError(40103), t, options())
    expect((result as CspCooldownError).coolDownMs).toBe(0)
  })

  it('defaults coolDownMs to 0 when coolDownTime is not positive', () => {
    const result = translateCspAuthError(apiError(40103, { code: 40103, data: { coolDownTime: 0 } }), t, options())
    expect((result as CspCooldownError).coolDownMs).toBe(0)
  })

  it('maps 40801 to the zero voting weight message', () => {
    expect(translateCspAuthError(apiError(40801), t, options()).message).toBe('csp.errors.zero_voting_weight')
  })

  it('maps 40017 without a retryAfter to the generic too-many-attempts message', () => {
    expect(translateCspAuthError(apiError(40017, { code: 40017 }), t, options()).message).toBe(
      'csp.errors.too_many_attempts',
    )
  })

  it('ignores a non-positive retryAfter', () => {
    expect(translateCspAuthError(apiError(40017, retryBody(0)), t, options()).message).toBe('csp.errors.too_many_attempts')
  })

  it('rounds a retryAfter under an hour up to whole minutes, at least one', () => {
    expect(translateCspAuthError(apiError(40017, retryBody(90)), t, options()).message).toBe(
      'csp.errors.too_many_attempts_minutes:2',
    )
    expect(translateCspAuthError(apiError(40017, retryBody(5)), t, options()).message).toBe(
      'csp.errors.too_many_attempts_minutes:1',
    )
  })

  it('rounds a retryAfter of an hour or more up to whole hours', () => {
    expect(translateCspAuthError(apiError(40017, retryBody(3600)), t, options()).message).toBe(
      'csp.errors.too_many_attempts_hours:1',
    )
    expect(translateCspAuthError(apiError(40017, retryBody(3601)), t, options()).message).toBe(
      'csp.errors.too_many_attempts_hours:2',
    )
  })

  it('maps 40017 without a retryAfter on a resend to the resend-limit message', () => {
    expect(translateCspAuthError(apiError(40017, { code: 40017 }), t, options(false, 'resend')).message).toBe(
      'csp.errors.resend_limit',
    )
  })

  it('keeps the rate-limit wait time for a resend that carries a retryAfter', () => {
    expect(translateCspAuthError(apiError(40017, retryBody(300)), t, options(false, 'resend')).message).toBe(
      'csp.errors.too_many_attempts_minutes:5',
    )
  })

  it('maps 40001 on the code step to the code-rejected message', () => {
    expect(translateCspAuthError(apiError(40001), t, options(false, 'code')).message).toBe('csp.errors.code_rejected')
  })

  it('maps 40001 on a resend to the expired-code message', () => {
    expect(translateCspAuthError(apiError(40001), t, options(false, 'resend')).message).toBe('csp.errors.resend_expired')
  })

  it('maps 40001 on the identify step to the unavailable message', () => {
    expect(translateCspAuthError(apiError(40001), t, options(false, 'identify')).message).toBe(
      'csp.errors.identify_unavailable',
    )
  })

  it('maps 40005 on the identify step to the missing-data message', () => {
    expect(translateCspAuthError(apiError(40005), t, options()).message).toBe('csp.errors.missing_data')
  })

  it('keeps 40005 unmapped on the code step', () => {
    const error = apiError(40005)
    expect(translateCspAuthError(error, t, options(false, 'code'))).toBe(error)
  })

  it('keeps the message of an unmapped API error', () => {
    const error = apiError(50000)
    expect(translateCspAuthError(error, t, options())).toBe(error)
  })

  it('keeps a plain Error as it is', () => {
    const error = new Error('network down')
    expect(translateCspAuthError(error, t, options())).toBe(error)
  })

  it('wraps a non-Error rejection in an Error', () => {
    expect(translateCspAuthError('boom', t, options()).message).toBe('boom')
  })
})

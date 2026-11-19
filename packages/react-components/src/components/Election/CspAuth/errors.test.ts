import { VocdoniApiError } from '@vocdoni/api-client'
import { describe, expect, it } from 'vitest'
import { translateCspAuthError, type CspAuthTranslate } from './errors'

// Echoes the key and its count, so each assertion names the message branch it reached.
const t: CspAuthTranslate = (key, substitutions) =>
  substitutions?.count === undefined ? key : `${key}:${String(substitutions.count)}`

const apiError = (code: number, body: unknown = { code }) => new VocdoniApiError(400, body, 'api failed', code)

const retryBody = (retryAfter: number) => ({ code: 40017, data: { retryAfter } })

describe('translateCspAuthError', () => {
  it.each([40029, 40802])('maps %i to the participant-not-found message', (code) => {
    expect(translateCspAuthError(apiError(code), t, false).message).toBe('csp.errors.participant_not_found')
  })

  it.each([40029, 40802])('maps %i to the password-aware message when the census has a password', (code) => {
    expect(translateCspAuthError(apiError(code), t, true).message).toBe('csp.errors.credentials_or_password_incorrect')
  })

  it('maps 40103 to the cooldown message', () => {
    expect(translateCspAuthError(apiError(40103), t, false).message).toBe('csp.errors.requests_on_cooldown')
  })

  it('maps 40801 to the zero voting weight message', () => {
    expect(translateCspAuthError(apiError(40801), t, false).message).toBe('csp.errors.zero_voting_weight')
  })

  it('maps 40017 without a retryAfter to the generic too-many-attempts message', () => {
    expect(translateCspAuthError(apiError(40017, { code: 40017 }), t, false).message).toBe(
      'csp.errors.too_many_attempts',
    )
  })

  it('ignores a non-positive retryAfter', () => {
    expect(translateCspAuthError(apiError(40017, retryBody(0)), t, false).message).toBe('csp.errors.too_many_attempts')
  })

  it('rounds a retryAfter under an hour up to whole minutes, at least one', () => {
    expect(translateCspAuthError(apiError(40017, retryBody(90)), t, false).message).toBe(
      'csp.errors.too_many_attempts_minutes:2',
    )
    expect(translateCspAuthError(apiError(40017, retryBody(5)), t, false).message).toBe(
      'csp.errors.too_many_attempts_minutes:1',
    )
  })

  it('rounds a retryAfter of an hour or more up to whole hours', () => {
    expect(translateCspAuthError(apiError(40017, retryBody(3600)), t, false).message).toBe(
      'csp.errors.too_many_attempts_hours:1',
    )
    expect(translateCspAuthError(apiError(40017, retryBody(3601)), t, false).message).toBe(
      'csp.errors.too_many_attempts_hours:2',
    )
  })

  it('keeps the message of an unmapped API error', () => {
    const error = apiError(50000)
    expect(translateCspAuthError(error, t, false)).toBe(error)
  })

  it('keeps a plain Error as it is', () => {
    const error = new Error('network down')
    expect(translateCspAuthError(error, t, false)).toBe(error)
  })

  it('wraps a non-Error rejection in an Error', () => {
    expect(translateCspAuthError('boom', t, false).message).toBe('boom')
  })
})

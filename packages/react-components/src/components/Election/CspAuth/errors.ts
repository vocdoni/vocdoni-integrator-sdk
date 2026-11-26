import { VocdoniApiError } from '@vocdoni/api-client'

export type CspAuthTranslate = (key: string, substitutions?: Record<string, unknown>) => string

/** The request that failed: step 0 (identify), step 1 (the one-time code) or a resend. */
export type CspAuthErrorStep = 'identify' | 'code' | 'resend'

/**
 * Thrown when the server enforces a resend cooldown (40103). Carries `coolDownMs` so the UI can
 * start a countdown without hardcoding the duration.
 */
export class CspCooldownError extends Error {
  coolDownMs: number

  constructor(message: string, coolDownMs: number) {
    super(message)
    this.name = 'CspCooldownError'
    this.coolDownMs = coolDownMs
  }
}

// Seconds until a rate-limited voter may retry, from the 40017 body's `data.retryAfter`.
const retryAfterSeconds = (body: unknown): number | undefined => {
  if (typeof body !== 'object' || body === null || !('data' in body)) return undefined
  const { data } = body
  if (typeof data !== 'object' || data === null || !('retryAfter' in data)) return undefined
  const { retryAfter } = data
  return typeof retryAfter === 'number' && retryAfter > 0 ? retryAfter : undefined
}

// Milliseconds remaining in the resend cooldown, from the 40103 body's `data.coolDownTime`.
const coolDownMsFromBody = (body: unknown): number | undefined => {
  if (typeof body !== 'object' || body === null || !('data' in body)) return undefined
  const { data } = body
  if (typeof data !== 'object' || data === null || !('coolDownTime' in data)) return undefined
  const { coolDownTime } = data
  return typeof coolDownTime === 'number' && coolDownTime > 0 ? coolDownTime : undefined
}

// Maps the SaaS CSP auth error codes to voter-facing messages. Any other failure keeps its own message.
export const translateCspAuthError = (
  error: unknown,
  t: CspAuthTranslate,
  { step, hasPassword }: { step: CspAuthErrorStep; hasPassword: boolean }
): Error => {
  if (error instanceof VocdoniApiError) {
    switch (error.code) {
      // 40802 covers both an unknown participant and a contact mismatch; older backends send 40029.
      case 40029:
      case 40802:
        // A wrong password answers like an unknown participant, so with a password the message
        // must not single out either.
        return new Error(
          hasPassword ? t('csp.errors.credentials_or_password_incorrect') : t('csp.errors.participant_not_found')
        )
      case 40001:
        // Wrong code, expired token, or too many attempts (sibling killed by a successful verify).
        // A resend sees the token as gone for good.
        if (step === 'code') return new Error(t('csp.errors.code_rejected'))
        if (step === 'resend') return new Error(t('csp.errors.resend_expired'))
        // On the identify step this is a backend storage or notification failure.
        if (step === 'identify') return new Error(t('csp.errors.identify_unavailable'))
        break
      case 40005:
        // Required auth data is missing: the identify step only.
        if (step === 'identify') return new Error(t('csp.errors.missing_data'))
        break
      case 40017: {
        const retryAfter = retryAfterSeconds(error.body)
        // A resend without a retryAfter has hit the per-code resend cap: the code is still valid.
        if (retryAfter === undefined) {
          return new Error(t(step === 'resend' ? 'csp.errors.resend_limit' : 'csp.errors.too_many_attempts'))
        }
        if (retryAfter < 3600) {
          const count = Math.max(1, Math.ceil(retryAfter / 60))
          return new Error(t('csp.errors.too_many_attempts_minutes', { count }))
        }
        return new Error(t('csp.errors.too_many_attempts_hours', { count: Math.ceil(retryAfter / 3600) }))
      }
      case 40103: {
        const ms = coolDownMsFromBody(error.body)
        return new CspCooldownError(t('csp.errors.requests_on_cooldown'), ms ?? 0)
      }
      case 40801:
        return new Error(t('csp.errors.zero_voting_weight'))
    }
  }

  return error instanceof Error ? error : new Error(String(error))
}

import { VocdoniApiError } from '@vocdoni/api-client'

export type CspAuthTranslate = (key: string, substitutions?: Record<string, unknown>) => string

// Seconds until a rate-limited voter may retry, from the 40017 body's `data.retryAfter`.
const retryAfterSeconds = (body: unknown): number | undefined => {
  if (typeof body !== 'object' || body === null || !('data' in body)) return undefined
  const { data } = body
  if (typeof data !== 'object' || data === null || !('retryAfter' in data)) return undefined
  const { retryAfter } = data
  return typeof retryAfter === 'number' && retryAfter > 0 ? retryAfter : undefined
}

// Maps the SaaS CSP auth error codes to voter-facing messages. Any other failure keeps its own message.
export const translateCspAuthError = (error: unknown, t: CspAuthTranslate, hasPassword: boolean): Error => {
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
      case 40017: {
        const retryAfter = retryAfterSeconds(error.body)
        if (retryAfter === undefined) return new Error(t('csp.errors.too_many_attempts'))
        if (retryAfter < 3600) {
          const count = Math.max(1, Math.ceil(retryAfter / 60))
          return new Error(t('csp.errors.too_many_attempts_minutes', { count }))
        }
        return new Error(t('csp.errors.too_many_attempts_hours', { count: Math.ceil(retryAfter / 3600) }))
      }
      case 40103:
        return new Error(t('csp.errors.requests_on_cooldown'))
      case 40801:
        return new Error(t('csp.errors.zero_voting_weight'))
    }
  }

  return error instanceof Error ? error : new Error(String(error))
}

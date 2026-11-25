import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query'
import type { AuthRequest } from '@vocdoni/api-types'
import { useElectionAuth } from '@vocdoni/react-providers'
import { useReactComponentsLocalize } from '../../../i18n/localize'
import { useOptionalCspAuthSession } from './CspAuthSession'
import { type CspAuthErrorStep, translateCspAuthError } from './errors'

// Every auth request shares this key prefix, so an in-flight request outlives the dialog that sent it:
// closing the modal unmounts the step (and its mutation observer), not the request.
// The session id is part of the key, so a request in one session does not mark another busy. The process is not:
// a request still in flight for the previous process keeps the session busy until it settles.
const cspAuthMutationKey = (session?: { sessionId: string }) => ['vocdoni', 'csp-auth', session?.sessionId]

const useCspAuthErrorTranslator = (step: CspAuthErrorStep) => {
  const t = useReactComponentsLocalize()
  const hasPassword = !!useOptionalCspAuthSession()?.authFields.includes('password')
  return (error: unknown) => translateCspAuthError(error, t, { step, hasPassword })
}

/** The shape auth0 and resend return on success. */
export type CspAuthStepResult = { coolDownTime?: number }

// Step 0: identify the participant. For auth-only censuses the provider is connected right after.
export const useCspAuth0 = () => {
  const { auth0 } = useElectionAuth()
  const session = useOptionalCspAuthSession()
  const translateError = useCspAuthErrorTranslator('identify')

  return useMutation<CspAuthStepResult, Error, AuthRequest>({
    mutationKey: [...cspAuthMutationKey(session), 0],
    // Never retried, whatever the app's defaults: a retried identify or code burns the voter's attempt budget.
    retry: false,
    mutationFn: async (participant) => {
      try {
        return (await auth0(participant)) ?? {}
      } catch (error) {
        throw translateError(error)
      }
    },
  })
}

// Step 1: confirm the one-time code; marks the voter connected.
export const useCspAuth1 = () => {
  const { auth1 } = useElectionAuth()
  const session = useOptionalCspAuthSession()
  const translateError = useCspAuthErrorTranslator('code')

  return useMutation<void, Error, string>({
    mutationKey: [...cspAuthMutationKey(session), 1],
    retry: false,
    mutationFn: async (code) => {
      try {
        await auth1(code)
      } catch (error) {
        throw translateError(error)
      }
    },
  })
}

export const useCspResend = () => {
  const { resend } = useElectionAuth()
  const session = useOptionalCspAuthSession()
  const translateError = useCspAuthErrorTranslator('resend')

  return useMutation<CspAuthStepResult, Error, { email?: string; phone?: string }>({
    mutationKey: [...cspAuthMutationKey(session), 'resend'],
    retry: false,
    mutationFn: async (contact) => {
      try {
        return (await resend(contact)) ?? {}
      } catch (error) {
        throw translateError(error)
      }
    },
  })
}

// True while any auth request (identify, code or resend) of this session is in flight, whichever dialog sent it.
export const useCspAuthPending = () => {
  const session = useOptionalCspAuthSession()
  return useIsMutating({ mutationKey: cspAuthMutationKey(session) }) > 0
}

// The same check read at call time: a handler such as the code auto-submit can run before
// the render that would show a request just sent.
export const useIsCspAuthBusy = () => {
  const client = useQueryClient()
  const session = useOptionalCspAuthSession()
  return () => client.isMutating({ mutationKey: cspAuthMutationKey(session) }) > 0
}

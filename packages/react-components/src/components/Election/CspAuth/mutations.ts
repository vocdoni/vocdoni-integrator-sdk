import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query'
import type { AuthRequest } from '@vocdoni/api-types'
import { useElectionAuth } from '@vocdoni/react-providers'
import { useReactComponentsLocalize } from '../../../i18n/localize'
import { useOptionalCspAuthSession } from './CspAuthSession'
import { translateCspAuthError } from './errors'

// Every auth request shares this key prefix, so an in-flight request outlives the dialog that sent it:
// closing the modal unmounts the step (and its mutation observer), not the request.
const cspAuthMutationKey = ['vocdoni', 'csp-auth']

const useCspAuthErrorTranslator = () => {
  const t = useReactComponentsLocalize()
  const hasPassword = !!useOptionalCspAuthSession()?.authFields.includes('password')
  return (error: unknown) => translateCspAuthError(error, t, hasPassword)
}

// Step 0: identify the participant. For auth-only censuses the provider is connected right after.
export const useCspAuth0 = () => {
  const { auth0 } = useElectionAuth()
  const translateError = useCspAuthErrorTranslator()

  return useMutation<void, Error, AuthRequest>({
    mutationKey: [...cspAuthMutationKey, 0],
    mutationFn: async (participant) => {
      try {
        await auth0(participant)
      } catch (error) {
        throw translateError(error)
      }
    },
  })
}

// Step 1: confirm the one-time code; marks the voter connected.
export const useCspAuth1 = () => {
  const { auth1 } = useElectionAuth()
  const translateError = useCspAuthErrorTranslator()

  return useMutation<void, Error, string>({
    mutationKey: [...cspAuthMutationKey, 1],
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
  const translateError = useCspAuthErrorTranslator()

  return useMutation<void, Error, { email?: string; phone?: string }>({
    mutationKey: [...cspAuthMutationKey, 'resend'],
    mutationFn: async (contact) => {
      try {
        await resend(contact)
      } catch (error) {
        throw translateError(error)
      }
    },
  })
}

// True while any auth request (identify, code or resend) is in flight, whichever dialog sent it.
export const useCspAuthPending = () => useIsMutating({ mutationKey: cspAuthMutationKey }) > 0

// The same check read at call time: a handler such as the code auto-submit can run before
// the render that would show a request just sent.
export const useIsCspAuthBusy = () => {
  const client = useQueryClient()
  return () => client.isMutating({ mutationKey: cspAuthMutationKey }) > 0
}

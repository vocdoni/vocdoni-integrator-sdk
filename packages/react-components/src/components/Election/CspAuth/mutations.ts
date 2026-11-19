import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query'
import type { AuthRequest } from '@vocdoni/api-types'
import { useElectionAuth } from '@vocdoni/react-providers'
import { useReactComponentsLocalize } from '../../../i18n/localize'
import { useOptionalCspAuthSession } from './CspAuthSession'
import { type CspAuthErrorStep, translateCspAuthError } from './errors'

// Every auth request shares this key prefix, so an in-flight request outlives the dialog that sent it:
// closing the modal unmounts the step (and its mutation observer), not the request.
// The process id is part of the key, so a request on one process does not mark another process' flow busy.
const cspAuthMutationKey = (processId?: string) => ['vocdoni', 'csp-auth', processId]

const useCspAuthErrorTranslator = (step: CspAuthErrorStep) => {
  const t = useReactComponentsLocalize()
  const hasPassword = !!useOptionalCspAuthSession()?.authFields.includes('password')
  return (error: unknown) => translateCspAuthError(error, t, { step, hasPassword })
}

// Step 0: identify the participant. For auth-only censuses the provider is connected right after.
export const useCspAuth0 = () => {
  const { auth0 } = useElectionAuth()
  const processId = useOptionalCspAuthSession()?.processId
  const translateError = useCspAuthErrorTranslator('identify')

  return useMutation<void, Error, AuthRequest>({
    mutationKey: [...cspAuthMutationKey(processId), 0],
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
  const processId = useOptionalCspAuthSession()?.processId
  const translateError = useCspAuthErrorTranslator('code')

  return useMutation<void, Error, string>({
    mutationKey: [...cspAuthMutationKey(processId), 1],
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
  const processId = useOptionalCspAuthSession()?.processId
  const translateError = useCspAuthErrorTranslator('resend')

  return useMutation<void, Error, { email?: string; phone?: string }>({
    mutationKey: [...cspAuthMutationKey(processId), 'resend'],
    mutationFn: async (contact) => {
      try {
        await resend(contact)
      } catch (error) {
        throw translateError(error)
      }
    },
  })
}

// True while any auth request (identify, code or resend) on this process is in flight, whichever dialog sent it.
export const useCspAuthPending = () => {
  const processId = useOptionalCspAuthSession()?.processId
  return useIsMutating({ mutationKey: cspAuthMutationKey(processId) }) > 0
}

// The same check read at call time: a handler such as the code auto-submit can run before
// the render that would show a request just sent.
export const useIsCspAuthBusy = () => {
  const client = useQueryClient()
  const processId = useOptionalCspAuthSession()?.processId
  return () => client.isMutating({ mutationKey: cspAuthMutationKey(processId) }) > 0
}

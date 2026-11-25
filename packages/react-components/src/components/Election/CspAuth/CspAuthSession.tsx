import type { OrgMemberAuthField, OrgMemberTwoFaField } from '@vocdoni/api-types'
import { useElection, useElectionAuth } from '@vocdoni/react-providers'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'

/** The contact the one-time code was sent to, kept so step 1 can resend it. */
export type CspAuthContact = {
  email?: string
  phone?: string
}

export type CspAuthStep = 0 | 1

export type CspAuthSessionValue = {
  /** 0: identify, 1: enter the one-time code. */
  currentStep: CspAuthStep
  setCurrentStep: (step: CspAuthStep) => void
  contact: CspAuthContact
  setContact: (contact: CspAuthContact) => void
  /**
   * The i18n key of a notice for the code step, set once by the identify step when the code is sent.
   * The code step shows it on its first mount and clears it, so reopening the dialog does not repeat it.
   */
  pendingNotice?: string
  setPendingNotice: (key?: string) => void
  /** The last step error. Kept here, not in the step, so a request that fails after the dialog closed still shows. */
  error?: string
  setError: (message?: string) => void
  /** The current flow generation: `resetFlow` bumps it, so a request that settles after a reset can tell it is stale. */
  getFlowGeneration: () => number
  authFields: OrgMemberAuthField[]
  twoFaFields: OrgMemberTwoFaField[]
  /** The process this flow authenticates against. */
  processId?: string
  /** Unique per session: keys the auth requests, so a request under another session does not mark this flow busy. */
  sessionId: string
  /**
   * The `clear` of the ElectionProvider this session belongs to. It is stable per provider instance,
   * so it tells apart two providers for the same process.
   */
  providerClear: () => void
  /** Back to step 0 with no stored contact, and no error. */
  resetFlow: () => void
  /**
   * Unix timestamp (ms) when the resend button becomes available again. Set from the server's
   * `coolDownTime` field on step-0 and resend success responses, and on a 40103 refusal. Cleared on reset.
   */
  resendAvailableAt: number | undefined
  setResendAvailableAt: (ts: number | undefined) => void
}

const CspAuthSessionContext = createContext<CspAuthSessionValue | undefined>(undefined)

/**
 * Scopes one identify flow to its children, so every `CspAuth` under it resumes the same step.
 * Mount it inside an `ElectionProvider`, above a page's identify buttons; it stays mounted while
 * the election loads, and a process change restarts the flow.
 */
export const CspAuthSession = ({ children }: { children: ReactNode }) => {
  const { election } = useElection()
  const { connected, challengePending, clear } = useElectionAuth()
  const [currentStep, setCurrentStep] = useState<CspAuthStep>(0)
  const [contact, setContact] = useState<CspAuthContact>({})
  const [pendingNotice, setPendingNotice] = useState<string>()
  const [error, setError] = useState<string>()
  const [resendAvailableAt, setResendAvailableAt] = useState<number | undefined>(undefined)
  const flowGeneration = useRef(0)
  const processId = election?.id
  const sessionId = useId()

  // Bails out when the flow is already at its start, so the mount-time run does not re-render every consumer.
  const resetFlow = useCallback(() => {
    flowGeneration.current += 1
    setCurrentStep(0)
    setContact((prev) => (prev.email || prev.phone ? {} : prev))
    setPendingNotice(undefined)
    setError(undefined)
    setResendAvailableAt(undefined)
  }, [])

  const getFlowGeneration = useCallback(() => flowGeneration.current, [])

  // Once the voter connects, the next identify starts from scratch:
  // after a logout, step 1 would point at a cleared token.
  useEffect(() => {
    if (connected) resetFlow()
  }, [connected, resetFlow])

  // Step 1 needs the challenge that step 0 left pending. When the app cleared it (clear, clearVoter), the code
  // can no longer be confirmed, so the flow starts over. auth0 sets the challenge before step 0 moves to step 1.
  useEffect(() => {
    if (currentStep === 1 && !challengePending && !connected) resetFlow()
  }, [currentStep, challengePending, connected, resetFlow])

  useEffect(() => {
    resetFlow()
  }, [processId, resetFlow])

  const census = election?.census
  const value = useMemo<CspAuthSessionValue>(
    () => ({
      currentStep,
      setCurrentStep,
      contact,
      setContact,
      pendingNotice,
      setPendingNotice,
      error,
      setError,
      getFlowGeneration,
      authFields: census?.authFields ?? [],
      twoFaFields: census?.twoFaFields ?? [],
      processId,
      sessionId,
      providerClear: clear,
      resetFlow,
      resendAvailableAt,
      setResendAvailableAt,
    }),
    [currentStep, contact, pendingNotice, error, census, processId, sessionId, clear, getFlowGeneration, resetFlow, resendAvailableAt]
  )

  return <CspAuthSessionContext.Provider value={value}>{children}</CspAuthSessionContext.Provider>
}

/** The session when one is mounted above, otherwise undefined. */
export const useOptionalCspAuthSession = () => useContext(CspAuthSessionContext)

export const useCspAuthSession = () => {
  const session = useOptionalCspAuthSession()
  if (!session) {
    throw new Error('useCspAuthSession must be used within a <CspAuthSession />')
  }
  return session
}

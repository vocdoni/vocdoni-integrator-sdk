import type { OrgMemberAuthField, OrgMemberTwoFaField } from '@vocdoni/api-types'
import { useElection, useElectionAuth } from '@vocdoni/react-providers'
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react'

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
  authFields: OrgMemberAuthField[]
  twoFaFields: OrgMemberTwoFaField[]
  /** The process this flow authenticates against. */
  processId?: string
  /** Back to step 0 with no stored contact. */
  resetFlow: () => void
}

const CspAuthSessionContext = createContext<CspAuthSessionValue | undefined>(undefined)

/**
 * Scopes one identify flow to its children, so every `CspAuth` under it resumes the same step.
 * Mount it inside an `ElectionProvider`, above a page's identify buttons; it stays mounted while
 * the election loads, and a process change restarts the flow.
 */
export const CspAuthSession = ({ children }: { children: ReactNode }) => {
  const { election } = useElection()
  const { connected } = useElectionAuth()
  const [currentStep, setCurrentStep] = useState<CspAuthStep>(0)
  const [contact, setContact] = useState<CspAuthContact>({})
  const [pendingNotice, setPendingNotice] = useState<string>()
  const processId = election?.id

  // Bails out when the flow is already at its start, so the mount-time run does not re-render every consumer.
  const resetFlow = useCallback(() => {
    setCurrentStep(0)
    setContact((prev) => (prev.email || prev.phone ? {} : prev))
    setPendingNotice(undefined)
  }, [])

  // Once the voter connects, the next identify starts from scratch:
  // after a logout, step 1 would point at a cleared token.
  useEffect(() => {
    if (connected) resetFlow()
  }, [connected, resetFlow])

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
      authFields: census?.authFields ?? [],
      twoFaFields: census?.twoFaFields ?? [],
      processId,
      resetFlow,
    }),
    [currentStep, contact, pendingNotice, census, processId, resetFlow]
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

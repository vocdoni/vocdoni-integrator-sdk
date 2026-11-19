import { useElection, useElectionAuth } from '@vocdoni/react-providers'
import { type ReactNode, useEffect, useState } from 'react'
import { useReactComponentsLocalize } from '../../../i18n/localize'
import { useComponents } from '../../context/useComponents'
import { CspAuthCodeStep } from './CspAuthCodeStep'
import { CspAuthIdentifyStep } from './CspAuthIdentifyStep'
import { CspAuthSession, useCspAuthSession, useOptionalCspAuthSession } from './CspAuthSession'
import { useCspAuthPending } from './mutations'

export type CspAuthProps = {
  /**
   * Terms content shown in the identify form, above the submit button. Plain content by default;
   * with `requireTerms` it is the label of a required acceptance checkbox.
   */
  terms?: ReactNode
  /**
   * Enforces the terms: the identify form gets a required checkbox labelled by `terms`, and the
   * submit is blocked until it is checked. Without `terms` the checkbox has no label.
   */
  requireTerms?: boolean
  className?: string
}

/**
 * The voter's CSP identify flow: an Identify button opening a modal, or a Logout button once connected.
 * Renders nothing until the election loads.
 */
export const CspAuth = (props: CspAuthProps) => {
  const { election } = useElection()
  const session = useOptionalCspAuthSession()

  if (!election) return null

  // Reuse a session only when it is scoped to this process: a CspAuth under a nested ElectionProvider must not borrow
  // another process' census fields or step.
  if (session?.processId === election.id) return <CspAuthControls {...props} />

  return (
    <CspAuthSession>
      <CspAuthControls {...props} />
    </CspAuthSession>
  )
}

const CspAuthControls = ({ terms, requireTerms, className }: CspAuthProps) => {
  const t = useReactComponentsLocalize()
  const { connected, clear } = useElectionAuth()
  const { currentStep } = useCspAuthSession()
  const authPending = useCspAuthPending()
  const { CspAuthTrigger, CspAuthLogout, CspAuthModal } = useComponents()
  const [open, setOpen] = useState(false)

  // Once connected the modal has done its job, and must not reopen after a logout.
  useEffect(() => {
    if (connected) setOpen(false)
  }, [connected])

  if (connected) {
    return <CspAuthLogout className={className} label={t('csp.logout')} onClick={() => clear()} />
  }

  return (
    <>
      <CspAuthTrigger
        className={className}
        label={t('csp.identify')}
        onClick={() => setOpen(true)}
        loading={authPending}
      />
      <CspAuthModal
        isOpen={open}
        onClose={() => setOpen(false)}
        title={t('csp.modal_title')}
        closeLabel={t('csp.close')}
        content={
          currentStep === 0 ? <CspAuthIdentifyStep terms={terms} requireTerms={requireTerms} /> : <CspAuthCodeStep />
        }
      />
    </>
  )
}

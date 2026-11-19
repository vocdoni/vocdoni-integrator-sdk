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
 * Renders nothing until the election loads. Certificate censuses (`census.certAuth`) are not handled here:
 * the app connects those voters by other means, and only the Logout button shows then.
 */
export const CspAuth = (props: CspAuthProps) => {
  const { election } = useElection()
  const { clear } = useElectionAuth()
  const session = useOptionalCspAuthSession()

  if (!election) return null

  // Reuse a session only when it belongs to this ElectionProvider and process: a CspAuth under a nested provider
  // must not borrow another provider's tokens, nor its step.
  if (session?.processId === election.id && session.providerClear === clear) return <CspAuthControls {...props} />

  return (
    <CspAuthSession>
      <CspAuthControls {...props} />
    </CspAuthSession>
  )
}

const CspAuthControls = ({ terms, requireTerms, className }: CspAuthProps) => {
  const t = useReactComponentsLocalize()
  const { election, voting } = useElection()
  const { connected, clear } = useElectionAuth()
  const { currentStep, processId } = useCspAuthSession()
  const authPending = useCspAuthPending()
  const { CspAuthTrigger, CspAuthLogout, CspAuthModal } = useComponents()
  const [open, setOpen] = useState(false)

  // Once connected the modal has done its job, and must not reopen after a logout.
  useEffect(() => {
    if (connected) setOpen(false)
  }, [connected])

  // A certificate census logs in with a certificate, not these fields: the identify form would only answer 40005.
  if (election?.census.certAuth && !connected) return null

  return (
    <>
      {connected ? (
        // Disabled while voting: a vote in flight still writes to this session, and would leak into the next voter's.
        <CspAuthLogout className={className} label={t('csp.logout')} onClick={() => clear()} disabled={voting} />
      ) : (
        <CspAuthTrigger
          className={className}
          label={t('csp.identify')}
          onClick={() => setOpen(true)}
          loading={authPending}
        />
      )}
      {/* Always rendered, so the slot sees isOpen turn false when the voter connects. */}
      <CspAuthModal
        isOpen={open && !connected}
        onClose={() => setOpen(false)}
        title={t('csp.modal_title')}
        closeLabel={t('csp.close')}
        content={
          // Keyed by process: a process change must not carry typed values into the new process.
          currentStep === 0 ? (
            <CspAuthIdentifyStep key={processId} terms={terms} requireTerms={requireTerms} />
          ) : (
            <CspAuthCodeStep />
          )
        }
      />
    </>
  )
}

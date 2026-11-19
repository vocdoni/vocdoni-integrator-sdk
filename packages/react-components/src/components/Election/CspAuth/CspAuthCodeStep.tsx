import { type FormEvent, useEffect, useState } from 'react'
import { useReactComponentsLocalize } from '../../../i18n/localize'
import { useComponents } from '../../context/useComponents'
import { useCspAuthSession } from './CspAuthSession'
import { useCspAuth1, useCspAuthPending, useCspResend, useIsCspAuthBusy } from './mutations'

const CODE_LENGTH = 6

// Step 1: confirms the one-time code sent to the contact captured at step 0.
export const CspAuthCodeStep = () => {
  const t = useReactComponentsLocalize()
  const { contact, pendingNotice, setPendingNotice, resetFlow } = useCspAuthSession()
  const { CspAuthCodeForm: Slot } = useComponents()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string>()
  // i18n keys, translated at render.
  const [notice, setNotice] = useState<string | undefined>(pendingNotice)
  const auth = useCspAuth1()
  const resend = useCspResend()
  const authPending = useCspAuthPending()
  const isAuthBusy = useIsCspAuthBusy()

  // The "code sent" notice belongs to the first step-1 mount only.
  useEffect(() => {
    setPendingNotice(undefined)
  }, [setPendingNotice])

  const submitCode = async (value: string) => {
    // Also guards the auto-submit, which runs without the disabled button.
    if (isAuthBusy()) return
    if (!value) {
      setError(t('csp.step1.validation.required'))
      return
    }
    if (value.length < CODE_LENGTH) {
      setError(t('csp.step1.validation.length'))
      return
    }

    setError(undefined)
    try {
      // auth1 verifies the challenge and marks the voter connected; CspAuth then swaps the modal for Logout.
      await auth.mutateAsync(value)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('csp.auth_failed'))
    }
  }

  const onCodeChange = (next: string) => {
    // Custom slots may pass anything: only digits reach the state, so only digits can auto-submit.
    const digits = next.replace(/\D/g, '').slice(0, CODE_LENGTH)
    setCode(digits)
    // All digits in: submit without waiting for the button.
    if (digits.length === CODE_LENGTH) void submitCode(digits)
  }

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void submitCode(code)
  }

  const onResend = async () => {
    if (isAuthBusy()) return
    try {
      await resend.mutateAsync(contact)
      setError(undefined)
      setNotice('csp.step1.resend_success')
    } catch (err) {
      setNotice(undefined)
      const detail = err instanceof Error ? err.message : ''
      setError(detail ? t('csp.step1.resend_failed_detail', { detail }) : t('csp.step1.resend_failed'))
    }
  }

  return (
    <Slot
      title={t('csp.step1.subtitle')}
      helper={t('csp.step1.helper')}
      code={code}
      length={CODE_LENGTH}
      onCodeChange={onCodeChange}
      error={error}
      notice={notice ? t(notice) : undefined}
      loading={authPending}
      submitLabel={t('csp.authenticate')}
      onSubmit={onSubmit}
      resendLabel={t('csp.step1.resend')}
      onResend={() => void onResend()}
      resending={resend.isPending}
      startOverLabel={t('csp.step1.start_over')}
      onStartOver={() => resetFlow()}
      actionsDisabled={authPending}
      footer={t('csp.step1.footer')}
    />
  )
}

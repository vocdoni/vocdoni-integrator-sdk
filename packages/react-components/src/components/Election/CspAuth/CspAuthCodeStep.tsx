import { type FormEvent, useEffect, useRef, useState } from 'react'
import { useReactComponentsLocalize } from '../../../i18n/localize'
import { useComponents } from '../../context/useComponents'
import { useCspAuthSession } from './CspAuthSession'
import { CspCooldownError } from './errors'
import { useCspAuth1, useCspAuthPending, useCspResend, useIsCspAuthBusy } from './mutations'

const CODE_LENGTH = 6

// Step 1: confirms the one-time code sent to the contact captured at step 0.
export const CspAuthCodeStep = () => {
  const t = useReactComponentsLocalize()
  const {
    contact,
    pendingNotice,
    setPendingNotice,
    resetFlow,
    error,
    setError,
    getFlowGeneration,
    resendAvailableAt,
    setResendAvailableAt,
  } = useCspAuthSession()
  const { CspAuthCodeForm: Slot } = useComponents()
  const [code, setCode] = useState('')
  // The complete code that auto-submit already sent, so a code that waited for a busy flow goes out once.
  const autoSubmitted = useRef<string | undefined>(undefined)
  // i18n keys, translated at render.
  const [notice, setNotice] = useState<string | undefined>(pendingNotice)
  // Seconds left in the resend cooldown; derived from resendAvailableAt in the session.
  const [resendSecondsLeft, setResendSecondsLeft] = useState<number>(0)
  const auth = useCspAuth1()
  const resend = useCspResend()
  const authPending = useCspAuthPending()
  const isAuthBusy = useIsCspAuthBusy()

  // The "code sent" notice belongs to the first step-1 mount only.
  useEffect(() => {
    setPendingNotice(undefined)
  }, [setPendingNotice])

  // Drive the countdown display from the session's resendAvailableAt timestamp.
  // Set by the server on step-0 or resend success (coolDownTime), or on a 40103 refusal.
  // Never started locally.
  useEffect(() => {
    const computeLeft = () => Math.max(0, Math.ceil(((resendAvailableAt ?? 0) - Date.now()) / 1000))
    setResendSecondsLeft(computeLeft())
    if (!resendAvailableAt || resendAvailableAt <= Date.now()) return

    const id = setInterval(() => {
      const left = computeLeft()
      setResendSecondsLeft(left)
      if (left === 0) clearInterval(id)
    }, 1000)
    return () => clearInterval(id)
  }, [resendAvailableAt])

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
    // A submit supersedes the last resend's result, so "Code resent" does not sit beside its rejection.
    setNotice(undefined)
    const flow = getFlowGeneration()
    try {
      // auth1 verifies the challenge and marks the voter connected; CspAuth then swaps the modal for Logout.
      await auth.mutateAsync(value)
    } catch (err) {
      if (flow === getFlowGeneration()) setError(err instanceof Error ? err.message : t('csp.auth_failed'))
    }
  }

  // All digits in: submit without waiting for the button. A complete code that arrives while a request is
  // busy (a resend, say) goes out once the busy flag clears; editing the code re-arms it.
  useEffect(() => {
    if (code.length !== CODE_LENGTH) {
      autoSubmitted.current = undefined
      return
    }
    if (authPending || autoSubmitted.current === code) return
    autoSubmitted.current = code
    void submitCode(code)
  }, [code, authPending])

  const onCodeChange = (next: string) => {
    // Custom slots may pass anything: only digits reach the state, so only digits can auto-submit.
    setCode(next.replace(/\D/g, '').slice(0, CODE_LENGTH))
  }

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void submitCode(code)
  }

  const onResend = async () => {
    if (isAuthBusy()) return
    const flow = getFlowGeneration()
    try {
      const result = await resend.mutateAsync(contact)
      if (flow !== getFlowGeneration()) return
      // Server returns coolDownTime (ms) when a resend cooldown is in effect.
      if (result.coolDownTime) {
        setResendAvailableAt(Date.now() + result.coolDownTime)
      } else {
        // Clear any previous server-driven cooldown that has already expired.
        setResendAvailableAt(undefined)
      }
      setError(undefined)
      setNotice('csp.step1.resend_success')
    } catch (err) {
      if (flow !== getFlowGeneration()) return
      if (err instanceof CspCooldownError) {
        // Server enforces a cooldown; use its duration and show the countdown in the notice slot.
        setResendAvailableAt(Date.now() + err.coolDownMs)
        setError(undefined)
        return
      }
      setNotice(undefined)
      const detail = err instanceof Error ? err.message : ''
      setError(detail ? t('csp.step1.resend_failed_detail', { detail }) : t('csp.step1.resend_failed'))
    }
  }

  // Show the countdown text whenever the server has set one; fall back to any existing notice.
  const resendNotice =
    resendSecondsLeft > 0
      ? t('csp.step1.resend_cooldown', { count: resendSecondsLeft })
      : notice
        ? t(notice)
        : undefined

  return (
    <Slot
      title={t('csp.step1.subtitle')}
      helper={t('csp.step1.helper')}
      code={code}
      length={CODE_LENGTH}
      onCodeChange={onCodeChange}
      error={error}
      notice={resendNotice}
      loading={authPending}
      submitLabel={t('csp.authenticate')}
      onSubmit={onSubmit}
      resendLabel={t('csp.step1.resend')}
      onResend={() => void onResend()}
      resending={resend.isPending}
      resendDisabled={resendSecondsLeft > 0}
      startOverLabel={t('csp.step1.start_over')}
      onStartOver={() => resetFlow()}
      actionsDisabled={authPending}
      footer={t('csp.step1.footer')}
    />
  )
}

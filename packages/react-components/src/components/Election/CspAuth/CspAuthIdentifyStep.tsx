import { hashMemberPassword } from '@vocdoni/api-client'
import type { AuthRequest } from '@vocdoni/api-types'
import { useElection } from '@vocdoni/react-providers'
import { type ReactNode, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { useReactComponentsLocalize } from '../../../i18n/localize'
import type { CspAuthField } from '../../context/types'
import { useComponents } from '../../context/useComponents'
import { useCspAuthSession } from './CspAuthSession'
import { getAuthFieldInputType, getAuthFieldLabel, getContactFieldLabel, getContactInputType } from './fields'
import { useCspAuth0, useCspAuthPending, useIsCspAuthBusy } from './mutations'

type IdentifyValues = Record<string, string | boolean | undefined>

const text = (value: IdentifyValues[string]) => (typeof value === 'string' ? value.trim() : '')

// Step 0: identifies the voter against the census. Auth-only censuses are connected once it succeeds.
export const CspAuthIdentifyStep = ({ terms, requireTerms }: { terms?: ReactNode; requireTerms?: boolean }) => {
  const t = useReactComponentsLocalize()
  const { election } = useElection()
  const { setCurrentStep, setContact, setPendingNotice, error, setError, getFlowGeneration, authFields, twoFaFields } =
    useCspAuthSession()
  const { CspAuthIdentifyForm: Slot } = useComponents()
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<IdentifyValues>()
  const auth = useCspAuth0()
  const authPending = useCspAuthPending()
  const isAuthBusy = useIsCspAuthBusy()
  // Set synchronously: the busy flag only turns on once the mutation starts, after the password hash is awaited.
  const submitting = useRef(false)
  const is2Factor = twoFaFields.length > 0

  // The plaintext password never leaves the browser: the request carries its hash, salted with the org address.
  const hashPassword = async (password: string): Promise<string> => {
    if (!election?.orgAddress) throw new Error(t('csp.password_unavailable'))
    try {
      return await hashMemberPassword(election.orgAddress, password)
    } catch {
      throw new Error(t('csp.password_unavailable'))
    }
  }

  const buildRequest = async (values: IdentifyValues): Promise<AuthRequest> => {
    const request: AuthRequest = {}
    for (const field of authFields) {
      const value = text(values[field])
      if (!value) continue
      request[field] = field === 'password' ? await hashPassword(value) : value
    }

    const contact = text(values.contact)
    if (contact) {
      const email = twoFaFields.includes('email')
      const phone = twoFaFields.includes('phone')
      // With both channels allowed, an address containing '@' is an email and anything else a phone number.
      if (email && (!phone || contact.includes('@'))) request.email = contact
      else request.phone = contact
    }
    return request
  }

  const submit = async (values: IdentifyValues) => {
    if (submitting.current || isAuthBusy()) return
    submitting.current = true
    setError(undefined)
    // A reset while the request is in flight (process change, logout, start over) makes its outcome stale.
    const flow = getFlowGeneration()

    try {
      const request = await buildRequest(values)
      await auth.mutateAsync(request)
      if (flow !== getFlowGeneration()) return
      setContact({ email: request.email, phone: request.phone })
      // Without 2FA the provider is already connected, so there is no next step.
      if (is2Factor) {
        setPendingNotice('csp.code_sent')
        setCurrentStep(1)
      }
    } catch (err) {
      if (flow === getFlowGeneration()) setError(err instanceof Error ? err.message : t('csp.auth_failed'))
    } finally {
      submitting.current = false
    }
  }

  // The password always comes last.
  const orderedAuthFields = [
    ...authFields.filter((field) => field !== 'password'),
    ...authFields.filter((field) => field === 'password'),
  ]
  const fields: CspAuthField[] = orderedAuthFields.map((field) => ({
    name: field,
    label: getAuthFieldLabel(t, field),
    type: getAuthFieldInputType(field),
    required: true,
    error: errors[field] ? t('validation.required') : undefined,
    inputProps: register(field, { required: true, validate: (value) => text(value) !== '' }),
  }))
  if (is2Factor) {
    fields.push({
      name: 'contact',
      label: getContactFieldLabel(t, twoFaFields),
      type: getContactInputType(twoFaFields),
      required: true,
      helper: t('csp.contact_match_help'),
      error: errors.contact ? t('validation.required') : undefined,
      inputProps: register('contact', { required: true, validate: (value) => text(value) !== '' }),
    })
  }

  const termsField = requireTerms
    ? {
        error: errors.terms ? t('csp.terms_required') : undefined,
        inputProps: register('terms', { required: true }),
      }
    : undefined

  return (
    <Slot
      fields={fields}
      terms={terms}
      termsField={termsField}
      error={error}
      loading={authPending}
      submitLabel={is2Factor ? t('csp.receive_code') : t('csp.authenticate')}
      info={is2Factor ? t('csp.code_info') : undefined}
      onSubmit={handleSubmit(submit)}
    />
  )
}

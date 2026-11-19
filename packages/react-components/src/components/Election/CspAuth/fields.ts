import type { CspAuthTranslate } from './errors'

// The label of the single contact input: the form routes it to `email` or `phone` itself.
export const getContactFieldLabel = (t: CspAuthTranslate, twoFaFields: readonly string[]): string => {
  const email = twoFaFields.includes('email')
  const phone = twoFaFields.includes('phone')

  if (email && phone) return t('csp.fields.email_or_phone')
  if (email) return t('csp.fields.email')
  if (phone) return t('csp.fields.phone')
  return t('csp.fields.contact')
}

// The single contact input takes the type of the only channel it can carry, `text` when both are allowed.
export const getContactInputType = (twoFaFields: readonly string[]): string => {
  const email = twoFaFields.includes('email')
  const phone = twoFaFields.includes('phone')

  if (email && !phone) return getAuthFieldInputType('email')
  if (phone && !email) return getAuthFieldInputType('phone')
  return 'text'
}

export const getAuthFieldLabel = (t: CspAuthTranslate, field: string): string =>
  ['memberNumber', 'name', 'surname', 'nationalId', 'birthDate', 'password'].includes(field)
    ? t(`csp.fields.${field}`)
    : field

export const getAuthFieldInputType = (field: string): string => {
  if (field === 'email') return 'email'
  if (field === 'phone') return 'tel'
  if (field === 'birthDate') return 'date'
  if (field === 'password') return 'password'
  return 'text'
}

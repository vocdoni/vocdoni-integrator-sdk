import type { QuestionStatus, VotingProcessResponse } from '@vocdoni/api-types'

export type ElectionLike = VotingProcessResponse | Record<string, any>

const isObject = (value: unknown): value is Record<string, any> => typeof value === 'object' && value !== null

export const getElectionField = (election: ElectionLike | null | undefined, path: string): unknown => {
  if (!election) return undefined
  return path.split('.').reduce<unknown>((value, key) => {
    if (!isObject(value)) return undefined
    return value[key]
  }, election)
}

export const getElectionTitle = (election: ElectionLike | null | undefined): string => {
  if (!election) return ''
  const title = (election as VotingProcessResponse).title
  if (!title) return (election as any).id ?? ''
  if (typeof title === 'string') return title
  return title.default ?? Object.values(title)[0] ?? (election as any).id ?? ''
}

export const getElectionDescription = (election: ElectionLike | null | undefined): string | undefined => {
  if (!election) return undefined
  const desc = (election as VotingProcessResponse).description
  if (!desc) return undefined
  if (typeof desc === 'string') return desc
  return desc.default ?? Object.values(desc)[0]
}

/**
 * Returns the derived process status. For a {@link VotingProcessResponse} this is
 * `undefined` because status is computed from questions (use the `status` field from
 * `useElection()` instead). Kept for backward-compat with `ElectionLike` usage.
 */
export const getElectionStatus = (election: ElectionLike | null | undefined): QuestionStatus | undefined => {
  if (!election) return undefined
  return (election as any).status as QuestionStatus | undefined
}

export const getElectionDate = (
  election: ElectionLike | null | undefined,
  field: 'startDate' | 'endDate'
): Date | undefined => {
  if (!election) return undefined
  const value = (election as any)[field]
  if (!value) return undefined
  const date = value instanceof Date ? value : new Date(value)
  // An unparseable date yields a truthy Invalid Date that throws inside date-fns
  // `format`. Report it as absent, which every caller already handles.
  return Number.isNaN(date.getTime()) ? undefined : date
}

export const isInvalidElectionLike = (election: ElectionLike | null | undefined): boolean => {
  return !election
}

export const isPublishedElectionLike = (election: ElectionLike | null | undefined): boolean => {
  return !!election
}

/** Extract a string label from a title that may be string or i18n object */
export const resolveTitle = (title: string | Record<string, string> | undefined): string => {
  if (!title) return ''
  if (typeof title === 'string') return title
  return title.default ?? Object.values(title)[0] ?? ''
}

/** Extract a string label from a description that may be string or i18n object */
export const resolveDescription = (desc: string | Record<string, string> | undefined): string | undefined => {
  if (!desc) return undefined
  if (typeof desc === 'string') return desc
  return desc.default ?? Object.values(desc)[0]
}

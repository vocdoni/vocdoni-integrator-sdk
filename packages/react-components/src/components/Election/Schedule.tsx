import type { QuestionStatus } from '@vocdoni/api-types'
import { format as dformat, formatDistance } from 'date-fns'
import { ComponentPropsWithoutRef } from 'react'
import { useComponents } from '../context/useComponents'
import { useReactComponentsLocalize } from '../../i18n/localize'
import { useElection } from '@vocdoni/react-providers'
import { getElectionDate } from '../../election/normalized'
import { useIsHydrationRender } from '../shared/useIsHydrationRender'

export type ElectionScheduleProps = ComponentPropsWithoutRef<'p'> &
  Record<string, unknown> & {
    format?: string
    showRemaining?: boolean
    showCreatedAt?: boolean
  }

const formatDeterministicDate = (date: Date) => date.toISOString()

export const ElectionSchedule = ({
  format = 'PPp',
  showRemaining = false,
  showCreatedAt = false,
  ...rest
}: ElectionScheduleProps) => {
  const { election, status } = useElection()
  const t = useReactComponentsLocalize()
  const { ElectionSchedule: Slot } = useComponents()
  const isHydrationRender = useIsHydrationRender()
  const startDate = getElectionDate(election, 'startDate')
  const endDate = getElectionDate(election, 'endDate')

  if (!election || !startDate || !endDate || !status) return null

  const getRemaining = (now: Date): string => {
    switch (status as QuestionStatus) {
      case 'ONGOING':
        if (endDate < now) {
          return t('schedule.ended', {
            distance: formatDistance(endDate, now, { addSuffix: true }),
          })
        }
        return formatDistance(endDate, now, { addSuffix: true })
      case 'ENDED':
      case 'RESULTS':
        return t('schedule.ended', {
          distance: formatDistance(endDate, now, { addSuffix: true }),
        })
      case 'PAUSED':
        if (now < startDate) {
          return t('schedule.paused_start', {
            distance: formatDistance(startDate, now, { addSuffix: true }),
          })
        }
        return t('schedule.paused_end', {
          distance: formatDistance(endDate, now, { addSuffix: true }),
        })
      case 'UPCOMING':
      default:
        return formatDistance(startDate, now, { addSuffix: true })
    }
  }

  const getDeterministicText = () => {
    return t('schedule.from_begin_to_end', {
      begin: formatDeterministicDate(startDate),
      end: formatDeterministicDate(endDate),
    })
  }

  let text = getDeterministicText()

  if (!isHydrationRender) {
    const now = new Date()

    text = t('schedule.from_begin_to_end', {
      begin: dformat(startDate, format),
      end: dformat(endDate, format),
    })

    if (showRemaining) {
      text = getRemaining(now)
    }
  }

  return <Slot {...rest} text={text} />
}

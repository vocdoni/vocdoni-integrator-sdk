import type { QuestionStatus } from '@vocdoni/api-types'
import { format as dformat } from 'date-fns'
import { ComponentPropsWithoutRef } from 'react'
import { VoteButtonSlotProps } from '../context/types'
import { useComponents } from '../context/useComponents'
import { useReactComponentsLocalize } from '../../i18n/localize'
import { getElectionDate } from '../../election/normalized'
import { useIsHydrationRender } from '../shared/useIsHydrationRender'
import { useElection } from '@vocdoni/react-providers'

export const VoteButton = (props: ComponentPropsWithoutRef<'button'> & Record<string, unknown>) => {
  const externalDisabled = Boolean(props.disabled)
  const { election, status, isAbleToVote, voting, connected, isInCensus, hasVoted } = useElection()
  const { VoteButton: Slot } = useComponents()
  const t = useReactComponentsLocalize()
  const isHydrationRender = useIsHydrationRender()

  if (!election) {
    return null
  }

  const isDisabled = !isAbleToVote || status !== 'ONGOING' || externalDisabled

  // Why the SDK disables the button, so the voter isn't left guessing (a
  // disabled button with no explanation reads as broken — integrator-sdk#53).
  // The process state comes first: it is the reason that holds for everyone,
  // whatever the voter's own session says. A consumer's own `disabled` carries
  // no reason we can name, and an in-flight vote already shows as loading.
  const reason = (): string | undefined => {
    switch (status as QuestionStatus | null) {
      case 'ONGOING':
        break
      case 'UPCOMING': {
        const startDate = getElectionDate(election, 'startDate')
        // The dated sentence depends on the client's clock/timezone, so the
        // hydration render sticks to the neutral one (same text on both sides).
        if (!startDate || isHydrationRender) return t('vote.disabled.upcoming')
        return t('vote.disabled.upcoming_at', {
          date: dformat(startDate, t('vote.disabled.upcoming_date_format')),
        })
      }
      case 'PAUSED':
        return t('vote.disabled.paused')
      case 'ENDED':
      case 'RESULTS':
        return t('vote.disabled.ended')
      case 'CANCELED':
        return t('vote.disabled.canceled')
      default:
        return t('vote.disabled.not_open')
    }
    if (hasVoted) return t('vote.disabled.voted')
    if (!connected) return t('vote.disabled.identify')
    if (!isInCensus) return t('vote.disabled.not_in_census')
    return undefined
  }

  const button: VoteButtonSlotProps = {
    type: 'submit' as const,
    ...(props as Omit<VoteButtonSlotProps, 'label' | 'type'>),
    form: `election-questions-${election.id}`,
    // Also disabled while the vote is in flight — closes the double-submit window.
    disabled: isDisabled || voting,
    loading: voting,
    tooltip: isDisabled && !voting ? reason() : undefined,
    // Re-voting isn't supported by the SaaS process model (`isAbleToVote`
    // excludes voted users), so there is no "update your vote" label variant.
    label: t('vote.button'),
  }

  return <Slot {...button} />
}

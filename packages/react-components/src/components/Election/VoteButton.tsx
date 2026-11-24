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
  const { election, status, isAbleToVote, voting, connected, isInCensus, hasVoted, voteStatus, voterQuestions } =
    useElection()
  const { VoteButton: Slot } = useComponents()
  const t = useReactComponentsLocalize()
  const isHydrationRender = useIsHydrationRender()

  if (!election) {
    return null
  }

  const isDisabled = !isAbleToVote || status !== 'ONGOING' || externalDisabled

  // Why the SDK disables the button — an unexplained disabled button reads as
  // broken (integrator-sdk#53). Process state first: it holds for every voter,
  // whatever their own session says.
  const reason = (): string | undefined => {
    const voted = (id: string) => voteStatus?.[id] === 'confirmed' || voterQuestions?.some((q) => q.questionId === id && q.hasVoted)
    // Only the questions this voter can vote: one they are not eligible for never opens to them.
    const votable = election.questions.filter((q) => voterQuestions?.some((vq) => vq.questionId === q.id && vq.canVote))
    const waiting = votable.some((q) => (q.status === 'PAUSED' || q.status === 'UPCOMING') && !voted(q.id))
    switch (status as QuestionStatus | null) {
      case 'ONGOING':
        break
      // Mixed statuses with none ONGOING, e.g. q-0 ENDED and q-1 PAUSED: the
      // gap between two questions of a question-by-question vote (#111).
      case 'PROCESS_UNKNOWN':
        if (!waiting) return t('vote.disabled.not_open')
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
    // Signed by the CSP, but nothing this tab can send or confirm.
    const statuses = Object.values(voteStatus ?? {})
    if (statuses.includes('unconfirmed')) return t('vote.disabled.unconfirmed')
    if (statuses.includes('signed')) return t('vote.disabled.signed')
    // Question by question: nothing open is left for the voter. A paused or
    // upcoming one can still open; an ENDED one never will. Only when nothing
    // open is left: an able voter disabled by the consumer gets no tooltip.
    // No votable question at all: nothing here to explain, as before question-by-question votes.
    if (!isAbleToVote && votable.length) {
      const votedSome = votable.some((q) => voted(q.id))
      if (!votedSome) return t('vote.disabled.waiting_question_none')
      return waiting ? t('vote.disabled.waiting_question') : t('vote.disabled.voted')
    }
    return undefined
  }

  const button: VoteButtonSlotProps = {
    type: 'submit' as const,
    ...(props as Omit<VoteButtonSlotProps, 'label' | 'type'>),
    form: `election-questions-${election.id}`,
    // Also disabled while the vote is in flight — closes the double-submit window.
    disabled: isDisabled || voting,
    loading: voting,
    // None for a consumer's own `disabled` (reason unknown), none while loading.
    tooltip: isDisabled && !voting ? reason() : undefined,
    // Re-voting isn't supported by the SaaS process model (`isAbleToVote`
    // excludes voted users), so there is no "update your vote" label variant.
    label: t('vote.button'),
  }

  return <Slot {...button} />
}
